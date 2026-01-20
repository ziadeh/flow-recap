/**
 * React hook for speaker participation analytics
 *
 * Provides access to meeting participation data, trends, and reports
 * with caching and lazy loading support.
 */

import { useState, useEffect, useCallback, useRef, useMemo } from 'react'
import type {
  MeetingParticipationAnalytics,
  ParticipationTrend,
  ParticipationReport,
  ParticipationReportOptions
} from '../types/database'

// ============================================================================
// Types
// ============================================================================

export interface UseSpeakerParticipationOptions {
  /** Meeting ID to get participation data for */
  meetingId: string
  /** Whether to enable lazy loading (only fetch when active) */
  lazyLoad?: boolean
  /** Whether the component is currently active/visible */
  isActive?: boolean
  /** Callback when data changes */
  onDataChange?: () => void
}

export interface UseSpeakerParticipationReturn {
  // Data
  participation: MeetingParticipationAnalytics | null
  // Loading state
  loading: boolean
  // Error state
  error: Error | null
  // Actions
  refetch: () => Promise<void>
  invalidateCache: () => void
}

export interface UseSpeakerTrendsOptions {
  /** Start date for trend data (ISO string) */
  startDate: string
  /** End date for trend data (ISO string) */
  endDate: string
  /** How to group trend data */
  grouping?: 'day' | 'week' | 'month'
  /** Whether to enable lazy loading */
  lazyLoad?: boolean
  /** Whether the component is currently active/visible */
  isActive?: boolean
}

export interface UseSpeakerTrendsReturn {
  trends: ParticipationTrend[]
  loading: boolean
  error: Error | null
  refetch: () => Promise<void>
}

export interface UseParticipationReportOptions extends ParticipationReportOptions {
  /** Whether to auto-generate on mount */
  autoGenerate?: boolean
  /** Whether the component is currently active/visible */
  isActive?: boolean
}

export interface UseParticipationReportReturn {
  report: ParticipationReport | null
  loading: boolean
  error: Error | null
  generate: (options?: ParticipationReportOptions) => Promise<void>
}

// ============================================================================
// Constants
// ============================================================================

const CACHE_TTL_MS = 5 * 60 * 1000 // 5 minutes
const DEBOUNCE_MS = 300

// ============================================================================
// Helper: Get speaker participation API
// ============================================================================

function getSpeakerParticipationAPI() {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (window as any).electronAPI?.speakerParticipation
}

// ============================================================================
// Hook: useSpeakerParticipation
// ============================================================================

/**
 * Hook to get participation analytics for a single meeting
 */
export function useSpeakerParticipation({
  meetingId,
  lazyLoad = true,
  isActive = true,
  onDataChange
}: UseSpeakerParticipationOptions): UseSpeakerParticipationReturn {
  const [participation, setParticipation] = useState<MeetingParticipationAnalytics | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<Error | null>(null)

  const cacheRef = useRef<{
    data: MeetingParticipationAnalytics | null
    timestamp: number
    meetingId: string
  }>({ data: null, timestamp: 0, meetingId: '' })

  const hasFetchedRef = useRef(false)
  const fetchTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const fetchParticipation = useCallback(async () => {
    const api = getSpeakerParticipationAPI()
    if (!api) {
      setError(new Error('Speaker participation API not available'))
      return
    }

    setLoading(true)
    setError(null)

    try {
      const result = await api.getMeetingParticipation(meetingId)
      setParticipation(result)

      // Update cache
      cacheRef.current = {
        data: result,
        timestamp: Date.now(),
        meetingId
      }

      hasFetchedRef.current = true
      onDataChange?.()
    } catch (err) {
      const fetchError = err instanceof Error ? err : new Error('Failed to fetch participation data')
      setError(fetchError)

      // Use stale cache if available
      if (cacheRef.current.data && cacheRef.current.meetingId === meetingId) {
        setParticipation(cacheRef.current.data)
      }
    } finally {
      setLoading(false)
    }
  }, [meetingId, onDataChange])

  const debouncedFetch = useCallback(() => {
    if (fetchTimeoutRef.current) {
      clearTimeout(fetchTimeoutRef.current)
    }
    fetchTimeoutRef.current = setTimeout(fetchParticipation, DEBOUNCE_MS)
  }, [fetchParticipation])

  const refetch = useCallback(async () => {
    await fetchParticipation()
  }, [fetchParticipation])

  const invalidateCache = useCallback(() => {
    cacheRef.current = { data: null, timestamp: 0, meetingId: '' }
    hasFetchedRef.current = false
  }, [])

  // Fetch when active and meeting ID changes
  useEffect(() => {
    if (!lazyLoad) {
      if (!hasFetchedRef.current) {
        debouncedFetch()
      }
      return
    }

    const cache = cacheRef.current
    const isCacheValid =
      cache.data !== null &&
      cache.meetingId === meetingId &&
      Date.now() - cache.timestamp < CACHE_TTL_MS

    if (isActive) {
      if (isCacheValid) {
        setParticipation(cache.data)
        // Background revalidation if cache is getting stale
        if (Date.now() - cache.timestamp > CACHE_TTL_MS / 2) {
          debouncedFetch()
        }
      } else if (!hasFetchedRef.current) {
        debouncedFetch()
      }
    }

    return () => {
      if (fetchTimeoutRef.current) {
        clearTimeout(fetchTimeoutRef.current)
      }
    }
  }, [isActive, lazyLoad, meetingId, debouncedFetch])

  // Reset when meeting ID changes
  useEffect(() => {
    hasFetchedRef.current = false
    setParticipation(null)
    setError(null)
  }, [meetingId])

  return {
    participation,
    loading,
    error,
    refetch,
    invalidateCache
  }
}

// ============================================================================
// Hook: useQuickParticipationStats
// ============================================================================

/**
 * Hook to get quick participation stats for dashboard display
 */
export function useQuickParticipationStats(meetingId: string | null) {
  const [stats, setStats] = useState<{
    speakerCount: number
    totalDurationMs: number
    isBalanced: boolean
    dominantSpeakerName: string | null
    dominantSpeakerPercentage: number | null
  } | null>(null)
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (!meetingId) {
      setStats(null)
      return
    }

    const api = getSpeakerParticipationAPI()
    if (!api) return

    setLoading(true)
    api.getQuickStats(meetingId)
      .then((result: typeof stats) => {
        setStats(result)
      })
      .catch(() => {
        setStats(null)
      })
      .finally(() => {
        setLoading(false)
      })
  }, [meetingId])

  return { stats, loading }
}

// ============================================================================
// Hook: useSpeakerTrends
// ============================================================================

/**
 * Hook to get participation trends over time
 */
export function useSpeakerTrends({
  startDate,
  endDate,
  grouping = 'week',
  lazyLoad = true,
  isActive = true
}: UseSpeakerTrendsOptions): UseSpeakerTrendsReturn {
  const [trends, setTrends] = useState<ParticipationTrend[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<Error | null>(null)
  const hasFetchedRef = useRef(false)

  const fetchTrends = useCallback(async () => {
    const api = getSpeakerParticipationAPI()
    if (!api) {
      setError(new Error('Speaker participation API not available'))
      return
    }

    setLoading(true)
    setError(null)

    try {
      const result = await api.getTrends(startDate, endDate, grouping)
      setTrends(result)
      hasFetchedRef.current = true
    } catch (err) {
      setError(err instanceof Error ? err : new Error('Failed to fetch trends'))
    } finally {
      setLoading(false)
    }
  }, [startDate, endDate, grouping])

  useEffect(() => {
    if (!lazyLoad || (isActive && !hasFetchedRef.current)) {
      fetchTrends()
    }
  }, [lazyLoad, isActive, fetchTrends])

  // Reset when params change
  useEffect(() => {
    hasFetchedRef.current = false
  }, [startDate, endDate, grouping])

  return {
    trends,
    loading,
    error,
    refetch: fetchTrends
  }
}

// ============================================================================
// Hook: useParticipationReport
// ============================================================================

/**
 * Hook to generate and manage participation reports
 */
export function useParticipationReport({
  autoGenerate = false,
  isActive = true,
  ...reportOptions
}: UseParticipationReportOptions = {}): UseParticipationReportReturn {
  const [report, setReport] = useState<ParticipationReport | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<Error | null>(null)
  const hasGeneratedRef = useRef(false)

  const generate = useCallback(async (options?: ParticipationReportOptions) => {
    const api = getSpeakerParticipationAPI()
    if (!api) {
      setError(new Error('Speaker participation API not available'))
      return
    }

    setLoading(true)
    setError(null)

    try {
      const result = await api.generateReport(options || reportOptions)
      setReport(result)
      hasGeneratedRef.current = true
    } catch (err) {
      setError(err instanceof Error ? err : new Error('Failed to generate report'))
    } finally {
      setLoading(false)
    }
  }, [reportOptions])

  useEffect(() => {
    if (autoGenerate && isActive && !hasGeneratedRef.current) {
      generate()
    }
  }, [autoGenerate, isActive, generate])

  return {
    report,
    loading,
    error,
    generate
  }
}

// ============================================================================
// Hook: useFormattedParticipation
// ============================================================================

/**
 * Hook that provides formatted participation data for display
 */
export function useFormattedParticipation(meetingId: string) {
  const { participation, loading, error, refetch } = useSpeakerParticipation({
    meetingId,
    lazyLoad: false
  })

  const formattedData = useMemo(() => {
    if (!participation) return null

    const formatDuration = (ms: number) => {
      const seconds = Math.floor(ms / 1000)
      const minutes = Math.floor(seconds / 60)
      const hours = Math.floor(minutes / 60)

      if (hours > 0) {
        return `${hours}h ${minutes % 60}m`
      }
      if (minutes > 0) {
        return `${minutes}m ${seconds % 60}s`
      }
      return `${seconds}s`
    }

    return {
      ...participation,
      formattedDuration: formatDuration(participation.totalDurationMs),
      speakers: participation.speakers.map(speaker => ({
        ...speaker,
        formattedTalkTime: formatDuration(speaker.talkTimeMs),
        formattedPercentage: `${speaker.talkTimePercentage.toFixed(1)}%`
      })),
      balanceStatus: participation.isBalanced ? 'Balanced' : 'Unbalanced',
      giniLabel: participation.giniCoefficient < 0.3
        ? 'Very Equal'
        : participation.giniCoefficient < 0.5
          ? 'Moderate'
          : 'Unequal'
    }
  }, [participation])

  return {
    data: formattedData,
    loading,
    error,
    refetch
  }
}
