/**
 * Toast Notification Component
 *
 * Displays toast notifications with different types (success, error, warning, info)
 * with support for actions, dismissal, and auto-removal.
 */

import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { cn } from '@/lib/utils'
import {
  CheckCircle,
  XCircle,
  AlertTriangle,
  Info,
  X
} from 'lucide-react'
import { useToasts, useToastActions, Toast as ToastType, ToastType as ToastVariant } from '@/stores'

// Icon mapping for toast types
const toastIcons: Record<ToastVariant, React.ReactNode> = {
  success: <CheckCircle className="h-5 w-5" />,
  error: <XCircle className="h-5 w-5" />,
  warning: <AlertTriangle className="h-5 w-5" />,
  info: <Info className="h-5 w-5" />
}

// Color classes for toast types
const toastColors: Record<ToastVariant, {
  bg: string
  border: string
  icon: string
  title: string
}> = {
  success: {
    bg: 'bg-green-50 dark:bg-green-950/50',
    border: 'border-green-200 dark:border-green-800',
    icon: 'text-green-600 dark:text-green-400',
    title: 'text-green-800 dark:text-green-200'
  },
  error: {
    bg: 'bg-red-50 dark:bg-red-950/50',
    border: 'border-red-200 dark:border-red-800',
    icon: 'text-red-600 dark:text-red-400',
    title: 'text-red-800 dark:text-red-200'
  },
  warning: {
    bg: 'bg-amber-50 dark:bg-amber-950/50',
    border: 'border-amber-200 dark:border-amber-800',
    icon: 'text-amber-600 dark:text-amber-400',
    title: 'text-amber-800 dark:text-amber-200'
  },
  info: {
    bg: 'bg-blue-50 dark:bg-blue-950/50',
    border: 'border-blue-200 dark:border-blue-800',
    icon: 'text-blue-600 dark:text-blue-400',
    title: 'text-blue-800 dark:text-blue-200'
  }
}

interface ToastItemProps {
  toast: ToastType
  onDismiss: (id: string) => void
}

function ToastItem({ toast, onDismiss }: ToastItemProps) {
  const [isExiting, setIsExiting] = useState(false)
  const [isVisible, setIsVisible] = useState(false)

  // Animate in on mount
  useEffect(() => {
    const timer = setTimeout(() => setIsVisible(true), 10)
    return () => clearTimeout(timer)
  }, [])

  const handleDismiss = () => {
    setIsExiting(true)
    setTimeout(() => onDismiss(toast.id), 200)
  }

  const colors = toastColors[toast.type]

  return (
    <div
      role="alert"
      aria-live="polite"
      data-testid={`toast-${toast.type}`}
      className={cn(
        'relative flex items-start gap-3 w-full max-w-sm p-4 rounded-lg border shadow-lg backdrop-blur-sm',
        'transition-all duration-200 ease-out',
        colors.bg,
        colors.border,
        isVisible && !isExiting
          ? 'translate-x-0 opacity-100'
          : 'translate-x-full opacity-0'
      )}
    >
      {/* Icon */}
      <div className={cn('flex-shrink-0 mt-0.5', colors.icon)}>
        {toastIcons[toast.type]}
      </div>

      {/* Content */}
      <div className="flex-1 min-w-0">
        <p className={cn('text-sm font-medium', colors.title)}>
          {toast.title}
        </p>
        {toast.message && (
          <p className="mt-1 text-sm text-muted-foreground">
            {toast.message}
          </p>
        )}
        {toast.action && (
          <button
            onClick={() => {
              toast.action?.onClick()
              handleDismiss()
            }}
            className={cn(
              'mt-2 text-sm font-medium underline-offset-4 hover:underline',
              colors.title
            )}
          >
            {toast.action.label}
          </button>
        )}
      </div>

      {/* Dismiss button */}
      {toast.dismissible !== false && (
        <button
          onClick={handleDismiss}
          className={cn(
            'flex-shrink-0 p-1 rounded-md transition-colors',
            'hover:bg-black/10 dark:hover:bg-white/10',
            'text-muted-foreground hover:text-foreground'
          )}
          aria-label="Dismiss notification"
        >
          <X className="h-4 w-4" />
        </button>
      )}
    </div>
  )
}

/**
 * Toast Container Component
 *
 * Renders all active toasts in a fixed position container.
 * Should be placed at the root of your app (e.g., in Layout).
 */
export function ToastContainer() {
  const toasts = useToasts()
  const { removeToast } = useToastActions()

  // Don't render portal if no toasts
  if (toasts.length === 0) return null

  return createPortal(
    <div
      aria-label="Notifications"
      className={cn(
        'fixed bottom-4 right-4 z-[100] flex flex-col gap-2',
        'pointer-events-none'
      )}
    >
      {toasts.map((toast) => (
        <div key={toast.id} className="pointer-events-auto">
          <ToastItem toast={toast} onDismiss={removeToast} />
        </div>
      ))}
    </div>,
    document.body
  )
}

export default ToastContainer
