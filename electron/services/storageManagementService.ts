/**
 * Storage Management Service
 *
 * Comprehensive service for managing storage, including:
 * - Storage usage analysis (total, per-meeting, by type)
 * - Largest meetings by size
 * - Oldest meetings by date
 * - Bulk cleanup operations
 * - Storage trends tracking
 * - Storage limit warnings
 * - Cleanup wizard support
 */

import * as fs from 'fs'
import * as path from 'path'
import { randomUUID } from 'crypto'
import type Database from 'better-sqlite3'
import { getDatabaseService } from './database'
import { meetingService } from './meetingService'
import { recordingService } from './recordingService'
import { transcriptService } from './transcriptService'
import { meetingNoteService } from './meetingNoteService'
import { taskService } from './taskService'
import { meetingDeletionService, type DeletionOptions } from './meetingDeletionService'
import { settingsService } from './settingsService'
import type { Meeting, Recording } from '../../src/types/database'

// ============================================================================
// Types
// ============================================================================

export interface MeetingStorageInfo {
  meetingId: string
  meetingTitle: string
  startTime: string
  audioFileSize: number
  recordingsSize: number
  databaseEstimate: number
  totalSize: number
  transcriptCount: number
  notesCount: number
  tasksCount: number
  hasAudio: boolean
  audioFilePath: string | null
  daysSinceCreated: number
}

export interface StorageBreakdown {
  totalBytes: number
  audioBytes: number
  databaseBytes: number
  meetingsCount: number
  recordingsCount: number
  transcriptsCount: number
  notesCount: number
  tasksCount: number
}

export interface StorageUsageResult {
  total: StorageBreakdown
  byMeeting: MeetingStorageInfo[]
  largestMeetings: MeetingStorageInfo[]
  oldestMeetings: MeetingStorageInfo[]
  meetingsWithoutTranscripts: MeetingStorageInfo[]
  meetingsWithoutNotes: MeetingStorageInfo[]
  storageLimit: number
  storageUsedPercent: number
  warningThreshold: number
  isApproachingLimit: boolean
}

export interface StorageTrendPoint {
  date: string
  totalBytes: number
  audioBytes: number
  databaseBytes: number
  meetingsCount: number
}

export interface CleanupCriteria {
  olderThanDays?: number
  largerThanBytes?: number
  withoutTranscripts?: boolean
  withoutNotes?: boolean
  meetingIds?: string[]
}

export interface CleanupPreview {
  meetingsToDelete: MeetingStorageInfo[]
  totalSpaceToFree: number
  totalMeetings: number
  criteria: CleanupCriteria
}

export interface CleanupResult {
  success: boolean
  deletedMeetings: number
  freedSpaceBytes: number
  errors: string[]
}

export interface CompressionResult {
  success: boolean
  originalSize: number
  compressedSize: number
  savedBytes: number
  meetingId: string
  error?: string
}

export interface ExportResult {
  success: boolean
  exportPath: string
  exportedMeetings: number
  totalSize: number
  error?: string
}

// ============================================================================
// Constants
// ============================================================================

const DEFAULT_STORAGE_LIMIT = 50 * 1024 * 1024 * 1024 // 50 GB default
const DEFAULT_WARNING_THRESHOLD = 0.8 // 80%
const BYTES_PER_TRANSCRIPT = 500 // Estimate bytes per transcript segment in DB
const BYTES_PER_NOTE = 1000 // Estimate bytes per note in DB
const BYTES_PER_TASK = 300 // Estimate bytes per task in DB

// ============================================================================
// Prepared Statements Cache
// ============================================================================

let statements: {
  createStorageTrendsTable: Database.Statement
  insertStorageTrend: Database.Statement
  getStorageTrends: Database.Statement
  getLatestTrend: Database.Statement
  deleteOldTrends: Database.Statement
} | null = null

function getStatements() {
  if (statements) return statements

  const db = getDatabaseService().getDatabase()

  // Create storage trends table if it doesn't exist
  db.exec(`
    CREATE TABLE IF NOT EXISTS storage_trends (
      id TEXT PRIMARY KEY NOT NULL,
      date TEXT NOT NULL,
      total_bytes INTEGER NOT NULL DEFAULT 0,
      audio_bytes INTEGER NOT NULL DEFAULT 0,
      database_bytes INTEGER NOT NULL DEFAULT 0,
      meetings_count INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_storage_trends_date ON storage_trends(date);
  `)

  statements = {
    createStorageTrendsTable: db.prepare('SELECT 1'),
    insertStorageTrend: db.prepare(`
      INSERT INTO storage_trends (id, date, total_bytes, audio_bytes, database_bytes, meetings_count)
      VALUES (@id, @date, @total_bytes, @audio_bytes, @database_bytes, @meetings_count)
    `),
    getStorageTrends: db.prepare(`
      SELECT * FROM storage_trends ORDER BY date DESC LIMIT ?
    `),
    getLatestTrend: db.prepare(`
      SELECT * FROM storage_trends ORDER BY date DESC LIMIT 1
    `),
    deleteOldTrends: db.prepare(`
      DELETE FROM storage_trends WHERE date < ?
    `)
  }

  return statements
}

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Get file size safely
 */
function getFileSize(filePath: string): number {
  try {
    if (filePath && fs.existsSync(filePath)) {
      const stats = fs.statSync(filePath)
      return stats.size
    }
  } catch {
    // Ignore errors
  }
  return 0
}

/**
 * Calculate days since a date
 */
function daysSince(isoDate: string): number {
  const date = new Date(isoDate)
  const now = new Date()
  const diffMs = now.getTime() - date.getTime()
  return Math.floor(diffMs / (1000 * 60 * 60 * 24))
}

/**
 * Get today's date as ISO string (date only)
 */
function getTodayDateString(): string {
  return new Date().toISOString().split('T')[0]
}

// ============================================================================
// Storage Management Service
// ============================================================================

export const storageManagementService = {
  /**
   * Get comprehensive storage usage information
   */
  getStorageUsage(): StorageUsageResult {
    const meetings = meetingService.getAll()
    const byMeeting: MeetingStorageInfo[] = []

    let totalAudioBytes = 0
    let totalRecordingsCount = 0
    let totalTranscriptsCount = 0
    let totalNotesCount = 0
    let totalTasksCount = 0

    for (const meeting of meetings) {
      const recordings = recordingService.getByMeetingId(meeting.id)
      const transcripts = transcriptService.getByMeetingId(meeting.id)
      const notes = meetingNoteService.getByMeetingId(meeting.id)
      const tasks = taskService.getByMeetingId(meeting.id)

      // Calculate audio file sizes
      let audioFileSize = 0
      if (meeting.audio_file_path) {
        audioFileSize = getFileSize(meeting.audio_file_path)
      }

      let recordingsSize = 0
      for (const recording of recordings) {
        if (recording.file_path) {
          const size = recording.file_size_bytes || getFileSize(recording.file_path)
          recordingsSize += size
        }
      }

      // Estimate database size for this meeting
      const databaseEstimate =
        transcripts.length * BYTES_PER_TRANSCRIPT +
        notes.length * BYTES_PER_NOTE +
        tasks.length * BYTES_PER_TASK

      const totalSize = audioFileSize + recordingsSize + databaseEstimate

      const meetingInfo: MeetingStorageInfo = {
        meetingId: meeting.id,
        meetingTitle: meeting.title,
        startTime: meeting.start_time,
        audioFileSize,
        recordingsSize,
        databaseEstimate,
        totalSize,
        transcriptCount: transcripts.length,
        notesCount: notes.length,
        tasksCount: tasks.length,
        hasAudio: !!(meeting.audio_file_path || recordingsSize > 0),
        audioFilePath: meeting.audio_file_path,
        daysSinceCreated: daysSince(meeting.created_at)
      }

      byMeeting.push(meetingInfo)

      totalAudioBytes += audioFileSize + recordingsSize
      totalRecordingsCount += recordings.length
      totalTranscriptsCount += transcripts.length
      totalNotesCount += notes.length
      totalTasksCount += tasks.length
    }

    // Get database file size
    const dbService = getDatabaseService()
    const dbPath = dbService.getDbPath()
    const databaseBytes = getFileSize(dbPath)

    const total: StorageBreakdown = {
      totalBytes: totalAudioBytes + databaseBytes,
      audioBytes: totalAudioBytes,
      databaseBytes,
      meetingsCount: meetings.length,
      recordingsCount: totalRecordingsCount,
      transcriptsCount: totalTranscriptsCount,
      notesCount: totalNotesCount,
      tasksCount: totalTasksCount
    }

    // Sort for different views
    const largestMeetings = [...byMeeting]
      .sort((a, b) => b.totalSize - a.totalSize)
      .slice(0, 10)

    const oldestMeetings = [...byMeeting]
      .sort((a, b) => new Date(a.startTime).getTime() - new Date(b.startTime).getTime())
      .slice(0, 10)

    const meetingsWithoutTranscripts = byMeeting.filter(m => m.transcriptCount === 0)
    const meetingsWithoutNotes = byMeeting.filter(m => m.notesCount === 0)

    // Get storage limit from settings
    const storageLimitSetting = settingsService.get('storage.limit')
    const storageLimit = (storageLimitSetting as number) || DEFAULT_STORAGE_LIMIT

    const warningThresholdSetting = settingsService.get('storage.warningThreshold')
    const warningThreshold = (warningThresholdSetting as number) || DEFAULT_WARNING_THRESHOLD

    const storageUsedPercent = total.totalBytes / storageLimit
    const isApproachingLimit = storageUsedPercent >= warningThreshold

    return {
      total,
      byMeeting,
      largestMeetings,
      oldestMeetings,
      meetingsWithoutTranscripts,
      meetingsWithoutNotes,
      storageLimit,
      storageUsedPercent,
      warningThreshold,
      isApproachingLimit
    }
  },

  /**
   * Get storage breakdown for a specific meeting
   */
  getMeetingStorageInfo(meetingId: string): MeetingStorageInfo | null {
    const meeting = meetingService.getById(meetingId)
    if (!meeting) return null

    const recordings = recordingService.getByMeetingId(meetingId)
    const transcripts = transcriptService.getByMeetingId(meetingId)
    const notes = meetingNoteService.getByMeetingId(meetingId)
    const tasks = taskService.getByMeetingId(meetingId)

    let audioFileSize = 0
    if (meeting.audio_file_path) {
      audioFileSize = getFileSize(meeting.audio_file_path)
    }

    let recordingsSize = 0
    for (const recording of recordings) {
      if (recording.file_path) {
        const size = recording.file_size_bytes || getFileSize(recording.file_path)
        recordingsSize += size
      }
    }

    const databaseEstimate =
      transcripts.length * BYTES_PER_TRANSCRIPT +
      notes.length * BYTES_PER_NOTE +
      tasks.length * BYTES_PER_TASK

    return {
      meetingId: meeting.id,
      meetingTitle: meeting.title,
      startTime: meeting.start_time,
      audioFileSize,
      recordingsSize,
      databaseEstimate,
      totalSize: audioFileSize + recordingsSize + databaseEstimate,
      transcriptCount: transcripts.length,
      notesCount: notes.length,
      tasksCount: tasks.length,
      hasAudio: !!(meeting.audio_file_path || recordingsSize > 0),
      audioFilePath: meeting.audio_file_path,
      daysSinceCreated: daysSince(meeting.created_at)
    }
  },

  /**
   * Get cleanup preview based on criteria
   */
  getCleanupPreview(criteria: CleanupCriteria): CleanupPreview {
    const usage = storageManagementService.getStorageUsage()
    const meetingsToDelete: MeetingStorageInfo[] = []

    for (const meeting of usage.byMeeting) {
      let shouldInclude = false

      // Check criteria
      if (criteria.olderThanDays !== undefined && meeting.daysSinceCreated >= criteria.olderThanDays) {
        shouldInclude = true
      }

      if (criteria.largerThanBytes !== undefined && meeting.totalSize >= criteria.largerThanBytes) {
        shouldInclude = true
      }

      if (criteria.withoutTranscripts && meeting.transcriptCount === 0) {
        shouldInclude = true
      }

      if (criteria.withoutNotes && meeting.notesCount === 0) {
        shouldInclude = true
      }

      if (criteria.meetingIds && criteria.meetingIds.includes(meeting.meetingId)) {
        shouldInclude = true
      }

      if (shouldInclude) {
        meetingsToDelete.push(meeting)
      }
    }

    const totalSpaceToFree = meetingsToDelete.reduce((sum, m) => sum + m.totalSize, 0)

    return {
      meetingsToDelete,
      totalSpaceToFree,
      totalMeetings: meetingsToDelete.length,
      criteria
    }
  },

  /**
   * Execute cleanup based on criteria
   */
  executeCleanup(criteria: CleanupCriteria, options?: DeletionOptions): CleanupResult {
    const preview = storageManagementService.getCleanupPreview(criteria)
    const errors: string[] = []
    let deletedMeetings = 0
    let freedSpaceBytes = 0

    const deletionOptions: DeletionOptions = {
      deleteFiles: true,
      deleteTasks: true,
      auditLog: true,
      performedBy: 'storage-cleanup',
      ...options
    }

    for (const meeting of preview.meetingsToDelete) {
      const result = meetingDeletionService.deleteMeeting(meeting.meetingId, deletionOptions)
      if (result.success) {
        deletedMeetings++
        freedSpaceBytes += result.freedSpaceBytes
      } else {
        errors.push(`Failed to delete ${meeting.meetingTitle}: ${result.error}`)
      }
    }

    return {
      success: errors.length === 0,
      deletedMeetings,
      freedSpaceBytes,
      errors
    }
  },

  /**
   * Delete meetings older than X days
   */
  deleteOlderThan(days: number, options?: DeletionOptions): CleanupResult {
    return storageManagementService.executeCleanup({ olderThanDays: days }, options)
  },

  /**
   * Delete meetings larger than X bytes
   */
  deleteLargerThan(bytes: number, options?: DeletionOptions): CleanupResult {
    return storageManagementService.executeCleanup({ largerThanBytes: bytes }, options)
  },

  /**
   * Delete meetings without transcripts
   */
  deleteWithoutTranscripts(options?: DeletionOptions): CleanupResult {
    return storageManagementService.executeCleanup({ withoutTranscripts: true }, options)
  },

  /**
   * Delete meetings without notes
   */
  deleteWithoutNotes(options?: DeletionOptions): CleanupResult {
    return storageManagementService.executeCleanup({ withoutNotes: true }, options)
  },

  /**
   * Record storage trend for today
   */
  recordStorageTrend(): void {
    const stmts = getStatements()
    const usage = storageManagementService.getStorageUsage()
    const today = getTodayDateString()

    // Check if we already have a trend for today
    const latest = stmts.getLatestTrend.get() as { date: string } | undefined
    if (latest && latest.date === today) {
      // Update existing trend
      const db = getDatabaseService().getDatabase()
      db.prepare(`
        UPDATE storage_trends
        SET total_bytes = ?, audio_bytes = ?, database_bytes = ?, meetings_count = ?
        WHERE date = ?
      `).run(
        usage.total.totalBytes,
        usage.total.audioBytes,
        usage.total.databaseBytes,
        usage.total.meetingsCount,
        today
      )
    } else {
      // Insert new trend
      stmts.insertStorageTrend.run({
        id: randomUUID(),
        date: today,
        total_bytes: usage.total.totalBytes,
        audio_bytes: usage.total.audioBytes,
        database_bytes: usage.total.databaseBytes,
        meetings_count: usage.total.meetingsCount
      })
    }

    // Clean up old trends (keep last 365 days)
    const oneYearAgo = new Date()
    oneYearAgo.setFullYear(oneYearAgo.getFullYear() - 1)
    stmts.deleteOldTrends.run(oneYearAgo.toISOString().split('T')[0])
  },

  /**
   * Get storage trends
   */
  getStorageTrends(days: number = 30): StorageTrendPoint[] {
    const stmts = getStatements()
    const trends = stmts.getStorageTrends.all(days) as Array<{
      date: string
      total_bytes: number
      audio_bytes: number
      database_bytes: number
      meetings_count: number
    }>

    return trends.map(t => ({
      date: t.date,
      totalBytes: t.total_bytes,
      audioBytes: t.audio_bytes,
      databaseBytes: t.database_bytes,
      meetingsCount: t.meetings_count
    })).reverse() // Return in chronological order
  },

  /**
   * Update storage limit
   */
  setStorageLimit(bytes: number): void {
    settingsService.set('storage.limit', bytes, 'storage')
  },

  /**
   * Update warning threshold
   */
  setWarningThreshold(threshold: number): void {
    settingsService.set('storage.warningThreshold', threshold, 'storage')
  },

  /**
   * Get storage settings
   */
  getStorageSettings(): {
    storageLimit: number
    warningThreshold: number
    autoCleanup: boolean
    audioRetentionDays: number
  } {
    const storageLimit = (settingsService.get('storage.limit') as number) || DEFAULT_STORAGE_LIMIT
    const warningThreshold = (settingsService.get('storage.warningThreshold') as number) || DEFAULT_WARNING_THRESHOLD
    const autoCleanup = (settingsService.get('storage.autoCleanup') as boolean) ?? true
    const audioRetentionDays = (settingsService.get('storage.audioRetentionDays') as number) || 30

    return {
      storageLimit,
      warningThreshold,
      autoCleanup,
      audioRetentionDays
    }
  },

  /**
   * Update storage settings
   */
  updateStorageSettings(settings: {
    storageLimit?: number
    warningThreshold?: number
    autoCleanup?: boolean
    audioRetentionDays?: number
  }): void {
    if (settings.storageLimit !== undefined) {
      settingsService.set('storage.limit', settings.storageLimit, 'storage')
    }
    if (settings.warningThreshold !== undefined) {
      settingsService.set('storage.warningThreshold', settings.warningThreshold, 'storage')
    }
    if (settings.autoCleanup !== undefined) {
      settingsService.set('storage.autoCleanup', settings.autoCleanup, 'storage')
    }
    if (settings.audioRetentionDays !== undefined) {
      settingsService.set('storage.audioRetentionDays', settings.audioRetentionDays, 'storage')
    }
  },

  /**
   * Run automatic cleanup based on settings
   */
  runAutoCleanup(): CleanupResult {
    const settings = storageManagementService.getStorageSettings()

    if (!settings.autoCleanup) {
      return { success: true, deletedMeetings: 0, freedSpaceBytes: 0, errors: [] }
    }

    // Delete meetings older than retention period
    return storageManagementService.deleteOlderThan(settings.audioRetentionDays, {
      softDelete: true,
      softDeleteDays: 7, // Give 7 days to recover before permanent deletion
      auditLog: true,
      performedBy: 'auto-cleanup'
    })
  },

  /**
   * Check if storage warning should be shown
   */
  shouldShowStorageWarning(): boolean {
    const usage = storageManagementService.getStorageUsage()
    return usage.isApproachingLimit
  },

  /**
   * Get cleanup recommendations
   */
  getCleanupRecommendations(): {
    largeFiles: MeetingStorageInfo[]
    oldMeetings: MeetingStorageInfo[]
    emptyMeetings: MeetingStorageInfo[]
    potentialSavings: number
  } {
    const usage = storageManagementService.getStorageUsage()

    // Large files (> 100MB)
    const largeFiles = usage.byMeeting
      .filter(m => m.totalSize > 100 * 1024 * 1024)
      .sort((a, b) => b.totalSize - a.totalSize)
      .slice(0, 5)

    // Old meetings (> 90 days)
    const oldMeetings = usage.byMeeting
      .filter(m => m.daysSinceCreated > 90)
      .sort((a, b) => b.daysSinceCreated - a.daysSinceCreated)
      .slice(0, 5)

    // Empty meetings (no transcripts and no notes)
    const emptyMeetings = usage.byMeeting
      .filter(m => m.transcriptCount === 0 && m.notesCount === 0)
      .slice(0, 5)

    const potentialSavings =
      largeFiles.reduce((sum, m) => sum + m.totalSize, 0) +
      oldMeetings.reduce((sum, m) => sum + m.totalSize, 0) +
      emptyMeetings.reduce((sum, m) => sum + m.totalSize, 0)

    return {
      largeFiles,
      oldMeetings,
      emptyMeetings,
      potentialSavings
    }
  }
}

// Reset statements cache (useful for testing)
export function resetStorageManagementStatements(): void {
  statements = null
}
