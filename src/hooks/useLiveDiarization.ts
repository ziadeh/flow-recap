/**
 * useLiveDiarization Hook
 *
 * Provides integration between the audio recording service and the streaming
 * diarization service to enable real-time speaker identification during live
 * recordings WITHOUT requiring LLM processing.
 *
 * Key Features:
 * - Automatically starts/stops streaming diarization with recording
 * - Uses voice embeddings (pyannote/speechbrain) for speaker identification
 * - No LLM processing overhead - purely signal processing based
 * - Provides real-time speaker segments and change events
 * - Integrates with the live transcript store for unified state management
 *
 * Usage:
 *   const {
 *     isAvailable,
 *     isActive,
 *     numSpeakers,
 *     speakerSegments,
 *     currentSpeaker,
 *     startDiarization,
 *     stopDiarization,
 *   } = useLiveDiarization(meetingId)
 */

import { useCallback, useEffect, useState, useRef } from 'react'
import {
  useLiveTranscriptStore,
  useStreamingDiarizationState,
  useSpeakerSegments,
  useSpeakerChanges,
  useNumSpeakersDetected,
  useIsStreamingDiarizationActive,
  useIsColdStartComplete,
} from '../stores/live-transcript-store'
import type {
  StreamingSpeakerSegment,
  SpeakerChangeEvent,
  RetroactiveCorrectionEvent,
  StreamingDiarizationState,
} from '../stores/live-transcript-store'
import { useThrottledCallback, useEventBatcher, useIdleCallback } from './useThrottledCallback'

// Throttle intervals for high-frequency diarization events
const SPEAKER_SEGMENT_THROTTLE_MS = 200 // Speaker segments don't need instant updates
const SPEAKER_CHANGE_THROTTLE_MS = 150 // Speaker changes are more important, faster updates
const STATS_THROTTLE_MS = 500 // Stats are non-critical, use idle callback

// ============================================================================
// Types
// ============================================================================

export interface LiveDiarizationConfig {
  /** Speaker similarity threshold (0.0-1.0, default: 0.35)
   *  Lower values = more speakers detected
   *  Recommended range: 0.3-0.45 for typical multi-speaker calls */
  similarityThreshold?: number
  /** Maximum number of speakers to track (default: 10) */
  maxSpeakers?: number
  /** Window duration for speaker embedding extraction (default: 2.0s) */
  windowDuration?: number
  /** Hop duration between windows (default: 0.5s) */
  hopDuration?: number
  /** Enable retroactive speaker label correction (default: true) */
  enableRetroactiveCorrection?: boolean
}

export interface LiveDiarizationState {
  /** Whether streaming diarization service is available */
  isAvailable: boolean
  /** Whether diarization is currently active */
  isActive: boolean
  /** Whether diarization is initializing */
  isInitializing: boolean
  /** Whether cold-start phase is complete */
  isColdStartComplete: boolean
  /** Number of speakers detected */
  numSpeakers: number
  /** Total audio processed in seconds */
  totalAudioProcessed: number
  /** Current speaker label (most recent) */
  currentSpeaker: string | null
  /** All detected speaker segments */
  speakerSegments: StreamingSpeakerSegment[]
  /** Recent speaker change events */
  speakerChanges: SpeakerChangeEvent[]
  /** Error message if in error state */
  error: string | null
  /** Current status string */
  status: StreamingDiarizationState['status']
}

export interface LiveDiarizationActions {
  /** Start live diarization for a meeting */
  startDiarization: (meetingId: string, config?: LiveDiarizationConfig) => Promise<boolean>
  /** Stop live diarization */
  stopDiarization: () => Promise<void>
  /** Pause diarization (e.g., when recording is paused) */
  pauseDiarization: () => void
  /** Resume diarization */
  resumeDiarization: () => void
  /** Force reset the diarization state */
  resetDiarization: () => void
  /** Get speaker for a time range */
  getSpeakerForTimeRange: (startTimeMs: number, endTimeMs: number) => { speaker: string; confidence: number } | null
  /** Check availability */
  checkAvailability: () => Promise<{ available: boolean; error?: string }>
}

// ============================================================================
// Hook Implementation
// ============================================================================

export function useLiveDiarization(): LiveDiarizationState & LiveDiarizationActions {
  // Local state for availability
  const [isAvailable, setIsAvailable] = useState<boolean>(false)
  const [availabilityError, setAvailabilityError] = useState<string | null>(null)
  const [isCheckingAvailability, setIsCheckingAvailability] = useState<boolean>(false)

  // Refs for cleanup
  const unsubscribeRefs = useRef<Array<() => void>>([])
  const isStartingRef = useRef<boolean>(false)

  // Get streaming diarization state from store
  const streamingState = useStreamingDiarizationState()
  const speakerSegments = useSpeakerSegments()
  const speakerChanges = useSpeakerChanges()
  const numSpeakers = useNumSpeakersDetected()
  const isActive = useIsStreamingDiarizationActive()
  const isColdStartComplete = useIsColdStartComplete()

  // Store actions
  const {
    setStreamingDiarizationState,
    addSpeakerSegment,
    addSpeakerChange,
    applyRetroactiveCorrection,
    clearStreamingDiarization,
    getSpeakerForTimeRange: storeSpeakerForTimeRange,
  } = useLiveTranscriptStore()

  // Determine current speaker from most recent speaker change
  const currentSpeaker = speakerChanges.length > 0
    ? speakerChanges[speakerChanges.length - 1].toSpeaker
    : (speakerSegments.length > 0 ? speakerSegments[speakerSegments.length - 1].speaker : null)

  /**
   * Check if streaming diarization is available
   */
  const checkAvailability = useCallback(async () => {
    if (isCheckingAvailability) {
      return { available: isAvailable, error: availabilityError || undefined }
    }

    setIsCheckingAvailability(true)

    try {
      const api = window.electronAPI as any
      if (!api?.streamingDiarization?.isAvailable) {
        setIsAvailable(false)
        setAvailabilityError('Streaming diarization API not available')
        return { available: false, error: 'Streaming diarization API not available' }
      }

      const result = await api.streamingDiarization.isAvailable()

      setIsAvailable(result.available)
      setAvailabilityError(result.error || null)

      if (!result.available) {
        console.warn('[useLiveDiarization] Not available:', result.error)
      }

      return { available: result.available, error: result.error }
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : 'Unknown error'
      setIsAvailable(false)
      setAvailabilityError(errorMsg)
      console.error('[useLiveDiarization] Availability check failed:', errorMsg)
      return { available: false, error: errorMsg }
    } finally {
      setIsCheckingAvailability(false)
    }
  }, [isAvailable, availabilityError, isCheckingAvailability])

  /**
   * Start live diarization for a meeting
   */
  const startDiarization = useCallback(async (
    meetingId: string,
    config?: LiveDiarizationConfig
  ): Promise<boolean> => {
    // Prevent duplicate starts
    if (isStartingRef.current) {
      console.log('[useLiveDiarization] Already starting, ignoring duplicate call')
      return false
    }

    if (isActive) {
      console.log('[useLiveDiarization] Already active')
      return true
    }

    isStartingRef.current = true

    try {
      const api = window.electronAPI as any
      if (!api?.streamingDiarization) {
        console.error('[useLiveDiarization] API not available')
        setStreamingDiarizationState({ status: 'error', error: 'API not available' })
        return false
      }

      // Clear previous state
      clearStreamingDiarization()

      // Update state to initializing
      setStreamingDiarizationState({ status: 'initializing' })

      console.log('[useLiveDiarization] Starting session for meeting:', meetingId)

      // Set up event subscriptions BEFORE starting
      setupEventSubscriptions(api)

      // Start the streaming diarization session
      // Note: Lower similarity threshold (0.35) provides better multi-speaker separation
      const result = await api.streamingDiarization.startSession(meetingId, {
        similarityThreshold: config?.similarityThreshold ?? 0.35,
        maxSpeakers: config?.maxSpeakers ?? 10,
        windowDuration: config?.windowDuration ?? 2.0,
        hopDuration: config?.hopDuration ?? 0.5,
        enableRetroactiveCorrection: config?.enableRetroactiveCorrection ?? true,
      })

      if (!result.success) {
        console.error('[useLiveDiarization] Failed to start:', result.error)
        setStreamingDiarizationState({ status: 'error', error: result.error })
        cleanupSubscriptions()
        return false
      }

      console.log('[useLiveDiarization] Session started successfully')
      return true
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : 'Unknown error'
      console.error('[useLiveDiarization] Error starting:', errorMsg)
      setStreamingDiarizationState({ status: 'error', error: errorMsg })
      cleanupSubscriptions()
      return false
    } finally {
      isStartingRef.current = false
    }
  }, [isActive, setStreamingDiarizationState, clearStreamingDiarization])

  // Throttled speaker segment handler - batch segments for less frequent UI updates
  const speakerSegmentBatcher = useEventBatcher<StreamingSpeakerSegment>(
    (segments) => {
      // Process all batched segments
      for (const segment of segments) {
        console.log('[useLiveDiarization] Speaker segment:', segment.speaker, segment.startTime.toFixed(2), '-', segment.endTime.toFixed(2))
        addSpeakerSegment(segment)
      }
    },
    SPEAKER_SEGMENT_THROTTLE_MS
  )

  // Throttled speaker change handler
  const throttledAddSpeakerChange = useThrottledCallback(
    (event: SpeakerChangeEvent) => {
      console.log('[useLiveDiarization] Speaker change:', event.fromSpeaker, '->', event.toSpeaker)
      addSpeakerChange(event)
    },
    SPEAKER_CHANGE_THROTTLE_MS,
    { leading: true, trailing: true }
  )

  // Use idle callback for non-critical stats updates
  const scheduleStatsUpdate = useIdleCallback(
    (stats: Record<string, any>) => {
      const numSpeakers = Object.keys(stats).length
      setStreamingDiarizationState({ numSpeakersDetected: numSpeakers })
    },
    STATS_THROTTLE_MS
  )

  /**
   * Set up event subscriptions for streaming diarization
   * Performance optimized with throttling for high-frequency events
   */
  const setupEventSubscriptions = useCallback((api: any) => {
    // Clean up any existing subscriptions first
    cleanupSubscriptions()

    // Speaker segment events - batched for performance
    const unsubSegment = api.streamingDiarization.onSpeakerSegment((segment: StreamingSpeakerSegment) => {
      speakerSegmentBatcher.add(segment)
    })
    unsubscribeRefs.current.push(unsubSegment)

    // Speaker change events - throttled for UI responsiveness
    const unsubChange = api.streamingDiarization.onSpeakerChange((event: SpeakerChangeEvent) => {
      throttledAddSpeakerChange(event)
    })
    unsubscribeRefs.current.push(unsubChange)

    // Status updates - not throttled as they're infrequent but important
    const unsubStatus = api.streamingDiarization.onStatus((status: { status: string; message?: string }) => {
      console.log('[useLiveDiarization] Status update:', status.status, status.message)
      setStreamingDiarizationState({ status: status.status as StreamingDiarizationState['status'] })
    })
    unsubscribeRefs.current.push(unsubStatus)

    // Retroactive correction events - not throttled as they're important for accuracy
    const unsubCorrection = api.streamingDiarization.onCorrection((event: RetroactiveCorrectionEvent) => {
      console.log('[useLiveDiarization] Retroactive correction:', event.originalSpeaker, '->', event.correctedSpeaker)
      applyRetroactiveCorrection(event)
    })
    unsubscribeRefs.current.push(unsubCorrection)

    // Stats updates - use requestIdleCallback for non-critical updates
    const unsubStats = api.streamingDiarization.onStats((stats: Record<string, any>) => {
      scheduleStatsUpdate(stats)
    })
    unsubscribeRefs.current.push(unsubStats)
  }, [speakerSegmentBatcher, throttledAddSpeakerChange, setStreamingDiarizationState, applyRetroactiveCorrection, scheduleStatsUpdate])

  /**
   * Clean up event subscriptions
   */
  const cleanupSubscriptions = useCallback(() => {
    for (const unsub of unsubscribeRefs.current) {
      try {
        unsub()
      } catch (e) {
        // Ignore cleanup errors
      }
    }
    unsubscribeRefs.current = []
    // Flush any pending batched events before cleanup
    speakerSegmentBatcher.flush()
  }, [speakerSegmentBatcher])

  /**
   * Stop live diarization
   */
  const stopDiarization = useCallback(async (): Promise<void> => {
    try {
      const api = window.electronAPI as any
      if (!api?.streamingDiarization) {
        return
      }

      console.log('[useLiveDiarization] Stopping session')

      // Stop the session
      const result = await api.streamingDiarization.stopSession()

      console.log('[useLiveDiarization] Session stopped, segments:', result.segments?.length, 'speakers:', Object.keys(result.stats || {}).length)

      // Clean up subscriptions
      cleanupSubscriptions()

      // Update state
      setStreamingDiarizationState({ status: 'idle' })
    } catch (error) {
      console.error('[useLiveDiarization] Error stopping:', error)
      cleanupSubscriptions()
      setStreamingDiarizationState({ status: 'idle' })
    }
  }, [cleanupSubscriptions, setStreamingDiarizationState])

  /**
   * Pause diarization
   */
  const pauseDiarization = useCallback(() => {
    const api = window.electronAPI as any
    if (api?.streamingDiarization?.pause) {
      api.streamingDiarization.pause()
      setStreamingDiarizationState({ status: 'paused' })
    }
  }, [setStreamingDiarizationState])

  /**
   * Resume diarization
   */
  const resumeDiarization = useCallback(() => {
    const api = window.electronAPI as any
    if (api?.streamingDiarization?.resume) {
      api.streamingDiarization.resume()
      setStreamingDiarizationState({ status: 'active' })
    }
  }, [setStreamingDiarizationState])

  /**
   * Force reset the diarization state
   */
  const resetDiarization = useCallback(() => {
    cleanupSubscriptions()
    clearStreamingDiarization()

    const api = window.electronAPI as any
    if (api?.streamingDiarization?.forceReset) {
      api.streamingDiarization.forceReset()
    }
  }, [cleanupSubscriptions, clearStreamingDiarization])

  /**
   * Get speaker for a time range
   */
  const getSpeakerForTimeRange = useCallback((startTimeMs: number, endTimeMs: number) => {
    return storeSpeakerForTimeRange(startTimeMs, endTimeMs)
  }, [storeSpeakerForTimeRange])

  // Check availability on mount (deferred to avoid blocking initial render)
  useEffect(() => {
    // Use requestIdleCallback or setTimeout to defer non-critical availability check
    // This prevents blocking the initial render of the Dashboard
    const timeoutId = setTimeout(() => {
      checkAvailability()
    }, 100) // Small delay to let UI render first

    return () => clearTimeout(timeoutId)
  }, []) // Only run once on mount

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      cleanupSubscriptions()
    }
  }, [cleanupSubscriptions])

  // Return state and actions
  return {
    // State
    isAvailable,
    isActive,
    isInitializing: streamingState.status === 'initializing',
    isColdStartComplete,
    numSpeakers,
    totalAudioProcessed: streamingState.totalAudioProcessed,
    currentSpeaker,
    speakerSegments,
    speakerChanges,
    error: streamingState.error || availabilityError,
    status: streamingState.status,

    // Actions
    startDiarization,
    stopDiarization,
    pauseDiarization,
    resumeDiarization,
    resetDiarization,
    getSpeakerForTimeRange,
    checkAvailability,
  }
}

export default useLiveDiarization
