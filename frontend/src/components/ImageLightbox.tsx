import React, { useEffect, useMemo, useState } from "react"
import {
  ChevronLeft,
  ChevronRight,
  Columns2,
  Copy,
  Download,
  ExternalLink,
  FolderOpen,
  ImagePlus,
  Maximize,
  RotateCcw,
  Star,
  ZoomIn,
  ZoomOut,
} from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  copyImageToClipboard,
  formatBytes,
  formatUnixTime,
} from "@/lib/studio-utils"
import { cn } from "@/lib/utils"
import type { SavedImage, TaskRecord } from "@/types"

interface ImageLightboxProps {
  record: TaskRecord | null
  imageIndex: number
  onChangeImageIndex: (idx: number) => void
  onClose: () => void
  onNavigateRecord?: (direction: -1 | 1) => void
  hasPrevRecord?: boolean
  hasNextRecord?: boolean
  onToggleStar: (rec: TaskRecord) => void
  onUseGeneratedAsRef: (img: SavedImage, rec: TaskRecord) => void
  onReuseRecord: (rec: TaskRecord, includeRefs: boolean) => void
  onOpenLocalFolder: (targetFile?: string) => void
  onCopyText: (text: string, msg?: string) => void
  onToast: (msg: string, type?: "info" | "success" | "error") => void
}

export const ImageLightbox: React.FC<ImageLightboxProps> = ({
  record,
  imageIndex,
  onChangeImageIndex,
  onClose,
  onNavigateRecord,
  hasPrevRecord,
  hasNextRecord,
  onToggleStar,
  onUseGeneratedAsRef,
  onReuseRecord,
  onOpenLocalFolder,
  onCopyText,
  onToast,
}) => {
  const [zoom, setZoom] = useState<number>(1)
  const [pan, setPan] = useState<{ x: number; y: number }>({ x: 0, y: 0 })
  const [dragging, setDragging] = useState<boolean>(false)
  const [dragOrigin, setDragOrigin] = useState<{ x: number; y: number }>({
    x: 0,
    y: 0,
  })
  const [compareMode, setCompareMode] = useState<boolean>(false)
  const [activeRefIdx, setActiveRefIdx] = useState<number>(0)
  const [showRawJson, setShowRawJson] = useState<boolean>(false)
  const [naturalDim, setNaturalDim] = useState<{ w: number; h: number } | null>(
    null
  )
  const [copyingImg, setCopyingImg] = useState<boolean>(false)

  const imgs = record?.images || []
  const activeImg = imgs[imageIndex] || imgs[0]

  const validRefSources = useMemo(() => {
    if (!record?.ref_items) return []
    return record.ref_items
      .map((ri) => ({
        ...ri,
        src: ri.local_ref ? `/images/${ri.local_ref}` : ri.remote_url || "",
      }))
      .filter((ri) => Boolean(ri.src))
  }, [record])

  // Reset zoom/pan when switching image or record
  useEffect(() => {
    setZoom(1)
    setPan({ x: 0, y: 0 })
    setNaturalDim(null)
    setActiveRefIdx(0)
    if (!validRefSources.length) {
      setCompareMode(false)
    }
  }, [record?.id, imageIndex, validRefSources.length])

  // Keyboard shortcuts inside Lightbox
  useEffect(() => {
    if (!record) return
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "ArrowLeft") {
        e.preventDefault()
        if (imgs.length > 1 && imageIndex > 0) {
          onChangeImageIndex(imageIndex - 1)
        } else if (onNavigateRecord && hasPrevRecord) {
          onNavigateRecord(-1)
        }
      } else if (e.key === "ArrowRight") {
        e.preventDefault()
        if (imgs.length > 1 && imageIndex < imgs.length - 1) {
          onChangeImageIndex(imageIndex + 1)
        } else if (onNavigateRecord && hasNextRecord) {
          onNavigateRecord(1)
        }
      } else if (e.key === "+" || e.key === "=") {
        setZoom((z) => Math.min(5, +(z + 0.25).toFixed(2)))
      } else if (e.key === "-") {
        setZoom((z) => {
          const next = Math.max(0.5, +(z - 0.25).toFixed(2))
          if (next <= 1) setPan({ x: 0, y: 0 })
          return next
        })
      } else if (e.key === "0") {
        setZoom(1)
        setPan({ x: 0, y: 0 })
      } else if ((e.key === "c" || e.key === "C") && validRefSources.length > 0) {
        setCompareMode((prev) => !prev)
      }
    }
    window.addEventListener("keydown", handleKey)
    return () => window.removeEventListener("keydown", handleKey)
  }, [
    record,
    imgs.length,
    imageIndex,
    onChangeImageIndex,
    onNavigateRecord,
    hasPrevRecord,
    hasNextRecord,
    validRefSources.length,
  ])

  if (!record) return null

  const imgSrc = activeImg
    ? activeImg.local_file
      ? `/images/${encodeURIComponent(activeImg.local_file)}`
      : activeImg.remote_url
    : ""
  const dlHref = activeImg
    ? activeImg.local_file
      ? `/images/${encodeURIComponent(activeImg.local_file)}?download=1`
      : activeImg.remote_url
    : "#"

  const dispW = activeImg?.width || naturalDim?.w || 0
  const dispH = activeImg?.height || naturalDim?.h || 0

  const formattedJson = (() => {
    if (!record.raw_response) return ""
    try {
      return JSON.stringify(JSON.parse(record.raw_response), null, 2)
    } catch {
      return record.raw_response
    }
  })()

  return (
    <Dialog
      open={Boolean(record)}
      onOpenChange={(open) => {
        if (!open) onClose()
      }}
    >
      <DialogContent className="max-w-[95vw] xl:max-w-7xl p-0 overflow-hidden sm:rounded-2xl">
        <div className="grid grid-cols-1 lg:grid-cols-[1fr_360px] h-[90vh] max-h-[90vh]">
          {/* Left Interactive Inspection & Compare Canvas */}
          <div className="relative flex flex-col bg-zinc-950 text-zinc-100 overflow-hidden select-none">
            {/* Top Floating Canvas Toolbar */}
            <div className="z-20 flex flex-wrap items-center justify-between gap-2 border-b border-white/10 bg-zinc-900/90 px-4 py-2 backdrop-blur-md pr-12">
              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  onClick={() =>
                    setZoom((z) => {
                      const next = Math.max(0.5, +(z - 0.25).toFixed(2))
                      if (next <= 1) setPan({ x: 0, y: 0 })
                      return next
                    })
                  }
                  className="flex h-7 w-7 items-center justify-center rounded-md bg-white/10 hover:bg-white/20 cursor-pointer"
                  title="缩小 (-)"
                >
                  <ZoomOut className="h-3.5 w-3.5" />
                </button>
                <span className="w-12 text-center font-mono text-xs tabular-nums">
                  {Math.round(zoom * 100)}%
                </span>
                <button
                  type="button"
                  onClick={() =>
                    setZoom((z) => Math.min(5, +(z + 0.25).toFixed(2)))
                  }
                  className="flex h-7 w-7 items-center justify-center rounded-md bg-white/10 hover:bg-white/20 cursor-pointer"
                  title="放大 (+)"
                >
                  <ZoomIn className="h-3.5 w-3.5" />
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setZoom(1)
                    setPan({ x: 0, y: 0 })
                  }}
                  className="rounded-md bg-white/10 px-2 py-1 text-[11px] hover:bg-white/20 cursor-pointer"
                  title="重置缩放适应窗口 (0)"
                >
                  <Maximize className="inline h-3 w-3 mr-1" />
                  适应窗口
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setZoom(2)
                    setPan({ x: 0, y: 0 })
                  }}
                  className="rounded-md bg-white/10 px-2 py-1 font-mono text-[11px] hover:bg-white/20 cursor-pointer"
                  title="200% 放大检视细节"
                >
                  200% 细节
                </button>
              </div>

              <div className="flex items-center gap-2">
                {validRefSources.length > 0 && (
                  <button
                    type="button"
                    onClick={() => setCompareMode((prev) => !prev)}
                    className={cn(
                      "inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-medium transition-colors cursor-pointer",
                      compareMode
                        ? "bg-amber-500 text-zinc-950 font-semibold"
                        : "bg-white/10 text-zinc-200 hover:bg-white/20"
                    )}
                    title="同屏对比原始参考图与生成结果 (快捷键 C)"
                  >
                    <Columns2 className="h-3.5 w-3.5" />
                    {compareMode ? "退出参考对比" : "同屏对比参考图"}
                  </button>
                )}

                {dispW > 0 && dispH > 0 && (
                  <span className="hidden sm:inline-block rounded-md bg-white/10 px-2 py-1 font-mono text-[11px] text-zinc-300 tabular-nums">
                    {dispW} × {dispH} px
                    {activeImg?.size_bytes
                      ? ` · ${formatBytes(activeImg.size_bytes)}`
                      : ""}
                  </span>
                )}
              </div>
            </div>

            {/* Main Viewport */}
            <div
              onWheel={(e) => {
                e.preventDefault()
                const delta = e.deltaY < 0 ? 0.2 : -0.2
                setZoom((prev) => {
                  const next = Math.max(0.5, Math.min(5, +(prev + delta).toFixed(2)))
                  if (next <= 1) setPan({ x: 0, y: 0 })
                  return next
                })
              }}
              onMouseDown={(e) => {
                if (zoom <= 1) return
                setDragging(true)
                setDragOrigin({ x: e.clientX - pan.x, y: e.clientY - pan.y })
              }}
              onMouseMove={(e) => {
                if (!dragging) return
                setPan({
                  x: e.clientX - dragOrigin.x,
                  y: e.clientY - dragOrigin.y,
                })
              }}
              onMouseUp={() => setDragging(false)}
              onMouseLeave={() => setDragging(false)}
              className={cn(
                "relative flex-1 flex items-center justify-center overflow-hidden bg-checkerboard p-4",
                zoom > 1
                  ? dragging
                    ? "cursor-grabbing"
                    : "cursor-grab"
                  : "cursor-default"
              )}
            >
              {/* Left / Right Gallery Navigation Arrows */}
              {onNavigateRecord && hasPrevRecord && (
                <button
                  type="button"
                  onClick={() => onNavigateRecord(-1)}
                  title="上一条作品 (←)"
                  className="absolute left-3 top-1/2 z-20 -translate-y-1/2 flex h-9 w-9 items-center justify-center rounded-full bg-black/70 text-white hover:bg-amber-500 hover:text-zinc-950 transition-colors cursor-pointer"
                >
                  <ChevronLeft className="h-5 w-5" />
                </button>
              )}
              {onNavigateRecord && hasNextRecord && (
                <button
                  type="button"
                  onClick={() => onNavigateRecord(1)}
                  title="下一条作品 (→)"
                  className="absolute right-3 top-1/2 z-20 -translate-y-1/2 flex h-9 w-9 items-center justify-center rounded-full bg-black/70 text-white hover:bg-amber-500 hover:text-zinc-950 transition-colors cursor-pointer"
                >
                  <ChevronRight className="h-5 w-5" />
                </button>
              )}

              {compareMode && validRefSources.length > 0 ? (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 w-full h-full items-center">
                  {/* Left: Original Reference Image */}
                  <div className="flex flex-col items-center justify-center h-full overflow-hidden rounded-xl border border-white/15 bg-black/50 p-3">
                    <div className="mb-2 flex items-center justify-between w-full px-1">
                      <Badge variant="outline" className="border-white/25 text-zinc-200 text-[11px]">
                        输入参考图 #{activeRefIdx + 1}
                      </Badge>
                      {validRefSources.length > 1 && (
                        <div className="flex gap-1">
                          {validRefSources.map((_, rIdx) => (
                            <button
                              key={rIdx}
                              type="button"
                              onClick={() => setActiveRefIdx(rIdx)}
                              className={cn(
                                "rounded px-1.5 py-0.5 font-mono text-[10px] cursor-pointer",
                                activeRefIdx === rIdx
                                  ? "bg-amber-500 text-zinc-950 font-bold"
                                  : "bg-white/10 text-zinc-300"
                              )}
                            >
                              图{rIdx + 1}
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                    <img
                      src={validRefSources[activeRefIdx]?.src}
                      alt="参考原图"
                      draggable={false}
                      style={{
                        transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
                      }}
                      className="max-h-[66vh] max-w-full object-contain rounded transition-transform duration-75"
                    />
                  </div>

                  {/* Right: Generated Result Image */}
                  <div className="flex flex-col items-center justify-center h-full overflow-hidden rounded-xl border border-amber-500/35 bg-black/50 p-3">
                    <div className="mb-2 flex items-center justify-between w-full px-1">
                      <Badge variant="amber" className="text-[11px]">
                        生成结果图 ({record.model})
                      </Badge>
                      {dispW > 0 && (
                        <span className="font-mono text-[10px] text-zinc-400">
                          {dispW}×{dispH}
                        </span>
                      )}
                    </div>
                    {imgSrc && (
                      <img
                        src={imgSrc}
                        alt={record.prompt}
                        draggable={false}
                        onLoad={(e) =>
                          setNaturalDim({
                            w: e.currentTarget.naturalWidth,
                            h: e.currentTarget.naturalHeight,
                          })
                        }
                        style={{
                          transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
                        }}
                        className="max-h-[66vh] max-w-full object-contain rounded transition-transform duration-75"
                      />
                    )}
                  </div>
                </div>
              ) : (
                imgSrc && (
                  <img
                    src={imgSrc}
                    alt={record.prompt}
                    draggable={false}
                    onLoad={(e) =>
                      setNaturalDim({
                        w: e.currentTarget.naturalWidth,
                        h: e.currentTarget.naturalHeight,
                      })
                    }
                    style={{
                      transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
                    }}
                    className="max-h-[75vh] w-auto max-w-full rounded-lg object-contain shadow-2xl transition-transform duration-75"
                  />
                )
              )}
            </div>

            {/* Bottom Multi-Image Strip if task has >1 images */}
            {imgs.length > 1 && (
              <div className="z-20 flex items-center justify-center gap-2 border-t border-white/10 bg-zinc-900/90 p-2">
                {imgs.map((thumb, idx) => {
                  const tSrc = thumb.local_file
                    ? `/images/${encodeURIComponent(thumb.local_file)}`
                    : thumb.remote_url
                  return (
                    <button
                      key={idx}
                      type="button"
                      onClick={() => onChangeImageIndex(idx)}
                      className={cn(
                        "h-12 w-12 overflow-hidden rounded-lg border-2 transition-all cursor-pointer",
                        idx === imageIndex
                          ? "border-amber-500 scale-105"
                          : "border-transparent opacity-60 hover:opacity-100"
                      )}
                    >
                      <img
                        src={tSrc}
                        alt={`结果图 ${idx + 1}`}
                        className="h-full w-full object-cover"
                      />
                    </button>
                  )
                })}
              </div>
            )}
          </div>

          {/* Right Inspector Sidebar */}
          <div className="flex flex-col justify-between border-t lg:border-t-0 lg:border-l border-border bg-card p-4 sm:p-5 overflow-y-auto h-full space-y-4">
            <div className="space-y-4">
              <div className="flex items-start justify-between gap-2 pr-6">
                <div>
                  <DialogTitle className="text-sm font-semibold flex items-center gap-2">
                    <span>图像检视与任务详情</span>
                    <button
                      type="button"
                      onClick={() => onToggleStar(record)}
                      title={record.starred ? "取消收藏" : "收藏此作品"}
                      className="text-muted-foreground hover:text-amber-500 cursor-pointer"
                    >
                      <Star
                        className={cn(
                          "h-4 w-4",
                          record.starred && "text-amber-500 fill-amber-500"
                        )}
                      />
                    </button>
                  </DialogTitle>
                  <DialogDescription className="font-mono text-[11px] mt-1 break-all">
                    ID: {record.id}
                  </DialogDescription>
                </div>
              </div>

              {/* Prompt Section */}
              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-medium text-muted-foreground">
                    提示词 (Prompt)
                  </span>
                  <button
                    type="button"
                    onClick={() =>
                      onCopyText(record.prompt, "已复制完整提示词")
                    }
                    className="inline-flex items-center gap-1 text-[11px] text-amber-600 dark:text-amber-400 hover:underline cursor-pointer"
                  >
                    <Copy className="h-3 w-3" />
                    复制提示词
                  </button>
                </div>
                <div className="max-h-40 overflow-y-auto rounded-xl border border-border bg-background/60 p-3 text-xs leading-relaxed whitespace-pre-wrap">
                  {record.prompt}
                </div>
              </div>

              {/* Metadata Table */}
              <div className="space-y-1.5 text-xs">
                <span className="font-medium text-muted-foreground">
                  参数与实际文件规格
                </span>
                <div className="rounded-xl border border-border bg-background/60 p-3 space-y-1.5 font-mono text-[11px] tabular-nums">
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">生图模型:</span>
                    <span>{record.model}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">请求尺寸:</span>
                    <span>{record.size || "auto"}</span>
                  </div>
                  {dispW > 0 && dispH > 0 && (
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">实际分辨率:</span>
                      <span className="text-emerald-600 dark:text-emerald-400 font-semibold">
                        {dispW} × {dispH} px
                      </span>
                    </div>
                  )}
                  {activeImg?.size_bytes ? (
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">文件体积:</span>
                      <span>{formatBytes(activeImg.size_bytes)}</span>
                    </div>
                  ) : null}
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">思考深度:</span>
                    <span>{record.quality || "默认"}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">背景模式:</span>
                    <span>{record.background || "auto"}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">创建时间:</span>
                    <span>{formatUnixTime(record.create_time)}</span>
                  </div>

                  {activeImg?.local_file && (
                    <div className="pt-1.5 border-t border-border/60 flex items-center justify-between gap-2">
                      <span className="text-emerald-600 dark:text-emerald-400 truncate">
                        images/{activeImg.local_file}
                      </span>
                      <button
                        type="button"
                        onClick={() => onOpenLocalFolder(activeImg.local_file)}
                        className="shrink-0 inline-flex items-center gap-1 rounded border border-border bg-card px-1.5 py-0.5 text-[10px] text-foreground hover:bg-accent cursor-pointer"
                      >
                        <FolderOpen className="h-2.5 w-2.5 text-amber-500" />
                        定位文件
                      </button>
                    </div>
                  )}
                </div>
              </div>

              {/* Reference Images Used */}
              {validRefSources.length > 0 && (
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between text-xs">
                    <span className="font-medium text-muted-foreground">
                      任务参考图 ({validRefSources.length} 张)
                    </span>
                    <button
                      type="button"
                      onClick={() => setCompareMode((p) => !p)}
                      className="text-[11px] text-amber-600 dark:text-amber-400 hover:underline cursor-pointer"
                    >
                      {compareMode ? "关闭同屏对比" : "开启同屏对比"}
                    </button>
                  </div>
                  <div className="grid grid-cols-4 gap-1.5">
                    {validRefSources.map((ri, idx) => (
                      <button
                        key={idx}
                        type="button"
                        onClick={() => {
                          setActiveRefIdx(idx)
                          setCompareMode(true)
                        }}
                        className={cn(
                          "aspect-square overflow-hidden rounded-lg border transition-all cursor-pointer",
                          compareMode && activeRefIdx === idx
                            ? "border-amber-500 ring-1 ring-amber-500"
                            : "border-border hover:border-amber-500/50"
                        )}
                      >
                        <img
                          src={ri.src}
                          alt={`参考图 ${idx + 1}`}
                          className="h-full w-full object-cover"
                        />
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {/* Raw API JSON */}
              {record.raw_response && (
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
                      {formattedJson}
                    </pre>
                  )}
                </div>
              )}
            </div>

            {/* Bottom Actions */}
            <div className="flex flex-col gap-2 pt-3 border-t border-border shrink-0">
              <div className="grid grid-cols-2 gap-2">
                <Button asChild variant="brand" size="sm">
                  <a
                    href={dlHref}
                    download={activeImg?.local_file || `duomi_${record.id}.png`}
                    target="_blank"
                    rel="noreferrer"
                  >
                    <Download className="h-3.5 w-3.5" />
                    下载保存原图
                  </a>
                </Button>

                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={copyingImg || !imgSrc}
                  onClick={async () => {
                    if (!imgSrc) return
                    setCopyingImg(true)
                    try {
                      await copyImageToClipboard(imgSrc)
                      onToast("已将图片复制到剪贴板，可直接粘贴到聊天或文档", "success")
                    } catch (err: any) {
                      onToast("复制图片失败: " + err.message, "error")
                    } finally {
                      setCopyingImg(false)
                    }
                  }}
                >
                  <Copy className="h-3.5 w-3.5" />
                  {copyingImg ? "正在复制..." : "复制图片"}
                </Button>
              </div>

              <div className="grid grid-cols-2 gap-2">
                {activeImg && (
                  <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    onClick={() => {
                      onUseGeneratedAsRef(activeImg, record)
                      onClose()
                    }}
                  >
                    <ImagePlus className="h-3.5 w-3.5 text-amber-500" />
                    设为参考图微调
                  </Button>
                )}

                {activeImg?.remote_url ? (
                  <Button asChild variant="outline" size="sm">
                    <a
                      href={activeImg.remote_url}
                      target="_blank"
                      rel="noreferrer"
                    >
                      <ExternalLink className="h-3.5 w-3.5" />
                      打开远程链接
                    </a>
                  </Button>
                ) : null}
              </div>

              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => {
                  onReuseRecord(record, true)
                  onClose()
                }}
              >
                <RotateCcw className="h-3.5 w-3.5" />
                复用全套参数{validRefSources.length > 0 ? "（含参考图）" : ""}
              </Button>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
