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
		modelFlag      = flag.String("model", "", "[CLI模式] 模型 ID (gpt-image-2 / gpt-image-2.5-flare / gpt-image-2.5-sunburst / gpt-image-2.6-flare / gpt-image-2.6-sunburst)")
		sizeFlag       = flag.String("size", "", "[CLI模式] 尺寸或比例 (如 auto, 1:1, 16:9, 9:16, 1024x1024)")
		qualityFlag    = flag.String("quality", "", "[CLI模式] 思考深度 (low / medium / high)")
		bgFlag         = flag.String("background", "", "[CLI模式] 背景透明度 (auto / opaque / transparent)")
		nFlag          = flag.Int("n", 1, "[CLI模式] 生成张数")
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

	// Check if CLI mode is requested
	isCLIMode := strings.TrimSpace(*promptFlag) != "" ||
		strings.TrimSpace(*promptFileFlag) != "" ||
		strings.TrimSpace(*queryTaskFlag) != ""

	if isCLIMode {
		runCLI(store, client, cfg, cliOptions{
			prompt:     *promptFlag,
			promptFile: *promptFileFlag,
			model:      *modelFlag,
			size:       *sizeFlag,
			quality:    *qualityFlag,
			background: *bgFlag,
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
	fmt.Println("  🎨 多米 API 图像生成工具 (DuomiAPI Image Studio - 单文件绿色版)")
	fmt.Println("================================================================")
	fmt.Printf("  🌐 本地操作界面 : %s\n", webURL)
	fmt.Printf("  📁 绿色数据目录 : %s\n", store.BaseDir())
	fmt.Printf("  ⚙️ 配置文件路径 : %s\n", filepath.Join(store.BaseDir(), "config.json"))
	fmt.Printf("  📜 历史记录文件 : %s\n", filepath.Join(store.BaseDir(), "records.json"))
	fmt.Printf("  🖼️ 图片保存目录 : %s\n", store.ImagesDir())
	fmt.Println("----------------------------------------------------------------")
	fmt.Println("  提示: 本程序为纯绿色单文件，不写入注册表或系统目录。")
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
	size       string
	quality    string
	background string
	n          int
	oversea    bool
	images     []string
	submitOnly bool
	queryID    string
}

func runCLI(store *Store, client *DuomiClient, cfg AppConfig, opts cliOptions) {
	if strings.TrimSpace(cfg.APIKey) == "" {
		fmt.Fprintln(os.Stderr, "❌ 错误: 未提供 API Key。请通过 -key <密钥> 传入、设置环境变量 DUOMI_API_KEY，或在 duomi_data/config.json 中配置。")
		os.Exit(1)
	}

	appServer := &AppServer{
		store:   store,
		client:  client,
		polling: make(map[string]bool),
	}

	taskID := strings.TrimSpace(opts.queryID)
	if taskID == "" {
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
		if size == "" {
			size = cfg.DefaultSize
		}

		var encodedImages []string
		var previews []string
		for _, img := range opts.images {
			encoded, err := EncodeLocalFileOrURL(img)
			if err != nil {
				fmt.Fprintf(os.Stderr, "❌ 处理参考图失败: %v\n", err)
				os.Exit(1)
			}
			if encoded != "" {
				encodedImages = append(encodedImages, encoded)
				if strings.HasPrefix(img, "http://") || strings.HasPrefix(img, "https://") {
					previews = append(previews, img)
				} else {
					previews = append(previews, filepath.Base(img))
				}
			}
		}

		req := CreateImageRequest{
			Model:      model,
			Prompt:     prompt,
			Size:       size,
			Image:      encodedImages,
			Quality:    opts.quality,
			Background: opts.background,
			N:          opts.n,
			Oversea:    opts.oversea || cfg.Oversea,
		}

		fmt.Fprintf(os.Stderr, "🚀 正在向多米 API 提交异步生图任务 (模型: %s, 尺寸: %s)...\n", req.Model, req.Size)
		ctx, cancel := context.WithTimeout(context.Background(), 60*time.Second)
		createdID, rawResp, err := client.CreateTask(ctx, cfg.BaseURL, cfg.APIKey, req)
		cancel()
		if err != nil {
			fmt.Fprintf(os.Stderr, "❌ 创建任务失败: %v\n", err)
			os.Exit(1)
		}

		taskID = createdID
		now := time.Now().Unix()
		rec := &TaskRecord{
			ID:          taskID,
			Model:       req.Model,
			Prompt:      req.Prompt,
			Size:        req.Size,
			Quality:     req.Quality,
			Background:  req.Background,
			N:           req.N,
			Oversea:     req.Oversea,
			RefCount:    len(encodedImages),
			RefPreviews: previews,
			State:       "pending",
			CreateTime:  now,
			UpdateTime:  now,
			RawResponse: rawResp,
		}
		_ = store.UpsertRecord(rec)
		fmt.Fprintf(os.Stderr, "✅ 任务已创建，Task ID: %s\n", taskID)

		if opts.submitOnly {
			out, _ := json.MarshalIndent(rec, "", "  ")
			fmt.Println(string(out))
			return
		}
	} else {
		fmt.Fprintf(os.Stderr, "🔍 正在查询并轮询任务 ID: %s ...\n", taskID)
	}

	// Poll until completion or timeout
	interval := time.Duration(cfg.PollInterval) * time.Second
	if interval < 2*time.Second {
		interval = 3 * time.Second
	}
	timeout := time.Duration(cfg.PollTimeout) * time.Second
	if timeout < 30*time.Second {
		timeout = 300 * time.Second
	}
	deadline := time.Now().Add(timeout)
	lastState := ""

	for {
		ctx, cancel := context.WithTimeout(context.Background(), 60*time.Second)
		rec, done, err := appServer.SyncTaskOnce(ctx, taskID, true)
		cancel()

		if err != nil {
			fmt.Fprintf(os.Stderr, "  ⚠️ 查询暂未就绪或网络波动: %v\n", err)
		} else if rec != nil {
			stateDesc := fmt.Sprintf("%s (%d%%)", rec.State, rec.Progress)
			if stateDesc != lastState {
				fmt.Fprintf(os.Stderr, "  ⏳ 当前状态: %s\n", stateDesc)
				lastState = stateDesc
			}
			if done {
				if rec.State == "succeeded" {
					fmt.Fprintf(os.Stderr, "🎉 生成完成！共 %d 张图片已保存到 %s\n", len(rec.Images), store.ImagesDir())
					for i, img := range rec.Images {
						if img.LocalFile != "" {
							fmt.Fprintf(os.Stderr, "  [%d] 本地文件: %s\n", i+1, filepath.Join(store.ImagesDir(), img.LocalFile))
						}
						if img.RemoteURL != "" {
							fmt.Fprintf(os.Stderr, "  [%d] 远程链接: %s\n", i+1, img.RemoteURL)
						}
					}
					out, _ := json.MarshalIndent(rec, "", "  ")
					fmt.Println(string(out))
					return
				}
				fmt.Fprintf(os.Stderr, "❌ 任务失败 (%s): %s\n", rec.State, rec.ErrorMsg)
				os.Exit(1)
			}
		}

		if time.Now().After(deadline) {
			fmt.Fprintf(os.Stderr, "⏰ 轮询超时 (%ds)，任务 ID: %s 仍在后台处理，稍后可通过 -query %s 继续查询\n", int(timeout.Seconds()), taskID, taskID)
			os.Exit(1)
		}
		time.Sleep(interval)
	}
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
	// Fallback to any OS-assigned free port
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
