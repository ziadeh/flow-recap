import { useDrop } from 'react-dnd'
import { cn } from '@/lib/utils'
import type { Task, TaskStatus } from '@/types/database'
import { KanbanCard, DRAG_TYPE, DragItem } from './KanbanCard'
import {
  Circle,
  Clock,
  CheckCircle,
  XCircle,
} from 'lucide-react'

export interface KanbanColumnProps {
  status: TaskStatus
  tasks: Task[]
  onTaskDrop: (taskId: string, newStatus: TaskStatus) => void
  onTaskClick?: (task: Task) => void
}

const columnConfig: Record<TaskStatus, {
  title: string
  icon: React.ElementType
  headerBgClass: string
  headerTextClass: string
  dropHighlightClass: string
}> = {
  pending: {
    title: 'TODO',
    icon: Circle,
    headerBgClass: 'bg-blue-50',
    headerTextClass: 'text-blue-700',
    dropHighlightClass: 'border-blue-400 bg-blue-50/50',
  },
  in_progress: {
    title: 'In Progress',
    icon: Clock,
    headerBgClass: 'bg-purple-50',
    headerTextClass: 'text-purple-700',
    dropHighlightClass: 'border-purple-400 bg-purple-50/50',
  },
  completed: {
    title: 'Done',
    icon: CheckCircle,
    headerBgClass: 'bg-green-50',
    headerTextClass: 'text-green-700',
    dropHighlightClass: 'border-green-400 bg-green-50/50',
  },
  cancelled: {
    title: 'Cancelled',
    icon: XCircle,
    headerBgClass: 'bg-gray-50',
    headerTextClass: 'text-gray-700',
    dropHighlightClass: 'border-gray-400 bg-gray-50/50',
  },
}

export function KanbanColumn({
  status,
  tasks,
  onTaskDrop,
  onTaskClick,
}: KanbanColumnProps) {
  const config = columnConfig[status]
  const Icon = config.icon

  const [{ isOver, canDrop }, drop] = useDrop<DragItem, void, { isOver: boolean; canDrop: boolean }>(() => ({
    accept: DRAG_TYPE,
    drop: (item) => {
      if (item.fromColumn !== status) {
        onTaskDrop(item.id, status)
      }
    },
    canDrop: (item) => item.fromColumn !== status,
    collect: (monitor) => ({
      isOver: monitor.isOver(),
      canDrop: monitor.canDrop(),
    }),
  }), [status, onTaskDrop])

  const isDropTarget = isOver && canDrop

  return (
    <div
      ref={drop}
      data-testid={`kanban-column-${status}`}
      className={cn(
        'flex flex-col bg-muted/30 rounded-lg border-2 border-transparent transition-all min-h-[400px] h-full',
        isDropTarget && config.dropHighlightClass
      )}
    >
      {/* Column Header */}
      <div className={cn(
        'flex items-center justify-between px-4 py-3 rounded-t-lg',
        config.headerBgClass
      )}>
        <div className="flex items-center gap-2">
          <Icon className={cn('w-4 h-4', config.headerTextClass)} />
          <h3 className={cn('font-semibold text-sm', config.headerTextClass)}>
            {config.title}
          </h3>
        </div>
        <span className={cn(
          'px-2 py-0.5 rounded-full text-xs font-medium',
          config.headerBgClass,
          config.headerTextClass
        )}>
          {tasks.length}
        </span>
      </div>

      {/* Cards Container */}
      <div className="flex-1 p-2 space-y-2 overflow-y-auto">
        {tasks.length === 0 ? (
          <div className={cn(
            'flex items-center justify-center h-24 border-2 border-dashed rounded-lg text-sm text-muted-foreground',
            isDropTarget ? 'border-current' : 'border-muted'
          )}>
            {isDropTarget ? 'Drop here' : 'No tasks'}
          </div>
        ) : (
          tasks.map((task) => (
            <KanbanCard
              key={task.id}
              task={task}
              onTaskClick={onTaskClick}
            />
          ))
        )}
      </div>
    </div>
  )
}

export default KanbanColumn
