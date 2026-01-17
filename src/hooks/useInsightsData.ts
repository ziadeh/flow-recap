import { useState, useEffect, useCallback, useRef, useMemo } from 'react'
import type { MeetingNote, Task } from '../types/database'
import type { ExtractedDecision, ExtractedTopic } from '../types/electron-api'
import { useRecordingStore } from '../stores/recording-store'

// ============================================================================
// Types
// ============================================================================

export type GenerationSource = 'live' | 'post_recording' | 'manual' | null

export interface InsightsState {
  actionItems: Task[]
  decisions: ExtractedDecision[]
  decisionNotes: MeetingNote[]
  keyPoints: MeetingNote[]
  topics: ExtractedTopic[]
  loading: boolean
  error: Error | null
  lastGenerated: Date | null
  generationSource: GenerationSource
}

export interface LiveInsightEvent {
  type: 'action-item' | 'decision' | 'key-point' | 'topic'
  data: unknown
  timestamp: number
}

export interface UseInsightsDataOptions {
  meetingId: string
  /** Whether to enable lazy loading (only fetch when tab is active) */
  lazyLoad?: boolean
  /** Whether the tab is currently active */
  isActive?: boolean
  /** Initial notes from parent component (for hydration) */
  initialNotes?: MeetingNote[]
  /** Initial tasks from parent component (for hydration) */
  initialTasks?: Task[]
  /** Callback when data changes */
  onDataChange?: () => void
}

export interface UseInsightsDataReturn {
  // State
  state: InsightsState
  // Computed values
  totalCount: number
  hasInsights: boolean
  isStale: boolean
  // Actions
  refetch: () => Promise<void>
  invalidateCache: () => void
  // Real-time
  isLiveUpdatesEnabled: boolean
  newInsightsCount: number
  clearNewInsights: () => void
}

// ============================================================================
// Constants
// ============================================================================

const STALE_TIME_MS = 5 * 60 * 1000 // 5 minutes
const DEBOUNCE_FETCH_MS = 300
const LIVE_UPDATE_THROTTLE_MS = 1000 // Max 1 update per second

// Type-safe accessor for the decisionsAndTopics API
interface DecisionsAndTopicsAPI {
  checkAvailability: () => Promise<{ available: boolean; error?: string; modelInfo?: string }>
  extract: (meetingId: string, config?: unknown) => Promise<{ success: boolean; error?: string }>
  deleteExisting: (meetingId: string) => Promise<{ success: boolean; deleted: number; error?: string }>
  getDecisions: (meetingId: string) => Promise<{ success: boolean; decisions: ExtractedDecision[]; error?: string }>
  getTopicsWithDetails: (meetingId: string) => Promise<{ success: boolean; topics: ExtractedTopic[]; error?: string }>
}

const getDecisionsAndTopicsAPI = (): DecisionsAndTopicsAPI | null => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const api = (window.electronAPI as any)?.decisionsAndTopics
  return api || null
}

// ============================================================================
// Hook Implementation
// ============================================================================

export function useInsightsData({
  meetingId,
  lazyLoad = true,
  isActive = false,
  initialNotes = [],
  initialTasks = [],
  onDataChange,
}: UseInsightsDataOptions): UseInsightsDataReturn {
  // Cache reference to avoid refetching on tab switch
  const cacheRef = useRef<{
    data: InsightsState | null
    timestamp: number
    meetingId: string
  }>({ data: null, timestamp: 0, meetingId: '' })

  // Track if initial fetch has been done
  const hasFetchedRef = useRef(false)
  const fetchTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Live updates tracking
  const [newInsightsCount, setNewInsightsCount] = useState(0)
  const lastLiveUpdateRef = useRef<number>(0)

  // Recording state for live updates
  const recordingStatus = useRecordingStore((state) => state.status)
  const recordingMeetingId = useRecordingStore((state) => state.meetingId)
  const isRecordingThisMeeting =
    (recordingStatus === 'recording' || recordingStatus === 'paused') &&
    recordingMeetingId === meetingId

  // Main state
  const [state, setState] = useState<InsightsState>(() => {
    // Initialize with data from props if available
    const actionItems = initialTasks.filter(t => t.created_during_recording)
    const decisionNotes = initialNotes.filter(n => n.note_type === 'decision')
    const keyPoints = initialNotes.filter(n => n.note_type === 'key_point')

    return {
      actionItems,
      decisions: [],
      decisionNotes,
      keyPoints,
      topics: [],
      loading: false,
      error: null,
      lastGenerated: null,
      generationSource: null,
    }
  })

  // Fetch insights data from the API
  const fetchInsights = useCallback(async () => {
    const api = getDecisionsAndTopicsAPI()

    setState(prev => ({ ...prev, loading: true, error: null }))

    try {
      // Fetch extracted decisions and topics in parallel
      const [decisionsResult, topicsResult] = await Promise.all([
        api?.getDecisions(meetingId) ?? { success: true, decisions: [] },
        api?.getTopicsWithDetails(meetingId) ?? { success: true, topics: [] },
      ])

      const decisions = decisionsResult.success && decisionsResult.decisions
        ? decisionsResult.decisions
        : []

      const topics = topicsResult.success && topicsResult.topics
        ? topicsResult.topics
        : []

      // Determine generation source
      let generationSource: GenerationSource = null
      if (state.actionItems.some(t => t.created_during_recording)) {
        generationSource = 'live'
      } else if (decisions.length > 0 || topics.length > 0) {
        generationSource = 'post_recording'
      }

      // Find latest generation timestamp
      const aiNotes = [...state.decisionNotes, ...state.keyPoints].filter(n => n.is_ai_generated && n.generation_timestamp)
      let lastGenerated: Date | null = null
      if (aiNotes.length > 0) {
        const sorted = aiNotes.sort((a, b) =>
          new Date(b.generation_timestamp || 0).getTime() - new Date(a.generation_timestamp || 0).getTime()
        )
        lastGenerated = sorted[0].generation_timestamp ? new Date(sorted[0].generation_timestamp) : null
      }

      const newState: InsightsState = {
        ...state,
        decisions,
        topics,
        loading: false,
        error: null,
        lastGenerated,
        generationSource,
      }

      setState(newState)

      // Update cache
      cacheRef.current = {
        data: newState,
        timestamp: Date.now(),
        meetingId,
      }

      hasFetchedRef.current = true
    } catch (err) {
      const error = err instanceof Error ? err : new Error('Failed to fetch insights')
      setState(prev => ({ ...prev, loading: false, error }))

      // If we have cached data, use it as fallback (stale-while-revalidate)
      if (cacheRef.current.data && cacheRef.current.meetingId === meetingId) {
        setState(prev => ({
          ...prev,
          ...cacheRef.current.data!,
          error, // Keep the error for display
        }))
      }
    }
  }, [meetingId, state.actionItems, state.decisionNotes, state.keyPoints])

  // Debounced fetch to prevent rapid refetching
  const debouncedFetch = useCallback(() => {
    if (fetchTimeoutRef.current) {
      clearTimeout(fetchTimeoutRef.current)
    }

    fetchTimeoutRef.current = setTimeout(() => {
      fetchInsights()
    }, DEBOUNCE_FETCH_MS)
  }, [fetchInsights])

  // Refetch function exposed to consumers
  const refetch = useCallback(async () => {
    await fetchInsights()
    onDataChange?.()
  }, [fetchInsights, onDataChange])

  // Invalidate cache (forces refetch on next activation)
  const invalidateCache = useCallback(() => {
    cacheRef.current = { data: null, timestamp: 0, meetingId: '' }
    hasFetchedRef.current = false
    setNewInsightsCount(0)
  }, [])

  // Clear new insights counter
  const clearNewInsights = useCallback(() => {
    setNewInsightsCount(0)
  }, [])

  // Update state when initial data changes
  useEffect(() => {
    const actionItems = initialTasks.filter(t => t.created_during_recording)
    const decisionNotes = initialNotes.filter(n => n.note_type === 'decision')
    const keyPoints = initialNotes.filter(n => n.note_type === 'key_point')

    setState(prev => ({
      ...prev,
      actionItems,
      decisionNotes,
      keyPoints,
    }))

    // Invalidate cache when data changes from parent
    invalidateCache()
  }, [initialNotes, initialTasks, invalidateCache])

  // Lazy loading: fetch when tab becomes active
  useEffect(() => {
    if (!lazyLoad) {
      // If lazy loading is disabled, fetch immediately
      if (!hasFetchedRef.current) {
        debouncedFetch()
      }
      return
    }

    // Check if we have valid cached data
    const cache = cacheRef.current
    const isCacheValid =
      cache.data !== null &&
      cache.meetingId === meetingId &&
      Date.now() - cache.timestamp < STALE_TIME_MS

    if (isActive) {
      if (isCacheValid) {
        // Use cached data immediately (stale-while-revalidate)
        setState(prev => ({
          ...prev,
          ...cache.data!,
        }))

        // Background revalidation if data is getting stale
        if (Date.now() - cache.timestamp > STALE_TIME_MS / 2) {
          debouncedFetch()
        }
      } else if (!hasFetchedRef.current) {
        // No cache or stale, fetch fresh data
        debouncedFetch()
      }
    }

    return () => {
      if (fetchTimeoutRef.current) {
        clearTimeout(fetchTimeoutRef.current)
      }
    }
  }, [isActive, lazyLoad, meetingId, debouncedFetch])

  // Real-time updates during recording
  useEffect(() => {
    if (!isRecordingThisMeeting || !isActive) {
      return
    }

    // Subscribe to live insight events
    const handleLiveInsight = (event: LiveInsightEvent) => {
      const now = Date.now()

      // Throttle updates
      if (now - lastLiveUpdateRef.current < LIVE_UPDATE_THROTTLE_MS) {
        return
      }
      lastLiveUpdateRef.current = now

      setNewInsightsCount(prev => prev + 1)

      // Update state based on event type
      setState(prev => {
        switch (event.type) {
          case 'action-item': {
            const newTask = event.data as Task
            if (prev.actionItems.some(t => t.id === newTask.id)) {
              return prev
            }
            return {
              ...prev,
              actionItems: [...prev.actionItems, newTask],
            }
          }
          case 'decision': {
            const newNote = event.data as MeetingNote
            if (prev.decisionNotes.some(n => n.id === newNote.id)) {
              return prev
            }
            return {
              ...prev,
              decisionNotes: [...prev.decisionNotes, newNote],
            }
          }
          case 'key-point': {
            const newKeyPoint = event.data as MeetingNote
            if (prev.keyPoints.some(n => n.id === newKeyPoint.id)) {
              return prev
            }
            return {
              ...prev,
              keyPoints: [...prev.keyPoints, newKeyPoint],
            }
          }
          case 'topic': {
            const newTopic = event.data as ExtractedTopic
            if (prev.topics.some(t => t.name === newTopic.name && t.startTimeMs === newTopic.startTimeMs)) {
              return prev
            }
            return {
              ...prev,
              topics: [...prev.topics, newTopic],
            }
          }
          default:
            return prev
        }
      })
    }

    // Set up event listeners for live insights
    // @ts-ignore - electronAPI is available globally
    const removeActionItemListener = window.electronAPI?.liveNotes?.onActionItem?.(
      (data: Task) => handleLiveInsight({ type: 'action-item', data, timestamp: Date.now() })
    )
    // @ts-ignore
    const removeDecisionListener = window.electronAPI?.liveNotes?.onDecision?.(
      (data: MeetingNote) => handleLiveInsight({ type: 'decision', data, timestamp: Date.now() })
    )
    // @ts-ignore
    const removeKeyPointListener = window.electronAPI?.liveNotes?.onKeyPoint?.(
      (data: MeetingNote) => handleLiveInsight({ type: 'key-point', data, timestamp: Date.now() })
    )
    // @ts-ignore
    const removeTopicListener = window.electronAPI?.liveNotes?.onTopic?.(
      (data: ExtractedTopic) => handleLiveInsight({ type: 'topic', data, timestamp: Date.now() })
    )

    return () => {
      removeActionItemListener?.()
      removeDecisionListener?.()
      removeKeyPointListener?.()
      removeTopicListener?.()
    }
  }, [isRecordingThisMeeting, isActive])

  // Invalidate cache when recording stops (insights may have been persisted)
  useEffect(() => {
    if (recordingStatus === 'idle' && recordingMeetingId === meetingId) {
      invalidateCache()
      debouncedFetch()
    }
  }, [recordingStatus, recordingMeetingId, meetingId, invalidateCache, debouncedFetch])

  // Computed values
  const totalCount = useMemo(() => {
    return (
      state.actionItems.length +
      state.decisions.length +
      state.decisionNotes.length +
      state.keyPoints.length +
      state.topics.length
    )
  }, [state.actionItems, state.decisions, state.decisionNotes, state.keyPoints, state.topics])

  const hasInsights = totalCount > 0

  const isStale = useMemo(() => {
    const cache = cacheRef.current
    return (
      cache.data === null ||
      cache.meetingId !== meetingId ||
      Date.now() - cache.timestamp >= STALE_TIME_MS
    )
  }, [meetingId])

  return {
    state,
    totalCount,
    hasInsights,
    isStale,
    refetch,
    invalidateCache,
    isLiveUpdatesEnabled: isRecordingThisMeeting && isActive,
    newInsightsCount,
    clearNewInsights,
  }
}

// ============================================================================
// Memoized Count Badge Component Hook
// ============================================================================

/**
 * A hook specifically for the insights count badge
 * Uses React.memo-compatible pattern for performance
 */
export function useInsightsCount(
  notes: MeetingNote[],
  tasks: Task[]
): number {
  return useMemo(() => {
    const actionItemCount = tasks.filter(t => t.created_during_recording).length
    const decisionCount = notes.filter(n => n.note_type === 'decision').length
    const keyPointCount = notes.filter(n => n.note_type === 'key_point').length

    return actionItemCount + decisionCount + keyPointCount
  }, [notes, tasks])
}
