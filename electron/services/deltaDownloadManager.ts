/**
 * Delta Download Manager Service
 *
 * Manages the download of model updates using delta/incremental updates.
 * Key features:
 * - Calculates optimal delta plans between versions
 * - Downloads only changed chunks
 * - Provides progress tracking and resume capability
 * - Manages download queue with priority support
 * - Handles verification and assembly of complete models
 */

import { EventEmitter } from 'events'
import * as fs from 'fs'
import * as path from 'path'
import * as https from 'https'
import * as http from 'http'
import * as crypto from 'crypto'
import { deltaModelStorage } from './deltaModelStorage'
import { getDatabaseService } from './database'
import { pathNormalizationService } from './pathNormalizationService'
import type {
  DeltaPlan,
  ModelDownloadProgress,
  DownloadQueueItem,
  DownloadPhase,
  DownloadPriority,
  ManifestChunk,
  ModelManifest,
  ModelVersionInfo,
  DeltaDownloadConfig,
  ChunkDownloadProgress,
  ModelUpdateQueueRecord
} from '../types/deltaModels'

// Electron app import with fallback for testing
let app: { getPath: (name: string) => string } | undefined
try {
  app = require('electron').app
} catch {
  app = undefined
}

// ============================================================================
// Constants
// ============================================================================

const DEFAULT_MAX_CONCURRENT = 3
const DEFAULT_CHUNK_TIMEOUT = 60000 // 60 seconds
const DEFAULT_CHUNK_RETRIES = 3
const DEFAULT_RETRY_DELAY = 1000 // 1 second
const DEFAULT_BUFFER_SIZE = 64 * 1024 // 64 KB
const REFERENCE_BANDWIDTH = 10 * 1024 * 1024 // 10 MB/s for time estimates

// ============================================================================
// Delta Download Manager Service Class
// ============================================================================

class DeltaDownloadManagerService extends EventEmitter {
  private config: DeltaDownloadConfig
  private downloadQueue: Map<string, DownloadQueueItem> = new Map()
  private activeDownloads: Set<string> = new Set()
  private abortControllers: Map<string, AbortController> = new Map()
  private initialized: boolean = false

  constructor() {
    super()
    this.config = this.getDefaultConfig()
  }

  /**
   * Get default configuration
   */
  private getDefaultConfig(): DeltaDownloadConfig {
    return {
      maxConcurrentChunks: DEFAULT_MAX_CONCURRENT,
      chunkTimeout: DEFAULT_CHUNK_TIMEOUT,
      chunkRetries: DEFAULT_CHUNK_RETRIES,
      retryDelay: DEFAULT_RETRY_DELAY,
      verifyAfterDownload: true,
      bufferSize: DEFAULT_BUFFER_SIZE,
      maxBandwidth: 0 // Unlimited
    }
  }

  /**
   * Initialize the download manager
   */
  async initialize(customConfig?: Partial<DeltaDownloadConfig>): Promise<void> {
    if (this.initialized) {
      return
    }

    // Ensure storage is initialized
    await deltaModelStorage.initialize()

    // Merge custom config
    if (customConfig) {
      this.config = { ...this.config, ...customConfig }
    }

    // Restore any pending downloads from database
    await this.restoreDownloadQueue()

    this.initialized = true
    console.log('[DeltaDownloadManager] Initialized')
  }

  /**
   * Restore download queue from database
   */
  private async restoreDownloadQueue(): Promise<void> {
    const dbService = getDatabaseService()
    const db = dbService.getDatabase()

    const pendingDownloads = db.prepare(`
      SELECT * FROM model_update_queue
      WHERE status IN ('queued', 'active', 'paused')
      ORDER BY priority DESC, queued_at ASC
    `).all() as ModelUpdateQueueRecord[]

    for (const record of pendingDownloads) {
      const queueItem: DownloadQueueItem = {
        id: record.id,
        modelId: record.model_id,
        targetVersion: record.target_version,
        priority: record.priority as DownloadPriority,
        plan: JSON.parse(record.plan_json),
        status: record.status === 'active' ? 'paused' : record.status as DownloadQueueItem['status'],
        progress: JSON.parse(record.progress_json),
        queuedAt: record.queued_at,
        startedAt: record.started_at,
        completedAt: record.completed_at,
        retryCount: record.retry_count,
        maxRetries: record.max_retries,
        error: record.error || undefined
      }

      this.downloadQueue.set(record.id, queueItem)
    }

    console.log(`[DeltaDownloadManager] Restored ${pendingDownloads.length} downloads from queue`)
  }

  /**
   * Calculate a delta plan between current and target version
   */
  async calculateDelta(
    modelId: string,
    currentVersion: string | null,
    targetManifest: ModelVersionInfo,
    manifest: ModelManifest
  ): Promise<DeltaPlan> {
    const targetChunks = targetManifest.chunks

    // Get existing chunks for reuse
    let reusableChunks: Map<string, any> = new Map()
    let currentChunkHashes: Set<string> = new Set()

    if (currentVersion) {
      const existingChunks = await deltaModelStorage.getModelChunks(modelId, currentVersion)
      currentChunkHashes = new Set(existingChunks.map(c => c.hash))

      // Find chunks that can be reused
      reusableChunks = await deltaModelStorage.findReusableChunks(
        targetChunks.map(c => c.hash)
      )
    }

    // Determine which chunks need to be downloaded
    const chunksToDownload: ManifestChunk[] = []
    const chunksToReuse: string[] = []

    for (const chunk of targetChunks) {
      if (reusableChunks.has(chunk.hash) || currentChunkHashes.has(chunk.hash)) {
        chunksToReuse.push(chunk.hash)
      } else {
        chunksToDownload.push(chunk)
      }
    }

    const totalDownloadSize = chunksToDownload.reduce((sum, c) => sum + c.size, 0)
    const reusePercentage = targetChunks.length > 0
      ? Math.round((chunksToReuse.length / targetChunks.length) * 100)
      : 0

    const plan: DeltaPlan = {
      modelId,
      currentVersion,
      targetVersion: targetManifest.version,
      chunksToDownload,
      chunksToReuse,
      totalDownloadSize,
      totalChunks: targetChunks.length,
      reusedChunks: chunksToReuse.length,
      reusePercentage,
      estimatedDownloadTime: Math.ceil(totalDownloadSize / REFERENCE_BANDWIDTH),
      isDelta: currentVersion !== null && chunksToReuse.length > 0
    }

    console.log(`[DeltaDownloadManager] Delta plan for ${modelId}:`, {
      targetVersion: targetManifest.version,
      chunksToDownload: chunksToDownload.length,
      chunksToReuse: chunksToReuse.length,
      reusePercentage: `${reusePercentage}%`,
      downloadSize: this.formatBytes(totalDownloadSize)
    })

    return plan
  }

  /**
   * Queue a model download
   */
  async queueDownload(
    plan: DeltaPlan,
    priority: DownloadPriority = 'normal'
  ): Promise<DownloadQueueItem> {
    const id = crypto.randomUUID()
    const now = Date.now()

    const progress: ModelDownloadProgress = {
      modelId: plan.modelId,
      targetVersion: plan.targetVersion,
      phase: 'idle',
      overallProgress: 0,
      chunksCompleted: 0,
      totalChunks: plan.chunksToDownload.length,
      bytesDownloaded: 0,
      totalBytes: plan.totalDownloadSize,
      speed: 0,
      eta: plan.estimatedDownloadTime,
      message: 'Queued for download',
      startedAt: now,
      isDelta: plan.isDelta,
      reusePercentage: plan.reusePercentage
    }

    const queueItem: DownloadQueueItem = {
      id,
      modelId: plan.modelId,
      targetVersion: plan.targetVersion,
      priority,
      plan,
      status: 'queued',
      progress,
      queuedAt: now,
      startedAt: null,
      completedAt: null,
      retryCount: 0,
      maxRetries: this.config.chunkRetries
    }

    // Save to database
    const dbService = getDatabaseService()
    const db = dbService.getDatabase()

    db.prepare(`
      INSERT INTO model_update_queue (
        id, model_id, target_version, priority, status,
        plan_json, progress_json, queued_at, retry_count, max_retries
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id, plan.modelId, plan.targetVersion, priority, 'queued',
      JSON.stringify(plan), JSON.stringify(progress), now, 0, this.config.chunkRetries
    )

    this.downloadQueue.set(id, queueItem)
    this.emit('download-queued', queueItem)

    console.log(`[DeltaDownloadManager] Download queued: ${plan.modelId} v${plan.targetVersion}`)

    return queueItem
  }

  /**
   * Start processing the download queue
   */
  async processQueue(): Promise<void> {
    // Get sorted queue items by priority
    const queueItems = Array.from(this.downloadQueue.values())
      .filter(item => item.status === 'queued')
      .sort((a, b) => {
        const priorityOrder = { critical: 0, high: 1, normal: 2, low: 3, background: 4 }
        const priorityDiff = priorityOrder[a.priority] - priorityOrder[b.priority]
        if (priorityDiff !== 0) return priorityDiff
        return a.queuedAt - b.queuedAt
      })

    // Start downloads up to max concurrent
    for (const item of queueItems) {
      if (this.activeDownloads.size >= this.config.maxConcurrentChunks) {
        break
      }

      if (!this.activeDownloads.has(item.id)) {
        this.startDownload(item.id)
      }
    }
  }

  /**
   * Start a specific download
   */
  async startDownload(queueId: string): Promise<void> {
    const item = this.downloadQueue.get(queueId)
    if (!item) {
      throw new Error(`Download not found: ${queueId}`)
    }

    if (this.activeDownloads.has(queueId)) {
      return // Already downloading
    }

    this.activeDownloads.add(queueId)
    const abortController = new AbortController()
    this.abortControllers.set(queueId, abortController)

    // Update status
    item.status = 'active'
    item.startedAt = Date.now()
    item.progress.phase = 'downloading'
    item.progress.message = 'Starting download...'
    this.updateQueueItem(item)
    this.emit('download-started', item)

    try {
      await this.downloadChunks(item, abortController.signal)

      // Verify and assemble if all chunks downloaded
      if (item.progress.chunksCompleted === item.plan.chunksToDownload.length) {
        item.progress.phase = 'assembling'
        item.progress.message = 'Assembling model...'
        this.emit('download-progress', item.progress)

        // Assemble the model
        const modelsDir = deltaModelStorage.getConfig().modelsDirectory
        const outputPath = pathNormalizationService.joinPaths(
          modelsDir,
          item.modelId,
          item.targetVersion,
          'model.bin'
        )

        await deltaModelStorage.assembleModel(
          item.modelId,
          item.targetVersion,
          outputPath
        )

        // Mark as completed
        item.status = 'completed'
        item.completedAt = Date.now()
        item.progress.phase = 'complete'
        item.progress.overallProgress = 100
        item.progress.message = 'Download complete'
        this.updateQueueItem(item)

        this.emit('download-complete', {
          modelId: item.modelId,
          version: item.targetVersion,
          path: outputPath
        })

        console.log(`[DeltaDownloadManager] Download complete: ${item.modelId} v${item.targetVersion}`)
      }
    } catch (error) {
      if (abortController.signal.aborted) {
        item.status = 'cancelled'
        item.progress.phase = 'cancelled'
        item.progress.message = 'Download cancelled'
      } else {
        item.status = 'failed'
        item.progress.phase = 'error'
        item.error = error instanceof Error ? error.message : String(error)
        item.progress.error = item.error
        item.progress.message = `Download failed: ${item.error}`

        this.emit('download-error', {
          modelId: item.modelId,
          error: item.error
        })
      }

      this.updateQueueItem(item)
    } finally {
      this.activeDownloads.delete(queueId)
      this.abortControllers.delete(queueId)

      // Process next in queue
      this.processQueue()
    }
  }

  /**
   * Download chunks for a queue item
   */
  private async downloadChunks(
    item: DownloadQueueItem,
    signal: AbortSignal
  ): Promise<void> {
    const chunks = item.plan.chunksToDownload
    let downloadedBytes = 0
    let startTime = Date.now()

    for (let i = 0; i < chunks.length; i++) {
      if (signal.aborted) {
        throw new Error('Download aborted')
      }

      const chunk = chunks[i]
      const chunkProgress: ChunkDownloadProgress = {
        chunkHash: chunk.hash,
        chunkIndex: chunk.index,
        bytesDownloaded: 0,
        totalBytes: chunk.size,
        speed: 0,
        percent: 0
      }

      item.progress.currentChunk = chunkProgress
      item.progress.message = `Downloading chunk ${i + 1}/${chunks.length}`
      this.emit('download-progress', item.progress)

      // Download the chunk with retries
      let retries = 0
      let success = false

      while (retries <= this.config.chunkRetries && !success) {
        try {
          const data = await this.downloadChunk(chunk, signal, (progress) => {
            chunkProgress.bytesDownloaded = progress.bytesDownloaded
            chunkProgress.percent = (progress.bytesDownloaded / chunk.size) * 100
            chunkProgress.speed = progress.speed

            const totalDownloaded = downloadedBytes + progress.bytesDownloaded
            const elapsed = (Date.now() - startTime) / 1000
            const overallSpeed = elapsed > 0 ? totalDownloaded / elapsed : 0

            item.progress.bytesDownloaded = totalDownloaded
            item.progress.speed = overallSpeed
            item.progress.overallProgress =
              ((downloadedBytes + progress.bytesDownloaded) / item.plan.totalDownloadSize) * 100

            if (overallSpeed > 0) {
              item.progress.eta = Math.ceil(
                (item.plan.totalDownloadSize - totalDownloaded) / overallSpeed
              )
            }

            this.emit('download-progress', item.progress)
          })

          // Verify and store the chunk
          const storedChunk = await deltaModelStorage.storeChunk(
            data,
            item.modelId,
            item.targetVersion,
            chunk.index
          )

          // Verify hash matches
          if (storedChunk.hash !== chunk.hash) {
            throw new Error(`Chunk hash mismatch: expected ${chunk.hash}, got ${storedChunk.hash}`)
          }

          downloadedBytes += chunk.size
          item.progress.chunksCompleted++
          success = true
        } catch (error) {
          retries++
          if (retries <= this.config.chunkRetries) {
            console.log(`[DeltaDownloadManager] Retrying chunk ${chunk.index} (attempt ${retries})`)
            await this.delay(this.config.retryDelay * retries)
          } else {
            throw error
          }
        }
      }

      this.updateQueueItem(item)
    }
  }

  /**
   * Download a single chunk
   */
  private async downloadChunk(
    chunk: ManifestChunk,
    signal: AbortSignal,
    onProgress: (progress: { bytesDownloaded: number; speed: number }) => void
  ): Promise<Buffer> {
    const url = chunk.downloadUrl || this.getChunkUrl(chunk)

    return new Promise((resolve, reject) => {
      const protocol = url.startsWith('https') ? https : http

      const request = protocol.get(url, (response) => {
        if (response.statusCode !== 200) {
          reject(new Error(`HTTP ${response.statusCode}: ${response.statusMessage}`))
          return
        }

        const chunks: Buffer[] = []
        let bytesDownloaded = 0
        const startTime = Date.now()

        response.on('data', (chunk: Buffer) => {
          if (signal.aborted) {
            request.destroy()
            reject(new Error('Download aborted'))
            return
          }

          chunks.push(chunk)
          bytesDownloaded += chunk.length

          const elapsed = (Date.now() - startTime) / 1000
          const speed = elapsed > 0 ? bytesDownloaded / elapsed : 0

          onProgress({ bytesDownloaded, speed })
        })

        response.on('end', () => {
          const data = Buffer.concat(chunks)
          resolve(data)
        })

        response.on('error', reject)
      })

      request.on('error', reject)
      request.setTimeout(this.config.chunkTimeout, () => {
        request.destroy()
        reject(new Error('Download timeout'))
      })

      // Handle abort
      signal.addEventListener('abort', () => {
        request.destroy()
        reject(new Error('Download aborted'))
      })
    })
  }

  /**
   * Get the URL for downloading a chunk
   */
  private getChunkUrl(chunk: ManifestChunk): string {
    // This would be configured based on the model manifest's baseDownloadUrl
    // For now, return a placeholder
    return chunk.downloadUrl || `https://models.example.com/chunks/${chunk.hash}`
  }

  /**
   * Pause a download
   */
  async pauseDownload(queueId: string): Promise<void> {
    const item = this.downloadQueue.get(queueId)
    if (!item) {
      throw new Error(`Download not found: ${queueId}`)
    }

    const abortController = this.abortControllers.get(queueId)
    if (abortController) {
      abortController.abort()
    }

    item.status = 'paused'
    item.progress.phase = 'paused'
    item.progress.message = 'Download paused'
    this.updateQueueItem(item)

    this.emit('download-paused', item)
    console.log(`[DeltaDownloadManager] Download paused: ${item.modelId}`)
  }

  /**
   * Resume a paused download
   */
  async resumeDownload(queueId: string): Promise<void> {
    const item = this.downloadQueue.get(queueId)
    if (!item || item.status !== 'paused') {
      throw new Error(`Cannot resume download: ${queueId}`)
    }

    item.status = 'queued'
    item.progress.phase = 'idle'
    item.progress.message = 'Queued for resume'
    this.updateQueueItem(item)

    this.emit('download-resumed', item)
    await this.processQueue()
  }

  /**
   * Cancel a download
   */
  async cancelDownload(queueId: string): Promise<void> {
    const item = this.downloadQueue.get(queueId)
    if (!item) {
      throw new Error(`Download not found: ${queueId}`)
    }

    const abortController = this.abortControllers.get(queueId)
    if (abortController) {
      abortController.abort()
    }

    // Remove from queue
    this.downloadQueue.delete(queueId)
    this.activeDownloads.delete(queueId)
    this.abortControllers.delete(queueId)

    // Remove from database
    const dbService = getDatabaseService()
    const db = dbService.getDatabase()
    db.prepare('DELETE FROM model_update_queue WHERE id = ?').run(queueId)

    // Cleanup any downloaded chunks
    await deltaModelStorage.deleteModelChunks(item.modelId, item.targetVersion)

    this.emit('download-cancelled', item)
    console.log(`[DeltaDownloadManager] Download cancelled: ${item.modelId}`)
  }

  /**
   * Get download queue
   */
  getQueue(): DownloadQueueItem[] {
    return Array.from(this.downloadQueue.values())
  }

  /**
   * Get a specific queue item
   */
  getQueueItem(queueId: string): DownloadQueueItem | undefined {
    return this.downloadQueue.get(queueId)
  }

  /**
   * Get download progress for a model
   */
  getProgress(modelId: string): ModelDownloadProgress | null {
    for (const item of this.downloadQueue.values()) {
      if (item.modelId === modelId && item.status === 'active') {
        return item.progress
      }
    }
    return null
  }

  /**
   * Update queue item in database
   */
  private updateQueueItem(item: DownloadQueueItem): void {
    const dbService = getDatabaseService()
    const db = dbService.getDatabase()

    db.prepare(`
      UPDATE model_update_queue
      SET status = ?, progress_json = ?, started_at = ?,
          completed_at = ?, retry_count = ?, error = ?
      WHERE id = ?
    `).run(
      item.status,
      JSON.stringify(item.progress),
      item.startedAt,
      item.completedAt,
      item.retryCount,
      item.error || null,
      item.id
    )
  }

  /**
   * Delay helper
   */
  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms))
  }

  /**
   * Format bytes for display
   */
  private formatBytes(bytes: number): string {
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
   * Get configuration
   */
  getConfig(): DeltaDownloadConfig {
    return { ...this.config }
  }

  /**
   * Update configuration
   */
  updateConfig(updates: Partial<DeltaDownloadConfig>): void {
    this.config = { ...this.config, ...updates }
  }

  /**
   * Clear completed downloads from queue
   */
  clearCompleted(): number {
    let cleared = 0
    const dbService = getDatabaseService()
    const db = dbService.getDatabase()

    for (const [id, item] of this.downloadQueue) {
      if (item.status === 'completed' || item.status === 'cancelled') {
        this.downloadQueue.delete(id)
        db.prepare('DELETE FROM model_update_queue WHERE id = ?').run(id)
        cleared++
      }
    }

    return cleared
  }
}

// Export singleton instance
export const deltaDownloadManager = new DeltaDownloadManagerService()

// Export class for testing
export { DeltaDownloadManagerService }
