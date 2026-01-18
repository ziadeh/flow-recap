/**
 * Subject-Aware Note Generation Service
 *
 * Implements intelligent subject-aware note generation with two-pass processing:
 *
 * 1. **Live Processing (Background)**: During recording, continuously chunks
 *    transcripts (20-60s windows), maintains draft subject detection (title, goal,
 *    scope keywords), performs rolling relevance scoring, and extracts candidate
 *    items without publishing.
 *
 * 2. **End-of-Meeting Finalization**: When recording stops, locks final subject,
 *    re-checks all chunks/candidates against locked subject for final relevance,
 *    filters out-of-scope content, and generates clean final notes.
 *
 * Features:
 * - Noise Control: Ignores greetings, small talk, repeated statements,
 *   inconclusive brainstorming, unrelated side topics
 * - Quality Rules: No duplicates, no vague action items, strict action item
 *   criteria (clear task + owner/TBD + deadline/TBD + subject-related)
 * - Strictness Modes: Strict (core subject only), Balanced (subject + close
 *   dependencies), Loose (includes useful side notes)
 * - Developer Storage: Stores raw transcript, chunked transcript, draft subject
 *   history, locked subject + keywords, relevance labels per chunk, extracted
 *   candidates, final output for debugging/improvement
 */

import { BrowserWindow } from 'electron'
import { randomUUID } from 'crypto'
import { llmRoutingService } from './llm/llmRoutingService'
import { meetingNoteService } from './meetingNoteService'
import { taskService } from './taskService'
import { getDatabaseService } from './database'
import { actionItemValidationService } from './actionItemValidationService'
import type { ValidationResult } from './actionItemValidationService'
import type { ChatMessage } from './lm-studio-client'
import type { NoteType, TaskPriority } from '../../src/types/database'

// ============================================================================
// Types
// ============================================================================

export type StrictnessMode = 'strict' | 'balanced' | 'loose'
export type RelevanceType = 'in_scope_important' | 'in_scope_minor' | 'out_of_scope' | 'unclear'
export type SubjectStatus = 'draft' | 'locked'
export type SessionStatus = 'idle' | 'active' | 'processing' | 'paused' | 'finalizing' | 'completed' | 'error'
export type CandidateNoteType = 'key_point' | 'decision' | 'action_item' | 'task' | 'other_note'

export interface MeetingSubject {
  id: string
  meetingId: string
  title: string | null
  goal: string | null
  scopeKeywords: string[]
  status: SubjectStatus
  strictnessMode: StrictnessMode
  confidenceScore: number
  lockedAt: string | null
  createdAt: string
  updatedAt: string
}

export interface SubjectHistory {
  id: string
  meetingId: string
  title: string | null
  goal: string | null
  scopeKeywords: string[]
  confidenceScore: number
  detectedAt: string
  chunkWindowStartMs: number | null
  chunkWindowEndMs: number | null
}

export interface TranscriptChunk {
  id: string
  meetingId: string
  chunkIndex: number
  windowStartMs: number
  windowEndMs: number
  content: string
  speakerIds: string[]
  segmentIds: string[]
  createdAt: string
}

export interface RelevanceLabel {
  id: string
  meetingId: string
  chunkId: string
  relevanceType: RelevanceType
  score: number
  reasoning: string | null
  isFinal: boolean
  createdAt: string
  updatedAt: string
}

export interface NoteCandidate {
  id: string
  meetingId: string
  chunkId: string | null
  noteType: CandidateNoteType
  content: string
  speakerId: string | null
  assignee: string | null
  deadline: string | null
  priority: 'high' | 'medium' | 'low' | null
  relevanceType: RelevanceType | null
  relevanceScore: number | null
  isDuplicate: boolean
  isFinal: boolean
  includedInOutput: boolean
  exclusionReason: string | null
  sourceSegmentIds: string[]
  extractedAt: string
  finalizedAt: string | null
  createdAt: string
  updatedAt: string
  validationResult?: ValidationResult
}

export interface TranscriptSegmentInput {
  id: string
  content: string
  speaker?: string | null
  speakerId?: string | null
  startTimeMs: number
  endTimeMs: number
}

export interface SubjectAwareConfig {
  /** Minimum chunk window in ms (default: 20000 = 20 seconds) */
  minChunkWindowMs: number
  /** Maximum chunk window in ms (default: 60000 = 60 seconds) */
  maxChunkWindowMs: number
  /** Batch processing interval in ms (default: 30000 = 30 seconds) */
  batchIntervalMs: number
  /** Minimum segments per chunk (default: 2) */
  minSegmentsPerChunk: number
  /** Maximum segments per chunk (default: 30) */
  maxSegmentsPerChunk: number
  /** Strictness mode for relevance filtering */
  strictnessMode: StrictnessMode
  /** Minimum scope keywords to detect (default: 5) */
  minScopeKeywords: number
  /** Maximum scope keywords to detect (default: 15) */
  maxScopeKeywords: number
  /** Maximum tokens for LLM response */
  maxTokens: number
  /** Temperature for response randomness (0.0 - 1.0) */
  temperature: number
  /** Whether to store developer debug data */
  storeDebugData: boolean
}

export interface SubjectAwareSessionState {
  isActive: boolean
  meetingId: string | null
  sessionId: string | null
  status: SessionStatus
  startTime: number | null
  currentSubject: MeetingSubject | null
  processedSegmentIds: Set<string>
  pendingSegments: TranscriptSegmentInput[]
  lastChunkTime: number | null
  chunksProcessed: number
  candidatesExtracted: number
  notesFinalized: number
  generatedCandidates: NoteCandidate[]
  // Weighted averaging state
  weightedTitles: Map<string, WeightedComponent>
  weightedGoals: Map<string, WeightedComponent>
  weightedKeywords: Map<string, WeightedComponent>
  detectionHistory: SubjectDetection[]
}

/**
 * Weighted component for subject averaging
 * Tracks cumulative weight for each unique value (title, goal, or keyword)
 */
export interface WeightedComponent {
  value: string
  cumulativeWeight: number
  firstSeenAt: number
  lastSeenAt: number
  occurrenceCount: number
}

/**
 * Subject detection event with timestamp
 * Used for calculating stability and weighted averaging
 */
export interface SubjectDetection {
  title: string
  goal: string
  keywords: string[]
  timestamp: number
  confidence: number
}

export interface SubjectDetectionResult {
  title: string
  goal: string
  scopeKeywords: string[]
  confidence: number
}

export interface RelevanceScoringResult {
  relevanceType: RelevanceType
  score: number
  reasoning: string
}

export interface CandidateExtractionResult {
  candidates: NoteCandidate[]
  processingTimeMs: number
}

export interface FinalizationResult {
  success: boolean
  error?: string
  notesCreated: number
  tasksCreated: number
  candidatesFiltered: number
  processingTimeMs: number
  finalOutput?: FinalStructuredOutput
  auditTrail?: FinalizationAuditTrail
}

export interface FinalStructuredOutput {
  subject: {
    title: string
    goal: string
    scopeKeywords: string[]
  }
  keyPoints: string[]
  decisions: string[]
  actionItems: Array<{
    content: string
    assignee: string | null
    deadline: string | null
    priority: string | null
  }>
  tasks: Array<{
    content: string
    assignee: string | null
    deadline: string | null
    priority: string | null
  }>
  otherNotes: string[]
}

export interface FinalizationAuditTrail {
  meetingId: string
  sessionId: string | null
  draftSubjectHistory: SubjectHistory[]
  lockedSubject: MeetingSubject | null
  totalChunksProcessed: number
  totalCandidatesExtracted: number
  relevanceChanges: Array<{
    chunkId: string
    draftRelevance: RelevanceType | null
    finalRelevance: RelevanceType
    draftScore: number | null
    finalScore: number
  }>
  filteredCandidates: Array<{
    candidateId: string
    content: string
    noteType: CandidateNoteType
    exclusionReason: string
  }>
  includedCandidates: Array<{
    candidateId: string
    content: string
    noteType: CandidateNoteType
  }>
  finalizedAt: string
  strictnessMode: StrictnessMode
}

// ============================================================================
// Default Configuration
// ============================================================================

const DEFAULT_CONFIG: SubjectAwareConfig = {
  minChunkWindowMs: 20000,
  maxChunkWindowMs: 60000,
  batchIntervalMs: 30000,
  minSegmentsPerChunk: 2,
  maxSegmentsPerChunk: 30,
  strictnessMode: 'strict',
  minScopeKeywords: 5,
  maxScopeKeywords: 15,
  maxTokens: 4096,
  temperature: 0.3,
  storeDebugData: true,
}

// ============================================================================
// Prompts
// ============================================================================

const SUBJECT_DETECTION_SYSTEM_PROMPT = `You are an expert meeting analyst. Your task is to detect the main subject/topic of a meeting from transcript segments.

Analyze the transcript to determine:
1. **Title**: A concise title for the meeting (5-10 words)
2. **Goal**: The primary objective or purpose of the meeting (1-2 sentences)
3. **Scope Keywords**: 5-15 keywords that define what's IN scope for this meeting

GUIDELINES:
- Focus on substantive content, not greetings or small talk
- Identify the core business/technical topic being discussed
- Keywords should be specific enough to filter relevant content
- Consider both explicit statements and implicit context

OUTPUT FORMAT: Valid JSON only, no additional text.`

const SUBJECT_DETECTION_USER_PROMPT = `Analyze this transcript segment and detect the meeting subject:

TRANSCRIPT:
{TRANSCRIPT}

Extract the subject in this JSON structure:
{
  "title": "Concise meeting title",
  "goal": "Primary objective of the meeting",
  "scopeKeywords": ["keyword1", "keyword2", ...],
  "confidence": 0.0-1.0
}

Respond with JSON only:`

const RELEVANCE_SCORING_SYSTEM_PROMPT = `You are an expert meeting analyst. Your task is to score the relevance of meeting content against a defined subject scope.

RELEVANCE CATEGORIES:
- **in_scope_important**: Directly related to the subject AND important for meeting outcomes
- **in_scope_minor**: Related to the subject but less critical (supporting details, context)
- **out_of_scope**: Not related to the meeting subject (side conversations, tangents)
- **unclear**: Cannot determine relevance with confidence

NOISE TO FILTER:
- Greetings and small talk ("Hi everyone", "How was your weekend")
- Repeated statements (same point made multiple times)
- Inconclusive brainstorming without decisions
- Unrelated side topics

OUTPUT FORMAT: Valid JSON only, no additional text.`

const RELEVANCE_SCORING_USER_PROMPT = `Score the relevance of this content against the meeting subject.

MEETING SUBJECT:
Title: {TITLE}
Goal: {GOAL}
Scope Keywords: {KEYWORDS}
Strictness Mode: {STRICTNESS}

CONTENT TO SCORE:
{CONTENT}

Score using this JSON structure:
{
  "relevanceType": "in_scope_important" | "in_scope_minor" | "out_of_scope" | "unclear",
  "score": 0.0-1.0,
  "reasoning": "Brief explanation of the score"
}

For strictness modes:
- strict: Only core subject content is in_scope
- balanced: Subject + closely related dependencies are in_scope
- loose: Subject + useful side notes are in_scope

Respond with JSON only:`

const CANDIDATE_EXTRACTION_SYSTEM_PROMPT = `You are an expert meeting note-taker. Extract structured meeting notes from transcript content.

SECTIONS TO EXTRACT:
1. **Key Points**: Important discussion items, insights, or information shared
2. **Decisions**: What was decided during the meeting
3. **Action Items**: Tasks with clear owner (or TBD) and deadline (or TBD)
4. **Tasks**: Work items that may lack owner/deadline but are subject-related
5. **Other Notes**: Useful context that doesn't fit above categories

ACTION ITEM CRITERIA (strict):
- Must have a clear, specific task description
- Must be subject-related
- Owner can be identified or marked TBD
- Deadline can be identified or marked TBD
- NO vague items like "think about X" or "consider Y"

QUALITY RULES:
- NO duplicates (if same point was made, include only once)
- NO noise (greetings, small talk, repeated statements)
- Be selective - only genuinely important items
- Prefer specificity over vagueness

OUTPUT FORMAT: Valid JSON only, no additional text.`

const CANDIDATE_EXTRACTION_USER_PROMPT = `Extract meeting note candidates from this content.

MEETING SUBJECT:
Title: {TITLE}
Goal: {GOAL}
Scope Keywords: {KEYWORDS}

CONTENT:
{CONTENT}

Extract candidates in this JSON structure:
{
  "keyPoints": [
    { "content": "...", "speaker": "SPEAKER_X or null", "priority": "high|medium|low" }
  ],
  "decisions": [
    { "content": "...", "speaker": "SPEAKER_X or null" }
  ],
  "actionItems": [
    { "content": "...", "assignee": "name or TBD", "deadline": "date or TBD", "speaker": "SPEAKER_X or null", "priority": "high|medium|low" }
  ],
  "tasks": [
    { "content": "...", "assignee": "name or null", "deadline": "date or null", "speaker": "SPEAKER_X or null", "priority": "high|medium|low" }
  ],
  "otherNotes": [
    { "content": "...", "speaker": "SPEAKER_X or null" }
  ]
}

Rules:
- Only include items with confidence >= 0.6
- Maximum 5 items per category
- Be selective - quality over quantity
- Filter out noise (greetings, small talk, repetition)

Respond with JSON only:`

// ============================================================================
// Service Class
// ============================================================================

class SubjectAwareNoteGenerationService {
  private config: SubjectAwareConfig
  private sessionState: SubjectAwareSessionState
  private batchTimer: NodeJS.Timeout | null = null
  private isProcessing: boolean = false
  private statements: Record<string, any> | null = null

  constructor(config?: Partial<SubjectAwareConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...config }
    this.sessionState = this.createInitialSessionState()
  }

  private createInitialSessionState(): SubjectAwareSessionState {
    return {
      isActive: false,
      meetingId: null,
      sessionId: null,
      status: 'idle',
      startTime: null,
      currentSubject: null,
      processedSegmentIds: new Set<string>(),
      pendingSegments: [],
      lastChunkTime: null,
      chunksProcessed: 0,
      candidatesExtracted: 0,
      notesFinalized: 0,
      generatedCandidates: [],
      weightedTitles: new Map<string, WeightedComponent>(),
      weightedGoals: new Map<string, WeightedComponent>(),
      weightedKeywords: new Map<string, WeightedComponent>(),
      detectionHistory: [],
    }
  }

  // --------------------------------------------------------------------------
  // Database Operations
  // --------------------------------------------------------------------------

  private getStatements() {
    if (!this.statements) {
      const db = getDatabaseService().getDatabase()
      this.statements = {
        // Meeting Subjects
        insertSubject: db.prepare(`
          INSERT INTO meeting_subjects (id, meeting_id, title, goal, scope_keywords, status, strictness_mode, confidence_score, locked_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        `),
        updateSubject: db.prepare(`
          UPDATE meeting_subjects
          SET title = ?, goal = ?, scope_keywords = ?, status = ?, strictness_mode = ?, confidence_score = ?, locked_at = ?
          WHERE id = ?
        `),
        getSubjectByMeetingId: db.prepare(`
          SELECT * FROM meeting_subjects WHERE meeting_id = ?
        `),
        lockSubject: db.prepare(`
          UPDATE meeting_subjects SET status = 'locked', locked_at = datetime('now') WHERE id = ?
        `),

        // Subject History
        insertSubjectHistory: db.prepare(`
          INSERT INTO subject_history (id, meeting_id, title, goal, scope_keywords, confidence_score, chunk_window_start_ms, chunk_window_end_ms)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `),
        getSubjectHistory: db.prepare(`
          SELECT * FROM subject_history WHERE meeting_id = ? ORDER BY detected_at DESC
        `),

        // Transcript Chunks
        insertChunk: db.prepare(`
          INSERT INTO transcript_chunks (id, meeting_id, chunk_index, window_start_ms, window_end_ms, content, speaker_ids, segment_ids)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `),
        getChunksByMeetingId: db.prepare(`
          SELECT * FROM transcript_chunks WHERE meeting_id = ? ORDER BY chunk_index
        `),

        // Relevance Labels
        insertRelevanceLabel: db.prepare(`
          INSERT INTO relevance_labels (id, meeting_id, chunk_id, relevance_type, score, reasoning, is_final)
          VALUES (?, ?, ?, ?, ?, ?, ?)
        `),
        updateRelevanceLabel: db.prepare(`
          UPDATE relevance_labels SET relevance_type = ?, score = ?, reasoning = ?, is_final = ? WHERE id = ?
        `),
        getRelevanceLabelsByMeetingId: db.prepare(`
          SELECT * FROM relevance_labels WHERE meeting_id = ?
        `),
        getRelevanceLabelByChunkId: db.prepare(`
          SELECT * FROM relevance_labels WHERE chunk_id = ?
        `),

        // Note Candidates
        insertCandidate: db.prepare(`
          INSERT INTO note_candidates (id, meeting_id, chunk_id, note_type, content, speaker_id, assignee, deadline, priority, relevance_type, relevance_score, is_duplicate, is_final, included_in_output, exclusion_reason, source_segment_ids)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `),
        updateCandidate: db.prepare(`
          UPDATE note_candidates
          SET relevance_type = ?, relevance_score = ?, is_duplicate = ?, is_final = ?, included_in_output = ?, exclusion_reason = ?, finalized_at = ?
          WHERE id = ?
        `),
        getCandidatesByMeetingId: db.prepare(`
          SELECT * FROM note_candidates WHERE meeting_id = ?
        `),
        getIncludedCandidates: db.prepare(`
          SELECT * FROM note_candidates WHERE meeting_id = ? AND included_in_output = 1
        `),

        // Sessions
        insertSession: db.prepare(`
          INSERT INTO subject_aware_sessions (id, meeting_id, status, config, chunks_processed, candidates_extracted, notes_finalized)
          VALUES (?, ?, ?, ?, ?, ?, ?)
        `),
        updateSession: db.prepare(`
          UPDATE subject_aware_sessions
          SET status = ?, chunks_processed = ?, candidates_extracted = ?, notes_finalized = ?, finalized_at = ?, error_message = ?
          WHERE id = ?
        `),
        getSessionByMeetingId: db.prepare(`
          SELECT * FROM subject_aware_sessions WHERE meeting_id = ? ORDER BY started_at DESC LIMIT 1
        `),
      }
    }
    return this.statements
  }

  public resetStatements(): void {
    this.statements = null
  }

  // --------------------------------------------------------------------------
  // Session Management
  // --------------------------------------------------------------------------

  /**
   * Start a new subject-aware note generation session
   */
  async startSession(
    meetingId: string,
    config?: Partial<SubjectAwareConfig>
  ): Promise<{ success: boolean; error?: string; llmProvider?: string }> {
    if (this.sessionState.isActive) {
      await this.stopSession()
    }

    // Check LLM availability
    const availability = await this.checkAvailability()
    if (!availability.available) {
      return { success: false, error: availability.error }
    }

    // Update config if provided
    if (config) {
      this.config = { ...this.config, ...config }
    }

    const sessionId = randomUUID()

    // Initialize session state
    this.sessionState = {
      isActive: true,
      meetingId,
      sessionId,
      status: 'active',
      startTime: Date.now(),
      currentSubject: null,
      processedSegmentIds: new Set<string>(),
      pendingSegments: [],
      lastChunkTime: null,
      chunksProcessed: 0,
      candidatesExtracted: 0,
      notesFinalized: 0,
      generatedCandidates: [],
      weightedTitles: new Map(),
      weightedGoals: new Map(),
      weightedKeywords: new Map(),
      detectionHistory: [],
    }

    // Store session in database
    if (this.config.storeDebugData) {
      try {
        this.getStatements().insertSession.run(
          sessionId,
          meetingId,
          'active',
          JSON.stringify(this.config),
          0, 0, 0
        )
      } catch (error) {
        console.warn('[SubjectAwareNoteGeneration] Failed to store session:', error)
      }
    }

    // Start batch processing timer
    this.startBatchTimer()

    console.log(`[SubjectAwareNoteGeneration] Session started for meeting ${meetingId}`)
    this.emitStatusUpdate('active')

    return { success: true, llmProvider: availability.modelInfo }
  }

  /**
   * Stop the session and finalize notes
   * This implements the end-of-meeting finalization workflow:
   * 1. Subject Locking - Generate final locked subject from complete transcript
   * 2. Final Relevance Re-Check - Re-classify all chunks using locked subject
   * 3. Candidate Finalization - Keep only candidates from In-Scope chunks, remove duplicates
   * 4. Final Output Generation - Generate clean structured notes
   * 5. Audit Trail - Store complete audit trail for debugging
   */
  async stopSession(): Promise<FinalizationResult> {
    this.stopBatchTimer()
    this.sessionState.status = 'finalizing'
    this.emitStatusUpdate('finalizing')

    const result: FinalizationResult = {
      success: true,
      notesCreated: 0,
      tasksCreated: 0,
      candidatesFiltered: 0,
      processingTimeMs: 0,
    }

    const startTime = Date.now()

    try {
      // Process any remaining pending segments
      if (this.sessionState.pendingSegments.length > 0) {
        console.log(`[SubjectAwareNoteGeneration] Processing ${this.sessionState.pendingSegments.length} remaining segments`)
        await this.processChunk()
      }

      const meetingId = this.sessionState.meetingId
      if (!meetingId) {
        return { ...result, success: false, error: 'No meeting ID' }
      }

      // STEP 1: Subject Locking
      // Generate final locked subject from complete transcript
      console.log(`[SubjectAwareNoteGeneration] Step 1: Locking final subject`)
      if (this.sessionState.currentSubject) {
        await this.lockSubject(this.sessionState.currentSubject.id)
        console.log(`[SubjectAwareNoteGeneration] Subject locked: "${this.sessionState.currentSubject.title}"`)
      }

      // STEP 2: Final Relevance Re-Check
      // Re-classify all chunks using locked subject, update relevance scores
      console.log(`[SubjectAwareNoteGeneration] Step 2: Re-checking relevance against locked subject`)
      const relevanceChanges = await this.finalizeRelevanceScoring(meetingId)

      // STEP 3: Candidate Finalization
      // Keep only candidates from In-Scope chunks, remove duplicates, validate action items
      console.log(`[SubjectAwareNoteGeneration] Step 3: Finalizing candidates`)
      const persistResult = await this.persistFinalNotes(meetingId)
      result.notesCreated = persistResult.notesCreated
      result.tasksCreated = persistResult.tasksCreated
      result.candidatesFiltered = persistResult.candidatesFiltered

      // STEP 4: Final Output Generation
      // Generate clean structured notes matching existing sections
      console.log(`[SubjectAwareNoteGeneration] Step 4: Generating final structured output`)
      result.finalOutput = await this.generateFinalStructuredOutput(meetingId)

      // STEP 5: Audit Trail
      // Store complete audit trail for debugging
      console.log(`[SubjectAwareNoteGeneration] Step 5: Creating audit trail`)
      result.auditTrail = await this.createFinalizationAuditTrail(meetingId, relevanceChanges)

      // Update session in database
      if (this.config.storeDebugData && this.sessionState.sessionId) {
        this.getStatements().updateSession.run(
          'completed',
          this.sessionState.chunksProcessed,
          this.sessionState.candidatesExtracted,
          result.notesCreated + result.tasksCreated,
          new Date().toISOString(),
          null,
          this.sessionState.sessionId
        )
      }

      this.sessionState.status = 'completed'
      this.emitStatusUpdate('completed')

      // Emit finalization complete event to trigger persistence
      this.emitFinalizationComplete({
        meetingId,
        notesCount: result.notesCreated,
        tasksCount: result.tasksCreated,
        filteredCount: result.candidatesFiltered,
        finalOutput: result.finalOutput,
        auditTrail: result.auditTrail,
      })

    } catch (error) {
      result.success = false
      result.error = error instanceof Error ? error.message : 'Unknown error'
      this.sessionState.status = 'error'
      this.emitStatusUpdate('error')

      if (this.config.storeDebugData && this.sessionState.sessionId) {
        this.getStatements().updateSession.run(
          'error',
          this.sessionState.chunksProcessed,
          this.sessionState.candidatesExtracted,
          0,
          null,
          result.error,
          this.sessionState.sessionId
        )
      }
    }

    result.processingTimeMs = Date.now() - startTime
    console.log(`[SubjectAwareNoteGeneration] Session stopped. Notes: ${result.notesCreated}, Tasks: ${result.tasksCreated}, Filtered: ${result.candidatesFiltered}`)

    this.sessionState = this.createInitialSessionState()
    return result
  }

  /**
   * Pause the session
   */
  pauseSession(): void {
    if (this.sessionState.isActive) {
      this.stopBatchTimer()
      this.sessionState.status = 'paused'
      this.emitStatusUpdate('paused')
      console.log('[SubjectAwareNoteGeneration] Session paused')
    }
  }

  /**
   * Resume the session
   */
  resumeSession(): void {
    if (this.sessionState.status === 'paused') {
      this.startBatchTimer()
      this.sessionState.status = 'active'
      this.emitStatusUpdate('active')
      console.log('[SubjectAwareNoteGeneration] Session resumed')
    }
  }

  // --------------------------------------------------------------------------
  // Segment Processing
  // --------------------------------------------------------------------------

  /**
   * Add transcript segments to the processing queue
   */
  addSegments(segments: TranscriptSegmentInput[]): void {
    if (!this.sessionState.isActive) {
      console.warn('[SubjectAwareNoteGeneration] Cannot add segments: session not active')
      return
    }

    // Filter out already processed segments
    const newSegments = segments.filter(
      (seg) => !this.sessionState.processedSegmentIds.has(seg.id)
    )

    if (newSegments.length === 0) return

    this.sessionState.pendingSegments.push(...newSegments)

    console.log(`[SubjectAwareNoteGeneration] Added ${newSegments.length} segments. Pending: ${this.sessionState.pendingSegments.length}`)

    this.emitBatchStateUpdate({
      pendingSegmentCount: this.sessionState.pendingSegments.length,
    })

    // Check if we should process immediately
    this.checkAndTriggerChunk()
  }

  /**
   * Check if we should trigger chunk processing
   */
  private checkAndTriggerChunk(): void {
    const { pendingSegments, lastChunkTime } = this.sessionState
    const { minSegmentsPerChunk, batchIntervalMs } = this.config

    if (this.isProcessing) return

    if (pendingSegments.length < minSegmentsPerChunk) return

    const timeSinceLastChunk = lastChunkTime
      ? Date.now() - lastChunkTime
      : batchIntervalMs

    if (timeSinceLastChunk >= batchIntervalMs) {
      this.processChunk()
    }
  }

  /**
   * Process a chunk of segments
   */
  private async processChunk(): Promise<void> {
    if (this.isProcessing || this.sessionState.pendingSegments.length === 0) return

    this.isProcessing = true
    this.emitStatusUpdate('processing')
    this.emitBatchStateUpdate({ isProcessing: true, lastBatchStartTime: Date.now() })

    const startTime = Date.now()

    try {
      // Get segments for this chunk (within time window)
      const chunkSegments = this.selectChunkSegments()

      if (chunkSegments.length === 0) {
        return
      }

      // Calculate time window
      const windowStart = Math.min(...chunkSegments.map(s => s.startTimeMs))
      const windowEnd = Math.max(...chunkSegments.map(s => s.endTimeMs))

      // Format chunk content
      const chunkContent = this.formatSegmentsForLLM(chunkSegments)

      // Store chunk in database
      const chunkId = randomUUID()
      if (this.config.storeDebugData) {
        this.getStatements().insertChunk.run(
          chunkId,
          this.sessionState.meetingId,
          this.sessionState.chunksProcessed,
          windowStart,
          windowEnd,
          chunkContent,
          JSON.stringify(chunkSegments.map(s => s.speakerId).filter(Boolean)),
          JSON.stringify(chunkSegments.map(s => s.id))
        )
      }

      // 1. Detect/Update subject
      const subjectResult = await this.detectSubject(chunkContent, windowStart, windowEnd)
      if (subjectResult) {
        await this.updateMeetingSubject(subjectResult)
      }

      // 2. Score relevance
      let relevanceResult: RelevanceScoringResult | null = null
      if (this.sessionState.currentSubject) {
        relevanceResult = await this.scoreRelevance(chunkContent)
        if (relevanceResult && this.config.storeDebugData) {
          this.getStatements().insertRelevanceLabel.run(
            randomUUID(),
            this.sessionState.meetingId,
            chunkId,
            relevanceResult.relevanceType,
            relevanceResult.score,
            relevanceResult.reasoning,
            0 // Not final yet
          )

          // Emit relevance event for debugging UI (live classification)
          this.emitRelevanceEvent({
            chunkId,
            chunkIndex: this.sessionState.chunksProcessed,
            relevanceType: relevanceResult.relevanceType,
            score: relevanceResult.score,
            reasoning: relevanceResult.reasoning,
            isFinal: false,
            windowStartMs: windowStart,
            windowEndMs: windowEnd,
          })
        }
      }

      // 3. Extract candidates (only if in scope)
      if (
        !relevanceResult ||
        relevanceResult.relevanceType === 'in_scope_important' ||
        relevanceResult.relevanceType === 'in_scope_minor' ||
        relevanceResult.relevanceType === 'unclear'
      ) {
        const candidates = await this.extractCandidates(chunkContent, chunkId, chunkSegments)
        this.sessionState.generatedCandidates.push(...candidates.candidates)
        this.sessionState.candidatesExtracted += candidates.candidates.length

        // Emit candidates to frontend (without publishing as final)
        this.emitCandidates(candidates.candidates)
      }

      // Mark segments as processed
      for (const seg of chunkSegments) {
        this.sessionState.processedSegmentIds.add(seg.id)
      }

      // Remove processed segments from pending
      this.sessionState.pendingSegments = this.sessionState.pendingSegments.filter(
        seg => !chunkSegments.some(cs => cs.id === seg.id)
      )

      this.sessionState.lastChunkTime = Date.now()
      this.sessionState.chunksProcessed++

      this.emitBatchStateUpdate({
        isProcessing: false,
        lastBatchCompleteTime: Date.now(),
        pendingSegmentCount: this.sessionState.pendingSegments.length,
        chunksProcessed: this.sessionState.chunksProcessed,
      })

      console.log(`[SubjectAwareNoteGeneration] Chunk processed in ${Date.now() - startTime}ms`)

    } catch (error) {
      console.error('[SubjectAwareNoteGeneration] Chunk processing error:', error)
      this.emitError({
        code: 'CHUNK_PROCESSING_ERROR',
        message: error instanceof Error ? error.message : 'Unknown error',
        timestamp: Date.now(),
        recoverable: true,
      })
      this.emitBatchStateUpdate({ isProcessing: false })
    } finally {
      this.isProcessing = false
      if (this.sessionState.isActive && this.sessionState.status !== 'paused') {
        this.emitStatusUpdate('active')
      }
    }
  }

  /**
   * Select segments for the current chunk based on time window
   */
  private selectChunkSegments(): TranscriptSegmentInput[] {
    const { pendingSegments } = this.sessionState
    const { minChunkWindowMs, maxChunkWindowMs, maxSegmentsPerChunk } = this.config

    if (pendingSegments.length === 0) return []

    // Sort by start time
    const sorted = [...pendingSegments].sort((a, b) => a.startTimeMs - b.startTimeMs)

    const selected: TranscriptSegmentInput[] = [sorted[0]]
    const windowStart = sorted[0].startTimeMs

    for (let i = 1; i < sorted.length && selected.length < maxSegmentsPerChunk; i++) {
      const segment = sorted[i]
      const windowDuration = segment.endTimeMs - windowStart

      // Stop if we exceed max window
      if (windowDuration > maxChunkWindowMs) break

      selected.push(segment)

      // If we've reached min window and have enough segments, we can stop
      if (windowDuration >= minChunkWindowMs && selected.length >= this.config.minSegmentsPerChunk) {
        // But continue if we're under max and have more segments
        if (windowDuration >= maxChunkWindowMs * 0.8) break
      }
    }

    return selected
  }

  /**
   * Format segments for LLM input
   */
  private formatSegmentsForLLM(segments: TranscriptSegmentInput[]): string {
    const lines: string[] = []
    let currentSpeaker: string | null = null
    let currentContent: string[] = []

    for (const segment of segments) {
      const speaker = segment.speaker || segment.speakerId || 'UNKNOWN'

      if (speaker !== currentSpeaker) {
        if (currentSpeaker !== null && currentContent.length > 0) {
          lines.push(`[${currentSpeaker}]: ${currentContent.join(' ')}`)
        }
        currentSpeaker = speaker
        currentContent = [segment.content]
      } else {
        currentContent.push(segment.content)
      }
    }

    if (currentSpeaker !== null && currentContent.length > 0) {
      lines.push(`[${currentSpeaker}]: ${currentContent.join(' ')}`)
    }

    return lines.join('\n\n')
  }

  // --------------------------------------------------------------------------
  // Subject Detection
  // --------------------------------------------------------------------------

  /**
   * Calculate exponential decay weight for a timestamp
   * More recent timestamps get higher weight (approaching 1.0)
   * Older timestamps decay exponentially (minimum 0.1)
   *
   * @param timestamp Detection timestamp in milliseconds
   * @param halfLifeMs Half-life for exponential decay (default: 120000ms = 2 minutes)
   * @returns Weight between 0.1 and 1.0
   */
  private calculateDetectionWeight(timestamp: number, halfLifeMs: number = 120000): number {
    const now = Date.now()
    const ageMs = now - timestamp

    // Exponential decay: weight = e^(-ln(2) * age / halfLife)
    // This gives 0.5 weight at halfLife, 0.25 at 2*halfLife, etc.
    const weight = Math.exp(-Math.LN2 * ageMs / halfLifeMs)

    // Clamp to minimum 0.1 to avoid complete decay
    return Math.max(0.1, Math.min(1.0, weight))
  }

  /**
   * Merge new subject detection with weighted history
   * Uses exponential time decay to weight recent detections higher
   *
   * @param newSubject Newly detected subject from LLM
   * @param detectionTime Timestamp of this detection
   * @returns Weighted-averaged subject with confidence score
   */
  private mergeWithWeightedHistory(
    newSubject: SubjectDetectionResult,
    detectionTime: number
  ): SubjectDetectionResult {
    // Add to detection history
    this.sessionState.detectionHistory.push({
      title: newSubject.title,
      goal: newSubject.goal,
      keywords: newSubject.scopeKeywords,
      timestamp: detectionTime,
      confidence: newSubject.confidence,
    })

    // Calculate weight for this detection
    const weight = this.calculateDetectionWeight(detectionTime)

    // Update weighted titles
    const titleKey = newSubject.title.toLowerCase().trim()
    const existingTitle = this.sessionState.weightedTitles.get(titleKey)
    if (existingTitle) {
      existingTitle.cumulativeWeight += weight
      existingTitle.lastSeenAt = detectionTime
      existingTitle.occurrenceCount += 1
    } else {
      this.sessionState.weightedTitles.set(titleKey, {
        value: newSubject.title,
        cumulativeWeight: weight,
        firstSeenAt: detectionTime,
        lastSeenAt: detectionTime,
        occurrenceCount: 1,
      })
    }

    // Update weighted goals
    const goalKey = newSubject.goal.toLowerCase().trim()
    const existingGoal = this.sessionState.weightedGoals.get(goalKey)
    if (existingGoal) {
      existingGoal.cumulativeWeight += weight
      existingGoal.lastSeenAt = detectionTime
      existingGoal.occurrenceCount += 1
    } else {
      this.sessionState.weightedGoals.set(goalKey, {
        value: newSubject.goal,
        cumulativeWeight: weight,
        firstSeenAt: detectionTime,
        lastSeenAt: detectionTime,
        occurrenceCount: 1,
      })
    }

    // Update weighted keywords
    for (const keyword of newSubject.scopeKeywords) {
      const keywordKey = keyword.toLowerCase().trim()
      const existingKeyword = this.sessionState.weightedKeywords.get(keywordKey)
      if (existingKeyword) {
        existingKeyword.cumulativeWeight += weight
        existingKeyword.lastSeenAt = detectionTime
        existingKeyword.occurrenceCount += 1
      } else {
        this.sessionState.weightedKeywords.set(keywordKey, {
          value: keyword,
          cumulativeWeight: weight,
          firstSeenAt: detectionTime,
          lastSeenAt: detectionTime,
          occurrenceCount: 1,
        })
      }
    }

    // Select highest-weighted title
    const bestTitle = Array.from(this.sessionState.weightedTitles.values())
      .sort((a, b) => b.cumulativeWeight - a.cumulativeWeight)[0]

    // Select highest-weighted goal
    const bestGoal = Array.from(this.sessionState.weightedGoals.values())
      .sort((a, b) => b.cumulativeWeight - a.cumulativeWeight)[0]

    // Select top weighted keywords (up to maxScopeKeywords)
    const bestKeywords = Array.from(this.sessionState.weightedKeywords.values())
      .sort((a, b) => b.cumulativeWeight - a.cumulativeWeight)
      .slice(0, this.config.maxScopeKeywords)
      .map(k => k.value)

    // Calculate confidence based on subject stability
    const confidence = this.calculateSubjectStability()

    return {
      title: bestTitle?.value || newSubject.title,
      goal: bestGoal?.value || newSubject.goal,
      scopeKeywords: bestKeywords.length > 0 ? bestKeywords : newSubject.scopeKeywords,
      confidence,
    }
  }

  /**
   * Calculate subject stability/confidence score
   * Based on consistency of titles, goals, and keywords over time
   *
   * @returns Confidence score from 0.0 (unstable) to 1.0 (stable)
   */
  private calculateSubjectStability(): number {
    const history = this.sessionState.detectionHistory

    // Need at least 2 detections to calculate stability
    if (history.length < 2) {
      return 0.3 // Low confidence for first detection
    }

    // Factor 1: Title Consistency (30% weight)
    // How many detections agree on the top title?
    const titleMap = new Map<string, number>()
    for (const detection of history) {
      const key = detection.title.toLowerCase().trim()
      titleMap.set(key, (titleMap.get(key) || 0) + 1)
    }
    const maxTitleCount = Math.max(...titleMap.values())
    const titleConsistency = maxTitleCount / history.length

    // Factor 2: Goal Consistency (25% weight)
    // How many detections agree on the top goal?
    const goalMap = new Map<string, number>()
    for (const detection of history) {
      const key = detection.goal.toLowerCase().trim()
      goalMap.set(key, (goalMap.get(key) || 0) + 1)
    }
    const maxGoalCount = Math.max(...goalMap.values())
    const goalConsistency = maxGoalCount / history.length

    // Factor 3: Keyword Stability (25% weight)
    // What percentage of keywords are recurring?
    const keywordOccurrences = new Map<string, number>()
    for (const detection of history) {
      for (const keyword of detection.keywords) {
        const key = keyword.toLowerCase().trim()
        keywordOccurrences.set(key, (keywordOccurrences.get(key) || 0) + 1)
      }
    }
    const recurringKeywords = Array.from(keywordOccurrences.values())
      .filter(count => count > 1).length
    const totalUniqueKeywords = keywordOccurrences.size
    const keywordStability = totalUniqueKeywords > 0
      ? recurringKeywords / totalUniqueKeywords
      : 0

    // Factor 4: Detection Count Bonus (20% weight)
    // More detections = higher confidence (plateaus at 5 detections)
    const detectionBonus = Math.min(1.0, history.length / 5)

    // Weighted combination
    const confidence =
      titleConsistency * 0.30 +
      goalConsistency * 0.25 +
      keywordStability * 0.25 +
      detectionBonus * 0.20

    return Math.max(0.0, Math.min(1.0, confidence))
  }

  /**
   * Detect meeting subject from content
   */
  private async detectSubject(
    content: string,
    windowStartMs: number,
    windowEndMs: number
  ): Promise<SubjectDetectionResult | null> {
    try {
      const messages: ChatMessage[] = [
        { role: 'system', content: SUBJECT_DETECTION_SYSTEM_PROMPT },
        { role: 'user', content: SUBJECT_DETECTION_USER_PROMPT.replace('{TRANSCRIPT}', content) },
      ]

      const response = await llmRoutingService.chatCompletion({
        messages,
        maxTokens: 1024,
        temperature: this.config.temperature,
      })

      if (!response.success || !response.data) {
        return null
      }

      const llmContent = response.data.choices[0]?.message?.content
      if (!llmContent) return null

      const parsed = this.parseJsonResponse(llmContent)
      if (!parsed) return null

      // Validate and constrain keywords
      let keywords = parsed.scopeKeywords || []
      if (keywords.length < this.config.minScopeKeywords) {
        // Not enough keywords, might be early in the meeting
        return null
      }
      if (keywords.length > this.config.maxScopeKeywords) {
        keywords = keywords.slice(0, this.config.maxScopeKeywords)
      }

      const rawSubject: SubjectDetectionResult = {
        title: parsed.title || 'Untitled Meeting',
        goal: parsed.goal || '',
        scopeKeywords: keywords,
        confidence: parsed.confidence || 0.5,
      }

      // Merge with weighted history for time-decayed averaging
      const mergedSubject = this.mergeWithWeightedHistory(rawSubject, Date.now())

      return mergedSubject
    } catch (error) {
      console.warn('[SubjectAwareNoteGeneration] Subject detection error:', error)
      return null
    }
  }

  /**
   * Update meeting subject in state and database
   */
  private async updateMeetingSubject(result: SubjectDetectionResult): Promise<void> {
    const meetingId = this.sessionState.meetingId
    if (!meetingId) return

    const stmts = this.getStatements()

    // Check if subject already exists
    const existing = stmts.getSubjectByMeetingId.get(meetingId) as any

    if (existing && existing.status === 'locked') {
      // Don't update locked subjects
      return
    }

    const subjectId = existing?.id || randomUUID()

    if (existing) {
      // Update existing draft subject
      stmts.updateSubject.run(
        result.title,
        result.goal,
        JSON.stringify(result.scopeKeywords),
        'draft',
        this.config.strictnessMode,
        result.confidence,
        null,
        subjectId
      )
    } else {
      // Create new subject
      stmts.insertSubject.run(
        subjectId,
        meetingId,
        result.title,
        result.goal,
        JSON.stringify(result.scopeKeywords),
        'draft',
        this.config.strictnessMode,
        result.confidence,
        null
      )
    }

    // Store in history for debugging
    if (this.config.storeDebugData) {
      const lastChunk = this.sessionState.chunksProcessed > 0
        ? this.getStatements().getChunksByMeetingId.all(meetingId).slice(-1)[0] as any
        : null

      stmts.insertSubjectHistory.run(
        randomUUID(),
        meetingId,
        result.title,
        result.goal,
        JSON.stringify(result.scopeKeywords),
        result.confidence,
        lastChunk?.window_start_ms || null,
        lastChunk?.window_end_ms || null
      )
    }

    // Update session state
    this.sessionState.currentSubject = {
      id: subjectId,
      meetingId,
      title: result.title,
      goal: result.goal,
      scopeKeywords: result.scopeKeywords,
      status: 'draft',
      strictnessMode: this.config.strictnessMode,
      confidenceScore: result.confidence,
      lockedAt: null,
      createdAt: existing?.created_at || new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    }

    // Emit subject update
    this.emitSubjectUpdate(this.sessionState.currentSubject)
  }

  /**
   * Lock the subject at end of meeting
   */
  private async lockSubject(subjectId: string): Promise<void> {
    this.getStatements().lockSubject.run(subjectId)
    if (this.sessionState.currentSubject) {
      this.sessionState.currentSubject.status = 'locked'
      this.sessionState.currentSubject.lockedAt = new Date().toISOString()
    }
  }

  // --------------------------------------------------------------------------
  // Relevance Scoring
  // --------------------------------------------------------------------------

  /**
   * Score content relevance against meeting subject
   */
  private async scoreRelevance(content: string): Promise<RelevanceScoringResult | null> {
    const subject = this.sessionState.currentSubject
    if (!subject) return null

    try {
      const userPrompt = RELEVANCE_SCORING_USER_PROMPT
        .replace('{TITLE}', subject.title || '')
        .replace('{GOAL}', subject.goal || '')
        .replace('{KEYWORDS}', subject.scopeKeywords.join(', '))
        .replace('{STRICTNESS}', subject.strictnessMode)
        .replace('{CONTENT}', content)

      const messages: ChatMessage[] = [
        { role: 'system', content: RELEVANCE_SCORING_SYSTEM_PROMPT },
        { role: 'user', content: userPrompt },
      ]

      const response = await llmRoutingService.chatCompletion({
        messages,
        maxTokens: 512,
        temperature: this.config.temperature,
      })

      if (!response.success || !response.data) return null

      const llmContent = response.data.choices[0]?.message?.content
      if (!llmContent) return null

      const parsed = this.parseJsonResponse(llmContent)
      if (!parsed) return null

      return {
        relevanceType: parsed.relevanceType || 'unclear',
        score: parsed.score || 0.5,
        reasoning: parsed.reasoning || '',
      }
    } catch (error) {
      console.warn('[SubjectAwareNoteGeneration] Relevance scoring error:', error)
      return null
    }
  }

  /**
   * Finalize relevance scoring for all chunks at end of meeting
   * Re-classifies all chunks against the locked subject for final accuracy
   * Returns array of relevance changes for audit trail
   */
  private async finalizeRelevanceScoring(meetingId: string): Promise<Array<{
    chunkId: string
    draftRelevance: RelevanceType | null
    finalRelevance: RelevanceType
    draftScore: number | null
    finalScore: number
  }>> {
    const relevanceChanges: Array<{
      chunkId: string
      draftRelevance: RelevanceType | null
      finalRelevance: RelevanceType
      draftScore: number | null
      finalScore: number
    }> = []

    const subject = this.sessionState.currentSubject
    if (!subject || subject.status !== 'locked') return relevanceChanges

    const stmts = this.getStatements()
    const chunks = stmts.getChunksByMeetingId.all(meetingId) as any[]

    console.log(`[SubjectAwareNoteGeneration] Finalizing relevance scoring for ${chunks.length} chunks with locked subject`)

    for (const chunk of chunks) {
      const existingLabel = stmts.getRelevanceLabelByChunkId.get(chunk.id) as any
      if (existingLabel?.is_final) continue

      // Re-score with locked subject (final pass)
      const result = await this.scoreRelevance(chunk.content)
      if (result) {
        // Track the change for audit trail
        relevanceChanges.push({
          chunkId: chunk.id,
          draftRelevance: existingLabel?.relevance_type || null,
          finalRelevance: result.relevanceType,
          draftScore: existingLabel?.score || null,
          finalScore: result.score,
        })

        if (existingLabel) {
          stmts.updateRelevanceLabel.run(
            result.relevanceType,
            result.score,
            result.reasoning,
            1, // Mark as final
            existingLabel.id
          )
        } else {
          stmts.insertRelevanceLabel.run(
            randomUUID(),
            meetingId,
            chunk.id,
            result.relevanceType,
            result.score,
            result.reasoning,
            1
          )
        }

        // Emit final relevance event for debugging UI
        this.emitRelevanceEvent({
          chunkId: chunk.id,
          chunkIndex: chunk.chunk_index,
          relevanceType: result.relevanceType,
          score: result.score,
          reasoning: result.reasoning,
          isFinal: true,
          windowStartMs: chunk.window_start_ms,
          windowEndMs: chunk.window_end_ms,
        })
      }
    }

    console.log(`[SubjectAwareNoteGeneration] Finalized relevance scoring complete. ${relevanceChanges.length} changes tracked`)
    return relevanceChanges
  }

  // --------------------------------------------------------------------------
  // Candidate Extraction
  // --------------------------------------------------------------------------

  /**
   * Extract note candidates from content
   */
  private async extractCandidates(
    content: string,
    chunkId: string,
    segments: TranscriptSegmentInput[]
  ): Promise<CandidateExtractionResult> {
    const startTime = Date.now()
    const candidates: NoteCandidate[] = []
    const meetingId = this.sessionState.meetingId

    if (!meetingId) {
      return { candidates: [], processingTimeMs: 0 }
    }

    const subject = this.sessionState.currentSubject
    const userPrompt = CANDIDATE_EXTRACTION_USER_PROMPT
      .replace('{TITLE}', subject?.title || 'General Discussion')
      .replace('{GOAL}', subject?.goal || 'No specific goal defined')
      .replace('{KEYWORDS}', subject?.scopeKeywords.join(', ') || 'general')
      .replace('{CONTENT}', content)

    try {
      const messages: ChatMessage[] = [
        { role: 'system', content: CANDIDATE_EXTRACTION_SYSTEM_PROMPT },
        { role: 'user', content: userPrompt },
      ]

      const response = await llmRoutingService.chatCompletion({
        messages,
        maxTokens: this.config.maxTokens,
        temperature: this.config.temperature,
      })

      if (!response.success || !response.data) {
        return { candidates: [], processingTimeMs: Date.now() - startTime }
      }

      const llmContent = response.data.choices[0]?.message?.content
      if (!llmContent) {
        return { candidates: [], processingTimeMs: Date.now() - startTime }
      }

      const parsed = this.parseJsonResponse(llmContent)
      if (!parsed) {
        return { candidates: [], processingTimeMs: Date.now() - startTime }
      }

      const segmentIds = segments.map(s => s.id)

      // Process key points
      if (Array.isArray(parsed.keyPoints)) {
        for (const item of parsed.keyPoints) {
          if (item.content && !this.isDuplicateContent(item.content, candidates)) {
            const candidate = this.createCandidate(meetingId, chunkId, 'key_point', item, segmentIds)
            candidates.push(candidate)
            if (this.config.storeDebugData) this.storeCandidate(candidate)
          }
        }
      }

      // Process decisions
      if (Array.isArray(parsed.decisions)) {
        for (const item of parsed.decisions) {
          if (item.content && !this.isDuplicateContent(item.content, candidates)) {
            const candidate = this.createCandidate(meetingId, chunkId, 'decision', item, segmentIds)
            candidates.push(candidate)
            if (this.config.storeDebugData) this.storeCandidate(candidate)
          }
        }
      }

      // Process action items with validation
      if (Array.isArray(parsed.actionItems)) {
        for (const item of parsed.actionItems) {
          if (item.content && !this.isDuplicateContent(item.content, candidates)) {
            const candidate = this.createCandidate(meetingId, chunkId, 'action_item', item, segmentIds)

            // Validate action item against quality criteria
            const validationResult = await actionItemValidationService.validate(
              {
                task: item.content,
                assignee: item.assignee || null,
                deadline: item.deadline || null,
                priority: item.priority || null,
                context: null,
                speaker: item.speaker || null
              },
              subject ? {
                title: subject.title,
                goal: subject.goal,
                scopeKeywords: subject.scopeKeywords
              } : null,
              false // Don't use LLM validation during live processing for performance
            )

            candidate.validationResult = validationResult

            // If validation fails, downgrade to task
            if (!validationResult.isValid) {
              candidate.noteType = 'task'
              candidate.exclusionReason = actionItemValidationService.formatValidationFailure(validationResult)
            }

            candidates.push(candidate)
            if (this.config.storeDebugData) this.storeCandidate(candidate)
          }
        }
      }

      // Process tasks
      if (Array.isArray(parsed.tasks)) {
        for (const item of parsed.tasks) {
          if (item.content && !this.isDuplicateContent(item.content, candidates)) {
            const candidate = this.createCandidate(meetingId, chunkId, 'task', item, segmentIds)
            candidates.push(candidate)
            if (this.config.storeDebugData) this.storeCandidate(candidate)
          }
        }
      }

      // Process other notes
      if (Array.isArray(parsed.otherNotes)) {
        for (const item of parsed.otherNotes) {
          if (item.content && !this.isDuplicateContent(item.content, candidates)) {
            const candidate = this.createCandidate(meetingId, chunkId, 'other_note', item, segmentIds)
            candidates.push(candidate)
            if (this.config.storeDebugData) this.storeCandidate(candidate)
          }
        }
      }

    } catch (error) {
      console.warn('[SubjectAwareNoteGeneration] Candidate extraction error:', error)
    }

    return {
      candidates,
      processingTimeMs: Date.now() - startTime,
    }
  }

  private createCandidate(
    meetingId: string,
    chunkId: string,
    noteType: CandidateNoteType,
    item: any,
    segmentIds: string[]
  ): NoteCandidate {
    return {
      id: randomUUID(),
      meetingId,
      chunkId,
      noteType,
      content: item.content,
      speakerId: item.speaker || null,
      assignee: item.assignee || null,
      deadline: item.deadline || null,
      priority: ['high', 'medium', 'low'].includes(item.priority) ? item.priority : null,
      relevanceType: null,
      relevanceScore: null,
      isDuplicate: false,
      isFinal: false,
      includedInOutput: false,
      exclusionReason: null,
      sourceSegmentIds: segmentIds,
      extractedAt: new Date().toISOString(),
      finalizedAt: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    }
  }

  private storeCandidate(candidate: NoteCandidate): void {
    this.getStatements().insertCandidate.run(
      candidate.id,
      candidate.meetingId,
      candidate.chunkId,
      candidate.noteType,
      candidate.content,
      candidate.speakerId,
      candidate.assignee,
      candidate.deadline,
      candidate.priority,
      candidate.relevanceType,
      candidate.relevanceScore,
      candidate.isDuplicate ? 1 : 0,
      candidate.isFinal ? 1 : 0,
      candidate.includedInOutput ? 1 : 0,
      candidate.exclusionReason,
      JSON.stringify(candidate.sourceSegmentIds)
    )
  }

  /**
   * Check if content is duplicate of existing candidates
   */
  private isDuplicateContent(content: string, candidates: NoteCandidate[]): boolean {
    const normalizedContent = content.toLowerCase().trim()
    return candidates.some(c =>
      this.calculateSimilarity(c.content.toLowerCase().trim(), normalizedContent) > 0.85
    )
  }

  private calculateSimilarity(a: string, b: string): number {
    if (a === b) return 1
    if (a.length === 0 || b.length === 0) return 0

    const aWords = new Set(a.split(/\s+/))
    const bWords = new Set(b.split(/\s+/))

    const intersection = [...aWords].filter(w => bWords.has(w)).length
    const union = new Set([...aWords, ...bWords]).size

    return intersection / union
  }

  // --------------------------------------------------------------------------
  // Final Note Persistence
  // --------------------------------------------------------------------------

  /**
   * Persist final notes to database after filtering
   */
  private async persistFinalNotes(meetingId: string): Promise<{
    notesCreated: number
    tasksCreated: number
    candidatesFiltered: number
  }> {
    let notesCreated = 0
    let tasksCreated = 0
    let candidatesFiltered = 0

    const stmts = this.getStatements()
    const allCandidates = stmts.getCandidatesByMeetingId.all(meetingId) as any[]
    const relevanceLabels = stmts.getRelevanceLabelsByMeetingId.all(meetingId) as any[]

    // Build map of chunk relevance
    const chunkRelevance = new Map<string, { type: RelevanceType; score: number }>()
    for (const label of relevanceLabels) {
      if (label.is_final) {
        chunkRelevance.set(label.chunk_id, {
          type: label.relevance_type,
          score: label.score,
        })
      }
    }

    // Filter and deduplicate candidates
    const seenContent = new Set<string>()
    const includedCandidates: any[] = []

    for (const candidate of allCandidates) {
      const normalizedContent = candidate.content.toLowerCase().trim()

      // Check for duplicates
      if (seenContent.has(normalizedContent) || this.isDuplicateContent(candidate.content, includedCandidates.map(c => ({
        ...c,
        content: c.content,
        id: c.id,
        meetingId: c.meeting_id,
        chunkId: c.chunk_id,
        noteType: c.note_type as CandidateNoteType,
        speakerId: c.speaker_id,
        deadline: c.deadline,
        priority: c.priority,
        relevanceType: c.relevance_type,
        relevanceScore: c.relevance_score,
        isDuplicate: c.is_duplicate,
        isFinal: c.is_final,
        includedInOutput: c.included_in_output,
        exclusionReason: c.exclusion_reason,
        sourceSegmentIds: JSON.parse(c.source_segment_ids || '[]'),
        extractedAt: c.extracted_at,
        finalizedAt: c.finalized_at,
        createdAt: c.created_at,
        updatedAt: c.updated_at,
      })))) {
        stmts.updateCandidate.run(
          candidate.relevance_type,
          candidate.relevance_score,
          1, // is_duplicate
          1, // is_final
          0, // not included
          'duplicate',
          new Date().toISOString(),
          candidate.id
        )
        candidatesFiltered++
        continue
      }

      // Check relevance based on strictness mode using explicit thresholds
      const chunkRel = candidate.chunk_id ? chunkRelevance.get(candidate.chunk_id) : null
      let shouldInclude = true
      let exclusionReason: string | null = null

      if (chunkRel) {
        const thresholds = this.getFilteringThresholds()

        // Apply filtering based on relevance type and thresholds
        if (chunkRel.type === 'out_of_scope') {
          // Out-of-scope is always excluded
          shouldInclude = false
          exclusionReason = `out_of_scope_${this.config.strictnessMode}`
        } else if (chunkRel.type === 'in_scope_important') {
          // Important items are always included in all modes
          shouldInclude = true
        } else if (chunkRel.type === 'in_scope_minor') {
          // Minor items: check if mode includes them and if score meets threshold
          if (!thresholds.includeMinor) {
            shouldInclude = false
            exclusionReason = `minor_excluded_${this.config.strictnessMode}`
          } else if (chunkRel.score < thresholds.minScoreForMinor) {
            shouldInclude = false
            exclusionReason = `minor_low_score_${this.config.strictnessMode}`
          }
        } else if (chunkRel.type === 'unclear') {
          // Unclear items: check if mode includes them and if score meets threshold
          if (!thresholds.includeUnclear) {
            shouldInclude = false
            exclusionReason = `unclear_excluded_${this.config.strictnessMode}`
          } else if (chunkRel.score < thresholds.minScoreForUnclear) {
            shouldInclude = false
            exclusionReason = `unclear_low_score_${this.config.strictnessMode}`
          }
        }
      }

      if (!shouldInclude) {
        stmts.updateCandidate.run(
          chunkRel?.type || candidate.relevance_type,
          chunkRel?.score || candidate.relevance_score,
          0,
          1,
          0,
          exclusionReason,
          new Date().toISOString(),
          candidate.id
        )
        candidatesFiltered++
        continue
      }

      // Mark as included
      stmts.updateCandidate.run(
        chunkRel?.type || candidate.relevance_type,
        chunkRel?.score || candidate.relevance_score,
        0,
        1,
        1, // included
        null,
        new Date().toISOString(),
        candidate.id
      )

      seenContent.add(normalizedContent)
      includedCandidates.push(candidate)
    }

    // Create final notes and tasks
    for (const candidate of includedCandidates) {
      try {
        const noteType = this.mapCandidateTypeToNoteType(candidate.note_type)
        const sourceIds = JSON.parse(candidate.source_segment_ids || '[]')

        // Build context with validation info if available
        let context = `Subject-aware extraction (${this.config.strictnessMode} mode)`
        if (candidate.exclusion_reason) {
          context += `\n${candidate.exclusion_reason}`
        }

        // Format content for action items that passed validation
        let content = candidate.content
        if (candidate.note_type === 'action_item' && candidate.assignee && candidate.deadline) {
          content = actionItemValidationService.formatActionItem({
            task: candidate.content,
            assignee: candidate.assignee,
            deadline: candidate.deadline,
            priority: candidate.priority
          })
        }

        // Create meeting note
        meetingNoteService.create({
          meeting_id: meetingId,
          content: content,
          note_type: noteType,
          is_ai_generated: true,
          source_transcript_ids: sourceIds,
          created_during_recording: true,
          generation_timestamp: candidate.extracted_at,
          context: context,
          confidence_score: candidate.relevance_score,
          speaker_id: candidate.speaker_id,
        })
        notesCreated++

        // Create task for action items and tasks
        if (candidate.note_type === 'action_item' || candidate.note_type === 'task') {
          let taskDescription = candidate.speaker_id ? `From ${candidate.speaker_id} during meeting` : 'Extracted from subject-aware analysis'

          // Add validation failure info to task description if applicable
          if (candidate.exclusion_reason && candidate.exclusion_reason.startsWith('Moved to Tasks:')) {
            taskDescription += `\n\n${candidate.exclusion_reason}`
          }

          taskService.create({
            meeting_id: meetingId,
            title: candidate.content,
            description: taskDescription,
            assignee: candidate.assignee,
            due_date: candidate.deadline,
            priority: this.mapPriorityToTaskPriority(candidate.priority),
            status: 'pending',
            created_during_recording: true,
            generation_timestamp: candidate.extracted_at,
          })
          tasksCreated++
        }
      } catch (error) {
        console.error('[SubjectAwareNoteGeneration] Failed to persist candidate:', error)
      }
    }

    return { notesCreated, tasksCreated, candidatesFiltered }
  }

  private mapCandidateTypeToNoteType(candidateType: string): NoteType {
    switch (candidateType) {
      case 'key_point': return 'key_point'
      case 'decision': return 'decision'
      case 'action_item': return 'action_item'
      case 'task': return 'action_item'
      case 'other_note': return 'custom'
      default: return 'custom'
    }
  }

  private mapPriorityToTaskPriority(priority: string | null): TaskPriority {
    switch (priority) {
      case 'high': return 'high'
      case 'medium': return 'medium'
      case 'low': return 'low'
      default: return 'medium'
    }
  }

  // --------------------------------------------------------------------------
  // Timer Management
  // --------------------------------------------------------------------------

  private startBatchTimer(): void {
    this.stopBatchTimer()
    this.batchTimer = setInterval(() => {
      if (this.sessionState.isActive && !this.isProcessing && this.sessionState.status !== 'paused') {
        this.checkAndTriggerChunk()
      }
    }, 5000)
  }

  private stopBatchTimer(): void {
    if (this.batchTimer) {
      clearInterval(this.batchTimer)
      this.batchTimer = null
    }
  }

  // --------------------------------------------------------------------------
  // Utility Methods
  // --------------------------------------------------------------------------

  private parseJsonResponse(content: string): any | null {
    try {
      let jsonContent = content.trim()
      if (jsonContent.startsWith('```')) {
        const match = jsonContent.match(/```(?:json)?\s*([\s\S]*?)```/)
        if (match) {
          jsonContent = match[1].trim()
        }
      }
      return JSON.parse(jsonContent)
    } catch {
      return null
    }
  }

  async checkAvailability(): Promise<{
    available: boolean
    error?: string
    modelInfo?: string
  }> {
    try {
      const health = await llmRoutingService.checkHealth(true)
      if (!health.success || !health.data?.healthy) {
        return {
          available: false,
          error: health.error || 'No LLM provider available',
        }
      }
      return {
        available: true,
        modelInfo: health.data.loadedModel,
      }
    } catch (error) {
      return {
        available: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      }
    }
  }

  getSessionState(): {
    isActive: boolean
    meetingId: string | null
    status: SessionStatus
    chunksProcessed: number
    candidatesExtracted: number
    currentSubject: MeetingSubject | null
  } {
    return {
      isActive: this.sessionState.isActive,
      meetingId: this.sessionState.meetingId,
      status: this.sessionState.status,
      chunksProcessed: this.sessionState.chunksProcessed,
      candidatesExtracted: this.sessionState.candidatesExtracted,
      currentSubject: this.sessionState.currentSubject,
    }
  }

  getConfig(): SubjectAwareConfig {
    return { ...this.config }
  }

  updateConfig(config: Partial<SubjectAwareConfig>): void {
    this.config = { ...this.config, ...config }
  }

  // --------------------------------------------------------------------------
  // Final Output Generation & Audit Trail
  // --------------------------------------------------------------------------

  /**
   * Generate final structured output matching existing sections
   * Sections: Subject, Goal, Key Points, Decisions, Action Items, Tasks, Other Notes
   */
  private async generateFinalStructuredOutput(meetingId: string): Promise<FinalStructuredOutput> {
    const stmts = this.getStatements()
    const includedCandidates = stmts.getIncludedCandidates.all(meetingId) as any[]
    const subject = this.sessionState.currentSubject

    const output: FinalStructuredOutput = {
      subject: {
        title: subject?.title || 'Untitled Meeting',
        goal: subject?.goal || 'No specific goal defined',
        scopeKeywords: subject?.scopeKeywords || [],
      },
      keyPoints: [],
      decisions: [],
      actionItems: [],
      tasks: [],
      otherNotes: [],
    }

    // Organize candidates by type
    for (const candidate of includedCandidates) {
      switch (candidate.note_type) {
        case 'key_point':
          output.keyPoints.push(candidate.content)
          break
        case 'decision':
          output.decisions.push(candidate.content)
          break
        case 'action_item':
          output.actionItems.push({
            content: candidate.content,
            assignee: candidate.assignee,
            deadline: candidate.deadline,
            priority: candidate.priority,
          })
          break
        case 'task':
          output.tasks.push({
            content: candidate.content,
            assignee: candidate.assignee,
            deadline: candidate.deadline,
            priority: candidate.priority,
          })
          break
        case 'other_note':
          output.otherNotes.push(candidate.content)
          break
      }
    }

    console.log(`[SubjectAwareNoteGeneration] Final output generated: ${output.keyPoints.length} key points, ${output.decisions.length} decisions, ${output.actionItems.length} action items, ${output.tasks.length} tasks, ${output.otherNotes.length} other notes`)

    return output
  }

  /**
   * Create complete audit trail for finalization workflow
   * Stores: draft subject history, locked subject, relevance changes, filtered candidates, final output
   */
  private async createFinalizationAuditTrail(
    meetingId: string,
    relevanceChanges: Array<{
      chunkId: string
      draftRelevance: RelevanceType | null
      finalRelevance: RelevanceType
      draftScore: number | null
      finalScore: number
    }>
  ): Promise<FinalizationAuditTrail> {
    const stmts = this.getStatements()

    // Get draft subject history
    const historyRows = stmts.getSubjectHistory.all(meetingId) as any[]
    const draftSubjectHistory: SubjectHistory[] = historyRows.map(row => ({
      id: row.id,
      meetingId: row.meeting_id,
      title: row.title,
      goal: row.goal,
      scopeKeywords: JSON.parse(row.scope_keywords || '[]'),
      confidenceScore: row.confidence_score,
      detectedAt: row.detected_at,
      chunkWindowStartMs: row.chunk_window_start_ms,
      chunkWindowEndMs: row.chunk_window_end_ms,
    }))

    // Get all candidates
    const allCandidates = stmts.getCandidatesByMeetingId.all(meetingId) as any[]

    // Separate filtered and included candidates
    const filteredCandidates = allCandidates
      .filter(c => !c.included_in_output && c.is_final)
      .map(c => ({
        candidateId: c.id,
        content: c.content,
        noteType: c.note_type as CandidateNoteType,
        exclusionReason: c.exclusion_reason || 'unknown',
      }))

    const includedCandidates = allCandidates
      .filter(c => c.included_in_output && c.is_final)
      .map(c => ({
        candidateId: c.id,
        content: c.content,
        noteType: c.note_type as CandidateNoteType,
      }))

    const auditTrail: FinalizationAuditTrail = {
      meetingId,
      sessionId: this.sessionState.sessionId,
      draftSubjectHistory,
      lockedSubject: this.sessionState.currentSubject,
      totalChunksProcessed: this.sessionState.chunksProcessed,
      totalCandidatesExtracted: this.sessionState.candidatesExtracted,
      relevanceChanges,
      filteredCandidates,
      includedCandidates,
      finalizedAt: new Date().toISOString(),
      strictnessMode: this.config.strictnessMode,
    }

    console.log(`[SubjectAwareNoteGeneration] Audit trail created: ${draftSubjectHistory.length} subject detections, ${relevanceChanges.length} relevance changes, ${filteredCandidates.length} filtered, ${includedCandidates.length} included`)

    return auditTrail
  }

  // --------------------------------------------------------------------------
  // IPC Event Emission
  // --------------------------------------------------------------------------

  private emitStatusUpdate(status: SessionStatus): void {
    const windows = BrowserWindow.getAllWindows()
    for (const win of windows) {
      win.webContents.send('subjectAwareNotes:status', { status, timestamp: Date.now() })
    }
  }

  private emitCandidates(candidates: NoteCandidate[]): void {
    const windows = BrowserWindow.getAllWindows()
    for (const win of windows) {
      win.webContents.send('subjectAwareNotes:candidates', candidates)
    }
  }

  /**
   * Get stability status from confidence score
   */
  private getStabilityStatus(score: number): 'unstable' | 'emerging' | 'likely_stable' | 'stable' {
    if (score < 0.4) return 'unstable'
    if (score < 0.6) return 'emerging'
    if (score < 0.85) return 'likely_stable'
    return 'stable'
  }

  /**
   * Get user-friendly stability message
   */
  private getStabilityMessage(score: number): string {
    const percentage = Math.round(score * 100)
    const status = this.getStabilityStatus(score)

    switch (status) {
      case 'unstable':
        return `Subject confidence: ${percentage}% - detecting subject...`
      case 'emerging':
        return `Subject confidence: ${percentage}% - subject emerging...`
      case 'likely_stable':
        return `Subject confidence: ${percentage}% - likely stable`
      case 'stable':
        return `Subject confidence: ${percentage}% - stable`
    }
  }

  /**
   * Emit subject update to UI with confidence information
   */
  private emitSubjectUpdate(subject: MeetingSubject): void {
    const windows = BrowserWindow.getAllWindows()
    const payload = {
      ...subject,
      isDraft: subject.status === 'draft',
      confidence: {
        score: subject.confidenceScore,
        status: this.getStabilityStatus(subject.confidenceScore),
        message: this.getStabilityMessage(subject.confidenceScore),
        detectionCount: this.sessionState.detectionHistory.length,
      },
    }

    for (const win of windows) {
      win.webContents.send('subjectAwareNotes:subject', payload)
    }

    // Also emit standalone confidence update
    this.emitConfidenceUpdate(subject.confidenceScore)
  }

  /**
   * Emit standalone confidence update to UI
   */
  private emitConfidenceUpdate(score: number): void {
    const windows = BrowserWindow.getAllWindows()
    const payload = {
      score,
      status: this.getStabilityStatus(score),
      message: this.getStabilityMessage(score),
      detectionCount: this.sessionState.detectionHistory.length,
      lastUpdated: Date.now(),
    }

    for (const win of windows) {
      win.webContents.send('subjectAwareNotes:confidence', payload)
    }
  }

  private emitBatchStateUpdate(state: Record<string, unknown>): void {
    const windows = BrowserWindow.getAllWindows()
    for (const win of windows) {
      win.webContents.send('subjectAwareNotes:batchState', { ...state, timestamp: Date.now() })
    }
  }

  private emitError(error: {
    code: string
    message: string
    timestamp: number
    recoverable: boolean
  }): void {
    const windows = BrowserWindow.getAllWindows()
    for (const win of windows) {
      win.webContents.send('subjectAwareNotes:error', error)
    }
  }

  private emitNotesPersisted(data: {
    meetingId: string
    notesCount: number
    tasksCount: number
  }): void {
    const windows = BrowserWindow.getAllWindows()
    for (const win of windows) {
      win.webContents.send('subjectAwareNotes:persisted', { ...data, timestamp: Date.now() })
    }
  }

  /**
   * Emit finalization complete event to trigger persistence
   * This event includes the full finalization result with structured output and audit trail
   */
  private emitFinalizationComplete(data: {
    meetingId: string
    notesCount: number
    tasksCount: number
    filteredCount: number
    finalOutput: FinalStructuredOutput | undefined
    auditTrail: FinalizationAuditTrail | undefined
  }): void {
    const windows = BrowserWindow.getAllWindows()
    const payload = {
      ...data,
      timestamp: Date.now(),
    }

    for (const win of windows) {
      win.webContents.send('subjectAwareNotes:finalizationComplete', payload)
    }

    console.log(`[SubjectAwareNoteGeneration] Finalization complete event emitted for meeting ${data.meetingId}`)
  }

  /**
   * Emit relevance classification event for debugging UI
   * This allows the UI to display real-time relevance scoring during recording
   */
  private emitRelevanceEvent(event: {
    chunkId: string
    chunkIndex: number
    relevanceType: RelevanceType
    score: number
    reasoning: string | null
    isFinal: boolean
    windowStartMs: number
    windowEndMs: number
  }): void {
    const windows = BrowserWindow.getAllWindows()
    const payload = {
      ...event,
      timestamp: Date.now(),
      meetingId: this.sessionState.meetingId,
    }

    for (const win of windows) {
      win.webContents.send('subjectAwareNotes:relevance', payload)
    }

    // Log for debugging
    if (this.config.storeDebugData) {
      const percentage = Math.round(event.score * 100)
      console.log(
        `[SubjectAwareNoteGeneration] Relevance ${event.isFinal ? '[FINAL]' : '[DRAFT]'}: ` +
        `Chunk ${event.chunkIndex} - ${event.relevanceType} (${percentage}%) - ${event.reasoning || 'no reasoning'}`
      )
    }
  }

  /**
   * Get filtering thresholds for the current strictness mode
   * This defines which relevance types are included in the final output
   */
  getFilteringThresholds(): {
    strictnessMode: StrictnessMode
    includeImportant: boolean
    includeMinor: boolean
    includeUnclear: boolean
    minScoreForMinor: number
    minScoreForUnclear: number
    description: string
  } {
    const mode = this.config.strictnessMode

    switch (mode) {
      case 'strict':
        return {
          strictnessMode: 'strict',
          includeImportant: true,
          includeMinor: false,
          includeUnclear: false,
          minScoreForMinor: 0.8,
          minScoreForUnclear: 0.9,
          description: 'Strict mode: Only Important items directly addressing the subject/goal'
        }
      case 'balanced':
        return {
          strictnessMode: 'balanced',
          includeImportant: true,
          includeMinor: true,
          includeUnclear: false,
          minScoreForMinor: 0.3,
          minScoreForUnclear: 0.7,
          description: 'Balanced mode: Important + Minor (supporting details)'
        }
      case 'loose':
        return {
          strictnessMode: 'loose',
          includeImportant: true,
          includeMinor: true,
          includeUnclear: true,
          minScoreForMinor: 0.2,
          minScoreForUnclear: 0.4,
          description: 'Loose mode: Important + Minor + some context (Unclear with score >= 0.4)'
        }
    }
  }
}

// ============================================================================
// Singleton Export
// ============================================================================

export const subjectAwareNoteGenerationService = new SubjectAwareNoteGenerationService()

export function resetSubjectAwareNoteGenerationStatements(): void {
  subjectAwareNoteGenerationService.resetStatements()
}

export default subjectAwareNoteGenerationService
