/**
 * ConfidenceIndicator Component
 * Displays confidence scores with color-coded visual indicators.
 * Supports different display modes: badge, bar, inline, and icon.
 */

import { useState, useCallback, useMemo } from 'react'
import { AlertCircle, CheckCircle, AlertTriangle, Eye, Edit2, X, Check } from 'lucide-react'
import { cn } from '../../lib/utils'

// ============================================================================
// Types
// ============================================================================

export type ConfidenceLevel = 'high' | 'medium' | 'low'

export interface ConfidenceThresholds {
  high: number
  medium: number
  low: number
}

export interface ConfidenceColors {
  bg: string
  text: string
  border: string
  badge: string
}

// Default thresholds matching the backend service
export const DEFAULT_THRESHOLDS: ConfidenceThresholds = {
  high: 0.8,
  medium: 0.5,
  low: 0.0
}

// Color configurations for each confidence level
export const CONFIDENCE_COLORS: Record<ConfidenceLevel, ConfidenceColors> = {
  high: {
    bg: 'bg-green-100 dark:bg-green-900/30',
    text: 'text-green-700 dark:text-green-300',
    border: 'border-green-300 dark:border-green-700',
    badge: 'bg-green-500 text-white'
  },
  medium: {
    bg: 'bg-yellow-100 dark:bg-yellow-900/30',
    text: 'text-yellow-700 dark:text-yellow-300',
    border: 'border-yellow-300 dark:border-yellow-700',
    badge: 'bg-yellow-500 text-white'
  },
  low: {
    bg: 'bg-red-100 dark:bg-red-900/30',
    text: 'text-red-700 dark:text-red-300',
    border: 'border-red-300 dark:border-red-700',
    badge: 'bg-red-500 text-white'
  }
}

export interface ConfidenceIndicatorProps {
  /** Confidence score (0-1) */
  confidence: number | null
  /** Display mode */
  mode?: 'badge' | 'bar' | 'inline' | 'icon' | 'compact'
  /** Custom thresholds */
  thresholds?: ConfidenceThresholds
  /** Whether to show percentage on hover */
  showTooltip?: boolean
  /** Whether this segment needs review */
  needsReview?: boolean
  /** Whether confidence has been manually adjusted */
  isAdjusted?: boolean
  /** Callback when user wants to adjust confidence */
  onAdjustRequest?: () => void
  /** Additional class names */
  className?: string
  /** Size variant */
  size?: 'sm' | 'md' | 'lg'
}

export interface ConfidenceBadgeProps {
  /** Confidence score (0-1) */
  confidence: number
  /** Confidence level */
  level: ConfidenceLevel
  /** Size variant */
  size?: 'sm' | 'md' | 'lg'
  /** Additional class names */
  className?: string
}

export interface ConfidenceBarProps {
  /** Confidence score (0-1) */
  confidence: number
  /** Confidence level */
  level: ConfidenceLevel
  /** Whether to show percentage label */
  showLabel?: boolean
  /** Additional class names */
  className?: string
}

export interface ManualAdjustmentDialogProps {
  /** Current confidence value */
  currentConfidence: number
  /** Whether the dialog is open */
  isOpen: boolean
  /** Callback when dialog is closed */
  onClose: () => void
  /** Callback when adjustment is submitted */
  onSubmit: (newConfidence: number, reason: string) => void
  /** Additional class names */
  className?: string
}

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Get confidence level from score
 */
export function getConfidenceLevel(
  confidence: number,
  thresholds: ConfidenceThresholds = DEFAULT_THRESHOLDS
): ConfidenceLevel {
  if (confidence >= thresholds.high) return 'high'
  if (confidence >= thresholds.medium) return 'medium'
  return 'low'
}

/**
 * Get color classes for a confidence level
 */
export function getConfidenceColors(level: ConfidenceLevel): ConfidenceColors {
  return CONFIDENCE_COLORS[level]
}

/**
 * Format confidence as percentage string
 */
export function formatConfidencePercent(confidence: number): string {
  return `${Math.round(confidence * 100)}%`
}

/**
 * Get confidence description
 */
export function getConfidenceDescription(level: ConfidenceLevel): string {
  switch (level) {
    case 'high':
      return 'High confidence - transcription is likely accurate'
    case 'medium':
      return 'Medium confidence - may contain minor errors'
    case 'low':
      return 'Low confidence - review recommended'
  }
}

// ============================================================================
// ConfidenceBadge Component
// ============================================================================

export function ConfidenceBadge({
  confidence,
  level,
  size = 'md',
  className
}: ConfidenceBadgeProps) {
  const colors = getConfidenceColors(level)
  const sizeClasses = {
    sm: 'text-xs px-1.5 py-0.5',
    md: 'text-sm px-2 py-0.5',
    lg: 'text-base px-2.5 py-1'
  }

  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full font-medium',
        colors.badge,
        sizeClasses[size],
        className
      )}
      title={getConfidenceDescription(level)}
    >
      {formatConfidencePercent(confidence)}
    </span>
  )
}

// ============================================================================
// ConfidenceBar Component
// ============================================================================

export function ConfidenceBar({
  confidence,
  level,
  showLabel = false,
  className
}: ConfidenceBarProps) {
  const colors = getConfidenceColors(level)
  const barColors = {
    high: 'bg-green-500',
    medium: 'bg-yellow-500',
    low: 'bg-red-500'
  }

  return (
    <div className={cn('flex items-center gap-2', className)}>
      <div className="flex-1 h-2 bg-muted rounded-full overflow-hidden">
        <div
          className={cn('h-full rounded-full transition-all duration-300', barColors[level])}
          style={{ width: `${confidence * 100}%` }}
        />
      </div>
      {showLabel && (
        <span className={cn('text-xs font-medium', colors.text)}>
          {formatConfidencePercent(confidence)}
        </span>
      )}
    </div>
  )
}

// ============================================================================
// ConfidenceIcon Component
// ============================================================================

function ConfidenceIcon({ level, size = 'md' }: { level: ConfidenceLevel; size?: 'sm' | 'md' | 'lg' }) {
  const colors = getConfidenceColors(level)
  const iconSizes = {
    sm: 'w-3 h-3',
    md: 'w-4 h-4',
    lg: 'w-5 h-5'
  }

  const Icon = level === 'high' ? CheckCircle : level === 'medium' ? AlertTriangle : AlertCircle

  return <Icon className={cn(iconSizes[size], colors.text)} />
}

// ============================================================================
// ManualAdjustmentDialog Component
// ============================================================================

export function ManualAdjustmentDialog({
  currentConfidence,
  isOpen,
  onClose,
  onSubmit,
  className
}: ManualAdjustmentDialogProps) {
  const [newConfidence, setNewConfidence] = useState(currentConfidence)
  const [reason, setReason] = useState('')

  const handleSubmit = useCallback((e: React.FormEvent) => {
    e.preventDefault()
    onSubmit(newConfidence, reason)
    setReason('')
    onClose()
  }, [newConfidence, reason, onSubmit, onClose])

  if (!isOpen) return null

  const level = getConfidenceLevel(newConfidence)
  const colors = getConfidenceColors(level)

  return (
    <div className={cn('fixed inset-0 z-50 flex items-center justify-center bg-black/50', className)}>
      <div className="bg-background border rounded-lg shadow-lg p-4 w-full max-w-md">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-semibold">Adjust Confidence</h3>
          <button
            onClick={onClose}
            className="text-muted-foreground hover:text-foreground"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit}>
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium mb-2">
                Confidence Level
              </label>
              <div className="flex items-center gap-4">
                <input
                  type="range"
                  min="0"
                  max="100"
                  value={newConfidence * 100}
                  onChange={(e) => setNewConfidence(Number(e.target.value) / 100)}
                  className="flex-1"
                />
                <span className={cn('text-lg font-bold', colors.text)}>
                  {formatConfidencePercent(newConfidence)}
                </span>
              </div>
              <ConfidenceBar confidence={newConfidence} level={level} className="mt-2" />
            </div>

            <div>
              <label className="block text-sm font-medium mb-2">
                Reason for adjustment (optional)
              </label>
              <textarea
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="Why are you adjusting the confidence?"
                className="w-full px-3 py-2 border rounded-lg bg-background text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary"
                rows={2}
              />
            </div>

            <div className="flex gap-2 justify-end">
              <button
                type="button"
                onClick={onClose}
                className="px-4 py-2 text-sm font-medium text-muted-foreground hover:text-foreground"
              >
                Cancel
              </button>
              <button
                type="submit"
                className="px-4 py-2 text-sm font-medium bg-primary text-primary-foreground rounded-lg hover:bg-primary/90"
              >
                Save Adjustment
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  )
}

// ============================================================================
// Main ConfidenceIndicator Component
// ============================================================================

export function ConfidenceIndicator({
  confidence,
  mode = 'badge',
  thresholds = DEFAULT_THRESHOLDS,
  showTooltip = true,
  needsReview = false,
  isAdjusted = false,
  onAdjustRequest,
  className,
  size = 'md'
}: ConfidenceIndicatorProps) {
  // Dialog state for manual adjustment (future use)
  const [_showDialog, _setShowDialog] = useState(false)

  // Handle null confidence
  if (confidence === null) {
    return (
      <span className={cn('text-muted-foreground text-xs', className)}>
        N/A
      </span>
    )
  }

  const level = getConfidenceLevel(confidence, thresholds)
  const colors = getConfidenceColors(level)
  const description = getConfidenceDescription(level)

  const tooltipContent = useMemo(() => {
    let content = `${formatConfidencePercent(confidence)} - ${description}`
    if (isAdjusted) content += ' (manually adjusted)'
    if (needsReview) content += ' - Review needed'
    return content
  }, [confidence, description, isAdjusted, needsReview])

  const renderIndicator = () => {
    switch (mode) {
      case 'badge':
        return (
          <ConfidenceBadge
            confidence={confidence}
            level={level}
            size={size}
          />
        )

      case 'bar':
        return (
          <ConfidenceBar
            confidence={confidence}
            level={level}
            showLabel={true}
          />
        )

      case 'icon':
        return <ConfidenceIcon level={level} size={size} />

      case 'compact':
        return (
          <span className={cn('text-xs font-medium', colors.text)}>
            {formatConfidencePercent(confidence)}
          </span>
        )

      case 'inline':
      default:
        return (
          <span
            className={cn(
              'inline-flex items-center gap-1 px-1.5 py-0.5 rounded',
              colors.bg,
              colors.text,
              'text-xs font-medium'
            )}
          >
            <ConfidenceIcon level={level} size="sm" />
            {formatConfidencePercent(confidence)}
          </span>
        )
    }
  }

  return (
    <div
      className={cn('inline-flex items-center gap-1', className)}
      title={showTooltip ? tooltipContent : undefined}
    >
      {renderIndicator()}

      {/* Review needed flag */}
      {needsReview && (
        <span
          className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300 text-xs font-medium"
          title="This segment needs review due to low confidence"
        >
          <Eye className="w-3 h-3" />
          Review
        </span>
      )}

      {/* Adjusted indicator */}
      {isAdjusted && (
        <span
          className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300 text-xs"
          title="Confidence has been manually adjusted"
        >
          <Check className="w-3 h-3" />
        </span>
      )}

      {/* Adjust button */}
      {onAdjustRequest && (
        <button
          onClick={onAdjustRequest}
          className="p-1 text-muted-foreground hover:text-foreground transition-colors"
          title="Manually adjust confidence"
        >
          <Edit2 className="w-3 h-3" />
        </button>
      )}
    </div>
  )
}

// ============================================================================
// ReviewNeededBadge Component
// ============================================================================

export interface ReviewNeededBadgeProps {
  /** Number of segments needing review */
  count: number
  /** Callback when clicked */
  onClick?: () => void
  /** Additional class names */
  className?: string
}

export function ReviewNeededBadge({ count, onClick, className }: ReviewNeededBadgeProps) {
  if (count === 0) return null

  return (
    <button
      onClick={onClick}
      className={cn(
        'inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full',
        'bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300',
        'text-sm font-medium hover:bg-amber-200 dark:hover:bg-amber-900/50 transition-colors',
        className
      )}
      title={`${count} segment${count !== 1 ? 's' : ''} need${count === 1 ? 's' : ''} review`}
    >
      <Eye className="w-4 h-4" />
      <span>{count} need{count === 1 ? 's' : ''} review</span>
    </button>
  )
}

// ============================================================================
// ConfidenceHighlight Component (for wrapping text)
// ============================================================================

export interface ConfidenceHighlightProps {
  /** Confidence score (0-1) */
  confidence: number | null
  /** Custom thresholds */
  thresholds?: ConfidenceThresholds
  /** Children to wrap */
  children: React.ReactNode
  /** Whether to show background highlight */
  showBackground?: boolean
  /** Whether to show border */
  showBorder?: boolean
  /** Additional class names */
  className?: string
}

export function ConfidenceHighlight({
  confidence,
  thresholds = DEFAULT_THRESHOLDS,
  children,
  showBackground = true,
  showBorder = false,
  className
}: ConfidenceHighlightProps) {
  if (confidence === null) {
    return <span className={className}>{children}</span>
  }

  const level = getConfidenceLevel(confidence, thresholds)
  const colors = getConfidenceColors(level)

  return (
    <span
      className={cn(
        'transition-colors rounded',
        showBackground && colors.bg,
        showBorder && `border ${colors.border}`,
        className
      )}
    >
      {children}
    </span>
  )
}

// ============================================================================
// Exports
// ============================================================================

export {
  ConfidenceIcon,
  getConfidenceLevel as calculateConfidenceLevel,
  getConfidenceColors as getColorsForLevel
}
