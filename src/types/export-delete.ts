/**
 * Export & Delete Types
 *
 * Type definitions for the Export & Delete workflow feature that allows
 * users to backup meeting data before deletion with various export formats
 * and templates.
 */

// ============================================================================
// Export Format Types
// ============================================================================

/**
 * Available export formats
 * - json: Complete JSON archive with all data (transcripts, notes, tasks, metadata)
 * - pdf: Formatted PDF report (notes, transcript, tasks)
 * - audio: ZIP archive containing all audio recordings
 * - full: Complete backup with audio files + JSON data
 */
export type ExportArchiveFormat = 'json' | 'pdf' | 'audio' | 'full'

/**
 * Export template presets for different use cases
 * - meeting_minutes: Summary + action items (concise)
 * - full_transcript: Complete conversation with timestamps
 * - action_items_only: Just tasks and decisions
 * - custom: User-defined selection of content
 */
export type ExportTemplate = 'meeting_minutes' | 'full_transcript' | 'action_items_only' | 'custom'

// ============================================================================
// Export Configuration
// ============================================================================

/**
 * Configuration for what content to include in export
 */
export interface ExportContentConfig {
  /** Include meeting metadata (title, date, duration, type) */
  includeMetadata: boolean
  /** Include summary notes */
  includeSummary: boolean
  /** Include key points */
  includeKeyPoints: boolean
  /** Include action items and tasks */
  includeActionItems: boolean
  /** Include decisions */
  includeDecisions: boolean
  /** Include full transcript */
  includeTranscript: boolean
  /** Include speaker information */
  includeSpeakers: boolean
  /** Include timestamps in transcript */
  includeTimestamps: boolean
  /** Include custom notes */
  includeCustomNotes: boolean
}

/**
 * Full export options
 */
export interface ExportOptions {
  /** Export format */
  format: ExportArchiveFormat
  /** Export template (pre-configured content selection) */
  template?: ExportTemplate
  /** Content configuration (overrides template if provided) */
  content?: Partial<ExportContentConfig>
  /** Output file path (optional - will prompt if not provided) */
  outputPath?: string
  /** Whether to compress the output (for JSON and full formats) */
  compress?: boolean
  /** Include audio files in the export */
  includeAudio?: boolean
}

// ============================================================================
// Export Preview & Progress Types
// ============================================================================

/**
 * Preview of what will be exported
 */
export interface ExportPreview {
  meetingId: string
  meetingTitle: string
  /** Total estimated file size in bytes */
  estimatedSizeBytes: number
  /** Breakdown of sizes by content type */
  sizeBreakdown: {
    metadata: number
    transcripts: number
    notes: number
    tasks: number
    audioFiles: number
  }
  /** Count of items to be exported */
  itemCounts: {
    transcriptSegments: number
    notes: number
    tasks: number
    speakers: number
    audioFiles: number
  }
  /** Audio file paths that will be included */
  audioFilePaths: string[]
  /** Estimated export time in milliseconds */
  estimatedTimeMs: number
}

/**
 * Export progress information
 */
export interface ExportProgress {
  /** Current step in the export process */
  step: 'preparing' | 'exporting_data' | 'exporting_audio' | 'compressing' | 'writing' | 'complete' | 'error'
  /** Progress percentage (0-100) */
  percent: number
  /** Current file being processed (if applicable) */
  currentFile?: string
  /** Number of files processed */
  filesProcessed: number
  /** Total number of files to process */
  totalFiles: number
  /** Bytes written so far */
  bytesWritten: number
  /** Total bytes to write */
  totalBytes: number
  /** Error message if step is 'error' */
  error?: string
}

// ============================================================================
// Export Result Types
// ============================================================================

/**
 * Result of an export operation
 */
export interface ExportResult {
  success: boolean
  /** Path to the exported file */
  filePath?: string
  /** Final file size in bytes */
  fileSizeBytes?: number
  /** Export format used */
  format: ExportArchiveFormat
  /** What was included in the export */
  exportedContent: {
    transcriptSegments: number
    notes: number
    tasks: number
    speakers: number
    audioFiles: number
  }
  /** Duration of export in milliseconds */
  durationMs: number
  /** Error message if failed */
  error?: string
}

/**
 * Result of batch export operation
 */
export interface BatchExportResult {
  success: boolean
  /** Total meetings exported */
  totalMeetings: number
  /** Successfully exported meetings */
  successfulExports: number
  /** Failed exports */
  failedExports: number
  /** Individual results */
  results: ExportResult[]
  /** Output path (directory for batch export) */
  outputPath?: string
  /** Total size of all exports in bytes */
  totalSizeBytes: number
  /** Errors encountered */
  errors: string[]
}

// ============================================================================
// Import Types
// ============================================================================

/**
 * Information about an import file
 */
export interface ImportFileInfo {
  /** Path to the import file */
  filePath: string
  /** Format detected from the file */
  format: ExportArchiveFormat
  /** Is this a valid export file */
  isValid: boolean
  /** Meeting info from the export */
  meetingInfo?: {
    id: string
    title: string
    date: string
    duration: number | null
  }
  /** Content that can be restored */
  availableContent: {
    hasMetadata: boolean
    hasTranscripts: boolean
    hasNotes: boolean
    hasTasks: boolean
    hasSpeakers: boolean
    hasAudio: boolean
  }
  /** File size in bytes */
  fileSizeBytes: number
  /** Export date */
  exportDate?: string
  /** Validation errors if not valid */
  validationErrors?: string[]
}

/**
 * Options for importing a meeting
 */
export interface ImportOptions {
  /** How to handle ID conflicts */
  conflictResolution: 'skip' | 'replace' | 'create_new'
  /** What to import from the file */
  importContent: {
    metadata: boolean
    transcripts: boolean
    notes: boolean
    tasks: boolean
    speakers: boolean
    audio: boolean
  }
  /** Custom title for the imported meeting (optional) */
  customTitle?: string
}

/**
 * Result of an import operation
 */
export interface ImportResult {
  success: boolean
  /** ID of the imported/created meeting */
  meetingId?: string
  /** What was imported */
  importedContent: {
    transcripts: number
    notes: number
    tasks: number
    speakers: number
    audioFiles: number
  }
  /** Whether a conflict was encountered */
  hadConflict: boolean
  /** How the conflict was resolved */
  conflictResolution?: 'skipped' | 'replaced' | 'created_new'
  /** Duration of import in milliseconds */
  durationMs: number
  /** Error message if failed */
  error?: string
}

// ============================================================================
// Export & Delete Combined Types
// ============================================================================

/**
 * Options for the combined export-and-delete workflow
 */
export interface ExportAndDeleteOptions {
  /** Export options */
  export: ExportOptions
  /** Whether to delete after successful export */
  deleteAfterExport: boolean
  /** Deletion options (if deleting) */
  deletion?: {
    /** How to handle tasks */
    taskHandling: 'delete' | 'unlink' | 'keep'
    /** Whether to soft-delete (can be restored) */
    softDelete: boolean
  }
}

/**
 * Result of export-and-delete operation
 */
export interface ExportAndDeleteResult {
  /** Export result */
  exportResult: ExportResult
  /** Whether deletion was performed */
  deleted: boolean
  /** Deletion details (if deleted) */
  deletionResult?: {
    success: boolean
    freedSpaceBytes: number
    error?: string
  }
  /** Overall success (export succeeded, and if requested, delete succeeded) */
  success: boolean
}

// ============================================================================
// Archive to Disk Types
// ============================================================================

/**
 * Options for one-click archive to disk
 */
export interface ArchiveToDiskOptions {
  /** Base output directory */
  outputDirectory?: string
  /** Use date-based folder structure (YYYY/MM/) */
  useDateFolders?: boolean
  /** Export format for the archive */
  format: ExportArchiveFormat
  /** Template to use */
  template?: ExportTemplate
  /** Delete meeting after archiving */
  deleteAfterArchive: boolean
}

/**
 * Result of archive to disk operation
 */
export interface ArchiveToDiskResult {
  success: boolean
  /** Final archive path */
  archivePath?: string
  /** Size of archive in bytes */
  archiveSizeBytes?: number
  /** Meeting was deleted */
  meetingDeleted: boolean
  /** Freed space (if deleted) */
  freedSpaceBytes?: number
  error?: string
}

// ============================================================================
// Template Content Definitions
// ============================================================================

/**
 * Predefined content configurations for each template
 */
export const TEMPLATE_CONFIGS: Record<ExportTemplate, ExportContentConfig> = {
  meeting_minutes: {
    includeMetadata: true,
    includeSummary: true,
    includeKeyPoints: true,
    includeActionItems: true,
    includeDecisions: true,
    includeTranscript: false,
    includeSpeakers: true,
    includeTimestamps: false,
    includeCustomNotes: false
  },
  full_transcript: {
    includeMetadata: true,
    includeSummary: false,
    includeKeyPoints: false,
    includeActionItems: false,
    includeDecisions: false,
    includeTranscript: true,
    includeSpeakers: true,
    includeTimestamps: true,
    includeCustomNotes: false
  },
  action_items_only: {
    includeMetadata: true,
    includeSummary: false,
    includeKeyPoints: false,
    includeActionItems: true,
    includeDecisions: true,
    includeTranscript: false,
    includeSpeakers: false,
    includeTimestamps: false,
    includeCustomNotes: false
  },
  custom: {
    includeMetadata: true,
    includeSummary: true,
    includeKeyPoints: true,
    includeActionItems: true,
    includeDecisions: true,
    includeTranscript: true,
    includeSpeakers: true,
    includeTimestamps: true,
    includeCustomNotes: true
  }
}

// ============================================================================
// API Types
// ============================================================================

/**
 * Export & Delete API interface for IPC
 */
export interface ExportDeleteAPI {
  // Export operations
  getExportPreview: (meetingId: string, options: ExportOptions) => Promise<ExportPreview>
  exportMeeting: (meetingId: string, options: ExportOptions) => Promise<ExportResult>
  exportMeetingsBatch: (meetingIds: string[], options: ExportOptions) => Promise<BatchExportResult>

  // Import operations
  validateImportFile: (filePath: string) => Promise<ImportFileInfo>
  importMeeting: (filePath: string, options: ImportOptions) => Promise<ImportResult>

  // Combined operations
  exportAndDelete: (meetingId: string, options: ExportAndDeleteOptions) => Promise<ExportAndDeleteResult>
  archiveToDisk: (meetingId: string, options: ArchiveToDiskOptions) => Promise<ArchiveToDiskResult>

  // Progress tracking
  onExportProgress: (callback: (progress: ExportProgress) => void) => () => void

  // Utility
  getTemplateConfig: (template: ExportTemplate) => ExportContentConfig
  estimateExportSize: (meetingId: string, options: ExportOptions) => Promise<number>
}
