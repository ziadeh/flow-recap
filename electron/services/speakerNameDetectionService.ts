/**
 * Speaker Name Detection Service
 *
 * Implements intelligent speaker name identification that analyzes live transcript
 * content to automatically associate speaker IDs with real names using contextual cues.
 *
 * Detection Methods:
 * 1. Self-introduction detection: "Hi, I'm [Name]", "My name is [Name]"
 * 2. Name-reference detection: When Speaker A mentions a name and Speaker B begins speaking
 * 3. Temporal correlation: Track name mentions and speaker changes over time
 *
 * Confidence Scoring:
 * - High: >= 0.8 (direct self-introduction)
 * - Medium: 0.5 - 0.8 (name reference with speaker change)
 * - Low: < 0.5 (ambiguous references)
 *
 * Auto-apply threshold: > 0.6 for initial display
 */

import { randomUUID } from 'crypto'
import type Database from 'better-sqlite3'
import { getDatabaseService } from './database'
import { meetingSpeakerNameService } from './meetingSpeakerNameService'
import { speakerService } from './speakerService'
import type {
  SpeakerNameCandidate,
  CreateSpeakerNameCandidateInput,
  UpdateSpeakerNameCandidateInput,
  SpeakerNameDetectionEvent,
  CreateSpeakerNameDetectionEventInput,
  NameDetectionResult,
  SpeakerNameDetectionConfig,
  SpeakerNameSuggestion,
  MeetingSpeakerNameSummary,
  SpeakerNameDetectionType,
  NameConfidenceLevel
} from '../../src/types/database'

// ============================================================================
// Default Configuration
// ============================================================================

export const DEFAULT_SPEAKER_NAME_DETECTION_CONFIG: SpeakerNameDetectionConfig = {
  // Confidence thresholds
  highConfidenceThreshold: 0.8,
  mediumConfidenceThreshold: 0.5,
  autoApplyThreshold: 0.6,

  // Temporal correlation settings
  nameReferenceWindowMs: 7000,         // 7 seconds window after name mention
  speakerChangeToleranceMs: 2000,      // 2 second tolerance for matching speaker changes

  // Detection settings
  enableSelfIntroductionDetection: true,
  enableNameReferenceDetection: true,
  enableTemporalCorrelation: true,

  // Common words to exclude from name detection
  excludedWords: [
    // Common words that are also names
    'will', 'may', 'june', 'august', 'hope', 'faith', 'joy', 'grace',
    'dawn', 'eve', 'summer', 'autumn', 'winter', 'spring',
    'bill', 'bob', 'art', 'gene', 'ray', 'pat', 'rob', 'mark',
    // Titles and roles
    'doctor', 'professor', 'mr', 'mrs', 'ms', 'miss', 'sir', 'ma\'am',
    // Common meeting words
    'everyone', 'anybody', 'somebody', 'nobody', 'anyone', 'someone',
    'team', 'folks', 'guys', 'people', 'all', 'group',
    // Technical terms
    'user', 'admin', 'client', 'server', 'host', 'guest'
  ]
}

// ============================================================================
// Self-Introduction Patterns (Regex)
// ============================================================================

/**
 * Patterns for detecting self-introductions
 * Each pattern includes the regex and the capturing group index for the name
 */
const SELF_INTRODUCTION_PATTERNS = [
  // "Hi, I'm John" / "Hello, I'm John" / "Hey, I'm John"
  { pattern: /(?:hi|hello|hey),?\s+(?:i'm|i am|im)\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)/i, nameGroup: 1, confidence: 0.9 },

  // "My name is John"
  { pattern: /my\s+name\s+is\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)/i, nameGroup: 1, confidence: 0.95 },

  // "This is John speaking" / "This is John"
  { pattern: /this\s+is\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)\s*(?:speaking|here)?/i, nameGroup: 1, confidence: 0.85 },

  // "John here" (at start of sentence or after greeting)
  { pattern: /^(?:(?:hi|hello|hey),?\s+)?([A-Z][a-z]+)\s+here\b/i, nameGroup: 1, confidence: 0.8 },

  // "I'm John" (standalone)
  { pattern: /^(?:i'm|i am|im)\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)/i, nameGroup: 1, confidence: 0.85 },

  // "It's John" (phone call style)
  { pattern: /(?:it's|its|it is)\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)\s*(?:here|calling|speaking)?/i, nameGroup: 1, confidence: 0.8 },

  // "You can call me John"
  { pattern: /you\s+can\s+call\s+me\s+([A-Z][a-z]+)/i, nameGroup: 1, confidence: 0.9 },

  // "They call me John"
  { pattern: /(?:they|people)\s+call\s+me\s+([A-Z][a-z]+)/i, nameGroup: 1, confidence: 0.85 }
]

// ============================================================================
// Name Reference Patterns
// ============================================================================

/**
 * Patterns for detecting when someone mentions a name (not self-introduction)
 */
const NAME_REFERENCE_PATTERNS = [
  // "Thanks John" / "Thank you John"
  { pattern: /(?:thanks?|thank\s+you),?\s+([A-Z][a-z]+)/i, nameGroup: 1 },

  // "John, what do you think?"
  { pattern: /^([A-Z][a-z]+),?\s+(?:what|could|would|can|do|are|how)/i, nameGroup: 1 },

  // "Over to you, John" / "Your turn, John"
  { pattern: /(?:over\s+to\s+you|your\s+turn),?\s+([A-Z][a-z]+)/i, nameGroup: 1 },

  // "Go ahead, John"
  { pattern: /go\s+ahead,?\s+([A-Z][a-z]+)/i, nameGroup: 1 },

  // "John, go ahead"
  { pattern: /^([A-Z][a-z]+),?\s+go\s+ahead/i, nameGroup: 1 }
]

// ============================================================================
// Prepared Statements Cache
// ============================================================================

let statements: {
  // Candidate operations
  insertCandidate: Database.Statement
  getCandidateById: Database.Statement
  getCandidatesByMeeting: Database.Statement
  getCandidatesBySpeaker: Database.Statement
  getCandidatesByMeetingAndSpeaker: Database.Statement
  getTopCandidateForSpeaker: Database.Statement
  updateCandidate: Database.Statement
  deleteCandidate: Database.Statement

  // Detection event operations
  insertEvent: Database.Statement
  getEventsByMeeting: Database.Statement
  getEventsBySpeaker: Database.Statement

  // Utility queries
  getExistingCandidate: Database.Statement
} | null = null

function getStatements() {
  if (statements) return statements

  const db = getDatabaseService().getDatabase()

  statements = {
    // Candidate operations
    insertCandidate: db.prepare(`
      INSERT INTO speaker_name_candidates
      (id, meeting_id, speaker_id, candidate_name, confidence, detection_type,
       detection_context, source_transcript_id, timestamp_ms, is_accepted, is_rejected,
       created_at, updated_at)
      VALUES (@id, @meeting_id, @speaker_id, @candidate_name, @confidence, @detection_type,
              @detection_context, @source_transcript_id, @timestamp_ms, @is_accepted, @is_rejected,
              datetime('now'), datetime('now'))
    `),

    getCandidateById: db.prepare(`
      SELECT * FROM speaker_name_candidates WHERE id = ?
    `),

    getCandidatesByMeeting: db.prepare(`
      SELECT * FROM speaker_name_candidates
      WHERE meeting_id = ? AND is_rejected = 0
      ORDER BY confidence DESC
    `),

    getCandidatesBySpeaker: db.prepare(`
      SELECT * FROM speaker_name_candidates
      WHERE speaker_id = ? AND is_rejected = 0
      ORDER BY confidence DESC
    `),

    getCandidatesByMeetingAndSpeaker: db.prepare(`
      SELECT * FROM speaker_name_candidates
      WHERE meeting_id = ? AND speaker_id = ? AND is_rejected = 0
      ORDER BY confidence DESC
    `),

    getTopCandidateForSpeaker: db.prepare(`
      SELECT * FROM speaker_name_candidates
      WHERE meeting_id = ? AND speaker_id = ? AND is_rejected = 0
      ORDER BY is_accepted DESC, confidence DESC
      LIMIT 1
    `),

    updateCandidate: db.prepare(`
      UPDATE speaker_name_candidates
      SET confidence = COALESCE(@confidence, confidence),
          is_accepted = COALESCE(@is_accepted, is_accepted),
          is_rejected = COALESCE(@is_rejected, is_rejected)
      WHERE id = @id
    `),

    deleteCandidate: db.prepare(`
      DELETE FROM speaker_name_candidates WHERE id = ?
    `),

    // Detection event operations
    insertEvent: db.prepare(`
      INSERT INTO speaker_name_detection_events
      (id, meeting_id, speaker_id, event_type, description, confidence,
       candidate_name, detection_type, context_data, timestamp_ms, created_at)
      VALUES (@id, @meeting_id, @speaker_id, @event_type, @description, @confidence,
              @candidate_name, @detection_type, @context_data, @timestamp_ms, datetime('now'))
    `),

    getEventsByMeeting: db.prepare(`
      SELECT * FROM speaker_name_detection_events
      WHERE meeting_id = ?
      ORDER BY timestamp_ms DESC
    `),

    getEventsBySpeaker: db.prepare(`
      SELECT * FROM speaker_name_detection_events
      WHERE meeting_id = ? AND speaker_id = ?
      ORDER BY timestamp_ms DESC
    `),

    // Utility queries
    getExistingCandidate: db.prepare(`
      SELECT * FROM speaker_name_candidates
      WHERE meeting_id = ? AND speaker_id = ? AND candidate_name = ? AND is_rejected = 0
    `)
  }

  return statements
}

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Normalize a name for comparison
 */
function normalizeName(name: string): string {
  return name.toLowerCase().trim()
}

/**
 * Check if a word is in the excluded words list
 */
function isExcludedWord(word: string, config: SpeakerNameDetectionConfig): boolean {
  return config.excludedWords.some(excluded =>
    normalizeName(excluded) === normalizeName(word)
  )
}

/**
 * Validate that a detected name looks like a real name
 */
function isValidName(name: string, config: SpeakerNameDetectionConfig): boolean {
  // Must be at least 2 characters
  if (name.length < 2) return false

  // Must not be in excluded words
  if (isExcludedWord(name, config)) return false

  // Must start with a letter
  if (!/^[A-Za-z]/.test(name)) return false

  // Should not be all caps (likely an acronym)
  if (name === name.toUpperCase() && name.length > 2) return false

  return true
}

/**
 * Get confidence level from numeric confidence
 */
function getConfidenceLevel(confidence: number, config: SpeakerNameDetectionConfig): NameConfidenceLevel {
  if (confidence >= config.highConfidenceThreshold) return 'high'
  if (confidence >= config.mediumConfidenceThreshold) return 'medium'
  return 'low'
}

/**
 * Convert database row to SpeakerNameCandidate
 */
function rowToCandidate(row: Record<string, unknown>): SpeakerNameCandidate {
  return {
    id: row.id as string,
    meeting_id: row.meeting_id as string,
    speaker_id: row.speaker_id as string,
    candidate_name: row.candidate_name as string,
    confidence: row.confidence as number,
    detection_type: row.detection_type as SpeakerNameDetectionType,
    detection_context: row.detection_context as string | null,
    source_transcript_id: row.source_transcript_id as string | null,
    timestamp_ms: row.timestamp_ms as number,
    is_accepted: Boolean(row.is_accepted),
    is_rejected: Boolean(row.is_rejected),
    created_at: row.created_at as string,
    updated_at: row.updated_at as string
  }
}

/**
 * Convert database row to SpeakerNameDetectionEvent
 */
function rowToEvent(row: Record<string, unknown>): SpeakerNameDetectionEvent {
  return {
    id: row.id as string,
    meeting_id: row.meeting_id as string,
    speaker_id: row.speaker_id as string | null,
    event_type: row.event_type as SpeakerNameDetectionEvent['event_type'],
    description: row.description as string,
    confidence: row.confidence as number | null,
    candidate_name: row.candidate_name as string | null,
    detection_type: row.detection_type as SpeakerNameDetectionType | null,
    context_data: row.context_data as string | null,
    timestamp_ms: row.timestamp_ms as number,
    created_at: row.created_at as string
  }
}

// ============================================================================
// Speaker Name Detection Service
// ============================================================================

// In-memory configuration (can be persisted to settings if needed)
let currentConfig: SpeakerNameDetectionConfig = { ...DEFAULT_SPEAKER_NAME_DETECTION_CONFIG }

// Track recent name mentions for temporal correlation
interface NameMention {
  name: string
  speakerId: string
  timestampMs: number
  meetingId: string
}
const recentNameMentions: NameMention[] = []
const MAX_NAME_MENTIONS = 100

export const speakerNameDetectionService = {
  // =========================================================================
  // Configuration
  // =========================================================================

  /**
   * Get current configuration
   */
  getConfig(): SpeakerNameDetectionConfig {
    return { ...currentConfig }
  },

  /**
   * Update configuration
   */
  updateConfig(config: Partial<SpeakerNameDetectionConfig>): SpeakerNameDetectionConfig {
    currentConfig = { ...currentConfig, ...config }
    return { ...currentConfig }
  },

  // =========================================================================
  // Detection Methods
  // =========================================================================

  /**
   * Analyze transcript content for self-introduction patterns
   */
  analyzeTranscriptForSelfIntroduction(
    meetingId: string,
    speakerId: string,
    content: string,
    timestampMs: number,
    transcriptId?: string
  ): NameDetectionResult | null {
    if (!currentConfig.enableSelfIntroductionDetection) {
      return null
    }

    const matchedPatterns: string[] = []
    let bestMatch: { name: string; confidence: number; pattern: string } | null = null

    for (const { pattern, nameGroup, confidence } of SELF_INTRODUCTION_PATTERNS) {
      const match = content.match(pattern)
      if (match && match[nameGroup]) {
        const name = match[nameGroup].trim()

        if (isValidName(name, currentConfig)) {
          matchedPatterns.push(pattern.source)

          if (!bestMatch || confidence > bestMatch.confidence) {
            bestMatch = { name, confidence, pattern: pattern.source }
          }
        }
      }
    }

    if (bestMatch) {
      // Create candidate and log event
      const candidate = speakerNameDetectionService.createOrUpdateCandidate({
        meeting_id: meetingId,
        speaker_id: speakerId,
        candidate_name: bestMatch.name,
        confidence: bestMatch.confidence,
        detection_type: 'self_introduction',
        detection_context: `Matched pattern: ${bestMatch.pattern}`,
        source_transcript_id: transcriptId || null,
        timestamp_ms: timestampMs
      })

      speakerNameDetectionService.logDetectionEvent({
        meeting_id: meetingId,
        speaker_id: speakerId,
        event_type: 'detection',
        description: `Self-introduction detected: "${bestMatch.name}"`,
        confidence: bestMatch.confidence,
        candidate_name: bestMatch.name,
        detection_type: 'self_introduction',
        context_data: JSON.stringify({ content: content.substring(0, 200), patterns: matchedPatterns }),
        timestamp_ms: timestampMs
      })

      // Auto-apply if confidence meets threshold
      if (bestMatch.confidence >= currentConfig.autoApplyThreshold) {
        speakerNameDetectionService.autoApplyName(meetingId, speakerId, candidate)
      }

      return {
        detected: true,
        candidateName: bestMatch.name,
        confidence: bestMatch.confidence,
        detectionType: 'self_introduction',
        context: `Self-introduction detected in transcript`,
        patterns: matchedPatterns
      }
    }

    return null
  },

  /**
   * Analyze transcript for name references (mentions of other people's names)
   */
  analyzeTranscriptForNameReferences(
    meetingId: string,
    speakerId: string,
    content: string,
    timestampMs: number
  ): string[] {
    const mentionedNames: string[] = []

    for (const { pattern, nameGroup } of NAME_REFERENCE_PATTERNS) {
      const match = content.match(pattern)
      if (match && match[nameGroup]) {
        const name = match[nameGroup].trim()

        if (isValidName(name, currentConfig)) {
          mentionedNames.push(name)

          // Store for temporal correlation
          recentNameMentions.push({
            name,
            speakerId,
            timestampMs,
            meetingId
          })

          // Trim old mentions
          while (recentNameMentions.length > MAX_NAME_MENTIONS) {
            recentNameMentions.shift()
          }
        }
      }
    }

    return mentionedNames
  },

  /**
   * Analyze a speaker change to see if it correlates with a recent name mention
   */
  analyzeNameReferenceWithSpeakerChange(
    meetingId: string,
    mentionedName: string,
    mentionerSpeakerId: string,
    nextSpeakerId: string,
    mentionTimestampMs: number,
    speakerChangeTimestampMs: number
  ): NameDetectionResult | null {
    if (!currentConfig.enableNameReferenceDetection) {
      return null
    }

    // Check if the speaker change happened within the window
    const timeDiff = speakerChangeTimestampMs - mentionTimestampMs
    if (timeDiff < 0 || timeDiff > currentConfig.nameReferenceWindowMs) {
      return null
    }

    // The mentioned name should not be for the speaker who mentioned it
    if (mentionerSpeakerId === nextSpeakerId) {
      return null
    }

    // Calculate confidence based on timing
    // Closer timing = higher confidence
    const timingFactor = 1 - (timeDiff / currentConfig.nameReferenceWindowMs)
    const baseConfidence = 0.6
    const confidence = Math.min(0.75, baseConfidence + (timingFactor * 0.15))

    // Create candidate
    const candidate = speakerNameDetectionService.createOrUpdateCandidate({
      meeting_id: meetingId,
      speaker_id: nextSpeakerId,
      candidate_name: mentionedName,
      confidence,
      detection_type: 'name_reference',
      detection_context: `Name mentioned by another speaker, followed by speaker change within ${timeDiff}ms`,
      timestamp_ms: speakerChangeTimestampMs
    })

    // Log event
    speakerNameDetectionService.logDetectionEvent({
      meeting_id: meetingId,
      speaker_id: nextSpeakerId,
      event_type: 'detection',
      description: `Name reference detected: "${mentionedName}" mentioned before speaker change`,
      confidence,
      candidate_name: mentionedName,
      detection_type: 'name_reference',
      context_data: JSON.stringify({
        mentionerSpeakerId,
        timeDiff,
        mentionTimestampMs,
        speakerChangeTimestampMs
      }),
      timestamp_ms: speakerChangeTimestampMs
    })

    // Auto-apply if confidence meets threshold
    if (confidence >= currentConfig.autoApplyThreshold) {
      speakerNameDetectionService.autoApplyName(meetingId, nextSpeakerId, candidate)
    }

    return {
      detected: true,
      candidateName: mentionedName,
      confidence,
      detectionType: 'name_reference',
      context: `Name mentioned ${timeDiff}ms before speaker change`,
      patterns: []
    }
  },

  /**
   * Check recent name mentions for temporal correlation with a speaker change
   */
  checkTemporalCorrelation(
    meetingId: string,
    newSpeakerId: string,
    speakerChangeTimestampMs: number
  ): NameDetectionResult | null {
    if (!currentConfig.enableTemporalCorrelation) {
      return null
    }

    // Look for recent name mentions that could correlate with this speaker
    const relevantMentions = recentNameMentions.filter(mention =>
      mention.meetingId === meetingId &&
      mention.speakerId !== newSpeakerId &&
      (speakerChangeTimestampMs - mention.timestampMs) > 0 &&
      (speakerChangeTimestampMs - mention.timestampMs) <= currentConfig.nameReferenceWindowMs
    )

    if (relevantMentions.length === 0) {
      return null
    }

    // Get the most recent mention
    const mostRecent = relevantMentions[relevantMentions.length - 1]

    return speakerNameDetectionService.analyzeNameReferenceWithSpeakerChange(
      meetingId,
      mostRecent.name,
      mostRecent.speakerId,
      newSpeakerId,
      mostRecent.timestampMs,
      speakerChangeTimestampMs
    )
  },

  /**
   * Main analysis function - analyzes transcript for all detection methods
   */
  analyzeTranscript(
    meetingId: string,
    speakerId: string,
    content: string,
    timestampMs: number,
    transcriptId?: string
  ): NameDetectionResult | null {
    // First, check for self-introduction
    const selfIntroResult = speakerNameDetectionService.analyzeTranscriptForSelfIntroduction(
      meetingId,
      speakerId,
      content,
      timestampMs,
      transcriptId
    )

    if (selfIntroResult) {
      return selfIntroResult
    }

    // Extract any name references for future correlation
    speakerNameDetectionService.analyzeTranscriptForNameReferences(
      meetingId,
      speakerId,
      content,
      timestampMs
    )

    return null
  },

  // =========================================================================
  // Candidate Management
  // =========================================================================

  /**
   * Create or update a name candidate
   */
  createOrUpdateCandidate(input: CreateSpeakerNameCandidateInput): SpeakerNameCandidate {
    const stmts = getStatements()

    // Check if this candidate already exists
    const existing = stmts.getExistingCandidate.get(
      input.meeting_id,
      input.speaker_id,
      input.candidate_name
    ) as Record<string, unknown> | undefined

    if (existing) {
      // Update confidence if new detection has higher confidence
      const existingCandidate = rowToCandidate(existing)
      const newConfidence = input.confidence || 0.5

      if (newConfidence > existingCandidate.confidence) {
        stmts.updateCandidate.run({
          id: existingCandidate.id,
          confidence: newConfidence,
          is_accepted: null,
          is_rejected: null
        })

        // Log confidence update
        speakerNameDetectionService.logDetectionEvent({
          meeting_id: input.meeting_id,
          speaker_id: input.speaker_id,
          event_type: 'confidence_update',
          description: `Confidence updated from ${existingCandidate.confidence.toFixed(2)} to ${newConfidence.toFixed(2)}`,
          confidence: newConfidence,
          candidate_name: input.candidate_name,
          detection_type: input.detection_type,
          timestamp_ms: input.timestamp_ms
        })
      }

      return rowToCandidate(stmts.getCandidateById.get(existingCandidate.id) as Record<string, unknown>)
    }

    // Create new candidate
    const id = input.id || randomUUID()
    const params = {
      id,
      meeting_id: input.meeting_id,
      speaker_id: input.speaker_id,
      candidate_name: input.candidate_name,
      confidence: input.confidence ?? 0.5,
      detection_type: input.detection_type,
      detection_context: input.detection_context ?? null,
      source_transcript_id: input.source_transcript_id ?? null,
      timestamp_ms: input.timestamp_ms,
      is_accepted: 0,
      is_rejected: 0
    }

    stmts.insertCandidate.run(params)
    return rowToCandidate(stmts.getCandidateById.get(id) as Record<string, unknown>)
  },

  /**
   * Get all candidates for a meeting
   */
  getCandidates(meetingId: string, speakerId?: string): SpeakerNameCandidate[] {
    const stmts = getStatements()

    const rows = speakerId
      ? stmts.getCandidatesByMeetingAndSpeaker.all(meetingId, speakerId)
      : stmts.getCandidatesByMeeting.all(meetingId)

    return (rows as Record<string, unknown>[]).map(rowToCandidate)
  },

  /**
   * Get the top candidate for a speaker in a meeting
   */
  getTopCandidate(meetingId: string, speakerId: string): SpeakerNameCandidate | null {
    const stmts = getStatements()
    const row = stmts.getTopCandidateForSpeaker.get(meetingId, speakerId) as Record<string, unknown> | undefined
    return row ? rowToCandidate(row) : null
  },

  /**
   * Accept a candidate (user confirmed the name)
   */
  acceptCandidate(candidateId: string): boolean {
    const stmts = getStatements()
    const candidate = stmts.getCandidateById.get(candidateId) as Record<string, unknown> | undefined

    if (!candidate) return false

    const candidateData = rowToCandidate(candidate)

    // Update candidate as accepted
    stmts.updateCandidate.run({
      id: candidateId,
      confidence: null,
      is_accepted: 1,
      is_rejected: null
    })

    // Apply the name to the meeting speaker names
    meetingSpeakerNameService.setName(
      candidateData.meeting_id,
      candidateData.speaker_id,
      candidateData.candidate_name
    )

    // Log acceptance
    speakerNameDetectionService.logDetectionEvent({
      meeting_id: candidateData.meeting_id,
      speaker_id: candidateData.speaker_id,
      event_type: 'acceptance',
      description: `User accepted name: "${candidateData.candidate_name}"`,
      confidence: candidateData.confidence,
      candidate_name: candidateData.candidate_name,
      detection_type: candidateData.detection_type,
      timestamp_ms: Date.now()
    })

    return true
  },

  /**
   * Reject a candidate (user rejected the name)
   */
  rejectCandidate(candidateId: string): boolean {
    const stmts = getStatements()
    const candidate = stmts.getCandidateById.get(candidateId) as Record<string, unknown> | undefined

    if (!candidate) return false

    const candidateData = rowToCandidate(candidate)

    // Mark as rejected
    stmts.updateCandidate.run({
      id: candidateId,
      confidence: null,
      is_accepted: null,
      is_rejected: 1
    })

    // Log rejection
    speakerNameDetectionService.logDetectionEvent({
      meeting_id: candidateData.meeting_id,
      speaker_id: candidateData.speaker_id,
      event_type: 'rejection',
      description: `User rejected name: "${candidateData.candidate_name}"`,
      confidence: candidateData.confidence,
      candidate_name: candidateData.candidate_name,
      detection_type: candidateData.detection_type,
      timestamp_ms: Date.now()
    })

    return true
  },

  /**
   * Manually set a speaker name (overrides automatic detection)
   */
  manuallySetName(
    meetingId: string,
    speakerId: string,
    name: string
  ): SpeakerNameCandidate {
    // Create a manual correction candidate with high confidence
    const candidate = speakerNameDetectionService.createOrUpdateCandidate({
      meeting_id: meetingId,
      speaker_id: speakerId,
      candidate_name: name,
      confidence: 1.0,
      detection_type: 'manual_correction',
      detection_context: 'User manually set this name',
      timestamp_ms: Date.now()
    })

    // Accept it immediately
    speakerNameDetectionService.acceptCandidate(candidate.id)

    // Log manual override
    speakerNameDetectionService.logDetectionEvent({
      meeting_id: meetingId,
      speaker_id: speakerId,
      event_type: 'manual_override',
      description: `User manually set name: "${name}"`,
      confidence: 1.0,
      candidate_name: name,
      detection_type: 'manual_correction',
      timestamp_ms: Date.now()
    })

    return rowToCandidate(getStatements().getCandidateById.get(candidate.id) as Record<string, unknown>)
  },

  /**
   * Auto-apply a name when confidence meets threshold
   */
  autoApplyName(meetingId: string, speakerId: string, candidate: SpeakerNameCandidate): void {
    // Check if there's already an accepted name
    const existingAccepted = speakerNameDetectionService.getCandidates(meetingId, speakerId)
      .find(c => c.is_accepted)

    if (existingAccepted) {
      // Don't override manually accepted names
      return
    }

    // Apply to meeting speaker names
    meetingSpeakerNameService.setName(meetingId, speakerId, candidate.candidate_name)

    // Log auto-apply
    speakerNameDetectionService.logDetectionEvent({
      meeting_id: meetingId,
      speaker_id: speakerId,
      event_type: 'detection',
      description: `Auto-applied name: "${candidate.candidate_name}" (confidence: ${candidate.confidence.toFixed(2)})`,
      confidence: candidate.confidence,
      candidate_name: candidate.candidate_name,
      detection_type: candidate.detection_type,
      context_data: JSON.stringify({ autoApplied: true }),
      timestamp_ms: Date.now()
    })
  },

  // =========================================================================
  // Suggestions and Summary
  // =========================================================================

  /**
   * Get name suggestions for all speakers in a meeting
   */
  getSuggestions(meetingId: string): SpeakerNameSuggestion[] {
    const suggestions: SpeakerNameSuggestion[] = []

    // Get all speakers for this meeting
    const speakers = speakerService.getByMeetingId(meetingId)

    // Get display name map
    const displayNameMap = meetingSpeakerNameService.getDisplayNameMap(meetingId)

    for (const speaker of speakers) {
      const topCandidate = speakerNameDetectionService.getTopCandidate(meetingId, speaker.id)

      if (topCandidate && !topCandidate.is_accepted) {
        const currentName = displayNameMap.get(speaker.id) || speaker.name

        // Only suggest if the suggested name is different from current
        if (normalizeName(topCandidate.candidate_name) !== normalizeName(currentName)) {
          suggestions.push({
            speakerId: speaker.id,
            currentName,
            suggestedName: topCandidate.candidate_name,
            confidence: topCandidate.confidence,
            confidenceLevel: getConfidenceLevel(topCandidate.confidence, currentConfig),
            detectionType: topCandidate.detection_type,
            candidateId: topCandidate.id,
            detectionContext: topCandidate.detection_context
          })
        }
      }
    }

    return suggestions.sort((a, b) => b.confidence - a.confidence)
  },

  /**
   * Get a summary of all speaker name candidates for a meeting
   */
  getMeetingSummary(meetingId: string): MeetingSpeakerNameSummary {
    const speakers = speakerService.getByMeetingId(meetingId)
    const displayNameMap = meetingSpeakerNameService.getDisplayNameMap(meetingId)

    const speakerSummaries = speakers.map(speaker => {
      const allCandidates = speakerNameDetectionService.getCandidates(meetingId, speaker.id)
      const topCandidate = allCandidates.length > 0 ? allCandidates[0] : null
      const hasAcceptedName = allCandidates.some(c => c.is_accepted)

      return {
        speakerId: speaker.id,
        currentName: displayNameMap.get(speaker.id) || speaker.name,
        topCandidate,
        allCandidates,
        hasAcceptedName
      }
    })

    return {
      meetingId,
      speakers: speakerSummaries
    }
  },

  // =========================================================================
  // Detection Events (Logging)
  // =========================================================================

  /**
   * Log a detection event
   */
  logDetectionEvent(input: CreateSpeakerNameDetectionEventInput): SpeakerNameDetectionEvent {
    const stmts = getStatements()
    const id = input.id || randomUUID()

    const params = {
      id,
      meeting_id: input.meeting_id,
      speaker_id: input.speaker_id ?? null,
      event_type: input.event_type,
      description: input.description,
      confidence: input.confidence ?? null,
      candidate_name: input.candidate_name ?? null,
      detection_type: input.detection_type ?? null,
      context_data: input.context_data ?? null,
      timestamp_ms: input.timestamp_ms
    }

    stmts.insertEvent.run(params)

    // Return the created event
    const db = getDatabaseService().getDatabase()
    const row = db.prepare('SELECT * FROM speaker_name_detection_events WHERE id = ?').get(id) as Record<string, unknown>
    return rowToEvent(row)
  },

  /**
   * Get detection events for a meeting
   */
  getDetectionEvents(meetingId: string, limit?: number): SpeakerNameDetectionEvent[] {
    const stmts = getStatements()
    let rows = stmts.getEventsByMeeting.all(meetingId) as Record<string, unknown>[]

    if (limit && limit > 0) {
      rows = rows.slice(0, limit)
    }

    return rows.map(rowToEvent)
  },

  // =========================================================================
  // Disambiguation
  // =========================================================================

  /**
   * Handle disambiguation when multiple candidates exist for one speaker
   */
  disambiguate(meetingId: string, speakerId: string): SpeakerNameCandidate | null {
    const candidates = speakerNameDetectionService.getCandidates(meetingId, speakerId)

    if (candidates.length <= 1) {
      return candidates[0] || null
    }

    // If one is accepted, use that
    const accepted = candidates.find(c => c.is_accepted)
    if (accepted) return accepted

    // Group by normalized name
    const nameGroups = new Map<string, SpeakerNameCandidate[]>()
    for (const candidate of candidates) {
      const normalizedName = normalizeName(candidate.candidate_name)
      const group = nameGroups.get(normalizedName) || []
      group.push(candidate)
      nameGroups.set(normalizedName, group)
    }

    // Find the name group with highest combined confidence
    let bestGroup: { name: string; candidates: SpeakerNameCandidate[]; totalConfidence: number } | null = null

    for (const [name, group] of nameGroups) {
      const totalConfidence = group.reduce((sum, c) => sum + c.confidence, 0)
      if (!bestGroup || totalConfidence > bestGroup.totalConfidence) {
        bestGroup = { name, candidates: group, totalConfidence }
      }
    }

    if (bestGroup && bestGroup.candidates.length > 0) {
      // Return the highest confidence candidate from the best group
      const topCandidate = bestGroup.candidates.sort((a, b) => b.confidence - a.confidence)[0]

      // Log disambiguation
      speakerNameDetectionService.logDetectionEvent({
        meeting_id: meetingId,
        speaker_id: speakerId,
        event_type: 'disambiguation',
        description: `Disambiguated ${candidates.length} candidates to "${topCandidate.candidate_name}"`,
        confidence: topCandidate.confidence,
        candidate_name: topCandidate.candidate_name,
        context_data: JSON.stringify({
          totalCandidates: candidates.length,
          groupSize: bestGroup.candidates.length,
          totalConfidence: bestGroup.totalConfidence
        }),
        timestamp_ms: Date.now()
      })

      return topCandidate
    }

    return candidates[0]
  }
}

// Reset statements cache (useful for testing)
export function resetSpeakerNameDetectionStatements(): void {
  statements = null
}

// Reset config to defaults
export function resetSpeakerNameDetectionConfig(): void {
  currentConfig = { ...DEFAULT_SPEAKER_NAME_DETECTION_CONFIG }
}

// Clear recent name mentions (useful for testing)
export function clearRecentNameMentions(): void {
  recentNameMentions.length = 0
}
