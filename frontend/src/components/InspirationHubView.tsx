import React, { useMemo, useRef, useState } from "react"
import {
  BookmarkPlus,
  Check,
  Compass,
  Copy,
  Layers,
  Plus,
  Search,
  Sparkles,
  Trash2,
} from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  Flip,
  gsap,
  prefersReducedMotion,
  STUDIO_EASE,
  useGSAP,
} from "@/lib/motion"
import { cn } from "@/lib/utils"
import type { PromptTemplate } from "@/types"

interface InspirationHubViewProps {
  builtInTemplates: PromptTemplate[]
  customTemplates: PromptTemplate[]
  currentPrompt: string
  currentModel: string
  currentSize: string
  currentQuality: string
  currentBackground: string
  onUseRecipe: (tpl: PromptTemplate, withParams: boolean) => void
  onSaveCustomTemplate: (tpl: PromptTemplate) => Promise<void>
  onDeleteCustomTemplate: (id: string) => Promise<void>
  onCopyText: (text: string, msg?: string) => void
}

const CATEGORY_ACCENTS: Record<string, string> = {
  写实人文: "border-t-amber-500/70",
  人像精修: "border-t-emerald-500/70",
  电商视觉: "border-t-sky-500/70",
  视觉设计: "border-t-rose-500/70",
  概念插画: "border-t-cyan-500/70",
  空间建筑: "border-t-orange-500/70",
  "3D 潮玩": "border-t-teal-500/70",
  我的私藏配方: "border-t-amber-400",
}

export const InspirationHubView: React.FC<InspirationHubViewProps> = ({
  builtInTemplates,
  customTemplates,
  currentPrompt,
  currentModel,
  currentSize,
  currentQuality,
  currentBackground,
  onUseRecipe,
  onSaveCustomTemplate,
  onDeleteCustomTemplate,
  onCopyText,
}) => {
  const [selectedCategory, setSelectedCategory] = useState<string>("all")
  const [search, setSearch] = useState<string>("")
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [creating, setCreating] = useState<boolean>(false)
  const [newTitle, setNewTitle] = useState<string>("")
  const [newCategory, setNewCategory] = useState<string>("我的私藏配方")
  const [newPrompt, setNewPrompt] = useState<string>("")

  const hubRootRef = useRef<HTMLDivElement | null>(null)
  const gridRef = useRef<HTMLDivElement | null>(null)
  const creatorRef = useRef<HTMLDivElement | null>(null)
  const catPillRef = useRef<HTMLDivElement | null>(null)
  const catBtnRefs = useRef<Record<string, HTMLButtonElement | null>>({})
  const catPillInitRef = useRef<boolean>(false)
  const pendingFlipRef = useRef<Flip.FlipState | null>(null)
  const mountedGridRef = useRef<boolean>(false)

  const allRecipes = useMemo(
    () => [...customTemplates, ...builtInTemplates],
    [customTemplates, builtInTemplates]
  )

  const categories = useMemo(() => {
    const set = new Set<string>()
    for (const r of allRecipes) {
      if (r.category) set.add(r.category)
    }
    return ["all", ...Array.from(set)]
  }, [allRecipes])

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return allRecipes.filter((r) => {
      if (selectedCategory !== "all" && r.category !== selectedCategory) {
        return false
      }
      if (!q) return true
      return (
        r.title.toLowerCase().includes(q) ||
        r.prompt.toLowerCase().includes(q) ||
        (r.summary || "").toLowerCase().includes(q) ||
        (r.tags || []).some((t) => t.toLowerCase().includes(q))
      )
    })
  }, [allRecipes, selectedCategory, search])

  const handleSelectCategory = (cat: string) => {
    if (cat === selectedCategory) return
    if (gridRef.current && !prefersReducedMotion()) {
      const currentCards = gsap.utils
        .toArray<HTMLElement>(".recipe-card-anim", gridRef.current)
        .slice(0, 24)
      if (currentCards.length > 0) {
        pendingFlipRef.current = Flip.getState(currentCards)
      }
    }
    setSelectedCategory(cat)
  }

  // Liquid sliding category pill
  useGSAP(
    () => {
      const pill = catPillRef.current
      const activeBtn = catBtnRefs.current[selectedCategory]
      if (!pill || !activeBtn) return
      const targetX = activeBtn.offsetLeft
      const targetY = activeBtn.offsetTop
      const targetW = activeBtn.offsetWidth
      const targetH = activeBtn.offsetHeight

      if (!catPillInitRef.current || prefersReducedMotion()) {
        catPillInitRef.current = true
        gsap.set(pill, {
          x: targetX,
          y: targetY,
          width: targetW,
          height: targetH,
          autoAlpha: 1,
        })
        return
      }

      gsap.to(pill, {
        x: targetX,
        y: targetY,
        width: targetW,
        height: targetH,
        autoAlpha: 1,
        duration: 0.3,
        ease: STUDIO_EASE.expo,
        overwrite: "auto",
      })
    },
    { scope: hubRootRef, dependencies: [selectedCategory, categories.length] }
  )

  // Staggered initial card entrance + real GSAP Flip reflow on category switch
  useGSAP(
    () => {
      const grid = gridRef.current
      const flipState = pendingFlipRef.current
      pendingFlipRef.current = null
      if (!grid || prefersReducedMotion()) return

      const cards = gsap.utils
        .toArray<HTMLElement>(".recipe-card-anim", grid)
        .slice(0, 24)
      if (cards.length === 0) return

      if (!mountedGridRef.current) {
        mountedGridRef.current = true
        gsap.fromTo(
          cards,
          { autoAlpha: 0, y: 12 },
          {
            autoAlpha: 1,
            y: 0,
            duration: 0.3,
            stagger: { each: 0.025, amount: 0.2 },
            ease: STUDIO_EASE.out,
            clearProps: "transform,opacity,visibility",
          }
        )
        return
      }

      if (flipState) {
        Flip.from(flipState, {
          targets: cards,
          duration: 0.34,
          ease: STUDIO_EASE.expo,
          simple: true,
          scale: false,
          stagger: 0.014,
          onEnter: (els) =>
            gsap.fromTo(
              els,
              { autoAlpha: 0, y: 10, scale: 0.97 },
              {
                autoAlpha: 1,
                y: 0,
                scale: 1,
                duration: 0.26,
                stagger: 0.018,
                ease: STUDIO_EASE.out,
                clearProps: "transform,opacity,visibility",
              }
            ),
          clearProps: "transform",
        })
      }
    },
    { scope: hubRootRef, dependencies: [selectedCategory] }
  )

  // Inline recipe creator drawer smooth reveal via scoped useGSAP
  useGSAP(
    () => {
      if (!creating || !creatorRef.current || prefersReducedMotion()) return
      gsap.fromTo(
        creatorRef.current,
        { autoAlpha: 0, y: -10, scale: 0.985 },
        {
          autoAlpha: 1,
          y: 0,
          scale: 1,
          duration: 0.26,
          ease: STUDIO_EASE.expo,
          clearProps: "transform,visibility",
        }
      )
    },
    { scope: hubRootRef, dependencies: [creating] }
  )

  const handleOpenCreate = () => {
    setNewPrompt(currentPrompt || "")
    setCreating(true)
  }

  const handleCreateSubmit = async () => {
    if (!newTitle.trim() || !newPrompt.trim()) return
    await onSaveCustomTemplate({
      id: `custom_${Date.now()}`,
      title: newTitle.trim(),
      category: newCategory.trim() || "我的私藏配方",
      summary: newPrompt.trim().slice(0, 72),
      prompt: newPrompt.trim(),
      model: currentModel,
      size: currentSize,
      quality: currentQuality !== "default" ? currentQuality : "",
      background: currentBackground !== "auto" ? currentBackground : "",
      built_in: false,
      created_at: Math.floor(Date.now() / 1000),
    })
    setNewTitle("")
    setCreating(false)
  }

  return (
    <div
      ref={hubRootRef}
      className="h-full overflow-y-auto studio-scroll px-4 sm:px-7 py-6 pb-24"
    >
      <div className="mx-auto max-w-[1440px] space-y-6">
        {/* Editorial Header */}
        <div className="flex flex-col md:flex-row md:items-end justify-between gap-4 border-b border-border pb-5">
          <div className="space-y-1.5">
            <div className="inline-flex items-center gap-2 text-xs font-semibold uppercase tracking-widest text-amber-500">
              <Compass className="h-3.5 w-3.5" />
              Curated Studio Recipes
            </div>
            <h1 className="text-2xl font-bold tracking-tight">
              灵感配方广场
            </h1>
            <p className="text-xs text-muted-foreground max-w-2xl leading-relaxed">
              精选高一致性多人物合影重绘、商业电商静物、透明背景 3D 贴纸、国风中英双语海报等全套出图配方。点击「一键做同款」即可自动装填模型、画幅尺寸、透明通道与完整结构化提示词。
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2.5">
            <div className="relative w-60">
              <Search className="h-3.5 w-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="搜索风格、场景、标签..."
                className="h-9 pl-8.5 text-xs"
              />
            </div>
            <Button
              type="button"
              variant="studio"
              size="sm"
              className="h-9 px-3.5"
              onClick={handleOpenCreate}
            >
              <BookmarkPlus className="h-4 w-4" />
              新建私藏配方
            </Button>
          </div>
        </div>

        {/* Inline Recipe Creator Drawer */}
        {creating && (
          <div
            ref={creatorRef}
            className="rounded-2xl border border-amber-500/40 bg-card p-5 shadow-lg space-y-3"
          >
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold flex items-center gap-2">
                <Plus className="h-4 w-4 text-amber-500" />
                将当前工作台参数或自定义提示词保存为永久配方
              </h3>
              <span className="text-[11px] font-mono text-muted-foreground">
                默认绑定: {currentModel} · {currentSize}
              </span>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <Input
                value={newTitle}
                onChange={(e) => setNewTitle(e.target.value)}
                placeholder="配方名称（如：极简护肤品岩石光影）"
                className="sm:col-span-2 h-9 text-xs"
              />
              <Input
                value={newCategory}
                onChange={(e) => setNewCategory(e.target.value)}
                placeholder="分类名称"
                className="h-9 text-xs"
              />
            </div>
            <textarea
              rows={4}
              value={newPrompt}
              onChange={(e) => setNewPrompt(e.target.value)}
              placeholder="输入完整画面提示词..."
              className="w-full rounded-xl border border-input bg-background p-3 text-xs leading-relaxed focus:outline-none focus:ring-2 focus:ring-ring"
            />
            <div className="flex justify-end gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setCreating(false)}
              >
                取消
              </Button>
              <Button
                type="button"
                variant="studio"
                size="sm"
                disabled={!newTitle.trim() || !newPrompt.trim()}
                onClick={handleCreateSubmit}
              >
                <Check className="h-3.5 w-3.5" />
                保存至本地模板库
              </Button>
            </div>
          </div>
        )}

        {/* Category Filter Pills with Liquid Sliding GSAP Indicator */}
        <div className="relative flex flex-wrap items-center gap-1.5">
          <div
            ref={catPillRef}
            style={{ opacity: 0, visibility: "hidden" }}
            className="pointer-events-none absolute left-0 top-0 rounded-full bg-foreground shadow-xs"
          />
          {categories.map((cat) => {
            const active = selectedCategory === cat
            const count =
              cat === "all"
                ? allRecipes.length
                : allRecipes.filter((r) => r.category === cat).length
            return (
              <button
                key={cat}
                ref={(el) => {
                  catBtnRefs.current[cat] = el
                }}
                type="button"
                onClick={() => handleSelectCategory(cat)}
                className={cn(
                  "relative z-10 inline-flex items-center gap-1.5 rounded-full px-3.5 py-1.5 text-xs font-medium transition-colors cursor-pointer active:scale-95",
                  active
                    ? "text-background font-semibold"
                    : "bg-secondary/70 text-muted-foreground hover:text-foreground hover:bg-secondary"
                )}
              >
                <span>{cat === "all" ? "全部精选配方" : cat}</span>
                <span className="font-mono text-[10px] opacity-70 tabular-nums">
                  {count}
                </span>
              </button>
            )
          })}
        </div>

        {/* Recipe Cards Grid */}
        <div
          ref={gridRef}
          className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4"
        >
          {filtered.map((tpl) => {
            const expanded = expandedId === tpl.id
            const accentClass =
              CATEGORY_ACCENTS[tpl.category] || "border-t-zinc-500/60"

            return (
              <article
                key={tpl.id}
                data-flip-id={tpl.id}
                className={cn(
                  "recipe-card-anim group flex flex-col justify-between rounded-2xl border border-border border-t-2 bg-card p-5 transition-colors hover:border-foreground/25 hover:shadow-md",
                  accentClass
                )}
              >
                <div className="space-y-3">
                  {/* Top Meta */}
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <Badge variant="secondary" className="text-[10px]">
                        {tpl.category}
                      </Badge>
                      {!tpl.built_in && (
                        <Badge variant="amber" className="text-[10px]">
                          私藏
                        </Badge>
                      )}
                      {tpl.background === "transparent" && (
                        <Badge variant="success" className="text-[10px]">
                          透明 PNG 通道
                        </Badge>
                      )}
                    </div>

                    {!tpl.built_in && (
                      <button
                        type="button"
                        onClick={() => onDeleteCustomTemplate(tpl.id)}
                        className="text-muted-foreground hover:text-destructive transition-colors cursor-pointer"
                        title="删除自定义配方"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    )}
                  </div>

                  {/* Title & Summary */}
                  <div>
                    <h3 className="text-base font-semibold tracking-tight text-foreground">
                      {tpl.title}
                    </h3>
                    {tpl.summary && (
                      <p className="mt-1 text-xs text-muted-foreground leading-relaxed">
                        {tpl.summary}
                      </p>
                    )}
                  </div>

                  {/* Spec Chips */}
                  <div className="flex flex-wrap items-center gap-1.5 text-[10px] font-mono text-muted-foreground">
                    {tpl.model && (
                      <span className="rounded-md border border-border bg-secondary/50 px-2 py-0.5">
                        {tpl.model.replace("gpt-image-", "")}
                      </span>
                    )}
                    {tpl.size && (
                      <span className="rounded-md border border-border bg-secondary/50 px-2 py-0.5 tabular-nums">
                        {tpl.size}
                      </span>
                    )}
                    {tpl.quality && (
                      <span className="rounded-md border border-border bg-secondary/50 px-2 py-0.5 uppercase">
                        {tpl.quality}
                      </span>
                    )}
                    {(tpl.tags || []).map((tag) => (
                      <span
                        key={tag}
                        className="rounded-md bg-amber-500/10 text-amber-600 dark:text-amber-400 px-1.5 py-0.5 font-sans"
                      >
                        #{tag}
                      </span>
                    ))}
                  </div>

                  {/* Prompt Excerpt */}
                  <div className="rounded-xl border border-border/80 bg-background/60 p-3">
                    <p
                      className={cn(
                        "text-xs text-foreground/85 leading-relaxed whitespace-pre-wrap",
                        !expanded && "line-clamp-4"
                      )}
                    >
                      {tpl.prompt}
                    </p>
                    {tpl.prompt.length > 140 && (
                      <button
                        type="button"
                        onClick={() =>
                          setExpandedId(expanded ? null : tpl.id)
                        }
                        className="mt-1.5 text-[11px] font-medium text-amber-600 dark:text-amber-400 hover:underline cursor-pointer"
                      >
                        {expanded ? "收起完整提示词" : "展开阅读完整结构化提示词"}
                      </button>
                    )}
                  </div>
                </div>

                {/* Card Actions */}
                <div className="mt-4 flex items-center gap-2 pt-3 border-t border-border/60">
                  <Button
                    type="button"
                    variant="studio"
                    size="sm"
                    className="flex-1"
                    onClick={() => onUseRecipe(tpl, true)}
                  >
                    <Sparkles className="h-3.5 w-3.5" />
                    一键做同款
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => onUseRecipe(tpl, false)}
                    title="仅填入提示词，保留当前模型与尺寸"
                  >
                    <Layers className="h-3.5 w-3.5" />
                    仅填词
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8 shrink-0"
                    onClick={() => onCopyText(tpl.prompt, "已复制配方提示词")}
                    title="复制提示词"
                  >
                    <Copy className="h-3.5 w-3.5" />
                  </Button>
                </div>
              </article>
            )
          })}
        </div>
      </div>
    </div>
  )
}
