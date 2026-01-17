/**
 * Ollama Adapter
 *
 * Implements the ILLMProvider interface for Ollama backend.
 * This adapter wraps the existing LMStudioClient in Ollama mode,
 * providing a unified interface for the Ollama LLM server.
 *
 * Ollama uses a different API format than OpenAI-compatible servers,
 * but the underlying LMStudioClient handles the translation.
 */

import {
  createLMStudioClient,
  type LMStudioClientConfig
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

const DEFAULT_OLLAMA_ADAPTER_CONFIG: LocalProviderConfig = {
  type: 'ollama',
  name: 'Ollama',
  baseUrl: 'http://localhost:11434',
  timeout: 60000, // Ollama can be slower for initial model loads
  retryAttempts: 2,
  retryDelayMs: 1000,
  defaultMaxTokens: 2048,
  defaultTemperature: 0.7,
  autoDetect: true
}

// ============================================================================
// Ollama Adapter Implementation
// ============================================================================

/**
 * Adapter for Ollama LLM server
 *
 * Uses the existing LMStudioClient in Ollama mode to handle
 * the API differences between LM Studio and Ollama.
 */
export class OllamaAdapter implements ILLMProvider {
  readonly type = 'ollama' as const
  readonly name = 'Ollama'

  private config: LocalProviderConfig
  private client: ReturnType<typeof createLMStudioClient>

  /**
   * Create a new Ollama adapter
   * @param config Optional configuration override
   */
  constructor(config?: Partial<LocalProviderConfig>) {
    this.config = { ...DEFAULT_OLLAMA_ADAPTER_CONFIG, ...config }

    // Create a dedicated client instance for Ollama
    this.client = createLMStudioClient(this.mapToClientConfig(this.config))
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
   * Map provider config to LMStudioClientConfig for Ollama backend
   */
  private mapToClientConfig(config: LocalProviderConfig): Partial<LMStudioClientConfig> {
    return {
      baseUrl: config.baseUrl,
      backend: 'ollama',
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
      provider: 'ollama',
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
      provider: 'ollama',
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

    const result = await this.client.chatCompletion({
      messages: params.messages,
      maxTokens: params.maxTokens,
      temperature: params.temperature,
      model: params.model,
      stream: params.stream,
      stop: params.stop,
      topP: params.topP,
      frequencyPenalty: params.frequencyPenalty,
      presencePenalty: params.presencePenalty
    })

    return {
      success: result.success,
      data: result.data,
      error: result.error,
      provider: 'ollama',
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
      provider: 'ollama',
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
  }
}

// ============================================================================
// Factory Function
// ============================================================================

/**
 * Create a new Ollama adapter with the given configuration
 */
export function createOllamaAdapter(config?: Partial<LocalProviderConfig>): OllamaAdapter {
  return new OllamaAdapter(config)
}

// ============================================================================
// Default Export
// ============================================================================

export default OllamaAdapter
