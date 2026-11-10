import React, { useEffect, useMemo, useRef, useState } from "react"
import {
  Activity,
  Archive,
  CheckCircle2,
  Clock,
  Copy,
  Eraser,
  FolderOpen,
  HardDrive,
  Loader2,
  RefreshCw,
  ShieldCheck,
  StopCircle,
  Trash2,
} from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  AnimatedNumber,
  gsap,
  prefersReducedMotion,
  STUDIO_EASE,
  useGSAP,
} from "@/lib/motion"
import {
  cleanOrphanRefsOnServer,
  formatBytes,
  formatDurationSeconds,
  formatStateLabel,
  formatUnixTime,
} from "@/lib/studio-utils"
import { cn } from "@/lib/utils"
import type { DiskUsageStats, TaskRecord } from "@/types"

interface AnalyticsQueueViewProps {
  records: TaskRecord[]
  diskStats: DiskUsageStats | null
  dataDir: string
  sseConnected: boolean
  refreshingIds: Record<string, boolean>
  onUpdateDiskStats: (next: DiskUsageStats) => void
  onRefreshSingle: (id: string) => void
  onCancelPolling: (id: string) => void
  onClearFailed: () => void
  onOpenLocalFolder: () => void
  onCopyText: (text: string, msg?: string) => void
  onToast: (msg: string, type?: "info" | "success" | "error") => void
}

export const AnalyticsQueueView: React.FC<AnalyticsQueueViewProps> = ({
  records,
  diskStats,
  dataDir,
  sseConnected,
  refreshingIds,
  onUpdateDiskStats,
  onRefreshSingle,
  onCancelPolling,
  onClearFailed,
  onOpenLocalFolder,
  onCopyText,
  onToast,
}) => {
  const [nowSec, setNowSec] = useState<number>(() => Math.floor(Date.now() / 1000))
  const [cleaningRefs, setCleaningRefs] = useState<boolean>(false)

  const rootRef = useRef<HTMLDivElement | null>(null)
  const storageTrackRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    const timer = setInterval(
      () => setNowSec(Math.floor(Date.now() / 1000)),
      1000
    )
    return () => clearInterval(timer)
  }, [])

  const telemetry = useMemo(() => {
    const active = records.filter(
      (r) => r.state === "pending" || r.state === "running"
    )
    const succeeded = records.filter((r) => r.state === "succeeded")
    const failed = records.filter(
      (r) =>
        r.state === "error" ||
        r.state === "failed" ||
        r.state === "timeout"
    )

    let totalDurationMs = 0
    let durationSamples = 0
    const byModel: Record<
      string,
      { count: number; succeeded: number; totalMs: number; msSamples: number }
    > = {}

    let estimatedCostRMB = 0
    for (const r of records) {
      const m = r.model || "unknown"
      if (!byModel[m]) {
        byModel[m] = { count: 0, succeeded: 0, totalMs: 0, msSamples: 0 }
      }
      byModel[m].count++
      if (r.state === "succeeded") {
        byModel[m].succeeded++
        // gpt-image-2.6 series reference price ~ ¥0.06/call
        if (m.includes("2.6")) {
          estimatedCostRMB += 0.06
        } else {
          estimatedCostRMB += 0.08
        }
        if (r.duration_ms && r.duration_ms > 0) {
          totalDurationMs += r.duration_ms
          durationSamples++
          byModel[m].totalMs += r.duration_ms
          byModel[m].msSamples++
        }
      }
    }

    const avgSec =
      durationSamples > 0 ? Math.round(totalDurationMs / durationSamples / 1000) : 0
    const finishedTotal = succeeded.length + failed.length
    const successRate =
      finishedTotal > 0
        ? Math.round((succeeded.length / finishedTotal) * 100)
        : 100

    const modelRows = Object.entries(byModel)
      .map(([model, st]) => ({
        model,
        count: st.count,
        succeeded: st.succeeded,
        avgSec: st.msSamples > 0 ? Math.round(st.totalMs / st.msSamples / 1000) : 0,
      }))
      .sort((a, b) => b.count - a.count)

    return {
      active,
      succeededCount: succeeded.length,
      failedCount: failed.length,
      avgSec,
      successRate,
      estimatedCostRMB,
      modelRows,
    }
  }, [records])

  const handleCleanOrphanRefs = async () => {
    setCleaningRefs(true)
    try {
      const res = await cleanOrphanRefsOnServer()
      onUpdateDiskStats(res.disk_stats)
      if (res.removed_count > 0) {
        onToast(
          `已清理 ${res.removed_count} 个未引用参考图缓存，释放 ${formatBytes(
            res.freed_bytes
          )}`,
          "success"
        )
      } else {
        onToast("当前参考图缓存非常干净，无需清理", "info")
      }
    } catch (err: any) {
      onToast(err.message || "清理缓存失败", "error")
    } finally {
      setCleaningRefs(false)
    }
  }

  const totalBytes = Math.max(1, diskStats?.total_bytes || 1)
  const genBytes = diskStats?.generated_bytes || 0
  const refBytes = diskStats?.ref_cache_bytes || 0
  const genPct = Math.min(100, Math.round((genBytes / totalBytes) * 100))
  const refPct = Math.min(100 - genPct, Math.round((refBytes / totalBytes) * 100))

  const targetGenWidth = `${Math.max(genBytes > 0 ? 4 : 0, genPct)}%`
  const targetRefWidth = `${Math.max(refBytes > 0 ? 4 : 0, refPct)}%`

  // Staggered card & model bar entrance via scoped useGSAP
  useGSAP(
    () => {
      if (prefersReducedMotion()) return
      gsap.fromTo(
        ".telemetry-stagger-card",
        { autoAlpha: 0, y: 12 },
        {
          autoAlpha: 1,
          y: 0,
          duration: 0.32,
          stagger: 0.045,
          ease: STUDIO_EASE.out,
          clearProps: "transform,opacity,visibility",
        }
      )
      gsap.fromTo(
        ".model-share-bar",
        { scaleX: 0, transformOrigin: "left center" },
        {
          scaleX: 1,
          duration: 0.55,
          stagger: 0.05,
          ease: STUDIO_EASE.expo,
          clearProps: "transform",
        }
      )
    },
    { scope: rootRef }
  )

  // Compositor-only scaleX sweep on proportional storage bar (avoids width layout thrashing per gsap-performance)
  useGSAP(
    () => {
      const track = storageTrackRef.current
      if (!track || prefersReducedMotion()) return
      gsap.fromTo(
        track,
        { scaleX: 0, transformOrigin: "left center" },
        {
          scaleX: 1,
          duration: 0.62,
          ease: STUDIO_EASE.expo,
          overwrite: "auto",
          clearProps: "transform",
        }
      )
    },
    { scope: rootRef, dependencies: [targetGenWidth, targetRefWidth] }
  )

  return (
    <div
      ref={rootRef}
      className="h-full overflow-y-auto studio-scroll px-4 sm:px-7 py-6 pb-24"
    >
      <div className="mx-auto max-w-[1440px] space-y-6">
        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4 border-b border-border pb-5">
          <div className="space-y-1.5">
            <div className="inline-flex items-center gap-2 text-xs font-semibold uppercase tracking-widest text-amber-500">
              <Activity className="h-3.5 w-3.5" />
              Telemetry & Portable Storage Steward
            </div>
            <h1 className="text-2xl font-bold tracking-tight">
              异步队列监控与便携存储管家
            </h1>
            <p className="text-xs text-muted-foreground">
              实时追踪多米异步出图引擎耗时、模型出片率，并透明管理本地绿色单目录{" "}
              <code className="font-mono text-foreground">{dataDir}</code> 磁盘占用。
            </p>
          </div>

          <div className="flex items-center gap-2">
            <Badge
              variant={sseConnected ? "success" : "warning"}
              className="px-2.5 py-1 text-xs"
            >
              {sseConnected ? "SSE 实时事件流在线" : "HTTP 轮询备用模式"}
            </Badge>
          </div>
        </div>

        {/* Top 4 Key Metric Cards */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <div className="telemetry-stagger-card rounded-2xl border border-border bg-card p-4 space-y-1">
            <span className="text-xs text-muted-foreground">累计成片归档</span>
            <div className="text-2xl font-bold font-mono tabular-nums text-foreground">
              <AnimatedNumber value={telemetry.succeededCount} />
              <span className="ml-1.5 text-xs font-normal text-muted-foreground">
                张作品
              </span>
            </div>
            <p className="text-[11px] text-emerald-600 dark:text-emerald-400">
              任务综合成功率 <AnimatedNumber value={telemetry.successRate} suffix="%" />
            </p>
          </div>

          <div className="telemetry-stagger-card rounded-2xl border border-border bg-card p-4 space-y-1">
            <span className="text-xs text-muted-foreground">正在冲印队列</span>
            <div className="text-2xl font-bold font-mono tabular-nums text-amber-500">
              <AnimatedNumber value={telemetry.active.length} />
              <span className="ml-1.5 text-xs font-normal text-muted-foreground">
                个并发任务
              </span>
            </div>
            <p className="text-[11px] text-muted-foreground">
              后台自动异步轮询并落盘原图
            </p>
          </div>

          <div className="telemetry-stagger-card rounded-2xl border border-border bg-card p-4 space-y-1">
            <span className="text-xs text-muted-foreground">平均出图耗时</span>
            <div className="text-2xl font-bold font-mono tabular-nums text-foreground">
              {telemetry.avgSec ? (
                <AnimatedNumber value={telemetry.avgSec} suffix="s" />
              ) : (
                "--"
              )}
            </div>
            <p className="text-[11px] text-muted-foreground">
              从提交任务至原图返回实测均值
            </p>
          </div>

          <div className="telemetry-stagger-card rounded-2xl border border-border bg-card p-4 space-y-1">
            <span className="text-xs text-muted-foreground">预估累计参考消耗</span>
            <div className="text-2xl font-bold font-mono tabular-nums text-foreground">
              <AnimatedNumber
                value={telemetry.estimatedCostRMB}
                decimals={2}
                prefix="¥"
              />
            </div>
            <p className="text-[11px] text-muted-foreground">
              按官方 2.6 系列约 ¥0.06/次估算
            </p>
          </div>
        </div>

        {/* Main 2-Column Bento */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
          {/* Left: Portable Disk & Green Directory Steward */}
          <section className="telemetry-stagger-card rounded-2xl border border-border bg-card p-5 space-y-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <HardDrive className="h-4 w-4 text-amber-500" />
                <h2 className="text-sm font-semibold">
                  绿色便携目录存储明细 (Zero Registry)
                </h2>
              </div>
              <Badge variant="outline" className="font-mono tabular-nums">
                总占用 {formatBytes(diskStats?.total_bytes)}
              </Badge>
            </div>

            {/* Visual Proportional Bar (Compositor scaleX via storageTrackRef) */}
            <div className="space-y-2">
              <div className="h-3 w-full overflow-hidden rounded-full bg-secondary">
                <div ref={storageTrackRef} className="flex h-full w-full">
                  <div
                    className="bg-emerald-500 h-full"
                    style={{ width: targetGenWidth }}
                    title={`生成作品原图: ${formatBytes(genBytes)}`}
                  />
                  <div
                    className="bg-amber-500 h-full"
                    style={{ width: targetRefWidth }}
                    title={`参考图本地缓存: ${formatBytes(refBytes)}`}
                  />
                </div>
              </div>
              <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
                <span className="inline-flex items-center gap-1.5 tabular-nums">
                  <span className="h-2 w-2 rounded-full bg-emerald-500" />
                  生成原图 ({diskStats?.generated_count || 0} 张 ·{" "}
                  {formatBytes(genBytes)})
                </span>
                <span className="inline-flex items-center gap-1.5 tabular-nums">
                  <span className="h-2 w-2 rounded-full bg-amber-500" />
                  参考图缓存 ({diskStats?.ref_cache_count || 0} 张 ·{" "}
                  {formatBytes(refBytes)})
                </span>
              </div>
            </div>

            {/* Portable Path Box */}
            <div className="rounded-xl border border-border bg-secondary/35 p-3 space-y-2">
              <div className="flex items-center justify-between text-xs">
                <span className="inline-flex items-center gap-1.5 font-medium text-foreground">
                  <ShieldCheck className="h-3.5 w-3.5 text-emerald-500" />
                  100% 纯净单目录隔离架构
                </span>
                <button
                  type="button"
                  onClick={() => onCopyText(dataDir, "已复制本地数据目录绝对路径")}
                  className="inline-flex items-center gap-1 text-[11px] text-amber-600 dark:text-amber-400 hover:underline cursor-pointer"
                >
                  <Copy className="h-3 w-3" />
                  复制路径
                </button>
              </div>
              <p className="font-mono text-[11px] text-muted-foreground break-all">
                {dataDir}
              </p>
              <p className="text-[11px] text-muted-foreground leading-relaxed">
                不写系统注册表，不在 AppData / 用户主目录留下任何残留。整个文件夹打包拷走即可完整迁移全部配置、历史记录与原图。
              </p>
            </div>

            {/* Steward Actions */}
            <div className="flex flex-wrap items-center gap-2 pt-1">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={onOpenLocalFolder}
              >
                <FolderOpen className="h-3.5 w-3.5 text-amber-500" />
                打开本地目录
              </Button>
              <a
                href="/api/records/export-zip"
                className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-border bg-background px-3 text-xs font-medium text-foreground hover:bg-accent transition-colors"
              >
                <Archive className="h-3.5 w-3.5" />
                打包导出全部原图 (.zip)
              </a>
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={cleaningRefs}
                onClick={handleCleanOrphanRefs}
              >
                {cleaningRefs ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Eraser className="h-3.5 w-3.5" />
                )}
                清理无引用参考图缓存
              </Button>
            </div>
          </section>

          {/* Right: Model Speed & Distribution */}
          <section className="rounded-2xl border border-border bg-card p-5 space-y-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Clock className="h-4 w-4 text-amber-500" />
                <h2 className="text-sm font-semibold">各模型出片统计与实测均速</h2>
              </div>
              {telemetry.failedCount > 0 && (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-7 text-xs text-muted-foreground hover:text-destructive"
                  onClick={onClearFailed}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                  清理 {telemetry.failedCount} 条异常记录
                </Button>
              )}
            </div>

            {telemetry.modelRows.length === 0 ? (
              <div className="py-12 text-center text-xs text-muted-foreground">
                暂无历史生成记录，提交首个创作任务后将自动汇总各模型表现
              </div>
            ) : (
              <div className="space-y-3">
                {telemetry.modelRows.map((row) => {
                  const pct = Math.max(
                    6,
                    Math.round((row.count / Math.max(1, records.length)) * 100)
                  )
                  return (
                    <div
                      key={row.model}
                      className="rounded-xl border border-border/80 bg-secondary/25 p-3 space-y-2"
                    >
                      <div className="flex items-center justify-between text-xs">
                        <span className="font-mono font-semibold text-foreground">
                          {row.model}
                        </span>
                        <div className="flex items-center gap-3 font-mono text-[11px] text-muted-foreground tabular-nums">
                          <span>成功 {row.succeeded}/{row.count}</span>
                          <span className="text-emerald-600 dark:text-emerald-400">
                            {row.avgSec ? `均值 ${row.avgSec}s` : "--"}
                          </span>
                        </div>
                      </div>
                      <div className="h-1.5 w-full rounded-full bg-secondary overflow-hidden">
                        <div
                          className="model-share-bar h-full rounded-full bg-amber-500"
                          style={{ width: `${pct}%` }}
                        />
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </section>
        </div>

        {/* Live Active Queue Section */}
        <section className="rounded-2xl border border-border bg-card p-5 space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold flex items-center gap-2">
              正在执行的异步轮询任务 ({telemetry.active.length})
            </h2>
          </div>

          {telemetry.active.length === 0 ? (
            <div className="flex items-center gap-2 rounded-xl border border-dashed border-border py-8 justify-center text-xs text-muted-foreground">
              <CheckCircle2 className="h-4 w-4 text-emerald-500" />
              当前没有排队或轮询中的异步任务，所有创作队列均已落盘完成
            </div>
          ) : (
            <div className="space-y-2">
              {telemetry.active.map((task) => {
                const elapsed = Math.max(0, nowSec - (task.create_time || nowSec))
                return (
                  <div
                    key={task.id}
                    className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 rounded-xl border border-amber-500/30 bg-amber-500/5 p-3.5"
                  >
                    <div className="space-y-1 min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <Badge variant="warning" className="text-[10px]">
                          {formatStateLabel(task.state, task.progress)}
                        </Badge>
                        <span className="font-mono text-xs font-medium">
                          {task.model}
                        </span>
                        <span className="font-mono text-[11px] text-muted-foreground tabular-nums">
                          {task.size} · 已耗时 {formatDurationSeconds(elapsed)}
                        </span>
                      </div>
                      <p className="text-xs text-muted-foreground truncate">
                        {task.prompt}
                      </p>
                    </div>

                    <div className="flex items-center gap-2 shrink-0">
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        disabled={Boolean(refreshingIds[task.id])}
                        onClick={() => onRefreshSingle(task.id)}
                      >
                        <RefreshCw
                          className={cn(
                            "h-3.5 w-3.5",
                            refreshingIds[task.id] && "animate-spin"
                          )}
                        />
                        立即查询
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() => onCancelPolling(task.id)}
                      >
                        <StopCircle className="h-3.5 w-3.5" />
                        停止轮询
                      </Button>
                    </div>
                  </div>
                )
              })}
            </div>
          )}

          {/* Recent Task Log Table */}
          {records.length > 0 && (
            <div className="pt-3 border-t border-border/60">
              <div className="text-xs font-medium text-muted-foreground mb-2">
                最近 8 条任务状态流水
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead>
                    <tr className="border-b border-border text-[11px] text-muted-foreground">
                      <th className="py-2 pr-3 font-medium">状态</th>
                      <th className="py-2 pr-3 font-medium">模型</th>
                      <th className="py-2 pr-3 font-medium">尺寸</th>
                      <th className="py-2 pr-3 font-medium">耗时</th>
                      <th className="py-2 pr-3 font-medium">时间</th>
                      <th className="py-2 font-medium">任务 ID</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border/50 font-mono text-[11px]">
                    {records.slice(0, 8).map((r) => (
                      <tr key={r.id} className="hover:bg-secondary/30">
                        <td className="py-2 pr-3 font-sans">
                          <span
                            className={cn(
                              "inline-block h-2 w-2 rounded-full mr-1.5",
                              r.state === "succeeded"
                                ? "bg-emerald-500"
                                : r.state === "pending" || r.state === "running"
                                ? "bg-amber-500"
                                : "bg-red-500"
                            )}
                          />
                          {formatStateLabel(r.state, r.progress)}
                        </td>
                        <td className="py-2 pr-3">{r.model}</td>
                        <td className="py-2 pr-3 tabular-nums">{r.size}</td>
                        <td className="py-2 pr-3 tabular-nums">
                          {r.duration_ms
                            ? formatDurationSeconds(r.duration_ms / 1000)
                            : "-"}
                        </td>
                        <td className="py-2 pr-3 tabular-nums text-muted-foreground">
                          {formatUnixTime(r.create_time)}
                        </td>
                        <td className="py-2 text-muted-foreground truncate max-w-[140px]">
                          {r.id}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </section>
      </div>
    </div>
  )
}
