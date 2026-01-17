/**
 * Diarization Failure Service
 *
 * Implements explicit failure detection and user notification system for when
 * speaker diarization cannot be performed.
 *
 * CRITICAL: This service ensures that:
 * 1. Diarization failures are NEVER silently ignored
 * 2. Users are ALWAYS notified with prominent error messages
 * 3. No silent fallback to single-speaker mode or "Unknown Speaker" placeholders
 * 4. Users must explicitly choose transcription-only mode
 *
 * Failure Conditions Detected:
 * - No speaker embeddings generated
 * - Clustering algorithm failed
 * - Diarization model not loaded
 * - Output schema validation failed
 * - Only transcription available without speaker data
 */

import { EventEmitter } from 'events'

// ============================================================================
// Types and Interfaces
// ============================================================================

/**
 * Categories of diarization failures
 */
export type DiarizationFailureType =
  | 'model_not_found'
  | 'model_not_loaded'
  | 'embedding_extraction_failed'
  | 'clustering_failed'
  | 'validation_failed'
  | 'insufficient_audio'
  | 'no_speakers_detected'
  | 'timeout'
  | 'python_not_available'
  | 'dependency_missing'
  | 'configuration_error'
  | 'authentication_required'
  | 'unknown'

/**
 * Severity level for failure notifications
 */
export type FailureSeverity = 'error' | 'warning' | 'info'

/**
 * Remediation step for failure recovery
 */
export interface RemediationStep {
  /** Step order (1, 2, 3...) */
  order: number
  /** Short title for the step */
  title: string
  /** Detailed description of what to do */
  description: string
  /** Optional command to run */
  command?: string
  /** Whether this step is automated (can be run by the app) */
  automated?: boolean
  /** URL for more information */
  helpUrl?: string
}

/**
 * Comprehensive failure information
 */
export interface DiarizationFailure {
  /** Unique failure identifier */
  id: string
  /** Timestamp when failure occurred */
  timestamp: number
  /** Type/category of failure */
  type: DiarizationFailureType
  /** Severity level */
  severity: FailureSeverity
  /** Human-readable error message */
  message: string
  /** Detailed diagnostic information */
  diagnosticInfo: string
  /** Steps to remediate the issue */
  remediationSteps: RemediationStep[]
  /** Meeting ID if applicable */
  meetingId?: string
  /** Audio file path if applicable */
  audioPath?: string
  /** Technical error details (for logging) */
  technicalDetails?: {
    errorCode?: string
    errorMessage?: string
    stackTrace?: string
    pythonOutput?: string
  }
  /** Whether user was notified */
  userNotified: boolean
  /** Whether failure has been acknowledged by user */
  acknowledged: boolean
}

/**
 * User notification payload sent to renderer
 */
export interface DiarizationFailureNotification {
  /** The prominent error message to display */
  prominentMessage: string
  /** Detailed explanation */
  detailedMessage: string
  /** Diagnostic summary */
  diagnosticSummary: string
  /** Remediation steps */
  remediationSteps: RemediationStep[]
  /** Show "Enable Transcription-Only Mode" option */
  showTranscriptionOnlyOption: boolean
  /** Timestamp */
  timestamp: number
  /** Failure ID for reference */
  failureId: string
}

/**
 * User preference for diarization behavior
 */
export interface DiarizationPreference {
  /** Whether user has explicitly disabled diarization */
  diarizationDisabled: boolean
  /** Whether user has acknowledged transcription-only mode */
  transcriptionOnlyAcknowledged: boolean
  /** When the preference was last updated */
  lastUpdated: number
  /** Reason for disabling (user-provided or automatic) */
  disableReason?: string
}

// ============================================================================
// Constants
// ============================================================================

/** The mandatory failure message that MUST be displayed to users */
export const DIARIZATION_FAILURE_MESSAGE =
  'Speaker diarization is not available. Audio is being transcribed without speaker separation.'

/** Event names */
const FAILURE_EVENT = 'diarization:failure'
const NOTIFICATION_EVENT = 'diarization:failure:notification'

/** Maximum failures to keep in memory */
const MAX_FAILURES_IN_MEMORY = 100

// ============================================================================
// Service State
// ============================================================================

const failures: DiarizationFailure[] = []
const eventEmitter = new EventEmitter()

// ============================================================================
// Helper Functions
// ============================================================================

function generateFailureId(): string {
  return `diar-fail-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`
}

/**
 * Get remediation steps for a specific failure type
 */
function getRemediationSteps(failureType: DiarizationFailureType): RemediationStep[] {
  switch (failureType) {
    case 'model_not_found':
      return [
        {
          order: 1,
          title: 'Check Python Installation',
          description: 'Ensure Python 3.10+ is installed and accessible in your PATH.',
          command: 'python --version',
          automated: false
        },
        {
          order: 2,
          title: 'Install pyannote.audio',
          description: 'Install the speaker diarization model using pip.',
          command: 'pip install pyannote.audio',
          automated: false
        },
        {
          order: 3,
          title: 'Accept Hugging Face License',
          description: 'Visit Hugging Face and accept the model license agreement for pyannote/speaker-diarization.',
          helpUrl: 'https://huggingface.co/pyannote/speaker-diarization',
          automated: false
        },
        {
          order: 4,
          title: 'Set Hugging Face Token',
          description: 'Open Meeting Notes Settings > Audio > Speaker Identification and paste your HuggingFace token, then click Save.',
          automated: false
        }
      ]

    case 'model_not_loaded':
      return [
        {
          order: 1,
          title: 'Restart the Application',
          description: 'Close and reopen Meeting Notes to reload the diarization model.',
          automated: false
        },
        {
          order: 2,
          title: 'Check Available Memory',
          description: 'Speaker diarization requires at least 4GB of available RAM. Close other applications if needed.',
          automated: false
        },
        {
          order: 3,
          title: 'Run Diagnostics',
          description: 'Go to Settings > Audio > Live Transcription Diagnostics to check system status.',
          automated: false
        }
      ]

    case 'embedding_extraction_failed':
      return [
        {
          order: 1,
          title: 'Check Audio Quality',
          description: 'Ensure your audio recording has clear speech. Very noisy or low-volume audio may fail embedding extraction.',
          automated: false
        },
        {
          order: 2,
          title: 'Verify Audio Format',
          description: 'Ensure the audio file is in a supported format (WAV, MP3, M4A, FLAC).',
          automated: false
        },
        {
          order: 3,
          title: 'Check speechbrain/pyannote Installation',
          description: 'Verify that speaker embedding models are properly installed.',
          command: 'python -c "import speechbrain; print(speechbrain.__version__)"',
          automated: false
        }
      ]

    case 'clustering_failed':
      return [
        {
          order: 1,
          title: 'Check Number of Speakers',
          description: 'If the audio has only one speaker, clustering may fail. Try enabling transcription-only mode.',
          automated: false
        },
        {
          order: 2,
          title: 'Adjust Clustering Threshold',
          description: 'Go to Settings > Audio > Speaker Diarization and adjust the similarity threshold.',
          automated: false
        },
        {
          order: 3,
          title: 'Verify sklearn Installation',
          description: 'Clustering requires scikit-learn. Ensure it is properly installed.',
          command: 'pip install scikit-learn',
          automated: false
        }
      ]

    case 'validation_failed':
      return [
        {
          order: 1,
          title: 'Report Issue',
          description: 'This is likely a bug. Please report this issue with the diagnostic information provided.',
          automated: false
        },
        {
          order: 2,
          title: 'Try Again',
          description: 'The issue may be temporary. Try processing the audio again.',
          automated: false
        }
      ]

    case 'insufficient_audio':
      return [
        {
          order: 1,
          title: 'Record More Audio',
          description: 'Speaker diarization requires at least 10 seconds of audio with speech. Ensure there is enough spoken content.',
          automated: false
        },
        {
          order: 2,
          title: 'Check Audio Content',
          description: 'Verify that the audio file contains actual speech, not just silence or noise.',
          automated: false
        }
      ]

    case 'no_speakers_detected':
      return [
        {
          order: 1,
          title: 'Verify Audio Contains Speech',
          description: 'Ensure the audio recording contains audible speech. Check the audio file in a media player.',
          automated: false
        },
        {
          order: 2,
          title: 'Check Input Device',
          description: 'Verify that the correct microphone is selected in Settings > Audio.',
          automated: false
        },
        {
          order: 3,
          title: 'Adjust Microphone Levels',
          description: 'If audio is too quiet, increase microphone input levels in your system settings.',
          automated: false
        }
      ]

    case 'timeout':
      return [
        {
          order: 1,
          title: 'Try Shorter Audio',
          description: 'Very long audio files may timeout. Try splitting the audio into smaller segments.',
          automated: false
        },
        {
          order: 2,
          title: 'Check System Load',
          description: 'Close resource-intensive applications to free up CPU and memory.',
          automated: false
        },
        {
          order: 3,
          title: 'Use GPU Acceleration',
          description: 'If you have a CUDA-compatible GPU, enable GPU acceleration in Settings.',
          automated: false
        }
      ]

    case 'python_not_available':
      return [
        {
          order: 1,
          title: 'Install Python',
          description: 'Download and install Python 3.10 or later from python.org.',
          helpUrl: 'https://www.python.org/downloads/',
          automated: false
        },
        {
          order: 2,
          title: 'Add Python to PATH',
          description: 'Ensure Python is added to your system PATH during installation.',
          automated: false
        },
        {
          order: 3,
          title: 'Restart Application',
          description: 'After installing Python, restart Meeting Notes.',
          automated: false
        }
      ]

    case 'dependency_missing':
      return [
        {
          order: 1,
          title: 'Install Dependencies',
          description: 'Run the dependency installation script from the application folder.',
          command: 'pip install -r requirements.txt',
          automated: false
        },
        {
          order: 2,
          title: 'Run Diagnostics',
          description: 'Go to Settings > Audio > Live Transcription Diagnostics to identify missing dependencies.',
          automated: false
        }
      ]

    case 'configuration_error':
      return [
        {
          order: 1,
          title: 'Reset Diarization Settings',
          description: 'Go to Settings > Audio > Speaker Diarization and reset to default values.',
          automated: false
        },
        {
          order: 2,
          title: 'Restart Application',
          description: 'Restart Meeting Notes to apply default configuration.',
          automated: false
        }
      ]

    case 'authentication_required':
      return [
        {
          order: 1,
          title: 'Create Hugging Face Account',
          description: 'Create a free account at Hugging Face if you don\'t have one already.',
          helpUrl: 'https://huggingface.co/join',
          automated: false
        },
        {
          order: 2,
          title: 'Accept Model License',
          description: 'Visit the pyannote/embedding model page and accept the license agreement. You must be logged in to Hugging Face.',
          helpUrl: 'https://huggingface.co/pyannote/embedding',
          automated: false
        },
        {
          order: 3,
          title: 'Create Access Token',
          description: 'Go to Hugging Face Settings > Access Tokens and create a new token with "read" permission.',
          helpUrl: 'https://huggingface.co/settings/tokens',
          automated: false
        },
        {
          order: 4,
          title: 'Save Token in Meeting Notes Settings',
          description: 'Open Meeting Notes Settings > Audio > Speaker Identification and paste your HuggingFace token, then click Save.',
          automated: false
        },
        {
          order: 5,
          title: 'Retry Speaker Identification',
          description: 'Try enabling speaker identification again or re-download models from Settings.',
          automated: false
        }
      ]

    default:
      return [
        {
          order: 1,
          title: 'Run Diagnostics',
          description: 'Go to Settings > Audio > Live Transcription Diagnostics to check system status.',
          automated: false
        },
        {
          order: 2,
          title: 'Contact Support',
          description: 'If the issue persists, please report it with the diagnostic information provided.',
          automated: false
        }
      ]
  }
}

/**
 * Generate diagnostic information for a failure
 */
function generateDiagnosticInfo(
  failureType: DiarizationFailureType,
  technicalDetails?: DiarizationFailure['technicalDetails']
): string {
  const lines: string[] = [
    `Failure Type: ${failureType}`,
    `Timestamp: ${new Date().toISOString()}`,
    `Platform: ${process.platform}`,
    `Node Version: ${process.version}`
  ]

  if (technicalDetails?.errorCode) {
    lines.push(`Error Code: ${technicalDetails.errorCode}`)
  }
  if (technicalDetails?.errorMessage) {
    lines.push(`Error Message: ${technicalDetails.errorMessage}`)
  }
  if (technicalDetails?.pythonOutput) {
    lines.push(`Python Output: ${technicalDetails.pythonOutput.substring(0, 500)}`)
  }

  return lines.join('\n')
}

/**
 * Map error codes to failure types
 */
function mapErrorToFailureType(errorCode?: string, errorMessage?: string): DiarizationFailureType {
  if (!errorCode && !errorMessage) return 'unknown'

  const combined = `${errorCode || ''} ${errorMessage || ''}`.toLowerCase()

  // Check for authentication errors first (most common issue)
  if (
    combined.includes('could not download') ||
    combined.includes('authenticate') ||
    combined.includes('hf_token') ||
    combined.includes('hugging face') ||
    combined.includes('huggingface') ||
    combined.includes('gated') ||
    combined.includes('private') ||
    combined.includes('access token') ||
    combined.includes('401') ||
    combined.includes('403') ||
    combined.includes('unauthorized') ||
    combined.includes('forbidden') ||
    combined.includes('accept the license') ||
    combined.includes('hf.co/settings/tokens')
  ) {
    return 'authentication_required'
  }
  if (combined.includes('model') && combined.includes('not found')) {
    return 'model_not_found'
  }
  if (combined.includes('model') && (combined.includes('load') || combined.includes('initialize'))) {
    return 'model_not_loaded'
  }
  if (combined.includes('embedding')) {
    return 'embedding_extraction_failed'
  }
  if (combined.includes('cluster')) {
    return 'clustering_failed'
  }
  if (combined.includes('validation') || combined.includes('schema')) {
    return 'validation_failed'
  }
  if (combined.includes('insufficient') || combined.includes('too short')) {
    return 'insufficient_audio'
  }
  if (combined.includes('no speaker') || combined.includes('0 speakers')) {
    return 'no_speakers_detected'
  }
  if (combined.includes('timeout') || combined.includes('timed out')) {
    return 'timeout'
  }
  if (combined.includes('python')) {
    return 'python_not_available'
  }
  if (combined.includes('import') || combined.includes('module')) {
    return 'dependency_missing'
  }
  if (combined.includes('config')) {
    return 'configuration_error'
  }

  return 'unknown'
}

// ============================================================================
// Diarization Failure Service
// ============================================================================

export const diarizationFailureService = {
  /**
   * Record a diarization failure and generate user notification.
   *
   * CRITICAL: This MUST be called whenever diarization fails.
   * The system MUST NOT silently fall back to single-speaker mode.
   */
  recordFailure(params: {
    errorCode?: string
    errorMessage?: string
    meetingId?: string
    audioPath?: string
    pythonOutput?: string
    stackTrace?: string
  }): DiarizationFailure {
    const failureType = mapErrorToFailureType(params.errorCode, params.errorMessage)

    const failure: DiarizationFailure = {
      id: generateFailureId(),
      timestamp: Date.now(),
      type: failureType,
      severity: 'error',
      message: DIARIZATION_FAILURE_MESSAGE,
      diagnosticInfo: generateDiagnosticInfo(failureType, {
        errorCode: params.errorCode,
        errorMessage: params.errorMessage,
        pythonOutput: params.pythonOutput,
        stackTrace: params.stackTrace
      }),
      remediationSteps: getRemediationSteps(failureType),
      meetingId: params.meetingId,
      audioPath: params.audioPath,
      technicalDetails: {
        errorCode: params.errorCode,
        errorMessage: params.errorMessage,
        pythonOutput: params.pythonOutput,
        stackTrace: params.stackTrace
      },
      userNotified: false,
      acknowledged: false
    }

    // Add to failures list
    failures.push(failure)

    // Prune old failures
    if (failures.length > MAX_FAILURES_IN_MEMORY) {
      failures.splice(0, failures.length - MAX_FAILURES_IN_MEMORY)
    }

    // Log the failure
    console.error('[DiarizationFailure] FAILURE RECORDED:', {
      id: failure.id,
      type: failureType,
      message: failure.message
    })

    // Emit failure event
    eventEmitter.emit(FAILURE_EVENT, failure)

    return failure
  },

  /**
   * Generate a notification payload for the UI.
   *
   * CRITICAL: The prominentMessage MUST be displayed prominently to the user.
   */
  generateNotification(failure: DiarizationFailure): DiarizationFailureNotification {
    const notification: DiarizationFailureNotification = {
      prominentMessage: DIARIZATION_FAILURE_MESSAGE,
      detailedMessage: this.getDetailedMessage(failure.type),
      diagnosticSummary: failure.diagnosticInfo,
      remediationSteps: failure.remediationSteps,
      showTranscriptionOnlyOption: true,
      timestamp: failure.timestamp,
      failureId: failure.id
    }

    // Mark as notified
    failure.userNotified = true

    // Emit notification event
    eventEmitter.emit(NOTIFICATION_EVENT, notification)

    console.log('[DiarizationFailure] Notification generated:', {
      failureId: failure.id,
      prominentMessage: notification.prominentMessage
    })

    return notification
  },

  /**
   * Get a detailed explanation for a failure type
   */
  getDetailedMessage(failureType: DiarizationFailureType): string {
    switch (failureType) {
      case 'model_not_found':
        return 'The speaker diarization model (pyannote.audio) could not be found. This model is required to identify different speakers in your audio.'

      case 'model_not_loaded':
        return 'The speaker diarization model failed to load into memory. This may be due to insufficient system resources or a corrupted installation.'

      case 'embedding_extraction_failed':
        return 'Failed to extract speaker voice embeddings from the audio. This can happen with very noisy audio or unsupported audio formats.'

      case 'clustering_failed':
        return 'The speaker clustering algorithm failed. This can occur when there is only one speaker or when voices are too similar to distinguish.'

      case 'validation_failed':
        return 'The diarization output did not pass validation. This is an internal error that should be reported.'

      case 'insufficient_audio':
        return 'The audio recording is too short for speaker diarization. At least 10 seconds of speech is needed.'

      case 'no_speakers_detected':
        return 'No speakers were detected in the audio. The recording may be silent, contain only noise, or have speech that is too quiet.'

      case 'timeout':
        return 'Speaker diarization timed out. This can happen with very long audio files or when system resources are limited.'

      case 'python_not_available':
        return 'Python is not available or not properly configured. Speaker diarization requires Python 3.10 or later.'

      case 'dependency_missing':
        return 'Required Python dependencies are missing. The diarization system needs pyannote.audio and speechbrain to function.'

      case 'configuration_error':
        return 'There is an error in the diarization configuration. Try resetting to default settings.'

      case 'authentication_required':
        return 'The speaker diarization model (pyannote/embedding) requires Hugging Face authentication. You need to: 1) Create a Hugging Face account, 2) Accept the model license at https://huggingface.co/pyannote/embedding, 3) Create an access token at https://huggingface.co/settings/tokens, and 4) Save your token in Meeting Notes Settings > Audio > Speaker Identification.'

      default:
        return 'An unexpected error occurred during speaker diarization. Please check the diagnostics for more information.'
    }
  },

  /**
   * Acknowledge a failure (user has seen and dismissed the notification)
   */
  acknowledgeFailure(failureId: string): boolean {
    const failure = failures.find(f => f.id === failureId)
    if (failure) {
      failure.acknowledged = true
      console.log('[DiarizationFailure] Failure acknowledged:', failureId)
      return true
    }
    return false
  },

  /**
   * Get recent failures
   */
  getRecentFailures(count: number = 10): DiarizationFailure[] {
    return failures.slice(-count)
  },

  /**
   * Get unacknowledged failures
   */
  getUnacknowledgedFailures(): DiarizationFailure[] {
    return failures.filter(f => !f.acknowledged)
  },

  /**
   * Get failure by ID
   */
  getFailureById(failureId: string): DiarizationFailure | undefined {
    return failures.find(f => f.id === failureId)
  },

  /**
   * Get the mandatory failure message
   */
  getFailureMessage(): string {
    return DIARIZATION_FAILURE_MESSAGE
  },

  /**
   * Check if there are any recent unacknowledged failures
   */
  hasUnacknowledgedFailures(): boolean {
    return failures.some(f => !f.acknowledged)
  },

  /**
   * Subscribe to failure events
   */
  onFailure(callback: (failure: DiarizationFailure) => void): () => void {
    eventEmitter.on(FAILURE_EVENT, callback)
    return () => eventEmitter.off(FAILURE_EVENT, callback)
  },

  /**
   * Subscribe to notification events
   */
  onNotification(callback: (notification: DiarizationFailureNotification) => void): () => void {
    eventEmitter.on(NOTIFICATION_EVENT, callback)
    return () => eventEmitter.off(NOTIFICATION_EVENT, callback)
  },

  /**
   * Clear all failures (for testing)
   */
  clear(): void {
    failures.length = 0
    console.log('[DiarizationFailure] All failures cleared')
  },

  /**
   * Get failure count
   */
  getFailureCount(): number {
    return failures.length
  },

  /**
   * Export failures as JSON for debugging
   */
  exportAsJson(): string {
    return JSON.stringify({
      exportedAt: Date.now(),
      failureCount: failures.length,
      failures: failures
    }, null, 2)
  },

  /**
   * Validate that diarization result is not a silent fallback.
   *
   * CRITICAL: Call this before accepting any diarization result.
   * Returns false if the result appears to be a silent fallback.
   */
  validateNotSilentFallback(result: {
    success: boolean
    segments?: any[]
    numSpeakers?: number
    speakers?: string[]
    error?: string
  }): { valid: boolean; reason?: string } {
    // If explicitly failed, it's not a silent fallback (failure was explicit)
    if (!result.success && result.error) {
      return { valid: true }
    }

    // Check for empty or missing segments
    if (!result.segments || result.segments.length === 0) {
      return {
        valid: false,
        reason: 'No speaker segments produced - possible silent fallback'
      }
    }

    // Check for single "Unknown Speaker" fallback
    if (
      result.speakers?.length === 1 &&
      (result.speakers[0].toLowerCase().includes('unknown') ||
       result.speakers[0].toLowerCase().includes('speaker_0'))
    ) {
      return {
        valid: false,
        reason: 'Single "Unknown Speaker" detected - possible silent fallback'
      }
    }

    // Check for all segments having same speaker (possible fallback)
    const uniqueSpeakers = new Set(result.segments.map((s: any) => s.speaker || s.speaker_id))
    if (uniqueSpeakers.size === 1 && result.segments.length > 10) {
      return {
        valid: false,
        reason: 'All segments assigned to single speaker - possible silent fallback'
      }
    }

    return { valid: true }
  }
}

// Export types
export type { DiarizationFailure, DiarizationFailureNotification, DiarizationPreference }
