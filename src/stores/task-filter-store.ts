/**
 * Task Filter Store
 *
 * Manages global state for task filter preferences with localStorage persistence.
 * Allows users to save and restore their filter preferences across sessions.
 */

import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { TaskStatus, TaskPriority } from '../types/database'

export interface TaskFilters {
  search: string
  statuses: TaskStatus[]
  priorities: TaskPriority[]
  assignees: string[]
  tags: string[]
  meetingIds: string[]
}

export const DEFAULT_TASK_FILTERS: TaskFilters = {
  search: '',
  statuses: [],
  priorities: [],
  assignees: [],
  tags: [],
  meetingIds: [],
}

interface TaskFilterStore {
  filters: TaskFilters
  isFiltersVisible: boolean

  // Actions
  setFilters: (filters: TaskFilters) => void
  updateFilter: <K extends keyof TaskFilters>(key: K, value: TaskFilters[K]) => void
  clearFilters: () => void
  toggleFiltersVisibility: () => void
  setFiltersVisible: (visible: boolean) => void

  // Convenience methods for common operations
  toggleStatus: (status: TaskStatus) => void
  togglePriority: (priority: TaskPriority) => void
  toggleAssignee: (assignee: string) => void
  toggleTag: (tag: string) => void
  toggleMeeting: (meetingId: string) => void
  setSearch: (search: string) => void

  // Check if any filters are active
  hasActiveFilters: () => boolean
  getActiveFilterCount: () => number
}

export const useTaskFilterStore = create<TaskFilterStore>()(
  persist(
    (set, get) => ({
      filters: DEFAULT_TASK_FILTERS,
      isFiltersVisible: true,

      setFilters: (filters: TaskFilters) =>
        set({ filters }),

      updateFilter: <K extends keyof TaskFilters>(key: K, value: TaskFilters[K]) =>
        set((state) => ({
          filters: { ...state.filters, [key]: value },
        })),

      clearFilters: () =>
        set({ filters: DEFAULT_TASK_FILTERS }),

      toggleFiltersVisibility: () =>
        set((state) => ({ isFiltersVisible: !state.isFiltersVisible })),

      setFiltersVisible: (visible: boolean) =>
        set({ isFiltersVisible: visible }),

      toggleStatus: (status: TaskStatus) =>
        set((state) => {
          const { statuses } = state.filters
          const newStatuses = statuses.includes(status)
            ? statuses.filter((s) => s !== status)
            : [...statuses, status]
          return { filters: { ...state.filters, statuses: newStatuses } }
        }),

      togglePriority: (priority: TaskPriority) =>
        set((state) => {
          const { priorities } = state.filters
          const newPriorities = priorities.includes(priority)
            ? priorities.filter((p) => p !== priority)
            : [...priorities, priority]
          return { filters: { ...state.filters, priorities: newPriorities } }
        }),

      toggleAssignee: (assignee: string) =>
        set((state) => {
          const { assignees } = state.filters
          const newAssignees = assignees.includes(assignee)
            ? assignees.filter((a) => a !== assignee)
            : [...assignees, assignee]
          return { filters: { ...state.filters, assignees: newAssignees } }
        }),

      toggleTag: (tag: string) =>
        set((state) => {
          const { tags } = state.filters
          const newTags = tags.includes(tag)
            ? tags.filter((t) => t !== tag)
            : [...tags, tag]
          return { filters: { ...state.filters, tags: newTags } }
        }),

      toggleMeeting: (meetingId: string) =>
        set((state) => {
          const { meetingIds } = state.filters
          const newMeetingIds = meetingIds.includes(meetingId)
            ? meetingIds.filter((m) => m !== meetingId)
            : [...meetingIds, meetingId]
          return { filters: { ...state.filters, meetingIds: newMeetingIds } }
        }),

      setSearch: (search: string) =>
        set((state) => ({
          filters: { ...state.filters, search },
        })),

      hasActiveFilters: () => {
        const { filters } = get()
        return (
          filters.search !== '' ||
          filters.statuses.length > 0 ||
          filters.priorities.length > 0 ||
          filters.assignees.length > 0 ||
          filters.tags.length > 0 ||
          filters.meetingIds.length > 0
        )
      },

      getActiveFilterCount: () => {
        const { filters } = get()
        let count = 0
        if (filters.search) count++
        count += filters.statuses.length
        count += filters.priorities.length
        count += filters.assignees.length
        count += filters.tags.length
        count += filters.meetingIds.length
        return count
      },
    }),
    {
      name: 'task-filter-storage',
      version: 1,
      // Only persist filters and visibility state
      partialize: (state) => ({
        filters: state.filters,
        isFiltersVisible: state.isFiltersVisible,
      }),
    }
  )
)

export default useTaskFilterStore
