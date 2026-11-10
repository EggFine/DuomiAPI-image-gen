import React, { useCallback, useEffect, useMemo, useRef, useState } from "react"
import {
  AlertCircle,
  BookMarked,
  CheckCircle2,
  Code2,
  FolderOpen,
  Info,
  KeyRound,
  Moon,
  PanelLeftClose,
  PanelLeftOpen,
  Search,
  Sparkles,
  Sun,
} from "lucide-react"
import { GalleryPanel } from "@/components/GalleryPanel"
import { ImageLightbox } from "@/components/ImageLightbox"
import {
  DevPreviewDialog,
  ImportTaskDialog,
  SettingsDialog,
  TemplatesDialog,
} from "@/components/StudioDialogs"
import { StudioSidebar } from "@/components/StudioSidebar"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import {
  apiFetch,
  buildDeveloperPreview,
  convertCachedRefOnServer,
  formatBytes,
  maskKey,
  uploadLocalRefFile,
} from "@/lib/studio-utils"
import { cn } from "@/lib/utils"
import type {
  AppConfig,
  DiskUsageStats,
  ImageHostInfo,
  ImageHostProvider,
  ModelInfo,
  PromptTemplate,
  RatioPresetGroup,
  ReferenceImageEntry,
  RefImageMode,
  SavedImage,
  ServerInfoResponse,
  TaskRecord,
} from "@/types"

interface ToastItem {
  id: string
  message: string
  type: "info" | "success" | "error"
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
      setToasts((prev) => [...prev.slice(-4), { id, message, type }])
      setTimeout(() => {
        setToasts((prev) => prev.filter((t) => t.id !== id))
      }, 4200)
    },
    []
  )

  const copyText = useCallback(
    (text: string, msg = "已复制到剪贴板") => {
      navigator.clipboard
        .writeText(text)
        .then(() => showToast(msg, "success"))
        .catch(() => showToast("复制失败，请手动复制", "error"))
    },
    [showToast]
  )

  // Layout state
  const [sidebarCollapsed, setSidebarCollapsed] = useState<boolean>(false)
  const [mobilePane, setMobilePane] = useState<"studio" | "gallery">("studio")
  const [sseConnected, setSseConnected] = useState<boolean>(false)

  // Server data
  const [info, setInfo] = useState<ServerInfoResponse | null>(null)
  const [config, setConfig] = useState<AppConfig | null>(null)
  const [diskStats, setDiskStats] = useState<DiskUsageStats | null>(null)
  const [models, setModels] = useState<ModelInfo[]>([])
  const [imageHosts, setImageHosts] = useState<ImageHostInfo[]>([])
  const [ratioPresets, setRatioPresets] = useState<RatioPresetGroup[]>([])
  const [builtInTemplates, setBuiltInTemplates] = useState<PromptTemplate[]>([])
  const [records, setRecords] = useState<TaskRecord[]>([])

  // Creation Studio state
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
  const [autoCompatFallback, setAutoCompatFallback] = useState<boolean>(true)

  // Reference Image Strategy state ("upload" default | "compress_base64" optional | "raw_base64" optional)
  const [refMode, setRefMode] = useState<RefImageMode>("upload")
  const [imageHostProvider, setImageHostProvider] =
    useState<ImageHostProvider>("auto")
  const [litterboxExpiry, setLitterboxExpiry] = useState<string>("12h")
  const [compressMaxDim, setCompressMaxDim] = useState<number>(1536)
  const [compressQuality, setCompressQuality] = useState<number>(85)
  const [referenceImages, setReferenceImages] = useState<ReferenceImageEntry[]>([])
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false)
  const [refreshingIds, setRefreshingIds] = useState<Record<string, boolean>>({})

  // Dialog states
  const [settingsOpen, setSettingsOpen] = useState<boolean>(false)
  const [settingsTab, setSettingsTab] = useState<string>("api")
  const [templatesOpen, setTemplatesOpen] = useState<boolean>(false)
  const [devPreviewOpen, setDevPreviewOpen] = useState<boolean>(false)
  const [importTaskOpen, setImportTaskOpen] = useState<boolean>(false)
  const [lightboxRecordId, setLightboxRecordId] = useState<string | null>(null)
  const [lightboxImgIdx, setLightboxImgIdx] = useState<number>(0)

  // Keep latest ref options in a ref for async callbacks
  const refOptsRef = useRef({
    refMode,
    imageHostProvider,
    litterboxExpiry,
    compressMaxDim,
    compressQuality,
  })
  useEffect(() => {
    refOptsRef.current = {
      refMode,
      imageHostProvider,
      litterboxExpiry,
      compressMaxDim,
      compressQuality,
    }
  }, [
    refMode,
    imageHostProvider,
    litterboxExpiry,
    compressMaxDim,
    compressQuality,
  ])

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
      const recData = await apiFetch<{
        records: TaskRecord[]
        disk_stats?: DiskUsageStats
      }>("/api/records")
      setRecords(recData.records || [])
      if (recData.disk_stats) {
        setDiskStats(recData.disk_stats)
      }
    } catch (err) {
      console.error("刷新记录失败:", err)
    }
  }, [])

  // Initial Bootstrap
  useEffect(() => {
    let mounted = true
    ;(async () => {
      try {
        const [infoRes, cfgRes, recRes] = await Promise.all([
          apiFetch<ServerInfoResponse>("/api/info"),
          apiFetch<AppConfig>("/api/config"),
          apiFetch<{ records: TaskRecord[]; disk_stats?: DiskUsageStats }>(
            "/api/records"
          ),
        ])
        if (!mounted) return
        setInfo(infoRes)
        setConfig(cfgRes)
        setDiskStats(recRes.disk_stats || infoRes.disk_stats)
        setModels(infoRes.models || [])
        setImageHosts(infoRes.image_hosts || [])
        setRatioPresets(infoRes.ratio_presets || [])
        setBuiltInTemplates(infoRes.builtin_templates || [])
        setRecords(recRes.records || [])

        setSelectedModel(cfgRes.default_model || "gpt-image-2.6-flare")
        setOversea(!!cfgRes.oversea)
        setAutoCompatFallback(cfgRes.auto_compat_fallback !== false)
        setRefMode(cfgRes.ref_image_mode || "upload")
        setImageHostProvider(cfgRes.image_host_provider || "auto")
        setLitterboxExpiry(cfgRes.litterbox_expiry || "12h")
        setCompressMaxDim(cfgRes.compress_max_dim || 1536)
        setCompressQuality(cfgRes.compress_quality || 85)

        const initSize =
          cfgRes.default_size && cfgRes.default_size !== "auto"
            ? cfgRes.default_size
            : "1024x1024"
        selectSizeOrRatioFromValue(initSize, infoRes.ratio_presets || [])

        if (!cfgRes.api_key || !cfgRes.api_key.trim()) {
          setSettingsTab("api")
          setSettingsOpen(true)
        }
      } catch (err: any) {
        showToast("初始化加载失败: " + err.message, "error")
      }
    })()
    return () => {
      mounted = false
    }
  }, [selectSizeOrRatioFromValue, showToast])

  // Real-Time Server-Sent Events (SSE) subscription
  useEffect(() => {
    let es: EventSource | null = null
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null
    let cancelled = false

    const connect = () => {
      if (cancelled) return
      es = new EventSource("/api/events")
      es.onopen = () => {
        setSseConnected(true)
      }
      es.onmessage = (ev) => {
        try {
          const msg = JSON.parse(ev.data)
          if (msg.type === "connected" && msg.payload?.disk_stats) {
            setDiskStats(msg.payload.disk_stats)
          } else if (msg.type === "record_updated" && msg.payload) {
            const updated: TaskRecord = msg.payload
            setRecords((prev) => {
              const idx = prev.findIndex((r) => r.id === updated.id)
              if (idx === -1) {
                return [updated, ...prev]
              }
              const next = [...prev]
              next[idx] = updated
              return next
            })
          } else if (msg.type === "records_deleted" && msg.payload?.ids) {
            const delSet = new Set<string>(msg.payload.ids)
            setRecords((prev) => prev.filter((r) => !delSet.has(r.id)))
          } else if (msg.type === "stats_updated" && msg.payload) {
            setDiskStats(msg.payload)
          }
        } catch {
          // ignore malformed event
        }
      }
      es.onerror = () => {
        setSseConnected(false)
        es?.close()
        if (!cancelled) {
          reconnectTimer = setTimeout(connect, 3500)
        }
      }
    }

    connect()
    return () => {
      cancelled = true
      if (reconnectTimer) clearTimeout(reconnectTimer)
      es?.close()
    }
  }, [])

  // Fallback polling only if SSE disconnected while tasks are active
  const activeCount = useMemo(
    () =>
      records.filter((r) => r.state === "pending" || r.state === "running")
        .length,
    [records]
  )

  useEffect(() => {
    if (activeCount === 0 || sseConnected) return
    const timer = setInterval(refreshRecords, 3000)
    return () => clearInterval(timer)
  }, [activeCount, sseConnected, refreshRecords])

  // Process local files according to current refMode ("upload" default | "compress_base64" | "raw_base64")
  const handleFilesSelected = useCallback(
    async (fileList: FileList | File[]) => {
      const files = Array.from(fileList)
      const opts = refOptsRef.current
      for (const file of files) {
        if (!file.type.startsWith("image/")) {
          showToast(`已跳过非图片文件: ${file.name}`, "error")
          continue
        }
        const entryId = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`
        const objectPreview = URL.createObjectURL(file)
        const pendingLabel =
          opts.refMode === "upload"
            ? "正在无损上传图床..."
            : opts.refMode === "compress_base64"
            ? "正在本地压缩..."
            : "正在读取原图..."

        setReferenceImages((prev) => [
          ...prev,
          {
            id: entryId,
            mode: opts.refMode,
            value: "",
            preview: objectPreview,
            label: pendingLabel,
            uploading: true,
          },
        ])

        try {
          const res = await uploadLocalRefFile(file, {
            mode: opts.refMode,
            provider: opts.imageHostProvider,
            litterboxExpiry: opts.litterboxExpiry,
            compressMaxDim: opts.compressMaxDim,
            compressQuality: opts.compressQuality,
          })

          setReferenceImages((prev) =>
            prev.map((item) =>
              item.id === entryId
                ? {
                    ...item,
                    mode: res.mode,
                    value: res.value,
                    preview: res.preview_url || objectPreview,
                    local_ref: res.local_ref,
                    remote_url: res.url,
                    provider: res.provider,
                    width: res.width,
                    height: res.height,
                    size_bytes: res.size_bytes,
                    orig_bytes: res.orig_bytes,
                    label: res.label || "已就绪",
                    uploading: false,
                    error: undefined,
                  }
                : item
            )
          )
        } catch (err: any) {
          const payload = err.payload || {}
          setReferenceImages((prev) =>
            prev.map((item) =>
              item.id === entryId
                ? {
                    ...item,
                    preview: payload.preview_url || objectPreview,
                    local_ref: payload.local_ref,
                    width: payload.width,
                    height: payload.height,
                    orig_bytes: payload.orig_bytes,
                    uploading: false,
                    error: err.message,
                    label: "上传失败",
                  }
                : item
            )
          )
          showToast(
            `${err.message}（可点击缩略图重试，或切换为「压缩转Base64」选项）`,
            "error"
          )
        }
      }
    },
    [showToast]
  )

  // Global Ctrl+V / Cmd+V Clipboard Image Paste
  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      const items = e.clipboardData?.items
      if (!items) return
      const imageFiles: File[] = []
      for (let i = 0; i < items.length; i++) {
        const it = items[i]
        if (it.type.startsWith("image/")) {
          const f = it.getAsFile()
          if (f) imageFiles.push(f)
        }
      }
      if (imageFiles.length > 0) {
        e.preventDefault()
        handleFilesSelected(imageFiles)
        showToast(`已从剪贴板粘贴 ${imageFiles.length} 张参考图`, "info")
      }
    }
    window.addEventListener("paste", onPaste)
    return () => window.removeEventListener("paste", onPaste)
  }, [handleFilesSelected, showToast])

  const handlePasteFromClipboardButton = async () => {
    if (!navigator.clipboard?.read) {
      showToast("请直接在页面中按 Ctrl+V 粘贴图片", "info")
      return
    }
    try {
      const items = await navigator.clipboard.read()
      const files: File[] = []
      for (const item of items) {
        const imgType = item.types.find((t) => t.startsWith("image/"))
        if (imgType) {
          const blob = await item.getType(imgType)
          const ext = imgType.split("/")[1] || "png"
          files.push(new File([blob], `clipboard_${Date.now()}.${ext}`, { type: imgType }))
        }
      }
      if (files.length === 0) {
        showToast("当前剪贴板中没有检测到图片或截图", "info")
        return
      }
      await handleFilesSelected(files)
    } catch {
      showToast("浏览器限制直接读取剪贴板，请直接按快捷键 Ctrl+V 粘贴", "info")
    }
  }

  // Re-convert all local reference images in place when user switches refMode or compression/host options
  const reconvertLocalRefs = useCallback(
    async (
      targetMode: RefImageMode,
      nextProvider = imageHostProvider,
      nextExpiry = litterboxExpiry,
      nextMaxDim = compressMaxDim,
      nextQuality = compressQuality
    ) => {
      const convertible = referenceImages.filter((r) => Boolean(r.local_ref))
      if (convertible.length === 0) return

      setReferenceImages((prev) =>
        prev.map((r) =>
          r.local_ref
            ? {
                ...r,
                uploading: true,
                error: undefined,
                label:
                  targetMode === "upload"
                    ? "正在上传图床..."
                    : "正在转换格式...",
              }
            : r
        )
      )

      for (const item of convertible) {
        try {
          const res = await convertCachedRefOnServer({
            localRef: item.local_ref,
            mode: targetMode,
            provider: nextProvider,
            litterboxExpiry: nextExpiry,
            compressMaxDim: nextMaxDim,
            compressQuality: nextQuality,
          })
          setReferenceImages((prev) =>
            prev.map((cur) =>
              cur.id === item.id
                ? {
                    ...cur,
                    mode: res.mode,
                    value: res.value,
                    remote_url: res.url,
                    provider: res.provider,
                    size_bytes: res.size_bytes,
                    width: res.width || cur.width,
                    height: res.height || cur.height,
                    label: res.label || "已转换",
                    uploading: false,
                    error: undefined,
                  }
                : cur
            )
          )
        } catch (err: any) {
          setReferenceImages((prev) =>
            prev.map((cur) =>
              cur.id === item.id
                ? {
                    ...cur,
                    uploading: false,
                    error: err.message,
                    label: "转换失败",
                  }
                : cur
            )
          )
        }
      }
    },
    [
      referenceImages,
      imageHostProvider,
      litterboxExpiry,
      compressMaxDim,
      compressQuality,
    ]
  )

  const handleChangeRefMode = async (nextMode: RefImageMode) => {
    setRefMode(nextMode)
    await reconvertLocalRefs(nextMode)
  }

  const handleRetrySingleRef = async (entry: ReferenceImageEntry) => {
    if (!entry.local_ref) return
    setReferenceImages((prev) =>
      prev.map((r) =>
        r.id === entry.id
          ? { ...r, uploading: true, error: undefined, label: "正在重试..." }
          : r
      )
    )
    try {
      const res = await convertCachedRefOnServer({
        localRef: entry.local_ref,
        mode: refMode,
        provider: imageHostProvider,
        litterboxExpiry,
        compressMaxDim,
        compressQuality,
      })
      setReferenceImages((prev) =>
        prev.map((r) =>
          r.id === entry.id
            ? {
                ...r,
                mode: res.mode,
                value: res.value,
                remote_url: res.url,
                provider: res.provider,
                size_bytes: res.size_bytes,
                label: res.label || "已就绪",
                uploading: false,
                error: undefined,
              }
            : r
        )
      )
    } catch (err: any) {
      setReferenceImages((prev) =>
        prev.map((r) =>
          r.id === entry.id
            ? { ...r, uploading: false, error: err.message, label: "上传失败" }
            : r
        )
      )
      showToast(err.message, "error")
    }
  }

  const handleAddRefUrl = (rawUrl: string) => {
    const trimmed = rawUrl.trim()
    if (!trimmed.startsWith("http://") && !trimmed.startsWith("https://")) {
      showToast("请输入以 http:// 或 https:// 开头的图片直链 URL", "error")
      return
    }
    setReferenceImages((prev) => [
      ...prev,
      {
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        mode: "url",
        value: trimmed,
        preview: trimmed,
        remote_url: trimmed,
        label: "直链 URL",
      },
    ])
  }

  const handleMoveRef = (index: number, direction: -1 | 1) => {
    setReferenceImages((prev) => {
      const target = index + direction
      if (target < 0 || target >= prev.length) return prev
      const next = [...prev]
      const [moved] = next.splice(index, 1)
      next.splice(target, 0, moved)
      return next
    })
  }

  // Use a generated gallery image directly as a Reference Image
  const handleUseGeneratedAsRef = async (img: SavedImage, _rec: TaskRecord) => {
    setMobilePane("studio")
    if (sidebarCollapsed) setSidebarCollapsed(false)

    if (img.local_file) {
      const entryId = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`
      const preview = `/images/${encodeURIComponent(img.local_file)}`
      setReferenceImages((prev) => [
        ...prev,
        {
          id: entryId,
          mode: refMode,
          value: "",
          preview,
          label: refMode === "upload" ? "正在上传图床..." : "正在载入...",
          uploading: true,
        },
      ])
      try {
        const res = await convertCachedRefOnServer({
          sourceLocalFile: img.local_file,
          mode: refMode,
          provider: imageHostProvider,
          litterboxExpiry,
          compressMaxDim,
          compressQuality,
        })
        setReferenceImages((prev) =>
          prev.map((cur) =>
            cur.id === entryId
              ? {
                  ...cur,
                  mode: res.mode,
                  value: res.value,
                  preview: res.preview_url || preview,
                  local_ref: res.local_ref,
                  remote_url: res.url,
                  provider: res.provider,
                  size_bytes: res.size_bytes,
                  width: res.width,
                  height: res.height,
                  label: res.label || "已就绪",
                  uploading: false,
                }
              : cur
          )
        )
        showToast("已将该作品载入参考图栏，可继续微调生成", "success")
      } catch (err: any) {
        if (img.remote_url) {
          setReferenceImages((prev) =>
            prev.map((cur) =>
              cur.id === entryId
                ? {
                    ...cur,
                    mode: "url",
                    value: img.remote_url,
                    remote_url: img.remote_url,
                    label: "远程原图直链",
                    uploading: false,
                  }
                : cur
            )
          )
          showToast("已使用该作品的远程直链作为参考图", "info")
        } else {
          setReferenceImages((prev) => prev.filter((cur) => cur.id !== entryId))
          showToast("载入参考图失败: " + err.message, "error")
        }
      }
      return
    }

    if (img.remote_url) {
      handleAddRefUrl(img.remote_url)
      showToast("已将该作品添加为参考图", "success")
    }
  }

  // Ratio & Size handlers
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

  const handleApplyCustomSize = (overrideW?: number, overrideH?: number) => {
    const rawW = overrideW ?? customW
    const rawH = overrideH ?? customH
    if (!rawW || !rawH || isNaN(rawW) || isNaN(rawH)) {
      showToast("请输入有效的宽度和高度整数", "error")
      return
    }
    const w = Math.max(16, Math.min(3840, Math.round(rawW / 16) * 16))
    const h = Math.max(16, Math.min(3840, Math.round(rawH / 16) * 16))
    setCustomW(w)
    setCustomH(h)
    const pixels = w * h
    if (pixels < 655360 || pixels > 8294400) {
      showToast(
        `${w}×${h} 总像素为 ${pixels.toLocaleString()}，需在 [655,360 ~ 8,294,400] 范围内`,
        "error"
      )
      return
    }
    setSelectedRatio("custom")
    setSelectedSize(`${w}x${h}`)
    showToast(`已对齐 16px 倍数并应用尺寸: ${w}x${h}`, "success")
  }

  // Save Config
  const handleSaveConfig = async (partial: Partial<AppConfig>) => {
    const merged: AppConfig = {
      api_key: config?.api_key || "",
      base_url: config?.base_url || "https://duomiapi.com",
      default_model: customModel.trim() || selectedModel,
      default_size: selectedSize,
      oversea,
      poll_interval: config?.poll_interval || 3,
      poll_timeout: config?.poll_timeout || 300,
      auto_download: config?.auto_download !== false,
      ref_image_mode: refMode,
      image_host_provider: imageHostProvider,
      litterbox_expiry: litterboxExpiry,
      custom_upload_url: config?.custom_upload_url || "",
      custom_upload_field: config?.custom_upload_field || "file",
      custom_upload_auth: config?.custom_upload_auth || "",
      custom_upload_json_path: config?.custom_upload_json_path || "",
      compress_max_dim: compressMaxDim,
      compress_quality: compressQuality,
      auto_compat_fallback: autoCompatFallback,
      prompt_templates: config?.prompt_templates || [],
      ...partial,
    }
    const saved = await apiFetch<AppConfig>("/api/config", {
      method: "POST",
      body: JSON.stringify(merged),
    })
    setConfig(saved)
    setRefMode(saved.ref_image_mode || "upload")
    setImageHostProvider(saved.image_host_provider || "auto")
    setLitterboxExpiry(saved.litterbox_expiry || "12h")
    setCompressMaxDim(saved.compress_max_dim || 1536)
    setCompressQuality(saved.compress_quality || 85)
    setAutoCompatFallback(saved.auto_compat_fallback !== false)
    showToast("设置已持久化保存至 duomi_data/config.json", "success")
  }

  // Submit Generation
  const handleSubmitGenerate = async () => {
    const trimmedPrompt = prompt.trim()
    if (!trimmedPrompt) {
      showToast("请输入画面描述词 (Prompt)", "error")
      return
    }
    if (!config?.api_key?.trim()) {
      showToast("请先配置多米 API 密钥", "error")
      setSettingsTab("api")
      setSettingsOpen(true)
      return
    }

    const failedRefs = referenceImages.filter((r) => r.error || !r.value)
    if (failedRefs.length > 0) {
      showToast(
        "存在尚未上传成功的参考图，请点击重试、移除，或切换为「压缩转Base64」选项",
        "error"
      )
      return
    }

    const finalModel = customModel.trim() || selectedModel || "gpt-image-2.6-flare"
    const finalQuality = quality === "default" ? "" : quality
    const n = Math.max(1, Math.min(10, Number(batchCount) || 1))

    setIsSubmitting(true)
    try {
      const res = await apiFetch<{
        id: string
        submitted_count?: number
        warning_msg?: string
        partial_error?: string
      }>("/api/generate", {
        method: "POST",
        body: JSON.stringify({
          model: finalModel,
          prompt: trimmedPrompt,
          size: selectedSize,
          ref_mode: refMode,
          image: referenceImages.map((item) => item.value),
          ref_items: referenceImages.map((item) => ({
            value: item.value,
            local_ref: item.local_ref || "",
            remote_url: item.remote_url || "",
            mode: item.mode,
            provider: item.provider || "",
            label: item.label,
          })),
          quality: finalQuality,
          background,
          n,
          oversea,
          auto_compat_fallback: autoCompatFallback,
        }),
      })
      const count = res.submitted_count || 1
      showToast(
        count > 1
          ? `已成功并发提交 ${count} 个生图任务，实时推送进度中`
          : `生图任务已提交 (ID: ${(res.id || "").slice(0, 8)}...)`,
        "success"
      )
      if (res.warning_msg) {
        showToast(res.warning_msg, "info")
      }
      if (res.partial_error) {
        showToast(`部分任务提示: ${res.partial_error}`, "error")
      }
      setMobilePane("gallery")
      if (!sseConnected) {
        await refreshRecords()
      }
    } catch (err: any) {
      showToast(err.message, "error")
    } finally {
      setIsSubmitting(false)
    }
  }

  // Reuse Record (including Reference Images!)
  const handleReuseRecord = async (rec: TaskRecord, includeRefs: boolean) => {
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
    setOversea(!!rec.oversea)
    setMobilePane("studio")
    if (sidebarCollapsed) setSidebarCollapsed(false)

    if (includeRefs && rec.ref_items && rec.ref_items.length > 0) {
      const restored: ReferenceImageEntry[] = []
      for (const ri of rec.ref_items) {
        if (ri.local_ref) {
          try {
            const conv = await convertCachedRefOnServer({
              localRef: ri.local_ref,
              mode: refMode,
              provider: imageHostProvider,
              litterboxExpiry,
              compressMaxDim,
              compressQuality,
            })
            restored.push({
              id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
              mode: conv.mode,
              value: conv.value,
              preview: conv.preview_url || `/images/${ri.local_ref}`,
              local_ref: conv.local_ref || ri.local_ref,
              remote_url: conv.url,
              provider: conv.provider,
              size_bytes: conv.size_bytes,
              width: conv.width,
              height: conv.height,
              label: conv.label || "已恢复参考图",
            })
            continue
          } catch {
            // fallback to remote_url if available
          }
        }
        if (ri.remote_url) {
          restored.push({
            id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
            mode: "url",
            value: ri.remote_url,
            preview: ri.remote_url,
            remote_url: ri.remote_url,
            label: "直链 URL",
          })
        }
      }
      setReferenceImages(restored)
      showToast(
        restored.length > 0
          ? `已完整复用参数并恢复 ${restored.length} 张参考图`
          : "已复用该任务参数",
        "success"
      )
    } else {
      showToast("已将该任务的参数填入左侧工作台", "success")
    }
  }

  // Retry failed task directly
  const handleRetryRecord = async (rec: TaskRecord) => {
    const restoredRefs: Array<{
      value: string
      local_ref: string
      remote_url: string
      mode: string
      provider: string
      label: string
    }> = []

    if (rec.ref_items?.length) {
      for (const ri of rec.ref_items) {
        if (ri.local_ref) {
          try {
            const conv = await convertCachedRefOnServer({
              localRef: ri.local_ref,
              mode: refMode,
              provider: imageHostProvider,
              litterboxExpiry,
              compressMaxDim,
              compressQuality,
            })
            restoredRefs.push({
              value: conv.value,
              local_ref: conv.local_ref || ri.local_ref,
              remote_url: conv.url || "",
              mode: conv.mode,
              provider: conv.provider || "",
              label: conv.label || "",
            })
            continue
          } catch {
            // fallback
          }
        }
        if (ri.remote_url) {
          restoredRefs.push({
            value: ri.remote_url,
            local_ref: ri.local_ref || "",
            remote_url: ri.remote_url,
            mode: "url",
            provider: "",
            label: "直链 URL",
          })
        }
      }
    }

    try {
      await apiFetch("/api/generate", {
        method: "POST",
        body: JSON.stringify({
          model: rec.model,
          prompt: rec.prompt,
          size: rec.size,
          ref_mode: refMode,
          image: restoredRefs.map((r) => r.value),
          ref_items: restoredRefs,
          quality: rec.quality,
          background: rec.background,
          n: 1,
          oversea: rec.oversea,
          auto_compat_fallback: autoCompatFallback,
        }),
      })
      showToast("已按原参数重新提交任务", "success")
    } catch (err: any) {
      showToast("重新提交失败: " + err.message, "error")
    }
  }

  const handleRefreshSingle = async (taskId: string) => {
    setRefreshingIds((prev) => ({ ...prev, [taskId]: true }))
    try {
      await apiFetch("/api/tasks/query", {
        method: "POST",
        body: JSON.stringify({ task_id: taskId }),
      })
      showToast("已同步任务最新状态", "success")
    } catch (err: any) {
      showToast(err.message, "error")
    } finally {
      setRefreshingIds((prev) => ({ ...prev, [taskId]: false }))
    }
  }

  const handleCancelPolling = async (taskId: string) => {
    try {
      await apiFetch("/api/records/cancel", {
        method: "POST",
        body: JSON.stringify({ id: taskId }),
      })
      showToast("已停止该任务的本地轮询", "info")
    } catch (err: any) {
      showToast(err.message, "error")
    }
  }

  const handleToggleStar = async (rec: TaskRecord) => {
    try {
      await apiFetch("/api/records/star", {
        method: "POST",
        body: JSON.stringify({ id: rec.id, starred: !rec.starred }),
      })
    } catch (err: any) {
      showToast(err.message, "error")
    }
  }

  const handleDownloadMissingLocal = async (rec: TaskRecord) => {
    try {
      await apiFetch("/api/records/download", {
        method: "POST",
        body: JSON.stringify({ id: rec.id }),
      })
      showToast("已将原图下载至 duomi_data/images/", "success")
    } catch (err: any) {
      showToast(err.message, "error")
    }
  }

  const handleDeleteSingle = async (rec: TaskRecord) => {
    try {
      await apiFetch(
        `/api/records?id=${encodeURIComponent(rec.id)}&delete_files=true`,
        { method: "DELETE" }
      )
      if (lightboxRecordId === rec.id) {
        setLightboxRecordId(null)
      }
      showToast("已删除记录及对应本地图片", "info")
    } catch (err: any) {
      showToast(err.message, "error")
    }
  }

  const handleBatchDelete = async (ids: string[]) => {
    try {
      const res = await apiFetch<{ deleted_count: number }>(
        "/api/records/batch-delete",
        {
          method: "POST",
          body: JSON.stringify({ ids, delete_files: true }),
        }
      )
      showToast(`已批量删除 ${res.deleted_count} 条记录`, "info")
    } catch (err: any) {
      showToast(err.message, "error")
    }
  }

  const handleClearFailed = async () => {
    try {
      const res = await apiFetch<{ deleted_count: number }>(
        "/api/records/batch-delete",
        {
          method: "POST",
          body: JSON.stringify({ clear_failed: true, delete_files: true }),
        }
      )
      showToast(`已清理 ${res.deleted_count} 条失败/超时记录`, "success")
    } catch (err: any) {
      showToast(err.message, "error")
    }
  }

  const handleOpenLocalFolder = async (targetFile?: string) => {
    try {
      const res = await apiFetch<{
        opened: boolean
        path: string
        message: string
      }>("/api/open-folder", {
        method: "POST",
        body: JSON.stringify({ target_file: targetFile || "" }),
      })
      if (res.opened) {
        showToast(res.message, "success")
      } else {
        copyText(res.path, `已复制本地路径: ${res.path}`)
      }
    } catch (err: any) {
      showToast(err.message, "error")
    }
  }

  // Templates handlers
  const handleApplyTemplate = (tpl: PromptTemplate, withParams: boolean) => {
    setPrompt(tpl.prompt)
    if (withParams) {
      if (tpl.model) {
        const known = models.some((m) => m.id === tpl.model)
        if (known) {
          setSelectedModel(tpl.model)
          setCustomModel("")
        } else {
          setCustomModel(tpl.model)
        }
      }
      if (tpl.size) {
        selectSizeOrRatioFromValue(tpl.size, ratioPresets)
      }
      if (tpl.quality) {
        setQuality(tpl.quality)
      }
    }
    showToast(`已载入模板「${tpl.title}」`, "success")
  }

  const handleSaveCustomTemplate = async (tpl: PromptTemplate) => {
    const existing = config?.prompt_templates || []
    await handleSaveConfig({
      prompt_templates: [tpl, ...existing],
    })
  }

  const handleDeleteCustomTemplate = async (id: string) => {
    const existing = config?.prompt_templates || []
    await handleSaveConfig({
      prompt_templates: existing.filter((t) => t.id !== id),
    })
  }

  // Lightbox navigation across succeeded records
  const succeededRecords = useMemo(
    () => records.filter((r) => r.state === "succeeded" && r.images?.length),
    [records]
  )
  const lightboxRecord = useMemo(
    () => records.find((r) => r.id === lightboxRecordId) || null,
    [records, lightboxRecordId]
  )
  const lightboxSeqIdx = useMemo(
    () => succeededRecords.findIndex((r) => r.id === lightboxRecordId),
    [succeededRecords, lightboxRecordId]
  )

  const devPreview = useMemo(
    () =>
      buildDeveloperPreview({
        baseUrl: config?.base_url || "https://duomiapi.com",
        model: customModel.trim() || selectedModel,
        prompt,
        size: selectedSize,
        quality,
        background,
        oversea,
        batchCount,
        refMode,
        referenceImages,
      }),
    [
      config?.base_url,
      customModel,
      selectedModel,
      prompt,
      selectedSize,
      quality,
      background,
      oversea,
      batchCount,
      refMode,
      referenceImages,
    ]
  )

  const hasApiKey = Boolean(config?.api_key && config.api_key.trim())

  return (
    <TooltipProvider delayDuration={180}>
      <div className="min-h-screen flex flex-col bg-background text-foreground">
        {/* Top Studio Navbar */}
        <header className="sticky top-0 z-30 flex h-13 items-center justify-between border-b border-border bg-card/88 px-3.5 backdrop-blur-md lg:px-5 shrink-0">
          <div className="flex items-center gap-2.5">
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="hidden lg:inline-flex h-8 w-8 text-muted-foreground hover:text-foreground"
                  onClick={() => setSidebarCollapsed((p) => !p)}
                  aria-label="展开或收起左侧创作工作台"
                >
                  {sidebarCollapsed ? (
                    <PanelLeftOpen className="h-4 w-4" />
                  ) : (
                    <PanelLeftClose className="h-4 w-4" />
                  )}
                </Button>
              </TooltipTrigger>
              <TooltipContent>
                {sidebarCollapsed ? "展开左侧工作台" : "收起侧栏专注浏览图库"}
              </TooltipContent>
            </Tooltip>

            <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-amber-500 text-zinc-950 font-bold shadow-2xs shrink-0">
              <Sparkles className="h-4 w-4" />
            </div>

            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <h1 className="text-sm font-semibold tracking-tight truncate">
                  多米 API 图像创作工作台
                </h1>
                <Badge
                  variant="amber"
                  className="hidden sm:inline-flex text-[10px] px-1.5 py-0"
                >
                  绿色单文件 v2.0
                </Badge>
                {activeCount > 0 && (
                  <Badge
                    variant="warning"
                    className="text-[10px] px-1.5 py-0 animate-pulse tabular-nums"
                  >
                    进行中 {activeCount}
                  </Badge>
                )}
              </div>
            </div>
          </div>

          <div className="flex items-center gap-1.5 sm:gap-2">
            {/* Portable Directory & Disk Usage Badge */}
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  id="badge-portable-data-dir"
                  type="button"
                  onClick={() => handleOpenLocalFolder()}
                  className="hidden xl:flex items-center gap-1.5 rounded-lg border border-border bg-secondary/55 px-2.5 py-1 text-xs text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors cursor-pointer"
                >
                  <FolderOpen className="h-3.5 w-3.5 text-amber-500 shrink-0" />
                  <span className="font-mono text-[11px] max-w-[150px] truncate">
                    {info?.data_dir?.split(/[\\/]/).pop() || "duomi_data"}
                  </span>
                  {diskStats && (
                    <span className="border-l border-border pl-1.5 font-mono text-[10px] tabular-nums">
                      {diskStats.generated_count}张 ·{" "}
                      {formatBytes(diskStats.total_bytes)}
                    </span>
                  )}
                </button>
              </TooltipTrigger>
              <TooltipContent className="max-w-xs space-y-1">
                <p className="font-medium text-foreground">
                  点击打开本地绿色数据目录 ({info?.data_dir || "./duomi_data"})
                </p>
                <p className="text-muted-foreground">
                  所有配置、记录与原图均保存在此单一目录，绝不写注册表或系统盘。
                </p>
              </TooltipContent>
            </Tooltip>

            {/* Templates Quick Trigger */}
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-8 px-2.5 text-xs hidden md:inline-flex"
              onClick={() => setTemplatesOpen(true)}
            >
              <BookMarked className="h-3.5 w-3.5 text-amber-500" />
              <span>模板库</span>
            </Button>

            {/* API JSON / CLI Preview */}
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  type="button"
                  variant="outline"
                  size="icon"
                  className="h-8 w-8 hidden sm:inline-flex"
                  onClick={() => setDevPreviewOpen(true)}
                  aria-label="请求参数 JSON 与 CLI 预览"
                >
                  <Code2 className="h-3.5 w-3.5" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>查看当前请求 JSON / cURL / CLI 命令</TooltipContent>
            </Tooltip>

            {/* Query Task by ID */}
            <Button
              id="btn-open-query-modal"
              type="button"
              variant="outline"
              size="sm"
              className="h-8 px-2.5 text-xs"
              onClick={() => setImportTaskOpen(true)}
            >
              <Search className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">查任务ID</span>
            </Button>

            {/* Theme Switcher */}
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  id="btn-toggle-theme"
                  type="button"
                  variant="outline"
                  size="icon"
                  className="h-8 w-8"
                  onClick={() =>
                    setTheme((prev) => (prev === "dark" ? "light" : "dark"))
                  }
                  aria-label="切换深浅色外观"
                >
                  {theme === "dark" ? (
                    <Sun className="h-4 w-4 text-amber-400" />
                  ) : (
                    <Moon className="h-4 w-4 text-zinc-700" />
                  )}
                </Button>
              </TooltipTrigger>
              <TooltipContent>
                切换为{theme === "dark" ? "浅色" : "深色"}主题
              </TooltipContent>
            </Tooltip>

            {/* Settings / API Key Trigger */}
            <Button
              id="btn-open-config-modal"
              type="button"
              variant="outline"
              size="sm"
              onClick={() => {
                setSettingsTab("api")
                setSettingsOpen(true)
              }}
              className={cn(
                "h-8 gap-1.5 px-2.5",
                !hasApiKey && "border-amber-500/60 text-amber-500"
              )}
            >
              <span
                title={sseConnected ? "实时推送已连接" : "轮询模式"}
                className={cn(
                  "h-2 w-2 rounded-full shrink-0",
                  hasApiKey
                    ? "bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.55)]"
                    : "bg-amber-500 animate-pulse"
                )}
              />
              <KeyRound className="h-3.5 w-3.5" />
              <span className="text-xs">
                {hasApiKey ? maskKey(config?.api_key) : "配置密钥"}
              </span>
            </Button>
          </div>
        </header>

        {/* Mobile Workspace Tab Bar (< lg) */}
        <div className="flex lg:hidden border-b border-border bg-card/60 p-1.5 gap-1.5">
          <button
            type="button"
            onClick={() => setMobilePane("studio")}
            className={cn(
              "flex-1 rounded-lg py-1.5 text-xs font-semibold transition-colors cursor-pointer",
              mobilePane === "studio"
                ? "bg-amber-500 text-zinc-950"
                : "text-muted-foreground hover:text-foreground"
            )}
          >
            创作参数工作台
          </button>
          <button
            type="button"
            onClick={() => setMobilePane("gallery")}
            className={cn(
              "flex-1 rounded-lg py-1.5 text-xs font-semibold transition-colors cursor-pointer tabular-nums",
              mobilePane === "gallery"
                ? "bg-amber-500 text-zinc-950"
                : "text-muted-foreground hover:text-foreground"
            )}
          >
            作品画廊 ({records.length}
            {activeCount > 0 ? ` · 进行中${activeCount}` : ""})
          </button>
        </div>

        {/* Main Split Studio Workspace */}
        <main
          className={cn(
            "flex-1 grid grid-cols-1 lg:h-[calc(100vh-3.25rem)] lg:overflow-hidden transition-all",
            sidebarCollapsed
              ? "lg:grid-cols-[0px_1fr]"
              : "lg:grid-cols-[435px_1fr] xl:grid-cols-[465px_1fr]"
          )}
        >
          {/* Left Studio Sidebar */}
          <div
            className={cn(
              "lg:h-full lg:overflow-hidden",
              sidebarCollapsed && "lg:hidden",
              mobilePane !== "studio" && "hidden lg:block"
            )}
          >
            <StudioSidebar
              models={models}
              selectedModel={selectedModel}
              onSelectModel={setSelectedModel}
              customModel={customModel}
              onChangeCustomModel={setCustomModel}
              prompt={prompt}
              onChangePrompt={setPrompt}
              onOpenTemplates={() => setTemplatesOpen(true)}
              onSaveAsTemplate={() => setTemplatesOpen(true)}
              refMode={refMode}
              onChangeRefMode={handleChangeRefMode}
              imageHosts={imageHosts}
              imageHostProvider={imageHostProvider}
              onChangeImageHostProvider={(p) => {
                setImageHostProvider(p)
                if (refMode === "upload") {
                  reconvertLocalRefs("upload", p, litterboxExpiry)
                }
              }}
              litterboxExpiry={litterboxExpiry}
              onChangeLitterboxExpiry={(exp) => {
                setLitterboxExpiry(exp)
                if (refMode === "upload") {
                  reconvertLocalRefs("upload", imageHostProvider, exp)
                }
              }}
              compressMaxDim={compressMaxDim}
              onChangeCompressMaxDim={(dim) => {
                setCompressMaxDim(dim)
                if (refMode === "compress_base64") {
                  reconvertLocalRefs(
                    "compress_base64",
                    imageHostProvider,
                    litterboxExpiry,
                    dim,
                    compressQuality
                  )
                }
              }}
              compressQuality={compressQuality}
              onChangeCompressQuality={(q) => {
                setCompressQuality(q)
                if (refMode === "compress_base64") {
                  reconvertLocalRefs(
                    "compress_base64",
                    imageHostProvider,
                    litterboxExpiry,
                    compressMaxDim,
                    q
                  )
                }
              }}
              referenceImages={referenceImages}
              onFilesSelected={handleFilesSelected}
              onAddRefUrl={handleAddRefUrl}
              onRemoveRef={(id) =>
                setReferenceImages((prev) => prev.filter((r) => r.id !== id))
              }
              onMoveRef={handleMoveRef}
              onRetryRef={handleRetrySingleRef}
              onPasteFromClipboardButton={handlePasteFromClipboardButton}
              onCopyText={copyText}
              onOpenSettingsTab={(t) => {
                setSettingsTab(t)
                setSettingsOpen(true)
              }}
              ratioPresets={ratioPresets}
              selectedRatio={selectedRatio}
              selectedSize={selectedSize}
              onSelectRatio={handleSelectRatio}
              onSelectPresetSize={(val, tier) => {
                setSelectedSize(val)
                if (tier && tier !== "auto") {
                  setPreferredTier(tier)
                }
              }}
              onSelectCustomRatioMode={() => setSelectedRatio("custom")}
              customW={customW}
              customH={customH}
              onChangeCustomW={setCustomW}
              onChangeCustomH={setCustomH}
              onApplyCustomSize={handleApplyCustomSize}
              quality={quality}
              onChangeQuality={setQuality}
              background={background}
              onChangeBackground={setBackground}
              oversea={oversea}
              onChangeOversea={setOversea}
              autoCompatFallback={autoCompatFallback}
              onChangeAutoCompatFallback={setAutoCompatFallback}
              batchCount={batchCount}
              onChangeBatchCount={setBatchCount}
              isSubmitting={isSubmitting}
              onSubmitGenerate={handleSubmitGenerate}
              onOpenDevPreview={() => setDevPreviewOpen(true)}
            />
          </div>

          {/* Right Artwork Gallery */}
          <div
            className={cn(
              "lg:h-full lg:overflow-hidden",
              mobilePane !== "gallery" && "hidden lg:block"
            )}
          >
            <GalleryPanel
              records={records}
              refreshingIds={refreshingIds}
              onRefreshAll={async () => {
                await refreshRecords()
                showToast("已刷新记录列表", "info")
              }}
              onRefreshSingle={handleRefreshSingle}
              onCancelPolling={handleCancelPolling}
              onToggleStar={handleToggleStar}
              onOpenLightbox={(rec, idx) => {
                setLightboxRecordId(rec.id)
                setLightboxImgIdx(idx)
              }}
              onUseGeneratedAsRef={handleUseGeneratedAsRef}
              onReuseRecord={handleReuseRecord}
              onRetryRecord={handleRetryRecord}
              onDownloadMissingLocal={handleDownloadMissingLocal}
              onDeleteSingle={handleDeleteSingle}
              onBatchDelete={handleBatchDelete}
              onClearFailed={handleClearFailed}
              onCopyText={copyText}
            />
          </div>
        </main>

        {/* Dialogs & Lightbox */}
        <SettingsDialog
          open={settingsOpen}
          onOpenChange={setSettingsOpen}
          initialTab={settingsTab}
          config={config}
          imageHosts={imageHosts}
          diskStats={diskStats}
          onSaveConfig={handleSaveConfig}
          onOpenLocalFolder={() => handleOpenLocalFolder()}
          onCopyText={copyText}
        />

        <TemplatesDialog
          open={templatesOpen}
          onOpenChange={setTemplatesOpen}
          builtInTemplates={builtInTemplates}
          customTemplates={config?.prompt_templates || []}
          currentPrompt={prompt}
          currentModel={customModel.trim() || selectedModel}
          currentSize={selectedSize}
          currentQuality={quality}
          onApplyTemplate={handleApplyTemplate}
          onSaveCustomTemplate={handleSaveCustomTemplate}
          onDeleteCustomTemplate={handleDeleteCustomTemplate}
        />

        <DevPreviewDialog
          open={devPreviewOpen}
          onOpenChange={setDevPreviewOpen}
          preview={devPreview}
          onCopyText={copyText}
        />

        <ImportTaskDialog
          open={importTaskOpen}
          onOpenChange={setImportTaskOpen}
          onImportTask={async (taskId) => {
            await apiFetch("/api/tasks/query", {
              method: "POST",
              body: JSON.stringify({ task_id: taskId }),
            })
            await refreshRecords()
            showToast(`已同步并归档任务: ${taskId.slice(0, 10)}...`, "success")
          }}
        />

        <ImageLightbox
          record={lightboxRecord}
          imageIndex={lightboxImgIdx}
          onChangeImageIndex={setLightboxImgIdx}
          onClose={() => setLightboxRecordId(null)}
          hasPrevRecord={lightboxSeqIdx > 0}
          hasNextRecord={
            lightboxSeqIdx !== -1 &&
            lightboxSeqIdx < succeededRecords.length - 1
          }
          onNavigateRecord={(dir) => {
            const nextRec = succeededRecords[lightboxSeqIdx + dir]
            if (nextRec) {
              setLightboxRecordId(nextRec.id)
              setLightboxImgIdx(0)
            }
          }}
          onToggleStar={handleToggleStar}
          onUseGeneratedAsRef={handleUseGeneratedAsRef}
          onReuseRecord={handleReuseRecord}
          onOpenLocalFolder={handleOpenLocalFolder}
          onCopyText={copyText}
          onToast={showToast}
        />

        {/* Theme-Aware Floating Toasts */}
        <div
          id="toast-container"
          className="fixed bottom-4 right-4 z-50 flex flex-col gap-2 max-w-sm pointer-events-none"
        >
          {toasts.map((t) => (
            <div
              key={t.id}
              className={cn(
                "pointer-events-auto flex items-center gap-2.5 rounded-xl border px-3.5 py-2.5 text-xs font-medium shadow-lg backdrop-blur-md",
                t.type === "success" &&
                  "border-emerald-500/40 bg-emerald-50 text-emerald-900 dark:bg-emerald-950/92 dark:text-emerald-200",
                t.type === "error" &&
                  "border-red-500/40 bg-red-50 text-red-900 dark:bg-red-950/92 dark:text-red-200",
                t.type === "info" &&
                  "border-border bg-card/95 text-foreground"
              )}
            >
              {t.type === "success" && (
                <CheckCircle2 className="h-4 w-4 text-emerald-600 dark:text-emerald-400 shrink-0" />
              )}
              {t.type === "error" && (
                <AlertCircle className="h-4 w-4 text-red-600 dark:text-red-400 shrink-0" />
              )}
              {t.type === "info" && (
                <Info className="h-4 w-4 text-amber-500 shrink-0" />
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
