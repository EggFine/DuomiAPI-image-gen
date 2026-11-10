import React, { useMemo, useRef, useState } from "react"
import {
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
  Link2,
  Loader2,
  Minus,
  PencilRuler,
  Plus,
  RefreshCw,
  SlidersHorizontal,
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
import {
  gsap,
  prefersReducedMotion,
  STUDIO_EASE,
  useGSAP,
} from "@/lib/motion"
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
      <span className="inline-flex h-3.5 w-3.5 items-center justify-center rounded-[3px] border border-current/60 text-[8px] font-mono opacity-75">
        A
      </span>
    )
  }
  const max = 13
  const bw = w >= h ? max : Math.max(6, Math.round((max * w) / h))
  const bh = h > w ? max : Math.max(6, Math.round((max * h) / w))
  return (
    <span
      className="inline-block rounded-[2.5px] border border-current opacity-80 shrink-0"
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
  floating?: boolean
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
  floating = false,
}) => {
  const composerRootRef = useRef<HTMLDivElement | null>(null)
  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const textareaRef = useRef<HTMLTextAreaElement | null>(null)
  const submitBtnRef = useRef<HTMLButtonElement | null>(null)
  const batchValueRef = useRef<HTMLSpanElement | null>(null)
  const refChipRefs = useRef<Record<string, HTMLDivElement | null>>({})
  const seenRefIdsRef = useRef<Set<string>>(
    new Set(referenceImages.map((r) => r.id))
  )
  const mountedTextareaRef = useRef<boolean>(false)
  const mountedBatchRef = useRef<boolean>(false)

  const [isDragging, setIsDragging] = useState(false)
  const [urlPopoverOpen, setUrlPopoverOpen] = useState(false)
  const [urlInput, setUrlInput] = useState("")
  const [modelPopoverOpen, setModelPopoverOpen] = useState(false)
  const [ratioPopoverOpen, setRatioPopoverOpen] = useState(false)
  const [historyPopoverOpen, setHistoryPopoverOpen] = useState(false)

  const { contextSafe } = useGSAP({ scope: composerRootRef })

  // Smooth GSAP auto-height interpolation on prompt textarea
  useGSAP(
    () => {
      const el = textareaRef.current
      if (!el) return
      const prevH = el.offsetHeight
      el.style.height = "auto"
      const nextH = Math.min(220, Math.max(58, el.scrollHeight))

      if (
        !mountedTextareaRef.current ||
        prefersReducedMotion() ||
        Math.abs(nextH - prevH) < 2
      ) {
        mountedTextareaRef.current = true
        el.style.height = `${nextH}px`
        return
      }

      el.style.height = `${prevH}px`
      gsap.to(el, {
        height: nextH,
        duration: 0.22,
        ease: STUDIO_EASE.out,
        overwrite: "auto",
      })
    },
    { scope: composerRootRef, dependencies: [prompt] }
  )

  // Calm Apple fluid settle for newly added Reference Image Chips (@图1, @图2...)
  useGSAP(
    () => {
      const currentIds = new Set(referenceImages.map((r) => r.id))
      const newTargets: HTMLDivElement[] = []
      for (const r of referenceImages) {
        if (!seenRefIdsRef.current.has(r.id)) {
          seenRefIdsRef.current.add(r.id)
          const el = refChipRefs.current[r.id]
          if (el) newTargets.push(el)
        }
      }
      for (const oldId of Array.from(seenRefIdsRef.current)) {
        if (!currentIds.has(oldId)) {
          seenRefIdsRef.current.delete(oldId)
        }
      }
      if (newTargets.length > 0 && !prefersReducedMotion()) {
        gsap.fromTo(
          newTargets,
          { autoAlpha: 0, scale: 0.94, y: 4 },
          {
            autoAlpha: 1,
            scale: 1,
            y: 0,
            duration: 0.32,
            stagger: 0.04,
            ease: STUDIO_EASE.expo,
            clearProps: "transform,visibility",
          }
        )
      }
    },
    { scope: composerRootRef, dependencies: [referenceImages] }
  )

  // Subtle calm micro-scale when changing batch count (×1..×10)
  useGSAP(
    () => {
      if (!mountedBatchRef.current) {
        mountedBatchRef.current = true
        return
      }
      if (!batchValueRef.current || prefersReducedMotion()) return
      gsap.fromTo(
        batchValueRef.current,
        { scale: 1.09 },
        {
          scale: 1,
          duration: 0.24,
          ease: STUDIO_EASE.out,
          overwrite: "auto",
          clearProps: "transform",
        }
      )
    },
    { scope: composerRootRef, dependencies: [batchCount] }
  )

  const animateShutterPulse = contextSafe((btn: HTMLButtonElement | null) => {
    if (!btn || prefersReducedMotion()) return
    gsap
      .timeline({ defaults: { overwrite: "auto" } })
      .to(btn, {
        scale: 0.97,
        duration: 0.08,
        ease: "power2.in",
      })
      .to(btn, {
        scale: 1,
        duration: 0.26,
        ease: STUDIO_EASE.out,
        clearProps: "transform",
      })
  })

  const triggerGenerateWithShutter = () => {
    animateShutterPulse(submitBtnRef.current)
    onSubmitGenerate()
  }

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
    const maxBox = 64
    const rw = w >= h ? maxBox : Math.max(22, Math.round((maxBox * w) / h))
    const rh = h > w ? maxBox : Math.max(22, Math.round((maxBox * h) / w))
    return { width: `${rw}px`, height: `${rh}px` }
  }, [activeRatioGroup, selectedRatio, customW, customH])

  const popoverSide: "top" | "bottom" = floating ? "top" : "bottom"

  const pillClass =
    "inline-flex h-8 items-center gap-1.5 rounded-full bg-foreground/[0.045] dark:bg-white/[0.06] hover:bg-foreground/[0.085] dark:hover:bg-white/[0.1] px-3 text-xs font-medium text-foreground transition-colors cursor-pointer"

  const ghostUtilityClass =
    "inline-flex h-7 items-center gap-1 rounded-full px-2.5 text-xs font-medium text-muted-foreground hover:bg-foreground/[0.055] hover:text-foreground transition-colors cursor-pointer"

  return (
    <div
      ref={composerRootRef}
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
        "relative isolate mx-auto w-full rounded-[26px] p-4 sm:p-5 transition-colors duration-200",
        floating
          ? "studio-floating-popover max-w-[920px]"
          : "studio-omnibar-flat max-w-[1040px]",
        isDragging && "ring-2 ring-foreground/25"
      )}
    >
      {/* Minimalist Frosted Drag & Drop Overlay */}
      {isDragging && (
        <div className="pointer-events-none absolute inset-2 z-30 flex items-center justify-center rounded-3xl bg-background/75 backdrop-blur-md">
          <div className="flex items-center gap-2 rounded-full bg-primary px-4 py-2 text-xs font-medium text-primary-foreground shadow-md">
            <CloudUpload className="h-3.5 w-3.5" />
            <span>松开添加参考图（{refModeShortLabel}）</span>
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

      {/* Top Strip: Reference Chips + Quiet Utility Triggers */}
      <div className="flex flex-wrap items-center justify-between gap-2 pb-2">
        <div className="flex flex-wrap items-center gap-1.5">
          {referenceImages.map((item, idx) => (
            <div
              key={item.id}
              ref={(el) => {
                refChipRefs.current[item.id] = el
              }}
              className={cn(
                "group relative flex items-center gap-2 rounded-2xl p-1.5 pr-2.5 transition-colors",
                item.error
                  ? "bg-destructive/10"
                  : "bg-foreground/[0.045] dark:bg-white/[0.06] hover:bg-foreground/[0.075]"
              )}
            >
              <div className="relative h-10 w-10 shrink-0 overflow-hidden rounded-xl bg-secondary">
                <img
                  src={item.preview}
                  alt={`参考图${idx + 1}`}
                  className="h-full w-full object-cover"
                />
                {item.uploading && (
                  <div className="absolute inset-0 flex items-center justify-center bg-black/55 backdrop-blur-[1px]">
                    <Loader2 className="h-3.5 w-3.5 animate-spin text-white" />
                  </div>
                )}
                {item.annotated && (
                  <span className="absolute bottom-0 inset-x-0 bg-black/70 text-[8px] font-medium text-center text-white leading-tight py-0.5">
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
                        className="rounded-full bg-foreground/[0.08] px-2 py-0.5 font-mono text-[10px] font-medium text-foreground hover:bg-primary hover:text-primary-foreground transition-colors cursor-pointer"
                      >
                        @图{idx + 1}
                      </button>
                    </TooltipTrigger>
                    <TooltipContent>插入「图{idx + 1}」到光标处</TooltipContent>
                  </Tooltip>

                  {!item.uploading && !item.error && (
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <button
                          type="button"
                          onClick={() => onAnnotateRef(item)}
                          className="rounded-full p-1 text-muted-foreground hover:bg-foreground/[0.08] hover:text-foreground transition-colors cursor-pointer"
                          aria-label="裁剪或标注参考图"
                        >
                          <PencilRuler className="h-3 w-3" />
                        </button>
                      </TooltipTrigger>
                      <TooltipContent>裁剪与标注</TooltipContent>
                    </Tooltip>
                  )}

                  {item.error && (
                    <button
                      type="button"
                      onClick={() => onRetryRef(item)}
                      className="rounded-full p-1 text-destructive hover:bg-destructive/15 cursor-pointer"
                      title="重试上传"
                    >
                      <RefreshCw className="h-3 w-3" />
                    </button>
                  )}
                </div>

                <span
                  className={cn(
                    "text-[10px] truncate max-w-[92px] mt-0.5",
                    item.error ? "text-destructive" : "text-muted-foreground"
                  )}
                  title={item.error || item.label}
                >
                  {item.error ? "上传失败" : item.label}
                </span>
              </div>

              <div className="flex items-center gap-0.5 ml-0.5">
                {referenceImages.length > 1 && idx > 0 && (
                  <button
                    type="button"
                    onClick={() => onMoveRef(idx, -1)}
                    className="rounded-full p-0.5 text-muted-foreground hover:text-foreground cursor-pointer"
                    title="前移"
                  >
                    <ChevronLeft className="h-3 w-3" />
                  </button>
                )}
                {referenceImages.length > 1 &&
                  idx < referenceImages.length - 1 && (
                    <button
                      type="button"
                      onClick={() => onMoveRef(idx, 1)}
                      className="rounded-full p-0.5 text-muted-foreground hover:text-foreground cursor-pointer"
                      title="后移"
                    >
                      <ChevronRight className="h-3 w-3" />
                    </button>
                  )}
                <button
                  type="button"
                  onClick={() => onRemoveRef(item.id)}
                  className="rounded-full p-1 text-muted-foreground hover:bg-foreground/[0.08] hover:text-foreground transition-colors cursor-pointer"
                  title="移除"
                >
                  <X className="h-3 w-3" />
                </button>
              </div>
            </div>
          ))}

          {/* Quiet Ghost Reference Utilities */}
          <button
            id="btn-omnibar-upload-ref"
            type="button"
            onClick={() => fileInputRef.current?.click()}
            className={ghostUtilityClass}
          >
            <ImagePlus className="h-3.5 w-3.5" />
            <span>{referenceImages.length > 0 ? "加图" : "参考图"}</span>
          </button>

          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                onClick={onPasteFromClipboardButton}
                className={ghostUtilityClass}
              >
                <ClipboardPaste className="h-3.5 w-3.5" />
                <span className="hidden sm:inline">粘贴</span>
              </button>
            </TooltipTrigger>
            <TooltipContent>粘贴剪贴板图片 (⌘V)</TooltipContent>
          </Tooltip>

          <Popover open={urlPopoverOpen} onOpenChange={setUrlPopoverOpen}>
            <PopoverTrigger asChild>
              <button type="button" className={ghostUtilityClass}>
                <Link2 className="h-3.5 w-3.5" />
                <span className="hidden sm:inline">URL</span>
              </button>
            </PopoverTrigger>
            <PopoverContent
              preferredSide={popoverSide}
              className="w-80 space-y-2.5"
            >
              <p className="text-xs font-medium text-foreground">参考图直链</p>
              <div className="flex gap-2">
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
                  className="h-8 px-3.5"
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

        {/* Right Quiet Prompt Tools */}
        <div className="flex items-center gap-0.5">
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                id="btn-open-zen-workbench"
                type="button"
                onClick={onOpenZenWorkbench}
                className={ghostUtilityClass}
              >
                <Wand2 className="h-3.5 w-3.5" />
                <span>长文</span>
              </button>
            </TooltipTrigger>
            <TooltipContent>沉浸长文工作台</TooltipContent>
          </Tooltip>

          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                onClick={onOpenRecipes}
                className={ghostUtilityClass}
              >
                <BookMarked className="h-3.5 w-3.5" />
                <span className="hidden sm:inline">配方</span>
              </button>
            </TooltipTrigger>
            <TooltipContent>浏览提示词配方</TooltipContent>
          </Tooltip>

          {promptHistory.length > 0 && (
            <Popover
              open={historyPopoverOpen}
              onOpenChange={setHistoryPopoverOpen}
            >
              <PopoverTrigger asChild>
                <button
                  type="button"
                  className={ghostUtilityClass}
                  title="提示词历史"
                >
                  <History className="h-3.5 w-3.5" />
                </button>
              </PopoverTrigger>
              <PopoverContent
                align="end"
                preferredSide={popoverSide}
                className="w-92 max-h-80 overflow-y-auto space-y-1.5"
              >
                <div className="flex items-center justify-between px-2 pb-1">
                  <span className="text-xs font-medium text-foreground">
                    最近提示词
                  </span>
                  <span className="text-[11px] text-muted-foreground tabular-nums">
                    {promptHistory.length} 条
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
                    className="w-full rounded-2xl popover-tile-interactive p-2.5 text-left cursor-pointer"
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
                  className={ghostUtilityClass}
                >
                  <BookmarkPlus className="h-3.5 w-3.5" />
                </button>
              </TooltipTrigger>
              <TooltipContent>存为配方</TooltipContent>
            </Tooltip>
          )}

          {onCollapseOverlay && (
            <button
              type="button"
              onClick={onCollapseOverlay}
              className={cn(ghostUtilityClass, "bg-foreground/[0.05]")}
              title="收起 (Esc)"
            >
              <X className="h-3.5 w-3.5" />
              <span>收起</span>
            </button>
          )}
        </div>
      </div>

      {/* Main Clean Prompt Textarea — Zero Dividing Lines */}
      <div className="relative">
        <textarea
          id={
            onCollapseOverlay
              ? "omnibar-overlay-prompt-input"
              : "omnibar-prompt-input"
          }
          ref={textareaRef}
          autoFocus={Boolean(onCollapseOverlay)}
          value={prompt}
          onChange={(e) => onChangePrompt(e.target.value)}
          onKeyDown={(e) => {
            if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
              e.preventDefault()
              if (!isSubmitting && !anyUploadingRef) {
                triggerGenerateWithShutter()
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
              ? "描述画面细节，点击上方 @图1 可直接指代对应参考主体"
              : "描述你想创作的画面，支持拖入或粘贴参考图"
          }
          className="w-full resize-none bg-transparent px-1 py-2 text-[15px] leading-relaxed text-foreground placeholder:text-muted-foreground/55 focus:outline-none min-h-[58px] max-h-[220px] overflow-y-auto studio-scroll"
        />

        {promptMetrics.multiHint && (
          <div className="mt-1 mb-1 flex items-center justify-between gap-3 rounded-2xl bg-foreground/[0.045] px-3.5 py-2 text-xs text-muted-foreground">
            <span>检测到多图描述，如需生成多张独立照片可调高张数</span>
            <button
              type="button"
              onClick={() => onChangeBatchCount(4)}
              className="shrink-0 rounded-full bg-primary px-3 py-1 text-[11px] font-medium text-primary-foreground cursor-pointer"
            >
              设为 ×4
            </button>
          </div>
        )}
      </div>

      {/* Bottom Precision Parameter Capsules + Generate CTA (No Border Line) */}
      <div className="flex flex-wrap items-center justify-between gap-2 pt-3">
        <div className="flex flex-wrap items-center gap-1.5">
          {/* 1. Model Selector Capsule */}
          <Popover open={modelPopoverOpen} onOpenChange={setModelPopoverOpen}>
            <PopoverTrigger asChild>
              <button
                id="pill-model-selector"
                type="button"
                className={pillClass}
              >
                <span className="max-w-[148px] truncate">
                  {displayModelLabel}
                </span>
                <ChevronDown className="h-3 w-3 text-muted-foreground" />
              </button>
            </PopoverTrigger>
            <PopoverContent
              preferredSide={popoverSide}
              className="w-84 space-y-2.5"
            >
              <div className="px-1">
                <span className="text-xs font-medium text-foreground">
                  生图模型
                </span>
              </div>
              <div className="space-y-1.5">
                {models.map((m) => {
                  const selected =
                    !customModel.trim() && selectedModel === m.id
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
                        "w-full rounded-2xl p-2.5 text-left cursor-pointer",
                        selected
                          ? "popover-tile-active"
                          : "popover-tile-interactive"
                      )}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <div className="flex items-center gap-1.5">
                          <span className="text-xs font-medium text-foreground">
                            {m.name}
                          </span>
                          <Badge
                            variant="secondary"
                            className="text-[10px] px-2 py-0"
                          >
                            {m.badge}
                          </Badge>
                        </div>
                        <div className="flex items-center gap-1.5">
                          <span className="font-mono text-[10px] text-muted-foreground">
                            {m.price}
                          </span>
                          {selected && (
                            <Check className="h-3.5 w-3.5 text-foreground" />
                          )}
                        </div>
                      </div>
                      <p className="mt-1 text-[11px] text-muted-foreground leading-snug">
                        {m.description}
                      </p>
                    </button>
                  )
                })}
              </div>
              <div className="pt-1 space-y-1.5">
                <span className="px-1 text-[11px] text-muted-foreground">
                  自定义模型 ID
                </span>
                <Input
                  value={customModel}
                  onChange={(e) => onChangeCustomModel(e.target.value)}
                  placeholder="gpt-image-2.6-sunburst"
                  className="h-8 text-xs font-mono"
                />
              </div>
            </PopoverContent>
          </Popover>

          {/* 2. Aspect Ratio & Resolution Visualizer Capsule */}
          <Popover open={ratioPopoverOpen} onOpenChange={setRatioPopoverOpen}>
            <PopoverTrigger asChild>
              <button
                id="pill-ratio-selector"
                type="button"
                className={pillClass}
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
            <PopoverContent
              preferredSide={popoverSide}
              className="w-[356px] sm:w-[416px] space-y-3.5"
            >
              {/* Clean Solid Monochrome Aspect Frame Preview */}
              <div className="flex items-center gap-3.5 rounded-2xl popover-tile p-3">
                <div className="flex h-[72px] w-[72px] shrink-0 items-center justify-center rounded-xl bg-card border border-border">
                  <div
                    style={previewRectStyle}
                    className="rounded-[5px] border-[1.5px] border-foreground/75 bg-foreground/[0.06] transition-all duration-200 flex items-center justify-center"
                  >
                    <span className="font-mono text-[9px] font-medium text-foreground">
                      {selectedRatio === "custom" ? "W×H" : selectedRatio}
                    </span>
                  </div>
                </div>
                <div className="space-y-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-medium text-foreground">
                      {selectedRatio === "custom"
                        ? "自定义尺寸"
                        : `${activeRatioGroup?.ratio || "1:1"} · ${
                            activeRatioGroup?.name || ""
                          }`}
                    </span>
                    {pixelInfo && (
                      <Badge
                        variant="secondary"
                        className="font-mono text-[10px] px-2 py-0"
                      >
                        {pixelInfo.mp} MP
                      </Badge>
                    )}
                  </div>
                  <p className="font-mono text-xs text-muted-foreground">
                    {selectedSize}
                  </p>
                </div>
              </div>

              {/* 12 Aspect Ratios + Custom */}
              <div className="space-y-1.5">
                <span className="px-1 text-[11px] font-medium text-muted-foreground">
                  画幅比例
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
                          "flex flex-col items-center justify-center gap-1 rounded-xl py-2 px-1 text-center transition-colors cursor-pointer",
                          active
                            ? "bg-primary text-primary-foreground font-medium"
                            : "popover-tile-interactive text-muted-foreground hover:text-foreground"
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
                      "flex flex-col items-center justify-center gap-1 rounded-xl py-2 px-1 text-center transition-colors cursor-pointer",
                      selectedRatio === "custom"
                        ? "bg-primary text-primary-foreground font-medium"
                        : "popover-tile-interactive text-muted-foreground hover:text-foreground"
                    )}
                  >
                    <SlidersHorizontal className="h-3.5 w-3.5" />
                    <span className="text-[10px] leading-none">自定义</span>
                  </button>
                </div>
              </div>

              {/* Resolution Tiers or Custom W×H */}
              {selectedRatio === "custom" ? (
                <div className="space-y-2 pt-1">
                  <span className="px-1 text-[11px] font-medium text-muted-foreground">
                    像素宽高（16 倍数）
                  </span>
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
                    <span className="font-mono text-xs text-muted-foreground">
                      ×
                    </span>
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
                      className="h-8 px-3"
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
                      对齐 16
                    </Button>
                  </div>
                </div>
              ) : (
                activeRatioGroup &&
                activeRatioGroup.sizes.length > 0 && (
                  <div className="space-y-1.5 pt-1">
                    <span className="px-1 text-[11px] font-medium text-muted-foreground">
                      分辨率档位
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
                              "flex items-center justify-between gap-2 rounded-2xl px-3 py-2 text-left cursor-pointer",
                              active
                                ? "popover-tile-active"
                                : "popover-tile-interactive"
                            )}
                          >
                            <div className="min-w-0">
                              <p className="text-xs font-medium text-foreground truncate">
                                {sz.label}
                              </p>
                              <p className="font-mono text-[10px] text-muted-foreground truncate">
                                {sz.detail}
                              </p>
                            </div>
                            {active && (
                              <Check className="h-3.5 w-3.5 text-foreground shrink-0" />
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

          {/* 3. Quality & Background Capsule */}
          <Popover>
            <PopoverTrigger asChild>
              <button type="button" className={pillClass}>
                <span>
                  {quality === "default" ? "标准画质" : quality.toUpperCase()}
                  {background === "transparent" ? " · 透明底" : ""}
                </span>
                <ChevronDown className="h-3 w-3 text-muted-foreground" />
              </button>
            </PopoverTrigger>
            <PopoverContent
              preferredSide={popoverSide}
              className="w-72 space-y-3.5"
            >
              <div className="space-y-1.5">
                <span className="px-1 text-xs font-medium text-foreground">
                  刻画精细度
                </span>
                <div className="grid grid-cols-4 gap-1 rounded-full popover-tile p-1">
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
                        "rounded-full py-1 text-[11px] font-medium transition-all cursor-pointer",
                        quality === q.v
                          ? "bg-card text-foreground shadow-2xs dark:bg-white/[0.18]"
                          : "text-muted-foreground hover:text-foreground"
                      )}
                    >
                      {q.l}
                    </button>
                  ))}
                </div>
              </div>

              <div className="space-y-1.5">
                <span className="px-1 text-xs font-medium text-foreground">
                  背景通道
                </span>
                <div className="grid grid-cols-3 gap-1 rounded-full popover-tile p-1">
                  {[
                    { v: "auto", l: "自动" },
                    { v: "opaque", l: "实色" },
                    { v: "transparent", l: "透明" },
                  ].map((b) => (
                    <button
                      key={b.v}
                      type="button"
                      onClick={() => onChangeBackground(b.v)}
                      className={cn(
                        "rounded-full py-1 text-[11px] font-medium transition-all cursor-pointer",
                        background === b.v
                          ? "bg-card text-foreground shadow-2xs dark:bg-white/[0.18]"
                          : "text-muted-foreground hover:text-foreground"
                      )}
                    >
                      {b.l}
                    </button>
                  ))}
                </div>
              </div>

              <div className="space-y-2.5 pt-1 px-1 text-xs">
                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground">自动兼容重试</span>
                  <Switch
                    checked={autoCompatFallback}
                    onCheckedChange={onChangeAutoCompatFallback}
                  />
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground">海外加速线路</span>
                  <Switch checked={oversea} onCheckedChange={onChangeOversea} />
                </div>
              </div>
            </PopoverContent>
          </Popover>

          {/* 4. Reference Strategy Capsule */}
          <Popover>
            <PopoverTrigger asChild>
              <button
                id="pill-ref-strategy"
                type="button"
                className={pillClass}
              >
                <span
                  className={cn(
                    "h-1.5 w-1.5 rounded-full",
                    refMode === "upload"
                      ? "bg-emerald-500"
                      : "bg-muted-foreground/60"
                  )}
                />
                <span>{refModeShortLabel}</span>
                <ChevronDown className="h-3 w-3 text-muted-foreground" />
              </button>
            </PopoverTrigger>
            <PopoverContent
              preferredSide={popoverSide}
              className="w-80 space-y-3"
            >
              <div className="flex items-center justify-between px-1">
                <span className="text-xs font-medium text-foreground">
                  参考图传输方式
                </span>
                <button
                  type="button"
                  onClick={() => onOpenSettingsTab("imagehost")}
                  className="text-[11px] text-muted-foreground hover:text-foreground transition-colors cursor-pointer"
                >
                  图床设置 →
                </button>
              </div>

              <div className="space-y-1.5">
                {(
                  [
                    {
                      m: "upload",
                      title: "无损图床直链（默认）",
                      desc: "原图直传获取 HTTPS 链接，零画质折损",
                    },
                    {
                      m: "compress_base64",
                      title: "本地压缩 Base64",
                      desc: "不经外部图床，本地缩放为轻量 JPEG",
                    },
                    {
                      m: "raw_base64",
                      title: "原图直转 Base64",
                      desc: "不经图床且不压缩，适合小体积图片",
                    },
                  ] as const
                ).map((opt) => (
                  <button
                    key={opt.m}
                    type="button"
                    onClick={() => onChangeRefMode(opt.m)}
                    className={cn(
                      "w-full rounded-2xl p-2.5 text-left cursor-pointer",
                      refMode === opt.m
                        ? "popover-tile-active"
                        : "popover-tile-interactive"
                    )}
                  >
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-medium text-foreground">
                        {opt.title}
                      </span>
                      {refMode === opt.m && (
                        <Check className="h-3.5 w-3.5 text-foreground" />
                      )}
                    </div>
                    <p className="mt-0.5 text-[11px] text-muted-foreground leading-snug">
                      {opt.desc}
                    </p>
                  </button>
                ))}
              </div>

              {refMode === "upload" && (
                <div className="grid grid-cols-2 gap-2 pt-1">
                  <div className="space-y-1">
                    <span className="px-1 text-[10px] text-muted-foreground">
                      节点
                    </span>
                    <select
                      value={imageHostProvider}
                      onChange={(e) =>
                        onChangeImageHostProvider(
                          e.target.value as ImageHostProvider
                        )
                      }
                      className="h-8 w-full rounded-xl popover-tile px-2.5 text-xs text-foreground focus:outline-none"
                    >
                      {imageHosts.map((h) => (
                        <option key={h.id} value={h.id}>
                          {h.name}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="space-y-1">
                    <span className="px-1 text-[10px] text-muted-foreground">
                      有效期
                    </span>
                    <select
                      value={litterboxExpiry}
                      onChange={(e) => onChangeLitterboxExpiry(e.target.value)}
                      className="h-8 w-full rounded-xl popover-tile px-2.5 text-xs font-mono text-foreground focus:outline-none"
                    >
                      <option value="1h">1 小时</option>
                      <option value="12h">12 小时</option>
                      <option value="24h">24 小时</option>
                      <option value="72h">72 小时</option>
                    </select>
                  </div>
                </div>
              )}

              {refMode === "compress_base64" && (
                <div className="space-y-2.5 pt-1 px-1">
                  <div className="space-y-1">
                    <div className="flex justify-between text-[11px]">
                      <span className="text-muted-foreground">最长边</span>
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
                    <div className="flex justify-between text-[11px]">
                      <span className="text-muted-foreground">品质</span>
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

          {/* 5. Active Project Album Capsule */}
          {projects.length > 0 && (
            <Popover>
              <PopoverTrigger asChild>
                <button type="button" className={pillClass}>
                  {activeProject ? (
                    <span
                      className={cn(
                        "h-2 w-2 rounded-full",
                        PROJECT_COLOR_MAP[activeProject.color || "amber"]
                          ?.dot || "bg-foreground"
                      )}
                    />
                  ) : (
                    <FolderKanban className="h-3.5 w-3.5 text-muted-foreground" />
                  )}
                  <span className="max-w-[96px] truncate">
                    {activeProject ? activeProject.name : "未归档"}
                  </span>
                </button>
              </PopoverTrigger>
              <PopoverContent
                preferredSide={popoverSide}
                className="w-52 space-y-1"
              >
                <p className="text-[11px] font-medium text-muted-foreground px-2 pb-1">
                  自动归入画册
                </p>
                <button
                  type="button"
                  onClick={() => onChangeActiveProjectId("")}
                  className={cn(
                    "flex w-full items-center justify-between rounded-xl px-2.5 py-2 text-xs cursor-pointer",
                    !activeProjectId
                      ? "popover-tile-active font-medium"
                      : "hover:bg-[var(--tile-bg)]"
                  )}
                >
                  <span>不指定</span>
                  {!activeProjectId && (
                    <Check className="h-3.5 w-3.5 text-foreground" />
                  )}
                </button>
                {projects.map((p) => (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => onChangeActiveProjectId(p.id)}
                    className={cn(
                      "flex w-full items-center justify-between rounded-xl px-2.5 py-2 text-xs cursor-pointer",
                      activeProjectId === p.id
                        ? "popover-tile-active font-medium"
                        : "hover:bg-[var(--tile-bg)]"
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
                      <Check className="h-3.5 w-3.5 text-foreground" />
                    )}
                  </button>
                ))}
              </PopoverContent>
            </Popover>
          )}

          {/* Request Payload Preview */}
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                onClick={onOpenDevPreview}
                className="inline-flex h-8 w-8 items-center justify-center rounded-full bg-foreground/[0.045] dark:bg-white/[0.06] text-muted-foreground hover:bg-foreground/[0.085] hover:text-foreground transition-colors cursor-pointer"
                aria-label="预览 API 请求参数"
              >
                <Code2 className="h-3.5 w-3.5" />
              </button>
            </TooltipTrigger>
            <TooltipContent>请求代码预览</TooltipContent>
          </Tooltip>
        </div>

        {/* Right Side: Subtle Counter + Tonal Batch Capsule + Pure Apple Generate Button */}
        <div className="flex items-center gap-2 ml-auto">
          {promptMetrics.chars > 0 && (
            <span
              className={cn(
                "hidden xl:inline-block font-mono text-[11px] tabular-nums",
                promptMetrics.utf8Bytes > 5000
                  ? "text-amber-500 font-medium"
                  : "text-muted-foreground/55"
              )}
              title={`UTF-8: ${promptMetrics.utf8Bytes} 字节`}
            >
              {promptMetrics.chars}
            </span>
          )}

          {/* Borderless Tonal Batch Stepper */}
          <div
            className="inline-flex h-9 items-center rounded-full bg-foreground/[0.045] dark:bg-white/[0.06] px-1"
            title="生成张数 (1–10)"
          >
            <button
              type="button"
              disabled={batchCount <= 1}
              onClick={() => onChangeBatchCount(Math.max(1, batchCount - 1))}
              className="flex h-7 w-7 items-center justify-center rounded-full text-muted-foreground hover:text-foreground disabled:opacity-30 cursor-pointer"
            >
              <Minus className="h-3 w-3" />
            </button>
            <span
              ref={batchValueRef}
              className="w-7 text-center font-mono text-xs font-medium tabular-nums inline-block"
            >
              ×{batchCount}
            </span>
            <button
              type="button"
              disabled={batchCount >= 10}
              onClick={() => onChangeBatchCount(Math.min(10, batchCount + 1))}
              className="flex h-7 w-7 items-center justify-center rounded-full text-muted-foreground hover:text-foreground disabled:opacity-30 cursor-pointer"
            >
              <Plus className="h-3 w-3" />
            </button>
          </div>

          {/* Pure Monochrome Apple Pill CTA */}
          <Button
            ref={submitBtnRef}
            id={
              onCollapseOverlay
                ? "btn-omnibar-overlay-generate"
                : "btn-omnibar-generate"
            }
            type="button"
            disabled={isSubmitting || anyUploadingRef}
            onClick={triggerGenerateWithShutter}
            className="h-9 rounded-full px-5 text-[13px] font-medium gap-1.5"
          >
            {(isSubmitting || anyUploadingRef) && (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            )}
            <span>
              {anyUploadingRef
                ? "准备中"
                : isSubmitting
                ? "提交中"
                : "生成"}
            </span>
          </Button>
        </div>
      </div>
    </div>
  )
}
