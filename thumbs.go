package main

import (
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"image"
	"image/color"
	_ "image/gif"
	"image/jpeg"
	"image/png"
	"math"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"
)

// ThumbnailCache generates and caches lightweight Web-ready thumbnails in duomi_data/thumbs/
// with bounded concurrency and per-key singleflight deduplication.
type ThumbnailCache struct {
	imagesDir string
	thumbsDir string
	logger    *AppLogger

	sem chan struct{}

	inflightMu sync.Mutex
	inflight   map[string]*sync.Mutex
}

// NewThumbnailCache initializes a bounded thumbnail generator & disk cache.
func NewThumbnailCache(imagesDir, thumbsDir string, logger *AppLogger) *ThumbnailCache {
	_ = os.MkdirAll(thumbsDir, 0755)
	return &ThumbnailCache{
		imagesDir: imagesDir,
		thumbsDir: thumbsDir,
		logger:    logger,
		sem:       make(chan struct{}, 4), // cap concurrent 4K decodes to avoid RAM spikes
		inflight:  make(map[string]*sync.Mutex),
	}
}

func (tc *ThumbnailCache) lockKey(key string) func() {
	tc.inflightMu.Lock()
	mu, ok := tc.inflight[key]
	if !ok {
		mu = &sync.Mutex{}
		tc.inflight[key] = mu
	}
	tc.inflightMu.Unlock()

	mu.Lock()
	return func() {
		mu.Unlock()
	}
}

// normalizeThumbWidth clamps requested width into a small fixed set of cache buckets.
func normalizeThumbWidth(reqW int) int {
	switch {
	case reqW > 0 && reqW <= 220:
		return 160
	case reqW >= 620:
		return 720
	default:
		return 480
	}
}

func thumbRelHash(relPath string) string {
	clean := filepath.ToSlash(strings.TrimPrefix(strings.TrimSpace(relPath), "/"))
	sum := sha256.Sum256([]byte(clean))
	return hex.EncodeToString(sum[:])[:16]
}

// EnsureThumbnail returns the local path to a lightweight thumbnail for relPath (under imagesDir).
// If the source format cannot be decoded (e.g. WebP) or is already compact, it returns the original path.
func (tc *ThumbnailCache) EnsureThumbnail(relPath string, requestedWidth int) (servedPath string, isThumb bool, err error) {
	fullSrc, err := resolveSafeImagePath(tc.imagesDir, relPath)
	if err != nil {
		return "", false, err
	}
	srcInfo, err := os.Stat(fullSrc)
	if err != nil || srcInfo.IsDir() {
		return "", false, os.ErrNotExist
	}

	bucket := normalizeThumbWidth(requestedWidth)
	hash := thumbRelHash(relPath)
	basePrefix := fmt.Sprintf("t_%s_w%d", hash, bucket)
	jpgPath := filepath.Join(tc.thumbsDir, basePrefix+".jpg")
	pngPath := filepath.Join(tc.thumbsDir, basePrefix+".png")

	// Fast path: check fresh cache hit without locking
	if p, ok := freshThumbPath(jpgPath, pngPath, srcInfo.ModTime()); ok {
		return p, true, nil
	}

	unlock := tc.lockKey(basePrefix)
	defer unlock()

	// Re-check after acquiring per-key singleflight lock
	if p, ok := freshThumbPath(jpgPath, pngPath, srcInfo.ModTime()); ok {
		return p, true, nil
	}

	// Acquire bounded worker slot before decoding potentially large 4K PNGs
	tc.sem <- struct{}{}
	defer func() { <-tc.sem }()

	// Quick header check: if already tiny and within target width, serve original directly
	if f, openErr := os.Open(fullSrc); openErr == nil {
		cfg, _, cfgErr := image.DecodeConfig(f)
		_ = f.Close()
		if cfgErr == nil && cfg.Width > 0 && cfg.Height > 0 &&
			cfg.Width <= bucket && cfg.Height <= bucket*2 && srcInfo.Size() <= 160*1024 {
			return fullSrc, false, nil
		}
	}

	srcFile, openErr := os.Open(fullSrc)
	if openErr != nil {
		return "", false, openErr
	}
	srcImg, format, decErr := image.Decode(srcFile)
	_ = srcFile.Close()
	if decErr != nil {
		// Gracefully fall back to original file (e.g. WebP or non-standard image)
		if tc.logger != nil {
			tc.logger.Debug("thumb", "跳过不支持解码的缩略图格式，回退原图", map[string]any{
				"rel":   relPath,
				"error": decErr.Error(),
			})
		}
		return fullSrc, false, nil
	}

	bounds := srcImg.Bounds()
	srcW, srcH := bounds.Dx(), bounds.Dy()
	if srcW <= 0 || srcH <= 0 {
		return fullSrc, false, nil
	}

	dstW, dstH := srcW, srcH
	maxEdgeH := bucket * 2 // prevent ultra-tall strips from staying huge
	if dstW > bucket {
		dstH = int(math.Max(1, math.Round(float64(srcH)*float64(bucket)/float64(srcW))))
		dstW = bucket
	}
	if dstH > maxEdgeH {
		dstW = int(math.Max(1, math.Round(float64(dstW)*float64(maxEdgeH)/float64(dstH))))
		dstH = maxEdgeH
	}

	hasAlpha := (format == "png" || format == "gif") && imageHasTransparency(srcImg)
	dst := downscaleAreaAverage(srcImg, dstW, dstH, hasAlpha)

	var buf bytes.Buffer
	targetPath := jpgPath
	stalePath := pngPath
	if hasAlpha {
		targetPath = pngPath
		stalePath = jpgPath
		enc := png.Encoder{CompressionLevel: png.BestSpeed}
		if err := enc.Encode(&buf, dst); err != nil {
			return fullSrc, false, nil
		}
	} else {
		if err := jpeg.Encode(&buf, dst, &jpeg.Options{Quality: 82}); err != nil {
			return fullSrc, false, nil
		}
	}

	_ = os.MkdirAll(tc.thumbsDir, 0755)
	if err := writeBytesAtomic(targetPath, buf.Bytes()); err != nil {
		if tc.logger != nil {
			tc.logger.Warn("thumb", "写入缩略图缓存失败，回退原图", map[string]any{
				"rel":   relPath,
				"error": err.Error(),
			})
		}
		return fullSrc, false, nil
	}
	_ = os.Remove(stalePath)
	return targetPath, true, nil
}

// PrewarmAsync eagerly generates the default gallery thumbnail in a background goroutine.
func (tc *ThumbnailCache) PrewarmAsync(relPath string) {
	if tc == nil || strings.TrimSpace(relPath) == "" {
		return
	}
	go func(p string) {
		_, _, _ = tc.EnsureThumbnail(p, 480)
	}(relPath)
}

// RemoveThumbnailsForRelPath deletes all cached width variants for a given image relPath.
func RemoveThumbnailsForRelPath(thumbsDir, relPath string) {
	if thumbsDir == "" || strings.TrimSpace(relPath) == "" {
		return
	}
	hash := thumbRelHash(relPath)
	for _, w := range []int{160, 480, 720} {
		_ = os.Remove(filepath.Join(thumbsDir, fmt.Sprintf("t_%s_w%d.jpg", hash, w)))
		_ = os.Remove(filepath.Join(thumbsDir, fmt.Sprintf("t_%s_w%d.png", hash, w)))
	}
}

func freshThumbPath(jpgPath, pngPath string, srcModTime time.Time) (string, bool) {
	for _, p := range []string{jpgPath, pngPath} {
		if info, err := os.Stat(p); err == nil && !info.IsDir() && info.Size() > 0 {
			if !info.ModTime().Before(srcModTime) {
				return p, true
			}
		}
	}
	return "", false
}

// imageHasTransparency performs a fast sampled scan to see if an image actually uses non-opaque alpha.
func imageHasTransparency(img image.Image) bool {
	b := img.Bounds()
	w, h := b.Dx(), b.Dy()
	if w <= 0 || h <= 0 {
		return false
	}
	stepX := maxInt(1, w/32)
	stepY := maxInt(1, h/32)
	switch typed := img.(type) {
	case *image.NRGBA:
		for y := b.Min.Y; y < b.Max.Y; y += stepY {
			for x := b.Min.X; x < b.Max.X; x += stepX {
				if typed.Pix[typed.PixOffset(x, y)+3] < 250 {
					return true
				}
			}
		}
		return false
	case *image.RGBA:
		for y := b.Min.Y; y < b.Max.Y; y += stepY {
			for x := b.Min.X; x < b.Max.X; x += stepX {
				if typed.Pix[typed.PixOffset(x, y)+3] < 250 {
					return true
				}
			}
		}
		return false
	case *image.YCbCr, *image.Gray:
		return false
	default:
		for y := b.Min.Y; y < b.Max.Y; y += stepY {
			for x := b.Min.X; x < b.Max.X; x += stepX {
				_, _, _, a := img.At(x, y).RGBA()
				if a < 0xf800 {
					return true
				}
			}
		}
		return false
	}
}

// downscaleAreaAverage performs fast, crisp anti-aliased box/area downsampling in pure Go
// without allocating an intermediate full-size RGBA buffer for standard image formats.
func downscaleAreaAverage(src image.Image, dstW, dstH int, preserveAlpha bool) image.Image {
	sb := src.Bounds()
	srcW, srcH := sb.Dx(), sb.Dy()
	if dstW <= 0 {
		dstW = 1
	}
	if dstH <= 0 {
		dstH = 1
	}

	dst := image.NewNRGBA(image.Rect(0, 0, dstW, dstH))
	scaleX := float64(srcW) / float64(dstW)
	scaleY := float64(srcH) / float64(dstH)

	// Cap per-box samples to 4x4 grid so 4K -> 160px remains <15ms while staying smooth and sharp
	for dy := 0; dy < dstH; dy++ {
		sy0 := sb.Min.Y + int(float64(dy)*scaleY)
		sy1 := sb.Min.Y + int(math.Ceil(float64(dy+1)*scaleY))
		if sy1 <= sy0 {
			sy1 = sy0 + 1
		}
		if sy1 > sb.Max.Y {
			sy1 = sb.Max.Y
		}
		stepY := maxInt(1, (sy1-sy0)/4)

		for dx := 0; dx < dstW; dx++ {
			sx0 := sb.Min.X + int(float64(dx)*scaleX)
			sx1 := sb.Min.X + int(math.Ceil(float64(dx+1)*scaleX))
			if sx1 <= sx0 {
				sx1 = sx0 + 1
			}
			if sx1 > sb.Max.X {
				sx1 = sb.Max.X
			}
			stepX := maxInt(1, (sx1-sx0)/4)

			var sumR, sumG, sumB, sumA, count uint64

			switch typed := src.(type) {
			case *image.NRGBA:
				for sy := sy0; sy < sy1; sy += stepY {
					rowOff := (sy - typed.Rect.Min.Y) * typed.Stride
					for sx := sx0; sx < sx1; sx += stepX {
						off := rowOff + (sx-typed.Rect.Min.X)*4
						a := uint64(typed.Pix[off+3])
						if preserveAlpha {
							sumR += uint64(typed.Pix[off]) * a
							sumG += uint64(typed.Pix[off+1]) * a
							sumB += uint64(typed.Pix[off+2]) * a
							sumA += a
						} else {
							invA := 255 - a
							sumR += (uint64(typed.Pix[off])*a + 255*invA) / 255
							sumG += (uint64(typed.Pix[off+1])*a + 255*invA) / 255
							sumB += (uint64(typed.Pix[off+2])*a + 255*invA) / 255
							sumA += 255
						}
						count++
					}
				}
			case *image.RGBA:
				for sy := sy0; sy < sy1; sy += stepY {
					rowOff := (sy - typed.Rect.Min.Y) * typed.Stride
					for sx := sx0; sx < sx1; sx += stepX {
						off := rowOff + (sx-typed.Rect.Min.X)*4
						a := uint64(typed.Pix[off+3])
						r := uint64(typed.Pix[off])
						g := uint64(typed.Pix[off+1])
						b := uint64(typed.Pix[off+2])
						if preserveAlpha {
							// RGBA is premultiplied; accumulate weighted by 255 for clean unpremultiply below
							sumR += r * 255
							sumG += g * 255
							sumB += b * 255
							sumA += a
						} else {
							invA := 255 - a
							sumR += r + invA
							sumG += g + invA
							sumB += b + invA
							sumA += 255
						}
						count++
					}
				}
			case *image.YCbCr:
				for sy := sy0; sy < sy1; sy += stepY {
					for sx := sx0; sx < sx1; sx += stepX {
						yi := typed.YOffset(sx, sy)
						ci := typed.COffset(sx, sy)
						rr, gg, bb := color.YCbCrToRGB(typed.Y[yi], typed.Cb[ci], typed.Cr[ci])
						sumR += uint64(rr)
						sumG += uint64(gg)
						sumB += uint64(bb)
						sumA += 255
						count++
					}
				}
			default:
				for sy := sy0; sy < sy1; sy += stepY {
					for sx := sx0; sx < sx1; sx += stepX {
						r, g, b, a := src.At(sx, sy).RGBA()
						a8 := uint64(a >> 8)
						if preserveAlpha {
							sumR += uint64(r>>8) * 255
							sumG += uint64(g>>8) * 255
							sumB += uint64(b>>8) * 255
							sumA += a8
						} else {
							invA := 255 - a8
							sumR += uint64(r>>8) + invA
							sumG += uint64(g>>8) + invA
							sumB += uint64(b>>8) + invA
							sumA += 255
						}
						count++
					}
				}
			}

			di := dst.PixOffset(dx, dy)
			if count == 0 {
				dst.Pix[di+3] = 255
				continue
			}
			if preserveAlpha {
				avgA := sumA / count
				if avgA == 0 {
					dst.Pix[di] = 0
					dst.Pix[di+1] = 0
					dst.Pix[di+2] = 0
					dst.Pix[di+3] = 0
				} else {
					dst.Pix[di] = clampUint8(sumR / sumA)
					dst.Pix[di+1] = clampUint8(sumG / sumA)
					dst.Pix[di+2] = clampUint8(sumB / sumA)
					dst.Pix[di+3] = clampUint8(avgA)
				}
			} else {
				dst.Pix[di] = clampUint8(sumR / count)
				dst.Pix[di+1] = clampUint8(sumG / count)
				dst.Pix[di+2] = clampUint8(sumB / count)
				dst.Pix[di+3] = 255
			}
		}
	}
	return dst
}

func clampUint8(v uint64) uint8 {
	if v > 255 {
		return 255
	}
	return uint8(v)
}
