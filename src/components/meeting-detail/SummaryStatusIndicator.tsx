/**
 * SummaryStatusIndicator Component
 *
 * Displays the current status of Meeting Summary generation in the Overview tab.
 * Provides visual feedback about the generation process including:
 * - Generating: Spinner with progress message
 * - Generated: Checkmark with timestamp
 * - Failed: Error icon with retry option and error details
 * - Not Available: Info icon for active recordings
 *
 * Features:
 * - Real-time status updates via IPC events
 * - Manual trigger button when auto-generation failed or was skipped
 * - Error details on hover
 * - Relative timestamp display (e.g., "2 minutes ago")
 */

import { useState, useEffect, useCallback, memo } from 'react'
import {
  CheckCircle,
  AlertTriangle,
  XCircle,
  Loader2,
  Info,
  RefreshCw,
  Sparkles,
  Clock
} from 'lucide-react'
import { cn } from '../../lib/utils'

// ============================================================================
// Types
// ============================================================================

export type SummaryGenerationStatus =
  | 'idle'           // No summary exists and not generating
  | 'generating'     // Currently generating
  | 'generated'      // Successfully generated
  | 'failed'         // Generation failed
  | 'not_available'  // Recording is active, summary will be generated when it stops

export interface SummaryStatusIndicatorProps {
  /** Meeting ID to track summary generation for */
  meetingId: string
  /** Whether the meeting is currently being recorded */
  isRecording?: boolean
  /** Whether a summary already exists */
  hasSummary?: boolean
  /** Timestamp when the summary was generated */
  summaryGeneratedAt?: string | null
  /** Callback when user triggers manual generation */
  onGenerateSummary?: () => Promise<void>
  /** Callback when data needs to be refetched */
  onRefetch?: () => void
  /** Additional class names */
  className?: string
}

export interface SummaryGenerationError {
  type: 'llm_timeout' | 'api_error' | 'insufficient_transcript' | 'no_transcript' | 'unknown'
  message: string
  details?: string
}

// ============================================================================
// Status Configuration
// ============================================================================

interface StatusConfig {
  icon: typeof CheckCircle
  color: string
  bgColor: string
  borderColor: string
  label: string
  defaultMessage: string
}

const statusConfigs: Record<SummaryGenerationStatus, StatusConfig> = {
  idle: {
    icon: Info,
    color: 'text-gray-500 dark:text-gray-400',
    bgColor: 'bg-gray-50 dark:bg-gray-900/20',
    borderColor: 'border-gray-200 dark:border-gray-700',
    label: 'Not Generated',
    defaultMessage: 'Meeting summary has not been generated yet.'
  },
  generating: {
    icon: Loader2,
    color: 'text-blue-600 dark:text-blue-400',
    bgColor: 'bg-blue-50 dark:bg-blue-900/20',
    borderColor: 'border-blue-200 dark:border-blue-800',
    label: 'Generating',
    defaultMessage: 'Generating meeting summary...'
  },
  generated: {
    icon: CheckCircle,
    color: 'text-green-600 dark:text-green-400',
    bgColor: 'bg-green-50 dark:bg-green-900/20',
    borderColor: 'border-green-200 dark:border-green-800',
    label: 'Generated',
    defaultMessage: 'Meeting summary is ready.'
  },
  failed: {
    icon: XCircle,
    color: 'text-red-600 dark:text-red-400',
    bgColor: 'bg-red-50 dark:bg-red-900/20',
    borderColor: 'border-red-200 dark:border-red-800',
    label: 'Failed',
    defaultMessage: 'Failed to generate summary.'
  },
  not_available: {
    icon: Info,
    color: 'text-amber-600 dark:text-amber-400',
    bgColor: 'bg-amber-50 dark:bg-amber-900/20',
    borderColor: 'border-amber-200 dark:border-amber-800',
    label: 'Pending',
    defaultMessage: 'Meeting summary will be generated when recording stops.'
  }
}

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Format a timestamp to a relative time string (e.g., "2 minutes ago")
 */
function formatRelativeTime(timestamp: string | Date): string {
  const date = typeof timestamp === 'string' ? new Date(timestamp) : timestamp
  const now = new Date()
  const diffMs = now.getTime() - date.getTime()
  const diffSeconds = Math.floor(diffMs / 1000)
  const diffMinutes = Math.floor(diffSeconds / 60)
  const diffHours = Math.floor(diffMinutes / 60)
  const diffDays = Math.floor(diffHours / 24)

  if (diffSeconds < 60) {
    return 'just now'
  } else if (diffMinutes < 60) {
    return `${diffMinutes} minute${diffMinutes === 1 ? '' : 's'} ago`
  } else if (diffHours < 24) {
    return `${diffHours} hour${diffHours === 1 ? '' : 's'} ago`
  } else {
    return `${diffDays} day${diffDays === 1 ? '' : 's'} ago`
  }
}

/**
 * Get error type label for display
 */
function getErrorTypeLabel(errorType: SummaryGenerationError['type']): string {
  const labels: Record<SummaryGenerationError['type'], string> = {
    llm_timeout: 'LLM Timeout',
    api_error: 'API Error',
    insufficient_transcript: 'Insufficient Transcript',
    no_transcript: 'No Transcript',
    unknown: 'Unknown Error'
  }
  return labels[errorType] || 'Error'
}

// ============================================================================
// Component
// ============================================================================

export const SummaryStatusIndicator = memo(function SummaryStatusIndicator({
  meetingId,
  isRecording = false,
  hasSummary = false,
  summaryGeneratedAt,
  onGenerateSummary,
  onRefetch,
  className
}: SummaryStatusIndicatorProps) {
  const [status, setStatus] = useState<SummaryGenerationStatus>('idle')
  const [error, setError] = useState<SummaryGenerationError | null>(null)
  const [isManuallyGenerating, setIsManuallyGenerating] = useState(false)
  const [showErrorDetails, setShowErrorDetails] = useState(false)

  // Determine initial status based on props
  useEffect(() => {
    if (isRecording) {
      setStatus('not_available')
    } else if (hasSummary) {
      setStatus('generated')
    } else {
      setStatus('idle')
    }
  }, [isRecording, hasSummary])

  // Listen for summary generation events from electron
  useEffect(() => {
    const api = window.electronAPI as any

    // Listen for summary generation start
    const handleSummaryGenerationStart = (data: { meetingId: string }) => {
      if (data.meetingId === meetingId) {
        setStatus('generating')
        setError(null)
      }
    }

    // Listen for summary generation complete
    const handleSummaryGenerated = (data: { meetingId: string; success: boolean; notesCreated?: any[]; error?: string }) => {
      if (data.meetingId === meetingId) {
        if (data.success && data.notesCreated && data.notesCreated.length > 0) {
          setStatus('generated')
          setError(null)
          onRefetch?.()
        } else if (!data.success || (data.notesCreated && data.notesCreated.length === 0)) {
          setStatus('failed')
          setError({
            type: 'unknown',
            message: data.error || 'Failed to generate summary',
            details: data.error
          })
        }
        setIsManuallyGenerating(false)
      }
    }

    // Listen for summary generation failure
    const handleSummaryGenerationFailed = (data: {
      meetingId: string;
      error: string;
      errorType?: SummaryGenerationError['type'];
      details?: string
    }) => {
      if (data.meetingId === meetingId) {
        setStatus('failed')
        setError({
          type: data.errorType || 'unknown',
          message: data.error,
          details: data.details
        })
        setIsManuallyGenerating(false)
      }
    }

    // Set up listeners - these are exposed on the recordingAPI object
    const unsubStart = api?.onSummaryGenerationStart?.(handleSummaryGenerationStart)
    const unsubGenerated = api?.onSummaryGenerated?.(handleSummaryGenerated)
    const unsubFailed = api?.onSummaryGenerationFailed?.(handleSummaryGenerationFailed)

    return () => {
      unsubStart?.()
      unsubGenerated?.()
      unsubFailed?.()
    }
  }, [meetingId, onRefetch])

  // Handle manual generation trigger
  const handleGenerateSummary = useCallback(async () => {
    if (isManuallyGenerating) return

    setIsManuallyGenerating(true)
    setStatus('generating')
    setError(null)

    try {
      if (onGenerateSummary) {
        await onGenerateSummary()
      } else {
        // Use IPC to trigger generation via meetingSummary API
        const api = window.electronAPI as any
        const result = await api?.meetingSummary?.generateSummary?.(meetingId)

        if (result?.success) {
          setStatus('generated')
          onRefetch?.()
        } else {
          setStatus('failed')
          setError({
            type: result?.error?.includes('transcript') ? 'no_transcript' : 'unknown',
            message: result?.error || 'Failed to generate summary',
            details: result?.error
          })
        }
      }
    } catch (err) {
      setStatus('failed')
      setError({
        type: 'unknown',
        message: err instanceof Error ? err.message : 'An unexpected error occurred',
        details: err instanceof Error ? err.stack : undefined
      })
    } finally {
      setIsManuallyGenerating(false)
    }
  }, [meetingId, onGenerateSummary, onRefetch, isManuallyGenerating])

  // Get status configuration
  const config = statusConfigs[status]
  const StatusIcon = config.icon

  // Don't show indicator if summary exists and we're in generated state
  // The summary content will be displayed instead
  if (status === 'generated' && hasSummary && !isManuallyGenerating) {
    return null
  }

  return (
    <div
      className={cn(
        'rounded-lg border p-4 mb-4',
        config.bgColor,
        config.borderColor,
        className
      )}
      data-testid="summary-status-indicator"
      data-status={status}
    >
      <div className="flex items-start gap-3">
        {/* Status Icon */}
        <div className={cn('flex-shrink-0 mt-0.5', config.color)}>
          <StatusIcon
            className={cn(
              'w-5 h-5',
              status === 'generating' && 'animate-spin'
            )}
          />
        </div>

        {/* Content */}
        <div className="flex-1 min-w-0">
          {/* Status Label and Message */}
          <div className="flex items-center gap-2 mb-1">
            <span className={cn('font-medium text-sm', config.color)}>
              {status === 'generating' ? 'Generating meeting summary...' : config.label}
            </span>
            {status === 'generated' && summaryGeneratedAt && (
              <span className="flex items-center gap-1 text-xs text-muted-foreground">
                <Clock className="w-3 h-3" />
                Generated {formatRelativeTime(summaryGeneratedAt)}
              </span>
            )}
          </div>

          {/* Status-specific content */}
          {status === 'generating' && (
            <p className="text-sm text-muted-foreground">
              This may take a moment. The AI is analyzing your meeting transcript...
            </p>
          )}

          {status === 'not_available' && (
            <p className="text-sm text-muted-foreground">
              {config.defaultMessage}
            </p>
          )}

          {status === 'failed' && error && (
            <div className="space-y-2">
              <p className="text-sm text-muted-foreground">
                {error.message}
              </p>

              {/* Error type badge */}
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300">
                <AlertTriangle className="w-3 h-3" />
                {getErrorTypeLabel(error.type)}
              </span>

              {/* Error details (expandable) */}
              {error.details && (
                <div>
                  <button
                    onClick={() => setShowErrorDetails(!showErrorDetails)}
                    className="text-xs text-muted-foreground hover:text-foreground underline"
                  >
                    {showErrorDetails ? 'Hide details' : 'Show details'}
                  </button>
                  {showErrorDetails && (
                    <pre className="mt-2 p-2 text-xs bg-muted rounded-md overflow-x-auto max-h-32">
                      {error.details}
                    </pre>
                  )}
                </div>
              )}
            </div>
          )}

          {status === 'idle' && !isRecording && (
            <p className="text-sm text-muted-foreground">
              {config.defaultMessage}
            </p>
          )}
        </div>

        {/* Action Button */}
        {(status === 'idle' || status === 'failed') && !isRecording && onGenerateSummary && (
          <button
            onClick={handleGenerateSummary}
            disabled={isManuallyGenerating}
            className={cn(
              'flex-shrink-0 inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium rounded-md transition-colors',
              'bg-purple-600 text-white hover:bg-purple-700',
              'disabled:opacity-50 disabled:cursor-not-allowed'
            )}
            data-testid="generate-summary-button"
          >
            {isManuallyGenerating ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                Generating...
              </>
            ) : status === 'failed' ? (
              <>
                <RefreshCw className="w-4 h-4" />
                Retry
              </>
            ) : (
              <>
                <Sparkles className="w-4 h-4" />
                Generate Summary
              </>
            )}
          </button>
        )}
      </div>
    </div>
  )
})

export default SummaryStatusIndicator
