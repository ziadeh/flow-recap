/**
 * Database Services Index
 *
 * Central export point for all database services
 */

// Import locally for use in this file
import { getDatabaseService as getDbService } from './database'
import { resetMeetingStatements as resetMeeting } from './meetingService'
import { resetRecordingStatements as resetRecording } from './recordingService'
import { resetTranscriptStatements as resetTranscript } from './transcriptService'
import { resetMeetingNoteStatements as resetMeetingNote } from './meetingNoteService'
import { resetTaskStatements as resetTask } from './taskService'
import { resetSpeakerStatements as resetSpeaker } from './speakerService'
import { resetSettingsStatements as resetSettings } from './settingsService'
import { resetMeetingSpeakerNameStatements as resetMeetingSpeakerName } from './meetingSpeakerNameService'
import { resetTranscriptCorrectionStatements as resetTranscriptCorrection } from './transcriptCorrectionService'
import { resetConfidenceScoringStatements as resetConfidenceScoring } from './confidenceScoringService'
import { resetMeetingDeletionStatements as resetMeetingDeletion } from './meetingDeletionService'
import { resetSpeakerNameDetectionStatements as resetSpeakerNameDetection } from './speakerNameDetectionService'
import { resetSubjectAwareNoteGenerationStatements as resetSubjectAwareNoteGeneration } from './subjectAwareNoteGenerationService'

// Core database service
export { getDatabaseService, DatabaseService, CURRENT_SCHEMA_VERSION, migrations } from './database'

// Entity services
export { meetingService, resetMeetingStatements } from './meetingService'
export { recordingService, resetRecordingStatements } from './recordingService'
export { transcriptService, resetTranscriptStatements } from './transcriptService'
export { meetingNoteService, resetMeetingNoteStatements } from './meetingNoteService'
export { taskService, resetTaskStatements } from './taskService'
export { speakerService, resetSpeakerStatements } from './speakerService'
export { meetingSpeakerNameService, resetMeetingSpeakerNameStatements } from './meetingSpeakerNameService'
export { settingsService, resetSettingsStatements, defaultSettings } from './settingsService'

// Audio recording service
export { audioRecorderService, resetAudioRecorderState } from './audioRecorderService'
export type {
  RecordingStatus,
  RecordingState,
  StartRecordingResult,
  StopRecordingResult,
  PauseRecordingResult,
  ResumeRecordingResult,
  AudioLevelData
} from './audioRecorderService'

// Audio device detection service
export { audioDeviceService } from './audioDeviceService'
export type {
  AudioDeviceType,
  VirtualCableType,
  DiagnosticStatus,
  AudioDevice,
  VirtualCableInfo,
  AudioDiagnosticResult,
  DiagnosticMessage,
  MicrophoneTestResult,
  AutoFixResult
} from './audioDeviceService'

// System audio capture service
export { systemAudioCaptureService, resetDualRecordingState } from './systemAudioCaptureService'
export type {
  DualRecordingStatus,
  AudioSourceType,
  AudioSource,
  DualRecordingState,
  DualRecordingConfig,
  StartDualRecordingResult,
  StopDualRecordingResult,
  SystemAudioCaptureCapabilities
} from './systemAudioCaptureService'

// ScreenCaptureKit service (macOS 13+ native app audio capture)
export { screenCaptureKitService, resetScreenCaptureKitState } from './screenCaptureKitService'
export type {
  ScreenCaptureKitStatus,
  ScreenCaptureKitCapabilities,
  CaptureableApp,
  ScreenCaptureKitConfig,
  StartCaptureResult,
  StopCaptureResult
} from './screenCaptureKitService'

// Audio mixer service
export { AudioMixer } from './audioMixer'
export type {
  AudioMixerConfig,
  AudioMixerState
} from './audioMixer'

// Binary manager service (sox, ffmpeg, etc.)
export { binaryManager } from './binaryManager'
export type {
  BinaryName,
  BinaryInfo,
  BinaryManagerConfig
} from './binaryManager'

// ML Pipeline service
export { mlPipelineService, resetMlPipelineState } from './mlPipeline'
export type {
  PipelinePhase,
  ModelSize,
  DeviceType,
  TranscriptionConfig,
  DiarizationConfig,
  TranscriptionSegment,
  TranscriptionResult,
  DiarizationSegment,
  DiarizationResult,
  CombinedSegment,
  PipelineProgress,
  PipelineStatus
} from './mlPipeline'

// Live Transcription service
export { liveTranscriptionService, resetLiveTranscriptionState } from './liveTranscriptionService'
export type {
  LiveTranscriptionStatus,
  LiveTranscriptionConfig,
  LiveTranscriptSegment,
  TranscribeChunkResult,
  LiveTranscriptionProgress,
  LiveTranscriptionState
} from './liveTranscriptionService'

// Diarization service
export { diarizationService, resetDiarizationServiceState, getSpeakerColor, parseSpeakerIndex } from './diarizationService'
export type {
  DiarizationSpeaker,
  DiarizationJobResult,
  AlignmentOptions
} from './diarizationService'

// Speaker Diarization service (comprehensive diarization system)
export { speakerDiarizationService, resetSpeakerDiarizationState } from './speakerDiarizationService'
export type {
  DiarizationStatus as SpeakerDiarizationStatus,
  ClusteringMethod,
  DiarizationConfig as SpeakerDiarizationConfig,
  DiarizationSegment as SpeakerDiarizationSegment,
  SpeakerStats,
  QualityMetrics as DiarizationQualityMetrics,
  DiarizationResult as SpeakerDiarizationResult,
  DiarizationProgress as SpeakerDiarizationProgress,
  StreamingDiarizationConfig
} from './speakerDiarizationService'

// Batch Diarization service (retroactive speaker processing)
export { batchDiarizationService } from './batchDiarizationService'
export type {
  BatchDiarizationProgress,
  BatchDiarizationResult,
  BatchDiarizationOptions
} from './batchDiarizationService'

// Core Diarization Engine service (MANDATORY preprocessing stage)
export {
  coreDiarizationService,
  DiarizationRequiredError
} from './coreDiarizationService'
export type {
  CoreDiarizationSegment,
  CoreDiarizationResult,
  CoreDiarizationConfig,
  CoreDiarizationStatus,
  DiarizationEvent
} from './coreDiarizationService'

// Diarization Output Schema (MANDATORY output format for all downstream systems)
export {
  DiarizationOutputError,
  DiarizationErrorCodes,
  DIARIZATION_SCHEMA_VERSION,
  validateSegment,
  validateSpeakerIdConsistency,
  validateDiarizationOutput,
  createSpeakerIdRegistry,
  getOrCreateSpeakerId,
  updateSpeakerMetadata,
  applyRetroactiveSpeakerCorrection,
  detectOverlappingSegments,
  splitOverlappingSegments,
  createDiarizationOutput,
  createFailedDiarizationOutput,
  preventSingleSpeakerFallback
} from './diarizationOutputSchema'
export type {
  MandatoryDiarizationSegment,
  OverlappingDiarizationSegment,
  DiarizationOutput,
  DiarizationErrorDetails,
  SpeakerIdRegistry,
  SpeakerMetadata,
  SpeakerCorrectionRecord,
  ValidationResult,
  ValidationError,
  ValidationWarning,
  DiarizationErrorCode
} from './diarizationOutputSchema'

// Diarization Telemetry service (tracks success/failure rates)
export {
  diarizationTelemetryService,
  resetDiarizationTelemetryState,
  DIARIZATION_FAILURE_MESSAGE
} from './diarizationTelemetryService'
export type {
  DiarizationOperationType,
  DiarizationOutcome,
  DiarizationFailureCategory,
  DiarizationTelemetryEvent,
  DiarizationTelemetryStats,
  DiarizationTelemetryConfig
} from './diarizationTelemetryService'

// Diarization-First Pipeline (MANDATORY diarization before transcription)
export {
  diarizationFirstPipeline,
  resetDiarizationFirstPipelineState
} from './diarizationFirstPipeline'
export type {
  DiarizationFirstPipelinePhase,
  DiarizationFirstPipelineConfig,
  DiarizationFirstPipelineProgress,
  DiarizationFirstPipelineResult
} from './diarizationFirstPipeline'

// Streaming Diarization service (real-time speaker diarization during live recording)
export { streamingDiarizationService, resetStreamingDiarizationState } from './streamingDiarizationService'
export type {
  StreamingDiarizationStatus,
  StreamingDiarizationConfig,
  SpeakerSegment,
  SpeakerChangeEvent,
  StreamingDiarizationState,
  SpeakerStats as StreamingSpeakerStats,
  RetroactiveCorrectionEvent
} from './streamingDiarizationService'

// Diarization Failure Service (explicit failure detection and user notification)
export { diarizationFailureService, DIARIZATION_FAILURE_MESSAGE as EXPLICIT_FAILURE_MESSAGE } from './diarizationFailureService'
export type {
  DiarizationFailureType,
  FailureSeverity,
  RemediationStep,
  DiarizationFailure,
  DiarizationFailureNotification,
  DiarizationPreference
} from './diarizationFailureService'

// Temporal Alignment Service (aligns transcription with diarization)
export { temporalAlignmentService } from './temporalAlignmentService'
export type {
  TranscriptionSegmentInput,
  AlignedTranscriptSegment,
  DiarizationValidationResult,
  TemporalAlignmentConfig
} from './temporalAlignmentService'

// Diarization-Aware Transcript Pipeline (ensures speaker ID from diarization)
export {
  diarizationAwareTranscriptPipeline,
  NoDiarizationDataError,
  resetDiarizationAwareTranscriptPipelineState
} from './diarizationAwareTranscriptPipeline'
export type {
  DiarizationAwarePipelineStatus,
  DiarizationAwarePipelineConfig,
  DiarizationAwarePipelineProgress,
  DiarizationAwarePipelineResult
} from './diarizationAwareTranscriptPipeline'

// Transcript Service extended types
export { MissingSpeakerIdError } from './transcriptService'
export type {
  CreateTranscriptWithSpeakerInput,
  TranscriptCreationOptions
} from './transcriptService'

// LLM Post-Processing Service (LM Studio-based speaker consistency)
export { llmPostProcessingService, resetLLMPostProcessingState } from './llmPostProcessingService'
export type {
  LMStudioConfig,
  ConfidenceThresholds,
  SpeakerIdentityMapping,
  OverlapResolution,
  LowConfidenceResolution,
  SpeakerDisplayOrder,
  SpeakerAwareSummaryItem,
  LLMPostProcessingResult,
  GuardrailViolation
} from './llmPostProcessingService'

// LM Studio Client Service (HTTP communication with LM Studio/Ollama)
export { lmStudioClient, createLMStudioClient, resetLMStudioClientState } from './lm-studio-client'
export type {
  LLMBackendType,
  LMStudioClientConfig,
  HealthStatus,
  LLMModel,
  ChatMessage,
  ChatCompletionRequest,
  TokenUsage,
  ChatCompletionResponse,
  BackendInfo,
  ClientResponse,
  ConnectionErrorType,
  ConnectionError
} from './lm-studio-client'

// LLM Provider Abstraction Layer (unified interface for multiple LLM backends)
export {
  // Provider Manager (main entry point)
  llmProviderManager,
  initializeLLMProviderManager,
  getProvider,
  getDefaultProvider,
  detectProviders,
  resetProviders,
  disposeProviders,

  // Routing Service (intelligent routing with fallback)
  llmRoutingService,
  initializeLLMRoutingService,
  getRoutingService,
  resetRoutingService,

  // Provider Factory
  llmProviderFactory,
  createProvider,
  createDefaultProvider,
  registerCustomProvider,
  getAvailableProviderTypes,
  getProviderDefaultConfig,
  resetFactory,

  // Provider Adapters
  LMStudioAdapter,
  createLMStudioAdapter,
  defaultLMStudioAdapter,
  OllamaAdapter,
  createOllamaAdapter,

  // Constants
  DEFAULT_FALLBACK_CONFIG
} from './llm'

export type {
  // Provider types
  LLMProviderType,
  ProviderPriority,
  ProviderAvailability,

  // Configuration types
  LLMProviderConfig,
  LocalProviderConfig,
  CloudProviderConfig,

  // Provider interface
  ILLMProvider,

  // Request/Response types
  ChatCompletionParams,
  ProviderResult,
  ProviderHealthResult,
  ProviderModelsResult,
  ProviderChatResult,
  ProviderSimpleChatResult,

  // Registration types
  ProviderRegistration,
  ProviderSelectionCriteria,

  // Event types
  ProviderEventType,
  ProviderEvent,
  ProviderEventListener,

  // Fallback types
  FallbackConfig,

  // Detection types
  ProviderDetectionResult,
  ProviderDetectionOptions,

  // Manager config
  LLMProviderManagerConfig,

  // Factory types
  ProviderConstructor,

  // Routing types
  FallbackEvent,
  RoutingResult,
  RoutingConfig
} from './llm'

// Post-Recording Processor Service (automatic diarization after recording)
export { postRecordingProcessor, processRecording } from './postRecordingProcessor'
export type {
  PostRecordingOptions,
  PostRecordingResult
} from './postRecordingProcessor'

// Meeting Summary Service (LLM-based meeting summarization)
export { meetingSummaryService, resetMeetingSummaryConfig } from './meetingSummaryService'
export type {
  SummaryGenerationConfig,
  StructuredSummary,
  SummaryGenerationResult
} from './meetingSummaryService'

// Action Items Extraction Service (LLM-based action items extraction)
export { actionItemsService, resetActionItemsConfig } from './actionItemsService'
export type {
  ActionItemsExtractionConfig,
  ExtractedActionItem,
  ActionItemsExtractionResponse,
  ActionItemsExtractionResult
} from './actionItemsService'

// Decisions and Topics Extraction Service (LLM-based decisions, key points, and topics with sentiment)
export { decisionsAndTopicsService, resetDecisionsAndTopicsConfig } from './decisionsAndTopicsService'
export type {
  SentimentType,
  DecisionsAndTopicsConfig,
  ExtractedDecision,
  ExtractedKeyPoint,
  ExtractedTopic,
  DecisionsAndTopicsExtractionResult,
  ExtractionProcessResult
} from './decisionsAndTopicsService'

// Unified Insights Service (single button for all insights generation)
export { unifiedInsightsService } from './unifiedInsightsService'
export type {
  InsightSection,
  SectionProgress,
  UnifiedGenerationProgress,
  UnifiedInsightsConfig,
  ExistingInsightsCounts,
  SectionResult,
  UnifiedInsightsResult
} from './unifiedInsightsService'

// Orchestrated Insights Service (single-pass LLM generation for consistency)
export { orchestratedInsightsService } from './orchestratedInsightsService'
export type {
  ProgressStage,
  OrchestrationProgress,
  LLMResponseMetadata,
  OverviewSection,
  InsightsSection,
  OrchestratedResponse,
  OrchestrationConfig,
  OrchestrationResult
} from './orchestratedInsightsService'

// WAV File Utilities (header validation and fixing)
export {
  validateWavFile,
  fixWavFileHeader,
  ensureValidWavHeader,
  getWavDuration
} from './wavUtils'
export type { WavFileInfo } from './wavUtils'

// Export Service (PDF and Markdown export)
export { exportService, resetExportConfig } from './exportService'
export type {
  ExportFormat,
  ExportConfig,
  ExportResult
} from './exportService'

// Logger Service (electron-log based logging)
export { loggerService } from './loggerService'
export type { LogContext } from './loggerService'

// Update Service (automatic updates using electron-updater)
export { updateService, resetUpdateServiceState } from './updateService'
export type {
  UpdateStatus,
  UpdateState,
  UpdateCheckResult,
  RollbackInfo
} from './updateService'

// LLM Health Check Service (periodic health monitoring for LLM providers)
export {
  llmHealthCheckService,
  startHealthChecks,
  stopHealthChecks,
  runHealthCheck,
  getHealthSummary,
  getProviderTroubleshootingGuidance,
  resetHealthCheckService
} from './llmHealthCheckService'
export type {
  ProviderHealthStatus,
  HealthCheckEvent,
  HealthCheckConfig,
  HealthSummary,
  HealthStatusCallback
} from './llmHealthCheckService'

// Live Note Generation Service (real-time meeting notes during recording)
export { liveNoteGenerationService } from './liveNoteGenerationService'
export type {
  LiveNoteType,
  LiveNoteItem,
  TranscriptSegmentInput as LiveNoteTranscriptInput,
  LiveNoteGenerationConfig,
  LiveNoteGenerationResult,
  LiveNoteSessionState
} from './liveNoteGenerationService'

// Subject-Aware Note Generation Service (intelligent two-pass note generation)
export {
  subjectAwareNoteGenerationService,
  resetSubjectAwareNoteGenerationStatements
} from './subjectAwareNoteGenerationService'
export type {
  StrictnessMode,
  RelevanceType,
  SubjectStatus,
  SessionStatus as SubjectAwareSessionStatus,
  CandidateNoteType,
  MeetingSubject,
  SubjectHistory,
  TranscriptChunk,
  RelevanceLabel,
  NoteCandidate,
  TranscriptSegmentInput as SubjectAwareTranscriptInput,
  SubjectAwareConfig,
  SubjectAwareSessionState,
  SubjectDetectionResult,
  RelevanceScoringResult,
  CandidateExtractionResult,
  FinalizationResult
} from './subjectAwareNoteGenerationService'

// Live Insights Persistence Service (automatic persistence of live notes)
export { getLiveInsightsPersistenceService } from './liveInsightsPersistenceService'
export type {
  PersistenceResult,
  LiveInsightsSummary
} from './liveInsightsPersistenceService'

// Transcript Correction Service (AI-assisted transcription correction)
export { transcriptCorrectionService, resetTranscriptCorrectionStatements } from './transcriptCorrectionService'
export type {
  CorrectionStatus,
  CorrectionTrigger,
  TextChange,
  TranscriptCorrection,
  CreateTranscriptCorrectionInput,
  CorrectionConfig,
  CorrectionResult,
  BatchCorrectionResult
} from './transcriptCorrectionService'

// Confidence Scoring Service (transcription quality metrics and trend analysis)
export {
  confidenceScoringService,
  resetConfidenceScoringStatements,
  DEFAULT_CONFIDENCE_THRESHOLDS,
  DEFAULT_CONFIDENCE_CONFIG,
  CONFIDENCE_COLORS
} from './confidenceScoringService'
export type {
  ConfidenceLevel,
  ConfidenceThresholds as ConfidenceScoringThresholds,
  ConfidenceAlertType,
  ConfidenceMetrics,
  ConfidenceTrend,
  ConfidenceAdjustment,
  SegmentConfidenceInfo,
  MeetingConfidenceSummary,
  ConfidenceAlert,
  ConfidenceScoringConfig
} from './confidenceScoringService'

// Meeting Deletion Service (comprehensive meeting deletion with cleanup)
export { meetingDeletionService, resetMeetingDeletionStatements } from './meetingDeletionService'
export type {
  DeletionPreview,
  DeletionResult,
  BatchDeletionResult,
  ArchiveResult,
  RestoreResult,
  SoftDeletedMeeting,
  AuditLogEntry,
  DeletionOptions
} from './meetingDeletionService'

// Storage Management Service (storage analysis, cleanup, and optimization)
export { storageManagementService, resetStorageManagementStatements } from './storageManagementService'
export type {
  MeetingStorageInfo,
  StorageBreakdown,
  StorageUsageResult,
  StorageTrendPoint,
  CleanupCriteria,
  CleanupPreview,
  CleanupResult
} from './storageManagementService'

// Export & Delete Service (export meetings before deletion with various formats)
export { exportDeleteService } from './exportDeleteService'

// Speaker Name Detection Service (intelligent speaker name identification)
export {
  speakerNameDetectionService,
  resetSpeakerNameDetectionStatements,
  resetSpeakerNameDetectionConfig,
  clearRecentNameMentions,
  DEFAULT_SPEAKER_NAME_DETECTION_CONFIG
} from './speakerNameDetectionService'

// Data Migration Service (legacy data migration for rebranding)
export { dataMigrationService } from './dataMigrationService'
export type {
  MigrationCheckResult,
  MigrationSummary,
  LegacyPathInfo,
  MigrationProgress,
  MigrationResult,
  ValidationResult,
  RollbackResult,
  CleanupResult,
  MigrationStatus
} from './dataMigrationService'

// Model Manager service (ML model downloads and bundling)
export { modelManager, ModelManagerService } from './modelManager'
export type {
  ModelInfo,
  ModelStatus,
  DownloadProgress,
  PyannoteModelsStatus
} from './modelManager'

// Python Environment Validator (Python environment diagnostics and validation)
export { pythonEnvironmentValidator, PythonEnvironmentValidatorService } from './pythonEnvironmentValidator'
export type {
  ValidationCheckType,
  ValidationStatus,
  ValidationCheck,
  ValidationResult,
  AutoRepairResult,
  EnvironmentReadiness,
  CheckCriticality
} from './pythonEnvironmentValidator'

// Tiered Validation Service (progressive validation that spreads checks over time)
export { tieredValidationService, TieredValidationService } from './tieredValidationService'
export type {
  ValidationTier,
  ValidationLevel,
  TieredValidationStatus,
  TierResult,
  TieredValidationState,
  ValidationMetrics,
  TieredValidationResult
} from './tieredValidationService'

// Python Setup Service (automated environment creation and configuration)
export { pythonSetupService, PythonSetupService } from './pythonSetupService'
export type {
  SetupStep,
  SetupProgress,
  SetupOptions,
  SetupResult,
  EnvironmentInfo,
  EnvironmentMetadata,
  SetupStatus,
  SetupState
} from './pythonSetupService'

// Python Execution Manager (centralized Python script execution with intelligent routing)
export { pythonExecutionManager, PythonExecutionManagerService } from './pythonExecutionManager'
export type {
  PythonOperationType,
  PythonEnvironmentType as PythonExecEnvironmentType,
  EnvironmentHealthStatus,
  PythonExecutionManagerStatus,
  ExecutionOptions,
  ExecutionResult,
  RepairResult
} from './pythonExecutionManager'

// Re-export types for convenience
export type {
  Meeting,
  MeetingStatus,
  MeetingType,
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
  CreateMeetingSpeakerNameInput,
  UpdateMeetingSpeakerNameInput,
  Setting,
  SettingCategory,
  CreateSettingInput,
  DatabaseAPI,
  DatabaseStats,
  Migration,
  MigrationRecord,
  // Speaker Name Detection types
  SpeakerNameDetectionType,
  SpeakerNameDetectionEventType,
  NameConfidenceLevel,
  SpeakerNameCandidate,
  CreateSpeakerNameCandidateInput,
  UpdateSpeakerNameCandidateInput,
  SpeakerNameDetectionEvent,
  CreateSpeakerNameDetectionEventInput,
  NameDetectionResult,
  SpeakerNameDetectionConfig,
  SpeakerNameSuggestion,
  MeetingSpeakerNameSummary,
  SpeakerNameDetectionAPI
} from '../../src/types/database'

/**
 * Initialize all database services
 *
 * Call this once when the application starts
 */
export function initializeDatabase(customPath?: string): void {
  const dbService = getDbService()
  dbService.initialize(customPath)
}

/**
 * Reset all prepared statement caches
 *
 * Call this if you need to reinitialize the database connection
 */
export function resetAllStatements(): void {
  resetMeeting()
  resetRecording()
  resetTranscript()
  resetMeetingNote()
  resetTask()
  resetSpeaker()
  resetMeetingSpeakerName()
  resetSettings()
  resetTranscriptCorrection()
  resetConfidenceScoring()
  resetMeetingDeletion()
  resetSpeakerNameDetection()
  resetSubjectAwareNoteGeneration()
}

/**
 * Close database and cleanup
 */
export function closeDatabase(): void {
  resetAllStatements()
  getDbService().close()
}
