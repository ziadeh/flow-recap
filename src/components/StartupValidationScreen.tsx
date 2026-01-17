/**
 * StartupValidationScreen Component
 *
 * A loading screen shown during app startup that performs tiered validation.
 * Features:
 * - Shows 'Loading... (checking environments in background)'
 * - Option to skip and start immediately
 * - Displays validation progress
 * - Automatically proceeds once Tier 1 validation completes
 *
 * This component replaces the simple "Loading..." message in App.tsx
 * with a more informative startup screen that runs fast Tier 1 validation
 * then kicks off Tier 2 in the background.
 */

import { useState, useEffect, useCallback } from 'react'
import { Loader2, Play, CheckCircle, AlertTriangle, XCircle, Zap } from 'lucide-react'
import { cn } from '@/lib/utils'

// ============================================================================
// Types
// ============================================================================

type EnvironmentReadiness = 'ready' | 'functional' | 'degraded' | 'failed'

interface TierResult {
  tier: string
  duration?: number
  success: boolean
  readiness: EnvironmentReadiness
  statusMessage: string
}

interface StartupValidationScreenProps {
  onComplete: () => void
  onSkip: () => void
}

// ============================================================================
// Main Component
// ============================================================================

export function StartupValidationScreen({ onComplete, onSkip }: StartupValidationScreenProps) {
  const [phase, setPhase] = useState<'initializing' | 'tier1' | 'background' | 'ready'>('initializing')
  const [tier1Result, setTier1Result] = useState<TierResult | null>(null)
  const [statusMessage, setStatusMessage] = useState('Initializing application...')
  const [showSkip, setShowSkip] = useState(false)
  const [tier2Running, setTier2Running] = useState(false)

  const runStartupValidation = useCallback(async () => {
    const api = window.electronAPI as any

    // Check if tiered validation API is available
    if (!api?.tieredValidation) {
      // No validation API available, proceed immediately
      setStatusMessage('Ready')
      setPhase('ready')
      setTimeout(onComplete, 500)
      return
    }

    try {
      // Show skip button after a short delay
      setTimeout(() => setShowSkip(true), 1000)

      // Phase 1: Run Tier 1 validation (fast, should be <500ms)
      setPhase('tier1')
      setStatusMessage('Checking environment...')

      const tier1 = await api.tieredValidation.runTier1()
      setTier1Result(tier1)

      // If Tier 1 failed critically, still proceed but show warning
      if (tier1?.readiness === 'failed') {
        setStatusMessage('Environment issues detected')
        setPhase('ready')
        setTimeout(onComplete, 1500)
        return
      }

      // Phase 2: Kick off Tier 2 in background (don't wait for it)
      setPhase('background')
      setStatusMessage('Loading... (verifying packages in background)')
      setTier2Running(true)

      // Start Tier 2 in background (non-blocking)
      api.tieredValidation.runTier2().then(() => {
        setTier2Running(false)
      }).catch((err: Error) => {
        console.error('Tier 2 validation error:', err)
        setTier2Running(false)
      })

      // Proceed immediately after Tier 1 - don't wait for Tier 2
      setPhase('ready')
      setStatusMessage(tier1?.statusMessage || 'Environment ready')

      // Small delay for visual feedback, then complete
      setTimeout(onComplete, 300)

    } catch (error) {
      console.error('Startup validation error:', error)
      setStatusMessage('Ready (validation skipped)')
      setPhase('ready')
      setTimeout(onComplete, 500)
    }
  }, [onComplete])

  useEffect(() => {
    runStartupValidation()
  }, [runStartupValidation])

  const getReadinessIcon = (readiness?: EnvironmentReadiness) => {
    if (!readiness || phase === 'initializing' || phase === 'tier1') {
      return <Loader2 className="w-8 h-8 animate-spin text-blue-500" />
    }

    switch (readiness) {
      case 'ready':
      case 'functional':
        return <CheckCircle className="w-8 h-8 text-green-500" />
      case 'degraded':
        return <AlertTriangle className="w-8 h-8 text-yellow-500" />
      case 'failed':
        return <XCircle className="w-8 h-8 text-red-500" />
      default:
        return <Loader2 className="w-8 h-8 animate-spin text-blue-500" />
    }
  }

  const handleSkip = () => {
    // Mark that we skipped validation
    const api = window.electronAPI as any
    api?.db?.settings?.set('startup.validationSkipped', true, 'general').catch(() => {})
    onSkip()
  }

  return (
    <div
      className="flex flex-col items-center justify-center h-screen bg-background"
      data-testid="startup-validation-screen"
    >
      <div className="flex flex-col items-center gap-6 max-w-md text-center">
        {/* Logo/Icon */}
        <div className="flex items-center gap-3 mb-4">
          <Zap className="w-10 h-10 text-primary" />
          <span className="text-2xl font-bold">FlowRecap</span>
        </div>

        {/* Status Icon */}
        <div className="relative">
          {getReadinessIcon(tier1Result?.readiness)}
          {tier2Running && (
            <div className="absolute -bottom-1 -right-1 bg-blue-500 rounded-full p-1">
              <Loader2 className="w-3 h-3 animate-spin text-white" />
            </div>
          )}
        </div>

        {/* Status Message */}
        <div className="space-y-2">
          <p className="text-lg font-medium text-foreground">{statusMessage}</p>
          {tier2Running && (
            <p className="text-sm text-muted-foreground">
              Verifying packages in background...
            </p>
          )}
          {tier1Result?.duration && phase === 'ready' && (
            <p className="text-xs text-muted-foreground">
              Startup check completed in {tier1Result.duration}ms
            </p>
          )}
        </div>

        {/* Progress Indicator */}
        <div className="w-64 h-1 bg-muted rounded-full overflow-hidden">
          <div
            className={cn(
              'h-full transition-all duration-500 ease-out',
              phase === 'initializing' && 'w-1/4 bg-blue-500',
              phase === 'tier1' && 'w-1/2 bg-blue-500',
              phase === 'background' && 'w-3/4 bg-blue-500',
              phase === 'ready' && 'w-full bg-green-500'
            )}
          />
        </div>

        {/* Skip Button */}
        {showSkip && phase !== 'ready' && (
          <button
            onClick={handleSkip}
            className={cn(
              'flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium',
              'bg-secondary hover:bg-accent transition-colors',
              'mt-4'
            )}
            data-testid="skip-validation-btn"
          >
            <Play className="w-4 h-4" />
            Skip and start now
          </button>
        )}

        {/* Readiness Warning */}
        {tier1Result?.readiness === 'degraded' && (
          <div className="mt-4 p-3 bg-yellow-50 dark:bg-yellow-900/20 rounded-lg text-sm">
            <p className="text-yellow-800 dark:text-yellow-200">
              Some features may be limited. Check Settings for details.
            </p>
          </div>
        )}

        {tier1Result?.readiness === 'failed' && (
          <div className="mt-4 p-3 bg-red-50 dark:bg-red-900/20 rounded-lg text-sm">
            <p className="text-red-800 dark:text-red-200">
              Environment issues detected. Transcription features may not work.
            </p>
          </div>
        )}
      </div>
    </div>
  )
}

export default StartupValidationScreen
