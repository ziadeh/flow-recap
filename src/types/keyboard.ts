/**
 * Keyboard Shortcuts Type Definitions
 *
 * Defines the structure for configurable keyboard shortcuts
 */

// Modifier keys that can be combined with shortcuts
export type ModifierKey = 'ctrl' | 'shift' | 'alt' | 'meta'

// Available actions that can be triggered by keyboard shortcuts
export type ShortcutAction =
  | 'startStopRecording'
  | 'navigateDashboard'
  | 'navigateMeetings'
  | 'navigateTasks'
  | 'navigateSettings'
  | 'createTask'
  | 'globalSearch'
  | 'toggleSidebar'
  | 'newMeeting'
  | 'showShortcuts'

// Single keyboard shortcut definition
export interface KeyboardShortcut {
  /** The action this shortcut triggers */
  action: ShortcutAction
  /** The main key (e.g., 'r', 'm', 't', '/') */
  key: string
  /** Modifier keys required (ctrl, shift, alt, meta/cmd) */
  modifiers: ModifierKey[]
  /** Human-readable description */
  description: string
  /** Whether the shortcut is currently enabled */
  enabled: boolean
  /** Category for grouping in UI */
  category: ShortcutCategory
}

// Categories for organizing shortcuts in the UI
export type ShortcutCategory = 'navigation' | 'recording' | 'tasks' | 'search' | 'general'

// Category labels for display
export const CATEGORY_LABELS: Record<ShortcutCategory, string> = {
  navigation: 'Navigation',
  recording: 'Recording',
  tasks: 'Tasks',
  search: 'Search',
  general: 'General',
}

// Category order for display
export const CATEGORY_ORDER: ShortcutCategory[] = ['navigation', 'recording', 'tasks', 'search', 'general']

// Configuration object for all shortcuts
export interface KeyboardShortcutsConfig {
  shortcuts: Record<ShortcutAction, KeyboardShortcut>
  /** Whether keyboard shortcuts are globally enabled */
  globalEnabled: boolean
}

// Default keyboard shortcuts configuration
export const DEFAULT_SHORTCUTS: Record<ShortcutAction, KeyboardShortcut> = {
  startStopRecording: {
    action: 'startStopRecording',
    key: 'r',
    modifiers: ['meta', 'shift'],
    description: 'Start/Stop Recording',
    enabled: true,
    category: 'recording',
  },
  navigateDashboard: {
    action: 'navigateDashboard',
    key: 'd',
    modifiers: ['meta'],
    description: 'Go to Dashboard',
    enabled: true,
    category: 'navigation',
  },
  navigateMeetings: {
    action: 'navigateMeetings',
    key: 'm',
    modifiers: ['meta'],
    description: 'Go to Meetings',
    enabled: true,
    category: 'navigation',
  },
  navigateTasks: {
    action: 'navigateTasks',
    key: 't',
    modifiers: ['meta'],
    description: 'Go to Tasks',
    enabled: true,
    category: 'navigation',
  },
  navigateSettings: {
    action: 'navigateSettings',
    key: ',',
    modifiers: ['meta'],
    description: 'Go to Settings',
    enabled: true,
    category: 'navigation',
  },
  createTask: {
    action: 'createTask',
    key: 'n',
    modifiers: ['meta', 'shift'],
    description: 'Create New Task',
    enabled: true,
    category: 'tasks',
  },
  globalSearch: {
    action: 'globalSearch',
    key: 'k',
    modifiers: ['meta'],
    description: 'Open Global Search',
    enabled: true,
    category: 'search',
  },
  toggleSidebar: {
    action: 'toggleSidebar',
    key: 'b',
    modifiers: ['meta'],
    description: 'Toggle Sidebar',
    enabled: true,
    category: 'general',
  },
  newMeeting: {
    action: 'newMeeting',
    key: 'n',
    modifiers: ['meta'],
    description: 'Create New Meeting',
    enabled: true,
    category: 'general',
  },
  showShortcuts: {
    action: 'showShortcuts',
    key: '/',
    modifiers: ['meta'],
    description: 'Show Keyboard Shortcuts',
    enabled: true,
    category: 'general',
  },
}

// Helper function to format a shortcut for display
export function formatShortcut(shortcut: KeyboardShortcut): string {
  const isMac = typeof navigator !== 'undefined' && navigator.platform.toUpperCase().indexOf('MAC') >= 0

  const modifierSymbols: Record<ModifierKey, string> = {
    meta: isMac ? '⌘' : 'Ctrl',
    ctrl: isMac ? '⌃' : 'Ctrl',
    alt: isMac ? '⌥' : 'Alt',
    shift: isMac ? '⇧' : 'Shift',
  }

  const parts = shortcut.modifiers.map(mod => modifierSymbols[mod])
  parts.push(shortcut.key.toUpperCase())

  return parts.join(isMac ? '' : '+')
}

// Helper to check if a keyboard event matches a shortcut
export function matchesShortcut(event: KeyboardEvent, shortcut: KeyboardShortcut): boolean {
  if (!shortcut.enabled) return false

  // Check if the key matches (case-insensitive)
  if (event.key.toLowerCase() !== shortcut.key.toLowerCase()) return false

  // Check modifiers
  const hasCtrl = event.ctrlKey
  const hasMeta = event.metaKey
  const hasAlt = event.altKey
  const hasShift = event.shiftKey

  const needsCtrl = shortcut.modifiers.includes('ctrl')
  const needsMeta = shortcut.modifiers.includes('meta')
  const needsAlt = shortcut.modifiers.includes('alt')
  const needsShift = shortcut.modifiers.includes('shift')

  // On Mac, meta is Cmd; on Windows/Linux, we treat meta as Ctrl for cross-platform shortcuts
  const isMac = typeof navigator !== 'undefined' && navigator.platform.toUpperCase().indexOf('MAC') >= 0

  if (isMac) {
    // On Mac: meta means Cmd, ctrl means Ctrl
    if (needsMeta && !hasMeta) return false
    if (!needsMeta && hasMeta) return false
    if (needsCtrl && !hasCtrl) return false
    if (!needsCtrl && hasCtrl) return false
  } else {
    // On Windows/Linux: both meta and ctrl can be treated as Ctrl
    const needsCtrlOrMeta = needsCtrl || needsMeta
    const hasCtrlOrMeta = hasCtrl || hasMeta
    if (needsCtrlOrMeta && !hasCtrlOrMeta) return false
    if (!needsCtrlOrMeta && hasCtrlOrMeta) return false
  }

  if (needsAlt && !hasAlt) return false
  if (!needsAlt && hasAlt) return false
  if (needsShift && !hasShift) return false
  if (!needsShift && hasShift) return false

  return true
}
