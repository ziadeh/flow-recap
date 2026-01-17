/**
 * Model Manager Service
 *
 * This service manages ML model downloads and caching for the transcription
 * and diarization pipelines. It handles:
 *
 * - First-run model downloads (Whisper models, pyannote models)
 * - Model caching in the app data directory
 * - Model availability checks
 * - Download progress tracking
 * - Intelligent bundled model detection
 *
 * Models are stored in:
 * - macOS: ~/Library/Application Support/Meeting Notes/models/
 * - Windows: %APPDATA%/Meeting Notes/models/
 * - Linux: ~/.config/meeting-notes/models/
 *
 * For bundled apps, models are first checked in:
 * - resources/models/ (bundled with app)
 * - Then fallback to user data directory
 */

import { EventEmitter } from 'events'
import * as fs from 'fs'
import * as path from 'path'
import { spawn, execSync, ChildProcess } from 'child_process'
import * as crypto from 'crypto'
import * as readline from 'readline'

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

export interface ModelInfo {
  /** Model identifier */
  id: string
  /** Human-readable model name */
  name: string
  /** Model type (whisper, pyannote, speechbrain) */
  type: 'whisper' | 'pyannote' | 'speechbrain'
  /** Approximate download size in bytes */
  size: number
  /** Whether the model is required for basic functionality */
  required: boolean
  /** Description of what the model is used for */
  description: string
  /** Model file or directory name in cache */
  cachePath: string
}

export interface ModelStatus {
  /** Model identifier */
  id: string
  /** Whether the model is available locally */
  available: boolean
  /** Local path to the model (if available) */
  localPath: string | null
  /** Whether the model is currently downloading */
  downloading: boolean
  /** Download progress (0-100) */
  progress: number
  /** Error message if download failed */
  error: string | null
}

export interface DownloadProgress {
  /** Model being downloaded */
  modelId: string
  /** Current progress (0-100) */
  progress: number
  /** Bytes downloaded */
  bytesDownloaded: number
  /** Total bytes to download */
  totalBytes: number
  /** Download speed in bytes/second */
  speed: number
  /** Estimated time remaining in seconds */
  eta: number
  /** Current phase of download */
  phase: 'initializing' | 'downloading' | 'verifying' | 'complete' | 'error'
  /** Human-readable status message */
  message: string
}

export interface PyannoteModelsStatus {
  /** Whether all PyAnnote models are available */
  allAvailable: boolean
  /** Whether download is in progress */
  downloading: boolean
  /** List of missing models */
  missingModels: string[]
  /** Total size needed to download */
  totalDownloadSize: number
  /** Human-readable size string */
  totalDownloadSizeFormatted: string
  /** Whether HuggingFace token is configured */
  hfTokenConfigured: boolean
  /** Location where models are stored */
  modelsLocation: 'bundled' | 'cache' | 'none'
}

export interface LicenseCheckResult {
  /** Whether all models have license access */
  allAccessible: boolean
  /** Whether check is currently in progress */
  checking: boolean
  /** Models that require license acceptance */
  modelsRequiringLicense: Array<{
    modelId: string
    modelName: string
    licenseUrl: string
  }>
  /** Models that are accessible */
  accessibleModels: string[]
  /** Error message if check failed */
  error: string | null
  /** Timestamp of last successful check */
  lastCheckTimestamp: number | null
}

// ============================================================================
// Constants
// ============================================================================

// Available Whisper models with their approximate sizes
const WHISPER_MODELS: ModelInfo[] = [
  {
    id: 'whisper-tiny',
    name: 'Whisper Tiny',
    type: 'whisper',
    size: 75 * 1024 * 1024, // 75 MB
    required: false,
    description: 'Fastest model, lower accuracy',
    cachePath: 'whisper-tiny'
  },
  {
    id: 'whisper-base',
    name: 'Whisper Base',
    type: 'whisper',
    size: 145 * 1024 * 1024, // 145 MB
    required: false,
    description: 'Fast model, moderate accuracy',
    cachePath: 'whisper-base'
  },
  {
    id: 'whisper-small',
    name: 'Whisper Small',
    type: 'whisper',
    size: 488 * 1024 * 1024, // 488 MB
    required: false,
    description: 'Balanced speed and accuracy',
    cachePath: 'whisper-small'
  },
  {
    id: 'whisper-medium',
    name: 'Whisper Medium',
    type: 'whisper',
    size: 1.5 * 1024 * 1024 * 1024, // 1.5 GB
    required: false,
    description: 'Good accuracy, slower',
    cachePath: 'whisper-medium'
  },
  {
    id: 'whisper-large-v2',
    name: 'Whisper Large v2',
    type: 'whisper',
    size: 3 * 1024 * 1024 * 1024, // 3 GB
    required: true,
    description: 'Best accuracy, requires more resources',
    cachePath: 'whisper-large-v2'
  },
  {
    id: 'whisper-large-v3',
    name: 'Whisper Large v3',
    type: 'whisper',
    size: 3 * 1024 * 1024 * 1024, // 3 GB
    required: false,
    description: 'Latest model with improved accuracy',
    cachePath: 'whisper-large-v3'
  }
]

// Pyannote diarization models
// Note: The embedding model uses pyannote/wespeaker-voxceleb-resnet34-LM (not pyannote/embedding)
const PYANNOTE_MODELS: ModelInfo[] = [
  {
    id: 'pyannote-speaker-diarization-3.1',
    name: 'Pyannote Speaker Diarization',
    type: 'pyannote',
    size: 500 * 1024 * 1024, // ~500 MB (includes embedding model)
    required: true,
    description: 'Speaker diarization pipeline',
    cachePath: 'pyannote/speaker-diarization-3.1'
  },
  {
    id: 'pyannote-segmentation-3.0',
    name: 'Pyannote Segmentation',
    type: 'pyannote',
    size: 100 * 1024 * 1024, // ~100 MB
    required: true,
    description: 'Voice activity and speaker segmentation',
    cachePath: 'pyannote/segmentation-3.0'
  },
  {
    id: 'pyannote-embedding',
    name: 'Pyannote Speaker Embedding',
    type: 'pyannote',
    size: 200 * 1024 * 1024, // ~200 MB
    required: true,
    description: 'Speaker embedding extraction (wespeaker-voxceleb-resnet34-LM)',
    cachePath: 'pyannote/wespeaker-voxceleb-resnet34-LM'
  }
]

// All available models
const ALL_MODELS: ModelInfo[] = [...WHISPER_MODELS, ...PYANNOTE_MODELS]

// ============================================================================
// Model Manager Service
// ============================================================================

class ModelManagerService extends EventEmitter {
  private modelsDir: string
  private bundledModelsDir: string | null = null
  private downloadingModels: Set<string> = new Set()
  private modelStatuses: Map<string, ModelStatus> = new Map()
  private activeDownloadProcess: ChildProcess | null = null
  private downloadAborted: boolean = false

  constructor() {
    super()
    this.modelsDir = this.getModelsDirectory()
    this.bundledModelsDir = this.getBundledModelsDirectory()
    this.ensureModelsDirectory()
  }

  /**
   * Get the bundled models directory (for packaged apps)
   */
  private getBundledModelsDirectory(): string | null {
    if (!app?.isPackaged) {
      return null
    }

    // Check for bundled models in resources directory
    const resourcesPath = process.resourcesPath
    if (resourcesPath) {
      const bundledPath = path.join(resourcesPath, 'models')
      if (fs.existsSync(bundledPath)) {
        console.log('[ModelManager] Found bundled models at:', bundledPath)
        return bundledPath
      }
    }

    return null
  }

  /**
   * Get the models directory path
   */
  private getModelsDirectory(): string {
    if (app?.getPath) {
      const appDataPath = app.getPath('userData')
      return path.join(appDataPath, 'models')
    }

    // Fallback for non-Electron context or testing
    if (process.platform === 'darwin') {
      return path.join(process.env.HOME || '', 'Library', 'Application Support', 'Meeting Notes', 'models')
    } else if (process.platform === 'win32') {
      return path.join(process.env.APPDATA || '', 'Meeting Notes', 'models')
    } else {
      return path.join(process.env.HOME || '', '.config', 'meeting-notes', 'models')
    }
  }

  /**
   * Ensure the models directory exists
   */
  private ensureModelsDirectory(): void {
    if (!fs.existsSync(this.modelsDir)) {
      fs.mkdirSync(this.modelsDir, { recursive: true })
    }
  }

  /**
   * Get all available models
   */
  getAvailableModels(): ModelInfo[] {
    return ALL_MODELS
  }

  /**
   * Get required models (models needed for basic functionality)
   */
  getRequiredModels(): ModelInfo[] {
    return ALL_MODELS.filter(m => m.required)
  }

  /**
   * Get Whisper models
   */
  getWhisperModels(): ModelInfo[] {
    return WHISPER_MODELS
  }

  /**
   * Get Pyannote models
   */
  getPyannoteModels(): ModelInfo[] {
    return PYANNOTE_MODELS
  }

  /**
   * Get the status of a model
   */
  getModelStatus(modelId: string): ModelStatus {
    // Return cached status if available and not downloading
    const cached = this.modelStatuses.get(modelId)
    if (cached && !cached.downloading) {
      return cached
    }

    const model = ALL_MODELS.find(m => m.id === modelId)
    if (!model) {
      return {
        id: modelId,
        available: false,
        localPath: null,
        downloading: false,
        progress: 0,
        error: `Unknown model: ${modelId}`
      }
    }

    const localPath = path.join(this.modelsDir, model.cachePath)
    const available = this.isModelDownloaded(model)

    const status: ModelStatus = {
      id: modelId,
      available,
      localPath: available ? localPath : null,
      downloading: this.downloadingModels.has(modelId),
      progress: available ? 100 : (cached?.progress || 0),
      error: null
    }

    this.modelStatuses.set(modelId, status)
    return status
  }

  /**
   * Get the status of all models
   */
  getAllModelStatuses(): ModelStatus[] {
    return ALL_MODELS.map(m => this.getModelStatus(m.id))
  }

  /**
   * Check if a model is downloaded
   * Checks bundled location first, then user cache
   */
  private isModelDownloaded(model: ModelInfo): boolean {
    // Check bundled models first (for packaged apps)
    if (this.bundledModelsDir) {
      const bundledPath = path.join(this.bundledModelsDir, model.cachePath)
      if (this.checkModelPath(bundledPath)) {
        return true
      }
    }

    // Check user cache directory
    const userPath = path.join(this.modelsDir, model.cachePath)
    if (this.checkModelPath(userPath)) {
      return true
    }

    // For pyannote models, also check HuggingFace cache
    if (model.type === 'pyannote') {
      return this.checkHuggingFaceCache(model)
    }

    return false
  }

  /**
   * Check if a model path exists and has content
   */
  private checkModelPath(modelPath: string): boolean {
    if (!fs.existsSync(modelPath)) {
      return false
    }

    const stat = fs.statSync(modelPath)
    if (stat.isDirectory()) {
      const files = fs.readdirSync(modelPath)
      return files.length > 0
    }

    return true
  }

  /**
   * Check if PyAnnote model is in HuggingFace cache
   */
  private checkHuggingFaceCache(model: ModelInfo): boolean {
    const hfCache = this.getHuggingFaceCacheDir()
    const hubPath = path.join(hfCache, 'hub')

    console.log(`[ModelManager] Checking HF cache for ${model.id} at:`, hubPath)

    if (!fs.existsSync(hubPath)) {
      console.log(`[ModelManager] Hub path does not exist: ${hubPath}`)
      return false
    }

    // PyAnnote models are stored with specific naming patterns
    // Updated to include the correct wespeaker embedding model path
    const modelPatterns: Record<string, string[]> = {
      'pyannote-speaker-diarization-3.1': ['models--pyannote--speaker-diarization-3.1'],
      'pyannote-segmentation-3.0': ['models--pyannote--segmentation-3.0'],
      'pyannote-embedding': [
        'models--pyannote--wespeaker-voxceleb-resnet34-LM', // Correct embedding model
        'models--pyannote--embedding', // Legacy path
        'models--speechbrain--spkrec-ecapa-voxceleb' // Alternative embedding
      ]
    }

    const patterns = modelPatterns[model.id] || []
    for (const pattern of patterns) {
      const modelDir = path.join(hubPath, pattern)
      console.log(`[ModelManager] Checking pattern '${pattern}':`, modelDir)

      if (fs.existsSync(modelDir)) {
        console.log(`[ModelManager] Model directory exists: ${modelDir}`)
        // Check if the model has actual content (not just metadata)
        const snapshotsDir = path.join(modelDir, 'snapshots')
        if (fs.existsSync(snapshotsDir)) {
          const snapshots = fs.readdirSync(snapshotsDir)
          console.log(`[ModelManager] Found ${snapshots.length} snapshots`)

          if (snapshots.length > 0) {
            const snapshotPath = path.join(snapshotsDir, snapshots[0])
            const files = fs.readdirSync(snapshotPath)
            console.log(`[ModelManager] Snapshot contains ${files.length} files:`, files.slice(0, 5))

            // Check for actual model files (not just config)
            // Pipeline models (speaker-diarization) may only have config.yaml and handler.py
            // Regular models (segmentation, embedding) should have weight files
            const isPipelineModel = model.id === 'pyannote-speaker-diarization-3.1'
            
            const checkForModelFiles = (dir: string): { hasFiles: boolean; hasConfigYaml?: boolean; hasHandlerPy?: boolean } => {
              try {
                const entries = fs.readdirSync(dir, { withFileTypes: true })
                let hasConfigYaml = false
                let hasHandlerPy = false
                
                if (isPipelineModel) {
                  console.log(`[ModelManager] Checking pipeline model files in: ${dir}`)
                }
                
                // First pass: check files in current directory
                for (const entry of entries) {
                  // Check if entry is a file or a symlink to a file
                  // HuggingFace cache uses symlinks, so we need to check both
                  const isFile = entry.isFile() || (entry.isSymbolicLink() && (() => {
                    try {
                      const fullPath = path.join(dir, entry.name)
                      return fs.statSync(fullPath).isFile()
                    } catch {
                      return false
                    }
                  })())

                  if (isFile) {
                    // For pipeline models, check for config.yaml and handler.py
                    if (isPipelineModel) {
                      if (entry.name === 'config.yaml') {
                        hasConfigYaml = true
                        console.log(`[ModelManager] Found config.yaml in ${dir}`)
                      }
                      if (entry.name === 'handler.py') {
                        hasHandlerPy = true
                        console.log(`[ModelManager] Found handler.py in ${dir}`)
                      }
                      // Return early if we found both required files
                      if (hasConfigYaml && hasHandlerPy) {
                        console.log(`[ModelManager] Both pipeline files found in ${dir}`)
                        return { hasFiles: true, hasConfigYaml: true, hasHandlerPy: true }
                      }
                    } else {
                      // For regular models, check for weight files
                      // SpeechBrain models use .ckpt format, PyAnnote models use .bin/.pt/.safetensors
                      if (entry.name.endsWith('.bin') ||
                          entry.name.endsWith('.pt') ||
                          entry.name.endsWith('.safetensors') ||
                          entry.name.endsWith('.ckpt')) {
                        console.log(`[ModelManager] Found weight file: ${entry.name} in ${dir}`)
                        return { hasFiles: true }
                      }
                    }
                  }
                }
                
                // Second pass: check subdirectories (only if we haven't found what we need)
                if (isPipelineModel && (!hasConfigYaml || !hasHandlerPy)) {
                  for (const entry of entries) {
                    if (entry.isDirectory() && !entry.name.startsWith('.')) {
                      const fullPath = path.join(dir, entry.name)
                      const subResult = checkForModelFiles(fullPath)
                      // Merge pipeline file checks
                      if (subResult.hasConfigYaml) hasConfigYaml = true
                      if (subResult.hasHandlerPy) hasHandlerPy = true
                      // Return early if we now have both files after merging
                      if (hasConfigYaml && hasHandlerPy) {
                        console.log(`[ModelManager] Both pipeline files found after checking subdirectories`)
                        return { hasFiles: true, hasConfigYaml: true, hasHandlerPy: true }
                      }
                    }
                  }
                } else if (!isPipelineModel) {
                  // For regular models, check subdirectories for weight files
                  for (const entry of entries) {
                    if (entry.isDirectory() && !entry.name.startsWith('.')) {
                      const fullPath = path.join(dir, entry.name)
                      const subResult = checkForModelFiles(fullPath)
                      if (subResult.hasFiles) {
                        return { hasFiles: true }
                      }
                    }
                  }
                }
                
                // For pipeline models, check if we found the required files
                if (isPipelineModel) {
                  const result = { 
                    hasFiles: hasConfigYaml && hasHandlerPy,
                    hasConfigYaml,
                    hasHandlerPy
                  }
                  console.log(`[ModelManager] Pipeline model check result for ${dir}: hasFiles=${result.hasFiles}, configYaml=${result.hasConfigYaml}, handlerPy=${result.hasHandlerPy}`)
                  return result
                }
                
                // For regular models, if we didn't find weight files, return false
                console.log(`[ModelManager] No weight files found in ${dir} for regular model`)
                return { hasFiles: false }
              } catch (error) {
                // Log errors but don't fail verification unless it's critical
                const errorMsg = error instanceof Error ? error.message : String(error)
                console.log(`[ModelManager] Error checking directory ${dir}:`, errorMsg)
                // Return false if we hit an error, but log it for debugging
                return { hasFiles: false }
              }
            }

            const result = checkForModelFiles(snapshotPath)
            const hasModelFiles = result.hasFiles
            console.log(`[ModelManager] Has model files: ${hasModelFiles}`)
            if (isPipelineModel) {
              console.log(`[ModelManager] Pipeline model check - config.yaml: ${result.hasConfigYaml}, handler.py: ${result.hasHandlerPy}`)
            } else {
              console.log(`[ModelManager] Regular model check - looking for weight files (.bin, .pt, .safetensors, .ckpt)`)
            }

            if (hasModelFiles) {
              console.log(`[ModelManager] ✓ Model ${model.id} verified in HF cache`)
              return true
            }
          }
        } else {
          console.log(`[ModelManager] Snapshots directory does not exist: ${snapshotsDir}`)
        }
      } else {
        console.log(`[ModelManager] Model directory does not exist: ${modelDir}`)
      }
    }

    console.log(`[ModelManager] ✗ Model ${model.id} NOT found in HF cache`)
    return false
  }

  /**
   * Check if all required models are available
   */
  areRequiredModelsAvailable(): boolean {
    return this.getRequiredModels().every(m => this.isModelDownloaded(m))
  }

  /**
   * Get missing required models
   */
  getMissingRequiredModels(): ModelInfo[] {
    return this.getRequiredModels().filter(m => !this.isModelDownloaded(m))
  }

  /**
   * Get the HuggingFace cache directory
   * Models downloaded by HuggingFace Hub are stored here
   */
  getHuggingFaceCacheDir(): string {
    // Check environment variable first
    if (process.env.HF_HOME) {
      return process.env.HF_HOME
    }
    if (process.env.HUGGINGFACE_HUB_CACHE) {
      return process.env.HUGGINGFACE_HUB_CACHE
    }

    // Default locations
    if (process.platform === 'win32') {
      return path.join(process.env.USERPROFILE || '', '.cache', 'huggingface')
    } else {
      return path.join(process.env.HOME || '', '.cache', 'huggingface')
    }
  }

  /**
   * Get the WhisperX/faster-whisper model cache directory
   */
  getWhisperCacheDir(): string {
    // WhisperX uses HuggingFace Hub for model downloads
    return path.join(this.getHuggingFaceCacheDir(), 'hub')
  }

  /**
   * Check if models will be downloaded on first run
   * Returns information about what needs to be downloaded
   */
  getFirstRunDownloadInfo(): {
    needsDownload: boolean
    totalSize: number
    models: ModelInfo[]
    message: string
  } {
    const missingModels = this.getMissingRequiredModels()
    const totalSize = missingModels.reduce((sum, m) => sum + m.size, 0)

    if (missingModels.length === 0) {
      return {
        needsDownload: false,
        totalSize: 0,
        models: [],
        message: 'All required models are available'
      }
    }

    const sizeGB = (totalSize / (1024 * 1024 * 1024)).toFixed(1)
    return {
      needsDownload: true,
      totalSize,
      models: missingModels,
      message: `First run will download approximately ${sizeGB} GB of ML models. ` +
               `This includes Whisper speech recognition and Pyannote speaker diarization models.`
    }
  }

  /**
   * Get PyAnnote models status for UI display
   */
  getPyannoteModelsStatus(hfTokenConfigured = false): PyannoteModelsStatus {
    const pyannoteModels = this.getPyannoteModels()
    const missingModels: string[] = []
    let totalDownloadSize = 0

    for (const model of pyannoteModels) {
      if (!this.isModelDownloaded(model)) {
        missingModels.push(model.id)
        totalDownloadSize += model.size
      }
    }

    let modelsLocation: 'bundled' | 'cache' | 'none' = 'none'

    if (missingModels.length === 0) {
      // Check where models are located
      if (this.bundledModelsDir && pyannoteModels.some(m =>
        this.checkModelPath(path.join(this.bundledModelsDir!, m.cachePath))
      )) {
        modelsLocation = 'bundled'
      } else {
        modelsLocation = 'cache'
      }
    }

    return {
      allAvailable: missingModels.length === 0,
      downloading: this.downloadingModels.size > 0,
      missingModels,
      totalDownloadSize,
      totalDownloadSizeFormatted: this.formatSize(totalDownloadSize),
      hfTokenConfigured,
      modelsLocation
    }
  }

  /**
   * Check license access for all PyAnnote models
   * Uses the HuggingFace API to verify the user has accepted model licenses
   */
  async checkLicenseAccess(hfToken?: string): Promise<LicenseCheckResult> {
    const token = (hfToken || '').trim()

    if (!token) {
      return {
        allAccessible: false,
        checking: false,
        modelsRequiringLicense: [],
        accessibleModels: [],
        error: 'HuggingFace token is required to check license access',
        lastCheckTimestamp: null
      }
    }

    console.log('[ModelManager] Checking license access for PyAnnote models...')

    // Model configurations with license URLs
    const modelConfigs = [
      {
        modelId: 'pyannote-segmentation-3.0',
        modelName: 'Segmentation Model',
        repoId: 'pyannote/segmentation-3.0',
        licenseUrl: 'https://huggingface.co/pyannote/segmentation-3.0'
      },
      {
        modelId: 'pyannote-embedding',
        modelName: 'Speaker Embedding Model',
        repoId: 'pyannote/wespeaker-voxceleb-resnet34-LM',
        licenseUrl: 'https://huggingface.co/pyannote/wespeaker-voxceleb-resnet34-LM'
      },
      {
        modelId: 'pyannote-speaker-diarization-3.1',
        modelName: 'Speaker Diarization Pipeline',
        repoId: 'pyannote/speaker-diarization-3.1',
        licenseUrl: 'https://huggingface.co/pyannote/speaker-diarization-3.1'
      }
    ]

    const modelsRequiringLicense: LicenseCheckResult['modelsRequiringLicense'] = []
    const accessibleModels: string[] = []

    try {
      // First validate the token
      const tokenValidation = await this.validateHfToken(token)
      if (!tokenValidation.valid) {
        return {
          allAccessible: false,
          checking: false,
          modelsRequiringLicense: [],
          accessibleModels: [],
          error: tokenValidation.error || 'Invalid HuggingFace token',
          lastCheckTimestamp: Date.now()
        }
      }

      // Check access for each model
      for (const config of modelConfigs) {
        const hasAccess = await this.checkModelAccess(config.repoId, token)

        if (hasAccess) {
          accessibleModels.push(config.modelId)
          console.log(`[ModelManager] ✓ Access verified for ${config.modelId}`)
        } else {
          modelsRequiringLicense.push({
            modelId: config.modelId,
            modelName: config.modelName,
            licenseUrl: config.licenseUrl
          })
          console.log(`[ModelManager] ✗ License required for ${config.modelId}`)
        }
      }

      const result: LicenseCheckResult = {
        allAccessible: modelsRequiringLicense.length === 0,
        checking: false,
        modelsRequiringLicense,
        accessibleModels,
        error: null,
        lastCheckTimestamp: Date.now()
      }

      this.emit('licenseCheckComplete', result)
      return result

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error)
      console.error('[ModelManager] License check failed:', errorMessage)

      return {
        allAccessible: false,
        checking: false,
        modelsRequiringLicense: [],
        accessibleModels: [],
        error: `Failed to check license access: ${errorMessage}`,
        lastCheckTimestamp: Date.now()
      }
    }
  }

  /**
   * Validate HuggingFace token
   */
  private async validateHfToken(token: string): Promise<{ valid: boolean; error?: string }> {
    return new Promise((resolve) => {
      const pythonPath = this.findPythonPath()

      // Use a simple Python script to validate the token
      const script = `
import sys
import os
os.environ['HF_TOKEN'] = '''${token}'''
try:
    from huggingface_hub import HfApi
    api = HfApi()
    user_info = api.whoami(token='''${token}''')
    print('VALID:' + str(user_info.get('name', 'unknown')))
except Exception as e:
    error_str = str(e)
    if '401' in error_str:
        print('INVALID:Invalid token')
    else:
        print('ERROR:' + error_str)
`
      const process = spawn(pythonPath, ['-c', script], {
        stdio: ['pipe', 'pipe', 'pipe'],
        env: { ...process.env, PYTHONUNBUFFERED: '1' }
      })

      let stdout = ''
      let stderr = ''

      process.stdout?.on('data', (data) => { stdout += data.toString() })
      process.stderr?.on('data', (data) => { stderr += data.toString() })

      process.on('error', () => {
        resolve({ valid: false, error: 'Failed to run Python for token validation' })
      })

      process.on('exit', (code) => {
        if (stdout.startsWith('VALID:')) {
          resolve({ valid: true })
        } else if (stdout.startsWith('INVALID:')) {
          resolve({ valid: false, error: stdout.replace('INVALID:', '').trim() })
        } else {
          resolve({ valid: false, error: stdout.replace('ERROR:', '').trim() || stderr || 'Token validation failed' })
        }
      })

      // Timeout after 30 seconds
      setTimeout(() => {
        process.kill('SIGTERM')
        resolve({ valid: false, error: 'Token validation timed out' })
      }, 30000)
    })
  }

  /**
   * Check if user has access to a specific model
   */
  private async checkModelAccess(repoId: string, token: string): Promise<boolean> {
    return new Promise((resolve) => {
      const pythonPath = this.findPythonPath()

      const script = `
import sys
import os
os.environ['HF_TOKEN'] = '''${token}'''
try:
    from huggingface_hub import HfApi
    api = HfApi()
    model_info = api.model_info('${repoId}', token='''${token}''')
    print('ACCESS:true')
except Exception as e:
    error_str = str(e).lower()
    if '403' in error_str or '401' in error_str or 'gated' in error_str:
        print('ACCESS:false')
    else:
        # Network or other errors - assume access is ok
        print('ACCESS:true')
`
      const process = spawn(pythonPath, ['-c', script], {
        stdio: ['pipe', 'pipe', 'pipe'],
        env: { ...process.env, PYTHONUNBUFFERED: '1' }
      })

      let stdout = ''

      process.stdout?.on('data', (data) => { stdout += data.toString() })

      process.on('error', () => {
        // On error, assume access is ok (let the actual download handle it)
        resolve(true)
      })

      process.on('exit', () => {
        resolve(stdout.includes('ACCESS:true'))
      })

      // Timeout after 15 seconds per model
      setTimeout(() => {
        process.kill('SIGTERM')
        resolve(true) // Assume ok on timeout
      }, 15000)
    })
  }

  /**
   * Download all missing PyAnnote models
   * Uses a Python script to leverage huggingface_hub for downloads
   */
  async downloadPyannoteModels(hfToken?: string): Promise<void> {
    const status = this.getPyannoteModelsStatus()

    if (status.allAvailable) {
      console.log('[ModelManager] All PyAnnote models already available')
      return
    }

    if (status.downloading) {
      throw new Error('Download already in progress')
    }

    const token = (hfToken || '').trim()
    if (!token) {
      throw new Error(
        'HuggingFace token is required to download PyAnnote models. Please set it in Settings (Speaker Identification).'
      )
    }

    console.log('[ModelManager] Starting PyAnnote models download...')
    console.log('[ModelManager] Missing models:', status.missingModels)

    this.downloadAborted = false

    // Mark all pyannote models as downloading
    for (const modelId of status.missingModels) {
      this.downloadingModels.add(modelId)
      this.updateModelStatus(modelId, { downloading: true, progress: 0, error: null })
    }

    try {
      await this.runModelDownloadScript(token)
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error)
      for (const modelId of status.missingModels) {
        this.updateModelStatus(modelId, { downloading: false, error: errorMessage })
      }
      throw error
    } finally {
      for (const modelId of status.missingModels) {
        this.downloadingModels.delete(modelId)
      }
      this.activeDownloadProcess = null
    }
  }

  /**
   * Run the Python model download script
   */
  private async runModelDownloadScript(hfToken: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const pythonPath = this.findPythonPath()
      const scriptPath = this.getDownloadScriptPath()

      console.log('[ModelManager] Python path:', pythonPath)
      console.log('[ModelManager] Script path:', scriptPath)

      // Create the download script if it doesn't exist
      this.ensureDownloadScript(scriptPath)

      const args = [scriptPath]

      const env = {
        ...process.env,
        HF_TOKEN: hfToken,
        PYTHONUNBUFFERED: '1',
        PYTHONWARNINGS: 'ignore::UserWarning,ignore::DeprecationWarning,ignore::FutureWarning'
      }

      this.activeDownloadProcess = spawn(pythonPath, args, {
        stdio: ['pipe', 'pipe', 'pipe'],
        env
      })

      let stdout = ''
      let stderr = ''

      const rl = readline.createInterface({
        input: this.activeDownloadProcess.stderr!,
        crlfDelay: Infinity
      })

      rl.on('line', (line) => {
        stderr += line + '\n'
        console.log('[ModelManager] Script:', line)

        // Parse debug messages
        // Expected format: [DEBUG] message
        const debugMatch = line.match(/\[DEBUG\]\s+(.*)/)
        if (debugMatch) {
          // Just log debug messages, don't take any action
          console.log('[ModelManager] Debug:', debugMatch[1])
          return
        }

        // Parse license required messages
        // Expected format: [LICENSE_REQUIRED] model_id url
        const licenseMatch = line.match(/\[LICENSE_REQUIRED\]\s+(\S+)\s+(.*)/)
        if (licenseMatch) {
          const [, modelId, licenseUrl] = licenseMatch
          const errorMessage = `License agreement required. Please visit ${licenseUrl} to accept the model terms, then try downloading again.`
          this.updateModelStatus(modelId, { downloading: false, error: errorMessage })
          this.emit('licenseRequired', { modelId, licenseUrl })
          this.emit('downloadError', { modelId, error: errorMessage })
          return
        }

        // Parse progress updates from script
        // Expected format: [PROGRESS] model_id 45 Downloading segmentation model...
        const progressMatch = line.match(/\[PROGRESS\]\s+(\S+)\s+(\d+)\s+(.*)/)
        if (progressMatch) {
          const [, modelId, progressStr, message] = progressMatch
          const progress = parseInt(progressStr, 10)

          const progressData: DownloadProgress = {
            modelId,
            progress,
            bytesDownloaded: 0,
            totalBytes: 0,
            speed: 0,
            eta: 0,
            phase: progress < 100 ? 'downloading' : 'complete',
            message
          }

          this.updateModelStatus(modelId, { progress })
          this.emit('downloadProgress', progressData)
          return
        }

        // Parse completion messages
        // Expected format: [COMPLETE] model_id
        const completeMatch = line.match(/\[COMPLETE\]\s+(\S+)/)
        if (completeMatch) {
          const modelId = completeMatch[1]
          this.updateModelStatus(modelId, {
            downloading: false,
            progress: 100,
            available: true,
            localPath: path.join(this.getHuggingFaceCacheDir(), 'hub')
          })
          this.emit('downloadComplete', { modelId })
          return
        }

        // Parse error messages
        // Expected format: [ERROR] model_id Error message here
        const errorMatch = line.match(/\[ERROR\]\s+(\S+)\s+(.*)/)
        if (errorMatch) {
          const [, modelId, errorMessage] = errorMatch
          this.updateModelStatus(modelId, { downloading: false, error: errorMessage })
          this.emit('downloadError', { modelId, error: errorMessage })
          return
        }
      })

      this.activeDownloadProcess.stdout?.on('data', (data) => {
        stdout += data.toString()
      })

      this.activeDownloadProcess.on('error', (error) => {
        console.error('[ModelManager] Process error:', error)
        reject(new Error(`Failed to start download: ${error.message}`))
      })

      this.activeDownloadProcess.on('exit', (code) => {
        console.log('[ModelManager] Process exited with code:', code)

        if (this.downloadAborted) {
          reject(new Error('Download was cancelled'))
          return
        }

        if (code === 0) {
          // Add a delay to allow filesystem to sync before verification
          // This prevents race conditions where the Python script has written files
          // but they're not immediately visible to Node.js
          setTimeout(() => {
            console.log('[ModelManager] Verifying downloaded models...')
            const status = this.getPyannoteModelsStatus()
            console.log('[ModelManager] Verification status:', {
              allAvailable: status.allAvailable,
              missingModels: status.missingModels,
              modelsLocation: status.modelsLocation
            })
            
            // Also check each model individually for better debugging
            for (const model of this.getPyannoteModels()) {
              const isDownloaded = this.isModelDownloaded(model)
              console.log(`[ModelManager] Model ${model.id} available: ${isDownloaded}`)
            }
            
            if (status.allAvailable) {
              console.log('[ModelManager] All models verified successfully')
              resolve()
            } else {
              console.error('[ModelManager] Verification failed. Missing models:', status.missingModels)
              reject(new Error(`Download completed but some models are still missing: ${status.missingModels.join(', ')}`))
            }
          }, 2000) // 2 second delay for filesystem sync
        } else {
          // Check if the error is due to missing huggingface_hub
          if (stderr.includes('huggingface_hub not installed')) {
            reject(new Error(
              `Python dependencies not installed. Please run the setup script:\n` +
              `  cd python && ./setup_venv.sh\n\n` +
              `Or install the required package manually:\n` +
              `  pip install huggingface_hub\n\n` +
              `Error details: ${stderr}`
            ))
          } else {
            reject(new Error(`Download script failed with code ${code}: ${stderr}`))
          }
        }
      })
    })
  }

  /**
   * Cancel ongoing download
   */
  cancelDownload(): void {
    if (this.activeDownloadProcess) {
      console.log('[ModelManager] Cancelling download...')
      this.downloadAborted = true
      this.activeDownloadProcess.kill('SIGTERM')
      this.activeDownloadProcess = null

      // Update all downloading models
      for (const modelId of this.downloadingModels) {
        this.updateModelStatus(modelId, { downloading: false, error: 'Download cancelled' })
      }
      this.downloadingModels.clear()
    }
  }

  /**
   * Find Python path for running download script
   */
  private findPythonPath(): string {
    // Check for bundled Python first (packaged app)
    if (app?.isPackaged) {
      const resourcesPath = process.resourcesPath
      if (resourcesPath) {
        const bundledPython = process.platform === 'win32'
          ? path.join(resourcesPath, 'python', 'transcription_bundle.exe')
          : path.join(resourcesPath, 'python', 'transcription_bundle')
        if (fs.existsSync(bundledPython)) {
          return bundledPython
        }
      }
    }

    // Determine project root based on whether we're in development or production
    // In development: __dirname is typically dist-electron, so we go up one level
    // In production: depends on the build configuration
    let projectRoot: string

    // Try multiple possible project root locations
    const possibleRoots = [
      process.cwd(), // Current working directory (most reliable in dev)
      path.join(__dirname, '..'), // One level up from dist-electron
      path.join(__dirname, '..', '..'), // Two levels up
    ]

    // Find the first root that has a python directory with venv or requirements.txt
    // This ensures we find the actual project root, not just any python directory
    projectRoot = possibleRoots.find(root => {
      const pythonDir = path.join(root, 'python')
      const requirementsTxt = path.join(pythonDir, 'requirements.txt')
      const downloadScript = path.join(pythonDir, 'download_models.py')
      return fs.existsSync(pythonDir) && (fs.existsSync(requirementsTxt) || fs.existsSync(downloadScript))
    }) || possibleRoots[0]

    console.log('[ModelManager] Project root:', projectRoot)

    // Check for venv
    const venvDirs = ['venv-3.12', 'venv']
    for (const venvName of venvDirs) {
      const venvPython = process.platform === 'win32'
        ? path.join(projectRoot, 'python', venvName, 'Scripts', 'python.exe')
        : path.join(projectRoot, 'python', venvName, 'bin', 'python')
      console.log(`[ModelManager] Checking venv path: ${venvPython}`)
      if (fs.existsSync(venvPython)) {
        console.log(`[ModelManager] Found venv Python: ${venvPython}`)
        return venvPython
      }
    }

    // Check environment variable
    if (process.env.PYTHON_PATH && fs.existsSync(process.env.PYTHON_PATH)) {
      console.log(`[ModelManager] Using PYTHON_PATH from environment: ${process.env.PYTHON_PATH}`)
      return process.env.PYTHON_PATH
    }

    // Fallback to system Python
    const systemPython = process.platform === 'win32' ? 'python' : 'python3'
    console.log(`[ModelManager] Falling back to system Python: ${systemPython}`)
    return systemPython
  }

  /**
   * Get path to the model download script
   */
  private getDownloadScriptPath(): string {
    // Use the same logic as findPythonPath to locate the project root
    const possibleRoots = [
      process.cwd(), // Current working directory (most reliable in dev)
      path.join(__dirname, '..'), // One level up from dist-electron
      path.join(__dirname, '..', '..'), // Two levels up
    ]

    // Find the first root that has a python directory with the download script
    const projectRoot = possibleRoots.find(root => {
      const pythonDir = path.join(root, 'python')
      const requirementsTxt = path.join(pythonDir, 'requirements.txt')
      const downloadScript = path.join(pythonDir, 'download_models.py')
      return fs.existsSync(pythonDir) && (fs.existsSync(requirementsTxt) || fs.existsSync(downloadScript))
    }) || possibleRoots[0]

    return path.join(projectRoot, 'python', 'download_models.py')
  }

  /**
   * Ensure the download script exists
   */
  private ensureDownloadScript(scriptPath: string): void {
    if (fs.existsSync(scriptPath)) {
      return
    }

    console.log('[ModelManager] Creating download script at:', scriptPath)

    const scriptContent = `#!/usr/bin/env python3
"""
PyAnnote Model Download Script

Downloads required PyAnnote models from HuggingFace Hub.
Outputs progress in a format parseable by the Electron app.

Progress format: [PROGRESS] model_id percentage message
Complete format: [COMPLETE] model_id
Error format: [ERROR] model_id message
"""

import os
import sys

def print_progress(model_id: str, progress: int, message: str):
    """Print progress in parseable format."""
    print(f"[PROGRESS] {model_id} {progress} {message}", file=sys.stderr, flush=True)

def print_complete(model_id: str):
    """Print completion in parseable format."""
    print(f"[COMPLETE] {model_id}", file=sys.stderr, flush=True)

def print_error(model_id: str, message: str):
    """Print error in parseable format."""
    print(f"[ERROR] {model_id} {message}", file=sys.stderr, flush=True)

def download_models():
    """Download all required PyAnnote models."""

    hf_token = os.environ.get('HF_TOKEN')
    if not hf_token:
        print_error("all", "HuggingFace token not provided. Please save your token in Settings and try again.")
        sys.exit(1)

    models_to_download = [
        ("pyannote-segmentation-3.0", "pyannote/segmentation-3.0"),
        ("pyannote-embedding", "pyannote/embedding"),
        ("pyannote-speaker-diarization-3.1", "pyannote/speaker-diarization-3.1"),
    ]

    # Import huggingface_hub for downloads
    try:
        from huggingface_hub import login, hf_hub_download, snapshot_download
        from huggingface_hub.utils import RepositoryNotFoundError, HfHubHTTPError
    except ImportError as e:
        print_error("all", f"huggingface_hub not installed: {e}")
        sys.exit(1)

    # Login to HuggingFace
    try:
        print_progress("all", 5, "Authenticating with HuggingFace...")
        login(token=hf_token, add_to_git_credential=False)
    except Exception as e:
        print_error("all", f"Failed to authenticate: {e}")
        sys.exit(1)

    total_models = len(models_to_download)

    for idx, (model_id, repo_id) in enumerate(models_to_download):
        base_progress = int((idx / total_models) * 100)

        try:
            print_progress(model_id, base_progress, f"Downloading {repo_id}...")

            # Try to download the model
            snapshot_download(
                repo_id=repo_id,
                token=hf_token,
                local_dir_use_symlinks=False
            )

            print_progress(model_id, base_progress + int(100 / total_models) - 5, f"Verifying {repo_id}...")
            print_complete(model_id)

        except RepositoryNotFoundError as e:
            print_error(model_id, f"Repository not found: {repo_id}. Ensure you have accepted the model terms on HuggingFace.")
        except HfHubHTTPError as e:
            if "401" in str(e) or "403" in str(e):
                print_error(model_id, f"Access denied for {repo_id}. Please accept the model terms at https://huggingface.co/{repo_id}")
            else:
                print_error(model_id, f"HTTP error: {e}")
        except Exception as e:
            print_error(model_id, f"Failed to download: {e}")

    print_progress("all", 100, "All models downloaded successfully!")
    print("[DOWNLOAD_COMPLETE]", file=sys.stderr, flush=True)

if __name__ == "__main__":
    download_models()
`

    // Ensure directory exists
    const scriptDir = path.dirname(scriptPath)
    if (!fs.existsSync(scriptDir)) {
      fs.mkdirSync(scriptDir, { recursive: true })
    }

    fs.writeFileSync(scriptPath, scriptContent, { mode: 0o755 })
  }

  /**
   * Trigger model download via Python script (legacy API)
   * Models are downloaded by the Python ML libraries on first use
   */
  async triggerModelDownload(modelId: string, hfToken?: string): Promise<void> {
    const model = ALL_MODELS.find(m => m.id === modelId)
    if (!model) {
      throw new Error(`Unknown model: ${modelId}`)
    }

    if (model.type === 'pyannote') {
      // Use the new batch download for pyannote models
      await this.downloadPyannoteModels(hfToken)
      return
    }

    if (this.downloadingModels.has(modelId)) {
      throw new Error(`Model ${modelId} is already being downloaded`)
    }

    this.downloadingModels.add(modelId)
    this.updateModelStatus(modelId, { downloading: true, progress: 0, error: null })

    try {
      this.emit('downloadStart', { modelId })
      // For Whisper models, they are downloaded automatically by WhisperX
      // This is a placeholder for future implementation
      this.emit('downloadComplete', { modelId })
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error)
      this.updateModelStatus(modelId, { downloading: false, error: errorMessage })
      this.emit('downloadError', { modelId, error: errorMessage })
      throw error
    } finally {
      this.downloadingModels.delete(modelId)
    }
  }

  /**
   * Update model status
   */
  private updateModelStatus(modelId: string, updates: Partial<ModelStatus>): void {
    const current = this.modelStatuses.get(modelId) || {
      id: modelId,
      available: false,
      localPath: null,
      downloading: false,
      progress: 0,
      error: null
    }

    const updated = { ...current, ...updates }
    this.modelStatuses.set(modelId, updated)
    this.emit('statusChange', updated)
  }

  /**
   * Clear model cache
   */
  async clearModelCache(modelId?: string): Promise<void> {
    if (modelId) {
      const model = ALL_MODELS.find(m => m.id === modelId)
      if (model) {
        const modelPath = path.join(this.modelsDir, model.cachePath)
        if (fs.existsSync(modelPath)) {
          fs.rmSync(modelPath, { recursive: true, force: true })
        }
        this.modelStatuses.delete(modelId)
      }
    } else {
      // Clear all models
      if (fs.existsSync(this.modelsDir)) {
        fs.rmSync(this.modelsDir, { recursive: true, force: true })
      }
      this.ensureModelsDirectory()
      this.modelStatuses.clear()
    }
  }

  /**
   * Get total cache size
   */
  getCacheSize(): number {
    if (!fs.existsSync(this.modelsDir)) {
      return 0
    }

    let totalSize = 0
    const walkDir = (dir: string): void => {
      const files = fs.readdirSync(dir)
      for (const file of files) {
        const filePath = path.join(dir, file)
        const stat = fs.statSync(filePath)
        if (stat.isDirectory()) {
          walkDir(filePath)
        } else {
          totalSize += stat.size
        }
      }
    }

    walkDir(this.modelsDir)
    return totalSize
  }

  /**
   * Format size for display
   */
  formatSize(bytes: number): string {
    const units = ['B', 'KB', 'MB', 'GB']
    let size = bytes
    let unitIndex = 0

    while (size >= 1024 && unitIndex < units.length - 1) {
      size /= 1024
      unitIndex++
    }

    return `${size.toFixed(1)} ${units[unitIndex]}`
  }

  /**
   * Scan for existing PyAnnote models in HuggingFace cache
   * Returns information about which models are already present
   */
  scanExistingModels(): {
    foundModels: string[]
    missingModels: string[]
    cacheLocation: string
    canUseExisting: boolean
  } {
    const hfCache = this.getHuggingFaceCacheDir()
    const pyannoteModels = this.getPyannoteModels()
    const foundModels: string[] = []
    const missingModels: string[] = []

    for (const model of pyannoteModels) {
      if (this.checkHuggingFaceCache(model)) {
        foundModels.push(model.id)
      } else {
        missingModels.push(model.id)
      }
    }

    return {
      foundModels,
      missingModels,
      cacheLocation: hfCache,
      canUseExisting: foundModels.length > 0
    }
  }

  /**
   * Generate a shell script for manual model download
   * Returns the script content as a string
   */
  generateDownloadScript(hfToken: string, platform: 'bash' | 'bat' = 'bash'): string {
    const models = [
      { id: 'pyannote/segmentation-3.0', name: 'Segmentation Model' },
      { id: 'pyannote/wespeaker-voxceleb-resnet34-LM', name: 'Speaker Embedding Model' },
      { id: 'pyannote/speaker-diarization-3.1', name: 'Speaker Diarization Pipeline' }
    ]

    const cacheDir = this.getHuggingFaceCacheDir()

    if (platform === 'bat') {
      // Windows batch script
      return `@echo off
REM PyAnnote Models Download Script for Windows
REM Generated by Meeting Notes Application
REM
REM This script downloads PyAnnote speaker diarization models from HuggingFace
REM Prerequisites:
REM   1. Python 3.8+ installed and in PATH
REM   2. pip install huggingface-hub
REM   3. Accepted model licenses on HuggingFace:
${models.map(m => `REM      - ${m.id}: https://huggingface.co/${m.id}`).join('\n')}

echo ========================================
echo PyAnnote Models Download Script
echo ========================================
echo.

REM Set your HuggingFace token
set HF_TOKEN=${hfToken}

REM Set cache directory
set HUGGINGFACE_HUB_CACHE=${cacheDir}\\hub
echo Cache directory: %HUGGINGFACE_HUB_CACHE%
echo.

REM Check if Python is available
python --version >nul 2>&1
if errorlevel 1 (
    echo ERROR: Python is not installed or not in PATH
    echo Please install Python 3.8+ from https://python.org
    pause
    exit /b 1
)

REM Check if huggingface_hub is installed
python -c "import huggingface_hub" >nul 2>&1
if errorlevel 1 (
    echo Installing huggingface_hub...
    pip install huggingface_hub
)

echo.
echo Downloading models...
echo.

${models.map((m, idx) => `
echo [${idx + 1}/${models.length}] Downloading ${m.name}...
python -c "from huggingface_hub import snapshot_download; snapshot_download('${m.id}', token='%HF_TOKEN%')"
if errorlevel 1 (
    echo ERROR: Failed to download ${m.id}
    echo Please ensure you have accepted the license at https://huggingface.co/${m.id}
    pause
    exit /b 1
)
echo Done!
echo.`).join('\n')}

echo.
echo ========================================
echo All models downloaded successfully!
echo ========================================
echo Models are cached at: %HUGGINGFACE_HUB_CACHE%
echo You can now use speaker identification in Meeting Notes.
echo.
pause
`
    } else {
      // Unix shell script (macOS/Linux)
      return `#!/usr/bin/env bash
# PyAnnote Models Download Script
# Generated by Meeting Notes Application
#
# This script downloads PyAnnote speaker diarization models from HuggingFace
# Prerequisites:
#   1. Python 3.8+ installed
#   2. pip install huggingface-hub
#   3. Accepted model licenses on HuggingFace:
${models.map(m => `#      - ${m.id}: https://huggingface.co/${m.id}`).join('\n')}

set -e  # Exit on error

echo "========================================"
echo "PyAnnote Models Download Script"
echo "========================================"
echo ""

# Set your HuggingFace token
export HF_TOKEN="${hfToken}"

# Set cache directory
export HUGGINGFACE_HUB_CACHE="${cacheDir}/hub"
echo "Cache directory: $HUGGINGFACE_HUB_CACHE"
echo ""

# Check if Python is available
if ! command -v python3 &> /dev/null; then
    echo "ERROR: Python 3 is not installed or not in PATH"
    echo "Please install Python 3.8+ from https://python.org"
    exit 1
fi

echo "Using Python: $(which python3)"
echo "Python version: $(python3 --version)"
echo ""

# Check if huggingface_hub is installed
if ! python3 -c "import huggingface_hub" 2>/dev/null; then
    echo "Installing huggingface_hub..."
    python3 -m pip install huggingface_hub
fi

echo ""
echo "Downloading models..."
echo ""

${models.map((m, idx) => `
echo "[${idx + 1}/${models.length}] Downloading ${m.name}..."
python3 -c "from huggingface_hub import snapshot_download; snapshot_download('${m.id}', token='$HF_TOKEN')" || {
    echo "ERROR: Failed to download ${m.id}"
    echo "Please ensure you have accepted the license at https://huggingface.co/${m.id}"
    exit 1
}
echo "Done!"
echo ""`).join('\n')}

echo ""
echo "========================================"
echo "All models downloaded successfully!"
echo "========================================"
echo "Models are cached at: $HUGGINGFACE_HUB_CACHE"
echo "You can now use speaker identification in Meeting Notes."
echo ""
`
    }
  }

  /**
   * Get CLI command for manual download using huggingface-cli
   */
  getManualDownloadCommands(hfToken: string): Array<{
    model: string
    command: string
    description: string
  }> {
    const models = [
      { id: 'pyannote/segmentation-3.0', name: 'Segmentation Model' },
      { id: 'pyannote/wespeaker-voxceleb-resnet34-LM', name: 'Speaker Embedding Model' },
      { id: 'pyannote/speaker-diarization-3.1', name: 'Speaker Diarization Pipeline' }
    ]

    return models.map(m => ({
      model: m.name,
      command: `huggingface-cli download ${m.id} --token ${hfToken}`,
      description: `Download ${m.name} using HuggingFace CLI`
    }))
  }

  /**
   * Get Python commands for manual download
   */
  getManualPythonCommands(hfToken: string): Array<{
    model: string
    command: string
    description: string
  }> {
    const models = [
      { id: 'pyannote/segmentation-3.0', name: 'Segmentation Model' },
      { id: 'pyannote/wespeaker-voxceleb-resnet34-LM', name: 'Speaker Embedding Model' },
      { id: 'pyannote/speaker-diarization-3.1', name: 'Speaker Diarization Pipeline' }
    ]

    return models.map(m => ({
      model: m.name,
      command: `python -c "from huggingface_hub import snapshot_download; snapshot_download('${m.id}', token='${hfToken}')"`,
      description: `Download ${m.name} using Python`
    }))
  }
}

// Export singleton instance
export const modelManager = new ModelManagerService()

// Export class for testing
export { ModelManagerService }
