/**
 * Storage Management Component
 *
 * Comprehensive storage management interface showing:
 * - Total storage usage with visual breakdown
 * - Storage by meeting (audio, database)
 * - Largest and oldest meetings
 * - Storage trends over time
 * - Quick cleanup actions
 * - Storage limit warnings
 */

import { useState, useEffect, useMemo } from 'react'
import {
  HardDrive,
  Clock,
  FileAudio,
  Database,
  TrendingUp,
  AlertTriangle,
  ChevronDown,
  ChevronUp,
  RefreshCw,
  Wand2,
  Calendar,
  FileText,
  Loader2,
  CheckCircle2
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { formatFileSize, formatDate } from '@/lib/formatters'

// Types from the storage management API
interface MeetingStorageInfo {
  meetingId: string
  meetingTitle: string
  startTime: string
  audioFileSize: number
  recordingsSize: number
  databaseEstimate: number
  totalSize: number
  transcriptCount: number
  notesCount: number
  tasksCount: number
  hasAudio: boolean
  audioFilePath: string | null
  daysSinceCreated: number
}

interface StorageBreakdown {
  totalBytes: number
  audioBytes: number
  databaseBytes: number
  meetingsCount: number
  recordingsCount: number
  transcriptsCount: number
  notesCount: number
  tasksCount: number
}

interface StorageUsageResult {
  total: StorageBreakdown
  byMeeting: MeetingStorageInfo[]
  largestMeetings: MeetingStorageInfo[]
  oldestMeetings: MeetingStorageInfo[]
  meetingsWithoutTranscripts: MeetingStorageInfo[]
  meetingsWithoutNotes: MeetingStorageInfo[]
  storageLimit: number
  storageUsedPercent: number
  warningThreshold: number
  isApproachingLimit: boolean
}

interface StorageTrendPoint {
  date: string
  totalBytes: number
  audioBytes: number
  databaseBytes: number
  meetingsCount: number
}

interface StorageSettings {
  storageLimit: number
  warningThreshold: number
  autoCleanup: boolean
  audioRetentionDays: number
}

interface CleanupRecommendations {
  largeFiles: MeetingStorageInfo[]
  oldMeetings: MeetingStorageInfo[]
  emptyMeetings: MeetingStorageInfo[]
  potentialSavings: number
}

// Get the storage management API
const getStorageAPI = () => (window as any).electronAPI.storageManagement

interface StorageManagementProps {
  onOpenCleanupWizard?: () => void
}

export function StorageManagement({ onOpenCleanupWizard }: StorageManagementProps) {
  const [usage, setUsage] = useState<StorageUsageResult | null>(null)
  const [trends, setTrends] = useState<StorageTrendPoint[]>([])
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const [_settings, setSettings] = useState<StorageSettings | null>(null)
  const [recommendations, setRecommendations] = useState<CleanupRecommendations | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [expandedSection, setExpandedSection] = useState<string | null>('overview')
  const [refreshing, setRefreshing] = useState(false)

  // Load storage data
  const loadData = async () => {
    try {
      setError(null)
      const api = getStorageAPI()

      const [usageData, trendsData, settingsData, recommendationsData] = await Promise.all([
        api.getUsage(),
        api.getTrends(30),
        api.getSettings(),
        api.getRecommendations()
      ])

      setUsage(usageData)
      setTrends(trendsData)
      setSettings(settingsData) // Store for future use
      setRecommendations(recommendationsData)

      // Record trend for today
      api.recordTrend()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load storage data')
      console.error('Failed to load storage data:', err)
    } finally {
      setLoading(false)
      setRefreshing(false)
    }
  }

  useEffect(() => {
    loadData()
  }, [])

  const handleRefresh = async () => {
    setRefreshing(true)
    await loadData()
  }

  // Calculate storage breakdown percentages
  const breakdown = useMemo(() => {
    if (!usage) return null
    const total = usage.total.totalBytes || 1
    return {
      audio: (usage.total.audioBytes / total) * 100,
      database: (usage.total.databaseBytes / total) * 100
    }
  }, [usage])

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    )
  }

  if (error) {
    return (
      <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg p-4">
        <div className="flex items-start gap-3">
          <AlertTriangle className="h-5 w-5 text-red-600 dark:text-red-400 mt-0.5" />
          <div>
            <p className="font-medium text-red-700 dark:text-red-300">Error loading storage data</p>
            <p className="text-sm text-red-600 dark:text-red-400">{error}</p>
            <button
              onClick={handleRefresh}
              className="mt-2 text-sm text-red-600 dark:text-red-400 hover:underline"
            >
              Try again
            </button>
          </div>
        </div>
      </div>
    )
  }

  if (!usage) return null

  const usedPercent = Math.min(usage.storageUsedPercent * 100, 100)
  const warningPercent = usage.warningThreshold * 100

  return (
    <div className="space-y-6">
      {/* Storage Warning Banner */}
      {usage.isApproachingLimit && (
        <div className="bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-lg p-4">
          <div className="flex items-start gap-3">
            <AlertTriangle className="h-5 w-5 text-amber-600 dark:text-amber-400 mt-0.5" />
            <div className="flex-1">
              <p className="font-medium text-amber-700 dark:text-amber-300">
                Storage space is running low
              </p>
              <p className="text-sm text-amber-600 dark:text-amber-400">
                You've used {usedPercent.toFixed(1)}% of your storage limit. Consider cleaning up old meetings.
              </p>
            </div>
            {onOpenCleanupWizard && (
              <button
                onClick={onOpenCleanupWizard}
                className="px-3 py-1.5 bg-amber-600 hover:bg-amber-700 text-white rounded-md text-sm font-medium"
              >
                Clean Up Now
              </button>
            )}
          </div>
        </div>
      )}

      {/* Overview Section */}
      <CollapsibleSection
        title="Storage Overview"
        icon={HardDrive}
        isOpen={expandedSection === 'overview'}
        onToggle={() => setExpandedSection(expandedSection === 'overview' ? null : 'overview')}
        headerContent={
          <div className="flex items-center gap-4">
            <span className="text-sm text-muted-foreground">
              {formatFileSize(usage.total.totalBytes)} used
            </span>
            <button
              onClick={(e) => {
                e.stopPropagation()
                handleRefresh()
              }}
              disabled={refreshing}
              className="p-1 text-muted-foreground hover:text-foreground transition-colors"
            >
              <RefreshCw className={cn('h-4 w-4', refreshing && 'animate-spin')} />
            </button>
          </div>
        }
      >
        <div className="space-y-4">
          {/* Main Usage Bar */}
          <div>
            <div className="flex justify-between text-sm mb-2">
              <span className="text-muted-foreground">Total Storage Used</span>
              <span className="font-medium">
                {formatFileSize(usage.total.totalBytes)} of {formatFileSize(usage.storageLimit)}
              </span>
            </div>
            <div className="h-4 bg-secondary rounded-full overflow-hidden relative">
              {/* Warning threshold marker */}
              <div
                className="absolute top-0 bottom-0 w-0.5 bg-amber-500 z-10"
                style={{ left: `${warningPercent}%` }}
              />
              {/* Used space */}
              <div
                className={cn(
                  'h-full rounded-full transition-all duration-500',
                  usedPercent >= warningPercent ? 'bg-amber-500' : 'bg-purple-600'
                )}
                style={{ width: `${usedPercent}%` }}
              />
            </div>
            <div className="flex justify-between text-xs text-muted-foreground mt-1">
              <span>{usedPercent.toFixed(1)}% used</span>
              <span>Warning at {warningPercent}%</span>
            </div>
          </div>

          {/* Breakdown */}
          {breakdown && (
            <div className="grid grid-cols-2 gap-4">
              <StorageBreakdownItem
                icon={FileAudio}
                label="Audio Files"
                size={usage.total.audioBytes}
                percent={breakdown.audio}
                color="bg-blue-500"
              />
              <StorageBreakdownItem
                icon={Database}
                label="Database"
                size={usage.total.databaseBytes}
                percent={breakdown.database}
                color="bg-green-500"
              />
            </div>
          )}

          {/* Statistics Grid */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <StatCard label="Meetings" value={usage.total.meetingsCount} icon={Calendar} />
            <StatCard label="Recordings" value={usage.total.recordingsCount} icon={FileAudio} />
            <StatCard label="Transcripts" value={usage.total.transcriptsCount} icon={FileText} />
            <StatCard label="Tasks" value={usage.total.tasksCount} icon={CheckCircle2} />
          </div>
        </div>
      </CollapsibleSection>

      {/* Largest Meetings Section */}
      <CollapsibleSection
        title="Largest Meetings"
        icon={TrendingUp}
        isOpen={expandedSection === 'largest'}
        onToggle={() => setExpandedSection(expandedSection === 'largest' ? null : 'largest')}
        headerContent={
          <span className="text-sm text-muted-foreground">
            {usage.largestMeetings.length} meetings
          </span>
        }
      >
        <MeetingList meetings={usage.largestMeetings} showSize />
      </CollapsibleSection>

      {/* Oldest Meetings Section */}
      <CollapsibleSection
        title="Oldest Meetings"
        icon={Clock}
        isOpen={expandedSection === 'oldest'}
        onToggle={() => setExpandedSection(expandedSection === 'oldest' ? null : 'oldest')}
        headerContent={
          <span className="text-sm text-muted-foreground">
            {usage.oldestMeetings.length} meetings
          </span>
        }
      >
        <MeetingList meetings={usage.oldestMeetings} showAge />
      </CollapsibleSection>

      {/* Cleanup Recommendations */}
      {recommendations && (recommendations.largeFiles.length > 0 ||
        recommendations.oldMeetings.length > 0 ||
        recommendations.emptyMeetings.length > 0) && (
        <CollapsibleSection
          title="Cleanup Recommendations"
          icon={Wand2}
          isOpen={expandedSection === 'recommendations'}
          onToggle={() => setExpandedSection(expandedSection === 'recommendations' ? null : 'recommendations')}
          headerContent={
            <span className="text-sm text-muted-foreground">
              Save up to {formatFileSize(recommendations.potentialSavings)}
            </span>
          }
        >
          <div className="space-y-4">
            {recommendations.largeFiles.length > 0 && (
              <RecommendationGroup
                title="Large Files"
                description="Meetings with large audio files"
                meetings={recommendations.largeFiles}
                icon={FileAudio}
              />
            )}
            {recommendations.oldMeetings.length > 0 && (
              <RecommendationGroup
                title="Old Meetings"
                description="Meetings older than 90 days"
                meetings={recommendations.oldMeetings}
                icon={Clock}
              />
            )}
            {recommendations.emptyMeetings.length > 0 && (
              <RecommendationGroup
                title="Empty Meetings"
                description="Meetings without transcripts or notes"
                meetings={recommendations.emptyMeetings}
                icon={FileText}
              />
            )}

            {onOpenCleanupWizard && (
              <button
                onClick={onOpenCleanupWizard}
                className="w-full py-2 bg-purple-600 hover:bg-purple-700 text-white rounded-lg font-medium flex items-center justify-center gap-2"
              >
                <Wand2 className="h-4 w-4" />
                Open Cleanup Wizard
              </button>
            )}
          </div>
        </CollapsibleSection>
      )}

      {/* Storage Trends */}
      {trends.length > 0 && (
        <CollapsibleSection
          title="Storage Trends"
          icon={TrendingUp}
          isOpen={expandedSection === 'trends'}
          onToggle={() => setExpandedSection(expandedSection === 'trends' ? null : 'trends')}
          headerContent={
            <span className="text-sm text-muted-foreground">Last 30 days</span>
          }
        >
          <StorageTrendsChart trends={trends} />
        </CollapsibleSection>
      )}

      {/* Quick Actions */}
      <div className="flex flex-wrap gap-2">
        {onOpenCleanupWizard && (
          <button
            onClick={onOpenCleanupWizard}
            className="flex items-center gap-2 px-4 py-2 bg-purple-600 hover:bg-purple-700 text-white rounded-lg text-sm font-medium"
          >
            <Wand2 className="h-4 w-4" />
            Cleanup Wizard
          </button>
        )}
      </div>
    </div>
  )
}

// Helper Components

interface CollapsibleSectionProps {
  title: string
  icon: React.ComponentType<{ className?: string }>
  isOpen: boolean
  onToggle: () => void
  headerContent?: React.ReactNode
  children: React.ReactNode
}

function CollapsibleSection({
  title,
  icon: Icon,
  isOpen,
  onToggle,
  headerContent,
  children
}: CollapsibleSectionProps) {
  return (
    <div className="bg-card border border-border rounded-lg overflow-hidden">
      <button
        onClick={onToggle}
        className="w-full px-4 py-3 flex items-center justify-between hover:bg-accent/50 transition-colors"
      >
        <div className="flex items-center gap-3">
          <Icon className="h-5 w-5 text-muted-foreground" />
          <span className="font-medium text-foreground">{title}</span>
        </div>
        <div className="flex items-center gap-3">
          {headerContent}
          {isOpen ? (
            <ChevronUp className="h-4 w-4 text-muted-foreground" />
          ) : (
            <ChevronDown className="h-4 w-4 text-muted-foreground" />
          )}
        </div>
      </button>
      {isOpen && <div className="px-4 pb-4">{children}</div>}
    </div>
  )
}

interface StorageBreakdownItemProps {
  icon: React.ComponentType<{ className?: string }>
  label: string
  size: number
  percent: number
  color: string
}

function StorageBreakdownItem({ icon: Icon, label, size, percent, color }: StorageBreakdownItemProps) {
  return (
    <div className="p-3 bg-muted/50 rounded-lg">
      <div className="flex items-center gap-2 mb-2">
        <Icon className="h-4 w-4 text-muted-foreground" />
        <span className="text-sm font-medium">{label}</span>
      </div>
      <p className="text-lg font-semibold">{formatFileSize(size)}</p>
      <div className="h-1.5 bg-secondary rounded-full mt-2 overflow-hidden">
        <div className={cn('h-full rounded-full', color)} style={{ width: `${percent}%` }} />
      </div>
      <p className="text-xs text-muted-foreground mt-1">{percent.toFixed(1)}% of total</p>
    </div>
  )
}

interface StatCardProps {
  label: string
  value: number
  icon: React.ComponentType<{ className?: string }>
}

function StatCard({ label, value, icon: Icon }: StatCardProps) {
  return (
    <div className="p-3 bg-muted/50 rounded-lg text-center">
      <Icon className="h-4 w-4 text-muted-foreground mx-auto mb-1" />
      <p className="text-lg font-semibold">{value.toLocaleString()}</p>
      <p className="text-xs text-muted-foreground">{label}</p>
    </div>
  )
}

interface MeetingListProps {
  meetings: MeetingStorageInfo[]
  showSize?: boolean
  showAge?: boolean
}

function MeetingList({ meetings, showSize, showAge }: MeetingListProps) {
  if (meetings.length === 0) {
    return (
      <div className="text-center py-4 text-muted-foreground text-sm">
        No meetings to display
      </div>
    )
  }

  return (
    <div className="space-y-2">
      {meetings.map((meeting) => (
        <div
          key={meeting.meetingId}
          className="flex items-center justify-between p-3 bg-muted/50 rounded-lg"
        >
          <div className="flex-1 min-w-0">
            <p className="font-medium text-sm truncate">{meeting.meetingTitle}</p>
            <p className="text-xs text-muted-foreground">
              {formatDate(meeting.startTime)}
            </p>
          </div>
          <div className="text-right">
            {showSize && (
              <p className="text-sm font-medium">{formatFileSize(meeting.totalSize)}</p>
            )}
            {showAge && (
              <p className="text-sm font-medium">{meeting.daysSinceCreated} days old</p>
            )}
            <p className="text-xs text-muted-foreground">
              {meeting.transcriptCount} transcripts, {meeting.notesCount} notes
            </p>
          </div>
        </div>
      ))}
    </div>
  )
}

interface RecommendationGroupProps {
  title: string
  description: string
  meetings: MeetingStorageInfo[]
  icon: React.ComponentType<{ className?: string }>
}

function RecommendationGroup({ title, description, meetings, icon: Icon }: RecommendationGroupProps) {
  const totalSize = meetings.reduce((sum, m) => sum + m.totalSize, 0)

  return (
    <div className="p-3 bg-muted/30 rounded-lg">
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          <Icon className="h-4 w-4 text-muted-foreground" />
          <span className="font-medium text-sm">{title}</span>
        </div>
        <span className="text-sm text-muted-foreground">
          {meetings.length} meetings ({formatFileSize(totalSize)})
        </span>
      </div>
      <p className="text-xs text-muted-foreground mb-2">{description}</p>
      <div className="flex flex-wrap gap-1">
        {meetings.slice(0, 3).map((meeting) => (
          <span
            key={meeting.meetingId}
            className="px-2 py-0.5 bg-secondary rounded text-xs truncate max-w-[150px]"
            title={meeting.meetingTitle}
          >
            {meeting.meetingTitle}
          </span>
        ))}
        {meetings.length > 3 && (
          <span className="px-2 py-0.5 bg-secondary rounded text-xs text-muted-foreground">
            +{meetings.length - 3} more
          </span>
        )}
      </div>
    </div>
  )
}

interface StorageTrendsChartProps {
  trends: StorageTrendPoint[]
}

function StorageTrendsChart({ trends }: StorageTrendsChartProps) {
  if (trends.length === 0) {
    return (
      <div className="text-center py-8 text-muted-foreground text-sm">
        No trend data available yet
      </div>
    )
  }

  const maxBytes = Math.max(...trends.map((t) => t.totalBytes))
  const minBytes = Math.min(...trends.map((t) => t.totalBytes))
  const range = maxBytes - minBytes || 1

  return (
    <div className="space-y-2">
      <div className="h-32 flex items-end gap-1">
        {trends.map((point) => {
          const height = ((point.totalBytes - minBytes) / range) * 100
          const normalizedHeight = Math.max(height, 5) // Minimum 5% height for visibility

          return (
            <div
              key={point.date}
              className="flex-1 bg-purple-500/80 hover:bg-purple-600 rounded-t transition-colors cursor-pointer group relative"
              style={{ height: `${normalizedHeight}%` }}
              title={`${formatDate(point.date)}: ${formatFileSize(point.totalBytes)}`}
            >
              {/* Tooltip on hover */}
              <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 px-2 py-1 bg-popover border border-border rounded text-xs whitespace-nowrap opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none z-10">
                <p className="font-medium">{formatFileSize(point.totalBytes)}</p>
                <p className="text-muted-foreground">{point.meetingsCount} meetings</p>
              </div>
            </div>
          )
        })}
      </div>
      <div className="flex justify-between text-xs text-muted-foreground">
        <span>{trends.length > 0 ? formatDate(trends[0].date) : ''}</span>
        <span>{trends.length > 0 ? formatDate(trends[trends.length - 1].date) : ''}</span>
      </div>
    </div>
  )
}

export default StorageManagement
