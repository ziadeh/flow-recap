/**
 * Meeting Summary Service
 *
 * Implements prompt engineering for generating meeting summaries.
 * Sends transcript to LLM (via LM Studio), receives structured summary,
 * and stores results as meeting notes.
 *
 * This service orchestrates:
 * 1. Fetching transcripts for a meeting
 * 2. Sending transcript data to LLM with engineered prompts
 * 3. Parsing and validating LLM responses
 * 4. Creating meeting notes from the structured summary
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
 * Configuration for summary generation
 */
export interface SummaryGenerationConfig {
  /** Maximum tokens for LLM response */
  maxTokens?: number
  /** Temperature for response randomness (0.0 - 1.0) */
  temperature?: number
  /** Whether to include action items in summary */
  includeActionItems?: boolean
  /** Whether to include key points in summary */
  includeKeyPoints?: boolean
  /** Whether to include decisions in summary */
  includeDecisions?: boolean
  /** Maximum transcript segments to include (for token efficiency) */
  maxTranscriptSegments?: number
}

/**
 * Structured summary response from LLM
 */
export interface StructuredSummary {
  /** Overall meeting summary */
  overallSummary: string
  /** Key points discussed */
  keyPoints: string[]
  /** Action items with optional assignee */
  actionItems: {
    content: string
    speaker?: string
    priority?: 'high' | 'medium' | 'low'
  }[]
  /** Decisions made during the meeting */
  decisions: string[]
  /** Topics discussed */
  topics: string[]
}

/**
 * Result of summary generation
 */
export interface SummaryGenerationResult {
  /** Whether generation was successful */
  success: boolean
  /** Error message if failed */
  error?: string
  /** The structured summary */
  summary?: StructuredSummary
  /** Meeting notes created from the summary */
  createdNotes?: MeetingNote[]
  /** Metadata about the generation process */
  metadata: {
    /** Processing time in milliseconds */
    processingTimeMs: number
    /** Number of transcript segments processed */
    transcriptSegmentCount: number
    /** Total characters in transcript */
    transcriptCharacterCount: number
    /** LLM response time */
    llmResponseTimeMs?: number
  }
}

// ============================================================================
// Default Configuration
// ============================================================================

const DEFAULT_CONFIG: SummaryGenerationConfig = {
  maxTokens: 4096,
  temperature: 0.3,
  includeActionItems: true,
  includeKeyPoints: true,
  includeDecisions: true,
  maxTranscriptSegments: 200
}

// ============================================================================
// System Prompts for Summary Generation
// ============================================================================

/**
 * System prompt for meeting summary generation
 */
const SUMMARY_SYSTEM_PROMPT = `You are an expert meeting summarizer. Your task is to analyze meeting transcripts and generate comprehensive, structured summaries.

GUIDELINES:
1. Focus on the main topics, decisions, and outcomes
2. Extract concrete action items with clear descriptions
3. Identify key points that are important for future reference
4. Note any decisions that were made
5. Be concise but comprehensive
6. Use professional language
7. If speaker IDs are present (e.g., SPEAKER_0, SPEAKER_1), you may reference them but do not invent speaker names or identities

OUTPUT FORMAT:
You MUST respond with valid JSON only, no additional text or markdown formatting.
`

/**
 * User prompt template for meeting summary generation
 */
const SUMMARY_USER_PROMPT_TEMPLATE = `Please analyze the following meeting transcript and generate a structured summary.

TRANSCRIPT:
{TRANSCRIPT}

Generate a JSON response with the following structure:
{
  "overallSummary": "A concise 3-paragraph summary (250-400 words) covering: what was discussed, key outcomes, and next steps",
  "keyPoints": ["Key point 1", "Key point 2", ...],
  "actionItems": [
    {
      "content": "Description of action item",
      "speaker": "SPEAKER_X (if identifiable from transcript)",
      "priority": "high|medium|low"
    }
  ],
  "decisions": ["Decision 1", "Decision 2", ...],
  "topics": ["Topic 1", "Topic 2", ...]
}

IMPORTANT - MEETING SUMMARY REQUIREMENTS:
- overallSummary MUST be exactly 3 paragraphs with 250-400 words total
- Paragraph 1: Summarize WHAT WAS DISCUSSED (main topics and context)
- Paragraph 2: Summarize KEY OUTCOMES (decisions made, conclusions reached)
- Paragraph 3: Summarize NEXT STEPS (action items, follow-ups, future plans)
- Use clear, professional language suitable for an executive summary
- Focus on business value and actionable information

OTHER FIELDS:
- keyPoints should be 3-10 bullet points of the most important information
- actionItems should only include explicitly stated tasks or commitments
- decisions should only include explicitly stated decisions
- topics should list the main subjects discussed
- If no action items or decisions are present, use empty arrays

Respond with JSON only:`

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Format transcripts into a readable text format for the LLM
 */
function formatTranscriptsForLLM(transcripts: Transcript[]): string {
  if (transcripts.length === 0) {
    return 'No transcript content available.'
  }

  // Group consecutive transcripts by speaker for better readability
  const formattedLines: string[] = []
  let currentSpeaker: string | null = null
  let currentContent: string[] = []

  for (const transcript of transcripts) {
    const speaker = transcript.speaker_id || 'UNKNOWN'

    if (speaker !== currentSpeaker) {
      // Flush previous speaker's content
      if (currentSpeaker !== null && currentContent.length > 0) {
        formattedLines.push(`[${currentSpeaker}]: ${currentContent.join(' ')}`)
      }
      currentSpeaker = speaker
      currentContent = [transcript.content]
    } else {
      currentContent.push(transcript.content)
    }
  }

  // Flush final speaker's content
  if (currentSpeaker !== null && currentContent.length > 0) {
    formattedLines.push(`[${currentSpeaker}]: ${currentContent.join(' ')}`)
  }

  return formattedLines.join('\n\n')
}

/**
 * Parse and validate LLM response as StructuredSummary
 */
function parseStructuredSummary(content: string): { valid: boolean; data?: StructuredSummary; error?: string } {
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

    // Validate required fields
    if (typeof data.overallSummary !== 'string') {
      return { valid: false, error: 'Missing or invalid overallSummary field' }
    }

    // Normalize arrays with defaults
    const summary: StructuredSummary = {
      overallSummary: data.overallSummary,
      keyPoints: Array.isArray(data.keyPoints) ? data.keyPoints.filter((p: unknown) => typeof p === 'string') : [],
      actionItems: Array.isArray(data.actionItems) ? data.actionItems.map((item: unknown) => {
        if (typeof item === 'string') {
          return { content: item }
        }
        if (typeof item === 'object' && item !== null) {
          const obj = item as Record<string, unknown>
          return {
            content: typeof obj.content === 'string' ? obj.content : String(obj.content || ''),
            speaker: typeof obj.speaker === 'string' ? obj.speaker : undefined,
            priority: ['high', 'medium', 'low'].includes(obj.priority as string) ? obj.priority as 'high' | 'medium' | 'low' : undefined
          }
        }
        return { content: String(item) }
      }) : [],
      decisions: Array.isArray(data.decisions) ? data.decisions.filter((d: unknown) => typeof d === 'string') : [],
      topics: Array.isArray(data.topics) ? data.topics.filter((t: unknown) => typeof t === 'string') : []
    }

    return { valid: true, data: summary }
  } catch (error) {
    return { valid: false, error: `Failed to parse JSON: ${error instanceof Error ? error.message : String(error)}` }
  }
}

// ============================================================================
// Meeting Summary Service Class
// ============================================================================

class MeetingSummaryService {
  private config: SummaryGenerationConfig

  constructor(config?: Partial<SummaryGenerationConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...config }
  }

  /**
   * Check if LLM service is available for summary generation
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
   * Generate a summary for a meeting
   *
   * @param meetingId - The meeting ID to generate summary for
   * @param config - Optional configuration overrides
   */
  async generateSummary(
    meetingId: string,
    config?: Partial<SummaryGenerationConfig>
  ): Promise<SummaryGenerationResult> {
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
    const formattedTranscript = formatTranscriptsForLLM(limitedTranscripts)
    const transcriptCharacterCount = formattedTranscript.length

    // Build the user prompt
    const userPrompt = SUMMARY_USER_PROMPT_TEMPLATE.replace('{TRANSCRIPT}', formattedTranscript)

    // Build messages for LLM
    const messages: ChatMessage[] = [
      { role: 'system', content: SUMMARY_SYSTEM_PROMPT },
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
          llmResponseTimeMs
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
          llmResponseTimeMs
        }
      }
    }

    // Parse the structured summary
    const parsed = parseStructuredSummary(llmContent)
    if (!parsed.valid || !parsed.data) {
      return {
        success: false,
        error: parsed.error || 'Failed to parse LLM response',
        metadata: {
          processingTimeMs: Date.now() - startTime,
          transcriptSegmentCount: limitedTranscripts.length,
          transcriptCharacterCount,
          llmResponseTimeMs
        }
      }
    }

    // Create meeting notes from the summary
    const createdNotes = await this.createNotesFromSummary(meetingId, parsed.data, mergedConfig)

    return {
      success: true,
      summary: parsed.data,
      createdNotes,
      metadata: {
        processingTimeMs: Date.now() - startTime,
        transcriptSegmentCount: limitedTranscripts.length,
        transcriptCharacterCount,
        llmResponseTimeMs
      }
    }
  }

  /**
   * Create meeting notes from a structured summary
   */
  private async createNotesFromSummary(
    meetingId: string,
    summary: StructuredSummary,
    config: SummaryGenerationConfig
  ): Promise<MeetingNote[]> {
    const createdNotes: MeetingNote[] = []

    // Always create the overall summary note
    console.log('[MeetingSummary] Creating Meeting Summary note...')
    const summaryNote = meetingNoteService.create({
      meeting_id: meetingId,
      content: summary.overallSummary,
      note_type: 'summary',
      is_ai_generated: true
    })
    console.log('[MeetingSummary] ✅ Meeting Summary saved to database')
    console.log('[MeetingSummary] - Table: meeting_notes')
    console.log('[MeetingSummary] - Note ID:', summaryNote.id)
    console.log('[MeetingSummary] - Meeting ID:', meetingId)
    console.log('[MeetingSummary] - Note Type:', summaryNote.note_type)
    console.log('[MeetingSummary] - Content Length:', summary.overallSummary.length, 'characters')
    console.log('[MeetingSummary] - Is AI Generated:', summaryNote.is_ai_generated)
    createdNotes.push(summaryNote)

    // Create key points as individual notes
    if (config.includeKeyPoints && summary.keyPoints.length > 0) {
      for (const keyPoint of summary.keyPoints) {
        const note = meetingNoteService.create({
          meeting_id: meetingId,
          content: keyPoint,
          note_type: 'key_point',
          is_ai_generated: true
        })
        createdNotes.push(note)
      }
    }

    // Create action items as individual notes
    if (config.includeActionItems && summary.actionItems.length > 0) {
      for (const actionItem of summary.actionItems) {
        let content = actionItem.content
        if (actionItem.speaker) {
          content = `[${actionItem.speaker}] ${content}`
        }
        if (actionItem.priority) {
          content = `[${actionItem.priority.toUpperCase()}] ${content}`
        }

        const note = meetingNoteService.create({
          meeting_id: meetingId,
          content,
          note_type: 'action_item',
          is_ai_generated: true
        })
        createdNotes.push(note)
      }
    }

    // Create decisions as individual notes
    if (config.includeDecisions && summary.decisions.length > 0) {
      for (const decision of summary.decisions) {
        const note = meetingNoteService.create({
          meeting_id: meetingId,
          content: decision,
          note_type: 'decision',
          is_ai_generated: true
        })
        createdNotes.push(note)
      }
    }

    return createdNotes
  }

  /**
   * Update service configuration
   */
  updateConfig(config: Partial<SummaryGenerationConfig>): void {
    this.config = { ...this.config, ...config }
  }

  /**
   * Get current configuration
   */
  getConfig(): SummaryGenerationConfig {
    return { ...this.config }
  }

  /**
   * Delete AI-generated summary notes for a meeting
   * (useful for regenerating summaries)
   */
  async deleteExistingSummary(meetingId: string): Promise<{ deleted: number }> {
    const existingNotes = meetingNoteService.getAIGenerated(meetingId)
    let deleted = 0

    for (const note of existingNotes) {
      if (meetingNoteService.delete(note.id)) {
        deleted++
      }
    }

    return { deleted }
  }
}

// ============================================================================
// Singleton Export
// ============================================================================

export const meetingSummaryService = new MeetingSummaryService()

/**
 * Reset service configuration to defaults
 */
export function resetMeetingSummaryConfig(): void {
  meetingSummaryService.updateConfig(DEFAULT_CONFIG)
}

export default meetingSummaryService
