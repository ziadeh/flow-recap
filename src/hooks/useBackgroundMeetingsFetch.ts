/**
 * useBackgroundMeetingsFetch Hook
 *
 * Manages background fetching of meetings with smart caching and debouncing.
 * Implements stale-while-revalidate pattern for optimal UX.
 */

import { useEffect, useRef, useCallback } from 'react'
import { useMeetingListStore } from '@/stores/meeting-list-store'

interface UseBackgroundMeetingsFetchOptions {
  enabled?: boolean // Whether to enable fetching
  forceRefresh?: boolean // Force refresh even if cache is fresh
  debounceMs?: number // Debounce time for rapid refetch requests
  onSuccess?: () => void
  onError?: (error: Error) => void
}

export function useBackgroundMeetingsFetch(options: UseBackgroundMeetingsFetchOptions = {}) {
  const {
    enabled = true,
    forceRefresh = false,
    debounceMs = 1000,
    onSuccess,
    onError
  } = options

  const isMountedRef = useRef(true)
  const fetchTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const hasFetchedRef = useRef(false)

  // Get stable references to store actions using selectors
  // This prevents the infinite loop caused by store object reference changes
  const setMeetings = useMeetingListStore(state => state.setMeetings)
  const startRefreshing = useMeetingListStore(state => state.startRefreshing)
  const endRefreshing = useMeetingListStore(state => state.endRefreshing)
  const setError = useMeetingListStore(state => state.setError)
  const isDataFresh = useMeetingListStore(state => state.isDataFresh)
  const isRefreshing = useMeetingListStore(state => state.isRefreshing)

  // Memoize callbacks to prevent dependency changes
  const onSuccessRef = useRef(onSuccess)
  const onErrorRef = useRef(onError)
  onSuccessRef.current = onSuccess
  onErrorRef.current = onError

  useEffect(() => {
    isMountedRef.current = true
    return () => {
      isMountedRef.current = false
      if (fetchTimeoutRef.current) {
        clearTimeout(fetchTimeoutRef.current)
        fetchTimeoutRef.current = null
      }
    }
  }, [])

  // Stable fetch function using useCallback
  const performFetch = useCallback(async () => {
    try {
      // Check if we should fetch - use the function directly
      const shouldFetch = forceRefresh || !isDataFresh()

      if (!shouldFetch) {
        return
      }

      // Don't fetch if already fetching
      if (isRefreshing) {
        return
      }

      if (!isMountedRef.current) return

      startRefreshing()

      const allMeetings = await window.electronAPI.db.meetings.getAll()

      if (!isMountedRef.current) return

      setMeetings(allMeetings, false) // false = not stale, it's fresh

      onSuccessRef.current?.()
    } catch (error) {
      if (!isMountedRef.current) return

      const err = error instanceof Error ? error : new Error(String(error))
      setError(`Failed to fetch meetings: ${err.message}`)
      onErrorRef.current?.(err)
    } finally {
      if (isMountedRef.current) {
        endRefreshing()
      }
    }
  }, [forceRefresh, isDataFresh, isRefreshing, startRefreshing, setMeetings, setError, endRefreshing])

  useEffect(() => {
    if (!enabled) return

    // Only fetch once on mount (or when forceRefresh changes)
    // This prevents the infinite loop
    if (hasFetchedRef.current && !forceRefresh) {
      return
    }

    // Clear any pending fetch
    if (fetchTimeoutRef.current) {
      clearTimeout(fetchTimeoutRef.current)
    }

    fetchTimeoutRef.current = setTimeout(() => {
      hasFetchedRef.current = true
      performFetch()
      fetchTimeoutRef.current = null
    }, debounceMs)

    return () => {
      if (fetchTimeoutRef.current) {
        clearTimeout(fetchTimeoutRef.current)
        fetchTimeoutRef.current = null
      }
    }
  }, [enabled, forceRefresh, debounceMs, performFetch])
}

/**
 * Manually trigger a refresh of meetings
 * Useful for explicit user-initiated refreshes
 */
export function useRefreshMeetings() {
  // Use individual selectors for consistent patterns across the codebase
  const setMeetings = useMeetingListStore(state => state.setMeetings)
  const startRefreshing = useMeetingListStore(state => state.startRefreshing)
  const endRefreshing = useMeetingListStore(state => state.endRefreshing)
  const setError = useMeetingListStore(state => state.setError)

  return useCallback(async () => {
    try {
      startRefreshing()
      const allMeetings = await window.electronAPI.db.meetings.getAll()
      setMeetings(allMeetings, false)
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error))
      setError(`Failed to refresh meetings: ${err.message}`)
    } finally {
      endRefreshing()
    }
  }, [startRefreshing, setMeetings, setError, endRefreshing])
}
