package main

import (
	"context"
	"embed"
	"encoding/json"
	"fmt"
	"io/fs"
	"log"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"
)

//go:embed all:web
var embeddedWebFS embed.FS

// AppServer coordinates HTTP API requests, background task polling, and local storage.
type AppServer struct {
	store     *Store
	client    *DuomiClient
	pollingMu sync.Mutex
	polling   map[string]bool
}

func NewAppServer(store *Store, client *DuomiClient) *AppServer {
	s := &AppServer{
		store:   store,
		client:  client,
		polling: make(map[string]bool),
	}
	s.ResumePendingTasks()
	return s
}

// ResumePendingTasks restarts background polling for recent unfinished tasks.
func (s *AppServer) ResumePendingTasks() {
	now := time.Now().Unix()
	for _, rec := range s.store.ListRecords() {
		if (rec.State == "pending" || rec.State == "running") && now-rec.CreateTime < 1800 {
			s.StartPolling(rec.ID)
		}
	}
}

// StartPolling launches a background goroutine to poll task status until completion or timeout.
func (s *AppServer) StartPolling(taskID string) {
	s.pollingMu.Lock()
	if s.polling[taskID] {
		s.pollingMu.Unlock()
		return
	}
	s.polling[taskID] = true
	s.pollingMu.Unlock()

	go func() {
		defer func() {
			s.pollingMu.Lock()
			delete(s.polling, taskID)
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

		deadline := time.Now().Add(timeout)
		for {
			ctx, cancel := context.WithTimeout(context.Background(), 45*time.Second)
			rec, done, _ := s.SyncTaskOnce(ctx, taskID, cfg.AutoDownload)
			cancel()

			if done {
				return
			}
			if time.Now().After(deadline) {
				if rec != nil && (rec.State == "pending" || rec.State == "running") {
					rec.State = "timeout"
					rec.ErrorMsg = fmt.Sprintf("轮询超时 (%ds)，可点击“刷新状态”继续查询", int(timeout.Seconds()))
					rec.UpdateTime = time.Now().Unix()
					_ = s.store.UpsertRecord(rec)
				}
				return
			}
			time.Sleep(interval)
		}
	}()
}

// SyncTaskOnce queries DuomiAPI for a single task, updates the local record, and downloads images if succeeded.
func (s *AppServer) SyncTaskOnce(ctx context.Context, taskID string, downloadImages bool) (*TaskRecord, bool, error) {
	cfg := s.store.GetConfig()
	rec, exists := s.store.GetRecord(taskID)
	if !exists {
		rec = &TaskRecord{
			ID:         taskID,
			Model:      cfg.DefaultModel,
			Prompt:     "（通过任务 ID 查询导入）",
			State:      "pending",
			CreateTime: time.Now().Unix(),
			UpdateTime: time.Now().Unix(),
		}
	}

	resp, rawStr, err := s.client.GetTask(ctx, cfg.BaseURL, cfg.APIKey, taskID)
	if err != nil {
		rec.UpdateTime = time.Now().Unix()
		rec.ErrorMsg = err.Error()
		_ = s.store.UpsertRecord(rec)
		return rec, false, err
	}

	state := strings.ToLower(strings.TrimSpace(resp.State))
	if state == "" {
		state = "pending"
	}
	rec.State = state
	rec.Progress = resp.Progress
	if resp.Data.Description != "" {
		rec.Description = resp.Data.Description
	}
	if resp.CreateTime > 0 {
		rec.CreateTime = resp.CreateTime
	}
	rec.UpdateTime = time.Now().Unix()
	rec.RawResponse = rawStr

	switch state {
	case "succeeded":
		rec.Progress = 100
		rec.ErrorMsg = ""
		// Merge remote images and download locally if needed
		existingMap := make(map[string]SavedImage)
		for _, img := range rec.Images {
			if img.RemoteURL != "" {
				existingMap[img.RemoteURL] = img
			}
		}

		var updatedImages []SavedImage
		for idx, item := range resp.Data.Images {
			saved := SavedImage{
				RemoteURL: item.URL,
				FileName:  item.FileName,
			}
			if prev, ok := existingMap[item.URL]; ok && prev.LocalFile != "" {
				// Check if local file still exists on disk
				if _, statErr := os.Stat(filepath.Join(s.store.ImagesDir(), prev.LocalFile)); statErr == nil {
					saved.LocalFile = prev.LocalFile
				}
			}

			if saved.LocalFile == "" && downloadImages {
				if item.URL != "" {
					localName, dlErr := s.client.DownloadImage(ctx, item.URL, s.store.ImagesDir(), taskID, idx, item.FileName)
					if dlErr == nil {
						saved.LocalFile = localName
					} else {
						log.Printf("[WARN] 下载任务 %s 图片失败: %v", taskID, dlErr)
					}
				} else if item.B64JSON != "" {
					localName, b64Err := SaveBase64Image(item.B64JSON, s.store.ImagesDir(), taskID, idx)
					if b64Err == nil {
						saved.LocalFile = localName
					}
				}
			}
			updatedImages = append(updatedImages, saved)
		}
		rec.Images = updatedImages
		_ = s.store.UpsertRecord(rec)
		return rec, true, nil

	case "error", "failed":
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
		rec.ErrorMsg = errMsg
		_ = s.store.UpsertRecord(rec)
		return rec, true, nil

	default:
		_ = s.store.UpsertRecord(rec)
		return rec, false, nil
	}
}

func (s *AppServer) Handler() http.Handler {
	mux := http.NewServeMux()

	// API routes
	mux.HandleFunc("/api/info", s.handleInfo)
	mux.HandleFunc("/api/config", s.handleConfig)
	mux.HandleFunc("/api/records", s.handleRecords)
	mux.HandleFunc("/api/records/download", s.handleDownloadRecord)
	mux.HandleFunc("/api/upload-ref", s.handleUploadRef)
	mux.HandleFunc("/api/generate", s.handleGenerate)
	mux.HandleFunc("/api/tasks/query", s.handleQueryTask)

	// Serve locally saved images from duomi_data/images/
	mux.HandleFunc("/images/", s.handleServeImage)

	// Serve embedded web frontend
	webSub, err := fs.Sub(embeddedWebFS, "web")
	if err != nil {
		log.Fatalf("加载内嵌 Web 资源失败: %v", err)
	}
	fileServer := http.FileServer(http.FS(webSub))
	mux.Handle("/", fileServer)

	return mux
}

func (s *AppServer) handleInfo(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		writeJSONError(w, http.StatusMethodNotAllowed, "仅支持 GET")
		return
	}
	cfg := s.store.GetConfig()
	writeJSON(w, http.StatusOK, map[string]any{
		"data_dir":      s.store.BaseDir(),
		"images_dir":    s.store.ImagesDir(),
		"has_key":       strings.TrimSpace(cfg.APIKey) != "",
		"ratio_presets": GetRatioPresets(),
		"models": []map[string]string{
			{
				"id":          "gpt-image-2.6-flare",
				"name":        "GPT-Image 2.6 Flare",
				"badge":       "推荐 · 高速新版",
				"price":       "0.06 元/次",
				"description": "多米最新上架的高速生图模型，兼顾速度与画面细节，支持 1K/2K/4K 分辨率",
			},
			{
				"id":          "gpt-image-2.6-sunburst",
				"name":        "GPT-Image 2.6 Sunburst",
				"badge":       "旗舰 · 极致画质",
				"price":       "0.06 元/次(暂)",
				"description": "多米最新旗舰级生图模型，适合复杂光影、精细构图与高要求商业视觉",
			},
			{
				"id":          "gpt-image-2.5-flare",
				"name":        "GPT-Image 2.5 Flare",
				"badge":       "2倍速",
				"price":       "0.06 元/次",
				"description": "用于替代 Image 2 的新生图模型，生成速度约为前代两倍，支持 1K/2K/4K",
			},
			{
				"id":          "gpt-image-2.5-sunburst",
				"name":        "GPT-Image 2.5 Sunburst",
				"badge":       "高级质感",
				"price":       "0.06 元/次(暂)",
				"description": "更高级的生图模型，擅长复杂语义理解与艺术风格还原，支持 1K/2K/4K",
			},
			{
				"id":          "gpt-image-2",
				"name":        "GPT-Image 2",
				"badge":       "经典稳定",
				"price":       "0.06 元/次",
				"description": "OpenAI 标准图像生成模型，兼容性强，支持文生图与多参考图图生图",
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
		writeJSON(w, http.StatusOK, s.store.GetConfig())

	default:
		writeJSONError(w, http.StatusMethodNotAllowed, "Method Not Allowed")
	}
}

func (s *AppServer) handleRecords(w http.ResponseWriter, r *http.Request) {
	switch r.Method {
	case http.MethodGet:
		records := s.store.ListRecords()
		writeJSON(w, http.StatusOK, map[string]any{
			"records": records,
		})

	case http.MethodDelete:
		id := strings.TrimSpace(r.URL.Query().Get("id"))
		if id == "" {
			writeJSONError(w, http.StatusBadRequest, "缺少任务 id 参数")
			return
		}
		delFiles := r.URL.Query().Get("delete_files") == "true"
		if err := s.store.DeleteRecord(id, delFiles); err != nil {
			writeJSONError(w, http.StatusInternalServerError, "删除记录失败: "+err.Error())
			return
		}
		writeJSON(w, http.StatusOK, map[string]any{"deleted": id})

	default:
		writeJSONError(w, http.StatusMethodNotAllowed, "Method Not Allowed")
	}
}

func (s *AppServer) handleUploadRef(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writeJSONError(w, http.StatusMethodNotAllowed, "仅支持 POST")
		return
	}
	r.Body = http.MaxBytesReader(w, r.Body, 25<<20)
	var body struct {
		DataURI string `json:"data_uri"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil || strings.TrimSpace(body.DataURI) == "" {
		writeJSONError(w, http.StatusBadRequest, "缺少图片数据 data_uri")
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 25*time.Second)
	defer cancel()
	pubURL, err := s.client.UploadDataURIToPublicHost(ctx, body.DataURI)
	if err != nil {
		writeJSONError(w, http.StatusBadGateway, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"url": pubURL,
	})
}

type generateAPIRequest struct {
	APIKey      string   `json:"api_key"`
	Model       string   `json:"model"`
	Prompt      string   `json:"prompt"`
	Size        string   `json:"size"`
	Image       []string `json:"image"`
	Quality     string   `json:"quality"`
	Background  string   `json:"background"`
	N           int      `json:"n"`
	Oversea     *bool    `json:"oversea"`
	CallbackURL string   `json:"callback_url"`
}

func (s *AppServer) handleGenerate(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writeJSONError(w, http.StatusMethodNotAllowed, "仅支持 POST")
		return
	}

	// Allow up to 32MB request body for base64 reference images
	r.Body = http.MaxBytesReader(w, r.Body, 32<<20)

	var req generateAPIRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeJSONError(w, http.StatusBadRequest, "请求格式错误: "+err.Error())
		return
	}

	cfg := s.store.GetConfig()
	apiKey := NormalizeAPIKey(req.APIKey)
	if apiKey == "" {
		apiKey = cfg.APIKey
	} else if cfg.APIKey == "" {
		// Automatically persist key if user entered it for the first time
		cfg.APIKey = apiKey
		_ = s.store.SaveConfig(cfg)
	}

	if apiKey == "" {
		writeJSONError(w, http.StatusBadRequest, "未配置 API Key，请先在右上角「接口配置」中填写多米 API 密钥")
		return
	}

	oversea := cfg.Oversea
	if req.Oversea != nil {
		oversea = *req.Oversea
	}

	var cleanedImages []string
	var previews []string
	for _, img := range req.Image {
		trimmed := strings.TrimSpace(img)
		if trimmed == "" {
			continue
		}
		cleanedImages = append(cleanedImages, trimmed)
		if strings.HasPrefix(trimmed, "http://") || strings.HasPrefix(trimmed, "https://") {
			previews = append(previews, trimmed)
		} else if strings.HasPrefix(trimmed, "data:image/") {
			previews = append(previews, "本地参考图 (Base64)")
		}
	}

	batchCount := req.N
	if batchCount < 1 {
		batchCount = 1
	} else if batchCount > 10 {
		batchCount = 10
	}

	createReq := CreateImageRequest{
		Model:       req.Model,
		Prompt:      req.Prompt,
		Size:        req.Size,
		Image:       cleanedImages,
		Quality:     req.Quality,
		Background:  req.Background,
		N:           1,
		Oversea:     oversea,
		CallbackURL: req.CallbackURL,
	}

	ctx, cancel := context.WithTimeout(r.Context(), time.Duration(60*batchCount)*time.Second)
	defer cancel()

	var createdRecords []*TaskRecord
	var lastErr error
	for i := 0; i < batchCount; i++ {
		taskID, rawResp, err := s.client.CreateTask(ctx, cfg.BaseURL, apiKey, createReq)
		if err != nil {
			lastErr = err
			if len(createdRecords) == 0 {
				writeJSONError(w, http.StatusBadGateway, err.Error())
				return
			}
			break
		}

		now := time.Now().Unix()
		rec := &TaskRecord{
			ID:          taskID,
			Model:       createReq.Model,
			Prompt:      createReq.Prompt,
			Size:        createReq.Size,
			Quality:     createReq.Quality,
			Background:  createReq.Background,
			N:           1,
			Oversea:     createReq.Oversea,
			CallbackURL: createReq.CallbackURL,
			RefCount:    len(cleanedImages),
			RefPreviews: previews,
			State:       "pending",
			Progress:    0,
			CreateTime:  now,
			UpdateTime:  now,
			RawResponse: rawResp,
		}
		if err := s.store.UpsertRecord(rec); err != nil {
			writeJSONError(w, http.StatusInternalServerError, "保存任务记录失败: "+err.Error())
			return
		}
		s.StartPolling(taskID)
		createdRecords = append(createdRecords, rec)
	}

	first := createdRecords[0]
	respPayload := map[string]any{
		"id":              first.ID,
		"model":           first.Model,
		"prompt":          first.Prompt,
		"size":            first.Size,
		"state":           first.State,
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
	writeJSON(w, http.StatusOK, rec)
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
			if _, err := os.Stat(filepath.Join(s.store.ImagesDir(), rec.Images[i].LocalFile)); err != nil {
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
	}
	rec.UpdateTime = time.Now().Unix()
	_ = s.store.UpsertRecord(rec)
	writeJSON(w, http.StatusOK, rec)
}

func (s *AppServer) handleServeImage(w http.ResponseWriter, r *http.Request) {
	name := strings.TrimPrefix(r.URL.Path, "/images/")
	name = filepath.Base(name)
	if name == "" || name == "." || name == "/" {
		http.NotFound(w, r)
		return
	}
	fullPath := filepath.Join(s.store.ImagesDir(), name)
	if r.URL.Query().Get("download") == "1" {
		w.Header().Set("Content-Disposition", fmt.Sprintf("attachment; filename=%q", name))
	}
	http.ServeFile(w, r, fullPath)
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
