/**
 * Confidence Scoring Service
 *
 * Tracks and analyzes Whisper transcription quality metrics in real-time.
 * Provides:
 * - Segment-level confidence scoring with color-coded categories
 * - Meeting-level aggregated metrics
 * - Confidence trend analysis to detect degrading audio quality
 * - Real-time alerts for sustained low confidence periods
 * - Manual confidence adjustment tracking
 * - Automatic AI correction triggering for low-confidence segments
 */

import { randomUUID } from 'crypto'
import type Database from 'better-sqlite3'
import { getDatabaseService } from './database'
import { transcriptService } from './transcriptService'
import { transcriptCorrectionService } from './transcriptCorrectionService'
import type { Transcript } from '../../src/types/database'

// ============================================================================
// Types
// ============================================================================

/**
 * Confidence level categories with thresholds
 */
export type ConfidenceLevel = 'high' | 'medium' | 'low'

/**
 * Thresholds for confidence level categorization
 */
export interface ConfidenceThresholds {
  high: number  // >= 0.8 by default
  medium: number  // >= 0.5 by default
  low: number  // < 0.5 by default (anything below medium)
}

/**
 * Alert types for confidence issues
 */
export type ConfidenceAlertType = 'low_confidence' | 'degrading_quality' | 'audio_issue'

/**
 * Confidence metrics for a single meeting
 */
export interface ConfidenceMetrics {
  id: string
  meeting_id: string
  overall_score: number
  high_confidence_count: number
  medium_confidence_count: number
  low_confidence_count: number
  total_segments: number
  average_word_confidence: number
  min_confidence: number
  max_confidence: number
  needs_review_count: number
  auto_corrected_count: number
  manual_adjustment_count: number
  created_at: string
  updated_at: string
}

/**
 * Confidence trend data point
 */
export interface ConfidenceTrend {
  id: string
  meeting_id: string
  timestamp_ms: number
  window_confidence: number
  segment_count: number
  is_alert_triggered: boolean
  alert_type: ConfidenceAlertType | null
  created_at: string
}

/**
 * Manual confidence adjustment record
 */
export interface ConfidenceAdjustment {
  id: string
  transcript_id: string
  meeting_id: string
  original_confidence: number
  adjusted_confidence: number
  reason: string | null
  created_at: string
}

/**
 * Segment confidence info for UI display
 */
export interface SegmentConfidenceInfo {
  transcriptId: string
  confidence: number
  level: ConfidenceLevel
  needsReview: boolean
  percentageDisplay: string
  colorClass: string
  badgeClass: string
  hasBeenCorrected: boolean
  hasBeenAdjusted: boolean
}

/**
 * Meeting confidence summary for UI
 */
export interface MeetingConfidenceSummary {
  meetingId: string
  overallScore: number
  overallLevel: ConfidenceLevel
  highConfidencePercent: number
  mediumConfidencePercent: number
  lowConfidencePercent: number
  totalSegments: number
  needsReviewCount: number
  qualityDescription: string
  trend: 'improving' | 'stable' | 'degrading' | 'unknown'
}

/**
 * Real-time alert for confidence issues
 */
export interface ConfidenceAlert {
  type: ConfidenceAlertType
  message: string
  severity: 'warning' | 'error'
  timestampMs: number
  windowConfidence: number
  suggestedAction: string
}

/**
 * Configuration for confidence scoring
 */
export interface ConfidenceScoringConfig {
  thresholds: ConfidenceThresholds
  alertThreshold: number  // Alert when window confidence drops below this
  alertWindowMs: number  // Time window for trend analysis
  alertConsecutiveCount: number  // Number of consecutive low-confidence windows to trigger alert
  autoCorrectThreshold: number  // Auto-trigger correction below this threshold
  reviewThreshold: number  // Mark for review below this threshold
  trendSampleIntervalMs: number  // How often to sample for trend analysis
}

// ============================================================================
// Default Configuration
// ============================================================================

export const DEFAULT_CONFIDENCE_THRESHOLDS: ConfidenceThresholds = {
  high: 0.8,
  medium: 0.5,
  low: 0.0
}

export const DEFAULT_CONFIDENCE_CONFIG: ConfidenceScoringConfig = {
  thresholds: DEFAULT_CONFIDENCE_THRESHOLDS,
  alertThreshold: 0.5,
  alertWindowMs: 30000,  // 30 second window
  alertConsecutiveCount: 3,
  autoCorrectThreshold: 0.4,
  reviewThreshold: 0.6,
  trendSampleIntervalMs: 5000  // Sample every 5 seconds
}

// ============================================================================
// Color Configuration for UI
// ============================================================================

export const CONFIDENCE_COLORS = {
  high: {
    bg: 'bg-green-100 dark:bg-green-900/30',
    text: 'text-green-700 dark:text-green-300',
    border: 'border-green-300 dark:border-green-700',
    badge: 'bg-green-500 text-white',
    indicator: 'bg-green-500'
  },
  medium: {
    bg: 'bg-yellow-100 dark:bg-yellow-900/30',
    text: 'text-yellow-700 dark:text-yellow-300',
    border: 'border-yellow-300 dark:border-yellow-700',
    badge: 'bg-yellow-500 text-white',
    indicator: 'bg-yellow-500'
  },
  low: {
    bg: 'bg-red-100 dark:bg-red-900/30',
    text: 'text-red-700 dark:text-red-300',
    border: 'border-red-300 dark:border-red-700',
    badge: 'bg-red-500 text-white',
    indicator: 'bg-red-500'
  }
} as const

// ============================================================================
// Prepared Statements Cache
// ============================================================================

let statements: {
  // Confidence Metrics
  insertMetrics: Database.Statement
  getMetricsByMeetingId: Database.Statement
  updateMetrics: Database.Statement
  deleteMetrics: Database.Statement
  // Confidence Trends
  insertTrend: Database.Statement
  getTrendsByMeetingId: Database.Statement
  getRecentTrends: Database.Statement
  getAlertsForMeeting: Database.Statement
  deleteTrendsByMeetingId: Database.Statement
  // Confidence Adjustments
  insertAdjustment: Database.Statement
  getAdjustmentsByTranscriptId: Database.Statement
  getAdjustmentsByMeetingId: Database.Statement
  deleteAdjustmentsByMeetingId: Database.Statement
  // Transcript queries
  getLowConfidenceTranscripts: Database.Statement
  getTranscriptsNeedingReview: Database.Statement
} | null = null

function getStatements() {
  if (statements) return statements

  const db = getDatabaseService().getDatabase()

  statements = {
    // Confidence Metrics
    insertMetrics: db.prepare(`
      INSERT INTO confidence_metrics (
        id, meeting_id, overall_score, high_confidence_count, medium_confidence_count,
        low_confidence_count, total_segments, average_word_confidence, min_confidence,
        max_confidence, needs_review_count, auto_corrected_count, manual_adjustment_count
      )
      VALUES (
        @id, @meeting_id, @overall_score, @high_confidence_count, @medium_confidence_count,
        @low_confidence_count, @total_segments, @average_word_confidence, @min_confidence,
        @max_confidence, @needs_review_count, @auto_corrected_count, @manual_adjustment_count
      )
    `),

    getMetricsByMeetingId: db.prepare(`
      SELECT * FROM confidence_metrics WHERE meeting_id = ?
    `),

    updateMetrics: db.prepare(`
      UPDATE confidence_metrics
      SET overall_score = @overall_score,
          high_confidence_count = @high_confidence_count,
          medium_confidence_count = @medium_confidence_count,
          low_confidence_count = @low_confidence_count,
          total_segments = @total_segments,
          average_word_confidence = @average_word_confidence,
          min_confidence = @min_confidence,
          max_confidence = @max_confidence,
          needs_review_count = @needs_review_count,
          auto_corrected_count = @auto_corrected_count,
          manual_adjustment_count = @manual_adjustment_count
      WHERE meeting_id = @meeting_id
    `),

    deleteMetrics: db.prepare(`
      DELETE FROM confidence_metrics WHERE meeting_id = ?
    `),

    // Confidence Trends
    insertTrend: db.prepare(`
      INSERT INTO confidence_trends (
        id, meeting_id, timestamp_ms, window_confidence, segment_count,
        is_alert_triggered, alert_type
      )
      VALUES (@id, @meeting_id, @timestamp_ms, @window_confidence, @segment_count,
              @is_alert_triggered, @alert_type)
    `),

    getTrendsByMeetingId: db.prepare(`
      SELECT * FROM confidence_trends WHERE meeting_id = ? ORDER BY timestamp_ms ASC
    `),

    getRecentTrends: db.prepare(`
      SELECT * FROM confidence_trends
      WHERE meeting_id = ? AND timestamp_ms >= ?
      ORDER BY timestamp_ms DESC
    `),

    getAlertsForMeeting: db.prepare(`
      SELECT * FROM confidence_trends
      WHERE meeting_id = ? AND is_alert_triggered = 1
      ORDER BY timestamp_ms DESC
    `),

    deleteTrendsByMeetingId: db.prepare(`
      DELETE FROM confidence_trends WHERE meeting_id = ?
    `),

    // Confidence Adjustments
    insertAdjustment: db.prepare(`
      INSERT INTO confidence_adjustments (
        id, transcript_id, meeting_id, original_confidence, adjusted_confidence, reason
      )
      VALUES (@id, @transcript_id, @meeting_id, @original_confidence, @adjusted_confidence, @reason)
    `),

    getAdjustmentsByTranscriptId: db.prepare(`
      SELECT * FROM confidence_adjustments WHERE transcript_id = ? ORDER BY created_at DESC
    `),

    getAdjustmentsByMeetingId: db.prepare(`
      SELECT * FROM confidence_adjustments WHERE meeting_id = ? ORDER BY created_at DESC
    `),

    deleteAdjustmentsByMeetingId: db.prepare(`
      DELETE FROM confidence_adjustments WHERE meeting_id = ?
    `),

    // Transcript queries
    getLowConfidenceTranscripts: db.prepare(`
      SELECT * FROM transcripts
      WHERE meeting_id = ? AND confidence < ?
      ORDER BY start_time_ms ASC
    `),

    getTranscriptsNeedingReview: db.prepare(`
      SELECT * FROM transcripts
      WHERE meeting_id = ? AND confidence < ? AND is_final = 1
      ORDER BY confidence ASC
    `)
  }

  return statements
}

// ============================================================================
// Confidence Scoring Service Class
// ============================================================================

class ConfidenceScoringService {
  private config: ConfidenceScoringConfig
  private recentTrendCache: Map<string, ConfidenceTrend[]> = new Map()
  private alertState: Map<string, { consecutiveLow: number; lastAlertTime: number }> = new Map()

  constructor(config?: Partial<ConfidenceScoringConfig>) {
    this.config = { ...DEFAULT_CONFIDENCE_CONFIG, ...config }
  }

  // ==========================================================================
  // Confidence Level Categorization
  // ==========================================================================

  /**
   * Get the confidence level category for a given score
   */
  getConfidenceLevel(confidence: number): ConfidenceLevel {
    if (confidence >= this.config.thresholds.high) return 'high'
    if (confidence >= this.config.thresholds.medium) return 'medium'
    return 'low'
  }

  /**
   * Get color classes for a confidence level
   */
  getConfidenceColors(level: ConfidenceLevel): typeof CONFIDENCE_COLORS[ConfidenceLevel] {
    return CONFIDENCE_COLORS[level]
  }

  /**
   * Get detailed confidence info for a segment (for UI display)
   */
  getSegmentConfidenceInfo(transcript: Transcript): SegmentConfidenceInfo {
    const confidence = transcript.confidence ?? 1.0
    const level = this.getConfidenceLevel(confidence)
    const colors = this.getConfidenceColors(level)
    const needsReview = confidence < this.config.reviewThreshold

    // Check if segment has been corrected or adjusted
    const corrections = transcriptCorrectionService.getByTranscriptId(transcript.id)
    const hasBeenCorrected = corrections.some(c => c.status === 'accepted')

    const stmts = getStatements()
    const adjustments = stmts.getAdjustmentsByTranscriptId.all(transcript.id) as ConfidenceAdjustment[]
    const hasBeenAdjusted = adjustments.length > 0

    return {
      transcriptId: transcript.id,
      confidence,
      level,
      needsReview,
      percentageDisplay: `${Math.round(confidence * 100)}%`,
      colorClass: `${colors.bg} ${colors.border}`,
      badgeClass: colors.badge,
      hasBeenCorrected,
      hasBeenAdjusted
    }
  }

  // ==========================================================================
  // Meeting-Level Metrics
  // ==========================================================================

  /**
   * Calculate and store confidence metrics for a meeting
   */
  calculateMeetingMetrics(meetingId: string): ConfidenceMetrics | null {
    const transcripts = transcriptService.getByMeetingId(meetingId)

    if (transcripts.length === 0) {
      return null
    }

    const confidences = transcripts.map(t => t.confidence ?? 1.0)
    const overallScore = confidences.reduce((sum, c) => sum + c, 0) / confidences.length

    let highCount = 0
    let mediumCount = 0
    let lowCount = 0
    let needsReviewCount = 0

    for (const confidence of confidences) {
      const level = this.getConfidenceLevel(confidence)
      if (level === 'high') highCount++
      else if (level === 'medium') mediumCount++
      else lowCount++

      if (confidence < this.config.reviewThreshold) {
        needsReviewCount++
      }
    }

    // Count auto-corrected and manually adjusted segments
    const corrections = transcriptCorrectionService.getByMeetingId(meetingId)
    const autoCorrectedCount = corrections.filter(c => c.status === 'accepted').length

    const stmts = getStatements()
    const adjustments = stmts.getAdjustmentsByMeetingId.all(meetingId) as ConfidenceAdjustment[]
    const manualAdjustmentCount = adjustments.length

    const metrics: Omit<ConfidenceMetrics, 'id' | 'created_at' | 'updated_at'> = {
      meeting_id: meetingId,
      overall_score: overallScore,
      high_confidence_count: highCount,
      medium_confidence_count: mediumCount,
      low_confidence_count: lowCount,
      total_segments: transcripts.length,
      average_word_confidence: overallScore,
      min_confidence: Math.min(...confidences),
      max_confidence: Math.max(...confidences),
      needs_review_count: needsReviewCount,
      auto_corrected_count: autoCorrectedCount,
      manual_adjustment_count: manualAdjustmentCount
    }

    // Check if metrics already exist
    const existing = stmts.getMetricsByMeetingId.get(meetingId) as ConfidenceMetrics | undefined

    if (existing) {
      stmts.updateMetrics.run({ ...metrics, meeting_id: meetingId })
      return stmts.getMetricsByMeetingId.get(meetingId) as ConfidenceMetrics
    } else {
      const id = randomUUID()
      stmts.insertMetrics.run({ id, ...metrics })
      return stmts.getMetricsByMeetingId.get(meetingId) as ConfidenceMetrics
    }
  }

  /**
   * Get confidence metrics for a meeting
   */
  getMetrics(meetingId: string): ConfidenceMetrics | null {
    const stmts = getStatements()
    return (stmts.getMetricsByMeetingId.get(meetingId) as ConfidenceMetrics) || null
  }

  /**
   * Get a summary of meeting confidence for UI display
   */
  getMeetingConfidenceSummary(meetingId: string): MeetingConfidenceSummary | null {
    // Calculate fresh metrics
    const metrics = this.calculateMeetingMetrics(meetingId)

    if (!metrics) {
      return null
    }

    const overallLevel = this.getConfidenceLevel(metrics.overall_score)
    const total = metrics.total_segments || 1

    // Calculate percentages
    const highPercent = Math.round((metrics.high_confidence_count / total) * 100)
    const mediumPercent = Math.round((metrics.medium_confidence_count / total) * 100)
    const lowPercent = Math.round((metrics.low_confidence_count / total) * 100)

    // Determine trend
    const trend = this.calculateTrendDirection(meetingId)

    // Generate quality description
    let qualityDescription: string
    if (metrics.overall_score >= 0.9) {
      qualityDescription = 'Excellent transcription quality'
    } else if (metrics.overall_score >= 0.8) {
      qualityDescription = 'Good transcription quality'
    } else if (metrics.overall_score >= 0.6) {
      qualityDescription = 'Moderate transcription quality - some segments may need review'
    } else if (metrics.overall_score >= 0.4) {
      qualityDescription = 'Low transcription quality - many segments need review'
    } else {
      qualityDescription = 'Poor transcription quality - significant audio issues detected'
    }

    return {
      meetingId,
      overallScore: metrics.overall_score,
      overallLevel,
      highConfidencePercent: highPercent,
      mediumConfidencePercent: mediumPercent,
      lowConfidencePercent: lowPercent,
      totalSegments: metrics.total_segments,
      needsReviewCount: metrics.needs_review_count,
      qualityDescription,
      trend
    }
  }

  // ==========================================================================
  // Confidence Trend Analysis
  // ==========================================================================

  /**
   * Record a confidence trend data point (called during live transcription)
   */
  recordTrendDataPoint(
    meetingId: string,
    timestampMs: number,
    windowConfidence: number,
    segmentCount: number
  ): ConfidenceAlert | null {
    const stmts = getStatements()
    const id = randomUUID()

    // Check if we need to trigger an alert
    const alertInfo = this.checkForAlert(meetingId, windowConfidence, timestampMs)

    stmts.insertTrend.run({
      id,
      meeting_id: meetingId,
      timestamp_ms: timestampMs,
      window_confidence: windowConfidence,
      segment_count: segmentCount,
      is_alert_triggered: alertInfo ? 1 : 0,
      alert_type: alertInfo?.type || null
    })

    // Update cache
    const cached = this.recentTrendCache.get(meetingId) || []
    cached.push({
      id,
      meeting_id: meetingId,
      timestamp_ms: timestampMs,
      window_confidence: windowConfidence,
      segment_count: segmentCount,
      is_alert_triggered: !!alertInfo,
      alert_type: alertInfo?.type || null,
      created_at: new Date().toISOString()
    })

    // Keep only recent entries in cache
    const cutoff = timestampMs - this.config.alertWindowMs * 2
    this.recentTrendCache.set(
      meetingId,
      cached.filter(t => t.timestamp_ms >= cutoff)
    )

    return alertInfo
  }

  /**
   * Check if an alert should be triggered based on trend data
   */
  private checkForAlert(
    meetingId: string,
    windowConfidence: number,
    timestampMs: number
  ): ConfidenceAlert | null {
    const state = this.alertState.get(meetingId) || { consecutiveLow: 0, lastAlertTime: 0 }

    // Check if confidence is below alert threshold
    if (windowConfidence < this.config.alertThreshold) {
      state.consecutiveLow++
    } else {
      state.consecutiveLow = 0
    }

    this.alertState.set(meetingId, state)

    // Trigger alert if we've had enough consecutive low-confidence windows
    if (state.consecutiveLow >= this.config.alertConsecutiveCount) {
      // Don't spam alerts - minimum 30 seconds between alerts
      if (timestampMs - state.lastAlertTime < 30000) {
        return null
      }

      state.lastAlertTime = timestampMs
      this.alertState.set(meetingId, state)

      // Determine alert type based on trend
      const trends = this.recentTrendCache.get(meetingId) || []
      const alertType = this.determineAlertType(trends, windowConfidence)

      return {
        type: alertType,
        message: this.getAlertMessage(alertType, windowConfidence),
        severity: windowConfidence < 0.3 ? 'error' : 'warning',
        timestampMs,
        windowConfidence,
        suggestedAction: this.getAlertSuggestion(alertType)
      }
    }

    return null
  }

  /**
   * Determine the type of alert based on trend pattern
   */
  private determineAlertType(trends: ConfidenceTrend[], currentConfidence: number): ConfidenceAlertType {
    if (trends.length < 3) {
      return 'low_confidence'
    }

    // Check for degrading pattern (steadily decreasing confidence)
    const recentTrends = trends.slice(-5)
    let degrading = true
    for (let i = 1; i < recentTrends.length; i++) {
      if (recentTrends[i].window_confidence >= recentTrends[i - 1].window_confidence) {
        degrading = false
        break
      }
    }

    if (degrading) {
      return 'degrading_quality'
    }

    // Very low confidence might indicate audio issues
    if (currentConfidence < 0.3) {
      return 'audio_issue'
    }

    return 'low_confidence'
  }

  /**
   * Get human-readable alert message
   */
  private getAlertMessage(type: ConfidenceAlertType, confidence: number): string {
    const percent = Math.round(confidence * 100)

    switch (type) {
      case 'degrading_quality':
        return `Transcription quality is degrading (${percent}% confidence). Audio quality may be declining.`
      case 'audio_issue':
        return `Severe audio quality issues detected (${percent}% confidence). Check microphone placement or connection.`
      case 'low_confidence':
      default:
        return `Low transcription confidence (${percent}%). Some words may be incorrect.`
    }
  }

  /**
   * Get suggested action for alert type
   */
  private getAlertSuggestion(type: ConfidenceAlertType): string {
    switch (type) {
      case 'degrading_quality':
        return 'Check if the speaker has moved away from the microphone or if there is increasing background noise.'
      case 'audio_issue':
        return 'Check microphone connection and placement. Consider pausing the recording to fix the issue.'
      case 'low_confidence':
      default:
        return 'Consider reviewing and correcting low-confidence segments after the meeting.'
    }
  }

  /**
   * Calculate trend direction for a meeting
   */
  private calculateTrendDirection(meetingId: string): 'improving' | 'stable' | 'degrading' | 'unknown' {
    const stmts = getStatements()
    const trends = stmts.getTrendsByMeetingId.all(meetingId) as ConfidenceTrend[]

    if (trends.length < 3) {
      return 'unknown'
    }

    // Compare first third vs last third
    const thirdLength = Math.floor(trends.length / 3)
    const firstThird = trends.slice(0, thirdLength)
    const lastThird = trends.slice(-thirdLength)

    const firstAvg = firstThird.reduce((sum, t) => sum + t.window_confidence, 0) / firstThird.length
    const lastAvg = lastThird.reduce((sum, t) => sum + t.window_confidence, 0) / lastThird.length

    const diff = lastAvg - firstAvg
    const threshold = 0.1  // 10% change threshold

    if (diff > threshold) return 'improving'
    if (diff < -threshold) return 'degrading'
    return 'stable'
  }

  /**
   * Get all trends for a meeting
   */
  getTrends(meetingId: string): ConfidenceTrend[] {
    const stmts = getStatements()
    const rows = stmts.getTrendsByMeetingId.all(meetingId) as Array<ConfidenceTrend & { is_alert_triggered: number }>
    return rows.map(row => ({
      ...row,
      is_alert_triggered: row.is_alert_triggered === 1
    }))
  }

  /**
   * Get alerts triggered for a meeting
   */
  getAlerts(meetingId: string): ConfidenceTrend[] {
    const stmts = getStatements()
    const rows = stmts.getAlertsForMeeting.all(meetingId) as Array<ConfidenceTrend & { is_alert_triggered: number }>
    return rows.map(row => ({
      ...row,
      is_alert_triggered: true
    }))
  }

  // ==========================================================================
  // Low Confidence Segment Management
  // ==========================================================================

  /**
   * Get all low-confidence transcripts for a meeting
   */
  getLowConfidenceTranscripts(meetingId: string, threshold?: number): Transcript[] {
    const stmts = getStatements()
    return stmts.getLowConfidenceTranscripts.all(
      meetingId,
      threshold ?? this.config.thresholds.medium
    ) as Transcript[]
  }

  /**
   * Get transcripts that need review
   */
  getTranscriptsNeedingReview(meetingId: string): Transcript[] {
    const stmts = getStatements()
    return stmts.getTranscriptsNeedingReview.all(
      meetingId,
      this.config.reviewThreshold
    ) as Transcript[]
  }

  /**
   * Check if a segment should trigger automatic AI correction
   */
  shouldTriggerAutoCorrection(transcript: Transcript): boolean {
    const confidence = transcript.confidence ?? 1.0
    return confidence < this.config.autoCorrectThreshold && transcript.is_final
  }

  /**
   * Trigger AI correction for low-confidence segments in a meeting
   */
  async triggerBatchAutoCorrection(meetingId: string): Promise<{
    triggered: number
    skipped: number
    errors: string[]
  }> {
    const lowConfidence = this.getLowConfidenceTranscripts(
      meetingId,
      this.config.autoCorrectThreshold
    )

    let triggered = 0
    let skipped = 0
    const errors: string[] = []

    for (const transcript of lowConfidence) {
      // Check if already has pending correction
      const existing = transcriptCorrectionService.getByTranscriptId(transcript.id)
      if (existing.some(c => c.status === 'pending')) {
        skipped++
        continue
      }

      try {
        const result = await transcriptCorrectionService.generateCorrection(
          transcript.id,
          'low_confidence'
        )

        if (result.success) {
          triggered++
        } else {
          errors.push(`Segment ${transcript.id}: ${result.error}`)
        }
      } catch (error) {
        errors.push(`Segment ${transcript.id}: ${error instanceof Error ? error.message : 'Unknown error'}`)
      }
    }

    // Recalculate metrics
    this.calculateMeetingMetrics(meetingId)

    return { triggered, skipped, errors }
  }

  // ==========================================================================
  // Manual Confidence Adjustment
  // ==========================================================================

  /**
   * Record a manual confidence adjustment by user
   */
  adjustConfidence(
    transcriptId: string,
    newConfidence: number,
    reason?: string
  ): ConfidenceAdjustment | null {
    const transcript = transcriptService.getById(transcriptId)
    if (!transcript) {
      return null
    }

    const stmts = getStatements()
    const id = randomUUID()
    const originalConfidence = transcript.confidence ?? 1.0

    stmts.insertAdjustment.run({
      id,
      transcript_id: transcriptId,
      meeting_id: transcript.meeting_id,
      original_confidence: originalConfidence,
      adjusted_confidence: newConfidence,
      reason: reason || null
    })

    // Update the transcript confidence in the database
    const db = getDatabaseService().getDatabase()
    db.prepare('UPDATE transcripts SET confidence = ? WHERE id = ?').run(newConfidence, transcriptId)

    // Recalculate meeting metrics
    this.calculateMeetingMetrics(transcript.meeting_id)

    return {
      id,
      transcript_id: transcriptId,
      meeting_id: transcript.meeting_id,
      original_confidence: originalConfidence,
      adjusted_confidence: newConfidence,
      reason: reason || null,
      created_at: new Date().toISOString()
    }
  }

  /**
   * Get adjustment history for a transcript
   */
  getAdjustmentHistory(transcriptId: string): ConfidenceAdjustment[] {
    const stmts = getStatements()
    return stmts.getAdjustmentsByTranscriptId.all(transcriptId) as ConfidenceAdjustment[]
  }

  /**
   * Get all adjustments for a meeting
   */
  getMeetingAdjustments(meetingId: string): ConfidenceAdjustment[] {
    const stmts = getStatements()
    return stmts.getAdjustmentsByMeetingId.all(meetingId) as ConfidenceAdjustment[]
  }

  // ==========================================================================
  // Live Recording Integration
  // ==========================================================================

  /**
   * Process a new transcript segment during live recording
   * Returns alert if confidence issues are detected
   */
  processLiveSegment(transcript: Transcript): {
    info: SegmentConfidenceInfo
    alert: ConfidenceAlert | null
    shouldAutoCorrect: boolean
  } {
    const info = this.getSegmentConfidenceInfo(transcript)

    // Get recent segments for trend analysis
    const recentTranscripts = transcriptService.getByMeetingId(transcript.meeting_id)
    const windowStart = transcript.end_time_ms - this.config.alertWindowMs
    const windowTranscripts = recentTranscripts.filter(t => t.start_time_ms >= windowStart)

    // Calculate window confidence
    const windowConfidence = windowTranscripts.length > 0
      ? windowTranscripts.reduce((sum, t) => sum + (t.confidence ?? 1.0), 0) / windowTranscripts.length
      : transcript.confidence ?? 1.0

    // Record trend data point
    const alert = this.recordTrendDataPoint(
      transcript.meeting_id,
      transcript.end_time_ms,
      windowConfidence,
      windowTranscripts.length
    )

    return {
      info,
      alert,
      shouldAutoCorrect: this.shouldTriggerAutoCorrection(transcript)
    }
  }

  /**
   * Reset alert state for a meeting (when recording ends)
   */
  resetAlertState(meetingId: string): void {
    this.alertState.delete(meetingId)
    this.recentTrendCache.delete(meetingId)
  }

  // ==========================================================================
  // Configuration Management
  // ==========================================================================

  /**
   * Update configuration
   */
  updateConfig(config: Partial<ConfidenceScoringConfig>): void {
    this.config = { ...this.config, ...config }
  }

  /**
   * Get current configuration
   */
  getConfig(): ConfidenceScoringConfig {
    return { ...this.config }
  }

  /**
   * Get confidence thresholds
   */
  getThresholds(): ConfidenceThresholds {
    return { ...this.config.thresholds }
  }

  // ==========================================================================
  // Cleanup
  // ==========================================================================

  /**
   * Delete all confidence data for a meeting
   */
  deleteByMeetingId(meetingId: string): void {
    const stmts = getStatements()
    stmts.deleteAdjustmentsByMeetingId.run(meetingId)
    stmts.deleteTrendsByMeetingId.run(meetingId)
    stmts.deleteMetrics.run(meetingId)
    this.resetAlertState(meetingId)
  }
}

// ============================================================================
// Singleton Export
// ============================================================================

export const confidenceScoringService = new ConfidenceScoringService()

/**
 * Reset statements cache (useful for testing)
 */
export function resetConfidenceScoringStatements(): void {
  statements = null
}

export default confidenceScoringService
