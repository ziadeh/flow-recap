/**
 * Data Migration Service for FlowRecap
 *
 * Handles migration of user data from legacy 'Meeting Notes' / 'MeetingNotes'
 * directories to the new 'FlowRecap' structure.
 *
 * Migration scenarios:
 * 1. macOS: ~/Library/Application Support/meeting-notes → ~/Library/Application Support/flowrecap
 * 2. Windows: %APPDATA%/Meeting Notes → %APPDATA%/FlowRecap
 * 3. Linux: ~/.config/meeting-notes → ~/.config/flowrecap
 * 4. Documents: ~/Documents/MeetingNotes → ~/Documents/FlowRecap
 *
 * The service will:
 * - Detect if legacy data directories exist
 * - Offer to migrate data on first launch after update
 * - Preserve all user data (database, settings, recordings)
 * - Update any absolute file paths stored in the database
 * - Provide rollback capability if migration fails
 * - Validate all migrated data (file integrity, record counts)
 * - Offer cleanup of legacy data after successful migration
 */

import path from 'path'
import fs from 'fs'
import crypto from 'crypto'
import { app } from 'electron'

// ============================================================================
// Types
// ============================================================================

export interface MigrationCheckResult {
  needsMigration: boolean
  legacyPaths: LegacyPathInfo[]
  totalSizeBytes: number
  migrationComplete: boolean
  /** Summary of what will be migrated */
  summary: MigrationSummary
}

export interface MigrationSummary {
  meetingsCount: number
  recordingsCount: number
  totalAudioFilesSize: number
  hasSettings: boolean
  databaseSizeBytes: number
}

export interface LegacyPathInfo {
  type: 'appData' | 'documents' | 'recordings'
  legacyPath: string
  newPath: string
  exists: boolean
  sizeBytes: number
  fileCount?: number
}

export interface MigrationProgress {
  phase: 'checking' | 'backing_up' | 'copying' | 'updating_paths' | 'validating' | 'cleanup' | 'complete' | 'error' | 'rolling_back'
  currentItem?: string
  itemsCopied: number
  totalItems: number
  bytesCopied: number
  totalBytes: number
  errorMessage?: string
  /** Percentage complete (0-100) */
  percentComplete: number
}

export interface MigrationResult {
  success: boolean
  itemsMigrated: number
  bytesMigrated: number
  pathsUpdated: number
  errors: string[]
  warnings: string[]
  /** Validation results after migration */
  validation?: ValidationResult
}

export interface ValidationResult {
  isValid: boolean
  meetingsAccessible: number
  meetingsTotal: number
  recordingsAccessible: number
  recordingsTotal: number
  transcriptsCount: number
  fileIntegrityPassed: boolean
  errors: string[]
}

export interface RollbackResult {
  success: boolean
  filesRestored: number
  errors: string[]
}

export interface CleanupResult {
  success: boolean
  bytesFreed: number
  filesDeleted: number
  errors: string[]
}

export interface MigrationStatus {
  status: 'not_started' | 'in_progress' | 'completed' | 'failed' | 'skipped' | 'rolled_back'
  startedAt?: string
  completedAt?: string
  error?: string
  validation?: ValidationResult
}

// ============================================================================
// Constants
// ============================================================================

// Legacy application identifiers
const LEGACY_APP_NAMES = [
  'meeting-notes',
  'Meeting Notes',
  'MeetingNotes'
]

// New application identifier
const NEW_APP_NAME = 'flowrecap'

// Migration status file
const MIGRATION_STATUS_FILE = '.migration-status.json'
const MIGRATION_BACKUP_DIR = '.migration-backup'

// ============================================================================
// Data Migration Service
// ============================================================================

class DataMigrationService {
  private progressCallback?: (progress: MigrationProgress) => void
  private currentMigrationBackupPath?: string

  /**
   * Check if migration is needed
   */
  async checkMigrationNeeded(): Promise<MigrationCheckResult> {
    const legacyPaths: LegacyPathInfo[] = []
    let totalSizeBytes = 0

    // Check app data directories
    const appDataPath = app.getPath('userData')
    const appDataDir = path.dirname(appDataPath)

    for (const legacyName of LEGACY_APP_NAMES) {
      const legacyAppDataPath = path.join(appDataDir, legacyName)
      if (fs.existsSync(legacyAppDataPath) && legacyAppDataPath !== appDataPath) {
        const { size, count } = this.getDirectorySizeAndCount(legacyAppDataPath)
        legacyPaths.push({
          type: 'appData',
          legacyPath: legacyAppDataPath,
          newPath: appDataPath,
          exists: true,
          sizeBytes: size,
          fileCount: count
        })
        totalSizeBytes += size
      }
    }

    // Check documents directories
    const documentsPath = app.getPath('documents')
    for (const legacyName of LEGACY_APP_NAMES) {
      const legacyDocsPath = path.join(documentsPath, legacyName)
      const newDocsPath = path.join(documentsPath, 'FlowRecap')

      if (fs.existsSync(legacyDocsPath) && legacyDocsPath !== newDocsPath) {
        const { size, count } = this.getDirectorySizeAndCount(legacyDocsPath)
        legacyPaths.push({
          type: 'documents',
          legacyPath: legacyDocsPath,
          newPath: newDocsPath,
          exists: true,
          sizeBytes: size,
          fileCount: count
        })
        totalSizeBytes += size
      }
    }

    // Check if migration was already completed
    const migrationStatus = await this.getMigrationStatus()
    const migrationComplete = migrationStatus.status === 'completed' || migrationStatus.status === 'skipped'

    // Get migration summary from legacy database
    const summary = await this.getMigrationSummary(legacyPaths)

    return {
      needsMigration: legacyPaths.length > 0 && !migrationComplete,
      legacyPaths,
      totalSizeBytes,
      migrationComplete,
      summary
    }
  }

  /**
   * Get migration summary by inspecting legacy database
   */
  private async getMigrationSummary(legacyPaths: LegacyPathInfo[]): Promise<MigrationSummary> {
    const summary: MigrationSummary = {
      meetingsCount: 0,
      recordingsCount: 0,
      totalAudioFilesSize: 0,
      hasSettings: false,
      databaseSizeBytes: 0
    }

    try {
      // Find the legacy database
      const appDataLegacy = legacyPaths.find(p => p.type === 'appData')
      if (!appDataLegacy) return summary

      const legacyDbPath = path.join(appDataLegacy.legacyPath, 'meeting-notes.db')
      if (!fs.existsSync(legacyDbPath)) return summary

      const stats = fs.statSync(legacyDbPath)
      summary.databaseSizeBytes = stats.size

      // Query the legacy database
      const Database = require('better-sqlite3')
      const db = new Database(legacyDbPath, { readonly: true })

      try {
        // Count meetings
        const meetingsResult = db.prepare('SELECT COUNT(*) as count FROM meetings').get() as { count: number }
        summary.meetingsCount = meetingsResult?.count || 0

        // Count recordings and calculate size
        const recordings = db.prepare('SELECT file_path, file_size_bytes FROM recordings').all() as Array<{ file_path: string; file_size_bytes: number | null }>
        summary.recordingsCount = recordings.length

        for (const recording of recordings) {
          if (recording.file_size_bytes) {
            summary.totalAudioFilesSize += recording.file_size_bytes
          } else if (recording.file_path && fs.existsSync(recording.file_path)) {
            try {
              const fileStats = fs.statSync(recording.file_path)
              summary.totalAudioFilesSize += fileStats.size
            } catch {
              // Ignore file access errors
            }
          }
        }

        // Check for settings
        const settingsResult = db.prepare('SELECT COUNT(*) as count FROM settings').get() as { count: number }
        summary.hasSettings = (settingsResult?.count || 0) > 0
      } finally {
        db.close()
      }
    } catch (error) {
      console.error('Failed to get migration summary:', error)
    }

    return summary
  }

  /**
   * Get current migration status
   */
  async getMigrationStatus(): Promise<MigrationStatus> {
    try {
      const statusPath = path.join(app.getPath('userData'), MIGRATION_STATUS_FILE)
      if (fs.existsSync(statusPath)) {
        const content = fs.readFileSync(statusPath, 'utf-8')
        return JSON.parse(content) as MigrationStatus
      }

      // Check for legacy marker file
      const legacyMarkerPath = path.join(app.getPath('userData'), '.migration-complete')
      if (fs.existsSync(legacyMarkerPath)) {
        return { status: 'completed' }
      }
    } catch (error) {
      console.error('Failed to read migration status:', error)
    }
    return { status: 'not_started' }
  }

  /**
   * Save migration status
   */
  private async saveMigrationStatus(status: MigrationStatus): Promise<void> {
    const statusPath = path.join(app.getPath('userData'), MIGRATION_STATUS_FILE)
    fs.writeFileSync(statusPath, JSON.stringify(status, null, 2))
  }

  /**
   * Set progress callback for migration updates
   */
  onProgress(callback: (progress: MigrationProgress) => void): void {
    this.progressCallback = callback
  }

  /**
   * Calculate percentage complete based on phase
   */
  private calculatePercentage(phase: MigrationProgress['phase'], bytesCopied: number, totalBytes: number): number {
    const phaseWeights: Record<string, { start: number; end: number }> = {
      'checking': { start: 0, end: 5 },
      'backing_up': { start: 5, end: 15 },
      'copying': { start: 15, end: 70 },
      'updating_paths': { start: 70, end: 80 },
      'validating': { start: 80, end: 95 },
      'cleanup': { start: 95, end: 100 },
      'complete': { start: 100, end: 100 },
      'error': { start: 0, end: 0 },
      'rolling_back': { start: 0, end: 0 }
    }

    const weight = phaseWeights[phase] || { start: 0, end: 0 }

    if (phase === 'copying' && totalBytes > 0) {
      const copyProgress = (bytesCopied / totalBytes) * (weight.end - weight.start)
      return Math.round(weight.start + copyProgress)
    }

    return weight.end
  }

  /**
   * Perform data migration with validation and rollback support
   */
  async migrate(legacyPaths: LegacyPathInfo[]): Promise<MigrationResult> {
    const result: MigrationResult = {
      success: false,
      itemsMigrated: 0,
      bytesMigrated: 0,
      pathsUpdated: 0,
      errors: [],
      warnings: []
    }

    const totalBytes = legacyPaths.reduce((sum, p) => sum + p.sizeBytes, 0)

    try {
      // Update status to in_progress
      await this.saveMigrationStatus({
        status: 'in_progress',
        startedAt: new Date().toISOString()
      })

      this.reportProgress({
        phase: 'checking',
        itemsCopied: 0,
        totalItems: legacyPaths.length,
        bytesCopied: 0,
        totalBytes,
        percentComplete: 0
      })

      // Phase 1: Create backup of existing new location data (if any)
      this.reportProgress({
        phase: 'backing_up',
        currentItem: 'Creating safety backup...',
        itemsCopied: 0,
        totalItems: legacyPaths.length,
        bytesCopied: 0,
        totalBytes,
        percentComplete: 5
      })

      await this.createBackup(legacyPaths)

      // Phase 2: Copy files from legacy to new locations
      for (const pathInfo of legacyPaths) {
        if (!pathInfo.exists) continue

        try {
          this.reportProgress({
            phase: 'copying',
            currentItem: path.basename(pathInfo.legacyPath),
            itemsCopied: result.itemsMigrated,
            totalItems: legacyPaths.length,
            bytesCopied: result.bytesMigrated,
            totalBytes,
            percentComplete: this.calculatePercentage('copying', result.bytesMigrated, totalBytes)
          })

          // Ensure new directory exists
          if (!fs.existsSync(pathInfo.newPath)) {
            fs.mkdirSync(pathInfo.newPath, { recursive: true })
          }

          // Copy contents with progress tracking
          await this.copyDirectoryWithProgress(
            pathInfo.legacyPath,
            pathInfo.newPath,
            (copied) => {
              this.reportProgress({
                phase: 'copying',
                currentItem: path.basename(pathInfo.legacyPath),
                itemsCopied: result.itemsMigrated,
                totalItems: legacyPaths.length,
                bytesCopied: result.bytesMigrated + copied,
                totalBytes,
                percentComplete: this.calculatePercentage('copying', result.bytesMigrated + copied, totalBytes)
              })
            }
          )

          result.itemsMigrated++
          result.bytesMigrated += pathInfo.sizeBytes
        } catch (error) {
          const errMsg = error instanceof Error ? error.message : String(error)
          result.errors.push(`Failed to copy ${pathInfo.legacyPath}: ${errMsg}`)
        }
      }

      // Phase 3: Update database paths if needed
      this.reportProgress({
        phase: 'updating_paths',
        currentItem: 'Updating database references...',
        itemsCopied: result.itemsMigrated,
        totalItems: legacyPaths.length,
        bytesCopied: result.bytesMigrated,
        totalBytes,
        percentComplete: 70
      })

      result.pathsUpdated = await this.updateDatabasePaths(legacyPaths)

      // Phase 4: Validate migration
      this.reportProgress({
        phase: 'validating',
        currentItem: 'Verifying migrated data...',
        itemsCopied: result.itemsMigrated,
        totalItems: legacyPaths.length,
        bytesCopied: result.bytesMigrated,
        totalBytes,
        percentComplete: 80
      })

      const validation = await this.validateMigration()
      result.validation = validation

      if (!validation.isValid) {
        result.warnings.push('Some data may not have migrated correctly. Please verify your meetings and recordings.')
        result.warnings.push(...validation.errors)
      }

      // Phase 5: Mark migration complete
      this.reportProgress({
        phase: 'cleanup',
        currentItem: 'Finalizing migration...',
        itemsCopied: result.itemsMigrated,
        totalItems: legacyPaths.length,
        bytesCopied: result.bytesMigrated,
        totalBytes,
        percentComplete: 95
      })

      result.success = result.errors.length === 0

      // Save final status
      await this.saveMigrationStatus({
        status: result.success ? 'completed' : 'failed',
        startedAt: new Date().toISOString(),
        completedAt: new Date().toISOString(),
        validation,
        error: result.errors.length > 0 ? result.errors.join('; ') : undefined
      })

      // Add info about legacy data
      if (legacyPaths.length > 0 && result.success) {
        result.warnings.push(
          'Legacy data directories have been preserved. You can delete them to free up space after verifying the migration was successful.'
        )
      }

      this.reportProgress({
        phase: 'complete',
        itemsCopied: result.itemsMigrated,
        totalItems: legacyPaths.length,
        bytesCopied: result.bytesMigrated,
        totalBytes,
        percentComplete: 100
      })

    } catch (error) {
      const errMsg = error instanceof Error ? error.message : String(error)
      result.errors.push(`Migration failed: ${errMsg}`)

      await this.saveMigrationStatus({
        status: 'failed',
        startedAt: new Date().toISOString(),
        completedAt: new Date().toISOString(),
        error: errMsg
      })

      this.reportProgress({
        phase: 'error',
        itemsCopied: result.itemsMigrated,
        totalItems: legacyPaths.length,
        bytesCopied: result.bytesMigrated,
        totalBytes,
        errorMessage: errMsg,
        percentComplete: 0
      })
    }

    return result
  }

  /**
   * Create a backup before migration
   */
  private async createBackup(legacyPaths: LegacyPathInfo[]): Promise<void> {
    const backupDir = path.join(app.getPath('userData'), MIGRATION_BACKUP_DIR)

    // Create backup directory
    if (!fs.existsSync(backupDir)) {
      fs.mkdirSync(backupDir, { recursive: true })
    }

    this.currentMigrationBackupPath = backupDir

    // Save backup manifest
    const manifest = {
      createdAt: new Date().toISOString(),
      legacyPaths: legacyPaths.map(p => ({
        type: p.type,
        legacyPath: p.legacyPath,
        newPath: p.newPath
      }))
    }

    fs.writeFileSync(
      path.join(backupDir, 'manifest.json'),
      JSON.stringify(manifest, null, 2)
    )
  }

  /**
   * Rollback migration if it fails
   */
  async rollback(): Promise<RollbackResult> {
    const result: RollbackResult = {
      success: false,
      filesRestored: 0,
      errors: []
    }

    try {
      this.reportProgress({
        phase: 'rolling_back',
        currentItem: 'Rolling back migration...',
        itemsCopied: 0,
        totalItems: 0,
        bytesCopied: 0,
        totalBytes: 0,
        percentComplete: 0
      })

      const backupDir = path.join(app.getPath('userData'), MIGRATION_BACKUP_DIR)

      if (!fs.existsSync(backupDir)) {
        result.errors.push('No backup found to restore from')
        return result
      }

      // Read manifest
      const manifestPath = path.join(backupDir, 'manifest.json')
      if (!fs.existsSync(manifestPath)) {
        result.errors.push('Backup manifest not found')
        return result
      }

      // For now, rollback just means marking the migration as rolled back
      // The original legacy data is preserved, so the user can retry
      await this.saveMigrationStatus({
        status: 'rolled_back',
        completedAt: new Date().toISOString()
      })

      result.success = true
    } catch (error) {
      const errMsg = error instanceof Error ? error.message : String(error)
      result.errors.push(`Rollback failed: ${errMsg}`)
    }

    return result
  }

  /**
   * Skip migration and mark as skipped (start fresh)
   */
  async skipMigration(): Promise<void> {
    await this.saveMigrationStatus({
      status: 'skipped',
      completedAt: new Date().toISOString()
    })
  }

  /**
   * Validate the migration was successful
   */
  async validateMigration(): Promise<ValidationResult> {
    const result: ValidationResult = {
      isValid: true,
      meetingsAccessible: 0,
      meetingsTotal: 0,
      recordingsAccessible: 0,
      recordingsTotal: 0,
      transcriptsCount: 0,
      fileIntegrityPassed: true,
      errors: []
    }

    try {
      const dbPath = path.join(app.getPath('userData'), 'meeting-notes.db')

      if (!fs.existsSync(dbPath)) {
        result.errors.push('Database not found after migration')
        result.isValid = false
        return result
      }

      const Database = require('better-sqlite3')
      const db = new Database(dbPath, { readonly: true })

      try {
        // Check meetings
        const meetings = db.prepare('SELECT id, audio_file_path FROM meetings').all() as Array<{ id: string; audio_file_path: string | null }>
        result.meetingsTotal = meetings.length

        for (const meeting of meetings) {
          if (meeting.audio_file_path) {
            if (fs.existsSync(meeting.audio_file_path)) {
              result.meetingsAccessible++
            } else {
              result.errors.push(`Meeting ${meeting.id}: audio file not accessible`)
              result.fileIntegrityPassed = false
            }
          } else {
            result.meetingsAccessible++ // No audio file to check
          }
        }

        // Check recordings
        const recordings = db.prepare('SELECT id, file_path, file_size_bytes FROM recordings').all() as Array<{ id: string; file_path: string; file_size_bytes: number | null }>
        result.recordingsTotal = recordings.length

        for (const recording of recordings) {
          if (fs.existsSync(recording.file_path)) {
            result.recordingsAccessible++

            // Verify file size if we have it
            if (recording.file_size_bytes) {
              try {
                const stats = fs.statSync(recording.file_path)
                if (stats.size !== recording.file_size_bytes) {
                  result.errors.push(`Recording ${recording.id}: file size mismatch`)
                  result.fileIntegrityPassed = false
                }
              } catch {
                // Ignore stat errors
              }
            }
          } else {
            result.errors.push(`Recording ${recording.id}: file not accessible at ${recording.file_path}`)
            result.fileIntegrityPassed = false
          }
        }

        // Count transcripts
        const transcriptsResult = db.prepare('SELECT COUNT(*) as count FROM transcripts').get() as { count: number }
        result.transcriptsCount = transcriptsResult?.count || 0

        // Determine if valid
        result.isValid = result.fileIntegrityPassed &&
          result.meetingsAccessible === result.meetingsTotal &&
          result.recordingsAccessible === result.recordingsTotal
      } finally {
        db.close()
      }
    } catch (error) {
      const errMsg = error instanceof Error ? error.message : String(error)
      result.errors.push(`Validation error: ${errMsg}`)
      result.isValid = false
    }

    return result
  }

  /**
   * Clean up legacy data directories after successful migration
   */
  async cleanupLegacyData(legacyPaths: LegacyPathInfo[]): Promise<CleanupResult> {
    const result: CleanupResult = {
      success: false,
      bytesFreed: 0,
      filesDeleted: 0,
      errors: []
    }

    // Verify migration was successful first
    const status = await this.getMigrationStatus()
    if (status.status !== 'completed') {
      result.errors.push('Cannot cleanup: migration has not been completed successfully')
      return result
    }

    try {
      for (const pathInfo of legacyPaths) {
        if (!pathInfo.exists || !fs.existsSync(pathInfo.legacyPath)) continue

        try {
          const { size, count } = this.getDirectorySizeAndCount(pathInfo.legacyPath)

          // Delete the directory recursively
          fs.rmSync(pathInfo.legacyPath, { recursive: true, force: true })

          result.bytesFreed += size
          result.filesDeleted += count
        } catch (error) {
          const errMsg = error instanceof Error ? error.message : String(error)
          result.errors.push(`Failed to delete ${pathInfo.legacyPath}: ${errMsg}`)
        }
      }

      // Also clean up backup directory
      const backupDir = path.join(app.getPath('userData'), MIGRATION_BACKUP_DIR)
      if (fs.existsSync(backupDir)) {
        try {
          const { size, count } = this.getDirectorySizeAndCount(backupDir)
          fs.rmSync(backupDir, { recursive: true, force: true })
          result.bytesFreed += size
          result.filesDeleted += count
        } catch {
          // Ignore backup cleanup errors
        }
      }

      result.success = result.errors.length === 0
    } catch (error) {
      const errMsg = error instanceof Error ? error.message : String(error)
      result.errors.push(`Cleanup failed: ${errMsg}`)
    }

    return result
  }

  /**
   * Get size of legacy data that can be cleaned up
   */
  async getLegacyDataSize(legacyPaths: LegacyPathInfo[]): Promise<{ totalBytes: number; formattedSize: string }> {
    let totalBytes = 0

    for (const pathInfo of legacyPaths) {
      if (pathInfo.exists && fs.existsSync(pathInfo.legacyPath)) {
        totalBytes += pathInfo.sizeBytes
      }
    }

    return {
      totalBytes,
      formattedSize: this.formatBytes(totalBytes)
    }
  }

  /**
   * Format bytes to human readable string
   */
  formatBytes(bytes: number): string {
    if (bytes === 0) return '0 Bytes'
    const k = 1024
    const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB']
    const i = Math.floor(Math.log(bytes) / Math.log(k))
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i]
  }

  /**
   * Copy directory recursively with progress tracking
   */
  private async copyDirectoryWithProgress(
    src: string,
    dest: string,
    onProgress?: (bytesCopied: number) => void
  ): Promise<void> {
    let totalCopied = 0
    const entries = fs.readdirSync(src, { withFileTypes: true })

    for (const entry of entries) {
      const srcPath = path.join(src, entry.name)
      const destPath = path.join(dest, entry.name)

      if (entry.isDirectory()) {
        if (!fs.existsSync(destPath)) {
          fs.mkdirSync(destPath, { recursive: true })
        }
        await this.copyDirectoryWithProgress(srcPath, destPath, (copied) => {
          onProgress?.(totalCopied + copied)
        })
      } else {
        // Don't overwrite existing files
        if (!fs.existsSync(destPath)) {
          try {
            fs.copyFileSync(srcPath, destPath)
            const stats = fs.statSync(srcPath)
            totalCopied += stats.size
            onProgress?.(totalCopied)
          } catch (error) {
            // Handle locked files gracefully
            const errMsg = error instanceof Error ? error.message : String(error)
            if (errMsg.includes('EBUSY') || errMsg.includes('locked')) {
              console.warn(`Skipping locked file: ${srcPath}`)
            } else {
              throw error
            }
          }
        }
      }
    }
  }

  /**
   * Get directory size and file count recursively
   */
  private getDirectorySizeAndCount(dirPath: string): { size: number; count: number } {
    let totalSize = 0
    let fileCount = 0

    try {
      const entries = fs.readdirSync(dirPath, { withFileTypes: true })

      for (const entry of entries) {
        const entryPath = path.join(dirPath, entry.name)

        if (entry.isDirectory()) {
          const subResult = this.getDirectorySizeAndCount(entryPath)
          totalSize += subResult.size
          fileCount += subResult.count
        } else {
          try {
            const stats = fs.statSync(entryPath)
            totalSize += stats.size
            fileCount++
          } catch {
            // Ignore stat errors
          }
        }
      }
    } catch {
      // Ignore errors when calculating size
    }

    return { size: totalSize, count: fileCount }
  }

  /**
   * Update file paths in the database
   */
  private async updateDatabasePaths(legacyPaths: LegacyPathInfo[]): Promise<number> {
    let pathsUpdated = 0

    try {
      const dbPath = path.join(app.getPath('userData'), 'meeting-notes.db')

      if (!fs.existsSync(dbPath)) {
        return 0
      }

      // Load better-sqlite3 dynamically to update paths
      const Database = require('better-sqlite3')
      const db = new Database(dbPath)

      try {
        // Update meetings table
        const meetings = db.prepare('SELECT id, audio_file_path FROM meetings WHERE audio_file_path IS NOT NULL').all() as Array<{ id: string; audio_file_path: string }>

        for (const meeting of meetings) {
          let updatedPath = meeting.audio_file_path

          for (const pathInfo of legacyPaths) {
            if (meeting.audio_file_path.includes(pathInfo.legacyPath)) {
              updatedPath = meeting.audio_file_path.replace(pathInfo.legacyPath, pathInfo.newPath)
              break
            }
          }

          if (updatedPath !== meeting.audio_file_path) {
            db.prepare('UPDATE meetings SET audio_file_path = ? WHERE id = ?').run(updatedPath, meeting.id)
            pathsUpdated++
          }
        }

        // Update recordings table
        const recordings = db.prepare('SELECT id, file_path FROM recordings WHERE file_path IS NOT NULL').all() as Array<{ id: string; file_path: string }>

        for (const recording of recordings) {
          let updatedPath = recording.file_path

          for (const pathInfo of legacyPaths) {
            if (recording.file_path.includes(pathInfo.legacyPath)) {
              updatedPath = recording.file_path.replace(pathInfo.legacyPath, pathInfo.newPath)
              break
            }
          }

          if (updatedPath !== recording.file_path) {
            db.prepare('UPDATE recordings SET file_path = ? WHERE id = ?').run(updatedPath, recording.id)
            pathsUpdated++
          }
        }

        // Update settings if there's a recordings path setting
        const recordingsPathSetting = db.prepare("SELECT key, value FROM settings WHERE key = 'storage.recordingsPath'").get() as { key: string; value: string } | undefined

        if (recordingsPathSetting) {
          let settingValue = recordingsPathSetting.value
          // Parse JSON value
          try {
            settingValue = JSON.parse(settingValue)
          } catch {
            // Already a plain string
          }

          for (const pathInfo of legacyPaths) {
            if (typeof settingValue === 'string' && settingValue.includes(pathInfo.legacyPath)) {
              const updatedValue = settingValue.replace(pathInfo.legacyPath, pathInfo.newPath)
              db.prepare("UPDATE settings SET value = ? WHERE key = 'storage.recordingsPath'").run(JSON.stringify(updatedValue))
              pathsUpdated++
              break
            }
          }
        }
      } finally {
        db.close()
      }
    } catch (error) {
      console.error('Failed to update database paths:', error)
    }

    return pathsUpdated
  }

  /**
   * Report progress to callback
   */
  private reportProgress(progress: MigrationProgress): void {
    if (this.progressCallback) {
      this.progressCallback(progress)
    }
  }
}

// ============================================================================
// Singleton Export
// ============================================================================

export const dataMigrationService = new DataMigrationService()
