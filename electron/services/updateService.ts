/**
 * Update Service
 *
 * Handles automatic update checking, downloading, and installation using electron-updater.
 * Supports rollback on failure and provides detailed update status information.
 */

import { autoUpdater, UpdateInfo, ProgressInfo } from 'electron-updater'
import { app, BrowserWindow } from 'electron'
import { loggerService } from './loggerService'
import path from 'path'
import fs from 'fs'

// ============================================================================
// Types
// ============================================================================

export type UpdateStatus =
  | 'idle'
  | 'checking'
  | 'available'
  | 'not-available'
  | 'downloading'
  | 'downloaded'
  | 'installing'
  | 'error'

export interface UpdateState {
  status: UpdateStatus
  currentVersion: string
  availableVersion: string | null
  releaseNotes: string | null
  releaseDate: string | null
  downloadProgress: number
  bytesDownloaded: number
  totalBytes: number
  error: string | null
  lastChecked: number | null
}

export interface UpdateCheckResult {
  updateAvailable: boolean
  currentVersion: string
  availableVersion?: string
  releaseNotes?: string
  releaseDate?: string
  error?: string
}

export interface RollbackInfo {
  available: boolean
  previousVersion: string | null
  backupPath: string | null
}

// ============================================================================
// Service State
// ============================================================================

let state: UpdateState = {
  status: 'idle',
  currentVersion: app.getVersion(),
  availableVersion: null,
  releaseNotes: null,
  releaseDate: null,
  downloadProgress: 0,
  bytesDownloaded: 0,
  totalBytes: 0,
  error: null,
  lastChecked: null
}

// Event listeners for forwarding to renderer
let statusChangeCallbacks: Array<(state: UpdateState) => void> = []

// Backup directory for rollback support
const backupDir = path.join(app.getPath('userData'), 'update-backups')

// ============================================================================
// Helper Functions
// ============================================================================

function updateState(newState: Partial<UpdateState>) {
  state = { ...state, ...newState }
  loggerService.debug('Update state changed', { state })
  statusChangeCallbacks.forEach(cb => cb(state))
}

function ensureBackupDirectory() {
  if (!fs.existsSync(backupDir)) {
    fs.mkdirSync(backupDir, { recursive: true })
  }
}

function saveVersionInfo(version: string) {
  ensureBackupDirectory()
  const versionFile = path.join(backupDir, 'previous-version.json')
  const versionInfo = {
    version,
    timestamp: Date.now(),
    appPath: app.getPath('exe')
  }
  fs.writeFileSync(versionFile, JSON.stringify(versionInfo, null, 2))
  loggerService.info('Saved version info for rollback', versionInfo)
}

function getPreviousVersionInfo(): { version: string; timestamp: number; appPath: string } | null {
  const versionFile = path.join(backupDir, 'previous-version.json')
  if (fs.existsSync(versionFile)) {
    try {
      return JSON.parse(fs.readFileSync(versionFile, 'utf-8'))
    } catch (error) {
      loggerService.error('Failed to read previous version info', { error })
    }
  }
  return null
}

// ============================================================================
// Auto Updater Configuration
// ============================================================================

function configureAutoUpdater() {
  // Configure auto-updater
  autoUpdater.autoDownload = false // We'll control downloads manually
  autoUpdater.autoInstallOnAppQuit = true
  autoUpdater.allowPrerelease = false
  autoUpdater.allowDowngrade = false

  // Log configuration
  autoUpdater.logger = {
    info: (message: string) => loggerService.info(`[AutoUpdater] ${message}`),
    warn: (message: string) => loggerService.warn(`[AutoUpdater] ${message}`),
    error: (message: string) => loggerService.error(`[AutoUpdater] ${message}`),
    debug: (message: string) => loggerService.debug(`[AutoUpdater] ${message}`)
  }

  // Event handlers
  autoUpdater.on('checking-for-update', () => {
    loggerService.info('Checking for updates...')
    updateState({ status: 'checking', error: null })
  })

  autoUpdater.on('update-available', (info: UpdateInfo) => {
    loggerService.info('Update available', { version: info.version })
    updateState({
      status: 'available',
      availableVersion: info.version,
      releaseNotes: typeof info.releaseNotes === 'string'
        ? info.releaseNotes
        : Array.isArray(info.releaseNotes)
          ? info.releaseNotes.map(n => n.note).join('\n')
          : null,
      releaseDate: info.releaseDate || null,
      lastChecked: Date.now()
    })
  })

  autoUpdater.on('update-not-available', (info: UpdateInfo) => {
    loggerService.info('No update available', { currentVersion: info.version })
    updateState({
      status: 'not-available',
      lastChecked: Date.now()
    })
  })

  autoUpdater.on('download-progress', (progressInfo: ProgressInfo) => {
    loggerService.debug('Download progress', progressInfo)
    updateState({
      status: 'downloading',
      downloadProgress: progressInfo.percent,
      bytesDownloaded: progressInfo.transferred,
      totalBytes: progressInfo.total
    })
  })

  autoUpdater.on('update-downloaded', (info: UpdateInfo) => {
    loggerService.info('Update downloaded', { version: info.version })
    // Save current version for rollback
    saveVersionInfo(app.getVersion())
    updateState({
      status: 'downloaded',
      downloadProgress: 100
    })
  })

  autoUpdater.on('error', (error: Error) => {
    loggerService.error('Update error', { error: error.message, stack: error.stack })
    updateState({
      status: 'error',
      error: error.message
    })
  })
}

// Initialize auto-updater configuration
configureAutoUpdater()

// ============================================================================
// Service API
// ============================================================================

export const updateService = {
  /**
   * Get the current update state
   */
  getState(): UpdateState {
    return { ...state }
  },

  /**
   * Check for available updates
   */
  async checkForUpdates(): Promise<UpdateCheckResult> {
    try {
      loggerService.info('Manually checking for updates')

      // In development, return a mock result
      if (!app.isPackaged) {
        loggerService.info('Skipping update check in development mode')
        updateState({
          status: 'not-available',
          lastChecked: Date.now()
        })
        return {
          updateAvailable: false,
          currentVersion: state.currentVersion
        }
      }

      const result = await autoUpdater.checkForUpdates()

      if (result && result.updateInfo) {
        const updateAvailable = result.updateInfo.version !== state.currentVersion
        return {
          updateAvailable,
          currentVersion: state.currentVersion,
          availableVersion: result.updateInfo.version,
          releaseNotes: typeof result.updateInfo.releaseNotes === 'string'
            ? result.updateInfo.releaseNotes
            : undefined,
          releaseDate: result.updateInfo.releaseDate || undefined
        }
      }

      return {
        updateAvailable: false,
        currentVersion: state.currentVersion
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error'
      loggerService.error('Failed to check for updates', { error: errorMessage })
      updateState({
        status: 'error',
        error: errorMessage,
        lastChecked: Date.now()
      })
      return {
        updateAvailable: false,
        currentVersion: state.currentVersion,
        error: errorMessage
      }
    }
  },

  /**
   * Download the available update
   */
  async downloadUpdate(): Promise<{ success: boolean; error?: string }> {
    if (state.status !== 'available') {
      return { success: false, error: 'No update available to download' }
    }

    try {
      loggerService.info('Starting update download')
      updateState({ status: 'downloading', downloadProgress: 0 })
      await autoUpdater.downloadUpdate()
      return { success: true }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error'
      loggerService.error('Failed to download update', { error: errorMessage })
      updateState({
        status: 'error',
        error: errorMessage
      })
      return { success: false, error: errorMessage }
    }
  },

  /**
   * Install the downloaded update and restart the app
   */
  async installUpdate(): Promise<{ success: boolean; error?: string }> {
    if (state.status !== 'downloaded') {
      return { success: false, error: 'No update downloaded to install' }
    }

    try {
      loggerService.info('Installing update and restarting app')
      updateState({ status: 'installing' })

      // Quit and install will close the app and install the update
      setImmediate(() => {
        autoUpdater.quitAndInstall(false, true)
      })

      return { success: true }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error'
      loggerService.error('Failed to install update', { error: errorMessage })
      updateState({
        status: 'error',
        error: errorMessage
      })
      return { success: false, error: errorMessage }
    }
  },

  /**
   * Get rollback information
   */
  getRollbackInfo(): RollbackInfo {
    const previousVersion = getPreviousVersionInfo()
    return {
      available: previousVersion !== null,
      previousVersion: previousVersion?.version || null,
      backupPath: previousVersion ? backupDir : null
    }
  },

  /**
   * Attempt to rollback to the previous version
   * Note: Full rollback requires platform-specific implementation
   * This method provides the framework for rollback functionality
   */
  async rollback(): Promise<{ success: boolean; error?: string }> {
    const rollbackInfo = this.getRollbackInfo()

    if (!rollbackInfo.available) {
      return { success: false, error: 'No previous version available for rollback' }
    }

    try {
      loggerService.info('Attempting rollback to previous version', {
        previousVersion: rollbackInfo.previousVersion
      })

      // For now, we just clear the update state and notify the user
      // A full rollback would require:
      // 1. Keeping backups of previous app versions
      // 2. Platform-specific reinstallation logic
      // 3. Potential user intervention for security reasons

      updateState({
        status: 'idle',
        error: null,
        availableVersion: null,
        downloadProgress: 0
      })

      // Return information about how to perform manual rollback
      return {
        success: false,
        error: `Automatic rollback is not fully supported. To rollback to version ${rollbackInfo.previousVersion}, please download and reinstall from the releases page.`
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error'
      loggerService.error('Failed to rollback', { error: errorMessage })
      return { success: false, error: errorMessage }
    }
  },

  /**
   * Subscribe to status change events
   */
  onStatusChange(callback: (state: UpdateState) => void): () => void {
    statusChangeCallbacks.push(callback)
    return () => {
      statusChangeCallbacks = statusChangeCallbacks.filter(cb => cb !== callback)
    }
  },

  /**
   * Set the update server URL
   */
  setFeedURL(url: string): void {
    loggerService.info('Setting update feed URL', { url })
    autoUpdater.setFeedURL({
      provider: 'generic',
      url
    })
  },

  /**
   * Enable or disable auto-download
   */
  setAutoDownload(enabled: boolean): void {
    autoUpdater.autoDownload = enabled
    loggerService.info('Auto-download setting changed', { enabled })
  },

  /**
   * Enable or disable pre-release updates
   */
  setAllowPrerelease(enabled: boolean): void {
    autoUpdater.allowPrerelease = enabled
    loggerService.info('Pre-release setting changed', { enabled })
  },

  /**
   * Reset the update state
   */
  reset(): void {
    updateState({
      status: 'idle',
      availableVersion: null,
      releaseNotes: null,
      releaseDate: null,
      downloadProgress: 0,
      bytesDownloaded: 0,
      totalBytes: 0,
      error: null
    })
  }
}

/**
 * Reset update service state (for testing)
 */
export function resetUpdateServiceState(): void {
  statusChangeCallbacks = []
  state = {
    status: 'idle',
    currentVersion: app.getVersion(),
    availableVersion: null,
    releaseNotes: null,
    releaseDate: null,
    downloadProgress: 0,
    bytesDownloaded: 0,
    totalBytes: 0,
    error: null,
    lastChecked: null
  }
}
