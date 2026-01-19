/**
 * Diarization Services Bundle
 *
 * This module contains all services related to speaker diarization and identification.
 * It's lazy-loaded only when diarization is needed, reducing initial bundle size.
 *
 * Services in this bundle (~1.2MB):
 * - speakerDiarizationService: Comprehensive speaker diarization system
 * - batchDiarizationService: Retroactive speaker processing
 * - coreDiarizationService: Mandatory preprocessing stage
 * - streamingDiarizationService: Real-time speaker diarization
 * - diarizationFailureService: Failure detection and notification
 * - llmPostProcessingService: Speaker consistency post-processing
 *
 * Heavy dependencies:
 * - PyTorch: ML framework for model inference
 * - pyannote.audio: Speaker diarization models
 * - pythonExecutionManager: Python script execution
 */

// Re-export all diarization-related services
export {
  speakerDiarizationService,
  resetSpeakerDiarizationState,
} from './speakerDiarizationService'
export type {
  DiarizationStatus,
  ClusteringMethod,
  DiarizationConfig,
  DiarizationSegment,
  SpeakerStats,
  QualityMetrics,
  DiarizationResult,
  DiarizationProgress,
  StreamingDiarizationConfig,
} from './speakerDiarizationService'

export {
  batchDiarizationService,
} from './batchDiarizationService'
export type {
  BatchDiarizationProgress,
  BatchDiarizationResult,
  BatchDiarizationOptions,
} from './batchDiarizationService'

export {
  coreDiarizationService,
  DiarizationRequiredError,
} from './coreDiarizationService'
export type {
  CoreDiarizationSegment,
  CoreDiarizationResult,
  CoreDiarizationConfig,
  CoreDiarizationStatus,
  DiarizationEvent,
} from './coreDiarizationService'

export {
  streamingDiarizationService,
  resetStreamingDiarizationState,
} from './streamingDiarizationService'
export type {
  StreamingDiarizationStatus,
  SpeakerSegment,
  SpeakerChangeEvent,
  StreamingDiarizationState,
  RetroactiveCorrectionEvent,
} from './streamingDiarizationService'

export {
  diarizationFailureService,
  DIARIZATION_FAILURE_MESSAGE,
} from './diarizationFailureService'
export type {
  DiarizationFailureType,
  FailureSeverity,
  RemediationStep,
  DiarizationFailure,
  DiarizationFailureNotification,
  DiarizationPreference,
} from './diarizationFailureService'

export {
  llmPostProcessingService,
  resetLLMPostProcessingState,
} from './llmPostProcessingService'
export type {
  LMStudioConfig,
  ConfidenceThresholds,
  SpeakerIdentityMapping,
  OverlapResolution,
  LowConfidenceResolution,
  SpeakerDisplayOrder,
  SpeakerAwareSummaryItem,
  LLMPostProcessingResult,
  GuardrailViolation,
} from './llmPostProcessingService'

// Additional diarization utilities
export {
  diarizationService,
  resetDiarizationServiceState,
  getSpeakerColor,
  parseSpeakerIndex,
} from './diarizationService'
export type {
  DiarizationSpeaker,
  DiarizationJobResult,
  AlignmentOptions,
} from './diarizationService'

export {
  temporalAlignmentService,
} from './temporalAlignmentService'
export type {
  TranscriptionSegmentInput,
  AlignedTranscriptSegment,
  DiarizationValidationResult,
  TemporalAlignmentConfig,
} from './temporalAlignmentService'

export {
  diarizationAwareTranscriptPipeline,
  NoDiarizationDataError,
  resetDiarizationAwareTranscriptPipelineState,
} from './diarizationAwareTranscriptPipeline'
export type {
  DiarizationAwarePipelineStatus,
  DiarizationAwarePipelineConfig,
  DiarizationAwarePipelineProgress,
  DiarizationAwarePipelineResult,
} from './diarizationAwareTranscriptPipeline'

export {
  diarizationFirstPipeline,
  resetDiarizationFirstPipelineState,
} from './diarizationFirstPipeline'
export type {
  DiarizationFirstPipelinePhase,
  DiarizationFirstPipelineConfig,
  DiarizationFirstPipelineProgress,
  DiarizationFirstPipelineResult,
} from './diarizationFirstPipeline'

export {
  diarizationTelemetryService,
  resetDiarizationTelemetryState,
  DIARIZATION_FAILURE_MESSAGE as TELEMETRY_FAILURE_MESSAGE,
} from './diarizationTelemetryService'
export type {
  DiarizationOperationType,
  DiarizationOutcome,
  DiarizationFailureCategory,
  DiarizationTelemetryEvent,
  DiarizationTelemetryStats,
  DiarizationTelemetryConfig,
} from './diarizationTelemetryService'

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
  preventSingleSpeakerFallback,
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
  DiarizationErrorCode,
} from './diarizationOutputSchema'
