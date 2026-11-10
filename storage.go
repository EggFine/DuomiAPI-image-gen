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
	ID         string   `json:"id"`
	Title      string   `json:"title"`
	Category   string   `json:"category"`
	Summary    string   `json:"summary,omitempty"`
	Prompt     string   `json:"prompt"`
	Model      string   `json:"model,omitempty"`
	Size       string   `json:"size,omitempty"`
	Quality    string   `json:"quality,omitempty"`
	Background string   `json:"background,omitempty"`
	Tags       []string `json:"tags,omitempty"`
	BuiltIn    bool     `json:"built_in,omitempty"`
	CreatedAt  int64    `json:"created_at,omitempty"`
}

// ProjectFolder represents a custom album / collection inside duomi_data/config.json.
type ProjectFolder struct {
	ID        string `json:"id"`
	Name      string `json:"name"`
	Color     string `json:"color,omitempty"` // e.g. "amber", "emerald", "sky", "rose", "slate"
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
	RefImageMode           string           `json:"ref_image_mode"`          // "upload" (default) | "compress_base64" | "raw_base64"
	ImageHostProvider      string           `json:"image_host_provider"`     // "auto" | "litterbox" | "catbox" | "tmpfiles" | "uguu" | "0x0" | "custom"
	LitterboxExpiry        string           `json:"litterbox_expiry"`        // "1h" | "12h" | "24h" | "72h"
	CustomUploadURL        string           `json:"custom_upload_url"`       // optional custom image host endpoint
	CustomUploadField      string           `json:"custom_upload_field"`     // multipart field name, default "file"
	CustomUploadAuthHeader string           `json:"custom_upload_auth"`      // optional Authorization header for custom image host
	CustomUploadJSONPath   string           `json:"custom_upload_json_path"` // optional dot-path to URL in JSON response
	CompressMaxDim         int              `json:"compress_max_dim"`        // max edge px when compress_base64 is used, default 1536
	CompressQuality        int              `json:"compress_quality"`        // JPEG quality 50..95 when compress_base64 is used, default 85
	AutoCompatFallback     bool             `json:"auto_compat_fallback"`    // auto retry compatible params on fail_to_submit_task
	PromptTemplates        []PromptTemplate `json:"prompt_templates,omitempty"`
	Projects               []ProjectFolder  `json:"projects,omitempty"`
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
	ProjectID   string          `json:"project_id,omitempty"`
	Tags        []string        `json:"tags,omitempty"`
	Note        string          `json:"note,omitempty"`
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
	GeneratedBytes int64  `json:"generated_bytes"`
	RefCacheCount  int    `json:"ref_cache_count"`
	RefCacheBytes  int64  `json:"ref_cache_bytes"`
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

// DefaultBuiltInTemplates provides curated high-consistency prompt recipes across major creative workflows.
func DefaultBuiltInTemplates() []PromptTemplate {
	return []PromptTemplate{
		{
			ID:       "builtin-candid-coaching",
			Title:    "多人参考图 · 真实纪实抓拍（高一致性）",
			Category: "人像纪实",
			Summary:  "专为多人合影提取身份生成校园/办公实景纪实照设计，严格锁定五官与空间人体工学",
			Model:    "gpt-image-2.6-sunburst",
			Size:     "2048x1536",
			Quality:  "high",
			Tags:     []string{"需要参考图", "人物一致性", "真实手机抓拍"},
			BuiltIn:  true,
			Prompt:   "请以我上传的参考图作为唯一人物身份参考，生成一张真实手机后置主摄随手抓拍的日常纪实照片。\n\n1. 人物还原：严格保留参考图中人物的真实脸型、五官比例、眼镜款式、发型、肤色、年龄感与原服装材质配色，不美颜、不磨皮、不替换成陌生面孔。\n2. 机位与神态：斜侧前方约40°平视抓拍视角，人物呈自然三分之二侧正脸，五官清晰可辨，正在自然专注交流或操作，不刻意看镜头摆拍。\n3. 空间与人体工学：桌椅、设备与手部动作严格符合真实物理透视与人体解剖学，右手自然操作右侧鼠标，线缆规整走线，无穿模或重影。\n4. 光学质感：自然窗光与室内日常顶灯混合照明，等效26mm手机直出色彩，保留真实皮肤纹理、衣物自然褶皱与桌面接触阴影，无商业棚拍滤镜、无水印边框。",
		},
		{
			ID:       "builtin-portrait-editorial",
			Title:    "单人参考图 · 自然窗光学术/职场肖像",
			Category: "人像纪实",
			Summary:  "保留本人真实骨相与神态，升级为杂志级自然窗光环境人像，拒绝影楼假脸感",
			Model:    "gpt-image-2.6-sunburst",
			Size:     "1536x2048",
			Quality:  "high",
			Tags:     []string{"需要参考图", "自然真肤感", "环境肖像"},
			BuiltIn:  true,
			Prompt:   "以图1中的人物作为严格面部与身份参考，拍摄一张现代简约书房/工作室环境下的自然光半身肖像照片。完整保留图1人物真实的脸型轮廓、眼神细节、鼻梁嘴型、发际线与肤色特征，不做瘦脸或网红美颜。人物穿着合体有质感的深灰针织衫与浅色衬衫，微侧身自然放松。全画幅相机配50mm f/2.0定焦镜头拍摄，侧方落地窗柔和漫射自然采光，背景书架与绿植适度光学虚化，皮肤可见真实细腻微纹理。",
		},
		{
			ID:       "builtin-annotate-edit",
			Title:    "涂鸦框选精修 · 局部元素替换与杂物消除",
			Category: "图生图精修",
			Summary:  "配合参考图「标注画板」圈出红框区域，精准修改指定物体并保持其余画面100%不变",
			Model:    "gpt-image-2.6-sunburst",
			Size:     "auto",
			Quality:  "high",
			Tags:     []string{"配合涂鸦画板", "局部重绘", "光影无缝融合"},
			BuiltIn:  true,
			Prompt:   "参考图1中红框标注的区域：请清除红框标记本身，并将原本红框内的内容自然替换为【在此填写目标内容，或填写“干净的背景延续”】，严格匹配周围环境的透视角度、色温、阴影方向与材质颗粒感；红框以外的所有人物、建筑与背景细节必须与原图保持高度一致，不得擅自重绘或改变构图。",
		},
		{
			ID:       "builtin-character-sheet",
			Title:    "角色设定 · 正侧背三视图与表情设定集",
			Category: "概念设计",
			Summary:  "标准游戏/动画美术资产卡，同一画布输出三视图全身比例与多表情头像特写",
			Model:    "gpt-image-2.6-flare",
			Size:     "2560x1440",
			Quality:  "high",
			Tags:     []string{"三视图", "美术设定", "比例对齐"},
			BuiltIn:  true,
			Prompt:   "专业游戏与动画角色设定图（Character Turnaround Sheet），同一角色在同一张纯净浅暖灰背景画布上的标准正视图、90度侧视图、背视图全身站姿水平对齐排列，右侧附带3个不同微表情（平静、自信微笑、惊讶）头像特写。全身头身比与高度完全对齐，服装剪裁、配饰材质与配色在三个视角中严格对应统一，线条干净利落，结构交代清晰。",
		},
		{
			ID:       "builtin-product-studio",
			Title:    "商业静物 · 高定护肤/数码产品影棚精修",
			Category: "商业视觉",
			Summary:  "微肌理天然洞石台面与双柔光箱轮廓布光，细腻呈现玻璃、阳极氧化铝与水滴折射",
			Model:    "gpt-image-2.6-sunburst",
			Size:     "2048x2048",
			Quality:  "high",
			Tags:     []string{"电商主图", "微距材质", "高级布光"},
			BuiltIn:  true,
			Prompt:   "高端商业静物产品摄影，主体稳固置于温润天然米白洞石台面上，顶部大型柔光箱漫射主光配合两侧精细银卡轮廓反射光，玻璃通透折射、金属拉丝倒角与磨砂表面微颗粒层次极为真实细腻，哈苏中画幅配120mm微距镜头拍摄，焦点锐利，背景极简克制，纯净高级商业色调。",
		},
		{
			ID:       "builtin-product-relight",
			Title:    "电商换景 · 保留图1商品主体置换自然场景",
			Category: "商业视觉",
			Summary:  "严格锁定参考图中的商品包装结构与Logo文字不变形，无缝融入晨光实景桌面",
			Model:    "gpt-image-2.6-sunburst",
			Size:     "1792x2240",
			Quality:  "high",
			Tags:     []string{"需要参考图", "商品零变形", "实景合成"},
			BuiltIn:  true,
			Prompt:   "严格保持图1中商品的外观造型、包装比例、材质颜色与表面文字Logo清晰完整不变形，将其自然放置在清晨阳光斜射的胡桃木咖啡馆窗边桌面上，后方有柔和虚化的绿植光斑与亚麻餐垫，桌面呈现真实的接触环境遮蔽阴影（AO）与微妙环境色反射，宛如真实实景商业拍摄。",
		},
		{
			ID:       "builtin-brand-poster",
			Title:    "品牌海报 · 现代国际主义网格视觉排版",
			Category: "品牌海报",
			Summary:  "瑞士网格排版美学，精准中英文主副标题留白与高质感摄影主视觉结合",
			Model:    "gpt-image-2.6-sunburst",
			Size:     "1536x2304",
			Quality:  "high",
			Tags:     []string{"文字排版", "展览海报", "设计感"},
			BuiltIn:  true,
			Prompt:   "现代国际主义平面设计展览海报，画面主体为极具雕塑感的光影陶瓷器皿摄影，背景采用克制的暖灰微肌理艺术纸质感。顶部采用严谨的无衬线字体清晰排版主标题“静物与时间 STILLNESS IN FORM”，底部角落辅以极简展览日期与场馆小字排版，字距与网格对齐考究，留白呼吸感极强，印刷级色彩表现。",
		},
		{
			ID:         "builtin-transparent-sticker",
			Title:      "透明底素材 · 精致3D微缩图标 / 贴纸资产",
			Category:   "UI与素材",
			Summary:    "自动开启透明通道 PNG，边缘干净无白边杂色，可直接拖入 PPT / Figma / 网页使用",
			Model:      "gpt-image-2.6-flare",
			Size:       "1024x1024",
			Quality:    "medium",
			Background: "transparent",
			Tags:       []string{"透明PNG", "3D图标", "UI设计资产"},
			BuiltIn:    true,
			Prompt:     "精致高级的3D微缩磨砂玻璃与温润陶瓷混合材质立体图标主体，等轴测微俯视角（Isometric 30°），柔和工作室全局光照，外轮廓边缘干净闭合无毛刺无杂色背景，专为透明通道（Transparent PNG）桌面与UI设计资产打造，中心构图饱满，四周留有12%安全边距。",
		},
		{
			ID:       "builtin-arch-interior",
			Title:    "建筑空间 · 《AD》杂志级自然采光室内摄影",
			Category: "空间建筑",
			Summary:  "24mm移轴镜头横平竖直两点透视，午后真实自然光比与原木亚麻材质呼吸感",
			Model:    "gpt-image-2.6-sunburst",
			Size:     "2560x1440",
			Quality:  "high",
			Tags:     []string{"移轴透视", "室内设计", "自然光影"},
			BuiltIn:  true,
			Prompt:   "《Architectural Digest》杂志级室内建筑实景摄影，24mm专业移轴镜头拍摄，垂直线条严格横平竖直，两点线性透视自然严谨。午后温暖斜射阳光穿过百叶落地窗在天然橡木地板、微水泥墙面与亚麻沙发上投下柔和丰富的光影层次，空间尺度符合真实住宅比例，陈设克制而富有生活温度，拒绝CG假渲染塑料感。",
		},
		{
			ID:       "builtin-cinema-anime",
			Title:    "新海诚/剧场版级 · 电影宽银幕动画背景概念图",
			Category: "概念设计",
			Summary:  "2.35:1 宽幅光影氛围叙事，通透空气透视、细腻积雨云光晕与城市生活细节",
			Model:    "gpt-image-2.6-flare",
			Size:     "3840x1920",
			Quality:  "high",
			Tags:     []string{"宽幅电影感", "动画美术", "空气透视"},
			BuiltIn:  true,
			Prompt:   "剧场版动画电影级宽画幅概念美术场景，雨后初晴的黄昏海滨电车路口，湿润柏油路面清晰倒映着天边壮丽的橘粉与群青渐变积雨云霞光，电线杆、交通信号灯与远处海平面层次分明，空气透视感极度通透，色彩冷暖对比细腻动人，手绘笔触丰富精致，4K壁纸级完成度。",
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
		Projects:           []ProjectFolder{},
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
	if cfg.Projects != nil {
		cpProj := make([]ProjectFolder, len(cfg.Projects))
		copy(cpProj, cfg.Projects)
		cfg.Projects = cpProj
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

	if cfg.PromptTemplates == nil && len(s.config.PromptTemplates) > 0 {
		cfg.PromptTemplates = s.config.PromptTemplates
	}
	if cfg.Projects == nil && len(s.config.Projects) > 0 {
		cfg.Projects = s.config.Projects
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
	if rec.Tags != nil {
		cp.Tags = make([]string, len(rec.Tags))
		copy(cp.Tags, rec.Tags)
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

// OrganizeRecords updates project_id, starred, tags, or note across one or more records atomically.
func (s *Store) OrganizeRecords(ids []string, projectID *string, starred *bool, tags *[]string, note *string) ([]*TaskRecord, error) {
	s.mu.Lock()
	defer s.mu.Unlock()

	var updated []*TaskRecord
	for _, rawID := range ids {
		id := strings.TrimSpace(rawID)
		rec, ok := s.records[id]
		if !ok {
			continue
		}
		if projectID != nil {
			rec.ProjectID = strings.TrimSpace(*projectID)
		}
		if starred != nil {
			rec.Starred = *starred
		}
		if tags != nil {
			cleaned := make([]string, 0, len(*tags))
			for _, t := range *tags {
				if trimmed := strings.TrimSpace(t); trimmed != "" {
					cleaned = append(cleaned, trimmed)
				}
			}
			rec.Tags = cleaned
		}
		if note != nil {
			rec.Note = strings.TrimSpace(*note)
		}
		rec.UpdateTime = time.Now().Unix()
		updated = append(updated, cloneTaskRecord(rec))
	}
	if len(updated) > 0 {
		if err := s.persistRecordsLocked(); err != nil {
			return nil, err
		}
	}
	return updated, nil
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

// CleanOrphanRefCache removes cached files under duomi_data/images/refs/ that are not referenced by any TaskRecord.
func (s *Store) CleanOrphanRefCache() (removedCount int, freedBytes int64, err error) {
	s.mu.RLock()
	inUse := make(map[string]bool)
	for _, rec := range s.records {
		for _, item := range rec.RefItems {
			if item.LocalRef != "" {
				inUse[filepath.Base(item.LocalRef)] = true
			}
		}
	}
	s.mu.RUnlock()

	entries, readErr := os.ReadDir(s.refsDir)
	if readErr != nil {
		if os.IsNotExist(readErr) {
			return 0, 0, nil
		}
		return 0, 0, readErr
	}
	for _, entry := range entries {
		if entry.IsDir() {
			continue
		}
		name := entry.Name()
		if !inUse[name] {
			full := filepath.Join(s.refsDir, name)
			if info, statErr := entry.Info(); statErr == nil {
				freedBytes += info.Size()
			}
			if rmErr := os.Remove(full); rmErr == nil {
				removedCount++
			}
		}
	}
	return removedCount, freedBytes, nil
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
		sz := info.Size()
		stats.TotalBytes += sz
		rel, relErr := filepath.Rel(s.imagesDir, path)
		if relErr == nil && !strings.HasPrefix(rel, "..") {
			if strings.HasPrefix(filepath.ToSlash(rel), "refs/") {
				stats.RefCacheCount++
				stats.RefCacheBytes += sz
			} else {
				stats.GeneratedCount++
				stats.GeneratedBytes += sz
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
