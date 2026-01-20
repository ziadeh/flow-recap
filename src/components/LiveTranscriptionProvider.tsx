/**
 * LiveTranscriptionProvider Component
 *
 * A provider component that manages live transcription AND live notes globally.
 * This ensures that both live transcription and live AI notes are properly initialized
 * and run whenever recording is active, regardless of which page the user is on.
 *
 * Previously, live notes were managed by RealtimeInsightsPanel which only runs when
 * the user is on the MeetingDetail page. This caused notes generation to stop when
 * navigating away. Now, both features are managed at the app root level.
 */

import { useEffect, useRef, useCallback, useState } from 'react'
import { useRecordingStore } from '@/stores/recording-store'
import { useLiveTranscriptStatus, useLiveTranscriptSegments, useLiveTranscriptActions, LiveTranscriptSegment } from '@/stores/live-transcript-store'
import { useLiveNotesStore } from '@/stores/live-notes-store'

// Progress type (mirrors LiveTranscriptionProgress from electron services)
interface TranscriptionProgressEvent {
  status: string
  progress: number
  message: string
  timestamp?: number
}

// Segment type from backend
interface BackendSegment {
  id: string
  text: string
  start: number
  end: number
  confidence?: number
  is_final: boolean
  speaker?: string
  speaker_id?: string | null  // Database speaker ID
}

interface LiveTranscriptionProviderProps {
  children: React.ReactNode
}

/**
 * Provider that initializes and manages live transcription globally.
 * Place this at the app root level to ensure live transcription works
 * regardless of which page the user is on when recording starts.
 */
export function LiveTranscriptionProvider({ children }: LiveTranscriptionProviderProps) {
  // Track if provider initialization failed
  const [initializationError, setInitializationError] = useState<string | null>(null)

  // Recording state
  const recordingStatus = useRecordingStore((state) => state.status)
  const recordingMeetingId = useRecordingStore((state) => state.meetingId)
  const audioFilePath = useRecordingStore((state) => state.audioFilePath)

  // Live transcript store actions - use composite hook for performance
  const liveStatus = useLiveTranscriptStatus()
  const liveSegments = useLiveTranscriptSegments()
  const {
    startSession,
    stopSession,
    pauseSession,
    resumeSession,
    addSegment,
    setError,
    setStatus,
    setProgress,
    saveToDatabase,
    reset,
  } = useLiveTranscriptActions()

  // Live notes store actions
  const liveNotesStore = useLiveNotesStore()

  // Track subscriptions and state in refs
  const unsubscribeProgressRef = useRef<(() => void) | null>(null)
  const unsubscribeSegmentRef = useRef<(() => void) | null>(null)
  const isStartedRef = useRef<boolean>(false)

  // Live notes specific refs
  const liveNotesSessionStartedRef = useRef<boolean>(false)
  const lastProcessedSegmentIndexRef = useRef<number>(0)
  const unsubscribeLiveNotesRef = useRef<(() => void) | null>(null)
  const unsubscribeLiveNotesStatusRef = useRef<(() => void) | null>(null)
  const unsubscribeLiveNotesBatchStateRef = useRef<(() => void) | null>(null)
  const unsubscribeLiveNotesErrorRef = useRef<(() => void) | null>(null)

  /**
   * Handle incoming progress updates
   */
  const handleProgressUpdate = useCallback(
    (progressData: TranscriptionProgressEvent) => {
      console.log('[LiveTranscriptionProvider] Progress update:', progressData)

      setProgress({
        phase: progressData.status,
        progress: progressData.progress,
        message: progressData.message,
      })

      // Update status based on backend status
      if (progressData.status === 'active' && liveStatus !== 'active') {
        setStatus('active')
      } else if (progressData.status === 'error') {
        setStatus('error')
        setError({
          code: 'TRANSCRIPTION_ERROR',
          message: progressData.message,
          timestamp: Date.now(),
          recoverable: true,
        })
      }
    },
    [setProgress, setStatus, setError, liveStatus]
  )

  /**
   * Handle incoming segment from backend
   */
  const handleSegment = useCallback(
    (segment: BackendSegment) => {
      console.log('[LiveTranscriptionProvider] Received segment:', segment.text?.substring(0, 50))

      // Convert to LiveTranscriptSegment format
      const liveSegment: LiveTranscriptSegment = {
        id: segment.id,
        content: segment.text,
        start_time_ms: Math.round(segment.start * 1000),
        end_time_ms: Math.round(segment.end * 1000),
        confidence: segment.confidence || 0.8,
        is_final: segment.is_final,
        speaker_id: segment.speaker_id || null,  // Use the database speaker ID from backend
        speaker: segment.speaker || null, // Also store the raw speaker label for display
      }

      addSegment(liveSegment)
    },
    [addSegment]
  )

  /**
   * Subscribe to backend events
   */
  const subscribeToEvents = useCallback(() => {
    const api = window.electronAPI as any

    if (!api?.liveTranscription) {
      console.warn('[LiveTranscriptionProvider] Live transcription API not available')
      return
    }

    // Subscribe to progress events
    if (api.liveTranscription.onProgress) {
      if (unsubscribeProgressRef.current) {
        unsubscribeProgressRef.current()
      }
      unsubscribeProgressRef.current = api.liveTranscription.onProgress(handleProgressUpdate)
    }

    // Subscribe to segment events
    if (api.liveTranscription.onSegment) {
      if (unsubscribeSegmentRef.current) {
        unsubscribeSegmentRef.current()
      }
      unsubscribeSegmentRef.current = api.liveTranscription.onSegment(handleSegment)
    }

    console.log('[LiveTranscriptionProvider] Subscribed to backend events')
  }, [handleProgressUpdate, handleSegment])

  /**
   * Unsubscribe from backend events
   */
  const unsubscribeFromEvents = useCallback(() => {
    if (unsubscribeProgressRef.current) {
      unsubscribeProgressRef.current()
      unsubscribeProgressRef.current = null
    }
    if (unsubscribeSegmentRef.current) {
      unsubscribeSegmentRef.current()
      unsubscribeSegmentRef.current = null
    }
  }, [])

  /**
   * Start live transcription for a meeting
   */
  const start = useCallback(
    async (meetingId: string) => {
      if (isStartedRef.current) {
        console.log('[LiveTranscriptionProvider] Already started')
        return
      }

      console.log('[LiveTranscriptionProvider] Starting for meeting:', meetingId)

      const api = window.electronAPI as any

      // Check backend status first - if it's stuck in a non-idle state, force reset it
      if (api?.liveTranscription?.getStatus) {
        try {
          const status = await api.liveTranscription.getStatus()
          if (status.status !== 'idle') {
            console.log('[LiveTranscriptionProvider] Backend in non-idle state:', status.status, '- forcing reset')
            if (api.liveTranscription.forceReset) {
              await api.liveTranscription.forceReset()
            }
          }
        } catch (err) {
          console.error('[LiveTranscriptionProvider] Error checking backend status:', err)
        }
      }

      isStartedRef.current = true

      // Initialize session in store
      startSession(meetingId)

      // Subscribe to backend events
      subscribeToEvents()

      // Start backend transcription session
      // Note: We don't hardcode the sampleRate here anymore - the liveTranscriptionService
      // will detect the actual sample rate from the first audio chunk it receives.
      // This ensures the transcription uses the correct rate even when recording
      // from devices that operate at different sample rates (e.g., 48kHz for BlackHole)
      if (api?.liveTranscription?.startSession) {
        try {
          // Load diarization settings from database
          // IMPORTANT: Diarization is enabled by default to ensure speaker detection works out-of-box
          let enableDiarization = true
          // Lower threshold = more speakers detected (more sensitive to voice differences)
          // Default 0.30 provides better multi-speaker separation
          // (typical same-speaker similarity: 0.8-0.95, different speakers: 0.2-0.5)
          // FIXED: Lowered from 0.5 to 0.30 to prevent merging of distinct speakers
          let diarizationThreshold = 0.30
          let maxSpeakers = 10

          try {
            const diarizationEnabled = await api.db?.settings?.get('transcription.diarization.enabled')
            const threshold = await api.db?.settings?.get('transcription.diarization.threshold')
            const speakers = await api.db?.settings?.get('transcription.diarization.maxSpeakers')

            if (diarizationEnabled !== null) enableDiarization = diarizationEnabled
            if (threshold !== null) diarizationThreshold = threshold
            if (speakers !== null) maxSpeakers = speakers
          } catch (err) {
            console.log('[LiveTranscriptionProvider] Could not load diarization settings, using defaults')
          }

          console.log('[LiveTranscriptionProvider] Starting with diarization:', enableDiarization)

          const result = await api.liveTranscription.startSession(
            meetingId,
            audioFilePath || '',
            {
              language: 'en',
              modelSize: 'base',
              // sampleRate is intentionally omitted - will be auto-detected from audio stream
              enableDiarization,
              diarizationThreshold,
              maxSpeakers,
            }
          )

          if (!result.success) {
            console.error('[LiveTranscriptionProvider] Failed to start backend session:', result.error)
            // Reset isStartedRef since we failed to start
            isStartedRef.current = false
            setError({
              code: 'START_ERROR',
              message: result.error || 'Failed to start transcription',
              timestamp: Date.now(),
              recoverable: true,
            })
          } else {
            console.log('[LiveTranscriptionProvider] Backend session started successfully')
            setStatus('active')
          }
        } catch (err) {
          console.error('[LiveTranscriptionProvider] Error starting session:', err)
          // Reset isStartedRef since we failed to start
          isStartedRef.current = false
          setError({
            code: 'START_ERROR',
            message: err instanceof Error ? err.message : 'Failed to start transcription',
            timestamp: Date.now(),
            recoverable: true,
          })
        }
      } else {
        // API not available, just show the UI anyway
        console.log('[LiveTranscriptionProvider] Backend API not available, showing UI only')
        setStatus('active')
      }
    },
    [audioFilePath, startSession, subscribeToEvents, setStatus, setError]
  )

  /**
   * Stop live transcription
   */
  const stop = useCallback(async () => {
    console.log('[LiveTranscriptionProvider] Stopping')

    isStartedRef.current = false

    // Save transcripts to database BEFORE stopping
    try {
      const saveResult = await saveToDatabase()
      if (saveResult.success) {
        console.log(`[LiveTranscriptionProvider] Saved ${saveResult.count} transcript segments to database`)
      } else if (saveResult.error) {
        console.error('[LiveTranscriptionProvider] Failed to save transcripts:', saveResult.error)
        // Show error but continue with cleanup
        setError({
          code: 'SAVE_ERROR',
          message: `Failed to save transcripts: ${saveResult.error}`,
          timestamp: Date.now(),
          recoverable: true,
        })
      }
    } catch (err) {
      console.error('[LiveTranscriptionProvider] Error saving transcripts:', err)
    }

    // Stop backend session
    const api = window.electronAPI as any
    if (api?.liveTranscription?.stopSession) {
      try {
        await api.liveTranscription.stopSession()
      } catch (err) {
        console.error('[LiveTranscriptionProvider] Error stopping session:', err)
      }
    }

    // Unsubscribe from events
    unsubscribeFromEvents()

    // Update store and reset state
    stopSession()
    reset()
  }, [stopSession, unsubscribeFromEvents, saveToDatabase, setError, reset])

  /**
   * Pause live transcription
   */
  const pause = useCallback(() => {
    console.log('[LiveTranscriptionProvider] Pausing')

    const api = window.electronAPI as any
    if (api?.liveTranscription?.pause) {
      api.liveTranscription.pause()
    }

    pauseSession()
  }, [pauseSession])

  /**
   * Resume live transcription
   */
  const resume = useCallback(() => {
    console.log('[LiveTranscriptionProvider] Resuming')

    const api = window.electronAPI as any
    if (api?.liveTranscription?.resume) {
      api.liveTranscription.resume()
    }

    resumeSession()
  }, [resumeSession])

  // ==========================================================================
  // LIVE NOTES MANAGEMENT
  // Manages AI-powered note generation during recording, regardless of page
  // ==========================================================================

  /**
   * Subscribe to live notes IPC events
   */
  const subscribeToLiveNotesEvents = useCallback(() => {
    const api = window.electronAPI as any

    if (!api?.liveNotes) {
      console.warn('[LiveTranscriptionProvider] Live notes API not available')
      return
    }

    // Subscribe to new notes
    if (api.liveNotes.onNotes) {
      if (unsubscribeLiveNotesRef.current) {
        unsubscribeLiveNotesRef.current()
      }
      unsubscribeLiveNotesRef.current = api.liveNotes.onNotes((notes: any[]) => {
        console.log('[LiveTranscriptionProvider] Live notes received:', notes.length)
        liveNotesStore.addNotes(notes)
      })
    }

    // Subscribe to status updates
    if (api.liveNotes.onStatus) {
      if (unsubscribeLiveNotesStatusRef.current) {
        unsubscribeLiveNotesStatusRef.current()
      }
      unsubscribeLiveNotesStatusRef.current = api.liveNotes.onStatus(({ status }: { status: string }) => {
        if (status === 'idle' || status === 'active' || status === 'paused' ||
            status === 'starting' || status === 'processing' || status === 'error') {
          liveNotesStore.setStatus(status)
        }
      })
    }

    // Subscribe to batch state updates
    if (api.liveNotes.onBatchState) {
      if (unsubscribeLiveNotesBatchStateRef.current) {
        unsubscribeLiveNotesBatchStateRef.current()
      }
      unsubscribeLiveNotesBatchStateRef.current = api.liveNotes.onBatchState((state: any) => {
        liveNotesStore.updateBatchState({
          isProcessing: state.isProcessing as boolean,
          lastBatchStartTime: state.lastBatchStartTime as number | null,
          lastBatchCompleteTime: state.lastBatchCompleteTime as number | null,
          pendingSegmentCount: state.pendingSegmentCount as number,
          batchesProcessed: state.batchesProcessed as number,
        })
      })
    }

    // Subscribe to error events
    if (api.liveNotes.onError) {
      if (unsubscribeLiveNotesErrorRef.current) {
        unsubscribeLiveNotesErrorRef.current()
      }
      unsubscribeLiveNotesErrorRef.current = api.liveNotes.onError((error: any) => {
        console.warn('[LiveTranscriptionProvider] Live notes error:', error)
        liveNotesStore.setError(error)
      })
    }

    console.log('[LiveTranscriptionProvider] Subscribed to live notes events')
  }, [liveNotesStore])

  /**
   * Unsubscribe from live notes events
   */
  const unsubscribeFromLiveNotesEvents = useCallback(() => {
    if (unsubscribeLiveNotesRef.current) {
      unsubscribeLiveNotesRef.current()
      unsubscribeLiveNotesRef.current = null
    }
    if (unsubscribeLiveNotesStatusRef.current) {
      unsubscribeLiveNotesStatusRef.current()
      unsubscribeLiveNotesStatusRef.current = null
    }
    if (unsubscribeLiveNotesBatchStateRef.current) {
      unsubscribeLiveNotesBatchStateRef.current()
      unsubscribeLiveNotesBatchStateRef.current = null
    }
    if (unsubscribeLiveNotesErrorRef.current) {
      unsubscribeLiveNotesErrorRef.current()
      unsubscribeLiveNotesErrorRef.current = null
    }
  }, [])

  /**
   * Start live notes session
   */
  const startLiveNotesSession = useCallback(async (meetingId: string) => {
    if (liveNotesSessionStartedRef.current) {
      console.log('[LiveTranscriptionProvider] Live notes session already started')
      return
    }

    const api = window.electronAPI as any
    if (!api?.liveNotes) {
      console.warn('[LiveTranscriptionProvider] Live notes API not available')
      return
    }

    try {
      // Check if auto-start is enabled in user preferences
      const autoStartEnabled = await api.db?.settings?.get('ai.autoStartLiveNotes')
      if (!autoStartEnabled) {
        console.log('[LiveTranscriptionProvider] Live notes auto-start disabled by user preference')
        return
      }

      // Check LLM availability
      const availability = await api.liveNotes.checkAvailability()
      if (!availability.available) {
        console.warn('[LiveTranscriptionProvider] LLM not available for live notes:', availability.error)
        return
      }

      console.log('[LiveTranscriptionProvider] Starting live notes session for meeting:', meetingId)

      // Subscribe to events first
      subscribeToLiveNotesEvents()

      // Initialize store
      liveNotesStore.startSession(meetingId)

      // Start backend session
      const result = await api.liveNotes.startSession(meetingId)

      if (result.success) {
        liveNotesSessionStartedRef.current = true
        lastProcessedSegmentIndexRef.current = 0
        liveNotesStore.setStatus('active')
        liveNotesStore.setLLMProvider(result.llmProvider || null)
        console.log('[LiveTranscriptionProvider] Live notes session started successfully')
      } else {
        console.error('[LiveTranscriptionProvider] Failed to start live notes session:', result.error)
        liveNotesStore.setError({
          code: 'START_SESSION_FAILED',
          message: result.error || 'Failed to start live notes session',
          timestamp: Date.now(),
          recoverable: true,
        })
        liveNotesStore.setStatus('error')
      }
    } catch (err) {
      console.error('[LiveTranscriptionProvider] Error starting live notes session:', err)
    }
  }, [liveNotesStore, subscribeToLiveNotesEvents])

  /**
   * Stop live notes session
   */
  const stopLiveNotesSession = useCallback(async () => {
    if (!liveNotesSessionStartedRef.current) {
      return
    }

    console.log('[LiveTranscriptionProvider] Stopping live notes session')

    const api = window.electronAPI as any
    if (api?.liveNotes?.stopSession) {
      try {
        const result = await api.liveNotes.stopSession()
        console.log('[LiveTranscriptionProvider] Live notes session stopped:', result)
      } catch (err) {
        console.error('[LiveTranscriptionProvider] Error stopping live notes session:', err)
      }
    }

    liveNotesSessionStartedRef.current = false
    lastProcessedSegmentIndexRef.current = 0

    // Unsubscribe from events
    unsubscribeFromLiveNotesEvents()

    // Update store
    liveNotesStore.stopSession()
  }, [liveNotesStore, unsubscribeFromLiveNotesEvents])

  // Auto-start/stop live notes based on recording state
  useEffect(() => {
    // Start live notes when recording starts
    if (recordingStatus === 'recording' && recordingMeetingId && !liveNotesSessionStartedRef.current) {
      // Small delay to let transcription start first
      const timer = setTimeout(() => {
        startLiveNotesSession(recordingMeetingId)
      }, 2000)
      return () => clearTimeout(timer)
    }

    // Stop live notes when recording stops
    if ((recordingStatus === 'idle' || recordingStatus === 'stopping') && liveNotesSessionStartedRef.current) {
      stopLiveNotesSession()
    }

    // Pause/resume with recording
    const api = window.electronAPI as any
    if (recordingStatus === 'paused' && liveNotesSessionStartedRef.current) {
      api?.liveNotes?.pauseSession?.()
      liveNotesStore.pauseSession()
    } else if (recordingStatus === 'recording' && liveNotesStore.status === 'paused') {
      api?.liveNotes?.resumeSession?.()
      liveNotesStore.resumeSession()
    }
  }, [recordingStatus, recordingMeetingId, startLiveNotesSession, stopLiveNotesSession, liveNotesStore])

  // Feed transcript segments to live notes backend
  useEffect(() => {
    if (!liveNotesSessionStartedRef.current || liveNotesStore.status === 'paused' || liveNotesStore.status === 'idle') {
      return
    }

    // Check for new segments since last processed
    if (liveSegments.length > lastProcessedSegmentIndexRef.current) {
      const newSegments = liveSegments.slice(lastProcessedSegmentIndexRef.current)

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
        const api = window.electronAPI as any
        api?.liveNotes?.addSegments?.(segmentsForBackend).catch((err: any) => {
          console.error('[LiveTranscriptionProvider] Error adding segments to live notes:', err)
        })

        // Mark segments as processed in store
        liveNotesStore.markSegmentsProcessed(finalSegments.map((s) => s.id))
      }

      // Update the index to track progress
      lastProcessedSegmentIndexRef.current = liveSegments.length
    }
  }, [liveSegments, liveNotesStore])

  // Auto-start/stop based on recording state
  useEffect(() => {
    console.log('[LiveTranscriptionProvider] Recording state changed:', {
      recordingStatus,
      recordingMeetingId,
      liveStatus,
      isStarted: isStartedRef.current,
    })

    // Wrap all auto-start/stop logic in try-catch to prevent crashes
    try {
      // Start when recording begins
      if (recordingStatus === 'recording' && !isStartedRef.current && recordingMeetingId) {
        console.log('[LiveTranscriptionProvider] Auto-starting due to recording start')
        start(recordingMeetingId).catch((err) => {
          console.error('[LiveTranscriptionProvider] Failed to auto-start:', err)
          setError({
            code: 'AUTO_START_ERROR',
            message: 'Failed to start live transcription automatically',
            timestamp: Date.now(),
            recoverable: true,
          })
        })
      }
      // Pause when recording pauses
      else if (recordingStatus === 'paused' && liveStatus === 'active') {
        pause()
      }
      // Resume when recording resumes
      else if (recordingStatus === 'recording' && liveStatus === 'paused') {
        resume()
      }
      // Stop when recording stops
      else if ((recordingStatus === 'idle' || recordingStatus === 'stopping') && isStartedRef.current) {
        console.log('[LiveTranscriptionProvider] Auto-stopping due to recording stop')
        stop().catch((err) => {
          console.error('[LiveTranscriptionProvider] Failed to auto-stop:', err)
        })
      }
    } catch (err) {
      console.error('[LiveTranscriptionProvider] Error in auto-start/stop effect:', err)
      setError({
        code: 'EFFECT_ERROR',
        message: err instanceof Error ? err.message : 'Unexpected error in transcription provider',
        timestamp: Date.now(),
        recoverable: true,
      })
    }
  }, [recordingStatus, recordingMeetingId, liveStatus, start, pause, resume, stop, setError])

  // Periodic auto-save during recording for resilience against crashes
  useEffect(() => {
    if (recordingStatus !== 'recording' || !isStartedRef.current) {
      return
    }

    // Auto-save every 30 seconds during active recording
    const autoSaveInterval = setInterval(async () => {
      try {
        const result = await saveToDatabase()
        if (result.success && result.count > 0) {
          console.log(`[LiveTranscriptionProvider] Auto-saved ${result.count} transcript segments`)
        }
      } catch (err) {
        console.error('[LiveTranscriptionProvider] Auto-save error:', err)
        // Don't throw - just log the error to prevent crashes during recording
      }
    }, 30000) // 30 seconds

    return () => {
      clearInterval(autoSaveInterval)
    }
  }, [recordingStatus, saveToDatabase])

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      unsubscribeFromEvents()
      unsubscribeFromLiveNotesEvents()
      isStartedRef.current = false
      liveNotesSessionStartedRef.current = false
    }
  }, [unsubscribeFromEvents, unsubscribeFromLiveNotesEvents])

  // Check for critical initialization errors
  useEffect(() => {
    try {
      const api = window.electronAPI as any
      if (!api) {
        setInitializationError('Application API is not available. Please restart the application.')
        return
      }

      // Verify critical APIs are available
      if (!api.recording) {
        console.warn('[LiveTranscriptionProvider] Recording API not available')
      }
      if (!api.liveTranscription) {
        console.warn('[LiveTranscriptionProvider] Live transcription API not available')
      }
    } catch (err) {
      console.error('[LiveTranscriptionProvider] Initialization error:', err)
      setInitializationError('Failed to initialize transcription system')
    }
  }, [])

  // If initialization failed critically, show error UI but still render children
  // This prevents the entire app from being blocked by transcription issues
  if (initializationError) {
    console.error('[LiveTranscriptionProvider] Critical error:', initializationError)
    // Still render children - transcription will be disabled but app will work
  }

  // This is a provider component - it doesn't render anything visual,
  // just manages the live transcription state globally
  // Even if there's an initialization error, we render children so the app doesn't crash
  return <>{children}</>
}

export default LiveTranscriptionProvider
