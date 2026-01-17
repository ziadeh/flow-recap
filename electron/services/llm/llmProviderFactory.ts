/**
 * LLM Provider Factory
 *
 * Factory for creating LLM provider instances based on configuration.
 * Supports registration of custom provider adapters and provides
 * a centralized way to instantiate providers.
 *
 * Key Features:
 * - Type-safe provider creation
 * - Custom adapter registration
 * - Configuration validation
 * - Default configurations for each provider type
 */

import type {
  ILLMProvider,
  LLMProviderType,
  LLMProviderConfig,
  LocalProviderConfig
} from './llmProviderInterface'

import {
  LMStudioAdapter,
  createLMStudioAdapter,
  OllamaAdapter,
  createOllamaAdapter,
  ClaudeAdapter,
  createClaudeAdapter,
  CursorAdapter,
  createCursorAdapter
} from './adapters'

import type { ClaudeProviderConfig, CursorProviderConfig } from './llmProviderInterface'

// ============================================================================
// Types
// ============================================================================

/**
 * Provider constructor function signature
 */
export type ProviderConstructor = (config?: Partial<LLMProviderConfig>) => ILLMProvider

/**
 * Registered provider entry
 */
interface RegisteredProvider {
  type: LLMProviderType
  constructor: ProviderConstructor
  defaultConfig: Partial<LLMProviderConfig>
}

// ============================================================================
// Default Configurations
// ============================================================================

const DEFAULT_CONFIGS: Record<LLMProviderType, Partial<LLMProviderConfig>> = {
  'lm-studio': {
    type: 'lm-studio',
    name: 'LM Studio',
    baseUrl: 'http://localhost:1234',
    timeout: 30000,
    retryAttempts: 2,
    retryDelayMs: 1000,
    defaultMaxTokens: 2048,
    defaultTemperature: 0.7
  },
  'ollama': {
    type: 'ollama',
    name: 'Ollama',
    baseUrl: 'http://localhost:11434',
    timeout: 60000,
    retryAttempts: 2,
    retryDelayMs: 1000,
    defaultMaxTokens: 2048,
    defaultTemperature: 0.7
  },
  'claude': {
    type: 'claude',
    name: 'Claude CLI',
    baseUrl: '', // Not used for CLI-based provider
    timeout: 120000,
    retryAttempts: 1,
    retryDelayMs: 1000,
    defaultMaxTokens: 4096,
    defaultTemperature: 0.7
  },
  'cursor': {
    type: 'cursor',
    name: 'Cursor CLI',
    baseUrl: '', // Not used for CLI-based provider
    timeout: 120000,
    retryAttempts: 1,
    retryDelayMs: 1000,
    defaultMaxTokens: 4096,
    defaultTemperature: 0.7
  },
  'openai': {
    type: 'openai',
    name: 'OpenAI',
    baseUrl: 'https://api.openai.com/v1',
    timeout: 60000,
    retryAttempts: 3,
    retryDelayMs: 1000,
    defaultMaxTokens: 4096,
    defaultTemperature: 0.7
  },
  'anthropic': {
    type: 'anthropic',
    name: 'Anthropic',
    baseUrl: 'https://api.anthropic.com/v1',
    timeout: 60000,
    retryAttempts: 3,
    retryDelayMs: 1000,
    defaultMaxTokens: 4096,
    defaultTemperature: 0.7
  },
  'custom': {
    type: 'custom',
    name: 'Custom Provider',
    baseUrl: '',
    timeout: 30000,
    retryAttempts: 2,
    retryDelayMs: 1000,
    defaultMaxTokens: 2048,
    defaultTemperature: 0.7
  }
}

// ============================================================================
// Factory Class
// ============================================================================

/**
 * Factory for creating LLM provider instances
 */
class LLMProviderFactory {
  private registeredProviders: Map<LLMProviderType, RegisteredProvider> = new Map()

  constructor() {
    // Register built-in providers
    this.registerBuiltInProviders()
  }

  /**
   * Register built-in provider adapters
   */
  private registerBuiltInProviders(): void {
    // LM Studio (default)
    this.register('lm-studio', (config) => {
      return createLMStudioAdapter(config as Partial<LocalProviderConfig>)
    })

    // Ollama
    this.register('ollama', (config) => {
      return createOllamaAdapter(config as Partial<LocalProviderConfig>)
    })

    // Claude CLI (local authenticated tool)
    // This provider is silently ignored if the binary is not found or not authenticated
    this.register('claude', (config) => {
      return createClaudeAdapter(config as Partial<ClaudeProviderConfig>)
    })

    // Cursor CLI (local authenticated tool)
    // This provider is silently ignored if the binary is not found
    this.register('cursor', (config) => {
      return createCursorAdapter(config as Partial<CursorProviderConfig>)
    })

    // OpenAI (placeholder - not implemented yet)
    this.register('openai', () => {
      throw new Error('OpenAI provider is not yet implemented. Use LM Studio or Ollama.')
    })

    // Anthropic (placeholder - not implemented yet)
    this.register('anthropic', () => {
      throw new Error('Anthropic provider is not yet implemented. Use LM Studio or Ollama.')
    })

    // Custom (placeholder - user must register their own implementation)
    this.register('custom', () => {
      throw new Error('Custom provider requires registration. Use registerCustomProvider() first.')
    })
  }

  /**
   * Register a provider constructor
   * @param type Provider type identifier
   * @param constructor Provider constructor function
   * @param defaultConfig Optional default configuration
   */
  register(
    type: LLMProviderType,
    constructor: ProviderConstructor,
    defaultConfig?: Partial<LLMProviderConfig>
  ): void {
    this.registeredProviders.set(type, {
      type,
      constructor,
      defaultConfig: defaultConfig || DEFAULT_CONFIGS[type] || {}
    })
  }

  /**
   * Register a custom provider implementation
   * @param constructor Provider constructor function
   * @param defaultConfig Optional default configuration
   */
  registerCustomProvider(
    constructor: ProviderConstructor,
    defaultConfig?: Partial<LLMProviderConfig>
  ): void {
    this.register('custom', constructor, defaultConfig)
  }

  /**
   * Create a provider instance
   * @param type Provider type
   * @param config Optional configuration override
   * @returns Provider instance
   */
  create(type: LLMProviderType, config?: Partial<LLMProviderConfig>): ILLMProvider {
    const registered = this.registeredProviders.get(type)

    if (!registered) {
      throw new Error(`Unknown provider type: ${type}. Available types: ${this.getAvailableTypes().join(', ')}`)
    }

    // Merge default config with provided config
    const mergedConfig = {
      ...registered.defaultConfig,
      ...config
    }

    return registered.constructor(mergedConfig)
  }

  /**
   * Create a provider instance with auto-detection
   * Creates LM Studio by default, falls back to Ollama if LM Studio fails
   * @param config Optional configuration override
   * @returns Provider instance
   */
  createDefault(config?: Partial<LLMProviderConfig>): ILLMProvider {
    // Default to LM Studio as it's the primary supported backend
    return this.create('lm-studio', config)
  }

  /**
   * Check if a provider type is registered
   * @param type Provider type to check
   * @returns Whether the provider is registered
   */
  isRegistered(type: LLMProviderType): boolean {
    return this.registeredProviders.has(type)
  }

  /**
   * Get all available provider types
   * @returns Array of provider types
   */
  getAvailableTypes(): LLMProviderType[] {
    return Array.from(this.registeredProviders.keys())
  }

  /**
   * Get default configuration for a provider type
   * @param type Provider type
   * @returns Default configuration
   */
  getDefaultConfig(type: LLMProviderType): Partial<LLMProviderConfig> {
    const registered = this.registeredProviders.get(type)
    return registered?.defaultConfig || DEFAULT_CONFIGS[type] || {}
  }

  /**
   * Get all default configurations
   * @returns Map of provider types to default configurations
   */
  getAllDefaultConfigs(): Record<LLMProviderType, Partial<LLMProviderConfig>> {
    return { ...DEFAULT_CONFIGS }
  }

  /**
   * Unregister a provider
   * @param type Provider type to unregister
   */
  unregister(type: LLMProviderType): void {
    this.registeredProviders.delete(type)
  }

  /**
   * Reset factory to initial state (built-in providers only)
   */
  reset(): void {
    this.registeredProviders.clear()
    this.registerBuiltInProviders()
  }
}

// ============================================================================
// Singleton Export
// ============================================================================

/**
 * Singleton factory instance
 */
export const llmProviderFactory = new LLMProviderFactory()

/**
 * Create a provider using the singleton factory
 * @param type Provider type
 * @param config Optional configuration
 * @returns Provider instance
 */
export function createProvider(
  type: LLMProviderType,
  config?: Partial<LLMProviderConfig>
): ILLMProvider {
  return llmProviderFactory.create(type, config)
}

/**
 * Create the default provider (LM Studio)
 * @param config Optional configuration
 * @returns Provider instance
 */
export function createDefaultProvider(config?: Partial<LLMProviderConfig>): ILLMProvider {
  return llmProviderFactory.createDefault(config)
}

/**
 * Register a custom provider implementation
 * @param constructor Provider constructor function
 * @param defaultConfig Optional default configuration
 */
export function registerCustomProvider(
  constructor: ProviderConstructor,
  defaultConfig?: Partial<LLMProviderConfig>
): void {
  llmProviderFactory.registerCustomProvider(constructor, defaultConfig)
}

/**
 * Get available provider types
 * @returns Array of provider types
 */
export function getAvailableProviderTypes(): LLMProviderType[] {
  return llmProviderFactory.getAvailableTypes()
}

/**
 * Get default configuration for a provider type
 * @param type Provider type
 * @returns Default configuration
 */
export function getProviderDefaultConfig(type: LLMProviderType): Partial<LLMProviderConfig> {
  return llmProviderFactory.getDefaultConfig(type)
}

/**
 * Reset factory to initial state
 */
export function resetFactory(): void {
  llmProviderFactory.reset()
}

export default llmProviderFactory
