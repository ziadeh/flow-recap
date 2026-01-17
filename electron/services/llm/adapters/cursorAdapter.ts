/**
 * Cursor CLI Adapter
 *
 * Implements the ILLMProvider interface for the Cursor CLI.
 * This adapter detects the `cursor` or `cursor-agent` binary using multiple
 * detection strategies similar to the CliProvider pattern:
 * - Explicit configuration
 * - Common installation paths per platform
 * - PATH environment variable
 * - Shell profile loading for non-standard PATH setups
 * - Versions directory detection for cursor-agent installations
 * - Cursor IDE subcommand support (cursor agent)
 *
 * The provider is silently ignored if:
 * - The cursor binary is not found
 * - The Cursor IDE is not properly installed (cursor agent command fails)
 *
 * This follows AutoMaker's local authenticated tool pattern exactly.
 *
 * Note: The Cursor CLI requires the Cursor IDE application to be installed.
 * The CLI itself is just a launcher that communicates with the IDE. Without
 * the IDE installed, commands like 'cursor agent' will fail with:
 * "No Cursor IDE installation found"
 */

import { spawn, execSync } from 'child_process'
import * as fs from 'fs'
import * as path from 'path'
import * as os from 'os'

import type {
  ILLMProvider,
  LLMProviderConfig,
  CursorProviderConfig,
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

const DEFAULT_CURSOR_ADAPTER_CONFIG: CursorProviderConfig = {
  type: 'cursor',
  name: 'Cursor CLI',
  baseUrl: '', // Not used for CLI-based provider
  timeout: 120000, // 2 minutes - CLI can take a while
  retryAttempts: 1,
  retryDelayMs: 1000,
  defaultMaxTokens: 4096,
  defaultTemperature: 0.7,
  defaultModel: 'cursor-default'
}

// ============================================================================
// Cursor CLI Detection Paths
// ============================================================================

/**
 * Version data directory where cursor-agent stores versions
 * The install script creates versioned folders like:
 *   ~/.local/share/cursor-agent/versions/2025.12.17-996666f/cursor-agent
 */
const CURSOR_AGENT_VERSIONS_DIR = path.join(os.homedir(), '.local', 'share', 'cursor-agent', 'versions')

/**
 * Common installation paths for Cursor CLI binary on different platforms
 * These are checked in order of priority
 */
function getCursorCLIPaths(): string[] {
  const platform = process.platform
  const home = os.homedir()

  if (platform === 'darwin') {
    // macOS - cursor-agent and cursor binary locations
    return [
      // cursor-agent (standalone CLI)
      path.join(home, '.local', 'bin', 'cursor-agent'),
      '/usr/local/bin/cursor-agent',
      // cursor IDE binary that supports 'cursor agent' subcommand
      path.join(home, '.local', 'bin', 'cursor'),
      '/usr/local/bin/cursor',
      '/usr/bin/cursor',
      // Homebrew locations (Apple Silicon and Intel)
      '/opt/homebrew/bin/cursor-agent',
      '/opt/homebrew/bin/cursor',
    ]
  } else if (platform === 'win32') {
    // Windows
    const localAppData = process.env.LOCALAPPDATA || path.join(home, 'AppData', 'Local')
    const programFiles = process.env.ProgramFiles || 'C:\\Program Files'
    const programFilesX86 = process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)'
    const appData = process.env.APPDATA || path.join(home, 'AppData', 'Roaming')
    return [
      // cursor-agent
      path.join(localAppData, 'Programs', 'cursor-agent', 'cursor-agent.exe'),
      path.join(programFiles, 'cursor-agent', 'cursor-agent.exe'),
      // cursor IDE
      path.join(localAppData, 'Programs', 'Cursor', 'resources', 'app', 'bin', 'cursor.cmd'),
      path.join(localAppData, 'Programs', 'Cursor', 'Cursor.exe'),
      path.join(programFiles, 'Cursor', 'Cursor.exe'),
      path.join(programFilesX86, 'Cursor', 'Cursor.exe'),
      path.join(home, 'AppData', 'Local', 'cursor', 'Cursor.exe'),
      // npm global installs
      path.join(appData, 'npm', 'cursor-agent.cmd'),
      path.join(appData, 'npm', 'cursor-agent'),
    ]
  } else {
    // Linux
    return [
      // cursor-agent (standalone CLI) - most likely locations
      path.join(home, '.local', 'bin', 'cursor-agent'),
      '/usr/local/bin/cursor-agent',
      '/usr/bin/cursor-agent',
      // cursor IDE binary that supports 'cursor agent' subcommand
      path.join(home, '.local', 'bin', 'cursor'),
      '/usr/local/bin/cursor',
      '/usr/bin/cursor',
      '/opt/Cursor/cursor',
      '/opt/cursor/cursor',
      path.join(home, 'Applications', 'cursor.AppImage'),
      '/snap/bin/cursor',
    ]
  }
}

/**
 * Common installation paths for Cursor IDE application on different platforms
 * These are used to verify the IDE is installed (required for CLI to work)
 */
function getCursorIDEPaths(): string[] {
  const platform = process.platform
  const home = os.homedir()

  if (platform === 'darwin') {
    // macOS
    return [
      '/Applications/Cursor.app',
      path.join(home, 'Applications', 'Cursor.app'),
      '/Applications/Cursor.app/Contents/MacOS/Cursor'
    ]
  } else if (platform === 'win32') {
    // Windows
    const localAppData = process.env.LOCALAPPDATA || path.join(home, 'AppData', 'Local')
    const programFiles = process.env.ProgramFiles || 'C:\\Program Files'
    const programFilesX86 = process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)'
    return [
      path.join(localAppData, 'Programs', 'Cursor', 'Cursor.exe'),
      path.join(programFiles, 'Cursor', 'Cursor.exe'),
      path.join(programFilesX86, 'Cursor', 'Cursor.exe'),
      path.join(home, 'AppData', 'Local', 'cursor', 'Cursor.exe')
    ]
  } else {
    // Linux
    return [
      '/usr/bin/cursor',
      '/usr/local/bin/cursor',
      path.join(home, '.local', 'bin', 'cursor'),
      '/opt/Cursor/cursor',
      '/opt/cursor/cursor',
      path.join(home, 'Applications', 'cursor.AppImage'),
      '/snap/bin/cursor'
    ]
  }
}

// ============================================================================
// Types
// ============================================================================

interface CursorExecutionResult {
  code: number
  stdout: string
  stderr: string
  success: boolean
  error?: string
}

// ============================================================================
// Cursor Adapter Implementation
// ============================================================================

/**
 * Adapter for Cursor CLI
 *
 * Executes Cursor commands via the system shell without requiring
 * API keys or HTTP calls. Validates that both the CLI binary and the
 * Cursor IDE application are properly installed before allowing usage.
 * Silently fails if binary is not found or IDE is not installed.
 */
export class CursorAdapter implements ILLMProvider {
  readonly type = 'cursor' as const
  readonly name = 'Cursor CLI'

  private config: CursorProviderConfig
  private binaryPath: string | null = null
  private ideInstalled: boolean | null = null
  private availabilityChecked: boolean = false
  private lastAvailabilityError: string | null = null
  /** Whether to use 'cursor agent' subcommand (vs direct cursor-agent binary) */
  private useCursorAgentSubcommand: boolean = false

  /**
   * Create a new Cursor CLI adapter
   * @param config Optional configuration override
   */
  constructor(config?: Partial<CursorProviderConfig>) {
    this.config = { ...DEFAULT_CURSOR_ADAPTER_CONFIG, ...config }

    // Try to detect binary path on construction (but don't throw)
    this.binaryPath = this.detectCursorBinary()

    if (this.binaryPath) {
      console.info(`[Cursor Adapter] Initialized with binary at: ${this.binaryPath}${this.useCursorAgentSubcommand ? ' (using agent subcommand)' : ''}`)
    } else {
      console.warn('[Cursor Adapter] Binary not found during initialization. Cursor CLI may not be installed.')
    }
  }

  // --------------------------------------------------------------------------
  // Binary Detection
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
    const separator = process.platform === 'win32' ? ';' : ':'
    const pathSet = new Set(currentPath.split(separator))
    const newPaths = additionalPaths.filter(p => !pathSet.has(p))

    if (newPaths.length > 0) {
      return [...newPaths, currentPath].join(separator)
    }
    return currentPath
  }

  /**
   * Detect the Cursor CLI binary using multiple detection strategies
   * Strategy order:
   * 1. Explicit configuration (binaryPath)
   * 2. Common installation paths (cursor-agent and cursor)
   * 3. Versions directory for cursor-agent installations
   * 4. PATH environment variable (which/where)
   * 5. Shell profile loading for non-standard PATH setups
   *
   * @returns Path to cursor binary or null if not found
   */
  private detectCursorBinary(): string | null {
    // Reset subcommand flag
    this.useCursorAgentSubcommand = false

    // 1. If explicitly configured, use that path
    if (this.config.binaryPath && fs.existsSync(this.config.binaryPath)) {
      // Check if this is cursor (not cursor-agent) and verify agent subcommand works
      if (this.config.binaryPath.includes('cursor') && !this.config.binaryPath.includes('cursor-agent')) {
        if (this.verifyCursorAgentSubcommand(this.config.binaryPath)) {
          this.useCursorAgentSubcommand = true
        }
      }
      return this.config.binaryPath
    }

    // 2. Check common installation paths for cursor-agent and cursor
    const cliPaths = getCursorCLIPaths()
    for (const cliPath of cliPaths) {
      if (fs.existsSync(cliPath)) {
        // Prefer cursor-agent over cursor
        if (cliPath.includes('cursor-agent')) {
          return cliPath
        }
        // For cursor binary, verify 'cursor agent' subcommand works
        if (this.verifyCursorAgentSubcommand(cliPath)) {
          this.useCursorAgentSubcommand = true
          return cliPath
        }
      }
    }

    // 3. Check versions directory for cursor-agent installations (Linux/macOS only)
    if (process.platform !== 'win32') {
      const versionsBinary = this.findCursorAgentInVersionsDir()
      if (versionsBinary) {
        return versionsBinary
      }
    }

    // 4. Try to find cursor-agent or cursor in PATH
    const pathBinary = this.findCursorInPath()
    if (pathBinary) {
      return pathBinary
    }

    // 5. Last resort: try using shell profile loading (for non-standard PATH setups)
    if (process.platform !== 'win32') {
      const shellBinary = this.findCursorViaShellProfile()
      if (shellBinary) {
        return shellBinary
      }
    }

    return null
  }

  /**
   * Find cursor-agent in the versions directory
   * This handles cases where cursor-agent is installed via the official installer
   * but not symlinked to PATH
   */
  private findCursorAgentInVersionsDir(): string | null {
    if (!fs.existsSync(CURSOR_AGENT_VERSIONS_DIR)) {
      return null
    }

    try {
      const versions = fs
        .readdirSync(CURSOR_AGENT_VERSIONS_DIR)
        .filter((v) => !v.startsWith('.'))
        .sort()
        .reverse() // Most recent first

      for (const version of versions) {
        const versionPath = path.join(CURSOR_AGENT_VERSIONS_DIR, version, 'cursor-agent')
        if (fs.existsSync(versionPath)) {
          console.info(`[Cursor Adapter] Found cursor-agent version ${version} at: ${versionPath}`)
          return versionPath
        }
      }
    } catch {
      // Ignore directory read errors
    }

    return null
  }

  /**
   * Find cursor-agent or cursor in PATH using which/where commands
   */
  private findCursorInPath(): string | null {
    const binaries = ['cursor-agent', 'cursor']

    for (const binary of binaries) {
      try {
        const command = process.platform === 'win32' ? `where ${binary}` : `which ${binary}`
        const result = execSync(command, {
          encoding: 'utf8',
          timeout: 5000,
          stdio: ['pipe', 'pipe', 'pipe']
        }).trim()

        const binaryPath = result.split('\n')[0]
        if (binaryPath && fs.existsSync(binaryPath)) {
          if (binary === 'cursor-agent') {
            return binaryPath
          }
          // For cursor binary, verify 'cursor agent' subcommand works
          if (this.verifyCursorAgentSubcommand(binaryPath)) {
            this.useCursorAgentSubcommand = true
            return binaryPath
          }
        }
      } catch {
        // Silently ignore - binary not found in PATH
      }
    }

    return null
  }

  /**
   * Find cursor using shell profile loading
   * This helps find binaries that are in PATH only after shell initialization
   * (e.g., when added via ~/.bashrc, ~/.zshrc, etc.)
   */
  private findCursorViaShellProfile(): string | null {
    const binaries = ['cursor-agent', 'cursor']

    for (const binary of binaries) {
      try {
        const shell = process.env.SHELL || '/bin/bash'
        const result = execSync(`${shell} -l -c 'which ${binary}' 2>/dev/null`, {
          encoding: 'utf8',
          timeout: 10000,
          stdio: ['pipe', 'pipe', 'pipe']
        }).trim()

        if (result && fs.existsSync(result)) {
          if (binary === 'cursor-agent') {
            console.info(`[Cursor Adapter] Found ${binary} via shell profile: ${result}`)
            return result
          }
          // For cursor binary, verify 'cursor agent' subcommand works
          if (this.verifyCursorAgentSubcommand(result)) {
            this.useCursorAgentSubcommand = true
            console.info(`[Cursor Adapter] Found ${binary} via shell profile: ${result} (using agent subcommand)`)
            return result
          }
        }
      } catch {
        // Silently ignore
      }
    }

    return null
  }

  /**
   * Verify that the cursor binary supports the 'cursor agent' subcommand
   * The Cursor IDE includes the agent as a subcommand: cursor agent
   */
  private verifyCursorAgentSubcommand(cursorPath: string): boolean {
    try {
      execSync(`"${cursorPath}" agent --version`, {
        encoding: 'utf8',
        timeout: 5000,
        stdio: ['pipe', 'pipe', 'pipe']
      })
      return true
    } catch {
      // cursor agent subcommand doesn't work
      return false
    }
  }

  /**
   * Detect if Cursor IDE application is installed
   * The CLI binary requires the IDE to be installed to function properly
   * @returns True if Cursor IDE is installed, false otherwise
   */
  private detectCursorIDE(): boolean {
    // Check common installation paths
    const idePaths = getCursorIDEPaths()
    for (const idePath of idePaths) {
      if (fs.existsSync(idePath)) {
        return true
      }
    }

    // On macOS, also check using mdfind (Spotlight)
    if (process.platform === 'darwin') {
      try {
        const result = execSync('mdfind "kMDItemKind == Application && kMDItemFSName == Cursor.app"', {
          encoding: 'utf8',
          timeout: 5000,
          stdio: ['pipe', 'pipe', 'pipe']
        }).trim()
        if (result && result.length > 0) {
          return true
        }
      } catch {
        // Silently ignore mdfind errors
      }
    }

    // Try running a simple cursor command to verify IDE is installed
    // This is a fallback check - if the above paths don't find it,
    // the actual command execution might still work if IDE is installed elsewhere
    if (this.binaryPath) {
      try {
        // Try to run cursor --version which should work if IDE is installed
        execSync(`"${this.binaryPath}" --version`, {
          encoding: 'utf8',
          timeout: 10000,
          stdio: ['pipe', 'pipe', 'pipe']
        })
        return true
      } catch (error) {
        // Check if the error message indicates IDE is not installed
        const errorMessage = error instanceof Error ? error.message : String(error)
        if (errorMessage.includes('No Cursor IDE installation found') ||
            errorMessage.includes('Cursor IDE') ||
            errorMessage.includes('install Cursor')) {
          this.lastAvailabilityError = 'Cursor IDE is not installed. Please install Cursor from https://cursor.com/download'
          return false
        }
        // Other errors might mean the command exists but had a different issue
        // We'll be conservative and assume it might work
        return true
      }
    }

    return false
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
   * Execute a Cursor CLI command
   *
   * Handles both cursor-agent binary and cursor with agent subcommand.
   * Uses enhanced PATH to ensure dependencies can be found even when
   * the Electron app has a minimal PATH.
   *
   * @param args Command arguments
   * @param input Optional stdin input
   * @param timeout Optional timeout in ms
   */
  private async executeCursorCommand(
    args: string[],
    input?: string,
    timeout?: number
  ): Promise<CursorExecutionResult> {
    if (!this.binaryPath) {
      return {
        code: 1,
        stdout: '',
        stderr: 'Cursor CLI binary not found',
        success: false,
        error: 'Cursor CLI binary not found. Install Cursor from https://cursor.com/download'
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

      // If using cursor with agent subcommand, prepend 'agent' to args
      const finalArgs = this.useCursorAgentSubcommand ? ['agent', ...args] : args

      // Log the command being executed (without full prompt for brevity)
      const argsForLog = finalArgs.map(arg => arg.length > 100 ? `${arg.substring(0, 100)}...[${arg.length} chars]` : arg)
      console.info(`[Cursor Adapter] Executing: ${this.binaryPath} ${argsForLog.join(' ')}`)

      const proc = spawn(this.binaryPath!, finalArgs, {
        stdio: ['pipe', 'pipe', 'pipe'],
        env: enhancedEnv,
        timeout: timeoutMs
      })

      // Handle timeout
      const timeoutId = setTimeout(() => {
        timedOut = true
        console.warn(`[Cursor Adapter] Command timed out after ${timeoutMs}ms`)
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
          console.warn(`[Cursor Adapter] stderr: ${stderrData.trim()}`)
        }
      })

      // Send input if provided, then close stdin
      if (input && proc.stdin) {
        console.info(`[Cursor Adapter] Sending ${input.length} bytes via stdin`)
        proc.stdin.write(input)
        proc.stdin.end()
      } else if (proc.stdin) {
        // Always close stdin even if no input - prevents CLI from waiting for input
        proc.stdin.end()
      }

      proc.on('error', (error) => {
        clearTimeout(timeoutId)
        console.error(`[Cursor Adapter] Process error: ${error.message}`)
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

        console.info(`[Cursor Adapter] Process exited with code ${code}, stdout length: ${stdout.length}, stderr length: ${stderr.length}`)

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
    this.config = { ...this.config, ...config } as CursorProviderConfig

    // Re-detect binary if path changed
    if ('binaryPath' in config) {
      this.binaryPath = this.detectCursorBinary()
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
      this.binaryPath = this.detectCursorBinary()
      this.ideInstalled = null
      this.availabilityChecked = false
      this.lastAvailabilityError = null
    }

    // Check binary exists
    if (!this.binaryPath) {
      this.lastAvailabilityError = 'Cursor CLI binary not found. Searched common locations including ~/.local/bin/cursor-agent and versions directory. Install Cursor from https://cursor.com/download'
      console.warn('[Cursor Adapter] Binary not found. Searched: common installation paths, versions directory, PATH, and shell profile.')
      return {
        success: false,
        error: this.lastAvailabilityError,
        provider: 'cursor',
        responseTimeMs: Date.now() - startTime
      }
    }

    console.info(`[Cursor Adapter] Found Cursor CLI at: ${this.binaryPath}${this.useCursorAgentSubcommand ? ' (using agent subcommand)' : ''}`)

    // Check IDE is installed
    if (this.ideInstalled === null) {
      this.ideInstalled = this.detectCursorIDE()
    }

    if (!this.ideInstalled) {
      const error = this.lastAvailabilityError || 'Cursor IDE is not installed. Please install Cursor from https://cursor.com/download'
      return {
        success: false,
        error,
        provider: 'cursor',
        responseTimeMs: Date.now() - startTime
      }
    }

    // Try to get version as a health check
    try {
      const result = await this.executeCursorCommand(['--version'], undefined, 10000)

      // Check if the result indicates IDE is not installed
      if (!result.success && result.stderr) {
        if (result.stderr.includes('No Cursor IDE installation found') ||
            result.stderr.includes('install Cursor')) {
          this.ideInstalled = false
          this.lastAvailabilityError = 'Cursor IDE is not installed. Please install Cursor from https://cursor.com/download'
          return {
            success: false,
            error: this.lastAvailabilityError,
            provider: 'cursor',
            responseTimeMs: Date.now() - startTime
          }
        }
      }

      const healthData: HealthStatus = {
        healthy: result.success,
        responseTimeMs: Date.now() - startTime,
        serverVersion: result.success ? result.stdout.trim() : undefined
      }

      return {
        success: result.success,
        data: healthData,
        error: result.error,
        provider: 'cursor',
        responseTimeMs: Date.now() - startTime
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error during health check'

      // Check if error indicates IDE not installed
      if (errorMessage.includes('No Cursor IDE installation found') ||
          errorMessage.includes('install Cursor')) {
        this.ideInstalled = false
        this.lastAvailabilityError = 'Cursor IDE is not installed. Please install Cursor from https://cursor.com/download'
      }

      return {
        success: false,
        error: this.lastAvailabilityError || errorMessage,
        provider: 'cursor',
        responseTimeMs: Date.now() - startTime
      }
    }
  }

  /**
   * Simple availability check
   * Returns false silently if binary is missing or IDE is not installed
   */
  async isAvailable(): Promise<boolean> {
    // Quick cached check - must have both binary and IDE installed
    if (this.availabilityChecked && this.binaryPath && this.ideInstalled === true) {
      return true
    }

    // If we've already determined availability is false, return early
    if (this.availabilityChecked && (this.ideInstalled === false || !this.binaryPath)) {
      return false
    }

    // Check binary exists
    if (!this.binaryPath) {
      this.binaryPath = this.detectCursorBinary()
      if (!this.binaryPath) {
        this.lastAvailabilityError = 'Cursor CLI binary not found in PATH'
        return false // Silently unavailable
      }
    }

    // Check IDE is installed (only if not already checked)
    if (this.ideInstalled === null) {
      this.ideInstalled = this.detectCursorIDE()
      if (!this.ideInstalled) {
        // lastAvailabilityError is set by detectCursorIDE if IDE not found
        if (!this.lastAvailabilityError) {
          this.lastAvailabilityError = 'Cursor IDE is not installed'
        }
        return false // Silently unavailable - IDE not installed
      }
    }

    if (!this.ideInstalled) {
      return false
    }

    this.availabilityChecked = true
    return true
  }

  // --------------------------------------------------------------------------
  // Model Methods
  // --------------------------------------------------------------------------

  /**
   * List available models from the provider
   * Cursor CLI supports specific models
   */
  async listModels(): Promise<ProviderModelsResult> {
    const startTime = Date.now()

    if (!await this.isAvailable()) {
      return {
        success: false,
        error: 'Cursor CLI not available',
        provider: 'cursor',
        responseTimeMs: Date.now() - startTime
      }
    }

    // Cursor CLI supports these models - return a predefined list
    // as the CLI doesn't have a "list models" command
    const models: LLMModel[] = [
      {
        id: 'cursor-default',
        object: 'model',
        ownedBy: 'cursor',
        metadata: { description: 'Cursor Default Model' }
      }
    ]

    return {
      success: true,
      data: models,
      provider: 'cursor',
      responseTimeMs: Date.now() - startTime
    }
  }

  // --------------------------------------------------------------------------
  // Chat Completion Methods
  // --------------------------------------------------------------------------

  /**
   * Send a chat completion request via Cursor CLI
   */
  async chatCompletion(params: ChatCompletionParams): Promise<ProviderChatResult> {
    const startTime = Date.now()

    if (!await this.isAvailable()) {
      return {
        success: false,
        error: 'Cursor CLI not available',
        provider: 'cursor',
        responseTimeMs: Date.now() - startTime
      }
    }

    try {
      // Build the prompt from messages
      const prompt = this.buildPromptFromMessages(params.messages)

      // Build CLI arguments
      // Note: Cursor CLI may have different argument patterns
      // This is a basic implementation that can be extended
      const args: string[] = []

      // Add the prompt as the last argument
      args.push(prompt)

      // Execute the command
      const result = await this.executeCursorCommand(args, undefined, this.config.timeout)

      if (!result.success) {
        return {
          success: false,
          error: result.error || 'Cursor CLI command failed',
          provider: 'cursor',
          responseTimeMs: Date.now() - startTime
        }
      }

      // Build response in ChatCompletionResponse format
      const model = params.model || this.config.defaultModel || 'cursor-default'
      const response: ChatCompletionResponse = {
        id: `cursor-${Date.now()}`,
        object: 'chat.completion',
        created: Math.floor(Date.now() / 1000),
        model,
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
        provider: 'cursor',
        responseTimeMs: Date.now() - startTime
      }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error during chat completion',
        provider: 'cursor',
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
        provider: 'cursor',
        responseTimeMs: Date.now() - startTime
      }
    }

    // Extract content from response
    const content = result.data.choices[0]?.message?.content || ''

    return {
      success: true,
      data: content,
      provider: 'cursor',
      responseTimeMs: result.responseTimeMs || (Date.now() - startTime)
    }
  }

  /**
   * Build a prompt string from chat messages
   */
  private buildPromptFromMessages(messages: ChatMessage[]): string {
    // For Cursor CLI, we build a single prompt from all messages
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
    this.ideInstalled = null
    this.availabilityChecked = false
    this.lastAvailabilityError = null
    this.useCursorAgentSubcommand = false

    // Re-detect binary
    this.binaryPath = this.detectCursorBinary()
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
 * Create a new Cursor CLI adapter with the given configuration
 */
export function createCursorAdapter(config?: Partial<CursorProviderConfig>): CursorAdapter {
  return new CursorAdapter(config)
}

// ============================================================================
// Default Export
// ============================================================================

export default CursorAdapter
