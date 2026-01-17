import { useState } from 'react'
import { CheckSquare, Square, AlertCircle, Clock, User, Calendar } from 'lucide-react'
import type { Task, TaskStatus } from '../../types/database'
import { formatDate, isOverdue } from '../../lib/formatters'

interface TasksTabProps {
  tasks: Task[]
}

type FilterType = 'all' | TaskStatus

const filterOptions: { value: FilterType; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'pending', label: 'Pending' },
  { value: 'in_progress', label: 'In Progress' },
  { value: 'completed', label: 'Completed' },
]

const priorityConfig = {
  urgent: { label: 'Urgent', color: 'red' },
  high: { label: 'High', color: 'orange' },
  medium: { label: 'Medium', color: 'yellow' },
  low: { label: 'Low', color: 'gray' },
}

const statusConfig = {
  pending: { label: 'Pending', color: 'blue' },
  in_progress: { label: 'In Progress', color: 'purple' },
  completed: { label: 'Completed', color: 'green' },
  cancelled: { label: 'Cancelled', color: 'gray' },
}

export function TasksTab({ tasks }: TasksTabProps) {
  const [filter, setFilter] = useState<FilterType>('all')

  const filteredTasks = tasks.filter((task) => {
    if (filter === 'all') return true
    return task.status === filter
  })

  if (tasks.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-center">
        <CheckSquare className="w-12 h-12 text-muted-foreground mb-4" />
        <h3 className="text-lg font-semibold text-foreground mb-2">No tasks found</h3>
        <p className="text-sm text-muted-foreground">
          Tasks and action items from this meeting will appear here.
        </p>
      </div>
    )
  }

  return (
    <div className="py-4">
      {/* Filter buttons */}
      <div className="flex gap-2 mb-6">
        {filterOptions.map((option) => (
          <button
            key={option.value}
            onClick={() => setFilter(option.value)}
            className={`
              px-4 py-2 rounded-lg text-sm font-medium transition-colors
              ${
                filter === option.value
                  ? 'bg-purple-100 text-purple-700 border-2 border-purple-600'
                  : 'bg-muted text-muted-foreground border-2 border-transparent hover:bg-muted/80'
              }
            `}
          >
            {option.label}
            <span className="ml-2">
              ({option.value === 'all' ? tasks.length : tasks.filter(t => t.status === option.value).length})
            </span>
          </button>
        ))}
      </div>

      {/* Task list */}
      {filteredTasks.length === 0 ? (
        <div className="text-center py-8 text-muted-foreground">
          No tasks match the selected filter.
        </div>
      ) : (
        <div className="space-y-3">
          {filteredTasks.map((task) => {
            const isTaskOverdue = task.due_date && task.status !== 'completed' && isOverdue(task.due_date)
            const priorityStyle = priorityConfig[task.priority]
            const statusStyle = statusConfig[task.status]

            return (
              <div
                key={task.id}
                className="bg-card border border-border rounded-lg p-4 hover:shadow-sm transition-shadow"
              >
                <div className="flex items-start gap-3">
                  {/* Checkbox */}
                  <div className="mt-0.5">
                    {task.status === 'completed' ? (
                      <CheckSquare className="w-5 h-5 text-green-600" />
                    ) : (
                      <Square className="w-5 h-5 text-muted-foreground" />
                    )}
                  </div>

                  {/* Task content */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-start justify-between gap-2 mb-2">
                      <h4
                        className={`font-semibold text-foreground ${
                          task.status === 'completed' ? 'line-through text-muted-foreground' : ''
                        }`}
                      >
                        {task.title}
                      </h4>
                      <div className="flex gap-2 flex-shrink-0">
                        <span
                          className={`px-2 py-0.5 rounded-full text-xs font-medium bg-${priorityStyle.color}-100 text-${priorityStyle.color}-700 border border-${priorityStyle.color}-200`}
                        >
                          {priorityStyle.label}
                        </span>
                        <span
                          className={`px-2 py-0.5 rounded-full text-xs font-medium bg-${statusStyle.color}-100 text-${statusStyle.color}-700 border border-${statusStyle.color}-200`}
                        >
                          {statusStyle.label}
                        </span>
                      </div>
                    </div>

                    {task.description && (
                      <p className="text-sm text-muted-foreground mb-3 whitespace-pre-wrap">
                        {task.description}
                      </p>
                    )}

                    {/* Task metadata */}
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
                          {formatDate(task.due_date)}
                          {isTaskOverdue && (
                            <>
                              <AlertCircle className="w-3 h-3 ml-1" />
                              <span className="ml-1">Overdue</span>
                            </>
                          )}
                        </div>
                      )}
                      {task.completed_at && (
                        <div className="flex items-center">
                          <Clock className="w-3 h-3 mr-1" />
                          Completed {formatDate(task.completed_at)}
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
