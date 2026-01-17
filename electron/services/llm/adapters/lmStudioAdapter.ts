/**
 * LM Studio Adapter
 *
 * Implements the ILLMProvider interface by wrapping the existing LMStudioClient.
 * This adapter delegates all operations to the existing implementation, ensuring
 * full backward compatibility while providing a unified interface.
 *
 * This is the DEFAULT adapter and should be used when no other provider is specified.
 */

import {
  lmStudioClient,
  createLMStudioClient,
  type LMStudioClientConfig,
  type ChatCompletionRequest,
  type HealthStatus,
  type LLMModel
} from '../../lm-studio-client'

import type {
  ILLMProvider,
  LLMProviderConfig,
  LocalProviderConfig,
  ChatCompletionParams,
  ProviderHealthResult,
  ProviderModelsResult,
  ProviderChatResult,
  ProviderSimpleChatResult
} from '../llmProviderInterface'

// ============================================================================
// Default Configuration
// ============================================================================

const DEFAULT_LM_STUDIO_ADAPTER_CONFIG: LocalProviderConfig = {
  type: 'lm-studio',
  name: 'LM Studio',
  baseUrl: 'http://localhost:1234',
  timeout: 30000,
  retryAttempts: 2,
  retryDelayMs: 1000,
  defaultMaxTokens: 2048,
  defaultTemperature: 0.7,
  autoDetect: true
}

// ============================================================================
// LM Studio Adapter Implementation
// ============================================================================

/**
 * Adapter that wraps the existing LMStudioClient
 *
 * Delegates all operations to the existing implementation while
 * conforming to the ILLMProvider interface.
 */
export class LMStudioAdapter implements ILLMProvider {
  readonly type = 'lm-studio' as const
  readonly name = 'LM Studio'

  private config: LocalProviderConfig
  private client: typeof lmStudioClient

  /**
   * Create a new LM Studio adapter
   * @param config Optional configuration override
   * @param useSharedClient Whether to use the shared singleton client (default: true)
   */
  constructor(
    config?: Partial<LocalProviderConfig>,
    useSharedClient: boolean = true
  ) {
    this.config = { ...DEFAULT_LM_STUDIO_ADAPTER_CONFIG, ...config }

    // Use shared client by default for backward compatibility
    // or create a new instance if isolation is needed
    if (useSharedClient) {
      this.client = lmStudioClient
      // Sync configuration to shared client
      this.syncConfigToClient()
    } else {
      this.client = createLMStudioClient(this.mapToClientConfig(this.config))
    }
  }

  // --------------------------------------------------------------------------
  // Configuration Methods
  // --------------------------------------------------------------------------

  /**
   * Get the current configuration
   */
  getConfig(): LLMProviderConfig {
    return { ...this.config }
  }

  /**
   * Update provider configuration
   */
  updateConfig(config: Partial<LLMProviderConfig>): void {
    this.config = { ...this.config, ...config }
    this.syncConfigToClient()
  }

  /**
   * Sync adapter config to underlying client
   */
  private syncConfigToClient(): void {
    this.client.updateConfig(this.mapToClientConfig(this.config))
  }

  /**
   * Map provider config to LMStudioClientConfig
   */
  private mapToClientConfig(config: LocalProviderConfig): Partial<LMStudioClientConfig> {
    return {
      baseUrl: config.baseUrl,
      backend: 'lm-studio',
      timeout: config.timeout,
      retryAttempts: config.retryAttempts,
      retryDelayMs: config.retryDelayMs,
      defaultMaxTokens: config.defaultMaxTokens,
      defaultTemperature: config.defaultTemperature
    }
  }

  // --------------------------------------------------------------------------
  // Health Check Methods
  // --------------------------------------------------------------------------

  /**
   * Check if the provider is healthy and responding
   */
  async checkHealth(forceRefresh: boolean = false): Promise<ProviderHealthResult> {
    const startTime = Date.now()
    const result = await this.client.checkHealth(forceRefresh)

    return {
      success: result.success,
      data: result.data,
      error: result.error,
      provider: 'lm-studio',
      responseTimeMs: result.responseTimeMs ?? (Date.now() - startTime)
    }
  }

  /**
   * Simple availability check
   */
  async isAvailable(): Promise<boolean> {
    return this.client.isAvailable()
  }

  // --------------------------------------------------------------------------
  // Model Methods
  // --------------------------------------------------------------------------

  /**
   * List available models from the provider
   */
  async listModels(): Promise<ProviderModelsResult> {
    const startTime = Date.now()
    const result = await this.client.listModels()

    return {
      success: result.success,
      data: result.data,
      error: result.error,
      provider: 'lm-studio',
      responseTimeMs: result.responseTimeMs ?? (Date.now() - startTime)
    }
  }

  // --------------------------------------------------------------------------
  // Chat Completion Methods
  // --------------------------------------------------------------------------

  /**
   * Send a chat completion request
   */
  async chatCompletion(params: ChatCompletionParams): Promise<ProviderChatResult> {
    const startTime = Date.now()

    // Map ChatCompletionParams to ChatCompletionRequest
    const request: ChatCompletionRequest = {
      messages: params.messages,
      maxTokens: params.maxTokens,
      temperature: params.temperature,
      model: params.model,
      stream: params.stream,
      stop: params.stop,
      topP: params.topP,
      frequencyPenalty: params.frequencyPenalty,
      presencePenalty: params.presencePenalty
    }

    const result = await this.client.chatCompletion(request)

    return {
      success: result.success,
      data: result.data,
      error: result.error,
      provider: 'lm-studio',
      responseTimeMs: result.responseTimeMs ?? (Date.now() - startTime)
    }
  }

  /**
   * Simple chat helper - sends a single user message and returns the response content
   */
  async chat(
    userMessage: string,
    systemPrompt?: string,
    options?: Partial<ChatCompletionParams>
  ): Promise<ProviderSimpleChatResult> {
    const startTime = Date.now()

    // Map options to ChatCompletionRequest partial
    const chatOptions = options ? {
      maxTokens: options.maxTokens,
      temperature: options.temperature,
      model: options.model,
      stream: options.stream,
      stop: options.stop,
      topP: options.topP,
      frequencyPenalty: options.frequencyPenalty,
      presencePenalty: options.presencePenalty
    } : undefined

    const result = await this.client.chat(userMessage, systemPrompt, chatOptions)

    return {
      success: result.success,
      data: result.data,
      error: result.error,
      provider: 'lm-studio',
      responseTimeMs: result.responseTimeMs ?? (Date.now() - startTime)
    }
  }

  // --------------------------------------------------------------------------
  // Lifecycle Methods
  // --------------------------------------------------------------------------

  /**
   * Reset provider state (clear caches, etc.)
   */
  reset(): void {
    this.client.reset()
  }

  /**
   * Dispose provider resources
   */
  dispose(): void {
    this.reset()
    // Note: We don't dispose the shared client as it may be used elsewhere
  }
}

// ============================================================================
// Factory Function
// ============================================================================

/**
 * Create a new LM Studio adapter with the given configuration
 */
export function createLMStudioAdapter(
  config?: Partial<LocalProviderConfig>,
  useSharedClient: boolean = true
): LMStudioAdapter {
  return new LMStudioAdapter(config, useSharedClient)
}

// ============================================================================
// Default Export
// ============================================================================

/**
 * Default LM Studio adapter instance that uses the shared client
 * This ensures backward compatibility with existing code
 */
export const defaultLMStudioAdapter = new LMStudioAdapter()

export default defaultLMStudioAdapter
