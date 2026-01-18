/**
 * Unified Insights Generation Service
 *
 * Replaces fragmented generation buttons with a single unified service that:
 * 1. Generates all insights atomically (Summary, Key Points, Decisions, Action Items, Topics, Sentiment)
 * 2. Shows progress indicator for each section
 * 3. Handles partial failures gracefully
 * 4. Preserves Overall Sentiment field
 * 5. Provides transaction-based saving
 */

import { meetingSummaryService, SummaryGenerationResult } from './meetingSummaryService'
import { actionItemsService, ActionItemsExtractionResult } from './actionItemsService'
import { decisionsAndTopicsService, ExtractionProcessResult } from './decisionsAndTopicsService'
import { meetingNoteService } from './meetingNoteService'
import { taskService } from './taskService'
import type { MeetingNote, Task } from '../../src/types/database'

// ============================================================================
// Types
// ============================================================================

/**
 * Section names for unified insights generation
 */
export type InsightSection =
  | 'summary'
  | 'keyPoints'
  | 'decisions'
  | 'actionItems'
  | 'topics'
  | 'sentiment'

/**
 * Progress update for each section
 */
export interface SectionProgress {
  section: InsightSection
  status: 'pending' | 'in_progress' | 'completed' | 'failed'
  error?: string
}

/**
 * Overall progress for unified generation
 */
export interface UnifiedGenerationProgress {
  totalSections: number
  completedSections: number
  currentSection: InsightSection | null
  sections: SectionProgress[]
  overallStatus: 'pending' | 'in_progress' | 'completed' | 'partial_success' | 'failed'
}

/**
 * Configuration for unified insights generation
 */
export interface UnifiedInsightsConfig {
  /** Maximum tokens for LLM response */
  maxTokens?: number
  /** Temperature for response randomness (0.0 - 1.0) */
  temperature?: number
  /** Note generation filtering mode */
  noteGenerationMode?: 'strict' | 'balanced' | 'loose'
  /** Whether to create tasks from action items */
  createTasks?: boolean
}

/**
 * Existing insights counts for confirmation dialog
 */
export interface ExistingInsightsCounts {
  actionItems: number
  decisions: number
  keyPoints: number
  topics: number
  summaries: number
  sentiment: number
  total: number
}

/**
 * Result of a single section generation
 */
export interface SectionResult {
  section: InsightSection
  success: boolean
  error?: string
  createdNotes?: MeetingNote[]
  createdTasks?: Task[]
  processingTimeMs: number
}

/**
 * Result of unified insights generation
 */
export interface UnifiedInsightsResult {
  success: boolean
  partialSuccess: boolean
  error?: string
  sectionResults: SectionResult[]
  createdNotes: MeetingNote[]
  createdTasks: Task[]
  metadata: {
    totalProcessingTimeMs: number
    sectionsCompleted: number
    sectionsFailed: number
    noteGenerationMode: 'strict' | 'balanced' | 'loose'
  }
}

// ============================================================================
// Default Configuration
// ============================================================================

const DEFAULT_CONFIG: UnifiedInsightsConfig = {
  maxTokens: 8192,
  temperature: 0.2,
  noteGenerationMode: 'strict',
  createTasks: true
}

// ============================================================================
// Unified Insights Service Class
// ============================================================================

class UnifiedInsightsService {
  private config: UnifiedInsightsConfig
  private progressCallback: ((progress: UnifiedGenerationProgress) => void) | null = null

  constructor(config?: Partial<UnifiedInsightsConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...config }
  }

  /**
   * Set callback for progress updates
   */
  setProgressCallback(callback: ((progress: UnifiedGenerationProgress) => void) | null): void {
    this.progressCallback = callback
  }

  /**
   * Check if LLM service is available for unified insights generation
   */
  async checkAvailability(): Promise<{ available: boolean; error?: string; modelInfo?: string }> {
    // Check using any of the underlying services (they all use the same LLM routing)
    return await decisionsAndTopicsService.checkAvailability()
  }

  /**
   * Get counts of existing insights for a meeting (for confirmation dialog)
   */
  async getExistingInsightsCounts(meetingId: string): Promise<ExistingInsightsCounts> {
    const notes = meetingNoteService.getByMeetingId(meetingId)
    const tasks = taskService.getByMeetingId(meetingId)

    const aiNotes = notes.filter(n => n.is_ai_generated)
    const actionItems = aiNotes.filter(n => n.note_type === 'action_item').length
    const decisions = aiNotes.filter(n => n.note_type === 'decision').length
    const keyPoints = aiNotes.filter(n => n.note_type === 'key_point').length
    const summaries = aiNotes.filter(n => n.note_type === 'summary').length
    const topics = aiNotes.filter(n => n.note_type === 'custom').length
    const sentiment = aiNotes.filter(n =>
      n.note_type === 'summary' && n.content.includes('Meeting Sentiment Analysis')
    ).length

    return {
      actionItems,
      decisions,
      keyPoints,
      topics,
      summaries,
      sentiment,
      total: actionItems + decisions + keyPoints + topics + summaries
    }
  }

  /**
   * Delete all existing AI-generated insights for a meeting
   * Preserves overall sentiment if specified
   */
  async deleteExistingInsights(
    meetingId: string,
    options?: { preserveSentiment?: boolean }
  ): Promise<{ deleted: number; preservedSentiment: boolean }> {
    const notes = meetingNoteService.getAIGenerated(meetingId)
    let deleted = 0
    let preservedSentiment = false

    for (const note of notes) {
      // Optionally preserve sentiment analysis notes
      // Sentiment notes are identified by note_type === 'summary' AND content containing 'Meeting Sentiment Analysis'
      if (options?.preserveSentiment &&
          note.note_type === 'summary' &&
          note.content.includes('Meeting Sentiment Analysis')) {
        console.log('[UnifiedInsights] Preserving existing sentiment analysis note:', note.id)
        preservedSentiment = true
        continue
      }

      if (meetingNoteService.delete(note.id)) {
        deleted++
      }
    }

    // Also delete AI-generated tasks
    const tasks = taskService.getByMeetingId(meetingId)
    for (const task of tasks) {
      // Delete tasks that were created during recording or have AI-generated descriptions
      if (task.created_during_recording) {
        taskService.delete(task.id)
        deleted++
      }
    }

    console.log(`[UnifiedInsights] Deleted ${deleted} insights, preserved sentiment: ${preservedSentiment}`)
    return { deleted, preservedSentiment }
  }

  /**
   * Generate all insights in one unified operation
   *
   * @param meetingId - The meeting ID to generate insights for
   * @param config - Optional configuration overrides
   */
  async generateAllInsights(
    meetingId: string,
    config?: Partial<UnifiedInsightsConfig>
  ): Promise<UnifiedInsightsResult> {
    const startTime = Date.now()
    const mergedConfig = { ...this.config, ...config }
    const noteGenerationMode = mergedConfig.noteGenerationMode || 'strict'

    // Check LLM availability first
    const availability = await this.checkAvailability()
    if (!availability.available) {
      return {
        success: false,
        partialSuccess: false,
        error: availability.error,
        sectionResults: [],
        createdNotes: [],
        createdTasks: [],
        metadata: {
          totalProcessingTimeMs: Date.now() - startTime,
          sectionsCompleted: 0,
          sectionsFailed: 0,
          noteGenerationMode
        }
      }
    }

    // Initialize progress tracking
    const sections: InsightSection[] = [
      'summary',
      'keyPoints',
      'decisions',
      'actionItems',
      'topics',
      'sentiment'
    ]

    const sectionResults: SectionResult[] = []
    const allCreatedNotes: MeetingNote[] = []
    const allCreatedTasks: Task[] = []

    const progress: UnifiedGenerationProgress = {
      totalSections: sections.length,
      completedSections: 0,
      currentSection: null,
      sections: sections.map(section => ({
        section,
        status: 'pending' as const
      })),
      overallStatus: 'in_progress'
    }

    this.emitProgress(progress)

    // Process each section
    for (let i = 0; i < sections.length; i++) {
      const section = sections[i]
      const sectionStartTime = Date.now()

      // Update progress
      progress.currentSection = section
      progress.sections[i].status = 'in_progress'
      this.emitProgress(progress)

      try {
        const result = await this.generateSection(
          meetingId,
          section,
          mergedConfig
        )

        sectionResults.push({
          section,
          success: result.success,
          error: result.error,
          createdNotes: result.createdNotes,
          createdTasks: result.createdTasks,
          processingTimeMs: Date.now() - sectionStartTime
        })

        if (result.success) {
          if (result.createdNotes) {
            allCreatedNotes.push(...result.createdNotes)
          }
          if (result.createdTasks) {
            allCreatedTasks.push(...result.createdTasks)
          }
          progress.sections[i].status = 'completed'
          progress.completedSections++
        } else {
          progress.sections[i].status = 'failed'
          progress.sections[i].error = result.error
        }
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error'

        sectionResults.push({
          section,
          success: false,
          error: errorMessage,
          processingTimeMs: Date.now() - sectionStartTime
        })

        progress.sections[i].status = 'failed'
        progress.sections[i].error = errorMessage
      }

      this.emitProgress(progress)
    }

    // Determine overall status
    const sectionsCompleted = sectionResults.filter(r => r.success).length
    const sectionsFailed = sectionResults.filter(r => !r.success).length

    if (sectionsCompleted === sections.length) {
      progress.overallStatus = 'completed'
    } else if (sectionsCompleted > 0) {
      progress.overallStatus = 'partial_success'
    } else {
      progress.overallStatus = 'failed'
    }

    progress.currentSection = null
    this.emitProgress(progress)

    return {
      success: sectionsCompleted === sections.length,
      partialSuccess: sectionsCompleted > 0 && sectionsCompleted < sections.length,
      error: sectionsFailed > 0
        ? `${sectionsFailed} section(s) failed to generate`
        : undefined,
      sectionResults,
      createdNotes: allCreatedNotes,
      createdTasks: allCreatedTasks,
      metadata: {
        totalProcessingTimeMs: Date.now() - startTime,
        sectionsCompleted,
        sectionsFailed,
        noteGenerationMode
      }
    }
  }

  /**
   * Generate a single section
   */
  private async generateSection(
    meetingId: string,
    section: InsightSection,
    config: UnifiedInsightsConfig
  ): Promise<{
    success: boolean
    error?: string
    createdNotes?: MeetingNote[]
    createdTasks?: Task[]
  }> {
    switch (section) {
      case 'summary':
        return this.generateSummary(meetingId, config)

      case 'keyPoints':
      case 'decisions':
      case 'topics':
      case 'sentiment':
        // These are all handled by decisionsAndTopicsService
        // We only call it once for the first of these sections
        if (section === 'keyPoints') {
          return this.generateDecisionsAndTopics(meetingId, config)
        }
        // Skip for decisions, topics, sentiment as they're handled with keyPoints
        return { success: true }

      case 'actionItems':
        return this.generateActionItems(meetingId, config)

      default:
        return { success: false, error: `Unknown section: ${section}` }
    }
  }

  /**
   * Generate meeting summary
   */
  private async generateSummary(
    meetingId: string,
    config: UnifiedInsightsConfig
  ): Promise<{
    success: boolean
    error?: string
    createdNotes?: MeetingNote[]
  }> {
    try {
      console.log('[UnifiedInsights] Generating Meeting Summary for meeting:', meetingId)
      const result = await meetingSummaryService.generateSummary(meetingId, {
        maxTokens: config.maxTokens,
        temperature: config.temperature,
        includeActionItems: false, // We generate these separately
        includeKeyPoints: false,   // We generate these separately
        includeDecisions: false    // We generate these separately
      })

      if (!result.success) {
        console.error('[UnifiedInsights] Meeting Summary generation failed:', result.error)
        return { success: false, error: result.error }
      }

      // Only keep the overall summary, not the extracted items
      const summaryNote = result.createdNotes?.find(n => n.note_type === 'summary')

      if (summaryNote) {
        console.log('[UnifiedInsights] ✅ Meeting Summary will be emitted to UI via IPC handler response')
        console.log('[UnifiedInsights] - IPC Event: unifiedInsights:generateAll (response)')
        console.log('[UnifiedInsights] - Response Field: result.createdNotes[]')
        console.log('[UnifiedInsights] - Note will be included in unified insights result')
      }

      return {
        success: true,
        createdNotes: summaryNote ? [summaryNote] : []
      }
    } catch (error) {
      console.error('[UnifiedInsights] Meeting Summary generation error:', error)
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to generate summary'
      }
    }
  }

  /**
   * Generate decisions, key points, topics, and sentiment analysis
   */
  private async generateDecisionsAndTopics(
    meetingId: string,
    config: UnifiedInsightsConfig
  ): Promise<{
    success: boolean
    error?: string
    createdNotes?: MeetingNote[]
  }> {
    try {
      const result = await decisionsAndTopicsService.extract(meetingId, {
        maxTokens: config.maxTokens,
        temperature: config.temperature,
        noteGenerationMode: config.noteGenerationMode,
        includeSentiment: true,
        includeDuration: true
      })

      if (!result.success) {
        return { success: false, error: result.error }
      }

      return {
        success: true,
        createdNotes: result.createdNotes
      }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to generate decisions and topics'
      }
    }
  }

  /**
   * Generate action items
   */
  private async generateActionItems(
    meetingId: string,
    config: UnifiedInsightsConfig
  ): Promise<{
    success: boolean
    error?: string
    createdNotes?: MeetingNote[]
    createdTasks?: Task[]
  }> {
    try {
      const result = await actionItemsService.extractActionItems(meetingId, {
        maxTokens: config.maxTokens,
        temperature: config.temperature,
        createTasks: config.createTasks,
        createNotes: true
      })

      if (!result.success) {
        return { success: false, error: result.error }
      }

      return {
        success: true,
        createdNotes: result.createdNotes,
        createdTasks: result.createdTasks
      }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to generate action items'
      }
    }
  }

  /**
   * Emit progress update
   */
  private emitProgress(progress: UnifiedGenerationProgress): void {
    if (this.progressCallback) {
      this.progressCallback({ ...progress })
    }
  }

  /**
   * Update service configuration
   */
  updateConfig(config: Partial<UnifiedInsightsConfig>): void {
    this.config = { ...this.config, ...config }
  }

  /**
   * Get current configuration
   */
  getConfig(): UnifiedInsightsConfig {
    return { ...this.config }
  }
}

// ============================================================================
// Singleton Export
// ============================================================================

export const unifiedInsightsService = new UnifiedInsightsService()

export default unifiedInsightsService
