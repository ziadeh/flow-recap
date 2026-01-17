/**
 * Meeting Speaker Name Service
 *
 * Handles CRUD operations for meeting-specific speaker name overrides.
 * This allows users to rename speakers on a per-meeting basis without
 * affecting the speaker names in other meetings.
 */

import { randomUUID } from 'crypto'
import type Database from 'better-sqlite3'
import { getDatabaseService } from './database'
import type {
  MeetingSpeakerName,
  CreateMeetingSpeakerNameInput,
  UpdateMeetingSpeakerNameInput
} from '../../src/types/database'

// ============================================================================
// Prepared Statements Cache
// ============================================================================

let statements: {
  insert: Database.Statement
  getById: Database.Statement
  getByMeetingId: Database.Statement
  getBySpeakerId: Database.Statement
  getByMeetingAndSpeaker: Database.Statement
  update: Database.Statement
  delete: Database.Statement
  deleteByMeetingId: Database.Statement
} | null = null

function getStatements() {
  if (statements) return statements

  const db = getDatabaseService().getDatabase()

  statements = {
    insert: db.prepare(`
      INSERT INTO meeting_speaker_names (id, meeting_id, speaker_id, display_name, created_at, updated_at)
      VALUES (@id, @meeting_id, @speaker_id, @display_name, datetime('now'), datetime('now'))
    `),

    getById: db.prepare(`
      SELECT * FROM meeting_speaker_names WHERE id = ?
    `),

    getByMeetingId: db.prepare(`
      SELECT * FROM meeting_speaker_names WHERE meeting_id = ? ORDER BY display_name ASC
    `),

    getBySpeakerId: db.prepare(`
      SELECT * FROM meeting_speaker_names WHERE speaker_id = ?
    `),

    getByMeetingAndSpeaker: db.prepare(`
      SELECT * FROM meeting_speaker_names WHERE meeting_id = ? AND speaker_id = ?
    `),

    update: db.prepare(`
      UPDATE meeting_speaker_names
      SET display_name = @display_name
      WHERE meeting_id = @meeting_id AND speaker_id = @speaker_id
    `),

    delete: db.prepare(`
      DELETE FROM meeting_speaker_names WHERE meeting_id = ? AND speaker_id = ?
    `),

    deleteByMeetingId: db.prepare(`
      DELETE FROM meeting_speaker_names WHERE meeting_id = ?
    `)
  }

  return statements
}

// ============================================================================
// Meeting Speaker Name Service Functions
// ============================================================================

export const meetingSpeakerNameService = {
  /**
   * Create a new meeting-specific speaker name
   */
  create(input: CreateMeetingSpeakerNameInput): MeetingSpeakerName {
    const stmts = getStatements()
    const id = input.id || randomUUID()

    const params = {
      id,
      meeting_id: input.meeting_id,
      speaker_id: input.speaker_id,
      display_name: input.display_name
    }

    stmts.insert.run(params)

    return stmts.getById.get(id) as MeetingSpeakerName
  },

  /**
   * Get a meeting speaker name by ID
   */
  getById(id: string): MeetingSpeakerName | null {
    const stmts = getStatements()
    return (stmts.getById.get(id) as MeetingSpeakerName) || null
  },

  /**
   * Get all speaker name overrides for a meeting
   */
  getByMeetingId(meetingId: string): MeetingSpeakerName[] {
    const stmts = getStatements()
    return stmts.getByMeetingId.all(meetingId) as MeetingSpeakerName[]
  },

  /**
   * Get all meeting-specific names for a speaker across all meetings
   */
  getBySpeakerId(speakerId: string): MeetingSpeakerName[] {
    const stmts = getStatements()
    return stmts.getBySpeakerId.all(speakerId) as MeetingSpeakerName[]
  },

  /**
   * Get a specific meeting speaker name by meeting and speaker IDs
   */
  getByMeetingAndSpeaker(meetingId: string, speakerId: string): MeetingSpeakerName | null {
    const stmts = getStatements()
    return (stmts.getByMeetingAndSpeaker.get(meetingId, speakerId) as MeetingSpeakerName) || null
  },

  /**
   * Set (create or update) a meeting-specific speaker name
   * This is the main method for renaming speakers in a meeting
   */
  setName(meetingId: string, speakerId: string, displayName: string): MeetingSpeakerName {
    const stmts = getStatements()

    // Check if an entry already exists
    const existing = stmts.getByMeetingAndSpeaker.get(meetingId, speakerId) as MeetingSpeakerName | undefined

    if (existing) {
      // Update existing entry
      stmts.update.run({
        meeting_id: meetingId,
        speaker_id: speakerId,
        display_name: displayName
      })
      return stmts.getByMeetingAndSpeaker.get(meetingId, speakerId) as MeetingSpeakerName
    } else {
      // Create new entry
      return meetingSpeakerNameService.create({
        meeting_id: meetingId,
        speaker_id: speakerId,
        display_name: displayName
      })
    }
  },

  /**
   * Update a meeting speaker name
   */
  update(meetingId: string, speakerId: string, input: UpdateMeetingSpeakerNameInput): MeetingSpeakerName | null {
    const stmts = getStatements()

    const params = {
      meeting_id: meetingId,
      speaker_id: speakerId,
      display_name: input.display_name
    }

    const result = stmts.update.run(params)

    if (result.changes === 0) {
      return null
    }

    return stmts.getByMeetingAndSpeaker.get(meetingId, speakerId) as MeetingSpeakerName
  },

  /**
   * Delete a meeting-specific speaker name
   */
  delete(meetingId: string, speakerId: string): boolean {
    const stmts = getStatements()
    const result = stmts.delete.run(meetingId, speakerId)
    return result.changes > 0
  },

  /**
   * Delete all speaker name overrides for a meeting
   */
  deleteByMeetingId(meetingId: string): number {
    const stmts = getStatements()
    const result = stmts.deleteByMeetingId.run(meetingId)
    return result.changes
  },

  /**
   * Get the display name for a speaker in a specific meeting
   * Returns the meeting-specific name if set, otherwise null (caller should fall back to global speaker name)
   */
  getDisplayName(meetingId: string, speakerId: string): string | null {
    const entry = meetingSpeakerNameService.getByMeetingAndSpeaker(meetingId, speakerId)
    return entry?.display_name || null
  },

  /**
   * Get a map of speaker IDs to display names for a meeting
   * Useful for bulk lookups when displaying transcript
   */
  getDisplayNameMap(meetingId: string): Map<string, string> {
    const entries = meetingSpeakerNameService.getByMeetingId(meetingId)
    const map = new Map<string, string>()
    for (const entry of entries) {
      map.set(entry.speaker_id, entry.display_name)
    }
    return map
  }
}

// Reset statements cache (useful for testing)
export function resetMeetingSpeakerNameStatements(): void {
  statements = null
}
