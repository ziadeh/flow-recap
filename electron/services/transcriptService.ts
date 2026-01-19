/**
 * Transcript Service
 *
 * Handles CRUD operations for transcripts with prepared statements.
 *
 * CRITICAL: Speaker identification MUST come from diarization (audio embeddings),
 * never from text analysis. The speaker_id field is now required for all new
 * transcripts to ensure proper speaker attribution.
 *
 * When creating transcripts:
 * 1. Diarization must be performed first to identify speakers
 * 2. Transcription segments must be aligned with diarization segments
 * 3. speaker_id is assigned based on temporal overlap with diarization
 */

import { randomUUID } from 'crypto'
import type Database from 'better-sqlite3'
import { getDatabaseService } from './database'
import type { Transcript, CreateTranscriptInput } from '../../src/types/database'
import type { MandatoryDiarizationSegment } from './diarizationOutputSchema'
import { getTranscriptCompressionService } from './transcriptCompressionService'

// ============================================================================
// Types
// ============================================================================

/**
 * Input for creating a transcript with required speaker attribution
 */
export interface CreateTranscriptWithSpeakerInput extends CreateTranscriptInput {
  /** Speaker ID from diarization - REQUIRED for diarization-first mode */
  speaker_id: string
}

/**
 * Options for creating transcripts
 */
export interface TranscriptCreationOptions {
  /** If true, require speaker_id (diarization-first mode). Default: true */
  requireSpeaker?: boolean
  /** If true, validate diarization data exists for time range. Default: true */
  validateDiarization?: boolean
}

// ============================================================================
// Prepared Statements Cache
// ============================================================================

/**
 * Pagination options for transcript queries
 */
export interface PaginationOptions {
  /** Number of records to fetch (default: all) */
  limit?: number
  /** Number of records to skip (default: 0) */
  offset?: number
}

/**
 * Paginated response type
 */
export interface PaginatedResponse<T> {
  data: T[]
  total: number
  hasMore: boolean
  offset: number
  limit: number
}

let statements: {
  insert: Database.Statement
  getById: Database.Statement
  getByMeetingId: Database.Statement
  getByMeetingIdPaginated: Database.Statement
  getCountByMeetingId: Database.Statement
  delete: Database.Statement
  deleteByMeetingId: Database.Statement
  getBySpeakerId: Database.Statement
  getSpeakerIdsByMeetingId: Database.Statement
} | null = null

function getStatements() {
  if (statements) return statements

  const db = getDatabaseService().getDatabase()

  statements = {
    insert: db.prepare(`
      INSERT INTO transcripts (id, meeting_id, speaker_id, content, start_time_ms, end_time_ms, confidence, is_final, is_compressed, content_uncompressed, filler_map, created_at)
      VALUES (@id, @meeting_id, @speaker_id, @content, @start_time_ms, @end_time_ms, @confidence, @is_final, @is_compressed, @content_uncompressed, @filler_map, datetime('now'))
    `),

    getById: db.prepare(`
      SELECT * FROM transcripts WHERE id = ?
    `),

    getByMeetingId: db.prepare(`
      SELECT * FROM transcripts WHERE meeting_id = ? ORDER BY start_time_ms ASC
    `),

    getByMeetingIdPaginated: db.prepare(`
      SELECT * FROM transcripts WHERE meeting_id = ? ORDER BY start_time_ms ASC LIMIT ? OFFSET ?
    `),

    getCountByMeetingId: db.prepare(`
      SELECT COUNT(*) as count FROM transcripts WHERE meeting_id = ?
    `),

    delete: db.prepare(`
      DELETE FROM transcripts WHERE id = ?
    `),

    deleteByMeetingId: db.prepare(`
      DELETE FROM transcripts WHERE meeting_id = ?
    `),

    getBySpeakerId: db.prepare(`
      SELECT * FROM transcripts WHERE speaker_id = ? ORDER BY start_time_ms ASC
    `),

    getSpeakerIdsByMeetingId: db.prepare(`
      SELECT DISTINCT speaker_id FROM transcripts WHERE meeting_id = ? AND speaker_id IS NOT NULL
    `)
  }

  return statements
}

// ============================================================================
// Decompression Helpers
// ============================================================================

/**
 * Raw transcript row from database before normalization
 * The content field may contain compressed data (Buffer) when is_compressed is 1
 */
interface RawTranscriptRow {
  id: string
  meeting_id: string
  speaker_id: string | null
  content: string | Buffer | number[]  // May be Buffer when compressed
  start_time_ms: number
  end_time_ms: number
  confidence: number
  is_final: number  // SQLite stores as 0/1
  is_compressed: number  // 0 or 1
  content_uncompressed: string | null
  filler_map: string | null
  created_at: string
}

/**
 * Normalize a transcript row from the database
 * Ensures content contains readable text (uses content_uncompressed for compressed transcripts)
 * Converts SQLite integers to booleans
 */
function normalizeTranscript(row: RawTranscriptRow): Transcript {
  // When transcript is compressed, use content_uncompressed for the content field
  // This ensures the UI always receives readable text
  const content = row.is_compressed && row.content_uncompressed
    ? row.content_uncompressed
    : (typeof row.content === 'string' ? row.content : '')

  return {
    id: row.id,
    meeting_id: row.meeting_id,
    speaker_id: row.speaker_id,
    content,
    start_time_ms: row.start_time_ms,
    end_time_ms: row.end_time_ms,
    confidence: row.confidence,
    is_final: row.is_final === 1,
    created_at: row.created_at,
    is_compressed: row.is_compressed === 1,
    content_uncompressed: row.content_uncompressed ?? undefined,
    filler_map: row.filler_map ?? undefined
  }
}

/**
 * Normalize an array of transcript rows
 */
function normalizeTranscripts(rows: RawTranscriptRow[]): Transcript[] {
  return rows.map(normalizeTranscript)
}

// ============================================================================
// Validation Helpers
// ============================================================================

/**
 * Error thrown when trying to create transcript without diarization
 */
export class MissingSpeakerIdError extends Error {
  constructor(message: string = 'Speaker ID is required. Transcription must be aligned with diarization data.') {
    super(message)
    this.name = 'MissingSpeakerIdError'
  }
}

/**
 * Validate that speaker_id is provided when required
 */
function validateSpeakerId(speakerId: string | null | undefined, options: TranscriptCreationOptions): void {
  if (options.requireSpeaker !== false && !speakerId) {
    throw new MissingSpeakerIdError(
      'Transcript creation requires speaker_id. ' +
      'Ensure diarization has been performed and transcription is aligned with speaker segments.'
    )
  }
}

/**
 * Helper function to prepare transcript data with compression
 * Compresses content and prepares all parameters for insertion
 */
async function prepareTranscriptWithCompression(
  id: string,
  input: CreateTranscriptInput
): Promise<{
  id: string
  meeting_id: string
  speaker_id: string | null
  content: Buffer
  start_time_ms: number
  end_time_ms: number
  confidence: number
  is_final: number
  is_compressed: number
  content_uncompressed: string
  filler_map: string | null
}> {
  const compressionService = getTranscriptCompressionService()

  // Store original content
  const originalContent = input.content

  // Deduplicate filler words
  const { content: deduplicated, fillerMap } = compressionService.deduplicateFillerWords(originalContent)

  // Compress the deduplicated content
  const compressedBuffer = await compressionService.compressTranscriptContent(deduplicated)

  return {
    id,
    meeting_id: input.meeting_id,
    speaker_id: input.speaker_id ?? null,
    content: compressedBuffer,
    start_time_ms: input.start_time_ms,
    end_time_ms: input.end_time_ms,
    confidence: input.confidence ?? 1.0,
    is_final: input.is_final !== false ? 1 : 0,
    is_compressed: 1,
    content_uncompressed: originalContent,
    filler_map: fillerMap || null
  }
}

// ============================================================================
// Transcript Service Functions
// ============================================================================

export const transcriptService = {
  /**
   * Create a new transcript segment
   *
   * By default, requires speaker_id to ensure transcription is aligned with
   * diarization data. Use options.requireSpeaker = false for legacy behavior.
   *
   * NOTE: This method is now async to support compression of transcript content.
   *
   * @param input - Transcript input data
   * @param options - Creation options (requireSpeaker defaults to true)
   */
  async create(input: CreateTranscriptInput, options: TranscriptCreationOptions = {}): Promise<Transcript> {
    // Validate speaker_id requirement
    validateSpeakerId(input.speaker_id, options)

    const stmts = getStatements()
    const id = input.id || randomUUID()

    // Prepare transcript with compression
    const params = await prepareTranscriptWithCompression(id, input)

    stmts.insert.run(params)

    return stmts.getById.get(id) as Transcript
  },

  /**
   * Create a transcript segment with required speaker (diarization-first mode)
   *
   * This is the preferred method when using diarization-first pipeline.
   * It enforces that speaker_id is always provided.
   *
   * @param input - Transcript input with required speaker_id
   */
  createWithSpeaker(input: CreateTranscriptWithSpeakerInput): Transcript {
    if (!input.speaker_id) {
      throw new MissingSpeakerIdError()
    }
    return this.create(input, { requireSpeaker: true })
  },

  /**
   * Create multiple transcript segments in a batch
   *
   * By default, requires speaker_id for all inputs.
   * NOTE: This method is now async to support compression of transcript content.
   *
   * @param inputs - Array of transcript inputs
   * @param options - Creation options (requireSpeaker defaults to true)
   */
  async createBatch(inputs: CreateTranscriptInput[], options: TranscriptCreationOptions = {}): Promise<Transcript[]> {
    // Validate all inputs first
    for (const input of inputs) {
      validateSpeakerId(input.speaker_id, options)
    }

    const dbService = getDatabaseService()
    const stmts = getStatements()
    const results: Transcript[] = []

    // Prepare all transcripts with compression in parallel
    const preparedParams = await Promise.all(
      inputs.map((input) => prepareTranscriptWithCompression(input.id || randomUUID(), input))
    )

    const createAll = dbService.getDatabase().transaction(() => {
      for (const params of preparedParams) {
        stmts.insert.run(params)
        results.push(stmts.getById.get(params.id) as Transcript)
      }
    })

    createAll()
    return results
  },

  /**
   * Create transcript segments from aligned diarization data
   *
   * This is the main entry point for creating transcripts after aligning
   * transcription with diarization. It ensures all segments have proper
   * speaker attribution.
   * NOTE: This method is now async to support compression of transcript content.
   *
   * @param meetingId - Meeting ID
   * @param alignedSegments - Segments from temporal alignment service
   */
  async createFromAlignedSegments(
    meetingId: string,
    alignedSegments: Array<{
      text: string
      startTimeMs: number
      endTimeMs: number
      speakerId: string
      transcriptionConfidence: number
      isFinal: boolean
    }>
  ): Promise<Transcript[]> {
    const inputs: CreateTranscriptWithSpeakerInput[] = alignedSegments.map(segment => ({
      meeting_id: meetingId,
      speaker_id: segment.speakerId,
      content: segment.text,
      start_time_ms: segment.startTimeMs,
      end_time_ms: segment.endTimeMs,
      confidence: segment.transcriptionConfidence,
      is_final: segment.isFinal
    }))

    return this.createBatch(inputs, { requireSpeaker: true })
  },

  /**
   * Get a transcript by ID
   */
  getById(id: string): Transcript | null {
    const stmts = getStatements()
    const row = stmts.getById.get(id) as RawTranscriptRow | undefined
    return row ? normalizeTranscript(row) : null
  },

  /**
   * Get all transcripts for a meeting
   */
  getByMeetingId(meetingId: string): Transcript[] {
    const stmts = getStatements()
    const rows = stmts.getByMeetingId.all(meetingId) as RawTranscriptRow[]
    return normalizeTranscripts(rows)
  },

  /**
   * Get transcripts for a meeting with pagination (lazy loading support)
   *
   * @param meetingId - Meeting ID
   * @param options - Pagination options
   * @returns Paginated response with transcripts
   */
  getByMeetingIdPaginated(
    meetingId: string,
    options: PaginationOptions = {}
  ): PaginatedResponse<Transcript> {
    const stmts = getStatements()
    const limit = options.limit ?? 50
    const offset = options.offset ?? 0

    const rows = stmts.getByMeetingIdPaginated.all(meetingId, limit, offset) as RawTranscriptRow[]
    const data = normalizeTranscripts(rows)
    const countResult = stmts.getCountByMeetingId.get(meetingId) as { count: number }
    const total = countResult.count

    return {
      data,
      total,
      hasMore: offset + data.length < total,
      offset,
      limit
    }
  },

  /**
   * Get count of transcripts for a meeting
   *
   * @param meetingId - Meeting ID
   * @returns Number of transcripts
   */
  getCountByMeetingId(meetingId: string): number {
    const stmts = getStatements()
    const result = stmts.getCountByMeetingId.get(meetingId) as { count: number }
    return result.count
  },

  /**
   * Get unique speaker IDs for a meeting
   * More efficient than fetching all speakers then filtering
   *
   * @param meetingId - Meeting ID
   * @returns Array of unique speaker IDs
   */
  getSpeakerIdsByMeetingId(meetingId: string): string[] {
    const stmts = getStatements()
    const results = stmts.getSpeakerIdsByMeetingId.all(meetingId) as Array<{ speaker_id: string }>
    return results.map(r => r.speaker_id)
  },

  /**
   * Get all transcripts for a speaker
   */
  getBySpeakerId(speakerId: string): Transcript[] {
    const stmts = getStatements()
    const rows = stmts.getBySpeakerId.all(speakerId) as RawTranscriptRow[]
    return normalizeTranscripts(rows)
  },

  /**
   * Delete a transcript
   */
  delete(id: string): boolean {
    const stmts = getStatements()
    const result = stmts.delete.run(id)
    return result.changes > 0
  },

  /**
   * Delete all transcripts for a meeting
   */
  deleteByMeetingId(meetingId: string): number {
    const stmts = getStatements()
    const result = stmts.deleteByMeetingId.run(meetingId)
    return result.changes
  },

  /**
   * Get full transcript text for a meeting
   */
  getFullText(meetingId: string): string {
    const transcripts = transcriptService.getByMeetingId(meetingId)
    return transcripts.map(t => t.content).join(' ')
  },

  /**
   * Get transcripts grouped by speaker for conversation blocks display
   *
   * Groups consecutive utterances from the same speaker into conversation blocks.
   * This is the preferred method for displaying transcripts in the UI.
   *
   * @param meetingId - Meeting ID
   * @returns Array of conversation blocks with speaker info
   */
  getGroupedBySpeaker(meetingId: string): Array<{
    speakerId: string
    transcripts: Transcript[]
    startTimeMs: number
    endTimeMs: number
    combinedContent: string
  }> {
    const transcripts = this.getByMeetingId(meetingId)
    if (transcripts.length === 0) return []

    const groups: Array<{
      speakerId: string
      transcripts: Transcript[]
      startTimeMs: number
      endTimeMs: number
      combinedContent: string
    }> = []

    let currentGroup: typeof groups[0] | null = null

    for (const transcript of transcripts) {
      const speakerId = transcript.speaker_id || 'UNKNOWN'

      if (currentGroup && currentGroup.speakerId === speakerId) {
        // Same speaker - add to current group
        currentGroup.transcripts.push(transcript)
        currentGroup.endTimeMs = transcript.end_time_ms
        currentGroup.combinedContent += ' ' + transcript.content
      } else {
        // Different speaker - start new group
        if (currentGroup) {
          groups.push(currentGroup)
        }
        currentGroup = {
          speakerId,
          transcripts: [transcript],
          startTimeMs: transcript.start_time_ms,
          endTimeMs: transcript.end_time_ms,
          combinedContent: transcript.content
        }
      }
    }

    // Don't forget the last group
    if (currentGroup) {
      groups.push(currentGroup)
    }

    return groups
  },

  /**
   * Get transcripts with diarization validation
   *
   * Returns transcripts along with validation info about speaker coverage.
   *
   * @param meetingId - Meeting ID
   */
  getWithValidation(meetingId: string): {
    transcripts: Transcript[]
    validation: {
      totalSegments: number
      segmentsWithSpeaker: number
      segmentsWithoutSpeaker: number
      coveragePercentage: number
      uniqueSpeakers: string[]
    }
  } {
    const transcripts = this.getByMeetingId(meetingId)
    const segmentsWithSpeaker = transcripts.filter(t => t.speaker_id)
    const uniqueSpeakers = [...new Set(transcripts.map(t => t.speaker_id).filter(Boolean))] as string[]

    return {
      transcripts,
      validation: {
        totalSegments: transcripts.length,
        segmentsWithSpeaker: segmentsWithSpeaker.length,
        segmentsWithoutSpeaker: transcripts.length - segmentsWithSpeaker.length,
        coveragePercentage: transcripts.length > 0
          ? (segmentsWithSpeaker.length / transcripts.length) * 100
          : 0,
        uniqueSpeakers
      }
    }
  },

  /**
   * Check if a meeting has diarization data (transcripts with speakers)
   *
   * @param meetingId - Meeting ID
   * @returns True if meeting has transcripts with speaker attribution
   */
  hasDiarizationData(meetingId: string): boolean {
    const db = getDatabaseService().getDatabase()
    const result = db.prepare(
      'SELECT COUNT(*) as count FROM transcripts WHERE meeting_id = ? AND speaker_id IS NOT NULL'
    ).get(meetingId) as { count: number }
    return result.count > 0
  },

  /**
   * Get time range covered by existing transcripts
   *
   * @param meetingId - Meeting ID
   */
  getTimeRange(meetingId: string): { startTimeMs: number; endTimeMs: number } | null {
    const db = getDatabaseService().getDatabase()
    const result = db.prepare(
      'SELECT MIN(start_time_ms) as start, MAX(end_time_ms) as end FROM transcripts WHERE meeting_id = ?'
    ).get(meetingId) as { start: number | null; end: number | null }

    if (result.start === null || result.end === null) {
      return null
    }

    return {
      startTimeMs: result.start,
      endTimeMs: result.end
    }
  },

  // ============================================================================
  // Full-Text Search Methods (FTS5)
  // ============================================================================

  /**
   * Search transcripts within a meeting using FTS5 full-text search
   *
   * @param meetingId - Meeting ID to search within
   * @param query - Search query (supports FTS5 query syntax)
   * @returns Array of matching transcripts with highlighted snippets
   */
  searchInMeeting(
    meetingId: string,
    query: string
  ): Array<{
    transcript: Transcript
    snippet: string
    matchPositions: Array<{ start: number; end: number }>
  }> {
    if (!query.trim()) {
      return []
    }

    const db = getDatabaseService().getDatabase()

    // Escape special FTS5 characters for literal search, but allow wildcards
    const sanitizedQuery = query
      .replace(/['"]/g, '') // Remove quotes to prevent injection
      .trim()

    // Use FTS5 MATCH query with snippet() for highlighting
    // snippet() returns text around the match with <b> tags for highlighting
    const results = db.prepare(`
      SELECT
        t.*,
        snippet(transcripts_fts, 0, '<mark>', '</mark>', '...', 64) as snippet
      FROM transcripts_fts fts
      JOIN transcripts t ON fts.transcript_id = t.id
      WHERE fts.meeting_id = ?
        AND transcripts_fts MATCH ?
      ORDER BY t.start_time_ms ASC
    `).all(meetingId, `"${sanitizedQuery}"`) as Array<RawTranscriptRow & { snippet: string }>

    return results.map(row => {
      const { snippet, ...rawTranscript } = row
      const transcript = normalizeTranscript(rawTranscript)

      // Parse match positions from content
      const matchPositions = findMatchPositions(transcript.content, sanitizedQuery)

      return {
        transcript,
        snippet,
        matchPositions
      }
    })
  },

  /**
   * Search transcripts across all meetings using FTS5
   *
   * @param query - Search query
   * @param limit - Maximum number of results
   * @returns Array of matching transcripts with meeting context
   */
  searchAll(
    query: string,
    limit: number = 50
  ): Array<{
    transcript: Transcript
    meetingId: string
    snippet: string
  }> {
    if (!query.trim()) {
      return []
    }

    const db = getDatabaseService().getDatabase()

    const sanitizedQuery = query
      .replace(/['"]/g, '')
      .trim()

    const results = db.prepare(`
      SELECT
        t.*,
        snippet(transcripts_fts, 0, '<mark>', '</mark>', '...', 64) as snippet
      FROM transcripts_fts fts
      JOIN transcripts t ON fts.transcript_id = t.id
      WHERE transcripts_fts MATCH ?
      ORDER BY rank
      LIMIT ?
    `).all(`"${sanitizedQuery}"`, limit) as Array<RawTranscriptRow & { snippet: string }>

    return results.map(row => {
      const { snippet, ...rawTranscript } = row
      const transcript = normalizeTranscript(rawTranscript)
      return {
        transcript,
        meetingId: transcript.meeting_id,
        snippet
      }
    })
  },

  /**
   * Get search result count for a meeting
   *
   * @param meetingId - Meeting ID
   * @param query - Search query
   * @returns Number of matching transcripts
   */
  getSearchCount(meetingId: string, query: string): number {
    if (!query.trim()) {
      return 0
    }

    const db = getDatabaseService().getDatabase()

    const sanitizedQuery = query
      .replace(/['"]/g, '')
      .trim()

    const result = db.prepare(`
      SELECT COUNT(*) as count
      FROM transcripts_fts
      WHERE meeting_id = ?
        AND transcripts_fts MATCH ?
    `).get(meetingId, `"${sanitizedQuery}"`) as { count: number }

    return result.count
  },

  /**
   * Get matching transcript IDs for navigation
   *
   * @param meetingId - Meeting ID
   * @param query - Search query
   * @returns Array of transcript IDs in chronological order
   */
  getMatchingTranscriptIds(meetingId: string, query: string): string[] {
    if (!query.trim()) {
      return []
    }

    const db = getDatabaseService().getDatabase()

    const sanitizedQuery = query
      .replace(/['"]/g, '')
      .trim()

    const results = db.prepare(`
      SELECT t.id
      FROM transcripts_fts fts
      JOIN transcripts t ON fts.transcript_id = t.id
      WHERE fts.meeting_id = ?
        AND transcripts_fts MATCH ?
      ORDER BY t.start_time_ms ASC
    `).all(meetingId, `"${sanitizedQuery}"`) as Array<{ id: string }>

    return results.map(r => r.id)
  },

  /**
   * Get compression statistics for a meeting
   *
   * @param meetingId - Meeting ID
   * @returns Compression statistics including sizes and ratios
   */
  getCompressionStats(meetingId: string): {
    totalOriginalSize: number
    totalCompressedSize: number
    totalCompressionRatio: number
    compressedCount: number
    uncompressedCount: number
  } {
    const compressionService = getTranscriptCompressionService()
    const db = getDatabaseService().getDatabase()

    const result = db.prepare(`
      SELECT
        SUM(CASE WHEN is_compressed = 1 THEN LENGTH(content_uncompressed) ELSE 0 END) as compressed_original_size,
        SUM(CASE WHEN is_compressed = 1 THEN LENGTH(content) ELSE 0 END) as compressed_data_size,
        SUM(CASE WHEN is_compressed = 0 THEN LENGTH(content) ELSE 0 END) as uncompressed_size,
        SUM(CASE WHEN is_compressed = 1 THEN 1 ELSE 0 END) as compressed_count,
        SUM(CASE WHEN is_compressed = 0 THEN 1 ELSE 0 END) as uncompressed_count
      FROM transcripts
      WHERE meeting_id = ?
    `).get(meetingId) as {
      compressed_original_size: number | null
      compressed_data_size: number | null
      uncompressed_size: number | null
      compressed_count: number
      uncompressed_count: number
    }

    const compressedOriginal = result.compressed_original_size || 0
    const compressedData = result.compressed_data_size || 0
    const uncompressedData = result.uncompressed_size || 0

    const totalOriginalSize = compressedOriginal + uncompressedData
    const totalCompressedSize = compressedData + uncompressedData
    const totalCompressionRatio = totalOriginalSize > 0 ? 1 - totalCompressedSize / totalOriginalSize : 0

    return {
      totalOriginalSize,
      totalCompressedSize,
      totalCompressionRatio,
      compressedCount: result.compressed_count,
      uncompressedCount: result.uncompressed_count
    }
  }
}

/**
 * Find match positions in text for highlighting
 */
function findMatchPositions(
  text: string,
  query: string
): Array<{ start: number; end: number }> {
  const positions: Array<{ start: number; end: number }> = []
  const lowerText = text.toLowerCase()
  const lowerQuery = query.toLowerCase()

  let startIndex = 0
  while (true) {
    const index = lowerText.indexOf(lowerQuery, startIndex)
    if (index === -1) break

    positions.push({
      start: index,
      end: index + query.length
    })

    startIndex = index + 1
  }

  return positions
}

// Reset statements cache (useful for testing)
export function resetTranscriptStatements(): void {
  statements = null
}

// Note: Types are exported inline at their definitions above
