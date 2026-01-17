/**
 * Sort Worker
 *
 * Web Worker that offloads heavy sorting operations from the main thread.
 * Handles sorting for transcripts, notes, and tasks to prevent UI blocking
 * during large meeting data processing.
 */

// ============================================================================
// Type Definitions for Message Passing
// ============================================================================

export type SortRequestType = 'sortTranscripts' | 'sortNotes' | 'sortTasks'

export type TaskPriority = 'low' | 'medium' | 'high' | 'urgent'
export type TaskStatus = 'pending' | 'in_progress' | 'completed' | 'cancelled'

// Simplified types for worker (avoiding import issues in worker context)
export interface TranscriptItem {
  id: string
  meeting_id: string
  speaker_id: string | null
  content: string
  start_time_ms: number
  end_time_ms: number
  confidence: number
  is_final: boolean
  created_at: string
}

export interface NoteItem {
  id: string
  meeting_id: string
  content: string
  note_type: string
  is_ai_generated: boolean
  source_transcript_ids: string | null
  created_at: string
  updated_at: string
}

export interface TaskItem {
  id: string
  meeting_id: string | null
  title: string
  description: string | null
  assignee: string | null
  due_date: string | null
  priority: TaskPriority
  status: TaskStatus
  created_at: string
  updated_at: string
  completed_at: string | null
}

// Sort request message types
export interface SortTranscriptsRequest {
  type: 'sortTranscripts'
  requestId: string
  data: TranscriptItem[]
}

export interface SortNotesRequest {
  type: 'sortNotes'
  requestId: string
  data: NoteItem[]
}

export interface SortTasksRequest {
  type: 'sortTasks'
  requestId: string
  data: TaskItem[]
  sortBy?: 'status' | 'priority' | 'date'
}

export type SortRequest = SortTranscriptsRequest | SortNotesRequest | SortTasksRequest

// Sort response message types
export interface SortTranscriptsResponse {
  type: 'sortTranscripts'
  requestId: string
  data: TranscriptItem[]
  duration: number
}

export interface SortNotesResponse {
  type: 'sortNotes'
  requestId: string
  data: NoteItem[]
  duration: number
}

export interface SortTasksResponse {
  type: 'sortTasks'
  requestId: string
  data: TaskItem[]
  duration: number
}

export interface SortErrorResponse {
  type: 'error'
  requestId: string
  error: string
}

export type SortResponse = SortTranscriptsResponse | SortNotesResponse | SortTasksResponse | SortErrorResponse

// ============================================================================
// Sorting Functions
// ============================================================================

/**
 * Sort transcripts by start_time_ms (ascending order)
 * This ensures transcripts appear in chronological order
 */
function sortTranscripts(data: TranscriptItem[]): TranscriptItem[] {
  return [...data].sort((a, b) => a.start_time_ms - b.start_time_ms)
}

/**
 * Sort notes by created_at (descending order - newest first)
 */
function sortNotes(data: NoteItem[]): NoteItem[] {
  return [...data].sort((a, b) =>
    new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
  )
}

/**
 * Sort tasks with complex multi-criteria sorting:
 * 1. By status (pending first, then in_progress, completed, cancelled)
 * 2. By priority (urgent first, then high, medium, low)
 * 3. By due_date (earliest first)
 */
function sortTasks(data: TaskItem[], sortBy: 'status' | 'priority' | 'date' = 'status'): TaskItem[] {
  const statusOrder: Record<TaskStatus, number> = {
    pending: 0,
    in_progress: 1,
    completed: 2,
    cancelled: 3
  }
  const priorityOrder: Record<TaskPriority, number> = {
    urgent: 0,
    high: 1,
    medium: 2,
    low: 3
  }

  return [...data].sort((a, b) => {
    // Primary sort based on sortBy parameter
    if (sortBy === 'priority') {
      const priorityDiff = priorityOrder[a.priority] - priorityOrder[b.priority]
      if (priorityDiff !== 0) return priorityDiff

      // Secondary sort by status
      const statusDiff = statusOrder[a.status] - statusOrder[b.status]
      if (statusDiff !== 0) return statusDiff
    } else if (sortBy === 'date') {
      // Sort by due date first (items without due date go to end)
      if (a.due_date && b.due_date) {
        const dateDiff = new Date(a.due_date).getTime() - new Date(b.due_date).getTime()
        if (dateDiff !== 0) return dateDiff
      } else if (a.due_date) {
        return -1
      } else if (b.due_date) {
        return 1
      }
      // Then by created_at (newest first)
      return new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
    } else {
      // Default: sort by status first
      const statusDiff = statusOrder[a.status] - statusOrder[b.status]
      if (statusDiff !== 0) return statusDiff

      // Then by priority
      const priorityDiff = priorityOrder[a.priority] - priorityOrder[b.priority]
      if (priorityDiff !== 0) return priorityDiff
    }

    // Tertiary sort by due_date if available
    if (a.due_date && b.due_date) {
      const dateDiff = new Date(a.due_date).getTime() - new Date(b.due_date).getTime()
      if (dateDiff !== 0) return dateDiff
    }

    return 0
  })
}

// ============================================================================
// Worker Message Handler
// ============================================================================

self.onmessage = function(event: MessageEvent<SortRequest>) {
  const request = event.data
  const startTime = performance.now()

  try {
    let response: SortResponse

    switch (request.type) {
      case 'sortTranscripts': {
        const sortedData = sortTranscripts(request.data)
        const duration = performance.now() - startTime
        response = {
          type: 'sortTranscripts',
          requestId: request.requestId,
          data: sortedData,
          duration
        }
        break
      }

      case 'sortNotes': {
        const sortedData = sortNotes(request.data)
        const duration = performance.now() - startTime
        response = {
          type: 'sortNotes',
          requestId: request.requestId,
          data: sortedData,
          duration
        }
        break
      }

      case 'sortTasks': {
        const sortedData = sortTasks(request.data, request.sortBy)
        const duration = performance.now() - startTime
        response = {
          type: 'sortTasks',
          requestId: request.requestId,
          data: sortedData,
          duration
        }
        break
      }

      default: {
        const _exhaustiveCheck: never = request
        throw new Error(`Unknown sort request type: ${(_exhaustiveCheck as SortRequest).type}`)
      }
    }

    self.postMessage(response)
  } catch (error) {
    const errorResponse: SortErrorResponse = {
      type: 'error',
      requestId: request.requestId,
      error: error instanceof Error ? error.message : 'Unknown error occurred'
    }
    self.postMessage(errorResponse)
  }
}

// Signal that the worker is ready
self.postMessage({ type: 'ready' })
