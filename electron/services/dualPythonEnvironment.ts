/**
 * Dual Python Environment Service
 *
 * Manages two isolated Python virtual environments to resolve torch version conflicts:
 * - venv-whisperx: Python 3.12 + WhisperX + torch 2.8 (for transcription)
 * - venv-pyannote: Python 3.12 + Pyannote + torch 2.5.1 (for speaker diarization)
 *
 * This service provides:
 * - Automatic environment detection for both venvs
 * - Environment selection based on operation type (transcription vs diarization)
 * - Automatic validation and dependency checking
 * - Fallback mechanisms if one environment fails
 * - Unified diagnostics for both environments
 *
 * Usage:
 *   import { dualPythonEnvironment } from './dualPythonEnvironment'
 *
 *   // Get Python path for transcription (WhisperX)
 *   const whisperxPath = dualPythonEnvironment.getWhisperXPythonPath()
 *
 *   // Get Python path for diarization (Pyannote)
 *   const pyannotePath = dualPythonEnvironment.getPyannotePythonPath()
 *
 *   // Check both environments
 *   const status = await dualPythonEnvironment.checkBothEnvironments()
 */

import { execSync, spawn, ChildProcess } from 'child_process'
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

export type EnvironmentPurpose = 'whisperx' | 'pyannote'

export type DualEnvironmentType = 'dual-venv' | 'single-venv' | 'bundled' | 'system' | 'none'

export interface SingleEnvironmentStatus {
  /** Whether this environment is available */
  available: boolean
  /** Path to Python executable */
  pythonPath: string | null
  /** Python version string */
  version: string | null
  /** Expected torch version for this environment */
  expectedTorchVersion: string
  /** Actual torch version found */
  actualTorchVersion: string | null
  /** Whether torch version matches expected */
  torchVersionMatch: boolean
  /** Key packages available */
  packages: {
    whisperx?: boolean
    fasterWhisper?: boolean
    pyannote?: boolean
    speechbrain?: boolean
    torch?: boolean
  }
  /** Errors encountered */
  errors: string[]
  /** Recommendations for fixing issues */
  recommendations: string[]
}

export interface DualEnvironmentStatus {
  /** Overall environment type detected */
  type: DualEnvironmentType
  /** Whether dual environment setup is ready */
  ready: boolean
  /** WhisperX environment status */
  whisperx: SingleEnvironmentStatus
  /** Pyannote environment status */
  pyannote: SingleEnvironmentStatus
  /** Platform information */
  platform: {
    os: string
    arch: string
    isAppleSilicon: boolean
  }
  /** Overall errors */
  errors: string[]
  /** Overall recommendations */
  recommendations: string[]
  /** Whether first-run setup is needed */
  firstRunRequired: boolean
}

export interface EnvironmentValidationResult {
  valid: boolean
  environment: EnvironmentPurpose
  pythonPath: string | null
  errors: string[]
  warnings: string[]
}

// ============================================================================
// Constants
// ============================================================================

const WHISPERX_VENV_NAME = 'venv-whisperx'
const PYANNOTE_VENV_NAME = 'venv-pyannote'
const WHISPERX_TORCH_VERSION = '2.8'
const PYANNOTE_TORCH_VERSION = '2.5.1'

// ============================================================================
// Dual Python Environment Service
// ============================================================================

class DualPythonEnvironmentService extends EventEmitter {
  private cachedStatus: DualEnvironmentStatus | null = null
  private cacheTimestamp: number = 0
  private readonly CACHE_TTL = 60000 // 1 minute

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
    if (app?.isPackaged) {
      return path.join(resourcesDir, 'python')
    }
    return path.join(resourcesDir, 'python')
  }

  /**
   * Get the path to a specific virtual environment
   */
  private getVenvPath(venvName: string): string {
    return path.join(this.getPythonScriptsDir(), venvName)
  }

  /**
   * Get the Python executable path for a virtual environment
   */
  private getVenvPythonPath(venvName: string): string | null {
    const venvPath = this.getVenvPath(venvName)
    const pythonExe = process.platform === 'win32'
      ? path.join(venvPath, 'Scripts', 'python.exe')
      : path.join(venvPath, 'bin', 'python')

    if (fs.existsSync(pythonExe)) {
      return pythonExe
    }
    return null
  }

  /**
   * Check for bundled Python executable
   */
  private getBundlePath(): string | null {
    const pythonDir = this.getPythonScriptsDir()
    const bundleExe = process.platform === 'win32'
      ? path.join(pythonDir, 'transcription_bundle.exe')
      : path.join(pythonDir, 'transcription_bundle')

    if (fs.existsSync(bundleExe)) {
      return bundleExe
    }
    return null
  }

  /**
   * Find fallback virtual environment (legacy single venv)
   */
  private findFallbackVenv(): string | null {
    const pythonDir = this.getPythonScriptsDir()
    const fallbackDirs = ['venv-3.12', 'venv']

    for (const venvName of fallbackDirs) {
      const pythonExe = this.getVenvPythonPath(venvName)
      if (pythonExe) {
        return pythonExe
      }
    }
    return null
  }

  /**
   * Find system Python executable
   */
  private findSystemPython(): string | null {
    if (process.env.PYTHON_PATH && fs.existsSync(process.env.PYTHON_PATH)) {
      return process.env.PYTHON_PATH
    }

    try {
      const pythonPath = execSync('which python3 2>/dev/null || which python 2>/dev/null', {
        encoding: 'utf8',
        timeout: 5000,
      }).trim()
      if (pythonPath && fs.existsSync(pythonPath)) {
        return pythonPath
      }
    } catch {
      // Ignore errors
    }

    return null
  }

  /**
   * Get the Python path for WhisperX transcription operations
   * Priority: venv-whisperx > bundled > fallback venv > system
   */
  getWhisperXPythonPath(): string | null {
    // 1. Check for dedicated WhisperX venv
    const whisperxPython = this.getVenvPythonPath(WHISPERX_VENV_NAME)
    if (whisperxPython) {
      return whisperxPython
    }

    // 2. Check for bundled executable
    const bundlePath = this.getBundlePath()
    if (bundlePath) {
      return bundlePath
    }

    // 3. Try fallback venv
    const fallback = this.findFallbackVenv()
    if (fallback) {
      console.warn('[DualPythonEnv] WhisperX venv not found, using fallback venv')
      return fallback
    }

    // 4. Try system Python
    console.warn('[DualPythonEnv] No venv found for WhisperX, trying system Python')
    return this.findSystemPython()
  }

  /**
   * Get the Python path for Pyannote diarization operations
   * Priority: venv-pyannote > fallback venv > system
   */
  getPyannotePythonPath(): string | null {
    // 1. Check for dedicated Pyannote venv
    const pyannotePython = this.getVenvPythonPath(PYANNOTE_VENV_NAME)
    if (pyannotePython) {
      return pyannotePython
    }

    // 2. Try fallback venv (may have pyannote with mixed torch version)
    const fallback = this.findFallbackVenv()
    if (fallback) {
      console.warn('[DualPythonEnv] Pyannote venv not found, using fallback venv (may have torch conflicts)')
      return fallback
    }

    // 3. Try system Python
    console.warn('[DualPythonEnv] No venv found for Pyannote, trying system Python')
    return this.findSystemPython()
  }

  /**
   * Get the appropriate Python path based on the operation type
   */
  getPythonPathForOperation(purpose: EnvironmentPurpose): string | null {
    switch (purpose) {
      case 'whisperx':
        return this.getWhisperXPythonPath()
      case 'pyannote':
        return this.getPyannotePythonPath()
      default:
        return this.getWhisperXPythonPath() // Default to transcription
    }
  }

  /**
   * Check the status of a single environment
   */
  private async checkSingleEnvironment(
    purpose: EnvironmentPurpose,
    pythonPath: string | null
  ): Promise<SingleEnvironmentStatus> {
    const expectedTorchVersion = purpose === 'whisperx' ? WHISPERX_TORCH_VERSION : PYANNOTE_TORCH_VERSION

    const status: SingleEnvironmentStatus = {
      available: false,
      pythonPath,
      version: null,
      expectedTorchVersion,
      actualTorchVersion: null,
      torchVersionMatch: false,
      packages: {},
      errors: [],
      recommendations: [],
    }

    if (!pythonPath) {
      status.errors.push(`No Python environment found for ${purpose}`)
      status.recommendations.push(
        `Create virtual environment: python3 -m venv python/${purpose === 'whisperx' ? WHISPERX_VENV_NAME : PYANNOTE_VENV_NAME}`,
        `Install dependencies: pip install -r python/requirements-${purpose}.txt`
      )
      return status
    }

    if (!fs.existsSync(pythonPath)) {
      status.errors.push(`Python executable not found at: ${pythonPath}`)
      return status
    }

    try {
      const execOptions = {
        encoding: 'utf8' as const,
        timeout: 30000,
        env: {
          ...process.env,
          PYTHONWARNINGS: 'ignore::UserWarning,ignore::DeprecationWarning,ignore::FutureWarning',
        },
      }

      // Get Python version
      const versionOutput = execSync(`"${pythonPath}" --version 2>&1`, execOptions)
      const versionMatch = versionOutput.match(/Python\s+(\d+\.\d+\.\d+)/)
      if (versionMatch) {
        status.version = versionMatch[1]
      }

      // Check torch version
      try {
        const torchVersion = execSync(`"${pythonPath}" -c "import torch; print(torch.__version__)" 2>&1`, execOptions).trim()
        status.actualTorchVersion = torchVersion
        status.packages.torch = true

        // Check if torch version matches expected (just major.minor comparison)
        const actualMajorMinor = torchVersion.split('.').slice(0, 2).join('.')
        const expectedMajorMinor = expectedTorchVersion.split('.').slice(0, 2).join('.')
        status.torchVersionMatch = actualMajorMinor === expectedMajorMinor

        if (!status.torchVersionMatch) {
          status.errors.push(`Torch version mismatch: expected ${expectedTorchVersion}, got ${torchVersion}`)
          status.recommendations.push(
            `Recreate the venv with correct torch: pip install torch==${expectedTorchVersion}`
          )
        }
      } catch (e) {
        status.packages.torch = false
        status.errors.push('torch not installed')
      }

      // Check purpose-specific packages
      if (purpose === 'whisperx') {
        // Check WhisperX
        try {
          execSync(`"${pythonPath}" -c "import whisperx" 2>&1`, execOptions)
          status.packages.whisperx = true
        } catch {
          status.packages.whisperx = false
        }

        // Check faster-whisper
        try {
          execSync(`"${pythonPath}" -c "from faster_whisper import WhisperModel" 2>&1`, execOptions)
          status.packages.fasterWhisper = true
        } catch {
          status.packages.fasterWhisper = false
        }

        if (!status.packages.whisperx && !status.packages.fasterWhisper) {
          status.errors.push('No transcription backend available (whisperx or faster-whisper)')
          status.recommendations.push('Install: pip install whisperx faster-whisper')
        }
      } else {
        // Check Pyannote
        try {
          execSync(`"${pythonPath}" -c "from pyannote.audio import Pipeline" 2>&1`, execOptions)
          status.packages.pyannote = true
        } catch {
          status.packages.pyannote = false
        }

        // Check speechbrain
        try {
          execSync(`"${pythonPath}" -c "import speechbrain" 2>&1`, execOptions)
          status.packages.speechbrain = true
        } catch {
          status.packages.speechbrain = false
        }

        if (!status.packages.pyannote) {
          status.errors.push('pyannote.audio not available for diarization')
          status.recommendations.push('Install: pip install pyannote.audio')
        }
      }

      // Determine if environment is available
      if (purpose === 'whisperx') {
        status.available = (status.packages.whisperx || status.packages.fasterWhisper || false) && status.torchVersionMatch
      } else {
        status.available = (status.packages.pyannote || false) && status.torchVersionMatch
      }

    } catch (error) {
      status.errors.push(`Failed to check environment: ${error instanceof Error ? error.message : String(error)}`)
    }

    return status
  }

  /**
   * Check both Python environments
   */
  async checkBothEnvironments(forceRefresh = false): Promise<DualEnvironmentStatus> {
    // Return cached status if valid
    if (!forceRefresh && this.cachedStatus && Date.now() - this.cacheTimestamp < this.CACHE_TTL) {
      return this.cachedStatus
    }

    console.log('[DualPythonEnv] Checking both Python environments...')

    const platform = {
      os: process.platform,
      arch: process.arch,
      isAppleSilicon: process.platform === 'darwin' && process.arch === 'arm64',
    }

    const whisperxPath = this.getWhisperXPythonPath()
    const pyannotePath = this.getPyannotePythonPath()

    // Check both environments in parallel
    const [whisperxStatus, pyannoteStatus] = await Promise.all([
      this.checkSingleEnvironment('whisperx', whisperxPath),
      this.checkSingleEnvironment('pyannote', pyannotePath),
    ])

    // Determine environment type
    let type: DualEnvironmentType = 'none'
    if (this.getBundlePath()) {
      type = 'bundled'
    } else if (this.getVenvPythonPath(WHISPERX_VENV_NAME) && this.getVenvPythonPath(PYANNOTE_VENV_NAME)) {
      type = 'dual-venv'
    } else if (this.findFallbackVenv()) {
      type = 'single-venv'
    } else if (this.findSystemPython()) {
      type = 'system'
    }

    const status: DualEnvironmentStatus = {
      type,
      ready: whisperxStatus.available && pyannoteStatus.available,
      whisperx: whisperxStatus,
      pyannote: pyannoteStatus,
      platform,
      errors: [...whisperxStatus.errors, ...pyannoteStatus.errors],
      recommendations: [...whisperxStatus.recommendations, ...pyannoteStatus.recommendations],
      firstRunRequired: !whisperxStatus.available || !pyannoteStatus.available,
    }

    // Add type-specific recommendations
    if (type === 'single-venv') {
      status.recommendations.unshift(
        'Consider creating separate environments to avoid torch version conflicts:',
        `  1. python3 -m venv python/${WHISPERX_VENV_NAME}`,
        `  2. python3 -m venv python/${PYANNOTE_VENV_NAME}`,
        `  3. Install requirements: pip install -r requirements-whisperx.txt / requirements-pyannote.txt`
      )
    }

    // Remove duplicate recommendations
    status.recommendations = [...new Set(status.recommendations)]

    // Cache the result
    this.cachedStatus = status
    this.cacheTimestamp = Date.now()

    console.log(`[DualPythonEnv] Status: type=${type}, ready=${status.ready}, whisperx=${whisperxStatus.available}, pyannote=${pyannoteStatus.available}`)

    return status
  }

  /**
   * Validate that an environment is ready for a specific operation
   */
  async validateForOperation(purpose: EnvironmentPurpose): Promise<EnvironmentValidationResult> {
    const status = await this.checkBothEnvironments()
    const envStatus = purpose === 'whisperx' ? status.whisperx : status.pyannote

    return {
      valid: envStatus.available,
      environment: purpose,
      pythonPath: envStatus.pythonPath,
      errors: envStatus.errors,
      warnings: envStatus.torchVersionMatch ? [] : [`Torch version mismatch may cause issues`],
    }
  }

  /**
   * Check if dual environment setup is available
   */
  isDualEnvironmentAvailable(): boolean {
    return (
      this.getVenvPythonPath(WHISPERX_VENV_NAME) !== null &&
      this.getVenvPythonPath(PYANNOTE_VENV_NAME) !== null
    )
  }

  /**
   * Get setup instructions for creating the dual environment
   */
  getSetupInstructions(): string[] {
    const pythonDir = this.getPythonScriptsDir()
    return [
      '=== Dual Python Environment Setup ===',
      '',
      'This setup creates two isolated virtual environments to avoid torch version conflicts.',
      '',
      '1. Create WhisperX environment (torch 2.8):',
      `   cd "${pythonDir}"`,
      `   python3 -m venv ${WHISPERX_VENV_NAME}`,
      `   source ${WHISPERX_VENV_NAME}/bin/activate`,
      '   pip install -r requirements-whisperx.txt',
      '   deactivate',
      '',
      '2. Create Pyannote environment (torch 2.5.1):',
      `   cd "${pythonDir}"`,
      `   python3 -m venv ${PYANNOTE_VENV_NAME}`,
      `   source ${PYANNOTE_VENV_NAME}/bin/activate`,
      '   pip install -r requirements-pyannote.txt',
      '   deactivate',
      '',
      '3. Verify setup:',
      '   Run the app and check Settings > Audio > Python Environment Diagnostics',
      '',
      'NOTE: The app will automatically use the correct environment for each operation.',
    ]
  }

  /**
   * Spawn a process using the appropriate Python environment
   */
  spawnProcess(
    purpose: EnvironmentPurpose,
    scriptName: string,
    scriptArgs: string[] = [],
    options: {
      cwd?: string
      env?: Record<string, string>
    } = {}
  ): ChildProcess | null {
    const pythonPath = this.getPythonPathForOperation(purpose)

    if (!pythonPath) {
      console.error(`[DualPythonEnv] No Python path available for ${purpose}`)
      return null
    }

    const scriptsDir = this.getPythonScriptsDir()
    const isBundled = pythonPath.includes('transcription_bundle')

    let command: string
    let args: string[]

    if (isBundled) {
      // Bundled executable uses subcommands
      command = pythonPath
      args = [scriptName.replace('.py', ''), ...scriptArgs]
    } else {
      // Regular Python execution
      command = pythonPath
      const scriptPath = path.join(scriptsDir, scriptName)

      if (!fs.existsSync(scriptPath)) {
        console.error(`[DualPythonEnv] Script not found: ${scriptPath}`)
        return null
      }

      args = [scriptPath, ...scriptArgs]
    }

    const processEnv = {
      ...process.env,
      ...(options.env || {}),
      PYTHONUNBUFFERED: '1',
      TORCH_FORCE_NO_WEIGHTS_ONLY_LOAD: '1',
      PYTHONWARNINGS: 'ignore::UserWarning,ignore::DeprecationWarning,ignore::FutureWarning',
    }

    console.log(`[DualPythonEnv] Spawning ${purpose} process: ${command} ${args.slice(0, 2).join(' ')}...`)

    return spawn(command, args, {
      cwd: options.cwd || scriptsDir,
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
   * Get the HuggingFace token (needed for Pyannote models)
   */
  getHuggingFaceToken(): string | null {
    try {
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
}

// Export singleton instance
export const dualPythonEnvironment = new DualPythonEnvironmentService()

// Export class for testing
export { DualPythonEnvironmentService }
