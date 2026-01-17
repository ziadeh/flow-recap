/**
 * Update Store
 *
 * Manages global state for automatic updates using electron-updater.
 * Tracks update status, progress, and provides actions for update operations.
 */

import { create } from 'zustand'
import { useShallow } from 'zustand/react/shallow'
import type {
  UpdateStatus,
  UpdateState,
  RollbackInfo
} from '@/types/electron-api'

// Re-export types for convenience
export type { UpdateStatus, UpdateState, RollbackInfo }

interface UpdateStore {
  // State
  state: UpdateState
  rollbackInfo: RollbackInfo
  isNotificationVisible: boolean
  autoCheckEnabled: boolean

  // Actions
  setState: (newState: Partial<UpdateState>) => void
  setRollbackInfo: (info: RollbackInfo) => void
  setNotificationVisible: (visible: boolean) => void
  setAutoCheckEnabled: (enabled: boolean) => void

  // API Actions
  checkForUpdates: () => Promise<void>
  downloadUpdate: () => Promise<void>
  installUpdate: () => Promise<void>
  rollback: () => Promise<void>
  dismissNotification: () => void
  fetchRollbackInfo: () => Promise<void>
}

// Default state
const defaultState: UpdateState = {
  status: 'idle',
  currentVersion: '1.0.0',
  availableVersion: null,
  releaseNotes: null,
  releaseDate: null,
  downloadProgress: 0,
  bytesDownloaded: 0,
  totalBytes: 0,
  error: null,
  lastChecked: null
}

const defaultRollbackInfo: RollbackInfo = {
  available: false,
  previousVersion: null,
  backupPath: null
}

export const useUpdateStore = create<UpdateStore>((set) => ({
  state: defaultState,
  rollbackInfo: defaultRollbackInfo,
  isNotificationVisible: false,
  autoCheckEnabled: true,

  setState: (newState: Partial<UpdateState>) => {
    set((store) => ({
      state: { ...store.state, ...newState }
    }))
  },

  setRollbackInfo: (info: RollbackInfo) => {
    set({ rollbackInfo: info })
  },

  setNotificationVisible: (visible: boolean) => {
    set({ isNotificationVisible: visible })
  },

  setAutoCheckEnabled: (enabled: boolean) => {
    set({ autoCheckEnabled: enabled })
  },

  checkForUpdates: async () => {
    try {
      set((store) => ({
        state: { ...store.state, status: 'checking', error: null }
      }))

      const result = await window.electronAPI.update.checkForUpdates()

      if (result.error) {
        set((store) => ({
          state: { ...store.state, status: 'error', error: result.error || 'Unknown error' }
        }))
        return
      }

      if (result.updateAvailable) {
        set((store) => ({
          state: {
            ...store.state,
            status: 'available',
            currentVersion: result.currentVersion,
            availableVersion: result.availableVersion || null,
            releaseNotes: result.releaseNotes || null,
            releaseDate: result.releaseDate || null,
            lastChecked: Date.now()
          },
          isNotificationVisible: true
        }))
      } else {
        set((store) => ({
          state: {
            ...store.state,
            status: 'not-available',
            currentVersion: result.currentVersion,
            lastChecked: Date.now()
          }
        }))
      }
    } catch (error) {
      set((store) => ({
        state: {
          ...store.state,
          status: 'error',
          error: error instanceof Error ? error.message : 'Unknown error'
        }
      }))
    }
  },

  downloadUpdate: async () => {
    try {
      set((store) => ({
        state: { ...store.state, status: 'downloading', downloadProgress: 0 }
      }))

      const result = await window.electronAPI.update.downloadUpdate()

      if (!result.success) {
        set((store) => ({
          state: {
            ...store.state,
            status: 'error',
            error: result.error || 'Download failed'
          }
        }))
      }
      // The status will be updated via the onStatusChange listener when download completes
    } catch (error) {
      set((store) => ({
        state: {
          ...store.state,
          status: 'error',
          error: error instanceof Error ? error.message : 'Unknown error'
        }
      }))
    }
  },

  installUpdate: async () => {
    try {
      set((store) => ({
        state: { ...store.state, status: 'installing' }
      }))

      const result = await window.electronAPI.update.installUpdate()

      if (!result.success) {
        set((store) => ({
          state: {
            ...store.state,
            status: 'error',
            error: result.error || 'Installation failed'
          }
        }))
      }
      // If successful, the app will restart
    } catch (error) {
      set((store) => ({
        state: {
          ...store.state,
          status: 'error',
          error: error instanceof Error ? error.message : 'Unknown error'
        }
      }))
    }
  },

  rollback: async () => {
    try {
      const result = await window.electronAPI.update.rollback()

      if (!result.success) {
        set((store) => ({
          state: {
            ...store.state,
            status: 'error',
            error: result.error || 'Rollback failed'
          }
        }))
      }
    } catch (error) {
      set((store) => ({
        state: {
          ...store.state,
          status: 'error',
          error: error instanceof Error ? error.message : 'Unknown error'
        }
      }))
    }
  },

  dismissNotification: () => {
    set({ isNotificationVisible: false })
  },

  fetchRollbackInfo: async () => {
    try {
      const info = await window.electronAPI.update.getRollbackInfo()
      set({ rollbackInfo: info })
    } catch (error) {
      console.error('Failed to fetch rollback info:', error)
    }
  }
}))

// Selector hooks for specific use cases
export const useUpdateState = () => useUpdateStore((store) => store.state)
export const useUpdateStatus = () => useUpdateStore((store) => store.state.status)

// Use shallow equality check for object selectors to prevent unnecessary re-renders
export const useUpdateProgress = () =>
  useUpdateStore(
    useShallow((store) => ({
      progress: store.state.downloadProgress,
      bytesDownloaded: store.state.bytesDownloaded,
      totalBytes: store.state.totalBytes
    }))
  )

export const useUpdateNotification = () =>
  useUpdateStore(
    useShallow((store) => ({
      isVisible: store.isNotificationVisible,
      availableVersion: store.state.availableVersion,
      releaseNotes: store.state.releaseNotes
    }))
  )

// Use shallow equality check to prevent unnecessary re-renders
// This ensures the actions object is stable across renders
export const useUpdateActions = () =>
  useUpdateStore(
    useShallow((store) => ({
      checkForUpdates: store.checkForUpdates,
      downloadUpdate: store.downloadUpdate,
      installUpdate: store.installUpdate,
      rollback: store.rollback,
      dismissNotification: store.dismissNotification,
      setState: store.setState,
      setNotificationVisible: store.setNotificationVisible,
      fetchRollbackInfo: store.fetchRollbackInfo
    }))
  )
