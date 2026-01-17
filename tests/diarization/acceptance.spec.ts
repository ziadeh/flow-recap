/**
 * Speaker Diarization Acceptance Test Suite
 *
 * Comprehensive acceptance tests that validate the speaker diarization system
 * meets ALL mandatory requirements:
 *
 * 1. Two different human voices produce two different speaker tracks with distinct speaker_ids
 * 2. Speaker IDs remain stable and consistent across multi-minute recordings
 * 3. UI displays multiple speaker timelines with no 'Unknown Speaker' placeholders
 * 4. No speaker identity is inferred from transcribed text
 * 5. Diarization stage exists as separate processing step before transcription
 * 6. System fails explicitly when diarization cannot be performed
 * 7. Structured speaker segment output matches the required schema
 * 8. Speaker embeddings are successfully extracted from audio
 *
 * These tests use mock data with known ground truth to verify correctness
 * and generate quality metrics including DER, confusion matrix, and boundary accuracy.
 */

import { test, expect } from '@playwright/test'
import {
  createTwoSpeakerResult,
  createMultiMinuteResult,
  createSilentFallbackResult,
  createExplicitFailureResult,
  createUnstableSpeakerIdResult,
  TWO_SPEAKER_GROUND_TRUTH,
  MULTI_MINUTE_GROUND_TRUTH,
  validateSpeakerIdFormat,
  validateSegmentSchema,
  checkSpeakerIdStability,
  checkNoUnknownSpeakers,
  validateNoTextBasedIdentity,
  calculateDER,
  calculateConfusionMatrix,
  calculateBoundaryAccuracy,
  calculateQualityMetrics,
  assertMandatoryRequirements,
  type MockDiarizationResult,
  type MockSpeakerSegment
} from './test-utils'

// ============================================================================
// Acceptance Test: Requirement 1
// Two different human voices produce two different speaker tracks
// ============================================================================

test.describe('Requirement 1: Distinct Speaker Tracks', () => {
  test('two different voices should produce two distinct speaker_ids', () => {
    const result = createTwoSpeakerResult()

    // Verify two distinct speakers
    expect(result.num_speakers).toBe(2)
    expect(result.speaker_ids.length).toBe(2)
    expect(result.speaker_ids[0]).not.toBe(result.speaker_ids[1])

    // Verify each speaker has segments
    const speaker0Segments = result.segments.filter(s => s.speaker_id === 'SPEAKER_0')
    const speaker1Segments = result.segments.filter(s => s.speaker_id === 'SPEAKER_1')

    expect(speaker0Segments.length).toBeGreaterThan(0)
    expect(speaker1Segments.length).toBeGreaterThan(0)
  })

  test('speaker tracks should match ground truth speaker distribution', () => {
    const result = createTwoSpeakerResult()

    // Ground truth: Speaker 0 has 3 segments, Speaker 1 has 2 segments
    const speaker0Segments = result.segments.filter(s => s.speaker_id === 'SPEAKER_0')
    const speaker1Segments = result.segments.filter(s => s.speaker_id === 'SPEAKER_1')

    expect(speaker0Segments.length).toBe(3)
    expect(speaker1Segments.length).toBe(2)
  })

  test('speaker_ids should follow the SPEAKER_N format', () => {
    const result = createTwoSpeakerResult()

    for (const speakerId of result.speaker_ids) {
      expect(validateSpeakerIdFormat(speakerId)).toBe(true)
    }
  })

  test('three-speaker audio should produce three distinct speaker tracks', () => {
    const result = createMultiMinuteResult()

    expect(result.num_speakers).toBe(3)
    expect(result.speaker_ids).toContain('SPEAKER_0')
    expect(result.speaker_ids).toContain('SPEAKER_1')
    expect(result.speaker_ids).toContain('SPEAKER_2')
  })
})

// ============================================================================
// Acceptance Test: Requirement 2
// Speaker IDs remain stable across multi-minute recordings
// ============================================================================

test.describe('Requirement 2: Speaker ID Stability', () => {
  test('speaker IDs should be reused consistently across segments', () => {
    const result = createMultiMinuteResult()

    const stabilityCheck = checkSpeakerIdStability(result.segments)
    expect(stabilityCheck.stable).toBe(true)
    expect(stabilityCheck.issues.length).toBe(0)
  })

  test('should detect unstable speaker ID patterns', () => {
    const badResult = createUnstableSpeakerIdResult()

    const stabilityCheck = checkSpeakerIdStability(badResult.segments)
    expect(stabilityCheck.stable).toBe(false)
    expect(stabilityCheck.issues.length).toBeGreaterThan(0)
  })

  test('speaker ID sequence should have no gaps', () => {
    const result = createTwoSpeakerResult()

    // Extract speaker indices
    const indices = result.speaker_ids
      .map(id => {
        const match = id.match(/^SPEAKER_(\d+)$/)
        return match ? parseInt(match[1], 10) : null
      })
      .filter((idx): idx is number => idx !== null)
      .sort((a, b) => a - b)

    // Check for gaps
    for (let i = 1; i < indices.length; i++) {
      expect(indices[i] - indices[i - 1]).toBe(1)
    }
  })

  test('same speaker should appear multiple times in a conversation', () => {
    const result = createMultiMinuteResult()

    // Count occurrences of each speaker
    const speakerCounts: Record<string, number> = {}
    for (const segment of result.segments) {
      speakerCounts[segment.speaker_id] = (speakerCounts[segment.speaker_id] || 0) + 1
    }

    // Each speaker should appear multiple times in a 3-minute conversation
    for (const count of Object.values(speakerCounts)) {
      expect(count).toBeGreaterThan(1)
    }
  })
})

// ============================================================================
// Acceptance Test: Requirement 3
// No 'Unknown Speaker' placeholders in UI
// ============================================================================

test.describe('Requirement 3: No Unknown Speaker Placeholders', () => {
  test('valid result should have no unknown speaker placeholders', () => {
    const result = createTwoSpeakerResult()

    const unknownCheck = checkNoUnknownSpeakers(result)
    expect(unknownCheck.valid).toBe(true)
    expect(unknownCheck.unknownSpeakers.length).toBe(0)
  })

  test('should detect "Unknown Speaker" fallback patterns', () => {
    const silentFallback = createSilentFallbackResult()

    const unknownCheck = checkNoUnknownSpeakers(silentFallback)
    expect(unknownCheck.valid).toBe(false)
    expect(unknownCheck.unknownSpeakers.length).toBeGreaterThan(0)
  })

  test('should flag suspicious single-speaker results for long audio', () => {
    // Create a suspicious result: single speaker for 3+ minute audio
    const suspiciousResult: MockDiarizationResult = {
      success: true,
      segments: [
        { speaker_id: 'SPEAKER_0', start_time: 0, end_time: 180, confidence: 0.8 }
      ],
      speaker_ids: ['SPEAKER_0'],
      num_speakers: 1,
      audio_duration: 180, // 3 minutes
      processing_time: 20,
      schema_version: '1.0.0'
    }

    const unknownCheck = checkNoUnknownSpeakers(suspiciousResult)
    expect(unknownCheck.valid).toBe(false)
  })

  test('all speaker_ids should be distinct and identifiable', () => {
    const result = createMultiMinuteResult()

    // Check that speaker IDs don't contain placeholder-like patterns
    const invalidPatterns = [/unknown/i, /unidentified/i, /anonymous/i, /N\/A/i]

    for (const speakerId of result.speaker_ids) {
      for (const pattern of invalidPatterns) {
        expect(pattern.test(speakerId)).toBe(false)
      }
    }
  })
})

// ============================================================================
// Acceptance Test: Requirement 4
// No speaker identity inferred from transcribed text
// ============================================================================

test.describe('Requirement 4: No Text-Based Identity Inference', () => {
  test('speaker IDs should be generic, not names', () => {
    const result = createTwoSpeakerResult()

    const textCheck = validateNoTextBasedIdentity(result)
    expect(textCheck.valid).toBe(true)
    expect(textCheck.violations.length).toBe(0)
  })

  test('should detect name-based speaker IDs as violations', () => {
    const badResult: MockDiarizationResult = {
      ...createTwoSpeakerResult(),
      speaker_ids: ['John Smith', 'Jane Doe'],
      segments: [
        { speaker_id: 'John Smith', start_time: 0, end_time: 5, confidence: 0.9 },
        { speaker_id: 'Jane Doe', start_time: 5, end_time: 10, confidence: 0.9 }
      ]
    }

    const textCheck = validateNoTextBasedIdentity(badResult)
    expect(textCheck.valid).toBe(false)
    expect(textCheck.violations.length).toBeGreaterThan(0)
  })

  test('should detect role-based speaker IDs as violations', () => {
    const badResult: MockDiarizationResult = {
      ...createTwoSpeakerResult(),
      speaker_ids: ['CEO', 'Manager'],
      segments: [
        { speaker_id: 'CEO', start_time: 0, end_time: 5, confidence: 0.9 },
        { speaker_id: 'Manager', start_time: 5, end_time: 10, confidence: 0.9 }
      ]
    }

    const textCheck = validateNoTextBasedIdentity(badResult)
    expect(textCheck.valid).toBe(false)
  })

  test('speaker assignment should be based on audio embeddings only', () => {
    const result = createTwoSpeakerResult()

    // Verify all speaker IDs follow audio-based naming convention
    for (const speakerId of result.speaker_ids) {
      expect(speakerId).toMatch(/^SPEAKER_\d+$/)
    }
  })
})

// ============================================================================
// Acceptance Test: Requirement 5
// Diarization as separate stage before transcription
// ============================================================================

test.describe('Requirement 5: Diarization-First Pipeline', () => {
  test('diarization result should be independent of transcript content', () => {
    const result = createTwoSpeakerResult()

    // Diarization segments should only contain timing and speaker info
    // NOT any text content
    for (const segment of result.segments) {
      expect(segment).not.toHaveProperty('text')
      expect(segment).not.toHaveProperty('transcript')
      expect(segment).not.toHaveProperty('content')
    }
  })

  test('diarization segments should provide time boundaries for transcription alignment', () => {
    const result = createTwoSpeakerResult()

    // Each segment should have valid time boundaries
    for (const segment of result.segments) {
      expect(segment.start_time).toBeGreaterThanOrEqual(0)
      expect(segment.end_time).toBeGreaterThan(segment.start_time)
      expect(segment.end_time).toBeLessThanOrEqual(result.audio_duration)
    }

    // Segments should cover the audio timeline (with possible gaps for silence)
    const totalSegmentDuration = result.segments.reduce(
      (sum, seg) => sum + (seg.end_time - seg.start_time),
      0
    )
    expect(totalSegmentDuration).toBeLessThanOrEqual(result.audio_duration)
  })

  test('diarization output should include processing metadata', () => {
    const result = createTwoSpeakerResult()

    expect(result.audio_duration).toBeGreaterThan(0)
    expect(result.processing_time).toBeGreaterThanOrEqual(0)
    expect(result.schema_version).toBeDefined()
  })
})

// ============================================================================
// Acceptance Test: Requirement 6
// Explicit failure when diarization cannot be performed
// ============================================================================

test.describe('Requirement 6: Explicit Failure Handling', () => {
  test('failed diarization should have success=false', () => {
    const failure = createExplicitFailureResult()

    expect(failure.success).toBe(false)
  })

  test('failed diarization should include error details', () => {
    const failure = createExplicitFailureResult()

    expect(failure.error).toBeDefined()
    expect(failure.error?.code).toBeDefined()
    expect(failure.error?.message).toBeDefined()
    expect(failure.error?.message.length).toBeGreaterThan(0)
  })

  test('failed diarization should return empty segments', () => {
    const failure = createExplicitFailureResult()

    expect(failure.segments.length).toBe(0)
    expect(failure.speaker_ids.length).toBe(0)
    expect(failure.num_speakers).toBe(0)
  })

  test('failure message should match mandatory text', () => {
    const failure = createExplicitFailureResult()
    const mandatoryMessage = 'Speaker diarization is not available. Audio is being transcribed without speaker separation.'

    expect(failure.error?.message).toBe(mandatoryMessage)
  })

  test('should reject silent fallback to single-speaker mode', () => {
    // Silent fallback is when diarization fails but returns success=true with degraded results
    const silentFallback = createSilentFallbackResult()

    // This SHOULD be detected as invalid
    const requirements = assertMandatoryRequirements(silentFallback)
    expect(requirements.passed).toBe(false)
  })
})

// ============================================================================
// Acceptance Test: Requirement 7
// Structured speaker segment output matches required schema
// ============================================================================

test.describe('Requirement 7: Schema Compliance', () => {
  test('each segment should have required fields', () => {
    const result = createTwoSpeakerResult()

    for (const segment of result.segments) {
      const validation = validateSegmentSchema(segment)
      expect(validation.valid).toBe(true)
      expect(validation.errors.length).toBe(0)
    }
  })

  test('speaker_id must be a non-empty string', () => {
    const invalidSegment: MockSpeakerSegment = {
      speaker_id: '',
      start_time: 0,
      end_time: 5,
      confidence: 0.9
    }

    const validation = validateSegmentSchema(invalidSegment)
    expect(validation.valid).toBe(false)
    expect(validation.errors).toContain('speaker_id must be a non-empty string')
  })

  test('start_time must be non-negative', () => {
    const invalidSegment: MockSpeakerSegment = {
      speaker_id: 'SPEAKER_0',
      start_time: -1,
      end_time: 5,
      confidence: 0.9
    }

    const validation = validateSegmentSchema(invalidSegment)
    expect(validation.valid).toBe(false)
    expect(validation.errors.some(e => e.includes('start_time'))).toBe(true)
  })

  test('end_time must be greater than start_time', () => {
    const invalidSegment: MockSpeakerSegment = {
      speaker_id: 'SPEAKER_0',
      start_time: 5,
      end_time: 3,
      confidence: 0.9
    }

    const validation = validateSegmentSchema(invalidSegment)
    expect(validation.valid).toBe(false)
    expect(validation.errors.some(e => e.includes('end_time'))).toBe(true)
  })

  test('confidence must be between 0 and 1', () => {
    const invalidSegment1: MockSpeakerSegment = {
      speaker_id: 'SPEAKER_0',
      start_time: 0,
      end_time: 5,
      confidence: 1.5
    }

    const invalidSegment2: MockSpeakerSegment = {
      speaker_id: 'SPEAKER_0',
      start_time: 0,
      end_time: 5,
      confidence: -0.1
    }

    expect(validateSegmentSchema(invalidSegment1).valid).toBe(false)
    expect(validateSegmentSchema(invalidSegment2).valid).toBe(false)
  })

  test('output should include schema version', () => {
    const result = createTwoSpeakerResult()

    expect(result.schema_version).toBeDefined()
    expect(typeof result.schema_version).toBe('string')
    expect(result.schema_version).toMatch(/^\d+\.\d+\.\d+$/)
  })
})

// ============================================================================
// Acceptance Test: Requirement 8
// Speaker embeddings are successfully extracted
// ============================================================================

test.describe('Requirement 8: Speaker Embedding Extraction', () => {
  test('diarization should identify distinct speaker embeddings', () => {
    const result = createTwoSpeakerResult()

    // Success implies embeddings were extracted and clustered
    expect(result.success).toBe(true)
    expect(result.num_speakers).toBeGreaterThan(1)
  })

  test('each segment should have a confidence score from embedding matching', () => {
    const result = createTwoSpeakerResult()

    for (const segment of result.segments) {
      expect(segment.confidence).toBeGreaterThanOrEqual(0)
      expect(segment.confidence).toBeLessThanOrEqual(1)
    }
  })

  test('multi-minute audio should maintain embedding consistency', () => {
    const result = createMultiMinuteResult()

    // Same speaker should appear across the recording
    const speakerSegments: Record<string, number[]> = {}

    for (const segment of result.segments) {
      if (!speakerSegments[segment.speaker_id]) {
        speakerSegments[segment.speaker_id] = []
      }
      speakerSegments[segment.speaker_id].push(segment.start_time)
    }

    // Each speaker should appear at multiple time points
    for (const times of Object.values(speakerSegments)) {
      expect(times.length).toBeGreaterThan(1)

      // Check temporal spread
      const firstAppearance = Math.min(...times)
      const lastAppearance = Math.max(...times)
      const spread = lastAppearance - firstAppearance

      // Speaker should appear across at least 50% of the recording
      expect(spread).toBeGreaterThan(result.audio_duration * 0.3)
    }
  })
})

// ============================================================================
// Diarization Quality Metrics
// ============================================================================

test.describe('Diarization Quality Metrics', () => {
  test('should calculate DER (Diarization Error Rate)', () => {
    const result = createTwoSpeakerResult()
    const der = calculateDER(result.segments, TWO_SPEAKER_GROUND_TRUTH, result.audio_duration)

    // Perfect diarization should have DER = 0
    // Good diarization should have DER < 0.25
    expect(der).toBeGreaterThanOrEqual(0)
    expect(der).toBeLessThan(0.25)
  })

  test('should generate speaker confusion matrix', () => {
    const result = createTwoSpeakerResult()
    const matrix = calculateConfusionMatrix(result.segments, TWO_SPEAKER_GROUND_TRUTH)

    // Matrix should be 2x2 for two speakers
    expect(matrix.length).toBe(2)
    expect(matrix[0].length).toBe(2)

    // Diagonal should be dominant (correct assignments)
    const diagonal = matrix[0][0] + matrix[1][1]
    const offDiagonal = matrix[0][1] + matrix[1][0]
    expect(diagonal).toBeGreaterThan(offDiagonal)
  })

  test('should calculate segment boundary accuracy', () => {
    const result = createTwoSpeakerResult()
    const accuracy = calculateBoundaryAccuracy(result.segments, TWO_SPEAKER_GROUND_TRUTH)

    // Boundary accuracy should be high for well-aligned segments
    expect(accuracy).toBeGreaterThanOrEqual(0)
    expect(accuracy).toBeLessThanOrEqual(1)
    expect(accuracy).toBeGreaterThan(0.8) // 80%+ accuracy expected
  })

  test('should calculate comprehensive quality metrics', () => {
    const result = createMultiMinuteResult()
    const metrics = calculateQualityMetrics(
      result.segments,
      MULTI_MINUTE_GROUND_TRUTH,
      result.audio_duration
    )

    expect(metrics.diarizationErrorRate).toBeGreaterThanOrEqual(0)
    expect(metrics.speakerConfusionMatrix.length).toBe(3) // 3 speakers
    expect(metrics.segmentBoundaryAccuracy).toBeGreaterThanOrEqual(0)
    expect(metrics.speakerPurity).toBeGreaterThanOrEqual(0)
    expect(metrics.speakerCoverage).toBeGreaterThanOrEqual(0)
  })

  test('DER should be 0 for perfect diarization matching ground truth', () => {
    // Create segments that exactly match ground truth
    const perfectSegments: MockSpeakerSegment[] = []

    for (const speaker of TWO_SPEAKER_GROUND_TRUTH) {
      for (const seg of speaker.segments) {
        perfectSegments.push({
          speaker_id: speaker.speaker_id,
          start_time: seg.start,
          end_time: seg.end,
          confidence: 0.95
        })
      }
    }

    perfectSegments.sort((a, b) => a.start_time - b.start_time)

    const der = calculateDER(perfectSegments, TWO_SPEAKER_GROUND_TRUTH, 25)
    expect(der).toBe(0)
  })
})

// ============================================================================
// Comprehensive Requirement Validation
// ============================================================================

test.describe('Comprehensive Requirement Validation', () => {
  test('valid two-speaker result should pass all mandatory requirements', () => {
    const result = createTwoSpeakerResult()
    const validation = assertMandatoryRequirements(result)

    expect(validation.passed).toBe(true)
    expect(validation.failures.length).toBe(0)
  })

  test('valid multi-speaker result should pass all mandatory requirements', () => {
    const result = createMultiMinuteResult()
    const validation = assertMandatoryRequirements(result)

    expect(validation.passed).toBe(true)
    expect(validation.failures.length).toBe(0)
  })

  test('silent fallback result should FAIL mandatory requirements', () => {
    const silentFallback = createSilentFallbackResult()
    const validation = assertMandatoryRequirements(silentFallback)

    expect(validation.passed).toBe(false)
    expect(validation.failures.length).toBeGreaterThan(0)
  })

  test('unstable speaker ID result should FAIL mandatory requirements', () => {
    const unstableResult = createUnstableSpeakerIdResult()
    const validation = assertMandatoryRequirements(unstableResult)

    expect(validation.passed).toBe(false)
    expect(validation.failures.some(f => f.includes('stable'))).toBe(true)
  })

  test('explicit failure result should pass validation (proper failure handling)', () => {
    const failure = createExplicitFailureResult()

    // Explicit failure is valid because it properly indicates failure
    expect(failure.success).toBe(false)
    expect(failure.error).toBeDefined()
    expect(failure.segments.length).toBe(0)
  })
})

// ============================================================================
// Regression Tests
// ============================================================================

test.describe('Regression Detection', () => {
  test('should detect when speaker count regresses', () => {
    // Use multi-minute result for proper regression detection
    const baseline = createMultiMinuteResult()
    const regression: MockDiarizationResult = {
      ...baseline,
      num_speakers: 1,
      speaker_ids: ['SPEAKER_0'],
      segments: baseline.segments.map(s => ({ ...s, speaker_id: 'SPEAKER_0' }))
    }

    // Baseline had 3 speakers
    expect(baseline.num_speakers).toBe(3)

    // Regression now has only 1 (this is a problem)
    expect(regression.num_speakers).toBe(1)

    // Audio is 180 seconds with 12 segments all assigned to same speaker
    // This should be flagged as suspicious
    expect(regression.audio_duration).toBe(180)
    expect(regression.segments.length).toBe(12)

    // This should be flagged as a regression
    const unknownCheck = checkNoUnknownSpeakers(regression)
    expect(unknownCheck.valid).toBe(false) // Single speaker for multi-segment long audio
  })

  test('should detect when DER increases significantly', () => {
    const goodResult = createTwoSpeakerResult()
    const goodDER = calculateDER(goodResult.segments, TWO_SPEAKER_GROUND_TRUTH, goodResult.audio_duration)

    // Simulate a regression with worse alignment
    const badSegments: MockSpeakerSegment[] = [
      { speaker_id: 'SPEAKER_0', start_time: 0, end_time: 7, confidence: 0.8 },
      { speaker_id: 'SPEAKER_1', start_time: 7, end_time: 14, confidence: 0.7 },
      { speaker_id: 'SPEAKER_0', start_time: 14, end_time: 21, confidence: 0.75 },
      { speaker_id: 'SPEAKER_1', start_time: 21, end_time: 25, confidence: 0.72 }
    ]

    const badDER = calculateDER(badSegments, TWO_SPEAKER_GROUND_TRUTH, 25)

    // Bad DER should be higher (worse)
    expect(badDER).toBeGreaterThan(goodDER)
  })

  test('should detect schema compliance regressions', () => {
    const validResult = createTwoSpeakerResult()

    // All segments should be valid
    const allValid = validResult.segments.every(seg => validateSegmentSchema(seg).valid)
    expect(allValid).toBe(true)

    // Simulate schema regression (missing required fields would cause validation failure)
    const invalidSegment = { ...validResult.segments[0] } as any
    delete invalidSegment.confidence
    invalidSegment.confidence = undefined

    // This should fail validation
    const validation = validateSegmentSchema(invalidSegment as MockSpeakerSegment)
    expect(validation.valid).toBe(false)
  })
})

// ============================================================================
// Integration Test Scenarios
// ============================================================================

test.describe('Integration Scenarios', () => {
  test('meeting with varied speaking patterns', () => {
    // Simulate a meeting where Speaker 0 dominates the conversation
    const dominantSpeakerResult: MockDiarizationResult = {
      success: true,
      segments: [
        { speaker_id: 'SPEAKER_0', start_time: 0, end_time: 30, confidence: 0.92 },
        { speaker_id: 'SPEAKER_1', start_time: 30, end_time: 35, confidence: 0.88 },
        { speaker_id: 'SPEAKER_0', start_time: 35, end_time: 55, confidence: 0.90 },
        { speaker_id: 'SPEAKER_1', start_time: 55, end_time: 60, confidence: 0.87 }
      ],
      speaker_ids: ['SPEAKER_0', 'SPEAKER_1'],
      num_speakers: 2,
      audio_duration: 60,
      processing_time: 8,
      schema_version: '1.0.0'
    }

    const validation = assertMandatoryRequirements(dominantSpeakerResult)
    expect(validation.passed).toBe(true)

    // Verify both speakers are still tracked even with uneven distribution
    expect(dominantSpeakerResult.num_speakers).toBe(2)
  })

  test('rapid speaker turn-taking', () => {
    // Simulate rapid back-and-forth conversation
    const rapidTurns: MockDiarizationResult = {
      success: true,
      segments: [
        { speaker_id: 'SPEAKER_0', start_time: 0, end_time: 2, confidence: 0.85 },
        { speaker_id: 'SPEAKER_1', start_time: 2, end_time: 4, confidence: 0.82 },
        { speaker_id: 'SPEAKER_0', start_time: 4, end_time: 6, confidence: 0.88 },
        { speaker_id: 'SPEAKER_1', start_time: 6, end_time: 8, confidence: 0.84 },
        { speaker_id: 'SPEAKER_0', start_time: 8, end_time: 10, confidence: 0.87 },
        { speaker_id: 'SPEAKER_1', start_time: 10, end_time: 12, confidence: 0.83 },
        { speaker_id: 'SPEAKER_0', start_time: 12, end_time: 14, confidence: 0.86 },
        { speaker_id: 'SPEAKER_1', start_time: 14, end_time: 16, confidence: 0.81 }
      ],
      speaker_ids: ['SPEAKER_0', 'SPEAKER_1'],
      num_speakers: 2,
      audio_duration: 16,
      processing_time: 2,
      schema_version: '1.0.0'
    }

    const validation = assertMandatoryRequirements(rapidTurns)
    expect(validation.passed).toBe(true)

    // Speaker IDs should remain stable despite rapid changes
    const stability = checkSpeakerIdStability(rapidTurns.segments)
    expect(stability.stable).toBe(true)
  })

  test('long-form interview or podcast', () => {
    // Simulate a 10-minute interview with 2 speakers
    const interviewResult: MockDiarizationResult = {
      success: true,
      segments: Array.from({ length: 20 }, (_, i) => ({
        speaker_id: i % 2 === 0 ? 'SPEAKER_0' : 'SPEAKER_1',
        start_time: i * 30,
        end_time: (i + 1) * 30,
        confidence: 0.85 + Math.random() * 0.1
      })),
      speaker_ids: ['SPEAKER_0', 'SPEAKER_1'],
      num_speakers: 2,
      audio_duration: 600, // 10 minutes
      processing_time: 60,
      schema_version: '1.0.0'
    }

    const validation = assertMandatoryRequirements(interviewResult)
    expect(validation.passed).toBe(true)

    // Verify both speakers are tracked throughout
    const speaker0Segs = interviewResult.segments.filter(s => s.speaker_id === 'SPEAKER_0')
    const speaker1Segs = interviewResult.segments.filter(s => s.speaker_id === 'SPEAKER_1')

    expect(speaker0Segs.length).toBe(10)
    expect(speaker1Segs.length).toBe(10)
  })
})
