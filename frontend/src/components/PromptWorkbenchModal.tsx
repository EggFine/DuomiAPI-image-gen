import React, { useMemo, useRef, useState } from "react"
import {
  AlignLeft,
  BookmarkPlus,
  Check,
  Copy,
  Eraser,
  History,
  Plus,
  Search,
  Sparkles,
  Wand2,
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
        category: "我的私藏配方",
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
      <DialogContent className="max-w-[95vw] sm:max-w-5xl p-0 overflow-hidden border-border bg-card">
        <DialogTitle className="sr-only">
          沉浸式结构化提示词工程台 (Zen Prompt Architect)
        </DialogTitle>
        <DialogDescription className="sr-only">
          编写长篇结构化提示词，插入参考图编号、摄影镜头与空间透视护栏积木
        </DialogDescription>

        {/* Header */}
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-5 py-3.5 pr-12">
          <div className="flex items-center gap-2.5">
            <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-amber-500/15 text-amber-500">
              <Wand2 className="h-4 w-4" />
            </div>
            <div>
              <h2 className="text-sm font-semibold tracking-tight">
                结构化提示词工程台 (Prompt Architect)
              </h2>
              <p className="text-[11px] text-muted-foreground">
                专为多人物身份锁定、严谨物理空间透视与精细商业摄影长提示词打造
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2 text-[11px] font-mono text-muted-foreground tabular-nums">
            <span>{stats.lines} 行</span>
            <span>·</span>
            <span>{stats.chars} 字符</span>
            <span>·</span>
            <span
              className={cn(
                stats.utf8Bytes > 12000
                  ? "text-amber-500 font-semibold"
                  : "text-muted-foreground"
              )}
            >
              {(stats.utf8Bytes / 1024).toFixed(2)} KB UTF-8
            </span>
          </div>
        </div>

        {/* Main 2-Column Split */}
        <div className="grid grid-cols-1 lg:grid-cols-[1fr_340px] h-[68vh] min-h-[440px]">
          {/* Left: Spacious Zen Editor */}
          <div className="flex flex-col border-b lg:border-b-0 lg:border-r border-border overflow-hidden">
            {/* Reference Tag & Utility Strip */}
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border/70 bg-secondary/30 px-4 py-2">
              <div className="flex flex-wrap items-center gap-1.5">
                {referenceImages.length > 0 ? (
                  referenceImages.map((r, i) => (
                    <button
                      key={r.id}
                      type="button"
                      onClick={() => insertAtCursor(`图${i + 1}`, false)}
                      className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-background px-2 py-0.5 text-[11px] font-medium hover:border-amber-500/50 transition-colors cursor-pointer"
                    >
                      <img
                        src={r.preview}
                        alt=""
                        className="h-4 w-4 rounded-xs object-cover"
                      />
                      <span className="font-mono text-amber-600 dark:text-amber-400">
                        + @图{i + 1}
                      </span>
                    </button>
                  ))
                ) : (
                  <span className="text-[11px] text-muted-foreground">
                    提示：点击右侧摄影与空间护栏积木即可追加至光标处
                  </span>
                )}
              </div>

              <div className="flex items-center gap-1">
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-7 px-2 text-[11px]"
                  onClick={handleSmartFormat}
                  title="清理多余空行与行尾空格"
                >
                  <AlignLeft className="h-3.5 w-3.5" />
                  整理排版
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-7 px-2 text-[11px]"
                  disabled={!prompt}
                  onClick={() => onCopyText(prompt, "已复制完整提示词")}
                >
                  <Copy className="h-3.5 w-3.5" />
                  复制
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-7 px-2 text-[11px] text-muted-foreground hover:text-destructive"
                  disabled={!prompt}
                  onClick={() => onChangePrompt("")}
                >
                  <Eraser className="h-3.5 w-3.5" />
                  清空
                </Button>
              </div>
            </div>

            {/*Save as Recipe Inline Bar*/}
            {showSaveBar && (
              <div className="flex items-center gap-2 border-b border-amber-500/30 bg-amber-500/8 px-4 py-2">
                <Input
                  value={recipeTitle}
                  onChange={(e) => setRecipeTitle(e.target.value)}
                  placeholder="输入配方标题（如：高校机房三人实训自然抓拍）..."
                  className="h-8 text-xs flex-1"
                />
                <Button
                  type="button"
                  variant="studio"
                  size="sm"
                  className="h-8 text-xs"
                  disabled={!recipeTitle.trim() || savingRecipe}
                  onClick={handleConfirmSaveRecipe}
                >
                  <Check className="h-3.5 w-3.5" />
                  确认保存
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-8 text-xs"
                  onClick={() => setShowSaveBar(false)}
                >
                  取消
                </Button>
              </div>
            )}

            {/* Large Clean Textarea */}
            <textarea
              ref={textareaRef}
              value={prompt}
              onChange={(e) => onChangePrompt(e.target.value)}
              placeholder={`建议按清晰层级组织复杂画面：\n一、人物身份与参考选择（保留特征、服装细节）\n二、场景环境与人物自然互动关系\n三、桌椅设备真实空间轴线与人体工学约束\n四、镜头焦段、自然光线与原生画质护栏...`}
              className="flex-1 w-full resize-none bg-transparent p-5 text-sm leading-7 text-foreground placeholder:text-muted-foreground/55 focus:outline-none studio-scroll"
            />
          </div>

          {/* Right: Structured Prompt Building Blocks & History */}
          <div className="flex flex-col bg-secondary/20 overflow-hidden">
            <div className="grid grid-cols-2 border-b border-border p-1.5 gap-1 bg-background/50">
              <button
                type="button"
                onClick={() => setRightPane("blocks")}
                className={cn(
                  "flex items-center justify-center gap-1.5 rounded-lg py-1.5 text-xs font-medium transition-colors cursor-pointer",
                  rightPane === "blocks"
                    ? "bg-foreground text-background shadow-2xs"
                    : "text-muted-foreground hover:text-foreground"
                )}
              >
                <Sparkles className="h-3.5 w-3.5" />
                专业护栏积木
              </button>
              <button
                type="button"
                onClick={() => setRightPane("history")}
                className={cn(
                  "flex items-center justify-center gap-1.5 rounded-lg py-1.5 text-xs font-medium transition-colors cursor-pointer",
                  rightPane === "history"
                    ? "bg-foreground text-background shadow-2xs"
                    : "text-muted-foreground hover:text-foreground"
                )}
              >
                <History className="h-3.5 w-3.5" />
                历史记录 ({promptHistory.length})
              </button>
            </div>

            {rightPane === "blocks" ? (
              <div className="flex-1 overflow-y-auto p-3.5 space-y-4 studio-scroll">
                {PROMPT_ARCHITECT_GROUPS.map((grp) => (
                  <div key={grp.category} className="space-y-2">
                    <div className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                      {grp.category}
                    </div>
                    <div className="space-y-1.5">
                      {grp.items.map((item) => (
                        <button
                          key={item.label}
                          type="button"
                          onClick={() => insertAtCursor(item.snippet, true)}
                          className="group w-full text-left rounded-xl border border-border bg-card p-2.5 hover:border-amber-500/50 transition-all cursor-pointer"
                        >
                          <div className="flex items-center justify-between gap-2 mb-1">
                            <span className="text-xs font-medium text-foreground group-hover:text-amber-600 dark:group-hover:text-amber-400">
                              {item.label}
                            </span>
                            <Plus className="h-3.5 w-3.5 text-muted-foreground group-hover:text-amber-500 shrink-0" />
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
                <div className="p-2.5 border-b border-border/60">
                  <div className="relative">
                    <Search className="h-3.5 w-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
                    <Input
                      value={historySearch}
                      onChange={(e) => setHistorySearch(e.target.value)}
                      placeholder="搜索历史提示词..."
                      className="h-8 pl-8 text-xs"
                    />
                  </div>
                </div>
                <div className="flex-1 overflow-y-auto p-3 space-y-2 studio-scroll">
                  {filteredHistory.length === 0 ? (
                    <div className="py-12 text-center text-xs text-muted-foreground">
                      暂无匹配的历史提示词记录
                    </div>
                  ) : (
                    filteredHistory.map((h) => (
                      <div
                        key={h.id}
                        className="rounded-xl border border-border bg-card p-2.5 space-y-1.5 hover:border-amber-500/40 transition-colors"
                      >
                        <div className="flex items-center justify-between gap-1.5">
                          <Badge
                            variant="outline"
                            className="text-[10px] font-mono px-1.5 py-0"
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
                        <div className="flex justify-end gap-1.5 pt-0.5">
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            className="h-6 px-2 text-[11px]"
                            onClick={() => onChangePrompt(h.prompt)}
                          >
                            覆盖填入
                          </Button>
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            className="h-6 px-2 text-[11px]"
                            onClick={() => insertAtCursor(h.prompt, true)}
                          >
                            追加末尾
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

        {/* Footer */}
        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border bg-card px-5 py-3">
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={!prompt.trim()}
            onClick={() => setShowSaveBar((p) => !p)}
          >
            <BookmarkPlus className="h-3.5 w-3.5 text-amber-500" />
            存为灵感配方
          </Button>

          <div className="flex items-center gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => onOpenChange(false)}
            >
              完成编辑返回工作台
            </Button>
            <Button
              type="button"
              variant="studio"
              size="sm"
              disabled={!prompt.trim()}
              onClick={() => {
                onOpenChange(false)
                onSubmitGenerate()
              }}
            >
              <Sparkles className="h-3.5 w-3.5" />
              立即提交生成
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
