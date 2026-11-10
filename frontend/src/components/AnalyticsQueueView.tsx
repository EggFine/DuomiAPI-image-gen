import React, { useEffect, useMemo, useRef, useState } from "react"
import {
  Archive,
  Copy,
  Eraser,
  FolderOpen,
  Loader2,
  RefreshCw,
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
  const [nowSec, setNowSec] = useState<number>(() =>
    Math.floor(Date.now() / 1000)
  )
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
        r.state === "error" || r.state === "failed" || r.state === "timeout"
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
      durationSamples > 0
        ? Math.round(totalDurationMs / durationSamples / 1000)
        : 0
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
        avgSec:
          st.msSamples > 0 ? Math.round(st.totalMs / st.msSamples / 1000) : 0,
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
          `已清理 ${res.removed_count} 个缓存文件，释放 ${formatBytes(
            res.freed_bytes
          )}`,
          "success"
        )
      } else {
        onToast("缓存已是最简状态", "info")
      }
    } catch (err: any) {
      onToast(err.message || "清理失败", "error")
    } finally {
      setCleaningRefs(false)
    }
  }

  const totalBytes = Math.max(1, diskStats?.total_bytes || 1)
  const genBytes = diskStats?.generated_bytes || 0
  const refBytes = diskStats?.ref_cache_bytes || 0
  const genPct = Math.min(100, Math.round((genBytes / totalBytes) * 100))
  const refPct = Math.min(
    100 - genPct,
    Math.round((refBytes / totalBytes) * 100)
  )

  const targetGenWidth = `${Math.max(genBytes > 0 ? 4 : 0, genPct)}%`
  const targetRefWidth = `${Math.max(refBytes > 0 ? 4 : 0, refPct)}%`

  useGSAP(
    () => {
      if (prefersReducedMotion()) return
      gsap.fromTo(
        ".telemetry-stagger-card",
        { autoAlpha: 0, y: 10 },
        {
          autoAlpha: 1,
          y: 0,
          duration: 0.34,
          stagger: 0.04,
          ease: STUDIO_EASE.out,
          clearProps: "transform,opacity,visibility",
        }
      )
      gsap.fromTo(
        ".model-share-bar",
        { scaleX: 0, transformOrigin: "left center" },
        {
          scaleX: 1,
          duration: 0.56,
          stagger: 0.05,
          ease: STUDIO_EASE.expo,
          clearProps: "transform",
        }
      )
    },
    { scope: rootRef }
  )

  useGSAP(
    () => {
      const track = storageTrackRef.current
      if (!track || prefersReducedMotion()) return
      gsap.fromTo(
        track,
        { scaleX: 0, transformOrigin: "left center" },
        {
          scaleX: 1,
          duration: 0.6,
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
      className="h-full overflow-y-auto studio-scroll px-5 sm:px-8 lg:px-12 py-8 pb-28"
    >
      <div className="mx-auto max-w-6xl space-y-7">
        {/* Minimalist Header */}
        <div className="flex items-center justify-between gap-4">
          <h1 className="text-2xl font-semibold tracking-[-0.025em] text-foreground">
            状态
          </h1>

          <span className="inline-flex items-center gap-2 rounded-full bg-foreground/[0.045] dark:bg-white/[0.06] px-3 py-1 text-xs font-medium text-muted-foreground">
            <span
              className={cn(
                "h-1.5 w-1.5 rounded-full",
                sseConnected ? "bg-emerald-500" : "bg-amber-500"
              )}
            />
            <span>{sseConnected ? "实时已连接" : "轮询模式"}</span>
          </span>
        </div>

        {/* Top 4 Borderless Metric Surfaces */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-5">
          <div className="telemetry-stagger-card apple-surface rounded-3xl p-5 space-y-1.5">
            <span className="text-xs text-muted-foreground">成片</span>
            <div className="text-3xl font-semibold tracking-tight tabular-nums text-foreground">
              <AnimatedNumber value={telemetry.succeededCount} />
            </div>
            <p className="text-[11px] text-muted-foreground tabular-nums">
              成功率 <AnimatedNumber value={telemetry.successRate} suffix="%" />
            </p>
          </div>

          <div className="telemetry-stagger-card apple-surface rounded-3xl p-5 space-y-1.5">
            <span className="text-xs text-muted-foreground">进行中</span>
            <div className="text-3xl font-semibold tracking-tight tabular-nums text-foreground">
              <AnimatedNumber value={telemetry.active.length} />
            </div>
            <p className="text-[11px] text-muted-foreground">异步轮询队列</p>
          </div>

          <div className="telemetry-stagger-card apple-surface rounded-3xl p-5 space-y-1.5">
            <span className="text-xs text-muted-foreground">平均耗时</span>
            <div className="text-3xl font-semibold tracking-tight tabular-nums text-foreground">
              {telemetry.avgSec ? (
                <AnimatedNumber value={telemetry.avgSec} suffix="s" />
              ) : (
                "--"
              )}
            </div>
            <p className="text-[11px] text-muted-foreground">实测出图均速</p>
          </div>

          <div className="telemetry-stagger-card apple-surface rounded-3xl p-5 space-y-1.5">
            <span className="text-xs text-muted-foreground">预估消耗</span>
            <div className="text-3xl font-semibold tracking-tight tabular-nums text-foreground">
              <AnimatedNumber
                value={telemetry.estimatedCostRMB}
                decimals={2}
                prefix="¥"
              />
            </div>
            <p className="text-[11px] text-muted-foreground">按官方单价估算</p>
          </div>
        </div>

        {/* 2-Column Storage & Model Bento */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
          {/* Storage Surface */}
          <section className="telemetry-stagger-card apple-surface rounded-3xl p-6 space-y-5">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-semibold text-foreground">
                本地存储
              </h2>
              <span className="font-mono text-xs text-muted-foreground tabular-nums">
                {formatBytes(diskStats?.total_bytes)}
              </span>
            </div>

            <div className="space-y-2.5">
              <div className="h-2 w-full overflow-hidden rounded-full bg-foreground/[0.06]">
                <div ref={storageTrackRef} className="flex h-full w-full">
                  <div
                    className="bg-foreground/85 h-full"
                    style={{ width: targetGenWidth }}
                    title={`作品原图: ${formatBytes(genBytes)}`}
                  />
                  <div
                    className="bg-foreground/30 h-full"
                    style={{ width: targetRefWidth }}
                    title={`参考图缓存: ${formatBytes(refBytes)}`}
                  />
                </div>
              </div>
              <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
                <span className="inline-flex items-center gap-1.5 tabular-nums">
                  <span className="h-2 w-2 rounded-full bg-foreground/85" />
                  作品原图 {diskStats?.generated_count || 0} 张 ·{" "}
                  {formatBytes(genBytes)}
                </span>
                <span className="inline-flex items-center gap-1.5 tabular-nums">
                  <span className="h-2 w-2 rounded-full bg-foreground/30" />
                  参考缓存 {diskStats?.ref_cache_count || 0} 张 ·{" "}
                  {formatBytes(refBytes)}
                </span>
              </div>
            </div>

            {/* Clean Portable Path Well */}
            <div className="flex items-center justify-between gap-3 rounded-2xl bg-foreground/[0.035] dark:bg-white/[0.04] px-4 py-3">
              <span className="font-mono text-xs text-muted-foreground truncate">
                {dataDir}
              </span>
              <button
                type="button"
                onClick={() => onCopyText(dataDir, "已复制目录路径")}
                className="inline-flex shrink-0 items-center gap-1 text-xs font-medium text-foreground hover:opacity-75 cursor-pointer"
              >
                <Copy className="h-3 w-3" />
                复制
              </button>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <Button
                type="button"
                variant="secondary"
                size="sm"
                onClick={onOpenLocalFolder}
              >
                <FolderOpen className="h-3.5 w-3.5" />
                打开目录
              </Button>
              <Button asChild variant="secondary" size="sm">
                <a href="/api/records/export-zip" download>
                  <Archive className="h-3.5 w-3.5" />
                  导出原图 ZIP
                </a>
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                disabled={cleaningRefs}
                onClick={handleCleanOrphanRefs}
              >
                {cleaningRefs ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Eraser className="h-3.5 w-3.5" />
                )}
                清理缓存
              </Button>
            </div>
          </section>

          {/* Model Speed & Distribution Surface */}
          <section className="telemetry-stagger-card apple-surface rounded-3xl p-6 space-y-5">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-semibold text-foreground">
                模型表现
              </h2>
              {telemetry.failedCount > 0 && (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-7 text-xs text-muted-foreground hover:text-destructive"
                  onClick={onClearFailed}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                  清理 {telemetry.failedCount} 条异常
                </Button>
              )}
            </div>

            {telemetry.modelRows.length === 0 ? (
              <div className="py-12 text-center text-xs text-muted-foreground">
                暂无生成记录
              </div>
            ) : (
              <div className="space-y-2.5">
                {telemetry.modelRows.map((row) => {
                  const pct = Math.max(
                    6,
                    Math.round((row.count / Math.max(1, records.length)) * 100)
                  )
                  return (
                    <div
                      key={row.model}
                      className="rounded-2xl bg-foreground/[0.035] dark:bg-white/[0.04] p-3.5 space-y-2"
                    >
                      <div className="flex items-center justify-between text-xs">
                        <span className="font-mono font-medium text-foreground">
                          {row.model}
                        </span>
                        <div className="flex items-center gap-3 font-mono text-[11px] text-muted-foreground tabular-nums">
                          <span>
                            {row.succeeded}/{row.count}
                          </span>
                          <span>
                            {row.avgSec ? `${row.avgSec}s` : "--"}
                          </span>
                        </div>
                      </div>
                      <div className="h-1 w-full rounded-full bg-foreground/[0.07] overflow-hidden">
                        <div
                          className="model-share-bar h-full rounded-full bg-foreground/80"
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

        {/* Active Queue & Recent Tasks Surface — Zero Table Borders */}
        <section className="telemetry-stagger-card apple-surface rounded-3xl p-6 space-y-5">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold text-foreground">
              队列与最近记录
            </h2>
            {telemetry.active.length > 0 && (
              <Badge variant="warning">
                进行中 {telemetry.active.length}
              </Badge>
            )}
          </div>

          {telemetry.active.length > 0 && (
            <div className="space-y-2.5">
              {telemetry.active.map((task) => {
                const elapsed = Math.max(
                  0,
                  nowSec - (task.create_time || nowSec)
                )
                return (
                  <div
                    key={task.id}
                    className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 rounded-2xl bg-foreground/[0.04] dark:bg-white/[0.05] p-4"
                  >
                    <div className="space-y-1 min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <Badge variant="warning">
                          {formatStateLabel(task.state, task.progress)}
                        </Badge>
                        <span className="font-mono text-xs font-medium text-foreground">
                          {task.model}
                        </span>
                        <span className="font-mono text-[11px] text-muted-foreground tabular-nums">
                          {task.size} · {formatDurationSeconds(elapsed)}
                        </span>
                      </div>
                      <p className="text-xs text-muted-foreground truncate">
                        {task.prompt}
                      </p>
                    </div>

                    <div className="flex items-center gap-2 shrink-0">
                      <Button
                        type="button"
                        variant="secondary"
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
                        查询
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() => onCancelPolling(task.id)}
                      >
                        <StopCircle className="h-3.5 w-3.5" />
                        停止
                      </Button>
                    </div>
                  </div>
                )
              })}
            </div>
          )}

          {records.length === 0 ? (
            <div className="py-8 text-center text-xs text-muted-foreground">
              暂无任务记录
            </div>
          ) : (
            <div className="space-y-1">
              {records.slice(0, 8).map((r) => (
                <div
                  key={r.id}
                  className="flex flex-wrap items-center justify-between gap-3 rounded-2xl hover:bg-foreground/[0.035] px-3.5 py-2.5 text-xs transition-colors"
                >
                  <div className="flex items-center gap-2.5 min-w-0">
                    <span
                      className={cn(
                        "h-2 w-2 rounded-full shrink-0",
                        r.state === "succeeded"
                          ? "bg-emerald-500"
                          : r.state === "pending" || r.state === "running"
                          ? "bg-amber-500"
                          : "bg-red-500"
                      )}
                    />
                    <span className="font-medium text-foreground">
                      {formatStateLabel(r.state, r.progress)}
                    </span>
                    <span className="font-mono text-muted-foreground">
                      {r.model}
                    </span>
                    {r.size && (
                      <span className="hidden sm:inline font-mono text-muted-foreground/75 tabular-nums">
                        {r.size}
                      </span>
                    )}
                  </div>

                  <div className="flex items-center gap-4 font-mono text-[11px] text-muted-foreground tabular-nums">
                    <span>
                      {r.duration_ms
                        ? formatDurationSeconds(r.duration_ms / 1000)
                        : "-"}
                    </span>
                    <span>{formatUnixTime(r.create_time)}</span>
                    <button
                      type="button"
                      onClick={() => onCopyText(r.id, "已复制任务 ID")}
                      className="hidden md:inline max-w-[120px] truncate hover:text-foreground cursor-pointer"
                      title={r.id}
                    >
                      {r.id}
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>
      </div>
    </div>
  )
}
