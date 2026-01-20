/**
 * Decisions and Topics Extraction Service
 *
 * Implements LLM prompts to:
 * 1. Identify decisions made during meetings
 * 2. Extract key discussion points
 * 3. Extract topics with duration and sentiment analysis
 * 4. Store structured data in meeting_notes
 *
 * This service provides comprehensive meeting analysis with enhanced
 * topic extraction including temporal information (duration) and
 * sentiment analysis for each topic/decision.
 */

import { llmRoutingService } from './llm/llmRoutingService'
import type { ChatMessage } from './lm-studio-client'
import { transcriptService } from './transcriptService'
import { meetingNoteService } from './meetingNoteService'
import type { MeetingNote, NoteType, Transcript } from '../../src/types/database'

// ============================================================================
// Types
// ============================================================================

/**
 * Sentiment classification for topics and decisions
 */
export type SentimentType = 'positive' | 'negative' | 'neutral' | 'mixed'

/**
 * Configuration for decisions and topics extraction
 */
export interface DecisionsAndTopicsConfig {
  /** Maximum tokens for LLM response */
  maxTokens?: number
  /** Temperature for response randomness (0.0 - 1.0) */
  temperature?: number
  /** Whether to include sentiment analysis */
  includeSentiment?: boolean
  /** Whether to include duration estimates for topics */
  includeDuration?: boolean
  /** Maximum transcript segments to include (for token efficiency) */
  maxTranscriptSegments?: number
  /** Note generation filtering mode */
  noteGenerationMode?: 'strict' | 'balanced' | 'loose'
}

/**
 * Extracted decision with context
 */
export interface ExtractedDecision {
  /** The decision content */
  content: string
  /** Speaker who made/proposed the decision (if identifiable) */
  speaker?: string
  /** Context or rationale for the decision */
  context?: string
  /** Sentiment around this decision */
  sentiment: SentimentType
  /** Confidence level (0.0 - 1.0) */
  confidence: number
  /** Approximate start time in the meeting (ms) */
  startTimeMs?: number
  /** Approximate end time in the meeting (ms) */
  endTimeMs?: number
  /** Source transcript IDs */
  sourceTranscriptIds?: string[]
}

/**
 * Extracted key discussion point
 */
export interface ExtractedKeyPoint {
  /** The key point content */
  content: string
  /** Category of the key point */
  category?: 'insight' | 'concern' | 'agreement' | 'disagreement' | 'question' | 'observation'
  /** Speakers involved */
  speakers?: string[]
  /** Sentiment of the discussion */
  sentiment: SentimentType
  /** Importance level (1-5) */
  importance: number
  /** Source transcript IDs */
  sourceTranscriptIds?: string[]
}

/**
 * Extracted topic with duration and sentiment
 */
export interface ExtractedTopic {
  /** Topic name/title */
  name: string
  /** Detailed description of what was discussed */
  description: string
  /** Approximate duration in milliseconds */
  durationMs: number
  /** Approximate start time in the meeting (ms) */
  startTimeMs: number
  /** Approximate end time in the meeting (ms) */
  endTimeMs: number
  /** Overall sentiment for this topic */
  sentiment: SentimentType
  /** Key points discussed under this topic */
  keyPoints: string[]
  /** Decisions made under this topic */
  decisions: string[]
  /** Speakers who participated in this topic */
  speakers: string[]
  /** Source transcript IDs */
  sourceTranscriptIds?: string[]
}

/**
 * Complete extraction result
 */
export interface DecisionsAndTopicsExtractionResult {
  /** Extracted decisions */
  decisions: ExtractedDecision[]
  /** Extracted key discussion points */
  keyPoints: ExtractedKeyPoint[]
  /** Extracted topics with duration and sentiment */
  topics: ExtractedTopic[]
  /** Overall meeting sentiment */
  overallSentiment: SentimentType
  /** Sentiment breakdown percentages */
  sentimentBreakdown: {
    positive: number
    negative: number
    neutral: number
    mixed: number
  }
}

/**
 * Result of the extraction process
 */
export interface ExtractionProcessResult {
  /** Whether extraction was successful */
  success: boolean
  /** Error message if failed */
  error?: string
  /** The extracted data */
  extraction?: DecisionsAndTopicsExtractionResult
  /** Meeting notes created from the extraction */
  createdNotes?: MeetingNote[]
  /** Metadata about the extraction process */
  metadata: {
    /** Processing time in milliseconds */
    processingTimeMs: number
    /** Number of transcript segments processed */
    transcriptSegmentCount: number
    /** Total characters in transcript */
    transcriptCharacterCount: number
    /** LLM response time */
    llmResponseTimeMs?: number
    /** Meeting duration in milliseconds */
    meetingDurationMs?: number
    /** Note generation mode used */
    noteGenerationMode?: 'strict' | 'balanced' | 'loose'
  }
}

// ============================================================================
// Default Configuration
// ============================================================================

const DEFAULT_CONFIG: DecisionsAndTopicsConfig = {
  maxTokens: 8192,
  temperature: 0.2,
  includeSentiment: true,
  includeDuration: true,
  maxTranscriptSegments: 300
}

// ============================================================================
// System Prompts for Extraction
// ============================================================================

/**
 * System prompt for decisions, key points, and topics extraction
 */
const EXTRACTION_SYSTEM_PROMPT = `You are an expert meeting analyst specializing in extracting structured insights from meeting transcripts.

Your task is to analyze meeting transcripts and extract:
1. DECISIONS - Explicit decisions or agreements made during the meeting
2. KEY POINTS - Important discussion points, insights, concerns, and observations
3. TOPICS - Main subjects discussed with their duration and sentiment

GUIDELINES:
1. Only extract information that is explicitly stated or strongly implied in the transcript
2. Speaker IDs (SPEAKER_0, SPEAKER_1, etc.) should be preserved as-is - do not invent names
3. Estimate topic duration based on transcript timestamps when available
4. Sentiment should be inferred from the discussion tone, language, and context
5. Be thorough but avoid duplicating information across categories
6. Confidence scores should reflect how explicit the information is in the transcript
7. Group related discussion points under appropriate topics

SENTIMENT CLASSIFICATION:
- positive: Enthusiastic, agreeable, optimistic discussion
- negative: Concerned, critical, pessimistic discussion
- neutral: Factual, informational, objective discussion
- mixed: Contains both positive and negative elements

IMPORTANT - SENTIMENT ANALYSIS REQUIREMENT:
You MUST always analyze and include the overall meeting sentiment (Positive/Neutral/Negative/Mixed) in your response.
Analyze the overall meeting sentiment based on:
- Tone of discussions and participant engagement
- Outcomes and decisions reached
- Level of agreement vs disagreement
- Energy and enthusiasm levels
- Any concerns or challenges raised

The overallSentiment and sentimentBreakdown fields are REQUIRED and must always be populated.

OUTPUT FORMAT:
You MUST respond with valid JSON only, no additional text or markdown formatting.`

/**
 * Get mode-specific filtering instructions
 */
function getModeFilteringInstructions(mode: 'strict' | 'balanced' | 'loose'): string {
  switch (mode) {
    case 'strict':
      return `
FILTERING MODE: STRICT (Default)
- Extract ONLY highly important, in-scope content
- IGNORE minor details, small talk, and unclear/ambiguous content
- Action items must have clear title, assignee (or "TBD" if explicitly mentioned), and realistic due date
- Only include decisions that are explicit and final
- Keep key points to critical insights only (importance >= 4)
- Minimal context in "Other Notes" - only include absolutely essential background information
- Be very selective - quality over quantity`

    case 'balanced':
      return `
FILTERING MODE: BALANCED
- Include important AND moderately relevant content
- Extract both critical insights AND useful supporting details
- Action items can have some "TBD" fields if context suggests they will be determined later
- Include decisions that are strongly implied, not just explicit ones
- Include key points with importance >= 3
- Moderate context in "Other Notes" - include helpful background and context
- Balance comprehensiveness with relevance`

    case 'loose':
      return `
FILTERING MODE: LOOSE
- Include all potentially useful content
- Extract important content, minor details, AND useful contextual information
- Action items can be more flexible with "TBD" fields
- Include decisions that are discussed even if not fully finalized
- Include key points with importance >= 2
- Extensive context in "Other Notes" - include all useful background, context, and tangential discussions
- Err on the side of inclusion - capture the full picture of the meeting
- Only filter out definitely out-of-scope or irrelevant content (social chat, technical difficulties, etc.)`

    default:
      return getModeFilteringInstructions('strict')
  }
}

/**
 * User prompt template for extraction
 */
const EXTRACTION_USER_PROMPT_TEMPLATE = `Analyze the following meeting transcript and extract decisions, key discussion points, and topics.

TRANSCRIPT:
{TRANSCRIPT}

TRANSCRIPT METADATA:
- Total duration: {DURATION_MS} milliseconds
- Number of speakers: {SPEAKER_COUNT}
- Speakers identified: {SPEAKERS}

Generate a JSON response with the following structure:
{
  "decisions": [
    {
      "content": "Description of the decision made",
      "speaker": "SPEAKER_X (if identifiable)",
      "context": "Why this decision was made or what led to it",
      "sentiment": "positive|negative|neutral|mixed",
      "confidence": 0.0-1.0,
      "startTimeMs": 0,
      "endTimeMs": 0
    }
  ],
  "keyPoints": [
    {
      "content": "Description of the key point",
      "category": "insight|concern|agreement|disagreement|question|observation",
      "speakers": ["SPEAKER_X", "SPEAKER_Y"],
      "sentiment": "positive|negative|neutral|mixed",
      "importance": 1-5
    }
  ],
  "topics": [
    {
      "name": "Topic title",
      "description": "What was discussed about this topic",
      "durationMs": 0,
      "startTimeMs": 0,
      "endTimeMs": 0,
      "sentiment": "positive|negative|neutral|mixed",
      "keyPoints": ["Point 1", "Point 2"],
      "decisions": ["Decision 1"],
      "speakers": ["SPEAKER_X", "SPEAKER_Y"]
    }
  ],
  "overallSentiment": "positive|negative|neutral|mixed",
  "sentimentBreakdown": {
    "positive": 0.0-100.0,
    "negative": 0.0-100.0,
    "neutral": 0.0-100.0,
    "mixed": 0.0-100.0
  }
}

IMPORTANT INSTRUCTIONS:
1. Extract 3-10 key points based on meeting length and content
2. Topics should cover the main subjects discussed, with accurate time estimates
3. Decisions should only include explicitly agreed-upon outcomes
4. Sentiment breakdown percentages should sum to approximately 100
5. Use the transcript timestamps to estimate topic durations
6. If no decisions were made, use an empty array for decisions
7. Group related discussions under the same topic

Respond with JSON only:`

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Format transcripts into a readable text format for the LLM
 * Includes timestamp information for duration estimation
 */
function formatTranscriptsForLLM(transcripts: Transcript[]): {
  formatted: string
  durationMs: number
  speakers: string[]
} {
  if (transcripts.length === 0) {
    return {
      formatted: 'No transcript content available.',
      durationMs: 0,
      speakers: []
    }
  }

  // Calculate meeting duration
  const startMs = Math.min(...transcripts.map(t => t.start_time_ms))
  const endMs = Math.max(...transcripts.map(t => t.end_time_ms))
  const durationMs = endMs - startMs

  // Get unique speakers
  const speakers = [...new Set(transcripts.map(t => t.speaker_id).filter(Boolean))] as string[]

  // Group consecutive transcripts by speaker for better readability
  const formattedLines: string[] = []
  let currentSpeaker: string | null = null
  let currentContent: string[] = []
  let currentStartMs: number = 0

  for (const transcript of transcripts) {
    const speaker = transcript.speaker_id || 'UNKNOWN'

    if (speaker !== currentSpeaker) {
      // Flush previous speaker's content with timestamp
      if (currentSpeaker !== null && currentContent.length > 0) {
        const timestamp = formatTimestamp(currentStartMs)
        formattedLines.push(`[${timestamp}] [${currentSpeaker}]: ${currentContent.join(' ')}`)
      }
      currentSpeaker = speaker
      currentContent = [transcript.content]
      currentStartMs = transcript.start_time_ms
    } else {
      currentContent.push(transcript.content)
    }
  }

  // Flush final speaker's content
  if (currentSpeaker !== null && currentContent.length > 0) {
    const timestamp = formatTimestamp(currentStartMs)
    formattedLines.push(`[${timestamp}] [${currentSpeaker}]: ${currentContent.join(' ')}`)
  }

  return {
    formatted: formattedLines.join('\n\n'),
    durationMs,
    speakers
  }
}

/**
 * Format milliseconds to MM:SS timestamp
 */
function formatTimestamp(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000)
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  return `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`
}

/**
 * Parse and validate LLM response
 */
function parseExtractionResponse(content: string): {
  valid: boolean
  data?: DecisionsAndTopicsExtractionResult
  error?: string
} {
  try {
    // Extract JSON from potential markdown code blocks
    let jsonContent = content.trim()
    if (jsonContent.startsWith('```')) {
      const match = jsonContent.match(/```(?:json)?\s*([\s\S]*?)```/)
      if (match) {
        jsonContent = match[1].trim()
      }
    }

    const data = JSON.parse(jsonContent)

    // Validate and normalize decisions
    const decisions: ExtractedDecision[] = Array.isArray(data.decisions)
      ? data.decisions.map((d: Record<string, unknown>) => ({
          content: String(d.content || ''),
          speaker: typeof d.speaker === 'string' ? d.speaker : undefined,
          context: typeof d.context === 'string' ? d.context : undefined,
          sentiment: validateSentiment(d.sentiment),
          confidence: typeof d.confidence === 'number' ? Math.min(1, Math.max(0, d.confidence)) : 0.8,
          startTimeMs: typeof d.startTimeMs === 'number' ? d.startTimeMs : undefined,
          endTimeMs: typeof d.endTimeMs === 'number' ? d.endTimeMs : undefined
        }))
      : []

    // Validate and normalize key points
    const keyPoints: ExtractedKeyPoint[] = Array.isArray(data.keyPoints)
      ? data.keyPoints.map((kp: Record<string, unknown>) => ({
          content: String(kp.content || ''),
          category: validateCategory(kp.category),
          speakers: Array.isArray(kp.speakers)
            ? kp.speakers.filter((s: unknown) => typeof s === 'string')
            : undefined,
          sentiment: validateSentiment(kp.sentiment),
          importance: typeof kp.importance === 'number'
            ? Math.min(5, Math.max(1, Math.round(kp.importance)))
            : 3
        }))
      : []

    // Validate and normalize topics
    const topics: ExtractedTopic[] = Array.isArray(data.topics)
      ? data.topics.map((t: Record<string, unknown>) => ({
          name: String(t.name || ''),
          description: String(t.description || ''),
          durationMs: typeof t.durationMs === 'number' ? t.durationMs : 0,
          startTimeMs: typeof t.startTimeMs === 'number' ? t.startTimeMs : 0,
          endTimeMs: typeof t.endTimeMs === 'number' ? t.endTimeMs : 0,
          sentiment: validateSentiment(t.sentiment),
          keyPoints: Array.isArray(t.keyPoints)
            ? t.keyPoints.filter((p: unknown) => typeof p === 'string')
            : [],
          decisions: Array.isArray(t.decisions)
            ? t.decisions.filter((d: unknown) => typeof d === 'string')
            : [],
          speakers: Array.isArray(t.speakers)
            ? t.speakers.filter((s: unknown) => typeof s === 'string')
            : []
        }))
      : []

    // Validate overall sentiment
    const overallSentiment = validateSentiment(data.overallSentiment)

    // Validate sentiment breakdown
    const sentimentBreakdown = {
      positive: typeof data.sentimentBreakdown?.positive === 'number'
        ? data.sentimentBreakdown.positive : 25,
      negative: typeof data.sentimentBreakdown?.negative === 'number'
        ? data.sentimentBreakdown.negative : 25,
      neutral: typeof data.sentimentBreakdown?.neutral === 'number'
        ? data.sentimentBreakdown.neutral : 25,
      mixed: typeof data.sentimentBreakdown?.mixed === 'number'
        ? data.sentimentBreakdown.mixed : 25
    }

    return {
      valid: true,
      data: {
        decisions,
        keyPoints,
        topics,
        overallSentiment,
        sentimentBreakdown
      }
    }
  } catch (error) {
    return {
      valid: false,
      error: `Failed to parse JSON: ${error instanceof Error ? error.message : String(error)}`
    }
  }
}

/**
 * Validate sentiment value
 */
function validateSentiment(value: unknown): SentimentType {
  const validSentiments: SentimentType[] = ['positive', 'negative', 'neutral', 'mixed']
  if (typeof value === 'string' && validSentiments.includes(value as SentimentType)) {
    return value as SentimentType
  }
  return 'neutral'
}

/**
 * Validate key point category
 */
function validateCategory(
  value: unknown
): 'insight' | 'concern' | 'agreement' | 'disagreement' | 'question' | 'observation' | undefined {
  const validCategories = ['insight', 'concern', 'agreement', 'disagreement', 'question', 'observation']
  if (typeof value === 'string' && validCategories.includes(value)) {
    return value as 'insight' | 'concern' | 'agreement' | 'disagreement' | 'question' | 'observation'
  }
  return undefined
}

/**
 * Format sentiment for display in note content
 */
function formatSentimentTag(sentiment: SentimentType): string {
  const sentimentEmoji: Record<SentimentType, string> = {
    positive: '✅',
    negative: '⚠️',
    neutral: '📝',
    mixed: '🔄'
  }
  return `[${sentimentEmoji[sentiment]} ${sentiment.toUpperCase()}]`
}

/**
 * Format duration for display
 */
function formatDuration(ms: number): string {
  const minutes = Math.floor(ms / 60000)
  const seconds = Math.floor((ms % 60000) / 1000)
  if (minutes > 0) {
    return `${minutes}m ${seconds}s`
  }
  return `${seconds}s`
}

/**
 * Parse a decision from a stored meeting note
 */
function parseDecisionFromNote(note: MeetingNote): ExtractedDecision | null {
  try {
    const content = note.content

    // Extract sentiment from tag
    const sentimentMatch = content.match(/\[(✅|⚠️|📝|🔄)\s+(POSITIVE|NEGATIVE|NEUTRAL|MIXED)\]/)
    const sentiment: SentimentType = sentimentMatch
      ? (sentimentMatch[2].toLowerCase() as SentimentType)
      : 'neutral'

    // Extract speaker if present
    const speakerMatch = content.match(/^\[([^\]]+)\]\s+\[.*?\]/)
    const speaker = speakerMatch ? speakerMatch[1] : undefined

    // Extract main content (remove tags)
    let mainContent = content
      .replace(/^\[([^\]]+)\]\s+/, '') // Remove speaker tag
      .replace(/\[(✅|⚠️|📝|🔄)\s+(POSITIVE|NEGATIVE|NEUTRAL|MIXED)\]\s*/, '') // Remove sentiment tag
      .split('\n\nContext:')[0] // Remove context section
      .split('\n\n⏱️')[0] // Remove timestamp section
      .trim()

    // Extract context if present
    const contextMatch = content.match(/\n\nContext:\s*(.+?)(?=\n\n⏱️|\n\n|$)/s)
    const context = contextMatch ? contextMatch[1].trim() : undefined

    // Extract timestamps if present
    const timestampMatch = content.match(/⏱️\s+(\d{2}:\d{2})\s+-\s+(\d{2}:\d{2})/)
    let startTimeMs: number | undefined
    let endTimeMs: number | undefined
    if (timestampMatch) {
      startTimeMs = parseTimestampToMs(timestampMatch[1])
      endTimeMs = parseTimestampToMs(timestampMatch[2])
    }

    return {
      content: mainContent,
      speaker,
      context,
      sentiment,
      confidence: 0.85, // Default confidence for stored decisions
      startTimeMs,
      endTimeMs,
      sourceTranscriptIds: note.source_transcript_ids ? JSON.parse(note.source_transcript_ids) as string[] : undefined
    }
  } catch (error) {
    console.error('Failed to parse decision from note:', error)
    return null
  }
}

/**
 * Parse a topic from a stored meeting note
 */
function parseTopicFromNote(note: MeetingNote): ExtractedTopic | null {
  try {
    const content = note.content

    // Extract topic name from heading
    const nameMatch = content.match(/##\s+(.+?)(?=\n|$)/)
    const name = nameMatch ? nameMatch[1].trim() : 'Unnamed Topic'

    // Extract description (first paragraph after heading, before timing/sentiment/speakers/decisions)
    const descMatch = content.match(/##\s+.+?\n\n(.+?)(?=\n\n⏱️|\n\n\[|👥|\n\n###|$)/s)
    const description = descMatch ? descMatch[1].trim() : ''

    // Extract timing information (⏱️ MM:SS - MM:SS (duration))
    let startTimeMs = 0
    let endTimeMs = 0
    let durationMs = 0
    const timingMatch = content.match(/⏱️\s+(\d{2}:\d{2})\s+-\s+(\d{2}:\d{2})/)
    if (timingMatch) {
      startTimeMs = parseTimestampToMs(timingMatch[1])
      endTimeMs = parseTimestampToMs(timingMatch[2])
      durationMs = endTimeMs - startTimeMs
    }

    // Extract sentiment from tag
    const sentimentMatch = content.match(/\[(✅|⚠️|📝|🔄)\s+(POSITIVE|NEGATIVE|NEUTRAL|MIXED)\]/)
    const sentiment: SentimentType = sentimentMatch
      ? (sentimentMatch[2].toLowerCase() as SentimentType)
      : 'neutral'

    // Extract speakers
    const speakersMatch = content.match(/👥\s+Speakers:\s+(.+?)(?=\n\n|$)/s)
    const speakers = speakersMatch
      ? speakersMatch[1].split(',').map(s => s.trim())
      : []

    // Extract key points
    const keyPointsMatch = content.match(/###\s+Key Points:\n((?:•.+\n?)+)/s)
    const keyPoints = keyPointsMatch
      ? keyPointsMatch[1].split('\n').map(line => line.replace(/^•\s*/, '').trim()).filter(Boolean)
      : []

    // Extract decisions
    const decisionsMatch = content.match(/###\s+Decisions:\n((?:✓.+\n?)+)/s)
    const decisions = decisionsMatch
      ? decisionsMatch[1].split('\n').map(line => line.replace(/^✓\s*/, '').trim()).filter(Boolean)
      : []

    return {
      name,
      description,
      durationMs,
      startTimeMs,
      endTimeMs,
      sentiment,
      keyPoints,
      decisions,
      speakers,
      sourceTranscriptIds: note.source_transcript_ids ? JSON.parse(note.source_transcript_ids) as string[] : undefined
    }
  } catch (error) {
    console.error('Failed to parse topic from note:', error)
    return null
  }
}

/**
 * Parse MM:SS timestamp to milliseconds
 */
function parseTimestampToMs(timestamp: string): number {
  const parts = timestamp.split(':')
  const minutes = parseInt(parts[0], 10)
  const seconds = parseInt(parts[1], 10)
  return (minutes * 60 + seconds) * 1000
}

// ============================================================================
// Decisions and Topics Service Class
// ============================================================================

class DecisionsAndTopicsService {
  private config: DecisionsAndTopicsConfig

  constructor(config?: Partial<DecisionsAndTopicsConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...config }
  }

  /**
   * Check if LLM service is available
   * Uses intelligent routing to check availability across all configured providers
   */
  async checkAvailability(): Promise<{ available: boolean; error?: string; modelInfo?: string }> {
    try {
      const health = await llmRoutingService.checkHealth(true)

      if (!health.success || !health.data?.healthy) {
        return {
          available: false,
          error: health.error || 'No LLM provider is available. Please ensure at least one provider (LM Studio, Claude CLI, or Cursor CLI) is running.'
        }
      }

      return {
        available: true,
        modelInfo: health.data.loadedModel
      }
    } catch (error) {
      return {
        available: false,
        error: error instanceof Error ? error.message : 'Failed to check LLM availability'
      }
    }
  }

  /**
   * Extract decisions, key points, and topics from a meeting
   *
   * @param meetingId - The meeting ID to analyze
   * @param config - Optional configuration overrides
   */
  async extract(
    meetingId: string,
    config?: Partial<DecisionsAndTopicsConfig>
  ): Promise<ExtractionProcessResult> {
    const startTime = Date.now()
    const mergedConfig = { ...this.config, ...config }

    // Check LLM availability
    const availability = await this.checkAvailability()
    if (!availability.available) {
      return {
        success: false,
        error: availability.error,
        metadata: {
          processingTimeMs: Date.now() - startTime,
          transcriptSegmentCount: 0,
          transcriptCharacterCount: 0
        }
      }
    }

    // Fetch transcripts for the meeting
    const transcripts = transcriptService.getByMeetingId(meetingId)

    if (transcripts.length === 0) {
      return {
        success: false,
        error: 'No transcripts found for this meeting. Please ensure the meeting has been transcribed.',
        metadata: {
          processingTimeMs: Date.now() - startTime,
          transcriptSegmentCount: 0,
          transcriptCharacterCount: 0
        }
      }
    }

    // Limit transcripts if needed for token efficiency
    const limitedTranscripts = mergedConfig.maxTranscriptSegments
      ? transcripts.slice(0, mergedConfig.maxTranscriptSegments)
      : transcripts

    // Format transcripts for LLM
    const { formatted, durationMs, speakers } = formatTranscriptsForLLM(limitedTranscripts)
    const transcriptCharacterCount = formatted.length

    // Get the note generation mode (default to 'strict' if not provided)
    const noteGenerationMode = mergedConfig.noteGenerationMode || 'strict'

    // Build the system prompt with mode-specific filtering instructions
    const systemPromptWithMode = `${EXTRACTION_SYSTEM_PROMPT}

${getModeFilteringInstructions(noteGenerationMode)}`

    // Build the user prompt
    const userPrompt = EXTRACTION_USER_PROMPT_TEMPLATE
      .replace('{TRANSCRIPT}', formatted)
      .replace('{DURATION_MS}', String(durationMs))
      .replace('{SPEAKER_COUNT}', String(speakers.length))
      .replace('{SPEAKERS}', speakers.join(', ') || 'None identified')

    // Build messages for LLM
    const messages: ChatMessage[] = [
      { role: 'system', content: systemPromptWithMode },
      { role: 'user', content: userPrompt }
    ]

    // Call LLM via routing service (supports automatic fallback)
    const llmStartTime = Date.now()
    const response = await llmRoutingService.chatCompletion({
      messages,
      maxTokens: mergedConfig.maxTokens,
      temperature: mergedConfig.temperature
    })
    const llmResponseTimeMs = Date.now() - llmStartTime

    if (!response.success || !response.data) {
      return {
        success: false,
        error: response.error || 'Failed to get response from LLM',
        metadata: {
          processingTimeMs: Date.now() - startTime,
          transcriptSegmentCount: limitedTranscripts.length,
          transcriptCharacterCount,
          llmResponseTimeMs,
          meetingDurationMs: durationMs,
          noteGenerationMode
        }
      }
    }

    // Extract content from response
    const llmContent = response.data.choices[0]?.message?.content
    if (!llmContent) {
      return {
        success: false,
        error: 'LLM returned empty response',
        metadata: {
          processingTimeMs: Date.now() - startTime,
          transcriptSegmentCount: limitedTranscripts.length,
          transcriptCharacterCount,
          llmResponseTimeMs,
          meetingDurationMs: durationMs,
          noteGenerationMode
        }
      }
    }

    // Parse the extraction response
    const parsed = parseExtractionResponse(llmContent)
    if (!parsed.valid || !parsed.data) {
      return {
        success: false,
        error: parsed.error || 'Failed to parse LLM response',
        metadata: {
          processingTimeMs: Date.now() - startTime,
          transcriptSegmentCount: limitedTranscripts.length,
          transcriptCharacterCount,
          llmResponseTimeMs,
          meetingDurationMs: durationMs,
          noteGenerationMode
        }
      }
    }

    // Create meeting notes from the extraction
    const createdNotes = await this.createNotesFromExtraction(meetingId, parsed.data, mergedConfig)

    return {
      success: true,
      extraction: parsed.data,
      createdNotes,
      metadata: {
        processingTimeMs: Date.now() - startTime,
        transcriptSegmentCount: limitedTranscripts.length,
        transcriptCharacterCount,
        llmResponseTimeMs,
        meetingDurationMs: durationMs,
        noteGenerationMode
      }
    }
  }

  /**
   * Get existing cached sentiment for a meeting (if available)
   */
  private getCachedSentiment(meetingId: string): {
    overallSentiment: SentimentType
    sentimentBreakdown: { positive: number; negative: number; neutral: number; mixed: number }
  } | null {
    try {
      const notes = meetingNoteService.getByMeetingId(meetingId)
      const sentimentNote = notes.find(n =>
        n.note_type === 'summary' &&
        n.is_ai_generated &&
        n.content.includes('Meeting Sentiment Analysis')
      )

      if (!sentimentNote) {
        return null
      }

      // Parse overall sentiment
      const overallMatch = sentimentNote.content.match(/\*\*Overall Sentiment:\*\*\s+[^\s]+\s+(\w+)/)
      const overallSentiment = overallMatch ? (overallMatch[1].toLowerCase() as SentimentType) : 'neutral'

      // Parse sentiment breakdown
      const positiveMatch = sentimentNote.content.match(/✅ Positive:\s+([\d.]+)%/)
      const negativeMatch = sentimentNote.content.match(/⚠️ Negative:\s+([\d.]+)%/)
      const neutralMatch = sentimentNote.content.match(/📝 Neutral:\s+([\d.]+)%/)
      const mixedMatch = sentimentNote.content.match(/🔄 Mixed:\s+([\d.]+)%/)

      const sentimentBreakdown = {
        positive: positiveMatch ? parseFloat(positiveMatch[1]) : 25,
        negative: negativeMatch ? parseFloat(negativeMatch[1]) : 25,
        neutral: neutralMatch ? parseFloat(neutralMatch[1]) : 25,
        mixed: mixedMatch ? parseFloat(mixedMatch[1]) : 25
      }

      console.log('[DecisionsAndTopics] Found cached sentiment:', overallSentiment, sentimentBreakdown)
      return { overallSentiment, sentimentBreakdown }
    } catch (error) {
      console.error('[DecisionsAndTopics] Failed to parse cached sentiment:', error)
      return null
    }
  }

  /**
   * Create meeting notes from extraction results
   */
  private async createNotesFromExtraction(
    meetingId: string,
    extraction: DecisionsAndTopicsExtractionResult,
    config: DecisionsAndTopicsConfig
  ): Promise<MeetingNote[]> {
    const createdNotes: MeetingNote[] = []

    // Create decision notes
    for (const decision of extraction.decisions) {
      let content = decision.content
      if (config.includeSentiment) {
        content = `${formatSentimentTag(decision.sentiment)} ${content}`
      }
      if (decision.context) {
        content = `${content}\n\nContext: ${decision.context}`
      }
      if (decision.speaker) {
        content = `[${decision.speaker}] ${content}`
      }
      if (decision.startTimeMs !== undefined && decision.endTimeMs !== undefined) {
        content = `${content}\n\n⏱️ ${formatTimestamp(decision.startTimeMs)} - ${formatTimestamp(decision.endTimeMs)}`
      }

      const note = meetingNoteService.create({
        meeting_id: meetingId,
        content,
        note_type: 'decision',
        is_ai_generated: true,
        source_transcript_ids: decision.sourceTranscriptIds
      })
      createdNotes.push(note)
    }

    // Create key point notes
    for (const keyPoint of extraction.keyPoints) {
      let content = keyPoint.content
      if (config.includeSentiment) {
        content = `${formatSentimentTag(keyPoint.sentiment)} ${content}`
      }
      if (keyPoint.category) {
        content = `[${keyPoint.category.toUpperCase()}] ${content}`
      }
      if (keyPoint.importance) {
        content = `${'★'.repeat(keyPoint.importance)}${'☆'.repeat(5 - keyPoint.importance)} ${content}`
      }
      if (keyPoint.speakers && keyPoint.speakers.length > 0) {
        content = `${content}\n\nSpeakers: ${keyPoint.speakers.join(', ')}`
      }

      const note = meetingNoteService.create({
        meeting_id: meetingId,
        content,
        note_type: 'key_point',
        is_ai_generated: true,
        source_transcript_ids: keyPoint.sourceTranscriptIds
      })
      createdNotes.push(note)
    }

    // Create topic summary notes (stored as custom notes with structured content)
    for (const topic of extraction.topics) {
      let content = `## ${topic.name}\n\n${topic.description}`

      // Add timing information
      if (topic.startTimeMs !== undefined && topic.endTimeMs !== undefined && topic.durationMs !== undefined) {
        content = `${content}\n\n⏱️ ${formatTimestamp(topic.startTimeMs)} - ${formatTimestamp(topic.endTimeMs)} (${formatDuration(topic.durationMs)})`
      }

      // Add sentiment information
      if (config.includeSentiment) {
        content = `${content}\n\n${formatSentimentTag(topic.sentiment)}`
      }

      if (topic.speakers.length > 0) {
        content = `${content}\n\n👥 Speakers: ${topic.speakers.join(', ')}`
      }

      if (topic.keyPoints.length > 0) {
        content = `${content}\n\n### Key Points:\n${topic.keyPoints.map(p => `• ${p}`).join('\n')}`
      }

      if (topic.decisions.length > 0) {
        content = `${content}\n\n### Decisions:\n${topic.decisions.map(d => `✓ ${d}`).join('\n')}`
      }

      const note = meetingNoteService.create({
        meeting_id: meetingId,
        content,
        note_type: 'custom', // Topics are stored as custom notes with structured content
        is_ai_generated: true,
        source_transcript_ids: topic.sourceTranscriptIds
      })
      createdNotes.push(note)
    }

    // Create overall sentiment summary with fallback to cached sentiment
    // First check if LLM returned valid sentiment, otherwise use cached sentiment
    let overallSentiment = extraction.overallSentiment
    let sentimentBreakdown = extraction.sentimentBreakdown

    // If LLM didn't return valid sentiment, try to use cached sentiment
    if (!overallSentiment || overallSentiment === 'neutral' &&
        sentimentBreakdown.positive === 25 &&
        sentimentBreakdown.negative === 25 &&
        sentimentBreakdown.neutral === 25 &&
        sentimentBreakdown.mixed === 25) {
      console.log('[DecisionsAndTopics] LLM returned default/missing sentiment, checking for cached sentiment')
      const cached = this.getCachedSentiment(meetingId)
      if (cached) {
        console.log('[DecisionsAndTopics] Using cached sentiment as fallback')
        overallSentiment = cached.overallSentiment
        sentimentBreakdown = cached.sentimentBreakdown
      }
    }

    const sentimentSummary = `## Meeting Sentiment Analysis

**Overall Sentiment:** ${formatSentimentTag(overallSentiment)} ${overallSentiment}

### Sentiment Breakdown:
- ✅ Positive: ${sentimentBreakdown.positive.toFixed(1)}%
- ⚠️ Negative: ${sentimentBreakdown.negative.toFixed(1)}%
- 📝 Neutral: ${sentimentBreakdown.neutral.toFixed(1)}%
- 🔄 Mixed: ${sentimentBreakdown.mixed.toFixed(1)}%

### Statistics:
- Decisions Made: ${extraction.decisions.length}
- Key Points: ${extraction.keyPoints.length}
- Topics Discussed: ${extraction.topics.length}`

    const summaryNote = meetingNoteService.create({
      meeting_id: meetingId,
      content: sentimentSummary,
      note_type: 'summary',
      is_ai_generated: true
    })
    createdNotes.push(summaryNote)

    return createdNotes
  }

  /**
   * Update service configuration
   */
  updateConfig(config: Partial<DecisionsAndTopicsConfig>): void {
    this.config = { ...this.config, ...config }
  }

  /**
   * Get current configuration
   */
  getConfig(): DecisionsAndTopicsConfig {
    return { ...this.config }
  }

  /**
   * Delete AI-generated notes from this service for a meeting
   * (useful for regenerating extractions)
   */
  async deleteExistingExtraction(meetingId: string): Promise<{ deleted: number }> {
    const existingNotes = meetingNoteService.getAIGenerated(meetingId)
    let deleted = 0

    for (const note of existingNotes) {
      if (meetingNoteService.delete(note.id)) {
        deleted++
      }
    }

    return { deleted }
  }

  /**
   * Get only decisions for a meeting (without running full extraction)
   * Retrieves already-extracted decisions from the database
   */
  async getDecisions(meetingId: string): Promise<ExtractedDecision[]> {
    // Get AI-generated decision notes from database
    const notes = meetingNoteService.getByMeetingId(meetingId)
    const decisionNotes = notes.filter(note =>
      note.note_type === 'decision' && note.is_ai_generated
    )

    // Parse notes back into ExtractedDecision format
    const decisions: ExtractedDecision[] = []
    for (const note of decisionNotes) {
      const decision = parseDecisionFromNote(note)
      if (decision) {
        decisions.push(decision)
      }
    }

    return decisions
  }

  /**
   * Get only topics with duration and sentiment for a meeting
   * Retrieves already-extracted topics from the database
   * Only includes properly structured post-extraction topics (note_type: 'custom')
   *
   * NOTE: 'summary' type notes are plain text summaries from live recording,
   * not structured topics. They should not be displayed in the Topics view.
   */
  async getTopicsWithDetails(meetingId: string): Promise<ExtractedTopic[]> {
    // Get AI-generated notes - only 'custom' type are structured topics
    // 'summary' type are plain text summaries that don't have topic structure
    const notes = meetingNoteService.getByMeetingId(meetingId)
    const topicNotes = notes.filter(note =>
      note.note_type === 'custom' && note.is_ai_generated
    )

    // Parse notes back into ExtractedTopic format
    const topics: ExtractedTopic[] = []
    for (const note of topicNotes) {
      const topic = parseTopicFromNote(note)
      if (topic) {
        topics.push(topic)
      }
    }

    return topics
  }
}

// ============================================================================
// Singleton Export
// ============================================================================

export const decisionsAndTopicsService = new DecisionsAndTopicsService()

/**
 * Reset service configuration to defaults
 */
export function resetDecisionsAndTopicsConfig(): void {
  decisionsAndTopicsService.updateConfig(DEFAULT_CONFIG)
}

export default decisionsAndTopicsService
