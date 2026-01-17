/**
 * Diarization Output Schema
 *
 * This module defines the MANDATORY output schema for speaker diarization.
 * All downstream systems MUST consume this structured format.
 *
 * CRITICAL REQUIREMENTS:
 * 1. Each speech segment MUST produce structured JSON output
 * 2. Speaker IDs MUST be stable across time (not recreated per segment)
 * 3. Retroactive speaker label correction MUST be supported
 * 4. Overlapping speech MUST produce overlapping segments
 * 5. If structured output cannot be generated, pipeline MUST fail explicitly
 *
 * Schema Fields:
 * - speaker_id: Stable identifier reused consistently across segments
 * - start_time: Float seconds from audio start
 * - end_time: Float seconds from audio start
 * - confidence: 0-1 score indicating diarization confidence
 */

// ============================================================================
// Core Output Schema Types
// ============================================================================

/**
 * Mandatory diarization segment output.
 * This is the PRIMARY output format that all downstream systems must consume.
 */
export interface MandatoryDiarizationSegment {
  /**
   * Stable speaker identifier (e.g., "SPEAKER_0", "SPEAKER_1").
   * MUST be reused consistently across segments for the same speaker.
   * MUST NOT be recreated for each segment.
   */
  speaker_id: string

  /**
   * Start time in float seconds from audio start.
   * MUST be >= 0 and < end_time.
   */
  start_time: number

  /**
   * End time in float seconds from audio start.
   * MUST be > start_time.
   */
  end_time: number

  /**
   * Confidence score between 0 and 1.
   * 0 = no confidence, 1 = full confidence.
   * MUST be within [0, 1] range.
   */
  confidence: number
}

/**
 * Extended segment with overlapping speech support.
 */
export interface OverlappingDiarizationSegment extends MandatoryDiarizationSegment {
  /**
   * Indicates if this segment has overlapping speech.
   */
  is_overlapping: boolean

  /**
   * List of all speakers active during this segment (including primary).
   * Only populated when is_overlapping is true.
   */
  overlapping_speakers: string[]
}

/**
 * Complete diarization output with all segments and metadata.
 */
export interface DiarizationOutput {
  /** Whether diarization was successful */
  success: boolean

  /** All detected speech segments in chronological order */
  segments: MandatoryDiarizationSegment[]

  /** List of all unique speaker IDs detected */
  speaker_ids: string[]

  /** Number of unique speakers detected */
  num_speakers: number

  /** Total audio duration in seconds */
  audio_duration: number

  /** Processing time in seconds */
  processing_time: number

  /** Schema version for compatibility checking */
  schema_version: string

  /** Error details if success is false */
  error?: DiarizationErrorDetails
}

/**
 * Error structure for failed diarization.
 */
export interface DiarizationErrorDetails {
  /** Error code for programmatic handling */
  code: string

  /** Human-readable error message */
  message: string

  /** Additional error details */
  details?: Record<string, unknown>
}

// ============================================================================
// Speaker ID Tracking for Consistency
// ============================================================================

/**
 * Speaker ID registry for tracking and ensuring consistent speaker IDs.
 * Prevents recreation of speaker IDs per segment.
 */
export interface SpeakerIdRegistry {
  /** Map of speaker ID to speaker metadata */
  speakers: Map<string, SpeakerMetadata>

  /** Next available speaker index */
  nextIndex: number

  /** Track when corrections have been made */
  correctionHistory: SpeakerCorrectionRecord[]
}

/**
 * Metadata for a tracked speaker.
 */
export interface SpeakerMetadata {
  /** Unique speaker identifier */
  speaker_id: string

  /** First appearance time in seconds */
  first_seen: number

  /** Last appearance time in seconds */
  last_seen: number

  /** Number of segments attributed to this speaker */
  segment_count: number

  /** Average confidence for this speaker's segments */
  average_confidence: number

  /** Whether this speaker ID has been corrected */
  was_corrected: boolean

  /** Original speaker ID if corrected */
  original_id?: string
}

/**
 * Record of a speaker label correction.
 */
export interface SpeakerCorrectionRecord {
  /** Timestamp of the correction */
  timestamp: number

  /** Original speaker ID */
  from_speaker_id: string

  /** New speaker ID after correction */
  to_speaker_id: string

  /** Reason for correction */
  reason: 'clustering_update' | 'manual_override' | 'retroactive_analysis'

  /** Segments affected by this correction */
  affected_segment_count: number
}

// ============================================================================
// Validation Types
// ============================================================================

/**
 * Result of schema validation.
 */
export interface ValidationResult {
  /** Whether validation passed */
  valid: boolean

  /** List of validation errors if any */
  errors: ValidationError[]

  /** List of validation warnings if any */
  warnings: ValidationWarning[]
}

/**
 * A validation error that makes the output invalid.
 */
export interface ValidationError {
  /** Error code */
  code: string

  /** Field that failed validation */
  field: string

  /** Error message */
  message: string

  /** Index of segment if applicable */
  segment_index?: number
}

/**
 * A validation warning that doesn't invalidate output.
 */
export interface ValidationWarning {
  /** Warning code */
  code: string

  /** Field with warning */
  field: string

  /** Warning message */
  message: string

  /** Index of segment if applicable */
  segment_index?: number
}

// ============================================================================
// Error Types for Pipeline Failure
// ============================================================================

/**
 * Error codes for diarization failures.
 * Pipeline MUST fail explicitly with these codes rather than falling back.
 */
export const DiarizationErrorCodes = {
  /** Diarization system is not available */
  DIARIZATION_UNAVAILABLE: 'DIARIZATION_UNAVAILABLE',

  /** Failed to produce structured output */
  OUTPUT_GENERATION_FAILED: 'OUTPUT_GENERATION_FAILED',

  /** Schema validation failed */
  SCHEMA_VALIDATION_FAILED: 'SCHEMA_VALIDATION_FAILED',

  /** Speaker ID consistency check failed */
  SPEAKER_ID_INCONSISTENT: 'SPEAKER_ID_INCONSISTENT',

  /** Insufficient audio for diarization */
  INSUFFICIENT_AUDIO: 'INSUFFICIENT_AUDIO',

  /** Model loading failed */
  MODEL_LOAD_FAILED: 'MODEL_LOAD_FAILED',

  /** Processing timeout */
  PROCESSING_TIMEOUT: 'PROCESSING_TIMEOUT',

  /** Unknown processing error */
  PROCESSING_ERROR: 'PROCESSING_ERROR',

  /** Single speaker fallback was prevented */
  SINGLE_SPEAKER_FALLBACK_PREVENTED: 'SINGLE_SPEAKER_FALLBACK_PREVENTED'
} as const

export type DiarizationErrorCode = typeof DiarizationErrorCodes[keyof typeof DiarizationErrorCodes]

/**
 * Error thrown when diarization output cannot be generated.
 * Pipeline MUST fail with this error rather than falling back to single-speaker mode.
 */
export class DiarizationOutputError extends Error {
  readonly code: DiarizationErrorCode
  readonly details: Record<string, unknown>

  constructor(
    code: DiarizationErrorCode,
    message: string,
    details: Record<string, unknown> = {}
  ) {
    super(message)
    this.name = 'DiarizationOutputError'
    this.code = code
    this.details = details
  }

  /**
   * Convert to JSON-serializable format.
   */
  toJSON(): { code: string; message: string; details: Record<string, unknown> } {
    return {
      code: this.code,
      message: this.message,
      details: this.details
    }
  }
}

// ============================================================================
// Schema Version
// ============================================================================

/** Current schema version */
export const DIARIZATION_SCHEMA_VERSION = '1.0.0'

// ============================================================================
// Validation Functions
// ============================================================================

/**
 * Validate a single segment against the mandatory schema.
 */
export function validateSegment(
  segment: unknown,
  index: number
): { errors: ValidationError[]; warnings: ValidationWarning[] } {
  const errors: ValidationError[] = []
  const warnings: ValidationWarning[] = []

  if (typeof segment !== 'object' || segment === null) {
    errors.push({
      code: 'INVALID_SEGMENT_TYPE',
      field: 'segment',
      message: 'Segment must be an object',
      segment_index: index
    })
    return { errors, warnings }
  }

  const seg = segment as Record<string, unknown>

  // Validate speaker_id
  if (typeof seg.speaker_id !== 'string') {
    errors.push({
      code: 'MISSING_SPEAKER_ID',
      field: 'speaker_id',
      message: 'speaker_id must be a string',
      segment_index: index
    })
  } else if (seg.speaker_id.trim() === '') {
    errors.push({
      code: 'EMPTY_SPEAKER_ID',
      field: 'speaker_id',
      message: 'speaker_id cannot be empty',
      segment_index: index
    })
  } else if (!/^SPEAKER_\d+$/.test(seg.speaker_id)) {
    warnings.push({
      code: 'NON_STANDARD_SPEAKER_ID',
      field: 'speaker_id',
      message: `speaker_id "${seg.speaker_id}" does not follow SPEAKER_N format`,
      segment_index: index
    })
  }

  // Validate start_time
  if (typeof seg.start_time !== 'number') {
    errors.push({
      code: 'INVALID_START_TIME',
      field: 'start_time',
      message: 'start_time must be a number',
      segment_index: index
    })
  } else if (seg.start_time < 0) {
    errors.push({
      code: 'NEGATIVE_START_TIME',
      field: 'start_time',
      message: 'start_time cannot be negative',
      segment_index: index
    })
  } else if (!Number.isFinite(seg.start_time)) {
    errors.push({
      code: 'INVALID_START_TIME',
      field: 'start_time',
      message: 'start_time must be a finite number',
      segment_index: index
    })
  }

  // Validate end_time
  if (typeof seg.end_time !== 'number') {
    errors.push({
      code: 'INVALID_END_TIME',
      field: 'end_time',
      message: 'end_time must be a number',
      segment_index: index
    })
  } else if (!Number.isFinite(seg.end_time)) {
    errors.push({
      code: 'INVALID_END_TIME',
      field: 'end_time',
      message: 'end_time must be a finite number',
      segment_index: index
    })
  } else if (
    typeof seg.start_time === 'number' &&
    Number.isFinite(seg.start_time) &&
    seg.end_time <= seg.start_time
  ) {
    errors.push({
      code: 'END_BEFORE_START',
      field: 'end_time',
      message: 'end_time must be greater than start_time',
      segment_index: index
    })
  }

  // Validate confidence
  if (typeof seg.confidence !== 'number') {
    errors.push({
      code: 'INVALID_CONFIDENCE',
      field: 'confidence',
      message: 'confidence must be a number',
      segment_index: index
    })
  } else if (seg.confidence < 0 || seg.confidence > 1) {
    errors.push({
      code: 'CONFIDENCE_OUT_OF_RANGE',
      field: 'confidence',
      message: 'confidence must be between 0 and 1',
      segment_index: index
    })
  } else if (!Number.isFinite(seg.confidence)) {
    errors.push({
      code: 'INVALID_CONFIDENCE',
      field: 'confidence',
      message: 'confidence must be a finite number',
      segment_index: index
    })
  }

  return { errors, warnings }
}

/**
 * Validate speaker ID consistency across segments.
 * Ensures speaker IDs are reused consistently.
 */
export function validateSpeakerIdConsistency(
  segments: MandatoryDiarizationSegment[]
): { errors: ValidationError[]; warnings: ValidationWarning[] } {
  const errors: ValidationError[] = []
  const warnings: ValidationWarning[] = []

  if (segments.length === 0) {
    return { errors, warnings }
  }

  // Track speaker ID occurrences
  const speakerOccurrences = new Map<string, number[]>()

  segments.forEach((segment, index) => {
    const occurrences = speakerOccurrences.get(segment.speaker_id) || []
    occurrences.push(index)
    speakerOccurrences.set(segment.speaker_id, occurrences)
  })

  // Check for speaker ID format consistency
  const speakerIds = Array.from(speakerOccurrences.keys())
  const speakerIndices = speakerIds
    .map(id => {
      const match = id.match(/^SPEAKER_(\d+)$/)
      return match ? parseInt(match[1], 10) : null
    })
    .filter((idx): idx is number => idx !== null)
    .sort((a, b) => a - b)

  // Check for gaps in speaker indices (might indicate recreation)
  if (speakerIndices.length >= 2) {
    for (let i = 1; i < speakerIndices.length; i++) {
      const gap = speakerIndices[i] - speakerIndices[i - 1]
      if (gap > 1) {
        warnings.push({
          code: 'SPEAKER_ID_GAP',
          field: 'speaker_id',
          message: `Gap in speaker IDs between SPEAKER_${speakerIndices[i - 1]} and SPEAKER_${speakerIndices[i]}`
        })
      }
    }
  }

  // Check for single-occurrence speakers (might indicate ID recreation)
  speakerOccurrences.forEach((occurrences, speakerId) => {
    if (occurrences.length === 1 && segments.length > 5) {
      warnings.push({
        code: 'SINGLE_OCCURRENCE_SPEAKER',
        field: 'speaker_id',
        message: `Speaker ${speakerId} appears in only one segment - may indicate ID recreation`
      })
    }
  })

  return { errors, warnings }
}

/**
 * Validate complete diarization output.
 */
export function validateDiarizationOutput(output: unknown): ValidationResult {
  const errors: ValidationError[] = []
  const warnings: ValidationWarning[] = []

  if (typeof output !== 'object' || output === null) {
    errors.push({
      code: 'INVALID_OUTPUT_TYPE',
      field: 'output',
      message: 'Output must be an object'
    })
    return { valid: false, errors, warnings }
  }

  const out = output as Record<string, unknown>

  // Validate success field
  if (typeof out.success !== 'boolean') {
    errors.push({
      code: 'MISSING_SUCCESS',
      field: 'success',
      message: 'success field must be a boolean'
    })
  }

  // Validate segments array
  if (!Array.isArray(out.segments)) {
    errors.push({
      code: 'MISSING_SEGMENTS',
      field: 'segments',
      message: 'segments must be an array'
    })
  } else {
    // Validate each segment
    out.segments.forEach((segment, index) => {
      const segmentValidation = validateSegment(segment, index)
      errors.push(...segmentValidation.errors)
      warnings.push(...segmentValidation.warnings)
    })

    // Validate speaker ID consistency
    if (errors.length === 0) {
      const consistencyValidation = validateSpeakerIdConsistency(
        out.segments as MandatoryDiarizationSegment[]
      )
      errors.push(...consistencyValidation.errors)
      warnings.push(...consistencyValidation.warnings)
    }
  }

  // Validate speaker_ids
  if (!Array.isArray(out.speaker_ids)) {
    errors.push({
      code: 'MISSING_SPEAKER_IDS',
      field: 'speaker_ids',
      message: 'speaker_ids must be an array'
    })
  }

  // Validate num_speakers
  if (typeof out.num_speakers !== 'number' || out.num_speakers < 0) {
    errors.push({
      code: 'INVALID_NUM_SPEAKERS',
      field: 'num_speakers',
      message: 'num_speakers must be a non-negative number'
    })
  }

  // Validate audio_duration
  if (typeof out.audio_duration !== 'number' || out.audio_duration < 0) {
    errors.push({
      code: 'INVALID_AUDIO_DURATION',
      field: 'audio_duration',
      message: 'audio_duration must be a non-negative number'
    })
  }

  // Validate processing_time
  if (typeof out.processing_time !== 'number' || out.processing_time < 0) {
    errors.push({
      code: 'INVALID_PROCESSING_TIME',
      field: 'processing_time',
      message: 'processing_time must be a non-negative number'
    })
  }

  // Validate schema_version
  if (typeof out.schema_version !== 'string') {
    warnings.push({
      code: 'MISSING_SCHEMA_VERSION',
      field: 'schema_version',
      message: 'schema_version is recommended for compatibility checking'
    })
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings
  }
}

// ============================================================================
// Speaker ID Registry Implementation
// ============================================================================

/**
 * Create a new speaker ID registry.
 */
export function createSpeakerIdRegistry(): SpeakerIdRegistry {
  return {
    speakers: new Map(),
    nextIndex: 0,
    correctionHistory: []
  }
}

/**
 * Register or get an existing speaker ID.
 * Ensures consistent speaker ID reuse.
 */
export function getOrCreateSpeakerId(
  registry: SpeakerIdRegistry,
  timestamp: number,
  confidence: number
): string {
  const speakerId = `SPEAKER_${registry.nextIndex}`

  registry.speakers.set(speakerId, {
    speaker_id: speakerId,
    first_seen: timestamp,
    last_seen: timestamp,
    segment_count: 1,
    average_confidence: confidence,
    was_corrected: false
  })

  registry.nextIndex++
  return speakerId
}

/**
 * Update speaker metadata when a segment is added.
 */
export function updateSpeakerMetadata(
  registry: SpeakerIdRegistry,
  speakerId: string,
  timestamp: number,
  confidence: number
): void {
  const metadata = registry.speakers.get(speakerId)
  if (!metadata) {
    throw new DiarizationOutputError(
      DiarizationErrorCodes.SPEAKER_ID_INCONSISTENT,
      `Attempted to update non-existent speaker: ${speakerId}`
    )
  }

  metadata.last_seen = Math.max(metadata.last_seen, timestamp)
  metadata.first_seen = Math.min(metadata.first_seen, timestamp)
  metadata.segment_count++
  metadata.average_confidence =
    (metadata.average_confidence * (metadata.segment_count - 1) + confidence) /
    metadata.segment_count
}

/**
 * Apply retroactive speaker label correction.
 * Updates all segments with the old speaker ID to use the new one.
 */
export function applyRetroactiveSpeakerCorrection(
  segments: MandatoryDiarizationSegment[],
  registry: SpeakerIdRegistry,
  fromSpeakerId: string,
  toSpeakerId: string,
  reason: SpeakerCorrectionRecord['reason']
): MandatoryDiarizationSegment[] {
  if (!registry.speakers.has(fromSpeakerId)) {
    throw new DiarizationOutputError(
      DiarizationErrorCodes.SPEAKER_ID_INCONSISTENT,
      `Cannot correct from non-existent speaker: ${fromSpeakerId}`
    )
  }

  let affectedCount = 0
  const correctedSegments = segments.map(segment => {
    if (segment.speaker_id === fromSpeakerId) {
      affectedCount++
      return { ...segment, speaker_id: toSpeakerId }
    }
    return segment
  })

  // Update registry
  const fromMetadata = registry.speakers.get(fromSpeakerId)!
  const toMetadata = registry.speakers.get(toSpeakerId)

  if (toMetadata) {
    // Merge metadata
    toMetadata.first_seen = Math.min(toMetadata.first_seen, fromMetadata.first_seen)
    toMetadata.last_seen = Math.max(toMetadata.last_seen, fromMetadata.last_seen)
    toMetadata.segment_count += fromMetadata.segment_count
    toMetadata.average_confidence =
      (toMetadata.average_confidence + fromMetadata.average_confidence) / 2
  } else {
    // Create new speaker with merged metadata
    registry.speakers.set(toSpeakerId, {
      ...fromMetadata,
      speaker_id: toSpeakerId,
      was_corrected: true,
      original_id: fromSpeakerId
    })
  }

  // Mark original as corrected
  fromMetadata.was_corrected = true

  // Record correction
  registry.correctionHistory.push({
    timestamp: Date.now(),
    from_speaker_id: fromSpeakerId,
    to_speaker_id: toSpeakerId,
    reason,
    affected_segment_count: affectedCount
  })

  return correctedSegments
}

// ============================================================================
// Overlapping Speech Handling
// ============================================================================

/**
 * Detect and create overlapping segments.
 */
export function detectOverlappingSegments(
  segments: MandatoryDiarizationSegment[]
): OverlappingDiarizationSegment[] {
  if (segments.length === 0) return []

  const result: OverlappingDiarizationSegment[] = []
  const sortedSegments = [...segments].sort((a, b) => a.start_time - b.start_time)

  for (let i = 0; i < sortedSegments.length; i++) {
    const current = sortedSegments[i]
    const overlappingSpeakers: string[] = [current.speaker_id]

    // Check for overlaps with other segments
    for (let j = 0; j < sortedSegments.length; j++) {
      if (i === j) continue

      const other = sortedSegments[j]

      // Check if segments overlap
      if (other.start_time < current.end_time && other.end_time > current.start_time) {
        if (!overlappingSpeakers.includes(other.speaker_id)) {
          overlappingSpeakers.push(other.speaker_id)
        }
      }
    }

    result.push({
      ...current,
      is_overlapping: overlappingSpeakers.length > 1,
      overlapping_speakers: overlappingSpeakers.length > 1 ? overlappingSpeakers : []
    })
  }

  return result
}

/**
 * Split overlapping segments into separate non-overlapping chunks.
 */
export function splitOverlappingSegments(
  segments: MandatoryDiarizationSegment[]
): MandatoryDiarizationSegment[] {
  if (segments.length === 0) return []

  // Get all unique time boundaries
  const boundaries = new Set<number>()
  segments.forEach(seg => {
    boundaries.add(seg.start_time)
    boundaries.add(seg.end_time)
  })

  const sortedBoundaries = Array.from(boundaries).sort((a, b) => a - b)
  const result: MandatoryDiarizationSegment[] = []

  // Create segments for each time interval
  for (let i = 0; i < sortedBoundaries.length - 1; i++) {
    const start = sortedBoundaries[i]
    const end = sortedBoundaries[i + 1]

    // Find all speakers active during this interval
    const activeSegments = segments.filter(
      seg => seg.start_time <= start && seg.end_time >= end
    )

    // Create a segment for each active speaker
    activeSegments.forEach(seg => {
      result.push({
        speaker_id: seg.speaker_id,
        start_time: start,
        end_time: end,
        confidence: seg.confidence
      })
    })
  }

  return result
}

// ============================================================================
// Output Generation
// ============================================================================

/**
 * Create a valid diarization output from segments.
 * Validates the output and throws if invalid.
 */
export function createDiarizationOutput(
  segments: MandatoryDiarizationSegment[],
  audioDuration: number,
  processingTime: number
): DiarizationOutput {
  // Extract unique speaker IDs
  const speakerIds = Array.from(new Set(segments.map(s => s.speaker_id))).sort()

  const output: DiarizationOutput = {
    success: true,
    segments: segments.sort((a, b) => a.start_time - b.start_time),
    speaker_ids: speakerIds,
    num_speakers: speakerIds.length,
    audio_duration: audioDuration,
    processing_time: processingTime,
    schema_version: DIARIZATION_SCHEMA_VERSION
  }

  // Validate the output
  const validation = validateDiarizationOutput(output)

  if (!validation.valid) {
    throw new DiarizationOutputError(
      DiarizationErrorCodes.SCHEMA_VALIDATION_FAILED,
      'Generated output failed schema validation',
      { errors: validation.errors }
    )
  }

  return output
}

/**
 * Create a failed diarization output.
 * Use this instead of falling back to single-speaker mode.
 */
export function createFailedDiarizationOutput(
  errorCode: DiarizationErrorCode,
  errorMessage: string,
  details?: Record<string, unknown>
): DiarizationOutput {
  return {
    success: false,
    segments: [],
    speaker_ids: [],
    num_speakers: 0,
    audio_duration: 0,
    processing_time: 0,
    schema_version: DIARIZATION_SCHEMA_VERSION,
    error: {
      code: errorCode,
      message: errorMessage,
      details
    }
  }
}

/**
 * Prevent single-speaker fallback.
 * Call this when diarization fails instead of falling back.
 */
export function preventSingleSpeakerFallback(
  reason: string,
  originalError?: Error
): never {
  throw new DiarizationOutputError(
    DiarizationErrorCodes.SINGLE_SPEAKER_FALLBACK_PREVENTED,
    `Single-speaker fallback prevented: ${reason}`,
    {
      originalError: originalError?.message,
      stack: originalError?.stack
    }
  )
}

// ============================================================================
// Export for use in services
// ============================================================================

export default {
  // Schema version
  DIARIZATION_SCHEMA_VERSION,

  // Error codes
  DiarizationErrorCodes,

  // Validation
  validateSegment,
  validateSpeakerIdConsistency,
  validateDiarizationOutput,

  // Speaker ID management
  createSpeakerIdRegistry,
  getOrCreateSpeakerId,
  updateSpeakerMetadata,
  applyRetroactiveSpeakerCorrection,

  // Overlapping speech
  detectOverlappingSegments,
  splitOverlappingSegments,

  // Output generation
  createDiarizationOutput,
  createFailedDiarizationOutput,
  preventSingleSpeakerFallback
}
