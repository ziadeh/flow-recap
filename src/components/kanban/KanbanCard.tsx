import { useDrag } from 'react-dnd'
import {
  GripVertical,
  User,
  Calendar,
  AlertTriangle,
  CheckCircle,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import type { Task, TaskPriority, TaskStatus } from '@/types/database'
import { formatDate } from '@/lib/formatters'

export interface KanbanCardProps {
  task: Task
  onTaskClick?: (task: Task) => void
}

const priorityConfig: Record<TaskPriority, { label: string; color: string; bgClass: string; textClass: string; borderClass: string }> = {
  urgent: {
    label: 'Urgent',
    color: 'red',
    bgClass: 'bg-red-100',
    textClass: 'text-red-700',
    borderClass: 'border-red-200'
  },
  high: {
    label: 'High',
    color: 'orange',
    bgClass: 'bg-orange-100',
    textClass: 'text-orange-700',
    borderClass: 'border-orange-200'
  },
  medium: {
    label: 'Medium',
    color: 'yellow',
    bgClass: 'bg-yellow-100',
    textClass: 'text-yellow-700',
    borderClass: 'border-yellow-200'
  },
  low: {
    label: 'Low',
    color: 'gray',
    bgClass: 'bg-gray-100',
    textClass: 'text-gray-700',
    borderClass: 'border-gray-200'
  },
}

export const DRAG_TYPE = 'KANBAN_CARD'

export interface DragItem {
  type: typeof DRAG_TYPE
  id: string
  task: Task
  fromColumn: TaskStatus
}

function PriorityBadge({ priority }: { priority: TaskPriority }) {
  const config = priorityConfig[priority]

  return (
    <span className={cn(
      'inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium border',
      config.bgClass,
      config.textClass,
      config.borderClass
    )}>
      {priority === 'urgent' && <AlertTriangle className="w-3 h-3 mr-1" />}
      {config.label}
    </span>
  )
}

function isOverdue(dateString: string): boolean {
  const dueDate = new Date(dateString)
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  return dueDate < today
}

export function KanbanCard({ task, onTaskClick }: KanbanCardProps) {
  const [{ isDragging }, drag, preview] = useDrag<DragItem, void, { isDragging: boolean }>(() => ({
    type: DRAG_TYPE,
    item: {
      type: DRAG_TYPE,
      id: task.id,
      task,
      fromColumn: task.status
    },
    collect: (monitor) => ({
      isDragging: monitor.isDragging(),
    }),
  }), [task])

  const isTaskOverdue = task.due_date && task.status !== 'completed' && isOverdue(task.due_date)
  const isCompleted = task.status === 'completed'

  return (
    <div
      ref={preview}
      data-testid={`kanban-card-${task.id}`}
      className={cn(
        'bg-card border rounded-lg p-3 cursor-grab active:cursor-grabbing transition-all hover:shadow-md group',
        isDragging && 'opacity-50 shadow-lg rotate-2',
        isTaskOverdue && 'border-red-300 bg-red-50/50',
        isCompleted && 'opacity-75'
      )}
      onClick={() => onTaskClick?.(task)}
    >
      <div className="flex items-start gap-2">
        {/* Drag Handle */}
        <div
          ref={drag}
          className="flex-shrink-0 cursor-grab active:cursor-grabbing text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity"
        >
          <GripVertical className="w-4 h-4" />
        </div>

        {/* Content */}
        <div className="flex-1 min-w-0">
          <div className="flex items-start justify-between gap-2 mb-1">
            <h4
              className={cn(
                'font-medium text-sm text-foreground line-clamp-2',
                isCompleted && 'line-through text-muted-foreground'
              )}
            >
              {task.title}
            </h4>
          </div>

          {task.description && (
            <p className={cn(
              'text-xs mb-2 line-clamp-2',
              isCompleted ? 'text-muted-foreground' : 'text-foreground/70'
            )}>
              {task.description}
            </p>
          )}

          {/* Footer */}
          <div className="flex items-center justify-between gap-2 mt-2">
            <PriorityBadge priority={task.priority} />

            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              {task.assignee && (
                <div className="flex items-center" title={task.assignee}>
                  <User className="w-3 h-3 mr-0.5" />
                  <span className="truncate max-w-[60px]">{task.assignee}</span>
                </div>
              )}

              {task.due_date && (
                <div
                  className={cn(
                    'flex items-center',
                    isTaskOverdue && 'text-red-600 font-semibold'
                  )}
                  title={`Due: ${formatDate(task.due_date)}`}
                >
                  <Calendar className="w-3 h-3 mr-0.5" />
                  <span>{formatDate(task.due_date)}</span>
                </div>
              )}

              {isCompleted && task.completed_at && (
                <div className="flex items-center text-green-600" title="Completed">
                  <CheckCircle className="w-3 h-3" />
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

export default KanbanCard
