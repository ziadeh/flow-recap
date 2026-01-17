/**
 * ValidationStatusIndicator Component
 *
 * Shows real-time status of the tiered validation process.
 * Displays:
 * - Current validation tier running
 * - Overall environment readiness
 * - Background validation progress
 * - Completion status with visual indicators
 * - Validation timing metrics
 *
 * Used in Settings to show users the status of environment checks.
 */

import { useState, useEffect, useCallback } from 'react'
import {
  CheckCircle,
  XCircle,
  AlertTriangle,
  Loader2,
  Clock,
  Info,
  Zap,
  BarChart3,
  RefreshCw
} from 'lucide-react'
import { cn } from '@/lib/utils'

// ============================================================================
// Types
// ============================================================================

type ValidationTier = 'tier1' | 'tier2' | 'tier3'
type ValidationLevel = 'fast' | 'balanced' | 'thorough'
type TieredValidationStatus = 'idle' | 'running' | 'complete' | 'error'
type EnvironmentReadiness = 'ready' | 'functional' | 'degraded' | 'failed'

interface TierResult {
  tier: ValidationTier
  status: TieredValidationStatus
  duration?: number
  success: boolean
  readiness: EnvironmentReadiness
  statusMessage: string
}

interface TieredValidationState {
  currentTier: ValidationTier | null
  tier1: TierResult | null
  tier2: TierResult | null
  tier3: TierResult | null
  overallStatus: TieredValidationStatus
  overallReadiness: EnvironmentReadiness
  overallStatusMessage: string
  lastFullValidation: string | null
  isBackgroundValidationRunning: boolean
}

interface ValidationMetrics {
  tier1Duration: number | null
  tier2Duration: number | null
  tier3Duration: number | null
  totalDuration: number | null
  checksPerformed: number
  checksPassed: number
  checksFailed: number
  cacheHit: boolean
  timestamp: string
}

interface ValidationStatusIndicatorProps {
  className?: string
  showMetrics?: boolean
  showLevelSelector?: boolean
  compact?: boolean
  onValidationLevelChange?: (level: ValidationLevel) => void
}

// ============================================================================
// Helper Functions
// ============================================================================

function getReadinessColor(readiness: EnvironmentReadiness): string {
  switch (readiness) {
    case 'ready':
      return 'text-green-600 dark:text-green-400'
    case 'functional':
      return 'text-emerald-600 dark:text-emerald-400'
    case 'degraded':
      return 'text-yellow-600 dark:text-yellow-400'
    case 'failed':
      return 'text-red-600 dark:text-red-400'
    default:
      return 'text-muted-foreground'
  }
}

function getReadinessBgColor(readiness: EnvironmentReadiness): string {
  switch (readiness) {
    case 'ready':
      return 'bg-green-50 dark:bg-green-900/20'
    case 'functional':
      return 'bg-emerald-50 dark:bg-emerald-900/20'
    case 'degraded':
      return 'bg-yellow-50 dark:bg-yellow-900/20'
    case 'failed':
      return 'bg-red-50 dark:bg-red-900/20'
    default:
      return 'bg-muted'
  }
}

function getReadinessIcon(readiness: EnvironmentReadiness, isRunning: boolean) {
  if (isRunning) {
    return <Loader2 className="w-4 h-4 animate-spin text-blue-500" />
  }

  switch (readiness) {
    case 'ready':
      return <CheckCircle className="w-4 h-4 text-green-500" />
    case 'functional':
      return <CheckCircle className="w-4 h-4 text-emerald-500" />
    case 'degraded':
      return <AlertTriangle className="w-4 h-4 text-yellow-500" />
    case 'failed':
      return <XCircle className="w-4 h-4 text-red-500" />
    default:
      return <Info className="w-4 h-4 text-gray-400" />
  }
}

function getReadinessLabel(readiness: EnvironmentReadiness): string {
  switch (readiness) {
    case 'ready':
      return 'Ready'
    case 'functional':
      return 'Functional'
    case 'degraded':
      return 'Degraded'
    case 'failed':
      return 'Failed'
    default:
      return 'Unknown'
  }
}

function formatDuration(ms: number | null | undefined): string {
  if (ms === null || ms === undefined) return '-'
  if (ms < 1000) return `${ms}ms`
  return `${(ms / 1000).toFixed(1)}s`
}

function formatTimestamp(timestamp: string | null): string {
  if (!timestamp) return 'Never'
  const date = new Date(timestamp)
  const now = new Date()
  const diffMs = now.getTime() - date.getTime()
  const diffMins = Math.floor(diffMs / 60000)

  if (diffMins < 1) return 'Just now'
  if (diffMins < 60) return `${diffMins}m ago`
  const diffHours = Math.floor(diffMins / 60)
  if (diffHours < 24) return `${diffHours}h ago`
  return date.toLocaleDateString()
}

// ============================================================================
// Main Component
// ============================================================================

export function ValidationStatusIndicator({
  className,
  showMetrics = false,
  showLevelSelector = true,
  compact = false,
  onValidationLevelChange
}: ValidationStatusIndicatorProps) {
  const [state, setState] = useState<TieredValidationState | null>(null)
  const [metrics, setMetrics] = useState<ValidationMetrics | null>(null)
  const [validationLevel, setValidationLevel] = useState<ValidationLevel>('balanced')
  const [isLoading, setIsLoading] = useState(true)
  const [isRefreshing, setIsRefreshing] = useState(false)

  // Load initial state
  const loadState = useCallback(async () => {
    try {
      const api = window.electronAPI as any
      if (!api?.tieredValidation) return

      const [stateResult, levelResult, metricsResult] = await Promise.all([
        api.tieredValidation.getState(),
        api.tieredValidation.getLevel(),
        api.tieredValidation.getMetrics()
      ])

      setState(stateResult)
      setValidationLevel(levelResult || 'balanced')
      setMetrics(metricsResult?.latest || null)
    } catch (error) {
      console.error('Failed to load validation state:', error)
    } finally {
      setIsLoading(false)
    }
  }, [])

  useEffect(() => {
    loadState()

    // Subscribe to events
    const api = window.electronAPI as any
    if (!api?.tieredValidation) return

    const unsubscribers: (() => void)[] = []

    // Tier 1 events
    unsubscribers.push(
      api.tieredValidation.onTier1Start(() => {
        setState(prev => prev ? { ...prev, currentTier: 'tier1', overallStatus: 'running' } : prev)
      })
    )
    unsubscribers.push(
      api.tieredValidation.onTier1Complete((result: TierResult) => {
        setState(prev => prev ? {
          ...prev,
          tier1: result,
          overallReadiness: result.readiness,
          overallStatusMessage: result.statusMessage
        } : prev)
      })
    )

    // Tier 2 events
    unsubscribers.push(
      api.tieredValidation.onTier2Start(() => {
        setState(prev => prev ? { ...prev, currentTier: 'tier2', isBackgroundValidationRunning: true } : prev)
      })
    )
    unsubscribers.push(
      api.tieredValidation.onTier2Complete((result: TierResult) => {
        setState(prev => prev ? {
          ...prev,
          tier2: result,
          isBackgroundValidationRunning: false,
          overallStatus: 'complete',
          overallReadiness: result.readiness,
          overallStatusMessage: result.statusMessage
        } : prev)
        loadState() // Refresh metrics
      })
    )

    // Settings changed
    unsubscribers.push(
      api.tieredValidation.onSettingsChanged(({ validationLevel }: { validationLevel: ValidationLevel }) => {
        setValidationLevel(validationLevel)
      })
    )

    return () => {
      unsubscribers.forEach(unsub => unsub?.())
    }
  }, [loadState])

  const handleRefresh = async () => {
    setIsRefreshing(true)
    try {
      const api = window.electronAPI as any
      if (api?.tieredValidation) {
        // Clear the validation cache first to get fresh results
        if (api?.pythonValidation?.clearCache) {
          await api.pythonValidation.clearCache()
        }
        await api.tieredValidation.runFull(validationLevel)
        await loadState()
      }
    } finally {
      setIsRefreshing(false)
    }
  }

  const handleLevelChange = async (level: ValidationLevel) => {
    try {
      const api = window.electronAPI as any
      if (api?.tieredValidation) {
        await api.tieredValidation.setLevel(level)
        setValidationLevel(level)
        onValidationLevelChange?.(level)
      }
    } catch (error) {
      console.error('Failed to set validation level:', error)
    }
  }

  if (isLoading) {
    return (
      <div className={cn('flex items-center gap-2 text-sm text-muted-foreground', className)}>
        <Loader2 className="w-4 h-4 animate-spin" />
        <span>Loading environment status...</span>
      </div>
    )
  }

  const isRunning = state?.overallStatus === 'running' || state?.isBackgroundValidationRunning || false
  const readiness = state?.overallReadiness || 'ready'

  // Compact view for inline status display
  if (compact) {
    return (
      <div
        className={cn(
          'inline-flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-medium',
          getReadinessBgColor(readiness),
          className
        )}
        data-testid="validation-status-compact"
      >
        {getReadinessIcon(readiness, isRunning)}
        <span className={getReadinessColor(readiness)}>
          {isRunning ? 'Checking...' : state?.overallStatusMessage || getReadinessLabel(readiness)}
        </span>
        {state?.isBackgroundValidationRunning && (
          <span className="text-muted-foreground">(verifying in background)</span>
        )}
      </div>
    )
  }

  // Full view with all details
  return (
    <div
      className={cn('space-y-4 p-4 bg-card border border-border rounded-lg', className)}
      data-testid="validation-status-indicator"
    >
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Zap className="w-5 h-5 text-primary" />
          <h4 className="font-medium text-sm">Environment Check</h4>
        </div>
        <button
          onClick={handleRefresh}
          disabled={isRefreshing || isRunning}
          className="flex items-center gap-1.5 px-2 py-1 rounded text-xs font-medium bg-secondary hover:bg-accent disabled:opacity-50 transition-colors"
          data-testid="refresh-validation-btn"
        >
          <RefreshCw className={cn('w-3 h-3', (isRefreshing || isRunning) && 'animate-spin')} />
          {isRefreshing ? 'Checking...' : 'Re-check'}
        </button>
      </div>

      {/* Status Display */}
      <div className={cn('flex items-start gap-3 p-3 rounded-lg', getReadinessBgColor(readiness))}>
        {getReadinessIcon(readiness, isRunning)}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className={cn('font-medium text-sm', getReadinessColor(readiness))}>
              {isRunning ? 'Checking environment...' : getReadinessLabel(readiness)}
            </span>
            {state?.isBackgroundValidationRunning && (
              <span className="text-xs text-blue-600 dark:text-blue-400 bg-blue-100 dark:bg-blue-900/30 px-2 py-0.5 rounded-full">
                Background check in progress
              </span>
            )}
          </div>
          <p className="text-xs text-muted-foreground mt-1 truncate">
            {state?.overallStatusMessage || 'Environment status unknown'}
          </p>
          {state?.lastFullValidation && (
            <p className="text-xs text-muted-foreground mt-1 flex items-center gap-1">
              <Clock className="w-3 h-3" />
              Last checked: {formatTimestamp(state.lastFullValidation)}
            </p>
          )}
        </div>
      </div>

      {/* Validation Level Selector */}
      {showLevelSelector && (
        <div className="space-y-2">
          <label className="text-xs font-medium text-muted-foreground">Startup Validation Level</label>
          <div className="flex gap-2">
            {(['fast', 'balanced', 'thorough'] as ValidationLevel[]).map((level) => (
              <button
                key={level}
                onClick={() => handleLevelChange(level)}
                className={cn(
                  'flex-1 px-3 py-2 rounded text-xs font-medium transition-colors',
                  validationLevel === level
                    ? 'bg-primary text-primary-foreground'
                    : 'bg-secondary hover:bg-accent'
                )}
                data-testid={`validation-level-${level}`}
              >
                <div className="font-semibold capitalize">{level}</div>
                <div className="text-[10px] opacity-80 mt-0.5">
                  {level === 'fast' && 'Cached only'}
                  {level === 'balanced' && 'Verify packages'}
                  {level === 'thorough' && 'Full validation'}
                </div>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Tier Status */}
      {(state?.tier1 || state?.tier2) && (
        <div className="space-y-2">
          <label className="text-xs font-medium text-muted-foreground flex items-center gap-1.5">
            <BarChart3 className="w-3 h-3" />
            Validation Tiers
          </label>
          <div className="grid grid-cols-3 gap-2 text-xs">
            {/* Tier 1 */}
            <div className={cn(
              'p-2 rounded border',
              state?.tier1?.success
                ? 'bg-green-50 border-green-200 dark:bg-green-900/20 dark:border-green-800'
                : 'bg-muted border-border'
            )}>
              <div className="font-medium">Tier 1</div>
              <div className="text-muted-foreground text-[10px]">Startup</div>
              {state?.tier1 && (
                <div className="mt-1 text-[10px] opacity-80">
                  {formatDuration(state.tier1.duration)}
                </div>
              )}
            </div>

            {/* Tier 2 */}
            <div className={cn(
              'p-2 rounded border',
              state?.isBackgroundValidationRunning
                ? 'bg-blue-50 border-blue-200 dark:bg-blue-900/20 dark:border-blue-800'
                : state?.tier2?.success
                ? 'bg-green-50 border-green-200 dark:bg-green-900/20 dark:border-green-800'
                : 'bg-muted border-border'
            )}>
              <div className="font-medium flex items-center gap-1">
                Tier 2
                {state?.isBackgroundValidationRunning && (
                  <Loader2 className="w-3 h-3 animate-spin text-blue-500" />
                )}
              </div>
              <div className="text-muted-foreground text-[10px]">Background</div>
              {state?.tier2 && (
                <div className="mt-1 text-[10px] opacity-80">
                  {formatDuration(state.tier2.duration)}
                </div>
              )}
            </div>

            {/* Tier 3 */}
            <div className={cn(
              'p-2 rounded border',
              state?.tier3?.success
                ? 'bg-green-50 border-green-200 dark:bg-green-900/20 dark:border-green-800'
                : 'bg-muted border-border'
            )}>
              <div className="font-medium">Tier 3</div>
              <div className="text-muted-foreground text-[10px]">On-demand</div>
              {state?.tier3 && (
                <div className="mt-1 text-[10px] opacity-80">
                  {formatDuration(state.tier3.duration)}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Metrics */}
      {showMetrics && metrics && (
        <div className="space-y-2 pt-2 border-t border-border">
          <label className="text-xs font-medium text-muted-foreground">Validation Metrics</label>
          <div className="grid grid-cols-2 gap-2 text-xs">
            <div className="flex justify-between">
              <span className="text-muted-foreground">Checks performed:</span>
              <span>{metrics.checksPerformed}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Checks passed:</span>
              <span className="text-green-600 dark:text-green-400">{metrics.checksPassed}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Checks failed:</span>
              <span className={metrics.checksFailed > 0 ? 'text-red-600 dark:text-red-400' : ''}>
                {metrics.checksFailed}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Cache hit:</span>
              <span>{metrics.cacheHit ? 'Yes' : 'No'}</span>
            </div>
            {metrics.totalDuration && (
              <div className="flex justify-between col-span-2">
                <span className="text-muted-foreground">Total duration:</span>
                <span>{formatDuration(metrics.totalDuration)}</span>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

export default ValidationStatusIndicator
