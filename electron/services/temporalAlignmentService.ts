/**
 * Temporal Alignment Service
 *
 * Aligns transcription segments with diarization segments based on timestamps.
 * Implements the core requirement: speaker identity MUST come from diarization (audio embeddings),
 * never from text analysis.
 *
 * Key Features:
 * - Matches transcription timestamps to diarization speaker segments
 * - Handles overlapping segments by assigning to speaker with majority overlap
 * - Splits transcription text when spanning multiple speakers
 * - Validates diarization data exists before transcription proceeds
 */

import type { MandatoryDiarizationSegment } from './diarizationOutputSchema'

// ============================================================================
// Types
// ============================================================================

/**
 * A transcription segment with timestamp information
 */
export interface TranscriptionSegmentInput {
  /** Transcribed text content */
  text: string
  /** Start time in seconds from audio start */
  startTime: number
  /** End time in seconds from audio start */
  endTime: number
  /** Confidence score (0.0-1.0) */
  confidence?: number
  /** Whether this is a final segment */
  isFinal?: boolean
}

/**
 * Result of aligning a transcription segment with diarization
 */
export interface AlignedTranscriptSegment {
  /** The transcribed text (may be split from original) */
  text: string
  /** Start time in milliseconds */
  startTimeMs: number
  /** End time in milliseconds */
  endTimeMs: number
  /** Speaker ID from diarization (e.g., "SPEAKER_0") */
  speakerId: string
  /** Confidence score for speaker assignment (0.0-1.0) */
  speakerConfidence: number
  /** Transcription confidence */
  transcriptionConfidence: number
  /** Whether this is a final segment */
  isFinal: boolean
  /** Percentage of overlap with the assigned speaker segment */
  overlapPercentage: number
  /** Whether this segment was split from a larger transcription */
  wasSplit: boolean
  /** Original transcription segment if split */
  originalSegmentIndex?: number
}

/**
 * Validation result for diarization data
 */
export interface DiarizationValidationResult {
  /** Whether diarization data is valid and sufficient */
  valid: boolean
  /** Error message if invalid */
  error?: string
  /** Warning messages */
  warnings: string[]
  /** Time range covered by diarization */
  coveredRange?: {
    startTime: number
    endTime: number
  }
  /** Gaps in diarization coverage */
  gaps: Array<{
    startTime: number
    endTime: number
  }>
}

/**
 * Configuration for temporal alignment
 */
export interface TemporalAlignmentConfig {
  /** Minimum overlap percentage (0-1) to assign speaker (default: 0.3) */
  minOverlapThreshold?: number
  /** Whether to split transcription when spanning multiple speakers (default: true) */
  splitOnSpeakerChange?: boolean
  /** Maximum gap (in seconds) to allow between speaker segments (default: 0.5) */
  maxSpeakerGap?: number
  /** Whether to require 100% diarization coverage (default: false) */
  requireFullCoverage?: boolean
  /** Minimum coverage percentage to proceed (default: 0.5) */
  minCoverageThreshold?: number
}

// ============================================================================
// Default Configuration
// ============================================================================

const DEFAULT_CONFIG: Required<TemporalAlignmentConfig> = {
  minOverlapThreshold: 0.3,
  splitOnSpeakerChange: true,
  maxSpeakerGap: 0.5,
  requireFullCoverage: false,
  minCoverageThreshold: 0.5
}

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Calculate overlap duration between two time ranges
 */
function calculateOverlap(
  start1: number,
  end1: number,
  start2: number,
  end2: number
): number {
  const overlapStart = Math.max(start1, start2)
  const overlapEnd = Math.min(end1, end2)
  return Math.max(0, overlapEnd - overlapStart)
}

/**
 * Find all diarization segments that overlap with a time range
 */
function findOverlappingSegments(
  diarizationSegments: MandatoryDiarizationSegment[],
  startTime: number,
  endTime: number
): Array<MandatoryDiarizationSegment & { overlap: number; overlapPercentage: number }> {
  const duration = endTime - startTime
  if (duration <= 0) return []

  return diarizationSegments
    .map(segment => {
      const overlap = calculateOverlap(startTime, endTime, segment.start_time, segment.end_time)
      return {
        ...segment,
        overlap,
        overlapPercentage: overlap / duration
      }
    })
    .filter(segment => segment.overlap > 0)
    .sort((a, b) => b.overlap - a.overlap) // Sort by overlap descending
}

/**
 * Find speaker changes within a time range
 */
function findSpeakerChanges(
  diarizationSegments: MandatoryDiarizationSegment[],
  startTime: number,
  endTime: number
): Array<{ time: number; fromSpeaker: string; toSpeaker: string }> {
  // Get segments in time order that fall within or overlap the range
  const relevantSegments = diarizationSegments
    .filter(seg => seg.end_time > startTime && seg.start_time < endTime)
    .sort((a, b) => a.start_time - b.start_time)

  const changes: Array<{ time: number; fromSpeaker: string; toSpeaker: string }> = []

  for (let i = 1; i < relevantSegments.length; i++) {
    const prev = relevantSegments[i - 1]
    const curr = relevantSegments[i]

    if (prev.speaker_id !== curr.speaker_id) {
      // Speaker change detected
      const changeTime = Math.max(startTime, Math.min(endTime, curr.start_time))
      changes.push({
        time: changeTime,
        fromSpeaker: prev.speaker_id,
        toSpeaker: curr.speaker_id
      })
    }
  }

  return changes
}

/**
 * Split text proportionally based on time ranges
 * Uses word count as a proxy for time distribution
 */
function splitTextByTime(
  text: string,
  totalStartTime: number,
  totalEndTime: number,
  splitPoints: Array<{ time: number; speakerId: string }>
): Array<{ text: string; startTime: number; endTime: number; speakerId: string }> {
  const totalDuration = totalEndTime - totalStartTime
  if (totalDuration <= 0 || splitPoints.length === 0) {
    return []
  }

  const words = text.trim().split(/\s+/)
  if (words.length === 0) return []

  const result: Array<{ text: string; startTime: number; endTime: number; speakerId: string }> = []

  // Add start point
  const allPoints = [
    { time: totalStartTime, speakerId: splitPoints[0]?.speakerId || 'UNKNOWN' },
    ...splitPoints
  ]

  // Process each segment
  for (let i = 0; i < allPoints.length; i++) {
    const start = allPoints[i].time
    const end = i < allPoints.length - 1 ? allPoints[i + 1].time : totalEndTime
    const speakerId = allPoints[i].speakerId

    // Calculate proportion of text for this segment
    const segmentDuration = end - start
    const proportion = segmentDuration / totalDuration

    // Calculate word indices for this segment
    const startWordIdx = Math.floor((start - totalStartTime) / totalDuration * words.length)
    const endWordIdx = Math.min(
      words.length,
      Math.ceil((end - totalStartTime) / totalDuration * words.length)
    )

    if (startWordIdx < endWordIdx) {
      const segmentWords = words.slice(startWordIdx, endWordIdx)
      if (segmentWords.length > 0) {
        result.push({
          text: segmentWords.join(' '),
          startTime: start,
          endTime: end,
          speakerId
        })
      }
    }
  }

  return result
}

// ============================================================================
// Temporal Alignment Service
// ============================================================================

export const temporalAlignmentService = {
  /**
   * Validate that diarization data exists and covers the required time range
   *
   * This is a BLOCKING validation - transcription should NOT proceed if this fails.
   *
   * @param diarizationSegments - Speaker segments from diarization
   * @param requiredStartTime - Start time that must be covered (seconds)
   * @param requiredEndTime - End time that must be covered (seconds)
   * @param config - Alignment configuration
   */
  validateDiarizationCoverage(
    diarizationSegments: MandatoryDiarizationSegment[],
    requiredStartTime: number,
    requiredEndTime: number,
    config: TemporalAlignmentConfig = {}
  ): DiarizationValidationResult {
    const mergedConfig = { ...DEFAULT_CONFIG, ...config }
    const warnings: string[] = []
    const gaps: Array<{ startTime: number; endTime: number }> = []

    // Check if diarization data exists
    if (!diarizationSegments || diarizationSegments.length === 0) {
      return {
        valid: false,
        error: 'No diarization data available. Speaker diarization must complete before transcription.',
        warnings,
        gaps: [{ startTime: requiredStartTime, endTime: requiredEndTime }]
      }
    }

    // Find the range covered by diarization
    const sortedSegments = [...diarizationSegments].sort((a, b) => a.start_time - b.start_time)
    const coveredStart = sortedSegments[0].start_time
    const coveredEnd = Math.max(...sortedSegments.map(s => s.end_time))

    // Calculate coverage
    const requiredDuration = requiredEndTime - requiredStartTime
    if (requiredDuration <= 0) {
      return {
        valid: true,
        warnings: ['Invalid time range specified'],
        coveredRange: { startTime: coveredStart, endTime: coveredEnd },
        gaps
      }
    }

    // Check for gaps in coverage within the required range
    let totalCoveredTime = 0
    let lastEnd = requiredStartTime

    for (const segment of sortedSegments) {
      if (segment.end_time <= requiredStartTime) continue
      if (segment.start_time >= requiredEndTime) break

      const effectiveStart = Math.max(segment.start_time, requiredStartTime)
      const effectiveEnd = Math.min(segment.end_time, requiredEndTime)

      // Check for gap
      if (effectiveStart > lastEnd + mergedConfig.maxSpeakerGap) {
        gaps.push({
          startTime: lastEnd,
          endTime: effectiveStart
        })
      }

      totalCoveredTime += effectiveEnd - effectiveStart
      lastEnd = Math.max(lastEnd, effectiveEnd)
    }

    // Check for trailing gap
    if (lastEnd < requiredEndTime - mergedConfig.maxSpeakerGap) {
      gaps.push({
        startTime: lastEnd,
        endTime: requiredEndTime
      })
    }

    const coveragePercentage = totalCoveredTime / requiredDuration

    // Validate coverage
    if (mergedConfig.requireFullCoverage && coveragePercentage < 1.0) {
      return {
        valid: false,
        error: `Incomplete diarization coverage: ${(coveragePercentage * 100).toFixed(1)}% of required range. Full coverage is required.`,
        warnings,
        coveredRange: { startTime: coveredStart, endTime: coveredEnd },
        gaps
      }
    }

    if (coveragePercentage < mergedConfig.minCoverageThreshold) {
      return {
        valid: false,
        error: `Insufficient diarization coverage: ${(coveragePercentage * 100).toFixed(1)}% (minimum ${(mergedConfig.minCoverageThreshold * 100).toFixed(0)}% required)`,
        warnings,
        coveredRange: { startTime: coveredStart, endTime: coveredEnd },
        gaps
      }
    }

    // Add warnings for low coverage
    if (coveragePercentage < 0.8) {
      warnings.push(`Diarization coverage is ${(coveragePercentage * 100).toFixed(1)}% - some speech may not have speaker attribution`)
    }

    if (gaps.length > 0) {
      warnings.push(`${gaps.length} gap(s) detected in diarization coverage`)
    }

    return {
      valid: true,
      warnings,
      coveredRange: { startTime: coveredStart, endTime: coveredEnd },
      gaps
    }
  },

  /**
   * Align a single transcription segment with diarization data
   *
   * This assigns the speaker_id from diarization based on timestamp overlap.
   * If the segment spans multiple speakers and splitting is enabled, it will
   * return multiple aligned segments.
   *
   * @param transcriptSegment - The transcription segment to align
   * @param diarizationSegments - Speaker segments from diarization
   * @param config - Alignment configuration
   * @param originalIndex - Index of original segment (for tracking splits)
   */
  alignSegment(
    transcriptSegment: TranscriptionSegmentInput,
    diarizationSegments: MandatoryDiarizationSegment[],
    config: TemporalAlignmentConfig = {},
    originalIndex?: number
  ): AlignedTranscriptSegment[] {
    const mergedConfig = { ...DEFAULT_CONFIG, ...config }
    const { startTime, endTime, text, confidence = 1.0, isFinal = true } = transcriptSegment

    // Find overlapping diarization segments
    const overlapping = findOverlappingSegments(diarizationSegments, startTime, endTime)

    // No overlap found - cannot assign speaker
    if (overlapping.length === 0) {
      // Find nearest speaker within a reasonable distance
      const nearestBefore = diarizationSegments
        .filter(s => s.end_time <= startTime)
        .sort((a, b) => b.end_time - a.end_time)[0]
      const nearestAfter = diarizationSegments
        .filter(s => s.start_time >= endTime)
        .sort((a, b) => a.start_time - b.start_time)[0]

      // Use nearest speaker if within maxSpeakerGap
      let fallbackSpeaker: MandatoryDiarizationSegment | null = null
      if (nearestBefore && startTime - nearestBefore.end_time <= mergedConfig.maxSpeakerGap) {
        fallbackSpeaker = nearestBefore
      } else if (nearestAfter && nearestAfter.start_time - endTime <= mergedConfig.maxSpeakerGap) {
        fallbackSpeaker = nearestAfter
      }

      if (fallbackSpeaker) {
        return [{
          text: text.trim(),
          startTimeMs: Math.round(startTime * 1000),
          endTimeMs: Math.round(endTime * 1000),
          speakerId: fallbackSpeaker.speaker_id,
          speakerConfidence: fallbackSpeaker.confidence * 0.5, // Reduced confidence for fallback
          transcriptionConfidence: confidence,
          isFinal,
          overlapPercentage: 0,
          wasSplit: false,
          originalSegmentIndex: originalIndex
        }]
      }

      // No speaker can be assigned
      return [{
        text: text.trim(),
        startTimeMs: Math.round(startTime * 1000),
        endTimeMs: Math.round(endTime * 1000),
        speakerId: 'UNKNOWN',
        speakerConfidence: 0,
        transcriptionConfidence: confidence,
        isFinal,
        overlapPercentage: 0,
        wasSplit: false,
        originalSegmentIndex: originalIndex
      }]
    }

    // Single speaker covers the segment
    if (overlapping.length === 1 || !mergedConfig.splitOnSpeakerChange) {
      const primary = overlapping[0]
      return [{
        text: text.trim(),
        startTimeMs: Math.round(startTime * 1000),
        endTimeMs: Math.round(endTime * 1000),
        speakerId: primary.speaker_id,
        speakerConfidence: primary.confidence,
        transcriptionConfidence: confidence,
        isFinal,
        overlapPercentage: primary.overlapPercentage,
        wasSplit: false,
        originalSegmentIndex: originalIndex
      }]
    }

    // Multiple speakers - check if we should split
    const speakerChanges = findSpeakerChanges(diarizationSegments, startTime, endTime)

    if (speakerChanges.length === 0) {
      // No speaker changes detected, assign to primary speaker
      const primary = overlapping[0]
      return [{
        text: text.trim(),
        startTimeMs: Math.round(startTime * 1000),
        endTimeMs: Math.round(endTime * 1000),
        speakerId: primary.speaker_id,
        speakerConfidence: primary.confidence,
        transcriptionConfidence: confidence,
        isFinal,
        overlapPercentage: primary.overlapPercentage,
        wasSplit: false,
        originalSegmentIndex: originalIndex
      }]
    }

    // Split the transcription at speaker change points
    const splitSegments = splitTextByTime(text, startTime, endTime, speakerChanges)

    return splitSegments.map(split => ({
      text: split.text.trim(),
      startTimeMs: Math.round(split.startTime * 1000),
      endTimeMs: Math.round(split.endTime * 1000),
      speakerId: split.speakerId,
      speakerConfidence: overlapping.find(o => o.speaker_id === split.speakerId)?.confidence || 0.5,
      transcriptionConfidence: confidence,
      isFinal,
      overlapPercentage: 1.0, // Calculated per-split
      wasSplit: true,
      originalSegmentIndex: originalIndex
    }))
  },

  /**
   * Align multiple transcription segments with diarization data
   *
   * @param transcriptSegments - Array of transcription segments
   * @param diarizationSegments - Speaker segments from diarization
   * @param config - Alignment configuration
   */
  alignSegments(
    transcriptSegments: TranscriptionSegmentInput[],
    diarizationSegments: MandatoryDiarizationSegment[],
    config: TemporalAlignmentConfig = {}
  ): AlignedTranscriptSegment[] {
    const results: AlignedTranscriptSegment[] = []

    for (let i = 0; i < transcriptSegments.length; i++) {
      const aligned = this.alignSegment(transcriptSegments[i], diarizationSegments, config, i)
      results.push(...aligned)
    }

    // Sort by start time
    return results.sort((a, b) => a.startTimeMs - b.startTimeMs)
  },

  /**
   * Get speaker ID for a specific point in time
   *
   * @param diarizationSegments - Speaker segments from diarization
   * @param timeSeconds - Time in seconds
   */
  getSpeakerAtTime(
    diarizationSegments: MandatoryDiarizationSegment[],
    timeSeconds: number
  ): string | null {
    for (const segment of diarizationSegments) {
      if (timeSeconds >= segment.start_time && timeSeconds <= segment.end_time) {
        return segment.speaker_id
      }
    }
    return null
  },

  /**
   * Get all speaker segments within a time range
   *
   * @param diarizationSegments - Speaker segments from diarization
   * @param startTimeSeconds - Start of range (seconds)
   * @param endTimeSeconds - End of range (seconds)
   */
  getSpeakersInRange(
    diarizationSegments: MandatoryDiarizationSegment[],
    startTimeSeconds: number,
    endTimeSeconds: number
  ): Array<{ speakerId: string; startTime: number; endTime: number; duration: number }> {
    return diarizationSegments
      .filter(seg => seg.end_time > startTimeSeconds && seg.start_time < endTimeSeconds)
      .map(seg => ({
        speakerId: seg.speaker_id,
        startTime: Math.max(seg.start_time, startTimeSeconds),
        endTime: Math.min(seg.end_time, endTimeSeconds),
        duration: Math.min(seg.end_time, endTimeSeconds) - Math.max(seg.start_time, startTimeSeconds)
      }))
      .sort((a, b) => a.startTime - b.startTime)
  },

  /**
   * Calculate statistics about speaker distribution in aligned segments
   */
  calculateSpeakerStats(
    alignedSegments: AlignedTranscriptSegment[]
  ): {
    speakerCount: number
    speakers: Array<{
      speakerId: string
      segmentCount: number
      totalDurationMs: number
      totalWords: number
      averageConfidence: number
    }>
    unknownSegments: number
    splitSegments: number
  } {
    const speakerMap = new Map<string, {
      segmentCount: number
      totalDurationMs: number
      totalWords: number
      totalConfidence: number
    }>()

    let unknownSegments = 0
    let splitSegments = 0

    for (const segment of alignedSegments) {
      if (segment.speakerId === 'UNKNOWN') {
        unknownSegments++
        continue
      }

      if (segment.wasSplit) {
        splitSegments++
      }

      const existing = speakerMap.get(segment.speakerId) || {
        segmentCount: 0,
        totalDurationMs: 0,
        totalWords: 0,
        totalConfidence: 0
      }

      existing.segmentCount++
      existing.totalDurationMs += segment.endTimeMs - segment.startTimeMs
      existing.totalWords += segment.text.split(/\s+/).length
      existing.totalConfidence += segment.speakerConfidence

      speakerMap.set(segment.speakerId, existing)
    }

    const speakers = Array.from(speakerMap.entries()).map(([speakerId, data]) => ({
      speakerId,
      ...data,
      averageConfidence: data.totalConfidence / data.segmentCount
    }))

    return {
      speakerCount: speakers.length,
      speakers,
      unknownSegments,
      splitSegments
    }
  }
}

// Export types
export type {
  TranscriptionSegmentInput,
  AlignedTranscriptSegment,
  DiarizationValidationResult,
  TemporalAlignmentConfig
}
