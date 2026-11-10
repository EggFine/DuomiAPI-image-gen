import React, { useMemo, useRef, useState } from "react"
import {
  AlignLeft,
  BookmarkPlus,
  Check,
  Copy,
  Eraser,
  Plus,
  Search,
} from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import {
  formatUnixTime,
  PROMPT_ARCHITECT_GROUPS,
} from "@/lib/studio-utils"
import { cn } from "@/lib/utils"
import type {
  PromptHistoryItem,
  PromptTemplate,
  ReferenceImageEntry,
} from "@/types"

interface PromptWorkbenchModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  prompt: string
  onChangePrompt: (v: string) => void
  referenceImages: ReferenceImageEntry[]
  promptHistory: PromptHistoryItem[]
  currentModel: string
  currentSize: string
  currentQuality: string
  currentBackground: string
  onSaveCustomTemplate: (tpl: PromptTemplate) => Promise<void>
  onCopyText: (text: string, msg?: string) => void
  onSubmitGenerate: () => void
}

export const PromptWorkbenchModal: React.FC<PromptWorkbenchModalProps> = ({
  open,
  onOpenChange,
  prompt,
  onChangePrompt,
  referenceImages,
  promptHistory,
  currentModel,
  currentSize,
  currentQuality,
  currentBackground,
  onSaveCustomTemplate,
  onCopyText,
  onSubmitGenerate,
}) => {
  const textareaRef = useRef<HTMLTextAreaElement | null>(null)
  const [rightPane, setRightPane] = useState<"blocks" | "history">("blocks")
  const [historySearch, setHistorySearch] = useState<string>("")
  const [savingRecipe, setSavingRecipe] = useState<boolean>(false)
  const [recipeTitle, setRecipeTitle] = useState<string>("")
  const [showSaveBar, setShowSaveBar] = useState<boolean>(false)

  const stats = useMemo(() => {
    const chars = prompt.length
    const utf8Bytes = new TextEncoder().encode(prompt).length
    const lines = prompt ? prompt.split("\n").length : 0
    return { chars, utf8Bytes, lines }
  }, [prompt])

  const filteredHistory = useMemo(() => {
    const q = historySearch.trim().toLowerCase()
    if (!q) return promptHistory
    return promptHistory.filter(
      (item) =>
        item.prompt.toLowerCase().includes(q) ||
        item.model.toLowerCase().includes(q)
    )
  }, [promptHistory, historySearch])

  const insertAtCursor = (snippet: string, asParagraph = false) => {
    const el = textareaRef.current
    if (!el) {
      const sep = prompt.trim() ? (asParagraph ? "\n\n" : "，") : ""
      onChangePrompt(prompt.trim() ? `${prompt}${sep}${snippet}` : snippet)
      return
    }
    const start = el.selectionStart ?? prompt.length
    const end = el.selectionEnd ?? prompt.length
    const before = prompt.slice(0, start)
    const after = prompt.slice(end)
    const prefix =
      before.length > 0 && !before.endsWith("\n") && !before.endsWith(" ")
        ? asParagraph
          ? "\n\n"
          : " "
        : ""
    const next = `${before}${prefix}${snippet}${after}`
    onChangePrompt(next)
    requestAnimationFrame(() => {
      el.focus()
      const pos = start + prefix.length + snippet.length
      el.setSelectionRange(pos, pos)
    })
  }

  const handleSmartFormat = () => {
    if (!prompt.trim()) return
    const formatted = prompt
      .replace(/\r\n/g, "\n")
      .replace(/[ \t]+\n/g, "\n")
      .replace(/\n{3,}/g, "\n\n")
      .trim()
    onChangePrompt(formatted)
  }

  const handleConfirmSaveRecipe = async () => {
    if (!recipeTitle.trim() || !prompt.trim()) return
    setSavingRecipe(true)
    try {
      await onSaveCustomTemplate({
        id: `custom_${Date.now()}`,
        title: recipeTitle.trim(),
        category: "个人收藏",
        summary: prompt.trim().slice(0, 68),
        prompt: prompt.trim(),
        model: currentModel,
        size: currentSize,
        quality: currentQuality !== "default" ? currentQuality : "",
        background: currentBackground !== "auto" ? currentBackground : "",
        built_in: false,
        created_at: Math.floor(Date.now() / 1000),
      })
      setRecipeTitle("")
      setShowSaveBar(false)
    } finally {
      setSavingRecipe(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[95vw] sm:max-w-5xl p-0 overflow-hidden">
        <DialogTitle className="sr-only">长文工作台</DialogTitle>
        <DialogDescription className="sr-only">
          编写结构化提示词并插入常用空间与摄影描述词条
        </DialogDescription>

        {/* Minimalist Header */}
        <div className="flex flex-wrap items-center justify-between gap-2 px-6 pt-5 pb-3 pr-14">
          <h2 className="text-[16px] font-semibold tracking-tight text-foreground">
            长文工作台
          </h2>

          <div className="flex items-center gap-2 text-xs font-mono text-muted-foreground tabular-nums">
            <span>{stats.lines} 行</span>
            <span className="opacity-40">·</span>
            <span>{stats.chars} 字</span>
            <span className="opacity-40">·</span>
            <span
              className={cn(
                stats.utf8Bytes > 12000
                  ? "text-amber-600 dark:text-amber-400 font-medium"
                  : "text-muted-foreground"
              )}
            >
              {(stats.utf8Bytes / 1024).toFixed(1)} KB
            </span>
          </div>
        </div>

        {/* Main 2-Column Split — separated by tonal surface, zero dividing lines */}
        <div className="grid grid-cols-1 lg:grid-cols-[1fr_320px] gap-4 px-6 h-[66vh] min-h-[420px]">
          {/* Left: Zen Editor */}
          <div className="flex flex-col rounded-2xl bg-foreground/[0.03] overflow-hidden">
            {/* Quiet Utility Strip */}
            <div className="flex flex-wrap items-center justify-between gap-2 px-4 pt-3 pb-1.5">
              <div className="flex flex-wrap items-center gap-1.5">
                {referenceImages.map((r, i) => (
                  <button
                    key={r.id}
                    type="button"
                    onClick={() => insertAtCursor(`图${i + 1}`, false)}
                    className="inline-flex items-center gap-1.5 rounded-full bg-background/80 px-2.5 py-1 text-[11px] font-medium text-foreground shadow-2xs hover:bg-background transition-colors cursor-pointer"
                  >
                    <img
                      src={r.preview}
                      alt=""
                      className="h-4 w-4 rounded-full object-cover"
                    />
                    <span className="font-mono">@图{i + 1}</span>
                  </button>
                ))}
              </div>

              <div className="flex items-center gap-0.5 ml-auto">
                <Button
                  type="button"
                  variant="ghost"
                  size="xs"
                  onClick={handleSmartFormat}
                  title="清理多余空行与行尾空格"
                >
                  <AlignLeft className="h-3.5 w-3.5" />
                  排版
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="xs"
                  disabled={!prompt}
                  onClick={() => onCopyText(prompt, "已复制提示词")}
                >
                  <Copy className="h-3.5 w-3.5" />
                  复制
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="xs"
                  className="text-muted-foreground hover:text-destructive"
                  disabled={!prompt}
                  onClick={() => onChangePrompt("")}
                >
                  <Eraser className="h-3.5 w-3.5" />
                  清空
                </Button>
              </div>
            </div>

            {/* Save as Recipe Inline Bar */}
            {showSaveBar && (
              <div className="mx-4 mt-1 flex items-center gap-2 rounded-2xl bg-background/85 p-2 shadow-xs">
                <Input
                  value={recipeTitle}
                  onChange={(e) => setRecipeTitle(e.target.value)}
                  placeholder="配方名称..."
                  className="h-8 text-xs flex-1 bg-transparent"
                />
                <Button
                  type="button"
                  size="xs"
                  disabled={!recipeTitle.trim() || savingRecipe}
                  onClick={handleConfirmSaveRecipe}
                >
                  <Check className="h-3.5 w-3.5" />
                  保存
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="xs"
                  onClick={() => setShowSaveBar(false)}
                >
                  取消
                </Button>
              </div>
            )}

            {/* Spacious Clean Textarea */}
            <textarea
              ref={textareaRef}
              value={prompt}
              onChange={(e) => onChangePrompt(e.target.value)}
              placeholder="从容撰写主体、空间结构与光影细节，点击右侧词条可插入光标处..."
              className="flex-1 w-full resize-none bg-transparent px-5 py-4 text-[14px] leading-7 text-foreground placeholder:text-muted-foreground/45 focus:outline-none studio-scroll"
            />
          </div>

          {/* Right: Building Blocks & History */}
          <div className="flex flex-col rounded-2xl bg-foreground/[0.03] overflow-hidden">
            <div className="p-2.5 pb-1.5">
              <div className="grid grid-cols-2 rounded-full bg-foreground/[0.05] p-1">
                <button
                  type="button"
                  onClick={() => setRightPane("blocks")}
                  className={cn(
                    "rounded-full py-1 text-xs font-medium transition-all cursor-pointer",
                    rightPane === "blocks"
                      ? "bg-card text-foreground shadow-2xs"
                      : "text-muted-foreground hover:text-foreground"
                  )}
                >
                  词条
                </button>
                <button
                  type="button"
                  onClick={() => setRightPane("history")}
                  className={cn(
                    "rounded-full py-1 text-xs font-medium transition-all cursor-pointer",
                    rightPane === "history"
                      ? "bg-card text-foreground shadow-2xs"
                      : "text-muted-foreground hover:text-foreground"
                  )}
                >
                  历史 ({promptHistory.length})
                </button>
              </div>
            </div>

            {rightPane === "blocks" ? (
              <div className="flex-1 overflow-y-auto px-3 py-2 space-y-4 studio-scroll">
                {PROMPT_ARCHITECT_GROUPS.map((grp) => (
                  <div key={grp.category} className="space-y-1.5">
                    <div className="px-1 text-[11px] font-medium text-muted-foreground">
                      {grp.category}
                    </div>
                    <div className="space-y-1.5">
                      {grp.items.map((item) => (
                        <button
                          key={item.label}
                          type="button"
                          onClick={() => insertAtCursor(item.snippet, true)}
                          className="group w-full text-left rounded-2xl bg-background/70 hover:bg-background p-3 transition-all cursor-pointer"
                        >
                          <div className="flex items-center justify-between gap-2 mb-1">
                            <span className="text-xs font-medium text-foreground">
                              {item.label}
                            </span>
                            <Plus className="h-3.5 w-3.5 text-muted-foreground/60 group-hover:text-foreground transition-colors shrink-0" />
                          </div>
                          <p className="text-[11px] leading-relaxed text-muted-foreground line-clamp-2">
                            {item.snippet}
                          </p>
                        </button>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="flex-1 flex flex-col overflow-hidden">
                <div className="px-3 py-1.5">
                  <div className="relative">
                    <Search className="h-3.5 w-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
                    <Input
                      value={historySearch}
                      onChange={(e) => setHistorySearch(e.target.value)}
                      placeholder="搜索历史..."
                      className="h-8 pl-8 text-xs rounded-full"
                    />
                  </div>
                </div>
                <div className="flex-1 overflow-y-auto px-3 py-2 space-y-2 studio-scroll">
                  {filteredHistory.length === 0 ? (
                    <div className="py-12 text-center text-xs text-muted-foreground">
                      暂无记录
                    </div>
                  ) : (
                    filteredHistory.map((h) => (
                      <div
                        key={h.id}
                        className="rounded-2xl bg-background/70 hover:bg-background p-3 space-y-2 transition-colors"
                      >
                        <div className="flex items-center justify-between gap-1.5">
                          <Badge
                            variant="secondary"
                            className="text-[10px] font-mono px-2 py-0"
                          >
                            {h.model.replace("gpt-image-", "")} · {h.size}
                          </Badge>
                          <span className="text-[10px] font-mono text-muted-foreground tabular-nums">
                            {formatUnixTime(h.timestamp)}
                          </span>
                        </div>
                        <p className="text-xs text-foreground/90 line-clamp-3 leading-relaxed">
                          {h.prompt}
                        </p>
                        <div className="flex justify-end gap-1.5">
                          <Button
                            type="button"
                            variant="outline"
                            size="xs"
                            className="h-6 px-2.5 text-[11px]"
                            onClick={() => onChangePrompt(h.prompt)}
                          >
                            填入
                          </Button>
                          <Button
                            type="button"
                            variant="ghost"
                            size="xs"
                            className="h-6 px-2.5 text-[11px]"
                            onClick={() => insertAtCursor(h.prompt, true)}
                          >
                            追加
                          </Button>
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Minimalist Footer */}
        <div className="flex flex-wrap items-center justify-between gap-2 px-6 py-4">
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={!prompt.trim()}
            onClick={() => setShowSaveBar((p) => !p)}
          >
            <BookmarkPlus className="h-3.5 w-3.5" />
            存为配方
          </Button>

          <div className="flex items-center gap-2">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => onOpenChange(false)}
            >
              完成
            </Button>
            <Button
              type="button"
              size="sm"
              disabled={!prompt.trim()}
              onClick={() => {
                onOpenChange(false)
                onSubmitGenerate()
              }}
            >
              生成
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
