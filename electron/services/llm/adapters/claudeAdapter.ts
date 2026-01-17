/**
 * Claude CLI Adapter
 *
 * Implements the ILLMProvider interface for the Claude CLI.
 * This adapter detects the `claude` binary in PATH and verifies authentication
 * by checking the ~/.claude/ directory. Commands are executed via system shell
 * without API keys or HTTP calls.
 *
 * The provider is silently ignored if:
 * - The claude binary is not found in PATH
 * - Authentication is not configured (~/.claude/ doesn't exist or is invalid)
 *
 * This follows AutoMaker's local authenticated tool pattern.
 */

import { spawn, execSync } from 'child_process'
import * as fs from 'fs'
import * as path from 'path'
import * as os from 'os'

import type {
  ILLMProvider,
  LLMProviderConfig,
  ClaudeProviderConfig,
  ChatCompletionParams,
  ProviderHealthResult,
  ProviderModelsResult,
  ProviderChatResult,
  ProviderSimpleChatResult
} from '../llmProviderInterface'

import type {
  HealthStatus,
  LLMModel,
  ChatCompletionResponse,
  ChatMessage
} from '../../lm-studio-client'

// ============================================================================
// Default Configuration
// ============================================================================

const DEFAULT_CLAUDE_ADAPTER_CONFIG: ClaudeProviderConfig = {
  type: 'claude',
  name: 'Claude CLI',
  baseUrl: '', // Not used for CLI-based provider
  timeout: 120000, // 2 minutes - CLI can take a while
  retryAttempts: 1,
  retryDelayMs: 1000,
  defaultMaxTokens: 4096,
  defaultTemperature: 0.7,
  defaultModel: 'claude-sonnet-4-20250514'
}

// ============================================================================
// Types
// ============================================================================

interface ClaudeExecutionResult {
  code: number
  stdout: string
  stderr: string
  success: boolean
  error?: string
}

// ============================================================================
// Claude Adapter Implementation
// ============================================================================

/**
 * Adapter for Claude CLI
 *
 * Executes Claude commands via the system shell without requiring
 * API keys or HTTP calls. Uses local authentication from ~/.claude/
 */
export class ClaudeAdapter implements ILLMProvider {
  readonly type = 'claude' as const
  readonly name = 'Claude CLI'

  private config: ClaudeProviderConfig
  private binaryPath: string | null = null
  private isAuthenticatedCache: boolean | null = null
  private availabilityChecked: boolean = false
  private lastAvailabilityError: string | null = null

  /**
   * Create a new Claude CLI adapter
   * @param config Optional configuration override
   */
  constructor(config?: Partial<ClaudeProviderConfig>) {
    this.config = { ...DEFAULT_CLAUDE_ADAPTER_CONFIG, ...config }

    // Try to detect binary path on construction (but don't throw)
    this.binaryPath = this.detectClaudeBinary()

    if (this.binaryPath) {
      console.info(`[Claude Adapter] Initialized with binary at: ${this.binaryPath}`)
    } else {
      console.warn('[Claude Adapter] Binary not found during initialization. Claude CLI may not be installed.')
    }
  }

  // --------------------------------------------------------------------------
  // Binary & Authentication Detection
  // --------------------------------------------------------------------------

  /**
   * Detect the Claude CLI binary in PATH and common installation locations
   * @returns Path to claude binary or null if not found
   */
  private detectClaudeBinary(): string | null {
    // If explicitly configured, use that path
    if (this.config.binaryPath && fs.existsSync(this.config.binaryPath)) {
      return this.config.binaryPath
    }

    // Common installation paths for Claude CLI on different systems
    // Electron apps often have a minimal PATH that doesn't include these directories
    const commonPaths = [
      // Homebrew on Apple Silicon (most common for macOS)
      '/opt/homebrew/bin/claude',
      // Homebrew on Intel Mac
      '/usr/local/bin/claude',
      // npm global installs (default location)
      path.join(os.homedir(), '.npm-global', 'bin', 'claude'),
      // nvm-managed npm global installs
      path.join(os.homedir(), '.nvm', 'versions', 'node', '*', 'bin', 'claude'),
      // npm global on some systems
      '/usr/local/lib/node_modules/@anthropic-ai/claude-code/cli.js',
      // Windows npm global
      path.join(process.env.APPDATA || '', 'npm', 'claude.cmd'),
      // Windows npm global (without .cmd)
      path.join(process.env.APPDATA || '', 'npm', 'claude'),
    ]

    // First, check common installation paths directly
    for (const binaryPath of commonPaths) {
      // Handle glob patterns for nvm
      if (binaryPath.includes('*')) {
        try {
          const baseDir = binaryPath.substring(0, binaryPath.indexOf('*'))
          if (fs.existsSync(baseDir)) {
            const entries = fs.readdirSync(baseDir)
            for (const entry of entries) {
              const fullPath = binaryPath.replace('*', entry)
              if (fs.existsSync(fullPath)) {
                return fullPath
              }
            }
          }
        } catch {
          // Continue to next path
        }
      } else if (fs.existsSync(binaryPath)) {
        return binaryPath
      }
    }

    // Try to find claude in PATH as fallback (works when PATH is properly set)
    try {
      const command = process.platform === 'win32' ? 'where claude' : 'which claude'
      const claudePath = execSync(command, {
        encoding: 'utf8',
        timeout: 5000,
        stdio: ['pipe', 'pipe', 'pipe']
      }).trim()

      if (claudePath && fs.existsSync(claudePath.split('\n')[0])) {
        return claudePath.split('\n')[0]
      }
    } catch {
      // Silently ignore - binary not found in PATH
    }

    // Last resort: try to find using 'type' command with a shell that loads profile
    // This can help find binaries that are in PATH only after shell initialization
    if (process.platform !== 'win32') {
      try {
        const shell = process.env.SHELL || '/bin/bash'
        const claudePath = execSync(`${shell} -l -c 'which claude' 2>/dev/null`, {
          encoding: 'utf8',
          timeout: 10000,
          stdio: ['pipe', 'pipe', 'pipe']
        }).trim()

        if (claudePath && fs.existsSync(claudePath)) {
          return claudePath
        }
      } catch {
        // Silently ignore
      }
    }

    return null
  }

  /**
   * Get the path to the .claude directory
   */
  private getClaudeDir(): string {
    if (this.config.claudeDir) {
      return this.config.claudeDir
    }
    return path.join(os.homedir(), '.claude')
  }

  /**
   * Check if Claude CLI is authenticated
   * Verifies the ~/.claude/ directory exists and contains authentication config
   */
  private checkAuthentication(): boolean {
    if (this.isAuthenticatedCache !== null) {
      return this.isAuthenticatedCache
    }

    try {
      const claudeDir = this.getClaudeDir()

      // Check if .claude directory exists
      if (!fs.existsSync(claudeDir)) {
        this.isAuthenticatedCache = false
        return false
      }

      // Check for authentication indicators
      // The .claude directory should contain configuration files
      const dirStats = fs.statSync(claudeDir)
      if (!dirStats.isDirectory()) {
        this.isAuthenticatedCache = false
        return false
      }

      // Look for common auth config files
      const files = fs.readdirSync(claudeDir)

      // Consider authenticated if the directory has any config/credentials
      // Common files: credentials, config, settings.json, etc.
      const hasAuthFiles = files.some(file =>
        file.includes('credential') ||
        file.includes('config') ||
        file.includes('settings') ||
        file.includes('auth') ||
        file.endsWith('.json')
      )

      // Even if no specific auth files, if .claude exists with content, assume configured
      this.isAuthenticatedCache = files.length > 0 || hasAuthFiles
      if (!this.isAuthenticatedCache) {
        this.lastAvailabilityError = 'Claude CLI not authenticated. Run "claude login" in your terminal to authenticate.'
      }
      return this.isAuthenticatedCache
    } catch {
      // Silently ignore errors
      this.isAuthenticatedCache = false
      this.lastAvailabilityError = 'Claude CLI authentication check failed. Run "claude login" to authenticate.'
      return false
    }
  }

  /**
   * Get the last availability error message (useful for UI feedback)
   */
  getLastAvailabilityError(): string | null {
    return this.lastAvailabilityError
  }

  // --------------------------------------------------------------------------
  // Command Execution
  // --------------------------------------------------------------------------

  /**
   * Build an enhanced PATH that includes common installation directories
   * This helps the subprocess find dependencies even when the Electron app has a minimal PATH
   */
  private getEnhancedPath(): string {
    const currentPath = process.env.PATH || ''
    const additionalPaths = [
      '/opt/homebrew/bin',
      '/opt/homebrew/sbin',
      '/usr/local/bin',
      '/usr/local/sbin',
      path.join(os.homedir(), '.npm-global', 'bin'),
      path.join(os.homedir(), 'bin'),
      path.join(os.homedir(), '.local', 'bin'),
    ]

    // Add paths that don't already exist in PATH
    const pathSet = new Set(currentPath.split(':'))
    const newPaths = additionalPaths.filter(p => !pathSet.has(p))

    if (newPaths.length > 0) {
      return [...newPaths, currentPath].join(':')
    }
    return currentPath
  }

  /**
   * Execute a Claude CLI command
   * @param args Command arguments
   * @param input Optional stdin input
   * @param timeout Optional timeout in ms
   */
  private async executeClaudeCommand(
    args: string[],
    input?: string,
    timeout?: number
  ): Promise<ClaudeExecutionResult> {
    if (!this.binaryPath) {
      return {
        code: 1,
        stdout: '',
        stderr: 'Claude CLI binary not found in PATH',
        success: false,
        error: 'Claude CLI binary not found in PATH'
      }
    }

    return new Promise((resolve) => {
      const timeoutMs = timeout || this.config.timeout || 120000
      let stdout = ''
      let stderr = ''
      let timedOut = false

      // Build enhanced environment with additional PATH entries
      // This ensures the subprocess can find node and other dependencies
      const enhancedEnv = {
        ...process.env,
        PATH: this.getEnhancedPath()
      }

      // Log the command being executed (without full prompt for brevity)
      const argsForLog = args.map(arg => arg.length > 100 ? `${arg.substring(0, 100)}...[${arg.length} chars]` : arg)
      console.info(`[Claude Adapter] Executing: ${this.binaryPath} ${argsForLog.join(' ')}`)

      const proc = spawn(this.binaryPath!, args, {
        stdio: ['pipe', 'pipe', 'pipe'],
        env: enhancedEnv,
        timeout: timeoutMs
      })

      // Handle timeout
      const timeoutId = setTimeout(() => {
        timedOut = true
        console.warn(`[Claude Adapter] Command timed out after ${timeoutMs}ms`)
        proc.kill('SIGTERM')
      }, timeoutMs)

      proc.stdout?.on('data', (data: Buffer) => {
        stdout += data.toString()
      })

      proc.stderr?.on('data', (data: Buffer) => {
        const stderrData = data.toString()
        stderr += stderrData
        // Log stderr in real-time for debugging
        if (stderrData.trim()) {
          console.warn(`[Claude Adapter] stderr: ${stderrData.trim()}`)
        }
      })

      // Send input if provided, then close stdin
      if (input && proc.stdin) {
        console.info(`[Claude Adapter] Sending ${input.length} bytes via stdin`)
        proc.stdin.write(input)
        proc.stdin.end()
      } else if (proc.stdin) {
        // Always close stdin even if no input - prevents CLI from waiting for input
        proc.stdin.end()
      }

      proc.on('error', (error) => {
        clearTimeout(timeoutId)
        console.error(`[Claude Adapter] Process error: ${error.message}`)
        resolve({
          code: 1,
          stdout,
          stderr: error.message,
          success: false,
          error: error.message
        })
      })

      proc.on('exit', (code) => {
        clearTimeout(timeoutId)

        if (timedOut) {
          resolve({
            code: code ?? 124, // 124 is timeout exit code
            stdout,
            stderr: 'Command timed out',
            success: false,
            error: 'Command timed out'
          })
          return
        }

        console.info(`[Claude Adapter] Process exited with code ${code}, stdout length: ${stdout.length}, stderr length: ${stderr.length}`)

        resolve({
          code: code ?? 1,
          stdout,
          stderr,
          success: code === 0,
          error: code !== 0 ? stderr || `Process exited with code ${code}` : undefined
        })
      })
    })
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

    // Re-detect binary if path changed
    if ('binaryPath' in config) {
      this.binaryPath = this.detectClaudeBinary()
    }

    // Reset authentication cache if claudeDir changed
    if ('claudeDir' in config) {
      this.isAuthenticatedCache = null
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

    if (forceRefresh) {
      this.binaryPath = this.detectClaudeBinary()
      this.isAuthenticatedCache = null
      this.availabilityChecked = false
      this.lastAvailabilityError = null
    }

    // Check binary exists
    if (!this.binaryPath) {
      this.lastAvailabilityError = 'Claude CLI binary not found. Install with: npm install -g @anthropic-ai/claude-code'
      console.warn('[Claude Adapter] Binary not found. Searched common locations including /opt/homebrew/bin/claude and /usr/local/bin/claude')
      return {
        success: false,
        error: this.lastAvailabilityError,
        provider: 'claude',
        responseTimeMs: Date.now() - startTime
      }
    }

    console.info(`[Claude Adapter] Found Claude CLI at: ${this.binaryPath}`)

    // Check authentication
    if (!this.checkAuthentication()) {
      const error = this.lastAvailabilityError || 'Claude CLI not authenticated. Please run "claude login" first.'
      return {
        success: false,
        error,
        provider: 'claude',
        responseTimeMs: Date.now() - startTime
      }
    }

    // Try to get version as a health check
    try {
      const result = await this.executeClaudeCommand(['--version'], undefined, 10000)

      const healthData: HealthStatus = {
        healthy: result.success,
        responseTimeMs: Date.now() - startTime,
        serverVersion: result.success ? result.stdout.trim() : undefined
      }

      return {
        success: result.success,
        data: healthData,
        error: result.error,
        provider: 'claude',
        responseTimeMs: Date.now() - startTime
      }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error during health check',
        provider: 'claude',
        responseTimeMs: Date.now() - startTime
      }
    }
  }

  /**
   * Simple availability check
   * Returns false silently if binary is missing or not authenticated
   */
  async isAvailable(): Promise<boolean> {
    // Quick cached check
    if (this.availabilityChecked && this.binaryPath && this.isAuthenticatedCache) {
      return true
    }

    // If we've already determined availability is false, return early
    if (this.availabilityChecked && (!this.binaryPath || this.isAuthenticatedCache === false)) {
      return false
    }

    // Check binary exists
    if (!this.binaryPath) {
      this.binaryPath = this.detectClaudeBinary()
      if (!this.binaryPath) {
        this.lastAvailabilityError = 'Claude CLI binary not found in PATH'
        return false // Silently unavailable
      }
    }

    // Check authentication
    if (!this.checkAuthentication()) {
      // lastAvailabilityError is set by checkAuthentication if auth fails
      if (!this.lastAvailabilityError) {
        this.lastAvailabilityError = 'Claude CLI not authenticated'
      }
      return false // Silently unavailable
    }

    this.availabilityChecked = true
    return true
  }

  // --------------------------------------------------------------------------
  // Model Methods
  // --------------------------------------------------------------------------

  /**
   * List available models from the provider
   * Claude CLI supports specific models
   */
  async listModels(): Promise<ProviderModelsResult> {
    const startTime = Date.now()

    if (!await this.isAvailable()) {
      return {
        success: false,
        error: 'Claude CLI not available',
        provider: 'claude',
        responseTimeMs: Date.now() - startTime
      }
    }

    // Claude CLI supports these models - return a predefined list
    // as the CLI doesn't have a "list models" command
    const models: LLMModel[] = [
      {
        id: 'claude-sonnet-4-20250514',
        object: 'model',
        ownedBy: 'anthropic',
        metadata: { description: 'Claude Sonnet 4 - Latest balanced model' }
      },
      {
        id: 'claude-3-5-sonnet-20241022',
        object: 'model',
        ownedBy: 'anthropic',
        metadata: { description: 'Claude 3.5 Sonnet - Fast and intelligent' }
      },
      {
        id: 'claude-3-opus-20240229',
        object: 'model',
        ownedBy: 'anthropic',
        metadata: { description: 'Claude 3 Opus - Most capable model' }
      },
      {
        id: 'claude-3-haiku-20240307',
        object: 'model',
        ownedBy: 'anthropic',
        metadata: { description: 'Claude 3 Haiku - Fastest model' }
      }
    ]

    return {
      success: true,
      data: models,
      provider: 'claude',
      responseTimeMs: Date.now() - startTime
    }
  }

  // --------------------------------------------------------------------------
  // Chat Completion Methods
  // --------------------------------------------------------------------------

  /**
   * Send a chat completion request via Claude CLI
   */
  async chatCompletion(params: ChatCompletionParams): Promise<ProviderChatResult> {
    const startTime = Date.now()

    if (!await this.isAvailable()) {
      return {
        success: false,
        error: 'Claude CLI not available',
        provider: 'claude',
        responseTimeMs: Date.now() - startTime
      }
    }

    try {
      // Build the prompt from messages
      const prompt = this.buildPromptFromMessages(params.messages)

      // Build CLI arguments
      // Use -p (print mode) for non-interactive single-prompt execution
      const args: string[] = ['-p']

      // Add model if specified
      const model = params.model || this.config.defaultModel
      if (model) {
        args.push('--model', model)
      }

      // Add explicit output format
      args.push('--output-format', 'text')

      // Note: Claude CLI does not support --max-tokens flag
      // The max tokens is controlled by the Claude API internally based on the model
      // If max token control is needed, consider using the Anthropic API directly

      // For large prompts (> 50KB), pass via stdin to avoid command-line argument limits
      // Otherwise, pass as argument for simplicity
      const promptSizeKB = Buffer.byteLength(prompt, 'utf8') / 1024
      const useStdin = promptSizeKB > 50

      console.info(`[Claude Adapter] chatCompletion: prompt size=${promptSizeKB.toFixed(2)}KB, useStdin=${useStdin}, model=${model}`)

      let result: ClaudeExecutionResult
      if (useStdin) {
        // Pass prompt via stdin for large prompts
        result = await this.executeClaudeCommand(args, prompt, this.config.timeout)
      } else {
        // Add the prompt as the last argument for smaller prompts
        args.push(prompt)
        result = await this.executeClaudeCommand(args, undefined, this.config.timeout)
      }

      if (!result.success) {
        return {
          success: false,
          error: result.error || 'Claude CLI command failed',
          provider: 'claude',
          responseTimeMs: Date.now() - startTime
        }
      }

      // Build response in ChatCompletionResponse format
      const response: ChatCompletionResponse = {
        id: `claude-${Date.now()}`,
        object: 'chat.completion',
        created: Math.floor(Date.now() / 1000),
        model: model || 'claude-sonnet-4-20250514',
        choices: [{
          index: 0,
          message: {
            role: 'assistant',
            content: result.stdout.trim()
          },
          finishReason: 'stop'
        }]
      }

      return {
        success: true,
        data: response,
        provider: 'claude',
        responseTimeMs: Date.now() - startTime
      }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error during chat completion',
        provider: 'claude',
        responseTimeMs: Date.now() - startTime
      }
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

    // Build messages array
    const messages: ChatMessage[] = []

    if (systemPrompt) {
      messages.push({ role: 'system', content: systemPrompt })
    }

    messages.push({ role: 'user', content: userMessage })

    // Call chatCompletion
    const result = await this.chatCompletion({
      messages,
      ...options
    })

    if (!result.success || !result.data) {
      return {
        success: false,
        error: result.error || 'No response data',
        provider: 'claude',
        responseTimeMs: Date.now() - startTime
      }
    }

    // Extract content from response
    const content = result.data.choices[0]?.message?.content || ''

    return {
      success: true,
      data: content,
      provider: 'claude',
      responseTimeMs: result.responseTimeMs || (Date.now() - startTime)
    }
  }

  /**
   * Build a prompt string from chat messages
   */
  private buildPromptFromMessages(messages: ChatMessage[]): string {
    // For Claude CLI, we build a single prompt from all messages
    const parts: string[] = []

    for (const message of messages) {
      switch (message.role) {
        case 'system':
          parts.push(`System: ${message.content}`)
          break
        case 'user':
          parts.push(`Human: ${message.content}`)
          break
        case 'assistant':
          parts.push(`Assistant: ${message.content}`)
          break
      }
    }

    // For the Claude CLI -p (print) mode, we just need the content
    // If there's a system prompt, include it
    const systemMessages = messages.filter(m => m.role === 'system')
    const userMessages = messages.filter(m => m.role === 'user')

    if (systemMessages.length > 0 && userMessages.length > 0) {
      // Combine system prompt and user message
      return `${systemMessages.map(m => m.content).join('\n')}\n\n${userMessages.map(m => m.content).join('\n')}`
    }

    // Just return the last user message for simple cases
    const lastUserMessage = messages.filter(m => m.role === 'user').pop()
    return lastUserMessage?.content || parts.join('\n\n')
  }

  // --------------------------------------------------------------------------
  // Lifecycle Methods
  // --------------------------------------------------------------------------

  /**
   * Reset provider state (clear caches, etc.)
   */
  reset(): void {
    this.binaryPath = null
    this.isAuthenticatedCache = null
    this.availabilityChecked = false
    this.lastAvailabilityError = null

    // Re-detect binary
    this.binaryPath = this.detectClaudeBinary()
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
 * Create a new Claude CLI adapter with the given configuration
 */
export function createClaudeAdapter(config?: Partial<ClaudeProviderConfig>): ClaudeAdapter {
  return new ClaudeAdapter(config)
}

// ============================================================================
// Default Export
// ============================================================================

export default ClaudeAdapter
