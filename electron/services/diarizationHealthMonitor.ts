/**
 * Diarization Health Monitor Service
 *
 * Monitors the health of speaker diarization during active recording sessions
 * and implements fallback mechanisms when automatic diarization fails.
 *
 * Key Features:
 * - Real-time health monitoring during recording
 * - Failure detection (no segments, timeout, errors)
 * - Silent degradation with user notification
 * - Post-meeting recovery through batch diarization
 * - Partial success handling
 */

import { EventEmitter } from 'events'

// ============================================================================
// Types
// ============================================================================

/**
 * Health status levels for diarization
 */
export type DiarizationHealthStatus = 'active' | 'degraded' | 'failed' | 'disabled' | 'unknown'

/**
 * Failure reasons tracked by the health monitor
 */
export type DiarizationFailureReason =
  | 'no_segments_timeout'      // No speaker segments generated for extended period
  | 'model_loading_error'      // Pyannote model failed to load
  | 'embedding_error'          // Speaker embedding extraction failed
  | 'clustering_error'         // Speaker clustering failed
  | 'single_speaker_anomaly'   // All audio attributed to one speaker when multiple expected
  | 'process_crash'            // Diarization process crashed
  | 'initialization_timeout'   // Took too long to initialize
  | 'authentication_error'     // Hugging Face authentication failed
  | 'unknown_error'            // Unknown error occurred

/**
 * Health status event emitted by the monitor
 */
export interface DiarizationHealthEvent {
  status: DiarizationHealthStatus
  previousStatus: DiarizationHealthStatus
  reason?: DiarizationFailureReason
  message: string
  timestamp: number
  meetingId?: string
  recoveryOptions: RecoveryOption[]
}

/**
 * Recovery option available to the user
 */
export interface RecoveryOption {
  id: string
  label: string
  description: string
  action: 'continue_without_speakers' | 'retry_post_meeting' | 'retry_now' | 'skip_diarization'
  recommended?: boolean
}

/**
 * Diarization health statistics
 */
export interface DiarizationHealthStats {
  sessionStartTime: number
  lastSegmentTime: number | null
  totalSegments: number
  totalSpeakers: number
  consecutiveErrors: number
  lastErrorTime: number | null
  lastErrorReason: DiarizationFailureReason | null
  degradedSince: number | null
  failedSince: number | null
}

/**
 * Configuration for the health monitor
 */
export interface DiarizationHealthConfig {
  /** Time without segments before marking as degraded (ms) - default 15000 */
  noSegmentWarningThreshold: number
  /** Time without segments before marking as failed (ms) - default 30000 */
  noSegmentFailureThreshold: number
  /** Number of consecutive errors before marking as failed - default 3 */
  maxConsecutiveErrors: number
  /** Time to wait for initialization (ms) - default 60000 */
  initializationTimeout: number
  /** Check interval for health monitoring (ms) - default 5000 */
  healthCheckInterval: number
  /** Whether to auto-queue post-meeting recovery on failure - default true */
  autoQueuePostMeetingRecovery: boolean
}

/**
 * Post-meeting recovery job
 */
export interface PostMeetingRecoveryJob {
  meetingId: string
  audioPath: string
  queuedAt: number
  reason: DiarizationFailureReason
  status: 'pending' | 'processing' | 'completed' | 'failed'
  completedAt?: number
  error?: string
}

// ============================================================================
// Default Configuration
// ============================================================================

const DEFAULT_CONFIG: DiarizationHealthConfig = {
  noSegmentWarningThreshold: 15000, // 15 seconds
  noSegmentFailureThreshold: 30000, // 30 seconds
  maxConsecutiveErrors: 3,
  initializationTimeout: 60000, // 60 seconds
  healthCheckInterval: 5000, // 5 seconds
  autoQueuePostMeetingRecovery: true
}

// ============================================================================
// Service State
// ============================================================================

let currentStatus: DiarizationHealthStatus = 'unknown'
let currentMeetingId: string | null = null
let isMonitoring = false
let healthCheckTimer: ReturnType<typeof setInterval> | null = null
let initializationTimer: ReturnType<typeof setTimeout> | null = null
let config = { ...DEFAULT_CONFIG }
let userSkipPreference = false // User chose to skip diarization

const eventEmitter = new EventEmitter()

const stats: DiarizationHealthStats = {
  sessionStartTime: 0,
  lastSegmentTime: null,
  totalSegments: 0,
  totalSpeakers: 0,
  consecutiveErrors: 0,
  lastErrorTime: null,
  lastErrorReason: null,
  degradedSince: null,
  failedSince: null
}

const recoveryJobs: PostMeetingRecoveryJob[] = []

// ============================================================================
// Helper Functions
// ============================================================================

function resetStats(): void {
  stats.sessionStartTime = Date.now()
  stats.lastSegmentTime = null
  stats.totalSegments = 0
  stats.totalSpeakers = 0
  stats.consecutiveErrors = 0
  stats.lastErrorTime = null
  stats.lastErrorReason = null
  stats.degradedSince = null
  stats.failedSince = null
}

function getRecoveryOptions(reason: DiarizationFailureReason): RecoveryOption[] {
  const options: RecoveryOption[] = []

  // Always offer continue without speakers
  options.push({
    id: 'continue_without',
    label: 'Continue Without Speaker Labels',
    description: 'Recording and transcription will continue, but speakers will not be identified.',
    action: 'continue_without_speakers'
  })

  // Offer post-meeting recovery for most failures
  if (reason !== 'authentication_error') {
    options.push({
      id: 'retry_post_meeting',
      label: 'Identify Speakers After Recording',
      description: 'Speaker identification will run automatically when the recording stops.',
      action: 'retry_post_meeting',
      recommended: true
    })
  }

  // For some failures, offer immediate retry
  if (['process_crash', 'initialization_timeout', 'unknown_error'].includes(reason)) {
    options.push({
      id: 'retry_now',
      label: 'Retry Now',
      description: 'Attempt to restart speaker identification immediately.',
      action: 'retry_now'
    })
  }

  // Always offer skip option
  options.push({
    id: 'skip',
    label: 'Skip Speaker Identification',
    description: 'Disable speaker identification for this and future recordings.',
    action: 'skip_diarization'
  })

  return options
}

function emitHealthEvent(
  newStatus: DiarizationHealthStatus,
  reason?: DiarizationFailureReason,
  message?: string
): void {
  const previousStatus = currentStatus

  // Only emit if status changed
  if (newStatus === currentStatus && !reason) {
    return
  }

  currentStatus = newStatus

  // Update timestamps based on status
  if (newStatus === 'degraded' && !stats.degradedSince) {
    stats.degradedSince = Date.now()
  } else if (newStatus === 'failed' && !stats.failedSince) {
    stats.failedSince = Date.now()
  } else if (newStatus === 'active') {
    stats.degradedSince = null
    stats.failedSince = null
  }

  const event: DiarizationHealthEvent = {
    status: newStatus,
    previousStatus,
    reason,
    message: message || getStatusMessage(newStatus, reason),
    timestamp: Date.now(),
    meetingId: currentMeetingId || undefined,
    recoveryOptions: reason ? getRecoveryOptions(reason) : []
  }

  console.log(`[DiarizationHealthMonitor] Status: ${previousStatus} -> ${newStatus}`, reason || '')

  eventEmitter.emit('health-change', event)
}

function getStatusMessage(status: DiarizationHealthStatus, reason?: DiarizationFailureReason): string {
  switch (status) {
    case 'active':
      return 'Speaker identification is active and working normally.'
    case 'degraded':
      if (reason === 'no_segments_timeout') {
        return 'Speaker identification is experiencing delays. Speakers may not be identified in real-time.'
      }
      if (reason === 'single_speaker_anomaly') {
        return 'Only one speaker is being detected. This may indicate an issue with speaker separation.'
      }
      return 'Speaker identification is experiencing issues but still attempting to identify speakers.'
    case 'failed':
      if (reason === 'authentication_error') {
        return 'Speaker identification requires Hugging Face authentication. Please configure your HF_TOKEN.'
      }
      if (reason === 'model_loading_error') {
        return 'Failed to load speaker identification models. Please check your installation.'
      }
      if (reason === 'process_crash') {
        return 'Speaker identification process has stopped unexpectedly.'
      }
      return 'Speaker identification is not available. Recording will continue without speaker labels.'
    case 'disabled':
      return 'Speaker identification has been disabled.'
    default:
      return 'Speaker identification status is unknown.'
  }
}

function performHealthCheck(): void {
  if (!isMonitoring) return

  const now = Date.now()
  const timeSinceStart = now - stats.sessionStartTime
  const timeSinceLastSegment = stats.lastSegmentTime ? now - stats.lastSegmentTime : timeSinceStart

  // Check for no segments timeout
  if (currentStatus === 'active' || currentStatus === 'unknown') {
    if (timeSinceLastSegment >= config.noSegmentFailureThreshold) {
      emitHealthEvent('failed', 'no_segments_timeout',
        `No speaker segments detected for ${Math.round(timeSinceLastSegment / 1000)} seconds.`)
    } else if (timeSinceLastSegment >= config.noSegmentWarningThreshold) {
      emitHealthEvent('degraded', 'no_segments_timeout',
        `No speaker segments detected for ${Math.round(timeSinceLastSegment / 1000)} seconds.`)
    }
  }

  // Check for single speaker anomaly (only after significant time)
  if (
    currentStatus === 'active' &&
    timeSinceStart > 60000 && // At least 1 minute of recording
    stats.totalSegments > 10 && // At least 10 segments
    stats.totalSpeakers === 1   // Only one speaker detected
  ) {
    emitHealthEvent('degraded', 'single_speaker_anomaly',
      'Only one speaker detected after extended recording. Multiple voices may not be distinguishing correctly.')
  }

  // Check for consecutive errors
  if (stats.consecutiveErrors >= config.maxConsecutiveErrors) {
    emitHealthEvent('failed', stats.lastErrorReason || 'unknown_error',
      `Speaker identification failed after ${stats.consecutiveErrors} consecutive errors.`)
  }
}

// ============================================================================
// Diarization Health Monitor Service
// ============================================================================

export const diarizationHealthMonitor = {
  /**
   * Start monitoring diarization health for a recording session
   */
  startMonitoring(meetingId: string): void {
    console.log(`[DiarizationHealthMonitor] Starting health monitoring for meeting: ${meetingId}`)

    // Stop any existing monitoring
    this.stopMonitoring()

    currentMeetingId = meetingId
    isMonitoring = true
    resetStats()

    // Check if user has disabled diarization
    if (userSkipPreference) {
      emitHealthEvent('disabled', undefined, 'Speaker identification is disabled by user preference.')
      return
    }

    // Start with unknown status
    currentStatus = 'unknown'
    emitHealthEvent('unknown', undefined, 'Initializing speaker identification...')

    // Set initialization timeout
    initializationTimer = setTimeout(() => {
      if (currentStatus === 'unknown') {
        emitHealthEvent('failed', 'initialization_timeout',
          'Speaker identification took too long to initialize.')
      }
    }, config.initializationTimeout)

    // Start periodic health checks
    healthCheckTimer = setInterval(performHealthCheck, config.healthCheckInterval)
  },

  /**
   * Stop monitoring diarization health
   */
  stopMonitoring(): void {
    console.log('[DiarizationHealthMonitor] Stopping health monitoring')

    isMonitoring = false

    if (healthCheckTimer) {
      clearInterval(healthCheckTimer)
      healthCheckTimer = null
    }

    if (initializationTimer) {
      clearTimeout(initializationTimer)
      initializationTimer = null
    }

    // Queue post-meeting recovery if needed
    if (
      config.autoQueuePostMeetingRecovery &&
      currentMeetingId &&
      (currentStatus === 'failed' || currentStatus === 'degraded')
    ) {
      this.queuePostMeetingRecovery(currentMeetingId, stats.lastErrorReason || 'unknown_error')
    }

    currentMeetingId = null
    currentStatus = 'unknown'
  },

  /**
   * Report successful segment detection
   */
  reportSegment(speaker: string): void {
    if (!isMonitoring) return

    const now = Date.now()
    stats.lastSegmentTime = now
    stats.totalSegments++
    stats.consecutiveErrors = 0

    // Track unique speakers
    // (This is a simplified version - in practice, we'd track unique speaker IDs)

    // Clear initialization timeout on first segment
    if (initializationTimer) {
      clearTimeout(initializationTimer)
      initializationTimer = null
    }

    // Recover from degraded/unknown to active
    if (currentStatus !== 'active' && currentStatus !== 'disabled') {
      emitHealthEvent('active', undefined, 'Speaker identification is working normally.')
    }
  },

  /**
   * Report speaker count update
   */
  reportSpeakerCount(count: number): void {
    if (!isMonitoring) return
    stats.totalSpeakers = count
  },

  /**
   * Report an error in diarization
   */
  reportError(error: string, reason?: DiarizationFailureReason): void {
    if (!isMonitoring) return

    const mappedReason = reason || this.mapErrorToReason(error)
    stats.consecutiveErrors++
    stats.lastErrorTime = Date.now()
    stats.lastErrorReason = mappedReason

    console.error(`[DiarizationHealthMonitor] Error reported: ${error}`, mappedReason)

    // Immediate failure for critical errors
    if (['authentication_error', 'model_loading_error'].includes(mappedReason)) {
      emitHealthEvent('failed', mappedReason, error)
    } else if (stats.consecutiveErrors >= config.maxConsecutiveErrors) {
      emitHealthEvent('failed', mappedReason,
        `Speaker identification failed after ${stats.consecutiveErrors} consecutive errors: ${error}`)
    } else if (currentStatus === 'active') {
      emitHealthEvent('degraded', mappedReason, error)
    }
  },

  /**
   * Report diarization initialization complete
   */
  reportInitialized(): void {
    if (!isMonitoring) return

    // Clear initialization timeout
    if (initializationTimer) {
      clearTimeout(initializationTimer)
      initializationTimer = null
    }

    if (currentStatus === 'unknown') {
      emitHealthEvent('active', undefined, 'Speaker identification initialized successfully.')
    }
  },

  /**
   * Report diarization is not available
   */
  reportUnavailable(reason: string): void {
    const mappedReason = this.mapErrorToReason(reason)
    emitHealthEvent('failed', mappedReason, reason)
  },

  /**
   * Map error message to failure reason
   */
  mapErrorToReason(error: string): DiarizationFailureReason {
    const errorLower = error.toLowerCase()

    if (
      errorLower.includes('authenticate') ||
      errorLower.includes('hf_token') ||
      errorLower.includes('hugging face') ||
      errorLower.includes('401') ||
      errorLower.includes('403') ||
      errorLower.includes('unauthorized')
    ) {
      return 'authentication_error'
    }

    if (
      errorLower.includes('model') &&
      (errorLower.includes('load') || errorLower.includes('not found'))
    ) {
      return 'model_loading_error'
    }

    if (errorLower.includes('embedding')) {
      return 'embedding_error'
    }

    if (errorLower.includes('cluster')) {
      return 'clustering_error'
    }

    if (errorLower.includes('crash') || errorLower.includes('killed') || errorLower.includes('exit')) {
      return 'process_crash'
    }

    if (errorLower.includes('timeout') || errorLower.includes('timed out')) {
      return 'initialization_timeout'
    }

    return 'unknown_error'
  },

  /**
   * Queue a post-meeting recovery job
   */
  queuePostMeetingRecovery(meetingId: string, reason: DiarizationFailureReason, audioPath?: string): void {
    // Check if already queued
    const existing = recoveryJobs.find(j => j.meetingId === meetingId && j.status === 'pending')
    if (existing) {
      console.log(`[DiarizationHealthMonitor] Recovery already queued for meeting: ${meetingId}`)
      return
    }

    const job: PostMeetingRecoveryJob = {
      meetingId,
      audioPath: audioPath || '', // Will be resolved when processing
      queuedAt: Date.now(),
      reason,
      status: 'pending'
    }

    recoveryJobs.push(job)
    console.log(`[DiarizationHealthMonitor] Queued post-meeting recovery for: ${meetingId}`)

    eventEmitter.emit('recovery-queued', job)
  },

  /**
   * Get pending recovery jobs
   */
  getPendingRecoveryJobs(): PostMeetingRecoveryJob[] {
    return recoveryJobs.filter(j => j.status === 'pending')
  },

  /**
   * Get recovery job by meeting ID
   */
  getRecoveryJob(meetingId: string): PostMeetingRecoveryJob | undefined {
    return recoveryJobs.find(j => j.meetingId === meetingId)
  },

  /**
   * Update recovery job status
   */
  updateRecoveryJobStatus(
    meetingId: string,
    status: PostMeetingRecoveryJob['status'],
    error?: string
  ): void {
    const job = recoveryJobs.find(j => j.meetingId === meetingId)
    if (job) {
      job.status = status
      if (status === 'completed' || status === 'failed') {
        job.completedAt = Date.now()
      }
      if (error) {
        job.error = error
      }

      eventEmitter.emit('recovery-status-change', job)
    }
  },

  /**
   * Set user skip preference
   */
  setSkipPreference(skip: boolean): void {
    userSkipPreference = skip
    console.log(`[DiarizationHealthMonitor] User skip preference set to: ${skip}`)

    if (skip && isMonitoring) {
      emitHealthEvent('disabled', undefined, 'Speaker identification disabled by user.')
    }
  },

  /**
   * Get user skip preference
   */
  getSkipPreference(): boolean {
    return userSkipPreference
  },

  /**
   * Get current health status
   */
  getStatus(): DiarizationHealthStatus {
    return currentStatus
  },

  /**
   * Get current health stats
   */
  getStats(): DiarizationHealthStats {
    return { ...stats }
  },

  /**
   * Get current meeting ID being monitored
   */
  getCurrentMeetingId(): string | null {
    return currentMeetingId
  },

  /**
   * Check if monitoring is active
   */
  isMonitoringActive(): boolean {
    return isMonitoring
  },

  /**
   * Update configuration
   */
  updateConfig(newConfig: Partial<DiarizationHealthConfig>): void {
    config = { ...config, ...newConfig }
    console.log('[DiarizationHealthMonitor] Configuration updated:', config)
  },

  /**
   * Get current configuration
   */
  getConfig(): DiarizationHealthConfig {
    return { ...config }
  },

  /**
   * Subscribe to health change events
   */
  onHealthChange(callback: (event: DiarizationHealthEvent) => void): () => void {
    eventEmitter.on('health-change', callback)
    return () => eventEmitter.off('health-change', callback)
  },

  /**
   * Subscribe to recovery queue events
   */
  onRecoveryQueued(callback: (job: PostMeetingRecoveryJob) => void): () => void {
    eventEmitter.on('recovery-queued', callback)
    return () => eventEmitter.off('recovery-queued', callback)
  },

  /**
   * Subscribe to recovery status change events
   */
  onRecoveryStatusChange(callback: (job: PostMeetingRecoveryJob) => void): () => void {
    eventEmitter.on('recovery-status-change', callback)
    return () => eventEmitter.off('recovery-status-change', callback)
  },

  /**
   * Reset the service (for testing)
   */
  reset(): void {
    this.stopMonitoring()
    recoveryJobs.length = 0
    userSkipPreference = false
    config = { ...DEFAULT_CONFIG }
    currentStatus = 'unknown'
  }
}

// Note: Types are exported inline at their definitions above
