/**
 * useRecording Hook
 *
 * Manages recording operations and syncs state with backend via IPC
 * Includes toast notifications for success/error states
 *
 * Performance optimizations:
 * - Audio level updates throttled to 100ms (10 updates/sec) to reduce React re-renders
 * - Audio health updates throttled to 300ms for non-critical status changes
 */

import { useEffect, useCallback } from 'react'
import { useRecordingStore, type AudioHealthStatus } from '@/stores/recording-store'
import { useToastStore } from '@/stores/toast-store'
import { useThrottledCallback } from './useThrottledCallback'

// Throttle intervals for high-frequency IPC events
const AUDIO_LEVEL_THROTTLE_MS = 100 // 10 updates per second for smooth visual feedback
const AUDIO_HEALTH_THROTTLE_MS = 300 // Health status doesn't need frequent updates

// Extended type for recording result with optional device info
interface ExtendedStartRecordingResult {
  success: boolean
  meetingId: string | null
  startTime: number
  audioFilePath: string
  deviceUsed?: string
  warning?: string
  sampleRateUsed?: number // Actual sample rate used for recording (may differ from configured)
  sampleRateConfigured?: number // Sample rate that was configured in settings
}

export function useRecording() {
  const {
    status,
    meetingId,
    startTime,
    duration,
    audioLevel,
    deviceUsed,
    deviceWarning,
    audioHealth,
    setStatus,
    setStartTime,
    setDuration,
    setAudioLevel,
    setAudioHealth,
    updateState,
    reset
  } = useRecordingStore()

  // Toast notifications for user feedback
  const toast = useToastStore()

  // Sync state with backend on mount and periodically
  // Only perform initial sync - don't poll unless actively recording
  useEffect(() => {
    let isMounted = true
    let interval: ReturnType<typeof setInterval> | null = null

    const syncStatus = async () => {
      try {
        if (window.electronAPI?.recording && isMounted) {
          const backendState = await window.electronAPI.recording.getStatus()
          if (isMounted) {
            updateState({
              status: backendState.status,
              meetingId: backendState.meetingId,
              startTime: backendState.startTime,
              duration: backendState.duration,
              audioFilePath: backendState.audioFilePath
            })
          }
        }
      } catch (error) {
        console.error('Failed to sync recording status:', error)
      }
    }

    // Only sync on mount if we're actively recording/paused
    // This prevents unnecessary IPC calls when idle
    if (status === 'recording' || status === 'paused') {
      // Defer initial sync to avoid blocking initial render
      // Use requestIdleCallback if available, otherwise use setTimeout
      const deferredSync = () => {
        if ('requestIdleCallback' in window) {
          (window as any).requestIdleCallback(() => {
            if (isMounted) syncStatus()
          }, { timeout: 500 })
        } else {
          setTimeout(() => {
            if (isMounted) syncStatus()
          }, 50)
        }
      }

      deferredSync()

      // Sync periodically when recording
      interval = setInterval(() => {
        if (status === 'recording' || status === 'paused') {
          syncStatus()
        }
      }, 1000) // Sync every second
    } else {
      // When idle, do a single lightweight sync but don't poll
      const deferredSync = () => {
        if ('requestIdleCallback' in window) {
          (window as any).requestIdleCallback(() => {
            if (isMounted) syncStatus()
          }, { timeout: 2000 }) // Much longer timeout when idle
        } else {
          setTimeout(() => {
            if (isMounted) syncStatus()
          }, 500) // Longer delay when idle
        }
      }
      deferredSync()
    }

    return () => {
      isMounted = false
      if (interval) clearInterval(interval)
    }
  }, [status, updateState])

  // Update duration in real-time when recording
  useEffect(() => {
    if (status === 'recording' && startTime) {
      const interval = setInterval(() => {
        const currentDuration = Date.now() - startTime
        setDuration(currentDuration)
      }, 100) // Update every 100ms for smooth display
      return () => clearInterval(interval)
    }
  }, [status, startTime, setDuration])

  // Throttled audio level handler to reduce React re-renders
  // Audio level events can fire 60+ times per second; throttle to 10/sec for smooth UI
  const throttledSetAudioLevel = useThrottledCallback(
    (level: number) => {
      setAudioLevel(level)
    },
    AUDIO_LEVEL_THROTTLE_MS,
    { leading: true, trailing: true }
  )

  // Listen for real-time audio level updates from Electron
  useEffect(() => {
    if (!window.electronAPI?.recording?.onAudioLevel) {
      return
    }

    const unsubscribe = window.electronAPI.recording.onAudioLevel(({ level }) => {
      throttledSetAudioLevel(level)
    })

    return () => {
      unsubscribe?.()
    }
  }, [throttledSetAudioLevel])

  // Reset audio level when recording stops
  useEffect(() => {
    if (status === 'idle') {
      setAudioLevel(0)
    }
  }, [status, setAudioLevel])

  // Throttled audio health handler for non-critical status updates
  const throttledSetAudioHealth = useThrottledCallback(
    (data: { status: AudioHealthStatus; message: string | null; code?: string }) => {
      setAudioHealth({
        status: data.status,
        message: data.message,
        code: data.code
      })
    },
    AUDIO_HEALTH_THROTTLE_MS,
    { leading: true, trailing: true }
  )

  // Listen for audio health status updates from Electron
  useEffect(() => {
    if (!window.electronAPI?.recording?.onAudioHealth) {
      return
    }

    const unsubscribe = window.electronAPI.recording.onAudioHealth((data) => {
      throttledSetAudioHealth(data)
    })

    return () => {
      unsubscribe?.()
    }
  }, [throttledSetAudioHealth])

  // Reset audio health when recording stops
  useEffect(() => {
    if (status === 'idle') {
      setAudioHealth({ status: null, message: null })
    }
  }, [status, setAudioHealth])

  const startRecording = useCallback(
    async (meetingIdParam?: string) => {
      try {
        if (!window.electronAPI?.recording) {
          const errorMsg = 'Recording API not available. Please restart the application.'
          console.error(errorMsg)
          toast.error('Recording Failed', errorMsg)
          // Don't throw - return error result instead to prevent crash
          return {
            success: false,
            meetingId: null,
            startTime: Date.now(),
            audioFilePath: '',
            error: errorMsg
          }
        }

        // Ensure ML modules are preloaded before starting recording
        // This is a just-in-time check - if preloading already completed in background, this returns immediately
        // If not, it triggers preloading and continues (non-blocking for the recording itself)
        const mlPreloader = (window.electronAPI as any)?.mlPreloader
        if (mlPreloader) {
          mlPreloader.isReady().then((isReady: boolean) => {
            if (!isReady) {
              console.log('[Recording] ML modules not preloaded yet, triggering just-in-time preload')
              mlPreloader.startPreload().catch((err: Error) => {
                console.warn('[Recording] Just-in-time ML preload error (non-critical):', err)
              })
            }
          }).catch(() => {
            // Ignore errors - preloading is best-effort
          })
        }

        const result = await window.electronAPI.recording.start(meetingIdParam) as ExtendedStartRecordingResult
        if (result.success) {
          updateState({
            status: 'recording',
            meetingId: result.meetingId,
            startTime: result.startTime,
            duration: 0,
            audioFilePath: result.audioFilePath,
            deviceUsed: result.deviceUsed || null,
            deviceWarning: result.warning || null
          })

          // Show success toast
          toast.success('Recording Started', 'Your meeting is now being recorded')

          // Log warning if there was a device fallback
          if (result.warning) {
            console.warn('Recording started with warning:', result.warning)
            toast.warning('Audio Device Notice', result.warning)
          }
        } else {
          // Recording failed to start - log but don't crash
          console.error('Recording failed to start:', result)
          toast.error('Recording Failed', 'Unable to start recording. Please check your audio settings.')
        }
        return result
      } catch (error) {
        console.error('Failed to start recording:', error)
        const errorMsg = error instanceof Error ? error.message : 'Unknown error starting recording'
        toast.error('Recording Failed', errorMsg)
        // Return error result instead of throwing to prevent app crash
        return {
          success: false,
          meetingId: null,
          startTime: Date.now(),
          audioFilePath: '',
          error: errorMsg
        }
      }
    },
    [updateState, toast]
  )

  const stopRecording = useCallback(async () => {
    try {
      if (!window.electronAPI?.recording) {
        console.error('Recording API not available')
        toast.error('Recording Error', 'Recording API not available')
        setStatus('idle')
        reset()
        return {
          success: false,
          meetingId: null,
          duration: 0,
          audioFilePath: null,
          error: 'Recording API not available'
        }
      }

      setStatus('stopping')
      const result = await window.electronAPI.recording.stop()
      if (result.success) {
        reset()
        toast.success('Recording Saved', 'Your recording has been saved successfully')
      } else {
        // If the backend returned an error, log it and reset state
        const errorMessage = (result as { error?: string }).error || 'Failed to stop recording'
        console.error('Stop recording error:', errorMessage)
        toast.error('Recording Error', errorMessage)
        setStatus('idle')
      }
      return result
    } catch (error) {
      console.error('Failed to stop recording:', error)
      const errorMsg = error instanceof Error ? error.message : 'Unknown error stopping recording'
      toast.error('Recording Error', errorMsg)
      setStatus('idle')
      reset()
      return {
        success: false,
        meetingId: null,
        duration: 0,
        audioFilePath: null,
        error: errorMsg
      }
    }
  }, [setStatus, reset, toast])

  const pauseRecording = useCallback(async () => {
    try {
      if (!window.electronAPI?.recording) {
        console.error('Recording API not available')
        toast.error('Recording Error', 'Recording API not available')
        return { success: false, duration: 0, error: 'Recording API not available' }
      }

      const result = await window.electronAPI.recording.pause()
      if (result.success) {
        setStatus('paused')
        setDuration(result.duration)
        toast.info('Recording Paused', 'Recording has been paused')
      } else {
        console.error('Failed to pause recording:', result)
        toast.error('Pause Failed', 'Unable to pause recording')
      }
      return result
    } catch (error) {
      console.error('Failed to pause recording:', error)
      const errorMsg = error instanceof Error ? error.message : 'Unknown error pausing recording'
      toast.error('Pause Failed', errorMsg)
      return {
        success: false,
        duration: 0,
        error: errorMsg
      }
    }
  }, [setStatus, setDuration, toast])

  const resumeRecording = useCallback(async () => {
    try {
      if (!window.electronAPI?.recording) {
        console.error('Recording API not available')
        toast.error('Recording Error', 'Recording API not available')
        return { success: false, startTime: 0, error: 'Recording API not available' }
      }

      const result = await window.electronAPI.recording.resume()
      if (result.success) {
        setStatus('recording')
        setStartTime(result.startTime)
        toast.success('Recording Resumed', 'Recording has resumed')
      } else {
        console.error('Failed to resume recording:', result)
        toast.error('Resume Failed', 'Unable to resume recording')
      }
      return result
    } catch (error) {
      console.error('Failed to resume recording:', error)
      const errorMsg = error instanceof Error ? error.message : 'Unknown error resuming recording'
      toast.error('Resume Failed', errorMsg)
      return {
        success: false,
        startTime: 0,
        error: errorMsg
      }
    }
  }, [setStatus, setStartTime, toast])

  return {
    // State
    status,
    meetingId,
    startTime,
    duration,
    audioLevel,
    deviceUsed,
    deviceWarning,
    audioHealth,
    // Actions
    startRecording,
    stopRecording,
    pauseRecording,
    resumeRecording
  }
}
