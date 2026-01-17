/**
 * ML Pipeline Service
 *
 * Spawns Python processes for audio transcription and speaker diarization.
 * Streams audio file paths to Python, receives results via stdout/JSON.
 * Handles errors, timeouts, and progress updates.
 */

import { spawn, ChildProcess, execSync } from 'child_process'
import { EventEmitter } from 'events'
import * as path from 'path'
import * as fs from 'fs'
import { randomUUID } from 'crypto'
import { pythonEnvironment } from './pythonEnvironment'

// Electron app is imported dynamically to support testing outside Electron context
let app: { isPackaged?: boolean } | undefined
try {
  app = require('electron').app
} catch {
  // Not running in Electron context (e.g., during tests)
  app = undefined
}

// ============================================================================
// Types
// ============================================================================

export type PipelinePhase = 'idle' | 'preprocessing' | 'transcription' | 'alignment' | 'diarization' | 'combining' | 'completed' | 'error'

export type ModelSize = 'tiny' | 'base' | 'small' | 'medium' | 'large-v2' | 'large-v3'

export type DeviceType = 'cuda' | 'cpu' | 'auto'

export interface TranscriptionConfig {
  modelSize?: ModelSize
  language?: string
  device?: DeviceType
  batchSize?: number
  alignWords?: boolean
}

export interface DiarizationConfig {
  numSpeakers?: number
  minSpeakers?: number
  maxSpeakers?: number
  device?: DeviceType
  hfToken?: string
  /**
   * Clustering threshold for speaker separation (0.0 to 2.0)
   * Lower values = more speakers detected (more sensitive to differences)
   * Higher values = fewer speakers detected (more tolerant of differences)
   * Default pyannote value is around 0.7, but lower values (0.4-0.6) often work better
   * for meetings with speakers who have similar voices.
   */
  clusteringThreshold?: number
}

export interface TranscriptionSegment {
  /** Start time in seconds */
  start: number
  /** End time in seconds */
  end: number
  /** Transcribed text content */
  text: string
  /** Segment-level confidence score (0.0-1.0), calculated from word-level scores */
  confidence?: number
  /** Word-level timestamps and confidence scores */
  words?: Array<{
    /** Word start time in seconds */
    start: number
    /** Word end time in seconds */
    end: number
    /** The transcribed word */
    word: string
    /** Word-level confidence score (0.0-1.0) */
    confidence?: number
  }>
}

export interface TranscriptionResult {
  success: boolean
  segments: TranscriptionSegment[]
  metadata: {
    /** Path to the transcribed audio file */
    audioFile: string
    /** Model size used (e.g., 'large-v2') */
    modelSize: string
    /** Language code (e.g., 'en') */
    language: string
    /** Device used for inference ('cuda' or 'cpu') */
    device: string
    /** Audio duration in seconds */
    duration?: number
    /** Whether word-level alignment was performed */
    wordAligned: boolean
    /** Transcription backend used ('whisperx' or 'faster-whisper') */
    backend?: string
    /** Expected sample rate for optimal transcription (16000 Hz) */
    expectedSampleRate?: number
  }
  error?: string
}

export interface DiarizationSegment {
  start: number
  end: number
  duration: number
  speaker: string
}

export interface DiarizationResult {
  success: boolean
  segments: DiarizationSegment[]
  speakers: string[]
  numSpeakers: number
  metadata: {
    audioFile: string
    model: string
    device: string
    requestedNumSpeakers?: number
    requestedMinSpeakers?: number
    requestedMaxSpeakers?: number
  }
  speakerStats?: Record<string, {
    totalDuration: number
    numSegments: number
    percentage: number
  }>
  error?: string
}

export interface CombinedSegment extends TranscriptionSegment {
  speaker?: string
}

export interface PipelineProgress {
  jobId: string
  phase: PipelinePhase
  progress: number // 0-100
  message: string
  timestamp: number
}

export interface PipelineJob {
  id: string
  audioPath: string
  status: 'pending' | 'running' | 'completed' | 'cancelled' | 'error'
  phase: PipelinePhase
  progress: number
  startTime: number
  endTime?: number
  error?: string
  process?: ChildProcess
}

export interface PipelineStatus {
  activeJobs: number
  jobs: Array<{
    id: string
    audioPath: string
    status: string
    phase: PipelinePhase
    progress: number
    startTime: number
    endTime?: number
    error?: string
  }>
}

// ============================================================================
// Constants
// ============================================================================

const DEFAULT_TIMEOUT = 600000 // 10 minutes
const PROGRESS_EVENT = 'ml-pipeline:progress'

// ============================================================================
// Service State
// ============================================================================

const activeJobs = new Map<string, PipelineJob>()
const progressEmitter = new EventEmitter()

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Get the path to the Python scripts directory
 */
function getPythonScriptsDir(): string {
  // In development, scripts are in the project's python directory
  // In production, they should be bundled with the app
  if (app?.isPackaged) {
    return path.join(process.resourcesPath || '', 'python')
  }
  // In development, __dirname is dist-electron/, so we go up one level to find python/
  return path.join(__dirname, '../python')
}

/**
 * Find the Python executable path for a specific purpose
 * Uses the dual environment system when available:
 * - venv-whisperx: Python 3.12 + WhisperX + torch 2.8 (for transcription)
 * - venv-pyannote: Python 3.12 + Pyannote + torch 2.5.1 (for diarization)
 * Supports multiple virtual environment directories as fallback
 *
 * @param purpose - 'transcription' for WhisperX, 'diarization' for Pyannote
 */
function findPythonPath(purpose: 'transcription' | 'diarization' = 'transcription'): string {
  const scriptsDir = getPythonScriptsDir()

  // Map purpose to pythonEnvironment purpose type
  const envPurpose = purpose === 'diarization' ? 'pyannote' : 'whisperx'

  // Use the centralized pythonEnvironment service for purpose-specific path
  const purposePath = pythonEnvironment.getPythonPathForPurpose(envPurpose)
  if (purposePath) {
    console.log(`[ML Pipeline] Using ${envPurpose} Python path for ${purpose}:`, purposePath)
    return purposePath
  }

  // Fallback: Check for bundled Python executable (highest priority for packaged apps)
  if (app?.isPackaged) {
    const bundledExecutable = process.platform === 'win32'
      ? path.join(scriptsDir, 'transcription_bundle.exe')
      : path.join(scriptsDir, 'transcription_bundle')

    if (fs.existsSync(bundledExecutable)) {
      console.log('[ML Pipeline] Using bundled Python executable:', bundledExecutable)
      return bundledExecutable
    }
  }

  // Fallback: List of virtual environment directories to check, in order of preference
  // For diarization, prefer venv-pyannote first
  // For transcription, prefer venv-whisperx first
  const venvDirs = purpose === 'diarization'
    ? ['venv-pyannote', 'venv-3.12', 'venv']
    : ['venv-whisperx', 'venv-3.12', 'venv']

  // Check for virtual environments in order of preference
  for (const venvName of venvDirs) {
    const venvPath = path.join(scriptsDir, venvName)
    const venvPython = process.platform === 'win32'
      ? path.join(venvPath, 'Scripts', 'python.exe')
      : path.join(venvPath, 'bin', 'python')

    if (fs.existsSync(venvPython)) {
      console.log(`[ML Pipeline] Using virtual environment: ${venvName}`)
      return venvPython
    }
  }

  // Check environment variable
  if (process.env.PYTHON_PATH && fs.existsSync(process.env.PYTHON_PATH)) {
    return process.env.PYTHON_PATH
  }

  // Try to find python3 or python
  try {
    const pythonPath = execSync('which python3 2>/dev/null || which python 2>/dev/null', {
      encoding: 'utf8',
      timeout: 5000
    }).trim()
    if (pythonPath) {
      return pythonPath
    }
  } catch {
    // Ignore errors
  }

  // Default fallback
  return process.platform === 'win32' ? 'python' : 'python3'
}

/**
 * Validate that an audio file exists
 */
function validateAudioFile(audioPath: string): void {
  if (!fs.existsSync(audioPath)) {
    throw new Error(`Audio file not found: ${audioPath}`)
  }

  const stats = fs.statSync(audioPath)
  if (stats.size === 0) {
    throw new Error(`Audio file is empty: ${audioPath}`)
  }
}

/**
 * Emit progress update
 */
function emitProgress(jobId: string, phase: PipelinePhase, progress: number, message: string): void {
  const payload: PipelineProgress = {
    jobId,
    phase,
    progress: Math.min(100, Math.max(0, progress)),
    message,
    timestamp: Date.now()
  }
  progressEmitter.emit(PROGRESS_EVENT, payload)

  // Update job state
  const job = activeJobs.get(jobId)
  if (job) {
    job.phase = phase
    job.progress = payload.progress
  }
}

/**
 * Parse progress from Python stderr (e.g., tqdm output)
 */
function parseProgressFromStderr(data: string, jobId: string, currentPhase: PipelinePhase): void {
  // Try to parse percentage from output
  const percentMatch = data.match(/(\d+)%/)
  if (percentMatch) {
    const percent = parseInt(percentMatch[1], 10)
    emitProgress(jobId, currentPhase, percent, data.trim())
    return
  }

  // Try to parse fraction like "5/10"
  const fractionMatch = data.match(/(\d+)\/(\d+)/)
  if (fractionMatch) {
    const current = parseInt(fractionMatch[1], 10)
    const total = parseInt(fractionMatch[2], 10)
    const percent = Math.round((current / total) * 100)
    emitProgress(jobId, currentPhase, percent, data.trim())
    return
  }

  // Log other stderr output
  const trimmed = data.trim()
  if (trimmed && !trimmed.includes('WARN')) {
    console.log(`[ML Pipeline ${jobId}] ${trimmed}`)
  }
}

/**
 * Spawn a Python process with timeout handling
 * @param scriptName - Name of the Python script to run
 * @param args - Arguments to pass to the script
 * @param jobId - Job ID for tracking
 * @param timeout - Timeout in milliseconds
 * @param purpose - 'transcription' for WhisperX environment, 'diarization' for Pyannote environment
 */
function spawnPythonProcess(
  scriptName: string,
  args: string[],
  jobId: string,
  timeout: number = DEFAULT_TIMEOUT,
  purpose: 'transcription' | 'diarization' = 'transcription'
): Promise<string> {
  return new Promise((resolve, reject) => {
    const pythonPath = findPythonPath(purpose)
    const scriptPath = path.join(getPythonScriptsDir(), scriptName)

    if (!fs.existsSync(scriptPath)) {
      reject(new Error(`Python script not found: ${scriptPath}`))
      return
    }

    const job = activeJobs.get(jobId)
    if (!job) {
      reject(new Error(`Job ${jobId} not found`))
      return
    }

    console.log(`[ML Pipeline ${jobId}] Spawning: ${pythonPath} ${scriptPath} ${args.join(' ')}`)

    const process = spawn(pythonPath, [scriptPath, ...args], {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: {
        ...process.env,
        PYTHONUNBUFFERED: '1', // Force unbuffered output
        // PyTorch 2.6+ compatibility: disable weights_only enforcement for model loading
        // This is a fallback for models that contain pickled objects beyond what we allowlist
        TORCH_FORCE_NO_WEIGHTS_ONLY_LOAD: '1',
        // Suppress torchaudio deprecation warnings from pyannote.audio
        // These warnings come from pyannote using deprecated torchaudio.list_audio_backends()
        // See: https://github.com/pytorch/audio/issues/3902
        PYTHONWARNINGS: 'ignore::UserWarning,ignore::DeprecationWarning,ignore::FutureWarning'
      }
    })

    job.process = process
    job.status = 'running'

    let stdout = ''
    let stderr = ''
    let timeoutId: NodeJS.Timeout | null = null

    // Set up timeout
    if (timeout > 0) {
      timeoutId = setTimeout(() => {
        console.log(`[ML Pipeline ${jobId}] Process timeout after ${timeout}ms`)
        process.kill('SIGTERM')
        setTimeout(() => {
          if (!process.killed) {
            process.kill('SIGKILL')
          }
        }, 5000)
        reject(new Error(`Process timed out after ${timeout}ms`))
      }, timeout)
    }

    process.stdout?.on('data', (data: Buffer) => {
      stdout += data.toString()
    })

    process.stderr?.on('data', (data: Buffer) => {
      const text = data.toString()
      stderr += text
      parseProgressFromStderr(text, jobId, job.phase)
    })

    process.on('exit', (code, signal) => {
      if (timeoutId) {
        clearTimeout(timeoutId)
      }

      job.process = undefined

      if (job.status === 'cancelled') {
        reject(new Error('Process was cancelled'))
        return
      }

      if (code === 0) {
        job.status = 'completed'
        job.endTime = Date.now()
        resolve(stdout)
      } else {
        job.status = 'error'
        job.endTime = Date.now()
        job.error = stderr || `Process exited with code ${code}, signal ${signal}`
        reject(new Error(job.error))
      }
    })

    process.on('error', (err) => {
      if (timeoutId) {
        clearTimeout(timeoutId)
      }

      job.process = undefined
      job.status = 'error'
      job.endTime = Date.now()
      job.error = err.message
      reject(err)
    })
  })
}

/**
 * Parse JSON output from Python script
 */
function parseJsonOutput<T>(output: string): T {
  // Find the JSON object in the output (might have logging before it)
  const jsonStart = output.indexOf('{')
  if (jsonStart === -1) {
    throw new Error('No JSON found in output')
  }

  // Find the matching closing brace
  let braceCount = 0
  let jsonEnd = -1
  for (let i = jsonStart; i < output.length; i++) {
    if (output[i] === '{') braceCount++
    if (output[i] === '}') braceCount--
    if (braceCount === 0) {
      jsonEnd = i
      break
    }
  }

  if (jsonEnd === -1) {
    throw new Error('Invalid JSON in output - no matching closing brace')
  }

  const jsonStr = output.substring(jsonStart, jsonEnd + 1)
  return JSON.parse(jsonStr)
}

// ============================================================================
// ML Pipeline Service
// ============================================================================

export const mlPipelineService = {
  /**
   * Transcribe an audio file using WhisperX
   */
  async transcribe(
    audioPath: string,
    config: TranscriptionConfig = {},
    onProgress?: (progress: PipelineProgress) => void
  ): Promise<TranscriptionResult> {
    // Validate audio file
    validateAudioFile(audioPath)

    // Create job
    const jobId = randomUUID()
    const job: PipelineJob = {
      id: jobId,
      audioPath,
      status: 'pending',
      phase: 'preprocessing',
      progress: 0,
      startTime: Date.now()
    }
    activeJobs.set(jobId, job)

    // Set up progress listener
    let unsubscribe: (() => void) | null = null
    if (onProgress) {
      const handler = (progress: PipelineProgress) => {
        if (progress.jobId === jobId) {
          onProgress(progress)
        }
      }
      progressEmitter.on(PROGRESS_EVENT, handler)
      unsubscribe = () => progressEmitter.off(PROGRESS_EVENT, handler)
    }

    try {
      emitProgress(jobId, 'transcription', 0, 'Starting transcription...')

      // Build arguments
      const args: string[] = [audioPath]

      if (config.modelSize) {
        args.push('--model', config.modelSize)
      }
      if (config.language) {
        args.push('--language', config.language)
      }
      if (config.device && config.device !== 'auto') {
        args.push('--device', config.device)
      }
      if (config.batchSize) {
        args.push('--batch-size', config.batchSize.toString())
      }
      if (config.alignWords === false) {
        args.push('--no-align')
      }

      args.push('--format', 'json')

      // Run transcription using WhisperX environment
      job.phase = 'transcription'
      const output = await spawnPythonProcess('transcribe.py', args, jobId, DEFAULT_TIMEOUT, 'transcription')

      // Parse result
      const rawResult = parseJsonOutput<{
        segments: Array<{
          start: number
          end: number
          text: string
          confidence?: number
          words?: Array<{
            start: number
            end: number
            word: string
            score?: number
          }>
        }>
        metadata?: {
          audio_file?: string
          model_size?: string
          language?: string
          device?: string
          word_aligned?: boolean
          backend?: string
          expected_sample_rate?: number
        }
      }>(output)

      emitProgress(jobId, 'completed', 100, 'Transcription completed')

      // Transform to our format
      const result: TranscriptionResult = {
        success: true,
        segments: rawResult.segments.map(seg => ({
          start: seg.start,
          end: seg.end,
          text: seg.text.trim(),
          confidence: seg.confidence,
          words: seg.words?.map(w => ({
            start: w.start,
            end: w.end,
            word: w.word,
            confidence: w.score
          }))
        })),
        metadata: {
          audioFile: rawResult.metadata?.audio_file || audioPath,
          modelSize: rawResult.metadata?.model_size || config.modelSize || 'large-v2',
          language: rawResult.metadata?.language || config.language || 'en',
          device: rawResult.metadata?.device || 'auto',
          wordAligned: rawResult.metadata?.word_aligned !== false,
          backend: rawResult.metadata?.backend,
          expectedSampleRate: rawResult.metadata?.expected_sample_rate || 16000
        }
      }

      return result

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error)
      emitProgress(jobId, 'error', 0, `Transcription failed: ${errorMessage}`)

      return {
        success: false,
        segments: [],
        metadata: {
          audioFile: audioPath,
          modelSize: config.modelSize || 'large-v2',
          language: config.language || 'en',
          device: config.device || 'auto',
          wordAligned: config.alignWords !== false,
          expectedSampleRate: 16000
        },
        error: errorMessage
      }

    } finally {
      if (unsubscribe) {
        unsubscribe()
      }
      activeJobs.delete(jobId)
    }
  },

  /**
   * Perform speaker diarization using pyannote
   */
  async diarize(
    audioPath: string,
    config: DiarizationConfig = {},
    onProgress?: (progress: PipelineProgress) => void
  ): Promise<DiarizationResult> {
    // Validate audio file
    validateAudioFile(audioPath)

    // Create job
    const jobId = randomUUID()
    const job: PipelineJob = {
      id: jobId,
      audioPath,
      status: 'pending',
      phase: 'preprocessing',
      progress: 0,
      startTime: Date.now()
    }
    activeJobs.set(jobId, job)

    // Set up progress listener
    let unsubscribe: (() => void) | null = null
    if (onProgress) {
      const handler = (progress: PipelineProgress) => {
        if (progress.jobId === jobId) {
          onProgress(progress)
        }
      }
      progressEmitter.on(PROGRESS_EVENT, handler)
      unsubscribe = () => progressEmitter.off(PROGRESS_EVENT, handler)
    }

    try {
      emitProgress(jobId, 'diarization', 0, 'Starting diarization...')

      // Build arguments
      const args: string[] = [audioPath]

      if (config.numSpeakers !== undefined) {
        args.push('--num-speakers', config.numSpeakers.toString())
      }
      if (config.minSpeakers !== undefined) {
        args.push('--min-speakers', config.minSpeakers.toString())
      }
      if (config.maxSpeakers !== undefined) {
        args.push('--max-speakers', config.maxSpeakers.toString())
      }
      if (config.device && config.device !== 'auto') {
        args.push('--device', config.device)
      }
      if (config.hfToken) {
        args.push('--hf-token', config.hfToken)
      }
      if (config.clusteringThreshold !== undefined) {
        args.push('--clustering-threshold', config.clusteringThreshold.toString())
      }

      args.push('--format', 'json')
      args.push('--stats')

      // Run diarization using Pyannote environment
      // This uses venv-pyannote with torch 2.5.1 to avoid conflicts with WhisperX's torch 2.8
      job.phase = 'diarization'
      const output = await spawnPythonProcess('diarize.py', args, jobId, DEFAULT_TIMEOUT, 'diarization')

      // Parse result
      const rawResult = parseJsonOutput<{
        segments: Array<{
          start: number
          end: number
          duration: number
          speaker: string
        }>
        speakers: string[]
        num_speakers: number
        metadata?: {
          audio_file?: string
          model?: string
          device?: string
          requested_num_speakers?: number
          requested_min_speakers?: number
          requested_max_speakers?: number
        }
        speaker_stats?: Record<string, {
          total_duration: number
          num_segments: number
          percentage: number
        }>
      }>(output)

      emitProgress(jobId, 'completed', 100, 'Diarization completed')

      // Transform to our format
      const result: DiarizationResult = {
        success: true,
        segments: rawResult.segments.map(seg => ({
          start: seg.start,
          end: seg.end,
          duration: seg.duration,
          speaker: seg.speaker
        })),
        speakers: rawResult.speakers,
        numSpeakers: rawResult.num_speakers,
        metadata: {
          audioFile: rawResult.metadata?.audio_file || audioPath,
          model: rawResult.metadata?.model || 'pyannote/speaker-diarization-3.1',
          device: rawResult.metadata?.device || 'auto',
          requestedNumSpeakers: rawResult.metadata?.requested_num_speakers,
          requestedMinSpeakers: rawResult.metadata?.requested_min_speakers,
          requestedMaxSpeakers: rawResult.metadata?.requested_max_speakers
        }
      }

      // Add speaker stats if available
      if (rawResult.speaker_stats) {
        result.speakerStats = {}
        for (const [speaker, stats] of Object.entries(rawResult.speaker_stats)) {
          result.speakerStats[speaker] = {
            totalDuration: stats.total_duration,
            numSegments: stats.num_segments,
            percentage: stats.percentage
          }
        }
      }

      return result

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error)
      emitProgress(jobId, 'error', 0, `Diarization failed: ${errorMessage}`)

      return {
        success: false,
        segments: [],
        speakers: [],
        numSpeakers: 0,
        metadata: {
          audioFile: audioPath,
          model: 'pyannote/speaker-diarization-3.1',
          device: config.device || 'auto',
          requestedNumSpeakers: config.numSpeakers,
          requestedMinSpeakers: config.minSpeakers,
          requestedMaxSpeakers: config.maxSpeakers
        },
        error: errorMessage
      }

    } finally {
      if (unsubscribe) {
        unsubscribe()
      }
      activeJobs.delete(jobId)
    }
  },

  /**
   * Run complete pipeline: transcription + diarization + combining
   */
  async processComplete(
    audioPath: string,
    transcriptionConfig: TranscriptionConfig = {},
    diarizationConfig: DiarizationConfig = {},
    onProgress?: (progress: PipelineProgress) => void
  ): Promise<{
    transcription: TranscriptionResult
    diarization: DiarizationResult
    combined: CombinedSegment[]
  }> {
    // Validate audio file
    validateAudioFile(audioPath)

    // Create master job for tracking
    const jobId = randomUUID()

    // Set up progress forwarding
    const progressHandler = onProgress ? (progress: PipelineProgress) => {
      // Adjust progress to reflect overall pipeline progress
      let adjustedProgress = progress.progress
      if (progress.phase === 'transcription') {
        adjustedProgress = progress.progress * 0.45 // 0-45%
      } else if (progress.phase === 'diarization') {
        adjustedProgress = 45 + progress.progress * 0.45 // 45-90%
      } else if (progress.phase === 'combining') {
        adjustedProgress = 90 + progress.progress * 0.1 // 90-100%
      }

      onProgress({
        ...progress,
        jobId,
        progress: adjustedProgress
      })
    } : undefined

    // Run transcription
    const transcription = await this.transcribe(audioPath, transcriptionConfig, progressHandler)
    if (!transcription.success) {
      return {
        transcription,
        diarization: {
          success: false,
          segments: [],
          speakers: [],
          numSpeakers: 0,
          metadata: {
            audioFile: audioPath,
            model: 'pyannote/speaker-diarization-3.1',
            device: diarizationConfig.device || 'auto'
          },
          error: 'Skipped due to transcription failure'
        },
        combined: []
      }
    }

    // Run diarization
    const diarization = await this.diarize(audioPath, diarizationConfig, progressHandler)
    if (!diarization.success) {
      return {
        transcription,
        diarization,
        combined: transcription.segments.map(seg => ({ ...seg, speaker: undefined }))
      }
    }

    // Combine results
    if (progressHandler) {
      progressHandler({
        jobId,
        phase: 'combining',
        progress: 0,
        message: 'Combining transcription with diarization...',
        timestamp: Date.now()
      })
    }

    const combined = this.combineResults(transcription.segments, diarization.segments)

    if (progressHandler) {
      progressHandler({
        jobId,
        phase: 'completed',
        progress: 100,
        message: 'Pipeline completed',
        timestamp: Date.now()
      })
    }

    return { transcription, diarization, combined }
  },

  /**
   * Run diarization-first pipeline: diarization (MANDATORY) + transcription (optional)
   *
   * IMPORTANT: This method enforces the diarization-first architecture where
   * speaker diarization MUST complete successfully before transcription begins.
   * If diarization fails, the pipeline will HALT and return an error instead of
   * silently falling back to single-speaker mode.
   *
   * Pipeline Flow:
   *   Audio -> Diarization (BLOCKING) -> Validation Checkpoint -> Transcription -> Combined
   *
   * @param audioPath Path to audio file
   * @param diarizationConfig Configuration for diarization
   * @param transcriptionConfig Configuration for transcription (optional)
   * @param options Pipeline options
   * @param onProgress Progress callback
   * @returns Result with explicit failure information if diarization fails
   */
  async processDiarizationFirst(
    audioPath: string,
    diarizationConfig: DiarizationConfig = {},
    transcriptionConfig: TranscriptionConfig = {},
    options: {
      /** Skip transcription and only run diarization */
      diarizationOnly?: boolean
      /** Require diarization to succeed (throws on failure) */
      requireDiarization?: boolean
    } = {},
    onProgress?: (progress: PipelineProgress) => void
  ): Promise<{
    success: boolean
    diarization: DiarizationResult
    transcription?: TranscriptionResult
    combined: CombinedSegment[]
    blocked: boolean
    blockReason?: string
    failureMessage?: string
  }> {
    const DIARIZATION_FAILURE_MESSAGE = 'Speaker diarization is not available. Audio is being transcribed without speaker separation.'

    // Validate audio file
    validateAudioFile(audioPath)

    // Create master job for tracking
    const jobId = randomUUID()

    // Phase 1: MANDATORY Diarization Stage
    if (onProgress) {
      onProgress({
        jobId,
        phase: 'diarization',
        progress: 0,
        message: 'Starting mandatory diarization stage...',
        timestamp: Date.now()
      })
    }

    const diarization = await this.diarize(
      audioPath,
      diarizationConfig,
      onProgress ? (p) => {
        onProgress({
          ...p,
          jobId,
          progress: p.progress * 0.5, // 0-50% for diarization
          message: `Diarization: ${p.message}`
        })
      } : undefined
    )

    // BLOCKING CHECK: Diarization must succeed
    if (!diarization.success) {
      console.error('[ML Pipeline] BLOCKING: Diarization failed - halting pipeline')
      console.error(`[ML Pipeline] Failure reason: ${diarization.error}`)
      console.error(`[ML Pipeline] ${DIARIZATION_FAILURE_MESSAGE}`)

      if (onProgress) {
        onProgress({
          jobId,
          phase: 'error',
          progress: 0,
          message: DIARIZATION_FAILURE_MESSAGE,
          timestamp: Date.now()
        })
      }

      if (options.requireDiarization) {
        throw new Error(`Diarization required but failed: ${diarization.error}`)
      }

      return {
        success: false,
        diarization,
        combined: [],
        blocked: true,
        blockReason: diarization.error || 'Diarization failed',
        failureMessage: DIARIZATION_FAILURE_MESSAGE
      }
    }

    // Validation Checkpoint: Verify diarization output
    if (diarization.segments.length === 0) {
      console.error('[ML Pipeline] BLOCKING: Diarization produced no segments')
      console.error(`[ML Pipeline] ${DIARIZATION_FAILURE_MESSAGE}`)

      if (onProgress) {
        onProgress({
          jobId,
          phase: 'error',
          progress: 0,
          message: DIARIZATION_FAILURE_MESSAGE,
          timestamp: Date.now()
        })
      }

      if (options.requireDiarization) {
        throw new Error('Diarization required but produced no segments')
      }

      return {
        success: false,
        diarization: {
          ...diarization,
          success: false,
          error: 'No speaker segments produced'
        },
        combined: [],
        blocked: true,
        blockReason: 'Diarization produced no speaker segments',
        failureMessage: DIARIZATION_FAILURE_MESSAGE
      }
    }

    if (diarization.numSpeakers === 0) {
      console.error('[ML Pipeline] BLOCKING: Diarization detected no speakers')
      console.error(`[ML Pipeline] ${DIARIZATION_FAILURE_MESSAGE}`)

      if (onProgress) {
        onProgress({
          jobId,
          phase: 'error',
          progress: 0,
          message: DIARIZATION_FAILURE_MESSAGE,
          timestamp: Date.now()
        })
      }

      if (options.requireDiarization) {
        throw new Error('Diarization required but detected no speakers')
      }

      return {
        success: false,
        diarization: {
          ...diarization,
          success: false,
          error: 'No speakers detected'
        },
        combined: [],
        blocked: true,
        blockReason: 'No speakers detected in audio',
        failureMessage: DIARIZATION_FAILURE_MESSAGE
      }
    }

    console.log(`[ML Pipeline] Diarization checkpoint passed: ${diarization.numSpeakers} speakers, ${diarization.segments.length} segments`)

    // Skip transcription if diarization-only mode
    if (options.diarizationOnly) {
      if (onProgress) {
        onProgress({
          jobId,
          phase: 'completed',
          progress: 100,
          message: 'Diarization completed (transcription skipped)',
          timestamp: Date.now()
        })
      }

      return {
        success: true,
        diarization,
        combined: [],
        blocked: false
      }
    }

    // Phase 2: Transcription (proceeds only after successful diarization)
    if (onProgress) {
      onProgress({
        jobId,
        phase: 'transcription',
        progress: 50,
        message: 'Diarization complete, starting transcription...',
        timestamp: Date.now()
      })
    }

    const transcription = await this.transcribe(
      audioPath,
      transcriptionConfig,
      onProgress ? (p) => {
        onProgress({
          ...p,
          jobId,
          progress: 50 + (p.progress * 0.4), // 50-90% for transcription
          message: `Transcription: ${p.message}`
        })
      } : undefined
    )

    if (!transcription.success) {
      // Transcription failure is not blocking - we still have diarization
      console.warn('[ML Pipeline] Transcription failed but diarization succeeded')

      if (onProgress) {
        onProgress({
          jobId,
          phase: 'completed',
          progress: 100,
          message: 'Diarization completed (transcription failed)',
          timestamp: Date.now()
        })
      }

      return {
        success: true, // Overall success because diarization worked
        diarization,
        transcription,
        combined: [],
        blocked: false
      }
    }

    // Phase 3: Combine results
    if (onProgress) {
      onProgress({
        jobId,
        phase: 'combining',
        progress: 92,
        message: 'Combining transcription with speaker labels...',
        timestamp: Date.now()
      })
    }

    const combined = this.combineResults(transcription.segments, diarization.segments)

    if (onProgress) {
      onProgress({
        jobId,
        phase: 'completed',
        progress: 100,
        message: 'Pipeline completed successfully',
        timestamp: Date.now()
      })
    }

    return {
      success: true,
      diarization,
      transcription,
      combined,
      blocked: false
    }
  },

  /**
   * Combine transcription segments with diarization segments
   * Assigns speakers to transcription segments based on weighted timing overlap
   * Uses overlap-based matching for better accuracy when segments span multiple speakers
   */
  combineResults(
    transcriptionSegments: TranscriptionSegment[],
    diarizationSegments: DiarizationSegment[]
  ): CombinedSegment[] {
    return transcriptionSegments.map(transSegment => {
      const speaker = this.findBestSpeakerForSegment(
        transSegment.start,
        transSegment.end,
        diarizationSegments
      )

      return {
        ...transSegment,
        speaker
      }
    })
  },

  /**
   * Find the best matching speaker for a time range using overlap-based matching.
   * This method calculates the overlap between the transcription segment and all
   * diarization segments, returning the speaker with the highest overlap.
   */
  findBestSpeakerForSegment(
    startTime: number,
    endTime: number,
    diarizationSegments: DiarizationSegment[]
  ): string | undefined {
    const duration = endTime - startTime

    // For zero or very short duration, use midpoint matching
    if (duration <= 0.1) {
      const midpoint = (startTime + endTime) / 2
      const segment = diarizationSegments.find(
        seg => seg.start <= midpoint && midpoint <= seg.end
      )
      return segment?.speaker
    }

    // Calculate overlap with each speaker
    const speakerOverlaps: Record<string, number> = {}

    for (const seg of diarizationSegments) {
      const overlapStart = Math.max(startTime, seg.start)
      const overlapEnd = Math.min(endTime, seg.end)
      const overlap = Math.max(0, overlapEnd - overlapStart)

      if (overlap > 0) {
        if (!speakerOverlaps[seg.speaker]) {
          speakerOverlaps[seg.speaker] = 0
        }
        speakerOverlaps[seg.speaker] += overlap
      }
    }

    // If no overlap found, try midpoint matching
    if (Object.keys(speakerOverlaps).length === 0) {
      const midpoint = (startTime + endTime) / 2

      // First try exact match
      const exactMatch = diarizationSegments.find(
        seg => seg.start <= midpoint && midpoint <= seg.end
      )
      if (exactMatch) {
        return exactMatch.speaker
      }

      // Try finding nearest speaker within 1 second
      let nearestSpeaker: string | undefined
      let nearestDistance = Infinity

      for (const seg of diarizationSegments) {
        const distance = Math.min(
          Math.abs(seg.start - midpoint),
          Math.abs(seg.end - midpoint)
        )
        if (distance < nearestDistance && distance <= 1.0) {
          nearestDistance = distance
          nearestSpeaker = seg.speaker
        }
      }

      return nearestSpeaker
    }

    // Return the speaker with the highest overlap
    let bestSpeaker: string | undefined
    let bestOverlap = 0

    for (const [speaker, overlap] of Object.entries(speakerOverlaps)) {
      if (overlap > bestOverlap) {
        bestOverlap = overlap
        bestSpeaker = speaker
      }
    }

    return bestSpeaker
  },

  /**
   * Cancel a running job
   */
  cancel(jobId: string): boolean {
    const job = activeJobs.get(jobId)
    if (!job) {
      return false
    }

    if (job.process && !job.process.killed) {
      job.status = 'cancelled'
      job.process.kill('SIGTERM')

      // Force kill after 5 seconds if still running
      setTimeout(() => {
        if (job.process && !job.process.killed) {
          job.process.kill('SIGKILL')
        }
      }, 5000)
    }

    job.endTime = Date.now()
    emitProgress(jobId, 'error', 0, 'Job cancelled')

    return true
  },

  /**
   * Get the current status of all jobs
   */
  getStatus(): PipelineStatus {
    const jobs = Array.from(activeJobs.values()).map(job => ({
      id: job.id,
      audioPath: job.audioPath,
      status: job.status,
      phase: job.phase,
      progress: job.progress,
      startTime: job.startTime,
      endTime: job.endTime,
      error: job.error
    }))

    return {
      activeJobs: jobs.filter(j => j.status === 'running' || j.status === 'pending').length,
      jobs
    }
  },

  /**
   * Subscribe to progress updates for all jobs
   */
  onProgress(callback: (progress: PipelineProgress) => void): () => void {
    progressEmitter.on(PROGRESS_EVENT, callback)
    return () => {
      progressEmitter.off(PROGRESS_EVENT, callback)
    }
  },

  /**
   * Check if Python and required dependencies are available.
   * The transcription system supports WhisperX (preferred) or faster-whisper (fallback).
   * This method checks both the transcription (WhisperX) and diarization (Pyannote) environments.
   */
  async checkDependencies(): Promise<{
    pythonAvailable: boolean
    pythonPath: string
    whisperxAvailable: boolean
    fasterWhisperAvailable: boolean
    pyannoteAvailable: boolean
    cudaAvailable: boolean
    transcriptionBackend: 'whisperx' | 'faster-whisper' | null
    errors: string[]
    /** Dual environment status (when using separate venvs) */
    dualEnvironment?: {
      whisperxPath: string
      pyannotePath: string
      whisperxReady: boolean
      pyannoteReady: boolean
    }
  }> {
    const errors: string[] = []
    let pythonAvailable = false
    let whisperxAvailable = false
    let fasterWhisperAvailable = false
    let pyannoteAvailable = false
    let cudaAvailable = false

    // Get paths for both environments
    const whisperxPath = findPythonPath('transcription')
    const pyannotePath = findPythonPath('diarization')
    const pythonPath = whisperxPath // Default to transcription path for general checks

    try {
      // Check Python version
      const versionOutput = execSync(`"${pythonPath}" --version 2>&1`, {
        encoding: 'utf8',
        timeout: 10000
      })
      console.log(`[ML Pipeline] Python version: ${versionOutput.trim()}`)
      pythonAvailable = true

      // Environment options to suppress warnings during dependency checks
      const execOptions = {
        encoding: 'utf8' as const,
        timeout: 30000,
        env: {
          ...process.env,
          // Suppress torchaudio deprecation warnings from pyannote.audio
          PYTHONWARNINGS: 'ignore::UserWarning,ignore::DeprecationWarning,ignore::FutureWarning'
        }
      }

      // Check whisperx (primary transcription backend)
      try {
        execSync(`"${pythonPath}" -c "import whisperx" 2>&1`, execOptions)
        whisperxAvailable = true
      } catch {
        // WhisperX not available, will try faster-whisper
      }

      // Check faster-whisper (fallback transcription backend)
      try {
        execSync(`"${pythonPath}" -c "from faster_whisper import WhisperModel" 2>&1`, execOptions)
        fasterWhisperAvailable = true
      } catch {
        // faster-whisper not available
      }

      // Report error if neither transcription backend is available
      if (!whisperxAvailable && !fasterWhisperAvailable) {
        errors.push('No transcription backend available. Install whisperx (preferred) or faster-whisper: pip install whisperx faster-whisper')
      }

      // Check pyannote using the diarization environment (venv-pyannote)
      // This environment uses torch 2.5.1 which is required for pyannote
      try {
        execSync(`"${pyannotePath}" -c "from pyannote.audio import Pipeline" 2>&1`, execOptions)
        pyannoteAvailable = true
      } catch {
        errors.push('pyannote.audio is not installed in diarization environment. Run: pip install pyannote.audio')
      }

      // Check CUDA availability
      try {
        const cudaCheck = execSync(`"${pythonPath}" -c "import torch; print(torch.cuda.is_available())" 2>&1`, execOptions)
        cudaAvailable = cudaCheck.trim().toLowerCase() === 'true'
      } catch {
        // CUDA check failed, assume not available
      }

    } catch (error) {
      errors.push(`Python not found or not working: ${error instanceof Error ? error.message : String(error)}`)
    }

    // Determine which transcription backend will be used
    const transcriptionBackend = whisperxAvailable ? 'whisperx' : (fasterWhisperAvailable ? 'faster-whisper' : null)

    // Build dual environment status if paths are different
    const isDualEnv = whisperxPath !== pyannotePath
    const dualEnvironment = isDualEnv ? {
      whisperxPath,
      pyannotePath,
      whisperxReady: whisperxAvailable || fasterWhisperAvailable,
      pyannoteReady: pyannoteAvailable
    } : undefined

    return {
      pythonAvailable,
      pythonPath,
      whisperxAvailable,
      fasterWhisperAvailable,
      pyannoteAvailable,
      cudaAvailable,
      transcriptionBackend,
      errors,
      dualEnvironment
    }
  },

  /**
   * Get available model sizes for transcription
   */
  getAvailableModels(): ModelSize[] {
    return ['tiny', 'base', 'small', 'medium', 'large-v2', 'large-v3']
  },

  /**
   * Get supported languages for transcription
   */
  getSupportedLanguages(): Record<string, string> {
    return {
      'en': 'English',
      'es': 'Spanish',
      'fr': 'French',
      'de': 'German',
      'it': 'Italian',
      'pt': 'Portuguese',
      'nl': 'Dutch',
      'pl': 'Polish',
      'ru': 'Russian',
      'ja': 'Japanese',
      'zh': 'Chinese',
      'ko': 'Korean',
      'ar': 'Arabic',
      'hi': 'Hindi'
    }
  }
}

// Export reset function for testing
export function resetMlPipelineState(): void {
  // Cancel all active jobs
  for (const job of activeJobs.values()) {
    if (job.process && !job.process.killed) {
      job.process.kill('SIGKILL')
    }
  }
  activeJobs.clear()
  progressEmitter.removeAllListeners()
}
