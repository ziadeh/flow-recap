/**
 * LLM Provider Adapters Index
 *
 * Central export point for all LLM provider adapters.
 * Each adapter implements the ILLMProvider interface and wraps
 * a specific LLM backend.
 */

// LM Studio Adapter (Default)
export {
  LMStudioAdapter,
  createLMStudioAdapter,
  defaultLMStudioAdapter
} from './lmStudioAdapter'

// Ollama Adapter
export {
  OllamaAdapter,
  createOllamaAdapter
} from './ollamaAdapter'

// Claude CLI Adapter
export {
  ClaudeAdapter,
  createClaudeAdapter
} from './claudeAdapter'

// Cursor CLI Adapter
export {
  CursorAdapter,
  createCursorAdapter
} from './cursorAdapter'

// Re-export adapter types
export type { LocalProviderConfig, ClaudeProviderConfig, CursorProviderConfig } from '../llmProviderInterface'
