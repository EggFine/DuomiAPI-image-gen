import React, { useCallback, useEffect, useState } from "react"
import {
  Check,
  Copy,
  Download,
  Eraser,
  FileText,
  FolderOpen,
  Loader2,
  RefreshCw,
  Search,
  ShieldCheck,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { clearUnreadClientErrors, getLocalClientLogs } from "@/lib/logger"
import {
  clearLogsOnServer,
  fetchLogs,
  formatBytes,
} from "@/lib/studio-utils"
import { cn } from "@/lib/utils"
import type { LogEntry, LogsResponse } from "@/types"

interface LogsDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onOpenLogsFolder: () => void
  onCopyText: (text: string, msg?: string) => void
  onToast: (msg: string, type?: "info" | "success" | "error") => void
}

const LEVEL_OPTIONS = [
  { id: "", label: "全部" },
  { id: "ERROR", label: "错误" },
  { id: "WARN", label: "警告" },
  { id: "INFO", label: "信息" },
]

const SOURCE_OPTIONS = [
  { id: "", label: "全部模块" },
  { id: "duomi", label: "多米 API" },
  { id: "imghost", label: "图床上传" },
  { id: "poll", label: "任务轮询" },
  { id: "server", label: "本地服务" },
  { id: "storage", label: "本地存储" },
  { id: "thumb", label: "缩略图缓存" },
  { id: "frontend", label: "前端异常" },
]

function levelBadgeClass(level: string): string {
  switch (level.toUpperCase()) {
    case "ERROR":
      return "bg-red-500/15 text-red-600 dark:text-red-400"
    case "WARN":
      return "bg-amber-500/15 text-amber-700 dark:text-amber-400"
    case "DEBUG":
      return "bg-foreground/[0.06] text-muted-foreground"
    default:
      return "bg-emerald-500/12 text-emerald-700 dark:text-emerald-400"
  }
}

export const LogsDialog: React.FC<LogsDialogProps> = ({
  open,
  onOpenChange,
  onOpenLogsFolder,
  onCopyText,
  onToast,
}) => {
  const [level, setLevel] = useState<string>("")
  const [source, setSource] = useState<string>("")
  const [search, setSearch] = useState<string>("")
  const [loading, setLoading] = useState<boolean>(false)
  const [clearing, setClearing] = useState<boolean>(false)
  const [copiedJustNow, setCopiedJustNow] = useState<boolean>(false)
  const [data, setData] = useState<LogsResponse | null>(null)
  const [fetchErr, setFetchErr] = useState<string>("")

  const loadLogs = useCallback(async () => {
    setLoading(true)
    setFetchErr("")
    try {
      const res = await fetchLogs({
        limit: 400,
        level: level || undefined,
        source: source || undefined,
        q: search.trim() || undefined,
      })
      setData(res)
    } catch (err: any) {
      setFetchErr(err?.message || "加载运行日志失败")
    } finally {
      setLoading(false)
    }
  }, [level, source, search])

  useEffect(() => {
    if (!open) return
    clearUnreadClientErrors()
    const t = setTimeout(() => {
      void loadLogs()
    }, search ? 180 : 0)
    return () => clearTimeout(t)
  }, [open, loadLogs, search])

  const handleCopyDiagnostic = () => {
    let text = data?.plain_text || ""
    if (!text) {
      const local = getLocalClientLogs()
      text =
        local.length > 0
          ? local
              .map(
                (e) =>
                  `${e.ts} [${e.level}] [${e.source}] ${e.message}${
                    e.stack ? "\n" + e.stack : ""
                  }`
              )
              .join("\n")
          : "(暂无日志记录)"
    }
    onCopyText(text, "已复制脱敏诊断日志，可直接粘贴用于排查")
    setCopiedJustNow(true)
    setTimeout(() => setCopiedJustNow(false), 2000)
  }

  const handleClearView = async () => {
    setClearing(true)
    try {
      await clearLogsOnServer()
      await loadLogs()
      onToast("已清空当前日志视图（磁盘历史文件仍安全保留）", "info")
    } catch (err: any) {
      onToast(err?.message || "清空日志视图失败", "error")
    } finally {
      setClearing(false)
    }
  }

  const entries: LogEntry[] = data?.entries || []
  const files = data?.files || []

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[96vw] sm:max-w-4xl p-0 overflow-hidden flex flex-col max-h-[88vh]">
        <DialogTitle className="sr-only">便携运行日志与故障诊断</DialogTitle>
        <DialogDescription className="sr-only">
          查看、筛选并一键复制自动脱敏的本地运行日志与前端异常堆栈
        </DialogDescription>

        {/* Header */}
        <div className="flex flex-wrap items-center justify-between gap-3 px-6 pt-5 pb-3 pr-14">
          <div className="space-y-0.5">
            <div className="flex items-center gap-2">
              <h2 className="text-[16px] font-semibold tracking-tight text-foreground">
                便携运行日志
              </h2>
              {data?.version && (
                <span className="rounded-full bg-foreground/[0.06] px-2 py-0.5 font-mono text-[10px] text-muted-foreground">
                  {data.version} · {data.platform}
                </span>
              )}
            </div>
            <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
              <ShieldCheck className="h-3.5 w-3.5 text-emerald-500 shrink-0" />
              <span>
                已自动隐藏 API 密钥、认证头与 Base64 图像载荷 · 按天滚动保存于 exe 同级目录
              </span>
            </div>
          </div>

          <div className="flex items-center gap-1.5">
            <Button
              type="button"
              size="sm"
              className="rounded-full gap-1.5"
              onClick={handleCopyDiagnostic}
            >
              {copiedJustNow ? (
                <Check className="h-3.5 w-3.5" />
              ) : (
                <Copy className="h-3.5 w-3.5" />
              )}
              <span>{copiedJustNow ? "已复制" : "一键复制诊断日志"}</span>
            </Button>
          </div>
        </div>

        {/* Filter & Action Toolbar */}
        <div className="flex flex-wrap items-center justify-between gap-2 px-6 pb-3">
          <div className="flex flex-wrap items-center gap-1.5">
            <div className="inline-flex items-center rounded-full bg-foreground/[0.045] dark:bg-white/[0.06] p-0.5">
              {LEVEL_OPTIONS.map((opt) => (
                <button
                  key={opt.id || "all"}
                  type="button"
                  onClick={() => setLevel(opt.id)}
                  className={cn(
                    "rounded-full px-2.5 py-1 text-[11px] font-medium transition-colors cursor-pointer",
                    level === opt.id
                      ? "bg-card text-foreground shadow-2xs dark:bg-white/[0.16]"
                      : "text-muted-foreground hover:text-foreground"
                  )}
                >
                  {opt.label}
                </button>
              ))}
            </div>

            <select
              value={source}
              onChange={(e) => setSource(e.target.value)}
              className="h-7 rounded-full bg-foreground/[0.045] dark:bg-white/[0.06] px-3 text-[11px] text-foreground focus:outline-none cursor-pointer"
            >
              {SOURCE_OPTIONS.map((opt) => (
                <option key={opt.id || "all"} value={opt.id}>
                  {opt.label}
                </option>
              ))}
            </select>

            <div className="relative w-44 sm:w-52">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 h-3 w-3 text-muted-foreground" />
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="搜索任务 ID / 错误词..."
                className="h-7 rounded-full pl-7 text-[11px]"
              />
            </div>
          </div>

          <div className="flex items-center gap-1.5">
            <Button
              type="button"
              variant="ghost"
              size="xs"
              className="h-7 rounded-full px-2.5 text-[11px]"
              onClick={() => void loadLogs()}
              disabled={loading}
            >
              <RefreshCw
                className={cn("h-3 w-3", loading && "animate-spin")}
              />
              刷新
            </Button>
            <Button
              asChild
              variant="ghost"
              size="xs"
              className="h-7 rounded-full px-2.5 text-[11px]"
            >
              <a href="/api/logs/download" download>
                <Download className="h-3 w-3" />
                导出 .log
              </a>
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="xs"
              className="h-7 rounded-full px-2.5 text-[11px]"
              onClick={onOpenLogsFolder}
            >
              <FolderOpen className="h-3 w-3" />
              日志目录
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="xs"
              className="h-7 rounded-full px-2.5 text-[11px] text-muted-foreground hover:text-destructive"
              disabled={clearing}
              onClick={handleClearView}
            >
              <Eraser className="h-3 w-3" />
              清空视图
            </Button>
          </div>
        </div>

        {/* Log Stream Body */}
        <div className="mx-6 flex-1 min-h-[280px] max-h-[52vh] overflow-y-auto rounded-2xl bg-foreground/[0.03] dark:bg-black/35 p-3 font-mono text-[11px] leading-relaxed studio-scroll">
          {loading && entries.length === 0 ? (
            <div className="flex h-48 items-center justify-center gap-2 text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              <span>正在读取便携日志...</span>
            </div>
          ) : fetchErr ? (
            <div className="flex h-48 flex-col items-center justify-center gap-2 text-destructive text-center px-4">
              <span>{fetchErr}</span>
              <Button
                type="button"
                variant="outline"
                size="xs"
                onClick={() => void loadLogs()}
              >
                重试
              </Button>
            </div>
          ) : entries.length === 0 ? (
            <div className="flex h-48 items-center justify-center text-muted-foreground">
              暂无符合条件的日志记录
            </div>
          ) : (
            <div className="space-y-1.5">
              {entries.map((entry) => {
                const shortTime = entry.ts.includes("T")
                  ? entry.ts.slice(11, 23)
                  : entry.ts
                const fieldPairs = entry.fields
                  ? Object.entries(entry.fields)
                  : []
                return (
                  <div
                    key={entry.id}
                    className={cn(
                      "rounded-xl px-2.5 py-1.5 transition-colors",
                      entry.level === "ERROR"
                        ? "bg-red-500/[0.07]"
                        : entry.level === "WARN"
                        ? "bg-amber-500/[0.06]"
                        : "hover:bg-foreground/[0.035]"
                    )}
                  >
                    <div className="flex flex-wrap items-baseline gap-1.5">
                      <span className="text-[10px] text-muted-foreground/75 tabular-nums shrink-0">
                        {shortTime}
                      </span>
                      <span
                        className={cn(
                          "rounded-full px-1.5 py-0.2 text-[9px] font-semibold uppercase tracking-wide shrink-0",
                          levelBadgeClass(entry.level)
                        )}
                      >
                        {entry.level}
                      </span>
                      <span className="rounded-md bg-foreground/[0.06] px-1.5 py-0.2 text-[10px] text-muted-foreground shrink-0">
                        {entry.source}
                      </span>
                      <span className="text-foreground break-all flex-1">
                        {entry.message}
                      </span>
                    </div>

                    {fieldPairs.length > 0 && (
                      <div className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 pl-1 text-[10px] text-muted-foreground">
                        {fieldPairs.map(([k, v]) => (
                          <span key={k} className="break-all">
                            <span className="opacity-65">{k}=</span>
                            <span className="text-foreground/80">
                              {typeof v === "string" ? v : JSON.stringify(v)}
                            </span>
                          </span>
                        ))}
                      </div>
                    )}

                    {entry.stack && (
                      <pre className="mt-1.5 max-h-28 overflow-auto rounded-lg bg-black/50 p-2 text-[10px] text-red-300/90 whitespace-pre-wrap studio-scroll">
                        {entry.stack}
                      </pre>
                    )}
                  </div>
                )
              })}
            </div>
          )}
        </div>

        {/* Footer: Portable Directory + Rotated Log Files */}
        <div className="px-6 py-3.5 space-y-2">
          {data?.logs_dir && (
            <div className="flex items-center justify-between gap-2 text-[11px] text-muted-foreground">
              <span className="font-mono truncate">
                日志路径: {data.logs_dir}
              </span>
              <span className="shrink-0 tabular-nums">
                当前显示 {entries.length} 条
              </span>
            </div>
          )}

          {files.length > 0 && (
            <div className="flex items-center gap-1.5 overflow-x-auto pb-0.5 studio-scroll">
              <span className="text-[10px] text-muted-foreground shrink-0">
                历史文件:
              </span>
              {files.slice(0, 8).map((f) => (
                <a
                  key={f.name}
                  href={`/api/logs/download?file=${encodeURIComponent(f.name)}`}
                  download={f.name}
                  className="inline-flex shrink-0 items-center gap-1 rounded-full bg-foreground/[0.045] hover:bg-foreground/[0.085] px-2.5 py-0.5 font-mono text-[10px] text-muted-foreground hover:text-foreground transition-colors"
                  title={`下载 ${f.name}`}
                >
                  <FileText className="h-2.5 w-2.5" />
                  <span>{f.name}</span>
                  <span className="opacity-65">
                    ({formatBytes(f.size_bytes)})
                  </span>
                </a>
              ))}
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}
