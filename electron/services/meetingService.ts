/**
 * Meeting Service
 *
 * Handles CRUD operations for meetings with prepared statements
 */

import { randomUUID } from 'crypto'
import type Database from 'better-sqlite3'
import { getDatabaseService } from './database'
import type {
  Meeting,
  MeetingStatus,
  CreateMeetingInput,
  UpdateMeetingInput
} from '../../src/types/database'

// ============================================================================
// Prepared Statements Cache
// ============================================================================

let statements: {
  insert: Database.Statement
  getById: Database.Statement
  getAll: Database.Statement
  update: Database.Statement
  delete: Database.Statement
  getByStatus: Database.Statement
  getRecent: Database.Statement
} | null = null

function getStatements() {
  if (statements) return statements

  const db = getDatabaseService().getDatabase()

  statements = {
    insert: db.prepare(`
      INSERT INTO meetings (id, title, description, meeting_type, start_time, end_time, status, audio_file_path, created_at, updated_at)
      VALUES (@id, @title, @description, @meeting_type, @start_time, @end_time, @status, @audio_file_path, datetime('now'), datetime('now'))
    `),

    getById: db.prepare(`
      SELECT * FROM meetings WHERE id = ?
    `),

    getAll: db.prepare(`
      SELECT * FROM meetings ORDER BY start_time DESC
    `),

    update: db.prepare(`
      UPDATE meetings
      SET title = COALESCE(@title, title),
          description = COALESCE(@description, description),
          meeting_type = COALESCE(@meeting_type, meeting_type),
          start_time = COALESCE(@start_time, start_time),
          end_time = COALESCE(@end_time, end_time),
          duration_seconds = COALESCE(@duration_seconds, duration_seconds),
          status = COALESCE(@status, status),
          audio_file_path = COALESCE(@audio_file_path, audio_file_path)
      WHERE id = @id
    `),

    delete: db.prepare(`
      DELETE FROM meetings WHERE id = ?
    `),

    getByStatus: db.prepare(`
      SELECT * FROM meetings WHERE status = ? ORDER BY start_time DESC
    `),

    getRecent: db.prepare(`
      SELECT * FROM meetings ORDER BY created_at DESC LIMIT ?
    `)
  }

  return statements
}

// ============================================================================
// Meeting Service Functions
// ============================================================================

export const meetingService = {
  /**
   * Create a new meeting
   */
  create(input: CreateMeetingInput): Meeting {
    const stmts = getStatements()
    const id = input.id || randomUUID()

    const params = {
      id,
      title: input.title,
      description: input.description ?? null,
      meeting_type: input.meeting_type ?? 'other',
      start_time: input.start_time,
      end_time: input.end_time ?? null,
      status: input.status ?? 'scheduled',
      audio_file_path: input.audio_file_path ?? null
    }

    stmts.insert.run(params)

    return stmts.getById.get(id) as Meeting
  },

  /**
   * Get a meeting by ID
   */
  getById(id: string): Meeting | null {
    const stmts = getStatements()
    return (stmts.getById.get(id) as Meeting) || null
  },

  /**
   * Get all meetings
   */
  getAll(): Meeting[] {
    const stmts = getStatements()
    return stmts.getAll.all() as Meeting[]
  },

  /**
   * Update a meeting
   */
  update(id: string, input: UpdateMeetingInput): Meeting | null {
    const stmts = getStatements()

    const params = {
      id,
      title: input.title ?? null,
      description: input.description,
      meeting_type: input.meeting_type ?? null,
      start_time: input.start_time ?? null,
      end_time: input.end_time,
      duration_seconds: input.duration_seconds ?? null,
      status: input.status ?? null,
      audio_file_path: input.audio_file_path
    }

    const result = stmts.update.run(params)

    if (result.changes === 0) {
      return null
    }

    return stmts.getById.get(id) as Meeting
  },

  /**
   * Delete a meeting
   */
  delete(id: string): boolean {
    const stmts = getStatements()
    const result = stmts.delete.run(id)
    return result.changes > 0
  },

  /**
   * Get meetings by status
   */
  getByStatus(status: MeetingStatus): Meeting[] {
    const stmts = getStatements()
    return stmts.getByStatus.all(status) as Meeting[]
  },

  /**
   * Get recent meetings
   */
  getRecent(limit: number = 10): Meeting[] {
    const stmts = getStatements()
    return stmts.getRecent.all(limit) as Meeting[]
  }
}

// Reset statements cache (useful for testing)
export function resetMeetingStatements(): void {
  statements = null
}
