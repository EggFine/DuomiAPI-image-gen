import React, { useMemo, useRef, useState } from "react"
import {
  AlertTriangle,
  ArrowLeftRight,
  BookMarked,
  BookmarkPlus,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ClipboardPaste,
  CloudUpload,
  Code2,
  Copy,
  FileArchive,
  FileCode2,
  Link2,
  Loader2,
  Maximize2,
  PencilRuler,
  Plus,
  RefreshCw,
  Settings2,
  Sparkles,
  Upload,
  Wand2,
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
  { label: "写实手机抓拍", text: "普通智能手机后置主摄随手抓拍质感，自然混合环境光，真实皮肤纹理与衣物褶皱，无商业滤镜" },
  { label: "电影感自然光", text: "电影级自然光影层次，细腻明暗过渡，高宽容度写实质感" },
  { label: "商业静物精修", text: "专业影棚柔光箱布光，极简干净背景，精细材质高光与微距质感" },
  { label: "日系厚涂插画", text: "精品日系厚涂概念插画风格，色彩通透丰富，笔触细腻有层次" },
  { label: "严谨空间透视", text: "横平竖直的真实物理空间线性透视，桌椅设备轴线对齐，无穿模变形" },
]

function AspectRatioFrame({ w, h }: { w: number; h: number }) {
  if (!w || !h) {
    return (
      <span className="inline-flex h-3.5 w-3.5 items-center justify-center rounded-[2px] border border-dashed border-current opacity-70 text-[9px] font-mono">
        A
      </span>
    )
  }
  const maxSide = 13
  let boxW = maxSide
  let boxH = maxSide
  if (w >= h) {
    boxH = Math.max(6, Math.round((maxSide * h) / w))
  } else {
    boxW = Math.max(6, Math.round((maxSide * w) / h))
  }
  return (
    <span
      className="inline-block rounded-[2px] border border-current opacity-80 shrink-0"
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
      aria-label="图像生成参数工作台"
      className="flex flex-col h-full bg-card/55 border-b lg:border-b-0 lg:border-r border-border overflow-hidden"
    >
      {/* Scrollable Inspector Controls */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {/* 1. Compact Model Grid */}
        <section className="space-y-2">
          <div className="flex items-center justify-between">
            <Label className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
              生图模型 (Model)
            </Label>
            <button
              type="button"
              onClick={() => setShowCustomModelInput((prev) => !prev)}
              className="inline-flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground cursor-pointer"
            >
              <span>{customModel.trim() ? "正在使用自定义模型" : "自定义模型 ID"}</span>
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
                        "flex flex-col justify-between rounded-xl border px-3 py-2 text-left transition-all cursor-pointer",
                        spanFull && "col-span-2",
                        isSelected
                          ? "border-amber-500/75 bg-amber-500/[0.09] shadow-2xs"
                          : "border-border bg-background/60 hover:bg-accent/50"
                      )}
                    >
                      <div className="flex items-center justify-between gap-1.5 w-full">
                        <span className="text-xs font-semibold text-foreground truncate">
                          {m.name.replace("GPT-Image ", "Image ")}
                        </span>
                        <Badge
                          variant={isSelected ? "amber" : "secondary"}
                          className="text-[10px] px-1.5 py-0 shrink-0"
                        >
                          {m.badge}
                        </Badge>
                      </div>
                      <div className="mt-1 flex items-center justify-between text-[10px] text-muted-foreground font-mono">
                        <span className="truncate">{m.id}</span>
                        <span className="shrink-0">{m.price}</span>
                      </div>
                    </button>
                  </TooltipTrigger>
                  <TooltipContent side="right" className="max-w-xs space-y-1">
                    <p className="font-semibold text-foreground">{m.name}</p>
                    <p className="text-muted-foreground leading-relaxed">
                      {m.description}
                    </p>
                  </TooltipContent>
                </Tooltip>
              )
            })}
          </div>

          {(showCustomModelInput || Boolean(customModel.trim())) && (
            <div className="pt-1">
              <Input
                id="input-custom-model"
                value={customModel}
                onChange={(e) => onChangeCustomModel(e.target.value)}
                placeholder="输入任意多米支持的模型 ID（留空则使用上方选中模型）"
                className="h-8 text-xs font-mono"
              />
            </div>
          )}
        </section>

        {/* 2. Prompt Workbench */}
        <section className="space-y-2">
          <div className="flex items-center justify-between gap-2">
            <Label
              htmlFor="input-prompt"
              className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground"
            >
              画面描述词 (Prompt)
            </Label>
            <div className="flex items-center gap-1.5">
              {onOpenZenWorkbench && (
                <button
                  type="button"
                  onClick={onOpenZenWorkbench}
                  className="inline-flex items-center gap-1 rounded-md border border-border bg-background/70 px-2 py-0.5 text-[11px] font-medium text-foreground hover:bg-accent transition-colors cursor-pointer"
                  title="打开大屏结构化提示词工程台"
                >
                  <Maximize2 className="h-3 w-3 text-amber-500" />
                  工程台
                </button>
              )}
              <button
                id="btn-open-templates"
                type="button"
                onClick={onOpenTemplates}
                className="inline-flex items-center gap-1 rounded-md border border-border bg-background/70 px-2 py-0.5 text-[11px] font-medium text-foreground hover:bg-accent transition-colors cursor-pointer"
              >
                <BookMarked className="h-3 w-3 text-amber-500" />
                灵感库
              </button>
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    id="btn-save-prompt-template"
                    type="button"
                    onClick={onSaveAsTemplate}
                    disabled={!prompt.trim()}
                    className="inline-flex items-center gap-1 rounded-md border border-border bg-background/70 px-2 py-0.5 text-[11px] text-muted-foreground hover:text-foreground disabled:opacity-40 transition-colors cursor-pointer"
                  >
                    <BookmarkPlus className="h-3 w-3" />
                    存模板
                  </button>
                </TooltipTrigger>
                <TooltipContent>
                  将当前提示词与模型/尺寸参数保存到本地模板库
                </TooltipContent>
              </Tooltip>
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
              placeholder="描述画面主体、人物特征、空间关系、光线质感...（支持 Ctrl+V 直接粘贴截图作为参考图，Ctrl+Enter 立即生成）"
              className="resize-y leading-relaxed text-xs sm:text-[13px] pb-6"
            />
            <div className="pointer-events-none absolute inset-x-2.5 bottom-1.5 flex items-center justify-between text-[10px] font-mono">
              <span className="text-muted-foreground/75">
                Ctrl+Enter 提交 · Ctrl+V 贴图
              </span>
              <span
                id="prompt-char-count"
                className={cn(
                  "tabular-nums",
                  promptMetrics.utf8Bytes > 5000
                    ? "text-amber-500 font-semibold"
                    : "text-muted-foreground"
                )}
              >
                {promptMetrics.chars}/5000 字 ({promptMetrics.utf8Bytes} B)
              </span>
            </div>
          </div>

          {promptMetrics.mentionsMultiPhotos && (
            <div className="flex items-center justify-between gap-2 rounded-lg border border-amber-500/35 bg-amber-500/10 px-2.5 py-1.5 text-[11px]">
              <span className="text-amber-700 dark:text-amber-300 leading-snug">
                检测到提示词描述多张图：单任务易拼成宫格，建议单次描述 1 张并提高并发张数
              </span>
              <button
                type="button"
                onClick={() => onChangeBatchCount(4)}
                className="shrink-0 rounded bg-amber-500 px-2 py-0.5 text-[10px] font-semibold text-zinc-950 hover:bg-amber-400 cursor-pointer"
              >
                设为4张并发
              </button>
            </div>
          )}

          <div className="flex flex-wrap items-center gap-1">
            {QUICK_STYLE_SNIPPETS.map((item) => (
              <button
                key={item.label}
                type="button"
                onClick={() => {
                  const cur = prompt.trim()
                  onChangePrompt(cur ? `${cur}\n${item.text}` : item.text)
                }}
                className="inline-flex items-center gap-1 rounded-md border border-border bg-secondary/45 px-2 py-0.5 text-[11px] text-muted-foreground transition-colors hover:border-amber-500/40 hover:text-foreground cursor-pointer"
              >
                <Wand2 className="h-2.5 w-2.5 text-amber-500" />
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

        {/* 3. Reference Images · Image-to-Image with 3-Mode Strategy */}
        <section className="space-y-2.5 rounded-xl border border-border bg-background/45 p-3">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-1.5">
              <Label className="text-xs font-semibold text-foreground">
                参考图 · 图生图
              </Label>
              <Badge variant="outline" className="text-[10px] font-mono px-1.5 py-0">
                {referenceImages.length} 张
              </Badge>
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
                清空参考图
              </button>
            )}
          </div>

          {/* Explicit 3-Option Strategy Selector: Auto Image Host Default vs Optional Compress & Base64 */}
          <div className="space-y-1.5">
            <div
              role="radiogroup"
              aria-label="本地参考图处理方式"
              className="grid grid-cols-3 gap-1 rounded-lg border border-border bg-secondary/50 p-1"
            >
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    id="ref-mode-upload"
                    type="button"
                    role="radio"
                    aria-checked={refMode === "upload"}
                    onClick={() => onChangeRefMode("upload")}
                    className={cn(
                      "flex items-center justify-center gap-1 rounded-md px-2 py-1.5 text-[11px] font-medium transition-all cursor-pointer",
                      refMode === "upload"
                        ? "bg-card text-amber-600 dark:text-amber-400 font-semibold shadow-2xs border border-amber-500/40"
                        : "text-muted-foreground hover:text-foreground"
                    )}
                  >
                    <CloudUpload className="h-3.5 w-3.5 shrink-0" />
                    <span className="truncate">自动传图床</span>
                  </button>
                </TooltipTrigger>
                <TooltipContent className="max-w-xs">
                  【默认推荐】直接将本地原图无损上传至图床转为 https:// 直链，100% 保留人物五官与细节，彻底避免 Base64 体积超限报错。
                </TooltipContent>
              </Tooltip>

              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    id="ref-mode-compress-base64"
                    type="button"
                    role="radio"
                    aria-checked={refMode === "compress_base64"}
                    onClick={() => onChangeRefMode("compress_base64")}
                    className={cn(
                      "flex items-center justify-center gap-1 rounded-md px-2 py-1.5 text-[11px] font-medium transition-all cursor-pointer",
                      refMode === "compress_base64"
                        ? "bg-card text-amber-600 dark:text-amber-400 font-semibold shadow-2xs border border-amber-500/40"
                        : "text-muted-foreground hover:text-foreground"
                    )}
                  >
                    <FileArchive className="h-3.5 w-3.5 shrink-0" />
                    <span className="truncate">压缩转Base64</span>
                  </button>
                </TooltipTrigger>
                <TooltipContent className="max-w-xs">
                  【可选项】不经过任何第三方图床，仅在本地剥离元数据并压缩尺寸后编码为 Base64 直传多米 API。
                </TooltipContent>
              </Tooltip>

              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    id="ref-mode-raw-base64"
                    type="button"
                    role="radio"
                    aria-checked={refMode === "raw_base64"}
                    onClick={() => onChangeRefMode("raw_base64")}
                    className={cn(
                      "flex items-center justify-center gap-1 rounded-md px-2 py-1.5 text-[11px] font-medium transition-all cursor-pointer",
                      refMode === "raw_base64"
                        ? "bg-card text-amber-600 dark:text-amber-400 font-semibold shadow-2xs border border-amber-500/40"
                        : "text-muted-foreground hover:text-foreground"
                    )}
                  >
                    <FileCode2 className="h-3.5 w-3.5 shrink-0" />
                    <span className="truncate">原图Base64</span>
                  </button>
                </TooltipTrigger>
                <TooltipContent className="max-w-xs">
                  【可选项】不压缩、不传图床，直接将原文件编码为 Base64 发送（大图可能触发接口体积限制，仅建议小体积图片使用）。
                </TooltipContent>
              </Tooltip>
            </div>

            {/* Contextual Strategy Bar */}
            {refMode === "upload" && (
              <div className="flex items-center justify-between gap-2 text-[11px] px-0.5">
                <div className="flex items-center gap-1.5 min-w-0">
                  <span className="text-muted-foreground shrink-0">图床节点:</span>
                  <select
                    id="select-inline-image-host"
                    value={imageHostProvider}
                    onChange={(e) =>
                      onChangeImageHostProvider(e.target.value as ImageHostProvider)
                    }
                    className="h-6 rounded border border-border bg-card px-1.5 text-[11px] text-foreground focus:outline-none"
                  >
                    {(imageHosts.length > 0
                      ? imageHosts
                      : [
                          { id: "auto", name: "自动容灾 (推荐)" },
                          { id: "litterbox", name: "Litterbox 临时隐私" },
                          { id: "catbox", name: "Catbox" },
                          { id: "tmpfiles", name: "Tmpfiles" },
                          { id: "uguu", name: "Uguu" },
                          { id: "0x0", name: "0x0.st" },
                          { id: "custom", name: "自定义图床 API" },
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
                      aria-label="临时图床有效期"
                      value={litterboxExpiry}
                      onChange={(e) => onChangeLitterboxExpiry(e.target.value)}
                      className="h-6 rounded border border-border bg-card px-1.5 text-[11px] font-mono text-muted-foreground focus:outline-none"
                    >
                      <option value="1h">1h销毁</option>
                      <option value="12h">12h销毁</option>
                      <option value="24h">24h销毁</option>
                      <option value="72h">72h销毁</option>
                    </select>
                  )}
                </div>
                {imageHostProvider === "custom" && (
                  <button
                    type="button"
                    onClick={() => onOpenSettingsTab("ref")}
                    className="text-amber-500 hover:underline shrink-0 cursor-pointer"
                  >
                    配置接口
                  </button>
                )}
              </div>
            )}

            {refMode === "compress_base64" && (
              <div className="flex items-center justify-between gap-2 text-[11px] px-0.5">
                <div className="flex items-center gap-1.5">
                  <span className="text-muted-foreground">最大边长:</span>
                  <select
                    value={compressMaxDim}
                    onChange={(e) =>
                      onChangeCompressMaxDim(parseInt(e.target.value, 10))
                    }
                    className="h-6 rounded border border-border bg-card px-1.5 font-mono text-[11px] text-foreground focus:outline-none"
                  >
                    <option value={1024}>1024 px</option>
                    <option value={1536}>1536 px</option>
                    <option value={2048}>2048 px</option>
                    <option value={2560}>2560 px</option>
                  </select>
                </div>
                <div className="flex items-center gap-1.5">
                  <span className="text-muted-foreground">JPEG品质:</span>
                  <select
                    value={compressQuality}
                    onChange={(e) =>
                      onChangeCompressQuality(parseInt(e.target.value, 10))
                    }
                    className="h-6 rounded border border-border bg-card px-1.5 font-mono text-[11px] text-foreground focus:outline-none"
                  >
                    <option value={75}>75% (极小)</option>
                    <option value={85}>85% (均衡)</option>
                    <option value={92}>92% (高画质)</option>
                  </select>
                </div>
              </div>
            )}
          </div>

          {/* Drop Zone + Upload / Paste / URL Controls */}
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
              "rounded-lg border border-dashed p-2.5 transition-colors space-y-2",
              isDraggingRef
                ? "border-amber-500 bg-amber-500/10"
                : "border-border/80 bg-card/50"
            )}
          >
            <div className="grid grid-cols-[1fr_auto] gap-1.5">
              <Button
                id="btn-select-local-image"
                type="button"
                variant="secondary"
                size="sm"
                className="h-8 text-xs justify-center"
                onClick={() => fileInputRef.current?.click()}
              >
                <Upload className="h-3.5 w-3.5 text-amber-500" />
                {refMode === "upload"
                  ? "选择或拖拽图片（原图自动传图床）"
                  : "选择或拖拽本地参考图"}
              </Button>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    id="btn-paste-clipboard-image"
                    type="button"
                    variant="outline"
                    size="sm"
                    className="h-8 px-2.5 text-xs"
                    onClick={onPasteFromClipboardButton}
                  >
                    <ClipboardPaste className="h-3.5 w-3.5" />
                    粘贴图
                  </Button>
                </TooltipTrigger>
                <TooltipContent>
                  从系统剪贴板直接读取复制的图片或截图（也可直接按 Ctrl+V）
                </TooltipContent>
              </Tooltip>
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
                placeholder="或粘贴已有图片公网直链 URL (https://...)"
                className="h-7 text-xs"
              />
              <Button
                id="btn-add-ref-url"
                type="button"
                variant="outline"
                size="xs"
                className="h-7 px-2.5"
                onClick={() => {
                  if (refUrlInput.trim()) {
                    onAddRefUrl(refUrlInput)
                    setRefUrlInput("")
                  }
                }}
              >
                <Plus className="h-3 w-3" />
                添加
              </Button>
            </div>

            {/* Reference Image Cards Grid */}
            {referenceImages.length > 0 && (
              <div className="grid grid-cols-3 gap-2 pt-1">
                {referenceImages.map((item, idx) => (
                  <div
                    key={item.id}
                    className={cn(
                      "group relative aspect-square overflow-hidden rounded-lg border bg-secondary",
                      item.error ? "border-destructive" : "border-border"
                    )}
                  >
                    <img
                      src={item.preview}
                      alt={`图${idx + 1}`}
                      className="h-full w-full object-cover"
                    />

                    {/* Top Left Clickable Order Badge ("@图1") */}
                    <button
                      type="button"
                      onClick={() =>
                        onChangePrompt(
                          prompt.trim()
                            ? `${prompt} 图${idx + 1}`
                            : `图${idx + 1}`
                        )
                      }
                      title="点击在提示词中插入 图N 引用"
                      className="absolute left-1 top-1 rounded bg-black/75 px-1.5 py-0.5 font-mono text-[10px] font-semibold text-amber-400 hover:bg-amber-500 hover:text-zinc-950 transition-colors cursor-pointer"
                    >
                      @图{idx + 1}
                    </button>

                    {/* Top Right Remove Button */}
                    <button
                      type="button"
                      onClick={() => onRemoveRef(item.id)}
                      title="移除此参考图"
                      className="absolute right-1 top-1 flex h-5 w-5 items-center justify-center rounded-full bg-black/75 text-white hover:bg-red-600 cursor-pointer"
                    >
                      <X className="h-3 w-3" />
                    </button>

                    {/* Hover Reorder, Annotate & Copy URL Controls */}
                    <div className="absolute inset-x-1 top-7 flex items-center justify-between opacity-0 group-hover:opacity-100 transition-opacity">
                      <div className="flex gap-0.5">
                        {idx > 0 && (
                          <button
                            type="button"
                            onClick={() => onMoveRef(idx, -1)}
                            title="向前移动顺序"
                            className="flex h-5 w-5 items-center justify-center rounded bg-black/75 text-white hover:bg-amber-500 hover:text-zinc-950 cursor-pointer"
                          >
                            <ChevronLeft className="h-3 w-3" />
                          </button>
                        )}
                        {idx < referenceImages.length - 1 && (
                          <button
                            type="button"
                            onClick={() => onMoveRef(idx, 1)}
                            title="向后移动顺序"
                            className="flex h-5 w-5 items-center justify-center rounded bg-black/75 text-white hover:bg-amber-500 hover:text-zinc-950 cursor-pointer"
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
                            title="打开裁剪与画笔框选标注画板"
                            className="flex h-5 w-5 items-center justify-center rounded bg-black/75 text-amber-300 hover:bg-amber-500 hover:text-zinc-950 cursor-pointer"
                          >
                            <PencilRuler className="h-2.5 w-2.5" />
                          </button>
                        )}
                        {item.remote_url && (
                          <button
                            type="button"
                            onClick={() =>
                              onCopyText(item.remote_url!, "已复制图床直链 URL")
                            }
                            title="复制图床直链 URL"
                            className="flex h-5 w-5 items-center justify-center rounded bg-black/75 text-emerald-300 hover:bg-emerald-600 hover:text-white cursor-pointer"
                          >
                            <Copy className="h-2.5 w-2.5" />
                          </button>
                        )}
                      </div>
                    </div>

                    {/* Upload Error Overlay with Retry or Switch Option */}
                    {item.error ? (
                      <div className="absolute inset-x-0 bottom-0 bg-red-950/95 p-1 text-center space-y-1">
                        <div className="flex items-center justify-center gap-1 text-[10px] text-red-200 font-medium">
                          <AlertTriangle className="h-2.5 w-2.5 shrink-0" />
                          <span className="truncate">上传失败</span>
                        </div>
                        <div className="flex justify-center gap-1">
                          <button
                            type="button"
                            onClick={() => onRetryRef(item)}
                            className="rounded bg-white/15 px-1.5 py-0.5 text-[9px] text-white hover:bg-white/25 cursor-pointer"
                          >
                            <RefreshCw className="inline h-2.5 w-2.5 mr-0.5" />
                            重试
                          </button>
                          <button
                            type="button"
                            onClick={() => onChangeRefMode("compress_base64")}
                            className="rounded bg-amber-500 px-1.5 py-0.5 text-[9px] font-semibold text-zinc-950 cursor-pointer"
                          >
                            转Base64
                          </button>
                        </div>
                      </div>
                    ) : (
                      <div
                        className={cn(
                          "absolute inset-x-0 bottom-0 flex items-center justify-center gap-1 px-1.5 py-0.5 text-[10px] font-medium truncate",
                          item.uploading
                            ? "bg-amber-950/90 text-amber-200"
                            : item.mode === "upload" || item.mode === "url"
                            ? "bg-emerald-950/88 text-emerald-300"
                            : "bg-zinc-900/88 text-zinc-200"
                        )}
                      >
                        {item.uploading ? (
                          <Loader2 className="h-2.5 w-2.5 animate-spin shrink-0" />
                        ) : item.mode === "upload" || item.mode === "url" ? (
                          <Link2 className="h-2.5 w-2.5 shrink-0" />
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

        {/* 4. Two-Step Aspect Ratio -> Resolution Selector */}
        <section className="space-y-2.5 rounded-xl border border-border bg-background/45 p-3">
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label className="text-xs font-semibold text-foreground">
                1. 画幅比例 (Aspect Ratio)
              </Label>
              <span className="text-[11px] text-muted-foreground font-medium">
                {selectedRatio === "custom"
                  ? "自定义宽高"
                  : activeRatioGroup?.name || selectedRatio}
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
                      "flex items-center justify-center gap-1.5 rounded-lg border px-2 py-1.5 text-xs font-medium transition-all cursor-pointer",
                      active
                        ? "border-amber-500/80 bg-amber-500/15 text-amber-600 dark:text-amber-400 font-semibold shadow-2xs"
                        : "border-border bg-card/75 text-muted-foreground hover:bg-accent hover:text-foreground"
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
                  "col-span-4 flex items-center justify-center gap-1.5 rounded-lg border px-2 py-1.5 text-xs font-medium transition-all cursor-pointer",
                  selectedRatio === "custom"
                    ? "border-amber-500/80 bg-amber-500/15 text-amber-600 dark:text-amber-400 font-semibold shadow-2xs"
                    : "border-border bg-card/75 text-muted-foreground hover:bg-accent hover:text-foreground"
                )}
              >
                <Settings2 className="h-3.5 w-3.5" />
                <span>自定义精确像素宽高 (W × H)</span>
              </button>
            </div>
          </div>

          <div className="space-y-2 pt-2 border-t border-border/60">
            <div className="flex items-center justify-between gap-2">
              <Label className="text-xs font-semibold text-foreground">
                2. 对应预设尺寸 (Size)
              </Label>
              <div className="flex items-center gap-1.5">
                {currentPixelInfo && (
                  <span className="font-mono text-[10px] text-emerald-600 dark:text-emerald-400 inline-flex items-center gap-0.5 tabular-nums">
                    <Check className="h-2.5 w-2.5" />
                    {currentPixelInfo.mp} MP · 16px对齐
                  </span>
                )}
                <Badge variant="amber" className="font-mono text-[11px] tabular-nums">
                  {selectedSize}
                </Badge>
              </div>
            </div>

            {selectedRatio !== "custom" && activeRatioGroup ? (
              <div id="size-presets-container" className="grid grid-cols-2 gap-1.5">
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
                        "flex flex-col items-start justify-center rounded-lg border px-2.5 py-1.5 text-left transition-all cursor-pointer",
                        isSpanFull && "col-span-2",
                        active
                          ? "border-amber-500/80 bg-amber-500/15 shadow-2xs"
                          : "border-border bg-card/75 hover:bg-accent/60"
                      )}
                    >
                      <div className="flex w-full items-center justify-between gap-1">
                        <span
                          className={cn(
                            "text-xs font-semibold",
                            active
                              ? "text-amber-600 dark:text-amber-400"
                              : "text-foreground"
                          )}
                        >
                          {item.label}
                        </span>
                        <span className="font-mono text-[10px] text-muted-foreground tabular-nums">
                          {item.value}
                        </span>
                      </div>
                      <span className="text-[10px] text-muted-foreground mt-0.5 line-clamp-1">
                        {item.detail}
                      </span>
                    </button>
                  )
                })}
              </div>
            ) : (
              <div className="space-y-2 pt-1">
                <div className="flex items-end gap-1.5">
                  <div className="flex-1 space-y-1">
                    <span className="text-[10px] text-muted-foreground">
                      宽 (16~3840)
                    </span>
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
                  <Tooltip>
                    <TooltipTrigger asChild>
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
                    </TooltipTrigger>
                    <TooltipContent>一键互换宽与高（横竖屏翻转）</TooltipContent>
                  </Tooltip>
                  <div className="flex-1 space-y-1">
                    <span className="text-[10px] text-muted-foreground">
                      高 (16~3840)
                    </span>
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
                    variant="secondary"
                    size="sm"
                    className="h-8 px-2.5 text-xs"
                    onClick={() => onApplyCustomSize()}
                  >
                    对齐并应用
                  </Button>
                </div>
                <div className="flex items-center justify-between text-[10px] tabular-nums">
                  <span className="text-muted-foreground">
                    当前总像素:{" "}
                    <strong
                      className={cn(
                        "font-mono",
                        customPixelsValid
                          ? "text-emerald-600 dark:text-emerald-400"
                          : "text-destructive"
                      )}
                    >
                      {(customPixels / 10000).toFixed(1)} 万
                    </strong>
                  </span>
                  <span className="text-muted-foreground font-mono">
                    API 要求: 65.5万 ~ 829.4万
                  </span>
                </div>
              </div>
            )}
          </div>
        </section>

        {/* 5. Quality, Background & Channel Controls */}
        <section className="space-y-2.5">
          <div className="grid grid-cols-2 gap-2.5">
            <div className="space-y-1">
              <Label className="text-[11px] text-muted-foreground">
                思考深度 (Quality)
              </Label>
              <Select value={quality} onValueChange={onChangeQuality}>
                <SelectTrigger id="select-quality" className="h-8 text-xs">
                  <SelectValue placeholder="选择思考深度" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="default">默认 (模型自动)</SelectItem>
                  <SelectItem value="low">low (极速响应)</SelectItem>
                  <SelectItem value="medium">medium (标准均衡)</SelectItem>
                  <SelectItem value="high">high (深度空间推理)</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1">
              <Label className="text-[11px] text-muted-foreground">
                背景模式 (Background)
              </Label>
              <Select value={background} onValueChange={onChangeBackground}>
                <SelectTrigger id="select-background" className="h-8 text-xs">
                  <SelectValue placeholder="选择背景模式" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="auto">auto (自动默认)</SelectItem>
                  <SelectItem value="opaque">opaque (不透明背景)</SelectItem>
                  <SelectItem value="transparent">
                    transparent (透明 PNG)
                  </SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-2">
            <div className="flex h-8 items-center justify-between rounded-lg border border-border bg-background/50 px-2.5">
              <Label
                htmlFor="chk-oversea"
                className="text-[11px] cursor-pointer select-none"
              >
                海外节点 (Oversea)
              </Label>
              <Switch
                id="chk-oversea"
                checked={oversea}
                onCheckedChange={onChangeOversea}
              />
            </div>

            <Tooltip>
              <TooltipTrigger asChild>
                <div className="flex h-8 items-center justify-between rounded-lg border border-border bg-background/50 px-2.5">
                  <Label
                    htmlFor="chk-compat-fallback"
                    className="text-[11px] cursor-pointer select-none truncate"
                  >
                    报错自动兼容重试
                  </Label>
                  <Switch
                    id="chk-compat-fallback"
                    checked={autoCompatFallback}
                    onCheckedChange={onChangeAutoCompatFallback}
                  />
                </div>
              </TooltipTrigger>
              <TooltipContent className="max-w-xs">
                开启后，若上游渠道对特定 4K 宽高返回 fail_to_submit_task，将自动回退为同比例枚举值重试并在卡片上标注提醒；关闭则严格原样提交不降级。
              </TooltipContent>
            </Tooltip>
          </div>
        </section>
      </div>

      {/* Sticky Bottom Action Bar: Batch Stepper + Request Preview + Submit CTA */}
      <div className="border-t border-border bg-card/95 backdrop-blur-md p-3.5 space-y-2.5 shrink-0">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-1.5">
            <span className="text-xs text-muted-foreground font-medium">
              并发张数:
            </span>
            <div className="inline-flex items-center rounded-lg border border-border bg-background p-0.5">
              {[1, 2, 4, 6].map((num) => (
                <button
                  key={num}
                  type="button"
                  onClick={() => onChangeBatchCount(num)}
                  className={cn(
                    "rounded-md px-2 py-0.5 text-xs font-mono transition-colors cursor-pointer tabular-nums",
                    batchCount === num
                      ? "bg-amber-500 text-zinc-950 font-semibold"
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
              className="h-7 w-13 px-1.5 text-center font-mono text-xs tabular-nums"
              title="自定义并发生成张数 (1~10)"
            />
          </div>

          <div className="flex items-center gap-1.5">
            <span className="font-mono text-[11px] text-muted-foreground tabular-nums">
              约 ¥{(0.06 * batchCount).toFixed(2)}
            </span>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  id="btn-open-dev-preview"
                  type="button"
                  variant="outline"
                  size="icon"
                  className="h-7 w-7"
                  onClick={onOpenDevPreview}
                  aria-label="查看等效 API 请求 JSON 与 CLI 命令"
                >
                  <Code2 className="h-3.5 w-3.5" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>
                查看当前参数对应的精确 API JSON 请求体 / cURL / CLI 命令
              </TooltipContent>
            </Tooltip>
          </div>
        </div>

        <Button
          id="btn-submit-generate"
          type="button"
          variant="brand"
          size="lg"
          disabled={isSubmitting || anyUploadingRef}
          onClick={onSubmitGenerate}
          className="w-full h-10 shadow-sm"
        >
          {anyUploadingRef ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin" />
              正在处理参考图...
            </>
          ) : isSubmitting ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin" />
              {batchCount > 1
                ? `正在并发提交 ${batchCount} 个任务...`
                : "正在提交生图任务..."}
            </>
          ) : (
            <>
              <Sparkles className="h-4 w-4" />
              {batchCount > 1
                ? `立即并发生成 ${batchCount} 张图像`
                : "立即提交异步生图任务"}
            </>
          )}
        </Button>
      </div>
    </aside>
  )
}
