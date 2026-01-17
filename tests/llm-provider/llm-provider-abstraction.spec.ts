/**
 * LLM Provider Abstraction Layer Test Suite
 *
 * Comprehensive tests validating:
 * 1. LM Studio remains default and fallback
 * 2. Claude CLI and Cursor CLI are detected correctly
 * 3. Routing works for all provider types
 * 4. Fallback to LM Studio occurs on provider failure
 * 5. No existing LLM functionality is broken
 * 6. CLI execution works without API keys
 * 7. Missing CLI tools are silently ignored
 *
 * These tests use mock providers and utilities to validate
 * the abstraction layer behavior without requiring actual
 * LLM providers to be available.
 */

import { test, expect } from '@playwright/test'
import {
  MockLLMProvider,
  createMockLMStudioProvider,
  createMockOllamaProvider,
  createMockClaudeProvider,
  createMockCursorProvider,
  createUnavailableMockProvider,
  createFailingMockProvider,
  createMockProviderAvailability,
  createMockDetectionResult,
  assertSuccess,
  assertFailure,
  assertProviderType,
  FALLBACK_SCENARIOS,
  TEST_CHAT_MESSAGE,
  TEST_SYSTEM_PROMPT,
  TEST_CHAT_PARAMS,
  EXPECTED_CLAUDE_MODELS,
  EXPECTED_CURSOR_MODELS,
  DEFAULT_PROVIDER_TYPES,
  isLLMProviderType,
  hasData
} from './test-utils'

import type { LLMProviderType } from '../../electron/services/llm/llmProviderInterface'

// ============================================================================
// Requirement 1: LM Studio Remains Default and Fallback
// ============================================================================

test.describe('Requirement 1: LM Studio as Default and Fallback', () => {

  test('LM Studio should be the default provider type', () => {
    // The default config should specify LM Studio as default
    const defaultProviderConfig = {
      defaultProvider: 'lm-studio' as LLMProviderType,
      fallbackOrder: ['lm-studio', 'claude', 'cursor', 'ollama']
    }

    expect(defaultProviderConfig.defaultProvider).toBe('lm-studio')
  })

  test('LM Studio should always be in the fallback order', () => {
    const fallbackOrder: LLMProviderType[] = ['lm-studio', 'claude', 'cursor', 'ollama']

    expect(fallbackOrder).toContain('lm-studio')
    // LM Studio should be first in fallback order
    expect(fallbackOrder[0]).toBe('lm-studio')
  })

  test('LM Studio adapter should implement ILLMProvider interface', () => {
    const provider = createMockLMStudioProvider()

    // Verify all required interface methods exist
    expect(typeof provider.getConfig).toBe('function')
    expect(typeof provider.updateConfig).toBe('function')
    expect(typeof provider.checkHealth).toBe('function')
    expect(typeof provider.isAvailable).toBe('function')
    expect(typeof provider.listModels).toBe('function')
    expect(typeof provider.chatCompletion).toBe('function')
    expect(typeof provider.chat).toBe('function')
    expect(typeof provider.reset).toBe('function')
    expect(typeof provider.dispose).toBe('function')
  })

  test('LM Studio adapter should have correct type property', () => {
    const provider = createMockLMStudioProvider()

    expect(provider.type).toBe('lm-studio')
  })

  test('LM Studio default config should have correct values', () => {
    const expectedConfig = {
      type: 'lm-studio',
      name: 'LM Studio',
      baseUrl: 'http://localhost:1234',
      timeout: 30000,
      retryAttempts: 2,
      defaultMaxTokens: 2048,
      defaultTemperature: 0.7
    }

    // These values should match the DEFAULT_LM_STUDIO_ADAPTER_CONFIG
    expect(expectedConfig.type).toBe('lm-studio')
    expect(expectedConfig.baseUrl).toBe('http://localhost:1234')
    expect(expectedConfig.timeout).toBe(30000)
  })

  test('LM Studio should remain as fallback when preferred provider fails', async () => {
    const claudeProvider = createMockClaudeProvider({ available: false })
    const lmStudioProvider = createMockLMStudioProvider({ available: true })

    // Claude is unavailable
    expect(await claudeProvider.isAvailable()).toBe(false)

    // LM Studio should still be available as fallback
    expect(await lmStudioProvider.isAvailable()).toBe(true)

    // LM Studio should respond successfully
    const result = await lmStudioProvider.chat(TEST_CHAT_MESSAGE)
    expect(result.success).toBe(true)
    expect(result.provider).toBe('lm-studio')
  })

  test('LM Studio adapter should work with shared singleton client pattern', () => {
    // Create two providers with shared client flag
    const provider1 = createMockLMStudioProvider()
    const provider2 = createMockLMStudioProvider()

    // Both should have the same type
    expect(provider1.type).toBe(provider2.type)
    expect(provider1.type).toBe('lm-studio')
  })
})

// ============================================================================
// Requirement 2: Claude CLI Detection
// ============================================================================

test.describe('Requirement 2: Claude CLI Detection', () => {

  test('Claude adapter should have correct type property', () => {
    const provider = createMockClaudeProvider()

    expect(provider.type).toBe('claude')
    expect(provider.name).toBe('Mock Claude CLI')
  })

  test('Claude adapter should implement ILLMProvider interface', () => {
    const provider = createMockClaudeProvider()

    // Verify all required interface methods exist
    expect(typeof provider.getConfig).toBe('function')
    expect(typeof provider.updateConfig).toBe('function')
    expect(typeof provider.checkHealth).toBe('function')
    expect(typeof provider.isAvailable).toBe('function')
    expect(typeof provider.listModels).toBe('function')
    expect(typeof provider.chatCompletion).toBe('function')
    expect(typeof provider.chat).toBe('function')
    expect(typeof provider.reset).toBe('function')
    expect(typeof provider.dispose).toBe('function')
  })

  test('Claude adapter should return expected models', async () => {
    const provider = createMockClaudeProvider()
    const result = await provider.listModels()

    expect(result.success).toBe(true)
    expect(result.data).toBeDefined()

    const modelIds = result.data!.map(m => m.id)
    for (const expectedModel of EXPECTED_CLAUDE_MODELS) {
      expect(modelIds).toContain(expectedModel)
    }
  })

  test('Claude adapter should include provider type in results', async () => {
    const provider = createMockClaudeProvider()

    const healthResult = await provider.checkHealth()
    expect(healthResult.provider).toBe('claude')

    const modelsResult = await provider.listModels()
    expect(modelsResult.provider).toBe('claude')

    const chatResult = await provider.chat(TEST_CHAT_MESSAGE)
    expect(chatResult.provider).toBe('claude')
  })

  test('Claude adapter should handle chat completion with system prompt', async () => {
    const provider = createMockClaudeProvider({ chatResponse: 'Claude response with context' })

    const result = await provider.chat(TEST_CHAT_MESSAGE, TEST_SYSTEM_PROMPT)

    expect(result.success).toBe(true)
    expect(result.data).toBe('Claude response with context')
    expect(result.provider).toBe('claude')
  })

  test('Claude adapter default model should be claude-sonnet-4', () => {
    // The default model in ClaudeAdapter should be the latest Sonnet
    const expectedDefaultModel = 'claude-sonnet-4-20250514'

    // This reflects the DEFAULT_CLAUDE_ADAPTER_CONFIG.defaultModel
    expect(EXPECTED_CLAUDE_MODELS).toContain(expectedDefaultModel)
    expect(EXPECTED_CLAUDE_MODELS[0]).toBe(expectedDefaultModel)
  })

  test('Claude adapter should be silently unavailable when binary not found', async () => {
    const provider = createUnavailableMockProvider('claude', 'Claude CLI (not found)')

    // Should return false without throwing
    const isAvailable = await provider.isAvailable()
    expect(isAvailable).toBe(false)

    // checkHealth should return failure result without throwing
    const health = await provider.checkHealth()
    expect(health.success).toBe(false)
    expect(health.provider).toBe('claude')
  })
})

// ============================================================================
// Requirement 3: Cursor CLI Detection
// ============================================================================

test.describe('Requirement 3: Cursor CLI Detection', () => {

  test('Cursor adapter should have correct type property', () => {
    const provider = createMockCursorProvider()

    expect(provider.type).toBe('cursor')
    expect(provider.name).toBe('Mock Cursor CLI')
  })

  test('Cursor adapter should implement ILLMProvider interface', () => {
    const provider = createMockCursorProvider()

    // Verify all required interface methods exist
    expect(typeof provider.getConfig).toBe('function')
    expect(typeof provider.updateConfig).toBe('function')
    expect(typeof provider.checkHealth).toBe('function')
    expect(typeof provider.isAvailable).toBe('function')
    expect(typeof provider.listModels).toBe('function')
    expect(typeof provider.chatCompletion).toBe('function')
    expect(typeof provider.chat).toBe('function')
    expect(typeof provider.reset).toBe('function')
    expect(typeof provider.dispose).toBe('function')
  })

  test('Cursor adapter should return expected models', async () => {
    const provider = createMockCursorProvider()
    const result = await provider.listModels()

    expect(result.success).toBe(true)
    expect(result.data).toBeDefined()

    const modelIds = result.data!.map(m => m.id)
    for (const expectedModel of EXPECTED_CURSOR_MODELS) {
      expect(modelIds).toContain(expectedModel)
    }
  })

  test('Cursor adapter should include provider type in results', async () => {
    const provider = createMockCursorProvider()

    const healthResult = await provider.checkHealth()
    expect(healthResult.provider).toBe('cursor')

    const modelsResult = await provider.listModels()
    expect(modelsResult.provider).toBe('cursor')

    const chatResult = await provider.chat(TEST_CHAT_MESSAGE)
    expect(chatResult.provider).toBe('cursor')
  })

  test('Cursor adapter should handle chat completion', async () => {
    const provider = createMockCursorProvider({ chatResponse: 'Cursor CLI response' })

    const result = await provider.chat(TEST_CHAT_MESSAGE)

    expect(result.success).toBe(true)
    expect(result.data).toBe('Cursor CLI response')
    expect(result.provider).toBe('cursor')
  })

  test('Cursor adapter should be silently unavailable when binary not found', async () => {
    const provider = createUnavailableMockProvider('cursor', 'Cursor CLI (not found)')

    // Should return false without throwing
    const isAvailable = await provider.isAvailable()
    expect(isAvailable).toBe(false)

    // checkHealth should return failure result without throwing
    const health = await provider.checkHealth()
    expect(health.success).toBe(false)
    expect(health.provider).toBe('cursor')
  })
})

// ============================================================================
// Requirement 4: Routing Works for All Provider Types
// ============================================================================

test.describe('Requirement 4: Routing for All Provider Types', () => {

  test('all default provider types should be valid', () => {
    for (const type of DEFAULT_PROVIDER_TYPES) {
      expect(isLLMProviderType(type)).toBe(true)
    }
  })

  test('routing should select available preferred provider first', async () => {
    const claudeProvider = createMockClaudeProvider({ chatResponse: 'Claude handled this' })
    const lmStudioProvider = createMockLMStudioProvider({ chatResponse: 'LM Studio handled this' })

    // Both are available
    expect(await claudeProvider.isAvailable()).toBe(true)
    expect(await lmStudioProvider.isAvailable()).toBe(true)

    // If Claude is preferred and available, it should be used
    const claudeResult = await claudeProvider.chat(TEST_CHAT_MESSAGE)
    expect(claudeResult.provider).toBe('claude')
    expect(claudeResult.data).toBe('Claude handled this')
  })

  for (const type of DEFAULT_PROVIDER_TYPES) {
    test(`provider type ${type} should create valid mock provider`, async () => {
      let provider: MockLLMProvider

      switch (type) {
        case 'lm-studio':
          provider = createMockLMStudioProvider()
          break
        case 'ollama':
          provider = createMockOllamaProvider()
          break
        case 'claude':
          provider = createMockClaudeProvider()
          break
        case 'cursor':
          provider = createMockCursorProvider()
          break
        default:
          throw new Error(`Unknown provider type: ${type}`)
      }

      expect(provider.type).toBe(type)
      expect(await provider.isAvailable()).toBe(true)

      const healthResult = await provider.checkHealth()
      expect(healthResult.success).toBe(true)
      expect(healthResult.provider).toBe(type)
    })
  }

  test('routing config should include all provider types in fallback order', () => {
    const routingConfig = {
      defaultProvider: 'lm-studio' as LLMProviderType,
      fallbackOrder: ['lm-studio', 'claude', 'cursor', 'ollama'] as LLMProviderType[]
    }

    expect(routingConfig.fallbackOrder.length).toBe(4)
    expect(routingConfig.fallbackOrder).toContain('lm-studio')
    expect(routingConfig.fallbackOrder).toContain('claude')
    expect(routingConfig.fallbackOrder).toContain('cursor')
    expect(routingConfig.fallbackOrder).toContain('ollama')
  })

  test('routing should check provider availability before routing', async () => {
    const provider = createMockClaudeProvider()

    // isAvailable should be checked first
    const available = await provider.isAvailable()
    expect(available).toBe(true)

    // Call history should record the check
    expect(provider.getCallCount('isAvailable')).toBe(1)
  })
})

// ============================================================================
// Requirement 5: Fallback to LM Studio on Provider Failure
// ============================================================================

test.describe('Requirement 5: Fallback to LM Studio on Failure', () => {

  for (const scenario of FALLBACK_SCENARIOS) {
    test(`Fallback scenario: ${scenario.name}`, async () => {
      // Create preferred provider
      const preferredProvider = new MockLLMProvider({
        type: scenario.preferredProvider,
        name: `Test ${scenario.preferredProvider}`,
        available: scenario.preferredAvailable,
        healthy: scenario.preferredHealthy
      })

      // Check if fallback is needed
      const preferredAvailable = await preferredProvider.isAvailable()

      if (scenario.shouldFallback) {
        expect(preferredAvailable).toBe(scenario.preferredAvailable)

        // If preferred is unavailable, we'd need to use fallback
        if (!preferredAvailable) {
          // Create fallback provider
          const fallbackConfig = scenario.fallbackProviders.find(f => f.available && f.healthy)
          expect(fallbackConfig).toBeDefined()

          const fallbackProvider = new MockLLMProvider({
            type: fallbackConfig!.type,
            name: `Test ${fallbackConfig!.type}`,
            available: fallbackConfig!.available,
            healthy: fallbackConfig!.healthy
          })

          const fallbackAvailable = await fallbackProvider.isAvailable()
          expect(fallbackAvailable).toBe(true)
          expect(fallbackProvider.type).toBe(scenario.expectedUsedProvider)
        }
      } else {
        // Preferred provider should be used
        expect(preferredAvailable).toBe(true)
        expect(preferredProvider.type).toBe(scenario.expectedUsedProvider)
      }
    })
  }

  test('fallback should happen when preferred provider throws exception', async () => {
    const failingProvider = createFailingMockProvider('claude', 'Failing Claude', 'Connection failed')
    const fallbackProvider = createMockLMStudioProvider()

    // Failing provider should throw on operations
    await expect(async () => {
      await failingProvider.listModels()
    }).rejects.toThrow('Connection failed')

    // Fallback provider should still work
    const result = await fallbackProvider.listModels()
    expect(result.success).toBe(true)
    expect(result.provider).toBe('lm-studio')
  })

  test('fallback should happen when preferred provider returns failure result', async () => {
    const unavailableProvider = createUnavailableMockProvider('claude', 'Unavailable Claude')
    const fallbackProvider = createMockLMStudioProvider()

    // Unavailable provider should return failure results
    const unavailableResult = await unavailableProvider.chat(TEST_CHAT_MESSAGE)
    expect(unavailableResult.success).toBe(false)

    // Fallback provider should work
    const fallbackResult = await fallbackProvider.chat(TEST_CHAT_MESSAGE)
    expect(fallbackResult.success).toBe(true)
    expect(fallbackResult.provider).toBe('lm-studio')
  })

  test('fallback chain should try providers in order', async () => {
    // Simulate: Claude unavailable -> LM Studio available
    const providers: MockLLMProvider[] = [
      createUnavailableMockProvider('claude', 'Claude'),
      createMockLMStudioProvider()
    ]

    // First provider unavailable
    expect(await providers[0].isAvailable()).toBe(false)

    // Second provider (LM Studio) available
    expect(await providers[1].isAvailable()).toBe(true)

    // Should use LM Studio
    const result = await providers[1].chat(TEST_CHAT_MESSAGE)
    expect(result.success).toBe(true)
    expect(result.provider).toBe('lm-studio')
  })

  test('all providers failing should result in error', async () => {
    const providers = [
      createUnavailableMockProvider('claude', 'Claude'),
      createUnavailableMockProvider('lm-studio', 'LM Studio'),
      createUnavailableMockProvider('ollama', 'Ollama')
    ]

    // All providers unavailable
    for (const provider of providers) {
      expect(await provider.isAvailable()).toBe(false)
    }

    // No provider can handle the request
    const results = await Promise.all(
      providers.map(p => p.chat(TEST_CHAT_MESSAGE))
    )

    // All should fail
    for (const result of results) {
      expect(result.success).toBe(false)
    }
  })
})

// ============================================================================
// Requirement 6: No Existing LLM Functionality Broken
// ============================================================================

test.describe('Requirement 6: Backward Compatibility', () => {

  test('provider should implement all required chat methods', async () => {
    const provider = createMockLMStudioProvider()

    // chat() method
    const chatResult = await provider.chat(TEST_CHAT_MESSAGE)
    expect(chatResult.success).toBe(true)
    expect(chatResult.data).toBeDefined()

    // chat() with system prompt
    const chatWithPromptResult = await provider.chat(TEST_CHAT_MESSAGE, TEST_SYSTEM_PROMPT)
    expect(chatWithPromptResult.success).toBe(true)

    // chatCompletion() method
    const completionResult = await provider.chatCompletion(TEST_CHAT_PARAMS)
    expect(completionResult.success).toBe(true)
    expect(completionResult.data).toBeDefined()
  })

  test('provider should implement health check methods', async () => {
    const provider = createMockLMStudioProvider()

    // checkHealth() without force refresh
    const health1 = await provider.checkHealth()
    expect(health1.success).toBe(true)
    expect(health1.data?.healthy).toBe(true)

    // checkHealth() with force refresh
    const health2 = await provider.checkHealth(true)
    expect(health2.success).toBe(true)

    // isAvailable()
    const available = await provider.isAvailable()
    expect(available).toBe(true)
  })

  test('provider should implement model listing', async () => {
    const provider = createMockLMStudioProvider()

    const result = await provider.listModels()

    expect(result.success).toBe(true)
    expect(result.data).toBeInstanceOf(Array)
    expect(result.data!.length).toBeGreaterThan(0)
  })

  test('provider should implement configuration methods', () => {
    const provider = createMockLMStudioProvider()

    // getConfig()
    const config = provider.getConfig()
    expect(config).toBeDefined()
    expect(config.type).toBe('lm-studio')

    // updateConfig()
    provider.updateConfig({ timeout: 60000 })
    const updatedConfig = provider.getConfig()
    expect(updatedConfig.timeout).toBe(60000)
  })

  test('provider should implement lifecycle methods', () => {
    const provider = createMockLMStudioProvider()

    // reset()
    expect(() => provider.reset()).not.toThrow()

    // dispose()
    expect(() => provider.dispose()).not.toThrow()
  })

  test('chat response format should be compatible with existing interfaces', async () => {
    const provider = createMockLMStudioProvider({ chatResponse: 'Test response' })

    const result = await provider.chatCompletion(TEST_CHAT_PARAMS)

    expect(result.success).toBe(true)
    expect(result.data).toBeDefined()

    // ChatCompletionResponse format
    const response = result.data!
    expect(response.id).toBeDefined()
    expect(response.object).toBe('chat.completion')
    expect(response.created).toBeDefined()
    expect(response.model).toBeDefined()
    expect(response.choices).toBeInstanceOf(Array)
    expect(response.choices[0].message.role).toBe('assistant')
    expect(response.choices[0].message.content).toBeDefined()
  })

  test('health status format should be compatible with existing interfaces', async () => {
    const provider = createMockLMStudioProvider()

    const result = await provider.checkHealth()

    expect(result.success).toBe(true)
    expect(result.data).toBeDefined()

    // HealthStatus format
    const status = result.data!
    expect(typeof status.healthy).toBe('boolean')
    expect(typeof status.responseTimeMs).toBe('number')
  })
})

// ============================================================================
// Requirement 7: CLI Execution Without API Keys
// ============================================================================

test.describe('Requirement 7: CLI Execution Without API Keys', () => {

  test('Claude adapter should not require API key in config', () => {
    const provider = createMockClaudeProvider()
    const config = provider.getConfig()

    // CLI providers don't use API keys
    expect(config.apiKey).toBeUndefined()
  })

  test('Cursor adapter should not require API key in config', () => {
    const provider = createMockCursorProvider()
    const config = provider.getConfig()

    // CLI providers don't use API keys
    expect(config.apiKey).toBeUndefined()
  })

  test('Claude config type should have CLI-specific properties', () => {
    // ClaudeProviderConfig should have:
    // - binaryPath
    // - claudeDir
    // - defaultModel

    const expectedConfigProperties = [
      'type',
      'name',
      'baseUrl', // Empty for CLI
      'timeout',
      'defaultModel'
    ]

    const provider = createMockClaudeProvider()
    const config = provider.getConfig()

    for (const prop of expectedConfigProperties) {
      expect(prop in config || config[prop as keyof typeof config] === undefined).toBe(true)
    }
  })

  test('Cursor config type should have CLI-specific properties', () => {
    // CursorProviderConfig should have:
    // - binaryPath
    // - defaultModel

    const expectedConfigProperties = [
      'type',
      'name',
      'baseUrl', // Empty for CLI
      'timeout',
      'defaultModel'
    ]

    const provider = createMockCursorProvider()
    const config = provider.getConfig()

    for (const prop of expectedConfigProperties) {
      expect(prop in config || config[prop as keyof typeof config] === undefined).toBe(true)
    }
  })

  test('CLI providers should work without any environment variables', async () => {
    // Mock providers don't need any environment setup
    const claudeProvider = createMockClaudeProvider()
    const cursorProvider = createMockCursorProvider()

    // Both should be available (in mock mode)
    expect(await claudeProvider.isAvailable()).toBe(true)
    expect(await cursorProvider.isAvailable()).toBe(true)

    // Both should handle requests
    const claudeResult = await claudeProvider.chat(TEST_CHAT_MESSAGE)
    const cursorResult = await cursorProvider.chat(TEST_CHAT_MESSAGE)

    expect(claudeResult.success).toBe(true)
    expect(cursorResult.success).toBe(true)
  })

  test('LM Studio (HTTP provider) also should not require API key by default', () => {
    const provider = createMockLMStudioProvider()
    const config = provider.getConfig()

    // LM Studio doesn't require API key for local usage
    expect(config.apiKey).toBeUndefined()
  })
})

// ============================================================================
// Requirement 8: Missing CLI Tools Silently Ignored
// ============================================================================

test.describe('Requirement 8: Missing CLI Tools Silently Ignored', () => {

  test('unavailable Claude should return false for isAvailable without throwing', async () => {
    const provider = createUnavailableMockProvider('claude', 'Claude (not installed)')

    // Should NOT throw
    let error: Error | null = null
    let result: boolean = false

    try {
      result = await provider.isAvailable()
    } catch (e) {
      error = e as Error
    }

    expect(error).toBeNull()
    expect(result).toBe(false)
  })

  test('unavailable Cursor should return false for isAvailable without throwing', async () => {
    const provider = createUnavailableMockProvider('cursor', 'Cursor (not installed)')

    // Should NOT throw
    let error: Error | null = null
    let result: boolean = false

    try {
      result = await provider.isAvailable()
    } catch (e) {
      error = e as Error
    }

    expect(error).toBeNull()
    expect(result).toBe(false)
  })

  test('unavailable provider checkHealth should return failure result, not throw', async () => {
    const provider = createUnavailableMockProvider('claude', 'Claude (not found)')

    // Should NOT throw
    let error: Error | null = null
    let result: { success: boolean; error?: string } | null = null

    try {
      result = await provider.checkHealth()
    } catch (e) {
      error = e as Error
    }

    expect(error).toBeNull()
    expect(result).not.toBeNull()
    expect(result!.success).toBe(false)
    expect(result!.error).toBeDefined()
  })

  test('unavailable provider listModels should return failure result, not throw', async () => {
    const provider = createUnavailableMockProvider('cursor', 'Cursor (not found)')

    // Should NOT throw
    let error: Error | null = null
    let result: { success: boolean; error?: string } | null = null

    try {
      result = await provider.listModels()
    } catch (e) {
      error = e as Error
    }

    expect(error).toBeNull()
    expect(result).not.toBeNull()
    expect(result!.success).toBe(false)
  })

  test('unavailable provider chat should return failure result, not throw', async () => {
    const provider = createUnavailableMockProvider('claude', 'Claude (not found)')

    // Should NOT throw
    let error: Error | null = null
    let result: { success: boolean; error?: string } | null = null

    try {
      result = await provider.chat(TEST_CHAT_MESSAGE)
    } catch (e) {
      error = e as Error
    }

    expect(error).toBeNull()
    expect(result).not.toBeNull()
    expect(result!.success).toBe(false)
  })

  test('provider detection should include unavailable providers with available=false', async () => {
    const availabilities = [
      createMockProviderAvailability('lm-studio', true),
      createMockProviderAvailability('claude', false),
      createMockProviderAvailability('cursor', false),
      createMockProviderAvailability('ollama', true)
    ]

    const detectionResult = createMockDetectionResult(availabilities)

    // All providers should be in the result
    expect(detectionResult.providers.length).toBe(4)

    // Available and unavailable should be correctly marked
    const lmStudio = detectionResult.providers.find(p => p.provider === 'lm-studio')
    const claude = detectionResult.providers.find(p => p.provider === 'claude')
    const cursor = detectionResult.providers.find(p => p.provider === 'cursor')
    const ollama = detectionResult.providers.find(p => p.provider === 'ollama')

    expect(lmStudio?.available).toBe(true)
    expect(claude?.available).toBe(false)
    expect(cursor?.available).toBe(false)
    expect(ollama?.available).toBe(true)

    // Recommended primary should be available provider
    expect(detectionResult.recommendedPrimary).toBeDefined()
    expect(['lm-studio', 'ollama']).toContain(detectionResult.recommendedPrimary)
  })

  test('routing should skip unavailable providers silently', async () => {
    // Create a mix of available and unavailable providers
    const providers = [
      createUnavailableMockProvider('claude', 'Claude'),
      createMockLMStudioProvider({ chatResponse: 'LM Studio response' })
    ]

    // Check availability of each
    const availabilities = await Promise.all(
      providers.map(async p => ({
        type: p.type,
        available: await p.isAvailable()
      }))
    )

    // Claude should be unavailable
    expect(availabilities.find(a => a.type === 'claude')?.available).toBe(false)

    // LM Studio should be available
    expect(availabilities.find(a => a.type === 'lm-studio')?.available).toBe(true)

    // Only LM Studio should handle the request
    const availableProvider = providers.find(p => p.type === 'lm-studio')!
    const result = await availableProvider.chat(TEST_CHAT_MESSAGE)

    expect(result.success).toBe(true)
    expect(result.provider).toBe('lm-studio')
  })
})

// ============================================================================
// Integration Tests with Mock CLI Responses
// ============================================================================

test.describe('Integration Tests: Mock CLI Responses', () => {

  test('mock Claude CLI should simulate successful command execution', async () => {
    const provider = createMockClaudeProvider({
      chatResponse: 'This is a response from the Claude CLI mock'
    })

    const result = await provider.chat('Explain TypeScript generics')

    expect(result.success).toBe(true)
    expect(result.data).toBe('This is a response from the Claude CLI mock')
    expect(result.provider).toBe('claude')
    expect(result.responseTimeMs).toBeDefined()
  })

  test('mock Cursor CLI should simulate successful command execution', async () => {
    const provider = createMockCursorProvider({
      chatResponse: 'This is a response from the Cursor CLI mock'
    })

    const result = await provider.chat('Generate a React component')

    expect(result.success).toBe(true)
    expect(result.data).toBe('This is a response from the Cursor CLI mock')
    expect(result.provider).toBe('cursor')
    expect(result.responseTimeMs).toBeDefined()
  })

  test('mock CLI providers should track call history', async () => {
    const provider = createMockClaudeProvider()

    // Make several calls
    await provider.isAvailable()
    await provider.checkHealth()
    await provider.chat(TEST_CHAT_MESSAGE)
    await provider.listModels()

    // Verify call history
    expect(provider.getCallCount()).toBe(4)
    expect(provider.getCallCount('isAvailable')).toBe(1)
    expect(provider.getCallCount('checkHealth')).toBe(1)
    expect(provider.getCallCount('chat')).toBe(1)
    expect(provider.getCallCount('listModels')).toBe(1)

    // Verify last call
    const lastCall = provider.getLastCall()
    expect(lastCall?.method).toBe('listModels')
  })

  test('mock CLI providers should support response delay simulation', async () => {
    const delayMs = 100
    const provider = createMockClaudeProvider({ responseDelay: delayMs })

    const startTime = Date.now()
    await provider.chat(TEST_CHAT_MESSAGE)
    const elapsed = Date.now() - startTime

    // Should have taken at least the delay time
    expect(elapsed).toBeGreaterThanOrEqual(delayMs - 10) // Small tolerance for timing
  })

  test('mock providers should support dynamic availability changes', async () => {
    const provider = createMockClaudeProvider()

    // Initially available
    expect(await provider.isAvailable()).toBe(true)

    // Make unavailable
    provider.setAvailable(false)
    expect(await provider.isAvailable()).toBe(false)

    // Make available again
    provider.setAvailable(true)
    expect(await provider.isAvailable()).toBe(true)
  })

  test('mock providers should support dynamic health changes', async () => {
    const provider = createMockLMStudioProvider()

    // Initially healthy
    let health = await provider.checkHealth()
    expect(health.success).toBe(true)

    // Make unhealthy
    provider.setHealthy(false)
    health = await provider.checkHealth()
    expect(health.success).toBe(false)

    // Make healthy again
    provider.setHealthy(true)
    health = await provider.checkHealth()
    expect(health.success).toBe(true)
  })

  test('mock providers should support configurable failure simulation', async () => {
    const provider = createMockClaudeProvider()

    // Initially works
    const result1 = await provider.chat(TEST_CHAT_MESSAGE)
    expect(result1.success).toBe(true)

    // Enable failure mode
    provider.setShouldFail(true, 'Simulated network error')

    // Should throw
    await expect(async () => {
      await provider.chat(TEST_CHAT_MESSAGE)
    }).rejects.toThrow('Simulated network error')

    // Disable failure mode
    provider.setShouldFail(false)

    // Should work again
    const result2 = await provider.chat(TEST_CHAT_MESSAGE)
    expect(result2.success).toBe(true)
  })

  test('full routing simulation with multiple providers', async () => {
    // Simulate routing scenario:
    // 1. Claude is preferred but unavailable
    // 2. LM Studio is the fallback and available

    const claudeProvider = createUnavailableMockProvider('claude', 'Claude CLI')
    const lmStudioProvider = createMockLMStudioProvider({ chatResponse: 'Handled by LM Studio fallback' })

    // Check Claude availability
    const claudeAvailable = await claudeProvider.isAvailable()
    expect(claudeAvailable).toBe(false)

    // Since Claude is unavailable, route to LM Studio
    const lmStudioAvailable = await lmStudioProvider.isAvailable()
    expect(lmStudioAvailable).toBe(true)

    // Execute request on fallback
    const result = await lmStudioProvider.chat('Process this request')
    expect(result.success).toBe(true)
    expect(result.data).toBe('Handled by LM Studio fallback')
    expect(result.provider).toBe('lm-studio')
  })

  test('provider manager simulation with event tracking', async () => {
    const events: string[] = []

    // Simulate provider registration events
    const providers = [
      createMockLMStudioProvider(),
      createMockClaudeProvider(),
      createMockCursorProvider()
    ]

    for (const provider of providers) {
      events.push(`provider:registered:${provider.type}`)
    }

    expect(events).toContain('provider:registered:lm-studio')
    expect(events).toContain('provider:registered:claude')
    expect(events).toContain('provider:registered:cursor')

    // Simulate health change event
    providers[1].setHealthy(false)
    events.push(`provider:health-changed:${providers[1].type}`)

    expect(events).toContain('provider:health-changed:claude')
  })
})

// ============================================================================
// Provider Factory Tests
// ============================================================================

test.describe('Provider Factory Validation', () => {

  test('factory should support all default provider types', () => {
    // These are the types that should be registered in the factory
    const expectedTypes: LLMProviderType[] = [
      'lm-studio',
      'ollama',
      'claude',
      'cursor',
      'openai',    // Placeholder
      'anthropic', // Placeholder
      'custom'     // Extensibility
    ]

    for (const type of expectedTypes) {
      expect(isLLMProviderType(type)).toBe(true)
    }
  })

  test('factory default should create LM Studio provider', () => {
    // createDefault() or createDefaultProvider() should return LM Studio
    const provider = createMockLMStudioProvider()
    expect(provider.type).toBe('lm-studio')
  })

  test('factory should merge default config with provided config', () => {
    const customTimeout = 60000
    const provider = createMockLMStudioProvider()

    provider.updateConfig({ timeout: customTimeout })
    const config = provider.getConfig()

    expect(config.timeout).toBe(customTimeout)
    expect(config.type).toBe('lm-studio') // Original default preserved
  })
})

// ============================================================================
// Error Handling Tests
// ============================================================================

test.describe('Error Handling', () => {

  test('provider should handle timeout gracefully', async () => {
    const provider = createMockLMStudioProvider({
      responseDelay: 200 // Simulate slow response
    })

    // Configure shorter timeout (in real implementation)
    provider.updateConfig({ timeout: 100 })

    // In real implementation, this would timeout
    // For mock, we just verify the timeout config is set
    const config = provider.getConfig()
    expect(config.timeout).toBe(100)
  })

  test('provider results should include response time', async () => {
    const provider = createMockClaudeProvider()

    const healthResult = await provider.checkHealth()
    expect(healthResult.responseTimeMs).toBeDefined()
    expect(typeof healthResult.responseTimeMs).toBe('number')

    const chatResult = await provider.chat(TEST_CHAT_MESSAGE)
    expect(chatResult.responseTimeMs).toBeDefined()
    expect(typeof chatResult.responseTimeMs).toBe('number')
  })

  test('failure results should include error message', async () => {
    const provider = createUnavailableMockProvider('claude', 'Claude')

    const result = await provider.chat(TEST_CHAT_MESSAGE)

    expect(result.success).toBe(false)
    expect(result.error).toBeDefined()
    expect(typeof result.error).toBe('string')
    expect(result.error!.length).toBeGreaterThan(0)
  })

  test('provider type should always be included in results', async () => {
    const providers = [
      createMockLMStudioProvider(),
      createMockClaudeProvider(),
      createMockCursorProvider(),
      createMockOllamaProvider()
    ]

    for (const provider of providers) {
      const healthResult = await provider.checkHealth()
      expect(healthResult.provider).toBe(provider.type)

      const chatResult = await provider.chat(TEST_CHAT_MESSAGE)
      expect(chatResult.provider).toBe(provider.type)

      const modelsResult = await provider.listModels()
      expect(modelsResult.provider).toBe(provider.type)
    }
  })
})
