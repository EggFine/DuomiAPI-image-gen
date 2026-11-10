import React, { useRef } from "react"
import {
  Command,
  FolderOpen,
  LayoutPanelLeft,
  Moon,
  PanelTop,
  SlidersHorizontal,
  Sun,
} from "lucide-react"
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
import type { ComposerLayoutMode, StudioNavTab } from "@/types"

interface StudioRailProps {
  activeTab: StudioNavTab
  onSelectTab: (tab: StudioNavTab) => void
  layoutMode: ComposerLayoutMode
  onToggleLayoutMode: () => void
  activeQueueCount: number
  totalGalleryCount: number
  hasApiKey: boolean
  sseConnected: boolean
  theme: "dark" | "light"
  onToggleTheme: () => void
  onOpenCommandPalette: () => void
  onOpenLocalFolder: () => void
  onOpenSettings: (tab?: string) => void
}

const NAV_ITEMS: Array<{
  id: StudioNavTab
  label: string
  shortcut: string
}> = [
  { id: "imagine", label: "创作", shortcut: "1" },
  { id: "gallery", label: "画册", shortcut: "2" },
  { id: "recipes", label: "配方", shortcut: "3" },
  { id: "analytics", label: "状态", shortcut: "4" },
]

export const StudioRail: React.FC<StudioRailProps> = ({
  activeTab,
  onSelectTab,
  layoutMode,
  onToggleLayoutMode,
  activeQueueCount,
  hasApiKey,
  sseConnected,
  theme,
  onToggleTheme,
  onOpenCommandPalette,
  onOpenLocalFolder,
  onOpenSettings,
}) => {
  const headerRef = useRef<HTMLElement | null>(null)
  const navIndicatorRef = useRef<HTMLDivElement | null>(null)
  const mobileIndicatorRef = useRef<HTMLDivElement | null>(null)
  const btnRefs = useRef<Record<string, HTMLButtonElement | null>>({})
  const mobileBtnRefs = useRef<Record<string, HTMLButtonElement | null>>({})
  const themeIconRef = useRef<HTMLSpanElement | null>(null)
  const initializedDesktopRef = useRef<boolean>(false)
  const initializedMobileRef = useRef<boolean>(false)
  const mountedThemeRef = useRef<boolean>(false)

  // Liquid Apple Segmented Pill glide (Desktop top bar + Mobile floating capsule)
  useGSAP(
    () => {
      const reduced = prefersReducedMotion()

      const indicator = navIndicatorRef.current
      const activeBtn = btnRefs.current[activeTab]
      if (indicator && activeBtn && activeBtn.offsetWidth > 0) {
        const targetX = activeBtn.offsetLeft
        const targetW = activeBtn.offsetWidth
        if (!initializedDesktopRef.current || reduced) {
          initializedDesktopRef.current = true
          gsap.set(indicator, { x: targetX, width: targetW, autoAlpha: 1 })
        } else {
          gsap.to(indicator, {
            x: targetX,
            width: targetW,
            autoAlpha: 1,
            duration: 0.38,
            ease: STUDIO_EASE.expo,
            overwrite: "auto",
          })
        }
      }

      const mIndicator = mobileIndicatorRef.current
      const mBtn = mobileBtnRefs.current[activeTab]
      if (mIndicator && mBtn && mBtn.offsetWidth > 0) {
        const targetX = mBtn.offsetLeft
        const targetW = mBtn.offsetWidth
        if (!initializedMobileRef.current || reduced) {
          initializedMobileRef.current = true
          gsap.set(mIndicator, { x: targetX, width: targetW, autoAlpha: 1 })
        } else {
          gsap.to(mIndicator, {
            x: targetX,
            width: targetW,
            autoAlpha: 1,
            duration: 0.36,
            ease: STUDIO_EASE.expo,
            overwrite: "auto",
          })
        }
      }
    },
    { dependencies: [activeTab] }
  )

  // Calm, weightless cross-settle on theme switch (zero cartoon spin)
  useGSAP(
    () => {
      if (!mountedThemeRef.current) {
        mountedThemeRef.current = true
        return
      }
      if (prefersReducedMotion() || !themeIconRef.current) return
      gsap.fromTo(
        themeIconRef.current,
        { scale: 0.86, autoAlpha: 0.25 },
        {
          scale: 1,
          autoAlpha: 1,
          duration: 0.3,
          ease: STUDIO_EASE.out,
          overwrite: "auto",
          clearProps: "transform,opacity,visibility",
        }
      )
    },
    { dependencies: [theme] }
  )

  return (
    <>
      {/* Unified Borderless Apple Top Bar */}
      <header
        ref={headerRef}
        aria-label="工作区导航"
        className="flex h-14 shrink-0 items-center justify-between bg-background/80 backdrop-blur-2xl px-5 sm:px-8 select-none z-30"
      >
        {/* Left: Quiet Wordmark & Subtle Live Status */}
        <div className="flex items-center gap-3 min-w-[110px] sm:min-w-[160px]">
          <button
            type="button"
            onClick={() => onSelectTab("imagine")}
            className="inline-flex items-center gap-2 text-[15px] font-semibold tracking-[-0.025em] text-foreground transition-opacity hover:opacity-75 cursor-pointer"
          >
            <span>Duomi</span>
            <span
              className={cn(
                "h-1.5 w-1.5 rounded-full transition-colors",
                !hasApiKey
                  ? "bg-amber-500"
                  : sseConnected
                  ? "bg-emerald-500"
                  : "bg-muted-foreground/40"
              )}
              title={
                !hasApiKey
                  ? "待配置密钥"
                  : sseConnected
                  ? "实时引擎已连接"
                  : "连接中"
              }
            />
          </button>

          {activeQueueCount > 0 && (
            <span className="inline-flex items-center gap-1.5 rounded-full bg-foreground/[0.05] px-2.5 py-0.5 text-[11px] font-medium text-muted-foreground tabular-nums">
              <span className="h-1.5 w-1.5 rounded-full bg-foreground animate-pulse" />
              <span>生成中 {activeQueueCount}</span>
            </span>
          )}
        </div>

        {/* Center: Desktop Apple Segmented Pill Bar */}
        <nav
          aria-label="主视图切换"
          className="hidden md:flex relative items-center rounded-full bg-foreground/[0.048] dark:bg-white/[0.06] p-1"
        >
          <div
            ref={navIndicatorRef}
            style={{ opacity: 0 }}
            className="pointer-events-none absolute top-1 bottom-1 left-0 rounded-full bg-card shadow-[0_1px_4px_rgba(0,0,0,0.08)] dark:bg-white/[0.14]"
          />

          {NAV_ITEMS.map((item) => {
            const isActive = activeTab === item.id
            return (
              <button
                key={item.id}
                ref={(el) => {
                  btnRefs.current[item.id] = el
                }}
                id={`rail-nav-${item.id}`}
                type="button"
                onClick={() => onSelectTab(item.id)}
                className={cn(
                  "relative z-10 rounded-full px-4 py-1 text-[13px] font-medium transition-colors duration-200 cursor-pointer",
                  isActive
                    ? "text-foreground"
                    : "text-muted-foreground hover:text-foreground"
                )}
              >
                {item.label}
              </button>
            )
          })}
        </nav>

        {/* Right: Minimalist Monochrome Icon Actions */}
        <div className="flex items-center justify-end gap-1 min-w-[110px] sm:min-w-[160px]">
          {activeTab === "imagine" && (
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  id="btn-toggle-studio-layout"
                  type="button"
                  onClick={onToggleLayoutMode}
                  className="hidden sm:flex h-8 w-8 items-center justify-center rounded-full text-muted-foreground hover:bg-foreground/[0.055] hover:text-foreground transition-colors cursor-pointer"
                  aria-label="切换布局"
                >
                  {layoutMode === "omnibar" ? (
                    <LayoutPanelLeft className="h-4 w-4" />
                  ) : (
                    <PanelTop className="h-4 w-4" />
                  )}
                </button>
              </TooltipTrigger>
              <TooltipContent>
                {layoutMode === "omnibar" ? "双栏视图" : "沉浸视图"}
              </TooltipContent>
            </Tooltip>
          )}

          <Tooltip>
            <TooltipTrigger asChild>
              <button
                id="btn-open-command-palette"
                type="button"
                onClick={onOpenCommandPalette}
                className="flex h-8 w-8 items-center justify-center rounded-full text-muted-foreground hover:bg-foreground/[0.055] hover:text-foreground transition-colors cursor-pointer"
                aria-label="快捷指令"
              >
                <Command className="h-4 w-4" />
              </button>
            </TooltipTrigger>
            <TooltipContent className="flex items-center gap-1.5">
              <span>指令</span>
              <kbd className="studio-kbd">⌘K</kbd>
            </TooltipContent>
          </Tooltip>

          <Tooltip>
            <TooltipTrigger asChild>
              <button
                id="btn-rail-open-folder"
                type="button"
                onClick={onOpenLocalFolder}
                className="hidden sm:flex h-8 w-8 items-center justify-center rounded-full text-muted-foreground hover:bg-foreground/[0.055] hover:text-foreground transition-colors cursor-pointer"
                aria-label="本地目录"
              >
                <FolderOpen className="h-4 w-4" />
              </button>
            </TooltipTrigger>
            <TooltipContent>本地目录</TooltipContent>
          </Tooltip>

          <Tooltip>
            <TooltipTrigger asChild>
              <button
                id="btn-rail-theme"
                type="button"
                onClick={onToggleTheme}
                className="flex h-8 w-8 items-center justify-center rounded-full text-muted-foreground hover:bg-foreground/[0.055] hover:text-foreground transition-colors cursor-pointer"
                aria-label="切换主题"
              >
                <span ref={themeIconRef} className="inline-flex">
                  {theme === "dark" ? (
                    <Sun className="h-4 w-4" />
                  ) : (
                    <Moon className="h-4 w-4" />
                  )}
                </span>
              </button>
            </TooltipTrigger>
            <TooltipContent>
              {theme === "dark" ? "浅色外观" : "深色外观"}
            </TooltipContent>
          </Tooltip>

          <Tooltip>
            <TooltipTrigger asChild>
              <button
                id="btn-open-config-modal"
                type="button"
                onClick={() => onOpenSettings("api")}
                className={cn(
                  "relative flex h-8 items-center justify-center gap-1.5 rounded-full transition-colors cursor-pointer",
                  hasApiKey
                    ? "w-8 text-muted-foreground hover:bg-foreground/[0.055] hover:text-foreground"
                    : "bg-primary px-3 text-xs font-medium text-primary-foreground hover:opacity-90"
                )}
                aria-label="设置"
              >
                <SlidersHorizontal className="h-3.5 w-3.5" />
                {!hasApiKey && <span>配置密钥</span>}
              </button>
            </TooltipTrigger>
            <TooltipContent>设置</TooltipContent>
          </Tooltip>
        </div>
      </header>

      {/* Mobile Floating Frosted Segmented Capsule */}
      <nav
        aria-label="移动端底部导航"
        className="md:hidden fixed bottom-4 left-1/2 -translate-x-1/2 z-40 flex items-center rounded-full studio-omnibar p-1"
      >
        <div
          ref={mobileIndicatorRef}
          style={{ opacity: 0, visibility: "hidden" }}
          className="pointer-events-none absolute top-1 bottom-1 left-0 rounded-full bg-foreground/[0.09] dark:bg-white/[0.15]"
        />
        {NAV_ITEMS.map((item) => {
          const isActive = activeTab === item.id
          return (
            <button
              key={item.id}
              ref={(el) => {
                mobileBtnRefs.current[item.id] = el
              }}
              type="button"
              onClick={() => onSelectTab(item.id)}
              className={cn(
                "relative z-10 rounded-full px-4 py-1.5 text-xs font-medium transition-colors cursor-pointer",
                isActive ? "text-foreground" : "text-muted-foreground"
              )}
            >
              {item.label}
            </button>
          )
        })}
      </nav>
    </>
  )
}
