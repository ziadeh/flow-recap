/**
 * Python Environment Setup Service
 *
 * This service manages the automated setup of Python virtual environments
 * for WhisperX (transcription) and Pyannote (speaker diarization).
 *
 * Features:
 * - Runs platform-specific setup scripts (bash/batch)
 * - Parses progress output for UI updates
 * - Handles errors with remediation steps
 * - Manages environment metadata
 * - Supports repair/reinstall operations
 *
 * Usage:
 *   import { pythonSetupService } from './pythonSetupService'
 *
 *   // Start setup with progress callback
 *   const result = await pythonSetupService.runSetup({
 *     onProgress: (progress) => console.log(progress),
 *     skipModels: false,
 *     force: false
 *   })
 *
 *   // Check if setup is needed
 *   const needed = await pythonSetupService.isSetupRequired()
 *
 *   // Repair environments
 *   await pythonSetupService.repairEnvironments()
 */

import { spawn, ChildProcess } from 'child_process'
import * as path from 'path'
import * as fs from 'fs'
import { EventEmitter } from 'events'
import { pythonEnvironment } from './pythonEnvironment'
import { pythonValidationCacheService } from './pythonValidationCacheService'

// Electron app is imported dynamically to support testing outside Electron context
let app: { isPackaged?: boolean; getPath?: (name: string) => string } | undefined
try {
  app = require('electron').app
} catch {
  app = undefined
}

// ============================================================================
// Types
// ============================================================================

export interface SetupStep {
  id: string
  name: string
  description: string
  estimatedTime?: string
}

export interface SetupProgress {
  /** Current step being executed */
  step: string
  /** Progress percentage (0-100) */
  percentage: number
  /** Human-readable message */
  message: string
  /** Estimated time remaining */
  estimatedTime?: string
  /** Timestamp */
  timestamp: string
  /** Type of progress event */
  type: 'progress' | 'success' | 'error' | 'warning' | 'step_complete' | 'complete' | 'remediation'
  /** Error code if applicable */
  code?: number
  /** Remediation steps if applicable */
  remediationSteps?: string[]
}

export interface SetupOptions {
  /** Skip model download */
  skipModels?: boolean
  /** Force recreate environments even if they exist */
  force?: boolean
  /** Reduce output verbosity */
  quiet?: boolean
  /** Progress callback */
  onProgress?: (progress: SetupProgress) => void
  /** HuggingFace token (optional, uses environment variable if not provided) */
  hfToken?: string
}

export interface SetupResult {
  /** Whether setup completed successfully */
  success: boolean
  /** Error message if failed */
  error?: string
  /** Exit code from setup script */
  exitCode: number
  /** Duration in milliseconds */
  duration: number
  /** Environment metadata if available */
  metadata?: EnvironmentMetadata
  /** Remediation steps if setup failed */
  remediationSteps?: string[]
}

export interface EnvironmentInfo {
  path: string
  pythonVersion: string
  packages: Record<string, string>
  purpose: 'transcription' | 'diarization'
  status: 'ready' | 'error' | 'missing'
}

export interface EnvironmentMetadata {
  schemaVersion: number
  createdAt: string
  updatedAt: string
  setupScript: string
  systemPython: {
    version: string
    path: string
  }
  environments: {
    whisperx: EnvironmentInfo
    pyannote: EnvironmentInfo
  }
  models: {
    downloaded: boolean
    hfTokenConfigured: boolean
  }
  platform: {
    os: string
    arch: string
    osVersion?: string
  }
}

export type SetupStatus = 'idle' | 'running' | 'completed' | 'failed' | 'cancelled'

export interface SetupState {
  status: SetupStatus
  progress: number
  currentStep: string
  error?: string
  startTime?: number
  endTime?: number
}

// ============================================================================
// Constants
// ============================================================================

const SETUP_STEPS: SetupStep[] = [
  { id: 'detect_python', name: 'Detect Python', description: 'Finding Python 3.12 installation', estimatedTime: '10s' },
  { id: 'check_deps', name: 'Check Dependencies', description: 'Verifying system dependencies', estimatedTime: '5s' },
  { id: 'create_venv-whisperx', name: 'Create WhisperX Environment', description: 'Creating virtual environment', estimatedTime: '30s' },
  { id: 'install_venv-whisperx', name: 'Install WhisperX', description: 'Installing transcription dependencies', estimatedTime: '5-10 min' },
  { id: 'verify_venv-whisperx', name: 'Verify WhisperX', description: 'Testing WhisperX installation', estimatedTime: '30s' },
  { id: 'create_venv-pyannote', name: 'Create Pyannote Environment', description: 'Creating virtual environment', estimatedTime: '30s' },
  { id: 'install_venv-pyannote', name: 'Install Pyannote', description: 'Installing diarization dependencies', estimatedTime: '5-10 min' },
  { id: 'verify_venv-pyannote', name: 'Verify Pyannote', description: 'Testing Pyannote installation', estimatedTime: '30s' },
  { id: 'download_models', name: 'Download Models', description: 'Downloading ML models', estimatedTime: '10-20 min' },
  { id: 'generate_metadata', name: 'Generate Metadata', description: 'Saving environment information', estimatedTime: '5s' },
  { id: 'complete', name: 'Complete', description: 'Setup finished', estimatedTime: '0s' }
]

// ============================================================================
// Python Setup Service
// ============================================================================

class PythonSetupService extends EventEmitter {
  private currentProcess: ChildProcess | null = null
  private state: SetupState = {
    status: 'idle',
    progress: 0,
    currentStep: ''
  }

  /**
   * Get the Python scripts directory
   */
  private getPythonScriptsDir(): string {
    if (app?.isPackaged) {
      return path.join(process.resourcesPath || '', 'python')
    }
    // In development, __dirname is dist-electron
    // Go up one level to project root, then into python directory
    return path.join(__dirname, '../python')
  }

  /**
   * Get the path to the setup script for the current platform
   */
  private getSetupScriptPath(): string {
    const pythonDir = this.getPythonScriptsDir()
    if (process.platform === 'win32') {
      return path.join(pythonDir, 'setup_environments.bat')
    }
    return path.join(pythonDir, 'setup_environments.sh')
  }

  /**
   * Get the path to the environment metadata file
   */
  private getMetadataPath(): string {
    return path.join(this.getPythonScriptsDir(), '.env.json')
  }

  /**
   * Check if setup scripts exist
   */
  setupScriptsExist(): boolean {
    const scriptPath = this.getSetupScriptPath()
    return fs.existsSync(scriptPath)
  }

  /**
   * Check if environment metadata exists and is valid
   */
  hasValidMetadata(): boolean {
    const metadataPath = this.getMetadataPath()
    if (!fs.existsSync(metadataPath)) {
      return false
    }

    try {
      const metadata = JSON.parse(fs.readFileSync(metadataPath, 'utf8')) as EnvironmentMetadata
      return (
        metadata.schemaVersion === 1 &&
        metadata.environments?.whisperx?.status === 'ready' &&
        metadata.environments?.pyannote?.status === 'ready'
      )
    } catch {
      return false
    }
  }

  /**
   * Load environment metadata
   */
  loadMetadata(): EnvironmentMetadata | null {
    const metadataPath = this.getMetadataPath()
    if (!fs.existsSync(metadataPath)) {
      return null
    }

    try {
      return JSON.parse(fs.readFileSync(metadataPath, 'utf8')) as EnvironmentMetadata
    } catch {
      return null
    }
  }

  /**
   * Check if setup is required
   * Returns true if environments don't exist or are invalid
   */
  async isSetupRequired(): Promise<boolean> {
    // Check if metadata exists and is valid
    if (!this.hasValidMetadata()) {
      return true
    }

    const pythonDir = this.getPythonScriptsDir()

    // Check if both venvs exist
    const whisperxPath = process.platform === 'win32'
      ? path.join(pythonDir, 'venv-whisperx', 'Scripts', 'python.exe')
      : path.join(pythonDir, 'venv-whisperx', 'bin', 'python')
    const pyannotePath = process.platform === 'win32'
      ? path.join(pythonDir, 'venv-pyannote', 'Scripts', 'python.exe')
      : path.join(pythonDir, 'venv-pyannote', 'bin', 'python')

    if (!fs.existsSync(whisperxPath) || !fs.existsSync(pyannotePath)) {
      return true
    }

    return false
  }

  /**
   * Get current setup state
   */
  getState(): SetupState {
    return { ...this.state }
  }

  /**
   * Get setup steps
   */
  getSteps(): SetupStep[] {
    return [...SETUP_STEPS]
  }

  /**
   * Parse JSON progress output from setup script
   */
  private parseProgressLine(line: string): SetupProgress | null {
    const trimmed = line.trim()
    if (!trimmed.startsWith('{')) {
      return null
    }

    try {
      return JSON.parse(trimmed) as SetupProgress
    } catch {
      return null
    }
  }

  /**
   * Run the setup script
   */
  async runSetup(options: SetupOptions = {}): Promise<SetupResult> {
    const {
      skipModels = false,
      force = false,
      quiet = false,
      onProgress,
      hfToken
    } = options

    // Check if already running
    if (this.state.status === 'running') {
      return {
        success: false,
        error: 'Setup is already running',
        exitCode: -1,
        duration: 0
      }
    }

    // Check if script exists
    const scriptPath = this.getSetupScriptPath()
    if (!fs.existsSync(scriptPath)) {
      return {
        success: false,
        error: `Setup script not found: ${scriptPath}`,
        exitCode: -1,
        duration: 0,
        remediationSteps: [
          'Ensure the application is installed correctly',
          'Check that python/setup_environments.sh (or .bat on Windows) exists'
        ]
      }
    }

    // Update state
    const startTime = Date.now()
    this.state = {
      status: 'running',
      progress: 0,
      currentStep: 'Starting setup...',
      startTime
    }
    this.emit('stateChange', this.state)

    return new Promise<SetupResult>((resolve) => {
      // Build command arguments
      const args: string[] = ['--json']
      if (skipModels) args.push('--skip-models')
      if (force) args.push('--force')
      if (quiet) args.push('--quiet')

      // Set up environment
      const env: Record<string, string> = { ...process.env } as Record<string, string>
      if (hfToken) {
        env.HF_TOKEN = hfToken
      }

      // Spawn the process
      let command: string
      let spawnArgs: string[]

      if (process.platform === 'win32') {
        command = 'cmd.exe'
        spawnArgs = ['/c', scriptPath, ...args]
      } else {
        command = 'bash'
        spawnArgs = [scriptPath, ...args]
      }

      this.currentProcess = spawn(command, spawnArgs, {
        cwd: this.getPythonScriptsDir(),
        env,
        stdio: ['pipe', 'pipe', 'pipe']
      })

      let stdout = ''
      let stderr = ''
      let lastProgress: SetupProgress | null = null
      let remediationSteps: string[] = []

      // Handle stdout
      this.currentProcess.stdout?.on('data', (data: Buffer) => {
        const text = data.toString()
        stdout += text

        // Parse progress lines
        const lines = text.split('\n')
        for (const line of lines) {
          const progress = this.parseProgressLine(line)
          if (progress) {
            lastProgress = progress

            // Update state
            this.state.progress = progress.percentage
            this.state.currentStep = progress.message

            // Collect remediation steps
            if (progress.type === 'remediation' && progress.remediationSteps) {
              remediationSteps = progress.remediationSteps
            }

            // Emit progress
            if (onProgress) {
              onProgress(progress)
            }
            this.emit('progress', progress)
          }
        }
      })

      // Handle stderr (also used for progress in some cases)
      this.currentProcess.stderr?.on('data', (data: Buffer) => {
        const text = data.toString()
        stderr += text

        // Also try to parse progress from stderr
        const lines = text.split('\n')
        for (const line of lines) {
          const progress = this.parseProgressLine(line)
          if (progress) {
            lastProgress = progress

            this.state.progress = progress.percentage
            this.state.currentStep = progress.message

            if (progress.type === 'remediation' && progress.remediationSteps) {
              remediationSteps = progress.remediationSteps
            }

            if (onProgress) {
              onProgress(progress)
            }
            this.emit('progress', progress)
          }
        }
      })

      // Handle process exit
      this.currentProcess.on('exit', (code) => {
        const duration = Date.now() - startTime
        const exitCode = code ?? 1

        // Update state
        this.state = {
          status: exitCode === 0 ? 'completed' : 'failed',
          progress: exitCode === 0 ? 100 : this.state.progress,
          currentStep: exitCode === 0 ? 'Setup completed' : 'Setup failed',
          startTime,
          endTime: Date.now(),
          error: exitCode !== 0 ? `Setup failed with exit code ${exitCode}` : undefined
        }
        this.emit('stateChange', this.state)

        // Load metadata if successful
        let metadata: EnvironmentMetadata | undefined
        if (exitCode === 0) {
          metadata = this.loadMetadata() ?? undefined

          // Clear Python environment cache so it detects the new venvs
          try {
            pythonEnvironment.clearCache()
          } catch (error) {
            // Ignore cache clear errors
          }

          // Clear validation cache so status is re-validated
          // This ensures banners and status indicators get fresh status after setup
          try {
            pythonValidationCacheService.invalidateAllCaches()
          } catch (error) {
            // Ignore cache clear errors
          }
        }

        const result: SetupResult = {
          success: exitCode === 0,
          error: exitCode !== 0 ? (lastProgress?.message || stderr || 'Setup failed') : undefined,
          exitCode,
          duration,
          metadata,
          remediationSteps: remediationSteps.length > 0 ? remediationSteps : undefined
        }

        this.currentProcess = null
        resolve(result)
      })

      // Handle process error
      this.currentProcess.on('error', (error) => {
        const duration = Date.now() - startTime

        this.state = {
          status: 'failed',
          progress: this.state.progress,
          currentStep: 'Setup failed',
          startTime,
          endTime: Date.now(),
          error: error.message
        }
        this.emit('stateChange', this.state)

        const result: SetupResult = {
          success: false,
          error: error.message,
          exitCode: -1,
          duration,
          remediationSteps: [
            'Check that Python 3.12 is installed',
            'Ensure you have permission to create directories',
            'Try running the setup script manually'
          ]
        }

        this.currentProcess = null
        resolve(result)
      })
    })
  }

  /**
   * Cancel running setup
   */
  cancelSetup(): boolean {
    if (!this.currentProcess) {
      return false
    }

    this.currentProcess.kill('SIGTERM')

    // Force kill after 5 seconds if still running
    setTimeout(() => {
      if (this.currentProcess && !this.currentProcess.killed) {
        this.currentProcess.kill('SIGKILL')
      }
    }, 5000)

    this.state = {
      status: 'cancelled',
      progress: this.state.progress,
      currentStep: 'Setup cancelled',
      startTime: this.state.startTime,
      endTime: Date.now()
    }
    this.emit('stateChange', this.state)

    return true
  }

  /**
   * Repair environments by running setup with force flag
   */
  async repairEnvironments(options: Omit<SetupOptions, 'force'> = {}): Promise<SetupResult> {
    return this.runSetup({ ...options, force: true })
  }

  /**
   * Check if HuggingFace token is configured
   */
  isHfTokenConfigured(): boolean {
    const metadata = this.loadMetadata()
    if (metadata?.models?.hfTokenConfigured) {
      return true
    }
    return !!(process.env.HF_TOKEN || process.env.HUGGING_FACE_HUB_TOKEN)
  }

  /**
   * Get estimated total setup time
   */
  getEstimatedSetupTime(skipModels: boolean = false): string {
    if (skipModels) {
      return '15-25 minutes'
    }
    return '25-45 minutes'
  }

  /**
   * Get Python environment paths
   */
  getEnvironmentPaths(): { whisperx: string; pyannote: string } {
    const pythonDir = this.getPythonScriptsDir()
    const ext = process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python'
    return {
      whisperx: path.join(pythonDir, 'venv-whisperx', ext),
      pyannote: path.join(pythonDir, 'venv-pyannote', ext)
    }
  }

  /**
   * Reset service state
   */
  reset(): void {
    if (this.currentProcess) {
      this.cancelSetup()
    }
    this.state = {
      status: 'idle',
      progress: 0,
      currentStep: ''
    }
    this.emit('stateChange', this.state)
  }
}

// Export singleton instance
export const pythonSetupService = new PythonSetupService()

// Export class for testing
export { PythonSetupService }
