/**
 * EnvironmentStatusSection Component
 *
 * Comprehensive Python environment status dashboard for Settings.
 * Displays real-time status of both WhisperX and Pyannote environments
 * with detailed health metrics, troubleshooting wizard, and export functionality.
 *
 * Features:
 * - Status indicators: Ready (green), Degraded (yellow), Failed (red), Installing (blue)
 * - Environment details: Python version, torch version, key packages, paths, disk usage
 * - Last validated timestamp with relative time display
 * - Action buttons: Test, Repair, Reinstall, View Logs
 * - Health metrics with import tests and model availability
 * - Troubleshooting wizard with suggested actions
 * - Export environment report as JSON
 */

import { useState, useEffect, useCallback } from 'react'
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
  HardDrive,
  Clock,
  Cpu,
  Play,
  RotateCcw,
  FileText,
  AlertOctagon,
  Sparkles,
  Info
} from 'lucide-react'
import { cn } from '@/lib/utils'

// ============================================================================
// Types
// ============================================================================

/**
 * Environment status levels:
 * - ready: All packages + models work
 * - functional: Core packages work, optional features may not work (model loading not tested)
 * - degraded: Missing optional dependencies, basic operations may work
 * - failed: Critical imports fail, environment unusable
 * - installing: Setup in progress
 * - unknown: Status not determined yet
 */
type EnvironmentStatus = 'ready' | 'functional' | 'degraded' | 'failed' | 'installing' | 'unknown'

interface PackageInfo {
  name: string
  available: boolean
  version?: string
}

interface EnvironmentDetails {
  name: string
  purpose: string
  status: EnvironmentStatus
  pythonVersion?: string
  torchVersion?: string
  packages: PackageInfo[]
  path?: string
  diskUsage?: string
  lastValidated?: Date
  errors: string[]
  warnings: string[]
}

interface HealthMetrics {
  overallScore: number
  importTests: { name: string; passed: boolean }[]
  modelAvailability: { name: string; available: boolean }[]
}

interface TroubleshootingAction {
  label: string
  description: string
  action: () => Promise<void>
  severity: 'info' | 'warning' | 'error'
}

interface EnvironmentStatusSectionProps {
  className?: string
  onEnvironmentChange?: () => void
}

// ============================================================================
// Helper Functions
// ============================================================================

function getRelativeTime(date: Date): string {
  const now = new Date()
  const diffMs = now.getTime() - date.getTime()
  const diffSecs = Math.floor(diffMs / 1000)
  const diffMins = Math.floor(diffSecs / 60)
  const diffHours = Math.floor(diffMins / 60)
  const diffDays = Math.floor(diffHours / 24)

  if (diffSecs < 60) return 'Just now'
  if (diffMins < 60) return `${diffMins} minute${diffMins !== 1 ? 's' : ''} ago`
  if (diffHours < 24) return `${diffHours} hour${diffHours !== 1 ? 's' : ''} ago`
  return `${diffDays} day${diffDays !== 1 ? 's' : ''} ago`
}

function getStatusColor(status: EnvironmentStatus): string {
  switch (status) {
    case 'ready':
      return 'text-green-600 dark:text-green-400'
    case 'functional':
      return 'text-emerald-600 dark:text-emerald-400' // Slightly different green to distinguish from ready
    case 'degraded':
      return 'text-yellow-600 dark:text-yellow-400'
    case 'failed':
      return 'text-red-600 dark:text-red-400'
    case 'installing':
      return 'text-blue-600 dark:text-blue-400'
    default:
      return 'text-muted-foreground'
  }
}

function getStatusBgColor(status: EnvironmentStatus): string {
  switch (status) {
    case 'ready':
      return 'bg-green-50 border-green-200 dark:bg-green-900/20 dark:border-green-800'
    case 'functional':
      return 'bg-emerald-50 border-emerald-200 dark:bg-emerald-900/20 dark:border-emerald-800'
    case 'degraded':
      return 'bg-yellow-50 border-yellow-200 dark:bg-yellow-900/20 dark:border-yellow-800'
    case 'failed':
      return 'bg-red-50 border-red-200 dark:bg-red-900/20 dark:border-red-800'
    case 'installing':
      return 'bg-blue-50 border-blue-200 dark:bg-blue-900/20 dark:border-blue-800'
    default:
      return 'bg-muted border-border'
  }
}

function getStatusIcon(status: EnvironmentStatus) {
  switch (status) {
    case 'ready':
      return <CheckCircle className="w-5 h-5 text-green-500" />
    case 'functional':
      return <CheckCircle className="w-5 h-5 text-emerald-500" /> // Same check icon but different color
    case 'degraded':
      return <AlertTriangle className="w-5 h-5 text-yellow-500" />
    case 'failed':
      return <XCircle className="w-5 h-5 text-red-500" />
    case 'installing':
      return <Loader2 className="w-5 h-5 text-blue-500 animate-spin" />
    default:
      return <Info className="w-5 h-5 text-gray-400" />
  }
}

function getStatusLabel(status: EnvironmentStatus): string {
  switch (status) {
    case 'ready':
      return 'Ready'
    case 'functional':
      return 'Functional'
    case 'degraded':
      return 'Degraded'
    case 'failed':
      return 'Failed'
    case 'installing':
      return 'Installing...'
    default:
      return 'Unknown'
  }
}

// ============================================================================
// Sub-Components
// ============================================================================

interface EnvironmentCardProps {
  environment: EnvironmentDetails
  onTest: () => Promise<void>
  onRepair: () => Promise<void>
  onReinstall: () => Promise<void>
  onViewLogs: () => void
  isLoading: boolean
}

function EnvironmentCard({
  environment,
  onTest,
  onRepair,
  onReinstall,
  onViewLogs,
  isLoading
}: EnvironmentCardProps) {
  const [expanded, setExpanded] = useState(false)
  const [actionInProgress, setActionInProgress] = useState<string | null>(null)

  const handleAction = async (actionName: string, action: () => Promise<void>) => {
    setActionInProgress(actionName)
    try {
      await action()
    } finally {
      setActionInProgress(null)
    }
  }

  return (
    <div
      className={cn(
        'border rounded-lg overflow-hidden transition-colors',
        getStatusBgColor(environment.status)
      )}
      data-testid={`environment-card-${environment.name.toLowerCase().replace(/\s+/g, '-')}`}
    >
      {/* Header */}
      <div
        className="p-4 cursor-pointer"
        onClick={() => setExpanded(!expanded)}
      >
        <div className="flex items-start justify-between">
          <div className="flex items-center gap-3">
            {getStatusIcon(environment.status)}
            <div>
              <h4 className="font-medium text-sm">{environment.name}</h4>
              <p className="text-xs text-muted-foreground">{environment.purpose}</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <span className={cn('text-sm font-medium', getStatusColor(environment.status))}>
              {environment.status === 'ready' && '✓ '}
              {environment.status === 'functional' && '✓ '}
              {environment.status === 'degraded' && '⚠ '}
              {environment.status === 'failed' && '✗ '}
              {getStatusLabel(environment.status)}
            </span>
            {expanded ? (
              <ChevronUp className="w-4 h-4 text-muted-foreground" />
            ) : (
              <ChevronDown className="w-4 h-4 text-muted-foreground" />
            )}
          </div>
        </div>

        {/* Quick Info */}
        {!expanded && (
          <div className="mt-2 flex items-center gap-4 text-xs text-muted-foreground">
            {environment.pythonVersion && (
              <span className="flex items-center gap-1">
                <Terminal className="w-3 h-3" />
                Python {environment.pythonVersion}
              </span>
            )}
            {environment.torchVersion && (
              <span className="flex items-center gap-1">
                <Cpu className="w-3 h-3" />
                torch {environment.torchVersion}
              </span>
            )}
            {environment.lastValidated && (
              <span className="flex items-center gap-1">
                <Clock className="w-3 h-3" />
                Last checked: {getRelativeTime(environment.lastValidated)}
              </span>
            )}
          </div>
        )}
      </div>

      {/* Expanded Details */}
      {expanded && (
        <div className="border-t border-border/50 p-4 space-y-4 bg-background/50">
          {/* Environment Details Grid */}
          <div className="grid grid-cols-2 gap-3 text-sm">
            <div>
              <p className="text-xs text-muted-foreground mb-1">Python Version</p>
              <p className="font-mono text-sm">{environment.pythonVersion || 'Not detected'}</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground mb-1">Torch Version</p>
              <p className="font-mono text-sm">{environment.torchVersion || 'Not installed'}</p>
            </div>
            {environment.path && (
              <div className="col-span-2">
                <p className="text-xs text-muted-foreground mb-1">Installation Path</p>
                <p className="font-mono text-xs break-all bg-muted/50 px-2 py-1 rounded">
                  {environment.path}
                </p>
              </div>
            )}
            {environment.diskUsage && (
              <div>
                <p className="text-xs text-muted-foreground mb-1">Disk Usage</p>
                <p className="flex items-center gap-1">
                  <HardDrive className="w-3 h-3" />
                  {environment.diskUsage}
                </p>
              </div>
            )}
            {environment.lastValidated && (
              <div>
                <p className="text-xs text-muted-foreground mb-1">Last Validated</p>
                <p className="flex items-center gap-1">
                  <Clock className="w-3 h-3" />
                  {getRelativeTime(environment.lastValidated)}
                </p>
              </div>
            )}
          </div>

          {/* Key Packages */}
          <div>
            <p className="text-xs font-medium mb-2">Key Packages</p>
            <div className="flex flex-wrap gap-2">
              {environment.packages.map((pkg) => (
                <span
                  key={pkg.name}
                  className={cn(
                    'inline-flex items-center gap-1 px-2 py-1 rounded text-xs',
                    pkg.available
                      ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300'
                      : 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300'
                  )}
                >
                  {pkg.available ? (
                    <CheckCircle className="w-3 h-3" />
                  ) : (
                    <XCircle className="w-3 h-3" />
                  )}
                  {pkg.name}
                  {pkg.version && <span className="opacity-70">({pkg.version})</span>}
                </span>
              ))}
            </div>
          </div>

          {/* Errors and Warnings */}
          {(environment.errors.length > 0 || environment.warnings.length > 0) && (
            <div className="space-y-2">
              {environment.errors.map((error, idx) => (
                <div
                  key={`error-${idx}`}
                  className="flex items-start gap-2 p-2 bg-red-50 dark:bg-red-900/20 rounded text-xs text-red-700 dark:text-red-300"
                >
                  <XCircle className="w-3 h-3 mt-0.5 shrink-0" />
                  <span>{error}</span>
                </div>
              ))}
              {environment.warnings.map((warning, idx) => (
                <div
                  key={`warning-${idx}`}
                  className="flex items-start gap-2 p-2 bg-yellow-50 dark:bg-yellow-900/20 rounded text-xs text-yellow-700 dark:text-yellow-300"
                >
                  <AlertTriangle className="w-3 h-3 mt-0.5 shrink-0" />
                  <span>{warning}</span>
                </div>
              ))}
            </div>
          )}

          {/* Action Buttons */}
          <div className="flex flex-wrap gap-2 pt-2 border-t border-border/50">
            <button
              onClick={(e) => {
                e.stopPropagation()
                handleAction('test', onTest)
              }}
              disabled={isLoading || actionInProgress !== null}
              className={cn(
                'flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-medium transition-colors',
                'bg-secondary hover:bg-accent disabled:opacity-50'
              )}
              data-testid="test-environment-btn"
            >
              {actionInProgress === 'test' ? (
                <Loader2 className="w-3 h-3 animate-spin" />
              ) : (
                <Play className="w-3 h-3" />
              )}
              Test Environment
            </button>
            <button
              onClick={(e) => {
                e.stopPropagation()
                handleAction('repair', onRepair)
              }}
              disabled={isLoading || actionInProgress !== null}
              className={cn(
                'flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-medium transition-colors',
                'bg-secondary hover:bg-accent disabled:opacity-50'
              )}
              data-testid="repair-environment-btn"
            >
              {actionInProgress === 'repair' ? (
                <Loader2 className="w-3 h-3 animate-spin" />
              ) : (
                <Wrench className="w-3 h-3" />
              )}
              Repair Environment
            </button>
            <button
              onClick={(e) => {
                e.stopPropagation()
                handleAction('reinstall', onReinstall)
              }}
              disabled={isLoading || actionInProgress !== null}
              className={cn(
                'flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-medium transition-colors',
                'bg-red-100 hover:bg-red-200 text-red-700 dark:bg-red-900/30 dark:hover:bg-red-900/50 dark:text-red-300 disabled:opacity-50'
              )}
              data-testid="reinstall-environment-btn"
            >
              {actionInProgress === 'reinstall' ? (
                <Loader2 className="w-3 h-3 animate-spin" />
              ) : (
                <RotateCcw className="w-3 h-3" />
              )}
              Reinstall Environment
            </button>
            <button
              onClick={(e) => {
                e.stopPropagation()
                onViewLogs()
              }}
              disabled={isLoading}
              className={cn(
                'flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-medium transition-colors',
                'bg-secondary hover:bg-accent disabled:opacity-50'
              )}
              data-testid="view-logs-btn"
            >
              <FileText className="w-3 h-3" />
              View Logs
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

interface HealthMetricsCardProps {
  metrics: HealthMetrics
}

function HealthMetricsCard({ metrics }: HealthMetricsCardProps) {
  const scoreColor =
    metrics.overallScore >= 80
      ? 'text-green-600 dark:text-green-400'
      : metrics.overallScore >= 50
      ? 'text-yellow-600 dark:text-yellow-400'
      : 'text-red-600 dark:text-red-400'

  const scoreBarColor =
    metrics.overallScore >= 80
      ? 'bg-green-500'
      : metrics.overallScore >= 50
      ? 'bg-yellow-500'
      : 'bg-red-500'

  return (
    <div className="bg-card border border-border rounded-lg p-4" data-testid="health-metrics-card">
      <div className="flex items-center justify-between mb-4">
        <h4 className="font-medium text-sm flex items-center gap-2">
          <Sparkles className="w-4 h-4 text-purple-500" />
          Environment Health
        </h4>
        <span className={cn('text-lg font-bold', scoreColor)}>{metrics.overallScore}%</span>
      </div>

      {/* Progress Bar */}
      <div className="h-2 bg-muted rounded-full mb-4 overflow-hidden">
        <div
          className={cn('h-full rounded-full transition-all', scoreBarColor)}
          style={{ width: `${metrics.overallScore}%` }}
        />
      </div>

      {/* Import Tests */}
      <div className="mb-3">
        <p className="text-xs font-medium mb-2">Import Tests</p>
        <div className="grid grid-cols-2 gap-1">
          {metrics.importTests.map((test) => (
            <div key={test.name} className="flex items-center gap-1.5 text-xs">
              {test.passed ? (
                <CheckCircle className="w-3 h-3 text-green-500" />
              ) : (
                <XCircle className="w-3 h-3 text-red-500" />
              )}
              <span className={test.passed ? '' : 'text-red-600 dark:text-red-400'}>
                {test.name}
              </span>
            </div>
          ))}
        </div>
      </div>

      {/* Model Availability */}
      <div>
        <p className="text-xs font-medium mb-2">Model Availability</p>
        <div className="grid grid-cols-2 gap-1">
          {metrics.modelAvailability.map((model) => (
            <div key={model.name} className="flex items-center gap-1.5 text-xs">
              {model.available ? (
                <CheckCircle className="w-3 h-3 text-green-500" />
              ) : (
                <XCircle className="w-3 h-3 text-red-500" />
              )}
              <span className={model.available ? '' : 'text-red-600 dark:text-red-400'}>
                {model.name}
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

interface TroubleshootingWizardProps {
  issues: TroubleshootingAction[]
  onDismiss: () => void
}

function TroubleshootingWizard({ issues, onDismiss }: TroubleshootingWizardProps) {
  const [runningAction, setRunningAction] = useState<string | null>(null)

  const handleAction = async (action: TroubleshootingAction) => {
    setRunningAction(action.label)
    try {
      await action.action()
    } finally {
      setRunningAction(null)
    }
  }

  if (issues.length === 0) return null

  return (
    <div
      className="bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-lg p-4"
      data-testid="troubleshooting-wizard"
    >
      <div className="flex items-start gap-3">
        <AlertOctagon className="w-5 h-5 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
        <div className="flex-1">
          <h4 className="font-medium text-sm text-amber-800 dark:text-amber-200 mb-2">
            Environment Issues Detected
          </h4>
          <p className="text-xs text-amber-700 dark:text-amber-300 mb-3">
            We detected some issues with your Python environments. Here are suggested actions to fix them:
          </p>
          <div className="flex flex-wrap gap-2">
            {issues.map((issue) => (
              <button
                key={issue.label}
                onClick={() => handleAction(issue)}
                disabled={runningAction !== null}
                className={cn(
                  'flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-medium transition-colors',
                  issue.severity === 'error'
                    ? 'bg-red-100 hover:bg-red-200 text-red-700 dark:bg-red-900/30 dark:hover:bg-red-900/50 dark:text-red-300'
                    : issue.severity === 'warning'
                    ? 'bg-amber-100 hover:bg-amber-200 text-amber-700 dark:bg-amber-900/30 dark:hover:bg-amber-900/50 dark:text-amber-300'
                    : 'bg-blue-100 hover:bg-blue-200 text-blue-700 dark:bg-blue-900/30 dark:hover:bg-blue-900/50 dark:text-blue-300',
                  'disabled:opacity-50'
                )}
                title={issue.description}
              >
                {runningAction === issue.label ? (
                  <Loader2 className="w-3 h-3 animate-spin" />
                ) : (
                  <Wrench className="w-3 h-3" />
                )}
                {issue.label}
              </button>
            ))}
            <button
              onClick={onDismiss}
              className="px-3 py-1.5 rounded text-xs font-medium text-muted-foreground hover:bg-accent transition-colors"
            >
              Dismiss
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

// ============================================================================
// Main Component
// ============================================================================

export function EnvironmentStatusSection({
  className,
  onEnvironmentChange
}: EnvironmentStatusSectionProps) {
  const [isLoading, setIsLoading] = useState(true)
  const [isRefreshing, setIsRefreshing] = useState(false)
  const [whisperxEnv, setWhisperxEnv] = useState<EnvironmentDetails | null>(null)
  const [pyannoteEnv, setPyannoteEnv] = useState<EnvironmentDetails | null>(null)
  const [healthMetrics, setHealthMetrics] = useState<HealthMetrics | null>(null)
  const [troubleshootingIssues, setTroubleshootingIssues] = useState<TroubleshootingAction[]>([])
  const [showTroubleshooting, setShowTroubleshooting] = useState(true)
  const [logs, setLogs] = useState<string[]>([])
  const [showLogsModal, setShowLogsModal] = useState(false)

  // Load environment status
  const loadEnvironmentStatus = useCallback(async (forceRefresh = false) => {
    try {
      setIsRefreshing(true)
      const api = window.electronAPI as any

      // Check if Python setup API is available
      if (!api?.pythonSetup || !api?.pythonValidation) {
        console.warn('Python setup/validation API not available')
        setIsLoading(false)
        setIsRefreshing(false)
        return
      }

      // Get metadata and validation results
      const [metadata, validation] = await Promise.all([
        api.pythonSetup.getMetadata().catch(() => null),
        api.pythonValidation.validate(forceRefresh).catch(() => null)
      ])

      const now = new Date()

      // Parse WhisperX environment details
      const whisperx: EnvironmentDetails = {
        name: 'WhisperX Environment',
        purpose: 'Transcription (Speech-to-Text)',
        status: 'unknown',
        pythonVersion: metadata?.environments?.whisperx?.pythonVersion || validation?.environment?.pythonVersion,
        torchVersion: metadata?.environments?.whisperx?.packages?.torch,
        packages: [
          { name: 'whisperx', available: false },
          { name: 'faster-whisper', available: false },
          { name: 'torch', available: false }
        ],
        path: metadata?.environments?.whisperx?.path || validation?.dualEnvironment?.whisperxPath,
        lastValidated: now,
        errors: [],
        warnings: []
      }

      // Parse Pyannote environment details
      const pyannote: EnvironmentDetails = {
        name: 'Pyannote Environment',
        purpose: 'Speaker Diarization (Who spoke when)',
        status: 'unknown',
        pythonVersion: metadata?.environments?.pyannote?.pythonVersion || validation?.environment?.pythonVersion,
        torchVersion: metadata?.environments?.pyannote?.packages?.torch,
        packages: [
          { name: 'pyannote.audio', available: false },
          { name: 'speechbrain', available: false },
          { name: 'torch', available: false }
        ],
        path: metadata?.environments?.pyannote?.path || validation?.dualEnvironment?.pyannotePath,
        lastValidated: now,
        errors: [],
        warnings: []
      }

      // Update package status from validation results
      if (validation?.checks) {
        const packageCheck = validation.checks.find((c: any) => c.type === 'package_imports')
        if (packageCheck?.details?.results) {
          const results = packageCheck.details.results
          const versions = packageCheck.details.versions || {}

          // WhisperX packages
          whisperx.packages = [
            { name: 'whisperx', available: results.whisperx === true, version: versions.whisperx },
            { name: 'faster-whisper', available: results.faster_whisper === true, version: versions.faster_whisper },
            { name: 'torch', available: results.torch === true, version: versions.torch }
          ]

          // Pyannote packages
          pyannote.packages = [
            { name: 'pyannote.audio', available: results['pyannote.audio'] === true, version: versions['pyannote.audio'] },
            { name: 'speechbrain', available: results.speechbrain === true, version: versions.speechbrain },
            { name: 'torch', available: results.torch === true, version: versions.torch }
          ]

          // Update torch versions if available
          if (versions.torch) {
            whisperx.torchVersion = whisperx.torchVersion || versions.torch
            pyannote.torchVersion = pyannote.torchVersion || versions.torch
          }
        }
      }

      // Determine environment status using new readiness levels
      // Priority: Use per-environment readiness from validation if available
      if (validation?.dualEnvironment) {
        // Use the new granular readiness levels if available
        if (validation.dualEnvironment.whisperxReadiness) {
          whisperx.status = validation.dualEnvironment.whisperxReadiness as EnvironmentStatus
          if (validation.dualEnvironment.whisperxStatusMessage) {
            whisperx.warnings.push(validation.dualEnvironment.whisperxStatusMessage)
          }
        } else {
          whisperx.status = validation.dualEnvironment.whisperxReady ? 'ready' : 'failed'
        }

        if (validation.dualEnvironment.pyannoteReadiness) {
          pyannote.status = validation.dualEnvironment.pyannoteReadiness as EnvironmentStatus
          if (validation.dualEnvironment.pyannoteStatusMessage) {
            // Add as info instead of warning if status is functional
            if (pyannote.status === 'functional') {
              // Don't add to warnings - this is informational for functional status
              pyannote.purpose = `Speaker Diarization (${validation.dualEnvironment.pyannoteStatusMessage})`
            } else {
              pyannote.warnings.push(validation.dualEnvironment.pyannoteStatusMessage)
            }
          }
        } else {
          pyannote.status = validation.dualEnvironment.pyannoteReady ? 'ready' : 'failed'
        }
      } else if (metadata?.environments) {
        // Map metadata status to our status type
        const mapStatus = (s: string): EnvironmentStatus => {
          if (s === 'ready') return 'ready'
          if (s === 'functional') return 'functional'
          if (s === 'degraded') return 'degraded'
          return 'failed'
        }
        whisperx.status = mapStatus(metadata.environments.whisperx?.status || 'failed')
        pyannote.status = mapStatus(metadata.environments.pyannote?.status || 'failed')
      } else {
        // Determine status based on package availability
        const whisperxPackagesOk = whisperx.packages.some(p => p.available && (p.name === 'whisperx' || p.name === 'faster-whisper'))
        const pyannotePackagesOk = pyannote.packages.some(p => p.available && p.name === 'pyannote.audio')

        whisperx.status = whisperxPackagesOk ? 'ready' : 'failed'
        // If pyannote.audio imports work but model loading wasn't tested, mark as functional
        pyannote.status = pyannotePackagesOk ? 'functional' : 'failed'
      }

      // Speechbrain is optional - don't downgrade status if it's missing
      // Only mark as degraded if core packages are missing (not speechbrain)
      if (whisperx.status === 'ready' && whisperx.packages.some(p => !p.available && p.name !== 'torch')) {
        // Only downgrade if a critical package is missing
        whisperx.status = 'degraded'
        whisperx.warnings.push('Some optional packages are missing')
      }
      // Don't downgrade pyannote for missing speechbrain - it's optional
      if (pyannote.status === 'ready' && pyannote.packages.some(p => !p.available && p.name !== 'speechbrain' && p.name !== 'torch')) {
        pyannote.status = 'degraded'
        pyannote.warnings.push('Some optional packages are missing')
      }

      // Collect errors from validation
      if (validation?.checks) {
        for (const check of validation.checks) {
          if (check.status === 'fail' && check.error) {
            if (check.type.includes('whisper') || check.type === 'package_imports') {
              whisperx.errors.push(check.error)
            }
            if (check.type.includes('pyannote') || check.type === 'package_imports') {
              pyannote.errors.push(check.error)
            }
          }
        }
      }

      // Calculate health metrics
      const importTests = [
        { name: 'whisperx', passed: whisperx.packages.find(p => p.name === 'whisperx')?.available || false },
        { name: 'torch', passed: whisperx.packages.find(p => p.name === 'torch')?.available || false },
        { name: 'pyannote', passed: pyannote.packages.find(p => p.name === 'pyannote.audio')?.available || false },
        { name: 'faster-whisper', passed: whisperx.packages.find(p => p.name === 'faster-whisper')?.available || false }
      ]

      const modelAvailability = [
        { name: 'Whisper base', available: whisperx.status === 'ready' || whisperx.status === 'functional' || whisperx.status === 'degraded' },
        // Pyannote model is available if status is ready, functional (not tested yet), or degraded
        { name: 'Pyannote embedding', available: pyannote.status === 'ready' || pyannote.status === 'functional' || pyannote.status === 'degraded' }
      ]

      const passedTests = importTests.filter(t => t.passed).length + modelAvailability.filter(m => m.available).length
      const totalTests = importTests.length + modelAvailability.length
      const overallScore = Math.round((passedTests / totalTests) * 100)

      setHealthMetrics({
        overallScore,
        importTests,
        modelAvailability
      })

      // Generate troubleshooting actions
      const issues: TroubleshootingAction[] = []

      if (pyannote.status === 'failed') {
        issues.push({
          label: 'Repair Pyannote Env',
          description: 'Reinstall pyannote.audio and dependencies',
          action: async () => {
            await handleRepairEnvironment('pyannote')
          },
          severity: 'error'
        })
      }

      if (whisperx.status === 'failed') {
        issues.push({
          label: 'Repair WhisperX Env',
          description: 'Reinstall whisperx and dependencies',
          action: async () => {
            await handleRepairEnvironment('whisperx')
          },
          severity: 'error'
        })
      }

      if (!metadata?.models?.downloaded) {
        issues.push({
          label: 'Download Missing Models',
          description: 'Download required ML models',
          action: async () => {
            await handleDownloadModels()
          },
          severity: 'warning'
        })
      }

      if (whisperx.status === 'failed' && pyannote.status === 'failed') {
        issues.push({
          label: 'Reset All',
          description: 'Reset and reinstall all Python environments',
          action: async () => {
            await handleResetAll()
          },
          severity: 'error'
        })
      }

      setTroubleshootingIssues(issues)
      setShowTroubleshooting(issues.length > 0)

      setWhisperxEnv(whisperx)
      setPyannoteEnv(pyannote)
    } catch (error) {
      console.error('Failed to load environment status:', error)
    } finally {
      setIsLoading(false)
      setIsRefreshing(false)
    }
  }, [])

  // Initial load
  useEffect(() => {
    loadEnvironmentStatus(false)
  }, [loadEnvironmentStatus])

  // Action handlers
  const handleTestEnvironment = async (envType: 'whisperx' | 'pyannote') => {
    try {
      const api = window.electronAPI as any
      if (api?.pythonValidation) {
        await api.pythonValidation.validate(true)
        await loadEnvironmentStatus(true)
      }
    } catch (error) {
      console.error(`Failed to test ${envType} environment:`, error)
    }
  }

  const handleRepairEnvironment = async (envType: 'whisperx' | 'pyannote') => {
    try {
      const api = window.electronAPI as any
      if (api?.pythonValidation) {
        const result = await api.pythonValidation.autoRepair()
        if (result?.logs) {
          setLogs(prev => [...prev, ...result.logs])
        }
        await loadEnvironmentStatus(true)
        onEnvironmentChange?.()
      }
    } catch (error) {
      console.error(`Failed to repair ${envType} environment:`, error)
      setLogs(prev => [...prev, `Error repairing ${envType}: ${error}`])
    }
  }

  const handleReinstallEnvironment = async (envType: 'whisperx' | 'pyannote') => {
    if (!window.confirm(`Are you sure you want to reinstall the ${envType} environment? This will delete and recreate the environment.`)) {
      return
    }
    try {
      const api = window.electronAPI as any
      if (api?.pythonSetup) {
        await api.pythonSetup.reset()
        const result = await api.pythonSetup.runSetup({ force: true })
        if (result?.error) {
          setLogs(prev => [...prev, `Reinstall error: ${result.error}`])
        }
        await loadEnvironmentStatus(true)
        onEnvironmentChange?.()
      }
    } catch (error) {
      console.error(`Failed to reinstall ${envType} environment:`, error)
      setLogs(prev => [...prev, `Error reinstalling ${envType}: ${error}`])
    }
  }

  const handleDownloadModels = async () => {
    try {
      const api = window.electronAPI as any
      if (api?.pythonSetup) {
        await api.pythonSetup.runSetup({ skipModels: false })
        await loadEnvironmentStatus(true)
      }
    } catch (error) {
      console.error('Failed to download models:', error)
    }
  }

  const handleResetAll = async () => {
    if (!window.confirm('Are you sure you want to reset all Python environments? This will delete and recreate both environments.')) {
      return
    }
    try {
      const api = window.electronAPI as any
      if (api?.pythonSetup) {
        await api.pythonSetup.reset()
        await api.pythonSetup.runSetup({ force: true })
        await loadEnvironmentStatus(true)
        onEnvironmentChange?.()
      }
    } catch (error) {
      console.error('Failed to reset environments:', error)
    }
  }

  const handleViewLogs = () => {
    setShowLogsModal(true)
  }

  const handleExportReport = async () => {
    const report = {
      timestamp: new Date().toISOString(),
      environments: {
        whisperx: whisperxEnv,
        pyannote: pyannoteEnv
      },
      healthMetrics,
      troubleshootingIssues: troubleshootingIssues.map(i => ({ label: i.label, description: i.description, severity: i.severity })),
      logs,
      platform: {
        os: navigator.platform,
        userAgent: navigator.userAgent
      }
    }

    try {
      const json = JSON.stringify(report, null, 2)
      await navigator.clipboard.writeText(json)
      alert('Environment report copied to clipboard!')
    } catch (error) {
      console.error('Failed to export report:', error)
      // Fallback: create download
      const blob = new Blob([JSON.stringify(report, null, 2)], { type: 'application/json' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `environment-report-${new Date().toISOString().split('T')[0]}.json`
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      URL.revokeObjectURL(url)
    }
  }

  if (isLoading) {
    return (
      <div className={cn('flex items-center justify-center p-8', className)}>
        <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
        <span className="ml-2 text-sm text-muted-foreground">Loading environment status...</span>
      </div>
    )
  }

  return (
    <div className={cn('space-y-4', className)} data-testid="environment-status-section">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Terminal className="w-5 h-5 text-primary" />
          <h3 className="font-semibold">Environment Status</h3>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => loadEnvironmentStatus(true)}
            disabled={isRefreshing}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-medium transition-colors bg-secondary hover:bg-accent disabled:opacity-50"
            data-testid="refresh-status-btn"
          >
            <RefreshCw className={cn('w-3.5 h-3.5', isRefreshing && 'animate-spin')} />
            Refresh
          </button>
          <button
            onClick={handleExportReport}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-medium transition-colors bg-secondary hover:bg-accent"
            data-testid="export-report-btn"
          >
            <Download className="w-3.5 h-3.5" />
            Export Report
          </button>
        </div>
      </div>

      {/* Troubleshooting Wizard */}
      {showTroubleshooting && troubleshootingIssues.length > 0 && (
        <TroubleshootingWizard
          issues={troubleshootingIssues}
          onDismiss={() => setShowTroubleshooting(false)}
        />
      )}

      {/* Environment Cards */}
      <div className="space-y-3">
        {whisperxEnv && (
          <EnvironmentCard
            environment={whisperxEnv}
            onTest={() => handleTestEnvironment('whisperx')}
            onRepair={() => handleRepairEnvironment('whisperx')}
            onReinstall={() => handleReinstallEnvironment('whisperx')}
            onViewLogs={handleViewLogs}
            isLoading={isRefreshing}
          />
        )}
        {pyannoteEnv && (
          <EnvironmentCard
            environment={pyannoteEnv}
            onTest={() => handleTestEnvironment('pyannote')}
            onRepair={() => handleRepairEnvironment('pyannote')}
            onReinstall={() => handleReinstallEnvironment('pyannote')}
            onViewLogs={handleViewLogs}
            isLoading={isRefreshing}
          />
        )}
      </div>

      {/* Health Metrics */}
      {healthMetrics && <HealthMetricsCard metrics={healthMetrics} />}

      {/* Logs Modal */}
      {showLogsModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50" onClick={() => setShowLogsModal(false)}>
          <div className="bg-background border border-border rounded-lg shadow-lg w-[600px] max-h-[80vh] overflow-hidden" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between p-4 border-b border-border">
              <h4 className="font-medium">Environment Logs</h4>
              <button onClick={() => setShowLogsModal(false)} className="text-muted-foreground hover:text-foreground">
                <XCircle className="w-5 h-5" />
              </button>
            </div>
            <div className="p-4 max-h-[60vh] overflow-y-auto">
              {logs.length === 0 ? (
                <p className="text-sm text-muted-foreground">No logs available yet. Run a test or repair action to see logs.</p>
              ) : (
                <pre className="text-xs font-mono bg-muted p-3 rounded overflow-x-auto whitespace-pre-wrap">
                  {logs.join('\n')}
                </pre>
              )}
            </div>
            <div className="flex justify-end gap-2 p-4 border-t border-border">
              <button
                onClick={() => setLogs([])}
                className="px-3 py-1.5 rounded text-xs font-medium bg-secondary hover:bg-accent"
              >
                Clear Logs
              </button>
              <button
                onClick={async () => {
                  await navigator.clipboard.writeText(logs.join('\n'))
                  alert('Logs copied to clipboard!')
                }}
                className="px-3 py-1.5 rounded text-xs font-medium bg-secondary hover:bg-accent"
              >
                Copy to Clipboard
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

export default EnvironmentStatusSection
