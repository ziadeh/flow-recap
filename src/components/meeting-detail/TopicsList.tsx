import { useState } from 'react'
import {
  Hash,
  Clock,
  Users,
  ChevronDown,
  ChevronUp,
  Lightbulb,
  Gavel,
  ThumbsUp,
  ThumbsDown,
  Minus,
  HelpCircle,
  BarChart3,
  MessageSquare
} from 'lucide-react'
import type { ExtractedTopic, SentimentType } from '../../types/electron-api'
import { formatDurationMs } from '../../lib/formatters'

interface TopicsListProps {
  /** Extracted topics from the meeting */
  topics: ExtractedTopic[]
  /** Total meeting duration in milliseconds (for calculating topic percentages) */
  meetingDurationMs?: number
  /** Optional: Show detailed view by default (default: false) */
  defaultExpanded?: boolean
  /** Optional: Show sentiment indicators (default: true) */
  showSentiment?: boolean
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
 * Progress bar showing topic duration as percentage of meeting
 */
function DurationBar({ durationMs, totalDurationMs }: { durationMs: number; totalDurationMs: number }) {
  const percentage = Math.min(100, Math.round((durationMs / totalDurationMs) * 100))

  return (
    <div className="w-full h-2 bg-gray-200 rounded-full overflow-hidden">
      <div
        className="h-full bg-purple-500 rounded-full transition-all duration-300"
        style={{ width: `${percentage}%` }}
      />
    </div>
  )
}

/**
 * Sentiment badge component
 */
function SentimentBadge({ sentiment, size = 'sm' }: { sentiment: SentimentType; size?: 'sm' | 'xs' }) {
  const config = sentimentConfig[sentiment]
  const Icon = config.icon

  if (size === 'xs') {
    return (
      <span className={`inline-flex items-center ${config.color}`} title={config.label}>
        <Icon className="w-3 h-3" />
      </span>
    )
  }

  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${config.bgColor} ${config.color} ${config.borderColor} border`}>
      <Icon className="w-3 h-3 mr-1" />
      {config.label}
    </span>
  )
}

/**
 * Expandable topic card
 */
function TopicCard({
  topic,
  meetingDurationMs,
  defaultExpanded,
  showSentiment
}: {
  topic: ExtractedTopic
  meetingDurationMs?: number
  defaultExpanded: boolean
  showSentiment: boolean
}) {
  const [isExpanded, setIsExpanded] = useState(defaultExpanded)
  const sentimentStyle = sentimentConfig[topic.sentiment]

  const hasDetails = topic.keyPoints.length > 0 || topic.decisions.length > 0 || topic.description

  return (
    <div className={`border rounded-lg overflow-hidden transition-shadow hover:shadow-sm ${sentimentStyle.borderColor}`}>
      {/* Header - always visible */}
      <button
        onClick={() => setIsExpanded(!isExpanded)}
        className={`w-full px-4 py-3 flex items-center gap-3 text-left ${sentimentStyle.bgColor} hover:opacity-90 transition-opacity`}
        disabled={!hasDetails}
      >
        <Hash className={`w-5 h-5 ${sentimentStyle.color} flex-shrink-0`} />

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <h4 className="font-semibold text-foreground truncate">
              {topic.name}
            </h4>
            {showSentiment && <SentimentBadge sentiment={topic.sentiment} />}
          </div>

          <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
            <span className="flex items-center">
              <Clock className="w-3 h-3 mr-1" />
              {formatDurationMs(topic.durationMs)}
            </span>
            {topic.speakers.length > 0 && (
              <span className="flex items-center">
                <Users className="w-3 h-3 mr-1" />
                {topic.speakers.length} speaker{topic.speakers.length !== 1 ? 's' : ''}
              </span>
            )}
            {topic.keyPoints.length > 0 && (
              <span className="flex items-center">
                <Lightbulb className="w-3 h-3 mr-1" />
                {topic.keyPoints.length} key point{topic.keyPoints.length !== 1 ? 's' : ''}
              </span>
            )}
            {topic.decisions.length > 0 && (
              <span className="flex items-center">
                <Gavel className="w-3 h-3 mr-1" />
                {topic.decisions.length} decision{topic.decisions.length !== 1 ? 's' : ''}
              </span>
            )}
          </div>

          {/* Duration bar */}
          {meetingDurationMs && (
            <div className="mt-2">
              <DurationBar durationMs={topic.durationMs} totalDurationMs={meetingDurationMs} />
              <span className="text-xs text-muted-foreground">
                {Math.round((topic.durationMs / meetingDurationMs) * 100)}% of meeting
              </span>
            </div>
          )}
        </div>

        {hasDetails && (
          <div className="flex-shrink-0">
            {isExpanded ? (
              <ChevronUp className="w-5 h-5 text-muted-foreground" />
            ) : (
              <ChevronDown className="w-5 h-5 text-muted-foreground" />
            )}
          </div>
        )}
      </button>

      {/* Expanded content */}
      {isExpanded && hasDetails && (
        <div className="px-4 py-3 bg-card border-t border-border space-y-4">
          {/* Description */}
          {topic.description && (
            <div>
              <p className="text-sm text-foreground leading-relaxed">
                {topic.description}
              </p>
            </div>
          )}

          {/* Time range */}
          <div className="flex items-center text-xs text-muted-foreground">
            <Clock className="w-3 h-3 mr-1" />
            {formatDurationMs(topic.startTimeMs)} - {formatDurationMs(topic.endTimeMs)}
          </div>

          {/* Speakers */}
          {topic.speakers.length > 0 && (
            <div>
              <div className="flex items-center gap-2 mb-2">
                <Users className="w-4 h-4 text-muted-foreground" />
                <span className="text-sm font-medium text-foreground">Speakers</span>
              </div>
              <div className="flex flex-wrap gap-2">
                {topic.speakers.map((speaker, index) => (
                  <span
                    key={index}
                    className="px-2 py-1 text-xs bg-muted rounded-full text-muted-foreground"
                  >
                    {speaker}
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* Key Points */}
          {topic.keyPoints.length > 0 && (
            <div>
              <div className="flex items-center gap-2 mb-2">
                <Lightbulb className="w-4 h-4 text-yellow-600" />
                <span className="text-sm font-medium text-foreground">Key Points</span>
              </div>
              <ul className="space-y-2">
                {topic.keyPoints.map((point, index) => (
                  <li key={index} className="flex items-start gap-2 text-sm text-foreground/80">
                    <span className="text-yellow-500 mt-1">•</span>
                    {point}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Decisions */}
          {topic.decisions.length > 0 && (
            <div>
              <div className="flex items-center gap-2 mb-2">
                <Gavel className="w-4 h-4 text-purple-600" />
                <span className="text-sm font-medium text-foreground">Decisions</span>
              </div>
              <ul className="space-y-2">
                {topic.decisions.map((decision, index) => (
                  <li key={index} className="flex items-start gap-2 text-sm text-foreground/80">
                    <span className="text-purple-500 mt-1">✓</span>
                    {decision}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

/**
 * Topics overview/timeline visualization
 */
function TopicsTimeline({ topics, meetingDurationMs }: { topics: ExtractedTopic[]; meetingDurationMs: number }) {
  // Sort topics by start time
  const sortedTopics = [...topics].sort((a, b) => a.startTimeMs - b.startTimeMs)

  return (
    <div className="mb-6">
      <div className="flex items-center gap-2 mb-3">
        <BarChart3 className="w-5 h-5 text-purple-600" />
        <h3 className="text-sm font-semibold text-foreground">Topics Timeline</h3>
      </div>
      <div className="w-full h-8 bg-gray-100 rounded-lg overflow-hidden flex">
        {sortedTopics.map((topic, index) => {
          const startPercent = (topic.startTimeMs / meetingDurationMs) * 100
          const widthPercent = (topic.durationMs / meetingDurationMs) * 100
          const sentimentStyle = sentimentConfig[topic.sentiment]

          return (
            <div
              key={index}
              className={`h-full ${sentimentStyle.bgColor} ${sentimentStyle.borderColor} border-r relative group cursor-pointer`}
              style={{
                width: `${Math.max(widthPercent, 2)}%`,
                marginLeft: index === 0 ? `${startPercent}%` : '0'
              }}
              title={`${topic.name} (${formatDurationMs(topic.durationMs)})`}
            >
              {/* Tooltip on hover */}
              <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 px-2 py-1 bg-foreground text-background text-xs rounded whitespace-nowrap opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none z-10">
                {topic.name}
              </div>
            </div>
          )
        })}
      </div>
      <div className="flex justify-between text-xs text-muted-foreground mt-1">
        <span>0:00</span>
        <span>{formatDurationMs(meetingDurationMs)}</span>
      </div>
    </div>
  )
}

/**
 * TopicsList Component
 * Displays extracted topics with duration, sentiment, key points, and decisions
 */
export function TopicsList({
  topics,
  meetingDurationMs,
  defaultExpanded = false,
  showSentiment = true
}: TopicsListProps) {
  if (topics.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-center">
        <MessageSquare className="w-12 h-12 text-muted-foreground mb-4" />
        <h3 className="text-lg font-semibold text-foreground mb-2">No topics found</h3>
        <p className="text-sm text-muted-foreground max-w-md">
          Topics discussed during this meeting will appear here.
          Use the AI extraction tools to identify and analyze topics from the transcript.
        </p>
      </div>
    )
  }

  // Sort topics by start time
  const sortedTopics = [...topics].sort((a, b) => a.startTimeMs - b.startTimeMs)

  // Calculate stats
  const totalKeyPoints = topics.reduce((sum, t) => sum + t.keyPoints.length, 0)
  const totalDecisions = topics.reduce((sum, t) => sum + t.decisions.length, 0)
  const uniqueSpeakers = new Set(topics.flatMap(t => t.speakers)).size

  // Sentiment breakdown
  const sentimentCounts = topics.reduce((acc, topic) => {
    acc[topic.sentiment] = (acc[topic.sentiment] || 0) + 1
    return acc
  }, {} as Record<SentimentType, number>)

  return (
    <div className="py-4">
      {/* Summary stats */}
      <div className="flex flex-wrap gap-4 mb-6">
        <div className="flex items-center gap-2 px-3 py-2 bg-purple-50 rounded-lg">
          <Hash className="w-4 h-4 text-purple-600" />
          <span className="text-sm font-medium text-purple-700">{topics.length}</span>
          <span className="text-sm text-purple-600">Topic{topics.length !== 1 ? 's' : ''}</span>
        </div>
        <div className="flex items-center gap-2 px-3 py-2 bg-yellow-50 rounded-lg">
          <Lightbulb className="w-4 h-4 text-yellow-600" />
          <span className="text-sm font-medium text-yellow-700">{totalKeyPoints}</span>
          <span className="text-sm text-yellow-600">Key Point{totalKeyPoints !== 1 ? 's' : ''}</span>
        </div>
        <div className="flex items-center gap-2 px-3 py-2 bg-blue-50 rounded-lg">
          <Gavel className="w-4 h-4 text-blue-600" />
          <span className="text-sm font-medium text-blue-700">{totalDecisions}</span>
          <span className="text-sm text-blue-600">Decision{totalDecisions !== 1 ? 's' : ''}</span>
        </div>
        <div className="flex items-center gap-2 px-3 py-2 bg-muted rounded-lg">
          <Users className="w-4 h-4 text-muted-foreground" />
          <span className="text-sm font-medium text-foreground">{uniqueSpeakers}</span>
          <span className="text-sm text-muted-foreground">Speaker{uniqueSpeakers !== 1 ? 's' : ''}</span>
        </div>
      </div>

      {/* Sentiment summary */}
      {showSentiment && Object.keys(sentimentCounts).length > 0 && (
        <div className="flex flex-wrap gap-2 mb-6">
          <span className="text-sm text-muted-foreground mr-2">Sentiment:</span>
          {Object.entries(sentimentCounts).map(([sentiment, count]) => (
            <div key={sentiment} className="flex items-center gap-1">
              <SentimentBadge sentiment={sentiment as SentimentType} size="xs" />
              <span className="text-xs text-muted-foreground">{count}</span>
            </div>
          ))}
        </div>
      )}

      {/* Timeline visualization */}
      {meetingDurationMs && topics.length > 1 && (
        <TopicsTimeline topics={topics} meetingDurationMs={meetingDurationMs} />
      )}

      {/* Topics list */}
      <div className="space-y-3">
        {sortedTopics.map((topic, index) => (
          <TopicCard
            key={index}
            topic={topic}
            meetingDurationMs={meetingDurationMs}
            defaultExpanded={defaultExpanded}
            showSentiment={showSentiment}
          />
        ))}
      </div>
    </div>
  )
}

export default TopicsList
