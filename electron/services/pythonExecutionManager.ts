/**
 * Python Execution Manager Service
 *
 * Centralized service that intelligently routes Python script execution to the
 * correct environment based on operation type. Provides unified subprocess
 * management, health checking, and error recovery.
 *
 * Environment Mapping:
 * - Transcription operations (stream_transcribe.py, whisper-based) -> venv-whisperx
 * - Diarization operations (speaker_diarization.py, pyannote-based) -> venv-pyannote
 * - Utility scripts (download_models.py) -> either environment (prefer venv-whisperx)
 *
 * Key Features:
 * 1. Environment path resolution (bundled vs development, cross-platform)
 * 2. Health checking with validation caching
 * 3. Subprocess management with timeout and abort logic
 * 4. Error recovery with fallback environments
 * 5. Performance optimization through lazy loading and caching
 *
 * Usage:
 *   import { pythonExecutionManager } from './pythonExecutionManager'
 *
 *   // Execute a script with auto-routing
 *   const result = await pythonExecutionManager.execute('transcribe.py', ['audio.wav'])
 *
 *   // Get environment status
 *   const status = await pythonExecutionManager.getStatus()
 *
 *   // Repair environments
 *   const repairResult = await pythonExecutionManager.repair()
 */

import { spawn, ChildProcess, execSync } from 'child_process'
import * as path from 'path'
import * as fs from 'fs'
import { EventEmitter } from 'events'

// Electron app is imported dynamically to support testing outside Electron context
let app: { isPackaged?: boolean; getPath?: (name: string) => string } | undefined
try {
  app = require('electron').app
} catch {
  // Not running in Electron context (e.g., during tests)
  app = undefined
}

// ============================================================================
// Types
// ============================================================================

/** Operation types that determine which Python environment to use */
export type PythonOperationType = 'transcription' | 'diarization' | 'utility'

/** Environment types that can be detected */
export type PythonEnvironmentType = 'bundled' | 'dual-venv' | 'single-venv' | 'system' | 'none'

/** Status of a single Python environment */
export interface EnvironmentHealthStatus {
  /** Whether the environment is available and functional */
  healthy: boolean
  /** Path to the Python executable */
  pythonPath: string | null
  /** Python version if detected */
  version: string | null
  /** Last validation timestamp */
  lastValidated: number
  /** Errors encountered during validation */
  errors: string[]
  /** Key packages available */
  packages: {
    torch?: boolean
    whisperx?: boolean
    fasterWhisper?: boolean
    pyannote?: boolean
    speechbrain?: boolean
  }
  /** Torch version if available */
  torchVersion?: string
}

/** Overall status of all Python environments */
export interface PythonExecutionManagerStatus {
  /** Overall environment type detected */
  type: PythonEnvironmentType
  /** Whether at least one environment is ready */
  ready: boolean
  /** WhisperX environment health (for transcription) */
  whisperx: EnvironmentHealthStatus
  /** Pyannote environment health (for diarization) */
  pyannote: EnvironmentHealthStatus
  /** Platform information */
  platform: {
    os: string
    arch: string
    isAppleSilicon: boolean
  }
  /** Whether HuggingFace token is configured */
  hfTokenConfigured: boolean
  /** Recommendations for fixing issues */
  recommendations: string[]
}

/** Options for executing a Python script */
export interface ExecutionOptions {
  /** Arguments to pass to the script */
  args?: string[]
  /** Working directory */
  cwd?: string
  /** Additional environment variables */
  env?: Record<string, string>
  /** Timeout in milliseconds (default: 600000 = 10 minutes) */
  timeout?: number
  /** Callback for stdout data */
  onStdout?: (data: string) => void
  /** Callback for stderr data */
  onStderr?: (data: string) => void
  /** Callback for progress updates */
  onProgress?: (progress: number, message: string) => void
  /** Force a specific operation type (overrides auto-detection) */
  forceOperationType?: PythonOperationType
  /** Abort signal for cancellation */
  abortSignal?: AbortSignal
  /** Enable fallback to alternate environment on failure */
  enableFallback?: boolean
}

/** Result of executing a Python script */
export interface ExecutionResult {
  /** Whether execution was successful */
  success: boolean
  /** Exit code */
  code: number
  /** Standard output */
  stdout: string
  /** Standard error */
  stderr: string
  /** Error message if failed */
  error?: string
  /** Environment used for execution */
  environmentUsed: 'whisperx' | 'pyannote' | 'bundled' | 'system'
  /** Whether fallback was used */
  usedFallback: boolean
  /** Execution time in milliseconds */
  executionTimeMs: number
}

/** Result of repair operation */
export interface RepairResult {
  /** Whether repair was successful */
  success: boolean
  /** Actions taken during repair */
  actions: string[]
  /** Errors encountered */
  errors: string[]
  /** Recommendations for manual fixes */
  recommendations: string[]
}

/** Active process tracking */
interface ActiveProcess {
  process: ChildProcess
  jobId: string
  script: string
  startTime: number
  timeout: NodeJS.Timeout | null
}

// ============================================================================
// Constants
// ============================================================================

const DEFAULT_TIMEOUT = 600000 // 10 minutes
const VALIDATION_CACHE_TTL = 60000 // 1 minute
const KILL_GRACE_PERIOD = 5000 // 5 seconds before SIGKILL

// Script to environment mapping
const SCRIPT_ENVIRONMENT_MAP: Record<string, PythonOperationType> = {
  // Transcription scripts -> venv-whisperx
  'transcribe.py': 'transcription',
  'stream_transcribe.py': 'transcription',

  // Diarization scripts -> venv-pyannote
  'diarize.py': 'diarization',
  'speaker_diarization.py': 'diarization',
  'live_diarize.py': 'diarization',
  'core_diarization_engine.py': 'diarization',
  'diarization_audio_preprocessor.py': 'diarization',

  // Utility scripts -> prefer venv-whisperx
  'download_models.py': 'utility',
  'check_setup.py': 'utility',
  'audio_processor.py': 'utility',
}

// Bundle command mappings (for transcription_bundle entry point)
const BUNDLE_COMMAND_MAP: Record<string, string> = {
  'transcribe.py': 'transcribe',
  'diarize.py': 'diarize',
  'core_diarization_engine.py': 'core_diarize',
  'stream_transcribe.py': 'stream',
  'live_diarize.py': 'live_diarize',
  'check_setup.py': 'check',
}

// ============================================================================
// Python Execution Manager Service
// ============================================================================

class PythonExecutionManagerService extends EventEmitter {
  private cachedWhisperxStatus: EnvironmentHealthStatus | null = null
  private cachedPyannoteStatus: EnvironmentHealthStatus | null = null
  private cachedPythonPaths: Map<string, string | null> = new Map()
  private activeProcesses: Map<string, ActiveProcess> = new Map()
  private processCounter = 0

  // ============================================================================
  // Path Resolution
  // ============================================================================

  /**
   * Get the base directory for Python resources
   */
  private getResourcesDir(): string {
    if (app?.isPackaged) {
      return process.resourcesPath || ''
    }
    // In development, __dirname is dist-electron/services/
    return path.join(__dirname, '../..')
  }

  /**
   * Get the Python scripts directory
   */
  getPythonScriptsDir(): string {
    const resourcesDir = this.getResourcesDir()
    return path.join(resourcesDir, 'python')
  }

  /**
   * Get the Python executable path for a specific virtual environment
   */
  private getVenvPythonPath(venvName: string): string | null {
    const cacheKey = `venv:${venvName}`
    if (this.cachedPythonPaths.has(cacheKey)) {
      return this.cachedPythonPaths.get(cacheKey) ?? null
    }

    const pythonDir = this.getPythonScriptsDir()
    const venvPath = path.join(pythonDir, venvName)
    const pythonExe = process.platform === 'win32'
      ? path.join(venvPath, 'Scripts', 'python.exe')
      : path.join(venvPath, 'bin', 'python')

    const exists = fs.existsSync(pythonExe)
    this.cachedPythonPaths.set(cacheKey, exists ? pythonExe : null)
    return exists ? pythonExe : null
  }

  /**
   * Get the bundled Python executable path
   */
  private getBundledPythonPath(): string | null {
    const cacheKey = 'bundled'
    if (this.cachedPythonPaths.has(cacheKey)) {
      return this.cachedPythonPaths.get(cacheKey) ?? null
    }

    const pythonDir = this.getPythonScriptsDir()
    const bundleExe = process.platform === 'win32'
      ? path.join(pythonDir, 'transcription_bundle.exe')
      : path.join(pythonDir, 'transcription_bundle')

    if (fs.existsSync(bundleExe)) {
      this.cachedPythonPaths.set(cacheKey, bundleExe)
      return bundleExe
    }

    // Also check in _internal directory (PyInstaller structure)
    const internalBundleExe = process.platform === 'win32'
      ? path.join(pythonDir, '_internal', 'transcription_bundle.exe')
      : path.join(pythonDir, '_internal', 'transcription_bundle')

    const exists = fs.existsSync(internalBundleExe)
    this.cachedPythonPaths.set(cacheKey, exists ? internalBundleExe : null)
    return exists ? internalBundleExe : null
  }

  /**
   * Find system Python executable
   */
  private getSystemPythonPath(): string | null {
    const cacheKey = 'system'
    if (this.cachedPythonPaths.has(cacheKey)) {
      return this.cachedPythonPaths.get(cacheKey) ?? null
    }

    // Check environment variable
    if (process.env.PYTHON_PATH && fs.existsSync(process.env.PYTHON_PATH)) {
      this.cachedPythonPaths.set(cacheKey, process.env.PYTHON_PATH)
      return process.env.PYTHON_PATH
    }

    // Try to find python3 or python
    try {
      const cmd = process.platform === 'win32'
        ? 'where python'
        : 'which python3 2>/dev/null || which python 2>/dev/null'

      const pythonPath = execSync(cmd, {
        encoding: 'utf8',
        timeout: 5000,
      }).trim().split('\n')[0]

      if (pythonPath && fs.existsSync(pythonPath)) {
        this.cachedPythonPaths.set(cacheKey, pythonPath)
        return pythonPath
      }
    } catch {
      // Ignore errors
    }

    this.cachedPythonPaths.set(cacheKey, null)
    return null
  }

  /**
   * Get the best Python path for a specific operation type
   */
  getPythonPathForOperation(operation: PythonOperationType): string | null {
    // 1. Check for bundled Python (highest priority in packaged apps)
    const bundledPath = this.getBundledPythonPath()
    if (bundledPath) {
      return bundledPath
    }

    // 2. Get operation-specific venv
    if (operation === 'transcription' || operation === 'utility') {
      const whisperxPath = this.getVenvPythonPath('venv-whisperx')
      if (whisperxPath) {
        return whisperxPath
      }
    }

    if (operation === 'diarization') {
      const pyannotePath = this.getVenvPythonPath('venv-pyannote')
      if (pyannotePath) {
        return pyannotePath
      }
    }

    // 3. Try fallback venvs
    const fallbackVenvs = ['venv-3.12', 'venv']
    for (const venvName of fallbackVenvs) {
      const venvPath = this.getVenvPythonPath(venvName)
      if (venvPath) {
        console.warn(`[PythonExecMgr] Using fallback venv ${venvName} for ${operation}`)
        return venvPath
      }
    }

    // 4. Fall back to system Python
    const systemPath = this.getSystemPythonPath()
    if (systemPath) {
      console.warn(`[PythonExecMgr] Using system Python for ${operation}`)
      return systemPath
    }

    return null
  }

  /**
   * Detect the operation type from a script name
   */
  private detectOperationType(scriptName: string): PythonOperationType {
    // Normalize script name
    const normalized = path.basename(scriptName)
    return SCRIPT_ENVIRONMENT_MAP[normalized] || 'utility'
  }

  // ============================================================================
  // Health Checking
  // ============================================================================

  /**
   * Validate a single Python environment
   */
  private async validateEnvironment(
    pythonPath: string | null,
    purpose: 'whisperx' | 'pyannote'
  ): Promise<EnvironmentHealthStatus> {
    const status: EnvironmentHealthStatus = {
      healthy: false,
      pythonPath,
      version: null,
      lastValidated: Date.now(),
      errors: [],
      packages: {},
    }

    if (!pythonPath || !fs.existsSync(pythonPath)) {
      status.errors.push(`Python executable not found at: ${pythonPath || 'unknown'}`)
      return status
    }

    const execOptions = {
      encoding: 'utf8' as const,
      timeout: 30000,
      env: {
        ...process.env,
        PYTHONWARNINGS: 'ignore::UserWarning,ignore::DeprecationWarning,ignore::FutureWarning',
      },
    }

    try {
      // Get Python version
      const versionOutput = execSync(`"${pythonPath}" --version 2>&1`, execOptions)
      const versionMatch = versionOutput.match(/Python\s+(\d+\.\d+\.\d+)/)
      if (versionMatch) {
        status.version = versionMatch[1]
      }

      // Check torch version
      try {
        const torchVersion = execSync(
          `"${pythonPath}" -c "import torch; print(torch.__version__)" 2>&1`,
          execOptions
        ).trim()
        status.packages.torch = true
        status.torchVersion = torchVersion
      } catch {
        status.packages.torch = false
      }

      // Check purpose-specific packages
      if (purpose === 'whisperx') {
        try {
          execSync(`"${pythonPath}" -c "import whisperx" 2>&1`, execOptions)
          status.packages.whisperx = true
        } catch {
          status.packages.whisperx = false
        }

        try {
          execSync(`"${pythonPath}" -c "from faster_whisper import WhisperModel" 2>&1`, execOptions)
          status.packages.fasterWhisper = true
        } catch {
          status.packages.fasterWhisper = false
        }

        status.healthy = (status.packages.whisperx || status.packages.fasterWhisper) === true
        if (!status.healthy) {
          status.errors.push('No transcription backend available (whisperx or faster-whisper)')
        }
      } else {
        try {
          execSync(`"${pythonPath}" -c "from pyannote.audio import Pipeline" 2>&1`, execOptions)
          status.packages.pyannote = true
        } catch {
          status.packages.pyannote = false
        }

        try {
          execSync(`"${pythonPath}" -c "import speechbrain" 2>&1`, execOptions)
          status.packages.speechbrain = true
        } catch {
          status.packages.speechbrain = false
        }

        status.healthy = status.packages.pyannote === true
        if (!status.healthy) {
          status.errors.push('pyannote.audio not available for diarization')
        }
      }
    } catch (error) {
      status.errors.push(`Validation error: ${error instanceof Error ? error.message : String(error)}`)
    }

    return status
  }

  /**
   * Get cached or fresh validation status for WhisperX environment
   */
  private async getWhisperxStatus(forceRefresh = false): Promise<EnvironmentHealthStatus> {
    if (!forceRefresh && this.cachedWhisperxStatus &&
        Date.now() - this.cachedWhisperxStatus.lastValidated < VALIDATION_CACHE_TTL) {
      return this.cachedWhisperxStatus
    }

    const pythonPath = this.getBundledPythonPath() ||
                       this.getVenvPythonPath('venv-whisperx') ||
                       this.getVenvPythonPath('venv-3.12') ||
                       this.getVenvPythonPath('venv')

    this.cachedWhisperxStatus = await this.validateEnvironment(pythonPath, 'whisperx')
    return this.cachedWhisperxStatus
  }

  /**
   * Get cached or fresh validation status for Pyannote environment
   */
  private async getPyannoteStatus(forceRefresh = false): Promise<EnvironmentHealthStatus> {
    if (!forceRefresh && this.cachedPyannoteStatus &&
        Date.now() - this.cachedPyannoteStatus.lastValidated < VALIDATION_CACHE_TTL) {
      return this.cachedPyannoteStatus
    }

    const pythonPath = this.getBundledPythonPath() ||
                       this.getVenvPythonPath('venv-pyannote') ||
                       this.getVenvPythonPath('venv-3.12') ||
                       this.getVenvPythonPath('venv')

    this.cachedPyannoteStatus = await this.validateEnvironment(pythonPath, 'pyannote')
    return this.cachedPyannoteStatus
  }

  /**
   * Get the overall status of all Python environments
   */
  async getStatus(forceRefresh = false): Promise<PythonExecutionManagerStatus> {
    console.log('[PythonExecMgr] Getting environment status...')

    const [whisperxStatus, pyannoteStatus] = await Promise.all([
      this.getWhisperxStatus(forceRefresh),
      this.getPyannoteStatus(forceRefresh),
    ])

    // Determine environment type
    let type: PythonEnvironmentType = 'none'
    if (this.getBundledPythonPath()) {
      type = 'bundled'
    } else if (this.getVenvPythonPath('venv-whisperx') && this.getVenvPythonPath('venv-pyannote')) {
      type = 'dual-venv'
    } else if (this.getVenvPythonPath('venv-3.12') || this.getVenvPythonPath('venv')) {
      type = 'single-venv'
    } else if (this.getSystemPythonPath()) {
      type = 'system'
    }

    const recommendations: string[] = []

    if (!whisperxStatus.healthy) {
      recommendations.push('Install WhisperX: pip install whisperx faster-whisper')
    }
    if (!pyannoteStatus.healthy) {
      recommendations.push('Install Pyannote: pip install pyannote.audio speechbrain')
    }
    if (type === 'single-venv') {
      recommendations.push(
        'Consider creating separate environments to avoid torch version conflicts:',
        '  python3 -m venv python/venv-whisperx',
        '  python3 -m venv python/venv-pyannote'
      )
    }
    if (!this.isHuggingFaceTokenConfigured()) {
      recommendations.push('Configure HuggingFace token for pyannote models (Settings > Audio > HF Token)')
    }

    const status: PythonExecutionManagerStatus = {
      type,
      ready: whisperxStatus.healthy || pyannoteStatus.healthy,
      whisperx: whisperxStatus,
      pyannote: pyannoteStatus,
      platform: {
        os: process.platform,
        arch: process.arch,
        isAppleSilicon: process.platform === 'darwin' && process.arch === 'arm64',
      },
      hfTokenConfigured: this.isHuggingFaceTokenConfigured(),
      recommendations,
    }

    console.log(`[PythonExecMgr] Status: type=${type}, ready=${status.ready}`)
    return status
  }

  // ============================================================================
  // Subprocess Management
  // ============================================================================

  /**
   * Execute a Python script with intelligent environment routing
   */
  async execute(
    scriptName: string,
    options: ExecutionOptions = {}
  ): Promise<ExecutionResult> {
    const startTime = Date.now()
    const jobId = `job-${++this.processCounter}-${Date.now()}`

    // Determine operation type
    const operationType = options.forceOperationType || this.detectOperationType(scriptName)

    // Get Python path for operation
    let pythonPath = this.getPythonPathForOperation(operationType)
    const isBundled = pythonPath === this.getBundledPythonPath()

    if (!pythonPath) {
      return {
        success: false,
        code: 1,
        stdout: '',
        stderr: 'No Python environment available',
        error: 'No Python environment available',
        environmentUsed: 'system',
        usedFallback: false,
        executionTimeMs: Date.now() - startTime,
      }
    }

    // Determine environment used for logging
    let environmentUsed: ExecutionResult['environmentUsed'] = 'system'
    if (isBundled) {
      environmentUsed = 'bundled'
    } else if (pythonPath.includes('venv-whisperx')) {
      environmentUsed = 'whisperx'
    } else if (pythonPath.includes('venv-pyannote')) {
      environmentUsed = 'pyannote'
    }

    console.log(`[PythonExecMgr] Executing ${scriptName} with ${environmentUsed} environment`)

    // Build command and arguments
    let command: string
    let args: string[]

    if (isBundled) {
      command = pythonPath
      const bundleCommand = BUNDLE_COMMAND_MAP[scriptName] || scriptName.replace('.py', '')
      args = [bundleCommand, ...(options.args || [])]
    } else {
      command = pythonPath
      const scriptPath = path.join(this.getPythonScriptsDir(), scriptName)

      if (!fs.existsSync(scriptPath)) {
        return {
          success: false,
          code: 1,
          stdout: '',
          stderr: `Script not found: ${scriptPath}`,
          error: `Script not found: ${scriptPath}`,
          environmentUsed,
          usedFallback: false,
          executionTimeMs: Date.now() - startTime,
        }
      }

      args = [scriptPath, ...(options.args || [])]
    }

    // Execute the process
    const result = await this.spawnAndWait(command, args, options, jobId, environmentUsed)

    // Handle fallback on failure
    if (!result.success && options.enableFallback && !result.usedFallback) {
      console.log(`[PythonExecMgr] Primary execution failed, attempting fallback...`)

      // Try alternate environment
      const alternateOperation = operationType === 'transcription' ? 'diarization' : 'transcription'
      const alternatePath = this.getPythonPathForOperation(alternateOperation)

      if (alternatePath && alternatePath !== pythonPath) {
        console.log(`[PythonExecMgr] Trying fallback with ${alternateOperation} environment`)

        const fallbackArgs = isBundled ? args : [
          path.join(this.getPythonScriptsDir(), scriptName),
          ...(options.args || [])
        ]

        const fallbackResult = await this.spawnAndWait(
          alternatePath,
          fallbackArgs,
          options,
          `${jobId}-fallback`,
          alternatePath.includes('venv-whisperx') ? 'whisperx' : 'pyannote'
        )

        if (fallbackResult.success) {
          return {
            ...fallbackResult,
            usedFallback: true,
          }
        }
      }
    }

    return {
      ...result,
      executionTimeMs: Date.now() - startTime,
    }
  }

  /**
   * Spawn a Python process and wait for completion
   */
  private async spawnAndWait(
    command: string,
    args: string[],
    options: ExecutionOptions,
    jobId: string,
    environmentUsed: ExecutionResult['environmentUsed']
  ): Promise<ExecutionResult> {
    return new Promise((resolve) => {
      const timeout = options.timeout ?? DEFAULT_TIMEOUT
      const cwd = options.cwd ?? this.getPythonScriptsDir()

      // Build environment variables
      const processEnv: Record<string, string | undefined> = {
        ...process.env,
        ...(options.env || {}),
        PYTHONUNBUFFERED: '1',
        TORCH_FORCE_NO_WEIGHTS_ONLY_LOAD: '1',
        PYTHONWARNINGS: 'ignore::UserWarning,ignore::DeprecationWarning,ignore::FutureWarning',
      }

      // Add HuggingFace token if available
      const hfToken = this.getHuggingFaceToken()
      if (hfToken) {
        processEnv.HF_TOKEN = hfToken
        processEnv.HUGGING_FACE_HUB_TOKEN = hfToken
      }

      console.log(`[PythonExecMgr] Spawning: ${command} ${args.slice(0, 2).join(' ')}...`)

      const proc = spawn(command, args, {
        cwd,
        stdio: ['pipe', 'pipe', 'pipe'],
        env: processEnv,
      })

      let stdout = ''
      let stderr = ''
      let killed = false
      let timeoutId: NodeJS.Timeout | null = null

      // Track active process
      const activeProcess: ActiveProcess = {
        process: proc,
        jobId,
        script: args[0] || command,
        startTime: Date.now(),
        timeout: null,
      }
      this.activeProcesses.set(jobId, activeProcess)

      // Set up timeout
      if (timeout > 0) {
        timeoutId = setTimeout(() => {
          console.log(`[PythonExecMgr] Process ${jobId} timed out after ${timeout}ms`)
          killed = true
          proc.kill('SIGTERM')

          setTimeout(() => {
            if (!proc.killed) {
              proc.kill('SIGKILL')
            }
          }, KILL_GRACE_PERIOD)
        }, timeout)
        activeProcess.timeout = timeoutId
      }

      // Handle abort signal
      if (options.abortSignal) {
        options.abortSignal.addEventListener('abort', () => {
          console.log(`[PythonExecMgr] Process ${jobId} aborted`)
          killed = true
          proc.kill('SIGTERM')

          setTimeout(() => {
            if (!proc.killed) {
              proc.kill('SIGKILL')
            }
          }, KILL_GRACE_PERIOD)
        })
      }

      // Collect stdout
      proc.stdout?.on('data', (data: Buffer) => {
        const text = data.toString()
        stdout += text
        if (options.onStdout) {
          options.onStdout(text)
        }
      })

      // Collect stderr and parse progress
      proc.stderr?.on('data', (data: Buffer) => {
        const text = data.toString()
        stderr += text
        if (options.onStderr) {
          options.onStderr(text)
        }

        // Parse progress from stderr
        if (options.onProgress) {
          const percentMatch = text.match(/(\d+)%/)
          if (percentMatch) {
            options.onProgress(parseInt(percentMatch[1], 10), text.trim())
          } else {
            const fractionMatch = text.match(/(\d+)\/(\d+)/)
            if (fractionMatch) {
              const percent = Math.round(
                (parseInt(fractionMatch[1], 10) / parseInt(fractionMatch[2], 10)) * 100
              )
              options.onProgress(percent, text.trim())
            }
          }
        }
      })

      // Handle process exit
      proc.on('exit', (code, signal) => {
        if (timeoutId) {
          clearTimeout(timeoutId)
        }
        this.activeProcesses.delete(jobId)

        const result: ExecutionResult = {
          success: code === 0 && !killed,
          code: code ?? (killed ? -1 : 1),
          stdout,
          stderr,
          error: killed
            ? `Process ${signal === 'SIGKILL' ? 'forcibly killed' : 'terminated'} (timeout or abort)`
            : code !== 0
            ? stderr || `Process exited with code ${code}`
            : undefined,
          environmentUsed,
          usedFallback: false,
          executionTimeMs: Date.now() - activeProcess.startTime,
        }

        resolve(result)
      })

      // Handle process error
      proc.on('error', (err) => {
        if (timeoutId) {
          clearTimeout(timeoutId)
        }
        this.activeProcesses.delete(jobId)

        resolve({
          success: false,
          code: 1,
          stdout,
          stderr: err.message,
          error: err.message,
          environmentUsed,
          usedFallback: false,
          executionTimeMs: Date.now() - activeProcess.startTime,
        })
      })
    })
  }

  /**
   * Spawn a long-running Python process (returns ChildProcess for streaming)
   */
  spawnProcess(
    scriptName: string,
    options: Omit<ExecutionOptions, 'timeout'> = {}
  ): ChildProcess | null {
    const operationType = options.forceOperationType || this.detectOperationType(scriptName)
    const pythonPath = this.getPythonPathForOperation(operationType)
    const isBundled = pythonPath === this.getBundledPythonPath()

    if (!pythonPath) {
      console.error('[PythonExecMgr] No Python path available')
      return null
    }

    let command: string
    let args: string[]

    if (isBundled) {
      command = pythonPath
      const bundleCommand = BUNDLE_COMMAND_MAP[scriptName] || scriptName.replace('.py', '')
      args = [bundleCommand, ...(options.args || [])]
    } else {
      command = pythonPath
      const scriptPath = path.join(this.getPythonScriptsDir(), scriptName)

      if (!fs.existsSync(scriptPath)) {
        console.error(`[PythonExecMgr] Script not found: ${scriptPath}`)
        return null
      }

      args = [scriptPath, ...(options.args || [])]
    }

    const processEnv: Record<string, string | undefined> = {
      ...process.env,
      ...(options.env || {}),
      PYTHONUNBUFFERED: '1',
      TORCH_FORCE_NO_WEIGHTS_ONLY_LOAD: '1',
      PYTHONWARNINGS: 'ignore::UserWarning,ignore::DeprecationWarning,ignore::FutureWarning',
    }

    const hfToken = this.getHuggingFaceToken()
    if (hfToken) {
      processEnv.HF_TOKEN = hfToken
      processEnv.HUGGING_FACE_HUB_TOKEN = hfToken
    }

    console.log(`[PythonExecMgr] Spawning process: ${command} ${args.slice(0, 2).join(' ')}...`)

    return spawn(command, args, {
      cwd: options.cwd ?? this.getPythonScriptsDir(),
      stdio: ['pipe', 'pipe', 'pipe'],
      env: processEnv,
    })
  }

  /**
   * Abort all active processes
   */
  abortAll(): void {
    for (const [jobId, activeProcess] of this.activeProcesses) {
      console.log(`[PythonExecMgr] Aborting process ${jobId}`)
      if (activeProcess.timeout) {
        clearTimeout(activeProcess.timeout)
      }
      activeProcess.process.kill('SIGTERM')

      setTimeout(() => {
        if (!activeProcess.process.killed) {
          activeProcess.process.kill('SIGKILL')
        }
      }, KILL_GRACE_PERIOD)
    }
    this.activeProcesses.clear()
  }

  /**
   * Get count of active processes
   */
  getActiveProcessCount(): number {
    return this.activeProcesses.size
  }

  // ============================================================================
  // Error Recovery
  // ============================================================================

  /**
   * Attempt to repair Python environments
   */
  async repair(): Promise<RepairResult> {
    console.log('[PythonExecMgr] Starting environment repair...')

    const result: RepairResult = {
      success: false,
      actions: [],
      errors: [],
      recommendations: [],
    }

    try {
      // Clear caches to force fresh validation
      this.clearCache()
      result.actions.push('Cleared environment caches')

      // Validate environments
      const status = await this.getStatus(true)
      result.actions.push('Validated environments')

      // Try to run check_setup.py to get detailed diagnostics
      const checkResult = await this.execute('check_setup.py', {
        timeout: 60000,
        enableFallback: true,
      })

      if (checkResult.success) {
        result.actions.push('Environment check script completed successfully')
      } else {
        result.errors.push(`Environment check failed: ${checkResult.error}`)
      }

      // Generate recommendations based on status
      if (!status.whisperx.healthy) {
        result.recommendations.push(
          'WhisperX environment needs setup:',
          '  cd python && python3 -m venv venv-whisperx',
          '  source venv-whisperx/bin/activate',
          '  pip install -r requirements-whisperx.txt'
        )
      }

      if (!status.pyannote.healthy) {
        result.recommendations.push(
          'Pyannote environment needs setup:',
          '  cd python && python3 -m venv venv-pyannote',
          '  source venv-pyannote/bin/activate',
          '  pip install -r requirements-pyannote.txt'
        )
      }

      if (!status.hfTokenConfigured) {
        result.recommendations.push(
          'Configure HuggingFace token for pyannote models:',
          '  1. Get token from https://huggingface.co/settings/tokens',
          '  2. Accept model terms at https://huggingface.co/pyannote/speaker-diarization-3.1',
          '  3. Add token in Settings > Audio > HuggingFace Token'
        )
      }

      result.success = status.ready
    } catch (error) {
      result.errors.push(`Repair failed: ${error instanceof Error ? error.message : String(error)}`)
    }

    console.log(`[PythonExecMgr] Repair completed: success=${result.success}`)
    return result
  }

  // ============================================================================
  // Utility Methods
  // ============================================================================

  /**
   * Get the HuggingFace token
   */
  getHuggingFaceToken(): string | null {
    try {
      // Try to get from settings service
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const { settingsService } = require('./settingsService') as typeof import('./settingsService')
      const saved = settingsService.get<string>('transcription.hfToken')
      if (typeof saved === 'string' && saved.trim().length > 0) {
        return saved.trim()
      }
    } catch {
      // Ignore if settings layer isn't available
    }

    const envToken = process.env.HF_TOKEN || process.env.HUGGING_FACE_HUB_TOKEN
    return envToken && envToken.trim().length > 0 ? envToken.trim() : null
  }

  /**
   * Check if HuggingFace token is configured
   */
  isHuggingFaceTokenConfigured(): boolean {
    return this.getHuggingFaceToken() !== null
  }

  /**
   * Clear all caches
   */
  clearCache(): void {
    this.cachedWhisperxStatus = null
    this.cachedPyannoteStatus = null
    this.cachedPythonPaths.clear()
  }

  /**
   * Get current environment type
   */
  getEnvironmentType(): PythonEnvironmentType {
    if (this.getBundledPythonPath()) {
      return 'bundled'
    }
    if (this.getVenvPythonPath('venv-whisperx') && this.getVenvPythonPath('venv-pyannote')) {
      return 'dual-venv'
    }
    if (this.getVenvPythonPath('venv-3.12') || this.getVenvPythonPath('venv')) {
      return 'single-venv'
    }
    if (this.getSystemPythonPath()) {
      return 'system'
    }
    return 'none'
  }
}

// Export singleton instance
export const pythonExecutionManager = new PythonExecutionManagerService()

// Export class for testing
export { PythonExecutionManagerService }
