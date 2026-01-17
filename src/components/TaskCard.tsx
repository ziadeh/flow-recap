/**
 * TaskCard Component
 *
 * A reusable task card component that displays task information including:
 * - Title
 * - Assignee
 * - Priority badge with visual indicators
 * - Due date
 * - Tags
 *
 * Supports click-to-open functionality for task modals.
 */

import { useState } from 'react'
import {
  User,
  Calendar,
  AlertTriangle,
  CheckCircle,
  Clock,
  Tag,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import type { Task, TaskPriority, TaskStatus } from '@/types/database'
import { formatDate, isOverdue } from '@/lib/formatters'
import { Modal } from '@/components/Modal'
import { TaskModal } from '@/components/TaskModal'

export interface TaskCardProps {
  /** The task to display */
  task: Task
  /** Optional callback when the card is clicked */
  onTaskClick?: (task: Task) => void
  /** Optional callback when task status changes */
  onTaskStatusChange?: (taskId: string, newStatus: TaskStatus) => void
  /** Optional callback when task is updated */
  onTaskUpdate?: (updatedTask: Task) => void
  /** Optional callback when task is deleted */
  onTaskDelete?: (taskId: string) => void
  /** Whether to show the modal when clicked (default: true) */
  showModalOnClick?: boolean
  /** Whether to use the new editable TaskModal (default: false for backwards compatibility) */
  useEditableModal?: boolean
  /** Whether to use compact mode (default: false) */
  compact?: boolean
  /** Optional tags to display */
  tags?: string[]
  /** Optional callback when tags change */
  onTagsChange?: (taskId: string, tags: string[]) => void
  /** Additional CSS classes */
  className?: string
}

// Priority configuration with visual indicators
const priorityConfig: Record<TaskPriority, {
  label: string
  bgClass: string
  textClass: string
  borderClass: string
  icon?: typeof AlertTriangle
}> = {
  urgent: {
    label: 'Urgent',
    bgClass: 'bg-red-100',
    textClass: 'text-red-700',
    borderClass: 'border-red-200',
    icon: AlertTriangle,
  },
  high: {
    label: 'High',
    bgClass: 'bg-orange-100',
    textClass: 'text-orange-700',
    borderClass: 'border-orange-200',
  },
  medium: {
    label: 'Medium',
    bgClass: 'bg-yellow-100',
    textClass: 'text-yellow-700',
    borderClass: 'border-yellow-200',
  },
  low: {
    label: 'Low',
    bgClass: 'bg-gray-100',
    textClass: 'text-gray-700',
    borderClass: 'border-gray-200',
  },
}

// Status configuration for display
const statusConfig: Record<TaskStatus, {
  label: string
  bgClass: string
  textClass: string
  borderClass: string
}> = {
  pending: {
    label: 'Pending',
    bgClass: 'bg-blue-100',
    textClass: 'text-blue-700',
    borderClass: 'border-blue-200',
  },
  in_progress: {
    label: 'In Progress',
    bgClass: 'bg-purple-100',
    textClass: 'text-purple-700',
    borderClass: 'border-purple-200',
  },
  completed: {
    label: 'Completed',
    bgClass: 'bg-green-100',
    textClass: 'text-green-700',
    borderClass: 'border-green-200',
  },
  cancelled: {
    label: 'Cancelled',
    bgClass: 'bg-gray-100',
    textClass: 'text-gray-500',
    borderClass: 'border-gray-200',
  },
}

/**
 * Priority Badge Component
 * Displays a colored badge indicating the task's priority level
 */
function PriorityBadge({ priority }: { priority: TaskPriority }) {
  const config = priorityConfig[priority]
  const Icon = config.icon

  return (
    <span
      data-testid={`priority-badge-${priority}`}
      className={cn(
        'inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium border',
        config.bgClass,
        config.textClass,
        config.borderClass
      )}
    >
      {Icon && <Icon className="w-3 h-3 mr-1" />}
      {config.label}
    </span>
  )
}

/**
 * Status Badge Component
 * Displays a colored badge indicating the task's current status
 */
function StatusBadge({ status }: { status: TaskStatus }) {
  const config = statusConfig[status]

  return (
    <span
      data-testid={`status-badge-${status}`}
      className={cn(
        'inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium border',
        config.bgClass,
        config.textClass,
        config.borderClass
      )}
    >
      {config.label}
    </span>
  )
}

/**
 * Tag Badge Component
 * Displays a small tag badge
 */
function TagBadge({ tag }: { tag: string }) {
  return (
    <span
      data-testid={`tag-${tag}`}
      className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-muted text-muted-foreground border border-border"
    >
      <Tag className="w-2.5 h-2.5 mr-1" />
      {tag}
    </span>
  )
}

/**
 * Assignee Avatar Component
 * Displays the assignee's initials in a colored circle
 */
function AssigneeAvatar({ name, size = 'md' }: { name: string; size?: 'sm' | 'md' }) {
  const initials = name
    .split(' ')
    .map((n) => n[0])
    .join('')
    .toUpperCase()
    .slice(0, 2)

  const sizeClasses = {
    sm: 'w-5 h-5 text-[10px]',
    md: 'w-6 h-6 text-xs',
  }

  return (
    <div
      className={cn(
        'flex-shrink-0 rounded-full flex items-center justify-center font-semibold bg-purple-100 text-purple-700',
        sizeClasses[size]
      )}
      title={name}
    >
      {initials}
    </div>
  )
}

/**
 * Task Detail Modal Content
 * Displays full task details in a modal
 */
function TaskDetailContent({
  task,
  tags = [],
  onClose,
  onStatusChange,
}: {
  task: Task
  tags?: string[]
  onClose: () => void
  onStatusChange?: (taskId: string, newStatus: TaskStatus) => void
}) {
  const isTaskOverdue = task.due_date && task.status !== 'completed' && isOverdue(task.due_date)
  const isCompleted = task.status === 'completed'

  const handleStatusChange = (newStatus: TaskStatus) => {
    onStatusChange?.(task.id, newStatus)
  }

  return (
    <div className="space-y-6" data-testid="task-detail-modal">
      {/* Description */}
      {task.description && (
        <div>
          <h4 className="text-sm font-medium text-muted-foreground mb-2">Description</h4>
          <p className="text-foreground whitespace-pre-wrap">{task.description}</p>
        </div>
      )}

      {/* Status and Priority */}
      <div className="grid grid-cols-2 gap-4">
        <div>
          <h4 className="text-sm font-medium text-muted-foreground mb-2">Status</h4>
          <StatusBadge status={task.status} />
        </div>
        <div>
          <h4 className="text-sm font-medium text-muted-foreground mb-2">Priority</h4>
          <PriorityBadge priority={task.priority} />
        </div>
      </div>

      {/* Assignee and Due Date */}
      <div className="grid grid-cols-2 gap-4">
        {task.assignee && (
          <div>
            <h4 className="text-sm font-medium text-muted-foreground mb-2">Assignee</h4>
            <div className="flex items-center gap-2">
              <AssigneeAvatar name={task.assignee} />
              <span className="text-foreground">{task.assignee}</span>
            </div>
          </div>
        )}
        {task.due_date && (
          <div>
            <h4 className="text-sm font-medium text-muted-foreground mb-2">Due Date</h4>
            <div
              className={cn(
                'flex items-center gap-2',
                isTaskOverdue && 'text-red-600 font-medium'
              )}
            >
              <Calendar className="w-4 h-4" />
              <span>{formatDate(task.due_date)}</span>
              {isTaskOverdue && <span className="text-xs">(Overdue)</span>}
            </div>
          </div>
        )}
      </div>

      {/* Tags */}
      {tags.length > 0 && (
        <div>
          <h4 className="text-sm font-medium text-muted-foreground mb-2">Tags</h4>
          <div className="flex flex-wrap gap-2">
            {tags.map((tag) => (
              <TagBadge key={tag} tag={tag} />
            ))}
          </div>
        </div>
      )}

      {/* Timestamps */}
      <div className="pt-4 border-t border-border">
        <div className="flex flex-wrap gap-4 text-xs text-muted-foreground">
          <div className="flex items-center gap-1">
            <Clock className="w-3 h-3" />
            Created {formatDate(task.created_at)}
          </div>
          {task.completed_at && (
            <div className="flex items-center gap-1 text-green-600">
              <CheckCircle className="w-3 h-3" />
              Completed {formatDate(task.completed_at)}
            </div>
          )}
        </div>
      </div>

      {/* Actions */}
      <div className="pt-4 flex justify-between items-center">
        {onStatusChange && !isCompleted && (
          <button
            onClick={() => handleStatusChange('completed')}
            className="px-4 py-2 text-sm font-medium text-green-700 bg-green-100 hover:bg-green-200 rounded-lg transition-colors flex items-center gap-2"
          >
            <CheckCircle className="w-4 h-4" />
            Mark Complete
          </button>
        )}
        {onStatusChange && isCompleted && (
          <button
            onClick={() => handleStatusChange('pending')}
            className="px-4 py-2 text-sm font-medium text-blue-700 bg-blue-100 hover:bg-blue-200 rounded-lg transition-colors"
          >
            Reopen Task
          </button>
        )}
        {!onStatusChange && <div />}
        <button
          onClick={onClose}
          className="px-4 py-2 text-sm font-medium text-white bg-purple-600 hover:bg-purple-700 rounded-lg transition-colors"
        >
          Close
        </button>
      </div>
    </div>
  )
}

/**
 * TaskCard Component
 * Main component that displays a task card with all relevant information
 */
export function TaskCard({
  task,
  onTaskClick,
  onTaskStatusChange,
  onTaskUpdate,
  onTaskDelete,
  showModalOnClick = true,
  useEditableModal = false,
  compact = false,
  tags = [],
  onTagsChange,
  className,
}: TaskCardProps) {
  const [isModalOpen, setIsModalOpen] = useState(false)
  const [currentTask, setCurrentTask] = useState<Task>(task)
  const [currentTags, setCurrentTags] = useState<string[]>(tags)

  // Update local state when props change
  if (task.id !== currentTask.id || task.updated_at !== currentTask.updated_at) {
    setCurrentTask(task)
  }
  if (tags.join(',') !== currentTags.join(',')) {
    setCurrentTags(tags)
  }

  const isTaskOverdue = task.due_date && task.status !== 'completed' && isOverdue(task.due_date)
  const isCompleted = task.status === 'completed'

  const handleCardClick = () => {
    if (onTaskClick) {
      onTaskClick(task)
    }
    if (showModalOnClick) {
      setIsModalOpen(true)
    }
  }

  const handleModalClose = () => {
    setIsModalOpen(false)
  }

  return (
    <>
      <div
        data-testid={`task-card-${task.id}`}
        onClick={handleCardClick}
        className={cn(
          'bg-card border rounded-lg cursor-pointer transition-all hover:shadow-md group',
          compact ? 'p-3' : 'p-4',
          isTaskOverdue && 'border-red-300 bg-red-50/50',
          isCompleted && 'opacity-75',
          className
        )}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault()
            handleCardClick()
          }
        }}
        aria-label={`Task: ${task.title}`}
      >
        {/* Header: Title and Badges */}
        <div className="flex items-start justify-between gap-2 mb-2">
          <h4
            className={cn(
              'font-semibold text-foreground',
              compact ? 'text-sm line-clamp-2' : 'text-base line-clamp-2',
              isCompleted && 'line-through text-muted-foreground'
            )}
          >
            {task.title}
          </h4>
          <div className="flex gap-2 flex-shrink-0">
            <PriorityBadge priority={task.priority} />
          </div>
        </div>

        {/* Description (non-compact mode) */}
        {!compact && task.description && (
          <p
            className={cn(
              'text-sm mb-3 line-clamp-2',
              isCompleted ? 'text-muted-foreground' : 'text-foreground/70'
            )}
          >
            {task.description}
          </p>
        )}

        {/* Tags */}
        {tags.length > 0 && (
          <div className="flex flex-wrap gap-1 mb-3">
            {tags.slice(0, compact ? 2 : 4).map((tag) => (
              <TagBadge key={tag} tag={tag} />
            ))}
            {tags.length > (compact ? 2 : 4) && (
              <span className="text-xs text-muted-foreground px-1">
                +{tags.length - (compact ? 2 : 4)} more
              </span>
            )}
          </div>
        )}

        {/* Footer: Metadata */}
        <div className="flex items-center justify-between gap-2 mt-2">
          <StatusBadge status={task.status} />

          <div className="flex items-center gap-3 text-xs text-muted-foreground">
            {/* Assignee */}
            {task.assignee && (
              <div className="flex items-center gap-1" title={`Assigned to: ${task.assignee}`}>
                {compact ? (
                  <User className="w-3 h-3" />
                ) : (
                  <AssigneeAvatar name={task.assignee} size="sm" />
                )}
                <span className="truncate max-w-[80px]">{task.assignee}</span>
              </div>
            )}

            {/* Due Date */}
            {task.due_date && (
              <div
                className={cn(
                  'flex items-center gap-1',
                  isTaskOverdue && 'text-red-600 font-semibold'
                )}
                title={`Due: ${formatDate(task.due_date)}`}
              >
                <Calendar className="w-3 h-3" />
                <span>{formatDate(task.due_date)}</span>
              </div>
            )}

            {/* Completed indicator */}
            {isCompleted && task.completed_at && (
              <div className="flex items-center text-green-600" title="Completed">
                <CheckCircle className="w-3 h-3" />
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Task Detail Modal - use editable modal or read-only based on prop */}
      {showModalOnClick && useEditableModal && (
        <TaskModal
          isOpen={isModalOpen}
          onClose={handleModalClose}
          task={currentTask}
          tags={currentTags}
          onSuccess={(updatedTask) => {
            setCurrentTask(updatedTask)
            onTaskUpdate?.(updatedTask)
          }}
          onDelete={(taskId) => {
            handleModalClose()
            onTaskDelete?.(taskId)
          }}
          onTagsChange={(taskId, newTags) => {
            setCurrentTags(newTags)
            onTagsChange?.(taskId, newTags)
          }}
        />
      )}
      {showModalOnClick && !useEditableModal && (
        <Modal
          isOpen={isModalOpen}
          onClose={handleModalClose}
          title={currentTask.title}
          size="md"
        >
          <TaskDetailContent
            task={currentTask}
            tags={currentTags}
            onClose={handleModalClose}
            onStatusChange={onTaskStatusChange}
          />
        </Modal>
      )}
    </>
  )
}

export default TaskCard
