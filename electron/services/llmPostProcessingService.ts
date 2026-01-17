/**
 * LLM Post-Processing Service for Speaker Diarization
 *
 * This service implements an LLM-based post-processing layer that consumes
 * structured diarization output to maintain speaker consistency and resolve
 * ambiguous segments.
 *
 * CRITICAL GUARDRAILS - The LLM MUST NOT:
 * - Extract speaker embeddings from audio
 * - Decide speaker identity from transcribed text alone
 * - Create speaker IDs without diarization data
 * - Override high-confidence diarization results
 *
 * The LLM MAY:
 * - Maintain speaker identity mappings across sessions
 * - Resolve overlapping speech segments by choosing most likely speaker
 * - Handle low-confidence diarization segments by considering context
 * - Assist UI decisions about speaker display order
 * - Generate speaker-aware summaries and action items
 *
 * Uses LM Studio for local LLM inference to maintain on-device processing.
 */

import type {
  MandatoryDiarizationSegment,
  DiarizationOutput,
  SpeakerIdRegistry,
  ValidationResult
} from './diarizationOutputSchema'

import { llmRoutingService } from './llm/llmRoutingService'

// ============================================================================
// Types
// ============================================================================

/**
 * LM Studio configuration for local inference
 */
export interface LMStudioConfig {
  /** Base URL for LM Studio server (default: http://localhost:1234) */
  baseUrl: string
  /** Model identifier (depends on loaded model in LM Studio) */
  modelId?: string
  /** Maximum tokens to generate */
  maxTokens: number
  /** Temperature for response randomness (0.0 - 1.0) */
  temperature: number
  /** Request timeout in milliseconds */
  timeout: number
}

/**
 * Confidence threshold configuration
 */
export interface ConfidenceThresholds {
  /** Below this, segment is considered low-confidence and may be processed by LLM */
  lowConfidenceThreshold: number
  /** Above this, LLM MUST NOT override the diarization result */
  highConfidenceThreshold: number
  /** Minimum overlap duration to consider segments as overlapping */
  minOverlapDuration: number
}

/**
 * Speaker identity mapping for cross-session consistency
 */
export interface SpeakerIdentityMapping {
  /** Session-local speaker ID (e.g., SPEAKER_0) */
  sessionSpeakerId: string
  /** Persistent speaker identifier if known */
  persistentSpeakerId?: string
  /** User-assigned label if available */
  userLabel?: string
  /** Speaking style characteristics from context */
  speakingCharacteristics?: string[]
  /** First appearance timestamp */
  firstSeen: number
  /** Last appearance timestamp */
  lastSeen: number
  /** Total speaking duration in seconds */
  totalDuration: number
  /** Average confidence across segments */
  averageConfidence: number
}

/**
 * Overlapping speech resolution result
 */
export interface OverlapResolution {
  /** Original overlapping segment indices */
  overlappingSegmentIndices: number[]
  /** Time range of overlap */
  overlapTimeRange: { start: number; end: number }
  /** LLM's recommended primary speaker */
  recommendedPrimarySpeaker: string
  /** Reasoning for the decision */
  reasoning: string
  /** Confidence in the resolution (0-1) */
  resolutionConfidence: number
  /** Whether this was actually applied */
  applied: boolean
}

/**
 * Low-confidence segment resolution
 */
export interface LowConfidenceResolution {
  /** Index of the low-confidence segment */
  segmentIndex: number
  /** Original diarization result */
  originalSpeakerId: string
  /** Original confidence */
  originalConfidence: number
  /** LLM's suggested speaker based on context */
  suggestedSpeakerId: string | null
  /** Reasoning for suggestion */
  reasoning: string
  /** Whether the suggestion was applied */
  applied: boolean
}

/**
 * Speaker display order recommendation
 */
export interface SpeakerDisplayOrder {
  /** Ordered list of speaker IDs by prominence */
  order: string[]
  /** Reasoning for the order */
  reasoning: string
  /** Metrics used for ordering */
  metrics: {
    speakerId: string
    totalDuration: number
    segmentCount: number
    averageConfidence: number
    firstAppearance: number
  }[]
}

/**
 * Speaker-aware summary item
 */
export interface SpeakerAwareSummaryItem {
  /** Type of item (summary, action, decision, etc.) */
  type: 'summary' | 'action_item' | 'decision' | 'question' | 'key_point'
  /** Content of the item */
  content: string
  /** Speaker(s) associated with this item */
  speakers: string[]
  /** Time range if applicable */
  timeRange?: { start: number; end: number }
  /** Priority for action items */
  priority?: 'high' | 'medium' | 'low'
}

/**
 * Complete post-processing result
 */
export interface LLMPostProcessingResult {
  /** Whether processing was successful */
  success: boolean
  /** Error message if failed */
  error?: string
  /** Speaker identity mappings */
  speakerMappings: SpeakerIdentityMapping[]
  /** Overlap resolutions applied */
  overlapResolutions: OverlapResolution[]
  /** Low-confidence resolutions applied */
  lowConfidenceResolutions: LowConfidenceResolution[]
  /** Recommended speaker display order */
  displayOrder?: SpeakerDisplayOrder
  /** Speaker-aware summary items */
  summaryItems?: SpeakerAwareSummaryItem[]
  /** Processing metadata */
  metadata: {
    processingTimeMs: number
    llmRequestCount: number
    guardrailViolations: GuardrailViolation[]
    diarizationSchemaVersion: string
  }
}

/**
 * Guardrail violation record
 */
export interface GuardrailViolation {
  /** Type of violation */
  type: 'speaker_invention' | 'confidence_override' | 'identity_assumption' | 'embedding_attempt'
  /** Description of what was attempted */
  attemptedAction: string
  /** What was blocked */
  blockedReason: string
  /** Timestamp */
  timestamp: number
}

/**
 * LLM request for the post-processing service
 */
interface LLMRequest {
  prompt: string
  systemPrompt: string
  maxTokens?: number
  temperature?: number
}

/**
 * LLM response structure
 */
interface LLMResponse {
  success: boolean
  content?: string
  error?: string
  tokensUsed?: number
}

// ============================================================================
// Default Configuration
// ============================================================================

const DEFAULT_LM_STUDIO_CONFIG: LMStudioConfig = {
  baseUrl: 'http://localhost:1234',
  maxTokens: 2048,
  temperature: 0.3, // Lower temperature for more consistent results
  timeout: 30000
}

const DEFAULT_CONFIDENCE_THRESHOLDS: ConfidenceThresholds = {
  lowConfidenceThreshold: 0.6,
  highConfidenceThreshold: 0.85,
  minOverlapDuration: 0.3 // 300ms minimum overlap
}

// ============================================================================
// System Prompts with Guardrails
// ============================================================================

/**
 * Base system prompt that enforces guardrails
 */
const GUARDRAIL_SYSTEM_PROMPT = `You are an AI assistant that helps process speaker diarization results from audio analysis.

CRITICAL CONSTRAINTS - YOU MUST FOLLOW THESE RULES:

1. RESPECT DIARIZATION OUTPUT AS GROUND TRUTH
   - The diarization system has already identified speakers using audio embeddings
   - Speaker IDs (SPEAKER_0, SPEAKER_1, etc.) are assigned by the diarization model
   - You MUST NOT invent new speaker IDs that don't exist in the diarization data

2. NEVER OVERRIDE HIGH-CONFIDENCE RESULTS
   - If a segment has confidence >= 0.85, treat it as definitive
   - Do not suggest changes to high-confidence speaker assignments
   - Only provide suggestions for low-confidence segments (< 0.6)

3. DO NOT IDENTIFY SPEAKERS BY TEXT CONTENT
   - You cannot determine who is speaking based on what they said
   - Names mentioned in transcripts do not indicate who the speaker is
   - Only use diarization confidence and temporal context

4. DO NOT CREATE SPEAKER INFORMATION
   - Never invent speaker names, roles, or identities
   - Only work with the speaker IDs provided by diarization
   - User-provided labels must come from external sources, not inference

5. AUDIO EMBEDDING IS OFF-LIMITS
   - You do not have access to audio data
   - You cannot extract or analyze speaker voice characteristics
   - All speaker identity information comes from the diarization system

When asked to process diarization data, respond ONLY with valid JSON as specified.
If you cannot complete a task within these constraints, respond with {"error": "Cannot complete within guardrails", "reason": "<explanation>"}.
`

/**
 * Prompt for resolving overlapping speech segments
 */
const OVERLAP_RESOLUTION_PROMPT = `Given the following overlapping speech segments from diarization, analyze the temporal context to suggest which speaker should be considered the primary speaker during the overlap.

RULES:
- Only consider speakers that exist in the diarization data
- Consider which speaker was speaking before and after the overlap
- Consider segment duration and confidence scores
- For near-equal overlaps, prefer the speaker with higher confidence
- If uncertain, respond with the first speaker listed

Overlapping Segments:
{SEGMENTS_JSON}

Context (segments before and after):
{CONTEXT_JSON}

Respond with JSON only:
{
  "primarySpeaker": "SPEAKER_X",
  "reasoning": "Brief explanation based on temporal context only",
  "confidence": 0.0 to 1.0
}`

/**
 * Prompt for handling low-confidence segments
 */
const LOW_CONFIDENCE_PROMPT = `Given a low-confidence diarization segment, analyze the surrounding context to determine if the speaker assignment seems consistent.

RULES:
- Only suggest speakers that exist in the diarization data
- Consider temporal proximity to adjacent segments
- Consider speaker patterns (e.g., back-and-forth conversation)
- If the original assignment seems reasonable, keep it
- Never invent new speakers

Low-Confidence Segment:
{SEGMENT_JSON}

Surrounding Context:
{CONTEXT_JSON}

Available Speakers: {SPEAKERS_LIST}

Respond with JSON only:
{
  "keepOriginal": true/false,
  "suggestedSpeaker": "SPEAKER_X or null if keepOriginal is true",
  "reasoning": "Brief explanation based on temporal context only",
  "confidence": 0.0 to 1.0
}`

/**
 * Prompt for generating speaker display order
 */
const DISPLAY_ORDER_PROMPT = `Given speaker statistics from a diarization session, suggest an appropriate display order for the UI.

RULES:
- Order should prioritize speakers with more speaking time
- Consider the order of first appearance as a tiebreaker
- Include all speakers from the diarization data
- Do not add any speakers not in the data

Speaker Statistics:
{STATS_JSON}

Respond with JSON only:
{
  "order": ["SPEAKER_X", "SPEAKER_Y", ...],
  "reasoning": "Brief explanation of ordering criteria"
}`

/**
 * Prompt for generating speaker-aware summaries
 */
const SUMMARY_PROMPT = `Given diarized transcript segments, generate speaker-aware summary items.

RULES:
- Only reference speakers that appear in the transcript
- Action items should be attributed to the speaker who said them
- Do not assume speaker identities or roles from content
- Keep attributions factual based on speaker IDs only

Transcript Segments:
{TRANSCRIPT_JSON}

Speakers Present: {SPEAKERS_LIST}

Respond with JSON only:
{
  "items": [
    {
      "type": "summary|action_item|decision|question|key_point",
      "content": "The content",
      "speakers": ["SPEAKER_X"],
      "timeRange": {"start": 0.0, "end": 0.0} (optional),
      "priority": "high|medium|low" (for action_items only)
    }
  ]
}`

// ============================================================================
// LLM Post-Processing Service
// ============================================================================

class LLMPostProcessingService {
  private config: LMStudioConfig
  private thresholds: ConfidenceThresholds
  private guardrailViolations: GuardrailViolation[] = []
  private llmRequestCount: number = 0
  private isAvailable: boolean = false

  constructor(
    config?: Partial<LMStudioConfig>,
    thresholds?: Partial<ConfidenceThresholds>
  ) {
    this.config = { ...DEFAULT_LM_STUDIO_CONFIG, ...config }
    this.thresholds = { ...DEFAULT_CONFIDENCE_THRESHOLDS, ...thresholds }
  }

  /**
   * Check if LLM service is available (uses intelligent routing)
   */
  async checkAvailability(): Promise<{ available: boolean; error?: string; modelInfo?: string }> {
    try {
      const health = await llmRoutingService.checkHealth(true)

      if (!health.success || !health.data?.healthy) {
        this.isAvailable = false
        return {
          available: false,
          error: health.error || 'No LLM provider is available. Please ensure at least one provider (LM Studio, Claude CLI, or Cursor CLI) is running.'
        }
      }

      this.isAvailable = true
      return {
        available: true,
        modelInfo: health.data.loadedModel || health.data.serverVersion || 'Unknown model'
      }
    } catch (error) {
      this.isAvailable = false
      const errorMessage = error instanceof Error ? error.message : 'Unknown error'
      return {
        available: false,
        error: `Cannot connect to any LLM provider: ${errorMessage}`
      }
    }
  }

  /**
   * Send a request to LLM via routing service (supports automatic fallback)
   */
  private async sendLLMRequest(request: LLMRequest): Promise<LLMResponse> {
    this.llmRequestCount++

    try {
      const response = await llmRoutingService.chatCompletion({
        messages: [
          { role: 'system', content: request.systemPrompt },
          { role: 'user', content: request.prompt }
        ],
        maxTokens: request.maxTokens || this.config.maxTokens,
        temperature: request.temperature || this.config.temperature
      })

      if (!response.success || !response.data) {
        return { success: false, error: response.error || 'LLM request failed' }
      }

      const content = response.data.choices?.[0]?.message?.content || ''
      const tokensUsed = response.data.usage?.totalTokens || 0

      return { success: true, content, tokensUsed }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error'
      return { success: false, error: errorMessage }
    }
  }

  /**
   * Parse JSON response with guardrail validation
   */
  private parseAndValidateResponse<T>(
    content: string,
    validSpeakers: string[]
  ): { valid: boolean; data?: T; error?: string } {
    try {
      // Extract JSON from potential markdown code blocks
      let jsonContent = content.trim()
      if (jsonContent.startsWith('```')) {
        const match = jsonContent.match(/```(?:json)?\s*([\s\S]*?)```/)
        if (match) {
          jsonContent = match[1].trim()
        }
      }

      const data = JSON.parse(jsonContent) as T

      // Check for guardrail violation indicators
      if (typeof data === 'object' && data !== null) {
        const obj = data as Record<string, unknown>

        // Check if response mentions invented speakers
        const checkSpeakerReferences = (value: unknown): boolean => {
          if (typeof value === 'string') {
            if (value.startsWith('SPEAKER_')) {
              return validSpeakers.includes(value)
            }
          } else if (Array.isArray(value)) {
            return value.every(checkSpeakerReferences)
          } else if (typeof value === 'object' && value !== null) {
            return Object.values(value).every(checkSpeakerReferences)
          }
          return true
        }

        if (!checkSpeakerReferences(data)) {
          this.recordGuardrailViolation(
            'speaker_invention',
            'LLM referenced a speaker ID not in diarization data',
            'Blocked response with invalid speaker reference'
          )
          return { valid: false, error: 'Response references speakers not in diarization data' }
        }
      }

      return { valid: true, data }
    } catch (error) {
      return { valid: false, error: `Failed to parse JSON: ${error}` }
    }
  }

  /**
   * Record a guardrail violation
   */
  private recordGuardrailViolation(
    type: GuardrailViolation['type'],
    attemptedAction: string,
    blockedReason: string
  ): void {
    this.guardrailViolations.push({
      type,
      attemptedAction,
      blockedReason,
      timestamp: Date.now()
    })
  }

  /**
   * Build speaker identity mappings from diarization output
   */
  buildSpeakerMappings(output: DiarizationOutput): SpeakerIdentityMapping[] {
    const mappings: Map<string, SpeakerIdentityMapping> = new Map()

    for (const segment of output.segments) {
      const existing = mappings.get(segment.speaker_id)

      if (existing) {
        existing.lastSeen = Math.max(existing.lastSeen, segment.end_time)
        existing.firstSeen = Math.min(existing.firstSeen, segment.start_time)
        existing.totalDuration += segment.end_time - segment.start_time
        // Running average of confidence
        const segmentCount = output.segments.filter(s => s.speaker_id === segment.speaker_id).length
        existing.averageConfidence =
          (existing.averageConfidence * (segmentCount - 1) + segment.confidence) / segmentCount
      } else {
        mappings.set(segment.speaker_id, {
          sessionSpeakerId: segment.speaker_id,
          firstSeen: segment.start_time,
          lastSeen: segment.end_time,
          totalDuration: segment.end_time - segment.start_time,
          averageConfidence: segment.confidence
        })
      }
    }

    return Array.from(mappings.values())
  }

  /**
   * Find overlapping segments in diarization output
   */
  findOverlappingSegments(output: DiarizationOutput): {
    overlapGroups: { indices: number[]; timeRange: { start: number; end: number } }[]
  } {
    const overlapGroups: { indices: number[]; timeRange: { start: number; end: number } }[] = []
    const segments = output.segments
    const processed = new Set<number>()

    for (let i = 0; i < segments.length; i++) {
      if (processed.has(i)) continue

      const overlappingIndices: number[] = [i]
      let overlapStart = segments[i].start_time
      let overlapEnd = segments[i].end_time

      for (let j = i + 1; j < segments.length; j++) {
        if (processed.has(j)) continue

        // Check for overlap
        const oStart = Math.max(segments[i].start_time, segments[j].start_time)
        const oEnd = Math.min(segments[i].end_time, segments[j].end_time)
        const overlapDuration = oEnd - oStart

        if (overlapDuration >= this.thresholds.minOverlapDuration) {
          overlappingIndices.push(j)
          overlapStart = Math.min(overlapStart, segments[j].start_time)
          overlapEnd = Math.max(overlapEnd, segments[j].end_time)
          processed.add(j)
        }
      }

      if (overlappingIndices.length > 1) {
        overlapGroups.push({
          indices: overlappingIndices,
          timeRange: { start: overlapStart, end: overlapEnd }
        })
      }
    }

    return { overlapGroups }
  }

  /**
   * Find low-confidence segments
   */
  findLowConfidenceSegments(output: DiarizationOutput): number[] {
    return output.segments
      .map((seg, idx) => ({ seg, idx }))
      .filter(({ seg }) => seg.confidence < this.thresholds.lowConfidenceThreshold)
      .map(({ idx }) => idx)
  }

  /**
   * Resolve overlapping segments using LLM
   */
  async resolveOverlappingSegments(
    output: DiarizationOutput,
    overlapGroup: { indices: number[]; timeRange: { start: number; end: number } }
  ): Promise<OverlapResolution> {
    const segments = overlapGroup.indices.map(i => output.segments[i])
    const validSpeakers = output.speaker_ids

    // Get context: segments before and after the overlap
    const allSegments = output.segments
    const contextBefore = allSegments
      .filter(s => s.end_time <= overlapGroup.timeRange.start)
      .slice(-3)
    const contextAfter = allSegments
      .filter(s => s.start_time >= overlapGroup.timeRange.end)
      .slice(0, 3)

    const prompt = OVERLAP_RESOLUTION_PROMPT
      .replace('{SEGMENTS_JSON}', JSON.stringify(segments, null, 2))
      .replace('{CONTEXT_JSON}', JSON.stringify({ before: contextBefore, after: contextAfter }, null, 2))

    const response = await this.sendLLMRequest({
      prompt,
      systemPrompt: GUARDRAIL_SYSTEM_PROMPT
    })

    if (!response.success || !response.content) {
      return {
        overlappingSegmentIndices: overlapGroup.indices,
        overlapTimeRange: overlapGroup.timeRange,
        recommendedPrimarySpeaker: segments[0].speaker_id,
        reasoning: 'LLM unavailable, defaulting to first speaker',
        resolutionConfidence: 0.5,
        applied: false
      }
    }

    const parsed = this.parseAndValidateResponse<{
      primarySpeaker: string
      reasoning: string
      confidence: number
    }>(response.content, validSpeakers)

    if (!parsed.valid || !parsed.data) {
      return {
        overlappingSegmentIndices: overlapGroup.indices,
        overlapTimeRange: overlapGroup.timeRange,
        recommendedPrimarySpeaker: segments[0].speaker_id,
        reasoning: `Parse error: ${parsed.error}`,
        resolutionConfidence: 0.5,
        applied: false
      }
    }

    return {
      overlappingSegmentIndices: overlapGroup.indices,
      overlapTimeRange: overlapGroup.timeRange,
      recommendedPrimarySpeaker: parsed.data.primarySpeaker,
      reasoning: parsed.data.reasoning,
      resolutionConfidence: parsed.data.confidence,
      applied: true
    }
  }

  /**
   * Resolve a low-confidence segment using LLM
   */
  async resolveLowConfidenceSegment(
    output: DiarizationOutput,
    segmentIndex: number
  ): Promise<LowConfidenceResolution> {
    const segment = output.segments[segmentIndex]
    const validSpeakers = output.speaker_ids

    // Check guardrail: don't process high-confidence segments
    if (segment.confidence >= this.thresholds.highConfidenceThreshold) {
      this.recordGuardrailViolation(
        'confidence_override',
        `Attempted to process high-confidence segment (${segment.confidence})`,
        'Segment confidence is above threshold, keeping original assignment'
      )
      return {
        segmentIndex,
        originalSpeakerId: segment.speaker_id,
        originalConfidence: segment.confidence,
        suggestedSpeakerId: null,
        reasoning: 'High-confidence segment - guardrail prevented processing',
        applied: false
      }
    }

    // Get surrounding context
    const contextBefore = output.segments
      .filter(s => s.end_time <= segment.start_time)
      .slice(-3)
    const contextAfter = output.segments
      .filter(s => s.start_time >= segment.end_time)
      .slice(0, 3)

    const prompt = LOW_CONFIDENCE_PROMPT
      .replace('{SEGMENT_JSON}', JSON.stringify(segment, null, 2))
      .replace('{CONTEXT_JSON}', JSON.stringify({ before: contextBefore, after: contextAfter }, null, 2))
      .replace('{SPEAKERS_LIST}', validSpeakers.join(', '))

    const response = await this.sendLLMRequest({
      prompt,
      systemPrompt: GUARDRAIL_SYSTEM_PROMPT
    })

    if (!response.success || !response.content) {
      return {
        segmentIndex,
        originalSpeakerId: segment.speaker_id,
        originalConfidence: segment.confidence,
        suggestedSpeakerId: null,
        reasoning: 'LLM unavailable, keeping original assignment',
        applied: false
      }
    }

    const parsed = this.parseAndValidateResponse<{
      keepOriginal: boolean
      suggestedSpeaker: string | null
      reasoning: string
      confidence: number
    }>(response.content, validSpeakers)

    if (!parsed.valid || !parsed.data) {
      return {
        segmentIndex,
        originalSpeakerId: segment.speaker_id,
        originalConfidence: segment.confidence,
        suggestedSpeakerId: null,
        reasoning: `Parse error: ${parsed.error}`,
        applied: false
      }
    }

    return {
      segmentIndex,
      originalSpeakerId: segment.speaker_id,
      originalConfidence: segment.confidence,
      suggestedSpeakerId: parsed.data.keepOriginal ? null : parsed.data.suggestedSpeaker,
      reasoning: parsed.data.reasoning,
      applied: !parsed.data.keepOriginal && parsed.data.suggestedSpeaker !== null
    }
  }

  /**
   * Generate speaker display order recommendation
   */
  async generateDisplayOrder(output: DiarizationOutput): Promise<SpeakerDisplayOrder> {
    const mappings = this.buildSpeakerMappings(output)
    const validSpeakers = output.speaker_ids

    const stats = mappings.map(m => ({
      speakerId: m.sessionSpeakerId,
      totalDuration: m.totalDuration,
      segmentCount: output.segments.filter(s => s.speaker_id === m.sessionSpeakerId).length,
      averageConfidence: m.averageConfidence,
      firstAppearance: m.firstSeen
    }))

    const prompt = DISPLAY_ORDER_PROMPT
      .replace('{STATS_JSON}', JSON.stringify(stats, null, 2))

    const response = await this.sendLLMRequest({
      prompt,
      systemPrompt: GUARDRAIL_SYSTEM_PROMPT
    })

    // Default order by total duration if LLM fails
    const defaultOrder = stats
      .sort((a, b) => b.totalDuration - a.totalDuration)
      .map(s => s.speakerId)

    if (!response.success || !response.content) {
      return {
        order: defaultOrder,
        reasoning: 'LLM unavailable, ordered by speaking duration',
        metrics: stats
      }
    }

    const parsed = this.parseAndValidateResponse<{
      order: string[]
      reasoning: string
    }>(response.content, validSpeakers)

    if (!parsed.valid || !parsed.data) {
      return {
        order: defaultOrder,
        reasoning: `Parse error, using default order: ${parsed.error}`,
        metrics: stats
      }
    }

    return {
      order: parsed.data.order,
      reasoning: parsed.data.reasoning,
      metrics: stats
    }
  }

  /**
   * Generate speaker-aware summary items
   */
  async generateSpeakerAwareSummary(
    output: DiarizationOutput,
    transcriptSegments: { speaker_id: string; text: string; start_time: number; end_time: number }[]
  ): Promise<SpeakerAwareSummaryItem[]> {
    const validSpeakers = output.speaker_ids

    if (transcriptSegments.length === 0) {
      return []
    }

    const prompt = SUMMARY_PROMPT
      .replace('{TRANSCRIPT_JSON}', JSON.stringify(transcriptSegments.slice(0, 50), null, 2)) // Limit for token efficiency
      .replace('{SPEAKERS_LIST}', validSpeakers.join(', '))

    const response = await this.sendLLMRequest({
      prompt,
      systemPrompt: GUARDRAIL_SYSTEM_PROMPT,
      maxTokens: 4096 // More tokens for summaries
    })

    if (!response.success || !response.content) {
      return []
    }

    const parsed = this.parseAndValidateResponse<{
      items: SpeakerAwareSummaryItem[]
    }>(response.content, validSpeakers)

    if (!parsed.valid || !parsed.data) {
      return []
    }

    // Validate all items have valid speakers
    return parsed.data.items.filter(item =>
      item.speakers.every(s => validSpeakers.includes(s))
    )
  }

  /**
   * Main processing method
   */
  async processOutput(
    output: DiarizationOutput,
    options?: {
      resolveOverlaps?: boolean
      resolveLowConfidence?: boolean
      generateDisplayOrder?: boolean
      generateSummary?: boolean
      transcriptSegments?: { speaker_id: string; text: string; start_time: number; end_time: number }[]
    }
  ): Promise<LLMPostProcessingResult> {
    const startTime = Date.now()
    this.guardrailViolations = []
    this.llmRequestCount = 0

    // Validate input
    if (!output.success) {
      return {
        success: false,
        error: 'Cannot process failed diarization output',
        speakerMappings: [],
        overlapResolutions: [],
        lowConfidenceResolutions: [],
        metadata: {
          processingTimeMs: Date.now() - startTime,
          llmRequestCount: 0,
          guardrailViolations: [],
          diarizationSchemaVersion: output.schema_version
        }
      }
    }

    // Check LM Studio availability
    const availabilityCheck = await this.checkAvailability()
    if (!availabilityCheck.available) {
      return {
        success: false,
        error: `LM Studio not available: ${availabilityCheck.error}`,
        speakerMappings: this.buildSpeakerMappings(output),
        overlapResolutions: [],
        lowConfidenceResolutions: [],
        metadata: {
          processingTimeMs: Date.now() - startTime,
          llmRequestCount: 0,
          guardrailViolations: [],
          diarizationSchemaVersion: output.schema_version
        }
      }
    }

    // Build speaker mappings (always done, doesn't require LLM)
    const speakerMappings = this.buildSpeakerMappings(output)

    // Resolve overlapping segments
    const overlapResolutions: OverlapResolution[] = []
    if (options?.resolveOverlaps !== false) {
      const { overlapGroups } = this.findOverlappingSegments(output)
      for (const group of overlapGroups) {
        const resolution = await this.resolveOverlappingSegments(output, group)
        overlapResolutions.push(resolution)
      }
    }

    // Resolve low-confidence segments
    const lowConfidenceResolutions: LowConfidenceResolution[] = []
    if (options?.resolveLowConfidence !== false) {
      const lowConfidenceIndices = this.findLowConfidenceSegments(output)
      for (const idx of lowConfidenceIndices) {
        const resolution = await this.resolveLowConfidenceSegment(output, idx)
        lowConfidenceResolutions.push(resolution)
      }
    }

    // Generate display order
    let displayOrder: SpeakerDisplayOrder | undefined
    if (options?.generateDisplayOrder !== false) {
      displayOrder = await this.generateDisplayOrder(output)
    }

    // Generate summary if transcript is provided
    let summaryItems: SpeakerAwareSummaryItem[] | undefined
    if (options?.generateSummary && options?.transcriptSegments) {
      summaryItems = await this.generateSpeakerAwareSummary(output, options.transcriptSegments)
    }

    return {
      success: true,
      speakerMappings,
      overlapResolutions,
      lowConfidenceResolutions,
      displayOrder,
      summaryItems,
      metadata: {
        processingTimeMs: Date.now() - startTime,
        llmRequestCount: this.llmRequestCount,
        guardrailViolations: [...this.guardrailViolations],
        diarizationSchemaVersion: output.schema_version
      }
    }
  }

  /**
   * Update configuration
   */
  updateConfig(config: Partial<LMStudioConfig>): void {
    this.config = { ...this.config, ...config }
    this.isAvailable = false // Force re-check
  }

  /**
   * Update thresholds
   */
  updateThresholds(thresholds: Partial<ConfidenceThresholds>): void {
    this.thresholds = { ...this.thresholds, ...thresholds }
  }

  /**
   * Get current configuration
   */
  getConfig(): { lmStudio: LMStudioConfig; thresholds: ConfidenceThresholds } {
    return {
      lmStudio: { ...this.config },
      thresholds: { ...this.thresholds }
    }
  }

  /**
   * Reset service state
   */
  reset(): void {
    this.guardrailViolations = []
    this.llmRequestCount = 0
  }
}

// ============================================================================
// Singleton Export
// ============================================================================

export const llmPostProcessingService = new LLMPostProcessingService()

/**
 * Reset service state
 */
export function resetLLMPostProcessingState(): void {
  llmPostProcessingService.reset()
}

export default llmPostProcessingService
