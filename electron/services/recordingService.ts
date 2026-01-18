/**
 * Recording Service
 *
 * Handles CRUD operations for recordings with prepared statements
 * Uses pathNormalizationService for cross-platform path handling
 */

import { randomUUID } from 'crypto'
import type Database from 'better-sqlite3'
import { getDatabaseService } from './database'
import { pathNormalizationService } from './pathNormalizationService'
import type {
  Recording,
  CreateRecordingInput,
  UpdateRecordingInput
} from '../../src/types/database'

// ============================================================================
// Prepared Statements Cache
// ============================================================================

let statements: {
  insert: Database.Statement
  getById: Database.Statement
  getByMeetingId: Database.Statement
  update: Database.Statement
  delete: Database.Statement
} | null = null

function getStatements() {
  if (statements) return statements

  const db = getDatabaseService().getDatabase()

  statements = {
    insert: db.prepare(`
      INSERT INTO recordings (id, meeting_id, file_path, duration_seconds, file_size_bytes, start_time, end_time, created_at)
      VALUES (@id, @meeting_id, @file_path, @duration_seconds, @file_size_bytes, @start_time, @end_time, datetime('now'))
    `),

    getById: db.prepare(`
      SELECT * FROM recordings WHERE id = ?
    `),

    getByMeetingId: db.prepare(`
      SELECT * FROM recordings WHERE meeting_id = ? ORDER BY start_time ASC
    `),

    update: db.prepare(`
      UPDATE recordings
      SET file_path = COALESCE(@file_path, file_path),
          duration_seconds = COALESCE(@duration_seconds, duration_seconds),
          file_size_bytes = COALESCE(@file_size_bytes, file_size_bytes),
          end_time = COALESCE(@end_time, end_time)
      WHERE id = @id
    `),

    delete: db.prepare(`
      DELETE FROM recordings WHERE id = ?
    `)
  }

  return statements
}

// ============================================================================
// Recording Service Functions
// ============================================================================

export const recordingService = {
  /**
   * Create a new recording
   * Normalizes file_path for cross-platform storage (Unix-style)
   */
  create(input: CreateRecordingInput): Recording {
    const stmts = getStatements()
    const id = input.id || randomUUID()

    // Normalize file path for database storage (Unix-style)
    const normalizedFilePath = input.file_path
      ? pathNormalizationService.normalizeForStorage(input.file_path)
      : null

    const params = {
      id,
      meeting_id: input.meeting_id,
      file_path: normalizedFilePath,
      duration_seconds: input.duration_seconds ?? null,
      file_size_bytes: input.file_size_bytes ?? null,
      start_time: input.start_time,
      end_time: input.end_time ?? null
    }

    stmts.insert.run(params)

    // Return with platform-specific path
    const recording = stmts.getById.get(id) as Recording
    return convertRecordingPaths(recording)
  },

  /**
   * Get a recording by ID
   * Converts stored path to platform-specific format
   */
  getById(id: string): Recording | null {
    const stmts = getStatements()
    const recording = stmts.getById.get(id) as Recording | null
    return recording ? convertRecordingPaths(recording) : null
  },

  /**
   * Get all recordings for a meeting
   * Converts stored paths to platform-specific format
   */
  getByMeetingId(meetingId: string): Recording[] {
    const stmts = getStatements()
    const recordings = stmts.getByMeetingId.all(meetingId) as Recording[]
    return recordings.map(convertRecordingPaths)
  },

  /**
   * Update a recording
   * Normalizes file_path for cross-platform storage
   */
  update(id: string, input: UpdateRecordingInput): Recording | null {
    const stmts = getStatements()

    // Normalize file path for database storage (Unix-style)
    const normalizedFilePath = input.file_path
      ? pathNormalizationService.normalizeForStorage(input.file_path)
      : null

    const params = {
      id,
      file_path: normalizedFilePath,
      duration_seconds: input.duration_seconds ?? null,
      file_size_bytes: input.file_size_bytes ?? null,
      end_time: input.end_time
    }

    const result = stmts.update.run(params)

    if (result.changes === 0) {
      return null
    }

    const recording = stmts.getById.get(id) as Recording
    return convertRecordingPaths(recording)
  },

  /**
   * Delete a recording
   */
  delete(id: string): boolean {
    const stmts = getStatements()
    const result = stmts.delete.run(id)
    return result.changes > 0
  }
}

// Reset statements cache (useful for testing)
export function resetRecordingStatements(): void {
  statements = null
}

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Convert stored Unix-style paths in a Recording to platform-specific paths
 */
function convertRecordingPaths(recording: Recording): Recording {
  if (!recording) return recording

  return {
    ...recording,
    file_path: recording.file_path
      ? pathNormalizationService.toPlatformPath(recording.file_path)
      : recording.file_path
  }
}
