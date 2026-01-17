/**
 * LLM Provider Interface
 *
 * Defines the contract that all LLM provider adapters must implement.
 * This abstraction layer enables multiple LLM backends (LM Studio, Ollama, OpenAI, etc.)
 * to be used interchangeably while maintaining a consistent interface.
 *
 * Key Design Principles:
 * 1. Backward Compatibility: All interfaces extend or mirror existing LM Studio types
 * 2. Provider Agnostic: No provider-specific details in the interface
 * 3. Extensible: Easy to add new providers without changing existing code
 * 4. Error Resilient: Consistent error handling across all providers
 */

// Re-export core types from lm-studio-client for backward compatibility
export type {
  ChatMessage,
  ChatCompletionRequest,
  ChatCompletionResponse,
  TokenUsage,
  HealthStatus,
  LLMModel,
  ClientResponse,
  ConnectionError,
  ConnectionErrorType
} from '../lm-studio-client'

// ============================================================================
// Provider Types
// ============================================================================

/**
 * Supported LLM provider types
 * Extends LLMBackendType to include additional cloud providers
 */
export type LLMProviderType =
  | 'lm-studio'    // Local LM Studio server (default)
  | 'ollama'       // Local Ollama server
  | 'claude'       // Claude CLI (local authenticated tool)
  | 'cursor'       // Cursor CLI (local authenticated tool)
  | 'openai'       // OpenAI API (future)
  | 'anthropic'    // Anthropic API (future)
  | 'custom'       // Custom provider implementation

/**
 * Provider priority for fallback ordering
 */
export type ProviderPriority = 'primary' | 'secondary' | 'tertiary' | 'fallback'

/**
 * Provider availability status
 */
export interface ProviderAvailability {
  /** Provider identifier */
  provider: LLMProviderType
  /** Whether the provider is currently available */
  available: boolean
  /** Response time in milliseconds (if available) */
  responseTimeMs?: number
  /** Error message if not available */
  error?: string
  /** Timestamp of last check */
  lastChecked: number
  /** Loaded model if applicable */
  loadedModel?: string
}

// ============================================================================
// Provider Configuration
// ============================================================================

/**
 * Base configuration for all providers
 */
export interface LLMProviderConfig {
  /** Provider type */
  type: LLMProviderType
  /** Provider display name */
  name: string
  /** Base URL for the provider API */
  baseUrl: string
  /** Request timeout in milliseconds */
  timeout?: number
  /** Number of retry attempts for failed requests */
  retryAttempts?: number
  /** Delay between retry attempts in milliseconds */
  retryDelayMs?: number
  /** Default maximum tokens for completions */
  defaultMaxTokens?: number
  /** Default temperature for completions */
  defaultTemperature?: number
  /** API key if required (for cloud providers) */
  apiKey?: string
  /** Additional provider-specific options */
  options?: Record<string, unknown>
}

/**
 * Configuration specific to local providers (LM Studio, Ollama)
 */
export interface LocalProviderConfig extends LLMProviderConfig {
  type: 'lm-studio' | 'ollama'
  /** Whether to auto-detect the backend on startup */
  autoDetect?: boolean
}

/**
 * Configuration specific to Claude CLI provider
 */
export interface ClaudeProviderConfig extends LLMProviderConfig {
  type: 'claude'
  /** Path to claude binary (auto-detected if not provided) */
  binaryPath?: string
  /** Path to .claude directory for authentication (defaults to ~/.claude) */
  claudeDir?: string
  /** Default model to use (e.g., 'claude-3-opus', 'claude-3-sonnet') */
  defaultModel?: string
}

/**
 * Configuration specific to Cursor CLI provider
 */
export interface CursorProviderConfig extends LLMProviderConfig {
  type: 'cursor'
  /** Path to cursor binary (auto-detected if not provided) */
  binaryPath?: string
  /** Default model to use */
  defaultModel?: string
}

/**
 * Configuration specific to cloud providers (OpenAI, Anthropic)
 */
export interface CloudProviderConfig extends LLMProviderConfig {
  type: 'openai' | 'anthropic'
  /** API key (required for cloud providers) */
  apiKey: string
  /** Organization ID (if applicable) */
  organizationId?: string
}

// ============================================================================
// Provider Interface
// ============================================================================

/**
 * Core interface that all LLM providers must implement
 *
 * This interface ensures consistent behavior across all backends while
 * allowing each provider to implement its own optimizations.
 */
export interface ILLMProvider {
  /**
   * Get the provider type
   */
  readonly type: LLMProviderType

  /**
   * Get the provider display name
   */
  readonly name: string

  /**
   * Get the current configuration
   */
  getConfig(): LLMProviderConfig

  /**
   * Update provider configuration
   * @param config Partial configuration to merge
   */
  updateConfig(config: Partial<LLMProviderConfig>): void

  /**
   * Check if the provider is healthy and responding
   * @param forceRefresh Force a fresh health check (bypass cache)
   * @returns Health check result with provider status
   */
  checkHealth(forceRefresh?: boolean): Promise<ProviderHealthResult>

  /**
   * Simple availability check
   * @returns Whether the provider is available
   */
  isAvailable(): Promise<boolean>

  /**
   * List available models from the provider
   * @returns List of available models
   */
  listModels(): Promise<ProviderModelsResult>

  /**
   * Send a chat completion request
   * @param request Chat completion parameters
   * @returns Chat completion response
   */
  chatCompletion(request: ChatCompletionParams): Promise<ProviderChatResult>

  /**
   * Simple chat helper - sends a single user message and returns the response content
   * @param userMessage User's message
   * @param systemPrompt Optional system prompt
   * @param options Additional options
   * @returns Response content string
   */
  chat(
    userMessage: string,
    systemPrompt?: string,
    options?: Partial<ChatCompletionParams>
  ): Promise<ProviderSimpleChatResult>

  /**
   * Reset provider state (clear caches, etc.)
   */
  reset(): void

  /**
   * Dispose provider resources
   */
  dispose(): void
}

// ============================================================================
// Provider Result Types
// ============================================================================

import type {
  ChatMessage,
  ChatCompletionResponse,
  HealthStatus,
  LLMModel
} from '../lm-studio-client'

/**
 * Parameters for chat completion
 * Mirrors ChatCompletionRequest but uses more intuitive naming
 */
export interface ChatCompletionParams {
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
 * Base result type for all provider operations
 */
export interface ProviderResult<T> {
  /** Whether the operation was successful */
  success: boolean
  /** Response data if successful */
  data?: T
  /** Error message if failed */
  error?: string
  /** Provider that handled the request */
  provider: LLMProviderType
  /** Response time in milliseconds */
  responseTimeMs?: number
}

/**
 * Health check result
 */
export type ProviderHealthResult = ProviderResult<HealthStatus>

/**
 * Models list result
 */
export type ProviderModelsResult = ProviderResult<LLMModel[]>

/**
 * Chat completion result
 */
export type ProviderChatResult = ProviderResult<ChatCompletionResponse>

/**
 * Simple chat result (just the content string)
 */
export type ProviderSimpleChatResult = ProviderResult<string>

// ============================================================================
// Provider Registry Types
// ============================================================================

/**
 * Provider registration entry
 */
export interface ProviderRegistration {
  /** Provider instance */
  provider: ILLMProvider
  /** Priority for fallback ordering */
  priority: ProviderPriority
  /** Whether this is the default provider */
  isDefault: boolean
  /** Whether the provider is enabled */
  enabled: boolean
}

/**
 * Provider selection criteria
 */
export interface ProviderSelectionCriteria {
  /** Preferred provider type (if any) */
  preferredProvider?: LLMProviderType
  /** Required capabilities (future: streaming, function calling, etc.) */
  requiredCapabilities?: string[]
  /** Minimum response time requirement */
  maxLatencyMs?: number
}

// ============================================================================
// Provider Events
// ============================================================================

/**
 * Events emitted by the provider manager
 */
export type ProviderEventType =
  | 'provider:registered'
  | 'provider:unregistered'
  | 'provider:switched'
  | 'provider:health-changed'
  | 'provider:fallback-triggered'
  | 'provider:error'

/**
 * Provider event payload
 */
export interface ProviderEvent {
  type: ProviderEventType
  provider: LLMProviderType
  timestamp: number
  data?: Record<string, unknown>
}

/**
 * Provider event listener
 */
export type ProviderEventListener = (event: ProviderEvent) => void

// ============================================================================
// Fallback Configuration
// ============================================================================

/**
 * Fallback behavior configuration
 */
export interface FallbackConfig {
  /** Whether fallback is enabled */
  enabled: boolean
  /** Maximum number of fallback attempts */
  maxAttempts: number
  /** Delay between fallback attempts in milliseconds */
  delayBetweenAttemptsMs: number
  /** Whether to cache provider availability for faster fallback */
  cacheAvailability: boolean
  /** Availability cache TTL in milliseconds */
  availabilityCacheTtlMs: number
}

/**
 * Default fallback configuration
 */
export const DEFAULT_FALLBACK_CONFIG: FallbackConfig = {
  enabled: true,
  maxAttempts: 3,
  delayBetweenAttemptsMs: 500,
  cacheAvailability: true,
  availabilityCacheTtlMs: 5000
}

// ============================================================================
// Provider Detection
// ============================================================================

/**
 * Result of provider detection
 */
export interface ProviderDetectionResult {
  /** Detected providers with availability info */
  providers: ProviderAvailability[]
  /** Recommended primary provider based on availability */
  recommendedPrimary?: LLMProviderType
  /** Detection timestamp */
  timestamp: number
  /** Total detection time in milliseconds */
  detectionTimeMs: number
}

/**
 * Provider detection options
 */
export interface ProviderDetectionOptions {
  /** Providers to check (defaults to all local providers) */
  providers?: LLMProviderType[]
  /** Timeout for each provider check in milliseconds */
  timeoutMs?: number
  /** Whether to check in parallel */
  parallel?: boolean
}
