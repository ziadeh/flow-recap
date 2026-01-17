/**
 * LLM Health Check Service
 *
 * Provides periodic health monitoring for all LLM providers (LM Studio, Claude CLI, Cursor CLI).
 * Tracks provider availability, response times, and failure events.
 * Offers troubleshooting guidance when providers are unavailable.
 *
 * Features:
 * - Periodic health checks with configurable interval
 * - Provider status history tracking
 * - Fallback event logging
 * - Troubleshooting guidance based on failure type
 * - Event-based status updates for UI reactivity
 */

import { llmProviderManager } from './llm/llmProviderManager'
import type {
  LLMProviderType,
  ProviderAvailability,
  ProviderEvent
} from './llm/llmProviderInterface'
import { loggerService } from './loggerService'

// ============================================================================
// Types
// ============================================================================

/**
 * Health check status for a provider
 */
export interface ProviderHealthStatus {
  provider: LLMProviderType
  available: boolean
  lastChecked: number
  responseTimeMs?: number
  error?: string
  consecutiveFailures: number
  lastSuccessTime?: number
  troubleshootingGuidance?: string
}

/**
 * Health check event for tracking history
 */
export interface HealthCheckEvent {
  id: string
  timestamp: number
  provider: LLMProviderType
  type: 'check' | 'failure' | 'recovery' | 'fallback'
  available: boolean
  responseTimeMs?: number
  error?: string
  details?: Record<string, unknown>
}

/**
 * Health check service configuration
 */
export interface HealthCheckConfig {
  /** Interval between health checks in milliseconds (default: 30000 = 30 seconds) */
  intervalMs: number
  /** Maximum number of events to keep in history (default: 100) */
  maxHistorySize: number
  /** Timeout for each provider health check in milliseconds (default: 5000) */
  timeoutMs: number
  /** Whether to automatically start health checks (default: false) */
  autoStart: boolean
  /** Providers to monitor (default: all registered) */
  providers?: LLMProviderType[]
}

/**
 * Overall health summary
 */
export interface HealthSummary {
  timestamp: number
  totalProviders: number
  availableProviders: number
  unavailableProviders: number
  providers: ProviderHealthStatus[]
  recentEvents: HealthCheckEvent[]
  hasWarnings: boolean
  warnings: string[]
}

/**
 * Status change callback type
 */
export type HealthStatusCallback = (summary: HealthSummary) => void

// ============================================================================
// Constants
// ============================================================================

const DEFAULT_CONFIG: HealthCheckConfig = {
  intervalMs: 30000, // 30 seconds
  maxHistorySize: 100,
  timeoutMs: 5000,
  autoStart: false
}

/**
 * Troubleshooting guidance messages for different providers
 */
const TROUBLESHOOTING_GUIDANCE: Record<LLMProviderType, Record<string, string>> = {
  'lm-studio': {
    default: 'LM Studio is not responding. Please check:\n1. LM Studio application is running\n2. Local server is started (Server tab in LM Studio)\n3. Server URL is correct (default: http://localhost:1234)\n4. A model is loaded in LM Studio',
    'ECONNREFUSED': 'Cannot connect to LM Studio. Make sure LM Studio is running and the server is started on the correct port.',
    'Timeout': 'LM Studio is responding slowly. Try loading a smaller model or check system resources.',
    'ENOTFOUND': 'LM Studio server URL is incorrect. Check the URL in settings (default: http://localhost:1234).'
  },
  'claude': {
    default: 'Claude CLI is not available. Please check:\n1. Claude CLI is installed (run "npm install -g @anthropic-ai/claude-cli" or "brew install anthropic/tap/claude")\n2. You have authenticated (run "claude login")\n3. Claude CLI is in your PATH environment variable',
    'not found': 'Claude CLI not found in PATH. Install it with "npm install -g @anthropic-ai/claude-cli" or "brew install anthropic/tap/claude".',
    'auth': 'Claude CLI is not authenticated. Run "claude login" in your terminal.',
    'ENOENT': 'Claude CLI executable not found. Make sure it is installed and accessible in your PATH.'
  },
  'cursor': {
    default: 'Cursor CLI is not available. Please check:\n1. Cursor application is installed from cursor.sh\n2. Cursor CLI is enabled in Cursor settings\n3. Cursor executable is in your PATH\n4. You are logged into Cursor',
    'not found': 'Cursor CLI not found. Install Cursor from https://cursor.sh and enable CLI access in settings.',
    'ENOENT': 'Cursor executable not found in PATH. Open Cursor app and enable "Install cursor command" from the command palette.'
  },
  'ollama': {
    default: 'Ollama is not responding. Please check:\n1. Ollama application is running\n2. Ollama server is accessible (default: http://localhost:11434)\n3. At least one model is pulled (run "ollama pull <model>")',
    'ECONNREFUSED': 'Cannot connect to Ollama. Make sure Ollama is running.',
    'no models': 'No models available in Ollama. Pull a model with "ollama pull llama2" or similar.'
  },
  'openai': {
    default: 'OpenAI API is not accessible. Check your API key and internet connection.',
    'auth': 'OpenAI API key is invalid or not set.'
  },
  'anthropic': {
    default: 'Anthropic API is not accessible. Check your API key and internet connection.',
    'auth': 'Anthropic API key is invalid or not set.'
  },
  'custom': {
    default: 'Custom provider is not responding. Check the provider configuration.'
  }
}

// ============================================================================
// Service Implementation
// ============================================================================

class LLMHealthCheckService {
  private config: HealthCheckConfig
  private providerStatus: Map<LLMProviderType, ProviderHealthStatus> = new Map()
  private eventHistory: HealthCheckEvent[] = []
  private healthCheckInterval: NodeJS.Timeout | null = null
  private statusCallbacks: Set<HealthStatusCallback> = new Set()
  private isRunning: boolean = false
  private unsubscribeFromManager: (() => void) | null = null
  private logger = loggerService.scope('LLMHealthCheck')

  constructor(config?: Partial<HealthCheckConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...config }
    this.setupEventListeners()
  }

  /**
   * Set up event listeners from the LLM provider manager
   */
  private setupEventListeners(): void {
    // Subscribe to provider health changes
    const unsubHealthChange = llmProviderManager.on('provider:health-changed', (event: ProviderEvent) => {
      this.handleHealthChange(event)
    })

    // Subscribe to fallback triggers
    const unsubFallback = llmProviderManager.on('provider:fallback-triggered', (event: ProviderEvent) => {
      this.handleFallbackTriggered(event)
    })

    // Subscribe to provider errors
    const unsubError = llmProviderManager.on('provider:error', (event: ProviderEvent) => {
      this.handleProviderError(event)
    })

    this.unsubscribeFromManager = () => {
      unsubHealthChange()
      unsubFallback()
      unsubError()
    }
  }

  /**
   * Handle health change events from the manager
   */
  private handleHealthChange(event: ProviderEvent): void {
    const isAvailable = event.data?.current as boolean
    const wasAvailable = event.data?.previous as boolean

    this.logger.info(`Provider health changed: ${event.provider}`, {
      action: 'health-change',
      provider: event.provider,
      wasAvailable,
      isAvailable
    })

    // Determine event type
    const eventType = !wasAvailable && isAvailable ? 'recovery' : 'check'

    this.addEvent({
      id: `${Date.now()}-${event.provider}-health`,
      timestamp: event.timestamp,
      provider: event.provider,
      type: eventType,
      available: isAvailable,
      details: event.data
    })

    this.notifyStatusChange()
  }

  /**
   * Handle fallback triggered events
   */
  private handleFallbackTriggered(event: ProviderEvent): void {
    this.logger.warn(`Fallback triggered for provider: ${event.provider}`, {
      action: 'fallback',
      provider: event.provider,
      error: event.data?.error,
      attempt: event.data?.attempt
    })

    this.addEvent({
      id: `${Date.now()}-${event.provider}-fallback`,
      timestamp: event.timestamp,
      provider: event.provider,
      type: 'fallback',
      available: false,
      error: event.data?.error as string,
      details: event.data
    })

    // Update consecutive failures
    const status = this.providerStatus.get(event.provider)
    if (status) {
      status.consecutiveFailures++
    }

    this.notifyStatusChange()
  }

  /**
   * Handle provider error events
   */
  private handleProviderError(event: ProviderEvent): void {
    const errorMsg = event.data?.error as string

    this.logger.error(`Provider error: ${event.provider}`, {
      action: 'error',
      provider: event.provider,
      error: errorMsg
    })

    this.addEvent({
      id: `${Date.now()}-${event.provider}-error`,
      timestamp: event.timestamp,
      provider: event.provider,
      type: 'failure',
      available: false,
      error: errorMsg,
      details: event.data
    })

    // Update status with error and troubleshooting guidance
    const status = this.providerStatus.get(event.provider)
    if (status) {
      status.error = errorMsg
      status.consecutiveFailures++
      status.troubleshootingGuidance = this.getTroubleshootingGuidance(event.provider, errorMsg)
    }

    this.notifyStatusChange()
  }

  /**
   * Get troubleshooting guidance based on provider and error
   */
  getTroubleshootingGuidance(provider: LLMProviderType, error?: string): string {
    const guidance = TROUBLESHOOTING_GUIDANCE[provider] || TROUBLESHOOTING_GUIDANCE['custom']

    if (error) {
      // Try to match specific error patterns
      for (const [pattern, message] of Object.entries(guidance)) {
        if (pattern !== 'default' && error.toLowerCase().includes(pattern.toLowerCase())) {
          return message
        }
      }
    }

    return guidance.default
  }

  /**
   * Add an event to history
   */
  private addEvent(event: HealthCheckEvent): void {
    this.eventHistory.unshift(event)

    // Trim history if needed
    if (this.eventHistory.length > this.config.maxHistorySize) {
      this.eventHistory = this.eventHistory.slice(0, this.config.maxHistorySize)
    }
  }

  /**
   * Start periodic health checks
   */
  start(): void {
    if (this.isRunning) {
      this.logger.debug('Health check service already running')
      return
    }

    this.logger.info('Starting health check service', {
      intervalMs: this.config.intervalMs
    })

    this.isRunning = true

    // Run initial check
    this.runHealthCheck()

    // Set up periodic checks
    this.healthCheckInterval = setInterval(() => {
      this.runHealthCheck()
    }, this.config.intervalMs)
  }

  /**
   * Stop periodic health checks
   */
  stop(): void {
    if (!this.isRunning) {
      return
    }

    this.logger.info('Stopping health check service')

    if (this.healthCheckInterval) {
      clearInterval(this.healthCheckInterval)
      this.healthCheckInterval = null
    }

    this.isRunning = false
  }

  /**
   * Run a health check on all providers
   */
  async runHealthCheck(): Promise<HealthSummary> {
    const startTime = Date.now()
    this.logger.debug('Running health check')

    try {
      // Get providers to check
      const providersToCheck = this.config.providers ||
        ['lm-studio', 'claude', 'cursor'] as LLMProviderType[]

      // Detect providers with current status
      const result = await llmProviderManager.detectProviders({
        providers: providersToCheck,
        timeoutMs: this.config.timeoutMs,
        parallel: true
      })

      // Update provider status
      for (const availability of result.providers) {
        this.updateProviderStatus(availability)
      }

      const summary = this.getSummary()

      this.logger.debug(`Health check completed in ${Date.now() - startTime}ms`, {
        available: summary.availableProviders,
        unavailable: summary.unavailableProviders
      })

      // Notify subscribers
      this.notifyStatusChange()

      return summary
    } catch (error) {
      this.logger.error('Health check failed', error instanceof Error ? error : new Error(String(error)))
      throw error
    }
  }

  /**
   * Update status for a provider
   */
  private updateProviderStatus(availability: ProviderAvailability): void {
    const existing = this.providerStatus.get(availability.provider)
    const now = Date.now()

    const newStatus: ProviderHealthStatus = {
      provider: availability.provider,
      available: availability.available,
      lastChecked: availability.lastChecked,
      responseTimeMs: availability.responseTimeMs,
      error: availability.error,
      consecutiveFailures: availability.available ? 0 : (existing?.consecutiveFailures || 0) + 1,
      lastSuccessTime: availability.available ? now : existing?.lastSuccessTime,
      troubleshootingGuidance: availability.available
        ? undefined
        : this.getTroubleshootingGuidance(availability.provider, availability.error)
    }

    // Check for status change (recovery or failure)
    if (existing) {
      if (!existing.available && availability.available) {
        // Recovery
        this.addEvent({
          id: `${now}-${availability.provider}-recovery`,
          timestamp: now,
          provider: availability.provider,
          type: 'recovery',
          available: true,
          responseTimeMs: availability.responseTimeMs
        })
        this.logger.info(`Provider recovered: ${availability.provider}`, {
          action: 'recovery',
          responseTimeMs: availability.responseTimeMs
        })
      } else if (existing.available && !availability.available) {
        // New failure
        this.addEvent({
          id: `${now}-${availability.provider}-failure`,
          timestamp: now,
          provider: availability.provider,
          type: 'failure',
          available: false,
          error: availability.error
        })
        this.logger.warn(`Provider became unavailable: ${availability.provider}`, {
          action: 'failure',
          error: availability.error
        })
      }
    }

    this.providerStatus.set(availability.provider, newStatus)
  }

  /**
   * Get the current health summary
   */
  getSummary(): HealthSummary {
    const providers = Array.from(this.providerStatus.values())
    const availableCount = providers.filter(p => p.available).length
    const unavailableCount = providers.filter(p => !p.available).length

    // Generate warnings
    const warnings: string[] = []

    for (const provider of providers) {
      if (!provider.available) {
        warnings.push(`${provider.provider} is unavailable: ${provider.error || 'Unknown error'}`)
      } else if (provider.responseTimeMs && provider.responseTimeMs > 2000) {
        warnings.push(`${provider.provider} is responding slowly (${provider.responseTimeMs}ms)`)
      }
    }

    // Add warning if no providers are available
    if (availableCount === 0 && providers.length > 0) {
      warnings.unshift('No LLM providers are currently available. AI features will not work.')
    }

    return {
      timestamp: Date.now(),
      totalProviders: providers.length,
      availableProviders: availableCount,
      unavailableProviders: unavailableCount,
      providers,
      recentEvents: this.eventHistory.slice(0, 20),
      hasWarnings: warnings.length > 0,
      warnings
    }
  }

  /**
   * Get status for a specific provider
   */
  getProviderStatus(provider: LLMProviderType): ProviderHealthStatus | undefined {
    return this.providerStatus.get(provider)
  }

  /**
   * Get event history
   */
  getEventHistory(limit?: number): HealthCheckEvent[] {
    return limit ? this.eventHistory.slice(0, limit) : this.eventHistory
  }

  /**
   * Subscribe to status changes
   */
  onStatusChange(callback: HealthStatusCallback): () => void {
    this.statusCallbacks.add(callback)
    return () => {
      this.statusCallbacks.delete(callback)
    }
  }

  /**
   * Notify all subscribers of status change
   */
  private notifyStatusChange(): void {
    const summary = this.getSummary()
    for (const callback of this.statusCallbacks) {
      try {
        callback(summary)
      } catch (error) {
        this.logger.error('Error in status change callback', error instanceof Error ? error : new Error(String(error)))
      }
    }
  }

  /**
   * Update configuration
   */
  updateConfig(config: Partial<HealthCheckConfig>): void {
    const wasRunning = this.isRunning

    if (wasRunning) {
      this.stop()
    }

    this.config = { ...this.config, ...config }

    if (wasRunning) {
      this.start()
    }
  }

  /**
   * Get current configuration
   */
  getConfig(): HealthCheckConfig {
    return { ...this.config }
  }

  /**
   * Check if service is running
   */
  isHealthCheckRunning(): boolean {
    return this.isRunning
  }

  /**
   * Clear event history
   */
  clearHistory(): void {
    this.eventHistory = []
    this.logger.info('Event history cleared')
  }

  /**
   * Reset all provider status
   */
  reset(): void {
    this.stop()
    this.providerStatus.clear()
    this.eventHistory = []
    this.statusCallbacks.clear()
    this.logger.info('Health check service reset')
  }

  /**
   * Dispose the service
   */
  dispose(): void {
    this.reset()
    if (this.unsubscribeFromManager) {
      this.unsubscribeFromManager()
      this.unsubscribeFromManager = null
    }
    this.logger.info('Health check service disposed')
  }
}

// ============================================================================
// Singleton Export
// ============================================================================

/**
 * Singleton health check service instance
 */
export const llmHealthCheckService = new LLMHealthCheckService()

/**
 * Start the health check service
 */
export function startHealthChecks(config?: Partial<HealthCheckConfig>): void {
  if (config) {
    llmHealthCheckService.updateConfig(config)
  }
  llmHealthCheckService.start()
}

/**
 * Stop the health check service
 */
export function stopHealthChecks(): void {
  llmHealthCheckService.stop()
}

/**
 * Run a single health check
 */
export function runHealthCheck(): Promise<HealthSummary> {
  return llmHealthCheckService.runHealthCheck()
}

/**
 * Get current health summary
 */
export function getHealthSummary(): HealthSummary {
  return llmHealthCheckService.getSummary()
}

/**
 * Get troubleshooting guidance for a provider
 */
export function getProviderTroubleshootingGuidance(
  provider: LLMProviderType,
  error?: string
): string {
  return llmHealthCheckService.getTroubleshootingGuidance(provider, error)
}

/**
 * Reset the health check service
 */
export function resetHealthCheckService(): void {
  llmHealthCheckService.reset()
}

export default llmHealthCheckService
