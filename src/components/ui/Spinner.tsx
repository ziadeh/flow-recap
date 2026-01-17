/**
 * Spinner Component
 *
 * A reusable loading spinner with multiple size and color variants.
 */

import { cn } from '@/lib/utils'
import { Loader2 } from 'lucide-react'

export type SpinnerSize = 'xs' | 'sm' | 'md' | 'lg' | 'xl'
export type SpinnerVariant = 'default' | 'primary' | 'secondary' | 'success' | 'warning' | 'error'

interface SpinnerProps {
  /** Size of the spinner */
  size?: SpinnerSize
  /** Color variant */
  variant?: SpinnerVariant
  /** Optional label text */
  label?: string
  /** Additional CSS classes */
  className?: string
  /** Whether to center the spinner in its container */
  centered?: boolean
}

const sizeClasses: Record<SpinnerSize, string> = {
  xs: 'w-3 h-3',
  sm: 'w-4 h-4',
  md: 'w-6 h-6',
  lg: 'w-8 h-8',
  xl: 'w-12 h-12'
}

const variantClasses: Record<SpinnerVariant, string> = {
  default: 'text-muted-foreground',
  primary: 'text-purple-600 dark:text-purple-400',
  secondary: 'text-blue-600 dark:text-blue-400',
  success: 'text-green-600 dark:text-green-400',
  warning: 'text-amber-600 dark:text-amber-400',
  error: 'text-red-600 dark:text-red-400'
}

export function Spinner({
  size = 'md',
  variant = 'primary',
  label,
  className,
  centered = false
}: SpinnerProps) {
  const spinner = (
    <div className={cn(
      'inline-flex flex-col items-center gap-2',
      centered && 'justify-center',
      className
    )}>
      <Loader2
        className={cn(
          'animate-spin',
          sizeClasses[size],
          variantClasses[variant]
        )}
      />
      {label && (
        <span className={cn(
          'text-muted-foreground',
          size === 'xs' || size === 'sm' ? 'text-xs' : 'text-sm'
        )}>
          {label}
        </span>
      )}
    </div>
  )

  if (centered) {
    return (
      <div className="flex items-center justify-center w-full h-full min-h-[100px]">
        {spinner}
      </div>
    )
  }

  return spinner
}

/**
 * Inline Spinner - Small spinner for inline use (buttons, etc.)
 */
export function InlineSpinner({
  size = 'sm',
  className
}: {
  size?: SpinnerSize
  className?: string
}) {
  return (
    <Loader2
      className={cn(
        'animate-spin',
        sizeClasses[size],
        className
      )}
    />
  )
}

/**
 * Page Loading Spinner - Full page centered loading state
 */
export function PageSpinner({ label = 'Loading...' }: { label?: string }) {
  return (
    <div className="flex items-center justify-center min-h-[400px]">
      <Spinner size="xl" variant="primary" label={label} />
    </div>
  )
}

/**
 * Button Spinner - For use inside buttons during loading states
 */
export function ButtonSpinner({ className }: { className?: string }) {
  return <InlineSpinner size="sm" className={cn('mr-2', className)} />
}

export default Spinner
