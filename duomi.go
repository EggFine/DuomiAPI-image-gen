package main

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"time"
)

// CreateImageRequest matches the OpenAPI schema from api-192667743:
// POST /v1/images/generations?async=true
type CreateImageRequest struct {
	Model       string   `json:"model"`
	Prompt      string   `json:"prompt"`
	Size        string   `json:"size,omitempty"`
	Image       []string `json:"image,omitempty"`
	Quality     string   `json:"quality,omitempty"`
	Background  string   `json:"background,omitempty"`
	N           int      `json:"n,omitempty"`
	Oversea     bool     `json:"oversea"`
	CallbackURL string   `json:"callback_url,omitempty"`
}

// CreateImageResponse represents the response from POST /v1/images/generations?async=true
type CreateImageResponse struct {
	ID      string `json:"id"`
	TaskID  string `json:"task_id"`
	Message string `json:"message"`
	Error   any    `json:"error"`
	Data    struct {
		ID     string `json:"id"`
		TaskID string `json:"task_id"`
	} `json:"data"`
}

// TaskImageItem represents an item in data.images[] from GET /v1/tasks/{id}
type TaskImageItem struct {
	URL      string `json:"url"`
	FileName string `json:"file_name"`
	B64JSON  string `json:"b64_json"`
}

// TaskQueryResponse matches the OpenAPI schema from api-447345474:
// GET /v1/tasks/{id}
type TaskQueryResponse struct {
	ID    string `json:"id"`
	State string `json:"state"` // pending, running, succeeded, error, failed
	Data  struct {
		Images      []TaskImageItem `json:"images"`
		Description string          `json:"description"`
	} `json:"data"`
	Progress   int    `json:"progress"`
	CreateTime int64  `json:"create_time"`
	UpdateTime int64  `json:"update_time"`
	Action     string `json:"action"`
	Message    string `json:"message"`
	Reason     string `json:"reason"`
	Error      any    `json:"error"`
}

// DuomiClient interacts with DuomiAPI image generation endpoints.
type DuomiClient struct {
	httpClient *http.Client
}

func NewDuomiClient() *DuomiClient {
	return &DuomiClient{
		httpClient: &http.Client{
			Timeout: 90 * time.Second,
		},
	}
}

// SizePresetItem represents a specific resolution option under an aspect ratio.
type SizePresetItem struct {
	Value  string `json:"value"`  // value sent in API `size` field, e.g. "1024x1024" or "16:9"
	Tier   string `json:"tier"`   // "1k", "1.5k", "2k", "4k", "ratio", "auto"
	Label  string `json:"label"`  // e.g. "1K 标准"
	Detail string `json:"detail"` // e.g. "1024×1024 (105万像素)"
}

// RatioPresetGroup represents an aspect ratio and all its compliant size presets.
type RatioPresetGroup struct {
	Ratio       string           `json:"ratio"`        // e.g. "1:1", "16:9", "auto"
	Name        string           `json:"name"`         // e.g. "1:1 方图"
	AspectW     int              `json:"aspect_w"`     // width ratio unit
	AspectH     int              `json:"aspect_h"`     // height ratio unit
	DefaultSize string           `json:"default_size"` // default size when this ratio is chosen
	Sizes       []SizePresetItem `json:"sizes"`
}

// GetRatioPresets returns all aspect ratios and their corresponding 1K/2K/4K resolution presets.
// Every single WxH preset strictly satisfies DuomiAPI constraints:
// - 16 <= W, H <= 3840
// - W % 16 == 0 and H % 16 == 0
// - 655,360 <= W * H <= 8,294,400
func GetRatioPresets() []RatioPresetGroup {
	return []RatioPresetGroup{
		{
			Ratio:       "auto",
			Name:        "auto 自动",
			AspectW:     0,
			AspectH:     0,
			DefaultSize: "auto",
			Sizes: []SizePresetItem{
				{Value: "auto", Tier: "auto", Label: "自动尺寸 (auto)", Detail: "由模型根据提示词自动决定画幅与分辨率"},
			},
		},
		{
			Ratio:       "1:1",
			Name:        "1:1 方图",
			AspectW:     1,
			AspectH:     1,
			DefaultSize: "1024x1024",
			Sizes: []SizePresetItem{
				{Value: "1024x1024", Tier: "1k", Label: "1K 标准", Detail: "1024×1024 · 105万像素"},
				{Value: "1536x1536", Tier: "1.5k", Label: "1.5K 进阶", Detail: "1536×1536 · 236万像素"},
				{Value: "2048x2048", Tier: "2k", Label: "2K 高清", Detail: "2048×2048 · 419万像素"},
				{Value: "2880x2880", Tier: "4k", Label: "4K 极限", Detail: "2880×2880 · 829万像素(预算上限)"},
				{Value: "1:1", Tier: "ratio", Label: "仅传比例 (1:1)", Detail: "直接传 1:1 由服务端匹配默认尺寸"},
			},
		},
		{
			Ratio:       "16:9",
			Name:        "16:9 横屏",
			AspectW:     16,
			AspectH:     9,
			DefaultSize: "1280x720",
			Sizes: []SizePresetItem{
				{Value: "1280x720", Tier: "1k", Label: "1K 标准", Detail: "1280×720 · 92万像素"},
				{Value: "1536x864", Tier: "1.5k", Label: "1.5K 进阶", Detail: "1536×864 · 133万像素"},
				{Value: "1792x1024", Tier: "official", Label: "API官方横版", Detail: "1792×1024 · 184万像素"},
				{Value: "2560x1440", Tier: "2k", Label: "2K 高清", Detail: "2560×1440 · 369万像素"},
				{Value: "3840x2160", Tier: "4k", Label: "4K 超清", Detail: "3840×2160 · 829万像素"},
				{Value: "16:9", Tier: "ratio", Label: "仅传比例 (16:9)", Detail: "直接传 16:9 由服务端匹配默认尺寸"},
			},
		},
		{
			Ratio:       "9:16",
			Name:        "9:16 竖屏",
			AspectW:     9,
			AspectH:     16,
			DefaultSize: "720x1280",
			Sizes: []SizePresetItem{
				{Value: "720x1280", Tier: "1k", Label: "1K 标准", Detail: "720×1280 · 92万像素"},
				{Value: "864x1536", Tier: "1.5k", Label: "1.5K 进阶", Detail: "864×1536 · 133万像素"},
				{Value: "1024x1792", Tier: "official", Label: "API官方竖版", Detail: "1024×1792 · 184万像素"},
				{Value: "1440x2560", Tier: "2k", Label: "2K 高清", Detail: "1440×2560 · 369万像素"},
				{Value: "2160x3840", Tier: "4k", Label: "4K 超清", Detail: "2160×3840 · 829万像素"},
				{Value: "9:16", Tier: "ratio", Label: "仅传比例 (9:16)", Detail: "直接传 9:16 由服务端匹配默认尺寸"},
			},
		},
		{
			Ratio:       "3:2",
			Name:        "3:2 摄影横",
			AspectW:     3,
			AspectH:     2,
			DefaultSize: "1536x1024",
			Sizes: []SizePresetItem{
				{Value: "1152x768", Tier: "1k", Label: "1K 标准", Detail: "1152×768 · 88万像素"},
				{Value: "1536x1024", Tier: "1.5k", Label: "1.5K 进阶", Detail: "1536×1024 · 157万像素"},
				{Value: "2304x1536", Tier: "2k", Label: "2K 高清", Detail: "2304×1536 · 354万像素"},
				{Value: "3456x2304", Tier: "4k", Label: "4K 超清", Detail: "3456×2304 · 796万像素"},
				{Value: "3:2", Tier: "ratio", Label: "仅传比例 (3:2)", Detail: "直接传 3:2 由服务端匹配默认尺寸"},
			},
		},
		{
			Ratio:       "2:3",
			Name:        "2:3 摄影竖",
			AspectW:     2,
			AspectH:     3,
			DefaultSize: "1024x1536",
			Sizes: []SizePresetItem{
				{Value: "768x1152", Tier: "1k", Label: "1K 标准", Detail: "768×1152 · 88万像素"},
				{Value: "1024x1536", Tier: "1.5k", Label: "1.5K 进阶", Detail: "1024×1536 · 157万像素"},
				{Value: "1536x2304", Tier: "2k", Label: "2K 高清", Detail: "1536×2304 · 354万像素"},
				{Value: "2304x3456", Tier: "4k", Label: "4K 超清", Detail: "2304×3456 · 796万像素"},
				{Value: "2:3", Tier: "ratio", Label: "仅传比例 (2:3)", Detail: "直接传 2:3 由服务端匹配默认尺寸"},
			},
		},
		{
			Ratio:       "4:3",
			Name:        "4:3 标准横",
			AspectW:     4,
			AspectH:     3,
			DefaultSize: "1536x1152",
			Sizes: []SizePresetItem{
				{Value: "1152x864", Tier: "1k", Label: "1K 标准", Detail: "1152×864 · 100万像素"},
				{Value: "1536x1152", Tier: "1.5k", Label: "1.5K 进阶", Detail: "1536×1152 · 177万像素"},
				{Value: "2048x1536", Tier: "2k", Label: "2K 高清", Detail: "2048×1536 · 315万像素"},
				{Value: "3264x2448", Tier: "4k", Label: "4K 超清", Detail: "3264×2448 · 799万像素"},
				{Value: "4:3", Tier: "ratio", Label: "仅传比例 (4:3)", Detail: "直接传 4:3 由服务端匹配默认尺寸"},
			},
		},
		{
			Ratio:       "3:4",
			Name:        "3:4 标准竖",
			AspectW:     3,
			AspectH:     4,
			DefaultSize: "1152x1536",
			Sizes: []SizePresetItem{
				{Value: "864x1152", Tier: "1k", Label: "1K 标准", Detail: "864×1152 · 100万像素"},
				{Value: "1152x1536", Tier: "1.5k", Label: "1.5K 进阶", Detail: "1152×1536 · 177万像素"},
				{Value: "1536x2048", Tier: "2k", Label: "2K 高清", Detail: "1536×2048 · 315万像素"},
				{Value: "2448x3264", Tier: "4k", Label: "4K 超清", Detail: "2448×3264 · 799万像素"},
				{Value: "3:4", Tier: "ratio", Label: "仅传比例 (3:4)", Detail: "直接传 3:4 由服务端匹配默认尺寸"},
			},
		},
		{
			Ratio:       "5:4",
			Name:        "5:4 画框横",
			AspectW:     5,
			AspectH:     4,
			DefaultSize: "1600x1280",
			Sizes: []SizePresetItem{
				{Value: "1120x896", Tier: "1k", Label: "1K 标准", Detail: "1120×896 · 100万像素"},
				{Value: "1600x1280", Tier: "1.5k", Label: "1.5K 进阶", Detail: "1600×1280 · 205万像素"},
				{Value: "2240x1792", Tier: "2k", Label: "2K 高清", Detail: "2240×1792 · 401万像素"},
				{Value: "3200x2560", Tier: "4k", Label: "4K 超清", Detail: "3200×2560 · 819万像素"},
				{Value: "5:4", Tier: "ratio", Label: "仅传比例 (5:4)", Detail: "直接传 5:4 由服务端匹配默认尺寸"},
			},
		},
		{
			Ratio:       "4:5",
			Name:        "4:5 社交竖",
			AspectW:     4,
			AspectH:     5,
			DefaultSize: "1280x1600",
			Sizes: []SizePresetItem{
				{Value: "896x1120", Tier: "1k", Label: "1K 标准", Detail: "896×1120 · 100万像素"},
				{Value: "1280x1600", Tier: "1.5k", Label: "1.5K 进阶", Detail: "1280×1600 · 205万像素"},
				{Value: "1792x2240", Tier: "2k", Label: "2K 高清", Detail: "1792×2240 · 401万像素"},
				{Value: "2560x3200", Tier: "4k", Label: "4K 超清", Detail: "2560×3200 · 819万像素"},
				{Value: "4:5", Tier: "ratio", Label: "仅传比例 (4:5)", Detail: "直接传 4:5 由服务端匹配默认尺寸"},
			},
		},
		{
			Ratio:       "2:1",
			Name:        "2:1 宽幅横",
			AspectW:     2,
			AspectH:     1,
			DefaultSize: "2048x1024",
			Sizes: []SizePresetItem{
				{Value: "1408x704", Tier: "1k", Label: "1K 标准", Detail: "1408×704 · 99万像素"},
				{Value: "2048x1024", Tier: "1.5k", Label: "1.5K 进阶", Detail: "2048×1024 · 210万像素"},
				{Value: "2560x1280", Tier: "2k", Label: "2K 高清", Detail: "2560×1280 · 328万像素"},
				{Value: "3840x1920", Tier: "4k", Label: "4K 超清", Detail: "3840×1920 · 737万像素"},
				{Value: "2:1", Tier: "ratio", Label: "仅传比例 (2:1)", Detail: "直接传 2:1 由服务端匹配默认尺寸"},
			},
		},
		{
			Ratio:       "1:2",
			Name:        "1:2 长图竖",
			AspectW:     1,
			AspectH:     2,
			DefaultSize: "1024x2048",
			Sizes: []SizePresetItem{
				{Value: "704x1408", Tier: "1k", Label: "1K 标准", Detail: "704×1408 · 99万像素"},
				{Value: "1024x2048", Tier: "1.5k", Label: "1.5K 进阶", Detail: "1024×2048 · 210万像素"},
				{Value: "1280x2560", Tier: "2k", Label: "2K 高清", Detail: "1280×2560 · 328万像素"},
				{Value: "1920x3840", Tier: "4k", Label: "4K 超清", Detail: "1920×3840 · 737万像素"},
				{Value: "1:2", Tier: "ratio", Label: "仅传比例 (1:2)", Detail: "直接传 1:2 由服务端匹配默认尺寸"},
			},
		},
	}
}

// ResolveRatioPreset resolves an aspect ratio + resolution tier (e.g. ratio="16:9", tier="4k") into an API size string.
func ResolveRatioPreset(ratio, tier string) (string, error) {
	r := strings.TrimSpace(ratio)
	t := strings.ToLower(strings.TrimSpace(tier))
	for _, grp := range GetRatioPresets() {
		if grp.Ratio == r {
			if t == "" {
				return grp.DefaultSize, nil
			}
			for _, s := range grp.Sizes {
				if strings.ToLower(s.Tier) == t || strings.ToLower(s.Value) == t {
					return s.Value, nil
				}
			}
			return "", fmt.Errorf("比例 %s 下不支持档位 %q（可选: 1k, 1.5k, 2k, 4k, ratio）", r, tier)
		}
	}
	return "", fmt.Errorf("不支持的画幅比例 %q", ratio)
}

var validAspectRatios = map[string]bool{
	"auto": true,
	"1:1":  true,
	"3:2":  true,
	"2:3":  true,
	"16:9": true,
	"9:16": true,
	"1:2":  true,
	"2:1":  true,
	"4:3":  true,
	"3:4":  true,
	"5:4":  true,
	"4:5":  true,
}

// ValidateSize checks whether the size string adheres to DuomiAPI's specification:
// - Preset aspect ratios (auto, 1:1, 16:9, 9:16, 3:2, 2:3, 4:3, 3:4, 5:4, 4:5, 2:1, 1:2)
// - Custom widthxheight: each side in [16, 3840], divisible by 16, and 655,360 <= width * height <= 8,294,400.
func ValidateSize(size string) error {
	s := strings.TrimSpace(size)
	if s == "" || validAspectRatios[s] {
		return nil
	}

	parts := strings.Split(strings.ToLower(s), "x")
	if len(parts) != 2 {
		return fmt.Errorf("无效的尺寸格式 %q：请使用预设比例（如 1:1、16:9、auto）或 宽x高 格式（如 1024x1024）", size)
	}
	w, err1 := strconv.Atoi(strings.TrimSpace(parts[0]))
	h, err2 := strconv.Atoi(strings.TrimSpace(parts[1]))
	if err1 != nil || err2 != nil {
		return fmt.Errorf("无效的宽高数值 %q：宽和高必须为整数", size)
	}
	if w < 16 || w > 3840 || h < 16 || h > 3840 {
		return fmt.Errorf("尺寸 %dx%d 超出范围：每条边需在 [16, 3840] 之间", w, h)
	}
	if w%16 != 0 || h%16 != 0 {
		return fmt.Errorf("尺寸 %dx%d 不符合要求：宽和高都必须能被 16 整除", w, h)
	}
	pixels := w * h
	if pixels < 655360 || pixels > 8294400 {
		return fmt.Errorf("尺寸 %dx%d 总像素为 %d，超出像素预算范围 [655360, 8294400]", w, h, pixels)
	}
	return nil
}

// CreateTask submits an asynchronous image generation task to POST /v1/images/generations?async=true.
func (c *DuomiClient) CreateTask(ctx context.Context, baseURL, apiKey string, req CreateImageRequest) (string, string, error) {
	apiKey = NormalizeAPIKey(apiKey)
	if apiKey == "" {
		return "", "", errors.New("未配置 API Key，请先在设置中填写多米 API 密钥")
	}
	req.Model = strings.TrimSpace(req.Model)
	if req.Model == "" {
		req.Model = "gpt-image-2"
	}
	req.Prompt = strings.TrimSpace(req.Prompt)
	if req.Prompt == "" {
		return "", "", errors.New("提示词 (prompt) 不能为空")
	}
	if len([]rune(req.Prompt)) > 5000 {
		return "", "", errors.New("提示词长度超过 5000 字符上限")
	}
	if err := ValidateSize(req.Size); err != nil {
		return "", "", err
	}

	endpoint := strings.TrimRight(strings.TrimSpace(baseURL), "/")
	if endpoint == "" {
		endpoint = "https://duomiapi.com"
	}
	endpoint += "/v1/images/generations?async=true"

	// Build clean JSON map matching DuomiAPI spec
	payload := map[string]any{
		"model":   req.Model,
		"prompt":  req.Prompt,
		"oversea": req.Oversea,
	}
	if req.Size != "" {
		payload["size"] = req.Size
	}
	if len(req.Image) > 0 {
		payload["image"] = req.Image
	}
	if req.Quality != "" {
		payload["quality"] = req.Quality
	}
	if req.Background != "" {
		payload["background"] = req.Background
	}
	if req.N > 1 {
		payload["n"] = req.N
	}
	if req.CallbackURL != "" {
		payload["callback_url"] = req.CallbackURL
	}

	bodyBytes, err := json.Marshal(payload)
	if err != nil {
		return "", "", fmt.Errorf("序列化请求失败: %w", err)
	}

	httpReq, err := http.NewRequestWithContext(ctx, http.MethodPost, endpoint, bytes.NewReader(bodyBytes))
	if err != nil {
		return "", "", fmt.Errorf("创建 HTTP 请求失败: %w", err)
	}
	// Crucial per DuomiAPI docs: raw API key in Authorization header WITHOUT "Bearer " prefix
	httpReq.Header.Set("Authorization", apiKey)
	httpReq.Header.Set("Content-Type", "application/json")
	httpReq.Header.Set("Accept", "application/json")
	httpReq.Header.Set("User-Agent", "DuomiAPI-Image-Gen-Go/1.0")

	resp, err := c.httpClient.Do(httpReq)
	if err != nil {
		return "", "", fmt.Errorf("请求多米 API 失败: %w", err)
	}
	defer resp.Body.Close()

	rawBytes, err := io.ReadAll(resp.Body)
	if err != nil {
		return "", "", fmt.Errorf("读取响应失败: %w", err)
	}
	rawStr := string(rawBytes)

	if resp.StatusCode >= 400 {
		hint := ""
		lowerRaw := strings.ToLower(rawStr)
		if resp.StatusCode == 401 || resp.StatusCode == 403 {
			hint = "（请检查 API Key 是否正确且余额充足；注意无需加 Bearer 前缀）"
		} else if (resp.StatusCode == 400 || resp.StatusCode == 413 || resp.StatusCode == 422) && len(req.Image) > 0 &&
			(strings.Contains(lowerRaw, "size") || strings.Contains(lowerRaw, "large") || strings.Contains(lowerRaw, "body")) {
			hint = "（本地参考图 base64 请求体可能过大，建议开启自动压缩或使用图片直链 URL）"
		}
		return "", rawStr, fmt.Errorf("API 返回错误 (HTTP %d)%s: %s", resp.StatusCode, hint, truncateStr(rawStr, 500))
	}

	var parsed CreateImageResponse
	if err := json.Unmarshal(rawBytes, &parsed); err != nil {
		return "", rawStr, fmt.Errorf("解析响应 JSON 失败: %w (响应内容: %s)", err, truncateStr(rawStr, 300))
	}

	taskID := strings.TrimSpace(parsed.ID)
	if taskID == "" {
		taskID = strings.TrimSpace(parsed.TaskID)
	}
	if taskID == "" {
		taskID = strings.TrimSpace(parsed.Data.ID)
	}
	if taskID == "" {
		taskID = strings.TrimSpace(parsed.Data.TaskID)
	}
	if taskID == "" {
		return "", rawStr, fmt.Errorf("API 未返回有效的任务 ID，原始响应: %s", truncateStr(rawStr, 400))
	}

	return taskID, rawStr, nil
}

// GetTask queries the asynchronous task status via GET /v1/tasks/{id}.
func (c *DuomiClient) GetTask(ctx context.Context, baseURL, apiKey, taskID string) (*TaskQueryResponse, string, error) {
	apiKey = NormalizeAPIKey(apiKey)
	if apiKey == "" {
		return nil, "", errors.New("未配置 API Key")
	}
	taskID = strings.TrimSpace(taskID)
	if taskID == "" {
		return nil, "", errors.New("任务 ID 不能为空")
	}

	endpoint := strings.TrimRight(strings.TrimSpace(baseURL), "/")
	if endpoint == "" {
		endpoint = "https://duomiapi.com"
	}
	endpoint += "/v1/tasks/" + url.PathEscape(taskID)

	httpReq, err := http.NewRequestWithContext(ctx, http.MethodGet, endpoint, nil)
	if err != nil {
		return nil, "", fmt.Errorf("创建查询请求失败: %w", err)
	}
	httpReq.Header.Set("Authorization", apiKey)
	httpReq.Header.Set("Accept", "application/json")
	httpReq.Header.Set("User-Agent", "DuomiAPI-Image-Gen-Go/1.0")

	resp, err := c.httpClient.Do(httpReq)
	if err != nil {
		return nil, "", fmt.Errorf("查询任务网络请求失败: %w", err)
	}
	defer resp.Body.Close()

	rawBytes, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, "", fmt.Errorf("读取任务响应失败: %w", err)
	}
	rawStr := string(rawBytes)

	if resp.StatusCode >= 400 {
		return nil, rawStr, fmt.Errorf("查询任务返回 HTTP %d: %s", resp.StatusCode, truncateStr(rawStr, 400))
	}

	var parsed TaskQueryResponse
	if err := json.Unmarshal(rawBytes, &parsed); err != nil {
		return nil, rawStr, fmt.Errorf("解析任务状态 JSON 失败: %w (内容: %s)", err, truncateStr(rawStr, 300))
	}
	if parsed.ID == "" {
		parsed.ID = taskID
	}
	return &parsed, rawStr, nil
}

// DownloadImage downloads an image from a remote URL and saves it inside imagesDir.
func (c *DuomiClient) DownloadImage(ctx context.Context, remoteURL, imagesDir, taskID string, index int, suggestedName string) (string, error) {
	dlClient := &http.Client{Timeout: 120 * time.Second}
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, remoteURL, nil)
	if err != nil {
		return "", err
	}
	req.Header.Set("User-Agent", "DuomiAPI-Image-Gen-Go/1.0")

	resp, err := dlClient.Do(req)
	if err != nil {
		return "", fmt.Errorf("下载图片失败: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode >= 400 {
		return "", fmt.Errorf("下载图片返回 HTTP %d", resp.StatusCode)
	}

	ext := detectImageExt(remoteURL, suggestedName, resp.Header.Get("Content-Type"))
	shortID := sanitizeFilename(taskID)
	if len(shortID) > 12 {
		shortID = shortID[:12]
	}
	timestamp := time.Now().Format("20060102_150405")
	localFile := fmt.Sprintf("%s_%s_%d%s", timestamp, shortID, index+1, ext)
	fullPath := filepath.Join(imagesDir, localFile)

	out, err := os.Create(fullPath)
	if err != nil {
		return "", fmt.Errorf("创建本地图片文件失败: %w", err)
	}
	defer out.Close()

	if _, err := io.Copy(out, resp.Body); err != nil {
		return "", fmt.Errorf("写入本地图片文件失败: %w", err)
	}
	return localFile, nil
}

// SaveBase64Image decodes base64 image data and writes it into imagesDir.
func SaveBase64Image(b64Data, imagesDir, taskID string, index int) (string, error) {
	raw := strings.TrimSpace(b64Data)
	ext := ".png"
	if strings.HasPrefix(raw, "data:image/") {
		if comma := strings.Index(raw, ","); comma != -1 {
			header := raw[:comma]
			if strings.Contains(header, "jpeg") || strings.Contains(header, "jpg") {
				ext = ".jpg"
			} else if strings.Contains(header, "webp") {
				ext = ".webp"
			}
			raw = raw[comma+1:]
		}
	}
	decoded, err := base64.StdEncoding.DecodeString(raw)
	if err != nil {
		return "", fmt.Errorf("解码 base64 图片失败: %w", err)
	}

	shortID := sanitizeFilename(taskID)
	if len(shortID) > 12 {
		shortID = shortID[:12]
	}
	timestamp := time.Now().Format("20060102_150405")
	localFile := fmt.Sprintf("%s_%s_%d%s", timestamp, shortID, index+1, ext)
	fullPath := filepath.Join(imagesDir, localFile)

	if err := os.WriteFile(fullPath, decoded, 0644); err != nil {
		return "", err
	}
	return localFile, nil
}

// EncodeLocalFileOrURL converts a local file path to a data:image/...;base64 string,
// or returns the string unchanged if it's already a URL or data URI.
func EncodeLocalFileOrURL(input string) (string, error) {
	trimmed := strings.TrimSpace(input)
	if trimmed == "" {
		return "", nil
	}
	if strings.HasPrefix(trimmed, "http://") || strings.HasPrefix(trimmed, "https://") || strings.HasPrefix(trimmed, "data:image/") {
		return trimmed, nil
	}
	info, err := os.Stat(trimmed)
	if err != nil || info.IsDir() {
		return "", fmt.Errorf("参考图文件不存在或无法读取: %s", trimmed)
	}
	data, err := os.ReadFile(trimmed)
	if err != nil {
		return "", fmt.Errorf("读取参考图文件失败: %w", err)
	}
	ext := strings.ToLower(strings.TrimPrefix(filepath.Ext(trimmed), "."))
	mime := "png"
	switch ext {
	case "jpg", "jpeg":
		mime = "jpeg"
	case "webp":
		mime = "webp"
	case "gif":
		mime = "gif"
	case "bmp":
		mime = "bmp"
	}
	return fmt.Sprintf("data:image/%s;base64,%s", mime, base64.StdEncoding.EncodeToString(data)), nil
}

func detectImageExt(remoteURL, suggestedName, contentType string) string {
	for _, candidate := range []string{suggestedName, remoteURL} {
		if u, err := url.Parse(candidate); err == nil && u.Path != "" {
			ext := strings.ToLower(filepath.Ext(u.Path))
			switch ext {
			case ".png", ".jpg", ".jpeg", ".webp", ".gif":
				return ext
			}
		}
	}
	ct := strings.ToLower(contentType)
	switch {
	case strings.Contains(ct, "jpeg"), strings.Contains(ct, "jpg"):
		return ".jpg"
	case strings.Contains(ct, "webp"):
		return ".webp"
	case strings.Contains(ct, "gif"):
		return ".gif"
	default:
		return ".png"
	}
}

func sanitizeFilename(s string) string {
	var b strings.Builder
	for _, r := range s {
		if (r >= 'a' && r <= 'z') || (r >= 'A' && r <= 'Z') || (r >= '0' && r <= '9') || r == '-' || r == '_' {
			b.WriteRune(r)
		}
	}
	if b.Len() == 0 {
		return "task"
	}
	return b.String()
}

func truncateStr(s string, maxLen int) string {
	if len(s) <= maxLen {
		return s
	}
	return s[:maxLen] + "..."
}
