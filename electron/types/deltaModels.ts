/**
 * Delta Model Types
 *
 * Type definitions for the delta-based model update system.
 * Enables efficient model updates by downloading only changed chunks
 * instead of full multi-gigabyte model files.
 */

// ============================================================================
// Chunk and Storage Types
// ============================================================================

/**
 * Compression type used for stored chunks
 */
export type CompressionType = 'none' | 'gzip' | 'zstd'

/**
 * Status of a chunk in the local storage
 */
export type ChunkStatus = 'pending' | 'downloading' | 'verified' | 'corrupted' | 'missing'

/**
 * Metadata for a single content-addressed chunk
 */
export interface ChunkMetadata {
  /** SHA256 hash of the chunk content (content address) */
  hash: string
  /** Index of this chunk within the model */
  chunkIndex: number
  /** Original uncompressed size in bytes */
  originalSize: number
  /** Compressed size in bytes (same as originalSize if no compression) */
  compressedSize: number
  /** Compression type used */
  compressionType: CompressionType
  /** Offset in the original model file */
  offset: number
  /** Timestamp when this chunk was created/downloaded */
  createdAt: number
  /** Status of the chunk */
  status: ChunkStatus
}

/**
 * Stored chunk record in the database
 */
export interface StoredChunk extends ChunkMetadata {
  /** Database ID */
  id: string
  /** Model ID this chunk belongs to */
  modelId: string
  /** Model version this chunk belongs to */
  version: string
  /** Local file path where chunk is stored */
  localPath: string
  /** Reference count for deduplication */
  refCount: number
  /** Last access timestamp for LRU cleanup */
  lastAccessedAt: number
}

// ============================================================================
// Manifest Types
// ============================================================================

/**
 * Information about a delta between two versions
 */
export interface DeltaInfo {
  /** Source version */
  fromVersion: string
  /** Target version */
  toVersion: string
  /** Number of new chunks needed */
  newChunksCount: number
  /** Total size of new chunks to download (bytes) */
  downloadSize: number
  /** Chunks that are unchanged (reusable) */
  reusableChunksCount: number
  /** Estimated time to download (seconds) at reference bandwidth */
  estimatedDownloadTime: number
}

/**
 * Chunk entry in a model version manifest
 */
export interface ManifestChunk {
  /** SHA256 hash of the chunk */
  hash: string
  /** Chunk index in the model */
  index: number
  /** Compressed size in bytes */
  size: number
  /** Compression type */
  compressionType: CompressionType
  /** Download URL for this chunk */
  downloadUrl?: string
}

/**
 * Model version information in the manifest
 */
export interface ModelVersionInfo {
  /** Version identifier */
  version: string
  /** Total number of chunks */
  totalChunks: number
  /** Total size when assembled */
  totalSize: number
  /** Size per chunk */
  chunkSize: number
  /** SHA256 hash of the fully assembled model */
  assembledHash: string
  /** Ordered list of chunk hashes */
  chunks: ManifestChunk[]
  /** Release date */
  releasedAt: string
  /** Release notes */
  releaseNotes?: string
}

/**
 * Complete model manifest with version history
 */
export interface ModelManifest {
  /** Unique model identifier */
  modelId: string
  /** Human-readable model name */
  name: string
  /** Model type (whisper, pyannote, etc.) */
  type: 'whisper' | 'pyannote' | 'speechbrain' | 'other'
  /** Available versions */
  versions: ModelVersionInfo[]
  /** Latest/recommended version */
  latestVersion: string
  /** Pre-computed deltas between versions */
  deltas: DeltaInfo[]
  /** Base URL for chunk downloads */
  baseDownloadUrl: string
  /** Manifest version for compatibility */
  manifestVersion: number
  /** Last updated timestamp */
  updatedAt: string
}

/**
 * Complete registry of all models with delta support
 */
export interface ModelDeltaRegistry {
  /** Registry version */
  version: number
  /** All available models */
  models: ModelManifest[]
  /** Registry update URL */
  updateUrl: string
  /** Last updated timestamp */
  updatedAt: string
}

// ============================================================================
// Download and Update Types
// ============================================================================

/**
 * Phase of the download process
 */
export type DownloadPhase =
  | 'idle'
  | 'checking'
  | 'calculating'
  | 'downloading'
  | 'verifying'
  | 'assembling'
  | 'complete'
  | 'error'
  | 'paused'
  | 'cancelled'

/**
 * Priority level for download queue
 */
export type DownloadPriority = 'critical' | 'high' | 'normal' | 'low' | 'background'

/**
 * Plan for downloading a delta update
 */
export interface DeltaPlan {
  /** Model being updated */
  modelId: string
  /** Current local version (null if new download) */
  currentVersion: string | null
  /** Target version to download */
  targetVersion: string
  /** Chunks that need to be downloaded */
  chunksToDownload: ManifestChunk[]
  /** Chunks that can be reused from local storage */
  chunksToReuse: string[] // chunk hashes
  /** Total download size in bytes */
  totalDownloadSize: number
  /** Total chunks needed */
  totalChunks: number
  /** Reused chunks count */
  reusedChunks: number
  /** Percentage of data reused (0-100) */
  reusePercentage: number
  /** Estimated download time in seconds */
  estimatedDownloadTime: number
  /** Whether this is a full download or delta */
  isDelta: boolean
}

/**
 * Progress information for a single chunk download
 */
export interface ChunkDownloadProgress {
  /** Chunk hash being downloaded */
  chunkHash: string
  /** Chunk index */
  chunkIndex: number
  /** Bytes downloaded so far */
  bytesDownloaded: number
  /** Total bytes for this chunk */
  totalBytes: number
  /** Download speed in bytes/second */
  speed: number
  /** Percentage complete (0-100) */
  percent: number
}

/**
 * Overall download progress for a model update
 */
export interface ModelDownloadProgress {
  /** Model being downloaded */
  modelId: string
  /** Target version */
  targetVersion: string
  /** Current phase */
  phase: DownloadPhase
  /** Overall progress (0-100) */
  overallProgress: number
  /** Chunks completed */
  chunksCompleted: number
  /** Total chunks to download */
  totalChunks: number
  /** Total bytes downloaded */
  bytesDownloaded: number
  /** Total bytes to download */
  totalBytes: number
  /** Current download speed in bytes/second */
  speed: number
  /** Estimated time remaining in seconds */
  eta: number
  /** Current chunk progress (if downloading) */
  currentChunk?: ChunkDownloadProgress
  /** Human-readable status message */
  message: string
  /** Error message (if phase is 'error') */
  error?: string
  /** Timestamp when download started */
  startedAt: number
  /** Whether this is a delta update */
  isDelta: boolean
  /** Percentage of data reused from existing chunks */
  reusePercentage: number
}

/**
 * Item in the download queue
 */
export interface DownloadQueueItem {
  /** Unique queue item ID */
  id: string
  /** Model ID */
  modelId: string
  /** Target version */
  targetVersion: string
  /** Download priority */
  priority: DownloadPriority
  /** Delta plan for this download */
  plan: DeltaPlan
  /** Current status */
  status: 'queued' | 'active' | 'paused' | 'completed' | 'failed' | 'cancelled'
  /** Progress information */
  progress: ModelDownloadProgress
  /** When this item was added to the queue */
  queuedAt: number
  /** When download started (null if not started) */
  startedAt: number | null
  /** When download completed (null if not completed) */
  completedAt: number | null
  /** Number of retry attempts */
  retryCount: number
  /** Maximum retry attempts */
  maxRetries: number
  /** Error message if failed */
  error?: string
}

// ============================================================================
// Scheduler Types
// ============================================================================

/**
 * Scheduler status
 */
export type SchedulerStatus = 'running' | 'paused' | 'idle' | 'disabled'

/**
 * Reason for pausing the scheduler
 */
export type PauseReason =
  | 'user_requested'
  | 'low_battery'
  | 'user_active'
  | 'network_unavailable'
  | 'metered_connection'
  | 'recording_active'
  | 'system_busy'

/**
 * Configuration for the update scheduler
 */
export interface SchedulerConfig {
  /** Whether the scheduler is enabled */
  enabled: boolean
  /** Check for updates on app startup */
  checkOnStartup: boolean
  /** Interval between update checks (milliseconds) */
  checkInterval: number
  /** Minimum idle time before starting downloads (milliseconds) */
  minIdleTime: number
  /** Maximum bandwidth for background downloads (bytes/second, 0 = unlimited) */
  maxBandwidth: number
  /** Minimum battery level for downloads (0-100, 0 = ignore battery) */
  minBatteryLevel: number
  /** Whether to pause on metered connections */
  pauseOnMetered: boolean
  /** Whether to pause during active recording */
  pauseDuringRecording: boolean
  /** Hours during which downloads are allowed (e.g., [0, 24] for any time) */
  allowedHours: [number, number]
  /** Maximum concurrent downloads */
  maxConcurrentDownloads: number
  /** Whether to show notifications for available updates */
  notifyOnAvailable: boolean
  /** Whether to show notifications when downloads complete */
  notifyOnComplete: boolean
}

/**
 * Current state of the scheduler
 */
export interface SchedulerState {
  /** Current scheduler status */
  status: SchedulerStatus
  /** Reason for current pause (if paused) */
  pauseReason?: PauseReason
  /** Last update check timestamp */
  lastCheckAt: number | null
  /** Next scheduled check timestamp */
  nextCheckAt: number | null
  /** Current system idle time (milliseconds) */
  systemIdleTime: number
  /** Current battery level (0-100, null if not available) */
  batteryLevel: number | null
  /** Whether on battery power */
  onBattery: boolean
  /** Whether network is available */
  networkAvailable: boolean
  /** Whether on metered connection */
  isMetered: boolean
  /** Whether a recording is active */
  recordingActive: boolean
  /** Number of items in download queue */
  queueLength: number
  /** Active downloads count */
  activeDownloads: number
}

/**
 * Available update information
 */
export interface ModelUpdateInfo {
  /** Model ID */
  modelId: string
  /** Model name */
  modelName: string
  /** Current local version (null if not installed) */
  currentVersion: string | null
  /** Latest available version */
  latestVersion: string
  /** Whether update is available */
  updateAvailable: boolean
  /** Delta plan for the update */
  deltaPlan?: DeltaPlan
  /** Release notes for the update */
  releaseNotes?: string
  /** Release date */
  releasedAt?: string
  /** Whether this is a required update */
  required: boolean
}

/**
 * Result of checking for model updates
 */
export interface ModelUpdateCheckResult {
  /** Timestamp of the check */
  checkedAt: number
  /** Available updates */
  updates: ModelUpdateInfo[]
  /** Total download size for all updates */
  totalDownloadSize: number
  /** Whether any required updates are available */
  hasRequiredUpdates: boolean
  /** Error message if check failed */
  error?: string
}

// ============================================================================
// Database Record Types
// ============================================================================

/**
 * Database record for model chunks table
 */
export interface ModelChunkRecord {
  id: string
  hash: string
  model_id: string
  version: string
  chunk_index: number
  original_size: number
  compressed_size: number
  compression_type: string
  local_path: string
  ref_count: number
  status: string
  created_at: number
  last_accessed_at: number
}

/**
 * Database record for model manifests table
 */
export interface ModelManifestRecord {
  id: string
  model_id: string
  version: string
  manifest_json: string
  total_chunks: number
  total_size: number
  chunk_size: number
  assembled_hash: string
  is_current: number
  created_at: number
  updated_at: number
}

/**
 * Database record for model update queue table
 */
export interface ModelUpdateQueueRecord {
  id: string
  model_id: string
  target_version: string
  priority: string
  status: string
  plan_json: string
  progress_json: string
  queued_at: number
  started_at: number | null
  completed_at: number | null
  retry_count: number
  max_retries: number
  error: string | null
}

/**
 * Database record for chunk deduplication index
 */
export interface ChunkDeduplicationRecord {
  hash: string
  chunk_id: string
  created_at: number
}

// ============================================================================
// Event Types
// ============================================================================

/**
 * Events emitted by the delta model system
 */
export interface DeltaModelEvents {
  /** Emitted when an update check completes */
  'update-check-complete': ModelUpdateCheckResult
  /** Emitted when download progress changes */
  'download-progress': ModelDownloadProgress
  /** Emitted when a download completes */
  'download-complete': { modelId: string; version: string }
  /** Emitted when a download fails */
  'download-error': { modelId: string; error: string }
  /** Emitted when scheduler state changes */
  'scheduler-state-change': SchedulerState
  /** Emitted when a model is assembled and ready */
  'model-ready': { modelId: string; version: string; path: string }
  /** Emitted when chunk cleanup completes */
  'cleanup-complete': { freedBytes: number; deletedChunks: number }
}

// ============================================================================
// Configuration Types
// ============================================================================

/**
 * Configuration for the delta model storage service
 */
export interface DeltaStorageConfig {
  /** Directory for storing chunks */
  chunksDirectory: string
  /** Directory for assembled models */
  modelsDirectory: string
  /** Default chunk size in bytes */
  defaultChunkSize: number
  /** Default compression type */
  defaultCompression: CompressionType
  /** Maximum cache size in bytes (0 = unlimited) */
  maxCacheSize: number
  /** Whether to verify chunks on read */
  verifyOnRead: boolean
  /** Whether to cleanup unused chunks automatically */
  autoCleanup: boolean
  /** Age threshold for cleanup (milliseconds) */
  cleanupAge: number
}

/**
 * Configuration for the delta download manager
 */
export interface DeltaDownloadConfig {
  /** Maximum concurrent chunk downloads */
  maxConcurrentChunks: number
  /** Chunk download timeout (milliseconds) */
  chunkTimeout: number
  /** Number of retries per chunk */
  chunkRetries: number
  /** Delay between retries (milliseconds) */
  retryDelay: number
  /** Whether to verify chunks after download */
  verifyAfterDownload: boolean
  /** Buffer size for file operations */
  bufferSize: number
  /** Maximum bandwidth (bytes/second, 0 = unlimited) */
  maxBandwidth: number
}

// ============================================================================
// API Response Types
// ============================================================================

/**
 * Response from the model update API
 */
export interface ModelUpdateAPIResponse {
  success: boolean
  data?: ModelDeltaRegistry
  error?: string
  timestamp: number
}

/**
 * Response from chunk download
 */
export interface ChunkDownloadResponse {
  success: boolean
  chunk?: Buffer
  hash?: string
  error?: string
}
