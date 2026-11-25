package main

import (
	"archive/zip"
	"context"
	"embed"
	"encoding/json"
	"fmt"
	"io"
	"io/fs"
	"log"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"runtime/debug"
	"strconv"
	"strings"
	"sync"
	"time"
)

const AppVersion = "v3.3.0"

//go:embed all:web
var embeddedWebFS embed.FS

type sseEvent struct {
	Type    string `json:"type"`
	Payload any    `json:"payload"`
}

// AppServer coordinates HTTP API requests, SSE real-time events, background task polling,
// thumbnail caching, portable diagnostics logging, and local storage.
type AppServer struct {
	store       *Store
	client      *DuomiClient
	logger      *AppLogger
	thumbs      *ThumbnailCache
	pollingMu   sync.Mutex
	polling     map[string]bool
	cancelFuncs map[string]context.CancelFunc

	taskLockMu sync.Mutex
	taskLocks  map[string]*sync.Mutex

	sseMu      sync.Mutex
	sseClients map[chan []byte]struct{}
}

func NewAppServer(store *Store, client *DuomiClient) *AppServer {
	logger := store.getLogger()
	if logger == nil && store != nil {
		if l, err := NewAppLogger(store.LogsDir()); err == nil {
			logger = l
			store.SetLogger(l)
		}
	}
	return NewAppServerWithLogger(store, client, logger)
}

func NewAppServerWithLogger(store *Store, client *DuomiClient, logger *AppLogger) *AppServer {
	if logger != nil {
		if store != nil {
			store.SetLogger(logger)
		}
		if client != nil {
			client.SetLogger(logger)
		}
	}
	var thumbs *ThumbnailCache
	if store != nil {
		thumbs = NewThumbnailCache(store.ImagesDir(), store.ThumbsDir(), logger)
	}
	s := &AppServer{
		store:       store,
		client:      client,
		logger:      logger,
		thumbs:      thumbs,
		polling:     make(map[string]bool),
		cancelFuncs: make(map[string]context.CancelFunc),
		taskLocks:   make(map[string]*sync.Mutex),
		sseClients:  make(map[chan []byte]struct{}),
	}
	s.ResumePendingTasks()
	return s
}

func (s *AppServer) getLogger() *AppLogger {
	if s.logger != nil {
		return s.logger
	}
	if s.store != nil {
		return s.store.getLogger()
	}
	return nil
}

func (s *AppServer) getThumbs() *ThumbnailCache {
	if s.thumbs != nil {
		return s.thumbs
	}
	if s.store != nil {
		s.thumbs = NewThumbnailCache(s.store.ImagesDir(), s.store.ThumbsDir(), s.getLogger())
	}
	return s.thumbs
}

func (s *AppServer) lockTaskSync(taskID string) func() {
	s.taskLockMu.Lock()
	if s.taskLocks == nil {
		s.taskLocks = make(map[string]*sync.Mutex)
	}
	mu, ok := s.taskLocks[taskID]
	if !ok {
		mu = &sync.Mutex{}
		s.taskLocks[taskID] = mu
	}
	s.taskLockMu.Unlock()

	mu.Lock()
	return func() {
		mu.Unlock()
	}
}

func (s *AppServer) broadcastSSE(eventType string, payload any) {
	// Always slim TaskRecord payloads before broadcasting so SSE stays tiny & fast
	if rec, ok := payload.(*TaskRecord); ok && rec != nil {
		payload = SlimTaskRecord(rec)
	}

	s.sseMu.Lock()
	defer s.sseMu.Unlock()
	if len(s.sseClients) == 0 {
		return
	}
	raw, err := json.Marshal(sseEvent{
		Type:    eventType,
		Payload: payload,
	})
	if err != nil {
		return
	}
	for ch := range s.sseClients {
		select {
		case ch <- raw:
		default:
			// Drop slow client message rather than blocking
		}
	}
}

// ResumePendingTasks restarts background polling for recent unfinished tasks.
func (s *AppServer) ResumePendingTasks() {
	if s.store == nil {
		return
	}
	now := time.Now().Unix()
	resumed := 0
	for _, rec := range s.store.ListRecords() {
		if (rec.State == "pending" || rec.State == "running") && now-rec.CreateTime < 1800 {
			s.StartPolling(rec.ID)
			resumed++
		}
	}
	if resumed > 0 {
		if l := s.getLogger(); l != nil {
			l.Info("poll", "已恢复未完成任务的后台轮询", map[string]any{"resumed_count": resumed})
		}
	}
}

// StartPolling launches a background goroutine to poll task status until completion, cancellation, or timeout.
func (s *AppServer) StartPolling(taskID string) {
	s.pollingMu.Lock()
	if s.polling == nil {
		s.polling = make(map[string]bool)
	}
	if s.cancelFuncs == nil {
		s.cancelFuncs = make(map[string]context.CancelFunc)
	}
	if s.polling[taskID] {
		s.pollingMu.Unlock()
		return
	}
	pollCtx, cancel := context.WithCancel(context.Background())
	s.polling[taskID] = true
	s.cancelFuncs[taskID] = cancel
	s.pollingMu.Unlock()

	go func(id string) {
		defer func() {
			if rv := recover(); rv != nil {
				if l := s.getLogger(); l != nil {
					l.Error("poll", fmt.Sprintf("轮询协程发生 panic: %v", rv), map[string]any{"task_id": id}, string(debug.Stack()))
				}
			}
			cancel()
			s.pollingMu.Lock()
			delete(s.polling, id)
			delete(s.cancelFuncs, id)
			s.pollingMu.Unlock()
		}()

		cfg := s.store.GetConfig()
		interval := time.Duration(cfg.PollInterval) * time.Second
		if interval < 2*time.Second {
			interval = 3 * time.Second
		}
		timeout := time.Duration(cfg.PollTimeout) * time.Second
		if timeout < 30*time.Second {
			timeout = 300 * time.Second
		}

		if l := s.getLogger(); l != nil {
			l.Debug("poll", "启动任务后台轮询", map[string]any{
				"task_id":    id,
				"interval_s": int(interval.Seconds()),
				"timeout_s":  int(timeout.Seconds()),
			})
		}

		deadline := time.Now().Add(timeout)
		consecutiveErrs := 0
		for {
			select {
			case <-pollCtx.Done():
				return
			default:
			}

			reqCtx, reqCancel := context.WithTimeout(pollCtx, 45*time.Second)
			rec, done, syncErr := s.syncTaskOnceInternal(reqCtx, id, cfg.AutoDownload, false, &consecutiveErrs)
			reqCancel()

			if pollCtx.Err() != nil {
				return
			}
			if done {
				return
			}
			// If record was deleted by user while polling, stop polling immediately
			if rec == nil && syncErr == nil {
				return
			}
			if time.Now().After(deadline) {
				updated, exists, changed := s.store.UpdateRecordFromSync(id, false, cfg.DefaultModel, func(r *TaskRecord) bool {
					if r.State != "pending" && r.State != "running" {
						return false
					}
					r.State = "timeout"
					r.ErrorMsg = fmt.Sprintf("轮询超时 (%ds)，可点击“刷新状态”继续查询", int(timeout.Seconds()))
					r.UpdateTime = time.Now().Unix()
					return true
				})
				if exists && changed && updated != nil {
					if l := s.getLogger(); l != nil {
						l.Warn("poll", "任务轮询超时", map[string]any{"task_id": id, "timeout_s": int(timeout.Seconds())})
					}
					s.broadcastSSE("record_updated", updated)
				}
				return
			}

			sleepDur := interval
			if consecutiveErrs >= 3 {
				sleepDur = interval * 2
				if sleepDur > 15*time.Second {
					sleepDur = 15 * time.Second
				}
			}

			select {
			case <-pollCtx.Done():
				return
			case <-time.After(sleepDur):
			}
		}
	}(taskID)
}

// CancelPolling stops active background polling for a task and marks it canceled if still pending/running.
func (s *AppServer) CancelPolling(taskID string) (*TaskRecord, error) {
	s.pollingMu.Lock()
	if s.cancelFuncs != nil {
		if cancel, ok := s.cancelFuncs[taskID]; ok {
			cancel()
			delete(s.cancelFuncs, taskID)
		}
	}
	if s.polling != nil {
		delete(s.polling, taskID)
	}
	s.pollingMu.Unlock()

	rec, exists, changed := s.store.UpdateRecordFromSync(taskID, false, "", func(r *TaskRecord) bool {
		if r.State != "pending" && r.State != "running" {
			return false
		}
		r.State = "canceled"
		r.ErrorMsg = "已手动停止本地轮询（稍后仍可点击“刷新状态”重新同步远端结果）"
		r.UpdateTime = time.Now().Unix()
		return true
	})
	if !exists {
		return nil, fmt.Errorf("未找到任务: %s", taskID)
	}
	if changed {
		if l := s.getLogger(); l != nil {
			l.Info("poll", "已手动停止任务本地轮询", map[string]any{"task_id": taskID})
		}
		s.broadcastSSE("record_updated", rec)
	}
	return rec, nil
}

// SyncTaskOnce queries DuomiAPI for a single task, updates the local record, downloads images if succeeded, and emits SSE.
func (s *AppServer) SyncTaskOnce(ctx context.Context, taskID string, downloadImages bool) (*TaskRecord, bool, error) {
	return s.syncTaskOnceInternal(ctx, taskID, downloadImages, true, nil)
}

func (s *AppServer) syncTaskOnceInternal(ctx context.Context, taskID string, downloadImages bool, allowCreate bool, consecutiveErrs *int) (*TaskRecord, bool, error) {
	unlock := s.lockTaskSync(taskID)
	defer unlock()

	logger := s.getLogger()
	cfg := s.store.GetConfig()

	existing, exists := s.store.GetRecord(taskID)
	if !exists && !allowCreate {
		return nil, true, nil
	}

	resp, rawStr, err := s.client.GetTask(ctx, cfg.BaseURL, cfg.APIKey, taskID)
	if err != nil {
		if ctx.Err() != nil {
			return existing, false, ctx.Err()
		}
		if consecutiveErrs != nil {
			*consecutiveErrs++
			// Tolerate single transient blip without spamming SSE / polluting card error state
			if *consecutiveErrs < 2 {
				return existing, false, err
			}
		}
		updated, stillExists, changed := s.store.UpdateRecordFromSync(taskID, allowCreate, cfg.DefaultModel, func(r *TaskRecord) bool {
			if r.ErrorMsg == err.Error() {
				return false
			}
			r.UpdateTime = time.Now().Unix()
			r.ErrorMsg = err.Error()
			return true
		})
		if stillExists && changed && updated != nil {
			s.broadcastSSE("record_updated", updated)
		}
		// Stop polling permanently on auth error rather than hammering DuomiAPI
		if strings.Contains(err.Error(), "HTTP 401") || strings.Contains(err.Error(), "HTTP 403") {
			return updated, true, err
		}
		return updated, false, err
	}

	if consecutiveErrs != nil {
		*consecutiveErrs = 0
	}

	state := normalizeDuomiTaskState(resp.State)
	if state == "" {
		state = "pending"
	}

	// If succeeded, perform image downloads OUTSIDE store mutex to prevent blocking other readers/writers
	var downloadedImages []SavedImage
	downloadedNewFile := false
	if state == "succeeded" {
		existingMap := make(map[string]SavedImage)
		if existing != nil {
			for _, img := range existing.Images {
				if img.RemoteURL != "" {
					existingMap[img.RemoteURL] = img
				}
			}
		}

		for idx, item := range resp.Data.Images {
			saved := SavedImage{
				RemoteURL: item.URL,
				FileName:  item.FileName,
			}
			if prev, ok := existingMap[item.URL]; ok && prev.LocalFile != "" {
				fullExisting := filepath.Join(s.store.ImagesDir(), filepath.Base(prev.LocalFile))
				if _, statErr := os.Stat(fullExisting); statErr == nil {
					saved.LocalFile = prev.LocalFile
					saved.Width = prev.Width
					saved.Height = prev.Height
					saved.SizeBytes = prev.SizeBytes
				}
			}

			if saved.LocalFile == "" && downloadImages {
				if item.URL != "" {
					localName, dlErr := s.client.DownloadImage(ctx, item.URL, s.store.ImagesDir(), taskID, idx, item.FileName)
					if dlErr == nil {
						saved.LocalFile = localName
						downloadedNewFile = true
					} else {
						log.Printf("[WARN] 下载任务 %s 图片失败: %v", taskID, dlErr)
					}
				} else if item.B64JSON != "" {
					localName, b64Err := SaveBase64Image(item.B64JSON, s.store.ImagesDir(), taskID, idx)
					if b64Err == nil {
						saved.LocalFile = localName
						downloadedNewFile = true
					}
				}
			}

			if saved.LocalFile != "" {
				if saved.SizeBytes == 0 || saved.Width == 0 {
					w, h, sz := InspectImageFileMetadata(filepath.Join(s.store.ImagesDir(), filepath.Base(saved.LocalFile)))
					saved.Width = w
					saved.Height = h
					saved.SizeBytes = sz
				}
				if tc := s.getThumbs(); tc != nil {
					tc.PrewarmAsync(filepath.Base(saved.LocalFile))
				}
			}
			downloadedImages = append(downloadedImages, saved)
		}
		if downloadedNewFile {
			s.store.InvalidateDiskStats()
		}
	}

	nowUnix := time.Now().Unix()
	var terminal bool

	updated, stillExists, changed := s.store.UpdateRecordFromSync(taskID, allowCreate, cfg.DefaultModel, func(r *TaskRecord) bool {
		prevState := r.State
		prevProgress := r.Progress
		prevErr := r.ErrorMsg
		prevDesc := r.Description
		prevImgCount := len(r.Images)

		if resp.CreateTime > 0 && r.CreateTime == 0 {
			r.CreateTime = resp.CreateTime
		}

		r.State = state
		r.Progress = resp.Progress
		if resp.Data.Description != "" {
			r.Description = resp.Data.Description
		}
		if r.CreateTime > 0 && nowUnix >= r.CreateTime {
			r.DurationMs = (nowUnix - r.CreateTime) * 1000
		}

		switch state {
		case "succeeded":
			terminal = true
			r.Progress = 100
			r.ErrorMsg = ""
			r.Images = downloadedImages
			r.RawResponse = rawStr
			r.UpdateTime = nowUnix
			return true

		case "error", "failed":
			terminal = true
			errMsg := resp.Message
			if errMsg == "" {
				errMsg = resp.Reason
			}
			if errMsg == "" && resp.Data.Description != "" {
				errMsg = resp.Data.Description
			}
			if errMsg == "" {
				errMsg = "生成失败，请查看原始响应详情"
			}
			r.ErrorMsg = errMsg
			r.RawResponse = rawStr
			r.UpdateTime = nowUnix
			return true

		default:
			// Clear transient poll error notice once upstream responds cleanly again
			r.ErrorMsg = ""
			meaningfulChange := prevState != r.State ||
				prevProgress != r.Progress ||
				prevErr != r.ErrorMsg ||
				prevDesc != r.Description ||
				prevImgCount != len(r.Images)
			if meaningfulChange {
				r.RawResponse = rawStr
				r.UpdateTime = nowUnix
			}
			return meaningfulChange
		}
	})

	if !stillExists {
		return nil, true, nil
	}

	if changed && updated != nil {
		if logger != nil {
			switch updated.State {
			case "succeeded":
				logger.Info("poll", "任务生成完成", map[string]any{
					"task_id":     taskID,
					"image_count": len(updated.Images),
					"duration_ms": updated.DurationMs,
				})
			case "error", "failed":
				logger.Warn("poll", "任务远端执行失败", map[string]any{
					"task_id": taskID,
					"state":   updated.State,
					"error":   updated.ErrorMsg,
				})
			default:
				logger.Debug("poll", "任务状态推进", map[string]any{
					"task_id":  taskID,
					"state":    updated.State,
					"progress": updated.Progress,
				})
			}
		}
		s.broadcastSSE("record_updated", updated)
		if updated.State == "succeeded" {
			s.broadcastSSE("stats_updated", s.store.DiskStats())
		}
	}

	return updated, terminal, nil
}

func (s *AppServer) recoverMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		defer func() {
			if rv := recover(); rv != nil {
				stack := string(debug.Stack())
				if l := s.getLogger(); l != nil {
					l.Error("server", fmt.Sprintf("HTTP 处理发生未捕获异常: %v", rv), map[string]any{
						"method": r.Method,
						"path":   r.URL.Path,
					}, stack)
				}
				writeJSONError(w, http.StatusInternalServerError, fmt.Sprintf("服务内部异常: %v", rv))
			}
		}()
		next.ServeHTTP(w, r)
	})
}

func (s *AppServer) Handler() http.Handler {
	mux := http.NewServeMux()

	// API routes
	mux.HandleFunc("/api/events", s.handleSSE)
	mux.HandleFunc("/api/info", s.handleInfo)
	mux.HandleFunc("/api/config", s.handleConfig)
	mux.HandleFunc("/api/config/test", s.handleTestConfig)
	mux.HandleFunc("/api/records", s.handleRecords)
	mux.HandleFunc("/api/records/detail", s.handleRecordDetail)
	mux.HandleFunc("/api/records/star", s.handleStarRecord)
	mux.HandleFunc("/api/records/organize", s.handleOrganizeRecords)
	mux.HandleFunc("/api/records/cancel", s.handleCancelRecord)
	mux.HandleFunc("/api/records/batch-delete", s.handleBatchDeleteRecords)
	mux.HandleFunc("/api/records/download", s.handleDownloadRecord)
	mux.HandleFunc("/api/records/export-zip", s.handleExportZip)
	mux.HandleFunc("/api/cache/clean-refs", s.handleCleanRefCache)
	mux.HandleFunc("/api/upload-ref", s.handleUploadRef)
	mux.HandleFunc("/api/open-folder", s.handleOpenFolder)
	mux.HandleFunc("/api/generate", s.handleGenerate)
	mux.HandleFunc("/api/tasks/query", s.handleQueryTask)

	// Portable diagnostic logging routes
	mux.HandleFunc("/api/logs", s.handleLogs)
	mux.HandleFunc("/api/logs/download", s.handleDownloadLogs)
	mux.HandleFunc("/api/logs/client", s.handleClientLog)
	mux.HandleFunc("/api/logs/clear", s.handleClearLogs)

	// Serve locally cached thumbnails from duomi_data/thumbs/ and full originals from duomi_data/images/
	mux.HandleFunc("/thumbs/", s.handleServeThumb)
	mux.HandleFunc("/images/", s.handleServeImage)

	// Serve embedded web frontend
	webSub, err := fs.Sub(embeddedWebFS, "web")
	if err != nil {
		log.Fatalf("加载内嵌 Web 资源失败: %v", err)
	}
	fileServer := http.FileServer(http.FS(webSub))
	mux.Handle("/", fileServer)

	return s.recoverMiddleware(mux)
}

func (s *AppServer) handleSSE(w http.ResponseWriter, r *http.Request) {
	flusher, ok := w.(http.Flusher)
	if !ok {
		writeJSONError(w, http.StatusInternalServerError, "Streaming unsupported")
		return
	}

	w.Header().Set("Content-Type", "text/event-stream")
	w.Header().Set("Cache-Control", "no-cache")
	w.Header().Set("Connection", "keep-alive")
	w.Header().Set("X-Accel-Buffering", "no")

	ch := make(chan []byte, 48)
	s.sseMu.Lock()
	if s.sseClients == nil {
		s.sseClients = make(map[chan []byte]struct{})
	}
	s.sseClients[ch] = struct{}{}
	s.sseMu.Unlock()

	defer func() {
		s.sseMu.Lock()
		delete(s.sseClients, ch)
		s.sseMu.Unlock()
	}()

	initMsg, _ := json.Marshal(sseEvent{
		Type: "connected",
		Payload: map[string]any{
			"ts":         time.Now().Unix(),
			"disk_stats": s.store.DiskStats(),
		},
	})
	fmt.Fprintf(w, "data: %s\n\n", initMsg)
	flusher.Flush()

	ticker := time.NewTicker(20 * time.Second)
	defer ticker.Stop()

	for {
		select {
		case <-r.Context().Done():
			return
		case msg := <-ch:
			fmt.Fprintf(w, "data: %s\n\n", msg)
			flusher.Flush()
		case <-ticker.C:
			fmt.Fprintf(w, ": heartbeat %d\n\n", time.Now().Unix())
			flusher.Flush()
		}
	}
}

func (s *AppServer) handleInfo(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		writeJSONError(w, http.StatusMethodNotAllowed, "仅支持 GET")
		return
	}
	cfg := s.store.GetConfig()
	writeJSON(w, http.StatusOK, map[string]any{
		"version":           AppVersion,
		"data_dir":          s.store.BaseDir(),
		"images_dir":        s.store.ImagesDir(),
		"thumbs_dir":        s.store.ThumbsDir(),
		"logs_dir":          s.store.LogsDir(),
		"has_key":           strings.TrimSpace(cfg.APIKey) != "",
		"disk_stats":        s.store.DiskStats(),
		"ratio_presets":     GetRatioPresets(),
		"builtin_templates": DefaultBuiltInTemplates(),
		"image_hosts": []map[string]string{
			{"id": "auto", "name": "自动容灾 (推荐)", "desc": "按优先级自动尝试可用图床节点，原图无损直链"},
			{"id": "litterbox", "name": "Litterbox 临时隐私图床", "desc": "到期自动销毁（可选 1h / 12h / 24h / 72h），保护参考图隐私"},
			{"id": "catbox", "name": "Catbox 图床", "desc": "高速稳定的海外直链图床，支持大图无损上传"},
			{"id": "tmpfiles", "name": "Tmpfiles 临时存储", "desc": "1小时临时直链节点，适合一次性快速生图"},
			{"id": "uguu", "name": "Uguu 极速临时节点", "desc": "轻量免登录临时文件直链"},
			{"id": "0x0", "name": "0x0.st 极简节点", "desc": "开源极简直链托管备用节点"},
			{"id": "custom", "name": "自定义图床 API", "desc": "接入自建兰空 LskyPro / Chevereto / 企业私有图床接口"},
		},
		"models": []map[string]string{
			{
				"id":          "gpt-image-2.6-flare",
				"name":        "GPT-Image 2.6 Flare",
				"badge":       "推荐 · 高速",
				"price":       "0.06 元/次",
				"description": "多米最新高速生图模型，兼顾响应速度与画面细节，支持 1K/2K/4K 与多图参考",
			},
			{
				"id":          "gpt-image-2.6-sunburst",
				"name":        "GPT-Image 2.6 Sunburst",
				"badge":       "旗舰 · 精绘",
				"price":       "0.06 元/次",
				"description": "多米最新旗舰级生图模型，擅长复杂空间透视、人脸一致性与真实摄影质感",
			},
			{
				"id":          "gpt-image-2.5-flare",
				"name":        "GPT-Image 2.5 Flare",
				"badge":       "2倍速",
				"price":       "0.06 元/次",
				"description": "新一代高速模型，生成速度约为 Image 2 的两倍，支持全套预设比例",
			},
			{
				"id":          "gpt-image-2.5-sunburst",
				"name":        "GPT-Image 2.5 Sunburst",
				"badge":       "高级质感",
				"price":       "0.06 元/次",
				"description": "擅长复杂语义理解、材质渲染与艺术风格还原，支持 1K/2K/4K",
			},
			{
				"id":          "gpt-image-2",
				"name":        "GPT-Image 2",
				"badge":       "经典稳定",
				"price":       "0.06 元/次",
				"description": "OpenAI 标准图像生成模型，渠道兼容性强，支持文生图与多参考图",
			},
		},
	})
}

func (s *AppServer) handleConfig(w http.ResponseWriter, r *http.Request) {
	switch r.Method {
	case http.MethodGet:
		cfg := s.store.GetConfig()
		writeJSON(w, http.StatusOK, cfg)

	case http.MethodPost:
		var incoming AppConfig
		if err := json.NewDecoder(r.Body).Decode(&incoming); err != nil {
			writeJSONError(w, http.StatusBadRequest, "解析配置 JSON 失败: "+err.Error())
			return
		}
		if err := s.store.SaveConfig(incoming); err != nil {
			writeJSONError(w, http.StatusInternalServerError, "保存配置失败: "+err.Error())
			return
		}
		saved := s.store.GetConfig()
		if l := s.getLogger(); l != nil {
			l.RegisterSecrets(saved.APIKey, saved.CustomUploadAuthHeader)
			l.Info("server", "已更新配置", map[string]any{
				"base_url":             saved.BaseURL,
				"ref_image_mode":       saved.RefImageMode,
				"image_host_provider":  saved.ImageHostProvider,
				"auto_compat_fallback": saved.AutoCompatFallback,
				"has_api_key":          strings.TrimSpace(saved.APIKey) != "",
			})
		}
		writeJSON(w, http.StatusOK, saved)

	default:
		writeJSONError(w, http.StatusMethodNotAllowed, "Method Not Allowed")
	}
}

func (s *AppServer) handleTestConfig(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writeJSONError(w, http.StatusMethodNotAllowed, "仅支持 POST")
		return
	}
	var body struct {
		APIKey  string `json:"api_key"`
		BaseURL string `json:"base_url"`
	}
	_ = json.NewDecoder(r.Body).Decode(&body)
	cfg := s.store.GetConfig()
	key := NormalizeAPIKey(body.APIKey)
	if key == "" {
		key = cfg.APIKey
	}
	if l := s.getLogger(); l != nil && key != "" {
		l.RegisterSecrets(key)
	}
	baseURL := strings.TrimSpace(body.BaseURL)
	if baseURL == "" {
		baseURL = cfg.BaseURL
	}
	ctx, cancel := context.WithTimeout(r.Context(), 15*time.Second)
	defer cancel()
	res := s.client.TestConnection(ctx, baseURL, key)
	writeJSON(w, http.StatusOK, res)
}

func (s *AppServer) handleRecords(w http.ResponseWriter, r *http.Request) {
	switch r.Method {
	case http.MethodGet:
		q := r.URL.Query()
		limit, _ := strconv.Atoi(strings.TrimSpace(q.Get("limit")))
		offset, _ := strconv.Atoi(strings.TrimSpace(q.Get("offset")))
		if limit < 0 {
			limit = 0
		}
		if limit > 500 {
			limit = 500
		}
		includeRaw := q.Get("include_raw") == "1" || q.Get("include_raw") == "true"
		includeStats := q.Get("include_stats") != "0" && q.Get("include_stats") != "false"

		result := s.store.QueryRecords(RecordQueryOptions{
			Limit:      limit,
			Offset:     offset,
			Status:     q.Get("status"),
			ProjectID:  q.Get("project_id"),
			Model:      q.Get("model"),
			Query:      q.Get("q"),
			IncludeRaw: includeRaw,
		})

		resp := map[string]any{
			"records":         result.Records,
			"total":           result.Total,
			"has_more":        result.HasMore,
			"next_offset":     result.NextOffset,
			"counts":          result.Counts,
			"distinct_models": result.DistinctModels,
		}
		if includeStats {
			resp["disk_stats"] = s.store.DiskStats()
		}
		writeJSON(w, http.StatusOK, resp)

	case http.MethodDelete:
		id := strings.TrimSpace(r.URL.Query().Get("id"))
		if id == "" {
			writeJSONError(w, http.StatusBadRequest, "缺少任务 id 参数")
			return
		}
		_, _ = s.CancelPolling(id)
		delFiles := r.URL.Query().Get("delete_files") == "true"
		if err := s.store.DeleteRecord(id, delFiles); err != nil {
			writeJSONError(w, http.StatusInternalServerError, "删除记录失败: "+err.Error())
			return
		}
		if l := s.getLogger(); l != nil {
			l.Info("server", "删除任务记录", map[string]any{"task_id": id, "delete_files": delFiles})
		}
		s.broadcastSSE("records_deleted", map[string]any{"ids": []string{id}})
		stats := s.store.DiskStats()
		s.broadcastSSE("stats_updated", stats)
		writeJSON(w, http.StatusOK, map[string]any{
			"deleted":    id,
			"disk_stats": stats,
		})

	default:
		writeJSONError(w, http.StatusMethodNotAllowed, "Method Not Allowed")
	}
}

// handleRecordDetail returns the full TaskRecord including raw_response on demand (for Lightbox inspection).
func (s *AppServer) handleRecordDetail(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		writeJSONError(w, http.StatusMethodNotAllowed, "仅支持 GET")
		return
	}
	id := strings.TrimSpace(r.URL.Query().Get("id"))
	if id == "" {
		writeJSONError(w, http.StatusBadRequest, "缺少任务 id 参数")
		return
	}
	rec, ok := s.store.GetRecord(id)
	if !ok {
		writeJSONError(w, http.StatusNotFound, "未找到任务记录")
		return
	}
	writeJSON(w, http.StatusOK, rec)
}

func (s *AppServer) handleStarRecord(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writeJSONError(w, http.StatusMethodNotAllowed, "仅支持 POST")
		return
	}
	var body struct {
		ID      string `json:"id"`
		Starred bool   `json:"starred"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil || strings.TrimSpace(body.ID) == "" {
		writeJSONError(w, http.StatusBadRequest, "缺少任务 ID")
		return
	}
	rec, err := s.store.SetRecordStarred(strings.TrimSpace(body.ID), body.Starred)
	if err != nil {
		writeJSONError(w, http.StatusNotFound, err.Error())
		return
	}
	slim := SlimTaskRecord(rec)
	s.broadcastSSE("record_updated", slim)
	writeJSON(w, http.StatusOK, slim)
}

func (s *AppServer) handleOrganizeRecords(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writeJSONError(w, http.StatusMethodNotAllowed, "仅支持 POST")
		return
	}
	var body struct {
		IDs       []string  `json:"ids"`
		ProjectID *string   `json:"project_id"`
		Starred   *bool     `json:"starred"`
		Tags      *[]string `json:"tags"`
		Note      *string   `json:"note"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil || len(body.IDs) == 0 {
		writeJSONError(w, http.StatusBadRequest, "缺少任务 IDs")
		return
	}
	updated, err := s.store.OrganizeRecords(body.IDs, body.ProjectID, body.Starred, body.Tags, body.Note)
	if err != nil {
		writeJSONError(w, http.StatusInternalServerError, err.Error())
		return
	}
	slimmed := make([]*TaskRecord, 0, len(updated))
	for _, rec := range updated {
		sr := SlimTaskRecord(rec)
		slimmed = append(slimmed, sr)
		s.broadcastSSE("record_updated", sr)
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"updated_count": len(slimmed),
		"records":       slimmed,
	})
}

func (s *AppServer) handleCleanRefCache(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writeJSONError(w, http.StatusMethodNotAllowed, "仅支持 POST")
		return
	}
	removed, freed, err := s.store.CleanOrphanRefCache()
	if err != nil {
		writeJSONError(w, http.StatusInternalServerError, "清理缓存失败: "+err.Error())
		return
	}
	stats := s.store.DiskStats()
	if l := s.getLogger(); l != nil {
		l.Info("storage", "已清理无引用参考图缓存", map[string]any{"removed_count": removed, "freed_bytes": freed})
	}
	s.broadcastSSE("stats_updated", stats)
	writeJSON(w, http.StatusOK, map[string]any{
		"removed_count": removed,
		"freed_bytes":   freed,
		"disk_stats":    stats,
	})
}

func (s *AppServer) handleCancelRecord(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writeJSONError(w, http.StatusMethodNotAllowed, "仅支持 POST")
		return
	}
	var body struct {
		ID string `json:"id"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil || strings.TrimSpace(body.ID) == "" {
		writeJSONError(w, http.StatusBadRequest, "缺少任务 ID")
		return
	}
	rec, err := s.CancelPolling(strings.TrimSpace(body.ID))
	if err != nil {
		writeJSONError(w, http.StatusNotFound, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, SlimTaskRecord(rec))
}

func (s *AppServer) handleBatchDeleteRecords(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writeJSONError(w, http.StatusMethodNotAllowed, "仅支持 POST")
		return
	}
	var body struct {
		IDs         []string `json:"ids"`
		ClearFailed bool     `json:"clear_failed"`
		DeleteFiles bool     `json:"delete_files"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeJSONError(w, http.StatusBadRequest, "解析请求失败: "+err.Error())
		return
	}

	if body.ClearFailed {
		removedIDs, err := s.store.ClearFailedRecords(body.DeleteFiles)
		if err != nil {
			writeJSONError(w, http.StatusInternalServerError, err.Error())
			return
		}
		stats := s.store.DiskStats()
		if len(removedIDs) > 0 {
			s.broadcastSSE("records_deleted", map[string]any{"ids": removedIDs})
			s.broadcastSSE("stats_updated", stats)
		}
		writeJSON(w, http.StatusOK, map[string]any{
			"deleted_count": len(removedIDs),
			"ids":           removedIDs,
			"disk_stats":    stats,
		})
		return
	}

	for _, id := range body.IDs {
		_, _ = s.CancelPolling(id)
	}
	count, err := s.store.BatchDeleteRecords(body.IDs, body.DeleteFiles)
	if err != nil {
		writeJSONError(w, http.StatusInternalServerError, err.Error())
		return
	}
	stats := s.store.DiskStats()
	if count > 0 {
		s.broadcastSSE("records_deleted", map[string]any{"ids": body.IDs})
		s.broadcastSSE("stats_updated", stats)
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"deleted_count": count,
		"disk_stats":    stats,
	})
}

// handleUploadRef handles local reference image processing for all 3 modes:
// - "upload" (default): saves a deduplicated copy in duomi_data/images/refs/ AND uploads lossless original bytes to image host -> returns https:// URL
// - "compress_base64" (optional): saves local ref copy AND compresses to clean JPEG Base64 locally without touching any external image host
// - "raw_base64" (optional): saves local ref copy AND returns raw original data:image/...;base64 without compression or external upload
func (s *AppServer) handleUploadRef(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writeJSONError(w, http.StatusMethodNotAllowed, "仅支持 POST")
		return
	}
	r.Body = http.MaxBytesReader(w, r.Body, 40<<20) // up to 40MB original photo

	cfg := s.store.GetConfig()
	mode := cfg.RefImageMode
	hostOpts := ImageHostOptionsFromConfig(cfg)
	maxDim := cfg.CompressMaxDim
	quality := cfg.CompressQuality

	var rawBytes []byte
	var ext string
	var existingLocalRef string

	ct := strings.ToLower(r.Header.Get("Content-Type"))
	if strings.HasPrefix(ct, "multipart/form-data") {
		if err := r.ParseMultipartForm(40 << 20); err != nil {
			writeJSONError(w, http.StatusBadRequest, "解析上传文件失败: "+err.Error())
			return
		}
		if m := strings.TrimSpace(r.FormValue("mode")); m != "" {
			mode = m
		}
		if p := strings.TrimSpace(r.FormValue("provider")); p != "" {
			hostOpts.Provider = p
		}
		if exp := strings.TrimSpace(r.FormValue("litterbox_expiry")); exp != "" {
			hostOpts.LitterboxExpiry = exp
		}
		if d, err := strconv.Atoi(r.FormValue("compress_max_dim")); err == nil && d >= 256 {
			maxDim = d
		}
		if q, err := strconv.Atoi(r.FormValue("compress_quality")); err == nil && q >= 40 && q <= 98 {
			quality = q
		}

		file, header, err := r.FormFile("file")
		if err != nil {
			writeJSONError(w, http.StatusBadRequest, "缺少上传图片文件 (file): "+err.Error())
			return
		}
		defer file.Close()
		data, err := io.ReadAll(file)
		if err != nil || len(data) == 0 {
			writeJSONError(w, http.StatusBadRequest, "读取上传图片字节失败")
			return
		}
		rawBytes = data
		ext = strings.ToLower(filepath.Ext(header.Filename))
		if ext == "" {
			ext = detectImageExt("", header.Filename, header.Header.Get("Content-Type"))
		}
	} else {
		var body struct {
			DataURI         string `json:"data_uri"`
			LocalRef        string `json:"local_ref"`         // e.g. "refs/ref_xxx.jpg" or generated image filename
			SourceLocalFile string `json:"source_local_file"` // e.g. "20261110_xxx.png" from gallery
			Mode            string `json:"mode"`
			Provider        string `json:"provider"`
			LitterboxExpiry string `json:"litterbox_expiry"`
			CompressMaxDim  int    `json:"compress_max_dim"`
			CompressQuality int    `json:"compress_quality"`
		}
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			writeJSONError(w, http.StatusBadRequest, "解析 JSON 请求失败: "+err.Error())
			return
		}
		if strings.TrimSpace(body.Mode) != "" {
			mode = strings.TrimSpace(body.Mode)
		}
		if strings.TrimSpace(body.Provider) != "" {
			hostOpts.Provider = strings.TrimSpace(body.Provider)
		}
		if strings.TrimSpace(body.LitterboxExpiry) != "" {
			hostOpts.LitterboxExpiry = strings.TrimSpace(body.LitterboxExpiry)
		}
		if body.CompressMaxDim >= 256 {
			maxDim = body.CompressMaxDim
		}
		if body.CompressQuality >= 40 && body.CompressQuality <= 98 {
			quality = body.CompressQuality
		}

		refCandidate := strings.TrimSpace(body.LocalRef)
		if refCandidate == "" {
			refCandidate = strings.TrimSpace(body.SourceLocalFile)
		}
		if refCandidate != "" {
			fullPath, safeErr := resolveSafeImagePath(s.store.ImagesDir(), refCandidate)
			if safeErr != nil {
				writeJSONError(w, http.StatusBadRequest, safeErr.Error())
				return
			}
			data, readErr := os.ReadFile(fullPath)
			if readErr != nil {
				writeJSONError(w, http.StatusNotFound, "本地缓存参考图不存在: "+readErr.Error())
				return
			}
			rawBytes = data
			ext = filepath.Ext(fullPath)
			if strings.HasPrefix(filepath.ToSlash(refCandidate), "refs/") {
				existingLocalRef = filepath.ToSlash(refCandidate)
			}
		} else if strings.TrimSpace(body.DataURI) != "" {
			decoded, dExt, decErr := DecodeDataURI(body.DataURI)
			if decErr != nil {
				writeJSONError(w, http.StatusBadRequest, decErr.Error())
				return
			}
			rawBytes = decoded
			ext = dExt
		} else {
			writeJSONError(w, http.StatusBadRequest, "缺少图片数据 (file / local_ref / data_uri)")
			return
		}
	}

	if existingLocalRef == "" {
		savedRef, saveErr := s.store.SaveRefImageBytes(rawBytes, ext)
		if saveErr == nil {
			existingLocalRef = savedRef
			if tc := s.getThumbs(); tc != nil {
				tc.PrewarmAsync(existingLocalRef)
			}
			s.broadcastSSE("stats_updated", s.store.DiskStats())
		}
	}

	var origW, origH int
	if existingLocalRef != "" {
		if fullRef, err := resolveSafeImagePath(s.store.ImagesDir(), existingLocalRef); err == nil {
			origW, origH, _ = InspectImageFileMetadata(fullRef)
		}
	}

	previewURL := ""
	if existingLocalRef != "" {
		previewURL = "/images/" + existingLocalRef
	}

	switch mode {
	case "compress_base64":
		dataURI, outBytes, outW, outH, err := CompressImageBytesToBase64(rawBytes, maxDim, quality)
		if err != nil {
			writeJSONError(w, http.StatusInternalServerError, err.Error())
			return
		}
		writeJSON(w, http.StatusOK, map[string]any{
			"mode":        "compress_base64",
			"value":       dataURI,
			"local_ref":   existingLocalRef,
			"preview_url": previewURL,
			"size_bytes":  outBytes,
			"orig_bytes":  len(rawBytes),
			"width":       outW,
			"height":      outH,
			"label":       fmt.Sprintf("压缩 Base64 · %dKB", maxInt(1, outBytes/1024)),
		})
		return

	case "raw_base64":
		dataURI := EncodeBytesToDataURI(rawBytes, ext)
		writeJSON(w, http.StatusOK, map[string]any{
			"mode":        "raw_base64",
			"value":       dataURI,
			"local_ref":   existingLocalRef,
			"preview_url": previewURL,
			"size_bytes":  len(rawBytes),
			"orig_bytes":  len(rawBytes),
			"width":       origW,
			"height":      origH,
			"label":       fmt.Sprintf("原图 Base64 · %dKB", maxInt(1, len(rawBytes)/1024)),
		})
		return

	default: // "upload" (default: lossless upload to image host)
		ctx, cancel := context.WithTimeout(r.Context(), 60*time.Second)
		defer cancel()
		pubURL, providerName, err := s.client.UploadBytesToImageHost(ctx, rawBytes, ext, hostOpts)
		if err != nil {
			writeJSON(w, http.StatusBadGateway, map[string]any{
				"error":       err.Error(),
				"local_ref":   existingLocalRef,
				"preview_url": previewURL,
				"orig_bytes":  len(rawBytes),
				"width":       origW,
				"height":      origH,
			})
			return
		}
		writeJSON(w, http.StatusOK, map[string]any{
			"mode":        "upload",
			"url":         pubURL,
			"value":       pubURL,
			"provider":    providerName,
			"local_ref":   existingLocalRef,
			"preview_url": previewURL,
			"size_bytes":  len(rawBytes),
			"orig_bytes":  len(rawBytes),
			"width":       origW,
			"height":      origH,
			"label":       fmt.Sprintf("图床直链 · %s", providerName),
		})
	}
}

type generateRefItemInput struct {
	Value     string `json:"value"`
	LocalRef  string `json:"local_ref"`
	RemoteURL string `json:"remote_url"`
	Mode      string `json:"mode"`
	Provider  string `json:"provider"`
	Label     string `json:"label"`
}

type generateAPIRequest struct {
	APIKey             string                 `json:"api_key"`
	ProjectID          string                 `json:"project_id"`
	Tags               []string               `json:"tags"`
	Model              string                 `json:"model"`
	Prompt             string                 `json:"prompt"`
	Size               string                 `json:"size"`
	Image              []string               `json:"image"`
	RefMode            string                 `json:"ref_mode"`
	RefItems           []generateRefItemInput `json:"ref_items"`
	Quality            string                 `json:"quality"`
	Background         string                 `json:"background"`
	N                  int                    `json:"n"`
	Oversea            *bool                  `json:"oversea"`
	AutoCompatFallback *bool                  `json:"auto_compat_fallback"`
	CallbackURL        string                 `json:"callback_url"`
}

func (s *AppServer) handleGenerate(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writeJSONError(w, http.StatusMethodNotAllowed, "仅支持 POST")
		return
	}

	logger := s.getLogger()
	r.Body = http.MaxBytesReader(w, r.Body, 48<<20)

	var req generateAPIRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		if logger != nil {
			logger.Warn("server", "解析 /api/generate 请求体失败", map[string]any{"error": err.Error()})
		}
		writeJSONError(w, http.StatusBadRequest, "请求格式错误: "+err.Error())
		return
	}

	cfg := s.store.GetConfig()
	apiKey := NormalizeAPIKey(req.APIKey)
	if apiKey == "" {
		apiKey = cfg.APIKey
	} else if cfg.APIKey == "" {
		cfg.APIKey = apiKey
		_ = s.store.SaveConfig(cfg)
	}

	if apiKey == "" {
		writeJSONError(w, http.StatusBadRequest, "未配置 API Key，请先在设置中填写多米 API 密钥")
		return
	}
	if logger != nil {
		logger.RegisterSecrets(apiKey)
	}

	promptText := strings.TrimSpace(req.Prompt)
	if promptText == "" {
		writeJSONError(w, http.StatusBadRequest, "请输入画面描述词 (Prompt)")
		return
	}
	modelID := strings.TrimSpace(req.Model)
	if modelID == "" {
		modelID = cfg.DefaultModel
	}
	if modelID == "" {
		modelID = "gpt-image-2.6-flare"
	}
	sizeStr := strings.TrimSpace(req.Size)
	qualityStr := strings.TrimSpace(req.Quality)
	if qualityStr == "default" {
		qualityStr = ""
	}
	bgStr := strings.TrimSpace(req.Background)

	oversea := cfg.Oversea
	if req.Oversea != nil {
		oversea = *req.Oversea
	}
	compatFallback := cfg.AutoCompatFallback
	if req.AutoCompatFallback != nil {
		compatFallback = *req.AutoCompatFallback
	}
	refMode := strings.TrimSpace(req.RefMode)
	if refMode == "" {
		refMode = cfg.RefImageMode
	}
	projectID := strings.TrimSpace(req.ProjectID)
	hostOpts := ImageHostOptionsFromConfig(cfg)

	var cleanedImages []string
	var previews []string
	var savedRefs []SavedRefImage

	if len(req.RefItems) > 0 {
		for _, item := range req.RefItems {
			val := strings.TrimSpace(item.Value)
			localRef := strings.TrimSpace(item.LocalRef)
			sr := SavedRefImage{
				LocalRef:  localRef,
				RemoteURL: strings.TrimSpace(item.RemoteURL),
				Mode:      strings.TrimSpace(item.Mode),
				Provider:  strings.TrimSpace(item.Provider),
				Label:     strings.TrimSpace(item.Label),
			}
			// If value was lost/empty but local_ref exists on disk, recover it cleanly on server
			if val == "" && localRef != "" {
				if fullRef, safeErr := resolveSafeImagePath(s.store.ImagesDir(), localRef); safeErr == nil {
					if rawBytes, readErr := os.ReadFile(fullRef); readErr == nil && len(rawBytes) > 0 {
						ext := filepath.Ext(fullRef)
						switch refMode {
						case "compress_base64":
							if uri, _, _, _, cErr := CompressImageBytesToBase64(rawBytes, cfg.CompressMaxDim, cfg.CompressQuality); cErr == nil {
								val = uri
								sr.Mode = "compress_base64"
							}
						case "raw_base64":
							val = EncodeBytesToDataURI(rawBytes, ext)
							sr.Mode = "raw_base64"
						default:
							upCtx, upCancel := context.WithTimeout(r.Context(), 45*time.Second)
							pubURL, prov, upErr := s.client.UploadBytesToImageHost(upCtx, rawBytes, ext, hostOpts)
							upCancel()
							if upErr == nil && pubURL != "" {
								val = pubURL
								sr.RemoteURL = pubURL
								sr.Provider = prov
								sr.Mode = "upload"
							}
						}
					}
				}
			}
			if val == "" {
				continue
			}
			cleanedImages = append(cleanedImages, val)
			if sr.RemoteURL == "" && (strings.HasPrefix(val, "http://") || strings.HasPrefix(val, "https://")) {
				sr.RemoteURL = val
			}
			savedRefs = append(savedRefs, sr)
			if sr.LocalRef != "" {
				previews = append(previews, "/images/"+sr.LocalRef)
			} else if sr.RemoteURL != "" {
				previews = append(previews, sr.RemoteURL)
			} else {
				previews = append(previews, "本地参考图 (Base64)")
			}
		}
	} else {
		for _, img := range req.Image {
			trimmed := strings.TrimSpace(img)
			if trimmed == "" {
				continue
			}
			cleanedImages = append(cleanedImages, trimmed)
			if strings.HasPrefix(trimmed, "http://") || strings.HasPrefix(trimmed, "https://") {
				previews = append(previews, trimmed)
				savedRefs = append(savedRefs, SavedRefImage{
					RemoteURL: trimmed,
					Mode:      "url",
					Label:     "直链 URL",
				})
			} else if strings.HasPrefix(trimmed, "data:image/") {
				previews = append(previews, "本地参考图 (Base64)")
				savedRefs = append(savedRefs, SavedRefImage{
					Mode:  refMode,
					Label: "Base64 参考图",
				})
			}
		}
	}

	batchCount := req.N
	if batchCount < 1 {
		batchCount = 1
	} else if batchCount > 10 {
		batchCount = 10
	}

	batchID := ""
	if batchCount > 1 {
		batchID = fmt.Sprintf("batch_%d", time.Now().UnixNano())
	}

	// Immutable snapshot of tags so concurrent slots never mutate shared backing array
	tagsSnapshot := append([]string(nil), req.Tags...)

	if logger != nil {
		logger.Info("server", "收到生图请求 /api/generate", map[string]any{
			"model":        modelID,
			"size":         sizeStr,
			"quality":      qualityStr,
			"background":   bgStr,
			"batch_count":  batchCount,
			"batch_id":     batchID,
			"ref_mode":     refMode,
			"ref_count":    len(cleanedImages),
			"prompt_chars": len([]rune(promptText)),
			"prompt_head":  truncateUTF8Bytes(promptText, 120),
		})
	}

	ctx, cancel := context.WithTimeout(r.Context(), 180*time.Second)
	defer cancel()

	type slotResult struct {
		rec *TaskRecord
		err error
	}
	results := make([]slotResult, batchCount)
	sem := make(chan struct{}, 4) // up to 4 concurrent submissions
	var wg sync.WaitGroup

	for idx := 0; idx < batchCount; idx++ {
		wg.Add(1)
		go func(slot int) {
			defer wg.Done()
			defer func() {
				if rv := recover(); rv != nil {
					if logger != nil {
						logger.Error("server", fmt.Sprintf("并发提交通道 #%d 异常: %v", slot+1, rv), nil, string(debug.Stack()))
					}
					results[slot] = slotResult{err: fmt.Errorf("提交任务内部异常: %v", rv)}
				}
			}()
			sem <- struct{}{}
			defer func() { <-sem }()

			// Build an isolated per-slot request copy so concurrent goroutines share zero slices or structs
			slotImages := append([]string(nil), cleanedImages...)
			slotCreateReq := CreateImageRequest{
				Model:                 modelID,
				Prompt:                promptText,
				Size:                  sizeStr,
				Image:                 slotImages,
				Quality:               qualityStr,
				Background:            bgStr,
				N:                     1,
				Oversea:               oversea,
				CallbackURL:           req.CallbackURL,
				RefMode:               refMode,
				HostOpts:              hostOpts,
				DisableCompatFallback: !compatFallback,
			}

			slotCtx, slotCancel := context.WithTimeout(ctx, 65*time.Second)
			res, err := s.client.CreateTaskDetailed(slotCtx, cfg.BaseURL, apiKey, slotCreateReq)
			slotCancel()
			if err != nil {
				results[slot] = slotResult{err: err}
				return
			}

			now := time.Now().Unix()
			actualSize := res.ActualSize
			if actualSize == "" {
				actualSize = slotCreateReq.Size
			}
			actualModel := res.ActualModel
			if actualModel == "" {
				actualModel = slotCreateReq.Model
			}

			slotPreviews := append([]string(nil), previews...)
			slotRefItems := append([]SavedRefImage(nil), savedRefs...)
			slotTags := append([]string(nil), tagsSnapshot...)

			rec := &TaskRecord{
				ID:          res.TaskID,
				BatchID:     batchID,
				ProjectID:   projectID,
				Tags:        slotTags,
				Model:       actualModel,
				Prompt:      slotCreateReq.Prompt,
				Size:        actualSize,
				Quality:     slotCreateReq.Quality,
				Background:  slotCreateReq.Background,
				N:           1,
				Oversea:     slotCreateReq.Oversea,
				CallbackURL: slotCreateReq.CallbackURL,
				RefMode:     refMode,
				RefCount:    len(slotImages),
				RefPreviews: slotPreviews,
				RefItems:    slotRefItems,
				State:       "pending",
				Progress:    0,
				WarningMsg:  res.WarningMsg,
				CreateTime:  now,
				UpdateTime:  now,
				RawResponse: res.RawResponse,
			}

			// Handle rare synchronous response with inline images gracefully
			if len(res.InlineImages) > 0 {
				var savedImgs []SavedImage
				for iIdx, item := range res.InlineImages {
					saved := SavedImage{RemoteURL: item.URL, FileName: item.FileName}
					if cfg.AutoDownload {
						dlCtx, dlCancel := context.WithTimeout(context.Background(), 60*time.Second)
						if item.URL != "" {
							if localName, dlErr := s.client.DownloadImage(dlCtx, item.URL, s.store.ImagesDir(), res.TaskID, iIdx, item.FileName); dlErr == nil {
								saved.LocalFile = localName
							}
						} else if item.B64JSON != "" {
							if localName, b64Err := SaveBase64Image(item.B64JSON, s.store.ImagesDir(), res.TaskID, iIdx); b64Err == nil {
								saved.LocalFile = localName
							}
						}
						dlCancel()
					}
					if saved.LocalFile != "" {
						w, h, sz := InspectImageFileMetadata(filepath.Join(s.store.ImagesDir(), filepath.Base(saved.LocalFile)))
						saved.Width, saved.Height, saved.SizeBytes = w, h, sz
						if tc := s.getThumbs(); tc != nil {
							tc.PrewarmAsync(filepath.Base(saved.LocalFile))
						}
					}
					savedImgs = append(savedImgs, saved)
				}
				rec.State = "succeeded"
				rec.Progress = 100
				rec.Images = savedImgs
				s.store.InvalidateDiskStats()
			}

			if saveErr := s.store.UpsertRecord(rec); saveErr != nil {
				results[slot] = slotResult{err: fmt.Errorf("保存任务记录失败: %w", saveErr)}
				return
			}
			slim := SlimTaskRecord(rec)
			s.broadcastSSE("record_updated", slim)
			if rec.State != "succeeded" {
				s.StartPolling(res.TaskID)
			} else {
				s.broadcastSSE("stats_updated", s.store.DiskStats())
			}
			results[slot] = slotResult{rec: slim}
		}(idx)
	}
	wg.Wait()

	var createdRecords []*TaskRecord
	var lastErr error
	for _, item := range results {
		if item.rec != nil {
			createdRecords = append(createdRecords, item.rec)
		} else if item.err != nil {
			lastErr = item.err
		}
	}

	if len(createdRecords) == 0 {
		errMsg := "创建任务失败"
		if lastErr != nil {
			errMsg = lastErr.Error()
		}
		if logger != nil {
			logger.Error("server", "批量生图提交全部失败", map[string]any{
				"model": modelID,
				"size":  sizeStr,
				"n":     batchCount,
				"error": errMsg,
			}, "")
		}
		writeJSONError(w, http.StatusBadGateway, errMsg)
		return
	}

	first := createdRecords[0]
	respPayload := map[string]any{
		"id":              first.ID,
		"batch_id":        batchID,
		"model":           first.Model,
		"prompt":          first.Prompt,
		"size":            first.Size,
		"state":           first.State,
		"warning_msg":     first.WarningMsg,
		"create_time":     first.CreateTime,
		"submitted_count": len(createdRecords),
		"records":         createdRecords,
	}
	if lastErr != nil {
		respPayload["partial_error"] = lastErr.Error()
	}
	writeJSON(w, http.StatusOK, respPayload)
}

func (s *AppServer) handleQueryTask(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writeJSONError(w, http.StatusMethodNotAllowed, "仅支持 POST")
		return
	}
	var body struct {
		TaskID string `json:"task_id"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeJSONError(w, http.StatusBadRequest, "解析请求失败: "+err.Error())
		return
	}
	taskID := strings.TrimSpace(body.TaskID)
	if taskID == "" {
		writeJSONError(w, http.StatusBadRequest, "请输入任务 ID (task_id)")
		return
	}

	ctx, cancel := context.WithTimeout(r.Context(), 60*time.Second)
	defer cancel()

	rec, done, err := s.SyncTaskOnce(ctx, taskID, true)
	if err != nil {
		writeJSONError(w, http.StatusBadGateway, err.Error())
		return
	}
	if !done {
		s.StartPolling(taskID)
	}
	writeJSON(w, http.StatusOK, SlimTaskRecord(rec))
}

func (s *AppServer) handleDownloadRecord(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writeJSONError(w, http.StatusMethodNotAllowed, "仅支持 POST")
		return
	}
	var body struct {
		ID string `json:"id"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil || strings.TrimSpace(body.ID) == "" {
		writeJSONError(w, http.StatusBadRequest, "缺少任务 ID")
		return
	}

	rec, ok := s.store.GetRecord(strings.TrimSpace(body.ID))
	if !ok {
		writeJSONError(w, http.StatusNotFound, "未找到该任务记录")
		return
	}

	ctx, cancel := context.WithTimeout(r.Context(), 120*time.Second)
	defer cancel()

	for i := range rec.Images {
		if rec.Images[i].RemoteURL == "" {
			continue
		}
		needDownload := rec.Images[i].LocalFile == ""
		if !needDownload {
			if _, err := os.Stat(filepath.Join(s.store.ImagesDir(), filepath.Base(rec.Images[i].LocalFile))); err != nil {
				needDownload = true
			}
		}
		if needDownload {
			localName, err := s.client.DownloadImage(ctx, rec.Images[i].RemoteURL, s.store.ImagesDir(), rec.ID, i, rec.Images[i].FileName)
			if err != nil {
				writeJSONError(w, http.StatusBadGateway, "下载图片失败: "+err.Error())
				return
			}
			rec.Images[i].LocalFile = localName
		}
		if rec.Images[i].LocalFile != "" {
			iw, ih, sz := InspectImageFileMetadata(filepath.Join(s.store.ImagesDir(), filepath.Base(rec.Images[i].LocalFile)))
			rec.Images[i].Width = iw
			rec.Images[i].Height = ih
			rec.Images[i].SizeBytes = sz
			if tc := s.getThumbs(); tc != nil {
				tc.PrewarmAsync(filepath.Base(rec.Images[i].LocalFile))
			}
		}
	}
	rec.UpdateTime = time.Now().Unix()
	_ = s.store.UpsertRecord(rec)
	s.store.InvalidateDiskStats()
	slim := SlimTaskRecord(rec)
	s.broadcastSSE("record_updated", slim)
	s.broadcastSSE("stats_updated", s.store.DiskStats())
	writeJSON(w, http.StatusOK, slim)
}

func (s *AppServer) handleExportZip(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		writeJSONError(w, http.StatusMethodNotAllowed, "仅支持 GET")
		return
	}
	idsParam := strings.TrimSpace(r.URL.Query().Get("ids"))
	projectFilter := strings.TrimSpace(r.URL.Query().Get("project_id"))
	starredOnly := r.URL.Query().Get("starred") == "true"

	wanted := make(map[string]bool)
	if idsParam != "" {
		for _, part := range strings.Split(idsParam, ",") {
			if trimmed := strings.TrimSpace(part); trimmed != "" {
				wanted[trimmed] = true
			}
		}
	}

	allRecords := s.store.ListRecords()
	var selected []*TaskRecord
	for _, rec := range allRecords {
		if len(wanted) > 0 {
			if wanted[rec.ID] {
				selected = append(selected, rec)
			}
			continue
		}
		if rec.State != "succeeded" || len(rec.Images) == 0 {
			continue
		}
		if projectFilter != "" && rec.ProjectID != projectFilter {
			continue
		}
		if starredOnly && !rec.Starred {
			continue
		}
		selected = append(selected, rec)
	}
	if len(selected) == 0 {
		writeJSONError(w, http.StatusBadRequest, "没有可导出的已完成图片记录")
		return
	}

	zipName := fmt.Sprintf("duomi_images_%s.zip", time.Now().Format("20060102_150405"))
	w.Header().Set("Content-Type", "application/zip")
	w.Header().Set("Content-Disposition", fmt.Sprintf("attachment; filename=%q", zipName))

	zw := zip.NewWriter(w)
	defer zw.Close()

	usedNames := make(map[string]int)
	for _, rec := range selected {
		for _, img := range rec.Images {
			if img.LocalFile == "" {
				continue
			}
			cleanName := filepath.Base(img.LocalFile)
			fullPath := filepath.Join(s.store.ImagesDir(), cleanName)
			f, err := os.Open(fullPath)
			if err != nil {
				continue
			}
			entryName := cleanName
			if usedNames[entryName] > 0 {
				ext := filepath.Ext(cleanName)
				base := strings.TrimSuffix(cleanName, ext)
				entryName = fmt.Sprintf("%s_%d%s", base, usedNames[entryName]+1, ext)
			}
			usedNames[cleanName]++

			fw, err := zw.Create(entryName)
			if err == nil {
				_, _ = io.Copy(fw, f)
			}
			f.Close()
		}
	}

	if manifestBytes, err := json.MarshalIndent(selected, "", "  "); err == nil {
		if mw, mErr := zw.Create("manifest.json"); mErr == nil {
			_, _ = mw.Write(manifestBytes)
		}
	}
}

func (s *AppServer) handleOpenFolder(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writeJSONError(w, http.StatusMethodNotAllowed, "仅支持 POST")
		return
	}
	var body struct {
		TargetFile string `json:"target_file"` // optional filename inside images/
		TargetDir  string `json:"target_dir"`  // optional: "images" | "logs" | "thumbs" | "data"
	}
	_ = json.NewDecoder(r.Body).Decode(&body)

	targetDir := s.store.ImagesDir()
	switch strings.ToLower(strings.TrimSpace(body.TargetDir)) {
	case "logs":
		targetDir = s.store.LogsDir()
	case "thumbs":
		targetDir = s.store.ThumbsDir()
	case "data", "root":
		targetDir = s.store.BaseDir()
	}

	fullTarget := targetDir
	if strings.TrimSpace(body.TargetFile) != "" {
		if p, err := resolveSafeImagePath(s.store.ImagesDir(), body.TargetFile); err == nil {
			if _, statErr := os.Stat(p); statErr == nil {
				fullTarget = p
				targetDir = s.store.ImagesDir()
			}
		}
	}

	if runtime.GOOS == "linux" && os.Getenv("DISPLAY") == "" && os.Getenv("WAYLAND_DISPLAY") == "" {
		writeJSON(w, http.StatusOK, map[string]any{
			"opened":  false,
			"path":    fullTarget,
			"message": "当前运行在无桌面终端环境，已返回路径供复制",
		})
		return
	}

	var cmd *exec.Cmd
	switch runtime.GOOS {
	case "windows":
		if fullTarget != targetDir {
			cmd = exec.Command("explorer.exe", "/select,", fullTarget)
		} else {
			cmd = exec.Command("explorer.exe", targetDir)
		}
	case "darwin":
		if fullTarget != targetDir {
			cmd = exec.Command("open", "-R", fullTarget)
		} else {
			cmd = exec.Command("open", targetDir)
		}
	default:
		openDir := fullTarget
		if fullTarget != targetDir {
			openDir = filepath.Dir(fullTarget)
		}
		cmd = exec.Command("xdg-open", openDir)
	}

	if err := cmd.Start(); err != nil {
		writeJSON(w, http.StatusOK, map[string]any{
			"opened":  false,
			"path":    fullTarget,
			"message": "无法调用系统资源管理器，已复制目录路径",
		})
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"opened":  true,
		"path":    fullTarget,
		"message": "已在系统资源管理器中打开目录",
	})
}

func (s *AppServer) handleLogs(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		writeJSONError(w, http.StatusMethodNotAllowed, "仅支持 GET")
		return
	}
	l := s.getLogger()
	q := r.URL.Query()
	limit, _ := strconv.Atoi(strings.TrimSpace(q.Get("limit")))
	if limit <= 0 || limit > 1200 {
		limit = 300
	}
	level := q.Get("level")
	source := q.Get("source")
	search := q.Get("q")

	var entries []LogEntry
	var files []LogFileInfo
	logsDir := ""
	if l != nil {
		entries = l.Query(limit, level, source, search)
		files = l.ListFiles()
		logsDir = l.LogsDir()
	}
	if entries == nil {
		entries = []LogEntry{}
	}
	if files == nil {
		files = []LogFileInfo{}
	}

	cfg := s.store.GetConfig()
	header := fmt.Sprintf(
		"=== DuomiAPI Image Studio %s Diagnostic Logs ===\nTime: %s\nPlatform: %s/%s | Go: %s\nBaseURL: %s | RefMode: %s | ImageHost: %s | AutoCompat: %v | HasKey: %v (%s)\nDataDir: %s | LogsDir: %s\nRecords: %d\n================================================\n",
		AppVersion,
		time.Now().Format(time.RFC3339),
		runtime.GOOS, runtime.GOARCH, runtime.Version(),
		cfg.BaseURL, cfg.RefImageMode, cfg.ImageHostProvider, cfg.AutoCompatFallback,
		strings.TrimSpace(cfg.APIKey) != "", MaskSecret(cfg.APIKey),
		s.store.BaseDir(), logsDir,
		s.store.QueryRecords(RecordQueryOptions{Limit: 1}).Counts.All,
	)

	writeJSON(w, http.StatusOK, map[string]any{
		"version":    AppVersion,
		"platform":   runtime.GOOS + "/" + runtime.GOARCH,
		"logs_dir":   logsDir,
		"entries":    entries,
		"files":      files,
		"plain_text": header + FormatLogEntriesPlainText(entries),
	})
}

func (s *AppServer) handleDownloadLogs(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		writeJSONError(w, http.StatusMethodNotAllowed, "仅支持 GET")
		return
	}
	l := s.getLogger()
	if l == nil {
		writeJSONError(w, http.StatusNotFound, "日志系统未初始化")
		return
	}
	fileName := strings.TrimSpace(r.URL.Query().Get("file"))
	if fileName != "" {
		data, err := l.ReadLogFile(fileName)
		if err != nil {
			writeJSONError(w, http.StatusNotFound, "读取日志文件失败: "+err.Error())
			return
		}
		w.Header().Set("Content-Type", "text/plain; charset=utf-8")
		w.Header().Set("Content-Disposition", fmt.Sprintf("attachment; filename=%q", filepath.Base(fileName)))
		_, _ = w.Write(data)
		return
	}

	entries := l.Query(1000, "", "", "")
	cfg := s.store.GetConfig()
	header := fmt.Sprintf(
		"=== DuomiAPI Image Studio %s Diagnostic Export ===\nTime: %s | Platform: %s/%s\nBaseURL: %s | RefMode: %s | ImageHost: %s | HasKey: %v (%s)\n===================================================\n",
		AppVersion,
		time.Now().Format(time.RFC3339),
		runtime.GOOS, runtime.GOARCH,
		cfg.BaseURL, cfg.RefImageMode, cfg.ImageHostProvider,
		strings.TrimSpace(cfg.APIKey) != "", MaskSecret(cfg.APIKey),
	)
	outName := fmt.Sprintf("duomi-studio-logs-%s.log", time.Now().Format("20060102-150405"))
	w.Header().Set("Content-Type", "text/plain; charset=utf-8")
	w.Header().Set("Content-Disposition", fmt.Sprintf("attachment; filename=%q", outName))
	_, _ = w.Write([]byte(header + FormatLogEntriesPlainText(entries)))
}

func (s *AppServer) handleClientLog(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writeJSONError(w, http.StatusMethodNotAllowed, "仅支持 POST")
		return
	}
	r.Body = http.MaxBytesReader(w, r.Body, 256<<10)
	var body struct {
		Level   string         `json:"level"`
		Source  string         `json:"source"`
		Message string         `json:"message"`
		Fields  map[string]any `json:"fields"`
		Stack   string         `json:"stack"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeJSONError(w, http.StatusBadRequest, "无效的日志请求")
		return
	}
	msg := strings.TrimSpace(body.Message)
	if msg == "" {
		writeJSON(w, http.StatusOK, map[string]any{"ok": true})
		return
	}
	src := strings.TrimSpace(body.Source)
	if src == "" {
		src = "frontend"
	}
	if l := s.getLogger(); l != nil {
		l.Log(body.Level, src, msg, body.Fields, body.Stack)
	}
	writeJSON(w, http.StatusOK, map[string]any{"ok": true})
}

func (s *AppServer) handleClearLogs(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writeJSONError(w, http.StatusMethodNotAllowed, "仅支持 POST")
		return
	}
	if l := s.getLogger(); l != nil {
		l.ClearRing()
		l.Info("server", "用户清空了当前日志视图缓存（磁盘历史日志文件保持完整）", nil)
	}
	writeJSON(w, http.StatusOK, map[string]any{"ok": true})
}

func resolveSafeImagePath(imagesDir string, relPath string) (string, error) {
	cleaned := filepath.Clean(filepath.FromSlash(strings.TrimPrefix(strings.TrimSpace(relPath), "/")))
	if cleaned == "" || cleaned == "." || strings.HasPrefix(cleaned, "..") || filepath.IsAbs(cleaned) {
		return "", fmt.Errorf("非法的图片相对路径")
	}
	absBase, err := filepath.Abs(imagesDir)
	if err != nil {
		return "", err
	}
	full := filepath.Join(absBase, cleaned)
	relCheck, err := filepath.Rel(absBase, full)
	if err != nil || strings.HasPrefix(relCheck, "..") {
		return "", fmt.Errorf("路径越界访问被拒绝")
	}
	return full, nil
}

func (s *AppServer) handleServeThumb(w http.ResponseWriter, r *http.Request) {
	rel := strings.TrimPrefix(r.URL.Path, "/thumbs/")
	reqW, _ := strconv.Atoi(strings.TrimSpace(r.URL.Query().Get("w")))
	tc := s.getThumbs()
	if tc == nil {
		http.NotFound(w, r)
		return
	}
	servedPath, _, err := tc.EnsureThumbnail(rel, reqW)
	if err != nil {
		http.NotFound(w, r)
		return
	}
	w.Header().Set("Cache-Control", "public, max-age=31536000, immutable")
	http.ServeFile(w, r, servedPath)
}

func (s *AppServer) handleServeImage(w http.ResponseWriter, r *http.Request) {
	rel := strings.TrimPrefix(r.URL.Path, "/images/")
	fullPath, err := resolveSafeImagePath(s.store.ImagesDir(), rel)
	if err != nil {
		http.NotFound(w, r)
		return
	}
	if r.URL.Query().Get("download") == "1" {
		w.Header().Set("Content-Disposition", fmt.Sprintf("attachment; filename=%q", filepath.Base(fullPath)))
	} else {
		w.Header().Set("Cache-Control", "public, max-age=86400")
	}
	http.ServeFile(w, r, fullPath)
}

func maxInt(a, b int) int {
	if a > b {
		return a
	}
	return b
}

func writeJSON(w http.ResponseWriter, status int, data any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(data)
}

func writeJSONError(w http.ResponseWriter, status int, msg string) {
	writeJSON(w, status, map[string]any{
		"error": msg,
	})
}
