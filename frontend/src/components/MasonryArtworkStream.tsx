import React, {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react"
import {
  AlertCircle,
  AlertTriangle,
  Archive,
  CheckSquare,
  Columns2,
  Copy,
  Download,
  FolderKanban,
  FolderPlus,
  Grid2X2,
  Image as ImageIcon,
  ImagePlus,
  LayoutGrid,
  LayoutList,
  Loader2,
  Maximize2,
  Plus,
  RefreshCw,
  RotateCcw,
  Search,
  Square,
  Star,
  Trash2,
  X,
} from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import {
  Flip,
  gsap,
  prefersReducedMotion,
  STUDIO_EASE,
  useGSAP,
} from "@/lib/motion"
import {
  computeRecordAspectRatio,
  formatDurationSeconds,
  formatStateLabel,
  formatUnixTime,
  groupRecordsByDateBucket,
  PROJECT_COLOR_MAP,
} from "@/lib/studio-utils"
import { cn } from "@/lib/utils"
import type { ProjectFolder, SavedImage, TaskRecord } from "@/types"

export type StreamDisplayMode = "masonry" | "showcase" | "list"

function parseAspectHeightOverWidth(aspectStr: string): number {
  const parts = aspectStr.split("/")
  if (parts.length === 2) {
    const w = parseFloat(parts[0])
    const h = parseFloat(parts[1])
    if (w > 0 && h > 0) return h / w
  }
  return 1
}

function estimateNormalizedCardHeight(
  rec: TaskRecord,
  displayMode: StreamDisplayMode
): number {
  const images = rec.images || []
  const isSucceeded = rec.state === "succeeded" && images.length > 0
  let hRatio = parseAspectHeightOverWidth(computeRecordAspectRatio(rec))

  if (isSucceeded) {
    if (images.length > 1) {
      const rows = Math.ceil(images.length / 2)
      const first = images[0]
      const cellRatio =
        first?.width && first?.height && first.width > 0 && first.height > 0
          ? first.height / first.width
          : hRatio
      hRatio = rows * 0.5 * cellRatio
    } else if (
      images[0]?.width &&
      images[0]?.height &&
      images[0].width > 0 &&
      images[0].height > 0
    ) {
      hRatio = images[0].height / images[0].width
    }
  } else {
    hRatio = Math.max(0.62, hRatio)
  }

  const clamped = Math.max(0.45, Math.min(2.4, hRatio))
  const captionExtra = displayMode === "showcase" ? 0.28 : 0
  return clamped + captionExtra + 0.06
}

/**
 * Distributes newest-first records horizontally across columns (left-to-right
 * across Row 1 first, then always into the highest available column with
 * strict left-to-right tie-breaking) so new batches never pile up on the left.
 */
function distributeIntoHorizontalColumns(
  items: TaskRecord[],
  colCount: number,
  displayMode: StreamDisplayMode
): TaskRecord[][] {
  const safeCols = Math.max(1, colCount)
  if (safeCols === 1) return [items]

  const columns: TaskRecord[][] = Array.from({ length: safeCols }, () => [])
  const colHeights = new Array<number>(safeCols).fill(0)

  for (const rec of items) {
    let bestCol = 0
    let minH = colHeights[0]
    for (let c = 1; c < safeCols; c++) {
      if (colHeights[c] < minH - 0.02) {
        minH = colHeights[c]
        bestCol = c
      }
    }
    columns[bestCol].push(rec)
    colHeights[bestCol] += estimateNormalizedCardHeight(rec, displayMode)
  }

  return columns
}

/**
 * Calm Apple-grade image settle when an artwork finishes loading.
 */
const ArtworkImageReveal: React.FC<
  React.ImgHTMLAttributes<HTMLImageElement>
> = ({ className, onLoad, ...props }) => {
  const imgRef = useRef<HTMLImageElement | null>(null)
  const alreadyCachedRef = useRef<boolean>(false)
  const revealedRef = useRef<boolean>(false)

  const { contextSafe } = useGSAP(
    () => {
      const el = imgRef.current
      if (!el) return
      alreadyCachedRef.current = false
      revealedRef.current = false
      if (el.complete && el.naturalWidth > 0) {
        alreadyCachedRef.current = true
        revealedRef.current = true
      } else if (!prefersReducedMotion()) {
        gsap.set(el, { autoAlpha: 0 })
      }
    },
    { scope: imgRef, dependencies: [props.src] }
  )

  const animateLoadedImage = contextSafe(
    (el: HTMLImageElement, isCached: boolean) => {
      if (prefersReducedMotion() || isCached) {
        gsap.set(el, { clearProps: "opacity,visibility,transform" })
        return
      }
      gsap.fromTo(
        el,
        { autoAlpha: 0, scale: 1.016 },
        {
          autoAlpha: 1,
          scale: 1,
          duration: 0.48,
          ease: STUDIO_EASE.out,
          clearProps: "transform,visibility",
        }
      )
    }
  )

  const handleLoad = (e: React.SyntheticEvent<HTMLImageElement>) => {
    onLoad?.(e)
    if (revealedRef.current) return
    revealedRef.current = true
    animateLoadedImage(e.currentTarget, alreadyCachedRef.current)
  }

  return (
    <img
      ref={imgRef}
      loading="lazy"
      onLoad={handleLoad}
      className={className}
      {...props}
    />
  )
}

interface MasonryArtworkStreamProps {
  mode: "imagine" | "gallery"
  embeddedScroll?: boolean
  onSelectModeChange?: (selecting: boolean) => void

  records: TaskRecord[]
  projects: ProjectFolder[]
  onCreateProject: (name: string, color: string) => void
  onDeleteProject: (id: string) => void
  onAssignProject: (ids: string[], projectId: string) => void
  onBatchStar: (ids: string[], starred: boolean) => void

  refreshingIds: Record<string, boolean>
  onRefreshAll: () => void
  onRefreshSingle: (id: string) => void
  onCancelPolling: (id: string) => void
  onToggleStar: (rec: TaskRecord) => void
  onOpenLightbox: (
    rec: TaskRecord,
    imgIdx: number,
    openCompare?: boolean
  ) => void
  onUseGeneratedAsRef: (img: SavedImage, rec: TaskRecord) => void
  onReuseRecord: (rec: TaskRecord, includeRefs: boolean) => void
  onRetryRecord: (rec: TaskRecord) => void
  onDownloadMissingLocal: (rec: TaskRecord) => void
  onDeleteSingle: (rec: TaskRecord) => void
  onBatchDelete: (ids: string[]) => void
  onClearFailed: () => void
  onOpenImportTask: () => void
  onCopyText: (text: string, msg?: string) => void
}

export const MasonryArtworkStream: React.FC<MasonryArtworkStreamProps> = ({
  mode,
  embeddedScroll = true,
  onSelectModeChange,
  records,
  projects,
  onCreateProject,
  onDeleteProject,
  onAssignProject,
  onBatchStar,
  refreshingIds,
  onRefreshAll,
  onRefreshSingle,
  onCancelPolling,
  onToggleStar,
  onOpenLightbox,
  onUseGeneratedAsRef,
  onReuseRecord,
  onRetryRecord,
  onDownloadMissingLocal,
  onDeleteSingle,
  onBatchDelete,
  onClearFailed,
  onOpenImportTask,
  onCopyText,
}) => {
  const [statusFilter, setStatusFilter] = useState<string>("all")
  const [projectFilter, setProjectFilter] = useState<string>("all")
  const [modelFilter, setModelFilter] = useState<string>("all")
  const [searchQuery, setSearchQuery] = useState<string>("")

  const [displayMode, setDisplayMode] = useState<StreamDisplayMode>(() => {
    const saved = localStorage.getItem("duomi_stream_mode") as StreamDisplayMode
    return saved || "masonry"
  })
  const [columnCount, setColumnCount] = useState<number>(() => {
    const saved = Number(localStorage.getItem("duomi_masonry_cols"))
    return saved >= 2 && saved <= 6 ? saved : 4
  })
  const [groupByDate, setGroupByDate] = useState<boolean>(true)

  const [selectMode, setSelectMode] = useState<boolean>(false)
  const [selectedIds, setSelectedIds] = useState<Record<string, boolean>>({})
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null)
  const [confirmBatchDelete, setConfirmBatchDelete] = useState<boolean>(false)
  const [confirmClearFailed, setConfirmClearFailed] = useState<boolean>(false)

  const [newProjOpen, setNewProjOpen] = useState(false)
  const [newProjName, setNewProjName] = useState("")
  const [newProjColor, setNewProjColor] = useState("amber")

  const [nowSec, setNowSec] = useState<number>(() =>
    Math.floor(Date.now() / 1000)
  )

  const streamRootRef = useRef<HTMLDivElement | null>(null)
  const streamBodyRef = useRef<HTMLDivElement | null>(null)
  const statusPillRef = useRef<HTMLDivElement | null>(null)
  const statusBtnRefs = useRef<Record<string, HTMLButtonElement | null>>({})
  const statusPillInitRef = useRef<boolean>(false)
  const batchDockRef = useRef<HTMLDivElement | null>(null)
  const seenCardIdsRef = useRef<Set<string>>(new Set())
  const filterChangeInitRef = useRef<boolean>(false)
  const pendingFlipRef = useRef<Flip.FlipState | null>(null)

  useEffect(() => {
    onSelectModeChange?.(selectMode)
  }, [selectMode, onSelectModeChange])

  useEffect(() => {
    return () => {
      onSelectModeChange?.(false)
    }
  }, [onSelectModeChange])

  const { contextSafe } = useGSAP({ scope: streamRootRef })

  const sortNodesVisualOrder = (nodes: HTMLElement[]): HTMLElement[] => {
    if (nodes.length <= 1) return nodes
    const rects = new Map<HTMLElement, { top: number; left: number }>()
    for (const n of nodes) {
      const r = n.getBoundingClientRect()
      rects.set(n, { top: r.top, left: r.left })
    }
    return [...nodes].sort((a, b) => {
      const ra = rects.get(a)!
      const rb = rects.get(b)!
      if (Math.abs(ra.top - rb.top) > 24) return ra.top - rb.top
      return ra.left - rb.left
    })
  }

  const captureStreamFlip = () => {
    if (prefersReducedMotion() || !streamBodyRef.current) return
    const allCards = gsap.utils.toArray<HTMLElement>(
      ".artwork-card-anim",
      streamBodyRef.current
    )
    const visibleCards = sortNodesVisualOrder(allCards).slice(0, 28)
    if (visibleCards.length > 0) {
      pendingFlipRef.current = Flip.getState(visibleCards)
    }
  }

  const animateStarPop = contextSafe((btn: HTMLElement) => {
    if (prefersReducedMotion()) return
    gsap.fromTo(
      btn,
      { scale: 1.15 },
      {
        scale: 1,
        duration: 0.28,
        ease: STUDIO_EASE.out,
        clearProps: "transform",
      }
    )
  })

  useEffect(() => {
    localStorage.setItem("duomi_stream_mode", displayMode)
  }, [displayMode])

  useEffect(() => {
    localStorage.setItem("duomi_masonry_cols", String(columnCount))
  }, [columnCount])

  const hasActive = useMemo(
    () => records.some((r) => r.state === "pending" || r.state === "running"),
    [records]
  )

  useEffect(() => {
    if (!hasActive) return
    const timer = setInterval(() => {
      setNowSec(Math.floor(Date.now() / 1000))
    }, 1000)
    return () => clearInterval(timer)
  }, [hasActive])

  const distinctModels = useMemo(() => {
    const set = new Set<string>()
    for (const r of records) {
      if (r.model) set.add(r.model)
    }
    return Array.from(set)
  }, [records])

  const counts = useMemo(() => {
    let active = 0
    let succeeded = 0
    let starred = 0
    let withRefs = 0
    let failed = 0
    const byProject: Record<string, number> = {}
    for (const r of records) {
      if (r.state === "pending" || r.state === "running") active++
      else if (r.state === "succeeded") succeeded++
      else failed++
      if (r.starred) starred++
      if (r.ref_count > 0) withRefs++
      if (r.project_id) {
        byProject[r.project_id] = (byProject[r.project_id] || 0) + 1
      }
    }
    return {
      all: records.length,
      active,
      succeeded,
      starred,
      withRefs,
      failed,
      byProject,
    }
  }, [records])

  const projectMap = useMemo(() => {
    const map: Record<string, ProjectFolder> = {}
    for (const p of projects) map[p.id] = p
    return map
  }, [projects])

  const filteredRecords = useMemo(() => {
    const q = searchQuery.trim().toLowerCase()
    return records.filter((r) => {
      if (
        statusFilter === "active" &&
        r.state !== "pending" &&
        r.state !== "running"
      ) {
        return false
      }
      if (statusFilter === "succeeded" && r.state !== "succeeded") return false
      if (statusFilter === "starred" && !r.starred) return false
      if (statusFilter === "with_refs" && !(r.ref_count > 0)) return false
      if (
        statusFilter === "failed" &&
        r.state !== "error" &&
        r.state !== "failed" &&
        r.state !== "timeout" &&
        r.state !== "canceled"
      ) {
        return false
      }
      if (projectFilter === "unassigned" && r.project_id) return false
      if (
        projectFilter !== "all" &&
        projectFilter !== "unassigned" &&
        r.project_id !== projectFilter
      ) {
        return false
      }
      if (modelFilter !== "all" && r.model !== modelFilter) return false
      if (q) {
        const hay = `${r.id} ${r.model} ${r.prompt} ${r.size || ""} ${(
          r.tags || []
        ).join(" ")}`.toLowerCase()
        return hay.includes(q)
      }
      return true
    })
  }, [records, statusFilter, projectFilter, modelFilter, searchQuery])

  const dateGroups = useMemo(
    () =>
      groupByDate
        ? groupRecordsByDateBucket(filteredRecords)
        : [{ label: "全部", items: filteredRecords }],
    [filteredRecords, groupByDate]
  )

  const selectedIdList = useMemo(
    () => Object.keys(selectedIds).filter((id) => selectedIds[id]),
    [selectedIds]
  )

  const toggleSelect = (id: string) => {
    setSelectedIds((prev) => ({ ...prev, [id]: !prev[id] }))
  }

  const clearSelection = () => {
    setSelectedIds({})
    setConfirmBatchDelete(false)
  }

  // 1. Liquid Apple Segmented Pill glide for status filter
  useGSAP(
    () => {
      const pill = statusPillRef.current
      if (!pill) return
      const activeBtn = statusBtnRefs.current[statusFilter]
      if (!activeBtn || activeBtn.offsetWidth === 0) {
        gsap.to(pill, { autoAlpha: 0, duration: 0.16, overwrite: "auto" })
        return
      }
      const targetX = activeBtn.offsetLeft
      const targetW = activeBtn.offsetWidth

      if (!statusPillInitRef.current || prefersReducedMotion()) {
        statusPillInitRef.current = true
        gsap.set(pill, { x: targetX, width: targetW, autoAlpha: 1 })
        return
      }
      gsap.to(pill, {
        x: targetX,
        width: targetW,
        autoAlpha: 1,
        duration: 0.34,
        ease: STUDIO_EASE.expo,
        overwrite: "auto",
      })
    },
    {
      scope: streamRootRef,
      dependencies: [
        statusFilter,
        counts.all,
        counts.active,
        counts.succeeded,
        counts.starred,
        counts.failed,
      ],
    }
  )

  // 2. Floating Batch Action Dock calm entrance
  useGSAP(
    () => {
      if (!selectMode || !batchDockRef.current || prefersReducedMotion()) return
      gsap.fromTo(
        batchDockRef.current,
        { autoAlpha: 0, y: 14, scale: 0.97 },
        {
          autoAlpha: 1,
          y: 0,
          scale: 1,
          duration: 0.32,
          ease: STUDIO_EASE.expo,
          clearProps: "transform,visibility",
        }
      )
    },
    { scope: streamRootRef, dependencies: [selectMode] }
  )

  // 4. Genuine Flip.getState() -> Flip.from() layout choreography
  useGSAP(
    () => {
      if (!filterChangeInitRef.current) {
        filterChangeInitRef.current = true
        return
      }
      const container = streamBodyRef.current
      const flipState = pendingFlipRef.current
      pendingFlipRef.current = null
      if (!container || prefersReducedMotion()) return

      const allCards = gsap.utils.toArray<HTMLElement>(
        ".artwork-card-anim",
        container
      )
      for (const node of allCards) {
        const id = node.dataset.recordId
        if (id) seenCardIdsRef.current.add(id)
      }

      const visibleCards = sortNodesVisualOrder(allCards).slice(0, 28)
      if (visibleCards.length === 0) return

      if (flipState) {
        Flip.from(flipState, {
          targets: visibleCards,
          duration: 0.38,
          ease: STUDIO_EASE.expo,
          simple: true,
          scale: false,
          stagger: { each: 0.01, amount: 0.12 },
          onEnter: (elements) =>
            gsap.fromTo(
              elements,
              { autoAlpha: 0, y: 8, scale: 0.985 },
              {
                autoAlpha: 1,
                y: 0,
                scale: 1,
                duration: 0.3,
                stagger: 0.014,
                ease: STUDIO_EASE.out,
                clearProps: "transform,opacity,visibility",
              }
            ),
          clearProps: "transform",
        })
        return
      }

      gsap.fromTo(
        visibleCards.slice(0, 20),
        { autoAlpha: 0.65, y: 5 },
        {
          autoAlpha: 1,
          y: 0,
          scale: 1,
          duration: 0.26,
          stagger: { each: 0.012, amount: 0.12 },
          ease: STUDIO_EASE.out,
          overwrite: "auto",
          clearProps: "transform,opacity,visibility",
        }
      )
    },
    {
      scope: streamRootRef,
      dependencies: [
        statusFilter,
        projectFilter,
        modelFilter,
        displayMode,
        columnCount,
        groupByDate,
      ],
    }
  )

  // 5. Calm staggered reveal for newly mounted cards
  useGSAP(
    () => {
      const container = streamBodyRef.current
      if (!container) return
      const cardNodes = gsap.utils.toArray<HTMLElement>(
        ".artwork-card-anim",
        container
      )
      const freshNodes: HTMLElement[] = []
      for (const node of cardNodes) {
        const id = node.dataset.recordId
        if (id && !seenCardIdsRef.current.has(id)) {
          seenCardIdsRef.current.add(id)
          freshNodes.push(node)
        }
      }
      if (freshNodes.length === 0 || prefersReducedMotion()) return
      const animatedSlice = sortNodesVisualOrder(freshNodes).slice(0, 24)
      gsap.fromTo(
        animatedSlice,
        { autoAlpha: 0, y: 10, scale: 0.99 },
        {
          autoAlpha: 1,
          y: 0,
          scale: 1,
          duration: 0.36,
          stagger: { each: 0.02, amount: 0.2 },
          ease: STUDIO_EASE.out,
          clearProps: "transform,opacity,visibility",
        }
      )
    },
    { scope: streamRootRef, dependencies: [filteredRecords] }
  )

  const [containerWidth, setContainerWidth] = useState<number>(() =>
    typeof window !== "undefined"
      ? Math.min(Math.max(window.innerWidth - 64, 320), 1520)
      : 1280
  )

  useLayoutEffect(() => {
    const el = streamBodyRef.current
    if (!el) return
    const syncWidth = () => {
      const w = el.clientWidth
      if (w > 0) {
        setContainerWidth((prev) => (Math.abs(prev - w) >= 4 ? w : prev))
      }
    }
    syncWidth()
    if (typeof ResizeObserver === "undefined") return
    const ro = new ResizeObserver(() => syncWidth())
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  const effectiveCols = useMemo(() => {
    if (containerWidth < 520) return 1
    if (containerWidth < 800) return Math.min(columnCount, 2)
    if (containerWidth < 1060) return Math.min(columnCount, 3)
    if (containerWidth < 1320) return Math.min(columnCount, 4)
    return columnCount
  }, [containerWidth, columnCount])

  const renderRecordCard = (rec: TaskRecord) => {
    const images = rec.images || []
    const isPending = rec.state === "pending" || rec.state === "running"
    const isSucceeded = rec.state === "succeeded" && images.length > 0
    const isFailed =
      rec.state === "error" ||
      rec.state === "failed" ||
      rec.state === "timeout" ||
      rec.state === "canceled"
    const isRefreshing = !!refreshingIds[rec.id]
    const isChecked = !!selectedIds[rec.id]
    const aspectRatio = computeRecordAspectRatio(rec)
    const proj = rec.project_id ? projectMap[rec.project_id] : undefined
    const pct = Math.max(
      14,
      rec.progress || (rec.state === "running" ? 56 : 22)
    )
    const elapsedSec = isPending
      ? Math.max(1, nowSec - (rec.create_time || nowSec))
      : rec.duration_ms
      ? Math.round(rec.duration_ms / 1000)
      : 0

    const hasRefCompare = Boolean(
      rec.ref_items?.some((ri) => ri.local_ref || ri.remote_url)
    )
    const missingLocal =
      isSucceeded && images.some((i) => !i.local_file && i.remote_url)

    // LIST INSPECTOR MODE (Borderless Apple Surface)
    if (displayMode === "list") {
      return (
        <div
          key={rec.id}
          data-record-id={rec.id}
          data-flip-id={rec.id}
          onClick={selectMode ? () => toggleSelect(rec.id) : undefined}
          className={cn(
            "artwork-card-anim apple-surface isolate group flex flex-col sm:flex-row gap-4 rounded-3xl p-4 transition-all duration-200",
            selectMode && "cursor-pointer",
            isChecked && "ring-2 ring-primary"
          )}
        >
          <div className="relative h-44 sm:h-36 sm:w-52 shrink-0 overflow-hidden rounded-2xl bg-foreground/[0.035] flex items-center justify-center">
            {isSucceeded ? (
              <ArtworkImageReveal
                src={
                  images[0].local_file
                    ? `/images/${encodeURIComponent(images[0].local_file)}`
                    : images[0].remote_url
                }
                alt={rec.prompt}
                onClick={(e) => {
                  if (selectMode) return
                  e.stopPropagation()
                  onOpenLightbox(rec, 0)
                }}
                className={cn(
                  "h-full w-full object-contain cursor-zoom-in",
                  rec.background === "transparent" && "bg-checkerboard"
                )}
              />
            ) : isPending ? (
              <div className="developing-canvas flex h-full w-full flex-col items-center justify-center p-3 text-center">
                <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                <span className="mt-1.5 text-[11px] font-medium text-foreground">
                  {formatStateLabel(rec.state, rec.progress)}
                </span>
                <span className="font-mono text-[10px] text-muted-foreground">
                  {formatDurationSeconds(elapsedSec)}
                </span>
              </div>
            ) : (
              <div className="flex flex-col items-center justify-center p-3 text-center">
                <AlertCircle className="h-4 w-4 text-destructive" />
                <span className="mt-1 text-[11px] text-destructive">
                  {formatStateLabel(rec.state)}
                </span>
              </div>
            )}
          </div>

          <div className="flex flex-1 flex-col justify-between min-w-0 py-0.5">
            <div className="space-y-1.5">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-1.5 flex-wrap">
                  <Badge
                    variant={
                      isSucceeded
                        ? "success"
                        : isPending
                        ? "warning"
                        : "destructive"
                    }
                    className="text-[10px]"
                  >
                    {formatStateLabel(rec.state, rec.progress)}
                  </Badge>
                  <Badge variant="secondary" className="font-mono text-[10px]">
                    {rec.model}
                  </Badge>
                  {rec.size && (
                    <Badge variant="outline" className="font-mono text-[10px]">
                      {rec.size}
                    </Badge>
                  )}
                  {proj && (
                    <Badge variant="secondary" className="gap-1.5 text-[10px]">
                      <span
                        className={cn(
                          "h-1.5 w-1.5 rounded-full",
                          PROJECT_COLOR_MAP[proj.color || "amber"]?.dot
                        )}
                      />
                      {proj.name}
                    </Badge>
                  )}
                </div>
                <span className="font-mono text-[11px] text-muted-foreground">
                  {formatUnixTime(rec.create_time)}
                </span>
              </div>

              <p className="text-xs text-foreground leading-relaxed line-clamp-3">
                {rec.prompt}
              </p>
              {rec.error_msg && (
                <p className="text-[11px] text-destructive">{rec.error_msg}</p>
              )}
            </div>

            <div className="flex items-center justify-between pt-3 mt-1">
              <div className="flex items-center gap-1.5 flex-wrap">
                {isSucceeded && (
                  <>
                    <Button
                      type="button"
                      variant="secondary"
                      size="xs"
                      onClick={() => onOpenLightbox(rec, 0)}
                    >
                      <Maximize2 className="h-3 w-3" />
                      检视
                    </Button>
                    {hasRefCompare && (
                      <Button
                        type="button"
                        variant="outline"
                        size="xs"
                        onClick={() => onOpenLightbox(rec, 0, true)}
                      >
                        <Columns2 className="h-3 w-3" />
                        对比
                      </Button>
                    )}
                    <Button
                      type="button"
                      variant="ghost"
                      size="xs"
                      onClick={() => onUseGeneratedAsRef(images[0], rec)}
                    >
                      <ImagePlus className="h-3 w-3" />
                      设为参考
                    </Button>
                  </>
                )}
                <Button
                  type="button"
                  variant="ghost"
                  size="xs"
                  onClick={() => onReuseRecord(rec, true)}
                >
                  <RotateCcw className="h-3 w-3" />
                  复用
                </Button>
                {isFailed && (
                  <Button
                    type="button"
                    variant="secondary"
                    size="xs"
                    onClick={() => onRetryRecord(rec)}
                  >
                    重试
                  </Button>
                )}
              </div>

              <div className="flex items-center gap-1">
                <button
                  type="button"
                  onClick={(e) => {
                    animateStarPop(e.currentTarget)
                    onToggleStar(rec)
                  }}
                  className={cn(
                    "p-1.5 rounded-full transition-colors cursor-pointer",
                    rec.starred
                      ? "text-amber-400"
                      : "text-muted-foreground hover:text-foreground"
                  )}
                >
                  <Star
                    className={cn("h-4 w-4", rec.starred && "fill-amber-400")}
                  />
                </button>
                <button
                  type="button"
                  onClick={() => onDeleteSingle(rec)}
                  className="p-1.5 rounded-full text-muted-foreground hover:text-destructive transition-colors cursor-pointer"
                  title="删除"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
            </div>
          </div>
        </div>
      )
    }

    // MASONRY (Pure Borderless Art Frame) & SHOWCASE (Apple Tonal Surface)
    return (
      <article
        key={rec.id}
        data-record-id={rec.id}
        data-flip-id={rec.id}
        onClick={selectMode ? () => toggleSelect(rec.id) : undefined}
        className={cn(
          "artwork-card-anim group relative isolate overflow-hidden rounded-2xl transition-shadow duration-300",
          displayMode === "masonry"
            ? "bg-foreground/[0.03] hover:shadow-[0_16px_40px_-12px_rgba(0,0,0,0.16)] dark:hover:shadow-[0_20px_48px_-12px_rgba(0,0,0,0.55)]"
            : "apple-surface",
          selectMode && "cursor-pointer",
          isChecked && "ring-2 ring-primary"
        )}
      >
        <div
          style={!isSucceeded ? { aspectRatio } : undefined}
          className={cn(
            "relative w-full overflow-hidden",
            rec.background === "transparent" && isSucceeded
              ? "bg-checkerboard"
              : "bg-foreground/[0.03]"
          )}
        >
          {/* Quiet Floating Top Badges */}
          <div
            onClick={(e) => e.stopPropagation()}
            className="pointer-events-none absolute inset-x-3 top-3 z-10 flex items-start justify-between gap-2"
          >
            <div className="pointer-events-auto flex items-center gap-1.5">
              {(selectMode || isChecked) && (
                <button
                  type="button"
                  onClick={() => toggleSelect(rec.id)}
                  className="flex h-7 w-7 items-center justify-center rounded-full bg-black/60 text-white backdrop-blur-xl cursor-pointer"
                >
                  {isChecked ? (
                    <CheckSquare className="h-3.5 w-3.5 text-white" />
                  ) : (
                    <Square className="h-3.5 w-3.5 text-white/80" />
                  )}
                </button>
              )}

              {proj && (
                <span className="inline-flex items-center gap-1.5 rounded-full bg-black/55 px-2.5 py-0.5 text-[10px] font-medium text-white backdrop-blur-xl">
                  <span
                    className={cn(
                      "h-1.5 w-1.5 rounded-full",
                      PROJECT_COLOR_MAP[proj.color || "amber"]?.dot
                    )}
                  />
                  {proj.name}
                </span>
              )}

              {rec.ref_items && rec.ref_items.length > 0 && (
                <div
                  className="hidden sm:flex items-center -space-x-1.5 rounded-full bg-black/50 p-0.5 pr-2 backdrop-blur-xl opacity-0 group-hover:opacity-100 transition-opacity duration-200"
                  title={`${rec.ref_items.length} 张参考图`}
                >
                  {rec.ref_items.slice(0, 3).map((ri, rIdx) => {
                    const rSrc = ri.local_ref
                      ? `/images/${ri.local_ref}`
                      : ri.remote_url
                    if (!rSrc) return null
                    return (
                      <img
                        key={rIdx}
                        src={rSrc}
                        alt=""
                        className="h-5 w-5 rounded-full border border-white/25 object-cover"
                      />
                    )
                  })}
                  <span className="pl-2 text-[9px] text-white/90">参考</span>
                </div>
              )}
            </div>

            {!selectMode && (
              <div className="pointer-events-auto flex items-center gap-1">
                <button
                  type="button"
                  onClick={(e) => {
                    animateStarPop(e.currentTarget)
                    onToggleStar(rec)
                  }}
                  className={cn(
                    "flex h-7 w-7 items-center justify-center rounded-full backdrop-blur-xl transition-opacity duration-200 cursor-pointer",
                    rec.starred
                      ? "bg-black/60 text-amber-400 opacity-100"
                      : "bg-black/45 text-white/85 opacity-0 group-hover:opacity-100 hover:text-amber-400"
                  )}
                  title={rec.starred ? "取消收藏" : "收藏"}
                >
                  <Star
                    className={cn("h-3.5 w-3.5", rec.starred && "fill-amber-400")}
                  />
                </button>
              </div>
            )}
          </div>

          {isSucceeded ? (
            <div
              className={cn(
                "w-full",
                images.length > 1 ? "grid grid-cols-2 gap-0.5" : "block"
              )}
            >
              {images.map((img, idx) => {
                const src = img.local_file
                  ? `/images/${encodeURIComponent(img.local_file)}`
                  : img.remote_url
                const dlHref = img.local_file
                  ? `/images/${encodeURIComponent(img.local_file)}?download=1`
                  : img.remote_url

                return (
                  <div key={idx} className="relative w-full overflow-hidden">
                    <ArtworkImageReveal
                      src={src}
                      alt={rec.prompt}
                      onClick={(e) => {
                        if (selectMode) return
                        e.stopPropagation()
                        onOpenLightbox(rec, idx)
                      }}
                      className="block w-full h-auto transition-transform duration-700 ease-out group-hover:scale-[1.015] cursor-zoom-in"
                    />

                    {/* Subtle Frosted Hover Actions */}
                    {!selectMode && (
                      <div
                        onClick={(e) => e.stopPropagation()}
                        className="pointer-events-none absolute inset-x-0 bottom-0 flex flex-col justify-end bg-gradient-to-t from-black/80 via-black/35 to-transparent p-3.5 pt-14 opacity-0 transition-opacity duration-250 group-hover:opacity-100"
                      >
                        {displayMode === "masonry" && (
                          <div className="mb-2.5 space-y-0.5">
                            <p className="text-[11px] text-white/95 line-clamp-2 leading-snug">
                              {rec.prompt}
                            </p>
                            <div className="flex items-center gap-1.5 font-mono text-[10px] text-white/65">
                              <span>{rec.model.replace("gpt-image-", "")}</span>
                              {img.width && img.height && (
                                <>
                                  <span>·</span>
                                  <span>
                                    {img.width}×{img.height}
                                  </span>
                                </>
                              )}
                            </div>
                          </div>
                        )}

                        <div className="pointer-events-auto flex items-center justify-between gap-1">
                          <div className="flex items-center gap-1">
                            <button
                              type="button"
                              onClick={() => onOpenLightbox(rec, idx)}
                              className="inline-flex h-7 items-center gap-1 rounded-full bg-white/18 hover:bg-white/28 backdrop-blur-xl px-2.5 text-[11px] font-medium text-white transition-colors cursor-pointer"
                            >
                              <Maximize2 className="h-3 w-3" />
                              <span>检视</span>
                            </button>

                            {hasRefCompare && (
                              <button
                                type="button"
                                onClick={() => onOpenLightbox(rec, idx, true)}
                                className="inline-flex h-7 items-center gap-1 rounded-full bg-white/18 hover:bg-white/28 backdrop-blur-xl px-2.5 text-[11px] font-medium text-white transition-colors cursor-pointer"
                              >
                                <Columns2 className="h-3 w-3" />
                                <span>对比</span>
                              </button>
                            )}

                            <Tooltip>
                              <TooltipTrigger asChild>
                                <button
                                  type="button"
                                  onClick={() => onUseGeneratedAsRef(img, rec)}
                                  className="inline-flex h-7 w-7 items-center justify-center rounded-full bg-white/18 hover:bg-white/28 backdrop-blur-xl text-white transition-colors cursor-pointer"
                                >
                                  <ImagePlus className="h-3.5 w-3.5" />
                                </button>
                              </TooltipTrigger>
                              <TooltipContent>设为参考图</TooltipContent>
                            </Tooltip>

                            <Tooltip>
                              <TooltipTrigger asChild>
                                <button
                                  type="button"
                                  onClick={() => onReuseRecord(rec, true)}
                                  className="inline-flex h-7 w-7 items-center justify-center rounded-full bg-white/18 hover:bg-white/28 backdrop-blur-xl text-white transition-colors cursor-pointer"
                                >
                                  <RotateCcw className="h-3.5 w-3.5" />
                                </button>
                              </TooltipTrigger>
                              <TooltipContent>复用参数与提示词</TooltipContent>
                            </Tooltip>
                          </div>

                          <div className="flex items-center gap-1">
                            {confirmDeleteId === rec.id ? (
                              <button
                                type="button"
                                onClick={() => {
                                  onDeleteSingle(rec)
                                  setConfirmDeleteId(null)
                                }}
                                className="rounded-full bg-destructive px-2.5 py-1 text-[10px] font-medium text-white cursor-pointer"
                              >
                                确认
                              </button>
                            ) : (
                              <button
                                type="button"
                                onClick={() => setConfirmDeleteId(rec.id)}
                                className="inline-flex h-7 w-7 items-center justify-center rounded-full bg-black/45 hover:bg-destructive text-white/80 hover:text-white transition-colors cursor-pointer"
                                title="删除"
                              >
                                <Trash2 className="h-3 w-3" />
                              </button>
                            )}

                            <a
                              href={dlHref}
                              download={img.local_file || `duomi_${rec.id}.png`}
                              target="_blank"
                              rel="noreferrer"
                              className="inline-flex h-7 w-7 items-center justify-center rounded-full bg-white text-zinc-950 hover:bg-white/90 transition-colors"
                              title="下载原图"
                            >
                              <Download className="h-3.5 w-3.5" />
                            </a>
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          ) : isPending ? (
            /* Pearl-Neutral Developing Frame */
            <div className="developing-canvas flex h-full min-h-[210px] w-full flex-col items-center justify-between p-4 text-center">
              <div className="w-full flex items-center justify-between text-[10px] font-mono text-muted-foreground">
                <span>{rec.model.replace("gpt-image-", "")}</span>
                <span>{rec.size || "auto"}</span>
              </div>

              <div className="space-y-2.5 my-4 z-10">
                <div className="mx-auto flex h-9 w-9 items-center justify-center rounded-full bg-foreground/[0.06] text-foreground">
                  <Loader2 className="h-4 w-4 animate-spin" />
                </div>
                <div>
                  <p className="text-xs font-medium text-foreground">
                    {formatStateLabel(rec.state, rec.progress)}
                  </p>
                  <p className="mt-0.5 font-mono text-[10px] text-muted-foreground tabular-nums">
                    {formatDurationSeconds(elapsedSec)}
                  </p>
                </div>
                <div className="mx-auto h-1 w-32 overflow-hidden rounded-full bg-foreground/[0.08]">
                  <div
                    className="h-full rounded-full bg-foreground/75 transition-all duration-500"
                    style={{ width: `${pct}%` }}
                  />
                </div>
              </div>

              <div className="w-full flex items-center justify-between gap-2 z-10">
                <p className="text-[11px] text-muted-foreground truncate text-left flex-1">
                  {rec.prompt}
                </p>
                {!selectMode && (
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation()
                      onCancelPolling(rec.id)
                    }}
                    className="shrink-0 rounded-full bg-foreground/[0.06] px-2.5 py-0.5 text-[10px] text-muted-foreground hover:text-destructive cursor-pointer"
                  >
                    停止
                  </button>
                )}
              </div>
            </div>
          ) : (
            /* Minimalist Error Frame */
            <div className="flex h-full min-h-[200px] w-full flex-col items-center justify-center p-5 text-center space-y-2.5 bg-destructive/[0.04]">
              <AlertCircle className="h-5 w-5 text-destructive" />
              <div className="space-y-1">
                <p className="text-xs font-medium text-destructive">
                  {formatStateLabel(rec.state)}
                </p>
                <p className="text-[11px] text-muted-foreground line-clamp-3 max-w-xs leading-relaxed">
                  {rec.error_msg || "生成未完成"}
                </p>
              </div>
              {!selectMode && (
                <div className="flex items-center gap-1.5 pt-1">
                  <Button
                    type="button"
                    variant="secondary"
                    size="xs"
                    onClick={(e) => {
                      e.stopPropagation()
                      onRetryRecord(rec)
                    }}
                  >
                    <RotateCcw className="h-3 w-3" />
                    重试
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="xs"
                    onClick={(e) => {
                      e.stopPropagation()
                      onDeleteSingle(rec)
                    }}
                  >
                    移除
                  </Button>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Borderless Showcase Caption */}
        {displayMode === "showcase" && (
          <div className="p-3.5 space-y-2">
            {rec.warning_msg && (
              <div className="flex items-start gap-1.5 rounded-xl bg-amber-500/10 px-2.5 py-1.5 text-[10px] text-amber-600 dark:text-amber-400">
                <AlertTriangle className="h-3 w-3 shrink-0 mt-0.5" />
                <span>{rec.warning_msg}</span>
              </div>
            )}
            <p className="text-xs text-foreground line-clamp-2 leading-relaxed">
              {rec.prompt}
            </p>
            <div className="flex items-center justify-between text-[10px] font-mono text-muted-foreground pt-0.5">
              <span>
                {rec.model.replace("gpt-image-", "")} · {rec.size || "auto"}
              </span>
              <div className="flex items-center gap-1.5">
                {missingLocal && (
                  <button
                    type="button"
                    onClick={() => onDownloadMissingLocal(rec)}
                    className="text-foreground hover:underline cursor-pointer"
                  >
                    补下原图
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => onRefreshSingle(rec.id)}
                  className="hover:text-foreground cursor-pointer"
                  title="同步状态"
                >
                  <RefreshCw
                    className={cn("h-3 w-3", isRefreshing && "animate-spin")}
                  />
                </button>
                <button
                  type="button"
                  onClick={() => onCopyText(rec.id, "已复制任务 ID")}
                  className="hover:text-foreground cursor-pointer"
                >
                  <Copy className="h-3 w-3" />
                </button>
              </div>
            </div>
          </div>
        )}
      </article>
    )
  }

  const tonalControlPill =
    "h-8 rounded-full bg-foreground/[0.045] dark:bg-white/[0.055] text-xs text-muted-foreground hover:text-foreground transition-colors"

  const isGalleryTwoPane = embeddedScroll && mode === "gallery"
  const isSplitRightPane = embeddedScroll && mode === "imagine"

  return (
    <div
      ref={streamRootRef}
      className={cn(
        isGalleryTwoPane
          ? "studio-container flex h-full gap-8 overflow-hidden"
          : embeddedScroll
          ? "flex h-full w-full overflow-hidden"
          : "w-full"
      )}
    >
      {/* Borderless Floating Album Column in Gallery View — 0px aligned with left plumb-line */}
      {mode === "gallery" && (
        <aside className="hidden lg:flex w-52 shrink-0 flex-col justify-between py-5 select-none">
          <div className="space-y-6 overflow-y-auto studio-scroll">
            <div>
              <h2 className="px-3 text-[11px] font-medium text-muted-foreground">
                视图
              </h2>
              <div className="mt-1.5 space-y-0.5">
                {[
                  { id: "all", label: "全部作品", count: counts.all },
                  { id: "starred", label: "收藏", count: counts.starred },
                  { id: "with_refs", label: "参考生图", count: counts.withRefs },
                  { id: "active", label: "生成中", count: counts.active },
                  { id: "failed", label: "异常", count: counts.failed },
                ].map((v) => (
                  <button
                    key={v.id}
                    type="button"
                    onClick={() => {
                      captureStreamFlip()
                      setStatusFilter(v.id)
                      setProjectFilter("all")
                    }}
                    className={cn(
                      "flex w-full items-center justify-between rounded-full px-3 py-2 text-xs font-medium transition-colors cursor-pointer",
                      statusFilter === v.id && projectFilter === "all"
                        ? "bg-foreground/[0.07] dark:bg-white/[0.1] text-foreground"
                        : "text-muted-foreground hover:bg-foreground/[0.04] hover:text-foreground"
                    )}
                  >
                    <span>{v.label}</span>
                    <span className="font-mono text-[10px] opacity-65 tabular-nums">
                      {v.count}
                    </span>
                  </button>
                ))}
              </div>
            </div>

            <div className="space-y-1.5">
              <div className="flex items-center justify-between px-3">
                <span className="text-[11px] font-medium text-muted-foreground">
                  画册
                </span>
                <Popover open={newProjOpen} onOpenChange={setNewProjOpen}>
                  <PopoverTrigger asChild>
                    <button
                      type="button"
                      className="rounded-full p-1 text-muted-foreground hover:bg-foreground/[0.06] hover:text-foreground cursor-pointer"
                      title="新建画册"
                    >
                      <FolderPlus className="h-3.5 w-3.5" />
                    </button>
                  </PopoverTrigger>
                  <PopoverContent className="w-60 space-y-2.5">
                    <p className="text-xs font-medium">新建画册</p>
                    <Input
                      value={newProjName}
                      onChange={(e) => setNewProjName(e.target.value)}
                      placeholder="画册名称"
                      className="h-8 text-xs"
                    />
                    <div className="flex items-center gap-1.5">
                      {Object.entries(PROJECT_COLOR_MAP).map(([cKey, cVal]) => (
                        <button
                          key={cKey}
                          type="button"
                          onClick={() => setNewProjColor(cKey)}
                          className={cn(
                            "h-5 w-5 rounded-full transition-transform cursor-pointer",
                            cVal.dot,
                            newProjColor === cKey &&
                              "ring-2 ring-offset-2 ring-offset-popover ring-foreground scale-110"
                          )}
                          title={cVal.label}
                        />
                      ))}
                    </div>
                    <Button
                      type="button"
                      size="sm"
                      className="w-full h-8"
                      onClick={() => {
                        if (!newProjName.trim()) return
                        onCreateProject(newProjName.trim(), newProjColor)
                        setNewProjName("")
                        setNewProjOpen(false)
                      }}
                    >
                      创建
                    </Button>
                  </PopoverContent>
                </Popover>
              </div>

              <div className="space-y-0.5">
                {projects.length === 0 ? (
                  <p className="px-3 py-2 text-[11px] text-muted-foreground/75">
                    暂无画册
                  </p>
                ) : (
                  projects.map((p) => {
                    const active = projectFilter === p.id
                    return (
                      <div
                        key={p.id}
                        className={cn(
                          "group flex items-center justify-between rounded-full px-3 py-2 text-xs transition-colors",
                          active
                            ? "bg-foreground/[0.07] dark:bg-white/[0.1] text-foreground font-medium"
                            : "text-muted-foreground hover:bg-foreground/[0.04] hover:text-foreground"
                        )}
                      >
                        <button
                          type="button"
                          onClick={() => {
                            captureStreamFlip()
                            setProjectFilter(p.id)
                            setStatusFilter("all")
                          }}
                          className="flex flex-1 items-center gap-2 text-left truncate cursor-pointer"
                        >
                          <span
                            className={cn(
                              "h-2 w-2 rounded-full shrink-0",
                              PROJECT_COLOR_MAP[p.color || "amber"]?.dot
                            )}
                          />
                          <span className="truncate">{p.name}</span>
                        </button>
                        <div className="flex items-center gap-1">
                          <span className="font-mono text-[10px] opacity-65">
                            {counts.byProject[p.id] || 0}
                          </span>
                          <button
                            type="button"
                            onClick={() => {
                              if (projectFilter === p.id) {
                                captureStreamFlip()
                                setProjectFilter("all")
                              }
                              onDeleteProject(p.id)
                            }}
                            className="opacity-0 group-hover:opacity-100 p-0.5 text-muted-foreground hover:text-destructive cursor-pointer"
                            title="移除画册"
                          >
                            <X className="h-3 w-3" />
                          </button>
                        </div>
                      </div>
                    )
                  })
                )}
              </div>
            </div>
          </div>

          {/* Quiet Album ZIP Export */}
          <div className="pt-3">
            {projectFilter !== "all" && projectFilter !== "unassigned" ? (
              <Button
                asChild
                variant="secondary"
                size="sm"
                className="w-full text-xs"
              >
                <a
                  href={`/api/records/export-zip?project_id=${encodeURIComponent(
                    projectFilter
                  )}`}
                  download
                >
                  <Archive className="h-3.5 w-3.5" />
                  导出画册 ZIP
                </a>
              </Button>
            ) : (
              counts.succeeded > 0 && (
                <Button
                  asChild
                  variant="secondary"
                  size="sm"
                  className="w-full text-xs"
                >
                  <a href="/api/records/export-zip" download>
                    <Archive className="h-3.5 w-3.5" />
                    导出全部 ZIP
                  </a>
                </Button>
              )
            )}
          </div>
        </aside>
      )}

      {/* Main Stream Column */}
      <div
        className={cn(
          "flex flex-col relative min-w-0",
          embeddedScroll ? "flex-1 h-full overflow-hidden" : "w-full"
        )}
      >
        {/* High-Occlusion Sticky Filter Bar — Plumb-line Aligned */}
        <div
          className={cn(
            "z-30 w-full",
            !embeddedScroll
              ? "sticky top-0 studio-sticky-bar"
              : isSplitRightPane
              ? "shrink-0 studio-sticky-bar"
              : "shrink-0"
          )}
        >
          <div
            className={cn(
              "flex flex-wrap items-center justify-between gap-2.5 py-3",
              !embeddedScroll
                ? "studio-container"
                : isSplitRightPane
                ? "px-6"
                : ""
            )}
          >
            {/* Left: Segmented Status Filter Pill */}
            <div className="flex items-center gap-2 overflow-x-auto">
              <div className="relative flex items-center rounded-full bg-foreground/[0.045] dark:bg-white/[0.055] p-1 shrink-0">
                <div
                  ref={statusPillRef}
                  style={{ opacity: 0, visibility: "hidden" }}
                  className="pointer-events-none absolute top-1 bottom-1 left-0 rounded-full bg-card shadow-[0_1px_4px_rgba(0,0,0,0.08)] dark:bg-white/[0.15]"
                />
                {[
                  { id: "all", label: "全部", c: counts.all },
                  { id: "active", label: "生成中", c: counts.active },
                  { id: "succeeded", label: "已完成", c: counts.succeeded },
                  { id: "starred", label: "收藏", c: counts.starred },
                  { id: "failed", label: "异常", c: counts.failed },
                ].map((tab) => (
                  <button
                    key={tab.id}
                    ref={(el) => {
                      statusBtnRefs.current[tab.id] = el
                    }}
                    type="button"
                    onClick={() => {
                      if (statusFilter !== tab.id) captureStreamFlip()
                      setStatusFilter(tab.id)
                    }}
                    className={cn(
                      "relative z-10 inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium transition-colors cursor-pointer shrink-0",
                      statusFilter === tab.id
                        ? "text-foreground"
                        : "text-muted-foreground hover:text-foreground"
                    )}
                  >
                    <span>{tab.label}</span>
                    {tab.c > 0 && (
                      <span className="font-mono text-[10px] opacity-60 tabular-nums">
                        {tab.c}
                      </span>
                    )}
                  </button>
                ))}
              </div>
            </div>

            {/* Right: Quiet Tonal Controls */}
            <div className="flex flex-wrap items-center gap-1.5 ml-auto">
              <div className="relative w-36 sm:w-48">
                <Search className="pointer-events-none absolute left-3 top-2.25 h-3.5 w-3.5 text-muted-foreground/75" />
                <Input
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="搜索"
                  className="h-8 rounded-full pl-8 text-xs"
                />
              </div>

              {distinctModels.length > 1 && (
                <select
                  value={modelFilter}
                  onChange={(e) => {
                    captureStreamFlip()
                    setModelFilter(e.target.value)
                  }}
                  className={cn(
                    tonalControlPill,
                    "px-3 focus:outline-none cursor-pointer"
                  )}
                >
                  <option value="all">全部模型</option>
                  {distinctModels.map((m) => (
                    <option key={m} value={m}>
                      {m.replace("gpt-image-", "")}
                    </option>
                  ))}
                </select>
              )}

              {displayMode !== "list" && (
                <div
                  className={cn(
                    "hidden lg:flex items-center gap-2 px-3",
                    tonalControlPill
                  )}
                  title="调节列数"
                >
                  <span className="text-[11px] font-mono tabular-nums">
                    {columnCount}列
                  </span>
                  <input
                    type="range"
                    min={2}
                    max={6}
                    step={1}
                    value={columnCount}
                    onChange={(e) => {
                      captureStreamFlip()
                      setColumnCount(Number(e.target.value))
                    }}
                    className="w-16 studio-slider"
                  />
                </div>
              )}

              {/* Monochrome Segmented View Switcher */}
              <div className="inline-flex items-center rounded-full bg-foreground/[0.045] dark:bg-white/[0.055] p-1">
                {(
                  [
                    { m: "masonry", icon: LayoutGrid, tip: "纯享瀑布流" },
                    { m: "showcase", icon: Grid2X2, tip: "卡片视图" },
                    { m: "list", icon: LayoutList, tip: "列表视图" },
                  ] as const
                ).map(({ m, icon: Icon, tip }) => (
                  <Tooltip key={m}>
                    <TooltipTrigger asChild>
                      <button
                        type="button"
                        onClick={() => {
                          if (displayMode !== m) captureStreamFlip()
                          setDisplayMode(m)
                        }}
                        className={cn(
                          "flex h-6 w-7 items-center justify-center rounded-full transition-all cursor-pointer",
                          displayMode === m
                            ? "bg-card text-foreground shadow-2xs dark:bg-white/[0.16]"
                            : "text-muted-foreground hover:text-foreground"
                        )}
                      >
                        <Icon className="h-3.5 w-3.5" />
                      </button>
                    </TooltipTrigger>
                    <TooltipContent>{tip}</TooltipContent>
                  </Tooltip>
                ))}
              </div>

              <button
                type="button"
                onClick={() => {
                  captureStreamFlip()
                  setGroupByDate((v) => !v)
                }}
                className={cn(
                  "hidden sm:inline-flex h-8 items-center rounded-full px-3 text-xs font-medium transition-colors cursor-pointer",
                  groupByDate
                    ? "bg-foreground/[0.09] dark:bg-white/[0.12] text-foreground"
                    : tonalControlPill
                )}
              >
                时间轴
              </button>

              <button
                type="button"
                onClick={() => {
                  setSelectMode((v) => !v)
                  if (selectMode) clearSelection()
                }}
                className={cn(
                  "inline-flex h-8 items-center gap-1.5 rounded-full px-3 text-xs font-medium transition-colors cursor-pointer",
                  selectMode
                    ? "bg-primary text-primary-foreground"
                    : tonalControlPill
                )}
              >
                <span>多选</span>
              </button>

              {counts.failed > 0 &&
                !selectMode &&
                (confirmClearFailed ? (
                  <div className="inline-flex h-8 items-center gap-1.5 rounded-full bg-destructive/10 px-3 text-xs">
                    <span className="text-destructive">
                      清理 {counts.failed} 条？
                    </span>
                    <button
                      type="button"
                      onClick={() => {
                        onClearFailed()
                        setConfirmClearFailed(false)
                      }}
                      className="font-medium text-destructive underline cursor-pointer"
                    >
                      确认
                    </button>
                    <button
                      type="button"
                      onClick={() => setConfirmClearFailed(false)}
                      className="text-muted-foreground cursor-pointer"
                    >
                      取消
                    </button>
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={() => setConfirmClearFailed(true)}
                    className={cn(
                      "inline-flex items-center gap-1 px-3 hover:text-destructive cursor-pointer",
                      tonalControlPill
                    )}
                  >
                    <Trash2 className="h-3 w-3" />
                    <span className="hidden md:inline">清异常</span>
                  </button>
                ))}

              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    type="button"
                    onClick={onOpenImportTask}
                    className={cn(
                      "inline-flex w-8 items-center justify-center cursor-pointer",
                      tonalControlPill
                    )}
                  >
                    <Plus className="h-3.5 w-3.5" />
                  </button>
                </TooltipTrigger>
                <TooltipContent>查询或导入任务 ID</TooltipContent>
              </Tooltip>

              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    type="button"
                    onClick={onRefreshAll}
                    className={cn(
                      "inline-flex w-8 items-center justify-center cursor-pointer",
                      tonalControlPill
                    )}
                  >
                    <RefreshCw className="h-3.5 w-3.5" />
                  </button>
                </TooltipTrigger>
                <TooltipContent>刷新</TooltipContent>
              </Tooltip>
            </div>
          </div>
        </div>

        {/* Generous Whitespace Artwork Stream Body — Plumb-line Aligned */}
        <div
          ref={streamBodyRef}
          className={cn(
            "relative z-0",
            !embeddedScroll
              ? "studio-container py-5 pb-32"
              : isSplitRightPane
              ? "px-6 py-5 pb-28 flex-1 overflow-y-auto studio-scroll"
              : "py-4 pb-28 flex-1 overflow-y-auto studio-scroll"
          )}
        >
          {filteredRecords.length === 0 ? (
            <div className="mx-auto my-20 flex max-w-sm flex-col items-center justify-center text-center select-none">
              <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-foreground/[0.045] text-muted-foreground/70 mb-4">
                <ImageIcon className="h-5 w-5" />
              </div>
              <p className="text-sm font-medium text-foreground">暂无作品</p>
              <p className="mt-1 text-xs text-muted-foreground">
                输入画面描述，或拖入参考图开始创作
              </p>
            </div>
          ) : (
            <div className="space-y-10">
              {dateGroups.map((group) => (
                <section key={group.label} className="space-y-4">
                  {groupByDate && (
                    <h3 className="text-[13px] font-medium tracking-tight text-muted-foreground">
                      {group.label}
                    </h3>
                  )}

                  {displayMode === "list" ? (
                    <div className="space-y-4">
                      {group.items.map((rec) => renderRecordCard(rec))}
                    </div>
                  ) : (
                    <div
                      className="grid gap-5 items-start"
                      style={{
                        gridTemplateColumns: `repeat(${effectiveCols}, minmax(0, 1fr))`,
                      }}
                    >
                      {distributeIntoHorizontalColumns(
                        group.items,
                        effectiveCols,
                        displayMode
                      ).map((colItems, colIdx) => (
                        <div
                          key={colIdx}
                          className="flex flex-col gap-5 min-w-0"
                        >
                          {colItems.map((rec) => renderRecordCard(rec))}
                        </div>
                      ))}
                    </div>
                  )}
                </section>
              ))}
            </div>
          )}
        </div>

        {/* Frosted Apple Capsule Batch Action Dock */}
        {selectMode && (
          <div
            ref={batchDockRef}
            className="fixed bottom-20 md:bottom-6 left-1/2 z-40 -translate-x-1/2 studio-floating-popover flex flex-wrap items-center gap-2 rounded-full px-4 py-2 text-xs"
          >
            <span className="font-medium text-foreground tabular-nums pl-1">
              已选 {selectedIdList.length} 项
            </span>
            <button
              type="button"
              onClick={() => {
                const next: Record<string, boolean> = {}
                for (const r of filteredRecords) next[r.id] = true
                setSelectedIds(next)
              }}
              className="rounded-full popover-tile-interactive px-2.5 py-1 text-[11px] font-medium text-foreground cursor-pointer"
            >
              全选 ({filteredRecords.length})
            </button>

            {selectedIdList.length > 0 && (
              <>
                <Popover>
                  <PopoverTrigger asChild>
                    <Button
                      type="button"
                      variant="secondary"
                      size="xs"
                      className="h-7"
                    >
                      <FolderKanban className="h-3.5 w-3.5" />
                      移入画册
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent
                    preferredSide="top"
                    className="w-48 space-y-1"
                  >
                    <button
                      type="button"
                      onClick={() => {
                        onAssignProject(selectedIdList, "")
                        clearSelection()
                      }}
                      className="flex w-full items-center rounded-xl px-2.5 py-1.5 text-xs hover:bg-[var(--tile-bg)] cursor-pointer"
                    >
                      移出画册
                    </button>
                    {projects.map((p) => (
                      <button
                        key={p.id}
                        type="button"
                        onClick={() => {
                          onAssignProject(selectedIdList, p.id)
                          clearSelection()
                        }}
                        className="flex w-full items-center gap-2 rounded-xl px-2.5 py-1.5 text-xs hover:bg-[var(--tile-bg)] cursor-pointer"
                      >
                        <span
                          className={cn(
                            "h-2 w-2 rounded-full",
                            PROJECT_COLOR_MAP[p.color || "amber"]?.dot
                          )}
                        />
                        <span className="truncate">{p.name}</span>
                      </button>
                    ))}
                  </PopoverContent>
                </Popover>

                <Button
                  type="button"
                  variant="secondary"
                  size="xs"
                  className="h-7"
                  onClick={() => {
                    onBatchStar(selectedIdList, true)
                    clearSelection()
                  }}
                >
                  <Star className="h-3.5 w-3.5" />
                  收藏
                </Button>

                <Button asChild variant="secondary" size="xs" className="h-7">
                  <a
                    href={`/api/records/export-zip?ids=${encodeURIComponent(
                      selectedIdList.join(",")
                    )}`}
                    download
                  >
                    <Archive className="h-3.5 w-3.5" />
                    导出 ZIP
                  </a>
                </Button>

                {confirmBatchDelete ? (
                  <div className="inline-flex items-center gap-1.5 rounded-full bg-destructive px-3 py-1 text-white">
                    <span>确认删除？</span>
                    <button
                      type="button"
                      onClick={() => {
                        onBatchDelete(selectedIdList)
                        clearSelection()
                      }}
                      className="underline font-medium cursor-pointer"
                    >
                      是
                    </button>
                    <button
                      type="button"
                      onClick={() => setConfirmBatchDelete(false)}
                      className="opacity-80 cursor-pointer"
                    >
                      否
                    </button>
                  </div>
                ) : (
                  <Button
                    type="button"
                    variant="destructive"
                    size="xs"
                    className="h-7"
                    onClick={() => setConfirmBatchDelete(true)}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                    删除
                  </Button>
                )}
              </>
            )}

            <button
              type="button"
              onClick={() => {
                setSelectMode(false)
                clearSelection()
              }}
              className="rounded-full p-1 text-muted-foreground hover:text-foreground cursor-pointer"
              title="退出多选"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
