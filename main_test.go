package main

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
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

