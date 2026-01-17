import { useRef, useCallback, useEffect } from 'react'

/**
 * A custom hook that returns a throttled version of the callback.
 * The throttled function will execute at most once per specified interval,
 * ensuring a maximum rate of execution while still processing the latest data.
 *
 * This is particularly useful for high-frequency IPC events like:
 * - Audio level updates (onAudioLevel)
 * - Speaker changes (onSpeakerChange)
 * - Transcript segments (onTranscriptSegment)
 * - Live notes (onLiveNotes)
 *
 * Unlike debounce which waits for inactivity, throttle ensures regular
 * updates at a controlled rate - maintaining perceived real-time responsiveness
 * while preventing React re-render flooding.
 *
 * @param callback - The function to throttle
 * @param interval - The minimum interval in milliseconds between executions
 * @param options - Optional configuration
 * @returns A throttled version of the callback
 *
 * @example
 * const throttledAudioLevel = useThrottledCallback(
 *   (level) => setAudioLevel(level),
 *   100 // Update at most every 100ms (10 updates/sec)
 * )
 */
export interface ThrottleOptions {
  /** Execute immediately on first call (default: true) */
  leading?: boolean
  /** Execute on the trailing edge after the interval (default: true) */
  trailing?: boolean
}

export function useThrottledCallback<T extends (...args: any[]) => any>(
  callback: T,
  interval: number,
  options: ThrottleOptions = {}
): (...args: Parameters<T>) => void {
  const { leading = true, trailing = true } = options

  const lastExecutionRef = useRef<number>(0)
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const lastArgsRef = useRef<Parameters<T> | null>(null)
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

  const throttledCallback = useCallback(
    (...args: Parameters<T>) => {
      const now = Date.now()
      const elapsed = now - lastExecutionRef.current

      // Store the latest args for trailing edge execution
      lastArgsRef.current = args

      // Clear any pending trailing execution
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current)
        timeoutRef.current = null
      }

      // Execute immediately if enough time has passed (or first call with leading: true)
      if (elapsed >= interval) {
        if (leading || lastExecutionRef.current > 0) {
          lastExecutionRef.current = now
          callbackRef.current(...args)
          lastArgsRef.current = null
        } else {
          // First call but leading is false, schedule trailing
          lastExecutionRef.current = now
        }
      }

      // Schedule trailing edge execution
      if (trailing && lastArgsRef.current) {
        const remaining = interval - elapsed
        timeoutRef.current = setTimeout(() => {
          if (lastArgsRef.current) {
            lastExecutionRef.current = Date.now()
            callbackRef.current(...lastArgsRef.current)
            lastArgsRef.current = null
          }
          timeoutRef.current = null
        }, Math.max(remaining, 0))
      }
    },
    [interval, leading, trailing]
  )

  return throttledCallback
}

/**
 * Cancel function type for the throttled callback with cancel support
 */
export interface ThrottledCallbackWithCancel<T extends (...args: any[]) => any> {
  (...args: Parameters<T>): void
  cancel: () => void
  flush: () => void
}

/**
 * Enhanced version of useThrottledCallback that provides cancel and flush methods.
 *
 * @param callback - The function to throttle
 * @param interval - The minimum interval in milliseconds between executions
 * @param options - Optional configuration
 * @returns A throttled function with cancel() and flush() methods
 *
 * @example
 * const throttledUpdate = useThrottledCallbackWithCancel(
 *   (data) => processData(data),
 *   200
 * )
 *
 * throttledUpdate(newData) // Schedule throttled execution
 * throttledUpdate.cancel() // Cancel pending execution
 * throttledUpdate.flush() // Execute immediately if pending
 */
export function useThrottledCallbackWithCancel<T extends (...args: any[]) => any>(
  callback: T,
  interval: number,
  options: ThrottleOptions = {}
): ThrottledCallbackWithCancel<T> {
  const { leading = true, trailing = true } = options

  const lastExecutionRef = useRef<number>(0)
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const lastArgsRef = useRef<Parameters<T> | null>(null)
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

  const cancel = useCallback(() => {
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current)
      timeoutRef.current = null
    }
    lastArgsRef.current = null
  }, [])

  const flush = useCallback(() => {
    if (timeoutRef.current && lastArgsRef.current) {
      clearTimeout(timeoutRef.current)
      timeoutRef.current = null
      lastExecutionRef.current = Date.now()
      callbackRef.current(...lastArgsRef.current)
      lastArgsRef.current = null
    }
  }, [])

  const throttledCallback = useCallback(
    (...args: Parameters<T>) => {
      const now = Date.now()
      const elapsed = now - lastExecutionRef.current

      // Store the latest args for trailing edge execution
      lastArgsRef.current = args

      // Clear any pending trailing execution
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current)
        timeoutRef.current = null
      }

      // Execute immediately if enough time has passed
      if (elapsed >= interval) {
        if (leading || lastExecutionRef.current > 0) {
          lastExecutionRef.current = now
          callbackRef.current(...args)
          lastArgsRef.current = null
        } else {
          lastExecutionRef.current = now
        }
      }

      // Schedule trailing edge execution
      if (trailing && lastArgsRef.current) {
        const remaining = interval - elapsed
        timeoutRef.current = setTimeout(() => {
          if (lastArgsRef.current) {
            lastExecutionRef.current = Date.now()
            callbackRef.current(...lastArgsRef.current)
            lastArgsRef.current = null
          }
          timeoutRef.current = null
        }, Math.max(remaining, 0))
      }
    },
    [interval, leading, trailing]
  ) as ThrottledCallbackWithCancel<T>

  // Attach cancel and flush methods
  throttledCallback.cancel = cancel
  throttledCallback.flush = flush

  return throttledCallback
}

/**
 * Creates a throttled event batcher that accumulates events and flushes them
 * at a controlled rate. Useful for batching multiple rapid IPC events into
 * single UI updates.
 *
 * @param callback - The function to call with batched items
 * @param interval - The flush interval in milliseconds
 * @returns Object with add() to queue items and flush() to force immediate processing
 *
 * @example
 * const batcher = useEventBatcher<AudioLevelEvent>(
 *   (events) => {
 *     // Process batch - maybe use average or latest value
 *     const latest = events[events.length - 1]
 *     setAudioLevel(latest.level)
 *   },
 *   100
 * )
 *
 * // In IPC handler:
 * window.electronAPI.recording.onAudioLevel((data) => {
 *   batcher.add(data)
 * })
 */
export function useEventBatcher<T>(
  callback: (items: T[]) => void,
  interval: number
): {
  add: (item: T) => void
  flush: () => void
  clear: () => void
} {
  const batchRef = useRef<T[]>([])
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const callbackRef = useRef(callback)

  // Keep callback ref updated
  useEffect(() => {
    callbackRef.current = callback
  }, [callback])

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current)
      }
    }
  }, [])

  const flush = useCallback(() => {
    if (batchRef.current.length > 0) {
      const items = [...batchRef.current]
      batchRef.current = []
      callbackRef.current(items)
    }
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current)
      timeoutRef.current = null
    }
  }, [])

  const clear = useCallback(() => {
    batchRef.current = []
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current)
      timeoutRef.current = null
    }
  }, [])

  const add = useCallback(
    (item: T) => {
      batchRef.current.push(item)

      // Schedule flush if not already scheduled
      if (!timeoutRef.current) {
        timeoutRef.current = setTimeout(() => {
          flush()
        }, interval)
      }
    },
    [interval, flush]
  )

  return { add, flush, clear }
}

/**
 * Schedules a callback to run during browser idle time using requestIdleCallback.
 * Falls back to setTimeout if requestIdleCallback is not available.
 *
 * Useful for non-critical updates like metrics, stats, or analytics that
 * don't need to block the main thread.
 *
 * @param callback - The function to execute during idle time
 * @param timeout - Maximum time to wait before forcing execution (default: 1000ms)
 * @returns A cancel function
 *
 * @example
 * const scheduleIdleUpdate = useIdleCallback(
 *   (stats) => updateMetrics(stats),
 *   500 // Force update within 500ms if browser never idles
 * )
 *
 * // Schedule non-critical update
 * scheduleIdleUpdate(newStats)
 */
export function useIdleCallback<T extends (...args: any[]) => any>(
  callback: T,
  timeout: number = 1000
): (...args: Parameters<T>) => () => void {
  const callbackRef = useRef(callback)
  const idleCallbackIdRef = useRef<number | ReturnType<typeof setTimeout> | null>(null)

  // Keep callback ref updated
  useEffect(() => {
    callbackRef.current = callback
  }, [callback])

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (idleCallbackIdRef.current !== null) {
        if ('cancelIdleCallback' in window) {
          (window as any).cancelIdleCallback(idleCallbackIdRef.current as number)
        } else {
          clearTimeout(idleCallbackIdRef.current as ReturnType<typeof setTimeout>)
        }
      }
    }
  }, [])

  const scheduleIdle = useCallback(
    (...args: Parameters<T>): (() => void) => {
      // Cancel any pending idle callback
      if (idleCallbackIdRef.current !== null) {
        if ('cancelIdleCallback' in window) {
          (window as any).cancelIdleCallback(idleCallbackIdRef.current as number)
        } else {
          clearTimeout(idleCallbackIdRef.current as ReturnType<typeof setTimeout>)
        }
      }

      // Schedule new idle callback
      if ('requestIdleCallback' in window) {
        idleCallbackIdRef.current = (window as any).requestIdleCallback(
          () => {
            callbackRef.current(...args)
            idleCallbackIdRef.current = null
          },
          { timeout }
        )
      } else {
        // Fallback to setTimeout for browsers without requestIdleCallback
        idleCallbackIdRef.current = setTimeout(() => {
          callbackRef.current(...args)
          idleCallbackIdRef.current = null
        }, Math.min(timeout, 50)) // Use shorter delay as fallback
      }

      // Return cancel function
      return () => {
        if (idleCallbackIdRef.current !== null) {
          if ('cancelIdleCallback' in window) {
            (window as any).cancelIdleCallback(idleCallbackIdRef.current as number)
          } else {
            clearTimeout(idleCallbackIdRef.current as ReturnType<typeof setTimeout>)
          }
          idleCallbackIdRef.current = null
        }
      }
    },
    [timeout]
  )

  return scheduleIdle
}
