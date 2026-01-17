/**
 * LLM Provider Test Utilities
 *
 * Mock data generators, helper functions, and test fixtures for
 * testing the LLM provider abstraction layer.
 */

import type {
  ILLMProvider,
  LLMProviderType,
  LLMProviderConfig,
  ChatCompletionParams,
  ProviderHealthResult,
  ProviderModelsResult,
  ProviderChatResult,
  ProviderSimpleChatResult,
  ProviderAvailability
} from '../../electron/services/llm/llmProviderInterface'

import type {
  HealthStatus,
  LLMModel,
  ChatCompletionResponse
} from '../../electron/services/lm-studio-client'

// ============================================================================
// Mock Provider Implementation
// ============================================================================

/**
 * Configuration options for mock provider
 */
export interface MockProviderOptions {
  type: LLMProviderType
  name: string
  available?: boolean
  healthy?: boolean
  shouldFail?: boolean
  failureError?: string
  responseDelay?: number
  models?: LLMModel[]
  chatResponse?: string
  healthStatus?: Partial<HealthStatus>
}

/**
 * Mock LLM Provider for testing
 * Allows fine-grained control over provider behavior
 */
export class MockLLMProvider implements ILLMProvider {
  readonly type: LLMProviderType
  readonly name: string

  private config: LLMProviderConfig
  private options: MockProviderOptions

  public callHistory: {
    method: string
    args: unknown[]
    timestamp: number
  }[] = []

  constructor(options: MockProviderOptions) {
    this.options = {
      available: true,
      healthy: true,
      shouldFail: false,
      responseDelay: 0,
      chatResponse: 'Mock response from ' + options.name,
      ...options
    }
    this.type = options.type
    this.name = options.name
    this.config = {
      type: options.type,
      name: options.name,
      baseUrl: 'http://mock-provider',
      timeout: 30000,
      retryAttempts: 1,
      retryDelayMs: 100,
      defaultMaxTokens: 2048,
      defaultTemperature: 0.7
    }
  }

  private recordCall(method: string, args: unknown[]): void {
    this.callHistory.push({
      method,
      args,
      timestamp: Date.now()
    })
  }

  private async delay(): Promise<void> {
    if (this.options.responseDelay && this.options.responseDelay > 0) {
      await new Promise(resolve => setTimeout(resolve, this.options.responseDelay))
    }
  }

  private checkFailure(): void {
    if (this.options.shouldFail) {
      throw new Error(this.options.failureError || 'Mock provider failure')
    }
  }

  // Configuration
  getConfig(): LLMProviderConfig {
    this.recordCall('getConfig', [])
    return { ...this.config }
  }

  updateConfig(config: Partial<LLMProviderConfig>): void {
    this.recordCall('updateConfig', [config])
    this.config = { ...this.config, ...config }
  }

  // Health
  async checkHealth(forceRefresh?: boolean): Promise<ProviderHealthResult> {
    this.recordCall('checkHealth', [forceRefresh])
    await this.delay()

    if (!this.options.healthy) {
      return {
        success: false,
        error: 'Mock provider is unhealthy',
        provider: this.type,
        responseTimeMs: 10
      }
    }

    const healthData: HealthStatus = {
      healthy: true,
      responseTimeMs: 10,
      serverVersion: '1.0.0-mock',
      loadedModel: 'mock-model',
      ...this.options.healthStatus
    }

    return {
      success: true,
      data: healthData,
      provider: this.type,
      responseTimeMs: 10
    }
  }

  async isAvailable(): Promise<boolean> {
    this.recordCall('isAvailable', [])
    await this.delay()
    return this.options.available ?? true
  }

  // Models
  async listModels(): Promise<ProviderModelsResult> {
    this.recordCall('listModels', [])
    await this.delay()
    this.checkFailure()

    if (!this.options.available) {
      return {
        success: false,
        error: 'Provider not available',
        provider: this.type,
        responseTimeMs: 10
      }
    }

    const models = this.options.models || [
      { id: 'mock-model-1', object: 'model', ownedBy: 'mock' },
      { id: 'mock-model-2', object: 'model', ownedBy: 'mock' }
    ]

    return {
      success: true,
      data: models,
      provider: this.type,
      responseTimeMs: 10
    }
  }

  // Chat
  async chatCompletion(params: ChatCompletionParams): Promise<ProviderChatResult> {
    this.recordCall('chatCompletion', [params])
    await this.delay()
    this.checkFailure()

    if (!this.options.available) {
      return {
        success: false,
        error: 'Provider not available',
        provider: this.type,
        responseTimeMs: 10
      }
    }

    const response: ChatCompletionResponse = {
      id: `mock-${Date.now()}`,
      object: 'chat.completion',
      created: Math.floor(Date.now() / 1000),
      model: params.model || 'mock-model',
      choices: [{
        index: 0,
        message: {
          role: 'assistant',
          content: this.options.chatResponse || 'Mock response'
        },
        finishReason: 'stop'
      }]
    }

    return {
      success: true,
      data: response,
      provider: this.type,
      responseTimeMs: 10
    }
  }

  async chat(
    userMessage: string,
    systemPrompt?: string,
    options?: Partial<ChatCompletionParams>
  ): Promise<ProviderSimpleChatResult> {
    this.recordCall('chat', [userMessage, systemPrompt, options])
    await this.delay()
    this.checkFailure()

    if (!this.options.available) {
      return {
        success: false,
        error: 'Provider not available',
        provider: this.type,
        responseTimeMs: 10
      }
    }

    return {
      success: true,
      data: this.options.chatResponse || 'Mock response',
      provider: this.type,
      responseTimeMs: 10
    }
  }

  // Lifecycle
  reset(): void {
    this.recordCall('reset', [])
    this.callHistory = []
  }

  dispose(): void {
    this.recordCall('dispose', [])
  }

  // Test utilities
  setAvailable(available: boolean): void {
    this.options.available = available
  }

  setHealthy(healthy: boolean): void {
    this.options.healthy = healthy
  }

  setShouldFail(shouldFail: boolean, error?: string): void {
    this.options.shouldFail = shouldFail
    this.options.failureError = error
  }

  setChatResponse(response: string): void {
    this.options.chatResponse = response
  }

  getCallCount(method?: string): number {
    if (method) {
      return this.callHistory.filter(c => c.method === method).length
    }
    return this.callHistory.length
  }

  getLastCall(method?: string): { method: string; args: unknown[] } | undefined {
    const calls = method
      ? this.callHistory.filter(c => c.method === method)
      : this.callHistory
    return calls[calls.length - 1]
  }

  clearCallHistory(): void {
    this.callHistory = []
  }
}

// ============================================================================
// Factory Functions for Mock Providers
// ============================================================================

/**
 * Create a mock LM Studio provider
 */
export function createMockLMStudioProvider(options?: Partial<MockProviderOptions>): MockLLMProvider {
  return new MockLLMProvider({
    type: 'lm-studio',
    name: 'Mock LM Studio',
    available: true,
    healthy: true,
    chatResponse: 'Response from LM Studio',
    healthStatus: {
      loadedModel: 'llama-3.2-3b-instruct',
      serverVersion: 'LM Studio 0.3.5'
    },
    ...options
  })
}

/**
 * Create a mock Ollama provider
 */
export function createMockOllamaProvider(options?: Partial<MockProviderOptions>): MockLLMProvider {
  return new MockLLMProvider({
    type: 'ollama',
    name: 'Mock Ollama',
    available: true,
    healthy: true,
    chatResponse: 'Response from Ollama',
    healthStatus: {
      loadedModel: 'llama2',
      serverVersion: 'Ollama 0.1.0'
    },
    ...options
  })
}

/**
 * Create a mock Claude CLI provider
 */
export function createMockClaudeProvider(options?: Partial<MockProviderOptions>): MockLLMProvider {
  return new MockLLMProvider({
    type: 'claude',
    name: 'Mock Claude CLI',
    available: true,
    healthy: true,
    chatResponse: 'Response from Claude CLI',
    models: [
      { id: 'claude-sonnet-4-20250514', object: 'model', ownedBy: 'anthropic' },
      { id: 'claude-3-5-sonnet-20241022', object: 'model', ownedBy: 'anthropic' },
      { id: 'claude-3-opus-20240229', object: 'model', ownedBy: 'anthropic' },
      { id: 'claude-3-haiku-20240307', object: 'model', ownedBy: 'anthropic' }
    ],
    healthStatus: {
      serverVersion: 'Claude CLI 1.0.0'
    },
    ...options
  })
}

/**
 * Create a mock Cursor CLI provider
 */
export function createMockCursorProvider(options?: Partial<MockProviderOptions>): MockLLMProvider {
  return new MockLLMProvider({
    type: 'cursor',
    name: 'Mock Cursor CLI',
    available: true,
    healthy: true,
    chatResponse: 'Response from Cursor CLI',
    models: [
      { id: 'cursor-default', object: 'model', ownedBy: 'cursor' }
    ],
    healthStatus: {
      serverVersion: 'Cursor 0.40.0'
    },
    ...options
  })
}

/**
 * Create an unavailable mock provider
 */
export function createUnavailableMockProvider(type: LLMProviderType, name: string): MockLLMProvider {
  return new MockLLMProvider({
    type,
    name,
    available: false,
    healthy: false
  })
}

/**
 * Create a failing mock provider
 */
export function createFailingMockProvider(
  type: LLMProviderType,
  name: string,
  error?: string
): MockLLMProvider {
  return new MockLLMProvider({
    type,
    name,
    available: true,
    healthy: true,
    shouldFail: true,
    failureError: error || `${name} failed`
  })
}

// ============================================================================
// Mock CLI Execution Helpers
// ============================================================================

/**
 * Mock CLI execution result
 */
export interface MockCLIExecutionResult {
  code: number
  stdout: string
  stderr: string
  success: boolean
  error?: string
}

/**
 * Create a successful CLI execution result
 */
export function createSuccessfulCLIResult(stdout: string): MockCLIExecutionResult {
  return {
    code: 0,
    stdout,
    stderr: '',
    success: true
  }
}

/**
 * Create a failed CLI execution result
 */
export function createFailedCLIResult(error: string, code: number = 1): MockCLIExecutionResult {
  return {
    code,
    stdout: '',
    stderr: error,
    success: false,
    error
  }
}

/**
 * Create a timeout CLI execution result
 */
export function createTimeoutCLIResult(): MockCLIExecutionResult {
  return {
    code: 124,
    stdout: '',
    stderr: 'Command timed out',
    success: false,
    error: 'Command timed out'
  }
}

// ============================================================================
// Test Assertions
// ============================================================================

/**
 * Assert that a provider result is successful
 */
export function assertSuccess<T>(result: { success: boolean; error?: string; data?: T }): asserts result is { success: true; data: T } {
  if (!result.success) {
    throw new Error(`Expected success but got failure: ${result.error}`)
  }
}

/**
 * Assert that a provider result failed
 */
export function assertFailure(result: { success: boolean; error?: string }): void {
  if (result.success) {
    throw new Error('Expected failure but got success')
  }
}

/**
 * Assert provider type matches
 */
export function assertProviderType(
  result: { provider: LLMProviderType },
  expectedType: LLMProviderType
): void {
  if (result.provider !== expectedType) {
    throw new Error(`Expected provider ${expectedType} but got ${result.provider}`)
  }
}

// ============================================================================
// Provider Detection Mock Data
// ============================================================================

/**
 * Create mock provider availability data
 */
export function createMockProviderAvailability(
  type: LLMProviderType,
  available: boolean,
  options?: Partial<ProviderAvailability>
): ProviderAvailability {
  return {
    provider: type,
    available,
    lastChecked: Date.now(),
    responseTimeMs: available ? 50 : undefined,
    error: available ? undefined : `${type} not available`,
    loadedModel: available ? 'mock-model' : undefined,
    ...options
  }
}

/**
 * Create a full provider detection result
 */
export function createMockDetectionResult(providers: ProviderAvailability[]): {
  providers: ProviderAvailability[]
  recommendedPrimary?: LLMProviderType
  timestamp: number
  detectionTimeMs: number
} {
  const availableProviders = providers.filter(p => p.available)
  const fastest = availableProviders.sort((a, b) =>
    (a.responseTimeMs || Infinity) - (b.responseTimeMs || Infinity)
  )[0]

  return {
    providers,
    recommendedPrimary: fastest?.provider,
    timestamp: Date.now(),
    detectionTimeMs: 100
  }
}

// ============================================================================
// Routing Test Helpers
// ============================================================================

/**
 * Fallback scenario definition for testing
 */
export interface FallbackScenario {
  name: string
  preferredProvider: LLMProviderType
  preferredAvailable: boolean
  preferredHealthy: boolean
  fallbackProviders: { type: LLMProviderType; available: boolean; healthy: boolean }[]
  expectedUsedProvider: LLMProviderType
  shouldFallback: boolean
}

/**
 * Common fallback test scenarios
 */
export const FALLBACK_SCENARIOS: FallbackScenario[] = [
  {
    name: 'Preferred provider available - no fallback needed',
    preferredProvider: 'claude',
    preferredAvailable: true,
    preferredHealthy: true,
    fallbackProviders: [{ type: 'lm-studio', available: true, healthy: true }],
    expectedUsedProvider: 'claude',
    shouldFallback: false
  },
  {
    name: 'Preferred provider unavailable - fallback to LM Studio',
    preferredProvider: 'claude',
    preferredAvailable: false,
    preferredHealthy: false,
    fallbackProviders: [{ type: 'lm-studio', available: true, healthy: true }],
    expectedUsedProvider: 'lm-studio',
    shouldFallback: true
  },
  {
    name: 'Preferred provider unhealthy - fallback to LM Studio',
    preferredProvider: 'cursor',
    preferredAvailable: true,
    preferredHealthy: false,
    fallbackProviders: [{ type: 'lm-studio', available: true, healthy: true }],
    expectedUsedProvider: 'lm-studio',
    shouldFallback: true
  },
  {
    name: 'Multiple fallbacks - cascade to first available',
    preferredProvider: 'claude',
    preferredAvailable: false,
    preferredHealthy: false,
    fallbackProviders: [
      { type: 'lm-studio', available: false, healthy: false },
      { type: 'ollama', available: true, healthy: true }
    ],
    expectedUsedProvider: 'ollama',
    shouldFallback: true
  },
  {
    name: 'LM Studio is always tried as fallback',
    preferredProvider: 'cursor',
    preferredAvailable: false,
    preferredHealthy: false,
    fallbackProviders: [
      { type: 'lm-studio', available: true, healthy: true },
      { type: 'claude', available: true, healthy: true }
    ],
    expectedUsedProvider: 'lm-studio',
    shouldFallback: true
  }
]

// ============================================================================
// Type Guards
// ============================================================================

/**
 * Check if a value is a valid LLM provider type
 */
export function isLLMProviderType(value: string): value is LLMProviderType {
  return ['lm-studio', 'ollama', 'claude', 'cursor', 'openai', 'anthropic', 'custom'].includes(value)
}

/**
 * Check if a result has data
 */
export function hasData<T>(result: { success: boolean; data?: T }): result is { success: true; data: T } {
  return result.success && result.data !== undefined
}

// ============================================================================
// Test Data Constants
// ============================================================================

export const TEST_CHAT_MESSAGE = 'Hello, how are you?'
export const TEST_SYSTEM_PROMPT = 'You are a helpful assistant.'

export const TEST_CHAT_PARAMS: ChatCompletionParams = {
  messages: [
    { role: 'system', content: TEST_SYSTEM_PROMPT },
    { role: 'user', content: TEST_CHAT_MESSAGE }
  ],
  maxTokens: 100,
  temperature: 0.7
}

export const EXPECTED_CLAUDE_MODELS = [
  'claude-sonnet-4-20250514',
  'claude-3-5-sonnet-20241022',
  'claude-3-opus-20240229',
  'claude-3-haiku-20240307'
]

export const EXPECTED_CURSOR_MODELS = ['cursor-default']

export const DEFAULT_PROVIDER_TYPES: LLMProviderType[] = [
  'lm-studio',
  'ollama',
  'claude',
  'cursor'
]
