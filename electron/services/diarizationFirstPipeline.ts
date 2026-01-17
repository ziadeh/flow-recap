/**
 * Diarization-First Pipeline Service
 *
 * Enforces mandatory diarization-first architecture where speaker diarization
 * is a BLOCKING stage that must complete before transcription.
 *
 * Pipeline Flow:
 *   Audio Capture -> Speaker Diarization Engine -> Structured Speaker Segments
 *                      -> (Optional) Transcription -> UI/Storage
 *
 * CRITICAL REQUIREMENTS:
 * 1. Diarization MUST complete before transcription begins
 * 2. Validation checkpoints verify diarization output exists and is valid
 * 3. If diarization fails, system MUST halt and display explicit error
 * 4. Silent fallback to single-speaker mode is PREVENTED
 * 5. Telemetry tracks diarization success/failure rates
 */

import { EventEmitter } from 'events'
import { randomUUID } from 'crypto'
import * as fs from 'fs'

// Import services
import { mlPipelineService, TranscriptionConfig, DiarizationConfig, TranscriptionResult, DiarizationResult, CombinedSegment } from './mlPipeline'
import { coreDiarizationService, DiarizationRequiredError, DiarizationSegment as CoreDiarizationSegment } from './coreDiarizationService'
import {
  validateDiarizationOutput,
  DiarizationErrorCodes,
  DiarizationOutputError,
  createFailedDiarizationOutput,
  MandatoryDiarizationSegment,
  DiarizationOutput
} from './diarizationOutputSchema'
import {
  diarizationTelemetryService,
  DIARIZATION_FAILURE_MESSAGE
} from './diarizationTelemetryService'
import { llmPostProcessingService } from './llmPostProcessingService'

// ============================================================================
// Types
// ============================================================================

/**
 * Pipeline execution phases
 */
export type DiarizationFirstPipelinePhase =
  | 'idle'
  | 'validating_audio'
  | 'diarization'
  | 'diarization_validation'
  | 'transcription'
  | 'combining'
  | 'completed'
  | 'error'
  | 'blocked'

/**
 * Configuration for the diarization-first pipeline
 */
export interface DiarizationFirstPipelineConfig {
  /** Transcription configuration */
  transcription?: TranscriptionConfig
  /** Diarization configuration */
  diarization?: DiarizationConfig
  /** Whether to skip transcription (diarization-only mode) */
  diarizationOnly?: boolean
  /** Whether to require diarization (fail if unavailable) */
  requireDiarization?: boolean
  /** Timeout for diarization in milliseconds */
  diarizationTimeoutMs?: number
  /** Minimum audio duration in seconds */
  minAudioDuration?: number
}

/**
 * Progress update from the pipeline
 */
export interface DiarizationFirstPipelineProgress {
  jobId: string
  phase: DiarizationFirstPipelinePhase
  progress: number
  message: string
  timestamp: number
  /** If blocked, contains the error information */
  blockingError?: {
    code: string
    message: string
    displayMessage: string
  }
}

/**
 * Result from the diarization-first pipeline
 */
export interface DiarizationFirstPipelineResult {
  success: boolean
  /** Whether diarization was performed successfully */
  diarizationSuccess: boolean
  /** Whether transcription was performed (may be skipped) */
  transcriptionPerformed: boolean
  /** Structured speaker segments from diarization */
  speakerSegments: MandatoryDiarizationSegment[]
  /** Transcription result (if performed) */
  transcription?: TranscriptionResult
  /** Combined segments with speaker labels (if transcription performed) */
  combinedSegments: CombinedSegment[]
  /** Number of speakers detected */
  numSpeakers: number
  /** List of speaker IDs */
  speakerIds: string[]
  /** Processing metadata */
  metadata: {
    audioFile: string
    audioDuration: number
    diarizationTimeMs: number
    transcriptionTimeMs: number
    totalTimeMs: number
    pipelineVersion: string
  }
  /** Error information if failed */
  error?: {
    code: string
    message: string
    displayMessage: string
    phase: DiarizationFirstPipelinePhase
  }
}

/**
 * Checkpoint validation result
 */
interface CheckpointResult {
  passed: boolean
  errors: string[]
  warnings: string[]
}

// ============================================================================
// Constants
// ============================================================================

const PIPELINE_VERSION = '1.0.0'
const DEFAULT_DIARIZATION_TIMEOUT = 300000 // 5 minutes
const DEFAULT_MIN_AUDIO_DURATION = 1.0 // 1 second
const PROGRESS_EVENT = 'diarization-first-pipeline:progress'

// ============================================================================
// Service State
// ============================================================================

const progressEmitter = new EventEmitter()
const activeJobs = new Map<string, {
  phase: DiarizationFirstPipelinePhase
  startTime: number
  audioPath: string
}>()

// ============================================================================
// Validation Checkpoints
// ============================================================================

/**
 * Checkpoint 1: Validate audio file before processing
 */
function validateAudioFile(audioPath: string, config: DiarizationFirstPipelineConfig): CheckpointResult {
  const errors: string[] = []
  const warnings: string[] = []

  if (!fs.existsSync(audioPath)) {
    errors.push(`Audio file not found: ${audioPath}`)
    return { passed: false, errors, warnings }
  }

  const stats = fs.statSync(audioPath)

  if (stats.size === 0) {
    errors.push('Audio file is empty')
    return { passed: false, errors, warnings }
  }

  // Estimate duration (rough estimate based on 16kHz mono 16-bit)
  const estimatedDuration = stats.size / (16000 * 2) // bytes / (sample_rate * bytes_per_sample)
  const minDuration = config.minAudioDuration || DEFAULT_MIN_AUDIO_DURATION

  if (estimatedDuration < minDuration) {
    warnings.push(`Audio duration (~${estimatedDuration.toFixed(1)}s) may be too short for accurate diarization`)
  }

  return { passed: true, errors, warnings }
}

/**
 * Checkpoint 2: Validate diarization output before proceeding to transcription
 */
function validateDiarizationCheckpoint(
  result: DiarizationResult | null,
  speakerSegments: MandatoryDiarizationSegment[]
): CheckpointResult {
  const errors: string[] = []
  const warnings: string[] = []

  // Check if diarization succeeded
  if (!result || !result.success) {
    errors.push('Diarization did not produce successful result')
    return { passed: false, errors, warnings }
  }

  // Check for segments
  if (!speakerSegments || speakerSegments.length === 0) {
    errors.push('Diarization produced no speaker segments')
    return { passed: false, errors, warnings }
  }

  // Check for valid speakers
  if (!result.speakers || result.speakers.length === 0) {
    errors.push('Diarization detected no speakers')
    return { passed: false, errors, warnings }
  }

  // Check for single-speaker fallback attempt
  if (result.numSpeakers === 1 && result.speakers.length === 1) {
    warnings.push('Only one speaker detected - verify this is correct')
  }

  // Validate output schema
  const diarizationOutput: DiarizationOutput = {
    success: true,
    segments: speakerSegments,
    speaker_ids: result.speakers,
    num_speakers: result.numSpeakers,
    audio_duration: 0, // Will be filled later
    processing_time: 0, // Will be filled later
    schema_version: '1.0.0'
  }

  const validation = validateDiarizationOutput(diarizationOutput)

  if (!validation.valid) {
    errors.push(...validation.errors.map(e => `${e.field}: ${e.message}`))
  }

  if (validation.warnings.length > 0) {
    warnings.push(...validation.warnings.map(w => `${w.field}: ${w.message}`))
  }

  return { passed: errors.length === 0, errors, warnings }
}

/**
 * Checkpoint 3: Validate combined output before completion
 */
function validateFinalOutput(
  combinedSegments: CombinedSegment[],
  speakerSegments: MandatoryDiarizationSegment[]
): CheckpointResult {
  const errors: string[] = []
  const warnings: string[] = []

  // All segments should have speaker labels
  const segmentsWithoutSpeaker = combinedSegments.filter(s => !s.speaker)
  if (segmentsWithoutSpeaker.length > 0) {
    const percentage = (segmentsWithoutSpeaker.length / combinedSegments.length) * 100
    if (percentage > 50) {
      errors.push(`${percentage.toFixed(0)}% of transcript segments have no speaker label`)
    } else if (percentage > 20) {
      warnings.push(`${percentage.toFixed(0)}% of transcript segments have no speaker label`)
    }
  }

  return { passed: errors.length === 0, errors, warnings }
}

// ============================================================================
// Pipeline Implementation
// ============================================================================

/**
 * Emit progress update
 */
function emitProgress(
  jobId: string,
  phase: DiarizationFirstPipelinePhase,
  progress: number,
  message: string,
  blockingError?: { code: string; message: string; displayMessage: string }
): void {
  const payload: DiarizationFirstPipelineProgress = {
    jobId,
    phase,
    progress: Math.min(100, Math.max(0, progress)),
    message,
    timestamp: Date.now(),
    blockingError
  }
  progressEmitter.emit(PROGRESS_EVENT, payload)
}

/**
 * Convert diarization segments to mandatory schema format
 */
function convertToMandatorySegments(
  diarizationResult: DiarizationResult
): MandatoryDiarizationSegment[] {
  return diarizationResult.segments.map(seg => ({
    speaker_id: seg.speaker.replace('Speaker_', 'SPEAKER_'),
    start_time: seg.start,
    end_time: seg.end,
    confidence: 0.8 // Default confidence since pyannote doesn't always provide this
  }))
}

/**
 * Create blocking error result
 */
function createBlockingResult(
  audioPath: string,
  phase: DiarizationFirstPipelinePhase,
  errorCode: string,
  errorMessage: string,
  startTime: number
): DiarizationFirstPipelineResult {
  return {
    success: false,
    diarizationSuccess: false,
    transcriptionPerformed: false,
    speakerSegments: [],
    combinedSegments: [],
    numSpeakers: 0,
    speakerIds: [],
    metadata: {
      audioFile: audioPath,
      audioDuration: 0,
      diarizationTimeMs: Date.now() - startTime,
      transcriptionTimeMs: 0,
      totalTimeMs: Date.now() - startTime,
      pipelineVersion: PIPELINE_VERSION
    },
    error: {
      code: errorCode,
      message: errorMessage,
      displayMessage: DIARIZATION_FAILURE_MESSAGE,
      phase
    }
  }
}

// ============================================================================
// Diarization-First Pipeline Service
// ============================================================================

export const diarizationFirstPipeline = {
  /**
   * Process audio through the diarization-first pipeline
   *
   * This enforces the mandatory diarization stage before transcription.
   * If diarization fails, the pipeline will BLOCK and return an error
   * instead of silently falling back to single-speaker mode.
   *
   * @param audioPath Path to the audio file
   * @param config Pipeline configuration
   * @param onProgress Progress callback
   * @returns Pipeline result with structured speaker segments
   */
  async process(
    audioPath: string,
    config: DiarizationFirstPipelineConfig = {},
    onProgress?: (progress: DiarizationFirstPipelineProgress) => void
  ): Promise<DiarizationFirstPipelineResult> {
    const jobId = randomUUID()
    const startTime = Date.now()

    activeJobs.set(jobId, {
      phase: 'validating_audio',
      startTime,
      audioPath
    })

    // Set up progress listener
    let unsubscribe: (() => void) | null = null
    if (onProgress) {
      const handler = (progress: DiarizationFirstPipelineProgress) => {
        if (progress.jobId === jobId) {
          onProgress(progress)
        }
      }
      progressEmitter.on(PROGRESS_EVENT, handler)
      unsubscribe = () => progressEmitter.off(PROGRESS_EVENT, handler)
    }

    try {
      // ========================================
      // Phase 1: Audio Validation
      // ========================================
      emitProgress(jobId, 'validating_audio', 5, 'Validating audio file...')

      const audioValidation = validateAudioFile(audioPath, config)
      diarizationTelemetryService.recordValidationCheckpoint(
        audioValidation.passed,
        {
          checkpointName: 'audio_validation',
          processingTimeMs: Date.now() - startTime,
          errors: audioValidation.errors,
          warnings: audioValidation.warnings
        }
      )

      if (!audioValidation.passed) {
        const errorMsg = audioValidation.errors.join('; ')
        emitProgress(
          jobId,
          'blocked',
          0,
          `Audio validation failed: ${errorMsg}`,
          {
            code: 'AUDIO_VALIDATION_FAILED',
            message: errorMsg,
            displayMessage: DIARIZATION_FAILURE_MESSAGE
          }
        )

        diarizationTelemetryService.recordFailure('pipeline_stage', {
          audioPath,
          processingTimeMs: Date.now() - startTime,
          errorCode: 'AUDIO_VALIDATION_FAILED',
          errorMessage: errorMsg
        })

        return createBlockingResult(
          audioPath,
          'validating_audio',
          'AUDIO_VALIDATION_FAILED',
          errorMsg,
          startTime
        )
      }

      // ========================================
      // Phase 2: Diarization (MANDATORY BLOCKING STAGE)
      // ========================================
      emitProgress(jobId, 'diarization', 10, 'Starting speaker diarization (mandatory stage)...')

      const diarizationStartTime = Date.now()
      let diarizationResult: DiarizationResult

      try {
        diarizationResult = await mlPipelineService.diarize(
          audioPath,
          {
            ...config.diarization,
            device: config.diarization?.device || 'auto'
          },
          (progress) => {
            const adjustedProgress = 10 + (progress.progress * 0.4) // 10-50%
            emitProgress(
              jobId,
              'diarization',
              adjustedProgress,
              `Diarization: ${progress.message}`
            )
          }
        )
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error)

        emitProgress(
          jobId,
          'blocked',
          0,
          `Diarization failed: ${errorMsg}`,
          {
            code: 'DIARIZATION_FAILED',
            message: errorMsg,
            displayMessage: DIARIZATION_FAILURE_MESSAGE
          }
        )

        diarizationTelemetryService.recordFailure('batch_diarization', {
          audioPath,
          processingTimeMs: Date.now() - diarizationStartTime,
          errorCode: 'DIARIZATION_FAILED',
          errorMessage: errorMsg
        })

        return createBlockingResult(
          audioPath,
          'diarization',
          'DIARIZATION_FAILED',
          errorMsg,
          startTime
        )
      }

      const diarizationTimeMs = Date.now() - diarizationStartTime

      // Check if diarization succeeded
      if (!diarizationResult.success) {
        const errorMsg = diarizationResult.error || 'Diarization failed to produce results'

        emitProgress(
          jobId,
          'blocked',
          0,
          errorMsg,
          {
            code: DiarizationErrorCodes.DIARIZATION_UNAVAILABLE,
            message: errorMsg,
            displayMessage: DIARIZATION_FAILURE_MESSAGE
          }
        )

        diarizationTelemetryService.recordFailure('batch_diarization', {
          audioPath,
          processingTimeMs: diarizationTimeMs,
          errorCode: DiarizationErrorCodes.DIARIZATION_UNAVAILABLE,
          errorMessage: errorMsg
        })

        return createBlockingResult(
          audioPath,
          'diarization',
          DiarizationErrorCodes.DIARIZATION_UNAVAILABLE,
          errorMsg,
          startTime
        )
      }

      // ========================================
      // Phase 3: Diarization Validation Checkpoint
      // ========================================
      emitProgress(jobId, 'diarization_validation', 55, 'Validating diarization output...')

      const speakerSegments = convertToMandatorySegments(diarizationResult)
      const diarizationValidation = validateDiarizationCheckpoint(diarizationResult, speakerSegments)

      diarizationTelemetryService.recordValidationCheckpoint(
        diarizationValidation.passed,
        {
          checkpointName: 'diarization_output_validation',
          processingTimeMs: Date.now() - startTime,
          errors: diarizationValidation.errors,
          warnings: diarizationValidation.warnings
        }
      )

      if (!diarizationValidation.passed) {
        const errorMsg = `Diarization validation failed: ${diarizationValidation.errors.join('; ')}`

        emitProgress(
          jobId,
          'blocked',
          0,
          errorMsg,
          {
            code: DiarizationErrorCodes.SCHEMA_VALIDATION_FAILED,
            message: errorMsg,
            displayMessage: DIARIZATION_FAILURE_MESSAGE
          }
        )

        diarizationTelemetryService.recordFailure('validation_checkpoint', {
          audioPath,
          processingTimeMs: Date.now() - startTime,
          errorCode: DiarizationErrorCodes.SCHEMA_VALIDATION_FAILED,
          errorMessage: errorMsg
        })

        return createBlockingResult(
          audioPath,
          'diarization_validation',
          DiarizationErrorCodes.SCHEMA_VALIDATION_FAILED,
          errorMsg,
          startTime
        )
      }

      // Record successful diarization
      diarizationTelemetryService.recordSuccess('batch_diarization', {
        audioPath,
        processingTimeMs: diarizationTimeMs,
        speakersDetected: diarizationResult.numSpeakers,
        segmentsProduced: speakerSegments.length
      })

      // ========================================
      // Phase 3.5: LLM Post-Processing (Optional Enhancement)
      // ========================================
      // This phase uses LM Studio to enhance speaker consistency, resolve overlaps,
      // and handle low-confidence segments. It's non-blocking - if LM Studio is
      // not available, we continue with the raw diarization output.
      emitProgress(jobId, 'diarization_validation', 57, 'Checking LLM post-processing availability...')
      
      try {
        console.log('[DiarizationFirstPipeline] Checking LM Studio availability for post-processing...')
        const llmAvailability = await llmPostProcessingService.checkAvailability()
        
        if (llmAvailability.available) {
          console.log(`[DiarizationFirstPipeline] LM Studio available (${llmAvailability.modelInfo}), processing diarization output...`)
          emitProgress(jobId, 'diarization_validation', 58, 'Processing diarization with LLM...')
          
          // Build DiarizationOutput structure for LLM service
          const diarizationOutput: DiarizationOutput = {
            success: true,
            segments: speakerSegments,
            speaker_ids: diarizationResult.speakers,
            num_speakers: diarizationResult.numSpeakers,
            audio_duration: speakerSegments.length > 0 
              ? Math.max(...speakerSegments.map(s => s.end_time)) 
              : 0,
            processing_time: diarizationTimeMs / 1000,
            schema_version: '1.0.0'
          }
          
          // Call LLM post-processing service
          const llmResult = await llmPostProcessingService.processOutput(diarizationOutput, {
            resolveOverlaps: true,
            resolveLowConfidence: true,
            generateDisplayOrder: true,
            generateSummary: false // No transcript yet, so no summary
          })
          
          if (llmResult.success) {
            console.log('[DiarizationFirstPipeline] LLM post-processing complete:', {
              speakerMappings: llmResult.speakerMappings.length,
              overlapResolutions: llmResult.overlapResolutions.length,
              lowConfidenceResolutions: llmResult.lowConfidenceResolutions.length,
              llmRequests: llmResult.metadata.llmRequestCount,
              processingTime: llmResult.metadata.processingTimeMs,
              guardrailViolations: llmResult.metadata.guardrailViolations.length
            })
            
            // Log guardrail violations if any
            if (llmResult.metadata.guardrailViolations.length > 0) {
              console.warn('[DiarizationFirstPipeline] LLM guardrail violations detected:', 
                llmResult.metadata.guardrailViolations)
            }
            
            // Log speaker display order recommendation
            if (llmResult.displayOrder) {
              console.log('[DiarizationFirstPipeline] Recommended speaker display order:', 
                llmResult.displayOrder.order,
                'Reasoning:', llmResult.displayOrder.reasoning)
            }
            
            // Log overlap resolutions
            llmResult.overlapResolutions.forEach(resolution => {
              if (resolution.applied) {
                console.log('[DiarizationFirstPipeline] Overlap resolved:', 
                  `Time: ${resolution.overlapTimeRange.start.toFixed(2)}s-${resolution.overlapTimeRange.end.toFixed(2)}s`,
                  `Primary Speaker: ${resolution.recommendedPrimarySpeaker}`,
                  `Confidence: ${resolution.resolutionConfidence.toFixed(2)}`)
              }
            })
            
            // Log low-confidence resolutions
            llmResult.lowConfidenceResolutions.forEach(resolution => {
              if (resolution.applied && resolution.suggestedSpeakerId) {
                console.log('[DiarizationFirstPipeline] Low-confidence segment resolved:',
                  `Original: ${resolution.originalSpeakerId} (conf: ${resolution.originalConfidence.toFixed(2)})`,
                  `Suggested: ${resolution.suggestedSpeakerId}`)
              }
            })
          } else {
            console.warn('[DiarizationFirstPipeline] LLM post-processing failed:', llmResult.error)
          }
        } else {
          console.log('[DiarizationFirstPipeline] LM Studio not available, skipping post-processing:', 
            llmAvailability.error)
        }
      } catch (llmError) {
        // Non-blocking: log error but continue with raw diarization
        console.warn('[DiarizationFirstPipeline] LLM post-processing error (non-blocking):', 
          llmError instanceof Error ? llmError.message : String(llmError))
      }

      // ========================================
      // Phase 4: Transcription (Optional)
      // ========================================
      let transcriptionResult: TranscriptionResult | undefined
      let transcriptionTimeMs = 0
      let combinedSegments: CombinedSegment[] = []

      if (!config.diarizationOnly) {
        emitProgress(jobId, 'transcription', 60, 'Starting transcription...')

        const transcriptionStartTime = Date.now()

        try {
          transcriptionResult = await mlPipelineService.transcribe(
            audioPath,
            config.transcription || {},
            (progress) => {
              const adjustedProgress = 60 + (progress.progress * 0.3) // 60-90%
              emitProgress(
                jobId,
                'transcription',
                adjustedProgress,
                `Transcription: ${progress.message}`
              )
            }
          )

          transcriptionTimeMs = Date.now() - transcriptionStartTime

          if (transcriptionResult.success) {
            // ========================================
            // Phase 5: Combine Results
            // ========================================
            emitProgress(jobId, 'combining', 92, 'Combining transcription with speaker labels...')

            combinedSegments = mlPipelineService.combineResults(
              transcriptionResult.segments,
              diarizationResult.segments
            )

            // Final validation
            const finalValidation = validateFinalOutput(combinedSegments, speakerSegments)
            diarizationTelemetryService.recordValidationCheckpoint(
              finalValidation.passed,
              {
                checkpointName: 'final_output_validation',
                processingTimeMs: Date.now() - startTime,
                errors: finalValidation.errors,
                warnings: finalValidation.warnings
              }
            )

            // Log warnings but don't block
            if (finalValidation.warnings.length > 0) {
              console.warn('[DiarizationFirstPipeline] Final validation warnings:', finalValidation.warnings)
            }
          }
        } catch (error) {
          // Transcription failure doesn't block - we still have diarization
          console.error('[DiarizationFirstPipeline] Transcription error:', error)
          transcriptionTimeMs = Date.now() - transcriptionStartTime
        }
      }

      // ========================================
      // Complete
      // ========================================
      const totalTimeMs = Date.now() - startTime

      emitProgress(jobId, 'completed', 100, 'Pipeline completed successfully')

      const result: DiarizationFirstPipelineResult = {
        success: true,
        diarizationSuccess: true,
        transcriptionPerformed: !config.diarizationOnly && !!transcriptionResult?.success,
        speakerSegments,
        transcription: transcriptionResult,
        combinedSegments,
        numSpeakers: diarizationResult.numSpeakers,
        speakerIds: diarizationResult.speakers,
        metadata: {
          audioFile: audioPath,
          audioDuration: speakerSegments.length > 0
            ? Math.max(...speakerSegments.map(s => s.end_time))
            : 0,
          diarizationTimeMs,
          transcriptionTimeMs,
          totalTimeMs,
          pipelineVersion: PIPELINE_VERSION
        }
      }

      return result

    } finally {
      activeJobs.delete(jobId)
      if (unsubscribe) {
        unsubscribe()
      }
    }
  },

  /**
   * Check if the diarization-first pipeline is available
   */
  async isAvailable(): Promise<{
    available: boolean
    diarizationAvailable: boolean
    transcriptionAvailable: boolean
    message: string
  }> {
    try {
      const deps = await mlPipelineService.checkDependencies()

      return {
        available: deps.pyannoteAvailable,
        diarizationAvailable: deps.pyannoteAvailable,
        transcriptionAvailable: deps.transcriptionBackend !== null,
        message: deps.pyannoteAvailable
          ? 'Diarization-first pipeline is available'
          : 'Diarization is not available - pipeline cannot run'
      }
    } catch (error) {
      return {
        available: false,
        diarizationAvailable: false,
        transcriptionAvailable: false,
        message: `Failed to check availability: ${error}`
      }
    }
  },

  /**
   * Get the mandatory failure message for display
   */
  getFailureMessage(): string {
    return DIARIZATION_FAILURE_MESSAGE
  },

  /**
   * Subscribe to pipeline progress events
   */
  onProgress(callback: (progress: DiarizationFirstPipelineProgress) => void): () => void {
    progressEmitter.on(PROGRESS_EVENT, callback)
    return () => {
      progressEmitter.off(PROGRESS_EVENT, callback)
    }
  },

  /**
   * Get current active jobs
   */
  getActiveJobs(): Array<{
    jobId: string
    phase: DiarizationFirstPipelinePhase
    startTime: number
    audioPath: string
  }> {
    return Array.from(activeJobs.entries()).map(([jobId, job]) => ({
      jobId,
      ...job
    }))
  },

  /**
   * Get pipeline version
   */
  getVersion(): string {
    return PIPELINE_VERSION
  }
}

// Export for testing
export function resetDiarizationFirstPipelineState(): void {
  activeJobs.clear()
  progressEmitter.removeAllListeners()
}

// Export types
export type {
  MandatoryDiarizationSegment,
  DiarizationOutput
}
