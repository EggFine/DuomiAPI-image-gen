import React, { useEffect, useMemo, useState } from "react"
import {
  AlertCircle,
  AlertTriangle,
  Archive,
  CheckSquare,
  Copy,
  Download,
  Frame,
  Grid2X2,
  Image as ImageIcon,
  ImagePlus,
  LayoutGrid,
  LayoutList,
  Loader2,
  Maximize2,
  RefreshCw,
  RotateCcw,
  Search,
  Square,
  Star,
  StopCircle,
  Trash2,
} from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import {
  formatBytes,
  formatDurationSeconds,
  formatStateLabel,
  formatUnixTime,
} from "@/lib/studio-utils"
import { cn } from "@/lib/utils"
import type { SavedImage, TaskRecord } from "@/types"

export type GalleryViewMode = "natural" | "grid" | "compact" | "list"

interface GalleryPanelProps {
  records: TaskRecord[]
  refreshingIds: Record<string, boolean>
  onRefreshAll: () => void
  onRefreshSingle: (id: string) => void
  onCancelPolling: (id: string) => void
  onToggleStar: (rec: TaskRecord) => void
  onOpenLightbox: (rec: TaskRecord, imgIdx: number) => void
  onUseGeneratedAsRef: (img: SavedImage, rec: TaskRecord) => void
  onReuseRecord: (rec: TaskRecord, includeRefs: boolean) => void
  onRetryRecord: (rec: TaskRecord) => void
  onDownloadMissingLocal: (rec: TaskRecord) => void
  onDeleteSingle: (rec: TaskRecord) => void
  onBatchDelete: (ids: string[]) => void
  onClearFailed: () => void
  onCopyText: (text: string, msg?: string) => void
}

export const GalleryPanel: React.FC<GalleryPanelProps> = ({
  records,
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
  onCopyText,
}) => {
  const [filterTab, setFilterTab] = useState<string>("all")
  const [searchQuery, setSearchQuery] = useState<string>("")
  const [modelFilter, setModelFilter] = useState<string>("all")
  const [viewMode, setViewMode] = useState<GalleryViewMode>(() => {
    const saved = localStorage.getItem("duomi_gallery_view") as GalleryViewMode
    return saved || "natural"
  })

  const [selectMode, setSelectMode] = useState<boolean>(false)
  const [selectedIds, setSelectedIds] = useState<Record<string, boolean>>({})
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null)
  const [confirmBatchDelete, setConfirmBatchDelete] = useState<boolean>(false)
  const [confirmClearFailed, setConfirmClearFailed] = useState<boolean>(false)
  const [nowSec, setNowSec] = useState<number>(() => Math.floor(Date.now() / 1000))

  useEffect(() => {
    localStorage.setItem("duomi_gallery_view", viewMode)
  }, [viewMode])

  const hasRunning = useMemo(
    () => records.some((r) => r.state === "pending" || r.state === "running"),
    [records]
  )

  useEffect(() => {
    if (!hasRunning) return
    const timer = setInterval(() => {
      setNowSec(Math.floor(Date.now() / 1000))
    }, 1000)
    return () => clearInterval(timer)
  }, [hasRunning])

  const distinctModels = useMemo(() => {
    const set = new Set<string>()
    for (const r of records) {
      if (r.model) set.add(r.model)
    }
    return Array.from(set)
  }, [records])

  const counts = useMemo(() => {
    const all = records.length
    const active = records.filter(
      (r) => r.state === "pending" || r.state === "running"
    ).length
    const succeeded = records.filter((r) => r.state === "succeeded").length
    const starred = records.filter((r) => r.starred).length
    const failed = records.filter(
      (r) =>
        r.state === "error" ||
        r.state === "failed" ||
        r.state === "timeout" ||
        r.state === "canceled"
    ).length
    return { all, active, succeeded, starred, failed }
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
      if (filterTab === "succeeded" && r.state !== "succeeded") return false
      if (filterTab === "starred" && !r.starred) return false
      if (
        filterTab === "failed" &&
        r.state !== "error" &&
        r.state !== "failed" &&
        r.state !== "timeout" &&
        r.state !== "canceled"
      ) {
        return false
      }
      if (modelFilter !== "all" && r.model !== modelFilter) return false
      if (q) {
        const hay = `${r.id} ${r.model} ${r.prompt} ${r.size || ""}`.toLowerCase()
        return hay.includes(q)
      }
      return true
    })
  }, [records, filterTab, modelFilter, searchQuery])

  const selectedIdList = useMemo(
    () => Object.keys(selectedIds).filter((id) => selectedIds[id]),
    [selectedIds]
  )

  const toggleSelectOne = (id: string) => {
    setSelectedIds((prev) => ({ ...prev, [id]: !prev[id] }))
  }

  const selectAllFiltered = () => {
    const next: Record<string, boolean> = {}
    for (const r of filteredRecords) {
      next[r.id] = true
    }
    setSelectedIds(next)
  }

  const clearSelection = () => {
    setSelectedIds({})
    setConfirmBatchDelete(false)
  }

  return (
    <section
      aria-label="生成记录与本地图库"
      className="flex flex-col h-full overflow-hidden bg-background relative"
    >
      {/* Top Gallery Filter & Control Bar */}
      <div className="flex flex-col gap-2.5 border-b border-border bg-card/45 px-4 py-2.5 sm:px-5 shrink-0">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <Tabs
            value={filterTab}
            onValueChange={setFilterTab}
            className="w-full xl:w-auto overflow-x-auto"
          >
            <TabsList className="inline-flex w-max min-w-full sm:min-w-0">
              <TabsTrigger value="all" className="gap-1 text-xs">
                全部
                <span className="font-mono text-[10px] opacity-75 tabular-nums">
                  {counts.all}
                </span>
              </TabsTrigger>
              <TabsTrigger value="active" className="gap-1 text-xs">
                进行中
                <span className="font-mono text-[10px] opacity-75 tabular-nums">
                  {counts.active}
                </span>
              </TabsTrigger>
              <TabsTrigger value="succeeded" className="gap-1 text-xs">
                已完成
                <span className="font-mono text-[10px] opacity-75 tabular-nums">
                  {counts.succeeded}
                </span>
              </TabsTrigger>
              <TabsTrigger value="starred" className="gap-1 text-xs">
                <Star className="h-3 w-3 text-amber-500 fill-amber-500" />
                收藏
                <span className="font-mono text-[10px] opacity-75 tabular-nums">
                  {counts.starred}
                </span>
              </TabsTrigger>
              <TabsTrigger value="failed" className="gap-1 text-xs">
                失败/超时
                <span className="font-mono text-[10px] opacity-75 tabular-nums">
                  {counts.failed}
                </span>
              </TabsTrigger>
            </TabsList>
          </Tabs>

          <div className="flex flex-1 xl:flex-initial items-center gap-1.5 justify-end flex-wrap">
            <div className="relative flex-1 sm:w-52 min-w-[150px]">
              <Search className="pointer-events-none absolute left-2.5 top-2 h-3.5 w-3.5 text-muted-foreground" />
              <Input
                id="input-search-records"
                type="search"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="检索提示词 / 模型 / ID..."
                className="h-7 pl-8 text-xs"
              />
            </div>

            {distinctModels.length > 1 && (
              <select
                aria-label="按模型筛选"
                value={modelFilter}
                onChange={(e) => setModelFilter(e.target.value)}
                className="h-7 rounded-md border border-border bg-card px-2 text-xs text-foreground focus:outline-none"
              >
                <option value="all">全部模型</option>
                {distinctModels.map((m) => (
                  <option key={m} value={m}>
                    {m}
                  </option>
                ))}
              </select>
            )}

            {/* 4-Way View Mode Switcher */}
            <div
              role="group"
              aria-label="画廊视图切换"
              className="inline-flex items-center rounded-lg border border-border bg-card p-0.5"
            >
              {(
                [
                  { mode: "natural", icon: Frame, tip: "原比例完整画幅（不裁切）" },
                  { mode: "grid", icon: Grid2X2, tip: "规整 4:3 画廊网格" },
                  { mode: "compact", icon: LayoutGrid, tip: "紧凑多列网格" },
                  { mode: "list", icon: LayoutList, tip: "详情宽列表视图" },
                ] as const
              ).map(({ mode, icon: Icon, tip }) => (
                <Tooltip key={mode}>
                  <TooltipTrigger asChild>
                    <button
                      type="button"
                      onClick={() => setViewMode(mode)}
                      className={cn(
                        "flex h-6 w-6 items-center justify-center rounded-md transition-colors cursor-pointer",
                        viewMode === mode
                          ? "bg-amber-500/20 text-amber-600 dark:text-amber-400"
                          : "text-muted-foreground hover:text-foreground"
                      )}
                      aria-label={tip}
                    >
                      <Icon className="h-3.5 w-3.5" />
                    </button>
                  </TooltipTrigger>
                  <TooltipContent>{tip}</TooltipContent>
                </Tooltip>
              ))}
            </div>

            <Button
              type="button"
              variant={selectMode ? "brand" : "outline"}
              size="xs"
              className="h-7"
              onClick={() => {
                setSelectMode((prev) => !prev)
                if (selectMode) clearSelection()
              }}
            >
              <CheckSquare className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">
                {selectMode ? "退出多选" : "批量选择"}
              </span>
            </Button>

            {counts.succeeded > 0 && !selectMode && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    asChild
                    variant="outline"
                    size="xs"
                    className="h-7"
                  >
                    <a href="/api/records/export-zip" download>
                      <Archive className="h-3.5 w-3.5" />
                      <span className="hidden md:inline">导出ZIP</span>
                    </a>
                  </Button>
                </TooltipTrigger>
                <TooltipContent>
                  将所有已下载原图及参数清单打包导出为单个 ZIP 压缩包
                </TooltipContent>
              </Tooltip>
            )}

            {counts.failed > 0 && !selectMode && (
              confirmClearFailed ? (
                <div className="inline-flex items-center gap-1 rounded-md border border-destructive/50 bg-destructive/10 px-1.5 py-0.5">
                  <span className="text-[11px] text-destructive font-medium">
                    确认清理 {counts.failed} 条失败?
                  </span>
                  <button
                    type="button"
                    onClick={() => {
                      onClearFailed()
                      setConfirmClearFailed(false)
                    }}
                    className="rounded bg-destructive px-1.5 py-0.5 text-[10px] font-semibold text-white cursor-pointer"
                  >
                    确定
                  </button>
                  <button
                    type="button"
                    onClick={() => setConfirmClearFailed(false)}
                    className="text-[10px] text-muted-foreground px-1 cursor-pointer"
                  >
                    取消
                  </button>
                </div>
              ) : (
                <Button
                  type="button"
                  variant="outline"
                  size="xs"
                  className="h-7 text-muted-foreground hover:text-destructive"
                  onClick={() => setConfirmClearFailed(true)}
                >
                  <Trash2 className="h-3 w-3" />
                  <span className="hidden md:inline">清理失败</span>
                </Button>
              )
            )}

            <Button
              id="btn-refresh-records"
              type="button"
              variant="outline"
              size="xs"
              className="h-7"
              onClick={onRefreshAll}
            >
              <RefreshCw className="h-3 w-3" />
              <span className="hidden sm:inline">刷新</span>
            </Button>
          </div>
        </div>

        {/* Batch Action Bar when Select Mode is Active */}
        {selectMode && (
          <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-amber-500/35 bg-amber-500/[0.08] px-3 py-1.5 text-xs">
            <div className="flex items-center gap-2.5">
              <span className="font-semibold text-foreground tabular-nums">
                已选择 {selectedIdList.length} 项
              </span>
              <button
                type="button"
                onClick={selectAllFiltered}
                className="text-amber-600 dark:text-amber-400 hover:underline cursor-pointer"
              >
                全选当前筛选 ({filteredRecords.length})
              </button>
              {selectedIdList.length > 0 && (
                <button
                  type="button"
                  onClick={clearSelection}
                  className="text-muted-foreground hover:text-foreground cursor-pointer"
                >
                  取消全选
                </button>
              )}
            </div>

            <div className="flex items-center gap-2">
              {selectedIdList.length > 0 && (
                <>
                  <Button asChild variant="secondary" size="xs" className="h-7">
                    <a
                      href={`/api/records/export-zip?ids=${encodeURIComponent(
                        selectedIdList.join(",")
                      )}`}
                      download
                    >
                      <Archive className="h-3.5 w-3.5" />
                      打包下载选中 ({selectedIdList.length})
                    </a>
                  </Button>

                  {confirmBatchDelete ? (
                    <div className="inline-flex items-center gap-1.5 rounded-md bg-destructive/15 border border-destructive/40 px-2 py-0.5">
                      <span className="text-[11px] text-destructive font-medium">
                        确定删除这 {selectedIdList.length} 条记录及原图？
                      </span>
                      <button
                        type="button"
                        onClick={() => {
                          onBatchDelete(selectedIdList)
                          clearSelection()
                        }}
                        className="rounded bg-destructive px-2 py-0.5 text-[11px] font-semibold text-white cursor-pointer"
                      >
                        确认删除
                      </button>
                      <button
                        type="button"
                        onClick={() => setConfirmBatchDelete(false)}
                        className="text-[11px] text-muted-foreground hover:text-foreground cursor-pointer"
                      >
                        取消
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
                      批量删除
                    </Button>
                  )}
                </>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Records Scroll Area */}
      <div className="flex-1 overflow-y-auto p-4 sm:p-5">
        {filteredRecords.length === 0 ? (
          <div className="flex h-[380px] flex-col items-center justify-center rounded-2xl border border-dashed border-border bg-card/30 p-8 text-center">
            <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-secondary text-muted-foreground mb-3">
              <ImageIcon className="h-6 w-6" />
            </div>
            <h2 className="text-sm font-semibold text-foreground">
              暂无匹配的图像生成记录
            </h2>
            <p className="mt-1 max-w-md text-xs text-muted-foreground leading-relaxed">
              在左侧工作台选择画幅比例、分辨率与模型后输入描述词即可创建异步生图任务；支持将本地参考图自动无损上传至图床，生成的原图均保存在{" "}
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
              viewMode === "list"
                ? "grid-cols-1"
                : viewMode === "compact"
                ? "grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4"
                : "grid-cols-1 md:grid-cols-2 xl:grid-cols-3"
            )}
          >
            {filteredRecords.map((rec) => {
              const images = rec.images || []
              const isPending =
                rec.state === "pending" || rec.state === "running"
              const isSucceeded = rec.state === "succeeded" && images.length > 0
              const isFailed =
                rec.state === "error" ||
                rec.state === "failed" ||
                rec.state === "timeout" ||
                rec.state === "canceled"
              const isRefreshing = !!refreshingIds[rec.id]
              const isChecked = !!selectedIds[rec.id]
              const pct = Math.max(
                12,
                rec.progress || (rec.state === "running" ? 52 : 20)
              )
              const elapsedSec = isPending
                ? Math.max(1, nowSec - (rec.create_time || nowSec))
                : rec.duration_ms
                ? Math.round(rec.duration_ms / 1000)
                : 0

              const missingLocalFile =
                isSucceeded && images.some((i) => !i.local_file && i.remote_url)

              return (
                <Card
                  key={rec.id}
                  onClick={
                    selectMode ? () => toggleSelectOne(rec.id) : undefined
                  }
                  className={cn(
                    "group flex overflow-hidden transition-all hover:border-border/90 hover:shadow-md",
                    viewMode === "list"
                      ? "flex-col sm:flex-row"
                      : "flex-col",
                    selectMode && "cursor-pointer",
                    isChecked && "ring-2 ring-amber-500 border-amber-500/70"
                  )}
                >
                  {/* Media Canvas */}
                  <div
                    className={cn(
                      "relative overflow-hidden bg-secondary/45",
                      viewMode === "list"
                        ? "w-full sm:w-64 md:w-72 shrink-0 aspect-[4/3] sm:aspect-auto sm:min-h-[190px] border-b sm:border-b-0 sm:border-r border-border"
                        : viewMode === "natural"
                        ? "w-full min-h-[200px] max-h-[380px] flex items-center justify-center border-b border-border bg-checkerboard"
                        : "aspect-[4/3] w-full border-b border-border"
                    )}
                  >
                    {/* Top Left Selection Checkbox or Star Button */}
                    <div
                      className="absolute left-2.5 top-2.5 z-10 flex items-center gap-1.5"
                      onClick={(e) => e.stopPropagation()}
                    >
                      {selectMode ? (
                        <button
                          type="button"
                          onClick={() => toggleSelectOne(rec.id)}
                          className="flex h-6 w-6 items-center justify-center rounded-md bg-black/70 text-white cursor-pointer"
                        >
                          {isChecked ? (
                            <CheckSquare className="h-4 w-4 text-amber-400" />
                          ) : (
                            <Square className="h-4 w-4" />
                          )}
                        </button>
                      ) : (
                        <button
                          type="button"
                          onClick={() => onToggleStar(rec)}
                          title={rec.starred ? "取消收藏" : "收藏此作品"}
                          className={cn(
                            "flex h-6 w-6 items-center justify-center rounded-md backdrop-blur-xs transition-opacity cursor-pointer",
                            rec.starred
                              ? "bg-black/70 text-amber-400 opacity-100"
                              : "bg-black/55 text-white/80 opacity-0 group-hover:opacity-100 hover:text-amber-400"
                          )}
                        >
                          <Star
                            className={cn(
                              "h-3.5 w-3.5",
                              rec.starred && "fill-amber-400"
                            )}
                          />
                        </button>
                      )}
                    </div>

                    {isSucceeded ? (
                      <div
                        className={cn(
                          "h-full w-full bg-checkerboard",
                          images.length > 1
                            ? "grid grid-cols-2 gap-0.5"
                            : "flex items-center justify-center"
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
                              className="relative h-full w-full overflow-hidden group/img flex items-center justify-center"
                            >
                              <img
                                src={src}
                                alt={rec.prompt}
                                loading="lazy"
                                onClick={(e) => {
                                  if (selectMode) return
                                  e.stopPropagation()
                                  onOpenLightbox(rec, idx)
                                }}
                                className={cn(
                                  "transition-transform duration-300 group-hover/img:scale-[1.02] cursor-zoom-in",
                                  viewMode === "natural" && images.length === 1
                                    ? "max-h-[370px] w-full object-contain"
                                    : "h-full w-full object-cover"
                                )}
                              />

                              {!selectMode && (
                                <div
                                  onClick={(e) => e.stopPropagation()}
                                  className="pointer-events-none absolute inset-x-0 bottom-0 flex items-center justify-between gap-1 bg-gradient-to-t from-black/80 via-black/35 to-transparent p-2.5 opacity-0 transition-opacity group-hover/img:opacity-100"
                                >
                                  <div className="flex items-center gap-1">
                                    <button
                                      type="button"
                                      onClick={() => onOpenLightbox(rec, idx)}
                                      className="pointer-events-auto inline-flex items-center gap-1 rounded-md bg-black/75 px-2 py-1 text-[11px] font-medium text-white hover:bg-black cursor-pointer"
                                    >
                                      <Maximize2 className="h-3 w-3" />
                                      检视
                                    </button>
                                    <button
                                      type="button"
                                      onClick={() =>
                                        onUseGeneratedAsRef(img, rec)
                                      }
                                      title="将此图添加到左侧参考图继续图生图微调"
                                      className="pointer-events-auto inline-flex items-center gap-1 rounded-md bg-black/75 px-2 py-1 text-[11px] font-medium text-white hover:bg-amber-500 hover:text-zinc-950 cursor-pointer"
                                    >
                                      <ImagePlus className="h-3 w-3" />
                                      作参考图
                                    </button>
                                  </div>
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
                              )}
                            </div>
                          )
                        })}
                      </div>
                    ) : isPending ? (
                      <div className="flex h-full min-h-[190px] w-full flex-col items-center justify-center p-5 text-center space-y-3">
                        <Loader2 className="h-7 w-7 animate-spin text-amber-500" />
                        <div className="space-y-0.5">
                          <p className="text-xs font-semibold text-foreground">
                            {formatStateLabel(rec.state, rec.progress)}
                          </p>
                          <p className="font-mono text-[11px] text-muted-foreground tabular-nums">
                            已用时 {formatDurationSeconds(elapsedSec)} · ID:{" "}
                            {rec.id.slice(0, 10)}
                          </p>
                        </div>
                        <div className="relative h-1.5 w-44 overflow-hidden rounded-full bg-secondary">
                          <div
                            className="h-full rounded-full bg-amber-500 transition-all duration-500"
                            style={{ width: `${pct}%` }}
                          />
                        </div>
                        {!selectMode && (
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation()
                              onCancelPolling(rec.id)
                            }}
                            className="inline-flex items-center gap-1 text-[11px] text-muted-foreground hover:text-destructive cursor-pointer"
                          >
                            <StopCircle className="h-3 w-3" />
                            停止轮询
                          </button>
                        )}
                      </div>
                    ) : (
                      <div className="flex h-full min-h-[190px] w-full flex-col items-center justify-center p-5 text-center space-y-2">
                        <AlertCircle className="h-6 w-6 text-destructive" />
                        <p className="text-xs font-semibold text-destructive">
                          {formatStateLabel(rec.state)}
                        </p>
                        <p className="text-[11px] text-muted-foreground line-clamp-3 max-w-xs leading-relaxed">
                          {rec.error_msg || "生成未完成"}
                        </p>
                        {!selectMode && (
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
                            按原参数重新提交
                          </Button>
                        )}
                      </div>
                    )}
                  </div>

                  {/* Card Metadata & Actions */}
                  <div
                    className="flex flex-1 flex-col justify-between p-3.5 space-y-2.5"
                    onClick={(e) => selectMode && e.stopPropagation()}
                  >
                    <div className="space-y-2">
                      <div className="flex items-center justify-between gap-2">
                        <div className="flex items-center gap-1.5">
                          <Badge
                            variant={
                              rec.state === "succeeded"
                                ? "success"
                                : isPending
                                ? "warning"
                                : "destructive"
                            }
                            className="text-[10px] px-1.5 py-0"
                          >
                            {formatStateLabel(rec.state, rec.progress)}
                          </Badge>
                          {images[0]?.width && images[0]?.height ? (
                            <span className="font-mono text-[10px] text-muted-foreground tabular-nums">
                              {images[0].width}×{images[0].height}
                              {images[0].size_bytes
                                ? ` · ${formatBytes(images[0].size_bytes)}`
                                : ""}
                            </span>
                          ) : null}
                        </div>
                        <span className="font-mono text-[10px] text-muted-foreground tabular-nums">
                          {formatUnixTime(rec.create_time)}
                        </span>
                      </div>

                      {rec.warning_msg && (
                        <div className="flex items-start gap-1.5 rounded-md border border-amber-500/30 bg-amber-500/10 px-2 py-1 text-[10px] text-amber-700 dark:text-amber-300">
                          <AlertTriangle className="h-3 w-3 shrink-0 mt-0.5" />
                          <span className="leading-snug">{rec.warning_msg}</span>
                        </div>
                      )}

                      <p
                        title={rec.prompt}
                        className={cn(
                          "text-xs text-foreground leading-relaxed",
                          viewMode === "list" ? "line-clamp-4" : "line-clamp-2"
                        )}
                      >
                        {rec.prompt}
                      </p>

                      {/* Parameter Badges & Mini Reference Previews */}
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

                      {/* Mini Reference Thumbnails if cached */}
                      {rec.ref_items && rec.ref_items.length > 0 && (
                        <div className="flex items-center gap-1.5 pt-0.5">
                          <span className="text-[10px] text-muted-foreground">
                            参考源:
                          </span>
                          <div className="flex items-center gap-1">
                            {rec.ref_items.slice(0, 4).map((ri, rIdx) => {
                              const rSrc = ri.local_ref
                                ? `/images/${ri.local_ref}`
                                : ri.remote_url
                              if (!rSrc) return null
                              return (
                                <img
                                  key={rIdx}
                                  src={rSrc}
                                  alt={`参考${rIdx + 1}`}
                                  className="h-6 w-6 rounded border border-border object-cover"
                                />
                              )
                            })}
                          </div>
                        </div>
                      )}
                    </div>

                    {/* Footer Action Bar */}
                    <div className="flex items-center justify-between border-t border-border/60 pt-2">
                      <div className="flex items-center gap-0.5 flex-wrap">
                        <Button
                          type="button"
                          variant="ghost"
                          size="xs"
                          className="h-6 px-2 text-[11px]"
                          disabled={isRefreshing}
                          onClick={() => onRefreshSingle(rec.id)}
                          title="向多米 API 同步最新状态"
                        >
                          <RefreshCw
                            className={cn(
                              "h-3 w-3",
                              isRefreshing && "animate-spin"
                            )}
                          />
                          同步
                        </Button>

                        <Button
                          type="button"
                          variant="ghost"
                          size="xs"
                          className="h-6 px-2 text-[11px]"
                          onClick={() => onReuseRecord(rec, true)}
                          title="将提示词、模型、尺寸及参考图完整回填至左侧工作台"
                        >
                          <RotateCcw className="h-3 w-3" />
                          复用全套
                        </Button>

                        {missingLocalFile && (
                          <Button
                            type="button"
                            variant="ghost"
                            size="xs"
                            className="h-6 px-2 text-[11px] text-amber-500"
                            onClick={() => onDownloadMissingLocal(rec)}
                          >
                            <Download className="h-3 w-3" />
                            补下原图
                          </Button>
                        )}

                        {isFailed && (
                          <Button
                            type="button"
                            variant="ghost"
                            size="xs"
                            className="h-6 px-2 text-[11px] text-amber-500"
                            onClick={() => onRetryRecord(rec)}
                          >
                            重试
                          </Button>
                        )}

                        <Button
                          type="button"
                          variant="ghost"
                          size="xs"
                          className="h-6 px-1.5 text-[11px]"
                          onClick={() =>
                            onCopyText(rec.id, `已复制任务 ID: ${rec.id}`)
                          }
                          title="复制任务 ID"
                        >
                          <Copy className="h-3 w-3" />
                          ID
                        </Button>
                      </div>

                      {/* Non-blocking Inline Delete Confirmation */}
                      {confirmDeleteId === rec.id ? (
                        <div className="inline-flex items-center gap-1">
                          <button
                            type="button"
                            onClick={() => {
                              onDeleteSingle(rec)
                              setConfirmDeleteId(null)
                            }}
                            className="rounded bg-destructive px-2 py-0.5 text-[10px] font-semibold text-white cursor-pointer"
                          >
                            确认删
                          </button>
                          <button
                            type="button"
                            onClick={() => setConfirmDeleteId(null)}
                            className="text-[10px] text-muted-foreground px-1 cursor-pointer"
                          >
                            取消
                          </button>
                        </div>
                      ) : (
                        <Button
                          type="button"
                          variant="ghost"
                          size="xs"
                          className="h-6 px-1.5 text-muted-foreground hover:text-destructive"
                          onClick={() => setConfirmDeleteId(rec.id)}
                          title="删除记录与本地图片"
                        >
                          <Trash2 className="h-3 w-3" />
                        </Button>
                      )}
                    </div>
                  </div>
                </Card>
              )
            })}
          </div>
        )}
      </div>
    </section>
  )
}
