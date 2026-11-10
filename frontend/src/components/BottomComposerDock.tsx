import React, { useEffect, useMemo, useRef, useState } from "react"
import {
  ArrowUp,
  ChevronUp,
  CloudUpload,
  ImagePlus,
  Loader2,
  X,
} from "lucide-react"
import { Button } from "@/components/ui/button"
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
import { cn } from "@/lib/utils"
import type { ReferenceImageEntry } from "@/types"

interface BottomComposerDockProps {
  visible: boolean
  expanded: boolean
  onChangeExpanded: (expanded: boolean) => void

  prompt: string
  onChangePrompt: (v: string) => void

  referenceImages: ReferenceImageEntry[]
  onFilesSelected: (files: FileList | File[]) => void
  onRemoveRef: (id: string) => void

  shortModelLabel: string
  tierShortLabel: string
  batchCount: number
  isSubmitting: boolean
  anyUploadingRef: boolean

  onSubmitGenerate: () => void
  onScrollToTop: () => void
  renderExpandedComposer: () => React.ReactNode
}

export const BottomComposerDock: React.FC<BottomComposerDockProps> = ({
  visible,
  expanded,
  onChangeExpanded,
  prompt,
  onChangePrompt,
  referenceImages,
  onFilesSelected,
  onRemoveRef,
  shortModelLabel,
  tierShortLabel,
  batchCount,
  isSubmitting,
  anyUploadingRef,
  onSubmitGenerate,
  onScrollToTop,
  renderExpandedComposer,
}) => {
  const [mounted, setMounted] = useState<boolean>(visible)
  const [isDragging, setIsDragging] = useState<boolean>(false)

  const dockScopeRef = useRef<HTMLDivElement | null>(null)
  const dockShellRef = useRef<HTMLDivElement | null>(null)
  const dockInnerRef = useRef<HTMLDivElement | null>(null)
  const compactInputRef = useRef<HTMLInputElement | null>(null)
  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const prevVisibleRef = useRef<boolean>(false)
  const prevExpandedRef = useRef<boolean>(expanded)

  const { contextSafe } = useGSAP({ scope: dockScopeRef })

  useEffect(() => {
    if (visible) {
      setMounted(true)
    }
  }, [visible])

  const handleUnmountComplete = contextSafe(() => {
    setMounted(false)
  })

  // 1. Calm Apple entrance & exit when scrolling past / back to top composer
  useGSAP(
    () => {
      const shell = dockShellRef.current
      if (!shell) return

      if (visible && !prevVisibleRef.current) {
        prevVisibleRef.current = true
        if (prefersReducedMotion()) {
          gsap.set(shell, { autoAlpha: 1, y: 0, scale: 1 })
          return
        }
        gsap.fromTo(
          shell,
          { autoAlpha: 0, y: 18, scale: 0.98 },
          {
            autoAlpha: 1,
            y: 0,
            scale: 1,
            duration: 0.34,
            ease: STUDIO_EASE.expo,
            overwrite: "auto",
            clearProps: "transform,visibility",
          }
        )
      } else if (!visible && prevVisibleRef.current) {
        prevVisibleRef.current = false
        if (prefersReducedMotion()) {
          setMounted(false)
          return
        }
        gsap.to(shell, {
          autoAlpha: 0,
          y: 14,
          scale: 0.985,
          duration: 0.2,
          ease: STUDIO_EASE.inOut,
          overwrite: "auto",
          onComplete: handleUnmountComplete,
        })
      }
    },
    { scope: dockScopeRef, dependencies: [visible, mounted] }
  )

  // 2. Smooth upward morph feel when toggling compact pill <-> expanded tray
  useGSAP(
    () => {
      if (!visible || prevExpandedRef.current === expanded) return
      prevExpandedRef.current = expanded
      const inner = dockInnerRef.current
      if (!inner || prefersReducedMotion()) return

      gsap.fromTo(
        inner,
        {
          autoAlpha: 0.65,
          y: expanded ? 10 : -6,
          scale: expanded ? 0.985 : 1.01,
          transformOrigin: "bottom center",
        },
        {
          autoAlpha: 1,
          y: 0,
          scale: 1,
          duration: 0.28,
          ease: STUDIO_EASE.expo,
          overwrite: "auto",
          clearProps: "transform,visibility,opacity",
        }
      )
    },
    { scope: dockScopeRef, dependencies: [expanded, visible] }
  )

  // 3. Click outside expanded bottom tray collapses cleanly back to compact 1-line bar
  useEffect(() => {
    if (!visible || !expanded) return
    const onPointerDown = (ev: MouseEvent) => {
      const target = ev.target as HTMLElement | null
      if (!target) return
      if (dockInnerRef.current?.contains(target)) return
      if (target.closest("[data-studio-popover-portal='true']")) return
      if (target.closest("[data-radix-popper-content-wrapper]")) return
      if (target.closest("[role='dialog']")) return
      onChangeExpanded(false)
    }
    document.addEventListener("mousedown", onPointerDown)
    return () => document.removeEventListener("mousedown", onPointerDown)
  }, [visible, expanded, onChangeExpanded])

  const animateShutterBtn = contextSafe((btn: HTMLButtonElement | null) => {
    if (!btn || prefersReducedMotion()) return
    gsap
      .timeline({ defaults: { overwrite: "auto" } })
      .to(btn, { scale: 0.96, duration: 0.08, ease: "power2.in" })
      .to(btn, {
        scale: 1,
        duration: 0.24,
        ease: STUDIO_EASE.out,
        clearProps: "transform",
      })
  })

  const insertTokenIntoCompactInput = (token: string) => {
    const el = compactInputRef.current
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
      const pos = start + token.length
      el.setSelectionRange(pos, pos)
    })
  }

  const compactSummary = useMemo(() => {
    const cleanModel = shortModelLabel
      .replace(/^GPT-Image\s*/i, "")
      .replace(/^Image\s*/i, "")
      .replace(/^gpt-image-/i, "")
    return `${tierShortLabel} · ${cleanModel}`
  }, [tierShortLabel, shortModelLabel])

  if (!mounted) return null

  return (
    <div
      ref={dockScopeRef}
      className={cn(
        "fixed inset-x-0 bottom-20 md:bottom-5 z-30 pointer-events-none",
        !visible && "pointer-events-none"
      )}
    >
      <div ref={dockShellRef} className="studio-container flex justify-center">
        <div
          ref={dockInnerRef}
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
            "pointer-events-auto w-full",
            expanded ? "max-w-[920px]" : "max-w-[780px]"
          )}
        >
          {expanded ? (
            renderExpandedComposer()
          ) : (
            <div
              className={cn(
                "studio-floating-popover relative flex items-center gap-1.5 rounded-full p-1.5 pl-2 transition-shadow",
                isDragging && "ring-2 ring-foreground/25"
              )}
            >
              {isDragging && (
                <div className="pointer-events-none absolute inset-1 z-20 flex items-center justify-center rounded-full bg-card/95">
                  <span className="inline-flex items-center gap-1.5 text-xs font-medium text-foreground">
                    <CloudUpload className="h-3.5 w-3.5" />
                    松开添加参考图
                  </span>
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

              {/* Left: Add Reference Image + Mini Reference Chips */}
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full popover-tile-interactive text-muted-foreground hover:text-foreground cursor-pointer"
                    aria-label="添加参考图"
                  >
                    <ImagePlus className="h-3.5 w-3.5" />
                  </button>
                </TooltipTrigger>
                <TooltipContent>添加参考图（支持拖拽 / ⌘V）</TooltipContent>
              </Tooltip>

              {referenceImages.length > 0 && (
                <div className="flex items-center gap-1 shrink-0">
                  {referenceImages.slice(0, 3).map((ref, idx) => (
                    <div
                      key={ref.id}
                      className="group relative flex h-8 items-center gap-1 rounded-full popover-tile pl-1 pr-2 text-[11px]"
                    >
                      <button
                        type="button"
                        onClick={() =>
                          insertTokenIntoCompactInput(`图${idx + 1}`)
                        }
                        className="flex items-center gap-1 cursor-pointer"
                        title={`点击插入 @图${idx + 1}`}
                      >
                        <span className="relative h-6 w-6 overflow-hidden rounded-full bg-secondary shrink-0">
                          <img
                            src={ref.preview}
                            alt={`图${idx + 1}`}
                            className="h-full w-full object-cover"
                          />
                          {ref.uploading && (
                            <span className="absolute inset-0 flex items-center justify-center bg-black/55">
                              <Loader2 className="h-2.5 w-2.5 animate-spin text-white" />
                            </span>
                          )}
                        </span>
                        <span className="hidden sm:inline font-mono text-[10px] font-medium text-foreground">
                          @{idx + 1}
                        </span>
                      </button>
                      <button
                        type="button"
                        onClick={() => onRemoveRef(ref.id)}
                        className="ml-0.5 rounded-full p-0.5 text-muted-foreground hover:text-foreground cursor-pointer"
                        title="移除参考图"
                      >
                        <X className="h-2.5 w-2.5" />
                      </button>
                    </div>
                  ))}
                  {referenceImages.length > 3 && (
                    <button
                      type="button"
                      onClick={() => onChangeExpanded(true)}
                      className="h-7 rounded-full popover-tile-interactive px-2 font-mono text-[10px] font-medium text-muted-foreground hover:text-foreground cursor-pointer"
                    >
                      +{referenceImages.length - 3}
                    </button>
                  )}
                </div>
              )}

              {/* Center: Single-Line Live Prompt Input */}
              <input
                id="bottom-dock-prompt-input"
                ref={compactInputRef}
                type="text"
                value={prompt}
                onChange={(e) => onChangePrompt(e.target.value)}
                onKeyDown={(e) => {
                  if (e.nativeEvent.isComposing) return
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault()
                    if (!isSubmitting && !anyUploadingRef) {
                      onSubmitGenerate()
                    }
                  } else if (e.key === "Enter" && e.shiftKey) {
                    e.preventDefault()
                    onChangeExpanded(true)
                  }
                }}
                placeholder={
                  referenceImages.length > 0
                    ? "结合参考图描述画面，回车直接生成…"
                    : "继续输入灵感，回车直接生成…"
                }
                className="min-w-0 flex-1 bg-transparent px-2 text-[13.5px] text-foreground placeholder:text-muted-foreground/60 focus:outline-none"
              />

              {/* Right: Parameter Summary Expand Trigger + Generate CTA + Back to Top */}
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    type="button"
                    onClick={() => onChangeExpanded(true)}
                    className="hidden sm:inline-flex h-8 shrink-0 items-center gap-1 rounded-full popover-tile-interactive px-3 text-[11px] font-medium text-muted-foreground hover:text-foreground cursor-pointer"
                  >
                    <span className="font-mono max-w-[148px] truncate">
                      {compactSummary}
                    </span>
                    <ChevronUp className="h-3 w-3 opacity-75" />
                  </button>
                </TooltipTrigger>
                <TooltipContent>展开完整参数与多行编辑 (⌘J)</TooltipContent>
              </Tooltip>

              <button
                type="button"
                onClick={() => onChangeExpanded(true)}
                className="inline-flex sm:hidden h-8 w-8 shrink-0 items-center justify-center rounded-full popover-tile-interactive text-muted-foreground hover:text-foreground cursor-pointer"
                aria-label="展开创作面板"
              >
                <ChevronUp className="h-3.5 w-3.5" />
              </button>

              <Button
                type="button"
                disabled={isSubmitting || anyUploadingRef}
                onClick={(e) => {
                  animateShutterBtn(e.currentTarget)
                  onSubmitGenerate()
                }}
                className="h-8 shrink-0 rounded-full px-4 text-xs font-medium gap-1.5"
              >
                {(isSubmitting || anyUploadingRef) && (
                  <Loader2 className="h-3 w-3 animate-spin" />
                )}
                <span>
                  {anyUploadingRef
                    ? "准备中"
                    : isSubmitting
                    ? "提交中"
                    : batchCount > 1
                    ? `生成 ×${batchCount}`
                    : "生成"}
                </span>
              </Button>

              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    type="button"
                    onClick={onScrollToTop}
                    className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full popover-tile-interactive text-muted-foreground hover:text-foreground cursor-pointer"
                    aria-label="回到顶部"
                  >
                    <ArrowUp className="h-3.5 w-3.5" />
                  </button>
                </TooltipTrigger>
                <TooltipContent>回到顶部</TooltipContent>
              </Tooltip>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
