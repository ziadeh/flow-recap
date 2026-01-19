/**
 * ML Preloader Service
 *
 * Implements background preloading of ML dependencies (WhisperX, PyAnnote, diarization)
 * after app launch to warm up dependencies without blocking initial UI render.
 *
 * Key features:
 * - Defers initialization of WhisperX, PyAnnote, and diarization modules until recording starts
 * - Implements background preloading after app launch
 * - Warms up Python environments and caches import results
 * - Non-blocking to ensure smooth UI render
 * - Tracks preload status for just-in-time initialization when recording starts
 *
 * Preload strategy:
 * 1. After Tier 2 validation completes (background), start preloading
 * 2. Preload WhisperX/faster-whisper for transcription
 * 3. Preload PyAnnote for diarization (in parallel if dual-venv)
 * 4. Cache preload results to speed up subsequent starts
 */

import { EventEmitter } from 'events'
import { spawn, ChildProcess } from 'child_process'
import { pythonEnvironment } from './pythonEnvironment'
import { loggerService } from './loggerService'

// ============================================================================
// Types
// ============================================================================

export type PreloadStatus = 'idle' | 'preloading' | 'ready' | 'partial' | 'failed'

export interface PreloadModuleStatus {
  name: string
  status: 'idle' | 'loading' | 'ready' | 'failed'
  duration?: number
  error?: string
  lastPreloaded?: string // ISO timestamp
}

export interface PreloadState {
  overall: PreloadStatus
  whisperx: PreloadModuleStatus
  pyannote: PreloadModuleStatus
  torch: PreloadModuleStatus
  startTime?: number
  endTime?: number
  totalDuration?: number
}

export interface PreloadResult {
  success: boolean
  modules: {
    whisperx: boolean
    pyannote: boolean
    torch: boolean
  }
  errors: string[]
  duration: number
}

// ============================================================================
// Constants
// ============================================================================

const PRELOAD_TIMEOUT = 60000 // 60 seconds max per module
const PARALLEL_PRELOAD = true // Use parallel preloading when possible

// ============================================================================
// ML Preloader Service
// ============================================================================

class MLPreloaderService extends EventEmitter {
  private state: PreloadState = {
    overall: 'idle',
    whisperx: { name: 'whisperx', status: 'idle' },
    pyannote: { name: 'pyannote', status: 'idle' },
    torch: { name: 'torch', status: 'idle' }
  }

  private preloadPromise: Promise<PreloadResult> | null = null
  private abortController: AbortController | null = null
  private activeProcesses: ChildProcess[] = []

  // ============================================================================
  // Public API
  // ============================================================================

  /**
   * Get current preload state
   */
  getState(): PreloadState {
    return { ...this.state }
  }

  /**
   * Check if preloading is complete or ready
   */
  isReady(): boolean {
    return this.state.overall === 'ready' || this.state.overall === 'partial'
  }

  /**
   * Check if preloading is in progress
   */
  isPreloading(): boolean {
    return this.state.overall === 'preloading'
  }

  /**
   * Start background preloading of ML modules
   * This is non-blocking and runs in the background after Tier 2 validation
   */
  async startPreload(): Promise<PreloadResult> {
    // If already preloading, return existing promise
    if (this.preloadPromise) {
      loggerService.debug('[MLPreloader] Preload already in progress, returning existing promise')
      return this.preloadPromise
    }

    // If already ready, return cached result
    if (this.isReady()) {
      loggerService.debug('[MLPreloader] Already preloaded, returning cached result')
      return {
        success: true,
        modules: {
          whisperx: this.state.whisperx.status === 'ready',
          pyannote: this.state.pyannote.status === 'ready',
          torch: this.state.torch.status === 'ready'
        },
        errors: [],
        duration: this.state.totalDuration || 0
      }
    }

    // Start preloading
    this.preloadPromise = this._executePreload()

    try {
      const result = await this.preloadPromise
      return result
    } finally {
      this.preloadPromise = null
    }
  }

  /**
   * Preload specific module (for just-in-time initialization)
   */
  async preloadModule(moduleName: 'whisperx' | 'pyannote' | 'torch'): Promise<boolean> {
    const moduleState = this.state[moduleName]

    if (moduleState.status === 'ready') {
      return true
    }

    if (moduleState.status === 'loading') {
      // Wait for existing preload to complete
      await this.waitForModule(moduleName)
      return this.state[moduleName].status === 'ready'
    }

    // Start preload for this specific module
    const startTime = Date.now()
    this.updateModuleStatus(moduleName, 'loading')

    try {
      const success = await this._preloadSingleModule(moduleName)
      const duration = Date.now() - startTime

      this.updateModuleStatus(moduleName, success ? 'ready' : 'failed', duration)
      return success
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error)
      this.updateModuleStatus(moduleName, 'failed', undefined, errorMessage)
      return false
    }
  }

  /**
   * Wait for a specific module to finish preloading
   */
  async waitForModule(moduleName: 'whisperx' | 'pyannote' | 'torch', timeout = 30000): Promise<boolean> {
    const startTime = Date.now()

    while (Date.now() - startTime < timeout) {
      const status = this.state[moduleName].status

      if (status === 'ready') return true
      if (status === 'failed') return false

      // Wait 100ms before checking again
      await new Promise(resolve => setTimeout(resolve, 100))
    }

    return false
  }

  /**
   * Wait for all modules to finish preloading
   */
  async waitForAll(timeout = 60000): Promise<boolean> {
    if (this.preloadPromise) {
      const result = await Promise.race([
        this.preloadPromise,
        new Promise<null>(resolve => setTimeout(() => resolve(null), timeout))
      ])

      return result !== null && result.success
    }

    return this.isReady()
  }

  /**
   * Cancel any ongoing preload operations
   */
  cancelPreload(): void {
    if (this.abortController) {
      this.abortController.abort()
    }

    // Kill any active Python processes
    for (const proc of this.activeProcesses) {
      try {
        proc.kill('SIGTERM')
      } catch (e) {
        // Ignore errors during cleanup
      }
    }

    this.activeProcesses = []
    this.preloadPromise = null

    loggerService.info('[MLPreloader] Preload cancelled')
    this.emit('preload:cancelled')
  }

  /**
   * Reset preload state (for testing or re-initialization)
   */
  reset(): void {
    this.cancelPreload()

    this.state = {
      overall: 'idle',
      whisperx: { name: 'whisperx', status: 'idle' },
      pyannote: { name: 'pyannote', status: 'idle' },
      torch: { name: 'torch', status: 'idle' }
    }

    loggerService.info('[MLPreloader] State reset')
    this.emit('preload:reset')
  }

  // ============================================================================
  // Private Implementation
  // ============================================================================

  private async _executePreload(): Promise<PreloadResult> {
    const startTime = Date.now()
    this.state.startTime = startTime
    this.state.overall = 'preloading'
    this.abortController = new AbortController()

    loggerService.info('[MLPreloader] Starting background preload of ML modules')
    this.emit('preload:start')

    const errors: string[] = []
    const results = {
      whisperx: false,
      pyannote: false,
      torch: false
    }

    try {
      const envType = pythonEnvironment.getEnvironmentType()
      const isDualVenv = envType === 'dual-venv'

      // Preload torch first as it's shared
      this.updateModuleStatus('torch', 'loading')
      const torchStart = Date.now()

      try {
        results.torch = await this._preloadTorch()
        this.updateModuleStatus('torch', results.torch ? 'ready' : 'failed', Date.now() - torchStart)
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error)
        errors.push(`Torch: ${errorMsg}`)
        this.updateModuleStatus('torch', 'failed', Date.now() - torchStart, errorMsg)
      }

      // Preload whisperx and pyannote (parallel if dual-venv)
      if (PARALLEL_PRELOAD && isDualVenv) {
        // Parallel preload for dual-venv
        const [whisperxResult, pyannoteResult] = await Promise.allSettled([
          this._preloadWhisperX(),
          this._preloadPyAnnote()
        ])

        if (whisperxResult.status === 'fulfilled') {
          results.whisperx = whisperxResult.value
          this.updateModuleStatus('whisperx', results.whisperx ? 'ready' : 'failed')
        } else {
          errors.push(`WhisperX: ${whisperxResult.reason}`)
          this.updateModuleStatus('whisperx', 'failed', undefined, String(whisperxResult.reason))
        }

        if (pyannoteResult.status === 'fulfilled') {
          results.pyannote = pyannoteResult.value
          this.updateModuleStatus('pyannote', results.pyannote ? 'ready' : 'failed')
        } else {
          errors.push(`PyAnnote: ${pyannoteResult.reason}`)
          this.updateModuleStatus('pyannote', 'failed', undefined, String(pyannoteResult.reason))
        }
      } else {
        // Sequential preload
        this.updateModuleStatus('whisperx', 'loading')
        const whisperxStart = Date.now()

        try {
          results.whisperx = await this._preloadWhisperX()
          this.updateModuleStatus('whisperx', results.whisperx ? 'ready' : 'failed', Date.now() - whisperxStart)
        } catch (error) {
          const errorMsg = error instanceof Error ? error.message : String(error)
          errors.push(`WhisperX: ${errorMsg}`)
          this.updateModuleStatus('whisperx', 'failed', Date.now() - whisperxStart, errorMsg)
        }

        this.updateModuleStatus('pyannote', 'loading')
        const pyannoteStart = Date.now()

        try {
          results.pyannote = await this._preloadPyAnnote()
          this.updateModuleStatus('pyannote', results.pyannote ? 'ready' : 'failed', Date.now() - pyannoteStart)
        } catch (error) {
          const errorMsg = error instanceof Error ? error.message : String(error)
          errors.push(`PyAnnote: ${errorMsg}`)
          this.updateModuleStatus('pyannote', 'failed', Date.now() - pyannoteStart, errorMsg)
        }
      }
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error)
      errors.push(`General: ${errorMsg}`)
      loggerService.error('[MLPreloader] Preload error:', error)
    }

    const endTime = Date.now()
    const duration = endTime - startTime

    this.state.endTime = endTime
    this.state.totalDuration = duration

    // Determine overall status
    const allReady = results.whisperx && results.pyannote && results.torch
    const anyReady = results.whisperx || results.pyannote || results.torch

    this.state.overall = allReady ? 'ready' : anyReady ? 'partial' : 'failed'

    const result: PreloadResult = {
      success: anyReady,
      modules: results,
      errors,
      duration
    }

    loggerService.info(`[MLPreloader] Preload complete: ${this.state.overall} (${duration}ms)`, {
      modules: results,
      errors: errors.length > 0 ? errors : undefined
    })

    this.emit('preload:complete', result)
    return result
  }

  private async _preloadTorch(): Promise<boolean> {
    const pythonPath = pythonEnvironment.getPythonPath()
    if (!pythonPath) {
      loggerService.warn('[MLPreloader] No Python path available for torch preload')
      return false
    }

    const code = `
import torch
import sys
# Warm up torch by checking device availability
device = 'cuda' if torch.cuda.is_available() else 'mps' if hasattr(torch.backends, 'mps') and torch.backends.mps.is_available() else 'cpu'
# Create small tensor to warm up
_ = torch.zeros(1, device=device)
print(f'torch:{device}:ready')
sys.exit(0)
`
    return this._runPythonPreload(pythonPath, code, 'torch')
  }

  private async _preloadWhisperX(): Promise<boolean> {
    const pythonPath = pythonEnvironment.getPythonPathForPurpose('whisperx') || pythonEnvironment.getPythonPath()
    if (!pythonPath) {
      loggerService.warn('[MLPreloader] No Python path available for whisperx preload')
      return false
    }

    const code = `
import sys
import warnings
warnings.filterwarnings('ignore')
try:
    import whisperx
    import faster_whisper
    print('whisperx:ready')
    sys.exit(0)
except ImportError as e:
    print(f'whisperx:error:{e}', file=sys.stderr)
    sys.exit(1)
`
    return this._runPythonPreload(pythonPath, code, 'whisperx')
  }

  private async _preloadPyAnnote(): Promise<boolean> {
    const pythonPath = pythonEnvironment.getPythonPathForPurpose('pyannote') || pythonEnvironment.getPythonPath()
    if (!pythonPath) {
      loggerService.warn('[MLPreloader] No Python path available for pyannote preload')
      return false
    }

    // Get HuggingFace token if available
    const hfToken = pythonEnvironment.getHuggingFaceToken()

    const code = `
import sys
import warnings
import os
warnings.filterwarnings('ignore')
try:
    from pyannote.audio import Pipeline
    from pyannote.audio import Model
    # Just verify imports work - don't actually load models (they'll be loaded on demand)
    print('pyannote:ready')
    sys.exit(0)
except ImportError as e:
    print(f'pyannote:error:{e}', file=sys.stderr)
    sys.exit(1)
`

    const env: Record<string, string> = {
      ...process.env as Record<string, string>,
      PYTHONWARNINGS: 'ignore::UserWarning,ignore::DeprecationWarning,ignore::FutureWarning',
      TORCH_FORCE_NO_WEIGHTS_ONLY_LOAD: '1'
    }

    if (hfToken) {
      env.HF_TOKEN = hfToken
    }

    return this._runPythonPreload(pythonPath, code, 'pyannote', env)
  }

  private async _preloadSingleModule(moduleName: 'whisperx' | 'pyannote' | 'torch'): Promise<boolean> {
    switch (moduleName) {
      case 'torch':
        return this._preloadTorch()
      case 'whisperx':
        return this._preloadWhisperX()
      case 'pyannote':
        return this._preloadPyAnnote()
      default:
        return false
    }
  }

  private _runPythonPreload(
    pythonPath: string,
    code: string,
    moduleName: string,
    env?: Record<string, string>
  ): Promise<boolean> {
    return new Promise((resolve) => {
      const timeoutId = setTimeout(() => {
        loggerService.warn(`[MLPreloader] ${moduleName} preload timed out`)
        resolve(false)
      }, PRELOAD_TIMEOUT)

      try {
        const proc = spawn(pythonPath, ['-c', code], {
          env: env || {
            ...process.env,
            PYTHONWARNINGS: 'ignore::UserWarning,ignore::DeprecationWarning,ignore::FutureWarning'
          },
          stdio: ['ignore', 'pipe', 'pipe']
        })

        this.activeProcesses.push(proc)

        let stdout = ''
        let stderr = ''

        proc.stdout?.on('data', (data) => {
          stdout += data.toString()
        })

        proc.stderr?.on('data', (data) => {
          stderr += data.toString()
        })

        proc.on('close', (code) => {
          clearTimeout(timeoutId)
          this.activeProcesses = this.activeProcesses.filter(p => p !== proc)

          if (code === 0 && stdout.includes('ready')) {
            loggerService.debug(`[MLPreloader] ${moduleName} preloaded successfully`)
            resolve(true)
          } else {
            loggerService.warn(`[MLPreloader] ${moduleName} preload failed: ${stderr || stdout}`)
            resolve(false)
          }
        })

        proc.on('error', (error) => {
          clearTimeout(timeoutId)
          this.activeProcesses = this.activeProcesses.filter(p => p !== proc)
          loggerService.error(`[MLPreloader] ${moduleName} preload error:`, error)
          resolve(false)
        })
      } catch (error) {
        clearTimeout(timeoutId)
        loggerService.error(`[MLPreloader] Failed to spawn ${moduleName} preload:`, error)
        resolve(false)
      }
    })
  }

  private updateModuleStatus(
    moduleName: 'whisperx' | 'pyannote' | 'torch',
    status: PreloadModuleStatus['status'],
    duration?: number,
    error?: string
  ): void {
    this.state[moduleName] = {
      ...this.state[moduleName],
      status,
      duration,
      error,
      lastPreloaded: status === 'ready' ? new Date().toISOString() : this.state[moduleName].lastPreloaded
    }

    this.emit('module:status', { moduleName, ...this.state[moduleName] })
  }
}

// ============================================================================
// Export singleton instance
// ============================================================================

export const mlPreloaderService = new MLPreloaderService()
export { MLPreloaderService }
