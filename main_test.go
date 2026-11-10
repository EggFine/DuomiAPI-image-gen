package main

import (
	"archive/zip"
	"bytes"
	"context"
	"encoding/json"
	"image"
	"image/color"
	"image/png"
	"io"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"sync/atomic"
	"testing"
)

func TestValidateSize(t *testing.T) {
	validCases := []string{
		"",
		"auto",
		"1:1",
		"16:9",
		"9:16",
		"3:2",
		"2:3",
		"4:3",
		"3:4",
		"5:4",
		"4:5",
		"2:1",
		"1:2",
		"1024x1024",
		"1792x1024",
		"1024x1792",
		"3840x2160",
	}
	for _, tc := range validCases {
		if err := ValidateSize(tc); err != nil {
			t.Errorf("expected size %q to be valid, got error: %v", tc, err)
		}
	}

	invalidCases := []string{
		"1000x1000", // not divisible by 16
		"512x512",   // 262,144 < 655,360 pixel budget
		"3840x3840", // > 8,294,400 pixel budget
		"4096x1024", // width > 3840
		"invalid",
	}
	for _, tc := range invalidCases {
		if err := ValidateSize(tc); err == nil {
			t.Errorf("expected size %q to be invalid, got nil", tc)
		}
	}
}

func TestGetRatioPresetsCompliance(t *testing.T) {
	groups := GetRatioPresets()
	if len(groups) != 12 {
		t.Fatalf("expected 12 ratio groups, got %d", len(groups))
	}
	for _, grp := range groups {
		if err := ValidateSize(grp.DefaultSize); err != nil {
			t.Errorf("ratio %s default_size %q failed ValidateSize: %v", grp.Ratio, grp.DefaultSize, err)
		}
		for _, item := range grp.Sizes {
			if err := ValidateSize(item.Value); err != nil {
				t.Errorf("ratio %s preset %q (%s) failed ValidateSize: %v", grp.Ratio, item.Value, item.Label, err)
			}
		}
	}
	// Test ResolveRatioPreset
	if got, err := ResolveRatioPreset("16:9", "4k"); err != nil || got != "3840x2160" {
		t.Fatalf("expected 3840x2160 for 16:9 4k, got %q (err=%v)", got, err)
	}
	if got, err := ResolveRatioPreset("3:2", "2k"); err != nil || got != "2304x1536" {
		t.Fatalf("expected 2304x1536 for 3:2 2k, got %q (err=%v)", got, err)
	}
}

func TestNormalizeAPIKey(t *testing.T) {
	if got := NormalizeAPIKey("  Bearer my-secret-key  "); got != "my-secret-key" {
		t.Fatalf("expected my-secret-key, got %q", got)
	}
	if got := NormalizeAPIKey("raw-key-123"); got != "raw-key-123" {
		t.Fatalf("expected raw-key-123, got %q", got)
	}
}

func TestStorePortableDirectory(t *testing.T) {
	tmpRoot := t.TempDir()
	dataDir := filepath.Join(tmpRoot, "duomi_data")

	store, err := NewStore(dataDir)
	if err != nil {
		t.Fatalf("NewStore failed: %v", err)
	}

	// Verify only duomi_data exists inside tmpRoot
	entries, err := os.ReadDir(tmpRoot)
	if err != nil {
		t.Fatalf("ReadDir failed: %v", err)
	}
	if len(entries) != 1 || entries[0].Name() != "duomi_data" {
		t.Fatalf("expected only duomi_data directory in root, got %v", entries)
	}

	// Save config and verify persistence
	cfg := store.GetConfig()
	cfg.APIKey = "Bearer test-duomi-key"
	cfg.DefaultModel = "gpt-image-2.5-flare"
	if err := store.SaveConfig(cfg); err != nil {
		t.Fatalf("SaveConfig failed: %v", err)
	}

	reloaded, err := NewStore(dataDir)
	if err != nil {
		t.Fatalf("reload NewStore failed: %v", err)
	}
	if reloaded.GetConfig().APIKey != "test-duomi-key" {
		t.Fatalf("expected normalized API key 'test-duomi-key', got %q", reloaded.GetConfig().APIKey)
	}

	// Upsert record and verify persistence
	rec := &TaskRecord{
		ID:     "task-12345",
		Model:  "gpt-image-2.6-flare",
		Prompt: "test prompt",
		State:  "succeeded",
	}
	if err := reloaded.UpsertRecord(rec); err != nil {
		t.Fatalf("UpsertRecord failed: %v", err)
	}
	if got, ok := reloaded.GetRecord("task-12345"); !ok || got.Prompt != "test prompt" {
		t.Fatalf("expected saved record, got %+v (ok=%v)", got, ok)
	}
}

func TestDuomiClientCreateAndQueryFlow(t *testing.T) {
	var mockServerURL string
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/mock-output.png" && r.Header.Get("Authorization") != "my-raw-key" {
			http.Error(w, "invalid auth header: "+r.Header.Get("Authorization"), http.StatusUnauthorized)
			return
		}
		switch {
		case r.Method == http.MethodPost && r.URL.Path == "/v1/images/generations":
			if r.URL.Query().Get("async") != "true" {
				http.Error(w, "missing async=true", http.StatusBadRequest)
				return
			}
			var body map[string]any
			_ = json.NewDecoder(r.Body).Decode(&body)
			if body["model"] != "gpt-image-2.6-flare" {
				http.Error(w, "unexpected model", http.StatusBadRequest)
				return
			}
			w.Header().Set("Content-Type", "application/json")
			_, _ = w.Write([]byte(`{"id":"mock-task-001"}`))

		case r.Method == http.MethodGet && r.URL.Path == "/v1/tasks/mock-task-001":
			w.Header().Set("Content-Type", "application/json")
			resp := map[string]any{
				"id":       "mock-task-001",
				"state":    "succeeded",
				"progress": 100,
				"data": map[string]any{
					"images": []map[string]any{
						{
							"url":       mockServerURL + "/mock-output.png",
							"file_name": "output.png",
						},
					},
					"description": "",
				},
			}
			_ = json.NewEncoder(w).Encode(resp)

		case r.Method == http.MethodGet && r.URL.Path == "/mock-output.png":
			w.Header().Set("Content-Type", "image/png")
			_, _ = w.Write([]byte("\x89PNG\r\n\x1a\nmock-image-bytes"))

		default:
			http.NotFound(w, r)
		}
	}))
	defer srv.Close()
	mockServerURL = srv.URL

	store, err := NewStore(filepath.Join(t.TempDir(), "duomi_data"))
	if err != nil {
		t.Fatalf("NewStore error: %v", err)
	}
	cfg := store.GetConfig()
	cfg.APIKey = "my-raw-key"
	cfg.BaseURL = srv.URL
	_ = store.SaveConfig(cfg)

	client := NewDuomiClient()
	ctx := context.Background()

	taskID, _, err := client.CreateTask(ctx, cfg.BaseURL, cfg.APIKey, CreateImageRequest{
		Model:      "gpt-image-2.6-flare",
		Prompt:     "a lighthouse at night",
		Size:       "16:9",
		Quality:    "medium",
		Background: "auto",
	})
	if err != nil {
		t.Fatalf("CreateTask failed: %v", err)
	}
	if taskID != "mock-task-001" {
		t.Fatalf("expected taskID mock-task-001, got %q", taskID)
	}

	appSrv := &AppServer{
		store:   store,
		client:  client,
		polling: make(map[string]bool),
	}
	rec, done, err := appSrv.SyncTaskOnce(ctx, taskID, true)
	if err != nil {
		t.Fatalf("SyncTaskOnce failed: %v", err)
	}
	if !done || rec.State != "succeeded" || len(rec.Images) != 1 || rec.Images[0].LocalFile == "" {
		t.Fatalf("unexpected synced record: %+v (done=%v)", rec, done)
	}

	savedPath := filepath.Join(store.ImagesDir(), rec.Images[0].LocalFile)
	if _, err := os.Stat(savedPath); err != nil {
		t.Fatalf("expected downloaded image file at %s, got err: %v", savedPath, err)
	}
}

func TestCreateTaskFailToSubmitFallback(t *testing.T) {
	attempts := 0
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		attempts++
		var body map[string]any
		_ = json.NewDecoder(r.Body).Decode(&body)

		// Verify `n` and `background: auto` are never sent
		if _, hasN := body["n"]; hasN {
			t.Errorf("expected `n` to be omitted from DuomiAPI payload, got %v", body["n"])
		}
		if bg, hasBG := body["background"]; hasBG && bg == "auto" {
			t.Errorf("expected `background: auto` to be omitted, got %v", bg)
		}

		// Simulate upstream rejecting 3840x2160 with fail_to_submit_task, but succeeding on fallback "16:9"
		if body["size"] == "3840x2160" {
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusBadRequest)
			_, _ = w.Write([]byte(`{"error":{"code":"invalid_request","message":"fail_to_submit_task","type":"invalid_request_error"}}`))
			return
		}
		if body["size"] == "16:9" {
			w.Header().Set("Content-Type", "application/json")
			_, _ = w.Write([]byte(`{"id":"fallback-task-ok"}`))
			return
		}
		w.WriteHeader(http.StatusBadRequest)
	}))
	defer srv.Close()

	client := NewDuomiClient()
	taskID, _, err := client.CreateTask(context.Background(), srv.URL, "test-key", CreateImageRequest{
		Model:      "gpt-image-2.6-sunburst",
		Prompt:     "test fallback",
		Size:       "3840x2160",
		Quality:    "high",
		Background: "auto",
		N:          4,
	})
	if err != nil {
		t.Fatalf("expected fallback to succeed, got error: %v", err)
	}
	if taskID != "fallback-task-ok" {
		t.Fatalf("expected taskID fallback-task-ok, got %q", taskID)
	}
	if attempts < 2 {
		t.Fatalf("expected at least 2 attempts (initial + fallback), got %d", attempts)
	}
}

func TestEmbeddedReactStaticAssets(t *testing.T) {
	store, err := NewStore(filepath.Join(t.TempDir(), "duomi_data"))
	if err != nil {
		t.Fatalf("NewStore error: %v", err)
	}
	appSrv := NewAppServer(store, NewDuomiClient())
	ts := httptest.NewServer(appSrv.Handler())
	defer ts.Close()

	resp, err := http.Get(ts.URL + "/")
	if err != nil {
		t.Fatalf("GET / failed: %v", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("expected 200 OK for /, got %d", resp.StatusCode)
	}

	entries, err := embeddedWebFS.ReadDir("web/assets")
	if err != nil || len(entries) == 0 {
		t.Fatalf("expected embedded web/assets files, got err=%v len=%d", err, len(entries))
	}
	for _, entry := range entries {
		assetResp, err := http.Get(ts.URL + "/assets/" + entry.Name())
		if err != nil {
			t.Fatalf("GET /assets/%s failed: %v", entry.Name(), err)
		}
		assetResp.Body.Close()
		if assetResp.StatusCode != http.StatusOK {
			t.Fatalf("expected 200 OK for /assets/%s, got %d", entry.Name(), assetResp.StatusCode)
		}
	}
}

func makeSyntheticPNG(t *testing.T, w, h int) []byte {
	t.Helper()
	img := image.NewRGBA(image.Rect(0, 0, w, h))
	for y := 0; y < h; y++ {
		for x := 0; x < w; x++ {
			noise := (x*73856093 ^ y*19349663) & 0x3f
			img.Set(x, y, color.RGBA{
				R: uint8(((x * 200) / w) + noise),
				G: uint8(((y * 200) / h) + (noise ^ 0x2a)),
				B: uint8(120 + noise),
				A: 255,
			})
		}
	}
	var buf bytes.Buffer
	if err := png.Encode(&buf, img); err != nil {
		t.Fatalf("png.Encode failed: %v", err)
	}
	return buf.Bytes()
}

func TestCompressImageBytesToBase64(t *testing.T) {
	rawPNG := makeSyntheticPNG(t, 1600, 1200)
	dataURI, outBytes, outW, outH, err := CompressImageBytesToBase64(rawPNG, 800, 82)
	if err != nil {
		t.Fatalf("CompressImageBytesToBase64 failed: %v", err)
	}
	if !strings.HasPrefix(dataURI, "data:image/jpeg;base64,") {
		t.Fatalf("expected data:image/jpeg;base64, prefix, got %q", dataURI[:32])
	}
	if outW != 800 || outH != 600 {
		t.Fatalf("expected resized 800x600, got %dx%d", outW, outH)
	}
	if outBytes <= 0 || outBytes >= len(rawPNG) {
		t.Fatalf("expected compressed size < rawPNG (%d), got %d", len(rawPNG), outBytes)
	}
}

func TestUploadRefModesAndStrictRefModeIsolation(t *testing.T) {
	rawPNG := makeSyntheticPNG(t, 1200, 900)

	var hostUploads atomic.Int32
	mockImageHost := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		hostUploads.Add(1)
		if r.Header.Get("Authorization") != "Bearer custom-host-token" {
			http.Error(w, "bad custom host auth", http.StatusUnauthorized)
			return
		}
		file, _, err := r.FormFile("image_file")
		if err != nil {
			http.Error(w, "missing image_file field: "+err.Error(), http.StatusBadRequest)
			return
		}
		defer file.Close()
		uploadedBytes, _ := io.ReadAll(file)
		// Verify lossless upload: exact original PNG bytes must arrive untouched!
		if !bytes.Equal(uploadedBytes, rawPNG) {
			http.Error(w, "uploaded bytes were modified/compressed instead of lossless!", http.StatusBadRequest)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"status":true,"payload":{"direct_url":"https://cdn.example.test/lossless-orig.png"}}`))
	}))
	defer mockImageHost.Close()

	store, err := NewStore(filepath.Join(t.TempDir(), "duomi_data"))
	if err != nil {
		t.Fatalf("NewStore failed: %v", err)
	}
	cfg := store.GetConfig()
	cfg.APIKey = "duomi-test-key"
	cfg.RefImageMode = "upload" // Default mode: automatic lossless image host upload
	cfg.ImageHostProvider = "custom"
	cfg.CustomUploadURL = mockImageHost.URL + "/upload"
	cfg.CustomUploadField = "image_file"
	cfg.CustomUploadAuthHeader = "Bearer custom-host-token"
	cfg.CustomUploadJSONPath = "payload.direct_url"
	if err := store.SaveConfig(cfg); err != nil {
		t.Fatalf("SaveConfig failed: %v", err)
	}

	appSrv := NewAppServer(store, NewDuomiClient())
	ts := httptest.NewServer(appSrv.Handler())
	defer ts.Close()

	// 1. Default mode ("upload"): multipart lossless upload -> returns direct URL + caches local_ref
	var mpBuf bytes.Buffer
	mw := multipart.NewWriter(&mpBuf)
	_ = mw.WriteField("mode", "upload")
	fw, _ := mw.CreateFormFile("file", "photo.png")
	_, _ = fw.Write(rawPNG)
	_ = mw.Close()

	resp, err := http.Post(ts.URL+"/api/upload-ref", mw.FormDataContentType(), &mpBuf)
	if err != nil {
		t.Fatalf("POST /api/upload-ref failed: %v", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		bodyBytes, _ := io.ReadAll(resp.Body)
		t.Fatalf("expected 200 OK for lossless upload, got %d: %s", resp.StatusCode, string(bodyBytes))
	}
	var upRes map[string]any
	_ = json.NewDecoder(resp.Body).Decode(&upRes)
	if upRes["url"] != "https://cdn.example.test/lossless-orig.png" {
		t.Fatalf("unexpected url: %v", upRes["url"])
	}
	localRef, _ := upRes["local_ref"].(string)
	if !strings.HasPrefix(localRef, "refs/") {
		t.Fatalf("expected cached local_ref under refs/, got %q", localRef)
	}
	if hostUploads.Load() != 1 {
		t.Fatalf("expected 1 image host upload, got %d", hostUploads.Load())
	}

	// 2. Switch to optional "compress_base64" mode using cached local_ref -> must NOT touch image host
	reconvReq, _ := json.Marshal(map[string]any{
		"local_ref":        localRef,
		"mode":             "compress_base64",
		"compress_max_dim": 640,
		"compress_quality": 80,
	})
	resp2, err := http.Post(ts.URL+"/api/upload-ref", "application/json", bytes.NewReader(reconvReq))
	if err != nil {
		t.Fatalf("re-convert compress_base64 failed: %v", err)
	}
	defer resp2.Body.Close()
	if resp2.StatusCode != http.StatusOK {
		t.Fatalf("expected 200 OK for compress_base64, got %d", resp2.StatusCode)
	}
	var b64Res map[string]any
	_ = json.NewDecoder(resp2.Body).Decode(&b64Res)
	b64Val, _ := b64Res["value"].(string)
	if !strings.HasPrefix(b64Val, "data:image/jpeg;base64,") {
		t.Fatalf("expected compressed JPEG data URI, got %q", b64Val[:24])
	}
	if hostUploads.Load() != 1 {
		t.Fatalf("compress_base64 must NOT upload to image host, uploads=%d", hostUploads.Load())
	}

	// 3. Verify CreateTaskDetailed strictly respects RefMode="compress_base64" and sends Base64 directly without uploading
	var receivedImages []any
	mockDuomi := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var payload map[string]any
		_ = json.NewDecoder(r.Body).Decode(&payload)
		if imgs, ok := payload["image"].([]any); ok {
			receivedImages = imgs
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"id":"b64-task-001"}`))
	}))
	defer mockDuomi.Close()

	res, err := appSrv.client.CreateTaskDetailed(context.Background(), mockDuomi.URL, "duomi-test-key", CreateImageRequest{
		Model:    "gpt-image-2.6-flare",
		Prompt:   "keep base64 local",
		Size:     "1:1",
		Image:    []string{b64Val},
		RefMode:  "compress_base64",
		HostOpts: ImageHostOptions{Provider: "custom", CustomURL: mockImageHost.URL + "/upload"},
	})
	if err != nil || res.TaskID != "b64-task-001" {
		t.Fatalf("CreateTaskDetailed failed: res=%+v err=%v", res, err)
	}
	if hostUploads.Load() != 1 {
		t.Fatalf("expected zero additional host uploads when RefMode=compress_base64, got %d", hostUploads.Load())
	}
	if len(receivedImages) != 1 || !strings.HasPrefix(receivedImages[0].(string), "data:image/jpeg;base64,") {
		t.Fatalf("expected DuomiAPI to receive data:image/jpeg;base64 directly, got %v", receivedImages)
	}
}

func TestStarBatchDeleteAndZipExport(t *testing.T) {
	store, err := NewStore(filepath.Join(t.TempDir(), "duomi_data"))
	if err != nil {
		t.Fatalf("NewStore failed: %v", err)
	}
	pngBytes := makeSyntheticPNG(t, 64, 64)
	imgFileName := "sample_art.png"
	if err := os.WriteFile(filepath.Join(store.ImagesDir(), imgFileName), pngBytes, 0644); err != nil {
		t.Fatalf("write sample image failed: %v", err)
	}

	_ = store.UpsertRecord(&TaskRecord{
		ID:     "rec-ok-1",
		Model:  "gpt-image-2.6-flare",
		Prompt: "sunset over mountains",
		State:  "succeeded",
		Images: []SavedImage{{LocalFile: imgFileName, Width: 64, Height: 64, SizeBytes: int64(len(pngBytes))}},
	})
	_ = store.UpsertRecord(&TaskRecord{
		ID:       "rec-fail-1",
		Model:    "gpt-image-2.6-flare",
		Prompt:   "broken task",
		State:    "failed",
		ErrorMsg: "mock error",
	})

	appSrv := NewAppServer(store, NewDuomiClient())
	ts := httptest.NewServer(appSrv.Handler())
	defer ts.Close()

	// Star rec-ok-1
	starResp, err := http.Post(ts.URL+"/api/records/star", "application/json", strings.NewReader(`{"id":"rec-ok-1","starred":true}`))
	if err != nil || starResp.StatusCode != http.StatusOK {
		t.Fatalf("star record failed: err=%v status=%v", err, starResp)
	}
	starResp.Body.Close()
	if rec, ok := store.GetRecord("rec-ok-1"); !ok || !rec.Starred {
		t.Fatalf("expected rec-ok-1 to be starred, got %+v", rec)
	}

	// Export ZIP archive
	zipResp, err := http.Get(ts.URL + "/api/records/export-zip?ids=rec-ok-1")
	if err != nil || zipResp.StatusCode != http.StatusOK {
		t.Fatalf("export-zip failed: err=%v status=%v", err, zipResp)
	}
	zipBytes, _ := io.ReadAll(zipResp.Body)
	zipResp.Body.Close()

	zr, err := zip.NewReader(bytes.NewReader(zipBytes), int64(len(zipBytes)))
	if err != nil || len(zr.File) != 2 {
		t.Fatalf("expected valid zip with 2 entries (image + manifest.json), got err=%v files=%d", err, len(zr.File))
	}

	// Clear failed records
	delResp, err := http.Post(ts.URL+"/api/records/batch-delete", "application/json", strings.NewReader(`{"clear_failed":true}`))
	if err != nil || delResp.StatusCode != http.StatusOK {
		t.Fatalf("batch-delete clear_failed failed: err=%v", err)
	}
	delResp.Body.Close()
	if _, exists := store.GetRecord("rec-fail-1"); exists {
		t.Fatalf("expected failed record rec-fail-1 to be removed")
	}
	if _, exists := store.GetRecord("rec-ok-1"); !exists {
		t.Fatalf("expected succeeded record rec-ok-1 to remain")
	}
}

func TestOrganizeProjectAlbumsAndOrphanCacheCleanup(t *testing.T) {
	store, err := NewStore(filepath.Join(t.TempDir(), "duomi_data"))
	if err != nil {
		t.Fatalf("NewStore failed: %v", err)
	}

	pngBytes := makeSyntheticPNG(t, 64, 64)
	_ = os.WriteFile(filepath.Join(store.ImagesDir(), "proj_art_1.png"), pngBytes, 0644)
	_ = os.WriteFile(filepath.Join(store.ImagesDir(), "proj_art_2.png"), pngBytes, 0644)

	// Create one referenced ref image and one orphan ref image in refs/
	keptRefRel, err := store.SaveRefImageBytes(pngBytes, ".png")
	if err != nil {
		t.Fatalf("SaveRefImageBytes kept failed: %v", err)
	}
	orphanRefRel, err := store.SaveRefImageBytes(makeSyntheticPNG(t, 48, 48), ".png")
	if err != nil {
		t.Fatalf("SaveRefImageBytes orphan failed: %v", err)
	}

	_ = store.UpsertRecord(&TaskRecord{
		ID:       "rec-proj-a",
		Model:    "gpt-image-2.6-sunburst",
		Prompt:   "project alpha artwork",
		State:    "succeeded",
		RefItems: []SavedRefImage{{LocalRef: keptRefRel}},
		Images:   []SavedImage{{LocalFile: "proj_art_1.png", Width: 64, Height: 64, SizeBytes: int64(len(pngBytes))}},
	})
	_ = store.UpsertRecord(&TaskRecord{
		ID:     "rec-proj-b",
		Model:  "gpt-image-2.6-flare",
		Prompt: "unassigned artwork",
		State:  "succeeded",
		Images: []SavedImage{{LocalFile: "proj_art_2.png", Width: 64, Height: 64, SizeBytes: int64(len(pngBytes))}},
	})

	appSrv := NewAppServer(store, NewDuomiClient())
	ts := httptest.NewServer(appSrv.Handler())
	defer ts.Close()

	// 1. Verify /api/info reports v3.2.0 and built-in studio recipes
	infoResp, err := http.Get(ts.URL + "/api/info")
	if err != nil || infoResp.StatusCode != http.StatusOK {
		t.Fatalf("GET /api/info failed: %v", err)
	}
	var infoBody map[string]any
	_ = json.NewDecoder(infoResp.Body).Decode(&infoBody)
	infoResp.Body.Close()
	if infoBody["version"] != "v3.2.0" {
		t.Fatalf("expected version v3.2.0, got %v", infoBody["version"])
	}

	// 2. Organize rec-proj-a into project "proj_alpha" with note & star
	orgPayload := `{"ids":["rec-proj-a"],"project_id":"proj_alpha","starred":true,"note":"客户终稿选片"}`
	orgResp, err := http.Post(ts.URL+"/api/records/organize", "application/json", strings.NewReader(orgPayload))
	if err != nil || orgResp.StatusCode != http.StatusOK {
		t.Fatalf("POST /api/records/organize failed: err=%v status=%v", err, orgResp)
	}
	orgResp.Body.Close()

	updatedRec, ok := store.GetRecord("rec-proj-a")
	if !ok || updatedRec.ProjectID != "proj_alpha" || !updatedRec.Starred || updatedRec.Note != "客户终稿选片" {
		t.Fatalf("unexpected organized record: %+v", updatedRec)
	}

	// 3. Export ZIP filtered by project_id=proj_alpha -> must contain only proj_art_1.png + manifest.json (2 files)
	zipResp, err := http.Get(ts.URL + "/api/records/export-zip?project_id=proj_alpha")
	if err != nil || zipResp.StatusCode != http.StatusOK {
		t.Fatalf("GET /api/records/export-zip?project_id=proj_alpha failed: %v", err)
	}
	zipBytes, _ := io.ReadAll(zipResp.Body)
	zipResp.Body.Close()
	zr, err := zip.NewReader(bytes.NewReader(zipBytes), int64(len(zipBytes)))
	if err != nil || len(zr.File) != 2 {
		t.Fatalf("expected 2 entries in project-filtered zip, got err=%v count=%d", err, len(zr.File))
	}

	// 4. Clean orphan reference cache -> removes orphanRefRel, preserves keptRefRel
	cleanResp, err := http.Post(ts.URL+"/api/cache/clean-refs", "application/json", strings.NewReader(`{}`))
	if err != nil || cleanResp.StatusCode != http.StatusOK {
		t.Fatalf("POST /api/cache/clean-refs failed: %v", err)
	}
	var cleanData map[string]any
	_ = json.NewDecoder(cleanResp.Body).Decode(&cleanData)
	cleanResp.Body.Close()
	if int(cleanData["removed_count"].(float64)) != 1 {
		t.Fatalf("expected 1 orphan ref cleaned, got %v", cleanData)
	}
	if _, err := os.Stat(filepath.Join(store.ImagesDir(), filepath.FromSlash(orphanRefRel))); !os.IsNotExist(err) {
		t.Fatalf("expected orphan ref file to be deleted")
	}
	if _, err := os.Stat(filepath.Join(store.ImagesDir(), filepath.FromSlash(keptRefRel))); err != nil {
		t.Fatalf("expected referenced ref file to remain intact: %v", err)
	}
}


