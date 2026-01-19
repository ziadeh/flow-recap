/**
 * Recording Store
 *
 * Manages global state for recording status and operations
 */

import { create } from 'zustand'
import { useShallow } from 'zustand/react/shallow'

// Recording types (mirrored from electron/preload.ts)
export type RecordingStatus = 'idle' | 'recording' | 'paused' | 'stopping'
export type AudioHealthStatus = 'healthy' | 'warning' | 'error' | null

export interface AudioHealthInfo {
  status: AudioHealthStatus
  message: string | null
  code?: string
}

export interface RecordingState {
  status: RecordingStatus
  meetingId: string | null
  startTime: number | null
  duration: number
  audioFilePath: string | null
  audioLevel: number
  deviceUsed: string | null
  deviceWarning: string | null
  audioHealth: AudioHealthInfo
}

interface RecordingStore extends RecordingState {
  // Actions
  setStatus: (status: RecordingStatus) => void
  setMeetingId: (meetingId: string | null) => void
  setStartTime: (startTime: number | null) => void
  setDuration: (duration: number) => void
  setAudioFilePath: (audioFilePath: string | null) => void
  setAudioLevel: (audioLevel: number) => void
  setAudioHealth: (health: AudioHealthInfo) => void
  updateState: (state: Partial<RecordingState>) => void
  reset: () => void
}

const initialState: RecordingState = {
  status: 'idle',
  meetingId: null,
  startTime: null,
  duration: 0,
  audioFilePath: null,
  audioLevel: 0,
  deviceUsed: null,
  deviceWarning: null,
  audioHealth: { status: null, message: null }
}

export const useRecordingStore = create<RecordingStore>()((set) => ({
  ...initialState,

  setStatus: (status: RecordingStatus) =>
    set({ status }),

  setMeetingId: (meetingId: string | null) =>
    set({ meetingId }),

  setStartTime: (startTime: number | null) =>
    set({ startTime }),

  setDuration: (duration: number) =>
    set({ duration }),

  setAudioFilePath: (audioFilePath: string | null) =>
    set({ audioFilePath }),

  setAudioLevel: (audioLevel: number) =>
    set({ audioLevel }),

  setAudioHealth: (audioHealth: AudioHealthInfo) =>
    set({ audioHealth }),

  updateState: (state: Partial<RecordingState>) =>
    set((current) => ({ ...current, ...state })),

  reset: () =>
    set(initialState)
}))

/**
 * Granular selectors for recording store
 * These selectors prevent unnecessary re-renders by allowing components
 * to subscribe only to the state properties they need
 */

/** Select only the recording status */
export const useRecordingStatus = () =>
  useRecordingStore((state) => state.status)

/** Select only the audio level - high frequency updates (10/sec) */
export const useAudioLevel = () =>
  useRecordingStore((state) => state.audioLevel)

/** Select only the recording duration */
export const useRecordingDuration = () =>
  useRecordingStore((state) => state.duration)

/** Select only the recording start time */
export const useRecordingStartTime = () =>
  useRecordingStore((state) => state.startTime)

/** Select only the audio health status */
export const useAudioHealth = () =>
  useRecordingStore(useShallow((state) => state.audioHealth))

/** Select recording metadata (meeting info) with shallow equality */
export const useRecordingMetadata = () =>
  useRecordingStore(useShallow((state) => ({
    meetingId: state.meetingId,
    audioFilePath: state.audioFilePath,
    deviceUsed: state.deviceUsed,
    deviceWarning: state.deviceWarning
  })))

/** Select all recording action functions */
export const useRecordingActions = () =>
  useRecordingStore(useShallow((state) => ({
    setStatus: state.setStatus,
    setMeetingId: state.setMeetingId,
    setStartTime: state.setStartTime,
    setDuration: state.setDuration,
    setAudioFilePath: state.setAudioFilePath,
    setAudioLevel: state.setAudioLevel,
    setAudioHealth: state.setAudioHealth,
    updateState: state.updateState,
    reset: state.reset
  })))
