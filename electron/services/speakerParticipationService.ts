/**
 * Speaker Participation Analytics Service
 *
 * Provides analytics for speaker participation in meetings including:
 * - Talk time distribution per speaker
 * - Participation balance metrics (Gini coefficient)
 * - Trend analysis across multiple meetings
 * - Report generation with insights
 */

import type Database from 'better-sqlite3'
import { getDatabaseService } from './database'
import { meetingService } from './meetingService'
import { speakerService } from './speakerService'
import type {
  MeetingParticipationAnalytics,
  SpeakerParticipation,
  ParticipationTrend,
  ParticipationReport,
  ParticipationReportOptions,
  ParticipationInsight,
  MeetingType,
  Meeting,
  Speaker
} from '../../src/types/database'

// ============================================================================
// Prepared Statements Cache
// ============================================================================

let statements: {
  getSpeakerStats: Database.Statement
  getMeetingTranscriptStats: Database.Statement
  getSpeakerTurnCount: Database.Statement
} | null = null

function getStatements() {
  if (statements) return statements

  const db = getDatabaseService().getDatabase()

  statements = {
    // Get aggregated stats per speaker for a meeting
    getSpeakerStats: db.prepare(`
      SELECT
        speaker_id,
        COUNT(*) as segment_count,
        SUM(end_time_ms - start_time_ms) as total_talk_time_ms,
        AVG(end_time_ms - start_time_ms) as avg_segment_duration_ms,
        MAX(end_time_ms - start_time_ms) as max_segment_duration_ms,
        MIN(start_time_ms) as first_spoke_at_ms,
        MAX(end_time_ms) as last_spoke_at_ms,
        AVG(confidence) as avg_confidence,
        SUM(LENGTH(content) - LENGTH(REPLACE(content, ' ', '')) + 1) as word_count
      FROM transcripts
      WHERE meeting_id = ? AND speaker_id IS NOT NULL
      GROUP BY speaker_id
    `),

    // Get overall meeting transcript stats
    getMeetingTranscriptStats: db.prepare(`
      SELECT
        COUNT(DISTINCT speaker_id) as speaker_count,
        MIN(start_time_ms) as meeting_start_ms,
        MAX(end_time_ms) as meeting_end_ms,
        SUM(LENGTH(content) - LENGTH(REPLACE(content, ' ', '')) + 1) as total_word_count
      FROM transcripts
      WHERE meeting_id = ? AND speaker_id IS NOT NULL
    `),

    // Count speaker turns (when speaker changes)
    getSpeakerTurnCount: db.prepare(`
      WITH ordered_transcripts AS (
        SELECT
          speaker_id,
          LAG(speaker_id) OVER (ORDER BY start_time_ms) as prev_speaker_id
        FROM transcripts
        WHERE meeting_id = ? AND speaker_id IS NOT NULL
        ORDER BY start_time_ms
      )
      SELECT COUNT(*) as turn_count
      FROM ordered_transcripts
      WHERE speaker_id != prev_speaker_id OR prev_speaker_id IS NULL
    `)
  }

  return statements
}

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Calculate Gini coefficient for participation inequality
 * 0 = perfectly equal, 1 = completely dominated by one speaker
 */
function calculateGiniCoefficient(values: number[]): number {
  if (values.length === 0) return 0
  if (values.length === 1) return 0

  const sorted = [...values].sort((a, b) => a - b)
  const n = sorted.length
  const sum = sorted.reduce((a, b) => a + b, 0)

  if (sum === 0) return 0

  let numerator = 0
  for (let i = 0; i < n; i++) {
    numerator += (2 * (i + 1) - n - 1) * sorted[i]
  }

  return numerator / (n * sum)
}

/**
 * Determine if participation is balanced based on standard deviation
 */
function isParticipationBalanced(percentages: number[]): boolean {
  if (percentages.length <= 1) return true

  const mean = percentages.reduce((a, b) => a + b, 0) / percentages.length
  const variance = percentages.reduce((sum, p) => sum + Math.pow(p - mean, 2), 0) / percentages.length
  const stdDev = Math.sqrt(variance)

  // Consider balanced if std deviation is less than 20%
  return stdDev < 20
}

/**
 * Get speaker name from speaker record or generate a default
 */
function getSpeakerName(speaker: Speaker | null, speakerId: string): string {
  if (speaker?.name) return speaker.name
  return `Speaker ${speakerId.slice(0, 8)}`
}

/**
 * Group meetings by time period
 */
function getMeetingsByPeriod(
  meetings: Meeting[],
  grouping: 'day' | 'week' | 'month'
): Map<string, Meeting[]> {
  const grouped = new Map<string, Meeting[]>()

  for (const meeting of meetings) {
    const date = new Date(meeting.start_time)
    let periodKey: string

    switch (grouping) {
      case 'day':
        periodKey = date.toISOString().split('T')[0]
        break
      case 'week':
        // Get Monday of the week
        const monday = new Date(date)
        monday.setDate(date.getDate() - date.getDay() + 1)
        periodKey = monday.toISOString().split('T')[0]
        break
      case 'month':
        periodKey = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`
        break
    }

    const existing = grouped.get(periodKey) || []
    existing.push(meeting)
    grouped.set(periodKey, existing)
  }

  return grouped
}

/**
 * Generate insights based on participation data
 */
function generateInsights(
  report: Omit<ParticipationReport, 'insights'>
): ParticipationInsight[] {
  const insights: ParticipationInsight[] = []

  // Check for participation imbalance
  const participationPercentages = report.overallParticipation.map(p => p.averageTalkTimePercentage)
  if (!isParticipationBalanced(participationPercentages)) {
    const dominant = report.overallParticipation.reduce((a, b) =>
      a.averageTalkTimePercentage > b.averageTalkTimePercentage ? a : b
    )
    insights.push({
      type: 'warning',
      category: 'balance',
      title: 'Unbalanced Participation',
      description: `${dominant.speakerName} speaks ${dominant.averageTalkTimePercentage.toFixed(1)}% of the time on average, which may limit input from others.`,
      relatedSpeakers: [dominant.speakerId]
    })
  }

  // Check for low participation
  const lowParticipants = report.overallParticipation.filter(p => p.averageTalkTimePercentage < 10)
  if (lowParticipants.length > 0) {
    insights.push({
      type: 'suggestion',
      category: 'balance',
      title: 'Low Participation Detected',
      description: `${lowParticipants.length} participant(s) contribute less than 10% of talk time on average. Consider encouraging more input from ${lowParticipants.map(p => p.speakerName).join(', ')}.`,
      relatedSpeakers: lowParticipants.map(p => p.speakerId)
    })
  }

  // Meeting frequency insights
  if (report.totalMeetings > 10) {
    const avgMeetingDuration = report.totalMeetingTimeMs / report.totalMeetings
    if (avgMeetingDuration > 60 * 60 * 1000) {
      insights.push({
        type: 'info',
        category: 'duration',
        title: 'Long Meeting Average',
        description: `Average meeting duration is ${Math.round(avgMeetingDuration / (60 * 1000))} minutes. Consider shorter, more focused meetings.`
      })
    }
  }

  // Trend insights
  if (report.trends.length >= 3) {
    const recentGini = report.trends.slice(-3).map(t => t.averageGiniCoefficient)
    const avgRecentGini = recentGini.reduce((a, b) => a + b, 0) / recentGini.length
    const olderGini = report.trends.slice(0, -3).map(t => t.averageGiniCoefficient)
    const avgOlderGini = olderGini.length > 0
      ? olderGini.reduce((a, b) => a + b, 0) / olderGini.length
      : avgRecentGini

    if (avgRecentGini < avgOlderGini - 0.1) {
      insights.push({
        type: 'info',
        category: 'trend',
        title: 'Improving Participation Balance',
        description: 'Meeting participation has become more balanced recently compared to earlier periods.'
      })
    } else if (avgRecentGini > avgOlderGini + 0.1) {
      insights.push({
        type: 'warning',
        category: 'trend',
        title: 'Declining Participation Balance',
        description: 'Meeting participation has become less balanced recently. Some voices may be getting less airtime.'
      })
    }
  }

  return insights
}

// ============================================================================
// Speaker Participation Service
// ============================================================================

export const speakerParticipationService = {
  /**
   * Get participation analytics for a single meeting
   */
  getMeetingParticipation(meetingId: string): MeetingParticipationAnalytics | null {
    const meeting = meetingService.getById(meetingId)
    if (!meeting) return null

    const stmts = getStatements()

    // Get overall meeting stats
    const meetingStats = stmts.getMeetingTranscriptStats.get(meetingId) as {
      speaker_count: number
      meeting_start_ms: number | null
      meeting_end_ms: number | null
      total_word_count: number
    }

    if (!meetingStats || meetingStats.speaker_count === 0) {
      return {
        meetingId,
        meetingTitle: meeting.title,
        startTime: meeting.start_time,
        endTime: meeting.end_time,
        totalDurationMs: meeting.duration_seconds ? meeting.duration_seconds * 1000 : 0,
        speakerCount: 0,
        speakers: [],
        isBalanced: true,
        giniCoefficient: 0,
        dominantSpeaker: null,
        totalWordCount: 0,
        totalSpeakerTurns: 0,
        averageWordsPerTurn: 0
      }
    }

    // Get speaker stats
    const speakerStatsRows = stmts.getSpeakerStats.all(meetingId) as Array<{
      speaker_id: string
      segment_count: number
      total_talk_time_ms: number
      avg_segment_duration_ms: number
      max_segment_duration_ms: number
      first_spoke_at_ms: number
      last_spoke_at_ms: number
      avg_confidence: number
      word_count: number
    }>

    // Get speaker turn count
    const turnCountResult = stmts.getSpeakerTurnCount.get(meetingId) as { turn_count: number }
    const totalSpeakerTurns = turnCountResult?.turn_count || 0

    // Calculate total talk time for percentage calculations
    const totalTalkTime = speakerStatsRows.reduce((sum, row) => sum + row.total_talk_time_ms, 0)

    // Calculate meeting duration
    const totalDurationMs = meeting.duration_seconds
      ? meeting.duration_seconds * 1000
      : (meetingStats.meeting_end_ms && meetingStats.meeting_start_ms
        ? meetingStats.meeting_end_ms - meetingStats.meeting_start_ms
        : totalTalkTime)

    // Build speaker participation data
    const speakersMap = new Map<string, Speaker>()
    const speakerIds = speakerStatsRows.map(row => row.speaker_id)
    const speakers = speakerService.getByIds(speakerIds)
    speakers.forEach(s => speakersMap.set(s.id, s))

    const speakerParticipations: SpeakerParticipation[] = speakerStatsRows.map(row => {
      const speaker = speakersMap.get(row.speaker_id) || null
      const talkTimePercentage = totalTalkTime > 0
        ? (row.total_talk_time_ms / totalTalkTime) * 100
        : 0
      const talkTimeMinutes = row.total_talk_time_ms / (60 * 1000)
      const wordsPerMinute = talkTimeMinutes > 0 ? row.word_count / talkTimeMinutes : 0

      return {
        speakerId: row.speaker_id,
        speakerName: getSpeakerName(speaker, row.speaker_id),
        talkTimeMs: row.total_talk_time_ms,
        talkTimePercentage,
        segmentCount: row.segment_count,
        averageSegmentDurationMs: row.avg_segment_duration_ms,
        longestSegmentMs: row.max_segment_duration_ms,
        firstSpokeAtMs: row.first_spoke_at_ms,
        lastSpokeAtMs: row.last_spoke_at_ms,
        averageConfidence: row.avg_confidence,
        wordCount: row.word_count,
        wordsPerMinute: Math.round(wordsPerMinute)
      }
    })

    // Sort by talk time descending
    speakerParticipations.sort((a, b) => b.talkTimeMs - a.talkTimeMs)

    // Calculate balance metrics
    const talkTimePercentages = speakerParticipations.map(s => s.talkTimePercentage)
    const giniCoefficient = calculateGiniCoefficient(speakerParticipations.map(s => s.talkTimeMs))
    const isBalanced = isParticipationBalanced(talkTimePercentages)

    // Find dominant speaker
    const dominantSpeaker = speakerParticipations.length > 0 ? speakerParticipations[0] : null

    // Calculate average words per turn
    const totalWordCount = speakerParticipations.reduce((sum, s) => sum + s.wordCount, 0)
    const averageWordsPerTurn = totalSpeakerTurns > 0 ? totalWordCount / totalSpeakerTurns : 0

    return {
      meetingId,
      meetingTitle: meeting.title,
      startTime: meeting.start_time,
      endTime: meeting.end_time,
      totalDurationMs,
      speakerCount: speakerParticipations.length,
      speakers: speakerParticipations,
      isBalanced,
      giniCoefficient,
      dominantSpeaker,
      totalWordCount,
      totalSpeakerTurns,
      averageWordsPerTurn: Math.round(averageWordsPerTurn)
    }
  },

  /**
   * Get quick stats for dashboard display
   */
  getQuickStats(meetingId: string): {
    speakerCount: number
    totalDurationMs: number
    isBalanced: boolean
    dominantSpeakerName: string | null
    dominantSpeakerPercentage: number | null
  } | null {
    const participation = this.getMeetingParticipation(meetingId)
    if (!participation) return null

    return {
      speakerCount: participation.speakerCount,
      totalDurationMs: participation.totalDurationMs,
      isBalanced: participation.isBalanced,
      dominantSpeakerName: participation.dominantSpeaker?.speakerName || null,
      dominantSpeakerPercentage: participation.dominantSpeaker?.talkTimePercentage || null
    }
  },

  /**
   * Get participation trends over time
   */
  getTrends(
    startDate: string,
    endDate: string,
    grouping: 'day' | 'week' | 'month' = 'week'
  ): ParticipationTrend[] {
    const db = getDatabaseService().getDatabase()

    // Get all meetings in the date range
    const meetings = db.prepare(`
      SELECT * FROM meetings
      WHERE start_time >= ? AND start_time <= ?
      AND status = 'completed'
      ORDER BY start_time ASC
    `).all(startDate, endDate) as Meeting[]

    if (meetings.length === 0) return []

    // Group meetings by period
    const groupedMeetings = getMeetingsByPeriod(meetings, grouping)

    // Calculate trends for each period
    const trends: ParticipationTrend[] = []

    for (const [period, periodMeetings] of groupedMeetings) {
      let totalMeetingTimeMs = 0
      const speakerAggregates = new Map<string, {
        speakerId: string
        speakerName: string
        totalTalkTimeMs: number
        meetingsParticipated: number
        talkTimePercentages: number[]
      }>()
      const giniCoefficients: number[] = []

      for (const meeting of periodMeetings) {
        const participation = this.getMeetingParticipation(meeting.id)
        if (!participation) continue

        totalMeetingTimeMs += participation.totalDurationMs
        giniCoefficients.push(participation.giniCoefficient)

        for (const speaker of participation.speakers) {
          const existing = speakerAggregates.get(speaker.speakerId)
          if (existing) {
            existing.totalTalkTimeMs += speaker.talkTimeMs
            existing.meetingsParticipated++
            existing.talkTimePercentages.push(speaker.talkTimePercentage)
          } else {
            speakerAggregates.set(speaker.speakerId, {
              speakerId: speaker.speakerId,
              speakerName: speaker.speakerName,
              totalTalkTimeMs: speaker.talkTimeMs,
              meetingsParticipated: 1,
              talkTimePercentages: [speaker.talkTimePercentage]
            })
          }
        }
      }

      const speakerParticipation = Array.from(speakerAggregates.values()).map(agg => ({
        speakerId: agg.speakerId,
        speakerName: agg.speakerName,
        totalTalkTimeMs: agg.totalTalkTimeMs,
        meetingsParticipated: agg.meetingsParticipated,
        averageTalkTimePercentage:
          agg.talkTimePercentages.reduce((a, b) => a + b, 0) / agg.talkTimePercentages.length
      }))

      const averageGiniCoefficient = giniCoefficients.length > 0
        ? giniCoefficients.reduce((a, b) => a + b, 0) / giniCoefficients.length
        : 0

      trends.push({
        period,
        meetingCount: periodMeetings.length,
        totalMeetingTimeMs,
        averageMeetingDurationMs: totalMeetingTimeMs / periodMeetings.length,
        speakerParticipation,
        averageGiniCoefficient
      })
    }

    return trends.sort((a, b) => a.period.localeCompare(b.period))
  },

  /**
   * Generate a comprehensive participation report
   */
  generateReport(options: ParticipationReportOptions = {}): ParticipationReport {
    const db = getDatabaseService().getDatabase()

    // Default to last 30 days if no date range specified
    const now = new Date()
    const defaultStartDate = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000).toISOString()
    const startDate = options.startDate || defaultStartDate
    const endDate = options.endDate || now.toISOString()
    const grouping = options.trendGrouping || 'week'

    // Build query based on options
    let query = `
      SELECT * FROM meetings
      WHERE start_time >= ? AND start_time <= ?
      AND status = 'completed'
    `
    const params: (string | MeetingType)[] = [startDate, endDate]

    if (options.meetingType) {
      query += ` AND meeting_type = ?`
      params.push(options.meetingType)
    }

    if (options.meetingIds && options.meetingIds.length > 0) {
      const placeholders = options.meetingIds.map(() => '?').join(', ')
      query += ` AND id IN (${placeholders})`
      params.push(...options.meetingIds)
    }

    query += ` ORDER BY start_time ASC`

    const meetings = db.prepare(query).all(...params) as Meeting[]

    // Aggregate participation data across all meetings
    const speakerAggregates = new Map<string, {
      speakerId: string
      speakerName: string
      totalTalkTimeMs: number
      meetingsParticipated: number
      talkTimePercentages: number[]
      totalWordCount: number
    }>()

    let totalMeetingTimeMs = 0

    for (const meeting of meetings) {
      const participation = this.getMeetingParticipation(meeting.id)
      if (!participation) continue

      totalMeetingTimeMs += participation.totalDurationMs

      for (const speaker of participation.speakers) {
        const existing = speakerAggregates.get(speaker.speakerId)
        if (existing) {
          existing.totalTalkTimeMs += speaker.talkTimeMs
          existing.meetingsParticipated++
          existing.talkTimePercentages.push(speaker.talkTimePercentage)
          existing.totalWordCount += speaker.wordCount
        } else {
          speakerAggregates.set(speaker.speakerId, {
            speakerId: speaker.speakerId,
            speakerName: speaker.speakerName,
            totalTalkTimeMs: speaker.talkTimeMs,
            meetingsParticipated: 1,
            talkTimePercentages: [speaker.talkTimePercentage],
            totalWordCount: speaker.wordCount
          })
        }
      }
    }

    const overallParticipation = Array.from(speakerAggregates.values())
      .map(agg => ({
        speakerId: agg.speakerId,
        speakerName: agg.speakerName,
        totalTalkTimeMs: agg.totalTalkTimeMs,
        averageTalkTimePercentage:
          agg.talkTimePercentages.reduce((a, b) => a + b, 0) / agg.talkTimePercentages.length,
        meetingsParticipated: agg.meetingsParticipated,
        participationRate: (agg.meetingsParticipated / meetings.length) * 100,
        averageWordsPerMeeting: agg.totalWordCount / agg.meetingsParticipated
      }))
      .sort((a, b) => b.totalTalkTimeMs - a.totalTalkTimeMs)

    // Get trends
    const trends = this.getTrends(startDate, endDate, grouping)

    // Build report without insights first
    const reportWithoutInsights: Omit<ParticipationReport, 'insights'> = {
      generatedAt: new Date().toISOString(),
      startDate,
      endDate,
      totalMeetings: meetings.length,
      totalMeetingTimeMs,
      overallParticipation,
      trends
    }

    // Generate insights if requested
    const insights = options.includeInsights !== false
      ? generateInsights(reportWithoutInsights)
      : []

    return {
      ...reportWithoutInsights,
      insights
    }
  }
}

// Reset statements cache (useful for testing)
export function resetSpeakerParticipationStatements(): void {
  statements = null
}
