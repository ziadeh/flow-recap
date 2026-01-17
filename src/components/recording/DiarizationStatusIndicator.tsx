/**
 * DiarizationStatusIndicator Component
 *
 * Displays the current status of speaker diarization during recording.
 * Shows colored indicators (green/yellow/red) with status messages
 * and recovery options when diarization fails.
 *
 * Features:
 * - Real-time status display (Active/Degraded/Failed)
 * - Color-coded indicator (green/yellow/red/gray/blue)
 * - Troubleshooting tips and recovery actions
 * - Manual retry and skip options
 */

import { useState, useEffect, useCallback, memo } from 'react'
import {
  CheckCircle,
  AlertTriangle,
  XCircle,
  Loader2,
  Info,
  RefreshCw,
  Settings,
  ChevronDown,
  ChevronUp,
  Users
} from 'lucide-react'
import { cn } from '../../lib/utils'

// ============================================================================
// Types
// ============================================================================

export type DiarizationStatus = 'active' | 'degraded' | 'failed' | 'disabled' | 'recovery_pending' | 'initializing'

export interface DiarizationStatusIndicatorProps {
  /** Current diarization status */
  status: DiarizationStatus
  /** Status message to display */
  message?: string
  /** Whether to show recovery options */
  showRecoveryOptions?: boolean
  /** Number of speakers detected (if active) */
  speakerCount?: number
  /** Whether recovery job is queued */
  recoveryQueued?: boolean
  /** Callback when user requests retry */
  onRetry?: () => void
  /** Callback when user requests to skip diarization */
  onSkip?: () => void
  /** Callback when user wants to open settings */
  onOpenSettings?: () => void
  /** Callback to schedule post-meeting recovery */
  onScheduleRecovery?: () => void
  /** Compact mode for inline display */
  compact?: boolean
  /** Additional class names */
  className?: string
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

const statusConfigs: Record<DiarizationStatus, StatusConfig> = {
  active: {
    icon: CheckCircle,
    color: 'text-green-600 dark:text-green-400',
    bgColor: 'bg-green-50 dark:bg-green-900/20',
    borderColor: 'border-green-200 dark:border-green-800',
    label: 'Active',
    defaultMessage: 'Speaker identification is working normally.'
  },
  degraded: {
    icon: AlertTriangle,
    color: 'text-yellow-600 dark:text-yellow-400',
    bgColor: 'bg-yellow-50 dark:bg-yellow-900/20',
    borderColor: 'border-yellow-200 dark:border-yellow-800',
    label: 'Degraded',
    defaultMessage: 'Speaker identification is experiencing issues.'
  },
  failed: {
    icon: XCircle,
    color: 'text-red-600 dark:text-red-400',
    bgColor: 'bg-red-50 dark:bg-red-900/20',
    borderColor: 'border-red-200 dark:border-red-800',
    label: 'Failed',
    defaultMessage: 'Speaker identification is not available.'
  },
  disabled: {
    icon: Info,
    color: 'text-gray-500 dark:text-gray-400',
    bgColor: 'bg-gray-50 dark:bg-gray-900/20',
    borderColor: 'border-gray-200 dark:border-gray-700',
    label: 'Disabled',
    defaultMessage: 'Speaker identification is disabled.'
  },
  recovery_pending: {
    icon: RefreshCw,
    color: 'text-blue-600 dark:text-blue-400',
    bgColor: 'bg-blue-50 dark:bg-blue-900/20',
    borderColor: 'border-blue-200 dark:border-blue-800',
    label: 'Recovery Scheduled',
    defaultMessage: 'Speaker identification will run after recording.'
  },
  initializing: {
    icon: Loader2,
    color: 'text-gray-500 dark:text-gray-400',
    bgColor: 'bg-gray-50 dark:bg-gray-900/20',
    borderColor: 'border-gray-200 dark:border-gray-700',
    label: 'Initializing',
    defaultMessage: 'Starting speaker identification...'
  }
}

// ============================================================================
// Troubleshooting Tips
// ============================================================================

const troubleshootingTips: Record<DiarizationStatus, string[]> = {
  active: [],
  degraded: [
    'Check your microphone audio levels',
    'Ensure speakers are clearly audible',
    'Try speaking closer to the microphone'
  ],
  failed: [
    'Check if Hugging Face token (HF_TOKEN) is configured',
    'Verify microphone permissions are granted',
    'Ensure audio quality is sufficient',
    'Try restarting the application'
  ],
  disabled: [
    'Enable speaker identification in Settings'
  ],
  recovery_pending: [
    'Speakers will be identified when recording stops',
    'You can manually trigger identification from meeting details'
  ],
  initializing: []
}

// ============================================================================
// Component
// ============================================================================

export const DiarizationStatusIndicator = memo(function DiarizationStatusIndicator({
  status,
  message,
  showRecoveryOptions = false,
  speakerCount,
  recoveryQueued = false,
  onRetry,
  onSkip,
  onOpenSettings,
  onScheduleRecovery,
  compact = false,
  className
}: DiarizationStatusIndicatorProps) {
  const [expanded, setExpanded] = useState(false)

  // Get status configuration
  const config = statusConfigs[status]
  const StatusIcon = config.icon
  const displayMessage = message || config.defaultMessage
  const tips = troubleshootingTips[status]

  // Auto-expand on failure
  useEffect(() => {
    if (status === 'failed' && showRecoveryOptions && !compact) {
      setExpanded(true)
    }
  }, [status, showRecoveryOptions, compact])

  // Compact mode - just show icon and label
  if (compact) {
    return (
      <div
        className={cn(
          'inline-flex items-center gap-1.5 px-2 py-1 rounded-full text-xs font-medium',
          config.bgColor,
          config.color,
          className
        )}
        data-testid="diarization-status-compact"
        title={displayMessage}
      >
        <StatusIcon
          className={cn(
            'w-3 h-3',
            status === 'initializing' && 'animate-spin'
          )}
        />
        <span>Speaker ID: {config.label}</span>
        {speakerCount !== undefined && speakerCount > 0 && (
          <span className="text-muted-foreground">({speakerCount})</span>
        )}
      </div>
    )
  }

  // Full mode with expandable details
  return (
    <div
      className={cn(
        'rounded-lg border overflow-hidden',
        config.bgColor,
        config.borderColor,
        className
      )}
      data-testid="diarization-status-indicator"
    >
      {/* Header */}
      <button
        onClick={() => setExpanded(!expanded)}
        className={cn(
          'w-full flex items-center justify-between px-3 py-2',
          'hover:bg-black/5 dark:hover:bg-white/5 transition-colors'
        )}
        aria-expanded={expanded}
        data-testid="diarization-status-toggle"
      >
        <div className="flex items-center gap-2">
          <StatusIcon
            className={cn(
              'w-4 h-4',
              config.color,
              status === 'initializing' && 'animate-spin'
            )}
          />
          <div className="flex items-center gap-2">
            <span className={cn('font-medium text-sm', config.color)}>
              Speaker Identification: {config.label}
            </span>
            {speakerCount !== undefined && speakerCount > 0 && (
              <span className="flex items-center gap-1 text-xs text-muted-foreground">
                <Users className="w-3 h-3" />
                {speakerCount} detected
              </span>
            )}
          </div>
        </div>
        {(showRecoveryOptions || tips.length > 0) && (
          expanded ? (
            <ChevronUp className="w-4 h-4 text-muted-foreground" />
          ) : (
            <ChevronDown className="w-4 h-4 text-muted-foreground" />
          )
        )}
      </button>

      {/* Expanded Content */}
      {expanded && (
        <div className="px-3 pb-3 space-y-3 border-t border-inherit">
          {/* Status Message */}
          <p className="text-sm text-muted-foreground pt-2">
            {displayMessage}
          </p>

          {/* Troubleshooting Tips */}
          {tips.length > 0 && (
            <div className="space-y-1">
              <p className="text-xs font-medium text-muted-foreground">
                Troubleshooting Tips:
              </p>
              <ul className="text-xs text-muted-foreground space-y-0.5 list-disc list-inside">
                {tips.map((tip, index) => (
                  <li key={index}>{tip}</li>
                ))}
              </ul>
            </div>
          )}

          {/* Recovery Options */}
          {showRecoveryOptions && (status === 'failed' || status === 'degraded') && (
            <div className="flex flex-wrap gap-2 pt-1">
              {onRetry && (
                <button
                  onClick={onRetry}
                  className={cn(
                    'inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md',
                    'bg-primary text-primary-foreground hover:bg-primary/90 transition-colors'
                  )}
                  data-testid="diarization-retry-btn"
                >
                  <RefreshCw className="w-3 h-3" />
                  Retry Now
                </button>
              )}

              {onScheduleRecovery && !recoveryQueued && (
                <button
                  onClick={onScheduleRecovery}
                  className={cn(
                    'inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md',
                    'bg-blue-600 text-white hover:bg-blue-700 transition-colors'
                  )}
                  data-testid="diarization-schedule-recovery-btn"
                >
                  <RefreshCw className="w-3 h-3" />
                  Identify After Recording
                </button>
              )}

              {onSkip && (
                <button
                  onClick={onSkip}
                  className={cn(
                    'inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md',
                    'bg-muted text-muted-foreground hover:bg-muted/80 transition-colors'
                  )}
                  data-testid="diarization-skip-btn"
                >
                  Skip Speaker ID
                </button>
              )}

              {onOpenSettings && (
                <button
                  onClick={onOpenSettings}
                  className={cn(
                    'inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md',
                    'bg-muted text-muted-foreground hover:bg-muted/80 transition-colors'
                  )}
                  data-testid="diarization-settings-btn"
                >
                  <Settings className="w-3 h-3" />
                  Settings
                </button>
              )}
            </div>
          )}

          {/* Recovery Queued Message */}
          {recoveryQueued && (
            <div className="flex items-center gap-2 text-xs text-blue-600 dark:text-blue-400">
              <RefreshCw className="w-3 h-3 animate-spin" />
              <span>Speaker identification will run after recording completes.</span>
            </div>
          )}
        </div>
      )}
    </div>
  )
})

// ============================================================================
// Helper Hook for Status Management
// ============================================================================

export interface UseDiarizationStatusOptions {
  meetingId: string
  isRecording: boolean
}

export function useDiarizationStatus({ meetingId, isRecording }: UseDiarizationStatusOptions) {
  const [status, setStatus] = useState<DiarizationStatus>('initializing')
  const [message, setMessage] = useState<string>('')
  const [speakerCount, setSpeakerCount] = useState<number>(0)
  const [recoveryQueued, setRecoveryQueued] = useState(false)

  // Set up event listeners from electron API
  useEffect(() => {
    const api = window.electronAPI as any

    if (!api?.diarizationHealth) {
      console.warn('[useDiarizationStatus] Diarization health API not available')
      return
    }

    // Subscribe to health change events
    const unsubHealth = api.diarizationHealth.onHealthChange?.((event: any) => {
      const statusMap: Record<string, DiarizationStatus> = {
        'active': 'active',
        'degraded': 'degraded',
        'failed': 'failed',
        'disabled': 'disabled',
        'unknown': 'initializing'
      }
      setStatus(statusMap[event.status] || 'initializing')
      setMessage(event.message || '')
    })

    // Subscribe to speaker count updates
    const unsubSpeakers = api.diarizationHealth.onSpeakerCountChange?.((count: number) => {
      setSpeakerCount(count)
    })

    // Subscribe to recovery queue events
    const unsubRecovery = api.diarizationHealth.onRecoveryQueued?.(() => {
      setRecoveryQueued(true)
    })

    return () => {
      unsubHealth?.()
      unsubSpeakers?.()
      unsubRecovery?.()
    }
  }, [meetingId])

  // Reset when recording starts/stops
  useEffect(() => {
    if (isRecording) {
      setStatus('initializing')
      setMessage('')
      setSpeakerCount(0)
      setRecoveryQueued(false)
    }
  }, [isRecording])

  const handleRetry = useCallback(async () => {
    const api = window.electronAPI as any
    if (api?.diarizationHealth?.retry) {
      setStatus('initializing')
      await api.diarizationHealth.retry()
    }
  }, [])

  const handleSkip = useCallback(async () => {
    const api = window.electronAPI as any
    if (api?.diarizationHealth?.skip) {
      setStatus('disabled')
      await api.diarizationHealth.skip()
    }
  }, [])

  const handleScheduleRecovery = useCallback(async () => {
    const api = window.electronAPI as any
    if (api?.diarizationHealth?.scheduleRecovery) {
      setRecoveryQueued(true)
      setStatus('recovery_pending')
      await api.diarizationHealth.scheduleRecovery(meetingId)
    }
  }, [meetingId])

  return {
    status,
    message,
    speakerCount,
    recoveryQueued,
    onRetry: handleRetry,
    onSkip: handleSkip,
    onScheduleRecovery: handleScheduleRecovery
  }
}

export default DiarizationStatusIndicator
