/**
 * LLM Routing Service
 *
 * Implements intelligent routing logic that directs LLM requests to the user-selected
 * provider (Claude CLI, Cursor CLI, or LM Studio). Automatically falls back to LM Studio
 * if the selected provider fails, is unavailable, or returns errors.
 *
 * Key Features:
 * - Routes requests to user-preferred provider
 * - Priority-based fallback: Selected Provider → LM Studio → Other available providers
 * - Comprehensive logging of fallback events for debugging
 * - Seamless integration with existing LLM services
 * - Preserves backward compatibility with lmStudioClient interface
 */

import { settingsService } from '../settingsService'
import { llmProviderManager } from './llmProviderManager'
import { createProvider } from './llmProviderFactory'
import type {
  LLMProviderType,
  ILLMProvider,
  ChatCompletionParams,
  ProviderChatResult,
  ProviderHealthResult,
  ProviderModelsResult,
  ProviderSimpleChatResult,
  ChatMessage
} from './llmProviderInterface'

// ============================================================================
// Types
// ============================================================================

/**
 * Fallback event for logging
 */
export interface FallbackEvent {
  /** Timestamp of the event */
  timestamp: number
  /** Original provider that failed */
  originalProvider: LLMProviderType
  /** Provider that was used as fallback */
  fallbackProvider: LLMProviderType
  /** Reason for the fallback */
  reason: string
  /** Error details if any */
  errorDetails?: string
  /** Operation that triggered the fallback */
  operation: 'chatCompletion' | 'chat' | 'checkHealth' | 'listModels'
  /** Whether the fallback succeeded */
  fallbackSucceeded: boolean
}

/**
 * Routing result with metadata
 */
export interface RoutingResult<T> {
  /** The actual result */
  result: T
  /** Provider that handled the request */
  usedProvider: LLMProviderType
  /** Whether a fallback was used */
  usedFallback: boolean
  /** Fallback chain if fallback was used */
  fallbackChain?: LLMProviderType[]
  /** Response time in milliseconds */
  responseTimeMs: number
}

/**
 * Routing configuration
 */
export interface RoutingConfig {
  /** Default provider if none is selected */
  defaultProvider: LLMProviderType
  /** Fallback providers in priority order */
  fallbackOrder: LLMProviderType[]
  /** Maximum number of providers to try */
  maxProviderAttempts: number
  /** Whether to log fallback events */
  logFallbackEvents: boolean
  /** Timeout for provider health checks (ms) */
  healthCheckTimeout: number
}

// ============================================================================
// Default Configuration
// ============================================================================

const DEFAULT_ROUTING_CONFIG: RoutingConfig = {
  defaultProvider: 'lm-studio',
  fallbackOrder: ['lm-studio', 'claude', 'cursor', 'ollama'],
  maxProviderAttempts: 3,
  logFallbackEvents: true,
  healthCheckTimeout: 5000
}

// ============================================================================
// Logging Functions
// ============================================================================

/**
 * Format a fallback event for logging
 */
function formatFallbackEvent(event: FallbackEvent): string {
  const timestamp = new Date(event.timestamp).toISOString()
  const status = event.fallbackSucceeded ? '✓' : '✗'
  return `[${timestamp}] [LLM Routing] ${status} Fallback: ${event.originalProvider} → ${event.fallbackProvider} | Reason: ${event.reason}${event.errorDetails ? ` | Error: ${event.errorDetails}` : ''}`
}

// ============================================================================
// LLM Routing Service Class
// ============================================================================

class LLMRoutingService {
  private config: RoutingConfig
  private fallbackEvents: FallbackEvent[] = []
  private providerCache: Map<LLMProviderType, ILLMProvider> = new Map()
  private initialized: boolean = false

  constructor(config?: Partial<RoutingConfig>) {
    this.config = { ...DEFAULT_ROUTING_CONFIG, ...config }
  }

  // --------------------------------------------------------------------------
  // Initialization
  // --------------------------------------------------------------------------

  /**
   * Initialize the routing service
   * This ensures the provider manager is initialized
   */
  async initialize(): Promise<void> {
    if (this.initialized) {
      return
    }

    // Ensure the provider manager is initialized
    await llmProviderManager.initialize()

    this.initialized = true
  }

  /**
   * Ensure service is initialized before operations
   */
  private async ensureInitialized(): Promise<void> {
    if (!this.initialized) {
      await this.initialize()
    }
  }

  // --------------------------------------------------------------------------
  // Provider Selection
  // --------------------------------------------------------------------------

  /**
   * Get the user's preferred provider from settings
   */
  async getUserPreferredProvider(): Promise<LLMProviderType> {
    try {
      const savedProvider = settingsService.get<string>('ai.provider')
      if (savedProvider && this.isValidProviderType(savedProvider)) {
        return savedProvider as LLMProviderType
      }
    } catch (error) {
      console.warn('[LLM Routing] Failed to get user preferred provider from settings:', error)
    }
    return this.config.defaultProvider
  }

  /**
   * Get the user's selected model for a specific provider from settings
   * @param providerType The provider type to get the model for
   * @returns The model ID string or undefined if not set
   */
  getUserSelectedModel(providerType: LLMProviderType): string | undefined {
    try {
      switch (providerType) {
        case 'claude': {
          const claudeModel = settingsService.get<string>('ai.claudeModel')
          if (claudeModel) {
            // Map user-friendly model names to actual model IDs
            return this.mapClaudeModelToId(claudeModel)
          }
          break
        }
        case 'cursor': {
          const cursorModel = settingsService.get<string>('ai.cursorModel')
          if (cursorModel) {
            return cursorModel
          }
          break
        }
        case 'lm-studio':
        case 'ollama': {
          const model = settingsService.get<string>('ai.model')
          if (model && model !== 'default') {
            return model
          }
          break
        }
        default:
          break
      }
    } catch (error) {
      console.warn(`[LLM Routing] Failed to get user selected model for ${providerType}:`, error)
    }
    return undefined
  }

  /**
   * Map Claude model short names (haiku, sonnet, opus) to actual model IDs
   */
  private mapClaudeModelToId(modelName: string): string {
    const modelMap: Record<string, string> = {
      'haiku': 'claude-3-haiku-20240307',
      'sonnet': 'claude-sonnet-4-20250514',
      'opus': 'claude-3-opus-20240229'
    }
    return modelMap[modelName.toLowerCase()] || modelName
  }

  /**
   * Validate if a string is a valid provider type
   */
  private isValidProviderType(type: string): type is LLMProviderType {
    return ['lm-studio', 'ollama', 'claude', 'cursor', 'openai', 'anthropic', 'custom'].includes(type)
  }

  /**
   * Get or create a provider instance
   */
  private getOrCreateProvider(type: LLMProviderType): ILLMProvider | null {
    // Check cache first
    if (this.providerCache.has(type)) {
      return this.providerCache.get(type)!
    }

    // Try to get from provider manager
    let provider = llmProviderManager.getProvider(type)

    if (!provider) {
      // Create new provider if not registered
      try {
        provider = createProvider(type)
        this.providerCache.set(type, provider)
      } catch (error) {
        console.warn(`[LLM Routing] Failed to create provider ${type}:`, error)
        return null
      }
    } else {
      this.providerCache.set(type, provider)
    }

    return provider
  }

  /**
   * Get fallback providers in priority order, ensuring LM Studio is always included
   */
  private getFallbackProviders(excludeProvider?: LLMProviderType): LLMProviderType[] {
    const fallbackOrder = [...this.config.fallbackOrder]

    // Ensure LM Studio is in the fallback order
    if (!fallbackOrder.includes('lm-studio')) {
      fallbackOrder.unshift('lm-studio')
    }

    // Remove the excluded provider (typically the one that just failed)
    if (excludeProvider) {
      const index = fallbackOrder.indexOf(excludeProvider)
      if (index !== -1) {
        fallbackOrder.splice(index, 1)
      }
    }

    return fallbackOrder
  }

  // --------------------------------------------------------------------------
  // Fallback Event Logging
  // --------------------------------------------------------------------------

  /**
   * Log a fallback event
   */
  private logFallbackEvent(event: FallbackEvent): void {
    this.fallbackEvents.push(event)

    // Keep only the last 100 events
    if (this.fallbackEvents.length > 100) {
      this.fallbackEvents.shift()
    }

    if (this.config.logFallbackEvents) {
      const message = formatFallbackEvent(event)
      if (event.fallbackSucceeded) {
        console.info(message)
      } else {
        console.warn(message)
      }
    }
  }

  /**
   * Get recent fallback events
   */
  getFallbackEvents(limit: number = 20): FallbackEvent[] {
    return this.fallbackEvents.slice(-limit)
  }

  /**
   * Clear fallback event history
   */
  clearFallbackEvents(): void {
    this.fallbackEvents = []
  }

  // --------------------------------------------------------------------------
  // Core Routing Methods
  // --------------------------------------------------------------------------

  /**
   * Execute an operation with intelligent routing and fallback
   *
   * @param operation - The operation to execute (receives a provider and its type)
   * @param operationName - Name of the operation for logging
   * @returns The result wrapped with routing metadata
   */
  private async executeWithRouting<T>(
    operation: (provider: ILLMProvider, providerType: LLMProviderType) => Promise<T>,
    operationName: 'chatCompletion' | 'chat' | 'checkHealth' | 'listModels'
  ): Promise<RoutingResult<T>> {
    await this.ensureInitialized()

    const startTime = Date.now()
    const preferredProvider = await this.getUserPreferredProvider()
    const fallbackChain: LLMProviderType[] = []
    let lastError: string | undefined

    // First, try the user's preferred provider
    const primaryProvider = this.getOrCreateProvider(preferredProvider)

    if (primaryProvider) {
      try {
        // Check if provider is available (quick health check)
        const isAvailable = await primaryProvider.isAvailable()

        if (isAvailable) {
          const result = await operation(primaryProvider, preferredProvider)

          // Check if result indicates success
          if (this.isSuccessfulResult(result)) {
            return {
              result,
              usedProvider: preferredProvider,
              usedFallback: false,
              responseTimeMs: Date.now() - startTime
            }
          } else {
            lastError = this.extractErrorFromResult(result)
          }
        } else {
          lastError = `Provider ${preferredProvider} is not available`
        }
      } catch (error) {
        lastError = error instanceof Error ? error.message : String(error)
      }
    } else {
      lastError = `Could not create provider ${preferredProvider}`
    }

    // Primary provider failed, try fallback providers
    const fallbackProviders = this.getFallbackProviders(preferredProvider)

    for (const fallbackType of fallbackProviders) {
      if (fallbackChain.length >= this.config.maxProviderAttempts - 1) {
        break
      }

      fallbackChain.push(fallbackType)
      const fallbackProvider = this.getOrCreateProvider(fallbackType)

      if (!fallbackProvider) {
        continue
      }

      try {
        const isAvailable = await fallbackProvider.isAvailable()

        if (!isAvailable) {
          this.logFallbackEvent({
            timestamp: Date.now(),
            originalProvider: preferredProvider,
            fallbackProvider: fallbackType,
            reason: 'Provider not available',
            errorDetails: lastError,
            operation: operationName,
            fallbackSucceeded: false
          })
          continue
        }

        const result = await operation(fallbackProvider, fallbackType)

        if (this.isSuccessfulResult(result)) {
          // Log successful fallback
          this.logFallbackEvent({
            timestamp: Date.now(),
            originalProvider: preferredProvider,
            fallbackProvider: fallbackType,
            reason: lastError || 'Primary provider failed',
            operation: operationName,
            fallbackSucceeded: true
          })

          return {
            result,
            usedProvider: fallbackType,
            usedFallback: true,
            fallbackChain,
            responseTimeMs: Date.now() - startTime
          }
        }

        lastError = this.extractErrorFromResult(result)
      } catch (error) {
        lastError = error instanceof Error ? error.message : String(error)

        this.logFallbackEvent({
          timestamp: Date.now(),
          originalProvider: preferredProvider,
          fallbackProvider: fallbackType,
          reason: 'Provider threw exception',
          errorDetails: lastError,
          operation: operationName,
          fallbackSucceeded: false
        })
      }
    }

    // All providers failed - build a helpful error message
    const triedProviders = [preferredProvider, ...fallbackChain].join(' → ')
    const troubleshootingTips = this.getTroubleshootingTips(preferredProvider, lastError)

    throw new Error(
      `All LLM providers failed for operation "${operationName}". ` +
      `Tried: ${triedProviders}. ` +
      `Last error: ${lastError || 'Unknown error'}\n\n` +
      `Troubleshooting tips:\n${troubleshootingTips}`
    )
  }

  /**
   * Get troubleshooting tips based on the preferred provider and error
   */
  private getTroubleshootingTips(preferredProvider: LLMProviderType, lastError?: string): string {
    const tips: string[] = []

    // Provider-specific tips
    switch (preferredProvider) {
      case 'lm-studio':
        tips.push('• Ensure LM Studio is running on your computer')
        tips.push('• Check that LM Studio server is started (click "Start Server" in LM Studio)')
        tips.push('• Verify the server URL is correct (default: http://localhost:1234)')
        tips.push('• Make sure a model is loaded in LM Studio')
        break
      case 'claude':
        tips.push('• Ensure Claude CLI is installed: Run "npm install -g @anthropic-ai/claude-cli"')
        tips.push('• Authenticate by running "claude login" in your terminal')
        tips.push('• Check that ~/.claude/ directory exists with valid credentials')
        break
      case 'cursor':
        tips.push('• Install Cursor IDE from https://cursor.com/download')
        tips.push('• Ensure Cursor is properly installed (not just the CLI)')
        tips.push('• The Cursor CLI requires the full Cursor IDE application')
        break
      case 'ollama':
        tips.push('• Ensure Ollama is installed and running')
        tips.push('• Start Ollama with "ollama serve" command')
        tips.push('• Verify a model is pulled: "ollama pull llama2"')
        break
      default:
        tips.push('• Ensure your selected AI provider is properly configured')
    }

    // Error-specific tips
    if (lastError) {
      if (lastError.includes('ECONNREFUSED') || lastError.includes('connection')) {
        tips.push('• Check that the server is running and accessible')
        tips.push('• Verify no firewall is blocking the connection')
      }
      if (lastError.includes('timeout') || lastError.includes('Timeout')) {
        tips.push('• The server might be overloaded - try again in a moment')
        tips.push('• Consider increasing the timeout in settings')
      }
      if (lastError.includes('No Cursor IDE installation found')) {
        tips.push('• The Cursor CLI was found but the Cursor IDE is not installed')
        tips.push('• Download and install Cursor IDE from https://cursor.com/download')
      }
      if (lastError.includes('not authenticated') || lastError.includes('login')) {
        tips.push('• You need to authenticate with your provider')
      }
    }

    // General fallback tip
    tips.push('• Consider using LM Studio as a reliable local alternative: https://lmstudio.ai/')

    return tips.join('\n')
  }

  /**
   * Check if a result indicates success
   */
  private isSuccessfulResult<T>(result: T): boolean {
    if (result === null || result === undefined) {
      return false
    }

    if (typeof result === 'object' && 'success' in result) {
      return (result as { success: boolean }).success
    }

    return true
  }

  /**
   * Extract error message from a failed result
   */
  private extractErrorFromResult<T>(result: T): string | undefined {
    if (result && typeof result === 'object' && 'error' in result) {
      return (result as { error?: string }).error
    }
    return undefined
  }

  // --------------------------------------------------------------------------
  // Public API (Mirrors lmStudioClient interface)
  // --------------------------------------------------------------------------

  /**
   * Check health of the routing service
   * Returns health from the first available provider
   */
  async checkHealth(forceRefresh: boolean = false): Promise<ProviderHealthResult> {
    const routingResult = await this.executeWithRouting(
      (provider, _providerType) => provider.checkHealth(forceRefresh),
      'checkHealth'
    )
    return routingResult.result
  }

  /**
   * Check if any provider is available
   */
  async isAvailable(): Promise<boolean> {
    try {
      await this.ensureInitialized()
      const preferredProvider = await this.getUserPreferredProvider()
      const provider = this.getOrCreateProvider(preferredProvider)

      if (provider && await provider.isAvailable()) {
        return true
      }

      // Check fallback providers
      for (const fallbackType of this.getFallbackProviders(preferredProvider)) {
        const fallbackProvider = this.getOrCreateProvider(fallbackType)
        if (fallbackProvider && await fallbackProvider.isAvailable()) {
          return true
        }
      }

      return false
    } catch {
      return false
    }
  }

  /**
   * List models from the current provider
   */
  async listModels(): Promise<ProviderModelsResult> {
    const routingResult = await this.executeWithRouting(
      (provider, _providerType) => provider.listModels(),
      'listModels'
    )
    return routingResult.result
  }

  /**
   * Send a chat completion request with routing
   * Automatically injects the user's selected model from settings if not already specified
   */
  async chatCompletion(request: ChatCompletionParams): Promise<ProviderChatResult> {
    const preferredProvider = await this.getUserPreferredProvider()

    // Inject user's selected model if not already specified in the request
    const requestWithModel = { ...request }
    if (!requestWithModel.model) {
      const userModel = this.getUserSelectedModel(preferredProvider)
      if (userModel) {
        requestWithModel.model = userModel
        console.info(`[LLM Routing] Using user-selected model: ${userModel} for provider: ${preferredProvider}`)
      }
    }

    const routingResult = await this.executeWithRouting(
      (provider, providerType) => {
        // If we're falling back to a different provider, get the model for that provider
        if (providerType !== preferredProvider) {
          const fallbackModel = this.getUserSelectedModel(providerType)
          if (fallbackModel) {
            console.info(`[LLM Routing] Using fallback model: ${fallbackModel} for provider: ${providerType}`)
            return provider.chatCompletion({ ...requestWithModel, model: fallbackModel })
          }
        }
        return provider.chatCompletion(requestWithModel)
      },
      'chatCompletion'
    )
    return routingResult.result
  }

  /**
   * Simple chat helper with routing
   * Automatically injects the user's selected model from settings if not already specified
   */
  async chat(
    userMessage: string,
    systemPrompt?: string,
    options?: Partial<ChatCompletionParams>
  ): Promise<ProviderSimpleChatResult> {
    const preferredProvider = await this.getUserPreferredProvider()

    // Inject user's selected model if not already specified in options
    const optionsWithModel = { ...options }
    if (!optionsWithModel?.model) {
      const userModel = this.getUserSelectedModel(preferredProvider)
      if (userModel) {
        optionsWithModel.model = userModel
        console.info(`[LLM Routing] Using user-selected model: ${userModel} for provider: ${preferredProvider}`)
      }
    }

    const routingResult = await this.executeWithRouting(
      (provider, providerType) => {
        // If we're falling back to a different provider, get the model for that provider
        if (providerType !== preferredProvider) {
          const fallbackModel = this.getUserSelectedModel(providerType)
          if (fallbackModel) {
            console.info(`[LLM Routing] Using fallback model: ${fallbackModel} for provider: ${providerType}`)
            return provider.chat(userMessage, systemPrompt, { ...optionsWithModel, model: fallbackModel })
          }
        }
        return provider.chat(userMessage, systemPrompt, optionsWithModel)
      },
      'chat'
    )
    return routingResult.result
  }

  // --------------------------------------------------------------------------
  // Extended API for routing-specific operations
  // --------------------------------------------------------------------------

  /**
   * Execute a chat completion with full routing metadata
   * Automatically injects the user's selected model from settings if not already specified
   */
  async chatCompletionWithRouting(request: ChatCompletionParams): Promise<RoutingResult<ProviderChatResult>> {
    const preferredProvider = await this.getUserPreferredProvider()

    // Inject user's selected model if not already specified in the request
    const requestWithModel = { ...request }
    if (!requestWithModel.model) {
      const userModel = this.getUserSelectedModel(preferredProvider)
      if (userModel) {
        requestWithModel.model = userModel
        console.info(`[LLM Routing] Using user-selected model: ${userModel} for provider: ${preferredProvider}`)
      }
    }

    return this.executeWithRouting(
      (provider, providerType) => {
        // If we're falling back to a different provider, get the model for that provider
        if (providerType !== preferredProvider) {
          const fallbackModel = this.getUserSelectedModel(providerType)
          if (fallbackModel) {
            console.info(`[LLM Routing] Using fallback model: ${fallbackModel} for provider: ${providerType}`)
            return provider.chatCompletion({ ...requestWithModel, model: fallbackModel })
          }
        }
        return provider.chatCompletion(requestWithModel)
      },
      'chatCompletion'
    )
  }

  /**
   * Get information about the current routing configuration
   */
  async getRoutingInfo(): Promise<{
    preferredProvider: LLMProviderType
    selectedModel?: string
    fallbackOrder: LLMProviderType[]
    providerAvailability: { provider: LLMProviderType; available: boolean; selectedModel?: string }[]
    recentFallbackEvents: FallbackEvent[]
  }> {
    await this.ensureInitialized()

    const preferredProvider = await this.getUserPreferredProvider()
    const selectedModel = this.getUserSelectedModel(preferredProvider)
    const fallbackOrder = this.getFallbackProviders()

    // Check availability of each provider and their selected models
    const availabilityChecks = await Promise.all(
      [...new Set([preferredProvider, ...fallbackOrder])].map(async (type) => {
        const provider = this.getOrCreateProvider(type)
        const available = provider ? await provider.isAvailable() : false
        const providerModel = this.getUserSelectedModel(type)
        return { provider: type, available, selectedModel: providerModel }
      })
    )

    return {
      preferredProvider,
      selectedModel,
      fallbackOrder,
      providerAvailability: availabilityChecks,
      recentFallbackEvents: this.getFallbackEvents(10)
    }
  }

  // --------------------------------------------------------------------------
  // Configuration
  // --------------------------------------------------------------------------

  /**
   * Update routing configuration
   */
  updateConfig(config: Partial<RoutingConfig>): void {
    this.config = { ...this.config, ...config }
  }

  /**
   * Get current routing configuration
   */
  getConfig(): RoutingConfig {
    return { ...this.config }
  }

  // --------------------------------------------------------------------------
  // Cleanup
  // --------------------------------------------------------------------------

  /**
   * Reset the routing service
   */
  reset(): void {
    this.fallbackEvents = []
    // Don't clear the provider cache - they might still be valid
  }

  /**
   * Dispose all resources
   */
  dispose(): void {
    this.fallbackEvents = []
    this.providerCache.clear()
    this.initialized = false
  }
}

// ============================================================================
// Singleton Export
// ============================================================================

/**
 * Singleton routing service instance
 */
export const llmRoutingService = new LLMRoutingService()

/**
 * Initialize the routing service
 * Call this once when the application starts
 */
export async function initializeLLMRoutingService(): Promise<void> {
  await llmRoutingService.initialize()
}

/**
 * Get the routing service instance
 */
export function getRoutingService(): LLMRoutingService {
  return llmRoutingService
}

/**
 * Reset the routing service
 */
export function resetRoutingService(): void {
  llmRoutingService.reset()
}

export default llmRoutingService
