/**
 * IPC Event Batcher Service
 *
 * Consolidates rapid-fire IPC events from live transcription, diarization,
 * and insights into batched updates every 500ms. This prevents the renderer
 * from processing hundreds of individual state updates per second, which
 * causes dropped frames and UI stuttering during recording.
 *
 * Features:
 * - Configurable batch interval (default 500ms)
 * - Per-event-type batching with intelligent consolidation
 * - Automatic flushing on session end
 * - Memory-efficient circular buffer for high-frequency events
 */

import { BrowserWindow } from 'electron'
import { diarizationDebugService } from './diarizationDebugService'

// ============================================================================
// Priority Event Types
// ============================================================================

/**
 * Event priority levels for determining delivery behavior
 */
export enum EventPriority {
  /** Critical events that must bypass batching (delivered in <5ms) */
  CRITICAL = 'CRITICAL',
  /** High priority events that wait max 50-100ms */
  HIGH = 'HIGH',
  /** Normal events that can be batched (up to 500ms) */
  NORMAL = 'NORMAL'
}

/**
 * Item in the priority queue
 */
export interface PriorityQueueItem {
  eventName: string
  data: any
  priority: EventPriority
  enqueuedAt: number
  sentAt?: number
}

/**
 * Statistics for the priority queue
 */
export interface QueueStats {
  queueSize: number
  totalSent: number
  totalDropped: number
  averageLatency: number
}

// ============================================================================
// Types
// ============================================================================

export interface BatchedLiveTranscriptionUpdate {
  /** Latest progress update (only keep most recent) */
  progress?: {
    status: string
    progress: number
    message: string
    timestamp: number
  }
  /** All segments received in this batch */
  segments: Array<{
    id: string
    text: string
    start: number
    end: number
    confidence?: number
    is_final: boolean
    speaker?: string
    speaker_id?: string | null
  }>
  /** Latest diarization status (only keep most recent) */
  diarizationStatus?: {
    available: boolean
    reason?: string
    details?: string
    message?: string
    capabilities?: {
      speaker_embeddings: boolean
      speaker_clustering: boolean
      speaker_change_detection: boolean
      transcription_only: boolean
      max_speakers?: number
      similarity_threshold?: number
      embedding_backend?: string
    }
  }
  /** Batch timestamp */
  batchTimestamp: number
}

export interface BatchedStreamingDiarizationUpdate {
  /** Speaker segments received in this batch */
  segments: Array<{
    id: string
    speaker: string
    startTime: number
    endTime: number
    confidence: number
    isFinal: boolean
    wasRetroactivelyCorrected?: boolean
  }>
  /** Speaker change events in this batch */
  speakerChanges: Array<{
    time: number
    fromSpeaker: string | null
    toSpeaker: string
    confidence: number
  }>
  /** Latest status update (only keep most recent) */
  status?: {
    status: string
    message?: string
    timestamp: number
  }
  /** Retroactive corrections in this batch */
  corrections: Array<{
    segmentId: string
    oldSpeaker: string
    newSpeaker: string
    timestamp: number
  }>
  /** Latest stats (only keep most recent, replaces previous) */
  stats?: Record<string, {
    speakerId: string
    totalDuration: number
    segmentCount: number
    percentage: number
    firstAppearance: number
    lastAppearance: number
  }>
  /** Batch timestamp */
  batchTimestamp: number
}

export interface BatchedLiveNotesUpdate {
  /** All notes received in this batch */
  notes: Array<{
    id: string
    type: string
    content: string
    speaker?: string | null
    priority?: string
    assignee?: string | null
    extractedAt: number
    sourceSegmentIds: string[]
    isPreliminary: boolean
    confidence?: number
  }>
  /** Latest status (only keep most recent) */
  status?: {
    status: string
    timestamp: number
  }
  /** Latest batch state (only keep most recent) */
  batchState?: {
    pendingSegments: number
    processedSegmentIds: string[]
    batchesProcessed: number
    totalNotesGenerated: number
    timestamp: number
  }
  /** Errors received in this batch */
  errors: Array<{
    error: string
    code?: string
    details?: string
    timestamp: number
  }>
  /** Batch timestamp */
  batchTimestamp: number
}

export interface IPCEventBatcherConfig {
  /** Batch interval in milliseconds (default: 500) */
  batchIntervalMs: number
  /** Whether to log batching statistics (default: false) */
  enableLogging: boolean
}

// ============================================================================
// Default Configuration
// ============================================================================

const DEFAULT_CONFIG: IPCEventBatcherConfig = {
  batchIntervalMs: 500,
  enableLogging: false
}

// ============================================================================
// Priority Queue Implementation
// ============================================================================

/**
 * FIFO queue for priority events that bypass normal batching.
 * These events are sent immediately to the renderer.
 */
class CriticalEventQueue {
  private queue: PriorityQueueItem[] = []
  private readonly maxSize = 1000
  private stats = {
    totalSent: 0,
    totalDropped: 0,
    latencies: [] as number[]
  }

  /**
   * Add an event to the priority queue
   */
  enqueue(eventName: string, data: any, priority: EventPriority): void {
    if (this.queue.length >= this.maxSize) {
      // Drop oldest item if queue is full
      const dropped = this.queue.shift()
      this.stats.totalDropped++
      if (process.env.DEBUG_IPC_BATCHING) {
        console.warn(`[CriticalEventQueue] Queue full, dropping oldest item: ${dropped?.eventName}`)
      }
    }

    const item: PriorityQueueItem = {
      eventName,
      data,
      priority,
      enqueuedAt: Date.now()
    }

    this.queue.push(item)

    if (process.env.DEBUG_IPC_BATCHING) {
      console.debug(`[CriticalEventQueue] Enqueued ${priority} event: ${eventName}`)
    }
  }

  /**
   * Flush all queued events to the main window
   */
  flush(mainWindow: BrowserWindow): void {
    if (this.queue.length === 0) {
      return
    }

    while (this.queue.length > 0) {
      const item = this.queue.shift()
      if (!item) break

      if (!mainWindow || mainWindow.isDestroyed()) {
        this.stats.totalDropped++
        if (process.env.DEBUG_IPC_BATCHING) {
          console.warn(`[CriticalEventQueue] Window destroyed, dropping event: ${item.eventName}`)
        }
        continue
      }

      try {
        mainWindow.webContents.send(item.eventName, item.data)
        item.sentAt = Date.now()

        const latency = item.sentAt - item.enqueuedAt
        this.stats.latencies.push(latency)
        // Keep only last 100 latencies for averaging
        if (this.stats.latencies.length > 100) {
          this.stats.latencies.shift()
        }

        this.stats.totalSent++

        if (process.env.DEBUG_IPC_BATCHING) {
          console.debug(
            `[CriticalEventQueue] Sent ${item.priority} event: ${item.eventName} (latency: ${latency}ms)`
          )
        }
      } catch (error) {
        console.error(
          `[CriticalEventQueue] Failed to send event ${item.eventName}:`,
          error
        )
        this.stats.totalDropped++
      }
    }
  }

  /**
   * Check if queue is empty
   */
  isEmpty(): boolean {
    return this.queue.length === 0
  }

  /**
   * Get current queue size
   */
  getQueueSize(): number {
    return this.queue.length
  }

  /**
   * Get queue statistics
   */
  getStats(): QueueStats {
    const averageLatency =
      this.stats.latencies.length > 0
        ? this.stats.latencies.reduce((a, b) => a + b, 0) / this.stats.latencies.length
        : 0

    return {
      queueSize: this.queue.length,
      totalSent: this.stats.totalSent,
      totalDropped: this.stats.totalDropped,
      averageLatency
    }
  }

  /**
   * Clear the queue and reset stats
   */
  reset(): void {
    this.queue = []
    this.stats = {
      totalSent: 0,
      totalDropped: 0,
      latencies: []
    }
  }
}

// ============================================================================
// Service Class
// ============================================================================

class IPCEventBatcher {
  private config: IPCEventBatcherConfig
  private batchTimer: NodeJS.Timeout | null = null
  private isActive: boolean = false
  private priorityQueue: CriticalEventQueue = new CriticalEventQueue()
  private mainWindow: BrowserWindow | null = null

  // Buffers for live transcription events
  private liveTranscriptionBuffer: {
    progress?: BatchedLiveTranscriptionUpdate['progress']
    segments: BatchedLiveTranscriptionUpdate['segments']
    diarizationStatus?: BatchedLiveTranscriptionUpdate['diarizationStatus']
  } = { segments: [] }

  // Buffers for streaming diarization events
  private streamingDiarizationBuffer: {
    segments: BatchedStreamingDiarizationUpdate['segments']
    speakerChanges: BatchedStreamingDiarizationUpdate['speakerChanges']
    status?: BatchedStreamingDiarizationUpdate['status']
    corrections: BatchedStreamingDiarizationUpdate['corrections']
    stats?: BatchedStreamingDiarizationUpdate['stats']
  } = { segments: [], speakerChanges: [], corrections: [] }

  // Buffers for live notes events
  private liveNotesBuffer: {
    notes: BatchedLiveNotesUpdate['notes']
    status?: BatchedLiveNotesUpdate['status']
    batchState?: BatchedLiveNotesUpdate['batchState']
    errors: BatchedLiveNotesUpdate['errors']
  } = { notes: [], errors: [] }

  // Statistics for debugging
  private stats = {
    liveTranscription: { eventsReceived: 0, batchesSent: 0 },
    streamingDiarization: { eventsReceived: 0, batchesSent: 0 },
    liveNotes: { eventsReceived: 0, batchesSent: 0 }
  }

  constructor(config?: Partial<IPCEventBatcherConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...config }
  }

  /**
   * Start the batching timer
   */
  start(): void {
    if (this.isActive) {
      return
    }

    this.isActive = true
    this.batchTimer = setInterval(() => {
      this.flushAllBuffers()
    }, this.config.batchIntervalMs)

    if (this.config.enableLogging) {
      console.log(`[IPCEventBatcher] Started with ${this.config.batchIntervalMs}ms interval`)
    }
  }

  /**
   * Stop the batching timer and flush remaining events
   */
  stop(): void {
    if (!this.isActive) {
      return
    }

    this.isActive = false
    if (this.batchTimer) {
      clearInterval(this.batchTimer)
      this.batchTimer = null
    }

    // Flush any remaining events (both batched and priority)
    this.flushAllBuffers()
    this.flushPriorityQueue()

    if (this.config.enableLogging) {
      console.log('[IPCEventBatcher] Stopped', this.stats)
    }
  }

  /**
   * Reset all buffers and statistics
   */
  reset(): void {
    this.liveTranscriptionBuffer = { segments: [] }
    this.streamingDiarizationBuffer = { segments: [], speakerChanges: [], corrections: [] }
    this.liveNotesBuffer = { notes: [], errors: [] }
    this.priorityQueue.reset()
    this.stats = {
      liveTranscription: { eventsReceived: 0, batchesSent: 0 },
      streamingDiarization: { eventsReceived: 0, batchesSent: 0 },
      liveNotes: { eventsReceived: 0, batchesSent: 0 }
    }
  }

  // ============================================================================
  // Live Transcription Event Buffering
  // ============================================================================

  /**
   * Buffer a live transcription progress update
   */
  bufferLiveTranscriptionProgress(progress: BatchedLiveTranscriptionUpdate['progress']): void {
    // Only keep the most recent progress update
    this.liveTranscriptionBuffer.progress = progress
    this.stats.liveTranscription.eventsReceived++
  }

  /**
   * Buffer a live transcription segment
   */
  bufferLiveTranscriptionSegment(segment: BatchedLiveTranscriptionUpdate['segments'][0]): void {
    this.liveTranscriptionBuffer.segments.push(segment)
    this.stats.liveTranscription.eventsReceived++
  }

  /**
   * Buffer a diarization status update
   */
  bufferDiarizationStatus(status: BatchedLiveTranscriptionUpdate['diarizationStatus']): void {
    // Only keep the most recent status
    this.liveTranscriptionBuffer.diarizationStatus = status
    this.stats.liveTranscription.eventsReceived++
  }

  // ============================================================================
  // Streaming Diarization Event Buffering
  // ============================================================================

  /**
   * Buffer a streaming diarization speaker segment
   */
  bufferStreamingDiarizationSegment(segment: BatchedStreamingDiarizationUpdate['segments'][0]): void {
    this.streamingDiarizationBuffer.segments.push(segment)
    this.stats.streamingDiarization.eventsReceived++
  }

  /**
   * Buffer a speaker change event
   */
  bufferSpeakerChange(event: BatchedStreamingDiarizationUpdate['speakerChanges'][0]): void {
    this.streamingDiarizationBuffer.speakerChanges.push(event)
    this.stats.streamingDiarization.eventsReceived++
  }

  /**
   * Buffer a streaming diarization status update
   */
  bufferStreamingDiarizationStatus(status: BatchedStreamingDiarizationUpdate['status']): void {
    // Only keep the most recent status
    this.streamingDiarizationBuffer.status = status
    this.stats.streamingDiarization.eventsReceived++
  }

  /**
   * Buffer a retroactive correction event
   */
  bufferCorrection(event: BatchedStreamingDiarizationUpdate['corrections'][0]): void {
    this.streamingDiarizationBuffer.corrections.push(event)
    this.stats.streamingDiarization.eventsReceived++
  }

  /**
   * Buffer speaker statistics (replaces previous)
   */
  bufferStats(stats: BatchedStreamingDiarizationUpdate['stats']): void {
    // Only keep the most recent stats
    this.streamingDiarizationBuffer.stats = stats
    this.stats.streamingDiarization.eventsReceived++
  }

  // ============================================================================
  // Live Notes Event Buffering
  // ============================================================================

  /**
   * Buffer live notes
   */
  bufferLiveNotes(notes: BatchedLiveNotesUpdate['notes']): void {
    this.liveNotesBuffer.notes.push(...notes)
    this.stats.liveNotes.eventsReceived++
  }

  /**
   * Buffer live notes status
   */
  bufferLiveNotesStatus(status: BatchedLiveNotesUpdate['status']): void {
    // Only keep the most recent status
    this.liveNotesBuffer.status = status
    this.stats.liveNotes.eventsReceived++
  }

  /**
   * Buffer live notes batch state
   */
  bufferLiveNotesBatchState(state: BatchedLiveNotesUpdate['batchState']): void {
    // Only keep the most recent batch state
    this.liveNotesBuffer.batchState = state
    this.stats.liveNotes.eventsReceived++
  }

  /**
   * Buffer live notes error
   */
  bufferLiveNotesError(error: BatchedLiveNotesUpdate['errors'][0]): void {
    this.liveNotesBuffer.errors.push(error)
    this.stats.liveNotes.eventsReceived++
  }

  // ============================================================================
  // Priority Event Dispatch Methods
  // ============================================================================

  /**
   * Send a critical event immediately (bypasses batching)
   * Critical events reach the renderer in <5ms
   */
  sendCriticalEvent(eventName: string, data: any): void {
    this.priorityQueue.enqueue(eventName, data, EventPriority.CRITICAL)
    this.flushPriorityQueue()
  }

  /**
   * Send a high-priority event (waits max 50-100ms)
   * High priority events are batched but with higher frequency
   */
  sendHighPriorityEvent(eventName: string, data: any): void {
    this.priorityQueue.enqueue(eventName, data, EventPriority.HIGH)
    this.flushPriorityQueue()
  }

  /**
   * Determine if an event is critical based on its name and data
   * @returns true if the event should bypass batching
   */
  static isCriticalEvent(eventName: string, data?: any): boolean {
    // Error/failure events are always critical
    if (eventName.includes(':error') || eventName.includes(':failure')) {
      return true
    }

    // Health status changes are critical
    if (eventName.includes('diarizationHealth:')) {
      return true
    }

    // License/auth required events are critical (user action needed)
    if (eventName.includes('licenseRequired')) {
      return true
    }

    // Validation failure events are critical
    if (eventName.includes('Validation:') && eventName.includes('Complete')) {
      // Only critical if it's a failure
      return data?.status === 'failed' || data?.success === false
    }

    return false
  }

  /**
   * Determine if an event is high priority
   * @returns true if the event should flush more frequently
   */
  static isHighPriorityEvent(eventName: string): boolean {
    // Completion signals
    if (
      eventName.includes(':complete') ||
      eventName.includes(':completed') ||
      eventName.includes('Generated') ||
      eventName.includes('Extracted')
    ) {
      return true
    }

    // Recovery/validation start events
    if (
      eventName.includes('Recovery') ||
      eventName.includes('Validation:') ||
      eventName.includes('Start')
    ) {
      return true
    }

    return false
  }

  // ============================================================================
  // Flushing
  // ============================================================================

  /**
   * Flush the priority queue
   */
  private flushPriorityQueue(): void {
    const mainWindow = this.mainWindow || BrowserWindow.getAllWindows()[0]
    if (!mainWindow || mainWindow.isDestroyed()) {
      return
    }

    this.priorityQueue.flush(mainWindow)
  }

  /**
   * Flush all buffers and send batched updates
   */
  private flushAllBuffers(): void {
    const mainWindow = BrowserWindow.getAllWindows()[0]
    if (!mainWindow || mainWindow.isDestroyed()) {
      return
    }

    this.flushLiveTranscriptionBuffer(mainWindow)
    this.flushStreamingDiarizationBuffer(mainWindow)
    this.flushLiveNotesBuffer(mainWindow)
  }

  /**
   * Flush live transcription buffer
   */
  private flushLiveTranscriptionBuffer(mainWindow: BrowserWindow): void {
    const buffer = this.liveTranscriptionBuffer

    // Check if there's anything to send
    if (!buffer.progress && buffer.segments.length === 0 && !buffer.diarizationStatus) {
      return
    }

    const batchedUpdate: BatchedLiveTranscriptionUpdate = {
      progress: buffer.progress,
      segments: [...buffer.segments],
      diarizationStatus: buffer.diarizationStatus,
      batchTimestamp: Date.now()
    }

    mainWindow.webContents.send('liveTranscription:batchedUpdate', batchedUpdate)
    this.stats.liveTranscription.batchesSent++

    // Clear the buffer
    this.liveTranscriptionBuffer = { segments: [] }

    if (this.config.enableLogging) {
      console.log(`[IPCEventBatcher] Flushed liveTranscription: ${batchedUpdate.segments.length} segments`)
    }
  }

  /**
   * Flush streaming diarization buffer
   */
  private flushStreamingDiarizationBuffer(mainWindow: BrowserWindow): void {
    const buffer = this.streamingDiarizationBuffer

    // Check if there's anything to send
    if (
      buffer.segments.length === 0 &&
      buffer.speakerChanges.length === 0 &&
      !buffer.status &&
      buffer.corrections.length === 0 &&
      !buffer.stats
    ) {
      return
    }

    const batchedUpdate: BatchedStreamingDiarizationUpdate = {
      segments: [...buffer.segments],
      speakerChanges: [...buffer.speakerChanges],
      status: buffer.status,
      corrections: [...buffer.corrections],
      stats: buffer.stats,
      batchTimestamp: Date.now()
    }

    try {
      mainWindow.webContents.send('streamingDiarization:batchedUpdate', batchedUpdate)
      this.stats.streamingDiarization.batchesSent++

      // Debug logging: IPC event sent successfully
      diarizationDebugService.logIPCEvent(
        'streamingDiarization:batchedUpdate',
        {
          segmentsCount: batchedUpdate.segments.length,
          speakerChangesCount: batchedUpdate.speakerChanges.length,
          hasStatus: !!batchedUpdate.status,
          correctionsCount: batchedUpdate.corrections.length,
          hasStats: !!batchedUpdate.stats,
          speakers: batchedUpdate.segments.map(s => s.speaker).filter((v, i, a) => a.indexOf(v) === i)
        },
        true
      )

      // Log each speaker change event individually for detailed tracking
      for (const speakerChange of batchedUpdate.speakerChanges) {
        diarizationDebugService.logIPCEvent(
          'streamingDiarization:speakerChange',
          speakerChange,
          true
        )
      }
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error)

      // Debug logging: IPC event failed
      diarizationDebugService.logIPCEvent(
        'streamingDiarization:batchedUpdate',
        {
          segmentsCount: batchedUpdate.segments.length,
          speakerChangesCount: batchedUpdate.speakerChanges.length
        },
        false,
        errorMsg
      )
    }

    // Clear the buffer
    this.streamingDiarizationBuffer = { segments: [], speakerChanges: [], corrections: [] }

    if (this.config.enableLogging) {
      console.log(`[IPCEventBatcher] Flushed streamingDiarization: ${batchedUpdate.segments.length} segments, ${batchedUpdate.speakerChanges.length} changes`)
    }
  }

  /**
   * Flush live notes buffer
   */
  private flushLiveNotesBuffer(mainWindow: BrowserWindow): void {
    const buffer = this.liveNotesBuffer

    // Check if there's anything to send
    if (
      buffer.notes.length === 0 &&
      !buffer.status &&
      !buffer.batchState &&
      buffer.errors.length === 0
    ) {
      return
    }

    const batchedUpdate: BatchedLiveNotesUpdate = {
      notes: [...buffer.notes],
      status: buffer.status,
      batchState: buffer.batchState,
      errors: [...buffer.errors],
      batchTimestamp: Date.now()
    }

    mainWindow.webContents.send('liveNotes:batchedUpdate', batchedUpdate)
    this.stats.liveNotes.batchesSent++

    // Clear the buffer
    this.liveNotesBuffer = { notes: [], errors: [] }

    if (this.config.enableLogging) {
      console.log(`[IPCEventBatcher] Flushed liveNotes: ${batchedUpdate.notes.length} notes`)
    }
  }

  /**
   * Get current statistics including priority queue stats
   */
  getStats(): typeof this.stats & { priorityQueue?: QueueStats } {
    return {
      ...this.stats,
      priorityQueue: this.priorityQueue.getStats()
    }
  }

  /**
   * Get priority queue statistics
   */
  getPriorityQueueStats(): QueueStats {
    return this.priorityQueue.getStats()
  }

  /**
   * Check if batcher is active
   */
  isRunning(): boolean {
    return this.isActive
  }

  /**
   * Update configuration
   */
  updateConfig(config: Partial<IPCEventBatcherConfig>): void {
    const wasActive = this.isActive

    if (wasActive) {
      this.stop()
    }

    this.config = { ...this.config, ...config }

    if (wasActive) {
      this.start()
    }
  }
}

// ============================================================================
// Singleton Export
// ============================================================================

export const ipcEventBatcher = new IPCEventBatcher()

// Also export the class for testing
export { IPCEventBatcher }
