/**
 * Python Environment Setup Component
 *
 * Provides a UI for automated Python environment setup with:
 * - Progress tracking with visual indicators
 * - Step-by-step status display
 * - Error handling with remediation steps
 * - Cancel functionality
 * - Skip option with warning
 *
 * Used in:
 * - SetupWizard (first-run experience)
 * - Settings page (Repair Environments option)
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
  Terminal,
  AlertTriangle
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

interface SetupStep {
  id: string
  name: string
  description: string
  estimatedTime?: string
  status: 'pending' | 'running' | 'completed' | 'error' | 'warning'
}

export interface PythonEnvironmentSetupProps {
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
  /** Compact mode for embedding in other components */
  compact?: boolean
}

// ============================================================================
// Setup Steps Definition
// ============================================================================

const SETUP_STEPS: SetupStep[] = [
  { id: 'detect_python', name: 'Detect Python', description: 'Finding Python 3.12', estimatedTime: '10s', status: 'pending' },
  { id: 'check_deps', name: 'Check Dependencies', description: 'Verifying system requirements', estimatedTime: '5s', status: 'pending' },
  { id: 'create_venv-whisperx', name: 'Create WhisperX Env', description: 'Creating transcription environment', estimatedTime: '30s', status: 'pending' },
  { id: 'install_venv-whisperx', name: 'Install WhisperX', description: 'Installing transcription packages', estimatedTime: '5-10 min', status: 'pending' },
  { id: 'verify_venv-whisperx', name: 'Verify WhisperX', description: 'Testing installation', estimatedTime: '30s', status: 'pending' },
  { id: 'create_venv-pyannote', name: 'Create Pyannote Env', description: 'Creating diarization environment', estimatedTime: '30s', status: 'pending' },
  { id: 'install_venv-pyannote', name: 'Install Pyannote', description: 'Installing diarization packages', estimatedTime: '5-10 min', status: 'pending' },
  { id: 'verify_venv-pyannote', name: 'Verify Pyannote', description: 'Testing installation', estimatedTime: '30s', status: 'pending' },
  { id: 'download_models', name: 'Download Models', description: 'Getting ML models', estimatedTime: '10-20 min', status: 'pending' },
  { id: 'generate_metadata', name: 'Save Config', description: 'Saving environment info', estimatedTime: '5s', status: 'pending' },
]

// ============================================================================
// Component
// ============================================================================

export function PythonEnvironmentSetup({
  autoStart = false,
  showSkip = true,
  onComplete,
  onSkip,
  onError,
  hfToken,
  skipModels = false,
  force = false,
  compact = false
}: PythonEnvironmentSetupProps) {
  const [status, setStatus] = useState<'idle' | 'running' | 'completed' | 'error'>('idle')
  const [progress, setProgress] = useState(0)
  const [currentMessage, setCurrentMessage] = useState('')
  const [steps, setSteps] = useState<SetupStep[]>([...SETUP_STEPS])
  const [error, setError] = useState<string | null>(null)
  const [remediationSteps, setRemediationSteps] = useState<string[]>([])
  const [result, setResult] = useState<SetupResult | null>(null)
  const [showLogs, setShowLogs] = useState(false)
  const [logs, setLogs] = useState<string[]>([])
  const [elapsedTime, setElapsedTime] = useState(0)
  const [estimatedTime, setEstimatedTime] = useState<string | null>(null)

  const startTimeRef = useRef<number | null>(null)
  const timerRef = useRef<NodeJS.Timeout | null>(null)

  // Update elapsed time
  useEffect(() => {
    if (status === 'running' && startTimeRef.current) {
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
  }, [status])

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
    setProgress(progressData.percentage)
    setCurrentMessage(progressData.message)

    if (progressData.estimatedTime) {
      setEstimatedTime(progressData.estimatedTime)
    }

    // Add to logs
    const logEntry = `[${new Date(progressData.timestamp).toLocaleTimeString()}] ${progressData.message}`
    setLogs(prev => [...prev, logEntry])

    // Update step status
    const stepId = progressData.step
    if (stepId) {
      setSteps(prev => prev.map(step => {
        if (step.id === stepId || step.id.includes(stepId) || stepId.includes(step.id)) {
          if (progressData.type === 'step_complete') {
            return { ...step, status: 'completed' }
          } else if (progressData.type === 'error') {
            return { ...step, status: 'error' }
          } else if (progressData.type === 'warning') {
            return { ...step, status: 'warning' }
          } else {
            return { ...step, status: 'running' }
          }
        }
        return step
      }))
    }

    // Handle remediation steps
    if (progressData.remediationSteps) {
      setRemediationSteps(progressData.remediationSteps)
    }
  }, [])

  // Start setup
  const startSetup = useCallback(async () => {
    setStatus('running')
    setProgress(0)
    setCurrentMessage('Starting setup...')
    setError(null)
    setRemediationSteps([])
    setResult(null)
    setLogs([])
    setSteps([...SETUP_STEPS])
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
        setStatus('completed')
        setProgress(100)
        setCurrentMessage('Setup completed successfully!')
        setSteps(prev => prev.map(step => ({ ...step, status: 'completed' })))
        onComplete?.(typedResult)
      } else {
        setStatus('error')
        setError(typedResult.error || 'Setup failed')
        if (typedResult.remediationSteps) {
          setRemediationSteps(typedResult.remediationSteps)
        }
        onError?.(typedResult.error || 'Setup failed', typedResult.remediationSteps)
      }
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Unknown error'
      setStatus('error')
      setError(errorMessage)
      setRemediationSteps([
        'Check that Python 3.12 is installed',
        'Ensure you have internet connection for package downloads',
        'Try running the setup manually from the terminal'
      ])
      onError?.(errorMessage)
    }
  }, [skipModels, force, hfToken, handleProgress, onComplete, onError])

  // Cancel setup
  const cancelSetup = useCallback(async () => {
    try {
      await window.electronAPI?.pythonSetup?.cancelSetup()
      setStatus('idle')
      setCurrentMessage('Setup cancelled')
    } catch (err) {
      console.error('Failed to cancel setup:', err)
    }
  }, [])

  // Auto-start
  useEffect(() => {
    if (autoStart && status === 'idle') {
      startSetup()
    }
  }, [autoStart, status, startSetup])

  // ============================================================================
  // Render
  // ============================================================================

  if (compact) {
    return (
      <CompactSetupView
        status={status}
        progress={progress}
        message={currentMessage}
        error={error}
        elapsedTime={formatTime(elapsedTime)}
        onStart={startSetup}
        onCancel={cancelSetup}
        onRetry={startSetup}
      />
    )
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-xl font-bold text-foreground">Python Environment Setup</h2>
            <p className="text-sm text-muted-foreground">
              Setting up transcription and speaker diarization capabilities
            </p>
          </div>
          {status === 'running' && (
            <div className="text-right">
              <div className="text-sm text-muted-foreground">Elapsed: {formatTime(elapsedTime)}</div>
              {estimatedTime && (
                <div className="text-xs text-muted-foreground">Est. remaining: {estimatedTime}</div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Progress Bar */}
      <div className="space-y-2">
        <div className="flex items-center justify-between text-sm">
          <span className="text-muted-foreground">{currentMessage || 'Ready to start'}</span>
          <span className="font-medium">{progress}%</span>
        </div>
        <div className="h-3 bg-secondary rounded-full overflow-hidden">
          <div
            className={cn(
              'h-full transition-all duration-300',
              status === 'completed' ? 'bg-green-500' :
              status === 'error' ? 'bg-red-500' :
              'bg-purple-600'
            )}
            style={{ width: `${progress}%` }}
          />
        </div>
      </div>

      {/* Steps */}
      <div className="bg-card border border-border rounded-lg overflow-hidden">
        <div className="px-4 py-3 border-b border-border flex items-center justify-between">
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
          <div className="max-h-64 overflow-auto bg-gray-900 p-4">
            <pre className="text-xs text-green-400 font-mono whitespace-pre-wrap">
              {logs.length > 0 ? logs.join('\n') : 'No logs yet...'}
            </pre>
          </div>
        ) : (
          <div className="divide-y divide-border">
            {steps.map((step) => (
              <StepRow key={step.id} step={step} />
            ))}
          </div>
        )}
      </div>

      {/* Error Display */}
      {error && (
        <div className="bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-800 rounded-lg p-4">
          <div className="flex items-start gap-3">
            <XCircle className="h-5 w-5 text-red-600 dark:text-red-400 flex-shrink-0 mt-0.5" />
            <div className="flex-1">
              <h4 className="font-medium text-red-900 dark:text-red-200">Setup Failed</h4>
              <p className="text-sm text-red-700 dark:text-red-300 mt-1">{error}</p>

              {remediationSteps.length > 0 && (
                <div className="mt-3">
                  <p className="text-sm font-medium text-red-900 dark:text-red-200 mb-2">
                    Try these steps to fix the issue:
                  </p>
                  <ul className="space-y-1">
                    {remediationSteps.map((step, index) => (
                      <li key={index} className="text-sm text-red-700 dark:text-red-300 flex items-start gap-2">
                        <ChevronRight className="h-4 w-4 mt-0.5 flex-shrink-0" />
                        {step}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Success Display */}
      {status === 'completed' && result && (
        <div className="bg-green-50 dark:bg-green-950/30 border border-green-200 dark:border-green-800 rounded-lg p-4">
          <div className="flex items-start gap-3">
            <CheckCircle className="h-5 w-5 text-green-600 dark:text-green-400 flex-shrink-0 mt-0.5" />
            <div className="flex-1">
              <h4 className="font-medium text-green-900 dark:text-green-200">Setup Complete!</h4>
              <p className="text-sm text-green-700 dark:text-green-300 mt-1">
                Python environments are ready. Setup took {formatTime(Math.floor(result.duration / 1000))}.
              </p>

              {result.metadata && (
                <div className="mt-3 text-sm text-green-700 dark:text-green-300">
                  <p>WhisperX: torch {result.metadata.environments.whisperx.packages.torch}</p>
                  <p>Pyannote: torch {result.metadata.environments.pyannote.packages.torch}</p>
                  {!result.metadata.models.hfTokenConfigured && (
                    <p className="mt-2 text-amber-600 dark:text-amber-400">
                      Note: HuggingFace token not configured. Set it in Settings to enable speaker diarization.
                    </p>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Action Buttons */}
      <div className="flex items-center justify-between">
        <div>
          {showSkip && status !== 'completed' && (
            <button
              onClick={onSkip}
              className="px-4 py-2 text-sm text-muted-foreground hover:text-foreground"
            >
              Skip for now
            </button>
          )}
        </div>

        <div className="flex items-center gap-3">
          {status === 'idle' && (
            <button
              onClick={startSetup}
              className="px-6 py-2.5 bg-purple-600 hover:bg-purple-700 text-white rounded-md font-medium flex items-center gap-2"
            >
              <Play className="h-4 w-4" />
              Start Setup
            </button>
          )}

          {status === 'running' && (
            <button
              onClick={cancelSetup}
              className="px-6 py-2.5 bg-red-600 hover:bg-red-700 text-white rounded-md font-medium flex items-center gap-2"
            >
              <Square className="h-4 w-4" />
              Cancel
            </button>
          )}

          {(status === 'error' || status === 'completed') && (
            <button
              onClick={startSetup}
              className="px-6 py-2.5 bg-purple-600 hover:bg-purple-700 text-white rounded-md font-medium flex items-center gap-2"
            >
              <RefreshCw className="h-4 w-4" />
              {status === 'error' ? 'Retry' : 'Run Again'}
            </button>
          )}
        </div>
      </div>

      {/* Skip Warning */}
      {showSkip && status === 'idle' && (
        <div className="bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 rounded-lg p-4">
          <div className="flex items-start gap-3">
            <AlertTriangle className="h-5 w-5 text-amber-600 dark:text-amber-400 flex-shrink-0 mt-0.5" />
            <div className="text-sm text-amber-700 dark:text-amber-300">
              <p className="font-medium">Skipping setup will limit features</p>
              <p className="mt-1">
                Without Python environments, transcription and speaker identification will not be available.
                You can run setup later from Settings.
              </p>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

// ============================================================================
// Step Row Component
// ============================================================================

interface StepRowProps {
  step: SetupStep
}

function StepRow({ step }: StepRowProps) {
  const statusIcon = {
    pending: <div className="w-5 h-5 rounded-full border-2 border-gray-300" />,
    running: <Loader2 className="h-5 w-5 text-purple-600 animate-spin" />,
    completed: <CheckCircle className="h-5 w-5 text-green-600" />,
    error: <XCircle className="h-5 w-5 text-red-600" />,
    warning: <AlertCircle className="h-5 w-5 text-amber-600" />
  }

  return (
    <div className={cn(
      'px-4 py-3 flex items-center gap-4',
      step.status === 'running' && 'bg-purple-50/50 dark:bg-purple-950/20'
    )}>
      <div className="flex-shrink-0">
        {statusIcon[step.status]}
      </div>
      <div className="flex-1 min-w-0">
        <p className={cn(
          'font-medium text-sm',
          step.status === 'pending' ? 'text-muted-foreground' : 'text-foreground'
        )}>
          {step.name}
        </p>
        <p className="text-xs text-muted-foreground truncate">
          {step.description}
        </p>
      </div>
      {step.status === 'pending' && step.estimatedTime && (
        <div className="flex items-center gap-1 text-xs text-muted-foreground">
          <Clock className="h-3 w-3" />
          {step.estimatedTime}
        </div>
      )}
    </div>
  )
}

// ============================================================================
// Compact View Component
// ============================================================================

interface CompactSetupViewProps {
  status: 'idle' | 'running' | 'completed' | 'error'
  progress: number
  message: string
  error: string | null
  elapsedTime: string
  onStart: () => void
  onCancel: () => void
  onRetry: () => void
}

function CompactSetupView({
  status,
  progress,
  message,
  error,
  elapsedTime,
  onStart,
  onCancel,
  onRetry
}: CompactSetupViewProps) {
  return (
    <div className="space-y-3">
      {/* Progress */}
      <div className="flex items-center gap-3">
        <div className="flex-1">
          <div className="h-2 bg-secondary rounded-full overflow-hidden">
            <div
              className={cn(
                'h-full transition-all duration-300',
                status === 'completed' ? 'bg-green-500' :
                status === 'error' ? 'bg-red-500' :
                'bg-purple-600'
              )}
              style={{ width: `${progress}%` }}
            />
          </div>
        </div>
        <span className="text-sm font-medium w-12 text-right">{progress}%</span>
      </div>

      {/* Status */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 text-sm">
          {status === 'running' && (
            <>
              <Loader2 className="h-4 w-4 animate-spin text-purple-600" />
              <span className="text-muted-foreground">{message}</span>
              <span className="text-xs text-muted-foreground">({elapsedTime})</span>
            </>
          )}
          {status === 'completed' && (
            <>
              <CheckCircle className="h-4 w-4 text-green-600" />
              <span className="text-green-600">Setup complete</span>
            </>
          )}
          {status === 'error' && (
            <>
              <XCircle className="h-4 w-4 text-red-600" />
              <span className="text-red-600">{error || 'Setup failed'}</span>
            </>
          )}
          {status === 'idle' && (
            <span className="text-muted-foreground">Ready to set up Python environments</span>
          )}
        </div>

        {/* Action Button */}
        {status === 'idle' && (
          <button
            onClick={onStart}
            className="px-3 py-1.5 bg-purple-600 hover:bg-purple-700 text-white rounded text-sm font-medium"
          >
            Start
          </button>
        )}
        {status === 'running' && (
          <button
            onClick={onCancel}
            className="px-3 py-1.5 bg-red-600 hover:bg-red-700 text-white rounded text-sm font-medium"
          >
            Cancel
          </button>
        )}
        {status === 'error' && (
          <button
            onClick={onRetry}
            className="px-3 py-1.5 bg-purple-600 hover:bg-purple-700 text-white rounded text-sm font-medium"
          >
            Retry
          </button>
        )}
      </div>
    </div>
  )
}

export default PythonEnvironmentSetup
