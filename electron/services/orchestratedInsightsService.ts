/**
 * Orchestrated Insights Generation Service
 *
 * Implements a single coordinated LLM prompt system that generates all insight sections
 * in one pass to ensure consistency and prevent content duplication.
 *
 * Key Features:
 * 1. Single master prompt generates all sections atomically
 * 2. Structured deduplication instructions (high-level takeaways vs granular details)
 * 3. JSON schema validation with retry logic
 * 4. Fallback to sequential generation if unified approach fails
 * 5. Progress tracking with detailed stage events
 * 6. Timeout handling (5 minute maximum)
 * 7. LLM response metadata storage (model, tokens, generation time)
 */

import { llmRoutingService } from './llm/llmRoutingService'
import type { ChatMessage } from './lm-studio-client'
import { transcriptService } from './transcriptService'
import { meetingNoteService } from './meetingNoteService'
import { taskService } from './taskService'
import { unifiedInsightsService } from './unifiedInsightsService'
import type { MeetingNote, Task, Transcript } from '../../src/types/database'

// ============================================================================
// Types
// ============================================================================

/**
 * Progress stages for orchestrated generation
 */
export type ProgressStage =
  | 'analyzing_transcript'
  | 'generating_overview'
  | 'extracting_insights'
  | 'validating_response'
  | 'retrying_generation'
  | 'falling_back_sequential'
  | 'finalizing'
  | 'completed'
  | 'failed'

/**
 * Progress event emitted during generation
 */
export interface OrchestrationProgress {
  stage: ProgressStage
  message: string
  percentage: number
  timestamp: number
}

/**
 * LLM response metadata
 */
export interface LLMResponseMetadata {
  model: string
  provider: string
  tokensConsumed?: number
  generationTimeMs: number
  retryCount: number
  fallbackUsed: boolean
  validationAttempts: number
}

/**
 * Overview section response
 */
export interface OverviewSection {
  narrative_summary: string // 250-400 words
  key_takeaways: string[] // 3-5 high-level insights
  overall_sentiment: 'positive' | 'negative' | 'neutral' | 'mixed'
  sentiment_explanation: string
  topic_outline: {
    name: string
    subtopics?: string[]
  }[]
}

/**
 * Insights section response
 */
export interface InsightsSection {
  action_items: {
    task: string
    owner: string
    deadline?: string
    context?: string
    in_scope: boolean
  }[]
  decisions: {
    decision: string
    context: string
    speakers?: string[]
  }[]
  key_points: {
    content: string
    category: 'fact' | 'discussion' | 'concern' | 'agreement' | 'disagreement'
    speakers?: string[]
  }[]
  topics: {
    name: string
    keywords: string[]
    duration_ms?: number
  }[]
}

/**
 * Complete orchestrated response from LLM
 */
export interface OrchestratedResponse {
  overview: OverviewSection
  insights: InsightsSection
}

/**
 * Configuration for orchestrated generation
 */
export interface OrchestrationConfig {
  maxTokens?: number
  temperature?: number
  timeoutMs?: number
  maxRetries?: number
  createTasks?: boolean
  noteGenerationMode?: 'strict' | 'balanced' | 'loose'
}

/**
 * Result of orchestrated generation
 */
export interface OrchestrationResult {
  success: boolean
  error?: string
  createdNotes: MeetingNote[]
  createdTasks: Task[]
  metadata: LLMResponseMetadata
  extractedData?: OrchestratedResponse
}

// ============================================================================
// Default Configuration
// ============================================================================

const DEFAULT_CONFIG: OrchestrationConfig = {
  maxTokens: 16384,
  temperature: 0.2,
  timeoutMs: 300000, // 5 minutes
  maxRetries: 2,
  createTasks: true,
  noteGenerationMode: 'strict'
}

// ============================================================================
// System Prompt - Master Orchestrated Prompt
// ============================================================================

const ORCHESTRATED_SYSTEM_PROMPT = `You are an expert meeting analyst specializing in comprehensive meeting analysis.

Your task is to analyze meeting transcripts and generate structured insights in a SINGLE coordinated pass to ensure consistency and prevent duplication.

CRITICAL DEDUPLICATION RULE:
- Key Takeaways (Overview) = HIGH-LEVEL strategic insights and main themes
- Key Points (Insights) = GRANULAR factual details and specific discussion points
- DO NOT repeat the same content in both sections
- Takeaways should be synthesized from multiple points, Points should be specific facts

GUIDELINES:
1. Analyze the entire transcript holistically before generating any section
2. Ensure consistency across all sections
3. Speaker IDs (SPEAKER_0, SPEAKER_1, etc.) should be preserved as-is - do not invent names
4. Only extract information explicitly stated or strongly implied
5. Be thorough but avoid redundancy between sections
6. Generate a cohesive, unified analysis

OUTPUT FORMAT:
You MUST respond with valid JSON only, no markdown formatting or additional text.`

// ============================================================================
// User Prompt Template
// ============================================================================

/**
 * Get mode-specific filtering instructions
 */
function getModeFilteringInstructions(mode: 'strict' | 'balanced' | 'loose'): string {
  switch (mode) {
    case 'strict':
      return `FILTERING MODE: STRICT
- Extract ONLY highly important, in-scope content
- Action items MUST have clear task, owner, and deadline (or explicit "TBD")
- Only include final, explicit decisions
- Key points must be critical insights only
- Key takeaways should be the 3-5 most important high-level insights
- Ignore small talk, tangents, and unclear content`

    case 'balanced':
      return `FILTERING MODE: BALANCED
- Include important AND moderately relevant content
- Action items can have "TBD" if context suggests later determination
- Include strongly implied decisions
- Key points include important details and supporting information
- Key takeaways should capture 3-5 main themes
- Balance comprehensiveness with relevance`

    case 'loose':
      return `FILTERING MODE: LOOSE
- Include all potentially useful content
- Action items can be flexible with "TBD" fields
- Include discussed decisions even if not fully finalized
- Key points include all useful contextual information
- Key takeaways should capture 4-5 broad themes
- Only filter out definitely irrelevant content`

    default:
      return getModeFilteringInstructions('strict')
  }
}

function createOrchestratedUserPrompt(
  transcript: string,
  metadata: { durationMs: number; speakerCount: number; speakers: string[] },
  mode: 'strict' | 'balanced' | 'loose'
): string {
  const modeInstructions = getModeFilteringInstructions(mode)

  return `Analyze this meeting transcript and generate structured insights in the following format.

${modeInstructions}

TRANSCRIPT:
${transcript}

TRANSCRIPT METADATA:
- Duration: ${metadata.durationMs}ms (${Math.round(metadata.durationMs / 60000)} minutes)
- Speakers: ${metadata.speakerCount} (${metadata.speakers.join(', ')})

Generate a JSON response with this EXACT structure:

{
  "overview": {
    "narrative_summary": "250-400 word comprehensive narrative summary covering the meeting's purpose, main discussions, outcomes, and overall flow. Should read like a cohesive story.",
    "key_takeaways": [
      "High-level strategic insight #1 (synthesized from multiple discussion points)",
      "High-level strategic insight #2",
      "High-level strategic insight #3"
    ],
    "overall_sentiment": "positive|negative|neutral|mixed",
    "sentiment_explanation": "Brief explanation of why this sentiment was chosen, referencing discussion tone, outcomes, and participant engagement",
    "topic_outline": [
      {
        "name": "Main Topic 1",
        "subtopics": ["Subtopic A", "Subtopic B"]
      }
    ]
  },
  "insights": {
    "action_items": [
      {
        "task": "Clear, actionable task description",
        "owner": "SPEAKER_X or TBD",
        "deadline": "Specific date/timeframe or undefined if not mentioned",
        "context": "Why this action item exists",
        "in_scope": true
      }
    ],
    "decisions": [
      {
        "decision": "Explicit decision or agreement reached",
        "context": "Background and reasoning for the decision",
        "speakers": ["SPEAKER_X", "SPEAKER_Y"]
      }
    ],
    "key_points": [
      {
        "content": "Specific factual detail or granular discussion point (NOT a high-level takeaway)",
        "category": "fact|discussion|concern|agreement|disagreement",
        "speakers": ["SPEAKER_X"]
      }
    ],
    "topics": [
      {
        "name": "Topic name",
        "keywords": ["keyword1", "keyword2", "keyword3"],
        "duration_ms": 120000
      }
    ]
  }
}

SECTION-SPECIFIC INSTRUCTIONS:

OVERVIEW SECTION:
1. narrative_summary: Write a flowing 250-400 word summary that tells the story of the meeting
2. key_takeaways: Extract 3-5 HIGH-LEVEL strategic insights (not granular details)
3. overall_sentiment: Analyze overall tone (positive/negative/neutral/mixed)
4. sentiment_explanation: Explain the sentiment with specific references
5. topic_outline: Create hierarchical structure of main topics and subtopics

INSIGHTS SECTION:
1. action_items: STRICT CRITERIA - must have task + owner + deadline (or explicit "TBD") + be in-scope
2. decisions: Explicit agreements with full context
3. key_points: GRANULAR factual details and specific discussion points (distinct from takeaways!)
4. topics: Main subjects with relevant keywords and estimated duration

DEDUPLICATION INSTRUCTION (CRITICAL):
- Key Takeaways (Overview) = High-level synthesized insights
- Key Points (Insights) = Granular specific details
- DO NOT repeat the same content in both sections
- Example:
  ✓ Takeaway: "Team aligned on aggressive Q1 timeline despite resource constraints"
  ✓ Key Point: "Launch date set for March 15th with current 5-person team"
  ✗ Both sections saying: "March 15th launch date agreed"

Respond with valid JSON only (no markdown):`.trim()
}

// ============================================================================
// JSON Schema Validation
// ============================================================================

/**
 * Validate the orchestrated response structure
 */
function validateOrchestratedResponse(data: any): {
  valid: boolean
  errors: string[]
  response?: OrchestratedResponse
} {
  const errors: string[] = []

  // Check top-level structure
  if (!data || typeof data !== 'object') {
    errors.push('Response must be a JSON object')
    return { valid: false, errors }
  }

  if (!data.overview || typeof data.overview !== 'object') {
    errors.push('Missing or invalid "overview" section')
  }

  if (!data.insights || typeof data.insights !== 'object') {
    errors.push('Missing or invalid "insights" section')
  }

  if (errors.length > 0) {
    return { valid: false, errors }
  }

  // Validate overview section
  const overview = data.overview
  if (typeof overview.narrative_summary !== 'string' || overview.narrative_summary.length < 100) {
    errors.push('narrative_summary must be a string with at least 100 characters')
  }

  if (!Array.isArray(overview.key_takeaways) || overview.key_takeaways.length < 3) {
    errors.push('key_takeaways must be an array with at least 3 items')
  }

  if (!['positive', 'negative', 'neutral', 'mixed'].includes(overview.overall_sentiment)) {
    errors.push('overall_sentiment must be one of: positive, negative, neutral, mixed')
  }

  if (typeof overview.sentiment_explanation !== 'string') {
    errors.push('sentiment_explanation must be a string')
  }

  if (!Array.isArray(overview.topic_outline)) {
    errors.push('topic_outline must be an array')
  }

  // Validate insights section
  const insights = data.insights
  if (!Array.isArray(insights.action_items)) {
    errors.push('action_items must be an array')
  } else {
    insights.action_items.forEach((item: any, idx: number) => {
      if (!item.task || typeof item.task !== 'string') {
        errors.push(`action_items[${idx}]: task is required and must be a string`)
      }
      if (!item.owner || typeof item.owner !== 'string') {
        errors.push(`action_items[${idx}]: owner is required and must be a string`)
      }
      if (typeof item.in_scope !== 'boolean') {
        errors.push(`action_items[${idx}]: in_scope must be a boolean`)
      }
    })
  }

  if (!Array.isArray(insights.decisions)) {
    errors.push('decisions must be an array')
  }

  if (!Array.isArray(insights.key_points)) {
    errors.push('key_points must be an array')
  }

  if (!Array.isArray(insights.topics)) {
    errors.push('topics must be an array')
  }

  if (errors.length > 0) {
    return { valid: false, errors }
  }

  return {
    valid: true,
    errors: [],
    response: data as OrchestratedResponse
  }
}

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Format transcripts into a readable text format for the LLM
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

  // Sort by start time
  const sorted = [...transcripts].sort((a, b) => a.start_time_ms - b.start_time_ms)

  // Calculate duration
  const startTime = sorted[0].start_time_ms
  const endTime = sorted[sorted.length - 1].end_time_ms
  const durationMs = endTime - startTime

  // Get unique speakers
  const speakerIds = new Set(sorted.map(t => t.speaker_id).filter(Boolean))
  const speakers = Array.from(speakerIds) as string[]

  // Format transcript with timestamps
  const formatted = sorted
    .map(t => {
      const timestamp = Math.floor(t.start_time_ms / 1000)
      const minutes = Math.floor(timestamp / 60)
      const seconds = timestamp % 60
      const timeStr = `[${minutes}:${seconds.toString().padStart(2, '0')}]`
      return `${timeStr} ${t.speaker_id || 'UNKNOWN'}: ${t.content}`
    })
    .join('\n')

  return {
    formatted,
    durationMs,
    speakers
  }
}

/**
 * Convert orchestrated response to meeting notes
 */
function convertToMeetingNotes(
  meetingId: string,
  response: OrchestratedResponse
): MeetingNote[] {
  const notes: MeetingNote[] = []
  const timestamp = new Date().toISOString()

  // Create overview summary note
  notes.push(
    meetingNoteService.create({
      meeting_id: meetingId,
      content: response.overview.narrative_summary,
      note_type: 'summary',
      is_ai_generated: true,
      created_during_recording: false,
      generation_timestamp: timestamp
    })
  )

  // Create sentiment note
  const sentimentContent = `**Meeting Sentiment Analysis**\n\nOverall Sentiment: ${response.overview.overall_sentiment.toUpperCase()}\n\n${response.overview.sentiment_explanation}`
  notes.push(
    meetingNoteService.create({
      meeting_id: meetingId,
      content: sentimentContent,
      note_type: 'summary',
      is_ai_generated: true,
      created_during_recording: false,
      generation_timestamp: timestamp
    })
  )

  // Create key takeaways notes
  response.overview.key_takeaways.forEach(takeaway => {
    notes.push(
      meetingNoteService.create({
        meeting_id: meetingId,
        content: takeaway,
        note_type: 'summary',
        is_ai_generated: true,
        created_during_recording: false,
        generation_timestamp: timestamp,
        keywords: JSON.stringify(['key-takeaway'])
      })
    )
  })

  // Create decision notes
  response.insights.decisions.forEach(decision => {
    notes.push(
      meetingNoteService.create({
        meeting_id: meetingId,
        content: `${decision.decision}\n\nContext: ${decision.context}`,
        note_type: 'decision',
        is_ai_generated: true,
        created_during_recording: false,
        generation_timestamp: timestamp
      })
    )
  })

  // Create key point notes
  response.insights.key_points.forEach(point => {
    notes.push(
      meetingNoteService.create({
        meeting_id: meetingId,
        content: point.content,
        note_type: 'key_point',
        is_ai_generated: true,
        created_during_recording: false,
        generation_timestamp: timestamp,
        keywords: JSON.stringify([point.category])
      })
    )
  })

  // Create topic notes
  response.insights.topics.forEach(topic => {
    const topicContent = `**${topic.name}**\n\nKeywords: ${topic.keywords.join(', ')}`
    notes.push(
      meetingNoteService.create({
        meeting_id: meetingId,
        content: topicContent,
        note_type: 'custom',
        is_ai_generated: true,
        created_during_recording: false,
        generation_timestamp: timestamp,
        keywords: JSON.stringify(topic.keywords)
      })
    )
  })

  // Create action item notes (separate from tasks)
  response.insights.action_items
    .filter(item => item.in_scope)
    .forEach(item => {
      const actionContent = `${item.task}\n\nOwner: ${item.owner}${item.deadline ? `\nDeadline: ${item.deadline}` : ''}${item.context ? `\n\nContext: ${item.context}` : ''}`
      notes.push(
        meetingNoteService.create({
          meeting_id: meetingId,
          content: actionContent,
          note_type: 'action_item',
          is_ai_generated: true,
          created_during_recording: false,
          generation_timestamp: timestamp
        })
      )
    })

  return notes
}

/**
 * Convert action items to tasks
 */
function convertToTasks(meetingId: string, actionItems: InsightsSection['action_items']): Task[] {
  const tasks: Task[] = []
  const timestamp = new Date().toISOString()

  actionItems
    .filter(item => item.in_scope)
    .forEach(item => {
      tasks.push(
        taskService.create({
          meeting_id: meetingId,
          title: item.task,
          description: item.context || null,
          assignee: item.owner !== 'TBD' ? item.owner : null,
          due_date: item.deadline || null,
          priority: 'medium',
          status: 'pending',
          created_during_recording: false,
          generation_timestamp: timestamp
        })
      )
    })

  return tasks
}

// ============================================================================
// Orchestrated Insights Service Class
// ============================================================================

class OrchestratedInsightsService {
  private config: OrchestrationConfig
  private progressCallback: ((progress: OrchestrationProgress) => void) | null = null

  constructor(config?: Partial<OrchestrationConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...config }
  }

  /**
   * Set callback for progress updates
   */
  setProgressCallback(callback: ((progress: OrchestrationProgress) => void) | null): void {
    this.progressCallback = callback
  }

  /**
   * Emit progress update
   */
  private emitProgress(stage: ProgressStage, message: string, percentage: number): void {
    if (this.progressCallback) {
      this.progressCallback({
        stage,
        message,
        percentage,
        timestamp: Date.now()
      })
    }
    console.log(`[Orchestrated Insights] ${stage}: ${message} (${percentage}%)`)
  }

  /**
   * Check if LLM service is available
   */
  async checkAvailability(): Promise<{ available: boolean; error?: string; modelInfo?: string }> {
    try {
      const available = await llmRoutingService.isAvailable()
      if (!available) {
        return {
          available: false,
          error: 'No LLM provider is currently available'
        }
      }

      const routingInfo = await llmRoutingService.getRoutingInfo()
      const modelInfo = `${routingInfo.preferredProvider}${routingInfo.selectedModel ? ` (${routingInfo.selectedModel})` : ''}`

      return {
        available: true,
        modelInfo
      }
    } catch (error) {
      return {
        available: false,
        error: error instanceof Error ? error.message : 'Unknown error checking availability'
      }
    }
  }

  /**
   * Generate all insights using orchestrated single-pass approach
   */
  async generateAllInsights(
    meetingId: string,
    config?: Partial<OrchestrationConfig>
  ): Promise<OrchestrationResult> {
    const startTime = Date.now()
    const mergedConfig = { ...this.config, ...config }
    const noteGenerationMode = mergedConfig.noteGenerationMode || 'strict'

    this.emitProgress('analyzing_transcript', 'Analyzing transcript...', 0)

    try {
      // Get transcripts
      const transcripts = transcriptService.getByMeetingId(meetingId)
      if (!transcripts || transcripts.length === 0) {
        return {
          success: false,
          error: 'No transcripts found for this meeting',
          createdNotes: [],
          createdTasks: [],
          metadata: {
            model: 'N/A',
            provider: 'N/A',
            generationTimeMs: Date.now() - startTime,
            retryCount: 0,
            fallbackUsed: false,
            validationAttempts: 0
          }
        }
      }

      // Format transcript
      const { formatted, durationMs, speakers } = formatTranscriptsForLLM(transcripts)

      this.emitProgress('generating_overview', 'Generating overview...', 20)

      // Attempt unified generation with retries
      let retryCount = 0
      let validationAttempts = 0
      let lastError: string | undefined
      const maxRetries = mergedConfig.maxRetries || 2

      while (retryCount <= maxRetries) {
        try {
          validationAttempts++

          const llmStartTime = Date.now()

          // Create the orchestrated prompt
          const userPrompt = createOrchestratedUserPrompt(
            formatted,
            { durationMs, speakerCount: speakers.length, speakers },
            noteGenerationMode
          )

          const messages: ChatMessage[] = [
            { role: 'system', content: ORCHESTRATED_SYSTEM_PROMPT },
            { role: 'user', content: userPrompt }
          ]

          // Call LLM with timeout
          const timeoutPromise = new Promise<never>((_, reject) => {
            setTimeout(() => reject(new Error('LLM request timeout')), mergedConfig.timeoutMs)
          })

          const llmPromise = llmRoutingService.chatCompletion({
            messages,
            temperature: mergedConfig.temperature,
            max_tokens: mergedConfig.maxTokens
          })

          this.emitProgress('extracting_insights', 'Extracting insights...', 40 + (retryCount * 10))

          const result = await Promise.race([llmPromise, timeoutPromise])

          if (!result.success || !result.content) {
            throw new Error(result.error || 'LLM request failed')
          }

          const llmResponseTime = Date.now() - llmStartTime

          // Parse JSON response
          let parsedData: any
          try {
            // Remove markdown code blocks if present
            let content = result.content.trim()
            if (content.startsWith('```json')) {
              content = content.replace(/^```json\s*/, '').replace(/\s*```$/, '')
            } else if (content.startsWith('```')) {
              content = content.replace(/^```\s*/, '').replace(/\s*```$/, '')
            }
            parsedData = JSON.parse(content)
          } catch (parseError) {
            throw new Error(`Failed to parse JSON response: ${parseError instanceof Error ? parseError.message : 'Unknown error'}`)
          }

          // Validate response
          this.emitProgress('validating_response', 'Validating response...', 60 + (retryCount * 10))

          const validation = validateOrchestratedResponse(parsedData)

          if (!validation.valid) {
            const errorMsg = `Schema validation failed: ${validation.errors.join(', ')}`
            console.warn(`[Orchestrated Insights] Validation failed (attempt ${validationAttempts}):`, validation.errors)

            if (retryCount < maxRetries) {
              this.emitProgress(
                'retrying_generation',
                `Validation failed, retrying... (${retryCount + 1}/${maxRetries})`,
                65 + (retryCount * 10)
              )
              retryCount++
              lastError = errorMsg
              continue
            }

            throw new Error(errorMsg)
          }

          // Success! Convert to notes and tasks
          this.emitProgress('finalizing', 'Finalizing...', 80)

          const notes = convertToMeetingNotes(meetingId, validation.response!)
          const tasks = mergedConfig.createTasks
            ? convertToTasks(meetingId, validation.response!.insights.action_items)
            : []

          this.emitProgress('completed', 'Completed!', 100)

          // Get routing info for metadata
          const routingInfo = await llmRoutingService.getRoutingInfo()

          return {
            success: true,
            createdNotes: notes,
            createdTasks: tasks,
            metadata: {
              model: routingInfo.selectedModel || 'unknown',
              provider: routingInfo.preferredProvider,
              tokensConsumed: undefined, // Not available from current API
              generationTimeMs: llmResponseTime,
              retryCount,
              fallbackUsed: false,
              validationAttempts
            },
            extractedData: validation.response
          }
        } catch (error) {
          lastError = error instanceof Error ? error.message : 'Unknown error'
          console.error(`[Orchestrated Insights] Attempt ${retryCount + 1} failed:`, lastError)

          if (retryCount >= maxRetries) {
            break
          }

          retryCount++
        }
      }

      // Unified approach failed, try fallback to sequential generation
      console.warn('[Orchestrated Insights] Unified generation failed, falling back to sequential generation')
      this.emitProgress(
        'falling_back_sequential',
        'Falling back to sequential generation...',
        70
      )

      const fallbackResult = await this.fallbackToSequentialGeneration(meetingId, mergedConfig)

      return {
        ...fallbackResult,
        metadata: {
          ...fallbackResult.metadata,
          fallbackUsed: true,
          retryCount,
          validationAttempts
        }
      }
    } catch (error) {
      this.emitProgress('failed', 'Generation failed', 0)

      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
        createdNotes: [],
        createdTasks: [],
        metadata: {
          model: 'N/A',
          provider: 'N/A',
          generationTimeMs: Date.now() - startTime,
          retryCount: 0,
          fallbackUsed: false,
          validationAttempts: 0
        }
      }
    }
  }

  /**
   * Fallback strategy: use existing unifiedInsightsService for sequential generation
   */
  private async fallbackToSequentialGeneration(
    meetingId: string,
    config: OrchestrationConfig
  ): Promise<OrchestrationResult> {
    const startTime = Date.now()

    try {
      const result = await unifiedInsightsService.generateAllInsights(meetingId, {
        maxTokens: config.maxTokens,
        temperature: config.temperature,
        noteGenerationMode: config.noteGenerationMode,
        createTasks: config.createTasks
      })

      const routingInfo = await llmRoutingService.getRoutingInfo()

      this.emitProgress('completed', 'Completed (using fallback)', 100)

      return {
        success: result.success,
        error: result.error,
        createdNotes: result.createdNotes,
        createdTasks: result.createdTasks,
        metadata: {
          model: routingInfo.selectedModel || 'unknown',
          provider: routingInfo.preferredProvider,
          generationTimeMs: Date.now() - startTime,
          retryCount: 0,
          fallbackUsed: true,
          validationAttempts: 0
        }
      }
    } catch (error) {
      this.emitProgress('failed', 'Fallback generation failed', 0)

      return {
        success: false,
        error: error instanceof Error ? error.message : 'Fallback generation failed',
        createdNotes: [],
        createdTasks: [],
        metadata: {
          model: 'N/A',
          provider: 'N/A',
          generationTimeMs: Date.now() - startTime,
          retryCount: 0,
          fallbackUsed: true,
          validationAttempts: 0
        }
      }
    }
  }

  /**
   * Update service configuration
   */
  updateConfig(config: Partial<OrchestrationConfig>): void {
    this.config = { ...this.config, ...config }
  }

  /**
   * Get current configuration
   */
  getConfig(): OrchestrationConfig {
    return { ...this.config }
  }
}

// ============================================================================
// Singleton Export
// ============================================================================

export const orchestratedInsightsService = new OrchestratedInsightsService()

export default orchestratedInsightsService
