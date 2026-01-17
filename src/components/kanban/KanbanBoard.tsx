import { useCallback, useMemo } from 'react'
import { DndProvider } from 'react-dnd'
import { HTML5Backend } from 'react-dnd-html5-backend'
import { LayoutGrid, Plus } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { Task, TaskStatus } from '@/types/database'
import { KanbanColumn } from './KanbanColumn'

export interface KanbanBoardProps {
  /** Tasks to display in the board */
  tasks: Task[]
  /** Callback when a task's status changes via drag-and-drop */
  onTaskStatusChange?: (taskId: string, newStatus: TaskStatus) => void
  /** Callback when a task card is clicked */
  onTaskClick?: (task: Task) => void
  /** Callback when add task button is clicked */
  onAddTask?: () => void
  /** Whether to show the cancelled column (default: false) */
  showCancelled?: boolean
  /** Optional className for the container */
  className?: string
}

// Define the columns to display in order
const BOARD_COLUMNS: TaskStatus[] = ['pending', 'in_progress', 'completed']

export function KanbanBoard({
  tasks,
  onTaskStatusChange,
  onTaskClick,
  onAddTask,
  showCancelled = false,
  className,
}: KanbanBoardProps) {
  // Group tasks by status
  const tasksByStatus = useMemo(() => {
    const grouped: Record<TaskStatus, Task[]> = {
      pending: [],
      in_progress: [],
      completed: [],
      cancelled: [],
    }

    tasks.forEach((task) => {
      if (grouped[task.status]) {
        grouped[task.status].push(task)
      }
    })

    // Sort tasks within each column by priority then by due date
    const priorityOrder = { urgent: 0, high: 1, medium: 2, low: 3 }
    Object.keys(grouped).forEach((status) => {
      grouped[status as TaskStatus].sort((a, b) => {
        // First by priority
        const priorityDiff = priorityOrder[a.priority] - priorityOrder[b.priority]
        if (priorityDiff !== 0) return priorityDiff

        // Then by due date (tasks with due dates first, earlier dates first)
        if (a.due_date && b.due_date) {
          return new Date(a.due_date).getTime() - new Date(b.due_date).getTime()
        }
        if (a.due_date) return -1
        if (b.due_date) return 1

        // Finally by created date
        return new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
      })
    })

    return grouped
  }, [tasks])

  const handleTaskDrop = useCallback((taskId: string, newStatus: TaskStatus) => {
    onTaskStatusChange?.(taskId, newStatus)
  }, [onTaskStatusChange])

  const columns = showCancelled ? [...BOARD_COLUMNS, 'cancelled' as TaskStatus] : BOARD_COLUMNS

  const totalTasks = tasks.length
  const completedTasks = tasksByStatus.completed.length
  const progressPercentage = totalTasks > 0 ? Math.round((completedTasks / totalTasks) * 100) : 0

  return (
    <DndProvider backend={HTML5Backend}>
      <div className={cn('flex flex-col h-full', className)} data-testid="kanban-board">
        {/* Board Header */}
        <div className="flex items-center justify-between mb-4 flex-wrap gap-4">
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-2">
              <LayoutGrid className="w-5 h-5 text-muted-foreground" />
              <h2 className="text-lg font-semibold text-foreground">Task Board</h2>
            </div>

            {/* Progress indicator */}
            <div className="flex items-center gap-2">
              <div className="w-32 h-2 bg-muted rounded-full overflow-hidden">
                <div
                  className="h-full bg-green-500 transition-all duration-300"
                  style={{ width: `${progressPercentage}%` }}
                />
              </div>
              <span className="text-xs text-muted-foreground">
                {completedTasks}/{totalTasks} done ({progressPercentage}%)
              </span>
            </div>
          </div>

          {/* Actions */}
          <div className="flex items-center gap-2">
            {onAddTask && (
              <button
                onClick={onAddTask}
                className="inline-flex items-center px-3 py-1.5 text-sm font-medium text-white bg-purple-600 hover:bg-purple-700 rounded-lg transition-colors"
              >
                <Plus className="w-4 h-4 mr-1" />
                Add Task
              </button>
            )}
          </div>
        </div>

        {/* Board Columns - Responsive Grid */}
        <div className={cn(
          'flex-1 grid gap-4 auto-rows-min',
          // Responsive: 1 column on mobile, 2 on tablet, 3+ on desktop
          columns.length === 3 && 'grid-cols-1 md:grid-cols-2 lg:grid-cols-3',
          columns.length === 4 && 'grid-cols-1 md:grid-cols-2 lg:grid-cols-4'
        )}>
          {columns.map((status) => (
            <KanbanColumn
              key={status}
              status={status}
              tasks={tasksByStatus[status]}
              onTaskDrop={handleTaskDrop}
              onTaskClick={onTaskClick}
            />
          ))}
        </div>

        {/* Empty State */}
        {tasks.length === 0 && (
          <div className="flex flex-col items-center justify-center py-16 text-center">
            <LayoutGrid className="w-12 h-12 text-muted-foreground mb-4" />
            <h3 className="text-lg font-semibold text-foreground mb-2">No tasks yet</h3>
            <p className="text-sm text-muted-foreground max-w-md mb-4">
              Start organizing your work by adding tasks to the board.
              Drag and drop tasks between columns to update their status.
            </p>
            {onAddTask && (
              <button
                onClick={onAddTask}
                className="inline-flex items-center px-4 py-2 text-sm font-medium text-white bg-purple-600 hover:bg-purple-700 rounded-lg transition-colors"
              >
                <Plus className="w-4 h-4 mr-2" />
                Create your first task
              </button>
            )}
          </div>
        )}
      </div>
    </DndProvider>
  )
}

export default KanbanBoard
