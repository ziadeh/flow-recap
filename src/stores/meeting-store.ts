/**
 * Meeting Store
 * 
 * Manages global state for the current meeting
 */

import { create } from 'zustand'
import type { Meeting } from '../types/database'

interface MeetingStore {
  currentMeeting: Meeting | null
  
  // Actions
  setCurrentMeeting: (meeting: Meeting | null) => void
  updateCurrentMeeting: (updates: Partial<Meeting>) => void
  clearCurrentMeeting: () => void
}

export const useMeetingStore = create<MeetingStore>((set) => ({
  currentMeeting: null,

  setCurrentMeeting: (meeting: Meeting | null) =>
    set({ currentMeeting: meeting }),

  updateCurrentMeeting: (updates: Partial<Meeting>) =>
    set((state) => ({
      currentMeeting: state.currentMeeting
        ? { ...state.currentMeeting, ...updates }
        : null
    })),

  clearCurrentMeeting: () =>
    set({ currentMeeting: null })
}))
