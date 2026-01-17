/**
 * LM Studio Client Service
 *
 * A unified HTTP client for communicating with local LLM inference servers.
 * Supports both LM Studio (default: localhost:1234) and Ollama (default: localhost:11434)
 * as backends, with graceful connection error handling.
 *
 * Features:
 * - OpenAI-compatible API interface for both backends
 * - Health checks and availability detection
 * - Model discovery and listing
 * - Chat completions with configurable parameters
 * - Graceful error handling with retry logic
 * - Request timeout management
 */

// ============================================================================
// Types
// ============================================================================

/**
 * Supported backend types
 */
export type LLMBackendType = 'lm-studio' | 'ollama'

/**
 * Configuration for the LM Studio client
 */
export interface LMStudioClientConfig {
  /** Base URL for the LLM server */
  baseUrl: string
  /** Backend type (lm-studio or ollama) */
  backend: LLMBackendType
  /** Request timeout in milliseconds */
  timeout: number
  /** Number of retry attempts for failed requests */
  retryAttempts: number
  /** Delay between retry attempts in milliseconds */
  retryDelayMs: number
  /** Default max tokens for completions */
  defaultMaxTokens: number
  /** Default temperature for completions */
  defaultTemperature: number
}

/**
 * Health check result
 */
export interface HealthStatus {
  /** Whether the backend is healthy and responding */
  healthy: boolean
  /** Response time in milliseconds */
  responseTimeMs: number
  /** Loaded model information if available */
  loadedModel?: string
  /** Server version if available */
  serverVersion?: string
}

/**
 * Model information
 */
export interface LLMModel {
  /** Model identifier */
  id: string
  /** Object type (usually 'model') */
  object: string
  /** Model owner/organization */
  ownedBy?: string
  /** Creation timestamp */
  created?: number
  /** Additional model metadata */
  metadata?: Record<string, unknown>
}

/**
 * Chat message format
 */
export interface ChatMessage {
  /** Role of the message sender */
  role: 'system' | 'user' | 'assistant'
  /** Message content */
  content: string
}

/**
 * Chat completion request
 */
export interface ChatCompletionRequest {
  /** Messages to send to the model */
  messages: ChatMessage[]
  /** Maximum tokens to generate */
  maxTokens?: number
  /** Temperature for response randomness (0.0 - 2.0) */
  temperature?: number
  /** Model to use (if not using default) */
  model?: string
  /** Whether to stream the response */
  stream?: boolean
  /** Stop sequences */
  stop?: string[]
  /** Top-p sampling parameter */
  topP?: number
  /** Frequency penalty */
  frequencyPenalty?: number
  /** Presence penalty */
  presencePenalty?: number
}

/**
 * Token usage information
 */
export interface TokenUsage {
  /** Tokens used in the prompt */
  promptTokens: number
  /** Tokens generated in completion */
  completionTokens: number
  /** Total tokens used */
  totalTokens: number
}

/**
 * Chat completion response
 */
export interface ChatCompletionResponse {
  /** Unique response identifier */
  id: string
  /** Object type */
  object: string
  /** Creation timestamp */
  created: number
  /** Model used for generation */
  model: string
  /** Generated choices */
  choices: {
    /** Choice index */
    index: number
    /** Generated message */
    message: ChatMessage
    /** Finish reason */
    finishReason: 'stop' | 'length' | 'content_filter' | null
  }[]
  /** Token usage statistics */
  usage?: TokenUsage
}

/**
 * Backend information
 */
export interface BackendInfo {
  /** Backend type */
  type: LLMBackendType
  /** Base URL */
  baseUrl: string
  /** Whether backend is available */
  available: boolean
  /** Available models */
  models: string[]
  /** Server version if available */
  version?: string
}

/**
 * Unified client response wrapper
 */
export interface ClientResponse<T> {
  /** Whether the request was successful */
  success: boolean
  /** Response data if successful */
  data?: T
  /** Error message if failed */
  error?: string
  /** HTTP status code if applicable */
  statusCode?: number
  /** Backend that handled the request */
  backend?: LLMBackendType
  /** Response time in milliseconds */
  responseTimeMs?: number
}

/**
 * Connection error types for better error handling
 */
export type ConnectionErrorType =
  | 'timeout'
  | 'connection_refused'
  | 'network_error'
  | 'server_error'
  | 'parse_error'
  | 'unknown'

/**
 * Detailed connection error
 */
export interface ConnectionError {
  /** Error type */
  type: ConnectionErrorType
  /** Error message */
  message: string
  /** Original error if available */
  originalError?: Error
  /** Whether the error is retryable */
  retryable: boolean
}

// ============================================================================
// Default Configuration
// ============================================================================

const DEFAULT_LM_STUDIO_CONFIG: LMStudioClientConfig = {
  baseUrl: 'http://localhost:1234',
  backend: 'lm-studio',
  timeout: 30000,
  retryAttempts: 2,
  retryDelayMs: 1000,
  defaultMaxTokens: 2048,
  defaultTemperature: 0.7
}

const OLLAMA_DEFAULT_CONFIG: Partial<LMStudioClientConfig> = {
  baseUrl: 'http://localhost:11434',
  backend: 'ollama'
}

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Delay execution for a specified number of milliseconds
 */
function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

/**
 * Classify connection errors for better handling
 */
function classifyConnectionError(error: unknown): ConnectionError {
  if (error instanceof Error) {
    const message = error.message.toLowerCase()

    if (message.includes('timeout') || message.includes('timed out')) {
      return {
        type: 'timeout',
        message: 'Request timed out. The server may be overloaded or unresponsive.',
        originalError: error,
        retryable: true
      }
    }

    if (
      message.includes('econnrefused') ||
      message.includes('connection refused') ||
      message.includes('connect econnrefused')
    ) {
      return {
        type: 'connection_refused',
        message: 'Connection refused. Ensure the LLM server is running.',
        originalError: error,
        retryable: false
      }
    }

    if (
      message.includes('network') ||
      message.includes('enotfound') ||
      message.includes('dns')
    ) {
      return {
        type: 'network_error',
        message: 'Network error. Check your connection and server address.',
        originalError: error,
        retryable: true
      }
    }

    if (message.includes('json') || message.includes('parse')) {
      return {
        type: 'parse_error',
        message: 'Failed to parse server response. The server may be returning invalid data.',
        originalError: error,
        retryable: false
      }
    }

    return {
      type: 'unknown',
      message: error.message,
      originalError: error,
      retryable: true
    }
  }

  return {
    type: 'unknown',
    message: 'An unknown error occurred',
    retryable: false
  }
}

// ============================================================================
// LM Studio Client Class
// ============================================================================

/**
 * HTTP client for LM Studio and Ollama backends
 */
class LMStudioClient {
  private config: LMStudioClientConfig
  private lastHealthCheck: { time: number; result: HealthStatus } | null = null
  private healthCheckCacheMs: number = 5000 // Cache health check for 5 seconds

  constructor(config?: Partial<LMStudioClientConfig>) {
    this.config = { ...DEFAULT_LM_STUDIO_CONFIG, ...config }
  }

  // --------------------------------------------------------------------------
  // Configuration Methods
  // --------------------------------------------------------------------------

  /**
   * Update client configuration
   */
  updateConfig(config: Partial<LMStudioClientConfig>): void {
    this.config = { ...this.config, ...config }
    this.lastHealthCheck = null // Invalidate health cache on config change
  }

  /**
   * Get current configuration
   */
  getConfig(): LMStudioClientConfig {
    return { ...this.config }
  }

  /**
   * Switch to Ollama backend with default configuration
   */
  useOllama(baseUrl?: string): void {
    this.updateConfig({
      ...OLLAMA_DEFAULT_CONFIG,
      baseUrl: baseUrl || OLLAMA_DEFAULT_CONFIG.baseUrl
    })
  }

  /**
   * Switch to LM Studio backend with default configuration
   */
  useLMStudio(baseUrl?: string): void {
    this.updateConfig({
      backend: 'lm-studio',
      baseUrl: baseUrl || DEFAULT_LM_STUDIO_CONFIG.baseUrl
    })
  }

  // --------------------------------------------------------------------------
  // Core HTTP Methods
  // --------------------------------------------------------------------------

  /**
   * Make an HTTP request with error handling and retries
   */
  private async makeRequest<T>(
    endpoint: string,
    options: {
      method?: 'GET' | 'POST'
      body?: unknown
      timeout?: number
      retries?: number
    } = {}
  ): Promise<ClientResponse<T>> {
    const {
      method = 'GET',
      body,
      timeout = this.config.timeout,
      retries = this.config.retryAttempts
    } = options

    const startTime = Date.now()
    let lastError: ConnectionError | null = null

    for (let attempt = 0; attempt <= retries; attempt++) {
      try {
        const response = await fetch(`${this.config.baseUrl}${endpoint}`, {
          method,
          headers: { 'Content-Type': 'application/json' },
          body: body ? JSON.stringify(body) : undefined,
          signal: AbortSignal.timeout(timeout)
        })

        const responseTimeMs = Date.now() - startTime

        if (!response.ok) {
          // Server returned an error status
          let errorMessage = `Server returned status ${response.status}`
          try {
            const errorData = await response.json()
            if (errorData.error?.message) {
              errorMessage = errorData.error.message
            } else if (typeof errorData.error === 'string') {
              errorMessage = errorData.error
            }
          } catch {
            // Ignore JSON parse errors for error response
          }

          return {
            success: false,
            error: errorMessage,
            statusCode: response.status,
            backend: this.config.backend,
            responseTimeMs
          }
        }

        const data = await response.json()

        return {
          success: true,
          data: data as T,
          statusCode: response.status,
          backend: this.config.backend,
          responseTimeMs
        }
      } catch (error) {
        lastError = classifyConnectionError(error)

        // Only retry if the error is retryable and we have attempts left
        if (lastError.retryable && attempt < retries) {
          await delay(this.config.retryDelayMs * (attempt + 1)) // Exponential backoff
          continue
        }

        break
      }
    }

    return {
      success: false,
      error: lastError?.message || 'Request failed after retries',
      backend: this.config.backend,
      responseTimeMs: Date.now() - startTime
    }
  }

  // --------------------------------------------------------------------------
  // Health Check Methods
  // --------------------------------------------------------------------------

  /**
   * Check if the backend is healthy and responding
   */
  async checkHealth(forceRefresh: boolean = false): Promise<ClientResponse<HealthStatus>> {
    // Return cached result if available and not stale
    if (
      !forceRefresh &&
      this.lastHealthCheck &&
      Date.now() - this.lastHealthCheck.time < this.healthCheckCacheMs
    ) {
      return {
        success: true,
        data: this.lastHealthCheck.result,
        backend: this.config.backend
      }
    }

    const startTime = Date.now()

    // Different health check endpoints for different backends
    const endpoint = this.config.backend === 'ollama' ? '/api/version' : '/v1/models'

    const response = await this.makeRequest<unknown>(endpoint, {
      timeout: 5000, // Quick timeout for health checks
      retries: 0 // No retries for health checks
    })

    if (!response.success) {
      return {
        success: false,
        error: response.error,
        backend: this.config.backend,
        data: {
          healthy: false,
          responseTimeMs: Date.now() - startTime
        }
      }
    }

    const healthStatus: HealthStatus = {
      healthy: true,
      responseTimeMs: response.responseTimeMs || Date.now() - startTime
    }

    // Extract additional info based on backend
    if (this.config.backend === 'ollama') {
      const versionData = response.data as { version?: string }
      healthStatus.serverVersion = versionData?.version
    } else {
      // LM Studio returns models list
      const modelsData = response.data as { data?: Array<{ id: string }> }
      if (modelsData?.data?.[0]?.id) {
        healthStatus.loadedModel = modelsData.data[0].id
      }
    }

    // Cache the result
    this.lastHealthCheck = {
      time: Date.now(),
      result: healthStatus
    }

    return {
      success: true,
      data: healthStatus,
      backend: this.config.backend,
      responseTimeMs: response.responseTimeMs
    }
  }

  /**
   * Simple availability check (returns boolean)
   */
  async isAvailable(): Promise<boolean> {
    const health = await this.checkHealth()
    return health.success && health.data?.healthy === true
  }

  // --------------------------------------------------------------------------
  // Model Methods
  // --------------------------------------------------------------------------

  /**
   * List available models from the backend
   */
  async listModels(): Promise<ClientResponse<LLMModel[]>> {
    // Different endpoints for different backends
    const endpoint = this.config.backend === 'ollama' ? '/api/tags' : '/v1/models'

    const response = await this.makeRequest<unknown>(endpoint)

    if (!response.success) {
      return {
        success: false,
        error: response.error,
        backend: this.config.backend
      }
    }

    let models: LLMModel[] = []

    if (this.config.backend === 'ollama') {
      // Ollama returns { models: [...] }
      const ollamaData = response.data as { models?: Array<{ name: string; modified_at?: string }> }
      models = (ollamaData?.models || []).map(m => ({
        id: m.name,
        object: 'model',
        ownedBy: 'ollama',
        metadata: { modified_at: m.modified_at }
      }))
    } else {
      // LM Studio returns OpenAI-compatible { data: [...] }
      const lmStudioData = response.data as { data?: Array<{ id: string; object?: string; owned_by?: string; created?: number }> }
      models = (lmStudioData?.data || []).map(m => ({
        id: m.id,
        object: m.object || 'model',
        ownedBy: m.owned_by,
        created: m.created
      }))
    }

    return {
      success: true,
      data: models,
      backend: this.config.backend,
      responseTimeMs: response.responseTimeMs
    }
  }

  // --------------------------------------------------------------------------
  // Chat Completion Methods
  // --------------------------------------------------------------------------

  /**
   * Send a chat completion request
   */
  async chatCompletion(request: ChatCompletionRequest): Promise<ClientResponse<ChatCompletionResponse>> {
    // Determine the endpoint based on backend
    const endpoint = this.config.backend === 'ollama' ? '/api/chat' : '/v1/chat/completions'

    // Build request body based on backend
    let requestBody: Record<string, unknown>

    if (this.config.backend === 'ollama') {
      // Ollama format
      requestBody = {
        model: request.model || 'default',
        messages: request.messages,
        stream: request.stream ?? false,
        options: {
          temperature: request.temperature ?? this.config.defaultTemperature,
          num_predict: request.maxTokens ?? this.config.defaultMaxTokens,
          top_p: request.topP,
          frequency_penalty: request.frequencyPenalty,
          presence_penalty: request.presencePenalty,
          stop: request.stop
        }
      }
    } else {
      // LM Studio (OpenAI-compatible) format
      requestBody = {
        messages: request.messages,
        max_tokens: request.maxTokens ?? this.config.defaultMaxTokens,
        temperature: request.temperature ?? this.config.defaultTemperature,
        stream: request.stream ?? false,
        model: request.model,
        stop: request.stop,
        top_p: request.topP,
        frequency_penalty: request.frequencyPenalty,
        presence_penalty: request.presencePenalty
      }
    }

    const response = await this.makeRequest<unknown>(endpoint, {
      method: 'POST',
      body: requestBody,
      timeout: this.config.timeout
    })

    if (!response.success) {
      return {
        success: false,
        error: response.error,
        statusCode: response.statusCode,
        backend: this.config.backend,
        responseTimeMs: response.responseTimeMs
      }
    }

    // Normalize response to OpenAI format
    let normalizedResponse: ChatCompletionResponse

    if (this.config.backend === 'ollama') {
      // Ollama response format
      const ollamaResponse = response.data as {
        model?: string
        message?: { role: string; content: string }
        done?: boolean
        created_at?: string
        eval_count?: number
        prompt_eval_count?: number
      }

      normalizedResponse = {
        id: `ollama-${Date.now()}`,
        object: 'chat.completion',
        created: Date.now(),
        model: ollamaResponse.model || 'unknown',
        choices: [
          {
            index: 0,
            message: {
              role: (ollamaResponse.message?.role as 'assistant') || 'assistant',
              content: ollamaResponse.message?.content || ''
            },
            finishReason: ollamaResponse.done ? 'stop' : null
          }
        ],
        usage: ollamaResponse.eval_count
          ? {
              promptTokens: ollamaResponse.prompt_eval_count || 0,
              completionTokens: ollamaResponse.eval_count,
              totalTokens:
                (ollamaResponse.prompt_eval_count || 0) + ollamaResponse.eval_count
            }
          : undefined
      }
    } else {
      // LM Studio (OpenAI-compatible) response
      const openAIResponse = response.data as {
        id?: string
        object?: string
        created?: number
        model?: string
        choices?: Array<{
          index?: number
          message?: { role: string; content: string }
          finish_reason?: string
        }>
        usage?: {
          prompt_tokens?: number
          completion_tokens?: number
          total_tokens?: number
        }
      }

      normalizedResponse = {
        id: openAIResponse.id || `lm-studio-${Date.now()}`,
        object: openAIResponse.object || 'chat.completion',
        created: openAIResponse.created || Date.now(),
        model: openAIResponse.model || 'unknown',
        choices: (openAIResponse.choices || []).map((c, idx) => ({
          index: c.index ?? idx,
          message: {
            role: (c.message?.role as 'assistant') || 'assistant',
            content: c.message?.content || ''
          },
          finishReason: (c.finish_reason as 'stop' | 'length' | 'content_filter') || null
        })),
        usage: openAIResponse.usage
          ? {
              promptTokens: openAIResponse.usage.prompt_tokens || 0,
              completionTokens: openAIResponse.usage.completion_tokens || 0,
              totalTokens: openAIResponse.usage.total_tokens || 0
            }
          : undefined
      }
    }

    return {
      success: true,
      data: normalizedResponse,
      backend: this.config.backend,
      responseTimeMs: response.responseTimeMs
    }
  }

  /**
   * Simple chat helper - sends a single user message and returns the response content
   */
  async chat(
    userMessage: string,
    systemPrompt?: string,
    options?: Partial<ChatCompletionRequest>
  ): Promise<ClientResponse<string>> {
    const messages: ChatMessage[] = []

    if (systemPrompt) {
      messages.push({ role: 'system', content: systemPrompt })
    }
    messages.push({ role: 'user', content: userMessage })

    const response = await this.chatCompletion({
      messages,
      ...options
    })

    if (!response.success) {
      return {
        success: false,
        error: response.error,
        backend: this.config.backend,
        responseTimeMs: response.responseTimeMs
      }
    }

    const content = response.data?.choices?.[0]?.message?.content || ''

    return {
      success: true,
      data: content,
      backend: this.config.backend,
      responseTimeMs: response.responseTimeMs
    }
  }

  // --------------------------------------------------------------------------
  // Backend Information
  // --------------------------------------------------------------------------

  /**
   * Get comprehensive backend information
   */
  async getBackendInfo(): Promise<ClientResponse<BackendInfo>> {
    const [healthResult, modelsResult] = await Promise.all([
      this.checkHealth(true),
      this.listModels()
    ])

    const backendInfo: BackendInfo = {
      type: this.config.backend,
      baseUrl: this.config.baseUrl,
      available: healthResult.success && healthResult.data?.healthy === true,
      models: modelsResult.success ? (modelsResult.data || []).map(m => m.id) : [],
      version: healthResult.data?.serverVersion
    }

    return {
      success: true,
      data: backendInfo,
      backend: this.config.backend
    }
  }

  // --------------------------------------------------------------------------
  // Reset Methods
  // --------------------------------------------------------------------------

  /**
   * Reset client state (clears caches)
   */
  reset(): void {
    this.lastHealthCheck = null
  }
}

// ============================================================================
// Singleton Export
// ============================================================================

/**
 * Default LM Studio client instance
 */
export const lmStudioClient = new LMStudioClient()

/**
 * Create a new client instance with custom configuration
 */
export function createLMStudioClient(config?: Partial<LMStudioClientConfig>): LMStudioClient {
  return new LMStudioClient(config)
}

/**
 * Reset client state
 */
export function resetLMStudioClientState(): void {
  lmStudioClient.reset()
}

export default lmStudioClient
