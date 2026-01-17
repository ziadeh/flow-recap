/**
 * Diarization Telemetry Service
 *
 * Tracks success/failure rates for speaker diarization operations.
 * Provides metrics and analytics for monitoring diarization pipeline health.
 *
 * Key Metrics Tracked:
 * - Total diarization attempts
 * - Success/failure counts and rates
 * - Failure reasons and codes
 * - Processing time statistics
 * - Speaker detection accuracy
 */

import { EventEmitter } from 'events'

// ============================================================================
// Types
// ============================================================================

/**
 * Type of diarization operation being tracked
 */
export type DiarizationOperationType =
  | 'batch_diarization'      // Full audio file processing
  | 'live_diarization'       // Real-time streaming diarization
  | 'validation_checkpoint'  // Pre-transcription validation
  | 'pipeline_stage'         // Part of the diarization-first pipeline

/**
 * Outcome of a diarization operation
 */
export type DiarizationOutcome = 'success' | 'failure' | 'partial' | 'skipped'

/**
 * Failure categories for diarization operations
 */
export type DiarizationFailureCategory =
  | 'model_unavailable'      // pyannote/model not available
  | 'insufficient_audio'     // Audio too short for diarization
  | 'processing_error'       // Error during diarization processing
  | 'validation_failed'      // Output validation failed
  | 'timeout'                // Processing timed out
  | 'embedding_failed'       // Speaker embedding extraction failed
  | 'clustering_failed'      // Speaker clustering failed
  | 'single_speaker_fallback_prevented'  // System prevented silent fallback
  | 'configuration_error'    // Invalid configuration
  | 'unknown'                // Unknown error

/**
 * Individual telemetry event for a diarization operation
 */
export interface DiarizationTelemetryEvent {
  /** Unique event ID */
  id: string
  /** Timestamp of the event */
  timestamp: number
  /** Type of operation */
  operationType: DiarizationOperationType
  /** Outcome of the operation */
  outcome: DiarizationOutcome
  /** Meeting ID if applicable */
  meetingId?: string
  /** Audio file path if applicable */
  audioPath?: string
  /** Duration of audio in seconds */
  audioDuration?: number
  /** Processing time in milliseconds */
  processingTimeMs: number
  /** Number of speakers detected (if successful) */
  speakersDetected?: number
  /** Number of segments produced (if successful) */
  segmentsProduced?: number
  /** Error code if failed */
  errorCode?: string
  /** Failure category if failed */
  failureCategory?: DiarizationFailureCategory
  /** Error message if failed */
  errorMessage?: string
  /** Additional metadata */
  metadata?: Record<string, unknown>
}

/**
 * Aggregate statistics for diarization telemetry
 */
export interface DiarizationTelemetryStats {
  /** Total number of diarization attempts */
  totalAttempts: number
  /** Number of successful operations */
  successCount: number
  /** Number of failed operations */
  failureCount: number
  /** Number of partial successes */
  partialCount: number
  /** Number of skipped operations */
  skippedCount: number
  /** Overall success rate (0.0-1.0) */
  successRate: number
  /** Overall failure rate (0.0-1.0) */
  failureRate: number
  /** Average processing time in milliseconds */
  averageProcessingTimeMs: number
  /** Maximum processing time in milliseconds */
  maxProcessingTimeMs: number
  /** Minimum processing time in milliseconds */
  minProcessingTimeMs: number
  /** Average speakers detected per successful operation */
  averageSpeakersDetected: number
  /** Breakdown of failures by category */
  failuresByCategory: Record<DiarizationFailureCategory, number>
  /** Stats by operation type */
  byOperationType: Record<DiarizationOperationType, {
    attempts: number
    successes: number
    failures: number
    successRate: number
  }>
  /** Time range of the statistics */
  timeRange: {
    start: number
    end: number
  }
}

/**
 * Configuration for the telemetry service
 */
export interface DiarizationTelemetryConfig {
  /** Maximum number of events to retain in memory */
  maxEventsInMemory?: number
  /** Whether to emit events to external systems */
  emitEvents?: boolean
  /** Whether to log events to console */
  logToConsole?: boolean
}

// ============================================================================
// Constants
// ============================================================================

const TELEMETRY_EVENT = 'diarization-telemetry:event'
const DEFAULT_MAX_EVENTS = 1000
const DIARIZATION_FAILURE_MESSAGE = 'Speaker diarization is not available. Audio is being transcribed without speaker separation.'

// ============================================================================
// Service State
// ============================================================================

const events: DiarizationTelemetryEvent[] = []
const eventEmitter = new EventEmitter()
let config: DiarizationTelemetryConfig = {
  maxEventsInMemory: DEFAULT_MAX_EVENTS,
  emitEvents: true,
  logToConsole: true
}

// ============================================================================
// Helper Functions
// ============================================================================

function generateEventId(): string {
  return `diar-tel-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`
}

function categorizeError(errorCode?: string, errorMessage?: string): DiarizationFailureCategory {
  if (!errorCode && !errorMessage) return 'unknown'

  const combined = `${errorCode || ''} ${errorMessage || ''}`.toLowerCase()

  if (combined.includes('model') || combined.includes('pyannote') || combined.includes('unavailable')) {
    return 'model_unavailable'
  }
  if (combined.includes('insufficient') || combined.includes('too short') || combined.includes('audio')) {
    return 'insufficient_audio'
  }
  if (combined.includes('timeout') || combined.includes('timed out')) {
    return 'timeout'
  }
  if (combined.includes('embedding')) {
    return 'embedding_failed'
  }
  if (combined.includes('cluster')) {
    return 'clustering_failed'
  }
  if (combined.includes('validation') || combined.includes('schema')) {
    return 'validation_failed'
  }
  if (combined.includes('single-speaker') || combined.includes('fallback') || combined.includes('prevented')) {
    return 'single_speaker_fallback_prevented'
  }
  if (combined.includes('config')) {
    return 'configuration_error'
  }

  return 'processing_error'
}

function pruneEvents(): void {
  const maxEvents = config.maxEventsInMemory || DEFAULT_MAX_EVENTS
  if (events.length > maxEvents) {
    events.splice(0, events.length - maxEvents)
  }
}

// ============================================================================
// Telemetry Service
// ============================================================================

export const diarizationTelemetryService = {
  /**
   * Configure the telemetry service
   */
  configure(newConfig: Partial<DiarizationTelemetryConfig>): void {
    config = { ...config, ...newConfig }
  },

  /**
   * Record a successful diarization operation
   */
  recordSuccess(
    operationType: DiarizationOperationType,
    details: {
      meetingId?: string
      audioPath?: string
      audioDuration?: number
      processingTimeMs: number
      speakersDetected: number
      segmentsProduced: number
      metadata?: Record<string, unknown>
    }
  ): DiarizationTelemetryEvent {
    const event: DiarizationTelemetryEvent = {
      id: generateEventId(),
      timestamp: Date.now(),
      operationType,
      outcome: 'success',
      ...details
    }

    events.push(event)
    pruneEvents()

    if (config.logToConsole) {
      console.log(`[Diarization Telemetry] SUCCESS - ${operationType}:`, {
        speakers: details.speakersDetected,
        segments: details.segmentsProduced,
        timeMs: details.processingTimeMs
      })
    }

    if (config.emitEvents) {
      eventEmitter.emit(TELEMETRY_EVENT, event)
    }

    return event
  },

  /**
   * Record a failed diarization operation
   *
   * IMPORTANT: This should be called when diarization fails and the pipeline
   * must display the explicit error message to the user.
   */
  recordFailure(
    operationType: DiarizationOperationType,
    details: {
      meetingId?: string
      audioPath?: string
      audioDuration?: number
      processingTimeMs: number
      errorCode?: string
      errorMessage?: string
      metadata?: Record<string, unknown>
    }
  ): DiarizationTelemetryEvent {
    const failureCategory = categorizeError(details.errorCode, details.errorMessage)

    const event: DiarizationTelemetryEvent = {
      id: generateEventId(),
      timestamp: Date.now(),
      operationType,
      outcome: 'failure',
      failureCategory,
      ...details
    }

    events.push(event)
    pruneEvents()

    if (config.logToConsole) {
      console.error(`[Diarization Telemetry] FAILURE - ${operationType}:`, {
        category: failureCategory,
        errorCode: details.errorCode,
        message: details.errorMessage,
        timeMs: details.processingTimeMs
      })
      // Log the mandatory error message
      console.error(`[Diarization Telemetry] ${DIARIZATION_FAILURE_MESSAGE}`)
    }

    if (config.emitEvents) {
      eventEmitter.emit(TELEMETRY_EVENT, event)
    }

    return event
  },

  /**
   * Record a partial success (e.g., diarization worked but with warnings)
   */
  recordPartialSuccess(
    operationType: DiarizationOperationType,
    details: {
      meetingId?: string
      audioPath?: string
      audioDuration?: number
      processingTimeMs: number
      speakersDetected: number
      segmentsProduced: number
      warnings: string[]
      metadata?: Record<string, unknown>
    }
  ): DiarizationTelemetryEvent {
    const event: DiarizationTelemetryEvent = {
      id: generateEventId(),
      timestamp: Date.now(),
      operationType,
      outcome: 'partial',
      speakersDetected: details.speakersDetected,
      segmentsProduced: details.segmentsProduced,
      metadata: {
        ...details.metadata,
        warnings: details.warnings
      },
      meetingId: details.meetingId,
      audioPath: details.audioPath,
      audioDuration: details.audioDuration,
      processingTimeMs: details.processingTimeMs
    }

    events.push(event)
    pruneEvents()

    if (config.logToConsole) {
      console.warn(`[Diarization Telemetry] PARTIAL - ${operationType}:`, {
        speakers: details.speakersDetected,
        segments: details.segmentsProduced,
        warnings: details.warnings
      })
    }

    if (config.emitEvents) {
      eventEmitter.emit(TELEMETRY_EVENT, event)
    }

    return event
  },

  /**
   * Record a skipped diarization operation
   */
  recordSkipped(
    operationType: DiarizationOperationType,
    reason: string,
    details?: {
      meetingId?: string
      audioPath?: string
      metadata?: Record<string, unknown>
    }
  ): DiarizationTelemetryEvent {
    const event: DiarizationTelemetryEvent = {
      id: generateEventId(),
      timestamp: Date.now(),
      operationType,
      outcome: 'skipped',
      processingTimeMs: 0,
      errorMessage: reason,
      ...details
    }

    events.push(event)
    pruneEvents()

    if (config.logToConsole) {
      console.log(`[Diarization Telemetry] SKIPPED - ${operationType}: ${reason}`)
    }

    if (config.emitEvents) {
      eventEmitter.emit(TELEMETRY_EVENT, event)
    }

    return event
  },

  /**
   * Record a validation checkpoint result
   */
  recordValidationCheckpoint(
    passed: boolean,
    details: {
      checkpointName: string
      processingTimeMs: number
      errors?: string[]
      warnings?: string[]
      meetingId?: string
      metadata?: Record<string, unknown>
    }
  ): DiarizationTelemetryEvent {
    const event: DiarizationTelemetryEvent = {
      id: generateEventId(),
      timestamp: Date.now(),
      operationType: 'validation_checkpoint',
      outcome: passed ? 'success' : 'failure',
      processingTimeMs: details.processingTimeMs,
      meetingId: details.meetingId,
      errorMessage: details.errors?.join('; '),
      failureCategory: passed ? undefined : 'validation_failed',
      metadata: {
        checkpointName: details.checkpointName,
        errors: details.errors,
        warnings: details.warnings,
        ...details.metadata
      }
    }

    events.push(event)
    pruneEvents()

    if (config.logToConsole) {
      if (passed) {
        console.log(`[Diarization Telemetry] CHECKPOINT PASSED - ${details.checkpointName}`)
      } else {
        console.error(`[Diarization Telemetry] CHECKPOINT FAILED - ${details.checkpointName}:`, details.errors)
      }
    }

    if (config.emitEvents) {
      eventEmitter.emit(TELEMETRY_EVENT, event)
    }

    return event
  },

  /**
   * Get aggregate statistics for all recorded events
   */
  getStats(since?: number): DiarizationTelemetryStats {
    const filteredEvents = since
      ? events.filter(e => e.timestamp >= since)
      : events

    const stats: DiarizationTelemetryStats = {
      totalAttempts: filteredEvents.length,
      successCount: 0,
      failureCount: 0,
      partialCount: 0,
      skippedCount: 0,
      successRate: 0,
      failureRate: 0,
      averageProcessingTimeMs: 0,
      maxProcessingTimeMs: 0,
      minProcessingTimeMs: Infinity,
      averageSpeakersDetected: 0,
      failuresByCategory: {} as Record<DiarizationFailureCategory, number>,
      byOperationType: {} as Record<DiarizationOperationType, {
        attempts: number
        successes: number
        failures: number
        successRate: number
      }>,
      timeRange: {
        start: filteredEvents.length > 0 ? Math.min(...filteredEvents.map(e => e.timestamp)) : 0,
        end: filteredEvents.length > 0 ? Math.max(...filteredEvents.map(e => e.timestamp)) : 0
      }
    }

    if (filteredEvents.length === 0) {
      stats.minProcessingTimeMs = 0
      return stats
    }

    let totalProcessingTime = 0
    let totalSpeakers = 0
    let successfulWithSpeakers = 0

    for (const event of filteredEvents) {
      // Count by outcome
      switch (event.outcome) {
        case 'success':
          stats.successCount++
          break
        case 'failure':
          stats.failureCount++
          break
        case 'partial':
          stats.partialCount++
          break
        case 'skipped':
          stats.skippedCount++
          break
      }

      // Processing time
      totalProcessingTime += event.processingTimeMs
      stats.maxProcessingTimeMs = Math.max(stats.maxProcessingTimeMs, event.processingTimeMs)
      stats.minProcessingTimeMs = Math.min(stats.minProcessingTimeMs, event.processingTimeMs)

      // Speakers detected
      if (event.speakersDetected !== undefined && event.speakersDetected > 0) {
        totalSpeakers += event.speakersDetected
        successfulWithSpeakers++
      }

      // Failures by category
      if (event.failureCategory) {
        stats.failuresByCategory[event.failureCategory] =
          (stats.failuresByCategory[event.failureCategory] || 0) + 1
      }

      // By operation type
      if (!stats.byOperationType[event.operationType]) {
        stats.byOperationType[event.operationType] = {
          attempts: 0,
          successes: 0,
          failures: 0,
          successRate: 0
        }
      }
      stats.byOperationType[event.operationType].attempts++
      if (event.outcome === 'success' || event.outcome === 'partial') {
        stats.byOperationType[event.operationType].successes++
      } else if (event.outcome === 'failure') {
        stats.byOperationType[event.operationType].failures++
      }
    }

    // Calculate rates
    stats.successRate = stats.totalAttempts > 0
      ? (stats.successCount + stats.partialCount) / stats.totalAttempts
      : 0
    stats.failureRate = stats.totalAttempts > 0
      ? stats.failureCount / stats.totalAttempts
      : 0
    stats.averageProcessingTimeMs = stats.totalAttempts > 0
      ? totalProcessingTime / stats.totalAttempts
      : 0
    stats.averageSpeakersDetected = successfulWithSpeakers > 0
      ? totalSpeakers / successfulWithSpeakers
      : 0

    // Calculate per-operation-type success rates
    for (const opType of Object.keys(stats.byOperationType) as DiarizationOperationType[]) {
      const opStats = stats.byOperationType[opType]
      opStats.successRate = opStats.attempts > 0
        ? opStats.successes / opStats.attempts
        : 0
    }

    if (stats.minProcessingTimeMs === Infinity) {
      stats.minProcessingTimeMs = 0
    }

    return stats
  },

  /**
   * Get recent events
   */
  getRecentEvents(count: number = 50): DiarizationTelemetryEvent[] {
    return events.slice(-count)
  },

  /**
   * Get events by operation type
   */
  getEventsByType(operationType: DiarizationOperationType): DiarizationTelemetryEvent[] {
    return events.filter(e => e.operationType === operationType)
  },

  /**
   * Get failure events
   */
  getFailures(): DiarizationTelemetryEvent[] {
    return events.filter(e => e.outcome === 'failure')
  },

  /**
   * Subscribe to telemetry events
   */
  onEvent(callback: (event: DiarizationTelemetryEvent) => void): () => void {
    eventEmitter.on(TELEMETRY_EVENT, callback)
    return () => {
      eventEmitter.off(TELEMETRY_EVENT, callback)
    }
  },

  /**
   * Get the mandatory failure message for UI display
   */
  getFailureMessage(): string {
    return DIARIZATION_FAILURE_MESSAGE
  },

  /**
   * Clear all recorded events
   */
  clear(): void {
    events.length = 0
    console.log('[Diarization Telemetry] All events cleared')
  },

  /**
   * Get the total number of events
   */
  getEventCount(): number {
    return events.length
  },

  /**
   * Export all events as JSON
   */
  exportAsJson(): string {
    return JSON.stringify({
      exportedAt: Date.now(),
      eventCount: events.length,
      stats: this.getStats(),
      events: events
    }, null, 2)
  }
}

// Export for testing
export function resetDiarizationTelemetryState(): void {
  events.length = 0
  eventEmitter.removeAllListeners()
  config = {
    maxEventsInMemory: DEFAULT_MAX_EVENTS,
    emitEvents: true,
    logToConsole: true
  }
}

export { DIARIZATION_FAILURE_MESSAGE }
