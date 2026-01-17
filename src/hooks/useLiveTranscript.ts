/**
 * useLiveTranscript Hook
 *
 * Provides access to live transcription state during active recording sessions.
 *
 * NOTE: Auto-start/stop of transcription is handled by LiveTranscriptionProvider
 * at the app root level. This hook only provides access to state and manual controls.
 * This prevents duplicate startSession calls that cause "already in progress" errors.
 */

import { useEffect, useCallback, useRef, useMemo } from 'react'
import { useLiveTranscriptStore, LiveTranscriptSegment } from '@/stores/live-transcript-store'
import { useRecordingStore } from '@/stores/recording-store'
import { useThrottledCallback, useEventBatcher, useIdleCallback } from './useThrottledCallback'

// Throttle intervals for live transcription events
const SEGMENT_BATCH_INTERVAL_MS = 200 // Batch rapid segments for single UI update
const PROGRESS_THROTTLE_MS = 300 // Progress updates are non-critical
const DIARIZATION_STATUS_THROTTLE_MS = 500 // Diarization status is informational

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
}

// Configuration for live transcription
export interface LiveTranscriptionConfig {
  // Enable/disable live transcription
  enabled?: boolean
  // Language for transcription
  language?: string
  // Model size (smaller = faster for live)
  modelSize?: 'tiny' | 'base' | 'small'
  // Sample rate of the audio
  sampleRate?: number
}

const DEFAULT_CONFIG: Required<LiveTranscriptionConfig> = {
  enabled: true,
  language: 'en',
  modelSize: 'base',
  sampleRate: 16000,
}

/**
 * Hook for managing live transcription during recording
 */
export function useLiveTranscript(config: LiveTranscriptionConfig = {}) {
  // Memoize config to prevent dependency changes on every render
  const mergedConfig = useMemo(
    () => ({
      enabled: config.enabled ?? DEFAULT_CONFIG.enabled,
      language: config.language ?? DEFAULT_CONFIG.language,
      modelSize: config.modelSize ?? DEFAULT_CONFIG.modelSize,
      sampleRate: config.sampleRate ?? DEFAULT_CONFIG.sampleRate,
    }),
    [config.enabled, config.language, config.modelSize, config.sampleRate]
  )

  // Store state
  const {
    status,
    meetingId,
    segments,
    error,
    progress,
    isEnabled,
    diarizationStatus,
    startSession,
    stopSession,
    pauseSession,
    resumeSession,
    addSegment,
    addSegments,
    updateSegment,
    clearSegments,
    setError,
    setStatus,
    setProgress,
    setEnabled,
    setDiarizationStatus,
    reset,
  } = useLiveTranscriptStore()

  // Recording state - used for manual start with recording context
  const recordingMeetingId = useRecordingStore((state) => state.meetingId)
  const audioFilePath = useRecordingStore((state) => state.audioFilePath)

  // Track subscriptions and state in refs
  const unsubscribeProgressRef = useRef<(() => void) | null>(null)
  const unsubscribeSegmentRef = useRef<(() => void) | null>(null)
  const unsubscribeDiarizationStatusRef = useRef<(() => void) | null>(null)
  const isStartedRef = useRef<boolean>(false)

  // Batch segment handler for performance - batches rapid segments into single UI update
  const segmentBatcher = useEventBatcher<BackendSegment>(
    (segments) => {
      // Convert and add all segments in a single batch operation
      const liveSegments: LiveTranscriptSegment[] = segments.map((segment) => ({
        id: segment.id,
        content: segment.text,
        start_time_ms: Math.round(segment.start * 1000),
        end_time_ms: Math.round(segment.end * 1000),
        confidence: segment.confidence || 0.8,
        is_final: segment.is_final,
        speaker_id: segment.speaker || null,
      }))

      console.log('[useLiveTranscript] Processing segment batch:', liveSegments.length, 'segments')
      addSegments(liveSegments)
    },
    SEGMENT_BATCH_INTERVAL_MS
  )

  // Throttled progress update handler
  const throttledSetProgress = useThrottledCallback(
    (progressData: TranscriptionProgressEvent) => {
      setProgress({
        phase: progressData.status,
        progress: progressData.progress,
        message: progressData.message,
      })
    },
    PROGRESS_THROTTLE_MS,
    { leading: true, trailing: true }
  )

  // Use idle callback for diarization status (informational, non-critical)
  const scheduleDiarizationStatus = useIdleCallback(
    (statusEvent: {
      available: boolean
      reason?: string
      details?: string
      message?: string
      capabilities?: {
        speaker_embeddings: boolean
        speaker_clustering: boolean
        speaker_change_detection: boolean
        transcription_only: boolean
        max_speakers?: number
        similarity_threshold?: number
        embedding_backend?: string
      } | null
    }) => {
      console.log('[useLiveTranscript] Diarization status update:', statusEvent)

      setDiarizationStatus({
        available: statusEvent.available,
        unavailableReason: statusEvent.reason || null,
        capabilities: statusEvent.capabilities || null,
        message: statusEvent.message || (statusEvent.available
          ? 'Speaker diarization is available'
          : 'Speaker diarization is not available'),
      })

      // If diarization is unavailable and there's a reason, we might want to show an error
      if (!statusEvent.available && statusEvent.reason === 'authentication_required') {
        console.warn('[useLiveTranscript] Diarization requires authentication:', statusEvent.details)
      }
    },
    DIARIZATION_STATUS_THROTTLE_MS
  )

  /**
   * Handle incoming progress updates (throttled for performance)
   */
  const handleProgressUpdate = useCallback(
    (progressData: TranscriptionProgressEvent) => {
      // Always update progress immediately for important status changes
      if (progressData.status === 'error') {
        setStatus('error')
        setError({
          code: 'TRANSCRIPTION_ERROR',
          message: progressData.message,
          timestamp: Date.now(),
          recoverable: true,
        })
        // Don't throttle errors
        setProgress({
          phase: progressData.status,
          progress: progressData.progress,
          message: progressData.message,
        })
      } else {
        // Throttle regular progress updates
        throttledSetProgress(progressData)

        // Update status based on backend status
        if (progressData.status === 'active' && status !== 'active') {
          setStatus('active')
        }
      }
    },
    [throttledSetProgress, setProgress, setStatus, setError, status]
  )

  /**
   * Handle incoming segment from backend (batched for performance)
   */
  const handleSegment = useCallback(
    (segment: BackendSegment) => {
      // Add segment to batcher instead of processing immediately
      segmentBatcher.add(segment)
    },
    [segmentBatcher]
  )

  /**
   * Handle diarization status updates from backend (scheduled for idle time)
   * This is called when the Python process reports whether diarization is available
   */
  const handleDiarizationStatus = useCallback(
    (statusEvent: {
      available: boolean
      reason?: string
      details?: string
      message?: string
      capabilities?: {
        speaker_embeddings: boolean
        speaker_clustering: boolean
        speaker_change_detection: boolean
        transcription_only: boolean
        max_speakers?: number
        similarity_threshold?: number
        embedding_backend?: string
      }
    }) => {
      // Schedule for idle time since this is informational
      scheduleDiarizationStatus(statusEvent)
    },
    [scheduleDiarizationStatus]
  )

  /**
   * Subscribe to backend events
   */
  const subscribeToEvents = useCallback(() => {
    const api = window.electronAPI as any

    if (!api?.liveTranscription) {
      console.warn('[useLiveTranscript] Live transcription API not available')
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

    // Subscribe to diarization status events
    // This allows us to update the UI when diarization fails (e.g., due to missing HF_TOKEN)
    if (api.liveTranscription.onDiarizationStatus) {
      if (unsubscribeDiarizationStatusRef.current) {
        unsubscribeDiarizationStatusRef.current()
      }
      unsubscribeDiarizationStatusRef.current = api.liveTranscription.onDiarizationStatus(handleDiarizationStatus)
    }

    console.log('[useLiveTranscript] Subscribed to backend events')
  }, [handleProgressUpdate, handleSegment, handleDiarizationStatus])

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
    if (unsubscribeDiarizationStatusRef.current) {
      unsubscribeDiarizationStatusRef.current()
      unsubscribeDiarizationStatusRef.current = null
    }
    // Flush any pending batched segments before cleanup
    segmentBatcher.flush()
  }, [segmentBatcher])

  /**
   * Start live transcription for a meeting
   */
  const start = useCallback(
    async (meetingIdParam?: string) => {
      const targetMeetingId = meetingIdParam || recordingMeetingId

      if (!targetMeetingId) {
        console.warn('[useLiveTranscript] Cannot start: No meeting ID provided')
        return
      }

      if (!mergedConfig.enabled) {
        console.log('[useLiveTranscript] Disabled by config')
        return
      }

      if (isStartedRef.current) {
        console.log('[useLiveTranscript] Already started')
        return
      }

      console.log('[useLiveTranscript] Starting for meeting:', targetMeetingId)

      isStartedRef.current = true

      // Initialize session in store
      startSession(targetMeetingId)

      // Subscribe to backend events
      subscribeToEvents()

      // Start backend transcription session
      const api = window.electronAPI as any
      if (api?.liveTranscription?.startSession) {
        try {
          const result = await api.liveTranscription.startSession(
            targetMeetingId,
            audioFilePath || '',
            {
              language: mergedConfig.language,
              modelSize: mergedConfig.modelSize,
              sampleRate: mergedConfig.sampleRate,
            }
          )

          if (!result.success) {
            console.error('[useLiveTranscript] Failed to start backend session:', result.error)
            setError({
              code: 'START_ERROR',
              message: result.error || 'Failed to start transcription',
              timestamp: Date.now(),
              recoverable: true,
            })
          } else {
            console.log('[useLiveTranscript] Backend session started successfully')
            setStatus('active')
          }
        } catch (err) {
          console.error('[useLiveTranscript] Error starting session:', err)
          setError({
            code: 'START_ERROR',
            message: err instanceof Error ? err.message : 'Failed to start transcription',
            timestamp: Date.now(),
            recoverable: true,
          })
        }
      } else {
        // API not available, just show the UI anyway
        console.log('[useLiveTranscript] Backend API not available, showing UI only')
        setStatus('active')
      }
    },
    [
      recordingMeetingId,
      audioFilePath,
      mergedConfig.enabled,
      mergedConfig.language,
      mergedConfig.modelSize,
      mergedConfig.sampleRate,
      startSession,
      subscribeToEvents,
      setStatus,
      setError,
    ]
  )

  /**
   * Stop live transcription
   */
  const stop = useCallback(async () => {
    console.log('[useLiveTranscript] Stopping')

    isStartedRef.current = false

    // Stop backend session
    const api = window.electronAPI as any
    if (api?.liveTranscription?.stopSession) {
      try {
        await api.liveTranscription.stopSession()
      } catch (err) {
        console.error('[useLiveTranscript] Error stopping session:', err)
      }
    }

    // Unsubscribe from events
    unsubscribeFromEvents()

    // Update store
    stopSession()
  }, [stopSession, unsubscribeFromEvents])

  /**
   * Pause live transcription
   */
  const pause = useCallback(() => {
    console.log('[useLiveTranscript] Pausing')

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
    console.log('[useLiveTranscript] Resuming')

    const api = window.electronAPI as any
    if (api?.liveTranscription?.resume) {
      api.liveTranscription.resume()
    }

    resumeSession()
  }, [resumeSession])

  // NOTE: Auto-start/stop logic is now handled by LiveTranscriptionProvider
  // at the app root level. This hook only provides access to state and manual controls.
  // This prevents duplicate startSession calls that cause "already in progress" errors.

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      unsubscribeFromEvents()
      isStartedRef.current = false
    }
  }, [unsubscribeFromEvents])

  return {
    // State
    status,
    meetingId,
    segments,
    error,
    progress,
    isEnabled,
    diarizationStatus,

    // Computed
    isActive: status === 'active' || status === 'starting' || status === 'paused',
    hasSegments: segments.length > 0,
    segmentCount: segments.length,
    isDiarizationAvailable: diarizationStatus.available,

    // Actions
    start,
    stop,
    pause,
    resume,
    setEnabled,
    clearSegments,
    reset,

    // For manual segment addition (e.g., from backend events)
    addSegment,
    addSegments,
    updateSegment,
  }
}

/**
 * Simplified hook to just check if live transcription is available
 */
export function useLiveTranscriptAvailable(): boolean {
  // Check if the API exists (cast to any for optional API)
  const api = window.electronAPI as any
  return Boolean(api?.liveTranscription)
}
