/**
 * LLM Provider Manager
 *
 * Singleton manager for LLM providers with provider detection, routing,
 * and fallback mechanisms. This is the main entry point for the LLM
 * abstraction layer.
 *
 * Key Features:
 * - Provider registration and lifecycle management
 * - Automatic provider detection
 * - Smart routing with priority-based fallback
 * - Event system for provider state changes
 * - Backward compatibility with existing lmStudioClient usage
 *
 * Usage:
 * ```typescript
 * // Get the singleton manager
 * const manager = llmProviderManager
 *
 * // Use the default provider (LM Studio)
 * const result = await manager.chat('Hello!')
 *
 * // Or get a specific provider
 * const ollama = manager.getProvider('ollama')
 * const result = await ollama.chat('Hello!')
 * ```
 */

import type {
  ILLMProvider,
  LLMProviderType,
  LLMProviderConfig,
  ProviderPriority,
  ProviderAvailability,
  ProviderRegistration,
  ProviderSelectionCriteria,
  FallbackConfig,
  ProviderDetectionResult,
  ProviderDetectionOptions,
  ProviderEvent,
  ProviderEventType,
  ProviderEventListener,
  ChatCompletionParams,
  ProviderHealthResult,
  ProviderModelsResult,
  ProviderChatResult,
  ProviderSimpleChatResult
} from './llmProviderInterface'

import { DEFAULT_FALLBACK_CONFIG } from './llmProviderInterface'

import {
  llmProviderFactory,
  createProvider
} from './llmProviderFactory'

import { defaultLMStudioAdapter } from './adapters'

// ============================================================================
// Types
// ============================================================================

/**
 * Manager configuration
 */
export interface LLMProviderManagerConfig {
  /** Default provider type to use */
  defaultProvider: LLMProviderType
  /** Fallback configuration */
  fallback: FallbackConfig
  /** Whether to auto-detect providers on initialization */
  autoDetect: boolean
  /** Interval for automatic health checks (0 to disable) */
  healthCheckIntervalMs: number
}

/**
 * Default manager configuration
 */
const DEFAULT_MANAGER_CONFIG: LLMProviderManagerConfig = {
  defaultProvider: 'lm-studio',
  fallback: DEFAULT_FALLBACK_CONFIG,
  autoDetect: false,
  healthCheckIntervalMs: 0 // Disabled by default
}

// ============================================================================
// Provider Manager Class
// ============================================================================

/**
 * Singleton manager for LLM providers
 */
class LLMProviderManager {
  private config: LLMProviderManagerConfig
  private providers: Map<LLMProviderType, ProviderRegistration> = new Map()
  private availabilityCache: Map<LLMProviderType, ProviderAvailability> = new Map()
  private eventListeners: Map<ProviderEventType, Set<ProviderEventListener>> = new Map()
  private healthCheckInterval: NodeJS.Timeout | null = null
  private initialized: boolean = false

  constructor(config?: Partial<LLMProviderManagerConfig>) {
    this.config = { ...DEFAULT_MANAGER_CONFIG, ...config }
  }

  // --------------------------------------------------------------------------
  // Initialization
  // --------------------------------------------------------------------------

  /**
   * Initialize the provider manager
   * Registers the default LM Studio adapter for backward compatibility
   */
  async initialize(): Promise<void> {
    if (this.initialized) {
      return
    }

    // Register the default LM Studio adapter (uses shared client)
    this.registerProvider(defaultLMStudioAdapter, 'primary', true)

    // Start health check interval if configured
    if (this.config.healthCheckIntervalMs > 0) {
      this.startHealthCheckInterval()
    }

    // Auto-detect providers if configured
    if (this.config.autoDetect) {
      await this.detectProviders()
    }

    this.initialized = true
  }

  /**
   * Ensure manager is initialized before operations
   */
  private async ensureInitialized(): Promise<void> {
    if (!this.initialized) {
      await this.initialize()
    }
  }

  // --------------------------------------------------------------------------
  // Provider Registration
  // --------------------------------------------------------------------------

  /**
   * Register a provider
   * @param provider Provider instance
   * @param priority Provider priority
   * @param isDefault Whether this is the default provider
   */
  registerProvider(
    provider: ILLMProvider,
    priority: ProviderPriority = 'secondary',
    isDefault: boolean = false
  ): void {
    const registration: ProviderRegistration = {
      provider,
      priority,
      isDefault,
      enabled: true
    }

    // If this is the new default, update existing defaults
    if (isDefault) {
      for (const [type, reg] of this.providers) {
        if (reg.isDefault && type !== provider.type) {
          reg.isDefault = false
        }
      }
    }

    this.providers.set(provider.type, registration)
    this.emitEvent('provider:registered', provider.type)
  }

  /**
   * Register a provider by type (creates a new instance)
   * @param type Provider type
   * @param config Optional configuration
   * @param priority Provider priority
   * @param isDefault Whether this is the default provider
   */
  registerProviderByType(
    type: LLMProviderType,
    config?: Partial<LLMProviderConfig>,
    priority: ProviderPriority = 'secondary',
    isDefault: boolean = false
  ): void {
    const provider = createProvider(type, config)
    this.registerProvider(provider, priority, isDefault)
  }

  /**
   * Unregister a provider
   * @param type Provider type to unregister
   */
  unregisterProvider(type: LLMProviderType): void {
    const registration = this.providers.get(type)
    if (registration) {
      registration.provider.dispose()
      this.providers.delete(type)
      this.availabilityCache.delete(type)
      this.emitEvent('provider:unregistered', type)
    }
  }

  /**
   * Get a registered provider
   * @param type Provider type
   * @returns Provider instance or undefined
   */
  getProvider(type: LLMProviderType): ILLMProvider | undefined {
    return this.providers.get(type)?.provider
  }

  /**
   * Get the default provider
   * @returns Default provider instance
   */
  getDefaultProvider(): ILLMProvider {
    // Find the default provider
    for (const [, registration] of this.providers) {
      if (registration.isDefault && registration.enabled) {
        return registration.provider
      }
    }

    // Fallback to first enabled provider
    for (const [, registration] of this.providers) {
      if (registration.enabled) {
        return registration.provider
      }
    }

    // Last resort: create a new LM Studio adapter
    const adapter = createProvider('lm-studio')
    this.registerProvider(adapter, 'primary', true)
    return adapter
  }

  /**
   * Set the default provider
   * @param type Provider type to set as default
   */
  setDefaultProvider(type: LLMProviderType): void {
    const registration = this.providers.get(type)
    if (!registration) {
      throw new Error(`Provider ${type} is not registered`)
    }

    // Update default flags
    for (const [t, reg] of this.providers) {
      reg.isDefault = t === type
    }

    this.config.defaultProvider = type
    this.emitEvent('provider:switched', type)
  }

  /**
   * Enable or disable a provider
   * @param type Provider type
   * @param enabled Whether to enable the provider
   */
  setProviderEnabled(type: LLMProviderType, enabled: boolean): void {
    const registration = this.providers.get(type)
    if (registration) {
      registration.enabled = enabled
    }
  }

  /**
   * Get all registered provider types
   */
  getRegisteredProviders(): LLMProviderType[] {
    return Array.from(this.providers.keys())
  }

  /**
   * Get all enabled provider types
   */
  getEnabledProviders(): LLMProviderType[] {
    return Array.from(this.providers.entries())
      .filter(([, reg]) => reg.enabled)
      .map(([type]) => type)
  }

  // --------------------------------------------------------------------------
  // Provider Detection
  // --------------------------------------------------------------------------

  /**
   * Detect available providers
   * @param options Detection options
   * @returns Detection results
   */
  async detectProviders(options?: ProviderDetectionOptions): Promise<ProviderDetectionResult> {
    const startTime = Date.now()
    const providersToCheck = options?.providers || ['lm-studio', 'ollama'] as LLMProviderType[]
    const timeout = options?.timeoutMs || 5000
    const parallel = options?.parallel !== false

    const results: ProviderAvailability[] = []

    // Create providers for detection if not already registered
    const checkTasks = providersToCheck.map(async (type) => {
      let provider = this.getProvider(type)

      // Create temporary provider for detection
      if (!provider) {
        try {
          provider = createProvider(type)
        } catch {
          return {
            provider: type,
            available: false,
            error: `Failed to create provider: ${type}`,
            lastChecked: Date.now()
          }
        }
      }

      try {
        const healthResult = await Promise.race([
          provider.checkHealth(true),
          new Promise<ProviderHealthResult>((_, reject) =>
            setTimeout(() => reject(new Error('Timeout')), timeout)
          )
        ])

        const availability: ProviderAvailability = {
          provider: type,
          available: healthResult.success && healthResult.data?.healthy === true,
          responseTimeMs: healthResult.responseTimeMs,
          error: healthResult.error,
          lastChecked: Date.now(),
          loadedModel: healthResult.data?.loadedModel
        }

        // Cache availability
        this.availabilityCache.set(type, availability)

        return availability
      } catch (error) {
        return {
          provider: type,
          available: false,
          error: error instanceof Error ? error.message : 'Unknown error',
          lastChecked: Date.now()
        }
      }
    })

    if (parallel) {
      const checkResults = await Promise.all(checkTasks)
      results.push(...checkResults)
    } else {
      for (const task of checkTasks) {
        results.push(await task)
      }
    }

    // Determine recommended primary
    const availableProviders = results
      .filter(r => r.available)
      .sort((a, b) => (a.responseTimeMs || Infinity) - (b.responseTimeMs || Infinity))

    const recommendedPrimary = availableProviders[0]?.provider

    return {
      providers: results,
      recommendedPrimary,
      timestamp: Date.now(),
      detectionTimeMs: Date.now() - startTime
    }
  }

  /**
   * Get cached availability for a provider
   * @param type Provider type
   * @returns Cached availability or undefined
   */
  getCachedAvailability(type: LLMProviderType): ProviderAvailability | undefined {
    const cached = this.availabilityCache.get(type)

    // Check if cache is still valid
    if (cached && Date.now() - cached.lastChecked < this.config.fallback.availabilityCacheTtlMs) {
      return cached
    }

    return undefined
  }

  // --------------------------------------------------------------------------
  // Routing and Fallback
  // --------------------------------------------------------------------------

  /**
   * Select the best available provider based on criteria
   * @param criteria Selection criteria
   * @returns Selected provider or null if none available
   */
  async selectProvider(criteria?: ProviderSelectionCriteria): Promise<ILLMProvider | null> {
    await this.ensureInitialized()

    // If a preferred provider is specified and available, use it
    if (criteria?.preferredProvider) {
      const provider = this.getProvider(criteria.preferredProvider)
      if (provider) {
        const isAvailable = await provider.isAvailable()
        if (isAvailable) {
          return provider
        }
      }
    }

    // Try providers in priority order
    const priorityOrder: ProviderPriority[] = ['primary', 'secondary', 'tertiary', 'fallback']

    for (const priority of priorityOrder) {
      for (const [, registration] of this.providers) {
        if (registration.priority === priority && registration.enabled) {
          const isAvailable = await registration.provider.isAvailable()
          if (isAvailable) {
            return registration.provider
          }
        }
      }
    }

    return null
  }

  /**
   * Execute an operation with fallback support
   * @param operation Operation to execute
   * @param criteria Provider selection criteria
   * @returns Operation result
   */
  private async executeWithFallback<T>(
    operation: (provider: ILLMProvider) => Promise<T>,
    criteria?: ProviderSelectionCriteria
  ): Promise<T> {
    await this.ensureInitialized()

    if (!this.config.fallback.enabled) {
      const provider = await this.selectProvider(criteria)
      if (!provider) {
        throw new Error('No LLM provider available')
      }
      return operation(provider)
    }

    const errors: string[] = []
    const priorityOrder: ProviderPriority[] = ['primary', 'secondary', 'tertiary', 'fallback']

    for (let attempt = 0; attempt < this.config.fallback.maxAttempts; attempt++) {
      for (const priority of priorityOrder) {
        for (const [type, registration] of this.providers) {
          if (registration.priority !== priority || !registration.enabled) {
            continue
          }

          try {
            const result = await operation(registration.provider)

            // Check if result indicates failure (for ProviderResult types)
            if (result && typeof result === 'object' && 'success' in result) {
              const providerResult = result as { success: boolean; error?: string }
              if (!providerResult.success) {
                errors.push(`${type}: ${providerResult.error || 'Unknown error'}`)
                continue
              }
            }

            return result
          } catch (error) {
            const errorMsg = error instanceof Error ? error.message : 'Unknown error'
            errors.push(`${type}: ${errorMsg}`)
            this.emitEvent('provider:fallback-triggered', type, { error: errorMsg, attempt })
          }
        }
      }

      // Wait before next attempt
      if (attempt < this.config.fallback.maxAttempts - 1) {
        await new Promise(resolve =>
          setTimeout(resolve, this.config.fallback.delayBetweenAttemptsMs)
        )
      }
    }

    throw new Error(`All providers failed after ${this.config.fallback.maxAttempts} attempts:\n${errors.join('\n')}`)
  }

  // --------------------------------------------------------------------------
  // Convenience Methods (Delegates to Default Provider)
  // --------------------------------------------------------------------------

  /**
   * Check health of the default provider
   * @param forceRefresh Force a fresh health check
   */
  async checkHealth(forceRefresh: boolean = false): Promise<ProviderHealthResult> {
    return this.executeWithFallback(provider => provider.checkHealth(forceRefresh))
  }

  /**
   * Check if any provider is available
   */
  async isAvailable(): Promise<boolean> {
    try {
      const provider = await this.selectProvider()
      return provider !== null
    } catch {
      return false
    }
  }

  /**
   * List models from the default provider
   */
  async listModels(): Promise<ProviderModelsResult> {
    return this.executeWithFallback(provider => provider.listModels())
  }

  /**
   * Send a chat completion request
   * @param params Chat completion parameters
   * @param criteria Provider selection criteria
   */
  async chatCompletion(
    params: ChatCompletionParams,
    criteria?: ProviderSelectionCriteria
  ): Promise<ProviderChatResult> {
    return this.executeWithFallback(provider => provider.chatCompletion(params), criteria)
  }

  /**
   * Simple chat helper
   * @param userMessage User's message
   * @param systemPrompt Optional system prompt
   * @param options Additional options
   * @param criteria Provider selection criteria
   */
  async chat(
    userMessage: string,
    systemPrompt?: string,
    options?: Partial<ChatCompletionParams>,
    criteria?: ProviderSelectionCriteria
  ): Promise<ProviderSimpleChatResult> {
    return this.executeWithFallback(
      provider => provider.chat(userMessage, systemPrompt, options),
      criteria
    )
  }

  // --------------------------------------------------------------------------
  // Event System
  // --------------------------------------------------------------------------

  /**
   * Subscribe to provider events
   * @param type Event type
   * @param listener Event listener
   * @returns Unsubscribe function
   */
  on(type: ProviderEventType, listener: ProviderEventListener): () => void {
    if (!this.eventListeners.has(type)) {
      this.eventListeners.set(type, new Set())
    }
    this.eventListeners.get(type)!.add(listener)

    return () => {
      this.eventListeners.get(type)?.delete(listener)
    }
  }

  /**
   * Emit a provider event
   */
  private emitEvent(
    type: ProviderEventType,
    provider: LLMProviderType,
    data?: Record<string, unknown>
  ): void {
    const event: ProviderEvent = {
      type,
      provider,
      timestamp: Date.now(),
      data
    }

    const listeners = this.eventListeners.get(type)
    if (listeners) {
      for (const listener of listeners) {
        try {
          listener(event)
        } catch (error) {
          console.error(`Error in event listener for ${type}:`, error)
        }
      }
    }
  }

  // --------------------------------------------------------------------------
  // Health Check Interval
  // --------------------------------------------------------------------------

  /**
   * Start the health check interval
   */
  private startHealthCheckInterval(): void {
    if (this.healthCheckInterval) {
      return
    }

    this.healthCheckInterval = setInterval(async () => {
      for (const [type, registration] of this.providers) {
        if (registration.enabled) {
          try {
            const health = await registration.provider.checkHealth(true)
            const availability: ProviderAvailability = {
              provider: type,
              available: health.success && health.data?.healthy === true,
              responseTimeMs: health.responseTimeMs,
              error: health.error,
              lastChecked: Date.now(),
              loadedModel: health.data?.loadedModel
            }

            const previousAvailability = this.availabilityCache.get(type)
            this.availabilityCache.set(type, availability)

            // Emit event if availability changed
            if (previousAvailability?.available !== availability.available) {
              this.emitEvent('provider:health-changed', type, {
                previous: previousAvailability?.available,
                current: availability.available
              })
            }
          } catch (error) {
            this.emitEvent('provider:error', type, {
              error: error instanceof Error ? error.message : 'Unknown error'
            })
          }
        }
      }
    }, this.config.healthCheckIntervalMs)
  }

  /**
   * Stop the health check interval
   */
  private stopHealthCheckInterval(): void {
    if (this.healthCheckInterval) {
      clearInterval(this.healthCheckInterval)
      this.healthCheckInterval = null
    }
  }

  // --------------------------------------------------------------------------
  // Configuration
  // --------------------------------------------------------------------------

  /**
   * Get current manager configuration
   */
  getConfig(): LLMProviderManagerConfig {
    return { ...this.config }
  }

  /**
   * Update manager configuration
   */
  updateConfig(config: Partial<LLMProviderManagerConfig>): void {
    const previousConfig = { ...this.config }
    this.config = { ...this.config, ...config }

    // Handle health check interval changes
    if (config.healthCheckIntervalMs !== undefined) {
      this.stopHealthCheckInterval()
      if (config.healthCheckIntervalMs > 0) {
        this.startHealthCheckInterval()
      }
    }

    // Handle default provider change
    if (config.defaultProvider && config.defaultProvider !== previousConfig.defaultProvider) {
      this.setDefaultProvider(config.defaultProvider)
    }
  }

  // --------------------------------------------------------------------------
  // Cleanup
  // --------------------------------------------------------------------------

  /**
   * Reset all providers
   */
  reset(): void {
    for (const [, registration] of this.providers) {
      registration.provider.reset()
    }
    this.availabilityCache.clear()
  }

  /**
   * Dispose all resources
   */
  dispose(): void {
    this.stopHealthCheckInterval()

    for (const [, registration] of this.providers) {
      registration.provider.dispose()
    }

    this.providers.clear()
    this.availabilityCache.clear()
    this.eventListeners.clear()
    this.initialized = false
  }
}

// ============================================================================
// Singleton Export
// ============================================================================

/**
 * Singleton provider manager instance
 */
export const llmProviderManager = new LLMProviderManager()

/**
 * Initialize the provider manager
 * Call this once when the application starts
 */
export async function initializeLLMProviderManager(): Promise<void> {
  await llmProviderManager.initialize()
}

/**
 * Get a provider by type
 * @param type Provider type
 * @returns Provider instance
 */
export function getProvider(type: LLMProviderType): ILLMProvider | undefined {
  return llmProviderManager.getProvider(type)
}

/**
 * Get the default provider
 * @returns Default provider instance
 */
export function getDefaultProvider(): ILLMProvider {
  return llmProviderManager.getDefaultProvider()
}

/**
 * Detect available providers
 * @param options Detection options
 * @returns Detection results
 */
export async function detectProviders(
  options?: ProviderDetectionOptions
): Promise<ProviderDetectionResult> {
  return llmProviderManager.detectProviders(options)
}

/**
 * Reset all providers
 */
export function resetProviders(): void {
  llmProviderManager.reset()
}

/**
 * Dispose all provider resources
 */
export function disposeProviders(): void {
  llmProviderManager.dispose()
}

export default llmProviderManager
