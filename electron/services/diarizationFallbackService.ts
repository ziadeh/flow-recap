/**
 * Diarization Fallback Service
 *
 * Implements robust fallback mechanisms when automatic speaker diarization fails.
 * Works in conjunction with DiarizationHealthMonitor to provide graceful degradation.
 *
 * Fallback Strategies:
 * 1. Silent Degradation - Continue recording without speaker labels
 * 2. Post-Meeting Recovery - Queue batch diarization after recording
 * 3. Partial Success - Preserve identified speakers, mark later as unknown
 */

import { EventEmitter } from 'events'
import { batchDiarizationService } from './batchDiarizationService'
import { getDatabaseService } from './database'
import {
  diarizationHealthMonitor,
  type DiarizationHealthEvent,
  type PostMeetingRecoveryJob,
  type DiarizationHealthStatus
} from './diarizationHealthMonitor'

// ============================================================================
// Types
// ============================================================================

/**
 * Fallback mode for handling diarization failures
 */
export type DiarizationFallbackMode =
  | 'none'                    // Diarization working normally
  | 'silent_degradation'      // Continue without speaker labels
  | 'post_meeting_recovery'   // Queue for batch processing
  | 'partial_success'         // Some speakers identified, others unknown
  | 'disabled'                // User disabled diarization

/**
 * Session state for tracking fallback behavior
 */
export interface FallbackSessionState {
  meetingId: string | null
  mode: DiarizationFallbackMode
  activeSince: number | null
  lastKnownSpeakerId: string | null
  lastKnownSpeakerTime: number | null
  segmentsSavedWithoutSpeaker: number
  recoveryQueued: boolean
  userNotified: boolean
}

/**
 * Notification to be shown to the user
 */
export interface FallbackNotification {
  type: 'warning' | 'error' | 'info' | 'success'
  title: string
  message: string
  action?: {
    label: string
    handler: string // Key to lookup action handler
  }
  dismissable: boolean
  timestamp: number
}

// ============================================================================
// Constants
// ============================================================================

const UNKNOWN_SPEAKER_ID = 'unknown'
const SPEAKER_UNAVAILABLE_MESSAGE = 'Speaker identification unavailable'

// ============================================================================
// Service State
// ============================================================================

const eventEmitter = new EventEmitter()

const sessionState: FallbackSessionState = {
  meetingId: null,
  mode: 'none',
  activeSince: null,
  lastKnownSpeakerId: null,
  lastKnownSpeakerTime: null,
  segmentsSavedWithoutSpeaker: 0,
  recoveryQueued: false,
  userNotified: false
}

let pendingNotifications: FallbackNotification[] = []

// ============================================================================
// Helper Functions
// ============================================================================

function resetSessionState(): void {
  sessionState.meetingId = null
  sessionState.mode = 'none'
  sessionState.activeSince = null
  sessionState.lastKnownSpeakerId = null
  sessionState.lastKnownSpeakerTime = null
  sessionState.segmentsSavedWithoutSpeaker = 0
  sessionState.recoveryQueued = false
  sessionState.userNotified = false
  pendingNotifications = []
}

function emitNotification(notification: FallbackNotification): void {
  pendingNotifications.push(notification)
  eventEmitter.emit('notification', notification)
}

function handleHealthChange(event: DiarizationHealthEvent): void {
  const { status, reason, message } = event

  // Handle status transitions
  switch (status) {
    case 'active':
      // Diarization recovered - clear fallback mode
      if (sessionState.mode !== 'none' && sessionState.mode !== 'disabled') {
        diarizationFallbackService.exitFallbackMode('Diarization recovered')
      }
      break

    case 'degraded':
      // Enter silent degradation if not already in fallback
      if (sessionState.mode === 'none') {
        diarizationFallbackService.enterSilentDegradation(reason, message)
      }
      break

    case 'failed':
      // Full failure - enter fallback with recovery option
      if (sessionState.mode !== 'disabled') {
        diarizationFallbackService.enterSilentDegradation(reason, message)
        diarizationFallbackService.schedulePostMeetingRecovery()
      }
      break

    case 'disabled':
      sessionState.mode = 'disabled'
      break
  }
}

// ============================================================================
// Diarization Fallback Service
// ============================================================================

export const diarizationFallbackService = {
  /**
   * Initialize the fallback service for a recording session
   */
  initialize(meetingId: string): void {
    console.log(`[DiarizationFallback] Initializing for meeting: ${meetingId}`)

    resetSessionState()
    sessionState.meetingId = meetingId

    // Subscribe to health monitor events
    diarizationHealthMonitor.onHealthChange(handleHealthChange)
  },

  /**
   * Cleanup when recording session ends
   */
  cleanup(): void {
    console.log('[DiarizationFallback] Cleaning up session')

    // Process any queued recovery before cleanup
    if (sessionState.recoveryQueued && sessionState.meetingId) {
      this.triggerPostMeetingRecovery(sessionState.meetingId)
    }

    resetSessionState()
  },

  /**
   * Enter silent degradation mode
   */
  enterSilentDegradation(reason?: string, message?: string): void {
    if (sessionState.mode === 'silent_degradation' || sessionState.mode === 'disabled') {
      return
    }

    console.log(`[DiarizationFallback] Entering silent degradation mode: ${reason || 'unknown'}`)

    sessionState.mode = 'silent_degradation'
    sessionState.activeSince = Date.now()

    // Notify user if not already notified
    if (!sessionState.userNotified) {
      sessionState.userNotified = true

      emitNotification({
        type: 'warning',
        title: SPEAKER_UNAVAILABLE_MESSAGE,
        message: message || 'Recording will continue without speaker identification. Speaker labels can be added after the recording completes.',
        action: {
          label: 'Learn More',
          handler: 'show_diarization_help'
        },
        dismissable: true,
        timestamp: Date.now()
      })
    }

    eventEmitter.emit('mode-change', sessionState.mode)
  },

  /**
   * Enter partial success mode (preserve known speakers)
   */
  enterPartialSuccessMode(): void {
    if (sessionState.mode === 'disabled') return

    console.log('[DiarizationFallback] Entering partial success mode')

    sessionState.mode = 'partial_success'
    sessionState.activeSince = Date.now()

    emitNotification({
      type: 'info',
      title: 'Speaker Identification Partial',
      message: 'Some speakers were identified before an issue occurred. Later segments may show as "Unknown Speaker".',
      dismissable: true,
      timestamp: Date.now()
    })

    eventEmitter.emit('mode-change', sessionState.mode)
  },

  /**
   * Exit fallback mode (diarization recovered)
   */
  exitFallbackMode(reason: string): void {
    console.log(`[DiarizationFallback] Exiting fallback mode: ${reason}`)

    const previousMode = sessionState.mode
    sessionState.mode = 'none'
    sessionState.activeSince = null

    if (previousMode === 'silent_degradation' || previousMode === 'partial_success') {
      emitNotification({
        type: 'success',
        title: 'Speaker Identification Restored',
        message: 'Speaker identification is now working normally.',
        dismissable: true,
        timestamp: Date.now()
      })
    }

    eventEmitter.emit('mode-change', sessionState.mode)
  },

  /**
   * Schedule post-meeting recovery
   */
  schedulePostMeetingRecovery(): void {
    if (sessionState.recoveryQueued) {
      console.log('[DiarizationFallback] Post-meeting recovery already scheduled')
      return
    }

    if (!sessionState.meetingId) {
      console.warn('[DiarizationFallback] Cannot schedule recovery: no meeting ID')
      return
    }

    console.log(`[DiarizationFallback] Scheduling post-meeting recovery for: ${sessionState.meetingId}`)

    sessionState.recoveryQueued = true
    sessionState.mode = 'post_meeting_recovery'

    // Queue the recovery job in health monitor
    diarizationHealthMonitor.queuePostMeetingRecovery(
      sessionState.meetingId,
      diarizationHealthMonitor.getStats().lastErrorReason || 'unknown_error'
    )

    emitNotification({
      type: 'info',
      title: 'Speaker Identification Scheduled',
      message: 'Speaker identification will run automatically when the recording completes.',
      dismissable: true,
      timestamp: Date.now()
    })

    eventEmitter.emit('mode-change', sessionState.mode)
  },

  /**
   * Trigger post-meeting recovery for a specific meeting
   */
  async triggerPostMeetingRecovery(meetingId: string): Promise<{
    success: boolean
    speakersDetected: number
    transcriptsUpdated: number
    error?: string
  }> {
    console.log(`[DiarizationFallback] Triggering post-meeting recovery for: ${meetingId}`)

    // Update recovery job status
    diarizationHealthMonitor.updateRecoveryJobStatus(meetingId, 'processing')

    emitNotification({
      type: 'info',
      title: 'Processing Speaker Identification',
      message: 'Running speaker identification on recorded audio. This may take a few minutes.',
      dismissable: false,
      timestamp: Date.now()
    })

    try {
      const result = await batchDiarizationService.processMeeting(meetingId, {
        diarizationThreshold: 0.4,
        minSpeakers: 2,
        maxSpeakers: 10,
        onProgress: (progress) => {
          eventEmitter.emit('recovery-progress', {
            meetingId,
            phase: progress.phase,
            progress: progress.progress,
            message: progress.message
          })
        }
      })

      if (result.success) {
        diarizationHealthMonitor.updateRecoveryJobStatus(meetingId, 'completed')

        emitNotification({
          type: 'success',
          title: 'Speaker Identification Complete',
          message: `Identified ${result.speakersDetected} speakers in ${result.transcriptsUpdated} transcript segments.`,
          dismissable: true,
          timestamp: Date.now()
        })
      } else {
        diarizationHealthMonitor.updateRecoveryJobStatus(meetingId, 'failed', result.error)

        emitNotification({
          type: 'error',
          title: 'Speaker Identification Failed',
          message: result.error || 'Failed to identify speakers. You can try again from the meeting details.',
          action: {
            label: 'Retry',
            handler: 'retry_diarization'
          },
          dismissable: true,
          timestamp: Date.now()
        })
      }

      return result
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error)
      diarizationHealthMonitor.updateRecoveryJobStatus(meetingId, 'failed', errorMsg)

      emitNotification({
        type: 'error',
        title: 'Speaker Identification Error',
        message: errorMsg,
        dismissable: true,
        timestamp: Date.now()
      })

      return {
        success: false,
        speakersDetected: 0,
        transcriptsUpdated: 0,
        error: errorMsg
      }
    }
  },

  /**
   * Process pending recovery jobs
   */
  async processPendingRecoveryJobs(): Promise<void> {
    const pendingJobs = diarizationHealthMonitor.getPendingRecoveryJobs()

    console.log(`[DiarizationFallback] Processing ${pendingJobs.length} pending recovery jobs`)

    for (const job of pendingJobs) {
      await this.triggerPostMeetingRecovery(job.meetingId)
    }
  },

  /**
   * Get speaker ID for a transcript segment (handles fallback scenarios)
   *
   * Returns:
   * - Actual speaker ID if diarization working
   * - Last known speaker ID if in partial success mode
   * - 'unknown' if in silent degradation mode
   * - null if diarization disabled
   */
  getSpeakerIdForSegment(
    detectedSpeakerId: string | null,
    segmentTimeMs: number
  ): string | null {
    // If we have a detected speaker, use it
    if (detectedSpeakerId) {
      sessionState.lastKnownSpeakerId = detectedSpeakerId
      sessionState.lastKnownSpeakerTime = segmentTimeMs
      return detectedSpeakerId
    }

    // Handle based on current mode
    switch (sessionState.mode) {
      case 'none':
        // Normal operation, no speaker detected
        return null

      case 'silent_degradation':
      case 'post_meeting_recovery':
        // No speaker info available
        sessionState.segmentsSavedWithoutSpeaker++
        return UNKNOWN_SPEAKER_ID

      case 'partial_success':
        // Use last known speaker or unknown
        if (
          sessionState.lastKnownSpeakerId &&
          sessionState.lastKnownSpeakerTime &&
          segmentTimeMs - sessionState.lastKnownSpeakerTime < 5000 // Within 5 seconds
        ) {
          return sessionState.lastKnownSpeakerId
        }
        sessionState.segmentsSavedWithoutSpeaker++
        return UNKNOWN_SPEAKER_ID

      case 'disabled':
        return null

      default:
        return null
    }
  },

  /**
   * Check if we're in a fallback mode
   */
  isInFallbackMode(): boolean {
    return sessionState.mode !== 'none' && sessionState.mode !== 'disabled'
  },

  /**
   * Get current fallback mode
   */
  getCurrentMode(): DiarizationFallbackMode {
    return sessionState.mode
  },

  /**
   * Get session state
   */
  getSessionState(): FallbackSessionState {
    return { ...sessionState }
  },

  /**
   * Get pending notifications
   */
  getPendingNotifications(): FallbackNotification[] {
    return [...pendingNotifications]
  },

  /**
   * Dismiss a notification
   */
  dismissNotification(timestamp: number): void {
    pendingNotifications = pendingNotifications.filter(n => n.timestamp !== timestamp)
    eventEmitter.emit('notification-dismissed', timestamp)
  },

  /**
   * Clear all notifications
   */
  clearNotifications(): void {
    pendingNotifications = []
    eventEmitter.emit('notifications-cleared')
  },

  /**
   * Subscribe to mode change events
   */
  onModeChange(callback: (mode: DiarizationFallbackMode) => void): () => void {
    eventEmitter.on('mode-change', callback)
    return () => eventEmitter.off('mode-change', callback)
  },

  /**
   * Subscribe to notification events
   */
  onNotification(callback: (notification: FallbackNotification) => void): () => void {
    eventEmitter.on('notification', callback)
    return () => eventEmitter.off('notification', callback)
  },

  /**
   * Subscribe to recovery progress events
   */
  onRecoveryProgress(callback: (progress: {
    meetingId: string
    phase: string
    progress: number
    message: string
  }) => void): () => void {
    eventEmitter.on('recovery-progress', callback)
    return () => eventEmitter.off('recovery-progress', callback)
  },

  /**
   * Get combined diarization status for UI display
   */
  getStatusForUI(): {
    status: 'active' | 'degraded' | 'failed' | 'disabled' | 'recovery_pending'
    color: 'green' | 'yellow' | 'red' | 'gray' | 'blue'
    label: string
    message: string
    showRecoveryOption: boolean
  } {
    const healthStatus = diarizationHealthMonitor.getStatus()
    const mode = sessionState.mode

    // Check for pending recovery
    if (sessionState.recoveryQueued || mode === 'post_meeting_recovery') {
      return {
        status: 'recovery_pending',
        color: 'blue',
        label: 'Recovery Scheduled',
        message: 'Speaker identification will run after recording completes.',
        showRecoveryOption: false
      }
    }

    switch (healthStatus) {
      case 'active':
        return {
          status: 'active',
          color: 'green',
          label: 'Speaker Identification: Active',
          message: 'Speakers are being identified in real-time.',
          showRecoveryOption: false
        }

      case 'degraded':
        return {
          status: 'degraded',
          color: 'yellow',
          label: 'Speaker Identification: Degraded',
          message: 'Speaker identification is experiencing issues.',
          showRecoveryOption: true
        }

      case 'failed':
        return {
          status: 'failed',
          color: 'red',
          label: 'Speaker Identification: Failed',
          message: 'Speaker identification is not available.',
          showRecoveryOption: true
        }

      case 'disabled':
        return {
          status: 'disabled',
          color: 'gray',
          label: 'Speaker Identification: Disabled',
          message: 'Speaker identification has been disabled.',
          showRecoveryOption: false
        }

      default:
        return {
          status: 'active',
          color: 'green',
          label: 'Speaker Identification',
          message: 'Initializing...',
          showRecoveryOption: false
        }
    }
  },

  /**
   * Manual trigger for post-meeting recovery (UI action)
   */
  async manualTriggerRecovery(meetingId: string): Promise<{
    success: boolean
    error?: string
  }> {
    console.log(`[DiarizationFallback] Manual recovery triggered for: ${meetingId}`)

    try {
      const result = await this.triggerPostMeetingRecovery(meetingId)
      return {
        success: result.success,
        error: result.error
      }
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error)
      return {
        success: false,
        error: errorMsg
      }
    }
  },

  /**
   * Reset the service (for testing)
   */
  reset(): void {
    resetSessionState()
    pendingNotifications = []
  }
}

// Export types
export type {
  FallbackSessionState,
  FallbackNotification
}
