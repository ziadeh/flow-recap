/**
 * Streaming Diarization Service
 *
 * Provides real-time speaker diarization using chunked processing.
 * This service runs in parallel with live transcription to assign speaker
 * labels to transcript segments as they arrive.
 *
 * Key Features:
 * - 1-3 second audio window processing for low latency
 * - Buffering mechanism for accurate speaker embedding extraction
 * - Online speaker clustering with stable speaker ID assignment
 * - Sliding window approach with overlap for speaker transition detection
 * - Real-time speaker segment events emitted to UI
 * - Retroactive speaker label correction when better evidence becomes available
 * - Cold-start handling with confidence adjustment
 */

import { EventEmitter } from 'events'
import { spawn, ChildProcess } from 'child_process'
import * as path from 'path'
import * as fs from 'fs'
import * as readline from 'readline'
import { pythonEnvironment } from './pythonEnvironment'

// Electron app - dynamically imported to support testing
let app: { isPackaged?: boolean } | undefined
try {
  app = require('electron').app
} catch {
  app = undefined
}

// ============================================================================
// Types
// ============================================================================

export type StreamingDiarizationStatus =
  | 'idle'
  | 'initializing'
  | 'ready'
  | 'active'
  | 'paused'
  | 'stopping'
  | 'error'

export interface StreamingDiarizationConfig {
  /** Sample rate of audio (default: 16000) */
  sampleRate?: number
  /** Audio buffer window duration in seconds (default: 2.0) */
  windowDuration?: number
  /** Hop duration between windows in seconds (default: 0.5) */
  hopDuration?: number
  /** Overlap between consecutive windows (default: 0.25) */
  overlapDuration?: number
  /** Speaker similarity threshold for clustering (default: 0.7) */
  similarityThreshold?: number
  /** Maximum number of speakers to track (default: 10) */
  maxSpeakers?: number
  /** Device for inference ('cuda', 'cpu', 'auto') */
  device?: 'cuda' | 'cpu' | 'auto'
  /** Minimum audio duration before diarization starts (cold-start) */
  coldStartDuration?: number
  /** Enable retroactive speaker label correction */
  enableRetroactiveCorrection?: boolean
}

export interface SpeakerSegment {
  /** Unique segment ID */
  id: string
  /** Speaker label (e.g., "Speaker_0") */
  speaker: string
  /** Start time in seconds */
  startTime: number
  /** End time in seconds */
  endTime: number
  /** Confidence score (0.0-1.0) */
  confidence: number
  /** Whether this segment is final or may be updated */
  isFinal: boolean
  /** Whether this was retroactively corrected */
  wasRetroactivelyCorrected?: boolean
}

export interface SpeakerChangeEvent {
  /** Timestamp of the speaker change in seconds */
  time: number
  /** Previous speaker (null if first speaker) */
  fromSpeaker: string | null
  /** New speaker */
  toSpeaker: string
  /** Confidence in the change detection */
  confidence: number
}

export interface StreamingDiarizationState {
  status: StreamingDiarizationStatus
  meetingId: string | null
  numSpeakersDetected: number
  totalAudioProcessed: number
  lastSegmentTime: number | null
  coldStartComplete: boolean
  error?: string
}

export interface SpeakerStats {
  speakerId: string
  totalDuration: number
  segmentCount: number
  percentage: number
  firstAppearance: number
  lastAppearance: number
}

export interface RetroactiveCorrectionEvent {
  /** Original speaker label */
  originalSpeaker: string
  /** Corrected speaker label */
  correctedSpeaker: string
  /** Time range affected (start in seconds) */
  startTime: number
  /** Time range affected (end in seconds) */
  endTime: number
  /** Segments that were updated */
  affectedSegmentIds: string[]
  /** Reason for correction */
  reason: string
}

// Python message types from live_diarize.py
interface PythonDiarizationMessage {
  type: 'ready' | 'status' | 'speaker_segment' | 'speaker_change' | 'speaker_stats' | 'complete' | 'error' | 'correction'
  message?: string
  speaker?: string
  start?: number
  end?: number
  confidence?: number
  from_speaker?: string
  to_speaker?: string
  time?: number
  num_speakers?: number
  total_duration?: number
  speaker_stats?: Record<string, any>
  backend?: string
  device?: string
  // Correction-specific fields
  original_speaker?: string
  corrected_speaker?: string
  affected_segments?: string[]
  reason?: string
  code?: string
}

// ============================================================================
// Constants
// ============================================================================

const SPEAKER_SEGMENT_EVENT = 'streaming-diarization:segment'
const SPEAKER_CHANGE_EVENT = 'streaming-diarization:speaker-change'
const STATUS_EVENT = 'streaming-diarization:status'
const CORRECTION_EVENT = 'streaming-diarization:correction'
const STATS_EVENT = 'streaming-diarization:stats'

const DEFAULT_CONFIG: Required<StreamingDiarizationConfig> = {
  sampleRate: 16000,
  windowDuration: 2.0,
  hopDuration: 0.5,
  overlapDuration: 0.25,
  // Lower threshold = more speakers detected (more sensitive to voice differences)
  // 0.35 provides better speaker separation for typical voice differences
  // (typical same-speaker similarity: 0.8-0.95, different speakers: 0.2-0.5)
  similarityThreshold: 0.35,
  maxSpeakers: 10,
  device: 'auto',
  coldStartDuration: 3.0,
  enableRetroactiveCorrection: true
}

// ============================================================================
// Utility Functions
// ============================================================================

function getPythonScriptsDir(): string {
  if (app?.isPackaged) {
    return path.join(process.resourcesPath || '', 'python')
  }
  return path.join(__dirname, '../python')
}

function findPythonPath(): string {
  const scriptsDir = getPythonScriptsDir()

  // Check for bundled Python executable first (highest priority for packaged apps)
  if (app?.isPackaged) {
    const bundledExecutable = process.platform === 'win32'
      ? path.join(scriptsDir, 'transcription_bundle.exe')
      : path.join(scriptsDir, 'transcription_bundle')

    if (fs.existsSync(bundledExecutable)) {
      console.log('[Streaming Diarization] Using bundled Python executable:', bundledExecutable)
      return bundledExecutable
    }
  }

  const venvDirs = ['venv-3.12', 'venv']

  for (const venvName of venvDirs) {
    const venvPath = path.join(scriptsDir, venvName)
    const venvPython = process.platform === 'win32'
      ? path.join(venvPath, 'Scripts', 'python.exe')
      : path.join(venvPath, 'bin', 'python')

    if (fs.existsSync(venvPython)) {
      return venvPython
    }
  }

  if (process.env.PYTHON_PATH && fs.existsSync(process.env.PYTHON_PATH)) {
    return process.env.PYTHON_PATH
  }

  return process.platform === 'win32' ? 'python' : 'python3'
}

function generateSegmentId(): string {
  return `diar-seg-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`
}

// ============================================================================
// Service State
// ============================================================================

const progressEmitter = new EventEmitter()

let currentState: StreamingDiarizationState = {
  status: 'idle',
  meetingId: null,
  numSpeakersDetected: 0,
  totalAudioProcessed: 0,
  lastSegmentTime: null,
  coldStartComplete: false
}

let diarizationProcess: ChildProcess | null = null
let isProcessReady = false
let currentConfig: StreamingDiarizationConfig = { ...DEFAULT_CONFIG }

// Audio buffering for chunked processing
let audioBuffer: Buffer[] = []
let totalBufferedBytes = 0
let lastProcessedTime = 0

// Segment tracking for retroactive correction
let segmentHistory: Map<string, SpeakerSegment> = new Map()
let speakerMappingHistory: Map<string, string> = new Map() // For tracking speaker ID stability

// Speaker statistics
let speakerStatistics: Map<string, SpeakerStats> = new Map()

// Cold-start tracking
let coldStartAudioAccumulated = 0
let coldStartConfidenceMultiplier = 0.5 // Lower confidence during cold-start

// ============================================================================
// Event Emitters
// ============================================================================

function emitSpeakerSegment(segment: SpeakerSegment): void {
  progressEmitter.emit(SPEAKER_SEGMENT_EVENT, segment)
}

function emitSpeakerChange(event: SpeakerChangeEvent): void {
  progressEmitter.emit(SPEAKER_CHANGE_EVENT, event)
}

function emitStatus(status: StreamingDiarizationStatus, message?: string): void {
  progressEmitter.emit(STATUS_EVENT, { status, message, timestamp: Date.now() })
}

function emitCorrection(event: RetroactiveCorrectionEvent): void {
  progressEmitter.emit(CORRECTION_EVENT, event)
}

function emitStats(stats: Record<string, SpeakerStats>): void {
  progressEmitter.emit(STATS_EVENT, stats)
}

// ============================================================================
// State Management
// ============================================================================

function updateState(updates: Partial<StreamingDiarizationState>): void {
  currentState = { ...currentState, ...updates }
}

function resetState(): void {
  currentState = {
    status: 'idle',
    meetingId: null,
    numSpeakersDetected: 0,
    totalAudioProcessed: 0,
    lastSegmentTime: null,
    coldStartComplete: false
  }
  audioBuffer = []
  totalBufferedBytes = 0
  lastProcessedTime = 0
  segmentHistory.clear()
  speakerMappingHistory.clear()
  speakerStatistics.clear()
  coldStartAudioAccumulated = 0
  coldStartConfidenceMultiplier = 0.5
}

// ============================================================================
// Cold-Start Handling
// ============================================================================

/**
 * Handle cold-start scenario where initial chunks have lower confidence
 * until enough speaker examples accumulate
 */
function updateColdStartState(audioBytes: number): void {
  const sampleRate = currentConfig.sampleRate || DEFAULT_CONFIG.sampleRate
  const bytesPerSample = 2 // 16-bit audio
  const audioSeconds = audioBytes / (sampleRate * bytesPerSample)

  coldStartAudioAccumulated += audioSeconds

  const coldStartDuration = currentConfig.coldStartDuration || DEFAULT_CONFIG.coldStartDuration

  if (coldStartAudioAccumulated >= coldStartDuration && !currentState.coldStartComplete) {
    updateState({ coldStartComplete: true })
    coldStartConfidenceMultiplier = 1.0
    console.log(`[StreamingDiarization] Cold-start complete after ${coldStartAudioAccumulated.toFixed(1)}s of audio`)
    emitStatus('active', 'Cold-start complete, full confidence diarization active')
  } else if (!currentState.coldStartComplete) {
    // Gradually increase confidence multiplier during cold-start
    coldStartConfidenceMultiplier = Math.min(1.0, 0.5 + (coldStartAudioAccumulated / coldStartDuration) * 0.5)
  }
}

// ============================================================================
// Speaker ID Stability
// ============================================================================

/**
 * Ensure speaker IDs remain stable across chunks to prevent the same speaker
 * from being assigned different IDs over time
 */
function stabilizeSpeakerId(rawSpeakerId: string): string {
  // If we've seen this mapping before, use the stable ID
  if (speakerMappingHistory.has(rawSpeakerId)) {
    return speakerMappingHistory.get(rawSpeakerId)!
  }

  // New speaker, create stable mapping
  speakerMappingHistory.set(rawSpeakerId, rawSpeakerId)
  return rawSpeakerId
}

// ============================================================================
// Retroactive Correction
// ============================================================================

/**
 * Apply retroactive speaker label correction when better clustering evidence
 * becomes available from later audio
 */
function applyRetroactiveCorrection(
  originalSpeaker: string,
  correctedSpeaker: string,
  startTime: number,
  endTime: number,
  reason: string
): void {
  if (!currentConfig.enableRetroactiveCorrection) {
    return
  }

  const affectedSegments: string[] = []

  // Find all segments that need correction
  segmentHistory.forEach((segment, segmentId) => {
    if (segment.speaker === originalSpeaker &&
        segment.startTime >= startTime &&
        segment.endTime <= endTime) {
      // Update segment with correction
      const correctedSegment: SpeakerSegment = {
        ...segment,
        speaker: correctedSpeaker,
        wasRetroactivelyCorrected: true
      }
      segmentHistory.set(segmentId, correctedSegment)
      affectedSegments.push(segmentId)

      // Emit the corrected segment
      emitSpeakerSegment(correctedSegment)
    }
  })

  if (affectedSegments.length > 0) {
    const correctionEvent: RetroactiveCorrectionEvent = {
      originalSpeaker,
      correctedSpeaker,
      startTime,
      endTime,
      affectedSegmentIds: affectedSegments,
      reason
    }

    console.log(`[StreamingDiarization] Retroactive correction: ${originalSpeaker} -> ${correctedSpeaker} (${affectedSegments.length} segments)`)
    emitCorrection(correctionEvent)

    // Update speaker mapping for future stability
    speakerMappingHistory.set(originalSpeaker, correctedSpeaker)
  }
}

// ============================================================================
// Python Process Management
// ============================================================================

function handlePythonMessage(message: PythonDiarizationMessage): void {
  switch (message.type) {
    case 'ready':
      isProcessReady = true
      updateState({ status: 'ready' })
      console.log(`[StreamingDiarization] Process ready - backend: ${message.backend}, device: ${message.device}`)
      emitStatus('ready', `Diarization ready (${message.backend} on ${message.device})`)
      break

    case 'speaker_segment':
      if (message.speaker && message.start !== undefined && message.end !== undefined) {
        const stabilizedSpeaker = stabilizeSpeakerId(message.speaker)
        const adjustedConfidence = (message.confidence || 0.8) * coldStartConfidenceMultiplier

        const segment: SpeakerSegment = {
          id: generateSegmentId(),
          speaker: stabilizedSpeaker,
          startTime: message.start,
          endTime: message.end,
          confidence: adjustedConfidence,
          isFinal: currentState.coldStartComplete
        }

        // Track segment for potential retroactive correction
        segmentHistory.set(segment.id, segment)

        // Update statistics
        updateSpeakerStats(segment)

        updateState({
          totalAudioProcessed: message.end,
          lastSegmentTime: message.end,
          numSpeakersDetected: speakerStatistics.size
        })

        emitSpeakerSegment(segment)

        console.log(`[StreamingDiarization] Segment: ${stabilizedSpeaker} (${message.start.toFixed(2)}s - ${message.end.toFixed(2)}s, conf: ${adjustedConfidence.toFixed(2)})`)
      }
      break

    case 'speaker_change':
      if (message.to_speaker && message.time !== undefined) {
        const event: SpeakerChangeEvent = {
          time: message.time,
          fromSpeaker: message.from_speaker ? stabilizeSpeakerId(message.from_speaker) : null,
          toSpeaker: stabilizeSpeakerId(message.to_speaker),
          confidence: (message.confidence || 0.8) * coldStartConfidenceMultiplier
        }

        emitSpeakerChange(event)
        console.log(`[StreamingDiarization] Speaker change: ${event.fromSpeaker || 'none'} -> ${event.toSpeaker} at ${event.time.toFixed(2)}s`)
      }
      break

    case 'speaker_stats':
      if (message.speaker_stats) {
        // Update local stats from Python
        Object.entries(message.speaker_stats).forEach(([speakerId, stats]: [string, any]) => {
          const stabilizedId = stabilizeSpeakerId(speakerId)
          speakerStatistics.set(stabilizedId, {
            speakerId: stabilizedId,
            totalDuration: stats.duration || 0,
            segmentCount: stats.segments || 0,
            percentage: stats.percentage || 0,
            firstAppearance: stats.first_appearance || 0,
            lastAppearance: stats.last_appearance || 0
          })
        })

        emitStats(Object.fromEntries(speakerStatistics))
      }
      break

    case 'correction':
      if (message.original_speaker && message.corrected_speaker &&
          message.start !== undefined && message.end !== undefined) {
        applyRetroactiveCorrection(
          message.original_speaker,
          message.corrected_speaker,
          message.start,
          message.end,
          message.reason || 'Improved clustering evidence'
        )
      }
      break

    case 'complete':
      console.log(`[StreamingDiarization] Complete - ${message.num_speakers} speakers, ${message.total_duration?.toFixed(2)}s total`)
      updateState({ status: 'idle' })
      emitStatus('idle', 'Diarization session complete')
      break

    case 'error':
      console.error(`[StreamingDiarization] Error: ${message.message}`)
      updateState({ status: 'error', error: message.message })
      emitStatus('error', message.message)
      break

    case 'status':
      console.log(`[StreamingDiarization] Status: ${message.message}`)
      break
  }
}

function updateSpeakerStats(segment: SpeakerSegment): void {
  const existing = speakerStatistics.get(segment.speaker) || {
    speakerId: segment.speaker,
    totalDuration: 0,
    segmentCount: 0,
    percentage: 0,
    firstAppearance: Infinity,
    lastAppearance: 0
  }

  const duration = segment.endTime - segment.startTime
  existing.totalDuration += duration
  existing.segmentCount += 1
  existing.firstAppearance = Math.min(existing.firstAppearance, segment.startTime)
  existing.lastAppearance = Math.max(existing.lastAppearance, segment.endTime)

  speakerStatistics.set(segment.speaker, existing)

  // Recalculate percentages
  const totalDuration = Array.from(speakerStatistics.values())
    .reduce((sum, s) => sum + s.totalDuration, 0)

  speakerStatistics.forEach((stats) => {
    stats.percentage = totalDuration > 0 ? (stats.totalDuration / totalDuration) * 100 : 0
  })
}

// ============================================================================
// Streaming Diarization Service
// ============================================================================

export const streamingDiarizationService = {
  /**
   * Start a streaming diarization session
   */
  async startSession(
    meetingId: string,
    config: StreamingDiarizationConfig = {}
  ): Promise<{ success: boolean; error?: string }> {
    if (currentState.status !== 'idle') {
      return { success: false, error: `Already in status: ${currentState.status}` }
    }

    console.log(`[StreamingDiarization] Starting session for meeting: ${meetingId}`)

    resetState()
    currentConfig = { ...DEFAULT_CONFIG, ...config }

    updateState({
      status: 'initializing',
      meetingId
    })
    emitStatus('initializing', 'Starting streaming diarization...')

    // Use pythonEnvironment service to get the correct Python path for pyannote
    // This properly handles dual-venv setups where pyannote has its own environment
    const pyannotePythonPath = pythonEnvironment.getPythonPathForPurpose('pyannote')
    const pythonPath = pyannotePythonPath || findPythonPath()
    const scriptPath = path.join(getPythonScriptsDir(), 'live_diarize.py')

    if (!fs.existsSync(scriptPath)) {
      console.error(`[StreamingDiarization] Script not found: ${scriptPath}`)
      updateState({ status: 'error', error: 'Diarization script not found' })
      return { success: false, error: 'Streaming diarization script not found' }
    }

    const args = [
      scriptPath,
      '--sample-rate', String(currentConfig.sampleRate),
      '--segment-duration', String(currentConfig.windowDuration),
      '--hop-duration', String(currentConfig.hopDuration),
      '--similarity-threshold', String(currentConfig.similarityThreshold),
      '--max-speakers', String(currentConfig.maxSpeakers)
    ]

    // Auto-detect or use specified device
    if (currentConfig.device && currentConfig.device !== 'auto') {
      args.push('--device', currentConfig.device)
    }

    console.log(`[StreamingDiarization] Launching: ${pythonPath} ${args.join(' ')}`)

    return new Promise((resolve) => {
      diarizationProcess = spawn(pythonPath, args, {
        stdio: ['pipe', 'pipe', 'pipe'],
        env: {
          ...process.env,
          PYTHONUNBUFFERED: '1',
          TORCH_FORCE_NO_WEIGHTS_ONLY_LOAD: '1',
          // Suppress torchaudio deprecation warnings from pyannote.audio
          PYTHONWARNINGS: 'ignore::UserWarning,ignore::DeprecationWarning,ignore::FutureWarning'
        }
      })

      const rl = readline.createInterface({
        input: diarizationProcess.stdout!,
        crlfDelay: Infinity
      })

      rl.on('line', (line) => {
        try {
          const message: PythonDiarizationMessage = JSON.parse(line)
          handlePythonMessage(message)
        } catch {
          if (line.trim()) {
            console.log(`[StreamingDiarization] Python output: ${line.substring(0, 200)}`)
          }
        }
      })

      diarizationProcess.stderr?.on('data', (data: Buffer) => {
        const text = data.toString().trim()
        if (text) {
          console.log(`[StreamingDiarization] Python stderr: ${text}`)
        }
      })

      diarizationProcess.on('error', (err) => {
        console.error(`[StreamingDiarization] Process error:`, err)
        updateState({ status: 'error', error: err.message })
        isProcessReady = false
        diarizationProcess = null
        resolve({ success: false, error: err.message })
      })

      diarizationProcess.on('exit', (code) => {
        console.log(`[StreamingDiarization] Process exited with code: ${code}`)
        if (currentState.status !== 'idle' && currentState.status !== 'stopping') {
          updateState({ status: 'error', error: `Process exited unexpectedly (code ${code})` })
        }
        isProcessReady = false
        diarizationProcess = null
      })

      // Wait for ready signal
      const timeout = setTimeout(() => {
        if (!isProcessReady) {
          console.log(`[StreamingDiarization] Timeout waiting for ready, continuing anyway`)
          updateState({ status: 'active' })
          resolve({ success: true })
        }
      }, 60000)

      const checkReady = setInterval(() => {
        if (isProcessReady) {
          clearTimeout(timeout)
          clearInterval(checkReady)
          updateState({ status: 'active' })
          resolve({ success: true })
        }
        if (currentState.status === 'error') {
          clearTimeout(timeout)
          clearInterval(checkReady)
          resolve({ success: false, error: currentState.error })
        }
      }, 100)
    })
  },

  /**
   * Send an audio chunk for diarization processing
   */
  sendAudioChunk(audioData: Buffer): { success: boolean; error?: string } {
    if (!diarizationProcess || !diarizationProcess.stdin) {
      return { success: false, error: 'No active diarization process' }
    }

    if (currentState.status !== 'active' && currentState.status !== 'ready') {
      return { success: false, error: `Cannot send audio in status: ${currentState.status}` }
    }

    try {
      // Buffer audio for proper windowing
      audioBuffer.push(audioData)
      totalBufferedBytes += audioData.length

      // Update cold-start state
      updateColdStartState(audioData.length)

      // Write to Python process
      diarizationProcess.stdin.write(audioData)

      return { success: true }
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error)
      console.error(`[StreamingDiarization] Error sending audio:`, errorMsg)
      return { success: false, error: errorMsg }
    }
  },

  /**
   * Get speaker assignment for a time range (for matching with transcription)
   */
  getSpeakerForTimeRange(
    startTime: number,
    endTime: number
  ): { speaker: string; confidence: number } | null {
    // Find best overlapping speaker segment
    let bestMatch: { speaker: string; confidence: number; overlap: number } | null = null

    segmentHistory.forEach((segment) => {
      const overlapStart = Math.max(startTime, segment.startTime)
      const overlapEnd = Math.min(endTime, segment.endTime)
      const overlap = Math.max(0, overlapEnd - overlapStart)

      if (overlap > 0 && (!bestMatch || overlap > bestMatch.overlap)) {
        bestMatch = {
          speaker: segment.speaker,
          confidence: segment.confidence,
          overlap
        }
      }
    })

    if (bestMatch) {
      return { speaker: bestMatch.speaker, confidence: bestMatch.confidence }
    }

    // Fallback: find nearest segment
    let nearestSegment: SpeakerSegment | null = null
    let nearestDistance = Infinity
    const midpoint = (startTime + endTime) / 2

    segmentHistory.forEach((segment) => {
      const distance = Math.min(
        Math.abs(segment.startTime - midpoint),
        Math.abs(segment.endTime - midpoint)
      )
      if (distance < nearestDistance && distance <= 1.0) {
        nearestDistance = distance
        nearestSegment = segment
      }
    })

    return nearestSegment
      ? { speaker: nearestSegment.speaker, confidence: nearestSegment.confidence * 0.8 }
      : null
  },

  /**
   * Get all speaker segments
   */
  getSegments(): SpeakerSegment[] {
    return Array.from(segmentHistory.values())
  },

  /**
   * Get speaker statistics
   */
  getSpeakerStats(): Record<string, SpeakerStats> {
    return Object.fromEntries(speakerStatistics)
  },

  /**
   * Pause the diarization session
   */
  pause(): { success: boolean } {
    if (currentState.status !== 'active') {
      return { success: false }
    }

    updateState({ status: 'paused' })
    emitStatus('paused', 'Diarization paused')
    return { success: true }
  },

  /**
   * Resume the diarization session
   */
  resume(): { success: boolean } {
    if (currentState.status !== 'paused') {
      return { success: false }
    }

    updateState({ status: 'active' })
    emitStatus('active', 'Diarization resumed')
    return { success: true }
  },

  /**
   * Stop the streaming diarization session
   */
  async stopSession(): Promise<{
    success: boolean
    segments: SpeakerSegment[]
    stats: Record<string, SpeakerStats>
  }> {
    if (currentState.status === 'idle') {
      return { success: true, segments: [], stats: {} }
    }

    console.log(`[StreamingDiarization] Stopping session`)
    updateState({ status: 'stopping' })
    emitStatus('stopping', 'Stopping diarization...')

    // Close stdin to signal end of input
    if (diarizationProcess?.stdin) {
      try {
        diarizationProcess.stdin.end()
      } catch (e) {
        console.log(`[StreamingDiarization] Error closing stdin:`, e)
      }
    }

    // Wait for process to finish or timeout
    await new Promise<void>((resolve) => {
      const timeout = setTimeout(() => {
        if (diarizationProcess && !diarizationProcess.killed) {
          console.log(`[StreamingDiarization] Force killing process`)
          diarizationProcess.kill('SIGTERM')
        }
        resolve()
      }, 5000)

      if (diarizationProcess) {
        diarizationProcess.once('exit', () => {
          clearTimeout(timeout)
          resolve()
        })
      } else {
        clearTimeout(timeout)
        resolve()
      }
    })

    const segments = Array.from(segmentHistory.values())
    const stats = Object.fromEntries(speakerStatistics)

    diarizationProcess = null
    isProcessReady = false
    resetState()

    emitStatus('idle', 'Diarization session stopped')
    console.log(`[StreamingDiarization] Session stopped. ${segments.length} segments, ${Object.keys(stats).length} speakers`)

    return { success: true, segments, stats }
  },

  /**
   * Force reset the service state
   */
  forceReset(): { success: boolean } {
    console.log(`[StreamingDiarization] Force resetting`)

    if (diarizationProcess && !diarizationProcess.killed) {
      try {
        diarizationProcess.kill('SIGKILL')
      } catch (e) {
        console.error(`[StreamingDiarization] Error killing process:`, e)
      }
    }

    diarizationProcess = null
    isProcessReady = false
    resetState()

    emitStatus('idle', 'Diarization state reset')
    return { success: true }
  },

  /**
   * Get current status
   */
  getStatus(): StreamingDiarizationState {
    return { ...currentState }
  },

  /**
   * Check if streaming diarization is available
   *
   * NOTE: This method now performs only quick file existence checks.
   * Heavy Python validation (importing pyannote/speechbrain) is skipped here
   * because it's already done by the tiered validation service in Settings.
   * This eliminates the freeze when starting recording.
   */
  async isAvailable(): Promise<{
    available: boolean
    pythonPath: string
    hasBackend: boolean
    error?: string
  }> {
    // Use pythonEnvironment service to get the correct Python path for pyannote
    // This properly handles dual-venv setups where pyannote has its own environment
    const pyannotePythonPath = pythonEnvironment.getPythonPathForPurpose('pyannote')
    const pythonPath = pyannotePythonPath || findPythonPath()
    const scriptPath = path.join(getPythonScriptsDir(), 'live_diarize.py')

    if (!fs.existsSync(scriptPath)) {
      return {
        available: false,
        pythonPath,
        hasBackend: false,
        error: 'Streaming diarization script not found'
      }
    }

    // Quick check: only verify Python binary exists
    // Heavy validation (importing pyannote/speechbrain) is done by tieredValidationService
    // in Settings, so we skip it here to avoid freezing the UI when starting recording
    try {
      const { execSync } = require('child_process')
      execSync(`"${pythonPath}" --version`, { timeout: 5000 })

      // Assume backend is available if Python exists and script exists
      // The actual validation was already done in Settings via tieredValidationService
      // If there are issues, the Python script will report them when it runs
      return {
        available: true,
        pythonPath,
        hasBackend: true,
        error: undefined
      }
    } catch (error) {
      console.error('[StreamingDiarization] Python check failed:', error instanceof Error ? error.message : String(error))
      return {
        available: false,
        pythonPath,
        hasBackend: false,
        error: `Python check failed: ${error instanceof Error ? error.message : String(error)}`
      }
    }
  },

  // =========================================================================
  // Event Subscriptions
  // =========================================================================

  /**
   * Subscribe to speaker segment events
   */
  onSpeakerSegment(callback: (segment: SpeakerSegment) => void): () => void {
    progressEmitter.on(SPEAKER_SEGMENT_EVENT, callback)
    return () => progressEmitter.off(SPEAKER_SEGMENT_EVENT, callback)
  },

  /**
   * Subscribe to speaker change events
   */
  onSpeakerChange(callback: (event: SpeakerChangeEvent) => void): () => void {
    progressEmitter.on(SPEAKER_CHANGE_EVENT, callback)
    return () => progressEmitter.off(SPEAKER_CHANGE_EVENT, callback)
  },

  /**
   * Subscribe to status updates
   */
  onStatus(callback: (status: { status: StreamingDiarizationStatus; message?: string; timestamp: number }) => void): () => void {
    progressEmitter.on(STATUS_EVENT, callback)
    return () => progressEmitter.off(STATUS_EVENT, callback)
  },

  /**
   * Subscribe to retroactive correction events
   */
  onCorrection(callback: (event: RetroactiveCorrectionEvent) => void): () => void {
    progressEmitter.on(CORRECTION_EVENT, callback)
    return () => progressEmitter.off(CORRECTION_EVENT, callback)
  },

  /**
   * Subscribe to speaker stats updates
   */
  onStats(callback: (stats: Record<string, SpeakerStats>) => void): () => void {
    progressEmitter.on(STATS_EVENT, callback)
    return () => progressEmitter.off(STATS_EVENT, callback)
  }
}

// Export for testing
export function resetStreamingDiarizationState(): void {
  if (diarizationProcess && !diarizationProcess.killed) {
    diarizationProcess.kill('SIGKILL')
    diarizationProcess = null
  }
  isProcessReady = false
  resetState()
  progressEmitter.removeAllListeners()
}
