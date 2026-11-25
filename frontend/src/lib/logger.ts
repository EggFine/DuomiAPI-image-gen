export type ClientLogLevel = "DEBUG" | "INFO" | "WARN" | "ERROR"

export interface LocalClientLogEntry {
  ts: string
  level: ClientLogLevel
  source: string
  message: string
  fields?: Record<string, unknown>
  stack?: string
}

const MAX_LOCAL_LOGS = 200
const localLogs: LocalClientLogEntry[] = []
let unreadErrorCount = 0
let initialized = false

type Listener = (unreadErrors: number) => void
const listeners = new Set<Listener>()

function notifyListeners() {
  for (const fn of listeners) {
    try {
      fn(unreadErrorCount)
    } catch {
      // ignore subscriber errors
    }
  }
}

export function subscribeClientErrorCount(fn: Listener): () => void {
  listeners.add(fn)
  fn(unreadErrorCount)
  return () => {
    listeners.delete(fn)
  }
}

export function clearUnreadClientErrors(): void {
  if (unreadErrorCount !== 0) {
    unreadErrorCount = 0
    notifyListeners()
  }
}

export function getLocalClientLogs(): LocalClientLogEntry[] {
  return [...localLogs]
}

export function reportClientLog(
  level: ClientLogLevel,
  message: string,
  fields?: Record<string, unknown>,
  stack?: string,
  source = "frontend"
): void {
  const cleanMsg = (message || "").trim()
  if (!cleanMsg) return

  const entry: LocalClientLogEntry = {
    ts: new Date().toISOString(),
    level,
    source,
    message: cleanMsg.slice(0, 1500),
    fields,
    stack: stack ? stack.slice(0, 4000) : undefined,
  }

  localLogs.push(entry)
  if (localLogs.length > MAX_LOCAL_LOGS) {
    localLogs.splice(0, localLogs.length - MAX_LOCAL_LOGS)
  }

  if (level === "ERROR") {
    unreadErrorCount += 1
    notifyListeners()
  }

  // Fire-and-forget forward to portable Go backend logger (never recurse through apiFetch)
  try {
    void fetch("/api/logs/client", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        level: entry.level,
        source: entry.source,
        message: entry.message,
        fields: entry.fields,
        stack: entry.stack,
      }),
      keepalive: true,
    }).catch(() => {
      // swallow transport failures to avoid log loops
    })
  } catch {
    // ignore in non-browser contexts
  }
}

export function initGlobalErrorCapture(): void {
  if (initialized || typeof window === "undefined") return
  initialized = true

  window.addEventListener("error", (event) => {
    const err = event.error
    const msg =
      event.message ||
      (err instanceof Error ? err.message : String(err || "Unknown script error"))
    // Ignore benign ResizeObserver loop notifications emitted by browsers during rapid layout transitions
    if (msg.includes("ResizeObserver loop")) return
    const stack =
      err instanceof Error
        ? err.stack
        : event.filename
        ? `${event.filename}:${event.lineno}:${event.colno}`
        : undefined
    reportClientLog(
      "ERROR",
      `Uncaught error: ${msg}`,
      {
        filename: event.filename || undefined,
        lineno: event.lineno || undefined,
        colno: event.colno || undefined,
      },
      stack,
      "frontend"
    )
  })

  window.addEventListener("unhandledrejection", (event) => {
    const reason = event.reason
    if (reason && typeof reason === "object" && (reason as any).name === "AbortError") {
      return
    }
    const msg =
      reason instanceof Error
        ? reason.message
        : typeof reason === "string"
        ? reason
        : JSON.stringify(reason || "Unhandled promise rejection")
    const stack = reason instanceof Error ? reason.stack : undefined
    reportClientLog(
      "ERROR",
      `Unhandled rejection: ${msg}`,
      undefined,
      stack,
      "frontend"
    )
  })
}
