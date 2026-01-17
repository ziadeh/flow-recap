/**
 * Core Diarization Service
 *
 * This service provides the MANDATORY speaker diarization preprocessing stage.
 * It MUST be executed BEFORE transcription in the audio processing pipeline.
 *
 * Pipeline Order:
 *   Audio Capture -> DIARIZATION (this service) -> Structured Segments -> Transcription -> UI
 *
 * BLOCKING REQUIREMENT: The system must fail explicitly if diarization cannot be performed.
 */

import { spawn, ChildProcess, execSync } from 'child_process'
import { EventEmitter } from 'events'
import * as path from 'path'
import * as fs from 'fs'
import { randomUUID } from 'crypto'
import { diarizationFailureService } from './diarizationFailureService'
import { validateWavFile, fixWavFileHeader } from './wavUtils'

// Electron app for path resolution
let app: { isPackaged?: boolean } | undefined
try {
  app = require('electron').app
} catch {
  app = undefined
}

// ============================================================================
// Types
// ============================================================================

/**
 * Speaker segment from diarization.
 * This is the PRIMARY OUTPUT that identifies WHO is speaking at each time.
 */
export interface DiarizationSegment {
  /** Speaker identifier (e.g., "SPEAKER_0", "SPEAKER_1") */
  speaker_id: string
  /** Start time in seconds */
  start_time: number
  /** End time in seconds */
  end_time: number
  /** Duration in seconds */
  duration: number
  /** Confidence score (0.0-1.0) */
  confidence: number
}

/**
 * Result from diarization processing
 */
export interface DiarizationProcessingResult {
  success: boolean
  segments: DiarizationSegment[]
  num_speakers: number
  speaker_ids: string[]
  audio_duration: number
  processing_time: number
  error?: string
  error_code?: string
}

/**
 * Configuration for the diarization engine
 */
export interface DiarizationEngineConfig {
  /** Audio sample rate in Hz (default: 16000) */
  sampleRate?: number
  /** Minimum expected speakers (2-5, default: 2) */
  minSpeakers?: number
  /** Maximum expected speakers (2-5, default: 5) */
  maxSpeakers?: number
  /** Computation device ('cuda' | 'cpu' | 'auto') */
  device?: 'cuda' | 'cpu' | 'auto'
  /** Whether to require diarization (fail if unavailable) */
  required?: boolean
}

/**
 * Status of the diarization engine
 */
export interface DiarizationStatus {
  available: boolean
  initialized: boolean
  device: string
  pyannoteInstalled: boolean
  error?: string
  message: string
}

/**
 * Real-time diarization event
 */
export interface DiarizationEvent {
  type: 'segment' | 'speaker_change' | 'status' | 'error'
  timestamp: number
  data: DiarizationSegment | { message: string } | { from: string; to: string; time: number }
}

// ============================================================================
// Error Classes
// ============================================================================

/**
 * Error thrown when diarization is required but cannot be performed.
 * This is a BLOCKING error that halts the audio processing pipeline.
 */
export class DiarizationRequiredError extends Error {
  code: string
  details: Record<string, unknown>

  constructor(message: string, code: string = 'DIARIZATION_REQUIRED', details: Record<string, unknown> = {}) {
    super(message)
    this.name = 'DiarizationRequiredError'
    this.code = code
    this.details = details
  }
}

// ============================================================================
// Service State
// ============================================================================

let isInitialized = false
let diarizationAvailable = false
let currentDevice = 'cpu'
let currentProcess: ChildProcess | null = null
let eventEmitter = new EventEmitter()
let sessionId: string | null = null

// ============================================================================
// Helper Functions
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
      console.log('[CoreDiarization] Using bundled Python executable:', bundledExecutable)
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
      console.log(`[CoreDiarization] Using virtual environment: ${venvName}`)
      return venvPython
    }
  }

  if (process.env.PYTHON_PATH && fs.existsSync(process.env.PYTHON_PATH)) {
    return process.env.PYTHON_PATH
  }

  try {
    const pythonPath = execSync('which python3 2>/dev/null || which python 2>/dev/null', {
      encoding: 'utf8',
      timeout: 5000
    }).trim()
    if (pythonPath) {
      return pythonPath
    }
  } catch {
    // Ignore
  }

  return process.platform === 'win32' ? 'python' : 'python3'
}

// ============================================================================
// Core Diarization Service
// ============================================================================

export const coreDiarizationService = {
  /**
   * Initialize the diarization engine and verify it's available.
   *
   * BLOCKING: If required=true and diarization is unavailable, throws DiarizationRequiredError.
   *
   * @param config Engine configuration
   * @returns Status of the diarization engine
   */
  async initialize(config: DiarizationEngineConfig = {}): Promise<DiarizationStatus> {
    const pythonPath = findPythonPath()
    const scriptPath = path.join(getPythonScriptsDir(), 'core_diarization_engine.py')

    if (!fs.existsSync(scriptPath)) {
      const error = `Core diarization script not found: ${scriptPath}`
      console.error(`[CoreDiarization] ${error}`)

      if (config.required) {
        throw new DiarizationRequiredError(
          'BLOCKING REQUIREMENT: Core diarization engine script not found. Cannot proceed without diarization.',
          'SCRIPT_NOT_FOUND',
          { scriptPath }
        )
      }

      return {
        available: false,
        initialized: false,
        device: 'none',
        pyannoteInstalled: false,
        error,
        message: 'Diarization script not found'
      }
    }

    return new Promise((resolve, reject) => {
      console.log(`[CoreDiarization] Verifying diarization availability...`)

      const pythonProcess = spawn(pythonPath, [scriptPath, '--verify'], {
        stdio: ['pipe', 'pipe', 'pipe'],
        env: {
          ...process.env,
          PYTHONUNBUFFERED: '1',
          TORCH_FORCE_NO_WEIGHTS_ONLY_LOAD: '1',
          // Suppress torchaudio deprecation warnings from pyannote.audio
          PYTHONWARNINGS: 'ignore::UserWarning,ignore::DeprecationWarning,ignore::FutureWarning'
        }
      })

      let stdout = ''
      let stderr = ''

      pythonProcess.stdout?.on('data', (data: Buffer) => {
        stdout += data.toString()
      })

      pythonProcess.stderr?.on('data', (data: Buffer) => {
        stderr += data.toString()
        console.log(`[CoreDiarization] ${data.toString().trim()}`)
      })

      pythonProcess.on('exit', (code: number | null) => {
        try {
          const result = JSON.parse(stdout.trim())

          diarizationAvailable = result.available === true
          isInitialized = diarizationAvailable
          currentDevice = result.device || 'cpu'

          const status: DiarizationStatus = {
            available: diarizationAvailable,
            initialized: isInitialized,
            device: currentDevice,
            pyannoteInstalled: result.pyannote_installed === true,
            error: result.error || undefined,
            message: result.message || ''
          }

          if (!diarizationAvailable && config.required) {
            reject(new DiarizationRequiredError(
              `BLOCKING REQUIREMENT: ${result.message || 'Diarization is not available'}`,
              result.error || 'DIARIZATION_UNAVAILABLE',
              result
            ))
            return
          }

          console.log(`[CoreDiarization] Initialization complete: available=${diarizationAvailable}, device=${currentDevice}`)
          resolve(status)

        } catch (e) {
          const error = `Failed to parse verification result: ${e}`
          console.error(`[CoreDiarization] ${error}`)
          console.error(`[CoreDiarization] stdout: ${stdout}`)
          console.error(`[CoreDiarization] stderr: ${stderr}`)

          if (config.required) {
            reject(new DiarizationRequiredError(
              'BLOCKING REQUIREMENT: Failed to verify diarization availability',
              'VERIFICATION_FAILED',
              { stdout, stderr }
            ))
            return
          }

          resolve({
            available: false,
            initialized: false,
            device: 'none',
            pyannoteInstalled: false,
            error,
            message: 'Failed to verify diarization'
          })
        }
      })

      pythonProcess.on('error', (err: Error) => {
        const error = `Failed to spawn verification process: ${err.message}`
        console.error(`[CoreDiarization] ${error}`)

        if (config.required) {
          reject(new DiarizationRequiredError(
            'BLOCKING REQUIREMENT: Failed to verify diarization availability',
            'SPAWN_ERROR',
            { error: err.message }
          ))
          return
        }

        resolve({
          available: false,
          initialized: false,
          device: 'none',
          pyannoteInstalled: false,
          error,
          message: 'Failed to spawn verification process'
        })
      })

      // Timeout after 60 seconds
      setTimeout(() => {
        if (!pythonProcess.killed) {
          pythonProcess.kill('SIGTERM')

          if (config.required) {
            reject(new DiarizationRequiredError(
              'BLOCKING REQUIREMENT: Diarization verification timed out',
              'TIMEOUT'
            ))
          } else {
            resolve({
              available: false,
              initialized: false,
              device: 'none',
              pyannoteInstalled: false,
              error: 'Verification timed out',
              message: 'Diarization verification timed out'
            })
          }
        }
      }, 60000)
    })
  },

  /**
   * Process an audio file through the diarization engine.
   *
   * BLOCKING: If required=true and diarization fails, throws DiarizationRequiredError.
   *
   * @param audioPath Path to the audio file
   * @param config Engine configuration
   * @returns Diarization result with speaker segments
   */
  async processAudioFile(
    audioPath: string,
    config: DiarizationEngineConfig = {}
  ): Promise<DiarizationProcessingResult> {
    if (!fs.existsSync(audioPath)) {
      const error = `Audio file not found: ${audioPath}`

      // Record failure in the diarization failure service
      const failure = diarizationFailureService.recordFailure({
        errorCode: 'AUDIO_NOT_FOUND',
        errorMessage: error,
        audioPath
      })
      // Generate notification for user
      diarizationFailureService.generateNotification(failure)

      if (config.required) {
        throw new DiarizationRequiredError(
          `BLOCKING REQUIREMENT: ${error}`,
          'AUDIO_NOT_FOUND',
          { audioPath }
        )
      }

      return {
        success: false,
        segments: [],
        num_speakers: 0,
        speaker_ids: [],
        audio_duration: 0,
        processing_time: 0,
        error,
        error_code: 'AUDIO_NOT_FOUND'
      }
    }

    // Validate and fix WAV file header if needed
    // This fixes a critical bug where the WAV header may contain an incorrect data size,
    // causing diarization to only process partial audio (e.g., first ~35 seconds).
    // The issue occurs when recording is stopped but the header wasn't properly updated.
    const lowerAudioPath = audioPath.toLowerCase()
    if (lowerAudioPath.endsWith('.wav')) {
      try {
        const wavInfo = validateWavFile(audioPath)
        if (wavInfo.valid && wavInfo.needsHeaderFix) {
          console.log(`[CoreDiarization] WAV header issue detected (header: ${wavInfo.headerDataSize} bytes, actual: ${wavInfo.actualDataSize} bytes)`)
          console.log(`[CoreDiarization] Fixing WAV header to enable full audio diarization...`)

          const fixed = fixWavFileHeader(audioPath)
          if (fixed) {
            console.log(`[CoreDiarization] WAV header fixed successfully. Audio duration: ${wavInfo.durationSeconds.toFixed(2)}s`)
          } else {
            console.warn(`[CoreDiarization] Could not fix WAV header. Proceeding anyway...`)
          }
        } else if (wavInfo.valid) {
          console.log(`[CoreDiarization] Audio file validated: ${wavInfo.durationSeconds.toFixed(2)}s, ${wavInfo.sampleRate}Hz, ${wavInfo.channels}ch`)
        } else {
          console.warn(`[CoreDiarization] Invalid WAV file: ${wavInfo.error}. Proceeding anyway...`)
        }
      } catch (wavError) {
        console.warn(`[CoreDiarization] WAV validation error (non-blocking): ${wavError instanceof Error ? wavError.message : String(wavError)}`)
      }
    }

    const pythonPath = findPythonPath()
    const scriptPath = path.join(getPythonScriptsDir(), 'core_diarization_engine.py')

    const args: string[] = [
      scriptPath,
      '--audio', audioPath,
      '--sample-rate', String(config.sampleRate || 16000),
      '--min-speakers', String(config.minSpeakers || 2),
      '--max-speakers', String(config.maxSpeakers || 5)
    ]

    if (config.device && config.device !== 'auto') {
      args.push('--device', config.device)
    }

    return new Promise((resolve, reject) => {
      console.log(`[CoreDiarization] Processing audio: ${audioPath}`)
      const startTime = Date.now()

      const pythonProcess = spawn(pythonPath, args, {
        stdio: ['pipe', 'pipe', 'pipe'],
        env: {
          ...process.env,
          PYTHONUNBUFFERED: '1',
          TORCH_FORCE_NO_WEIGHTS_ONLY_LOAD: '1',
          // Suppress torchaudio deprecation warnings from pyannote.audio
          PYTHONWARNINGS: 'ignore::UserWarning,ignore::DeprecationWarning,ignore::FutureWarning'
        }
      })

      currentProcess = pythonProcess

      let stdout = ''
      let stderr = ''

      pythonProcess.stdout?.on('data', (data: Buffer) => {
        stdout += data.toString()
      })

      pythonProcess.stderr?.on('data', (data: Buffer) => {
        stderr += data.toString()
        console.log(`[CoreDiarization] ${data.toString().trim()}`)
      })

      pythonProcess.on('exit', (code: number | null) => {
        currentProcess = null
        const elapsedTime = (Date.now() - startTime) / 1000

        try {
          const result = JSON.parse(stdout.trim())

          if (result.error) {
            // Record failure in the diarization failure service
            const failure = diarizationFailureService.recordFailure({
              errorCode: result.error_code,
              errorMessage: result.message,
              audioPath,
              pythonOutput: stderr
            })
            // Generate notification for user
            diarizationFailureService.generateNotification(failure)

            const errorResult: DiarizationProcessingResult = {
              success: false,
              segments: [],
              num_speakers: 0,
              speaker_ids: [],
              audio_duration: 0,
              processing_time: elapsedTime,
              error: result.message,
              error_code: result.error_code
            }

            if (config.required) {
              reject(new DiarizationRequiredError(
                `BLOCKING REQUIREMENT: ${result.message}`,
                result.error_code || 'PROCESSING_ERROR',
                result.details || {}
              ))
              return
            }

            resolve(errorResult)
            return
          }

          const successResult: DiarizationProcessingResult = {
            success: true,
            segments: result.segments || [],
            num_speakers: result.num_speakers || 0,
            speaker_ids: result.speaker_ids || [],
            audio_duration: result.audio_duration || 0,
            processing_time: result.processing_time || elapsedTime
          }

          // CRITICAL: Validate that this is NOT a silent fallback
          const validation = diarizationFailureService.validateNotSilentFallback({
            success: successResult.success,
            segments: successResult.segments,
            numSpeakers: successResult.num_speakers,
            speakers: successResult.speaker_ids
          })

          if (!validation.valid) {
            console.warn(`[CoreDiarization] SILENT FALLBACK DETECTED: ${validation.reason}`)

            // Record this as a failure - we cannot accept silent fallbacks
            const failure = diarizationFailureService.recordFailure({
              errorCode: 'SILENT_FALLBACK',
              errorMessage: validation.reason || 'Possible silent fallback to single-speaker mode detected',
              audioPath,
              pythonOutput: stderr
            })
            diarizationFailureService.generateNotification(failure)

            if (config.required) {
              reject(new DiarizationRequiredError(
                `BLOCKING REQUIREMENT: ${validation.reason}`,
                'SILENT_FALLBACK',
                { result: successResult }
              ))
              return
            }

            // Mark as failed if silent fallback detected
            resolve({
              ...successResult,
              success: false,
              error: validation.reason,
              error_code: 'SILENT_FALLBACK'
            })
            return
          }

          console.log(`[CoreDiarization] Processing complete: ${successResult.num_speakers} speakers, ` +
                      `${successResult.segments.length} segments in ${successResult.processing_time.toFixed(2)}s`)

          resolve(successResult)

        } catch (e) {
          const error = `Failed to parse diarization result: ${e}`
          console.error(`[CoreDiarization] ${error}`)

          // Record failure in the diarization failure service
          const failure = diarizationFailureService.recordFailure({
            errorCode: 'PARSE_ERROR',
            errorMessage: error,
            audioPath,
            pythonOutput: stderr,
            stackTrace: e instanceof Error ? e.stack : undefined
          })
          diarizationFailureService.generateNotification(failure)

          if (config.required) {
            reject(new DiarizationRequiredError(
              'BLOCKING REQUIREMENT: Failed to parse diarization result',
              'PARSE_ERROR',
              { stdout, stderr }
            ))
            return
          }

          resolve({
            success: false,
            segments: [],
            num_speakers: 0,
            speaker_ids: [],
            audio_duration: 0,
            processing_time: elapsedTime,
            error,
            error_code: 'PARSE_ERROR'
          })
        }
      })

      pythonProcess.on('error', (err: Error) => {
        currentProcess = null
        const error = `Failed to spawn diarization process: ${err.message}`
        console.error(`[CoreDiarization] ${error}`)

        // Record failure in the diarization failure service
        const failure = diarizationFailureService.recordFailure({
          errorCode: 'SPAWN_ERROR',
          errorMessage: error,
          audioPath,
          stackTrace: err.stack
        })
        diarizationFailureService.generateNotification(failure)

        if (config.required) {
          reject(new DiarizationRequiredError(
            'BLOCKING REQUIREMENT: Failed to start diarization process',
            'SPAWN_ERROR',
            { error: err.message }
          ))
          return
        }

        resolve({
          success: false,
          segments: [],
          num_speakers: 0,
          speaker_ids: [],
          audio_duration: 0,
          processing_time: 0,
          error,
          error_code: 'SPAWN_ERROR'
        })
      })
    })
  },

  /**
   * Get the speaker for a transcript segment time range.
   *
   * @param startTime Start time in seconds
   * @param endTime End time in seconds
   * @param segments Diarization segments to search
   * @returns Speaker assignment or null
   */
  getSpeakerForTimeRange(
    startTime: number,
    endTime: number,
    segments: DiarizationSegment[]
  ): { speaker_id: string; confidence: number } | null {
    // Calculate overlap with each speaker
    const speakerOverlaps: Record<string, number> = {}
    const speakerConfidences: Record<string, number> = {}

    for (const segment of segments) {
      const overlapStart = Math.max(startTime, segment.start_time)
      const overlapEnd = Math.min(endTime, segment.end_time)
      const overlap = Math.max(0, overlapEnd - overlapStart)

      if (overlap > 0) {
        if (!speakerOverlaps[segment.speaker_id]) {
          speakerOverlaps[segment.speaker_id] = 0
        }
        speakerOverlaps[segment.speaker_id] += overlap

        // Keep max confidence
        if (!speakerConfidences[segment.speaker_id] ||
            segment.confidence > speakerConfidences[segment.speaker_id]) {
          speakerConfidences[segment.speaker_id] = segment.confidence
        }
      }
    }

    if (Object.keys(speakerOverlaps).length === 0) {
      return null
    }

    // Return speaker with most overlap
    let bestSpeaker: string | null = null
    let bestOverlap = 0

    for (const [speaker, overlap] of Object.entries(speakerOverlaps)) {
      if (overlap > bestOverlap) {
        bestOverlap = overlap
        bestSpeaker = speaker
      }
    }

    if (bestSpeaker) {
      return {
        speaker_id: bestSpeaker,
        confidence: speakerConfidences[bestSpeaker] || 0.5
      }
    }

    return null
  },

  /**
   * Check if diarization is available.
   */
  isAvailable(): boolean {
    return diarizationAvailable
  },

  /**
   * Check if the service is initialized.
   */
  isInitialized(): boolean {
    return isInitialized
  },

  /**
   * Get the current computation device.
   */
  getDevice(): string {
    return currentDevice
  },

  /**
   * Get the current status.
   */
  getStatus(): DiarizationStatus {
    return {
      available: diarizationAvailable,
      initialized: isInitialized,
      device: currentDevice,
      pyannoteInstalled: diarizationAvailable,
      message: diarizationAvailable ? 'Diarization is available' : 'Diarization is not available'
    }
  },

  /**
   * Subscribe to diarization events.
   */
  onEvent(callback: (event: DiarizationEvent) => void): () => void {
    eventEmitter.on('diarization-event', callback)
    return () => {
      eventEmitter.off('diarization-event', callback)
    }
  },

  /**
   * Cancel any ongoing diarization process.
   */
  cancel(): boolean {
    if (currentProcess && !currentProcess.killed) {
      currentProcess.kill('SIGTERM')
      setTimeout(() => {
        if (currentProcess && !currentProcess.killed) {
          currentProcess.kill('SIGKILL')
        }
      }, 5000)
      return true
    }
    return false
  },

  /**
   * Reset the service state.
   */
  reset(): void {
    this.cancel()
    sessionId = null
    eventEmitter.removeAllListeners()
    eventEmitter = new EventEmitter()
  }
}

// Export error class
export { DiarizationRequiredError as DiarizationError }

// Export types for use in main.ts
export type {
  DiarizationSegment as CoreDiarizationSegment,
  DiarizationProcessingResult as CoreDiarizationResult,
  DiarizationEngineConfig as CoreDiarizationConfig,
  DiarizationStatus as CoreDiarizationStatus
}
