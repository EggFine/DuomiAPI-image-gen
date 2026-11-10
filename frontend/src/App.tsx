import React, { useCallback, useEffect, useMemo, useRef, useState } from "react"
import {
  AlertCircle,
  CheckCircle2,
  Copy,
  Download,
  ExternalLink,
  Eye,
  EyeOff,
  FolderOpen,
  Grid2X2,
  Image as ImageIcon,
  Info,
  KeyRound,
  LayoutGrid,
  Link2,
  Loader2,
  Maximize2,
  Moon,
  Plus,
  RefreshCw,
  RotateCcw,
  Search,
  Settings2,
  Sparkles,
  Sun,
  Trash2,
  Upload,
  Wand2,
  X,
} from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Switch } from "@/components/ui/switch"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Textarea } from "@/components/ui/textarea"
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import { cn } from "@/lib/utils"
import type {
  AppConfig,
  ModelInfo,
  RatioPresetGroup,
  ReferenceImageEntry,
  ServerInfoResponse,
  TaskRecord,
} from "@/types"

interface ToastItem {
  id: string
  message: string
  type: "info" | "success" | "error"
}

const QUICK_STYLE_SNIPPETS = [
  { label: "电影感自然光", text: "电影级自然光影，层次感丰富，细节细腻真实" },
  { label: "写实抓拍质感", text: "真实手机后置抓拍质感，自然环境光，真实皮肤纹理与衣物褶皱" },
  { label: "商业产品精修", text: "商业摄影棚布光，极简干净背景，高质感材质表现" },
  { label: "动漫插画厚涂", text: "精美日系厚涂插画风格，细腻光影与丰富色彩层次" },
  { label: "微距景深细节", text: "85mm定焦镜头，自然浅景深，主体焦点锐利清晰" },
  { label: "4K超清锐利", text: "原生4K超高分辨率，边缘清晰，纹理细节丰富" },
]

async function apiFetch<T>(url: string, options: RequestInit = {}): Promise<T> {
  const resp = await fetch(url, {
    headers: {
      "Content-Type": "application/json",
      ...(options.headers || {}),
    },
    ...options,
  })
  const data = await resp.json().catch(() => ({}))
  if (!resp.ok) {
    throw new Error(data.error || `请求失败 (HTTP ${resp.status})`)
  }
  return data as T
}

function maskKey(k?: string): string {
  const s = (k || "").trim()
  if (!s) return ""
  if (s.length <= 8) return "****"
  return `${s.slice(0, 4)}...${s.slice(-4)}`
}

function formatUnixTime(ts?: number): string {
  if (!ts) return "-"
  const d = new Date(ts * 1000)
  const pad = (n: number) => String(n).padStart(2, "0")
  return `${d.getMonth() + 1}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(
    d.getMinutes()
  )}:${pad(d.getSeconds())}`
}

function formatStateLabel(state: string, progress?: number): string {
  switch (state) {
    case "pending":
      return "排队等待中"
    case "running":
      return progress ? `生成中 ${progress}%` : "正在生成中"
    case "succeeded":
      return "生成成功"
    case "timeout":
      return "轮询超时"
    case "error":
    case "failed":
      return "生成失败"
    default:
      return state || "未知状态"
  }
}

function processLocalImageFile(
  file: File,
  autoCompress: boolean
): Promise<{
  uploadDataUrl: string
  compactDataUrl: string
  previewDataUrl: string
  label: string
}> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onerror = () => reject(new Error("文件读取错误"))
    reader.onload = () => {
      const rawDataUrl = String(reader.result || "")
      if (!autoCompress) {
        const kb = Math.max(1, Math.round(file.size / 1024))
        resolve({
          uploadDataUrl: rawDataUrl,
          compactDataUrl: rawDataUrl,
          previewDataUrl: rawDataUrl,
          label: `原图 ${kb}KB`,
        })
        return
      }

      const img = new Image()
      img.onerror = () => {
        const kb = Math.max(1, Math.round(file.size / 1024))
        resolve({
          uploadDataUrl: rawDataUrl,
          compactDataUrl: rawDataUrl,
          previewDataUrl: rawDataUrl,
          label: `${kb}KB`,
        })
      }
      img.onload = () => {
        const renderScaled = (maxDim: number, quality: number) => {
          let w = img.width
          let h = img.height
          if (w > maxDim || h > maxDim) {
            if (w >= h) {
              h = Math.round((h * maxDim) / w)
              w = maxDim
            } else {
              w = Math.round((w * maxDim) / h)
              h = maxDim
            }
          }
          const canvas = document.createElement("canvas")
          canvas.width = w
          canvas.height = h
          const ctx = canvas.getContext("2d")
          if (ctx) {
            ctx.fillStyle = "#ffffff"
            ctx.fillRect(0, 0, w, h)
            ctx.drawImage(img, 0, 0, w, h)
          }
          return canvas.toDataURL("image/jpeg", quality)
        }

        const uploadDataUrl = renderScaled(1440, 0.86)
        const dims = [1024, 896, 768, 640, 512, 384]
        const qualities = [0.82, 0.72, 0.62, 0.52]
        let compactDataUrl = uploadDataUrl
        let compactBytes = Math.round((compactDataUrl.length * 3) / 4)

        outer: for (const maxDim of dims) {
          for (const q of qualities) {
            const candidate = renderScaled(maxDim, q)
            const approxBytes = Math.round((candidate.length * 3) / 4)
            compactDataUrl = candidate
            compactBytes = approxBytes
            if (approxBytes <= 45000) {
              break outer
            }
          }
        }

        resolve({
          uploadDataUrl,
          compactDataUrl,
          previewDataUrl: uploadDataUrl,
          label: `sRGB净荷 ${Math.max(1, Math.round(compactBytes / 1024))}KB`,
        })
      }
      img.src = rawDataUrl
    }
    reader.readAsDataURL(file)
  })
}

function AspectRatioFrame({ w, h }: { w: number; h: number }) {
  if (!w || !h) {
    return (
      <span className="inline-flex h-3.5 w-3.5 items-center justify-center rounded-xs border border-dashed border-current opacity-70 text-[9px] font-mono">
        A
      </span>
    )
  }
  const maxSide = 14
  let boxW = maxSide
  let boxH = maxSide
  if (w >= h) {
    boxH = Math.max(6, Math.round((maxSide * h) / w))
  } else {
    boxW = Math.max(6, Math.round((maxSide * w) / h))
  }
  return (
    <span
      className="inline-block rounded-[2px] border border-current opacity-75 shrink-0"
      style={{ width: `${boxW}px`, height: `${boxH}px` }}
    />
  )
}

export function App() {
  const [theme, setTheme] = useState<"dark" | "light">(() => {
    const saved = localStorage.getItem("duomi_theme")
    return saved === "light" ? "light" : "dark"
  })

  useEffect(() => {
    const root = document.documentElement
    if (theme === "dark") {
      root.classList.add("dark")
    } else {
      root.classList.remove("dark")
    }
    localStorage.setItem("duomi_theme", theme)
  }, [theme])

  const [toasts, setToasts] = useState<ToastItem[]>([])
  const showToast = useCallback(
    (message: string, type: "info" | "success" | "error" = "info") => {
      const id = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`
      setToasts((prev) => [...prev, { id, message, type }])
      setTimeout(() => {
        setToasts((prev) => prev.filter((t) => t.id !== id))
      }, 4000)
    },
    []
  )

  // Server state
  const [info, setInfo] = useState<ServerInfoResponse | null>(null)
  const [config, setConfig] = useState<AppConfig | null>(null)
  const [models, setModels] = useState<ModelInfo[]>([])
  const [ratioPresets, setRatioPresets] = useState<RatioPresetGroup[]>([])
  const [records, setRecords] = useState<TaskRecord[]>([])

  // Creation form state
  const [selectedModel, setSelectedModel] = useState<string>("gpt-image-2.6-flare")
  const [customModel, setCustomModel] = useState<string>("")
  const [prompt, setPrompt] = useState<string>("")
  const [selectedRatio, setSelectedRatio] = useState<string>("1:1")
  const [selectedSize, setSelectedSize] = useState<string>("1024x1024")
  const [preferredTier, setPreferredTier] = useState<string>("1k")
  const [customW, setCustomW] = useState<number>(1024)
  const [customH, setCustomH] = useState<number>(1024)
  const [quality, setQuality] = useState<string>("default")
  const [background, setBackground] = useState<string>("auto")
  const [batchCount, setBatchCount] = useState<number>(1)
  const [oversea, setOversea] = useState<boolean>(false)
  const [autoCompressRef, setAutoCompressRef] = useState<boolean>(true)
  const [referenceImages, setReferenceImages] = useState<ReferenceImageEntry[]>([])
  const [refUrlInput, setRefUrlInput] = useState<string>("")
  const [isDraggingRef, setIsDraggingRef] = useState<boolean>(false)
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false)

  // Gallery filter & view state
  const [filterTab, setFilterTab] = useState<string>("all")
  const [searchQuery, setSearchQuery] = useState<string>("")
  const [compactGrid, setCompactGrid] = useState<boolean>(false)
  const [refreshingIds, setRefreshingIds] = useState<Record<string, boolean>>({})

  // Modals state
  const [configOpen, setConfigOpen] = useState<boolean>(false)
  const [cfgApiKey, setCfgApiKey] = useState<string>("")
  const [cfgShowKey, setCfgShowKey] = useState<boolean>(false)
  const [cfgBaseUrl, setCfgBaseUrl] = useState<string>("https://duomiapi.com")
  const [cfgPollInterval, setCfgPollInterval] = useState<number>(4)
  const [cfgPollTimeout, setCfgPollTimeout] = useState<number>(300)
  const [cfgAutoDownload, setCfgAutoDownload] = useState<boolean>(true)
  const [savingConfig, setSavingConfig] = useState<boolean>(false)

  const [queryModalOpen, setQueryModalOpen] = useState<boolean>(false)
  const [manualTaskId, setManualTaskId] = useState<string>("")
  const [queryingManual, setQueryingManual] = useState<boolean>(false)

  const [lightboxRecord, setLightboxRecord] = useState<TaskRecord | null>(null)
  const [lightboxImgIdx, setLightboxImgIdx] = useState<number>(0)
  const [showRawJson, setShowRawJson] = useState<boolean>(false)

  const fileInputRef = useRef<HTMLInputElement | null>(null)

  const selectSizeOrRatioFromValue = useCallback(
    (sizeVal: string, presets: RatioPresetGroup[]) => {
      const target = (sizeVal || "1024x1024").trim()
      for (const grp of presets) {
        const found = (grp.sizes || []).find((s) => s.value === target)
        if (found) {
          setSelectedRatio(grp.ratio)
          setSelectedSize(found.value)
          if (found.tier && found.tier !== "auto") {
            setPreferredTier(found.tier)
          }
          return
        }
      }
      const directGrp = presets.find((g) => g.ratio === target)
      if (directGrp) {
        setSelectedRatio(directGrp.ratio)
        setSelectedSize(directGrp.default_size || target)
        return
      }
      setSelectedRatio("custom")
      setSelectedSize(target)
      const parts = target.toLowerCase().split("x")
      if (parts.length === 2) {
        setCustomW(parseInt(parts[0], 10) || 1024)
        setCustomH(parseInt(parts[1], 10) || 1024)
      }
    },
    []
  )

  const refreshRecords = useCallback(async () => {
    try {
      const recData = await apiFetch<{ records: TaskRecord[] }>("/api/records")
      setRecords(recData.records || [])
    } catch (err) {
      console.error("刷新记录失败:", err)
    }
  }, [])

  // Initial load
  useEffect(() => {
    let mounted = true
    ;(async () => {
      try {
        const [infoRes, cfgRes, recRes] = await Promise.all([
          apiFetch<ServerInfoResponse>("/api/info"),
          apiFetch<AppConfig>("/api/config"),
          apiFetch<{ records: TaskRecord[] }>("/api/records"),
        ])
        if (!mounted) return
        setInfo(infoRes)
        setConfig(cfgRes)
        setModels(infoRes.models || [])
        setRatioPresets(infoRes.ratio_presets || [])
        setRecords(recRes.records || [])

        setSelectedModel(cfgRes.default_model || "gpt-image-2.6-flare")
        setOversea(!!cfgRes.oversea)

        const initSize =
          cfgRes.default_size && cfgRes.default_size !== "auto"
            ? cfgRes.default_size
            : "1024x1024"
        selectSizeOrRatioFromValue(initSize, infoRes.ratio_presets || [])

        if (!cfgRes.api_key || !cfgRes.api_key.trim()) {
          setCfgApiKey("")
          setCfgBaseUrl(cfgRes.base_url || "https://duomiapi.com")
          setCfgPollInterval(cfgRes.poll_interval || 4)
          setCfgPollTimeout(cfgRes.poll_timeout || 300)
          setCfgAutoDownload(cfgRes.auto_download !== false)
          setConfigOpen(true)
        }
      } catch (err: any) {
        showToast("初始化加载失败: " + err.message, "error")
      }
    })()
    return () => {
      mounted = false
    }
  }, [selectSizeOrRatioFromValue, showToast])

  // Auto-poll active tasks
  const hasActiveTasks = useMemo(
    () => records.some((r) => r.state === "pending" || r.state === "running"),
    [records]
  )

  useEffect(() => {
    if (!hasActiveTasks) return
    const timer = setInterval(() => {
      refreshRecords()
    }, 2500)
    return () => clearInterval(timer)
  }, [hasActiveTasks, refreshRecords])

  // Prompt metrics
  const promptMetrics = useMemo(() => {
    const chars = Array.from(prompt).length
    const utf8Bytes = new TextEncoder().encode(prompt).length
    return { chars, utf8Bytes }
  }, [prompt])

  // Active ratio group
  const activeRatioGroup = useMemo(
    () =>
      ratioPresets.find((g) => g.ratio === selectedRatio) || ratioPresets[0] || null,
    [ratioPresets, selectedRatio]
  )

  const handleSelectRatio = (grp: RatioPresetGroup) => {
    setSelectedRatio(grp.ratio)
    const sizes = grp.sizes || []
    const matched =
      sizes.find((s) => s.tier === preferredTier) ||
      sizes.find((s) => s.value === grp.default_size) ||
      sizes[0]
    if (matched) {
      setSelectedSize(matched.value)
    }
  }

  const handleApplyCustomSize = () => {
    if (!customW || !customH || isNaN(customW) || isNaN(customH)) {
      showToast("请输入有效的宽度和高度整数", "error")
      return
    }
    const w = Math.max(16, Math.min(3840, Math.round(customW / 16) * 16))
    const h = Math.max(16, Math.min(3840, Math.round(customH / 16) * 16))
    setCustomW(w)
    setCustomH(h)
    const pixels = w * h
    if (pixels < 655360 || pixels > 8294400) {
      showToast(
        `当前 ${w}×${h} 总像素为 ${pixels.toLocaleString()}，需在 [655,360 ~ 8,294,400] 范围内`,
        "error"
      )
      return
    }
    setSelectedRatio("custom")
    setSelectedSize(`${w}x${h}`)
    showToast(`已应用自定义尺寸: ${w}x${h} (已自动对齐 16 的倍数)`, "success")
  }

  const handleFilesSelected = async (fileList: FileList | File[]) => {
    const files = Array.from(fileList)
    for (const file of files) {
      if (!file.type.startsWith("image/")) {
        showToast(`已跳过非图片文件: ${file.name}`, "error")
        continue
      }
      try {
        const result = await processLocalImageFile(file, autoCompressRef)
        const entryId = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`
        const initialEntry: ReferenceImageEntry = {
          id: entryId,
          type: "base64",
          value: result.compactDataUrl,
          preview: result.previewDataUrl,
          label: autoCompressRef ? "正在转直链..." : result.label,
          uploading: autoCompressRef,
        }
        setReferenceImages((prev) => [...prev, initialEntry])

        if (autoCompressRef) {
          try {
            const upRes = await apiFetch<{ url: string }>("/api/upload-ref", {
              method: "POST",
              body: JSON.stringify({ data_uri: result.uploadDataUrl }),
            })
            if (upRes && upRes.url) {
              setReferenceImages((prev) =>
                prev.map((item) =>
                  item.id === entryId
                    ? {
                        ...item,
                        type: "url",
                        value: upRes.url,
                        label: "已转直链 URL",
                        uploading: false,
                      }
                    : item
                )
              )
            } else {
              setReferenceImages((prev) =>
                prev.map((item) =>
                  item.id === entryId
                    ? { ...item, label: result.label, uploading: false }
                    : item
                )
              )
            }
          } catch {
            setReferenceImages((prev) =>
              prev.map((item) =>
                item.id === entryId
                  ? { ...item, label: result.label, uploading: false }
                  : item
              )
            )
          }
        }
      } catch (err: any) {
        showToast(`读取图片失败 (${file.name}): ${err.message}`, "error")
      }
    }
  }

  const handleAddRefUrl = () => {
    const trimmed = refUrlInput.trim()
    if (!trimmed) return
    if (!trimmed.startsWith("http://") && !trimmed.startsWith("https://")) {
      showToast("请输入以 http:// 或 https:// 开头的图片直链 URL", "error")
      return
    }
    setReferenceImages((prev) => [
      ...prev,
      {
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        type: "url",
        value: trimmed,
        preview: trimmed,
        label: "直链 URL",
      },
    ])
    setRefUrlInput("")
  }

  const openConfigDialog = () => {
    if (config) {
      setCfgApiKey(config.api_key || "")
      setCfgBaseUrl(config.base_url || "https://duomiapi.com")
      setCfgPollInterval(config.poll_interval || 4)
      setCfgPollTimeout(config.poll_timeout || 300)
      setCfgAutoDownload(config.auto_download !== false)
    }
    setConfigOpen(true)
  }

  const handleSaveConfig = async () => {
    setSavingConfig(true)
    try {
      const saved = await apiFetch<AppConfig>("/api/config", {
        method: "POST",
        body: JSON.stringify({
          api_key: cfgApiKey.trim(),
          base_url: cfgBaseUrl.trim() || "https://duomiapi.com",
          default_model: customModel.trim() || selectedModel,
          default_size: selectedSize,
          oversea,
          poll_interval: Number(cfgPollInterval) || 4,
          poll_timeout: Number(cfgPollTimeout) || 300,
          auto_download: cfgAutoDownload,
        }),
      })
      setConfig(saved)
      setConfigOpen(false)
      showToast("配置已保存至 duomi_data/config.json", "success")
    } catch (err: any) {
      showToast("保存配置失败: " + err.message, "error")
    } finally {
      setSavingConfig(false)
    }
  }

  const handleSubmitGenerate = async () => {
    const trimmedPrompt = prompt.trim()
    if (!trimmedPrompt) {
      showToast("请输入画面描述词 (Prompt)", "error")
      return
    }
    if (!config || !config.api_key || !config.api_key.trim()) {
      showToast("请先配置多米 API 密钥", "error")
      openConfigDialog()
      return
    }

    const finalModel = customModel.trim() || selectedModel || "gpt-image-2.6-flare"
    const finalQuality = quality === "default" ? "" : quality
    const n = Math.max(1, Math.min(10, Number(batchCount) || 1))
    const images = referenceImages.map((item) => item.value)

    setIsSubmitting(true)
    try {
      const res = await apiFetch<{
        id: string
        submitted_count?: number
        partial_error?: string
      }>("/api/generate", {
        method: "POST",
        body: JSON.stringify({
          model: finalModel,
          prompt: trimmedPrompt,
          size: selectedSize,
          image: images,
          quality: finalQuality,
          background,
          n,
          oversea,
        }),
      })
      const count = res.submitted_count || 1
      if (count > 1) {
        showToast(`已成功并发提交 ${count} 个异步生图任务，正在后台轮询`, "success")
      } else {
        showToast(
          `任务已提交 (ID: ${(res.id || "").slice(0, 8)}...)，正在后台自动轮询`,
          "success"
        )
      }
      if (res.partial_error) {
        showToast(`部分任务提示: ${res.partial_error}`, "error")
      }
      await refreshRecords()
    } catch (err: any) {
      showToast(err.message, "error")
    } finally {
      setIsSubmitting(false)
    }
  }

  const handleRefreshSingleTask = async (taskId: string) => {
    setRefreshingIds((prev) => ({ ...prev, [taskId]: true }))
    try {
      await apiFetch("/api/tasks/query", {
        method: "POST",
        body: JSON.stringify({ task_id: taskId }),
      })
      await refreshRecords()
      showToast("已同步该任务最新状态", "success")
    } catch (err: any) {
      showToast(err.message, "error")
    } finally {
      setRefreshingIds((prev) => ({ ...prev, [taskId]: false }))
    }
  }

  const handleManualQueryTask = async () => {
    const id = manualTaskId.trim()
    if (!id) {
      showToast("请输入要查询的多米任务 ID", "error")
      return
    }
    setQueryingManual(true)
    try {
      await apiFetch("/api/tasks/query", {
        method: "POST",
        body: JSON.stringify({ task_id: id }),
      })
      await refreshRecords()
      setManualTaskId("")
      setQueryModalOpen(false)
      showToast(`已导入并同步任务: ${id.slice(0, 10)}...`, "success")
    } catch (err: any) {
      showToast(err.message, "error")
    } finally {
      setQueryingManual(false)
    }
  }

  const handleReuseRecord = (rec: TaskRecord) => {
    setPrompt(rec.prompt || "")
    const isKnown = models.some((m) => m.id === rec.model)
    if (isKnown) {
      setSelectedModel(rec.model)
      setCustomModel("")
    } else if (rec.model) {
      setCustomModel(rec.model)
    }
    if (rec.size) {
      selectSizeOrRatioFromValue(rec.size, ratioPresets)
    }
    setQuality(rec.quality || "default")
    setBackground(rec.background || "auto")
    setBatchCount(rec.n || 1)
    setOversea(!!rec.oversea)
    showToast("已将该任务的参数填入左侧工作台", "success")
  }

  const handleDeleteRecord = async (rec: TaskRecord) => {
    if (
      !window.confirm(
        `确定删除任务记录 ${rec.id.slice(0, 8)}... 吗？（同时清理对应本地图片文件）`
      )
    ) {
      return
    }
    try {
      await apiFetch(
        `/api/records?id=${encodeURIComponent(rec.id)}&delete_files=true`,
        { method: "DELETE" }
      )
      if (lightboxRecord?.id === rec.id) {
        setLightboxRecord(null)
      }
      await refreshRecords()
      showToast("已删除该条记录", "info")
    } catch (err: any) {
      showToast(err.message, "error")
    }
  }

  // Record counts & filtering
  const counts = useMemo(() => {
    const all = records.length
    const active = records.filter(
      (r) => r.state === "pending" || r.state === "running"
    ).length
    const succeeded = records.filter((r) => r.state === "succeeded").length
    const failed = records.filter(
      (r) => r.state === "error" || r.state === "failed" || r.state === "timeout"
    ).length
    return { all, active, succeeded, failed }
  }, [records])

  const filteredRecords = useMemo(() => {
    const q = searchQuery.trim().toLowerCase()
    return records.filter((r) => {
      if (
        filterTab === "active" &&
        r.state !== "pending" &&
        r.state !== "running"
      ) {
        return false
      }
      if (filterTab === "succeeded" && r.state !== "succeeded") {
        return false
      }
      if (
        filterTab === "failed" &&
        r.state !== "error" &&
        r.state !== "failed" &&
        r.state !== "timeout"
      ) {
        return false
      }
      if (q) {
        const hay = `${r.id} ${r.model} ${r.prompt} ${r.size || ""}`.toLowerCase()
        return hay.includes(q)
      }
      return true
    })
  }, [records, filterTab, searchQuery])

  const hasApiKey = Boolean(config?.api_key && config.api_key.trim())
  const customPixels = (Number(customW) || 0) * (Number(customH) || 0)
  const customPixelsValid =
    customPixels >= 655360 &&
    customPixels <= 8294400 &&
    customW >= 16 &&
    customW <= 3840 &&
    customH >= 16 &&
    customH <= 3840

  return (
    <TooltipProvider delayDuration={200}>
      <div className="min-h-screen flex flex-col bg-background text-foreground">
        {/* Top Studio Navbar */}
        <header className="sticky top-0 z-30 flex h-14 items-center justify-between border-b border-border bg-card/85 px-4 backdrop-blur-md lg:px-6">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-amber-500 text-zinc-950 font-bold shadow-xs">
              <Sparkles className="h-5 w-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-sm font-semibold tracking-tight sm:text-base">
                  多米 API 图像创作工作台
                </h1>
                <Badge variant="amber" className="hidden sm:inline-flex text-[11px]">
                  单文件绿色版 v1.1
                </Badge>
              </div>
              <p className="text-[11px] text-muted-foreground hidden sm:block">
                支持 GPT-Image 2.6 Flare / Sunburst · 比例与预设分辨率二级联动 · 零注册表便携存储
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {/* Portable Directory Indicator */}
            <Tooltip>
              <TooltipTrigger asChild>
                <div
                  id="badge-portable-data-dir"
                  className="hidden md:flex items-center gap-1.5 rounded-lg border border-border bg-secondary/60 px-2.5 py-1.5 text-xs text-muted-foreground"
                >
                  <FolderOpen className="h-3.5 w-3.5 text-amber-500 shrink-0" />
                  <span className="font-mono text-[11px] max-w-[180px] truncate">
                    {info?.data_dir || "./duomi_data"}
                  </span>
                </div>
              </TooltipTrigger>
              <TooltipContent className="max-w-xs space-y-1">
                <p className="font-medium text-foreground">纯绿色单目录便携存储</p>
                <p className="text-muted-foreground">
                  所有配置 (config.json)、任务记录 (records.json) 与生成原图 (images/) 均仅保存在此目录，不写注册表或系统盘。
                </p>
              </TooltipContent>
            </Tooltip>

            {/* Query Task by ID Button */}
            <Button
              id="btn-open-query-modal"
              variant="outline"
              size="sm"
              onClick={() => setQueryModalOpen(true)}
            >
              <Search className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">查任务 ID</span>
            </Button>

            {/* Theme Switcher */}
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  id="btn-toggle-theme"
                  variant="outline"
                  size="icon"
                  className="h-8 w-8"
                  onClick={() =>
                    setTheme((prev) => (prev === "dark" ? "light" : "dark"))
                  }
                  aria-label="切换深浅色主题"
                >
                  {theme === "dark" ? (
                    <Sun className="h-4 w-4 text-amber-400" />
                  ) : (
                    <Moon className="h-4 w-4 text-zinc-700" />
                  )}
                </Button>
              </TooltipTrigger>
              <TooltipContent>
                切换为{theme === "dark" ? "浅色" : "深色"}外观
              </TooltipContent>
            </Tooltip>

            {/* API Key Config Trigger */}
            <Button
              id="btn-open-config-modal"
              variant="outline"
              size="sm"
              onClick={openConfigDialog}
              className={cn(
                "gap-2",
                !hasApiKey && "border-amber-500/50 text-amber-500"
              )}
            >
              <span
                className={cn(
                  "h-2 w-2 rounded-full",
                  hasApiKey
                    ? "bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.6)]"
                    : "bg-amber-500 animate-pulse"
                )}
              />
              <KeyRound className="h-3.5 w-3.5" />
              <span className="text-xs">
                {hasApiKey
                  ? `密钥 (${maskKey(config?.api_key)})`
                  : "配置 API Key"}
              </span>
            </Button>
          </div>
        </header>

        {/* Main 2-Column Studio Workspace */}
        <main className="flex-1 grid grid-cols-1 lg:grid-cols-[430px_1fr] xl:grid-cols-[460px_1fr] lg:h-[calc(100vh-3.5rem)] lg:overflow-hidden">
          {/* Left Inspector Panel */}
          <aside
            aria-label="图像生成参数工作台"
            className="border-b lg:border-b-0 lg:border-r border-border bg-card/50 lg:overflow-y-auto p-4 sm:p-5 space-y-5"
          >
            {/* 1. Model Selection */}
            <section className="space-y-2.5">
              <div className="flex items-center justify-between">
                <Label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  生图模型 (Model)
                </Label>
                <span className="text-[11px] text-muted-foreground">
                  异步任务接口 · 0.06 元/次
                </span>
              </div>

              <div className="grid grid-cols-1 gap-2">
                {models.map((m) => {
                  const isSelected = !customModel.trim() && selectedModel === m.id
                  return (
                    <button
                      key={m.id}
                      id={`model-card-${m.id}`}
                      type="button"
                      onClick={() => {
                        setSelectedModel(m.id)
                        setCustomModel("")
                      }}
                      className={cn(
                        "group flex items-start justify-between gap-3 rounded-xl border p-3 text-left transition-all cursor-pointer",
                        isSelected
                          ? "border-amber-500/70 bg-amber-500/[0.07] shadow-2xs"
                          : "border-border bg-background/50 hover:border-border/90 hover:bg-accent/40"
                      )}
                    >
                      <div className="space-y-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="text-xs font-semibold text-foreground">
                            {m.name}
                          </span>
                          <Badge
                            variant={isSelected ? "amber" : "secondary"}
                            className="text-[10px] px-1.5 py-0"
                          >
                            {m.badge}
                          </Badge>
                        </div>
                        <p className="text-[11px] text-muted-foreground leading-relaxed line-clamp-2">
                          {m.description}
                        </p>
                      </div>
                      <span className="font-mono text-[11px] text-muted-foreground shrink-0 pt-0.5">
                        {m.price}
                      </span>
                    </button>
                  )
                })}
              </div>

              <div className="pt-1">
                <Input
                  id="input-custom-model"
                  value={customModel}
                  onChange={(e) => setCustomModel(e.target.value)}
                  placeholder="或输入其它多米支持的模型 ID（留空则使用上方选中模型）"
                  className="h-8 text-xs font-mono"
                />
              </div>
            </section>

            {/* 2. Prompt Input */}
            <section className="space-y-2">
              <div className="flex items-center justify-between">
                <Label
                  htmlFor="input-prompt"
                  className="text-xs font-semibold uppercase tracking-wider text-muted-foreground"
                >
                  画面描述词 (Prompt)
                </Label>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <span
                      id="prompt-char-count"
                      className={cn(
                        "font-mono text-[11px]",
                        promptMetrics.utf8Bytes > 5000
                          ? "text-amber-500 font-semibold"
                          : "text-muted-foreground"
                      )}
                    >
                      {promptMetrics.chars} / 5000 字符 ({promptMetrics.utf8Bytes} B)
                    </span>
                  </TooltipTrigger>
                  <TooltipContent className="max-w-xs">
                    每个中文字符占 3 个 UTF-8 字节。若总字节超过 5000 触发上游长度限制，系统在提交失败时会自动按安全字节边界重试。
                  </TooltipContent>
                </Tooltip>
              </div>

              <Textarea
                id="input-prompt"
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                onKeyDown={(e) => {
                  if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
                    e.preventDefault()
                    if (!isSubmitting) {
                      handleSubmitGenerate()
                    }
                  }
                }}
                maxLength={5000}
                rows={5}
                placeholder="详细描述您想生成的画面主体、人物特征、光影氛围、构图视角... (按 Ctrl+Enter 快速提交)"
                className="resize-y leading-relaxed text-xs sm:text-sm"
              />

              <div className="flex flex-wrap items-center gap-1.5 pt-0.5">
                {QUICK_STYLE_SNIPPETS.map((item) => (
                  <button
                    key={item.label}
                    type="button"
                    onClick={() => {
                      const cur = prompt.trim()
                      setPrompt(cur ? `${cur}，${item.text}` : item.text)
                    }}
                    className="inline-flex items-center gap-1 rounded-md border border-border bg-secondary/50 px-2 py-0.5 text-[11px] text-muted-foreground transition-colors hover:border-amber-500/40 hover:text-foreground cursor-pointer"
                  >
                    <Wand2 className="h-2.5 w-2.5 text-amber-500" />
                    {item.label}
                  </button>
                ))}
                {prompt && (
                  <button
                    id="btn-clear-prompt"
                    type="button"
                    onClick={() => setPrompt("")}
                    className="ml-auto text-[11px] text-muted-foreground hover:text-destructive cursor-pointer"
                  >
                    清空描述
                  </button>
                )}
              </div>
            </section>

            {/* 3. Reference Images (Image-to-Image) */}
            <section className="space-y-2.5">
              <div className="flex items-center justify-between">
                <Label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  参考图 · 图生图 (可选，支持多张)
                </Label>
                <Badge variant="outline" className="text-[11px] font-mono">
                  {referenceImages.length} 张
                </Badge>
              </div>

              <div
                id="ref-drop-zone"
                onDragOver={(e) => {
                  e.preventDefault()
                  setIsDraggingRef(true)
                }}
                onDragLeave={() => setIsDraggingRef(false)}
                onDrop={(e) => {
                  e.preventDefault()
                  setIsDraggingRef(false)
                  if (e.dataTransfer?.files?.length) {
                    handleFilesSelected(e.dataTransfer.files)
                  }
                }}
                className={cn(
                  "rounded-xl border border-dashed p-3 transition-colors space-y-2.5",
                  isDraggingRef
                    ? "border-amber-500 bg-amber-500/10"
                    : "border-border bg-background/40"
                )}
              >
                <div className="flex gap-2">
                  <Button
                    id="btn-select-local-image"
                    type="button"
                    variant="secondary"
                    size="sm"
                    className="w-full text-xs"
                    onClick={() => fileInputRef.current?.click()}
                  >
                    <Upload className="h-3.5 w-3.5 text-amber-500" />
                    选择或拖拽本地参考图
                  </Button>
                  <input
                    ref={fileInputRef}
                    id="input-local-file"
                    type="file"
                    accept="image/*"
                    multiple
                    hidden
                    onChange={(e) => {
                      if (e.target.files?.length) {
                        handleFilesSelected(e.target.files)
                        e.target.value = ""
                      }
                    }}
                  />
                </div>

                <div className="flex gap-1.5">
                  <Input
                    id="input-ref-url"
                    type="url"
                    value={refUrlInput}
                    onChange={(e) => setRefUrlInput(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault()
                        handleAddRefUrl()
                      }
                    }}
                    placeholder="或粘贴图片公网直链 URL (https://...)"
                    className="h-8 text-xs"
                  />
                  <Button
                    id="btn-add-ref-url"
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={handleAddRefUrl}
                  >
                    <Plus className="h-3.5 w-3.5" />
                    添加
                  </Button>
                </div>

                <div className="flex items-center justify-between pt-0.5">
                  <label
                    htmlFor="chk-compress-ref"
                    className="text-[11px] text-muted-foreground cursor-pointer select-none"
                  >
                    本地图自动转临时直链 / 剥离 ICC 净荷优压（防 fail_to_submit_task）
                  </label>
                  <Switch
                    id="chk-compress-ref"
                    checked={autoCompressRef}
                    onCheckedChange={setAutoCompressRef}
                  />
                </div>

                {referenceImages.length > 0 && (
                  <div className="grid grid-cols-4 gap-2 pt-1">
                    {referenceImages.map((item, idx) => (
                      <div
                        key={item.id}
                        className="group relative aspect-square overflow-hidden rounded-lg border border-border bg-secondary"
                      >
                        <img
                          src={item.preview}
                          alt={`参考图 ${idx + 1}`}
                          className="h-full w-full object-cover"
                        />
                        <button
                          type="button"
                          onClick={() =>
                            setReferenceImages((prev) =>
                              prev.filter((r) => r.id !== item.id)
                            )
                          }
                          title="移除此参考图"
                          className="absolute right-1 top-1 flex h-5 w-5 items-center justify-center rounded-full bg-black/75 text-white opacity-90 hover:bg-red-600 cursor-pointer"
                        >
                          <X className="h-3 w-3" />
                        </button>
                        <div
                          className={cn(
                            "absolute inset-x-0 bottom-0 flex items-center justify-center gap-1 px-1 py-0.5 text-[10px] font-medium truncate",
                            item.type === "url"
                              ? "bg-emerald-950/85 text-emerald-300"
                              : "bg-black/75 text-zinc-200"
                          )}
                        >
                          {item.uploading && (
                            <Loader2 className="h-2.5 w-2.5 animate-spin shrink-0" />
                          )}
                          {item.type === "url" && (
                            <Link2 className="h-2.5 w-2.5 shrink-0" />
                          )}
                          <span className="truncate">{item.label}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </section>

            {/* 4. Two-Step Aspect Ratio -> Resolution Selector */}
            <section className="space-y-3 rounded-xl border border-border bg-background/40 p-3.5">
              {/* Step 1: Aspect Ratio */}
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label className="text-xs font-semibold text-foreground">
                    1. 选择画幅比例 (Aspect Ratio)
                  </Label>
                  <span className="text-[11px] text-muted-foreground font-medium">
                    {selectedRatio === "custom"
                      ? "自定义宽高"
                      : activeRatioGroup?.name || selectedRatio}
                  </span>
                </div>

                <div
                  id="ratio-pills-container"
                  className="grid grid-cols-4 gap-1.5"
                >
                  {ratioPresets.map((grp) => {
                    const active = selectedRatio === grp.ratio
                    return (
                      <button
                        key={grp.ratio}
                        id={`ratio-pill-${grp.ratio}`}
                        type="button"
                        onClick={() => handleSelectRatio(grp)}
                        className={cn(
                          "flex items-center justify-center gap-1.5 rounded-lg border px-2 py-1.5 text-xs font-medium transition-all cursor-pointer",
                          active
                            ? "border-amber-500/80 bg-amber-500/15 text-amber-600 dark:text-amber-400 font-semibold shadow-2xs"
                            : "border-border bg-card/70 text-muted-foreground hover:bg-accent hover:text-foreground"
                        )}
                      >
                        <AspectRatioFrame w={grp.aspect_w} h={grp.aspect_h} />
                        <span className="truncate">{grp.ratio}</span>
                      </button>
                    )
                  })}
                  <button
                    id="ratio-pill-custom"
                    type="button"
                    onClick={() => setSelectedRatio("custom")}
                    className={cn(
                      "col-span-2 flex items-center justify-center gap-1.5 rounded-lg border px-2 py-1.5 text-xs font-medium transition-all cursor-pointer",
                      selectedRatio === "custom"
                        ? "border-amber-500/80 bg-amber-500/15 text-amber-600 dark:text-amber-400 font-semibold shadow-2xs"
                        : "border-border bg-card/70 text-muted-foreground hover:bg-accent hover:text-foreground"
                    )}
                  >
                    <Settings2 className="h-3.5 w-3.5" />
                    <span>自定义宽高 (W×H)</span>
                  </button>
                </div>
              </div>

              {/* Step 2: Corresponding Preset Sizes */}
              <div className="space-y-2 pt-1 border-t border-border/60">
                <div className="flex items-center justify-between">
                  <Label className="text-xs font-semibold text-foreground">
                    2. 选择该比例对应尺寸 (Size / 分辨率)
                  </Label>
                  <Badge variant="amber" className="font-mono text-[11px]">
                    {selectedSize}
                  </Badge>
                </div>

                {selectedRatio !== "custom" && activeRatioGroup ? (
                  <div
                    id="size-presets-container"
                    className="grid grid-cols-2 gap-1.5"
                  >
                    {(activeRatioGroup.sizes || []).map((item, idx, arr) => {
                      const active = selectedSize === item.value
                      const isSpanFull =
                        arr.length % 2 === 1 && idx === arr.length - 1
                      return (
                        <button
                          key={item.value}
                          id={`size-preset-${item.value}`}
                          type="button"
                          onClick={() => {
                            setSelectedSize(item.value)
                            if (item.tier && item.tier !== "auto") {
                              setPreferredTier(item.tier)
                            }
                          }}
                          className={cn(
                            "flex flex-col items-start justify-center rounded-lg border px-2.5 py-2 text-left transition-all cursor-pointer",
                            isSpanFull && "col-span-2",
                            active
                              ? "border-amber-500/80 bg-amber-500/15 shadow-2xs"
                              : "border-border bg-card/70 hover:bg-accent/60"
                          )}
                        >
                          <div className="flex w-full items-center justify-between gap-1">
                            <span
                              className={cn(
                                "text-xs font-semibold",
                                active
                                  ? "text-amber-600 dark:text-amber-400"
                                  : "text-foreground"
                              )}
                            >
                              {item.label}
                            </span>
                            <span className="font-mono text-[10px] text-muted-foreground">
                              {item.value}
                            </span>
                          </div>
                          <span className="text-[11px] text-muted-foreground mt-0.5 line-clamp-1">
                            {item.detail}
                          </span>
                        </button>
                      )
                    })}
                  </div>
                ) : (
                  <div className="space-y-2.5 pt-1">
                    <div className="flex items-center gap-2">
                      <div className="flex-1 space-y-1">
                        <span className="text-[11px] text-muted-foreground">
                          宽度 (16 倍数)
                        </span>
                        <Input
                          id="input-custom-w"
                          type="number"
                          min={16}
                          max={3840}
                          step={16}
                          value={customW}
                          onChange={(e) =>
                            setCustomW(parseInt(e.target.value, 10) || 0)
                          }
                          className="h-8 font-mono text-xs"
                        />
                      </div>
                      <span className="pt-5 text-muted-foreground font-mono">
                        ×
                      </span>
                      <div className="flex-1 space-y-1">
                        <span className="text-[11px] text-muted-foreground">
                          高度 (16 倍数)
                        </span>
                        <Input
                          id="input-custom-h"
                          type="number"
                          min={16}
                          max={3840}
                          step={16}
                          value={customH}
                          onChange={(e) =>
                            setCustomH(parseInt(e.target.value, 10) || 0)
                          }
                          className="h-8 font-mono text-xs"
                        />
                      </div>
                      <div className="pt-5">
                        <Button
                          id="btn-apply-custom-size"
                          type="button"
                          variant="secondary"
                          size="sm"
                          onClick={handleApplyCustomSize}
                        >
                          应用宽高
                        </Button>
                      </div>
                    </div>
                    <div className="flex items-center justify-between text-[11px]">
                      <span className="text-muted-foreground">
                        当前像素预算:{" "}
                        <strong
                          className={cn(
                            "font-mono",
                            customPixelsValid
                              ? "text-emerald-500"
                              : "text-destructive"
                          )}
                        >
                          {(customPixels / 10000).toFixed(1)} 万像素
                        </strong>
                      </span>
                      <span className="text-muted-foreground font-mono">
                        范围: 65.5万 ~ 829.4万
                      </span>
                    </div>
                  </div>
                )}
              </div>
            </section>

            {/* 5. Quality, Background, Batch Count & Oversea */}
            <section className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label className="text-xs text-muted-foreground">
                    思考深度 (Quality)
                  </Label>
                  <Select value={quality} onValueChange={setQuality}>
                    <SelectTrigger id="select-quality">
                      <SelectValue placeholder="选择思考深度" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="default">默认 (由模型决定)</SelectItem>
                      <SelectItem value="low">low (快速生成)</SelectItem>
                      <SelectItem value="medium">medium (标准均衡)</SelectItem>
                      <SelectItem value="high">high (深度思考精绘)</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-1.5">
                  <Label className="text-xs text-muted-foreground">
                    背景模式 (Background)
                  </Label>
                  <Select value={background} onValueChange={setBackground}>
                    <SelectTrigger id="select-background">
                      <SelectValue placeholder="选择背景模式" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="auto">auto (自动默认)</SelectItem>
                      <SelectItem value="opaque">opaque (不透明背景)</SelectItem>
                      <SelectItem value="transparent">
                        transparent (透明背景)
                      </SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3 items-end">
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between">
                    <Label
                      htmlFor="input-count-n"
                      className="text-xs text-muted-foreground"
                    >
                      批量生成张数 (并发任务)
                    </Label>
                    <div className="flex gap-1">
                      {[1, 2, 4, 6].map((num) => (
                        <button
                          key={num}
                          type="button"
                          onClick={() => setBatchCount(num)}
                          className={cn(
                            "rounded px-1.5 py-0.2 text-[10px] font-mono border cursor-pointer",
                            batchCount === num
                              ? "border-amber-500/60 bg-amber-500/15 text-amber-500 font-semibold"
                              : "border-border text-muted-foreground hover:text-foreground"
                          )}
                        >
                          {num}
                        </button>
                      ))}
                    </div>
                  </div>
                  <Input
                    id="input-count-n"
                    type="number"
                    min={1}
                    max={10}
                    value={batchCount}
                    onChange={(e) =>
                      setBatchCount(
                        Math.max(1, Math.min(10, parseInt(e.target.value, 10) || 1))
                      )
                    }
                    className="h-9 font-mono text-xs"
                  />
                </div>

                <div className="flex h-9 items-center justify-between rounded-lg border border-border bg-background/50 px-3">
                  <Label
                    htmlFor="chk-oversea"
                    className="text-xs cursor-pointer select-none"
                  >
                    海外节点 (Oversea)
                  </Label>
                  <Switch
                    id="chk-oversea"
                    checked={oversea}
                    onCheckedChange={setOversea}
                  />
                </div>
              </div>
            </section>

            {/* Primary Submit Button */}
            <Button
              id="btn-submit-generate"
              type="button"
              variant="brand"
              size="lg"
              disabled={isSubmitting}
              onClick={handleSubmitGenerate}
              className="w-full shadow-md"
            >
              {isSubmitting ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  {batchCount > 1
                    ? `正在并发提交 ${batchCount} 个任务...`
                    : "正在提交生图任务..."}
                </>
              ) : (
                <>
                  <Sparkles className="h-4 w-4" />
                  {batchCount > 1
                    ? `立即并发提交 ${batchCount} 张异步生图任务`
                    : "立即提交异步生图任务"}
                </>
              )}
            </Button>
          </aside>

          {/* Right Gallery & Task History Panel */}
          <section
            aria-label="生成记录与本地图库"
            className="flex flex-col lg:h-full lg:overflow-hidden bg-background"
          >
            {/* Gallery Toolbar */}
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border bg-card/40 px-4 py-3 sm:px-6">
              <Tabs
                value={filterTab}
                onValueChange={setFilterTab}
                className="w-full sm:w-auto"
              >
                <TabsList className="w-full sm:w-auto grid grid-cols-4 sm:inline-flex">
                  <TabsTrigger value="all" className="gap-1.5">
                    全部
                    <span className="font-mono text-[11px] opacity-75">
                      ({counts.all})
                    </span>
                  </TabsTrigger>
                  <TabsTrigger value="active" className="gap-1.5">
                    进行中
                    <span className="font-mono text-[11px] opacity-75">
                      ({counts.active})
                    </span>
                  </TabsTrigger>
                  <TabsTrigger value="succeeded" className="gap-1.5">
                    已完成
                    <span className="font-mono text-[11px] opacity-75">
                      ({counts.succeeded})
                    </span>
                  </TabsTrigger>
                  <TabsTrigger value="failed" className="gap-1.5">
                    失败/超时
                    <span className="font-mono text-[11px] opacity-75">
                      ({counts.failed})
                    </span>
                  </TabsTrigger>
                </TabsList>
              </Tabs>

              <div className="flex flex-1 sm:flex-initial items-center gap-2 justify-end">
                <div className="relative flex-1 sm:w-64">
                  <Search className="pointer-events-none absolute left-2.5 top-2.5 h-3.5 w-3.5 text-muted-foreground" />
                  <Input
                    id="input-search-records"
                    type="search"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    placeholder="搜索提示词、模型或任务 ID..."
                    className="h-8 pl-8 text-xs"
                  />
                </div>

                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      type="button"
                      variant="outline"
                      size="icon"
                      className="h-8 w-8 shrink-0"
                      onClick={() => setCompactGrid((prev) => !prev)}
                      aria-label="切换网格密度"
                    >
                      {compactGrid ? (
                        <Grid2X2 className="h-3.5 w-3.5" />
                      ) : (
                        <LayoutGrid className="h-3.5 w-3.5" />
                      )}
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>
                    切换为{compactGrid ? "舒适大图" : "紧凑多列"}视图
                  </TooltipContent>
                </Tooltip>

                <Button
                  id="btn-refresh-records"
                  type="button"
                  variant="outline"
                  size="sm"
                  className="h-8"
                  onClick={async () => {
                    await refreshRecords()
                    showToast("已刷新记录列表", "info")
                  }}
                >
                  <RefreshCw className="h-3.5 w-3.5" />
                  <span className="hidden sm:inline">刷新</span>
                </Button>
              </div>
            </div>

            {/* Records Grid Container */}
            <div className="flex-1 overflow-y-auto p-4 sm:p-6">
              {filteredRecords.length === 0 ? (
                <div className="flex h-[380px] flex-col items-center justify-center rounded-2xl border border-dashed border-border bg-card/30 p-8 text-center">
                  <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-secondary text-muted-foreground mb-3">
                    <ImageIcon className="h-6 w-6" />
                  </div>
                  <h2 className="text-sm font-semibold text-foreground">
                    暂无匹配的图像生成记录
                  </h2>
                  <p className="mt-1 max-w-md text-xs text-muted-foreground leading-relaxed">
                    在左侧工作台选择画幅比例、分辨率与模型后输入描述词即可创建异步生图任务；所有生成的原图都会自动下载保存在{" "}
                    <code className="font-mono text-foreground">
                      duomi_data/images/
                    </code>{" "}
                    目录中。
                  </p>
                </div>
              ) : (
                <div
                  id="records-grid"
                  className={cn(
                    "grid gap-4",
                    compactGrid
                      ? "grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4"
                      : "grid-cols-1 md:grid-cols-2 xl:grid-cols-3"
                  )}
                >
                  {filteredRecords.map((rec) => {
                    const images = rec.images || []
                    const isPending =
                      rec.state === "pending" || rec.state === "running"
                    const isSucceeded =
                      rec.state === "succeeded" && images.length > 0
                    const isRefreshing = !!refreshingIds[rec.id]
                    const pct = Math.max(
                      10,
                      rec.progress || (rec.state === "running" ? 50 : 18)
                    )

                    return (
                      <Card
                        key={rec.id}
                        className="group flex flex-col overflow-hidden transition-all hover:border-border/90 hover:shadow-md"
                      >
                        {/* Media Area */}
                        <div className="relative aspect-[4/3] w-full overflow-hidden bg-secondary/50 border-b border-border">
                          {isSucceeded ? (
                            <div
                              className={cn(
                                "grid h-full w-full gap-0.5 bg-checkerboard",
                                images.length > 1 ? "grid-cols-2" : "grid-cols-1"
                              )}
                            >
                              {images.map((img, idx) => {
                                const src = img.local_file
                                  ? `/images/${encodeURIComponent(img.local_file)}`
                                  : img.remote_url
                                const dlHref = img.local_file
                                  ? `/images/${encodeURIComponent(
                                      img.local_file
                                    )}?download=1`
                                  : img.remote_url
                                return (
                                  <div
                                    key={idx}
                                    className="relative h-full w-full overflow-hidden group/img"
                                  >
                                    <img
                                      src={src}
                                      alt={rec.prompt}
                                      loading="lazy"
                                      onClick={() => {
                                        setLightboxRecord(rec)
                                        setLightboxImgIdx(idx)
                                        setShowRawJson(false)
                                      }}
                                      className="h-full w-full object-cover transition-transform duration-300 group-hover/img:scale-[1.03] cursor-zoom-in"
                                    />
                                    <div className="pointer-events-none absolute inset-x-0 bottom-0 flex items-center justify-between bg-gradient-to-t from-black/75 via-black/30 to-transparent p-2.5 opacity-0 transition-opacity group-hover/img:opacity-100">
                                      <button
                                        type="button"
                                        onClick={() => {
                                          setLightboxRecord(rec)
                                          setLightboxImgIdx(idx)
                                          setShowRawJson(false)
                                        }}
                                        className="pointer-events-auto inline-flex items-center gap-1 rounded-md bg-black/70 px-2 py-1 text-[11px] font-medium text-white hover:bg-black cursor-pointer"
                                      >
                                        <Maximize2 className="h-3 w-3" />
                                        查看大图
                                      </button>
                                      <a
                                        href={dlHref}
                                        download={
                                          img.local_file || `duomi_${rec.id}.png`
                                        }
                                        target="_blank"
                                        rel="noreferrer"
                                        className="pointer-events-auto inline-flex items-center gap-1 rounded-md bg-amber-500 px-2 py-1 text-[11px] font-semibold text-zinc-950 hover:bg-amber-400"
                                      >
                                        <Download className="h-3 w-3" />
                                        原图
                                      </a>
                                    </div>
                                  </div>
                                )
                              })}
                            </div>
                          ) : isPending ? (
                            <div className="flex h-full flex-col items-center justify-center p-6 text-center space-y-3">
                              <Loader2 className="h-7 w-7 animate-spin text-amber-500" />
                              <div className="space-y-1">
                                <p className="text-xs font-semibold text-foreground">
                                  {formatStateLabel(rec.state, rec.progress)}
                                </p>
                                <p className="font-mono text-[11px] text-muted-foreground">
                                  ID: {rec.id.slice(0, 18)}...
                                </p>
                              </div>
                              <div className="h-1.5 w-44 overflow-hidden rounded-full bg-secondary">
                                <div
                                  className="h-full rounded-full bg-amber-500 transition-all duration-500"
                                  style={{ width: `${pct}%` }}
                                />
                              </div>
                            </div>
                          ) : (
                            <div className="flex h-full flex-col items-center justify-center p-5 text-center space-y-2">
                              <AlertCircle className="h-6 w-6 text-destructive" />
                              <p className="text-xs font-semibold text-destructive">
                                {formatStateLabel(rec.state)}
                              </p>
                              <p className="text-[11px] text-muted-foreground line-clamp-3 max-w-xs leading-relaxed">
                                {rec.error_msg ||
                                  "任务未成功完成，可点击下方「刷新状态」或「复用参数」重试"}
                              </p>
                            </div>
                          )}
                        </div>

                        {/* Card Body */}
                        <div className="flex flex-1 flex-col justify-between p-3.5 space-y-3">
                          <div className="space-y-2">
                            <div className="flex items-center justify-between gap-2">
                              <Badge
                                variant={
                                  rec.state === "succeeded"
                                    ? "success"
                                    : isPending
                                    ? "warning"
                                    : "destructive"
                                }
                              >
                                {formatStateLabel(rec.state, rec.progress)}
                              </Badge>
                              <span className="font-mono text-[11px] text-muted-foreground">
                                {formatUnixTime(rec.create_time)}
                              </span>
                            </div>

                            <p
                              title={rec.prompt}
                              className="text-xs text-foreground leading-relaxed line-clamp-2"
                            >
                              {rec.prompt}
                            </p>

                            <div className="flex flex-wrap items-center gap-1 pt-0.5">
                              <Badge
                                variant="secondary"
                                className="font-mono text-[10px] px-1.5 py-0"
                              >
                                {rec.model}
                              </Badge>
                              {rec.size && (
                                <Badge
                                  variant="outline"
                                  className="font-mono text-[10px] px-1.5 py-0"
                                >
                                  {rec.size}
                                </Badge>
                              )}
                              {rec.quality && (
                                <Badge
                                  variant="outline"
                                  className="font-mono text-[10px] px-1.5 py-0"
                                >
                                  {rec.quality}
                                </Badge>
                              )}
                              {rec.ref_count > 0 && (
                                <Badge
                                  variant="outline"
                                  className="text-[10px] px-1.5 py-0"
                                >
                                  参考图×{rec.ref_count}
                                </Badge>
                              )}
                            </div>
                          </div>

                          {/* Card Footer Actions */}
                          <div className="flex items-center justify-between border-t border-border/60 pt-2.5">
                            <div className="flex items-center gap-1">
                              <Button
                                type="button"
                                variant="ghost"
                                size="xs"
                                disabled={isRefreshing}
                                onClick={() => handleRefreshSingleTask(rec.id)}
                                title="立即向多米 API 查询该任务最新状态"
                              >
                                <RefreshCw
                                  className={cn(
                                    "h-3 w-3",
                                    isRefreshing && "animate-spin"
                                  )}
                                />
                                刷新状态
                              </Button>
                              <Button
                                type="button"
                                variant="ghost"
                                size="xs"
                                onClick={() => handleReuseRecord(rec)}
                                title="将该任务的描述词和参数填入左侧工作台"
                              >
                                <RotateCcw className="h-3 w-3" />
                                复用参数
                              </Button>
                              <Button
                                type="button"
                                variant="ghost"
                                size="xs"
                                onClick={() => {
                                  navigator.clipboard.writeText(rec.id)
                                  showToast(`已复制任务 ID: ${rec.id}`, "success")
                                }}
                                title="复制任务 ID"
                              >
                                <Copy className="h-3 w-3" />
                                ID
                              </Button>
                            </div>

                            <Button
                              type="button"
                              variant="ghost"
                              size="xs"
                              className="text-muted-foreground hover:text-destructive"
                              onClick={() => handleDeleteRecord(rec)}
                              title="删除记录与本地图片"
                            >
                              <Trash2 className="h-3 w-3" />
                            </Button>
                          </div>
                        </div>
                      </Card>
                    )
                  })}
                </div>
              )}
            </div>
          </section>
        </main>

        {/* Settings Dialog (shadcn/ui Dialog) */}
        <Dialog open={configOpen} onOpenChange={setConfigOpen}>
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle>多米 API 接口与本地绿色存储设置</DialogTitle>
              <DialogDescription>
                密钥与配置将保存在运行目录的{" "}
                <code className="font-mono text-foreground">
                  duomi_data/config.json
                </code>{" "}
                中，绝不写入注册表或系统其它位置。
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-4 py-2">
              <div className="space-y-1.5">
                <Label htmlFor="cfg-api-key">
                  接口密钥 (Authorization API Key)
                </Label>
                <div className="flex gap-1.5">
                  <Input
                    id="cfg-api-key"
                    type={cfgShowKey ? "text" : "password"}
                    value={cfgApiKey}
                    onChange={(e) => setCfgApiKey(e.target.value)}
                    placeholder="输入多米控制台申请的密钥（明文即可，无需加 Bearer 前缀）"
                    className="font-mono text-xs"
                  />
                  <Button
                    id="btn-toggle-key-visibility"
                    type="button"
                    variant="outline"
                    size="icon"
                    onClick={() => setCfgShowKey((prev) => !prev)}
                    title={cfgShowKey ? "隐藏密钥" : "显示密钥"}
                  >
                    {cfgShowKey ? (
                      <EyeOff className="h-4 w-4" />
                    ) : (
                      <Eye className="h-4 w-4" />
                    )}
                  </Button>
                </div>
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="cfg-base-url">API 基础地址 (Base URL)</Label>
                <Input
                  id="cfg-base-url"
                  type="url"
                  value={cfgBaseUrl}
                  onChange={(e) => setCfgBaseUrl(e.target.value)}
                  className="font-mono text-xs"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label htmlFor="cfg-poll-interval">轮询间隔 (秒)</Label>
                  <Input
                    id="cfg-poll-interval"
                    type="number"
                    min={2}
                    max={60}
                    value={cfgPollInterval}
                    onChange={(e) =>
                      setCfgPollInterval(parseInt(e.target.value, 10) || 4)
                    }
                    className="font-mono text-xs"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="cfg-poll-timeout">轮询超时上限 (秒)</Label>
                  <Input
                    id="cfg-poll-timeout"
                    type="number"
                    min={30}
                    max={1800}
                    value={cfgPollTimeout}
                    onChange={(e) =>
                      setCfgPollTimeout(parseInt(e.target.value, 10) || 300)
                    }
                    className="font-mono text-xs"
                  />
                </div>
              </div>

              <div className="flex items-center justify-between rounded-xl border border-border bg-secondary/40 p-3">
                <Label
                  htmlFor="cfg-auto-download"
                  className="text-xs leading-relaxed cursor-pointer"
                >
                  任务成功后自动下载原图到{" "}
                  <code className="font-mono">duomi_data/images/</code>
                </Label>
                <Switch
                  id="cfg-auto-download"
                  checked={cfgAutoDownload}
                  onCheckedChange={setCfgAutoDownload}
                />
              </div>
            </div>

            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => setConfigOpen(false)}
              >
                取消
              </Button>
              <Button
                id="btn-save-config"
                type="button"
                variant="brand"
                disabled={savingConfig}
                onClick={handleSaveConfig}
              >
                {savingConfig ? "正在保存..." : "保存设置"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* Manual Task ID Query Dialog */}
        <Dialog open={queryModalOpen} onOpenChange={setQueryModalOpen}>
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle>通过任务 ID 查询或导入结果</DialogTitle>
              <DialogDescription>
                输入多米 API 返回的异步任务 ID（对应{" "}
                <code className="font-mono">GET /v1/tasks/&#123;id&#125;</code>
                ），查询最新生成进度并自动下载保存图片。
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-2 py-2">
              <Label htmlFor="input-manual-task-id">任务 ID (Task ID)</Label>
              <Input
                id="input-manual-task-id"
                value={manualTaskId}
                onChange={(e) => setManualTaskId(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault()
                    handleManualQueryTask()
                  }
                }}
                placeholder="例如: 6fa577ec-dadf-06cf-04fe-e231c5ee124c"
                className="font-mono text-xs"
              />
            </div>

            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => setQueryModalOpen(false)}
              >
                取消
              </Button>
              <Button
                id="btn-confirm-query-task"
                type="button"
                variant="brand"
                disabled={queryingManual}
                onClick={handleManualQueryTask}
              >
                {queryingManual ? "正在查询..." : "立即查询并同步"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* Lightbox & Task Detail Inspector Dialog */}
        <Dialog
          open={Boolean(lightboxRecord)}
          onOpenChange={(open) => {
            if (!open) setLightboxRecord(null)
          }}
        >
          <DialogContent className="max-w-5xl p-0 overflow-hidden sm:rounded-2xl">
            {lightboxRecord && (() => {
              const imgs = lightboxRecord.images || []
              const activeImg = imgs[lightboxImgIdx] || imgs[0]
              const imgSrc = activeImg
                ? activeImg.local_file
                  ? `/images/${encodeURIComponent(activeImg.local_file)}`
                  : activeImg.remote_url
                : ""
              const dlHref = activeImg
                ? activeImg.local_file
                  ? `/images/${encodeURIComponent(
                      activeImg.local_file
                    )}?download=1`
                  : activeImg.remote_url
                : "#"

              return (
                <div className="grid grid-cols-1 lg:grid-cols-[1fr_340px] max-h-[88vh]">
                  {/* Left High-Res Image Canvas */}
                  <div className="relative flex flex-col items-center justify-center bg-checkerboard bg-zinc-950/90 p-4 min-h-[340px] lg:max-h-[88vh] overflow-hidden">
                    {imgSrc && (
                      <img
                        src={imgSrc}
                        alt={lightboxRecord.prompt}
                        className="max-h-[74vh] w-auto max-w-full rounded-lg object-contain shadow-2xl"
                      />
                    )}
                    {imgs.length > 1 && (
                      <div className="mt-3 flex items-center gap-2 rounded-xl bg-black/70 p-1.5">
                        {imgs.map((thumb, idx) => {
                          const tSrc = thumb.local_file
                            ? `/images/${encodeURIComponent(thumb.local_file)}`
                            : thumb.remote_url
                          return (
                            <button
                              key={idx}
                              type="button"
                              onClick={() => setLightboxImgIdx(idx)}
                              className={cn(
                                "h-12 w-12 overflow-hidden rounded-lg border-2 transition-all cursor-pointer",
                                idx === lightboxImgIdx
                                  ? "border-amber-500 scale-105"
                                  : "border-transparent opacity-60 hover:opacity-100"
                              )}
                            >
                              <img
                                src={tSrc}
                                alt={`缩略图 ${idx + 1}`}
                                className="h-full w-full object-cover"
                              />
                            </button>
                          )
                        })}
                      </div>
                    )}
                  </div>

                  {/* Right Metadata & Actions Sidebar */}
                  <div className="flex flex-col justify-between border-t lg:border-t-0 lg:border-l border-border bg-card p-5 overflow-y-auto max-h-[88vh] space-y-4">
                    <div className="space-y-4">
                      <div>
                        <DialogTitle className="text-sm font-semibold">
                          图像详情与任务参数
                        </DialogTitle>
                        <DialogDescription className="font-mono text-[11px] mt-1 break-all">
                          ID: {lightboxRecord.id}
                        </DialogDescription>
                      </div>

                      <div className="space-y-1.5">
                        <div className="flex items-center justify-between">
                          <span className="text-xs font-medium text-muted-foreground">
                            提示词 (Prompt)
                          </span>
                          <button
                            type="button"
                            onClick={() => {
                              navigator.clipboard.writeText(lightboxRecord.prompt)
                              showToast("已复制提示词", "success")
                            }}
                            className="inline-flex items-center gap-1 text-[11px] text-amber-500 hover:underline cursor-pointer"
                          >
                            <Copy className="h-3 w-3" />
                            复制提示词
                          </button>
                        </div>
                        <div className="max-h-44 overflow-y-auto rounded-xl border border-border bg-background/60 p-3 text-xs leading-relaxed whitespace-pre-wrap">
                          {lightboxRecord.prompt}
                        </div>
                      </div>

                      <div className="space-y-1.5 text-xs">
                        <span className="font-medium text-muted-foreground">
                          任务元数据
                        </span>
                        <div className="rounded-xl border border-border bg-background/60 p-3 space-y-1.5 font-mono text-[11px]">
                          <div className="flex justify-between">
                            <span className="text-muted-foreground">模型:</span>
                            <span>{lightboxRecord.model}</span>
                          </div>
                          <div className="flex justify-between">
                            <span className="text-muted-foreground">尺寸:</span>
                            <span>{lightboxRecord.size || "auto"}</span>
                          </div>
                          <div className="flex justify-between">
                            <span className="text-muted-foreground">思考深度:</span>
                            <span>{lightboxRecord.quality || "默认"}</span>
                          </div>
                          <div className="flex justify-between">
                            <span className="text-muted-foreground">背景:</span>
                            <span>{lightboxRecord.background || "auto"}</span>
                          </div>
                          <div className="flex justify-between">
                            <span className="text-muted-foreground">创建时间:</span>
                            <span>{formatUnixTime(lightboxRecord.create_time)}</span>
                          </div>
                          {activeImg?.local_file && (
                            <div className="pt-1 border-t border-border/60 text-emerald-500 break-all">
                              本地文件: duomi_data/images/{activeImg.local_file}
                            </div>
                          )}
                        </div>
                      </div>

                      {lightboxRecord.raw_response && (
                        <div className="space-y-1.5">
                          <button
                            type="button"
                            onClick={() => setShowRawJson((prev) => !prev)}
                            className="text-[11px] text-muted-foreground hover:text-foreground underline cursor-pointer"
                          >
                            {showRawJson ? "收起 API 原始响应 JSON" : "查看 API 原始响应 JSON"}
                          </button>
                          {showRawJson && (
                            <pre className="max-h-36 overflow-auto rounded-lg border border-border bg-background p-2.5 font-mono text-[10px] text-muted-foreground">
                              {lightboxRecord.raw_response}
                            </pre>
                          )}
                        </div>
                      )}
                    </div>

                    <div className="flex flex-col gap-2 pt-3 border-t border-border">
                      <div className="grid grid-cols-2 gap-2">
                        <Button
                          asChild
                          variant="brand"
                          size="sm"
                        >
                          <a
                            href={dlHref}
                            download={
                              activeImg?.local_file ||
                              `duomi_${lightboxRecord.id}.png`
                            }
                            target="_blank"
                            rel="noreferrer"
                          >
                            <Download className="h-3.5 w-3.5" />
                            下载保存原图
                          </a>
                        </Button>
                        {activeImg?.remote_url && (
                          <Button asChild variant="outline" size="sm">
                            <a
                              href={activeImg.remote_url}
                              target="_blank"
                              rel="noreferrer"
                            >
                              <ExternalLink className="h-3.5 w-3.5" />
                              远程直链
                            </a>
                          </Button>
                        )}
                      </div>
                      <Button
                        type="button"
                        variant="secondary"
                        size="sm"
                        onClick={() => {
                          handleReuseRecord(lightboxRecord)
                          setLightboxRecord(null)
                        }}
                      >
                        <RotateCcw className="h-3.5 w-3.5" />
                        在工作台中复用此任务参数
                      </Button>
                    </div>
                  </div>
                </div>
              )
            })()}
          </DialogContent>
        </Dialog>

        {/* Floating Toasts */}
        <div
          id="toast-container"
          className="fixed bottom-4 right-4 z-50 flex flex-col gap-2 max-w-sm"
        >
          {toasts.map((t) => (
            <div
              key={t.id}
              className={cn(
                "flex items-center gap-2.5 rounded-xl border px-3.5 py-2.5 text-xs font-medium shadow-lg backdrop-blur-md",
                t.type === "success" &&
                  "border-emerald-500/40 bg-emerald-950/90 text-emerald-200",
                t.type === "error" &&
                  "border-red-500/40 bg-red-950/90 text-red-200",
                t.type === "info" &&
                  "border-border bg-card/95 text-foreground"
              )}
            >
              {t.type === "success" && (
                <CheckCircle2 className="h-4 w-4 text-emerald-400 shrink-0" />
              )}
              {t.type === "error" && (
                <AlertCircle className="h-4 w-4 text-red-400 shrink-0" />
              )}
              {t.type === "info" && (
                <Info className="h-4 w-4 text-amber-400 shrink-0" />
              )}
              <span className="leading-relaxed">{t.message}</span>
            </div>
          ))}
        </div>
      </div>
    </TooltipProvider>
  )
}

export default App
