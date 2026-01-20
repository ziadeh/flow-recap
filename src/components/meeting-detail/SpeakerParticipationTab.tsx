/**
 * SpeakerParticipationTab Component
 *
 * Displays speaker participation analytics for a meeting including:
 * - Talk time distribution per speaker
 * - Participation balance metrics
 * - Visual pie/bar charts
 * - Detailed speaker statistics
 */

import { useMemo, memo } from 'react'
import {
  Users,
  Clock,
  BarChart3,
  AlertTriangle,
  CheckCircle2,
  TrendingUp,
  MessageSquare,
  Timer,
  Mic,
  Info,
  RefreshCw
} from 'lucide-react'
import { useSpeakerParticipation } from '../../hooks/useSpeakerParticipation'
import { Skeleton } from '../ui/Skeleton'
import type { SpeakerParticipation, MeetingParticipationAnalytics } from '../../types/database'

// ============================================================================
// Types
// ============================================================================

export interface SpeakerParticipationTabProps {
  meetingId: string
  isActive?: boolean
}

// ============================================================================
// Loading Skeleton
// ============================================================================

function ParticipationLoadingSkeleton() {
  return (
    <div className="py-4 space-y-6 animate-pulse">
      {/* Overview Cards skeleton */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {[1, 2, 3, 4].map((i) => (
          <div key={i} className="bg-card border border-border rounded-lg p-4">
            <Skeleton className="h-4 w-20 mb-2" />
            <Skeleton className="h-8 w-16" />
          </div>
        ))}
      </div>

      {/* Chart skeleton */}
      <div className="bg-card border border-border rounded-lg p-6">
        <Skeleton className="h-6 w-48 mb-4" />
        <div className="flex gap-4 items-end h-48">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="flex-1 flex flex-col items-center gap-2">
              <Skeleton className="w-full" style={{ height: `${20 + Math.random() * 60}%` }} />
              <Skeleton className="h-4 w-16" />
            </div>
          ))}
        </div>
      </div>

      {/* Speaker details skeleton */}
      <div className="bg-card border border-border rounded-lg p-4">
        <Skeleton className="h-6 w-36 mb-4" />
        <div className="space-y-3">
          {[1, 2, 3].map((i) => (
            <div key={i} className="flex items-center gap-4 p-3 rounded-lg border border-border">
              <Skeleton className="w-10 h-10 rounded-full" />
              <div className="flex-1">
                <Skeleton className="h-5 w-24 mb-1" />
                <Skeleton className="h-4 w-32" />
              </div>
              <Skeleton className="h-6 w-16" />
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

// ============================================================================
// Overview Stats Card
// ============================================================================

interface StatCardProps {
  icon: React.ReactNode
  label: string
  value: string | number
  subValue?: string
  iconColor?: string
}

function StatCard({ icon, label, value, subValue, iconColor = 'text-blue-500' }: StatCardProps) {
  return (
    <div className="bg-card border border-border rounded-lg p-4 hover:shadow-sm transition-shadow">
      <div className="flex items-start gap-3">
        <div className={`p-2 rounded-lg bg-muted ${iconColor}`}>
          {icon}
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm text-muted-foreground truncate">{label}</p>
          <p className="text-xl font-semibold text-foreground">{value}</p>
          {subValue && (
            <p className="text-xs text-muted-foreground">{subValue}</p>
          )}
        </div>
      </div>
    </div>
  )
}

// ============================================================================
// Participation Bar Chart
// ============================================================================

interface ParticipationBarChartProps {
  speakers: SpeakerParticipation[]
}

// Speaker colors palette
const SPEAKER_COLORS = [
  'bg-blue-500',
  'bg-green-500',
  'bg-purple-500',
  'bg-orange-500',
  'bg-pink-500',
  'bg-cyan-500',
  'bg-indigo-500',
  'bg-teal-500'
]

function ParticipationBarChart({ speakers }: ParticipationBarChartProps) {
  const maxPercentage = Math.max(...speakers.map(s => s.talkTimePercentage), 1)

  return (
    <div className="bg-card border border-border rounded-lg p-6">
      <h3 className="text-lg font-semibold text-foreground mb-4 flex items-center gap-2">
        <BarChart3 className="w-5 h-5 text-purple-500" />
        Talk Time Distribution
      </h3>

      <div className="space-y-4">
        {speakers.map((speaker, index) => {
          const barWidth = (speaker.talkTimePercentage / maxPercentage) * 100
          const colorClass = SPEAKER_COLORS[index % SPEAKER_COLORS.length]

          return (
            <div key={speaker.speakerId} className="group">
              <div className="flex items-center justify-between mb-1">
                <span className="text-sm font-medium text-foreground truncate max-w-[200px]">
                  {speaker.speakerName}
                </span>
                <span className="text-sm text-muted-foreground">
                  {speaker.talkTimePercentage.toFixed(1)}%
                </span>
              </div>
              <div className="h-6 bg-muted rounded-full overflow-hidden">
                <div
                  className={`h-full ${colorClass} transition-all duration-500 ease-out group-hover:opacity-80 flex items-center justify-end px-2`}
                  style={{ width: `${barWidth}%`, minWidth: speaker.talkTimePercentage > 0 ? '24px' : '0' }}
                >
                  {speaker.talkTimePercentage >= 10 && (
                    <span className="text-xs font-medium text-white">
                      {formatDuration(speaker.talkTimeMs)}
                    </span>
                  )}
                </div>
              </div>
            </div>
          )
        })}
      </div>

      {speakers.length === 0 && (
        <div className="text-center py-8 text-muted-foreground">
          No speaker data available
        </div>
      )}
    </div>
  )
}

// ============================================================================
// Speaker Details List
// ============================================================================

interface SpeakerDetailsListProps {
  speakers: SpeakerParticipation[]
}

function SpeakerDetailsList({ speakers }: SpeakerDetailsListProps) {
  return (
    <div className="bg-card border border-border rounded-lg p-4">
      <h3 className="text-lg font-semibold text-foreground mb-4 flex items-center gap-2">
        <Users className="w-5 h-5 text-blue-500" />
        Speaker Details
      </h3>

      <div className="space-y-3">
        {speakers.map((speaker, index) => {
          const colorClass = SPEAKER_COLORS[index % SPEAKER_COLORS.length]

          return (
            <div
              key={speaker.speakerId}
              className="flex items-center gap-4 p-3 rounded-lg border border-border hover:bg-muted/50 transition-colors"
            >
              {/* Speaker avatar placeholder */}
              <div className={`w-10 h-10 rounded-full ${colorClass} flex items-center justify-center text-white font-semibold`}>
                {speaker.speakerName.charAt(0).toUpperCase()}
              </div>

              {/* Speaker info */}
              <div className="flex-1 min-w-0">
                <p className="font-medium text-foreground truncate">
                  {speaker.speakerName}
                </p>
                <div className="flex items-center gap-3 text-xs text-muted-foreground">
                  <span className="flex items-center gap-1">
                    <Mic className="w-3 h-3" />
                    {speaker.segmentCount} segments
                  </span>
                  <span className="flex items-center gap-1">
                    <MessageSquare className="w-3 h-3" />
                    {speaker.wordCount} words
                  </span>
                  <span className="flex items-center gap-1">
                    <TrendingUp className="w-3 h-3" />
                    {speaker.wordsPerMinute} WPM
                  </span>
                </div>
              </div>

              {/* Talk time badge */}
              <div className="text-right">
                <p className="font-semibold text-foreground">
                  {formatDuration(speaker.talkTimeMs)}
                </p>
                <p className="text-xs text-muted-foreground">
                  {speaker.talkTimePercentage.toFixed(1)}%
                </p>
              </div>
            </div>
          )
        })}
      </div>

      {speakers.length === 0 && (
        <div className="text-center py-8 text-muted-foreground">
          No speakers found for this meeting
        </div>
      )}
    </div>
  )
}

// ============================================================================
// Balance Indicator
// ============================================================================

interface BalanceIndicatorProps {
  isBalanced: boolean
  giniCoefficient: number
}

function BalanceIndicator({ isBalanced, giniCoefficient }: BalanceIndicatorProps) {
  const getGiniLabel = (gini: number): { label: string; color: string } => {
    if (gini < 0.2) return { label: 'Very Equal', color: 'text-green-600 dark:text-green-400' }
    if (gini < 0.35) return { label: 'Balanced', color: 'text-blue-600 dark:text-blue-400' }
    if (gini < 0.5) return { label: 'Moderate', color: 'text-yellow-600 dark:text-yellow-400' }
    if (gini < 0.65) return { label: 'Unbalanced', color: 'text-orange-600 dark:text-orange-400' }
    return { label: 'Dominated', color: 'text-red-600 dark:text-red-400' }
  }

  const { label, color } = getGiniLabel(giniCoefficient)

  return (
    <div className={`flex items-center gap-2 px-3 py-2 rounded-lg ${isBalanced ? 'bg-green-50 dark:bg-green-950/30' : 'bg-yellow-50 dark:bg-yellow-950/30'}`}>
      {isBalanced ? (
        <CheckCircle2 className="w-5 h-5 text-green-600 dark:text-green-400" />
      ) : (
        <AlertTriangle className="w-5 h-5 text-yellow-600 dark:text-yellow-400" />
      )}
      <div>
        <p className={`font-medium ${color}`}>{label}</p>
        <p className="text-xs text-muted-foreground">
          Gini: {(giniCoefficient * 100).toFixed(1)}%
        </p>
      </div>
    </div>
  )
}

// ============================================================================
// Insights Section
// ============================================================================

interface InsightsSectionProps {
  analytics: MeetingParticipationAnalytics
}

function InsightsSection({ analytics }: InsightsSectionProps) {
  const insights = useMemo(() => {
    const result: Array<{
      type: 'info' | 'warning' | 'suggestion'
      title: string
      description: string
    }> = []

    // Check for dominant speaker
    if (analytics.dominantSpeaker && analytics.dominantSpeaker.talkTimePercentage > 60) {
      result.push({
        type: 'warning',
        title: 'High Dominance',
        description: `${analytics.dominantSpeaker.speakerName} spoke ${analytics.dominantSpeaker.talkTimePercentage.toFixed(0)}% of the time, which may limit other contributions.`
      })
    }

    // Check for silent participants
    const lowParticipants = analytics.speakers.filter(s => s.talkTimePercentage < 10)
    if (lowParticipants.length > 0 && analytics.speakers.length > 2) {
      result.push({
        type: 'suggestion',
        title: 'Low Participation',
        description: `${lowParticipants.map(s => s.speakerName).join(', ')} contributed less than 10% each. Consider inviting their input.`
      })
    }

    // Word count insight
    if (analytics.totalWordCount > 0) {
      const avgWordsPerSpeaker = analytics.totalWordCount / analytics.speakerCount
      result.push({
        type: 'info',
        title: 'Meeting Activity',
        description: `${analytics.totalWordCount} total words spoken, averaging ${Math.round(avgWordsPerSpeaker)} words per speaker.`
      })
    }

    // Balance insight
    if (analytics.isBalanced && analytics.speakerCount >= 2) {
      result.push({
        type: 'info',
        title: 'Well-Balanced Discussion',
        description: 'Participation was distributed fairly among all speakers.'
      })
    }

    return result
  }, [analytics])

  if (insights.length === 0) return null

  const getInsightStyles = (type: 'info' | 'warning' | 'suggestion') => {
    switch (type) {
      case 'warning':
        return 'bg-yellow-50 dark:bg-yellow-950/30 border-yellow-200 dark:border-yellow-800'
      case 'suggestion':
        return 'bg-blue-50 dark:bg-blue-950/30 border-blue-200 dark:border-blue-800'
      default:
        return 'bg-gray-50 dark:bg-gray-900/30 border-gray-200 dark:border-gray-700'
    }
  }

  return (
    <div className="bg-card border border-border rounded-lg p-4">
      <h3 className="text-lg font-semibold text-foreground mb-4 flex items-center gap-2">
        <Info className="w-5 h-5 text-indigo-500" />
        Participation Insights
      </h3>

      <div className="space-y-3">
        {insights.map((insight, index) => (
          <div
            key={index}
            className={`p-3 rounded-lg border ${getInsightStyles(insight.type)}`}
          >
            <p className="font-medium text-foreground text-sm">{insight.title}</p>
            <p className="text-sm text-muted-foreground mt-1">{insight.description}</p>
          </div>
        ))}
      </div>
    </div>
  )
}

// ============================================================================
// Helper Functions
// ============================================================================

function formatDuration(ms: number): string {
  const seconds = Math.floor(ms / 1000)
  const minutes = Math.floor(seconds / 60)
  const hours = Math.floor(minutes / 60)

  if (hours > 0) {
    return `${hours}h ${minutes % 60}m`
  }
  if (minutes > 0) {
    return `${minutes}m ${seconds % 60}s`
  }
  return `${seconds}s`
}

// ============================================================================
// Empty State
// ============================================================================

function EmptyState() {
  return (
    <div className="flex flex-col items-center justify-center py-16 text-center">
      <Users className="w-16 h-16 text-muted-foreground mb-4" />
      <h3 className="text-xl font-semibold text-foreground mb-2">No Participation Data</h3>
      <p className="text-muted-foreground max-w-md">
        Participation analytics will be available once the meeting has speaker-diarized transcripts.
        Record a meeting with transcription enabled to see participation data.
      </p>
    </div>
  )
}

// ============================================================================
// Main Component
// ============================================================================

export const SpeakerParticipationTab = memo(function SpeakerParticipationTab({
  meetingId,
  isActive = true
}: SpeakerParticipationTabProps) {
  const { participation, loading, error, refetch } = useSpeakerParticipation({
    meetingId,
    lazyLoad: true,
    isActive
  })

  // Show loading state
  if (loading && !participation) {
    return <ParticipationLoadingSkeleton />
  }

  // Show error state
  if (error && !participation) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-center">
        <AlertTriangle className="w-16 h-16 text-red-500 mb-4" />
        <h3 className="text-xl font-semibold text-foreground mb-2">Failed to Load Data</h3>
        <p className="text-muted-foreground mb-4">{error.message}</p>
        <button
          onClick={() => refetch()}
          className="flex items-center gap-2 px-4 py-2 bg-primary text-primary-foreground rounded-lg hover:opacity-90 transition-opacity"
        >
          <RefreshCw className="w-4 h-4" />
          Retry
        </button>
      </div>
    )
  }

  // Show empty state
  if (!participation || participation.speakerCount === 0) {
    return <EmptyState />
  }

  return (
    <div className="py-4 space-y-6">
      {/* Overview Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <StatCard
          icon={<Users className="w-5 h-5" />}
          label="Speakers"
          value={participation.speakerCount}
          iconColor="text-blue-500"
        />
        <StatCard
          icon={<Clock className="w-5 h-5" />}
          label="Duration"
          value={formatDuration(participation.totalDurationMs)}
          iconColor="text-green-500"
        />
        <StatCard
          icon={<MessageSquare className="w-5 h-5" />}
          label="Total Words"
          value={participation.totalWordCount.toLocaleString()}
          iconColor="text-purple-500"
        />
        <StatCard
          icon={<Timer className="w-5 h-5" />}
          label="Speaker Turns"
          value={participation.totalSpeakerTurns}
          subValue={`~${participation.averageWordsPerTurn} words/turn`}
          iconColor="text-orange-500"
        />
      </div>

      {/* Balance Status */}
      <div className="flex items-center justify-between bg-card border border-border rounded-lg p-4">
        <div>
          <h3 className="font-semibold text-foreground">Participation Balance</h3>
          <p className="text-sm text-muted-foreground">
            How evenly speaking time was distributed among participants
          </p>
        </div>
        <BalanceIndicator
          isBalanced={participation.isBalanced}
          giniCoefficient={participation.giniCoefficient}
        />
      </div>

      {/* Talk Time Distribution Chart */}
      <ParticipationBarChart
        speakers={participation.speakers}
      />

      {/* Speaker Details */}
      <SpeakerDetailsList speakers={participation.speakers} />

      {/* Insights */}
      <InsightsSection analytics={participation} />

      {/* Refresh indicator */}
      {loading && participation && (
        <div className="fixed bottom-4 right-4 bg-card border border-border rounded-lg px-4 py-2 shadow-lg flex items-center gap-2">
          <RefreshCw className="w-4 h-4 animate-spin text-blue-500" />
          <span className="text-sm text-muted-foreground">Refreshing...</span>
        </div>
      )}
    </div>
  )
})

export default SpeakerParticipationTab
