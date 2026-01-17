/**
 * LLM Health Status Component
 *
 * Displays the health status of all LLM providers with:
 * - Real-time status indicators
 * - Response time metrics
 * - Troubleshooting guidance for unavailable providers
 * - Event history log
 * - Auto-refresh capability
 */

import { useState, useEffect, useCallback } from 'react'
import { cn } from '@/lib/utils'
import {
  Activity,
  AlertTriangle,
  CheckCircle,
  XCircle,
  RefreshCw,
  ChevronDown,
  ChevronUp,
  Loader2,
  AlertCircle,
  History,
  Server,
  Terminal,
  Zap,
  HelpCircle
} from 'lucide-react'

// ============================================================================
// Types
// ============================================================================

type LLMProviderType = 'lm-studio' | 'ollama' | 'claude' | 'cursor' | 'openai' | 'anthropic' | 'custom'

interface ProviderHealthStatus {
  provider: LLMProviderType
  available: boolean
  lastChecked: number
  responseTimeMs?: number
  error?: string
  consecutiveFailures: number
  lastSuccessTime?: number
  troubleshootingGuidance?: string
}

interface HealthCheckEvent {
  id: string
  timestamp: number
  provider: LLMProviderType
  type: 'check' | 'failure' | 'recovery' | 'fallback'
  available: boolean
  responseTimeMs?: number
  error?: string
  details?: Record<string, unknown>
}

interface HealthSummary {
  timestamp: number
  totalProviders: number
  availableProviders: number
  unavailableProviders: number
  providers: ProviderHealthStatus[]
  recentEvents: HealthCheckEvent[]
  hasWarnings: boolean
  warnings: string[]
}

interface LLMHealthStatusProps {
  className?: string
  compact?: boolean
  showHistory?: boolean
  maxHistoryItems?: number
}

// ============================================================================
// Provider Icons
// ============================================================================

const PROVIDER_ICONS: Record<LLMProviderType, React.ReactNode> = {
  'lm-studio': <Server className="h-4 w-4" />,
  'claude': <Terminal className="h-4 w-4" />,
  'cursor': <Zap className="h-4 w-4" />,
  'ollama': <Server className="h-4 w-4" />,
  'openai': <Server className="h-4 w-4" />,
  'anthropic': <Terminal className="h-4 w-4" />,
  'custom': <Server className="h-4 w-4" />
}

const PROVIDER_NAMES: Record<LLMProviderType, string> = {
  'lm-studio': 'LM Studio',
  'claude': 'Claude CLI',
  'cursor': 'Cursor CLI',
  'ollama': 'Ollama',
  'openai': 'OpenAI',
  'anthropic': 'Anthropic',
  'custom': 'Custom Provider'
}

// ============================================================================
// Helper Functions
// ============================================================================

function formatTimestamp(timestamp: number): string {
  const date = new Date(timestamp)
  return date.toLocaleTimeString()
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`
  return `${(ms / 1000).toFixed(1)}s`
}

function getStatusColor(available: boolean, responseTimeMs?: number): string {
  if (!available) return 'text-red-500 dark:text-red-400'
  if (responseTimeMs && responseTimeMs > 2000) return 'text-yellow-500 dark:text-yellow-400'
  return 'text-green-500 dark:text-green-400'
}

function getStatusBgColor(available: boolean, responseTimeMs?: number): string {
  if (!available) return 'bg-red-50 dark:bg-red-950/30 border-red-200 dark:border-red-800'
  if (responseTimeMs && responseTimeMs > 2000) return 'bg-yellow-50 dark:bg-yellow-950/30 border-yellow-200 dark:border-yellow-800'
  return 'bg-green-50 dark:bg-green-950/30 border-green-200 dark:border-green-800'
}

function getEventTypeIcon(type: HealthCheckEvent['type']): React.ReactNode {
  switch (type) {
    case 'recovery':
      return <CheckCircle className="h-3 w-3 text-green-500" />
    case 'failure':
      return <XCircle className="h-3 w-3 text-red-500" />
    case 'fallback':
      return <AlertTriangle className="h-3 w-3 text-yellow-500" />
    default:
      return <Activity className="h-3 w-3 text-blue-500" />
  }
}

function getEventTypeLabel(type: HealthCheckEvent['type']): string {
  switch (type) {
    case 'recovery':
      return 'Recovered'
    case 'failure':
      return 'Failed'
    case 'fallback':
      return 'Fallback'
    default:
      return 'Check'
  }
}

// ============================================================================
// Main Component
// ============================================================================

export function LLMHealthStatus({
  className,
  compact = false,
  showHistory = true,
  maxHistoryItems = 10
}: LLMHealthStatusProps) {
  const [summary, setSummary] = useState<HealthSummary | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [isRefreshing, setIsRefreshing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [expandedProvider, setExpandedProvider] = useState<LLMProviderType | null>(null)
  const [showHistoryPanel, setShowHistoryPanel] = useState(false)
  const [isRunning, setIsRunning] = useState(false)

  // Load initial status
  useEffect(() => {
    const loadStatus = async () => {
      setIsLoading(true)
      try {
        const [healthSummary, running] = await Promise.all([
          window.electronAPI.llmHealthCheck.getSummary(),
          window.electronAPI.llmHealthCheck.isRunning()
        ])
        setSummary(healthSummary)
        setIsRunning(running)
        setError(null)
      } catch (err) {
        console.error('Failed to load health status:', err)
        setError(err instanceof Error ? err.message : 'Failed to load health status')
      } finally {
        setIsLoading(false)
      }
    }
    loadStatus()
  }, [])

  // Subscribe to status changes
  useEffect(() => {
    const unsubscribe = window.electronAPI.llmHealthCheck.onStatusChange((newSummary) => {
      setSummary(newSummary)
    })
    return () => unsubscribe()
  }, [])

  // Manual refresh handler
  const handleRefresh = useCallback(async () => {
    setIsRefreshing(true)
    try {
      const newSummary = await window.electronAPI.llmHealthCheck.runNow()
      setSummary(newSummary)
      setError(null)
    } catch (err) {
      console.error('Failed to run health check:', err)
      setError(err instanceof Error ? err.message : 'Failed to run health check')
    } finally {
      setIsRefreshing(false)
    }
  }, [])

  // Toggle provider expansion
  const toggleProvider = useCallback((provider: LLMProviderType) => {
    setExpandedProvider(prev => prev === provider ? null : provider)
  }, [])

  if (isLoading) {
    return (
      <div className={cn('flex items-center justify-center p-4', className)}>
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        <span className="ml-2 text-sm text-muted-foreground">Loading health status...</span>
      </div>
    )
  }

  if (error && !summary) {
    return (
      <div className={cn('p-4 bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-800 rounded-lg', className)}>
        <div className="flex items-center gap-2">
          <AlertCircle className="h-5 w-5 text-red-500" />
          <span className="text-sm text-red-700 dark:text-red-300">{error}</span>
        </div>
      </div>
    )
  }

  if (!summary) {
    return null
  }

  // Compact view
  if (compact) {
    return (
      <div
        className={cn(
          'flex items-center gap-2 p-2 rounded-lg border cursor-pointer hover:bg-secondary/50 transition-colors',
          summary.hasWarnings ? 'border-yellow-300 dark:border-yellow-700' : 'border-border',
          className
        )}
        onClick={handleRefresh}
        title="Click to refresh health status"
        data-testid="llm-health-compact"
      >
        {isRefreshing ? (
          <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
        ) : summary.availableProviders > 0 ? (
          <CheckCircle className="h-4 w-4 text-green-500" />
        ) : (
          <XCircle className="h-4 w-4 text-red-500" />
        )}
        <span className="text-xs text-muted-foreground">
          {summary.availableProviders}/{summary.totalProviders} providers
        </span>
      </div>
    )
  }

  return (
    <div className={cn('space-y-4', className)} data-testid="llm-health-status">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Activity className="h-5 w-5 text-purple-600" />
          <h3 className="font-semibold text-foreground">Provider Health Status</h3>
          {isRunning && (
            <span className="px-2 py-0.5 text-xs font-medium bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-300 rounded-full">
              Auto-monitoring
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          {summary.timestamp && (
            <span className="text-xs text-muted-foreground">
              Last check: {formatTimestamp(summary.timestamp)}
            </span>
          )}
          <button
            onClick={handleRefresh}
            disabled={isRefreshing}
            className={cn(
              'p-1.5 rounded-md hover:bg-secondary transition-colors',
              isRefreshing && 'opacity-50 cursor-not-allowed'
            )}
            title="Run health check now"
            data-testid="refresh-health-button"
          >
            <RefreshCw className={cn(
              'h-4 w-4 text-muted-foreground',
              isRefreshing && 'animate-spin'
            )} />
          </button>
        </div>
      </div>

      {/* Overall Status */}
      <div className={cn(
        'p-3 rounded-lg border',
        getStatusBgColor(summary.availableProviders > 0)
      )}>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            {summary.availableProviders > 0 ? (
              <CheckCircle className="h-5 w-5 text-green-500" />
            ) : (
              <XCircle className="h-5 w-5 text-red-500" />
            )}
            <span className="font-medium text-foreground">
              {summary.availableProviders} of {summary.totalProviders} providers available
            </span>
          </div>
          {summary.hasWarnings && (
            <span className="px-2 py-0.5 text-xs font-medium bg-yellow-100 dark:bg-yellow-900/30 text-yellow-700 dark:text-yellow-300 rounded-full">
              {summary.warnings.length} warning{summary.warnings.length !== 1 ? 's' : ''}
            </span>
          )}
        </div>

        {/* Warnings */}
        {summary.warnings.length > 0 && (
          <div className="mt-2 space-y-1">
            {summary.warnings.slice(0, 2).map((warning, idx) => (
              <p key={idx} className="text-xs text-muted-foreground">
                {warning}
              </p>
            ))}
          </div>
        )}
      </div>

      {/* Provider List */}
      <div className="space-y-2" data-testid="provider-health-list">
        {summary.providers.map((provider) => (
          <div
            key={provider.provider}
            className={cn(
              'border rounded-lg transition-all',
              expandedProvider === provider.provider ? 'border-purple-300 dark:border-purple-700' : 'border-border'
            )}
          >
            {/* Provider Header */}
            <button
              onClick={() => toggleProvider(provider.provider)}
              className="w-full flex items-center justify-between p-3 hover:bg-secondary/50 transition-colors rounded-lg"
              data-testid={`provider-health-${provider.provider}`}
            >
              <div className="flex items-center gap-3">
                <div className={cn(
                  'flex-shrink-0 w-8 h-8 rounded-lg flex items-center justify-center',
                  provider.available
                    ? 'bg-green-100 dark:bg-green-900/30 text-green-600'
                    : 'bg-red-100 dark:bg-red-900/30 text-red-500'
                )}>
                  {PROVIDER_ICONS[provider.provider]}
                </div>
                <div className="text-left">
                  <span className="font-medium text-foreground">
                    {PROVIDER_NAMES[provider.provider]}
                  </span>
                  <div className="flex items-center gap-2 text-xs">
                    <span className={getStatusColor(provider.available, provider.responseTimeMs)}>
                      {provider.available ? 'Available' : 'Unavailable'}
                    </span>
                    {provider.responseTimeMs && (
                      <span className="text-muted-foreground">
                        ({formatDuration(provider.responseTimeMs)})
                      </span>
                    )}
                    {provider.consecutiveFailures > 0 && (
                      <span className="text-red-500">
                        {provider.consecutiveFailures} failure{provider.consecutiveFailures !== 1 ? 's' : ''}
                      </span>
                    )}
                  </div>
                </div>
              </div>
              <div className="flex items-center gap-2">
                {!provider.available && (
                  <HelpCircle className="h-4 w-4 text-yellow-500" />
                )}
                {expandedProvider === provider.provider ? (
                  <ChevronUp className="h-4 w-4 text-muted-foreground" />
                ) : (
                  <ChevronDown className="h-4 w-4 text-muted-foreground" />
                )}
              </div>
            </button>

            {/* Expanded Details */}
            {expandedProvider === provider.provider && (
              <div className="px-3 pb-3 space-y-3 border-t border-border">
                {/* Status Details */}
                <div className="grid grid-cols-2 gap-3 mt-3 text-sm">
                  <div>
                    <span className="text-muted-foreground">Last Checked:</span>
                    <span className="ml-2 text-foreground">
                      {provider.lastChecked ? formatTimestamp(provider.lastChecked) : 'Never'}
                    </span>
                  </div>
                  {provider.lastSuccessTime && (
                    <div>
                      <span className="text-muted-foreground">Last Success:</span>
                      <span className="ml-2 text-foreground">
                        {formatTimestamp(provider.lastSuccessTime)}
                      </span>
                    </div>
                  )}
                </div>

                {/* Error and Troubleshooting */}
                {!provider.available && (
                  <div className="space-y-2">
                    {provider.error && (
                      <div className="p-2 bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-800 rounded-md">
                        <p className="text-xs text-red-700 dark:text-red-300 font-medium">Error</p>
                        <p className="text-xs text-red-600 dark:text-red-400 mt-1">{provider.error}</p>
                      </div>
                    )}

                    {provider.troubleshootingGuidance && (
                      <div className="p-2 bg-blue-50 dark:bg-blue-950/30 border border-blue-200 dark:border-blue-800 rounded-md">
                        <p className="text-xs text-blue-700 dark:text-blue-300 font-medium flex items-center gap-1">
                          <HelpCircle className="h-3 w-3" />
                          Troubleshooting
                        </p>
                        <pre className="text-xs text-blue-600 dark:text-blue-400 mt-1 whitespace-pre-wrap font-sans">
                          {provider.troubleshootingGuidance}
                        </pre>
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>
        ))}
      </div>

      {/* Event History */}
      {showHistory && summary.recentEvents.length > 0 && (
        <div className="border rounded-lg">
          <button
            onClick={() => setShowHistoryPanel(!showHistoryPanel)}
            className="w-full flex items-center justify-between p-3 hover:bg-secondary/50 transition-colors rounded-lg"
          >
            <div className="flex items-center gap-2">
              <History className="h-4 w-4 text-muted-foreground" />
              <span className="font-medium text-foreground">Recent Events</span>
              <span className="text-xs text-muted-foreground">
                ({summary.recentEvents.length})
              </span>
            </div>
            {showHistoryPanel ? (
              <ChevronUp className="h-4 w-4 text-muted-foreground" />
            ) : (
              <ChevronDown className="h-4 w-4 text-muted-foreground" />
            )}
          </button>

          {showHistoryPanel && (
            <div className="px-3 pb-3 border-t border-border">
              <div className="space-y-2 mt-3 max-h-48 overflow-y-auto">
                {summary.recentEvents.slice(0, maxHistoryItems).map((event) => (
                  <div
                    key={event.id}
                    className="flex items-center gap-2 text-xs py-1"
                  >
                    {getEventTypeIcon(event.type)}
                    <span className="text-muted-foreground">
                      {formatTimestamp(event.timestamp)}
                    </span>
                    <span className="font-medium text-foreground">
                      {PROVIDER_NAMES[event.provider]}
                    </span>
                    <span className={cn(
                      'px-1.5 py-0.5 rounded text-xs',
                      event.type === 'recovery' && 'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-300',
                      event.type === 'failure' && 'bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-300',
                      event.type === 'fallback' && 'bg-yellow-100 dark:bg-yellow-900/30 text-yellow-700 dark:text-yellow-300',
                      event.type === 'check' && 'bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300'
                    )}>
                      {getEventTypeLabel(event.type)}
                    </span>
                    {event.error && (
                      <span className="text-red-500 truncate max-w-32" title={event.error}>
                        {event.error}
                      </span>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

export default LLMHealthStatus
