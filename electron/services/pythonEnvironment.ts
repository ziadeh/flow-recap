/**
 * Python Environment Detection and Management
 *
 * This service detects and manages the Python environment for the ML pipeline.
 * It supports multiple configurations:
 *
 * 1. Bundled Python (PyInstaller bundle) - PREFERRED FOR DISTRIBUTION
 *    - Standalone executable with all dependencies (WhisperX, pyannote, PyTorch)
 *    - No user setup required - works out of the box
 *    - Located in resources/python/transcription_bundle
 *    - Platform-specific builds (macOS Intel/ARM64, Windows x64)
 *    - ML models downloaded on first use to user's cache directory
 *
 * 2. Dual Virtual Environment (Development - RECOMMENDED)
 *    - Separate venvs for WhisperX and Pyannote to avoid torch version conflicts
 *    - venv-whisperx: Python 3.12 + WhisperX + torch 2.5.0 (for transcription)
 *    - venv-pyannote: Python 3.12 + Pyannote + torch 2.5.1 (for diarization)
 *    - Automatic environment switching based on operation type
 *
 * 3. Single Virtual Environment (Legacy)
 *    - Python venv with pip-installed dependencies
 *    - Supports venv-3.12 or venv directories
 *    - May have torch version conflicts between WhisperX and Pyannote
 *
 * 4. System Python (Fallback)
 *    - Uses system Python installation
 *    - Requires manual dependency installation
 *
 * Usage:
 *   import { pythonEnvironment } from './pythonEnvironment'
 *
 *   // Get Python executable path (auto-detects best available)
 *   const pythonPath = pythonEnvironment.getPythonPath()
 *
 *   // Get Python path for specific operation
 *   const whisperxPath = pythonEnvironment.getPythonPathForPurpose('whisperx')
 *   const pyannotePath = pythonEnvironment.getPythonPathForPurpose('pyannote')
 *
 *   // Check environment status
 *   const status = await pythonEnvironment.checkEnvironment()
 *
 *   // Execute a transcription script
 *   const result = await pythonEnvironment.runScript('transcribe', ['audio.wav'])
 *
 *   // Check if first-run model download is needed
 *   const firstRunInfo = pythonEnvironment.getFirstRunInfo()
 */

import { execSync, spawn, ChildProcess } from 'child_process'
import * as path from 'path'
import * as fs from 'fs'
import { EventEmitter } from 'events'
import { pathNormalizationService } from './pathNormalizationService'

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

export type PythonEnvironmentType = 'bundled' | 'dual-venv' | 'venv' | 'system' | 'none'

export type PythonPurpose = 'whisperx' | 'pyannote' | 'general'

export interface PythonEnvironmentStatus {
  /** Type of Python environment detected */
  type: PythonEnvironmentType
  /** Path to Python executable or bundle */
  pythonPath: string | null
  /** Whether the environment is ready for use */
  ready: boolean
  /** Python version string (e.g., "3.12.0") */
  version: string | null
  /** Whether CUDA/GPU support is available */
  cudaAvailable: boolean
  /** Available ML backends */
  backends: {
    whisperx: boolean
    fasterWhisper: boolean
    pyannote: boolean
    speechbrain: boolean
  }
  /** Path to bundled transcription executable (if bundled) */
  bundlePath: string | null
  /** Any errors encountered during detection */
  errors: string[]
  /** Recommendations for user */
  recommendations: string[]
  /** Platform information */
  platform: {
    os: string
    arch: string
    isAppleSilicon: boolean
  }
  /** Whether first-run model download is needed */
  firstRunRequired: boolean
  /** Dual environment paths (if using dual-venv setup) */
  dualEnvironment?: {
    whisperxPath: string | null
    pyannotePath: string | null
    whisperxReady: boolean
    pyannoteReady: boolean
    // Extended status for detailed validation
    whisperxReadiness?: 'ready' | 'functional' | 'failed'
    whisperxStatusMessage?: string
    pyannoteReadiness?: 'ready' | 'functional' | 'failed'
    pyannoteStatusMessage?: string
  }
}

export interface ScriptExecutionOptions {
  /** Script arguments */
  args?: string[]
  /** Working directory */
  cwd?: string
  /** Additional environment variables */
  env?: Record<string, string>
  /** Timeout in milliseconds (default: 10 minutes) */
  timeout?: number
  /** Callback for stdout data */
  onStdout?: (data: string) => void
  /** Callback for stderr data */
  onStderr?: (data: string) => void
}

export interface ScriptExecutionResult {
  /** Exit code (0 = success) */
  code: number
  /** Standard output */
  stdout: string
  /** Standard error */
  stderr: string
  /** Whether execution was successful */
  success: boolean
  /** Error message if failed */
  error?: string
}

// ============================================================================
// Constants
// ============================================================================

const DEFAULT_TIMEOUT = 600000 // 10 minutes

// Script name mappings for bundled vs venv execution
const SCRIPT_MAP: Record<string, string> = {
  transcribe: 'transcribe.py',
  diarize: 'diarize.py',
  core_diarize: 'core_diarization_engine.py',
  stream: 'stream_transcribe.py',
  live_diarize: 'live_diarize.py',
  check: 'check_setup.py',
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
// Python Environment Service
// ============================================================================

class PythonEnvironmentService extends EventEmitter {
  private cachedStatus: PythonEnvironmentStatus | null = null
  private cacheTimestamp: number = 0
  private readonly CACHE_TTL = 60000 // 1 minute

  /**
   * Get the base directory for Python resources
   * Uses pathNormalizationService for cross-platform path handling
   */
  private getResourcesDir(): string {
    if (app?.isPackaged) {
      return process.resourcesPath || ''
    }
    // In development, __dirname is dist-electron/ (after Vite bundling)
    // Go up one level to reach the project root
    return pathNormalizationService.joinPaths(__dirname, '..')
  }

  /**
   * Get the Python scripts directory
   * Uses pathNormalizationService for cross-platform path handling
   */
  getPythonScriptsDir(): string {
    const resourcesDir = this.getResourcesDir()
    if (app?.isPackaged) {
      return pathNormalizationService.joinPaths(resourcesDir, 'python')
    }
    return pathNormalizationService.joinPaths(resourcesDir, 'python')
  }

  /**
   * Check if bundled Python executable exists
   * Uses pathNormalizationService for cross-platform path handling
   */
  private getBundlePath(): string | null {
    const pythonDir = this.getPythonScriptsDir()
    const bundleExe = process.platform === 'win32'
      ? pathNormalizationService.joinPaths(pythonDir, 'transcription_bundle.exe')
      : pathNormalizationService.joinPaths(pythonDir, 'transcription_bundle')

    if (pathNormalizationService.exists(bundleExe)) {
      return bundleExe
    }

    // Also check in _internal directory (PyInstaller structure)
    const internalBundleExe = process.platform === 'win32'
      ? pathNormalizationService.joinPaths(pythonDir, '_internal', 'transcription_bundle.exe')
      : pathNormalizationService.joinPaths(pythonDir, '_internal', 'transcription_bundle')

    if (pathNormalizationService.exists(internalBundleExe)) {
      return internalBundleExe
    }

    return null
  }

  /**
   * Find virtual environment Python executable
   * Uses pathNormalizationService for cross-platform path handling
   * @param purpose - Optional: 'whisperx' for transcription, 'pyannote' for diarization
   */
  private findVenvPython(purpose?: PythonPurpose): string | null {
    const pythonDir = this.getPythonScriptsDir()

    // Check for purpose-specific venvs first (dual environment setup)
    if (purpose === 'whisperx') {
      const whisperxVenv = pathNormalizationService.joinPaths(pythonDir, 'venv-whisperx')
      const whisperxPython = process.platform === 'win32'
        ? pathNormalizationService.joinPaths(whisperxVenv, 'Scripts', 'python.exe')
        : pathNormalizationService.joinPaths(whisperxVenv, 'bin', 'python')
      if (pathNormalizationService.exists(whisperxPython)) {
        return whisperxPython
      }
    } else if (purpose === 'pyannote') {
      const pyannoteVenv = pathNormalizationService.joinPaths(pythonDir, 'venv-pyannote')
      const pyannotePython = process.platform === 'win32'
        ? pathNormalizationService.joinPaths(pyannoteVenv, 'Scripts', 'python.exe')
        : pathNormalizationService.joinPaths(pyannoteVenv, 'bin', 'python')
      if (pathNormalizationService.exists(pyannotePython)) {
        return pyannotePython
      }
    }

    // When no purpose specified, check for dual venvs (whisperx/pyannote)
    // This ensures validation checks find the venvs
    if (!purpose) {
      const whisperxVenv = pathNormalizationService.joinPaths(pythonDir, 'venv-whisperx')
      const whisperxPython = process.platform === 'win32'
        ? pathNormalizationService.joinPaths(whisperxVenv, 'Scripts', 'python.exe')
        : pathNormalizationService.joinPaths(whisperxVenv, 'bin', 'python')
      if (pathNormalizationService.exists(whisperxPython)) {
        return whisperxPython
      }

      const pyannoteVenv = pathNormalizationService.joinPaths(pythonDir, 'venv-pyannote')
      const pyannotePython = process.platform === 'win32'
        ? pathNormalizationService.joinPaths(pyannoteVenv, 'Scripts', 'python.exe')
        : pathNormalizationService.joinPaths(pyannoteVenv, 'bin', 'python')
      if (pathNormalizationService.exists(pyannotePython)) {
        return pyannotePython
      }
    }

    // Check for virtual environments in order of preference (fallback/legacy)
    const venvDirs = ['venv-3.12', 'venv']

    for (const venvName of venvDirs) {
      const venvPath = pathNormalizationService.joinPaths(pythonDir, venvName)
      const pythonExe = process.platform === 'win32'
        ? pathNormalizationService.joinPaths(venvPath, 'Scripts', 'python.exe')
        : pathNormalizationService.joinPaths(venvPath, 'bin', 'python')

      if (pathNormalizationService.exists(pythonExe)) {
        return pythonExe
      }
    }

    return null
  }

  /**
   * Check if dual virtual environment setup is available
   * Uses pathNormalizationService for cross-platform path handling
   */
  private isDualVenvAvailable(): boolean {
    const pythonDir = this.getPythonScriptsDir()
    const whisperxVenv = process.platform === 'win32'
      ? pathNormalizationService.joinPaths(pythonDir, 'venv-whisperx', 'Scripts', 'python.exe')
      : pathNormalizationService.joinPaths(pythonDir, 'venv-whisperx', 'bin', 'python')
    const pyannoteVenv = process.platform === 'win32'
      ? pathNormalizationService.joinPaths(pythonDir, 'venv-pyannote', 'Scripts', 'python.exe')
      : pathNormalizationService.joinPaths(pythonDir, 'venv-pyannote', 'bin', 'python')
    return pathNormalizationService.exists(whisperxVenv) && pathNormalizationService.exists(pyannoteVenv)
  }

  /**
   * Find system Python executable
   */
  private findSystemPython(): string | null {
    // Check environment variable
    if (process.env.PYTHON_PATH && fs.existsSync(process.env.PYTHON_PATH)) {
      return process.env.PYTHON_PATH
    }

    // Platform-specific Python detection
    if (process.platform === 'win32') {
      // Windows: Use 'where' command and py launcher
      try {
        // Try py launcher first (recommended for Windows)
        const pyPath = execSync('where py', {
          encoding: 'utf8',
          timeout: 5000,
          stdio: ['pipe', 'pipe', 'pipe']
        }).trim().split('\n')[0]
        if (pyPath && fs.existsSync(pyPath)) {
          return pyPath
        }
      } catch {
        // py launcher not found, try python directly
      }

      try {
        const pythonPath = execSync('where python', {
          encoding: 'utf8',
          timeout: 5000,
          stdio: ['pipe', 'pipe', 'pipe']
        }).trim().split('\n')[0]
        if (pythonPath && fs.existsSync(pythonPath)) {
          return pythonPath
        }
      } catch {
        // Ignore errors
      }
    } else {
      // Unix: Use 'which' command
      try {
        const pythonPath = execSync('which python3', {
          encoding: 'utf8',
          timeout: 5000,
          stdio: ['pipe', 'pipe', 'pipe']
        }).trim()
        if (pythonPath && fs.existsSync(pythonPath)) {
          return pythonPath
        }
      } catch {
        // python3 not found, try python
      }

      try {
        const pythonPath = execSync('which python', {
          encoding: 'utf8',
          timeout: 5000,
          stdio: ['pipe', 'pipe', 'pipe']
        }).trim()
        if (pythonPath && fs.existsSync(pythonPath)) {
          return pythonPath
        }
      } catch {
        // Ignore errors
      }
    }

    return null
  }

  /**
   * Get the Python executable path (prefers venv > bundled > system)
   *
   * IMPORTANT: We prefer venv over bundled because PyInstaller bundles often fail
   * to include complex ML packages (PyTorch, WhisperX, Pyannote). The venv approach
   * is more reliable for production ML desktop apps.
   */
  getPythonPath(): string | null {
    // 1. Check for virtual environment FIRST (most reliable for ML packages)
    const venvPython = this.findVenvPython()
    if (venvPython) {
      return venvPython
    }

    // 2. Check for bundled Python (legacy/fallback)
    const bundlePath = this.getBundlePath()
    if (bundlePath) {
      return bundlePath
    }

    // 3. Fall back to system Python
    return this.findSystemPython()
  }

  /**
   * Determine the environment type based on what's available
   * Priority: dual-venv > venv > bundled > system
   */
  getEnvironmentType(): PythonEnvironmentType {
    // Check dual venv first (preferred for ML)
    if (this.isDualVenvAvailable()) {
      return 'dual-venv'
    }
    // Check single venv
    if (this.findVenvPython()) {
      return 'venv'
    }
    // Bundled (legacy fallback)
    if (this.getBundlePath()) {
      return 'bundled'
    }
    // System Python
    if (this.findSystemPython()) {
      return 'system'
    }
    return 'none'
  }

  /**
   * Get Python path for a specific purpose (transcription vs diarization)
   * This enables using separate venvs with different torch versions
   * @param purpose - 'whisperx' for transcription, 'pyannote' for diarization, 'general' for default
   */
  getPythonPathForPurpose(purpose: PythonPurpose): string | null {
    // 1. Check for bundled Python (works for all purposes)
    const bundlePath = this.getBundlePath()
    if (bundlePath) {
      return bundlePath
    }

    // 2. Check for purpose-specific venv
    const purposeVenv = this.findVenvPython(purpose)
    if (purposeVenv) {
      return purposeVenv
    }

    // 3. Fall back to general venv
    const generalVenv = this.findVenvPython()
    if (generalVenv) {
      return generalVenv
    }

    // 4. Fall back to system Python
    return this.findSystemPython()
  }

  /**
   * Check the Python environment status
   */
  async checkEnvironment(forceRefresh = false): Promise<PythonEnvironmentStatus> {
    // Return cached status if valid
    if (!forceRefresh && this.cachedStatus && Date.now() - this.cacheTimestamp < this.CACHE_TTL) {
      return this.cachedStatus
    }

    const status: PythonEnvironmentStatus = {
      type: 'none',
      pythonPath: null,
      ready: false,
      version: null,
      cudaAvailable: false,
      backends: {
        whisperx: false,
        fasterWhisper: false,
        pyannote: false,
        speechbrain: false,
      },
      bundlePath: null,
      errors: [],
      recommendations: [],
      platform: {
        os: process.platform,
        arch: process.arch,
        isAppleSilicon: process.platform === 'darwin' && process.arch === 'arm64',
      },
      firstRunRequired: false,
    }

    // Detect environment type
    status.type = this.getEnvironmentType()
    status.pythonPath = this.getPythonPath()
    status.bundlePath = this.getBundlePath()

    // Check for dual environment setup
    if (status.type === 'dual-venv') {
      const whisperxPath = this.findVenvPython('whisperx')
      const pyannotePath = this.findVenvPython('pyannote')
      status.dualEnvironment = {
        whisperxPath,
        pyannotePath,
        whisperxReady: false,
        pyannoteReady: false,
      }
    }

    if (!status.pythonPath) {
      status.errors.push('No Python environment found')
      status.recommendations.push(
        'Install Python 3.10+ and create a virtual environment',
        'Or run "npm run bundle:python" to create a standalone bundle'
      )
      this.cacheStatus(status)
      return status
    }

    // Check if using bundle
    if (status.type === 'bundled' && status.bundlePath) {
      // For bundled Python, we assume all dependencies are available
      status.ready = true
      status.backends = {
        whisperx: true,
        fasterWhisper: true,
        pyannote: true,
        speechbrain: true,
      }
      status.version = 'bundled'

      // Try to get actual version
      try {
        const result = await this.runScript('check', [], { timeout: 30000 })
        if (result.success && result.stdout) {
          // Parse version from check script output
          const versionMatch = result.stdout.match(/Python\s+(\d+\.\d+\.\d+)/)
          if (versionMatch) {
            status.version = versionMatch[1]
          }
        }
      } catch {
        // Ignore - bundled version detection is optional
      }

      this.cacheStatus(status)
      return status
    }

    // For venv or system Python, check dependencies
    // OPTIMIZATION: For dual-venv setup, assume packages are installed if venvs exist
    // This avoids expensive import checks on every app startup
    const isDualVenv = status.type === 'dual-venv'

    try {
      // Get Python version (quick check)
      const versionOutput = execSync(`"${status.pythonPath}" --version 2>&1`, {
        encoding: 'utf8',
        timeout: 5000,
      })
      const versionMatch = versionOutput.match(/Python\s+(\d+\.\d+\.\d+)/)
      if (versionMatch) {
        status.version = versionMatch[1]
      }

      // Check for minimum Python version (3.10+)
      if (status.version) {
        const [major, minor] = status.version.split('.').map(Number)
        if (major < 3 || (major === 3 && minor < 10)) {
          status.errors.push(`Python ${status.version} is too old. Requires Python 3.10+`)
          status.recommendations.push('Upgrade to Python 3.10 or newer')
        }
      }

      // FAST PATH: For dual-venv, assume packages are installed if directories exist
      // This prevents blocking the app on startup with expensive import checks
      if (isDualVenv && status.dualEnvironment) {
        const whisperxPath = status.dualEnvironment.whisperxPath
        const pyannotePath = status.dualEnvironment.pyannotePath

        // Check if site-packages exist (lightweight filesystem check)
        // Note: Windows uses Lib/site-packages, Unix uses lib/pythonX.Y/site-packages
        const getSitePackagesPath = (pythonExePath: string): string => {
          const venvRoot = path.dirname(path.dirname(pythonExePath))
          if (process.platform === 'win32') {
            // Windows: venv/Lib/site-packages
            return path.join(venvRoot, 'Lib', 'site-packages')
          } else {
            // Unix: venv/lib/pythonX.Y/site-packages
            const pythonVersion = status.version?.split('.').slice(0, 2).join('.') || '3.12'
            return path.join(venvRoot, 'lib', `python${pythonVersion}`, 'site-packages')
          }
        }

        const whisperxSitePackages = whisperxPath ? getSitePackagesPath(whisperxPath) : null
        const pyannoteSitePackages = pyannotePath ? getSitePackagesPath(pyannotePath) : null

        // Assume packages are available if site-packages directories exist
        if (whisperxSitePackages && fs.existsSync(whisperxSitePackages)) {
          status.backends.whisperx = true
          status.backends.fasterWhisper = true
        }
        if (pyannoteSitePackages && fs.existsSync(pyannoteSitePackages)) {
          status.backends.pyannote = true
          status.backends.speechbrain = true
        }
      } else {
        // SLOW PATH: For non-dual-venv or when explicitly validating, run import checks
        // Environment options for checking dependencies
        const execOptions = {
          encoding: 'utf8' as const,
          timeout: 30000,
          env: {
            ...process.env,
            PYTHONWARNINGS: 'ignore::UserWarning,ignore::DeprecationWarning,ignore::FutureWarning',
          },
        }

        // Check WhisperX
        try {
          execSync(`"${status.pythonPath}" -c "import whisperx" 2>&1`, execOptions)
          status.backends.whisperx = true
        } catch {
          // Not available
        }

        // Check faster-whisper
        try {
          execSync(`"${status.pythonPath}" -c "from faster_whisper import WhisperModel" 2>&1`, execOptions)
          status.backends.fasterWhisper = true
        } catch {
          // Not available
        }

        // Check pyannote
        try {
          execSync(`"${status.pythonPath}" -c "from pyannote.audio import Pipeline" 2>&1`, execOptions)
          status.backends.pyannote = true
        } catch {
          // Not available
        }

        // Check speechbrain
        try {
          execSync(`"${status.pythonPath}" -c "import speechbrain" 2>&1`, execOptions)
          status.backends.speechbrain = true
        } catch {
          // Not available
        }
      }

      // Skip CUDA check (expensive and not critical for startup)
      // CUDA will be detected during actual transcription if needed
      status.cudaAvailable = false

      // Determine if ready
      const hasTranscription = status.backends.whisperx || status.backends.fasterWhisper
      const hasDiarization = status.backends.pyannote || status.backends.speechbrain

      // Update dual environment ready flags if using dual-venv
      if (status.type === 'dual-venv' && status.dualEnvironment) {
        // WhisperX is ready if we can import whisperx or faster_whisper
        status.dualEnvironment.whisperxReady = hasTranscription

        // Pyannote is ready if we can import pyannote.audio or speechbrain
        status.dualEnvironment.pyannoteReady = hasDiarization
      }

      if (hasTranscription && hasDiarization) {
        status.ready = true
      } else {
        if (!hasTranscription) {
          status.errors.push('No transcription backend available (whisperx or faster-whisper)')
          status.recommendations.push('Run: pip install whisperx faster-whisper')
        }
        if (!hasDiarization) {
          status.errors.push('No diarization backend available (pyannote.audio or speechbrain)')
          status.recommendations.push('Run: pip install pyannote.audio speechbrain')
        }
      }

      // For dual-venv, check each environment separately
      if (status.dualEnvironment) {
        status.dualEnvironment.whisperxReady = hasTranscription
        status.dualEnvironment.pyannoteReady = hasDiarization

        // Check the pyannote venv separately for diarization backends
        const pyannotePath = status.dualEnvironment.pyannotePath
        if (pyannotePath && fs.existsSync(pyannotePath)) {
          try {
            const pyannoteExecOptions = {
              encoding: 'utf8' as const,
              timeout: 30000,
              env: {
                ...process.env,
                PYTHONWARNINGS: 'ignore::UserWarning,ignore::DeprecationWarning,ignore::FutureWarning',
              },
            }
            execSync(`"${pyannotePath}" -c "from pyannote.audio import Pipeline" 2>&1`, pyannoteExecOptions)
            status.dualEnvironment.pyannoteReady = true
          } catch {
            status.dualEnvironment.pyannoteReady = false
          }
        }

        // In dual-venv mode, we're ready if both purpose-specific backends work
        status.ready = status.dualEnvironment.whisperxReady && status.dualEnvironment.pyannoteReady

        if (!status.ready) {
          status.recommendations.unshift(
            'Using dual Python environment setup. Ensure both venvs are properly configured:',
            '  - venv-whisperx: pip install -r requirements-whisperx.txt',
            '  - venv-pyannote: pip install -r requirements-pyannote.txt'
          )
        }
      }

    } catch (error) {
      status.errors.push(`Failed to check Python environment: ${error instanceof Error ? error.message : String(error)}`)
    }

    this.cacheStatus(status)
    return status
  }

  private cacheStatus(status: PythonEnvironmentStatus): void {
    this.cachedStatus = status
    this.cacheTimestamp = Date.now()
  }

  /**
   * Run a Python script with the appropriate environment
   */
  async runScript(
    scriptName: string,
    scriptArgs: string[] = [],
    options: ScriptExecutionOptions = {}
  ): Promise<ScriptExecutionResult> {
    const {
      cwd = this.getPythonScriptsDir(),
      env = {},
      timeout = DEFAULT_TIMEOUT,
      onStdout,
      onStderr,
    } = options

    const envType = this.getEnvironmentType()
    const pythonPath = this.getPythonPath()

    if (!pythonPath) {
      return {
        code: 1,
        stdout: '',
        stderr: 'No Python environment available',
        success: false,
        error: 'No Python environment available',
      }
    }

    // Determine how to run the script
    let command: string
    let args: string[]

    if (envType === 'bundled') {
      // Use the bundled executable
      command = pythonPath
      // Map script name to bundle command
      const bundleCommand = BUNDLE_COMMAND_MAP[scriptName] || scriptName.replace('.py', '')
      args = [bundleCommand, ...scriptArgs]
    } else {
      // Use Python interpreter
      command = pythonPath
      const scriptFile = SCRIPT_MAP[scriptName] || scriptName
      const scriptPath = path.join(this.getPythonScriptsDir(), scriptFile)

      if (!fs.existsSync(scriptPath)) {
        return {
          code: 1,
          stdout: '',
          stderr: `Script not found: ${scriptPath}`,
          success: false,
          error: `Script not found: ${scriptPath}`,
        }
      }

      args = [scriptPath, ...scriptArgs]
    }

    return new Promise((resolve) => {
      let stdout = ''
      let stderr = ''
      let timeoutId: NodeJS.Timeout | null = null

      const processEnv = {
        ...process.env,
        ...env,
        PYTHONUNBUFFERED: '1',
        TORCH_FORCE_NO_WEIGHTS_ONLY_LOAD: '1',
        PYTHONWARNINGS: 'ignore::UserWarning,ignore::DeprecationWarning,ignore::FutureWarning',
      }

      const proc = spawn(command, args, {
        cwd,
        stdio: ['pipe', 'pipe', 'pipe'],
        env: processEnv,
      })

      if (timeout > 0) {
        timeoutId = setTimeout(() => {
          proc.kill('SIGTERM')
          setTimeout(() => {
            if (!proc.killed) {
              proc.kill('SIGKILL')
            }
          }, 5000)
        }, timeout)
      }

      proc.stdout?.on('data', (data: Buffer) => {
        const text = data.toString()
        stdout += text
        if (onStdout) onStdout(text)
      })

      proc.stderr?.on('data', (data: Buffer) => {
        const text = data.toString()
        stderr += text
        if (onStderr) onStderr(text)
      })

      proc.on('exit', (code) => {
        if (timeoutId) clearTimeout(timeoutId)

        resolve({
          code: code ?? 1,
          stdout,
          stderr,
          success: code === 0,
          error: code !== 0 ? stderr || `Process exited with code ${code}` : undefined,
        })
      })

      proc.on('error', (err) => {
        if (timeoutId) clearTimeout(timeoutId)

        resolve({
          code: 1,
          stdout,
          stderr: err.message,
          success: false,
          error: err.message,
        })
      })
    })
  }

  /**
   * Spawn a long-running Python process
   */
  spawnProcess(
    scriptName: string,
    scriptArgs: string[] = [],
    options: ScriptExecutionOptions = {}
  ): ChildProcess | null {
    const {
      cwd = this.getPythonScriptsDir(),
      env = {},
    } = options

    const envType = this.getEnvironmentType()
    const pythonPath = this.getPythonPath()

    if (!pythonPath) {
      return null
    }

    // Determine how to run the script
    let command: string
    let args: string[]

    if (envType === 'bundled') {
      command = pythonPath
      const bundleCommand = BUNDLE_COMMAND_MAP[scriptName] || scriptName.replace('.py', '')
      args = [bundleCommand, ...scriptArgs]
    } else {
      command = pythonPath
      const scriptFile = SCRIPT_MAP[scriptName] || scriptName
      const scriptPath = path.join(this.getPythonScriptsDir(), scriptFile)

      if (!fs.existsSync(scriptPath)) {
        return null
      }

      args = [scriptPath, ...scriptArgs]
    }

    const processEnv = {
      ...process.env,
      ...env,
      PYTHONUNBUFFERED: '1',
      TORCH_FORCE_NO_WEIGHTS_ONLY_LOAD: '1',
      PYTHONWARNINGS: 'ignore::UserWarning,ignore::DeprecationWarning,ignore::FutureWarning',
    }

    return spawn(command, args, {
      cwd,
      stdio: ['pipe', 'pipe', 'pipe'],
      env: processEnv,
    })
  }

  /**
   * Clear the cached environment status
   */
  clearCache(): void {
    this.cachedStatus = null
    this.cacheTimestamp = 0
  }

  /**
   * Get first-run information
   * Returns details about what will happen on first run (model downloads, etc.)
   */
  getFirstRunInfo(): {
    isBundled: boolean
    needsModelDownload: boolean
    estimatedDownloadSize: string
    message: string
    platform: { os: string; arch: string; isAppleSilicon: boolean }
  } {
    const isBundled = this.getEnvironmentType() === 'bundled'
    const platform = {
      os: process.platform,
      arch: process.arch,
      isAppleSilicon: process.platform === 'darwin' && process.arch === 'arm64',
    }

    // Bundled Python includes all dependencies but models are downloaded on first use
    // Models are cached in the user's home directory (~/.cache/huggingface)
    const estimatedModelSize = '3-5 GB' // Whisper large-v2 + pyannote models

    return {
      isBundled,
      needsModelDownload: true, // Models are always downloaded on first use
      estimatedDownloadSize: estimatedModelSize,
      message: isBundled
        ? `The application includes a pre-bundled Python environment with all ML dependencies. ` +
          `On first use, ML models (${estimatedModelSize}) will be automatically downloaded. ` +
          `This is a one-time download and models will be cached for future use.`
        : `Python environment detected. ML models (${estimatedModelSize}) will be downloaded on first use ` +
          `and cached for future sessions.`,
      platform,
    }
  }

  /**
   * Get platform-specific bundle information
   */
  getPlatformBundleInfo(): {
    platform: string
    arch: string
    bundleName: string
    isSupported: boolean
    supportMessage: string
  } {
    const platform = process.platform
    const arch = process.arch

    let bundleName = 'transcription_bundle'
    let isSupported = true
    let supportMessage = ''

    if (platform === 'win32') {
      bundleName = 'transcription_bundle.exe'
      if (arch !== 'x64') {
        isSupported = false
        supportMessage = 'Windows ARM64 is not currently supported. Please use Windows x64.'
      }
    } else if (platform === 'darwin') {
      if (arch === 'arm64') {
        supportMessage = 'Running on Apple Silicon (M1/M2/M3). Native ARM64 bundle will be used.'
      } else if (arch === 'x64') {
        supportMessage = 'Running on Intel Mac. x64 bundle will be used.'
      }
    } else if (platform === 'linux') {
      if (arch !== 'x64') {
        isSupported = false
        supportMessage = 'Only Linux x64 is currently supported.'
      }
    } else {
      isSupported = false
      supportMessage = `Platform ${platform} is not supported.`
    }

    return {
      platform,
      arch,
      bundleName,
      isSupported,
      supportMessage,
    }
  }

  /**
   * Get the HuggingFace token (Settings first, then environment fallback)
   */
  getHuggingFaceToken(): string | null {
    // Prefer persisted Settings (user-specific, works in packaged builds).
    // Use a lazy require to avoid hard dependency during non-Electron test runs.
    try {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const { settingsService } = require('./settingsService') as typeof import('./settingsService')
      const saved = settingsService.get<string>('transcription.hfToken')
      if (typeof saved === 'string' && saved.trim().length > 0) {
        return saved.trim()
      }
    } catch {
      // Ignore if settings/db layer isn't available in this context
    }

    const envToken = process.env.HF_TOKEN || process.env.HUGGING_FACE_HUB_TOKEN
    return envToken && envToken.trim().length > 0 ? envToken.trim() : null
  }

  /**
   * Check if HuggingFace token is configured (needed for pyannote models)
   */
  isHuggingFaceTokenConfigured(): boolean {
    return this.getHuggingFaceToken() !== null
  }
}

// Export singleton instance
export const pythonEnvironment = new PythonEnvironmentService()

// Export class for testing
export { PythonEnvironmentService }
