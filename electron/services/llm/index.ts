/**
 * LLM Provider Abstraction Layer
 *
 * A unified interface for multiple LLM backends that wraps the existing
 * LM Studio implementation and provides provider detection, routing,
 * and fallback mechanisms.
 *
 * Key Features:
 * - Backward compatible with existing lmStudioClient usage
 * - Provider-agnostic interface (ILLMProvider)
 * - Automatic provider detection
 * - Priority-based fallback routing
 * - Event system for provider state changes
 *
 * Quick Start:
 * ```typescript
 * import { llmProviderManager, initializeLLMProviderManager } from './llm'
 *
 * // Initialize once at app start
 * await initializeLLMProviderManager()
 *
 * // Use the default provider (LM Studio)
 * const result = await llmProviderManager.chat('Hello!')
 *
 * // Or get a specific provider
 * const ollama = llmProviderManager.getProvider('ollama')
 * ```
 *
 * Migration from lmStudioClient:
 * The existing lmStudioClient continues to work unchanged. The new
 * abstraction layer delegates to it by default, ensuring backward
 * compatibility with all existing LLM calls.
 */

// ============================================================================
// Core Interfaces & Types
// ============================================================================

export type {
  // Provider types
  LLMProviderType,
  ProviderPriority,
  ProviderAvailability,

  // Configuration types
  LLMProviderConfig,
  LocalProviderConfig,
  ClaudeProviderConfig,
  CursorProviderConfig,
  CloudProviderConfig,

  // Provider interface
  ILLMProvider,

  // Request/Response types
  ChatCompletionParams,
  ProviderResult,
  ProviderHealthResult,
  ProviderModelsResult,
  ProviderChatResult,
  ProviderSimpleChatResult,

  // Registration types
  ProviderRegistration,
  ProviderSelectionCriteria,

  // Event types
  ProviderEventType,
  ProviderEvent,
  ProviderEventListener,

  // Fallback types
  FallbackConfig,

  // Detection types
  ProviderDetectionResult,
  ProviderDetectionOptions
} from './llmProviderInterface'

// Re-export common types from lm-studio-client for convenience
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

// Constants
export { DEFAULT_FALLBACK_CONFIG } from './llmProviderInterface'

// ============================================================================
// Provider Adapters
// ============================================================================

export {
  // LM Studio Adapter (Default)
  LMStudioAdapter,
  createLMStudioAdapter,
  defaultLMStudioAdapter,

  // Ollama Adapter
  OllamaAdapter,
  createOllamaAdapter,

  // Claude CLI Adapter
  ClaudeAdapter,
  createClaudeAdapter,

  // Cursor CLI Adapter
  CursorAdapter,
  createCursorAdapter
} from './adapters'

// ============================================================================
// Provider Factory
// ============================================================================

export {
  llmProviderFactory,
  createProvider,
  createDefaultProvider,
  registerCustomProvider,
  getAvailableProviderTypes,
  getProviderDefaultConfig,
  resetFactory
} from './llmProviderFactory'

export type { ProviderConstructor } from './llmProviderFactory'

// ============================================================================
// Provider Manager (Main Entry Point)
// ============================================================================

export {
  llmProviderManager,
  initializeLLMProviderManager,
  getProvider,
  getDefaultProvider,
  detectProviders,
  resetProviders,
  disposeProviders
} from './llmProviderManager'

export type { LLMProviderManagerConfig } from './llmProviderManager'

// ============================================================================
// Routing Service (Intelligent Routing with Fallback)
// ============================================================================

export {
  llmRoutingService,
  initializeLLMRoutingService,
  getRoutingService,
  resetRoutingService
} from './llmRoutingService'

export type {
  FallbackEvent,
  RoutingResult,
  RoutingConfig
} from './llmRoutingService'

// ============================================================================
// Default Export
// ============================================================================

/**
 * Default export is the provider manager singleton
 * This allows simple usage: `import llm from './llm'`
 */
export { llmProviderManager as default } from './llmProviderManager'
