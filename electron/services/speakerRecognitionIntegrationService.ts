/**
 * Speaker Recognition Integration Service
 *
 * Integrates Python diarization embedding output with the database-backed
 * speaker recognition system. This service:
 * 1. Listens for embedding events from Python diarization
 * 2. Matches embeddings against known speakers in the database
 * 3. Creates new speakers when unknown voices are detected
 * 4. Stores embeddings for continuous profile improvement
 * 5. Updates transcript segments with persistent speaker IDs
 */

import { getSpeakerEmbeddingService } from './speakerEmbeddingService'
import type { SpeakerMatchResult } from './speakerEmbeddingService'
import { getDatabaseService } from './database'
import { v4 as uuidv4 } from 'uuid'

// ============================================================================
// Type Definitions
// ============================================================================

export interface EmbeddingEvent {
  type: 'speaker_embedding'
  embedding: number[]
  dimension: number
  start: number
  end: number
  speaker?: string  // Temporary speaker ID from Python (e.g., "Speaker_0")
  confidence?: number
  extraction_model: string
}

export interface SpeakerMappingEntry {
  pythonSpeakerId: string  // e.g., "Speaker_0" from Python
  databaseSpeakerId: string  // Persistent speaker ID from database
  meetingId: string
  firstSeenAt: number
  lastSeenAt: number
  embeddingCount: number
}

// ============================================================================
// Speaker Recognition Integration Service
// ============================================================================

export class SpeakerRecognitionIntegrationService {
  // Lazily initialized to avoid database access before initialization
  private _embeddingService: ReturnType<typeof getSpeakerEmbeddingService> | null = null
  private _db: ReturnType<ReturnType<typeof getDatabaseService>['getDatabase']> | null = null

  // Lazy getters for database-dependent services
  private get embeddingService() {
    if (!this._embeddingService) {
      this._embeddingService = getSpeakerEmbeddingService()
    }
    return this._embeddingService
  }

  private get db() {
    if (!this._db) {
      this._db = getDatabaseService().getDatabase()
    }
    return this._db
  }

  // Maps Python temporary speaker IDs to persistent database speaker IDs
  // Key: `${meetingId}:${pythonSpeakerId}` (e.g., "meeting-123:Speaker_0")
  // Value: database speaker ID
  private speakerMapping = new Map<string, SpeakerMappingEntry>()

  // Track which meeting is currently being processed
  private currentMeetingId: string | null = null

  // Statistics
  private stats = {
    embeddingsProcessed: 0,
    newSpeakersCreated: 0,
    existingSpeakersMatched: 0,
    errors: 0
  }

  constructor() {
    console.log('[SpeakerRecognition] Integration service initialized')
  }

  // ==========================================================================
  // Session Management
  // ==========================================================================

  /**
   * Start a new speaker recognition session for a meeting
   */
  startSession(meetingId: string): void {
    console.log(`[SpeakerRecognition] Starting session for meeting: ${meetingId}`)
    this.currentMeetingId = meetingId

    // Clear speaker mapping for this session
    // This forces re-matching against the database
    const keysToDelete: string[] = []
    for (const [key] of this.speakerMapping) {
      if (key.startsWith(`${meetingId}:`)) {
        keysToDelete.push(key)
      }
    }
    keysToDelete.forEach(key => this.speakerMapping.delete(key))

    // Reset statistics
    this.stats = {
      embeddingsProcessed: 0,
      newSpeakersCreated: 0,
      existingSpeakersMatched: 0,
      errors: 0
    }
  }

  /**
   * End the current speaker recognition session
   */
  endSession(): void {
    console.log(`[SpeakerRecognition] Ending session for meeting: ${this.currentMeetingId}`)
    console.log(`[SpeakerRecognition] Session stats:`, this.stats)

    this.currentMeetingId = null
  }

  /**
   * Get statistics for the current session
   */
  getSessionStats() {
    return { ...this.stats }
  }

  // ==========================================================================
  // Embedding Processing
  // ==========================================================================

  /**
   * Process an embedding event from Python diarization
   */
  async processEmbeddingEvent(event: EmbeddingEvent): Promise<{
    success: boolean
    persistentSpeakerId: string | null
    isNewSpeaker: boolean
    matchResult?: SpeakerMatchResult
    error?: string
  }> {
    if (!this.currentMeetingId) {
      return {
        success: false,
        persistentSpeakerId: null,
        isNewSpeaker: false,
        error: 'No active session - call startSession() first'
      }
    }

    try {
      this.stats.embeddingsProcessed++

      // Convert embedding array to Float32Array
      const embedding = new Float32Array(event.embedding)

      // Match against existing speakers in database
      const matchResult = await this.embeddingService.matchSpeaker({
        embedding,
        meeting_id: this.currentMeetingId,
        audio_segment_start_ms: Math.round(event.start * 1000),
        audio_segment_end_ms: Math.round(event.end * 1000),
        extraction_model: event.extraction_model
      })

      let persistentSpeakerId: string

      if (matchResult.is_new_speaker) {
        // Create new speaker in database
        persistentSpeakerId = await this.createNewSpeaker(event, matchResult)
        this.stats.newSpeakersCreated++

        console.log(`[SpeakerRecognition] Created new speaker: ${persistentSpeakerId} ` +
                   `(Python ID: ${event.speaker || 'unknown'}, confidence: ${matchResult.confidence_level})`)
      } else {
        // Use existing speaker
        persistentSpeakerId = matchResult.speaker_id!
        this.stats.existingSpeakersMatched++

        console.log(`[SpeakerRecognition] Matched to existing speaker: ${persistentSpeakerId} ` +
                   `(similarity: ${matchResult.similarity_score.toFixed(3)}, confidence: ${matchResult.confidence_level})`)
      }

      // Store the embedding
      await this.embeddingService.storeEmbedding({
        speaker_id: persistentSpeakerId,
        meeting_id: this.currentMeetingId,
        embedding,
        extraction_model: event.extraction_model,
        confidence_score: event.confidence || 1.0,
        audio_segment_start_ms: Math.round(event.start * 1000),
        audio_segment_end_ms: Math.round(event.end * 1000)
      })

      // Update speaker mapping
      if (event.speaker) {
        this.updateSpeakerMapping(event.speaker, persistentSpeakerId)
      }

      return {
        success: true,
        persistentSpeakerId,
        isNewSpeaker: matchResult.is_new_speaker,
        matchResult
      }
    } catch (error) {
      this.stats.errors++
      console.error('[SpeakerRecognition] Error processing embedding:', error)

      return {
        success: false,
        persistentSpeakerId: null,
        isNewSpeaker: false,
        error: error instanceof Error ? error.message : String(error)
      }
    }
  }

  // ==========================================================================
  // Speaker Management
  // ==========================================================================

  /**
   * Create a new speaker in the database
   */
  private async createNewSpeaker(
    event: EmbeddingEvent,
    matchResult: SpeakerMatchResult
  ): Promise<string> {
    const speakerId = uuidv4()
    const speakerNumber = this.stats.newSpeakersCreated + 1

    // Create speaker with default name
    const stmt = this.db.prepare(`
      INSERT INTO speakers (id, name, created_at, updated_at)
      VALUES (?, ?, datetime('now'), datetime('now'))
    `)

    stmt.run(speakerId, `Speaker ${speakerNumber}`)

    return speakerId
  }

  /**
   * Update the mapping between Python speaker IDs and database speaker IDs
   */
  private updateSpeakerMapping(pythonSpeakerId: string, databaseSpeakerId: string): void {
    if (!this.currentMeetingId) return

    const key = `${this.currentMeetingId}:${pythonSpeakerId}`
    const existing = this.speakerMapping.get(key)

    if (existing) {
      // Update existing mapping
      existing.lastSeenAt = Date.now()
      existing.embeddingCount++
    } else {
      // Create new mapping
      this.speakerMapping.set(key, {
        pythonSpeakerId,
        databaseSpeakerId,
        meetingId: this.currentMeetingId,
        firstSeenAt: Date.now(),
        lastSeenAt: Date.now(),
        embeddingCount: 1
      })
    }
  }

  /**
   * Get the persistent speaker ID for a Python speaker ID
   */
  getPersistentSpeakerId(pythonSpeakerId: string): string | null {
    if (!this.currentMeetingId) return null

    const key = `${this.currentMeetingId}:${pythonSpeakerId}`
    const mapping = this.speakerMapping.get(key)

    return mapping?.databaseSpeakerId || null
  }

  /**
   * Get all speaker mappings for the current meeting
   */
  getCurrentMeetingSpeakerMappings(): SpeakerMappingEntry[] {
    if (!this.currentMeetingId) return []

    const mappings: SpeakerMappingEntry[] = []
    for (const [key, value] of this.speakerMapping) {
      if (key.startsWith(`${this.currentMeetingId}:`)) {
        mappings.push(value)
      }
    }

    return mappings
  }

  // ==========================================================================
  // Transcript Updates
  // ==========================================================================

  /**
   * Update a transcript segment with persistent speaker ID
   */
  async updateTranscriptSpeaker(params: {
    transcriptId: string
    pythonSpeakerId?: string
    persistentSpeakerId?: string
  }): Promise<boolean> {
    try {
      let speakerId = params.persistentSpeakerId

      // If Python speaker ID provided, look up the persistent ID
      if (!speakerId && params.pythonSpeakerId) {
        speakerId = this.getPersistentSpeakerId(params.pythonSpeakerId)
      }

      if (!speakerId) {
        console.warn(`[SpeakerRecognition] No speaker ID found for transcript: ${params.transcriptId}`)
        return false
      }

      // Update the transcript with the persistent speaker ID
      const stmt = this.db.prepare(`
        UPDATE transcripts
        SET speaker_id = ?
        WHERE id = ?
      `)

      stmt.run(speakerId, params.transcriptId)

      return true
    } catch (error) {
      console.error('[SpeakerRecognition] Error updating transcript speaker:', error)
      return false
    }
  }

  /**
   * Batch update multiple transcript segments
   */
  async batchUpdateTranscriptSpeakers(updates: Array<{
    transcriptId: string
    pythonSpeakerId?: string
    persistentSpeakerId?: string
  }>): Promise<{ succeeded: number; failed: number }> {
    let succeeded = 0
    let failed = 0

    // Use transaction for batch updates
    const updateTransaction = this.db.transaction(() => {
      for (const update of updates) {
        const success = this.updateTranscriptSpeaker(update)
        if (success) {
          succeeded++
        } else {
          failed++
        }
      }
    })

    try {
      updateTransaction()
    } catch (error) {
      console.error('[SpeakerRecognition] Batch update transaction failed:', error)
    }

    return { succeeded, failed }
  }

  // ==========================================================================
  // Utilities
  // ==========================================================================

  /**
   * Get speaker profiles for the current meeting
   */
  getMeetingSpeakerProfiles() {
    if (!this.currentMeetingId) return []

    const mappings = this.getCurrentMeetingSpeakerMappings()
    const profiles = mappings.map(mapping => {
      const profile = this.embeddingService.getSpeakerProfile(mapping.databaseSpeakerId)
      const speaker = this.db.prepare(`
        SELECT name FROM speakers WHERE id = ?
      `).get(mapping.databaseSpeakerId) as { name: string } | undefined

      return {
        pythonId: mapping.pythonSpeakerId,
        persistentId: mapping.databaseSpeakerId,
        name: speaker?.name || 'Unknown',
        profile: profile || null,
        embeddingCount: mapping.embeddingCount
      }
    })

    return profiles
  }

  /**
   * Clear all speaker mappings (useful for testing/reset)
   */
  clearAllMappings(): void {
    this.speakerMapping.clear()
    console.log('[SpeakerRecognition] All speaker mappings cleared')
  }
}

// Export singleton instance
let speakerRecognitionServiceInstance: SpeakerRecognitionIntegrationService | null = null

export function getSpeakerRecognitionIntegrationService(): SpeakerRecognitionIntegrationService {
  if (!speakerRecognitionServiceInstance) {
    speakerRecognitionServiceInstance = new SpeakerRecognitionIntegrationService()
  }
  return speakerRecognitionServiceInstance
}
