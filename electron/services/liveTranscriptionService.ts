/**
 * Live Transcription Service
 *
 * Handles real-time audio transcription during active recording sessions.
 * Uses a streaming approach where audio chunks are piped to a persistent
 * Python process for continuous transcription.
 */

import { EventEmitter } from 'events'
import { spawn, ChildProcess } from 'child_process'
import * as path from 'path'
import * as fs from 'fs'
import * as readline from 'readline'
import { audioRecorderService } from './audioRecorderService'
import { speakerService } from './speakerService'
import { temporalAlignmentService } from './temporalAlignmentService'
import { diarizationAwareTranscriptPipeline, NoDiarizationDataError } from './diarizationAwareTranscriptPipeline'
import type { MandatoryDiarizationSegment } from './diarizationOutputSchema'
import { settingsService } from './settingsService'
import { speakerNameDetectionService } from './speakerNameDetectionService'
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

export type LiveTranscriptionStatus =
  | 'idle'
  | 'starting'
  | 'active'
  | 'paused'
  | 'processing'
  | 'stopping'
  | 'error'

export interface LiveTranscriptionConfig {
  /** Language code for transcription */
  language?: string
  /** Model size (smaller = faster for live) */
  modelSize?: 'tiny' | 'base' | 'small'
  /** Device to use for inference */
  device?: 'cuda' | 'cpu' | 'auto'
  /** Sample rate of the audio */
  sampleRate?: number
  /** Number of audio channels */
  channels?: number
  /** Bit depth of audio */
  bitDepth?: number
  /** Chunk duration in seconds */
  chunkDuration?: number
  /** Disable Voice Activity Detection (useful for debugging) */
  disableVAD?: boolean
  /** Minimum confidence threshold (0.0-1.0) */
  confidenceThreshold?: number
  /** Enable transcription of system audio (computer output via virtual cable) */
  transcribeSystemAudio?: boolean
  /** Enable speaker diarization to identify different speakers */
  enableDiarization?: boolean
  /** Speaker similarity threshold (0.0-1.0, default: 0.30 - lower = more speakers detected) */
  diarizationThreshold?: number
  /** Maximum number of speakers to detect */
  maxSpeakers?: number
}

export interface LiveTranscriptSegment {
  /** Unique segment ID */
  id: string
  /** Transcribed text content */
  text: string
  /** Start time in seconds */
  start: number
  /** End time in seconds */
  end: number
  /** Confidence score (0.0-1.0) */
  confidence?: number
  /** Whether this is a final segment */
  is_final: boolean
  /** Speaker label from diarization (e.g., "Speaker_0") */
  speaker?: string
  /** Speaker ID (database foreign key) */
  speaker_id?: string | null
  /** Speaker confidence score from diarization (0.0-1.0) */
  speaker_confidence?: number
  /** True when speaker was assigned via fallback due to diarization error */
  speaker_fallback?: boolean
}

export interface TranscribeChunkResult {
  success: boolean
  segments: LiveTranscriptSegment[]
  error?: string
  metadata?: {
    audioFile: string
    modelSize: string
    language: string
    processingTimeMs: number
  }
}

export interface LiveTranscriptionProgress {
  status: LiveTranscriptionStatus
  progress: number
  message: string
  timestamp: number
}

export interface LiveTranscriptionState {
  status: LiveTranscriptionStatus
  meetingId: string | null
  audioPath: string | null
  lastProcessedOffset: number
  segmentCount: number
  startTime: number | null
  error?: string
}

// Diarization capability status
export interface DiarizationCapabilities {
  speaker_embeddings: boolean
  speaker_clustering: boolean
  speaker_change_detection: boolean
  transcription_only: boolean
  max_speakers?: number
  similarity_threshold?: number
  embedding_backend?: string
}

/**
 * Diarization health state for fault-tolerant error handling
 *
 * This tracks the health of the diarization pipeline and enables:
 * - Detection of repeated failures
 * - UI warning emissions when issues are detected
 * - Automatic recovery tracking
 *
 * Transcription continues uninterrupted even when diarization has issues,
 * with fallback speaker IDs assigned when needed.
 */
export interface DiarizationHealthState {
  /** Whether there's an active health warning */
  hasWarning: boolean
  /** Human-readable warning message */
  warningMessage: string | null
  /** Number of consecutive failures */
  consecutiveFailures: number
  /** Total number of failures since session start */
  totalFailures: number
  /** Classification of the last failure (e.g., 'serialization', 'embedding', 'clustering') */
  lastFailureReason: string | null
  /** Timestamp of the last failure in seconds */
  lastFailureTime: number | null
  /** Whether the issue is expected to recover automatically */
  isRecoverable: boolean
  /** Suggested action for the user */
  recommendation: string | null
}

// Message types from Python process
interface PythonMessage {
  type: 'ready' | 'status' | 'segment' | 'error' | 'complete' | 'speaker_segment' | 'speaker_change' | 'diarization_available' | 'diarization_unavailable' | 'diarization_health_warning' | 'diarization_health_recovery' | 'serialization_error'
  message?: string
  text?: string
  start?: number
  end?: number
  confidence?: number
  words?: any[]
  backend?: string
  model?: string
  device?: string
  code?: string
  total_seconds?: number
  buffered_seconds?: number
  // VAD and filtering status fields
  vad_enabled?: boolean
  silero_vad_available?: boolean
  confidence_threshold?: number
  has_voice?: boolean
  filtered?: boolean  // True when a segment was filtered out (hallucination or low confidence)
  // Speaker diarization fields
  speaker?: string
  speaker_confidence?: number
  speaker_fallback?: boolean  // True when speaker was assigned via fallback (diarization failed)
  diarization_enabled?: boolean
  diarization_threshold?: number
  max_speakers?: number
  // Speaker change event fields
  from_speaker?: string
  to_speaker?: string
  time?: number
  // Diarization capability disclosure fields
  reason?: string
  details?: string
  capabilities?: DiarizationCapabilities
  // Diarization health monitoring fields
  consecutive_failures?: number
  total_failures?: number
  last_failure_reason?: string
  last_failure_time?: number
  is_recoverable?: boolean
  recommendation?: string
  total_segments_processed?: number
  previous_failures?: number
  // Serialization error fields
  error?: string
  original_type?: string
}

// ============================================================================
// Constants
// ============================================================================

const LIVE_TRANSCRIPTION_EVENT = 'live-transcription:update'
const SEGMENT_EVENT = 'live-transcription:segment'
const DIARIZATION_STATUS_EVENT = 'live-transcription:diarization-status'
const DIARIZATION_HEALTH_EVENT = 'live-transcription:diarization-health'
const DEFAULT_MODEL_SIZE = 'base' // Smaller model for faster live processing
const DEFAULT_CHUNK_DURATION = 5.0 // 5 seconds

// ============================================================================
// Service State
// ============================================================================

const progressEmitter = new EventEmitter()

let currentState: LiveTranscriptionState = {
  status: 'idle',
  meetingId: null,
  audioPath: null,
  lastProcessedOffset: 0,
  segmentCount: 0,
  startTime: null,
}

let streamingProcess: ChildProcess | null = null
let audioChunkUnsubscribe: (() => void) | null = null
let systemAudioChunkUnsubscribe: (() => void) | null = null  // For system audio subscription
let segmentIdCounter = 0
let isModelReady = false

// Diarization status tracking
let diarizationCapabilities: DiarizationCapabilities | null = null
let diarizationAvailable = false
let diarizationUnavailableReason: string | null = null

// Diarization health tracking - monitors for repeated failures and emits warnings
// Note: DiarizationHealthState interface is exported above for use by consumers

let diarizationHealthState: DiarizationHealthState = {
  hasWarning: false,
  warningMessage: null,
  consecutiveFailures: 0,
  totalFailures: 0,
  lastFailureReason: null,
  lastFailureTime: null,
  isRecoverable: true,
  recommendation: null
}

// Speaker auto-registration cache: meetingId -> (speakerLabel -> speakerId)
const speakerMappingCache = new Map<string, Map<string, string>>()

// Deferred start state - we wait for the first audio chunk to know the actual sample rate
let pendingConfig: LiveTranscriptionConfig | null = null
let audioChunkBuffer: Buffer[] = []
let detectedSampleRate: number | null = null
let pythonStartPromiseResolve: ((result: { success: boolean; error?: string }) => void) | null = null

// Track the recording start time and buffered audio duration for timestamp synchronization
// This is CRITICAL for fixing the 35-second audio repetition bug:
// When audio is buffered while the Python model loads, we need to track how much audio
// was buffered so that diarization timestamps can be properly offset
let recordingStartTime: number | null = null  // Timestamp when recording started
let totalBufferedDurationSeconds: number = 0  // How much audio was buffered during model load

// Audio diagnostics tracking
let audioChunksReceived = 0
let audioChunksToPython = 0
let totalAudioBytesReceived = 0
let totalAudioBytesToPython = 0
let lastAudioChunkTime = 0
let audioHealthWarningEmitted = false

// System audio diagnostics tracking (separate from microphone)
let systemAudioChunksReceived = 0
let systemAudioChunksToPython = 0
let totalSystemAudioBytesReceived = 0
let totalSystemAudioBytesToPython = 0

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Log audio diagnostics for debugging
 */
function logAudioDiagnostics(context: string): void {
  const now = Date.now()
  const timeSinceLastChunk = lastAudioChunkTime > 0 ? now - lastAudioChunkTime : -1

  console.log(`[Live Transcription] Audio Diagnostics (${context}):
    Chunks received: ${audioChunksReceived}
    Chunks to Python: ${audioChunksToPython}
    Bytes received: ${(totalAudioBytesReceived / 1024).toFixed(1)} KB
    Bytes to Python: ${(totalAudioBytesToPython / 1024).toFixed(1)} KB
    Time since last chunk: ${timeSinceLastChunk}ms
    Buffer size: ${audioChunkBuffer.length} chunks
    Python ready: ${isModelReady}
    Status: ${currentState.status}`)
}

/**
 * Reset audio diagnostics counters
 */
function resetAudioDiagnostics(): void {
  // Reset microphone audio diagnostics
  audioChunksReceived = 0
  audioChunksToPython = 0
  totalAudioBytesReceived = 0
  totalAudioBytesToPython = 0
  lastAudioChunkTime = 0
  audioHealthWarningEmitted = false
  // Reset system audio diagnostics
  systemAudioChunksReceived = 0
  systemAudioChunksToPython = 0
  totalSystemAudioBytesReceived = 0
  totalSystemAudioBytesToPython = 0
  // Reset timestamp tracking for buffer synchronization
  recordingStartTime = null
  totalBufferedDurationSeconds = 0
}

/**
 * Get or create a speaker from a diarization label
 * Format label: "Speaker_0" -> "Speaker 1" (1-indexed for user display)
 */
function getOrCreateSpeaker(label: string, meetingId: string): string | null {
  try {
    // Get or create meeting-specific speaker mapping
    if (!speakerMappingCache.has(meetingId)) {
      speakerMappingCache.set(meetingId, new Map())
    }

    const meetingSpeakers = speakerMappingCache.get(meetingId)!

    // Check cache first
    if (meetingSpeakers.has(label)) {
      return meetingSpeakers.get(label)!
    }

    // Format label for display: "Speaker_0" -> "Speaker 1"
    const match = label.match(/Speaker_(\d+)/)
    const displayName = match
      ? `Speaker ${parseInt(match[1]) + 1}` // Convert 0-indexed to 1-indexed
      : label

    // Create or get speaker using speakerService
    const speaker = speakerService.getOrCreate(displayName)

    // Cache the mapping
    meetingSpeakers.set(label, speaker.id)

    console.log(`[Live Transcription] Speaker registered: ${label} -> ${displayName} (ID: ${speaker.id})`)

    return speaker.id
  } catch (error) {
    console.error(`[Live Transcription] Error creating speaker for label "${label}":`, error)
    return null
  }
}

/**
 * Clear speaker mappings for a meeting
 */
function clearSpeakerMappings(meetingId: string): void {
  speakerMappingCache.delete(meetingId)
  console.log(`[Live Transcription] Cleared speaker mappings for meeting ${meetingId}`)
}

/**
 * Get the path to the Python scripts directory
 */
function getPythonScriptsDir(): string {
  if (app?.isPackaged) {
    return path.join(process.resourcesPath || '', 'python')
  }
  // In development, __dirname is dist-electron/, so we go up one level to find python/
  return path.join(__dirname, '../python')
}

/**
 * Find the Python executable path for transcription (WhisperX)
 * Uses the dual environment system when available:
 * - venv-whisperx: Python 3.12 + WhisperX + torch 2.5.0 (for transcription)
 * Supports multiple virtual environment directories as fallback
 */
function findPythonPath(): string {
  const scriptsDir = getPythonScriptsDir()

  // Use the centralized pythonEnvironment service for purpose-specific path
  // This ensures we use the WhisperX environment for transcription
  const whisperxPath = pythonEnvironment.getPythonPathForPurpose('whisperx')
  if (whisperxPath) {
    console.log('[Live Transcription] Using WhisperX Python path:', whisperxPath)

    // Verify it's executable (Unix only)
    if (process.platform !== 'win32' && !whisperxPath.includes('transcription_bundle')) {
      try {
        fs.accessSync(whisperxPath, fs.constants.X_OK)
      } catch {
        console.warn('[Live Transcription] Python executable may not be executable - attempting chmod')
        try {
          fs.chmodSync(whisperxPath, 0o755)
          console.log('[Live Transcription] Successfully set executable permissions')
        } catch (e) {
          console.error('[Live Transcription] Failed to set executable permissions:', e)
        }
      }
    }

    return whisperxPath
  }

  // Fallback: Check for bundled Python executable (highest priority for packaged apps)
  if (app?.isPackaged) {
    const bundledExecutable = process.platform === 'win32'
      ? path.join(scriptsDir, 'transcription_bundle.exe')
      : path.join(scriptsDir, 'transcription_bundle')

    console.log('[Live Transcription] Packaged app mode - checking for bundled executable')
    console.log('[Live Transcription] Scripts directory:', scriptsDir)
    console.log('[Live Transcription] Resources path:', process.resourcesPath)
    console.log('[Live Transcription] Expected bundled executable:', bundledExecutable)

    if (fs.existsSync(bundledExecutable)) {
      console.log('[Live Transcription] Using bundled Python executable:', bundledExecutable)
      // Verify it's executable (Unix only)
      if (process.platform !== 'win32') {
        try {
          fs.accessSync(bundledExecutable, fs.constants.X_OK)
          console.log('[Live Transcription] Bundled executable is executable')
        } catch {
          console.warn('[Live Transcription] Bundled executable may not be executable - attempting chmod')
          try {
            fs.chmodSync(bundledExecutable, 0o755)
            console.log('[Live Transcription] Successfully set executable permissions')
          } catch (e) {
            console.error('[Live Transcription] Failed to set executable permissions:', e)
          }
        }
      }
      return bundledExecutable
    } else {
      console.warn('[Live Transcription] Bundled Python executable not found at:', bundledExecutable)
      // List contents of scriptsDir to help debug
      try {
        const files = fs.readdirSync(scriptsDir)
        console.log('[Live Transcription] Contents of scripts directory:', files.join(', '))
      } catch (e) {
        console.error('[Live Transcription] Could not read scripts directory:', e)
      }
    }
  }

  // Fallback: List of virtual environment directories to check, in order of preference
  // venv-whisperx is preferred for WhisperX with torch 2.5.0
  // venv-3.12 and venv are legacy fallbacks
  const venvDirs = ['venv-whisperx', 'venv-3.12', 'venv']

  // Check for virtual environments in order of preference
  for (const venvName of venvDirs) {
    const venvPath = path.join(scriptsDir, venvName)
    const venvPython = process.platform === 'win32'
      ? path.join(venvPath, 'Scripts', 'python.exe')
      : path.join(venvPath, 'bin', 'python')

    if (fs.existsSync(venvPython)) {
      console.log(`[Live Transcription] Using virtual environment: ${venvName}`)
      return venvPython
    }
  }

  if (process.env.PYTHON_PATH && fs.existsSync(process.env.PYTHON_PATH)) {
    return process.env.PYTHON_PATH
  }

  return process.platform === 'win32' ? 'python' : 'python3'
}

/**
 * Emit a progress update
 */
function emitProgress(
  status: LiveTranscriptionStatus,
  progress: number,
  message: string
): void {
  const payload: LiveTranscriptionProgress = {
    status,
    progress: Math.min(100, Math.max(0, progress)),
    message,
    timestamp: Date.now(),
  }
  progressEmitter.emit(LIVE_TRANSCRIPTION_EVENT, payload)
}

/**
 * Emit a new segment
 */
function emitSegment(segment: LiveTranscriptSegment): void {
  progressEmitter.emit(SEGMENT_EVENT, segment)

  // Analyze segment for speaker name detection
  if (currentState.meetingId && segment.speaker_id && segment.text) {
    const timestampMs = Math.round(segment.start * 1000)
    try {
      // Run analysis asynchronously - don't block the main flow
      speakerNameDetectionService.analyzeTranscript(
        currentState.meetingId,
        segment.speaker_id,
        segment.text,
        timestampMs,
        segment.id
      )
    } catch (err) {
      // Log but don't fail - name detection is best-effort
      console.warn('[Live Transcription] Speaker name detection error:', err)
    }
  }
}

/**
 * Update the current state
 */
function updateState(updates: Partial<LiveTranscriptionState>): void {
  currentState = { ...currentState, ...updates }
}

/**
 * Generate a unique segment ID
 */
function generateSegmentId(): string {
  return `live-seg-${Date.now()}-${segmentIdCounter++}`
}

/**
 * Start the Python streaming process with the given sample rate
 * This is called when the first audio chunk arrives and we know the actual sample rate
 */
async function startPythonProcess(actualSampleRate: number): Promise<{ success: boolean; error?: string }> {
  if (!pendingConfig) {
    return { success: false, error: 'No pending configuration' }
  }

  const config = pendingConfig
  const pythonPath = findPythonPath()
  const scriptPath = path.join(getPythonScriptsDir(), 'stream_transcribe.py')

  // Check if we're using the bundled executable (transcription_bundle)
  // In packaged mode, the executable is self-contained and doesn't need script path
  const isBundledExecutable = pythonPath.includes('transcription_bundle')

  console.log('[Live Transcription] Starting Python with detected sample rate:', actualSampleRate)
  console.log('[Live Transcription] Using bundled executable:', isBundledExecutable)

  // Only check for script file if NOT using bundled executable
  if (!isBundledExecutable && !fs.existsSync(scriptPath)) {
    console.log('[Live Transcription] Streaming script not found, using file-based approach')
    updateState({ status: 'active' })
    emitProgress('active', 0, 'Live transcription active (file-based mode)')
    return { success: true }
  }

  const modelSize = config.modelSize || DEFAULT_MODEL_SIZE
  const language = config.language || 'en'
  const channels = config.channels || 1
  const bitDepth = config.bitDepth || 16
  const chunkDuration = config.chunkDuration || DEFAULT_CHUNK_DURATION
  const disableVAD = config.disableVAD || false
  const confidenceThreshold = config.confidenceThreshold ?? 0.3 // Default to 0.3
  // Default to true to enable speaker diarization by default
  const enableDiarization = config.enableDiarization !== false
  // Lower threshold = more speakers detected (more sensitive to voice differences)
  // FIXED: Lowered from 0.5 to 0.30 for better multi-speaker detection during live recording
  // This matches the streaming diarization service threshold and ensures consistent
  // speaker detection across both services (typical same-speaker: 0.8-0.95, different: 0.2-0.5)
  const diarizationThreshold = config.diarizationThreshold ?? 0.30
  const maxSpeakers = config.maxSpeakers ?? 10

  // Calculate the buffered audio duration for proper timestamp offset
  // This fixes the 35-second audio repetition bug by ensuring diarization
  // timestamps are correctly offset when buffered audio is flushed
  const bufferedBytes = audioChunkBuffer.reduce((sum, buf) => sum + buf.length, 0)
  const bytesPerSample = bitDepth / 8
  const bytesPerFrame = bytesPerSample * channels
  const bufferedDurationSecs = bufferedBytes / (actualSampleRate * bytesPerFrame)

  // Store for later reference
  totalBufferedDurationSeconds = bufferedDurationSecs

  console.log(`[Live Transcription] Buffered audio duration: ${bufferedDurationSecs.toFixed(2)}s (${bufferedBytes} bytes)`)

  // Build arguments array
  // For bundled executable: subcommand 'stream' + arguments
  // For Python interpreter: script path + arguments
  const args: string[] = []

  if (isBundledExecutable) {
    // Bundled executable uses subcommand dispatch
    // 'stream' maps to stream_transcribe.py internally
    args.push('stream')
    console.log('[Live Transcription] Using bundled executable with "stream" subcommand')
  } else {
    // Python interpreter needs the script path
    args.push(scriptPath)
  }

  args.push(
    '--model', modelSize,
    '--language', language,
    '--sample-rate', String(actualSampleRate), // Use the detected sample rate!
    '--channels', String(channels),
    '--bit-depth', String(bitDepth),
    '--chunk-duration', String(chunkDuration),
    '--confidence-threshold', String(confidenceThreshold)
  )

  // CRITICAL: Pass the initial time offset to Python
  // This ensures that when buffered audio is flushed all at once,
  // the diarization and transcription timestamps are calculated from
  // the correct starting point (t=0), not from when Python finished loading
  // Note: The offset is 0 because we're sending the BUFFERED audio from the start
  // Python will correctly process this audio from t=0
  args.push('--initial-time-offset', '0')

  // Add --no-vad flag if VAD is disabled
  if (disableVAD) {
    args.push('--no-vad')
    console.log('[Live Transcription] VAD disabled for debugging')
  } else {
    // Use permissive VAD for dual-source recording (mixed mic + system audio)
    // This uses lower VAD thresholds because:
    // 1. System audio from virtual cables has different acoustic characteristics
    // 2. Remote participants' voices may have different signal levels
    // 3. Pre-processed/compressed audio may not trigger standard VAD thresholds
    args.push('--permissive-vad')
    console.log('[Live Transcription] Permissive VAD enabled for mixed audio transcription')
  }

  // Add speaker diarization arguments if enabled
  if (enableDiarization) {
    args.push('--diarization')
    args.push('--diarization-threshold', String(diarizationThreshold))
    args.push('--max-speakers', String(maxSpeakers))
    console.log(`[Live Transcription] Speaker diarization enabled (threshold: ${diarizationThreshold}, max speakers: ${maxSpeakers})`)
  }

  console.log('[Live Transcription] Starting Python process:', pythonPath, args.join(' '))

  // Get HF_TOKEN from settings (for pyannote speaker diarization)
  let hfToken = settingsService.get<string>('transcription.hfToken') || ''
  const hfTokenSource = hfToken ? 'settings' : null
  // Also check environment variable as fallback
  if (!hfToken && process.env.HF_TOKEN) {
    hfToken = process.env.HF_TOKEN
  }
  const finalHfTokenSource = hfToken
    ? (hfTokenSource || 'environment')
    : 'none'
  console.log(`[Live Transcription] HF_TOKEN source: ${finalHfTokenSource}, configured: ${!!hfToken}`)

  streamingProcess = spawn(pythonPath, args, {
    stdio: ['pipe', 'pipe', 'pipe'],
    env: {
      ...process.env,
      PYTHONUNBUFFERED: '1',
      TORCH_FORCE_NO_WEIGHTS_ONLY_LOAD: '1',
      // Suppress torchaudio deprecation warnings from pyannote.audio
      PYTHONWARNINGS: 'ignore::UserWarning,ignore::DeprecationWarning,ignore::FutureWarning',
      // Pass HF_TOKEN for pyannote speaker diarization model authentication
      ...(hfToken ? { HF_TOKEN: hfToken } : {}),
    },
  })

  // Set up readline for stdout to read JSON lines
  const rl = readline.createInterface({
    input: streamingProcess.stdout!,
    crlfDelay: Infinity
  })

  rl.on('line', (line) => {
    try {
      const message: PythonMessage = JSON.parse(line)
      handlePythonMessage(message)
    } catch (e) {
      if (line.trim()) {
        console.log('[Live Transcription] Python output:', line.substring(0, 200))
      }
    }
  })

  streamingProcess.stderr?.on('data', (data: Buffer) => {
    const text = data.toString().trim()
    if (text) {
      // Categorize and format Python stderr output for better debugging
      if (text.includes('[WHISPER DEBUG]')) {
        console.log('🔍 [Whisper Debug]', text.replace('[WHISPER DEBUG]', '').trim())
      } else if (text.includes('[WHISPER OUTPUT]')) {
        console.log('✅ [Whisper Output]', text.replace('[WHISPER OUTPUT]', '').trim())
      } else if (text.includes('[FILTER]')) {
        console.log('🔴 [Filter]', text.replace('[FILTER]', '').trim())
      } else if (text.includes('[VAD]')) {
        console.log('🎤 [VAD]', text.replace('[VAD]', '').trim())
      } else {
        // Other Python stderr (warnings, errors, etc.)
        console.log('[Live Transcription] Python:', text)
      }
    }
  })

  streamingProcess.on('exit', (code, signal) => {
    console.log('[Live Transcription] Python process exited with code:', code, 'signal:', signal)
    if (currentState.status !== 'idle' && currentState.status !== 'stopping') {
      // Provide more helpful error messages based on exit code
      let errorMessage = `Process exited unexpectedly with code ${code}`
      let progressMessage = 'Transcription process stopped unexpectedly'

      // Check if there's already a more specific error message from Python (NO_BACKEND, etc.)
      // If currentState.error is already set with a specific message, use that instead
      if (currentState.error && currentState.error.includes('No transcription backend')) {
        errorMessage = currentState.error
        progressMessage = 'Transcription backend not available - rebuild the app with npm run bundle:python'
      } else if (code === null && signal) {
        // Process was killed by a signal (e.g., SIGSEGV, SIGKILL)
        // This often happens when the Python bundle is incomplete or corrupted
        const isPackaged = app?.isPackaged
        if (isPackaged) {
          errorMessage = `Transcription service crashed (signal ${signal}). The Python bundle may be incomplete or corrupted. Try rebuilding the app with 'npm run dist:bundled'.`
          progressMessage = `Transcription crashed (${signal}) - try rebuilding the application`
        } else {
          errorMessage = `Transcription service crashed (signal ${signal}). Check the Python environment and dependencies.`
          progressMessage = `Transcription crashed (${signal}) - check Python setup`
        }
      } else if (code === 139) {
        // Exit code 139 = 128 + 11 = SIGSEGV (segmentation fault)
        const isPackaged = app?.isPackaged
        if (isPackaged) {
          errorMessage = 'Transcription service crashed with a segmentation fault. The Python bundle may be missing required modules (whisperx/faster_whisper). Rebuild with: npm run bundle:python && npm run dist'
          progressMessage = 'Transcription crashed - Python bundle needs to be rebuilt'
        } else {
          errorMessage = 'Transcription service crashed with a segmentation fault. Check that all Python dependencies are properly installed.'
          progressMessage = 'Transcription crashed - check Python dependencies'
        }
      } else if (code === 1) {
        // Code 1 often indicates missing dependencies or configuration issues
        const isPackaged = app?.isPackaged
        if (isPackaged) {
          errorMessage = `Transcription service failed to start (code ${code}). This may be due to missing configuration. Please ensure HF_TOKEN is set in Settings > Audio for speaker diarization, or check the app logs for details.`
          progressMessage = 'Transcription failed to start - check Settings > Audio for HF_TOKEN configuration'
        } else {
          errorMessage = `Transcription service failed to start (code ${code}). Check that the Python environment is properly configured and all dependencies are installed.`
          progressMessage = 'Transcription failed to start - check Python environment setup'
        }
      }

      updateState({ status: 'error', error: errorMessage })
      emitProgress('error', 0, progressMessage)
    }
    streamingProcess = null
    isModelReady = false
  })

  streamingProcess.on('error', (err) => {
    console.error('[Live Transcription] Process error:', err)
    updateState({ status: 'error', error: err.message })
    emitProgress('error', 0, `Process error: ${err.message}`)
    streamingProcess = null
    isModelReady = false
  })

  // Wait for the 'ready' message from Python (with timeout)
  return new Promise((resolve) => {
    const timeout = setTimeout(() => {
      if (!isModelReady) {
        console.log('[Live Transcription] Timeout waiting for ready signal, continuing anyway')
        updateState({ status: 'active' })
        emitProgress('active', 0, 'Live transcription active')

        // Flush any buffered audio chunks
        if (streamingProcess?.stdin) {
          const bufferedCount = audioChunkBuffer.length
          const bufferedBytes = audioChunkBuffer.reduce((sum, buf) => sum + buf.length, 0)
          console.log(`[Live Transcription] (timeout) Flushing ${bufferedCount} buffered audio chunks (${(bufferedBytes / 1024).toFixed(1)} KB)`)
          let flushedCount = 0
          for (const chunk of audioChunkBuffer) {
            try {
              streamingProcess.stdin.write(chunk)
              flushedCount++
              audioChunksToPython++
              totalAudioBytesToPython += chunk.length
            } catch (e) {
              console.error('[Live Transcription] Error writing buffered chunk:', e)
            }
          }
          console.log(`[Live Transcription] (timeout) Successfully flushed ${flushedCount}/${bufferedCount} chunks`)
          audioChunkBuffer = []
        }

        resolve({ success: true })
      }
    }, 120000) // 2 minute timeout for model loading

    const checkInterval = setInterval(() => {
      if (isModelReady) {
        clearTimeout(timeout)
        clearInterval(checkInterval)

        // Flush any buffered audio chunks BEFORE updating state to 'active'
        // This is CRITICAL to fix the 35-second audio repetition bug:
        // - While state is 'starting', new audio chunks are still buffered
        // - We flush all buffered audio in order
        // - THEN we set state to 'active' so new chunks go directly to Python
        // - This ensures no audio is lost and no chunks are sent out of order
        if (streamingProcess?.stdin) {
          const bufferedCount = audioChunkBuffer.length
          const bufferedBytes = audioChunkBuffer.reduce((sum, buf) => sum + buf.length, 0)
          console.log(`[Live Transcription] Flushing ${bufferedCount} buffered audio chunks (${(bufferedBytes / 1024).toFixed(1)} KB)`)
          let flushedCount = 0
          for (const chunk of audioChunkBuffer) {
            try {
              streamingProcess.stdin.write(chunk)
              flushedCount++
              audioChunksToPython++
              totalAudioBytesToPython += chunk.length
            } catch (e) {
              console.error('[Live Transcription] Error writing buffered chunk:', e)
            }
          }
          console.log(`[Live Transcription] Successfully flushed ${flushedCount}/${bufferedCount} chunks (${totalBufferedDurationSeconds.toFixed(2)}s of audio)`)
          audioChunkBuffer = []
        }

        // NOW update state to 'active' - after buffer is fully flushed
        // This prevents new chunks from being written before the buffer is empty
        updateState({ status: 'active' })
        emitProgress('active', 0, 'Transcription ready - buffer flushed')
        console.log(`[Live Transcription] State changed to active - ready for live streaming`)

        resolve({ success: true })
      }
      if (currentState.status === 'error') {
        clearTimeout(timeout)
        clearInterval(checkInterval)
        resolve({ success: false, error: currentState.error })
      }
    }, 100)
  })
}

/**
 * Handle messages from the Python process
 */
function handlePythonMessage(message: PythonMessage): void {
  // Log message type (but avoid excessive logging for frequent status updates)
  if (message.type !== 'status' || !message.filtered) {
    console.log('[Live Transcription] Python message:', message.type)
  }

  switch (message.type) {
    case 'ready':
      // IMPORTANT: Set isModelReady to true FIRST, but DON'T update state to 'active' yet
      // The state update should happen AFTER the buffer is flushed in startPythonProcess
      // This prevents a race condition where new chunks bypass the buffer while it's being flushed
      //
      // The checkInterval in startPythonProcess will:
      // 1. See isModelReady is true
      // 2. Flush the buffered audio chunks
      // 3. Resolve the promise, which then updates state to 'active'
      //
      // This fixes the 35-second audio repetition bug by ensuring all buffered audio
      // is sent to Python before new live audio is added
      isModelReady = true
      // NOTE: State update moved to after buffer flush - see startPythonProcess

      // Log VAD and filtering configuration
      const vadStatus = message.vad_enabled
        ? (message.silero_vad_available ? 'Silero VAD' : 'Energy-based VAD')
        : 'disabled'
      const confidenceThreshold = message.confidence_threshold ?? 0.4

      console.log(`[Live Transcription] Model loaded - waiting for buffer flush before going active`)
      console.log(`[Live Transcription] VAD: ${vadStatus}, Confidence threshold: ${confidenceThreshold}`)

      // Don't emit progress here - it will be emitted after buffer flush
      break

    case 'status':
      // Handle filtered segment notifications (hallucination/low confidence filtering)
      if (message.filtered) {
        // Don't spam logs for filtered segments, but note they're being filtered
        console.log(`[Live Transcription] Filtered: ${message.message}`)
        return  // Don't emit progress for filtered notifications
      }

      // Handle VAD skip notifications
      if (message.has_voice === false) {
        // Chunk was skipped due to no voice activity - don't spam logs
        return
      }

      const bufferedSecs = message.buffered_seconds || 0
      emitProgress(
        currentState.status,
        Math.min(100, (bufferedSecs / 5) * 100),
        message.message || 'Processing...'
      )
      break

    case 'segment':
      if (message.text && message.text.trim()) {
        // Auto-register speaker if diarization label is present
        // NOTE: Segments are ALWAYS emitted even when diarization fails
        // If speaker_fallback is true, the speaker field contains a fallback ID
        let speakerId: string | null = null
        if (message.speaker && currentState.meetingId) {
          speakerId = getOrCreateSpeaker(message.speaker, currentState.meetingId)
        }

        const segment: LiveTranscriptSegment = {
          id: generateSegmentId(),
          text: message.text.trim(),
          start: message.start || 0,
          end: message.end || 0,
          confidence: message.confidence,
          is_final: true,
          speaker: message.speaker, // Keep original label for debugging
          speaker_id: speakerId, // Database foreign key
          speaker_confidence: message.speaker_confidence, // Diarization confidence
          speaker_fallback: message.speaker_fallback, // True if diarization failed for this segment
        }
        updateState({ segmentCount: currentState.segmentCount + 1 })
        emitSegment(segment)
        // Console log to verify Whisper transcription output
        console.log(`[WHISPER TRANSCRIPTION] Received from Whisper:`)
        console.log(`  Text: "${segment.text}"`)
        console.log(`  Time: ${segment.start.toFixed(2)}s - ${segment.end.toFixed(2)}s`)
        console.log(`  Confidence: ${segment.confidence !== undefined ? segment.confidence.toFixed(2) : 'N/A'}`)
        if (segment.speaker) {
          const fallbackLabel = segment.speaker_fallback ? ' (FALLBACK)' : ''
          console.log(`  Speaker: ${segment.speaker} (ID: ${segment.speaker_id || 'none'})${fallbackLabel}`)
        }
        console.log(`  Segment ID: ${segment.id}`)
      }
      break

    case 'speaker_segment':
      // Handle standalone speaker segment updates from diarization
      console.log(`[Live Transcription] Speaker segment: ${message.speaker} (${message.start?.toFixed(2)}s - ${message.end?.toFixed(2)}s)`)
      break

    case 'speaker_change':
      // Handle speaker change events
      console.log(`[Live Transcription] Speaker change: ${message.from_speaker || 'None'} -> ${message.to_speaker} at ${message.time?.toFixed(2)}s`)

      // Check for temporal correlation with recent name mentions
      if (currentState.meetingId && message.to_speaker) {
        const newSpeakerId = getOrCreateSpeaker(message.to_speaker, currentState.meetingId)
        if (newSpeakerId) {
          const speakerChangeTimestampMs = Math.round((message.time || 0) * 1000)
          try {
            speakerNameDetectionService.checkTemporalCorrelation(
              currentState.meetingId,
              newSpeakerId,
              speakerChangeTimestampMs
            )
          } catch (err) {
            console.warn('[Live Transcription] Speaker name temporal correlation error:', err)
          }
        }
      }
      break

    case 'diarization_available':
      // Speaker diarization is available with full capabilities
      diarizationAvailable = true
      diarizationCapabilities = message.capabilities || null
      diarizationUnavailableReason = null
      console.log(`[Live Transcription] Speaker diarization available: ${message.capabilities?.embedding_backend || 'unknown'} backend`)
      progressEmitter.emit(DIARIZATION_STATUS_EVENT, {
        available: true,
        capabilities: message.capabilities,
        message: message.message
      })
      break

    case 'diarization_unavailable':
      // MANDATORY DISCLOSURE: Speaker diarization is NOT available
      // This means transcription-only mode - no speaker identification
      diarizationAvailable = false
      diarizationCapabilities = message.capabilities || null
      diarizationUnavailableReason = message.reason || 'unknown'
      console.warn(`[Live Transcription] DIARIZATION UNAVAILABLE: ${message.message}`)
      console.warn(`[Live Transcription] Reason: ${message.reason} - ${message.details}`)
      console.warn('[Live Transcription] Operating in transcription-only mode - no speaker separation available')

      // Generate more helpful warning message based on reason
      let warningMessage = message.message || 'Speaker diarization is not available'
      if (message.reason === 'authentication_required') {
        warningMessage = 'Speaker diarization requires Hugging Face authentication. Please set up HF_TOKEN (see Settings > Audio for details).'
      } else if (message.reason === 'model_load_failed') {
        warningMessage = 'Speaker diarization model failed to load. Check HF_TOKEN and model license acceptance.'
      } else if (message.reason === 'no_embedding_backend') {
        warningMessage = 'Speaker diarization requires pyannote.audio or speechbrain. Install dependencies and restart.'
      }

      progressEmitter.emit(DIARIZATION_STATUS_EVENT, {
        available: false,
        reason: message.reason,
        details: message.details,
        message: warningMessage,
        capabilities: message.capabilities
      })
      // Also emit a warning through the progress event
      emitProgress(currentState.status, 0, `Warning: ${warningMessage}`)
      break

    case 'diarization_health_warning':
      // FAULT-TOLERANT: Diarization is experiencing issues but transcription continues
      // Update health state
      diarizationHealthState = {
        hasWarning: true,
        warningMessage: message.message || 'Speaker identification experiencing issues',
        consecutiveFailures: message.consecutive_failures || 0,
        totalFailures: message.total_failures || 0,
        lastFailureReason: message.last_failure_reason || null,
        lastFailureTime: message.last_failure_time || null,
        isRecoverable: message.is_recoverable !== false,
        recommendation: message.recommendation || null
      }

      console.warn(`[Live Transcription] DIARIZATION HEALTH WARNING: ${diarizationHealthState.warningMessage}`)
      console.warn(`[Live Transcription] Consecutive failures: ${diarizationHealthState.consecutiveFailures}, ` +
                   `Total: ${diarizationHealthState.totalFailures}`)
      if (diarizationHealthState.recommendation) {
        console.warn(`[Live Transcription] Recommendation: ${diarizationHealthState.recommendation}`)
      }

      // Emit health warning event for UI
      progressEmitter.emit(DIARIZATION_HEALTH_EVENT, {
        type: 'warning',
        hasWarning: true,
        message: diarizationHealthState.warningMessage,
        consecutiveFailures: diarizationHealthState.consecutiveFailures,
        totalFailures: diarizationHealthState.totalFailures,
        lastFailureReason: diarizationHealthState.lastFailureReason,
        isRecoverable: diarizationHealthState.isRecoverable,
        recommendation: diarizationHealthState.recommendation
      })

      // Also emit as progress for backward compatibility
      emitProgress(
        currentState.status,
        0,
        `Warning: ${diarizationHealthState.warningMessage}`
      )
      break

    case 'diarization_health_recovery':
      // FAULT-TOLERANT: Diarization has recovered from issues
      const previousWarningState = diarizationHealthState.hasWarning

      diarizationHealthState = {
        hasWarning: false,
        warningMessage: null,
        consecutiveFailures: 0,
        totalFailures: message.previous_failures || diarizationHealthState.totalFailures,
        lastFailureReason: null,
        lastFailureTime: null,
        isRecoverable: true,
        recommendation: null
      }

      if (previousWarningState) {
        console.log(`[Live Transcription] DIARIZATION HEALTH RECOVERED: ${message.message}`)
        console.log(`[Live Transcription] Total segments processed: ${message.total_segments_processed || 'unknown'}`)

        // Emit recovery event for UI
        progressEmitter.emit(DIARIZATION_HEALTH_EVENT, {
          type: 'recovery',
          hasWarning: false,
          message: message.message || 'Speaker identification has recovered',
          totalSegmentsProcessed: message.total_segments_processed,
          previousFailures: message.previous_failures
        })

        // Emit success status
        emitProgress(
          currentState.status,
          0,
          message.message || 'Speaker identification working normally'
        )
      }
      break

    case 'serialization_error':
      // FAULT-TOLERANT: JSON serialization error occurred but pipeline continues
      console.warn(`[Live Transcription] Serialization error (non-fatal): ${message.error}`)
      console.warn(`[Live Transcription] Original message type: ${message.original_type}`)
      // Don't emit to UI - these are handled internally and shouldn't interrupt user experience
      // The pipeline continues with fallback handling
      break

    case 'error':
      console.error('[Live Transcription] Error from Python:', message.message)
      updateState({ error: message.message })
      emitProgress('error', 0, message.message || 'Transcription error')
      break

    case 'complete':
      console.log('[Live Transcription] Transcription complete, total seconds:', message.total_seconds)
      emitProgress('processing', 100, 'Processing complete')
      break
  }
}

// ============================================================================
// Live Transcription Service
// ============================================================================

export const liveTranscriptionService = {
  /**
   * Start a live transcription session with a streaming Python process
   *
   * Note: The Python process is started when the first audio chunk arrives,
   * so we know the actual sample rate being used by the recording.
   */
  async startSession(
    meetingId: string,
    audioPath: string,
    config: LiveTranscriptionConfig = {}
  ): Promise<{ success: boolean; error?: string }> {
    if (currentState.status !== 'idle') {
      console.log('[Live Transcription] Already in progress, status:', currentState.status)
      return { success: false, error: 'Live transcription already in progress' }
    }

    console.log('[Live Transcription] Starting streaming session for meeting:', meetingId)

    // Reset deferred start state
    pendingConfig = config
    audioChunkBuffer = []
    detectedSampleRate = null
    pythonStartPromiseResolve = null

    updateState({
      status: 'starting',
      meetingId,
      audioPath,
      lastProcessedOffset: 0,
      segmentCount: 0,
      startTime: Date.now(),
      error: undefined,
    })

    emitProgress('starting', 0, 'Waiting for audio stream...')
    isModelReady = false

    try {
      const pythonPath = findPythonPath()
      const scriptPath = path.join(getPythonScriptsDir(), 'stream_transcribe.py')

      console.log('[Live Transcription] Python path:', pythonPath)
      console.log('[Live Transcription] Script path:', scriptPath)

      if (!fs.existsSync(scriptPath)) {
        // Fall back to regular transcribe.py if streaming script doesn't exist
        console.log('[Live Transcription] Streaming script not found, using file-based approach')
        updateState({ status: 'active' })
        emitProgress('active', 0, 'Live transcription active (file-based mode)')
        return { success: true }
      }

      // Subscribe to audio chunks from the recording service
      // The Python process will be started when the first chunk arrives
      audioChunkUnsubscribe = audioRecorderService.onAudioChunk(async (chunkData) => {
        // Track audio diagnostics
        audioChunksReceived++
        totalAudioBytesReceived += chunkData.data.length
        lastAudioChunkTime = Date.now()

        // Log periodic diagnostics (every 100 chunks)
        if (audioChunksReceived % 100 === 0) {
          logAudioDiagnostics('periodic check')
        }

        // If this is the first chunk, start the Python process with the detected sample rate
        if (detectedSampleRate === null && currentState.status === 'starting') {
          detectedSampleRate = chunkData.sampleRate
          console.log(`[Live Transcription] First audio chunk received:
            Sample rate: ${detectedSampleRate} Hz
            Channels: ${chunkData.channels}
            Bit depth: ${chunkData.bitDepth}
            Chunk size: ${chunkData.data.length} bytes`)

          emitProgress('starting', 10, `Detected audio at ${detectedSampleRate} Hz, loading transcription model...`)

          // Buffer this first chunk
          audioChunkBuffer.push(chunkData.data)

          // Start the Python process with the detected sample rate
          const result = await startPythonProcess(detectedSampleRate)

          if (pythonStartPromiseResolve) {
            pythonStartPromiseResolve(result)
            pythonStartPromiseResolve = null
          }

          return
        }

        // If Python is not ready yet OR state is still 'starting', buffer the chunk
        // CRITICAL FIX for 35-second audio repetition bug:
        // - isModelReady is set to true when Python sends 'ready' message
        // - BUT state is still 'starting' until the buffer is flushed
        // - We MUST continue buffering until state becomes 'active'
        // - This ensures all chunks are sent to Python in the correct order
        const shouldBuffer = currentState.status === 'starting' || !isModelReady || !streamingProcess?.stdin
        if (shouldBuffer) {
          audioChunkBuffer.push(chunkData.data)
          // Don't buffer too much - keep last 30 seconds worth of audio
          const maxBufferSize = Math.floor(30 * (detectedSampleRate || 16000) * 2) // 30 sec * sample rate * 2 bytes
          let totalBufferSize = audioChunkBuffer.reduce((sum, buf) => sum + buf.length, 0)
          while (totalBufferSize > maxBufferSize && audioChunkBuffer.length > 1) {
            const removed = audioChunkBuffer.shift()
            totalBufferSize -= removed?.length || 0
          }
          // Log warning if we're dropping audio
          if (!audioHealthWarningEmitted && audioChunkBuffer.length > 100) {
            console.warn('[Live Transcription] Audio buffer getting large - model may be taking too long to load')
            audioHealthWarningEmitted = true
          }
          return
        }

        // Write audio data to Python process
        if (currentState.status === 'active') {
          try {
            const writeResult = streamingProcess?.stdin?.write(chunkData.data)
            audioChunksToPython++
            totalAudioBytesToPython += chunkData.data.length

            // Log first few chunks being written to Python for debugging
            if (audioChunksToPython <= 5) {
              console.log(`[Live Transcription] Wrote chunk #${audioChunksToPython} to Python: ${chunkData.data.length} bytes, write returned: ${writeResult}`)
            }
            // Periodic logging
            if (audioChunksToPython % 50 === 0) {
              console.log(`[Live Transcription] Chunks to Python: ${audioChunksToPython}, total bytes: ${(totalAudioBytesToPython / 1024).toFixed(1)} KB`)
            }
          } catch (e) {
            console.error('[Live Transcription] Error writing audio chunk:', e)
            logAudioDiagnostics('write error')
          }
        } else {
          // Log if we're receiving chunks but not writing them (should not happen normally after active)
          if (audioChunksReceived % 50 === 0 && audioChunksReceived > 0) {
            console.log(`[Live Transcription] Receiving chunks but status is '${currentState.status}', not writing to Python`)
          }
        }
      })

      // NOTE: For dual-source recording (mic + system audio), we receive MIXED audio
      // from the AudioMixer's onMixedChunk callback. This contains both:
      // - Local microphone audio (user's voice)
      // - System audio (meeting participants via virtual cable like BlackHole)
      //
      // The mixing is done at the sample level by AudioMixer, which properly combines
      // both audio streams. This is the correct approach because:
      // 1. Both speakers are in one coherent audio stream
      // 2. No interleaving/corruption issues
      // 3. Whisper can transcribe all voices from the combined audio

      console.log('[Live Transcription] Subscribed to audio chunks (mixed mic + system for dual-source), waiting for first chunk...')

      // Return a promise that resolves when Python is ready or times out
      return new Promise((resolve) => {
        pythonStartPromiseResolve = resolve

        // Timeout if no audio chunks arrive within 30 seconds
        const noAudioTimeout = setTimeout(() => {
          if (detectedSampleRate === null) {
            console.log('[Live Transcription] No audio chunks received within 30 seconds')
            logAudioDiagnostics('timeout - no audio')

            // Clean up state on timeout - reset to idle so user can try again
            if (audioChunkUnsubscribe) {
              audioChunkUnsubscribe()
              audioChunkUnsubscribe = null
            }
            if (systemAudioChunkUnsubscribe) {
              systemAudioChunkUnsubscribe()
              systemAudioChunkUnsubscribe = null
            }
            pendingConfig = null
            audioChunkBuffer = []
            pythonStartPromiseResolve = null
            resetAudioDiagnostics()

            updateState({
              status: 'idle',  // Reset to idle so user can retry
              error: 'No audio data received',
              meetingId: null,
              audioPath: null,
            })
            emitProgress('error', 0, 'No audio data received - check microphone settings and ensure recording is active')
            resolve({ success: false, error: 'No audio data received - check microphone settings and ensure recording is active' })
          }
        }, 30000)

        // Clear timeout if we detect audio
        const checkForAudio = setInterval(() => {
          if (detectedSampleRate !== null) {
            clearTimeout(noAudioTimeout)
            clearInterval(checkForAudio)
          }
          if (currentState.status === 'error') {
            clearTimeout(noAudioTimeout)
            clearInterval(checkForAudio)
          }
        }, 100)
      })

    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error)
      console.error('[Live Transcription] Failed to start:', errorMsg)

      // Clean up state on error - reset to idle so user can try again
      if (audioChunkUnsubscribe) {
        audioChunkUnsubscribe()
        audioChunkUnsubscribe = null
      }
      if (systemAudioChunkUnsubscribe) {
        systemAudioChunkUnsubscribe()
        systemAudioChunkUnsubscribe = null
      }
      pendingConfig = null
      audioChunkBuffer = []
      detectedSampleRate = null
      pythonStartPromiseResolve = null

      updateState({
        status: 'idle',  // Reset to idle so user can retry
        error: errorMsg,
        meetingId: null,
        audioPath: null,
      })
      emitProgress('error', 0, errorMsg)
      return { success: false, error: errorMsg }
    }
  },

  /**
   * Send audio data directly to the streaming process
   */
  sendAudioChunk(audioData: Buffer): { success: boolean; error?: string } {
    if (!streamingProcess || !streamingProcess.stdin) {
      return { success: false, error: 'No active transcription process' }
    }

    if (currentState.status !== 'active') {
      return { success: false, error: `Cannot send audio in status: ${currentState.status}` }
    }

    if (!isModelReady) {
      return { success: false, error: 'Model not ready yet' }
    }

    try {
      streamingProcess.stdin.write(audioData)
      return { success: true }
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error)
      console.error('[Live Transcription] Error sending audio:', errorMsg)
      return { success: false, error: errorMsg }
    }
  },

  /**
   * Transcribe a chunk of the current audio file (file-based fallback)
   * This is used when streaming isn't available
   */
  async transcribeChunk(
    audioPath: string,
    config: {
      language?: string
      modelSize?: 'tiny' | 'base' | 'small'
      startTimeMs?: number
    } = {}
  ): Promise<TranscribeChunkResult> {
    const startTime = Date.now()

    console.log(`[Live Transcription] transcribeChunk called with path: ${audioPath}`)

    // Validate audio file
    if (!fs.existsSync(audioPath)) {
      console.log(`[Live Transcription] Audio file not found: ${audioPath}`)
      return {
        success: false,
        segments: [],
        error: `Audio file not found: ${audioPath}`,
      }
    }

    // Check file size
    const stats = fs.statSync(audioPath)
    const fileSizeKB = stats.size / 1024
    console.log(`[Live Transcription] Audio file size: ${fileSizeKB.toFixed(2)} KB`)

    // If file is too small, skip
    if (stats.size < 10000) {
      console.log(`[Live Transcription] Audio file too small (${stats.size} bytes), skipping`)
      return {
        success: true,
        segments: [],
        metadata: {
          audioFile: audioPath,
          modelSize: config.modelSize || DEFAULT_MODEL_SIZE,
          language: config.language || 'en',
          processingTimeMs: Date.now() - startTime,
        },
      }
    }

    const modelSize = config.modelSize || DEFAULT_MODEL_SIZE
    const language = config.language || 'en'

    try {
      const pythonPath = findPythonPath()
      const scriptPath = path.join(getPythonScriptsDir(), 'transcribe.py')

      // Check if we're using the bundled executable
      const isBundledExe = pythonPath.includes('transcription_bundle')

      // For non-bundled mode, check if script exists
      if (!isBundledExe && !fs.existsSync(scriptPath)) {
        return {
          success: false,
          segments: [],
          error: `Transcription script not found: ${scriptPath}`,
        }
      }

      // Build args based on whether we're using bundled executable
      const args: string[] = []
      if (isBundledExe) {
        // Use 'transcribe' subcommand for bundled executable
        args.push('transcribe')
        console.log('[Live Transcription] Using bundled executable with "transcribe" subcommand')
      } else {
        // Use script path for Python interpreter
        args.push(scriptPath)
      }

      args.push(
        audioPath,
        '--model', modelSize,
        '--language', language,
        '--format', 'json',
        '--no-align'
      )

      console.log(`[Live Transcription] Running: ${pythonPath} ${args.join(' ')}`)

      const result = await new Promise<TranscribeChunkResult>((resolve) => {
        let stdout = ''
        let stderr = ''

        // Get HF_TOKEN from settings (for pyannote speaker diarization)
        let hfTokenChunk = settingsService.get<string>('transcription.hfToken') || ''
        // Also check environment variable as fallback
        if (!hfTokenChunk && process.env.HF_TOKEN) {
          hfTokenChunk = process.env.HF_TOKEN
        }

        const proc = spawn(pythonPath, args, {
          stdio: ['pipe', 'pipe', 'pipe'],
          env: {
            ...process.env,
            PYTHONUNBUFFERED: '1',
            // PyTorch 2.6+ compatibility: disable weights_only enforcement for model loading
            TORCH_FORCE_NO_WEIGHTS_ONLY_LOAD: '1',
            // Suppress torchaudio deprecation warnings from pyannote.audio
            PYTHONWARNINGS: 'ignore::UserWarning,ignore::DeprecationWarning,ignore::FutureWarning',
            // Pass HF_TOKEN for pyannote speaker diarization model authentication
            ...(hfTokenChunk ? { HF_TOKEN: hfTokenChunk } : {}),
          },
        })

        const timeoutId = setTimeout(() => {
          proc.kill('SIGTERM')
          resolve({ success: false, segments: [], error: 'Transcription timed out' })
        }, 60000)

        proc.stdout?.on('data', (data: Buffer) => { stdout += data.toString() })
        proc.stderr?.on('data', (data: Buffer) => { stderr += data.toString() })

        proc.on('exit', (code) => {
          clearTimeout(timeoutId)

          if (code !== 0) {
            console.error(`[Live Transcription] Process failed:`, stderr)
            resolve({ success: false, segments: [], error: `Transcription failed: ${stderr}` })
            return
          }

          try {
            const jsonStart = stdout.indexOf('{')
            if (jsonStart === -1) {
              resolve({ success: false, segments: [], error: 'No JSON output' })
              return
            }

            let braceCount = 0, jsonEnd = -1
            for (let i = jsonStart; i < stdout.length; i++) {
              if (stdout[i] === '{') braceCount++
              if (stdout[i] === '}') braceCount--
              if (braceCount === 0) { jsonEnd = i; break }
            }

            if (jsonEnd === -1) {
              resolve({ success: false, segments: [], error: 'Invalid JSON' })
              return
            }

            const rawResult = JSON.parse(stdout.substring(jsonStart, jsonEnd + 1))
            const segments: LiveTranscriptSegment[] = (rawResult.segments || []).map(
              (seg: any, index: number) => ({
                id: `live-${Date.now()}-${index}`,
                text: (seg.text || '').trim(),
                start: seg.start || 0,
                end: seg.end || 0,
                confidence: seg.confidence,
                is_final: true,
                speaker: seg.speaker,
              })
            )

            updateState({ segmentCount: currentState.segmentCount + segments.length })

            resolve({
              success: true,
              segments,
              metadata: { audioFile: audioPath, modelSize, language, processingTimeMs: Date.now() - startTime },
            })
          } catch (e) {
            resolve({ success: false, segments: [], error: `Parse error: ${e}` })
          }
        })

        proc.on('error', (err) => {
          clearTimeout(timeoutId)
          resolve({ success: false, segments: [], error: `Process error: ${err.message}` })
        })
      })

      return result
    } catch (error) {
      return { success: false, segments: [], error: error instanceof Error ? error.message : String(error) }
    }
  },

  /**
   * Pause the live transcription session
   */
  pause(): { success: boolean } {
    if (currentState.status !== 'active') {
      return { success: false }
    }

    updateState({ status: 'paused' })
    emitProgress('paused', currentState.segmentCount, 'Live transcription paused')
    console.log('[Live Transcription] Session paused')

    return { success: true }
  },

  /**
   * Resume the live transcription session
   */
  resume(): { success: boolean } {
    if (currentState.status !== 'paused') {
      return { success: false }
    }

    updateState({ status: 'active' })
    emitProgress('active', currentState.segmentCount, 'Live transcription resumed')
    console.log('[Live Transcription] Session resumed')

    return { success: true }
  },

  /**
   * Stop the live transcription session
   */
  async stopSession(): Promise<{ success: boolean; segmentCount: number }> {
    if (currentState.status === 'idle') {
      return { success: true, segmentCount: 0 }
    }

    console.log('[Live Transcription] Stopping session')

    updateState({ status: 'stopping' })
    emitProgress('stopping', 100, 'Stopping live transcription...')

    // Log final audio diagnostics before cleanup
    logAudioDiagnostics('session stopping')

    const segmentCount = currentState.segmentCount

    // Unsubscribe from audio chunks (both microphone and system audio)
    if (audioChunkUnsubscribe) {
      audioChunkUnsubscribe()
      audioChunkUnsubscribe = null
    }
    if (systemAudioChunkUnsubscribe) {
      systemAudioChunkUnsubscribe()
      systemAudioChunkUnsubscribe = null
    }

    // Close stdin to signal end of input to Python process
    if (streamingProcess?.stdin) {
      try {
        streamingProcess.stdin.end()
      } catch (e) {
        console.log('[Live Transcription] Error closing stdin:', e)
      }
    }

    // Wait a bit for final segments, then kill if necessary
    await new Promise<void>((resolve) => {
      const timeout = setTimeout(() => {
        if (streamingProcess && !streamingProcess.killed) {
          console.log('[Live Transcription] Force killing process')
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
    isModelReady = false

    // Reset deferred start state
    pendingConfig = null
    audioChunkBuffer = []
    detectedSampleRate = null
    pythonStartPromiseResolve = null

    // Reset audio diagnostics
    resetAudioDiagnostics()

    // Reset state
    updateState({
      status: 'idle',
      meetingId: null,
      audioPath: null,
      lastProcessedOffset: 0,
      segmentCount: 0,
      startTime: null,
      error: undefined,
    })

    emitProgress('idle', 0, 'Live transcription stopped')
    console.log(`[Live Transcription] Session stopped. Total segments: ${segmentCount}`)

    return { success: true, segmentCount }
  },

  /**
   * Get the current status
   */
  getStatus(): LiveTranscriptionState {
    return { ...currentState }
  },

  /**
   * Get audio diagnostics for debugging
   * Returns information about audio chunks received and sent to Python
   */
  getAudioDiagnostics(): {
    chunksReceived: number
    chunksToPython: number
    bytesReceived: number
    bytesToPython: number
    lastChunkTime: number
    bufferSize: number
    isModelReady: boolean
    detectedSampleRate: number | null
  } {
    return {
      chunksReceived: audioChunksReceived,
      chunksToPython: audioChunksToPython,
      bytesReceived: totalAudioBytesReceived,
      bytesToPython: totalAudioBytesToPython,
      lastChunkTime: lastAudioChunkTime,
      bufferSize: audioChunkBuffer.length,
      isModelReady,
      detectedSampleRate,
    }
  },

  /**
   * Subscribe to progress updates
   */
  onProgress(callback: (progress: LiveTranscriptionProgress) => void): () => void {
    progressEmitter.on(LIVE_TRANSCRIPTION_EVENT, callback)
    return () => { progressEmitter.off(LIVE_TRANSCRIPTION_EVENT, callback) }
  },

  /**
   * Subscribe to new segment events
   */
  onSegment(callback: (segment: LiveTranscriptSegment) => void): () => void {
    progressEmitter.on(SEGMENT_EVENT, callback)
    return () => { progressEmitter.off(SEGMENT_EVENT, callback) }
  },

  /**
   * Get current diarization status
   * Returns whether speaker diarization is available and its capabilities
   */
  getDiarizationStatus(): {
    available: boolean
    capabilities: DiarizationCapabilities | null
    unavailableReason: string | null
  } {
    return {
      available: diarizationAvailable,
      capabilities: diarizationCapabilities,
      unavailableReason: diarizationUnavailableReason
    }
  },

  /**
   * Subscribe to diarization status updates
   * This is called when diarization availability changes (e.g., when Python reports it's unavailable)
   */
  onDiarizationStatus(callback: (status: {
    available: boolean
    capabilities?: DiarizationCapabilities
    reason?: string
    details?: string
    message?: string
  }) => void): () => void {
    progressEmitter.on(DIARIZATION_STATUS_EVENT, callback)
    return () => { progressEmitter.off(DIARIZATION_STATUS_EVENT, callback) }
  },

  /**
   * Get current diarization health status
   *
   * Returns the current health state of the diarization pipeline, including:
   * - Whether there's an active warning
   * - Failure counts and reasons
   * - Recommendations for resolution
   *
   * This is part of the fault-tolerant error handling system that ensures
   * transcription continues even when diarization encounters errors.
   */
  getDiarizationHealth(): DiarizationHealthState {
    return { ...diarizationHealthState }
  },

  /**
   * Subscribe to diarization health updates
   *
   * Emits events when diarization health changes:
   * - 'warning': When repeated failures are detected
   * - 'recovery': When diarization recovers from issues
   *
   * This allows the UI to show appropriate warnings to users while
   * maintaining confidence that transcription continues uninterrupted.
   */
  onDiarizationHealth(callback: (event: {
    type: 'warning' | 'recovery'
    hasWarning: boolean
    message: string
    consecutiveFailures?: number
    totalFailures?: number
    lastFailureReason?: string | null
    isRecoverable?: boolean
    recommendation?: string | null
    totalSegmentsProcessed?: number
    previousFailures?: number
  }) => void): () => void {
    progressEmitter.on(DIARIZATION_HEALTH_EVENT, callback)
    return () => { progressEmitter.off(DIARIZATION_HEALTH_EVENT, callback) }
  },

  /**
   * Force reset the transcription state
   * Use this to recover from stuck states (e.g., when error occurs and state doesn't reset properly)
   */
  forceReset(): { success: boolean } {
    console.log('[Live Transcription] Force resetting state')

    // Unsubscribe from audio chunks (both microphone and system audio)
    if (audioChunkUnsubscribe) {
      audioChunkUnsubscribe()
      audioChunkUnsubscribe = null
    }
    if (systemAudioChunkUnsubscribe) {
      systemAudioChunkUnsubscribe()
      systemAudioChunkUnsubscribe = null
    }

    // Kill any running Python process
    if (streamingProcess && !streamingProcess.killed) {
      try {
        streamingProcess.kill('SIGKILL')
      } catch (e) {
        console.error('[Live Transcription] Error killing process during force reset:', e)
      }
    }
    streamingProcess = null
    isModelReady = false

    // Reset all state
    pendingConfig = null
    audioChunkBuffer = []
    detectedSampleRate = null
    pythonStartPromiseResolve = null
    segmentIdCounter = 0

    // Reset audio diagnostics
    resetAudioDiagnostics()

    // Reset diarization status
    diarizationCapabilities = null
    diarizationAvailable = false
    diarizationUnavailableReason = null

    // Reset diarization health state
    diarizationHealthState = {
      hasWarning: false,
      warningMessage: null,
      consecutiveFailures: 0,
      totalFailures: 0,
      lastFailureReason: null,
      lastFailureTime: null,
      isRecoverable: true,
      recommendation: null
    }

    updateState({
      status: 'idle',
      meetingId: null,
      audioPath: null,
      lastProcessedOffset: 0,
      segmentCount: 0,
      startTime: null,
      error: undefined,
    })

    emitProgress('idle', 0, 'Transcription state reset')
    console.log('[Live Transcription] Force reset complete')

    return { success: true }
  },

  /**
   * Check if live transcription is available
   */
  async isAvailable(): Promise<{
    available: boolean
    pythonPath: string
    error?: string
  }> {
    const pythonPath = findPythonPath()
    const streamScript = path.join(getPythonScriptsDir(), 'stream_transcribe.py')
    const transcribeScript = path.join(getPythonScriptsDir(), 'transcribe.py')

    // Check for either script
    const hasScript = fs.existsSync(streamScript) || fs.existsSync(transcribeScript)
    if (!hasScript) {
      return {
        available: false,
        pythonPath,
        error: 'Transcription scripts not found',
      }
    }

    // Check if Python is available
    try {
      const { execSync } = require('child_process')
      execSync(`"${pythonPath}" --version`, { timeout: 5000 })
      return { available: true, pythonPath }
    } catch (error) {
      return { available: false, pythonPath, error: 'Python not available' }
    }
  },

  /**
   * Validate that diarization data exists for a time range before transcription
   *
   * CRITICAL: This ensures transcription only proceeds if diarization is available.
   * Speaker identity MUST come from diarization, never from text analysis.
   *
   * @param diarizationSegments - Current diarization segments
   * @param startTimeSeconds - Start of range to validate
   * @param endTimeSeconds - End of range to validate
   * @returns Validation result with error if diarization is missing
   */
  validateDiarizationForTranscription(
    diarizationSegments: MandatoryDiarizationSegment[],
    startTimeSeconds: number,
    endTimeSeconds: number
  ): {
    valid: boolean
    error?: string
    warning?: string
    coveragePercent: number
  } {
    const validation = temporalAlignmentService.validateDiarizationCoverage(
      diarizationSegments,
      startTimeSeconds,
      endTimeSeconds,
      { minCoverageThreshold: 0.3 } // Allow some gaps in live mode
    )

    if (!validation.valid) {
      return {
        valid: false,
        error: validation.error || 'Diarization data is required before transcription can proceed',
        coveragePercent: 0
      }
    }

    // Calculate coverage percentage
    let coveragePercent = 0
    if (validation.coveredRange) {
      const totalDuration = endTimeSeconds - startTimeSeconds
      const coveredDuration =
        Math.min(validation.coveredRange.endTime, endTimeSeconds) -
        Math.max(validation.coveredRange.startTime, startTimeSeconds)
      coveragePercent = totalDuration > 0 ? (coveredDuration / totalDuration) * 100 : 0
    }

    return {
      valid: true,
      warning: validation.warnings.length > 0 ? validation.warnings.join('; ') : undefined,
      coveragePercent: Math.max(0, Math.min(100, coveragePercent))
    }
  },

  /**
   * Check if diarization is required before transcription
   *
   * Returns true if the diarization-first mode is enabled, meaning
   * transcription should not proceed without diarization data.
   */
  isDiarizationRequired(): boolean {
    // In the diarization-first architecture, diarization is always required
    // This method allows checking the requirement status
    return true
  },

  /**
   * Get the error message for missing diarization
   */
  getMissingDiarizationMessage(): string {
    return diarizationAwareTranscriptPipeline.getMissingDiarizationMessage()
  },
}

// Export reset function for testing
export function resetLiveTranscriptionState(): void {
  if (audioChunkUnsubscribe) {
    audioChunkUnsubscribe()
    audioChunkUnsubscribe = null
  }
  if (systemAudioChunkUnsubscribe) {
    systemAudioChunkUnsubscribe()
    systemAudioChunkUnsubscribe = null
  }

  if (streamingProcess && !streamingProcess.killed) {
    streamingProcess.kill('SIGKILL')
    streamingProcess = null
  }

  isModelReady = false
  segmentIdCounter = 0

  // Reset deferred start state
  pendingConfig = null
  audioChunkBuffer = []
  detectedSampleRate = null
  pythonStartPromiseResolve = null

  // Reset audio diagnostics
  resetAudioDiagnostics()

  // Reset diarization status
  diarizationCapabilities = null
  diarizationAvailable = false
  diarizationUnavailableReason = null

  // Reset diarization health state
  diarizationHealthState = {
    hasWarning: false,
    warningMessage: null,
    consecutiveFailures: 0,
    totalFailures: 0,
    lastFailureReason: null,
    lastFailureTime: null,
    isRecoverable: true,
    recommendation: null
  }

  // Clear speaker mappings for the current meeting
  if (currentState.meetingId) {
    clearSpeakerMappings(currentState.meetingId)
  }

  currentState = {
    status: 'idle',
    meetingId: null,
    audioPath: null,
    lastProcessedOffset: 0,
    segmentCount: 0,
    startTime: null,
  }

  progressEmitter.removeAllListeners()
}
