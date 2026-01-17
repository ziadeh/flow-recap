/**
 * TranscriptionDiagnostics Component
 *
 * Provides diagnostic tools and status information for the live transcription system.
 * Helps users understand if Whisper is properly configured and troubleshoot issues.
 */

import { useState, useEffect } from 'react'
import {
  CheckCircle,
  XCircle,
  AlertCircle,
  Loader2,
  RefreshCw,
  Terminal,
  FileCode
} from 'lucide-react'
import { cn } from '@/lib/utils'

// ============================================================================
// Types
// ============================================================================

interface DiagnosticResult {
  name: string
  status: 'success' | 'warning' | 'error' | 'checking'
  message: string
  details?: string
}

interface TranscriptionAvailability {
  available: boolean
  pythonPath: string
  scriptPath?: string
  pythonVersion?: string
  error?: string
}

interface DependencyCheck {
  pythonAvailable: boolean
  pythonPath: string
  whisperxAvailable: boolean
  fasterWhisperAvailable: boolean
  pyannoteAvailable: boolean
  cudaAvailable: boolean
  transcriptionBackend: 'whisperx' | 'faster-whisper' | null
  errors: string[]
}

// ============================================================================
// Types for Props
// ============================================================================

interface TranscriptionDiagnosticsProps {
  /**
   * Whether to automatically run diagnostics on component mount.
   * Set to false to improve performance when the component is first rendered.
   * Default: false (user must click the check button to run diagnostics)
   */
  autoRun?: boolean
}

// ============================================================================
// Component
// ============================================================================

export function TranscriptionDiagnostics({ autoRun = false }: TranscriptionDiagnosticsProps) {
  const [isRunning, setIsRunning] = useState(false)
  const [results, setResults] = useState<DiagnosticResult[]>([])
  // Store full diagnostic info for potential future use
  const [, setTranscriptionInfo] = useState<TranscriptionAvailability | null>(null)
  const [, setDependencyInfo] = useState<DependencyCheck | null>(null)
  const [showDetails, setShowDetails] = useState(false)

  const runDiagnostics = async () => {
    setIsRunning(true)
    setResults([])

    const newResults: DiagnosticResult[] = []

    // Check 1: Live Transcription API availability
    newResults.push({
      name: 'Live Transcription API',
      status: 'checking',
      message: 'Checking API availability...',
    })
    setResults([...newResults])

    try {
      const api = window.electronAPI as any
      if (api?.liveTranscription?.isAvailable) {
        const availability: TranscriptionAvailability = await api.liveTranscription.isAvailable()
        setTranscriptionInfo(availability)

        if (availability.available) {
          newResults[newResults.length - 1] = {
            name: 'Live Transcription API',
            status: 'success',
            message: 'Live transcription service is available',
            details: `Python: ${availability.pythonVersion || 'Unknown'}\nPath: ${availability.pythonPath}`,
          }
        } else {
          newResults[newResults.length - 1] = {
            name: 'Live Transcription API',
            status: 'error',
            message: availability.error || 'Service not available',
            details: `Python path: ${availability.pythonPath}\nScript: ${availability.scriptPath || 'Not found'}`,
          }
        }
      } else {
        newResults[newResults.length - 1] = {
          name: 'Live Transcription API',
          status: 'error',
          message: 'API not found - ensure app is running in Electron',
        }
      }
    } catch (err) {
      newResults[newResults.length - 1] = {
        name: 'Live Transcription API',
        status: 'error',
        message: `API check failed: ${err instanceof Error ? err.message : String(err)}`,
      }
    }
    setResults([...newResults])

    // Check 2: ML Pipeline dependencies
    newResults.push({
      name: 'ML Dependencies',
      status: 'checking',
      message: 'Checking Python dependencies...',
    })
    setResults([...newResults])

    try {
      const api = window.electronAPI as any
      if (api?.mlPipeline?.checkDependencies) {
        const deps: DependencyCheck = await api.mlPipeline.checkDependencies()
        setDependencyInfo(deps)

        if (deps.pythonAvailable && (deps.whisperxAvailable || deps.fasterWhisperAvailable)) {
          const backend = deps.transcriptionBackend || (deps.whisperxAvailable ? 'whisperx' : 'faster-whisper')
          newResults[newResults.length - 1] = {
            name: 'ML Dependencies',
            status: 'success',
            message: `Backend: ${backend}${deps.cudaAvailable ? ' (GPU acceleration available)' : ' (CPU only)'}`,
            details: `WhisperX: ${deps.whisperxAvailable ? 'Yes' : 'No'}\nfaster-whisper: ${deps.fasterWhisperAvailable ? 'Yes' : 'No'}\npyannote: ${deps.pyannoteAvailable ? 'Yes' : 'No'}\nCUDA: ${deps.cudaAvailable ? 'Yes' : 'No'}`,
          }
        } else if (!deps.pythonAvailable) {
          newResults[newResults.length - 1] = {
            name: 'ML Dependencies',
            status: 'error',
            message: 'Python not available',
            details: deps.errors.join('\n') || 'Please install Python 3.10+',
          }
        } else {
          newResults[newResults.length - 1] = {
            name: 'ML Dependencies',
            status: 'error',
            message: 'Whisper not installed',
            details: 'Please run: pip install whisperx faster-whisper\n\n' + (deps.errors.join('\n') || ''),
          }
        }
      } else {
        newResults[newResults.length - 1] = {
          name: 'ML Dependencies',
          status: 'warning',
          message: 'Could not check dependencies - API not available',
        }
      }
    } catch (err) {
      newResults[newResults.length - 1] = {
        name: 'ML Dependencies',
        status: 'error',
        message: `Dependency check failed: ${err instanceof Error ? err.message : String(err)}`,
      }
    }
    setResults([...newResults])

    // Check 3: Audio recording capability
    newResults.push({
      name: 'Audio Recording',
      status: 'checking',
      message: 'Checking audio recording...',
    })
    setResults([...newResults])

    try {
      const api = window.electronAPI as any
      if (api?.recording?.getStatus) {
        const status = await api.recording.getStatus()
        newResults[newResults.length - 1] = {
          name: 'Audio Recording',
          status: 'success',
          message: `Recording service: ${status.status === 'idle' ? 'Ready' : status.status}`,
          details: status.audioFilePath ? `Current file: ${status.audioFilePath}` : undefined,
        }
      } else {
        newResults[newResults.length - 1] = {
          name: 'Audio Recording',
          status: 'warning',
          message: 'Recording API not available',
        }
      }
    } catch (err) {
      newResults[newResults.length - 1] = {
        name: 'Audio Recording',
        status: 'error',
        message: `Recording check failed: ${err instanceof Error ? err.message : String(err)}`,
      }
    }
    setResults([...newResults])

    setIsRunning(false)
  }

  // Run diagnostics on mount only if autoRun is true
  useEffect(() => {
    if (autoRun) {
      runDiagnostics()
    }
  }, [autoRun])

  const getStatusIcon = (status: DiagnosticResult['status']) => {
    switch (status) {
      case 'success':
        return <CheckCircle className="w-5 h-5 text-green-500" />
      case 'warning':
        return <AlertCircle className="w-5 h-5 text-amber-500" />
      case 'error':
        return <XCircle className="w-5 h-5 text-red-500" />
      case 'checking':
        return <Loader2 className="w-5 h-5 text-blue-500 animate-spin" />
    }
  }

  const getStatusColor = (status: DiagnosticResult['status']) => {
    switch (status) {
      case 'success':
        return 'border-green-200 bg-green-50'
      case 'warning':
        return 'border-amber-200 bg-amber-50'
      case 'error':
        return 'border-red-200 bg-red-50'
      case 'checking':
        return 'border-blue-200 bg-blue-50'
    }
  }

  const allPassed = results.length > 0 && results.every(r => r.status === 'success')
  const hasErrors = results.some(r => r.status === 'error')

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Terminal className="w-5 h-5 text-muted-foreground" />
          <span className="font-medium">Transcription Service Status</span>
        </div>
        <button
          onClick={runDiagnostics}
          disabled={isRunning}
          className={cn(
            'flex items-center gap-2 px-3 py-1.5 rounded-md text-sm font-medium transition-colors',
            'bg-secondary hover:bg-accent text-foreground',
            isRunning && 'opacity-50 cursor-not-allowed'
          )}
        >
          <RefreshCw className={cn('w-4 h-4', isRunning && 'animate-spin')} />
          {isRunning ? 'Checking...' : results.length > 0 ? 'Re-check' : 'Run Check'}
        </button>
      </div>

      {/* Initial state - show prompt to run diagnostics */}
      {results.length === 0 && !isRunning && (
        <div className="p-4 rounded-lg border border-dashed border-muted-foreground/30 bg-muted/20">
          <div className="flex items-center gap-2 text-muted-foreground">
            <AlertCircle className="w-5 h-5" />
            <span className="text-sm">Click "Run Check" to test your transcription service configuration.</span>
          </div>
        </div>
      )}

      {/* Overall Status */}
      {results.length > 0 && !isRunning && (
        <div className={cn(
          'p-4 rounded-lg border',
          allPassed ? 'bg-green-50 border-green-200' : hasErrors ? 'bg-red-50 border-red-200' : 'bg-amber-50 border-amber-200'
        )}>
          <div className="flex items-center gap-2">
            {allPassed ? (
              <CheckCircle className="w-5 h-5 text-green-600" />
            ) : hasErrors ? (
              <XCircle className="w-5 h-5 text-red-600" />
            ) : (
              <AlertCircle className="w-5 h-5 text-amber-600" />
            )}
            <span className={cn(
              'font-medium',
              allPassed ? 'text-green-700' : hasErrors ? 'text-red-700' : 'text-amber-700'
            )}>
              {allPassed
                ? 'Live transcription is ready'
                : hasErrors
                ? 'Live transcription has issues that need attention'
                : 'Live transcription may have some limitations'}
            </span>
          </div>
        </div>
      )}

      {/* Diagnostic Results */}
      <div className="space-y-2">
        {results.map((result, index) => (
          <div
            key={index}
            className={cn(
              'p-3 rounded-lg border transition-colors',
              getStatusColor(result.status)
            )}
          >
            <div className="flex items-start gap-3">
              {getStatusIcon(result.status)}
              <div className="flex-1 min-w-0">
                <div className="flex items-center justify-between">
                  <span className="font-medium text-sm">{result.name}</span>
                  {result.details && (
                    <button
                      onClick={() => setShowDetails(!showDetails)}
                      className="text-xs text-muted-foreground hover:text-foreground"
                    >
                      {showDetails ? 'Hide details' : 'Show details'}
                    </button>
                  )}
                </div>
                <p className="text-sm text-muted-foreground mt-0.5">{result.message}</p>
                {showDetails && result.details && (
                  <pre className="mt-2 p-2 bg-black/5 rounded text-xs text-muted-foreground whitespace-pre-wrap font-mono">
                    {result.details}
                  </pre>
                )}
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* Troubleshooting Tips */}
      {hasErrors && !isRunning && (
        <div className="p-4 bg-muted/50 rounded-lg space-y-3">
          <h4 className="font-medium text-sm flex items-center gap-2">
            <FileCode className="w-4 h-4" />
            Troubleshooting Tips
          </h4>
          <ul className="text-sm text-muted-foreground space-y-2 list-disc list-inside">
            <li>Ensure Python 3.10+ is installed and in your PATH</li>
            <li>Run <code className="px-1 py-0.5 bg-muted rounded text-xs">pip install whisperx faster-whisper</code> to install dependencies</li>
            <li>Check if the Python virtual environment is activated</li>
            <li>Review the terminal/console output for detailed error messages</li>
            <li>Try restarting the application after installing dependencies</li>
          </ul>
        </div>
      )}
    </div>
  )
}

export default TranscriptionDiagnostics
