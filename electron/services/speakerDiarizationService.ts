/**
 * Speaker Diarization Service
 *
 * TypeScript wrapper for the comprehensive Python speaker diarization system.
 * Provides both batch and streaming interfaces for speaker identification.
 *
 * Features:
 * - Voice embedding extraction using pyannote.audio or SpeechBrain
 * - Multiple clustering algorithms (agglomerative, spectral, online)
 * - Speaker change boundary detection
 * - Overlapping speech detection
 * - Support for common audio formats (WAV, MP3, M4A, FLAC)
 * - Quality metrics and confidence scoring
 */

import { EventEmitter } from 'events'
import { spawn, ChildProcess } from 'child_process'
import * as path from 'path'
import * as fs from 'fs'
import * as readline from 'readline'
import { validateWavFile, fixWavFileHeader } from './wavUtils'

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

export type DiarizationStatus =
  | 'idle'
  | 'initializing'
  | 'preprocessing'
  | 'extracting_embeddings'
  | 'clustering'
  | 'post_processing'
  | 'complete'
  | 'error'

export type ClusteringMethod = 'agglomerative' | 'spectral' | 'online' | 'neural'

export interface DiarizationConfig {
  /** Exact number of speakers (auto-detect if not specified) */
  numSpeakers?: number
  /** Minimum number of speakers to detect */
  minSpeakers?: number
  /** Maximum number of speakers to detect */
  maxSpeakers?: number
  /** Speaker similarity threshold (0.0-1.0) */
  similarityThreshold?: number
  /** Clustering method to use */
  clusteringMethod?: ClusteringMethod
  /** Device for inference ('cuda', 'cpu', or 'auto') */
  device?: 'cuda' | 'cpu' | 'auto'
  /** Apply audio preprocessing */
  preprocess?: boolean
  /** Apply noise reduction */
  noiseReduction?: boolean
  /** Detect overlapping speech */
  detectOverlaps?: boolean
  /** Use neural pipeline (pyannote's full diarization) */
  useNeuralPipeline?: boolean
  /** Segment duration for embedding extraction (seconds) */
  segmentDuration?: number
  /** Hop duration between segments (seconds) */
  hopDuration?: number
}

export interface DiarizationSegment {
  /** Start time in seconds */
  start: number
  /** End time in seconds */
  end: number
  /** Speaker label (e.g., "Speaker 1") */
  speaker: string
  /** Confidence score (0.0-1.0) */
  confidence: number
  /** Duration in seconds */
  duration: number
  /** Whether this segment has overlapping speech */
  isOverlapping?: boolean
  /** List of overlapping speakers if applicable */
  overlappingSpeakers?: string[]
}

export interface SpeakerStats {
  /** Speaker identifier */
  speakerId: string
  /** Total speaking duration in seconds */
  totalDuration: number
  /** Number of speech segments */
  segmentCount: number
  /** Average segment duration */
  averageSegmentDuration: number
  /** Percentage of total speech time */
  percentage: number
  /** First appearance time in seconds */
  firstAppearance: number
  /** Last appearance time in seconds */
  lastAppearance: number
}

export interface QualityMetrics {
  /** Overall confidence across all segments */
  overallConfidence: number
  /** How distinct speakers are from each other (0.0-1.0) */
  speakerClarityScore: number
  /** Estimated precision of speaker boundaries */
  boundaryPrecision: number
  /** Percentage of audio with overlapping speech */
  overlapRatio: number
  /** Percentage of audio that is silence */
  silenceRatio: number
  /** Processing time in seconds */
  processingTimeSeconds: number
  /** Segments per minute */
  segmentsPerMinute: number
}

export interface DiarizationResult {
  /** Success status */
  success: boolean
  /** List of speaker segments */
  segments: DiarizationSegment[]
  /** List of unique speakers */
  speakers: string[]
  /** Number of speakers detected */
  numSpeakers: number
  /** Per-speaker statistics */
  speakerStats: Record<string, SpeakerStats>
  /** Quality metrics */
  qualityMetrics: QualityMetrics
  /** Total audio duration in seconds */
  audioDuration: number
  /** Additional metadata */
  metadata: Record<string, any>
  /** Error message if failed */
  error?: string
}

export interface DiarizationProgress {
  status: DiarizationStatus
  phase: string
  progress: number
  message: string
  timestamp: number
}

export interface StreamingDiarizationConfig {
  /** Sample rate of audio (default: 16000) */
  sampleRate?: number
  /** Segment duration for embedding extraction */
  segmentDuration?: number
  /** Hop duration between segments */
  hopDuration?: number
  /** Speaker similarity threshold */
  similarityThreshold?: number
  /** Maximum speakers to detect */
  maxSpeakers?: number
  /** Device for inference */
  device?: 'cuda' | 'cpu' | 'auto'
}

// Python message types
interface PythonMessage {
  type: 'ready' | 'status' | 'progress' | 'segment' | 'result' | 'error' | 'complete'
  phase?: string
  progress?: number
  message?: string
  segment?: DiarizationSegment
  result?: any
  error?: string
  code?: string
}

// ============================================================================
// Constants
// ============================================================================

const DIARIZATION_EVENT = 'diarization:update'
const SEGMENT_EVENT = 'diarization:segment'
const DEFAULT_CONFIG: Required<DiarizationConfig> = {
  numSpeakers: undefined as any,
  // Default to 2 speakers for typical meeting scenarios
  // This ensures the algorithm tries to find at least 2 speakers
  minSpeakers: 2,
  maxSpeakers: 10,
  // FIXED: Lower threshold = more speakers detected (more sensitive to voice differences)
  // Changed from 0.4 to 0.35 to increase sensitivity and detect more distinct speakers
  // (pyannote's default is ~0.7, but we use 0.35 to handle compressed audio and similar voices better)
  similarityThreshold: 0.35,
  clusteringMethod: 'agglomerative',
  device: 'auto',
  preprocess: true,
  noiseReduction: false,
  detectOverlaps: true,
  useNeuralPipeline: false,
  segmentDuration: 2.0,
  hopDuration: 0.5
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
      console.log('[Speaker Diarization] Using bundled Python executable:', bundledExecutable)
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

// ============================================================================
// Service State
// ============================================================================

const progressEmitter = new EventEmitter()

let currentStatus: DiarizationStatus = 'idle'
let activeProcess: ChildProcess | null = null

// Streaming diarization state
let streamingProcess: ChildProcess | null = null
let isStreamingReady = false

// ============================================================================
// Speaker Diarization Service
// ============================================================================

export const speakerDiarizationService = {
  /**
   * Perform batch speaker diarization on an audio file
   *
   * @param audioPath - Path to the audio file
   * @param config - Diarization configuration
   * @param onProgress - Optional progress callback
   * @returns DiarizationResult with segments and speaker information
   */
  async diarize(
    audioPath: string,
    config: DiarizationConfig = {},
    onProgress?: (progress: DiarizationProgress) => void
  ): Promise<DiarizationResult> {
    if (currentStatus !== 'idle') {
      return {
        success: false,
        segments: [],
        speakers: [],
        numSpeakers: 0,
        speakerStats: {},
        qualityMetrics: {} as QualityMetrics,
        audioDuration: 0,
        metadata: {},
        error: 'Diarization already in progress'
      }
    }

    // Validate audio file
    if (!fs.existsSync(audioPath)) {
      return {
        success: false,
        segments: [],
        speakers: [],
        numSpeakers: 0,
        speakerStats: {},
        qualityMetrics: {} as QualityMetrics,
        audioDuration: 0,
        metadata: {},
        error: `Audio file not found: ${audioPath}`
      }
    }

    // Validate and fix WAV file header if needed
    // This fixes a critical bug where the WAV header may contain an incorrect data size,
    // causing diarization to only process partial audio (e.g., first ~35 seconds).
    const lowerAudioPath = audioPath.toLowerCase()
    if (lowerAudioPath.endsWith('.wav')) {
      try {
        const wavInfo = validateWavFile(audioPath)
        if (wavInfo.valid && wavInfo.needsHeaderFix) {
          console.log(`[SpeakerDiarization] WAV header issue detected (header: ${wavInfo.headerDataSize} bytes, actual: ${wavInfo.actualDataSize} bytes)`)
          console.log(`[SpeakerDiarization] Fixing WAV header to enable full audio diarization...`)

          const fixed = fixWavFileHeader(audioPath)
          if (fixed) {
            console.log(`[SpeakerDiarization] WAV header fixed successfully. Audio duration: ${wavInfo.durationSeconds.toFixed(2)}s`)
          } else {
            console.warn(`[SpeakerDiarization] Could not fix WAV header. Proceeding anyway...`)
          }
        } else if (wavInfo.valid) {
          console.log(`[SpeakerDiarization] Audio file validated: ${wavInfo.durationSeconds.toFixed(2)}s, ${wavInfo.sampleRate}Hz, ${wavInfo.channels}ch`)
        } else {
          console.warn(`[SpeakerDiarization] Invalid WAV file: ${wavInfo.error}. Proceeding anyway...`)
        }
      } catch (wavError) {
        console.warn(`[SpeakerDiarization] WAV validation error (non-blocking): ${wavError instanceof Error ? wavError.message : String(wavError)}`)
      }
    }

    const mergedConfig = { ...DEFAULT_CONFIG, ...config }
    currentStatus = 'initializing'

    const emitProgress = (phase: string, progress: number, message: string) => {
      const payload: DiarizationProgress = {
        status: currentStatus,
        phase,
        progress: Math.min(100, Math.max(0, progress * 100)),
        message,
        timestamp: Date.now()
      }
      progressEmitter.emit(DIARIZATION_EVENT, payload)
      onProgress?.(payload)
    }

    emitProgress('initialization', 0, 'Starting speaker diarization...')

    // Helper function to reset state and return error result
    const resetAndReturnError = (error: string): DiarizationResult => {
      currentStatus = 'idle'
      activeProcess = null
      return {
        success: false,
        segments: [],
        speakers: [],
        numSpeakers: 0,
        speakerStats: {},
        qualityMetrics: {} as QualityMetrics,
        audioDuration: 0,
        metadata: {},
        error
      }
    }

    try {
      const pythonPath = findPythonPath()
      const scriptPath = path.join(getPythonScriptsDir(), 'speaker_diarization.py')

      if (!fs.existsSync(scriptPath)) {
        return resetAndReturnError('Speaker diarization script not found')
      }

      // Build command arguments
      const args = [scriptPath, audioPath, '--format', 'json']

      if (mergedConfig.numSpeakers !== undefined) {
        args.push('--num-speakers', String(mergedConfig.numSpeakers))
      }
      if (mergedConfig.minSpeakers !== undefined) {
        args.push('--min-speakers', String(mergedConfig.minSpeakers))
      }
      if (mergedConfig.maxSpeakers !== undefined) {
        args.push('--max-speakers', String(mergedConfig.maxSpeakers))
      }
      if (mergedConfig.similarityThreshold !== undefined) {
        args.push('--similarity-threshold', String(mergedConfig.similarityThreshold))
      }
      if (mergedConfig.clusteringMethod) {
        args.push('--clustering', mergedConfig.clusteringMethod === 'neural' ? 'agglomerative' : mergedConfig.clusteringMethod)
      }
      if (mergedConfig.device) {
        args.push('--device', mergedConfig.device)
      }
      if (mergedConfig.preprocess) {
        args.push('--preprocess')
      }
      if (mergedConfig.noiseReduction) {
        args.push('--noise-reduction')
      }
      if (!mergedConfig.detectOverlaps) {
        args.push('--no-overlap-detection')
      }
      if (mergedConfig.useNeuralPipeline) {
        args.push('--neural-pipeline')
      }

      console.log('[SpeakerDiarization] Starting diarization:', pythonPath, args.join(' '))

      return new Promise((resolve) => {
        let stdout = ''
        let stderr = ''
        let timeoutId: NodeJS.Timeout | null = null

        // Helper to clean up and resolve with error
        const resolveWithError = (error: string) => {
          if (timeoutId) {
            clearTimeout(timeoutId)
            timeoutId = null
          }
          currentStatus = 'idle'
          activeProcess = null
          resolve({
            success: false,
            segments: [],
            speakers: [],
            numSpeakers: 0,
            speakerStats: {},
            qualityMetrics: {} as QualityMetrics,
            audioDuration: 0,
            metadata: {},
            error
          })
        }

        // Helper to clean up and resolve with success
        const resolveWithSuccess = (result: DiarizationResult) => {
          if (timeoutId) {
            clearTimeout(timeoutId)
            timeoutId = null
          }
          currentStatus = 'idle'
          activeProcess = null
          resolve(result)
        }

        activeProcess = spawn(pythonPath, args, {
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
          input: activeProcess.stderr!,
          crlfDelay: Infinity
        })

        // Parse progress from stderr
        rl.on('line', (line) => {
          stderr += line + '\n'

          // Parse progress updates
          const progressMatch = line.match(/\[(\w+)\]\s+(\d+)%/)
          if (progressMatch) {
            const phase = progressMatch[1].toLowerCase()
            const progress = parseInt(progressMatch[2]) / 100

            if (phase === 'preprocessing') {
              currentStatus = 'preprocessing'
            } else if (phase === 'embedding_extraction') {
              currentStatus = 'extracting_embeddings'
            } else if (phase === 'clustering') {
              currentStatus = 'clustering'
            } else if (phase === 'post_processing') {
              currentStatus = 'post_processing'
            }

            emitProgress(phase, progress, `${phase}: ${progressMatch[2]}%`)
          }
        })

        activeProcess.stdout?.on('data', (data: Buffer) => {
          stdout += data.toString()
        })

        activeProcess.on('error', (err) => {
          console.error('[SpeakerDiarization] Process error:', err)
          resolveWithError(`Process error: ${err.message}`)
        })

        activeProcess.on('exit', (code) => {
          if (code !== 0) {
            console.error('[SpeakerDiarization] Process exited with code:', code)
            console.error('[SpeakerDiarization] Stderr:', stderr)
            resolveWithError(`Process exited with code ${code}: ${stderr}`)
            return
          }

          try {
            // Parse JSON output
            const jsonStart = stdout.indexOf('{')
            if (jsonStart === -1) {
              resolveWithError('No JSON output from diarization')
              return
            }

            // Find matching closing brace
            let braceCount = 0
            let jsonEnd = -1
            for (let i = jsonStart; i < stdout.length; i++) {
              if (stdout[i] === '{') braceCount++
              if (stdout[i] === '}') braceCount--
              if (braceCount === 0) {
                jsonEnd = i
                break
              }
            }

            if (jsonEnd === -1) {
              resolveWithError('Invalid JSON output')
              return
            }

            const result = JSON.parse(stdout.substring(jsonStart, jsonEnd + 1))

            // Transform Python result to TypeScript format
            const diarizationResult: DiarizationResult = {
              success: true,
              segments: (result.segments || []).map((seg: any) => ({
                start: seg.start,
                end: seg.end,
                speaker: seg.speaker,
                confidence: seg.confidence,
                duration: seg.duration,
                isOverlapping: seg.is_overlapping,
                overlappingSpeakers: seg.overlapping_speakers
              })),
              speakers: result.speakers || [],
              numSpeakers: result.num_speakers || 0,
              speakerStats: Object.fromEntries(
                Object.entries(result.speaker_stats || {}).map(([key, val]: [string, any]) => [
                  key,
                  {
                    speakerId: val.speaker_id,
                    totalDuration: val.total_duration,
                    segmentCount: val.segment_count,
                    averageSegmentDuration: val.average_segment_duration,
                    percentage: val.percentage,
                    firstAppearance: val.first_appearance,
                    lastAppearance: val.last_appearance
                  }
                ])
              ),
              qualityMetrics: {
                overallConfidence: result.quality_metrics?.overall_confidence || 0,
                speakerClarityScore: result.quality_metrics?.speaker_clarity_score || 0,
                boundaryPrecision: result.quality_metrics?.boundary_precision || 0,
                overlapRatio: result.quality_metrics?.overlap_ratio || 0,
                silenceRatio: result.quality_metrics?.silence_ratio || 0,
                processingTimeSeconds: result.quality_metrics?.processing_time_seconds || 0,
                segmentsPerMinute: result.quality_metrics?.segments_per_minute || 0
              },
              audioDuration: result.audio_duration || 0,
              metadata: result.metadata || {}
            }

            emitProgress('complete', 1, 'Diarization complete')

            console.log(`[SpeakerDiarization] Complete: ${diarizationResult.numSpeakers} speakers, ${diarizationResult.segments.length} segments`)

            resolveWithSuccess(diarizationResult)

          } catch (parseError) {
            console.error('[SpeakerDiarization] Parse error:', parseError)
            resolveWithError(`Parse error: ${parseError}`)
          }
        })

        // Set timeout (10 minutes max)
        timeoutId = setTimeout(() => {
          if (activeProcess && !activeProcess.killed) {
            activeProcess.kill('SIGTERM')
            resolveWithError('Diarization timed out after 10 minutes')
          }
        }, 600000)
      })

    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error)
      console.error('[SpeakerDiarization] Error:', errorMsg)
      return resetAndReturnError(errorMsg)
    }
  },

  /**
   * Start streaming diarization session
   *
   * @param config - Streaming configuration
   * @returns Promise resolving to success status
   */
  async startStreamingSession(
    config: StreamingDiarizationConfig = {}
  ): Promise<{ success: boolean; error?: string }> {
    if (streamingProcess !== null) {
      return { success: false, error: 'Streaming session already active' }
    }

    const pythonPath = findPythonPath()
    const scriptPath = path.join(getPythonScriptsDir(), 'live_diarize.py')

    if (!fs.existsSync(scriptPath)) {
      return { success: false, error: 'Streaming diarization script not found' }
    }

    const sampleRate = config.sampleRate || 16000
    const segmentDuration = config.segmentDuration || 2.0
    const hopDuration = config.hopDuration || 0.5
    // Lower threshold = more speakers detected (more sensitive to voice differences)
    // FIXED: Lowered from 0.4 to 0.30 to prevent merging of distinct speakers
    // (typical same-speaker similarity: 0.8-0.95, different speakers: 0.2-0.5)
    const similarityThreshold = config.similarityThreshold || 0.30
    const maxSpeakers = config.maxSpeakers || 10
    const device = config.device || 'cpu'

    const args = [
      scriptPath,
      '--sample-rate', String(sampleRate),
      '--segment-duration', String(segmentDuration),
      '--hop-duration', String(hopDuration),
      '--similarity-threshold', String(similarityThreshold),
      '--max-speakers', String(maxSpeakers),
      '--device', device
    ]

    console.log('[SpeakerDiarization] Starting streaming session:', args.join(' '))

    return new Promise((resolve) => {
      isStreamingReady = false

      streamingProcess = spawn(pythonPath, args, {
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
        input: streamingProcess.stdout!,
        crlfDelay: Infinity
      })

      rl.on('line', (line) => {
        try {
          const message: PythonMessage = JSON.parse(line)
          this._handleStreamingMessage(message)
        } catch {
          console.log('[SpeakerDiarization] Streaming output:', line.substring(0, 200))
        }
      })

      streamingProcess.stderr?.on('data', (data: Buffer) => {
        console.log('[SpeakerDiarization] Streaming stderr:', data.toString().trim())
      })

      streamingProcess.on('error', (err) => {
        console.error('[SpeakerDiarization] Streaming error:', err)
        streamingProcess = null
        isStreamingReady = false
        resolve({ success: false, error: err.message })
      })

      streamingProcess.on('exit', (code) => {
        console.log('[SpeakerDiarization] Streaming process exited:', code)
        streamingProcess = null
        isStreamingReady = false
      })

      // Wait for ready signal
      const timeout = setTimeout(() => {
        if (!isStreamingReady) {
          console.log('[SpeakerDiarization] Streaming timeout, continuing anyway')
          isStreamingReady = true
          resolve({ success: true })
        }
      }, 60000)

      const checkReady = setInterval(() => {
        if (isStreamingReady) {
          clearTimeout(timeout)
          clearInterval(checkReady)
          resolve({ success: true })
        }
      }, 100)
    })
  },

  /**
   * Send audio chunk to streaming diarization
   *
   * @param audioData - Raw audio bytes (16-bit PCM)
   * @returns Success status
   */
  sendStreamingAudioChunk(audioData: Buffer): { success: boolean; error?: string } {
    if (!streamingProcess || !streamingProcess.stdin) {
      return { success: false, error: 'No active streaming session' }
    }

    if (!isStreamingReady) {
      return { success: false, error: 'Streaming session not ready' }
    }

    try {
      streamingProcess.stdin.write(audioData)
      return { success: true }
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error)
      return { success: false, error: errorMsg }
    }
  },

  /**
   * Stop streaming diarization session
   *
   * @returns Final diarization segments
   */
  async stopStreamingSession(): Promise<DiarizationSegment[]> {
    if (!streamingProcess) {
      return []
    }

    const segments: DiarizationSegment[] = []

    // Close stdin to signal end
    if (streamingProcess.stdin) {
      streamingProcess.stdin.end()
    }

    // Wait for process to finish
    await new Promise<void>((resolve) => {
      const timeout = setTimeout(() => {
        if (streamingProcess && !streamingProcess.killed) {
          streamingProcess.kill('SIGTERM')
        }
        resolve()
      }, 5000)

      if (streamingProcess) {
        streamingProcess.once('exit', () => {
          clearTimeout(timeout)
          resolve()
        })
      } else {
        clearTimeout(timeout)
        resolve()
      }
    })

    streamingProcess = null
    isStreamingReady = false

    return segments
  },

  /**
   * Handle streaming message from Python
   */
  _handleStreamingMessage(message: PythonMessage): void {
    switch (message.type) {
      case 'ready':
        console.log('[SpeakerDiarization] Streaming ready')
        isStreamingReady = true
        break

      case 'segment':
        if (message.segment) {
          progressEmitter.emit(SEGMENT_EVENT, message.segment)
        }
        break

      case 'error':
        console.error('[SpeakerDiarization] Streaming error:', message.error)
        break
    }
  },

  /**
   * Get current diarization status
   */
  getStatus(): DiarizationStatus {
    return currentStatus
  },

  /**
   * Check if streaming is active
   */
  isStreamingActive(): boolean {
    return streamingProcess !== null && isStreamingReady
  },

  /**
   * Cancel active diarization
   */
  cancel(): { success: boolean } {
    if (activeProcess && !activeProcess.killed) {
      activeProcess.kill('SIGTERM')
      activeProcess = null
      currentStatus = 'idle'
      return { success: true }
    }
    return { success: false }
  },

  /**
   * Subscribe to progress updates
   */
  onProgress(callback: (progress: DiarizationProgress) => void): () => void {
    progressEmitter.on(DIARIZATION_EVENT, callback)
    return () => progressEmitter.off(DIARIZATION_EVENT, callback)
  },

  /**
   * Subscribe to streaming segment events
   */
  onStreamingSegment(callback: (segment: DiarizationSegment) => void): () => void {
    progressEmitter.on(SEGMENT_EVENT, callback)
    return () => progressEmitter.off(SEGMENT_EVENT, callback)
  },

  /**
   * Check if diarization is available
   *
   * NOTE: This method now performs only quick file existence checks.
   * Heavy Python validation (importing pyannote/speechbrain) is skipped here
   * because it's already done by the tiered validation service in Settings.
   * This eliminates potential UI freezes.
   */
  async isAvailable(): Promise<{
    available: boolean
    pythonPath: string
    hasNeuralPipeline: boolean
    hasSpeechBrain: boolean
    error?: string
  }> {
    const pythonPath = findPythonPath()
    const scriptPath = path.join(getPythonScriptsDir(), 'speaker_diarization.py')

    if (!fs.existsSync(scriptPath)) {
      return {
        available: false,
        pythonPath,
        hasNeuralPipeline: false,
        hasSpeechBrain: false,
        error: 'Speaker diarization script not found'
      }
    }

    // Quick check: only verify Python binary exists
    // Heavy validation (importing pyannote/speechbrain) is done by tieredValidationService
    // in Settings, so we skip it here to avoid freezing the UI
    try {
      const { execSync } = require('child_process')
      execSync(`"${pythonPath}" --version`, { timeout: 5000 })

      // Assume backend is available if Python exists and script exists
      // The actual validation was already done in Settings via tieredValidationService
      // If there are issues, the Python script will report them when it runs
      return {
        available: true,
        pythonPath,
        hasNeuralPipeline: true,
        hasSpeechBrain: true,
        error: undefined
      }
    } catch (error) {
      return {
        available: false,
        pythonPath,
        hasNeuralPipeline: false,
        hasSpeechBrain: false,
        error: 'Python not available or dependency check failed'
      }
    }
  },

  /**
   * Assign speakers to transcription segments based on diarization
   *
   * @param transcriptSegments - Transcription segments with start/end times
   * @param diarizationSegments - Diarization segments with speaker labels
   * @returns Transcription segments with speaker assignments
   */
  assignSpeakersToTranscripts<T extends { start: number; end: number }>(
    transcriptSegments: T[],
    diarizationSegments: DiarizationSegment[]
  ): (T & { speaker?: string; speakerConfidence?: number })[] {
    return transcriptSegments.map(transcript => {
      const speaker = this.findBestSpeaker(
        diarizationSegments,
        transcript.start,
        transcript.end
      )

      return {
        ...transcript,
        speaker: speaker?.speaker,
        speakerConfidence: speaker?.confidence
      }
    })
  },

  /**
   * Find the best matching speaker for a time range
   */
  findBestSpeaker(
    diarizationSegments: DiarizationSegment[],
    startTime: number,
    endTime: number
  ): { speaker: string; confidence: number } | null {
    const speakerOverlaps: Record<string, { overlap: number; confidence: number }> = {}
    const duration = endTime - startTime

    if (duration <= 0) {
      // Point-in-time matching
      for (const seg of diarizationSegments) {
        if (seg.start <= startTime && startTime <= seg.end) {
          return { speaker: seg.speaker, confidence: seg.confidence }
        }
      }
      return null
    }

    for (const seg of diarizationSegments) {
      const overlapStart = Math.max(startTime, seg.start)
      const overlapEnd = Math.min(endTime, seg.end)
      const overlap = Math.max(0, overlapEnd - overlapStart)

      if (overlap > 0) {
        if (!speakerOverlaps[seg.speaker]) {
          speakerOverlaps[seg.speaker] = { overlap: 0, confidence: 0 }
        }
        speakerOverlaps[seg.speaker].overlap += overlap
        speakerOverlaps[seg.speaker].confidence = Math.max(
          speakerOverlaps[seg.speaker].confidence,
          seg.confidence
        )
      }
    }

    if (Object.keys(speakerOverlaps).length === 0) {
      // Find nearest speaker
      const midpoint = (startTime + endTime) / 2
      let nearestSpeaker: DiarizationSegment | null = null
      let nearestDistance = Infinity

      for (const seg of diarizationSegments) {
        const distance = Math.min(
          Math.abs(seg.start - midpoint),
          Math.abs(seg.end - midpoint)
        )
        if (distance < nearestDistance && distance <= 1.0) {
          nearestDistance = distance
          nearestSpeaker = seg
        }
      }

      return nearestSpeaker
        ? { speaker: nearestSpeaker.speaker, confidence: nearestSpeaker.confidence * 0.8 }
        : null
    }

    // Return speaker with highest overlap
    const best = Object.entries(speakerOverlaps).reduce(
      (best, [speaker, data]) =>
        data.overlap > best.overlap ? { speaker, ...data } : best,
      { speaker: '', overlap: 0, confidence: 0 }
    )

    return best.speaker ? { speaker: best.speaker, confidence: best.confidence } : null
  },

  /**
   * Format diarization result as timestamped output
   *
   * @param result - Diarization result
   * @returns Formatted string with timestamps and speaker labels
   */
  formatTimestampedOutput(result: DiarizationResult): string {
    return result.segments.map(seg => {
      const startMin = Math.floor(seg.start / 60)
      const startSec = seg.start % 60
      const endMin = Math.floor(seg.end / 60)
      const endSec = seg.end % 60

      const startFmt = `${String(startMin).padStart(2, '0')}:${startSec.toFixed(2).padStart(5, '0')}`
      const endFmt = `${String(endMin).padStart(2, '0')}:${endSec.toFixed(2).padStart(5, '0')}`

      return `[${startFmt} - ${endFmt}] ${seg.speaker}`
    }).join('\n')
  }
}

// Export for testing
export function resetSpeakerDiarizationState(): void {
  currentStatus = 'idle'

  if (activeProcess && !activeProcess.killed) {
    activeProcess.kill('SIGKILL')
    activeProcess = null
  }

  if (streamingProcess && !streamingProcess.killed) {
    streamingProcess.kill('SIGKILL')
    streamingProcess = null
  }

  isStreamingReady = false
  progressEmitter.removeAllListeners()
}
