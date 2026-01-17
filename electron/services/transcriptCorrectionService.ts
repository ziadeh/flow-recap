/**
 * Transcript Correction Service
 *
 * Provides AI-assisted transcription correction that detects and fixes
 * inaccuracies in Whisper-generated transcripts using LLM post-processing.
 *
 * Features:
 * - Correct misheard words based on meeting context and speaker history
 * - Fix grammatical errors and sentence structure
 * - Resolve ambiguous homophones (e.g., 'there/their', 'to/too')
 * - Add proper punctuation and capitalization
 * - Identify and correct domain-specific terminology or jargon
 *
 * Uses the LLM routing service to pick the best available provider
 * (Claude CLI, Cursor CLI, or LM Studio).
 */

import { randomUUID } from 'crypto'
import type Database from 'better-sqlite3'
import { getDatabaseService } from './database'
import { transcriptService } from './transcriptService'
import { llmRoutingService } from './llm/llmRoutingService'
import type { Transcript } from '../../src/types/database'

// ============================================================================
// Types
// ============================================================================

/**
 * Status of a transcript correction
 */
export type CorrectionStatus = 'pending' | 'accepted' | 'rejected'

/**
 * Trigger that initiated the correction
 */
export type CorrectionTrigger = 'low_confidence' | 'speaker_change' | 'manual' | 'batch'

/**
 * A single text change within a correction
 */
export interface TextChange {
  /** Original text that was changed */
  original: string
  /** Corrected text */
  corrected: string
  /** Type of correction */
  changeType: 'word' | 'punctuation' | 'capitalization' | 'grammar' | 'homophone' | 'terminology'
  /** Character position where the change starts */
  startIndex: number
  /** Character position where the change ends */
  endIndex: number
  /** Confidence in this specific change (0-1) */
  confidence: number
}

/**
 * A transcript correction record
 */
export interface TranscriptCorrection {
  id: string
  transcript_id: string
  meeting_id: string
  original_content: string
  corrected_content: string
  changes: string // JSON array of TextChange[]
  trigger: CorrectionTrigger
  status: CorrectionStatus
  llm_provider: string | null
  llm_model: string | null
  confidence_score: number
  processing_time_ms: number
  created_at: string
  updated_at: string
  applied_at: string | null
}

/**
 * Input for creating a transcript correction
 */
export interface CreateTranscriptCorrectionInput {
  transcript_id: string
  meeting_id: string
  original_content: string
  corrected_content: string
  changes: TextChange[]
  trigger: CorrectionTrigger
  llm_provider?: string | null
  llm_model?: string | null
  confidence_score?: number
  processing_time_ms?: number
}

/**
 * Configuration for correction generation
 */
export interface CorrectionConfig {
  /** Confidence threshold below which corrections are suggested automatically */
  lowConfidenceThreshold: number
  /** Maximum tokens for LLM response */
  maxTokens: number
  /** Temperature for LLM response */
  temperature: number
  /** Include context from surrounding segments */
  includeContext: boolean
  /** Number of surrounding segments to include for context */
  contextSegments: number
}

/**
 * Result of generating a correction
 */
export interface CorrectionResult {
  success: boolean
  error?: string
  correction?: TranscriptCorrection
  changes?: TextChange[]
  metadata?: {
    processingTimeMs: number
    llmProvider: string
    llmModel?: string
    contextUsed: boolean
  }
}

/**
 * Batch correction result
 */
export interface BatchCorrectionResult {
  success: boolean
  totalSegments: number
  corrected: number
  skipped: number
  failed: number
  corrections: TranscriptCorrection[]
  errors: string[]
}

// ============================================================================
// Default Configuration
// ============================================================================

const DEFAULT_CONFIG: CorrectionConfig = {
  lowConfidenceThreshold: 0.6,
  maxTokens: 1024,
  temperature: 0.3,
  includeContext: true,
  contextSegments: 2
}

// ============================================================================
// System Prompts
// ============================================================================

const CORRECTION_SYSTEM_PROMPT = `You are an AI assistant that corrects transcription errors from speech-to-text output.

Your task is to fix the following types of errors:
1. **Misheard words**: Words that sound similar but are incorrect given the context
2. **Grammar errors**: Incorrect verb tenses, subject-verb agreement, etc.
3. **Homophones**: Confusion between words like "there/their/they're", "to/too/two", "your/you're"
4. **Punctuation**: Missing or incorrect punctuation marks
5. **Capitalization**: Proper nouns, sentence starts, acronyms
6. **Domain terminology**: Technical terms or jargon that may have been transcribed phonetically

RULES:
- Only fix clear errors, don't rephrase or paraphrase
- Preserve the speaker's original meaning and style
- Don't add content that wasn't spoken
- Keep filler words like "um", "uh" if they appear intentional
- Be conservative - when in doubt, keep the original
- Return ONLY valid JSON as specified

Respond with JSON in this exact format:
{
  "corrected_text": "The corrected transcript text",
  "changes": [
    {
      "original": "original word or phrase",
      "corrected": "corrected word or phrase",
      "changeType": "word|punctuation|capitalization|grammar|homophone|terminology",
      "startIndex": 0,
      "endIndex": 10,
      "confidence": 0.95
    }
  ],
  "overall_confidence": 0.9
}`

const CONTEXT_PROMPT_TEMPLATE = `Here is the transcript segment to correct:

SEGMENT TO CORRECT:
"{segment_text}"

{context_section}

INSTRUCTIONS:
Analyze the transcript and fix any errors. Consider the context when making corrections.
Return your corrections in the JSON format specified.`

// ============================================================================
// Prepared Statements Cache
// ============================================================================

let statements: {
  insert: Database.Statement
  getById: Database.Statement
  getByTranscriptId: Database.Statement
  getByMeetingId: Database.Statement
  updateStatus: Database.Statement
  delete: Database.Statement
  deleteByMeetingId: Database.Statement
  getPending: Database.Statement
  getStats: Database.Statement
} | null = null

function getStatements() {
  if (statements) return statements

  const db = getDatabaseService().getDatabase()

  statements = {
    insert: db.prepare(`
      INSERT INTO transcript_corrections (
        id, transcript_id, meeting_id, original_content, corrected_content,
        changes, trigger, status, llm_provider, llm_model,
        confidence_score, processing_time_ms, created_at, updated_at
      )
      VALUES (
        @id, @transcript_id, @meeting_id, @original_content, @corrected_content,
        @changes, @trigger, @status, @llm_provider, @llm_model,
        @confidence_score, @processing_time_ms, datetime('now'), datetime('now')
      )
    `),

    getById: db.prepare(`
      SELECT * FROM transcript_corrections WHERE id = ?
    `),

    getByTranscriptId: db.prepare(`
      SELECT * FROM transcript_corrections WHERE transcript_id = ? ORDER BY created_at DESC
    `),

    getByMeetingId: db.prepare(`
      SELECT * FROM transcript_corrections WHERE meeting_id = ? ORDER BY created_at DESC
    `),

    updateStatus: db.prepare(`
      UPDATE transcript_corrections
      SET status = @status, updated_at = datetime('now'), applied_at = CASE WHEN @status = 'accepted' THEN datetime('now') ELSE applied_at END
      WHERE id = @id
    `),

    delete: db.prepare(`
      DELETE FROM transcript_corrections WHERE id = ?
    `),

    deleteByMeetingId: db.prepare(`
      DELETE FROM transcript_corrections WHERE meeting_id = ?
    `),

    getPending: db.prepare(`
      SELECT * FROM transcript_corrections WHERE meeting_id = ? AND status = 'pending' ORDER BY created_at ASC
    `),

    getStats: db.prepare(`
      SELECT
        COUNT(*) as total,
        SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END) as pending,
        SUM(CASE WHEN status = 'accepted' THEN 1 ELSE 0 END) as accepted,
        SUM(CASE WHEN status = 'rejected' THEN 1 ELSE 0 END) as rejected,
        AVG(confidence_score) as avg_confidence
      FROM transcript_corrections
      WHERE meeting_id = ?
    `)
  }

  return statements
}

// ============================================================================
// Transcript Correction Service
// ============================================================================

class TranscriptCorrectionService {
  private config: CorrectionConfig

  constructor(config?: Partial<CorrectionConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...config }
  }

  /**
   * Check if LLM service is available
   */
  async checkAvailability(): Promise<{
    available: boolean
    error?: string
    provider?: string
  }> {
    try {
      const isAvailable = await llmRoutingService.isAvailable()
      if (!isAvailable) {
        return {
          available: false,
          error: 'No LLM provider is available. Please ensure at least one provider (LM Studio, Claude CLI, or Cursor CLI) is running.'
        }
      }

      const health = await llmRoutingService.checkHealth(true)
      return {
        available: true,
        provider: health.data?.loadedModel || 'Unknown'
      }
    } catch (error) {
      return {
        available: false,
        error: error instanceof Error ? error.message : 'Unknown error checking LLM availability'
      }
    }
  }

  /**
   * Generate a correction for a single transcript segment
   */
  async generateCorrection(
    transcriptId: string,
    trigger: CorrectionTrigger = 'manual'
  ): Promise<CorrectionResult> {
    const startTime = Date.now()

    try {
      // Get the transcript
      const transcript = transcriptService.getById(transcriptId)
      if (!transcript) {
        return { success: false, error: 'Transcript not found' }
      }

      // Build context if enabled
      let contextSection = ''
      if (this.config.includeContext) {
        const context = await this.getContextForSegment(transcript)
        if (context) {
          contextSection = `\nCONTEXT (surrounding conversation):\n${context}\n`
        }
      }

      // Build the prompt
      const prompt = CONTEXT_PROMPT_TEMPLATE
        .replace('{segment_text}', transcript.content)
        .replace('{context_section}', contextSection)

      // Call the LLM
      const response = await llmRoutingService.chat(
        prompt,
        CORRECTION_SYSTEM_PROMPT,
        {
          maxTokens: this.config.maxTokens,
          temperature: this.config.temperature
        }
      )

      if (!response.success || !response.data) {
        return {
          success: false,
          error: response.error || 'LLM request failed'
        }
      }

      // Parse the response
      const parsed = this.parseResponse(response.data)
      if (!parsed.success) {
        return {
          success: false,
          error: parsed.error || 'Failed to parse LLM response'
        }
      }

      const processingTimeMs = Date.now() - startTime

      // Check if any changes were made
      if (parsed.changes.length === 0 || parsed.correctedText === transcript.content) {
        return {
          success: true,
          changes: [],
          metadata: {
            processingTimeMs,
            llmProvider: 'routed',
            contextUsed: this.config.includeContext
          }
        }
      }

      // Create the correction record
      const correction = this.create({
        transcript_id: transcriptId,
        meeting_id: transcript.meeting_id,
        original_content: transcript.content,
        corrected_content: parsed.correctedText,
        changes: parsed.changes,
        trigger,
        confidence_score: parsed.overallConfidence,
        processing_time_ms: processingTimeMs
      })

      return {
        success: true,
        correction,
        changes: parsed.changes,
        metadata: {
          processingTimeMs,
          llmProvider: 'routed',
          contextUsed: this.config.includeContext
        }
      }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error generating correction'
      }
    }
  }

  /**
   * Generate corrections for all low-confidence segments in a meeting
   */
  async generateBatchCorrections(
    meetingId: string,
    options?: {
      onlyLowConfidence?: boolean
      maxSegments?: number
    }
  ): Promise<BatchCorrectionResult> {
    const result: BatchCorrectionResult = {
      success: true,
      totalSegments: 0,
      corrected: 0,
      skipped: 0,
      failed: 0,
      corrections: [],
      errors: []
    }

    try {
      // Get all transcripts for the meeting
      let transcripts = transcriptService.getByMeetingId(meetingId)
      result.totalSegments = transcripts.length

      // Filter by confidence if requested
      if (options?.onlyLowConfidence) {
        transcripts = transcripts.filter(t => t.confidence < this.config.lowConfidenceThreshold)
      }

      // Limit if requested
      if (options?.maxSegments && transcripts.length > options.maxSegments) {
        transcripts = transcripts.slice(0, options.maxSegments)
      }

      // Process each transcript
      for (const transcript of transcripts) {
        const correctionResult = await this.generateCorrection(transcript.id, 'batch')

        if (correctionResult.success) {
          if (correctionResult.correction) {
            result.corrected++
            result.corrections.push(correctionResult.correction)
          } else {
            result.skipped++ // No changes needed
          }
        } else {
          result.failed++
          result.errors.push(`Segment ${transcript.id}: ${correctionResult.error}`)
        }
      }

      return result
    } catch (error) {
      result.success = false
      result.errors.push(error instanceof Error ? error.message : 'Unknown error in batch correction')
      return result
    }
  }

  /**
   * Check if a transcript segment needs correction based on confidence
   */
  shouldSuggestCorrection(transcript: Transcript): {
    suggest: boolean
    reason?: string
  } {
    if (transcript.confidence < this.config.lowConfidenceThreshold) {
      return {
        suggest: true,
        reason: `Low confidence (${Math.round(transcript.confidence * 100)}%)`
      }
    }
    return { suggest: false }
  }

  /**
   * Get context from surrounding segments
   */
  private async getContextForSegment(transcript: Transcript): Promise<string | null> {
    try {
      const allTranscripts = transcriptService.getByMeetingId(transcript.meeting_id)
      const currentIndex = allTranscripts.findIndex(t => t.id === transcript.id)

      if (currentIndex === -1) return null

      const contextParts: string[] = []
      const numContext = this.config.contextSegments

      // Get preceding segments
      for (let i = Math.max(0, currentIndex - numContext); i < currentIndex; i++) {
        contextParts.push(`[Before]: "${allTranscripts[i].content}"`)
      }

      // Get following segments
      for (let i = currentIndex + 1; i <= Math.min(allTranscripts.length - 1, currentIndex + numContext); i++) {
        contextParts.push(`[After]: "${allTranscripts[i].content}"`)
      }

      return contextParts.length > 0 ? contextParts.join('\n') : null
    } catch {
      return null
    }
  }

  /**
   * Parse the LLM response
   */
  private parseResponse(responseText: string): {
    success: boolean
    correctedText: string
    changes: TextChange[]
    overallConfidence: number
    error?: string
  } {
    try {
      // Extract JSON from potential markdown code blocks
      let jsonContent = responseText.trim()
      if (jsonContent.startsWith('```')) {
        const match = jsonContent.match(/```(?:json)?\s*([\s\S]*?)```/)
        if (match) {
          jsonContent = match[1].trim()
        }
      }

      const data = JSON.parse(jsonContent)

      return {
        success: true,
        correctedText: data.corrected_text || '',
        changes: (data.changes || []).map((change: Record<string, unknown>) => ({
          original: String(change.original || ''),
          corrected: String(change.corrected || ''),
          changeType: String(change.changeType || 'word'),
          startIndex: Number(change.startIndex || 0),
          endIndex: Number(change.endIndex || 0),
          confidence: Number(change.confidence || 0.5)
        })),
        overallConfidence: Number(data.overall_confidence || 0.5)
      }
    } catch (error) {
      return {
        success: false,
        correctedText: '',
        changes: [],
        overallConfidence: 0,
        error: `Failed to parse JSON: ${error}`
      }
    }
  }

  // ============================================================================
  // CRUD Operations
  // ============================================================================

  /**
   * Create a new correction record
   */
  create(input: CreateTranscriptCorrectionInput): TranscriptCorrection {
    const stmts = getStatements()
    const id = randomUUID()

    const params = {
      id,
      transcript_id: input.transcript_id,
      meeting_id: input.meeting_id,
      original_content: input.original_content,
      corrected_content: input.corrected_content,
      changes: JSON.stringify(input.changes),
      trigger: input.trigger,
      status: 'pending' as CorrectionStatus,
      llm_provider: input.llm_provider ?? null,
      llm_model: input.llm_model ?? null,
      confidence_score: input.confidence_score ?? 0.5,
      processing_time_ms: input.processing_time_ms ?? 0
    }

    stmts.insert.run(params)
    return stmts.getById.get(id) as TranscriptCorrection
  }

  /**
   * Get a correction by ID
   */
  getById(id: string): TranscriptCorrection | null {
    const stmts = getStatements()
    return (stmts.getById.get(id) as TranscriptCorrection) || null
  }

  /**
   * Get all corrections for a transcript
   */
  getByTranscriptId(transcriptId: string): TranscriptCorrection[] {
    const stmts = getStatements()
    return stmts.getByTranscriptId.all(transcriptId) as TranscriptCorrection[]
  }

  /**
   * Get all corrections for a meeting
   */
  getByMeetingId(meetingId: string): TranscriptCorrection[] {
    const stmts = getStatements()
    return stmts.getByMeetingId.all(meetingId) as TranscriptCorrection[]
  }

  /**
   * Get pending corrections for a meeting
   */
  getPendingByMeetingId(meetingId: string): TranscriptCorrection[] {
    const stmts = getStatements()
    return stmts.getPending.all(meetingId) as TranscriptCorrection[]
  }

  /**
   * Accept a correction and apply it to the transcript
   */
  async acceptCorrection(correctionId: string): Promise<{
    success: boolean
    error?: string
  }> {
    try {
      const correction = this.getById(correctionId)
      if (!correction) {
        return { success: false, error: 'Correction not found' }
      }

      const db = getDatabaseService().getDatabase()

      // Update the transcript content
      db.prepare(`
        UPDATE transcripts
        SET content = ?
        WHERE id = ?
      `).run(correction.corrected_content, correction.transcript_id)

      // Update correction status
      const stmts = getStatements()
      stmts.updateStatus.run({ id: correctionId, status: 'accepted' })

      return { success: true }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error accepting correction'
      }
    }
  }

  /**
   * Reject a correction
   */
  rejectCorrection(correctionId: string): {
    success: boolean
    error?: string
  } {
    try {
      const stmts = getStatements()
      const result = stmts.updateStatus.run({ id: correctionId, status: 'rejected' })
      return { success: result.changes > 0 }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error rejecting correction'
      }
    }
  }

  /**
   * Delete a correction
   */
  delete(id: string): boolean {
    const stmts = getStatements()
    const result = stmts.delete.run(id)
    return result.changes > 0
  }

  /**
   * Delete all corrections for a meeting
   */
  deleteByMeetingId(meetingId: string): number {
    const stmts = getStatements()
    const result = stmts.deleteByMeetingId.run(meetingId)
    return result.changes
  }

  /**
   * Get correction statistics for a meeting
   */
  getStats(meetingId: string): {
    total: number
    pending: number
    accepted: number
    rejected: number
    avgConfidence: number
  } {
    const stmts = getStatements()
    const result = stmts.getStats.get(meetingId) as {
      total: number
      pending: number
      accepted: number
      rejected: number
      avg_confidence: number | null
    }

    return {
      total: result.total || 0,
      pending: result.pending || 0,
      accepted: result.accepted || 0,
      rejected: result.rejected || 0,
      avgConfidence: result.avg_confidence || 0
    }
  }

  /**
   * Update configuration
   */
  updateConfig(config: Partial<CorrectionConfig>): void {
    this.config = { ...this.config, ...config }
  }

  /**
   * Get current configuration
   */
  getConfig(): CorrectionConfig {
    return { ...this.config }
  }
}

// ============================================================================
// Singleton Export
// ============================================================================

export const transcriptCorrectionService = new TranscriptCorrectionService()

/**
 * Reset statements cache (useful for testing)
 */
export function resetTranscriptCorrectionStatements(): void {
  statements = null
}

export default transcriptCorrectionService
