import React, { useMemo, useState } from "react"
import {
  Activity,
  Archive,
  CheckCircle2,
  Copy,
  Eye,
  EyeOff,
  FolderOpen,
  Loader2,
  Plus,
  Search,
  Trash2,
  XCircle,
} from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { apiFetch, formatBytes } from "@/lib/studio-utils"
import type {
  AppConfig,
  ConnectivityTestResult,
  DiskUsageStats,
  ImageHostInfo,
  ImageHostProvider,
  PromptTemplate,
  RefImageMode,
} from "@/types"

interface SettingsDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  initialTab?: string
  config: AppConfig | null
  imageHosts: ImageHostInfo[]
  diskStats: DiskUsageStats | null
  onSaveConfig: (nextCfg: Partial<AppConfig>) => Promise<void>
  onOpenLocalFolder: () => void
  onCopyText: (text: string, msg?: string) => void
}

export const SettingsDialog: React.FC<SettingsDialogProps> = ({
  open,
  onOpenChange,
  initialTab = "api",
  config,
  imageHosts,
  diskStats,
  onSaveConfig,
  onOpenLocalFolder,
  onCopyText,
}) => {
  const [tab, setTab] = useState<string>(initialTab)
  const [apiKey, setApiKey] = useState<string>(config?.api_key || "")
  const [showKey, setShowKey] = useState<boolean>(false)
  const [baseUrl, setBaseUrl] = useState<string>(
    config?.base_url || "https://duomiapi.com"
  )
  const [pollInterval, setPollInterval] = useState<number>(
    config?.poll_interval || 3
  )
  const [pollTimeout, setPollTimeout] = useState<number>(
    config?.poll_timeout || 300
  )
  const [autoDownload, setAutoDownload] = useState<boolean>(
    config?.auto_download !== false
  )
  const [autoCompatFallback, setAutoCompatFallback] = useState<boolean>(
    config?.auto_compat_fallback !== false
  )

  const [refMode, setRefMode] = useState<RefImageMode>(
    config?.ref_image_mode || "upload"
  )
  const [hostProvider, setHostProvider] = useState<ImageHostProvider>(
    config?.image_host_provider || "auto"
  )
  const [litterboxExpiry, setLitterboxExpiry] = useState<string>(
    config?.litterbox_expiry || "12h"
  )
  const [customUrl, setCustomUrl] = useState<string>(
    config?.custom_upload_url || ""
  )
  const [customField, setCustomField] = useState<string>(
    config?.custom_upload_field || "file"
  )
  const [customAuth, setCustomAuth] = useState<string>(
    config?.custom_upload_auth || ""
  )
  const [customJsonPath, setCustomJsonPath] = useState<string>(
    config?.custom_upload_json_path || ""
  )
  const [compressMaxDim, setCompressMaxDim] = useState<number>(
    config?.compress_max_dim || 1536
  )
  const [compressQuality, setCompressQuality] = useState<number>(
    config?.compress_quality || 85
  )

  const [testingConn, setTestingConn] = useState<boolean>(false)
  const [connResult, setConnResult] = useState<ConnectivityTestResult | null>(
    null
  )
  const [saving, setSaving] = useState<boolean>(false)

  React.useEffect(() => {
    if (open) {
      setTab(initialTab || "api")
      setConnResult(null)
      if (config) {
        setApiKey(config.api_key || "")
        setBaseUrl(config.base_url || "https://duomiapi.com")
        setPollInterval(config.poll_interval || 3)
        setPollTimeout(config.poll_timeout || 300)
        setAutoDownload(config.auto_download !== false)
        setAutoCompatFallback(config.auto_compat_fallback !== false)
        setRefMode(config.ref_image_mode || "upload")
        setHostProvider(config.image_host_provider || "auto")
        setLitterboxExpiry(config.litterbox_expiry || "12h")
        setCustomUrl(config.custom_upload_url || "")
        setCustomField(config.custom_upload_field || "file")
        setCustomAuth(config.custom_upload_auth || "")
        setCustomJsonPath(config.custom_upload_json_path || "")
        setCompressMaxDim(config.compress_max_dim || 1536)
        setCompressQuality(config.compress_quality || 85)
      }
    }
  }, [open, initialTab, config])

  const handleTestConn = async () => {
    setTestingConn(true)
    setConnResult(null)
    try {
      const res = await apiFetch<ConnectivityTestResult>("/api/config/test", {
        method: "POST",
        body: JSON.stringify({
          api_key: apiKey.trim(),
          base_url: baseUrl.trim() || "https://duomiapi.com",
        }),
      })
      setConnResult(res)
    } catch (err: any) {
      setConnResult({
        ok: false,
        latency_ms: 0,
        message: err.message,
      })
    } finally {
      setTestingConn(false)
    }
  }

  const handleSave = async () => {
    setSaving(true)
    try {
      await onSaveConfig({
        api_key: apiKey.trim(),
        base_url: baseUrl.trim() || "https://duomiapi.com",
        poll_interval: Number(pollInterval) || 3,
        poll_timeout: Number(pollTimeout) || 300,
        auto_download: autoDownload,
        auto_compat_fallback: autoCompatFallback,
        ref_image_mode: refMode,
        image_host_provider: hostProvider,
        litterbox_expiry: litterboxExpiry,
        custom_upload_url: customUrl.trim(),
        custom_upload_field: customField.trim() || "file",
        custom_upload_auth: customAuth.trim(),
        custom_upload_json_path: customJsonPath.trim(),
        compress_max_dim: Number(compressMaxDim) || 1536,
        compress_quality: Number(compressQuality) || 85,
      })
      onOpenChange(false)
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>偏好设置</DialogTitle>
          <DialogDescription className="sr-only">
            配置 API 密钥、参考图传输策略与本地存储目录
          </DialogDescription>
        </DialogHeader>

        <Tabs value={tab} onValueChange={setTab} className="w-full">
          <TabsList className="grid w-full grid-cols-3">
            <TabsTrigger value="api">接口</TabsTrigger>
            <TabsTrigger value="ref">参考图</TabsTrigger>
            <TabsTrigger value="storage">存储</TabsTrigger>
          </TabsList>

          {/* Tab 1: API & Polling */}
          <TabsContent value="api" className="space-y-4 pt-3">
            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <Label htmlFor="cfg-api-key">API 密钥</Label>
                <button
                  type="button"
                  disabled={testingConn}
                  onClick={handleTestConn}
                  className="inline-flex items-center gap-1 text-xs font-medium text-muted-foreground hover:text-foreground transition-colors cursor-pointer"
                >
                  {testingConn ? (
                    <Loader2 className="h-3 w-3 animate-spin" />
                  ) : (
                    <Activity className="h-3 w-3" />
                  )}
                  测试连接
                </button>
              </div>
              <div className="flex gap-1.5">
                <Input
                  id="cfg-api-key"
                  type={showKey ? "text" : "password"}
                  value={apiKey}
                  onChange={(e) => setApiKey(e.target.value)}
                  placeholder="输入多米 API Key..."
                  className="font-mono text-xs"
                />
                <Button
                  type="button"
                  variant="outline"
                  size="icon"
                  className="h-9 w-9 shrink-0"
                  onClick={() => setShowKey((p) => !p)}
                >
                  {showKey ? (
                    <EyeOff className="h-4 w-4" />
                  ) : (
                    <Eye className="h-4 w-4" />
                  )}
                </Button>
              </div>

              {connResult && (
                <div
                  className={`flex items-center gap-2 rounded-2xl px-3.5 py-2.5 text-xs ${
                    connResult.ok
                      ? "bg-emerald-500/12 text-emerald-700 dark:text-emerald-300"
                      : "bg-destructive/12 text-destructive"
                  }`}
                >
                  {connResult.ok ? (
                    <CheckCircle2 className="h-4 w-4 shrink-0" />
                  ) : (
                    <XCircle className="h-4 w-4 shrink-0" />
                  )}
                  <span>{connResult.message}</span>
                </div>
              )}
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="cfg-base-url">接口地址</Label>
              <Input
                id="cfg-base-url"
                type="url"
                value={baseUrl}
                onChange={(e) => setBaseUrl(e.target.value)}
                className="font-mono text-xs"
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="cfg-poll-interval">轮询间隔 (秒)</Label>
                <Input
                  id="cfg-poll-interval"
                  type="number"
                  min={2}
                  max={60}
                  value={pollInterval}
                  onChange={(e) =>
                    setPollInterval(parseInt(e.target.value, 10) || 3)
                  }
                  className="font-mono text-xs tabular-nums"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="cfg-poll-timeout">超时上限 (秒)</Label>
                <Input
                  id="cfg-poll-timeout"
                  type="number"
                  min={30}
                  max={1800}
                  value={pollTimeout}
                  onChange={(e) =>
                    setPollTimeout(parseInt(e.target.value, 10) || 300)
                  }
                  className="font-mono text-xs tabular-nums"
                />
              </div>
            </div>

            <div className="space-y-2">
              <div className="flex items-center justify-between rounded-2xl bg-foreground/[0.035] px-3.5 py-3">
                <Label
                  htmlFor="cfg-auto-download"
                  className="text-xs cursor-pointer"
                >
                  自动保存原图至本地目录
                </Label>
                <Switch
                  id="cfg-auto-download"
                  checked={autoDownload}
                  onCheckedChange={setAutoDownload}
                />
              </div>

              <div className="flex items-center justify-between rounded-2xl bg-foreground/[0.035] px-3.5 py-3">
                <Label
                  htmlFor="cfg-auto-compat"
                  className="text-xs cursor-pointer"
                >
                  尺寸受限时自动回退兼容比例重试
                </Label>
                <Switch
                  id="cfg-auto-compat"
                  checked={autoCompatFallback}
                  onCheckedChange={setAutoCompatFallback}
                />
              </div>
            </div>
          </TabsContent>

          {/* Tab 2: Reference Image Mode & Image Host Settings */}
          <TabsContent value="ref" className="space-y-4 pt-3">
            <div className="space-y-1.5">
              <Label>默认传输方式</Label>
              <select
                value={refMode}
                onChange={(e) => setRefMode(e.target.value as RefImageMode)}
                className="flex h-9 w-full rounded-xl bg-foreground/[0.045] px-3 text-xs text-foreground focus:outline-none"
              >
                <option value="upload">自动上传图床转直链（默认 · 无损）</option>
                <option value="compress_base64">本地压缩转 Base64</option>
                <option value="raw_base64">原图直传 Base64（仅限小图）</option>
              </select>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>图床节点</Label>
                <select
                  value={hostProvider}
                  onChange={(e) =>
                    setHostProvider(e.target.value as ImageHostProvider)
                  }
                  className="flex h-9 w-full rounded-xl bg-foreground/[0.045] px-3 text-xs text-foreground focus:outline-none"
                >
                  {imageHosts.map((h) => (
                    <option key={h.id} value={h.id}>
                      {h.name}
                    </option>
                  ))}
                </select>
              </div>

              <div className="space-y-1.5">
                <Label>临时链接有效期</Label>
                <select
                  value={litterboxExpiry}
                  onChange={(e) => setLitterboxExpiry(e.target.value)}
                  className="flex h-9 w-full rounded-xl bg-foreground/[0.045] px-3 font-mono text-xs text-foreground focus:outline-none"
                >
                  <option value="1h">1 小时</option>
                  <option value="12h">12 小时</option>
                  <option value="24h">24 小时</option>
                  <option value="72h">72 小时</option>
                </select>
              </div>
            </div>

            <div className="rounded-2xl bg-foreground/[0.035] p-3.5 space-y-2.5">
              <div className="flex items-center justify-between">
                <span className="text-xs font-medium">自定义图床接口</span>
                <Badge variant="secondary" className="text-[10px]">
                  选填
                </Badge>
              </div>
              <Input
                value={customUrl}
                onChange={(e) => setCustomUrl(e.target.value)}
                placeholder="POST URL (如 https://img.example.com/api/v1/upload)"
                className="h-8 font-mono text-xs bg-background/80"
              />
              <div className="grid grid-cols-3 gap-2">
                <Input
                  value={customField}
                  onChange={(e) => setCustomField(e.target.value)}
                  placeholder="字段名 (file)"
                  className="h-8 font-mono text-xs bg-background/80"
                />
                <Input
                  type="password"
                  value={customAuth}
                  onChange={(e) => setCustomAuth(e.target.value)}
                  placeholder="Auth 头"
                  className="h-8 font-mono text-xs bg-background/80"
                />
                <Input
                  value={customJsonPath}
                  onChange={(e) => setCustomJsonPath(e.target.value)}
                  placeholder="JSON 路径"
                  className="h-8 font-mono text-xs bg-background/80"
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label className="text-xs text-muted-foreground">
                  压缩长边上限 (px)
                </Label>
                <Input
                  type="number"
                  min={512}
                  max={3840}
                  step={128}
                  value={compressMaxDim}
                  onChange={(e) =>
                    setCompressMaxDim(parseInt(e.target.value, 10) || 1536)
                  }
                  className="h-8 font-mono text-xs"
                />
              </div>
              <div className="space-y-1">
                <Label className="text-xs text-muted-foreground">
                  JPEG 压缩品质 (40~98)
                </Label>
                <Input
                  type="number"
                  min={40}
                  max={98}
                  value={compressQuality}
                  onChange={(e) =>
                    setCompressQuality(parseInt(e.target.value, 10) || 85)
                  }
                  className="h-8 font-mono text-xs"
                />
              </div>
            </div>
          </TabsContent>

          {/* Tab 3: Portable Storage Stats */}
          <TabsContent value="storage" className="space-y-4 pt-3">
            <div className="rounded-2xl bg-foreground/[0.035] p-4 space-y-3.5">
              <div className="flex items-center justify-between">
                <span className="text-xs font-medium text-muted-foreground">
                  本地数据目录
                </span>
                <span className="font-mono text-xs font-semibold tabular-nums text-foreground">
                  {formatBytes(diskStats?.total_bytes)}
                </span>
              </div>

              <div className="grid grid-cols-3 gap-2 text-center">
                <div className="rounded-2xl bg-background/80 p-3">
                  <div className="font-mono text-base font-semibold tabular-nums">
                    {diskStats?.record_count ?? 0}
                  </div>
                  <div className="text-[11px] text-muted-foreground mt-0.5">
                    记录
                  </div>
                </div>
                <div className="rounded-2xl bg-background/80 p-3">
                  <div className="font-mono text-base font-semibold tabular-nums">
                    {diskStats?.generated_count ?? 0}
                  </div>
                  <div className="text-[11px] text-muted-foreground mt-0.5">
                    原图
                  </div>
                </div>
                <div className="rounded-2xl bg-background/80 p-3">
                  <div className="font-mono text-base font-semibold tabular-nums">
                    {diskStats?.ref_cache_count ?? 0}
                  </div>
                  <div className="text-[11px] text-muted-foreground mt-0.5">
                    参考图
                  </div>
                </div>
              </div>

              <div className="flex items-center gap-1.5">
                <code className="flex-1 truncate rounded-full bg-background/80 px-3.5 py-2 font-mono text-[11px] text-muted-foreground">
                  {diskStats?.data_dir || "./duomi_data"}
                </code>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() =>
                    onCopyText(
                      diskStats?.data_dir || "./duomi_data",
                      "已复制目录路径"
                    )
                  }
                >
                  <Copy className="h-3.5 w-3.5" />
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={onOpenLocalFolder}
                >
                  <FolderOpen className="h-3.5 w-3.5" />
                  打开
                </Button>
              </div>
            </div>

            <div className="flex justify-end">
              <Button asChild variant="outline" size="sm">
                <a href="/api/records/export-zip" download>
                  <Archive className="h-3.5 w-3.5" />
                  导出 ZIP 备份
                </a>
              </Button>
            </div>
          </TabsContent>
        </Tabs>

        <DialogFooter>
          <Button
            type="button"
            variant="ghost"
            onClick={() => onOpenChange(false)}
          >
            取消
          </Button>
          <Button
            id="btn-save-config"
            type="button"
            disabled={saving}
            onClick={handleSave}
          >
            {saving ? "保存中..." : "保存"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

interface TemplatesDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  builtInTemplates: PromptTemplate[]
  customTemplates: PromptTemplate[]
  currentPrompt: string
  currentModel: string
  currentSize: string
  currentQuality: string
  onApplyTemplate: (tpl: PromptTemplate, withParams: boolean) => void
  onSaveCustomTemplate: (tpl: PromptTemplate) => Promise<void>
  onDeleteCustomTemplate: (id: string) => Promise<void>
}

export const TemplatesDialog: React.FC<TemplatesDialogProps> = ({
  open,
  onOpenChange,
  builtInTemplates,
  customTemplates,
  currentPrompt,
  currentModel,
  currentSize,
  currentQuality,
  onApplyTemplate,
  onSaveCustomTemplate,
  onDeleteCustomTemplate,
}) => {
  const [search, setSearch] = useState("")
  const [newTitle, setNewTitle] = useState("")
  const [newCategory, setNewCategory] = useState("个人收藏")
  const [savingNew, setSavingNew] = useState(false)

  const allTemplates = useMemo(
    () => [...customTemplates, ...builtInTemplates],
    [customTemplates, builtInTemplates]
  )

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return allTemplates
    return allTemplates.filter((t) =>
      `${t.title} ${t.category} ${t.prompt}`.toLowerCase().includes(q)
    )
  }, [allTemplates, search])

  const handleCreate = async () => {
    if (!currentPrompt.trim()) return
    const title = newTitle.trim() || currentPrompt.trim().slice(0, 18)
    setSavingNew(true)
    try {
      await onSaveCustomTemplate({
        id: `tpl_${Date.now()}`,
        title,
        category: newCategory.trim() || "个人收藏",
        prompt: currentPrompt.trim(),
        model: currentModel,
        size: currentSize,
        quality: currentQuality === "default" ? "" : currentQuality,
        created_at: Math.floor(Date.now() / 1000),
      })
      setNewTitle("")
    } finally {
      setSavingNew(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl max-h-[85vh] flex flex-col">
        <DialogHeader>
          <DialogTitle>配方库</DialogTitle>
          <DialogDescription className="sr-only">
            浏览与载入预设配方或保存当前提示词
          </DialogDescription>
        </DialogHeader>

        {currentPrompt.trim() && (
          <div className="rounded-2xl bg-foreground/[0.035] p-3.5 space-y-2">
            <div className="text-xs font-medium text-muted-foreground">
              收藏当前提示词
            </div>
            <div className="flex flex-wrap sm:flex-nowrap gap-2">
              <Input
                value={newTitle}
                onChange={(e) => setNewTitle(e.target.value)}
                placeholder="配方名称..."
                className="h-8 text-xs flex-1 bg-background/80"
              />
              <Input
                value={newCategory}
                onChange={(e) => setNewCategory(e.target.value)}
                placeholder="分类"
                className="h-8 text-xs w-28 bg-background/80"
              />
              <Button
                type="button"
                size="sm"
                className="h-8 shrink-0"
                disabled={savingNew}
                onClick={handleCreate}
              >
                <Plus className="h-3.5 w-3.5" />
                收藏
              </Button>
            </div>
          </div>
        )}

        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="搜索配方..."
            className="h-9 pl-9 text-xs rounded-full"
          />
        </div>

        <div className="flex-1 overflow-y-auto space-y-2.5 pr-1 min-h-[260px] studio-scroll">
          {filtered.map((tpl) => (
            <div
              key={tpl.id}
              className="rounded-2xl bg-foreground/[0.035] hover:bg-foreground/[0.055] p-4 space-y-2.5 transition-colors"
            >
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2 min-w-0">
                  <Badge variant="secondary">{tpl.category}</Badge>
                  <span className="text-xs font-semibold truncate">
                    {tpl.title}
                  </span>
                </div>
                <div className="flex items-center gap-1.5 shrink-0">
                  {tpl.size && (
                    <Badge
                      variant="outline"
                      className="font-mono text-[10px] px-2 py-0"
                    >
                      {tpl.size}
                    </Badge>
                  )}
                </div>
              </div>

              <p className="text-xs text-muted-foreground leading-relaxed line-clamp-3 whitespace-pre-line">
                {tpl.prompt}
              </p>

              <div className="flex items-center justify-between pt-0.5">
                <div className="flex items-center gap-2">
                  <Button
                    type="button"
                    size="xs"
                    onClick={() => {
                      onApplyTemplate(tpl, true)
                      onOpenChange(false)
                    }}
                  >
                    使用配方
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    size="xs"
                    onClick={() => {
                      onApplyTemplate(tpl, false)
                      onOpenChange(false)
                    }}
                  >
                    仅填文字
                  </Button>
                </div>

                {!tpl.built_in && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="xs"
                    className="text-muted-foreground hover:text-destructive"
                    onClick={() => onDeleteCustomTemplate(tpl.id)}
                  >
                    <Trash2 className="h-3 w-3" />
                  </Button>
                )}
              </div>
            </div>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  )
}

interface DevPreviewDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  preview: {
    jsonBody: string
    curlCmd: string
    cliCmd: string
  }
  onCopyText: (text: string, msg?: string) => void
}

export const DevPreviewDialog: React.FC<DevPreviewDialogProps> = ({
  open,
  onOpenChange,
  preview,
  onCopyText,
}) => {
  const [tab, setTab] = useState("json")
  const activeCode =
    tab === "json"
      ? preview.jsonBody
      : tab === "curl"
      ? preview.curlCmd
      : preview.cliCmd

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>请求预览</DialogTitle>
          <DialogDescription className="sr-only">
            查看当前参数对应的 API JSON、cURL 与 CLI 命令
          </DialogDescription>
        </DialogHeader>

        <Tabs value={tab} onValueChange={setTab} className="w-full">
          <div className="flex items-center justify-between">
            <TabsList>
              <TabsTrigger value="json">JSON</TabsTrigger>
              <TabsTrigger value="curl">cURL</TabsTrigger>
              <TabsTrigger value="cli">CLI</TabsTrigger>
            </TabsList>
            <Button
              type="button"
              variant="outline"
              size="xs"
              onClick={() => onCopyText(activeCode, "已复制")}
            >
              <Copy className="h-3 w-3" />
              复制
            </Button>
          </div>

          <pre className="mt-3 max-h-80 overflow-auto rounded-2xl bg-foreground/[0.04] p-4 font-mono text-xs leading-relaxed text-foreground studio-scroll">
            {activeCode}
          </pre>
        </Tabs>
      </DialogContent>
    </Dialog>
  )
}

interface ImportTaskDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onImportTask: (taskId: string) => Promise<void>
}

export const ImportTaskDialog: React.FC<ImportTaskDialogProps> = ({
  open,
  onOpenChange,
  onImportTask,
}) => {
  const [taskId, setTaskId] = useState("")
  const [loading, setLoading] = useState(false)

  const handleConfirm = async () => {
    if (!taskId.trim()) return
    setLoading(true)
    try {
      await onImportTask(taskId.trim())
      setTaskId("")
      onOpenChange(false)
    } finally {
      setLoading(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>导入任务</DialogTitle>
          <DialogDescription className="sr-only">
            通过异步任务 ID 同步生成进度与结果
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-2 py-1">
          <Label htmlFor="input-manual-task-id">任务 ID</Label>
          <Input
            id="input-manual-task-id"
            value={taskId}
            onChange={(e) => setTaskId(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault()
                handleConfirm()
              }
            }}
            placeholder="输入异步任务 ID..."
            className="font-mono text-xs"
          />
        </div>

        <DialogFooter>
          <Button
            type="button"
            variant="ghost"
            onClick={() => onOpenChange(false)}
          >
            取消
          </Button>
          <Button
            id="btn-confirm-query-task"
            type="button"
            disabled={loading || !taskId.trim()}
            onClick={handleConfirm}
          >
            {loading ? "查询中..." : "导入"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
