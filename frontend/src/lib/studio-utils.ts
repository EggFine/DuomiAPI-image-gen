import type {
  ImageHostProvider,
  ReferenceImageEntry,
  RefImageMode,
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
  )}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
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
      return "排队等待中"
    case "running":
      return progress ? `生成中 ${progress}%` : "正在生成"
    case "succeeded":
      return "已完成"
    case "timeout":
      return "轮询超时"
    case "canceled":
      return "已停止轮询"
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

export async function copyImageToClipboard(imgSrc: string): Promise<void> {
  const resp = await fetch(imgSrc)
  const blob = await resp.blob()
  if (blob.type === "image/png" && navigator.clipboard?.write) {
    await navigator.clipboard.write([new ClipboardItem({ "image/png": blob })])
    return
  }
  // Convert JPEG/WebP blob onto Canvas -> PNG Blob for universal ClipboardItem compatibility
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
