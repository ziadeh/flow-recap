/**
 * useToast Hook
 *
 * Provides a convenient interface for showing toast notifications
 * with support for graceful error recovery and actionable suggestions.
 */

import { useCallback } from 'react'
import { useToastStore, ToastOptions } from '@/stores'

export interface UseToastReturn {
  // Basic toast methods
  success: (title: string, message?: string, options?: Partial<ToastOptions>) => string
  error: (title: string, message?: string, options?: Partial<ToastOptions>) => string
  warning: (title: string, message?: string, options?: Partial<ToastOptions>) => string
  info: (title: string, message?: string, options?: Partial<ToastOptions>) => string

  // Specialized methods for common scenarios
  showError: (error: Error | string, actionableSuggestion?: string) => string
  showSuccess: (operation: string) => string
  showRecoveryError: (
    error: Error | string,
    retryAction?: () => void,
    retryLabel?: string
  ) => string

  // Utility methods
  dismiss: (id: string) => void
  dismissAll: () => void
}

/**
 * Hook for showing toast notifications
 *
 * @example
 * ```tsx
 * const { success, error, showRecoveryError } = useToast()
 *
 * // Simple success notification
 * success('Meeting saved')
 *
 * // Error with retry action
 * showRecoveryError(error, handleRetry, 'Retry')
 * ```
 */
export function useToast(): UseToastReturn {
  const store = useToastStore()

  const success = useCallback(
    (title: string, message?: string, options?: Partial<ToastOptions>) => {
      return store.success(title, message, options)
    },
    [store]
  )

  const error = useCallback(
    (title: string, message?: string, options?: Partial<ToastOptions>) => {
      return store.error(title, message, options)
    },
    [store]
  )

  const warning = useCallback(
    (title: string, message?: string, options?: Partial<ToastOptions>) => {
      return store.warning(title, message, options)
    },
    [store]
  )

  const info = useCallback(
    (title: string, message?: string, options?: Partial<ToastOptions>) => {
      return store.info(title, message, options)
    },
    [store]
  )

  /**
   * Show an error toast with a helpful message
   */
  const showError = useCallback(
    (err: Error | string, actionableSuggestion?: string): string => {
      const errorMessage = err instanceof Error ? err.message : err
      const message = actionableSuggestion
        ? `${errorMessage}. ${actionableSuggestion}`
        : errorMessage

      return store.error('Error', message)
    },
    [store]
  )

  /**
   * Show a success toast for a completed operation
   */
  const showSuccess = useCallback(
    (operation: string): string => {
      return store.success('Success', `${operation} completed successfully`)
    },
    [store]
  )

  /**
   * Show an error toast with a recovery action
   */
  const showRecoveryError = useCallback(
    (
      err: Error | string,
      retryAction?: () => void,
      retryLabel: string = 'Try Again'
    ): string => {
      const errorMessage = err instanceof Error ? err.message : err

      return store.error('Something went wrong', errorMessage, {
        duration: 0, // Persistent until dismissed
        action: retryAction
          ? {
              label: retryLabel,
              onClick: retryAction
            }
          : undefined
      })
    },
    [store]
  )

  const dismiss = useCallback(
    (id: string) => {
      store.removeToast(id)
    },
    [store]
  )

  const dismissAll = useCallback(() => {
    store.clearAllToasts()
  }, [store])

  return {
    success,
    error,
    warning,
    info,
    showError,
    showSuccess,
    showRecoveryError,
    dismiss,
    dismissAll
  }
}

export default useToast
