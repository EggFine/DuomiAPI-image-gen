package main

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"image"
	"image/color"
	"image/draw"
	_ "image/gif"
	"image/jpeg"
	_ "image/png"
	"io"
	"math"
	"mime/multipart"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"time"
)

// CreateImageRequest matches the OpenAPI schema from api-192667743:
// POST /v1/images/generations?async=true
type CreateImageRequest struct {
	Model                 string            `json:"model"`
	Prompt                string            `json:"prompt"`
	Size                  string            `json:"size,omitempty"`
	Image                 []string          `json:"image,omitempty"`
	Quality               string            `json:"quality,omitempty"`
	Background            string            `json:"background,omitempty"`
	N                     int               `json:"n,omitempty"`
	Oversea               bool              `json:"oversea"`
	CallbackURL           string            `json:"callback_url,omitempty"`
	RefMode               string            `json:"-"` // "upload" (default) | "compress_base64" | "raw_base64"
	HostOpts              ImageHostOptions  `json:"-"`
	DisableCompatFallback bool              `json:"-"`
}

// CreateTaskResult holds detailed task creation metadata including any compatibility fallback notice.
type CreateTaskResult struct {
	TaskID      string
	RawResponse string
	WarningMsg  string
	ActualSize  string
}

// ImageHostOptions configures how local reference images are uploaded to an image host.
type ImageHostOptions struct {
	Provider        string // "auto", "litterbox", "catbox", "tmpfiles", "uguu", "0x0", "custom"
	LitterboxExpiry string // "1h", "12h", "24h", "72h"
	CustomURL       string
	CustomField     string
	CustomAuth      string
	CustomJSONPath  string
}

func ImageHostOptionsFromConfig(cfg AppConfig) ImageHostOptions {
	return ImageHostOptions{
		Provider:        cfg.ImageHostProvider,
		LitterboxExpiry: cfg.LitterboxExpiry,
		CustomURL:       cfg.CustomUploadURL,
		CustomField:     cfg.CustomUploadField,
		CustomAuth:      cfg.CustomUploadAuthHeader,
		CustomJSONPath:  cfg.CustomUploadJSONPath,
	}
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

type cachedUploadEntry struct {
	url       string
	provider  string
	expiresAt time.Time
}

// DuomiClient interacts with DuomiAPI image generation endpoints.
type DuomiClient struct {
	httpClient  *http.Client
	uploadMu    sync.Mutex
	uploadCache map[string]cachedUploadEntry
}

func NewDuomiClient() *DuomiClient {
	return &DuomiClient{
		httpClient: &http.Client{
			Timeout: 90 * time.Second,
		},
		uploadCache: make(map[string]cachedUploadEntry),
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

// ValidateSize checks whether the size string adheres to DuomiAPI's specification.
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

// InferAspectRatioFromSize returns the closest DuomiAPI aspect ratio string and standard OpenAI resolution.
func InferAspectRatioFromSize(size string) (ratioStr string, stdSize string) {
	s := strings.TrimSpace(size)
	if s == "" || s == "auto" {
		return "auto", "1024x1024"
	}
	if validAspectRatios[s] {
		for _, grp := range GetRatioPresets() {
			if grp.Ratio == s {
				if grp.AspectW > grp.AspectH {
					return s, "1792x1024"
				} else if grp.AspectH > grp.AspectW {
					return s, "1024x1792"
				}
				return s, "1024x1024"
			}
		}
		return s, "1024x1024"
	}

	for _, grp := range GetRatioPresets() {
		for _, item := range grp.Sizes {
			if strings.EqualFold(item.Value, s) && grp.Ratio != "auto" {
				std := "1024x1024"
				if grp.AspectW > grp.AspectH {
					std = "1792x1024"
				} else if grp.AspectH > grp.AspectW {
					std = "1024x1792"
				}
				return grp.Ratio, std
			}
		}
	}

	parts := strings.Split(strings.ToLower(s), "x")
	if len(parts) != 2 {
		return "1:1", "1024x1024"
	}
	w, err1 := strconv.Atoi(strings.TrimSpace(parts[0]))
	h, err2 := strconv.Atoi(strings.TrimSpace(parts[1]))
	if err1 != nil || err2 != nil || w <= 0 || h <= 0 {
		return "1:1", "1024x1024"
	}

	std := "1024x1024"
	if w > h {
		std = "1792x1024"
	} else if h > w {
		std = "1024x1792"
	}

	target := float64(w) / float64(h)
	bestRatio := "1:1"
	bestDiff := math.MaxFloat64
	for _, grp := range GetRatioPresets() {
		if grp.AspectW <= 0 || grp.AspectH <= 0 {
			continue
		}
		r := float64(grp.AspectW) / float64(grp.AspectH)
		diff := math.Abs(target - r)
		if diff < bestDiff {
			bestDiff = diff
			bestRatio = grp.Ratio
		}
	}
	return bestRatio, std
}

// DecodeDataURI extracts raw image bytes and extension from a data:image/...;base64,... string.
func DecodeDataURI(dataURI string) ([]byte, string, error) {
	raw := strings.TrimSpace(dataURI)
	ext := ".jpg"
	b64Part := raw
	if strings.HasPrefix(raw, "data:image/") {
		if comma := strings.Index(raw, ","); comma != -1 {
			header := strings.ToLower(raw[:comma])
			switch {
			case strings.Contains(header, "png"):
				ext = ".png"
			case strings.Contains(header, "webp"):
				ext = ".webp"
			case strings.Contains(header, "gif"):
				ext = ".gif"
			case strings.Contains(header, "bmp"):
				ext = ".bmp"
			default:
				ext = ".jpg"
			}
			b64Part = raw[comma+1:]
		}
	}
	imgBytes, err := base64.StdEncoding.DecodeString(strings.TrimSpace(b64Part))
	if err != nil || len(imgBytes) == 0 {
		return nil, "", fmt.Errorf("解码参考图 Base64 失败: %w", err)
	}
	return imgBytes, ext, nil
}

// EncodeBytesToDataURI wraps raw image bytes as a data:image/<mime>;base64,... string without altering pixels.
func EncodeBytesToDataURI(data []byte, ext string) string {
	clean := strings.ToLower(strings.TrimPrefix(strings.TrimSpace(ext), "."))
	mime := "jpeg"
	switch clean {
	case "png":
		mime = "png"
	case "webp":
		mime = "webp"
	case "gif":
		mime = "gif"
	case "bmp":
		mime = "bmp"
	case "jpg", "jpeg":
		mime = "jpeg"
	}
	return fmt.Sprintf("data:image/%s;base64,%s", mime, base64.StdEncoding.EncodeToString(data))
}

// CompressImageBytesToBase64 is an OPTIONAL local-only image processor (used when RefImageMode == "compress_base64").
// It decodes PNG/JPEG/GIF in pure Go, strips EXIF/ICC metadata, scales down if exceeding maxDim, and encodes JPEG Base64.
func CompressImageBytesToBase64(data []byte, maxDim int, quality int) (dataURI string, encodedBytes int, outW int, outH int, err error) {
	if maxDim < 256 {
		maxDim = 1536
	}
	if quality < 40 || quality > 98 {
		quality = 85
	}
	src, _, decErr := image.Decode(bytes.NewReader(data))
	if decErr != nil {
		// If format is WebP or unsupported by Go stdlib decoder, return raw data URI gracefully
		return EncodeBytesToDataURI(data, ".webp"), len(data), 0, 0, nil
	}

	bounds := src.Bounds()
	srcW := bounds.Dx()
	srcH := bounds.Dy()
	if srcW <= 0 || srcH <= 0 {
		return "", 0, 0, 0, errors.New("无效的图片尺寸")
	}

	dstW, dstH := srcW, srcH
	if dstW > maxDim || dstH > maxDim {
		if dstW >= dstH {
			dstH = int(math.Max(1, math.Round(float64(srcH)*float64(maxDim)/float64(srcW))))
			dstW = maxDim
		} else {
			dstW = int(math.Max(1, math.Round(float64(srcW)*float64(maxDim)/float64(srcH))))
			dstH = maxDim
		}
	}

	// Composite onto opaque white background and bilinear resize
	dst := image.NewRGBA(image.Rect(0, 0, dstW, dstH))
	draw.Draw(dst, dst.Bounds(), &image.Uniform{C: color.White}, image.Point{}, draw.Src)

	if dstW == srcW && dstH == srcH {
		draw.Draw(dst, dst.Bounds(), src, bounds.Min, draw.Over)
	} else {
		resizeBilinear(src, dst)
	}

	var buf bytes.Buffer
	if encErr := jpeg.Encode(&buf, dst, &jpeg.Options{Quality: quality}); encErr != nil {
		return "", 0, 0, 0, fmt.Errorf("JPEG 压缩编码失败: %w", encErr)
	}
	jpgBytes := buf.Bytes()
	return "data:image/jpeg;base64," + base64.StdEncoding.EncodeToString(jpgBytes), len(jpgBytes), dstW, dstH, nil
}

// resizeBilinear performs smooth pure-Go bilinear image scaling onto an opaque white-initialized RGBA canvas.
func resizeBilinear(src image.Image, dst *image.RGBA) {
	sb := src.Bounds()
	srcW, srcH := sb.Dx(), sb.Dy()
	dstW, dstH := dst.Bounds().Dx(), dst.Bounds().Dy()

	// Convert src onto an RGBA buffer once for fast pixel sampling
	srcRGBA := image.NewRGBA(image.Rect(0, 0, srcW, srcH))
	draw.Draw(srcRGBA, srcRGBA.Bounds(), &image.Uniform{C: color.White}, image.Point{}, draw.Src)
	draw.Draw(srcRGBA, srcRGBA.Bounds(), src, sb.Min, draw.Over)

	xRatio := float64(srcW-1) / math.Max(1, float64(dstW-1))
	yRatio := float64(srcH-1) / math.Max(1, float64(dstH-1))

	for y := 0; y < dstH; y++ {
		sy := float64(y) * yRatio
		y0 := int(sy)
		y1 := y0 + 1
		if y1 >= srcH {
			y1 = srcH - 1
		}
		wy := sy - float64(y0)

		for x := 0; x < dstW; x++ {
			sx := float64(x) * xRatio
			x0 := int(sx)
			x1 := x0 + 1
			if x1 >= srcW {
				x1 = srcW - 1
			}
			wx := sx - float64(x0)

			i00 := srcRGBA.PixOffset(x0, y0)
			i10 := srcRGBA.PixOffset(x1, y0)
			i01 := srcRGBA.PixOffset(x0, y1)
			i11 := srcRGBA.PixOffset(x1, y1)

			di := dst.PixOffset(x, y)
			for c := 0; c < 3; c++ {
				v00 := float64(srcRGBA.Pix[i00+c])
				v10 := float64(srcRGBA.Pix[i10+c])
				v01 := float64(srcRGBA.Pix[i01+c])
				v11 := float64(srcRGBA.Pix[i11+c])
				top := v00*(1-wx) + v10*wx
				bot := v01*(1-wx) + v11*wx
				val := top*(1-wy) + bot*wy
				dst.Pix[di+c] = uint8(math.Max(0, math.Min(255, math.Round(val))))
			}
			dst.Pix[di+3] = 255
		}
	}
}

// UploadBytesToImageHost uploads original lossless image bytes to the selected public or custom image host,
// returning (directURL, providerName, error).
func (c *DuomiClient) UploadBytesToImageHost(ctx context.Context, imgBytes []byte, ext string, opts ImageHostOptions) (string, string, error) {
	if len(imgBytes) == 0 {
		return "", "", errors.New("参考图内容为空")
	}
	cleanExt := strings.ToLower(strings.TrimSpace(ext))
	if cleanExt == "" || !strings.HasPrefix(cleanExt, ".") {
		cleanExt = "." + strings.TrimPrefix(cleanExt, ".")
	}
	if cleanExt == "." {
		cleanExt = ".jpg"
	}

	provider := strings.ToLower(strings.TrimSpace(opts.Provider))
	if provider == "" {
		provider = "auto"
	}
	expiry := strings.TrimSpace(opts.LitterboxExpiry)
	if expiry == "" {
		expiry = "12h"
	}

	sum := sha256.Sum256(imgBytes)
	cacheKey := fmt.Sprintf("%s|%s|%s|%s", hex.EncodeToString(sum[:]), provider, expiry, strings.TrimSpace(opts.CustomURL))

	c.uploadMu.Lock()
	if entry, ok := c.uploadCache[cacheKey]; ok && entry.url != "" && time.Now().Before(entry.expiresAt) {
		c.uploadMu.Unlock()
		return entry.url, entry.provider, nil
	}
	c.uploadMu.Unlock()

	fileName := "ref_" + hex.EncodeToString(sum[:])[:10] + cleanExt

	type namedUploader struct {
		name string
		ttl  time.Duration
		fn   func(context.Context, []byte, string) (string, error)
	}

	litterboxTTL := 50 * time.Minute
	switch expiry {
	case "12h":
		litterboxTTL = 11 * time.Hour
	case "24h":
		litterboxTTL = 23 * time.Hour
	case "72h":
		litterboxTTL = 70 * time.Hour
	}

	allBuiltIn := map[string]namedUploader{
		"litterbox": {
			name: "Litterbox (" + expiry + ")",
			ttl:  litterboxTTL,
			fn: func(uCtx context.Context, b []byte, name string) (string, error) {
				return uploadToLitterbox(uCtx, b, name, expiry)
			},
		},
		"catbox": {
			name: "Catbox",
			ttl:  24 * time.Hour,
			fn:   uploadToCatbox,
		},
		"tmpfiles": {
			name: "Tmpfiles",
			ttl:  50 * time.Minute,
			fn:   uploadToTmpFiles,
		},
		"uguu": {
			name: "Uguu",
			ttl:  2 * time.Hour,
			fn:   uploadToUguu,
		},
		"0x0": {
			name: "0x0.st",
			ttl:  12 * time.Hour,
			fn:   uploadTo0x0,
		},
	}

	var pipeline []namedUploader
	switch provider {
	case "custom":
		if strings.TrimSpace(opts.CustomURL) == "" {
			return "", "", errors.New("已选择自定义图床，但尚未在设置中配置自定义图床上传接口 URL")
		}
		pipeline = append(pipeline, namedUploader{
			name: "自定义图床",
			ttl:  12 * time.Hour,
			fn: func(uCtx context.Context, b []byte, name string) (string, error) {
				return uploadToCustomHost(uCtx, b, name, opts)
			},
		})
	case "litterbox", "catbox", "tmpfiles", "uguu", "0x0":
		pipeline = append(pipeline, allBuiltIn[provider])
	default: // "auto" failover across reliable image hosts
		if strings.TrimSpace(opts.CustomURL) != "" {
			pipeline = append(pipeline, namedUploader{
				name: "自定义图床",
				ttl:  12 * time.Hour,
				fn: func(uCtx context.Context, b []byte, name string) (string, error) {
					return uploadToCustomHost(uCtx, b, name, opts)
				},
			})
		}
		pipeline = append(pipeline,
			allBuiltIn["litterbox"],
			allBuiltIn["catbox"],
			allBuiltIn["tmpfiles"],
			allBuiltIn["uguu"],
			allBuiltIn["0x0"],
		)
	}

	var errs []string
	for _, up := range pipeline {
		upCtx, cancel := context.WithTimeout(ctx, 12*time.Second)
		pubURL, upErr := up.fn(upCtx, imgBytes, fileName)
		cancel()
		if upErr == nil && (strings.HasPrefix(pubURL, "https://") || strings.HasPrefix(pubURL, "http://")) {
			c.uploadMu.Lock()
			c.uploadCache[cacheKey] = cachedUploadEntry{
				url:       pubURL,
				provider:  up.name,
				expiresAt: time.Now().Add(up.ttl),
			}
			c.uploadMu.Unlock()
			return pubURL, up.name, nil
		}
		if upErr != nil {
			errs = append(errs, fmt.Sprintf("%s: %v", up.name, upErr))
		}
	}
	return "", "", fmt.Errorf("图床上传失败 (%s)", strings.Join(errs, "; "))
}

// UploadDataURIToPublicHost preserves backward compatibility while delegating to UploadBytesToImageHost.
func (c *DuomiClient) UploadDataURIToPublicHost(ctx context.Context, dataURI string) (string, error) {
	raw := strings.TrimSpace(dataURI)
	if strings.HasPrefix(raw, "http://") || strings.HasPrefix(raw, "https://") {
		return raw, nil
	}
	imgBytes, ext, err := DecodeDataURI(raw)
	if err != nil {
		return "", err
	}
	pubURL, _, err := c.UploadBytesToImageHost(ctx, imgBytes, ext, ImageHostOptions{
		Provider:        "auto",
		LitterboxExpiry: "12h",
	})
	return pubURL, err
}

func uploadToLitterbox(ctx context.Context, data []byte, fileName string, expiry string) (string, error) {
	if expiry == "" {
		expiry = "12h"
	}
	var body bytes.Buffer
	mw := multipart.NewWriter(&body)
	_ = mw.WriteField("reqtype", "fileupload")
	_ = mw.WriteField("time", expiry)
	fw, err := mw.CreateFormFile("fileToUpload", fileName)
	if err != nil {
		return "", err
	}
	if _, err := fw.Write(data); err != nil {
		return "", err
	}
	_ = mw.Close()

	req, err := http.NewRequestWithContext(ctx, http.MethodPost, "https://litterbox.catbox.moe/resources/internals/api.php", &body)
	if err != nil {
		return "", err
	}
	req.Header.Set("Content-Type", mw.FormDataContentType())
	req.Header.Set("User-Agent", "DuomiAPI-Image-Studio/2.0")

	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()
	respBytes, _ := io.ReadAll(io.LimitReader(resp.Body, 4096))
	urlStr := strings.TrimSpace(string(respBytes))
	if resp.StatusCode == http.StatusOK && strings.HasPrefix(urlStr, "https://") {
		return urlStr, nil
	}
	return "", fmt.Errorf("HTTP %d: %s", resp.StatusCode, truncateStr(urlStr, 100))
}

func uploadToCatbox(ctx context.Context, data []byte, fileName string) (string, error) {
	var body bytes.Buffer
	mw := multipart.NewWriter(&body)
	_ = mw.WriteField("reqtype", "fileupload")
	fw, err := mw.CreateFormFile("fileToUpload", fileName)
	if err != nil {
		return "", err
	}
	if _, err := fw.Write(data); err != nil {
		return "", err
	}
	_ = mw.Close()

	req, err := http.NewRequestWithContext(ctx, http.MethodPost, "https://catbox.moe/user/api.php", &body)
	if err != nil {
		return "", err
	}
	req.Header.Set("Content-Type", mw.FormDataContentType())
	req.Header.Set("User-Agent", "DuomiAPI-Image-Studio/2.0")

	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()
	respBytes, _ := io.ReadAll(io.LimitReader(resp.Body, 4096))
	urlStr := strings.TrimSpace(string(respBytes))
	if resp.StatusCode == http.StatusOK && strings.HasPrefix(urlStr, "https://") {
		return urlStr, nil
	}
	return "", fmt.Errorf("HTTP %d: %s", resp.StatusCode, truncateStr(urlStr, 100))
}

func uploadToTmpFiles(ctx context.Context, data []byte, fileName string) (string, error) {
	var body bytes.Buffer
	mw := multipart.NewWriter(&body)
	fw, err := mw.CreateFormFile("file", fileName)
	if err != nil {
		return "", err
	}
	if _, err := fw.Write(data); err != nil {
		return "", err
	}
	_ = mw.Close()

	req, err := http.NewRequestWithContext(ctx, http.MethodPost, "https://tmpfiles.org/api/v1/upload", &body)
	if err != nil {
		return "", err
	}
	req.Header.Set("Content-Type", mw.FormDataContentType())
	req.Header.Set("User-Agent", "DuomiAPI-Image-Studio/2.0")

	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()
	respBytes, _ := io.ReadAll(io.LimitReader(resp.Body, 8192))
	var parsed struct {
		Data struct {
			URL string `json:"url"`
		} `json:"data"`
	}
	if err := json.Unmarshal(respBytes, &parsed); err != nil || parsed.Data.URL == "" {
		return "", fmt.Errorf("HTTP %d", resp.StatusCode)
	}
	u := strings.Replace(parsed.Data.URL, "http://tmpfiles.org/", "https://tmpfiles.org/dl/", 1)
	u = strings.Replace(u, "https://tmpfiles.org/", "https://tmpfiles.org/dl/", 1)
	return u, nil
}

func uploadToUguu(ctx context.Context, data []byte, fileName string) (string, error) {
	var body bytes.Buffer
	mw := multipart.NewWriter(&body)
	fw, err := mw.CreateFormFile("files[]", fileName)
	if err != nil {
		return "", err
	}
	if _, err := fw.Write(data); err != nil {
		return "", err
	}
	_ = mw.Close()

	req, err := http.NewRequestWithContext(ctx, http.MethodPost, "https://uguu.se/upload", &body)
	if err != nil {
		return "", err
	}
	req.Header.Set("Content-Type", mw.FormDataContentType())
	req.Header.Set("User-Agent", "DuomiAPI-Image-Studio/2.0")

	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()
	respBytes, _ := io.ReadAll(io.LimitReader(resp.Body, 8192))
	var parsed struct {
		Files []struct {
			URL string `json:"url"`
		} `json:"files"`
	}
	if err := json.Unmarshal(respBytes, &parsed); err == nil && len(parsed.Files) > 0 && parsed.Files[0].URL != "" {
		return parsed.Files[0].URL, nil
	}
	return "", fmt.Errorf("HTTP %d", resp.StatusCode)
}

func uploadTo0x0(ctx context.Context, data []byte, fileName string) (string, error) {
	var body bytes.Buffer
	mw := multipart.NewWriter(&body)
	fw, err := mw.CreateFormFile("file", fileName)
	if err != nil {
		return "", err
	}
	if _, err := fw.Write(data); err != nil {
		return "", err
	}
	_ = mw.Close()

	req, err := http.NewRequestWithContext(ctx, http.MethodPost, "https://0x0.st", &body)
	if err != nil {
		return "", err
	}
	req.Header.Set("Content-Type", mw.FormDataContentType())
	req.Header.Set("User-Agent", "DuomiAPI-Image-Studio/2.0")

	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()
	respBytes, _ := io.ReadAll(io.LimitReader(resp.Body, 4096))
	urlStr := strings.TrimSpace(string(respBytes))
	if resp.StatusCode == http.StatusOK && strings.HasPrefix(urlStr, "https://") {
		return urlStr, nil
	}
	return "", fmt.Errorf("HTTP %d", resp.StatusCode)
}

func uploadToCustomHost(ctx context.Context, data []byte, fileName string, opts ImageHostOptions) (string, error) {
	fieldName := strings.TrimSpace(opts.CustomField)
	if fieldName == "" {
		fieldName = "file"
	}
	var body bytes.Buffer
	mw := multipart.NewWriter(&body)
	fw, err := mw.CreateFormFile(fieldName, fileName)
	if err != nil {
		return "", err
	}
	if _, err := fw.Write(data); err != nil {
		return "", err
	}
	_ = mw.Close()

	req, err := http.NewRequestWithContext(ctx, http.MethodPost, strings.TrimSpace(opts.CustomURL), &body)
	if err != nil {
		return "", err
	}
	req.Header.Set("Content-Type", mw.FormDataContentType())
	req.Header.Set("Accept", "application/json, text/plain, */*")
	req.Header.Set("User-Agent", "DuomiAPI-Image-Studio/2.0")
	if auth := strings.TrimSpace(opts.CustomAuth); auth != "" {
		req.Header.Set("Authorization", auth)
	}

	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()
	respBytes, _ := io.ReadAll(io.LimitReader(resp.Body, 65536))
	rawText := strings.TrimSpace(string(respBytes))
	if resp.StatusCode >= 400 {
		return "", fmt.Errorf("HTTP %d: %s", resp.StatusCode, truncateStr(rawText, 120))
	}
	if strings.HasPrefix(rawText, "https://") || strings.HasPrefix(rawText, "http://") {
		return rawText, nil
	}

	var jsonObj any
	if err := json.Unmarshal(respBytes, &jsonObj); err == nil {
		// Check user-specified JSON path first, then common image host paths (LskyPro, Chevereto, SM.MS, Imgur, etc.)
		candidatePaths := []string{
			strings.TrimSpace(opts.CustomJSONPath),
			"url",
			"data.url",
			"data.links.url",
			"image.url",
			"links.url",
			"result.url",
		}
		for _, p := range candidatePaths {
			if p == "" {
				continue
			}
			if val := extractJSONStringByPath(jsonObj, p); strings.HasPrefix(val, "https://") || strings.HasPrefix(val, "http://") {
				return val, nil
			}
		}
	}
	return "", fmt.Errorf("未能从自定义图床响应中解析出图片 URL: %s", truncateStr(rawText, 120))
}

func extractJSONStringByPath(root any, dotPath string) string {
	cur := root
	for _, seg := range strings.Split(dotPath, ".") {
		seg = strings.TrimSpace(seg)
		if seg == "" {
			continue
		}
		switch node := cur.(type) {
		case map[string]any:
			cur = node[seg]
		case []any:
			idx, err := strconv.Atoi(seg)
			if err != nil || idx < 0 || idx >= len(node) {
				return ""
			}
			cur = node[idx]
		default:
			return ""
		}
	}
	if s, ok := cur.(string); ok {
		return strings.TrimSpace(s)
	}
	return ""
}

func isLocalTestURL(u string) bool {
	lower := strings.ToLower(u)
	return strings.Contains(lower, "127.0.0.1") || strings.Contains(lower, "localhost")
}

func truncateUTF8Bytes(s string, maxBytes int) string {
	if len(s) <= maxBytes {
		return s
	}
	var b strings.Builder
	for _, r := range s {
		if b.Len()+len(string(r)) > maxBytes {
			break
		}
		b.WriteRune(r)
	}
	return b.String()
}

func cloneMap(m map[string]any) map[string]any {
	out := make(map[string]any, len(m))
	for k, v := range m {
		out[k] = v
	}
	return out
}

// CreateTask submits an asynchronous image generation task (backward-compatible signature).
func (c *DuomiClient) CreateTask(ctx context.Context, baseURL, apiKey string, req CreateImageRequest) (string, string, error) {
	res, err := c.CreateTaskDetailed(ctx, baseURL, apiKey, req)
	if err != nil {
		return "", res.RawResponse, err
	}
	return res.TaskID, res.RawResponse, nil
}

// CreateTaskDetailed submits an asynchronous image generation task while strictly honoring req.RefMode
// ("upload" default vs optional "compress_base64" / "raw_base64") and returning transparent fallback info.
func (c *DuomiClient) CreateTaskDetailed(ctx context.Context, baseURL, apiKey string, req CreateImageRequest) (CreateTaskResult, error) {
	var out CreateTaskResult
	apiKey = NormalizeAPIKey(apiKey)
	if apiKey == "" {
		return out, errors.New("未配置 API Key，请先在设置中填写多米 API 密钥")
	}
	req.Model = strings.TrimSpace(req.Model)
	if req.Model == "" {
		req.Model = "gpt-image-2.6-flare"
	}
	req.Prompt = strings.TrimSpace(req.Prompt)
	if req.Prompt == "" {
		return out, errors.New("提示词 (prompt) 不能为空")
	}
	if len([]rune(req.Prompt)) > 5000 {
		return out, errors.New("提示词长度超过 5000 字符上限")
	}
	if err := ValidateSize(req.Size); err != nil {
		return out, err
	}

	endpoint := strings.TrimRight(strings.TrimSpace(baseURL), "/")
	if endpoint == "" {
		endpoint = "https://duomiapi.com"
	}
	isLocalTest := isLocalTestURL(endpoint)
	endpoint += "/v1/images/generations?async=true"

	refMode := strings.TrimSpace(req.RefMode)
	if refMode == "" {
		refMode = "upload"
	}

	var resolvedImages []string
	var rawBase64Images []string
	for _, img := range req.Image {
		trimmed := strings.TrimSpace(img)
		if trimmed == "" {
			continue
		}
		if strings.HasPrefix(trimmed, "data:image/") {
			if comma := strings.Index(trimmed, ","); comma != -1 {
				rawBase64Images = append(rawBase64Images, trimmed[comma+1:])
			} else {
				rawBase64Images = append(rawBase64Images, trimmed)
			}
			// Only upload to image host when refMode == "upload" (default).
			// When user explicitly selected "compress_base64" or "raw_base64", NEVER upload to public image host!
			if refMode == "upload" && !isLocalTest {
				imgBytes, ext, decErr := DecodeDataURI(trimmed)
				if decErr != nil {
					return out, decErr
				}
				pubURL, _, upErr := c.UploadBytesToImageHost(ctx, imgBytes, ext, req.HostOpts)
				if upErr != nil {
					return out, fmt.Errorf("%w（若当前网络无法连接公网图床，可在参考图选项中切换为「压缩并转 Base64」重试）", upErr)
				}
				resolvedImages = append(resolvedImages, pubURL)
				continue
			}
		} else {
			rawBase64Images = append(rawBase64Images, trimmed)
		}
		resolvedImages = append(resolvedImages, trimmed)
	}

	basePayload := map[string]any{
		"model":   req.Model,
		"prompt":  req.Prompt,
		"oversea": req.Oversea,
	}
	if req.Size != "" {
		basePayload["size"] = req.Size
	}
	if len(resolvedImages) > 0 {
		basePayload["image"] = resolvedImages
	}
	if req.Quality != "" {
		basePayload["quality"] = req.Quality
	}
	if req.Background != "" && req.Background != "auto" {
		basePayload["background"] = req.Background
	}
	if req.CallbackURL != "" {
		basePayload["callback_url"] = req.CallbackURL
	}

	taskID, rawStr, statusCode, err := c.doPostCreateTask(ctx, endpoint, apiKey, basePayload)
	out.RawResponse = rawStr
	out.ActualSize = req.Size
	if err == nil {
		out.TaskID = taskID
		return out, nil
	}

	if !req.DisableCompatFallback && statusCode == http.StatusBadRequest && strings.Contains(strings.ToLower(rawStr), "fail_to_submit_task") {
		ratioStr, stdSize := InferAspectRatioFromSize(req.Size)
		type fallbackAttempt struct {
			payload map[string]any
			size    string
			note    string
		}
		var attempts []fallbackAttempt

		if req.Size != "" && req.Size != ratioStr {
			p1 := cloneMap(basePayload)
			p1["size"] = ratioStr
			attempts = append(attempts, fallbackAttempt{
				payload: p1,
				size:    ratioStr,
				note:    fmt.Sprintf("上游渠道拒绝尺寸 %s，已自动兼容切换为比例 %s 提交成功", req.Size, ratioStr),
			})
		}

		if req.Size != "" && req.Size != stdSize {
			p2 := cloneMap(basePayload)
			p2["size"] = stdSize
			attempts = append(attempts, fallbackAttempt{
				payload: p2,
				size:    stdSize,
				note:    fmt.Sprintf("上游渠道拒绝尺寸 %s，已自动兼容切换为官方标准尺寸 %s 提交成功", req.Size, stdSize),
			})
		}

		if len(req.Prompt) > 4800 {
			shortPrompt := truncateUTF8Bytes(req.Prompt, 4800)
			p3 := cloneMap(basePayload)
			p3["prompt"] = shortPrompt
			attempts = append(attempts, fallbackAttempt{
				payload: p3,
				size:    req.Size,
				note:    "提示词 UTF-8 字节超 5000，已自动按安全字符边界精简并提交成功",
			})

			if req.Size != "" && req.Size != ratioStr {
				p4 := cloneMap(p3)
				p4["size"] = ratioStr
				attempts = append(attempts, fallbackAttempt{
					payload: p4,
					size:    ratioStr,
					note:    fmt.Sprintf("已自动兼容切换为比例 %s 并对齐 4800 UTF-8 字节上限提交成功", ratioStr),
				})
			}
		}

		if len(resolvedImages) > 0 && strings.HasPrefix(resolvedImages[0], "data:image/") && len(rawBase64Images) > 0 {
			p5 := cloneMap(basePayload)
			p5["image"] = rawBase64Images
			actualS := req.Size
			if req.Size != "" && req.Size != ratioStr {
				p5["size"] = ratioStr
				actualS = ratioStr
			}
			attempts = append(attempts, fallbackAttempt{
				payload: p5,
				size:    actualS,
				note:    "已自动剥离 Base64 DataURI 前缀兼容提交成功",
			})
		}

		for _, att := range attempts {
			if fbID, fbRaw, _, fbErr := c.doPostCreateTask(ctx, endpoint, apiKey, att.payload); fbErr == nil && fbID != "" {
				out.TaskID = fbID
				out.RawResponse = fbRaw
				out.ActualSize = att.size
				out.WarningMsg = att.note
				return out, nil
			}
		}
	}

	return out, err
}

func (c *DuomiClient) doPostCreateTask(ctx context.Context, endpoint, apiKey string, payload map[string]any) (string, string, int, error) {
	bodyBytes, err := json.Marshal(payload)
	if err != nil {
		return "", "", 0, fmt.Errorf("序列化请求失败: %w", err)
	}

	httpReq, err := http.NewRequestWithContext(ctx, http.MethodPost, endpoint, bytes.NewReader(bodyBytes))
	if err != nil {
		return "", "", 0, fmt.Errorf("创建 HTTP 请求失败: %w", err)
	}
	httpReq.Header.Set("Authorization", apiKey)
	httpReq.Header.Set("Content-Type", "application/json")
	httpReq.Header.Set("Accept", "application/json")
	httpReq.Header.Set("User-Agent", "DuomiAPI-Image-Studio/2.0")

	resp, err := c.httpClient.Do(httpReq)
	if err != nil {
		return "", "", 0, fmt.Errorf("请求多米 API 失败: %w", err)
	}
	defer resp.Body.Close()

	rawBytes, err := io.ReadAll(resp.Body)
	if err != nil {
		return "", "", resp.StatusCode, fmt.Errorf("读取响应失败: %w", err)
	}
	rawStr := string(rawBytes)

	if resp.StatusCode >= 400 {
		hint := ""
		lowerRaw := strings.ToLower(rawStr)
		if resp.StatusCode == 401 || resp.StatusCode == 403 {
			hint = "（请检查 API Key 是否正确且账户余额充足；注意无需加 Bearer 前缀）"
		} else if strings.Contains(lowerRaw, "fail_to_submit_task") {
			hint = "（上游渠道提交失败：若使用了 Base64 参考图，建议切换为默认的「自动传图床」模式；若提示词超 1600 汉字，建议精简；或尝试 2K / 仅传比例）"
		} else if (resp.StatusCode == 400 || resp.StatusCode == 413 || resp.StatusCode == 422) &&
			(strings.Contains(lowerRaw, "size") || strings.Contains(lowerRaw, "large") || strings.Contains(lowerRaw, "body")) {
			hint = "（Base64 请求体过大，建议切换为「自动传图床」或「压缩并转 Base64」）"
		}
		return "", rawStr, resp.StatusCode, fmt.Errorf("API 返回错误 (HTTP %d)%s: %s", resp.StatusCode, hint, truncateStr(rawStr, 500))
	}

	var parsed CreateImageResponse
	if err := json.Unmarshal(rawBytes, &parsed); err != nil {
		return "", rawStr, resp.StatusCode, fmt.Errorf("解析响应 JSON 失败: %w (响应内容: %s)", err, truncateStr(rawStr, 300))
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
		return "", rawStr, resp.StatusCode, fmt.Errorf("API 未返回有效的任务 ID，原始响应: %s", truncateStr(rawStr, 400))
	}

	return taskID, rawStr, resp.StatusCode, nil
}

// ConnectivityTestResult reports endpoint reachability, auth status, and round-trip latency.
type ConnectivityTestResult struct {
	OK        bool   `json:"ok"`
	LatencyMs int64  `json:"latency_ms"`
	Status    int    `json:"status"`
	Message   string `json:"message"`
}

// TestConnection verifies whether BaseURL is reachable and whether the API Key passes DuomiAPI authentication.
func (c *DuomiClient) TestConnection(ctx context.Context, baseURL, apiKey string) ConnectivityTestResult {
	apiKey = NormalizeAPIKey(apiKey)
	if apiKey == "" {
		return ConnectivityTestResult{OK: false, Message: "请先输入 API Key"}
	}
	endpoint := strings.TrimRight(strings.TrimSpace(baseURL), "/")
	if endpoint == "" {
		endpoint = "https://duomiapi.com"
	}
	probeURL := endpoint + "/v1/tasks/duomi-studio-auth-check"

	start := time.Now()
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, probeURL, nil)
	if err != nil {
		return ConnectivityTestResult{OK: false, Message: "无效的接口地址: " + err.Error()}
	}
	req.Header.Set("Authorization", apiKey)
	req.Header.Set("Accept", "application/json")
	req.Header.Set("User-Agent", "DuomiAPI-Image-Studio/2.0")

	resp, err := c.httpClient.Do(req)
	latency := time.Since(start).Milliseconds()
	if err != nil {
		return ConnectivityTestResult{
			OK:        false,
			LatencyMs: latency,
			Message:   "网络连接失败: " + err.Error(),
		}
	}
	defer resp.Body.Close()
	rawBytes, _ := io.ReadAll(io.LimitReader(resp.Body, 2048))
	rawStr := strings.ToLower(strings.TrimSpace(string(rawBytes)))

	if resp.StatusCode == http.StatusUnauthorized || resp.StatusCode == http.StatusForbidden ||
		strings.Contains(rawStr, "invalid_api_key") || strings.Contains(rawStr, "unauthorized") || strings.Contains(rawStr, "无效的令牌") {
		return ConnectivityTestResult{
			OK:        false,
			LatencyMs: latency,
			Status:    resp.StatusCode,
			Message:   fmt.Sprintf("连接已建立 (%dms)，但密钥鉴权未通过 (HTTP %d)，请检查 API Key 是否正确", latency, resp.StatusCode),
		}
	}

	return ConnectivityTestResult{
		OK:        true,
		LatencyMs: latency,
		Status:    resp.StatusCode,
		Message:   fmt.Sprintf("连接正常 · 鉴权通过 · 响应延迟 %d ms", latency),
	}
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
	httpReq.Header.Set("User-Agent", "DuomiAPI-Image-Studio/2.0")

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
	req.Header.Set("User-Agent", "DuomiAPI-Image-Studio/2.0")

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

// EncodeLocalFileOrURL processes a local file path or URL according to mode:
// - "upload" (default): returns data URI for CreateTaskDetailed to upload losslessly, or direct URL if already http(s)
// - "compress_base64": compresses & strips metadata locally in pure Go, returning compact JPEG data URI
// - "raw_base64": encodes raw file bytes to data URI without modification
func EncodeLocalFileOrURL(input string) (string, error) {
	return ProcessLocalFileOrURL(input, "raw_base64", 1536, 85)
}

func ProcessLocalFileOrURL(input string, mode string, maxDim int, quality int) (string, error) {
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
	ext := filepath.Ext(trimmed)
	if mode == "compress_base64" {
		uri, _, _, _, cErr := CompressImageBytesToBase64(data, maxDim, quality)
		if cErr == nil && uri != "" {
			return uri, nil
		}
	}
	return EncodeBytesToDataURI(data, ext), nil
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
