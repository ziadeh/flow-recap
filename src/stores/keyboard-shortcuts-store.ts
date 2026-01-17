/**
 * Keyboard Shortcuts Store
 *
 * Manages global state for keyboard shortcuts configuration
 * Persists user customizations to the database
 */

import { create } from 'zustand'
import {
  type KeyboardShortcut,
  type ShortcutAction,
  DEFAULT_SHORTCUTS,
} from '../types/keyboard'

interface KeyboardShortcutsState {
  /** All configured shortcuts */
  shortcuts: Record<ShortcutAction, KeyboardShortcut>
  /** Whether keyboard shortcuts are globally enabled */
  globalEnabled: boolean
  /** Whether the shortcuts help modal is open */
  isHelpModalOpen: boolean
  /** Loading state for initial load */
  isLoading: boolean
}

interface KeyboardShortcutsActions {
  /** Initialize shortcuts from database */
  initialize: () => Promise<void>
  /** Update a single shortcut */
  updateShortcut: (action: ShortcutAction, updates: Partial<KeyboardShortcut>) => Promise<void>
  /** Reset a single shortcut to default */
  resetShortcut: (action: ShortcutAction) => Promise<void>
  /** Reset all shortcuts to defaults */
  resetAllShortcuts: () => Promise<void>
  /** Toggle global shortcuts on/off */
  setGlobalEnabled: (enabled: boolean) => Promise<void>
  /** Toggle a specific shortcut on/off */
  toggleShortcut: (action: ShortcutAction) => Promise<void>
  /** Open the shortcuts help modal */
  openHelpModal: () => void
  /** Close the shortcuts help modal */
  closeHelpModal: () => void
  /** Get shortcut by action */
  getShortcut: (action: ShortcutAction) => KeyboardShortcut
}

type KeyboardShortcutsStore = KeyboardShortcutsState & KeyboardShortcutsActions

const STORAGE_KEY = 'keyboard.shortcuts'
const GLOBAL_ENABLED_KEY = 'keyboard.shortcuts.globalEnabled'

export const useKeyboardShortcutsStore = create<KeyboardShortcutsStore>((set, get) => ({
  shortcuts: { ...DEFAULT_SHORTCUTS },
  globalEnabled: true,
  isHelpModalOpen: false,
  isLoading: true,

  initialize: async () => {
    try {
      // Load shortcuts from database
      const savedShortcuts = await window.electronAPI?.db?.settings?.get<Record<ShortcutAction, KeyboardShortcut>>(STORAGE_KEY)
      const globalEnabled = await window.electronAPI?.db?.settings?.get<boolean>(GLOBAL_ENABLED_KEY)

      if (savedShortcuts) {
        // Merge saved shortcuts with defaults (in case new shortcuts were added)
        const mergedShortcuts = { ...DEFAULT_SHORTCUTS }
        for (const [action, shortcut] of Object.entries(savedShortcuts)) {
          if (action in mergedShortcuts) {
            mergedShortcuts[action as ShortcutAction] = {
              ...mergedShortcuts[action as ShortcutAction],
              ...shortcut,
            }
          }
        }
        set({ shortcuts: mergedShortcuts })
      }

      if (globalEnabled !== null) {
        set({ globalEnabled })
      }
    } catch (error) {
      console.error('Failed to load keyboard shortcuts:', error)
    } finally {
      set({ isLoading: false })
    }
  },

  updateShortcut: async (action: ShortcutAction, updates: Partial<KeyboardShortcut>) => {
    const { shortcuts } = get()
    const updatedShortcut = {
      ...shortcuts[action],
      ...updates,
    }

    const updatedShortcuts = {
      ...shortcuts,
      [action]: updatedShortcut,
    }

    set({ shortcuts: updatedShortcuts })

    // Persist to database
    try {
      await window.electronAPI?.db?.settings?.set(STORAGE_KEY, updatedShortcuts, 'general')
    } catch (error) {
      console.error('Failed to save keyboard shortcut:', error)
    }
  },

  resetShortcut: async (action: ShortcutAction) => {
    const { shortcuts } = get()
    const defaultShortcut = DEFAULT_SHORTCUTS[action]

    const updatedShortcuts = {
      ...shortcuts,
      [action]: defaultShortcut,
    }

    set({ shortcuts: updatedShortcuts })

    // Persist to database
    try {
      await window.electronAPI?.db?.settings?.set(STORAGE_KEY, updatedShortcuts, 'general')
    } catch (error) {
      console.error('Failed to reset keyboard shortcut:', error)
    }
  },

  resetAllShortcuts: async () => {
    set({ shortcuts: { ...DEFAULT_SHORTCUTS } })

    // Persist to database
    try {
      await window.electronAPI?.db?.settings?.set(STORAGE_KEY, DEFAULT_SHORTCUTS, 'general')
    } catch (error) {
      console.error('Failed to reset all keyboard shortcuts:', error)
    }
  },

  setGlobalEnabled: async (enabled: boolean) => {
    set({ globalEnabled: enabled })

    // Persist to database
    try {
      await window.electronAPI?.db?.settings?.set(GLOBAL_ENABLED_KEY, enabled, 'general')
    } catch (error) {
      console.error('Failed to save global shortcuts setting:', error)
    }
  },

  toggleShortcut: async (action: ShortcutAction) => {
    const { shortcuts } = get()
    const currentShortcut = shortcuts[action]

    await get().updateShortcut(action, { enabled: !currentShortcut.enabled })
  },

  openHelpModal: () => {
    set({ isHelpModalOpen: true })
  },

  closeHelpModal: () => {
    set({ isHelpModalOpen: false })
  },

  getShortcut: (action: ShortcutAction) => {
    return get().shortcuts[action]
  },
}))

// Selector hooks for specific parts of the state
export const useShortcut = (action: ShortcutAction) =>
  useKeyboardShortcutsStore((state) => state.shortcuts[action])

export const useShortcutsEnabled = () =>
  useKeyboardShortcutsStore((state) => state.globalEnabled)

export const useIsHelpModalOpen = () =>
  useKeyboardShortcutsStore((state) => state.isHelpModalOpen)
