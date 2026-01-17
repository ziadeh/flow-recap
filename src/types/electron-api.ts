/**
 * TypeScript type definitions for Electron API types used in components
 * These types mirror the types defined in electron/preload.ts
 */

// Sentiment types
export type SentimentType = 'positive' | 'negative' | 'neutral' | 'mixed'

// Extracted Decision from decisionsAndTopics API
export interface ExtractedDecision {
  content: string
  speaker?: string
  context?: string
  sentiment: SentimentType
  confidence: number
  startTimeMs?: number
  endTimeMs?: number
  sourceTranscriptIds?: string[]
}

// Extracted Key Point from decisionsAndTopics API
export interface ExtractedKeyPoint {
  content: string
  category?: 'insight' | 'concern' | 'agreement' | 'disagreement' | 'question' | 'observation'
  speakers?: string[]
  sentiment: SentimentType
  importance: number
  sourceTranscriptIds?: string[]
}

// Extracted Topic from decisionsAndTopics API
export interface ExtractedTopic {
  name: string
  description: string
  durationMs: number
  startTimeMs: number
  endTimeMs: number
  sentiment: SentimentType
  keyPoints: string[]
  decisions: string[]
  speakers: string[]
  sourceTranscriptIds?: string[]
}

// Decisions and Topics Extraction Result
export interface DecisionsAndTopicsExtractionResult {
  decisions: ExtractedDecision[]
  keyPoints: ExtractedKeyPoint[]
  topics: ExtractedTopic[]
  overallSentiment: SentimentType
  sentimentBreakdown: {
    positive: number
    negative: number
    neutral: number
    mixed: number
  }
}

// Extraction Process Result
export interface ExtractionProcessResult {
  success: boolean
  error?: string
  extraction?: DecisionsAndTopicsExtractionResult
  createdNotes?: import('./database').MeetingNote[]
  metadata: {
    processingTimeMs: number
    transcriptSegmentCount: number
    transcriptCharacterCount: number
    llmResponseTimeMs?: number
    meetingDurationMs?: number
  }
}

// ============================================================================
// Export API Types
// ============================================================================

export type ExportFormat = 'pdf' | 'markdown'

export interface ExportConfig {
  includeSummary?: boolean
  includeActionItems?: boolean
  includeDecisions?: boolean
  includeTranscript?: boolean
  includeKeyPoints?: boolean
  includeMetadata?: boolean
}

export interface ExportResult {
  success: boolean
  filePath?: string
  error?: string
}

export interface ExportAPI {
  toPdf: (
    meetingId: string,
    outputPath?: string,
    config?: ExportConfig
  ) => Promise<ExportResult>
  toMarkdown: (
    meetingId: string,
    outputPath?: string,
    config?: ExportConfig
  ) => Promise<ExportResult>
  meeting: (
    meetingId: string,
    format: ExportFormat,
    outputPath?: string,
    config?: ExportConfig
  ) => Promise<ExportResult>
  getConfig: () => Promise<ExportConfig>
  updateConfig: (config: Partial<ExportConfig>) => Promise<{ success: boolean; error?: string }>
}

// ============================================================================
// Update API Types
// ============================================================================

export type UpdateStatus =
  | 'idle'
  | 'checking'
  | 'available'
  | 'not-available'
  | 'downloading'
  | 'downloaded'
  | 'installing'
  | 'error'

export interface UpdateState {
  status: UpdateStatus
  currentVersion: string
  availableVersion: string | null
  releaseNotes: string | null
  releaseDate: string | null
  downloadProgress: number
  bytesDownloaded: number
  totalBytes: number
  error: string | null
  lastChecked: number | null
}

export interface UpdateCheckResult {
  updateAvailable: boolean
  currentVersion: string
  availableVersion?: string
  releaseNotes?: string
  releaseDate?: string
  error?: string
}

export interface RollbackInfo {
  available: boolean
  previousVersion: string | null
  backupPath: string | null
}

export interface UpdateAPI {
  getState: () => Promise<UpdateState>
  checkForUpdates: () => Promise<UpdateCheckResult>
  downloadUpdate: () => Promise<{ success: boolean; error?: string }>
  installUpdate: () => Promise<{ success: boolean; error?: string }>
  getRollbackInfo: () => Promise<RollbackInfo>
  rollback: () => Promise<{ success: boolean; error?: string }>
  setFeedURL: (url: string) => Promise<{ success: boolean; error?: string }>
  setAutoDownload: (enabled: boolean) => Promise<{ success: boolean; error?: string }>
  setAllowPrerelease: (enabled: boolean) => Promise<{ success: boolean; error?: string }>
  reset: () => Promise<{ success: boolean; error?: string }>
  onStatusChange: (callback: (state: UpdateState) => void) => () => void
}
