package main

import (
	"context"
	"encoding/json"
	"flag"
	"fmt"
	"log"
	"net"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
	"sync"
	"time"
)

type stringSliceFlag []string

func (s *stringSliceFlag) String() string {
	return strings.Join(*s, ",")
}

func (s *stringSliceFlag) Set(val string) error {
	for _, part := range strings.Split(val, ",") {
		trimmed := strings.TrimSpace(part)
		if trimmed != "" {
			*s = append(*s, trimmed)
		}
	}
	return nil
}

func main() {
	var (
		portFlag       = flag.Int("port", 18080, "本地 Web 界面监听端口")
		hostFlag       = flag.String("host", "127.0.0.1", "本地 Web 界面监听地址")
		noBrowserFlag  = flag.Bool("no-browser", false, "启动 Web 界面时不自动打开浏览器")
		dataDirFlag    = flag.String("data-dir", "", "数据保存目录（默认为运行目录下的 duomi_data）")
		apiKeyFlag     = flag.String("key", "", "多米 API 密钥（明文，无需加 Bearer 前缀；会自动保存到配置或直接使用）")
		baseURLFlag    = flag.String("base-url", "", "多米 API 基础地址（默认 https://duomiapi.com）")
		promptFlag     = flag.String("prompt", "", "[CLI模式] 图像描述词 (Prompt)")
		promptFileFlag = flag.String("prompt-file", "", "[CLI模式] 从 UTF-8 文本文件读取 Prompt")
		modelFlag      = flag.String("model", "", "[CLI模式] 模型 ID (gpt-image-2.6-flare / gpt-image-2.6-sunburst / gpt-image-2.5-flare / gpt-image-2.5-sunburst / gpt-image-2)")
		ratioFlag      = flag.String("ratio", "", "[CLI模式] 画幅比例 (如 auto, 1:1, 16:9, 9:16, 3:2, 2:3, 4:3, 3:4, 5:4, 4:5, 2:1, 1:2)")
		tierFlag       = flag.String("tier", "", "[CLI模式] 配合 -ratio 选择对应尺寸档位 (1k / 1.5k / 2k / 4k / ratio)")
		sizeFlag       = flag.String("size", "", "[CLI模式] 直接指定尺寸或比例 (如 1024x1024, 3840x2160, 16:9, auto)")
		qualityFlag    = flag.String("quality", "", "[CLI模式] 思考深度 (low / medium / high)")
		bgFlag         = flag.String("background", "", "[CLI模式] 背景透明度 (auto / opaque / transparent)")
		refModeFlag    = flag.String("ref-mode", "", "[CLI模式] 本地参考图处理方式: upload (默认自动传图床直链) / compress-base64 (本地压缩转Base64) / raw-base64 (原图转Base64)")
		imgHostFlag    = flag.String("image-host", "", "[CLI模式] 图床节点: auto / litterbox / catbox / tmpfiles / uguu / 0x0 / custom")
		nFlag          = flag.Int("n", 1, "[CLI模式] 并发生成张数 (1..10)")
		overseaFlag    = flag.Bool("oversea", false, "[CLI模式] 是否使用海外节点")
		submitOnlyFlag = flag.Bool("submit-only", false, "[CLI模式] 仅提交任务并返回任务 ID，不等待轮询")
		queryTaskFlag  = flag.String("query", "", "[CLI模式] 查询指定任务 ID 的状态并下载结果图片")
		saveKeyFlag    = flag.Bool("save-key", false, "将 -key 指定的密钥持久化保存到 duomi_data/config.json")
	)
	var imageFlags stringSliceFlag
	flag.Var(&imageFlags, "image", "[CLI模式] 参考图 URL 或本地图片路径（可多次指定或用逗号分隔）")
	flag.Parse()

	store, err := NewStore(*dataDirFlag)
	if err != nil {
		fmt.Fprintf(os.Stderr, "❌ 初始化数据目录失败: %v\n", err)
		os.Exit(1)
	}

	cfg := store.GetConfig()
	configUpdated := false
	if strings.TrimSpace(*apiKeyFlag) != "" {
		cfg.APIKey = NormalizeAPIKey(*apiKeyFlag)
		if *saveKeyFlag || store.GetConfig().APIKey == "" {
			configUpdated = true
		}
	}
	if strings.TrimSpace(*baseURLFlag) != "" {
		cfg.BaseURL = strings.TrimSpace(*baseURLFlag)
		configUpdated = true
	}
	if configUpdated {
		if err := store.SaveConfig(cfg); err != nil {
			fmt.Fprintf(os.Stderr, "⚠️ 保存配置失败: %v\n", err)
		}
	}

	client := NewDuomiClient()

	isCLIMode := strings.TrimSpace(*promptFlag) != "" ||
		strings.TrimSpace(*promptFileFlag) != "" ||
		strings.TrimSpace(*queryTaskFlag) != ""

	if isCLIMode {
		runCLI(store, client, cfg, cliOptions{
			prompt:     *promptFlag,
			promptFile: *promptFileFlag,
			model:      *modelFlag,
			ratio:      *ratioFlag,
			tier:       *tierFlag,
			size:       *sizeFlag,
			quality:    *qualityFlag,
			background: *bgFlag,
			refMode:    *refModeFlag,
			imageHost:  *imgHostFlag,
			n:          *nFlag,
			oversea:    *overseaFlag,
			images:     imageFlags,
			submitOnly: *submitOnlyFlag,
			queryID:    *queryTaskFlag,
		})
		return
	}

	// Web UI Mode
	appServer := NewAppServer(store, client)
	listener, actualAddr, err := listenAvailablePort(*hostFlag, *portFlag)
	if err != nil {
		log.Fatalf("❌ 启动本地服务失败: %v", err)
	}

	webURL := fmt.Sprintf("http://%s", actualAddr)
	fmt.Println("================================================================")
	fmt.Println("  🎨 多米 API 图像创作工作台 v2.0 (单文件绿色便携版)")
	fmt.Println("================================================================")
	fmt.Printf("  🌐 本地操作界面 : %s\n", webURL)
	fmt.Printf("  📁 绿色数据目录 : %s\n", store.BaseDir())
	fmt.Printf("  ⚙️ 配置文件路径 : %s\n", filepath.Join(store.BaseDir(), "config.json"))
	fmt.Printf("  📜 历史记录文件 : %s\n", filepath.Join(store.BaseDir(), "records.json"))
	fmt.Printf("  🖼️ 图片保存目录 : %s\n", store.ImagesDir())
	fmt.Println("----------------------------------------------------------------")
	fmt.Println("  提示: 纯绿色单文件运行，绝不写入注册表或系统目录。")
	fmt.Println("  按 Ctrl+C 可停止并退出程序。")
	fmt.Println("================================================================")

	if !*noBrowserFlag {
		go func() {
			time.Sleep(350 * time.Millisecond)
			openBrowser(webURL)
		}()
	}

	if err := http.Serve(listener, appServer.Handler()); err != nil {
		log.Fatalf("❌ 服务异常退出: %v", err)
	}
}

type cliOptions struct {
	prompt     string
	promptFile string
	model      string
	ratio      string
	tier       string
	size       string
	quality    string
	background string
	refMode    string
	imageHost  string
	n          int
	oversea    bool
	images     []string
	submitOnly bool
	queryID    string
}

func normalizeCLIRefMode(m string, fallback string) string {
	switch strings.ToLower(strings.TrimSpace(m)) {
	case "upload", "auto-upload", "host":
		return "upload"
	case "compress-base64", "compress_base64", "compress":
		return "compress_base64"
	case "raw-base64", "raw_base64", "base64", "raw":
		return "raw_base64"
	}
	if fallback != "" {
		return fallback
	}
	return "upload"
}

func runCLI(store *Store, client *DuomiClient, cfg AppConfig, opts cliOptions) {
	if strings.TrimSpace(cfg.APIKey) == "" {
		fmt.Fprintln(os.Stderr, "❌ 错误: 未提供 API Key。请通过 -key <密钥> 传入、设置环境变量 DUOMI_API_KEY，或在 duomi_data/config.json 中配置。")
		os.Exit(1)
	}

	appServer := NewAppServer(store, client)

	var taskIDs []string
	if strings.TrimSpace(opts.queryID) != "" {
		taskIDs = append(taskIDs, strings.TrimSpace(opts.queryID))
		fmt.Fprintf(os.Stderr, "🔍 正在查询并轮询任务 ID: %s ...\n", taskIDs[0])
	} else {
		prompt := strings.TrimSpace(opts.prompt)
		if opts.promptFile != "" {
			data, err := os.ReadFile(opts.promptFile)
			if err != nil {
				fmt.Fprintf(os.Stderr, "❌ 读取 prompt 文件失败: %v\n", err)
				os.Exit(1)
			}
			prompt = strings.TrimSpace(string(data))
		}
		if prompt == "" {
			fmt.Fprintln(os.Stderr, "❌ 错误: prompt 不能为空")
			os.Exit(1)
		}

		model := strings.TrimSpace(opts.model)
		if model == "" {
			model = cfg.DefaultModel
		}
		size := strings.TrimSpace(opts.size)
		if size == "" && strings.TrimSpace(opts.ratio) != "" {
			resolved, err := ResolveRatioPreset(opts.ratio, opts.tier)
			if err != nil {
				fmt.Fprintf(os.Stderr, "❌ %v\n", err)
				os.Exit(1)
			}
			size = resolved
		}
		if size == "" {
			size = cfg.DefaultSize
		}

		refMode := normalizeCLIRefMode(opts.refMode, cfg.RefImageMode)
		hostOpts := ImageHostOptionsFromConfig(cfg)
		if strings.TrimSpace(opts.imageHost) != "" {
			hostOpts.Provider = strings.TrimSpace(opts.imageHost)
		}

		var encodedImages []string
		var previews []string
		var savedRefs []SavedRefImage
		for _, img := range opts.images {
			trimmed := strings.TrimSpace(img)
			if trimmed == "" {
				continue
			}
			if strings.HasPrefix(trimmed, "http://") || strings.HasPrefix(trimmed, "https://") {
				encodedImages = append(encodedImages, trimmed)
				previews = append(previews, trimmed)
				savedRefs = append(savedRefs, SavedRefImage{RemoteURL: trimmed, Mode: "url", Label: "直链 URL"})
				continue
			}

			rawData, readErr := os.ReadFile(trimmed)
			if readErr != nil {
				fmt.Fprintf(os.Stderr, "❌ 读取参考图失败 (%s): %v\n", trimmed, readErr)
				os.Exit(1)
			}
			ext := filepath.Ext(trimmed)
			localRef, _ := store.SaveRefImageBytes(rawData, ext)

			switch refMode {
			case "compress_base64":
				uri, outSz, _, _, cErr := CompressImageBytesToBase64(rawData, cfg.CompressMaxDim, cfg.CompressQuality)
				if cErr != nil {
					fmt.Fprintf(os.Stderr, "❌ 压缩参考图失败: %v\n", cErr)
					os.Exit(1)
				}
				encodedImages = append(encodedImages, uri)
				previews = append(previews, "/images/"+localRef)
				savedRefs = append(savedRefs, SavedRefImage{
					LocalRef: localRef,
					Mode:     "compress_base64",
					Label:    fmt.Sprintf("压缩 Base64 (%dKB)", maxInt(1, outSz/1024)),
				})
			case "raw_base64":
				uri := EncodeBytesToDataURI(rawData, ext)
				encodedImages = append(encodedImages, uri)
				previews = append(previews, "/images/"+localRef)
				savedRefs = append(savedRefs, SavedRefImage{
					LocalRef: localRef,
					Mode:     "raw_base64",
					Label:    fmt.Sprintf("原图 Base64 (%dKB)", maxInt(1, len(rawData)/1024)),
				})
			default: // "upload" lossless to image host
				fmt.Fprintf(os.Stderr, "☁️ 正在将本地参考图 (%s) 无损上传至图床...\n", filepath.Base(trimmed))
				upCtx, upCancel := context.WithTimeout(context.Background(), 25*time.Second)
				pubURL, provider, upErr := client.UploadBytesToImageHost(upCtx, rawData, ext, hostOpts)
				upCancel()
				if upErr != nil {
					fmt.Fprintf(os.Stderr, "❌ %v\n💡 提示: 可添加参数 -ref-mode compress-base64 改用本地压缩 Base64 模式\n", upErr)
					os.Exit(1)
				}
				fmt.Fprintf(os.Stderr, "✅ 图床上传成功 (%s): %s\n", provider, pubURL)
				encodedImages = append(encodedImages, pubURL)
				previews = append(previews, "/images/"+localRef)
				savedRefs = append(savedRefs, SavedRefImage{
					LocalRef:  localRef,
					RemoteURL: pubURL,
					Mode:      "upload",
					Provider:  provider,
					Label:     "图床直链 · " + provider,
				})
			}
		}

		batchCount := opts.n
		if batchCount < 1 {
			batchCount = 1
		} else if batchCount > 10 {
			batchCount = 10
		}

		req := CreateImageRequest{
			Model:                 model,
			Prompt:                prompt,
			Size:                  size,
			Image:                 encodedImages,
			Quality:               opts.quality,
			Background:            opts.background,
			N:                     1,
			Oversea:               opts.oversea || cfg.Oversea,
			RefMode:               refMode,
			HostOpts:              hostOpts,
			DisableCompatFallback: !cfg.AutoCompatFallback,
		}

		fmt.Fprintf(os.Stderr, "🚀 正在向多米 API 提交 %d 个异步生图任务 (模型: %s, 尺寸: %s)...\n", batchCount, req.Model, req.Size)
		var mu sync.Mutex
		var created []*TaskRecord
		var wg sync.WaitGroup
		for i := 0; i < batchCount; i++ {
			wg.Add(1)
			go func() {
				defer wg.Done()
				ctx, cancel := context.WithTimeout(context.Background(), 60*time.Second)
				res, err := client.CreateTaskDetailed(ctx, cfg.BaseURL, cfg.APIKey, req)
				cancel()
				if err != nil {
					fmt.Fprintf(os.Stderr, "❌ 创建任务失败: %v\n", err)
					return
				}
				now := time.Now().Unix()
				rec := &TaskRecord{
					ID:          res.TaskID,
					Model:       req.Model,
					Prompt:      req.Prompt,
					Size:        res.ActualSize,
					Quality:     req.Quality,
					Background:  req.Background,
					N:           1,
					Oversea:     req.Oversea,
					RefMode:     refMode,
					RefCount:    len(encodedImages),
					RefPreviews: previews,
					RefItems:    savedRefs,
					State:       "pending",
					WarningMsg:  res.WarningMsg,
					CreateTime:  now,
					UpdateTime:  now,
					RawResponse: res.RawResponse,
				}
				_ = store.UpsertRecord(rec)
				mu.Lock()
				created = append(created, rec)
				taskIDs = append(taskIDs, res.TaskID)
				mu.Unlock()
				fmt.Fprintf(os.Stderr, "✅ 任务已创建，Task ID: %s\n", res.TaskID)
				if res.WarningMsg != "" {
					fmt.Fprintf(os.Stderr, "   ⚠️ %s\n", res.WarningMsg)
				}
			}()
		}
		wg.Wait()

		if len(taskIDs) == 0 {
			os.Exit(1)
		}
		if opts.submitOnly {
			out, _ := json.MarshalIndent(created, "", "  ")
			fmt.Println(string(out))
			return
		}
	}

	interval := time.Duration(cfg.PollInterval) * time.Second
	if interval < 2*time.Second {
		interval = 3 * time.Second
	}
	timeout := time.Duration(cfg.PollTimeout) * time.Second
	if timeout < 30*time.Second {
		timeout = 300 * time.Second
	}
	deadline := time.Now().Add(timeout)
	pendingSet := make(map[string]bool)
	for _, id := range taskIDs {
		pendingSet[id] = true
	}

	var finalRecords []*TaskRecord
	for len(pendingSet) > 0 {
		for id := range pendingSet {
			ctx, cancel := context.WithTimeout(context.Background(), 60*time.Second)
			rec, done, err := appServer.SyncTaskOnce(ctx, id, true)
			cancel()
			if err != nil {
				fmt.Fprintf(os.Stderr, "  ⚠️ [%s] 查询暂未就绪: %v\n", id[:minInt(8, len(id))], err)
				continue
			}
			if rec != nil && done {
				delete(pendingSet, id)
				finalRecords = append(finalRecords, rec)
				if rec.State == "succeeded" {
					fmt.Fprintf(os.Stderr, "🎉 [%s] 生成完成！图片已保存到 %s\n", id[:minInt(8, len(id))], store.ImagesDir())
				} else {
					fmt.Fprintf(os.Stderr, "❌ [%s] 任务失败 (%s): %s\n", id[:minInt(8, len(id))], rec.State, rec.ErrorMsg)
				}
			}
		}
		if len(pendingSet) == 0 {
			break
		}
		if time.Now().After(deadline) {
			fmt.Fprintf(os.Stderr, "⏰ 轮询超时 (%ds)\n", int(timeout.Seconds()))
			os.Exit(1)
		}
		time.Sleep(interval)
	}

	out, _ := json.MarshalIndent(finalRecords, "", "  ")
	fmt.Println(string(out))
}

func minInt(a, b int) int {
	if a < b {
		return a
	}
	return b
}

func listenAvailablePort(host string, preferredPort int) (net.Listener, string, error) {
	for offset := 0; offset < 20; offset++ {
		p := preferredPort + offset
		addr := fmt.Sprintf("%s:%d", host, p)
		ln, err := net.Listen("tcp", addr)
		if err == nil {
			return ln, addr, nil
		}
	}
	ln, err := net.Listen("tcp", fmt.Sprintf("%s:0", host))
	if err != nil {
		return nil, "", err
	}
	return ln, ln.Addr().String(), nil
}

func openBrowser(url string) {
	var cmd *exec.Cmd
	switch runtime.GOOS {
	case "windows":
		cmd = exec.Command("rundll32", "url.dll,FileProtocolHandler", url)
	case "darwin":
		cmd = exec.Command("open", url)
	default:
		cmd = exec.Command("xdg-open", url)
	}
	_ = cmd.Start()
}
