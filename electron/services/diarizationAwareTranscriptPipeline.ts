/**
 * Diarization-Aware Transcript Pipeline
 *
 * Orchestrates the transcription process to ensure speaker identity comes from
 * diarization (audio embeddings), never from text analysis.
 *
 * Pipeline Flow:
 * 1. Validate diarization data exists for the time range
 * 2. Get transcription segments (from live transcription or batch)
 * 3. Align transcription with diarization using temporal alignment
 * 4. Store transcripts with proper speaker attribution
 *
 * CRITICAL REQUIREMENTS:
 * - Transcription MUST NOT proceed if no diarization data exists
 * - Speaker IDs MUST come from diarization, not text inference
 * - Silent fallback to single speaker is PREVENTED
 */

import { EventEmitter } from 'events'
import { randomUUID } from 'crypto'

import {
  temporalAlignmentService,
  type TranscriptionSegmentInput,
  type AlignedTranscriptSegment,
  type TemporalAlignmentConfig
} from './temporalAlignmentService'
import { transcriptService, MissingSpeakerIdError } from './transcriptService'
import { speakerService } from './speakerService'
import type { MandatoryDiarizationSegment } from './diarizationOutputSchema'
import type { Transcript, Speaker } from '../../src/types/database'

// ============================================================================
// Types
// ============================================================================

/**
 * Pipeline execution status
 */
export type DiarizationAwarePipelineStatus =
  | 'idle'
  | 'validating_diarization'
  | 'aligning_segments'
  | 'creating_speakers'
  | 'storing_transcripts'
  | 'completed'
  | 'error'
  | 'blocked_no_diarization'

/**
 * Pipeline configuration
 */
export interface DiarizationAwarePipelineConfig {
  /** Meeting ID for storing transcripts */
  meetingId: string
  /** Alignment configuration */
  alignment?: TemporalAlignmentConfig
  /** Whether to auto-create speakers from diarization labels (default: true) */
  autoCreateSpeakers?: boolean
  /** Prefix for auto-created speaker names (default: "Speaker") */
  speakerNamePrefix?: string
  /** Whether to require 100% diarization coverage (default: false) */
  requireFullDiarizationCoverage?: boolean
  /** Minimum coverage percentage to proceed (default: 0.5) */
  minDiarizationCoverage?: number
}

/**
 * Progress update from pipeline
 */
export interface DiarizationAwarePipelineProgress {
  jobId: string
  status: DiarizationAwarePipelineStatus
  progress: number
  message: string
  timestamp: number
  details?: {
    totalSegments?: number
    alignedSegments?: number
    speakersCreated?: number
    transcriptsStored?: number
  }
}

/**
 * Result from pipeline execution
 */
export interface DiarizationAwarePipelineResult {
  success: boolean
  jobId: string
  /** Transcripts stored in database */
  transcripts: Transcript[]
  /** Map of diarization speaker labels to database Speaker records */
  speakerMap: Map<string, Speaker>
  /** Alignment statistics */
  alignmentStats: {
    totalInputSegments: number
    totalAlignedSegments: number
    segmentsWithSpeaker: number
    segmentsWithoutSpeaker: number
    splitSegments: number
    uniqueSpeakers: number
  }
  /** Execution metadata */
  metadata: {
    meetingId: string
    processingTimeMs: number
    diarizationCoverage: number
  }
  /** Error information if failed */
  error?: {
    code: string
    message: string
    phase: DiarizationAwarePipelineStatus
  }
}

/**
 * Error thrown when diarization data is missing
 */
export class NoDiarizationDataError extends Error {
  code: string
  details: {
    requiredStartTime: number
    requiredEndTime: number
    diarizationSegments: number
  }

  constructor(
    message: string,
    requiredStartTime: number,
    requiredEndTime: number,
    diarizationSegments: number
  ) {
    super(message)
    this.name = 'NoDiarizationDataError'
    this.code = 'NO_DIARIZATION_DATA'
    this.details = {
      requiredStartTime,
      requiredEndTime,
      diarizationSegments
    }
  }
}

// ============================================================================
// Constants
// ============================================================================

const PROGRESS_EVENT = 'diarization-aware-pipeline:progress'

// ============================================================================
// Service State
// ============================================================================

const progressEmitter = new EventEmitter()
const activeJobs = new Map<string, {
  status: DiarizationAwarePipelineStatus
  startTime: number
  meetingId: string
}>()

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Emit progress update
 */
function emitProgress(
  jobId: string,
  status: DiarizationAwarePipelineStatus,
  progress: number,
  message: string,
  details?: DiarizationAwarePipelineProgress['details']
): void {
  const payload: DiarizationAwarePipelineProgress = {
    jobId,
    status,
    progress: Math.min(100, Math.max(0, progress)),
    message,
    timestamp: Date.now(),
    details
  }
  progressEmitter.emit(PROGRESS_EVENT, payload)
}

/**
 * Convert diarization speaker ID to database speaker
 */
function getOrCreateDatabaseSpeaker(
  diarizationSpeakerId: string,
  speakerNamePrefix: string,
  speakerCache: Map<string, Speaker>
): Speaker {
  // Check cache first
  if (speakerCache.has(diarizationSpeakerId)) {
    return speakerCache.get(diarizationSpeakerId)!
  }

  // Parse speaker index from diarization ID (e.g., "SPEAKER_0" -> 0)
  const match = diarizationSpeakerId.match(/SPEAKER_(\d+)/)
  const index = match ? parseInt(match[1], 10) + 1 : 1 // 1-indexed for display
  const displayName = `${speakerNamePrefix} ${index}`

  // Get or create speaker in database
  const speaker = speakerService.getOrCreate(displayName)
  speakerCache.set(diarizationSpeakerId, speaker)

  return speaker
}

// ============================================================================
// Diarization-Aware Transcript Pipeline Service
// ============================================================================

export const diarizationAwareTranscriptPipeline = {
  /**
   * Process transcription segments through the diarization-aware pipeline
   *
   * This is the main entry point for creating transcripts with proper speaker
   * attribution from diarization.
   *
   * @param transcriptionSegments - Raw transcription segments
   * @param diarizationSegments - Speaker segments from diarization
   * @param config - Pipeline configuration
   * @param onProgress - Progress callback
   */
  async process(
    transcriptionSegments: TranscriptionSegmentInput[],
    diarizationSegments: MandatoryDiarizationSegment[],
    config: DiarizationAwarePipelineConfig,
    onProgress?: (progress: DiarizationAwarePipelineProgress) => void
  ): Promise<DiarizationAwarePipelineResult> {
    const jobId = randomUUID()
    const startTime = Date.now()
    const { meetingId } = config

    activeJobs.set(jobId, {
      status: 'validating_diarization',
      startTime,
      meetingId
    })

    // Set up progress listener
    let unsubscribe: (() => void) | null = null
    if (onProgress) {
      const handler = (progress: DiarizationAwarePipelineProgress) => {
        if (progress.jobId === jobId) {
          onProgress(progress)
        }
      }
      progressEmitter.on(PROGRESS_EVENT, handler)
      unsubscribe = () => progressEmitter.off(PROGRESS_EVENT, handler)
    }

    const speakerCache = new Map<string, Speaker>()

    try {
      // ========================================
      // Phase 1: Validate Diarization Data
      // ========================================
      emitProgress(jobId, 'validating_diarization', 10, 'Validating diarization data...')

      // Determine required time range from transcription segments
      if (transcriptionSegments.length === 0) {
        return {
          success: true,
          jobId,
          transcripts: [],
          speakerMap: new Map(),
          alignmentStats: {
            totalInputSegments: 0,
            totalAlignedSegments: 0,
            segmentsWithSpeaker: 0,
            segmentsWithoutSpeaker: 0,
            splitSegments: 0,
            uniqueSpeakers: 0
          },
          metadata: {
            meetingId,
            processingTimeMs: Date.now() - startTime,
            diarizationCoverage: 0
          }
        }
      }

      const requiredStartTime = Math.min(...transcriptionSegments.map(s => s.startTime))
      const requiredEndTime = Math.max(...transcriptionSegments.map(s => s.endTime))

      // Validate diarization coverage
      const validation = temporalAlignmentService.validateDiarizationCoverage(
        diarizationSegments,
        requiredStartTime,
        requiredEndTime,
        {
          requireFullCoverage: config.requireFullDiarizationCoverage || false,
          minCoverageThreshold: config.minDiarizationCoverage || 0.5
        }
      )

      if (!validation.valid) {
        emitProgress(
          jobId,
          'blocked_no_diarization',
          0,
          `Diarization validation failed: ${validation.error}`
        )

        throw new NoDiarizationDataError(
          validation.error || 'Diarization data is missing or insufficient',
          requiredStartTime,
          requiredEndTime,
          diarizationSegments.length
        )
      }

      // Calculate coverage for metadata
      let diarizationCoverage = 0
      if (validation.coveredRange) {
        const totalDuration = requiredEndTime - requiredStartTime
        const coveredDuration =
          Math.min(validation.coveredRange.endTime, requiredEndTime) -
          Math.max(validation.coveredRange.startTime, requiredStartTime)
        diarizationCoverage = Math.max(0, coveredDuration / totalDuration)
      }

      // Log warnings
      if (validation.warnings.length > 0) {
        console.warn('[DiarizationAwareTranscriptPipeline] Warnings:', validation.warnings)
      }

      activeJobs.get(jobId)!.status = 'aligning_segments'

      // ========================================
      // Phase 2: Align Transcription with Diarization
      // ========================================
      emitProgress(jobId, 'aligning_segments', 30, 'Aligning transcription with diarization...', {
        totalSegments: transcriptionSegments.length
      })

      const alignedSegments = temporalAlignmentService.alignSegments(
        transcriptionSegments,
        diarizationSegments,
        config.alignment || {}
      )

      const alignmentStats = temporalAlignmentService.calculateSpeakerStats(alignedSegments)

      emitProgress(jobId, 'aligning_segments', 50, 'Alignment complete', {
        totalSegments: transcriptionSegments.length,
        alignedSegments: alignedSegments.length
      })

      activeJobs.get(jobId)!.status = 'creating_speakers'

      // ========================================
      // Phase 3: Create/Get Database Speakers
      // ========================================
      if (config.autoCreateSpeakers !== false) {
        emitProgress(jobId, 'creating_speakers', 60, 'Creating speaker records...')

        const speakerNamePrefix = config.speakerNamePrefix || 'Speaker'

        for (const segment of alignedSegments) {
          if (segment.speakerId && segment.speakerId !== 'UNKNOWN') {
            getOrCreateDatabaseSpeaker(segment.speakerId, speakerNamePrefix, speakerCache)
          }
        }

        emitProgress(jobId, 'creating_speakers', 70, `Created ${speakerCache.size} speaker records`, {
          speakersCreated: speakerCache.size
        })
      }

      activeJobs.get(jobId)!.status = 'storing_transcripts'

      // ========================================
      // Phase 4: Store Transcripts with Speaker Attribution
      // ========================================
      emitProgress(jobId, 'storing_transcripts', 80, 'Storing transcripts...')

      // Map aligned segments to transcript inputs, converting diarization speaker ID to database speaker ID
      const transcriptInputs = alignedSegments
        .filter(seg => seg.speakerId !== 'UNKNOWN') // Filter out segments without speaker
        .map(seg => {
          const databaseSpeaker = speakerCache.get(seg.speakerId)
          return {
            text: seg.text,
            startTimeMs: seg.startTimeMs,
            endTimeMs: seg.endTimeMs,
            speakerId: databaseSpeaker?.id || seg.speakerId, // Use database speaker ID
            transcriptionConfidence: seg.transcriptionConfidence,
            isFinal: seg.isFinal
          }
        })

      const transcripts = transcriptService.createFromAlignedSegments(meetingId, transcriptInputs)

      emitProgress(jobId, 'storing_transcripts', 95, `Stored ${transcripts.length} transcripts`, {
        transcriptsStored: transcripts.length
      })

      activeJobs.get(jobId)!.status = 'completed'

      // ========================================
      // Complete
      // ========================================
      emitProgress(jobId, 'completed', 100, 'Pipeline completed successfully')

      return {
        success: true,
        jobId,
        transcripts,
        speakerMap: speakerCache,
        alignmentStats: {
          totalInputSegments: transcriptionSegments.length,
          totalAlignedSegments: alignedSegments.length,
          segmentsWithSpeaker: alignedSegments.filter(s => s.speakerId !== 'UNKNOWN').length,
          segmentsWithoutSpeaker: alignedSegments.filter(s => s.speakerId === 'UNKNOWN').length,
          splitSegments: alignmentStats.splitSegments,
          uniqueSpeakers: alignmentStats.speakerCount
        },
        metadata: {
          meetingId,
          processingTimeMs: Date.now() - startTime,
          diarizationCoverage
        }
      }

    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error)
      const errorCode = error instanceof NoDiarizationDataError
        ? error.code
        : 'PIPELINE_ERROR'
      const currentStatus = activeJobs.get(jobId)?.status || 'error'

      emitProgress(jobId, 'error', 0, `Pipeline failed: ${errorMsg}`)

      return {
        success: false,
        jobId,
        transcripts: [],
        speakerMap: speakerCache,
        alignmentStats: {
          totalInputSegments: transcriptionSegments.length,
          totalAlignedSegments: 0,
          segmentsWithSpeaker: 0,
          segmentsWithoutSpeaker: 0,
          splitSegments: 0,
          uniqueSpeakers: 0
        },
        metadata: {
          meetingId: config.meetingId,
          processingTimeMs: Date.now() - startTime,
          diarizationCoverage: 0
        },
        error: {
          code: errorCode,
          message: errorMsg,
          phase: currentStatus
        }
      }

    } finally {
      activeJobs.delete(jobId)
      if (unsubscribe) {
        unsubscribe()
      }
    }
  },

  /**
   * Process a single live transcription segment
   *
   * Use this for streaming/live transcription where segments arrive one at a time.
   * Requires diarization data to be available for the segment's time range.
   *
   * @param segment - Single transcription segment
   * @param diarizationSegments - Current diarization segments
   * @param meetingId - Meeting ID
   */
  processLiveSegment(
    segment: TranscriptionSegmentInput,
    diarizationSegments: MandatoryDiarizationSegment[],
    meetingId: string,
    speakerCache: Map<string, Speaker> = new Map()
  ): {
    success: boolean
    transcript: Transcript | null
    speaker: Speaker | null
    error?: string
  } {
    try {
      // Validate diarization coverage for this segment
      const validation = temporalAlignmentService.validateDiarizationCoverage(
        diarizationSegments,
        segment.startTime,
        segment.endTime,
        { minCoverageThreshold: 0.3 } // More lenient for live segments
      )

      if (!validation.valid) {
        return {
          success: false,
          transcript: null,
          speaker: null,
          error: `No diarization data for time range ${segment.startTime}-${segment.endTime}: ${validation.error}`
        }
      }

      // Align the segment
      const alignedSegments = temporalAlignmentService.alignSegment(
        segment,
        diarizationSegments
      )

      if (alignedSegments.length === 0) {
        return {
          success: false,
          transcript: null,
          speaker: null,
          error: 'Alignment produced no segments'
        }
      }

      // Use the primary aligned segment
      const aligned = alignedSegments[0]

      if (aligned.speakerId === 'UNKNOWN') {
        return {
          success: false,
          transcript: null,
          speaker: null,
          error: 'Could not determine speaker from diarization'
        }
      }

      // Get or create database speaker
      const speaker = getOrCreateDatabaseSpeaker(aligned.speakerId, 'Speaker', speakerCache)

      // Create transcript
      const transcript = transcriptService.createWithSpeaker({
        meeting_id: meetingId,
        speaker_id: speaker.id,
        content: aligned.text,
        start_time_ms: aligned.startTimeMs,
        end_time_ms: aligned.endTimeMs,
        confidence: aligned.transcriptionConfidence,
        is_final: aligned.isFinal
      })

      return {
        success: true,
        transcript,
        speaker
      }

    } catch (error) {
      return {
        success: false,
        transcript: null,
        speaker: null,
        error: error instanceof Error ? error.message : String(error)
      }
    }
  },

  /**
   * Check if diarization data exists for a time range
   *
   * Use this before attempting transcription to ensure speaker data is available.
   *
   * @param diarizationSegments - Current diarization segments
   * @param startTime - Start of range (seconds)
   * @param endTime - End of range (seconds)
   */
  hasDiarizationForRange(
    diarizationSegments: MandatoryDiarizationSegment[],
    startTime: number,
    endTime: number
  ): boolean {
    const validation = temporalAlignmentService.validateDiarizationCoverage(
      diarizationSegments,
      startTime,
      endTime,
      { minCoverageThreshold: 0.3 }
    )
    return validation.valid
  },

  /**
   * Subscribe to pipeline progress events
   */
  onProgress(callback: (progress: DiarizationAwarePipelineProgress) => void): () => void {
    progressEmitter.on(PROGRESS_EVENT, callback)
    return () => progressEmitter.off(PROGRESS_EVENT, callback)
  },

  /**
   * Get active pipeline jobs
   */
  getActiveJobs(): Array<{
    jobId: string
    status: DiarizationAwarePipelineStatus
    startTime: number
    meetingId: string
  }> {
    return Array.from(activeJobs.entries()).map(([jobId, job]) => ({
      jobId,
      ...job
    }))
  },

  /**
   * Get the error message for missing diarization
   */
  getMissingDiarizationMessage(): string {
    return 'Speaker diarization data is required before transcription can proceed. ' +
           'Please ensure diarization has been performed for this audio.'
  }
}

// Export types
export type {
  DiarizationAwarePipelineStatus,
  DiarizationAwarePipelineConfig,
  DiarizationAwarePipelineProgress,
  DiarizationAwarePipelineResult
}

// Reset for testing
export function resetDiarizationAwareTranscriptPipelineState(): void {
  activeJobs.clear()
  progressEmitter.removeAllListeners()
}
