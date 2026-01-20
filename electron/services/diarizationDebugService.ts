/**
 * Diarization Debug Service
 *
 * Provides comprehensive debug logging to diagnose why only one speaker
 * appears during live recording despite multiple speakers being present.
 *
 * Tracks:
 * 1. Real-time diarization events (speaker segments, speaker IDs, timestamps)
 * 2. Audio chunk processing (chunk size, sample rate, sent to diarization engine)
 * 3. PyAnnote model outputs (embedding extraction, clustering, speaker change detection)
 * 4. IPC event emissions (speaker:change events firing and sent to renderer)
 * 5. Audio quality metrics (RMS, peak levels)
 */

import { EventEmitter } from 'events'
import { BrowserWindow } from 'electron'

// ============================================================================
// Types
// ============================================================================

export interface AudioChunkMetrics {
  timestamp: number
  chunkSize: number
  sampleRate: number
  rmsLevel: number
  peakLevel: number
  sentToDiarization: boolean
  processingTimeMs?: number
}

export interface SpeakerSegmentDebug {
  timestamp: number
  segmentId: string
  speaker: string
  startTime: number
  endTime: number
  confidence: number
  isFinal: boolean
  wasRetroactivelyCorrected?: boolean
  processingLatencyMs?: number
}

export interface SpeakerChangeDebug {
  timestamp: number
  time: number
  fromSpeaker: string | null
  toSpeaker: string
  confidence: number
  eventFired: boolean
  sentToRenderer: boolean
}

export interface IPCEventDebug {
  timestamp: number
  eventName: string
  eventData: any
  success: boolean
  error?: string
}

export interface PyAnnoteOutputDebug {
  timestamp: number
  outputType: 'embedding' | 'clustering' | 'speaker_change' | 'segment' | 'stats' | 'ready' | 'error'
  success: boolean
  data?: any
  error?: string
  processingTimeMs?: number
}

export interface DebugSnapshot {
  timestamp: number
  sessionId: string | null
  meetingId: string | null
  isActive: boolean

  // Speakers
  speakersDetected: string[]
  currentSpeaker: string | null
  lastSpeakerChangeTimestamp: number | null
  speakerChangeCount: number

  // Audio processing
  totalAudioChunksProcessed: number
  totalAudioDurationSec: number
  lastAudioChunkTimestamp: number | null
  averageRmsLevel: number
  averagePeakLevel: number

  // Diarization
  diarizationStatus: string
  coldStartComplete: boolean
  totalSegmentsEmitted: number
  lastSegmentTimestamp: number | null

  // IPC
  totalIPCEventsEmitted: number
  lastIPCEventTimestamp: number | null
  ipcErrors: number

  // Confidence scores
  averageConfidence: number
  minConfidence: number
  maxConfidence: number

  // Recent events (last 50)
  recentAudioChunks: AudioChunkMetrics[]
  recentSpeakerSegments: SpeakerSegmentDebug[]
  recentSpeakerChanges: SpeakerChangeDebug[]
  recentIPCEvents: IPCEventDebug[]
  recentPyAnnoteOutputs: PyAnnoteOutputDebug[]
}

// ============================================================================
// Constants
// ============================================================================

const MAX_HISTORY_SIZE = 50 // Keep last 50 events of each type
const DEBUG_LOG_PREFIX = '[DiarizationDebug]'
const DEBUG_ENABLED_KEY = 'DIARIZATION_DEBUG_ENABLED'

// ============================================================================
// Service State
// ============================================================================

class DiarizationDebugService extends EventEmitter {
  private isEnabled: boolean = false
  private sessionId: string | null = null
  private meetingId: string | null = null
  private isActive: boolean = false

  // Tracking data
  private speakersDetected: Set<string> = new Set()
  private currentSpeaker: string | null = null
  private lastSpeakerChangeTimestamp: number | null = null
  private speakerChangeCount: number = 0

  // Audio processing
  private totalAudioChunksProcessed: number = 0
  private totalAudioBytes: number = 0
  private sampleRate: number = 16000
  private lastAudioChunkTimestamp: number | null = null
  private rmsLevels: number[] = []
  private peakLevels: number[] = []

  // Diarization
  private diarizationStatus: string = 'idle'
  private coldStartComplete: boolean = false
  private totalSegmentsEmitted: number = 0
  private lastSegmentTimestamp: number | null = null

  // IPC
  private totalIPCEventsEmitted: number = 0
  private lastIPCEventTimestamp: number | null = null
  private ipcErrors: number = 0

  // Confidence tracking
  private confidenceScores: number[] = []

  // Event history (circular buffers)
  private audioChunkHistory: AudioChunkMetrics[] = []
  private speakerSegmentHistory: SpeakerSegmentDebug[] = []
  private speakerChangeHistory: SpeakerChangeDebug[] = []
  private ipcEventHistory: IPCEventDebug[] = []
  private pyannoteOutputHistory: PyAnnoteOutputDebug[] = []

  constructor() {
    super()
    // Check if debug is enabled via environment or localStorage
    this.isEnabled = process.env[DEBUG_ENABLED_KEY] === 'true' || process.env.NODE_ENV === 'development'
  }

  // ============================================================================
  // Public API
  // ============================================================================

  /**
   * Enable debug logging
   */
  enable(): void {
    this.isEnabled = true
    this.log('Debug logging ENABLED')
  }

  /**
   * Disable debug logging
   */
  disable(): void {
    this.log('Debug logging DISABLED')
    this.isEnabled = false
  }

  /**
   * Check if debug logging is enabled
   */
  isDebugEnabled(): boolean {
    return this.isEnabled
  }

  /**
   * Start a new debug session
   */
  startSession(meetingId: string): void {
    this.sessionId = `debug-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`
    this.meetingId = meetingId
    this.isActive = true
    this.reset()

    this.log(`Session started for meeting: ${meetingId}`, { sessionId: this.sessionId })
    this.logGroup('=== DIARIZATION DEBUG SESSION STARTED ===')
  }

  /**
   * End the current debug session
   */
  endSession(): void {
    if (!this.sessionId) return

    const snapshot = this.getSnapshot()
    this.logGroup('=== DIARIZATION DEBUG SESSION ENDED ===')
    this.log('Final session summary:', snapshot)
    this.logGroupEnd()

    this.emit('session:ended', snapshot)

    this.sessionId = null
    this.meetingId = null
    this.isActive = false
  }

  /**
   * Log audio chunk processing
   */
  logAudioChunk(
    chunkSize: number,
    sampleRate: number,
    sentToDiarization: boolean,
    audioBuffer?: Buffer
  ): void {
    if (!this.isEnabled || !this.isActive) return

    const timestamp = Date.now()
    this.totalAudioChunksProcessed++
    this.totalAudioBytes += chunkSize
    this.lastAudioChunkTimestamp = timestamp
    this.sampleRate = sampleRate

    // Calculate audio metrics if buffer is provided
    let rmsLevel = 0
    let peakLevel = 0

    if (audioBuffer && audioBuffer.length > 0) {
      const samples = this.bufferToSamples(audioBuffer)
      rmsLevel = this.calculateRMS(samples)
      peakLevel = this.calculatePeak(samples)

      this.rmsLevels.push(rmsLevel)
      this.peakLevels.push(peakLevel)

      // Keep only last 1000 samples for averaging
      if (this.rmsLevels.length > 1000) this.rmsLevels.shift()
      if (this.peakLevels.length > 1000) this.peakLevels.shift()
    }

    const metrics: AudioChunkMetrics = {
      timestamp,
      chunkSize,
      sampleRate,
      rmsLevel,
      peakLevel,
      sentToDiarization
    }

    this.addToHistory(this.audioChunkHistory, metrics)

    // Log every 10th chunk to avoid spam
    if (this.totalAudioChunksProcessed % 10 === 0) {
      this.log(`Audio chunk #${this.totalAudioChunksProcessed}`, {
        chunkSize,
        sampleRate,
        rmsLevel: rmsLevel.toFixed(4),
        peakLevel: peakLevel.toFixed(4),
        sentToDiarization,
        totalDurationSec: this.getTotalAudioDurationSec().toFixed(2)
      })
    }

    this.emit('audio:chunk', metrics)
  }

  /**
   * Log speaker segment from diarization
   */
  logSpeakerSegment(
    segmentId: string,
    speaker: string,
    startTime: number,
    endTime: number,
    confidence: number,
    isFinal: boolean,
    wasRetroactivelyCorrected?: boolean
  ): void {
    if (!this.isEnabled || !this.isActive) return

    const timestamp = Date.now()
    this.totalSegmentsEmitted++
    this.lastSegmentTimestamp = timestamp
    this.speakersDetected.add(speaker)
    this.confidenceScores.push(confidence)

    // Keep only last 1000 confidence scores
    if (this.confidenceScores.length > 1000) this.confidenceScores.shift()

    const debugInfo: SpeakerSegmentDebug = {
      timestamp,
      segmentId,
      speaker,
      startTime,
      endTime,
      confidence,
      isFinal,
      wasRetroactivelyCorrected
    }

    this.addToHistory(this.speakerSegmentHistory, debugInfo)

    this.log(`Speaker segment: ${speaker}`, {
      segmentId,
      timeRange: `${startTime.toFixed(2)}s - ${endTime.toFixed(2)}s`,
      confidence: confidence.toFixed(3),
      isFinal,
      wasRetroactivelyCorrected,
      totalSpeakers: this.speakersDetected.size,
      speakersList: Array.from(this.speakersDetected)
    })

    this.emit('segment:received', debugInfo)
  }

  /**
   * Log speaker change event
   */
  logSpeakerChange(
    time: number,
    fromSpeaker: string | null,
    toSpeaker: string,
    confidence: number,
    eventFired: boolean = true,
    sentToRenderer: boolean = true
  ): void {
    if (!this.isEnabled || !this.isActive) return

    const timestamp = Date.now()
    this.speakerChangeCount++
    this.lastSpeakerChangeTimestamp = timestamp
    this.currentSpeaker = toSpeaker
    this.speakersDetected.add(toSpeaker)

    const debugInfo: SpeakerChangeDebug = {
      timestamp,
      time,
      fromSpeaker,
      toSpeaker,
      confidence,
      eventFired,
      sentToRenderer
    }

    this.addToHistory(this.speakerChangeHistory, debugInfo)

    this.log(`SPEAKER CHANGE #${this.speakerChangeCount}`, {
      from: fromSpeaker || 'none',
      to: toSpeaker,
      atTime: `${time.toFixed(2)}s`,
      confidence: confidence.toFixed(3),
      eventFired,
      sentToRenderer,
      totalSpeakers: this.speakersDetected.size
    })

    this.emit('speaker:change', debugInfo)
  }

  /**
   * Log IPC event emission
   */
  logIPCEvent(eventName: string, eventData: any, success: boolean, error?: string): void {
    if (!this.isEnabled || !this.isActive) return

    const timestamp = Date.now()
    this.totalIPCEventsEmitted++
    this.lastIPCEventTimestamp = timestamp

    if (!success) {
      this.ipcErrors++
    }

    const debugInfo: IPCEventDebug = {
      timestamp,
      eventName,
      eventData: this.sanitizeEventData(eventData),
      success,
      error
    }

    this.addToHistory(this.ipcEventHistory, debugInfo)

    // Log all speaker-related IPC events
    if (eventName.includes('speaker') || eventName.includes('diarization') || eventName.includes('Diarization')) {
      this.log(`IPC Event: ${eventName}`, {
        success,
        error,
        dataPreview: JSON.stringify(this.sanitizeEventData(eventData)).substring(0, 200)
      })
    }

    this.emit('ipc:event', debugInfo)
  }

  /**
   * Log PyAnnote/diarization engine output
   */
  logPyAnnoteOutput(
    outputType: PyAnnoteOutputDebug['outputType'],
    success: boolean,
    data?: any,
    error?: string,
    processingTimeMs?: number
  ): void {
    if (!this.isEnabled || !this.isActive) return

    const timestamp = Date.now()

    const debugInfo: PyAnnoteOutputDebug = {
      timestamp,
      outputType,
      success,
      data: this.sanitizeEventData(data),
      error,
      processingTimeMs
    }

    this.addToHistory(this.pyannoteOutputHistory, debugInfo)

    this.log(`PyAnnote output: ${outputType}`, {
      success,
      processingTimeMs,
      error,
      dataPreview: data ? JSON.stringify(this.sanitizeEventData(data)).substring(0, 200) : undefined
    })

    this.emit('pyannote:output', debugInfo)
  }

  /**
   * Log diarization status change
   */
  logStatusChange(status: string, message?: string): void {
    if (!this.isEnabled || !this.isActive) return

    const previousStatus = this.diarizationStatus
    this.diarizationStatus = status

    if (status === 'active' && message?.includes('Cold-start complete')) {
      this.coldStartComplete = true
    }

    this.log(`Diarization status: ${previousStatus} -> ${status}`, { message })

    this.emit('status:change', { previousStatus, status, message })
  }

  /**
   * Get current debug snapshot
   */
  getSnapshot(): DebugSnapshot {
    const avgRms = this.rmsLevels.length > 0
      ? this.rmsLevels.reduce((a, b) => a + b, 0) / this.rmsLevels.length
      : 0

    const avgPeak = this.peakLevels.length > 0
      ? this.peakLevels.reduce((a, b) => a + b, 0) / this.peakLevels.length
      : 0

    const avgConfidence = this.confidenceScores.length > 0
      ? this.confidenceScores.reduce((a, b) => a + b, 0) / this.confidenceScores.length
      : 0

    const minConfidence = this.confidenceScores.length > 0
      ? Math.min(...this.confidenceScores)
      : 0

    const maxConfidence = this.confidenceScores.length > 0
      ? Math.max(...this.confidenceScores)
      : 0

    return {
      timestamp: Date.now(),
      sessionId: this.sessionId,
      meetingId: this.meetingId,
      isActive: this.isActive,

      speakersDetected: Array.from(this.speakersDetected),
      currentSpeaker: this.currentSpeaker,
      lastSpeakerChangeTimestamp: this.lastSpeakerChangeTimestamp,
      speakerChangeCount: this.speakerChangeCount,

      totalAudioChunksProcessed: this.totalAudioChunksProcessed,
      totalAudioDurationSec: this.getTotalAudioDurationSec(),
      lastAudioChunkTimestamp: this.lastAudioChunkTimestamp,
      averageRmsLevel: avgRms,
      averagePeakLevel: avgPeak,

      diarizationStatus: this.diarizationStatus,
      coldStartComplete: this.coldStartComplete,
      totalSegmentsEmitted: this.totalSegmentsEmitted,
      lastSegmentTimestamp: this.lastSegmentTimestamp,

      totalIPCEventsEmitted: this.totalIPCEventsEmitted,
      lastIPCEventTimestamp: this.lastIPCEventTimestamp,
      ipcErrors: this.ipcErrors,

      averageConfidence: avgConfidence,
      minConfidence,
      maxConfidence,

      recentAudioChunks: [...this.audioChunkHistory],
      recentSpeakerSegments: [...this.speakerSegmentHistory],
      recentSpeakerChanges: [...this.speakerChangeHistory],
      recentIPCEvents: [...this.ipcEventHistory],
      recentPyAnnoteOutputs: [...this.pyannoteOutputHistory]
    }
  }

  /**
   * Send snapshot to renderer process via IPC
   */
  sendSnapshotToRenderer(): void {
    const mainWindow = BrowserWindow.getAllWindows()[0]
    if (!mainWindow || mainWindow.isDestroyed()) return

    const snapshot = this.getSnapshot()
    mainWindow.webContents.send('diarizationDebug:snapshot', snapshot)
  }

  // ============================================================================
  // Private Methods
  // ============================================================================

  private reset(): void {
    this.speakersDetected.clear()
    this.currentSpeaker = null
    this.lastSpeakerChangeTimestamp = null
    this.speakerChangeCount = 0

    this.totalAudioChunksProcessed = 0
    this.totalAudioBytes = 0
    this.lastAudioChunkTimestamp = null
    this.rmsLevels = []
    this.peakLevels = []

    this.diarizationStatus = 'idle'
    this.coldStartComplete = false
    this.totalSegmentsEmitted = 0
    this.lastSegmentTimestamp = null

    this.totalIPCEventsEmitted = 0
    this.lastIPCEventTimestamp = null
    this.ipcErrors = 0

    this.confidenceScores = []

    this.audioChunkHistory = []
    this.speakerSegmentHistory = []
    this.speakerChangeHistory = []
    this.ipcEventHistory = []
    this.pyannoteOutputHistory = []
  }

  private log(message: string, data?: any): void {
    if (!this.isEnabled) return

    const timestamp = new Date().toISOString()
    if (data) {
      console.log(`${DEBUG_LOG_PREFIX} [${timestamp}] ${message}`, data)
    } else {
      console.log(`${DEBUG_LOG_PREFIX} [${timestamp}] ${message}`)
    }
  }

  private logGroup(label: string): void {
    if (!this.isEnabled) return
    console.group(`${DEBUG_LOG_PREFIX} ${label}`)
  }

  private logGroupEnd(): void {
    if (!this.isEnabled) return
    console.groupEnd()
  }

  private addToHistory<T>(history: T[], item: T): void {
    history.push(item)
    if (history.length > MAX_HISTORY_SIZE) {
      history.shift()
    }
  }

  private getTotalAudioDurationSec(): number {
    const bytesPerSample = 2 // 16-bit audio
    return this.totalAudioBytes / (this.sampleRate * bytesPerSample)
  }

  private bufferToSamples(buffer: Buffer): number[] {
    const samples: number[] = []
    for (let i = 0; i < buffer.length - 1; i += 2) {
      // Read 16-bit signed integer (little-endian)
      const sample = buffer.readInt16LE(i) / 32768 // Normalize to -1.0 to 1.0
      samples.push(sample)
    }
    return samples
  }

  private calculateRMS(samples: number[]): number {
    if (samples.length === 0) return 0
    const sumSquares = samples.reduce((sum, sample) => sum + sample * sample, 0)
    return Math.sqrt(sumSquares / samples.length)
  }

  private calculatePeak(samples: number[]): number {
    if (samples.length === 0) return 0
    return Math.max(...samples.map(Math.abs))
  }

  private sanitizeEventData(data: any): any {
    if (!data) return data

    // Remove or truncate large data to prevent log bloat
    if (typeof data === 'object') {
      const sanitized: any = {}
      for (const key of Object.keys(data)) {
        const value = data[key]
        if (Buffer.isBuffer(value)) {
          sanitized[key] = `<Buffer ${value.length} bytes>`
        } else if (Array.isArray(value) && value.length > 10) {
          sanitized[key] = `<Array ${value.length} items>`
        } else if (typeof value === 'string' && value.length > 500) {
          sanitized[key] = value.substring(0, 500) + '...'
        } else {
          sanitized[key] = value
        }
      }
      return sanitized
    }

    return data
  }
}

// ============================================================================
// Singleton Export
// ============================================================================

export const diarizationDebugService = new DiarizationDebugService()

// Export class for testing
export { DiarizationDebugService }
