import { contextBridge, ipcRenderer } from 'electron'
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
  MeetingNote,
  NoteType,
  CreateMeetingNoteInput,
  UpdateMeetingNoteInput,
  Task,
  TaskStatus,
  TaskPriority,
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
  AudioDiagnosticResult,
  AutoFixResult,
  DualRecordingConfig,
  DualRecordingState,
  StartDualRecordingResult,
  StopDualRecordingResult,
  SystemAudioCaptureCapabilities,
  AudioSource
} from '../src/types/database'
import type {
  TranscriptionConfig,
  DiarizationConfig,
  TranscriptionResult,
  DiarizationResult,
  CombinedSegment,
  PipelineProgress,
  PipelineStatus,
  ModelSize
} from './services/mlPipeline'
import type {
  LiveTranscriptionConfig,
  LiveTranscriptSegment,
  TranscribeChunkResult,
  LiveTranscriptionProgress,
  LiveTranscriptionState
} from './services/liveTranscriptionService'
import type { AudioLevelData, AudioHealthData } from './services/audioRecorderService'
import type {
  BatchDiarizationProgress,
  BatchDiarizationResult,
  BatchDiarizationOptions
} from './services/batchDiarizationService'
import type {
  CoreDiarizationSegment,
  CoreDiarizationResult,
  CoreDiarizationConfig,
  CoreDiarizationStatus
} from './services/coreDiarizationService'
import type {
  StreamingDiarizationConfig,
  SpeakerSegment,
  SpeakerChangeEvent,
  StreamingDiarizationState,
  SpeakerStats as StreamingSpeakerStats,
  RetroactiveCorrectionEvent
} from './services/streamingDiarizationService'

// ============================================================================
// Database API
// ============================================================================

const databaseAPI = {
  // ===== Meetings =====
  meetings: {
    create: (input: CreateMeetingInput): Promise<Meeting> =>
      ipcRenderer.invoke('db:meetings:create', input),
    getById: (id: string): Promise<Meeting | null> =>
      ipcRenderer.invoke('db:meetings:getById', id),
    getAll: (): Promise<Meeting[]> =>
      ipcRenderer.invoke('db:meetings:getAll'),
    update: (id: string, input: UpdateMeetingInput): Promise<Meeting | null> =>
      ipcRenderer.invoke('db:meetings:update', id, input),
    delete: (id: string): Promise<boolean> =>
      ipcRenderer.invoke('db:meetings:delete', id),
    getByStatus: (status: MeetingStatus): Promise<Meeting[]> =>
      ipcRenderer.invoke('db:meetings:getByStatus', status),
    getRecent: (limit: number = 10): Promise<Meeting[]> =>
      ipcRenderer.invoke('db:meetings:getRecent', limit)
  },

  // ===== Recordings =====
  recordings: {
    create: (input: CreateRecordingInput): Promise<Recording> =>
      ipcRenderer.invoke('db:recordings:create', input),
    getById: (id: string): Promise<Recording | null> =>
      ipcRenderer.invoke('db:recordings:getById', id),
    getByMeetingId: (meetingId: string): Promise<Recording[]> =>
      ipcRenderer.invoke('db:recordings:getByMeetingId', meetingId),
    update: (id: string, input: UpdateRecordingInput): Promise<Recording | null> =>
      ipcRenderer.invoke('db:recordings:update', id, input),
    delete: (id: string): Promise<boolean> =>
      ipcRenderer.invoke('db:recordings:delete', id)
  },

  // ===== Transcripts =====
  transcripts: {
    create: (input: CreateTranscriptInput, options?: { requireSpeaker?: boolean }): Promise<Transcript> =>
      ipcRenderer.invoke('db:transcripts:create', input, options),
    createBatch: (inputs: CreateTranscriptInput[], options?: { requireSpeaker?: boolean }): Promise<Transcript[]> =>
      ipcRenderer.invoke('db:transcripts:createBatch', inputs, options),
    getById: (id: string): Promise<Transcript | null> =>
      ipcRenderer.invoke('db:transcripts:getById', id),
    getByMeetingId: (meetingId: string): Promise<Transcript[]> =>
      ipcRenderer.invoke('db:transcripts:getByMeetingId', meetingId),
    // Paginated transcript fetching for lazy loading
    getByMeetingIdPaginated: (meetingId: string, options?: { limit?: number; offset?: number }): Promise<{
      data: Transcript[]
      total: number
      hasMore: boolean
      offset: number
      limit: number
    }> =>
      ipcRenderer.invoke('db:transcripts:getByMeetingIdPaginated', meetingId, options),
    getCountByMeetingId: (meetingId: string): Promise<number> =>
      ipcRenderer.invoke('db:transcripts:getCountByMeetingId', meetingId),
    delete: (id: string): Promise<boolean> =>
      ipcRenderer.invoke('db:transcripts:delete', id),
    deleteByMeetingId: (meetingId: string): Promise<number> =>
      ipcRenderer.invoke('db:transcripts:deleteByMeetingId', meetingId),
    // Full-text search methods (FTS5)
    searchInMeeting: (meetingId: string, query: string): Promise<Array<{
      transcript: Transcript
      snippet: string
      matchPositions: Array<{ start: number; end: number }>
    }>> =>
      ipcRenderer.invoke('db:transcripts:searchInMeeting', meetingId, query),
    searchAll: (query: string, limit?: number): Promise<Array<{
      transcript: Transcript
      meetingId: string
      snippet: string
    }>> =>
      ipcRenderer.invoke('db:transcripts:searchAll', query, limit),
    getSearchCount: (meetingId: string, query: string): Promise<number> =>
      ipcRenderer.invoke('db:transcripts:getSearchCount', meetingId, query),
    getMatchingTranscriptIds: (meetingId: string, query: string): Promise<string[]> =>
      ipcRenderer.invoke('db:transcripts:getMatchingTranscriptIds', meetingId, query)
  },

  // ===== Meeting Notes =====
  meetingNotes: {
    create: (input: CreateMeetingNoteInput): Promise<MeetingNote> =>
      ipcRenderer.invoke('db:meetingNotes:create', input),
    getById: (id: string): Promise<MeetingNote | null> =>
      ipcRenderer.invoke('db:meetingNotes:getById', id),
    getByMeetingId: (meetingId: string): Promise<MeetingNote[]> =>
      ipcRenderer.invoke('db:meetingNotes:getByMeetingId', meetingId),
    update: (id: string, input: UpdateMeetingNoteInput): Promise<MeetingNote | null> =>
      ipcRenderer.invoke('db:meetingNotes:update', id, input),
    delete: (id: string): Promise<boolean> =>
      ipcRenderer.invoke('db:meetingNotes:delete', id),
    getByType: (meetingId: string, noteType: NoteType): Promise<MeetingNote[]> =>
      ipcRenderer.invoke('db:meetingNotes:getByType', meetingId, noteType)
  },

  // ===== Tasks =====
  tasks: {
    create: (input: CreateTaskInput): Promise<Task> =>
      ipcRenderer.invoke('db:tasks:create', input),
    getById: (id: string): Promise<Task | null> =>
      ipcRenderer.invoke('db:tasks:getById', id),
    getAll: (): Promise<Task[]> =>
      ipcRenderer.invoke('db:tasks:getAll'),
    getByMeetingId: (meetingId: string): Promise<Task[]> =>
      ipcRenderer.invoke('db:tasks:getByMeetingId', meetingId),
    update: (id: string, input: UpdateTaskInput): Promise<Task | null> =>
      ipcRenderer.invoke('db:tasks:update', id, input),
    delete: (id: string): Promise<boolean> =>
      ipcRenderer.invoke('db:tasks:delete', id),
    getByStatus: (status: TaskStatus): Promise<Task[]> =>
      ipcRenderer.invoke('db:tasks:getByStatus', status),
    getPending: (): Promise<Task[]> =>
      ipcRenderer.invoke('db:tasks:getPending'),
    getByPriority: (priority: TaskPriority): Promise<Task[]> =>
      ipcRenderer.invoke('db:tasks:getByPriority', priority),
    getByAssignee: (assignee: string): Promise<Task[]> =>
      ipcRenderer.invoke('db:tasks:getByAssignee', assignee),
    getOverdue: (): Promise<Task[]> =>
      ipcRenderer.invoke('db:tasks:getOverdue'),
    complete: (id: string): Promise<Task | null> =>
      ipcRenderer.invoke('db:tasks:complete', id)
  },

  // ===== Speakers =====
  speakers: {
    create: (input: CreateSpeakerInput): Promise<Speaker> =>
      ipcRenderer.invoke('db:speakers:create', input),
    getById: (id: string): Promise<Speaker | null> =>
      ipcRenderer.invoke('db:speakers:getById', id),
    getAll: (): Promise<Speaker[]> =>
      ipcRenderer.invoke('db:speakers:getAll'),
    // Efficient batch fetch by IDs
    getByIds: (ids: string[]): Promise<Speaker[]> =>
      ipcRenderer.invoke('db:speakers:getByIds', ids),
    // Get speakers only for a specific meeting (more efficient than getAll)
    getByMeetingId: (meetingId: string): Promise<Speaker[]> =>
      ipcRenderer.invoke('db:speakers:getByMeetingId', meetingId),
    update: (id: string, input: UpdateSpeakerInput): Promise<Speaker | null> =>
      ipcRenderer.invoke('db:speakers:update', id, input),
    delete: (id: string): Promise<boolean> =>
      ipcRenderer.invoke('db:speakers:delete', id),
    getUser: (): Promise<Speaker | null> =>
      ipcRenderer.invoke('db:speakers:getUser')
  },

  // ===== Meeting Speaker Names (meeting-specific speaker name overrides) =====
  meetingSpeakerNames: {
    // Get all speaker name overrides for a meeting
    getByMeetingId: (meetingId: string): Promise<MeetingSpeakerName[]> =>
      ipcRenderer.invoke('db:meetingSpeakerNames:getByMeetingId', meetingId),
    // Set a meeting-specific name for a speaker (creates or updates)
    setName: (meetingId: string, speakerId: string, displayName: string): Promise<MeetingSpeakerName> =>
      ipcRenderer.invoke('db:meetingSpeakerNames:setName', meetingId, speakerId, displayName),
    // Delete a meeting-specific speaker name
    delete: (meetingId: string, speakerId: string): Promise<boolean> =>
      ipcRenderer.invoke('db:meetingSpeakerNames:delete', meetingId, speakerId),
    // Delete all speaker name overrides for a meeting
    deleteByMeetingId: (meetingId: string): Promise<number> =>
      ipcRenderer.invoke('db:meetingSpeakerNames:deleteByMeetingId', meetingId)
  },

  // ===== Settings =====
  settings: {
    get: <T = unknown>(key: string): Promise<T | null> =>
      ipcRenderer.invoke('db:settings:get', key),
    set: (key: string, value: unknown, category?: SettingCategory): Promise<Setting> =>
      ipcRenderer.invoke('db:settings:set', key, value, category),
    delete: (key: string): Promise<boolean> =>
      ipcRenderer.invoke('db:settings:delete', key),
    getByCategory: (category: SettingCategory): Promise<Setting[]> =>
      ipcRenderer.invoke('db:settings:getByCategory', category),
    getAll: (): Promise<Setting[]> =>
      ipcRenderer.invoke('db:settings:getAll')
  },

  // ===== Utilities =====
  utils: {
    backup: (path: string): Promise<boolean> =>
      ipcRenderer.invoke('db:utils:backup', path),
    getStats: (): Promise<DatabaseStats> =>
      ipcRenderer.invoke('db:utils:getStats'),
    getSchemaVersion: (): Promise<number> =>
      ipcRenderer.invoke('db:utils:getSchemaVersion'),
    getMigrationHistory: (): Promise<MigrationRecord[]> =>
      ipcRenderer.invoke('db:utils:getMigrationHistory')
  }
}

// ============================================================================
// Recording API
// ============================================================================

export type RecordingStatus = 'idle' | 'recording' | 'paused' | 'stopping'

export interface RecordingState {
  status: RecordingStatus
  meetingId: string | null
  startTime: number | null
  duration: number
  audioFilePath: string | null
}

export interface StartRecordingResult {
  success: boolean
  meetingId: string | null
  startTime: number
  audioFilePath: string
  deviceUsed?: string
  warning?: string
  sampleRateUsed?: number // Actual sample rate used for recording (may differ from configured)
  sampleRateConfigured?: number // Sample rate that was configured in settings
}

export interface StopRecordingResult {
  success: boolean
  meetingId: string | null
  duration: number
  audioFilePath: string | null
  error?: string // Error message if success is false
}

export interface PauseRecordingResult {
  success: boolean
  duration: number
}

export interface ResumeRecordingResult {
  success: boolean
  startTime: number
}

const recordingAPI = {
  start: (meetingId?: string): Promise<StartRecordingResult> =>
    ipcRenderer.invoke('recording:start', meetingId),
  stop: (): Promise<StopRecordingResult> =>
    ipcRenderer.invoke('recording:stop'),
  pause: (): Promise<PauseRecordingResult> =>
    ipcRenderer.invoke('recording:pause'),
  resume: (): Promise<ResumeRecordingResult> =>
    ipcRenderer.invoke('recording:resume'),
  getStatus: (): Promise<RecordingState> =>
    ipcRenderer.invoke('recording:getStatus'),
  getDirectory: (): Promise<string> =>
    ipcRenderer.invoke('recording:getDirectory'),
  listRecordings: (): Promise<string[]> =>
    ipcRenderer.invoke('recording:listRecordings'),
  deleteRecording: (filePath: string): Promise<boolean> =>
    ipcRenderer.invoke('recording:deleteRecording', filePath),
  migrateToMeetingFolders: (): Promise<{ migrated: number; errors: number; skipped: number }> =>
    ipcRenderer.invoke('recording:migrateToMeetingFolders'),
  runDiarization: (meetingId: string): Promise<{ success: boolean; speakersDetected?: number; error?: string }> =>
    ipcRenderer.invoke('recording:runDiarization', meetingId),
  clearSpeakers: (meetingId: string): Promise<{ success: boolean; deletedCount: number; error?: string }> =>
    ipcRenderer.invoke('recording:clearSpeakers', meetingId),
  cancelDiarization: (): Promise<{ success: boolean; error?: string }> =>
    ipcRenderer.invoke('recording:cancelDiarization'),
  resetDiarizationState: (): Promise<{ success: boolean; error?: string }> =>
    ipcRenderer.invoke('recording:resetDiarizationState'),
  getDiarizationStatus: (): Promise<{ success: boolean; status: string; error?: string }> =>
    ipcRenderer.invoke('recording:getDiarizationStatus'),
  onAudioLevel: (callback: (data: AudioLevelData) => void): (() => void) => {
    const handler = (_event: unknown, data: AudioLevelData) => {
      callback(data)
    }
    ipcRenderer.on('recording:audioLevel', handler)
    return () => {
      ipcRenderer.removeListener('recording:audioLevel', handler)
    }
  },
  onAudioHealth: (callback: (data: AudioHealthData) => void): (() => void) => {
    const handler = (_event: unknown, data: AudioHealthData) => {
      callback(data)
    }
    ipcRenderer.on('recording:audioHealth', handler)
    return () => {
      ipcRenderer.removeListener('recording:audioHealth', handler)
    }
  },
  onDiarizationComplete: (callback: (data: { meetingId: string; success: boolean; speakersDetected?: number }) => void): (() => void) => {
    const handler = (_event: unknown, data: { meetingId: string; success: boolean; speakersDetected?: number }) => {
      callback(data)
    }
    ipcRenderer.on('recording:diarizationComplete', handler)
    return () => {
      ipcRenderer.removeListener('recording:diarizationComplete', handler)
    }
  },
  onActionItemsExtracted: (callback: (data: { meetingId: string; success: boolean; actionItemsCount: number; tasksCreated: Array<{ id: string; title: string; assignee: string | null; priority: string; due_date: string | null }> }) => void): (() => void) => {
    const handler = (_event: unknown, data: { meetingId: string; success: boolean; actionItemsCount: number; tasksCreated: Array<{ id: string; title: string; assignee: string | null; priority: string; due_date: string | null }> }) => {
      callback(data)
    }
    ipcRenderer.on('recording:actionItemsExtracted', handler)
    return () => {
      ipcRenderer.removeListener('recording:actionItemsExtracted', handler)
    }
  }
}

// ============================================================================
// Audio Device API
// ============================================================================

const audioDeviceAPI = {
  // Detect virtual audio cables on current platform
  detectVirtualCables: (): Promise<VirtualCableInfo[]> =>
    ipcRenderer.invoke('audio:devices:detectVirtualCables'),

  // Get all audio devices
  getAll: (): Promise<AudioDevice[]> =>
    ipcRenderer.invoke('audio:devices:getAll'),

  // Run full audio diagnostics
  runDiagnostics: (): Promise<AudioDiagnosticResult> =>
    ipcRenderer.invoke('audio:devices:runDiagnostics'),

  // Check if specific virtual cable is installed
  isVirtualCableInstalled: (cableType: VirtualCableType): Promise<boolean> =>
    ipcRenderer.invoke('audio:devices:isVirtualCableInstalled', cableType),

  // Get recommended virtual cable for current platform
  getRecommendedVirtualCable: (): Promise<VirtualCableType | null> =>
    ipcRenderer.invoke('audio:devices:getRecommendedVirtualCable'),

  // Get installation instructions for virtual cable
  getInstallationInstructions: (cableType?: VirtualCableType): Promise<string> =>
    ipcRenderer.invoke('audio:devices:getInstallationInstructions', cableType),

  // Attempt to auto-fix common audio issues
  attemptAutoFix: (issue: string): Promise<AutoFixResult> =>
    ipcRenderer.invoke('audio:devices:attemptAutoFix', issue)
}

// ============================================================================
// System Audio Capture API
// ============================================================================

// ScreenCaptureKit types (macOS 13+ native app audio capture)
export interface ScreenCaptureKitCapabilities {
  available: boolean
  macOSVersion: string
  minRequiredVersion: string
  supportsAudioCapture: boolean
  supportsAppAudioCapture: boolean
  permissionStatus: 'unknown' | 'denied' | 'granted' | 'not_determined'
  fallbackMethod: 'blackhole' | 'soundflower' | 'none'
  instructions: string
}

export interface CaptureableApp {
  bundleIdentifier: string
  name: string
  pid: number
  isRunning: boolean
  isMeetingApp: boolean
}

export interface ScreenCaptureKitConfig {
  targetApps?: string[]
  sampleRate?: number
  channels?: number
  excludeCurrentApp?: boolean
}

export interface StartCaptureResult {
  success: boolean
  method: 'screencapturekit' | 'blackhole' | 'virtual_cable'
  audioFilePath: string | null
  error?: string
  targetApps?: string[]
}

export interface StopCaptureResult {
  success: boolean
  audioFilePath: string | null
  duration: number
  error?: string
}

const systemAudioCaptureAPI = {
  // Get system audio capture capabilities for current platform
  getCapabilities: (): Promise<SystemAudioCaptureCapabilities> =>
    ipcRenderer.invoke('systemAudio:getCapabilities'),

  // Start dual recording (microphone + system audio)
  startDualRecording: (meetingId?: string, config?: DualRecordingConfig): Promise<StartDualRecordingResult> =>
    ipcRenderer.invoke('systemAudio:startDualRecording', meetingId, config),

  // Start system audio only recording
  startSystemAudioRecording: (meetingId?: string, config?: DualRecordingConfig): Promise<StartDualRecordingResult> =>
    ipcRenderer.invoke('systemAudio:startSystemAudioRecording', meetingId, config),

  // Stop dual recording
  stopDualRecording: (): Promise<StopDualRecordingResult> =>
    ipcRenderer.invoke('systemAudio:stopDualRecording'),

  // Pause dual recording
  pauseDualRecording: (): Promise<{ success: boolean; duration: number }> =>
    ipcRenderer.invoke('systemAudio:pauseDualRecording'),

  // Resume dual recording
  resumeDualRecording: (): Promise<{ success: boolean; startTime: number }> =>
    ipcRenderer.invoke('systemAudio:resumeDualRecording'),

  // Get current dual recording status
  getStatus: (): Promise<DualRecordingState> =>
    ipcRenderer.invoke('systemAudio:getStatus'),

  // Get available audio sources for recording
  getAvailableSources: (): Promise<AudioSource[]> =>
    ipcRenderer.invoke('systemAudio:getAvailableSources'),

  // =========================================================================
  // ScreenCaptureKit Methods (macOS 13+ native app audio capture)
  // =========================================================================

  // Get ScreenCaptureKit capabilities
  getScreenCaptureKitCapabilities: (): Promise<ScreenCaptureKitCapabilities> =>
    ipcRenderer.invoke('systemAudio:getScreenCaptureKitCapabilities'),

  // Request screen recording permission for ScreenCaptureKit
  requestScreenRecordingPermission: (): Promise<{ success: boolean; message: string }> =>
    ipcRenderer.invoke('systemAudio:requestScreenRecordingPermission'),

  // Get list of running apps that can be captured
  getCapturableApps: (): Promise<CaptureableApp[]> =>
    ipcRenderer.invoke('systemAudio:getCapturableApps'),

  // Get list of running meeting apps
  getRunningMeetingApps: (): Promise<CaptureableApp[]> =>
    ipcRenderer.invoke('systemAudio:getRunningMeetingApps'),

  // Check if ScreenCaptureKit should be used
  shouldUseScreenCaptureKit: (): Promise<{
    shouldUse: boolean
    reason: string
    capabilities: ScreenCaptureKitCapabilities
  }> =>
    ipcRenderer.invoke('systemAudio:shouldUseScreenCaptureKit'),

  // Start app audio capture (uses ScreenCaptureKit or falls back to virtual cable)
  startAppAudioCapture: (meetingId?: string, config?: {
    targetApps?: string[]
    sampleRate?: number
    channels?: number
  }): Promise<StartCaptureResult> =>
    ipcRenderer.invoke('systemAudio:startAppAudioCapture', meetingId, config),

  // Stop app audio capture
  stopAppAudioCapture: (): Promise<StopCaptureResult> =>
    ipcRenderer.invoke('systemAudio:stopAppAudioCapture'),

  // Get app audio capture status
  getAppAudioCaptureStatus: (): Promise<{
    isCapturing: boolean
    method: 'screencapturekit' | 'virtual_cable' | null
    duration: number
    targetApps: string[]
  }> =>
    ipcRenderer.invoke('systemAudio:getAppAudioCaptureStatus'),

  // Get list of known meeting app bundle identifiers
  getMeetingAppBundles: (): Promise<string[]> =>
    ipcRenderer.invoke('systemAudio:getMeetingAppBundles')
}

// ============================================================================
// ScreenCaptureKit API (Direct access for macOS 13+ native app audio capture)
// ============================================================================

const screenCaptureKitAPI = {
  // Get ScreenCaptureKit capabilities
  getCapabilities: (): Promise<ScreenCaptureKitCapabilities> =>
    ipcRenderer.invoke('screenCaptureKit:getCapabilities'),

  // Request screen recording permission
  requestPermission: (): Promise<{ success: boolean; message: string }> =>
    ipcRenderer.invoke('screenCaptureKit:requestPermission'),

  // Get list of capturable apps
  getCapturableApps: (): Promise<CaptureableApp[]> =>
    ipcRenderer.invoke('screenCaptureKit:getCapturableApps'),

  // Get running meeting apps
  getRunningMeetingApps: (): Promise<CaptureableApp[]> =>
    ipcRenderer.invoke('screenCaptureKit:getRunningMeetingApps'),

  // Start capture
  startCapture: (meetingId?: string, config?: ScreenCaptureKitConfig): Promise<StartCaptureResult> =>
    ipcRenderer.invoke('screenCaptureKit:startCapture', meetingId, config),

  // Stop capture
  stopCapture: (): Promise<StopCaptureResult> =>
    ipcRenderer.invoke('screenCaptureKit:stopCapture'),

  // Get capture status
  getStatus: (): Promise<{
    status: string
    isRecording: boolean
    method: string | null
    duration: number
    targetApps: string[]
  }> =>
    ipcRenderer.invoke('screenCaptureKit:getStatus'),

  // Check if ScreenCaptureKit should be preferred
  shouldUse: (): Promise<{
    shouldUse: boolean
    reason: string
    capabilities: ScreenCaptureKitCapabilities
  }> =>
    ipcRenderer.invoke('screenCaptureKit:shouldUse'),

  // Get list of known meeting app bundles
  getMeetingAppBundles: (): Promise<string[]> =>
    ipcRenderer.invoke('screenCaptureKit:getMeetingAppBundles')
}

// ============================================================================
// ML Pipeline API
// ============================================================================

const mlPipelineAPI = {
  // Transcribe an audio file
  transcribe: (audioPath: string, config?: TranscriptionConfig): Promise<TranscriptionResult> =>
    ipcRenderer.invoke('mlPipeline:transcribe', audioPath, config),

  // Perform speaker diarization
  diarize: (audioPath: string, config?: DiarizationConfig): Promise<DiarizationResult> =>
    ipcRenderer.invoke('mlPipeline:diarize', audioPath, config),

  // Run complete pipeline (transcription + diarization + combining)
  processComplete: (
    audioPath: string,
    transcriptionConfig?: TranscriptionConfig,
    diarizationConfig?: DiarizationConfig
  ): Promise<{
    transcription: TranscriptionResult
    diarization: DiarizationResult
    combined: CombinedSegment[]
  }> =>
    ipcRenderer.invoke('mlPipeline:processComplete', audioPath, transcriptionConfig, diarizationConfig),

  // Cancel a running job
  cancel: (jobId: string): Promise<boolean> =>
    ipcRenderer.invoke('mlPipeline:cancel', jobId),

  // Get pipeline status
  getStatus: (): Promise<PipelineStatus> =>
    ipcRenderer.invoke('mlPipeline:getStatus'),

  // Check Python dependencies (supports WhisperX or faster-whisper backends)
  checkDependencies: (): Promise<{
    pythonAvailable: boolean
    pythonPath: string
    whisperxAvailable: boolean
    fasterWhisperAvailable: boolean
    pyannoteAvailable: boolean
    cudaAvailable: boolean
    transcriptionBackend: 'whisperx' | 'faster-whisper' | null
    errors: string[]
  }> =>
    ipcRenderer.invoke('mlPipeline:checkDependencies'),

  // Get available transcription models
  getAvailableModels: (): Promise<ModelSize[]> =>
    ipcRenderer.invoke('mlPipeline:getAvailableModels'),

  // Get supported languages
  getSupportedLanguages: (): Promise<Record<string, string>> =>
    ipcRenderer.invoke('mlPipeline:getSupportedLanguages'),

  // Subscribe to progress updates
  onProgress: (callback: (progress: PipelineProgress) => void): (() => void) => {
    const handler = (_event: unknown, progress: PipelineProgress) => {
      callback(progress)
    }
    ipcRenderer.on('mlPipeline:progress', handler)
    return () => {
      ipcRenderer.removeListener('mlPipeline:progress', handler)
    }
  }
}

// ============================================================================
// Live Transcription API
// ============================================================================

const liveTranscriptionAPI = {
  // Start a live transcription session
  startSession: (
    meetingId: string,
    audioPath: string,
    config?: LiveTranscriptionConfig
  ): Promise<{ success: boolean; error?: string }> =>
    ipcRenderer.invoke('liveTranscription:startSession', meetingId, audioPath, config),

  // Transcribe a chunk of audio
  transcribeChunk: (
    audioPath: string,
    config?: {
      language?: string
      modelSize?: 'tiny' | 'base' | 'small'
      startTimeMs?: number
    }
  ): Promise<TranscribeChunkResult> =>
    ipcRenderer.invoke('liveTranscription:transcribeChunk', audioPath, config),

  // Pause live transcription
  pause: (): Promise<{ success: boolean }> =>
    ipcRenderer.invoke('liveTranscription:pause'),

  // Resume live transcription
  resume: (): Promise<{ success: boolean }> =>
    ipcRenderer.invoke('liveTranscription:resume'),

  // Stop live transcription session
  stopSession: (): Promise<{ success: boolean; segmentCount: number }> =>
    ipcRenderer.invoke('liveTranscription:stopSession'),

  // Get current status
  getStatus: (): Promise<LiveTranscriptionState> =>
    ipcRenderer.invoke('liveTranscription:getStatus'),

  // Check if live transcription is available
  isAvailable: (): Promise<{
    available: boolean
    pythonPath: string
    error?: string
  }> =>
    ipcRenderer.invoke('liveTranscription:isAvailable'),

  // Force reset transcription state (for recovery from stuck states)
  forceReset: (): Promise<{ success: boolean }> =>
    ipcRenderer.invoke('liveTranscription:forceReset'),

  // Get audio diagnostics for debugging
  getAudioDiagnostics: (): Promise<{
    chunksReceived: number
    chunksToPython: number
    bytesReceived: number
    bytesToPython: number
    lastChunkTime: number
    bufferSize: number
    isModelReady: boolean
    detectedSampleRate: number | null
  }> => ipcRenderer.invoke('liveTranscription:getAudioDiagnostics'),

  // Subscribe to progress updates
  onProgress: (callback: (progress: LiveTranscriptionProgress) => void): (() => void) => {
    const handler = (_event: unknown, progress: LiveTranscriptionProgress) => {
      callback(progress)
    }
    ipcRenderer.on('liveTranscription:progress', handler)
    return () => {
      ipcRenderer.removeListener('liveTranscription:progress', handler)
    }
  },

  // Subscribe to new segment events (real-time transcript segments)
  onSegment: (callback: (segment: LiveTranscriptSegment) => void): (() => void) => {
    const handler = (_event: unknown, segment: LiveTranscriptSegment) => {
      callback(segment)
    }
    ipcRenderer.on('liveTranscription:segment', handler)
    return () => {
      ipcRenderer.removeListener('liveTranscription:segment', handler)
    }
  },

  // Subscribe to diarization status updates
  // CRITICAL: This is needed to show proper error messages when diarization fails
  // (e.g., due to missing HF_TOKEN for pyannote/embedding model)
  onDiarizationStatus: (callback: (status: {
    available: boolean
    reason?: string
    details?: string
    message?: string
    capabilities?: {
      speaker_embeddings: boolean
      speaker_clustering: boolean
      speaker_change_detection: boolean
      transcription_only: boolean
      max_speakers?: number
      similarity_threshold?: number
      embedding_backend?: string
    }
  }) => void): (() => void) => {
    const handler = (_event: unknown, status: any) => {
      callback(status)
    }
    ipcRenderer.on('liveTranscription:diarizationStatus', handler)
    return () => {
      ipcRenderer.removeListener('liveTranscription:diarizationStatus', handler)
    }
  }
}

// ============================================================================
// Batch Diarization API
// ============================================================================

const diarizationAPI = {
  // Process a single meeting to add speaker labels
  processMeeting: (
    meetingId: string,
    options?: BatchDiarizationOptions
  ): Promise<BatchDiarizationResult> =>
    ipcRenderer.invoke('diarization:processMeeting', meetingId, options),

  // Process multiple meetings in batch
  processMeetings: (
    meetingIds: string[],
    options?: BatchDiarizationOptions
  ): Promise<{
    success: number
    failed: number
    errors: string[]
  }> =>
    ipcRenderer.invoke('diarization:processMeetings', meetingIds, options),

  // Subscribe to progress updates during diarization
  onProgress: (callback: (progress: BatchDiarizationProgress) => void): (() => void) => {
    const handler = (_event: unknown, progress: BatchDiarizationProgress) => {
      callback(progress)
    }
    ipcRenderer.on('diarization:progress', handler)
    return () => {
      ipcRenderer.removeListener('diarization:progress', handler)
    }
  }
}

// ============================================================================
// Core Diarization Engine API (MANDATORY preprocessing stage)
// ============================================================================

const coreDiarizationAPI = {
  // Initialize the core diarization engine
  // BLOCKING: If required=true and initialization fails, returns error status
  initialize: (config?: CoreDiarizationConfig): Promise<CoreDiarizationStatus> =>
    ipcRenderer.invoke('coreDiarization:initialize', config),

  // Process an audio file through the diarization engine
  // This should be called BEFORE transcription in the pipeline
  processAudioFile: (
    audioPath: string,
    config?: CoreDiarizationConfig
  ): Promise<CoreDiarizationResult> =>
    ipcRenderer.invoke('coreDiarization:processAudioFile', audioPath, config),

  // Get the status of the core diarization engine
  getStatus: (): Promise<CoreDiarizationStatus> =>
    ipcRenderer.invoke('coreDiarization:getStatus'),

  // Check if diarization is available
  isAvailable: (): Promise<boolean> =>
    ipcRenderer.invoke('coreDiarization:isAvailable'),

  // Get speaker for a time range (used to assign speakers to transcription segments)
  getSpeakerForTimeRange: (
    startTime: number,
    endTime: number,
    segments: CoreDiarizationSegment[]
  ): Promise<{ speaker_id: string; confidence: number } | null> =>
    ipcRenderer.invoke('coreDiarization:getSpeakerForTimeRange', startTime, endTime, segments),

  // Cancel any ongoing diarization process
  cancel: (): Promise<boolean> =>
    ipcRenderer.invoke('coreDiarization:cancel'),

  // Reset the service state
  reset: (): Promise<{ success: boolean }> =>
    ipcRenderer.invoke('coreDiarization:reset')
}

// ============================================================================
// Streaming Diarization API (Real-time speaker detection during live recording)
// ============================================================================

const streamingDiarizationAPI = {
  // Start a streaming diarization session
  startSession: (
    meetingId: string,
    config?: StreamingDiarizationConfig
  ): Promise<{ success: boolean; error?: string }> =>
    ipcRenderer.invoke('streamingDiarization:startSession', meetingId, config),

  // Send an audio chunk for diarization processing
  sendAudioChunk: (audioData: ArrayBuffer): Promise<{ success: boolean; error?: string }> =>
    ipcRenderer.invoke('streamingDiarization:sendAudioChunk', audioData),

  // Get speaker assignment for a time range (for matching with transcription)
  getSpeakerForTimeRange: (
    startTime: number,
    endTime: number
  ): Promise<{ speaker: string; confidence: number } | null> =>
    ipcRenderer.invoke('streamingDiarization:getSpeakerForTimeRange', startTime, endTime),

  // Get all speaker segments
  getSegments: (): Promise<SpeakerSegment[]> =>
    ipcRenderer.invoke('streamingDiarization:getSegments'),

  // Get speaker statistics
  getSpeakerStats: (): Promise<Record<string, StreamingSpeakerStats>> =>
    ipcRenderer.invoke('streamingDiarization:getSpeakerStats'),

  // Pause diarization
  pause: (): Promise<{ success: boolean }> =>
    ipcRenderer.invoke('streamingDiarization:pause'),

  // Resume diarization
  resume: (): Promise<{ success: boolean }> =>
    ipcRenderer.invoke('streamingDiarization:resume'),

  // Stop streaming diarization session
  stopSession: (): Promise<{
    success: boolean
    segments: SpeakerSegment[]
    stats: Record<string, StreamingSpeakerStats>
  }> =>
    ipcRenderer.invoke('streamingDiarization:stopSession'),

  // Get current status
  getStatus: (): Promise<StreamingDiarizationState> =>
    ipcRenderer.invoke('streamingDiarization:getStatus'),

  // Check if streaming diarization is available
  isAvailable: (): Promise<{
    available: boolean
    pythonPath: string
    hasBackend: boolean
    error?: string
  }> =>
    ipcRenderer.invoke('streamingDiarization:isAvailable'),

  // Force reset the service state
  forceReset: (): Promise<{ success: boolean }> =>
    ipcRenderer.invoke('streamingDiarization:forceReset'),

  // Subscribe to speaker segment events (real-time speaker detection)
  onSpeakerSegment: (callback: (segment: SpeakerSegment) => void): (() => void) => {
    const handler = (_event: unknown, segment: SpeakerSegment) => {
      callback(segment)
    }
    ipcRenderer.on('streamingDiarization:segment', handler)
    return () => {
      ipcRenderer.removeListener('streamingDiarization:segment', handler)
    }
  },

  // Subscribe to speaker change events
  onSpeakerChange: (callback: (event: SpeakerChangeEvent) => void): (() => void) => {
    const handler = (_event: unknown, event: SpeakerChangeEvent) => {
      callback(event)
    }
    ipcRenderer.on('streamingDiarization:speakerChange', handler)
    return () => {
      ipcRenderer.removeListener('streamingDiarization:speakerChange', handler)
    }
  },

  // Subscribe to status updates
  onStatus: (callback: (status: { status: string; message?: string; timestamp: number }) => void): (() => void) => {
    const handler = (_event: unknown, status: { status: string; message?: string; timestamp: number }) => {
      callback(status)
    }
    ipcRenderer.on('streamingDiarization:status', handler)
    return () => {
      ipcRenderer.removeListener('streamingDiarization:status', handler)
    }
  },

  // Subscribe to retroactive correction events
  onCorrection: (callback: (event: RetroactiveCorrectionEvent) => void): (() => void) => {
    const handler = (_event: unknown, event: RetroactiveCorrectionEvent) => {
      callback(event)
    }
    ipcRenderer.on('streamingDiarization:correction', handler)
    return () => {
      ipcRenderer.removeListener('streamingDiarization:correction', handler)
    }
  },

  // Subscribe to speaker statistics updates
  onStats: (callback: (stats: Record<string, StreamingSpeakerStats>) => void): (() => void) => {
    const handler = (_event: unknown, stats: Record<string, StreamingSpeakerStats>) => {
      callback(stats)
    }
    ipcRenderer.on('streamingDiarization:stats', handler)
    return () => {
      ipcRenderer.removeListener('streamingDiarization:stats', handler)
    }
  }
}

// ============================================================================
// Diarization Failure API (Explicit Failure Detection and User Notification)
// ============================================================================

export interface RemediationStep {
  order: number
  title: string
  description: string
  command?: string
  automated?: boolean
  helpUrl?: string
}

export interface DiarizationFailure {
  id: string
  timestamp: number
  type: string
  severity: 'error' | 'warning' | 'info'
  message: string
  diagnosticInfo: string
  remediationSteps: RemediationStep[]
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

export interface DiarizationFailureNotification {
  prominentMessage: string
  detailedMessage: string
  diagnosticSummary: string
  remediationSteps: RemediationStep[]
  showTranscriptionOnlyOption: boolean
  timestamp: number
  failureId: string
}

const diarizationFailureAPI = {
  // Record a diarization failure
  recordFailure: (params: {
    errorCode?: string
    errorMessage?: string
    meetingId?: string
    audioPath?: string
    pythonOutput?: string
    stackTrace?: string
  }): Promise<DiarizationFailure> =>
    ipcRenderer.invoke('diarizationFailure:recordFailure', params),

  // Generate notification for a failure
  generateNotification: (failureId: string): Promise<DiarizationFailureNotification | null> =>
    ipcRenderer.invoke('diarizationFailure:generateNotification', failureId),

  // Acknowledge a failure
  acknowledge: (failureId: string): Promise<boolean> =>
    ipcRenderer.invoke('diarizationFailure:acknowledge', failureId),

  // Get recent failures
  getRecentFailures: (count?: number): Promise<DiarizationFailure[]> =>
    ipcRenderer.invoke('diarizationFailure:getRecentFailures', count),

  // Get unacknowledged failures
  getUnacknowledged: (): Promise<DiarizationFailure[]> =>
    ipcRenderer.invoke('diarizationFailure:getUnacknowledged'),

  // Check for unacknowledged failures
  hasUnacknowledged: (): Promise<boolean> =>
    ipcRenderer.invoke('diarizationFailure:hasUnacknowledged'),

  // Get the mandatory failure message
  getMessage: (): Promise<string> =>
    ipcRenderer.invoke('diarizationFailure:getMessage'),

  // Validate that a result is not a silent fallback
  validateNotSilentFallback: (result: {
    success: boolean
    segments?: any[]
    numSpeakers?: number
    speakers?: string[]
    error?: string
  }): Promise<{ valid: boolean; reason?: string }> =>
    ipcRenderer.invoke('diarizationFailure:validateNotSilentFallback', result),

  // Get failure count
  getCount: (): Promise<number> =>
    ipcRenderer.invoke('diarizationFailure:getCount'),

  // Export failures as JSON
  export: (): Promise<string> =>
    ipcRenderer.invoke('diarizationFailure:export'),

  // Clear all failures
  clear: (): Promise<{ success: boolean }> =>
    ipcRenderer.invoke('diarizationFailure:clear'),

  // Get transcription-only mode preference
  getTranscriptionOnlyMode: (): Promise<{
    diarizationDisabled: boolean
    transcriptionOnlyAcknowledged: boolean
  }> =>
    ipcRenderer.invoke('diarizationFailure:getTranscriptionOnlyMode'),

  // Set transcription-only mode preference
  setTranscriptionOnlyMode: (enabled: boolean, reason?: string): Promise<{ success: boolean; error?: string }> =>
    ipcRenderer.invoke('diarizationFailure:setTranscriptionOnlyMode', enabled, reason),

  // Subscribe to failure events
  onFailure: (callback: (failure: DiarizationFailure) => void): (() => void) => {
    const handler = (_event: unknown, failure: DiarizationFailure) => {
      callback(failure)
    }
    ipcRenderer.on('diarizationFailure:failure', handler)
    return () => {
      ipcRenderer.removeListener('diarizationFailure:failure', handler)
    }
  },

  // Subscribe to notification events
  onNotification: (callback: (notification: DiarizationFailureNotification) => void): (() => void) => {
    const handler = (_event: unknown, notification: DiarizationFailureNotification) => {
      callback(notification)
    }
    ipcRenderer.on('diarizationFailure:notification', handler)
    return () => {
      ipcRenderer.removeListener('diarizationFailure:notification', handler)
    }
  }
}

// ============================================================================
// Diarization Health Monitor API (Real-time health monitoring and fallback)
// ============================================================================

export interface DiarizationHealthEvent {
  status: 'active' | 'degraded' | 'failed' | 'disabled' | 'unknown'
  previousStatus: string
  reason?: string
  message: string
  timestamp: number
  meetingId?: string
  recoveryOptions: Array<{
    id: string
    label: string
    description: string
    action: string
    recommended?: boolean
  }>
}

export interface DiarizationHealthStats {
  sessionStartTime: number
  lastSegmentTime: number | null
  totalSegments: number
  totalSpeakers: number
  consecutiveErrors: number
  lastErrorTime: number | null
  lastErrorReason: string | null
  degradedSince: number | null
  failedSince: number | null
}

export interface PostMeetingRecoveryJob {
  meetingId: string
  audioPath: string
  queuedAt: number
  reason: string
  status: 'pending' | 'processing' | 'completed' | 'failed'
  completedAt?: number
  error?: string
}

const diarizationHealthAPI = {
  // Start health monitoring for a recording session
  startMonitoring: (meetingId: string): Promise<{ success: boolean }> =>
    ipcRenderer.invoke('diarizationHealth:startMonitoring', meetingId),

  // Stop health monitoring
  stopMonitoring: (): Promise<{ success: boolean }> =>
    ipcRenderer.invoke('diarizationHealth:stopMonitoring'),

  // Report a segment was detected (for health tracking)
  reportSegment: (speaker: string): Promise<{ success: boolean }> =>
    ipcRenderer.invoke('diarizationHealth:reportSegment', speaker),

  // Report speaker count update
  reportSpeakerCount: (count: number): Promise<{ success: boolean }> =>
    ipcRenderer.invoke('diarizationHealth:reportSpeakerCount', count),

  // Report diarization initialized
  reportInitialized: (): Promise<{ success: boolean }> =>
    ipcRenderer.invoke('diarizationHealth:reportInitialized'),

  // Report diarization error
  reportError: (error: string, reason?: string): Promise<{ success: boolean }> =>
    ipcRenderer.invoke('diarizationHealth:reportError', error, reason),

  // Report diarization unavailable
  reportUnavailable: (reason: string): Promise<{ success: boolean }> =>
    ipcRenderer.invoke('diarizationHealth:reportUnavailable', reason),

  // Get current health status
  getStatus: (): Promise<'active' | 'degraded' | 'failed' | 'disabled' | 'unknown'> =>
    ipcRenderer.invoke('diarizationHealth:getStatus'),

  // Get health statistics
  getStats: (): Promise<DiarizationHealthStats> =>
    ipcRenderer.invoke('diarizationHealth:getStats'),

  // Get combined status for UI display
  getStatusForUI: (): Promise<{
    status: string
    color: string
    label: string
    message: string
    showRecoveryOption: boolean
  }> =>
    ipcRenderer.invoke('diarizationHealth:getStatusForUI'),

  // Set user skip preference
  setSkipPreference: (skip: boolean): Promise<{ success: boolean }> =>
    ipcRenderer.invoke('diarizationHealth:setSkipPreference', skip),

  // Get user skip preference
  getSkipPreference: (): Promise<boolean> =>
    ipcRenderer.invoke('diarizationHealth:getSkipPreference'),

  // Schedule post-meeting recovery
  scheduleRecovery: (meetingId: string): Promise<{ success: boolean }> =>
    ipcRenderer.invoke('diarizationHealth:scheduleRecovery', meetingId),

  // Trigger manual recovery
  triggerRecovery: (meetingId: string): Promise<{
    success: boolean
    speakersDetected: number
    transcriptsUpdated: number
    error?: string
  }> =>
    ipcRenderer.invoke('diarizationHealth:triggerRecovery', meetingId),

  // Get pending recovery jobs
  getPendingRecoveryJobs: (): Promise<PostMeetingRecoveryJob[]> =>
    ipcRenderer.invoke('diarizationHealth:getPendingRecoveryJobs'),

  // Get capabilities
  getCapabilities: (): Promise<{
    available: boolean
    pyannoteInstalled: boolean
    huggingFaceConfigured: boolean
    device: string
    error?: string
  }> =>
    ipcRenderer.invoke('diarizationHealth:getCapabilities'),

  // Retry diarization
  retry: (): Promise<{ success: boolean }> =>
    ipcRenderer.invoke('diarizationHealth:retry'),

  // Skip diarization for current session
  skip: (): Promise<{ success: boolean }> =>
    ipcRenderer.invoke('diarizationHealth:skip'),

  // Subscribe to health change events
  onHealthChange: (callback: (event: DiarizationHealthEvent) => void): (() => void) => {
    const handler = (_event: unknown, healthEvent: DiarizationHealthEvent) => {
      callback(healthEvent)
    }
    ipcRenderer.on('diarizationHealth:change', handler)
    return () => {
      ipcRenderer.removeListener('diarizationHealth:change', handler)
    }
  },

  // Subscribe to speaker count changes
  onSpeakerCountChange: (callback: (count: number) => void): (() => void) => {
    const handler = (_event: unknown, count: number) => {
      callback(count)
    }
    ipcRenderer.on('diarizationHealth:speakerCount', handler)
    return () => {
      ipcRenderer.removeListener('diarizationHealth:speakerCount', handler)
    }
  },

  // Subscribe to recovery queued events
  onRecoveryQueued: (callback: (job: PostMeetingRecoveryJob) => void): (() => void) => {
    const handler = (_event: unknown, job: PostMeetingRecoveryJob) => {
      callback(job)
    }
    ipcRenderer.on('diarizationHealth:recoveryQueued', handler)
    return () => {
      ipcRenderer.removeListener('diarizationHealth:recoveryQueued', handler)
    }
  },

  // Subscribe to recovery progress events
  onRecoveryProgress: (callback: (progress: {
    meetingId: string
    phase: string
    progress: number
    message: string
  }) => void): (() => void) => {
    const handler = (_event: unknown, progress: {
      meetingId: string
      phase: string
      progress: number
      message: string
    }) => {
      callback(progress)
    }
    ipcRenderer.on('diarizationHealth:recoveryProgress', handler)
    return () => {
      ipcRenderer.removeListener('diarizationHealth:recoveryProgress', handler)
    }
  }
}

// ============================================================================
// Python Environment Validation API
// ============================================================================

export type ValidationCheckType =
  | 'python_binary'
  | 'python_version'
  | 'package_imports'
  | 'pyannote_model'
  | 'native_dependencies'
  | 'file_permissions'
  | 'subprocess_spawn'
  | 'env_propagation'

export type ValidationStatus = 'pass' | 'fail' | 'warning' | 'skipped'

export interface ValidationCheck {
  type: ValidationCheckType
  name: string
  status: ValidationStatus
  message: string
  error?: string
  remediation?: string[]
  duration: number
  details?: Record<string, unknown>
}

export interface ValidationResult {
  success: boolean
  timestamp: string
  checks: ValidationCheck[]
  environment: {
    type: 'bundled' | 'venv' | 'system' | 'none'
    pythonPath: string | null
    pythonVersion: string | null
    platform: {
      os: string
      arch: string
      isAppleSilicon: boolean
    }
  }
  environmentVariables: Record<string, string>
  packageVersions: Record<string, string>
  modelLocations: Record<string, string | null>
  summary: {
    total: number
    passed: number
    failed: number
    warnings: number
    skipped: number
  }
  recommendations: string[]
}

export interface AutoRepairResult {
  success: boolean
  actionsAttempted: string[]
  actionsSucceeded: string[]
  actionsFailed: string[]
  logs: string[]
  validationAfter?: ValidationResult
}

// Cache statistics type
export interface CacheStats {
  smartCheckingEnabled: boolean
  hasCache: boolean
  lastValidated: string | null
  cacheAgeHours: number | null
  hashesMatch: boolean
  cachedStatus: 'ready' | 'functional' | 'degraded' | 'failed' | null
}

const pythonValidationAPI = {
  // Run comprehensive validation
  validate: (forceRefresh = false): Promise<ValidationResult> =>
    ipcRenderer.invoke('pythonValidation:validate', forceRefresh),

  // Attempt automatic repair
  autoRepair: (): Promise<AutoRepairResult> =>
    ipcRenderer.invoke('pythonValidation:autoRepair'),

  // Clear validation cache
  clearCache: (): Promise<{ success: boolean }> =>
    ipcRenderer.invoke('pythonValidation:clearCache'),

  // Get cache statistics
  getCacheStats: (): Promise<CacheStats> =>
    ipcRenderer.invoke('pythonValidation:getCacheStats'),

  // Set smart environment checking enabled/disabled
  setSmartChecking: (enabled: boolean): Promise<{ success: boolean; error?: string }> =>
    ipcRenderer.invoke('pythonValidation:setSmartChecking', enabled),

  // Start file system watchers for venv directories
  startWatchers: (): Promise<{ success: boolean; error?: string }> =>
    ipcRenderer.invoke('pythonValidation:startWatchers'),

  // Stop file system watchers
  stopWatchers: (): Promise<{ success: boolean; error?: string }> =>
    ipcRenderer.invoke('pythonValidation:stopWatchers'),

  // Subscribe to validation start events
  onValidationStart: (callback: () => void): (() => void) => {
    const handler = () => {
      callback()
    }
    ipcRenderer.on('pythonValidation:start', handler)
    return () => {
      ipcRenderer.removeListener('pythonValidation:start', handler)
    }
  },

  // Subscribe to validation complete events
  onValidationComplete: (callback: (result: ValidationResult) => void): (() => void) => {
    const handler = (_event: unknown, result: ValidationResult) => {
      callback(result)
    }
    ipcRenderer.on('pythonValidation:complete', handler)
    return () => {
      ipcRenderer.removeListener('pythonValidation:complete', handler)
    }
  },

  // Subscribe to repair start events
  onRepairStart: (callback: () => void): (() => void) => {
    const handler = () => {
      callback()
    }
    ipcRenderer.on('pythonValidation:repairStart', handler)
    return () => {
      ipcRenderer.removeListener('pythonValidation:repairStart', handler)
    }
  },

  // Subscribe to repair complete events
  onRepairComplete: (callback: (result: AutoRepairResult) => void): (() => void) => {
    const handler = (_event: unknown, result: AutoRepairResult) => {
      callback(result)
    }
    ipcRenderer.on('pythonValidation:repairComplete', handler)
    return () => {
      ipcRenderer.removeListener('pythonValidation:repairComplete', handler)
    }
  }
}

// ============================================================================
// Tiered Validation API (Progressive Startup Validation)
// ============================================================================

export type ValidationTier = 'tier1' | 'tier2' | 'tier3'
export type ValidationLevel = 'fast' | 'balanced' | 'thorough'
export type TieredValidationStatus = 'idle' | 'running' | 'complete' | 'error'
export type EnvironmentReadiness = 'ready' | 'functional' | 'degraded' | 'failed'

export interface TierResult {
  tier: ValidationTier
  status: TieredValidationStatus
  startTime: number
  endTime?: number
  duration?: number
  checks: ValidationCheck[]
  success: boolean
  readiness: EnvironmentReadiness
  statusMessage: string
}

export interface TieredValidationState {
  currentTier: ValidationTier | null
  tier1: TierResult | null
  tier2: TierResult | null
  tier3: TierResult | null
  overallStatus: TieredValidationStatus
  overallReadiness: EnvironmentReadiness
  overallStatusMessage: string
  lastFullValidation: string | null
  isBackgroundValidationRunning: boolean
}

export interface ValidationMetrics {
  tier1Duration: number | null
  tier2Duration: number | null
  tier3Duration: number | null
  totalDuration: number | null
  checksPerformed: number
  checksPassed: number
  checksFailed: number
  cacheHit: boolean
  timestamp: string
}

const tieredValidationAPI = {
  // Run Tier 1 validation (fast startup check)
  runTier1: (): Promise<TierResult> =>
    ipcRenderer.invoke('tieredValidation:runTier1'),

  // Run Tier 2 validation (background, after UI loads)
  runTier2: (): Promise<TierResult | null> =>
    ipcRenderer.invoke('tieredValidation:runTier2'),

  // Run Tier 3 validation (on-demand, when feature used)
  runTier3: (feature: 'transcription' | 'diarization'): Promise<TierResult | null> =>
    ipcRenderer.invoke('tieredValidation:runTier3', feature),

  // Run full validation based on validation level setting
  runFull: (forceLevel?: ValidationLevel): Promise<ValidationResult> =>
    ipcRenderer.invoke('tieredValidation:runFull', forceLevel),

  // Get current validation state
  getState: (): Promise<TieredValidationState> =>
    ipcRenderer.invoke('tieredValidation:getState'),

  // Get validation level setting
  getLevel: (): Promise<ValidationLevel> =>
    ipcRenderer.invoke('tieredValidation:getLevel'),

  // Set validation level setting
  setLevel: (level: ValidationLevel): Promise<{ success: boolean; error?: string }> =>
    ipcRenderer.invoke('tieredValidation:setLevel', level),

  // Get validation metrics
  getMetrics: (): Promise<{ history: ValidationMetrics[]; latest: ValidationMetrics | null }> =>
    ipcRenderer.invoke('tieredValidation:getMetrics'),

  // Clear validation state
  clearState: (): Promise<{ success: boolean; error?: string }> =>
    ipcRenderer.invoke('tieredValidation:clearState'),

  // Subscribe to Tier 1 start events
  onTier1Start: (callback: () => void): (() => void) => {
    const handler = () => callback()
    ipcRenderer.on('tieredValidation:tier1Start', handler)
    return () => ipcRenderer.removeListener('tieredValidation:tier1Start', handler)
  },

  // Subscribe to Tier 1 complete events
  onTier1Complete: (callback: (result: TierResult) => void): (() => void) => {
    const handler = (_event: unknown, result: TierResult) => callback(result)
    ipcRenderer.on('tieredValidation:tier1Complete', handler)
    return () => ipcRenderer.removeListener('tieredValidation:tier1Complete', handler)
  },

  // Subscribe to Tier 2 start events
  onTier2Start: (callback: () => void): (() => void) => {
    const handler = () => callback()
    ipcRenderer.on('tieredValidation:tier2Start', handler)
    return () => ipcRenderer.removeListener('tieredValidation:tier2Start', handler)
  },

  // Subscribe to Tier 2 complete events
  onTier2Complete: (callback: (result: TierResult) => void): (() => void) => {
    const handler = (_event: unknown, result: TierResult) => callback(result)
    ipcRenderer.on('tieredValidation:tier2Complete', handler)
    return () => ipcRenderer.removeListener('tieredValidation:tier2Complete', handler)
  },

  // Subscribe to Tier 3 start events
  onTier3Start: (callback: (data: { feature: string }) => void): (() => void) => {
    const handler = (_event: unknown, data: { feature: string }) => callback(data)
    ipcRenderer.on('tieredValidation:tier3Start', handler)
    return () => ipcRenderer.removeListener('tieredValidation:tier3Start', handler)
  },

  // Subscribe to Tier 3 complete events
  onTier3Complete: (callback: (data: { feature: string; result: TierResult }) => void): (() => void) => {
    const handler = (_event: unknown, data: { feature: string; result: TierResult }) => callback(data)
    ipcRenderer.on('tieredValidation:tier3Complete', handler)
    return () => ipcRenderer.removeListener('tieredValidation:tier3Complete', handler)
  },

  // Subscribe to full validation complete events
  onComplete: (callback: (result: ValidationResult) => void): (() => void) => {
    const handler = (_event: unknown, result: ValidationResult) => callback(result)
    ipcRenderer.on('tieredValidation:complete', handler)
    return () => ipcRenderer.removeListener('tieredValidation:complete', handler)
  },

  // Subscribe to settings changed events
  onSettingsChanged: (callback: (data: { validationLevel: ValidationLevel }) => void): (() => void) => {
    const handler = (_event: unknown, data: { validationLevel: ValidationLevel }) => callback(data)
    ipcRenderer.on('tieredValidation:settingsChanged', handler)
    return () => ipcRenderer.removeListener('tieredValidation:settingsChanged', handler)
  }
}

// ============================================================================
// Python Setup API (Automated Environment Creation)
// ============================================================================

export interface SetupStep {
  id: string
  name: string
  description: string
  estimatedTime?: string
}

export interface SetupProgress {
  step: string
  percentage: number
  message: string
  estimatedTime?: string
  timestamp: string
  type: 'progress' | 'success' | 'error' | 'warning' | 'step_complete' | 'complete' | 'remediation'
  code?: number
  remediationSteps?: string[]
}

export interface SetupResult {
  success: boolean
  error?: string
  exitCode: number
  duration: number
  metadata?: EnvironmentMetadata
  remediationSteps?: string[]
}

export interface EnvironmentInfo {
  path: string
  pythonVersion: string
  packages: Record<string, string>
  purpose: 'transcription' | 'diarization'
  status: 'ready' | 'error' | 'missing'
}

export interface EnvironmentMetadata {
  schemaVersion: number
  createdAt: string
  updatedAt: string
  setupScript: string
  systemPython: {
    version: string
    path: string
  }
  environments: {
    whisperx: EnvironmentInfo
    pyannote: EnvironmentInfo
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
}

export interface SetupOptions {
  skipModels?: boolean
  force?: boolean
  quiet?: boolean
  hfToken?: string
}

export interface SetupState {
  status: 'idle' | 'running' | 'completed' | 'failed' | 'cancelled'
  progress: number
  currentStep: string
  error?: string
  startTime?: number
  endTime?: number
}

const pythonSetupAPI = {
  // Check if setup is required
  isRequired: (): Promise<boolean> =>
    ipcRenderer.invoke('pythonSetup:isRequired'),

  // Check if setup scripts exist
  scriptsExist: (): Promise<boolean> =>
    ipcRenderer.invoke('pythonSetup:scriptsExist'),

  // Get current setup state
  getState: (): Promise<SetupState> =>
    ipcRenderer.invoke('pythonSetup:getState'),

  // Get setup steps
  getSteps: (): Promise<SetupStep[]> =>
    ipcRenderer.invoke('pythonSetup:getSteps'),

  // Get environment metadata
  getMetadata: (): Promise<EnvironmentMetadata | null> =>
    ipcRenderer.invoke('pythonSetup:getMetadata'),

  // Check if HuggingFace token is configured
  isHfTokenConfigured: (): Promise<boolean> =>
    ipcRenderer.invoke('pythonSetup:isHfTokenConfigured'),

  // Get estimated setup time
  getEstimatedTime: (skipModels: boolean): Promise<string> =>
    ipcRenderer.invoke('pythonSetup:getEstimatedTime', skipModels),

  // Get environment paths
  getEnvironmentPaths: (): Promise<{ whisperx: string; pyannote: string }> =>
    ipcRenderer.invoke('pythonSetup:getEnvironmentPaths'),

  // Run setup
  runSetup: (options?: SetupOptions): Promise<SetupResult> =>
    ipcRenderer.invoke('pythonSetup:runSetup', options || {}),

  // Cancel running setup
  cancelSetup: (): Promise<boolean> =>
    ipcRenderer.invoke('pythonSetup:cancel'),

  // Repair environments
  repair: (options?: Omit<SetupOptions, 'force'>): Promise<SetupResult> =>
    ipcRenderer.invoke('pythonSetup:repair', options || {}),

  // Reset service state
  reset: (): Promise<{ success: boolean }> =>
    ipcRenderer.invoke('pythonSetup:reset'),

  // Subscribe to progress events
  onProgress: (callback: (progress: SetupProgress) => void): (() => void) => {
    const handler = (_event: unknown, progress: SetupProgress) => {
      callback(progress)
    }
    ipcRenderer.on('pythonSetup:progress', handler)
    return () => {
      ipcRenderer.removeListener('pythonSetup:progress', handler)
    }
  },

  // Subscribe to state change events
  onStateChange: (callback: (state: SetupState) => void): (() => void) => {
    const handler = (_event: unknown, state: SetupState) => {
      callback(state)
    }
    ipcRenderer.on('pythonSetup:stateChange', handler)
    return () => {
      ipcRenderer.removeListener('pythonSetup:stateChange', handler)
    }
  }
}

// ============================================================================
// Python Execution Manager API (Centralized Python Script Execution)
// ============================================================================

export type PythonOperationType = 'transcription' | 'diarization' | 'utility'
export type PythonExecEnvironmentType = 'bundled' | 'dual-venv' | 'single-venv' | 'system' | 'none'

export interface EnvironmentHealthStatus {
  healthy: boolean
  pythonPath: string | null
  version: string | null
  lastValidated: number
  errors: string[]
  packages: {
    torch?: boolean
    whisperx?: boolean
    fasterWhisper?: boolean
    pyannote?: boolean
    speechbrain?: boolean
  }
  torchVersion?: string
}

export interface PythonExecutionManagerStatus {
  type: PythonExecEnvironmentType
  ready: boolean
  whisperx: EnvironmentHealthStatus
  pyannote: EnvironmentHealthStatus
  platform: {
    os: string
    arch: string
    isAppleSilicon: boolean
  }
  hfTokenConfigured: boolean
  recommendations: string[]
}

export interface ExecutionResult {
  success: boolean
  code: number
  stdout: string
  stderr: string
  error?: string
  environmentUsed: 'whisperx' | 'pyannote' | 'bundled' | 'system'
  usedFallback: boolean
  executionTimeMs: number
}

export interface RepairResult {
  success: boolean
  actions: string[]
  errors: string[]
  recommendations: string[]
}

const pythonExecutionManagerAPI = {
  // Get status of all Python environments
  getStatus: (forceRefresh?: boolean): Promise<PythonExecutionManagerStatus> =>
    ipcRenderer.invoke('pythonEnv:getStatus', forceRefresh),

  // Execute a Python script with auto-routing based on operation type
  execute: (scriptName: string, options?: {
    args?: string[]
    timeout?: number
    forceOperationType?: PythonOperationType
    enableFallback?: boolean
  }): Promise<ExecutionResult> =>
    ipcRenderer.invoke('pythonEnv:execute', scriptName, options),

  // Repair Python environments
  repair: (): Promise<RepairResult> =>
    ipcRenderer.invoke('pythonEnv:repair'),

  // Get the Python scripts directory path
  getScriptsDir: (): Promise<string> =>
    ipcRenderer.invoke('pythonEnv:getScriptsDir'),

  // Get the current environment type
  getEnvironmentType: (): Promise<PythonExecEnvironmentType> =>
    ipcRenderer.invoke('pythonEnv:getEnvironmentType'),

  // Clear environment caches (forces fresh validation on next check)
  clearCache: (): Promise<{ success: boolean }> =>
    ipcRenderer.invoke('pythonEnv:clearCache'),

  // Get count of active Python processes
  getActiveProcessCount: (): Promise<number> =>
    ipcRenderer.invoke('pythonEnv:getActiveProcessCount'),

  // Abort all running Python processes
  abortAll: (): Promise<{ success: boolean }> =>
    ipcRenderer.invoke('pythonEnv:abortAll'),

  // Subscribe to progress events during script execution
  onProgress: (callback: (data: { scriptName: string; progress: number; message: string }) => void): (() => void) => {
    const handler = (_event: unknown, data: { scriptName: string; progress: number; message: string }) => {
      callback(data)
    }
    ipcRenderer.on('pythonEnv:progress', handler)
    return () => {
      ipcRenderer.removeListener('pythonEnv:progress', handler)
    }
  }
}

// ============================================================================
// Model Manager API (PyAnnote model downloads and bundling)
// ============================================================================

export interface ModelInfo {
  id: string
  name: string
  type: 'whisper' | 'pyannote' | 'speechbrain'
  size: number
  required: boolean
  description: string
  cachePath: string
}

export interface ModelStatus {
  id: string
  available: boolean
  localPath: string | null
  downloading: boolean
  progress: number
  error: string | null
}

export interface DownloadProgress {
  modelId: string
  progress: number
  bytesDownloaded: number
  totalBytes: number
  speed: number
  eta: number
  phase: 'initializing' | 'downloading' | 'verifying' | 'complete' | 'error'
  message: string
}

export interface PyannoteModelsStatus {
  allAvailable: boolean
  downloading: boolean
  missingModels: string[]
  totalDownloadSize: number
  totalDownloadSizeFormatted: string
  hfTokenConfigured: boolean
  modelsLocation: 'bundled' | 'cache' | 'none'
}

export interface LicenseCheckResult {
  allAccessible: boolean
  checking: boolean
  modelsRequiringLicense: Array<{
    modelId: string
    modelName: string
    licenseUrl: string
  }>
  accessibleModels: string[]
  error: string | null
  lastCheckTimestamp: number | null
}

const modelManagerAPI = {
  // Get PyAnnote models status
  getPyannoteStatus: (): Promise<PyannoteModelsStatus> =>
    ipcRenderer.invoke('models:getPyannoteStatus'),

  // Get all model statuses
  getAllStatuses: (): Promise<ModelStatus[]> =>
    ipcRenderer.invoke('models:getAllStatuses'),

  // Get single model status
  getStatus: (modelId: string): Promise<ModelStatus> =>
    ipcRenderer.invoke('models:getStatus', modelId),

  // Download PyAnnote models
  downloadPyannote: (hfToken?: string): Promise<{ success: boolean; error?: string }> =>
    ipcRenderer.invoke('models:downloadPyannote', hfToken),

  // Check license access for PyAnnote models
  checkLicenseAccess: (hfToken?: string): Promise<LicenseCheckResult> =>
    ipcRenderer.invoke('models:checkLicenseAccess', hfToken),

  // Cancel ongoing download
  cancelDownload: (): Promise<{ success: boolean; error?: string }> =>
    ipcRenderer.invoke('models:cancelDownload'),

  // Get first run download info
  getFirstRunInfo: (): Promise<{
    needsDownload: boolean
    totalSize: number
    models: ModelInfo[]
    message: string
  }> => ipcRenderer.invoke('models:getFirstRunInfo'),

  // Get cache size
  getCacheSize: (): Promise<{ size: number; formatted: string }> =>
    ipcRenderer.invoke('models:getCacheSize'),

  // Clear model cache
  clearCache: (modelId?: string): Promise<{ success: boolean; error?: string }> =>
    ipcRenderer.invoke('models:clearCache', modelId),

  // Scan for existing models in HuggingFace cache
  scanExisting: (): Promise<{
    foundModels: string[]
    missingModels: string[]
    cacheLocation: string
    canUseExisting: boolean
  }> => ipcRenderer.invoke('models:scanExisting'),

  // Generate download script
  generateScript: (hfToken: string, platform: 'bash' | 'bat'): Promise<{ success: boolean; script?: string; error?: string }> =>
    ipcRenderer.invoke('models:generateScript', hfToken, platform),

  // Get manual download commands
  getManualCommands: (hfToken: string): Promise<{ success: boolean; commands?: Array<{ model: string; command: string; description: string }>; error?: string }> =>
    ipcRenderer.invoke('models:getManualCommands', hfToken),

  // Get manual Python commands
  getPythonCommands: (hfToken: string): Promise<{ success: boolean; commands?: Array<{ model: string; command: string; description: string }>; error?: string }> =>
    ipcRenderer.invoke('models:getPythonCommands', hfToken),

  // Subscribe to download progress events
  onDownloadProgress: (callback: (progress: DownloadProgress) => void): (() => void) => {
    const handler = (_event: unknown, progress: DownloadProgress) => {
      callback(progress)
    }
    ipcRenderer.on('models:downloadProgress', handler)
    return () => {
      ipcRenderer.removeListener('models:downloadProgress', handler)
    }
  },

  // Subscribe to download complete events
  onDownloadComplete: (callback: (data: { modelId: string }) => void): (() => void) => {
    const handler = (_event: unknown, data: { modelId: string }) => {
      callback(data)
    }
    ipcRenderer.on('models:downloadComplete', handler)
    return () => {
      ipcRenderer.removeListener('models:downloadComplete', handler)
    }
  },

  // Subscribe to download error events
  onDownloadError: (callback: (data: { modelId: string; error: string }) => void): (() => void) => {
    const handler = (_event: unknown, data: { modelId: string; error: string }) => {
      callback(data)
    }
    ipcRenderer.on('models:downloadError', handler)
    return () => {
      ipcRenderer.removeListener('models:downloadError', handler)
    }
  },

  // Subscribe to license required events
  onLicenseRequired: (callback: (data: { modelId: string; licenseUrl: string }) => void): (() => void) => {
    const handler = (_event: unknown, data: { modelId: string; licenseUrl: string }) => {
      callback(data)
    }
    ipcRenderer.on('models:licenseRequired', handler)
    return () => {
      ipcRenderer.removeListener('models:licenseRequired', handler)
    }
  }
}

// ============================================================================
// Expose APIs to Renderer
// ============================================================================

// ============================================================================
// Shell API
// ============================================================================

const shellAPI = {
  openExternal: (url: string): Promise<void> =>
    ipcRenderer.invoke('shell:openExternal', url),
  openPath: (path: string): Promise<string> =>
    ipcRenderer.invoke('shell:openPath', path),
  getFileStats: (filePath: string): Promise<{ size: number; mtime: string; ctime: string }> =>
    ipcRenderer.invoke('shell:getFileStats', filePath),
  selectDirectory: (defaultPath?: string): Promise<string | null> =>
    ipcRenderer.invoke('shell:selectDirectory', defaultPath)
}

// ============================================================================
// LLM Post-Processing API (LM Studio-based speaker consistency)
// ============================================================================

export interface LMStudioConfig {
  baseUrl: string
  modelId?: string
  maxTokens: number
  temperature: number
  timeout: number
}

export interface ConfidenceThresholds {
  lowConfidenceThreshold: number
  highConfidenceThreshold: number
  minOverlapDuration: number
}

export interface SpeakerIdentityMapping {
  sessionSpeakerId: string
  persistentSpeakerId?: string
  userLabel?: string
  speakingCharacteristics?: string[]
  firstSeen: number
  lastSeen: number
  totalDuration: number
  averageConfidence: number
}

export interface OverlapResolution {
  overlappingSegmentIndices: number[]
  overlapTimeRange: { start: number; end: number }
  recommendedPrimarySpeaker: string
  reasoning: string
  resolutionConfidence: number
  applied: boolean
}

export interface LowConfidenceResolution {
  segmentIndex: number
  originalSpeakerId: string
  originalConfidence: number
  suggestedSpeakerId: string | null
  reasoning: string
  applied: boolean
}

export interface SpeakerDisplayOrder {
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

export interface SpeakerAwareSummaryItem {
  type: 'summary' | 'action_item' | 'decision' | 'question' | 'key_point'
  content: string
  speakers: string[]
  timeRange?: { start: number; end: number }
  priority?: 'high' | 'medium' | 'low'
}

export interface GuardrailViolation {
  type: 'speaker_invention' | 'confidence_override' | 'identity_assumption' | 'embedding_attempt'
  attemptedAction: string
  blockedReason: string
  timestamp: number
}

export interface LLMPostProcessingResult {
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

export interface DiarizationOutputForLLM {
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

export interface LLMProcessingOptions {
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

const llmPostProcessingAPI = {
  // Check if LM Studio is available
  checkAvailability: (): Promise<{
    available: boolean
    error?: string
    modelInfo?: string
  }> => ipcRenderer.invoke('llmPostProcessing:checkAvailability'),

  // Process diarization output with LLM post-processing
  processOutput: (
    output: DiarizationOutputForLLM,
    options?: LLMProcessingOptions
  ): Promise<LLMPostProcessingResult> =>
    ipcRenderer.invoke('llmPostProcessing:processOutput', output, options),

  // Get current LM Studio and threshold configuration
  getConfig: (): Promise<{
    lmStudio: LMStudioConfig
    thresholds: ConfidenceThresholds
  }> => ipcRenderer.invoke('llmPostProcessing:getConfig'),

  // Update LM Studio configuration
  updateConfig: (
    config: Partial<LMStudioConfig>
  ): Promise<{ success: boolean; error?: string }> =>
    ipcRenderer.invoke('llmPostProcessing:updateConfig', config),

  // Update confidence thresholds
  updateThresholds: (
    thresholds: Partial<ConfidenceThresholds>
  ): Promise<{ success: boolean; error?: string }> =>
    ipcRenderer.invoke('llmPostProcessing:updateThresholds', thresholds),

  // Reset LLM service state
  reset: (): Promise<{ success: boolean; error?: string }> =>
    ipcRenderer.invoke('llmPostProcessing:reset')
}

// ============================================================================
// Meeting Summary API
// ============================================================================

export interface SummaryGenerationConfig {
  maxTokens?: number
  temperature?: number
  includeActionItems?: boolean
  includeKeyPoints?: boolean
  includeDecisions?: boolean
  maxTranscriptSegments?: number
}

export interface StructuredSummary {
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

export interface SummaryGenerationResult {
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

const meetingSummaryAPI = {
  // Check if LLM service is available for summary generation
  checkAvailability: (): Promise<{
    available: boolean
    error?: string
    modelInfo?: string
  }> => ipcRenderer.invoke('meetingSummary:checkAvailability'),

  // Generate a summary for a meeting
  generateSummary: (
    meetingId: string,
    config?: SummaryGenerationConfig
  ): Promise<SummaryGenerationResult> =>
    ipcRenderer.invoke('meetingSummary:generateSummary', meetingId, config),

  // Delete existing AI-generated summary notes for a meeting
  deleteExistingSummary: (meetingId: string): Promise<{
    success: boolean
    deleted: number
    error?: string
  }> => ipcRenderer.invoke('meetingSummary:deleteExistingSummary', meetingId),

  // Get current summary generation configuration
  getConfig: (): Promise<SummaryGenerationConfig> =>
    ipcRenderer.invoke('meetingSummary:getConfig'),

  // Update summary generation configuration
  updateConfig: (
    config: Partial<SummaryGenerationConfig>
  ): Promise<{ success: boolean; error?: string }> =>
    ipcRenderer.invoke('meetingSummary:updateConfig', config)
}

// ============================================================================
// Action Items Extraction API
// ============================================================================

export interface ActionItemsExtractionConfig {
  maxTokens?: number
  temperature?: number
  createTasks?: boolean
  createNotes?: boolean
  maxTranscriptSegments?: number
}

export interface ExtractedActionItem {
  task: string
  assignee: string | null
  priority: 'low' | 'medium' | 'high' | 'urgent'
  dueDate: string | null
  context: string | null
  speaker: string | null
}

export interface ActionItemsExtractionResult {
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

const actionItemsAPI = {
  // Check if LLM service is available for action items extraction
  checkAvailability: (): Promise<{
    available: boolean
    error?: string
    modelInfo?: string
  }> => ipcRenderer.invoke('actionItems:checkAvailability'),

  // Extract action items from a meeting transcript
  extract: (
    meetingId: string,
    config?: ActionItemsExtractionConfig
  ): Promise<ActionItemsExtractionResult> =>
    ipcRenderer.invoke('actionItems:extract', meetingId, config),

  // Delete existing AI-generated action item notes for a meeting
  deleteExisting: (meetingId: string): Promise<{
    success: boolean
    deletedNotes: number
    deletedTasks: number
    error?: string
  }> => ipcRenderer.invoke('actionItems:deleteExisting', meetingId),

  // Get current action items extraction configuration
  getConfig: (): Promise<ActionItemsExtractionConfig> =>
    ipcRenderer.invoke('actionItems:getConfig'),

  // Update action items extraction configuration
  updateConfig: (
    config: Partial<ActionItemsExtractionConfig>
  ): Promise<{ success: boolean; error?: string }> =>
    ipcRenderer.invoke('actionItems:updateConfig', config)
}

// ============================================================================
// Decisions and Topics Extraction API
// ============================================================================

export type SentimentType = 'positive' | 'negative' | 'neutral' | 'mixed'

export interface DecisionsAndTopicsConfig {
  maxTokens?: number
  temperature?: number
  includeSentiment?: boolean
  includeDuration?: boolean
  maxTranscriptSegments?: number
}

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

export interface ExtractedKeyPoint {
  content: string
  category?: 'insight' | 'concern' | 'agreement' | 'disagreement' | 'question' | 'observation'
  speakers?: string[]
  sentiment: SentimentType
  importance: number
  sourceTranscriptIds?: string[]
}

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

export interface ExtractionProcessResult {
  success: boolean
  error?: string
  extraction?: DecisionsAndTopicsExtractionResult
  createdNotes?: MeetingNote[]
  metadata: {
    processingTimeMs: number
    transcriptSegmentCount: number
    transcriptCharacterCount: number
    llmResponseTimeMs?: number
    meetingDurationMs?: number
  }
}

const decisionsAndTopicsAPI = {
  // Check if LLM service is available for decisions and topics extraction
  checkAvailability: (): Promise<{
    available: boolean
    error?: string
    modelInfo?: string
  }> => ipcRenderer.invoke('decisionsAndTopics:checkAvailability'),

  // Extract decisions, key points, and topics from a meeting transcript
  extract: (
    meetingId: string,
    config?: DecisionsAndTopicsConfig
  ): Promise<ExtractionProcessResult> =>
    ipcRenderer.invoke('decisionsAndTopics:extract', meetingId, config),

  // Delete existing AI-generated notes from decisions and topics extraction
  deleteExisting: (meetingId: string): Promise<{
    success: boolean
    deleted: number
    error?: string
  }> => ipcRenderer.invoke('decisionsAndTopics:deleteExisting', meetingId),

  // Get current decisions and topics extraction configuration
  getConfig: (): Promise<DecisionsAndTopicsConfig> =>
    ipcRenderer.invoke('decisionsAndTopics:getConfig'),

  // Update decisions and topics extraction configuration
  updateConfig: (
    config: Partial<DecisionsAndTopicsConfig>
  ): Promise<{ success: boolean; error?: string }> =>
    ipcRenderer.invoke('decisionsAndTopics:updateConfig', config),

  // Get only decisions for a meeting
  getDecisions: (meetingId: string): Promise<{
    success: boolean
    decisions: ExtractedDecision[]
    error?: string
  }> => ipcRenderer.invoke('decisionsAndTopics:getDecisions', meetingId),

  // Get topics with duration and sentiment for a meeting
  getTopicsWithDetails: (meetingId: string): Promise<{
    success: boolean
    topics: ExtractedTopic[]
    error?: string
  }> => ipcRenderer.invoke('decisionsAndTopics:getTopicsWithDetails', meetingId)
}

// ============================================================================
// Export API
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

// ============================================================================
// Update Types
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

const exportAPI = {
  // Export meeting to PDF format
  toPdf: (
    meetingId: string,
    outputPath?: string,
    config?: ExportConfig
  ): Promise<ExportResult> =>
    ipcRenderer.invoke('export:pdf', meetingId, outputPath, config),

  // Export meeting to Markdown format
  toMarkdown: (
    meetingId: string,
    outputPath?: string,
    config?: ExportConfig
  ): Promise<ExportResult> =>
    ipcRenderer.invoke('export:markdown', meetingId, outputPath, config),

  // Generic export (supports both formats)
  meeting: (
    meetingId: string,
    format: ExportFormat,
    outputPath?: string,
    config?: ExportConfig
  ): Promise<ExportResult> =>
    ipcRenderer.invoke('export:meeting', meetingId, format, outputPath, config),

  // Get current export configuration
  getConfig: (): Promise<ExportConfig> =>
    ipcRenderer.invoke('export:getConfig'),

  // Update export configuration
  updateConfig: (
    config: Partial<ExportConfig>
  ): Promise<{ success: boolean; error?: string }> =>
    ipcRenderer.invoke('export:updateConfig', config)
}

// ============================================================================
// Update API
// ============================================================================

// ============================================================================
// LLM Provider Types
// ============================================================================

export type LLMProviderType =
  | 'lm-studio'
  | 'ollama'
  | 'claude'
  | 'cursor'
  | 'openai'
  | 'anthropic'
  | 'custom'

export interface ProviderAvailability {
  provider: LLMProviderType
  available: boolean
  responseTimeMs?: number
  error?: string
  lastChecked: number
  loadedModel?: string
}

export interface ProviderDetectionResult {
  providers: ProviderAvailability[]
  recommendedPrimary?: LLMProviderType
  timestamp: number
  detectionTimeMs: number
  error?: string
}

export interface ProviderDetectionOptions {
  providers?: LLMProviderType[]
  timeoutMs?: number
  parallel?: boolean
}

export interface LLMProviderManagerConfig {
  defaultProvider: LLMProviderType
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

// ============================================================================
// LLM Health Check Types
// ============================================================================

export interface ProviderHealthStatus {
  provider: LLMProviderType
  available: boolean
  lastChecked: number
  responseTimeMs?: number
  error?: string
  consecutiveFailures: number
  lastSuccessTime?: number
  troubleshootingGuidance?: string
}

export interface HealthCheckEvent {
  id: string
  timestamp: number
  provider: LLMProviderType
  type: 'check' | 'failure' | 'recovery' | 'fallback'
  available: boolean
  responseTimeMs?: number
  error?: string
  details?: Record<string, unknown>
}

export interface HealthCheckConfig {
  intervalMs: number
  maxHistorySize: number
  timeoutMs: number
  autoStart: boolean
  providers?: LLMProviderType[]
}

export interface HealthSummary {
  timestamp: number
  totalProviders: number
  availableProviders: number
  unavailableProviders: number
  providers: ProviderHealthStatus[]
  recentEvents: HealthCheckEvent[]
  hasWarnings: boolean
  warnings: string[]
}

// ============================================================================
// LLM Provider API
// ============================================================================

const llmProviderAPI = {
  // Detect available LLM providers
  detectProviders: (options?: ProviderDetectionOptions): Promise<ProviderDetectionResult> =>
    ipcRenderer.invoke('llmProvider:detectProviders', options),

  // Get registered provider types
  getRegisteredProviders: (): Promise<LLMProviderType[]> =>
    ipcRenderer.invoke('llmProvider:getRegisteredProviders'),

  // Get enabled provider types
  getEnabledProviders: (): Promise<LLMProviderType[]> =>
    ipcRenderer.invoke('llmProvider:getEnabledProviders'),

  // Set the default provider
  setDefaultProvider: (providerType: LLMProviderType): Promise<{ success: boolean; error?: string }> =>
    ipcRenderer.invoke('llmProvider:setDefaultProvider', providerType),

  // Check health of a specific provider
  checkHealth: (forceRefresh?: boolean): Promise<{
    success: boolean
    data?: { healthy: boolean; responseTimeMs: number; serverVersion?: string; loadedModel?: string }
    error?: string
    provider: string
    responseTimeMs?: number
  }> =>
    ipcRenderer.invoke('llmProvider:checkHealth', forceRefresh),

  // Check if any provider is available
  isAvailable: (): Promise<boolean> =>
    ipcRenderer.invoke('llmProvider:isAvailable'),

  // Get current manager configuration
  getConfig: (): Promise<LLMProviderManagerConfig | null> =>
    ipcRenderer.invoke('llmProvider:getConfig'),

  // Update manager configuration
  updateConfig: (config: { defaultProvider?: LLMProviderType }): Promise<{ success: boolean; error?: string }> =>
    ipcRenderer.invoke('llmProvider:updateConfig', config),

  // Register a provider by type
  registerProviderByType: (
    providerType: LLMProviderType,
    config?: Record<string, unknown>,
    priority?: 'primary' | 'secondary' | 'tertiary' | 'fallback',
    isDefault?: boolean
  ): Promise<{ success: boolean; error?: string }> =>
    ipcRenderer.invoke('llmProvider:registerProviderByType', providerType, config, priority, isDefault)
}

// ============================================================================
// LLM Health Check API
// ============================================================================

const llmHealthCheckAPI = {
  // Get current health summary
  getSummary: (): Promise<HealthSummary> =>
    ipcRenderer.invoke('llmHealthCheck:getSummary'),

  // Run a health check immediately
  runNow: (): Promise<HealthSummary> =>
    ipcRenderer.invoke('llmHealthCheck:runNow'),

  // Get status for a specific provider
  getProviderStatus: (provider: LLMProviderType): Promise<ProviderHealthStatus | null> =>
    ipcRenderer.invoke('llmHealthCheck:getProviderStatus', provider),

  // Get event history
  getEventHistory: (limit?: number): Promise<HealthCheckEvent[]> =>
    ipcRenderer.invoke('llmHealthCheck:getEventHistory', limit),

  // Get troubleshooting guidance for a provider
  getTroubleshootingGuidance: (provider: LLMProviderType, error?: string): Promise<string> =>
    ipcRenderer.invoke('llmHealthCheck:getTroubleshootingGuidance', provider, error),

  // Start periodic health checks
  start: (config?: Partial<HealthCheckConfig>): Promise<{ success: boolean; error?: string }> =>
    ipcRenderer.invoke('llmHealthCheck:start', config),

  // Stop periodic health checks
  stop: (): Promise<{ success: boolean; error?: string }> =>
    ipcRenderer.invoke('llmHealthCheck:stop'),

  // Get current config
  getConfig: (): Promise<HealthCheckConfig | null> =>
    ipcRenderer.invoke('llmHealthCheck:getConfig'),

  // Update config
  updateConfig: (config: Partial<HealthCheckConfig>): Promise<{ success: boolean; error?: string }> =>
    ipcRenderer.invoke('llmHealthCheck:updateConfig', config),

  // Check if health checks are running
  isRunning: (): Promise<boolean> =>
    ipcRenderer.invoke('llmHealthCheck:isRunning'),

  // Clear event history
  clearHistory: (): Promise<{ success: boolean; error?: string }> =>
    ipcRenderer.invoke('llmHealthCheck:clearHistory'),

  // Subscribe to status change events
  onStatusChange: (callback: (summary: HealthSummary) => void): (() => void) => {
    const handler = (_event: unknown, summary: HealthSummary) => {
      callback(summary)
    }
    ipcRenderer.on('llmHealthCheck:statusChange', handler)
    return () => {
      ipcRenderer.removeListener('llmHealthCheck:statusChange', handler)
    }
  }
}

// ============================================================================
// Live Notes API (Real-time meeting notes during recording)
// ============================================================================

export interface LiveNoteItem {
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

export interface LiveNoteGenerationConfig {
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

export interface TranscriptSegmentForNotes {
  id: string
  content: string
  speaker?: string | null
  start_time_ms: number
  end_time_ms: number
}

const liveNotesAPI = {
  // Check if LLM is available for live notes generation
  checkAvailability: (): Promise<{
    available: boolean
    error?: string
    modelInfo?: string
  }> => ipcRenderer.invoke('liveNotes:checkAvailability'),

  // Start a live notes generation session
  startSession: (
    meetingId: string,
    config?: LiveNoteGenerationConfig
  ): Promise<{ success: boolean; error?: string; llmProvider?: string }> =>
    ipcRenderer.invoke('liveNotes:startSession', meetingId, config),

  // Stop the live notes generation session
  stopSession: (): Promise<{
    success: boolean
    totalNotes: number
    batchesProcessed: number
  }> => ipcRenderer.invoke('liveNotes:stopSession'),

  // Pause notes generation
  pauseSession: (): Promise<{ success: boolean }> =>
    ipcRenderer.invoke('liveNotes:pauseSession'),

  // Resume notes generation
  resumeSession: (): Promise<{ success: boolean }> =>
    ipcRenderer.invoke('liveNotes:resumeSession'),

  // Add transcript segments for processing
  addSegments: (segments: TranscriptSegmentForNotes[]): Promise<{ success: boolean }> =>
    ipcRenderer.invoke('liveNotes:addSegments', segments),

  // Get current session state
  getSessionState: (): Promise<{
    isActive: boolean
    meetingId: string | null
    pendingSegments: number
    processedSegments: number
    batchesProcessed: number
    totalNotesGenerated: number
  }> => ipcRenderer.invoke('liveNotes:getSessionState'),

  // Get current configuration
  getConfig: (): Promise<LiveNoteGenerationConfig> =>
    ipcRenderer.invoke('liveNotes:getConfig'),

  // Update configuration
  updateConfig: (
    config: Partial<LiveNoteGenerationConfig>
  ): Promise<{ success: boolean }> =>
    ipcRenderer.invoke('liveNotes:updateConfig', config),

  // Force process pending segments immediately
  forceBatchProcess: (): Promise<{ success: boolean }> =>
    ipcRenderer.invoke('liveNotes:forceBatchProcess'),

  // Subscribe to new notes events
  onNotes: (callback: (notes: LiveNoteItem[]) => void): (() => void) => {
    const handler = (_event: unknown, notes: LiveNoteItem[]) => {
      callback(notes)
    }
    ipcRenderer.on('liveNotes:notes', handler)
    return () => {
      ipcRenderer.removeListener('liveNotes:notes', handler)
    }
  },

  // Subscribe to status updates
  onStatus: (callback: (status: { status: string; timestamp: number }) => void): (() => void) => {
    const handler = (_event: unknown, status: { status: string; timestamp: number }) => {
      callback(status)
    }
    ipcRenderer.on('liveNotes:status', handler)
    return () => {
      ipcRenderer.removeListener('liveNotes:status', handler)
    }
  },

  // Subscribe to batch state updates
  onBatchState: (callback: (state: Record<string, unknown>) => void): (() => void) => {
    const handler = (_event: unknown, state: Record<string, unknown>) => {
      callback(state)
    }
    ipcRenderer.on('liveNotes:batchState', handler)
    return () => {
      ipcRenderer.removeListener('liveNotes:batchState', handler)
    }
  },

  // Subscribe to error events
  onError: (callback: (error: {
    code: string
    message: string
    timestamp: number
    recoverable: boolean
  }) => void): (() => void) => {
    const handler = (_event: unknown, error: {
      code: string
      message: string
      timestamp: number
      recoverable: boolean
    }) => {
      callback(error)
    }
    ipcRenderer.on('liveNotes:error', handler)
    return () => {
      ipcRenderer.removeListener('liveNotes:error', handler)
    }
  },

  // Subscribe to notes persisted events (when recording stops and notes are saved to DB)
  onNotesPersisted: (callback: (data: {
    meetingId: string
    notesCount: number
    tasksCount: number
    timestamp: number
  }) => void): (() => void) => {
    const handler = (_event: unknown, data: {
      meetingId: string
      notesCount: number
      tasksCount: number
      timestamp: number
    }) => {
      callback(data)
    }
    ipcRenderer.on('liveNotes:persisted', handler)
    return () => {
      ipcRenderer.removeListener('liveNotes:persisted', handler)
    }
  },

  // Subscribe to save progress events (real-time updates while saving to DB)
  onSaveProgress: (callback: (data: {
    meetingId: string
    total: number
    saved: number
    currentType: 'notes' | 'tasks'
    completed?: boolean
    errors?: string[]
    timestamp: number
  }) => void): (() => void) => {
    const handler = (_event: unknown, data: {
      meetingId: string
      total: number
      saved: number
      currentType: 'notes' | 'tasks'
      completed?: boolean
      errors?: string[]
      timestamp: number
    }) => {
      callback(data)
    }
    ipcRenderer.on('liveNotes:saveProgress', handler)
    return () => {
      ipcRenderer.removeListener('liveNotes:saveProgress', handler)
    }
  }
}

// ============================================================================
// Live Insights Persistence API (automatic persistence of live notes to database)
// ============================================================================

const liveInsightsAPI = {
  // Check if live insights exist for a meeting
  check: (meetingId: string): Promise<{
    exists: boolean
    error?: string
  }> => ipcRenderer.invoke('liveInsights:check', meetingId),

  // Get summary of live insights for a meeting
  getSummary: (meetingId: string): Promise<{
    exists: boolean
    tasksCount: number
    notesCount: number
    generatedAt: string | null
    types: {
      actionItems: number
      decisions: number
      keyPoints: number
      topics: number
    }
    error?: string
  }> => ipcRenderer.invoke('liveInsights:getSummary', meetingId),

  // Manually save live insights (fallback if auto-save failed)
  manualSave: (meetingId: string): Promise<{
    success: boolean
    tasksCreated: number
    notesCreated: number
    message?: string
    error?: string
  }> => ipcRenderer.invoke('liveInsights:manualSave', meetingId),

  // Subscribe to live insights persistence events
  onPersisted: (callback: (data: {
    success: boolean
    tasksCreated: number
    notesCreated: number
    meetingId: string
    error?: string
  }) => void): (() => void) => {
    const handler = (_event: unknown, data: {
      success: boolean
      tasksCreated: number
      notesCreated: number
      meetingId: string
      error?: string
    }) => {
      callback(data)
    }
    ipcRenderer.on('liveInsights:persisted', handler)
    return () => {
      ipcRenderer.removeListener('liveInsights:persisted', handler)
    }
  }
}

// ============================================================================
// Transcript Correction API (AI-assisted transcription correction)
// ============================================================================

export type CorrectionStatus = 'pending' | 'accepted' | 'rejected'
export type CorrectionTrigger = 'low_confidence' | 'speaker_change' | 'manual' | 'batch'

export interface TextChange {
  original: string
  corrected: string
  changeType: 'word' | 'punctuation' | 'capitalization' | 'grammar' | 'homophone' | 'terminology'
  startIndex: number
  endIndex: number
  confidence: number
}

export interface TranscriptCorrection {
  id: string
  transcript_id: string
  meeting_id: string
  original_content: string
  corrected_content: string
  changes: string  // JSON array of TextChange[]
  trigger: CorrectionTrigger
  status: CorrectionStatus
  llm_provider: string | null
  llm_model: string | null
  confidence_score: number
  processing_time_ms: number
  created_at: string
  updated_at: string
  applied_at: string | null
}

export interface CorrectionConfig {
  lowConfidenceThreshold: number
  maxTokens: number
  temperature: number
  includeContext: boolean
  contextSegments: number
}

export interface CorrectionResult {
  success: boolean
  error?: string
  correction?: TranscriptCorrection
  changes?: TextChange[]
  metadata?: {
    processingTimeMs: number
    llmProvider: string
    llmModel?: string
    contextUsed: boolean
  }
}

export interface BatchCorrectionResult {
  success: boolean
  totalSegments: number
  corrected: number
  skipped: number
  failed: number
  corrections: TranscriptCorrection[]
  errors: string[]
}

const transcriptCorrectionAPI = {
  // Check if LLM is available for transcript correction
  checkAvailability: (): Promise<{
    available: boolean
    error?: string
    provider?: string
  }> => ipcRenderer.invoke('transcriptCorrection:checkAvailability'),

  // Generate correction for a single transcript segment
  generateCorrection: (
    transcriptId: string,
    trigger?: CorrectionTrigger
  ): Promise<CorrectionResult> =>
    ipcRenderer.invoke('transcriptCorrection:generateCorrection', transcriptId, trigger),

  // Generate batch corrections for a meeting
  generateBatchCorrections: (
    meetingId: string,
    options?: { onlyLowConfidence?: boolean; maxSegments?: number }
  ): Promise<BatchCorrectionResult> =>
    ipcRenderer.invoke('transcriptCorrection:generateBatchCorrections', meetingId, options),

  // Get correction by ID
  getById: (id: string): Promise<TranscriptCorrection | null> =>
    ipcRenderer.invoke('transcriptCorrection:getById', id),

  // Get corrections for a transcript
  getByTranscriptId: (transcriptId: string): Promise<TranscriptCorrection[]> =>
    ipcRenderer.invoke('transcriptCorrection:getByTranscriptId', transcriptId),

  // Get corrections for a meeting
  getByMeetingId: (meetingId: string): Promise<TranscriptCorrection[]> =>
    ipcRenderer.invoke('transcriptCorrection:getByMeetingId', meetingId),

  // Get pending corrections for a meeting
  getPendingByMeetingId: (meetingId: string): Promise<TranscriptCorrection[]> =>
    ipcRenderer.invoke('transcriptCorrection:getPendingByMeetingId', meetingId),

  // Accept a correction
  acceptCorrection: (correctionId: string): Promise<{
    success: boolean
    error?: string
  }> => ipcRenderer.invoke('transcriptCorrection:acceptCorrection', correctionId),

  // Reject a correction
  rejectCorrection: (correctionId: string): Promise<{
    success: boolean
    error?: string
  }> => ipcRenderer.invoke('transcriptCorrection:rejectCorrection', correctionId),

  // Delete a correction
  delete: (id: string): Promise<boolean> =>
    ipcRenderer.invoke('transcriptCorrection:delete', id),

  // Delete all corrections for a meeting
  deleteByMeetingId: (meetingId: string): Promise<number> =>
    ipcRenderer.invoke('transcriptCorrection:deleteByMeetingId', meetingId),

  // Get correction statistics for a meeting
  getStats: (meetingId: string): Promise<{
    total: number
    pending: number
    accepted: number
    rejected: number
    avgConfidence: number
  }> => ipcRenderer.invoke('transcriptCorrection:getStats', meetingId),

  // Check if a transcript should suggest correction
  shouldSuggestCorrection: (transcriptId: string): Promise<{
    suggest: boolean
    reason?: string
  }> => ipcRenderer.invoke('transcriptCorrection:shouldSuggestCorrection', transcriptId),

  // Update correction configuration
  updateConfig: (config: Partial<CorrectionConfig>): Promise<{ success: boolean }> =>
    ipcRenderer.invoke('transcriptCorrection:updateConfig', config),

  // Get current correction configuration
  getConfig: (): Promise<CorrectionConfig> =>
    ipcRenderer.invoke('transcriptCorrection:getConfig')
}

// ============================================================================
// Confidence Scoring API
// ============================================================================

export type ConfidenceLevel = 'high' | 'medium' | 'low'
export type ConfidenceAlertType = 'low_confidence' | 'degrading_quality' | 'audio_issue'

export interface ConfidenceThresholds {
  high: number
  medium: number
  low: number
}

export interface ConfidenceMetrics {
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

export interface ConfidenceTrend {
  id: string
  meeting_id: string
  timestamp_ms: number
  window_confidence: number
  segment_count: number
  is_alert_triggered: boolean
  alert_type: ConfidenceAlertType | null
  created_at: string
}

export interface ConfidenceAdjustment {
  id: string
  transcript_id: string
  meeting_id: string
  original_confidence: number
  adjusted_confidence: number
  reason: string | null
  created_at: string
}

export interface SegmentConfidenceInfo {
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

export interface MeetingConfidenceSummary {
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

export interface ConfidenceAlert {
  type: ConfidenceAlertType
  message: string
  severity: 'warning' | 'error'
  timestampMs: number
  windowConfidence: number
  suggestedAction: string
}

export interface ConfidenceScoringConfig {
  thresholds: ConfidenceThresholds
  alertThreshold: number
  alertWindowMs: number
  alertConsecutiveCount: number
  autoCorrectThreshold: number
  reviewThreshold: number
  trendSampleIntervalMs: number
}

export interface LiveSegmentResult {
  info: SegmentConfidenceInfo
  alert: ConfidenceAlert | null
  shouldAutoCorrect: boolean
}

const confidenceScoringAPI = {
  // Get confidence level for a score
  getConfidenceLevel: (confidence: number): Promise<ConfidenceLevel> =>
    ipcRenderer.invoke('confidenceScoring:getConfidenceLevel', confidence),

  // Get segment confidence info for a transcript
  getSegmentConfidenceInfo: (transcriptId: string): Promise<SegmentConfidenceInfo | null> =>
    ipcRenderer.invoke('confidenceScoring:getSegmentConfidenceInfo', transcriptId),

  // Calculate and get meeting metrics
  calculateMeetingMetrics: (meetingId: string): Promise<ConfidenceMetrics | null> =>
    ipcRenderer.invoke('confidenceScoring:calculateMeetingMetrics', meetingId),

  // Get existing meeting metrics
  getMetrics: (meetingId: string): Promise<ConfidenceMetrics | null> =>
    ipcRenderer.invoke('confidenceScoring:getMetrics', meetingId),

  // Get meeting confidence summary for UI
  getMeetingConfidenceSummary: (meetingId: string): Promise<MeetingConfidenceSummary | null> =>
    ipcRenderer.invoke('confidenceScoring:getMeetingConfidenceSummary', meetingId),

  // Record trend data point (for live recording)
  recordTrendDataPoint: (
    meetingId: string,
    timestampMs: number,
    windowConfidence: number,
    segmentCount: number
  ): Promise<ConfidenceAlert | null> =>
    ipcRenderer.invoke('confidenceScoring:recordTrendDataPoint', meetingId, timestampMs, windowConfidence, segmentCount),

  // Get trends for a meeting
  getTrends: (meetingId: string): Promise<ConfidenceTrend[]> =>
    ipcRenderer.invoke('confidenceScoring:getTrends', meetingId),

  // Get alerts for a meeting
  getAlerts: (meetingId: string): Promise<ConfidenceTrend[]> =>
    ipcRenderer.invoke('confidenceScoring:getAlerts', meetingId),

  // Get low confidence transcripts
  getLowConfidenceTranscripts: (meetingId: string, threshold?: number): Promise<Transcript[]> =>
    ipcRenderer.invoke('confidenceScoring:getLowConfidenceTranscripts', meetingId, threshold),

  // Get transcripts needing review
  getTranscriptsNeedingReview: (meetingId: string): Promise<Transcript[]> =>
    ipcRenderer.invoke('confidenceScoring:getTranscriptsNeedingReview', meetingId),

  // Trigger batch auto-correction for low-confidence segments
  triggerBatchAutoCorrection: (meetingId: string): Promise<{
    triggered: number
    skipped: number
    errors: string[]
  }> => ipcRenderer.invoke('confidenceScoring:triggerBatchAutoCorrection', meetingId),

  // Adjust confidence manually
  adjustConfidence: (
    transcriptId: string,
    newConfidence: number,
    reason?: string
  ): Promise<ConfidenceAdjustment | null> =>
    ipcRenderer.invoke('confidenceScoring:adjustConfidence', transcriptId, newConfidence, reason),

  // Get adjustment history for a transcript
  getAdjustmentHistory: (transcriptId: string): Promise<ConfidenceAdjustment[]> =>
    ipcRenderer.invoke('confidenceScoring:getAdjustmentHistory', transcriptId),

  // Get all adjustments for a meeting
  getMeetingAdjustments: (meetingId: string): Promise<ConfidenceAdjustment[]> =>
    ipcRenderer.invoke('confidenceScoring:getMeetingAdjustments', meetingId),

  // Process live segment (during recording)
  processLiveSegment: (transcriptId: string): Promise<LiveSegmentResult | null> =>
    ipcRenderer.invoke('confidenceScoring:processLiveSegment', transcriptId),

  // Reset alert state for a meeting
  resetAlertState: (meetingId: string): Promise<{ success: boolean }> =>
    ipcRenderer.invoke('confidenceScoring:resetAlertState', meetingId),

  // Update configuration
  updateConfig: (config: Partial<ConfidenceScoringConfig>): Promise<{ success: boolean }> =>
    ipcRenderer.invoke('confidenceScoring:updateConfig', config),

  // Get current configuration
  getConfig: (): Promise<ConfidenceScoringConfig> =>
    ipcRenderer.invoke('confidenceScoring:getConfig'),

  // Get confidence thresholds
  getThresholds: (): Promise<ConfidenceThresholds> =>
    ipcRenderer.invoke('confidenceScoring:getThresholds'),

  // Delete all confidence data for a meeting
  deleteByMeetingId: (meetingId: string): Promise<{ success: boolean }> =>
    ipcRenderer.invoke('confidenceScoring:deleteByMeetingId', meetingId)
}

// ============================================================================
// Speaker Name Detection API
// ============================================================================

export type SpeakerNameDetectionType =
  | 'self_introduction'
  | 'name_reference'
  | 'temporal_correlation'
  | 'manual_correction'

export type SpeakerNameDetectionEventType =
  | 'detection'
  | 'confidence_update'
  | 'acceptance'
  | 'rejection'
  | 'manual_override'
  | 'disambiguation'

export type NameConfidenceLevel = 'high' | 'medium' | 'low'

export interface SpeakerNameCandidate {
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

export interface SpeakerNameDetectionEvent {
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

export interface NameDetectionResult {
  detected: boolean
  candidateName: string | null
  confidence: number
  detectionType: SpeakerNameDetectionType
  context: string
  patterns: string[]
}

export interface SpeakerNameDetectionConfig {
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

export interface SpeakerNameSuggestion {
  speakerId: string
  currentName: string
  suggestedName: string
  confidence: number
  confidenceLevel: NameConfidenceLevel
  detectionType: SpeakerNameDetectionType
  candidateId: string
  detectionContext: string | null
}

export interface MeetingSpeakerNameSummary {
  meetingId: string
  speakers: Array<{
    speakerId: string
    currentName: string
    topCandidate: SpeakerNameCandidate | null
    allCandidates: SpeakerNameCandidate[]
    hasAcceptedName: boolean
  }>
}

const speakerNameDetectionAPI = {
  // Analyze transcript for speaker name detection
  analyzeTranscript: (
    meetingId: string,
    speakerId: string,
    content: string,
    timestampMs: number,
    transcriptId?: string
  ): Promise<NameDetectionResult | null> =>
    ipcRenderer.invoke('speakerNameDetection:analyzeTranscript', meetingId, speakerId, content, timestampMs, transcriptId),

  // Analyze name reference with speaker change
  analyzeNameReference: (
    meetingId: string,
    mentionedName: string,
    mentionerSpeakerId: string,
    nextSpeakerId: string,
    mentionTimestampMs: number,
    speakerChangeTimestampMs: number
  ): Promise<NameDetectionResult | null> =>
    ipcRenderer.invoke('speakerNameDetection:analyzeNameReference', meetingId, mentionedName, mentionerSpeakerId, nextSpeakerId, mentionTimestampMs, speakerChangeTimestampMs),

  // Check temporal correlation on speaker change
  checkTemporalCorrelation: (
    meetingId: string,
    newSpeakerId: string,
    speakerChangeTimestampMs: number
  ): Promise<NameDetectionResult | null> =>
    ipcRenderer.invoke('speakerNameDetection:checkTemporalCorrelation', meetingId, newSpeakerId, speakerChangeTimestampMs),

  // Get candidates for a meeting (optionally filtered by speaker)
  getCandidates: (meetingId: string, speakerId?: string): Promise<SpeakerNameCandidate[]> =>
    ipcRenderer.invoke('speakerNameDetection:getCandidates', meetingId, speakerId),

  // Get top candidate for a speaker
  getTopCandidate: (meetingId: string, speakerId: string): Promise<SpeakerNameCandidate | null> =>
    ipcRenderer.invoke('speakerNameDetection:getTopCandidate', meetingId, speakerId),

  // Accept a candidate
  acceptCandidate: (candidateId: string): Promise<boolean> =>
    ipcRenderer.invoke('speakerNameDetection:acceptCandidate', candidateId),

  // Reject a candidate
  rejectCandidate: (candidateId: string): Promise<boolean> =>
    ipcRenderer.invoke('speakerNameDetection:rejectCandidate', candidateId),

  // Manually set a speaker name
  manuallySetName: (meetingId: string, speakerId: string, name: string): Promise<SpeakerNameCandidate | null> =>
    ipcRenderer.invoke('speakerNameDetection:manuallySetName', meetingId, speakerId, name),

  // Get suggestions for a meeting
  getSuggestions: (meetingId: string): Promise<SpeakerNameSuggestion[]> =>
    ipcRenderer.invoke('speakerNameDetection:getSuggestions', meetingId),

  // Get meeting summary
  getMeetingSummary: (meetingId: string): Promise<MeetingSpeakerNameSummary> =>
    ipcRenderer.invoke('speakerNameDetection:getMeetingSummary', meetingId),

  // Get detection events
  getDetectionEvents: (meetingId: string, limit?: number): Promise<SpeakerNameDetectionEvent[]> =>
    ipcRenderer.invoke('speakerNameDetection:getDetectionEvents', meetingId, limit),

  // Disambiguate candidates for a speaker
  disambiguate: (meetingId: string, speakerId: string): Promise<SpeakerNameCandidate | null> =>
    ipcRenderer.invoke('speakerNameDetection:disambiguate', meetingId, speakerId),

  // Get configuration
  getConfig: (): Promise<SpeakerNameDetectionConfig> =>
    ipcRenderer.invoke('speakerNameDetection:getConfig'),

  // Update configuration
  updateConfig: (config: Partial<SpeakerNameDetectionConfig>): Promise<SpeakerNameDetectionConfig> =>
    ipcRenderer.invoke('speakerNameDetection:updateConfig', config)
}

// ============================================================================
// Dialog API (Save File)
// ============================================================================

const dialogAPI = {
  // Save file with dialog
  saveFile: (filename: string, content: string): Promise<{ success: boolean; path?: string; error?: string }> =>
    ipcRenderer.invoke('dialog:saveFile', filename, content)
}

// ============================================================================
// Data Migration API
// ============================================================================

export interface MigrationSummary {
  meetingsCount: number
  recordingsCount: number
  totalAudioFilesSize: number
  hasSettings: boolean
  databaseSizeBytes: number
}

export interface LegacyPathInfo {
  type: 'appData' | 'documents' | 'recordings'
  legacyPath: string
  newPath: string
  exists: boolean
  sizeBytes: number
  fileCount?: number
}

export interface MigrationCheckResult {
  needsMigration: boolean
  legacyPaths: LegacyPathInfo[]
  totalSizeBytes: number
  migrationComplete: boolean
  summary: MigrationSummary
}

export interface MigrationProgress {
  phase: 'checking' | 'backing_up' | 'copying' | 'updating_paths' | 'validating' | 'cleanup' | 'complete' | 'error' | 'rolling_back'
  currentItem?: string
  itemsCopied: number
  totalItems: number
  bytesCopied: number
  totalBytes: number
  errorMessage?: string
  percentComplete: number
}

export interface ValidationResult {
  isValid: boolean
  meetingsAccessible: number
  meetingsTotal: number
  recordingsAccessible: number
  recordingsTotal: number
  transcriptsCount: number
  fileIntegrityPassed: boolean
  errors: string[]
}

export interface MigrationResult {
  success: boolean
  itemsMigrated: number
  bytesMigrated: number
  pathsUpdated: number
  errors: string[]
  warnings: string[]
  validation?: ValidationResult
}

export interface RollbackResult {
  success: boolean
  filesRestored: number
  errors: string[]
}

export interface CleanupResult {
  success: boolean
  bytesFreed: number
  filesDeleted: number
  errors: string[]
}

export interface MigrationStatus {
  status: 'not_started' | 'in_progress' | 'completed' | 'failed' | 'skipped' | 'rolled_back'
  startedAt?: string
  completedAt?: string
  error?: string
  validation?: ValidationResult
}

const migrationAPI = {
  // Check if migration is needed
  check: (): Promise<MigrationCheckResult> =>
    ipcRenderer.invoke('migration:check'),

  // Get current migration status
  getStatus: (): Promise<MigrationStatus> =>
    ipcRenderer.invoke('migration:getStatus'),

  // Perform the migration
  migrate: (legacyPaths: LegacyPathInfo[]): Promise<MigrationResult> =>
    ipcRenderer.invoke('migration:migrate', legacyPaths),

  // Skip migration (start fresh)
  skip: (): Promise<{ success: boolean; error?: string }> =>
    ipcRenderer.invoke('migration:skip'),

  // Rollback a failed migration
  rollback: (): Promise<RollbackResult> =>
    ipcRenderer.invoke('migration:rollback'),

  // Validate the migration
  validate: (): Promise<ValidationResult> =>
    ipcRenderer.invoke('migration:validate'),

  // Cleanup legacy data after successful migration
  cleanup: (legacyPaths: LegacyPathInfo[]): Promise<CleanupResult> =>
    ipcRenderer.invoke('migration:cleanup', legacyPaths),

  // Get the size of legacy data that can be cleaned up
  getLegacyDataSize: (legacyPaths: LegacyPathInfo[]): Promise<{ totalBytes: number; formattedSize: string }> =>
    ipcRenderer.invoke('migration:getLegacyDataSize', legacyPaths),

  // Format bytes to human readable string
  formatBytes: (bytes: number): Promise<string> =>
    ipcRenderer.invoke('migration:formatBytes', bytes),

  // Subscribe to migration progress updates
  onProgress: (callback: (progress: MigrationProgress) => void): (() => void) => {
    const handler = (_event: unknown, progress: MigrationProgress) => {
      callback(progress)
    }
    ipcRenderer.on('migration:progress', handler)
    return () => {
      ipcRenderer.removeListener('migration:progress', handler)
    }
  }
}

// ============================================================================
// Meeting Deletion API
// ============================================================================

export interface TaskPreviewByStatus {
  pending: number
  in_progress: number
  completed: number
  cancelled: number
}

export interface DeletionPreview {
  meetingId: string
  meetingTitle: string
  recordingsCount: number
  transcriptsCount: number
  notesCount: number
  tasksCount: number
  tasksByStatus: TaskPreviewByStatus
  hasInProgressTasks: boolean
  hasPendingTasks: boolean
  speakersCount: number
  totalFileSizeBytes: number
  filePaths: string[]
  estimatedCleanupTime: number
}

export interface DeletionResult {
  success: boolean
  meetingId: string
  deletedRecordings: number
  deletedTranscripts: number
  deletedNotes: number
  deletedTasks: number
  deletedSpeakers: number
  deletedFiles: number
  failedFileDeletions: string[]
  freedSpaceBytes: number
  auditLogId: string
  error?: string
}

export interface BatchDeletionResult {
  success: boolean
  totalMeetings: number
  deletedMeetings: number
  failedMeetings: number
  results: DeletionResult[]
  totalFreedSpaceBytes: number
  errors: string[]
}

export interface ArchiveResult {
  success: boolean
  meetingId: string
  archivePath: string
  archivedAt: string
  error?: string
}

export interface RestoreResult {
  success: boolean
  meetingId: string
  restoredAt: string
  error?: string
}

export interface SoftDeletedMeeting {
  id: string
  meeting_id: string
  original_data: string
  deleted_at: string
  expires_at: string
  deleted_by: string
}

export interface AuditLogEntry {
  id: string
  meeting_id: string
  action: 'delete' | 'archive' | 'restore' | 'soft_delete' | 'permanent_delete'
  details: string
  performed_at: string
  performed_by: string
}

export type TaskHandlingAction = 'delete' | 'unlink' | 'reassign' | 'cancel'

export interface DeletionOptions {
  deleteFiles?: boolean
  deleteTasks?: boolean
  taskHandling?: TaskHandlingAction
  reassignToMeetingId?: string
  autoUnlinkCompleted?: boolean
  softDelete?: boolean
  softDeleteDays?: number
  auditLog?: boolean
  performedBy?: string
}

// ============================================================================
// Storage Management Types
// ============================================================================

export interface MeetingStorageInfo {
  meetingId: string
  meetingTitle: string
  startTime: string
  audioFileSize: number
  recordingsSize: number
  databaseEstimate: number
  totalSize: number
  transcriptCount: number
  notesCount: number
  tasksCount: number
  hasAudio: boolean
  audioFilePath: string | null
  daysSinceCreated: number
}

export interface StorageBreakdown {
  totalBytes: number
  audioBytes: number
  databaseBytes: number
  meetingsCount: number
  recordingsCount: number
  transcriptsCount: number
  notesCount: number
  tasksCount: number
}

export interface StorageUsageResult {
  total: StorageBreakdown
  byMeeting: MeetingStorageInfo[]
  largestMeetings: MeetingStorageInfo[]
  oldestMeetings: MeetingStorageInfo[]
  meetingsWithoutTranscripts: MeetingStorageInfo[]
  meetingsWithoutNotes: MeetingStorageInfo[]
  storageLimit: number
  storageUsedPercent: number
  warningThreshold: number
  isApproachingLimit: boolean
}

export interface StorageTrendPoint {
  date: string
  totalBytes: number
  audioBytes: number
  databaseBytes: number
  meetingsCount: number
}

export interface CleanupCriteria {
  olderThanDays?: number
  largerThanBytes?: number
  withoutTranscripts?: boolean
  withoutNotes?: boolean
  meetingIds?: string[]
}

export interface CleanupPreview {
  meetingsToDelete: MeetingStorageInfo[]
  totalSpaceToFree: number
  totalMeetings: number
  criteria: CleanupCriteria
}

export interface CleanupResult {
  success: boolean
  deletedMeetings: number
  freedSpaceBytes: number
  errors: string[]
}

export interface StorageSettings {
  storageLimit: number
  warningThreshold: number
  autoCleanup: boolean
  audioRetentionDays: number
}

export interface CleanupRecommendations {
  largeFiles: MeetingStorageInfo[]
  oldMeetings: MeetingStorageInfo[]
  emptyMeetings: MeetingStorageInfo[]
  potentialSavings: number
}

const meetingDeletionAPI = {
  // Get preview of what will be deleted
  getPreview: (meetingId: string): Promise<DeletionPreview | null> =>
    ipcRenderer.invoke('meetingDeletion:getPreview', meetingId),

  // Delete a meeting with all associated data
  deleteMeeting: (meetingId: string, options?: DeletionOptions): Promise<DeletionResult> =>
    ipcRenderer.invoke('meetingDeletion:deleteMeeting', meetingId, options),

  // Delete multiple meetings at once
  deleteBatch: (meetingIds: string[], options?: DeletionOptions): Promise<BatchDeletionResult> =>
    ipcRenderer.invoke('meetingDeletion:deleteBatch', meetingIds, options),

  // Archive a meeting instead of deleting
  archive: (meetingId: string, archivePath?: string): Promise<ArchiveResult> =>
    ipcRenderer.invoke('meetingDeletion:archive', meetingId, archivePath),

  // Restore a soft-deleted meeting
  restore: (meetingId: string): Promise<RestoreResult> =>
    ipcRenderer.invoke('meetingDeletion:restore', meetingId),

  // Get all soft-deleted meetings
  getSoftDeleted: (): Promise<SoftDeletedMeeting[]> =>
    ipcRenderer.invoke('meetingDeletion:getSoftDeleted'),

  // Get all archived meetings
  getArchived: (): Promise<Array<{ id: string; meeting_id: string; original_data: string; archive_path: string; archived_at: string }>> =>
    ipcRenderer.invoke('meetingDeletion:getArchived'),

  // Cleanup expired soft-deleted meetings
  cleanupExpired: (): Promise<number> =>
    ipcRenderer.invoke('meetingDeletion:cleanupExpired'),

  // Get audit logs
  getAuditLogs: (limit?: number): Promise<AuditLogEntry[]> =>
    ipcRenderer.invoke('meetingDeletion:getAuditLogs', limit),

  // Get audit logs for a specific meeting
  getAuditLogsForMeeting: (meetingId: string): Promise<AuditLogEntry[]> =>
    ipcRenderer.invoke('meetingDeletion:getAuditLogsForMeeting', meetingId),

  // Reassign tasks from one meeting to another
  reassignTasks: (fromMeetingId: string, toMeetingId: string): Promise<{ success: boolean; reassignedCount: number; error?: string }> =>
    ipcRenderer.invoke('meetingDeletion:reassignTasks', fromMeetingId, toMeetingId),

  // Unlink tasks from a meeting
  unlinkTasks: (meetingId: string): Promise<{ success: boolean; unlinkedCount: number; error?: string }> =>
    ipcRenderer.invoke('meetingDeletion:unlinkTasks', meetingId)
}

// ============================================================================
// Export & Delete API - Export meetings before deletion with various formats
// ============================================================================

export type ExportArchiveFormat = 'json' | 'pdf' | 'audio' | 'full'
export type ExportTemplate = 'meeting_minutes' | 'full_transcript' | 'action_items_only' | 'custom'

export interface ExportContentConfig {
  includeMetadata: boolean
  includeSummary: boolean
  includeKeyPoints: boolean
  includeActionItems: boolean
  includeDecisions: boolean
  includeTranscript: boolean
  includeSpeakers: boolean
  includeTimestamps: boolean
  includeCustomNotes: boolean
}

export interface ExportOptions {
  format: ExportArchiveFormat
  template?: ExportTemplate
  content?: Partial<ExportContentConfig>
  outputPath?: string
  compress?: boolean
  includeAudio?: boolean
}

export interface ExportPreview {
  meetingId: string
  meetingTitle: string
  estimatedSizeBytes: number
  sizeBreakdown: {
    metadata: number
    transcripts: number
    notes: number
    tasks: number
    audioFiles: number
  }
  itemCounts: {
    transcriptSegments: number
    notes: number
    tasks: number
    speakers: number
    audioFiles: number
  }
  audioFilePaths: string[]
  estimatedTimeMs: number
}

export interface ExportProgress {
  step: 'preparing' | 'exporting_data' | 'exporting_audio' | 'compressing' | 'writing' | 'complete' | 'error'
  percent: number
  currentFile?: string
  filesProcessed: number
  totalFiles: number
  bytesWritten: number
  totalBytes: number
  error?: string
}

export interface ExportResult {
  success: boolean
  filePath?: string
  fileSizeBytes?: number
  format: ExportArchiveFormat
  exportedContent: {
    transcriptSegments: number
    notes: number
    tasks: number
    speakers: number
    audioFiles: number
  }
  durationMs: number
  error?: string
}

export interface BatchExportResult {
  success: boolean
  totalMeetings: number
  successfulExports: number
  failedExports: number
  results: ExportResult[]
  outputPath?: string
  totalSizeBytes: number
  errors: string[]
}

export interface ImportFileInfo {
  filePath: string
  format: ExportArchiveFormat
  isValid: boolean
  meetingInfo?: {
    id: string
    title: string
    date: string
    duration: number | null
  }
  availableContent: {
    hasMetadata: boolean
    hasTranscripts: boolean
    hasNotes: boolean
    hasTasks: boolean
    hasSpeakers: boolean
    hasAudio: boolean
  }
  fileSizeBytes: number
  exportDate?: string
  validationErrors?: string[]
}

export interface ImportOptions {
  conflictResolution: 'skip' | 'replace' | 'create_new'
  importContent: {
    metadata: boolean
    transcripts: boolean
    notes: boolean
    tasks: boolean
    speakers: boolean
    audio: boolean
  }
  customTitle?: string
}

export interface ImportResult {
  success: boolean
  meetingId?: string
  importedContent: {
    transcripts: number
    notes: number
    tasks: number
    speakers: number
    audioFiles: number
  }
  hadConflict: boolean
  conflictResolution?: 'skipped' | 'replaced' | 'created_new'
  durationMs: number
  error?: string
}

export interface ExportAndDeleteOptions {
  export: ExportOptions
  deleteAfterExport: boolean
  deletion?: {
    taskHandling: 'delete' | 'unlink' | 'keep'
    softDelete: boolean
  }
}

export interface ExportAndDeleteResult {
  exportResult: ExportResult
  deleted: boolean
  deletionResult?: {
    success: boolean
    freedSpaceBytes: number
    error?: string
  }
  success: boolean
}

export interface ArchiveToDiskOptions {
  outputDirectory?: string
  useDateFolders?: boolean
  format: ExportArchiveFormat
  template?: ExportTemplate
  deleteAfterArchive: boolean
}

export interface ArchiveToDiskResult {
  success: boolean
  archivePath?: string
  archiveSizeBytes?: number
  meetingDeleted: boolean
  freedSpaceBytes?: number
  error?: string
}

const exportDeleteAPI = {
  // Get export preview (estimated size, content counts)
  getPreview: (meetingId: string, options: ExportOptions): Promise<ExportPreview | null> =>
    ipcRenderer.invoke('exportDelete:getPreview', meetingId, options),

  // Export meeting to specified format
  exportMeeting: (meetingId: string, options: ExportOptions): Promise<ExportResult> =>
    ipcRenderer.invoke('exportDelete:exportMeeting', meetingId, options),

  // Export multiple meetings (batch)
  exportBatch: (meetingIds: string[], options: ExportOptions): Promise<BatchExportResult> =>
    ipcRenderer.invoke('exportDelete:exportBatch', meetingIds, options),

  // Export and then delete a meeting
  exportAndDelete: (meetingId: string, options: ExportAndDeleteOptions): Promise<ExportAndDeleteResult> =>
    ipcRenderer.invoke('exportDelete:exportAndDelete', meetingId, options),

  // One-click archive to disk
  archiveToDisk: (meetingId: string, options: ArchiveToDiskOptions): Promise<ArchiveToDiskResult> =>
    ipcRenderer.invoke('exportDelete:archiveToDisk', meetingId, options),

  // Validate import file
  validateImport: (filePath: string): Promise<ImportFileInfo> =>
    ipcRenderer.invoke('exportDelete:validateImport', filePath),

  // Import meeting from file
  importMeeting: (filePath: string, options: ImportOptions): Promise<ImportResult> =>
    ipcRenderer.invoke('exportDelete:importMeeting', filePath, options),

  // Get template configuration
  getTemplateConfig: (template: ExportTemplate): Promise<ExportContentConfig> =>
    ipcRenderer.invoke('exportDelete:getTemplateConfig', template),

  // Estimate export size
  estimateSize: (meetingId: string, options: ExportOptions): Promise<number> =>
    ipcRenderer.invoke('exportDelete:estimateSize', meetingId, options)
}

// ============================================================================
// Storage Management API
// ============================================================================

const storageManagementAPI = {
  // Get comprehensive storage usage information
  getUsage: (): Promise<StorageUsageResult> =>
    ipcRenderer.invoke('storageManagement:getUsage'),

  // Get storage info for a specific meeting
  getMeetingInfo: (meetingId: string): Promise<MeetingStorageInfo | null> =>
    ipcRenderer.invoke('storageManagement:getMeetingInfo', meetingId),

  // Get cleanup preview based on criteria
  getCleanupPreview: (criteria: CleanupCriteria): Promise<CleanupPreview> =>
    ipcRenderer.invoke('storageManagement:getCleanupPreview', criteria),

  // Execute cleanup based on criteria
  executeCleanup: (criteria: CleanupCriteria, options?: DeletionOptions): Promise<CleanupResult> =>
    ipcRenderer.invoke('storageManagement:executeCleanup', criteria, options),

  // Delete meetings older than X days
  deleteOlderThan: (days: number, options?: DeletionOptions): Promise<CleanupResult> =>
    ipcRenderer.invoke('storageManagement:deleteOlderThan', days, options),

  // Delete meetings larger than X bytes
  deleteLargerThan: (bytes: number, options?: DeletionOptions): Promise<CleanupResult> =>
    ipcRenderer.invoke('storageManagement:deleteLargerThan', bytes, options),

  // Delete meetings without transcripts
  deleteWithoutTranscripts: (options?: DeletionOptions): Promise<CleanupResult> =>
    ipcRenderer.invoke('storageManagement:deleteWithoutTranscripts', options),

  // Delete meetings without notes
  deleteWithoutNotes: (options?: DeletionOptions): Promise<CleanupResult> =>
    ipcRenderer.invoke('storageManagement:deleteWithoutNotes', options),

  // Get storage trends
  getTrends: (days?: number): Promise<StorageTrendPoint[]> =>
    ipcRenderer.invoke('storageManagement:getTrends', days),

  // Record storage trend (should be called periodically)
  recordTrend: (): Promise<{ success: boolean }> =>
    ipcRenderer.invoke('storageManagement:recordTrend'),

  // Get storage settings
  getSettings: (): Promise<StorageSettings> =>
    ipcRenderer.invoke('storageManagement:getSettings'),

  // Update storage settings
  updateSettings: (settings: Partial<StorageSettings>): Promise<{ success: boolean }> =>
    ipcRenderer.invoke('storageManagement:updateSettings', settings),

  // Run auto cleanup
  runAutoCleanup: (): Promise<CleanupResult> =>
    ipcRenderer.invoke('storageManagement:runAutoCleanup'),

  // Check if storage warning should be shown
  shouldShowWarning: (): Promise<boolean> =>
    ipcRenderer.invoke('storageManagement:shouldShowWarning'),

  // Get cleanup recommendations
  getRecommendations: (): Promise<CleanupRecommendations> =>
    ipcRenderer.invoke('storageManagement:getRecommendations')
}

const updateAPI = {
  // Get current update state
  getState: (): Promise<UpdateState> =>
    ipcRenderer.invoke('update:getState'),

  // Check for available updates
  checkForUpdates: (): Promise<UpdateCheckResult> =>
    ipcRenderer.invoke('update:checkForUpdates'),

  // Download the available update
  downloadUpdate: (): Promise<{ success: boolean; error?: string }> =>
    ipcRenderer.invoke('update:downloadUpdate'),

  // Install the downloaded update and restart the app
  installUpdate: (): Promise<{ success: boolean; error?: string }> =>
    ipcRenderer.invoke('update:installUpdate'),

  // Get rollback information
  getRollbackInfo: (): Promise<RollbackInfo> =>
    ipcRenderer.invoke('update:getRollbackInfo'),

  // Attempt to rollback to the previous version
  rollback: (): Promise<{ success: boolean; error?: string }> =>
    ipcRenderer.invoke('update:rollback'),

  // Set the update server URL
  setFeedURL: (url: string): Promise<{ success: boolean; error?: string }> =>
    ipcRenderer.invoke('update:setFeedURL', url),

  // Enable or disable auto-download
  setAutoDownload: (enabled: boolean): Promise<{ success: boolean; error?: string }> =>
    ipcRenderer.invoke('update:setAutoDownload', enabled),

  // Enable or disable pre-release updates
  setAllowPrerelease: (enabled: boolean): Promise<{ success: boolean; error?: string }> =>
    ipcRenderer.invoke('update:setAllowPrerelease', enabled),

  // Reset the update state
  reset: (): Promise<{ success: boolean; error?: string }> =>
    ipcRenderer.invoke('update:reset'),

  // Subscribe to update status change events
  onStatusChange: (callback: (state: UpdateState) => void): (() => void) => {
    const handler = (_event: unknown, state: UpdateState) => {
      callback(state)
    }
    ipcRenderer.on('update:statusChange', handler)
    return () => {
      ipcRenderer.removeListener('update:statusChange', handler)
    }
  }
}

// Expose protected methods that allow the renderer process to use
// the ipcRenderer without exposing the entire object
contextBridge.exposeInMainWorld('electronAPI', {
  // Platform information
  platform: process.platform,

  // Version info
  versions: {
    node: process.versions.node,
    chrome: process.versions.chrome,
    electron: process.versions.electron
  },

  // Database API
  db: databaseAPI,

  // Recording API
  recording: recordingAPI,

  // Audio Device API
  audioDevices: audioDeviceAPI,

  // System Audio Capture API
  systemAudioCapture: systemAudioCaptureAPI,

  // ScreenCaptureKit API (macOS 13+ native app audio capture)
  screenCaptureKit: screenCaptureKitAPI,

  // ML Pipeline API
  mlPipeline: mlPipelineAPI,

  // Live Transcription API
  liveTranscription: liveTranscriptionAPI,

  // Batch Diarization API
  diarization: diarizationAPI,

  // Core Diarization Engine API (MANDATORY preprocessing stage)
  coreDiarization: coreDiarizationAPI,

  // Streaming Diarization API (real-time speaker detection during live recording)
  streamingDiarization: streamingDiarizationAPI,

  // Diarization Failure API (explicit failure detection and notification)
  diarizationFailure: diarizationFailureAPI,

  // Diarization Health Monitor API (real-time health monitoring and fallback)
  diarizationHealth: diarizationHealthAPI,

  // Python Environment Validation API
  pythonValidation: pythonValidationAPI,

  // Tiered Validation API (Progressive Startup Validation)
  tieredValidation: tieredValidationAPI,

  // Python Setup API (Automated Environment Creation)
  pythonSetup: pythonSetupAPI,

  // Python Execution Manager API (Centralized Python Script Execution)
  pythonEnv: pythonExecutionManagerAPI,

  // Model Manager API (PyAnnote model downloads and bundling)
  modelManager: modelManagerAPI,

  // LLM Post-Processing API (LM Studio-based speaker consistency)
  llmPostProcessing: llmPostProcessingAPI,

  // Meeting Summary API (LLM-based meeting summarization)
  meetingSummary: meetingSummaryAPI,

  // Action Items Extraction API (LLM-based action items extraction)
  actionItems: actionItemsAPI,

  // Decisions and Topics Extraction API (LLM-based decisions, key points, and topics with sentiment)
  decisionsAndTopics: decisionsAndTopicsAPI,

  // Export API (PDF and Markdown export)
  export: exportAPI,

  // Update API (automatic updates)
  update: updateAPI,

  // Shell API
  shell: shellAPI,

  // LLM Provider API (multi-provider detection and selection)
  llmProvider: llmProviderAPI,

  // LLM Health Check API (periodic health monitoring for LLM providers)
  llmHealthCheck: llmHealthCheckAPI,

  // Live Notes API (real-time meeting notes during recording)
  liveNotes: liveNotesAPI,

  // Live Insights Persistence API (automatic persistence of live notes to database)
  liveInsights: liveInsightsAPI,

  // Transcript Correction API (AI-assisted transcription correction)
  transcriptCorrection: transcriptCorrectionAPI,

  // Confidence Scoring API (transcription quality metrics and alerts)
  confidenceScoring: confidenceScoringAPI,

  // Meeting Deletion API (comprehensive meeting deletion with cleanup)
  meetingDeletion: meetingDeletionAPI,

  // Storage Management API (storage analysis, cleanup, and optimization)
  storageManagement: storageManagementAPI,

  // Export & Delete API (export meetings before deletion with various formats)
  exportDelete: exportDeleteAPI,

  // Speaker Name Detection API (intelligent speaker name identification)
  speakerNameDetection: speakerNameDetectionAPI,

  // Dialog API (file save dialogs)
  dialog: dialogAPI,

  // Data Migration API (Meeting Notes -> FlowRecap rebrand migration)
  migration: migrationAPI
})

// ============================================================================
// Type Declarations
// ============================================================================

// Type declaration for the exposed API
declare global {
  interface Window {
    electronAPI: {
      platform: NodeJS.Platform
      versions: {
        node: string
        chrome: string
        electron: string
      }
      db: typeof databaseAPI
      recording: typeof recordingAPI
      audioDevices: typeof audioDeviceAPI
      systemAudioCapture: typeof systemAudioCaptureAPI
      screenCaptureKit: typeof screenCaptureKitAPI
      mlPipeline: typeof mlPipelineAPI
      liveTranscription: typeof liveTranscriptionAPI
      diarization: typeof diarizationAPI
      coreDiarization: typeof coreDiarizationAPI
      streamingDiarization: typeof streamingDiarizationAPI
      diarizationFailure: typeof diarizationFailureAPI
      diarizationHealth: typeof diarizationHealthAPI
      pythonValidation: typeof pythonValidationAPI
      tieredValidation: typeof tieredValidationAPI
      pythonSetup: typeof pythonSetupAPI
      pythonEnv: typeof pythonExecutionManagerAPI
      modelManager: typeof modelManagerAPI
      llmPostProcessing: typeof llmPostProcessingAPI
      meetingSummary: typeof meetingSummaryAPI
      actionItems: typeof actionItemsAPI
      decisionsAndTopics: typeof decisionsAndTopicsAPI
      export: typeof exportAPI
      update: typeof updateAPI
      shell: typeof shellAPI
      llmProvider: typeof llmProviderAPI
      llmHealthCheck: typeof llmHealthCheckAPI
      liveNotes: typeof liveNotesAPI
      liveInsights: typeof liveInsightsAPI
      transcriptCorrection: typeof transcriptCorrectionAPI
      confidenceScoring: typeof confidenceScoringAPI
      meetingDeletion: typeof meetingDeletionAPI
      storageManagement: typeof storageManagementAPI
      exportDelete: typeof exportDeleteAPI
      speakerNameDetection: typeof speakerNameDetectionAPI
      dialog: typeof dialogAPI
      migration: typeof migrationAPI
    }
  }
}
