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
  const [query, setQuery] = useState<string>("")
  const [activeIndex, setActiveIndex] = useState<number>(0)

  useEffect(() => {
    if (open) {
      setQuery("")
      setActiveIndex(0)
      requestAnimationFrame(() => inputRef.current?.focus())
    }
  }, [open])

  const allCommands = useMemo<CommandAction[]>(() => {
    const closeAnd = (fn: () => void) => () => {
      onOpenChange(false)
      fn()
    }

    const base: CommandAction[] = [
      {
        id: "nav-imagine",
        group: "工作区导航",
        title: "前往 创作工作台 (Imagine)",
        subtitle: "悬浮灵感舱 + 原生比例瀑布流画廊",
        shortcut: "Alt+1",
        icon: Sparkles,
        run: closeAnd(() => onSelectTab("imagine")),
      },
      {
        id: "nav-gallery",
        group: "工作区导航",
        title: "前往 作品资产与项目画册 (Assets)",
        subtitle: "按项目画册分类整理、筛选与批量导出",
        shortcut: "Alt+2",
        icon: Images,
        run: closeAnd(() => onSelectTab("gallery")),
      },
      {
        id: "nav-recipes",
        group: "工作区导航",
        title: "前往 灵感配方广场 (Recipes)",
        subtitle: "一键套用精选多人物写实、电商静物与 3D 贴纸配方",
        shortcut: "Alt+3",
        icon: Compass,
        run: closeAnd(() => onSelectTab("recipes")),
      },
      {
        id: "nav-analytics",
        group: "工作区导航",
        title: "前往 队列监控与存储管家 (Telemetry)",
        subtitle: "查看生成速度统计与 duomi_data 磁盘缓存清理",
        shortcut: "Alt+4",
        icon: Activity,
        run: closeAnd(() => onSelectTab("analytics")),
      },
      {
        id: "tool-zen",
        group: "专业创作工具",
        title: "打开 结构化提示词工程台 (Prompt Architect)",
        subtitle: "双栏大屏编写长提示词、插入镜头焦段与空间透视护栏",
        icon: Wand2,
        run: closeAnd(onOpenZenWorkbench),
      },
      {
        id: "tool-layout",
        group: "专业创作工具",
        title:
          layoutMode === "omnibar"
            ? "切换为 专业双栏参数台模式 (Split Pro)"
            : "切换为 沉浸式悬浮灵感舱模式 (Omnibar)",
        subtitle: "随时在即梦式悬浮顶栏与固定左侧面板间切换",
        icon: layoutMode === "omnibar" ? LayoutPanelLeft : PanelTop,
        run: closeAnd(onToggleLayoutMode),
      },
      {
        id: "tool-theme",
        group: "专业创作工具",
        title:
          theme === "dark"
            ? "切换为 美术馆宣纸浅色外观 (Light)"
            : "切换为 电影暗房深色外观 (Darkroom)",
        icon: theme === "dark" ? Sun : Moon,
        run: closeAnd(onToggleTheme),
      },
      {
        id: "sys-key",
        group: "系统与存储",
        title: "配置 多米 API 密钥与参考图图床策略",
        icon: KeyRound,
        run: closeAnd(() => onOpenSettings("api")),
      },
      {
        id: "sys-import",
        group: "系统与存储",
        title: "按 Task ID 查询并归档历史异步任务",
        icon: Search,
        run: closeAnd(onOpenImportTask),
      },
      {
        id: "sys-dev",
        group: "系统与存储",
        title: "查看当前请求 JSON / cURL / CLI 命令预览",
        icon: Code2,
        run: closeAnd(onOpenDevPreview),
      },
      {
        id: "sys-folder",
        group: "系统与存储",
        title: "打开本地便携数据目录 (duomi_data/)",
        icon: FolderOpen,
        run: closeAnd(onOpenLocalFolder),
      },
      {
        id: "sys-zip",
        group: "系统与存储",
        title: "一键打包下载全部原图与元数据 (.zip)",
        icon: Archive,
        run: closeAnd(() => {
          window.location.href = "/api/records/export-zip"
        }),
      },
    ]

    const modelCmds: CommandAction[] = models.map((m) => ({
      id: `model-${m.id}`,
      group: "快速切换模型",
      title: `切换模型为 ${m.name}`,
      subtitle: `${m.badge} · ${m.price}`,
      icon: Sparkles,
      run: closeAnd(() => {
        onSelectModel(m.id)
        onSelectTab("imagine")
      }),
    }))

    const recipeCmds: CommandAction[] = recipes.slice(0, 8).map((r) => ({
      id: `recipe-${r.id}`,
      group: "快速装填配方",
      title: `套用配方：${r.title}`,
      subtitle: r.summary || r.category,
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
      <DialogContent className="max-w-xl p-0 overflow-hidden border-border bg-card shadow-2xl top-[42%]">
        <DialogTitle className="sr-only">全局快捷命令面板</DialogTitle>
        <DialogDescription className="sr-only">
          搜索并快速执行页面跳转、模型切换、布局模式切换或配方套用
        </DialogDescription>

        {/* Search Input */}
        <div className="flex items-center gap-3 border-b border-border px-4 py-3 pr-12">
          <Search className="h-4 w-4 text-amber-500 shrink-0" />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="输入指令、模型名、配方或功能关键词..."
            className="flex-1 bg-transparent text-sm text-foreground placeholder:text-muted-foreground focus:outline-none"
          />
          <span className="studio-kbd hidden sm:inline-flex">ESC</span>
        </div>

        {/* Command Results */}
        <div className="max-h-[380px] overflow-y-auto p-2 studio-scroll">
          {filtered.length === 0 ? (
            <div className="py-10 text-center text-xs text-muted-foreground">
              没有找到匹配的快捷指令
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
                    <div className="px-2.5 pt-2.5 pb-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                      {cmd.group}
                    </div>
                  )}
                  <button
                    type="button"
                    onMouseEnter={() => setActiveIndex(idx)}
                    onClick={cmd.run}
                    className={cn(
                      "flex w-full items-center justify-between gap-3 rounded-xl px-3 py-2 text-left transition-colors cursor-pointer",
                      selected
                        ? "bg-amber-500/15 text-foreground"
                        : "text-foreground/85 hover:bg-secondary/60"
                    )}
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      <div
                        className={cn(
                          "flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border",
                          selected
                            ? "border-amber-500/40 bg-amber-500 text-zinc-950"
                            : "border-border bg-secondary/50 text-muted-foreground"
                        )}
                      >
                        <Icon className="h-3.5 w-3.5" />
                      </div>
                      <div className="min-w-0">
                        <div className="text-xs font-medium truncate">
                          {cmd.title}
                        </div>
                        {cmd.subtitle && (
                          <div className="text-[11px] text-muted-foreground truncate">
                            {cmd.subtitle}
                          </div>
                        )}
                      </div>
                    </div>

                    {cmd.shortcut && (
                      <span className="studio-kbd shrink-0">{cmd.shortcut}</span>
                    )}
                  </button>
                </React.Fragment>
              )
            })
          )}
        </div>

        <div className="flex items-center justify-between border-t border-border bg-secondary/30 px-4 py-2 text-[11px] text-muted-foreground">
          <span>↑↓ 选择指令 · Enter 立即执行</span>
          <span className="font-mono">Ctrl + K</span>
        </div>
      </DialogContent>
    </Dialog>
  )
}
