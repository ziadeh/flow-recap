/**
 * MainContentArea Component - Overview Tab
 *
 * Main content area displaying priority-ordered sections.
 * **STRICT SECTION ORDER - DO NOT REORDER**:
 * 1. Meeting Summary (auto-generated on recording stop, MUST BE FIRST SECTION,
 *    expanded by default, 250-400 words, editable, prominent heading 'Meeting Summary')
 * 2. Notes (user-added notes, same compact list design as Key Points, bulleted items
 *    with 32-40px row height, expandable, appears AFTER Meeting Summary)
 * 3. Action Items (existing compact list with checkboxes, assignee, due date, 40-48px row height)
 * 4. Decisions (existing compact list with context tooltips, timestamps, 40-48px row height)
 * 5. Topics (redesigned to match Key Points styling, bulleted list with topic name,
 *    keywords, duration, 32-40px row height, clickable to filter transcript)
 * 6. Overall Sentiment (badge at bottom with color coding and explanation)
 *
 * Design Token Spacing Rules:
 * - Card padding = 16px
 * - Section spacing = 12-16px between sections
 * - Row spacing within lists = 8px
 * - Header style = 18px font, medium weight, 8px bottom margin
 * - No nested cards (use subtle dividers between sections)
 * - Default view: Meeting Summary + Notes + Action Items above fold (no scrolling needed)
 *
 * Note: Insights tab removed - all content consolidated into this Overview tab
 * IMPLEMENTATION CHECK: Meeting Summary component MUST render BEFORE Notes component
 */

import { useState, useMemo, memo, useEffect, useCallback } from 'react'
import {
  FileText,
  Sparkles,
  CheckSquare,
  Gavel,
  ChevronDown,
  ChevronUp,
  Info,
  Circle,
  CheckCircle,
  User,
  Clock,
  AlertTriangle,
  Hash,
  ThumbsUp,
  ThumbsDown,
  Minus,
  HelpCircle
} from 'lucide-react'
import type { MeetingNote, Task, TaskStatus, Transcript, Speaker } from '../../types/database'
import type { ExtractedTopic, SentimentType } from '../../types/electron-api'
import { formatDate, isOverdue, formatDurationMs, cleanNoteContent } from '../../lib/formatters'
import { NotesEditor } from './NotesEditor'
import { MeetingSummary } from './MeetingSummary'
import { MeetingSummaryErrorBoundary } from './MeetingSummaryErrorBoundary'
import { NoteRow, CompactListContainer } from './CompactInsightRows'
import { SummaryStatusIndicator } from './SummaryStatusIndicator'

// ============================================================================
// Debug Logging Utilities for Overview Tab
// ============================================================================

const DEBUG_PREFIX = '[Overview Tab Debug]'

/**
 * Log a debug message with timestamp for Overview tab
 */
function debugLog(message: string, data?: Record<string, unknown>) {
  if (process.env.NODE_ENV === 'development') {
    console.log(
      `%c${DEBUG_PREFIX} ${message}`,
      'color: #06b6d4; font-weight: bold',
      data ? { ...data, timestamp: new Date().toISOString() } : { timestamp: new Date().toISOString() }
    )
  }
}

/**
 * Log a debug warning for Overview tab
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
 * Log a debug error for Overview tab
 * Note: Exported for use by other components that may need error logging
 */
export function debugErrorOverview(message: string, data?: Record<string, unknown>) {
  console.error(
    `%c${DEBUG_PREFIX} ${message}`,
    'color: #ef4444; font-weight: bold',
    data ? { ...data, timestamp: new Date().toISOString() } : { timestamp: new Date().toISOString() }
  )
}

// ============================================================================
// Types
// ============================================================================

interface MainContentAreaProps {
  /** Meeting ID */
  meetingId: string
  /** Meeting notes */
  notes: MeetingNote[]
  /** Tasks associated with the meeting */
  tasks: Task[]
  /** Transcript entries */
  transcripts: Transcript[]
  /** Speaker data */
  speakers: Map<string, Speaker>
  /** Speaker name overrides */
  speakerNameOverrides?: Map<string, string>
  /** Current audio time for transcript sync */
  currentAudioTime?: number
  /** Callback when notes are updated */
  onNotesUpdated?: () => void
  /** Callback when task status changes */
  onTaskStatusChange?: (taskId: string, newStatus: TaskStatus) => void
  /** Callback for seeking audio to a specific time */
  onSeekAudio?: (timeInSeconds: number) => void
  /** Responsive props */
  isMobile?: boolean
  isTablet?: boolean
  /** Topics extracted from the meeting (for Overview tab) */
  topics?: ExtractedTopic[]
  /** Overall meeting sentiment (for Overview tab) */
  overallSentiment?: SentimentType
  /** Total meeting duration in milliseconds (for topic progress bars) */
  meetingDurationMs?: number
  /** Whether this meeting is currently being recorded */
  isRecording?: boolean
}

// ============================================================================
// Section Header Component
// ============================================================================

interface SectionHeaderProps {
  title: string
  icon: React.ReactNode
  count?: number
  isExpanded?: boolean
  onToggle?: () => void
  isCollapsible?: boolean
  actions?: React.ReactNode
}

function SectionHeader({
  title,
  icon,
  count,
  isExpanded = true,
  onToggle,
  isCollapsible = false,
  actions
}: SectionHeaderProps) {
  const headerContent = (
    <div className="flex items-center gap-token-sm">
      <span className="text-purple-600 dark:text-purple-400">{icon}</span>
      {/* Header margin bottom = token-md (12px) */}
      <h3 className="text-lg font-medium text-foreground my-token-sm">
        {title}
      </h3>
      {count !== undefined && count > 0 && (
        <span className="px-token-sm py-0.5 rounded-full text-xs font-semibold bg-muted text-muted-foreground">
          {count}
        </span>
      )}
    </div>
  )

  if (isCollapsible && onToggle) {
    return (
      <div className="flex items-center justify-between mb-token-sm">
        <button
          onClick={onToggle}
          className="flex items-center gap-token-sm hover:opacity-80 transition-opacity"
          aria-expanded={isExpanded}
          aria-label={`${title} section, ${count ?? 0} items`}
        >
          {headerContent}
          {isExpanded ? (
            <ChevronUp className="w-4 h-4 text-muted-foreground" />
          ) : (
            <ChevronDown className="w-4 h-4 text-muted-foreground" />
          )}
        </button>
        {actions && <div onClick={(e) => e.stopPropagation()}>{actions}</div>}
      </div>
    )
  }

  return (
    <div className="flex items-center justify-between mb-token-sm">
      {headerContent}
      {actions}
    </div>
  )
}

// ============================================================================
// Section Divider Component
// ============================================================================

function SectionDivider() {
  // Section divider with token-lg vertical spacing (max vertical gap = 16px)
  return <div className="border-t border-border/50 my-token-lg" />
}

// ============================================================================
// Notes Section Component
// ============================================================================

interface NotesSectionProps {
  notes: MeetingNote[]
  meetingId: string
  onNotesUpdated?: () => void
}

const NotesSection = memo(function NotesSection({ notes, meetingId: _meetingId, onNotesUpdated }: NotesSectionProps) {
  // meetingId is available for future use if needed (e.g., creating new notes)
  void _meetingId
  const [editingNote, setEditingNote] = useState<MeetingNote | null>(null)
  const [isEditorOpen, setIsEditorOpen] = useState(false)
  const [isExpanded, setIsExpanded] = useState(true) // Expanded by default per requirements

  // Get custom notes (user-created notes that are not AI-generated insights)
  const customNotes = useMemo(() =>
    notes.filter(n => n.note_type === 'custom' || (!n.is_ai_generated && n.note_type !== 'summary')),
    [notes]
  )

  const handleEditNote = (note: MeetingNote) => {
    setEditingNote(note)
    setIsEditorOpen(true)
  }

  const handleCloseEditor = () => {
    setIsEditorOpen(false)
    setEditingNote(null)
  }

  const handleSaveSuccess = () => {
    onNotesUpdated?.()
  }

  if (customNotes.length === 0) {
    return (
      <div className="p-token-lg" data-testid="notes-section">
        <SectionHeader
          title="Notes"
          icon={<FileText className="w-4 h-4" />}
          count={0}
        />
        <div className="text-sm text-muted-foreground py-token-lg text-center">
          No notes have been added to this meeting yet.
        </div>
      </div>
    )
  }

  return (
    <div className="p-token-lg" data-testid="notes-section">
      <NotesEditor
        isOpen={isEditorOpen}
        onClose={handleCloseEditor}
        note={editingNote}
        onSuccess={handleSaveSuccess}
        onDelete={handleSaveSuccess}
      />

      <SectionHeader
        title="Notes"
        icon={<FileText className="w-4 h-4" />}
        count={customNotes.length}
        isExpanded={isExpanded}
        onToggle={() => setIsExpanded(!isExpanded)}
        isCollapsible
      />

      {/* Compact list container matching KeyPoint design with 32-40px row height */}
      {isExpanded && (
        <CompactListContainer>
          {customNotes.map((note) => (
            <NoteRow
              key={note.id}
              note={note}
              onEdit={handleEditNote}
            />
          ))}
        </CompactListContainer>
      )}
    </div>
  )
})

// ============================================================================
// Summary Section Component
// ============================================================================

interface SummarySectionProps {
  notes: MeetingNote[]
  meetingId: string
  onNotesUpdated?: () => void
}

const SummarySection = memo(function SummarySection({ notes, meetingId, onNotesUpdated }: SummarySectionProps) {
  // Find summary notes
  const summaryNotes = useMemo(() =>
    notes.filter(n => n.note_type === 'summary'),
    [notes]
  )

  // Log mount and data
  useEffect(() => {
    debugLog('SummarySection MOUNTED', {
      meetingId,
      summaryNotesCount: summaryNotes.length,
    })
    return () => {
      debugLog('SummarySection UNMOUNTED', { meetingId })
    }
  }, [meetingId, summaryNotes.length])

  if (summaryNotes.length === 0) {
    debugWarn('SummarySection: No summary notes found', {
      meetingId,
      totalNotes: notes.length,
      noteTypes: [...new Set(notes.map(n => n.note_type))],
    })
    return null
  }

  debugLog('SummarySection: Rendering with summary notes', {
    meetingId,
    summaryNotesCount: summaryNotes.length,
    summaryNoteIds: summaryNotes.map(n => n.id),
  })

  return (
    <div
      className="p-token-lg"
      data-testid="summary-section-container"
      data-meeting-id={meetingId}
      data-summary-count={summaryNotes.length}
    >
      <SectionHeader
        title="Meeting Summary"
        icon={<Sparkles className="w-4 h-4" />}
        actions={
          <span className="inline-flex items-center gap-1 px-token-sm py-0.5 rounded-full text-xs font-medium bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300">
            <Sparkles className="w-3 h-3" />
            AI Generated
          </span>
        }
      />
      <MeetingSummaryErrorBoundary
        meetingId={meetingId}
        onRetry={onNotesUpdated}
      >
        <MeetingSummary
          notes={notes}
          meetingId={meetingId}
          onNotesUpdated={onNotesUpdated}
        />
      </MeetingSummaryErrorBoundary>
    </div>
  )
})

// ============================================================================
// Compact Action Item Row Component
// ============================================================================

interface CompactActionItemRowProps {
  task: Task
  onStatusChange?: (taskId: string, newStatus: TaskStatus) => void
}

function CompactActionItemRow({ task, onStatusChange }: CompactActionItemRowProps) {
  const isTaskOverdue = task.due_date && task.status !== 'completed' && isOverdue(task.due_date)
  const isCompleted = task.status === 'completed'

  const handleToggleComplete = () => {
    onStatusChange?.(task.id, isCompleted ? 'pending' : 'completed')
  }

  return (
    <div
      className={`flex items-center gap-token-md py-token-sm px-token-md rounded-md transition-colors ${
        isTaskOverdue ? 'bg-red-50/50 dark:bg-red-900/10' : 'hover:bg-muted/30'
      } ${isCompleted ? 'opacity-60' : ''}`}
      data-testid="action-item-row"
    >
      {/* Checkbox */}
      <button
        onClick={handleToggleComplete}
        className="flex-shrink-0 transition-colors hover:opacity-80"
        aria-label={isCompleted ? 'Mark as pending' : 'Mark as complete'}
      >
        {isCompleted ? (
          <CheckCircle className="w-4 h-4 text-green-600" />
        ) : (
          <Circle className="w-4 h-4 text-muted-foreground" />
        )}
      </button>

      {/* Title */}
      <span
        className={`flex-1 text-sm ${
          isCompleted ? 'line-through text-muted-foreground' : 'text-foreground'
        }`}
      >
        {task.title}
      </span>

      {/* Metadata - using token spacing */}
      <div className="flex items-center gap-token-sm text-xs text-muted-foreground flex-shrink-0">
        {task.assignee && (
          <span className="flex items-center gap-1 px-token-sm py-0.5 bg-muted rounded-full">
            <User className="w-3 h-3" />
            {task.assignee}
          </span>
        )}
        {task.due_date && (
          <span className={`flex items-center gap-1 ${isTaskOverdue ? 'text-red-600 font-medium' : ''}`}>
            <Clock className="w-3 h-3" />
            {formatDate(task.due_date)}
            {isTaskOverdue && <AlertTriangle className="w-3 h-3" />}
          </span>
        )}
        {task.priority === 'urgent' || task.priority === 'high' ? (
          <span className={`px-token-sm py-0.5 rounded-full text-xs font-medium ${
            task.priority === 'urgent'
              ? 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300'
              : 'bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-300'
          }`}>
            {task.priority === 'urgent' ? 'Urgent' : 'High'}
          </span>
        ) : null}
      </div>
    </div>
  )
}

// ============================================================================
// Action Items Section Component
// ============================================================================

interface ActionItemsSectionProps {
  tasks: Task[]
  onTaskStatusChange?: (taskId: string, newStatus: TaskStatus) => void
}

const ActionItemsSection = memo(function ActionItemsSection({ tasks, onTaskStatusChange }: ActionItemsSectionProps) {
  const [isExpanded, setIsExpanded] = useState(true)

  // Sort by priority then status
  const sortedTasks = useMemo(() => {
    const priorityOrder = { urgent: 0, high: 1, medium: 2, low: 3 }
    const statusOrder = { pending: 0, in_progress: 1, completed: 2, cancelled: 3 }

    return [...tasks].sort((a, b) => {
      // First by status (pending/in_progress first)
      const statusDiff = statusOrder[a.status] - statusOrder[b.status]
      if (statusDiff !== 0) return statusDiff
      // Then by priority
      return priorityOrder[a.priority] - priorityOrder[b.priority]
    })
  }, [tasks])

  if (tasks.length === 0) {
    return null
  }

  return (
    <div className="p-token-lg" data-testid="action-items-section">
      <SectionHeader
        title="Action Items"
        icon={<CheckSquare className="w-4 h-4" />}
        count={tasks.length}
        isExpanded={isExpanded}
        onToggle={() => setIsExpanded(!isExpanded)}
        isCollapsible
      />

      {isExpanded && (
        <div className="space-y-token-xs">
          {sortedTasks.map((task) => (
            <CompactActionItemRow
              key={task.id}
              task={task}
              onStatusChange={onTaskStatusChange}
            />
          ))}
        </div>
      )}
    </div>
  )
})

// ============================================================================
// Decision Item with Tooltip Component
// ============================================================================

interface DecisionItemProps {
  note: MeetingNote
}

function DecisionItem({ note }: DecisionItemProps) {
  const [showTooltip, setShowTooltip] = useState(false)

  return (
    <div
      className="relative py-token-sm px-token-md rounded-md hover:bg-muted/30 transition-colors group"
      onMouseEnter={() => setShowTooltip(true)}
      onMouseLeave={() => setShowTooltip(false)}
      data-testid="decision-item"
    >
      <div className="flex items-start gap-token-sm">
        <Gavel className="w-4 h-4 text-purple-600 dark:text-purple-400 mt-0.5 flex-shrink-0" />
        <div className="flex-1">
          <p className="text-sm text-foreground">{cleanNoteContent(note.content)}</p>
          <div className="flex items-center gap-token-sm mt-1 text-xs text-muted-foreground">
            {note.speaker_id && (
              <span className="flex items-center gap-1">
                <User className="w-3 h-3" />
                Speaker {note.speaker_id}
              </span>
            )}
            {note.start_time_ms !== null && (
              <span className="flex items-center gap-1">
                <Clock className="w-3 h-3" />
                {formatDurationMs(note.start_time_ms)}
              </span>
            )}
          </div>
        </div>

        {/* Context tooltip */}
        {note.context && showTooltip && (
          <div className="absolute left-0 right-0 top-full z-10 mt-1 p-token-sm bg-foreground text-background text-xs rounded-md shadow-medium max-w-md">
            <div className="flex items-start gap-1">
              <Info className="w-3 h-3 mt-0.5 flex-shrink-0" />
              <span>{note.context}</span>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

// ============================================================================
// Decisions Section Component
// ============================================================================

interface DecisionsSectionProps {
  notes: MeetingNote[]
}

const DecisionsSection = memo(function DecisionsSection({ notes }: DecisionsSectionProps) {
  const [isExpanded, setIsExpanded] = useState(true)

  const decisionNotes = useMemo(() =>
    notes.filter(n => n.note_type === 'decision'),
    [notes]
  )

  if (decisionNotes.length === 0) {
    return null
  }

  return (
    <div className="p-token-lg" data-testid="decisions-section">
      <SectionHeader
        title="Decisions"
        icon={<Gavel className="w-4 h-4" />}
        count={decisionNotes.length}
        isExpanded={isExpanded}
        onToggle={() => setIsExpanded(!isExpanded)}
        isCollapsible
      />

      {isExpanded && (
        <div className="space-y-token-xs">
          {decisionNotes.map((note) => (
            <DecisionItem key={note.id} note={note} />
          ))}
        </div>
      )}
    </div>
  )
})

// ============================================================================
// Topics Section Component
// (Key Points and Transcript sections removed - Key Points not in requirements,
//  Transcript has its own dedicated tab)
// ============================================================================

interface TopicsSectionProps {
  topics: ExtractedTopic[]
  meetingDurationMs?: number
}

const TopicsSection = memo(function TopicsSection({ topics, meetingDurationMs }: TopicsSectionProps) {
  const [isExpanded, setIsExpanded] = useState(true)

  if (topics.length === 0) {
    return null
  }

  return (
    <div className="p-token-lg" data-testid="topics-section">
      <SectionHeader
        title="Topics"
        icon={<Hash className="w-4 h-4" />}
        count={topics.length}
        isExpanded={isExpanded}
        onToggle={() => setIsExpanded(!isExpanded)}
        isCollapsible
      />

      {isExpanded && (
        // Compact list container matching Key Points styling
        <div className="border border-border rounded-lg overflow-hidden divide-y divide-border/50">
          {topics.map((topic, index) => (
            <div
              key={index}
              // Grid layout matching Key Points styling with 32-40px row height
              className="grid grid-cols-[auto_1fr_auto] items-start gap-2 px-3 py-1.5 min-h-[32px] border-b border-border/50 last:border-b-0 hover:bg-muted/30 transition-colors cursor-pointer group"
              data-testid="topic-item"
              role="button"
              tabIndex={0}
              aria-label={`Topic: ${topic.name}`}
            >
              {/* Topic bullet */}
              <div className="pt-1.5 flex-shrink-0">
                <span className="block w-1.5 h-1.5 rounded-full bg-purple-500" />
              </div>

              {/* Topic name with keywords count */}
              <div className="min-w-0 flex items-center gap-2 pt-0.5">
                <span className="text-sm font-medium text-foreground">{topic.name}</span>
                {topic.keyPoints && topic.keyPoints.length > 0 && (
                  <span className="text-xs text-muted-foreground">
                    ({topic.keyPoints.length} point{topic.keyPoints.length !== 1 ? 's' : ''})
                  </span>
                )}
              </div>

              {/* Duration metadata - compact */}
              <div className="flex items-center gap-2 flex-shrink-0 pt-0.5">
                <span className="inline-flex items-center gap-1 text-[10px] text-muted-foreground">
                  <Clock className="w-3 h-3" />
                  {formatDurationMs(topic.durationMs)}
                  {meetingDurationMs && meetingDurationMs > 0 && (
                    <span className="ml-1">
                      ({Math.round((topic.durationMs / meetingDurationMs) * 100)}%)
                    </span>
                  )}
                </span>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
})

// ============================================================================
// Overall Sentiment Section Component
// ============================================================================

interface OverallSentimentSectionProps {
  sentiment?: SentimentType
}

const sentimentConfig: Record<SentimentType, {
  label: string
  icon: typeof ThumbsUp
  bgColor: string
  textColor: string
  borderColor: string
}> = {
  positive: {
    label: 'Positive',
    icon: ThumbsUp,
    bgColor: 'bg-green-100 dark:bg-green-900/30',
    textColor: 'text-green-700 dark:text-green-400',
    borderColor: 'border-green-300 dark:border-green-700',
  },
  negative: {
    label: 'Negative',
    icon: ThumbsDown,
    bgColor: 'bg-red-100 dark:bg-red-900/30',
    textColor: 'text-red-700 dark:text-red-400',
    borderColor: 'border-red-300 dark:border-red-700',
  },
  neutral: {
    label: 'Neutral',
    icon: Minus,
    bgColor: 'bg-gray-100 dark:bg-gray-800',
    textColor: 'text-gray-700 dark:text-gray-400',
    borderColor: 'border-gray-300 dark:border-gray-700',
  },
  mixed: {
    label: 'Mixed',
    icon: HelpCircle,
    bgColor: 'bg-yellow-100 dark:bg-yellow-900/30',
    textColor: 'text-yellow-700 dark:text-yellow-400',
    borderColor: 'border-yellow-300 dark:border-yellow-700',
  },
}

const OverallSentimentSection = memo(function OverallSentimentSection({ sentiment }: OverallSentimentSectionProps) {
  if (!sentiment) {
    return null
  }

  const config = sentimentConfig[sentiment]
  const Icon = config.icon

  return (
    <div className="p-token-lg" data-testid="overall-sentiment-section">
      <div className="flex items-center justify-between mb-token-sm">
        <h3 className="text-sm font-medium text-muted-foreground">Overall Sentiment</h3>
      </div>
      <div className={`inline-flex items-center gap-2 px-4 py-2 rounded-full border ${config.bgColor} ${config.textColor} ${config.borderColor}`}>
        <Icon className="w-4 h-4" />
        <span className="text-sm font-medium">{config.label}</span>
      </div>
    </div>
  )
})

// ============================================================================
// Main Content Area Component
// ============================================================================

export function MainContentArea({
  meetingId,
  notes,
  tasks,
  transcripts: _transcripts,
  speakers: _speakers,
  speakerNameOverrides: _speakerNameOverrides,
  currentAudioTime: _currentAudioTime,
  onNotesUpdated,
  onTaskStatusChange,
  onSeekAudio: _onSeekAudio,
  topics = [],
  overallSentiment,
  meetingDurationMs,
  isRecording = false
}: MainContentAreaProps) {
  // Props preserved for API compatibility but not used in Overview tab
  // Transcript is shown in its own dedicated Transcript tab
  void _transcripts
  void _speakers
  void _speakerNameOverrides
  void _currentAudioTime
  void _onSeekAudio

  // ============================================================================
  // Overview Tab Debug Logging
  // ============================================================================

  // Log component mount
  useEffect(() => {
    debugLog('Overview tab rendered', { meetingId })

    // Log detailed section analysis
    const summaryNotes = notes.filter(n => n.note_type === 'summary')
    const meetingSummaryExists = summaryNotes.length > 0
    const meetingSummaryIndex = meetingSummaryExists ? 0 : -1 // Summary is always first if it exists

    console.group('%c[Overview Tab Debug] Section Analysis', 'color: #06b6d4; font-weight: bold')
    console.log('Meeting Summary section:', meetingSummaryExists ? 'exists' : 'missing')
    console.log('Meeting Summary position:', meetingSummaryIndex >= 0 ? `index ${meetingSummaryIndex}` : 'N/A')
    console.log('Meeting Summary content length:', summaryNotes.length > 0
      ? `${summaryNotes[0].content.split(/\s+/).length} words`
      : '0 words')
    console.groupEnd()

    return () => {
      debugLog('Overview tab unmounted', { meetingId })
    }
  }, [meetingId, notes])

  // Track notes data changes
  useEffect(() => {
    const summaryNotes = notes.filter(n => n.note_type === 'summary')
    const aiGeneratedSummary = summaryNotes.filter(n => n.is_ai_generated)

    debugLog('Notes data passed to Overview component', {
      meetingId,
      totalNotes: notes.length,
      summaryNotes: summaryNotes.length,
      aiGeneratedSummaryNotes: aiGeneratedSummary.length,
      noteTypesPresent: [...new Set(notes.map(n => n.note_type))],
    })

    // Check for missing summary after data arrives
    if (notes.length > 0 && summaryNotes.length === 0) {
      debugWarn('Missing Summary Detection: Summary not found after notes loaded', {
        meetingId,
        totalNotes: notes.length,
        noteTypes: [...new Set(notes.map(n => n.note_type))],
        aiGeneratedCount: notes.filter(n => n.is_ai_generated).length,
      })
    }
  }, [notes, meetingId])

  // Check what sections have content - STRICT ORDER per requirements
  // 1. Meeting Summary (MUST BE FIRST)
  // 2. Notes (AFTER Meeting Summary)
  // 3. Action Items
  // 4. Decisions
  // 5. Topics
  // 6. Overall Sentiment (at bottom)
  const hasSummary = notes.some(n => n.note_type === 'summary')
  const hasNotes = notes.some(n => n.note_type === 'custom' || (!n.is_ai_generated && n.note_type !== 'summary'))
  const hasActionItems = tasks.length > 0
  const hasDecisions = notes.some(n => n.note_type === 'decision')
  const hasTopics = topics.length > 0
  const hasSentiment = overallSentiment !== undefined

  // Check if there's any content at all
  const hasAnyContent = hasSummary || hasNotes || hasActionItems || hasDecisions || hasTopics || hasSentiment

  // Log section presence for debugging
  useEffect(() => {
    debugLog('Section presence check', {
      meetingId,
      hasSummary,
      hasNotes,
      hasActionItems,
      hasDecisions,
      hasTopics,
      hasSentiment,
      hasAnyContent,
      sectionOrder: [
        hasSummary ? '1. Meeting Summary' : null,
        hasNotes ? '2. Notes' : null,
        hasActionItems ? '3. Action Items' : null,
        hasDecisions ? '4. Decisions' : null,
        hasTopics ? '5. Topics' : null,
        hasSentiment ? '6. Overall Sentiment' : null,
      ].filter(Boolean),
    })
  }, [meetingId, hasSummary, hasNotes, hasActionItems, hasDecisions, hasTopics, hasSentiment, hasAnyContent])

  if (!hasAnyContent) {
    return (
      <div
        className="bg-card rounded-md p-token-lg shadow-subtle"
        data-testid="main-content-area"
      >
        <div className="flex flex-col items-center justify-center py-token-2xl text-center">
          <FileText className="w-12 h-12 text-muted-foreground mb-token-lg" />
          <h3 className="text-lg font-semibold text-foreground mb-token-sm">No content yet</h3>
          <p className="text-sm text-muted-foreground max-w-md">
            Record a meeting to generate transcripts, or add notes manually.
            AI-generated insights will appear here after processing.
          </p>
        </div>
      </div>
    )
  }

  // Get summary note timestamp for status indicator
  const summaryNote = useMemo(() => {
    return notes.find(n => n.note_type === 'summary' && n.is_ai_generated)
  }, [notes])

  // Handle generate summary callback
  const handleGenerateSummary = useCallback(async () => {
    const api = window.electronAPI as any
    await api?.meetingSummary?.generateSummary?.(meetingId)
  }, [meetingId])

  return (
    <div
      className="bg-card rounded-md p-token-lg shadow-subtle"
      data-testid="main-content-area"
    >
      {/* STRICT SECTION ORDER - DO NOT REORDER
          IMPLEMENTATION CHECK: Meeting Summary MUST render BEFORE Notes
          0. Summary Status Indicator (shows generation status at top)
          1. Meeting Summary (MUST BE FIRST SECTION, expanded by default, 250-400 words, editable)
          2. Notes (user-added notes, compact list design, expandable, AFTER Meeting Summary)
          3. Action Items (compact list with checkboxes, assignee, due date, 40-48px row height)
          4. Decisions (compact list with context tooltips, timestamps, 40-48px row height)
          5. Topics (bulleted list with topic name, keywords, duration, 32-40px row height)
          6. Overall Sentiment (badge at bottom with color coding and explanation)
      */}

      {/* 0. SUMMARY STATUS INDICATOR - Shows generation state at the top */}
      <SummaryStatusIndicator
        meetingId={meetingId}
        isRecording={isRecording}
        hasSummary={hasSummary}
        summaryGeneratedAt={summaryNote?.generation_timestamp || summaryNote?.created_at}
        onGenerateSummary={handleGenerateSummary}
        onRefetch={onNotesUpdated}
      />

      {/* 1. MEETING SUMMARY - MUST BE FIRST SECTION */}
      {hasSummary && (
        <>
          <SummarySection
            notes={notes}
            meetingId={meetingId}
            onNotesUpdated={onNotesUpdated}
          />
          {(hasNotes || hasActionItems || hasDecisions || hasTopics || hasSentiment) && <SectionDivider />}
        </>
      )}

      {/* 2. NOTES - Must appear AFTER Meeting Summary */}
      {hasNotes && (
        <>
          <NotesSection
            notes={notes}
            meetingId={meetingId}
            onNotesUpdated={onNotesUpdated}
          />
          {(hasActionItems || hasDecisions || hasTopics || hasSentiment) && <SectionDivider />}
        </>
      )}

      {/* 3. ACTION ITEMS */}
      {hasActionItems && (
        <>
          <ActionItemsSection
            tasks={tasks}
            onTaskStatusChange={onTaskStatusChange}
          />
          {(hasDecisions || hasTopics || hasSentiment) && <SectionDivider />}
        </>
      )}

      {/* 4. DECISIONS */}
      {hasDecisions && (
        <>
          <DecisionsSection notes={notes} />
          {(hasTopics || hasSentiment) && <SectionDivider />}
        </>
      )}

      {/* 5. TOPICS */}
      {hasTopics && (
        <>
          <TopicsSection
            topics={topics}
            meetingDurationMs={meetingDurationMs}
          />
          {hasSentiment && <SectionDivider />}
        </>
      )}

      {/* 6. OVERALL SENTIMENT - at the bottom */}
      {hasSentiment && (
        <OverallSentimentSection sentiment={overallSentiment} />
      )}
    </div>
  )
}

export default MainContentArea
