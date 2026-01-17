/**
 * Toast Notification Store
 *
 * Manages global state for toast notifications with support for
 * success, error, warning, and info states.
 */

import { create } from 'zustand'
import { useShallow } from 'zustand/react/shallow'

export type ToastType = 'success' | 'error' | 'warning' | 'info'

export interface Toast {
  id: string
  type: ToastType
  title: string
  message?: string
  duration?: number
  action?: {
    label: string
    onClick: () => void
  }
  dismissible?: boolean
}

export interface ToastOptions {
  title: string
  message?: string
  duration?: number
  action?: {
    label: string
    onClick: () => void
  }
  dismissible?: boolean
}

interface ToastStore {
  toasts: Toast[]

  // Actions
  addToast: (type: ToastType, options: ToastOptions) => string
  removeToast: (id: string) => void
  clearAllToasts: () => void

  // Convenience methods
  success: (title: string, message?: string, options?: Partial<ToastOptions>) => string
  error: (title: string, message?: string, options?: Partial<ToastOptions>) => string
  warning: (title: string, message?: string, options?: Partial<ToastOptions>) => string
  info: (title: string, message?: string, options?: Partial<ToastOptions>) => string
}

// Default duration in milliseconds
const DEFAULT_DURATION = 5000
const ERROR_DURATION = 8000 // Errors stay longer

// Generate unique ID
const generateId = (): string => {
  return `toast-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`
}

export const useToastStore = create<ToastStore>((set, get) => ({
  toasts: [],

  addToast: (type: ToastType, options: ToastOptions): string => {
    const id = generateId()
    const duration = options.duration ?? (type === 'error' ? ERROR_DURATION : DEFAULT_DURATION)

    const toast: Toast = {
      id,
      type,
      title: options.title,
      message: options.message,
      duration,
      action: options.action,
      dismissible: options.dismissible ?? true
    }

    set((state) => ({
      toasts: [...state.toasts, toast]
    }))

    // Auto-remove after duration (unless duration is 0 for persistent toasts)
    if (duration > 0) {
      setTimeout(() => {
        get().removeToast(id)
      }, duration)
    }

    return id
  },

  removeToast: (id: string) => {
    set((state) => ({
      toasts: state.toasts.filter((toast) => toast.id !== id)
    }))
  },

  clearAllToasts: () => {
    set({ toasts: [] })
  },

  // Convenience methods for common toast types
  success: (title: string, message?: string, options?: Partial<ToastOptions>): string => {
    return get().addToast('success', { title, message, ...options })
  },

  error: (title: string, message?: string, options?: Partial<ToastOptions>): string => {
    return get().addToast('error', { title, message, ...options })
  },

  warning: (title: string, message?: string, options?: Partial<ToastOptions>): string => {
    return get().addToast('warning', { title, message, ...options })
  },

  info: (title: string, message?: string, options?: Partial<ToastOptions>): string => {
    return get().addToast('info', { title, message, ...options })
  }
}))

// Selector hooks for specific use cases
export const useToasts = () => useToastStore((state) => state.toasts)

// Use shallow equality check to prevent unnecessary re-renders
// This ensures the actions object is stable across renders
export const useToastActions = () =>
  useToastStore(
    useShallow((state) => ({
      success: state.success,
      error: state.error,
      warning: state.warning,
      info: state.info,
      removeToast: state.removeToast,
      clearAllToasts: state.clearAllToasts
    }))
  )
