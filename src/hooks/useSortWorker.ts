/**
 * useSortWorker Hook
 *
 * Custom React hook that manages the Sort Web Worker for offloading
 * heavy sorting operations from the main thread. Provides fallback
 * to main-thread sorting when Web Workers are unavailable.
 */

import { useState, useEffect, useRef, useCallback } from 'react'
import type {
  SortRequest,
  SortResponse,
  TranscriptItem,
  NoteItem,
  TaskItem,
  TaskPriority,
  TaskStatus
} from '../workers/sortWorker'

// ============================================================================
// Constants
// ============================================================================

/** Threshold for using worker-based sorting (number of items) */
export const SORT_WORKER_THRESHOLD = 200

/** Timeout for worker operations in milliseconds */
const WORKER_TIMEOUT = 30000 // 30 seconds

// ============================================================================
// Fallback Sorting Functions (for when worker is unavailable)
// ============================================================================

/**
 * Sort transcripts by start_time_ms (ascending order)
 */
export function sortTranscriptsSync(data: TranscriptItem[]): TranscriptItem[] {
  return [...data].sort((a, b) => a.start_time_ms - b.start_time_ms)
}

/**
 * Sort notes by created_at (descending order - newest first)
 */
export function sortNotesSync(data: NoteItem[]): NoteItem[] {
  return [...data].sort((a, b) =>
    new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
  )
}

/**
 * Sort tasks with complex multi-criteria sorting
 */
export function sortTasksSync(
  data: TaskItem[],
  sortBy: 'status' | 'priority' | 'date' = 'status'
): TaskItem[] {
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
    if (sortBy === 'priority') {
      const priorityDiff = priorityOrder[a.priority] - priorityOrder[b.priority]
      if (priorityDiff !== 0) return priorityDiff
      const statusDiff = statusOrder[a.status] - statusOrder[b.status]
      if (statusDiff !== 0) return statusDiff
    } else if (sortBy === 'date') {
      if (a.due_date && b.due_date) {
        const dateDiff = new Date(a.due_date).getTime() - new Date(b.due_date).getTime()
        if (dateDiff !== 0) return dateDiff
      } else if (a.due_date) {
        return -1
      } else if (b.due_date) {
        return 1
      }
      return new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
    } else {
      const statusDiff = statusOrder[a.status] - statusOrder[b.status]
      if (statusDiff !== 0) return statusDiff
      const priorityDiff = priorityOrder[a.priority] - priorityOrder[b.priority]
      if (priorityDiff !== 0) return priorityDiff
    }

    if (a.due_date && b.due_date) {
      const dateDiff = new Date(a.due_date).getTime() - new Date(b.due_date).getTime()
      if (dateDiff !== 0) return dateDiff
    }

    return 0
  })
}

// ============================================================================
// Hook Types
// ============================================================================

interface PendingRequest {
  resolve: (value: unknown) => void
  reject: (error: Error) => void
  timeoutId: ReturnType<typeof setTimeout>
}

interface UseSortWorkerReturn {
  /** Whether the worker is available and ready */
  isWorkerAvailable: boolean
  /** Whether a sort operation is currently in progress */
  isSorting: boolean
  /** Sort transcripts asynchronously (uses worker if available and data is large) */
  sortTranscripts: (data: TranscriptItem[]) => Promise<TranscriptItem[]>
  /** Sort notes asynchronously (uses worker if available and data is large) */
  sortNotes: (data: NoteItem[]) => Promise<NoteItem[]>
  /** Sort tasks asynchronously (uses worker if available and data is large) */
  sortTasks: (data: TaskItem[], sortBy?: 'status' | 'priority' | 'date') => Promise<TaskItem[]>
}

// ============================================================================
// Hook Implementation
// ============================================================================

/**
 * Custom hook for managing the Sort Web Worker
 *
 * Features:
 * - Automatically initializes worker on mount
 * - Falls back to sync sorting when worker unavailable
 * - Only uses worker for datasets exceeding threshold
 * - Handles worker errors and timeouts gracefully
 * - Tracks sorting state for loading indicators
 */
export function useSortWorker(): UseSortWorkerReturn {
  const [isWorkerAvailable, setIsWorkerAvailable] = useState(false)
  const [isSorting, setIsSorting] = useState(false)

  const workerRef = useRef<Worker | null>(null)
  const pendingRequests = useRef<Map<string, PendingRequest>>(new Map())
  const requestIdCounter = useRef(0)

  // Initialize worker on mount
  useEffect(() => {
    // Check if Web Workers are supported
    if (typeof Worker === 'undefined') {
      console.warn('Web Workers are not supported in this browser. Using main-thread sorting.')
      setIsWorkerAvailable(false)
      return
    }

    try {
      // Create worker using Vite's worker import syntax
      const worker = new Worker(
        new URL('../workers/sortWorker.ts', import.meta.url),
        { type: 'module' }
      )

      worker.onmessage = (event: MessageEvent<SortResponse | { type: 'ready' }>) => {
        const response = event.data

        // Handle worker ready message
        if (response.type === 'ready') {
          setIsWorkerAvailable(true)
          return
        }

        // Handle sort response
        const pending = pendingRequests.current.get(response.requestId)
        if (pending) {
          clearTimeout(pending.timeoutId)
          pendingRequests.current.delete(response.requestId)

          if (response.type === 'error') {
            pending.reject(new Error(response.error))
          } else {
            pending.resolve(response.data)
          }

          // Update sorting state
          if (pendingRequests.current.size === 0) {
            setIsSorting(false)
          }
        }
      }

      worker.onerror = (error) => {
        console.error('Sort worker error:', error)
        // Reject all pending requests
        pendingRequests.current.forEach((pending) => {
          clearTimeout(pending.timeoutId)
          pending.reject(new Error('Worker error occurred'))
        })
        pendingRequests.current.clear()
        setIsSorting(false)
        setIsWorkerAvailable(false)
      }

      workerRef.current = worker
    } catch (error) {
      console.error('Failed to initialize sort worker:', error)
      setIsWorkerAvailable(false)
    }

    // Cleanup on unmount
    return () => {
      if (workerRef.current) {
        // Reject any pending requests
        pendingRequests.current.forEach((pending) => {
          clearTimeout(pending.timeoutId)
          pending.reject(new Error('Worker terminated'))
        })
        pendingRequests.current.clear()

        workerRef.current.terminate()
        workerRef.current = null
      }
    }
  }, [])

  // Helper to generate unique request IDs
  const generateRequestId = useCallback((): string => {
    return `sort-${++requestIdCounter.current}-${Date.now()}`
  }, [])

  // Helper to send request to worker
  const sendWorkerRequest = useCallback(<T>(request: SortRequest): Promise<T> => {
    return new Promise((resolve, reject) => {
      if (!workerRef.current) {
        reject(new Error('Worker not available'))
        return
      }

      const timeoutId = setTimeout(() => {
        pendingRequests.current.delete(request.requestId)
        if (pendingRequests.current.size === 0) {
          setIsSorting(false)
        }
        reject(new Error('Worker request timed out'))
      }, WORKER_TIMEOUT)

      pendingRequests.current.set(request.requestId, {
        resolve: resolve as (value: unknown) => void,
        reject,
        timeoutId
      })

      setIsSorting(true)
      workerRef.current.postMessage(request)
    })
  }, [])

  // Sort transcripts
  const sortTranscripts = useCallback(async (data: TranscriptItem[]): Promise<TranscriptItem[]> => {
    // Use sync sorting for small datasets or when worker unavailable
    if (!isWorkerAvailable || data.length < SORT_WORKER_THRESHOLD) {
      return sortTranscriptsSync(data)
    }

    try {
      const requestId = generateRequestId()
      return await sendWorkerRequest<TranscriptItem[]>({
        type: 'sortTranscripts',
        requestId,
        data
      })
    } catch (error) {
      console.warn('Worker sorting failed, falling back to sync sort:', error)
      return sortTranscriptsSync(data)
    }
  }, [isWorkerAvailable, generateRequestId, sendWorkerRequest])

  // Sort notes
  const sortNotes = useCallback(async (data: NoteItem[]): Promise<NoteItem[]> => {
    // Use sync sorting for small datasets or when worker unavailable
    if (!isWorkerAvailable || data.length < SORT_WORKER_THRESHOLD) {
      return sortNotesSync(data)
    }

    try {
      const requestId = generateRequestId()
      return await sendWorkerRequest<NoteItem[]>({
        type: 'sortNotes',
        requestId,
        data
      })
    } catch (error) {
      console.warn('Worker sorting failed, falling back to sync sort:', error)
      return sortNotesSync(data)
    }
  }, [isWorkerAvailable, generateRequestId, sendWorkerRequest])

  // Sort tasks
  const sortTasks = useCallback(async (
    data: TaskItem[],
    sortBy: 'status' | 'priority' | 'date' = 'status'
  ): Promise<TaskItem[]> => {
    // Use sync sorting for small datasets or when worker unavailable
    if (!isWorkerAvailable || data.length < SORT_WORKER_THRESHOLD) {
      return sortTasksSync(data, sortBy)
    }

    try {
      const requestId = generateRequestId()
      return await sendWorkerRequest<TaskItem[]>({
        type: 'sortTasks',
        requestId,
        data,
        sortBy
      })
    } catch (error) {
      console.warn('Worker sorting failed, falling back to sync sort:', error)
      return sortTasksSync(data, sortBy)
    }
  }, [isWorkerAvailable, generateRequestId, sendWorkerRequest])

  return {
    isWorkerAvailable,
    isSorting,
    sortTranscripts,
    sortNotes,
    sortTasks
  }
}

export default useSortWorker
