/**
 * Stepped Environment Setup Component
 *
 * A progressive, stepped approach to Python environment setup that:
 * - Shows progress through individual setup stages
 * - Explains what's happening at each stage
 * - Allows users to retry failed steps individually
 * - Provides a 'Skip for now' option with clear consequences
 *
 * This replaces the all-or-nothing approach with progressive disclosure
 * to reduce cognitive load and provide clear recovery paths.
 */

import { useState, useEffect, useCallback, useRef } from 'react'
import { cn } from '@/lib/utils'
import {
  CheckCircle,
  XCircle,
  AlertCircle,
  Loader2,
  Play,
  Square,
  RefreshCw,
  Clock,
  ChevronRight,
  ChevronDown,
  Terminal,
  AlertTriangle,
  HelpCircle,
  Info,
  RotateCcw,
  Zap,
  Shield,
  X
} from 'lucide-react'

// ============================================================================
// Types
// ============================================================================

export interface SetupProgress {
  step: string
  percentage: number
  message: string
  estimatedTime?: string
  timestamp: string
  type: 'progress' | 'success' | 'error' | 'warning' | 'step_complete' | 'complete' | 'remediation'
  code?: number
  remediationSteps?: string[]
}

export interface SetupResult {
  success: boolean
  error?: string
  exitCode: number
  duration: number
  metadata?: EnvironmentMetadata
  remediationSteps?: string[]
}

export interface EnvironmentMetadata {
  schemaVersion: number
  createdAt: string
  updatedAt: string
  environments: {
    whisperx: {
      path: string
      pythonVersion: string
      packages: Record<string, string>
      status: string
    }
    pyannote: {
      path: string
      pythonVersion: string
      packages: Record<string, string>
      status: string
    }
  }
  models: {
    downloaded: boolean
    hfTokenConfigured: boolean
  }
}

interface SetupStepConfig {
  id: string
  name: string
  description: string
  explanation: string
  estimatedTime?: string
  isOptional?: boolean
  canRetry?: boolean
  skipConsequence?: string
}

type StepStatus = 'pending' | 'running' | 'completed' | 'error' | 'warning' | 'skipped'

interface StepState {
  status: StepStatus
  error?: string
  remediationSteps?: string[]
  startTime?: number
  endTime?: number
  retryCount: number
}

export interface SteppedEnvironmentSetupProps {
  /** Whether to auto-start setup on mount */
  autoStart?: boolean
  /** Whether to show skip option */
  showSkip?: boolean
  /** Called when setup completes successfully */
  onComplete?: (result: SetupResult) => void
  /** Called when user skips setup */
  onSkip?: () => void
  /** Called when setup fails */
  onError?: (error: string, remediationSteps?: string[]) => void
  /** Optional HuggingFace token */
  hfToken?: string
  /** Whether to skip model download */
  skipModels?: boolean
  /** Whether to force recreate environments */
  force?: boolean
}

// ============================================================================
// Setup Steps Configuration
// ============================================================================

const SETUP_STEPS: SetupStepConfig[] = [
  {
    id: 'detect_python',
    name: 'Detect Python',
    description: 'Finding Python 3.12 installation',
    explanation: 'We need Python 3.12 to run machine learning models. This step locates Python on your system.',
    estimatedTime: '~10 seconds',
    canRetry: true,
    skipConsequence: 'Cannot proceed without Python detection'
  },
  {
    id: 'check_deps',
    name: 'Check Dependencies',
    description: 'Verifying system requirements',
    explanation: 'Checking that all required system libraries and tools are available.',
    estimatedTime: '~5 seconds',
    canRetry: true,
    skipConsequence: 'Missing dependencies may cause later failures'
  },
  {
    id: 'create_venv-whisperx',
    name: 'Create WhisperX Environment',
    description: 'Creating isolated Python environment',
    explanation: 'Creating a dedicated Python environment for the WhisperX transcription engine to avoid conflicts.',
    estimatedTime: '~30 seconds',
    canRetry: true
  },
  {
    id: 'install_venv-whisperx',
    name: 'Install WhisperX',
    description: 'Installing transcription dependencies',
    explanation: 'Installing WhisperX and its dependencies (PyTorch, Transformers, etc.) for speech-to-text.',
    estimatedTime: '5-10 minutes',
    canRetry: true
  },
  {
    id: 'verify_venv-whisperx',
    name: 'Verify WhisperX',
    description: 'Testing installation',
    explanation: 'Running a quick test to ensure WhisperX is installed correctly and can load.',
    estimatedTime: '~30 seconds',
    canRetry: true
  },
  {
    id: 'create_venv-pyannote',
    name: 'Create Pyannote Environment',
    description: 'Creating diarization environment',
    explanation: 'Creating a separate Python environment for Pyannote speaker diarization to avoid torch version conflicts.',
    estimatedTime: '~30 seconds',
    canRetry: true
  },
  {
    id: 'install_venv-pyannote',
    name: 'Install Pyannote',
    description: 'Installing diarization dependencies',
    explanation: 'Installing Pyannote Audio for speaker identification (who said what).',
    estimatedTime: '5-10 minutes',
    canRetry: true
  },
  {
    id: 'verify_venv-pyannote',
    name: 'Verify Pyannote',
    description: 'Testing installation',
    explanation: 'Running a quick test to ensure Pyannote is installed correctly.',
    estimatedTime: '~30 seconds',
    canRetry: true
  },
  {
    id: 'download_models',
    name: 'Download Models',
    description: 'Getting ML models',
    explanation: 'Downloading the machine learning models needed for transcription and speaker identification.',
    estimatedTime: '10-20 minutes',
    isOptional: true,
    canRetry: true,
    skipConsequence: 'Models will download automatically on first use (may cause delay)'
  },
  {
    id: 'generate_metadata',
    name: 'Finalize Setup',
    description: 'Saving configuration',
    explanation: 'Saving environment information so we can verify everything works on startup.',
    estimatedTime: '~5 seconds',
    canRetry: true
  }
]

// ============================================================================
// Skip Consequences Modal
// ============================================================================

interface SkipConsequencesModalProps {
  isOpen: boolean
  onClose: () => void
  onConfirmSkip: () => void
}

function SkipConsequencesModal({ isOpen, onClose, onConfirmSkip }: SkipConsequencesModalProps) {
  if (!isOpen) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="bg-card border border-border rounded-lg shadow-xl max-w-lg w-full mx-4 overflow-hidden">
        <div className="px-6 py-4 border-b border-border flex items-center justify-between">
          <h3 className="text-lg font-semibold text-foreground flex items-center gap-2">
            <AlertTriangle className="h-5 w-5 text-amber-500" />
            Skip Environment Setup?
          </h3>
          <button
            onClick={onClose}
            className="text-muted-foreground hover:text-foreground"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="px-6 py-4 space-y-4">
          <p className="text-muted-foreground">
            Skipping Python environment setup will affect the following features:
          </p>

          <div className="space-y-3">
            <div className="flex items-start gap-3 p-3 bg-red-50 dark:bg-red-950/30 rounded-lg border border-red-200 dark:border-red-800">
              <XCircle className="h-5 w-5 text-red-500 mt-0.5 flex-shrink-0" />
              <div>
                <p className="font-medium text-red-900 dark:text-red-200">Transcription Unavailable</p>
                <p className="text-sm text-red-700 dark:text-red-300">
                  Meeting recordings cannot be converted to text without WhisperX.
                </p>
              </div>
            </div>

            <div className="flex items-start gap-3 p-3 bg-red-50 dark:bg-red-950/30 rounded-lg border border-red-200 dark:border-red-800">
              <XCircle className="h-5 w-5 text-red-500 mt-0.5 flex-shrink-0" />
              <div>
                <p className="font-medium text-red-900 dark:text-red-200">Speaker Identification Unavailable</p>
                <p className="text-sm text-red-700 dark:text-red-300">
                  Cannot identify who said what without Pyannote speaker diarization.
                </p>
              </div>
            </div>

            <div className="flex items-start gap-3 p-3 bg-amber-50 dark:bg-amber-950/30 rounded-lg border border-amber-200 dark:border-amber-800">
              <AlertCircle className="h-5 w-5 text-amber-500 mt-0.5 flex-shrink-0" />
              <div>
                <p className="font-medium text-amber-900 dark:text-amber-200">Limited Functionality</p>
                <p className="text-sm text-amber-700 dark:text-amber-300">
                  You can still record meetings and manage audio files, but automated
                  transcription and AI-powered features will not work.
                </p>
              </div>
            </div>
          </div>

          <div className="flex items-start gap-2 p-3 bg-blue-50 dark:bg-blue-950/30 rounded-lg border border-blue-200 dark:border-blue-800">
            <Info className="h-5 w-5 text-blue-500 mt-0.5 flex-shrink-0" />
            <p className="text-sm text-blue-700 dark:text-blue-300">
              You can run the setup later from <strong>Settings → Python Environment</strong>.
            </p>
          </div>
        </div>

        <div className="px-6 py-4 border-t border-border flex items-center justify-end gap-3">
          <button
            onClick={onClose}
            className="px-4 py-2 border border-border rounded-md hover:bg-accent text-foreground font-medium"
          >
            Go Back to Setup
          </button>
          <button
            onClick={onConfirmSkip}
            className="px-4 py-2 bg-amber-600 hover:bg-amber-700 text-white rounded-md font-medium"
          >
            Skip Anyway
          </button>
        </div>
      </div>
    </div>
  )
}

// ============================================================================
// Step Detail Panel
// ============================================================================

interface StepDetailPanelProps {
  step: SetupStepConfig
  state: StepState
  isExpanded: boolean
  onToggle: () => void
  onRetry: () => void
  isCurrentStep: boolean
  canRetryIndividually: boolean
}

function StepDetailPanel({
  step,
  state,
  isExpanded,
  onToggle,
  onRetry,
  isCurrentStep,
  canRetryIndividually
}: StepDetailPanelProps) {
  const statusIcon = {
    pending: <div className="w-6 h-6 rounded-full border-2 border-gray-300 dark:border-gray-600" />,
    running: <Loader2 className="h-6 w-6 text-purple-600 animate-spin" />,
    completed: <CheckCircle className="h-6 w-6 text-green-600" />,
    error: <XCircle className="h-6 w-6 text-red-600" />,
    warning: <AlertCircle className="h-6 w-6 text-amber-600" />,
    skipped: <div className="w-6 h-6 rounded-full border-2 border-gray-300 dark:border-gray-600 bg-gray-100 dark:bg-gray-700" />
  }

  const statusBg = {
    pending: '',
    running: 'bg-purple-50/50 dark:bg-purple-950/20 border-purple-200 dark:border-purple-800',
    completed: 'bg-green-50/30 dark:bg-green-950/10',
    error: 'bg-red-50/30 dark:bg-red-950/10 border-red-200 dark:border-red-800',
    warning: 'bg-amber-50/30 dark:bg-amber-950/10 border-amber-200 dark:border-amber-800',
    skipped: 'bg-gray-50/30 dark:bg-gray-800/30'
  }

  return (
    <div
      className={cn(
        'border border-border rounded-lg overflow-hidden transition-all',
        statusBg[state.status]
      )}
    >
      {/* Step Header */}
      <button
        onClick={onToggle}
        className={cn(
          'w-full px-4 py-3 flex items-center gap-4 text-left hover:bg-accent/50 transition-colors',
          isCurrentStep && 'bg-accent/30'
        )}
      >
        <div className="flex-shrink-0">
          {statusIcon[state.status]}
        </div>

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <p className={cn(
              'font-medium',
              state.status === 'pending' ? 'text-muted-foreground' : 'text-foreground'
            )}>
              {step.name}
            </p>
            {step.isOptional && (
              <span className="text-xs px-1.5 py-0.5 bg-gray-100 dark:bg-gray-800 rounded text-muted-foreground">
                Optional
              </span>
            )}
          </div>
          <p className="text-sm text-muted-foreground truncate">
            {step.description}
          </p>
        </div>

        <div className="flex items-center gap-2">
          {state.status === 'pending' && step.estimatedTime && (
            <span className="text-xs text-muted-foreground flex items-center gap-1">
              <Clock className="h-3 w-3" />
              {step.estimatedTime}
            </span>
          )}
          {state.status === 'running' && state.startTime && (
            <span className="text-xs text-purple-600 flex items-center gap-1">
              <Clock className="h-3 w-3" />
              Running...
            </span>
          )}
          {state.retryCount > 0 && (
            <span className="text-xs text-muted-foreground flex items-center gap-1">
              <RotateCcw className="h-3 w-3" />
              Retry #{state.retryCount}
            </span>
          )}
          <ChevronDown
            className={cn(
              'h-4 w-4 text-muted-foreground transition-transform',
              isExpanded && 'rotate-180'
            )}
          />
        </div>
      </button>

      {/* Expanded Content */}
      {isExpanded && (
        <div className="px-4 pb-4 pt-2 space-y-3 border-t border-border">
          {/* Explanation */}
          <div className="flex items-start gap-2">
            <HelpCircle className="h-4 w-4 text-blue-500 mt-0.5 flex-shrink-0" />
            <p className="text-sm text-muted-foreground">
              {step.explanation}
            </p>
          </div>

          {/* Error Display */}
          {state.status === 'error' && state.error && (
            <div className="p-3 bg-red-50 dark:bg-red-950/30 rounded-lg border border-red-200 dark:border-red-800">
              <p className="text-sm text-red-700 dark:text-red-300 font-medium mb-1">
                Error:
              </p>
              <p className="text-sm text-red-600 dark:text-red-400">
                {state.error}
              </p>

              {state.remediationSteps && state.remediationSteps.length > 0 && (
                <div className="mt-3">
                  <p className="text-sm font-medium text-red-700 dark:text-red-300 mb-1">
                    Try these steps:
                  </p>
                  <ul className="space-y-1">
                    {state.remediationSteps.map((rs, index) => (
                      <li key={index} className="text-sm text-red-600 dark:text-red-400 flex items-start gap-2">
                        <ChevronRight className="h-4 w-4 mt-0.5 flex-shrink-0" />
                        {rs}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          )}

          {/* Retry Button */}
          {state.status === 'error' && canRetryIndividually && step.canRetry && (
            <button
              onClick={(e) => {
                e.stopPropagation()
                onRetry()
              }}
              className="px-4 py-2 bg-purple-600 hover:bg-purple-700 text-white rounded-md text-sm font-medium flex items-center gap-2"
            >
              <RefreshCw className="h-4 w-4" />
              Retry This Step
            </button>
          )}

          {/* Skip Consequence Warning */}
          {step.isOptional && step.skipConsequence && state.status === 'pending' && (
            <div className="flex items-start gap-2 text-sm text-amber-600 dark:text-amber-400">
              <AlertTriangle className="h-4 w-4 mt-0.5 flex-shrink-0" />
              <p>If skipped: {step.skipConsequence}</p>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// ============================================================================
// Main Component
// ============================================================================

export function SteppedEnvironmentSetup({
  autoStart = false,
  showSkip = true,
  onComplete,
  onSkip,
  onError,
  hfToken,
  skipModels = false,
  force = false
}: SteppedEnvironmentSetupProps) {
  const [overallStatus, setOverallStatus] = useState<'idle' | 'running' | 'completed' | 'error' | 'paused'>('idle')
  const [overallProgress, setOverallProgress] = useState(0)
  const [currentMessage, setCurrentMessage] = useState('')
  const [stepStates, setStepStates] = useState<Record<string, StepState>>(() => {
    const initial: Record<string, StepState> = {}
    for (const step of SETUP_STEPS) {
      initial[step.id] = { status: 'pending', retryCount: 0 }
    }
    return initial
  })
  const [expandedStep, setExpandedStep] = useState<string | null>(null)
  const [currentStepId, setCurrentStepId] = useState<string | null>(null)
  const [result, setResult] = useState<SetupResult | null>(null)
  const [showSkipModal, setShowSkipModal] = useState(false)
  const [showLogs, setShowLogs] = useState(false)
  const [logs, setLogs] = useState<string[]>([])
  const [elapsedTime, setElapsedTime] = useState(0)

  const startTimeRef = useRef<number | null>(null)
  const timerRef = useRef<NodeJS.Timeout | null>(null)

  // Update elapsed time
  useEffect(() => {
    if (overallStatus === 'running' && startTimeRef.current) {
      timerRef.current = setInterval(() => {
        setElapsedTime(Math.floor((Date.now() - startTimeRef.current!) / 1000))
      }, 1000)
    } else {
      if (timerRef.current) {
        clearInterval(timerRef.current)
        timerRef.current = null
      }
    }

    return () => {
      if (timerRef.current) {
        clearInterval(timerRef.current)
      }
    }
  }, [overallStatus])

  // Format elapsed time
  const formatTime = (seconds: number): string => {
    const mins = Math.floor(seconds / 60)
    const secs = seconds % 60
    if (mins > 0) {
      return `${mins}m ${secs}s`
    }
    return `${secs}s`
  }

  // Handle progress updates
  const handleProgress = useCallback((progressData: SetupProgress) => {
    setOverallProgress(progressData.percentage)
    setCurrentMessage(progressData.message)

    // Add to logs
    const logEntry = `[${new Date(progressData.timestamp).toLocaleTimeString()}] ${progressData.message}`
    setLogs(prev => [...prev, logEntry])

    // Update step status
    const stepId = progressData.step
    if (stepId) {
      setCurrentStepId(stepId)

      setStepStates(prev => {
        const updated = { ...prev }

        // Find matching step
        for (const step of SETUP_STEPS) {
          if (step.id === stepId || step.id.includes(stepId) || stepId.includes(step.id)) {
            const currentState = prev[step.id] || { status: 'pending', retryCount: 0 }

            if (progressData.type === 'step_complete') {
              updated[step.id] = { ...currentState, status: 'completed', endTime: Date.now() }
            } else if (progressData.type === 'error') {
              updated[step.id] = {
                ...currentState,
                status: 'error',
                error: progressData.message,
                remediationSteps: progressData.remediationSteps,
                endTime: Date.now()
              }
              // Auto-expand failed step
              setExpandedStep(step.id)
            } else if (progressData.type === 'warning') {
              updated[step.id] = { ...currentState, status: 'warning' }
            } else if (currentState.status === 'pending') {
              updated[step.id] = { ...currentState, status: 'running', startTime: Date.now() }
            }
            break
          }
        }

        return updated
      })
    }
  }, [])

  // Start setup
  const startSetup = useCallback(async () => {
    setOverallStatus('running')
    setOverallProgress(0)
    setCurrentMessage('Starting setup...')
    setResult(null)
    setLogs([])

    // Reset step states
    const resetStates: Record<string, StepState> = {}
    for (const step of SETUP_STEPS) {
      resetStates[step.id] = { status: 'pending', retryCount: 0 }
    }
    setStepStates(resetStates)

    startTimeRef.current = Date.now()

    try {
      // Check if API is available
      if (!window.electronAPI?.pythonSetup) {
        throw new Error('Python setup API not available')
      }

      // Subscribe to progress events
      const unsubscribe = window.electronAPI.pythonSetup.onProgress(handleProgress)

      // Run setup
      const setupResult = await window.electronAPI.pythonSetup.runSetup({
        skipModels,
        force,
        hfToken
      })

      // Unsubscribe from progress events
      unsubscribe()

      // Cast to the correct type
      const typedResult: SetupResult = {
        success: setupResult.success,
        error: setupResult.error,
        exitCode: setupResult.exitCode,
        duration: setupResult.duration,
        metadata: setupResult.metadata as EnvironmentMetadata | undefined,
        remediationSteps: setupResult.remediationSteps
      }

      setResult(typedResult)

      if (typedResult.success) {
        setOverallStatus('completed')
        setOverallProgress(100)
        setCurrentMessage('Setup completed successfully!')

        // Mark all steps as completed
        setStepStates(prev => {
          const updated = { ...prev }
          for (const step of SETUP_STEPS) {
            if (updated[step.id].status !== 'error') {
              updated[step.id] = { ...updated[step.id], status: 'completed' }
            }
          }
          return updated
        })

        onComplete?.(typedResult)
      } else {
        setOverallStatus('error')
        onError?.(typedResult.error || 'Setup failed', typedResult.remediationSteps)
      }
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Unknown error'
      setOverallStatus('error')
      setCurrentMessage(errorMessage)
      onError?.(errorMessage)
    }
  }, [skipModels, force, hfToken, handleProgress, onComplete, onError])

  // Cancel setup
  const cancelSetup = useCallback(async () => {
    try {
      await window.electronAPI?.pythonSetup?.cancelSetup()
      setOverallStatus('paused')
      setCurrentMessage('Setup paused')
    } catch (err) {
      console.error('Failed to cancel setup:', err)
    }
  }, [])

  // Retry individual step (currently triggers full retry from that point)
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const retryFromStep = useCallback(async (_stepId: string) => {
    // For now, retry means restarting the whole setup
    // In future, could implement partial retry logic starting from _stepId
    await startSetup()
  }, [startSetup])

  // Handle skip
  const handleSkip = useCallback(() => {
    setShowSkipModal(true)
  }, [])

  const confirmSkip = useCallback(() => {
    setShowSkipModal(false)
    onSkip?.()
  }, [onSkip])

  // Auto-start
  useEffect(() => {
    if (autoStart && overallStatus === 'idle') {
      startSetup()
    }
  }, [autoStart, overallStatus, startSetup])

  // Calculate completed steps
  const completedSteps = SETUP_STEPS.filter(s => stepStates[s.id]?.status === 'completed').length
  const failedSteps = SETUP_STEPS.filter(s => stepStates[s.id]?.status === 'error').length

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-xl font-bold text-foreground flex items-center gap-2">
              <Zap className="h-5 w-5 text-purple-600" />
              Python Environment Setup
            </h2>
            <p className="text-sm text-muted-foreground mt-1">
              Setting up transcription and speaker identification capabilities
            </p>
          </div>
          {overallStatus === 'running' && (
            <div className="text-right">
              <div className="text-sm font-medium text-foreground">
                Step {completedSteps + 1} of {SETUP_STEPS.length}
              </div>
              <div className="text-xs text-muted-foreground">
                Elapsed: {formatTime(elapsedTime)}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Overall Progress */}
      <div className="space-y-2">
        <div className="flex items-center justify-between text-sm">
          <span className="text-muted-foreground">
            {currentMessage || 'Ready to start'}
          </span>
          <span className="font-medium">{overallProgress}%</span>
        </div>
        <div className="h-2 bg-secondary rounded-full overflow-hidden">
          <div
            className={cn(
              'h-full transition-all duration-500',
              overallStatus === 'completed' ? 'bg-green-500' :
              overallStatus === 'error' ? 'bg-red-500' :
              'bg-purple-600'
            )}
            style={{ width: `${overallProgress}%` }}
          />
        </div>
        <div className="flex items-center justify-between text-xs text-muted-foreground">
          <span>{completedSteps} steps completed</span>
          {failedSteps > 0 && (
            <span className="text-red-600">{failedSteps} step(s) failed</span>
          )}
        </div>
      </div>

      {/* Feature Benefits (shown when idle) */}
      {overallStatus === 'idle' && (
        <div className="bg-gradient-to-br from-purple-50 to-blue-50 dark:from-purple-950/30 dark:to-blue-950/30 border border-purple-200 dark:border-purple-800 rounded-lg p-4">
          <h3 className="font-medium text-foreground mb-3 flex items-center gap-2">
            <Shield className="h-4 w-4 text-purple-600" />
            What this setup enables:
          </h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div className="flex items-start gap-2">
              <CheckCircle className="h-4 w-4 text-green-600 mt-0.5 flex-shrink-0" />
              <span className="text-sm text-muted-foreground">
                <strong className="text-foreground">Automatic Transcription</strong> - Convert speech to text
              </span>
            </div>
            <div className="flex items-start gap-2">
              <CheckCircle className="h-4 w-4 text-green-600 mt-0.5 flex-shrink-0" />
              <span className="text-sm text-muted-foreground">
                <strong className="text-foreground">Speaker Identification</strong> - Know who said what
              </span>
            </div>
            <div className="flex items-start gap-2">
              <CheckCircle className="h-4 w-4 text-green-600 mt-0.5 flex-shrink-0" />
              <span className="text-sm text-muted-foreground">
                <strong className="text-foreground">AI Meeting Notes</strong> - Automated summaries
              </span>
            </div>
            <div className="flex items-start gap-2">
              <CheckCircle className="h-4 w-4 text-green-600 mt-0.5 flex-shrink-0" />
              <span className="text-sm text-muted-foreground">
                <strong className="text-foreground">Action Item Extraction</strong> - Never miss tasks
              </span>
            </div>
          </div>
        </div>
      )}

      {/* Steps List */}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <h3 className="font-medium text-foreground">Setup Steps</h3>
          <button
            onClick={() => setShowLogs(!showLogs)}
            className="text-sm text-muted-foreground hover:text-foreground flex items-center gap-1"
          >
            <Terminal className="h-4 w-4" />
            {showLogs ? 'Hide' : 'Show'} Logs
          </button>
        </div>

        {showLogs ? (
          <div className="max-h-64 overflow-auto bg-gray-900 rounded-lg p-4">
            <pre className="text-xs text-green-400 font-mono whitespace-pre-wrap">
              {logs.length > 0 ? logs.join('\n') : 'No logs yet...'}
            </pre>
          </div>
        ) : (
          <div className="space-y-2">
            {SETUP_STEPS.map((step) => (
              <StepDetailPanel
                key={step.id}
                step={step}
                state={stepStates[step.id] || { status: 'pending', retryCount: 0 }}
                isExpanded={expandedStep === step.id}
                onToggle={() => setExpandedStep(expandedStep === step.id ? null : step.id)}
                onRetry={() => retryFromStep(step.id)}
                isCurrentStep={currentStepId === step.id}
                canRetryIndividually={overallStatus === 'error' || overallStatus === 'paused'}
              />
            ))}
          </div>
        )}
      </div>

      {/* Success Display */}
      {overallStatus === 'completed' && result && (
        <div className="bg-green-50 dark:bg-green-950/30 border border-green-200 dark:border-green-800 rounded-lg p-4">
          <div className="flex items-start gap-3">
            <CheckCircle className="h-5 w-5 text-green-600 flex-shrink-0 mt-0.5" />
            <div className="flex-1">
              <h4 className="font-medium text-green-900 dark:text-green-200">
                Setup Complete!
              </h4>
              <p className="text-sm text-green-700 dark:text-green-300 mt-1">
                Python environments are ready. Setup took {formatTime(Math.floor(result.duration / 1000))}.
              </p>
              {result.metadata && !result.metadata.models.hfTokenConfigured && (
                <p className="text-sm text-amber-600 dark:text-amber-400 mt-2">
                  Note: HuggingFace token not configured. Set it in Settings to enable speaker diarization.
                </p>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Action Buttons */}
      <div className="flex items-center justify-between">
        <div>
          {showSkip && (overallStatus === 'idle' || overallStatus === 'error' || overallStatus === 'paused') && (
            <button
              onClick={handleSkip}
              className="px-4 py-2 text-sm text-muted-foreground hover:text-foreground flex items-center gap-2"
            >
              <AlertTriangle className="h-4 w-4" />
              Skip for now
            </button>
          )}
        </div>

        <div className="flex items-center gap-3">
          {overallStatus === 'idle' && (
            <button
              onClick={startSetup}
              className="px-6 py-2.5 bg-purple-600 hover:bg-purple-700 text-white rounded-md font-medium flex items-center gap-2"
            >
              <Play className="h-4 w-4" />
              Start Setup
            </button>
          )}

          {overallStatus === 'running' && (
            <button
              onClick={cancelSetup}
              className="px-6 py-2.5 bg-amber-600 hover:bg-amber-700 text-white rounded-md font-medium flex items-center gap-2"
            >
              <Square className="h-4 w-4" />
              Pause
            </button>
          )}

          {(overallStatus === 'error' || overallStatus === 'paused') && (
            <button
              onClick={startSetup}
              className="px-6 py-2.5 bg-purple-600 hover:bg-purple-700 text-white rounded-md font-medium flex items-center gap-2"
            >
              <RefreshCw className="h-4 w-4" />
              {overallStatus === 'error' ? 'Retry Setup' : 'Resume Setup'}
            </button>
          )}

          {overallStatus === 'completed' && (
            <button
              onClick={() => onComplete?.(result!)}
              className="px-6 py-2.5 bg-green-600 hover:bg-green-700 text-white rounded-md font-medium flex items-center gap-2"
            >
              <CheckCircle className="h-4 w-4" />
              Continue
            </button>
          )}
        </div>
      </div>

      {/* Skip Consequences Modal */}
      <SkipConsequencesModal
        isOpen={showSkipModal}
        onClose={() => setShowSkipModal(false)}
        onConfirmSkip={confirmSkip}
      />
    </div>
  )
}

export default SteppedEnvironmentSetup
