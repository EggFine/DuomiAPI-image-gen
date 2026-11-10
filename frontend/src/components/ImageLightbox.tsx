import React, { useCallback, useEffect, useMemo, useRef, useState } from "react"
import {
  Check,
  ChevronLeft,
  ChevronRight,
  Columns2,
  Copy,
  Download,
  ExternalLink,
  FolderOpen,
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

  // 1. Calm Curtain Wipe intro sweep (38% -> 50%) via CSS variable (--curtain-pos)
  useGSAP(
    () => {
      const el = curtainBoxRef.current
      if (
        !el ||
        !recordId ||
        viewMode !== "curtain" ||
        validRefSources.length === 0
      ) {
        return
      }
      if (prefersReducedMotion()) {
        gsap.set(el, { "--curtain-pos": "50%" })
        return
      }
      gsap.fromTo(
        el,
        { "--curtain-pos": "38%" },
        {
          "--curtain-pos": "50%",
          duration: 0.62,
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
        { autoAlpha: 0.48, scale: 0.99 },
        {
          autoAlpha: 1,
          scale: 1,
          duration: 0.28,
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

  // 3. Compositor-only Zoom & reusable gsap.quickTo() Pan followers
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
          duration: 0.24,
          ease: STUDIO_EASE.out,
          overwrite: "auto",
        })
      }

      quickPanFnsRef.current = targets.map((el) => ({
        xTo: gsap.quickTo(el, "x", { duration: 0.14, ease: "power3.out" }),
        yTo: gsap.quickTo(el, "y", { duration: 0.14, ease: "power3.out" }),
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
          duration: prefersReducedMotion() ? 0 : 0.26,
          ease: STUDIO_EASE.out,
          overwrite: "auto",
        })
      }
    }),
    [contextSafe]
  )

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
      onToast("已复制图像", "success")
    } catch {
      onToast("剪贴板写入受限，请右键复制或下载原图", "error")
    } finally {
      setCopyingImg(false)
    }
  }

  const handleSaveNote = async () => {
    if (!onOrganizeRecord) return
    setSavingNote(true)
    try {
      await onOrganizeRecord(record.id, { note: noteDraft.trim() })
      onToast("备注已保存", "success")
    } finally {
      setSavingNote(false)
    }
  }

  const stageBgClass =
    backdrop === "checker"
      ? "bg-[radial-gradient(#27272a_1px,transparent_1px)] [background-size:16px_16px] bg-[#141416]"
      : backdrop === "paper"
      ? "bg-[#F5F5F7]"
      : "bg-[#070709]"

  return (
    <Dialog open={Boolean(record)} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-[97vw] sm:max-w-[95vw] xl:max-w-[1440px] p-0 overflow-hidden bg-[#0D0D10]/96 backdrop-blur-3xl text-zinc-100 border-white/[0.07] rounded-3xl shadow-2xl">
        <DialogTitle className="sr-only">作品检视 - {record.model}</DialogTitle>
        <DialogDescription className="sr-only">
          缩放、前后对比与参数详情
        </DialogDescription>

        {/* Borderless Darkroom Top Bar */}
        <div className="flex flex-wrap items-center justify-between gap-2 px-5 py-3 pr-14">
          <div className="flex flex-wrap items-center gap-2">
            <span className="rounded-full bg-white/[0.08] px-3 py-1 font-mono text-[11px] font-medium text-zinc-100">
              {record.model}
            </span>
            <span className="rounded-full bg-white/[0.05] px-2.5 py-1 font-mono text-[11px] text-zinc-400 tabular-nums">
              {displayW} × {displayH}
            </span>
            {activeImg.size_bytes ? (
              <span className="text-[11px] font-mono text-zinc-500 tabular-nums">
                {formatBytes(activeImg.size_bytes)}
              </span>
            ) : null}

            {/* Apple Segmented View Mode Switcher */}
            {validRefSources.length > 0 && (
              <div className="flex items-center gap-0.5 rounded-full bg-white/[0.06] p-1 ml-1">
                <button
                  type="button"
                  onClick={() => setViewMode("single")}
                  className={cn(
                    "rounded-full px-3 py-1 text-[11px] font-medium transition-colors cursor-pointer",
                    viewMode === "single"
                      ? "bg-white text-zinc-950"
                      : "text-zinc-400 hover:text-zinc-100"
                  )}
                >
                  单图
                </button>
                <button
                  type="button"
                  onClick={() => setViewMode("curtain")}
                  className={cn(
                    "flex items-center gap-1 rounded-full px-3 py-1 text-[11px] font-medium transition-colors cursor-pointer",
                    viewMode === "curtain"
                      ? "bg-white text-zinc-950"
                      : "text-zinc-400 hover:text-zinc-100"
                  )}
                >
                  <SplitSquareHorizontal className="h-3 w-3" />
                  卷帘
                </button>
                <button
                  type="button"
                  onClick={() => setViewMode("side_by_side")}
                  className={cn(
                    "flex items-center gap-1 rounded-full px-3 py-1 text-[11px] font-medium transition-colors cursor-pointer",
                    viewMode === "side_by_side"
                      ? "bg-white text-zinc-950"
                      : "text-zinc-400 hover:text-zinc-100"
                  )}
                >
                  <Columns2 className="h-3 w-3" />
                  双栏
                </button>
              </div>
            )}
          </div>

          {/* Right Darkroom Controls */}
          <div className="flex items-center gap-1.5">
            <div className="hidden md:flex items-center gap-0.5 rounded-full bg-white/[0.06] p-1">
              {[
                { id: "darkroom" as const, label: "暗房" },
                { id: "checker" as const, label: "透明格" },
                { id: "paper" as const, label: "浅底" },
              ].map((b) => (
                <button
                  key={b.id}
                  type="button"
                  onClick={() => setBackdrop(b.id)}
                  className={cn(
                    "rounded-full px-2.5 py-0.5 text-[11px] font-medium transition-colors cursor-pointer",
                    backdrop === b.id
                      ? "bg-white/[0.18] text-white"
                      : "text-zinc-400 hover:text-zinc-200"
                  )}
                >
                  {b.label}
                </button>
              ))}
            </div>

            {viewMode !== "curtain" && (
              <div className="flex items-center gap-0.5 rounded-full bg-white/[0.06] px-1.5 py-0.5">
                <button
                  type="button"
                  className="flex h-6 w-6 items-center justify-center rounded-full text-zinc-300 hover:bg-white/[0.1] hover:text-white cursor-pointer"
                  onClick={() =>
                    setZoom((z) => {
                      const next = clampZoom(Number((z - 0.25).toFixed(2)))
                      if (next <= 1) panRef.current = { x: 0, y: 0 }
                      return next
                    })
                  }
                >
                  <ZoomOut className="h-3.5 w-3.5" />
                </button>
                <span className="min-w-[44px] text-center font-mono text-[11px] text-zinc-200 tabular-nums">
                  {Math.round(zoom * 100)}%
                </span>
                <button
                  type="button"
                  className="flex h-6 w-6 items-center justify-center rounded-full text-zinc-300 hover:bg-white/[0.1] hover:text-white cursor-pointer"
                  onClick={() =>
                    setZoom((z) => clampZoom(Number((z + 0.25).toFixed(2))))
                  }
                >
                  <ZoomIn className="h-3.5 w-3.5" />
                </button>
                <button
                  type="button"
                  onClick={() => applyZoomAndResetPan(zoom === 2 ? 1 : 2)}
                  className="px-1.5 text-[10px] font-mono text-zinc-400 hover:text-white cursor-pointer"
                  title="切换 200% 视图"
                >
                  2x
                </button>
                <button
                  type="button"
                  className="flex h-6 w-6 items-center justify-center rounded-full text-zinc-300 hover:bg-white/[0.1] hover:text-white cursor-pointer"
                  onClick={() => applyZoomAndResetPan(1)}
                  title="复位 (0)"
                >
                  <Maximize className="h-3 w-3" />
                </button>
              </div>
            )}

            <button
              type="button"
              onClick={() => onToggleStar(record)}
              className={cn(
                "flex h-8 w-8 items-center justify-center rounded-full hover:bg-white/[0.08] transition-colors cursor-pointer",
                record.starred
                  ? "text-amber-400"
                  : "text-zinc-400 hover:text-white"
              )}
              title="收藏"
            >
              <Star
                className={cn("h-4 w-4", record.starred && "fill-amber-400")}
              />
            </button>

            <button
              type="button"
              onClick={() => setInspectorOpen((p) => !p)}
              className="hidden lg:inline-flex h-8 w-8 items-center justify-center rounded-full text-zinc-400 hover:bg-white/[0.08] hover:text-white transition-colors cursor-pointer"
              title={inspectorOpen ? "收起详情" : "展开详情"}
            >
              {inspectorOpen ? (
                <PanelRightClose className="h-4 w-4" />
              ) : (
                <PanelRightOpen className="h-4 w-4" />
              )}
            </button>
          </div>
        </div>

        {/* Main Workspace Grid */}
        <div
          className={cn(
            "grid grid-cols-1",
            inspectorOpen ? "lg:grid-cols-[1fr_340px]" : "lg:grid-cols-1"
          )}
        >
          {/* Left Column: Stage + Filmstrip */}
          <div className="flex flex-col overflow-hidden">
            {viewMode !== "single" && validRefSources.length > 1 && (
              <div className="flex items-center justify-center gap-2 bg-white/[0.025] px-3 py-2">
                <span className="text-[11px] text-zinc-400">参考图</span>
                {validRefSources.map((ref, idx) => (
                  <button
                    key={idx}
                    type="button"
                    onClick={() => setActiveRefIdx(idx)}
                    className={cn(
                      "flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] transition-all cursor-pointer",
                      idx === activeRefIdx
                        ? "bg-white text-zinc-950 font-medium"
                        : "bg-white/[0.06] text-zinc-400 hover:text-zinc-200"
                    )}
                  >
                    <img
                      src={ref.src}
                      alt=""
                      className="h-4 w-4 rounded-full object-cover"
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
                "relative flex h-[56vh] sm:h-[65vh] items-center justify-center overflow-hidden select-none transition-colors",
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
                {/* MODE 1: Interactive Luminous Frosted Curtain Wipe */}
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
                    className="relative inline-flex max-h-[92%] max-w-[92%] items-center justify-center rounded-2xl overflow-hidden shadow-2xl cursor-ew-resize touch-none"
                  >
                    <img
                      src={imgSrc}
                      alt="成片"
                      draggable={false}
                      onLoad={(e) =>
                        setNaturalDim({
                          w: e.currentTarget.naturalWidth,
                          h: e.currentTarget.naturalHeight,
                        })
                      }
                      className="block max-h-[58vh] max-w-[86vw] lg:max-w-[62vw] w-auto h-auto object-contain select-none"
                    />

                    <div
                      className="absolute inset-0 overflow-hidden bg-[#070709]"
                      style={{
                        clipPath:
                          "inset(0 calc(100% - var(--curtain-pos, 50%)) 0 0)",
                      }}
                    >
                      <img
                        src={activeRef.src}
                        alt="参考图"
                        draggable={false}
                        className="h-full w-full object-contain select-none"
                      />
                    </div>

                    <span className="pointer-events-none absolute left-3 top-3 rounded-full bg-black/60 px-2.5 py-0.5 text-[10px] font-medium text-white backdrop-blur-xl">
                      参考 @图{activeRefIdx + 1}
                    </span>
                    <span className="pointer-events-none absolute right-3 top-3 rounded-full bg-white/90 px-2.5 py-0.5 text-[10px] font-medium text-zinc-950 backdrop-blur-xl">
                      成片
                    </span>

                    {/* Luminous White Curtain Line & Handle */}
                    <div
                      className="pointer-events-none absolute top-0 bottom-0 w-[1.5px] bg-white/90 shadow-[0_0_14px_rgba(0,0,0,0.65)]"
                      style={{ left: "var(--curtain-pos, 50%)" }}
                    >
                      <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 flex h-9 w-9 items-center justify-center rounded-full bg-white text-zinc-950 shadow-xl">
                        <MoveHorizontal className="h-4 w-4" />
                      </div>
                    </div>
                  </div>
                ) : viewMode === "side_by_side" && activeRef ? (
                  /* MODE 2: Synchronized Dual View (Zero Dividing Line) */
                  <div className="grid grid-cols-2 gap-4 h-full w-full p-5">
                    <div className="relative flex flex-col items-center justify-center overflow-hidden rounded-2xl bg-white/[0.02]">
                      <span className="absolute top-3 left-3 z-10 rounded-full bg-black/60 px-2.5 py-0.5 text-[10px] font-medium text-zinc-200 backdrop-blur-xl">
                        参考 @图{activeRefIdx + 1}
                      </span>
                      <img
                        ref={sideRefImgRef}
                        src={activeRef.src}
                        alt="参考图"
                        draggable={false}
                        className="max-h-full max-w-full object-contain rounded-xl shadow-xl will-change-transform"
                      />
                    </div>
                    <div className="relative flex flex-col items-center justify-center overflow-hidden rounded-2xl bg-white/[0.02]">
                      <span className="absolute top-3 left-3 z-10 rounded-full bg-white/90 px-2.5 py-0.5 text-[10px] font-medium text-zinc-950 backdrop-blur-xl">
                        成片 ({displayW}×{displayH})
                      </span>
                      <img
                        ref={sideGenImgRef}
                        src={imgSrc}
                        alt="成片"
                        draggable={false}
                        onLoad={(e) =>
                          setNaturalDim({
                            w: e.currentTarget.naturalWidth,
                            h: e.currentTarget.naturalHeight,
                          })
                        }
                        className="max-h-full max-w-full object-contain rounded-xl shadow-xl will-change-transform"
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
                    className="max-h-[92%] max-w-[92%] object-contain rounded-xl shadow-2xl will-change-transform"
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
                    className="absolute left-4 top-1/2 -translate-y-1/2 flex h-10 w-10 items-center justify-center rounded-full bg-black/55 text-white backdrop-blur-xl hover:bg-black/80 disabled:opacity-20 cursor-pointer transition-opacity"
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
                    className="absolute right-4 top-1/2 -translate-y-1/2 flex h-10 w-10 items-center justify-center rounded-full bg-black/55 text-white backdrop-blur-xl hover:bg-black/80 disabled:opacity-20 cursor-pointer transition-opacity"
                    aria-label="下一张"
                  >
                    <ChevronRight className="h-5 w-5" />
                  </button>
                </>
              )}
            </div>

            {/* Borderless Filmstrip */}
            {galleryRecords.length > 1 && onSelectRecord && (
              <div className="flex items-center gap-2 overflow-x-auto px-5 py-3 studio-scroll">
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
                        "relative h-12 w-12 shrink-0 rounded-xl overflow-hidden transition-all cursor-pointer",
                        selected
                          ? "ring-2 ring-white opacity-100 scale-105"
                          : "opacity-45 hover:opacity-85"
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

          {/* Right Tonal Inspector (Zero Hard Borders) */}
          {inspectorOpen && (
            <div className="flex flex-col justify-between bg-white/[0.025] p-5 max-h-[70vh] overflow-y-auto studio-scroll">
              <div className="space-y-4">
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      onReuseRecord(record, true)
                      onClose()
                    }}
                    className="inline-flex h-9 items-center justify-center gap-1.5 rounded-full bg-white text-zinc-950 text-xs font-medium hover:bg-white/90 transition-colors cursor-pointer"
                  >
                    <RotateCcw className="h-3.5 w-3.5" />
                    复用参数
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      onUseGeneratedAsRef(activeImg, record)
                      onClose()
                    }}
                    className="inline-flex h-9 items-center justify-center gap-1.5 rounded-full bg-white/[0.08] text-zinc-100 text-xs font-medium hover:bg-white/[0.14] transition-colors cursor-pointer"
                  >
                    <ImagePlus className="h-3.5 w-3.5" />
                    设为参考
                  </button>
                </div>

                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    disabled={copyingImg}
                    onClick={handleCopyImage}
                    className="inline-flex h-8 items-center justify-center gap-1.5 rounded-full bg-white/[0.05] text-zinc-200 text-xs font-medium hover:bg-white/[0.1] transition-colors cursor-pointer"
                  >
                    <Copy className="h-3.5 w-3.5" />
                    {copyingImg ? "复制中" : "复制图像"}
                  </button>
                  <a
                    href={imgSrc}
                    download={activeImg.file_name || `${record.id}.png`}
                    className="inline-flex h-8 items-center justify-center gap-1.5 rounded-full bg-white/[0.05] text-zinc-200 text-xs font-medium hover:bg-white/[0.1] transition-colors"
                  >
                    <Download className="h-3.5 w-3.5" />
                    下载原图
                  </a>
                </div>

                {/* Album Assignment */}
                {onOrganizeRecord && (
                  <div className="space-y-2 rounded-2xl bg-white/[0.04] p-3.5">
                    <span className="text-[11px] font-medium text-zinc-400">
                      画册
                    </span>
                    <div className="flex flex-wrap gap-1.5">
                      <button
                        type="button"
                        onClick={() =>
                          onOrganizeRecord(record.id, { project_id: "" })
                        }
                        className={cn(
                          "rounded-full px-2.5 py-1 text-[11px] transition-colors cursor-pointer",
                          !record.project_id
                            ? "bg-white text-zinc-950 font-medium"
                            : "bg-white/[0.05] text-zinc-400 hover:text-zinc-200"
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
                              "inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] transition-colors cursor-pointer",
                              active
                                ? "bg-white text-zinc-950 font-medium"
                                : "bg-white/[0.05] text-zinc-400 hover:text-zinc-200"
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

                {/* Prompt Well */}
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between px-1">
                    <span className="text-[11px] font-medium text-zinc-400">
                      提示词
                    </span>
                    <button
                      type="button"
                      onClick={() => onCopyText(record.prompt, "已复制提示词")}
                      className="text-[11px] text-zinc-300 hover:text-white flex items-center gap-1 cursor-pointer"
                    >
                      <Copy className="h-3 w-3" />
                      复制
                    </button>
                  </div>
                  <div className="max-h-40 overflow-y-auto rounded-2xl bg-white/[0.04] p-3.5 text-xs leading-relaxed text-zinc-200 whitespace-pre-wrap studio-scroll">
                    {record.prompt || "(无提示词)"}
                  </div>
                </div>

                {/* Note Well */}
                {onOrganizeRecord && (
                  <div className="space-y-1.5">
                    <div className="flex items-center justify-between px-1">
                      <span className="text-[11px] font-medium text-zinc-400">
                        备注
                      </span>
                      {noteDraft.trim() !== (record.note || "").trim() && (
                        <button
                          type="button"
                          disabled={savingNote}
                          onClick={handleSaveNote}
                          className="inline-flex items-center gap-1 text-[11px] font-medium text-white hover:opacity-80 cursor-pointer"
                        >
                          <Check className="h-3 w-3" />
                          保存
                        </button>
                      )}
                    </div>
                    <textarea
                      rows={2}
                      value={noteDraft}
                      onChange={(e) => setNoteDraft(e.target.value)}
                      placeholder="添加选片备注..."
                      className="w-full resize-none rounded-2xl bg-white/[0.04] px-3.5 py-2.5 text-xs text-zinc-200 placeholder:text-zinc-500 focus:outline-none focus:bg-white/[0.06]"
                    />
                  </div>
                )}

                {/* EXIF Specs */}
                <div className="rounded-2xl bg-white/[0.04] p-3.5 space-y-2 text-xs">
                  <div className="flex justify-between">
                    <span className="text-zinc-500">请求尺寸</span>
                    <span className="font-mono text-zinc-200">
                      {record.size || "auto"}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-zinc-500">实际像素</span>
                    <span className="font-mono text-zinc-200 tabular-nums">
                      {displayW} × {displayH}
                    </span>
                  </div>
                  {record.duration_ms ? (
                    <div className="flex justify-between">
                      <span className="text-zinc-500">耗时</span>
                      <span className="font-mono text-zinc-200 tabular-nums">
                        {formatDurationSeconds(record.duration_ms / 1000)}
                      </span>
                    </div>
                  ) : null}
                  {record.quality && (
                    <div className="flex justify-between">
                      <span className="text-zinc-500">画质</span>
                      <span className="font-mono text-zinc-200">
                        {record.quality}
                      </span>
                    </div>
                  )}
                  <div className="flex justify-between">
                    <span className="text-zinc-500">时间</span>
                    <span className="font-mono text-zinc-300 tabular-nums">
                      {formatUnixTime(record.create_time)}
                    </span>
                  </div>
                  <div className="flex justify-between items-center gap-2">
                    <span className="text-zinc-500 shrink-0">任务 ID</span>
                    <button
                      type="button"
                      onClick={() => onCopyText(record.id, "已复制任务 ID")}
                      className="font-mono text-[11px] text-zinc-400 hover:text-white truncate cursor-pointer"
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
                      className="w-full flex items-center justify-between rounded-2xl bg-white/[0.04] px-3.5 py-2.5 text-xs text-zinc-300 hover:bg-white/[0.08] hover:text-white transition-colors cursor-pointer"
                    >
                      <span className="flex items-center gap-2 truncate">
                        <FolderOpen className="h-3.5 w-3.5 text-zinc-400 shrink-0" />
                        <span className="truncate font-mono text-[11px]">
                          {activeImg.local_file}
                        </span>
                      </span>
                      <span className="text-[11px] text-zinc-400 shrink-0 ml-2">
                        定位
                      </span>
                    </button>
                  )}

                  {activeImg.remote_url && (
                    <a
                      href={activeImg.remote_url}
                      target="_blank"
                      rel="noreferrer"
                      className="w-full flex items-center justify-between rounded-2xl bg-white/[0.04] px-3.5 py-2.5 text-xs text-zinc-400 hover:bg-white/[0.08] hover:text-zinc-200 transition-colors"
                    >
                      <span className="flex items-center gap-2">
                        <ExternalLink className="h-3.5 w-3.5" />
                        源链接
                      </span>
                      <span className="text-[10px]">打开</span>
                    </a>
                  )}
                </div>

                {record.raw_response && (
                  <div className="space-y-1.5 px-1">
                    <button
                      type="button"
                      onClick={() => setShowRawJson((p) => !p)}
                      className="text-[11px] text-zinc-500 hover:text-zinc-300 cursor-pointer"
                    >
                      {showRawJson ? "收起 JSON" : "查看原始 JSON"}
                    </button>
                    {showRawJson && (
                      <pre className="max-h-36 overflow-auto rounded-2xl bg-black/70 p-3 text-[10px] font-mono text-zinc-300 studio-scroll">
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
