/**
 * Model Update Scheduler Service
 *
 * Manages background model updates with intelligent scheduling:
 * - Checks for updates on app startup and at configurable intervals
 * - Downloads during system idle periods
 * - Respects battery level and network conditions
 * - Pauses during active recording
 * - Provides notifications for available and completed updates
 */

import { EventEmitter } from 'events'
import { powerMonitor, BrowserWindow } from 'electron'
import { deltaDownloadManager } from './deltaDownloadManager'
import { deltaModelStorage } from './deltaModelStorage'
import { getDatabaseService } from './database'
import type {
  SchedulerConfig,
  SchedulerState,
  SchedulerStatus,
  PauseReason,
  ModelUpdateInfo,
  ModelUpdateCheckResult,
  ModelManifest,
  ModelDeltaRegistry,
  DeltaPlan
} from '../types/deltaModels'

// Electron app import with fallback for testing
let app: { getPath: (name: string) => string; isPackaged: boolean } | undefined
try {
  app = require('electron').app
} catch {
  app = undefined
}

// ============================================================================
// Constants
// ============================================================================

const DEFAULT_CHECK_INTERVAL = 24 * 60 * 60 * 1000 // 24 hours
const DEFAULT_MIN_IDLE_TIME = 5 * 60 * 1000 // 5 minutes
const DEFAULT_MIN_BATTERY = 20 // 20%
const IDLE_CHECK_INTERVAL = 30 * 1000 // 30 seconds
const MANIFEST_URL = 'https://models.example.com/registry.json' // Placeholder

// ============================================================================
// Model Update Scheduler Service Class
// ============================================================================

class ModelUpdateSchedulerService extends EventEmitter {
  private config: SchedulerConfig
  private state: SchedulerState
  private checkIntervalId: NodeJS.Timeout | null = null
  private idleCheckIntervalId: NodeJS.Timeout | null = null
  private initialized: boolean = false
  private modelRegistry: ModelDeltaRegistry | null = null
  private recordingActive: boolean = false

  constructor() {
    super()
    this.config = this.getDefaultConfig()
    this.state = this.getDefaultState()
  }

  /**
   * Get default configuration
   */
  private getDefaultConfig(): SchedulerConfig {
    return {
      enabled: true,
      checkOnStartup: true,
      checkInterval: DEFAULT_CHECK_INTERVAL,
      minIdleTime: DEFAULT_MIN_IDLE_TIME,
      maxBandwidth: 0,
      minBatteryLevel: DEFAULT_MIN_BATTERY,
      pauseOnMetered: true,
      pauseDuringRecording: true,
      allowedHours: [0, 24],
      maxConcurrentDownloads: 2,
      notifyOnAvailable: true,
      notifyOnComplete: true
    }
  }

  /**
   * Get default state
   */
  private getDefaultState(): SchedulerState {
    return {
      status: 'idle',
      lastCheckAt: null,
      nextCheckAt: null,
      systemIdleTime: 0,
      batteryLevel: null,
      onBattery: false,
      networkAvailable: true,
      isMetered: false,
      recordingActive: false,
      queueLength: 0,
      activeDownloads: 0
    }
  }

  /**
   * Initialize the scheduler
   */
  async initialize(customConfig?: Partial<SchedulerConfig>): Promise<void> {
    if (this.initialized) {
      return
    }

    // Merge custom config
    if (customConfig) {
      this.config = { ...this.config, ...customConfig }
    }

    // Initialize dependencies
    await deltaModelStorage.initialize()
    await deltaDownloadManager.initialize()

    // Load saved configuration
    await this.loadSavedConfig()

    // Set up power monitoring
    this.setupPowerMonitoring()

    // Start idle monitoring
    this.startIdleMonitoring()

    // Schedule periodic update checks
    if (this.config.enabled) {
      this.scheduleNextCheck()

      // Check on startup if configured
      if (this.config.checkOnStartup) {
        // Delay startup check to not interfere with app initialization
        setTimeout(() => {
          this.checkForUpdates()
        }, 10000) // 10 second delay
      }
    }

    // Listen for download events
    this.setupDownloadListeners()

    this.initialized = true
    this.updateState({ status: 'running' })

    console.log('[ModelUpdateScheduler] Initialized')
  }

  /**
   * Load saved configuration from database
   */
  private async loadSavedConfig(): Promise<void> {
    try {
      const dbService = getDatabaseService()
      const db = dbService.getDatabase()

      const row = db.prepare(`
        SELECT value FROM settings WHERE key = 'model_update_scheduler_config'
      `).get() as { value: string } | undefined

      if (row) {
        const savedConfig = JSON.parse(row.value)
        this.config = { ...this.config, ...savedConfig }
      }
    } catch (error) {
      console.error('[ModelUpdateScheduler] Failed to load saved config:', error)
    }
  }

  /**
   * Save configuration to database
   */
  async saveConfig(): Promise<void> {
    try {
      const dbService = getDatabaseService()
      const db = dbService.getDatabase()

      db.prepare(`
        INSERT OR REPLACE INTO settings (key, value, category)
        VALUES ('model_update_scheduler_config', ?, 'storage')
      `).run(JSON.stringify(this.config))
    } catch (error) {
      console.error('[ModelUpdateScheduler] Failed to save config:', error)
    }
  }

  /**
   * Set up power monitoring
   */
  private setupPowerMonitoring(): void {
    try {
      // Monitor battery status
      powerMonitor.on('on-battery', () => {
        this.updateState({ onBattery: true })
        this.checkAndPauseIfNeeded()
      })

      powerMonitor.on('on-ac', () => {
        this.updateState({ onBattery: false })
        this.tryResumeDownloads()
      })

      // Monitor system suspend/resume
      powerMonitor.on('suspend', () => {
        this.pauseAllDownloads('system_busy')
      })

      powerMonitor.on('resume', () => {
        // Wait a bit after resume before checking downloads
        setTimeout(() => {
          this.tryResumeDownloads()
        }, 5000)
      })

      // Initial battery check
      // Note: Electron doesn't have a direct battery API, so we rely on events
    } catch (error) {
      console.error('[ModelUpdateScheduler] Power monitoring setup failed:', error)
    }
  }

  /**
   * Start idle time monitoring
   */
  private startIdleMonitoring(): void {
    this.idleCheckIntervalId = setInterval(() => {
      try {
        const idleTime = powerMonitor.getSystemIdleTime() * 1000 // Convert to ms
        this.updateState({ systemIdleTime: idleTime })

        // Check if we should start/stop downloads based on idle state
        if (idleTime >= this.config.minIdleTime) {
          this.tryStartIdleDownloads()
        }
      } catch (error) {
        // powerMonitor might not be available in all environments
        console.debug('[ModelUpdateScheduler] Idle check error:', error)
      }
    }, IDLE_CHECK_INTERVAL)
  }

  /**
   * Stop idle monitoring
   */
  private stopIdleMonitoring(): void {
    if (this.idleCheckIntervalId) {
      clearInterval(this.idleCheckIntervalId)
      this.idleCheckIntervalId = null
    }
  }

  /**
   * Set up download event listeners
   */
  private setupDownloadListeners(): void {
    deltaDownloadManager.on('download-complete', (data) => {
      this.updateQueueStats()
      if (this.config.notifyOnComplete) {
        this.sendNotification('Model Update Complete', `${data.modelId} has been updated to ${data.version}`)
      }
      this.emit('model-updated', data)
    })

    deltaDownloadManager.on('download-error', (data) => {
      this.updateQueueStats()
      this.emit('update-error', data)
    })

    deltaDownloadManager.on('download-progress', () => {
      this.updateQueueStats()
    })
  }

  /**
   * Schedule the next update check
   */
  private scheduleNextCheck(): void {
    if (this.checkIntervalId) {
      clearTimeout(this.checkIntervalId)
    }

    const nextCheck = Date.now() + this.config.checkInterval
    this.updateState({ nextCheckAt: nextCheck })

    this.checkIntervalId = setTimeout(() => {
      this.checkForUpdates()
      this.scheduleNextCheck()
    }, this.config.checkInterval)
  }

  /**
   * Check for available model updates
   */
  async checkForUpdates(): Promise<ModelUpdateCheckResult> {
    console.log('[ModelUpdateScheduler] Checking for model updates...')
    this.updateState({ status: 'running', lastCheckAt: Date.now() })

    try {
      // Fetch latest model registry
      const registry = await this.fetchModelRegistry()
      this.modelRegistry = registry

      const updates: ModelUpdateInfo[] = []
      let totalDownloadSize = 0
      let hasRequiredUpdates = false

      // Check each model for updates
      for (const manifest of registry.models) {
        const updateInfo = await this.checkModelUpdate(manifest)
        if (updateInfo.updateAvailable) {
          updates.push(updateInfo)
          if (updateInfo.deltaPlan) {
            totalDownloadSize += updateInfo.deltaPlan.totalDownloadSize
          }
          if (updateInfo.required) {
            hasRequiredUpdates = true
          }
        }
      }

      const result: ModelUpdateCheckResult = {
        checkedAt: Date.now(),
        updates,
        totalDownloadSize,
        hasRequiredUpdates
      }

      // Emit event and send notification
      this.emit('update-check-complete', result)

      if (updates.length > 0 && this.config.notifyOnAvailable) {
        const message = `${updates.length} model update(s) available`
        this.sendNotification('Model Updates Available', message)
      }

      console.log(`[ModelUpdateScheduler] Found ${updates.length} updates available`)
      return result
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error)
      console.error('[ModelUpdateScheduler] Update check failed:', errorMessage)

      const result: ModelUpdateCheckResult = {
        checkedAt: Date.now(),
        updates: [],
        totalDownloadSize: 0,
        hasRequiredUpdates: false,
        error: errorMessage
      }

      this.emit('update-check-complete', result)
      return result
    }
  }

  /**
   * Fetch the model registry from the server
   */
  private async fetchModelRegistry(): Promise<ModelDeltaRegistry> {
    // In production, this would fetch from a real server
    // For now, return a mock registry
    return {
      version: 1,
      models: [],
      updateUrl: MANIFEST_URL,
      updatedAt: new Date().toISOString()
    }
  }

  /**
   * Check if a specific model has updates available
   */
  private async checkModelUpdate(manifest: ModelManifest): Promise<ModelUpdateInfo> {
    const currentVersion = await this.getCurrentModelVersion(manifest.modelId)
    const latestVersion = manifest.latestVersion

    const updateAvailable = currentVersion !== latestVersion

    let deltaPlan: DeltaPlan | undefined
    if (updateAvailable) {
      const targetVersion = manifest.versions.find(v => v.version === latestVersion)
      if (targetVersion) {
        deltaPlan = await deltaDownloadManager.calculateDelta(
          manifest.modelId,
          currentVersion,
          targetVersion,
          manifest
        )
      }
    }

    return {
      modelId: manifest.modelId,
      modelName: manifest.name,
      currentVersion,
      latestVersion,
      updateAvailable,
      deltaPlan,
      releaseNotes: manifest.versions.find(v => v.version === latestVersion)?.releaseNotes,
      releasedAt: manifest.versions.find(v => v.version === latestVersion)?.releasedAt,
      required: manifest.type === 'whisper' || manifest.type === 'pyannote' // Required models
    }
  }

  /**
   * Get the current version of a model
   */
  private async getCurrentModelVersion(modelId: string): Promise<string | null> {
    const dbService = getDatabaseService()
    const db = dbService.getDatabase()

    const row = db.prepare(`
      SELECT version FROM model_manifests
      WHERE model_id = ? AND is_current = 1
      ORDER BY created_at DESC LIMIT 1
    `).get(modelId) as { version: string } | undefined

    return row?.version || null
  }

  /**
   * Queue updates for download
   */
  async queueUpdates(updates: ModelUpdateInfo[]): Promise<void> {
    for (const update of updates) {
      if (update.deltaPlan) {
        const priority = update.required ? 'high' : 'normal'
        await deltaDownloadManager.queueDownload(update.deltaPlan, priority)
      }
    }

    this.updateQueueStats()
    await deltaDownloadManager.processQueue()
  }

  /**
   * Try to start downloads when system is idle
   */
  private tryStartIdleDownloads(): void {
    if (!this.canDownload()) {
      return
    }

    // Process the download queue
    deltaDownloadManager.processQueue()
  }

  /**
   * Try to resume paused downloads
   */
  private tryResumeDownloads(): void {
    if (!this.canDownload()) {
      return
    }

    // Resume paused downloads
    const queue = deltaDownloadManager.getQueue()
    for (const item of queue) {
      if (item.status === 'paused') {
        deltaDownloadManager.resumeDownload(item.id)
      }
    }
  }

  /**
   * Check if downloads are allowed based on current conditions
   */
  private canDownload(): boolean {
    // Check if scheduler is enabled
    if (!this.config.enabled) {
      return false
    }

    // Check if paused
    if (this.state.status === 'paused') {
      return false
    }

    // Check battery level
    if (this.state.onBattery && this.state.batteryLevel !== null) {
      if (this.state.batteryLevel < this.config.minBatteryLevel) {
        return false
      }
    }

    // Check metered connection
    if (this.config.pauseOnMetered && this.state.isMetered) {
      return false
    }

    // Check recording status
    if (this.config.pauseDuringRecording && this.recordingActive) {
      return false
    }

    // Check allowed hours
    const hour = new Date().getHours()
    if (hour < this.config.allowedHours[0] || hour >= this.config.allowedHours[1]) {
      return false
    }

    return true
  }

  /**
   * Check conditions and pause if needed
   */
  private checkAndPauseIfNeeded(): void {
    if (this.state.onBattery && this.state.batteryLevel !== null) {
      if (this.state.batteryLevel < this.config.minBatteryLevel) {
        this.pauseAllDownloads('low_battery')
        return
      }
    }

    if (this.config.pauseOnMetered && this.state.isMetered) {
      this.pauseAllDownloads('metered_connection')
      return
    }

    if (this.config.pauseDuringRecording && this.recordingActive) {
      this.pauseAllDownloads('recording_active')
      return
    }
  }

  /**
   * Pause all active downloads
   */
  private pauseAllDownloads(reason: PauseReason): void {
    this.updateState({ status: 'paused', pauseReason: reason })

    const queue = deltaDownloadManager.getQueue()
    for (const item of queue) {
      if (item.status === 'active') {
        deltaDownloadManager.pauseDownload(item.id)
      }
    }

    console.log(`[ModelUpdateScheduler] Downloads paused: ${reason}`)
  }

  /**
   * Update queue statistics
   */
  private updateQueueStats(): void {
    const queue = deltaDownloadManager.getQueue()
    this.updateState({
      queueLength: queue.length,
      activeDownloads: queue.filter(i => i.status === 'active').length
    })
  }

  /**
   * Update scheduler state
   */
  private updateState(updates: Partial<SchedulerState>): void {
    this.state = { ...this.state, ...updates }
    this.emit('scheduler-state-change', this.state)
  }

  /**
   * Send a system notification
   */
  private sendNotification(title: string, body: string): void {
    try {
      const windows = BrowserWindow.getAllWindows()
      if (windows.length > 0) {
        windows[0].webContents.send('notification', { title, body })
      }
    } catch (error) {
      console.debug('[ModelUpdateScheduler] Notification failed:', error)
    }
  }

  /**
   * Set recording active status
   */
  setRecordingActive(active: boolean): void {
    this.recordingActive = active
    this.updateState({ recordingActive: active })

    if (active && this.config.pauseDuringRecording) {
      this.pauseAllDownloads('recording_active')
    } else if (!active) {
      this.tryResumeDownloads()
    }
  }

  /**
   * Get current scheduler state
   */
  getState(): SchedulerState {
    return { ...this.state }
  }

  /**
   * Get current configuration
   */
  getConfig(): SchedulerConfig {
    return { ...this.config }
  }

  /**
   * Update configuration
   */
  async updateConfig(updates: Partial<SchedulerConfig>): Promise<void> {
    this.config = { ...this.config, ...updates }
    await this.saveConfig()

    // Reschedule if needed
    if (this.config.enabled) {
      this.scheduleNextCheck()
      this.updateState({ status: 'running' })
    } else {
      this.stop()
    }
  }

  /**
   * Enable the scheduler
   */
  enable(): void {
    this.config.enabled = true
    this.scheduleNextCheck()
    this.startIdleMonitoring()
    this.updateState({ status: 'running' })
    this.saveConfig()
  }

  /**
   * Disable the scheduler
   */
  disable(): void {
    this.stop()
    this.config.enabled = false
    this.saveConfig()
  }

  /**
   * Stop the scheduler
   */
  stop(): void {
    if (this.checkIntervalId) {
      clearTimeout(this.checkIntervalId)
      this.checkIntervalId = null
    }
    this.stopIdleMonitoring()
    this.updateState({ status: 'disabled', nextCheckAt: null })
  }

  /**
   * Force an immediate update check
   */
  async forceCheck(): Promise<ModelUpdateCheckResult> {
    // Clear scheduled check
    if (this.checkIntervalId) {
      clearTimeout(this.checkIntervalId)
    }

    const result = await this.checkForUpdates()

    // Reschedule next check
    this.scheduleNextCheck()

    return result
  }

  /**
   * Cleanup resources
   */
  destroy(): void {
    this.stop()
    this.removeAllListeners()
  }
}

// Export singleton instance
export const modelUpdateScheduler = new ModelUpdateSchedulerService()

// Export class for testing
export { ModelUpdateSchedulerService }
