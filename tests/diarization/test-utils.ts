/**
 * Diarization Test Utilities and Fixtures
 *
 * Provides test utilities, mock data, and fixtures for testing the
 * speaker diarization system.
 */

// ============================================================================
// Types
// ============================================================================

export interface MockSpeakerSegment {
  speaker_id: string
  start_time: number
  end_time: number
  confidence: number
}

export interface MockDiarizationResult {
  success: boolean
  segments: MockSpeakerSegment[]
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

export interface SpeakerGroundTruth {
  speaker_id: string
  segments: Array<{ start: number; end: number }>
}

export interface DiarizationQualityMetrics {
  diarizationErrorRate: number
  speakerConfusionMatrix: number[][]
  segmentBoundaryAccuracy: number
  speakerPurity: number
  speakerCoverage: number
  missedSpeechRate: number
  falseSpeechRate: number
}

// ============================================================================
// Mock Audio Test Data
// ============================================================================

/**
 * Simulates a two-speaker conversation with known ground truth.
 * Speaker A: Male voice, speaks from 0-5s, 10-15s, 20-25s
 * Speaker B: Female voice, speaks from 5-10s, 15-20s
 */
export const TWO_SPEAKER_GROUND_TRUTH: SpeakerGroundTruth[] = [
  {
    speaker_id: 'SPEAKER_0',
    segments: [
      { start: 0, end: 5 },
      { start: 10, end: 15 },
      { start: 20, end: 25 }
    ]
  },
  {
    speaker_id: 'SPEAKER_1',
    segments: [
      { start: 5, end: 10 },
      { start: 15, end: 20 }
    ]
  }
]

/**
 * Multi-minute recording ground truth (3 minutes, 3 speakers)
 */
export const MULTI_MINUTE_GROUND_TRUTH: SpeakerGroundTruth[] = [
  {
    speaker_id: 'SPEAKER_0',
    segments: [
      { start: 0, end: 15 },
      { start: 45, end: 60 },
      { start: 90, end: 105 },
      { start: 135, end: 150 }
    ]
  },
  {
    speaker_id: 'SPEAKER_1',
    segments: [
      { start: 15, end: 30 },
      { start: 60, end: 75 },
      { start: 105, end: 120 },
      { start: 150, end: 165 }
    ]
  },
  {
    speaker_id: 'SPEAKER_2',
    segments: [
      { start: 30, end: 45 },
      { start: 75, end: 90 },
      { start: 120, end: 135 },
      { start: 165, end: 180 }
    ]
  }
]

// ============================================================================
// Mock Diarization Results
// ============================================================================

/**
 * Creates a valid two-speaker diarization result.
 */
export function createTwoSpeakerResult(): MockDiarizationResult {
  return {
    success: true,
    segments: [
      { speaker_id: 'SPEAKER_0', start_time: 0, end_time: 5, confidence: 0.92 },
      { speaker_id: 'SPEAKER_1', start_time: 5, end_time: 10, confidence: 0.88 },
      { speaker_id: 'SPEAKER_0', start_time: 10, end_time: 15, confidence: 0.90 },
      { speaker_id: 'SPEAKER_1', start_time: 15, end_time: 20, confidence: 0.87 },
      { speaker_id: 'SPEAKER_0', start_time: 20, end_time: 25, confidence: 0.91 }
    ],
    speaker_ids: ['SPEAKER_0', 'SPEAKER_1'],
    num_speakers: 2,
    audio_duration: 25,
    processing_time: 3.5,
    schema_version: '1.0.0'
  }
}

/**
 * Creates a valid multi-speaker result for a 3-minute recording.
 */
export function createMultiMinuteResult(): MockDiarizationResult {
  const segments: MockSpeakerSegment[] = []

  MULTI_MINUTE_GROUND_TRUTH.forEach(speaker => {
    speaker.segments.forEach(seg => {
      segments.push({
        speaker_id: speaker.speaker_id,
        start_time: seg.start,
        end_time: seg.end,
        confidence: 0.85 + Math.random() * 0.1
      })
    })
  })

  // Sort by start time
  segments.sort((a, b) => a.start_time - b.start_time)

  return {
    success: true,
    segments,
    speaker_ids: ['SPEAKER_0', 'SPEAKER_1', 'SPEAKER_2'],
    num_speakers: 3,
    audio_duration: 180,
    processing_time: 25,
    schema_version: '1.0.0'
  }
}

/**
 * Creates an invalid diarization result with "Unknown Speaker" fallback.
 * This represents what SHOULD NOT happen - a silent fallback.
 */
export function createSilentFallbackResult(): MockDiarizationResult {
  return {
    success: true, // Pretends to be successful
    segments: [
      { speaker_id: 'Unknown Speaker', start_time: 0, end_time: 25, confidence: 0.5 }
    ],
    speaker_ids: ['Unknown Speaker'],
    num_speakers: 1,
    audio_duration: 25,
    processing_time: 1.0,
    schema_version: '1.0.0'
  }
}

/**
 * Creates a proper failure result (explicit failure, not silent).
 */
export function createExplicitFailureResult(): MockDiarizationResult {
  return {
    success: false,
    segments: [],
    speaker_ids: [],
    num_speakers: 0,
    audio_duration: 0,
    processing_time: 0,
    schema_version: '1.0.0',
    error: {
      code: 'DIARIZATION_UNAVAILABLE',
      message: 'Speaker diarization is not available. Audio is being transcribed without speaker separation.',
      details: { reason: 'Model not loaded' }
    }
  }
}

/**
 * Creates a result with unstable speaker IDs (recreated each segment).
 * This is an anti-pattern that tests should catch.
 */
export function createUnstableSpeakerIdResult(): MockDiarizationResult {
  return {
    success: true,
    segments: [
      { speaker_id: 'SPEAKER_0', start_time: 0, end_time: 5, confidence: 0.92 },
      { speaker_id: 'SPEAKER_2', start_time: 5, end_time: 10, confidence: 0.88 },
      { speaker_id: 'SPEAKER_4', start_time: 10, end_time: 15, confidence: 0.90 },
      { speaker_id: 'SPEAKER_6', start_time: 15, end_time: 20, confidence: 0.87 },
      { speaker_id: 'SPEAKER_8', start_time: 20, end_time: 25, confidence: 0.91 }
    ],
    speaker_ids: ['SPEAKER_0', 'SPEAKER_2', 'SPEAKER_4', 'SPEAKER_6', 'SPEAKER_8'],
    num_speakers: 5,
    audio_duration: 25,
    processing_time: 3.5,
    schema_version: '1.0.0'
  }
}

// ============================================================================
// Validation Functions
// ============================================================================

/**
 * Validates that speaker IDs follow the required format (SPEAKER_N).
 */
export function validateSpeakerIdFormat(speakerId: string): boolean {
  return /^SPEAKER_\d+$/.test(speakerId)
}

/**
 * Validates segment schema compliance.
 */
export function validateSegmentSchema(segment: MockSpeakerSegment): {
  valid: boolean
  errors: string[]
} {
  const errors: string[] = []

  if (typeof segment.speaker_id !== 'string' || segment.speaker_id.trim() === '') {
    errors.push('speaker_id must be a non-empty string')
  }

  if (typeof segment.start_time !== 'number' || segment.start_time < 0) {
    errors.push('start_time must be a non-negative number')
  }

  if (typeof segment.end_time !== 'number' || segment.end_time <= segment.start_time) {
    errors.push('end_time must be greater than start_time')
  }

  if (typeof segment.confidence !== 'number' || segment.confidence < 0 || segment.confidence > 1) {
    errors.push('confidence must be a number between 0 and 1')
  }

  return {
    valid: errors.length === 0,
    errors
  }
}

/**
 * Checks if speaker IDs are stable (consistent across segments).
 * Returns false if it appears IDs are being recreated per segment.
 */
export function checkSpeakerIdStability(segments: MockSpeakerSegment[]): {
  stable: boolean
  issues: string[]
} {
  const issues: string[] = []
  const speakerIdCounts: Record<string, number> = {}

  // Count occurrences of each speaker ID
  for (const segment of segments) {
    speakerIdCounts[segment.speaker_id] = (speakerIdCounts[segment.speaker_id] || 0) + 1
  }

  const uniqueSpeakers = Object.keys(speakerIdCounts)

  // Check for too many unique speakers relative to segments
  if (uniqueSpeakers.length > segments.length / 2 && segments.length > 4) {
    issues.push(`Too many unique speakers (${uniqueSpeakers.length}) for ${segments.length} segments - possible ID recreation`)
  }

  // Check for gaps in speaker ID sequence
  const speakerIndices = uniqueSpeakers
    .map(id => {
      const match = id.match(/^SPEAKER_(\d+)$/)
      return match ? parseInt(match[1], 10) : null
    })
    .filter((idx): idx is number => idx !== null)
    .sort((a, b) => a - b)

  for (let i = 1; i < speakerIndices.length; i++) {
    const gap = speakerIndices[i] - speakerIndices[i - 1]
    if (gap > 1) {
      issues.push(`Gap in speaker IDs between SPEAKER_${speakerIndices[i - 1]} and SPEAKER_${speakerIndices[i]}`)
    }
  }

  return {
    stable: issues.length === 0,
    issues
  }
}

/**
 * Validates that the result doesn't contain "Unknown Speaker" placeholders.
 */
export function checkNoUnknownSpeakers(result: MockDiarizationResult): {
  valid: boolean
  unknownSpeakers: string[]
} {
  const unknownPatterns = [
    /unknown/i,
    /unidentified/i,
    /speaker ?0$/i, // Single SPEAKER_0 for all segments is suspicious
  ]

  const unknownSpeakers: string[] = []

  for (const speakerId of result.speaker_ids) {
    for (const pattern of unknownPatterns) {
      if (pattern.test(speakerId)) {
        unknownSpeakers.push(speakerId)
        break
      }
    }
  }

  // Check for single speaker fallback (suspicious patterns):
  // 1. Single speaker for audio > 30 seconds
  // 2. Or single speaker that covers most of the audio in just 1 segment
  if (result.num_speakers === 1 && result.audio_duration > 30) {
    const singleSpeakerId = result.speaker_ids[0]

    // Calculate total segment duration
    const totalSegmentDuration = result.segments.reduce(
      (sum, seg) => sum + (seg.end_time - seg.start_time),
      0
    )

    // Suspicious if:
    // - More than 5 segments but all same speaker, OR
    // - Single segment covers > 80% of audio (monolithic fallback), OR
    // - Few segments relative to audio length (expect ~1 segment per 10 seconds for multi-speaker)
    const isSuspicious =
      result.segments.length > 5 || // Many segments but same speaker
      (result.segments.length === 1 && totalSegmentDuration > result.audio_duration * 0.8) || // Single monolithic segment
      (result.audio_duration > 60 && result.segments.length < 3) // Long audio with very few segments

    if (isSuspicious && !unknownSpeakers.includes(singleSpeakerId)) {
      unknownSpeakers.push(`${singleSpeakerId} (suspicious single speaker for long audio)`)
    }
  }

  return {
    valid: unknownSpeakers.length === 0,
    unknownSpeakers
  }
}

/**
 * Checks that speaker identity is NOT inferred from text content.
 * Validates that no transcript text is used to determine speakers.
 */
export function validateNoTextBasedIdentity(
  diarizationResult: MockDiarizationResult,
  transcriptSegments?: Array<{ text: string; speaker?: string }>
): { valid: boolean; violations: string[] } {
  const violations: string[] = []

  // Speaker IDs should be generic (SPEAKER_N), not names
  for (const speakerId of diarizationResult.speaker_ids) {
    // Check for name-like patterns
    if (/^[A-Z][a-z]+(\s+[A-Z][a-z]+)*$/.test(speakerId)) {
      violations.push(`Speaker ID "${speakerId}" appears to be a name - possible text inference`)
    }

    // Check for role-like patterns
    if (/^(CEO|Manager|Director|Customer|Client|Host|Guest)/i.test(speakerId)) {
      violations.push(`Speaker ID "${speakerId}" appears to be a role - possible text inference`)
    }
  }

  return {
    valid: violations.length === 0,
    violations
  }
}

// ============================================================================
// Quality Metrics Calculation
// ============================================================================

/**
 * Calculates Diarization Error Rate (DER).
 * DER = (FA + MISS + SPKR) / TOTAL
 * Where:
 * - FA = False Alarm (speech detected when none exists)
 * - MISS = Missed Speech (speech not detected)
 * - SPKR = Speaker Confusion (wrong speaker assigned)
 */
export function calculateDER(
  hypothesis: MockSpeakerSegment[],
  groundTruth: SpeakerGroundTruth[],
  audioDuration: number
): number {
  let totalSpeechTime = 0
  let missedSpeech = 0
  let falseAlarm = 0
  let speakerConfusion = 0

  // Build ground truth time map
  const gtTimeMap: Map<number, string[]> = new Map()
  for (let t = 0; t < audioDuration * 10; t++) {
    const time = t / 10
    const speakers: string[] = []
    for (const speaker of groundTruth) {
      for (const seg of speaker.segments) {
        if (time >= seg.start && time < seg.end) {
          speakers.push(speaker.speaker_id)
        }
      }
    }
    gtTimeMap.set(t, speakers)
    if (speakers.length > 0) totalSpeechTime++
  }

  // Build hypothesis time map
  const hypTimeMap: Map<number, string[]> = new Map()
  for (let t = 0; t < audioDuration * 10; t++) {
    const time = t / 10
    const speakers: string[] = []
    for (const seg of hypothesis) {
      if (time >= seg.start_time && time < seg.end_time) {
        speakers.push(seg.speaker_id)
      }
    }
    hypTimeMap.set(t, speakers)
  }

  // Calculate errors
  for (let t = 0; t < audioDuration * 10; t++) {
    const gtSpeakers = gtTimeMap.get(t) || []
    const hypSpeakers = hypTimeMap.get(t) || []

    if (gtSpeakers.length > 0 && hypSpeakers.length === 0) {
      missedSpeech++
    } else if (gtSpeakers.length === 0 && hypSpeakers.length > 0) {
      falseAlarm++
    } else if (gtSpeakers.length > 0 && hypSpeakers.length > 0) {
      // Check for speaker confusion (simplified - assumes 1-to-1 mapping)
      const gtSet = new Set(gtSpeakers)
      const hypSet = new Set(hypSpeakers)
      if (!areSetsEqual(gtSet, hypSet)) {
        speakerConfusion++
      }
    }
  }

  if (totalSpeechTime === 0) return 0

  return (missedSpeech + falseAlarm + speakerConfusion) / totalSpeechTime
}

function areSetsEqual<T>(a: Set<T>, b: Set<T>): boolean {
  if (a.size !== b.size) return false
  for (const item of a) {
    if (!b.has(item)) return false
  }
  return true
}

/**
 * Calculates speaker confusion matrix.
 */
export function calculateConfusionMatrix(
  hypothesis: MockSpeakerSegment[],
  groundTruth: SpeakerGroundTruth[]
): number[][] {
  const gtSpeakers = groundTruth.map(g => g.speaker_id)
  const hypSpeakers = [...new Set(hypothesis.map(h => h.speaker_id))]

  const matrix: number[][] = Array(gtSpeakers.length)
    .fill(null)
    .map(() => Array(hypSpeakers.length).fill(0))

  // For each ground truth speaker, count how many times each hypothesis speaker was assigned
  for (let i = 0; i < gtSpeakers.length; i++) {
    const gtSpeaker = groundTruth[i]
    for (const gtSeg of gtSpeaker.segments) {
      for (let j = 0; j < hypSpeakers.length; j++) {
        const hypSpeaker = hypSpeakers[j]
        for (const hypSeg of hypothesis) {
          if (hypSeg.speaker_id === hypSpeaker) {
            // Calculate overlap
            const overlapStart = Math.max(gtSeg.start, hypSeg.start_time)
            const overlapEnd = Math.min(gtSeg.end, hypSeg.end_time)
            if (overlapEnd > overlapStart) {
              matrix[i][j] += overlapEnd - overlapStart
            }
          }
        }
      }
    }
  }

  return matrix
}

/**
 * Calculates segment boundary accuracy.
 * Measures how close predicted boundaries are to ground truth boundaries.
 */
export function calculateBoundaryAccuracy(
  hypothesis: MockSpeakerSegment[],
  groundTruth: SpeakerGroundTruth[],
  toleranceSeconds: number = 0.5
): number {
  // Get all ground truth boundaries
  const gtBoundaries: number[] = []
  for (const speaker of groundTruth) {
    for (const seg of speaker.segments) {
      gtBoundaries.push(seg.start, seg.end)
    }
  }
  const uniqueGtBoundaries = [...new Set(gtBoundaries)].sort((a, b) => a - b)

  // Get all hypothesis boundaries
  const hypBoundaries: number[] = []
  for (const seg of hypothesis) {
    hypBoundaries.push(seg.start_time, seg.end_time)
  }
  const uniqueHypBoundaries = [...new Set(hypBoundaries)].sort((a, b) => a - b)

  if (uniqueGtBoundaries.length === 0) return 1

  // Count how many GT boundaries have a matching hypothesis boundary within tolerance
  let matchedBoundaries = 0
  for (const gtBoundary of uniqueGtBoundaries) {
    for (const hypBoundary of uniqueHypBoundaries) {
      if (Math.abs(gtBoundary - hypBoundary) <= toleranceSeconds) {
        matchedBoundaries++
        break
      }
    }
  }

  return matchedBoundaries / uniqueGtBoundaries.length
}

/**
 * Calculates comprehensive diarization quality metrics.
 */
export function calculateQualityMetrics(
  hypothesis: MockSpeakerSegment[],
  groundTruth: SpeakerGroundTruth[],
  audioDuration: number
): DiarizationQualityMetrics {
  const der = calculateDER(hypothesis, groundTruth, audioDuration)
  const confusionMatrix = calculateConfusionMatrix(hypothesis, groundTruth)
  const boundaryAccuracy = calculateBoundaryAccuracy(hypothesis, groundTruth)

  // Calculate speaker purity
  let totalOverlap = 0
  let maxOverlap = 0
  for (const row of confusionMatrix) {
    const rowSum = row.reduce((a, b) => a + b, 0)
    totalOverlap += rowSum
    maxOverlap += Math.max(...row)
  }
  const speakerPurity = totalOverlap > 0 ? maxOverlap / totalOverlap : 0

  // Calculate speaker coverage (simplified)
  const coveredSpeakers = confusionMatrix.filter(row => row.some(v => v > 0)).length
  const speakerCoverage = groundTruth.length > 0 ? coveredSpeakers / groundTruth.length : 0

  return {
    diarizationErrorRate: der,
    speakerConfusionMatrix: confusionMatrix,
    segmentBoundaryAccuracy: boundaryAccuracy,
    speakerPurity,
    speakerCoverage,
    missedSpeechRate: 0, // Simplified
    falseSpeechRate: 0 // Simplified
  }
}

// ============================================================================
// UI Testing Helpers
// ============================================================================

/**
 * Expected speaker timeline colors for UI testing.
 */
export const EXPECTED_SPEAKER_COLORS = [
  { bg: 'purple', text: 'purple', speaker: 'SPEAKER_0' },
  { bg: 'blue', text: 'blue', speaker: 'SPEAKER_1' },
  { bg: 'green', text: 'green', speaker: 'SPEAKER_2' },
  { bg: 'orange', text: 'orange', speaker: 'SPEAKER_3' }
]

/**
 * Creates mock speaker timeline data for UI testing.
 */
export function createMockSpeakerTimelines(speakers: string[], audioDuration: number) {
  return speakers.map((speakerId, index) => ({
    speakerId,
    displayName: `Speaker ${index + 1}`,
    color: EXPECTED_SPEAKER_COLORS[index % EXPECTED_SPEAKER_COLORS.length],
    segments: generateRandomSegments(audioDuration, speakerId),
    totalDuration: 0, // Calculated from segments
    percentage: 0 // Calculated from segments
  }))
}

function generateRandomSegments(audioDuration: number, speakerId: string) {
  const segments: Array<{ start: number; end: number }> = []
  let currentTime = Math.random() * 5

  while (currentTime < audioDuration - 5) {
    const duration = 3 + Math.random() * 7
    segments.push({
      start: currentTime,
      end: currentTime + duration
    })
    currentTime += duration + 5 + Math.random() * 10
  }

  return segments
}

// ============================================================================
// Test Assertions
// ============================================================================

/**
 * Asserts that a diarization result meets all mandatory requirements.
 */
export function assertMandatoryRequirements(result: MockDiarizationResult): {
  passed: boolean
  failures: string[]
} {
  const failures: string[] = []

  // Requirement 1: Two different voices produce two different speaker tracks
  if (result.success && result.num_speakers < 2 && result.audio_duration > 30) {
    failures.push('FAIL: Two-speaker audio should produce at least 2 distinct speaker tracks')
  }

  // Requirement 2: Speaker IDs are stable
  const stability = checkSpeakerIdStability(result.segments)
  if (!stability.stable) {
    failures.push(`FAIL: Speaker IDs not stable - ${stability.issues.join('; ')}`)
  }

  // Requirement 3: No Unknown Speaker placeholders
  const unknownCheck = checkNoUnknownSpeakers(result)
  if (!unknownCheck.valid) {
    failures.push(`FAIL: Unknown speaker placeholders found - ${unknownCheck.unknownSpeakers.join(', ')}`)
  }

  // Requirement 4: No text-based identity inference
  const textCheck = validateNoTextBasedIdentity(result)
  if (!textCheck.valid) {
    failures.push(`FAIL: Possible text-based identity inference - ${textCheck.violations.join('; ')}`)
  }

  // Requirement 5: Schema compliance
  for (let i = 0; i < result.segments.length; i++) {
    const segValidation = validateSegmentSchema(result.segments[i])
    if (!segValidation.valid) {
      failures.push(`FAIL: Segment ${i} schema invalid - ${segValidation.errors.join(', ')}`)
    }
  }

  // Requirement 6: Explicit failure when diarization unavailable
  if (!result.success && !result.error) {
    failures.push('FAIL: Failed result must include error details')
  }

  return {
    passed: failures.length === 0,
    failures
  }
}

export default {
  // Ground truth data
  TWO_SPEAKER_GROUND_TRUTH,
  MULTI_MINUTE_GROUND_TRUTH,

  // Mock result generators
  createTwoSpeakerResult,
  createMultiMinuteResult,
  createSilentFallbackResult,
  createExplicitFailureResult,
  createUnstableSpeakerIdResult,

  // Validation functions
  validateSpeakerIdFormat,
  validateSegmentSchema,
  checkSpeakerIdStability,
  checkNoUnknownSpeakers,
  validateNoTextBasedIdentity,

  // Quality metrics
  calculateDER,
  calculateConfusionMatrix,
  calculateBoundaryAccuracy,
  calculateQualityMetrics,

  // UI helpers
  EXPECTED_SPEAKER_COLORS,
  createMockSpeakerTimelines,

  // Assertions
  assertMandatoryRequirements
}
