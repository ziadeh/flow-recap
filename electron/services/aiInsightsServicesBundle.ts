/**
 * AI/Insights Services Bundle
 *
 * This module contains all services related to AI-powered insights and note generation.
 * It's lazy-loaded only when viewing insights, reducing initial bundle size.
 *
 * Services in this bundle (~500KB):
 * - meetingSummaryService: Generate meeting summaries
 * - actionItemsService: Extract action items from transcripts
 * - decisionsAndTopicsService: Identify decisions and key topics
 * - unifiedInsightsService: Combined insights generation
 * - orchestratedInsightsService: Single-pass LLM insights generation
 * - liveNoteGenerationService: Real-time note generation during recording
 * - subjectAwareNoteGenerationService: Context-aware note generation
 * - llmPostProcessingService: Speaker consistency post-processing
 */

// Re-export all AI/Insights-related services
export {
  meetingSummaryService,
  resetMeetingSummaryConfig,
} from './meetingSummaryService'
export type {
  SummaryGenerationConfig,
  StructuredSummary,
  SummaryGenerationResult,
} from './meetingSummaryService'

export {
  actionItemsService,
  resetActionItemsConfig,
} from './actionItemsService'
export type {
  ActionItemsExtractionConfig,
  ExtractedActionItem,
  ActionItemsExtractionResponse,
  ActionItemsExtractionResult,
} from './actionItemsService'

export {
  decisionsAndTopicsService,
  resetDecisionsAndTopicsConfig,
} from './decisionsAndTopicsService'
export type {
  SentimentType,
  DecisionsAndTopicsConfig,
  ExtractedDecision,
  ExtractedKeyPoint,
  ExtractedTopic,
  DecisionsAndTopicsExtractionResult,
  ExtractionProcessResult,
} from './decisionsAndTopicsService'

export {
  unifiedInsightsService,
} from './unifiedInsightsService'
export type {
  InsightSection,
  SectionProgress,
  UnifiedGenerationProgress,
  UnifiedInsightsConfig,
  ExistingInsightsCounts,
  SectionResult,
  UnifiedInsightsResult,
} from './unifiedInsightsService'

export {
  orchestratedInsightsService,
} from './orchestratedInsightsService'
export type {
  ProgressStage,
  OrchestrationProgress,
  LLMResponseMetadata,
  OverviewSection,
  InsightsSection,
  OrchestratedResponse,
  OrchestrationConfig,
  OrchestrationResult,
} from './orchestratedInsightsService'

export {
  liveNoteGenerationService,
} from './liveNoteGenerationService'
export type {
  LiveNoteType,
  LiveNoteItem,
  TranscriptSegmentInput as LiveNoteTranscriptInput,
  LiveNoteGenerationConfig,
  LiveNoteGenerationResult,
  LiveNoteSessionState,
} from './liveNoteGenerationService'

export {
  subjectAwareNoteGenerationService,
  resetSubjectAwareNoteGenerationStatements,
} from './subjectAwareNoteGenerationService'
export type {
  StrictnessMode,
  RelevanceType,
  SubjectStatus,
  SessionStatus,
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
  FinalizationResult,
} from './subjectAwareNoteGenerationService'

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
