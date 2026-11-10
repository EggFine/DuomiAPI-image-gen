package main

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"sync"
	"time"
)

const DefaultDataDirName = "duomi_data"

// AppConfig holds user settings persisted in duomi_data/config.json.
type AppConfig struct {
	APIKey       string `json:"api_key"`
	BaseURL      string `json:"base_url"`
	DefaultModel string `json:"default_model"`
	DefaultSize  string `json:"default_size"`
	PollInterval int    `json:"poll_interval"` // seconds
	PollTimeout  int    `json:"poll_timeout"`  // seconds
	AutoDownload bool   `json:"auto_download"`
	Oversea      bool   `json:"oversea"`
}

// SavedImage represents a single generated image item in a task record.
type SavedImage struct {
	RemoteURL string `json:"remote_url"`
	FileName  string `json:"file_name"`
	LocalFile string `json:"local_file"` // filename inside duomi_data/images/
}

// TaskRecord stores full metadata, parameters, and status for a generation task.
type TaskRecord struct {
	ID          string       `json:"id"` // Duomi task_id
	Model       string       `json:"model"`
	Prompt      string       `json:"prompt"`
	Size        string       `json:"size,omitempty"`
	Quality     string       `json:"quality,omitempty"`
	Background  string       `json:"background,omitempty"`
	N           int          `json:"n,omitempty"`
	Oversea     bool         `json:"oversea,omitempty"`
	CallbackURL string       `json:"callback_url,omitempty"`
	RefCount    int          `json:"ref_count,omitempty"` // number of reference images
	RefPreviews []string     `json:"ref_previews,omitempty"`
	State       string       `json:"state"` // pending, running, succeeded, error, failed
	Progress    int          `json:"progress"`
	Description string       `json:"description,omitempty"`
	ErrorMsg    string       `json:"error_msg,omitempty"`
	Images      []SavedImage `json:"images"`
	CreateTime  int64        `json:"create_time"`
	UpdateTime  int64        `json:"update_time"`
	RawResponse string       `json:"raw_response,omitempty"`
}

// Store manages the single portable data directory (duomi_data).
type Store struct {
	mu         sync.RWMutex
	baseDir    string
	configPath string
	recordPath string
	imagesDir  string
	config     AppConfig
	records    map[string]*TaskRecord
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
			// When running via `go run`, the binary is placed in a temp go-build folder;
			// in that case, use current working directory instead.
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

// NewStore initializes the portable directory structure and loads config and records.
func NewStore(dataDir string) (*Store, error) {
	absDir, err := ResolveDefaultDataDir(dataDir)
	if err != nil {
		return nil, fmt.Errorf("解析数据目录失败: %w", err)
	}

	imagesDir := filepath.Join(absDir, "images")
	if err := os.MkdirAll(imagesDir, 0755); err != nil {
		return nil, fmt.Errorf("创建数据目录失败 (%s): %w", absDir, err)
	}

	s := &Store{
		baseDir:    absDir,
		configPath: filepath.Join(absDir, "config.json"),
		recordPath: filepath.Join(absDir, "records.json"),
		imagesDir:  imagesDir,
		config: AppConfig{
			BaseURL:      "https://duomiapi.com",
			DefaultModel: "gpt-image-2.6-flare",
			DefaultSize:  "auto",
			PollInterval: 4,
			PollTimeout:  300,
			AutoDownload: true,
			Oversea:      false,
		},
		records: make(map[string]*TaskRecord),
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

func (s *Store) GetConfig() AppConfig {
	s.mu.RLock()
	defer s.mu.RUnlock()
	cfg := s.config
	// Fallback to environment variable if config.json has no key yet
	if strings.TrimSpace(cfg.APIKey) == "" {
		if envKey := strings.TrimSpace(os.Getenv("DUOMI_API_KEY")); envKey != "" {
			cfg.APIKey = envKey
		}
	}
	return cfg
}

func (s *Store) SaveConfig(cfg AppConfig) error {
	s.mu.Lock()
	defer s.mu.Unlock()

	cfg.APIKey = NormalizeAPIKey(cfg.APIKey)
	cfg.BaseURL = strings.TrimRight(strings.TrimSpace(cfg.BaseURL), "/")
	if cfg.BaseURL == "" {
		cfg.BaseURL = "https://duomiapi.com"
	}
	if cfg.DefaultModel == "" {
		cfg.DefaultModel = "gpt-image-2.6-flare"
	}
	if cfg.DefaultSize == "" {
		cfg.DefaultSize = "auto"
	}
	if cfg.PollInterval < 1 {
		cfg.PollInterval = 4
	}
	if cfg.PollTimeout < 10 {
		cfg.PollTimeout = 300
	}

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
	var cfg AppConfig
	if err := json.Unmarshal(data, &cfg); err != nil {
		return err
	}
	cfg.APIKey = NormalizeAPIKey(cfg.APIKey)
	if cfg.BaseURL == "" {
		cfg.BaseURL = "https://duomiapi.com"
	}
	if cfg.DefaultModel == "" {
		cfg.DefaultModel = "gpt-image-2.6-flare"
	}
	if cfg.DefaultSize == "" {
		cfg.DefaultSize = "auto"
	}
	if cfg.PollInterval < 1 {
		cfg.PollInterval = 4
	}
	if cfg.PollTimeout < 10 {
		cfg.PollTimeout = 300
	}
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

func (s *Store) UpsertRecord(rec *TaskRecord) error {
	s.mu.Lock()
	defer s.mu.Unlock()

	if rec.CreateTime == 0 {
		rec.CreateTime = time.Now().Unix()
	}
	if rec.UpdateTime == 0 {
		rec.UpdateTime = time.Now().Unix()
	}
	cp := *rec
	if rec.Images != nil {
		cp.Images = make([]SavedImage, len(rec.Images))
		copy(cp.Images, rec.Images)
	}
	if rec.RefPreviews != nil {
		cp.RefPreviews = make([]string, len(rec.RefPreviews))
		copy(cp.RefPreviews, rec.RefPreviews)
	}
	s.records[rec.ID] = &cp
	return s.persistRecordsLocked()
}

func (s *Store) GetRecord(id string) (*TaskRecord, bool) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	r, ok := s.records[id]
	if !ok {
		return nil, false
	}
	cp := *r
	cp.Images = append([]SavedImage(nil), r.Images...)
	cp.RefPreviews = append([]string(nil), r.RefPreviews...)
	return &cp, true
}

func (s *Store) ListRecords() []*TaskRecord {
	s.mu.RLock()
	defer s.mu.RUnlock()

	list := make([]*TaskRecord, 0, len(s.records))
	for _, r := range s.records {
		cp := *r
		cp.Images = append([]SavedImage(nil), r.Images...)
		cp.RefPreviews = append([]string(nil), r.RefPreviews...)
		list = append(list, &cp)
	}
	sort.Slice(list, func(i, j int) bool {
		if list[i].CreateTime == list[j].CreateTime {
			return list[i].ID > list[j].ID
		}
		return list[i].CreateTime > list[j].CreateTime
	})
	return list
}

func (s *Store) DeleteRecord(id string, deleteFiles bool) error {
	s.mu.Lock()
	defer s.mu.Unlock()

	rec, ok := s.records[id]
	if !ok {
		return nil
	}
	if deleteFiles {
		for _, img := range rec.Images {
			if img.LocalFile != "" {
				cleanName := filepath.Base(img.LocalFile)
				_ = os.Remove(filepath.Join(s.imagesDir, cleanName))
			}
		}
	}
	delete(s.records, id)
	return s.persistRecordsLocked()
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
