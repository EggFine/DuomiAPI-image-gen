import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react"
import {
  AlertCircle,
  CheckCircle2,
  Command,
  FolderOpen,
  Info,
  KeyRound,
  LayoutPanelLeft,
  PanelTop,
  Search,
} from "lucide-react"
import { AnalyticsQueueView } from "@/components/AnalyticsQueueView"
import { CommandPaletteModal } from "@/components/CommandPaletteModal"
import { ImageLightbox } from "@/components/ImageLightbox"
import { InspirationHubView } from "@/components/InspirationHubView"
import { MasonryArtworkStream } from "@/components/MasonryArtworkStream"
import { OmnibarComposer } from "@/components/OmnibarComposer"
import { PromptWorkbenchModal } from "@/components/PromptWorkbenchModal"
import { RefImageAnnotatorModal } from "@/components/RefImageAnnotatorModal"
import {
  DevPreviewDialog,
  ImportTaskDialog,
  SettingsDialog,
  TemplatesDialog,
} from "@/components/StudioDialogs"
import { StudioRail } from "@/components/StudioRail"
import { StudioSidebar } from "@/components/StudioSidebar"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { TooltipProvider } from "@/components/ui/tooltip"
import { gsap, prefersReducedMotion, STUDIO_EASE } from "@/lib/motion"
import {
  apiFetch,
  buildDeveloperPreview,
  convertCachedRefOnServer,
  formatBytes,
  loadPromptHistory,
  maskKey,
  organizeRecordsOnServer,
  pushPromptHistory,
  uploadLocalRefFile,
} from "@/lib/studio-utils"
import { cn } from "@/lib/utils"
import type {
  AppConfig,
  ComposerLayoutMode,
  DiskUsageStats,
  ImageHostInfo,
  ImageHostProvider,
  ModelInfo,
  ProjectFolder,
  PromptHistoryItem,
  PromptTemplate,
  RatioPresetGroup,
  ReferenceImageEntry,
  RefImageMode,
  SavedImage,
  ServerInfoResponse,
  StudioNavTab,
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
  const toastRefs = useRef<Map<string, HTMLDivElement>>(new Map())
  const seenToastIdsRef = useRef<Set<string>>(new Set())

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

  // Floating Toast spring-slide entrance
  useLayoutEffect(() => {
    const activeIds = new Set(toasts.map((t) => t.id))
    for (const id of seenToastIdsRef.current) {
      if (!activeIds.has(id)) {
        seenToastIdsRef.current.delete(id)
      }
    }
    for (const t of toasts) {
      if (!seenToastIdsRef.current.has(t.id)) {
        seenToastIdsRef.current.add(t.id)
        const el = toastRefs.current.get(t.id)
        if (el && !prefersReducedMotion()) {
          gsap.fromTo(
            el,
            { opacity: 0, x: 22, scale: 0.95 },
            {
              opacity: 1,
              x: 0,
              scale: 1,
              duration: 0.28,
              ease: STUDIO_EASE.spring,
              clearProps: "transform",
            }
          )
        }
      }
    }
  }, [toasts])

  const copyText = useCallback(
    (text: string, msg = "已复制到剪贴板") => {
      navigator.clipboard
        .writeText(text)
        .then(() => showToast(msg, "success"))
        .catch(() => showToast("复制失败，请手动复制", "error"))
    },
    [showToast]
  )

  // Workspace Navigation & Layout Mode
  const [activeTab, setActiveTab] = useState<StudioNavTab>("imagine")
  const [layoutMode, setLayoutMode] = useState<ComposerLayoutMode>(() => {
    const saved = localStorage.getItem("duomi_layout_mode")
    return saved === "split" ? "split" : "omnibar"
  })
  const [splitMobilePane, setSplitMobilePane] = useState<"studio" | "gallery">(
    "studio"
  )
  const [sseConnected, setSseConnected] = useState<boolean>(false)
  const workspaceBodyRef = useRef<HTMLElement | null>(null)
  const prevWorkspaceKeyRef = useRef<string | null>(null)

  const toggleLayoutMode = useCallback(() => {
    setLayoutMode((prev) => {
      const next = prev === "omnibar" ? "split" : "omnibar"
      localStorage.setItem("duomi_layout_mode", next)
      return next
    })
  }, [])

  // Crisp workspace view entrance on tab or layout switch (preserves sticky positioning via clearProps)
  useLayoutEffect(() => {
    const key = `${activeTab}:${layoutMode}`
    if (prevWorkspaceKeyRef.current === null) {
      prevWorkspaceKeyRef.current = key
      return
    }
    if (prevWorkspaceKeyRef.current === key) return
    prevWorkspaceKeyRef.current = key
    if (prefersReducedMotion() || !workspaceBodyRef.current) return
    const target =
      (workspaceBodyRef.current.firstElementChild as HTMLElement | null) ||
      workspaceBodyRef.current
    gsap.fromTo(
      target,
      { opacity: 0, y: 8 },
      {
        opacity: 1,
        y: 0,
        duration: 0.24,
        ease: STUDIO_EASE.out,
        clearProps: "transform,opacity",
        overwrite: "auto",
      }
    )
  }, [activeTab, layoutMode])

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
  const [selectedModel, setSelectedModel] =
    useState<string>("gpt-image-2.6-flare")
  const [customModel, setCustomModel] = useState<string>("")
  const [prompt, setPrompt] = useState<string>("")
  const [promptHistory, setPromptHistory] = useState<PromptHistoryItem[]>(() =>
    loadPromptHistory()
  )
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
  const [activeProjectId, setActiveProjectId] = useState<string>("")

  // Reference Image Strategy ("upload" default | "compress_base64" optional | "raw_base64" optional)
  const [refMode, setRefMode] = useState<RefImageMode>("upload")
  const [imageHostProvider, setImageHostProvider] =
    useState<ImageHostProvider>("auto")
  const [litterboxExpiry, setLitterboxExpiry] = useState<string>("12h")
  const [compressMaxDim, setCompressMaxDim] = useState<number>(1536)
  const [compressQuality, setCompressQuality] = useState<number>(85)
  const [referenceImages, setReferenceImages] = useState<ReferenceImageEntry[]>(
    []
  )
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false)
  const [refreshingIds, setRefreshingIds] = useState<Record<string, boolean>>({})

  // Modals & Lightbox states
  const [settingsOpen, setSettingsOpen] = useState<boolean>(false)
  const [settingsTab, setSettingsTab] = useState<string>("api")
  const [templatesOpen, setTemplatesOpen] = useState<boolean>(false)
  const [devPreviewOpen, setDevPreviewOpen] = useState<boolean>(false)
  const [importTaskOpen, setImportTaskOpen] = useState<boolean>(false)
  const [zenWorkbenchOpen, setZenWorkbenchOpen] = useState<boolean>(false)
  const [commandPaletteOpen, setCommandPaletteOpen] = useState<boolean>(false)
  const [annotatingEntryId, setAnnotatingEntryId] = useState<string | null>(null)

  const [lightboxRecordId, setLightboxRecordId] = useState<string | null>(null)
  const [lightboxImgIdx, setLightboxImgIdx] = useState<number>(0)
  const [lightboxInitialCompare, setLightboxInitialCompare] =
    useState<boolean>(false)

  // Unified Imagine Scroll & On-Demand Quick Composer Overlay State
  const imagineScrollRef = useRef<HTMLDivElement | null>(null)
  const [isScrolledPastComposer, setIsScrolledPastComposer] =
    useState<boolean>(false)
  const [quickComposerOpen, setQuickComposerOpen] = useState<boolean>(false)
  const [quickOverlayRendered, setQuickOverlayRendered] =
    useState<boolean>(false)
  const quickBackdropRef = useRef<HTMLDivElement | null>(null)
  const quickCardRef = useRef<HTMLDivElement | null>(null)
  const prevQuickOpenAnimRef = useRef<boolean>(false)

  useEffect(() => {
    if (quickComposerOpen) {
      setQuickOverlayRendered(true)
    }
  }, [quickComposerOpen])

  // Smooth GSAP entrance & exit choreography for Quick Composer Overlay
  useLayoutEffect(() => {
    if (quickComposerOpen && !prevQuickOpenAnimRef.current) {
      prevQuickOpenAnimRef.current = true
      if (prefersReducedMotion()) return
      const backdrop = quickBackdropRef.current
      const card = quickCardRef.current
      if (backdrop) {
        gsap.killTweensOf(backdrop)
        gsap.fromTo(
          backdrop,
          { opacity: 0 },
          { opacity: 1, duration: 0.2, ease: STUDIO_EASE.out }
        )
      }
      if (card) {
        gsap.killTweensOf(card)
        gsap.fromTo(
          card,
          { opacity: 0, y: -16, scale: 0.975 },
          {
            opacity: 1,
            y: 0,
            scale: 1,
            duration: 0.26,
            ease: STUDIO_EASE.expo,
            clearProps: "transform",
          }
        )
      }
    } else if (!quickComposerOpen && prevQuickOpenAnimRef.current) {
      prevQuickOpenAnimRef.current = false
      const backdrop = quickBackdropRef.current
      const card = quickCardRef.current
      if (prefersReducedMotion() || !backdrop || !card) {
        setQuickOverlayRendered(false)
        return
      }
      gsap.killTweensOf(backdrop)
      gsap.killTweensOf(card)
      gsap.to(backdrop, {
        opacity: 0,
        duration: 0.16,
        ease: "power2.in",
      })
      gsap.to(card, {
        opacity: 0,
        y: -10,
        scale: 0.98,
        duration: 0.16,
        ease: "power2.in",
        onComplete: () => setQuickOverlayRendered(false),
      })
    }
  }, [quickComposerOpen])

  const scrollToImagineTop = useCallback(() => {
    setQuickComposerOpen(false)
    imagineScrollRef.current?.scrollTo({ top: 0, behavior: "smooth" })
  }, [])

  useEffect(() => {
    if (activeTab !== "imagine" || layoutMode !== "omnibar") {
      setQuickComposerOpen(false)
      setQuickOverlayRendered(false)
    }
  }, [activeTab, layoutMode])

  // Global Keyboard Shortcuts: Ctrl/Cmd+K (Command Palette), Ctrl/Cmd+J (Quick Composer), Esc & Alt+1..4 (Tabs)
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault()
        setCommandPaletteOpen((prev) => !prev)
        return
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "j") {
        e.preventDefault()
        if (activeTab !== "imagine") {
          setActiveTab("imagine")
          requestAnimationFrame(() => {
            document.getElementById("omnibar-prompt-input")?.focus()
          })
          return
        }
        if (layoutMode === "omnibar" && isScrolledPastComposer) {
          setQuickComposerOpen((prev) => !prev)
        } else {
          scrollToImagineTop()
          requestAnimationFrame(() => {
            document.getElementById("omnibar-prompt-input")?.focus()
          })
        }
        return
      }
      if (
        e.key === "Escape" &&
        quickComposerOpen &&
        !zenWorkbenchOpen &&
        !annotatingEntryId &&
        !lightboxRecordId &&
        !settingsOpen &&
        !commandPaletteOpen
      ) {
        setQuickComposerOpen(false)
        return
      }
      if (e.altKey && !e.ctrlKey && !e.metaKey) {
        if (e.key === "1") {
          e.preventDefault()
          setActiveTab("imagine")
        } else if (e.key === "2") {
          e.preventDefault()
          setActiveTab("gallery")
        } else if (e.key === "3") {
          e.preventDefault()
          setActiveTab("recipes")
        } else if (e.key === "4") {
          e.preventDefault()
          setActiveTab("analytics")
        }
      }
    }
    window.addEventListener("keydown", onKeyDown)
    return () => window.removeEventListener("keydown", onKeyDown)
  }, [
    activeTab,
    layoutMode,
    isScrolledPastComposer,
    quickComposerOpen,
    zenWorkbenchOpen,
    annotatingEntryId,
    lightboxRecordId,
    settingsOpen,
    commandPaletteOpen,
    scrollToImagineTop,
  ])

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

  // Upload or locally convert reference image files
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
            original_preview: objectPreview,
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

          const finalPreview = res.preview_url || objectPreview
          setReferenceImages((prev) =>
            prev.map((item) =>
              item.id === entryId
                ? {
                    ...item,
                    mode: res.mode,
                    value: res.value,
                    preview: finalPreview,
                    original_preview: finalPreview,
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
                    original_preview: payload.preview_url || objectPreview,
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

  // Apply an annotated/cropped Reference Image from RefImageAnnotatorModal
  const handleApplyAnnotatedFile = useCallback(
    async (entry: ReferenceImageEntry, file: File) => {
      const opts = refOptsRef.current
      const editedPreview = URL.createObjectURL(file)
      const preservedOriginal = entry.original_preview || entry.preview

      setReferenceImages((prev) =>
        prev.map((item) =>
          item.id === entry.id
            ? {
                ...item,
                preview: editedPreview,
                original_preview: preservedOriginal,
                annotated: true,
                uploading: true,
                error: undefined,
                label:
                  opts.refMode === "upload"
                    ? "正在上传标注图..."
                    : "正在编码标注图...",
              }
            : item
        )
      )

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
            item.id === entry.id
              ? {
                  ...item,
                  mode: res.mode,
                  value: res.value,
                  preview: res.preview_url || editedPreview,
                  original_preview: preservedOriginal,
                  annotated: true,
                  local_ref: res.local_ref,
                  remote_url: res.url,
                  provider: res.provider,
                  width: res.width,
                  height: res.height,
                  size_bytes: res.size_bytes,
                  orig_bytes: res.orig_bytes,
                  label: "已标注就绪",
                  uploading: false,
                  error: undefined,
                }
              : item
          )
        )
        showToast("已更新裁剪/标注后的参考图", "success")
      } catch (err: any) {
        setReferenceImages((prev) =>
          prev.map((item) =>
            item.id === entry.id
              ? {
                  ...item,
                  uploading: false,
                  error: err.message,
                  label: "标注同步失败",
                }
              : item
          )
        )
        showToast("标注参考图上传失败: " + err.message, "error")
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
        setActiveTab("imagine")
        if (layoutMode === "omnibar" && isScrolledPastComposer) {
          setQuickComposerOpen(true)
        }
        handleFilesSelected(imageFiles)
        showToast(`已从剪贴板粘贴 ${imageFiles.length} 张参考图`, "info")
      }
    }
    window.addEventListener("paste", onPaste)
    return () => window.removeEventListener("paste", onPaste)
  }, [handleFilesSelected, showToast, layoutMode, isScrolledPastComposer])

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
          files.push(
            new File([blob], `clipboard_${Date.now()}.${ext}`, {
              type: imgType,
            })
          )
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
        original_preview: trimmed,
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
    setActiveTab("imagine")
    setSplitMobilePane("studio")
    scrollToImagineTop()

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
          original_preview: preview,
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
        const finalPreview = res.preview_url || preview
        setReferenceImages((prev) =>
          prev.map((cur) =>
            cur.id === entryId
              ? {
                  ...cur,
                  mode: res.mode,
                  value: res.value,
                  preview: finalPreview,
                  original_preview: finalPreview,
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
        showToast("已将该作品载入参考图栏，可继续迭代微调", "success")
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

  // Save Config (persists API key, host settings, templates, and projects)
  const handleSaveConfig = async (
    partial: Partial<AppConfig>,
    silent = false
  ) => {
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
      projects: config?.projects || [],
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
    if (!silent) {
      showToast("设置已持久化保存至 duomi_data/config.json", "success")
    }
  }

  // Project Albums CRUD & Record Organization
  const projects = useMemo<ProjectFolder[]>(
    () => config?.projects || [],
    [config?.projects]
  )

  const handleCreateProject = async (name: string, color: string) => {
    const trimmed = name.trim()
    if (!trimmed) return
    const nextProj: ProjectFolder = {
      id: `proj_${Date.now().toString(36)}`,
      name: trimmed,
      color: color || "amber",
      created_at: Math.floor(Date.now() / 1000),
    }
    await handleSaveConfig({ projects: [...projects, nextProj] }, true)
    showToast(`已新建项目画册「${trimmed}」`, "success")
  }

  const handleDeleteProject = async (projId: string) => {
    await handleSaveConfig(
      { projects: projects.filter((p) => p.id !== projId) },
      true
    )
    if (activeProjectId === projId) setActiveProjectId("")
    // Clear project_id on records belonging to deleted album
    const affectedIds = records
      .filter((r) => r.project_id === projId)
      .map((r) => r.id)
    if (affectedIds.length > 0) {
      await organizeRecordsOnServer({ ids: affectedIds, project_id: "" }).catch(
        () => {}
      )
    }
    showToast("已删除该画册分组（作品文件本身完好保留）", "info")
  }

  const handleAssignProject = async (ids: string[], projectId: string) => {
    if (ids.length === 0) return
    try {
      const res = await organizeRecordsOnServer({
        ids,
        project_id: projectId,
      })
      const map = new Map(res.records.map((r) => [r.id, r]))
      setRecords((prev) => prev.map((r) => map.get(r.id) || r))
      const targetName =
        projects.find((p) => p.id === projectId)?.name || "未归档"
      showToast(`已将 ${res.updated_count} 项作品移入「${targetName}」`, "success")
    } catch (err: any) {
      showToast(err.message, "error")
    }
  }

  const handleBatchStar = async (ids: string[], starred: boolean) => {
    if (ids.length === 0) return
    try {
      const res = await organizeRecordsOnServer({ ids, starred })
      const map = new Map(res.records.map((r) => [r.id, r]))
      setRecords((prev) => prev.map((r) => map.get(r.id) || r))
      showToast(
        starred
          ? `已批量星标 ${res.updated_count} 项作品`
          : `已取消星标 ${res.updated_count} 项作品`,
        "success"
      )
    } catch (err: any) {
      showToast(err.message, "error")
    }
  }

  const handleOrganizeSingle = async (
    recId: string,
    patch: { project_id?: string; note?: string }
  ) => {
    const res = await organizeRecordsOnServer({ ids: [recId], ...patch })
    const map = new Map(res.records.map((r) => [r.id, r]))
    setRecords((prev) => prev.map((r) => map.get(r.id) || r))
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

    const finalModel =
      customModel.trim() || selectedModel || "gpt-image-2.6-flare"
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
          project_id: activeProjectId,
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

      setPromptHistory(
        pushPromptHistory({
          prompt: trimmedPrompt,
          model: finalModel,
          size: selectedSize,
        })
      )

      const count = res.submitted_count || 1
      showToast(
        count > 1
          ? `已并发提交 ${count} 张异步冲印任务，正在实时显影`
          : `生图任务已提交 (ID: ${(res.id || "").slice(0, 8)}...)`,
        "success"
      )
      if (res.warning_msg) {
        showToast(res.warning_msg, "info")
      }
      if (res.partial_error) {
        showToast(`部分任务提示: ${res.partial_error}`, "error")
      }
      setActiveTab("imagine")
      setSplitMobilePane("gallery")
      scrollToImagineTop()
      if (!sseConnected) {
        await refreshRecords()
      }
    } catch (err: any) {
      showToast(err.message, "error")
    } finally {
      setIsSubmitting(false)
    }
  }

  // Reuse Record (1-click Remix including Reference Images!)
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
    if (rec.project_id) {
      setActiveProjectId(rec.project_id)
    }
    setActiveTab("imagine")
    setSplitMobilePane("studio")
    scrollToImagineTop()

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
            const previewUrl = conv.preview_url || `/images/${ri.local_ref}`
            restored.push({
              id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
              mode: conv.mode,
              value: conv.value,
              preview: previewUrl,
              original_preview: previewUrl,
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
            // fallback to remote_url
          }
        }
        if (ri.remote_url) {
          restored.push({
            id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
            mode: "url",
            value: ri.remote_url,
            preview: ri.remote_url,
            original_preview: ri.remote_url,
            remote_url: ri.remote_url,
            label: "直链 URL",
          })
        }
      }
      setReferenceImages(restored)
      showToast(
        restored.length > 0
          ? `已完整载入同款参数并恢复 ${restored.length} 张参考图`
          : "已将该作品参数装填至创作舱",
        "success"
      )
    } else {
      showToast("已将该作品参数装填至创作舱", "success")
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
          project_id: rec.project_id || "",
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
      const updated = await apiFetch<TaskRecord>("/api/records/star", {
        method: "POST",
        body: JSON.stringify({ id: rec.id, starred: !rec.starred }),
      })
      setRecords((prev) => prev.map((r) => (r.id === updated.id ? updated : r)))
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
      const res = await apiFetch<{ deleted: string; disk_stats?: DiskUsageStats }>(
        `/api/records?id=${encodeURIComponent(rec.id)}&delete_files=true`,
        { method: "DELETE" }
      )
      setRecords((prev) => prev.filter((r) => r.id !== rec.id))
      if (res.disk_stats) setDiskStats(res.disk_stats)
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
      const res = await apiFetch<{
        deleted_count: number
        disk_stats?: DiskUsageStats
      }>("/api/records/batch-delete", {
        method: "POST",
        body: JSON.stringify({ ids, delete_files: true }),
      })
      const delSet = new Set(ids)
      setRecords((prev) => prev.filter((r) => !delSet.has(r.id)))
      if (res.disk_stats) setDiskStats(res.disk_stats)
      showToast(`已批量删除 ${res.deleted_count} 条记录`, "info")
    } catch (err: any) {
      showToast(err.message, "error")
    }
  }

  const handleClearFailed = async () => {
    try {
      const res = await apiFetch<{
        deleted_count: number
        disk_stats?: DiskUsageStats
      }>("/api/records/batch-delete", {
        method: "POST",
        body: JSON.stringify({ clear_failed: true, delete_files: true }),
      })
      if (res.disk_stats) setDiskStats(res.disk_stats)
      await refreshRecords()
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

  // Recipe / Template handlers
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
      setQuality(tpl.quality || "default")
      setBackground(tpl.background || "auto")
    }
    setActiveTab("imagine")
    setSplitMobilePane("studio")
    scrollToImagineTop()
    showToast(`已装填灵感配方「${tpl.title}」`, "success")
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

  // Lightbox & Annotator memos
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

  const annotatingRefInfo = useMemo(() => {
    if (!annotatingEntryId) return { entry: null, index: 0 }
    const idx = referenceImages.findIndex((r) => r.id === annotatingEntryId)
    return {
      entry: idx >= 0 ? referenceImages[idx] : null,
      index: Math.max(0, idx),
    }
  }, [annotatingEntryId, referenceImages])

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
  const allRecipes = useMemo(
    () => [...(config?.prompt_templates || []), ...builtInTemplates],
    [config?.prompt_templates, builtInTemplates]
  )

  const renderOmnibarComposer = (onCollapseOverlay?: () => void) => (
    <OmnibarComposer
      models={models}
      selectedModel={selectedModel}
      onSelectModel={setSelectedModel}
      customModel={customModel}
      onChangeCustomModel={setCustomModel}
      prompt={prompt}
      onChangePrompt={setPrompt}
      promptHistory={promptHistory}
      onOpenZenWorkbench={() => setZenWorkbenchOpen(true)}
      onOpenRecipes={() => setActiveTab("recipes")}
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
      onAnnotateRef={(entry) => setAnnotatingEntryId(entry.id)}
      onPasteFromClipboardButton={handlePasteFromClipboardButton}
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
      projects={projects}
      activeProjectId={activeProjectId}
      onChangeActiveProjectId={setActiveProjectId}
      batchCount={batchCount}
      onChangeBatchCount={setBatchCount}
      isSubmitting={isSubmitting}
      onSubmitGenerate={handleSubmitGenerate}
      onOpenDevPreview={() => setDevPreviewOpen(true)}
      onCollapseOverlay={onCollapseOverlay}
    />
  )

  return (
    <TooltipProvider delayDuration={160}>
      <div className="flex h-screen w-screen overflow-hidden bg-background text-foreground">
        {/* Left Vertical Studio Navigation Rail (Desktop) + Bottom Tab Bar (Mobile) */}
        <StudioRail
          activeTab={activeTab}
          onSelectTab={setActiveTab}
          layoutMode={layoutMode}
          onToggleLayoutMode={toggleLayoutMode}
          activeQueueCount={activeCount}
          totalGalleryCount={records.length}
          hasApiKey={hasApiKey}
          sseConnected={sseConnected}
          theme={theme}
          onToggleTheme={() =>
            setTheme((prev) => (prev === "dark" ? "light" : "dark"))
          }
          onOpenCommandPalette={() => setCommandPaletteOpen(true)}
          onOpenLocalFolder={() => handleOpenLocalFolder()}
          onOpenSettings={(tab = "api") => {
            setSettingsTab(tab)
            setSettingsOpen(true)
          }}
        />

        {/* Right Full-Viewport Studio Canvas */}
        <div className="flex flex-1 flex-col min-w-0 h-full overflow-hidden">
          {/* Sleek Studio Top Status Bar */}
          <header className="flex h-11 shrink-0 items-center justify-between border-b border-border/75 bg-background/85 px-4 backdrop-blur-md z-20">
            <div className="flex items-center gap-2.5 min-w-0">
              <span className="text-xs font-semibold tracking-tight truncate">
                {activeTab === "imagine" && "多米图像创作中心 · Imagine"}
                {activeTab === "gallery" && "作品资产与项目画册 · Assets"}
                {activeTab === "recipes" && "灵感配方广场 · Recipes"}
                {activeTab === "analytics" && "异步队列与存储管家 · Telemetry"}
              </span>

              <Badge
                variant="outline"
                className="hidden sm:inline-flex font-mono text-[10px] px-1.5 py-0 text-muted-foreground"
              >
                {info?.version || "v3.1.0"} 单文件便携版
              </Badge>

              {activeCount > 0 && (
                <Badge
                  variant="warning"
                  className="text-[10px] px-1.5 py-0 tabular-nums"
                >
                  显影中 {activeCount}
                </Badge>
              )}
            </div>

            <div className="flex items-center gap-1.5">
              {/* Quick Ctrl+K Search Pill */}
              <button
                type="button"
                onClick={() => setCommandPaletteOpen(true)}
                className="hidden md:inline-flex items-center gap-2 rounded-lg border border-border bg-secondary/45 px-2.5 py-1 text-[11px] text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors cursor-pointer"
              >
                <Command className="h-3 w-3 text-amber-500" />
                <span>快捷指令...</span>
                <span className="studio-kbd">⌘K</span>
              </button>

              {/* Layout Switcher when in Imagine tab */}
              {activeTab === "imagine" && (
                <button
                  type="button"
                  onClick={toggleLayoutMode}
                  className="hidden lg:inline-flex items-center gap-1.5 rounded-lg border border-border bg-secondary/45 px-2.5 py-1 text-[11px] text-muted-foreground hover:text-foreground transition-colors cursor-pointer"
                  title="切换顶部灵感舱或双栏专业参数台"
                >
                  {layoutMode === "omnibar" ? (
                    <>
                      <LayoutPanelLeft className="h-3 w-3 text-amber-500" />
                      <span>切换双栏</span>
                    </>
                  ) : (
                    <>
                      <PanelTop className="h-3 w-3 text-amber-500" />
                      <span>切换灵感舱</span>
                    </>
                  )}
                </button>
              )}

              {/* Portable Data Dir Pill */}
              <button
                type="button"
                onClick={() => handleOpenLocalFolder()}
                className="hidden xl:inline-flex items-center gap-1.5 rounded-lg border border-border bg-secondary/45 px-2.5 py-1 text-[11px] text-muted-foreground hover:text-foreground transition-colors cursor-pointer"
                title="点击打开本地绿色便携目录 duomi_data"
              >
                <FolderOpen className="h-3 w-3 text-amber-500" />
                <span className="font-mono">
                  {diskStats
                    ? `${diskStats.generated_count}张 · ${formatBytes(
                        diskStats.total_bytes
                      )}`
                    : "duomi_data"}
                </span>
              </button>

              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-7 px-2 text-[11px]"
                onClick={() => setImportTaskOpen(true)}
              >
                <Search className="h-3 w-3" />
                <span className="hidden sm:inline">查任务ID</span>
              </Button>

              <button
                id="btn-open-config-modal"
                type="button"
                onClick={() => {
                  setSettingsTab("api")
                  setSettingsOpen(true)
                }}
                className={cn(
                  "inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1 text-[11px] font-medium transition-colors cursor-pointer",
                  hasApiKey
                    ? "border-border bg-secondary/45 text-foreground hover:bg-secondary"
                    : "border-amber-500/60 bg-amber-500/10 text-amber-500"
                )}
              >
                <span
                  className={cn(
                    "h-1.5 w-1.5 rounded-full",
                    hasApiKey ? "bg-emerald-500" : "bg-amber-500 animate-pulse"
                  )}
                />
                <KeyRound className="h-3 w-3" />
                <span className="font-mono">
                  {hasApiKey ? maskKey(config?.api_key) : "配置密钥"}
                </span>
              </button>
            </div>
          </header>

          {/* Active Workspace Body */}
          <main
            ref={workspaceBodyRef}
            className="relative flex-1 min-h-0 overflow-hidden"
          >
            {/* TAB 1: IMAGINE WORKSPACE (Unified Scroll Omnibar OR Pro Split Mode) */}
            {activeTab === "imagine" &&
              (layoutMode === "omnibar" ? (
                <>
                  <div
                    ref={imagineScrollRef}
                    onScroll={(e) => {
                      const past = e.currentTarget.scrollTop > 165
                      setIsScrolledPastComposer((prev) =>
                        prev === past ? prev : past
                      )
                      if (!past && quickComposerOpen) {
                        setQuickComposerOpen(false)
                      }
                    }}
                    className="h-full overflow-y-auto studio-scroll"
                  >
                    {/* Normal-Flow Top Hero Creation Band — scrolls away cleanly, zero overlap */}
                    <div className="border-b border-border/55 bg-secondary/20 dark:bg-zinc-950/35 px-3 sm:px-6 pt-4 pb-4">
                      {renderOmnibarComposer()}
                    </div>

                    {/* Unified Full-Width Sticky Filter Bar + Native Aspect-Ratio Masonry Stream */}
                    <MasonryArtworkStream
                      mode="imagine"
                      embeddedScroll={false}
                      showQuickCreateTrigger={isScrolledPastComposer}
                      hasDraftOrRefs={Boolean(
                        prompt.trim() || referenceImages.length > 0
                      )}
                      onOpenQuickComposer={() => setQuickComposerOpen(true)}
                      onScrollToTop={scrollToImagineTop}
                      records={records}
                      projects={projects}
                      onCreateProject={handleCreateProject}
                      onDeleteProject={handleDeleteProject}
                      onAssignProject={handleAssignProject}
                      onBatchStar={handleBatchStar}
                      refreshingIds={refreshingIds}
                      onRefreshAll={async () => {
                        await refreshRecords()
                        showToast("已同步最新记录列表", "info")
                      }}
                      onRefreshSingle={handleRefreshSingle}
                      onCancelPolling={handleCancelPolling}
                      onToggleStar={handleToggleStar}
                      onOpenLightbox={(rec, idx, openCompare = false) => {
                        setLightboxInitialCompare(openCompare)
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
                      onOpenImportTask={() => setImportTaskOpen(true)}
                      onCopyText={copyText}
                    />
                  </div>

                  {/* On-Demand Contextual Quick Composer Overlay (Ctrl+J or '✨ 唤起创作舱') */}
                  {(quickComposerOpen || quickOverlayRendered) && (
                    <div
                      ref={quickBackdropRef}
                      onClick={(e) => {
                        if (e.target === e.currentTarget) {
                          setQuickComposerOpen(false)
                        }
                      }}
                      className={cn(
                        "absolute inset-0 z-30 flex items-start justify-center bg-black/45 backdrop-blur-[2px] px-3 sm:px-6 pt-4 pb-6 overflow-y-auto",
                        !quickComposerOpen && "pointer-events-none"
                      )}
                    >
                      <div
                        ref={quickCardRef}
                        onClick={(e) => e.stopPropagation()}
                        className="w-full max-w-4xl"
                      >
                        {renderOmnibarComposer(() =>
                          setQuickComposerOpen(false)
                        )}
                      </div>
                    </div>
                  )}
                </>
              ) : (
                /* Pro Split 2-Column Mode */
                <div className="flex flex-col lg:grid lg:grid-cols-[440px_1fr] xl:grid-cols-[465px_1fr] h-full overflow-hidden">
                  <div className="flex lg:hidden border-b border-border bg-card/60 p-1.5 gap-1.5 shrink-0">
                    <button
                      type="button"
                      onClick={() => setSplitMobilePane("studio")}
                      className={cn(
                        "flex-1 rounded-lg py-1.5 text-xs font-semibold cursor-pointer",
                        splitMobilePane === "studio"
                          ? "bg-amber-500 text-zinc-950"
                          : "text-muted-foreground"
                      )}
                    >
                      参数工作台
                    </button>
                    <button
                      type="button"
                      onClick={() => setSplitMobilePane("gallery")}
                      className={cn(
                        "flex-1 rounded-lg py-1.5 text-xs font-semibold cursor-pointer",
                        splitMobilePane === "gallery"
                          ? "bg-amber-500 text-zinc-950"
                          : "text-muted-foreground"
                      )}
                    >
                      瀑布流画廊 ({records.length})
                    </button>
                  </div>

                  <div
                    className={cn(
                      "h-full overflow-hidden",
                      splitMobilePane !== "studio" && "hidden lg:block"
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
                      onOpenZenWorkbench={() => setZenWorkbenchOpen(true)}
                      onOpenTemplates={() => setActiveTab("recipes")}
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
                        setReferenceImages((prev) =>
                          prev.filter((r) => r.id !== id)
                        )
                      }
                      onMoveRef={handleMoveRef}
                      onRetryRef={handleRetrySingleRef}
                      onAnnotateRef={(entry) => setAnnotatingEntryId(entry.id)}
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

                  <div
                    className={cn(
                      "h-full overflow-hidden",
                      splitMobilePane !== "gallery" && "hidden lg:block"
                    )}
                  >
                    <MasonryArtworkStream
                      mode="imagine"
                      records={records}
                      projects={projects}
                      onCreateProject={handleCreateProject}
                      onDeleteProject={handleDeleteProject}
                      onAssignProject={handleAssignProject}
                      onBatchStar={handleBatchStar}
                      refreshingIds={refreshingIds}
                      onRefreshAll={refreshRecords}
                      onRefreshSingle={handleRefreshSingle}
                      onCancelPolling={handleCancelPolling}
                      onToggleStar={handleToggleStar}
                      onOpenLightbox={(rec, idx, openCompare = false) => {
                        setLightboxInitialCompare(openCompare)
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
                      onOpenImportTask={() => setImportTaskOpen(true)}
                      onCopyText={copyText}
                    />
                  </div>
                </div>
              ))}

            {/* TAB 2: DEDICATED ASSETS & PROJECT ALBUMS */}
            {activeTab === "gallery" && (
              <div className="h-full overflow-hidden">
                <MasonryArtworkStream
                  mode="gallery"
                  records={records}
                  projects={projects}
                  onCreateProject={handleCreateProject}
                  onDeleteProject={handleDeleteProject}
                  onAssignProject={handleAssignProject}
                  onBatchStar={handleBatchStar}
                  refreshingIds={refreshingIds}
                  onRefreshAll={async () => {
                    await refreshRecords()
                    showToast("已刷新全部作品资产", "info")
                  }}
                  onRefreshSingle={handleRefreshSingle}
                  onCancelPolling={handleCancelPolling}
                  onToggleStar={handleToggleStar}
                  onOpenLightbox={(rec, idx, openCompare = false) => {
                    setLightboxInitialCompare(openCompare)
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
                  onOpenImportTask={() => setImportTaskOpen(true)}
                  onCopyText={copyText}
                />
              </div>
            )}

            {/* TAB 3: INSPIRATION & CURATED RECIPES HUB */}
            {activeTab === "recipes" && (
              <InspirationHubView
                builtInTemplates={builtInTemplates}
                customTemplates={config?.prompt_templates || []}
                currentPrompt={prompt}
                currentModel={customModel.trim() || selectedModel}
                currentSize={selectedSize}
                currentQuality={quality}
                currentBackground={background}
                onUseRecipe={handleApplyTemplate}
                onSaveCustomTemplate={handleSaveCustomTemplate}
                onDeleteCustomTemplate={handleDeleteCustomTemplate}
                onCopyText={copyText}
              />
            )}

            {/* TAB 4: TELEMETRY, QUEUE & PORTABLE STORAGE STEWARD */}
            {activeTab === "analytics" && (
              <AnalyticsQueueView
                records={records}
                diskStats={diskStats}
                dataDir={info?.data_dir || "./duomi_data"}
                sseConnected={sseConnected}
                refreshingIds={refreshingIds}
                onUpdateDiskStats={setDiskStats}
                onRefreshSingle={handleRefreshSingle}
                onCancelPolling={handleCancelPolling}
                onClearFailed={handleClearFailed}
                onOpenLocalFolder={() => handleOpenLocalFolder()}
                onCopyText={copyText}
                onToast={showToast}
              />
            )}
          </main>
        </div>

        {/* Modals & Cinema Darkroom Lightbox */}
        <SettingsDialog
          open={settingsOpen}
          onOpenChange={setSettingsOpen}
          initialTab={settingsTab}
          config={config}
          imageHosts={imageHosts}
          diskStats={diskStats}
          onSaveConfig={(p) => handleSaveConfig(p, false)}
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

        <PromptWorkbenchModal
          open={zenWorkbenchOpen}
          onOpenChange={setZenWorkbenchOpen}
          prompt={prompt}
          onChangePrompt={setPrompt}
          referenceImages={referenceImages}
          promptHistory={promptHistory}
          currentModel={customModel.trim() || selectedModel}
          currentSize={selectedSize}
          currentQuality={quality}
          currentBackground={background}
          onSaveCustomTemplate={handleSaveCustomTemplate}
          onCopyText={copyText}
          onSubmitGenerate={handleSubmitGenerate}
        />

        <RefImageAnnotatorModal
          entry={annotatingRefInfo.entry}
          refIndex={annotatingRefInfo.index}
          onClose={() => setAnnotatingEntryId(null)}
          onApplyAnnotatedFile={handleApplyAnnotatedFile}
        />

        <CommandPaletteModal
          open={commandPaletteOpen}
          onOpenChange={setCommandPaletteOpen}
          onSelectTab={setActiveTab}
          layoutMode={layoutMode}
          onToggleLayoutMode={toggleLayoutMode}
          theme={theme}
          onToggleTheme={() =>
            setTheme((prev) => (prev === "dark" ? "light" : "dark"))
          }
          models={models}
          onSelectModel={setSelectedModel}
          recipes={allRecipes}
          onUseRecipe={(tpl) => handleApplyTemplate(tpl, true)}
          onOpenZenWorkbench={() => setZenWorkbenchOpen(true)}
          onOpenSettings={(tab = "api") => {
            setSettingsTab(tab)
            setSettingsOpen(true)
          }}
          onOpenImportTask={() => setImportTaskOpen(true)}
          onOpenDevPreview={() => setDevPreviewOpen(true)}
          onOpenLocalFolder={() => handleOpenLocalFolder()}
        />

        <ImageLightbox
          record={lightboxRecord}
          initialCompare={lightboxInitialCompare}
          galleryRecords={succeededRecords}
          projects={projects}
          imageIndex={lightboxImgIdx}
          onChangeImageIndex={setLightboxImgIdx}
          onSelectRecord={(rec) => {
            setLightboxRecordId(rec.id)
            setLightboxImgIdx(0)
          }}
          onClose={() => {
            setLightboxRecordId(null)
            setLightboxInitialCompare(false)
          }}
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
          onOrganizeRecord={handleOrganizeSingle}
          onUseGeneratedAsRef={handleUseGeneratedAsRef}
          onReuseRecord={handleReuseRecord}
          onOpenLocalFolder={handleOpenLocalFolder}
          onCopyText={copyText}
          onToast={showToast}
        />

        {/* Theme-Aware Floating Toasts */}
        <div
          id="toast-container"
          className="fixed bottom-16 md:bottom-5 right-4 z-50 flex flex-col gap-2 max-w-sm pointer-events-none"
        >
          {toasts.map((t) => (
            <div
              key={t.id}
              ref={(el) => {
                if (el) {
                  toastRefs.current.set(t.id, el)
                } else {
                  toastRefs.current.delete(t.id)
                }
              }}
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
