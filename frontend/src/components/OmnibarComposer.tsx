import React, { useEffect, useMemo, useRef, useState } from "react"
import {
  AlertTriangle,
  BookMarked,
  BookmarkPlus,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ClipboardPaste,
  CloudUpload,
  Code2,
  FolderKanban,
  History,
  ImagePlus,
  Layers,
  Link2,
  Loader2,
  Maximize2,
  Minus,
  PencilRuler,
  Plus,
  RefreshCw,
  SlidersHorizontal,
  Sparkles,
  Wand2,
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
import { Switch } from "@/components/ui/switch"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import { parsePixelDimensions, PROJECT_COLOR_MAP } from "@/lib/studio-utils"
import { cn } from "@/lib/utils"
import type {
  ImageHostInfo,
  ImageHostProvider,
  ModelInfo,
  ProjectFolder,
  PromptHistoryItem,
  RatioPresetGroup,
  ReferenceImageEntry,
  RefImageMode,
} from "@/types"

function MiniRatioBox({ w, h }: { w: number; h: number }) {
  if (!w || !h) {
    return (
      <span className="inline-flex h-3.5 w-3.5 items-center justify-center rounded-[3px] border border-dashed border-current text-[8px] font-mono opacity-75">
        A
      </span>
    )
  }
  const max = 13
  const bw = w >= h ? max : Math.max(6, Math.round((max * w) / h))
  const bh = h > w ? max : Math.max(6, Math.round((max * h) / w))
  return (
    <span
      className="inline-block rounded-[2.5px] border border-current opacity-85 shrink-0"
      style={{ width: `${bw}px`, height: `${bh}px` }}
    />
  )
}

interface OmnibarComposerProps {
  models: ModelInfo[]
  selectedModel: string
  onSelectModel: (id: string) => void
  customModel: string
  onChangeCustomModel: (v: string) => void

  prompt: string
  onChangePrompt: (v: string) => void
  promptHistory: PromptHistoryItem[]
  onOpenZenWorkbench: () => void
  onOpenRecipes: () => void
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
  onAnnotateRef: (entry: ReferenceImageEntry) => void
  onPasteFromClipboardButton: () => void
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

  projects: ProjectFolder[]
  activeProjectId: string
  onChangeActiveProjectId: (id: string) => void

  batchCount: number
  onChangeBatchCount: (n: number) => void
  isSubmitting: boolean
  onSubmitGenerate: () => void
  onOpenDevPreview: () => void
  onCollapseOverlay?: () => void
}

export const OmnibarComposer: React.FC<OmnibarComposerProps> = ({
  models,
  selectedModel,
  onSelectModel,
  customModel,
  onChangeCustomModel,
  prompt,
  onChangePrompt,
  promptHistory,
  onOpenZenWorkbench,
  onOpenRecipes,
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
  projects,
  activeProjectId,
  onChangeActiveProjectId,
  batchCount,
  onChangeBatchCount,
  isSubmitting,
  onSubmitGenerate,
  onOpenDevPreview,
  onCollapseOverlay,
}) => {
  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const textareaRef = useRef<HTMLTextAreaElement | null>(null)
  const [isDragging, setIsDragging] = useState(false)
  const [urlPopoverOpen, setUrlPopoverOpen] = useState(false)
  const [urlInput, setUrlInput] = useState("")
  const [modelPopoverOpen, setModelPopoverOpen] = useState(false)
  const [ratioPopoverOpen, setRatioPopoverOpen] = useState(false)
  const [historyPopoverOpen, setHistoryPopoverOpen] = useState(false)

  useEffect(() => {
    const el = textareaRef.current
    if (!el) return
    el.style.height = "auto"
    const nextH = Math.min(200, Math.max(54, el.scrollHeight))
    el.style.height = `${nextH}px`
  }, [prompt])

  const activeModelObj = useMemo(
    () => models.find((m) => m.id === selectedModel),
    [models, selectedModel]
  )
  const displayModelLabel = customModel.trim()
    ? customModel.trim()
    : activeModelObj?.name.replace("GPT-Image ", "Image ") || selectedModel

  const activeRatioGroup = useMemo(
    () =>
      ratioPresets.find((g) => g.ratio === selectedRatio) ||
      ratioPresets[0] ||
      null,
    [ratioPresets, selectedRatio]
  )

  const pixelInfo = useMemo(
    () => parsePixelDimensions(selectedSize),
    [selectedSize]
  )

  const promptMetrics = useMemo(() => {
    const chars = Array.from(prompt).length
    const utf8Bytes = new TextEncoder().encode(prompt).length
    const multiHint =
      batchCount === 1 &&
      /(生成[二三四五六七八九十2-9]张|[2-9]张独立|六宫格|四宫格)/.test(prompt)
    return { chars, utf8Bytes, multiHint }
  }, [prompt, batchCount])

  const activeProject = useMemo(
    () => projects.find((p) => p.id === activeProjectId),
    [projects, activeProjectId]
  )

  const anyUploadingRef = referenceImages.some((r) => r.uploading)

  // Insert "@图1" or text right at cursor position
  const insertAtCursor = (token: string) => {
    const el = textareaRef.current
    if (!el) {
      onChangePrompt(prompt ? `${prompt} ${token}` : token)
      return
    }
    const start = el.selectionStart ?? prompt.length
    const end = el.selectionEnd ?? prompt.length
    const next = prompt.slice(0, start) + token + prompt.slice(end)
    onChangePrompt(next)
    requestAnimationFrame(() => {
      el.focus()
      const cursor = start + token.length
      el.setSelectionRange(cursor, cursor)
    })
  }

  const tierShortLabel = useMemo(() => {
    if (selectedRatio === "auto") return "Auto"
    if (selectedRatio === "custom") return selectedSize
    const found = activeRatioGroup?.sizes.find((s) => s.value === selectedSize)
    if (found?.tier === "ratio") return `${selectedRatio} · 比例`
    if (found?.tier) return `${selectedRatio} · ${found.tier.toUpperCase()}`
    return `${selectedRatio} · ${selectedSize}`
  }, [selectedRatio, selectedSize, activeRatioGroup])

  const refModeShortLabel =
    refMode === "upload"
      ? "无损图床"
      : refMode === "compress_base64"
      ? "压缩Base64"
      : "原图Base64"

  // Live preview rectangle dimensions inside Aspect Ratio Popover
  const previewRectStyle = useMemo(() => {
    let w = activeRatioGroup?.aspect_w || 1
    let h = activeRatioGroup?.aspect_h || 1
    if (selectedRatio === "custom") {
      w = customW || 1024
      h = customH || 1024
    } else if (selectedRatio === "auto") {
      w = 1
      h = 1
    }
    const maxBox = 68
    const rw = w >= h ? maxBox : Math.max(22, Math.round((maxBox * w) / h))
    const rh = h > w ? maxBox : Math.max(22, Math.round((maxBox * h) / w))
    return { width: `${rw}px`, height: `${rh}px` }
  }, [activeRatioGroup, selectedRatio, customW, customH])

  return (
    <div
      onDragOver={(e) => {
        e.preventDefault()
        setIsDragging(true)
      }}
      onDragLeave={() => setIsDragging(false)}
      onDrop={(e) => {
        e.preventDefault()
        setIsDragging(false)
        if (e.dataTransfer.files?.length) {
          onFilesSelected(e.dataTransfer.files)
        }
      }}
      className={cn(
        "studio-omnibar relative mx-auto w-full max-w-4xl rounded-[22px] p-3 transition-all duration-200",
        isDragging && "ring-2 ring-amber-500 scale-[1.005]"
      )}
    >
      {/* Drag & Drop Glass Overlay */}
      {isDragging && (
        <div className="pointer-events-none absolute inset-1.5 z-30 flex items-center justify-center rounded-2xl bg-amber-500/15 backdrop-blur-xs border-2 border-dashed border-amber-500">
          <div className="flex items-center gap-2 rounded-full bg-card px-4 py-2 text-xs font-semibold text-amber-500 shadow-lg">
            <CloudUpload className="h-4 w-4" />
            松开鼠标即可添加参考图（当前策略：{refModeShortLabel}）
          </div>
        </div>
      )}

      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        multiple
        className="hidden"
        onChange={(e) => {
          if (e.target.files?.length) {
            onFilesSelected(e.target.files)
            e.target.value = ""
          }
        }}
      />

      {/* Top Strip: Reference Images + Quick Studio Utilities */}
      <div className="flex flex-wrap items-center justify-between gap-2 pb-2">
        <div className="flex flex-wrap items-center gap-1.5">
          {/* Existing Reference Image Chips */}
          {referenceImages.map((item, idx) => (
            <div
              key={item.id}
              className={cn(
                "group relative flex items-center gap-2 rounded-xl border p-1 pr-2 transition-all",
                item.error
                  ? "border-destructive/60 bg-destructive/10"
                  : "border-border/80 bg-card/85 hover:border-amber-500/60"
              )}
            >
              <div className="relative h-10 w-10 shrink-0 overflow-hidden rounded-lg bg-secondary">
                <img
                  src={item.preview}
                  alt={`参考图${idx + 1}`}
                  className="h-full w-full object-cover"
                />
                {item.uploading && (
                  <div className="absolute inset-0 flex items-center justify-center bg-black/65">
                    <Loader2 className="h-3.5 w-3.5 animate-spin text-amber-400" />
                  </div>
                )}
                {item.annotated && (
                  <span className="absolute bottom-0 inset-x-0 bg-amber-500 text-[8px] font-bold text-center text-zinc-950 leading-tight">
                    已标注
                  </span>
                )}
              </div>

              <div className="flex flex-col min-w-0">
                <div className="flex items-center gap-1">
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <button
                        type="button"
                        onClick={() => insertAtCursor(`图${idx + 1}`)}
                        className="rounded bg-amber-500/15 px-1.5 py-0.5 font-mono text-[10px] font-bold text-amber-600 dark:text-amber-400 hover:bg-amber-500 hover:text-zinc-950 transition-colors cursor-pointer"
                      >
                        @图{idx + 1}
                      </button>
                    </TooltipTrigger>
                    <TooltipContent>
                      点击将「图{idx + 1}」插入提示词光标处，精准指代该参考图
                    </TooltipContent>
                  </Tooltip>

                  {!item.uploading && !item.error && (
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <button
                          type="button"
                          onClick={() => onAnnotateRef(item)}
                          className="rounded p-0.5 text-muted-foreground hover:bg-accent hover:text-foreground transition-colors cursor-pointer"
                          aria-label="涂鸦标注或裁剪参考图"
                        >
                          <PencilRuler className="h-3 w-3" />
                        </button>
                      </TooltipTrigger>
                      <TooltipContent>
                        打开参考图画板：裁剪构图 / 红框圈选 / 打叉排除无关人物
                      </TooltipContent>
                    </Tooltip>
                  )}

                  {item.error && (
                    <button
                      type="button"
                      onClick={() => onRetryRef(item)}
                      className="rounded p-0.5 text-amber-500 hover:bg-amber-500/15 cursor-pointer"
                      title="重试上传"
                    >
                      <RefreshCw className="h-3 w-3" />
                    </button>
                  )}
                </div>

                <span
                  className={cn(
                    "text-[9px] truncate max-w-[96px] mt-0.5",
                    item.error ? "text-destructive" : "text-muted-foreground"
                  )}
                  title={item.error || item.label}
                >
                  {item.error ? "上传失败" : item.label}
                </span>
              </div>

              {/* Reorder & Remove */}
              <div className="flex items-center gap-0.5 ml-0.5">
                {referenceImages.length > 1 && idx > 0 && (
                  <button
                    type="button"
                    onClick={() => onMoveRef(idx, -1)}
                    className="rounded p-0.5 text-muted-foreground hover:text-foreground cursor-pointer"
                    title="前移顺序"
                  >
                    <ChevronLeft className="h-3 w-3" />
                  </button>
                )}
                {referenceImages.length > 1 &&
                  idx < referenceImages.length - 1 && (
                    <button
                      type="button"
                      onClick={() => onMoveRef(idx, 1)}
                      className="rounded p-0.5 text-muted-foreground hover:text-foreground cursor-pointer"
                      title="后移顺序"
                    >
                      <ChevronRight className="h-3 w-3" />
                    </button>
                  )}
                <button
                  type="button"
                  onClick={() => onRemoveRef(item.id)}
                  className="rounded-full p-0.5 text-muted-foreground hover:bg-destructive/15 hover:text-destructive transition-colors cursor-pointer"
                  title="移除此参考图"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>
            </div>
          ))}

          {/* Add Reference Triggers */}
          <button
            id="btn-omnibar-upload-ref"
            type="button"
            onClick={() => fileInputRef.current?.click()}
            className="inline-flex h-8 items-center gap-1.5 rounded-xl border border-dashed border-border bg-background/50 px-2.5 text-xs font-medium text-muted-foreground hover:border-amber-500/60 hover:text-foreground transition-colors cursor-pointer"
          >
            <ImagePlus className="h-3.5 w-3.5 text-amber-500" />
            <span>{referenceImages.length > 0 ? "继续加图" : "参考图"}</span>
          </button>

          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                onClick={onPasteFromClipboardButton}
                className="inline-flex h-8 items-center gap-1 rounded-xl border border-border/70 bg-background/40 px-2 text-[11px] text-muted-foreground hover:text-foreground hover:bg-accent/50 transition-colors cursor-pointer"
              >
                <ClipboardPaste className="h-3 w-3" />
                <span className="hidden sm:inline">粘贴</span>
              </button>
            </TooltipTrigger>
            <TooltipContent>读取剪贴板图片作为参考图 (全局支持 Ctrl+V)</TooltipContent>
          </Tooltip>

          <Popover open={urlPopoverOpen} onOpenChange={setUrlPopoverOpen}>
            <PopoverTrigger asChild>
              <button
                type="button"
                className="inline-flex h-8 items-center gap-1 rounded-xl border border-border/70 bg-background/40 px-2 text-[11px] text-muted-foreground hover:text-foreground hover:bg-accent/50 transition-colors cursor-pointer"
              >
                <Link2 className="h-3 w-3" />
                <span className="hidden sm:inline">URL</span>
              </button>
            </PopoverTrigger>
            <PopoverContent className="w-80 space-y-2">
              <p className="text-xs font-semibold">添加远程参考图直链</p>
              <div className="flex gap-1.5">
                <Input
                  value={urlInput}
                  onChange={(e) => setUrlInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && urlInput.trim()) {
                      onAddRefUrl(urlInput)
                      setUrlInput("")
                      setUrlPopoverOpen(false)
                    }
                  }}
                  placeholder="https://example.com/photo.png"
                  className="h-8 text-xs font-mono"
                />
                <Button
                  type="button"
                  size="sm"
                  className="h-8 px-3"
                  onClick={() => {
                    if (urlInput.trim()) {
                      onAddRefUrl(urlInput)
                      setUrlInput("")
                      setUrlPopoverOpen(false)
                    }
                  }}
                >
                  添加
                </Button>
              </div>
            </PopoverContent>
          </Popover>
        </div>

        {/* Right Prompt Studio Actions: Zen Workbench, Recipes, History, Save */}
        <div className="flex items-center gap-1">
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                id="btn-open-zen-workbench"
                type="button"
                onClick={onOpenZenWorkbench}
                className="inline-flex h-7 items-center gap-1 rounded-lg bg-amber-500/12 border border-amber-500/30 px-2.5 text-[11px] font-medium text-amber-600 dark:text-amber-400 hover:bg-amber-500/20 transition-colors cursor-pointer"
              >
                <Wand2 className="h-3 w-3" />
                <span>结构化长文台</span>
              </button>
            </TooltipTrigger>
            <TooltipContent>
              展开大屏沉浸提示词工作台：内置镜头/光影/一致性护栏积木与长文排版
            </TooltipContent>
          </Tooltip>

          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                onClick={onOpenRecipes}
                className="inline-flex h-7 items-center gap-1 rounded-lg border border-border/70 bg-background/50 px-2 text-[11px] text-muted-foreground hover:text-foreground transition-colors cursor-pointer"
              >
                <BookMarked className="h-3 w-3" />
                <span className="hidden sm:inline">配方库</span>
              </button>
            </TooltipTrigger>
            <TooltipContent>浏览内置与自定义高质量提示词配方</TooltipContent>
          </Tooltip>

          {promptHistory.length > 0 && (
            <Popover
              open={historyPopoverOpen}
              onOpenChange={setHistoryPopoverOpen}
            >
              <PopoverTrigger asChild>
                <button
                  type="button"
                  className="inline-flex h-7 items-center gap-1 rounded-lg border border-border/70 bg-background/50 px-2 text-[11px] text-muted-foreground hover:text-foreground transition-colors cursor-pointer"
                  title="最近提交的提示词历史"
                >
                  <History className="h-3 w-3" />
                </button>
              </PopoverTrigger>
              <PopoverContent align="end" className="w-96 max-h-80 overflow-y-auto space-y-1.5">
                <div className="flex items-center justify-between pb-1 border-b border-border/60">
                  <span className="text-xs font-semibold">最近创作提示词历史</span>
                  <span className="font-mono text-[10px] text-muted-foreground">
                    最近 {promptHistory.length} 条
                  </span>
                </div>
                {promptHistory.map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => {
                      onChangePrompt(item.prompt)
                      setHistoryPopoverOpen(false)
                    }}
                    className="w-full rounded-xl border border-transparent hover:border-border hover:bg-accent/60 p-2 text-left transition-colors cursor-pointer"
                  >
                    <p className="text-xs text-foreground line-clamp-2 leading-relaxed">
                      {item.prompt}
                    </p>
                    <div className="mt-1 flex items-center gap-2 font-mono text-[10px] text-muted-foreground">
                      <span>{item.model}</span>
                      <span>·</span>
                      <span>{item.size}</span>
                    </div>
                  </button>
                ))}
              </PopoverContent>
            </Popover>
          )}

          {prompt.trim().length > 0 && (
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  onClick={onSaveAsTemplate}
                  className="inline-flex h-7 items-center gap-1 rounded-lg border border-border/70 bg-background/50 px-2 text-[11px] text-muted-foreground hover:text-foreground transition-colors cursor-pointer"
                >
                  <BookmarkPlus className="h-3 w-3" />
                </button>
              </TooltipTrigger>
              <TooltipContent>将当前提示词保存为自定义配方模板</TooltipContent>
            </Tooltip>
          )}

          {onCollapseOverlay && (
            <button
              type="button"
              onClick={onCollapseOverlay}
              className="inline-flex h-7 items-center gap-1 rounded-lg border border-border bg-secondary/70 px-2 text-[11px] font-medium text-muted-foreground hover:text-foreground transition-colors cursor-pointer"
              title="收起悬浮创作舱 (快捷键 Esc)"
            >
              <X className="h-3 w-3" />
              <span>收起</span>
            </button>
          )}
        </div>
      </div>

      {/* Main Smart Prompt Textarea */}
      <div className="relative">
        <textarea
          id={onCollapseOverlay ? "omnibar-overlay-prompt-input" : "omnibar-prompt-input"}
          ref={textareaRef}
          autoFocus={Boolean(onCollapseOverlay)}
          value={prompt}
          onChange={(e) => onChangePrompt(e.target.value)}
          onKeyDown={(e) => {
            if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
              e.preventDefault()
              if (!isSubmitting && !anyUploadingRef) {
                onSubmitGenerate()
              }
            } else if (e.key === "Escape" && onCollapseOverlay) {
              e.preventDefault()
              onCollapseOverlay()
            }
          }}
          rows={2}
          maxLength={5000}
          placeholder={
            referenceImages.length > 0
              ? "描述画面内容，可点击上方 @图1 直接指代参考人物/主体（例如：保持图1左一与左二人物五官服装不变，生成自然抓拍...）"
              : "你想创作什么画面？输入主体、构图、光影与质感描述（支持直接拖拽或 Ctrl+V 粘贴参考图，Ctrl+Enter 立即生成）"
          }
          className="w-full resize-none bg-transparent px-1 py-1.5 text-sm leading-relaxed text-foreground placeholder:text-muted-foreground/70 focus:outline-none min-h-[54px] max-h-[200px] overflow-y-auto studio-scroll"
        />

        {/* Inline Multi-Photo Hint Banner */}
        {promptMetrics.multiHint && (
          <div className="mb-2 flex items-center justify-between gap-2 rounded-xl border border-amber-500/35 bg-amber-500/10 px-3 py-1.5 text-[11px]">
            <span className="text-amber-700 dark:text-amber-300">
              检测到提示词包含多图词句：若需生成多张独立照片而非单张拼图，请调高右侧并发张数
            </span>
            <button
              type="button"
              onClick={() => onChangeBatchCount(4)}
              className="shrink-0 rounded-md bg-amber-500 px-2 py-0.5 text-[10px] font-bold text-zinc-950 cursor-pointer"
            >
              设为 ×4 张
            </button>
          </div>
        )}
      </div>

      {/* Bottom Precision Parameter Pill Bar + Submit Action */}
      <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border/60 pt-2.5">
        <div className="flex flex-wrap items-center gap-1.5">
          {/* 1. Model Selector Pill */}
          <Popover open={modelPopoverOpen} onOpenChange={setModelPopoverOpen}>
            <PopoverTrigger asChild>
              <button
                id="pill-model-selector"
                type="button"
                className="inline-flex h-8 items-center gap-1.5 rounded-xl border border-border/80 bg-card/90 px-2.5 text-xs font-medium text-foreground hover:border-amber-500/50 transition-colors cursor-pointer"
              >
                <Sparkles className="h-3.5 w-3.5 text-amber-500" />
                <span className="max-w-[140px] truncate">{displayModelLabel}</span>
                <ChevronDown className="h-3 w-3 text-muted-foreground" />
              </button>
            </PopoverTrigger>
            <PopoverContent className="w-88 space-y-2.5">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold">选择多米生图引擎</span>
                <span className="font-mono text-[10px] text-muted-foreground">
                  官方直连 · 异步高并发
                </span>
              </div>
              <div className="space-y-1">
                {models.map((m) => {
                  const selected = !customModel.trim() && selectedModel === m.id
                  return (
                    <button
                      key={m.id}
                      type="button"
                      onClick={() => {
                        onSelectModel(m.id)
                        onChangeCustomModel("")
                        setModelPopoverOpen(false)
                      }}
                      className={cn(
                        "w-full rounded-xl border p-2.5 text-left transition-all cursor-pointer",
                        selected
                          ? "border-amber-500/70 bg-amber-500/10"
                          : "border-transparent hover:border-border hover:bg-accent/55"
                      )}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <div className="flex items-center gap-1.5">
                          <span className="text-xs font-semibold text-foreground">
                            {m.name}
                          </span>
                          <Badge
                            variant={selected ? "amber" : "secondary"}
                            className="text-[10px] px-1.5 py-0"
                          >
                            {m.badge}
                          </Badge>
                        </div>
                        <span className="font-mono text-[10px] text-muted-foreground">
                          {m.price}
                        </span>
                      </div>
                      <p className="mt-1 text-[11px] text-muted-foreground leading-snug">
                        {m.description}
                      </p>
                    </button>
                  )
                })}
              </div>
              <div className="border-t border-border/60 pt-2 space-y-1">
                <span className="text-[10px] font-medium text-muted-foreground">
                  或输入任意自定义模型 ID
                </span>
                <Input
                  value={customModel}
                  onChange={(e) => onChangeCustomModel(e.target.value)}
                  placeholder="例如 gpt-image-2.6-sunburst"
                  className="h-7 text-xs font-mono"
                />
              </div>
            </PopoverContent>
          </Popover>

          {/* 2. Aspect Ratio & Resolution Visualizer Pill */}
          <Popover open={ratioPopoverOpen} onOpenChange={setRatioPopoverOpen}>
            <PopoverTrigger asChild>
              <button
                id="pill-ratio-selector"
                type="button"
                className="inline-flex h-8 items-center gap-1.5 rounded-xl border border-border/80 bg-card/90 px-2.5 text-xs font-medium text-foreground hover:border-amber-500/50 transition-colors cursor-pointer"
              >
                <MiniRatioBox
                  w={
                    selectedRatio === "custom"
                      ? customW
                      : activeRatioGroup?.aspect_w || 0
                  }
                  h={
                    selectedRatio === "custom"
                      ? customH
                      : activeRatioGroup?.aspect_h || 0
                  }
                />
                <span className="font-mono text-[11px]">{tierShortLabel}</span>
                <ChevronDown className="h-3 w-3 text-muted-foreground" />
              </button>
            </PopoverTrigger>
            <PopoverContent className="w-[360px] sm:w-[430px] space-y-3">
              {/* Top Visual Aspect Frame Preview */}
              <div className="flex items-center gap-3.5 rounded-xl border border-border/70 bg-background/60 p-3">
                <div className="flex h-[76px] w-[76px] shrink-0 items-center justify-center rounded-lg bg-secondary/70">
                  <div
                    style={previewRectStyle}
                    className="rounded-sm border-2 border-amber-500 bg-amber-500/15 transition-all duration-200 flex items-center justify-center"
                  >
                    <span className="font-mono text-[9px] font-bold text-amber-600 dark:text-amber-400">
                      {selectedRatio === "custom" ? "W×H" : selectedRatio}
                    </span>
                  </div>
                </div>
                <div className="space-y-1 min-w-0">
                  <div className="flex items-center gap-1.5">
                    <span className="text-xs font-semibold text-foreground">
                      {selectedRatio === "custom"
                        ? "自定义像素宽高"
                        : `${activeRatioGroup?.ratio || "1:1"} · ${
                            activeRatioGroup?.name || ""
                          }`}
                    </span>
                    {pixelInfo && (
                      <Badge variant="amber" className="font-mono text-[10px] px-1.5 py-0">
                        {pixelInfo.mp} MP
                      </Badge>
                    )}
                  </div>
                  <p className="font-mono text-xs text-muted-foreground">
                    请求参数: <strong className="text-foreground">{selectedSize}</strong>
                  </p>
                  <p className="text-[10px] text-muted-foreground">
                    严格遵循多米 16px 倍数对齐与总像素预算规范
                  </p>
                </div>
              </div>

              {/* Step 1: 12 Aspect Ratios + Custom */}
              <div className="space-y-1.5">
                <span className="text-[11px] font-semibold text-muted-foreground">
                  1. 选择画幅比例
                </span>
                <div className="grid grid-cols-4 sm:grid-cols-5 gap-1.5">
                  {ratioPresets.map((grp) => {
                    const active = selectedRatio === grp.ratio
                    return (
                      <button
                        key={grp.ratio}
                        type="button"
                        onClick={() => onSelectRatio(grp)}
                        className={cn(
                          "flex flex-col items-center justify-center gap-1 rounded-xl border py-1.5 px-1 text-center transition-all cursor-pointer",
                          active
                            ? "border-amber-500 bg-amber-500/15 text-amber-600 dark:text-amber-400 font-semibold"
                            : "border-border/70 bg-card/60 text-muted-foreground hover:text-foreground hover:bg-accent/50"
                        )}
                      >
                        <MiniRatioBox w={grp.aspect_w} h={grp.aspect_h} />
                        <span className="font-mono text-[10px] leading-none">
                          {grp.ratio}
                        </span>
                      </button>
                    )
                  })}
                  <button
                    type="button"
                    onClick={onSelectCustomRatioMode}
                    className={cn(
                      "flex flex-col items-center justify-center gap-1 rounded-xl border py-1.5 px-1 text-center transition-all cursor-pointer",
                      selectedRatio === "custom"
                        ? "border-amber-500 bg-amber-500/15 text-amber-600 dark:text-amber-400 font-semibold"
                        : "border-border/70 bg-card/60 text-muted-foreground hover:text-foreground hover:bg-accent/50"
                    )}
                  >
                    <SlidersHorizontal className="h-3.5 w-3.5" />
                    <span className="text-[10px] leading-none">自定义</span>
                  </button>
                </div>
              </div>

              {/* Step 2: Corresponding Resolution Tiers */}
              {selectedRatio === "custom" ? (
                <div className="space-y-2 border-t border-border/60 pt-2.5">
                  <div className="flex items-center justify-between text-[11px]">
                    <span className="font-semibold text-muted-foreground">
                      2. 输入自定义宽高 (自动对齐 16 倍数)
                    </span>
                  </div>
                  <div className="grid grid-cols-[1fr_auto_1fr_auto] items-center gap-1.5">
                    <Input
                      type="number"
                      min={256}
                      max={3840}
                      step={16}
                      value={customW}
                      onChange={(e) => {
                        const w = Number(e.target.value)
                        onChangeCustomW(w)
                        onApplyCustomSize(w, customH)
                      }}
                      className="h-8 font-mono text-xs text-center"
                    />
                    <span className="font-mono text-xs text-muted-foreground">×</span>
                    <Input
                      type="number"
                      min={256}
                      max={3840}
                      step={16}
                      value={customH}
                      onChange={(e) => {
                        const h = Number(e.target.value)
                        onChangeCustomH(h)
                        onApplyCustomSize(customW, h)
                      }}
                      className="h-8 font-mono text-xs text-center"
                    />
                    <Button
                      type="button"
                      variant="secondary"
                      size="xs"
                      className="h-8"
                      onClick={() => {
                        const aw = Math.min(
                          3840,
                          Math.max(512, Math.round(customW / 16) * 16)
                        )
                        const ah = Math.min(
                          3840,
                          Math.max(512, Math.round(customH / 16) * 16)
                        )
                        onChangeCustomW(aw)
                        onChangeCustomH(ah)
                        onApplyCustomSize(aw, ah)
                      }}
                    >
                      对齐16
                    </Button>
                  </div>
                </div>
              ) : (
                activeRatioGroup &&
                activeRatioGroup.sizes.length > 0 && (
                  <div className="space-y-1.5 border-t border-border/60 pt-2.5">
                    <span className="text-[11px] font-semibold text-muted-foreground">
                      2. 选择对应清晰度尺寸档位
                    </span>
                    <div className="grid grid-cols-2 gap-1.5">
                      {activeRatioGroup.sizes.map((sz) => {
                        const active = selectedSize === sz.value
                        return (
                          <button
                            key={sz.value}
                            type="button"
                            onClick={() => {
                              onSelectPresetSize(sz.value, sz.tier)
                            }}
                            className={cn(
                              "flex items-center justify-between rounded-xl border px-2.5 py-2 text-left transition-all cursor-pointer",
                              active
                                ? "border-amber-500 bg-amber-500/12"
                                : "border-border/70 bg-card/50 hover:bg-accent/50"
                            )}
                          >
                            <div>
                              <p className="text-xs font-semibold text-foreground">
                                {sz.label}
                              </p>
                              <p className="font-mono text-[10px] text-muted-foreground">
                                {sz.detail}
                              </p>
                            </div>
                            {active && (
                              <Check className="h-3.5 w-3.5 text-amber-500 shrink-0" />
                            )}
                          </button>
                        )
                      })}
                    </div>
                  </div>
                )
              )}
            </PopoverContent>
          </Popover>

          {/* 3. Quality & Transparent PNG Pill */}
          <Popover>
            <PopoverTrigger asChild>
              <button
                type="button"
                className="inline-flex h-8 items-center gap-1.5 rounded-xl border border-border/80 bg-card/90 px-2.5 text-xs font-medium text-foreground hover:border-amber-500/50 transition-colors cursor-pointer"
              >
                <Layers className="h-3.5 w-3.5 text-muted-foreground" />
                <span>
                  {quality === "default" ? "标准精细" : quality.toUpperCase()}
                  {background === "transparent" ? " · 透明底" : ""}
                </span>
                <ChevronDown className="h-3 w-3 text-muted-foreground" />
              </button>
            </PopoverTrigger>
            <PopoverContent className="w-72 space-y-3">
              <div className="space-y-1.5">
                <span className="text-xs font-semibold">思考与刻画深度 (Quality)</span>
                <div className="grid grid-cols-4 gap-1 rounded-xl border border-border bg-background/60 p-1">
                  {[
                    { v: "default", l: "默认" },
                    { v: "low", l: "极速" },
                    { v: "medium", l: "均衡" },
                    { v: "high", l: "精绘" },
                  ].map((q) => (
                    <button
                      key={q.v}
                      type="button"
                      onClick={() => onChangeQuality(q.v)}
                      className={cn(
                        "rounded-lg py-1 text-[11px] font-medium transition-colors cursor-pointer",
                        quality === q.v
                          ? "bg-amber-500 text-zinc-950 font-semibold"
                          : "text-muted-foreground hover:text-foreground"
                      )}
                    >
                      {q.l}
                    </button>
                  ))}
                </div>
              </div>

              <div className="space-y-1.5">
                <span className="text-xs font-semibold">背景通道 (Background)</span>
                <div className="grid grid-cols-3 gap-1 rounded-xl border border-border bg-background/60 p-1">
                  {[
                    { v: "auto", l: "智能默认" },
                    { v: "opaque", l: "纯实色底" },
                    { v: "transparent", l: "透明 PNG" },
                  ].map((b) => (
                    <button
                      key={b.v}
                      type="button"
                      onClick={() => onChangeBackground(b.v)}
                      className={cn(
                        "rounded-lg py-1 text-[11px] font-medium transition-colors cursor-pointer",
                        background === b.v
                          ? "bg-amber-500 text-zinc-950 font-semibold"
                          : "text-muted-foreground hover:text-foreground"
                      )}
                    >
                      {b.l}
                    </button>
                  ))}
                </div>
              </div>

              <div className="space-y-2 border-t border-border/60 pt-2.5 text-xs">
                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground">智能兼容降级重试</span>
                  <Switch
                    checked={autoCompatFallback}
                    onCheckedChange={onChangeAutoCompatFallback}
                  />
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground">海外加速线路 (Oversea)</span>
                  <Switch checked={oversea} onCheckedChange={onChangeOversea} />
                </div>
              </div>
            </PopoverContent>
          </Popover>

          {/* 4. Reference Strategy Pill (Lossless Upload Default vs Optional Base64) */}
          <Popover>
            <PopoverTrigger asChild>
              <button
                id="pill-ref-strategy"
                type="button"
                className={cn(
                  "inline-flex h-8 items-center gap-1.5 rounded-xl border px-2.5 text-xs font-medium transition-colors cursor-pointer",
                  refMode === "upload"
                    ? "border-emerald-500/35 bg-emerald-500/[0.07] text-emerald-700 dark:text-emerald-300"
                    : "border-border/80 bg-card/90 text-foreground"
                )}
              >
                <CloudUpload className="h-3.5 w-3.5" />
                <span>{refModeShortLabel}</span>
                <ChevronDown className="h-3 w-3 opacity-70" />
              </button>
            </PopoverTrigger>
            <PopoverContent className="w-84 space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold">本地参考图传输策略</span>
                <button
                  type="button"
                  onClick={() => onOpenSettingsTab("imagehost")}
                  className="text-[11px] text-amber-500 hover:underline cursor-pointer"
                >
                  配置私有图床 →
                </button>
              </div>

              <div className="space-y-1.5">
                {(
                  [
                    {
                      m: "upload",
                      title: "自动传图床直链（默认 · 原图无损）",
                      desc: "二进制流原图无损上传获取 https:// 直链，零画质折损，上游成功率最高",
                    },
                    {
                      m: "compress_base64",
                      title: "压缩并转 Base64（可选 · 纯本地隐私）",
                      desc: "绝不上传外部图床；本地剥离 EXIF 并缩放为轻量 sRGB JPEG Base64",
                    },
                    {
                      m: "raw_base64",
                      title: "原图直转 Base64（可选 · 不压缩）",
                      desc: "不经图床且不缩放，仅建议 <500KB 小图使用",
                    },
                  ] as const
                ).map((opt) => (
                  <button
                    key={opt.m}
                    type="button"
                    onClick={() => onChangeRefMode(opt.m)}
                    className={cn(
                      "w-full rounded-xl border p-2 text-left transition-all cursor-pointer",
                      refMode === opt.m
                        ? "border-amber-500 bg-amber-500/12"
                        : "border-border/70 bg-card/50 hover:bg-accent/50"
                    )}
                  >
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-semibold text-foreground">
                        {opt.title}
                      </span>
                      {refMode === opt.m && (
                        <Check className="h-3.5 w-3.5 text-amber-500" />
                      )}
                    </div>
                    <p className="mt-0.5 text-[10px] text-muted-foreground leading-snug">
                      {opt.desc}
                    </p>
                  </button>
                ))}
              </div>

              {refMode === "upload" && (
                <div className="grid grid-cols-2 gap-2 border-t border-border/60 pt-2.5">
                  <div className="space-y-1">
                    <span className="text-[10px] text-muted-foreground">图床节点</span>
                    <select
                      value={imageHostProvider}
                      onChange={(e) =>
                        onChangeImageHostProvider(
                          e.target.value as ImageHostProvider
                        )
                      }
                      className="h-7 w-full rounded-lg border border-border bg-background px-2 text-xs"
                    >
                      {imageHosts.map((h) => (
                        <option key={h.id} value={h.id}>
                          {h.name}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="space-y-1">
                    <span className="text-[10px] text-muted-foreground">
                      Litterbox 有效期
                    </span>
                    <select
                      value={litterboxExpiry}
                      onChange={(e) => onChangeLitterboxExpiry(e.target.value)}
                      className="h-7 w-full rounded-lg border border-border bg-background px-2 text-xs font-mono"
                    >
                      <option value="1h">1 小时后销毁</option>
                      <option value="12h">12 小时后销毁</option>
                      <option value="24h">24 小时后销毁</option>
                      <option value="72h">72 小时后销毁</option>
                    </select>
                  </div>
                </div>
              )}

              {refMode === "compress_base64" && (
                <div className="space-y-2 border-t border-border/60 pt-2.5">
                  <div className="space-y-1">
                    <div className="flex justify-between text-[10px]">
                      <span className="text-muted-foreground">最长边限制</span>
                      <span className="font-mono">{compressMaxDim}px</span>
                    </div>
                    <input
                      type="range"
                      min={640}
                      max={2560}
                      step={128}
                      value={compressMaxDim}
                      onChange={(e) =>
                        onChangeCompressMaxDim(Number(e.target.value))
                      }
                      className="w-full studio-slider"
                    />
                  </div>
                  <div className="space-y-1">
                    <div className="flex justify-between text-[10px]">
                      <span className="text-muted-foreground">JPEG 品质</span>
                      <span className="font-mono">{compressQuality}%</span>
                    </div>
                    <input
                      type="range"
                      min={55}
                      max={95}
                      step={5}
                      value={compressQuality}
                      onChange={(e) =>
                        onChangeCompressQuality(Number(e.target.value))
                      }
                      className="w-full studio-slider"
                    />
                  </div>
                </div>
              )}
            </PopoverContent>
          </Popover>

          {/* 5. Active Project Album Target Pill */}
          {projects.length > 0 && (
            <Popover>
              <PopoverTrigger asChild>
                <button
                  type="button"
                  className="inline-flex h-8 items-center gap-1.5 rounded-xl border border-border/80 bg-card/90 px-2.5 text-xs font-medium text-foreground hover:border-amber-500/50 transition-colors cursor-pointer"
                >
                  {activeProject ? (
                    <span
                      className={cn(
                        "h-2 w-2 rounded-full",
                        PROJECT_COLOR_MAP[activeProject.color || "amber"]?.dot ||
                          "bg-amber-500"
                      )}
                    />
                  ) : (
                    <FolderKanban className="h-3.5 w-3.5 text-muted-foreground" />
                  )}
                  <span className="max-w-[96px] truncate">
                    {activeProject ? activeProject.name : "默认未归档"}
                  </span>
                </button>
              </PopoverTrigger>
              <PopoverContent className="w-56 space-y-1">
                <p className="text-[11px] font-semibold text-muted-foreground px-1 pb-1">
                  生成后自动归入项目画册
                </p>
                <button
                  type="button"
                  onClick={() => onChangeActiveProjectId("")}
                  className={cn(
                    "flex w-full items-center justify-between rounded-lg px-2.5 py-1.5 text-xs cursor-pointer",
                    !activeProjectId ? "bg-accent font-semibold" : "hover:bg-accent/50"
                  )}
                >
                  <span>不指定画册</span>
                  {!activeProjectId && <Check className="h-3.5 w-3.5 text-amber-500" />}
                </button>
                {projects.map((p) => (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => onChangeActiveProjectId(p.id)}
                    className={cn(
                      "flex w-full items-center justify-between rounded-lg px-2.5 py-1.5 text-xs cursor-pointer",
                      activeProjectId === p.id
                        ? "bg-accent font-semibold"
                        : "hover:bg-accent/50"
                    )}
                  >
                    <span className="flex items-center gap-2 truncate">
                      <span
                        className={cn(
                          "h-2 w-2 rounded-full shrink-0",
                          PROJECT_COLOR_MAP[p.color || "amber"]?.dot
                        )}
                      />
                      <span className="truncate">{p.name}</span>
                    </span>
                    {activeProjectId === p.id && (
                      <Check className="h-3.5 w-3.5 text-amber-500" />
                    )}
                  </button>
                ))}
              </PopoverContent>
            </Popover>
          )}

          {/* API Request Code Preview */}
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                onClick={onOpenDevPreview}
                className="inline-flex h-8 w-8 items-center justify-center rounded-xl border border-border/70 bg-card/60 text-muted-foreground hover:text-foreground transition-colors cursor-pointer"
                aria-label="预览等价 API 请求代码"
              >
                <Code2 className="h-3.5 w-3.5" />
              </button>
            </TooltipTrigger>
            <TooltipContent>查看等价 JSON / curl / CLI 命令行参数</TooltipContent>
          </Tooltip>
        </div>

        {/* Right Side: Character Counter + Batch Stepper + Generate CTA */}
        <div className="flex items-center gap-2 ml-auto">
          <span
            className={cn(
              "hidden xl:inline-block font-mono text-[10px] tabular-nums",
              promptMetrics.utf8Bytes > 5000
                ? "text-amber-500 font-semibold"
                : "text-muted-foreground/75"
            )}
            title={`UTF-8 字节数: ${promptMetrics.utf8Bytes}`}
          >
            {promptMetrics.chars}/5000
          </span>

          {/* Tactile Batch Stepper */}
          <div
            className="inline-flex h-9 items-center rounded-xl border border-border/80 bg-card/90 px-1"
            title="单次并发生成张数 (1..10)"
          >
            <button
              type="button"
              disabled={batchCount <= 1}
              onClick={() => onChangeBatchCount(Math.max(1, batchCount - 1))}
              className="flex h-7 w-6 items-center justify-center rounded-lg text-muted-foreground hover:text-foreground disabled:opacity-35 cursor-pointer"
            >
              <Minus className="h-3 w-3" />
            </button>
            <span className="w-7 text-center font-mono text-xs font-semibold tabular-nums">
              ×{batchCount}
            </span>
            <button
              type="button"
              disabled={batchCount >= 10}
              onClick={() => onChangeBatchCount(Math.min(10, batchCount + 1))}
              className="flex h-7 w-6 items-center justify-center rounded-lg text-muted-foreground hover:text-foreground disabled:opacity-35 cursor-pointer"
            >
              <Plus className="h-3 w-3" />
            </button>
          </div>

          {/* Primary Generate Button */}
          <Button
            id="btn-omnibar-generate"
            type="button"
            disabled={isSubmitting || anyUploadingRef}
            onClick={onSubmitGenerate}
            className="h-9 rounded-xl bg-zinc-900 dark:bg-zinc-100 text-zinc-50 dark:text-zinc-950 hover:bg-zinc-800 dark:hover:bg-white px-4 font-semibold shadow-sm gap-1.5 cursor-pointer"
          >
            {isSubmitting || anyUploadingRef ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Sparkles className="h-3.5 w-3.5 text-amber-400 dark:text-amber-600" />
            )}
            <span>
              {anyUploadingRef
                ? "处理参考图..."
                : isSubmitting
                ? "提交中..."
                : "立即生成"}
            </span>
            <kbd className="hidden sm:inline-flex ml-0.5 rounded bg-white/15 dark:bg-black/10 px-1.5 py-0.5 font-mono text-[10px]">
              ⌘↵
            </kbd>
          </Button>
        </div>
      </div>
    </div>
  )
}
