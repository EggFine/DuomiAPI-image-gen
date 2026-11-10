import React, { useEffect, useMemo, useRef, useState } from "react"
import {
  Activity,
  Archive,
  Code2,
  Compass,
  FolderOpen,
  Images,
  KeyRound,
  LayoutPanelLeft,
  Moon,
  PanelTop,
  Search,
  Sparkles,
  Sun,
  Wand2,
} from "lucide-react"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  gsap,
  prefersReducedMotion,
  STUDIO_EASE,
  useGSAP,
} from "@/lib/motion"
import { cn } from "@/lib/utils"
import type {
  ComposerLayoutMode,
  ModelInfo,
  PromptTemplate,
  StudioNavTab,
} from "@/types"

interface CommandAction {
  id: string
  group: string
  title: string
  subtitle?: string
  shortcut?: string
  icon: React.ComponentType<{ className?: string }>
  run: () => void
}

interface CommandPaletteModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onSelectTab: (tab: StudioNavTab) => void
  layoutMode: ComposerLayoutMode
  onToggleLayoutMode: () => void
  theme: "dark" | "light"
  onToggleTheme: () => void
  models: ModelInfo[]
  onSelectModel: (id: string) => void
  recipes: PromptTemplate[]
  onUseRecipe: (tpl: PromptTemplate) => void
  onOpenZenWorkbench: () => void
  onOpenSettings: (tab?: string) => void
  onOpenImportTask: () => void
  onOpenDevPreview: () => void
  onOpenLocalFolder: () => void
}

export const CommandPaletteModal: React.FC<CommandPaletteModalProps> = ({
  open,
  onOpenChange,
  onSelectTab,
  layoutMode,
  onToggleLayoutMode,
  theme,
  onToggleTheme,
  models,
  onSelectModel,
  recipes,
  onUseRecipe,
  onOpenZenWorkbench,
  onOpenSettings,
  onOpenImportTask,
  onOpenDevPreview,
  onOpenLocalFolder,
}) => {
  const inputRef = useRef<HTMLInputElement | null>(null)
  const listRef = useRef<HTMLDivElement | null>(null)
  const [query, setQuery] = useState<string>("")
  const [activeIndex, setActiveIndex] = useState<number>(0)

  useEffect(() => {
    if (open) {
      setQuery("")
      setActiveIndex(0)
      requestAnimationFrame(() => inputRef.current?.focus())
    }
  }, [open])

  useGSAP(
    () => {
      if (!open || prefersReducedMotion() || !listRef.current) return
      const items = gsap.utils
        .toArray<HTMLElement>(".cmd-palette-item", listRef.current)
        .slice(0, 14)
      if (items.length === 0) return
      gsap.fromTo(
        items,
        { autoAlpha: 0, y: 4 },
        {
          autoAlpha: 1,
          y: 0,
          duration: 0.24,
          stagger: 0.012,
          ease: STUDIO_EASE.out,
          clearProps: "transform,opacity,visibility",
        }
      )
    },
    { scope: listRef, dependencies: [open] }
  )

  const allCommands = useMemo<CommandAction[]>(() => {
    const closeAnd = (fn: () => void) => () => {
      onOpenChange(false)
      fn()
    }

    const base: CommandAction[] = [
      {
        id: "nav-imagine",
        group: "导航",
        title: "创作",
        shortcut: "⌥1",
        icon: Sparkles,
        run: closeAnd(() => onSelectTab("imagine")),
      },
      {
        id: "nav-gallery",
        group: "导航",
        title: "画册",
        shortcut: "⌥2",
        icon: Images,
        run: closeAnd(() => onSelectTab("gallery")),
      },
      {
        id: "nav-recipes",
        group: "导航",
        title: "配方",
        shortcut: "⌥3",
        icon: Compass,
        run: closeAnd(() => onSelectTab("recipes")),
      },
      {
        id: "nav-analytics",
        group: "导航",
        title: "状态",
        shortcut: "⌥4",
        icon: Activity,
        run: closeAnd(() => onSelectTab("analytics")),
      },
      {
        id: "tool-zen",
        group: "工具",
        title: "沉浸长文工作台",
        icon: Wand2,
        run: closeAnd(onOpenZenWorkbench),
      },
      {
        id: "tool-layout",
        group: "工具",
        title: layoutMode === "omnibar" ? "切换为双栏视图" : "切换为沉浸视图",
        icon: layoutMode === "omnibar" ? LayoutPanelLeft : PanelTop,
        run: closeAnd(onToggleLayoutMode),
      },
      {
        id: "tool-theme",
        group: "工具",
        title: theme === "dark" ? "切换为浅色外观" : "切换为深色外观",
        icon: theme === "dark" ? Sun : Moon,
        run: closeAnd(onToggleTheme),
      },
      {
        id: "sys-key",
        group: "系统",
        title: "设置与 API 密钥",
        icon: KeyRound,
        run: closeAnd(() => onOpenSettings("api")),
      },
      {
        id: "sys-import",
        group: "系统",
        title: "查询历史任务 ID",
        icon: Search,
        run: closeAnd(onOpenImportTask),
      },
      {
        id: "sys-dev",
        group: "系统",
        title: "查看请求代码预览",
        icon: Code2,
        run: closeAnd(onOpenDevPreview),
      },
      {
        id: "sys-folder",
        group: "系统",
        title: "打开本地数据目录",
        icon: FolderOpen,
        run: closeAnd(onOpenLocalFolder),
      },
      {
        id: "sys-zip",
        group: "系统",
        title: "打包导出全部原图 (.zip)",
        icon: Archive,
        run: closeAnd(() => {
          window.location.href = "/api/records/export-zip"
        }),
      },
    ]

    const modelCmds: CommandAction[] = models.map((m) => ({
      id: `model-${m.id}`,
      group: "模型",
      title: m.name,
      subtitle: `${m.badge} · ${m.price}`,
      icon: Sparkles,
      run: closeAnd(() => {
        onSelectModel(m.id)
        onSelectTab("imagine")
      }),
    }))

    const recipeCmds: CommandAction[] = recipes.slice(0, 8).map((r) => ({
      id: `recipe-${r.id}`,
      group: "配方",
      title: r.title,
      subtitle: r.category,
      icon: Compass,
      run: closeAnd(() => onUseRecipe(r)),
    }))

    return [...base, ...modelCmds, ...recipeCmds]
  }, [
    layoutMode,
    models,
    onOpenChange,
    onOpenDevPreview,
    onOpenImportTask,
    onOpenLocalFolder,
    onOpenSettings,
    onOpenZenWorkbench,
    onSelectModel,
    onSelectTab,
    onToggleLayoutMode,
    onToggleTheme,
    onUseRecipe,
    recipes,
    theme,
  ])

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return allCommands
    return allCommands.filter(
      (c) =>
        c.title.toLowerCase().includes(q) ||
        c.group.toLowerCase().includes(q) ||
        (c.subtitle || "").toLowerCase().includes(q)
    )
  }, [allCommands, query])

  useEffect(() => {
    setActiveIndex(0)
  }, [query])

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") {
      e.preventDefault()
      setActiveIndex((prev) =>
        filtered.length > 0 ? (prev + 1) % filtered.length : 0
      )
    } else if (e.key === "ArrowUp") {
      e.preventDefault()
      setActiveIndex((prev) =>
        filtered.length > 0
          ? (prev - 1 + filtered.length) % filtered.length
          : 0
      )
    } else if (e.key === "Enter" && filtered[activeIndex]) {
      e.preventDefault()
      filtered[activeIndex].run()
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg p-2.5 overflow-hidden top-[40%]">
        <DialogTitle className="sr-only">搜索与快捷操作</DialogTitle>
        <DialogDescription className="sr-only">
          快速跳转页面、切换模型或套用配方
        </DialogDescription>

        {/* Spotlight Search Input (Solid Tile) */}
        <div className="flex items-center gap-3 rounded-2xl popover-tile px-3.5 py-2.5 mr-9">
          <Search className="h-4 w-4 text-muted-foreground shrink-0" />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="搜索功能、模型或配方..."
            className="flex-1 bg-transparent text-sm text-foreground placeholder:text-muted-foreground/65 focus:outline-none"
          />
        </div>

        {/* Results */}
        <div
          ref={listRef}
          className="max-h-[360px] overflow-y-auto pt-1 studio-scroll"
        >
          {filtered.length === 0 ? (
            <div className="py-10 text-center text-xs text-muted-foreground">
              无匹配项
            </div>
          ) : (
            filtered.map((cmd, idx) => {
              const Icon = cmd.icon
              const selected = idx === activeIndex
              const prevGroup = idx > 0 ? filtered[idx - 1].group : ""
              const showGroupHeader = cmd.group !== prevGroup

              return (
                <React.Fragment key={cmd.id}>
                  {showGroupHeader && (
                    <div className="px-3 pt-3 pb-1 text-[11px] font-medium text-muted-foreground">
                      {cmd.group}
                    </div>
                  )}
                  <button
                    type="button"
                    onMouseEnter={() => setActiveIndex(idx)}
                    onClick={cmd.run}
                    className={cn(
                      "cmd-palette-item flex w-full items-center justify-between gap-3 rounded-2xl px-3 py-2 text-left transition-colors cursor-pointer",
                      selected
                        ? "bg-foreground/[0.07] dark:bg-white/[0.1] text-foreground"
                        : "text-foreground/85 hover:bg-foreground/[0.04]"
                    )}
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      <div
                        className={cn(
                          "flex h-7 w-7 shrink-0 items-center justify-center rounded-full transition-colors",
                          selected
                            ? "bg-primary text-primary-foreground"
                            : "bg-foreground/[0.05] text-muted-foreground"
                        )}
                      >
                        <Icon className="h-3.5 w-3.5" />
                      </div>
                      <div className="flex items-center gap-2 min-w-0">
                        <span className="text-xs font-medium truncate">
                          {cmd.title}
                        </span>
                        {cmd.subtitle && (
                          <span className="text-[11px] text-muted-foreground truncate">
                            {cmd.subtitle}
                          </span>
                        )}
                      </div>
                    </div>

                    {cmd.shortcut && (
                      <span className="font-mono text-[11px] text-muted-foreground shrink-0">
                        {cmd.shortcut}
                      </span>
                    )}
                  </button>
                </React.Fragment>
              )
            })
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}
