import { useRef, useCallback, useEffect } from 'react'

/**
 * A custom hook that returns a debounced version of the callback.
 * The debounced function will wait for the specified delay after the last call
 * before executing, consolidating multiple rapid calls into a single execution.
 *
 * This is particularly useful for preventing redundant data fetches when multiple
 * events fire in quick succession (e.g., diarization complete, transcripts update,
 * tasks update, etc.).
 *
 * @param callback - The function to debounce
 * @param delay - The delay in milliseconds to wait before executing
 * @returns A debounced version of the callback
 *
 * @example
 * const { refetch } = useMeetingDetail(id)
 * const debouncedRefetch = useDebouncedCallback(refetch, 1000)
 *
 * // Multiple rapid calls will be consolidated into a single execution
 * debouncedRefetch() // Called but will wait
 * debouncedRefetch() // Cancels previous, starts new wait
 * debouncedRefetch() // Cancels previous, starts new wait
 * // Only one refetch() will execute after 1000ms
 */
export function useDebouncedCallback<T extends (...args: any[]) => any>(
  callback: T,
  delay: number
): (...args: Parameters<T>) => void {
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const callbackRef = useRef(callback)

  // Keep callback ref updated to avoid stale closures
  useEffect(() => {
    callbackRef.current = callback
  }, [callback])

  // Cleanup timeout on unmount
  useEffect(() => {
    return () => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current)
      }
    }
  }, [])

  const debouncedCallback = useCallback(
    (...args: Parameters<T>) => {
      // Clear any existing timeout
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current)
      }

      // Set new timeout
      timeoutRef.current = setTimeout(() => {
        callbackRef.current(...args)
        timeoutRef.current = null
      }, delay)
    },
    [delay]
  )

  return debouncedCallback
}

/**
 * Cancel function type for the debounced callback with cancel support
 */
export interface DebouncedCallbackWithCancel<T extends (...args: any[]) => any> {
  (...args: Parameters<T>): void
  cancel: () => void
  flush: () => void
}

/**
 * Enhanced version of useDebouncedCallback that provides cancel and flush methods.
 *
 * @param callback - The function to debounce
 * @param delay - The delay in milliseconds to wait before executing
 * @returns A debounced function with cancel() and flush() methods
 *
 * @example
 * const debouncedRefetch = useDebouncedCallbackWithCancel(refetch, 1000)
 *
 * debouncedRefetch() // Schedule execution
 * debouncedRefetch.cancel() // Cancel pending execution
 * debouncedRefetch.flush() // Execute immediately if pending
 */
export function useDebouncedCallbackWithCancel<T extends (...args: any[]) => any>(
  callback: T,
  delay: number
): DebouncedCallbackWithCancel<T> {
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const callbackRef = useRef(callback)
  const pendingArgsRef = useRef<Parameters<T> | null>(null)

  // Keep callback ref updated to avoid stale closures
  useEffect(() => {
    callbackRef.current = callback
  }, [callback])

  // Cleanup timeout on unmount
  useEffect(() => {
    return () => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current)
      }
    }
  }, [])

  const cancel = useCallback(() => {
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current)
      timeoutRef.current = null
    }
    pendingArgsRef.current = null
  }, [])

  const flush = useCallback(() => {
    if (timeoutRef.current && pendingArgsRef.current) {
      clearTimeout(timeoutRef.current)
      timeoutRef.current = null
      callbackRef.current(...pendingArgsRef.current)
      pendingArgsRef.current = null
    }
  }, [])

  const debouncedCallback = useCallback(
    (...args: Parameters<T>) => {
      // Clear any existing timeout
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current)
      }

      // Store args for potential flush
      pendingArgsRef.current = args

      // Set new timeout
      timeoutRef.current = setTimeout(() => {
        callbackRef.current(...args)
        timeoutRef.current = null
        pendingArgsRef.current = null
      }, delay)
    },
    [delay]
  ) as DebouncedCallbackWithCancel<T>

  // Attach cancel and flush methods
  debouncedCallback.cancel = cancel
  debouncedCallback.flush = flush

  return debouncedCallback
}
