import React, { useCallback, useEffect, useMemo, useRef, useState } from "react"
import {
  Check,
  ChevronLeft,
  ChevronRight,
  Columns2,
  Copy,
  Download,
  ExternalLink,
  FolderKanban,
  FolderOpen,
  Grid,
  ImagePlus,
  Maximize,
  MoveHorizontal,
  PanelRightClose,
  PanelRightOpen,
  RotateCcw,
  SplitSquareHorizontal,
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
  clampPercent,
  clampZoom,
  gsap,
  prefersReducedMotion,
  STUDIO_EASE,
  useGSAP,
} from "@/lib/motion"
import {
  copyImageToClipboard,
  formatBytes,
  formatDurationSeconds,
  formatUnixTime,
  PROJECT_COLOR_MAP,
} from "@/lib/studio-utils"
import { cn } from "@/lib/utils"
import type { ProjectFolder, SavedImage, TaskRecord } from "@/types"

type LightboxViewMode = "single" | "curtain" | "side_by_side"
type BackdropStyle = "darkroom" | "checker" | "paper"

interface ImageLightboxProps {
  record: TaskRecord | null
  initialCompare?: boolean
  galleryRecords?: TaskRecord[]
  projects?: ProjectFolder[]
  imageIndex: number
  onChangeImageIndex: (idx: number) => void
  onSelectRecord?: (rec: TaskRecord) => void
  onClose: () => void
  onNavigateRecord?: (direction: -1 | 1) => void
  hasPrevRecord?: boolean
  hasNextRecord?: boolean
  onToggleStar: (rec: TaskRecord) => void
  onOrganizeRecord?: (
    recId: string,
    patch: { project_id?: string; note?: string }
  ) => Promise<void>
  onUseGeneratedAsRef: (img: SavedImage, rec: TaskRecord) => void
  onReuseRecord: (rec: TaskRecord, includeRefs: boolean) => void
  onOpenLocalFolder: (targetFile?: string) => void
  onCopyText: (text: string, msg?: string) => void
  onToast: (msg: string, type?: "info" | "success" | "error") => void
}

export const ImageLightbox: React.FC<ImageLightboxProps> = ({
  record,
  initialCompare = false,
  galleryRecords = [],
  projects = [],
  imageIndex,
  onChangeImageIndex,
  onSelectRecord,
  onClose,
  onNavigateRecord,
  hasPrevRecord,
  hasNextRecord,
  onToggleStar,
  onOrganizeRecord,
  onUseGeneratedAsRef,
  onReuseRecord,
  onOpenLocalFolder,
  onCopyText,
  onToast,
}) => {
  const [viewMode, setViewMode] = useState<LightboxViewMode>("single")
  const [backdrop, setBackdrop] = useState<BackdropStyle>("darkroom")
  const [inspectorOpen, setInspectorOpen] = useState<boolean>(true)

  const [zoom, setZoom] = useState<number>(1)
  const [dragging, setDragging] = useState<boolean>(false)
  const panRef = useRef<{ x: number; y: number }>({ x: 0, y: 0 })
  const dragOriginRef = useRef<{ x: number; y: number }>({ x: 0, y: 0 })

  // Scoped GSAP Stage & Zero-Re-Render Refs
  const stageRootRef = useRef<HTMLDivElement | null>(null)
  const stageContentRef = useRef<HTMLDivElement | null>(null)
  const curtainBoxRef = useRef<HTMLDivElement | null>(null)
  const draggingCurtainRef = useRef<boolean>(false)
  const loupeImgRef = useRef<HTMLImageElement | null>(null)
  const sideRefImgRef = useRef<HTMLImageElement | null>(null)
  const sideGenImgRef = useRef<HTMLImageElement | null>(null)
  const quickPanFnsRef = useRef<
    Array<{ xTo: gsap.QuickToFunc; yTo: gsap.QuickToFunc }>
  >([])

  const { contextSafe } = useGSAP({ scope: stageRootRef })

  const [activeRefIdx, setActiveRefIdx] = useState<number>(0)
  const [showRawJson, setShowRawJson] = useState<boolean>(false)
  const [naturalDim, setNaturalDim] = useState<{ w: number; h: number } | null>(
    null
  )
  const [copyingImg, setCopyingImg] = useState<boolean>(false)
  const [noteDraft, setNoteDraft] = useState<string>("")
  const [savingNote, setSavingNote] = useState<boolean>(false)

  const recordId = record?.id
  const recordNote = record?.note
  const imgs = record?.images || []
  const activeImg = imgs[imageIndex] || imgs[0]

  const validRefSources = useMemo(() => {
    if (!record) return []
    if (record.ref_items && record.ref_items.length > 0) {
      return record.ref_items
        .map((ri, idx) => ({
          label: ri.label || `参考图 #${idx + 1}`,
          mode: ri.mode,
          provider: ri.provider,
          src: ri.local_ref ? `/images/${ri.local_ref}` : ri.remote_url || "",
        }))
        .filter((ri) => Boolean(ri.src))
    }
    if (record.ref_previews && record.ref_previews.length > 0) {
      return record.ref_previews.map((src, idx) => ({
        label: `参考图 #${idx + 1}`,
        mode: record.ref_mode,
        provider: "",
        src,
      }))
    }
    return []
  }, [record])

  // Sync state when record / initialCompare changes
  useEffect(() => {
    panRef.current = { x: 0, y: 0 }
    setZoom(1)
    setNaturalDim(null)
    setActiveRefIdx(0)
    setNoteDraft(recordNote || "")

    if (initialCompare && validRefSources.length > 0) {
      setViewMode("curtain")
    } else if (!validRefSources.length) {
      setViewMode("single")
    }
  }, [recordId, recordNote, imageIndex, initialCompare, validRefSources.length])

  // 1. Signature tactile Curtain Wipe intro sweep (34% -> 50%) via CSS variable (--curtain-pos) — zero React re-renders
  useGSAP(
    () => {
      const el = curtainBoxRef.current
      if (!el || !recordId || viewMode !== "curtain" || validRefSources.length === 0) {
        return
      }
      if (prefersReducedMotion()) {
        gsap.set(el, { "--curtain-pos": "50%" })
        return
      }
      gsap.fromTo(
        el,
        { "--curtain-pos": "34%" },
        {
          "--curtain-pos": "50%",
          duration: 0.56,
          ease: STUDIO_EASE.expo,
          overwrite: "auto",
        }
      )
    },
    {
      scope: stageRootRef,
      dependencies: [recordId, viewMode, activeRefIdx, validRefSources.length],
    }
  )

  // 2. Smooth stage cross-settle when switching photos or view modes
  useGSAP(
    () => {
      const el = stageContentRef.current
      if (!el || !recordId || prefersReducedMotion()) return
      gsap.fromTo(
        el,
        { autoAlpha: 0.42, scale: 0.986 },
        {
          autoAlpha: 1,
          scale: 1,
          duration: 0.22,
          ease: STUDIO_EASE.out,
          clearProps: "transform,opacity,visibility",
        }
      )
    },
    {
      scope: stageRootRef,
      dependencies: [recordId, imageIndex, viewMode],
    }
  )

  // 3. Compositor-only Zoom & reusable gsap.quickTo() Pan followers (zero 60fps setState during drag)
  useGSAP(
    () => {
      const targets = [
        loupeImgRef.current,
        sideRefImgRef.current,
        sideGenImgRef.current,
      ].filter((el): el is HTMLImageElement => Boolean(el))

      if (targets.length === 0) {
        quickPanFnsRef.current = []
        return
      }

      if (prefersReducedMotion()) {
        gsap.set(targets, {
          x: panRef.current.x,
          y: panRef.current.y,
          scale: zoom,
        })
      } else {
        gsap.to(targets, {
          x: panRef.current.x,
          y: panRef.current.y,
          scale: zoom,
          duration: 0.2,
          ease: STUDIO_EASE.out,
          overwrite: "auto",
        })
      }

      quickPanFnsRef.current = targets.map((el) => ({
        xTo: gsap.quickTo(el, "x", { duration: 0.12, ease: "power3.out" }),
        yTo: gsap.quickTo(el, "y", { duration: 0.12, ease: "power3.out" }),
      }))
    },
    {
      scope: stageRootRef,
      dependencies: [zoom, viewMode, recordId, imageIndex],
    }
  )

  // eslint-disable-next-line react-hooks/exhaustive-deps
  const applyZoomAndResetPan = useCallback(
    contextSafe((nextZoom: number) => {
      const clamped = clampZoom(Number(nextZoom.toFixed(2)))
      panRef.current = { x: 0, y: 0 }
      setZoom(clamped)
      const targets = [
        loupeImgRef.current,
        sideRefImgRef.current,
        sideGenImgRef.current,
      ].filter((el): el is HTMLImageElement => Boolean(el))
      if (targets.length > 0) {
        gsap.to(targets, {
          x: 0,
          y: 0,
          scale: clamped,
          duration: prefersReducedMotion() ? 0 : 0.22,
          ease: STUDIO_EASE.out,
          overwrite: "auto",
        })
      }
    }),
    [contextSafe]
  )

  // Keyboard navigation
  useEffect(() => {
    if (!record) return
    const handleKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return

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
        setZoom((z) => clampZoom(Number((z + 0.25).toFixed(2))))
      } else if (e.key === "-") {
        setZoom((z) => {
          const next = clampZoom(Number((z - 0.25).toFixed(2)))
          if (next <= 1) panRef.current = { x: 0, y: 0 }
          return next
        })
      } else if (e.key === "0") {
        applyZoomAndResetPan(1)
      } else if (e.key.toLowerCase() === "c" && validRefSources.length > 0) {
        setViewMode((m) => (m === "curtain" ? "single" : "curtain"))
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
    applyZoomAndResetPan,
  ])

  if (!record || !activeImg) return null

  const imgSrc = activeImg.local_file
    ? `/images/${encodeURIComponent(activeImg.local_file)}`
    : activeImg.remote_url

  const displayW = activeImg.width || naturalDim?.w || 1024
  const displayH = activeImg.height || naturalDim?.h || 1024
  const activeRef = validRefSources[activeRefIdx] || validRefSources[0]

  const handleWheel = (e: React.WheelEvent) => {
    if (viewMode === "curtain") return
    e.preventDefault()
    const delta = e.deltaY < 0 ? 0.2 : -0.2
    setZoom((prev) => {
      const next = clampZoom(Number((prev + delta).toFixed(2)))
      if (next <= 1) panRef.current = { x: 0, y: 0 }
      return next
    })
  }

  const handleMouseDown = (e: React.MouseEvent) => {
    if (viewMode === "curtain" || zoom <= 1) return
    e.preventDefault()
    setDragging(true)
    dragOriginRef.current = {
      x: e.clientX - panRef.current.x,
      y: e.clientY - panRef.current.y,
    }
  }

  const handleMouseMove = (e: React.MouseEvent) => {
    if (!dragging) return
    const nextX = e.clientX - dragOriginRef.current.x
    const nextY = e.clientY - dragOriginRef.current.y
    panRef.current = { x: nextX, y: nextY }
    if (prefersReducedMotion()) {
      const targets = [
        loupeImgRef.current,
        sideRefImgRef.current,
        sideGenImgRef.current,
      ].filter((el): el is HTMLImageElement => Boolean(el))
      if (targets.length > 0) {
        gsap.set(targets, { x: nextX, y: nextY })
      }
      return
    }
    for (const fn of quickPanFnsRef.current) {
      fn.xTo(nextX)
      fn.yTo(nextY)
    }
  }

  const handleMouseUp = () => setDragging(false)

  const updateCurtainFromClientX = contextSafe(
    (clientX: number, immediate = false) => {
      const el = curtainBoxRef.current
      if (!el) return
      const rect = el.getBoundingClientRect()
      const pct = clampPercent(
        ((clientX - rect.left) / Math.max(1, rect.width)) * 100
      )
      if (immediate || prefersReducedMotion()) {
        gsap.set(el, { "--curtain-pos": `${pct}%`, overwrite: "auto" })
      } else {
        gsap.to(el, {
          "--curtain-pos": `${pct}%`,
          duration: 0.08,
          ease: "power2.out",
          overwrite: "auto",
        })
      }
    }
  )

  const handleCopyImage = async () => {
    setCopyingImg(true)
    try {
      await copyImageToClipboard(imgSrc)
      onToast("已复制原图到系统剪贴板", "success")
    } catch {
      onToast("浏览器剪贴板写入受限，请右键复制或下载原图", "error")
    } finally {
      setCopyingImg(false)
    }
  }

  const handleSaveNote = async () => {
    if (!onOrganizeRecord) return
    setSavingNote(true)
    try {
      await onOrganizeRecord(record.id, { note: noteDraft.trim() })
      onToast("作品备注已保存", "success")
    } finally {
      setSavingNote(false)
    }
  }

  const stageBgClass =
    backdrop === "checker"
      ? "bg-[radial-gradient(#27272a_1px,transparent_1px)] [background-size:16px_16px] bg-zinc-900"
      : backdrop === "paper"
      ? "bg-[#f4f3ef]"
      : "bg-[#050507]"

  return (
    <Dialog open={Boolean(record)} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-[97vw] sm:max-w-[95vw] xl:max-w-[1440px] p-0 overflow-hidden bg-zinc-950 text-zinc-100 border-zinc-800/90 shadow-2xl">
        <DialogTitle className="sr-only">
          电影级暗房检视台 - {record.model}
        </DialogTitle>
        <DialogDescription className="sr-only">
          支持像素级无级缩放、卷帘滑动前后对比、双栏同步透视核验与胶片序列快切
        </DialogDescription>

        {/* Top Darkroom Control Bar */}
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-zinc-800/90 bg-zinc-950 px-4 py-2.5 pr-12">
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="amber" className="font-mono text-[11px]">
              {record.model}
            </Badge>
            <Badge
              variant="outline"
              className="border-zinc-700 text-zinc-300 font-mono text-[11px] tabular-nums"
            >
              {displayW} × {displayH}
            </Badge>
            {activeImg.size_bytes ? (
              <span className="text-[11px] font-mono text-zinc-400 tabular-nums">
                {formatBytes(activeImg.size_bytes)}
              </span>
            ) : null}

            {/* View Mode Segmented Switcher */}
            {validRefSources.length > 0 && (
              <div className="flex items-center gap-0.5 rounded-lg border border-zinc-800 bg-zinc-900 p-0.5 ml-1">
                <button
                  type="button"
                  onClick={() => setViewMode("single")}
                  className={cn(
                    "rounded-md px-2.5 py-1 text-[11px] font-medium transition-colors cursor-pointer",
                    viewMode === "single"
                      ? "bg-zinc-100 text-zinc-950 font-semibold"
                      : "text-zinc-400 hover:text-zinc-100"
                  )}
                >
                  成片单图
                </button>
                <button
                  type="button"
                  onClick={() => setViewMode("curtain")}
                  className={cn(
                    "flex items-center gap-1 rounded-md px-2.5 py-1 text-[11px] font-medium transition-colors cursor-pointer",
                    viewMode === "curtain"
                      ? "bg-amber-500 text-zinc-950 font-semibold"
                      : "text-zinc-400 hover:text-zinc-100"
                  )}
                >
                  <SplitSquareHorizontal className="h-3 w-3" />
                  卷帘对比
                </button>
                <button
                  type="button"
                  onClick={() => setViewMode("side_by_side")}
                  className={cn(
                    "flex items-center gap-1 rounded-md px-2.5 py-1 text-[11px] font-medium transition-colors cursor-pointer",
                    viewMode === "side_by_side"
                      ? "bg-amber-500 text-zinc-950 font-semibold"
                      : "text-zinc-400 hover:text-zinc-100"
                  )}
                >
                  <Columns2 className="h-3 w-3" />
                  双栏同步
                </button>
              </div>
            )}
          </div>

          {/* Right Controls: Backdrop + Zoom + Inspector Toggle */}
          <div className="flex items-center gap-1.5">
            {/* Backdrop Switcher */}
            <div className="hidden md:flex items-center gap-0.5 rounded-lg border border-zinc-800 bg-zinc-900 p-0.5">
              {[
                { id: "darkroom" as const, label: "暗房" },
                { id: "checker" as const, label: "透明格" },
                { id: "paper" as const, label: "白纸" },
              ].map((b) => (
                <button
                  key={b.id}
                  type="button"
                  onClick={() => setBackdrop(b.id)}
                  className={cn(
                    "rounded-md px-2 py-0.5 text-[10px] font-medium transition-colors cursor-pointer",
                    backdrop === b.id
                      ? "bg-zinc-700 text-white"
                      : "text-zinc-400 hover:text-zinc-200"
                  )}
                >
                  {b.label}
                </button>
              ))}
            </div>

            {viewMode !== "curtain" && (
              <div className="flex items-center gap-0.5 rounded-lg border border-zinc-800 bg-zinc-900 px-1 py-0.5">
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="h-6 w-6 text-zinc-300 hover:text-white hover:bg-zinc-800"
                  onClick={() =>
                    setZoom((z) => {
                      const next = clampZoom(Number((z - 0.25).toFixed(2)))
                      if (next <= 1) panRef.current = { x: 0, y: 0 }
                      return next
                    })
                  }
                >
                  <ZoomOut className="h-3.5 w-3.5" />
                </Button>
                <span className="min-w-[44px] text-center font-mono text-[11px] text-zinc-200 tabular-nums">
                  {Math.round(zoom * 100)}%
                </span>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="h-6 w-6 text-zinc-300 hover:text-white hover:bg-zinc-800"
                  onClick={() =>
                    setZoom((z) => clampZoom(Number((z + 0.25).toFixed(2))))
                  }
                >
                  <ZoomIn className="h-3.5 w-3.5" />
                </Button>
                <button
                  type="button"
                  onClick={() => applyZoomAndResetPan(zoom === 2 ? 1 : 2)}
                  className="px-1.5 text-[10px] font-mono text-zinc-400 hover:text-white cursor-pointer"
                  title="快速切换 200% 细节放大与适配视图"
                >
                  2x
                </button>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="h-6 w-6 text-zinc-300 hover:text-white hover:bg-zinc-800"
                  onClick={() => applyZoomAndResetPan(1)}
                  title="复位视图 (快捷键 0)"
                >
                  <Maximize className="h-3 w-3" />
                </Button>
              </div>
            )}

            <Button
              type="button"
              variant="ghost"
              size="icon"
              onClick={() => onToggleStar(record)}
              className={cn(
                "h-7 w-7 hover:bg-zinc-800",
                record.starred
                  ? "text-amber-400"
                  : "text-zinc-400 hover:text-white"
              )}
              title="星标收藏"
            >
              <Star
                className={cn("h-4 w-4", record.starred && "fill-amber-400")}
              />
            </Button>

            <Button
              type="button"
              variant="ghost"
              size="icon"
              onClick={() => setInspectorOpen((p) => !p)}
              className="hidden lg:inline-flex h-7 w-7 text-zinc-400 hover:text-white hover:bg-zinc-800"
              title={inspectorOpen ? "收起右侧参数栏" : "展开右侧参数栏"}
            >
              {inspectorOpen ? (
                <PanelRightClose className="h-4 w-4" />
              ) : (
                <PanelRightOpen className="h-4 w-4" />
              )}
            </Button>
          </div>
        </div>

        {/* Main Workspace Grid */}
        <div
          className={cn(
            "grid grid-cols-1",
            inspectorOpen ? "lg:grid-cols-[1fr_360px]" : "lg:grid-cols-1"
          )}
        >
          {/* Left Column: Stage + Filmstrip */}
          <div className="flex flex-col overflow-hidden">
            {/* Reference Image Picker Strip when comparing multiple refs */}
            {viewMode !== "single" && validRefSources.length > 1 && (
              <div className="flex items-center justify-center gap-2 border-b border-zinc-800/80 bg-zinc-900/70 px-3 py-1.5">
                <span className="text-[11px] text-zinc-400">切换对比参考图:</span>
                {validRefSources.map((ref, idx) => (
                  <button
                    key={idx}
                    type="button"
                    onClick={() => setActiveRefIdx(idx)}
                    className={cn(
                      "flex items-center gap-1.5 rounded-lg border px-2 py-0.5 text-[11px] transition-all cursor-pointer",
                      idx === activeRefIdx
                        ? "border-amber-500 bg-amber-500/15 text-amber-300 font-semibold"
                        : "border-zinc-800 text-zinc-400 hover:text-zinc-200"
                    )}
                  >
                    <img
                      src={ref.src}
                      alt=""
                      className="h-4 w-4 rounded-xs object-cover"
                    />
                    <span>@图{idx + 1}</span>
                  </button>
                ))}
              </div>
            )}

            {/* Viewport Stage */}
            <div
              ref={stageRootRef}
              onWheel={handleWheel}
              onMouseDown={handleMouseDown}
              onMouseMove={handleMouseMove}
              onMouseUp={handleMouseUp}
              onMouseLeave={handleMouseUp}
              className={cn(
                "relative flex h-[56vh] sm:h-[64vh] items-center justify-center overflow-hidden select-none transition-colors",
                stageBgClass,
                viewMode !== "curtain" && zoom > 1
                  ? dragging
                    ? "cursor-grabbing"
                    : "cursor-grab"
                  : "cursor-default"
              )}
            >
              <div
                ref={stageContentRef}
                className="flex h-full w-full items-center justify-center"
              >
                {/* MODE 1: Interactive Curtain Wipe Slider (Zero-Re-Render CSS Custom Property --curtain-pos) */}
                {viewMode === "curtain" && activeRef ? (
                  <div
                    ref={curtainBoxRef}
                    style={{ "--curtain-pos": "50%" } as React.CSSProperties}
                    onPointerDown={(e) => {
                      e.currentTarget.setPointerCapture(e.pointerId)
                      draggingCurtainRef.current = true
                      updateCurtainFromClientX(e.clientX, true)
                    }}
                    onPointerMove={(e) => {
                      if (draggingCurtainRef.current) {
                        updateCurtainFromClientX(e.clientX, false)
                      }
                    }}
                    onPointerUp={() => {
                      draggingCurtainRef.current = false
                    }}
                    onPointerCancel={() => {
                      draggingCurtainRef.current = false
                    }}
                    className="relative inline-flex max-h-[92%] max-w-[92%] items-center justify-center rounded-lg overflow-hidden shadow-2xl ring-1 ring-white/15 cursor-ew-resize touch-none"
                  >
                    {/* Base Layer: Generated Artwork (AFTER) */}
                    <img
                      src={imgSrc}
                      alt="生成成片"
                      draggable={false}
                      onLoad={(e) =>
                        setNaturalDim({
                          w: e.currentTarget.naturalWidth,
                          h: e.currentTarget.naturalHeight,
                        })
                      }
                      className="block max-h-[58vh] max-w-[86vw] lg:max-w-[62vw] w-auto h-auto object-contain select-none"
                    />

                    {/* Clipped Top Layer: Reference Image (BEFORE) */}
                    <div
                      className="absolute inset-0 overflow-hidden bg-zinc-950"
                      style={{
                        clipPath:
                          "inset(0 calc(100% - var(--curtain-pos, 50%)) 0 0)",
                      }}
                    >
                      <img
                        src={activeRef.src}
                        alt="参考原图"
                        draggable={false}
                        className="h-full w-full object-contain select-none"
                      />
                    </div>

                    {/* Labels */}
                    <span className="pointer-events-none absolute left-3 top-3 rounded-md bg-black/75 px-2 py-0.5 text-[10px] font-semibold tracking-wider text-zinc-200 backdrop-blur-xs border border-white/10">
                      参考原图 (@图{activeRefIdx + 1})
                    </span>
                    <span className="pointer-events-none absolute right-3 top-3 rounded-md bg-amber-500/90 px-2 py-0.5 text-[10px] font-bold tracking-wider text-zinc-950 shadow-sm">
                      生成成片 (AFTER)
                    </span>

                    {/* Vertical Wipe Line & Handle */}
                    <div
                      className="pointer-events-none absolute top-0 bottom-0 w-[2px] bg-amber-400 shadow-[0_0_12px_rgba(245,158,11,0.8)]"
                      style={{ left: "var(--curtain-pos, 50%)" }}
                    >
                      <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 flex h-9 w-9 items-center justify-center rounded-full bg-amber-500 text-zinc-950 shadow-xl ring-2 ring-white">
                        <MoveHorizontal className="h-4 w-4" />
                      </div>
                    </div>
                  </div>
                ) : viewMode === "side_by_side" && activeRef ? (
                  /* MODE 2: Synchronized Side-by-Side Dual View */
                  <div className="grid grid-cols-2 h-full w-full divide-x divide-zinc-800/80">
                    <div className="relative flex flex-col items-center justify-center p-4 overflow-hidden">
                      <span className="absolute top-3 left-3 z-10 rounded-md bg-black/75 px-2 py-0.5 text-[10px] font-medium text-zinc-200 border border-zinc-700">
                        参考图 @图{activeRefIdx + 1}
                      </span>
                      <img
                        ref={sideRefImgRef}
                        src={activeRef.src}
                        alt="参考图"
                        draggable={false}
                        className="max-h-full max-w-full object-contain rounded-md shadow-xl will-change-transform"
                      />
                    </div>
                    <div className="relative flex flex-col items-center justify-center p-4 overflow-hidden">
                      <span className="absolute top-3 left-3 z-10 rounded-md bg-amber-500/90 px-2 py-0.5 text-[10px] font-bold text-zinc-950">
                        生成结果 ({displayW}×{displayH})
                      </span>
                      <img
                        ref={sideGenImgRef}
                        src={imgSrc}
                        alt="生成结果"
                        draggable={false}
                        onLoad={(e) =>
                          setNaturalDim({
                            w: e.currentTarget.naturalWidth,
                            h: e.currentTarget.naturalHeight,
                          })
                        }
                        className="max-h-full max-w-full object-contain rounded-md shadow-xl will-change-transform"
                      />
                    </div>
                  </div>
                ) : (
                  /* MODE 3: Single Artwork Loupe */
                  <img
                    ref={loupeImgRef}
                    src={imgSrc}
                    alt={record.prompt || "Generated Image"}
                    draggable={false}
                    onLoad={(e) =>
                      setNaturalDim({
                        w: e.currentTarget.naturalWidth,
                        h: e.currentTarget.naturalHeight,
                      })
                    }
                    className="max-h-[92%] max-w-[92%] object-contain rounded-md shadow-2xl will-change-transform"
                  />
                )}
              </div>

              {/* Prev / Next Navigation Arrows */}
              {(imgs.length > 1 || hasPrevRecord || hasNextRecord) && (
                <>
                  <button
                    type="button"
                    disabled={!(imageIndex > 0 || hasPrevRecord)}
                    onClick={() => {
                      if (imageIndex > 0) onChangeImageIndex(imageIndex - 1)
                      else if (onNavigateRecord) onNavigateRecord(-1)
                    }}
                    className="absolute left-3 top-1/2 -translate-y-1/2 flex h-10 w-10 items-center justify-center rounded-full bg-black/65 text-white border border-white/10 hover:bg-black/90 disabled:opacity-20 cursor-pointer transition-opacity"
                    aria-label="上一张"
                  >
                    <ChevronLeft className="h-5 w-5" />
                  </button>
                  <button
                    type="button"
                    disabled={!(imageIndex < imgs.length - 1 || hasNextRecord)}
                    onClick={() => {
                      if (imageIndex < imgs.length - 1)
                        onChangeImageIndex(imageIndex + 1)
                      else if (onNavigateRecord) onNavigateRecord(1)
                    }}
                    className="absolute right-3 top-1/2 -translate-y-1/2 flex h-10 w-10 items-center justify-center rounded-full bg-black/65 text-white border border-white/10 hover:bg-black/90 disabled:opacity-20 cursor-pointer transition-opacity"
                    aria-label="下一张"
                  >
                    <ChevronRight className="h-5 w-5" />
                  </button>
                </>
              )}
            </div>

            {/* Bottom Filmstrip across galleryRecords */}
            {galleryRecords.length > 1 && onSelectRecord && (
              <div className="flex items-center gap-1.5 overflow-x-auto border-t border-zinc-800/90 bg-zinc-950 px-4 py-2 studio-scroll">
                {galleryRecords.slice(0, 40).map((item) => {
                  const thumb = item.images?.[0]
                  if (!thumb) return null
                  const thumbSrc = thumb.local_file
                    ? `/images/${encodeURIComponent(thumb.local_file)}`
                    : thumb.remote_url
                  const selected = item.id === record.id
                  return (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => onSelectRecord(item)}
                      className={cn(
                        "relative h-12 w-12 shrink-0 rounded-lg overflow-hidden border transition-all cursor-pointer",
                        selected
                          ? "border-amber-400 ring-2 ring-amber-400/50 scale-105"
                          : "border-zinc-800 opacity-55 hover:opacity-100"
                      )}
                    >
                      <img
                        src={thumbSrc}
                        alt=""
                        loading="lazy"
                        className="h-full w-full object-cover"
                      />
                    </button>
                  )
                })}
              </div>
            )}
          </div>

          {/* Right Collapsible EXIF & Asset Inspector */}
          {inspectorOpen && (
            <div className="flex flex-col justify-between border-t lg:border-t-0 lg:border-l border-zinc-800/90 bg-zinc-900/95 p-4 max-h-[68vh] overflow-y-auto studio-scroll">
              <div className="space-y-4">
                {/* Primary Workflow Actions */}
                <div className="grid grid-cols-2 gap-2">
                  <Button
                    type="button"
                    variant="studio"
                    size="sm"
                    onClick={() => {
                      onReuseRecord(record, true)
                      onClose()
                    }}
                  >
                    <RotateCcw className="h-3.5 w-3.5" />
                    一键做同款
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="border-zinc-700 bg-zinc-800/70 text-zinc-100 hover:bg-zinc-800"
                    onClick={() => {
                      onUseGeneratedAsRef(activeImg, record)
                      onClose()
                    }}
                  >
                    <ImagePlus className="h-3.5 w-3.5 text-amber-400" />
                    设为参考图
                  </Button>
                </div>

                <div className="grid grid-cols-2 gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={copyingImg}
                    className="border-zinc-700 bg-zinc-900 text-zinc-200 hover:bg-zinc-800"
                    onClick={handleCopyImage}
                  >
                    <Copy className="h-3.5 w-3.5" />
                    {copyingImg ? "复制中..." : "复制图像"}
                  </Button>
                  <a
                    href={imgSrc}
                    download={activeImg.file_name || `${record.id}.png`}
                    className="inline-flex h-8 items-center justify-center gap-1.5 rounded-lg border border-zinc-700 bg-zinc-900 px-3 text-xs font-medium text-zinc-200 hover:bg-zinc-800 transition-colors"
                  >
                    <Download className="h-3.5 w-3.5" />
                    保存原图
                  </a>
                </div>

                {/* Project Album Assignment */}
                {onOrganizeRecord && (
                  <div className="space-y-1.5 rounded-xl border border-zinc-800 bg-zinc-950/60 p-2.5">
                    <div className="flex items-center justify-between text-[11px] text-zinc-400">
                      <span className="flex items-center gap-1.5 font-medium text-zinc-300">
                        <FolderKanban className="h-3.5 w-3.5 text-amber-400" />
                        归属项目画册
                      </span>
                    </div>
                    <div className="flex flex-wrap gap-1.5 pt-0.5">
                      <button
                        type="button"
                        onClick={() =>
                          onOrganizeRecord(record.id, { project_id: "" })
                        }
                        className={cn(
                          "rounded-md border px-2 py-0.5 text-[11px] transition-colors cursor-pointer",
                          !record.project_id
                            ? "border-zinc-500 bg-zinc-800 text-white font-medium"
                            : "border-zinc-800 text-zinc-400 hover:text-zinc-200"
                        )}
                      >
                        未归档
                      </button>
                      {projects.map((p) => {
                        const clr =
                          PROJECT_COLOR_MAP[p.color || "amber"] ||
                          PROJECT_COLOR_MAP.amber
                        const active = record.project_id === p.id
                        return (
                          <button
                            key={p.id}
                            type="button"
                            onClick={() =>
                              onOrganizeRecord(record.id, { project_id: p.id })
                            }
                            className={cn(
                              "inline-flex items-center gap-1.5 rounded-md border px-2 py-0.5 text-[11px] transition-colors cursor-pointer",
                              active
                                ? "border-amber-500/60 bg-amber-500/15 text-amber-300 font-medium"
                                : "border-zinc-800 text-zinc-400 hover:text-zinc-200"
                            )}
                          >
                            <span
                              className={cn("h-1.5 w-1.5 rounded-full", clr.dot)}
                            />
                            {p.name}
                          </button>
                        )
                      })}
                    </div>
                  </div>
                )}

                {/* Prompt Box */}
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between">
                    <span className="text-[11px] font-semibold uppercase tracking-wider text-zinc-400">
                      Prompt 画面描述词
                    </span>
                    <button
                      type="button"
                      onClick={() => onCopyText(record.prompt, "已复制提示词")}
                      className="text-[11px] text-amber-400 hover:text-amber-300 flex items-center gap-1 cursor-pointer"
                    >
                      <Copy className="h-3 w-3" />
                      复制
                    </button>
                  </div>
                  <div className="max-h-40 overflow-y-auto rounded-xl border border-zinc-800 bg-zinc-950/80 p-3 text-xs leading-relaxed text-zinc-200 whitespace-pre-wrap studio-scroll">
                    {record.prompt || "(无提示词)"}
                  </div>
                </div>

                {/* Creative Note */}
                {onOrganizeRecord && (
                  <div className="space-y-1.5">
                    <div className="flex items-center justify-between">
                      <span className="text-[11px] font-semibold uppercase tracking-wider text-zinc-400">
                        创作批注 / 选片备注
                      </span>
                      {noteDraft.trim() !== (record.note || "").trim() && (
                        <button
                          type="button"
                          disabled={savingNote}
                          onClick={handleSaveNote}
                          className="inline-flex items-center gap-1 text-[11px] font-semibold text-amber-400 hover:text-amber-300 cursor-pointer"
                        >
                          <Check className="h-3 w-3" />
                          保存备注
                        </button>
                      )}
                    </div>
                    <textarea
                      rows={2}
                      value={noteDraft}
                      onChange={(e) => setNoteDraft(e.target.value)}
                      placeholder="记录本张选片亮点或微调想法..."
                      className="w-full resize-none rounded-xl border border-zinc-800 bg-zinc-950/70 px-3 py-2 text-xs text-zinc-200 placeholder:text-zinc-600 focus:outline-none focus:border-amber-500/50"
                    />
                  </div>
                )}

                {/* EXIF Parameter Specs */}
                <div className="rounded-xl border border-zinc-800 bg-zinc-950/60 p-3 space-y-1.5 text-xs">
                  <div className="flex justify-between">
                    <span className="text-zinc-500">请求尺寸</span>
                    <span className="font-mono text-zinc-200">
                      {record.size || "auto"}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-zinc-500">实测像素</span>
                    <span className="font-mono text-zinc-200 tabular-nums">
                      {displayW} × {displayH}
                    </span>
                  </div>
                  {record.duration_ms ? (
                    <div className="flex justify-between">
                      <span className="text-zinc-500">生成耗时</span>
                      <span className="font-mono text-emerald-400 tabular-nums">
                        {formatDurationSeconds(record.duration_ms / 1000)}
                      </span>
                    </div>
                  ) : null}
                  {record.quality && (
                    <div className="flex justify-between">
                      <span className="text-zinc-500">清晰质量</span>
                      <span className="font-mono text-zinc-200">
                        {record.quality}
                      </span>
                    </div>
                  )}
                  <div className="flex justify-between">
                    <span className="text-zinc-500">生成时间</span>
                    <span className="font-mono text-zinc-300 tabular-nums">
                      {formatUnixTime(record.create_time)}
                    </span>
                  </div>
                  <div className="flex justify-between items-center gap-2">
                    <span className="text-zinc-500 shrink-0">任务 ID</span>
                    <button
                      type="button"
                      onClick={() => onCopyText(record.id, "已复制任务 ID")}
                      className="font-mono text-[11px] text-zinc-400 hover:text-amber-400 truncate cursor-pointer"
                    >
                      {record.id}
                    </button>
                  </div>
                </div>

                {/* File System & Raw JSON */}
                <div className="space-y-1.5">
                  {activeImg.local_file && (
                    <button
                      type="button"
                      onClick={() => onOpenLocalFolder(activeImg.local_file)}
                      className="w-full flex items-center justify-between rounded-lg border border-zinc-800 bg-zinc-950/60 px-3 py-2 text-xs text-zinc-300 hover:bg-zinc-800 hover:text-white transition-colors cursor-pointer"
                    >
                      <span className="flex items-center gap-1.5 truncate">
                        <FolderOpen className="h-3.5 w-3.5 text-amber-400 shrink-0" />
                        <span className="truncate font-mono text-[11px]">
                          duomi_data/images/{activeImg.local_file}
                        </span>
                      </span>
                      <span className="text-[11px] text-amber-400 shrink-0 ml-2">
                        定位
                      </span>
                    </button>
                  )}

                  {activeImg.remote_url && (
                    <a
                      href={activeImg.remote_url}
                      target="_blank"
                      rel="noreferrer"
                      className="w-full flex items-center justify-between rounded-lg border border-zinc-800 bg-zinc-950/60 px-3 py-2 text-xs text-zinc-400 hover:text-zinc-200 transition-colors"
                    >
                      <span className="flex items-center gap-1.5">
                        <ExternalLink className="h-3.5 w-3.5" />
                        打开远程 CDN 源链接
                      </span>
                      <span className="text-[10px]">新窗口</span>
                    </a>
                  )}
                </div>

                {record.raw_response && (
                  <div className="space-y-1.5">
                    <button
                      type="button"
                      onClick={() => setShowRawJson((p) => !p)}
                      className="flex items-center gap-1 text-[11px] text-zinc-500 hover:text-zinc-300 cursor-pointer"
                    >
                      <Grid className="h-3 w-3" />
                      {showRawJson ? "收起原始 API JSON" : "查看原始 API JSON 响应"}
                    </button>
                    {showRawJson && (
                      <pre className="max-h-36 overflow-auto rounded-lg border border-zinc-800 bg-black p-2.5 text-[10px] font-mono text-zinc-300 studio-scroll">
                        {record.raw_response}
                      </pre>
                    )}
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}
