/**
 * ModelDownloadPrompt Component
 *
 * A non-blocking prompt that appears when PyAnnote models are missing.
 * Shows a dismissable banner at the top of the app with a download button.
 * Can also show a full modal for first-run download prompts.
 */

import { useState, useEffect } from 'react'
import { X, AlertCircle, Settings } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { ModelDownloadModal } from './ModelDownloadModal'

// ============================================================================
// Types
// ============================================================================

export interface ModelDownloadPromptProps {
  /** Whether to show a modal prompt instead of a banner */
  showAsModal?: boolean
  /** Called when user dismisses the prompt */
  onDismiss?: () => void
  /** Called when models are successfully downloaded */
  onDownloadComplete?: () => void
}

interface PyannoteModelsStatus {
  allAvailable: boolean
  downloading: boolean
  missingModels: string[]
  totalDownloadSize: number
  totalDownloadSizeFormatted: string
  hfTokenConfigured: boolean
  modelsLocation: 'bundled' | 'cache' | 'none'
}

// ============================================================================
// Component
// ============================================================================

export function ModelDownloadPrompt({
  showAsModal = false,
  onDismiss,
  onDownloadComplete
}: ModelDownloadPromptProps) {
  const navigate = useNavigate()
  const [status, setStatus] = useState<PyannoteModelsStatus | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [dismissed, setDismissed] = useState(false)
  const [showModal, setShowModal] = useState(false)

  useEffect(() => {
    checkModelStatus()

    // Listen for validation complete events to refresh model status
    const api = window.electronAPI as any
    let unsubscribeValidation: (() => void) | undefined
    let unsubscribeDownload: (() => void) | undefined

    if (api?.pythonValidation?.onValidationComplete) {
      unsubscribeValidation = api.pythonValidation.onValidationComplete(() => {
        // Refresh model status when validation completes
        checkModelStatus()
      })
    }

    // Listen for model download complete events
    if (api?.modelManager?.onDownloadComplete) {
      unsubscribeDownload = api.modelManager.onDownloadComplete(() => {
        // Refresh model status when download completes
        checkModelStatus()
      })
    }

    // Also check periodically (every 5 minutes)
    const interval = setInterval(checkModelStatus, 5 * 60 * 1000)

    return () => {
      unsubscribeValidation?.()
      unsubscribeDownload?.()
      clearInterval(interval)
    }
  }, [])

  const checkModelStatus = async () => {
    try {
      const api = window.electronAPI as any

      // Check both model status AND capability status to ensure we don't show banner
      // when the system is actually working
      const [modelStatus, capabilities] = await Promise.all([
        api?.modelManager?.getPyannoteStatus?.() || { allAvailable: false },
        api?.diarizationHealth?.getCapabilities?.() || { available: false }
      ])

      // Only consider models "missing" if they're not downloaded AND the system isn't working
      // This prevents showing the banner when models are available and working
      const effectiveStatus = {
        ...modelStatus,
        allAvailable: modelStatus.allAvailable || capabilities.available
      }

      setStatus(effectiveStatus)

      // Auto-show modal for first-run if showAsModal is true
      if (showAsModal && !effectiveStatus.allAvailable) {
        setShowModal(true)
      }

      // If models become available, update dismissed state to show again next time if needed
      if (effectiveStatus.allAvailable && dismissed) {
        setDismissed(false)
      }
    } catch (error) {
      console.error('[ModelDownloadPrompt] Error checking status:', error)
    } finally {
      setIsLoading(false)
    }
  }

  const handleDismiss = () => {
    setDismissed(true)
    onDismiss?.()
  }

  const handleDownloadComplete = () => {
    checkModelStatus()
    setShowModal(false)
    onDownloadComplete?.()
  }

  const handleOpenSettings = () => {
    // Navigate to Settings page, Speaker ID tab
    navigate('/settings?category=speaker-id')
  }

  // Don't show anything while loading
  if (isLoading) {
    return null
  }

  // Don't show if models are available
  if (status?.allAvailable) {
    return null
  }

  // Don't show if dismissed (for banner mode)
  if (dismissed && !showAsModal) {
    return null
  }

  // Modal mode
  if (showAsModal) {
    return (
      <ModelDownloadModal
        isOpen={showModal}
        onClose={() => {
          setShowModal(false)
          onDismiss?.()
        }}
        onDownloadComplete={handleDownloadComplete}
      />
    )
  }

  // Banner mode
  return (
    <div
      className="bg-amber-50 dark:bg-amber-900/30 border-b border-amber-200 dark:border-amber-800"
      data-testid="model-download-banner"
    >
      <div className="max-w-7xl mx-auto px-4 py-3 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <AlertCircle className="w-5 h-5 text-amber-600 dark:text-amber-400" />
            <div className="flex flex-col sm:flex-row sm:items-center gap-1 sm:gap-2">
              <p className="text-sm font-medium text-amber-800 dark:text-amber-200">
                Speaker identification models required
              </p>
              <p className="text-xs text-amber-600 dark:text-amber-400">
                {status?.totalDownloadSizeFormatted || '~500MB'} download
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={handleOpenSettings}
              className="flex items-center gap-1 px-3 py-1.5 text-sm font-medium rounded-md bg-amber-600 text-white hover:bg-amber-700 transition-colors"
              title="Open Settings to download models"
            >
              <Settings className="w-4 h-4" />
              Open Settings
            </button>
            <button
              onClick={handleDismiss}
              className="p-1 text-amber-600 dark:text-amber-400 hover:text-amber-800 dark:hover:text-amber-200"
              aria-label="Dismiss"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>
      </div>

      {/* Download Modal */}
      <ModelDownloadModal
        isOpen={showModal}
        onClose={() => setShowModal(false)}
        onDownloadComplete={handleDownloadComplete}
      />
    </div>
  )
}

/**
 * Hook to check if PyAnnote models need to be downloaded
 */
export function useModelDownloadStatus() {
  const [status, setStatus] = useState<PyannoteModelsStatus | null>(null)
  const [isLoading, setIsLoading] = useState(true)

  useEffect(() => {
    checkStatus()
  }, [])

  const checkStatus = async () => {
    try {
      const api = window.electronAPI as any
      if (api?.modelManager?.getPyannoteStatus) {
        const result = await api.modelManager.getPyannoteStatus()
        setStatus(result)
      }
    } catch (error) {
      console.error('[useModelDownloadStatus] Error:', error)
    } finally {
      setIsLoading(false)
    }
  }

  return {
    status,
    isLoading,
    needsDownload: !isLoading && status && !status.allAvailable,
    refresh: checkStatus
  }
}

export default ModelDownloadPrompt
