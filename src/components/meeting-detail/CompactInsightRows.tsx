/**
 * Compact List UI Components for Insights Sections
 *
 * Components:
 * - ActionItemRow: Compact row with checkbox, task text (truncatable), assignee badge, due date, priority indicator
 * - DecisionRow: Compact row with decision text, context icon (tooltip), timestamp, speaker badges
 * - KeyPointRow: Compact bulleted list item with text, timestamp, speaker badge
 * - GroupHeader: Section header for filtering groups (e.g., 'High Priority' action items)
 *
 * Design specifications:
 * - ActionItemRow/DecisionRow height: 40-48px
 * - KeyPointRow height: 32-40px
 * - Hover state: subtle background change
 * - Borders: subtle borders between rows (not cards)
 * - Icons: 16px size
 * - Badges: compact (max-height 24px)
 * - Text truncation with '...' and expand on click
 * - Grid layout for alignment consistency
 * - No card wrappers around individual items
 */

import { useState, memo } from 'react'
import {
  CheckCircle,
  Circle,
  User,
  Clock,
  Calendar,
  Info,
  ChevronDown,
  ChevronRight,
  Lightbulb,
  MessageSquare,
  Filter,
  Edit2,
  FileText,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import type { Task, TaskPriority, TaskStatus, MeetingNote } from '@/types/database'
import type { ExtractedDecision, SentimentType } from '@/types/electron-api'
import { formatDurationMs, isOverdue, cleanNoteContent } from '@/lib/formatters'

// ============================================================================
// Types
// ============================================================================

export interface ActionItemRowProps {
  task: Task
  isSelected?: boolean
  onToggleSelect?: (id: string) => void
  onStatusChange?: (id: string, newStatus: TaskStatus) => void
  className?: string
}

export interface DecisionRowProps {
  decision: ExtractedDecision | MeetingNote
  isExtracted?: boolean
  className?: string
}

export interface KeyPointRowProps {
  note: MeetingNote
  className?: string
}

export interface NoteRowProps {
  note: MeetingNote
  onEdit?: (note: MeetingNote) => void
  className?: string
}

export interface GroupHeaderProps {
  title: string
  count: number
  icon?: React.ReactNode
  color?: string
  isExpanded?: boolean
  onToggle?: () => void
  className?: string
}

// ============================================================================
// Configuration
// ============================================================================

const priorityConfig: Record<TaskPriority, { label: string; color: string; bgColor: string; borderColor: string; dotColor: string }> = {
  urgent: { label: 'Urgent', color: 'text-red-700 dark:text-red-400', bgColor: 'bg-red-50 dark:bg-red-900/20', borderColor: 'border-red-200 dark:border-red-800', dotColor: 'bg-red-500' },
  high: { label: 'High', color: 'text-orange-700 dark:text-orange-400', bgColor: 'bg-orange-50 dark:bg-orange-900/20', borderColor: 'border-orange-200 dark:border-orange-800', dotColor: 'bg-orange-500' },
  medium: { label: 'Medium', color: 'text-yellow-700 dark:text-yellow-400', bgColor: 'bg-yellow-50 dark:bg-yellow-900/20', borderColor: 'border-yellow-200 dark:border-yellow-800', dotColor: 'bg-yellow-500' },
  low: { label: 'Low', color: 'text-gray-600 dark:text-gray-400', bgColor: 'bg-gray-50 dark:bg-gray-800/50', borderColor: 'border-gray-200 dark:border-gray-700', dotColor: 'bg-gray-400' },
}

const sentimentConfig: Record<SentimentType, { color: string; bgColor: string }> = {
  positive: { color: 'text-green-600 dark:text-green-400', bgColor: 'bg-green-50 dark:bg-green-900/20' },
  negative: { color: 'text-red-600 dark:text-red-400', bgColor: 'bg-red-50 dark:bg-red-900/20' },
  neutral: { color: 'text-gray-600 dark:text-gray-400', bgColor: 'bg-gray-50 dark:bg-gray-800/50' },
  mixed: { color: 'text-yellow-600 dark:text-yellow-400', bgColor: 'bg-yellow-50 dark:bg-yellow-900/20' },
}

// ============================================================================
// ActionItemRow Component
// ============================================================================

/**
 * Compact action item row with checkbox, truncatable text, assignee badge, due date, and priority indicator
 * Row height: 40-48px
 */
export const ActionItemRow = memo(function ActionItemRow({
  task,
  isSelected = false,
  onToggleSelect,
  onStatusChange,
  className,
}: ActionItemRowProps) {
  const [isExpanded, setIsExpanded] = useState(false)
  const isCompleted = task.status === 'completed'
  const isTaskOverdue = task.due_date && task.status !== 'completed' && isOverdue(task.due_date)
  const priorityStyle = priorityConfig[task.priority]

  // Check if text needs truncation (arbitrary threshold)
  const needsTruncation = task.title.length > 80

  return (
    <div
      className={cn(
        // Grid layout for alignment consistency
        'grid grid-cols-[auto_auto_1fr_auto] items-center gap-2 px-3 py-2',
        // Row height: 40-48px
        'min-h-[40px]',
        // Subtle border between rows
        'border-b border-border/50 last:border-b-0',
        // Hover state with subtle background change
        'hover:bg-muted/30 transition-colors',
        // Overdue styling
        isTaskOverdue && 'bg-red-50/50 dark:bg-red-950/20',
        // Completed styling
        isCompleted && 'opacity-60',
        className
      )}
      data-testid="action-item-row"
    >
      {/* Selection checkbox */}
      {onToggleSelect && (
        <input
          type="checkbox"
          checked={isSelected}
          onChange={() => onToggleSelect(task.id)}
          className="w-4 h-4 rounded border-gray-300 text-purple-600 focus:ring-purple-500 focus:ring-offset-0"
          aria-label={`Select task: ${task.title}`}
        />
      )}

      {/* Status checkbox */}
      <button
        onClick={() => onStatusChange?.(task.id, isCompleted ? 'pending' : 'completed')}
        className={cn(
          'flex-shrink-0',
          onStatusChange ? 'cursor-pointer hover:opacity-80' : 'cursor-default'
        )}
        aria-label={isCompleted ? 'Mark as pending' : 'Mark as complete'}
        disabled={!onStatusChange}
      >
        {isCompleted ? (
          <CheckCircle className="w-4 h-4 text-green-600 dark:text-green-400" />
        ) : (
          <Circle className="w-4 h-4 text-muted-foreground" />
        )}
      </button>

      {/* Task text with truncation */}
      <div className="min-w-0 flex items-center gap-2">
        <span
          className={cn(
            'text-sm',
            isCompleted ? 'line-through text-muted-foreground' : 'text-foreground',
            !isExpanded && needsTruncation && 'truncate'
          )}
          title={task.title}
        >
          {task.title}
        </span>
        {needsTruncation && (
          <button
            onClick={() => setIsExpanded(!isExpanded)}
            className="flex-shrink-0 text-xs text-purple-600 dark:text-purple-400 hover:underline"
            aria-label={isExpanded ? 'Collapse' : 'Expand'}
          >
            {isExpanded ? 'less' : 'more'}
          </button>
        )}
      </div>

      {/* Metadata badges row */}
      <div className="flex items-center gap-2 flex-shrink-0">
        {/* Priority indicator - compact dot */}
        <span
          className={cn('w-2 h-2 rounded-full flex-shrink-0', priorityStyle.dotColor)}
          title={priorityStyle.label}
        />

        {/* Assignee badge - compact */}
        {task.assignee && (
          <span className="inline-flex items-center gap-1 px-1.5 py-0.5 text-[10px] font-medium bg-purple-50 dark:bg-purple-900/20 text-purple-700 dark:text-purple-400 rounded max-h-[24px]">
            <User className="w-3 h-3" />
            <span className="max-w-[60px] truncate">{task.assignee}</span>
          </span>
        )}

        {/* Due date - compact */}
        {task.due_date && (
          <span
            className={cn(
              'inline-flex items-center gap-1 px-1.5 py-0.5 text-[10px] font-medium rounded max-h-[24px]',
              isTaskOverdue
                ? 'bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-400'
                : 'bg-gray-50 dark:bg-gray-800/50 text-muted-foreground'
            )}
          >
            <Calendar className="w-3 h-3" />
            {new Date(task.due_date).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
          </span>
        )}
      </div>
    </div>
  )
})

// ============================================================================
// DecisionRow Component
// ============================================================================

/**
 * Compact decision row with decision text, context icon (tooltip on hover), timestamp, speaker badges
 * Row height: 40-48px
 */
export const DecisionRow = memo(function DecisionRow({
  decision,
  isExtracted = false,
  className,
}: DecisionRowProps) {
  const [isExpanded, setIsExpanded] = useState(false)
  const [showTooltip, setShowTooltip] = useState(false)

  // Handle both ExtractedDecision and MeetingNote types
  const content = isExtracted
    ? (decision as ExtractedDecision).content
    : (decision as MeetingNote).content

  const context = isExtracted
    ? (decision as ExtractedDecision).context
    : (decision as MeetingNote).context

  const speaker = isExtracted
    ? (decision as ExtractedDecision).speaker
    : (decision as MeetingNote).speaker_id

  const timestamp = isExtracted
    ? (decision as ExtractedDecision).startTimeMs
    : (decision as MeetingNote).start_time_ms

  const sentiment = isExtracted
    ? (decision as ExtractedDecision).sentiment
    : undefined

  const needsTruncation = content.length > 100

  return (
    <div
      className={cn(
        // Grid layout for alignment consistency
        'grid grid-cols-[auto_1fr_auto] items-center gap-3 px-3 py-2',
        // Row height: 40-48px
        'min-h-[40px]',
        // Subtle border between rows
        'border-b border-border/50 last:border-b-0',
        // Hover state with subtle background change
        'hover:bg-muted/30 transition-colors',
        // Sentiment-based subtle background
        sentiment && sentimentConfig[sentiment].bgColor,
        className
      )}
      data-testid="decision-row"
    >
      {/* Context icon with tooltip */}
      <div className="relative flex-shrink-0">
        {context ? (
          <button
            className="p-1 rounded hover:bg-muted/50 transition-colors"
            onMouseEnter={() => setShowTooltip(true)}
            onMouseLeave={() => setShowTooltip(false)}
            aria-label="View context"
          >
            <Info className="w-4 h-4 text-purple-600 dark:text-purple-400" />
          </button>
        ) : (
          <MessageSquare className="w-4 h-4 text-muted-foreground" />
        )}

        {/* Tooltip */}
        {showTooltip && context && (
          <div className="absolute left-0 top-full mt-1 z-50 px-3 py-2 max-w-[300px] text-xs bg-foreground text-background rounded-lg shadow-lg whitespace-normal">
            {context}
          </div>
        )}
      </div>

      {/* Decision text with truncation */}
      <div className="min-w-0 flex items-center gap-2">
        <span
          className={cn(
            'text-sm text-foreground',
            !isExpanded && needsTruncation && 'truncate'
          )}
          title={content}
        >
          {content}
        </span>
        {needsTruncation && (
          <button
            onClick={() => setIsExpanded(!isExpanded)}
            className="flex-shrink-0 text-xs text-purple-600 dark:text-purple-400 hover:underline"
            aria-label={isExpanded ? 'Collapse' : 'Expand'}
          >
            {isExpanded ? 'less' : 'more'}
          </button>
        )}
      </div>

      {/* Metadata badges */}
      <div className="flex items-center gap-2 flex-shrink-0">
        {/* Speaker badge - compact */}
        {speaker && (
          <span className="inline-flex items-center gap-1 px-1.5 py-0.5 text-[10px] font-medium bg-gray-50 dark:bg-gray-800/50 text-muted-foreground rounded max-h-[24px]">
            <User className="w-3 h-3" />
            <span className="max-w-[60px] truncate">{speaker}</span>
          </span>
        )}

        {/* Timestamp - compact */}
        {timestamp !== undefined && timestamp !== null && (
          <span className="inline-flex items-center gap-1 text-[10px] text-muted-foreground">
            <Clock className="w-3 h-3" />
            {formatDurationMs(timestamp)}
          </span>
        )}
      </div>
    </div>
  )
})

// ============================================================================
// KeyPointRow Component
// ============================================================================

/**
 * Compact bulleted list item with text, timestamp, speaker badge (if attributed)
 * Row height: 32-40px
 */
export const KeyPointRow = memo(function KeyPointRow({
  note,
  className,
}: KeyPointRowProps) {
  const [isExpanded, setIsExpanded] = useState(false)
  // Clean the note content to remove legacy formatting
  const displayContent = cleanNoteContent(note.content)
  const needsTruncation = displayContent.length > 120

  // Check if a key point is "critical" based on keywords or confidence
  const isCritical = (() => {
    const criticalKeywords = ['critical', 'urgent', 'important', 'essential', 'key', 'major']
    const content = displayContent.toLowerCase()
    return criticalKeywords.some(k => content.includes(k)) || (note.confidence_score ?? 0) > 0.9
  })()

  return (
    <div
      className={cn(
        // Grid layout for alignment consistency
        'grid grid-cols-[auto_1fr_auto] items-start gap-2 px-3 py-1.5',
        // Row height: 32-40px
        'min-h-[32px]',
        // Subtle border between rows
        'border-b border-border/50 last:border-b-0',
        // Hover state with subtle background change
        'hover:bg-muted/30 transition-colors',
        // Critical item styling
        isCritical && 'bg-yellow-50/50 dark:bg-yellow-950/20',
        className
      )}
      data-testid="key-point-row"
    >
      {/* Bullet point */}
      <div className="pt-1.5 flex-shrink-0">
        {isCritical ? (
          <Lightbulb className="w-4 h-4 text-yellow-500 fill-yellow-500" />
        ) : (
          <span className="block w-1.5 h-1.5 rounded-full bg-amber-500 mt-0.5" />
        )}
      </div>

      {/* Key point text with truncation */}
      <div className="min-w-0 flex items-center gap-2">
        <span
          className={cn(
            'text-sm',
            isCritical ? 'font-medium text-foreground' : 'text-foreground',
            !isExpanded && needsTruncation && 'truncate'
          )}
          title={displayContent}
        >
          {displayContent}
        </span>
        {needsTruncation && (
          <button
            onClick={() => setIsExpanded(!isExpanded)}
            className="flex-shrink-0 text-xs text-purple-600 dark:text-purple-400 hover:underline"
            aria-label={isExpanded ? 'Collapse' : 'Expand'}
          >
            {isExpanded ? 'less' : 'more'}
          </button>
        )}
      </div>

      {/* Metadata badges */}
      <div className="flex items-center gap-2 flex-shrink-0 pt-0.5">
        {/* Speaker badge - compact */}
        {note.speaker_id && (
          <span className="inline-flex items-center gap-1 px-1.5 py-0.5 text-[10px] font-medium bg-purple-50 dark:bg-purple-900/20 text-purple-700 dark:text-purple-400 rounded max-h-[24px]">
            <User className="w-3 h-3" />
            <span className="max-w-[50px] truncate">{note.speaker_id}</span>
          </span>
        )}

        {/* Timestamp - compact */}
        {note.start_time_ms !== null && (
          <span className="inline-flex items-center gap-1 text-[10px] text-muted-foreground">
            <Clock className="w-3 h-3" />
            {formatDurationMs(note.start_time_ms)}
          </span>
        )}

        {/* Critical badge */}
        {isCritical && (
          <span className="px-1.5 py-0.5 text-[10px] font-medium bg-yellow-100 dark:bg-yellow-900/30 text-yellow-800 dark:text-yellow-400 rounded max-h-[24px]">
            Critical
          </span>
        )}
      </div>
    </div>
  )
})

// ============================================================================
// NoteRow Component
// ============================================================================

/**
 * Compact note row with text, timestamp, and edit button
 * Follows the same design pattern as KeyPointRow
 * Row height: 32-40px
 */
export const NoteRow = memo(function NoteRow({
  note,
  onEdit,
  className,
}: NoteRowProps) {
  const [isExpanded, setIsExpanded] = useState(false)
  // Clean the note content to remove legacy formatting
  const displayContent = cleanNoteContent(note.content)
  const needsTruncation = displayContent.length > 120

  return (
    <div
      className={cn(
        // Grid layout for alignment consistency
        'grid grid-cols-[auto_1fr_auto] items-start gap-2 px-3 py-1.5',
        // Row height: 32-40px
        'min-h-[32px]',
        // Subtle border between rows
        'border-b border-border/50 last:border-b-0',
        // Hover state with subtle background change
        'hover:bg-muted/30 transition-colors',
        'group',
        className
      )}
      data-testid="note-row"
    >
      {/* Icon */}
      <div className="pt-1.5 flex-shrink-0">
        <FileText className="w-4 h-4 text-muted-foreground" />
      </div>

      {/* Note text with truncation */}
      <div className="min-w-0 flex items-center gap-2 pt-0.5">
        <span
          className={cn(
            'text-sm text-foreground',
            !isExpanded && needsTruncation && 'truncate'
          )}
          title={displayContent}
        >
          {displayContent}
        </span>
        {needsTruncation && (
          <button
            onClick={() => setIsExpanded(!isExpanded)}
            className="flex-shrink-0 text-xs text-purple-600 dark:text-purple-400 hover:underline"
            aria-label={isExpanded ? 'Collapse' : 'Expand'}
          >
            {isExpanded ? 'less' : 'more'}
          </button>
        )}
      </div>

      {/* Metadata and actions */}
      <div className="flex items-center gap-2 flex-shrink-0 pt-0.5">
        {/* Timestamp - compact */}
        {note.start_time_ms !== null && (
          <span className="inline-flex items-center gap-1 text-[10px] text-muted-foreground">
            <Clock className="w-3 h-3" />
            {formatDurationMs(note.start_time_ms)}
          </span>
        )}

        {/* Edit button - visible on hover */}
        {onEdit && (
          <button
            onClick={() => onEdit(note)}
            className="opacity-0 group-hover:opacity-100 p-1 text-muted-foreground hover:text-foreground transition-all rounded hover:bg-muted/50"
            aria-label="Edit note"
          >
            <Edit2 className="w-3 h-3" />
          </button>
        )}
      </div>
    </div>
  )
})

// ============================================================================
// GroupHeader Component
// ============================================================================

/**
 * Section header for filtering groups (e.g., 'High Priority' action items)
 * Collapsible with count badge
 */
export const GroupHeader = memo(function GroupHeader({
  title,
  count,
  icon,
  color = 'text-muted-foreground',
  isExpanded = true,
  onToggle,
  className,
}: GroupHeaderProps) {
  return (
    <button
      onClick={onToggle}
      className={cn(
        'w-full flex items-center justify-between gap-2 px-3 py-2',
        'bg-muted/40 hover:bg-muted/60 transition-colors',
        'border-b border-border',
        'text-left',
        className
      )}
      aria-expanded={isExpanded}
      data-testid="group-header"
    >
      <div className="flex items-center gap-2">
        {/* Icon */}
        {icon ? (
          <span className={color}>{icon}</span>
        ) : (
          <Filter className={cn('w-4 h-4', color)} />
        )}

        {/* Title */}
        <span className={cn('text-sm font-medium', color)}>
          {title}
        </span>

        {/* Count badge */}
        <span className="px-1.5 py-0.5 text-[10px] font-semibold bg-muted text-muted-foreground rounded-full">
          {count}
        </span>
      </div>

      {/* Expand/collapse chevron */}
      {onToggle && (
        isExpanded ? (
          <ChevronDown className="w-4 h-4 text-muted-foreground" />
        ) : (
          <ChevronRight className="w-4 h-4 text-muted-foreground" />
        )
      )}
    </button>
  )
})

// ============================================================================
// Compact List Container Component
// ============================================================================

export interface CompactListContainerProps {
  children: React.ReactNode
  className?: string
}

/**
 * Container for compact list items with proper styling
 */
export const CompactListContainer = memo(function CompactListContainer({
  children,
  className,
}: CompactListContainerProps) {
  return (
    <div
      className={cn(
        'border border-border rounded-lg overflow-hidden',
        'divide-y divide-border/50',
        className
      )}
      role="list"
    >
      {children}
    </div>
  )
})

// ============================================================================
// Exports
// ============================================================================

export default {
  ActionItemRow,
  DecisionRow,
  KeyPointRow,
  NoteRow,
  GroupHeader,
  CompactListContainer,
}
