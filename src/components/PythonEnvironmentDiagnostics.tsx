/**
 * PythonEnvironmentDiagnostics Component
 *
 * Comprehensive Python environment validation and diagnostics UI for
 * Settings > Speaker ID page. Displays validation results and provides
 * auto-repair functionality.
 *
 * Features:
 * - Real-time validation status
 * - Detailed check results with remediation steps
 * - One-click auto-repair button
 * - Environment info display
 * - Export diagnostics report
 * - Fallback mode toggle
 */

import { useState, useEffect } from 'react'
import {
  CheckCircle,
  XCircle,
  AlertTriangle,
  RefreshCw,
  Wrench,
  Download,
  ChevronDown,
  ChevronUp,
  Loader2,
  Terminal,
  Package,
  FolderOpen,
  Cpu,
  Shield,
  Play,
  Settings,
  Info,
  Clock,
  Zap,
  Database
} from 'lucide-react'
import { cn } from '@/lib/utils'

// ============================================================================
// Types
// ============================================================================

// Python validation types (matching electron/preload.ts exports)
export type ValidationStatus = 'pass' | 'fail' | 'warning' | 'skipped'

export interface ValidationCheck {
  type: string
  name: string
  status: ValidationStatus
  message: string
  duration: number
  error?: string
  remediation?: string[]
  details?: Record<string, unknown>
}

export interface ValidationResult {
  success: boolean
  timestamp: string
  checks: ValidationCheck[]
  summary: {
    total: number
    passed: number
    failed: number
    warnings: number
    skipped: number
  }
  environment: {
    type: string
    pythonVersion?: string
    pythonPath?: string
    platform: {
      os: string
      arch: string
    }
  }
  /** Dual environment paths when using separate venvs */
  dualEnvironment?: {
    whisperxPath: string | null
    pyannotePath: string | null
    whisperxReady: boolean
    pyannoteReady: boolean
  }
  packageVersions: Record<string, string>
  recommendations: string[]
  /** Cache information */
  cacheInfo?: {
    fromCache: boolean
    cachedAt?: string
    cacheAgeHours?: number
    lightweightValidation?: boolean
  }
}

export interface CacheStats {
  smartCheckingEnabled: boolean
  hasCache: boolean
  lastValidated: string | null
  cacheAgeHours: number | null
  hashesMatch: boolean
  cachedStatus: 'ready' | 'functional' | 'degraded' | 'failed' | null
}

export interface AutoRepairResult {
  success: boolean
  actionsAttempted: string[]
  actionsSucceeded: string[]
  actionsFailed: string[]
  logs: string[]
  validationAfter?: ValidationResult
}

interface PythonEnvironmentDiagnosticsProps {
  className?: string
  onFallbackModeChange?: (enabled: boolean) => void
}

// ============================================================================
// Helper Components
// ============================================================================

function StatusIcon({ status }: { status: ValidationStatus }) {
  switch (status) {
    case 'pass':
      return <CheckCircle className="w-4 h-4 text-green-500" />
    case 'fail':
      return <XCircle className="w-4 h-4 text-red-500" />
    case 'warning':
      return <AlertTriangle className="w-4 h-4 text-yellow-500" />
    case 'skipped':
      return <Info className="w-4 h-4 text-gray-400" />
  }
}

function CheckTypeIcon({ type }: { type: string }) {
  switch (type) {
    case 'python_binary':
      return <Terminal className="w-4 h-4" />
    case 'python_version':
      return <Settings className="w-4 h-4" />
    case 'package_imports':
      return <Package className="w-4 h-4" />
    case 'pyannote_model':
      return <FolderOpen className="w-4 h-4" />
    case 'native_dependencies':
      return <Cpu className="w-4 h-4" />
    case 'file_permissions':
      return <Shield className="w-4 h-4" />
    case 'subprocess_spawn':
      return <Play className="w-4 h-4" />
    case 'env_propagation':
      return <Settings className="w-4 h-4" />
    case 'dual_environment':
      return <Package className="w-4 h-4" />
    case 'torch_version':
      return <Cpu className="w-4 h-4" />
    default:
      return <Info className="w-4 h-4" />
  }
}

function CheckResultCard({ check }: { check: ValidationCheck }) {
  const [expanded, setExpanded] = useState(false)

  const hasDetails = check.error || check.remediation || check.details

  return (
    <div
      className={cn(
        'border rounded-lg overflow-hidden transition-colors',
        check.status === 'pass' && 'border-green-200 dark:border-green-800',
        check.status === 'fail' && 'border-red-200 dark:border-red-800',
        check.status === 'warning' && 'border-yellow-200 dark:border-yellow-800',
        check.status === 'skipped' && 'border-gray-200 dark:border-gray-700'
      )}
      data-testid={`check-${check.type}`}
    >
      <div
        className={cn(
          'flex items-start gap-3 p-3',
          hasDetails && 'cursor-pointer hover:bg-accent/50'
        )}
        onClick={() => hasDetails && setExpanded(!expanded)}
      >
        <div className="mt-0.5">
          <StatusIcon status={check.status} />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <CheckTypeIcon type={check.type} />
            <h4 className="font-medium text-sm">{check.name}</h4>
            <span className="text-xs text-muted-foreground">({check.duration}ms)</span>
          </div>
          <p className="text-sm text-muted-foreground">{check.message}</p>
        </div>
        {hasDetails && (
          <button className="p-1 hover:bg-accent/50 rounded">
            {expanded ? (
              <ChevronUp className="w-4 h-4 text-muted-foreground" />
            ) : (
              <ChevronDown className="w-4 h-4 text-muted-foreground" />
            )}
          </button>
        )}
      </div>

      {expanded && hasDetails && (
        <div className="border-t p-3 bg-muted/30 space-y-3">
          {check.error && (
            <div className="space-y-1">
              <p className="text-xs font-medium text-red-600 dark:text-red-400">Error:</p>
              <p className="text-xs text-muted-foreground font-mono bg-background px-2 py-1 rounded">
                {check.error}
              </p>
            </div>
          )}

          {check.remediation && check.remediation.length > 0 && (
            <div className="space-y-1">
              <p className="text-xs font-medium">Remediation Steps:</p>
              <ul className="space-y-1">
                {check.remediation.map((step: string, index: number) => (
                  <li key={index} className="text-xs text-muted-foreground flex items-start gap-2">
                    <span className="text-purple-500 mt-1">•</span>
                    <span>{step}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {check.details && Object.keys(check.details).length > 0 && (
            <div className="space-y-1">
              <p className="text-xs font-medium">Details:</p>
              <pre className="text-xs text-muted-foreground bg-background px-2 py-1 rounded overflow-x-auto">
                {JSON.stringify(check.details, null, 2)}
              </pre>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// ============================================================================
// Main Component
// ============================================================================

export function PythonEnvironmentDiagnostics({
  className,
  onFallbackModeChange
}: PythonEnvironmentDiagnosticsProps) {
  const [validation, setValidation] = useState<ValidationResult | null>(null)
  const [isValidating, setIsValidating] = useState(false)
  const [isRepairing, setIsRepairing] = useState(false)
  const [repairResult, setRepairResult] = useState<AutoRepairResult | null>(null)
  const [fallbackMode, setFallbackMode] = useState(false)
  const [expandedSection, setExpandedSection] = useState<string | null>('overview')
  const [cacheStats, setCacheStats] = useState<CacheStats | null>(null)
  const [smartCheckingEnabled, setSmartCheckingEnabled] = useState(true)

  // Load cache stats
  const loadCacheStats = async () => {
    try {
      const api = window.electronAPI as any
      if (api?.pythonValidation?.getCacheStats) {
        const stats = await api.pythonValidation.getCacheStats()
        setCacheStats(stats)
        setSmartCheckingEnabled(stats.smartCheckingEnabled)
      }
    } catch (error) {
      console.error('[PythonDiagnostics] Failed to load cache stats:', error)
    }
  }

  // Load initial validation on mount
  useEffect(() => {
    // Run validation with timeout to prevent freezing
    const validationTimeout = setTimeout(() => {
      console.warn('[PythonDiagnostics] Validation taking too long, stopping spinner')
      setIsValidating(false)
    }, 15000) // 15 second timeout

    runValidation(false).finally(() => {
      clearTimeout(validationTimeout)
    })

    loadFallbackMode().catch(error => {
      console.error('[PythonDiagnostics] Failed to load fallback mode:', error)
    })

    // Load cache stats
    loadCacheStats()

    // Subscribe to validation events
    const api = window.electronAPI as any
    if (!api?.pythonValidation) {
      console.warn('Python validation API not available')
      setIsValidating(false)
      clearTimeout(validationTimeout)
      return
    }

    const unsubStart = api.pythonValidation.onValidationStart(() => {
      setIsValidating(true)
    })

    const unsubComplete = api.pythonValidation.onValidationComplete((result: ValidationResult) => {
      setValidation(result)
      setIsValidating(false)
      clearTimeout(validationTimeout)
      // Refresh cache stats after validation completes
      loadCacheStats()
    })

    return () => {
      clearTimeout(validationTimeout)
      unsubStart()
      unsubComplete()
    }
  }, [])

  const runValidation = async (forceRefresh = true) => {
    setIsValidating(true)
    try {
      const api = window.electronAPI as any
      if (!api?.pythonValidation) {
        console.warn('Python validation API not available')
        setIsValidating(false)
        return
      }

      // Add timeout to prevent hanging (15 seconds for validation)
      const validationPromise = api.pythonValidation.validate(forceRefresh)
      const timeoutPromise = new Promise((_, reject) =>
        setTimeout(() => reject(new Error('Python validation timed out after 15 seconds')), 15000)
      )

      const result = await Promise.race([validationPromise, timeoutPromise])
      setValidation(result)
    } catch (error) {
      console.error('[PythonDiagnostics] Validation failed:', error)
      // Set a minimal validation result to show error state instead of infinite loading
      setValidation({
        success: false,
        timestamp: new Date().toISOString(),
        checks: [],
        summary: {
          total: 0,
          passed: 0,
          failed: 1,
          warnings: 0,
          skipped: 0
        },
        environment: {
          type: 'unknown',
          platform: {
            os: navigator.platform,
            arch: 'unknown'
          }
        },
        packageVersions: {},
        recommendations: ['Python validation timed out or failed. Please check your Python environment.']
      })
    } finally {
      setIsValidating(false)
    }
  }

  const loadFallbackMode = async () => {
    try {
      const prefs = await window.electronAPI.diarizationFailure.getTranscriptionOnlyMode()
      setFallbackMode(prefs?.diarizationDisabled || false)
    } catch (error) {
      console.error('[PythonDiagnostics] Failed to load fallback mode:', error)
    }
  }

  const handleAutoRepair = async () => {
    setIsRepairing(true)
    setRepairResult(null)
    try {
      const api = window.electronAPI as any
      if (!api?.pythonValidation) {
        console.warn('Python validation API not available')
        return
      }
      const result = await api.pythonValidation.autoRepair()
      setRepairResult(result)
      if (result.validationAfter) {
        setValidation(result.validationAfter)
      }
    } catch (error) {
      console.error('[PythonDiagnostics] Auto-repair failed:', error)
      setRepairResult({
        success: false,
        actionsAttempted: [],
        actionsSucceeded: [],
        actionsFailed: ['Unknown error occurred'],
        logs: [error instanceof Error ? error.message : String(error)]
      })
    } finally {
      setIsRepairing(false)
    }
  }

  const handleToggleFallbackMode = async (enabled: boolean) => {
    try {
      await window.electronAPI.diarizationFailure.setTranscriptionOnlyMode(enabled, enabled ? 'User manually enabled fallback mode' : 'User manually disabled fallback mode')
      setFallbackMode(enabled)
      onFallbackModeChange?.(enabled)
    } catch (error) {
      console.error('[PythonDiagnostics] Failed to toggle fallback mode:', error)
    }
  }

  const handleToggleSmartChecking = async (enabled: boolean) => {
    try {
      const api = window.electronAPI as any
      if (api?.pythonValidation?.setSmartChecking) {
        await api.pythonValidation.setSmartChecking(enabled)
        setSmartCheckingEnabled(enabled)
        loadCacheStats()
      }
    } catch (error) {
      console.error('[PythonDiagnostics] Failed to toggle smart checking:', error)
    }
  }

  // Format cache age for display
  const formatCacheAge = (hours: number | null): string => {
    if (hours === null) return 'N/A'
    if (hours < 1) return `${Math.round(hours * 60)} minutes ago`
    if (hours < 24) return `${Math.round(hours)} hours ago`
    return `${Math.round(hours / 24)} days ago`
  }

  const handleExportDiagnostics = async () => {
    if (!validation) return

    try {
      const report = {
        timestamp: new Date().toISOString(),
        validation,
        repairResult,
        fallbackMode,
        userAgent: navigator.userAgent,
        platform: navigator.platform
      }

      const json = JSON.stringify(report, null, 2)
      await navigator.clipboard.writeText(json)
      alert('Diagnostics report copied to clipboard!')
    } catch (error) {
      console.error('[PythonDiagnostics] Failed to export:', error)
      alert('Failed to export diagnostics')
    }
  }

  const toggleSection = (section: string) => {
    setExpandedSection(expandedSection === section ? null : section)
  }

  if (!validation && isValidating) {
    return (
      <div className={cn('flex items-center justify-center p-8', className)}>
        <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
        <span className="ml-2 text-sm text-muted-foreground">Running diagnostics...</span>
      </div>
    )
  }

  return (
    <div className={cn('space-y-4', className)} data-testid="python-diagnostics">
      {/* Header with status */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Terminal className="w-5 h-5 text-primary" />
          <h3 className="font-semibold">Python Environment Diagnostics</h3>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => runValidation(true)}
            disabled={isValidating}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-medium transition-colors bg-secondary hover:bg-accent disabled:opacity-50"
            data-testid="refresh-validation-button"
          >
            <RefreshCw className={cn('w-3.5 h-3.5', isValidating && 'animate-spin')} />
            Refresh
          </button>
        </div>
      </div>

      {validation && (
        <>
          {/* Overall Status Card */}
          <div
            className={cn(
              'p-4 rounded-lg border',
              validation.success
                ? 'bg-green-50 border-green-200 dark:bg-green-900/20 dark:border-green-800'
                : 'bg-red-50 border-red-200 dark:bg-red-900/20 dark:border-red-800'
            )}
          >
            <div className="flex items-start gap-3">
              {validation.success ? (
                <CheckCircle className="w-6 h-6 text-green-600 dark:text-green-400 shrink-0 mt-0.5" />
              ) : (
                <XCircle className="w-6 h-6 text-red-600 dark:text-red-400 shrink-0 mt-0.5" />
              )}
              <div className="flex-1">
                <h4 className={cn(
                  'font-medium mb-1',
                  validation.success
                    ? 'text-green-700 dark:text-green-300'
                    : 'text-red-700 dark:text-red-300'
                )}>
                  {validation.success
                    ? 'Python Environment is Healthy'
                    : 'Python Environment Has Issues'
                  }
                </h4>
                <div className="text-sm text-muted-foreground space-y-1">
                  <p>
                    {validation.summary.passed} passed, {validation.summary.failed} failed,{' '}
                    {validation.summary.warnings} warnings, {validation.summary.skipped} skipped
                  </p>
                  <p className="text-xs opacity-75">
                    Environment: {validation.environment.type} | Python: {validation.environment.pythonVersion || 'Unknown'}
                  </p>
                </div>
              </div>
              {!validation.success && (
                <button
                  onClick={handleAutoRepair}
                  disabled={isRepairing}
                  className={cn(
                    'flex items-center gap-1.5 px-4 py-2 rounded font-medium text-sm transition-colors',
                    'bg-purple-600 text-white hover:bg-purple-700',
                    isRepairing && 'opacity-50 cursor-not-allowed'
                  )}
                  data-testid="auto-repair-button"
                >
                  {isRepairing ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <Wrench className="w-4 h-4" />
                  )}
                  {isRepairing ? 'Repairing...' : 'Fix Python Environment'}
                </button>
              )}
            </div>
          </div>

          {/* Repair Result */}
          {repairResult && (
            <div
              className={cn(
                'p-4 rounded-lg border',
                repairResult.success
                  ? 'bg-green-50 border-green-200 dark:bg-green-900/20 dark:border-green-800'
                  : 'bg-yellow-50 border-yellow-200 dark:bg-yellow-900/20 dark:border-yellow-800'
              )}
            >
              <h4 className="font-medium mb-2">Repair Result</h4>
              <div className="space-y-2 text-sm">
                <p>
                  Attempted {repairResult.actionsAttempted.length} action(s):{' '}
                  {repairResult.actionsSucceeded.length} succeeded, {repairResult.actionsFailed.length} failed
                </p>
                {repairResult.logs.length > 0 && (
                  <div className="bg-background rounded p-2 max-h-32 overflow-y-auto">
                    {repairResult.logs.map((log: string, index: number) => (
                      <p key={index} className="text-xs text-muted-foreground font-mono">
                        {log}
                      </p>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Validation Checks */}
          <div className="bg-card border border-border rounded-lg overflow-hidden">
            <button
              onClick={() => toggleSection('checks')}
              className="w-full px-4 py-3 flex items-center justify-between hover:bg-accent/50 transition-colors"
              data-testid="checks-section-toggle"
            >
              <span className="font-medium text-sm">Validation Checks ({validation.checks.length})</span>
              {expandedSection === 'checks' ? (
                <ChevronUp className="w-4 h-4 text-muted-foreground" />
              ) : (
                <ChevronDown className="w-4 h-4 text-muted-foreground" />
              )}
            </button>

            {expandedSection === 'checks' && (
              <div className="p-4 border-t border-border space-y-2">
                {validation.checks.map((check: ValidationCheck, index: number) => (
                  <CheckResultCard key={index} check={check} />
                ))}
              </div>
            )}
          </div>

          {/* Environment Info */}
          <div className="bg-card border border-border rounded-lg overflow-hidden">
            <button
              onClick={() => toggleSection('environment')}
              className="w-full px-4 py-3 flex items-center justify-between hover:bg-accent/50 transition-colors"
            >
              <span className="font-medium text-sm">Environment Information</span>
              {expandedSection === 'environment' ? (
                <ChevronUp className="w-4 h-4 text-muted-foreground" />
              ) : (
                <ChevronDown className="w-4 h-4 text-muted-foreground" />
              )}
            </button>

            {expandedSection === 'environment' && (
              <div className="p-4 border-t border-border space-y-3 text-sm">
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <p className="text-xs text-muted-foreground">Type:</p>
                    <p className="font-medium">{validation.environment.type}</p>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">Python Version:</p>
                    <p className="font-medium">{validation.environment.pythonVersion || 'Unknown'}</p>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">OS:</p>
                    <p className="font-medium">{validation.environment.platform.os}</p>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">Architecture:</p>
                    <p className="font-medium">{validation.environment.platform.arch}</p>
                  </div>
                </div>
                {validation.environment.pythonPath && (
                  <div>
                    <p className="text-xs text-muted-foreground">Python Path:</p>
                    <p className="text-xs font-mono bg-muted px-2 py-1 rounded break-all">
                      {validation.environment.pythonPath}
                    </p>
                  </div>
                )}
                {/* Dual Environment Status */}
                {validation.dualEnvironment && (
                  <div className="border border-purple-200 dark:border-purple-800 rounded-lg p-3 bg-purple-50/50 dark:bg-purple-900/20">
                    <p className="text-xs font-medium text-purple-700 dark:text-purple-300 mb-2">Dual Environment Setup</p>
                    <div className="space-y-2">
                      <div className="flex items-center justify-between">
                        <span className="text-xs text-muted-foreground">WhisperX (Transcription):</span>
                        <span className={cn(
                          'text-xs font-medium px-2 py-0.5 rounded',
                          validation.dualEnvironment.whisperxReady
                            ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300'
                            : 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300'
                        )}>
                          {validation.dualEnvironment.whisperxReady ? 'Ready' : 'Not Ready'}
                        </span>
                      </div>
                      {validation.dualEnvironment.whisperxPath && (
                        <p className="text-xs font-mono bg-muted px-2 py-1 rounded break-all">
                          {validation.dualEnvironment.whisperxPath}
                        </p>
                      )}
                      <div className="flex items-center justify-between mt-2">
                        <span className="text-xs text-muted-foreground">Pyannote (Diarization):</span>
                        <span className={cn(
                          'text-xs font-medium px-2 py-0.5 rounded',
                          validation.dualEnvironment.pyannoteReady
                            ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300'
                            : 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300'
                        )}>
                          {validation.dualEnvironment.pyannoteReady ? 'Ready' : 'Not Ready'}
                        </span>
                      </div>
                      {validation.dualEnvironment.pyannotePath && (
                        <p className="text-xs font-mono bg-muted px-2 py-1 rounded break-all">
                          {validation.dualEnvironment.pyannotePath}
                        </p>
                      )}
                    </div>
                    <p className="text-xs text-muted-foreground mt-2">
                      Separate environments avoid torch version conflicts between WhisperX (2.8) and Pyannote (2.5.1)
                    </p>
                  </div>
                )}
                {Object.keys(validation.packageVersions).length > 0 && (
                  <div>
                    <p className="text-xs text-muted-foreground mb-1">Package Versions:</p>
                    <div className="bg-muted rounded p-2 space-y-1">
                      {Object.entries(validation.packageVersions).map(([pkg, version]) => (
                        <p key={pkg} className="text-xs font-mono">
                          {pkg}: {String(version)}
                        </p>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Recommendations */}
          {validation.recommendations.length > 0 && (
            <div className="bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-800 rounded-lg p-4">
              <h4 className="font-medium mb-2 text-sm">Recommendations:</h4>
              <ul className="space-y-1">
                {validation.recommendations.map((rec: string, index: number) => (
                  <li key={index} className="text-sm text-muted-foreground flex items-start gap-2">
                    <span className="text-yellow-600 dark:text-yellow-400 mt-1">•</span>
                    <span>{rec}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Smart Environment Checking */}
          <div className="bg-card border border-border rounded-lg p-4">
            <div className="flex items-start justify-between gap-4">
              <div className="flex-1">
                <div className="flex items-center gap-2 mb-1">
                  <Zap className="w-4 h-4 text-yellow-500" />
                  <h4 className="font-medium text-sm">Smart Environment Checking</h4>
                </div>
                <p className="text-xs text-muted-foreground">
                  When enabled, cached validation results are used on startup with a quick verification check,
                  reducing startup time from 5-10 seconds to under 1 second. Disable for thorough validation on every startup.
                </p>

                {/* Cache Info */}
                {cacheStats && (
                  <div className="mt-3 p-2 bg-muted/50 rounded-lg space-y-1">
                    <div className="flex items-center gap-2 text-xs">
                      <Database className="w-3.5 h-3.5 text-muted-foreground" />
                      <span className="text-muted-foreground">Cache Status:</span>
                      <span className={cn(
                        'font-medium',
                        cacheStats.hasCache ? 'text-green-600 dark:text-green-400' : 'text-gray-500'
                      )}>
                        {cacheStats.hasCache ? 'Available' : 'Not Available'}
                      </span>
                    </div>
                    {cacheStats.hasCache && (
                      <>
                        <div className="flex items-center gap-2 text-xs">
                          <Clock className="w-3.5 h-3.5 text-muted-foreground" />
                          <span className="text-muted-foreground">Last Validated:</span>
                          <span className="font-medium">{formatCacheAge(cacheStats.cacheAgeHours)}</span>
                        </div>
                        <div className="flex items-center gap-2 text-xs">
                          <span className="text-muted-foreground ml-5">Environment:</span>
                          <span className={cn(
                            'font-medium px-1.5 py-0.5 rounded text-[10px]',
                            cacheStats.hashesMatch
                              ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300'
                              : 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-300'
                          )}>
                            {cacheStats.hashesMatch ? 'Unchanged' : 'Modified'}
                          </span>
                        </div>
                      </>
                    )}

                    {/* Show if current validation was from cache */}
                    {validation?.cacheInfo?.fromCache && (
                      <div className="flex items-center gap-2 text-xs mt-2 pt-2 border-t border-border/50">
                        <Zap className="w-3.5 h-3.5 text-yellow-500" />
                        <span className="text-muted-foreground">
                          Current result loaded from cache
                          {validation.cacheInfo.lightweightValidation && ' (with lightweight verification)'}
                        </span>
                      </div>
                    )}
                  </div>
                )}
              </div>
              <button
                onClick={() => handleToggleSmartChecking(!smartCheckingEnabled)}
                className={cn(
                  'relative inline-flex h-6 w-11 items-center rounded-full transition-colors shrink-0',
                  smartCheckingEnabled ? 'bg-purple-600' : 'bg-gray-300 dark:bg-gray-600'
                )}
                data-testid="smart-checking-toggle"
              >
                <span
                  className={cn(
                    'inline-block h-4 w-4 transform rounded-full bg-white transition-transform shadow-sm',
                    smartCheckingEnabled ? 'translate-x-6' : 'translate-x-1'
                  )}
                />
              </button>
            </div>
          </div>

          {/* Fallback Mode */}
          <div className="bg-card border border-border rounded-lg p-4">
            <div className="flex items-start justify-between gap-4">
              <div className="flex-1">
                <h4 className="font-medium text-sm mb-1">Fallback Mode (Transcription Only)</h4>
                <p className="text-xs text-muted-foreground">
                  If Python environment cannot be fixed, enable this to continue with recording and
                  transcription without speaker diarization. You can manually identify speakers later.
                </p>
              </div>
              <button
                onClick={() => handleToggleFallbackMode(!fallbackMode)}
                className={cn(
                  'relative inline-flex h-6 w-11 items-center rounded-full transition-colors shrink-0',
                  fallbackMode ? 'bg-purple-600' : 'bg-gray-300 dark:bg-gray-600'
                )}
                data-testid="fallback-mode-toggle"
              >
                <span
                  className={cn(
                    'inline-block h-4 w-4 transform rounded-full bg-white transition-transform shadow-sm',
                    fallbackMode ? 'translate-x-6' : 'translate-x-1'
                  )}
                />
              </button>
            </div>
          </div>

          {/* Export Button */}
          <button
            onClick={handleExportDiagnostics}
            className="w-full flex items-center justify-center gap-2 px-4 py-2 bg-secondary hover:bg-accent rounded text-sm font-medium transition-colors"
            data-testid="export-diagnostics-button"
          >
            <Download className="w-4 h-4" />
            Export Diagnostics Report
          </button>
        </>
      )}
    </div>
  )
}

export default PythonEnvironmentDiagnostics
