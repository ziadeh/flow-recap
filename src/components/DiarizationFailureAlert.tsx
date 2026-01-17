/**
 * Diarization Failure Alert Component
 *
 * Displays prominent error messages when speaker diarization fails.
 *
 * CRITICAL: This component ensures that diarization failures are NEVER silently ignored.
 * Users MUST acknowledge the failure and explicitly choose transcription-only mode.
 */

import { useState, useEffect, useCallback } from 'react'
import {
  AlertTriangle,
  X,
  ChevronDown,
  ChevronUp,
  ExternalLink,
  Terminal,
  Settings,
  CheckCircle2
} from 'lucide-react'
import { cn } from '@/lib/utils'

// ============================================================================
// Types
// ============================================================================

export interface RemediationStep {
  order: number
  title: string
  description: string
  command?: string
  automated?: boolean
  helpUrl?: string
}

export interface DiarizationFailureNotification {
  prominentMessage: string
  detailedMessage: string
  diagnosticSummary: string
  remediationSteps: RemediationStep[]
  showTranscriptionOnlyOption: boolean
  timestamp: number
  failureId: string
}

export interface DiarizationFailureAlertProps {
  /** The failure notification to display */
  notification: DiarizationFailureNotification | null
  /** Callback when user dismisses the alert */
  onDismiss?: () => void
  /** Callback when user enables transcription-only mode */
  onEnableTranscriptionOnly?: () => void
  /** Callback when user wants to retry diarization */
  onRetry?: () => void
  /** Whether transcription-only mode is currently enabled */
  transcriptionOnlyEnabled?: boolean
  /** Additional CSS classes */
  className?: string
}

// ============================================================================
// Component
// ============================================================================

export function DiarizationFailureAlert({
  notification,
  onDismiss,
  onEnableTranscriptionOnly,
  onRetry,
  transcriptionOnlyEnabled = false,
  className
}: DiarizationFailureAlertProps) {
  const [isExpanded, setIsExpanded] = useState(false)
  const [showDiagnostics, setShowDiagnostics] = useState(false)
  const [acknowledged, setAcknowledged] = useState(false)

  // Reset state when notification changes
  useEffect(() => {
    if (notification) {
      setIsExpanded(false)
      setShowDiagnostics(false)
      setAcknowledged(false)
    }
  }, [notification?.failureId])

  const handleDismiss = useCallback(() => {
    setAcknowledged(true)
    onDismiss?.()
  }, [onDismiss])

  const handleEnableTranscriptionOnly = useCallback(() => {
    setAcknowledged(true)
    onEnableTranscriptionOnly?.()
  }, [onEnableTranscriptionOnly])

  const handleCopyDiagnostics = useCallback(() => {
    if (notification?.diagnosticSummary) {
      navigator.clipboard.writeText(notification.diagnosticSummary)
    }
  }, [notification?.diagnosticSummary])

  // Don't render if no notification
  if (!notification) {
    return null
  }

  return (
    <div
      className={cn(
        'rounded-lg border-2 border-red-500 bg-red-50 dark:bg-red-950/30 p-4 shadow-lg',
        className
      )}
      role="alert"
      aria-live="assertive"
    >
      {/* Header with prominent message */}
      <div className="flex items-start gap-3">
        <div className="flex-shrink-0">
          <AlertTriangle className="h-6 w-6 text-red-600 dark:text-red-400" />
        </div>

        <div className="flex-1 min-w-0">
          {/* Prominent Message - MUST be displayed */}
          <h3 className="text-lg font-semibold text-red-800 dark:text-red-200">
            {notification.prominentMessage}
          </h3>

          {/* Detailed explanation */}
          <p className="mt-1 text-sm text-red-700 dark:text-red-300">
            {notification.detailedMessage}
          </p>

          {/* Timestamp */}
          <p className="mt-1 text-xs text-red-500 dark:text-red-400">
            {new Date(notification.timestamp).toLocaleString()}
          </p>
        </div>

        {/* Dismiss button - only show if acknowledged */}
        {acknowledged && (
          <button
            onClick={handleDismiss}
            className="flex-shrink-0 text-red-500 hover:text-red-700 dark:text-red-400 dark:hover:text-red-200"
            aria-label="Dismiss alert"
          >
            <X className="h-5 w-5" />
          </button>
        )}
      </div>

      {/* Action buttons */}
      <div className="mt-4 flex flex-wrap gap-2">
        {/* Transcription-only option */}
        {notification.showTranscriptionOnlyOption && !transcriptionOnlyEnabled && (
          <button
            onClick={handleEnableTranscriptionOnly}
            className={cn(
              'inline-flex items-center gap-2 px-3 py-2 rounded-md text-sm font-medium',
              'bg-amber-100 text-amber-800 hover:bg-amber-200',
              'dark:bg-amber-900/50 dark:text-amber-200 dark:hover:bg-amber-900'
            )}
          >
            <CheckCircle2 className="h-4 w-4" />
            Enable Transcription-Only Mode
          </button>
        )}

        {/* Already in transcription-only mode */}
        {transcriptionOnlyEnabled && (
          <span className="inline-flex items-center gap-2 px-3 py-2 rounded-md text-sm font-medium bg-green-100 text-green-800 dark:bg-green-900/50 dark:text-green-200">
            <CheckCircle2 className="h-4 w-4" />
            Transcription-Only Mode Active
          </span>
        )}

        {/* Retry button */}
        {onRetry && (
          <button
            onClick={onRetry}
            className={cn(
              'inline-flex items-center gap-2 px-3 py-2 rounded-md text-sm font-medium',
              'bg-blue-100 text-blue-800 hover:bg-blue-200',
              'dark:bg-blue-900/50 dark:text-blue-200 dark:hover:bg-blue-900'
            )}
          >
            Retry Diarization
          </button>
        )}

        {/* Settings link */}
        <a
          href="#/settings?category=speaker-id"
          className={cn(
            'inline-flex items-center gap-2 px-3 py-2 rounded-md text-sm font-medium',
            'bg-gray-100 text-gray-800 hover:bg-gray-200',
            'dark:bg-gray-800 dark:text-gray-200 dark:hover:bg-gray-700'
          )}
        >
          <Settings className="h-4 w-4" />
          Settings
        </a>

        {/* Expand/Collapse details */}
        <button
          onClick={() => setIsExpanded(!isExpanded)}
          className={cn(
            'inline-flex items-center gap-1 px-3 py-2 rounded-md text-sm font-medium',
            'text-red-700 hover:text-red-900 hover:bg-red-100',
            'dark:text-red-300 dark:hover:text-red-100 dark:hover:bg-red-900/50'
          )}
        >
          {isExpanded ? (
            <>
              Hide Details <ChevronUp className="h-4 w-4" />
            </>
          ) : (
            <>
              Show Details <ChevronDown className="h-4 w-4" />
            </>
          )}
        </button>
      </div>

      {/* Expanded details section */}
      {isExpanded && (
        <div className="mt-4 border-t border-red-200 dark:border-red-800 pt-4 space-y-4">
          {/* Remediation Steps */}
          {notification.remediationSteps.length > 0 && (
            <div>
              <h4 className="text-sm font-semibold text-red-800 dark:text-red-200 mb-2">
                How to Fix This
              </h4>
              <ol className="space-y-3">
                {notification.remediationSteps.map((step) => (
                  <li
                    key={step.order}
                    className="flex items-start gap-3 text-sm"
                  >
                    <span className="flex-shrink-0 w-6 h-6 rounded-full bg-red-200 dark:bg-red-800 text-red-800 dark:text-red-200 flex items-center justify-center font-medium">
                      {step.order}
                    </span>
                    <div className="flex-1">
                      <p className="font-medium text-red-800 dark:text-red-200">
                        {step.title}
                      </p>
                      <p className="text-red-600 dark:text-red-400 mt-0.5">
                        {step.description}
                      </p>
                      {step.command && (
                        <code className="mt-1 block bg-red-100 dark:bg-red-900/50 px-2 py-1 rounded text-xs font-mono text-red-800 dark:text-red-200">
                          <Terminal className="inline h-3 w-3 mr-1" />
                          {step.command}
                        </code>
                      )}
                      {step.helpUrl && (
                        <a
                          href={step.helpUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="mt-1 inline-flex items-center gap-1 text-xs text-blue-600 dark:text-blue-400 hover:underline"
                        >
                          Learn more <ExternalLink className="h-3 w-3" />
                        </a>
                      )}
                    </div>
                  </li>
                ))}
              </ol>
            </div>
          )}

          {/* Diagnostics toggle */}
          <div>
            <button
              onClick={() => setShowDiagnostics(!showDiagnostics)}
              className="text-sm text-red-600 dark:text-red-400 hover:underline flex items-center gap-1"
            >
              {showDiagnostics ? 'Hide' : 'Show'} Technical Diagnostics
              {showDiagnostics ? (
                <ChevronUp className="h-4 w-4" />
              ) : (
                <ChevronDown className="h-4 w-4" />
              )}
            </button>

            {showDiagnostics && (
              <div className="mt-2">
                <div className="flex items-center justify-between mb-1">
                  <span className="text-xs text-red-500 dark:text-red-400">
                    Diagnostic Information
                  </span>
                  <button
                    onClick={handleCopyDiagnostics}
                    className="text-xs text-red-600 dark:text-red-400 hover:underline"
                  >
                    Copy to Clipboard
                  </button>
                </div>
                <pre className="bg-red-100 dark:bg-red-900/50 p-3 rounded text-xs font-mono text-red-800 dark:text-red-200 overflow-x-auto max-h-40 overflow-y-auto">
                  {notification.diagnosticSummary}
                </pre>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Important notice */}
      <div className="mt-4 pt-3 border-t border-red-200 dark:border-red-800">
        <p className="text-xs text-red-600 dark:text-red-400 italic">
          <strong>Important:</strong> This error requires your attention. To continue without speaker
          identification, you must explicitly enable "Transcription-Only Mode" above. This ensures
          you are aware that speaker separation will not be available for this recording.
        </p>
      </div>
    </div>
  )
}

/**
 * Compact inline version of the failure alert for use in transcripts
 */
export function DiarizationFailureInlineAlert({
  message,
  onEnableTranscriptionOnly,
  transcriptionOnlyEnabled
}: {
  message: string
  onEnableTranscriptionOnly?: () => void
  transcriptionOnlyEnabled?: boolean
}) {
  return (
    <div className="flex items-center gap-2 p-2 bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 rounded text-sm">
      <AlertTriangle className="h-4 w-4 text-amber-600 dark:text-amber-400 flex-shrink-0" />
      <span className="text-amber-800 dark:text-amber-200 flex-1">{message}</span>
      {!transcriptionOnlyEnabled && onEnableTranscriptionOnly && (
        <button
          onClick={onEnableTranscriptionOnly}
          className="text-xs text-amber-700 dark:text-amber-300 underline hover:no-underline flex-shrink-0"
        >
          Enable Transcription-Only
        </button>
      )}
    </div>
  )
}

/**
 * Banner version for the top of the application
 */
export function DiarizationFailureBanner({
  show,
  onShowDetails,
  onDismiss
}: {
  show: boolean
  onShowDetails?: () => void
  onDismiss?: () => void
}) {
  if (!show) return null

  return (
    <div className="bg-red-600 text-white px-4 py-2 flex items-center gap-3">
      <AlertTriangle className="h-5 w-5 flex-shrink-0" />
      <span className="flex-1 text-sm font-medium">
        Speaker diarization is not available. Audio is being transcribed without speaker separation.
      </span>
      {onShowDetails && (
        <button
          onClick={onShowDetails}
          className="text-sm underline hover:no-underline"
        >
          View Details
        </button>
      )}
      {onDismiss && (
        <button
          onClick={onDismiss}
          className="p-1 hover:bg-red-700 rounded"
          aria-label="Dismiss"
        >
          <X className="h-4 w-4" />
        </button>
      )}
    </div>
  )
}

export default DiarizationFailureAlert
