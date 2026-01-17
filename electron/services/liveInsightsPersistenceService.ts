/**
 * Live Insights Persistence Service
 *
 * Handles automatic persistence of live-generated insights (action items, decisions, key points, topics)
 * to the database when a recording session ends.
 */

import { getDatabaseService } from './database'
import { taskService } from './taskService'
import { meetingNoteService } from './meetingNoteService'
import type { LiveNoteItem, LiveNoteType } from './liveNoteGenerationService'
import type { CreateTaskInput, CreateMeetingNoteInput, NoteType } from '../../src/types/database'

// ============================================================================
// Types
// ============================================================================

export interface PersistenceResult {
  success: boolean
  tasksCreated: number
  notesCreated: number
  error?: Error
}

export interface LiveInsightsSummary {
  exists: boolean
  tasksCount: number
  notesCount: number
  generatedAt: string | null
  types: {
    actionItems: number
    decisions: number
    keyPoints: number
    topics: number
  }
}

// ============================================================================
// Service Implementation
// ============================================================================

class LiveInsightsPersistenceService {
  /**
   * Persist live insights to database
   */
  async persistLiveInsights(
    meetingId: string,
    liveNotes: LiveNoteItem[]
  ): Promise<PersistenceResult> {
    try {
      console.log(`[LiveInsightsPersistence] Persisting ${liveNotes.length} live insights for meeting ${meetingId}`)

      if (liveNotes.length === 0) {
        return {
          success: true,
          tasksCreated: 0,
          notesCreated: 0
        }
      }

      const timestamp = new Date().toISOString()

      // Group insights by type
      const actionItems = liveNotes.filter(note => note.type === 'action_item')
      const otherNotes = liveNotes.filter(note => note.type !== 'action_item')

      let tasksCreated = 0
      let notesCreated = 0

      // Convert action items to tasks
      if (actionItems.length > 0) {
        const taskInputs: CreateTaskInput[] = actionItems.map(item => ({
          meeting_id: meetingId,
          title: item.content,
          description: null,
          assignee: item.assignee || null,
          due_date: null,
          priority: this.mapPriorityToTaskPriority(item.priority),
          status: 'pending',
          created_during_recording: true,
          generation_timestamp: timestamp
        }))

        const tasks = taskService.createBatch(taskInputs)
        tasksCreated = tasks.length
        console.log(`[LiveInsightsPersistence] Created ${tasksCreated} tasks`)
      }

      // Convert other insights to meeting notes
      if (otherNotes.length > 0) {
        const noteInputs: CreateMeetingNoteInput[] = otherNotes.map(item => ({
          meeting_id: meetingId,
          content: item.content,
          note_type: this.mapLiveNoteTypeToNoteType(item.type),
          is_ai_generated: true,
          source_transcript_ids: item.sourceSegmentIds || [],
          created_during_recording: true,
          generation_timestamp: timestamp,
          context: null, // Could be enhanced to include surrounding context
          confidence_score: item.confidence || null,
          speaker_id: null, // Could be mapped from speaker name to speaker ID
          start_time_ms: item.extractedAt || null,
          end_time_ms: null,
          keywords: null // Could be extracted from content
        }))

        const notes = meetingNoteService.createBatch(noteInputs)
        notesCreated = notes.length
        console.log(`[LiveInsightsPersistence] Created ${notesCreated} meeting notes`)
      }

      return {
        success: true,
        tasksCreated,
        notesCreated
      }
    } catch (error) {
      console.error('[LiveInsightsPersistence] Failed to persist live insights:', error)
      return {
        success: false,
        tasksCreated: 0,
        notesCreated: 0,
        error: error as Error
      }
    }
  }

  /**
   * Check if live insights exist for a meeting
   */
  async hasLiveInsights(meetingId: string): Promise<boolean> {
    try {
      const db = getDatabaseService().getDatabase()

      // Check for tasks created during recording
      const taskStmt = db.prepare(`
        SELECT COUNT(*) as count FROM tasks
        WHERE meeting_id = ? AND created_during_recording = 1
      `)
      const taskResult = taskStmt.get(meetingId) as { count: number }

      // Check for notes created during recording
      const noteStmt = db.prepare(`
        SELECT COUNT(*) as count FROM meeting_notes
        WHERE meeting_id = ? AND created_during_recording = 1
      `)
      const noteResult = noteStmt.get(meetingId) as { count: number }

      return (taskResult.count + noteResult.count) > 0
    } catch (error) {
      console.error('[LiveInsightsPersistence] Failed to check live insights:', error)
      return false
    }
  }

  /**
   * Get summary of live insights for a meeting
   */
  async getLiveInsightsSummary(meetingId: string): Promise<LiveInsightsSummary> {
    try {
      const db = getDatabaseService().getDatabase()

      // Get tasks count
      const taskStmt = db.prepare(`
        SELECT COUNT(*) as count, MIN(generation_timestamp) as earliest
        FROM tasks
        WHERE meeting_id = ? AND created_during_recording = 1
      `)
      const taskResult = taskStmt.get(meetingId) as { count: number; earliest: string | null }

      // Get notes by type
      const noteStmt = db.prepare(`
        SELECT note_type, COUNT(*) as count, MIN(generation_timestamp) as earliest
        FROM meeting_notes
        WHERE meeting_id = ? AND created_during_recording = 1
        GROUP BY note_type
      `)
      const noteResults = noteStmt.all(meetingId) as Array<{ note_type: NoteType; count: number; earliest: string | null }>

      const types = {
        actionItems: taskResult.count,
        decisions: 0,
        keyPoints: 0,
        topics: 0
      }

      let totalNotesCount = 0
      let earliestNoteTimestamp: string | null = null

      for (const result of noteResults) {
        totalNotesCount += result.count

        if (result.note_type === 'decision') {
          types.decisions = result.count
        } else if (result.note_type === 'key_point') {
          types.keyPoints = result.count
        } else if (result.note_type === 'custom') {
          // Topics are stored as custom notes
          types.topics = result.count
        }

        if (result.earliest && (!earliestNoteTimestamp || result.earliest < earliestNoteTimestamp)) {
          earliestNoteTimestamp = result.earliest
        }
      }

      // Find the earliest timestamp
      let generatedAt = earliestNoteTimestamp
      if (taskResult.earliest && (!generatedAt || taskResult.earliest < generatedAt)) {
        generatedAt = taskResult.earliest
      }

      const exists = (taskResult.count + totalNotesCount) > 0

      return {
        exists,
        tasksCount: taskResult.count,
        notesCount: totalNotesCount,
        generatedAt,
        types
      }
    } catch (error) {
      console.error('[LiveInsightsPersistence] Failed to get live insights summary:', error)
      return {
        exists: false,
        tasksCount: 0,
        notesCount: 0,
        generatedAt: null,
        types: {
          actionItems: 0,
          decisions: 0,
          keyPoints: 0,
          topics: 0
        }
      }
    }
  }

  /**
   * Map live note priority to task priority
   */
  private mapPriorityToTaskPriority(priority?: 'high' | 'medium' | 'low'): 'low' | 'medium' | 'high' | 'urgent' {
    if (!priority) return 'medium'
    // Map directly, no 'urgent' in live notes
    return priority
  }

  /**
   * Map live note type to database note type
   */
  private mapLiveNoteTypeToNoteType(type: LiveNoteType): NoteType {
    switch (type) {
      case 'key_point':
        return 'key_point'
      case 'decision':
        return 'decision'
      case 'topic':
        return 'custom' // Topics stored as custom notes
      case 'action_item':
        return 'action_item' // Should not reach here, but handle gracefully
      default:
        return 'custom'
    }
  }
}

// ============================================================================
// Singleton Export
// ============================================================================

let instance: LiveInsightsPersistenceService | null = null

export function getLiveInsightsPersistenceService(): LiveInsightsPersistenceService {
  if (!instance) {
    instance = new LiveInsightsPersistenceService()
  }
  return instance
}

export { LiveInsightsPersistenceService }
