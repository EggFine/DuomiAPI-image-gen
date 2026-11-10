export type RefImageMode = "upload" | "compress_base64" | "raw_base64"

export type ImageHostProvider =
  | "auto"
  | "litterbox"
  | "catbox"
  | "tmpfiles"
  | "uguu"
  | "0x0"
  | "custom"

export type StudioNavTab = "imagine" | "gallery" | "recipes" | "analytics"

export type ComposerLayoutMode = "omnibar" | "split"

export interface SizePresetItem {
  value: string
  tier: string
  label: string
  detail: string
}

export interface RatioPresetGroup {
  ratio: string
  name: string
  aspect_w: number
  aspect_h: number
  default_size: string
  sizes: SizePresetItem[]
}

export interface ModelInfo {
  id: string
  name: string
  badge: string
  price: string
  description: string
}

export interface ImageHostInfo {
  id: ImageHostProvider
  name: string
  desc: string
}

export interface PromptTemplate {
  id: string
  title: string
  category: string
  summary?: string
  prompt: string
  model?: string
  size?: string
  quality?: string
  background?: string
  tags?: string[]
  built_in?: boolean
  created_at?: number
}

export interface ProjectFolder {
  id: string
  name: string
  color?: string
  created_at?: number
}

export interface DiskUsageStats {
  data_dir: string
  images_dir: string
  generated_count: number
  generated_bytes?: number
  ref_cache_count: number
  ref_cache_bytes?: number
  record_count: number
  total_bytes: number
}

export interface ServerInfoResponse {
  version: string
  data_dir: string
  images_dir: string
  has_key: boolean
  disk_stats: DiskUsageStats
  ratio_presets: RatioPresetGroup[]
  builtin_templates: PromptTemplate[]
  image_hosts: ImageHostInfo[]
  models: ModelInfo[]
}

export interface AppConfig {
  api_key: string
  base_url: string
  default_model: string
  default_size: string
  oversea: boolean
  poll_interval: number
  poll_timeout: number
  auto_download: boolean
  ref_image_mode: RefImageMode
  image_host_provider: ImageHostProvider
  litterbox_expiry: "1h" | "12h" | "24h" | "72h" | string
  custom_upload_url: string
  custom_upload_field: string
  custom_upload_auth: string
  custom_upload_json_path: string
  compress_max_dim: number
  compress_quality: number
  auto_compat_fallback: boolean
  prompt_templates?: PromptTemplate[]
  projects?: ProjectFolder[]
}

export interface SavedImage {
  remote_url: string
  local_file: string
  file_name: string
  width?: number
  height?: number
  size_bytes?: number
}

export interface SavedRefImage {
  local_ref?: string
  remote_url?: string
  mode?: string
  provider?: string
  label?: string
}

export interface TaskRecord {
  id: string
  batch_id?: string
  project_id?: string
  tags?: string[]
  note?: string
  model: string
  prompt: string
  size: string
  quality: string
  background: string
  n: number
  oversea: boolean
  callback_url?: string
  ref_mode?: string
  ref_count: number
  ref_previews?: string[]
  ref_items?: SavedRefImage[]
  starred?: boolean
  state:
    | "pending"
    | "running"
    | "succeeded"
    | "error"
    | "failed"
    | "timeout"
    | "canceled"
    | string
  progress: number
  images?: SavedImage[]
  description?: string
  warning_msg?: string
  error_msg?: string
  create_time: number
  update_time: number
  duration_ms?: number
  raw_response?: string
}

export interface ReferenceImageEntry {
  id: string
  mode: RefImageMode | "url"
  value: string // URL or data:image/...;base64,...
  preview: string
  original_preview?: string // preserved unannotated preview so user can re-edit
  local_ref?: string // e.g. "refs/ref_xxxx.jpg"
  remote_url?: string
  provider?: string
  label: string
  annotated?: boolean
  width?: number
  height?: number
  size_bytes?: number
  orig_bytes?: number
  uploading?: boolean
  error?: string
}

export interface UploadRefResponse {
  mode: RefImageMode
  url?: string
  value: string
  provider?: string
  local_ref?: string
  preview_url?: string
  size_bytes?: number
  orig_bytes?: number
  width?: number
  height?: number
  label?: string
  error?: string
}

export interface ConnectivityTestResult {
  ok: boolean
  latency_ms: number
  status?: number
  message: string
}

export interface PromptHistoryItem {
  id: string
  prompt: string
  model: string
  size: string
  timestamp: number
}
