/**
 * Live Note Generation Service
 *
 * Processes transcript segments during active recording to extract and display
 * meeting insights in real-time. As transcription segments are finalized, they
 * are batched and sent to the LLM to extract:
 *
 * 1. Key discussion points
 * 2. Preliminary action items with assignees
 * 3. Emerging decisions
 * 4. Important topics and themes
 *
 * Features:
 * - Throttled batch processing to avoid overwhelming the LLM
 * - Streaming response support for progressive display
 * - Integration with multiple LLM providers (Claude CLI, Cursor CLI, LM Studio)
 * - Incremental note consolidation when recording stops
 */

import { BrowserWindow } from 'electron'
import { randomUUID } from 'crypto'
import { llmRoutingService } from './llm/llmRoutingService'
import { meetingNoteService } from './meetingNoteService'
import { taskService } from './taskService'
import type { ChatMessage } from './lm-studio-client'
import type { NoteType, TaskPriority } from '../../src/types/database'

// ============================================================================
// Types
// ============================================================================

export type LiveNoteType = 'key_point' | 'action_item' | 'decision' | 'topic'

export interface LiveNoteItem {
  id: string
  type: LiveNoteType
  content: string
  speaker?: string | null
  priority?: 'high' | 'medium' | 'low'
  assignee?: string | null
  extractedAt: number
  sourceSegmentIds: string[]
  isPreliminary: boolean
  confidence?: number
}

export interface TranscriptSegmentInput {
  id: string
  content: string
  speaker?: string | null
  start_time_ms: number
  end_time_ms: number
}

export interface LiveNoteGenerationConfig {
  /** Interval in ms between batch processing (default: 45000 = 45 seconds) */
  batchIntervalMs: number
  /** Minimum segments required before processing (default: 3) */
  minSegmentsPerBatch: number
  /** Maximum segments per batch (default: 20) */
  maxSegmentsPerBatch: number
  /** Maximum tokens for LLM response */
  maxTokens: number
  /** Temperature for response randomness (0.0 - 1.0) */
  temperature: number
  /** Whether to extract key points */
  extractKeyPoints: boolean
  /** Whether to extract action items */
  extractActionItems: boolean
  /** Whether to extract decisions */
  extractDecisions: boolean
  /** Whether to extract topics */
  extractTopics: boolean
}

export interface LiveNoteGenerationResult {
  success: boolean
  error?: string
  notes: LiveNoteItem[]
  processingTimeMs: number
  segmentsProcessed: number
  llmProvider?: string
}

export interface LiveNoteSessionState {
  isActive: boolean
  meetingId: string | null
  startTime: number | null
  processedSegmentIds: Set<string>
  pendingSegments: TranscriptSegmentInput[]
  lastBatchTime: number | null
  batchesProcessed: number
  totalNotesGenerated: number
  /** All notes generated during this session, for persistence when session ends */
  generatedNotes: LiveNoteItem[]
}

// ============================================================================
// Default Configuration
// ============================================================================

const DEFAULT_CONFIG: LiveNoteGenerationConfig = {
  batchIntervalMs: 20000, // 20 seconds - generate notes more frequently for better live experience
  minSegmentsPerBatch: 2, // Lower threshold to capture insights sooner
  maxSegmentsPerBatch: 20,
  maxTokens: 2048,
  temperature: 0.3,
  extractKeyPoints: true,
  extractActionItems: true,
  extractDecisions: true,
  extractTopics: true,
}

// ============================================================================
// Prompts
// ============================================================================

const LIVE_NOTES_SYSTEM_PROMPT = `You are an expert meeting analyst extracting real-time insights from a live meeting transcript. Your task is to identify and extract the most important information from the current transcript segment.

IMPORTANT: This is a LIVE meeting in progress. Focus on information that would be immediately useful for meeting participants.

GUIDELINES:
1. Extract only what is explicitly stated or strongly implied
2. Be concise - each insight should be 1-2 sentences max
3. For action items, identify the task and who is responsible if mentioned
4. For decisions, capture what was decided and any context
5. For key points, identify important discussion items or insights
6. For topics, identify main themes being discussed
7. If speaker IDs are present (e.g., SPEAKER_0, SPEAKER_1), reference them but don't invent names
8. Prioritize actionable and significant content over routine discussion

OUTPUT FORMAT:
You MUST respond with valid JSON only, no additional text or markdown formatting.`

const LIVE_NOTES_USER_PROMPT_TEMPLATE = `Analyze this transcript segment from an ongoing meeting and extract key insights.

TRANSCRIPT SEGMENT:
{TRANSCRIPT}

Extract insights into this JSON structure:
{
  "keyPoints": [
    {
      "content": "Brief description of the key point",
      "speaker": "SPEAKER_X (if identifiable)",
      "confidence": 0.0-1.0
    }
  ],
  "actionItems": [
    {
      "content": "Description of the action item",
      "assignee": "Person responsible (if mentioned)",
      "speaker": "SPEAKER_X (if identifiable)",
      "priority": "high|medium|low",
      "confidence": 0.0-1.0
    }
  ],
  "decisions": [
    {
      "content": "What was decided",
      "speaker": "SPEAKER_X (if identifiable)",
      "confidence": 0.0-1.0
    }
  ],
  "topics": [
    {
      "content": "Topic or theme being discussed",
      "confidence": 0.0-1.0
    }
  ]
}

IMPORTANT:
- Only include items with confidence >= 0.6
- If no items of a category are found, use empty arrays
- Be selective - only include genuinely important items
- Maximum 5 items per category

Respond with JSON only:`

// ============================================================================
// Service Class
// ============================================================================

class LiveNoteGenerationService {
  private config: LiveNoteGenerationConfig
  private sessionState: LiveNoteSessionState
  private batchTimer: NodeJS.Timeout | null = null
  private isProcessing: boolean = false

  constructor(config?: Partial<LiveNoteGenerationConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...config }
    this.sessionState = this.createInitialSessionState()
  }

  private createInitialSessionState(): LiveNoteSessionState {
    return {
      isActive: false,
      meetingId: null,
      startTime: null,
      processedSegmentIds: new Set<string>(),
      pendingSegments: [],
      lastBatchTime: null,
      batchesProcessed: 0,
      totalNotesGenerated: 0,
      generatedNotes: [],
    }
  }

  // --------------------------------------------------------------------------
  // Session Management
  // --------------------------------------------------------------------------

  /**
   * Start a new live note generation session
   */
  async startSession(
    meetingId: string,
    config?: Partial<LiveNoteGenerationConfig>
  ): Promise<{ success: boolean; error?: string; llmProvider?: string }> {
    if (this.sessionState.isActive) {
      await this.stopSession()
    }

    // Check LLM availability
    const availability = await this.checkAvailability()
    if (!availability.available) {
      return { success: false, error: availability.error }
    }

    // Update config if provided
    if (config) {
      this.config = { ...this.config, ...config }
    }

    // Initialize session state
    this.sessionState = {
      isActive: true,
      meetingId,
      startTime: Date.now(),
      processedSegmentIds: new Set<string>(),
      pendingSegments: [],
      lastBatchTime: null,
      batchesProcessed: 0,
      totalNotesGenerated: 0,
      generatedNotes: [],
    }

    // Start batch processing timer
    this.startBatchTimer()

    console.log(`[LiveNoteGeneration] Session started for meeting ${meetingId}`)
    this.emitStatusUpdate('starting')

    return { success: true, llmProvider: availability.modelInfo }
  }

  /**
   * Stop the live note generation session
   */
  async stopSession(): Promise<{
    success: boolean
    totalNotes: number
    batchesProcessed: number
    persistedNotes: number
    persistedTasks: number
  }> {
    this.stopBatchTimer()

    const result = {
      success: true,
      totalNotes: this.sessionState.totalNotesGenerated,
      batchesProcessed: this.sessionState.batchesProcessed,
      persistedNotes: 0,
      persistedTasks: 0,
    }

    // Process any remaining pending segments
    if (this.sessionState.pendingSegments.length > 0) {
      console.log(`[LiveNoteGeneration] Processing ${this.sessionState.pendingSegments.length} remaining segments`)
      await this.processBatch()
    }

    // Persist all generated notes to the database before clearing session
    const meetingId = this.sessionState.meetingId
    const generatedNotes = this.sessionState.generatedNotes

    if (meetingId && generatedNotes.length > 0) {
      console.log(`[LiveNoteGeneration] Persisting ${generatedNotes.length} notes to database for meeting ${meetingId}`)

      const persistResult = await this.persistNotesToDatabase(meetingId, generatedNotes)
      result.persistedNotes = persistResult.notesCreated
      result.persistedTasks = persistResult.tasksCreated

      console.log(`[LiveNoteGeneration] Persisted ${persistResult.notesCreated} notes and ${persistResult.tasksCreated} tasks to database`)

      // Emit event to notify frontend that notes have been persisted
      this.emitNotesPersisted({
        meetingId,
        notesCount: persistResult.notesCreated,
        tasksCount: persistResult.tasksCreated,
      })
    }

    console.log(`[LiveNoteGeneration] Session stopped. Total notes: ${result.totalNotes}, Batches: ${result.batchesProcessed}, Persisted: ${result.persistedNotes} notes, ${result.persistedTasks} tasks`)

    this.sessionState = this.createInitialSessionState()
    this.emitStatusUpdate('idle')

    return result
  }

  /**
   * Persist generated notes to the database
   * Converts live note items to meeting notes and creates tasks for action items
   * Includes retry logic for resilience and progress reporting
   */
  private async persistNotesToDatabase(
    meetingId: string,
    notes: LiveNoteItem[]
  ): Promise<{ notesCreated: number; tasksCreated: number; errors: string[] }> {
    let notesCreated = 0
    let tasksCreated = 0
    const errors: string[] = []
    const actionItemCount = notes.filter(n => n.type === 'action_item').length
    const totalItems = notes.length + actionItemCount // notes + tasks for action items

    // Emit saving status to frontend
    this.emitSaveProgress({
      meetingId,
      total: totalItems,
      saved: 0,
      currentType: 'notes',
    })

    for (let i = 0; i < notes.length; i++) {
      const note = notes[i]
      let retryCount = 0
      const maxRetries = 3
      let noteCreated = false

      while (!noteCreated && retryCount < maxRetries) {
        try {
          // Map live note type to database note type
          const noteType: NoteType = this.mapLiveNoteTypeToDbNoteType(note.type)

          // Format content based on note type
          let content = note.content

          // For topics, format as structured markdown so parseTopicFromNote can parse it correctly
          if (note.type === 'topic') {
            content = this.formatTopicForStorage(note)
          }

          // Create the meeting note in database
          meetingNoteService.create({
            meeting_id: meetingId,
            content,
            note_type: noteType,
            is_ai_generated: true,
            source_transcript_ids: note.sourceSegmentIds,
          })
          notesCreated++
          noteCreated = true

          // Emit progress update
          this.emitSaveProgress({
            meetingId,
            total: totalItems,
            saved: notesCreated,
            currentType: 'notes',
          })
        } catch (noteError) {
          retryCount++
          const errorMsg = noteError instanceof Error ? noteError.message : 'Unknown error'
          console.error(`[LiveNoteGeneration] Failed to persist note (attempt ${retryCount}/${maxRetries}):`, noteError, note)

          if (retryCount >= maxRetries) {
            errors.push(`Failed to save note "${note.content.substring(0, 50)}...": ${errorMsg}`)
          } else {
            // Wait before retrying (exponential backoff)
            await new Promise(resolve => setTimeout(resolve, 100 * Math.pow(2, retryCount)))
          }
        }
      }

      // For action items, also create a task
      if (note.type === 'action_item' && noteCreated) {
        let taskRetryCount = 0
        let taskCreated = false

        while (!taskCreated && taskRetryCount < maxRetries) {
          try {
            const priority: TaskPriority = this.mapNotePriorityToTaskPriority(note.priority)

            taskService.create({
              meeting_id: meetingId,
              title: note.content,
              description: note.speaker ? `From ${note.speaker} during meeting` : 'Extracted from live meeting notes',
              assignee: note.assignee || null,
              priority,
              status: 'pending',
            })
            tasksCreated++
            taskCreated = true

            // Emit progress update for task
            this.emitSaveProgress({
              meetingId,
              total: totalItems,
              saved: notesCreated + tasksCreated,
              currentType: 'tasks',
            })
          } catch (taskError) {
            taskRetryCount++
            const errorMsg = taskError instanceof Error ? taskError.message : 'Unknown error'
            console.error(`[LiveNoteGeneration] Failed to create task (attempt ${taskRetryCount}/${maxRetries}):`, taskError)

            if (taskRetryCount >= maxRetries) {
              errors.push(`Failed to create task for "${note.content.substring(0, 50)}...": ${errorMsg}`)
            } else {
              await new Promise(resolve => setTimeout(resolve, 100 * Math.pow(2, taskRetryCount)))
            }
          }
        }
      }
    }

    // Emit completion
    this.emitSaveProgress({
      meetingId,
      total: totalItems,
      saved: notesCreated + tasksCreated,
      currentType: 'notes',
      completed: true,
      errors: errors.length > 0 ? errors : undefined,
    })

    return { notesCreated, tasksCreated, errors }
  }

  /**
   * Format a topic note for storage in structured markdown format
   * This ensures parseTopicFromNote() can correctly parse it later
   *
   * NOTE: Live notes don't currently associate key points or decisions with specific topics.
   * Those are extracted separately. This creates a minimal topic structure that can be
   * enriched later with the full post-recording extraction.
   */
  private formatTopicForStorage(note: LiveNoteItem): string {
    // Use the topic content as both the name and description
    const topicName = note.content

    let content = `## ${topicName}\n\n${topicName}`

    // Add speaker if available
    if (note.speaker) {
      content += `\n\n👥 Speakers: ${note.speaker}`
    }

    return content
  }

  /**
   * Map live note type to database note type
   */
  private mapLiveNoteTypeToDbNoteType(liveType: LiveNoteType): NoteType {
    switch (liveType) {
      case 'key_point':
        return 'key_point'
      case 'action_item':
        return 'action_item'
      case 'decision':
        return 'decision'
      case 'topic':
        return 'custom' // Topics get stored as custom notes with structured markdown format
      default:
        return 'custom'
    }
  }

  /**
   * Map note priority to task priority
   */
  private mapNotePriorityToTaskPriority(priority?: 'high' | 'medium' | 'low'): TaskPriority {
    switch (priority) {
      case 'high':
        return 'high'
      case 'medium':
        return 'medium'
      case 'low':
        return 'low'
      default:
        return 'medium'
    }
  }

  /**
   * Pause the session (e.g., when recording is paused)
   */
  pauseSession(): void {
    if (this.sessionState.isActive) {
      this.stopBatchTimer()
      this.emitStatusUpdate('paused')
      console.log('[LiveNoteGeneration] Session paused')
    }
  }

  /**
   * Resume the session
   */
  resumeSession(): void {
    if (this.sessionState.isActive) {
      this.startBatchTimer()
      this.emitStatusUpdate('active')
      console.log('[LiveNoteGeneration] Session resumed')
    }
  }

  // --------------------------------------------------------------------------
  // Segment Processing
  // --------------------------------------------------------------------------

  /**
   * Add transcript segments to the processing queue
   */
  addSegments(segments: TranscriptSegmentInput[]): void {
    if (!this.sessionState.isActive) {
      console.warn('[LiveNoteGeneration] Cannot add segments: session not active')
      return
    }

    // Filter out already processed segments
    const newSegments = segments.filter(
      (seg) => !this.sessionState.processedSegmentIds.has(seg.id)
    )

    if (newSegments.length === 0) {
      return
    }

    this.sessionState.pendingSegments.push(...newSegments)

    console.log(`[LiveNoteGeneration] Added ${newSegments.length} segments. Pending: ${this.sessionState.pendingSegments.length}`)

    // Emit pending count update
    this.emitBatchStateUpdate({
      pendingSegmentCount: this.sessionState.pendingSegments.length,
    })

    // Check if we should process immediately (if enough segments and enough time has passed)
    this.checkAndTriggerBatch()
  }

  /**
   * Check if we should trigger a batch processing
   */
  private checkAndTriggerBatch(): void {
    const { pendingSegments, lastBatchTime } = this.sessionState
    const { minSegmentsPerBatch, batchIntervalMs } = this.config

    // Don't process if already processing
    if (this.isProcessing) {
      console.log('[LiveNoteGeneration] Skipping batch check: already processing')
      return
    }

    // Check if we have enough segments
    if (pendingSegments.length < minSegmentsPerBatch) {
      console.log(`[LiveNoteGeneration] Waiting for more segments: have ${pendingSegments.length}, need ${minSegmentsPerBatch}`)
      return
    }

    // Check if enough time has passed since last batch
    const timeSinceLastBatch = lastBatchTime
      ? Date.now() - lastBatchTime
      : batchIntervalMs // If no previous batch, allow immediate processing

    if (timeSinceLastBatch >= batchIntervalMs) {
      console.log(`[LiveNoteGeneration] Triggering batch processing: ${pendingSegments.length} segments, ${Math.round(timeSinceLastBatch / 1000)}s since last batch`)
      this.processBatch()
    } else {
      console.log(`[LiveNoteGeneration] Waiting for batch interval: ${Math.round((batchIntervalMs - timeSinceLastBatch) / 1000)}s remaining`)
    }
  }

  /**
   * Process a batch of pending segments
   */
  private async processBatch(): Promise<void> {
    if (this.isProcessing || this.sessionState.pendingSegments.length === 0) {
      return
    }

    this.isProcessing = true
    this.emitStatusUpdate('processing')
    this.emitBatchStateUpdate({ isProcessing: true, lastBatchStartTime: Date.now() })

    const startTime = Date.now()

    try {
      // Get segments for this batch
      const batchSegments = this.sessionState.pendingSegments.slice(
        0,
        this.config.maxSegmentsPerBatch
      )

      // Generate notes from segments
      const result = await this.generateNotesFromSegments(batchSegments)

      if (result.success && result.notes.length > 0) {
        // Emit notes to frontend
        this.emitNotes(result.notes)

        // Store notes in session state for persistence when session ends
        this.sessionState.generatedNotes.push(...result.notes)

        // Update session state
        this.sessionState.totalNotesGenerated += result.notes.length
      }

      // Mark segments as processed
      for (const seg of batchSegments) {
        this.sessionState.processedSegmentIds.add(seg.id)
      }

      // Remove processed segments from pending
      this.sessionState.pendingSegments = this.sessionState.pendingSegments.slice(
        batchSegments.length
      )

      // Update batch state
      this.sessionState.lastBatchTime = Date.now()
      this.sessionState.batchesProcessed++

      this.emitBatchStateUpdate({
        isProcessing: false,
        lastBatchCompleteTime: Date.now(),
        pendingSegmentCount: this.sessionState.pendingSegments.length,
        batchesProcessed: this.sessionState.batchesProcessed,
      })

      console.log(`[LiveNoteGeneration] Batch processed in ${Date.now() - startTime}ms. Notes generated: ${result.notes.length}`)

      if (!result.success) {
        console.warn('[LiveNoteGeneration] Batch processing had issues:', result.error)
      }
    } catch (error) {
      console.error('[LiveNoteGeneration] Batch processing error:', error)
      this.emitError({
        code: 'BATCH_PROCESSING_ERROR',
        message: error instanceof Error ? error.message : 'Unknown error',
        timestamp: Date.now(),
        recoverable: true,
      })
      this.emitBatchStateUpdate({ isProcessing: false })
    } finally {
      this.isProcessing = false
      if (this.sessionState.isActive) {
        this.emitStatusUpdate('active')
      }
    }
  }

  /**
   * Generate notes from a batch of transcript segments
   */
  private async generateNotesFromSegments(
    segments: TranscriptSegmentInput[]
  ): Promise<LiveNoteGenerationResult> {
    const startTime = Date.now()

    console.log(`[LiveNoteGeneration] Starting LLM request for ${segments.length} segments`)

    // Format segments for LLM
    const formattedTranscript = this.formatSegmentsForLLM(segments)
    console.log(`[LiveNoteGeneration] Formatted transcript (${formattedTranscript.length} chars):`, formattedTranscript.substring(0, 200) + '...')

    // Build user prompt
    const userPrompt = LIVE_NOTES_USER_PROMPT_TEMPLATE.replace(
      '{TRANSCRIPT}',
      formattedTranscript
    )

    // Build messages
    const messages: ChatMessage[] = [
      { role: 'system', content: LIVE_NOTES_SYSTEM_PROMPT },
      { role: 'user', content: userPrompt },
    ]

    try {
      console.log('[LiveNoteGeneration] Calling LLM via routing service...')

      // Call LLM
      const response = await llmRoutingService.chatCompletion({
        messages,
        maxTokens: this.config.maxTokens,
        temperature: this.config.temperature,
      })

      console.log('[LiveNoteGeneration] LLM response received:', {
        success: response.success,
        hasData: !!response.data,
        error: response.error,
        model: response.data?.model,
      })

      if (!response.success || !response.data) {
        console.error('[LiveNoteGeneration] LLM request failed:', response.error)
        return {
          success: false,
          error: response.error || 'Failed to get response from LLM',
          notes: [],
          processingTimeMs: Date.now() - startTime,
          segmentsProcessed: segments.length,
        }
      }

      // Extract content from response
      const llmContent = response.data.choices[0]?.message?.content
      if (!llmContent) {
        console.error('[LiveNoteGeneration] LLM returned empty content')
        return {
          success: false,
          error: 'LLM returned empty response',
          notes: [],
          processingTimeMs: Date.now() - startTime,
          segmentsProcessed: segments.length,
        }
      }

      console.log(`[LiveNoteGeneration] LLM response content (${llmContent.length} chars):`, llmContent.substring(0, 500) + '...')

      // Parse the response
      const parsed = this.parseNotesResponse(llmContent, segments)
      console.log(`[LiveNoteGeneration] Parsed ${parsed.length} notes from LLM response`)

      return {
        success: true,
        notes: parsed,
        processingTimeMs: Date.now() - startTime,
        segmentsProcessed: segments.length,
        llmProvider: response.data.model,
      }
    } catch (error) {
      console.error('[LiveNoteGeneration] LLM request error:', error)
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
        notes: [],
        processingTimeMs: Date.now() - startTime,
        segmentsProcessed: segments.length,
      }
    }
  }

  /**
   * Format transcript segments for LLM input
   */
  private formatSegmentsForLLM(segments: TranscriptSegmentInput[]): string {
    const lines: string[] = []
    let currentSpeaker: string | null = null
    let currentContent: string[] = []

    for (const segment of segments) {
      const speaker = segment.speaker || 'UNKNOWN'

      if (speaker !== currentSpeaker) {
        // Flush previous speaker's content
        if (currentSpeaker !== null && currentContent.length > 0) {
          lines.push(`[${currentSpeaker}]: ${currentContent.join(' ')}`)
        }
        currentSpeaker = speaker
        currentContent = [segment.content]
      } else {
        currentContent.push(segment.content)
      }
    }

    // Flush final speaker's content
    if (currentSpeaker !== null && currentContent.length > 0) {
      lines.push(`[${currentSpeaker}]: ${currentContent.join(' ')}`)
    }

    return lines.join('\n\n')
  }

  /**
   * Parse LLM response into note items
   */
  private parseNotesResponse(
    content: string,
    sourceSegments: TranscriptSegmentInput[]
  ): LiveNoteItem[] {
    const notes: LiveNoteItem[] = []
    const segmentIds = sourceSegments.map((s) => s.id)

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

      // Extract key points
      if (this.config.extractKeyPoints && Array.isArray(data.keyPoints)) {
        for (const item of data.keyPoints) {
          if (item.content && (item.confidence >= 0.6 || item.confidence === undefined)) {
            notes.push({
              id: randomUUID(),
              type: 'key_point',
              content: item.content,
              speaker: item.speaker || null,
              extractedAt: Date.now(),
              sourceSegmentIds: segmentIds,
              isPreliminary: true,
              confidence: item.confidence,
            })
          }
        }
      }

      // Extract action items
      if (this.config.extractActionItems && Array.isArray(data.actionItems)) {
        for (const item of data.actionItems) {
          if (item.content && (item.confidence >= 0.6 || item.confidence === undefined)) {
            notes.push({
              id: randomUUID(),
              type: 'action_item',
              content: item.content,
              speaker: item.speaker || null,
              assignee: item.assignee || null,
              priority: ['high', 'medium', 'low'].includes(item.priority)
                ? item.priority
                : 'medium',
              extractedAt: Date.now(),
              sourceSegmentIds: segmentIds,
              isPreliminary: true,
              confidence: item.confidence,
            })
          }
        }
      }

      // Extract decisions
      if (this.config.extractDecisions && Array.isArray(data.decisions)) {
        for (const item of data.decisions) {
          if (item.content && (item.confidence >= 0.6 || item.confidence === undefined)) {
            notes.push({
              id: randomUUID(),
              type: 'decision',
              content: item.content,
              speaker: item.speaker || null,
              extractedAt: Date.now(),
              sourceSegmentIds: segmentIds,
              isPreliminary: true,
              confidence: item.confidence,
            })
          }
        }
      }

      // Extract topics
      if (this.config.extractTopics && Array.isArray(data.topics)) {
        for (const item of data.topics) {
          if (item.content && (item.confidence >= 0.6 || item.confidence === undefined)) {
            notes.push({
              id: randomUUID(),
              type: 'topic',
              content: item.content,
              extractedAt: Date.now(),
              sourceSegmentIds: segmentIds,
              isPreliminary: true,
              confidence: item.confidence,
            })
          }
        }
      }
    } catch (error) {
      console.warn('[LiveNoteGeneration] Failed to parse LLM response:', error)
    }

    return notes
  }

  // --------------------------------------------------------------------------
  // Timer Management
  // --------------------------------------------------------------------------

  private startBatchTimer(): void {
    this.stopBatchTimer()

    this.batchTimer = setInterval(() => {
      if (this.sessionState.isActive && !this.isProcessing) {
        this.checkAndTriggerBatch()
      }
    }, 5000) // Check every 5 seconds
  }

  private stopBatchTimer(): void {
    if (this.batchTimer) {
      clearInterval(this.batchTimer)
      this.batchTimer = null
    }
  }

  // --------------------------------------------------------------------------
  // IPC Event Emission
  // --------------------------------------------------------------------------

  private emitNotes(notes: LiveNoteItem[]): void {
    const windows = BrowserWindow.getAllWindows()
    for (const win of windows) {
      win.webContents.send('liveNotes:notes', notes)
    }
  }

  private emitStatusUpdate(status: string): void {
    const windows = BrowserWindow.getAllWindows()
    for (const win of windows) {
      win.webContents.send('liveNotes:status', { status, timestamp: Date.now() })
    }
  }

  private emitBatchStateUpdate(state: Record<string, unknown>): void {
    const windows = BrowserWindow.getAllWindows()
    for (const win of windows) {
      win.webContents.send('liveNotes:batchState', { ...state, timestamp: Date.now() })
    }
  }

  private emitError(error: {
    code: string
    message: string
    timestamp: number
    recoverable: boolean
  }): void {
    const windows = BrowserWindow.getAllWindows()
    for (const win of windows) {
      win.webContents.send('liveNotes:error', error)
    }
  }

  private emitNotesPersisted(data: {
    meetingId: string
    notesCount: number
    tasksCount: number
  }): void {
    const windows = BrowserWindow.getAllWindows()
    for (const win of windows) {
      win.webContents.send('liveNotes:persisted', { ...data, timestamp: Date.now() })
    }
  }

  private emitSaveProgress(data: {
    meetingId: string
    total: number
    saved: number
    currentType: 'notes' | 'tasks'
    completed?: boolean
    errors?: string[]
  }): void {
    const windows = BrowserWindow.getAllWindows()
    for (const win of windows) {
      win.webContents.send('liveNotes:saveProgress', { ...data, timestamp: Date.now() })
    }
  }

  // --------------------------------------------------------------------------
  // Utility Methods
  // --------------------------------------------------------------------------

  /**
   * Check if LLM service is available
   */
  async checkAvailability(): Promise<{
    available: boolean
    error?: string
    modelInfo?: string
  }> {
    try {
      const health = await llmRoutingService.checkHealth(true)

      if (!health.success || !health.data?.healthy) {
        return {
          available: false,
          error:
            health.error ||
            'No LLM provider is available. Please ensure at least one provider (LM Studio, Claude CLI, or Cursor CLI) is running.',
        }
      }

      return {
        available: true,
        modelInfo: health.data.loadedModel,
      }
    } catch (error) {
      return {
        available: false,
        error:
          error instanceof Error
            ? error.message
            : 'Failed to check LLM availability',
      }
    }
  }

  /**
   * Get current session state
   */
  getSessionState(): {
    isActive: boolean
    meetingId: string | null
    pendingSegments: number
    processedSegments: number
    batchesProcessed: number
    totalNotesGenerated: number
  } {
    return {
      isActive: this.sessionState.isActive,
      meetingId: this.sessionState.meetingId,
      pendingSegments: this.sessionState.pendingSegments.length,
      processedSegments: this.sessionState.processedSegmentIds.size,
      batchesProcessed: this.sessionState.batchesProcessed,
      totalNotesGenerated: this.sessionState.totalNotesGenerated,
    }
  }

  /**
   * Get all notes generated in the current session
   * Used for persistence when recording stops
   */
  getCurrentSessionNotes(): LiveNoteItem[] {
    return [...this.sessionState.generatedNotes]
  }

  /**
   * Get current configuration
   */
  getConfig(): LiveNoteGenerationConfig {
    return { ...this.config }
  }

  /**
   * Update configuration
   */
  updateConfig(config: Partial<LiveNoteGenerationConfig>): void {
    this.config = { ...this.config, ...config }
  }

  /**
   * Force process pending segments immediately
   */
  async forceBatchProcess(): Promise<LiveNoteGenerationResult | null> {
    if (this.sessionState.pendingSegments.length === 0) {
      return null
    }

    await this.processBatch()

    return {
      success: true,
      notes: [],
      processingTimeMs: 0,
      segmentsProcessed: 0,
    }
  }
}

// ============================================================================
// Singleton Export
// ============================================================================

export const liveNoteGenerationService = new LiveNoteGenerationService()

export default liveNoteGenerationService
