/**
 * useKeyboardShortcuts Hook
 *
 * Provides global keyboard shortcut handling for the application.
 * Integrates with the keyboard shortcuts store and handles all configured shortcuts.
 */

import { useEffect, useCallback, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { useKeyboardShortcutsStore } from '../stores/keyboard-shortcuts-store'
import { useRecordingStore } from '../stores/recording-store'
import { matchesShortcut, type ShortcutAction } from '../types/keyboard'

interface UseKeyboardShortcutsOptions {
  /** Callback when a new task should be created */
  onCreateTask?: () => void
  /** Callback when global search should open */
  onGlobalSearch?: () => void
  /** Callback when sidebar should toggle */
  onToggleSidebar?: () => void
  /** Callback when new meeting modal should open */
  onNewMeeting?: () => void
}

export function useKeyboardShortcuts(options: UseKeyboardShortcutsOptions = {}) {
  const navigate = useNavigate()

  const {
    shortcuts,
    globalEnabled,
    isLoading,
    openHelpModal,
    initialize,
  } = useKeyboardShortcutsStore()

  const { status: recordingStatus } = useRecordingStore()

  // Store options in a ref to avoid re-registering listeners when callbacks change
  const optionsRef = useRef(options)
  optionsRef.current = options

  // Initialize shortcuts on mount
  useEffect(() => {
    initialize()
  }, [initialize])

  // Handle shortcut actions
  const handleShortcutAction = useCallback(async (action: ShortcutAction) => {
    switch (action) {
      case 'startStopRecording':
        // Toggle recording
        if (recordingStatus === 'recording') {
          try {
            await window.electronAPI?.recording?.stop()
          } catch (error) {
            console.error('Failed to stop recording:', error)
          }
        } else if (recordingStatus === 'idle') {
          // Navigate to meetings to start a new recording
          navigate('/meetings')
        }
        break

      case 'navigateDashboard':
        navigate('/')
        break

      case 'navigateMeetings':
        navigate('/meetings')
        break

      case 'navigateTasks':
        navigate('/tasks')
        break

      case 'navigateSettings':
        navigate('/settings')
        break

      case 'createTask':
        optionsRef.current.onCreateTask?.()
        break

      case 'globalSearch':
        optionsRef.current.onGlobalSearch?.()
        break

      case 'toggleSidebar':
        optionsRef.current.onToggleSidebar?.()
        break

      case 'newMeeting':
        optionsRef.current.onNewMeeting?.()
        break

      case 'showShortcuts':
        openHelpModal()
        break

      default:
        console.warn(`Unknown shortcut action: ${action}`)
    }
  }, [navigate, recordingStatus, openHelpModal])

  // Global keyboard event handler
  useEffect(() => {
    if (isLoading || !globalEnabled) return

    const handleKeyDown = (event: KeyboardEvent) => {
      // Don't trigger shortcuts when typing in inputs, textareas, or contenteditable elements
      const target = event.target as HTMLElement
      const isInputElement =
        target.tagName === 'INPUT' ||
        target.tagName === 'TEXTAREA' ||
        target.isContentEditable ||
        target.getAttribute('role') === 'textbox'

      // Allow some shortcuts even in input fields (like Escape)
      const allowInInputs = ['showShortcuts']

      // Check each shortcut
      for (const [action, shortcut] of Object.entries(shortcuts)) {
        if (matchesShortcut(event, shortcut)) {
          // Skip if in input and this shortcut isn't allowed in inputs
          if (isInputElement && !allowInInputs.includes(action)) {
            continue
          }

          event.preventDefault()
          event.stopPropagation()
          handleShortcutAction(action as ShortcutAction)
          return
        }
      }
    }

    window.addEventListener('keydown', handleKeyDown, { capture: true })

    return () => {
      window.removeEventListener('keydown', handleKeyDown, { capture: true })
    }
  }, [shortcuts, globalEnabled, isLoading, handleShortcutAction])

  return {
    shortcuts,
    globalEnabled,
    isLoading,
  }
}

/**
 * Hook for registering a single shortcut action handler
 * Useful when a component only needs to handle one specific action
 */
export function useShortcutAction(
  action: ShortcutAction,
  handler: () => void,
  enabled = true
) {
  const { shortcuts, globalEnabled } = useKeyboardShortcutsStore()
  const handlerRef = useRef(handler)
  handlerRef.current = handler

  useEffect(() => {
    if (!enabled || !globalEnabled) return

    const shortcut = shortcuts[action]
    if (!shortcut?.enabled) return

    const handleKeyDown = (event: KeyboardEvent) => {
      // Don't trigger in inputs
      const target = event.target as HTMLElement
      if (
        target.tagName === 'INPUT' ||
        target.tagName === 'TEXTAREA' ||
        target.isContentEditable
      ) {
        return
      }

      if (matchesShortcut(event, shortcut)) {
        event.preventDefault()
        handlerRef.current()
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [action, enabled, shortcuts, globalEnabled])
}

export default useKeyboardShortcuts
