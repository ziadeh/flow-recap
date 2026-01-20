/**
 * Delta Model Storage Service
 *
 * Provides content-addressed storage for model chunks, enabling:
 * - SHA256-based chunk identification and deduplication
 * - Efficient storage with optional compression
 * - Chunk verification and integrity checking
 * - Automatic cleanup of unused chunks
 *
 * This service is the foundation for delta-based model updates,
 * allowing updates to reuse unchanged chunks across versions.
 */

import { EventEmitter } from 'events'
import * as fs from 'fs'
import * as path from 'path'
import * as crypto from 'crypto'
import * as zlib from 'zlib'
import { promisify } from 'util'
import { pipeline } from 'stream/promises'
import { getDatabaseService } from './database'
import { pathNormalizationService } from './pathNormalizationService'
import type {
  ChunkMetadata,
  StoredChunk,
  CompressionType,
  ChunkStatus,
  DeltaStorageConfig,
  ModelChunkRecord,
  ChunkDeduplicationRecord
} from '../types/deltaModels'

// Electron app import with fallback for testing
let app: { getPath: (name: string) => string } | undefined
try {
  app = require('electron').app
} catch {
  app = undefined
}

// Promisified zlib functions
const gzip = promisify(zlib.gzip)
const gunzip = promisify(zlib.gunzip)

// ============================================================================
// Constants
// ============================================================================

const DEFAULT_CHUNK_SIZE = 16 * 1024 * 1024 // 16 MB chunks
const DEFAULT_MAX_CACHE_SIZE = 10 * 1024 * 1024 * 1024 // 10 GB
const DEFAULT_CLEANUP_AGE = 30 * 24 * 60 * 60 * 1000 // 30 days
const CHUNK_FILE_EXTENSION = '.chunk'
const TEMP_FILE_EXTENSION = '.tmp'

// ============================================================================
// Delta Model Storage Service Class
// ============================================================================

class DeltaModelStorageService extends EventEmitter {
  private config: DeltaStorageConfig
  private initialized: boolean = false

  constructor() {
    super()
    this.config = this.getDefaultConfig()
  }

  /**
   * Get default configuration
   */
  private getDefaultConfig(): DeltaStorageConfig {
    const userDataPath = app?.getPath('userData') || process.cwd()
    return {
      chunksDirectory: pathNormalizationService.joinPaths(userDataPath, 'model-chunks'),
      modelsDirectory: pathNormalizationService.joinPaths(userDataPath, 'models'),
      defaultChunkSize: DEFAULT_CHUNK_SIZE,
      defaultCompression: 'gzip',
      maxCacheSize: DEFAULT_MAX_CACHE_SIZE,
      verifyOnRead: true,
      autoCleanup: true,
      cleanupAge: DEFAULT_CLEANUP_AGE
    }
  }

  /**
   * Initialize the storage service
   */
  async initialize(customConfig?: Partial<DeltaStorageConfig>): Promise<void> {
    if (this.initialized) {
      return
    }

    // Merge custom config
    if (customConfig) {
      this.config = { ...this.config, ...customConfig }
    }

    // Ensure directories exist
    pathNormalizationService.ensureDirectory(this.config.chunksDirectory)
    pathNormalizationService.ensureDirectory(this.config.modelsDirectory)

    // Initialize database tables
    await this.initializeDatabase()

    this.initialized = true
    console.log('[DeltaModelStorage] Initialized with config:', {
      chunksDirectory: this.config.chunksDirectory,
      defaultChunkSize: this.config.defaultChunkSize,
      defaultCompression: this.config.defaultCompression
    })
  }

  /**
   * Initialize database tables for chunk storage
   */
  private async initializeDatabase(): Promise<void> {
    const dbService = getDatabaseService()
    const db = dbService.getDatabase()

    // Create model_chunks table
    db.exec(`
      CREATE TABLE IF NOT EXISTS model_chunks (
        id TEXT PRIMARY KEY NOT NULL,
        hash TEXT NOT NULL,
        model_id TEXT NOT NULL,
        version TEXT NOT NULL,
        chunk_index INTEGER NOT NULL,
        original_size INTEGER NOT NULL,
        compressed_size INTEGER NOT NULL,
        compression_type TEXT NOT NULL DEFAULT 'gzip',
        local_path TEXT NOT NULL,
        ref_count INTEGER NOT NULL DEFAULT 1,
        status TEXT NOT NULL DEFAULT 'pending',
        created_at INTEGER NOT NULL,
        last_accessed_at INTEGER NOT NULL,
        UNIQUE(model_id, version, chunk_index)
      );

      CREATE INDEX IF NOT EXISTS idx_model_chunks_hash ON model_chunks(hash);
      CREATE INDEX IF NOT EXISTS idx_model_chunks_model_id ON model_chunks(model_id);
      CREATE INDEX IF NOT EXISTS idx_model_chunks_model_version ON model_chunks(model_id, version);
      CREATE INDEX IF NOT EXISTS idx_model_chunks_status ON model_chunks(status);
      CREATE INDEX IF NOT EXISTS idx_model_chunks_last_accessed ON model_chunks(last_accessed_at);
    `)

    // Create chunk deduplication index table
    db.exec(`
      CREATE TABLE IF NOT EXISTS chunk_deduplication_index (
        hash TEXT PRIMARY KEY NOT NULL,
        chunk_id TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        FOREIGN KEY (chunk_id) REFERENCES model_chunks(id) ON DELETE CASCADE
      );
    `)

    // Create model manifests table
    db.exec(`
      CREATE TABLE IF NOT EXISTS model_manifests (
        id TEXT PRIMARY KEY NOT NULL,
        model_id TEXT NOT NULL,
        version TEXT NOT NULL,
        manifest_json TEXT NOT NULL,
        total_chunks INTEGER NOT NULL,
        total_size INTEGER NOT NULL,
        chunk_size INTEGER NOT NULL,
        assembled_hash TEXT NOT NULL,
        is_current INTEGER NOT NULL DEFAULT 0,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        UNIQUE(model_id, version)
      );

      CREATE INDEX IF NOT EXISTS idx_model_manifests_model_id ON model_manifests(model_id);
      CREATE INDEX IF NOT EXISTS idx_model_manifests_current ON model_manifests(model_id, is_current);
    `)

    // Create model update queue table
    db.exec(`
      CREATE TABLE IF NOT EXISTS model_update_queue (
        id TEXT PRIMARY KEY NOT NULL,
        model_id TEXT NOT NULL,
        target_version TEXT NOT NULL,
        priority TEXT NOT NULL DEFAULT 'normal',
        status TEXT NOT NULL DEFAULT 'queued',
        plan_json TEXT NOT NULL,
        progress_json TEXT NOT NULL,
        queued_at INTEGER NOT NULL,
        started_at INTEGER,
        completed_at INTEGER,
        retry_count INTEGER NOT NULL DEFAULT 0,
        max_retries INTEGER NOT NULL DEFAULT 3,
        error TEXT,
        UNIQUE(model_id, target_version)
      );

      CREATE INDEX IF NOT EXISTS idx_model_update_queue_status ON model_update_queue(status);
      CREATE INDEX IF NOT EXISTS idx_model_update_queue_priority ON model_update_queue(priority, queued_at);
    `)

    console.log('[DeltaModelStorage] Database tables initialized')
  }

  /**
   * Calculate SHA256 hash of data
   */
  calculateHash(data: Buffer): string {
    return crypto.createHash('sha256').update(data).digest('hex')
  }

  /**
   * Calculate SHA256 hash of a file
   */
  async calculateFileHash(filePath: string): Promise<string> {
    return new Promise((resolve, reject) => {
      const hash = crypto.createHash('sha256')
      const stream = fs.createReadStream(filePath)

      stream.on('error', reject)
      stream.on('data', (chunk: Buffer) => hash.update(chunk))
      stream.on('end', () => resolve(hash.digest('hex')))
    })
  }

  /**
   * Compress data using the specified method
   */
  async compress(data: Buffer, type: CompressionType): Promise<Buffer> {
    if (type === 'none') {
      return data
    }
    if (type === 'gzip') {
      return gzip(data)
    }
    // zstd support would require additional library
    // For now, fall back to gzip
    return gzip(data)
  }

  /**
   * Decompress data using the specified method
   */
  async decompress(data: Buffer, type: CompressionType): Promise<Buffer> {
    if (type === 'none') {
      return data
    }
    if (type === 'gzip') {
      return gunzip(data)
    }
    // zstd support would require additional library
    return gunzip(data)
  }

  /**
   * Get the file path for a chunk based on its hash
   * Uses a two-level directory structure for better filesystem performance
   */
  getChunkPath(hash: string): string {
    const dir1 = hash.substring(0, 2)
    const dir2 = hash.substring(2, 4)
    return pathNormalizationService.joinPaths(
      this.config.chunksDirectory,
      dir1,
      dir2,
      `${hash}${CHUNK_FILE_EXTENSION}`
    )
  }

  /**
   * Store a chunk in content-addressed storage
   */
  async storeChunk(
    data: Buffer,
    modelId: string,
    version: string,
    chunkIndex: number,
    options?: { compression?: CompressionType }
  ): Promise<StoredChunk> {
    const hash = this.calculateHash(data)
    const compressionType = options?.compression || this.config.defaultCompression

    // Check for existing chunk with same hash (deduplication)
    const existingChunk = await this.getChunkByHash(hash)
    if (existingChunk) {
      // Increment reference count
      await this.incrementRefCount(existingChunk.id)

      // Update the chunk record for this model/version
      return this.createChunkRecord(existingChunk, modelId, version, chunkIndex)
    }

    // Compress the data
    const compressedData = await this.compress(data, compressionType)

    // Determine storage path
    const chunkPath = this.getChunkPath(hash)
    const chunkDir = path.dirname(chunkPath)

    // Ensure directory exists
    pathNormalizationService.ensureDirectory(chunkDir)

    // Write to temp file first, then rename (atomic operation)
    const tempPath = `${chunkPath}${TEMP_FILE_EXTENSION}`
    await fs.promises.writeFile(tempPath, compressedData)
    await fs.promises.rename(tempPath, chunkPath)

    // Create database record
    const now = Date.now()
    const id = crypto.randomUUID()

    const dbService = getDatabaseService()
    const db = dbService.getDatabase()

    db.prepare(`
      INSERT INTO model_chunks (
        id, hash, model_id, version, chunk_index,
        original_size, compressed_size, compression_type,
        local_path, ref_count, status, created_at, last_accessed_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id, hash, modelId, version, chunkIndex,
      data.length, compressedData.length, compressionType,
      chunkPath, 1, 'verified', now, now
    )

    // Add to deduplication index
    db.prepare(`
      INSERT OR REPLACE INTO chunk_deduplication_index (hash, chunk_id, created_at)
      VALUES (?, ?, ?)
    `).run(hash, id, now)

    const storedChunk: StoredChunk = {
      id,
      hash,
      modelId,
      version,
      chunkIndex,
      originalSize: data.length,
      compressedSize: compressedData.length,
      compressionType,
      offset: chunkIndex * this.config.defaultChunkSize,
      localPath: chunkPath,
      refCount: 1,
      status: 'verified',
      createdAt: now,
      lastAccessedAt: now
    }

    this.emit('chunk-stored', storedChunk)
    return storedChunk
  }

  /**
   * Retrieve a chunk by its hash
   */
  async getChunkByHash(hash: string): Promise<StoredChunk | null> {
    const dbService = getDatabaseService()
    const db = dbService.getDatabase()

    const record = db.prepare(`
      SELECT * FROM model_chunks WHERE hash = ? LIMIT 1
    `).get(hash) as ModelChunkRecord | undefined

    if (!record) {
      return null
    }

    return this.recordToStoredChunk(record)
  }

  /**
   * Retrieve a chunk for a specific model and version
   */
  async getChunk(modelId: string, version: string, chunkIndex: number): Promise<StoredChunk | null> {
    const dbService = getDatabaseService()
    const db = dbService.getDatabase()

    const record = db.prepare(`
      SELECT * FROM model_chunks
      WHERE model_id = ? AND version = ? AND chunk_index = ?
    `).get(modelId, version, chunkIndex) as ModelChunkRecord | undefined

    if (!record) {
      return null
    }

    // Update last accessed time
    db.prepare(`
      UPDATE model_chunks SET last_accessed_at = ? WHERE id = ?
    `).run(Date.now(), record.id)

    return this.recordToStoredChunk(record)
  }

  /**
   * Read chunk data from storage
   */
  async readChunk(storedChunk: StoredChunk): Promise<Buffer> {
    if (!fs.existsSync(storedChunk.localPath)) {
      throw new Error(`Chunk file not found: ${storedChunk.localPath}`)
    }

    const compressedData = await fs.promises.readFile(storedChunk.localPath)
    const data = await this.decompress(compressedData, storedChunk.compressionType)

    // Verify hash if configured
    if (this.config.verifyOnRead) {
      const hash = this.calculateHash(data)
      if (hash !== storedChunk.hash) {
        throw new Error(`Chunk verification failed: expected ${storedChunk.hash}, got ${hash}`)
      }
    }

    return data
  }

  /**
   * Get all chunks for a model version
   */
  async getModelChunks(modelId: string, version: string): Promise<StoredChunk[]> {
    const dbService = getDatabaseService()
    const db = dbService.getDatabase()

    const records = db.prepare(`
      SELECT * FROM model_chunks
      WHERE model_id = ? AND version = ?
      ORDER BY chunk_index ASC
    `).all(modelId, version) as ModelChunkRecord[]

    return records.map(r => this.recordToStoredChunk(r))
  }

  /**
   * Check if all chunks for a model version are available
   */
  async hasAllChunks(modelId: string, version: string, totalChunks: number): Promise<boolean> {
    const chunks = await this.getModelChunks(modelId, version)
    if (chunks.length !== totalChunks) {
      return false
    }

    // Verify all chunks are in 'verified' status
    return chunks.every(c => c.status === 'verified')
  }

  /**
   * Find chunks that already exist for reuse (deduplication)
   */
  async findReusableChunks(hashes: string[]): Promise<Map<string, StoredChunk>> {
    const reusable = new Map<string, StoredChunk>()
    const dbService = getDatabaseService()
    const db = dbService.getDatabase()

    for (const hash of hashes) {
      const record = db.prepare(`
        SELECT mc.* FROM model_chunks mc
        JOIN chunk_deduplication_index cdi ON mc.id = cdi.chunk_id
        WHERE cdi.hash = ? AND mc.status = 'verified'
        LIMIT 1
      `).get(hash) as ModelChunkRecord | undefined

      if (record) {
        reusable.set(hash, this.recordToStoredChunk(record))
      }
    }

    return reusable
  }

  /**
   * Assemble chunks into a complete model file
   */
  async assembleModel(
    modelId: string,
    version: string,
    outputPath: string,
    expectedHash?: string
  ): Promise<{ success: boolean; hash: string; size: number }> {
    const chunks = await this.getModelChunks(modelId, version)

    if (chunks.length === 0) {
      throw new Error(`No chunks found for model ${modelId} version ${version}`)
    }

    // Sort by chunk index
    chunks.sort((a, b) => a.chunkIndex - b.chunkIndex)

    // Ensure output directory exists
    const outputDir = path.dirname(outputPath)
    pathNormalizationService.ensureDirectory(outputDir)

    // Create write stream
    const tempPath = `${outputPath}${TEMP_FILE_EXTENSION}`
    const writeStream = fs.createWriteStream(tempPath)
    const hashStream = crypto.createHash('sha256')

    let totalSize = 0

    try {
      for (const chunk of chunks) {
        const data = await this.readChunk(chunk)
        writeStream.write(data)
        hashStream.update(data)
        totalSize += data.length

        this.emit('assemble-progress', {
          modelId,
          version,
          currentChunk: chunk.chunkIndex,
          totalChunks: chunks.length,
          bytesWritten: totalSize
        })
      }

      await new Promise<void>((resolve, reject) => {
        writeStream.end((err: Error | undefined) => {
          if (err) reject(err)
          else resolve()
        })
      })

      const hash = hashStream.digest('hex')

      // Verify hash if expected
      if (expectedHash && hash !== expectedHash) {
        await fs.promises.unlink(tempPath)
        throw new Error(`Assembled model hash mismatch: expected ${expectedHash}, got ${hash}`)
      }

      // Atomic rename
      await fs.promises.rename(tempPath, outputPath)

      this.emit('model-assembled', { modelId, version, path: outputPath, hash, size: totalSize })

      return { success: true, hash, size: totalSize }
    } catch (error) {
      // Cleanup on error
      if (fs.existsSync(tempPath)) {
        await fs.promises.unlink(tempPath)
      }
      throw error
    }
  }

  /**
   * Increment reference count for a chunk (for deduplication)
   */
  private async incrementRefCount(chunkId: string): Promise<void> {
    const dbService = getDatabaseService()
    const db = dbService.getDatabase()

    db.prepare(`
      UPDATE model_chunks SET ref_count = ref_count + 1, last_accessed_at = ?
      WHERE id = ?
    `).run(Date.now(), chunkId)
  }

  /**
   * Create a new chunk record pointing to an existing chunk (deduplication)
   */
  private async createChunkRecord(
    existingChunk: StoredChunk,
    modelId: string,
    version: string,
    chunkIndex: number
  ): Promise<StoredChunk> {
    const now = Date.now()
    const id = crypto.randomUUID()

    const dbService = getDatabaseService()
    const db = dbService.getDatabase()

    db.prepare(`
      INSERT INTO model_chunks (
        id, hash, model_id, version, chunk_index,
        original_size, compressed_size, compression_type,
        local_path, ref_count, status, created_at, last_accessed_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id, existingChunk.hash, modelId, version, chunkIndex,
      existingChunk.originalSize, existingChunk.compressedSize, existingChunk.compressionType,
      existingChunk.localPath, 1, 'verified', now, now
    )

    return {
      ...existingChunk,
      id,
      modelId,
      version,
      chunkIndex,
      createdAt: now,
      lastAccessedAt: now
    }
  }

  /**
   * Delete a chunk and its file (if no other references)
   */
  async deleteChunk(chunkId: string): Promise<boolean> {
    const dbService = getDatabaseService()
    const db = dbService.getDatabase()

    // Get the chunk record
    const record = db.prepare(`
      SELECT * FROM model_chunks WHERE id = ?
    `).get(chunkId) as ModelChunkRecord | undefined

    if (!record) {
      return false
    }

    // Check if other chunks reference the same hash
    const refCount = (db.prepare(`
      SELECT COUNT(*) as count FROM model_chunks WHERE hash = ?
    `).get(record.hash) as { count: number }).count

    // Delete the chunk record
    db.prepare(`DELETE FROM model_chunks WHERE id = ?`).run(chunkId)

    // If this was the last reference, delete the file and dedup index
    if (refCount <= 1) {
      if (fs.existsSync(record.local_path)) {
        await fs.promises.unlink(record.local_path)
      }
      db.prepare(`DELETE FROM chunk_deduplication_index WHERE hash = ?`).run(record.hash)
    }

    return true
  }

  /**
   * Delete all chunks for a model version
   */
  async deleteModelChunks(modelId: string, version: string): Promise<number> {
    const chunks = await this.getModelChunks(modelId, version)
    let deleted = 0

    for (const chunk of chunks) {
      if (await this.deleteChunk(chunk.id)) {
        deleted++
      }
    }

    this.emit('model-chunks-deleted', { modelId, version, deletedChunks: deleted })
    return deleted
  }

  /**
   * Cleanup unused chunks based on age and reference count
   */
  async cleanupUnusedChunks(): Promise<{ deletedChunks: number; freedBytes: number }> {
    const dbService = getDatabaseService()
    const db = dbService.getDatabase()

    const cutoffTime = Date.now() - this.config.cleanupAge

    // Find orphaned chunks (ref_count = 0 or very old with low ref_count)
    const orphanedChunks = db.prepare(`
      SELECT * FROM model_chunks
      WHERE ref_count = 0
         OR (last_accessed_at < ? AND ref_count = 1)
    `).all(cutoffTime) as ModelChunkRecord[]

    let deletedChunks = 0
    let freedBytes = 0

    for (const record of orphanedChunks) {
      const success = await this.deleteChunk(record.id)
      if (success) {
        deletedChunks++
        freedBytes += record.compressed_size
      }
    }

    this.emit('cleanup-complete', { deletedChunks, freedBytes })
    console.log(`[DeltaModelStorage] Cleanup complete: ${deletedChunks} chunks deleted, ${this.formatBytes(freedBytes)} freed`)

    return { deletedChunks, freedBytes }
  }

  /**
   * Get storage statistics
   */
  async getStorageStats(): Promise<{
    totalChunks: number
    totalSize: number
    uniqueChunks: number
    deduplicatedSize: number
    modelCount: number
    versionCount: number
  }> {
    const dbService = getDatabaseService()
    const db = dbService.getDatabase()

    const stats = db.prepare(`
      SELECT
        COUNT(*) as total_chunks,
        COALESCE(SUM(compressed_size), 0) as total_size,
        COUNT(DISTINCT hash) as unique_chunks,
        COUNT(DISTINCT model_id) as model_count,
        COUNT(DISTINCT model_id || '-' || version) as version_count
      FROM model_chunks
    `).get() as {
      total_chunks: number
      total_size: number
      unique_chunks: number
      model_count: number
      version_count: number
    }

    // Calculate deduplicated size (sum of unique chunks only)
    const uniqueSize = (db.prepare(`
      SELECT COALESCE(SUM(compressed_size), 0) as size
      FROM model_chunks
      WHERE id IN (
        SELECT MIN(id) FROM model_chunks GROUP BY hash
      )
    `).get() as { size: number }).size

    return {
      totalChunks: stats.total_chunks,
      totalSize: stats.total_size,
      uniqueChunks: stats.unique_chunks,
      deduplicatedSize: stats.total_size - uniqueSize,
      modelCount: stats.model_count,
      versionCount: stats.version_count
    }
  }

  /**
   * Convert database record to StoredChunk
   */
  private recordToStoredChunk(record: ModelChunkRecord): StoredChunk {
    return {
      id: record.id,
      hash: record.hash,
      modelId: record.model_id,
      version: record.version,
      chunkIndex: record.chunk_index,
      originalSize: record.original_size,
      compressedSize: record.compressed_size,
      compressionType: record.compression_type as CompressionType,
      offset: record.chunk_index * this.config.defaultChunkSize,
      localPath: record.local_path,
      refCount: record.ref_count,
      status: record.status as ChunkStatus,
      createdAt: record.created_at,
      lastAccessedAt: record.last_accessed_at
    }
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
  getConfig(): DeltaStorageConfig {
    return { ...this.config }
  }

  /**
   * Update configuration
   */
  updateConfig(updates: Partial<DeltaStorageConfig>): void {
    this.config = { ...this.config, ...updates }
  }
}

// Export singleton instance
export const deltaModelStorage = new DeltaModelStorageService()

// Export class for testing
export { DeltaModelStorageService }
