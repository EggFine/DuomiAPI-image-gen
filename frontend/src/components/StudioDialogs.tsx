import React, { useMemo, useState } from "react"
import {
  Activity,
  Archive,
  BookMarked,
  CheckCircle2,
  Copy,
  Eye,
  EyeOff,
  FolderOpen,
  HardDrive,
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
          <DialogTitle>工作台全局设置</DialogTitle>
          <DialogDescription>
            全部设置仅保存在运行目录{" "}
            <code className="font-mono text-foreground">
              duomi_data/config.json
            </code>{" "}
            中，纯绿色零注册表写入。
          </DialogDescription>
        </DialogHeader>

        <Tabs value={tab} onValueChange={setTab} className="w-full">
          <TabsList className="grid w-full grid-cols-3">
            <TabsTrigger value="api">接口与轮询</TabsTrigger>
            <TabsTrigger value="ref">图床与参考图策略</TabsTrigger>
            <TabsTrigger value="storage">便携存储管理</TabsTrigger>
          </TabsList>

          {/* Tab 1: API & Polling */}
          <TabsContent value="api" className="space-y-3.5 pt-3">
            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <Label htmlFor="cfg-api-key">
                  多米 API 密钥 (Authorization Key)
                </Label>
                <button
                  type="button"
                  disabled={testingConn}
                  onClick={handleTestConn}
                  className="inline-flex items-center gap-1 text-xs font-medium text-amber-600 dark:text-amber-400 hover:underline cursor-pointer"
                >
                  {testingConn ? (
                    <Loader2 className="h-3 w-3 animate-spin" />
                  ) : (
                    <Activity className="h-3 w-3" />
                  )}
                  测试连接与鉴权
                </button>
              </div>
              <div className="flex gap-1.5">
                <Input
                  id="cfg-api-key"
                  type={showKey ? "text" : "password"}
                  value={apiKey}
                  onChange={(e) => setApiKey(e.target.value)}
                  placeholder="输入多米控制台申请的密钥（明文即可，无需加 Bearer 前缀）"
                  className="font-mono text-xs"
                />
                <Button
                  type="button"
                  variant="outline"
                  size="icon"
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
                  className={`flex items-center gap-2 rounded-lg border px-3 py-2 text-xs ${
                    connResult.ok
                      ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"
                      : "border-destructive/40 bg-destructive/10 text-destructive"
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
              <Label htmlFor="cfg-base-url">API 基础地址 (Base URL)</Label>
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
                <Label htmlFor="cfg-poll-interval">后台轮询间隔 (秒)</Label>
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
                <Label htmlFor="cfg-poll-timeout">单任务超时上限 (秒)</Label>
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
              <div className="flex items-center justify-between rounded-xl border border-border bg-secondary/35 px-3 py-2.5">
                <Label
                  htmlFor="cfg-auto-download"
                  className="text-xs cursor-pointer"
                >
                  生成完成后自动下载原图到{" "}
                  <code className="font-mono">duomi_data/images/</code>
                </Label>
                <Switch
                  id="cfg-auto-download"
                  checked={autoDownload}
                  onCheckedChange={setAutoDownload}
                />
              </div>

              <div className="flex items-center justify-between rounded-xl border border-border bg-secondary/35 px-3 py-2.5">
                <Label
                  htmlFor="cfg-auto-compat"
                  className="text-xs cursor-pointer"
                >
                  遇到 fail_to_submit_task 时自动尝试兼容比例重试并显示提醒
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
          <TabsContent value="ref" className="space-y-3.5 pt-3">
            <div className="space-y-1.5">
              <Label>本地参考图默认处理方式</Label>
              <select
                value={refMode}
                onChange={(e) => setRefMode(e.target.value as RefImageMode)}
                className="flex h-9 w-full rounded-lg border border-input bg-card px-3 text-xs text-foreground focus:outline-none"
              >
                <option value="upload">
                  ☁️ 自动上传图床转 https:// 直链（默认推荐 · 原图无损保留细节）
                </option>
                <option value="compress_base64">
                  📦 压缩并转 Base64（可选项 · 仅本地处理，不经过图床）
                </option>
                <option value="raw_base64">
                  📄 原图直传 Base64（可选项 · 不压缩且不传图床，仅限小图）
                </option>
              </select>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>首选图床节点</Label>
                <select
                  value={hostProvider}
                  onChange={(e) =>
                    setHostProvider(e.target.value as ImageHostProvider)
                  }
                  className="flex h-9 w-full rounded-lg border border-input bg-card px-2.5 text-xs text-foreground focus:outline-none"
                >
                  {imageHosts.map((h) => (
                    <option key={h.id} value={h.id}>
                      {h.name}
                    </option>
                  ))}
                </select>
              </div>

              <div className="space-y-1.5">
                <Label>Litterbox 临时隐私销毁时间</Label>
                <select
                  value={litterboxExpiry}
                  onChange={(e) => setLitterboxExpiry(e.target.value)}
                  className="flex h-9 w-full rounded-lg border border-input bg-card px-2.5 font-mono text-xs text-foreground focus:outline-none"
                >
                  <option value="1h">1 小时后自动销毁</option>
                  <option value="12h">12 小时后自动销毁</option>
                  <option value="24h">24 小时后自动销毁</option>
                  <option value="72h">72 小时后自动销毁</option>
                </select>
              </div>
            </div>

            <div className="rounded-xl border border-border bg-secondary/30 p-3 space-y-2.5">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold">
                  自定义图床 API（可选 · 支持兰空 LskyPro / Chevereto / 自建接口）
                </span>
                <Badge variant="outline" className="text-[10px]">
                  选填
                </Badge>
              </div>
              <Input
                value={customUrl}
                onChange={(e) => setCustomUrl(e.target.value)}
                placeholder="上传接口 POST URL，例如 https://img.example.com/api/v1/upload"
                className="h-8 font-mono text-xs"
              />
              <div className="grid grid-cols-3 gap-2">
                <Input
                  value={customField}
                  onChange={(e) => setCustomField(e.target.value)}
                  placeholder="表单字段名 (默认 file)"
                  className="h-8 font-mono text-xs"
                />
                <Input
                  type="password"
                  value={customAuth}
                  onChange={(e) => setCustomAuth(e.target.value)}
                  placeholder="Authorization 头 (可选)"
                  className="h-8 font-mono text-xs"
                />
                <Input
                  value={customJsonPath}
                  onChange={(e) => setCustomJsonPath(e.target.value)}
                  placeholder="JSON路径 如 data.links.url"
                  className="h-8 font-mono text-xs"
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3 pt-1">
              <div className="space-y-1">
                <Label className="text-xs text-muted-foreground">
                  「压缩转Base64」最大边长 (px)
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
                  「压缩转Base64」JPEG 品质 (40~98)
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
          <TabsContent value="storage" className="space-y-3.5 pt-3">
            <div className="rounded-xl border border-border bg-secondary/35 p-4 space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <HardDrive className="h-4 w-4 text-amber-500" />
                  <span className="text-xs font-semibold">
                    绿色单目录存储统计
                  </span>
                </div>
                <Badge variant="amber" className="font-mono text-xs tabular-nums">
                  {formatBytes(diskStats?.total_bytes)}
                </Badge>
              </div>

              <div className="grid grid-cols-3 gap-2 text-center">
                <div className="rounded-lg border border-border bg-card p-2.5">
                  <div className="font-mono text-base font-semibold tabular-nums">
                    {diskStats?.record_count ?? 0}
                  </div>
                  <div className="text-[11px] text-muted-foreground">
                    历史任务记录
                  </div>
                </div>
                <div className="rounded-lg border border-border bg-card p-2.5">
                  <div className="font-mono text-base font-semibold tabular-nums">
                    {diskStats?.generated_count ?? 0}
                  </div>
                  <div className="text-[11px] text-muted-foreground">
                    已存生成原图
                  </div>
                </div>
                <div className="rounded-lg border border-border bg-card p-2.5">
                  <div className="font-mono text-base font-semibold tabular-nums">
                    {diskStats?.ref_cache_count ?? 0}
                  </div>
                  <div className="text-[11px] text-muted-foreground">
                    本地参考图存档
                  </div>
                </div>
              </div>

              <div className="space-y-1">
                <span className="text-[11px] text-muted-foreground">
                  本地物理目录路径:
                </span>
                <div className="flex items-center gap-1.5">
                  <code className="flex-1 truncate rounded-lg border border-border bg-card px-2.5 py-1.5 font-mono text-[11px]">
                    {diskStats?.data_dir || "./duomi_data"}
                  </code>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() =>
                      onCopyText(
                        diskStats?.data_dir || "./duomi_data",
                        "已复制数据目录完整路径"
                      )
                    }
                  >
                    <Copy className="h-3.5 w-3.5" />
                  </Button>
                  <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    onClick={onOpenLocalFolder}
                  >
                    <FolderOpen className="h-3.5 w-3.5 text-amber-500" />
                    打开目录
                  </Button>
                </div>
              </div>
            </div>

            <div className="flex justify-end">
              <Button asChild variant="outline" size="sm">
                <a href="/api/records/export-zip" download>
                  <Archive className="h-3.5 w-3.5" />
                  一键打包导出全部原图与记录备份 (.zip)
                </a>
              </Button>
            </div>
          </TabsContent>
        </Tabs>

        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={() => onOpenChange(false)}
          >
            取消
          </Button>
          <Button
            id="btn-save-config"
            type="button"
            variant="brand"
            disabled={saving}
            onClick={handleSave}
          >
            {saving ? "正在保存..." : "保存全局设置"}
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
  const [newCategory, setNewCategory] = useState("我的收藏")
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
        category: newCategory.trim() || "我的收藏",
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
          <DialogTitle className="flex items-center gap-2">
            <BookMarked className="h-4 w-4 text-amber-500" />
            提示词与参数模板库
          </DialogTitle>
          <DialogDescription>
            内置高一致性专业摄影/设计预设，并可将您常用的提示词保存在本地{" "}
            <code className="font-mono">duomi_data/config.json</code> 中随时复用。
          </DialogDescription>
        </DialogHeader>

        {/* Save current prompt bar */}
        {currentPrompt.trim() && (
          <div className="rounded-xl border border-amber-500/35 bg-amber-500/[0.06] p-3 space-y-2">
            <div className="text-xs font-medium text-foreground">
              将当前工作台提示词保存为个人模板：
            </div>
            <div className="flex flex-wrap sm:flex-nowrap gap-2">
              <Input
                value={newTitle}
                onChange={(e) => setNewTitle(e.target.value)}
                placeholder="输入模板名称（如：机房师生纪实抓拍）"
                className="h-8 text-xs flex-1"
              />
              <Input
                value={newCategory}
                onChange={(e) => setNewCategory(e.target.value)}
                placeholder="分类"
                className="h-8 text-xs w-28"
              />
              <Button
                type="button"
                variant="brand"
                size="sm"
                className="h-8 shrink-0"
                disabled={savingNew}
                onClick={handleCreate}
              >
                <Plus className="h-3.5 w-3.5" />
                保存当前
              </Button>
            </div>
          </div>
        )}

        <div className="relative">
          <Search className="pointer-events-none absolute left-2.5 top-2.5 h-3.5 w-3.5 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="搜索模板标题、分类或内容..."
            className="h-8 pl-8 text-xs"
          />
        </div>

        <div className="flex-1 overflow-y-auto space-y-2.5 pr-1 min-h-[260px]">
          {filtered.map((tpl) => (
            <div
              key={tpl.id}
              className="rounded-xl border border-border bg-background/60 p-3.5 space-y-2 hover:border-border/90"
            >
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2 min-w-0">
                  <Badge variant={tpl.built_in ? "secondary" : "amber"}>
                    {tpl.category}
                  </Badge>
                  <span className="text-xs font-semibold truncate">
                    {tpl.title}
                  </span>
                </div>
                <div className="flex items-center gap-1.5 shrink-0">
                  {tpl.model && (
                    <span className="font-mono text-[10px] text-muted-foreground">
                      {tpl.model}
                    </span>
                  )}
                  {tpl.size && (
                    <Badge variant="outline" className="font-mono text-[10px] px-1.5 py-0">
                      {tpl.size}
                    </Badge>
                  )}
                </div>
              </div>

              <p className="text-xs text-muted-foreground leading-relaxed line-clamp-3 whitespace-pre-line">
                {tpl.prompt}
              </p>

              <div className="flex items-center justify-between pt-1">
                <div className="flex items-center gap-2">
                  <Button
                    type="button"
                    variant="brand"
                    size="xs"
                    onClick={() => {
                      onApplyTemplate(tpl, true)
                      onOpenChange(false)
                    }}
                  >
                    载入提示词与推荐参数
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
                    仅填入提示词
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
                    删除
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
          <DialogTitle>等效 API 请求体与命令行预览</DialogTitle>
          <DialogDescription>
            100% 透明展示当前工作台将向多米 API 发送的实际字段（如参考图是图床直链还是 Base64）。
          </DialogDescription>
        </DialogHeader>

        <Tabs value={tab} onValueChange={setTab} className="w-full">
          <div className="flex items-center justify-between">
            <TabsList>
              <TabsTrigger value="json">API JSON 请求体</TabsTrigger>
              <TabsTrigger value="curl">cURL 命令</TabsTrigger>
              <TabsTrigger value="cli">CLI 命令行模式</TabsTrigger>
            </TabsList>
            <Button
              type="button"
              variant="secondary"
              size="xs"
              onClick={() => onCopyText(activeCode, "已复制代码内容")}
            >
              <Copy className="h-3 w-3" />
              一键复制
            </Button>
          </div>

          <pre className="mt-3 max-h-80 overflow-auto rounded-xl border border-border bg-background p-3.5 font-mono text-xs leading-relaxed text-foreground">
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
          <DialogTitle>通过任务 ID 查询或导入结果</DialogTitle>
          <DialogDescription>
            输入多米 API 返回的异步任务 ID（对应{" "}
            <code className="font-mono">GET /v1/tasks/&#123;id&#125;</code>
            ），同步进度并将生成的图片归档到本地图库。
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-2 py-2">
          <Label htmlFor="input-manual-task-id">任务 ID (Task ID)</Label>
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
            placeholder="例如: 6fa577ec-dadf-06cf-04fe-e231c5ee124c"
            className="font-mono text-xs"
          />
        </div>

        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={() => onOpenChange(false)}
          >
            取消
          </Button>
          <Button
            id="btn-confirm-query-task"
            type="button"
            variant="brand"
            disabled={loading || !taskId.trim()}
            onClick={handleConfirm}
          >
            {loading ? "正在查询..." : "立即查询并同步"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
