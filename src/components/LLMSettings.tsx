/**
 * LLM Settings Component
 *
 * Displays and allows modification of LLM (Large Language Model) settings.
 * Supports multiple providers: LM Studio (default), Claude CLI, and Cursor CLI.
 * Shows provider availability status based on detection results.
 * Persists provider preference across sessions.
 */

import { useState, useEffect, useCallback } from 'react'
import { cn } from '@/lib/utils'
import {
  Brain,
  Server,
  RefreshCw,
  AlertCircle,
  CheckCircle,
  XCircle,
  Loader2,
  ExternalLink,
  Terminal,
  Zap,
  Info,
  Filter
} from 'lucide-react'

// ============================================================================
// Types
// ============================================================================

type LLMProviderType = 'lm-studio' | 'ollama' | 'claude' | 'cursor' | 'openai' | 'anthropic' | 'custom'

// Claude model types for Claude CLI
type ClaudeModelType = 'haiku' | 'sonnet' | 'opus'

// Cursor model types for Cursor CLI
type CursorModelType =
  | 'auto'
  | 'composer-1'
  | 'claude-sonnet-4.5'
  | 'claude-sonnet-4.5-thinking'
  | 'claude-opus-4.5'
  | 'claude-opus-4.5-thinking'
  | 'claude-opus-4.1'
  | 'gemini-3-pro'
  | 'gemini-3-flash'
  | 'gpt-5.2'
  | 'gpt-5.1'
  | 'gpt-5.2-high'
  | 'gpt-5.1-high'
  | 'gpt-5.1-codex'
  | 'gpt-5.1-codex-high'
  | 'gpt-5.1-codex-max'
  | 'gpt-5.1-codex-max-high'
  | 'grok'

// Note Generation Mode types
type NoteGenerationMode = 'strict' | 'balanced' | 'loose'

interface ClaudeModelOption {
  id: ClaudeModelType
  name: string
}

interface CursorModelOption {
  id: CursorModelType
  name: string
  isThinking?: boolean
  isRecommended?: boolean
}

interface NoteGenerationModeOption {
  id: NoteGenerationMode
  name: string
  description: string
  example: string
}

// Claude model options
const CLAUDE_MODELS: ClaudeModelOption[] = [
  { id: 'haiku', name: 'Haiku' },
  { id: 'sonnet', name: 'Sonnet' },
  { id: 'opus', name: 'Opus' }
]

// Note Generation Mode options
const NOTE_GENERATION_MODES: NoteGenerationModeOption[] = [
  {
    id: 'strict',
    name: 'Strict (Default)',
    description: 'Only highly important, in-scope content. Strictest action item criteria, minimal context.',
    example: 'Best for focused meetings where only critical decisions and tasks matter.'
  },
  {
    id: 'balanced',
    name: 'Balanced',
    description: 'Important + moderately relevant content. Relaxed action item criteria, moderate context.',
    example: 'Good for general meetings where both key points and supporting details are useful.'
  },
  {
    id: 'loose',
    name: 'Loose',
    description: 'All potentially useful content. Flexible action item criteria, extensive context.',
    example: 'Ideal for exploratory discussions where capturing the full picture is important.'
  }
]

// Cursor model options
const CURSOR_MODELS: CursorModelOption[] = [
  { id: 'auto', name: 'Auto (Recommended)', isRecommended: true },
  { id: 'composer-1', name: 'Composer 1' },
  { id: 'claude-sonnet-4.5', name: 'Claude Sonnet 4.5' },
  { id: 'claude-sonnet-4.5-thinking', name: 'Claude Sonnet 4.5 (Thinking)', isThinking: true },
  { id: 'claude-opus-4.5', name: 'Claude Opus 4.5' },
  { id: 'claude-opus-4.5-thinking', name: 'Claude Opus 4.5 (Thinking)', isThinking: true },
  { id: 'claude-opus-4.1', name: 'Claude Opus 4.1' },
  { id: 'gemini-3-pro', name: 'Gemini 3 Pro' },
  { id: 'gemini-3-flash', name: 'Gemini 3 Flash' },
  { id: 'gpt-5.2', name: 'GPT-5.2' },
  { id: 'gpt-5.1', name: 'GPT-5.1' },
  { id: 'gpt-5.2-high', name: 'GPT-5.2 High' },
  { id: 'gpt-5.1-high', name: 'GPT-5.1 High' },
  { id: 'gpt-5.1-codex', name: 'GPT-5.1 Codex' },
  { id: 'gpt-5.1-codex-high', name: 'GPT-5.1 Codex High' },
  { id: 'gpt-5.1-codex-max', name: 'GPT-5.1 Codex Max' },
  { id: 'gpt-5.1-codex-max-high', name: 'GPT-5.1 Codex Max High' },
  { id: 'grok', name: 'Grok' }
]

interface LLMSettingsProps {
  className?: string
  onSettingsChange?: (settings: LLMSettingsState) => void
}

interface LLMSettingsState {
  provider: string
  lmStudioUrl: string
  model: string
  claudeModel?: ClaudeModelType
  cursorModel?: CursorModelType
  noteGenerationMode?: NoteGenerationMode
}

interface ConnectionStatus {
  isConnected: boolean
  isChecking: boolean
  error: string | null
  lastChecked: Date | null
  availableModels: string[]
}

interface ProviderInfo {
  id: LLMProviderType
  name: string
  description: string
  icon: React.ReactNode
  available: boolean
  error?: string
  isCliTool: boolean
  responseTimeMs?: number
}

// ============================================================================
// Default Provider Info
// ============================================================================

const DEFAULT_PROVIDERS: Omit<ProviderInfo, 'available' | 'error' | 'responseTimeMs'>[] = [
  {
    id: 'lm-studio',
    name: 'LM Studio',
    description: 'Local LLM server - Run models locally with full privacy',
    icon: <Server className="h-4 w-4" />,
    isCliTool: false
  },
  {
    id: 'claude',
    name: 'Claude CLI',
    description: 'Anthropic Claude via CLI - Requires authentication',
    icon: <Terminal className="h-4 w-4" />,
    isCliTool: true
  },
  {
    id: 'cursor',
    name: 'Cursor CLI',
    description: 'Cursor AI via CLI - Requires Cursor installation',
    icon: <Zap className="h-4 w-4" />,
    isCliTool: true
  }
]

// ============================================================================
// Main LLMSettings Component
// ============================================================================

export function LLMSettings({ className, onSettingsChange }: LLMSettingsProps) {
  // Settings state
  const [lmStudioUrl, setLmStudioUrl] = useState<string>('http://localhost:1234')
  const [provider, setProvider] = useState<LLMProviderType>('lm-studio')
  const [model, setModel] = useState<string>('default')
  const [claudeModel, setClaudeModel] = useState<ClaudeModelType>('opus')
  const [cursorModel, setCursorModel] = useState<CursorModelType>('auto')
  const [noteGenerationMode, setNoteGenerationMode] = useState<NoteGenerationMode>('strict')

  // UI state
  const [isLoading, setIsLoading] = useState(true)
  const [isSaving, setIsSaving] = useState(false)
  const [saveSuccess, setSaveSuccess] = useState(false)
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Provider detection state
  const [providers, setProviders] = useState<ProviderInfo[]>(
    DEFAULT_PROVIDERS.map(p => ({ ...p, available: false }))
  )
  const [isDetecting, setIsDetecting] = useState(false)
  const [activeProvider, setActiveProvider] = useState<LLMProviderType | null>(null)
  const [lastDetectionTime, setLastDetectionTime] = useState<Date | null>(null)

  // Connection status for LM Studio URL testing
  const [connectionStatus, setConnectionStatus] = useState<ConnectionStatus>({
    isConnected: false,
    isChecking: false,
    error: null,
    lastChecked: null,
    availableModels: []
  })

  // Detect available providers
  const detectProviders = useCallback(async () => {
    setIsDetecting(true)
    try {
      const result = await window.electronAPI.llmProvider.detectProviders({
        providers: ['lm-studio', 'claude', 'cursor'],
        timeoutMs: 5000,
        parallel: true
      })

      const detectedProviders = DEFAULT_PROVIDERS.map(defaultProvider => {
        const detected = result.providers.find(p => p.provider === defaultProvider.id)
        return {
          ...defaultProvider,
          available: detected?.available ?? false,
          error: detected?.error,
          responseTimeMs: detected?.responseTimeMs
        }
      })

      setProviders(detectedProviders)
      setLastDetectionTime(new Date())

      // Set the recommended primary as active if no provider is set
      if (result.recommendedPrimary && !activeProvider) {
        setActiveProvider(result.recommendedPrimary)
      }
    } catch (err) {
      console.error('Failed to detect providers:', err)
      setError(err instanceof Error ? err.message : 'Failed to detect providers')
    } finally {
      setIsDetecting(false)
    }
  }, [activeProvider])

  // Load saved settings on mount
  useEffect(() => {
    const loadSettings = async () => {
      setIsLoading(true)
      try {
        const [savedUrl, savedProvider, savedModel, savedClaudeModel, savedCursorModel, savedNoteMode] = await Promise.all([
          window.electronAPI.db.settings.get<string>('ai.lmStudioUrl'),
          window.electronAPI.db.settings.get<string>('ai.provider'),
          window.electronAPI.db.settings.get<string>('ai.model'),
          window.electronAPI.db.settings.get<string>('ai.claudeModel'),
          window.electronAPI.db.settings.get<string>('ai.cursorModel'),
          window.electronAPI.db.settings.get<string>('ai.noteGenerationMode')
        ])

        if (savedUrl) setLmStudioUrl(savedUrl)
        if (savedProvider) {
          setProvider(savedProvider as LLMProviderType)
          setActiveProvider(savedProvider as LLMProviderType)
        }
        if (savedModel) setModel(savedModel)
        if (savedClaudeModel) setClaudeModel(savedClaudeModel as ClaudeModelType)
        if (savedCursorModel) setCursorModel(savedCursorModel as CursorModelType)
        if (savedNoteMode) setNoteGenerationMode(savedNoteMode as NoteGenerationMode)

        // Detect providers after loading settings
        await detectProviders()
      } catch (err) {
        console.error('Failed to load LLM settings:', err)
        setError(err instanceof Error ? err.message : 'Failed to load settings')
      } finally {
        setIsLoading(false)
      }
    }
    loadSettings()
  }, []) // detectProviders is intentionally not in deps to prevent re-running

  // Test connection to LM Studio
  const testConnection = useCallback(async () => {
    setConnectionStatus(prev => ({
      ...prev,
      isChecking: true,
      error: null
    }))

    try {
      // Try to fetch models from LM Studio API
      const response = await fetch(`${lmStudioUrl}/v1/models`, {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json'
        }
      })

      if (response.ok) {
        const data = await response.json()
        const models = data.data?.map((m: { id: string }) => m.id) || []
        setConnectionStatus({
          isConnected: true,
          isChecking: false,
          error: null,
          lastChecked: new Date(),
          availableModels: models
        })
      } else {
        setConnectionStatus({
          isConnected: false,
          isChecking: false,
          error: `Server returned status ${response.status}`,
          lastChecked: new Date(),
          availableModels: []
        })
      }
    } catch (err) {
      setConnectionStatus({
        isConnected: false,
        isChecking: false,
        error: err instanceof Error ? err.message : 'Connection failed',
        lastChecked: new Date(),
        availableModels: []
      })
    }
  }, [lmStudioUrl])

  // Handle URL change
  const handleUrlChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    setLmStudioUrl(e.target.value)
    setHasUnsavedChanges(true)
    setSaveSuccess(false)
    // Reset connection status when URL changes
    setConnectionStatus(prev => ({
      ...prev,
      isConnected: false,
      error: null
    }))
  }, [])

  // Handle provider selection
  const handleProviderSelect = useCallback((providerId: LLMProviderType) => {
    setProvider(providerId)
    setActiveProvider(providerId)
    setHasUnsavedChanges(true)
    setSaveSuccess(false)
  }, [])

  // Handle model change
  const handleModelChange = useCallback((e: React.ChangeEvent<HTMLSelectElement>) => {
    setModel(e.target.value)
    setHasUnsavedChanges(true)
    setSaveSuccess(false)
  }, [])

  // Handle Claude model change
  const handleClaudeModelChange = useCallback((modelId: ClaudeModelType) => {
    setClaudeModel(modelId)
    setHasUnsavedChanges(true)
    setSaveSuccess(false)
  }, [])

  // Handle Cursor model change
  const handleCursorModelChange = useCallback((modelId: CursorModelType) => {
    setCursorModel(modelId)
    setHasUnsavedChanges(true)
    setSaveSuccess(false)
  }, [])

  // Handle Note Generation Mode change
  const handleNoteGenerationModeChange = useCallback((mode: NoteGenerationMode) => {
    setNoteGenerationMode(mode)
    setHasUnsavedChanges(true)
    setSaveSuccess(false)
  }, [])

  // Save settings
  const handleSaveSettings = useCallback(async () => {
    setIsSaving(true)
    setSaveSuccess(false)
    setError(null)

    try {
      await Promise.all([
        window.electronAPI.db.settings.set('ai.lmStudioUrl', lmStudioUrl, 'ai'),
        window.electronAPI.db.settings.set('ai.provider', provider, 'ai'),
        window.electronAPI.db.settings.set('ai.model', model, 'ai'),
        window.electronAPI.db.settings.set('ai.claudeModel', claudeModel, 'ai'),
        window.electronAPI.db.settings.set('ai.cursorModel', cursorModel, 'ai'),
        window.electronAPI.db.settings.set('ai.noteGenerationMode', noteGenerationMode, 'ai')
      ])

      // Also update the provider manager default
      await window.electronAPI.llmProvider.setDefaultProvider(provider)

      setHasUnsavedChanges(false)
      setSaveSuccess(true)

      // Notify parent component
      onSettingsChange?.({ provider, lmStudioUrl, model, claudeModel, cursorModel, noteGenerationMode })

      // Clear success message after 3 seconds
      setTimeout(() => setSaveSuccess(false), 3000)
    } catch (err) {
      console.error('Failed to save LLM settings:', err)
      setError(err instanceof Error ? err.message : 'Failed to save settings')
    } finally {
      setIsSaving(false)
    }
  }, [lmStudioUrl, provider, model, claudeModel, cursorModel, noteGenerationMode, onSettingsChange])

  // Get the currently selected provider info
  const selectedProviderInfo = providers.find(p => p.id === provider)

  if (isLoading) {
    return (
      <div className={cn('space-y-6', className)}>
        <div className="flex items-center gap-2 px-3 py-2 bg-secondary/50 rounded-md">
          <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
          <span className="text-sm text-muted-foreground">Loading LLM settings...</span>
        </div>
      </div>
    )
  }

  return (
    <div className={cn('space-y-6', className)} data-testid="llm-settings">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Brain className="h-5 w-5 text-purple-600" />
          <h3 className="font-semibold text-foreground">LLM Settings</h3>
        </div>
        <div className="flex items-center gap-2">
          {lastDetectionTime && (
            <span className="text-xs text-muted-foreground">
              Last checked: {lastDetectionTime.toLocaleTimeString()}
            </span>
          )}
          <button
            onClick={detectProviders}
            disabled={isDetecting}
            className={cn(
              'p-1.5 rounded-md hover:bg-secondary transition-colors',
              isDetecting && 'opacity-50 cursor-not-allowed'
            )}
            title="Refresh provider availability"
            data-testid="refresh-providers-button"
          >
            <RefreshCw className={cn(
              'h-4 w-4 text-muted-foreground',
              isDetecting && 'animate-spin'
            )} />
          </button>
        </div>
      </div>

      {/* Error message */}
      {error && (
        <div className="flex items-start gap-2 p-3 bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-800 rounded-lg">
          <XCircle className="h-5 w-5 text-red-600 dark:text-red-400 mt-0.5 flex-shrink-0" />
          <div className="text-sm text-red-700 dark:text-red-300">
            <p className="font-medium">Error</p>
            <p>{error}</p>
          </div>
        </div>
      )}

      {/* Success message */}
      {saveSuccess && (
        <div className="flex items-center gap-2 p-3 bg-green-50 dark:bg-green-950/30 border border-green-200 dark:border-green-800 rounded-lg" data-testid="llm-save-success">
          <CheckCircle className="h-5 w-5 text-green-600 dark:text-green-400" />
          <span className="text-sm text-green-700 dark:text-green-300 font-medium">
            LLM settings saved successfully
          </span>
        </div>
      )}

      {/* Provider Selection Cards */}
      <div className="space-y-3">
        <div className="flex items-center gap-2">
          <Server className="h-4 w-4 text-muted-foreground" />
          <label className="text-sm font-medium text-foreground">
            Select AI Provider
          </label>
        </div>
        <div className="grid gap-3" data-testid="provider-selection">
          {providers.map((providerInfo) => (
            <button
              key={providerInfo.id}
              onClick={() => handleProviderSelect(providerInfo.id)}
              disabled={!providerInfo.available}
              className={cn(
                'relative flex items-start gap-3 p-4 rounded-lg border-2 text-left transition-all',
                provider === providerInfo.id
                  ? 'border-purple-500 bg-purple-50/50 dark:bg-purple-950/20'
                  : 'border-border hover:border-purple-300 dark:hover:border-purple-700',
                !providerInfo.available && 'opacity-60 cursor-not-allowed hover:border-border'
              )}
              data-testid={`provider-card-${providerInfo.id}`}
            >
              {/* Selection indicator */}
              {provider === providerInfo.id && (
                <div className="absolute top-2 right-2">
                  <CheckCircle className="h-5 w-5 text-purple-600" />
                </div>
              )}

              {/* Provider icon */}
              <div className={cn(
                'flex-shrink-0 w-10 h-10 rounded-lg flex items-center justify-center',
                providerInfo.available
                  ? 'bg-purple-100 dark:bg-purple-900/30 text-purple-600'
                  : 'bg-gray-100 dark:bg-gray-800 text-gray-400'
              )}>
                {providerInfo.icon}
              </div>

              {/* Provider info */}
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="font-medium text-foreground">{providerInfo.name}</span>
                  {providerInfo.id === 'lm-studio' && (
                    <span className="px-1.5 py-0.5 text-xs font-medium bg-purple-100 dark:bg-purple-900/30 text-purple-700 dark:text-purple-300 rounded">
                      Default
                    </span>
                  )}
                  {providerInfo.isCliTool && (
                    <span className="px-1.5 py-0.5 text-xs font-medium bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-300 rounded">
                      CLI
                    </span>
                  )}
                </div>
                <p className="text-xs text-muted-foreground mt-0.5">{providerInfo.description}</p>

                {/* Availability status */}
                <div className="flex items-center gap-2 mt-2">
                  {providerInfo.available ? (
                    <span className="inline-flex items-center gap-1 text-xs text-green-600 dark:text-green-400">
                      <CheckCircle className="h-3 w-3" />
                      Available
                      {providerInfo.responseTimeMs && (
                        <span className="text-muted-foreground">
                          ({providerInfo.responseTimeMs}ms)
                        </span>
                      )}
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1 text-xs text-gray-500">
                      <XCircle className="h-3 w-3" />
                      Not available
                    </span>
                  )}
                </div>

                {/* Error message for unavailable providers */}
                {!providerInfo.available && providerInfo.error && (
                  <p className="text-xs text-amber-600 dark:text-amber-400 mt-1">
                    {providerInfo.error}
                  </p>
                )}
              </div>
            </button>
          ))}
        </div>
      </div>

      {/* LM Studio URL Configuration */}
      {provider === 'lm-studio' && (
        <div className="space-y-3 p-4 bg-secondary/30 rounded-lg">
          <div className="flex items-start justify-between">
            <div>
              <label className="block text-sm font-medium text-foreground">
                LM Studio Server URL
              </label>
              <p className="text-xs text-muted-foreground">
                The URL where LM Studio server is running
              </p>
            </div>
            {connectionStatus.isConnected ? (
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-green-50 dark:bg-green-950/30 text-green-700 dark:text-green-300 border border-green-200 dark:border-green-800">
                <CheckCircle className="h-3 w-3" />
                Connected
              </span>
            ) : connectionStatus.error ? (
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-red-50 dark:bg-red-950/30 text-red-700 dark:text-red-300 border border-red-200 dark:border-red-800">
                <XCircle className="h-3 w-3" />
                Not Connected
              </span>
            ) : null}
          </div>

          <div className="flex gap-2">
            <input
              type="url"
              value={lmStudioUrl}
              onChange={handleUrlChange}
              placeholder="http://localhost:1234"
              className={cn(
                'flex-1 px-3 py-2 bg-background border border-border rounded-md text-sm',
                'focus:outline-none focus:ring-2 focus:ring-purple-500 focus:border-transparent',
                connectionStatus.error && 'border-red-300 dark:border-red-700'
              )}
              data-testid="lm-studio-url-input"
            />
            <button
              onClick={testConnection}
              disabled={connectionStatus.isChecking}
              className={cn(
                'px-3 py-2 bg-secondary hover:bg-accent rounded-md transition-colors',
                connectionStatus.isChecking && 'opacity-50 cursor-not-allowed'
              )}
              title="Test connection"
              data-testid="test-connection-button"
            >
              {connectionStatus.isChecking ? (
                <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
              ) : (
                <RefreshCw className="h-4 w-4 text-muted-foreground" />
              )}
            </button>
          </div>

          {/* Connection error message */}
          {connectionStatus.error && (
            <div className="flex items-start gap-2 p-2 bg-yellow-50 dark:bg-yellow-950/30 border border-yellow-200 dark:border-yellow-800 rounded-md">
              <AlertCircle className="h-4 w-4 text-yellow-600 dark:text-yellow-400 mt-0.5 flex-shrink-0" />
              <div className="text-xs text-yellow-700 dark:text-yellow-300">
                <p className="font-medium">Connection failed</p>
                <p>{connectionStatus.error}</p>
                <p className="mt-1">Make sure LM Studio is running and the server is started.</p>
              </div>
            </div>
          )}

          {/* Available models */}
          {connectionStatus.isConnected && connectionStatus.availableModels.length > 0 && (
            <div className="space-y-2">
              <label className="block text-sm font-medium text-foreground">
                Available Models
              </label>
              <select
                value={model}
                onChange={handleModelChange}
                className={cn(
                  'w-full px-3 py-2 bg-background border border-border rounded-md text-sm',
                  'focus:outline-none focus:ring-2 focus:ring-purple-500 focus:border-transparent'
                )}
                data-testid="model-select"
              >
                <option value="default">Default Model</option>
                {connectionStatus.availableModels.map((modelId) => (
                  <option key={modelId} value={modelId}>
                    {modelId}
                  </option>
                ))}
              </select>
            </div>
          )}
        </div>
      )}

      {/* Claude Model Selection */}
      {provider === 'claude' && selectedProviderInfo && (
        <div className="space-y-4 p-4 bg-secondary/30 rounded-lg">
          {/* Header with badge */}
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Brain className="h-4 w-4 text-purple-600" />
              <span className="font-medium text-foreground">Claude Model</span>
            </div>
            <span className="px-2 py-0.5 text-xs font-medium bg-purple-100 dark:bg-purple-900/30 text-purple-700 dark:text-purple-300 rounded border border-purple-200 dark:border-purple-700">
              Native SDK
            </span>
          </div>

          {/* Model selection - segmented control style */}
          <div className="flex rounded-lg overflow-hidden border border-border" data-testid="claude-model-selector">
            {CLAUDE_MODELS.map((modelOption, index) => (
              <button
                key={modelOption.id}
                onClick={() => handleClaudeModelChange(modelOption.id)}
                className={cn(
                  'flex-1 px-4 py-2.5 text-sm font-medium transition-all',
                  claudeModel === modelOption.id
                    ? 'bg-purple-600 text-white'
                    : 'bg-background hover:bg-secondary text-foreground',
                  index !== 0 && 'border-l border-border'
                )}
                data-testid={`claude-model-${modelOption.id}`}
              >
                {modelOption.name}
              </button>
            ))}
          </div>

          {/* Info text */}
          <div className="flex items-start gap-2">
            <Info className="h-4 w-4 text-blue-600 dark:text-blue-400 mt-0.5 flex-shrink-0" />
            <div className="text-xs text-muted-foreground">
              <p>Claude CLI uses your existing Anthropic authentication. Ensure you have run "claude login" in your terminal.</p>
              {!selectedProviderInfo.available && (
                <p className="text-amber-600 dark:text-amber-400 mt-2">
                  Claude CLI not detected. Install it from https://claude.ai/cli or authenticate with "claude login".
                </p>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Cursor Model Selection */}
      {provider === 'cursor' && selectedProviderInfo && (
        <div className="space-y-4 p-4 bg-secondary/30 rounded-lg">
          {/* Header with badge */}
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Zap className="h-4 w-4 text-purple-600" />
              <span className="font-medium text-foreground">Cursor Model</span>
            </div>
            <span className="px-2 py-0.5 text-xs font-medium bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-300 rounded border border-gray-200 dark:border-gray-700">
              CLI
            </span>
          </div>

          {/* Model selection - vertical list style */}
          <div className="max-h-80 overflow-y-auto rounded-lg border border-border" data-testid="cursor-model-selector">
            {CURSOR_MODELS.map((modelOption) => (
              <button
                key={modelOption.id}
                onClick={() => handleCursorModelChange(modelOption.id)}
                className={cn(
                  'w-full flex items-center justify-between px-4 py-3 text-sm text-left transition-all border-b border-border last:border-b-0',
                  cursorModel === modelOption.id
                    ? 'bg-purple-600 text-white'
                    : 'bg-background hover:bg-secondary text-foreground'
                )}
                data-testid={`cursor-model-${modelOption.id}`}
              >
                <span className="font-medium">{modelOption.name}</span>
                {modelOption.isThinking && (
                  <span className={cn(
                    'px-2 py-0.5 text-xs font-medium rounded',
                    cursorModel === modelOption.id
                      ? 'bg-white/20 text-white'
                      : 'bg-orange-100 dark:bg-orange-900/30 text-orange-700 dark:text-orange-300 border border-orange-200 dark:border-orange-700'
                  )}>
                    Thinking
                  </span>
                )}
              </button>
            ))}
          </div>

          {/* Info text */}
          <div className="flex items-start gap-2">
            <Info className="h-4 w-4 text-blue-600 dark:text-blue-400 mt-0.5 flex-shrink-0" />
            <div className="text-xs text-muted-foreground">
              <p>Cursor CLI uses your Cursor application credentials. Ensure Cursor is installed and you are logged in.</p>
              {!selectedProviderInfo.available && (
                <p className="text-amber-600 dark:text-amber-400 mt-2">
                  Cursor CLI not detected. Install Cursor from https://cursor.sh and ensure it is in your PATH.
                </p>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Note Generation Mode Selection */}
      <div className="space-y-4 p-4 bg-secondary/30 rounded-lg">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Filter className="h-4 w-4 text-purple-600" />
            <span className="font-medium text-foreground">Note Generation Mode</span>
          </div>
          <span className="px-2 py-0.5 text-xs font-medium bg-purple-100 dark:bg-purple-900/30 text-purple-700 dark:text-purple-300 rounded border border-purple-200 dark:border-purple-700">
            AI Settings
          </span>
        </div>

        {/* Info text */}
        <div className="flex items-start gap-2">
          <Info className="h-4 w-4 text-blue-600 dark:text-blue-400 mt-0.5 flex-shrink-0" />
          <p className="text-xs text-muted-foreground">
            Controls how aggressively out-of-scope content is filtered when generating meeting notes.
          </p>
        </div>

        {/* Mode selection - vertical list style */}
        <div className="space-y-2" data-testid="note-generation-mode-selector">
          {NOTE_GENERATION_MODES.map((modeOption) => (
            <button
              key={modeOption.id}
              onClick={() => handleNoteGenerationModeChange(modeOption.id)}
              className={cn(
                'w-full flex flex-col items-start px-4 py-3 text-sm text-left transition-all rounded-lg border-2',
                noteGenerationMode === modeOption.id
                  ? 'bg-purple-600 text-white border-purple-600'
                  : 'bg-background hover:bg-secondary text-foreground border-border'
              )}
              data-testid={`note-mode-${modeOption.id}`}
            >
              <span className="font-medium mb-1">{modeOption.name}</span>
              <span className={cn(
                'text-xs mb-2',
                noteGenerationMode === modeOption.id
                  ? 'text-white/90'
                  : 'text-muted-foreground'
              )}>
                {modeOption.description}
              </span>
              <span className={cn(
                'text-xs italic',
                noteGenerationMode === modeOption.id
                  ? 'text-white/75'
                  : 'text-muted-foreground/75'
              )}>
                {modeOption.example}
              </span>
            </button>
          ))}
        </div>
      </div>

      {/* Fallback Behavior Info */}
      <div className="flex items-start gap-2 p-3 bg-blue-50 dark:bg-blue-950/30 border border-blue-200 dark:border-blue-800 rounded-lg">
        <AlertCircle className="h-4 w-4 text-blue-600 dark:text-blue-400 mt-0.5 flex-shrink-0" />
        <div className="text-xs text-blue-800 dark:text-blue-200">
          <p className="font-medium">Fallback Behavior</p>
          <p className="mt-1">
            If the selected provider is unavailable, the system will automatically try other available providers in priority order: LM Studio → Claude CLI → Cursor CLI.
          </p>
        </div>
      </div>

      {/* Current Settings Summary */}
      <div className="p-4 bg-secondary/30 rounded-lg space-y-2">
        <h4 className="text-sm font-medium text-foreground">Active Configuration</h4>
        <div className="grid grid-cols-2 gap-4 text-sm">
          <div>
            <span className="text-muted-foreground">Provider: </span>
            <span className="font-medium text-foreground">
              {selectedProviderInfo?.name || provider}
            </span>
          </div>
          <div>
            <span className="text-muted-foreground">Status: </span>
            <span className={cn(
              'font-medium',
              selectedProviderInfo?.available ? 'text-green-600 dark:text-green-400' : 'text-amber-600 dark:text-amber-400'
            )}>
              {selectedProviderInfo?.available ? 'Ready' : 'Unavailable'}
            </span>
          </div>
          {provider === 'lm-studio' && (
            <>
              <div>
                <span className="text-muted-foreground">Model: </span>
                <span className="font-medium text-foreground">
                  {model || 'Default'}
                </span>
              </div>
              <div>
                <span className="text-muted-foreground">Server: </span>
                <span className="font-medium text-foreground break-all text-xs">
                  {lmStudioUrl}
                </span>
              </div>
            </>
          )}
          {provider === 'claude' && (
            <div>
              <span className="text-muted-foreground">Model: </span>
              <span className="font-medium text-foreground">
                {CLAUDE_MODELS.find(m => m.id === claudeModel)?.name || claudeModel}
              </span>
            </div>
          )}
          {provider === 'cursor' && (
            <div>
              <span className="text-muted-foreground">Model: </span>
              <span className="font-medium text-foreground">
                {CURSOR_MODELS.find(m => m.id === cursorModel)?.name || cursorModel}
              </span>
            </div>
          )}
        </div>
      </div>

      {/* Save Button */}
      <div className="flex items-center justify-between pt-2 border-t border-border">
        <a
          href="https://lmstudio.ai/"
          target="_blank"
          rel="noopener noreferrer"
          className="text-xs text-purple-600 hover:text-purple-700 dark:text-purple-400 dark:hover:text-purple-300 flex items-center gap-1"
        >
          <ExternalLink className="h-3 w-3" />
          Download LM Studio
        </a>
        <button
          onClick={handleSaveSettings}
          disabled={!hasUnsavedChanges || isSaving}
          className={cn(
            'px-4 py-2 bg-purple-600 hover:bg-purple-700 text-white rounded-md text-sm font-medium',
            'flex items-center gap-2 transition-colors',
            (!hasUnsavedChanges || isSaving) && 'opacity-50 cursor-not-allowed'
          )}
          data-testid="save-llm-settings-button"
        >
          {isSaving ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin" />
              Saving...
            </>
          ) : (
            <>
              <CheckCircle className="h-4 w-4" />
              Save Settings
            </>
          )}
        </button>
      </div>
    </div>
  )
}

export default LLMSettings

// Export types for use in other components
export type { ClaudeModelType, CursorModelType, LLMSettingsState }
export { CLAUDE_MODELS, CURSOR_MODELS }
