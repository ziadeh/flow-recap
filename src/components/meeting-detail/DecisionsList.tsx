import {
  Gavel,
  Sparkles,
  User,
  Clock,
  ThumbsUp,
  ThumbsDown,
  Minus,
  HelpCircle,
  TrendingUp
} from 'lucide-react'
import type { MeetingNote } from '../../types/database'
import type { ExtractedDecision, SentimentType } from '../../types/electron-api'
import { formatDateTime, formatDurationMs, cleanNoteContent } from '../../lib/formatters'

interface DecisionsListProps {
  /** Decision notes from the meeting */
  decisionNotes: MeetingNote[]
  /** Extracted decisions with additional metadata (from decisionsAndTopics API) */
  extractedDecisions?: ExtractedDecision[]
  /** Optional: Show sentiment indicators (default: true) */
  showSentiment?: boolean
  /** Optional: Show confidence scores (default: false) */
  showConfidence?: boolean
}

const sentimentConfig: Record<SentimentType, {
  label: string
  icon: typeof ThumbsUp
  color: string
  bgColor: string
  borderColor: string
}> = {
  positive: {
    label: 'Positive',
    icon: ThumbsUp,
    color: 'text-green-600',
    bgColor: 'bg-green-50',
    borderColor: 'border-green-200',
  },
  negative: {
    label: 'Negative',
    icon: ThumbsDown,
    color: 'text-red-600',
    bgColor: 'bg-red-50',
    borderColor: 'border-red-200',
  },
  neutral: {
    label: 'Neutral',
    icon: Minus,
    color: 'text-gray-600',
    bgColor: 'bg-gray-50',
    borderColor: 'border-gray-200',
  },
  mixed: {
    label: 'Mixed',
    icon: HelpCircle,
    color: 'text-yellow-600',
    bgColor: 'bg-yellow-50',
    borderColor: 'border-yellow-200',
  },
}

/**
 * Sentiment badge component
 */
function SentimentBadge({ sentiment }: { sentiment: SentimentType }) {
  const config = sentimentConfig[sentiment]
  const Icon = config.icon

  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${config.bgColor} ${config.color} ${config.borderColor} border`}>
      <Icon className="w-3 h-3 mr-1" />
      {config.label}
    </span>
  )
}

/**
 * Confidence indicator component
 */
function ConfidenceIndicator({ confidence }: { confidence: number }) {
  const percentage = Math.round(confidence * 100)
  let colorClass = 'text-green-600'
  if (confidence < 0.5) colorClass = 'text-red-600'
  else if (confidence < 0.75) colorClass = 'text-yellow-600'

  return (
    <span className={`inline-flex items-center text-xs ${colorClass}`}>
      <TrendingUp className="w-3 h-3 mr-1" />
      {percentage}% confidence
    </span>
  )
}

/**
 * Decision card for extracted decisions with full metadata
 */
function ExtractedDecisionCard({
  decision,
  showSentiment,
  showConfidence
}: {
  decision: ExtractedDecision
  showSentiment: boolean
  showConfidence: boolean
}) {
  const sentimentStyle = sentimentConfig[decision.sentiment]

  return (
    <div className={`${sentimentStyle.bgColor} border ${sentimentStyle.borderColor} rounded-lg p-4 hover:shadow-sm transition-shadow`}>
      <div className="flex items-start gap-3">
        <Gavel className={`w-5 h-5 ${sentimentStyle.color} mt-0.5 flex-shrink-0`} />
        <div className="flex-1 min-w-0">
          <div className="flex items-start justify-between gap-2 mb-2">
            <div className="flex flex-wrap items-center gap-2">
              {showSentiment && <SentimentBadge sentiment={decision.sentiment} />}
              {showConfidence && decision.confidence && (
                <ConfidenceIndicator confidence={decision.confidence} />
              )}
            </div>
            {(decision.startTimeMs !== undefined && decision.endTimeMs !== undefined) && (
              <span className="text-xs text-muted-foreground flex items-center flex-shrink-0">
                <Clock className="w-3 h-3 mr-1" />
                {formatDurationMs(decision.startTimeMs)} - {formatDurationMs(decision.endTimeMs)}
              </span>
            )}
          </div>

          <p className="text-sm text-foreground font-medium mb-2 whitespace-pre-wrap">
            {decision.content}
          </p>

          {decision.context && (
            <p className="text-xs text-muted-foreground mb-2 italic">
              Context: {decision.context}
            </p>
          )}

          {decision.speaker && (
            <div className="flex items-center text-xs text-muted-foreground">
              <User className="w-3 h-3 mr-1" />
              Decided by: {decision.speaker}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

/**
 * Simple decision card for notes without full metadata
 */
function DecisionNoteCard({ note }: { note: MeetingNote }) {
  return (
    <div className="bg-purple-50 border border-purple-200 rounded-lg p-4 hover:shadow-sm transition-shadow">
      <div className="flex items-start gap-3">
        <Gavel className="w-5 h-5 text-purple-600 mt-0.5 flex-shrink-0" />
        <div className="flex-1">
          <div className="flex items-center gap-2 mb-2">
            {note.is_ai_generated && (
              <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-purple-100 text-purple-700 border border-purple-200">
                <Sparkles className="w-3 h-3 mr-1" />
                AI Extracted
              </span>
            )}
            <span className="text-xs text-muted-foreground">
              {formatDateTime(note.created_at)}
            </span>
          </div>
          <p className="text-sm text-foreground whitespace-pre-wrap">
            {cleanNoteContent(note.content)}
          </p>
        </div>
      </div>
    </div>
  )
}

/**
 * DecisionsList Component
 * Displays extracted decisions from the meeting with sentiment analysis
 */
export function DecisionsList({
  decisionNotes,
  extractedDecisions = [],
  showSentiment = true,
  showConfidence = false
}: DecisionsListProps) {
  const hasDecisions = decisionNotes.length > 0 || extractedDecisions.length > 0

  // Calculate sentiment summary if we have extracted decisions
  const sentimentSummary = extractedDecisions.reduce((acc, decision) => {
    acc[decision.sentiment] = (acc[decision.sentiment] || 0) + 1
    return acc
  }, {} as Record<SentimentType, number>)

  if (!hasDecisions) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-center">
        <Gavel className="w-12 h-12 text-muted-foreground mb-4" />
        <h3 className="text-lg font-semibold text-foreground mb-2">No decisions found</h3>
        <p className="text-sm text-muted-foreground max-w-md">
          Decisions made during this meeting will appear here.
          Use the AI extraction tools to identify decisions from the transcript.
        </p>
      </div>
    )
  }

  return (
    <div className="py-4">
      {/* Summary stats */}
      {(extractedDecisions.length > 0 || decisionNotes.length > 0) && (
        <div className="flex flex-wrap gap-4 mb-6">
          <div className="flex items-center gap-2 px-3 py-2 bg-purple-50 rounded-lg">
            <Gavel className="w-4 h-4 text-purple-600" />
            <span className="text-sm font-medium text-purple-700">
              {extractedDecisions.length + decisionNotes.length}
            </span>
            <span className="text-sm text-purple-600">
              Decision{extractedDecisions.length + decisionNotes.length !== 1 ? 's' : ''}
            </span>
          </div>

          {showSentiment && Object.keys(sentimentSummary).length > 0 && (
            <>
              {sentimentSummary.positive > 0 && (
                <div className="flex items-center gap-2 px-3 py-2 bg-green-50 rounded-lg">
                  <ThumbsUp className="w-4 h-4 text-green-600" />
                  <span className="text-sm font-medium text-green-700">{sentimentSummary.positive}</span>
                  <span className="text-sm text-green-600">Positive</span>
                </div>
              )}
              {sentimentSummary.neutral > 0 && (
                <div className="flex items-center gap-2 px-3 py-2 bg-gray-100 rounded-lg">
                  <Minus className="w-4 h-4 text-gray-600" />
                  <span className="text-sm font-medium text-gray-700">{sentimentSummary.neutral}</span>
                  <span className="text-sm text-gray-600">Neutral</span>
                </div>
              )}
              {sentimentSummary.negative > 0 && (
                <div className="flex items-center gap-2 px-3 py-2 bg-red-50 rounded-lg">
                  <ThumbsDown className="w-4 h-4 text-red-600" />
                  <span className="text-sm font-medium text-red-700">{sentimentSummary.negative}</span>
                  <span className="text-sm text-red-600">Negative</span>
                </div>
              )}
              {sentimentSummary.mixed > 0 && (
                <div className="flex items-center gap-2 px-3 py-2 bg-yellow-50 rounded-lg">
                  <HelpCircle className="w-4 h-4 text-yellow-600" />
                  <span className="text-sm font-medium text-yellow-700">{sentimentSummary.mixed}</span>
                  <span className="text-sm text-yellow-600">Mixed</span>
                </div>
              )}
            </>
          )}
        </div>
      )}

      {/* Extracted decisions with full metadata */}
      {extractedDecisions.length > 0 && (
        <div className="mb-8">
          <div className="flex items-center mb-4">
            <Sparkles className="w-5 h-5 mr-2 text-purple-600" />
            <h3 className="text-lg font-semibold text-foreground">
              AI-Analyzed Decisions
            </h3>
            <span className="ml-2 px-2 py-0.5 rounded-full text-xs font-semibold bg-muted text-muted-foreground">
              {extractedDecisions.length}
            </span>
          </div>
          <div className="space-y-3">
            {extractedDecisions.map((decision, index) => (
              <ExtractedDecisionCard
                key={`decision-${index}`}
                decision={decision}
                showSentiment={showSentiment}
                showConfidence={showConfidence}
              />
            ))}
          </div>
        </div>
      )}

      {/* Decision notes (simpler display) */}
      {decisionNotes.length > 0 && (
        <div>
          <div className="flex items-center mb-4">
            <Gavel className="w-5 h-5 mr-2 text-purple-600" />
            <h3 className="text-lg font-semibold text-foreground">
              {extractedDecisions.length > 0 ? 'Additional Decision Notes' : 'Decisions'}
            </h3>
            <span className="ml-2 px-2 py-0.5 rounded-full text-xs font-semibold bg-muted text-muted-foreground">
              {decisionNotes.length}
            </span>
          </div>
          <div className="space-y-3">
            {decisionNotes.map((note) => (
              <DecisionNoteCard key={note.id} note={note} />
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

export default DecisionsList
