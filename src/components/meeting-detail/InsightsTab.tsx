import { useState, useEffect, useMemo, memo, useRef } from 'react'
import { useShallow } from 'zustand/react/shallow'
import {
  Sparkles,
  Loader2,
  AlertCircle,
  RefreshCw,
  Lightbulb,
  Gavel,
  Hash,
  CheckSquare,
  ChevronDown,
  ChevronUp,
  Clock,
  User,
  Filter,
  SortAsc,
  Download,
  Plus,
  Edit2,
  CheckCircle,
  Circle,
  AlertTriangle,
  Star,
  GripVertical,
  Check,
  ChevronRight,
  FileText,
  FileJson,
  Table,
  Info
} from 'lucide-react'
import type { MeetingNote, Task, TaskStatus, TaskPriority } from '../../types/database'
import type { ExtractedDecision, ExtractedTopic, ExtractionProcessResult, SentimentType } from '../../types/electron-api'
import { formatDateTime, formatDurationMs, isOverdue } from '../../lib/formatters'
import { Skeleton, SkeletonText } from '../ui/Skeleton'
import { useRecordingStore } from '../../stores/recording-store'
import { trackInsightsEvent, createTimeTracker } from '../../utils/insightsAnalytics'
import { useLiveNotesStore } from '../../stores/live-notes-store'
import { LiveActionItemsList } from '../insights/LiveActionItemsList'
import { LiveDecisionsList } from '../insights/LiveDecisionsList'
import { LiveKeyPointsList } from '../insights/LiveKeyPointsList'
import { LiveTopicsTimeline } from '../insights/LiveTopicsTimeline'

// Type-safe accessor for the decisionsAndTopics API
interface DecisionsAndTopicsAPI {
  checkAvailability: () => Promise<{ available: boolean; error?: string; modelInfo?: string }>
  extract: (meetingId: string, config?: unknown) => Promise<ExtractionProcessResult>
  deleteExisting: (meetingId: string) => Promise<{ success: boolean; deleted: number; error?: string }>
  getDecisions: (meetingId: string) => Promise<{ success: boolean; decisions: ExtractedDecision[]; error?: string }>
  getTopicsWithDetails: (meetingId: string) => Promise<{ success: boolean; topics: ExtractedTopic[]; error?: string }>
}

const getDecisionsAndTopicsAPI = (): DecisionsAndTopicsAPI => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (window.electronAPI as any).decisionsAndTopics as DecisionsAndTopicsAPI
}

// ============================================================================
// Types
// ============================================================================

type InsightSource = 'live' | 'ai' | 'manual' | 'regenerated'
type ActionItemFilter = 'all' | 'assigned' | 'unassigned' | 'completed'
type ActionItemSort = 'time' | 'priority' | 'assignee' | 'status'

interface InsightsTabProps {
  meetingId: string
  notes: MeetingNote[]
  tasks: Task[]
  hasTranscripts: boolean
  meetingDurationMs?: number
  /** Current recording duration in ms (for live insights) */
  recordingDurationMs?: number
  onDataExtracted: () => void
  onTaskStatusChange?: (taskId: string, newStatus: TaskStatus) => void
  /** Whether insights are being fetched (for lazy loading) */
  isLoading?: boolean
  /** Whether this tab is currently active (for lazy loading optimization) */
  isActive?: boolean
  /** Callback to track analytics events */
  onAnalyticsEvent?: (event: string, properties?: Record<string, unknown>) => void
}

// ============================================================================
// Loading Skeleton Component
// ============================================================================

function InsightsLoadingSkeleton() {
  return (
    <div className="py-4 space-y-6 animate-pulse">
      {/* Header skeleton */}
      <div className="flex items-center justify-between p-4 bg-muted/30 rounded-lg">
        <Skeleton className="h-5 w-48" />
        <Skeleton className="h-10 w-48" />
      </div>

      {/* Action Items Section skeleton */}
      <div className="border border-border rounded-lg overflow-hidden">
        <div className="px-4 py-3 flex items-center justify-between bg-muted/30">
          <div className="flex items-center gap-2">
            <Skeleton className="h-5 w-5" />
            <Skeleton className="h-5 w-24" />
            <Skeleton className="h-5 w-8 rounded-full" />
          </div>
          <Skeleton className="h-5 w-5" />
        </div>
        <div className="p-4 space-y-3">
          {[1, 2, 3].map((i) => (
            <div key={i} className="flex items-start gap-3 p-3 rounded-lg border border-border">
              <Skeleton className="w-5 h-5 rounded" />
              <div className="flex-1 space-y-2">
                <Skeleton className="h-5 w-3/4" />
                <Skeleton className="h-4 w-1/2" />
              </div>
              <Skeleton className="h-6 w-16 rounded-full" />
            </div>
          ))}
        </div>
      </div>

      {/* Decisions Section skeleton */}
      <div className="border border-border rounded-lg overflow-hidden">
        <div className="px-4 py-3 flex items-center justify-between bg-muted/30">
          <div className="flex items-center gap-2">
            <Skeleton className="h-5 w-5" />
            <Skeleton className="h-5 w-20" />
            <Skeleton className="h-5 w-8 rounded-full" />
          </div>
          <Skeleton className="h-5 w-5" />
        </div>
        <div className="p-4 space-y-3">
          {[1, 2].map((i) => (
            <div key={i} className="p-4 rounded-lg border border-purple-200 bg-purple-50/50">
              <SkeletonText lines={2} />
            </div>
          ))}
        </div>
      </div>

      {/* Key Points Section skeleton */}
      <div className="border border-border rounded-lg overflow-hidden">
        <div className="px-4 py-3 flex items-center justify-between bg-muted/30">
          <div className="flex items-center gap-2">
            <Skeleton className="h-5 w-5" />
            <Skeleton className="h-5 w-24" />
            <Skeleton className="h-5 w-8 rounded-full" />
          </div>
          <Skeleton className="h-5 w-5" />
        </div>
        <div className="p-4 space-y-2">
          {[1, 2, 3].map((i) => (
            <div key={i} className="flex items-start gap-3 p-3 rounded-lg border border-border">
              <Skeleton className="w-2 h-2 rounded-full mt-2" />
              <div className="flex-1">
                <Skeleton className="h-4 w-full" />
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Topics Section skeleton */}
      <div className="border border-border rounded-lg overflow-hidden">
        <div className="px-4 py-3 flex items-center justify-between bg-muted/30">
          <div className="flex items-center gap-2">
            <Skeleton className="h-5 w-5" />
            <Skeleton className="h-5 w-16" />
            <Skeleton className="h-5 w-8 rounded-full" />
          </div>
          <Skeleton className="h-5 w-5" />
        </div>
        <div className="p-4 space-y-4">
          <Skeleton className="h-8 w-full rounded-lg" />
          {[1, 2].map((i) => (
            <div key={i} className="p-4 rounded-lg border border-border">
              <div className="flex items-center gap-2 mb-2">
                <Skeleton className="h-5 w-5" />
                <Skeleton className="h-5 w-32" />
              </div>
              <SkeletonText lines={2} />
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

// ============================================================================
// Live Insights View Component (shown during active recording)
// ============================================================================

type LiveInsightsTabId = 'action-items' | 'decisions' | 'key-points' | 'topics' | 'all'

interface LiveInsightsViewProps {
  durationMs?: number
}

function LiveInsightsView({ durationMs = 0 }: LiveInsightsViewProps) {
  const [activeTab, setActiveTab] = useState<LiveInsightsTabId>('all')

  // Get live notes data from store - use single useShallow call for better performance
  const { actionItems, decisions, keyPoints, topics, status, error, llmProvider } = useLiveNotesStore(
    useShallow((state) => ({
      actionItems: state.actionItems,
      decisions: state.decisions,
      keyPoints: state.keyPoints,
      topics: state.topics,
      status: state.status,
      error: state.error,
      llmProvider: state.llmProvider,
    }))
  )

  const isProcessing = status === 'processing' || status === 'starting'

  // Calculate counts - memoize based on array lengths only to prevent unnecessary recalculations
  const counts = useMemo(
    () => ({
      actionItems: actionItems.length,
      decisions: decisions.length,
      keyPoints: keyPoints.length,
      topics: topics.length,
      total: actionItems.length + decisions.length + keyPoints.length + topics.length,
    }),
    [actionItems.length, decisions.length, keyPoints.length, topics.length]
  )

  const tabs: { id: LiveInsightsTabId; label: string; icon: React.ReactNode; count: number; color: string }[] = [
    { id: 'action-items', label: 'Action Items', icon: <CheckSquare className="w-4 h-4" />, count: counts.actionItems, color: 'text-blue-600 dark:text-blue-400' },
    { id: 'decisions', label: 'Decisions', icon: <Gavel className="w-4 h-4" />, count: counts.decisions, color: 'text-purple-600 dark:text-purple-400' },
    { id: 'key-points', label: 'Key Points', icon: <Lightbulb className="w-4 h-4" />, count: counts.keyPoints, color: 'text-amber-600 dark:text-amber-400' },
    { id: 'topics', label: 'Topics', icon: <Hash className="w-4 h-4" />, count: counts.topics, color: 'text-green-600 dark:text-green-400' },
    { id: 'all', label: 'All', icon: <Sparkles className="w-4 h-4" />, count: counts.total, color: 'text-gray-600 dark:text-gray-400' },
  ]

  const renderTabContent = () => {
    switch (activeTab) {
      case 'action-items':
        return (
          <LiveActionItemsList
            actionItems={actionItems}
            isProcessing={isProcessing}
            showConfidence={true}
            enableAutoScroll={true}
          />
        )
      case 'decisions':
        return (
          <LiveDecisionsList
            decisions={decisions}
            isProcessing={isProcessing}
            showConfidence={true}
            enableAutoScroll={true}
          />
        )
      case 'key-points':
        return (
          <LiveKeyPointsList
            keyPoints={keyPoints}
            isProcessing={isProcessing}
            showConfidence={true}
            enableAutoScroll={true}
          />
        )
      case 'topics':
        return (
          <LiveTopicsTimeline
            topics={topics}
            durationMs={durationMs}
            isProcessing={isProcessing}
            enableAutoScroll={true}
          />
        )
      case 'all':
        return (
          <div className="space-y-4 overflow-y-auto p-2" style={{ maxHeight: '600px' }}>
            {/* Action Items Section */}
            {actionItems.length > 0 && (
              <div>
                <h3 className="text-sm font-semibold text-foreground mb-2 flex items-center gap-2">
                  <CheckSquare className="w-4 h-4 text-blue-600 dark:text-blue-400" />
                  Action Items ({actionItems.length})
                </h3>
                <LiveActionItemsList
                  actionItems={actionItems}
                  isProcessing={false}
                  showConfidence={false}
                  enableAutoScroll={false}
                />
              </div>
            )}

            {/* Decisions Section */}
            {decisions.length > 0 && (
              <div>
                <h3 className="text-sm font-semibold text-foreground mb-2 flex items-center gap-2">
                  <Gavel className="w-4 h-4 text-purple-600 dark:text-purple-400" />
                  Decisions ({decisions.length})
                </h3>
                <LiveDecisionsList
                  decisions={decisions}
                  isProcessing={false}
                  showConfidence={false}
                  enableAutoScroll={false}
                />
              </div>
            )}

            {/* Key Points Section */}
            {keyPoints.length > 0 && (
              <div>
                <h3 className="text-sm font-semibold text-foreground mb-2 flex items-center gap-2">
                  <Lightbulb className="w-4 h-4 text-amber-600 dark:text-amber-400" />
                  Key Points ({keyPoints.length})
                </h3>
                <LiveKeyPointsList
                  keyPoints={keyPoints}
                  isProcessing={false}
                  showConfidence={false}
                  enableAutoScroll={false}
                />
              </div>
            )}

            {/* Topics Section */}
            {topics.length > 0 && (
              <div>
                <h3 className="text-sm font-semibold text-foreground mb-2 flex items-center gap-2">
                  <Hash className="w-4 h-4 text-green-600 dark:text-green-400" />
                  Topics ({topics.length})
                </h3>
                <LiveTopicsTimeline
                  topics={topics}
                  durationMs={durationMs}
                  isProcessing={false}
                  enableAutoScroll={false}
                />
              </div>
            )}

            {/* Empty state for "All" tab */}
            {counts.total === 0 && (
              <div className="py-12 text-center">
                <Sparkles className="w-16 h-16 mx-auto text-muted-foreground/50 mb-4" />
                <p className="text-sm text-muted-foreground mb-2">
                  {isProcessing
                    ? 'Analyzing transcript for insights...'
                    : 'Insights will appear here as the conversation progresses.'}
                </p>
                {isProcessing && (
                  <div className="flex items-center justify-center gap-2 mt-3">
                    <Loader2 className="w-4 h-4 animate-spin text-blue-500" />
                    <span className="text-xs text-muted-foreground">Processing...</span>
                  </div>
                )}
              </div>
            )}
          </div>
        )
      default:
        return null
    }
  }

  return (
    <div className="space-y-4">
      {/* Header with live status */}
      <div className="flex items-center justify-between px-4 py-3 bg-gradient-to-r from-indigo-50 to-purple-50 dark:from-indigo-950/30 dark:to-purple-950/30 border border-border rounded-lg">
        <div className="flex items-center gap-2">
          <Sparkles className="w-5 h-5 text-indigo-600 dark:text-indigo-400" />
          <span className="font-medium text-foreground">Live Insights</span>

          {/* Status indicators */}
          <span className="flex items-center gap-1 px-2 py-0.5 text-xs bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400 rounded-full">
            <span className="w-1.5 h-1.5 bg-green-500 rounded-full animate-pulse" />
            Live
          </span>
          {isProcessing && (
            <span className="flex items-center gap-1 px-2 py-0.5 text-xs bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400 rounded-full">
              <Loader2 className="w-3 h-3 animate-spin" />
              Processing
            </span>
          )}
        </div>

        {/* LLM provider info */}
        {llmProvider && (
          <span className="text-xs text-muted-foreground">
            {llmProvider}
          </span>
        )}
      </div>

      {/* Error display */}
      {error && (
        <div className="flex items-start gap-2 p-3 bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-800 rounded-lg">
          <Info className="w-4 h-4 text-red-600 dark:text-red-400 mt-0.5 flex-shrink-0" />
          <div className="flex-1">
            <p className="text-sm font-medium text-red-700 dark:text-red-300">
              {error.message}
            </p>
          </div>
        </div>
      )}

      {/* Tabs */}
      <div className="flex flex-wrap gap-1 p-2 bg-muted/30 rounded-lg border border-border overflow-x-auto">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`flex items-center gap-2 px-3 py-2 text-sm font-medium rounded-md transition-colors ${
              activeTab === tab.id
                ? 'bg-card text-foreground shadow-sm border border-border'
                : 'text-muted-foreground hover:text-foreground hover:bg-muted'
            }`}
          >
            <span className={activeTab === tab.id ? tab.color : ''}>{tab.icon}</span>
            <span className="hidden sm:inline">{tab.label}</span>
            {tab.count > 0 && (
              <span className={`px-1.5 py-0.5 text-xs font-semibold rounded-full ${
                activeTab === tab.id
                  ? 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400'
                  : 'bg-muted text-muted-foreground'
              }`}>
                {tab.count}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* Tab content */}
      <div className="min-h-[300px] pt-2">
        {renderTabContent()}
      </div>

      {/* Footer */}
      <div className="px-4 py-2 bg-muted/30 border border-border rounded-lg">
        <p className="text-[10px] text-muted-foreground text-center flex items-center justify-center gap-1">
          <Info className="w-3 h-3" />
          Live insights update in real-time. Data is preliminary during recording.
        </p>
      </div>
    </div>
  )
}

// ============================================================================
// Source Badge Component
// ============================================================================

function SourceBadge({ source }: { source: InsightSource }) {
  const config: Record<InsightSource, { label: string; icon: string; color: string; bgColor: string; borderColor: string }> = {
    live: { label: 'Live', icon: '✓', color: 'text-green-700', bgColor: 'bg-green-50', borderColor: 'border-green-200' },
    ai: { label: 'AI', icon: '🤖', color: 'text-blue-700', bgColor: 'bg-blue-50', borderColor: 'border-blue-200' },
    manual: { label: 'Manual', icon: '✎', color: 'text-gray-700', bgColor: 'bg-gray-50', borderColor: 'border-gray-200' },
    regenerated: { label: 'Regenerated', icon: '🔄', color: 'text-orange-700', bgColor: 'bg-orange-50', borderColor: 'border-orange-200' },
  }

  const { label, icon, color, bgColor, borderColor } = config[source]

  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${bgColor} ${color} ${borderColor} border`}>
      <span className="mr-1">{icon}</span>
      {label}
    </span>
  )
}

// ============================================================================
// Confidence Indicator Component
// ============================================================================

function ConfidenceStars({ score }: { score: number }) {
  const stars = Math.round(score * 5)
  const halfStar = (score * 5) % 1 >= 0.5

  return (
    <div className="flex items-center gap-0.5" title={`${Math.round(score * 100)}% confidence`}>
      {[1, 2, 3, 4, 5].map((i) => (
        <Star
          key={i}
          className={`w-3 h-3 ${
            i <= stars
              ? 'text-yellow-500 fill-yellow-500'
              : i === stars + 1 && halfStar
              ? 'text-yellow-500 fill-yellow-200'
              : 'text-gray-300'
          }`}
        />
      ))}
    </div>
  )
}

// ============================================================================
// Collapsible Section Component
// ============================================================================

interface CollapsibleSectionProps {
  title: string
  icon: React.ReactNode
  count: number
  defaultExpanded?: boolean
  children: React.ReactNode
  headerColor?: string
  actions?: React.ReactNode
  /** Unique ID for the section (used for hash navigation) */
  sectionId?: string
}

function CollapsibleSection({
  title,
  icon,
  count,
  defaultExpanded = true,
  children,
  headerColor = 'text-purple-600',
  actions,
  sectionId
}: CollapsibleSectionProps) {
  const [isExpanded, setIsExpanded] = useState(defaultExpanded)

  return (
    <div
      id={sectionId}
      className="border border-border rounded-lg overflow-hidden scroll-mt-4"
    >
      <button
        onClick={() => setIsExpanded(!isExpanded)}
        className="w-full px-4 py-3 flex items-center justify-between bg-muted/30 hover:bg-muted/50 transition-colors"
        aria-expanded={isExpanded}
        aria-label={`${title} section, ${count} items`}
      >
        <div className="flex items-center gap-2">
          <span className={headerColor}>{icon}</span>
          <h3 className="font-semibold text-foreground">{title}</h3>
          <span className="px-2 py-0.5 rounded-full text-xs font-semibold bg-muted text-muted-foreground">
            {count}
          </span>
        </div>
        <div className="flex items-center gap-2">
          {actions && <div onClick={(e) => e.stopPropagation()}>{actions}</div>}
          {isExpanded ? (
            <ChevronUp className="w-5 h-5 text-muted-foreground" />
          ) : (
            <ChevronDown className="w-5 h-5 text-muted-foreground" />
          )}
        </div>
      </button>
      {isExpanded && (
        <div className="p-4 border-t border-border">
          {children}
        </div>
      )}
    </div>
  )
}

// ============================================================================
// Priority Badge Component
// ============================================================================

const priorityConfig: Record<TaskPriority, { label: string; color: string; bgColor: string; borderColor: string }> = {
  urgent: { label: 'Urgent', color: 'text-red-700', bgColor: 'bg-red-50', borderColor: 'border-red-200' },
  high: { label: 'High', color: 'text-orange-700', bgColor: 'bg-orange-50', borderColor: 'border-orange-200' },
  medium: { label: 'Medium', color: 'text-yellow-700', bgColor: 'bg-yellow-50', borderColor: 'border-yellow-200' },
  low: { label: 'Low', color: 'text-gray-600', bgColor: 'bg-gray-50', borderColor: 'border-gray-200' },
}

function PriorityBadge({ priority }: { priority: TaskPriority }) {
  const config = priorityConfig[priority]
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${config.bgColor} ${config.color} ${config.borderColor} border`}>
      {priority === 'urgent' && <AlertTriangle className="w-3 h-3 mr-1" />}
      {config.label}
    </span>
  )
}

// ============================================================================
// Action Items Section
// ============================================================================

interface ActionItemsSectionProps {
  tasks: Task[]
  onTaskStatusChange?: (taskId: string, newStatus: TaskStatus) => void
}

const ActionItemsSection = memo(function ActionItemsSection({ tasks, onTaskStatusChange }: ActionItemsSectionProps) {
  const [filter, setFilter] = useState<ActionItemFilter>('all')
  const [sortBy, setSortBy] = useState<ActionItemSort>('time')
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())

  // Filter tasks created during recording
  const recordingTasks = useMemo(() =>
    tasks.filter(t => t.created_during_recording),
    [tasks]
  )

  // Apply filters
  const filteredTasks = useMemo(() => {
    let result = [...recordingTasks]

    switch (filter) {
      case 'assigned':
        result = result.filter(t => t.assignee)
        break
      case 'unassigned':
        result = result.filter(t => !t.assignee)
        break
      case 'completed':
        result = result.filter(t => t.status === 'completed')
        break
    }

    // Apply sorting
    switch (sortBy) {
      case 'time':
        result.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
        break
      case 'priority':
        const priorityOrder = { urgent: 0, high: 1, medium: 2, low: 3 }
        result.sort((a, b) => priorityOrder[a.priority] - priorityOrder[b.priority])
        break
      case 'assignee':
        result.sort((a, b) => (a.assignee || 'zzz').localeCompare(b.assignee || 'zzz'))
        break
      case 'status':
        const statusOrder = { pending: 0, in_progress: 1, completed: 2, cancelled: 3 }
        result.sort((a, b) => statusOrder[a.status] - statusOrder[b.status])
        break
    }

    return result
  }, [recordingTasks, filter, sortBy])

  const handleToggleSelect = (id: string) => {
    const newSet = new Set(selectedIds)
    if (newSet.has(id)) {
      newSet.delete(id)
    } else {
      newSet.add(id)
    }
    setSelectedIds(newSet)
  }

  const handleSelectAll = () => {
    if (selectedIds.size === filteredTasks.length) {
      setSelectedIds(new Set())
    } else {
      setSelectedIds(new Set(filteredTasks.map(t => t.id)))
    }
  }

  const handleBulkComplete = async () => {
    if (!onTaskStatusChange) return
    for (const id of selectedIds) {
      await onTaskStatusChange(id, 'completed')
    }
    setSelectedIds(new Set())
  }

  const getSource = (task: Task): InsightSource => {
    if (task.created_during_recording) return 'live'
    if (task.generation_timestamp) return 'ai'
    return 'manual'
  }

  if (recordingTasks.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-12 text-center">
        <CheckSquare className="w-12 h-12 text-muted-foreground mb-4" />
        <p className="text-muted-foreground">No action items were identified during this recording</p>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      {/* Filters and Sort */}
      <div className="flex flex-wrap items-center gap-4">
        <div className="flex items-center gap-2">
          <Filter className="w-4 h-4 text-muted-foreground" />
          <select
            value={filter}
            onChange={(e) => setFilter(e.target.value as ActionItemFilter)}
            className="px-3 py-1.5 text-sm border border-border rounded-lg bg-background focus:outline-none focus:ring-2 focus:ring-purple-500"
            aria-label="Filter action items"
          >
            <option value="all">All ({recordingTasks.length})</option>
            <option value="assigned">Assigned ({recordingTasks.filter(t => t.assignee).length})</option>
            <option value="unassigned">Unassigned ({recordingTasks.filter(t => !t.assignee).length})</option>
            <option value="completed">Completed ({recordingTasks.filter(t => t.status === 'completed').length})</option>
          </select>
        </div>

        <div className="flex items-center gap-2">
          <SortAsc className="w-4 h-4 text-muted-foreground" />
          <select
            value={sortBy}
            onChange={(e) => setSortBy(e.target.value as ActionItemSort)}
            className="px-3 py-1.5 text-sm border border-border rounded-lg bg-background focus:outline-none focus:ring-2 focus:ring-purple-500"
            aria-label="Sort action items"
          >
            <option value="time">Time Detected</option>
            <option value="priority">Priority</option>
            <option value="assignee">Assignee</option>
            <option value="status">Status</option>
          </select>
        </div>

        {/* Bulk Actions */}
        {selectedIds.size > 0 && (
          <div className="flex items-center gap-2 ml-auto">
            <span className="text-sm text-muted-foreground">{selectedIds.size} selected</span>
            <button
              onClick={handleBulkComplete}
              className="px-3 py-1.5 text-sm bg-green-600 text-white rounded-lg hover:bg-green-700 transition-colors"
            >
              <Check className="w-4 h-4 inline mr-1" />
              Mark Complete
            </button>
          </div>
        )}
      </div>

      {/* Select All */}
      <div className="flex items-center gap-2 pb-2 border-b border-border">
        <input
          type="checkbox"
          checked={selectedIds.size === filteredTasks.length && filteredTasks.length > 0}
          onChange={handleSelectAll}
          className="w-4 h-4 rounded border-gray-300 text-purple-600 focus:ring-purple-500"
          aria-label="Select all action items"
        />
        <span className="text-sm text-muted-foreground">Select all</span>
      </div>

      {/* Task List */}
      <div className="space-y-2">
        {filteredTasks.map((task) => {
          const isTaskOverdue = task.due_date && task.status !== 'completed' && isOverdue(task.due_date)
          const isCompleted = task.status === 'completed'

          return (
            <div
              key={task.id}
              className={`flex items-start gap-3 p-3 rounded-lg border transition-all ${
                isTaskOverdue ? 'border-red-300 bg-red-50/50' : 'border-border bg-card'
              } ${isCompleted ? 'opacity-75' : ''} hover:shadow-sm`}
            >
              <input
                type="checkbox"
                checked={selectedIds.has(task.id)}
                onChange={() => handleToggleSelect(task.id)}
                className="mt-1 w-4 h-4 rounded border-gray-300 text-purple-600 focus:ring-purple-500"
                aria-label={`Select task: ${task.title}`}
              />

              <button
                onClick={() => onTaskStatusChange?.(task.id, isCompleted ? 'pending' : 'completed')}
                className={`mt-0.5 flex-shrink-0 ${onTaskStatusChange ? 'cursor-pointer hover:opacity-80' : 'cursor-default'}`}
                aria-label={isCompleted ? 'Mark as pending' : 'Mark as complete'}
              >
                {isCompleted ? (
                  <CheckCircle className="w-5 h-5 text-green-600" />
                ) : (
                  <Circle className="w-5 h-5 text-muted-foreground" />
                )}
              </button>

              <div className="flex-1 min-w-0">
                <div className="flex items-start justify-between gap-2 mb-1">
                  <span className={`font-medium ${isCompleted ? 'line-through text-muted-foreground' : 'text-foreground'}`}>
                    {task.title}
                  </span>
                  <div className="flex items-center gap-2 flex-shrink-0">
                    <SourceBadge source={getSource(task)} />
                    <PriorityBadge priority={task.priority} />
                  </div>
                </div>

                {task.description && (
                  <p className="text-sm text-muted-foreground mb-2">{task.description}</p>
                )}

                <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
                  {task.assignee && (
                    <span className="flex items-center px-2 py-0.5 bg-muted rounded-full">
                      <User className="w-3 h-3 mr-1" />
                      {task.assignee}
                    </span>
                  )}
                  <span className="flex items-center">
                    <Clock className="w-3 h-3 mr-1" />
                    {formatDateTime(task.created_at)}
                  </span>
                </div>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
})

// ============================================================================
// Decisions Section
// ============================================================================

interface DecisionsSectionProps {
  notes: MeetingNote[]
  extractedDecisions: ExtractedDecision[]
  onAddDecision?: () => void
  onEditDecision?: (noteId: string, content: string) => void
}

const sentimentConfig: Record<SentimentType, { label: string; color: string; bgColor: string; borderColor: string }> = {
  positive: { label: 'Positive', color: 'text-green-600', bgColor: 'bg-green-50', borderColor: 'border-green-200' },
  negative: { label: 'Negative', color: 'text-red-600', bgColor: 'bg-red-50', borderColor: 'border-red-200' },
  neutral: { label: 'Neutral', color: 'text-gray-600', bgColor: 'bg-gray-50', borderColor: 'border-gray-200' },
  mixed: { label: 'Mixed', color: 'text-yellow-600', bgColor: 'bg-yellow-50', borderColor: 'border-yellow-200' },
}

const DecisionsSection = memo(function DecisionsSection({ notes, extractedDecisions, onAddDecision, onEditDecision }: DecisionsSectionProps) {
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editContent, setEditContent] = useState('')

  // Filter decision notes
  const decisionNotes = useMemo(() =>
    notes.filter(n => n.note_type === 'decision'),
    [notes]
  )

  const getSource = (note: MeetingNote): InsightSource => {
    if (note.created_during_recording) return 'live'
    if (note.is_ai_generated) return 'ai'
    return 'manual'
  }

  const handleStartEdit = (note: MeetingNote) => {
    setEditingId(note.id)
    setEditContent(note.content)
  }

  const handleSaveEdit = (noteId: string) => {
    onEditDecision?.(noteId, editContent)
    setEditingId(null)
    setEditContent('')
  }

  const handleCancelEdit = () => {
    setEditingId(null)
    setEditContent('')
  }

  const totalDecisions = decisionNotes.length + extractedDecisions.length

  if (totalDecisions === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-12 text-center">
        <Gavel className="w-12 h-12 text-muted-foreground mb-4" />
        <p className="text-muted-foreground mb-4">No decisions were captured during this recording</p>
        <button
          onClick={onAddDecision}
          className="inline-flex items-center px-4 py-2 text-sm font-medium text-purple-600 border border-purple-300 rounded-lg hover:bg-purple-50 transition-colors"
        >
          <Plus className="w-4 h-4 mr-2" />
          Add Manual Decision
        </button>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      {/* Add button */}
      <div className="flex justify-end">
        <button
          onClick={onAddDecision}
          className="inline-flex items-center px-3 py-1.5 text-sm font-medium text-purple-600 border border-purple-300 rounded-lg hover:bg-purple-50 transition-colors"
        >
          <Plus className="w-4 h-4 mr-1" />
          Add Manual Decision
        </button>
      </div>

      {/* Extracted Decisions */}
      {extractedDecisions.map((decision, index) => {
        const style = sentimentConfig[decision.sentiment]
        return (
          <div
            key={`extracted-${index}`}
            className={`p-4 rounded-lg border ${style.bgColor} ${style.borderColor} hover:shadow-sm transition-shadow`}
          >
            <div className="flex items-start justify-between gap-2 mb-2">
              <div className="flex items-center gap-2">
                <SourceBadge source="ai" />
                {decision.confidence && <ConfidenceStars score={decision.confidence} />}
              </div>
              {(decision.startTimeMs !== undefined && decision.endTimeMs !== undefined) && (
                <span className="text-xs text-muted-foreground flex items-center">
                  <Clock className="w-3 h-3 mr-1" />
                  {formatDurationMs(decision.startTimeMs)} - {formatDurationMs(decision.endTimeMs)}
                </span>
              )}
            </div>

            <p className="font-medium text-foreground mb-2">{decision.content}</p>

            {decision.context && (
              <p className="text-sm text-muted-foreground italic mb-2">{decision.context}</p>
            )}

            {decision.speaker && (
              <div className="flex items-center text-xs text-muted-foreground">
                <User className="w-3 h-3 mr-1" />
                {decision.speaker}
              </div>
            )}
          </div>
        )
      })}

      {/* Decision Notes */}
      {decisionNotes.map((note) => (
        <div
          key={note.id}
          className="p-4 rounded-lg border border-purple-200 bg-purple-50 hover:shadow-sm transition-shadow"
        >
          {editingId === note.id ? (
            <div className="space-y-3">
              <textarea
                value={editContent}
                onChange={(e) => setEditContent(e.target.value)}
                className="w-full p-3 border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-purple-500"
                rows={3}
                aria-label="Edit decision content"
              />
              <div className="flex justify-end gap-2">
                <button
                  onClick={handleCancelEdit}
                  className="px-3 py-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={() => handleSaveEdit(note.id)}
                  className="px-3 py-1.5 text-sm bg-purple-600 text-white rounded-lg hover:bg-purple-700 transition-colors"
                >
                  Save
                </button>
              </div>
            </div>
          ) : (
            <>
              <div className="flex items-start justify-between gap-2 mb-2">
                <div className="flex items-center gap-2">
                  <SourceBadge source={getSource(note)} />
                  {note.confidence_score && <ConfidenceStars score={note.confidence_score} />}
                </div>
                <div className="flex items-center gap-1">
                  <button
                    onClick={() => handleStartEdit(note)}
                    className="p-1 text-muted-foreground hover:text-foreground transition-colors"
                    aria-label="Edit decision"
                  >
                    <Edit2 className="w-4 h-4" />
                  </button>
                  <span className="text-xs text-muted-foreground">
                    {formatDateTime(note.created_at)}
                  </span>
                </div>
              </div>

              <p className="font-medium text-foreground">{note.content}</p>

              {note.context && (
                <p className="text-sm text-muted-foreground italic mt-2">{note.context}</p>
              )}
            </>
          )}
        </div>
      ))}
    </div>
  )
})

// ============================================================================
// Key Points Section
// ============================================================================

interface KeyPointsSectionProps {
  notes: MeetingNote[]
  onAddKeyPoint?: () => void
}

const KeyPointsSection = memo(function KeyPointsSection({ notes, onAddKeyPoint }: KeyPointsSectionProps) {
  const [, setDraggedIndex] = useState<number | null>(null)

  // Filter key point notes
  const keyPointNotes = useMemo(() =>
    notes.filter(n => n.note_type === 'key_point'),
    [notes]
  )

  const getSource = (note: MeetingNote): InsightSource => {
    if (note.created_during_recording) return 'live'
    if (note.is_ai_generated) return 'ai'
    return 'manual'
  }

  // Check if a key point is "critical" based on keywords or confidence
  const isCritical = (note: MeetingNote): boolean => {
    const criticalKeywords = ['critical', 'urgent', 'important', 'essential', 'key', 'major']
    const content = note.content.toLowerCase()
    return criticalKeywords.some(k => content.includes(k)) || (note.confidence_score ?? 0) > 0.9
  }

  if (keyPointNotes.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-12 text-center">
        <Lightbulb className="w-12 h-12 text-muted-foreground mb-4" />
        <p className="text-muted-foreground mb-4">No key discussion points were captured</p>
        <button
          onClick={onAddKeyPoint}
          className="inline-flex items-center px-4 py-2 text-sm font-medium text-yellow-600 border border-yellow-300 rounded-lg hover:bg-yellow-50 transition-colors"
        >
          <Plus className="w-4 h-4 mr-2" />
          Add Manual Key Point
        </button>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      {/* Add button */}
      <div className="flex justify-end">
        <button
          onClick={onAddKeyPoint}
          className="inline-flex items-center px-3 py-1.5 text-sm font-medium text-yellow-600 border border-yellow-300 rounded-lg hover:bg-yellow-50 transition-colors"
        >
          <Plus className="w-4 h-4 mr-1" />
          Add Manual Key Point
        </button>
      </div>

      {/* Key Points List */}
      <ul className="space-y-2" role="list">
        {keyPointNotes.map((note, index) => {
          const critical = isCritical(note)
          return (
            <li
              key={note.id}
              className={`flex items-start gap-3 p-3 rounded-lg border transition-all ${
                critical
                  ? 'border-yellow-400 bg-yellow-50 ring-2 ring-yellow-200'
                  : 'border-border bg-card'
              } hover:shadow-sm cursor-move`}
              draggable
              onDragStart={() => setDraggedIndex(index)}
              onDragEnd={() => setDraggedIndex(null)}
              onDragOver={(e) => e.preventDefault()}
              role="listitem"
            >
              <GripVertical className="w-4 h-4 text-muted-foreground mt-1 flex-shrink-0" />

              <div className="flex-shrink-0 mt-1">
                {critical ? (
                  <Star className="w-4 h-4 text-yellow-500 fill-yellow-500" />
                ) : (
                  <span className="w-2 h-2 rounded-full bg-yellow-500 block mt-1" />
                )}
              </div>

              <div className="flex-1 min-w-0">
                <div className="flex items-start justify-between gap-2">
                  <p className={`text-foreground ${critical ? 'font-semibold' : ''}`}>
                    {note.content}
                  </p>
                  <SourceBadge source={getSource(note)} />
                </div>

                <div className="flex flex-wrap items-center gap-3 mt-2 text-xs text-muted-foreground">
                  {note.speaker_id && (
                    <span className="flex items-center">
                      <User className="w-3 h-3 mr-1" />
                      Speaker {note.speaker_id}
                    </span>
                  )}
                  {note.start_time_ms !== null && (
                    <span className="flex items-center">
                      <Clock className="w-3 h-3 mr-1" />
                      {formatDurationMs(note.start_time_ms)}
                    </span>
                  )}
                  {critical && (
                    <span className="px-2 py-0.5 bg-yellow-200 text-yellow-800 rounded-full font-medium">
                      Critical
                    </span>
                  )}
                </div>
              </div>
            </li>
          )
        })}
      </ul>
    </div>
  )
})

// ============================================================================
// Topics Section
// ============================================================================

interface TopicsSectionProps {
  topics: ExtractedTopic[]
  meetingDurationMs?: number
  onJumpToTranscript?: (startTimeMs: number) => void
}

const TopicsSection = memo(function TopicsSection({ topics, meetingDurationMs, onJumpToTranscript }: TopicsSectionProps) {
  if (topics.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-12 text-center">
        <Hash className="w-12 h-12 text-muted-foreground mb-4" />
        <p className="text-muted-foreground">No topics were identified</p>
      </div>
    )
  }

  // Sort topics by start time
  const sortedTopics = [...topics].sort((a, b) => a.startTimeMs - b.startTimeMs)

  // Build keyword frequency map
  const keywordFrequency = useMemo(() => {
    const freq: Record<string, number> = {}
    topics.forEach(topic => {
      topic.keyPoints.forEach(point => {
        const words = point.toLowerCase().split(/\s+/)
        words.forEach(word => {
          if (word.length > 4) {
            freq[word] = (freq[word] || 0) + 1
          }
        })
      })
    })
    return Object.entries(freq)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 20)
  }, [topics])

  return (
    <div className="space-y-6">
      {/* Timeline Visualization */}
      {meetingDurationMs && topics.length > 1 && (
        <div className="space-y-2">
          <h4 className="text-sm font-medium text-muted-foreground">Topic Flow</h4>
          <div className="w-full h-8 bg-gray-100 rounded-lg overflow-hidden flex">
            {sortedTopics.map((topic, index) => {
              const widthPercent = (topic.durationMs / meetingDurationMs) * 100
              const style = sentimentConfig[topic.sentiment]

              return (
                <button
                  key={index}
                  className={`h-full ${style.bgColor} ${style.borderColor} border-r relative group cursor-pointer transition-opacity hover:opacity-80`}
                  style={{ width: `${Math.max(widthPercent, 3)}%` }}
                  onClick={() => onJumpToTranscript?.(topic.startTimeMs)}
                  title={`${topic.name} (${formatDurationMs(topic.durationMs)})`}
                  aria-label={`Jump to ${topic.name} at ${formatDurationMs(topic.startTimeMs)}`}
                >
                  <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 px-2 py-1 bg-foreground text-background text-xs rounded whitespace-nowrap opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none z-10">
                    {topic.name}
                  </div>
                </button>
              )
            })}
          </div>
          <div className="flex justify-between text-xs text-muted-foreground">
            <span>0:00</span>
            <span>{formatDurationMs(meetingDurationMs)}</span>
          </div>
        </div>
      )}

      {/* Tag Cloud */}
      {keywordFrequency.length > 0 && (
        <div className="space-y-2">
          <h4 className="text-sm font-medium text-muted-foreground">Keywords</h4>
          <div className="flex flex-wrap gap-2">
            {keywordFrequency.map(([word, count]) => (
              <span
                key={word}
                className="px-2 py-1 bg-purple-100 text-purple-700 rounded-full transition-transform hover:scale-105"
                style={{ fontSize: `${Math.min(0.75 + count * 0.1, 1.25)}rem` }}
              >
                {word}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Topics List */}
      <div className="space-y-3">
        {sortedTopics.map((topic, index) => {
          const style = sentimentConfig[topic.sentiment]
          const isTransition = index > 0

          return (
            <div key={index}>
              {isTransition && (
                <div className="flex items-center gap-2 py-2">
                  <ChevronRight className="w-4 h-4 text-muted-foreground" />
                  <span className="text-xs text-muted-foreground">
                    Topic transition at {formatDurationMs(topic.startTimeMs)}
                  </span>
                </div>
              )}

              <div className={`p-4 rounded-lg border ${style.bgColor} ${style.borderColor} hover:shadow-sm transition-shadow`}>
                <div className="flex items-start justify-between gap-2 mb-2">
                  <div className="flex items-center gap-2">
                    <Hash className={`w-5 h-5 ${style.color}`} />
                    <h4 className="font-semibold text-foreground">{topic.name}</h4>
                  </div>
                  <button
                    onClick={() => onJumpToTranscript?.(topic.startTimeMs)}
                    className="text-xs text-purple-600 hover:text-purple-800 hover:underline flex items-center"
                    aria-label={`Jump to transcript at ${formatDurationMs(topic.startTimeMs)}`}
                  >
                    <Clock className="w-3 h-3 mr-1" />
                    {formatDurationMs(topic.startTimeMs)} - {formatDurationMs(topic.endTimeMs)}
                  </button>
                </div>

                <p className="text-sm text-muted-foreground mb-3">{topic.description}</p>

                {/* Duration bar */}
                {meetingDurationMs && (
                  <div className="mb-3">
                    <div className="w-full h-2 bg-gray-200 rounded-full overflow-hidden">
                      <div
                        className="h-full bg-purple-500 rounded-full"
                        style={{ width: `${Math.min(100, (topic.durationMs / meetingDurationMs) * 100)}%` }}
                      />
                    </div>
                    <span className="text-xs text-muted-foreground">
                      {Math.round((topic.durationMs / meetingDurationMs) * 100)}% of meeting ({formatDurationMs(topic.durationMs)})
                    </span>
                  </div>
                )}

                {/* Speakers */}
                {topic.speakers.length > 0 && (
                  <div className="flex flex-wrap gap-2 mb-3">
                    {topic.speakers.map((speaker, i) => (
                      <span key={i} className="px-2 py-0.5 text-xs bg-muted rounded-full text-muted-foreground">
                        {speaker}
                      </span>
                    ))}
                  </div>
                )}

                {/* Key points & decisions */}
                {(topic.keyPoints.length > 0 || topic.decisions.length > 0) && (
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-3 pt-3 border-t border-border/50">
                    {topic.keyPoints.length > 0 && (
                      <div>
                        <h5 className="text-xs font-medium text-muted-foreground mb-2 flex items-center">
                          <Lightbulb className="w-3 h-3 mr-1 text-yellow-500" />
                          Key Points ({topic.keyPoints.length})
                        </h5>
                        <ul className="space-y-1">
                          {topic.keyPoints.slice(0, 3).map((point, i) => (
                            <li key={i} className="text-xs text-foreground/80 flex items-start gap-1">
                              <span className="text-yellow-500">•</span>
                              {point}
                            </li>
                          ))}
                          {topic.keyPoints.length > 3 && (
                            <li className="text-xs text-muted-foreground">
                              +{topic.keyPoints.length - 3} more
                            </li>
                          )}
                        </ul>
                      </div>
                    )}

                    {topic.decisions.length > 0 && (
                      <div>
                        <h5 className="text-xs font-medium text-muted-foreground mb-2 flex items-center">
                          <Gavel className="w-3 h-3 mr-1 text-purple-500" />
                          Decisions ({topic.decisions.length})
                        </h5>
                        <ul className="space-y-1">
                          {topic.decisions.slice(0, 3).map((decision, i) => (
                            <li key={i} className="text-xs text-foreground/80 flex items-start gap-1">
                              <span className="text-purple-500">✓</span>
                              {decision}
                            </li>
                          ))}
                          {topic.decisions.length > 3 && (
                            <li className="text-xs text-muted-foreground">
                              +{topic.decisions.length - 3} more
                            </li>
                          )}
                        </ul>
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
})

// ============================================================================
// Regeneration Controls
// ============================================================================

interface RegenerationControlsProps {
  meetingId: string
  hasTranscripts: boolean
  hasExistingInsights: boolean
  generationTimestamp?: string
  onRegenerate: (mode: 'replace' | 'merge', section?: 'all' | 'decisions' | 'action_items' | 'key_points' | 'topics') => void
  isRegenerating: boolean
}

function RegenerationControls({
  hasTranscripts,
  hasExistingInsights,
  generationTimestamp,
  onRegenerate,
  isRegenerating
}: RegenerationControlsProps) {
  const [showDropdown, setShowDropdown] = useState(false)

  if (!hasTranscripts) {
    return null
  }

  return (
    <div className="flex flex-wrap items-center justify-between gap-4 mb-6 p-4 bg-muted/30 rounded-lg">
      <div className="flex items-center gap-4">
        {generationTimestamp && (
          <span className="text-sm text-muted-foreground">
            Insights generated at {formatDateTime(generationTimestamp)}
          </span>
        )}
      </div>

      <div className="relative">
        <div className="flex items-center gap-2">
          <button
            onClick={() => setShowDropdown(!showDropdown)}
            disabled={isRegenerating}
            className={`inline-flex items-center px-4 py-2 rounded-lg font-medium text-sm transition-colors ${
              isRegenerating
                ? 'bg-purple-100 text-purple-400 cursor-not-allowed'
                : 'bg-purple-600 text-white hover:bg-purple-700'
            }`}
          >
            {isRegenerating ? (
              <>
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                Regenerating...
              </>
            ) : hasExistingInsights ? (
              <>
                <RefreshCw className="w-4 h-4 mr-2" />
                Regenerate All Insights
                <ChevronDown className="w-4 h-4 ml-2" />
              </>
            ) : (
              <>
                <Sparkles className="w-4 h-4 mr-2" />
                Generate Insights with AI
              </>
            )}
          </button>
        </div>

        {showDropdown && !isRegenerating && (
          <div className="absolute right-0 mt-2 w-64 bg-card border border-border rounded-lg shadow-lg z-10">
            <div className="p-2">
              <button
                onClick={() => { onRegenerate('replace', 'all'); setShowDropdown(false) }}
                className="w-full px-3 py-2 text-left text-sm hover:bg-muted rounded-lg transition-colors"
              >
                <span className="font-medium">Replace existing insights</span>
                <p className="text-xs text-muted-foreground mt-0.5">This will delete all current insights</p>
              </button>
              <button
                onClick={() => { onRegenerate('merge', 'all'); setShowDropdown(false) }}
                className="w-full px-3 py-2 text-left text-sm hover:bg-muted rounded-lg transition-colors"
              >
                <span className="font-medium">Merge with existing insights</span>
                <p className="text-xs text-muted-foreground mt-0.5">Add new insights without removing existing ones</p>
              </button>
              <div className="border-t border-border my-2" />
              <p className="px-3 py-1 text-xs font-medium text-muted-foreground">Regenerate Section</p>
              <button
                onClick={() => { onRegenerate('replace', 'action_items'); setShowDropdown(false) }}
                className="w-full px-3 py-2 text-left text-sm hover:bg-muted rounded-lg transition-colors flex items-center"
              >
                <CheckSquare className="w-4 h-4 mr-2 text-green-600" />
                Action Items Only
              </button>
              <button
                onClick={() => { onRegenerate('replace', 'decisions'); setShowDropdown(false) }}
                className="w-full px-3 py-2 text-left text-sm hover:bg-muted rounded-lg transition-colors flex items-center"
              >
                <Gavel className="w-4 h-4 mr-2 text-purple-600" />
                Decisions Only
              </button>
              <button
                onClick={() => { onRegenerate('replace', 'key_points'); setShowDropdown(false) }}
                className="w-full px-3 py-2 text-left text-sm hover:bg-muted rounded-lg transition-colors flex items-center"
              >
                <Lightbulb className="w-4 h-4 mr-2 text-yellow-600" />
                Key Points Only
              </button>
              <button
                onClick={() => { onRegenerate('replace', 'topics'); setShowDropdown(false) }}
                className="w-full px-3 py-2 text-left text-sm hover:bg-muted rounded-lg transition-colors flex items-center"
              >
                <Hash className="w-4 h-4 mr-2 text-blue-600" />
                Topics Only
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

// ============================================================================
// Export Controls
// ============================================================================

interface ExportControlsProps {
  meetingId: string
  hasInsights: boolean
}

function ExportControls({ meetingId, hasInsights }: ExportControlsProps) {
  const [showDropdown, setShowDropdown] = useState(false)
  const [isExporting, setIsExporting] = useState(false)

  const handleExport = async (format: 'pdf' | 'markdown' | 'json' | 'csv') => {
    setIsExporting(true)
    setShowDropdown(false)

    try {
      // Use the existing export API
      if (format === 'pdf' || format === 'markdown') {
        // @ts-ignore - electronAPI is available globally
        await window.electronAPI.export.meeting(meetingId, format)
      } else {
        // For JSON/CSV, we'd need to implement custom export logic
        console.log(`Exporting as ${format} - not yet implemented`)
      }
    } catch (error) {
      console.error('Export failed:', error)
    } finally {
      setIsExporting(false)
    }
  }

  if (!hasInsights) return null

  return (
    <div className="relative">
      <button
        onClick={() => setShowDropdown(!showDropdown)}
        disabled={isExporting}
        className="inline-flex items-center px-3 py-1.5 text-sm font-medium text-muted-foreground border border-border rounded-lg hover:bg-muted transition-colors"
      >
        {isExporting ? (
          <Loader2 className="w-4 h-4 mr-2 animate-spin" />
        ) : (
          <Download className="w-4 h-4 mr-2" />
        )}
        Export Insights
      </button>

      {showDropdown && (
        <div className="absolute right-0 mt-2 w-48 bg-card border border-border rounded-lg shadow-lg z-10">
          <div className="p-2">
            <button
              onClick={() => handleExport('pdf')}
              className="w-full px-3 py-2 text-left text-sm hover:bg-muted rounded-lg transition-colors flex items-center"
            >
              <FileText className="w-4 h-4 mr-2" />
              PDF Report
            </button>
            <button
              onClick={() => handleExport('markdown')}
              className="w-full px-3 py-2 text-left text-sm hover:bg-muted rounded-lg transition-colors flex items-center"
            >
              <FileText className="w-4 h-4 mr-2" />
              Markdown
            </button>
            <button
              onClick={() => handleExport('json')}
              className="w-full px-3 py-2 text-left text-sm hover:bg-muted rounded-lg transition-colors flex items-center"
            >
              <FileJson className="w-4 h-4 mr-2" />
              JSON
            </button>
            <button
              onClick={() => handleExport('csv')}
              className="w-full px-3 py-2 text-left text-sm hover:bg-muted rounded-lg transition-colors flex items-center"
            >
              <Table className="w-4 h-4 mr-2" />
              CSV (Action Items)
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

// ============================================================================
// Main InsightsTab Component
// ============================================================================

export function InsightsTab({
  meetingId,
  notes,
  tasks,
  hasTranscripts,
  meetingDurationMs,
  recordingDurationMs,
  onDataExtracted,
  onTaskStatusChange,
  isLoading = false,
  isActive = true,
  onAnalyticsEvent
}: InsightsTabProps) {
  const [extractedDecisions, setExtractedDecisions] = useState<ExtractedDecision[]>([])
  const [extractedTopics, setExtractedTopics] = useState<ExtractedTopic[]>([])
  const [isRegenerating, setIsRegenerating] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [successMessage, setSuccessMessage] = useState<string | null>(null)
  const [refreshKey, setRefreshKey] = useState(0)
  const [isFetching, setIsFetching] = useState(false)
  const [hasFetched, setHasFetched] = useState(false)

  // Recording state for detecting active recordings
  const recordingStatus = useRecordingStore((state) => state.status)
  const recordingMeetingId = useRecordingStore((state) => state.meetingId)
  const isRecordingThisMeeting =
    (recordingStatus === 'recording' || recordingStatus === 'paused') &&
    recordingMeetingId === meetingId

  // Filter notes by type
  const decisionNotes = useMemo(() => notes.filter(n => n.note_type === 'decision'), [notes])
  const keyPointNotes = useMemo(() => notes.filter(n => n.note_type === 'key_point'), [notes])

  // Tasks created during recording
  const recordingTasks = useMemo(() => tasks.filter(t => t.created_during_recording), [tasks])

  // Calculate total insights count
  const totalInsights = useMemo(() => {
    return recordingTasks.length + decisionNotes.length + extractedDecisions.length + keyPointNotes.length + extractedTopics.length
  }, [recordingTasks.length, decisionNotes.length, extractedDecisions.length, keyPointNotes.length, extractedTopics.length])

  // Check if we have existing AI-generated insights
  const hasExistingInsights = useMemo(() => {
    return notes.some(n => n.is_ai_generated) || extractedDecisions.length > 0 || extractedTopics.length > 0
  }, [notes, extractedDecisions, extractedTopics])

  // Get the latest generation timestamp
  const generationTimestamp = useMemo(() => {
    const aiNotes = notes.filter(n => n.is_ai_generated && n.generation_timestamp)
    if (aiNotes.length === 0) return undefined
    return aiNotes.sort((a, b) =>
      new Date(b.generation_timestamp || 0).getTime() - new Date(a.generation_timestamp || 0).getTime()
    )[0].generation_timestamp || undefined
  }, [notes])

  // Lazy load extracted decisions and topics - only fetch when tab is active
  useEffect(() => {
    // Skip if not active or already fetched
    if (!isActive || hasFetched) {
      return
    }

    const fetchExtractedData = async () => {
      const api = getDecisionsAndTopicsAPI()
      setIsFetching(true)

      try {
        const [decisionsResult, topicsResult] = await Promise.all([
          api.getDecisions(meetingId),
          api.getTopicsWithDetails(meetingId)
        ])

        if (decisionsResult.success && decisionsResult.decisions) {
          setExtractedDecisions(decisionsResult.decisions)
        }
        if (topicsResult.success && topicsResult.topics) {
          setExtractedTopics(topicsResult.topics)
        }

        setHasFetched(true)

        // Track tab view event
        onAnalyticsEvent?.('insights_tab_viewed', {
          meetingId,
          hasTranscripts,
          decisionsCount: decisionsResult.decisions?.length || 0,
          topicsCount: topicsResult.topics?.length || 0,
        })
      } catch (err) {
        console.error('Failed to fetch extracted insights:', err)
      } finally {
        setIsFetching(false)
      }
    }

    fetchExtractedData()
  }, [meetingId, isActive, hasFetched, hasTranscripts, onAnalyticsEvent])

  // Refetch when refreshKey changes (e.g., after regeneration)
  useEffect(() => {
    if (refreshKey > 0) {
      setHasFetched(false)
    }
  }, [refreshKey])

  // Invalidate cache when recording stops
  useEffect(() => {
    if (recordingStatus === 'idle' && recordingMeetingId === meetingId) {
      setHasFetched(false)
    }
  }, [recordingStatus, recordingMeetingId, meetingId])

  // Time tracking for analytics
  const timeTrackerRef = useRef(createTimeTracker())

  // Track time spent on insights tab
  useEffect(() => {
    if (isActive) {
      // Reset tracker when tab becomes active
      timeTrackerRef.current = createTimeTracker()

      // Track tab view
      trackInsightsEvent('insights_tab_viewed', {
        meetingId,
        hasTranscripts,
        insightsCount: totalInsights,
        isRecording: isRecordingThisMeeting,
      })

      return () => {
        // Track time spent when leaving tab
        const timeSpentMs = timeTrackerRef.current.stop()
        trackInsightsEvent('time_on_insights_tab', {
          meetingId,
          durationMs: timeSpentMs,
          durationSeconds: Math.round(timeSpentMs / 1000),
        })
      }
    }
  }, [isActive, meetingId, hasTranscripts, totalInsights, isRecordingThisMeeting])

  // Handle regeneration
  const handleRegenerate = async (mode: 'replace' | 'merge', section?: 'all' | 'decisions' | 'action_items' | 'key_points' | 'topics') => {
    setIsRegenerating(true)
    setError(null)
    setSuccessMessage(null)

    // Track regeneration started
    trackInsightsEvent('generate_insights_clicked', {
      meetingId,
      mode,
      section: section || 'all',
      hasExistingInsights,
    })

    const api = getDecisionsAndTopicsAPI()

    try {
      // Check if LLM service is available
      const availability = await api.checkAvailability()

      if (!availability.available) {
        setError(availability.error || 'LLM service is not available. Please ensure LM Studio is running.')
        setIsRegenerating(false)
        return
      }

      // If replace mode and regenerating all, delete existing
      if (mode === 'replace' && (section === 'all' || !section)) {
        await api.deleteExisting(meetingId)
      }

      // Extract new insights
      const result = await api.extract(meetingId)

      if (!result.success) {
        setError(result.error || 'Failed to regenerate insights')
        setIsRegenerating(false)
        return
      }

      // Show success message
      const decisionsCount = result.extraction?.decisions?.length || 0
      const topicsCount = result.extraction?.topics?.length || 0
      const keyPointsCount = result.extraction?.keyPoints?.length || 0

      setSuccessMessage(
        `Extracted ${decisionsCount} decision${decisionsCount !== 1 ? 's' : ''}, ` +
        `${topicsCount} topic${topicsCount !== 1 ? 's' : ''}, and ` +
        `${keyPointsCount} key point${keyPointsCount !== 1 ? 's' : ''}!`
      )

      // Track successful generation
      trackInsightsEvent(hasExistingInsights ? 'insight_regenerated' : 'insight_generated', {
        meetingId,
        mode,
        section: section || 'all',
        decisionsCount,
        topicsCount,
        keyPointsCount,
        processingTimeMs: result.metadata?.processingTimeMs,
      })

      // Notify parent to refetch data
      onDataExtracted()
      setRefreshKey(prev => prev + 1)

      // Auto-hide success message
      setTimeout(() => setSuccessMessage(null), 5000)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An unexpected error occurred')
    } finally {
      setIsRegenerating(false)
    }
  }

  // Show loading skeleton while fetching (but not during recording)
  if ((isLoading || isFetching) && !isRecordingThisMeeting) {
    return <InsightsLoadingSkeleton />
  }

  // Show live insights view during active recording
  if (isRecordingThisMeeting) {
    return <LiveInsightsView durationMs={recordingDurationMs} />
  }

  // Empty state - no insights at all
  if (totalInsights === 0 && !hasTranscripts) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-center">
        <Lightbulb className="w-16 h-16 text-muted-foreground mb-4" />
        <h3 className="text-xl font-semibold text-foreground mb-2">No insights available for this meeting</h3>
        <p className="text-muted-foreground max-w-md">
          AI can analyze the transcript to extract action items, decisions, key points, and topics.
          Record a meeting first to generate insights.
        </p>
      </div>
    )
  }

  // Empty state - has transcripts but no insights generated
  if (totalInsights === 0 && hasTranscripts) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-center">
        <Lightbulb className="w-16 h-16 text-muted-foreground mb-4" />
        <h3 className="text-xl font-semibold text-foreground mb-2">No insights available for this meeting</h3>
        <p className="text-muted-foreground max-w-md mb-6">
          AI can analyze the transcript to extract action items, decisions, key points, and topics.
        </p>
        <button
          onClick={() => handleRegenerate('replace', 'all')}
          disabled={isRegenerating}
          className={`inline-flex items-center px-6 py-3 rounded-lg font-medium text-sm transition-colors ${
            isRegenerating
              ? 'bg-purple-100 text-purple-400 cursor-not-allowed'
              : 'bg-purple-600 text-white hover:bg-purple-700'
          }`}
        >
          {isRegenerating ? (
            <>
              <Loader2 className="w-5 h-5 mr-2 animate-spin" />
              Generating...
            </>
          ) : (
            <>
              <Sparkles className="w-5 h-5 mr-2" />
              Generate Insights with AI
            </>
          )}
        </button>

        {error && (
          <div className="mt-4 p-3 bg-red-50 border border-red-200 rounded-lg max-w-md">
            <div className="flex items-start gap-2">
              <AlertCircle className="w-4 h-4 text-red-600 mt-0.5 flex-shrink-0" />
              <div>
                <p className="text-sm text-red-700">{error}</p>
                <p className="text-xs text-red-600 mt-1">
                  Make sure LM Studio is running on localhost:1234 with a model loaded.
                </p>
              </div>
            </div>
          </div>
        )}
      </div>
    )
  }

  return (
    <div className="py-4 space-y-6">
      {/* Header with regeneration and export controls */}
      <div className="flex items-center justify-between">
        <RegenerationControls
          meetingId={meetingId}
          hasTranscripts={hasTranscripts}
          hasExistingInsights={hasExistingInsights}
          generationTimestamp={generationTimestamp}
          onRegenerate={handleRegenerate}
          isRegenerating={isRegenerating}
        />
        <ExportControls meetingId={meetingId} hasInsights={totalInsights > 0} />
      </div>

      {/* Error message */}
      {error && (
        <div className="p-3 bg-red-50 border border-red-200 rounded-lg">
          <div className="flex items-start gap-2">
            <AlertCircle className="w-4 h-4 text-red-600 mt-0.5 flex-shrink-0" />
            <div>
              <p className="text-sm text-red-700">{error}</p>
              <p className="text-xs text-red-600 mt-1">
                Make sure LM Studio is running on localhost:1234 with a model loaded.
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Success message */}
      {successMessage && (
        <div className="p-3 bg-green-50 border border-green-200 rounded-lg">
          <div className="flex items-center gap-2">
            <Sparkles className="w-4 h-4 text-green-600 flex-shrink-0" />
            <p className="text-sm text-green-700">{successMessage}</p>
          </div>
        </div>
      )}

      {/* Collapsible Sections */}
      <div className="space-y-4">
        {/* Action Items Section */}
        <CollapsibleSection
          sectionId="action-items"
          title="Action Items"
          icon={<CheckSquare className="w-5 h-5" />}
          count={recordingTasks.length}
          headerColor="text-green-600"
          defaultExpanded={true}
        >
          <ActionItemsSection
            tasks={tasks}
            onTaskStatusChange={onTaskStatusChange}
          />
        </CollapsibleSection>

        {/* Decisions Section */}
        <CollapsibleSection
          sectionId="decisions"
          title="Decisions"
          icon={<Gavel className="w-5 h-5" />}
          count={decisionNotes.length + extractedDecisions.length}
          headerColor="text-purple-600"
          defaultExpanded={true}
        >
          <DecisionsSection
            notes={notes}
            extractedDecisions={extractedDecisions}
          />
        </CollapsibleSection>

        {/* Key Points Section */}
        <CollapsibleSection
          sectionId="key-points"
          title="Key Points"
          icon={<Lightbulb className="w-5 h-5" />}
          count={keyPointNotes.length}
          headerColor="text-yellow-600"
          defaultExpanded={true}
        >
          <KeyPointsSection notes={notes} />
        </CollapsibleSection>

        {/* Topics Section */}
        <CollapsibleSection
          sectionId="topics"
          title="Topics"
          icon={<Hash className="w-5 h-5" />}
          count={extractedTopics.length}
          headerColor="text-blue-600"
          defaultExpanded={true}
        >
          <TopicsSection
            topics={extractedTopics}
            meetingDurationMs={meetingDurationMs}
          />
        </CollapsibleSection>
      </div>
    </div>
  )
}

export default InsightsTab
