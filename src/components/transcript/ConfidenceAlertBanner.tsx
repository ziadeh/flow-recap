/**
 * ConfidenceAlertBanner Component
 * Displays real-time alerts when transcription confidence drops during live recording.
 * Supports multiple alert types with different severity levels and suggested actions.
 */

import { useState, useEffect, useCallback, useMemo } from 'react'
import {
  AlertTriangle,
  AlertCircle,
  Volume2,
  Mic,
  X,
  ChevronDown,
  ChevronUp,
  RefreshCw
} from 'lucide-react'
import { cn } from '../../lib/utils'
import { ConfidenceBar, formatConfidencePercent } from './ConfidenceIndicator'

// ============================================================================
// Types
// ============================================================================

export type ConfidenceAlertType = 'low_confidence' | 'degrading_quality' | 'audio_issue'

export interface ConfidenceAlert {
  type: ConfidenceAlertType
  message: string
  severity: 'warning' | 'error'
  timestampMs: number
  windowConfidence: number
  suggestedAction: string
}

export interface ConfidenceAlertBannerProps {
  /** Current active alert (null if no alert) */
  alert: ConfidenceAlert | null
  /** Whether recording is currently active */
  isRecording?: boolean
  /** Current confidence value (0-1) */
  currentConfidence?: number
  /** Callback when alert is dismissed */
  onDismiss?: () => void
  /** Callback when suggested action is clicked */
  onActionClick?: (action: string, alertType: ConfidenceAlertType) => void
  /** Whether to auto-dismiss after timeout */
  autoDismiss?: boolean
  /** Auto-dismiss timeout in milliseconds */
  autoDismissTimeout?: number
  /** Whether to show expanded details */
  showDetails?: boolean
  /** Additional class names */
  className?: string
}

export interface ConfidenceAlertHistoryProps {
  /** Array of past alerts */
  alerts: ConfidenceAlert[]
  /** Maximum number of alerts to show */
  maxAlerts?: number
  /** Whether to show timestamps */
  showTimestamps?: boolean
  /** Additional class names */
  className?: string
}

export interface LiveConfidenceMonitorProps {
  /** Meeting ID being recorded */
  meetingId: string
  /** Whether recording is active */
  isRecording: boolean
  /** Callback when new alert is triggered */
  onAlert?: (alert: ConfidenceAlert) => void
  /** Polling interval in milliseconds */
  pollingInterval?: number
  /** Confidence threshold for alerts */
  alertThreshold?: number
  /** Additional class names */
  className?: string
}

// ============================================================================
// Alert Configuration
// ============================================================================

const ALERT_CONFIG: Record<ConfidenceAlertType, {
  icon: typeof AlertTriangle
  title: string
  colorClasses: {
    warning: { bg: string; border: string; text: string }
    error: { bg: string; border: string; text: string }
  }
}> = {
  low_confidence: {
    icon: AlertTriangle,
    title: 'Low Transcription Confidence',
    colorClasses: {
      warning: {
        bg: 'bg-yellow-50 dark:bg-yellow-900/20',
        border: 'border-yellow-300 dark:border-yellow-700',
        text: 'text-yellow-800 dark:text-yellow-200'
      },
      error: {
        bg: 'bg-red-50 dark:bg-red-900/20',
        border: 'border-red-300 dark:border-red-700',
        text: 'text-red-800 dark:text-red-200'
      }
    }
  },
  degrading_quality: {
    icon: AlertCircle,
    title: 'Audio Quality Degrading',
    colorClasses: {
      warning: {
        bg: 'bg-orange-50 dark:bg-orange-900/20',
        border: 'border-orange-300 dark:border-orange-700',
        text: 'text-orange-800 dark:text-orange-200'
      },
      error: {
        bg: 'bg-red-50 dark:bg-red-900/20',
        border: 'border-red-300 dark:border-red-700',
        text: 'text-red-800 dark:text-red-200'
      }
    }
  },
  audio_issue: {
    icon: Volume2,
    title: 'Audio Issue Detected',
    colorClasses: {
      warning: {
        bg: 'bg-amber-50 dark:bg-amber-900/20',
        border: 'border-amber-300 dark:border-amber-700',
        text: 'text-amber-800 dark:text-amber-200'
      },
      error: {
        bg: 'bg-red-50 dark:bg-red-900/20',
        border: 'border-red-300 dark:border-red-700',
        text: 'text-red-800 dark:text-red-200'
      }
    }
  }
}

// ============================================================================
// ConfidenceAlertBanner Component
// ============================================================================

export function ConfidenceAlertBanner({
  alert,
  isRecording = true,
  currentConfidence,
  onDismiss,
  onActionClick,
  autoDismiss = false,
  autoDismissTimeout = 10000,
  showDetails = true,
  className
}: ConfidenceAlertBannerProps) {
  const [isExpanded, setIsExpanded] = useState(false)
  const [isDismissed, setIsDismissed] = useState(false)

  // Reset dismissed state when new alert comes in
  useEffect(() => {
    if (alert) {
      setIsDismissed(false)
    }
  }, [alert?.timestampMs])

  // Auto-dismiss timer
  useEffect(() => {
    if (alert && autoDismiss && !isDismissed) {
      const timer = setTimeout(() => {
        setIsDismissed(true)
        onDismiss?.()
      }, autoDismissTimeout)

      return () => clearTimeout(timer)
    }
  }, [alert, autoDismiss, autoDismissTimeout, isDismissed, onDismiss])

  const handleDismiss = useCallback(() => {
    setIsDismissed(true)
    onDismiss?.()
  }, [onDismiss])

  const handleActionClick = useCallback(() => {
    if (alert && onActionClick) {
      onActionClick(alert.suggestedAction, alert.type)
    }
  }, [alert, onActionClick])

  // Don't render if no alert, dismissed, or not recording
  if (!alert || isDismissed || !isRecording) {
    return null
  }

  const config = ALERT_CONFIG[alert.type]
  const colors = config.colorClasses[alert.severity]
  const Icon = config.icon

  return (
    <div
      className={cn(
        'rounded-lg border p-3 transition-all duration-300',
        colors.bg,
        colors.border,
        className
      )}
      role="alert"
      aria-live="polite"
      data-testid="confidence-alert-banner"
      data-alert-type={alert.type}
      data-severity={alert.severity}
    >
      <div className="flex items-start gap-3">
        {/* Icon */}
        <div className={cn('flex-shrink-0 mt-0.5', colors.text)}>
          <Icon className="w-5 h-5" />
        </div>

        {/* Content */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center justify-between gap-2">
            <h4 className={cn('font-semibold text-sm', colors.text)}>
              {config.title}
            </h4>
            <div className="flex items-center gap-2">
              {showDetails && (
                <button
                  onClick={() => setIsExpanded(!isExpanded)}
                  className={cn('p-1 rounded hover:bg-black/5 dark:hover:bg-white/5', colors.text)}
                  aria-label={isExpanded ? 'Collapse details' : 'Expand details'}
                >
                  {isExpanded ? (
                    <ChevronUp className="w-4 h-4" />
                  ) : (
                    <ChevronDown className="w-4 h-4" />
                  )}
                </button>
              )}
              <button
                onClick={handleDismiss}
                className={cn('p-1 rounded hover:bg-black/5 dark:hover:bg-white/5', colors.text)}
                aria-label="Dismiss alert"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          </div>

          <p className={cn('text-sm mt-1', colors.text, 'opacity-90')}>
            {alert.message}
          </p>

          {/* Expanded details */}
          {isExpanded && showDetails && (
            <div className="mt-3 pt-3 border-t border-current/10 space-y-2">
              {/* Confidence indicator */}
              <div className="flex items-center gap-2 text-sm">
                <span className="text-muted-foreground">Confidence:</span>
                <ConfidenceBar
                  confidence={alert.windowConfidence}
                  level={alert.windowConfidence >= 0.8 ? 'high' : alert.windowConfidence >= 0.5 ? 'medium' : 'low'}
                  showLabel={true}
                  className="flex-1 max-w-32"
                />
              </div>

              {/* Current confidence if different */}
              {currentConfidence !== undefined && currentConfidence !== alert.windowConfidence && (
                <div className="flex items-center gap-2 text-sm">
                  <span className="text-muted-foreground">Current:</span>
                  <ConfidenceBar
                    confidence={currentConfidence}
                    level={currentConfidence >= 0.8 ? 'high' : currentConfidence >= 0.5 ? 'medium' : 'low'}
                    showLabel={true}
                    className="flex-1 max-w-32"
                  />
                </div>
              )}

              {/* Timestamp */}
              <div className="text-xs text-muted-foreground">
                Detected at: {new Date(alert.timestampMs).toLocaleTimeString()}
              </div>
            </div>
          )}

          {/* Action button */}
          <div className="mt-2 flex gap-2">
            <button
              onClick={handleActionClick}
              className={cn(
                'px-3 py-1 rounded text-xs font-medium',
                'bg-white/50 dark:bg-black/20 hover:bg-white/70 dark:hover:bg-black/30',
                colors.text
              )}
            >
              {alert.suggestedAction}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

// ============================================================================
// ConfidenceAlertHistory Component
// ============================================================================

export function ConfidenceAlertHistory({
  alerts,
  maxAlerts = 5,
  showTimestamps = true,
  className
}: ConfidenceAlertHistoryProps) {
  const displayAlerts = alerts.slice(-maxAlerts).reverse()

  if (displayAlerts.length === 0) {
    return null
  }

  return (
    <div className={cn('space-y-2', className)} data-testid="confidence-alert-history">
      <h4 className="text-sm font-medium text-muted-foreground">Recent Alerts</h4>
      <div className="space-y-1">
        {displayAlerts.map((alert, index) => {
          const config = ALERT_CONFIG[alert.type]
          const colors = config.colorClasses[alert.severity]

          return (
            <div
              key={`${alert.timestampMs}-${index}`}
              className={cn(
                'flex items-center gap-2 p-2 rounded text-xs',
                colors.bg,
                colors.text,
                'opacity-80'
              )}
            >
              <config.icon className="w-3 h-3 flex-shrink-0" />
              <span className="flex-1 truncate">{alert.message}</span>
              {showTimestamps && (
                <span className="text-muted-foreground text-xs">
                  {new Date(alert.timestampMs).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                </span>
              )}
              <span className={cn(
                'px-1.5 py-0.5 rounded text-xs font-medium',
                alert.windowConfidence >= 0.5 ? 'bg-yellow-200 text-yellow-800' : 'bg-red-200 text-red-800'
              )}>
                {formatConfidencePercent(alert.windowConfidence)}
              </span>
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ============================================================================
// LiveConfidenceMonitor Component
// ============================================================================

export function LiveConfidenceMonitor({
  meetingId,
  isRecording,
  onAlert,
  pollingInterval = 5000,
  alertThreshold: _alertThreshold = 0.5,
  className
}: LiveConfidenceMonitorProps) {
  const [currentConfidence, setCurrentConfidence] = useState<number | null>(null)
  const [activeAlert, setActiveAlert] = useState<ConfidenceAlert | null>(null)
  const [alertHistory, setAlertHistory] = useState<ConfidenceAlert[]>([])
  const [isMonitoring, setIsMonitoring] = useState(false)

  // Start/stop monitoring based on recording state
  useEffect(() => {
    setIsMonitoring(isRecording)
    if (!isRecording) {
      // Reset alert state when recording stops
      setActiveAlert(null)
    }
  }, [isRecording])

  // Poll for confidence updates during recording
  useEffect(() => {
    if (!isMonitoring || !meetingId) return

    const pollConfidence = async () => {
      try {
        // Get latest trends for the meeting
        const trends = await window.electronAPI?.confidenceScoring?.getTrends(meetingId)

        if (trends && trends.length > 0) {
          const latestTrend = trends[trends.length - 1]
          setCurrentConfidence(latestTrend.window_confidence)

          // Check if an alert should be triggered
          if (latestTrend.is_alert_triggered && latestTrend.alert_type) {
            const newAlert: ConfidenceAlert = {
              type: latestTrend.alert_type as ConfidenceAlertType,
              message: getAlertMessage(latestTrend.alert_type as ConfidenceAlertType, latestTrend.window_confidence),
              severity: latestTrend.window_confidence < 0.3 ? 'error' : 'warning',
              timestampMs: latestTrend.timestamp_ms,
              windowConfidence: latestTrend.window_confidence,
              suggestedAction: getSuggestedAction(latestTrend.alert_type as ConfidenceAlertType)
            }

            setActiveAlert(newAlert)
            setAlertHistory(prev => [...prev, newAlert])
            onAlert?.(newAlert)
          }
        }
      } catch (error) {
        console.error('Error polling confidence:', error)
      }
    }

    // Initial poll
    pollConfidence()

    // Set up interval
    const interval = setInterval(pollConfidence, pollingInterval)

    return () => clearInterval(interval)
  }, [isMonitoring, meetingId, pollingInterval, onAlert])

  const handleDismissAlert = useCallback(() => {
    setActiveAlert(null)
  }, [])

  const handleActionClick = useCallback(async (action: string, alertType: ConfidenceAlertType) => {
    // Handle different actions based on alert type
    switch (alertType) {
      case 'low_confidence':
        // Could trigger auto-correction or manual review
        console.log('Low confidence action:', action)
        break
      case 'degrading_quality':
        // Could suggest audio settings adjustment
        console.log('Degrading quality action:', action)
        break
      case 'audio_issue':
        // Could open audio settings
        console.log('Audio issue action:', action)
        break
    }
    setActiveAlert(null)
  }, [])

  // Confidence level indicator
  const confidenceLevel = useMemo(() => {
    if (currentConfidence === null) return 'unknown'
    if (currentConfidence >= 0.8) return 'high'
    if (currentConfidence >= 0.5) return 'medium'
    return 'low'
  }, [currentConfidence])

  if (!isRecording) {
    return null
  }

  return (
    <div className={cn('space-y-3', className)} data-testid="live-confidence-monitor">
      {/* Current confidence indicator */}
      <div className="flex items-center gap-3 p-2 rounded-lg bg-muted/50">
        <div className="flex items-center gap-2">
          <Mic className={cn(
            'w-4 h-4',
            isMonitoring ? 'text-green-500 animate-pulse' : 'text-muted-foreground'
          )} />
          <span className="text-sm font-medium">Live Quality</span>
        </div>
        {currentConfidence !== null ? (
          <div className="flex-1">
            <ConfidenceBar
              confidence={currentConfidence}
              level={confidenceLevel as 'high' | 'medium' | 'low'}
              showLabel={true}
            />
          </div>
        ) : (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <RefreshCw className="w-3 h-3 animate-spin" />
            Monitoring...
          </div>
        )}
      </div>

      {/* Active alert */}
      {activeAlert && (
        <ConfidenceAlertBanner
          alert={activeAlert}
          isRecording={isRecording}
          currentConfidence={currentConfidence ?? undefined}
          onDismiss={handleDismissAlert}
          onActionClick={handleActionClick}
          autoDismiss={true}
          autoDismissTimeout={15000}
        />
      )}

      {/* Alert history (collapsed by default) */}
      {alertHistory.length > 0 && !activeAlert && (
        <ConfidenceAlertHistory
          alerts={alertHistory}
          maxAlerts={3}
        />
      )}
    </div>
  )
}

// ============================================================================
// Helper Functions
// ============================================================================

function getAlertMessage(type: ConfidenceAlertType, confidence: number): string {
  const percent = formatConfidencePercent(confidence)

  switch (type) {
    case 'low_confidence':
      return `Transcription confidence is at ${percent}. Some words may not be accurately captured.`
    case 'degrading_quality':
      return `Audio quality is degrading. Confidence dropped to ${percent}.`
    case 'audio_issue':
      return `Potential audio issue detected. Current confidence: ${percent}.`
    default:
      return `Transcription quality alert: ${percent} confidence.`
  }
}

function getSuggestedAction(type: ConfidenceAlertType): string {
  switch (type) {
    case 'low_confidence':
      return 'Review transcript'
    case 'degrading_quality':
      return 'Check microphone'
    case 'audio_issue':
      return 'Adjust audio settings'
    default:
      return 'View details'
  }
}

// ============================================================================
// Exports
// ============================================================================

export {
  getAlertMessage,
  getSuggestedAction,
  ALERT_CONFIG
}
