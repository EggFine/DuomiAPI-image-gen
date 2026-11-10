package main

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"image"
	_ "image/gif"
	_ "image/jpeg"
	_ "image/png"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"sync"
	"time"
)

const DefaultDataDirName = "duomi_data"

// PromptTemplate represents a reusable prompt & parameter preset persisted in config.json.
type PromptTemplate struct {
	ID        string `json:"id"`
	Title     string `json:"title"`
	Category  string `json:"category"`
	Prompt    string `json:"prompt"`
	Model     string `json:"model,omitempty"`
	Size      string `json:"size,omitempty"`
	Quality   string `json:"quality,omitempty"`
	BuiltIn   bool   `json:"built_in,omitempty"`
	CreatedAt int64  `json:"created_at,omitempty"`
}

// AppConfig holds user settings persisted in duomi_data/config.json.
type AppConfig struct {
	APIKey                 string           `json:"api_key"`
	BaseURL                string           `json:"base_url"`
	DefaultModel           string           `json:"default_model"`
	DefaultSize            string           `json:"default_size"`
	PollInterval           int              `json:"poll_interval"` // seconds
	PollTimeout            int              `json:"poll_timeout"`  // seconds
	AutoDownload           bool             `json:"auto_download"`
	Oversea                bool             `json:"oversea"`
	RefImageMode           string           `json:"ref_image_mode"`           // "upload" (default) | "compress_base64" | "raw_base64"
	ImageHostProvider      string           `json:"image_host_provider"`      // "auto" | "litterbox" | "catbox" | "tmpfiles" | "uguu" | "0x0" | "custom"
	LitterboxExpiry        string           `json:"litterbox_expiry"`         // "1h" | "12h" | "24h" | "72h"
	CustomUploadURL        string           `json:"custom_upload_url"`        // optional custom image host endpoint
	CustomUploadField      string           `json:"custom_upload_field"`      // multipart field name, default "file"
	CustomUploadAuthHeader string           `json:"custom_upload_auth"`       // optional Authorization header for custom image host
	CustomUploadJSONPath   string           `json:"custom_upload_json_path"`  // optional dot-path to URL in JSON response
	CompressMaxDim         int              `json:"compress_max_dim"`         // max edge px when compress_base64 is used, default 1536
	CompressQuality        int              `json:"compress_quality"`         // JPEG quality 50..95 when compress_base64 is used, default 85
	AutoCompatFallback     bool             `json:"auto_compat_fallback"`     // auto retry compatible params on fail_to_submit_task
	PromptTemplates        []PromptTemplate `json:"prompt_templates,omitempty"`
}

// SavedImage represents a single generated image item in a task record.
type SavedImage struct {
	RemoteURL string `json:"remote_url"`
	FileName  string `json:"file_name"`
	LocalFile string `json:"local_file"` // filename inside duomi_data/images/
	Width     int    `json:"width,omitempty"`
	Height    int    `json:"height,omitempty"`
	SizeBytes int64  `json:"size_bytes,omitempty"`
}

// SavedRefImage stores metadata & local cached path for a reference image used in a task.
type SavedRefImage struct {
	LocalRef  string `json:"local_ref,omitempty"`  // relative path inside duomi_data/images/, e.g. "refs/ref_xxx.jpg"
	RemoteURL string `json:"remote_url,omitempty"` // https:// URL if uploaded or direct link
	Mode      string `json:"mode,omitempty"`       // "upload" | "compress_base64" | "raw_base64" | "url"
	Provider  string `json:"provider,omitempty"`
	Label     string `json:"label,omitempty"`
}

// TaskRecord stores full metadata, parameters, and status for a generation task.
type TaskRecord struct {
	ID          string          `json:"id"` // Duomi task_id
	BatchID     string          `json:"batch_id,omitempty"`
	Model       string          `json:"model"`
	Prompt      string          `json:"prompt"`
	Size        string          `json:"size,omitempty"`
	Quality     string          `json:"quality,omitempty"`
	Background  string          `json:"background,omitempty"`
	N           int             `json:"n,omitempty"`
	Oversea     bool            `json:"oversea,omitempty"`
	CallbackURL string          `json:"callback_url,omitempty"`
	RefMode     string          `json:"ref_mode,omitempty"`
	RefCount    int             `json:"ref_count,omitempty"` // number of reference images
	RefPreviews []string        `json:"ref_previews,omitempty"`
	RefItems    []SavedRefImage `json:"ref_items,omitempty"`
	Starred     bool            `json:"starred,omitempty"`
	State       string          `json:"state"` // pending, running, succeeded, error, failed, timeout, canceled
	Progress    int             `json:"progress"`
	Description string          `json:"description,omitempty"`
	WarningMsg  string          `json:"warning_msg,omitempty"`
	ErrorMsg    string          `json:"error_msg,omitempty"`
	Images      []SavedImage    `json:"images"`
	CreateTime  int64           `json:"create_time"`
	UpdateTime  int64           `json:"update_time"`
	DurationMs  int64           `json:"duration_ms,omitempty"`
	RawResponse string          `json:"raw_response,omitempty"`
}

// DiskUsageStats summarizes portable storage usage inside duomi_data/.
type DiskUsageStats struct {
	DataDir        string `json:"data_dir"`
	ImagesDir      string `json:"images_dir"`
	GeneratedCount int    `json:"generated_count"`
	RefCacheCount  int    `json:"ref_cache_count"`
	RecordCount    int    `json:"record_count"`
	TotalBytes     int64  `json:"total_bytes"`
}

// Store manages the single portable data directory (duomi_data).
type Store struct {
	mu         sync.RWMutex
	baseDir    string
	configPath string
	recordPath string
	imagesDir  string
	refsDir    string
	config     AppConfig
	records    map[string]*TaskRecord
}

// DefaultBuiltInTemplates provides curated high-consistency prompt templates.
func DefaultBuiltInTemplates() []PromptTemplate {
	return []PromptTemplate{
		{
			ID:       "builtin-candid-coaching",
			Title:    "多人参考图 · 真实纪实抓拍（高一致性）",
			Category: "人像纪实",
			Model:    "gpt-image-2.6-sunburst",
			Size:     "2048x1536",
			Quality:  "high",
			BuiltIn:  true,
			Prompt:   "请以我上传的参考图作为唯一人物身份参考，生成一张真实手机后置主摄随手抓拍的日常纪实照片。\n\n1. 人物还原：严格保留参考图中人物的真实脸型、五官比例、眼镜款式、发型、肤色、年龄感与原服装材质配色，不美颜、不磨皮、不替换成陌生面孔。\n2. 机位与神态：斜侧前方约40°平视抓拍视角，人物呈自然三分之二侧正脸，五官清晰可辨，正在自然专注交流或操作，不刻意看镜头摆拍。\n3. 空间与人体工学：桌椅、设备与手部动作严格符合真实物理透视与人体解剖学，右手自然操作右侧鼠标，线缆规整走线，无穿模或重影。\n4. 光学质感：自然窗光与室内日常顶灯混合照明，等效26mm手机直出色彩，保留真实皮肤纹理、衣物自然褶皱与桌面接触阴影，无商业棚拍滤镜、无水印边框。",
		},
		{
			ID:       "builtin-character-sheet",
			Title:    "角色设定 · 三视图与表情一致性设计卡",
			Category: "概念设计",
			Model:    "gpt-image-2.6-flare",
			Size:     "2560x1440",
			Quality:  "high",
			BuiltIn:  true,
			Prompt:   "专业游戏与动画角色设定图（Character Turnaround Sheet），同一角色在同一张纯净浅灰背景画布上的标准正视图、侧视图、背视图全身站姿并排展示，右侧附带3个不同微表情头像特写。全身比例完全一致，服装结构、配饰纹理与配色在三个视角中严格对应统一，线条干净利落，结构交代清晰，无多余杂乱背景或乱码文字。",
		},
		{
			ID:       "builtin-product-studio",
			Title:    "商业摄影 · 极简高定产品静物精修",
			Category: "商业视觉",
			Model:    "gpt-image-2.6-sunburst",
			Size:     "2048x2048",
			Quality:  "high",
			BuiltIn:  true,
			Prompt:   "高端商业静物产品摄影，主体置于微肌理天然石材台面上，柔和漫射大型柔光箱主光配合精细轮廓光，金属、玻璃与磨砂材质反射层次极为细腻真实，85mm微距镜头拍摄，焦点锐利清晰，背景极简克制，高级色调，原生超高解析度。",
		},
		{
			ID:       "builtin-transparent-sticker",
			Title:    "透明底素材 · 精致3D立体图标 / 贴纸",
			Category: "UI与素材",
			Model:    "gpt-image-2.6-flare",
			Size:     "1024x1024",
			Quality:  "medium",
			BuiltIn:  true,
			Prompt:   "精致可爱的3D微缩粘土与磨砂亚克力混合质感图标主体，边缘干净闭合无杂色毛刺，柔和全局光照与环境遮蔽阴影，等轴测微俯视角，专为透明背景（transparent PNG）UI图标与贴纸设计，中心构图饱满，周围留有干净安全边距。",
		},
		{
			ID:       "builtin-arch-interior",
			Title:    "建筑空间 · 自然采光室内写实摄影",
			Category: "空间建筑",
			Model:    "gpt-image-2.6-sunburst",
			Size:     "2560x1440",
			Quality:  "high",
			BuiltIn:  true,
			Prompt:   "《Architectural Digest》杂志级室内建筑实景摄影，24mm移轴广角镜头，横平竖直的两点线性透视严谨自然。午后温暖斜射自然阳光穿过落地窗在木地板与亚麻织物上投下柔和光斑，空间尺度真实合理，家具陈设自然有生活气息，无CG渲染塑料感，无HDR过曝。",
		},
	}
}

// ResolveDefaultDataDir locates the running directory and returns <run_dir>/duomi_data.
// It never writes to the Windows registry, AppData, or user home directory.
func ResolveDefaultDataDir(customDir string) (string, error) {
	if strings.TrimSpace(customDir) != "" {
		return filepath.Abs(customDir)
	}

	exePath, err := os.Executable()
	if err == nil {
		exePath, err = filepath.EvalSymlinks(exePath)
		if err == nil {
			exeDir := filepath.Dir(exePath)
			lowerDir := strings.ToLower(exeDir)
			if !strings.Contains(lowerDir, "go-build") && !strings.HasPrefix(lowerDir, "/tmp/") {
				return filepath.Join(exeDir, DefaultDataDirName), nil
			}
		}
	}

	cwd, err := os.Getwd()
	if err != nil {
		return DefaultDataDirName, nil
	}
	return filepath.Join(cwd, DefaultDataDirName), nil
}

func defaultAppConfig() AppConfig {
	return AppConfig{
		BaseURL:            "https://duomiapi.com",
		DefaultModel:       "gpt-image-2.6-flare",
		DefaultSize:        "1024x1024",
		PollInterval:       3,
		PollTimeout:        300,
		AutoDownload:       true,
		Oversea:            false,
		RefImageMode:       "upload",
		ImageHostProvider:  "auto",
		LitterboxExpiry:    "12h",
		CustomUploadField:  "file",
		CompressMaxDim:     1536,
		CompressQuality:    85,
		AutoCompatFallback: true,
		PromptTemplates:    []PromptTemplate{},
	}
}

func sanitizeAppConfig(cfg *AppConfig) {
	cfg.APIKey = NormalizeAPIKey(cfg.APIKey)
	cfg.BaseURL = strings.TrimRight(strings.TrimSpace(cfg.BaseURL), "/")
	if cfg.BaseURL == "" {
		cfg.BaseURL = "https://duomiapi.com"
	}
	if strings.TrimSpace(cfg.DefaultModel) == "" {
		cfg.DefaultModel = "gpt-image-2.6-flare"
	}
	if strings.TrimSpace(cfg.DefaultSize) == "" {
		cfg.DefaultSize = "1024x1024"
	}
	if cfg.PollInterval < 1 {
		cfg.PollInterval = 3
	}
	if cfg.PollTimeout < 10 {
		cfg.PollTimeout = 300
	}
	switch cfg.RefImageMode {
	case "upload", "compress_base64", "raw_base64":
	default:
		cfg.RefImageMode = "upload"
	}
	switch cfg.ImageHostProvider {
	case "auto", "litterbox", "catbox", "tmpfiles", "uguu", "0x0", "custom":
	default:
		cfg.ImageHostProvider = "auto"
	}
	switch cfg.LitterboxExpiry {
	case "1h", "12h", "24h", "72h":
	default:
		cfg.LitterboxExpiry = "12h"
	}
	if strings.TrimSpace(cfg.CustomUploadField) == "" {
		cfg.CustomUploadField = "file"
	}
	if cfg.CompressMaxDim < 256 || cfg.CompressMaxDim > 3840 {
		cfg.CompressMaxDim = 1536
	}
	if cfg.CompressQuality < 40 || cfg.CompressQuality > 98 {
		cfg.CompressQuality = 85
	}
}

// NewStore initializes the portable directory structure and loads config and records.
func NewStore(dataDir string) (*Store, error) {
	absDir, err := ResolveDefaultDataDir(dataDir)
	if err != nil {
		return nil, fmt.Errorf("解析数据目录失败: %w", err)
	}

	imagesDir := filepath.Join(absDir, "images")
	refsDir := filepath.Join(imagesDir, "refs")
	if err := os.MkdirAll(refsDir, 0755); err != nil {
		return nil, fmt.Errorf("创建数据目录失败 (%s): %w", absDir, err)
	}

	s := &Store{
		baseDir:    absDir,
		configPath: filepath.Join(absDir, "config.json"),
		recordPath: filepath.Join(absDir, "records.json"),
		imagesDir:  imagesDir,
		refsDir:    refsDir,
		config:     defaultAppConfig(),
		records:    make(map[string]*TaskRecord),
	}

	_ = s.loadConfig()
	_ = s.loadRecords()
	return s, nil
}

func (s *Store) BaseDir() string {
	return s.baseDir
}

func (s *Store) ImagesDir() string {
	return s.imagesDir
}

func (s *Store) RefsDir() string {
	return s.refsDir
}

func (s *Store) GetConfig() AppConfig {
	s.mu.RLock()
	defer s.mu.RUnlock()
	cfg := s.config
	if cfg.PromptTemplates != nil {
		cp := make([]PromptTemplate, len(cfg.PromptTemplates))
		copy(cp, cfg.PromptTemplates)
		cfg.PromptTemplates = cp
	}
	if strings.TrimSpace(cfg.APIKey) == "" {
		if envKey := strings.TrimSpace(os.Getenv("DUOMI_API_KEY")); envKey != "" {
			cfg.APIKey = NormalizeAPIKey(envKey)
		}
	}
	return cfg
}

func (s *Store) SaveConfig(cfg AppConfig) error {
	s.mu.Lock()
	defer s.mu.Unlock()

	// Preserve existing user templates if caller omitted PromptTemplates
	if cfg.PromptTemplates == nil && len(s.config.PromptTemplates) > 0 {
		cfg.PromptTemplates = s.config.PromptTemplates
	}
	sanitizeAppConfig(&cfg)
	s.config = cfg
	return writeJSONAtomic(s.configPath, s.config)
}

func (s *Store) loadConfig() error {
	data, err := os.ReadFile(s.configPath)
	if err != nil {
		if os.IsNotExist(err) {
			return writeJSONAtomic(s.configPath, s.config)
		}
		return err
	}
	// Start from defaults so newly added fields (like AutoCompatFallback, RefImageMode) get proper defaults
	cfg := defaultAppConfig()
	if err := json.Unmarshal(data, &cfg); err != nil {
		return err
	}
	sanitizeAppConfig(&cfg)
	s.config = cfg
	return nil
}

func (s *Store) loadRecords() error {
	data, err := os.ReadFile(s.recordPath)
	if err != nil {
		if os.IsNotExist(err) {
			return writeJSONAtomic(s.recordPath, []*TaskRecord{})
		}
		return err
	}
	var list []*TaskRecord
	if err := json.Unmarshal(data, &list); err != nil {
		return err
	}
	for _, r := range list {
		if r != nil && r.ID != "" {
			s.records[r.ID] = r
		}
	}
	return nil
}

func cloneTaskRecord(rec *TaskRecord) *TaskRecord {
	cp := *rec
	if rec.Images != nil {
		cp.Images = make([]SavedImage, len(rec.Images))
		copy(cp.Images, rec.Images)
	}
	if rec.RefPreviews != nil {
		cp.RefPreviews = make([]string, len(rec.RefPreviews))
		copy(cp.RefPreviews, rec.RefPreviews)
	}
	if rec.RefItems != nil {
		cp.RefItems = make([]SavedRefImage, len(rec.RefItems))
		copy(cp.RefItems, rec.RefItems)
	}
	return &cp
}

func (s *Store) UpsertRecord(rec *TaskRecord) error {
	s.mu.Lock()
	defer s.mu.Unlock()

	if rec.CreateTime == 0 {
		rec.CreateTime = time.Now().Unix()
	}
	if rec.UpdateTime == 0 {
		rec.UpdateTime = time.Now().Unix()
	}
	s.records[rec.ID] = cloneTaskRecord(rec)
	return s.persistRecordsLocked()
}

func (s *Store) GetRecord(id string) (*TaskRecord, bool) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	r, ok := s.records[id]
	if !ok {
		return nil, false
	}
	return cloneTaskRecord(r), true
}

func (s *Store) ListRecords() []*TaskRecord {
	s.mu.RLock()
	defer s.mu.RUnlock()

	list := make([]*TaskRecord, 0, len(s.records))
	for _, r := range s.records {
		list = append(list, cloneTaskRecord(r))
	}
	sort.Slice(list, func(i, j int) bool {
		if list[i].CreateTime == list[j].CreateTime {
			return list[i].ID > list[j].ID
		}
		return list[i].CreateTime > list[j].CreateTime
	})
	return list
}

func (s *Store) SetRecordStarred(id string, starred bool) (*TaskRecord, error) {
	s.mu.Lock()
	defer s.mu.Unlock()

	rec, ok := s.records[id]
	if !ok {
		return nil, fmt.Errorf("未找到任务记录: %s", id)
	}
	rec.Starred = starred
	if err := s.persistRecordsLocked(); err != nil {
		return nil, err
	}
	return cloneTaskRecord(rec), nil
}

func (s *Store) DeleteRecord(id string, deleteFiles bool) error {
	s.mu.Lock()
	defer s.mu.Unlock()

	rec, ok := s.records[id]
	if !ok {
		return nil
	}
	if deleteFiles {
		s.removeRecordFilesLocked(rec)
	}
	delete(s.records, id)
	return s.persistRecordsLocked()
}

func (s *Store) BatchDeleteRecords(ids []string, deleteFiles bool) (int, error) {
	s.mu.Lock()
	defer s.mu.Unlock()

	deleted := 0
	for _, id := range ids {
		trimmed := strings.TrimSpace(id)
		if rec, ok := s.records[trimmed]; ok {
			if deleteFiles {
				s.removeRecordFilesLocked(rec)
			}
			delete(s.records, trimmed)
			deleted++
		}
	}
	if deleted > 0 {
		if err := s.persistRecordsLocked(); err != nil {
			return deleted, err
		}
	}
	return deleted, nil
}

func (s *Store) ClearFailedRecords(deleteFiles bool) ([]string, error) {
	s.mu.Lock()
	defer s.mu.Unlock()

	var removedIDs []string
	for id, rec := range s.records {
		if rec.State == "error" || rec.State == "failed" || rec.State == "timeout" || rec.State == "canceled" {
			if deleteFiles {
				s.removeRecordFilesLocked(rec)
			}
			delete(s.records, id)
			removedIDs = append(removedIDs, id)
		}
	}
	if len(removedIDs) > 0 {
		if err := s.persistRecordsLocked(); err != nil {
			return removedIDs, err
		}
	}
	return removedIDs, nil
}

func (s *Store) removeRecordFilesLocked(rec *TaskRecord) {
	for _, img := range rec.Images {
		if img.LocalFile != "" {
			cleanName := filepath.Base(img.LocalFile)
			_ = os.Remove(filepath.Join(s.imagesDir, cleanName))
		}
	}
}

// SaveRefImageBytes saves a deduplicated copy of a local reference image inside duomi_data/images/refs/
// and returns its relative path under images/ (e.g. "refs/ref_a1b2c3d4e5f6.jpg").
func (s *Store) SaveRefImageBytes(data []byte, ext string) (string, error) {
	if len(data) == 0 {
		return "", fmt.Errorf("空图片数据")
	}
	if err := os.MkdirAll(s.refsDir, 0755); err != nil {
		return "", err
	}
	cleanExt := strings.ToLower(strings.TrimSpace(ext))
	switch cleanExt {
	case ".png", ".jpg", ".jpeg", ".webp", ".gif", ".bmp":
		if cleanExt == ".jpeg" {
			cleanExt = ".jpg"
		}
	default:
		cleanExt = ".jpg"
	}
	sum := sha256.Sum256(data)
	hashPrefix := hex.EncodeToString(sum[:])[:16]
	fileName := fmt.Sprintf("ref_%s%s", hashPrefix, cleanExt)
	fullPath := filepath.Join(s.refsDir, fileName)
	if _, err := os.Stat(fullPath); os.IsNotExist(err) {
		if err := os.WriteFile(fullPath, data, 0644); err != nil {
			return "", err
		}
	}
	return "refs/" + fileName, nil
}

// InspectImageFileMetadata reads width, height, and file size of a saved local image.
func InspectImageFileMetadata(fullPath string) (width int, height int, sizeBytes int64) {
	info, err := os.Stat(fullPath)
	if err != nil || info.IsDir() {
		return 0, 0, 0
	}
	sizeBytes = info.Size()
	f, err := os.Open(fullPath)
	if err != nil {
		return 0, 0, sizeBytes
	}
	defer f.Close()
	cfg, _, err := image.DecodeConfig(f)
	if err == nil {
		width = cfg.Width
		height = cfg.Height
	}
	return width, height, sizeBytes
}

// DiskStats calculates file count and byte size inside duomi_data/.
func (s *Store) DiskStats() DiskUsageStats {
	s.mu.RLock()
	recCount := len(s.records)
	s.mu.RUnlock()

	stats := DiskUsageStats{
		DataDir:     s.baseDir,
		ImagesDir:   s.imagesDir,
		RecordCount: recCount,
	}

	_ = filepath.Walk(s.baseDir, func(path string, info os.FileInfo, err error) error {
		if err != nil || info == nil || info.IsDir() {
			return nil
		}
		stats.TotalBytes += info.Size()
		rel, relErr := filepath.Rel(s.imagesDir, path)
		if relErr == nil && !strings.HasPrefix(rel, "..") {
			if strings.HasPrefix(filepath.ToSlash(rel), "refs/") {
				stats.RefCacheCount++
			} else {
				stats.GeneratedCount++
			}
		}
		return nil
	})
	return stats
}

func (s *Store) persistRecordsLocked() error {
	list := make([]*TaskRecord, 0, len(s.records))
	for _, r := range s.records {
		list = append(list, r)
	}
	sort.Slice(list, func(i, j int) bool {
		if list[i].CreateTime == list[j].CreateTime {
			return list[i].ID > list[j].ID
		}
		return list[i].CreateTime > list[j].CreateTime
	})
	return writeJSONAtomic(s.recordPath, list)
}

func writeJSONAtomic(path string, v any) error {
	data, err := json.MarshalIndent(v, "", "  ")
	if err != nil {
		return err
	}
	tmpPath := path + ".tmp"
	if err := os.WriteFile(tmpPath, data, 0644); err != nil {
		return err
	}
	return os.Rename(tmpPath, path)
}

// NormalizeAPIKey strips accidental "Bearer " prefix since DuomiAPI requires raw key in Authorization header.
func NormalizeAPIKey(key string) string {
	k := strings.TrimSpace(key)
	if len(k) > 7 && strings.EqualFold(k[:7], "bearer ") {
		k = strings.TrimSpace(k[7:])
	}
	return k
}
