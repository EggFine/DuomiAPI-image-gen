import React, { useCallback, useEffect, useRef, useState } from "react"
import {
  ArrowUpRight,
  Check,
  Crop,
  Eraser,
  Loader2,
  MousePointerSquareDashed,
  Paintbrush,
  RotateCcw,
  Square,
  Undo2,
  X,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog"
import { cn } from "@/lib/utils"
import type { ReferenceImageEntry } from "@/types"

type AnnotatorTool = "brush" | "rect" | "arrow" | "cross" | "crop"

interface DrawAction {
  tool: Exclude<AnnotatorTool, "crop">
  color: string
  lineWidth: number
  points: Array<{ x: number; y: number }>
}

interface CropBox {
  x: number
  y: number
  w: number
  h: number
}

const COLOR_SWATCHES = [
  { value: "#ef4444", label: "红" },
  { value: "#22c55e", label: "绿" },
  { value: "#f59e0b", label: "黄" },
  { value: "#38bdf8", label: "蓝" },
  { value: "#ffffff", label: "白" },
  { value: "#09090b", label: "黑" },
]

interface RefImageAnnotatorModalProps {
  entry: ReferenceImageEntry | null
  refIndex: number
  onClose: () => void
  onApplyAnnotatedFile: (entry: ReferenceImageEntry, file: File) => Promise<void>
}

export const RefImageAnnotatorModal: React.FC<RefImageAnnotatorModalProps> = ({
  entry,
  refIndex,
  onClose,
  onApplyAnnotatedFile,
}) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const [baseImage, setBaseImage] = useState<HTMLImageElement | null>(null)
  const [loadError, setLoadError] = useState<string>("")
  const [tool, setTool] = useState<AnnotatorTool>("rect")
  const [color, setColor] = useState<string>("#ef4444")
  const [strokeWidth, setStrokeWidth] = useState<number>(6)

  const [actions, setActions] = useState<DrawAction[]>([])
  const [activeAction, setActiveAction] = useState<DrawAction | null>(null)
  const [cropDraft, setCropDraft] = useState<CropBox | null>(null)
  const [dragStart, setDragStart] = useState<{ x: number; y: number } | null>(
    null
  )
  const [saving, setSaving] = useState<boolean>(false)

  const loadSourceUrl = useCallback((src: string) => {
    setLoadError("")
    const img = new Image()
    img.crossOrigin = "anonymous"
    img.onload = () => {
      setBaseImage(img)
      setActions([])
      setActiveAction(null)
      setCropDraft(null)
    }
    img.onerror = () => {
      setLoadError("无法跨域读取外部图片像素，请先保存至本地后拖入编辑。")
    }
    img.src = src
  }, [])

  useEffect(() => {
    if (!entry) {
      setBaseImage(null)
      setActions([])
      setCropDraft(null)
      return
    }
    loadSourceUrl(entry.preview)
  }, [entry, loadSourceUrl])

  const drawSingleAction = (
    ctx: CanvasRenderingContext2D,
    act: DrawAction,
    scaleFactor: number
  ) => {
    if (act.points.length === 0) return
    ctx.save()
    ctx.strokeStyle = act.color
    ctx.fillStyle = act.color
    ctx.lineWidth = Math.max(2, act.lineWidth * scaleFactor)
    ctx.lineCap = "round"
    ctx.lineJoin = "round"

    const first = act.points[0]
    const last = act.points[act.points.length - 1]

    if (act.tool === "brush") {
      ctx.beginPath()
      ctx.moveTo(first.x, first.y)
      for (let i = 1; i < act.points.length; i++) {
        ctx.lineTo(act.points[i].x, act.points[i].y)
      }
      ctx.stroke()
    } else if (act.tool === "rect") {
      const x = Math.min(first.x, last.x)
      const y = Math.min(first.y, last.y)
      const w = Math.abs(last.x - first.x)
      const h = Math.abs(last.y - first.y)
      ctx.strokeRect(x, y, w, h)
    } else if (act.tool === "cross") {
      const x = Math.min(first.x, last.x)
      const y = Math.min(first.y, last.y)
      const w = Math.abs(last.x - first.x)
      const h = Math.abs(last.y - first.y)
      ctx.save()
      ctx.setLineDash([10 * scaleFactor, 6 * scaleFactor])
      ctx.strokeRect(x, y, w, h)
      ctx.restore()
      ctx.beginPath()
      ctx.moveTo(x, y)
      ctx.lineTo(x + w, y + h)
      ctx.moveTo(x + w, y)
      ctx.lineTo(x, y + h)
      ctx.stroke()
    } else if (act.tool === "arrow") {
      const dx = last.x - first.x
      const dy = last.y - first.y
      const len = Math.hypot(dx, dy)
      ctx.beginPath()
      ctx.moveTo(first.x, first.y)
      ctx.lineTo(last.x, last.y)
      ctx.stroke()
      if (len > 8) {
        const angle = Math.atan2(dy, dx)
        const headLen = Math.max(16, act.lineWidth * scaleFactor * 3.4)
        ctx.beginPath()
        ctx.moveTo(last.x, last.y)
        ctx.lineTo(
          last.x - headLen * Math.cos(angle - Math.PI / 6),
          last.y - headLen * Math.sin(angle - Math.PI / 6)
        )
        ctx.lineTo(
          last.x - headLen * Math.cos(angle + Math.PI / 6),
          last.y - headLen * Math.sin(angle + Math.PI / 6)
        )
        ctx.closePath()
        ctx.fill()
      }
    }
    ctx.restore()
  }

  const renderCanvas = useCallback(
    (includeCropOverlay = true) => {
      const canvas = canvasRef.current
      if (!canvas || !baseImage) return
      const w = baseImage.naturalWidth || baseImage.width
      const h = baseImage.naturalHeight || baseImage.height
      if (canvas.width !== w || canvas.height !== h) {
        canvas.width = w
        canvas.height = h
      }
      const ctx = canvas.getContext("2d")
      if (!ctx) return

      ctx.clearRect(0, 0, w, h)
      ctx.drawImage(baseImage, 0, 0, w, h)

      const scaleFactor = Math.max(1, Math.min(w, h) / 900)
      for (const act of actions) {
        drawSingleAction(ctx, act, scaleFactor)
      }
      if (activeAction) {
        drawSingleAction(ctx, activeAction, scaleFactor)
      }

      if (includeCropOverlay && cropDraft && cropDraft.w > 8 && cropDraft.h > 8) {
        ctx.save()
        ctx.fillStyle = "rgba(0, 0, 0, 0.58)"
        ctx.fillRect(0, 0, w, cropDraft.y)
        ctx.fillRect(
          0,
          cropDraft.y + cropDraft.h,
          w,
          h - (cropDraft.y + cropDraft.h)
        )
        ctx.fillRect(0, cropDraft.y, cropDraft.x, cropDraft.h)
        ctx.fillRect(
          cropDraft.x + cropDraft.w,
          cropDraft.y,
          w - (cropDraft.x + cropDraft.w),
          cropDraft.h
        )

        // Luminous Apple Photos white crop frame + subtle rule of thirds
        ctx.strokeStyle = "rgba(255, 255, 255, 0.95)"
        ctx.lineWidth = Math.max(2, 2.2 * scaleFactor)
        ctx.strokeRect(cropDraft.x, cropDraft.y, cropDraft.w, cropDraft.h)

        ctx.strokeStyle = "rgba(255, 255, 255, 0.3)"
        ctx.lineWidth = Math.max(1, 1 * scaleFactor)
        ctx.beginPath()
        ctx.moveTo(cropDraft.x + cropDraft.w / 3, cropDraft.y)
        ctx.lineTo(cropDraft.x + cropDraft.w / 3, cropDraft.y + cropDraft.h)
        ctx.moveTo(cropDraft.x + (cropDraft.w * 2) / 3, cropDraft.y)
        ctx.lineTo(
          cropDraft.x + (cropDraft.w * 2) / 3,
          cropDraft.y + cropDraft.h
        )
        ctx.moveTo(cropDraft.x, cropDraft.y + cropDraft.h / 3)
        ctx.lineTo(cropDraft.x + cropDraft.w, cropDraft.y + cropDraft.h / 3)
        ctx.moveTo(cropDraft.x, cropDraft.y + (cropDraft.h * 2) / 3)
        ctx.lineTo(
          cropDraft.x + cropDraft.w,
          cropDraft.y + (cropDraft.h * 2) / 3
        )
        ctx.stroke()
        ctx.restore()
      }
    },
    [actions, activeAction, baseImage, cropDraft]
  )

  useEffect(() => {
    renderCanvas(true)
  }, [renderCanvas])

  useEffect(() => {
    if (!entry) return
    const onKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z") {
        e.preventDefault()
        setActions((prev) => prev.slice(0, -1))
      }
    }
    window.addEventListener("keydown", onKeyDown)
    return () => window.removeEventListener("keydown", onKeyDown)
  }, [entry])

  const toCanvasCoords = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current
    if (!canvas) return { x: 0, y: 0 }
    const rect = canvas.getBoundingClientRect()
    const scaleX = canvas.width / Math.max(1, rect.width)
    const scaleY = canvas.height / Math.max(1, rect.height)
    return {
      x: Math.max(0, Math.min(canvas.width, (e.clientX - rect.left) * scaleX)),
      y: Math.max(0, Math.min(canvas.height, (e.clientY - rect.top) * scaleY)),
    }
  }

  const handlePointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!baseImage) return
    e.currentTarget.setPointerCapture(e.pointerId)
    const pt = toCanvasCoords(e)
    setDragStart(pt)

    if (tool === "crop") {
      setCropDraft({ x: pt.x, y: pt.y, w: 0, h: 0 })
    } else {
      setActiveAction({
        tool,
        color,
        lineWidth: strokeWidth,
        points: [pt],
      })
    }
  }

  const handlePointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!dragStart) return
    const pt = toCanvasCoords(e)

    if (tool === "crop") {
      setCropDraft({
        x: Math.min(dragStart.x, pt.x),
        y: Math.min(dragStart.y, pt.y),
        w: Math.abs(pt.x - dragStart.x),
        h: Math.abs(pt.y - dragStart.y),
      })
    } else if (activeAction) {
      if (activeAction.tool === "brush") {
        setActiveAction({
          ...activeAction,
          points: [...activeAction.points, pt],
        })
      } else {
        setActiveAction({
          ...activeAction,
          points: [activeAction.points[0], pt],
        })
      }
    }
  }

  const handlePointerUp = () => {
    if (tool !== "crop" && activeAction) {
      setActions((prev) => [...prev, activeAction])
      setActiveAction(null)
    }
    setDragStart(null)
  }

  const handleConfirmCrop = () => {
    const canvas = canvasRef.current
    if (!canvas || !baseImage || !cropDraft) return
    if (cropDraft.w < 24 || cropDraft.h < 24) return

    renderCanvas(false)

    const off = document.createElement("canvas")
    off.width = Math.round(cropDraft.w)
    off.height = Math.round(cropDraft.h)
    const offCtx = off.getContext("2d")
    if (!offCtx) return
    offCtx.drawImage(
      canvas,
      Math.round(cropDraft.x),
      Math.round(cropDraft.y),
      Math.round(cropDraft.w),
      Math.round(cropDraft.h),
      0,
      0,
      Math.round(cropDraft.w),
      Math.round(cropDraft.h)
    )
    const croppedImg = new Image()
    croppedImg.onload = () => {
      setBaseImage(croppedImg)
      setActions([])
      setCropDraft(null)
      setTool("rect")
    }
    croppedImg.src = off.toDataURL("image/png")
  }

  const handleResetOriginal = () => {
    if (!entry) return
    loadSourceUrl(entry.original_preview || entry.preview)
  }

  const handleSaveAndApply = async () => {
    if (!entry || !canvasRef.current || !baseImage) return
    renderCanvas(false)
    setSaving(true)
    try {
      const blob = await new Promise<Blob>((resolve, reject) => {
        canvasRef.current?.toBlob((b) => {
          if (b) resolve(b)
          else reject(new Error("生成标注图片失败"))
        }, "image/png")
      })
      const file = new File(
        [blob],
        `ref_${refIndex + 1}_edited_${Date.now()}.png`,
        { type: "image/png" }
      )
      await onApplyAnnotatedFile(entry, file)
      onClose()
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={Boolean(entry)} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-[95vw] sm:max-w-5xl p-0 overflow-hidden bg-[#0D0D10]/96 text-zinc-100 border-0 shadow-[0_32px_90px_-16px_rgba(0,0,0,0.7)]">
        <DialogTitle className="sr-only">
          编辑参考图 (@图{refIndex + 1})
        </DialogTitle>
        <DialogDescription className="sr-only">
          对参考图进行局部标注或裁剪
        </DialogDescription>

        {/* Top Bar — De-lined */}
        <div className="flex flex-wrap items-center justify-between gap-2 px-5 pt-4 pb-2 pr-14">
          <div className="flex items-center gap-2.5">
            <span className="rounded-full bg-white/[0.09] px-3 py-1 font-mono text-xs font-medium text-white">
              @图{refIndex + 1}
            </span>
            {baseImage && (
              <span className="text-xs font-mono text-white/45 tabular-nums">
                {baseImage.naturalWidth || baseImage.width} ×{" "}
                {baseImage.naturalHeight || baseImage.height}
              </span>
            )}
          </div>

          <div className="flex items-center gap-1">
            <Button
              type="button"
              variant="ghost"
              size="xs"
              disabled={actions.length === 0}
              onClick={() => setActions((prev) => prev.slice(0, -1))}
              className="text-white/65 hover:bg-white/[0.08] hover:text-white"
            >
              <Undo2 className="h-3.5 w-3.5" />
              撤销
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="xs"
              disabled={actions.length === 0}
              onClick={() => setActions([])}
              className="text-white/65 hover:bg-white/[0.08] hover:text-white"
            >
              <Eraser className="h-3.5 w-3.5" />
              清空
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="xs"
              onClick={handleResetOriginal}
              className="text-white/65 hover:bg-white/[0.08] hover:text-white"
            >
              <RotateCcw className="h-3.5 w-3.5" />
              原图
            </Button>
          </div>
        </div>

        {/* Tool & Color Strip — Borderless Floating Capsules */}
        <div className="flex flex-wrap items-center justify-between gap-3 px-5 pb-3">
          <div className="flex flex-wrap items-center gap-0.5 rounded-full bg-white/[0.06] p-1">
            {[
              { id: "rect" as const, label: "框选", icon: Square },
              { id: "arrow" as const, label: "箭头", icon: ArrowUpRight },
              { id: "cross" as const, label: "排除", icon: X },
              { id: "brush" as const, label: "画笔", icon: Paintbrush },
              { id: "crop" as const, label: "裁剪", icon: Crop },
            ].map((t) => {
              const Icon = t.icon
              const active = tool === t.id
              return (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => {
                    setTool(t.id)
                    if (t.id !== "crop") setCropDraft(null)
                  }}
                  className={cn(
                    "flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium transition-all cursor-pointer",
                    active
                      ? "bg-white text-zinc-950 shadow-xs"
                      : "text-white/60 hover:text-white"
                  )}
                >
                  <Icon className="h-3.5 w-3.5" />
                  <span>{t.label}</span>
                </button>
              )
            })}
          </div>

          {tool !== "crop" ? (
            <div className="flex flex-wrap items-center gap-4">
              <div className="flex items-center gap-2">
                {COLOR_SWATCHES.map((sw) => (
                  <button
                    key={sw.value}
                    type="button"
                    title={sw.label}
                    onClick={() => setColor(sw.value)}
                    className={cn(
                      "h-5 w-5 rounded-full transition-transform cursor-pointer",
                      color === sw.value
                        ? "scale-115 ring-2 ring-white ring-offset-2 ring-offset-[#0D0D10]"
                        : "opacity-75 hover:opacity-100"
                    )}
                    style={{ backgroundColor: sw.value }}
                  />
                ))}
              </div>

              <div className="flex items-center gap-2 text-xs text-white/55">
                <span>线宽</span>
                <input
                  type="range"
                  min={2}
                  max={18}
                  value={strokeWidth}
                  onChange={(e) => setStrokeWidth(Number(e.target.value))}
                  className="studio-slider w-20 text-white"
                />
                <span className="font-mono text-[11px] w-5 tabular-nums text-white/75">
                  {strokeWidth}
                </span>
              </div>
            </div>
          ) : (
            <div className="flex items-center gap-2">
              <span className="text-xs text-white/60 flex items-center gap-1.5">
                <MousePointerSquareDashed className="h-3.5 w-3.5" />
                拖拽框选保留区域
              </span>
              {cropDraft && cropDraft.w >= 24 && cropDraft.h >= 24 && (
                <>
                  <Button
                    type="button"
                    size="xs"
                    className="bg-white text-zinc-950 hover:bg-white/90"
                    onClick={handleConfirmCrop}
                  >
                    <Check className="h-3.5 w-3.5" />
                    裁剪 ({Math.round(cropDraft.w)}×{Math.round(cropDraft.h)})
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="xs"
                    className="text-white/65 hover:bg-white/[0.08] hover:text-white"
                    onClick={() => setCropDraft(null)}
                  >
                    取消
                  </Button>
                </>
              )}
            </div>
          )}
        </div>

        {/* Interactive Canvas Stage */}
        <div className="relative mx-5 flex h-[58vh] min-h-[340px] items-center justify-center overflow-auto rounded-2xl bg-black/55 p-5 select-none">
          {loadError ? (
            <div className="max-w-md rounded-2xl bg-red-500/12 p-5 text-center text-xs text-red-200">
              {loadError}
            </div>
          ) : !baseImage ? (
            <div className="flex items-center gap-2 text-xs text-white/55">
              <Loader2 className="h-4 w-4 animate-spin" />
              载入画布...
            </div>
          ) : (
            <canvas
              ref={canvasRef}
              onPointerDown={handlePointerDown}
              onPointerMove={handlePointerMove}
              onPointerUp={handlePointerUp}
              className="max-h-full max-w-full rounded-xl shadow-2xl cursor-crosshair touch-none"
            />
          )}
        </div>

        {/* Minimalist Footer */}
        <div className="flex items-center justify-between px-5 py-4">
          <span className="text-xs text-white/45">
            修改仅作用于当前参考图，可随时还原
          </span>
          <div className="flex items-center gap-2">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={onClose}
              className="text-white/65 hover:bg-white/[0.08] hover:text-white"
            >
              取消
            </Button>
            <Button
              type="button"
              size="sm"
              className="bg-white text-zinc-950 hover:bg-white/90"
              disabled={saving || Boolean(loadError) || !baseImage}
              onClick={handleSaveAndApply}
            >
              {saving ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Check className="h-3.5 w-3.5" />
              )}
              应用
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
