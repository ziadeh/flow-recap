/**
 * Update Notification Component
 *
 * Displays a notification banner when an update is available.
 * Shows download progress and provides install/dismiss actions.
 */

import { useEffect } from 'react'
import { createPortal } from 'react-dom'
import { cn } from '@/lib/utils'
import {
  Download,
  RefreshCw,
  X,
  CheckCircle,
  AlertCircle,
  Loader2,
  ArrowDownToLine
} from 'lucide-react'
import {
  useUpdateState,
  useUpdateNotification,
  useUpdateActions
} from '@/stores'

// ============================================================================
// Progress Bar Component
// ============================================================================

interface ProgressBarProps {
  progress: number
  bytesDownloaded: number
  totalBytes: number
}

function DownloadProgressBar({ progress, bytesDownloaded, totalBytes }: ProgressBarProps) {
  const formatBytes = (bytes: number): string => {
    if (bytes === 0) return '0 B'
    const k = 1024
    const sizes = ['B', 'KB', 'MB', 'GB']
    const i = Math.floor(Math.log(bytes) / Math.log(k))
    return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`
  }

  return (
    <div className="w-full">
      <div className="flex items-center justify-between text-xs text-muted-foreground mb-1">
        <span>Downloading...</span>
        <span>
          {formatBytes(bytesDownloaded)} / {formatBytes(totalBytes)} ({Math.round(progress)}%)
        </span>
      </div>
      <div className="h-2 bg-primary/20 rounded-full overflow-hidden">
        <div
          className="h-full bg-primary transition-all duration-300 ease-out rounded-full"
          style={{ width: `${progress}%` }}
        />
      </div>
    </div>
  )
}

// ============================================================================
// Update Notification Component
// ============================================================================

export function UpdateNotification() {
  const state = useUpdateState()
  const notification = useUpdateNotification()
  const actions = useUpdateActions()

  // Set up listener for status changes from main process
  useEffect(() => {
    const unsubscribe = window.electronAPI.update.onStatusChange((newState) => {
      actions.setState(newState)

      // Show notification when update is available
      if (newState.status === 'available') {
        actions.setNotificationVisible(true)
      }
    })

    // Initial state fetch
    window.electronAPI.update.getState().then((initialState) => {
      actions.setState(initialState)
    })

    return unsubscribe
  }, [actions])

  // Auto-check for updates on mount (only once)
  useEffect(() => {
    const checkOnStartup = async () => {
      // Only check if we haven't checked recently (within 1 hour)
      const oneHour = 60 * 60 * 1000
      if (!state.lastChecked || Date.now() - state.lastChecked > oneHour) {
        await actions.checkForUpdates()
      }
    }

    // Delay the check slightly to not interfere with app startup
    const timer = setTimeout(checkOnStartup, 5000)
    return () => clearTimeout(timer)
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // Don't render if notification is dismissed and not in a relevant state
  if (!notification.isVisible && state.status !== 'downloading' && state.status !== 'downloaded') {
    return null
  }

  const handleDownload = async () => {
    await actions.downloadUpdate()
  }

  const handleInstall = async () => {
    await actions.installUpdate()
  }

  const handleDismiss = () => {
    actions.dismissNotification()
  }

  const renderContent = () => {
    switch (state.status) {
      case 'checking':
        return (
          <div className="flex items-center gap-3">
            <Loader2 className="h-5 w-5 animate-spin text-primary" />
            <span className="text-sm font-medium">Checking for updates...</span>
          </div>
        )

      case 'available':
        return (
          <div className="flex items-center justify-between w-full gap-4">
            <div className="flex items-center gap-3">
              <ArrowDownToLine className="h-5 w-5 text-primary" />
              <div>
                <span className="text-sm font-medium">
                  Update available: v{state.availableVersion}
                </span>
                {state.releaseNotes && (
                  <p className="text-xs text-muted-foreground mt-0.5 line-clamp-1">
                    {state.releaseNotes.substring(0, 100)}
                    {state.releaseNotes.length > 100 && '...'}
                  </p>
                )}
              </div>
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={handleDownload}
                className={cn(
                  'flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium rounded-md',
                  'bg-primary text-primary-foreground hover:bg-primary/90',
                  'transition-colors'
                )}
                data-testid="download-update-button"
              >
                <Download className="h-4 w-4" />
                Download
              </button>
              <button
                onClick={handleDismiss}
                className="p-1.5 rounded-md hover:bg-muted transition-colors"
                aria-label="Dismiss"
              >
                <X className="h-4 w-4 text-muted-foreground" />
              </button>
            </div>
          </div>
        )

      case 'downloading':
        return (
          <div className="w-full">
            <DownloadProgressBar
              progress={state.downloadProgress}
              bytesDownloaded={state.bytesDownloaded}
              totalBytes={state.totalBytes}
            />
          </div>
        )

      case 'downloaded':
        return (
          <div className="flex items-center justify-between w-full gap-4">
            <div className="flex items-center gap-3">
              <CheckCircle className="h-5 w-5 text-green-500" />
              <span className="text-sm font-medium">
                Update downloaded. Restart to install v{state.availableVersion}
              </span>
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={handleInstall}
                className={cn(
                  'flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium rounded-md',
                  'bg-green-600 text-white hover:bg-green-700',
                  'transition-colors'
                )}
                data-testid="install-update-button"
              >
                <RefreshCw className="h-4 w-4" />
                Restart & Install
              </button>
              <button
                onClick={handleDismiss}
                className="p-1.5 rounded-md hover:bg-muted transition-colors"
                aria-label="Later"
              >
                <X className="h-4 w-4 text-muted-foreground" />
              </button>
            </div>
          </div>
        )

      case 'installing':
        return (
          <div className="flex items-center gap-3">
            <Loader2 className="h-5 w-5 animate-spin text-primary" />
            <span className="text-sm font-medium">Installing update...</span>
          </div>
        )

      case 'error':
        return (
          <div className="flex items-center justify-between w-full gap-4">
            <div className="flex items-center gap-3">
              <AlertCircle className="h-5 w-5 text-red-500" />
              <div>
                <span className="text-sm font-medium text-red-600 dark:text-red-400">
                  Update failed
                </span>
                {state.error && (
                  <p className="text-xs text-muted-foreground mt-0.5">
                    {state.error}
                  </p>
                )}
              </div>
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={() => actions.checkForUpdates()}
                className={cn(
                  'flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium rounded-md',
                  'bg-muted hover:bg-muted/80',
                  'transition-colors'
                )}
              >
                Retry
              </button>
              <button
                onClick={handleDismiss}
                className="p-1.5 rounded-md hover:bg-muted transition-colors"
                aria-label="Dismiss"
              >
                <X className="h-4 w-4 text-muted-foreground" />
              </button>
            </div>
          </div>
        )

      default:
        return null
    }
  }

  const content = renderContent()
  if (!content) return null

  return createPortal(
    <div
      role="alert"
      aria-live="polite"
      data-testid="update-notification"
      className={cn(
        'fixed top-0 left-0 right-0 z-50',
        'bg-background/95 backdrop-blur-sm border-b',
        'shadow-sm'
      )}
    >
      <div className="max-w-7xl mx-auto px-4 py-3">
        {content}
      </div>
    </div>,
    document.body
  )
}

// ============================================================================
// Update Settings Panel Component
// ============================================================================

interface UpdateSettingsProps {
  className?: string
}

export function UpdateSettings({ className }: UpdateSettingsProps) {
  const state = useUpdateState()
  const actions = useUpdateActions()

  const formatDate = (timestamp: number | null): string => {
    if (!timestamp) return 'Never'
    return new Date(timestamp).toLocaleString()
  }

  return (
    <div className={cn('space-y-4', className)}>
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-sm font-medium">Current Version</h3>
          <p className="text-sm text-muted-foreground">v{state.currentVersion}</p>
        </div>
        <button
          onClick={() => actions.checkForUpdates()}
          disabled={state.status === 'checking' || state.status === 'downloading'}
          className={cn(
            'flex items-center gap-2 px-3 py-2 text-sm font-medium rounded-md',
            'bg-primary text-primary-foreground',
            'hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed',
            'transition-colors'
          )}
          data-testid="check-updates-button"
        >
          {state.status === 'checking' ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <RefreshCw className="h-4 w-4" />
          )}
          Check for Updates
        </button>
      </div>

      <div className="text-sm text-muted-foreground">
        Last checked: {formatDate(state.lastChecked)}
      </div>

      {state.status === 'available' && (
        <div className="p-3 bg-primary/10 rounded-md">
          <p className="text-sm font-medium text-primary">
            Update available: v{state.availableVersion}
          </p>
          {state.releaseNotes && (
            <p className="text-xs text-muted-foreground mt-1">
              {state.releaseNotes}
            </p>
          )}
        </div>
      )}

      {state.status === 'error' && state.error && (
        <div className="p-3 bg-red-50 dark:bg-red-950/30 rounded-md">
          <p className="text-sm font-medium text-red-600 dark:text-red-400">
            Error: {state.error}
          </p>
        </div>
      )}
    </div>
  )
}

export default UpdateNotification
