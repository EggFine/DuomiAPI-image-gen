import type {
  DiskUsageStats,
  ImageHostProvider,
  PromptHistoryItem,
  ReferenceImageEntry,
  RefImageMode,
  TaskRecord,
  UploadRefResponse,
} from "@/types"

export async function apiFetch<T>(
  url: string,
  options: RequestInit = {}
): Promise<T> {
  const isFormData = options.body instanceof FormData
  const resp = await fetch(url, {
    headers: isFormData
      ? { ...(options.headers || {}) }
      : {
          "Content-Type": "application/json",
          ...(options.headers || {}),
        },
    ...options,
  })
  const data = await resp.json().catch(() => ({}))
  if (!resp.ok) {
    const err: any = new Error(data.error || `请求失败 (HTTP ${resp.status})`)
    err.payload = data
    throw err
  }
  return data as T
}

export async function uploadLocalRefFile(
  file: File,
  opts: {
    mode: RefImageMode
    provider?: ImageHostProvider
    litterboxExpiry?: string
    compressMaxDim?: number
    compressQuality?: number
  }
): Promise<UploadRefResponse> {
  const fd = new FormData()
  fd.append("file", file)
  fd.append("mode", opts.mode)
  if (opts.provider) fd.append("provider", opts.provider)
  if (opts.litterboxExpiry) fd.append("litterbox_expiry", opts.litterboxExpiry)
  if (opts.compressMaxDim)
    fd.append("compress_max_dim", String(opts.compressMaxDim))
  if (opts.compressQuality)
    fd.append("compress_quality", String(opts.compressQuality))

  return apiFetch<UploadRefResponse>("/api/upload-ref", {
    method: "POST",
    body: fd,
  })
}

export async function convertCachedRefOnServer(opts: {
  localRef?: string
  sourceLocalFile?: string
  mode: RefImageMode
  provider?: ImageHostProvider
  litterboxExpiry?: string
  compressMaxDim?: number
  compressQuality?: number
}): Promise<UploadRefResponse> {
  return apiFetch<UploadRefResponse>("/api/upload-ref", {
    method: "POST",
    body: JSON.stringify({
      local_ref: opts.localRef || "",
      source_local_file: opts.sourceLocalFile || "",
      mode: opts.mode,
      provider: opts.provider || "",
      litterbox_expiry: opts.litterboxExpiry || "",
      compress_max_dim: opts.compressMaxDim || 0,
      compress_quality: opts.compressQuality || 0,
    }),
  })
}

export async function organizeRecordsOnServer(payload: {
  ids: string[]
  project_id?: string
  starred?: boolean
  tags?: string[]
  note?: string
}): Promise<{ updated_count: number; records: TaskRecord[] }> {
  return apiFetch("/api/records/organize", {
    method: "POST",
    body: JSON.stringify(payload),
  })
}

export async function cleanOrphanRefsOnServer(): Promise<{
  removed_count: number
  freed_bytes: number
  disk_stats: DiskUsageStats
}> {
  return apiFetch("/api/cache/clean-refs", {
    method: "POST",
  })
}

export function maskKey(k?: string): string {
  const s = (k || "").trim()
  if (!s) return ""
  if (s.length <= 8) return "****"
  return `${s.slice(0, 4)}...${s.slice(-4)}`
}

export function formatBytes(bytes?: number): string {
  if (!bytes || bytes <= 0) return "0 B"
  if (bytes < 1024) return `${bytes} B`
  const kb = bytes / 1024
  if (kb < 1024) return `${kb < 10 ? kb.toFixed(1) : Math.round(kb)} KB`
  const mb = kb / 1024
  if (mb < 1024) return `${mb.toFixed(2)} MB`
  return `${(mb / 1024).toFixed(2)} GB`
}

export function formatUnixTime(ts?: number): string {
  if (!ts) return "-"
  const d = new Date(ts * 1000)
  const pad = (n: number) => String(n).padStart(2, "0")
  return `${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(
    d.getHours()
  )}:${pad(d.getMinutes())}`
}

export function formatDurationSeconds(sec: number): string {
  const s = Math.max(0, Math.floor(sec))
  if (s < 60) return `${s}s`
  const m = Math.floor(s / 60)
  const rem = s % 60
  return `${m}m ${rem}s`
}

export function formatStateLabel(state: string, progress?: number): string {
  switch (state) {
    case "pending":
      return "排队冲印"
    case "running":
      return progress ? `显影中 ${progress}%` : "正在生成"
    case "succeeded":
      return "已完成"
    case "timeout":
      return "轮询超时"
    case "canceled":
      return "已暂停轮询"
    case "error":
    case "failed":
      return "生成失败"
    default:
      return state || "未知状态"
  }
}

export function parsePixelDimensions(sizeStr?: string): {
  w: number
  h: number
  mp: string
  aligned16: boolean
} | null {
  if (!sizeStr) return null
  const parts = sizeStr.toLowerCase().split("x")
  if (parts.length !== 2) return null
  const w = parseInt(parts[0], 10)
  const h = parseInt(parts[1], 10)
  if (!w || !h || isNaN(w) || isNaN(h)) return null
  const mp = ((w * h) / 1_000_000).toFixed(2)
  return {
    w,
    h,
    mp,
    aligned16: w % 16 === 0 && h % 16 === 0,
  }
}

/**
 * Computes exact CSS aspect-ratio string (e.g. "16 / 9" or "2048 / 1536")
 * for both completed images and pending/running developing frames.
 */
export function computeRecordAspectRatio(rec: TaskRecord): string {
  const img = rec.images?.[0]
  if (img?.width && img?.height && img.width > 0 && img.height > 0) {
    return `${img.width} / ${img.height}`
  }
  const s = (rec.size || "").trim().toLowerCase()
  if (s.includes("x")) {
    const [wStr, hStr] = s.split("x")
    const w = parseInt(wStr, 10)
    const h = parseInt(hStr, 10)
    if (w > 0 && h > 0) return `${w} / ${h}`
  }
  if (s.includes(":")) {
    const [wStr, hStr] = s.split(":")
    const w = parseInt(wStr, 10)
    const h = parseInt(hStr, 10)
    if (w > 0 && h > 0) return `${w} / ${h}`
  }
  return "1 / 1"
}

export function groupRecordsByDateBucket(
  records: TaskRecord[]
): Array<{ label: string; items: TaskRecord[] }> {
  const now = new Date()
  const todayStart = new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate()
  ).getTime()
  const yesterdayStart = todayStart - 86400 * 1000
  const weekStart = todayStart - 6 * 86400 * 1000

  const buckets: Record<string, TaskRecord[]> = {
    今天: [],
    昨天: [],
    "近 7 天": [],
    更早归档: [],
  }

  for (const r of records) {
    const ms = (r.create_time || 0) * 1000
    if (ms >= todayStart) {
      buckets["今天"].push(r)
    } else if (ms >= yesterdayStart) {
      buckets["昨天"].push(r)
    } else if (ms >= weekStart) {
      buckets["近 7 天"].push(r)
    } else {
      buckets["更早归档"].push(r)
    }
  }

  return Object.entries(buckets)
    .filter(([, items]) => items.length > 0)
    .map(([label, items]) => ({ label, items }))
}

export const PROJECT_COLOR_MAP: Record<
  string,
  { dot: string; badge: string; label: string }
> = {
  amber: {
    dot: "bg-amber-500",
    badge: "bg-amber-500/15 text-amber-600 dark:text-amber-400 border-amber-500/30",
    label: "琥珀金",
  },
  emerald: {
    dot: "bg-emerald-500",
    badge: "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border-emerald-500/30",
    label: "翡翠绿",
  },
  sky: {
    dot: "bg-sky-500",
    badge: "bg-sky-500/15 text-sky-600 dark:text-sky-400 border-sky-500/30",
    label: "晴空蓝",
  },
  rose: {
    dot: "bg-rose-500",
    badge: "bg-rose-500/15 text-rose-600 dark:text-rose-400 border-rose-500/30",
    label: "珊瑚红",
  },
  slate: {
    dot: "bg-zinc-400",
    badge: "bg-zinc-500/15 text-zinc-600 dark:text-zinc-300 border-zinc-500/30",
    label: "石墨灰",
  },
}

export const PROMPT_ARCHITECT_GROUPS = [
  {
    category: "身份与参考锁定",
    items: [
      {
        label: "严格锁定五官骨相",
        snippet:
          "严格忠实保留参考图中人物的真实脸型、五官比例、眼距鼻梁、发型、眼镜款式、肤色与年龄感，严禁美颜瘦脸或替换成相似陌生面孔。",
      },
      {
        label: "保留原服装去胸牌",
        snippet:
          "完整保留参考图中原有的服装款式、面料质感与色彩搭配，自然移除胸前挂绳、工牌或无关标识。",
      },
      {
        label: "多参考图合并身份",
        snippet:
          "若提供多张参考图，仅作为同一组人物面部与衣着的多角度身份参考，严禁重复增加画面总人数。",
      },
    ],
  },
  {
    category: "镜头焦段与机位",
    items: [
      {
        label: "26mm 手机自然抓拍",
        snippet:
          "普通智能手机后置主摄等效26mm随手平视抓拍，人物自然专注互动、不看镜头不摆拍，充满真实日常临场感。",
      },
      {
        label: "50mm 标准环境人文",
        snippet:
          "全画幅相机配50mm定焦标准镜头平视拍摄，接近人眼自然透视比例，无广角边缘拉伸畸变，主体与环境交代均衡。",
      },
      {
        label: "85mm 浅景深特写",
        snippet:
          "85mm f/1.8人像镜头拍摄，焦点精准落在人物眼部，前景与背景呈自然柔滑的光学散景虚化。",
      },
      {
        label: "24mm 移轴严谨空间",
        snippet:
          "24mm移轴建筑镜头，所有墙柱与桌腿垂直线严格横平竖直，空间纵深线性透视严谨统一。",
      },
    ],
  },
  {
    category: "光影氛围与质感",
    items: [
      {
        label: "自然窗光混合顶灯",
        snippet:
          "侧方窗户柔和自然漫射天光与室内日常日光灯管混合照明，明暗过渡平缓真实，桌面与地面有清晰的接触阴影（AO）。",
      },
      {
        label: "影棚大型柔光箱",
        snippet:
          "专业商业摄影棚双柔光箱漫射主光配合轮廓反射板，高光顺滑细腻，材质纹理立体感极强。",
      },
      {
        label: "原生直出无滤镜肤质",
        snippet:
          "保留真实的皮肤毛孔微纹理、发丝细节与衣物自然折痕，色彩还原克制自然，拒绝塑料磨皮感与过度HDR。",
      },
    ],
  },
  {
    category: "空间人体工学护栏",
    items: [
      {
        label: "标准电脑工位轴线",
        snippet:
          "显示器、键盘与座椅严格处于同一正对工作轴线，右手自然握持键盘右侧鼠标，空格键朝向使用者，背面支架稳固落于桌面无穿模。",
      },
      {
        label: "解剖学手部与手指",
        snippet:
          "人物手部结构与五指关节比例完全符合真实人体解剖学，握笔、敲击键盘或翻页动作自然合理，无多余或扭曲手指。",
      },
      {
        label: "防乱码与水印护栏",
        snippet:
          "画面干净纯粹，纸张与屏幕内容以自然微缩排版的常规代码或符号呈现，严禁出现扭曲乱码大字、多余边框、时间戳或水印。",
      },
    ],
  },
]

const PROMPT_HISTORY_KEY = "duomi_prompt_history_v3"

export function loadPromptHistory(): PromptHistoryItem[] {
  try {
    const raw = localStorage.getItem(PROMPT_HISTORY_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

export function pushPromptHistory(entry: Omit<PromptHistoryItem, "id" | "timestamp">): PromptHistoryItem[] {
  const cleanPrompt = entry.prompt.trim()
  if (!cleanPrompt) return loadPromptHistory()
  const prev = loadPromptHistory().filter((item) => item.prompt.trim() !== cleanPrompt)
  const next: PromptHistoryItem[] = [
    {
      id: `ph_${Date.now()}`,
      prompt: cleanPrompt,
      model: entry.model,
      size: entry.size,
      timestamp: Math.floor(Date.now() / 1000),
    },
    ...prev,
  ].slice(0, 30)
  try {
    localStorage.setItem(PROMPT_HISTORY_KEY, JSON.stringify(next))
  } catch {
    // ignore storage quota
  }
  return next
}

export async function copyImageToClipboard(imgSrc: string): Promise<void> {
  const resp = await fetch(imgSrc)
  const blob = await resp.blob()
  if (blob.type === "image/png" && navigator.clipboard?.write) {
    await navigator.clipboard.write([new ClipboardItem({ "image/png": blob })])
    return
  }
  const bitmap = await createImageBitmap(blob)
  const canvas = document.createElement("canvas")
  canvas.width = bitmap.width
  canvas.height = bitmap.height
  const ctx = canvas.getContext("2d")
  if (!ctx) throw new Error("Canvas context unavailable")
  ctx.drawImage(bitmap, 0, 0)
  const pngBlob = await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((b) => {
      if (b) resolve(b)
      else reject(new Error("PNG 编码失败"))
    }, "image/png")
  })
  await navigator.clipboard.write([new ClipboardItem({ "image/png": pngBlob })])
}

export function buildDeveloperPreview(params: {
  baseUrl: string
  model: string
  prompt: string
  size: string
  quality: string
  background: string
  oversea: boolean
  batchCount: number
  refMode: RefImageMode
  referenceImages: ReferenceImageEntry[]
}): {
  jsonBody: string
  curlCmd: string
  cliCmd: string
} {
  const endpoint = `${(params.baseUrl || "https://duomiapi.com").replace(
    /\/+$/,
    ""
  )}/v1/images/generations?async=true`

  const payload: Record<string, any> = {
    model: params.model,
    prompt: params.prompt || "<在此输入提示词>",
    oversea: params.oversea,
  }
  if (params.size) payload.size = params.size
  if (params.referenceImages.length > 0) {
    payload.image = params.referenceImages.map((item) =>
      item.value.startsWith("data:image/")
        ? `${item.value.slice(0, 42)}... [共 ${Math.round(
            item.value.length / 1024
          )}KB Base64]`
        : item.value
    )
  }
  if (params.quality && params.quality !== "default") {
    payload.quality = params.quality
  }
  if (params.background && params.background !== "auto") {
    payload.background = params.background
  }

  const jsonBody = JSON.stringify(payload, null, 2)
  const escapedJson = JSON.stringify(payload).replace(/'/g, "'\\''")
  const curlCmd = `curl -X POST "${endpoint}" \\\n  -H "Authorization: <YOUR_DUOMI_API_KEY>" \\\n  -H "Content-Type: application/json" \\\n  -d '${escapedJson}'`

  const cliParts = [
    `./duomi-image-gen`,
    `-model "${params.model}"`,
    `-size "${params.size || "1024x1024"}"`,
  ]
  if (params.quality && params.quality !== "default") {
    cliParts.push(`-quality ${params.quality}`)
  }
  if (params.background && params.background !== "auto") {
    cliParts.push(`-background ${params.background}`)
  }
  if (params.batchCount > 1) {
    cliParts.push(`-n ${params.batchCount}`)
  }
  if (params.oversea) {
    cliParts.push(`-oversea`)
  }
  if (params.referenceImages.length > 0) {
    const cliMode =
      params.refMode === "compress_base64"
        ? "compress-base64"
        : params.refMode === "raw_base64"
        ? "raw-base64"
        : "upload"
    cliParts.push(`-ref-mode ${cliMode}`)
    for (const r of params.referenceImages) {
      if (r.remote_url) {
        cliParts.push(`-image "${r.remote_url}"`)
      } else {
        cliParts.push(`-image ./ref_photo.jpg`)
      }
    }
  }
  const safePrompt = (params.prompt || "你的描述词").replace(/"/g, '\\"')
  cliParts.push(`-prompt "${safePrompt}"`)

  return {
    jsonBody,
    curlCmd,
    cliCmd: cliParts.join(" \\\n  "),
  }
}
