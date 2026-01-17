/**
 * Stores Index
 *
 * Central export point for all Zustand stores
 */

export { useRecordingStore } from './recording-store'
export { useMeetingStore } from './meeting-store'
export { useSettingsStore } from './settings-store'
export {
  useLiveTranscriptStore,
  useLiveTranscriptStatus,
  useLiveTranscriptSegments,
  useLiveTranscriptError,
  useIsLiveTranscriptActive
} from './live-transcript-store'
export type {
  LiveTranscriptStatus,
  LiveTranscriptSegment,
  LiveTranscriptError,
  TranscriptionProgress
} from './live-transcript-store'
export { useTaskFilterStore, DEFAULT_TASK_FILTERS } from './task-filter-store'
export type { TaskFilters } from './task-filter-store'
export { useThemeStore, setupSystemThemeListener } from './theme-store'
export type { Theme, ResolvedTheme } from './theme-store'
export {
  useKeyboardShortcutsStore,
  useShortcut,
  useShortcutsEnabled,
  useIsHelpModalOpen,
} from './keyboard-shortcuts-store'
export {
  useToastStore,
  useToasts,
  useToastActions
} from './toast-store'
export type { Toast, ToastType, ToastOptions } from './toast-store'
export {
  useUpdateStore,
  useUpdateState,
  useUpdateStatus,
  useUpdateProgress,
  useUpdateNotification,
  useUpdateActions
} from './update-store'
export type { UpdateStatus, UpdateState, RollbackInfo } from './update-store'
