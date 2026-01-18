/**
 * Meeting Summary Component
 *
 * Displays the AI-generated meeting summary including:
 * - Overall sentiment analysis
 * - Sentiment breakdown (positive, negative, neutral, mixed percentages)
 * - Statistics (decisions made, key points, topics discussed)
 * - Generation timestamp
 * - Edit functionality
 *
 * DEBUG LOGGING: This component includes comprehensive console logging
 * for debugging purposes. Use browser DevTools to monitor:
 * - Component mount/unmount events
 * - Data flow and parsing
 * - Render cycles
 */

import { useState, useMemo, memo, useEffect } from 'react'
import {
  BookOpen,
  Sparkles,
  Edit2,
  X,
  Check,
  AlertCircle
} from 'lucide-react'
import type { MeetingNote } from '../../types/database'
import { formatDateTime } from '../../lib/formatters'

// ============================================================================
// Debug Logging Utilities
// ============================================================================

const DEBUG_PREFIX = '[MeetingSummary Debug]'

/**
 * Log a debug message with timestamp and meeting context
 */
function debugLog(message: string, data?: Record<string, unknown>) {
  if (process.env.NODE_ENV === 'development') {
    console.log(
      `%c${DEBUG_PREFIX} ${message}`,
      'color: #8b5cf6; font-weight: bold',
      data ? { ...data, timestamp: new Date().toISOString() } : { timestamp: new Date().toISOString() }
    )
  }
}

/**
 * Log a debug warning
 */
function debugWarn(message: string, data?: Record<string, unknown>) {
  if (process.env.NODE_ENV === 'development') {
    console.warn(
      `%c${DEBUG_PREFIX} ${message}`,
      'color: #f59e0b; font-weight: bold',
      data ? { ...data, timestamp: new Date().toISOString() } : { timestamp: new Date().toISOString() }
    )
  }
}

/**
 * Log a debug error
 * Note: Exported for use by other components that may need error logging
 */
export function debugErrorSummary(message: string, data?: Record<string, unknown>) {
  console.error(
    `%c${DEBUG_PREFIX} ${message}`,
    'color: #ef4444; font-weight: bold',
    data ? { ...data, timestamp: new Date().toISOString() } : { timestamp: new Date().toISOString() }
  )
}

// ============================================================================
// Types
// ============================================================================

interface MeetingSummaryProps {
  /** All meeting notes - component will find the summary note */
  notes: MeetingNote[]
  /** Meeting ID for editing */
  meetingId: string
  /** Callback when notes are updated */
  onNotesUpdated?: () => void
}

interface ParsedSentimentData {
  overallSentiment: string
  sentimentEmoji: string
  breakdown: {
    positive: number
    negative: number
    neutral: number
    mixed: number
  }
  statistics: {
    decisions: number
    keyPoints: number
    topics: number
  }
}

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Get emoji for sentiment type
 */
function getSentimentEmoji(sentiment: string): string {
  const emojiMap: Record<string, string> = {
    positive: '✅',
    negative: '⚠',
    neutral: '📝',
    mixed: '🔄'
  }
  return emojiMap[sentiment.toLowerCase()] || '📝'
}

/**
 * Get color classes for sentiment badge
 */
function getSentimentColorClasses(sentiment: string): { bg: string; text: string; border: string } {
  const colorMap: Record<string, { bg: string; text: string; border: string }> = {
    positive: {
      bg: 'bg-green-100 dark:bg-green-900/30',
      text: 'text-green-700 dark:text-green-300',
      border: 'border-green-200 dark:border-green-800'
    },
    negative: {
      bg: 'bg-red-100 dark:bg-red-900/30',
      text: 'text-red-700 dark:text-red-300',
      border: 'border-red-200 dark:border-red-800'
    },
    neutral: {
      bg: 'bg-yellow-100 dark:bg-yellow-900/30',
      text: 'text-yellow-700 dark:text-yellow-300',
      border: 'border-yellow-200 dark:border-yellow-800'
    },
    mixed: {
      bg: 'bg-purple-100 dark:bg-purple-900/30',
      text: 'text-purple-700 dark:text-purple-300',
      border: 'border-purple-200 dark:border-purple-800'
    }
  }
  return colorMap[sentiment.toLowerCase()] || colorMap.neutral
}

/**
 * Parse sentiment data from note content
 */
function parseSentimentData(content: string): ParsedSentimentData | null {
  try {
    // Parse overall sentiment
    const overallMatch = content.match(/\*\*Overall Sentiment:\*\*\s*\[([^\]]+)\]\s*(\w+)/i)
      || content.match(/\*\*Overall Sentiment:\*\*\s*([✅⚠📝🔄])\s*(\w+)/i)

    if (!overallMatch) {
      return null
    }

    const overallSentiment = overallMatch[2]?.toLowerCase() || 'neutral'
    const sentimentEmoji = getSentimentEmoji(overallSentiment)

    // Parse breakdown percentages
    const positiveMatch = content.match(/[✅]\s*Positive:\s*([\d.]+)%/i)
    const negativeMatch = content.match(/[⚠️]\s*Negative:\s*([\d.]+)%/i)
    const neutralMatch = content.match(/[📝]\s*Neutral:\s*([\d.]+)%/i)
    const mixedMatch = content.match(/[🔄]\s*Mixed:\s*([\d.]+)%/i)

    // Parse statistics
    const decisionsMatch = content.match(/Decisions Made:\s*(\d+)/i)
    const keyPointsMatch = content.match(/Key Points:\s*(\d+)/i)
    const topicsMatch = content.match(/Topics Discussed:\s*(\d+)/i)

    return {
      overallSentiment,
      sentimentEmoji,
      breakdown: {
        positive: positiveMatch ? parseFloat(positiveMatch[1]) : 0,
        negative: negativeMatch ? parseFloat(negativeMatch[1]) : 0,
        neutral: neutralMatch ? parseFloat(neutralMatch[1]) : 0,
        mixed: mixedMatch ? parseFloat(mixedMatch[1]) : 0
      },
      statistics: {
        decisions: decisionsMatch ? parseInt(decisionsMatch[1], 10) : 0,
        keyPoints: keyPointsMatch ? parseInt(keyPointsMatch[1], 10) : 0,
        topics: topicsMatch ? parseInt(topicsMatch[1], 10) : 0
      }
    }
  } catch (error) {
    console.error('[MeetingSummary] Failed to parse sentiment data:', error)
    return null
  }
}

// ============================================================================
// Sentiment Bar Component
// ============================================================================

interface SentimentBarProps {
  label: string
  emoji: string
  percentage: number
  color: string
}

function SentimentBar({ label, emoji, percentage, color }: SentimentBarProps) {
  return (
    <div className="flex items-center gap-3">
      <div className="flex items-center gap-2 w-28 flex-shrink-0">
        <span>{emoji}</span>
        <span className="text-sm text-muted-foreground">{label}:</span>
      </div>
      <div className="flex-1 h-2 bg-muted rounded-full overflow-hidden">
        <div
          className={`h-full ${color} rounded-full transition-all duration-500`}
          style={{ width: `${Math.min(100, percentage)}%` }}
        />
      </div>
      <span className="text-sm font-medium text-foreground w-14 text-right">
        {percentage.toFixed(1)}%
      </span>
    </div>
  )
}

// ============================================================================
// Statistic Item Component
// ============================================================================

interface StatisticItemProps {
  label: string
  value: number
}

function StatisticItem({ label, value }: StatisticItemProps) {
  return (
    <div className="flex items-center justify-between py-1">
      <span className="text-sm text-muted-foreground">- {label}:</span>
      <span className="text-sm font-semibold text-foreground">{value}</span>
    </div>
  )
}

// ============================================================================
// Main Component
// ============================================================================

export const MeetingSummary = memo(function MeetingSummary({
  notes,
  meetingId,
  onNotesUpdated
}: MeetingSummaryProps) {
  const [isEditing, setIsEditing] = useState(false)
  const [editContent, setEditContent] = useState('')
  const [isSaving, setIsSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // ============================================================================
  // Component Mount Verification Logging
  // ============================================================================
  useEffect(() => {
    debugLog('Component MOUNTED', {
      meetingId,
      notesCount: notes.length,
      summaryNotesCount: notes.filter(n => n.note_type === 'summary').length,
    })

    return () => {
      debugLog('Component UNMOUNTED', { meetingId })
    }
  }, [meetingId])

  // Track notes changes
  useEffect(() => {
    debugLog('Notes data received', {
      meetingId,
      totalNotes: notes.length,
      summaryNotes: notes.filter(n => n.note_type === 'summary').length,
      aiGeneratedNotes: notes.filter(n => n.is_ai_generated).length,
      noteTypes: [...new Set(notes.map(n => n.note_type))],
    })
  }, [notes, meetingId])

  // Find the AI-generated summary note
  // First try to find sentiment analysis summary, then fall back to any AI summary
  const summaryNote = useMemo(() => {
    debugLog('Finding summary note...', { meetingId, totalNotes: notes.length })

    // First, try to find sentiment analysis summary (preferred)
    let found = notes.find(n =>
      n.note_type === 'summary' &&
      n.is_ai_generated &&
      n.content.includes('Meeting Sentiment Analysis')
    )

    // If not found, fall back to any AI-generated summary
    if (!found) {
      found = notes.find(n =>
        n.note_type === 'summary' &&
        n.is_ai_generated
      )
    }

    if (found) {
      const wordCount = found.content.split(/\s+/).length
      const isSentimentAnalysis = found.content.includes('Meeting Sentiment Analysis')
      debugLog('Summary note FOUND', {
        meetingId,
        noteId: found.id,
        contentLength: found.content.length,
        wordCount,
        isSentimentAnalysis,
        generationTimestamp: found.generation_timestamp || found.created_at,
      })
    } else {
      // Check for any summary notes that might not match our criteria
      const allSummaryNotes = notes.filter(n => n.note_type === 'summary')
      const aiSummaryNotes = notes.filter(n => n.note_type === 'summary' && n.is_ai_generated)

      debugWarn('Summary note NOT FOUND', {
        meetingId,
        totalSummaryNotes: allSummaryNotes.length,
        aiGeneratedSummaryNotes: aiSummaryNotes.length,
        summaryNoteContents: allSummaryNotes.map(n => ({
          id: n.id,
          isAiGenerated: n.is_ai_generated,
          contentPreview: n.content.substring(0, 100),
          hasSentimentAnalysis: n.content.includes('Meeting Sentiment Analysis'),
        })),
      })
    }

    return found
  }, [notes, meetingId])

  // Parse the sentiment data from the note
  const sentimentData = useMemo(() => {
    if (!summaryNote) {
      debugLog('Skipping sentiment parsing - no summary note', { meetingId })
      return null
    }

    debugLog('Parsing sentiment data...', { meetingId, noteId: summaryNote.id })
    const parsed = parseSentimentData(summaryNote.content)

    if (parsed) {
      debugLog('Sentiment data PARSED successfully', {
        meetingId,
        overallSentiment: parsed.overallSentiment,
        breakdown: parsed.breakdown,
        statistics: parsed.statistics,
      })
    } else {
      debugWarn('Sentiment data parsing FAILED', {
        meetingId,
        noteId: summaryNote.id,
        contentPreview: summaryNote.content.substring(0, 200),
      })
    }

    return parsed
  }, [summaryNote, meetingId])

  // Handle edit start
  const handleStartEdit = () => {
    if (summaryNote) {
      setEditContent(summaryNote.content)
      setIsEditing(true)
      setError(null)
    }
  }

  // Handle save
  const handleSave = async () => {
    if (!summaryNote) return

    setIsSaving(true)
    setError(null)

    try {
      await window.electronAPI.db.meetingNotes.update(summaryNote.id, {
        content: editContent
      })
      setIsEditing(false)
      onNotesUpdated?.()
    } catch (err) {
      console.error('[MeetingSummary] Failed to save:', err)
      setError('Failed to save changes')
    } finally {
      setIsSaving(false)
    }
  }

  // Handle cancel
  const handleCancel = () => {
    setIsEditing(false)
    setEditContent('')
    setError(null)
  }

  // Don't render if no summary note exists
  if (!summaryNote) {
    debugLog('Render: Returning null - no summary note', { meetingId })
    return null
  }

  const sentimentColors = sentimentData
    ? getSentimentColorClasses(sentimentData.overallSentiment)
    : getSentimentColorClasses('neutral')

  // Log render
  debugLog('Render: Rendering summary component', {
    meetingId,
    hasSentimentData: !!sentimentData,
    isEditing,
  })

  return (
    <div
      className="border border-border rounded-lg overflow-hidden bg-card"
      data-testid="meeting-summary-section"
      data-meeting-id={meetingId}
      data-summary-note-id={summaryNote.id}
      data-has-sentiment={!!sentimentData}
    >
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-border bg-muted/30">
        <div className="flex items-center gap-3">
          <BookOpen className="w-5 h-5 text-blue-600 dark:text-blue-400" />
          <h3 className="font-semibold text-foreground">Meeting Summary</h3>
          {/* AI Generated badge */}
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300">
            <Sparkles className="w-3 h-3" />
            AI Generated
          </span>
        </div>

        {/* Edit button */}
        {!isEditing && (
          <button
            onClick={handleStartEdit}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-muted-foreground hover:text-foreground border border-border rounded-lg hover:bg-muted transition-colors"
          >
            <Edit2 className="w-4 h-4" />
            Edit
          </button>
        )}
      </div>

      {/* Content */}
      <div className="p-4">
        {isEditing ? (
          /* Edit Mode */
          <div className="space-y-4">
            <textarea
              value={editContent}
              onChange={(e) => setEditContent(e.target.value)}
              className="w-full min-h-[300px] p-3 border border-border rounded-lg bg-background font-mono text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 resize-y"
              placeholder="Edit the meeting summary..."
            />

            {error && (
              <div className="flex items-center gap-2 p-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg">
                <AlertCircle className="w-4 h-4 text-red-600" />
                <span className="text-sm text-red-700 dark:text-red-300">{error}</span>
              </div>
            )}

            <div className="flex justify-end gap-2">
              <button
                onClick={handleCancel}
                disabled={isSaving}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-muted-foreground hover:text-foreground border border-border rounded-lg hover:bg-muted transition-colors disabled:opacity-50"
              >
                <X className="w-4 h-4" />
                Cancel
              </button>
              <button
                onClick={handleSave}
                disabled={isSaving}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-lg transition-colors disabled:opacity-50"
              >
                <Check className="w-4 h-4" />
                {isSaving ? 'Saving...' : 'Save'}
              </button>
            </div>
          </div>
        ) : sentimentData ? (
          /* Parsed Display Mode */
          <div className="space-y-6">
            {/* Section Title */}
            <h4 className="text-lg font-semibold text-foreground">
              ## Meeting Sentiment Analysis
            </h4>

            {/* Overall Sentiment */}
            <div className="flex items-center gap-3">
              <span className="text-sm font-medium text-foreground">**Overall Sentiment:**</span>
              <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-sm font-medium border ${sentimentColors.bg} ${sentimentColors.text} ${sentimentColors.border}`}>
                [{sentimentData.sentimentEmoji} {sentimentData.overallSentiment.toUpperCase()}]
              </span>
              <span className="text-sm text-foreground">{sentimentData.overallSentiment}</span>
            </div>

            {/* Sentiment Breakdown */}
            <div className="space-y-3">
              <h5 className="text-sm font-semibold text-foreground">### Sentiment Breakdown:</h5>
              <div className="space-y-2 pl-4">
                <SentimentBar
                  label="Positive"
                  emoji="✅"
                  percentage={sentimentData.breakdown.positive}
                  color="bg-green-500"
                />
                <SentimentBar
                  label="Negative"
                  emoji="⚠"
                  percentage={sentimentData.breakdown.negative}
                  color="bg-red-500"
                />
                <SentimentBar
                  label="Neutral"
                  emoji="📝"
                  percentage={sentimentData.breakdown.neutral}
                  color="bg-yellow-500"
                />
                <SentimentBar
                  label="Mixed"
                  emoji="🔄"
                  percentage={sentimentData.breakdown.mixed}
                  color="bg-purple-500"
                />
              </div>
            </div>

            {/* Statistics */}
            <div className="space-y-2">
              <h5 className="text-sm font-semibold text-foreground">### Statistics:</h5>
              <div className="pl-4 space-y-1">
                <StatisticItem label="Decisions Made" value={sentimentData.statistics.decisions} />
                <StatisticItem label="Key Points" value={sentimentData.statistics.keyPoints} />
                <StatisticItem label="Topics Discussed" value={sentimentData.statistics.topics} />
              </div>
            </div>
          </div>
        ) : (
          /* Fallback: Plain Text Summary Display */
          <div className="prose prose-sm dark:prose-invert max-w-none">
            <div className="whitespace-pre-wrap text-sm text-foreground leading-relaxed">
              {summaryNote.content}
            </div>
          </div>
        )}
      </div>

      {/* Footer with timestamp */}
      <div className="px-4 py-2 border-t border-border bg-muted/20">
        <span className="text-xs text-blue-600 dark:text-blue-400">
          Generated {formatDateTime(summaryNote.generation_timestamp || summaryNote.created_at)}
        </span>
      </div>
    </div>
  )
})

export default MeetingSummary
