import React, { useMemo, useRef, useState } from "react"
import { Check, Copy, Plus, Search, Trash2 } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
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
  const [newCategory, setNewCategory] = useState<string>("自定义")
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

  // Liquid Apple capsule glide across category filters
  useGSAP(
    () => {
      const pill = catPillRef.current
      const activeBtn = catBtnRefs.current[selectedCategory]
      if (!pill || !activeBtn || activeBtn.offsetWidth === 0) return
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
        duration: 0.34,
        ease: STUDIO_EASE.expo,
        overwrite: "auto",
      })
    },
    { scope: hubRootRef, dependencies: [selectedCategory, categories.length] }
  )

  // Calm staggered initial reveal + GSAP Flip reflow on category switch
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
          { autoAlpha: 0, y: 10 },
          {
            autoAlpha: 1,
            y: 0,
            duration: 0.34,
            stagger: { each: 0.02, amount: 0.18 },
            ease: STUDIO_EASE.out,
            clearProps: "transform,opacity,visibility",
          }
        )
        return
      }

      if (flipState) {
        Flip.from(flipState, {
          targets: cards,
          duration: 0.36,
          ease: STUDIO_EASE.expo,
          simple: true,
          scale: false,
          stagger: 0.012,
          onEnter: (els) =>
            gsap.fromTo(
              els,
              { autoAlpha: 0, y: 8, scale: 0.985 },
              {
                autoAlpha: 1,
                y: 0,
                scale: 1,
                duration: 0.28,
                stagger: 0.015,
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

  // Calm inline creator reveal
  useGSAP(
    () => {
      if (!creating || !creatorRef.current || prefersReducedMotion()) return
      gsap.fromTo(
        creatorRef.current,
        { autoAlpha: 0, y: -8, scale: 0.99 },
        {
          autoAlpha: 1,
          y: 0,
          scale: 1,
          duration: 0.3,
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
      category: newCategory.trim() || "自定义",
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
      className="h-full overflow-y-auto studio-scroll"
    >
      <div className="studio-container py-7 pb-28 space-y-7">
        {/* Clean Minimalist Header — Zero Dividing Lines or Marketing Copy */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <h1 className="text-2xl font-semibold tracking-[-0.025em] text-foreground">
            配方
          </h1>

          <div className="flex flex-wrap items-center gap-2.5">
            <div className="relative w-56">
              <Search className="h-3.5 w-3.5 absolute left-3.5 top-1/2 -translate-y-1/2 text-muted-foreground/75" />
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="搜索配方"
                className="h-9 rounded-full pl-9 text-xs"
              />
            </div>
            <Button
              type="button"
              size="sm"
              className="h-9 px-4"
              onClick={handleOpenCreate}
            >
              <Plus className="h-3.5 w-3.5" />
              新建配方
            </Button>
          </div>
        </div>

        {/* Borderless Apple Surface Creator Card */}
        {creating && (
          <div
            ref={creatorRef}
            className="apple-surface rounded-3xl p-6 space-y-4"
          >
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-medium text-foreground">新建配方</h3>
              <span className="text-[11px] font-mono text-muted-foreground">
                {currentModel} · {currentSize}
              </span>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <Input
                value={newTitle}
                onChange={(e) => setNewTitle(e.target.value)}
                placeholder="配方名称"
                className="sm:col-span-2 h-9 text-xs"
              />
              <Input
                value={newCategory}
                onChange={(e) => setNewCategory(e.target.value)}
                placeholder="分类"
                className="h-9 text-xs"
              />
            </div>
            <Textarea
              rows={4}
              value={newPrompt}
              onChange={(e) => setNewPrompt(e.target.value)}
              placeholder="完整画面提示词..."
              className="text-xs leading-relaxed"
            />
            <div className="flex justify-end gap-2">
              <Button
                type="button"
                variant="secondary"
                size="sm"
                onClick={() => setCreating(false)}
              >
                取消
              </Button>
              <Button
                type="button"
                size="sm"
                disabled={!newTitle.trim() || !newPrompt.trim()}
                onClick={handleCreateSubmit}
              >
                <Check className="h-3.5 w-3.5" />
                保存
              </Button>
            </div>
          </div>
        )}

        {/* Liquid Category Capsules */}
        <div className="relative flex flex-wrap items-center gap-1.5">
          <div
            ref={catPillRef}
            style={{ opacity: 0, visibility: "hidden" }}
            className="pointer-events-none absolute left-0 top-0 rounded-full bg-primary"
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
                  "relative z-10 inline-flex items-center gap-1.5 rounded-full px-3.5 py-1.5 text-xs font-medium transition-colors cursor-pointer",
                  active
                    ? "text-primary-foreground"
                    : "bg-foreground/[0.045] dark:bg-white/[0.055] text-muted-foreground hover:text-foreground"
                )}
              >
                <span>{cat === "all" ? "全部" : cat}</span>
                <span className="font-mono text-[10px] opacity-65 tabular-nums">
                  {count}
                </span>
              </button>
            )
          })}
        </div>

        {/* Pure Borderless Apple Surface Recipe Cards */}
        <div
          ref={gridRef}
          className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-5"
        >
          {filtered.map((tpl) => {
            const expanded = expandedId === tpl.id

            return (
              <article
                key={tpl.id}
                data-flip-id={tpl.id}
                className="recipe-card-anim apple-surface group flex flex-col justify-between rounded-3xl p-6 transition-shadow duration-300 hover:shadow-[0_14px_36px_-10px_rgba(0,0,0,0.1)] dark:hover:shadow-[0_18px_42px_-12px_rgba(0,0,0,0.5)]"
              >
                <div className="space-y-3.5">
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <Badge variant="secondary">{tpl.category}</Badge>
                      {!tpl.built_in && (
                        <Badge variant="outline">自定义</Badge>
                      )}
                      {tpl.background === "transparent" && (
                        <Badge variant="secondary">透明底</Badge>
                      )}
                    </div>

                    {!tpl.built_in && (
                      <button
                        type="button"
                        onClick={() => onDeleteCustomTemplate(tpl.id)}
                        className="rounded-full p-1 text-muted-foreground hover:text-destructive transition-colors cursor-pointer"
                        title="删除配方"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    )}
                  </div>

                  <div>
                    <h3 className="text-base font-semibold tracking-[-0.015em] text-foreground">
                      {tpl.title}
                    </h3>
                    {tpl.summary && (
                      <p className="mt-1 text-xs text-muted-foreground leading-relaxed">
                        {tpl.summary}
                      </p>
                    )}
                  </div>

                  {(tpl.model || tpl.size || tpl.quality) && (
                    <div className="flex flex-wrap items-center gap-2 text-[11px] font-mono text-muted-foreground/80">
                      {tpl.model && (
                        <span>{tpl.model.replace("gpt-image-", "")}</span>
                      )}
                      {tpl.size && (
                        <>
                          <span>·</span>
                          <span className="tabular-nums">{tpl.size}</span>
                        </>
                      )}
                      {tpl.quality && (
                        <>
                          <span>·</span>
                          <span className="uppercase">{tpl.quality}</span>
                        </>
                      )}
                    </div>
                  )}

                  {/* Soft Tonal Prompt Well */}
                  <div className="rounded-2xl bg-foreground/[0.035] dark:bg-white/[0.04] p-3.5">
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
                        className="mt-2 text-[11px] font-medium text-muted-foreground hover:text-foreground transition-colors cursor-pointer"
                      >
                        {expanded ? "收起" : "展开全文"}
                      </button>
                    )}
                  </div>
                </div>

                {/* Borderless Actions */}
                <div className="mt-5 flex items-center gap-2">
                  <Button
                    type="button"
                    size="sm"
                    className="flex-1"
                    onClick={() => onUseRecipe(tpl, true)}
                  >
                    应用配方
                  </Button>
                  <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    onClick={() => onUseRecipe(tpl, false)}
                    title="仅填入提示词，保留当前模型与尺寸"
                  >
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
