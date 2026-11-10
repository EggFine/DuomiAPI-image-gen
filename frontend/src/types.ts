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

export interface ServerInfoResponse {
  data_dir: string
  images_dir: string
  has_key: boolean
  ratio_presets: RatioPresetGroup[]
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
}

export interface SavedImage {
  remote_url: string
  local_file: string
  file_name: string
}

export interface TaskRecord {
  id: string
  model: string
  prompt: string
  size: string
  quality: string
  background: string
  n: number
  oversea: boolean
  callback_url?: string
  ref_count: number
  ref_previews?: string[]
  state: "pending" | "running" | "succeeded" | "error" | "failed" | "timeout" | string
  progress: number
  images?: SavedImage[]
  description?: string
  error_msg?: string
  create_time: number
  update_time: number
  raw_response?: string
}

export interface ReferenceImageEntry {
  id: string
  type: "url" | "base64"
  value: string
  preview: string
  label: string
  uploading?: boolean
}
