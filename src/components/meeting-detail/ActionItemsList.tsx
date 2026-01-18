import { useState } from 'react'
import {
  CheckCircle,
  Circle,
  AlertTriangle,
  User,
  Calendar,
  Clock,
  ListTodo,
  Filter
} from 'lucide-react'
import type { Task, TaskPriority, TaskStatus } from '../../types/database'
import { formatDate, formatDateTime, isOverdue } from '../../lib/formatters'

interface ActionItemsListProps {
  /** Tasks associated with the meeting */
  tasks: Task[]
  /** Whether to show filter controls (default: true) */
  showFilters?: boolean
  /** Optional callback when task status changes */
  onTaskStatusChange?: (taskId: string, newStatus: TaskStatus) => void
}

type FilterType = 'all' | TaskPriority | TaskStatus

const priorityConfig: Record<TaskPriority, { label: string; color: string; icon?: typeof AlertTriangle }> = {
  urgent: { label: 'Urgent', color: 'red', icon: AlertTriangle },
  high: { label: 'High', color: 'orange' },
  medium: { label: 'Medium', color: 'yellow' },
  low: { label: 'Low', color: 'gray' },
}

const statusConfig: Record<TaskStatus, { label: string; color: string }> = {
  pending: { label: 'Pending', color: 'blue' },
  in_progress: { label: 'In Progress', color: 'purple' },
  completed: { label: 'Completed', color: 'green' },
  cancelled: { label: 'Cancelled', color: 'gray' },
}

/**
 * Priority badge component
 */
function PriorityBadge({ priority }: { priority: TaskPriority }) {
  const config = priorityConfig[priority]
  const Icon = config.icon

  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-${config.color}-100 text-${config.color}-700 border border-${config.color}-200`}>
      {Icon && <Icon className="w-3 h-3 mr-1" />}
      {config.label}
    </span>
  )
}

/**
 * Status badge component
 */
function StatusBadge({ status }: { status: TaskStatus }) {
  const config = statusConfig[status]

  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-${config.color}-100 text-${config.color}-700 border border-${config.color}-200`}>
      {config.label}
    </span>
  )
}

/**
 * Single action item card component
 */
function ActionItemCard({
  task,
  onStatusChange
}: {
  task: Task
  onStatusChange?: (taskId: string, newStatus: TaskStatus) => void
}) {
  const isTaskOverdue = task.due_date && task.status !== 'completed' && isOverdue(task.due_date)
  const isCompleted = task.status === 'completed'

  const handleToggleComplete = () => {
    if (onStatusChange) {
      onStatusChange(task.id, isCompleted ? 'pending' : 'completed')
    }
  }

  return (
    <div
      className={`bg-card border rounded-lg p-4 hover:shadow-sm transition-all ${
        isTaskOverdue ? 'border-red-300 bg-red-50/50' : 'border-border'
      } ${isCompleted ? 'opacity-75' : ''}`}
    >
      <div className="flex items-start gap-3">
        {/* Checkbox */}
        <button
          onClick={handleToggleComplete}
          className={`mt-0.5 flex-shrink-0 transition-colors ${
            onStatusChange ? 'cursor-pointer hover:opacity-80' : 'cursor-default'
          }`}
          disabled={!onStatusChange}
        >
          {isCompleted ? (
            <CheckCircle className="w-5 h-5 text-green-600" />
          ) : (
            <Circle className="w-5 h-5 text-muted-foreground" />
          )}
        </button>

        {/* Content */}
        <div className="flex-1 min-w-0">
          <div className="flex items-start justify-between gap-2 mb-2">
            <h4
              className={`font-semibold text-foreground ${
                isCompleted ? 'line-through text-muted-foreground' : ''
              }`}
            >
              {task.title}
            </h4>
            <div className="flex gap-2 flex-shrink-0">
              <PriorityBadge priority={task.priority} />
              <StatusBadge status={task.status} />
            </div>
          </div>

          {task.description && (
            <p className={`text-sm mb-3 whitespace-pre-wrap ${
              isCompleted ? 'text-muted-foreground' : 'text-foreground/80'
            }`}>
              {task.description}
            </p>
          )}

          {/* Metadata */}
          <div className="flex flex-wrap gap-4 text-xs text-muted-foreground">
            {task.assignee && (
              <div className="flex items-center">
                <User className="w-3 h-3 mr-1" />
                {task.assignee}
              </div>
            )}
            {task.due_date && (
              <div
                className={`flex items-center ${
                  isTaskOverdue ? 'text-red-600 font-semibold' : ''
                }`}
              >
                <Calendar className="w-3 h-3 mr-1" />
                Due: {formatDate(task.due_date)}
                {isTaskOverdue && (
                  <span className="ml-1 text-red-600">(Overdue)</span>
                )}
              </div>
            )}
            {task.completed_at && (
              <div className="flex items-center text-green-600">
                <CheckCircle className="w-3 h-3 mr-1" />
                Completed {formatDate(task.completed_at)}
              </div>
            )}
            <div className="flex items-center">
              <Clock className="w-3 h-3 mr-1" />
              Created {formatDateTime(task.created_at)}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

/**
 * ActionItemsList Component
 * Displays extracted action items and tasks in an organized list
 */
export function ActionItemsList({
  tasks,
  showFilters = true,
  onTaskStatusChange
}: ActionItemsListProps) {
  const [filter, setFilter] = useState<FilterType>('all')
  const [sortBy, setSortBy] = useState<'priority' | 'date' | 'status'>('priority')

  // Sort tasks
  const sortedTasks = [...tasks].sort((a, b) => {
    if (sortBy === 'priority') {
      const priorityOrder = { urgent: 0, high: 1, medium: 2, low: 3 }
      return priorityOrder[a.priority] - priorityOrder[b.priority]
    }
    if (sortBy === 'status') {
      const statusOrder = { pending: 0, in_progress: 1, completed: 2, cancelled: 3 }
      return statusOrder[a.status] - statusOrder[b.status]
    }
    // date - newest first
    return new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
  })

  // Filter tasks
  const filteredTasks = sortedTasks.filter((task) => {
    if (filter === 'all') return true
    if (filter in priorityConfig) return task.priority === filter
    if (filter in statusConfig) return task.status === filter
    return true
  })

  // Count stats
  const stats = {
    total: tasks.length,
    pending: tasks.filter(t => t.status === 'pending').length,
    inProgress: tasks.filter(t => t.status === 'in_progress').length,
    completed: tasks.filter(t => t.status === 'completed').length,
    overdue: tasks.filter(t => t.due_date && t.status !== 'completed' && isOverdue(t.due_date)).length,
  }

  if (tasks.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-center">
        <ListTodo className="w-12 h-12 text-muted-foreground mb-4" />
        <h3 className="text-lg font-semibold text-foreground mb-2">No action items found</h3>
        <p className="text-sm text-muted-foreground max-w-md">
          Action items extracted from this meeting will appear here.
          Use the "Extract Action Items" button to identify tasks from the transcript.
        </p>
      </div>
    )
  }

  return (
    <div className="py-4">
      {/* Stats summary */}
      <div className="flex flex-wrap gap-4 mb-6">
        <div className="flex items-center gap-2 px-3 py-2 bg-muted rounded-lg">
          <span className="text-sm font-medium text-foreground">{stats.total}</span>
          <span className="text-sm text-muted-foreground">Total</span>
        </div>
        <div className="flex items-center gap-2 px-3 py-2 bg-blue-50 rounded-lg">
          <span className="text-sm font-medium text-blue-700">{stats.pending}</span>
          <span className="text-sm text-blue-600">Pending</span>
        </div>
        <div className="flex items-center gap-2 px-3 py-2 bg-purple-50 rounded-lg">
          <span className="text-sm font-medium text-purple-700">{stats.inProgress}</span>
          <span className="text-sm text-purple-600">In Progress</span>
        </div>
        <div className="flex items-center gap-2 px-3 py-2 bg-green-50 rounded-lg">
          <span className="text-sm font-medium text-green-700">{stats.completed}</span>
          <span className="text-sm text-green-600">Completed</span>
        </div>
        {stats.overdue > 0 && (
          <div className="flex items-center gap-2 px-3 py-2 bg-red-50 rounded-lg">
            <AlertTriangle className="w-4 h-4 text-red-600" />
            <span className="text-sm font-medium text-red-700">{stats.overdue}</span>
            <span className="text-sm text-red-600">Overdue</span>
          </div>
        )}
      </div>

      {/* Filters and sorting */}
      {showFilters && tasks.length > 0 && (
        <div className="flex flex-wrap items-center gap-4 mb-6">
          <div className="flex items-center gap-2">
            <Filter className="w-4 h-4 text-muted-foreground" />
            <select
              value={filter}
              onChange={(e) => setFilter(e.target.value as FilterType)}
              className="px-3 py-1.5 text-sm border border-border rounded-lg bg-background focus:outline-none focus:ring-2 focus:ring-purple-500"
            >
              <option value="all">All Items</option>
              <optgroup label="By Status">
                <option value="pending">Pending</option>
                <option value="in_progress">In Progress</option>
                <option value="completed">Completed</option>
              </optgroup>
              <optgroup label="By Priority">
                <option value="urgent">Urgent</option>
                <option value="high">High Priority</option>
                <option value="medium">Medium Priority</option>
                <option value="low">Low Priority</option>
              </optgroup>
            </select>
          </div>

          <div className="flex items-center gap-2">
            <span className="text-sm text-muted-foreground">Sort by:</span>
            <select
              value={sortBy}
              onChange={(e) => setSortBy(e.target.value as 'priority' | 'date' | 'status')}
              className="px-3 py-1.5 text-sm border border-border rounded-lg bg-background focus:outline-none focus:ring-2 focus:ring-purple-500"
            >
              <option value="priority">Priority</option>
              <option value="status">Status</option>
              <option value="date">Date Created</option>
            </select>
          </div>
        </div>
      )}

      {/* Tasks list */}
      {filteredTasks.length > 0 && (
        <div className="space-y-3 mb-8">
          {filteredTasks.map((task) => (
            <ActionItemCard
              key={task.id}
              task={task}
              onStatusChange={onTaskStatusChange}
            />
          ))}
        </div>
      )}

      {/* Show message when filter returns no results */}
      {tasks.length > 0 && filteredTasks.length === 0 && (
        <div className="text-center py-8 text-muted-foreground mb-8">
          No action items match the selected filter.
        </div>
      )}
    </div>
  )
}

export default ActionItemsList
