/**
 * Action Items Extraction Service
 *
 * Implements prompt engineering for extracting action items from meeting transcripts.
 * Sends transcript to LLM (via LM Studio), receives structured JSON output with
 * task, assignee, priority, and due date. Creates both meeting notes and tasks.
 *
 * This service orchestrates:
 * 1. Fetching transcripts for a meeting
 * 2. Sending transcript data to LLM with specialized prompts for action items
 * 3. Parsing and validating structured JSON responses
 * 4. Creating meeting notes of type 'action_item'
 * 5. Creating tasks from extracted action items
 */

import { llmRoutingService } from './llm/llmRoutingService'
import type { ChatMessage } from './lm-studio-client'
import { transcriptService } from './transcriptService'
import { meetingNoteService } from './meetingNoteService'
import { taskService } from './taskService'
import { actionItemValidationService } from './actionItemValidationService'
import type { ValidationResult } from './actionItemValidationService'
import type { MeetingNote, Task, Transcript, TaskPriority } from '../../src/types/database'

// ============================================================================
// Types
// ============================================================================

/**
 * Configuration for action items extraction
 */
export interface ActionItemsExtractionConfig {
  /** Maximum tokens for LLM response */
  maxTokens?: number
  /** Temperature for response randomness (0.0 - 1.0) */
  temperature?: number
  /** Whether to create tasks from extracted action items */
  createTasks?: boolean
  /** Whether to create meeting notes from extracted action items */
  createNotes?: boolean
  /** Maximum transcript segments to include (for token efficiency) */
  maxTranscriptSegments?: number
  /** Whether to enable strict validation (default: true) */
  enableValidation?: boolean
  /** Whether to use LLM for validation edge cases (default: false) */
  useLLMValidation?: boolean
}

/**
 * A single extracted action item from the transcript
 */
export interface ExtractedActionItem {
  /** The task description */
  task: string
  /** Person assigned to the task (extracted from transcript, may be speaker ID) */
  assignee: string | null
  /** Priority level */
  priority: TaskPriority
  /** Due date if mentioned (ISO 8601 date string or relative description) */
  dueDate: string | null
  /** Additional context or notes about the action item */
  context: string | null
  /** Speaker who mentioned/assigned this action item */
  speaker: string | null
  /** Validation result (populated after validation) */
  validationResult?: ValidationResult
}

/**
 * Structured response from LLM for action items extraction
 */
export interface ActionItemsExtractionResponse {
  /** List of extracted action items */
  actionItems: ExtractedActionItem[]
  /** Summary of what types of action items were found */
  summary: string
  /** Any warnings or notes about the extraction */
  notes: string[]
}

/**
 * Result of action items extraction
 */
export interface ActionItemsExtractionResult {
  /** Whether extraction was successful */
  success: boolean
  /** Error message if failed */
  error?: string
  /** The extracted action items */
  extractedItems?: ExtractedActionItem[]
  /** Meeting notes created from action items */
  createdNotes?: MeetingNote[]
  /** Tasks created from action items */
  createdTasks?: Task[]
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
    /** Number of action items extracted */
    actionItemCount: number
    /** Number of items that passed validation */
    validatedActionItemCount?: number
    /** Number of items moved to tasks due to validation failure */
    movedToTasksCount?: number
    /** Validation processing time */
    validationTimeMs?: number
  }
}

// ============================================================================
// Default Configuration
// ============================================================================

const DEFAULT_CONFIG: ActionItemsExtractionConfig = {
  maxTokens: 4096,
  temperature: 0.2, // Lower temperature for more consistent extraction
  createTasks: true,
  createNotes: true,
  maxTranscriptSegments: 200,
  enableValidation: true,
  useLLMValidation: false
}

// ============================================================================
// System Prompts for Action Items Extraction
// ============================================================================

/**
 * System prompt for action items extraction
 */
const ACTION_ITEMS_SYSTEM_PROMPT = `You are an expert at extracting action items from meeting transcripts. Your task is to identify specific, actionable tasks that were assigned or discussed during the meeting.

GUIDELINES:
1. Focus on explicit commitments, assignments, and follow-up items
2. Extract the person responsible if mentioned (may be a speaker ID like SPEAKER_0)
3. Determine priority based on urgency cues in the conversation
4. Extract due dates if explicitly mentioned or implied
5. Include relevant context that clarifies the task
6. Do NOT invent or assume action items that weren't discussed
7. If no action items are found, return an empty array

PRIORITY LEVELS:
- "urgent": Needs immediate attention, critical deadlines
- "high": Important, should be done soon
- "medium": Normal priority, standard timeline
- "low": Nice to have, can be done when time permits

OUTPUT FORMAT:
You MUST respond with valid JSON only, no additional text or markdown formatting.
`

/**
 * User prompt template for action items extraction
 */
const ACTION_ITEMS_USER_PROMPT_TEMPLATE = `Please analyze the following meeting transcript and extract all action items.

TRANSCRIPT:
{TRANSCRIPT}

Generate a JSON response with the following structure:
{
  "actionItems": [
    {
      "task": "Clear description of what needs to be done",
      "assignee": "Person responsible (SPEAKER_X or name if mentioned, null if not specified)",
      "priority": "low|medium|high|urgent",
      "dueDate": "YYYY-MM-DD or relative like 'next week', 'by Friday', or null if not mentioned",
      "context": "Additional context from the discussion that clarifies the task",
      "speaker": "SPEAKER_X who mentioned or assigned this item"
    }
  ],
  "summary": "Brief summary of the types of action items found",
  "notes": ["Any warnings or notes about unclear items"]
}

IMPORTANT:
- Only include genuine action items explicitly discussed in the transcript
- If assignee is unclear, set to null
- If due date is not mentioned, set to null
- Priority should be "medium" if no urgency indicators are present
- Context should help clarify the task without being too verbose
- Return empty actionItems array if no action items are found

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
 * Parse and validate LLM response as ActionItemsExtractionResponse
 */
function parseActionItemsResponse(content: string): { valid: boolean; data?: ActionItemsExtractionResponse; error?: string } {
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
    if (!Array.isArray(data.actionItems)) {
      return { valid: false, error: 'Missing or invalid actionItems array' }
    }

    // Normalize and validate action items
    const validPriorities: TaskPriority[] = ['low', 'medium', 'high', 'urgent']
    const actionItems: ExtractedActionItem[] = data.actionItems.map((item: unknown) => {
      if (typeof item !== 'object' || item === null) {
        return null
      }

      const obj = item as Record<string, unknown>

      // Task is required
      if (typeof obj.task !== 'string' || !obj.task.trim()) {
        return null
      }

      // Validate and normalize priority
      let priority: TaskPriority = 'medium'
      if (typeof obj.priority === 'string' && validPriorities.includes(obj.priority as TaskPriority)) {
        priority = obj.priority as TaskPriority
      }

      return {
        task: obj.task.trim(),
        assignee: typeof obj.assignee === 'string' && obj.assignee.trim() ? obj.assignee.trim() : null,
        priority,
        dueDate: typeof obj.dueDate === 'string' && obj.dueDate.trim() ? obj.dueDate.trim() : null,
        context: typeof obj.context === 'string' && obj.context.trim() ? obj.context.trim() : null,
        speaker: typeof obj.speaker === 'string' && obj.speaker.trim() ? obj.speaker.trim() : null
      }
    }).filter((item: ExtractedActionItem | null): item is ExtractedActionItem => item !== null)

    const response: ActionItemsExtractionResponse = {
      actionItems,
      summary: typeof data.summary === 'string' ? data.summary : '',
      notes: Array.isArray(data.notes) ? data.notes.filter((n: unknown) => typeof n === 'string') : []
    }

    return { valid: true, data: response }
  } catch (error) {
    return { valid: false, error: `Failed to parse JSON: ${error instanceof Error ? error.message : String(error)}` }
  }
}

/**
 * Parse relative date strings into ISO date format
 * Returns null if parsing fails
 */
function parseDueDateString(dueDateStr: string | null): string | null {
  if (!dueDateStr) return null

  // If already in ISO format (YYYY-MM-DD), return as-is
  if (/^\d{4}-\d{2}-\d{2}$/.test(dueDateStr)) {
    return dueDateStr
  }

  const today = new Date()
  const lowercaseDate = dueDateStr.toLowerCase()

  // Handle common relative date patterns
  if (lowercaseDate.includes('today')) {
    return today.toISOString().split('T')[0]
  }

  if (lowercaseDate.includes('tomorrow')) {
    const tomorrow = new Date(today)
    tomorrow.setDate(tomorrow.getDate() + 1)
    return tomorrow.toISOString().split('T')[0]
  }

  if (lowercaseDate.includes('next week')) {
    const nextWeek = new Date(today)
    nextWeek.setDate(nextWeek.getDate() + 7)
    return nextWeek.toISOString().split('T')[0]
  }

  if (lowercaseDate.includes('next month')) {
    const nextMonth = new Date(today)
    nextMonth.setMonth(nextMonth.getMonth() + 1)
    return nextMonth.toISOString().split('T')[0]
  }

  // Handle "by Friday", "by Monday", etc.
  const dayMatch = lowercaseDate.match(/by\s+(monday|tuesday|wednesday|thursday|friday|saturday|sunday)/i)
  if (dayMatch) {
    const dayNames = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday']
    const targetDay = dayNames.indexOf(dayMatch[1].toLowerCase())
    const currentDay = today.getDay()
    let daysUntil = targetDay - currentDay
    if (daysUntil <= 0) {
      daysUntil += 7 // Next occurrence
    }
    const targetDate = new Date(today)
    targetDate.setDate(targetDate.getDate() + daysUntil)
    return targetDate.toISOString().split('T')[0]
  }

  // Handle "in X days/weeks"
  const inDaysMatch = lowercaseDate.match(/in\s+(\d+)\s+(day|days)/i)
  if (inDaysMatch) {
    const days = parseInt(inDaysMatch[1], 10)
    const targetDate = new Date(today)
    targetDate.setDate(targetDate.getDate() + days)
    return targetDate.toISOString().split('T')[0]
  }

  const inWeeksMatch = lowercaseDate.match(/in\s+(\d+)\s+(week|weeks)/i)
  if (inWeeksMatch) {
    const weeks = parseInt(inWeeksMatch[1], 10)
    const targetDate = new Date(today)
    targetDate.setDate(targetDate.getDate() + weeks * 7)
    return targetDate.toISOString().split('T')[0]
  }

  // Return null if we can't parse it - the original string can still be stored as context
  return null
}

// ============================================================================
// Action Items Extraction Service Class
// ============================================================================

class ActionItemsService {
  private config: ActionItemsExtractionConfig

  constructor(config?: Partial<ActionItemsExtractionConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...config }
  }

  /**
   * Check if LLM service is available for action items extraction
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
   * Extract action items from a meeting transcript
   *
   * @param meetingId - The meeting ID to extract action items from
   * @param config - Optional configuration overrides
   */
  async extractActionItems(
    meetingId: string,
    config?: Partial<ActionItemsExtractionConfig>
  ): Promise<ActionItemsExtractionResult> {
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
          transcriptCharacterCount: 0,
          actionItemCount: 0
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
          transcriptCharacterCount: 0,
          actionItemCount: 0
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
    const userPrompt = ACTION_ITEMS_USER_PROMPT_TEMPLATE.replace('{TRANSCRIPT}', formattedTranscript)

    // Build messages for LLM
    const messages: ChatMessage[] = [
      { role: 'system', content: ACTION_ITEMS_SYSTEM_PROMPT },
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
          actionItemCount: 0
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
          actionItemCount: 0
        }
      }
    }

    // Parse the action items response
    const parsed = parseActionItemsResponse(llmContent)
    if (!parsed.valid || !parsed.data) {
      return {
        success: false,
        error: parsed.error || 'Failed to parse LLM response',
        metadata: {
          processingTimeMs: Date.now() - startTime,
          transcriptSegmentCount: limitedTranscripts.length,
          transcriptCharacterCount,
          llmResponseTimeMs,
          actionItemCount: 0
        }
      }
    }

    const extractedItems = parsed.data.actionItems
    let createdNotes: MeetingNote[] = []
    let createdTasks: Task[] = []
    let validatedActionItemCount = 0
    let movedToTasksCount = 0
    let validationTimeMs = 0

    // Validate action items if enabled
    if (mergedConfig.enableValidation && extractedItems.length > 0) {
      const validationStartTime = Date.now()

      for (const item of extractedItems) {
        const validationResult = await actionItemValidationService.validate(
          {
            task: item.task,
            assignee: item.assignee,
            deadline: item.dueDate,
            priority: item.priority,
            context: item.context,
            speaker: item.speaker
          },
          null, // No subject context in this service (subject-aware service handles that)
          mergedConfig.useLLMValidation
        )

        item.validationResult = validationResult

        if (validationResult.isValid) {
          validatedActionItemCount++
        } else {
          movedToTasksCount++
        }
      }

      validationTimeMs = Date.now() - validationStartTime
    }

    // Create meeting notes from action items if enabled
    if (mergedConfig.createNotes && extractedItems.length > 0) {
      createdNotes = this.createNotesFromActionItems(meetingId, extractedItems)
    }

    // Create tasks from action items if enabled
    if (mergedConfig.createTasks && extractedItems.length > 0) {
      createdTasks = this.createTasksFromActionItems(meetingId, extractedItems)
    }

    return {
      success: true,
      extractedItems,
      createdNotes,
      createdTasks,
      metadata: {
        processingTimeMs: Date.now() - startTime,
        transcriptSegmentCount: limitedTranscripts.length,
        transcriptCharacterCount,
        llmResponseTimeMs,
        actionItemCount: extractedItems.length,
        validatedActionItemCount: mergedConfig.enableValidation ? validatedActionItemCount : undefined,
        movedToTasksCount: mergedConfig.enableValidation ? movedToTasksCount : undefined,
        validationTimeMs: mergedConfig.enableValidation ? validationTimeMs : undefined
      }
    }
  }

  /**
   * Create meeting notes from extracted action items
   * Items that fail validation are marked as 'custom' notes instead of 'action_item'
   */
  private createNotesFromActionItems(meetingId: string, items: ExtractedActionItem[]): MeetingNote[] {
    const createdNotes: MeetingNote[] = []

    for (const item of items) {
      // Check if item passed validation
      const isValidActionItem = !item.validationResult || item.validationResult.isValid

      // Build note content with all relevant information
      let content = ''

      // Use formatted action item format for valid items
      if (isValidActionItem && item.assignee) {
        content = `[${item.assignee}] ${item.task}`
        if (item.dueDate) {
          content += ` — Due: ${item.dueDate}`
        }
      } else {
        // Standard format for invalid items
        content = item.task

        if (item.assignee) {
          content = `[${item.assignee}] ${content}`
        }

        if (item.priority && item.priority !== 'medium') {
          content = `[${item.priority.toUpperCase()}] ${content}`
        }

        if (item.dueDate) {
          content = `${content} (Due: ${item.dueDate})`
        }
      }

      if (item.context) {
        content = `${content}\n\nContext: ${item.context}`
      }

      // Add validation failure note
      if (item.validationResult && !item.validationResult.isValid) {
        const failureNote = actionItemValidationService.formatValidationFailure(item.validationResult)
        content = `${content}\n\n${failureNote}`
      }

      const note = meetingNoteService.create({
        meeting_id: meetingId,
        content,
        note_type: isValidActionItem ? 'action_item' : 'custom',
        is_ai_generated: true
      })
      createdNotes.push(note)
    }

    return createdNotes
  }

  /**
   * Create tasks from extracted action items
   * Items that fail validation get validation metadata added to description
   */
  private createTasksFromActionItems(meetingId: string, items: ExtractedActionItem[]): Task[] {
    const createdTasks: Task[] = []

    for (const item of items) {
      // Parse the due date string into ISO format
      const parsedDueDate = parseDueDateString(item.dueDate)

      // Build description with context
      let description = ''
      if (item.context) {
        description = item.context
      }
      if (item.speaker) {
        description = description
          ? `${description}\n\nMentioned by: ${item.speaker}`
          : `Mentioned by: ${item.speaker}`
      }
      if (item.dueDate && !parsedDueDate) {
        // If we couldn't parse the date, add the original string to description
        description = description
          ? `${description}\n\nOriginal due date mentioned: ${item.dueDate}`
          : `Original due date mentioned: ${item.dueDate}`
      }

      // Add validation metadata if item failed validation
      if (item.validationResult && !item.validationResult.isValid) {
        const failureNote = actionItemValidationService.formatValidationFailure(item.validationResult)
        description = description
          ? `${description}\n\n${failureNote}`
          : failureNote
      }

      const task = taskService.create({
        meeting_id: meetingId,
        title: item.task,
        description: description || null,
        assignee: item.assignee,
        due_date: parsedDueDate,
        priority: item.priority,
        status: 'pending'
      })
      createdTasks.push(task)
    }

    return createdTasks
  }

  /**
   * Delete existing AI-generated action item notes for a meeting
   * (useful for re-extracting action items)
   */
  async deleteExistingActionItems(meetingId: string): Promise<{ deletedNotes: number; deletedTasks: number }> {
    // Delete AI-generated action item notes
    const existingNotes = meetingNoteService.getByType(meetingId, 'action_item')
    let deletedNotes = 0

    for (const note of existingNotes) {
      if (note.is_ai_generated && meetingNoteService.delete(note.id)) {
        deletedNotes++
      }
    }

    // Note: We don't delete tasks by default as they may have been modified by the user
    // If needed, a separate method can be added to delete tasks associated with a meeting

    return { deletedNotes, deletedTasks: 0 }
  }

  /**
   * Update service configuration
   */
  updateConfig(config: Partial<ActionItemsExtractionConfig>): void {
    this.config = { ...this.config, ...config }
  }

  /**
   * Get current configuration
   */
  getConfig(): ActionItemsExtractionConfig {
    return { ...this.config }
  }
}

// ============================================================================
// Singleton Export
// ============================================================================

export const actionItemsService = new ActionItemsService()

/**
 * Reset service configuration to defaults
 */
export function resetActionItemsConfig(): void {
  actionItemsService.updateConfig(DEFAULT_CONFIG)
}

export default actionItemsService
