/// <reference types="vite/client" />

import type {
  Meeting,
  MeetingStatus,
  CreateMeetingInput,
  UpdateMeetingInput,
  Recording,
  CreateRecordingInput,
  UpdateRecordingInput,
  Transcript,
  CreateTranscriptInput,
  TranscriptSearchResult,
  TranscriptSearchResultGlobal,
  MeetingNote,
  NoteType,
  CreateMeetingNoteInput,
  UpdateMeetingNoteInput,
  Task,
  TaskStatus,
  CreateTaskInput,
  UpdateTaskInput,
  Speaker,
  CreateSpeakerInput,
  UpdateSpeakerInput,
  MeetingSpeakerName,
  Setting,
  SettingCategory,
  DatabaseStats,
  MigrationRecord,
  AudioDevice,
  VirtualCableInfo,
  VirtualCableType,
  AudioDiagnosticResult
} from './types/database'

interface RecordingAudioLevelEvent {
  level: number
  peak: number
  timestamp: number
}

interface RecordingAudioHealthEvent {
  status: 'healthy' | 'warning' | 'error'
  message: string
  code?: string
  lastDataReceivedMs: number
  totalBytesReceived: number
  timestamp: number
}

declare global {
  interface Window {
  electronAPI: {
    platform: NodeJS.Platform
    versions: {
      node: string
      chrome: string
      electron: string
    }
    db: {
      meetings: {
        create: (input: CreateMeetingInput) => Promise<Meeting>
        getById: (id: string) => Promise<Meeting | null>
        getAll: () => Promise<Meeting[]>
        update: (id: string, input: UpdateMeetingInput) => Promise<Meeting | null>
        delete: (id: string) => Promise<boolean>
        getByStatus: (status: MeetingStatus) => Promise<Meeting[]>
        getRecent: (limit?: number) => Promise<Meeting[]>
      }
      recordings: {
        create: (input: CreateRecordingInput) => Promise<Recording>
        getById: (id: string) => Promise<Recording | null>
        getByMeetingId: (meetingId: string) => Promise<Recording[]>
        update: (id: string, input: UpdateRecordingInput) => Promise<Recording | null>
        delete: (id: string) => Promise<boolean>
      }
      transcripts: {
        create: (input: CreateTranscriptInput) => Promise<Transcript>
        getById: (id: string) => Promise<Transcript | null>
        getByMeetingId: (meetingId: string) => Promise<Transcript[]>
        delete: (id: string) => Promise<boolean>
        deleteByMeetingId: (meetingId: string) => Promise<number>
        // Full-text search methods (FTS5)
        searchInMeeting: (meetingId: string, query: string) => Promise<TranscriptSearchResult[]>
        searchAll: (query: string, limit?: number) => Promise<TranscriptSearchResultGlobal[]>
        getSearchCount: (meetingId: string, query: string) => Promise<number>
        getMatchingTranscriptIds: (meetingId: string, query: string) => Promise<string[]>
      }
      meetingNotes: {
        create: (input: CreateMeetingNoteInput) => Promise<MeetingNote>
        getById: (id: string) => Promise<MeetingNote | null>
        getByMeetingId: (meetingId: string) => Promise<MeetingNote[]>
        update: (id: string, input: UpdateMeetingNoteInput) => Promise<MeetingNote | null>
        delete: (id: string) => Promise<boolean>
        getByType: (meetingId: string, noteType: NoteType) => Promise<MeetingNote[]>
      }
      tasks: {
        create: (input: CreateTaskInput) => Promise<Task>
        getById: (id: string) => Promise<Task | null>
        getAll: () => Promise<Task[]>
        getByMeetingId: (meetingId: string) => Promise<Task[]>
        update: (id: string, input: UpdateTaskInput) => Promise<Task | null>
        delete: (id: string) => Promise<boolean>
        getByStatus: (status: TaskStatus) => Promise<Task[]>
        getPending: () => Promise<Task[]>
      }
      speakers: {
        create: (input: CreateSpeakerInput) => Promise<Speaker>
        getById: (id: string) => Promise<Speaker | null>
        getAll: () => Promise<Speaker[]>
        update: (id: string, input: UpdateSpeakerInput) => Promise<Speaker | null>
        delete: (id: string) => Promise<boolean>
        getUser: () => Promise<Speaker | null>
      }
      // Meeting-specific speaker name overrides
      meetingSpeakerNames: {
        getByMeetingId: (meetingId: string) => Promise<MeetingSpeakerName[]>
        setName: (meetingId: string, speakerId: string, displayName: string) => Promise<MeetingSpeakerName>
        delete: (meetingId: string, speakerId: string) => Promise<boolean>
        deleteByMeetingId: (meetingId: string) => Promise<number>
      }
      settings: {
        get: <T = unknown>(key: string) => Promise<T | null>
        set: (key: string, value: unknown, category?: SettingCategory) => Promise<Setting>
        delete: (key: string) => Promise<boolean>
        getByCategory: (category: SettingCategory) => Promise<Setting[]>
        getAll: () => Promise<Setting[]>
      }
      utils: {
        backup: (path: string) => Promise<boolean>
        getStats: () => Promise<DatabaseStats>
        getSchemaVersion: () => Promise<number>
        getMigrationHistory: () => Promise<MigrationRecord[]>
      }
    }
    recording: {
      start: (meetingId?: string) => Promise<{
        success: boolean
        meetingId: string | null
        startTime: number
        audioFilePath: string
      }>
      stop: () => Promise<{
        success: boolean
        meetingId: string | null
        duration: number
        audioFilePath: string | null
      }>
      pause: () => Promise<{
        success: boolean
        duration: number
      }>
      resume: () => Promise<{
        success: boolean
        startTime: number
      }>
      getStatus: () => Promise<{
        status: 'idle' | 'recording' | 'paused' | 'stopping'
        meetingId: string | null
        startTime: number | null
        duration: number
        audioFilePath: string | null
      }>
      getDirectory: () => Promise<string>
      listRecordings: () => Promise<string[]>
      deleteRecording: (filePath: string) => Promise<boolean>
      onAudioLevel: (callback: (data: RecordingAudioLevelEvent) => void) => () => void
      onAudioHealth: (callback: (data: RecordingAudioHealthEvent) => void) => () => void
      runDiarization: (meetingId: string) => Promise<{
        success: boolean
        speakersDetected?: number
        error?: string
      }>
      clearSpeakers: (meetingId: string) => Promise<{
        success: boolean
        deletedCount: number
        error?: string
      }>
      cancelDiarization: () => Promise<{
        success: boolean
        error?: string
      }>
      resetDiarizationState: () => Promise<{
        success: boolean
        error?: string
      }>
      getDiarizationStatus: () => Promise<{
        success: boolean
        status: string
        error?: string
      }>
    }
    audioDevices: {
      detectVirtualCables: () => Promise<VirtualCableInfo[]>
      getAll: () => Promise<AudioDevice[]>
      runDiagnostics: () => Promise<AudioDiagnosticResult>
      isVirtualCableInstalled: (cableType: VirtualCableType) => Promise<boolean>
      getRecommendedVirtualCable: () => Promise<VirtualCableType | null>
      getInstallationInstructions: (cableType?: VirtualCableType) => Promise<string>
    }
    shell: {
      openExternal: (url: string) => Promise<void>
      openPath: (path: string) => Promise<string>
      getFileStats: (filePath: string) => Promise<{ size: number; mtime: string; ctime: string }>
      selectDirectory: (defaultPath?: string) => Promise<string | null>
    }
    diarizationFailure: {
      recordFailure: (params: {
        errorCode?: string
        errorMessage?: string
        meetingId?: string
        audioPath?: string
        pythonOutput?: string
        stackTrace?: string
      }) => Promise<DiarizationFailureData>
      generateNotification: (failureId: string) => Promise<DiarizationFailureNotificationData | null>
      acknowledge: (failureId: string) => Promise<boolean>
      getRecentFailures: (count?: number) => Promise<DiarizationFailureData[]>
      getUnacknowledged: () => Promise<DiarizationFailureData[]>
      hasUnacknowledged: () => Promise<boolean>
      getMessage: () => Promise<string>
      validateNotSilentFallback: (result: {
        success: boolean
        segments?: unknown[]
        numSpeakers?: number
        speakers?: string[]
        error?: string
      }) => Promise<{ valid: boolean; reason?: string }>
      getCount: () => Promise<number>
      export: () => Promise<string>
      clear: () => Promise<{ success: boolean }>
      getTranscriptionOnlyMode: () => Promise<{
        diarizationDisabled: boolean
        transcriptionOnlyAcknowledged: boolean
      }>
      setTranscriptionOnlyMode: (enabled: boolean, reason?: string) => Promise<{ success: boolean; error?: string }>
      onFailure: (callback: (failure: DiarizationFailureData) => void) => () => void
      onNotification: (callback: (notification: DiarizationFailureNotificationData) => void) => () => void
    }
    llmPostProcessing: {
      checkAvailability: () => Promise<{
        available: boolean
        error?: string
        modelInfo?: string
      }>
      processOutput: (
        output: DiarizationOutputForLLM,
        options?: LLMProcessingOptions
      ) => Promise<LLMPostProcessingResult>
      getConfig: () => Promise<{
        lmStudio: LMStudioConfig
        thresholds: ConfidenceThresholds
      }>
      updateConfig: (config: Partial<LMStudioConfig>) => Promise<{ success: boolean; error?: string }>
      updateThresholds: (thresholds: Partial<ConfidenceThresholds>) => Promise<{ success: boolean; error?: string }>
      reset: () => Promise<{ success: boolean; error?: string }>
    }
    meetingSummary: {
      checkAvailability: () => Promise<{
        available: boolean
        error?: string
        modelInfo?: string
      }>
      generateSummary: (
        meetingId: string,
        config?: SummaryGenerationConfig
      ) => Promise<SummaryGenerationResult>
      deleteExistingSummary: (meetingId: string) => Promise<{
        success: boolean
        deleted: number
        error?: string
      }>
      getConfig: () => Promise<SummaryGenerationConfig>
      updateConfig: (config: Partial<SummaryGenerationConfig>) => Promise<{ success: boolean; error?: string }>
    }
    actionItems: {
      checkAvailability: () => Promise<{
        available: boolean
        error?: string
        modelInfo?: string
      }>
      extract: (
        meetingId: string,
        config?: ActionItemsExtractionConfig
      ) => Promise<ActionItemsExtractionResult>
      deleteExisting: (meetingId: string) => Promise<{
        success: boolean
        deletedNotes: number
        deletedTasks: number
        error?: string
      }>
      getConfig: () => Promise<ActionItemsExtractionConfig>
      updateConfig: (config: Partial<ActionItemsExtractionConfig>) => Promise<{ success: boolean; error?: string }>
    }
    update: {
      getState: () => Promise<UpdateStateType>
      checkForUpdates: () => Promise<UpdateCheckResultType>
      downloadUpdate: () => Promise<{ success: boolean; error?: string }>
      installUpdate: () => Promise<{ success: boolean; error?: string }>
      getRollbackInfo: () => Promise<RollbackInfoType>
      rollback: () => Promise<{ success: boolean; error?: string }>
      setFeedURL: (url: string) => Promise<{ success: boolean; error?: string }>
      setAutoDownload: (enabled: boolean) => Promise<{ success: boolean; error?: string }>
      setAllowPrerelease: (enabled: boolean) => Promise<{ success: boolean; error?: string }>
      reset: () => Promise<{ success: boolean; error?: string }>
      onStatusChange: (callback: (state: UpdateStateType) => void) => () => void
    }
    llmProvider: {
      detectProviders: (options?: {
        providers?: LLMProviderTypeEnum[]
        timeoutMs?: number
        parallel?: boolean
      }) => Promise<{
        providers: ProviderAvailabilityType[]
        recommendedPrimary?: LLMProviderTypeEnum
        timestamp: number
        detectionTimeMs: number
        error?: string
      }>
      getRegisteredProviders: () => Promise<LLMProviderTypeEnum[]>
      getEnabledProviders: () => Promise<LLMProviderTypeEnum[]>
      setDefaultProvider: (providerType: LLMProviderTypeEnum) => Promise<{ success: boolean; error?: string }>
      checkHealth: (forceRefresh?: boolean) => Promise<{
        success: boolean
        data?: { healthy: boolean; responseTimeMs: number; serverVersion?: string; loadedModel?: string }
        error?: string
        provider: string
        responseTimeMs?: number
      }>
      isAvailable: () => Promise<boolean>
      getConfig: () => Promise<LLMProviderManagerConfigType | null>
      updateConfig: (config: { defaultProvider?: LLMProviderTypeEnum }) => Promise<{ success: boolean; error?: string }>
      registerProviderByType: (
        providerType: LLMProviderTypeEnum,
        config?: Record<string, unknown>,
        priority?: 'primary' | 'secondary' | 'tertiary' | 'fallback',
        isDefault?: boolean
      ) => Promise<{ success: boolean; error?: string }>
    }
    llmHealthCheck: {
      getSummary: () => Promise<HealthSummaryType>
      runNow: () => Promise<HealthSummaryType>
      getProviderStatus: (provider: LLMProviderTypeEnum) => Promise<ProviderHealthStatusType | null>
      getEventHistory: (limit?: number) => Promise<HealthCheckEventType[]>
      getTroubleshootingGuidance: (provider: LLMProviderTypeEnum, error?: string) => Promise<string>
      start: (config?: Partial<HealthCheckConfigType>) => Promise<{ success: boolean; error?: string }>
      stop: () => Promise<{ success: boolean; error?: string }>
      getConfig: () => Promise<HealthCheckConfigType | null>
      updateConfig: (config: Partial<HealthCheckConfigType>) => Promise<{ success: boolean; error?: string }>
      isRunning: () => Promise<boolean>
      clearHistory: () => Promise<{ success: boolean; error?: string }>
      onStatusChange: (callback: (summary: HealthSummaryType) => void) => () => void
    }
    // Live Notes API (real-time meeting notes during recording)
    liveNotes: {
      checkAvailability: () => Promise<{
        available: boolean
        error?: string
        modelInfo?: string
      }>
      startSession: (
        meetingId: string,
        config?: LiveNotesConfigType
      ) => Promise<{ success: boolean; error?: string; llmProvider?: string }>
      stopSession: () => Promise<{
        success: boolean
        totalNotes: number
        batchesProcessed: number
      }>
      pauseSession: () => Promise<{ success: boolean }>
      resumeSession: () => Promise<{ success: boolean }>
      addSegments: (segments: LiveNotesSegmentType[]) => Promise<{ success: boolean }>
      getSessionState: () => Promise<{
        isActive: boolean
        meetingId: string | null
        pendingSegments: number
        processedSegments: number
        batchesProcessed: number
        totalNotesGenerated: number
      }>
      getConfig: () => Promise<LiveNotesConfigType>
      updateConfig: (config: Partial<LiveNotesConfigType>) => Promise<{ success: boolean }>
      forceBatchProcess: () => Promise<{ success: boolean }>
      onNotes: (callback: (notes: LiveNoteItemType[]) => void) => () => void
      onStatus: (callback: (status: { status: string; timestamp: number }) => void) => () => void
      onBatchState: (callback: (state: Record<string, unknown>) => void) => () => void
      onError: (callback: (error: {
        code: string
        message: string
        timestamp: number
        recoverable: boolean
      }) => void) => () => void
      onNotesPersisted: (callback: (data: {
        meetingId: string
        notesCount: number
        tasksCount: number
        timestamp: number
      }) => void) => () => void
      onSaveProgress: (callback: (data: {
        meetingId: string
        total: number
        saved: number
        currentType: 'notes' | 'tasks'
        completed?: boolean
        errors?: string[]
        timestamp: number
      }) => void) => () => void
    }
    // Transcript Correction API (AI-assisted transcription correction)
    transcriptCorrection: {
      // Add methods as needed
      [key: string]: unknown
    }
    // Confidence Scoring API (transcription quality metrics and alerts)
    confidenceScoring: {
      getConfidenceLevel: (confidence: number) => Promise<ConfidenceLevel>
      getSegmentConfidenceInfo: (transcriptId: string) => Promise<SegmentConfidenceInfo | null>
      calculateMeetingMetrics: (meetingId: string) => Promise<ConfidenceMetrics | null>
      getMetrics: (meetingId: string) => Promise<ConfidenceMetrics | null>
      getMeetingConfidenceSummary: (meetingId: string) => Promise<MeetingConfidenceSummary | null>
      recordTrendDataPoint: (
        meetingId: string,
        timestampMs: number,
        windowConfidence: number,
        segmentCount: number
      ) => Promise<ConfidenceAlert | null>
      getTrends: (meetingId: string) => Promise<ConfidenceTrend[]>
      getAlerts: (meetingId: string) => Promise<ConfidenceTrend[]>
      getLowConfidenceTranscripts: (meetingId: string, threshold?: number) => Promise<Transcript[]>
      getTranscriptsNeedingReview: (meetingId: string) => Promise<Transcript[]>
      triggerBatchAutoCorrection: (meetingId: string) => Promise<{
        triggered: number
        skipped: number
        errors: string[]
      }>
      adjustConfidence: (
        transcriptId: string,
        newConfidence: number,
        reason?: string
      ) => Promise<ConfidenceAdjustment | null>
      getAdjustmentHistory: (transcriptId: string) => Promise<ConfidenceAdjustment[]>
      getMeetingAdjustments: (meetingId: string) => Promise<ConfidenceAdjustment[]>
      processLiveSegment: (transcriptId: string) => Promise<LiveSegmentResult | null>
      resetAlertState: (meetingId: string) => Promise<{ success: boolean }>
      updateConfig: (config: Partial<ConfidenceScoringConfig>) => Promise<{ success: boolean }>
      getConfig: () => Promise<ConfidenceScoringConfig>
      getThresholds: () => Promise<ConfidenceThresholds>
      deleteByMeetingId: (meetingId: string) => Promise<{ success: boolean }>
    }
    // Meeting Deletion API (comprehensive meeting deletion with cleanup)
    meetingDeletion: {
      // Add methods as needed
      [key: string]: unknown
    }
    // Storage Management API (storage analysis, cleanup, and optimization)
    storageManagement: {
      // Add methods as needed
      [key: string]: unknown
    }
    // Export & Delete API (export meetings before deletion with various formats)
    exportDelete: {
      // Add methods as needed
      [key: string]: unknown
    }
    // Python Setup API (automated environment creation)
    pythonSetup: {
      isRequired: () => Promise<boolean>
      scriptsExist: () => Promise<boolean>
      getState: () => Promise<{
        status: 'idle' | 'running' | 'completed' | 'failed' | 'cancelled'
        progress: number
        currentStep: string
        error?: string
        startTime?: number
        endTime?: number
      }>
      getSteps: () => Promise<Array<{
        id: string
        name: string
        description: string
        estimatedTime?: string
      }>>
      getMetadata: () => Promise<{
        schemaVersion: number
        createdAt: string
        updatedAt: string
        setupScript: string
        systemPython: {
          version: string
          path: string
        }
        environments: {
          whisperx: {
            path: string
            pythonVersion: string
            packages: Record<string, string>
            purpose: string
            status: string
          }
          pyannote: {
            path: string
            pythonVersion: string
            packages: Record<string, string>
            purpose: string
            status: string
          }
        }
        models: {
          downloaded: boolean
          hfTokenConfigured: boolean
        }
        platform: {
          os: string
          arch: string
          osVersion?: string
        }
      } | null>
      isHfTokenConfigured: () => Promise<boolean>
      getEstimatedTime: (skipModels: boolean) => Promise<string>
      getEnvironmentPaths: () => Promise<{ whisperx: string; pyannote: string }>
      runSetup: (options?: {
        skipModels?: boolean
        force?: boolean
        quiet?: boolean
        hfToken?: string
      }) => Promise<{
        success: boolean
        error?: string
        exitCode: number
        duration: number
        metadata?: unknown
        remediationSteps?: string[]
      }>
      cancelSetup: () => Promise<boolean>
      repair: (options?: {
        skipModels?: boolean
        quiet?: boolean
        hfToken?: string
      }) => Promise<{
        success: boolean
        error?: string
        exitCode: number
        duration: number
        metadata?: unknown
        remediationSteps?: string[]
      }>
      reset: () => Promise<{ success: boolean }>
      onProgress: (callback: (progress: {
        step: string
        percentage: number
        message: string
        estimatedTime?: string
        timestamp: string
        type: 'progress' | 'success' | 'error' | 'warning' | 'step_complete' | 'complete' | 'remediation'
        code?: number
        remediationSteps?: string[]
      }) => void) => () => void
      onStateChange: (callback: (state: {
        status: 'idle' | 'running' | 'completed' | 'failed' | 'cancelled'
        progress: number
        currentStep: string
        error?: string
        startTime?: number
        endTime?: number
      }) => void) => () => void
    }
    // Speaker Name Detection API (intelligent speaker name identification)
    speakerNameDetection: {
      analyzeTranscript: (
        meetingId: string,
        speakerId: string,
        content: string,
        timestampMs: number,
        transcriptId?: string
      ) => Promise<NameDetectionResult | null>
      analyzeNameReference: (
        meetingId: string,
        mentionedName: string,
        mentionerSpeakerId: string,
        nextSpeakerId: string,
        mentionTimestampMs: number,
        speakerChangeTimestampMs: number
      ) => Promise<NameDetectionResult | null>
      checkTemporalCorrelation: (
        meetingId: string,
        newSpeakerId: string,
        speakerChangeTimestampMs: number
      ) => Promise<NameDetectionResult | null>
      getCandidates: (meetingId: string, speakerId?: string) => Promise<SpeakerNameCandidate[]>
      getTopCandidate: (meetingId: string, speakerId: string) => Promise<SpeakerNameCandidate | null>
      acceptCandidate: (candidateId: string) => Promise<boolean>
      rejectCandidate: (candidateId: string) => Promise<boolean>
      manuallySetName: (meetingId: string, speakerId: string, name: string) => Promise<SpeakerNameCandidate | null>
      getSuggestions: (meetingId: string) => Promise<SpeakerNameSuggestion[]>
      getMeetingSummary: (meetingId: string) => Promise<MeetingSpeakerNameSummary>
      getDetectionEvents: (meetingId: string, limit?: number) => Promise<SpeakerNameDetectionEvent[]>
      disambiguate: (meetingId: string, speakerId: string) => Promise<SpeakerNameCandidate | null>
      getConfig: () => Promise<SpeakerNameDetectionConfig>
      updateConfig: (config: Partial<SpeakerNameDetectionConfig>) => Promise<SpeakerNameDetectionConfig>
    }
  }
}
}

// Diarization Failure Types
interface DiarizationFailureRemediationStep {
  order: number
  title: string
  description: string
  command?: string
  automated?: boolean
  helpUrl?: string
}

interface DiarizationFailureData {
  id: string
  timestamp: number
  type: string
  severity: 'error' | 'warning' | 'info'
  message: string
  diagnosticInfo: string
  remediationSteps: DiarizationFailureRemediationStep[]
  meetingId?: string
  audioPath?: string
  technicalDetails?: {
    errorCode?: string
    errorMessage?: string
    stackTrace?: string
    pythonOutput?: string
  }
  userNotified: boolean
  acknowledged: boolean
}

interface DiarizationFailureNotificationData {
  prominentMessage: string
  detailedMessage: string
  diagnosticSummary: string
  remediationSteps: DiarizationFailureRemediationStep[]
  showTranscriptionOnlyOption: boolean
  timestamp: number
  failureId: string
}

// LLM Post-Processing Types
interface LMStudioConfig {
  baseUrl: string
  modelId?: string
  maxTokens: number
  temperature: number
  timeout: number
}

interface ConfidenceThresholds {
  lowConfidenceThreshold: number
  highConfidenceThreshold: number
  minOverlapDuration: number
}

interface SpeakerIdentityMapping {
  sessionSpeakerId: string
  persistentSpeakerId?: string
  userLabel?: string
  speakingCharacteristics?: string[]
  firstSeen: number
  lastSeen: number
  totalDuration: number
  averageConfidence: number
}

interface OverlapResolution {
  overlappingSegmentIndices: number[]
  overlapTimeRange: { start: number; end: number }
  recommendedPrimarySpeaker: string
  reasoning: string
  resolutionConfidence: number
  applied: boolean
}

interface LowConfidenceResolution {
  segmentIndex: number
  originalSpeakerId: string
  originalConfidence: number
  suggestedSpeakerId: string | null
  reasoning: string
  applied: boolean
}

interface SpeakerDisplayOrder {
  order: string[]
  reasoning: string
  metrics: {
    speakerId: string
    totalDuration: number
    segmentCount: number
    averageConfidence: number
    firstAppearance: number
  }[]
}

interface SpeakerAwareSummaryItem {
  type: 'summary' | 'action_item' | 'decision' | 'question' | 'key_point'
  content: string
  speakers: string[]
  timeRange?: { start: number; end: number }
  priority?: 'high' | 'medium' | 'low'
}

interface GuardrailViolation {
  type: 'speaker_invention' | 'confidence_override' | 'identity_assumption' | 'embedding_attempt'
  attemptedAction: string
  blockedReason: string
  timestamp: number
}

interface LLMPostProcessingResult {
  success: boolean
  error?: string
  speakerMappings: SpeakerIdentityMapping[]
  overlapResolutions: OverlapResolution[]
  lowConfidenceResolutions: LowConfidenceResolution[]
  displayOrder?: SpeakerDisplayOrder
  summaryItems?: SpeakerAwareSummaryItem[]
  metadata: {
    processingTimeMs: number
    llmRequestCount: number
    guardrailViolations: GuardrailViolation[]
    diarizationSchemaVersion: string
  }
}

interface DiarizationOutputForLLM {
  success: boolean
  segments: {
    speaker_id: string
    start_time: number
    end_time: number
    confidence: number
  }[]
  speaker_ids: string[]
  num_speakers: number
  audio_duration: number
  processing_time: number
  schema_version: string
  error?: {
    code: string
    message: string
    details?: Record<string, unknown>
  }
}

interface LLMProcessingOptions {
  resolveOverlaps?: boolean
  resolveLowConfidence?: boolean
  generateDisplayOrder?: boolean
  generateSummary?: boolean
  transcriptSegments?: {
    speaker_id: string
    text: string
    start_time: number
    end_time: number
  }[]
}

// Meeting Summary Types
interface SummaryGenerationConfig {
  maxTokens?: number
  temperature?: number
  includeActionItems?: boolean
  includeKeyPoints?: boolean
  includeDecisions?: boolean
  maxTranscriptSegments?: number
}

interface StructuredSummary {
  overallSummary: string
  keyPoints: string[]
  actionItems: {
    content: string
    speaker?: string
    priority?: 'high' | 'medium' | 'low'
  }[]
  decisions: string[]
  topics: string[]
}

interface SummaryGenerationResult {
  success: boolean
  error?: string
  summary?: StructuredSummary
  createdNotes?: MeetingNote[]
  metadata: {
    processingTimeMs: number
    transcriptSegmentCount: number
    transcriptCharacterCount: number
    llmResponseTimeMs?: number
  }
}

// Action Items Extraction Types
interface ActionItemsExtractionConfig {
  maxTokens?: number
  temperature?: number
  createTasks?: boolean
  createNotes?: boolean
  maxTranscriptSegments?: number
}

interface ExtractedActionItem {
  task: string
  assignee: string | null
  priority: 'low' | 'medium' | 'high' | 'urgent'
  dueDate: string | null
  context: string | null
  speaker: string | null
}

interface ActionItemsExtractionResult {
  success: boolean
  error?: string
  extractedItems?: ExtractedActionItem[]
  createdNotes?: MeetingNote[]
  createdTasks?: Task[]
  metadata: {
    processingTimeMs: number
    transcriptSegmentCount: number
    transcriptCharacterCount: number
    llmResponseTimeMs?: number
    actionItemCount: number
  }
}

// Update Types
type UpdateStatusType =
  | 'idle'
  | 'checking'
  | 'available'
  | 'not-available'
  | 'downloading'
  | 'downloaded'
  | 'installing'
  | 'error'

interface UpdateStateType {
  status: UpdateStatusType
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

interface UpdateCheckResultType {
  updateAvailable: boolean
  currentVersion: string
  availableVersion?: string
  releaseNotes?: string
  releaseDate?: string
  error?: string
}

interface RollbackInfoType {
  available: boolean
  previousVersion: string | null
  backupPath: string | null
}

// LLM Provider Types
type LLMProviderTypeEnum = 'lm-studio' | 'ollama' | 'claude' | 'cursor' | 'openai' | 'anthropic' | 'custom'

interface ProviderAvailabilityType {
  provider: LLMProviderTypeEnum
  available: boolean
  responseTimeMs?: number
  error?: string
  lastChecked: number
  loadedModel?: string
}

interface LLMProviderManagerConfigType {
  defaultProvider: LLMProviderTypeEnum
  fallback: {
    enabled: boolean
    maxAttempts: number
    delayBetweenAttemptsMs: number
    cacheAvailability: boolean
    availabilityCacheTtlMs: number
  }
  autoDetect: boolean
  healthCheckIntervalMs: number
}

// LLM Health Check Types
interface ProviderHealthStatusType {
  provider: LLMProviderTypeEnum
  available: boolean
  lastChecked: number
  responseTimeMs?: number
  error?: string
  consecutiveFailures: number
  lastSuccessTime?: number
  troubleshootingGuidance?: string
}

interface HealthCheckEventType {
  id: string
  timestamp: number
  provider: LLMProviderTypeEnum
  type: 'check' | 'failure' | 'recovery' | 'fallback'
  available: boolean
  responseTimeMs?: number
  error?: string
  details?: Record<string, unknown>
}

interface HealthCheckConfigType {
  intervalMs: number
  maxHistorySize: number
  timeoutMs: number
  autoStart: boolean
  providers?: LLMProviderTypeEnum[]
}

interface HealthSummaryType {
  timestamp: number
  totalProviders: number
  availableProviders: number
  unavailableProviders: number
  providers: ProviderHealthStatusType[]
  recentEvents: HealthCheckEventType[]
  hasWarnings: boolean
  warnings: string[]
}

// Live Notes Types
interface LiveNotesConfigType {
  batchIntervalMs?: number
  minSegmentsPerBatch?: number
  maxSegmentsPerBatch?: number
  maxTokens?: number
  temperature?: number
  extractKeyPoints?: boolean
  extractActionItems?: boolean
  extractDecisions?: boolean
  extractTopics?: boolean
}

interface LiveNotesSegmentType {
  id: string
  content: string
  speaker?: string | null
  start_time_ms: number
  end_time_ms: number
}

interface LiveNoteItemType {
  id: string
  type: 'key_point' | 'action_item' | 'decision' | 'topic'
  content: string
  speaker?: string | null
  priority?: 'high' | 'medium' | 'low'
  assignee?: string | null
  extractedAt: number
  sourceSegmentIds: string[]
  isPreliminary: boolean
  confidence?: number
}

// Confidence Scoring Types
type ConfidenceLevel = 'high' | 'medium' | 'low'
type ConfidenceAlertType = 'low_confidence' | 'degrading_quality' | 'audio_issue'

interface ConfidenceThresholds {
  high: number
  medium: number
  low: number
}

interface ConfidenceMetrics {
  id: string
  meeting_id: string
  overall_score: number
  high_confidence_count: number
  medium_confidence_count: number
  low_confidence_count: number
  total_segments: number
  average_word_confidence: number
  min_confidence: number
  max_confidence: number
  needs_review_count: number
  auto_corrected_count: number
  manual_adjustment_count: number
  created_at: string
  updated_at: string
}

interface ConfidenceTrend {
  id: string
  meeting_id: string
  timestamp_ms: number
  window_confidence: number
  segment_count: number
  is_alert_triggered: boolean
  alert_type: ConfidenceAlertType | null
  created_at: string
}

interface ConfidenceAdjustment {
  id: string
  transcript_id: string
  meeting_id: string
  original_confidence: number
  adjusted_confidence: number
  reason: string | null
  created_at: string
}

interface SegmentConfidenceInfo {
  transcriptId: string
  confidence: number
  level: ConfidenceLevel
  needsReview: boolean
  percentageDisplay: string
  colorClass: string
  badgeClass: string
  hasBeenCorrected: boolean
  hasBeenAdjusted: boolean
}

interface MeetingConfidenceSummary {
  meetingId: string
  overallScore: number
  overallLevel: ConfidenceLevel
  highConfidencePercent: number
  mediumConfidencePercent: number
  lowConfidencePercent: number
  totalSegments: number
  needsReviewCount: number
  qualityDescription: string
  trend: 'improving' | 'stable' | 'degrading' | 'unknown'
}

interface ConfidenceAlert {
  type: ConfidenceAlertType
  message: string
  severity: 'warning' | 'error'
  timestampMs: number
  windowConfidence: number
  suggestedAction: string
}

interface ConfidenceScoringConfig {
  thresholds: ConfidenceThresholds
  alertThreshold: number
  alertWindowMs: number
  alertConsecutiveCount: number
  autoCorrectThreshold: number
  reviewThreshold: number
  trendSampleIntervalMs: number
}

interface LiveSegmentResult {
  info: SegmentConfidenceInfo
  alert: ConfidenceAlert | null
  shouldAutoCorrect: boolean
}

// Speaker Name Detection Types
type SpeakerNameDetectionType =
  | 'self_introduction'
  | 'name_reference'
  | 'temporal_correlation'
  | 'manual_correction'

type SpeakerNameDetectionEventType =
  | 'detection'
  | 'confidence_update'
  | 'acceptance'
  | 'rejection'
  | 'manual_override'
  | 'disambiguation'

type NameConfidenceLevel = 'high' | 'medium' | 'low'

interface SpeakerNameCandidate {
  id: string
  meeting_id: string
  speaker_id: string
  candidate_name: string
  confidence: number
  detection_type: SpeakerNameDetectionType
  detection_context: string | null
  source_transcript_id: string | null
  timestamp_ms: number
  is_accepted: boolean
  is_rejected: boolean
  created_at: string
  updated_at: string
}

interface SpeakerNameDetectionEvent {
  id: string
  meeting_id: string
  speaker_id: string | null
  event_type: SpeakerNameDetectionEventType
  description: string
  confidence: number | null
  candidate_name: string | null
  detection_type: SpeakerNameDetectionType | null
  context_data: string | null
  timestamp_ms: number
  created_at: string
}

interface NameDetectionResult {
  detected: boolean
  candidateName: string | null
  confidence: number
  detectionType: SpeakerNameDetectionType
  context: string
  patterns: string[]
}

interface SpeakerNameDetectionConfig {
  highConfidenceThreshold: number
  mediumConfidenceThreshold: number
  autoApplyThreshold: number
  nameReferenceWindowMs: number
  speakerChangeToleranceMs: number
  enableSelfIntroductionDetection: boolean
  enableNameReferenceDetection: boolean
  enableTemporalCorrelation: boolean
  excludedWords: string[]
}

interface SpeakerNameSuggestion {
  speakerId: string
  currentName: string
  suggestedName: string
  confidence: number
  confidenceLevel: NameConfidenceLevel
  detectionType: SpeakerNameDetectionType
  candidateId: string
  detectionContext: string | null
}

interface MeetingSpeakerNameSummary {
  meetingId: string
  speakers: Array<{
    speakerId: string
    currentName: string
    topCandidate: SpeakerNameCandidate | null
    allCandidates: SpeakerNameCandidate[]
    hasAcceptedName: boolean
  }>
}

export {}
