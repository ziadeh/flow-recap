/**
 * Database type definitions for Meeting Notes application
 * These interfaces define the structure of all database tables
 */

// ============================================================================
// Meeting Types
// ============================================================================

export interface Meeting {
  id: string
  title: string
  description: string | null
  meeting_type: MeetingType
  start_time: string  // ISO 8601 datetime string
  end_time: string | null  // ISO 8601 datetime string
  duration_seconds: number | null
  status: MeetingStatus
  audio_file_path: string | null
  created_at: string  // ISO 8601 datetime string
  updated_at: string  // ISO 8601 datetime string
}

export type MeetingStatus = 'scheduled' | 'in_progress' | 'completed' | 'cancelled'
export type MeetingType = 'one-on-one' | 'team' | 'webinar' | 'other'

export interface CreateMeetingInput {
  id?: string
  title: string
  description?: string | null
  meeting_type?: MeetingType
  start_time: string
  end_time?: string | null
  status?: MeetingStatus
  audio_file_path?: string | null
}

export interface UpdateMeetingInput {
  title?: string
  description?: string | null
  meeting_type?: MeetingType
  start_time?: string
  end_time?: string | null
  duration_seconds?: number | null
  status?: MeetingStatus
  audio_file_path?: string | null
}

// ============================================================================
// Recording Types
// ============================================================================

export interface Recording {
  id: string
  meeting_id: string
  file_path: string
  duration_seconds: number | null
  file_size_bytes: number | null
  start_time: string  // ISO 8601 datetime string
  end_time: string | null  // ISO 8601 datetime string
  created_at: string
}

export interface CreateRecordingInput {
  id?: string
  meeting_id: string
  file_path: string
  duration_seconds?: number | null
  file_size_bytes?: number | null
  start_time: string
  end_time?: string | null
}

export interface UpdateRecordingInput {
  file_path?: string
  duration_seconds?: number | null
  file_size_bytes?: number | null
  end_time?: string | null
}

// ============================================================================
// Transcript Types
// ============================================================================

export interface Transcript {
  id: string
  meeting_id: string
  speaker_id: string | null
  content: string
  start_time_ms: number  // Milliseconds from meeting start
  end_time_ms: number    // Milliseconds from meeting start
  confidence: number     // 0.0 to 1.0
  is_final: boolean
  created_at: string
}

export interface CreateTranscriptInput {
  id?: string
  meeting_id: string
  speaker_id?: string | null
  content: string
  start_time_ms: number
  end_time_ms: number
  confidence?: number
  is_final?: boolean
}

// Full-text search result types
export interface TranscriptSearchResult {
  transcript: Transcript
  snippet: string
  matchPositions: Array<{ start: number; end: number }>
}

export interface TranscriptSearchResultGlobal {
  transcript: Transcript
  meetingId: string
  snippet: string
}

// ============================================================================
// Meeting Notes Types
// ============================================================================

export interface MeetingNote {
  id: string
  meeting_id: string
  content: string
  note_type: NoteType
  is_ai_generated: boolean
  source_transcript_ids: string | null  // JSON array of transcript IDs
  created_at: string
  updated_at: string
  created_during_recording: boolean
  generation_timestamp: string | null
  context: string | null
  confidence_score: number | null
  speaker_id: string | null
  start_time_ms: number | null
  end_time_ms: number | null
  keywords: string | null  // JSON array
}

export type NoteType = 'summary' | 'action_item' | 'decision' | 'key_point' | 'custom'

export interface CreateMeetingNoteInput {
  id?: string
  meeting_id: string
  content: string
  note_type: NoteType
  is_ai_generated?: boolean
  source_transcript_ids?: string[] | null
  created_during_recording?: boolean
  generation_timestamp?: string
  context?: string
  confidence_score?: number
  speaker_id?: string
  start_time_ms?: number
  end_time_ms?: number
  keywords?: string[]
}

export interface UpdateMeetingNoteInput {
  content?: string
  note_type?: NoteType
  source_transcript_ids?: string[] | null
}

// ============================================================================
// Task Types
// ============================================================================

export interface Task {
  id: string
  meeting_id: string | null
  title: string
  description: string | null
  assignee: string | null
  due_date: string | null  // ISO 8601 date string
  priority: TaskPriority
  status: TaskStatus
  created_at: string
  updated_at: string
  completed_at: string | null
  created_during_recording: boolean
  generation_timestamp: string | null
}

export type TaskPriority = 'low' | 'medium' | 'high' | 'urgent'
export type TaskStatus = 'pending' | 'in_progress' | 'completed' | 'cancelled'

export interface CreateTaskInput {
  id?: string
  meeting_id?: string | null
  title: string
  description?: string | null
  assignee?: string | null
  due_date?: string | null
  priority?: TaskPriority
  status?: TaskStatus
  created_during_recording?: boolean
  generation_timestamp?: string
}

export interface UpdateTaskInput {
  title?: string
  description?: string | null
  meeting_id?: string | null
  assignee?: string | null
  due_date?: string | null
  priority?: TaskPriority
  status?: TaskStatus
  completed_at?: string | null
}

// ============================================================================
// Speaker Types
// ============================================================================

export interface Speaker {
  id: string
  name: string
  email: string | null
  voice_profile_path: string | null  // Path to voice embedding file
  is_user: boolean  // Is this the current user
  created_at: string
  updated_at: string
}

export interface CreateSpeakerInput {
  id?: string
  name: string
  email?: string | null
  voice_profile_path?: string | null
  is_user?: boolean
}

export interface UpdateSpeakerInput {
  name?: string
  email?: string | null
  voice_profile_path?: string | null
  is_user?: boolean
}

// ============================================================================
// Meeting Speaker Name Types (Meeting-specific speaker names)
// ============================================================================

export interface MeetingSpeakerName {
  id: string
  meeting_id: string
  speaker_id: string
  display_name: string
  created_at: string
  updated_at: string
}

export interface CreateMeetingSpeakerNameInput {
  id?: string
  meeting_id: string
  speaker_id: string
  display_name: string
}

export interface UpdateMeetingSpeakerNameInput {
  display_name: string
}

// ============================================================================
// Settings Types
// ============================================================================

export interface Setting {
  key: string
  value: string  // JSON-encoded value
  category: SettingCategory
  created_at: string
  updated_at: string
}

export type SettingCategory =
  | 'general'
  | 'audio'
  | 'transcription'
  | 'ai'
  | 'appearance'
  | 'notifications'
  | 'storage'

// ============================================================================
// Note Generation Filtering Mode Types
// ============================================================================

/**
 * Strictness mode for note generation filtering
 * Controls how aggressively out-of-scope content is filtered
 */
export type NoteGenerationMode = 'strict' | 'balanced' | 'loose'

/**
 * Configuration for note generation filtering modes
 */
export interface NoteGenerationModeConfig {
  /** The selected filtering mode */
  mode: NoteGenerationMode
  /** Description of the current mode */
  description: string
}

export interface CreateSettingInput {
  key: string
  value: unknown  // Will be JSON-encoded
  category: SettingCategory
}

export interface UpdateSettingInput {
  value: unknown  // Will be JSON-encoded
}

// ============================================================================
// Database API Types (for IPC)
// ============================================================================

export interface DatabaseAPI {
  // Meetings
  meetings: {
    create: (input: CreateMeetingInput) => Promise<Meeting>
    getById: (id: string) => Promise<Meeting | null>
    getAll: () => Promise<Meeting[]>
    update: (id: string, input: UpdateMeetingInput) => Promise<Meeting | null>
    delete: (id: string) => Promise<boolean>
    getByStatus: (status: MeetingStatus) => Promise<Meeting[]>
    getRecent: (limit: number) => Promise<Meeting[]>
  }

  // Recordings
  recordings: {
    create: (input: CreateRecordingInput) => Promise<Recording>
    getById: (id: string) => Promise<Recording | null>
    getByMeetingId: (meetingId: string) => Promise<Recording[]>
    update: (id: string, input: UpdateRecordingInput) => Promise<Recording | null>
    delete: (id: string) => Promise<boolean>
  }

  // Transcripts
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

  // Meeting Notes
  meetingNotes: {
    create: (input: CreateMeetingNoteInput) => Promise<MeetingNote>
    getById: (id: string) => Promise<MeetingNote | null>
    getByMeetingId: (meetingId: string) => Promise<MeetingNote[]>
    update: (id: string, input: UpdateMeetingNoteInput) => Promise<MeetingNote | null>
    delete: (id: string) => Promise<boolean>
    getByType: (meetingId: string, noteType: NoteType) => Promise<MeetingNote[]>
  }

  // Tasks
  tasks: {
    create: (input: CreateTaskInput) => Promise<Task>
    getById: (id: string) => Promise<Task | null>
    getAll: () => Promise<Task[]>
    getByMeetingId: (meetingId: string) => Promise<Task[]>
    update: (id: string, input: UpdateTaskInput) => Promise<Task | null>
    delete: (id: string) => Promise<boolean>
    getByStatus: (status: TaskStatus) => Promise<Task[]>
    getPending: () => Promise<Task[]>
    getByPriority: (priority: TaskPriority) => Promise<Task[]>
    getByAssignee: (assignee: string) => Promise<Task[]>
    getOverdue: () => Promise<Task[]>
    complete: (id: string) => Promise<Task | null>
  }

  // Speakers
  speakers: {
    create: (input: CreateSpeakerInput) => Promise<Speaker>
    getById: (id: string) => Promise<Speaker | null>
    getAll: () => Promise<Speaker[]>
    update: (id: string, input: UpdateSpeakerInput) => Promise<Speaker | null>
    delete: (id: string) => Promise<boolean>
    getUser: () => Promise<Speaker | null>
  }

  // Meeting Speaker Names (meeting-specific speaker name overrides)
  meetingSpeakerNames: {
    getByMeetingId: (meetingId: string) => Promise<MeetingSpeakerName[]>
    setName: (meetingId: string, speakerId: string, displayName: string) => Promise<MeetingSpeakerName>
    delete: (meetingId: string, speakerId: string) => Promise<boolean>
    deleteByMeetingId: (meetingId: string) => Promise<number>
  }

  // Settings
  settings: {
    get: <T = unknown>(key: string) => Promise<T | null>
    set: (key: string, value: unknown, category?: SettingCategory) => Promise<Setting>
    delete: (key: string) => Promise<boolean>
    getByCategory: (category: SettingCategory) => Promise<Setting[]>
    getAll: () => Promise<Setting[]>
  }

  // Database utilities
  utils: {
    backup: (path: string) => Promise<boolean>
    getStats: () => Promise<DatabaseStats>
  }
}

export interface DatabaseStats {
  meetingCount: number
  transcriptCount: number
  noteCount: number
  taskCount: number
  speakerCount: number
  databaseSizeBytes: number
}

// ============================================================================
// Migration Types
// ============================================================================

export interface Migration {
  version: number
  name: string
  up: string  // SQL to apply migration
  down: string  // SQL to rollback migration
}

export interface MigrationRecord {
  version: number
  name: string
  applied_at: string
}

// ============================================================================
// Audio Device Types
// ============================================================================

export type AudioDeviceType = 'input' | 'output' | 'virtual'
export type VirtualCableType = 'vb-audio' | 'blackhole' | 'pulseaudio-virtual' | 'unknown'
export type DiagnosticStatus = 'ok' | 'warning' | 'error' | 'not_checked'

export interface AudioDevice {
  id: string
  name: string
  type: AudioDeviceType
  isDefault: boolean
  isVirtual: boolean
  virtualCableType: VirtualCableType | null
}

export interface VirtualCableInfo {
  detected: boolean
  type: VirtualCableType
  name: string
  deviceId: string | null
  installationStatus: 'installed' | 'not_installed' | 'unknown'
}

export interface MicrophoneTestResult {
  accessible: boolean
  error?: string
  recordingLevel?: number  // 0.0 to 1.0, average RMS level during test
  peakLevel?: number       // 0.0 to 1.0, peak level during test
  isSilent?: boolean       // True if recording levels are too low
  testDuration?: number    // Duration of test recording in ms
}

export interface AutoFixResult {
  success: boolean
  action: string
  message: string
  error?: string
}

export interface AudioDiagnosticResult {
  timestamp: string
  platform: NodeJS.Platform
  overallStatus: DiagnosticStatus

  // Virtual cable detection
  virtualCables: VirtualCableInfo[]
  recommendedVirtualCable: VirtualCableType | null

  // Device status
  inputDevices: AudioDevice[]
  outputDevices: AudioDevice[]
  hasInputDevice: boolean
  hasOutputDevice: boolean

  // Microphone testing
  microphoneTest?: MicrophoneTestResult

  // Diagnostic messages
  messages: DiagnosticMessage[]
}

export interface DiagnosticMessage {
  level: 'info' | 'warning' | 'error' | 'success'
  code: string
  message: string
  suggestion?: string
}

// ============================================================================
// Audio Device API Types (for IPC)
// ============================================================================

export interface AudioDeviceAPI {
  detectVirtualCables: () => Promise<VirtualCableInfo[]>
  getAudioDevices: () => Promise<AudioDevice[]>
  runDiagnostics: () => Promise<AudioDiagnosticResult>
  isVirtualCableInstalled: (cableType: VirtualCableType) => Promise<boolean>
  getRecommendedVirtualCable: () => Promise<VirtualCableType | null>
  getInstallationInstructions: (cableType?: VirtualCableType) => Promise<string>
}

// ============================================================================
// System Audio Capture Types
// ============================================================================

export type DualRecordingStatus = 'idle' | 'recording' | 'paused' | 'stopping'

export type AudioSourceType = 'microphone' | 'system' | 'both'

export interface AudioSource {
  id: string
  name: string
  type: AudioSourceType
  deviceId: string | null
  isVirtual: boolean
}

export interface DualRecordingState {
  status: DualRecordingStatus
  meetingId: string | null
  startTime: number | null
  duration: number
  microphoneFilePath: string | null
  systemAudioFilePath: string | null
  mixedFilePath: string | null
  sourceType: AudioSourceType
}

export interface DualRecordingConfig {
  microphoneDevice?: string
  systemAudioDevice?: string
  sampleRate?: number
  channels?: number
  mixAudio?: boolean
}

export interface StartDualRecordingResult {
  success: boolean
  meetingId: string | null
  startTime: number
  microphoneFilePath: string | null
  systemAudioFilePath: string | null
  mixedFilePath: string | null
  sourceType: AudioSourceType
}

export interface StopDualRecordingResult {
  success: boolean
  meetingId: string | null
  duration: number
  microphoneFilePath: string | null
  systemAudioFilePath: string | null
  mixedFilePath: string | null
}

export interface SystemAudioCaptureCapabilities {
  platform: NodeJS.Platform
  supportsSystemAudio: boolean
  supportsDualRecording: boolean
  availableRecorders: string[]
  virtualCableDetected: boolean
  virtualCableType: string | null
  instructions: string
  // ScreenCaptureKit capabilities (macOS 13+)
  screenCaptureKit?: {
    available: boolean
    supportsAppAudioCapture: boolean
    permissionStatus: 'unknown' | 'denied' | 'granted' | 'not_determined'
    preferredMethod: 'screencapturekit' | 'virtual_cable'
  }
}

// ============================================================================
// ScreenCaptureKit Types (macOS 13+ native app audio capture)
// ============================================================================

export type ScreenCaptureKitStatus = 'unavailable' | 'available' | 'permission_denied' | 'permission_granted' | 'recording' | 'error'

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

export interface ScreenCaptureKitAPI {
  getCapabilities: () => Promise<ScreenCaptureKitCapabilities>
  requestPermission: () => Promise<{ success: boolean; message: string }>
  getCapturableApps: () => Promise<CaptureableApp[]>
  getRunningMeetingApps: () => Promise<CaptureableApp[]>
  startCapture: (meetingId?: string, config?: ScreenCaptureKitConfig) => Promise<StartCaptureResult>
  stopCapture: () => Promise<StopCaptureResult>
  getStatus: () => Promise<{
    status: ScreenCaptureKitStatus
    isRecording: boolean
    method: string | null
    duration: number
    targetApps: string[]
  }>
  shouldUse: () => Promise<{
    shouldUse: boolean
    reason: string
    capabilities: ScreenCaptureKitCapabilities
  }>
  getMeetingAppBundles: () => Promise<string[]>
}

export interface SystemAudioCaptureAPI {
  getCapabilities: () => Promise<SystemAudioCaptureCapabilities>
  startDualRecording: (meetingId?: string, config?: DualRecordingConfig) => Promise<StartDualRecordingResult>
  startSystemAudioRecording: (meetingId?: string, config?: DualRecordingConfig) => Promise<StartDualRecordingResult>
  stopDualRecording: () => Promise<StopDualRecordingResult>
  pauseDualRecording: () => Promise<{ success: boolean; duration: number }>
  resumeDualRecording: () => Promise<{ success: boolean; startTime: number }>
  getStatus: () => Promise<DualRecordingState>
  getAvailableSources: () => Promise<AudioSource[]>
  // ScreenCaptureKit-enhanced methods
  getScreenCaptureKitCapabilities: () => Promise<ScreenCaptureKitCapabilities>
  requestScreenRecordingPermission: () => Promise<{ success: boolean; message: string }>
  getCapturableApps: () => Promise<CaptureableApp[]>
  getRunningMeetingApps: () => Promise<CaptureableApp[]>
  shouldUseScreenCaptureKit: () => Promise<{
    shouldUse: boolean
    reason: string
    capabilities: ScreenCaptureKitCapabilities
  }>
  startAppAudioCapture: (meetingId?: string, config?: {
    targetApps?: string[]
    sampleRate?: number
    channels?: number
  }) => Promise<StartCaptureResult>
  stopAppAudioCapture: () => Promise<StopCaptureResult>
  getAppAudioCaptureStatus: () => Promise<{
    isCapturing: boolean
    method: 'screencapturekit' | 'virtual_cable' | null
    duration: number
    targetApps: string[]
  }>
  getMeetingAppBundles: () => Promise<string[]>
}

// ============================================================================
// Speaker Name Detection Types
// ============================================================================

/**
 * Types of detection methods for speaker names
 */
export type SpeakerNameDetectionType =
  | 'self_introduction'      // "Hi, I'm John", "My name is John"
  | 'name_reference'         // When Speaker A says "John" and Speaker B starts speaking
  | 'temporal_correlation'   // Name associations built over time across meetings
  | 'manual_correction'      // User manually corrected the name

/**
 * Detection event types for logging
 */
export type SpeakerNameDetectionEventType =
  | 'detection'              // New name detected
  | 'confidence_update'      // Confidence score updated
  | 'acceptance'             // User accepted the suggestion
  | 'rejection'              // User rejected the suggestion
  | 'manual_override'        // User manually set a different name
  | 'disambiguation'         // System resolved conflicting names

/**
 * Confidence levels for speaker name detection
 */
export type NameConfidenceLevel = 'high' | 'medium' | 'low'

/**
 * Speaker name candidate stored in database
 */
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

/**
 * Input for creating a new speaker name candidate
 */
export interface CreateSpeakerNameCandidateInput {
  id?: string
  meeting_id: string
  speaker_id: string
  candidate_name: string
  confidence?: number
  detection_type: SpeakerNameDetectionType
  detection_context?: string | null
  source_transcript_id?: string | null
  timestamp_ms: number
}

/**
 * Input for updating a speaker name candidate
 */
export interface UpdateSpeakerNameCandidateInput {
  confidence?: number
  is_accepted?: boolean
  is_rejected?: boolean
}

/**
 * Speaker name detection event stored in database
 */
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

/**
 * Input for creating a detection event log
 */
export interface CreateSpeakerNameDetectionEventInput {
  id?: string
  meeting_id: string
  speaker_id?: string | null
  event_type: SpeakerNameDetectionEventType
  description: string
  confidence?: number | null
  candidate_name?: string | null
  detection_type?: SpeakerNameDetectionType | null
  context_data?: string | null
  timestamp_ms: number
}

/**
 * Result of analyzing transcript for name detection
 */
export interface NameDetectionResult {
  detected: boolean
  candidateName: string | null
  confidence: number
  detectionType: SpeakerNameDetectionType
  context: string
  patterns: string[]
}

/**
 * Configuration for speaker name detection
 */
export interface SpeakerNameDetectionConfig {
  // Confidence thresholds
  highConfidenceThreshold: number       // >= 0.8
  mediumConfidenceThreshold: number     // >= 0.5
  autoApplyThreshold: number            // >= 0.6 for auto-applying names

  // Temporal correlation settings
  nameReferenceWindowMs: number         // Window after name mention (5-10 seconds)
  speakerChangeToleranceMs: number      // Tolerance for matching speaker changes

  // Detection settings
  enableSelfIntroductionDetection: boolean
  enableNameReferenceDetection: boolean
  enableTemporalCorrelation: boolean

  // Common words to exclude from name detection
  excludedWords: string[]
}

/**
 * Speaker name suggestion for UI display
 */
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

/**
 * Summary of speaker name candidates for a meeting
 */
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

/**
 * API for speaker name detection operations (for IPC)
 */
export interface SpeakerNameDetectionAPI {
  // Detection operations
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

  // Candidate management
  getCandidates: (meetingId: string, speakerId?: string) => Promise<SpeakerNameCandidate[]>
  getTopCandidate: (meetingId: string, speakerId: string) => Promise<SpeakerNameCandidate | null>
  acceptCandidate: (candidateId: string) => Promise<boolean>
  rejectCandidate: (candidateId: string) => Promise<boolean>

  // Manual correction
  manuallySetName: (
    meetingId: string,
    speakerId: string,
    name: string
  ) => Promise<SpeakerNameCandidate>

  // Suggestions
  getSuggestions: (meetingId: string) => Promise<SpeakerNameSuggestion[]>
  getMeetingSummary: (meetingId: string) => Promise<MeetingSpeakerNameSummary>

  // Detection events
  getDetectionEvents: (meetingId: string, limit?: number) => Promise<SpeakerNameDetectionEvent[]>

  // Configuration
  getConfig: () => Promise<SpeakerNameDetectionConfig>
  updateConfig: (config: Partial<SpeakerNameDetectionConfig>) => Promise<SpeakerNameDetectionConfig>
}
