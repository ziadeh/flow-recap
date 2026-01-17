/**
 * Diarization Service
 *
 * Manages speaker diarization workflow including:
 * - Running pyannote.audio diarization
 * - Creating and managing speaker records in the database
 * - Aligning speaker segments with transcription timestamps
 * - Updating transcripts with speaker information
 */

import { randomUUID } from 'crypto'
import { speakerService } from './speakerService'
import { transcriptService } from './transcriptService'
import { mlPipelineService, TranscriptionSegment, CombinedSegment, DiarizationConfig, DiarizationSegment, TranscriptionConfig, ModelSize } from './mlPipeline'
import { diarizationTelemetryService } from './diarizationTelemetryService'
import type { Speaker, Transcript, CreateTranscriptInput } from '../../src/types/database'

// ============================================================================
// Types
// ============================================================================

export interface DiarizationSpeaker {
  /** Internal speaker ID */
  id: string
  /** Diarization label (Speaker_0, Speaker_1, etc.) */
  label: string
  /** Database Speaker record */
  speakerRecord?: Speaker
  /** Total speaking time in seconds */
  totalDuration: number
  /** Number of speech segments */
  segmentCount: number
  /** Percentage of total speech time */
  percentage: number
}

export interface DiarizationJobResult {
  success: boolean
  meetingId: string
  audioPath: string
  /** Speakers identified in the audio */
  speakers: DiarizationSpeaker[]
  /** Number of speakers detected */
  numSpeakers: number
  /** Transcript segments with speaker labels */
  segments: CombinedSegment[]
  /** Raw diarization segments */
  diarizationSegments: DiarizationSegment[]
  /** Error message if failed */
  error?: string
}

export interface AlignmentOptions {
  /** Whether to create speaker records in database for new speakers */
  createSpeakerRecords?: boolean
  /** Prefix for auto-generated speaker names */
  speakerNamePrefix?: string
  /** Whether to update existing transcript records with speaker info */
  updateTranscripts?: boolean
}

// ============================================================================
// Speaker Label to Color Mapping
// ============================================================================

const SPEAKER_COLORS = [
  { bg: 'bg-purple-100', text: 'text-purple-700', border: 'border-purple-300' },
  { bg: 'bg-blue-100', text: 'text-blue-700', border: 'border-blue-300' },
  { bg: 'bg-green-100', text: 'text-green-700', border: 'border-green-300' },
  { bg: 'bg-orange-100', text: 'text-orange-700', border: 'border-orange-300' },
  { bg: 'bg-pink-100', text: 'text-pink-700', border: 'border-pink-300' },
  { bg: 'bg-teal-100', text: 'text-teal-700', border: 'border-teal-300' },
  { bg: 'bg-yellow-100', text: 'text-yellow-700', border: 'border-yellow-300' },
  { bg: 'bg-indigo-100', text: 'text-indigo-700', border: 'border-indigo-300' },
]

/**
 * Get color classes for a speaker based on their index
 */
export function getSpeakerColor(speakerIndex: number): { bg: string; text: string; border: string } {
  return SPEAKER_COLORS[speakerIndex % SPEAKER_COLORS.length]
}

/**
 * Parse speaker index from label (e.g., "Speaker_2" -> 2)
 */
export function parseSpeakerIndex(label: string): number {
  const match = label.match(/Speaker_(\d+)/)
  if (match) {
    return parseInt(match[1], 10)
  }
  return 0
}

// ============================================================================
// Diarization Service
// ============================================================================

export const diarizationService = {
  /**
   * Run speaker diarization on an audio file
   */
  async runDiarization(
    audioPath: string,
    meetingId: string,
    config: DiarizationConfig = {},
    onProgress?: (progress: { phase: string; progress: number; message: string }) => void
  ): Promise<DiarizationJobResult> {
    const startTime = Date.now()

    try {
      // Run diarization using ML pipeline
      const diarizationResult = await mlPipelineService.diarize(
        audioPath,
        config,
        onProgress ? (p) => onProgress({ phase: p.phase, progress: p.progress, message: p.message }) : undefined
      )

      const processingTimeMs = Date.now() - startTime

      if (!diarizationResult.success) {
        // Track failure in telemetry
        diarizationTelemetryService.recordFailure('batch_diarization', {
          meetingId,
          audioPath,
          processingTimeMs,
          errorCode: 'DIARIZATION_FAILED',
          errorMessage: diarizationResult.error || 'Diarization failed'
        })

        return {
          success: false,
          meetingId,
          audioPath,
          speakers: [],
          numSpeakers: 0,
          segments: [],
          diarizationSegments: [],
          error: diarizationResult.error || 'Diarization failed'
        }
      }

      // Build speaker info from stats
      const speakers: DiarizationSpeaker[] = diarizationResult.speakers.map((label, index) => {
        const stats = diarizationResult.speakerStats?.[label]
        return {
          id: randomUUID(),
          label,
          totalDuration: stats?.totalDuration || 0,
          segmentCount: stats?.numSegments || 0,
          percentage: stats?.percentage || 0
        }
      })

      // Track success in telemetry
      diarizationTelemetryService.recordSuccess('batch_diarization', {
        meetingId,
        audioPath,
        processingTimeMs,
        speakersDetected: diarizationResult.numSpeakers,
        segmentsProduced: diarizationResult.segments.length
      })

      return {
        success: true,
        meetingId,
        audioPath,
        speakers,
        numSpeakers: diarizationResult.numSpeakers,
        segments: [],
        diarizationSegments: diarizationResult.segments
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error)
      const processingTimeMs = Date.now() - startTime

      // Track failure in telemetry
      diarizationTelemetryService.recordFailure('batch_diarization', {
        meetingId,
        audioPath,
        processingTimeMs,
        errorCode: 'DIARIZATION_ERROR',
        errorMessage
      })

      return {
        success: false,
        meetingId,
        audioPath,
        speakers: [],
        numSpeakers: 0,
        segments: [],
        diarizationSegments: [],
        error: errorMessage
      }
    }
  },

  /**
   * Run full pipeline: transcription + diarization + alignment
   *
   * NOTE: For the diarization-first architecture, consider using
   * processWithDiarizationFirst() instead, which enforces mandatory
   * diarization before transcription.
   */
  async processWithDiarization(
    audioPath: string,
    meetingId: string,
    options: {
      transcriptionConfig?: TranscriptionConfig
      diarizationConfig?: DiarizationConfig
      alignmentOptions?: AlignmentOptions
      onProgress?: (progress: { phase: string; progress: number; message: string }) => void
    } = {}
  ): Promise<DiarizationJobResult> {
    const { transcriptionConfig, diarizationConfig, alignmentOptions, onProgress } = options
    const startTime = Date.now()

    try {
      // Run complete pipeline
      const result = await mlPipelineService.processComplete(
        audioPath,
        transcriptionConfig || {},
        diarizationConfig || {},
        onProgress ? (p) => onProgress({ phase: p.phase, progress: p.progress, message: p.message }) : undefined
      )

      const processingTimeMs = Date.now() - startTime

      if (!result.transcription.success) {
        diarizationTelemetryService.recordFailure('pipeline_stage', {
          meetingId,
          audioPath,
          processingTimeMs,
          errorCode: 'TRANSCRIPTION_FAILED',
          errorMessage: result.transcription.error || 'Transcription failed'
        })

        return {
          success: false,
          meetingId,
          audioPath,
          speakers: [],
          numSpeakers: 0,
          segments: [],
          diarizationSegments: [],
          error: result.transcription.error || 'Transcription failed'
        }
      }

      // Build speaker info
      const speakers: DiarizationSpeaker[] = result.diarization.speakers.map((label) => {
        const stats = result.diarization.speakerStats?.[label]
        return {
          id: randomUUID(),
          label,
          totalDuration: stats?.totalDuration || 0,
          segmentCount: stats?.numSegments || 0,
          percentage: stats?.percentage || 0
        }
      })

      // Create speaker records if requested
      if (alignmentOptions?.createSpeakerRecords !== false) {
        for (const speaker of speakers) {
          const name = alignmentOptions?.speakerNamePrefix
            ? `${alignmentOptions.speakerNamePrefix} ${speaker.label}`
            : speaker.label

          const existingSpeaker = await this.findSpeakerByName(name)
          if (existingSpeaker) {
            speaker.speakerRecord = existingSpeaker
          } else {
            speaker.speakerRecord = speakerService.create({ name })
          }
        }
      }

      // Store transcripts with speaker info if requested
      if (alignmentOptions?.updateTranscripts !== false) {
        await this.storeTranscriptsWithSpeakers(meetingId, result.combined, speakers)
      }

      // Track success in telemetry
      diarizationTelemetryService.recordSuccess('pipeline_stage', {
        meetingId,
        audioPath,
        processingTimeMs,
        speakersDetected: result.diarization.numSpeakers,
        segmentsProduced: result.diarization.segments.length
      })

      return {
        success: true,
        meetingId,
        audioPath,
        speakers,
        numSpeakers: result.diarization.numSpeakers,
        segments: result.combined,
        diarizationSegments: result.diarization.segments
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error)
      const processingTimeMs = Date.now() - startTime

      diarizationTelemetryService.recordFailure('pipeline_stage', {
        meetingId,
        audioPath,
        processingTimeMs,
        errorCode: 'PIPELINE_ERROR',
        errorMessage
      })

      return {
        success: false,
        meetingId,
        audioPath,
        speakers: [],
        numSpeakers: 0,
        segments: [],
        diarizationSegments: [],
        error: errorMessage
      }
    }
  },

  /**
   * Run diarization-first pipeline with mandatory diarization stage
   *
   * This method enforces the diarization-first architecture:
   * 1. Diarization runs FIRST as a BLOCKING stage
   * 2. If diarization fails, the pipeline HALTS with explicit error
   * 3. No silent fallback to single-speaker mode
   * 4. Transcription only proceeds after successful diarization
   */
  async processWithDiarizationFirst(
    audioPath: string,
    meetingId: string,
    options: {
      transcriptionConfig?: TranscriptionConfig
      diarizationConfig?: DiarizationConfig
      alignmentOptions?: AlignmentOptions
      diarizationOnly?: boolean
      onProgress?: (progress: { phase: string; progress: number; message: string }) => void
    } = {}
  ): Promise<DiarizationJobResult & { blocked?: boolean; blockReason?: string }> {
    const { transcriptionConfig, diarizationConfig, alignmentOptions, diarizationOnly, onProgress } = options
    const startTime = Date.now()
    const DIARIZATION_FAILURE_MESSAGE = 'Speaker diarization is not available. Audio is being transcribed without speaker separation.'

    try {
      // Use the diarization-first method from mlPipelineService
      const result = await mlPipelineService.processDiarizationFirst(
        audioPath,
        diarizationConfig || {},
        transcriptionConfig || {},
        { diarizationOnly },
        onProgress ? (p) => onProgress({ phase: p.phase, progress: p.progress, message: p.message }) : undefined
      )

      const processingTimeMs = Date.now() - startTime

      // Check if pipeline was blocked due to diarization failure
      if (result.blocked) {
        diarizationTelemetryService.recordFailure('pipeline_stage', {
          meetingId,
          audioPath,
          processingTimeMs,
          errorCode: 'DIARIZATION_BLOCKED',
          errorMessage: result.blockReason || 'Diarization failed - pipeline blocked'
        })

        return {
          success: false,
          meetingId,
          audioPath,
          speakers: [],
          numSpeakers: 0,
          segments: [],
          diarizationSegments: [],
          error: result.failureMessage || DIARIZATION_FAILURE_MESSAGE,
          blocked: true,
          blockReason: result.blockReason
        }
      }

      // Build speaker info
      const speakers: DiarizationSpeaker[] = result.diarization.speakers.map((label) => {
        const stats = result.diarization.speakerStats?.[label]
        return {
          id: randomUUID(),
          label,
          totalDuration: stats?.totalDuration || 0,
          segmentCount: stats?.numSegments || 0,
          percentage: stats?.percentage || 0
        }
      })

      // Create speaker records if requested
      if (alignmentOptions?.createSpeakerRecords !== false) {
        for (const speaker of speakers) {
          const name = alignmentOptions?.speakerNamePrefix
            ? `${alignmentOptions.speakerNamePrefix} ${speaker.label}`
            : speaker.label

          const existingSpeaker = await this.findSpeakerByName(name)
          if (existingSpeaker) {
            speaker.speakerRecord = existingSpeaker
          } else {
            speaker.speakerRecord = speakerService.create({ name })
          }
        }
      }

      // Store transcripts with speaker info if requested
      if (!diarizationOnly && alignmentOptions?.updateTranscripts !== false && result.combined.length > 0) {
        await this.storeTranscriptsWithSpeakers(meetingId, result.combined, speakers)
      }

      // Track success in telemetry
      diarizationTelemetryService.recordSuccess('pipeline_stage', {
        meetingId,
        audioPath,
        processingTimeMs,
        speakersDetected: result.diarization.numSpeakers,
        segmentsProduced: result.diarization.segments.length,
        metadata: {
          diarizationOnly,
          transcriptionPerformed: !!result.transcription?.success
        }
      })

      return {
        success: true,
        meetingId,
        audioPath,
        speakers,
        numSpeakers: result.diarization.numSpeakers,
        segments: result.combined,
        diarizationSegments: result.diarization.segments,
        blocked: false
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error)
      const processingTimeMs = Date.now() - startTime

      diarizationTelemetryService.recordFailure('pipeline_stage', {
        meetingId,
        audioPath,
        processingTimeMs,
        errorCode: 'PIPELINE_ERROR',
        errorMessage
      })

      return {
        success: false,
        meetingId,
        audioPath,
        speakers: [],
        numSpeakers: 0,
        segments: [],
        diarizationSegments: [],
        error: errorMessage,
        blocked: true,
        blockReason: errorMessage
      }
    }
  },

  /**
   * Align transcription segments with diarization segments
   */
  alignSegments(
    transcriptionSegments: TranscriptionSegment[],
    diarizationSegments: DiarizationSegment[]
  ): CombinedSegment[] {
    return mlPipelineService.combineResults(transcriptionSegments, diarizationSegments)
  },

  /**
   * Find a speaker in the database by name
   */
  async findSpeakerByName(name: string): Promise<Speaker | null> {
    const speakers = speakerService.searchByName(name)
    return speakers.find(s => s.name === name) || null
  },

  /**
   * Create or get speakers for diarization labels
   */
  async getOrCreateSpeakers(
    labels: string[],
    options: { namePrefix?: string } = {}
  ): Promise<Map<string, Speaker>> {
    const speakerMap = new Map<string, Speaker>()

    for (const label of labels) {
      const name = options.namePrefix
        ? `${options.namePrefix} ${label}`
        : label

      const speaker = speakerService.getOrCreate(name)
      speakerMap.set(label, speaker)
    }

    return speakerMap
  },

  /**
   * Store transcripts with speaker information in the database
   */
  async storeTranscriptsWithSpeakers(
    meetingId: string,
    segments: CombinedSegment[],
    speakers: DiarizationSpeaker[]
  ): Promise<Transcript[]> {
    // Build speaker label to ID map
    const speakerLabelToId = new Map<string, string>()
    for (const speaker of speakers) {
      if (speaker.speakerRecord) {
        speakerLabelToId.set(speaker.label, speaker.speakerRecord.id)
      }
    }

    // Create transcript inputs
    const transcriptInputs: CreateTranscriptInput[] = segments.map(segment => ({
      meeting_id: meetingId,
      speaker_id: segment.speaker ? speakerLabelToId.get(segment.speaker) || null : null,
      content: segment.text,
      start_time_ms: Math.round(segment.start * 1000),
      end_time_ms: Math.round(segment.end * 1000),
      confidence: segment.confidence,
      is_final: true
    }))

    // Batch create transcripts
    return transcriptService.createBatch(transcriptInputs)
  },

  /**
   * Update existing transcripts with speaker information
   */
  async updateTranscriptsWithSpeakers(
    meetingId: string,
    diarizationSegments: DiarizationSegment[],
    speakers: DiarizationSpeaker[]
  ): Promise<number> {
    // Get existing transcripts
    const transcripts = transcriptService.getByMeetingId(meetingId)
    if (transcripts.length === 0) {
      return 0
    }

    // Build speaker label to ID map
    const speakerLabelToId = new Map<string, string>()
    for (const speaker of speakers) {
      if (speaker.speakerRecord) {
        speakerLabelToId.set(speaker.label, speaker.speakerRecord.id)
      }
    }

    let updatedCount = 0

    // For each transcript, find the best matching speaker
    for (const transcript of transcripts) {
      const startSec = transcript.start_time_ms / 1000
      const endSec = transcript.end_time_ms / 1000

      // Find best speaker using overlap matching
      const speakerLabel = this.findBestSpeaker(diarizationSegments, startSec, endSec)

      if (speakerLabel) {
        const speakerId = speakerLabelToId.get(speakerLabel)
        if (speakerId && speakerId !== transcript.speaker_id) {
          // Update transcript with speaker ID
          // Note: transcriptService doesn't have an update method, so we'd need to add one
          // For now, this is a placeholder
          updatedCount++
        }
      }
    }

    return updatedCount
  },

  /**
   * Find the best matching speaker for a time range using overlap-based matching
   */
  findBestSpeaker(
    diarizationSegments: DiarizationSegment[],
    startTime: number,
    endTime: number
  ): string | null {
    const speakerOverlaps: Record<string, number> = {}
    const duration = endTime - startTime

    if (duration <= 0) {
      // For zero-duration segments, use point-in-time matching
      for (const seg of diarizationSegments) {
        if (seg.start <= startTime && startTime <= seg.end) {
          return seg.speaker
        }
      }
      return null
    }

    for (const seg of diarizationSegments) {
      const overlapStart = Math.max(startTime, seg.start)
      const overlapEnd = Math.min(endTime, seg.end)
      const overlap = Math.max(0, overlapEnd - overlapStart)

      if (overlap > 0) {
        if (!speakerOverlaps[seg.speaker]) {
          speakerOverlaps[seg.speaker] = 0
        }
        speakerOverlaps[seg.speaker] += overlap
      }
    }

    if (Object.keys(speakerOverlaps).length === 0) {
      // Fallback: find nearest speaker
      const midpoint = (startTime + endTime) / 2
      let nearestSpeaker: string | null = null
      let nearestDistance = Infinity

      for (const seg of diarizationSegments) {
        const distance = Math.min(
          Math.abs(seg.start - midpoint),
          Math.abs(seg.end - midpoint)
        )
        if (distance < nearestDistance && distance <= 1.0) {
          nearestDistance = distance
          nearestSpeaker = seg.speaker
        }
      }

      return nearestSpeaker
    }

    // Return speaker with highest overlap
    return Object.entries(speakerOverlaps).reduce(
      (best, [speaker, overlap]) => overlap > best.overlap ? { speaker, overlap } : best,
      { speaker: '', overlap: 0 }
    ).speaker || null
  },

  /**
   * Get speaker statistics for a meeting
   */
  getSpeakerStatistics(
    diarizationSegments: DiarizationSegment[]
  ): Record<string, { totalDuration: number; segmentCount: number; percentage: number }> {
    const stats: Record<string, { totalDuration: number; segmentCount: number; percentage: number }> = {}
    let totalSpeechTime = 0

    for (const seg of diarizationSegments) {
      if (!stats[seg.speaker]) {
        stats[seg.speaker] = { totalDuration: 0, segmentCount: 0, percentage: 0 }
      }
      stats[seg.speaker].totalDuration += seg.duration
      stats[seg.speaker].segmentCount++
      totalSpeechTime += seg.duration
    }

    // Calculate percentages
    if (totalSpeechTime > 0) {
      for (const speaker in stats) {
        stats[speaker].percentage = (stats[speaker].totalDuration / totalSpeechTime) * 100
      }
    }

    return stats
  }
}

// Export for testing
export function resetDiarizationServiceState(): void {
  // No internal state to reset currently
}
