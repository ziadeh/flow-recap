/**
 * Recording Service
 *
 * Handles CRUD operations for recordings with prepared statements
 */

import { randomUUID } from 'crypto'
import type Database from 'better-sqlite3'
import { getDatabaseService } from './database'
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
   */
  create(input: CreateRecordingInput): Recording {
    const stmts = getStatements()
    const id = input.id || randomUUID()

    const params = {
      id,
      meeting_id: input.meeting_id,
      file_path: input.file_path,
      duration_seconds: input.duration_seconds ?? null,
      file_size_bytes: input.file_size_bytes ?? null,
      start_time: input.start_time,
      end_time: input.end_time ?? null
    }

    stmts.insert.run(params)

    return stmts.getById.get(id) as Recording
  },

  /**
   * Get a recording by ID
   */
  getById(id: string): Recording | null {
    const stmts = getStatements()
    return (stmts.getById.get(id) as Recording) || null
  },

  /**
   * Get all recordings for a meeting
   */
  getByMeetingId(meetingId: string): Recording[] {
    const stmts = getStatements()
    return stmts.getByMeetingId.all(meetingId) as Recording[]
  },

  /**
   * Update a recording
   */
  update(id: string, input: UpdateRecordingInput): Recording | null {
    const stmts = getStatements()

    const params = {
      id,
      file_path: input.file_path ?? null,
      duration_seconds: input.duration_seconds ?? null,
      file_size_bytes: input.file_size_bytes ?? null,
      end_time: input.end_time
    }

    const result = stmts.update.run(params)

    if (result.changes === 0) {
      return null
    }

    return stmts.getById.get(id) as Recording
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
