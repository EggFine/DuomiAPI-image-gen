import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react"
import {
  type InfiniteData,
  keepPreviousData,
  useInfiniteQuery,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query"
import { AlertCircle, CheckCircle2, Info } from "lucide-react"
import { AnalyticsQueueView } from "@/components/AnalyticsQueueView"
import { BottomComposerDock } from "@/components/BottomComposerDock"
import { CommandPaletteModal } from "@/components/CommandPaletteModal"
import { ImageLightbox } from "@/components/ImageLightbox"
import { InspirationHubView } from "@/components/InspirationHubView"
import { LogsDialog } from "@/components/LogsDialog"
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
import { TooltipProvider } from "@/components/ui/tooltip"
import { subscribeClientErrorCount } from "@/lib/logger"
import { gsap, prefersReducedMotion, STUDIO_EASE, useGSAP } from "@/lib/motion"
import {
  apiFetch,
  buildDeveloperPreview,
  convertCachedRefOnServer,
  fetchLogs,
  fetchRecordsPage,
  getThumbUrl,
  loadPromptHistory,
  mergeTaskRecord,
  organizeRecordsOnServer,
  pushPromptHistory,
  uploadLocalRefFile,
} from "@/lib/studio-utils"
import { cn } from "@/lib/utils"
import type {
  AppConfig,
  ComposerLayoutMode,
  DiskUsageStats,
  ImageHostProvider,
  ProjectFolder,
  PromptHistoryItem,
  PromptTemplate,
  RatioPresetGroup,
  RecordCounts,
  RecordsPageResponse,
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

const RECORDS_PAGE_SIZE = 80

function sortRecordsDesc(list: TaskRecord[]): TaskRecord[] {
  return [...list].sort((a, b) => {
    const dt = (b.create_time || 0) - (a.create_time || 0)
    if (dt !== 0) return dt
    return b.id > a.id ? 1 : b.id < a.id ? -1 : 0
  })
}

export function App() {
  const queryClient = useQueryClient()
  const appRootRef = useRef<HTMLDivElement | null>(null)
  const { contextSafe } = useGSAP({ scope: appRootRef })

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

  // Floating Toast calm Apple fluid settle via scoped useGSAP + autoAlpha
  useGSAP(
    () => {
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
              { autoAlpha: 0, y: 10, scale: 0.97 },
              {
                autoAlpha: 1,
                y: 0,
                scale: 1,
                duration: 0.34,
                ease: STUDIO_EASE.expo,
                clearProps: "transform,visibility",
              }
            )
          }
        }
      }
    },
    { scope: appRootRef, dependencies: [toasts] }
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

  // Unread frontend error badge count for portable logs trigger
  const [unreadLogErrors, setUnreadLogErrors] = useState<number>(0)
  useEffect(() => subscribeClientErrorCount(setUnreadLogErrors), [])

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

  // Calm workspace view cross-settle on tab or layout switch
  useGSAP(
    () => {
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
        { opacity: 0, y: 6 },
        {
          opacity: 1,
          y: 0,
          duration: 0.3,
          ease: STUDIO_EASE.out,
          clearProps: "transform,opacity",
          overwrite: "auto",
        }
      )
    },
    { scope: appRootRef, dependencies: [activeTab, layoutMode] }
  )

  // Server-backed Gallery Filter State (driven by TanStack Query infinite pagination)
  const [statusFilter, setStatusFilter] = useState<string>("all")
  const [projectFilter, setProjectFilter] = useState<string>("all")
  const [modelFilter, setModelFilter] = useState<string>("all")
  const [searchQuery, setSearchQuery] = useState<string>("")
  const [debouncedSearch, setDebouncedSearch] = useState<string>("")

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setDebouncedSearch(searchQuery.trim())
    }, 220)
    return () => window.clearTimeout(timer)
  }, [searchQuery])

  // TanStack Query: Server info & configuration
  const infoQuery = useQuery<ServerInfoResponse>({
    queryKey: ["studio-info"],
    queryFn: ({ signal }) => apiFetch<ServerInfoResponse>("/api/info", { signal }),
    staleTime: 60_000,
  })

  const configQuery = useQuery<AppConfig>({
    queryKey: ["studio-config"],
    queryFn: ({ signal }) => apiFetch<AppConfig>("/api/config", { signal }),
    staleTime: 60_000,
  })

  // TanStack Query: Paginated lightweight records list
  const recordsQueryKey = useMemo(
    () => [
      "studio-records",
      statusFilter,
      projectFilter,
      modelFilter,
      debouncedSearch,
    ],
    [statusFilter, projectFilter, modelFilter, debouncedSearch]
  )

  const recordsQuery = useInfiniteQuery<RecordsPageResponse>({
    queryKey: recordsQueryKey,
    initialPageParam: 0,
    queryFn: ({ pageParam, signal }) =>
      fetchRecordsPage(
        {
          limit: RECORDS_PAGE_SIZE,
          offset: typeof pageParam === "number" ? pageParam : 0,
          status: statusFilter,
          projectId: projectFilter,
          model: modelFilter,
          q: debouncedSearch,
          includeStats: pageParam === 0,
        },
        signal
      ),
    getNextPageParam: (lastPage) =>
      lastPage.has_more ? lastPage.next_offset : undefined,
    placeholderData: keepPreviousData,
    staleTime: 10_000,
  })

  const info = infoQuery.data ?? null
  const config = configQuery.data ?? null
  const [diskStatsOverride, setDiskStatsOverride] =
    useState<DiskUsageStats | null>(null)

  const firstRecordsPage = recordsQuery.data?.pages?.[0]
  const diskStats =
    diskStatsOverride || firstRecordsPage?.disk_stats || info?.disk_stats || null

  const models = useMemo(() => info?.models || [], [info?.models])
  const imageHosts = useMemo(() => info?.image_hosts || [], [info?.image_hosts])
  const ratioPresets = useMemo(
    () => info?.ratio_presets || [],
    [info?.ratio_presets]
  )
  const builtInTemplates = useMemo(
    () => info?.builtin_templates || [],
    [info?.builtin_templates]
  )

  const records = useMemo<TaskRecord[]>(() => {
    const pages = recordsQuery.data?.pages
    if (!pages || pages.length === 0) return []
    const seen = new Map<string, TaskRecord>()
    for (const page of pages) {
      for (const r of page.records || []) {
        const prev = seen.get(r.id)
        seen.set(r.id, prev ? mergeTaskRecord(prev, r) : r)
      }
    }
    return sortRecordsDesc(Array.from(seen.values()))
  }, [recordsQuery.data?.pages])

  const serverCounts: RecordCounts | undefined = firstRecordsPage?.counts
  const serverModels: string[] | undefined = firstRecordsPage?.distinct_models
  const totalMatched: number | undefined = firstRecordsPage?.total

  // Creation Studio state
  const [selectedModel, setSelectedModel] =
    useState<string>("gpt-image-2.6-flare")
  const [customModel, setCustomModel] = useState<string>("")
  const [prompt, setPrompt] = useState<string>("")
  const [promptRevision, setPromptRevision] = useState<number>(0)
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

  // Reference Image Strategy ("upload" default | "compress_base64" | "raw_base64")
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

  // Race-isolation refs & object URL tracker
  const submittingRef = useRef<boolean>(false)
  const reuseSeqRef = useRef<number>(0)
  const reuseAbortRef = useRef<AbortController | null>(null)
  const reconvertSeqRef = useRef<number>(0)
  const reconvertAbortRef = useRef<AbortController | null>(null)
  const sliderReconvertTimerRef = useRef<number | null>(null)
  const createdBlobUrlsRef = useRef<Set<string>>(new Set())
  const initHydratedRef = useRef<boolean>(false)
  const invalidateTimerRef = useRef<number | null>(null)

  const registerBlobUrl = useCallback((url: string) => {
    if (url.startsWith("blob:")) {
      createdBlobUrlsRef.current.add(url)
    }
  }, [])

  const revokeBlobUrl = useCallback((url?: string) => {
    if (url && url.startsWith("blob:") && createdBlobUrlsRef.current.has(url)) {
      URL.revokeObjectURL(url)
      createdBlobUrlsRef.current.delete(url)
    }
  }, [])

  useEffect(() => {
    const tracked = createdBlobUrlsRef.current
    return () => {
      reuseAbortRef.current?.abort()
      reconvertAbortRef.current?.abort()
      if (sliderReconvertTimerRef.current) {
        window.clearTimeout(sliderReconvertTimerRef.current)
      }
      if (invalidateTimerRef.current) {
        window.clearTimeout(invalidateTimerRef.current)
      }
      for (const u of tracked) {
        URL.revokeObjectURL(u)
      }
      tracked.clear()
    }
  }, [])

  const setPromptProgrammatic = useCallback((next: string) => {
    setPrompt(next)
    setPromptRevision((r) => r + 1)
  }, [])

  // Modals & Lightbox states
  const [settingsOpen, setSettingsOpen] = useState<boolean>(false)
  const [settingsTab, setSettingsTab] = useState<string>("api")
  const [templatesOpen, setTemplatesOpen] = useState<boolean>(false)
  const [devPreviewOpen, setDevPreviewOpen] = useState<boolean>(false)
  const [importTaskOpen, setImportTaskOpen] = useState<boolean>(false)
  const [zenWorkbenchOpen, setZenWorkbenchOpen] = useState<boolean>(false)
  const [commandPaletteOpen, setCommandPaletteOpen] = useState<boolean>(false)
  const [logsOpen, setLogsOpen] = useState<boolean>(false)
  const [annotatingEntryId, setAnnotatingEntryId] = useState<string | null>(null)

  const [lightboxRecordId, setLightboxRecordId] = useState<string | null>(null)
  const [lightboxImgIdx, setLightboxImgIdx] = useState<number>(0)
  const [lightboxInitialCompare, setLightboxInitialCompare] =
    useState<boolean>(false)

  // Unified Imagine Scroll & Bottom Compact Composer Dock State
  const imagineScrollRef = useRef<HTMLDivElement | null>(null)
  const [isScrolledPastComposer, setIsScrolledPastComposer] =
    useState<boolean>(false)
  const [bottomDockExpanded, setBottomDockExpanded] = useState<boolean>(false)
  const [isBatchSelecting, setIsBatchSelecting] = useState<boolean>(false)

  // Live composer snapshot ref so callbacks stay stable and never capture stale closures
  const composerRef = useRef({
    prompt,
    selectedModel,
    customModel,
    selectedSize,
    quality,
    background,
    batchCount,
    oversea,
    autoCompatFallback,
    activeProjectId,
    refMode,
    imageHostProvider,
    litterboxExpiry,
    compressMaxDim,
    compressQuality,
    referenceImages,
    config,
    models,
    ratioPresets,
    activeTab,
    layoutMode,
    isScrolledPastComposer,
    lightboxRecordId,
    sseConnected,
  })
  useEffect(() => {
    composerRef.current = {
      prompt,
      selectedModel,
      customModel,
      selectedSize,
      quality,
      background,
      batchCount,
      oversea,
      autoCompatFallback,
      activeProjectId,
      refMode,
      imageHostProvider,
      litterboxExpiry,
      compressMaxDim,
      compressQuality,
      referenceImages,
      config,
      models,
      ratioPresets,
      activeTab,
      layoutMode,
      isScrolledPastComposer,
      lightboxRecordId,
      sseConnected,
    }
  })

  const animateScrollToTop = contextSafe((el: HTMLDivElement | null) => {
    if (!el) return
    if (prefersReducedMotion()) {
      el.scrollTop = 0
      return
    }
    gsap.to(el, {
      scrollTo: { y: 0, autoKill: true },
      duration: 0.46,
      ease: STUDIO_EASE.expo,
      overwrite: "auto",
    })
  })

  const scrollToImagineTop = useCallback(() => {
    setBottomDockExpanded(false)
    animateScrollToTop(imagineScrollRef.current)
  }, [animateScrollToTop])

  useEffect(() => {
    if (activeTab !== "imagine" || layoutMode !== "omnibar") {
      setBottomDockExpanded(false)
      setIsBatchSelecting(false)
    }
  }, [activeTab, layoutMode])

  useEffect(() => {
    if (isBatchSelecting) {
      setBottomDockExpanded(false)
    }
  }, [isBatchSelecting])

  // Global Keyboard Shortcuts
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
          setBottomDockExpanded((prev) => {
            const next = !prev
            if (!next) {
              requestAnimationFrame(() => {
                document.getElementById("bottom-dock-prompt-input")?.focus()
              })
            }
            return next
          })
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
        bottomDockExpanded &&
        !zenWorkbenchOpen &&
        !annotatingEntryId &&
        !lightboxRecordId &&
        !settingsOpen &&
        !commandPaletteOpen &&
        !logsOpen
      ) {
        setBottomDockExpanded(false)
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
    bottomDockExpanded,
    zenWorkbenchOpen,
    annotatingEntryId,
    lightboxRecordId,
    settingsOpen,
    commandPaletteOpen,
    logsOpen,
    scrollToImagineTop,
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

  // Hydrate creation defaults once when initial /api/info and /api/config load
  useEffect(() => {
    if (initHydratedRef.current) return
    if (!infoQuery.data || !configQuery.data) return
    initHydratedRef.current = true
    const cfgRes = configQuery.data
    const infoRes = infoQuery.data

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
  }, [infoQuery.data, configQuery.data, selectSizeOrRatioFromValue])

  useEffect(() => {
    if (infoQuery.error) {
      showToast(
        "初始化加载失败: " + (infoQuery.error as Error).message,
        "error"
      )
    }
  }, [infoQuery.error, showToast])

  // Surgical TanStack Query Cache Helpers
  const scheduleSoftInvalidateRecords = useCallback(() => {
    if (invalidateTimerRef.current) {
      window.clearTimeout(invalidateTimerRef.current)
    }
    invalidateTimerRef.current = window.setTimeout(() => {
      invalidateTimerRef.current = null
      void queryClient.invalidateQueries({
        queryKey: ["studio-records"],
        refetchType: "active",
      })
    }, 900)
  }, [queryClient])

  const patchRecordsInCache = useCallback(
    (incomingList: TaskRecord[]) => {
      if (!incomingList || incomingList.length === 0) return
      const incomingMap = new Map<string, TaskRecord>()
      for (const r of incomingList) {
        if (r?.id) incomingMap.set(r.id, r)
      }
      if (incomingMap.size === 0) return

      queryClient.setQueriesData<InfiniteData<RecordsPageResponse>>(
        { queryKey: ["studio-records"] },
        (old) => {
          if (!old || !old.pages || old.pages.length === 0) return old
          const seenIds = new Set<string>()
          const updatedPages = old.pages.map((page) => {
            let changed = false
            const nextRecords = page.records.map((rec) => {
              const inc = incomingMap.get(rec.id)
              if (!inc) return rec
              seenIds.add(rec.id)
              const merged = mergeTaskRecord(rec, inc)
              if (merged !== rec) changed = true
              return merged
            })
            return changed ? { ...page, records: nextRecords } : page
          })

          // Prepend brand-new records into page 0
          const brandNew: TaskRecord[] = []
          for (const inc of incomingList) {
            if (inc?.id && !seenIds.has(inc.id)) {
              brandNew.push(inc)
            }
          }
          if (brandNew.length > 0) {
            const p0 = updatedPages[0]
            updatedPages[0] = {
              ...p0,
              records: sortRecordsDesc([...brandNew, ...p0.records]),
              total: (p0.total || 0) + brandNew.length,
            }
          }
          return { ...old, pages: updatedPages }
        }
      )
    },
    [queryClient]
  )

  const removeRecordsFromCache = useCallback(
    (ids: string[]) => {
      if (!ids || ids.length === 0) return
      const delSet = new Set(ids)
      queryClient.setQueriesData<InfiniteData<RecordsPageResponse>>(
        { queryKey: ["studio-records"] },
        (old) => {
          if (!old || !old.pages) return old
          let removedAny = false
          const nextPages = old.pages.map((page) => {
            const filtered = page.records.filter((r) => !delSet.has(r.id))
            if (filtered.length !== page.records.length) {
              removedAny = true
              return { ...page, records: filtered }
            }
            return page
          })
          return removedAny ? { ...old, pages: nextPages } : old
        }
      )
    },
    [queryClient]
  )

  const refreshRecords = useCallback(async () => {
    setDiskStatsOverride(null)
    await queryClient.invalidateQueries({ queryKey: ["studio-records"] })
  }, [queryClient])

  // Real-Time Server-Sent Events (SSE) subscription patching TanStack Query cache surgically
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
            setDiskStatsOverride(msg.payload.disk_stats)
          } else if (msg.type === "record_updated" && msg.payload) {
            const updated: TaskRecord = msg.payload
            patchRecordsInCache([updated])
            if (
              updated.state === "succeeded" ||
              updated.state === "error" ||
              updated.state === "failed" ||
              updated.state === "timeout" ||
              updated.state === "canceled"
            ) {
              scheduleSoftInvalidateRecords()
            }
          } else if (msg.type === "records_deleted" && msg.payload?.ids) {
            removeRecordsFromCache(msg.payload.ids)
            scheduleSoftInvalidateRecords()
          } else if (msg.type === "stats_updated" && msg.payload) {
            setDiskStatsOverride(msg.payload)
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
  }, [
    patchRecordsInCache,
    removeRecordsFromCache,
    scheduleSoftInvalidateRecords,
  ])

  const activeCount = useMemo(() => {
    if (serverCounts) return serverCounts.active
    return records.filter(
      (r) => r.state === "pending" || r.state === "running"
    ).length
  }, [records, serverCounts])

  // Fallback polling only if SSE disconnected while tasks are active
  useEffect(() => {
    if (activeCount === 0 || sseConnected) return
    const timer = setInterval(() => {
      void refreshRecords()
    }, 3000)
    return () => clearInterval(timer)
  }, [activeCount, sseConnected, refreshRecords])

  // Upload or locally convert reference image files
  const handleFilesSelected = useCallback(
    async (fileList: FileList | File[]) => {
      const files = Array.from(fileList)
      const opts = composerRef.current
      for (const file of files) {
        if (!file.type.startsWith("image/")) {
          showToast(`已跳过非图片文件: ${file.name}`, "error")
          continue
        }
        const entryId = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`
        const objectPreview = URL.createObjectURL(file)
        registerBlobUrl(objectPreview)
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
          if (res.preview_url && res.preview_url !== objectPreview) {
            revokeBlobUrl(objectPreview)
          }
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
          if (payload.preview_url && payload.preview_url !== objectPreview) {
            revokeBlobUrl(objectPreview)
          }
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
    [showToast, registerBlobUrl, revokeBlobUrl]
  )

  // Apply an annotated/cropped Reference Image
  const handleApplyAnnotatedFile = useCallback(
    async (entry: ReferenceImageEntry, file: File) => {
      const opts = composerRef.current
      const editedPreview = URL.createObjectURL(file)
      registerBlobUrl(editedPreview)
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
        if (res.preview_url && res.preview_url !== editedPreview) {
          revokeBlobUrl(editedPreview)
        }
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
    [showToast, registerBlobUrl, revokeBlobUrl]
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
        void handleFilesSelected(imageFiles)
        showToast(`已从剪贴板粘贴 ${imageFiles.length} 张参考图`, "info")
      }
    }
    window.addEventListener("paste", onPaste)
    return () => window.removeEventListener("paste", onPaste)
  }, [handleFilesSelected, showToast])

  const handlePasteFromClipboardButton = useCallback(async () => {
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
  }, [handleFilesSelected, showToast])

  // Race-isolated re-conversion of all local reference images (with AbortController + sequence guard)
  const reconvertLocalRefs = useCallback(
    async (
      targetMode: RefImageMode,
      nextProvider?: ImageHostProvider,
      nextExpiry?: string,
      nextMaxDim?: number,
      nextQuality?: number
    ) => {
      const curState = composerRef.current
      const provider = nextProvider ?? curState.imageHostProvider
      const expiry = nextExpiry ?? curState.litterboxExpiry
      const maxDim = nextMaxDim ?? curState.compressMaxDim
      const qualityVal = nextQuality ?? curState.compressQuality

      const convertible = curState.referenceImages.filter((r) =>
        Boolean(r.local_ref)
      )
      if (convertible.length === 0) return

      reconvertAbortRef.current?.abort()
      const ac = new AbortController()
      reconvertAbortRef.current = ac
      const seq = ++reconvertSeqRef.current

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
        if (seq !== reconvertSeqRef.current || ac.signal.aborted) return
        try {
          const res = await convertCachedRefOnServer({
            localRef: item.local_ref,
            mode: targetMode,
            provider,
            litterboxExpiry: expiry,
            compressMaxDim: maxDim,
            compressQuality: qualityVal,
            signal: ac.signal,
          })
          if (seq !== reconvertSeqRef.current || ac.signal.aborted) return
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
          if (
            err?.name === "AbortError" ||
            seq !== reconvertSeqRef.current ||
            ac.signal.aborted
          ) {
            return
          }
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
    []
  )

  const scheduleSliderReconvert = useCallback(
    (nextMaxDim: number, nextQuality: number) => {
      if (sliderReconvertTimerRef.current) {
        window.clearTimeout(sliderReconvertTimerRef.current)
      }
      sliderReconvertTimerRef.current = window.setTimeout(() => {
        sliderReconvertTimerRef.current = null
        if (composerRef.current.refMode === "compress_base64") {
          void reconvertLocalRefs(
            "compress_base64",
            undefined,
            undefined,
            nextMaxDim,
            nextQuality
          )
        }
      }, 300)
    },
    [reconvertLocalRefs]
  )

  const handleChangeRefMode = useCallback(
    async (nextMode: RefImageMode) => {
      setRefMode(nextMode)
      await reconvertLocalRefs(nextMode)
    },
    [reconvertLocalRefs]
  )

  const handleRetrySingleRef = useCallback(
    async (entry: ReferenceImageEntry) => {
      if (!entry.local_ref) return
      const curState = composerRef.current
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
          mode: curState.refMode,
          provider: curState.imageHostProvider,
          litterboxExpiry: curState.litterboxExpiry,
          compressMaxDim: curState.compressMaxDim,
          compressQuality: curState.compressQuality,
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
    },
    [showToast]
  )

  const handleRemoveRef = useCallback(
    (id: string) => {
      setReferenceImages((prev) => {
        const target = prev.find((r) => r.id === id)
        if (target) {
          revokeBlobUrl(target.preview)
          revokeBlobUrl(target.original_preview)
        }
        return prev.filter((r) => r.id !== id)
      })
    },
    [revokeBlobUrl]
  )

  const handleAddRefUrl = useCallback(
    (rawUrl: string) => {
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
    },
    [showToast]
  )

  const handleMoveRef = useCallback((index: number, direction: -1 | 1) => {
    setReferenceImages((prev) => {
      const target = index + direction
      if (target < 0 || target >= prev.length) return prev
      const next = [...prev]
      const [moved] = next.splice(index, 1)
      next.splice(target, 0, moved)
      return next
    })
  }, [])

  // Use a generated gallery image directly as a Reference Image
  const handleUseGeneratedAsRef = useCallback(
    async (img: SavedImage, _rec: TaskRecord) => {
      const curState = composerRef.current
      const stayInBottomDock =
        curState.activeTab === "imagine" &&
        curState.layoutMode === "omnibar" &&
        curState.isScrolledPastComposer
      setActiveTab("imagine")
      setSplitMobilePane("studio")
      if (!stayInBottomDock) {
        scrollToImagineTop()
      } else if (!curState.lightboxRecordId) {
        requestAnimationFrame(() => {
          document.getElementById("bottom-dock-prompt-input")?.focus()
        })
      }

      if (img.local_file) {
        const entryId = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`
        const preview = getThumbUrl(img.local_file, img.remote_url, 160)
        setReferenceImages((prev) => [
          ...prev,
          {
            id: entryId,
            mode: curState.refMode,
            value: "",
            preview,
            original_preview: `/images/${encodeURIComponent(img.local_file)}`,
            label:
              curState.refMode === "upload" ? "正在上传图床..." : "正在载入...",
            uploading: true,
          },
        ])
        try {
          const res = await convertCachedRefOnServer({
            sourceLocalFile: img.local_file,
            mode: curState.refMode,
            provider: curState.imageHostProvider,
            litterboxExpiry: curState.litterboxExpiry,
            compressMaxDim: curState.compressMaxDim,
            compressQuality: curState.compressQuality,
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
            setReferenceImages((prev) =>
              prev.filter((cur) => cur.id !== entryId)
            )
            showToast("载入参考图失败: " + err.message, "error")
          }
        }
        return
      }

      if (img.remote_url) {
        handleAddRefUrl(img.remote_url)
        showToast("已将该作品添加为参考图", "success")
      }
    },
    [scrollToImagineTop, handleAddRefUrl, showToast]
  )

  // Ratio & Size handlers
  const handleSelectRatio = useCallback(
    (grp: RatioPresetGroup) => {
      setSelectedRatio(grp.ratio)
      const sizes = grp.sizes || []
      const matched =
        sizes.find((s) => s.tier === preferredTier) ||
        sizes.find((s) => s.value === grp.default_size) ||
        sizes[0]
      if (matched) {
        setSelectedSize(matched.value)
      }
    },
    [preferredTier]
  )

  const handleApplyCustomSize = useCallback(
    (overrideW?: number, overrideH?: number) => {
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
    },
    [customW, customH, showToast]
  )

  // Save Config (persists API key, host settings, templates, and projects)
  const handleSaveConfig = useCallback(
    async (partial: Partial<AppConfig>, silent = false) => {
      const cur = composerRef.current
      const cfg = cur.config
      const merged: AppConfig = {
        api_key: cfg?.api_key || "",
        base_url: cfg?.base_url || "https://duomiapi.com",
        default_model: cur.customModel.trim() || cur.selectedModel,
        default_size: cur.selectedSize,
        oversea: cur.oversea,
        poll_interval: cfg?.poll_interval || 3,
        poll_timeout: cfg?.poll_timeout || 300,
        auto_download: cfg?.auto_download !== false,
        ref_image_mode: cur.refMode,
        image_host_provider: cur.imageHostProvider,
        litterbox_expiry: cur.litterboxExpiry,
        custom_upload_url: cfg?.custom_upload_url || "",
        custom_upload_field: cfg?.custom_upload_field || "file",
        custom_upload_auth: cfg?.custom_upload_auth || "",
        custom_upload_json_path: cfg?.custom_upload_json_path || "",
        compress_max_dim: cur.compressMaxDim,
        compress_quality: cur.compressQuality,
        auto_compat_fallback: cur.autoCompatFallback,
        prompt_templates: cfg?.prompt_templates || [],
        projects: cfg?.projects || [],
        ...partial,
      }
      const saved = await apiFetch<AppConfig>("/api/config", {
        method: "POST",
        body: JSON.stringify(merged),
      })
      queryClient.setQueryData(["studio-config"], saved)
      setRefMode(saved.ref_image_mode || "upload")
      setImageHostProvider(saved.image_host_provider || "auto")
      setLitterboxExpiry(saved.litterbox_expiry || "12h")
      setCompressMaxDim(saved.compress_max_dim || 1536)
      setCompressQuality(saved.compress_quality || 85)
      setAutoCompatFallback(saved.auto_compat_fallback !== false)
      if (!silent) {
        showToast("设置已持久化保存至 duomi_data/config.json", "success")
      }
    },
    [queryClient, showToast]
  )

  // Project Albums CRUD & Record Organization
  const projects = useMemo<ProjectFolder[]>(
    () => config?.projects || [],
    [config?.projects]
  )
  const projectsRef = useRef(projects)
  useEffect(() => {
    projectsRef.current = projects
  }, [projects])

  const handleCreateProject = useCallback(
    async (name: string, color: string) => {
      const trimmed = name.trim()
      if (!trimmed) return
      const nextProj: ProjectFolder = {
        id: `proj_${Date.now().toString(36)}`,
        name: trimmed,
        color: color || "amber",
        created_at: Math.floor(Date.now() / 1000),
      }
      await handleSaveConfig(
        { projects: [...projectsRef.current, nextProj] },
        true
      )
      showToast(`已新建项目画册「${trimmed}」`, "success")
    },
    [handleSaveConfig, showToast]
  )

  const handleDeleteProject = useCallback(
    async (projId: string) => {
      await handleSaveConfig(
        { projects: projectsRef.current.filter((p) => p.id !== projId) },
        true
      )
      setActiveProjectId((cur) => (cur === projId ? "" : cur))
      try {
        const page = await fetchRecordsPage({ limit: 500, projectId: projId })
        const affectedIds = (page.records || []).map((r) => r.id)
        if (affectedIds.length > 0) {
          const res = await organizeRecordsOnServer({
            ids: affectedIds,
            project_id: "",
          })
          patchRecordsInCache(res.records)
          scheduleSoftInvalidateRecords()
        }
      } catch {
        // ignore cleanup error
      }
      showToast("已删除该画册分组（作品文件本身完好保留）", "info")
    },
    [
      handleSaveConfig,
      patchRecordsInCache,
      scheduleSoftInvalidateRecords,
      showToast,
    ]
  )

  const handleAssignProject = useCallback(
    async (ids: string[], projectId: string) => {
      if (ids.length === 0) return
      try {
        const res = await organizeRecordsOnServer({
          ids,
          project_id: projectId,
        })
        patchRecordsInCache(res.records)
        scheduleSoftInvalidateRecords()
        const targetName =
          projectsRef.current.find((p) => p.id === projectId)?.name || "未归档"
        showToast(
          `已将 ${res.updated_count} 项作品移入「${targetName}」`,
          "success"
        )
      } catch (err: any) {
        showToast(err.message, "error")
      }
    },
    [patchRecordsInCache, scheduleSoftInvalidateRecords, showToast]
  )

  const handleBatchStar = useCallback(
    async (ids: string[], starred: boolean) => {
      if (ids.length === 0) return
      try {
        const res = await organizeRecordsOnServer({ ids, starred })
        patchRecordsInCache(res.records)
        scheduleSoftInvalidateRecords()
        showToast(
          starred
            ? `已批量星标 ${res.updated_count} 项作品`
            : `已取消星标 ${res.updated_count} 项作品`,
          "success"
        )
      } catch (err: any) {
        showToast(err.message, "error")
      }
    },
    [patchRecordsInCache, scheduleSoftInvalidateRecords, showToast]
  )

  const handleOrganizeSingle = useCallback(
    async (recId: string, patch: { project_id?: string; note?: string }) => {
      const res = await organizeRecordsOnServer({ ids: [recId], ...patch })
      patchRecordsInCache(res.records)
      scheduleSoftInvalidateRecords()
    },
    [patchRecordsInCache, scheduleSoftInvalidateRecords]
  )

  // Atomic, Re-entrancy-Locked Generation Submission (eliminates double submit & prompt cross-talk)
  const handleSubmitGenerate = useCallback(
    async (overridePrompt?: string) => {
      if (submittingRef.current) return

      // Capture an immutable snapshot of all composer parameters at click/Ctrl+Enter instant
      const snap = composerRef.current
      const rawPrompt =
        typeof overridePrompt === "string" ? overridePrompt : snap.prompt
      const trimmedPrompt = rawPrompt.trim()
      if (!trimmedPrompt) {
        showToast("请输入画面描述词 (Prompt)", "error")
        return
      }
      if (!snap.config?.api_key?.trim()) {
        showToast("请先配置多米 API 密钥", "error")
        setSettingsTab("api")
        setSettingsOpen(true)
        return
      }

      const refsSnap = snap.referenceImages.map((item) => ({ ...item }))
      if (refsSnap.some((r) => r.uploading)) {
        showToast("参考图仍在处理中，请稍候片刻再提交", "info")
        return
      }
      const failedRefs = refsSnap.filter((r) => r.error || !r.value)
      if (failedRefs.length > 0) {
        showToast(
          "存在尚未上传成功的参考图，请点击重试、移除，或切换为「压缩转Base64」选项",
          "error"
        )
        return
      }

      const finalModel =
        snap.customModel.trim() || snap.selectedModel || "gpt-image-2.6-flare"
      const finalQuality = snap.quality === "default" ? "" : snap.quality
      const finalSize = snap.selectedSize
      const finalBg = snap.background
      const finalOversea = snap.oversea
      const finalCompat = snap.autoCompatFallback
      const finalProjectId = snap.activeProjectId
      const finalRefMode = snap.refMode
      const n = Math.max(1, Math.min(10, Number(snap.batchCount) || 1))

      submittingRef.current = true
      setIsSubmitting(true)
      try {
        const res = await apiFetch<{
          id: string
          submitted_count?: number
          warning_msg?: string
          partial_error?: string
          records?: TaskRecord[]
        }>("/api/generate", {
          method: "POST",
          body: JSON.stringify({
            model: finalModel,
            prompt: trimmedPrompt,
            size: finalSize,
            project_id: finalProjectId,
            ref_mode: finalRefMode,
            image: refsSnap.map((item) => item.value),
            ref_items: refsSnap.map((item) => ({
              value: item.value,
              local_ref: item.local_ref || "",
              remote_url: item.remote_url || "",
              mode: item.mode,
              provider: item.provider || "",
              label: item.label,
            })),
            quality: finalQuality,
            background: finalBg,
            n,
            oversea: finalOversea,
            auto_compat_fallback: finalCompat,
          }),
        })

        if (res.records && res.records.length > 0) {
          patchRecordsInCache(res.records)
          scheduleSoftInvalidateRecords()
        }

        setPromptHistory(
          pushPromptHistory({
            prompt: trimmedPrompt,
            model: finalModel,
            size: finalSize,
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
        if (!composerRef.current.sseConnected) {
          await refreshRecords()
        }
      } catch (err: any) {
        showToast(err.message, "error")
      } finally {
        submittingRef.current = false
        setIsSubmitting(false)
      }
    },
    [
      patchRecordsInCache,
      scheduleSoftInvalidateRecords,
      scrollToImagineTop,
      refreshRecords,
      showToast,
    ]
  )

  // Race-Safe 1-Click Remix / Reuse Record (with sequence token + AbortController + clean ref reset)
  const handleReuseRecord = useCallback(
    async (rec: TaskRecord, includeRefs: boolean) => {
      // Cancel any in-flight previous reuse or reconvert operation so stale awaits can never overwrite
      reuseAbortRef.current?.abort()
      reconvertAbortRef.current?.abort()
      const ac = new AbortController()
      reuseAbortRef.current = ac
      const seq = ++reuseSeqRef.current

      const snap = composerRef.current
      setPromptProgrammatic(rec.prompt || "")

      const isKnown = snap.models.some((m) => m.id === rec.model)
      if (isKnown) {
        setSelectedModel(rec.model)
        setCustomModel("")
      } else if (rec.model) {
        setCustomModel(rec.model)
      }
      if (rec.size) {
        selectSizeOrRatioFromValue(rec.size, snap.ratioPresets)
      }
      setQuality(rec.quality || "default")
      setBackground(rec.background || "auto")
      setOversea(!!rec.oversea)
      setActiveProjectId(rec.project_id || "")

      const stayInBottomDock =
        snap.activeTab === "imagine" &&
        snap.layoutMode === "omnibar" &&
        snap.isScrolledPastComposer
      setActiveTab("imagine")
      setSplitMobilePane("studio")
      if (!stayInBottomDock) {
        scrollToImagineTop()
      } else if (!snap.lightboxRecordId) {
        requestAnimationFrame(() => {
          document.getElementById("bottom-dock-prompt-input")?.focus()
        })
      }

      // Clear previous reference images cleanly when reusing a text-to-image record or !includeRefs
      const refItems = includeRefs ? rec.ref_items || [] : []
      if (refItems.length === 0) {
        setReferenceImages((prev) => {
          for (const p of prev) {
            revokeBlobUrl(p.preview)
            revokeBlobUrl(p.original_preview)
          }
          return []
        })
        showToast("已将该作品参数装填至创作舱", "success")
        return
      }

      // Immediately mount placeholder reference slots so user sees instant feedback & old refs are wiped
      const placeholders: ReferenceImageEntry[] = refItems.map((ri, idx) => {
        const preview = ri.local_ref
          ? getThumbUrl(ri.local_ref, ri.remote_url, 160)
          : ri.remote_url || ""
        return {
          id: `reuse-${seq}-${idx}-${Math.random().toString(36).slice(2, 6)}`,
          mode: ri.local_ref ? snap.refMode : "url",
          value: ri.local_ref ? "" : ri.remote_url || "",
          preview,
          original_preview: ri.local_ref
            ? `/images/${ri.local_ref}`
            : ri.remote_url || "",
          local_ref: ri.local_ref,
          remote_url: ri.remote_url,
          label: ri.local_ref ? "正在恢复参考图..." : "直链 URL",
          uploading: Boolean(ri.local_ref),
        }
      })

      setReferenceImages((prev) => {
        for (const p of prev) {
          revokeBlobUrl(p.preview)
          revokeBlobUrl(p.original_preview)
        }
        return placeholders
      })

      let okCount = 0
      let failCount = 0

      for (let i = 0; i < refItems.length; i++) {
        if (seq !== reuseSeqRef.current || ac.signal.aborted) return
        const ri = refItems[i]
        const slotId = placeholders[i].id
        if (!ri.local_ref) {
          if (ri.remote_url) okCount++
          continue
        }
        try {
          const conv = await convertCachedRefOnServer({
            localRef: ri.local_ref,
            mode: snap.refMode,
            provider: snap.imageHostProvider,
            litterboxExpiry: snap.litterboxExpiry,
            compressMaxDim: snap.compressMaxDim,
            compressQuality: snap.compressQuality,
            signal: ac.signal,
          })
          if (seq !== reuseSeqRef.current || ac.signal.aborted) return
          const previewUrl = conv.preview_url || `/images/${ri.local_ref}`
          okCount++
          setReferenceImages((prev) =>
            prev.map((item) =>
              item.id === slotId
                ? {
                    ...item,
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
                    uploading: false,
                    error: undefined,
                  }
                : item
            )
          )
        } catch (err: any) {
          if (
            err?.name === "AbortError" ||
            seq !== reuseSeqRef.current ||
            ac.signal.aborted
          ) {
            return
          }
          failCount++
          // Never silently substitute an expired temporary host URL; show explicit retryable error
          setReferenceImages((prev) =>
            prev.map((item) =>
              item.id === slotId
                ? {
                    ...item,
                    value: "",
                    uploading: false,
                    error: err?.message || "恢复参考图失败",
                    label: "恢复失败",
                  }
                : item
            )
          )
        }
      }

      if (seq !== reuseSeqRef.current || ac.signal.aborted) return
      if (failCount > 0) {
        showToast(
          `已载入参数：${okCount} 张参考图就绪，${failCount} 张需重试或切换 Base64 模式`,
          "error"
        )
      } else {
        showToast(
          `已完整载入同款参数并恢复 ${okCount} 张参考图`,
          "success"
        )
      }
    },
    [
      setPromptProgrammatic,
      selectSizeOrRatioFromValue,
      scrollToImagineTop,
      revokeBlobUrl,
      showToast,
    ]
  )

  // Retry failed task directly
  const handleRetryRecord = useCallback(
    async (rec: TaskRecord) => {
      const snap = composerRef.current
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
                mode: snap.refMode,
                provider: snap.imageHostProvider,
                litterboxExpiry: snap.litterboxExpiry,
                compressMaxDim: snap.compressMaxDim,
                compressQuality: snap.compressQuality,
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
              // Let backend recover from local_ref if upload failed on client side
              restoredRefs.push({
                value: "",
                local_ref: ri.local_ref,
                remote_url: "",
                mode: snap.refMode,
                provider: snap.imageHostProvider,
                label: ri.label || "",
              })
              continue
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
        const res = await apiFetch<{ records?: TaskRecord[] }>("/api/generate", {
          method: "POST",
          body: JSON.stringify({
            model: rec.model,
            prompt: rec.prompt,
            size: rec.size,
            project_id: rec.project_id || "",
            ref_mode: snap.refMode,
            image: restoredRefs.map((r) => r.value),
            ref_items: restoredRefs,
            quality: rec.quality,
            background: rec.background,
            n: 1,
            oversea: rec.oversea,
            auto_compat_fallback: snap.autoCompatFallback,
          }),
        })
        if (res.records?.length) {
          patchRecordsInCache(res.records)
          scheduleSoftInvalidateRecords()
        }
        showToast("已按原参数重新提交任务", "success")
      } catch (err: any) {
        showToast("重新提交失败: " + err.message, "error")
      }
    },
    [patchRecordsInCache, scheduleSoftInvalidateRecords, showToast]
  )

  const handleRefreshSingle = useCallback(
    async (taskId: string) => {
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
    },
    [showToast]
  )

  const handleCancelPolling = useCallback(
    async (taskId: string) => {
      try {
        await apiFetch("/api/records/cancel", {
          method: "POST",
          body: JSON.stringify({ id: taskId }),
        })
        showToast("已停止该任务的本地轮询", "info")
      } catch (err: any) {
        showToast(err.message, "error")
      }
    },
    [showToast]
  )

  const handleToggleStar = useCallback(
    async (rec: TaskRecord) => {
      try {
        const updated = await apiFetch<TaskRecord>("/api/records/star", {
          method: "POST",
          body: JSON.stringify({ id: rec.id, starred: !rec.starred }),
        })
        patchRecordsInCache([updated])
        scheduleSoftInvalidateRecords()
      } catch (err: any) {
        showToast(err.message, "error")
      }
    },
    [patchRecordsInCache, scheduleSoftInvalidateRecords, showToast]
  )

  const handleDownloadMissingLocal = useCallback(
    async (rec: TaskRecord) => {
      try {
        await apiFetch("/api/records/download", {
          method: "POST",
          body: JSON.stringify({ id: rec.id }),
        })
        showToast("已将原图下载至 duomi_data/images/", "success")
      } catch (err: any) {
        showToast(err.message, "error")
      }
    },
    [showToast]
  )

  const handleDeleteSingle = useCallback(
    async (rec: TaskRecord) => {
      try {
        const res = await apiFetch<{
          deleted: string
          disk_stats?: DiskUsageStats
        }>(
          `/api/records?id=${encodeURIComponent(rec.id)}&delete_files=true`,
          { method: "DELETE" }
        )
        removeRecordsFromCache([rec.id])
        scheduleSoftInvalidateRecords()
        if (res.disk_stats) setDiskStatsOverride(res.disk_stats)
        setLightboxRecordId((cur) => (cur === rec.id ? null : cur))
        showToast("已删除记录及对应本地图片", "info")
      } catch (err: any) {
        showToast(err.message, "error")
      }
    },
    [removeRecordsFromCache, scheduleSoftInvalidateRecords, showToast]
  )

  const handleBatchDelete = useCallback(
    async (ids: string[]) => {
      try {
        const res = await apiFetch<{
          deleted_count: number
          disk_stats?: DiskUsageStats
        }>("/api/records/batch-delete", {
          method: "POST",
          body: JSON.stringify({ ids, delete_files: true }),
        })
        removeRecordsFromCache(ids)
        scheduleSoftInvalidateRecords()
        if (res.disk_stats) setDiskStatsOverride(res.disk_stats)
        showToast(`已批量删除 ${res.deleted_count} 条记录`, "info")
      } catch (err: any) {
        showToast(err.message, "error")
      }
    },
    [removeRecordsFromCache, scheduleSoftInvalidateRecords, showToast]
  )

  const handleClearFailed = useCallback(async () => {
    try {
      const res = await apiFetch<{
        deleted_count: number
        disk_stats?: DiskUsageStats
      }>("/api/records/batch-delete", {
        method: "POST",
        body: JSON.stringify({ clear_failed: true, delete_files: true }),
      })
      if (res.disk_stats) setDiskStatsOverride(res.disk_stats)
      await refreshRecords()
      showToast(`已清理 ${res.deleted_count} 条失败/超时记录`, "success")
    } catch (err: any) {
      showToast(err.message, "error")
    }
  }, [refreshRecords, showToast])

  const handleOpenLocalFolder = useCallback(
    async (targetFile?: string, targetDir?: "images" | "logs" | "thumbs" | "data") => {
      try {
        const res = await apiFetch<{
          opened: boolean
          path: string
          message: string
        }>("/api/open-folder", {
          method: "POST",
          body: JSON.stringify({
            target_file: targetFile || "",
            target_dir: targetDir || "",
          }),
        })
        if (res.opened) {
          showToast(res.message, "success")
        } else {
          copyText(res.path, `已复制本地路径: ${res.path}`)
        }
      } catch (err: any) {
        showToast(err.message, "error")
      }
    },
    [copyText, showToast]
  )

  const handleQuickCopyLogs = useCallback(async () => {
    try {
      const res = await fetchLogs({ limit: 400 })
      copyText(res.plain_text, "已一键复制脱敏诊断日志")
    } catch (err: any) {
      showToast("获取日志失败: " + (err?.message || "未知错误"), "error")
    }
  }, [copyText, showToast])

  const handleOpenLightbox = useCallback(
    (rec: TaskRecord, idx: number, openCompare = false) => {
      setLightboxInitialCompare(openCompare)
      setLightboxRecordId(rec.id)
      setLightboxImgIdx(idx)
    },
    []
  )

  const handleOpenImportTask = useCallback(() => {
    setImportTaskOpen(true)
  }, [])

  const handleRefreshAllToast = useCallback(async () => {
    await refreshRecords()
    showToast("已同步最新记录", "info")
  }, [refreshRecords, showToast])

  const handleLoadMore = useCallback(() => {
    if (recordsQuery.hasNextPage && !recordsQuery.isFetchingNextPage) {
      void recordsQuery.fetchNextPage()
    }
  }, [recordsQuery])

  // Recipe / Template handlers
  const handleApplyTemplate = useCallback(
    (tpl: PromptTemplate, withParams: boolean) => {
      const snap = composerRef.current
      setPromptProgrammatic(tpl.prompt)
      if (withParams) {
        if (tpl.model) {
          const known = snap.models.some((m) => m.id === tpl.model)
          if (known) {
            setSelectedModel(tpl.model)
            setCustomModel("")
          } else {
            setCustomModel(tpl.model)
          }
        }
        if (tpl.size) {
          selectSizeOrRatioFromValue(tpl.size, snap.ratioPresets)
        }
        setQuality(tpl.quality || "default")
        setBackground(tpl.background || "auto")
      }
      setActiveTab("imagine")
      setSplitMobilePane("studio")
      scrollToImagineTop()
      showToast(`已装填灵感配方「${tpl.title}」`, "success")
    },
    [
      setPromptProgrammatic,
      selectSizeOrRatioFromValue,
      scrollToImagineTop,
      showToast,
    ]
  )

  const handleSaveCustomTemplate = useCallback(
    async (tpl: PromptTemplate) => {
      const existing = composerRef.current.config?.prompt_templates || []
      await handleSaveConfig({
        prompt_templates: [tpl, ...existing],
      })
    },
    [handleSaveConfig]
  )

  const handleDeleteCustomTemplate = useCallback(
    async (id: string) => {
      const existing = composerRef.current.config?.prompt_templates || []
      await handleSaveConfig({
        prompt_templates: existing.filter((t) => t.id !== id),
      })
    },
    [handleSaveConfig]
  )

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

  const dockShortModelLabel = useMemo(() => {
    if (customModel.trim()) return customModel.trim()
    const found = models.find((m) => m.id === selectedModel)
    return found?.name || selectedModel
  }, [customModel, models, selectedModel])

  const dockTierShortLabel = useMemo(() => {
    if (selectedRatio === "auto") return "Auto"
    if (selectedRatio === "custom") return selectedSize
    const grp =
      ratioPresets.find((g) => g.ratio === selectedRatio) || ratioPresets[0]
    const found = grp?.sizes.find((s) => s.value === selectedSize)
    if (found?.tier === "ratio") return `${selectedRatio}·比例`
    if (found?.tier) return `${selectedRatio}·${found.tier.toUpperCase()}`
    return `${selectedRatio}`
  }, [selectedRatio, selectedSize, ratioPresets])

  const anyUploadingRef = useMemo(
    () => referenceImages.some((r) => r.uploading),
    [referenceImages]
  )

  const totalGalleryCount = serverCounts?.all ?? records.length

  const renderOmnibarComposer = (
    floating = false,
    onCollapseOverlay?: () => void
  ) => (
    <OmnibarComposer
      models={models}
      selectedModel={selectedModel}
      onSelectModel={setSelectedModel}
      customModel={customModel}
      onChangeCustomModel={setCustomModel}
      prompt={prompt}
      promptRevision={promptRevision}
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
          void reconvertLocalRefs("upload", p, litterboxExpiry)
        }
      }}
      litterboxExpiry={litterboxExpiry}
      onChangeLitterboxExpiry={(exp) => {
        setLitterboxExpiry(exp)
        if (refMode === "upload") {
          void reconvertLocalRefs("upload", imageHostProvider, exp)
        }
      }}
      compressMaxDim={compressMaxDim}
      onChangeCompressMaxDim={(dim) => {
        setCompressMaxDim(dim)
        scheduleSliderReconvert(dim, compressQuality)
      }}
      compressQuality={compressQuality}
      onChangeCompressQuality={(q) => {
        setCompressQuality(q)
        scheduleSliderReconvert(compressMaxDim, q)
      }}
      referenceImages={referenceImages}
      onFilesSelected={handleFilesSelected}
      onAddRefUrl={handleAddRefUrl}
      onRemoveRef={handleRemoveRef}
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
      floating={floating}
    />
  )

  return (
    <TooltipProvider delayDuration={180}>
      <div
        ref={appRootRef}
        className="flex flex-col h-screen w-screen overflow-hidden bg-background text-foreground"
      >
        {/* Unified Borderless Apple Top Bar (Desktop) + Floating Capsule Dock (Mobile) */}
        <StudioRail
          activeTab={activeTab}
          onSelectTab={setActiveTab}
          layoutMode={layoutMode}
          onToggleLayoutMode={toggleLayoutMode}
          activeQueueCount={activeCount}
          totalGalleryCount={totalGalleryCount}
          hasApiKey={hasApiKey}
          sseConnected={sseConnected}
          unreadLogErrors={unreadLogErrors}
          theme={theme}
          onToggleTheme={() =>
            setTheme((prev) => (prev === "dark" ? "light" : "dark"))
          }
          onOpenCommandPalette={() => setCommandPaletteOpen(true)}
          onOpenLogs={() => setLogsOpen(true)}
          onOpenLocalFolder={() => void handleOpenLocalFolder()}
          onOpenSettings={(tab = "api") => {
            setSettingsTab(tab)
            setSettingsOpen(true)
          }}
        />

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
                    const past = e.currentTarget.scrollTop > 160
                    setIsScrolledPastComposer((prev) =>
                      prev === past ? prev : past
                    )
                    if (!past && bottomDockExpanded) {
                      setBottomDockExpanded(false)
                    }
                  }}
                  className="h-full overflow-y-auto studio-scroll"
                >
                  {/* Shadowless Static Creation Canvas */}
                  <div className="studio-container relative z-0 pt-5 pb-3">
                    {renderOmnibarComposer(false)}
                  </div>

                  {/* Unified Plumb-Line Sticky Filter Bar + TanStack Virtualized Masonry Stream */}
                  <MasonryArtworkStream
                    mode="imagine"
                    embeddedScroll={false}
                    scrollContainerRef={imagineScrollRef}
                    onSelectModeChange={setIsBatchSelecting}
                    records={records}
                    serverCounts={serverCounts}
                    serverModels={serverModels}
                    totalMatched={totalMatched}
                    hasMore={Boolean(recordsQuery.hasNextPage)}
                    isLoadingMore={recordsQuery.isFetchingNextPage}
                    isFetchingRecords={recordsQuery.isFetching}
                    onLoadMore={handleLoadMore}
                    statusFilter={statusFilter}
                    onChangeStatusFilter={setStatusFilter}
                    projectFilter={projectFilter}
                    onChangeProjectFilter={setProjectFilter}
                    modelFilter={modelFilter}
                    onChangeModelFilter={setModelFilter}
                    searchQuery={searchQuery}
                    onChangeSearchQuery={setSearchQuery}
                    projects={projects}
                    onCreateProject={handleCreateProject}
                    onDeleteProject={handleDeleteProject}
                    onAssignProject={handleAssignProject}
                    onBatchStar={handleBatchStar}
                    refreshingIds={refreshingIds}
                    onRefreshAll={handleRefreshAllToast}
                    onRefreshSingle={handleRefreshSingle}
                    onCancelPolling={handleCancelPolling}
                    onToggleStar={handleToggleStar}
                    onOpenLightbox={handleOpenLightbox}
                    onUseGeneratedAsRef={handleUseGeneratedAsRef}
                    onReuseRecord={handleReuseRecord}
                    onRetryRecord={handleRetryRecord}
                    onDownloadMissingLocal={handleDownloadMissingLocal}
                    onDeleteSingle={handleDeleteSingle}
                    onBatchDelete={handleBatchDelete}
                    onClearFailed={handleClearFailed}
                    onOpenImportTask={handleOpenImportTask}
                    onCopyText={copyText}
                  />
                </div>

                {/* Scrolled-Down Bottom Compact Input Pill + In-Place Upward Expansion */}
                <BottomComposerDock
                  visible={isScrolledPastComposer && !isBatchSelecting}
                  expanded={bottomDockExpanded}
                  onChangeExpanded={setBottomDockExpanded}
                  prompt={prompt}
                  promptRevision={promptRevision}
                  onChangePrompt={setPrompt}
                  referenceImages={referenceImages}
                  onFilesSelected={handleFilesSelected}
                  onRemoveRef={handleRemoveRef}
                  shortModelLabel={dockShortModelLabel}
                  tierShortLabel={dockTierShortLabel}
                  batchCount={batchCount}
                  isSubmitting={isSubmitting}
                  anyUploadingRef={anyUploadingRef}
                  onSubmitGenerate={handleSubmitGenerate}
                  onScrollToTop={scrollToImagineTop}
                  renderExpandedComposer={() =>
                    renderOmnibarComposer(true, () =>
                      setBottomDockExpanded(false)
                    )
                  }
                />
              </>
            ) : (
              /* Pro Split 2-Column Mode */
              <div className="flex flex-col lg:grid lg:grid-cols-[410px_1fr] xl:grid-cols-[430px_1fr] h-full overflow-hidden">
                <div className="mx-4 mt-2 mb-1 flex lg:hidden rounded-full bg-foreground/[0.05] p-1 shrink-0">
                  <button
                    type="button"
                    onClick={() => setSplitMobilePane("studio")}
                    className={cn(
                      "flex-1 rounded-full py-1.5 text-xs font-medium transition-colors cursor-pointer",
                      splitMobilePane === "studio"
                        ? "bg-card text-foreground shadow-2xs dark:bg-white/[0.14]"
                        : "text-muted-foreground"
                    )}
                  >
                    参数
                  </button>
                  <button
                    type="button"
                    onClick={() => setSplitMobilePane("gallery")}
                    className={cn(
                      "flex-1 rounded-full py-1.5 text-xs font-medium transition-colors cursor-pointer",
                      splitMobilePane === "gallery"
                        ? "bg-card text-foreground shadow-2xs dark:bg-white/[0.14]"
                        : "text-muted-foreground"
                    )}
                  >
                    画廊 ({totalGalleryCount})
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
                    promptRevision={promptRevision}
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
                        void reconvertLocalRefs("upload", p, litterboxExpiry)
                      }
                    }}
                    litterboxExpiry={litterboxExpiry}
                    onChangeLitterboxExpiry={(exp) => {
                      setLitterboxExpiry(exp)
                      if (refMode === "upload") {
                        void reconvertLocalRefs("upload", imageHostProvider, exp)
                      }
                    }}
                    compressMaxDim={compressMaxDim}
                    onChangeCompressMaxDim={(dim) => {
                      setCompressMaxDim(dim)
                      scheduleSliderReconvert(dim, compressQuality)
                    }}
                    compressQuality={compressQuality}
                    onChangeCompressQuality={(q) => {
                      setCompressQuality(q)
                      scheduleSliderReconvert(compressMaxDim, q)
                    }}
                    referenceImages={referenceImages}
                    onFilesSelected={handleFilesSelected}
                    onAddRefUrl={handleAddRefUrl}
                    onRemoveRef={handleRemoveRef}
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
                    serverCounts={serverCounts}
                    serverModels={serverModels}
                    totalMatched={totalMatched}
                    hasMore={Boolean(recordsQuery.hasNextPage)}
                    isLoadingMore={recordsQuery.isFetchingNextPage}
                    isFetchingRecords={recordsQuery.isFetching}
                    onLoadMore={handleLoadMore}
                    statusFilter={statusFilter}
                    onChangeStatusFilter={setStatusFilter}
                    projectFilter={projectFilter}
                    onChangeProjectFilter={setProjectFilter}
                    modelFilter={modelFilter}
                    onChangeModelFilter={setModelFilter}
                    searchQuery={searchQuery}
                    onChangeSearchQuery={setSearchQuery}
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
                    onOpenLightbox={handleOpenLightbox}
                    onUseGeneratedAsRef={handleUseGeneratedAsRef}
                    onReuseRecord={handleReuseRecord}
                    onRetryRecord={handleRetryRecord}
                    onDownloadMissingLocal={handleDownloadMissingLocal}
                    onDeleteSingle={handleDeleteSingle}
                    onBatchDelete={handleBatchDelete}
                    onClearFailed={handleClearFailed}
                    onOpenImportTask={handleOpenImportTask}
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
                serverCounts={serverCounts}
                serverModels={serverModels}
                totalMatched={totalMatched}
                hasMore={Boolean(recordsQuery.hasNextPage)}
                isLoadingMore={recordsQuery.isFetchingNextPage}
                isFetchingRecords={recordsQuery.isFetching}
                onLoadMore={handleLoadMore}
                statusFilter={statusFilter}
                onChangeStatusFilter={setStatusFilter}
                projectFilter={projectFilter}
                onChangeProjectFilter={setProjectFilter}
                modelFilter={modelFilter}
                onChangeModelFilter={setModelFilter}
                searchQuery={searchQuery}
                onChangeSearchQuery={setSearchQuery}
                projects={projects}
                onCreateProject={handleCreateProject}
                onDeleteProject={handleDeleteProject}
                onAssignProject={handleAssignProject}
                onBatchStar={handleBatchStar}
                refreshingIds={refreshingIds}
                onRefreshAll={handleRefreshAllToast}
                onRefreshSingle={handleRefreshSingle}
                onCancelPolling={handleCancelPolling}
                onToggleStar={handleToggleStar}
                onOpenLightbox={handleOpenLightbox}
                onUseGeneratedAsRef={handleUseGeneratedAsRef}
                onReuseRecord={handleReuseRecord}
                onRetryRecord={handleRetryRecord}
                onDownloadMissingLocal={handleDownloadMissingLocal}
                onDeleteSingle={handleDeleteSingle}
                onBatchDelete={handleBatchDelete}
                onClearFailed={handleClearFailed}
                onOpenImportTask={handleOpenImportTask}
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
              onUpdateDiskStats={setDiskStatsOverride}
              onRefreshSingle={handleRefreshSingle}
              onCancelPolling={handleCancelPolling}
              onClearFailed={handleClearFailed}
              onOpenLocalFolder={() => void handleOpenLocalFolder()}
              onOpenLogs={() => setLogsOpen(true)}
              onQuickCopyLogs={() => void handleQuickCopyLogs()}
              onCopyText={copyText}
              onToast={showToast}
            />
          )}
        </main>

        {/* Modals & Cinema Darkroom Lightbox */}
        <SettingsDialog
          open={settingsOpen}
          onOpenChange={setSettingsOpen}
          initialTab={settingsTab}
          config={config}
          imageHosts={imageHosts}
          diskStats={diskStats}
          onSaveConfig={(p) => handleSaveConfig(p, false)}
          onOpenLocalFolder={() => void handleOpenLocalFolder()}
          onOpenLogs={() => setLogsOpen(true)}
          onOpenLogsFolder={() => void handleOpenLocalFolder(undefined, "logs")}
          onCopyText={copyText}
        />

        <LogsDialog
          open={logsOpen}
          onOpenChange={setLogsOpen}
          onOpenLogsFolder={() => void handleOpenLocalFolder(undefined, "logs")}
          onCopyText={copyText}
          onToast={showToast}
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
          promptRevision={promptRevision}
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
          onOpenLogs={() => setLogsOpen(true)}
          onOpenLocalFolder={() => void handleOpenLocalFolder()}
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
          onOpenLocalFolder={(f) => void handleOpenLocalFolder(f)}
          onCopyText={copyText}
          onToast={showToast}
        />

        {/* Minimalist Frosted Apple Capsule Toasts */}
        <div
          id="toast-container"
          className="fixed bottom-20 md:bottom-6 right-5 z-50 flex flex-col items-end gap-2 max-w-sm pointer-events-none"
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
              className="studio-floating-popover pointer-events-auto flex items-center gap-2.5 rounded-full px-4 py-2.5 text-xs font-medium text-foreground"
            >
              {t.type === "success" && (
                <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500 shrink-0" />
              )}
              {t.type === "error" && (
                <AlertCircle className="h-3.5 w-3.5 text-red-500 shrink-0" />
              )}
              {t.type === "info" && (
                <Info className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
              )}
              <span className="leading-snug">{t.message}</span>
            </div>
          ))}
        </div>
      </div>
    </TooltipProvider>
  )
}

export default App
