/**
 * EnvironmentWarningBanner Component
 *
 * Displays a warning banner in the main UI when Python environments are degraded.
 * Shows a dismissible banner with a "Fix Now" button that navigates to Settings.
 */

import { useState, useEffect } from 'react'
import { AlertTriangle, X } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useNavigate } from 'react-router-dom'

interface EnvironmentWarningBannerProps {
  className?: string
}

export function EnvironmentWarningBanner({ className }: EnvironmentWarningBannerProps) {
  const [isVisible, setIsVisible] = useState(false)
  const [isDismissed, setIsDismissed] = useState(false)
  const [statusMessage, setStatusMessage] = useState('')
  const navigate = useNavigate()

  // Check environment status on mount and periodically
  useEffect(() => {
    const checkEnvironmentStatus = async () => {
      try {
        const api = window.electronAPI as any
        if (!api?.pythonValidation) return

        // Use cached validation result (don't force refresh on mount)
        const validation = await api.pythonValidation.validate(false)

        if (!validation) {
          setIsVisible(false)
          return
        }

        // Check for failures using the new readiness levels
        // - ready: All good, no banner needed
        // - functional: Core works, optional features not tested - no banner needed (this is fine)
        // - degraded: Show warning banner
        // - failed: Show error banner

        const readiness = validation.readiness || 'unknown'

        // Check dual environment status if available
        const dualEnv = validation.dualEnvironment
        // Get readiness status - prefer the newer readiness property, fall back to checking boolean ready flag
        const whisperxReadiness = dualEnv?.whisperxReadiness || (dualEnv?.whisperxReady ? 'ready' : 'unknown')
        const pyannoteReadiness = dualEnv?.pyannoteReadiness || (dualEnv?.pyannoteReady ? 'ready' : 'unknown')

        // Both environments are working (ready or functional) - no banner needed
        const whisperxOk = whisperxReadiness === 'ready' || whisperxReadiness === 'functional' || dualEnv?.whisperxReady === true
        const pyannoteOk = pyannoteReadiness === 'ready' || pyannoteReadiness === 'functional' || dualEnv?.pyannoteReady === true

        if (whisperxOk && pyannoteOk) {
          // Both environments are working - hide the banner
          setIsVisible(false)
          return
        }

        // Overall readiness is ready or functional - no banner needed
        if (readiness === 'ready' || readiness === 'functional') {
          setIsVisible(false)
          return
        }

        const hasCriticalFailed = validation.summary?.criticalFailed > 0
        const hasImportantFailed = validation.summary?.importantFailed > 0
        const isDualEnvIssue = dualEnv &&
          (dualEnv.whisperxReadiness === 'failed' ||
           dualEnv.pyannoteReadiness === 'failed')

        // Only show banner for actual problems (failed or degraded), not for 'functional' status
        if (hasCriticalFailed || isDualEnvIssue) {
          // Critical failure - environment won't work
          if (dualEnv?.whisperxReadiness === 'failed' &&
              dualEnv?.pyannoteReadiness === 'failed') {
            setStatusMessage('Python environments need setup. Transcription and speaker identification will not work.')
          } else if (dualEnv?.whisperxReadiness === 'failed') {
            setStatusMessage('WhisperX environment needs attention. Transcription may not work correctly.')
          } else if (dualEnv?.pyannoteReadiness === 'failed') {
            setStatusMessage('Pyannote environment needs attention. Speaker identification may not work correctly.')
          } else {
            setStatusMessage('Python environments need attention. Some features may not work correctly.')
          }
          setIsVisible(!isDismissed)
        } else if (readiness === 'degraded' || hasImportantFailed) {
          // Degraded - some important features may not work
          setStatusMessage('Python environments have issues. Some features may be degraded.')
          setIsVisible(!isDismissed)
        } else {
          // Ready, functional, or unknown - no banner needed
          setIsVisible(false)
        }
      } catch (error) {
        console.error('Failed to check environment status for banner:', error)
      }
    }

    // Delay initial check by 3 seconds to avoid blocking app startup
    const initialTimeout = setTimeout(checkEnvironmentStatus, 3000)

    // Check periodically (every 5 minutes)
    const interval = setInterval(checkEnvironmentStatus, 5 * 60 * 1000)

    // Also listen for validation complete events to update immediately
    const api = window.electronAPI as any
    let unsubscribe: (() => void) | undefined
    if (api?.pythonValidation?.onValidationComplete) {
      unsubscribe = api.pythonValidation.onValidationComplete(() => {
        checkEnvironmentStatus()
      })
    }

    return () => {
      clearTimeout(initialTimeout)
      clearInterval(interval)
      unsubscribe?.()
    }
  }, [isDismissed])

  const handleDismiss = () => {
    setIsDismissed(true)
    setIsVisible(false)
  }

  const handleFixNow = () => {
    // Navigate to settings with the 'ai' category query parameter
    navigate('/settings?category=ai')
  }

  if (!isVisible) return null

  return (
    <div
      className={cn(
        'bg-amber-50 dark:bg-amber-900/30 border-b border-amber-200 dark:border-amber-800',
        className
      )}
      data-testid="environment-warning-banner"
    >
      <div className="px-4 py-2 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <AlertTriangle className="w-4 h-4 text-amber-600 dark:text-amber-400 shrink-0" />
          <p className="text-sm text-amber-800 dark:text-amber-200">
            {statusMessage}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={handleFixNow}
            className="px-3 py-1 rounded text-xs font-medium bg-amber-600 hover:bg-amber-700 text-white transition-colors"
            data-testid="fix-now-btn"
          >
            Fix Now
          </button>
          <button
            onClick={handleDismiss}
            className="p-1 rounded hover:bg-amber-200 dark:hover:bg-amber-800 text-amber-600 dark:text-amber-400 transition-colors"
            aria-label="Dismiss warning"
            data-testid="dismiss-warning-btn"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>
    </div>
  )
}

export default EnvironmentWarningBanner
