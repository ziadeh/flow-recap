/**
 * Speaker Service
 *
 * Handles CRUD operations for speakers with prepared statements
 */

import { randomUUID } from 'crypto'
import type Database from 'better-sqlite3'
import { getDatabaseService } from './database'
import type {
  Speaker,
  CreateSpeakerInput,
  UpdateSpeakerInput
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
  getByEmail: Database.Statement
  getUser: Database.Statement
  searchByName: Database.Statement
} | null = null

function getStatements() {
  if (statements) return statements

  const db = getDatabaseService().getDatabase()

  statements = {
    insert: db.prepare(`
      INSERT INTO speakers (id, name, email, voice_profile_path, is_user, created_at, updated_at)
      VALUES (@id, @name, @email, @voice_profile_path, @is_user, datetime('now'), datetime('now'))
    `),

    getById: db.prepare(`
      SELECT * FROM speakers WHERE id = ?
    `),

    getAll: db.prepare(`
      SELECT * FROM speakers ORDER BY is_user DESC, name ASC
    `),

    update: db.prepare(`
      UPDATE speakers
      SET name = COALESCE(@name, name),
          email = COALESCE(@email, email),
          voice_profile_path = COALESCE(@voice_profile_path, voice_profile_path),
          is_user = COALESCE(@is_user, is_user)
      WHERE id = @id
    `),

    delete: db.prepare(`
      DELETE FROM speakers WHERE id = ?
    `),

    getByEmail: db.prepare(`
      SELECT * FROM speakers WHERE email = ?
    `),

    getUser: db.prepare(`
      SELECT * FROM speakers WHERE is_user = 1 LIMIT 1
    `),

    searchByName: db.prepare(`
      SELECT * FROM speakers WHERE name LIKE ? ORDER BY is_user DESC, name ASC
    `)
  }

  return statements
}

/**
 * Create a prepared statement for getting multiple speakers by IDs
 * This is done dynamically because the number of IDs varies
 */
function getByIdsStatement(count: number) {
  const db = getDatabaseService().getDatabase()
  const placeholders = Array(count).fill('?').join(', ')
  return db.prepare(`SELECT * FROM speakers WHERE id IN (${placeholders}) ORDER BY is_user DESC, name ASC`)
}

// ============================================================================
// Speaker Service Functions
// ============================================================================

export const speakerService = {
  /**
   * Create a new speaker
   */
  create(input: CreateSpeakerInput): Speaker {
    const stmts = getStatements()
    const id = input.id || randomUUID()

    const params = {
      id,
      name: input.name,
      email: input.email ?? null,
      voice_profile_path: input.voice_profile_path ?? null,
      is_user: input.is_user ? 1 : 0
    }

    stmts.insert.run(params)

    return stmts.getById.get(id) as Speaker
  },

  /**
   * Get a speaker by ID
   */
  getById(id: string): Speaker | null {
    const stmts = getStatements()
    return (stmts.getById.get(id) as Speaker) || null
  },

  /**
   * Get all speakers
   */
  getAll(): Speaker[] {
    const stmts = getStatements()
    return stmts.getAll.all() as Speaker[]
  },

  /**
   * Get speakers by IDs (efficient batch fetch)
   * More efficient than calling getById for each speaker
   */
  getByIds(ids: string[]): Speaker[] {
    if (ids.length === 0) return []
    const stmt = getByIdsStatement(ids.length)
    return stmt.all(...ids) as Speaker[]
  },

  /**
   * Get speakers for a specific meeting
   * More efficient than getAll when you only need speakers for one meeting
   */
  getByMeetingId(meetingId: string): Speaker[] {
    const db = getDatabaseService().getDatabase()
    return db.prepare(`
      SELECT DISTINCT s.*
      FROM speakers s
      INNER JOIN transcripts t ON s.id = t.speaker_id
      WHERE t.meeting_id = ?
      ORDER BY s.is_user DESC, s.name ASC
    `).all(meetingId) as Speaker[]
  },

  /**
   * Update a speaker
   */
  update(id: string, input: UpdateSpeakerInput): Speaker | null {
    const stmts = getStatements()

    const params = {
      id,
      name: input.name ?? null,
      email: input.email,
      voice_profile_path: input.voice_profile_path,
      is_user: input.is_user !== undefined ? (input.is_user ? 1 : 0) : null
    }

    const result = stmts.update.run(params)

    if (result.changes === 0) {
      return null
    }

    return stmts.getById.get(id) as Speaker
  },

  /**
   * Delete a speaker
   */
  delete(id: string): boolean {
    const stmts = getStatements()
    const result = stmts.delete.run(id)
    return result.changes > 0
  },

  /**
   * Get a speaker by email
   */
  getByEmail(email: string): Speaker | null {
    const stmts = getStatements()
    return (stmts.getByEmail.get(email) as Speaker) || null
  },

  /**
   * Get the current user speaker
   */
  getUser(): Speaker | null {
    const stmts = getStatements()
    return (stmts.getUser.get() as Speaker) || null
  },

  /**
   * Search speakers by name (partial match)
   */
  searchByName(query: string): Speaker[] {
    const stmts = getStatements()
    return stmts.searchByName.all(`%${query}%`) as Speaker[]
  },

  /**
   * Set a speaker as the current user
   */
  setAsUser(id: string): Speaker | null {
    const db = getDatabaseService().getDatabase()

    // Use transaction to ensure only one user
    const setUser = db.transaction(() => {
      // Clear existing user flag
      db.prepare('UPDATE speakers SET is_user = 0 WHERE is_user = 1').run()

      // Set new user
      db.prepare('UPDATE speakers SET is_user = 1 WHERE id = ?').run(id)
    })

    setUser()

    return speakerService.getById(id)
  },

  /**
   * Get or create a speaker by name
   */
  getOrCreate(name: string, email?: string): Speaker {
    // Try to find by email first
    if (email) {
      const existing = speakerService.getByEmail(email)
      if (existing) return existing
    }

    // Search by exact name match
    const db = getDatabaseService().getDatabase()
    const existing = db.prepare('SELECT * FROM speakers WHERE name = ?').get(name) as Speaker | undefined

    if (existing) return existing

    // Create new speaker
    return speakerService.create({ name, email })
  },

  /**
   * Create speakers from diarization labels (Speaker_0, Speaker_1, etc.)
   * Returns a map from label to Speaker record
   */
  createFromDiarizationLabels(labels: string[], namePrefix?: string): Map<string, Speaker> {
    const speakerMap = new Map<string, Speaker>()

    for (const label of labels) {
      const name = namePrefix ? `${namePrefix} ${label}` : label
      const speaker = speakerService.getOrCreate(name)
      speakerMap.set(label, speaker)
    }

    return speakerMap
  },

  /**
   * Get all speakers that were created from diarization (have Speaker_ prefix in name)
   */
  getDiarizationSpeakers(): Speaker[] {
    const db = getDatabaseService().getDatabase()
    return db.prepare(
      "SELECT * FROM speakers WHERE name LIKE 'Speaker_%' ORDER BY name ASC"
    ).all() as Speaker[]
  },

  /**
   * Merge two speakers (for when user identifies that two diarization speakers are the same person)
   * Keeps the target speaker and updates all references from source to target
   */
  mergeSpeakers(sourceId: string, targetId: string): boolean {
    const db = getDatabaseService().getDatabase()

    const merge = db.transaction(() => {
      // Update all transcripts to point to target speaker
      db.prepare('UPDATE transcripts SET speaker_id = ? WHERE speaker_id = ?').run(targetId, sourceId)

      // Delete the source speaker
      db.prepare('DELETE FROM speakers WHERE id = ?').run(sourceId)
    })

    try {
      merge()
      return true
    } catch {
      return false
    }
  },

  /**
   * Rename a diarization speaker to a real name
   */
  renameDiarizationSpeaker(id: string, newName: string): Speaker | null {
    return speakerService.update(id, { name: newName })
  },

  /**
   * Clear all speakers for a specific meeting
   * This removes all speaker assignments and deletes the speaker records
   * The foreign key constraint ON DELETE SET NULL will automatically set speaker_id to NULL in transcripts
   */
  clearSpeakersForMeeting(meetingId: string): { success: boolean; deletedCount: number; error?: string } {
    const db = getDatabaseService().getDatabase()

    const clearSpeakers = db.transaction(() => {
      // Get all unique speaker IDs from transcripts for this meeting
      const transcripts = db.prepare(
        'SELECT DISTINCT speaker_id FROM transcripts WHERE meeting_id = ? AND speaker_id IS NOT NULL'
      ).all(meetingId) as Array<{ speaker_id: string }>

      const speakerIds = transcripts.map(t => t.speaker_id)

      if (speakerIds.length === 0) {
        return { deletedCount: 0 }
      }

      // Delete speakers (foreign key constraint will set speaker_id to NULL automatically)
      const deleteSpeaker = db.prepare('DELETE FROM speakers WHERE id = ?')
      let deletedCount = 0

      for (const speakerId of speakerIds) {
        const result = deleteSpeaker.run(speakerId)
        deletedCount += result.changes
      }

      return { deletedCount }
    })

    try {
      const result = clearSpeakers()
      return { success: true, deletedCount: result.deletedCount }
    } catch (error) {
      console.error('[SpeakerService] Failed to clear speakers:', error)
      return { success: false, deletedCount: 0, error: (error as Error).message }
    }
  }
}

// Reset statements cache (useful for testing)
export function resetSpeakerStatements(): void {
  statements = null
}
