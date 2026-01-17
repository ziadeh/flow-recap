/**
 * useLiveNotes Hook
 *
 * Provides a React hook for managing live meeting notes generation during
 * active recordings. This hook:
 *
 * 1. Manages the live notes session lifecycle (start/stop/pause/resume)
 * 2. Listens to live transcription segments and feeds them to the backend
 * 3. Subscribes to live notes events (new notes, status, errors)
 * 4. Updates the live notes store with generated insights
 *
 * The hook integrates with:
 * - useLiveTranscript hook for transcript segments
 * - useLiveNotesStore for state management
 * - Electron IPC for backend communication
 */

import { useEffect, useCallback, useRef } from 'react'
import {
  useLiveNotesStore,
  useLiveNotesStatus,
  useLiveNotesKeyPoints,
  useLiveNotesActionItems,
  useLiveNotesDecisions,
  useLiveNotesTopics,
  useLiveNotesBatchState,
  useLiveNotesError,
  useLiveNotesConfig,
  useIsLiveNotesActive,
  useLiveNotesCount,
  useLiveNotesLLMProvider,
  useLiveNotesSaveProgress,
  type LiveNoteItem,
  type LiveNotesConfig,
  type LiveNotesError,
  type SaveProgress,
} from '@/stores/live-notes-store'
import { useLiveTranscriptStore } from '@/stores/live-transcript-store'
import { useThrottledCallback, useIdleCallback } from './useThrottledCallback'

// Throttle intervals for live notes events
const NOTES_THROTTLE_MS = 250 // Notes batches - important but can be slightly delayed
const BATCH_STATE_THROTTLE_MS = 500 // Batch state is non-critical, use idle time
const STATUS_THROTTLE_MS = 200 // Status updates are important for UI feedback

// ============================================================================
// Types
// ============================================================================

export interface UseLiveNotesConfig {
  /** Whether to auto-start live notes when a session begins */
  autoStart?: boolean
  /** Configuration for batch processing */
  batchConfig?: Partial<LiveNotesConfig>
  /** Callback when new notes are generated */
  onNotesGenerated?: (notes: LiveNoteItem[]) => void
  /** Callback when an error occurs */
  onError?: (error: LiveNotesError) => void
}

export interface UseLiveNotesReturn {
  // State
  status: ReturnType<typeof useLiveNotesStatus>
  isActive: boolean
  keyPoints: ReturnType<typeof useLiveNotesKeyPoints>
  actionItems: ReturnType<typeof useLiveNotesActionItems>
  decisions: ReturnType<typeof useLiveNotesDecisions>
  topics: ReturnType<typeof useLiveNotesTopics>
  batchState: ReturnType<typeof useLiveNotesBatchState>
  error: ReturnType<typeof useLiveNotesError>
  config: ReturnType<typeof useLiveNotesConfig>
  notesCount: number
  llmProvider: string | null
  saveProgress: SaveProgress | null

  // Actions
  startSession: (meetingId: string) => Promise<boolean>
  stopSession: () => Promise<void>
  pauseSession: () => void
  resumeSession: () => void
  checkAvailability: () => Promise<{ available: boolean; error?: string }>
  clearNotes: () => void
  removeNote: (id: string) => void
  updateConfig: (config: Partial<LiveNotesConfig>) => void
  forceBatchProcess: () => Promise<void>
}

// ============================================================================
// Hook Implementation
// ============================================================================

export function useLiveNotes(config: UseLiveNotesConfig = {}): UseLiveNotesReturn {
  const { batchConfig, onNotesGenerated, onError } = config

  // Store selectors
  const status = useLiveNotesStatus()
  const isActive = useIsLiveNotesActive()
  const keyPoints = useLiveNotesKeyPoints()
  const actionItems = useLiveNotesActionItems()
  const decisions = useLiveNotesDecisions()
  const topics = useLiveNotesTopics()
  const batchState = useLiveNotesBatchState()
  const error = useLiveNotesError()
  const storeConfig = useLiveNotesConfig()
  const notesCount = useLiveNotesCount()
  const llmProvider = useLiveNotesLLMProvider()
  const saveProgress = useLiveNotesSaveProgress()

  // Store actions
  const store = useLiveNotesStore()

  // Live transcript store for getting segments
  const liveTranscriptSegments = useLiveTranscriptStore((state) => state.segments)
  const liveTranscriptStatus = useLiveTranscriptStore((state) => state.status)

  // Refs for tracking
  const lastProcessedSegmentIndex = useRef<number>(0)
  const isSessionActive = useRef<boolean>(false)

  // Check LLM availability
  const checkAvailability = useCallback(async () => {
    try {
      const result = await window.electronAPI.liveNotes.checkAvailability()
      return result
    } catch (err) {
      console.error('[useLiveNotes] Check availability error:', err)
      return {
        available: false,
        error: err instanceof Error ? err.message : 'Unknown error',
      }
    }
  }, [])

  // Start a live notes session
  const startSession = useCallback(
    async (meetingId: string): Promise<boolean> => {
      try {
        // Check availability first
        const availability = await checkAvailability()
        if (!availability.available) {
          store.setError({
            code: 'LLM_UNAVAILABLE',
            message: availability.error || 'LLM provider is not available',
            timestamp: Date.now(),
            recoverable: true,
          })
          return false
        }

        // Start session in store
        store.startSession(meetingId, batchConfig)

        // Start session in backend
        const result = await window.electronAPI.liveNotes.startSession(
          meetingId,
          batchConfig
        )

        if (result.success) {
          store.setStatus('active')
          store.setLLMProvider(result.llmProvider || null)
          isSessionActive.current = true
          lastProcessedSegmentIndex.current = 0
          console.log('[useLiveNotes] Session started for meeting:', meetingId)
          return true
        } else {
          store.setError({
            code: 'START_SESSION_FAILED',
            message: result.error || 'Failed to start live notes session',
            timestamp: Date.now(),
            recoverable: true,
          })
          store.setStatus('error')
          return false
        }
      } catch (err) {
        console.error('[useLiveNotes] Start session error:', err)
        store.setError({
          code: 'START_SESSION_ERROR',
          message: err instanceof Error ? err.message : 'Unknown error',
          timestamp: Date.now(),
          recoverable: true,
        })
        store.setStatus('error')
        return false
      }
    },
    [checkAvailability, store, batchConfig]
  )

  // Stop the live notes session
  const stopSession = useCallback(async () => {
    try {
      isSessionActive.current = false

      const result = await window.electronAPI.liveNotes.stopSession()
      console.log(
        '[useLiveNotes] Session stopped. Total notes:',
        result.totalNotes,
        'Batches:',
        result.batchesProcessed
      )

      store.stopSession()
    } catch (err) {
      console.error('[useLiveNotes] Stop session error:', err)
    }
  }, [store])

  // Pause the session
  const pauseSession = useCallback(() => {
    store.pauseSession()
    window.electronAPI.liveNotes.pauseSession().catch((err) => {
      console.error('[useLiveNotes] Pause session error:', err)
    })
  }, [store])

  // Resume the session
  const resumeSession = useCallback(() => {
    store.resumeSession()
    window.electronAPI.liveNotes.resumeSession().catch((err) => {
      console.error('[useLiveNotes] Resume session error:', err)
    })
  }, [store])

  // Clear all notes
  const clearNotes = useCallback(() => {
    store.clearNotes()
  }, [store])

  // Remove a specific note
  const removeNote = useCallback(
    (id: string) => {
      store.removeNote(id)
    },
    [store]
  )

  // Update configuration
  const updateConfig = useCallback(
    (newConfig: Partial<LiveNotesConfig>) => {
      store.updateConfig(newConfig)
      window.electronAPI.liveNotes.updateConfig(newConfig).catch((err) => {
        console.error('[useLiveNotes] Update config error:', err)
      })
    },
    [store]
  )

  // Force batch process
  const forceBatchProcess = useCallback(async () => {
    try {
      await window.electronAPI.liveNotes.forceBatchProcess()
    } catch (err) {
      console.error('[useLiveNotes] Force batch process error:', err)
    }
  }, [])

  // Throttled notes handler - batch multiple rapid note events
  const throttledAddNotes = useThrottledCallback(
    (notes: LiveNoteItem[]) => {
      console.log('[useLiveNotes] Received notes:', notes.length)
      store.addNotes(notes)
      onNotesGenerated?.(notes)
    },
    NOTES_THROTTLE_MS,
    { leading: true, trailing: true }
  )

  // Throttled status update handler
  const throttledSetStatus = useThrottledCallback(
    (newStatus: string) => {
      if (newStatus === 'idle' || newStatus === 'active' || newStatus === 'paused' ||
          newStatus === 'starting' || newStatus === 'processing' || newStatus === 'error') {
        store.setStatus(newStatus)
      }
    },
    STATUS_THROTTLE_MS,
    { leading: true, trailing: true }
  )

  // Use idle callback for non-critical batch state updates
  const scheduleBatchStateUpdate = useIdleCallback(
    (state: {
      isProcessing: boolean
      lastBatchStartTime: number | null
      lastBatchCompleteTime: number | null
      pendingSegmentCount: number
      batchesProcessed: number
    }) => {
      store.updateBatchState(state)
    },
    BATCH_STATE_THROTTLE_MS
  )

  // Subscribe to IPC events for notes, status, batch state, and errors
  // Performance optimized with throttling for high-frequency events
  useEffect(() => {
    // Subscribe to new notes - throttled
    const unsubscribeNotes = window.electronAPI.liveNotes.onNotes((notes) => {
      throttledAddNotes(notes)
    })

    // Subscribe to status updates - throttled
    const unsubscribeStatus = window.electronAPI.liveNotes.onStatus(
      ({ status: newStatus }) => {
        throttledSetStatus(newStatus)
      }
    )

    // Subscribe to batch state updates - use idle callback
    const unsubscribeBatchState = window.electronAPI.liveNotes.onBatchState(
      (state) => {
        scheduleBatchStateUpdate({
          isProcessing: state.isProcessing as boolean,
          lastBatchStartTime: state.lastBatchStartTime as number | null,
          lastBatchCompleteTime: state.lastBatchCompleteTime as number | null,
          pendingSegmentCount: state.pendingSegmentCount as number,
          batchesProcessed: state.batchesProcessed as number,
        })
      }
    )

    // Subscribe to error events - not throttled as errors are important
    const unsubscribeError = window.electronAPI.liveNotes.onError((err) => {
      console.warn('[useLiveNotes] Error received:', err)
      store.setError(err)
      onError?.(err)
    })

    // Subscribe to save progress events - not throttled as save progress is important UI feedback
    const unsubscribeSaveProgress = window.electronAPI.liveNotes.onSaveProgress?.((progress) => {
      console.log('[useLiveNotes] Save progress:', progress)
      if (progress.completed) {
        // Save is complete - set status back to idle and clear progress
        store.setSaveProgress(null)
        store.setStatus('idle')
        if (progress.errors && progress.errors.length > 0) {
          store.setError({
            code: 'SAVE_PARTIAL_FAILURE',
            message: `Some items failed to save: ${progress.errors[0]}`,
            timestamp: Date.now(),
            recoverable: false,
          })
        }
      } else {
        // Save in progress - update status and progress
        store.setStatus('saving')
        store.setSaveProgress({
          total: progress.total,
          saved: progress.saved,
          currentType: progress.currentType,
        })
      }
    })

    return () => {
      unsubscribeNotes()
      unsubscribeStatus()
      unsubscribeBatchState()
      unsubscribeError()
      unsubscribeSaveProgress?.()
    }
  }, [store, throttledAddNotes, throttledSetStatus, scheduleBatchStateUpdate, onError])

  // Feed transcript segments to the backend when new ones arrive
  useEffect(() => {
    if (!isSessionActive.current || status === 'paused' || status === 'idle') {
      return
    }

    // Check for new segments since last processed
    if (liveTranscriptSegments.length > lastProcessedSegmentIndex.current) {
      const newSegments = liveTranscriptSegments.slice(
        lastProcessedSegmentIndex.current
      )

      // Only send final segments
      const finalSegments = newSegments.filter((seg) => seg.is_final)

      if (finalSegments.length > 0) {
        // Convert to the format expected by the backend
        const segmentsForBackend = finalSegments.map((seg) => ({
          id: seg.id,
          content: seg.content,
          speaker: seg.speaker_id || seg.speaker || null,
          start_time_ms: seg.start_time_ms,
          end_time_ms: seg.end_time_ms,
        }))

        // Send to backend
        window.electronAPI.liveNotes.addSegments(segmentsForBackend).catch((err) => {
          console.error('[useLiveNotes] Add segments error:', err)
        })

        // Mark segments as processed in store
        store.markSegmentsProcessed(finalSegments.map((s) => s.id))
      }

      // Update the index to track progress
      lastProcessedSegmentIndex.current = liveTranscriptSegments.length
    }
  }, [liveTranscriptSegments, status, store])

  // Reset segment tracking when transcription status changes
  useEffect(() => {
    if (liveTranscriptStatus === 'idle' || liveTranscriptStatus === 'starting') {
      lastProcessedSegmentIndex.current = 0
    }
  }, [liveTranscriptStatus])

  return {
    // State
    status,
    isActive,
    keyPoints,
    actionItems,
    decisions,
    topics,
    batchState,
    error,
    config: storeConfig,
    notesCount,
    llmProvider,
    saveProgress,

    // Actions
    startSession,
    stopSession,
    pauseSession,
    resumeSession,
    checkAvailability,
    clearNotes,
    removeNote,
    updateConfig,
    forceBatchProcess,
  }
}

export default useLiveNotes
