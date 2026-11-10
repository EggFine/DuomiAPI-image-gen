# DuomiAPI Image Studio (多米API 图像生成单文件绿色工具)

使用 Go 标准库编写的**单文件、纯绿色**多米 API (`duomiapi.com`) 图像生成客户端，支持 **内嵌 Web 可视化工作台** 与 **CLI 命令行** 双模式。

---

## ✨ 核心特性

- **单文件、零依赖、纯绿色**：
  - 使用 Go 1.22+ `//go:embed all:web` 将基于 **React 19 + Tailwind CSS v4 + shadcn/ui (Radix UI)** 构建的现代化 Web 创作工作台完整打包进单一可执行文件（`CGO_ENABLED=0` 静态编译）。
  - 支持 **深色 / 浅色（Dark / Light）主题一键切换**、网格与紧凑双视图、全屏多图灯箱预览、键盘快捷键切换与灵感提示词快填。
  - **绝不生成或修改注册表**，不向 `AppData` 或用户主目录写入任何垃圾文件。
  - **仅在程序运行目录生成一个 `duomi_data/` 文件夹**，集中保存配置、生成记录和自动下载的原图，拷走即用、删除即净。
- **完整支持多米 API 异步图像接口**：
  - 创建任务：`POST https://duomiapi.com/v1/images/generations?async=true`
  - 查询任务：`GET https://duomiapi.com/v1/tasks/{id}`
  - 认证方式：自动使用明文 `Authorization: <API_KEY>` 请求头（若误填 `Bearer ` 前缀会自动剥离）。
- **全模型与参数覆盖**：
  - 内置支持 `gpt-image-2.6-flare`、`gpt-image-2.6-sunburst`、`gpt-image-2.5-flare`、`gpt-image-2.5-sunburst`、`gpt-image-2`，并支持手动输入任意未来新模型 ID。
  - **先选画幅比例、再选对应尺寸档位**：
    - 支持全部 12 种画幅比例（`auto`、`1:1`、`16:9`、`9:16`、`3:2`、`2:3`、`4:3`、`3:4`、`5:4`、`4:5`、`2:1`、`1:2`），每个比例均内置严格符合多米 API 要求（宽高均为 16 倍数、单边 `[16, 3840]`、总像素 `[655,360 ~ 8,294,400]`）的 **1K / 1.5K / 2K / 4K** 预设尺寸，同时支持自定义 `宽x高`。
  - 支持 **文生图** 与 **多参考图图生图**（可添加直链 URL 或直接拖拽上传本地图片转 Base64，内置大图智能优压防 `HTTP 400` 请求体超限）。
  - 支持思考深度 (`quality`: `low` / `medium` / `high`)、透明背景 (`background`: `auto` / `opaque` / `transparent`)、生成张数 (`n`)、海外节点 (`oversea`)。
- **自动轮询与本地防过期存档**：
  - 任务提交后后台自动轮询进度，生成成功后立即将图片下载至 `duomi_data/images/`，避免多米临时 CDN 链接过期失效。

---

## 📐 画幅比例与对应预设尺寸对照表

所有预设尺寸均严格满足多米 API 规范（每条边 $\in [16, 3840]$ 且能被 $16$ 整除，总像素 $\in [655360, 8294400]$）：

| 画幅比例 | 1K 标准 | 1.5K 进阶 / 官方预设 | 2K 高清 | 4K 超清 | 仅传比例 |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **`1:1` (方图)** | `1024x1024` | `1536x1536` | `2048x2048` | `2880x2880` | `1:1` |
| **`16:9` (横屏)** | `1280x720` | `1536x864` / `1792x1024` | `2560x1440` | `3840x2160` | `16:9` |
| **`9:16` (竖屏)** | `720x1280` | `864x1536` / `1024x1792` | `1440x2560` | `2160x3840` | `9:16` |
| **`3:2` (摄影横)** | `1152x768` | `1536x1024` | `2304x1536` | `3456x2304` | `3:2` |
| **`2:3` (摄影竖)** | `768x1152` | `1024x1536` | `1536x2304` | `2304x3456` | `2:3` |
| **`4:3` (标准横)** | `1152x864` | `1536x1152` | `2048x1536` | `3264x2448` | `4:3` |
| **`3:4` (标准竖)** | `864x1152` | `1152x1536` | `1536x2048` | `2448x3264` | `3:4` |
| **`5:4` (画框横)** | `1120x896` | `1600x1280` | `2240x1792` | `3200x2560` | `5:4` |
| **`4:5` (社交竖)** | `896x1120` | `1280x1600` | `1792x2240` | `2560x3200` | `4:5` |
| **`2:1` (宽幅横)** | `1408x704` | `2048x1024` | `2560x1280` | `3840x1920` | `2:1` |
| **`1:2` (长图竖)** | `704x1408` | `1024x2048` | `1280x2560` | `1920x3840` | `1:2` |

---

## 📁 绿色目录结构

程序运行后，仅在当前可执行文件所在目录生成唯一的 `duomi_data` 文件夹：

```text
├── duomi-image-gen.exe        # 单文件主程序（Windows / Linux / macOS）
└── duomi_data/                # 运行目录下唯一自动生成的数据目录
    ├── config.json            # 保存 API Key、默认模型、轮询间隔等配置
    ├── records.json           # 保存所有历史生成任务记录与参数
    └── images/                # 自动下载保存的所有生成图片文件
```

---

## 🚀 快速使用

### 方式一：可视化 Web 工作台模式（默认）

直接双击运行 `duomi-image-gen.exe`（或在终端无参数执行 `./duomi-image-gen`）：

```bash
./duomi-image-gen
```

程序会自动在本地监听端口（默认 `http://127.0.0.1:18080`）并打开系统默认浏览器：
1. 首次打开点击右上角 **「未配置 API Key」**，填入在 [多米API控制台](https://duomiapi.com) 申请的密钥并保存。
2. 在左侧选择模型、先选 **画幅比例** 再选对应的 **1K / 1.5K / 2K / 4K 预设尺寸**，输入描述词（可选上传本地参考图或粘贴图片 URL），点击 **「立即提交异步生图任务」**。
3. 右侧画廊将实时显示队列与生成进度，完成后自动下载原图到本地 `duomi_data/images/`，支持大图预览、一键将生成图作为参考图继续创作、一键复用历史参数。

可选启动参数：
- `-port 18080`：指定本地 Web 端口（若被占用会自动顺延）
- `-host 127.0.0.1`：指定监听地址
- `-no-browser`：启动时不自动弹出浏览器
- `-data-dir ./my_data`：自定义数据目录路径

---

### 方式二：CLI 命令行模式

传入 `-prompt`、`-prompt-file` 或 `-query` 参数时，程序自动以命令行模式运行，同样共享 `duomi_data/` 目录中的配置与图库：

```bash
# 1. 首次使用可传入 -key 并持久化保存到 duomi_data/config.json
./duomi-image-gen -key "你的多米API密钥" -save-key -prompt "赛博朋克风格的雨夜霓虹街道，电影画幅" -model gpt-image-2.6-flare -ratio 16:9 -tier 4k

# 2. 先选比例(-ratio) + 再选档位(-tier: 1k / 1.5k / 2k / 4k / ratio)，或直接通过 -size 传具体宽高
./duomi-image-gen -prompt "一只戴着宇航员头盔的橘猫，8k超高清" -ratio 1:1 -tier 2k -quality high

# 3. 图生图（支持本地图片路径或远程 URL，可传多张）
./duomi-image-gen -prompt "将人物改为吉卜力手绘水彩风格" -image ./photo.png -ratio 3:2 -tier 2k -background transparent

# 4. 仅提交任务拿 Task ID，不等待轮询
./duomi-image-gen -prompt "未来城市空中花园" -submit-only

# 5. 根据已有的 Task ID 查询状态并下载结果图片
./duomi-image-gen -query "e8f3d384-d740-889b-139b-99d8171488c8"
```

---

## 🛠️ 本地编译与 GitHub Actions 自动发布

### 本地编译单文件

```bash
# 编译当前平台
CGO_ENABLED=0 go build -trimpath -ldflags="-s -w" -o duomi-image-gen .

# 交叉编译 Windows 64位绿色单文件
CGO_ENABLED=0 GOOS=windows GOARCH=amd64 go build -trimpath -ldflags="-s -w" -o duomi-image-gen.exe .
```

### GitHub Actions 自动编译并发布 Release

仓库已配置 [`.github/workflows/release.yml`](.github/workflows/release.yml)：
- 推送 `v*` 标签（如 `git tag v1.0.0 && git push origin v1.0.0`）或在 GitHub Actions 页面手动触发 `Build and Release Single-File Binaries`，即可自动编译 Windows / Linux / macOS 全平台单文件程序并发布至 GitHub Releases。
