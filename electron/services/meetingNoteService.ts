/**
 * Meeting Note Service
 *
 * Handles CRUD operations for meeting notes with prepared statements
 */

import { randomUUID } from 'crypto'
import type Database from 'better-sqlite3'
import { getDatabaseService } from './database'
import type {
  MeetingNote,
  NoteType,
  CreateMeetingNoteInput,
  UpdateMeetingNoteInput
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
  getByType: Database.Statement
  getAIGenerated: Database.Statement
} | null = null

function getStatements() {
  if (statements) return statements

  const db = getDatabaseService().getDatabase()

  statements = {
    insert: db.prepare(`
      INSERT INTO meeting_notes (
        id, meeting_id, content, note_type, is_ai_generated, source_transcript_ids,
        created_during_recording, generation_timestamp, context, confidence_score,
        speaker_id, start_time_ms, end_time_ms, keywords, created_at, updated_at
      )
      VALUES (
        @id, @meeting_id, @content, @note_type, @is_ai_generated, @source_transcript_ids,
        @created_during_recording, @generation_timestamp, @context, @confidence_score,
        @speaker_id, @start_time_ms, @end_time_ms, @keywords, datetime('now'), datetime('now')
      )
    `),

    getById: db.prepare(`
      SELECT * FROM meeting_notes WHERE id = ?
    `),

    getByMeetingId: db.prepare(`
      SELECT * FROM meeting_notes WHERE meeting_id = ? ORDER BY created_at DESC
    `),

    update: db.prepare(`
      UPDATE meeting_notes
      SET content = COALESCE(@content, content),
          note_type = COALESCE(@note_type, note_type),
          source_transcript_ids = COALESCE(@source_transcript_ids, source_transcript_ids)
      WHERE id = @id
    `),

    delete: db.prepare(`
      DELETE FROM meeting_notes WHERE id = ?
    `),

    getByType: db.prepare(`
      SELECT * FROM meeting_notes WHERE meeting_id = ? AND note_type = ? ORDER BY created_at DESC
    `),

    getAIGenerated: db.prepare(`
      SELECT * FROM meeting_notes WHERE meeting_id = ? AND is_ai_generated = 1 ORDER BY created_at DESC
    `)
  }

  return statements
}

// ============================================================================
// Meeting Note Service Functions
// ============================================================================

export const meetingNoteService = {
  /**
   * Create a new meeting note
   */
  create(input: CreateMeetingNoteInput): MeetingNote {
    const stmts = getStatements()
    const id = input.id || randomUUID()

    const params = {
      id,
      meeting_id: input.meeting_id,
      content: input.content,
      note_type: input.note_type,
      is_ai_generated: input.is_ai_generated ? 1 : 0,
      source_transcript_ids: input.source_transcript_ids
        ? JSON.stringify(input.source_transcript_ids)
        : null,
      created_during_recording: input.created_during_recording ? 1 : 0,
      generation_timestamp: input.generation_timestamp ?? null,
      context: input.context ?? null,
      confidence_score: input.confidence_score ?? null,
      speaker_id: input.speaker_id ?? null,
      start_time_ms: input.start_time_ms ?? null,
      end_time_ms: input.end_time_ms ?? null,
      keywords: input.keywords ? JSON.stringify(input.keywords) : null
    }

    stmts.insert.run(params)

    return stmts.getById.get(id) as MeetingNote
  },

  /**
   * Create multiple meeting notes in a single transaction (batch insert)
   */
  createBatch(inputs: CreateMeetingNoteInput[]): MeetingNote[] {
    const dbService = getDatabaseService()
    const stmts = getStatements()
    const results: MeetingNote[] = []

    const createAll = dbService.getDatabase().transaction(() => {
      for (const input of inputs) {
        const id = input.id || randomUUID()

        const params = {
          id,
          meeting_id: input.meeting_id,
          content: input.content,
          note_type: input.note_type,
          is_ai_generated: input.is_ai_generated ? 1 : 0,
          source_transcript_ids: input.source_transcript_ids
            ? JSON.stringify(input.source_transcript_ids)
            : null,
          created_during_recording: input.created_during_recording ? 1 : 0,
          generation_timestamp: input.generation_timestamp ?? null,
          context: input.context ?? null,
          confidence_score: input.confidence_score ?? null,
          speaker_id: input.speaker_id ?? null,
          start_time_ms: input.start_time_ms ?? null,
          end_time_ms: input.end_time_ms ?? null,
          keywords: input.keywords ? JSON.stringify(input.keywords) : null
        }

        stmts.insert.run(params)
        const note = stmts.getById.get(id) as MeetingNote
        results.push(note)
      }
    })

    createAll()
    return results
  },

  /**
   * Get a meeting note by ID
   */
  getById(id: string): MeetingNote | null {
    const stmts = getStatements()
    return (stmts.getById.get(id) as MeetingNote) || null
  },

  /**
   * Get all notes for a meeting
   */
  getByMeetingId(meetingId: string): MeetingNote[] {
    const stmts = getStatements()
    return stmts.getByMeetingId.all(meetingId) as MeetingNote[]
  },

  /**
   * Update a meeting note
   */
  update(id: string, input: UpdateMeetingNoteInput): MeetingNote | null {
    const stmts = getStatements()

    const params = {
      id,
      content: input.content ?? null,
      note_type: input.note_type ?? null,
      source_transcript_ids: input.source_transcript_ids
        ? JSON.stringify(input.source_transcript_ids)
        : null
    }

    const result = stmts.update.run(params)

    if (result.changes === 0) {
      return null
    }

    return stmts.getById.get(id) as MeetingNote
  },

  /**
   * Delete a meeting note
   */
  delete(id: string): boolean {
    const stmts = getStatements()
    const result = stmts.delete.run(id)
    return result.changes > 0
  },

  /**
   * Get notes by type for a meeting
   */
  getByType(meetingId: string, noteType: NoteType): MeetingNote[] {
    const stmts = getStatements()
    return stmts.getByType.all(meetingId, noteType) as MeetingNote[]
  },

  /**
   * Get AI-generated notes for a meeting
   */
  getAIGenerated(meetingId: string): MeetingNote[] {
    const stmts = getStatements()
    return stmts.getAIGenerated.all(meetingId) as MeetingNote[]
  },

  /**
   * Get parsed source transcript IDs from a note
   */
  getSourceTranscriptIds(note: MeetingNote): string[] {
    if (!note.source_transcript_ids) return []
    try {
      return JSON.parse(note.source_transcript_ids) as string[]
    } catch {
      return []
    }
  }
}

// Reset statements cache (useful for testing)
export function resetMeetingNoteStatements(): void {
  statements = null
}
