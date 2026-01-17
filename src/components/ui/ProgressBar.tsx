/**
 * ProgressBar Component
 *
 * A reusable progress bar with multiple variants and features.
 * Supports determinate (percentage) and indeterminate (animated) states.
 */

import { cn } from '@/lib/utils'

export type ProgressBarVariant = 'default' | 'primary' | 'success' | 'warning' | 'error'
export type ProgressBarSize = 'xs' | 'sm' | 'md' | 'lg'

interface ProgressBarProps {
  /** Progress value (0-100). If not provided, shows indeterminate animation */
  value?: number
  /** Maximum value (default 100) */
  max?: number
  /** Color variant */
  variant?: ProgressBarVariant
  /** Size of the progress bar */
  size?: ProgressBarSize
  /** Show percentage label */
  showLabel?: boolean
  /** Custom label text (overrides percentage display) */
  label?: string
  /** Whether to show indeterminate animation */
  indeterminate?: boolean
  /** Additional CSS classes for the container */
  className?: string
  /** Whether to animate the progress fill */
  animated?: boolean
  /** Whether to show striped pattern */
  striped?: boolean
}

const sizeClasses: Record<ProgressBarSize, string> = {
  xs: 'h-1',
  sm: 'h-1.5',
  md: 'h-2.5',
  lg: 'h-4'
}

const variantClasses: Record<ProgressBarVariant, { bg: string; fill: string }> = {
  default: {
    bg: 'bg-muted',
    fill: 'bg-muted-foreground'
  },
  primary: {
    bg: 'bg-purple-100 dark:bg-purple-900/30',
    fill: 'bg-purple-600 dark:bg-purple-500'
  },
  success: {
    bg: 'bg-green-100 dark:bg-green-900/30',
    fill: 'bg-green-600 dark:bg-green-500'
  },
  warning: {
    bg: 'bg-amber-100 dark:bg-amber-900/30',
    fill: 'bg-amber-600 dark:bg-amber-500'
  },
  error: {
    bg: 'bg-red-100 dark:bg-red-900/30',
    fill: 'bg-red-600 dark:bg-red-500'
  }
}

export function ProgressBar({
  value,
  max = 100,
  variant = 'primary',
  size = 'md',
  showLabel = false,
  label,
  indeterminate = false,
  className,
  animated = true,
  striped = false
}: ProgressBarProps) {
  const percentage = value !== undefined ? Math.min(Math.max((value / max) * 100, 0), 100) : 0
  const colors = variantClasses[variant]

  return (
    <div className={cn('w-full', className)}>
      {/* Label row */}
      {(showLabel || label) && (
        <div className="flex justify-between items-center mb-1">
          <span className="text-sm text-muted-foreground">
            {label || 'Progress'}
          </span>
          {showLabel && value !== undefined && (
            <span className="text-sm font-medium text-foreground">
              {Math.round(percentage)}%
            </span>
          )}
        </div>
      )}

      {/* Progress bar track */}
      <div
        className={cn(
          'w-full rounded-full overflow-hidden',
          sizeClasses[size],
          colors.bg
        )}
        role="progressbar"
        aria-valuenow={indeterminate ? undefined : percentage}
        aria-valuemin={0}
        aria-valuemax={100}
      >
        {/* Progress bar fill */}
        <div
          className={cn(
            'h-full rounded-full',
            colors.fill,
            animated && !indeterminate && 'transition-all duration-300 ease-out',
            indeterminate && 'animate-progress-indeterminate',
            striped && 'bg-stripes'
          )}
          style={{
            width: indeterminate ? '30%' : `${percentage}%`
          }}
        />
      </div>
    </div>
  )
}

/**
 * Circular Progress - A circular progress indicator
 */
interface CircularProgressProps {
  /** Progress value (0-100) */
  value?: number
  /** Size in pixels */
  size?: number
  /** Stroke width */
  strokeWidth?: number
  /** Color variant */
  variant?: ProgressBarVariant
  /** Show percentage in center */
  showLabel?: boolean
  /** Whether to show indeterminate animation */
  indeterminate?: boolean
  /** Additional CSS classes */
  className?: string
}

export function CircularProgress({
  value = 0,
  size = 48,
  strokeWidth = 4,
  variant = 'primary',
  showLabel = false,
  indeterminate = false,
  className
}: CircularProgressProps) {
  const radius = (size - strokeWidth) / 2
  const circumference = radius * 2 * Math.PI
  const percentage = Math.min(Math.max(value, 0), 100)
  const offset = circumference - (percentage / 100) * circumference

  const colors = variantClasses[variant]

  return (
    <div
      className={cn('relative inline-flex items-center justify-center', className)}
      style={{ width: size, height: size }}
    >
      <svg
        className={cn(
          'transform -rotate-90',
          indeterminate && 'animate-spin'
        )}
        width={size}
        height={size}
      >
        {/* Background circle */}
        <circle
          className={colors.bg}
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          strokeWidth={strokeWidth}
          stroke="currentColor"
        />
        {/* Progress circle */}
        <circle
          className={cn(colors.fill, 'transition-all duration-300 ease-out')}
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          strokeWidth={strokeWidth}
          stroke="currentColor"
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={indeterminate ? circumference * 0.75 : offset}
        />
      </svg>
      {showLabel && !indeterminate && (
        <span className="absolute text-xs font-medium text-foreground">
          {Math.round(percentage)}%
        </span>
      )}
    </div>
  )
}

/**
 * TranscriptionProgress - Specialized progress bar for transcription
 */
interface TranscriptionProgressProps {
  /** Current phase of transcription */
  phase: 'initializing' | 'transcribing' | 'processing' | 'diarizing' | 'complete'
  /** Progress percentage (0-100) */
  progress: number
  /** Optional message to display */
  message?: string
  /** Additional CSS classes */
  className?: string
}

const phaseConfig: Record<TranscriptionProgressProps['phase'], { label: string; variant: ProgressBarVariant }> = {
  initializing: { label: 'Initializing...', variant: 'default' },
  transcribing: { label: 'Transcribing', variant: 'primary' },
  processing: { label: 'Processing', variant: 'warning' },
  diarizing: { label: 'Identifying Speakers', variant: 'success' },
  complete: { label: 'Complete', variant: 'success' }
}

export function TranscriptionProgress({
  phase,
  progress,
  message,
  className
}: TranscriptionProgressProps) {
  const config = phaseConfig[phase]

  return (
    <div className={cn('space-y-2', className)}>
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          {phase !== 'complete' && (
            <div className="w-2 h-2 rounded-full bg-purple-600 animate-pulse" />
          )}
          <span className="text-sm font-medium text-foreground">{config.label}</span>
        </div>
        <span className="text-sm text-muted-foreground">{Math.round(progress)}%</span>
      </div>
      <ProgressBar
        value={progress}
        variant={config.variant}
        size="sm"
        animated
      />
      {message && (
        <p className="text-xs text-muted-foreground">{message}</p>
      )}
    </div>
  )
}

export default ProgressBar
