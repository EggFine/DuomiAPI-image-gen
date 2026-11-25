import React from "react"
import { AlertTriangle, Copy, RotateCw } from "lucide-react"
import { Button } from "@/components/ui/button"
import { getLocalClientLogs, reportClientLog } from "@/lib/logger"

interface ErrorBoundaryState {
  hasError: boolean
  errorMessage: string
  errorStack: string
  copied: boolean
}

export class ErrorBoundary extends React.Component<
  { children: React.ReactNode },
  ErrorBoundaryState
> {
  constructor(props: { children: React.ReactNode }) {
    super(props)
    this.state = {
      hasError: false,
      errorMessage: "",
      errorStack: "",
      copied: false,
    }
  }

  static getDerivedStateFromError(error: Error): Partial<ErrorBoundaryState> {
    return {
      hasError: true,
      errorMessage: error?.message || "界面渲染出现异常",
      errorStack: error?.stack || "",
    }
  }

  componentDidCatch(error: Error, info: React.ErrorInfo): void {
    const stack = [error?.stack || "", info?.componentStack || ""]
      .filter(Boolean)
      .join("\n--- Component Stack ---")
    reportClientLog(
      "ERROR",
      `React ErrorBoundary caught: ${error?.message || String(error)}`,
      undefined,
      stack,
      "react"
    )
  }

  handleCopyError = async () => {
    const recent = getLocalClientLogs()
      .slice(-20)
      .map(
        (l) =>
          `${l.ts} [${l.level}] [${l.source}] ${l.message}${
            l.stack ? "\n" + l.stack : ""
          }`
      )
      .join("\n")
    const text = [
      "=== DuomiAPI Studio Frontend Crash Report ===",
      `Time: ${new Date().toISOString()}`,
      `Error: ${this.state.errorMessage}`,
      this.state.errorStack ? `Stack:\n${this.state.errorStack}` : "",
      recent ? `\nRecent Client Logs:\n${recent}` : "",
    ]
      .filter(Boolean)
      .join("\n")

    try {
      await navigator.clipboard.writeText(text)
      this.setState({ copied: true })
      setTimeout(() => this.setState({ copied: false }), 2200)
    } catch {
      // ignore clipboard errors
    }
  }

  render() {
    if (!this.state.hasError) {
      return this.props.children
    }

    return (
      <div className="flex h-screen w-screen items-center justify-center bg-background p-6 text-foreground">
        <div className="w-full max-w-lg rounded-3xl apple-surface p-6 space-y-4">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-destructive/12 text-destructive shrink-0">
              <AlertTriangle className="h-5 w-5" />
            </div>
            <div>
              <h1 className="text-base font-semibold tracking-tight">
                界面遇到意外异常
              </h1>
              <p className="text-xs text-muted-foreground">
                异常堆栈已自动记录至本地便携日志目录 duomi_data/logs/
              </p>
            </div>
          </div>

          <div className="rounded-2xl bg-foreground/[0.04] p-3.5 font-mono text-xs text-destructive break-all max-h-40 overflow-auto studio-scroll">
            {this.state.errorMessage}
          </div>

          <div className="flex flex-wrap items-center justify-end gap-2 pt-1">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={this.handleCopyError}
            >
              <Copy className="h-3.5 w-3.5" />
              {this.state.copied ? "已复制诊断日志" : "一键复制错误日志"}
            </Button>
            <Button
              type="button"
              size="sm"
              onClick={() => window.location.reload()}
            >
              <RotateCw className="h-3.5 w-3.5" />
              重新加载工作台
            </Button>
          </div>
        </div>
      </div>
    )
  }
}
