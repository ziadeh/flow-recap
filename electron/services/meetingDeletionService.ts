/**
 * Meeting Deletion Service
 *
 * Comprehensive service for meeting deletion with support for:
 * - Full data cleanup (recordings, transcripts, notes, tasks, speakers)
 * - File system cleanup (audio files, voice profiles)
 * - Soft delete with restore capability
 * - Archive functionality
 * - Batch deletion
 * - Audit logging
 */

import { randomUUID } from 'crypto'
import * as fs from 'fs'
import * as path from 'path'
import type Database from 'better-sqlite3'
import { getDatabaseService } from './database'
import { meetingService } from './meetingService'
import { recordingService } from './recordingService'
import { transcriptService } from './transcriptService'
import { meetingNoteService } from './meetingNoteService'
import { taskService } from './taskService'
import { speakerService } from './speakerService'
import { meetingSpeakerNameService } from './meetingSpeakerNameService'
import type { Meeting, Recording, Transcript, MeetingNote, Task, Speaker } from '../../src/types/database'

// ============================================================================
// Types
// ============================================================================

export interface TaskPreviewByStatus {
  pending: number
  in_progress: number
  completed: number
  cancelled: number
}

export interface DeletionPreview {
  meetingId: string
  meetingTitle: string
  recordingsCount: number
  transcriptsCount: number
  notesCount: number
  tasksCount: number
  tasksByStatus: TaskPreviewByStatus
  hasInProgressTasks: boolean
  hasPendingTasks: boolean
  speakersCount: number
  totalFileSizeBytes: number
  filePaths: string[]
  estimatedCleanupTime: number // milliseconds
}

export interface DeletionResult {
  success: boolean
  meetingId: string
  deletedRecordings: number
  deletedTranscripts: number
  deletedNotes: number
  deletedTasks: number
  deletedSpeakers: number
  deletedFiles: number
  failedFileDeletions: string[]
  freedSpaceBytes: number
  auditLogId: string
  error?: string
}

export interface BatchDeletionResult {
  success: boolean
  totalMeetings: number
  deletedMeetings: number
  failedMeetings: number
  results: DeletionResult[]
  totalFreedSpaceBytes: number
  errors: string[]
}

export interface ArchiveResult {
  success: boolean
  meetingId: string
  archivePath: string
  archivedAt: string
  error?: string
}

export interface RestoreResult {
  success: boolean
  meetingId: string
  restoredAt: string
  error?: string
}

export interface SoftDeletedMeeting {
  id: string
  meeting_id: string
  original_data: string // JSON serialized meeting data
  deleted_at: string
  expires_at: string
  deleted_by: string
}

export interface AuditLogEntry {
  id: string
  meeting_id: string
  action: 'delete' | 'archive' | 'restore' | 'soft_delete' | 'permanent_delete'
  details: string
  performed_at: string
  performed_by: string
}

export type TaskHandlingAction = 'delete' | 'unlink' | 'reassign' | 'cancel'

export interface DeletionOptions {
  deleteFiles?: boolean
  deleteTasks?: boolean
  taskHandling?: TaskHandlingAction
  reassignToMeetingId?: string
  autoUnlinkCompleted?: boolean
  softDelete?: boolean
  softDeleteDays?: number
  auditLog?: boolean
  performedBy?: string
}

const DEFAULT_OPTIONS: DeletionOptions = {
  deleteFiles: true,
  deleteTasks: true,
  taskHandling: 'unlink',
  autoUnlinkCompleted: true,
  softDelete: false,
  softDeleteDays: 30,
  auditLog: true,
  performedBy: 'system'
}

// ============================================================================
// Prepared Statements Cache
// ============================================================================

let statements: {
  // Soft delete table
  createSoftDeleteTable: Database.Statement
  insertSoftDelete: Database.Statement
  getSoftDeleted: Database.Statement
  getSoftDeletedById: Database.Statement
  deleteSoftDelete: Database.Statement
  getExpiredSoftDeletes: Database.Statement
  // Audit log table
  createAuditLogTable: Database.Statement
  insertAuditLog: Database.Statement
  getAuditLogs: Database.Statement
  getAuditLogsByMeetingId: Database.Statement
  // Archive table
  createArchiveTable: Database.Statement
  insertArchive: Database.Statement
  getArchivedMeetings: Database.Statement
  getArchivedById: Database.Statement
  deleteArchive: Database.Statement
} | null = null

function getStatements() {
  if (statements) return statements

  const db = getDatabaseService().getDatabase()

  // Create soft delete table if it doesn't exist
  db.exec(`
    CREATE TABLE IF NOT EXISTS soft_deleted_meetings (
      id TEXT PRIMARY KEY NOT NULL,
      meeting_id TEXT NOT NULL,
      original_data TEXT NOT NULL,
      deleted_at TEXT NOT NULL DEFAULT (datetime('now')),
      expires_at TEXT NOT NULL,
      deleted_by TEXT NOT NULL DEFAULT 'system'
    );
    CREATE INDEX IF NOT EXISTS idx_soft_deleted_meetings_expires ON soft_deleted_meetings(expires_at);
    CREATE INDEX IF NOT EXISTS idx_soft_deleted_meetings_meeting_id ON soft_deleted_meetings(meeting_id);
  `)

  // Create audit log table if it doesn't exist
  db.exec(`
    CREATE TABLE IF NOT EXISTS deletion_audit_log (
      id TEXT PRIMARY KEY NOT NULL,
      meeting_id TEXT NOT NULL,
      action TEXT NOT NULL CHECK(action IN ('delete', 'archive', 'restore', 'soft_delete', 'permanent_delete')),
      details TEXT NOT NULL,
      performed_at TEXT NOT NULL DEFAULT (datetime('now')),
      performed_by TEXT NOT NULL DEFAULT 'system'
    );
    CREATE INDEX IF NOT EXISTS idx_deletion_audit_log_meeting_id ON deletion_audit_log(meeting_id);
    CREATE INDEX IF NOT EXISTS idx_deletion_audit_log_action ON deletion_audit_log(action);
    CREATE INDEX IF NOT EXISTS idx_deletion_audit_log_performed_at ON deletion_audit_log(performed_at);
  `)

  // Create archive table if it doesn't exist
  db.exec(`
    CREATE TABLE IF NOT EXISTS archived_meetings (
      id TEXT PRIMARY KEY NOT NULL,
      meeting_id TEXT NOT NULL,
      original_data TEXT NOT NULL,
      archive_path TEXT,
      archived_at TEXT NOT NULL DEFAULT (datetime('now')),
      archived_by TEXT NOT NULL DEFAULT 'system'
    );
    CREATE INDEX IF NOT EXISTS idx_archived_meetings_meeting_id ON archived_meetings(meeting_id);
  `)

  statements = {
    // Soft delete statements
    createSoftDeleteTable: db.prepare('SELECT 1'), // Already created above
    insertSoftDelete: db.prepare(`
      INSERT INTO soft_deleted_meetings (id, meeting_id, original_data, deleted_at, expires_at, deleted_by)
      VALUES (@id, @meeting_id, @original_data, datetime('now'), @expires_at, @deleted_by)
    `),
    getSoftDeleted: db.prepare(`
      SELECT * FROM soft_deleted_meetings ORDER BY deleted_at DESC
    `),
    getSoftDeletedById: db.prepare(`
      SELECT * FROM soft_deleted_meetings WHERE meeting_id = ?
    `),
    deleteSoftDelete: db.prepare(`
      DELETE FROM soft_deleted_meetings WHERE meeting_id = ?
    `),
    getExpiredSoftDeletes: db.prepare(`
      SELECT * FROM soft_deleted_meetings WHERE expires_at < datetime('now')
    `),

    // Audit log statements
    createAuditLogTable: db.prepare('SELECT 1'), // Already created above
    insertAuditLog: db.prepare(`
      INSERT INTO deletion_audit_log (id, meeting_id, action, details, performed_at, performed_by)
      VALUES (@id, @meeting_id, @action, @details, datetime('now'), @performed_by)
    `),
    getAuditLogs: db.prepare(`
      SELECT * FROM deletion_audit_log ORDER BY performed_at DESC LIMIT ?
    `),
    getAuditLogsByMeetingId: db.prepare(`
      SELECT * FROM deletion_audit_log WHERE meeting_id = ? ORDER BY performed_at DESC
    `),

    // Archive statements
    createArchiveTable: db.prepare('SELECT 1'), // Already created above
    insertArchive: db.prepare(`
      INSERT INTO archived_meetings (id, meeting_id, original_data, archive_path, archived_at, archived_by)
      VALUES (@id, @meeting_id, @original_data, @archive_path, datetime('now'), @archived_by)
    `),
    getArchivedMeetings: db.prepare(`
      SELECT * FROM archived_meetings ORDER BY archived_at DESC
    `),
    getArchivedById: db.prepare(`
      SELECT * FROM archived_meetings WHERE meeting_id = ?
    `),
    deleteArchive: db.prepare(`
      DELETE FROM archived_meetings WHERE meeting_id = ?
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
    if (fs.existsSync(filePath)) {
      const stats = fs.statSync(filePath)
      return stats.size
    }
  } catch {
    // Ignore errors
  }
  return 0
}

/**
 * Delete a file safely and return success status
 */
function deleteFileSafe(filePath: string): { success: boolean; error?: string } {
  try {
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath)
      return { success: true }
    }
    return { success: true } // File doesn't exist, consider it deleted
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error'
    }
  }
}

/**
 * Delete a directory and its contents safely
 */
function deleteDirectorySafe(dirPath: string): { success: boolean; error?: string } {
  try {
    if (fs.existsSync(dirPath)) {
      fs.rmSync(dirPath, { recursive: true, force: true })
      return { success: true }
    }
    return { success: true } // Directory doesn't exist, consider it deleted
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error'
    }
  }
}

/**
 * Create audit log entry
 */
function createAuditLog(
  meetingId: string,
  action: AuditLogEntry['action'],
  details: string,
  performedBy: string
): string {
  const stmts = getStatements()
  const id = randomUUID()

  stmts.insertAuditLog.run({
    id,
    meeting_id: meetingId,
    action,
    details,
    performed_by: performedBy
  })

  return id
}

// ============================================================================
// Meeting Deletion Service
// ============================================================================

export const meetingDeletionService = {
  /**
   * Get a preview of what will be deleted for a meeting
   */
  getDeletionPreview(meetingId: string): DeletionPreview | null {
    const meeting = meetingService.getById(meetingId)
    if (!meeting) {
      return null
    }

    const recordings = recordingService.getByMeetingId(meetingId)
    const transcripts = transcriptService.getByMeetingId(meetingId)
    const notes = meetingNoteService.getByMeetingId(meetingId)
    const tasks = taskService.getByMeetingId(meetingId)

    // Group tasks by status
    const tasksByStatus: TaskPreviewByStatus = {
      pending: 0,
      in_progress: 0,
      completed: 0,
      cancelled: 0
    }

    for (const task of tasks) {
      if (task.status in tasksByStatus) {
        tasksByStatus[task.status as keyof TaskPreviewByStatus]++
      }
    }

    const hasInProgressTasks = tasksByStatus.in_progress > 0
    const hasPendingTasks = tasksByStatus.pending > 0

    // Get unique speakers from transcripts
    const speakerIds = new Set<string>()
    for (const transcript of transcripts) {
      if (transcript.speaker_id) {
        speakerIds.add(transcript.speaker_id)
      }
    }

    // Calculate total file size
    let totalFileSizeBytes = 0
    const filePaths: string[] = []

    // Add meeting audio file
    if (meeting.audio_file_path) {
      const size = getFileSize(meeting.audio_file_path)
      totalFileSizeBytes += size
      filePaths.push(meeting.audio_file_path)
    }

    // Add recording files
    for (const recording of recordings) {
      if (recording.file_path) {
        const size = getFileSize(recording.file_path)
        totalFileSizeBytes += size
        filePaths.push(recording.file_path)
      }
    }

    // Estimate cleanup time (rough estimate: 10ms per item + 100ms per file)
    const estimatedCleanupTime =
      (recordings.length + transcripts.length + notes.length + tasks.length) * 10 +
      filePaths.length * 100

    return {
      meetingId,
      meetingTitle: meeting.title,
      recordingsCount: recordings.length,
      transcriptsCount: transcripts.length,
      notesCount: notes.length,
      tasksCount: tasks.length,
      tasksByStatus,
      hasInProgressTasks,
      hasPendingTasks,
      speakersCount: speakerIds.size,
      totalFileSizeBytes,
      filePaths,
      estimatedCleanupTime
    }
  },

  /**
   * Delete a meeting and all associated data
   */
  deleteMeeting(meetingId: string, options: DeletionOptions = {}): DeletionResult {
    const opts = { ...DEFAULT_OPTIONS, ...options }
    const stmts = getStatements()

    const result: DeletionResult = {
      success: false,
      meetingId,
      deletedRecordings: 0,
      deletedTranscripts: 0,
      deletedNotes: 0,
      deletedTasks: 0,
      deletedSpeakers: 0,
      deletedFiles: 0,
      failedFileDeletions: [],
      freedSpaceBytes: 0,
      auditLogId: ''
    }

    try {
      const meeting = meetingService.getById(meetingId)
      if (!meeting) {
        result.error = 'Meeting not found'
        return result
      }

      // Get associated data for logging
      const recordings = recordingService.getByMeetingId(meetingId)
      const transcripts = transcriptService.getByMeetingId(meetingId)
      const notes = meetingNoteService.getByMeetingId(meetingId)
      const tasks = taskService.getByMeetingId(meetingId)

      // Soft delete if requested
      if (opts.softDelete) {
        const expiresAt = new Date()
        expiresAt.setDate(expiresAt.getDate() + (opts.softDeleteDays || 30))

        // Serialize all meeting data
        const originalData = JSON.stringify({
          meeting,
          recordings,
          transcripts,
          notes,
          tasks
        })

        stmts.insertSoftDelete.run({
          id: randomUUID(),
          meeting_id: meetingId,
          original_data: originalData,
          expires_at: expiresAt.toISOString(),
          deleted_by: opts.performedBy || 'system'
        })

        if (opts.auditLog) {
          result.auditLogId = createAuditLog(
            meetingId,
            'soft_delete',
            `Soft deleted meeting "${meeting.title}" with ${recordings.length} recordings, ${transcripts.length} transcripts, ${notes.length} notes, ${tasks.length} tasks. Expires at ${expiresAt.toISOString()}`,
            opts.performedBy || 'system'
          )
        }
      }

      // Delete files if requested
      if (opts.deleteFiles) {
        // Delete meeting audio file
        if (meeting.audio_file_path) {
          const size = getFileSize(meeting.audio_file_path)
          const deleteResult = deleteFileSafe(meeting.audio_file_path)
          if (deleteResult.success) {
            result.deletedFiles++
            result.freedSpaceBytes += size
          } else {
            result.failedFileDeletions.push(meeting.audio_file_path)
          }
        }

        // Delete recording files
        for (const recording of recordings) {
          if (recording.file_path) {
            const size = getFileSize(recording.file_path)
            const deleteResult = deleteFileSafe(recording.file_path)
            if (deleteResult.success) {
              result.deletedFiles++
              result.freedSpaceBytes += size
            } else {
              result.failedFileDeletions.push(recording.file_path)
            }
          }
        }

        // Try to delete the meeting folder if it exists
        if (meeting.audio_file_path) {
          const meetingDir = path.dirname(meeting.audio_file_path)
          // Only delete if it looks like a meeting-specific folder
          if (meetingDir.includes(meetingId) || path.basename(meetingDir).match(/^\d{4}-\d{2}-\d{2}/)) {
            deleteDirectorySafe(meetingDir)
          }
        }
      }

      // Handle tasks based on the specified action
      const taskHandling = opts.taskHandling || (opts.deleteTasks ? 'delete' : 'unlink')

      // Handle cancel action
      if (taskHandling === 'cancel') {
        result.error = 'Deletion cancelled by user'
        return result
      }

      // Auto-unlink completed tasks if enabled
      let tasksToHandle = tasks
      if (opts.autoUnlinkCompleted && taskHandling !== 'delete') {
        const completedTasks = tasks.filter(t => t.status === 'completed')
        for (const task of completedTasks) {
          taskService.update(task.id, { meeting_id: null })
        }
        // Only handle non-completed tasks
        tasksToHandle = tasks.filter(t => t.status !== 'completed')
      }

      // Apply the task handling action
      if (taskHandling === 'delete') {
        // Delete all tasks
        for (const task of tasksToHandle) {
          taskService.delete(task.id)
          result.deletedTasks++
        }
      } else if (taskHandling === 'reassign') {
        // Reassign tasks to another meeting
        if (!opts.reassignToMeetingId) {
          result.error = 'Reassignment target meeting ID is required'
          return result
        }

        // Validate target meeting exists
        const targetMeeting = meetingService.getById(opts.reassignToMeetingId)
        if (!targetMeeting) {
          result.error = 'Target meeting not found for reassignment'
          return result
        }

        // Reassign all tasks
        for (const task of tasksToHandle) {
          taskService.update(task.id, { meeting_id: opts.reassignToMeetingId })
        }
      } else if (taskHandling === 'unlink') {
        // Unlink tasks (set meeting_id to NULL)
        for (const task of tasksToHandle) {
          taskService.update(task.id, { meeting_id: null })
        }
      }
      // If taskHandling is 'unlink', tasks will be automatically unlinked by ON DELETE SET NULL

      // The CASCADE DELETE in the schema will handle:
      // - recordings
      // - transcripts
      // - meeting_notes
      // - meeting_speaker_names
      // - confidence_metrics
      // - confidence_trends
      // - transcript_corrections
      // - confidence_adjustments

      // Delete the meeting (CASCADE will handle related records)
      const deleted = meetingService.delete(meetingId)

      if (deleted) {
        result.success = true
        result.deletedRecordings = recordings.length
        result.deletedTranscripts = transcripts.length
        result.deletedNotes = notes.length

        if (opts.auditLog && !opts.softDelete) {
          result.auditLogId = createAuditLog(
            meetingId,
            'delete',
            `Permanently deleted meeting "${meeting.title}" with ${recordings.length} recordings, ${transcripts.length} transcripts, ${notes.length} notes, ${result.deletedTasks} tasks. Freed ${result.freedSpaceBytes} bytes.`,
            opts.performedBy || 'system'
          )
        }
      } else {
        result.error = 'Failed to delete meeting from database'
      }

    } catch (error) {
      result.error = error instanceof Error ? error.message : 'Unknown error'
    }

    return result
  },

  /**
   * Delete multiple meetings at once
   */
  deleteMeetingsBatch(meetingIds: string[], options: DeletionOptions = {}): BatchDeletionResult {
    const results: DeletionResult[] = []
    let totalFreedSpaceBytes = 0
    const errors: string[] = []

    for (const meetingId of meetingIds) {
      const result = meetingDeletionService.deleteMeeting(meetingId, options)
      results.push(result)

      if (result.success) {
        totalFreedSpaceBytes += result.freedSpaceBytes
      } else if (result.error) {
        errors.push(`${meetingId}: ${result.error}`)
      }
    }

    const deletedMeetings = results.filter(r => r.success).length
    const failedMeetings = results.filter(r => !r.success).length

    return {
      success: failedMeetings === 0,
      totalMeetings: meetingIds.length,
      deletedMeetings,
      failedMeetings,
      results,
      totalFreedSpaceBytes,
      errors
    }
  },

  /**
   * Archive a meeting instead of deleting it
   */
  archiveMeeting(meetingId: string, archivePath?: string): ArchiveResult {
    const stmts = getStatements()

    try {
      const meeting = meetingService.getById(meetingId)
      if (!meeting) {
        return { success: false, meetingId, archivePath: '', archivedAt: '', error: 'Meeting not found' }
      }

      // Get all associated data
      const recordings = recordingService.getByMeetingId(meetingId)
      const transcripts = transcriptService.getByMeetingId(meetingId)
      const notes = meetingNoteService.getByMeetingId(meetingId)
      const tasks = taskService.getByMeetingId(meetingId)

      // Serialize all meeting data
      const originalData = JSON.stringify({
        meeting,
        recordings,
        transcripts,
        notes,
        tasks
      })

      const archivedAt = new Date().toISOString()

      stmts.insertArchive.run({
        id: randomUUID(),
        meeting_id: meetingId,
        original_data: originalData,
        archive_path: archivePath || null,
        archived_by: 'system'
      })

      // Update meeting status to 'cancelled' to indicate it's archived
      meetingService.update(meetingId, { status: 'cancelled' })

      createAuditLog(
        meetingId,
        'archive',
        `Archived meeting "${meeting.title}" with ${recordings.length} recordings, ${transcripts.length} transcripts, ${notes.length} notes, ${tasks.length} tasks`,
        'system'
      )

      return {
        success: true,
        meetingId,
        archivePath: archivePath || '',
        archivedAt
      }
    } catch (error) {
      return {
        success: false,
        meetingId,
        archivePath: '',
        archivedAt: '',
        error: error instanceof Error ? error.message : 'Unknown error'
      }
    }
  },

  /**
   * Restore a soft-deleted meeting
   */
  restoreSoftDeletedMeeting(meetingId: string): RestoreResult {
    const stmts = getStatements()
    const db = getDatabaseService().getDatabase()

    try {
      const softDeleted = stmts.getSoftDeletedById.get(meetingId) as SoftDeletedMeeting | undefined

      if (!softDeleted) {
        return { success: false, meetingId, restoredAt: '', error: 'Soft-deleted meeting not found' }
      }

      // Parse the original data
      const originalData = JSON.parse(softDeleted.original_data)
      const { meeting, recordings, transcripts, notes, tasks } = originalData

      // Use a transaction to restore all data
      const restore = db.transaction(() => {
        // Restore meeting
        const insertMeeting = db.prepare(`
          INSERT INTO meetings (id, title, description, meeting_type, start_time, end_time, duration_seconds, status, audio_file_path, created_at, updated_at)
          VALUES (@id, @title, @description, @meeting_type, @start_time, @end_time, @duration_seconds, @status, @audio_file_path, @created_at, @updated_at)
        `)
        insertMeeting.run({
          ...meeting,
          status: meeting.status === 'cancelled' ? 'completed' : meeting.status
        })

        // Restore recordings
        const insertRecording = db.prepare(`
          INSERT INTO recordings (id, meeting_id, file_path, duration_seconds, file_size_bytes, start_time, end_time, created_at)
          VALUES (@id, @meeting_id, @file_path, @duration_seconds, @file_size_bytes, @start_time, @end_time, @created_at)
        `)
        for (const recording of recordings) {
          insertRecording.run(recording)
        }

        // Restore transcripts
        const insertTranscript = db.prepare(`
          INSERT INTO transcripts (id, meeting_id, speaker_id, content, start_time_ms, end_time_ms, confidence, is_final, created_at)
          VALUES (@id, @meeting_id, @speaker_id, @content, @start_time_ms, @end_time_ms, @confidence, @is_final, @created_at)
        `)
        for (const transcript of transcripts) {
          insertTranscript.run(transcript)
        }

        // Restore notes
        const insertNote = db.prepare(`
          INSERT INTO meeting_notes (id, meeting_id, content, note_type, is_ai_generated, source_transcript_ids, created_at, updated_at)
          VALUES (@id, @meeting_id, @content, @note_type, @is_ai_generated, @source_transcript_ids, @created_at, @updated_at)
        `)
        for (const note of notes) {
          insertNote.run(note)
        }

        // Restore tasks
        const insertTask = db.prepare(`
          INSERT INTO tasks (id, meeting_id, title, description, assignee, due_date, priority, status, created_at, updated_at, completed_at)
          VALUES (@id, @meeting_id, @title, @description, @assignee, @due_date, @priority, @status, @created_at, @updated_at, @completed_at)
        `)
        for (const task of tasks) {
          insertTask.run(task)
        }

        // Remove from soft delete table
        stmts.deleteSoftDelete.run(meetingId)
      })

      restore()

      const restoredAt = new Date().toISOString()

      createAuditLog(
        meetingId,
        'restore',
        `Restored meeting "${meeting.title}" from soft delete`,
        'system'
      )

      return {
        success: true,
        meetingId,
        restoredAt
      }
    } catch (error) {
      return {
        success: false,
        meetingId,
        restoredAt: '',
        error: error instanceof Error ? error.message : 'Unknown error'
      }
    }
  },

  /**
   * Get all soft-deleted meetings
   */
  getSoftDeletedMeetings(): SoftDeletedMeeting[] {
    const stmts = getStatements()
    return stmts.getSoftDeleted.all() as SoftDeletedMeeting[]
  },

  /**
   * Get all archived meetings
   */
  getArchivedMeetings(): Array<{ id: string; meeting_id: string; original_data: string; archive_path: string; archived_at: string }> {
    const stmts = getStatements()
    return stmts.getArchivedMeetings.all() as any[]
  },

  /**
   * Permanently delete expired soft-deleted meetings
   */
  cleanupExpiredSoftDeletes(): number {
    const stmts = getStatements()
    const expired = stmts.getExpiredSoftDeletes.all() as SoftDeletedMeeting[]

    let cleaned = 0
    for (const item of expired) {
      stmts.deleteSoftDelete.run(item.meeting_id)
      createAuditLog(
        item.meeting_id,
        'permanent_delete',
        `Permanently deleted expired soft-deleted meeting after ${new Date(item.expires_at).toISOString()}`,
        'system'
      )
      cleaned++
    }

    return cleaned
  },

  /**
   * Get audit logs
   */
  getAuditLogs(limit: number = 100): AuditLogEntry[] {
    const stmts = getStatements()
    return stmts.getAuditLogs.all(limit) as AuditLogEntry[]
  },

  /**
   * Get audit logs for a specific meeting
   */
  getAuditLogsForMeeting(meetingId: string): AuditLogEntry[] {
    const stmts = getStatements()
    return stmts.getAuditLogsByMeetingId.all(meetingId) as AuditLogEntry[]
  },

  /**
   * Reassign all tasks from one meeting to another
   */
  reassignTasks(fromMeetingId: string, toMeetingId: string): {
    success: boolean
    reassignedCount: number
    error?: string
  } {
    try {
      // Validate source meeting exists
      const sourceMeeting = meetingService.getById(fromMeetingId)
      if (!sourceMeeting) {
        return { success: false, reassignedCount: 0, error: 'Source meeting not found' }
      }

      // Validate target meeting exists
      const targetMeeting = meetingService.getById(toMeetingId)
      if (!targetMeeting) {
        return { success: false, reassignedCount: 0, error: 'Target meeting not found' }
      }

      // Get all tasks for the source meeting
      const tasks = taskService.getByMeetingId(fromMeetingId)

      // Reassign each task
      let reassignedCount = 0
      for (const task of tasks) {
        const updated = taskService.update(task.id, { meeting_id: toMeetingId })
        if (updated) {
          reassignedCount++
        }
      }

      return { success: true, reassignedCount }
    } catch (error) {
      return {
        success: false,
        reassignedCount: 0,
        error: error instanceof Error ? error.message : 'Unknown error'
      }
    }
  },

  /**
   * Unlink all tasks from a meeting (set meeting_id to NULL)
   */
  unlinkTasksFromMeeting(meetingId: string): {
    success: boolean
    unlinkedCount: number
    error?: string
  } {
    try {
      // Get all tasks for the meeting
      const tasks = taskService.getByMeetingId(meetingId)

      // Unlink each task
      let unlinkedCount = 0
      for (const task of tasks) {
        const updated = taskService.update(task.id, { meeting_id: null })
        if (updated) {
          unlinkedCount++
        }
      }

      return { success: true, unlinkedCount }
    } catch (error) {
      return {
        success: false,
        unlinkedCount: 0,
        error: error instanceof Error ? error.message : 'Unknown error'
      }
    }
  }
}

// Reset statements cache (useful for testing)
export function resetMeetingDeletionStatements(): void {
  statements = null
}
