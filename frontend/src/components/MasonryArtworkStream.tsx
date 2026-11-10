import React, { useEffect, useMemo, useState } from "react"
import {
  AlertCircle,
  AlertTriangle,
  Archive,
  ArrowUp,
  Check,
  CheckSquare,
  Columns2,
  Copy,
  Download,
  FolderKanban,
  FolderPlus,
  Grid2X2,
  Image as ImageIcon,
  ImagePlus,
  LayoutList,
  Loader2,
  Maximize2,
  Plus,
  RefreshCw,
  RotateCcw,
  Search,
  Sparkles,
  Square,
  Star,
  StopCircle,
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
  computeRecordAspectRatio,
  formatBytes,
  formatDurationSeconds,
  formatStateLabel,
  formatUnixTime,
  groupRecordsByDateBucket,
  PROJECT_COLOR_MAP,
} from "@/lib/studio-utils"
import { cn } from "@/lib/utils"
import type { ProjectFolder, SavedImage, TaskRecord } from "@/types"

export type StreamDisplayMode = "masonry" | "showcase" | "list"

interface MasonryArtworkStreamProps {
  mode: "imagine" | "gallery"
  embeddedScroll?: boolean
  showQuickCreateTrigger?: boolean
  hasDraftOrRefs?: boolean
  onOpenQuickComposer?: () => void
  onScrollToTop?: () => void

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
  onOpenLightbox: (rec: TaskRecord, imgIdx: number, openCompare?: boolean) => void
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
  showQuickCreateTrigger = false,
  hasDraftOrRefs = false,
  onOpenQuickComposer,
  onScrollToTop,
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

  // Create Project Inline State
  const [newProjOpen, setNewProjOpen] = useState(false)
  const [newProjName, setNewProjName] = useState("")
  const [newProjColor, setNewProjColor] = useState("amber")

  const [nowSec, setNowSec] = useState<number>(() =>
    Math.floor(Date.now() / 1000)
  )

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
        : [{ label: "全部结果", items: filteredRecords }],
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

  const masonryColumnClasses = useMemo(() => {
    switch (columnCount) {
      case 2:
        return "columns-1 sm:columns-2"
      case 3:
        return "columns-1 sm:columns-2 lg:columns-3"
      case 5:
        return "columns-2 sm:columns-3 lg:columns-4 2xl:columns-5"
      case 6:
        return "columns-2 sm:columns-3 md:columns-4 xl:columns-5 2xl:columns-6"
      default:
        return "columns-1 sm:columns-2 lg:columns-3 2xl:columns-4"
    }
  }, [columnCount])

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

    // LIST INSPECTOR MODE
    if (displayMode === "list") {
      return (
        <div
          key={rec.id}
          onClick={selectMode ? () => toggleSelect(rec.id) : undefined}
          className={cn(
            "group flex flex-col sm:flex-row gap-4 rounded-2xl border border-border/80 bg-card p-3 transition-all hover:border-amber-500/40",
            selectMode && "cursor-pointer",
            isChecked && "ring-2 ring-amber-500 border-amber-500"
          )}
        >
          <div className="relative h-44 sm:h-36 sm:w-52 shrink-0 overflow-hidden rounded-xl bg-secondary/50 flex items-center justify-center">
            {isSucceeded ? (
              <img
                src={
                  images[0].local_file
                    ? `/images/${encodeURIComponent(images[0].local_file)}`
                    : images[0].remote_url
                }
                alt={rec.prompt}
                loading="lazy"
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
                <Loader2 className="h-5 w-5 animate-spin text-amber-500" />
                <span className="mt-1.5 text-[11px] font-medium">
                  {formatStateLabel(rec.state, rec.progress)}
                </span>
                <span className="font-mono text-[10px] text-muted-foreground">
                  {formatDurationSeconds(elapsedSec)}
                </span>
              </div>
            ) : (
              <div className="flex flex-col items-center justify-center p-3 text-center">
                <AlertCircle className="h-5 w-5 text-destructive" />
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
                    className="text-[10px] px-1.5 py-0"
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
                    <span
                      className={cn(
                        "inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[10px] font-medium",
                        PROJECT_COLOR_MAP[proj.color || "amber"]?.badge
                      )}
                    >
                      {proj.name}
                    </span>
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

            <div className="flex items-center justify-between border-t border-border/50 pt-2 mt-2">
              <div className="flex items-center gap-1 flex-wrap">
                {isSucceeded && (
                  <>
                    <Button
                      type="button"
                      variant="secondary"
                      size="xs"
                      onClick={() => onOpenLightbox(rec, 0)}
                    >
                      <Maximize2 className="h-3 w-3" />
                      暗房检视
                    </Button>
                    {hasRefCompare && (
                      <Button
                        type="button"
                        variant="outline"
                        size="xs"
                        onClick={() => onOpenLightbox(rec, 0, true)}
                      >
                        <Columns2 className="h-3 w-3" />
                        拉帘对比
                      </Button>
                    )}
                    <Button
                      type="button"
                      variant="ghost"
                      size="xs"
                      onClick={() => onUseGeneratedAsRef(images[0], rec)}
                    >
                      <ImagePlus className="h-3 w-3" />
                      设为参考图
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
                  做同款
                </Button>
                {isFailed && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="xs"
                    className="text-amber-500"
                    onClick={() => onRetryRecord(rec)}
                  >
                    重试提交
                  </Button>
                )}
              </div>

              <div className="flex items-center gap-1">
                <button
                  type="button"
                  onClick={() => onToggleStar(rec)}
                  className={cn(
                    "p-1.5 rounded-lg cursor-pointer",
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
                  className="p-1.5 rounded-lg text-muted-foreground hover:text-destructive cursor-pointer"
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

    // MASONRY (Pure Midjourney/Ideogram Art Card) & SHOWCASE CARD
    return (
      <article
        key={rec.id}
        onClick={selectMode ? () => toggleSelect(rec.id) : undefined}
        className={cn(
          "masonry-item group relative overflow-hidden rounded-2xl border transition-all duration-200",
          displayMode === "masonry"
            ? "border-border/60 bg-card/40 hover:border-amber-500/45 hover:shadow-xl"
            : "border-border bg-card shadow-2xs hover:shadow-md",
          selectMode && "cursor-pointer",
          isChecked && "ring-2 ring-amber-500 border-amber-500"
        )}
      >
        {/* Artwork / Developing Frame */}
        <div
          style={!isSucceeded ? { aspectRatio } : undefined}
          className={cn(
            "relative w-full overflow-hidden",
            rec.background === "transparent" && isSucceeded
              ? "bg-checkerboard"
              : "bg-secondary/35"
          )}
        >
          {/* Floating Top Badges (Select / Star / Project / Ref Thumbnails) */}
          <div
            onClick={(e) => e.stopPropagation()}
            className="pointer-events-none absolute inset-x-2.5 top-2.5 z-20 flex items-start justify-between gap-2"
          >
            <div className="pointer-events-auto flex items-center gap-1.5">
              {(selectMode || isChecked) && (
                <button
                  type="button"
                  onClick={() => toggleSelect(rec.id)}
                  className="flex h-7 w-7 items-center justify-center rounded-xl bg-black/70 text-white backdrop-blur-md cursor-pointer"
                >
                  {isChecked ? (
                    <CheckSquare className="h-4 w-4 text-amber-400" />
                  ) : (
                    <Square className="h-4 w-4" />
                  )}
                </button>
              )}

              {proj && (
                <span className="inline-flex items-center gap-1 rounded-lg bg-black/65 px-2 py-0.5 text-[10px] font-medium text-white backdrop-blur-md">
                  <span
                    className={cn(
                      "h-1.5 w-1.5 rounded-full",
                      PROJECT_COLOR_MAP[proj.color || "amber"]?.dot
                    )}
                  />
                  {proj.name}
                </span>
              )}

              {/* Mini Reference Stack Badge */}
              {rec.ref_items && rec.ref_items.length > 0 && (
                <div
                  className="hidden sm:flex items-center -space-x-1.5 rounded-lg bg-black/60 p-0.5 pr-1.5 backdrop-blur-md opacity-90"
                  title={`使用了 ${rec.ref_items.length} 张参考图`}
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
                        className="h-5 w-5 rounded-md border border-white/30 object-cover"
                      />
                    )
                  })}
                  <span className="pl-2 font-mono text-[9px] text-zinc-200">
                    参考
                  </span>
                </div>
              )}
            </div>

            {/* Star & Quick Select Circle */}
            {!selectMode && (
              <div className="pointer-events-auto flex items-center gap-1">
                <button
                  type="button"
                  onClick={() => onToggleStar(rec)}
                  className={cn(
                    "flex h-7 w-7 items-center justify-center rounded-xl backdrop-blur-md transition-all cursor-pointer",
                    rec.starred
                      ? "bg-black/70 text-amber-400 opacity-100"
                      : "bg-black/50 text-white/85 opacity-0 group-hover:opacity-100 hover:text-amber-400"
                  )}
                  title={rec.starred ? "取消星标收藏" : "加入星标精选"}
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
                    <img
                      src={src}
                      alt={rec.prompt}
                      loading="lazy"
                      onClick={(e) => {
                        if (selectMode) return
                        e.stopPropagation()
                        onOpenLightbox(rec, idx)
                      }}
                      className="block w-full h-auto transition-transform duration-500 ease-out group-hover:scale-[1.022] cursor-zoom-in"
                    />

                    {/* Midjourney / Ideogram Style Glassmorphic Hover Overlay */}
                    {!selectMode && (
                      <div
                        onClick={(e) => e.stopPropagation()}
                        className="pointer-events-none absolute inset-x-0 bottom-0 flex flex-col justify-end bg-gradient-to-t from-black/90 via-black/50 to-transparent p-3 pt-12 opacity-0 transition-opacity duration-200 group-hover:opacity-100"
                      >
                        {displayMode === "masonry" && (
                          <div className="mb-2 space-y-1">
                            <p className="text-[11px] text-zinc-100 line-clamp-2 leading-snug drop-shadow-xs">
                              {rec.prompt}
                            </p>
                            <div className="flex items-center gap-1.5 font-mono text-[10px] text-zinc-300/85">
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
                          <div className="flex items-center gap-1 flex-wrap">
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <button
                                  type="button"
                                  onClick={() => onOpenLightbox(rec, idx)}
                                  className="inline-flex h-7 items-center gap-1 rounded-lg bg-white/15 hover:bg-white/25 backdrop-blur-md px-2 text-[11px] font-medium text-white transition-colors cursor-pointer"
                                >
                                  <Maximize2 className="h-3 w-3" />
                                  <span>检视</span>
                                </button>
                              </TooltipTrigger>
                              <TooltipContent>暗房级无级缩放与元数据检视</TooltipContent>
                            </Tooltip>

                            {hasRefCompare && (
                              <Tooltip>
                                <TooltipTrigger asChild>
                                  <button
                                    type="button"
                                    onClick={() => onOpenLightbox(rec, idx, true)}
                                    className="inline-flex h-7 items-center gap-1 rounded-lg bg-amber-500/85 hover:bg-amber-400 px-2 text-[11px] font-semibold text-zinc-950 transition-colors cursor-pointer"
                                  >
                                    <Columns2 className="h-3 w-3" />
                                    <span>对比</span>
                                  </button>
                                </TooltipTrigger>
                                <TooltipContent>
                                  拉帘滑块对比参考原图与生成效果
                                </TooltipContent>
                              </Tooltip>
                            )}

                            <Tooltip>
                              <TooltipTrigger asChild>
                                <button
                                  type="button"
                                  onClick={() => onUseGeneratedAsRef(img, rec)}
                                  className="inline-flex h-7 w-7 items-center justify-center rounded-lg bg-white/15 hover:bg-amber-500 hover:text-zinc-950 backdrop-blur-md text-white transition-colors cursor-pointer"
                                >
                                  <ImagePlus className="h-3.5 w-3.5" />
                                </button>
                              </TooltipTrigger>
                              <TooltipContent>将此图设为参考图继续精修</TooltipContent>
                            </Tooltip>

                            <Tooltip>
                              <TooltipTrigger asChild>
                                <button
                                  type="button"
                                  onClick={() => onReuseRecord(rec, true)}
                                  className="inline-flex h-7 w-7 items-center justify-center rounded-lg bg-white/15 hover:bg-white/25 backdrop-blur-md text-white transition-colors cursor-pointer"
                                >
                                  <RotateCcw className="h-3.5 w-3.5" />
                                </button>
                              </TooltipTrigger>
                              <TooltipContent>
                                一键做同款 (回填提示词、尺寸及原参考图)
                              </TooltipContent>
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
                                className="rounded-lg bg-destructive px-2 py-1 text-[10px] font-bold text-white cursor-pointer"
                              >
                                确认删
                              </button>
                            ) : (
                              <button
                                type="button"
                                onClick={() => setConfirmDeleteId(rec.id)}
                                className="inline-flex h-7 w-7 items-center justify-center rounded-lg bg-black/55 hover:bg-destructive text-white/80 hover:text-white transition-colors cursor-pointer"
                                title="删除作品"
                              >
                                <Trash2 className="h-3 w-3" />
                              </button>
                            )}

                            <a
                              href={dlHref}
                              download={img.local_file || `duomi_${rec.id}.png`}
                              target="_blank"
                              rel="noreferrer"
                              className="inline-flex h-7 w-7 items-center justify-center rounded-lg bg-zinc-100 text-zinc-950 hover:bg-white transition-colors"
                              title="下载本地无损原图"
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
            /* Aspect-Ratio-True Filmic Darkroom Developing Frame */
            <div className="developing-canvas flex h-full min-h-[210px] w-full flex-col items-center justify-between p-4 text-center">
              <div className="w-full flex items-center justify-between text-[10px] font-mono text-muted-foreground">
                <span>{rec.model.replace("gpt-image-", "")}</span>
                <span>{rec.size || "auto"}</span>
              </div>

              <div className="space-y-2.5 my-4 z-10">
                <div className="mx-auto flex h-10 w-10 items-center justify-center rounded-2xl bg-amber-500/15 text-amber-500 ring-1 ring-amber-500/30">
                  <Loader2 className="h-5 w-5 animate-spin" />
                </div>
                <div>
                  <p className="text-xs font-semibold text-foreground">
                    {formatStateLabel(rec.state, rec.progress)}
                  </p>
                  <p className="mt-0.5 font-mono text-[11px] text-muted-foreground tabular-nums">
                    已耗时 {formatDurationSeconds(elapsedSec)}
                  </p>
                </div>
                <div className="mx-auto h-1.5 w-40 overflow-hidden rounded-full bg-background/70">
                  <div
                    className="h-full rounded-full bg-amber-500 transition-all duration-500"
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
                    className="shrink-0 rounded-lg bg-background/80 px-2 py-0.5 text-[10px] text-muted-foreground hover:text-destructive cursor-pointer"
                  >
                    停止
                  </button>
                )}
              </div>
            </div>
          ) : (
            /* Failed / Error Frame */
            <div className="flex h-full min-h-[200px] w-full flex-col items-center justify-center p-5 text-center space-y-2.5 bg-destructive/[0.04]">
              <AlertCircle className="h-6 w-6 text-destructive" />
              <div className="space-y-1">
                <p className="text-xs font-semibold text-destructive">
                  {formatStateLabel(rec.state)}
                </p>
                <p className="text-[11px] text-muted-foreground line-clamp-3 max-w-xs leading-relaxed">
                  {rec.error_msg || "上游任务未能完成"}
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
                    重试提交
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

        {/* Optional Below-Image Metadata Footer ONLY in Showcase Mode */}
        {displayMode === "showcase" && (
          <div className="p-3 space-y-2 border-t border-border/60">
            {rec.warning_msg && (
              <div className="flex items-start gap-1 rounded-lg bg-amber-500/10 px-2 py-1 text-[10px] text-amber-600 dark:text-amber-400">
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
              <div className="flex items-center gap-1">
                {missingLocal && (
                  <button
                    type="button"
                    onClick={() => onDownloadMissingLocal(rec)}
                    className="text-amber-500 hover:underline cursor-pointer"
                  >
                    补下原图
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => onRefreshSingle(rec.id)}
                  className="hover:text-foreground cursor-pointer"
                  title="同步远端状态"
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

  return (
    <div className={cn("w-full", embeddedScroll && "flex h-full overflow-hidden")}>
      {/* Dedicated Left Project Albums & Collections Sidebar when in Gallery/Assets View */}
      {mode === "gallery" && (
        <aside className="hidden lg:flex w-60 shrink-0 flex-col justify-between border-r border-border bg-card/40 p-3.5 select-none">
          <div className="space-y-4 overflow-y-auto">
            <div>
              <h2 className="px-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                智能视图 (Smart Views)
              </h2>
              <div className="mt-2 space-y-0.5">
                {[
                  { id: "all", label: "全部创作资产", count: counts.all },
                  { id: "starred", label: "★ 星标精选集", count: counts.starred },
                  { id: "with_refs", label: "含参考图生图", count: counts.withRefs },
                  { id: "active", label: "正在显影队列", count: counts.active },
                  { id: "failed", label: "异常与失败", count: counts.failed },
                ].map((v) => (
                  <button
                    key={v.id}
                    type="button"
                    onClick={() => {
                      setStatusFilter(v.id)
                      setProjectFilter("all")
                    }}
                    className={cn(
                      "flex w-full items-center justify-between rounded-xl px-2.5 py-2 text-xs font-medium transition-colors cursor-pointer",
                      statusFilter === v.id && projectFilter === "all"
                        ? "bg-accent text-foreground font-semibold"
                        : "text-muted-foreground hover:bg-accent/50 hover:text-foreground"
                    )}
                  >
                    <span>{v.label}</span>
                    <span className="font-mono text-[10px] opacity-75 tabular-nums">
                      {v.count}
                    </span>
                  </button>
                ))}
              </div>
            </div>

            {/* Custom Project Albums */}
            <div className="space-y-2">
              <div className="flex items-center justify-between px-2">
                <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  项目画册 (Albums)
                </span>
                <Popover open={newProjOpen} onOpenChange={setNewProjOpen}>
                  <PopoverTrigger asChild>
                    <button
                      type="button"
                      className="rounded-md p-1 text-muted-foreground hover:bg-accent hover:text-foreground cursor-pointer"
                      title="新建项目画册"
                    >
                      <FolderPlus className="h-3.5 w-3.5" />
                    </button>
                  </PopoverTrigger>
                  <PopoverContent className="w-64 space-y-2.5">
                    <p className="text-xs font-semibold">新建项目画册</p>
                    <Input
                      value={newProjName}
                      onChange={(e) => setNewProjName(e.target.value)}
                      placeholder="例如：机房辅导写真 / 电商主图"
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
                      创建画册
                    </Button>
                  </PopoverContent>
                </Popover>
              </div>

              <div className="space-y-0.5">
                {projects.length === 0 ? (
                  <p className="px-2 py-2 text-[11px] text-muted-foreground leading-relaxed">
                    点击右上角 <FolderPlus className="inline h-3 w-3" /> 创建项目画册，按主题归档与批量导出作品。
                  </p>
                ) : (
                  projects.map((p) => {
                    const active = projectFilter === p.id
                    return (
                      <div
                        key={p.id}
                        className={cn(
                          "group flex items-center justify-between rounded-xl px-2.5 py-2 text-xs transition-colors",
                          active
                            ? "bg-accent text-foreground font-semibold"
                            : "text-muted-foreground hover:bg-accent/50 hover:text-foreground"
                        )}
                      >
                        <button
                          type="button"
                          onClick={() => {
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
                          <span className="font-mono text-[10px] opacity-75">
                            {counts.byProject[p.id] || 0}
                          </span>
                          <button
                            type="button"
                            onClick={() => {
                              if (projectFilter === p.id) setProjectFilter("all")
                              onDeleteProject(p.id)
                            }}
                            className="opacity-0 group-hover:opacity-100 p-0.5 text-muted-foreground hover:text-destructive cursor-pointer"
                            title="移除此画册分类（不删除图片文件）"
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

          {/* Quick Album Export */}
          <div className="space-y-1.5 border-t border-border pt-3">
            {projectFilter !== "all" && projectFilter !== "unassigned" ? (
              <Button asChild variant="outline" size="sm" className="w-full text-xs">
                <a
                  href={`/api/records/export-zip?project_id=${encodeURIComponent(
                    projectFilter
                  )}`}
                  download
                >
                  <Archive className="h-3.5 w-3.5" />
                  导出当前画册 ZIP
                </a>
              </Button>
            ) : (
              counts.succeeded > 0 && (
                <Button asChild variant="outline" size="sm" className="w-full text-xs">
                  <a href="/api/records/export-zip" download>
                    <Archive className="h-3.5 w-3.5" />
                    导出全部原图 ZIP
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
          "flex flex-col relative w-full",
          embeddedScroll && "flex-1 overflow-hidden"
        )}
      >
        {/* Sleek Full-Width Sticky Filter & Density Control Bar */}
        <div
          className={cn(
            "flex flex-wrap items-center justify-between gap-2 border-b border-border/75 bg-background/95 backdrop-blur-md px-4 py-2.5 sm:px-6 z-20",
            !embeddedScroll ? "sticky top-0 shadow-2xs" : "shrink-0"
          )}
        >
          {/* Left: Quick Create Capsule (when scrolled past top composer) + Status Pills */}
          <div className="flex items-center gap-1.5 overflow-x-auto">
            {showQuickCreateTrigger && (
              <div className="flex items-center gap-1 pr-1.5 mr-1 border-r border-border shrink-0">
                {onOpenQuickComposer && (
                  <button
                    type="button"
                    onClick={onOpenQuickComposer}
                    className="inline-flex h-7 items-center gap-1.5 rounded-full bg-amber-500 hover:bg-amber-400 px-3 text-xs font-semibold text-zinc-950 shadow-2xs transition-all cursor-pointer"
                    title="在当前位置悬浮唤起创作舱 (快捷键 Ctrl+J)"
                  >
                    <Sparkles className="h-3 w-3" />
                    <span>唤起创作舱</span>
                    {hasDraftOrRefs && (
                      <span className="h-1.5 w-1.5 rounded-full bg-zinc-950/75" />
                    )}
                  </button>
                )}
                {onScrollToTop && (
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <button
                        type="button"
                        onClick={onScrollToTop}
                        className="inline-flex h-7 w-7 items-center justify-center rounded-full border border-border bg-card/80 text-muted-foreground hover:text-foreground transition-colors cursor-pointer"
                        aria-label="回到顶部创作区"
                      >
                        <ArrowUp className="h-3.5 w-3.5" />
                      </button>
                    </TooltipTrigger>
                    <TooltipContent>平滑回到顶部完整创作区</TooltipContent>
                  </Tooltip>
                )}
              </div>
            )}

            {[
              { id: "all", label: "全部", c: counts.all },
              { id: "active", label: "显影中", c: counts.active },
              { id: "succeeded", label: "已完成", c: counts.succeeded },
              { id: "starred", label: "★ 收藏", c: counts.starred },
              { id: "failed", label: "异常", c: counts.failed },
            ].map((tab) => (
              <button
                key={tab.id}
                type="button"
                onClick={() => setStatusFilter(tab.id)}
                className={cn(
                  "inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium transition-all cursor-pointer shrink-0",
                  statusFilter === tab.id
                    ? "bg-foreground text-background font-semibold"
                    : "text-muted-foreground hover:bg-secondary hover:text-foreground"
                )}
              >
                <span>{tab.label}</span>
                {tab.c > 0 && (
                  <span className="font-mono text-[10px] opacity-75 tabular-nums">
                    {tab.c}
                  </span>
                )}
              </button>
            ))}
          </div>

          {/* Right Controls: Search, Model Filter, Column Density Slider, View Mode, Multi-Select */}
          <div className="flex flex-wrap items-center gap-2 ml-auto">
            <div className="relative w-40 sm:w-52">
              <Search className="pointer-events-none absolute left-2.5 top-2 h-3.5 w-3.5 text-muted-foreground" />
              <Input
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="搜索提示词 / 模型 / ID..."
                className="h-7 rounded-full pl-8 text-xs bg-card/70"
              />
            </div>

            {distinctModels.length > 1 && (
              <select
                value={modelFilter}
                onChange={(e) => setModelFilter(e.target.value)}
                className="h-7 rounded-full border border-border bg-card/70 px-2.5 text-xs text-foreground"
              >
                <option value="all">全部模型</option>
                {distinctModels.map((m) => (
                  <option key={m} value={m}>
                    {m.replace("gpt-image-", "")}
                  </option>
                ))}
              </select>
            )}

            {/* Midjourney-style Live Column Density Slider */}
            {displayMode !== "list" && (
              <div
                className="hidden xl:flex items-center gap-2 rounded-full border border-border/80 bg-card/70 px-3 h-7"
                title="拖动滑杆无级调节瀑布流列数密度"
              >
                <span className="text-[10px] text-muted-foreground font-mono">
                  {columnCount}列
                </span>
                <input
                  type="range"
                  min={2}
                  max={6}
                  step={1}
                  value={columnCount}
                  onChange={(e) => setColumnCount(Number(e.target.value))}
                  className="w-16 studio-slider"
                />
              </div>
            )}

            {/* Display Style Switcher */}
            <div className="inline-flex items-center rounded-full border border-border/80 bg-card/70 p-0.5">
              {(
                [
                  { m: "masonry", icon: Sparkles, tip: "沉浸瀑布流（无边框纯享艺术墙）" },
                  { m: "showcase", icon: Grid2X2, tip: "审片卡片流（显示提示词摘要）" },
                  { m: "list", icon: LayoutList, tip: "详情宽列表" },
                ] as const
              ).map(({ m, icon: Icon, tip }) => (
                <Tooltip key={m}>
                  <TooltipTrigger asChild>
                    <button
                      type="button"
                      onClick={() => setDisplayMode(m)}
                      className={cn(
                        "flex h-6 w-7 items-center justify-center rounded-full transition-colors cursor-pointer",
                        displayMode === m
                          ? "bg-amber-500 text-zinc-950"
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
              onClick={() => setGroupByDate((v) => !v)}
              className={cn(
                "hidden sm:inline-flex h-7 items-center rounded-full border px-2.5 text-[11px] transition-colors cursor-pointer",
                groupByDate
                  ? "border-amber-500/40 bg-amber-500/10 text-amber-600 dark:text-amber-400 font-medium"
                  : "border-border/80 bg-card/70 text-muted-foreground"
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
                "inline-flex h-7 items-center gap-1 rounded-full border px-2.5 text-[11px] font-medium transition-colors cursor-pointer",
                selectMode
                  ? "border-amber-500 bg-amber-500 text-zinc-950 font-semibold"
                  : "border-border/80 bg-card/70 text-muted-foreground hover:text-foreground"
              )}
            >
              <CheckSquare className="h-3 w-3" />
              <span>多选</span>
            </button>

            {counts.failed > 0 && !selectMode && (
              confirmClearFailed ? (
                <div className="inline-flex items-center gap-1 rounded-full border border-destructive/50 bg-destructive/10 px-2.5 py-0.5 text-[11px]">
                  <span className="text-destructive">清理{counts.failed}条失败?</span>
                  <button
                    type="button"
                    onClick={() => {
                      onClearFailed()
                      setConfirmClearFailed(false)
                    }}
                    className="font-bold text-destructive underline cursor-pointer"
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
                  className="inline-flex h-7 items-center gap-1 rounded-full border border-border/80 bg-card/70 px-2.5 text-[11px] text-muted-foreground hover:text-destructive cursor-pointer"
                >
                  <Trash2 className="h-3 w-3" />
                  <span className="hidden md:inline">清失败</span>
                </button>
              )
            )}

            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  onClick={onOpenImportTask}
                  className="inline-flex h-7 w-7 items-center justify-center rounded-full border border-border/80 bg-card/70 text-muted-foreground hover:text-foreground cursor-pointer"
                >
                  <Plus className="h-3.5 w-3.5" />
                </button>
              </TooltipTrigger>
              <TooltipContent>通过多米 Task ID 导入查询远端任务</TooltipContent>
            </Tooltip>

            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  onClick={onRefreshAll}
                  className="inline-flex h-7 w-7 items-center justify-center rounded-full border border-border/80 bg-card/70 text-muted-foreground hover:text-foreground cursor-pointer"
                >
                  <RefreshCw className="h-3.5 w-3.5" />
                </button>
              </TooltipTrigger>
              <TooltipContent>刷新列表</TooltipContent>
            </Tooltip>
          </div>
        </div>

        {/* Artwork Stream Body */}
        <div
          className={cn(
            "px-4 py-5 sm:px-6 pb-24",
            embeddedScroll && "flex-1 overflow-y-auto studio-scroll"
          )}
        >
          {filteredRecords.length === 0 ? (
            <div className="mx-auto my-12 flex max-w-lg flex-col items-center justify-center rounded-3xl border border-dashed border-border bg-card/30 p-10 text-center">
              <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-amber-500/12 text-amber-500 ring-1 ring-amber-500/25 mb-4">
                <ImageIcon className="h-6 w-6" />
              </div>
              <h2 className="text-base font-semibold text-foreground">
                画布已就绪，开始你的第一幅创作
              </h2>
              <p className="mt-1.5 text-xs text-muted-foreground leading-relaxed">
                支持在上方灵动创作坞直接输入提示词或 <kbd className="studio-kbd">Ctrl+V</kbd> 粘贴参考图（默认采用二进制原图无损上传图床，Base64 压缩独立可选）。所有生成的原图将自动持久化归档在本地{" "}
                <code className="font-mono text-foreground">duomi_data/images/</code>。
              </p>
            </div>
          ) : (
            <div className="space-y-8">
              {dateGroups.map((group) => (
                <section key={group.label} className="space-y-3.5">
                  {groupByDate && (
                    <div className="flex items-center gap-3">
                      <h3 className="text-xs font-semibold tracking-wide text-muted-foreground">
                        {group.label}
                      </h3>
                      <span className="rounded-full bg-secondary px-2 py-0.5 font-mono text-[10px] text-muted-foreground">
                        {group.items.length}
                      </span>
                      <div className="h-px flex-1 bg-border/50" />
                    </div>
                  )}

                  {displayMode === "list" ? (
                    <div className="space-y-3">
                      {group.items.map((rec) => renderRecordCard(rec))}
                    </div>
                  ) : (
                    <div className={cn("gap-4", masonryColumnClasses)}>
                      {group.items.map((rec) => renderRecordCard(rec))}
                    </div>
                  )}
                </section>
              ))}
            </div>
          )}
        </div>

        {/* Linear / Figma Style Floating Glass Batch Action Dock */}
        {selectMode && (
          <div className="fixed bottom-16 md:bottom-6 left-1/2 z-40 -translate-x-1/2 studio-omnibar flex flex-wrap items-center gap-2 rounded-2xl px-4 py-2.5 text-xs">
            <span className="font-semibold text-foreground tabular-nums pr-1">
              已选 {selectedIdList.length} 项
            </span>
            <button
              type="button"
              onClick={() => {
                const next: Record<string, boolean> = {}
                for (const r of filteredRecords) next[r.id] = true
                setSelectedIds(next)
              }}
              className="text-amber-500 hover:underline cursor-pointer"
            >
              全选当前 ({filteredRecords.length})
            </button>

            <div className="h-4 w-px bg-border mx-1" />

            {selectedIdList.length > 0 && (
              <>
                {/* Batch Move to Project Album */}
                <Popover>
                  <PopoverTrigger asChild>
                    <Button type="button" variant="secondary" size="xs" className="h-7">
                      <FolderKanban className="h-3.5 w-3.5" />
                      移入画册
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent preferredSide="top" className="w-52 space-y-1">
                    <p className="text-[11px] font-semibold text-muted-foreground px-1">
                      批量归档至项目画册
                    </p>
                    <button
                      type="button"
                      onClick={() => {
                        onAssignProject(selectedIdList, "")
                        clearSelection()
                      }}
                      className="flex w-full items-center rounded-lg px-2 py-1.5 text-xs hover:bg-accent cursor-pointer"
                    >
                      移出画册（未归档）
                    </button>
                    {projects.map((p) => (
                      <button
                        key={p.id}
                        type="button"
                        onClick={() => {
                          onAssignProject(selectedIdList, p.id)
                          clearSelection()
                        }}
                        className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-xs hover:bg-accent cursor-pointer"
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
                  <Star className="h-3.5 w-3.5 text-amber-500" />
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
                    打包 ZIP
                  </a>
                </Button>

                {confirmBatchDelete ? (
                  <div className="inline-flex items-center gap-1 rounded-lg bg-destructive px-2 py-1 text-white">
                    <span>确定删除?</span>
                    <button
                      type="button"
                      onClick={() => {
                        onBatchDelete(selectedIdList)
                        clearSelection()
                      }}
                      className="underline font-bold cursor-pointer"
                    >
                      是
                    </button>
                    <button
                      type="button"
                      onClick={() => setConfirmBatchDelete(false)}
                      className="opacity-80 cursor-pointer ml-1"
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
              className="ml-1 rounded-lg p-1 text-muted-foreground hover:text-foreground cursor-pointer"
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
