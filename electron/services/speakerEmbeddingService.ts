/**
 * Speaker Embedding Service
 *
 * Manages persistent storage and matching of speaker voice embeddings (fingerprints).
 * This service enables:
 * - Consistent speaker IDs across audio chunks
 * - Speaker re-identification across different meetings
 * - Gradual speaker profile improvement over time
 * - Cross-meeting speaker recognition
 *
 * Key Concepts:
 * - **Embedding**: A numerical vector representation of a speaker's voice characteristics
 * - **Centroid**: Average embedding representing a speaker's voice profile
 * - **Cosine Similarity**: Measure of similarity between embeddings (0-1, higher = more similar)
 * - **Profile Quality**: Measure of how well-established a speaker profile is
 */

import { getDatabaseService } from './database'
import { v4 as uuidv4 } from 'uuid'
import type Database from 'better-sqlite3'

// ============================================================================
// Type Definitions
// ============================================================================

export interface SpeakerEmbedding {
  id: string
  speaker_id: string
  meeting_id: string | null
  embedding_vector: Buffer  // Serialized numpy array
  embedding_dimension: number
  extraction_model: string
  model_version: string | null
  confidence_score: number
  audio_segment_start_ms: number | null
  audio_segment_end_ms: number | null
  audio_quality_score: number | null
  is_verified: boolean
  verification_method: 'manual' | 'automatic' | 'high_confidence' | null
  created_at: string
  updated_at: string
}

export interface SpeakerProfile {
  id: string
  speaker_id: string
  embedding_count: number
  average_confidence: number
  centroid_embedding: Buffer | null
  centroid_dimension: number | null
  extraction_model: string | null
  first_seen_meeting_id: string | null
  last_seen_meeting_id: string | null
  first_seen_at: string | null
  last_seen_at: string | null
  total_speaking_duration_seconds: number
  total_segments: number
  profile_quality: 'learning' | 'stable' | 'verified'
  embedding_variance: number | null
  notes: string | null
  created_at: string
  updated_at: string
}

export interface SpeakerMatchResult {
  speaker_id: string | null
  similarity_score: number
  confidence_level: 'low' | 'medium' | 'high' | 'verified'
  is_new_speaker: boolean
  second_best_speaker_id: string | null
  second_best_similarity: number | null
  decision_factors: {
    method: 'centroid' | 'ensemble' | 'temporal' | 'manual'
    profile_quality?: string
    embedding_count?: number
    threshold_used?: number
  }
}

export interface SpeakerMatchingLog {
  id: string
  meeting_id: string
  audio_segment_start_ms: number
  audio_segment_end_ms: number
  matched_speaker_id: string | null
  similarity_score: number | null
  second_best_speaker_id: string | null
  second_best_similarity: number | null
  matching_method: 'centroid' | 'ensemble' | 'temporal' | 'manual'
  is_new_speaker: boolean
  confidence_level: 'low' | 'medium' | 'high' | 'verified'
  decision_factors: string | null  // JSON
  created_at: string
}

// ============================================================================
// Embedding Serialization Utilities
// ============================================================================

/**
 * Serialize a Float32Array embedding to a Buffer for database storage
 */
export function serializeEmbedding(embedding: Float32Array): Buffer {
  return Buffer.from(embedding.buffer)
}

/**
 * Deserialize a Buffer back to a Float32Array embedding
 */
export function deserializeEmbedding(buffer: Buffer): Float32Array {
  return new Float32Array(buffer.buffer, buffer.byteOffset, buffer.byteLength / Float32Array.BYTES_PER_ELEMENT)
}

/**
 * Calculate cosine similarity between two embeddings
 * Returns a value between 0 and 1, where 1 means identical
 */
export function cosineSimilarity(a: Float32Array, b: Float32Array): number {
  if (a.length !== b.length) {
    throw new Error(`Embedding dimension mismatch: ${a.length} vs ${b.length}`)
  }

  let dotProduct = 0
  let normA = 0
  let normB = 0

  for (let i = 0; i < a.length; i++) {
    dotProduct += a[i] * b[i]
    normA += a[i] * a[i]
    normB += b[i] * b[i]
  }

  normA = Math.sqrt(normA)
  normB = Math.sqrt(normB)

  if (normA === 0 || normB === 0) {
    return 0
  }

  return dotProduct / (normA * normB)
}

// ============================================================================
// Speaker Embedding Service
// ============================================================================

export class SpeakerEmbeddingService {
  // Lazily initialized to avoid database access before initialization
  private _db: Database.Database | null = null

  // Lazy getter for database
  private get db(): Database.Database {
    if (!this._db) {
      this._db = getDatabaseService().getDatabase()
    }
    return this._db
  }

  // Similarity thresholds for speaker matching
  private static readonly HIGH_CONFIDENCE_THRESHOLD = 0.85  // Definitely same speaker
  private static readonly MEDIUM_CONFIDENCE_THRESHOLD = 0.70  // Probably same speaker
  private static readonly NEW_SPEAKER_THRESHOLD = 0.50  // Probably different speaker

  // Profile quality thresholds
  private static readonly STABLE_PROFILE_MIN_EMBEDDINGS = 5
  private static readonly VERIFIED_PROFILE_MIN_EMBEDDINGS = 10

  constructor() {
    // Database access is now lazy - no initialization needed here
  }

  // ==========================================================================
  // Embedding Storage
  // ==========================================================================

  /**
   * Store a new speaker embedding in the database
   */
  async storeEmbedding(params: {
    speaker_id: string
    meeting_id: string | null
    embedding: Float32Array
    extraction_model: string
    model_version?: string
    confidence_score?: number
    audio_segment_start_ms?: number
    audio_segment_end_ms?: number
    audio_quality_score?: number
    is_verified?: boolean
    verification_method?: 'manual' | 'automatic' | 'high_confidence'
  }): Promise<string> {
    const id = uuidv4()
    const embedding_vector = serializeEmbedding(params.embedding)

    const stmt = this.db.prepare(`
      INSERT INTO speaker_embeddings (
        id, speaker_id, meeting_id, embedding_vector, embedding_dimension,
        extraction_model, model_version, confidence_score,
        audio_segment_start_ms, audio_segment_end_ms, audio_quality_score,
        is_verified, verification_method
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `)

    stmt.run(
      id,
      params.speaker_id,
      params.meeting_id || null,
      embedding_vector,
      params.embedding.length,
      params.extraction_model,
      params.model_version || null,
      params.confidence_score || 1.0,
      params.audio_segment_start_ms || null,
      params.audio_segment_end_ms || null,
      params.audio_quality_score || null,
      params.is_verified ? 1 : 0,
      params.verification_method || null
    )

    // Update speaker profile after storing embedding
    await this.updateSpeakerProfile(params.speaker_id, params.meeting_id || undefined)

    return id
  }

  /**
   * Get all embeddings for a specific speaker
   */
  getEmbeddingsForSpeaker(speaker_id: string): SpeakerEmbedding[] {
    const stmt = this.db.prepare(`
      SELECT * FROM speaker_embeddings
      WHERE speaker_id = ?
      ORDER BY created_at DESC
    `)

    return stmt.all(speaker_id).map(row => ({
      ...row as any,
      is_verified: Boolean(row.is_verified)
    }))
  }

  /**
   * Get the most recent N embeddings for a speaker
   */
  getRecentEmbeddingsForSpeaker(speaker_id: string, limit: number = 10): SpeakerEmbedding[] {
    const stmt = this.db.prepare(`
      SELECT * FROM speaker_embeddings
      WHERE speaker_id = ?
      ORDER BY created_at DESC
      LIMIT ?
    `)

    return stmt.all(speaker_id, limit).map(row => ({
      ...row as any,
      is_verified: Boolean(row.is_verified)
    }))
  }

  // ==========================================================================
  // Speaker Profile Management
  // ==========================================================================

  /**
   * Get or create a speaker profile
   */
  private getOrCreateProfile(speaker_id: string): SpeakerProfile {
    let profile = this.db.prepare(`
      SELECT * FROM speaker_profiles WHERE speaker_id = ?
    `).get(speaker_id) as SpeakerProfile | undefined

    if (!profile) {
      const id = uuidv4()
      this.db.prepare(`
        INSERT INTO speaker_profiles (id, speaker_id)
        VALUES (?, ?)
      `).run(id, speaker_id)

      profile = this.db.prepare(`
        SELECT * FROM speaker_profiles WHERE id = ?
      `).get(id) as SpeakerProfile
    }

    return profile
  }

  /**
   * Update speaker profile with latest embedding statistics
   */
  private async updateSpeakerProfile(speaker_id: string, meeting_id?: string): Promise<void> {
    const profile = this.getOrCreateProfile(speaker_id)
    const embeddings = this.getEmbeddingsForSpeaker(speaker_id)

    if (embeddings.length === 0) {
      return
    }

    // Calculate average confidence
    const average_confidence = embeddings.reduce((sum, emb) => sum + emb.confidence_score, 0) / embeddings.length

    // Calculate centroid (average embedding)
    const firstEmbedding = deserializeEmbedding(embeddings[0].embedding_vector)
    const dimension = firstEmbedding.length
    const centroid = new Float32Array(dimension)

    for (const emb of embeddings) {
      const vec = deserializeEmbedding(emb.embedding_vector)
      for (let i = 0; i < dimension; i++) {
        centroid[i] += vec[i]
      }
    }

    for (let i = 0; i < dimension; i++) {
      centroid[i] /= embeddings.length
    }

    // Calculate variance (measure of voice consistency)
    let variance_sum = 0
    for (const emb of embeddings) {
      const vec = deserializeEmbedding(emb.embedding_vector)
      const similarity = cosineSimilarity(vec, centroid)
      const distance = 1 - similarity
      variance_sum += distance * distance
    }
    const embedding_variance = Math.sqrt(variance_sum / embeddings.length)

    // Determine profile quality
    let profile_quality: 'learning' | 'stable' | 'verified' = 'learning'
    if (embeddings.length >= SpeakerEmbeddingService.VERIFIED_PROFILE_MIN_EMBEDDINGS) {
      profile_quality = 'verified'
    } else if (embeddings.length >= SpeakerEmbeddingService.STABLE_PROFILE_MIN_EMBEDDINGS) {
      profile_quality = 'stable'
    }

    // Get first and last seen info
    const first_seen = embeddings[embeddings.length - 1]
    const last_seen = embeddings[0]

    // Update profile
    this.db.prepare(`
      UPDATE speaker_profiles
      SET
        embedding_count = ?,
        average_confidence = ?,
        centroid_embedding = ?,
        centroid_dimension = ?,
        extraction_model = ?,
        first_seen_meeting_id = ?,
        last_seen_meeting_id = ?,
        first_seen_at = ?,
        last_seen_at = ?,
        profile_quality = ?,
        embedding_variance = ?
      WHERE speaker_id = ?
    `).run(
      embeddings.length,
      average_confidence,
      serializeEmbedding(centroid),
      dimension,
      embeddings[0].extraction_model,
      first_seen.meeting_id,
      meeting_id || last_seen.meeting_id,
      first_seen.created_at,
      last_seen.created_at,
      profile_quality,
      embedding_variance,
      speaker_id
    )
  }

  /**
   * Get speaker profile
   */
  getSpeakerProfile(speaker_id: string): SpeakerProfile | null {
    const profile = this.db.prepare(`
      SELECT * FROM speaker_profiles WHERE speaker_id = ?
    `).get(speaker_id) as SpeakerProfile | undefined

    return profile || null
  }

  /**
   * Get all speaker profiles
   */
  getAllSpeakerProfiles(): SpeakerProfile[] {
    return this.db.prepare(`
      SELECT * FROM speaker_profiles
      ORDER BY last_seen_at DESC
    `).all() as SpeakerProfile[]
  }

  // ==========================================================================
  // Speaker Matching
  // ==========================================================================

  /**
   * Match a new embedding against all known speakers
   * Returns the best match or indicates a new speaker should be created
   */
  async matchSpeaker(params: {
    embedding: Float32Array
    meeting_id: string
    audio_segment_start_ms: number
    audio_segment_end_ms: number
    extraction_model: string
  }): Promise<SpeakerMatchResult> {
    const profiles = this.getAllSpeakerProfiles()

    if (profiles.length === 0) {
      // No existing speakers, this is definitely new
      return {
        speaker_id: null,
        similarity_score: 0,
        confidence_level: 'high',
        is_new_speaker: true,
        second_best_speaker_id: null,
        second_best_similarity: null,
        decision_factors: {
          method: 'centroid'
        }
      }
    }

    // Calculate similarity against all speaker centroids
    const similarities: Array<{ speaker_id: string; similarity: number; profile: SpeakerProfile }> = []

    for (const profile of profiles) {
      if (!profile.centroid_embedding) {
        continue
      }

      const centroid = deserializeEmbedding(profile.centroid_embedding)
      const similarity = cosineSimilarity(params.embedding, centroid)

      similarities.push({
        speaker_id: profile.speaker_id,
        similarity,
        profile
      })
    }

    // Sort by similarity (descending)
    similarities.sort((a, b) => b.similarity - a.similarity)

    const best_match = similarities[0]
    const second_best = similarities[1] || null

    // Determine if this is a match or a new speaker
    let is_new_speaker = false
    let confidence_level: 'low' | 'medium' | 'high' | 'verified' = 'medium'
    let matched_speaker_id: string | null = best_match.speaker_id

    if (best_match.similarity >= SpeakerEmbeddingService.HIGH_CONFIDENCE_THRESHOLD) {
      // Very high similarity - definitely the same speaker
      is_new_speaker = false
      confidence_level = best_match.profile.profile_quality === 'verified' ? 'verified' : 'high'
    } else if (best_match.similarity >= SpeakerEmbeddingService.MEDIUM_CONFIDENCE_THRESHOLD) {
      // Medium-high similarity - probably the same speaker
      is_new_speaker = false
      confidence_level = 'medium'
    } else if (best_match.similarity >= SpeakerEmbeddingService.NEW_SPEAKER_THRESHOLD) {
      // Low-medium similarity - uncertain, lean towards same speaker if profile is weak
      if (best_match.profile.profile_quality === 'learning') {
        is_new_speaker = false
        confidence_level = 'low'
      } else {
        is_new_speaker = true
        matched_speaker_id = null
      }
    } else {
      // Low similarity - definitely a new speaker
      is_new_speaker = true
      matched_speaker_id = null
    }

    // Log the matching decision
    await this.logMatchingDecision({
      meeting_id: params.meeting_id,
      audio_segment_start_ms: params.audio_segment_start_ms,
      audio_segment_end_ms: params.audio_segment_end_ms,
      matched_speaker_id,
      similarity_score: best_match.similarity,
      second_best_speaker_id: second_best?.speaker_id || null,
      second_best_similarity: second_best?.similarity || null,
      matching_method: 'centroid',
      is_new_speaker,
      confidence_level,
      decision_factors: {
        method: 'centroid',
        profile_quality: best_match.profile.profile_quality,
        embedding_count: best_match.profile.embedding_count,
        threshold_used: is_new_speaker
          ? SpeakerEmbeddingService.NEW_SPEAKER_THRESHOLD
          : best_match.similarity >= SpeakerEmbeddingService.HIGH_CONFIDENCE_THRESHOLD
            ? SpeakerEmbeddingService.HIGH_CONFIDENCE_THRESHOLD
            : SpeakerEmbeddingService.MEDIUM_CONFIDENCE_THRESHOLD
      }
    })

    return {
      speaker_id: matched_speaker_id,
      similarity_score: best_match.similarity,
      confidence_level,
      is_new_speaker,
      second_best_speaker_id: second_best?.speaker_id || null,
      second_best_similarity: second_best?.similarity || null,
      decision_factors: {
        method: 'centroid',
        profile_quality: best_match.profile.profile_quality,
        embedding_count: best_match.profile.embedding_count,
        threshold_used: is_new_speaker
          ? SpeakerEmbeddingService.NEW_SPEAKER_THRESHOLD
          : best_match.similarity >= SpeakerEmbeddingService.HIGH_CONFIDENCE_THRESHOLD
            ? SpeakerEmbeddingService.HIGH_CONFIDENCE_THRESHOLD
            : SpeakerEmbeddingService.MEDIUM_CONFIDENCE_THRESHOLD
      }
    }
  }

  // ==========================================================================
  // Matching Log
  // ==========================================================================

  /**
   * Log a speaker matching decision for debugging and analysis
   */
  private async logMatchingDecision(params: {
    meeting_id: string
    audio_segment_start_ms: number
    audio_segment_end_ms: number
    matched_speaker_id: string | null
    similarity_score: number
    second_best_speaker_id: string | null
    second_best_similarity: number | null
    matching_method: 'centroid' | 'ensemble' | 'temporal' | 'manual'
    is_new_speaker: boolean
    confidence_level: 'low' | 'medium' | 'high' | 'verified'
    decision_factors: object
  }): Promise<void> {
    const id = uuidv4()

    this.db.prepare(`
      INSERT INTO speaker_matching_log (
        id, meeting_id, audio_segment_start_ms, audio_segment_end_ms,
        matched_speaker_id, similarity_score, second_best_speaker_id, second_best_similarity,
        matching_method, is_new_speaker, confidence_level, decision_factors
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      params.meeting_id,
      params.audio_segment_start_ms,
      params.audio_segment_end_ms,
      params.matched_speaker_id,
      params.similarity_score,
      params.second_best_speaker_id,
      params.second_best_similarity,
      params.matching_method,
      params.is_new_speaker ? 1 : 0,
      params.confidence_level,
      JSON.stringify(params.decision_factors)
    )
  }

  /**
   * Get matching log for a meeting
   */
  getMatchingLogForMeeting(meeting_id: string): SpeakerMatchingLog[] {
    return this.db.prepare(`
      SELECT * FROM speaker_matching_log
      WHERE meeting_id = ?
      ORDER BY audio_segment_start_ms
    `).all(meeting_id).map(row => ({
      ...row as any,
      is_new_speaker: Boolean(row.is_new_speaker)
    }))
  }

  // ==========================================================================
  // Cleanup and Maintenance
  // ==========================================================================

  /**
   * Remove old embeddings beyond a certain limit per speaker
   * Keeps only the most recent N embeddings
   */
  async pruneOldEmbeddings(speaker_id: string, keep_count: number = 50): Promise<number> {
    const embeddings = this.getEmbeddingsForSpeaker(speaker_id)

    if (embeddings.length <= keep_count) {
      return 0
    }

    const to_delete = embeddings.slice(keep_count)
    const ids = to_delete.map(e => e.id)

    const stmt = this.db.prepare(`
      DELETE FROM speaker_embeddings WHERE id IN (${ids.map(() => '?').join(',')})
    `)

    const result = stmt.run(...ids)

    // Update profile after pruning
    await this.updateSpeakerProfile(speaker_id)

    return result.changes
  }
}

// Export singleton instance
let speakerEmbeddingServiceInstance: SpeakerEmbeddingService | null = null

export function getSpeakerEmbeddingService(): SpeakerEmbeddingService {
  if (!speakerEmbeddingServiceInstance) {
    speakerEmbeddingServiceInstance = new SpeakerEmbeddingService()
  }
  return speakerEmbeddingServiceInstance
}
