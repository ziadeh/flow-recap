/**
 * Meeting List Store
 *
 * Zustand store for managing cached meeting list data, stale state, and optimistic updates.
 * Implements stale-while-revalidate pattern for improved perceived performance.
 */

import { create } from 'zustand'
import type { Meeting } from '@/types/database'

export interface MeetingListState {
  // Core data
  meetings: Meeting[]
  isLoading: boolean
  isRefreshing: boolean
  error: string | null
  lastUpdated: number | null // Timestamp when data was last fetched
  isStale: boolean // Whether the cached data is outdated

  // Optimistic updates
  optimisticMeetings: Map<string, Meeting> // Temporary meetings awaiting DB confirmation

  // Actions
  setMeetings: (meetings: Meeting[], isStale?: boolean) => void
  startLoading: () => void
  endLoading: () => void
  startRefreshing: () => void
  endRefreshing: () => void
  setError: (error: string | null) => void
  clearError: () => void

  // Optimistic meeting management
  addOptimisticMeeting: (meeting: Meeting) => void
  confirmOptimisticMeeting: (tempId: string, actualMeeting: Meeting) => void
  removeOptimisticMeeting: (id: string) => void
  getOptimisticMeeting: (id: string) => Meeting | undefined

  // Direct meeting removal (for deletion)
  removeMeeting: (id: string) => void
  removeMeetings: (ids: string[]) => void

  // Meeting update (for edits like renaming)
  updateMeeting: (id: string, updates: Partial<Meeting>) => void

  // Combined view (real + optimistic meetings)
  getCombinedMeetings: () => Meeting[]

  // Cache management
  invalidateCache: () => void
  reset: () => void

  // Utility
  isDataFresh: () => boolean // Check if cache is still fresh (<5 minutes old)
}

const CACHE_VALIDITY_MS = 5 * 60 * 1000 // 5 minutes

export const useMeetingListStore = create<MeetingListState>((set, get) => ({
  // Initial state
  meetings: [],
  isLoading: false,
  isRefreshing: false,
  error: null,
  lastUpdated: null,
  isStale: false,
  optimisticMeetings: new Map(),

  // Core data management
  setMeetings: (meetings, isStale = false) => {
    set({
      meetings,
      lastUpdated: Date.now(),
      isStale,
      isLoading: false,
      error: null
    })
  },

  startLoading: () => set({ isLoading: true, error: null }),
  endLoading: () => set({ isLoading: false }),

  startRefreshing: () => set({ isRefreshing: true }),
  endRefreshing: () => set({ isRefreshing: false }),

  setError: (error) => set({ error, isLoading: false, isRefreshing: false }),
  clearError: () => set({ error: null }),

  // Optimistic meeting management
  addOptimisticMeeting: (meeting) => {
    set((state) => {
      const newOptimistic = new Map(state.optimisticMeetings)
      newOptimistic.set(meeting.id, meeting)
      return { optimisticMeetings: newOptimistic }
    })
  },

  confirmOptimisticMeeting: (tempId, actualMeeting) => {
    set((state) => {
      const newOptimistic = new Map(state.optimisticMeetings)
      newOptimistic.delete(tempId)
      return { optimisticMeetings: newOptimistic }
    })

    // Add actual meeting to list if not already there
    const { meetings } = get()
    const exists = meetings.some((m) => m.id === actualMeeting.id)
    if (!exists) {
      set({ meetings: [actualMeeting, ...meetings] })
    }
  },

  removeOptimisticMeeting: (id) => {
    set((state) => {
      const newOptimistic = new Map(state.optimisticMeetings)
      newOptimistic.delete(id)
      return { optimisticMeetings: newOptimistic }
    })
  },

  getOptimisticMeeting: (id) => {
    const { optimisticMeetings } = get()
    return optimisticMeetings.get(id)
  },

  // Direct meeting removal (for deletion)
  removeMeeting: (id) => {
    set((state) => ({
      meetings: state.meetings.filter((m) => m.id !== id)
    }))
  },

  removeMeetings: (ids) => {
    const idsSet = new Set(ids)
    set((state) => ({
      meetings: state.meetings.filter((m) => !idsSet.has(m.id))
    }))
  },

  // Meeting update (for edits like renaming)
  updateMeeting: (id, updates) => {
    set((state) => ({
      meetings: state.meetings.map((m) =>
        m.id === id ? { ...m, ...updates } : m
      )
    }))
  },

  // Combined view
  getCombinedMeetings: () => {
    const { meetings, optimisticMeetings } = get()
    // Return optimistic meetings first, then real meetings
    const optimistic = Array.from(optimisticMeetings.values())
    return [...optimistic, ...meetings]
  },

  // Cache management
  invalidateCache: () => {
    set({ isStale: true, lastUpdated: null })
  },

  reset: () => {
    set({
      meetings: [],
      isLoading: false,
      isRefreshing: false,
      error: null,
      lastUpdated: null,
      isStale: false,
      optimisticMeetings: new Map()
    })
  },

  // Utility
  isDataFresh: () => {
    const { lastUpdated } = get()
    if (!lastUpdated) return false
    return Date.now() - lastUpdated < CACHE_VALIDITY_MS
  }
}))
