import React, { useLayoutEffect, useRef } from "react"
import {
  Activity,
  Command,
  Compass,
  FolderOpen,
  Images,
  KeyRound,
  LayoutPanelLeft,
  Moon,
  PanelTop,
  Sparkles,
  Sun,
} from "lucide-react"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import { gsap, prefersReducedMotion, STUDIO_EASE, useGSAP } from "@/lib/motion"
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
  short: string
  icon: React.ComponentType<{ className?: string }>
  shortcut: string
}> = [
  {
    id: "imagine",
    label: "创作工作台 (Imagine)",
    short: "创作",
    icon: Sparkles,
    shortcut: "1",
  },
  {
    id: "gallery",
    label: "作品资产与画册 (Assets)",
    short: "画册",
    icon: Images,
    shortcut: "2",
  },
  {
    id: "recipes",
    label: "灵感配方广场 (Recipes)",
    short: "灵感",
    icon: Compass,
    shortcut: "3",
  },
  {
    id: "analytics",
    label: "队列监控与存储管家 (Telemetry)",
    short: "看板",
    icon: Activity,
    shortcut: "4",
  },
]

export const StudioRail: React.FC<StudioRailProps> = ({
  activeTab,
  onSelectTab,
  layoutMode,
  onToggleLayoutMode,
  activeQueueCount,
  totalGalleryCount,
  hasApiKey,
  sseConnected,
  theme,
  onToggleTheme,
  onOpenCommandPalette,
  onOpenLocalFolder,
  onOpenSettings,
}) => {
  const railRef = useRef<HTMLElement | null>(null)
  const navIndicatorRef = useRef<HTMLDivElement | null>(null)
  const btnRefs = useRef<Record<string, HTMLButtonElement | null>>({})
  const iconRefs = useRef<Record<string, HTMLSpanElement | null>>({})
  const themeIconRef = useRef<HTMLSpanElement | null>(null)
  const initializedIndicatorRef = useRef<boolean>(false)
  const mountedThemeRef = useRef<boolean>(false)

  // Subtle initial studio rail entrance
  useGSAP(
    () => {
      if (prefersReducedMotion()) return
      gsap.fromTo(
        ".rail-stagger-item",
        { opacity: 0, x: -6 },
        {
          opacity: 1,
          x: 0,
          duration: 0.34,
          stagger: 0.03,
          ease: STUDIO_EASE.out,
          clearProps: "transform,opacity",
        }
      )
    },
    { scope: railRef }
  )

  // Liquid sliding active tab pill + active icon micro-spring
  useLayoutEffect(() => {
    const indicator = navIndicatorRef.current
    const activeBtn = btnRefs.current[activeTab]
    if (!indicator || !activeBtn) return

    const targetY = activeBtn.offsetTop
    const targetH = activeBtn.offsetHeight

    if (!initializedIndicatorRef.current || prefersReducedMotion()) {
      initializedIndicatorRef.current = true
      gsap.set(indicator, { y: targetY, height: targetH, opacity: 1 })
      return
    }

    gsap.to(indicator, {
      y: targetY,
      height: targetH,
      opacity: 1,
      duration: 0.34,
      ease: STUDIO_EASE.expo,
      overwrite: "auto",
    })

    const iconWrap = iconRefs.current[activeTab]
    if (iconWrap) {
      gsap.fromTo(
        iconWrap,
        { scale: 0.82, y: 1.5 },
        {
          scale: 1,
          y: 0,
          duration: 0.32,
          ease: STUDIO_EASE.spring,
          clearProps: "transform",
        }
      )
    }
  }, [activeTab])

  // Tactile celestial spin when toggling Darkroom / Paper theme
  useLayoutEffect(() => {
    if (!mountedThemeRef.current) {
      mountedThemeRef.current = true
      return
    }
    if (prefersReducedMotion() || !themeIconRef.current) return
    gsap.fromTo(
      themeIconRef.current,
      { rotate: -72, scale: 0.72, opacity: 0.4 },
      {
        rotate: 0,
        scale: 1,
        opacity: 1,
        duration: 0.38,
        ease: STUDIO_EASE.spring,
        clearProps: "transform,opacity",
      }
    )
  }, [theme])

  return (
    <>
      {/* Desktop Left Vertical Studio Rail */}
      <aside
        ref={railRef}
        aria-label="主工作区导航栏"
        className="hidden md:flex w-[64px] shrink-0 flex-col items-center justify-between border-r border-border studio-rail py-3.5 select-none z-30"
      >
        {/* Top Brand Aperture Emblem */}
        <div className="flex flex-col items-center gap-3 w-full">
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                onClick={() => onSelectTab("imagine")}
                className="rail-stagger-item group relative flex h-10 w-10 items-center justify-center rounded-2xl bg-zinc-900 dark:bg-zinc-100 text-zinc-50 dark:text-zinc-950 shadow-sm transition-transform hover:scale-[1.04] active:scale-95 cursor-pointer"
                aria-label="Duomi Studio Pro"
              >
                <span className="font-mono text-sm font-bold tracking-tighter">
                  DM
                </span>
                <span
                  className={cn(
                    "absolute -right-0.5 -bottom-0.5 h-2.5 w-2.5 rounded-full ring-2 ring-background",
                    sseConnected ? "bg-emerald-500" : "bg-amber-500"
                  )}
                />
              </button>
            </TooltipTrigger>
            <TooltipContent side="right">
              <p className="font-semibold">Duomi Studio Pro v3.1</p>
              <p className="text-[11px] text-muted-foreground">
                单文件纯绿色架构 ·{" "}
                {sseConnected ? "SSE 实时引擎已连接" : "自动轮询重连中"}
              </p>
            </TooltipContent>
          </Tooltip>

          <div className="h-px w-7 bg-border/80" />

          {/* Primary Workspace Switcher with Liquid Sliding GSAP Pill */}
          <nav className="relative flex flex-col items-center gap-1.5 w-full px-2">
            <div
              ref={navIndicatorRef}
              style={{ opacity: 0 }}
              className="pointer-events-none absolute left-2 right-2 top-0 rounded-xl bg-card shadow-2xs ring-1 ring-border"
            >
              <span className="absolute left-0 top-1/2 -translate-y-1/2 h-5 w-[3px] rounded-r-full bg-amber-500" />
            </div>

            {NAV_ITEMS.map((item) => {
              const Icon = item.icon
              const isActive = activeTab === item.id
              return (
                <Tooltip key={item.id}>
                  <TooltipTrigger asChild>
                    <button
                      ref={(el) => {
                        btnRefs.current[item.id] = el
                      }}
                      id={`rail-nav-${item.id}`}
                      type="button"
                      onClick={() => onSelectTab(item.id)}
                      className={cn(
                        "rail-stagger-item relative z-10 flex flex-col items-center justify-center w-full py-2 rounded-xl transition-colors cursor-pointer group",
                        isActive
                          ? "text-foreground"
                          : "text-muted-foreground hover:text-foreground hover:bg-card/45"
                      )}
                    >
                      <span
                        ref={(el) => {
                          iconRefs.current[item.id] = el
                        }}
                        className="inline-flex"
                      >
                        <Icon
                          className={cn(
                            "h-[18px] w-[18px] transition-transform duration-150 group-hover:scale-105",
                            isActive && "text-amber-500"
                          )}
                        />
                      </span>
                      <span className="mt-1 text-[10px] font-medium leading-none">
                        {item.short}
                      </span>

                      {item.id === "imagine" && activeQueueCount > 0 && (
                        <span className="absolute right-1.5 top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-amber-500 px-1 font-mono text-[9px] font-bold text-zinc-950">
                          {activeQueueCount}
                        </span>
                      )}
                      {item.id === "gallery" &&
                        totalGalleryCount > 0 &&
                        !isActive && (
                          <span className="absolute right-1.5 top-1.5 h-1.5 w-1.5 rounded-full bg-muted-foreground/45" />
                        )}
                    </button>
                  </TooltipTrigger>
                  <TooltipContent side="right" className="flex items-center gap-2">
                    <span>{item.label}</span>
                    <kbd className="studio-kbd">Alt+{item.shortcut}</kbd>
                  </TooltipContent>
                </Tooltip>
              )
            })}
          </nav>
        </div>

        {/* Bottom Studio Controls */}
        <div className="flex flex-col items-center gap-1.5 w-full px-2">
          {/* Layout Mode Switcher (Omnibar Floating vs Pro Split) */}
          {activeTab === "imagine" && (
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  id="btn-toggle-studio-layout"
                  type="button"
                  onClick={onToggleLayoutMode}
                  className="rail-stagger-item flex h-9 w-9 items-center justify-center rounded-xl text-muted-foreground hover:bg-card hover:text-foreground transition-colors cursor-pointer"
                >
                  {layoutMode === "omnibar" ? (
                    <PanelTop className="h-4 w-4 text-amber-500" />
                  ) : (
                    <LayoutPanelLeft className="h-4 w-4 text-amber-500" />
                  )}
                </button>
              </TooltipTrigger>
              <TooltipContent side="right">
                <p className="font-medium">
                  当前布局：
                  {layoutMode === "omnibar"
                    ? "沉浸创作流模式（对标即梦/MJ）"
                    : "专业双栏检查器模式（对标 Leonardo）"}
                </p>
                <p className="text-[11px] text-muted-foreground">
                  点击一键切换工作台形态
                </p>
              </TooltipContent>
            </Tooltip>
          )}

          {/* Command Palette Trigger */}
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                id="btn-open-command-palette"
                type="button"
                onClick={onOpenCommandPalette}
                className="rail-stagger-item flex h-9 w-9 items-center justify-center rounded-xl text-muted-foreground hover:bg-card hover:text-foreground transition-colors cursor-pointer"
              >
                <Command className="h-4 w-4" />
              </button>
            </TooltipTrigger>
            <TooltipContent side="right" className="flex items-center gap-2">
              <span>全局快捷命令面板</span>
              <kbd className="studio-kbd">Ctrl+K</kbd>
            </TooltipContent>
          </Tooltip>

          {/* Open Local Portable Data Folder */}
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                id="btn-rail-open-folder"
                type="button"
                onClick={onOpenLocalFolder}
                className="rail-stagger-item flex h-9 w-9 items-center justify-center rounded-xl text-muted-foreground hover:bg-card hover:text-foreground transition-colors cursor-pointer"
              >
                <FolderOpen className="h-4 w-4" />
              </button>
            </TooltipTrigger>
            <TooltipContent side="right">
              打开本地绿色图库目录 (duomi_data/images)
            </TooltipContent>
          </Tooltip>

          {/* Darkroom / Paper Theme Toggle */}
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                id="btn-rail-theme"
                type="button"
                onClick={onToggleTheme}
                className="rail-stagger-item flex h-9 w-9 items-center justify-center rounded-xl text-muted-foreground hover:bg-card hover:text-foreground transition-colors cursor-pointer"
              >
                <span ref={themeIconRef} className="inline-flex">
                  {theme === "dark" ? (
                    <Sun className="h-4 w-4 text-amber-400" />
                  ) : (
                    <Moon className="h-4 w-4" />
                  )}
                </span>
              </button>
            </TooltipTrigger>
            <TooltipContent side="right">
              切换为{theme === "dark" ? "美术馆浅色 (Paper)" : "专业暗房深色 (Darkroom)"}
            </TooltipContent>
          </Tooltip>

          {/* API Key & Settings */}
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                id="btn-rail-settings"
                type="button"
                onClick={() => onOpenSettings("api")}
                className={cn(
                  "relative flex h-9 w-9 items-center justify-center rounded-xl transition-colors cursor-pointer",
                  hasApiKey
                    ? "text-muted-foreground hover:bg-card hover:text-foreground"
                    : "bg-amber-500/15 text-amber-500 ring-1 ring-amber-500/40"
                )}
              >
                <KeyRound className="h-4 w-4" />
                {!hasApiKey && (
                  <span className="absolute right-1.5 top-1.5 h-2 w-2 rounded-full bg-amber-500 animate-ping" />
                )}
              </button>
            </TooltipTrigger>
            <TooltipContent side="right">
              {hasApiKey
                ? "系统设置 · API 连通性测速 · 图床配置"
                : "未配置多米 API Key（点击立即配置）"}
            </TooltipContent>
          </Tooltip>
        </div>
      </aside>

      {/* Mobile Bottom Navigation Bar */}
      <nav
        aria-label="移动端底部导航"
        className="md:hidden fixed inset-x-0 bottom-0 z-40 flex items-center justify-around border-t border-border bg-card/95 backdrop-blur-lg px-2 py-1.5"
      >
        {NAV_ITEMS.map((item) => {
          const Icon = item.icon
          const isActive = activeTab === item.id
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => onSelectTab(item.id)}
              className={cn(
                "flex flex-col items-center justify-center px-3 py-1 rounded-lg text-[11px] font-medium cursor-pointer",
                isActive ? "text-amber-500" : "text-muted-foreground"
              )}
            >
              <Icon className="h-4 w-4" />
              <span className="mt-0.5">{item.short}</span>
            </button>
          )
        })}
        <button
          type="button"
          onClick={() => onOpenSettings("api")}
          className={cn(
            "flex flex-col items-center justify-center px-3 py-1 rounded-lg text-[11px] font-medium cursor-pointer",
            !hasApiKey ? "text-amber-500" : "text-muted-foreground"
          )}
        >
          <KeyRound className="h-4 w-4" />
          <span className="mt-0.5">设置</span>
        </button>
      </nav>
    </>
  )
}
