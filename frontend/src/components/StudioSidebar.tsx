import React, { useMemo, useRef, useState } from "react"
import {
  AlertTriangle,
  ArrowLeftRight,
  BookMarked,
  BookmarkPlus,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ClipboardPaste,
  Code2,
  Copy,
  Link2,
  Loader2,
  Maximize2,
  PencilRuler,
  Plus,
  RefreshCw,
  Upload,
  X,
} from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Switch } from "@/components/ui/switch"
import { Textarea } from "@/components/ui/textarea"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import { parsePixelDimensions } from "@/lib/studio-utils"
import { cn } from "@/lib/utils"
import type {
  ImageHostInfo,
  ImageHostProvider,
  ModelInfo,
  RatioPresetGroup,
  ReferenceImageEntry,
  RefImageMode,
} from "@/types"

const QUICK_STYLE_SNIPPETS = [
  { label: "手机抓拍", text: "普通智能手机后置主摄随手抓拍质感，自然混合环境光，真实皮肤纹理与衣物褶皱，无商业滤镜" },
  { label: "自然光影", text: "电影级自然光影层次，细腻明暗过渡，高宽容度写实质感" },
  { label: "商业静物", text: "专业影棚柔光箱布光，极简干净背景，精细材质高光与微距质感" },
  { label: "日系插画", text: "精品日系厚涂概念插画风格，色彩通透丰富，笔触细腻有层次" },
  { label: "严谨透视", text: "横平竖直的真实物理空间线性透视，桌椅设备轴线对齐，无穿模变形" },
]

function AspectRatioFrame({ w, h }: { w: number; h: number }) {
  if (!w || !h) {
    return (
      <span className="inline-flex h-3.5 w-3.5 items-center justify-center rounded-[2px] border border-current opacity-65 text-[9px] font-mono">
        A
      </span>
    )
  }
  const maxSide = 12
  let boxW = maxSide
  let boxH = maxSide
  if (w >= h) {
    boxH = Math.max(6, Math.round((maxSide * h) / w))
  } else {
    boxW = Math.max(6, Math.round((maxSide * w) / h))
  }
  return (
    <span
      className="inline-block rounded-[2px] border border-current opacity-75 shrink-0"
      style={{ width: `${boxW}px`, height: `${boxH}px` }}
    />
  )
}

interface StudioSidebarProps {
  models: ModelInfo[]
  selectedModel: string
  onSelectModel: (id: string) => void
  customModel: string
  onChangeCustomModel: (v: string) => void

  prompt: string
  onChangePrompt: (v: string) => void
  onOpenZenWorkbench?: () => void
  onOpenTemplates: () => void
  onSaveAsTemplate: () => void

  refMode: RefImageMode
  onChangeRefMode: (mode: RefImageMode) => void
  imageHosts: ImageHostInfo[]
  imageHostProvider: ImageHostProvider
  onChangeImageHostProvider: (p: ImageHostProvider) => void
  litterboxExpiry: string
  onChangeLitterboxExpiry: (exp: string) => void
  compressMaxDim: number
  onChangeCompressMaxDim: (dim: number) => void
  compressQuality: number
  onChangeCompressQuality: (q: number) => void

  referenceImages: ReferenceImageEntry[]
  onFilesSelected: (files: FileList | File[]) => void
  onAddRefUrl: (url: string) => void
  onRemoveRef: (id: string) => void
  onMoveRef: (index: number, direction: -1 | 1) => void
  onRetryRef: (entry: ReferenceImageEntry) => void
  onAnnotateRef?: (entry: ReferenceImageEntry) => void
  onPasteFromClipboardButton: () => void
  onCopyText: (text: string, label?: string) => void
  onOpenSettingsTab: (tab: string) => void

  ratioPresets: RatioPresetGroup[]
  selectedRatio: string
  selectedSize: string
  onSelectRatio: (grp: RatioPresetGroup) => void
  onSelectPresetSize: (val: string, tier?: string) => void
  onSelectCustomRatioMode: () => void
  customW: number
  customH: number
  onChangeCustomW: (w: number) => void
  onChangeCustomH: (h: number) => void
  onApplyCustomSize: (w?: number, h?: number) => void

  quality: string
  onChangeQuality: (q: string) => void
  background: string
  onChangeBackground: (bg: string) => void
  oversea: boolean
  onChangeOversea: (v: boolean) => void
  autoCompatFallback: boolean
  onChangeAutoCompatFallback: (v: boolean) => void

  batchCount: number
  onChangeBatchCount: (n: number) => void
  isSubmitting: boolean
  onSubmitGenerate: () => void
  onOpenDevPreview: () => void
}

export const StudioSidebar: React.FC<StudioSidebarProps> = ({
  models,
  selectedModel,
  onSelectModel,
  customModel,
  onChangeCustomModel,
  prompt,
  onChangePrompt,
  onOpenZenWorkbench,
  onOpenTemplates,
  onSaveAsTemplate,
  refMode,
  onChangeRefMode,
  imageHosts,
  imageHostProvider,
  onChangeImageHostProvider,
  litterboxExpiry,
  onChangeLitterboxExpiry,
  compressMaxDim,
  onChangeCompressMaxDim,
  compressQuality,
  onChangeCompressQuality,
  referenceImages,
  onFilesSelected,
  onAddRefUrl,
  onRemoveRef,
  onMoveRef,
  onRetryRef,
  onAnnotateRef,
  onPasteFromClipboardButton,
  onCopyText,
  onOpenSettingsTab,
  ratioPresets,
  selectedRatio,
  selectedSize,
  onSelectRatio,
  onSelectPresetSize,
  onSelectCustomRatioMode,
  customW,
  customH,
  onChangeCustomW,
  onChangeCustomH,
  onApplyCustomSize,
  quality,
  onChangeQuality,
  background,
  onChangeBackground,
  oversea,
  onChangeOversea,
  autoCompatFallback,
  onChangeAutoCompatFallback,
  batchCount,
  onChangeBatchCount,
  isSubmitting,
  onSubmitGenerate,
  onOpenDevPreview,
}) => {
  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const [refUrlInput, setRefUrlInput] = useState("")
  const [isDraggingRef, setIsDraggingRef] = useState(false)
  const [showCustomModelInput, setShowCustomModelInput] = useState(
    Boolean(customModel.trim())
  )

  const promptMetrics = useMemo(() => {
    const chars = Array.from(prompt).length
    const utf8Bytes = new TextEncoder().encode(prompt).length
    const mentionsMultiPhotos =
      batchCount === 1 &&
      /(生成[二三四五六七八九十2-9]张|[2-9]张独立|六宫格|四宫格)/.test(prompt)
    return { chars, utf8Bytes, mentionsMultiPhotos }
  }, [prompt, batchCount])

  const activeRatioGroup = useMemo(
    () =>
      ratioPresets.find((g) => g.ratio === selectedRatio) ||
      ratioPresets[0] ||
      null,
    [ratioPresets, selectedRatio]
  )

  const currentPixelInfo = useMemo(
    () => parsePixelDimensions(selectedSize),
    [selectedSize]
  )

  const customPixels = (Number(customW) || 0) * (Number(customH) || 0)
  const customPixelsValid =
    customPixels >= 655360 &&
    customPixels <= 8294400 &&
    customW >= 16 &&
    customW <= 3840 &&
    customH >= 16 &&
    customH <= 3840

  const anyUploadingRef = referenceImages.some((r) => r.uploading)

  return (
    <aside
      aria-label="创作参数面板"
      className="flex flex-col h-full bg-background/50 overflow-hidden"
    >
      {/* Scrollable Inspector Controls — Generous whitespace, soft tonal surfaces, zero dividing lines */}
      <div className="flex-1 overflow-y-auto px-5 pt-4 pb-6 space-y-5 studio-scroll">
        {/* 1. Model Selector */}
        <section className="apple-surface rounded-3xl p-4 space-y-2.5">
          <div className="flex items-center justify-between">
            <Label className="text-xs font-medium text-muted-foreground">
              模型
            </Label>
            <button
              type="button"
              onClick={() => setShowCustomModelInput((prev) => !prev)}
              className="inline-flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground transition-colors cursor-pointer"
            >
              <span>{customModel.trim() ? "自定义模型" : "自定义 ID"}</span>
              <ChevronDown
                className={cn(
                  "h-3 w-3 transition-transform",
                  showCustomModelInput && "rotate-180"
                )}
              />
            </button>
          </div>

          <div className="grid grid-cols-2 gap-1.5">
            {models.map((m, idx) => {
              const isSelected = !customModel.trim() && selectedModel === m.id
              const spanFull = models.length % 2 === 1 && idx === models.length - 1
              return (
                <Tooltip key={m.id}>
                  <TooltipTrigger asChild>
                    <button
                      id={`model-card-${m.id}`}
                      type="button"
                      onClick={() => {
                        onSelectModel(m.id)
                        onChangeCustomModel("")
                      }}
                      className={cn(
                        "flex flex-col justify-between rounded-2xl px-3 py-2.5 text-left transition-all cursor-pointer",
                        spanFull && "col-span-2",
                        isSelected
                          ? "bg-primary text-primary-foreground shadow-xs"
                          : "bg-foreground/[0.035] text-foreground hover:bg-foreground/[0.065]"
                      )}
                    >
                      <div className="flex items-center justify-between gap-1.5 w-full">
                        <span className="text-xs font-medium truncate">
                          {m.name.replace("GPT-Image ", "Image ")}
                        </span>
                        <span
                          className={cn(
                            "rounded-full px-1.5 py-0.5 text-[10px] shrink-0",
                            isSelected
                              ? "bg-primary-foreground/18 text-primary-foreground"
                              : "bg-foreground/[0.06] text-muted-foreground"
                          )}
                        >
                          {m.badge}
                        </span>
                      </div>
                      <div
                        className={cn(
                          "mt-1 flex items-center justify-between text-[10px] font-mono",
                          isSelected
                            ? "text-primary-foreground/70"
                            : "text-muted-foreground"
                        )}
                      >
                        <span className="truncate">{m.id}</span>
                        <span className="shrink-0">{m.price}</span>
                      </div>
                    </button>
                  </TooltipTrigger>
                  <TooltipContent side="right" className="max-w-xs space-y-1">
                    <p className="font-medium">{m.name}</p>
                    <p className="opacity-80 leading-relaxed">{m.description}</p>
                  </TooltipContent>
                </Tooltip>
              )
            })}
          </div>

          {(showCustomModelInput || Boolean(customModel.trim())) && (
            <Input
              id="input-custom-model"
              value={customModel}
              onChange={(e) => onChangeCustomModel(e.target.value)}
              placeholder="自定义模型 ID..."
              className="h-8 text-xs font-mono"
            />
          )}
        </section>

        {/* 2. Prompt Area */}
        <section className="apple-surface rounded-3xl p-4 space-y-2.5">
          <div className="flex items-center justify-between gap-2">
            <Label
              htmlFor="input-prompt"
              className="text-xs font-medium text-muted-foreground"
            >
              画面描述
            </Label>
            <div className="flex items-center gap-1">
              {onOpenZenWorkbench && (
                <button
                  type="button"
                  onClick={onOpenZenWorkbench}
                  className="inline-flex items-center gap-1 rounded-full bg-foreground/[0.045] px-2.5 py-1 text-[11px] font-medium text-muted-foreground hover:bg-foreground/[0.085] hover:text-foreground transition-colors cursor-pointer"
                >
                  <Maximize2 className="h-3 w-3" />
                  长文
                </button>
              )}
              <button
                id="btn-open-templates"
                type="button"
                onClick={onOpenTemplates}
                className="inline-flex items-center gap-1 rounded-full bg-foreground/[0.045] px-2.5 py-1 text-[11px] font-medium text-muted-foreground hover:bg-foreground/[0.085] hover:text-foreground transition-colors cursor-pointer"
              >
                <BookMarked className="h-3 w-3" />
                配方
              </button>
              <button
                id="btn-save-prompt-template"
                type="button"
                onClick={onSaveAsTemplate}
                disabled={!prompt.trim()}
                className="inline-flex items-center gap-1 rounded-full bg-foreground/[0.045] px-2.5 py-1 text-[11px] text-muted-foreground hover:bg-foreground/[0.085] hover:text-foreground disabled:opacity-40 transition-colors cursor-pointer"
              >
                <BookmarkPlus className="h-3 w-3" />
                收藏
              </button>
            </div>
          </div>

          <div className="relative">
            <Textarea
              id="input-prompt"
              value={prompt}
              onChange={(e) => onChangePrompt(e.target.value)}
              onKeyDown={(e) => {
                if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
                  e.preventDefault()
                  if (!isSubmitting && !anyUploadingRef) {
                    onSubmitGenerate()
                  }
                }
              }}
              maxLength={5000}
              rows={5}
              placeholder="描述构图、人物与光影细节..."
              className="resize-y leading-relaxed text-[13px] pb-6"
            />
            <div className="pointer-events-none absolute inset-x-3 bottom-2 flex items-center justify-end text-[10px] font-mono">
              <span
                id="prompt-char-count"
                className={cn(
                  "tabular-nums",
                  promptMetrics.utf8Bytes > 5000
                    ? "text-amber-600 dark:text-amber-400 font-medium"
                    : "text-muted-foreground/70"
                )}
              >
                {promptMetrics.chars}/5000
              </span>
            </div>
          </div>

          {promptMetrics.mentionsMultiPhotos && (
            <div className="flex items-center justify-between gap-2 rounded-2xl bg-foreground/[0.045] px-3 py-2 text-[11px]">
              <span className="text-muted-foreground leading-snug">
                单次建议描述单张画面，使用并发生成多张
              </span>
              <button
                type="button"
                onClick={() => onChangeBatchCount(4)}
                className="shrink-0 rounded-full bg-primary px-2.5 py-1 text-[10px] font-medium text-primary-foreground cursor-pointer"
              >
                并发 4 张
              </button>
            </div>
          )}

          <div className="flex flex-wrap items-center gap-1.5">
            {QUICK_STYLE_SNIPPETS.map((item) => (
              <button
                key={item.label}
                type="button"
                onClick={() => {
                  const cur = prompt.trim()
                  onChangePrompt(cur ? `${cur}\n${item.text}` : item.text)
                }}
                className="rounded-full bg-foreground/[0.04] px-2.5 py-1 text-[11px] text-muted-foreground transition-colors hover:bg-foreground/[0.08] hover:text-foreground cursor-pointer"
              >
                {item.label}
              </button>
            ))}
            {prompt && (
              <button
                id="btn-clear-prompt"
                type="button"
                onClick={() => onChangePrompt("")}
                className="ml-auto text-[11px] text-muted-foreground hover:text-destructive cursor-pointer"
              >
                清空
              </button>
            )}
          </div>
        </section>

        {/* 3. Reference Images */}
        <section className="apple-surface rounded-3xl p-4 space-y-3">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <Label className="text-xs font-medium text-muted-foreground">
                参考图
              </Label>
              {referenceImages.length > 0 && (
                <Badge variant="secondary" className="text-[10px] font-mono px-2 py-0">
                  {referenceImages.length}
                </Badge>
              )}
            </div>
            {referenceImages.length > 0 && (
              <button
                type="button"
                onClick={() => {
                  for (const item of referenceImages) {
                    onRemoveRef(item.id)
                  }
                }}
                className="text-[11px] text-muted-foreground hover:text-destructive cursor-pointer"
              >
                清空
              </button>
            )}
          </div>

          {/* 3-Mode Segmented Pill */}
          <div className="space-y-2">
            <div
              role="radiogroup"
              aria-label="参考图传输方式"
              className="grid grid-cols-3 gap-1 rounded-full bg-foreground/[0.045] p-1"
            >
              <button
                id="ref-mode-upload"
                type="button"
                role="radio"
                aria-checked={refMode === "upload"}
                onClick={() => onChangeRefMode("upload")}
                className={cn(
                  "rounded-full py-1.5 text-[11px] font-medium transition-all cursor-pointer truncate px-2",
                  refMode === "upload"
                    ? "bg-card text-foreground shadow-2xs"
                    : "text-muted-foreground hover:text-foreground"
                )}
              >
                图床直链
              </button>
              <button
                id="ref-mode-compress-base64"
                type="button"
                role="radio"
                aria-checked={refMode === "compress_base64"}
                onClick={() => onChangeRefMode("compress_base64")}
                className={cn(
                  "rounded-full py-1.5 text-[11px] font-medium transition-all cursor-pointer truncate px-2",
                  refMode === "compress_base64"
                    ? "bg-card text-foreground shadow-2xs"
                    : "text-muted-foreground hover:text-foreground"
                )}
              >
                压缩 Base64
              </button>
              <button
                id="ref-mode-raw-base64"
                type="button"
                role="radio"
                aria-checked={refMode === "raw_base64"}
                onClick={() => onChangeRefMode("raw_base64")}
                className={cn(
                  "rounded-full py-1.5 text-[11px] font-medium transition-all cursor-pointer truncate px-2",
                  refMode === "raw_base64"
                    ? "bg-card text-foreground shadow-2xs"
                    : "text-muted-foreground hover:text-foreground"
                )}
              >
                原图 Base64
              </button>
            </div>

            {refMode === "upload" && (
              <div className="flex items-center justify-between gap-2 text-[11px] px-1">
                <div className="flex items-center gap-1.5 min-w-0">
                  <select
                    id="select-inline-image-host"
                    value={imageHostProvider}
                    onChange={(e) =>
                      onChangeImageHostProvider(e.target.value as ImageHostProvider)
                    }
                    className="h-7 rounded-full bg-foreground/[0.045] px-2.5 text-[11px] text-foreground focus:outline-none"
                  >
                    {(imageHosts.length > 0
                      ? imageHosts
                      : [
                          { id: "auto", name: "自动节点" },
                          { id: "litterbox", name: "Litterbox" },
                          { id: "catbox", name: "Catbox" },
                          { id: "tmpfiles", name: "Tmpfiles" },
                          { id: "uguu", name: "Uguu" },
                          { id: "0x0", name: "0x0.st" },
                          { id: "custom", name: "自定义图床" },
                        ]
                    ).map((h) => (
                      <option key={h.id} value={h.id}>
                        {h.name}
                      </option>
                    ))}
                  </select>
                  {(imageHostProvider === "auto" ||
                    imageHostProvider === "litterbox") && (
                    <select
                      aria-label="有效期"
                      value={litterboxExpiry}
                      onChange={(e) => onChangeLitterboxExpiry(e.target.value)}
                      className="h-7 rounded-full bg-foreground/[0.045] px-2.5 text-[11px] font-mono text-muted-foreground focus:outline-none"
                    >
                      <option value="1h">1h</option>
                      <option value="12h">12h</option>
                      <option value="24h">24h</option>
                      <option value="72h">72h</option>
                    </select>
                  )}
                </div>
                {imageHostProvider === "custom" && (
                  <button
                    type="button"
                    onClick={() => onOpenSettingsTab("ref")}
                    className="text-foreground underline underline-offset-4 shrink-0 cursor-pointer"
                  >
                    配置
                  </button>
                )}
              </div>
            )}

            {refMode === "compress_base64" && (
              <div className="flex items-center justify-between gap-2 text-[11px] px-1">
                <select
                  value={compressMaxDim}
                  onChange={(e) =>
                    onChangeCompressMaxDim(parseInt(e.target.value, 10))
                  }
                  className="h-7 rounded-full bg-foreground/[0.045] px-2.5 font-mono text-[11px] text-foreground focus:outline-none"
                >
                  <option value={1024}>长边 1024px</option>
                  <option value={1536}>长边 1536px</option>
                  <option value={2048}>长边 2048px</option>
                  <option value={2560}>长边 2560px</option>
                </select>
                <select
                  value={compressQuality}
                  onChange={(e) =>
                    onChangeCompressQuality(parseInt(e.target.value, 10))
                  }
                  className="h-7 rounded-full bg-foreground/[0.045] px-2.5 font-mono text-[11px] text-foreground focus:outline-none"
                >
                  <option value={75}>品质 75%</option>
                  <option value={85}>品质 85%</option>
                  <option value={92}>品质 92%</option>
                </select>
              </div>
            )}
          </div>

          {/* Tonal Drop Zone — zero dashed borders */}
          <div
            id="ref-drop-zone"
            onDragOver={(e) => {
              e.preventDefault()
              setIsDraggingRef(true)
            }}
            onDragLeave={() => setIsDraggingRef(false)}
            onDrop={(e) => {
              e.preventDefault()
              setIsDraggingRef(false)
              if (e.dataTransfer?.files?.length) {
                onFilesSelected(e.dataTransfer.files)
              }
            }}
            className={cn(
              "rounded-2xl p-2.5 transition-colors space-y-2",
              isDraggingRef
                ? "bg-foreground/[0.09]"
                : "bg-foreground/[0.03]"
            )}
          >
            <div className="grid grid-cols-[1fr_auto] gap-1.5">
              <Button
                id="btn-select-local-image"
                type="button"
                variant="outline"
                size="sm"
                className="h-8 text-xs justify-center bg-background/80"
                onClick={() => fileInputRef.current?.click()}
              >
                <Upload className="h-3.5 w-3.5" />
                上传或拖入图片
              </Button>
              <Button
                id="btn-paste-clipboard-image"
                type="button"
                variant="outline"
                size="sm"
                className="h-8 px-3 text-xs bg-background/80"
                onClick={onPasteFromClipboardButton}
              >
                <ClipboardPaste className="h-3.5 w-3.5" />
                粘贴
              </Button>
              <input
                ref={fileInputRef}
                id="input-local-file"
                type="file"
                accept="image/*"
                multiple
                hidden
                onChange={(e) => {
                  if (e.target.files?.length) {
                    onFilesSelected(e.target.files)
                    e.target.value = ""
                  }
                }}
              />
            </div>

            <div className="flex gap-1.5">
              <Input
                id="input-ref-url"
                type="url"
                value={refUrlInput}
                onChange={(e) => setRefUrlInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault()
                    if (refUrlInput.trim()) {
                      onAddRefUrl(refUrlInput)
                      setRefUrlInput("")
                    }
                  }
                }}
                placeholder="粘贴图片直链 https://..."
                className="h-7 text-xs bg-background/80 rounded-full px-3"
              />
              <Button
                id="btn-add-ref-url"
                type="button"
                variant="outline"
                size="xs"
                className="h-7 px-2.5 bg-background/80"
                onClick={() => {
                  if (refUrlInput.trim()) {
                    onAddRefUrl(refUrlInput)
                    setRefUrlInput("")
                  }
                }}
              >
                <Plus className="h-3 w-3" />
              </Button>
            </div>

            {referenceImages.length > 0 && (
              <div className="grid grid-cols-3 gap-2 pt-1">
                {referenceImages.map((item, idx) => (
                  <div
                    key={item.id}
                    className={cn(
                      "group relative aspect-square overflow-hidden rounded-xl bg-secondary",
                      item.error && "ring-1.5 ring-destructive"
                    )}
                  >
                    <img
                      src={item.preview}
                      alt={`图${idx + 1}`}
                      className="h-full w-full object-cover"
                    />

                    <button
                      type="button"
                      onClick={() =>
                        onChangePrompt(
                          prompt.trim()
                            ? `${prompt} 图${idx + 1}`
                            : `图${idx + 1}`
                        )
                      }
                      title="插入引用"
                      className="absolute left-1 top-1 rounded-full bg-black/65 backdrop-blur-md px-2 py-0.5 font-mono text-[10px] font-medium text-white hover:bg-white hover:text-zinc-950 transition-colors cursor-pointer"
                    >
                      @图{idx + 1}
                    </button>

                    <button
                      type="button"
                      onClick={() => onRemoveRef(item.id)}
                      title="移除"
                      className="absolute right-1 top-1 flex h-5 w-5 items-center justify-center rounded-full bg-black/65 backdrop-blur-md text-white hover:bg-red-500 cursor-pointer"
                    >
                      <X className="h-3 w-3" />
                    </button>

                    <div className="absolute inset-x-1 top-7 flex items-center justify-between opacity-0 group-hover:opacity-100 transition-opacity">
                      <div className="flex gap-0.5">
                        {idx > 0 && (
                          <button
                            type="button"
                            onClick={() => onMoveRef(idx, -1)}
                            className="flex h-5 w-5 items-center justify-center rounded-full bg-black/65 text-white hover:bg-white hover:text-zinc-950 cursor-pointer"
                          >
                            <ChevronLeft className="h-3 w-3" />
                          </button>
                        )}
                        {idx < referenceImages.length - 1 && (
                          <button
                            type="button"
                            onClick={() => onMoveRef(idx, 1)}
                            className="flex h-5 w-5 items-center justify-center rounded-full bg-black/65 text-white hover:bg-white hover:text-zinc-950 cursor-pointer"
                          >
                            <ChevronRight className="h-3 w-3" />
                          </button>
                        )}
                      </div>
                      <div className="flex gap-0.5">
                        {onAnnotateRef && !item.uploading && (
                          <button
                            type="button"
                            onClick={() => onAnnotateRef(item)}
                            title="标注或裁剪"
                            className="flex h-5 w-5 items-center justify-center rounded-full bg-black/65 text-white hover:bg-white hover:text-zinc-950 cursor-pointer"
                          >
                            <PencilRuler className="h-2.5 w-2.5" />
                          </button>
                        )}
                        {item.remote_url && (
                          <button
                            type="button"
                            onClick={() =>
                              onCopyText(item.remote_url!, "已复制图床直链")
                            }
                            title="复制直链"
                            className="flex h-5 w-5 items-center justify-center rounded-full bg-black/65 text-white hover:bg-white hover:text-zinc-950 cursor-pointer"
                          >
                            <Copy className="h-2.5 w-2.5" />
                          </button>
                        )}
                      </div>
                    </div>

                    {item.error ? (
                      <div className="absolute inset-x-0 bottom-0 bg-red-950/92 p-1 text-center space-y-1">
                        <div className="flex items-center justify-center gap-1 text-[10px] text-red-200 font-medium">
                          <AlertTriangle className="h-2.5 w-2.5 shrink-0" />
                          <span className="truncate">上传失败</span>
                        </div>
                        <div className="flex justify-center gap-1">
                          <button
                            type="button"
                            onClick={() => onRetryRef(item)}
                            className="rounded-full bg-white/15 px-2 py-0.5 text-[9px] text-white hover:bg-white/25 cursor-pointer"
                          >
                            <RefreshCw className="inline h-2.5 w-2.5 mr-0.5" />
                            重试
                          </button>
                          <button
                            type="button"
                            onClick={() => onChangeRefMode("compress_base64")}
                            className="rounded-full bg-white px-2 py-0.5 text-[9px] font-medium text-zinc-950 cursor-pointer"
                          >
                            Base64
                          </button>
                        </div>
                      </div>
                    ) : (
                      <div className="absolute inset-x-0 bottom-0 flex items-center justify-center gap-1 bg-black/60 backdrop-blur-sm px-1.5 py-0.5 text-[10px] text-white/90 truncate">
                        {item.uploading ? (
                          <Loader2 className="h-2.5 w-2.5 animate-spin shrink-0" />
                        ) : item.mode === "upload" || item.mode === "url" ? (
                          <Link2 className="h-2.5 w-2.5 shrink-0 text-emerald-400" />
                        ) : null}
                        <span className="truncate">{item.label}</span>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        </section>

        {/* 4. Aspect Ratio & Resolution */}
        <section className="apple-surface rounded-3xl p-4 space-y-3">
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label className="text-xs font-medium text-muted-foreground">
                画幅与尺寸
              </Label>
              <span className="font-mono text-[11px] text-foreground tabular-nums">
                {selectedSize}
                {currentPixelInfo ? ` · ${currentPixelInfo.mp}MP` : ""}
              </span>
            </div>

            <div id="ratio-pills-container" className="grid grid-cols-4 gap-1.5">
              {ratioPresets.map((grp) => {
                const active = selectedRatio === grp.ratio
                return (
                  <button
                    key={grp.ratio}
                    id={`ratio-pill-${grp.ratio}`}
                    type="button"
                    onClick={() => onSelectRatio(grp)}
                    className={cn(
                      "flex items-center justify-center gap-1.5 rounded-xl px-2 py-1.5 text-xs font-medium transition-all cursor-pointer",
                      active
                        ? "bg-primary text-primary-foreground shadow-2xs"
                        : "bg-foreground/[0.04] text-muted-foreground hover:bg-foreground/[0.08] hover:text-foreground"
                    )}
                  >
                    <AspectRatioFrame w={grp.aspect_w} h={grp.aspect_h} />
                    <span className="truncate">{grp.ratio}</span>
                  </button>
                )
              })}
              <button
                id="ratio-pill-custom"
                type="button"
                onClick={onSelectCustomRatioMode}
                className={cn(
                  "col-span-4 flex items-center justify-center gap-1.5 rounded-xl px-2 py-1.5 text-xs font-medium transition-all cursor-pointer",
                  selectedRatio === "custom"
                    ? "bg-primary text-primary-foreground shadow-2xs"
                    : "bg-foreground/[0.04] text-muted-foreground hover:bg-foreground/[0.08] hover:text-foreground"
                )}
              >
                <span>自定义宽高</span>
              </button>
            </div>
          </div>

          {selectedRatio !== "custom" && activeRatioGroup ? (
            <div id="size-presets-container" className="grid grid-cols-2 gap-1.5 pt-1">
              {(activeRatioGroup.sizes || []).map((item, idx, arr) => {
                const active = selectedSize === item.value
                const isSpanFull = arr.length % 2 === 1 && idx === arr.length - 1
                return (
                  <button
                    key={item.value}
                    id={`size-preset-${item.value}`}
                    type="button"
                    onClick={() => onSelectPresetSize(item.value, item.tier)}
                    className={cn(
                      "flex items-center justify-between rounded-xl px-3 py-2 text-left transition-all cursor-pointer",
                      isSpanFull && "col-span-2",
                      active
                        ? "bg-foreground/[0.09] text-foreground font-medium"
                        : "bg-foreground/[0.035] text-muted-foreground hover:bg-foreground/[0.065] hover:text-foreground"
                    )}
                  >
                    <span className="text-xs">{item.label}</span>
                    <span className="font-mono text-[10px] opacity-75 tabular-nums">
                      {item.value}
                    </span>
                  </button>
                )
              })}
            </div>
          ) : (
            <div className="space-y-2 pt-1">
              <div className="flex items-end gap-1.5">
                <div className="flex-1 space-y-1">
                  <span className="text-[10px] text-muted-foreground">宽</span>
                  <Input
                    id="input-custom-w"
                    type="number"
                    min={16}
                    max={3840}
                    step={16}
                    value={customW}
                    onChange={(e) =>
                      onChangeCustomW(parseInt(e.target.value, 10) || 0)
                    }
                    className="h-8 font-mono text-xs tabular-nums"
                  />
                </div>
                <Button
                  type="button"
                  variant="outline"
                  size="icon"
                  className="h-8 w-8 shrink-0"
                  onClick={() => {
                    onChangeCustomW(customH)
                    onChangeCustomH(customW)
                    onApplyCustomSize(customH, customW)
                  }}
                >
                  <ArrowLeftRight className="h-3.5 w-3.5" />
                </Button>
                <div className="flex-1 space-y-1">
                  <span className="text-[10px] text-muted-foreground">高</span>
                  <Input
                    id="input-custom-h"
                    type="number"
                    min={16}
                    max={3840}
                    step={16}
                    value={customH}
                    onChange={(e) =>
                      onChangeCustomH(parseInt(e.target.value, 10) || 0)
                    }
                    className="h-8 font-mono text-xs tabular-nums"
                  />
                </div>
                <Button
                  id="btn-apply-custom-size"
                  type="button"
                  variant="outline"
                  size="sm"
                  className="h-8 px-3 text-xs"
                  onClick={() => onApplyCustomSize()}
                >
                  应用
                </Button>
              </div>
              <div className="flex items-center justify-between text-[10px] tabular-nums px-0.5">
                <span
                  className={cn(
                    "font-mono",
                    customPixelsValid
                      ? "text-muted-foreground"
                      : "text-destructive"
                  )}
                >
                  {(customPixels / 10000).toFixed(1)} 万像素
                </span>
                <span className="text-muted-foreground/70 font-mono">
                  65.5 ~ 829.4 万
                </span>
              </div>
            </div>
          )}
        </section>

        {/* 5. Quality & Channel */}
        <section className="apple-surface rounded-3xl p-4 space-y-3">
          <div className="grid grid-cols-2 gap-2.5">
            <div className="space-y-1">
              <Label className="text-[11px] text-muted-foreground">画质</Label>
              <Select value={quality} onValueChange={onChangeQuality}>
                <SelectTrigger id="select-quality" className="h-8 text-xs">
                  <SelectValue placeholder="画质" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="default">自动</SelectItem>
                  <SelectItem value="low">极速 (Low)</SelectItem>
                  <SelectItem value="medium">标准 (Medium)</SelectItem>
                  <SelectItem value="high">精细 (High)</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1">
              <Label className="text-[11px] text-muted-foreground">背景</Label>
              <Select value={background} onValueChange={onChangeBackground}>
                <SelectTrigger id="select-background" className="h-8 text-xs">
                  <SelectValue placeholder="背景" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="auto">自动</SelectItem>
                  <SelectItem value="opaque">不透明</SelectItem>
                  <SelectItem value="transparent">透明 PNG</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-2">
            <div className="flex h-9 items-center justify-between rounded-2xl bg-foreground/[0.035] px-3">
              <Label
                htmlFor="chk-oversea"
                className="text-xs cursor-pointer select-none"
              >
                海外节点
              </Label>
              <Switch
                id="chk-oversea"
                checked={oversea}
                onCheckedChange={onChangeOversea}
              />
            </div>

            <div className="flex h-9 items-center justify-between rounded-2xl bg-foreground/[0.035] px-3">
              <Label
                htmlFor="chk-compat-fallback"
                className="text-xs cursor-pointer select-none truncate"
              >
                兼容重试
              </Label>
              <Switch
                id="chk-compat-fallback"
                checked={autoCompatFallback}
                onCheckedChange={onChangeAutoCompatFallback}
              />
            </div>
          </div>
        </section>
      </div>

      {/* Floating Frosted Bottom Dock */}
      <div className="bg-background/80 backdrop-blur-2xl px-5 py-3.5 space-y-2.5 shrink-0">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-1.5">
            <span className="text-xs text-muted-foreground">张数</span>
            <div className="inline-flex items-center rounded-full bg-foreground/[0.045] p-0.5">
              {[1, 2, 4, 6].map((num) => (
                <button
                  key={num}
                  type="button"
                  onClick={() => onChangeBatchCount(num)}
                  className={cn(
                    "rounded-full px-2.5 py-0.5 text-xs font-mono transition-all cursor-pointer tabular-nums",
                    batchCount === num
                      ? "bg-card text-foreground font-medium shadow-2xs"
                      : "text-muted-foreground hover:text-foreground"
                  )}
                >
                  {num}
                </button>
              ))}
            </div>
            <Input
              id="input-count-n"
              type="number"
              min={1}
              max={10}
              value={batchCount}
              onChange={(e) =>
                onChangeBatchCount(
                  Math.max(1, Math.min(10, parseInt(e.target.value, 10) || 1))
                )
              }
              className="h-7 w-12 rounded-full px-2 text-center font-mono text-xs tabular-nums"
            />
          </div>

          <Button
            id="btn-open-dev-preview"
            type="button"
            variant="ghost"
            size="icon"
            className="h-7 w-7"
            onClick={onOpenDevPreview}
            aria-label="请求预览"
          >
            <Code2 className="h-3.5 w-3.5" />
          </Button>
        </div>

        <Button
          id="btn-submit-generate"
          type="button"
          size="lg"
          disabled={isSubmitting || anyUploadingRef}
          onClick={onSubmitGenerate}
          className="w-full h-10"
        >
          {anyUploadingRef ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin" />
              上传参考图中...
            </>
          ) : isSubmitting ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin" />
              提交中...
            </>
          ) : batchCount > 1 ? (
            `生成 ${batchCount} 张`
          ) : (
            "生成"
          )}
        </Button>
      </div>
    </aside>
  )
}
