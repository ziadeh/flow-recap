/**
 * TaskOverviewWidget Component
 *
 * Displays a comprehensive overview of tasks including:
 * - Total count by status (pending, in progress, completed, cancelled)
 * - Overdue tasks count and list
 * - Tasks by assignee breakdown
 * - Completion trends over time
 */

import { useState, useEffect, useMemo, memo } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  CheckCircle,
  Clock,
  AlertTriangle,
  Users,
  TrendingUp,
  ListTodo,
  Play,
  ChevronRight,
  BarChart3,
  CalendarClock,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import type { Task, TaskStatus } from '@/types/database'
import { isOverdue } from '@/lib/formatters'

// ============================================================================
// Types
// ============================================================================

interface TaskStats {
  total: number
  byStatus: Record<TaskStatus, number>
  overdue: number
  completedThisWeek: number
  completedLastWeek: number
  byAssignee: Array<{ name: string; count: number; completed: number }>
  completionRate: number
  completionTrend: 'up' | 'down' | 'stable'
}

interface TaskOverviewWidgetProps {
  /** Optional CSS classes */
  className?: string
  /** Whether to show the detailed breakdown (default: true) */
  showDetails?: boolean
  /** Whether to show completion trends (default: true) */
  showTrends?: boolean
  /** Maximum assignees to show (default: 5) */
  maxAssignees?: number
}

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Calculate task statistics from a list of tasks
 */
function calculateTaskStats(tasks: Task[]): TaskStats {
  const now = new Date()
  const oneWeekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000)
  const twoWeeksAgo = new Date(now.getTime() - 14 * 24 * 60 * 60 * 1000)

  // Initialize stats
  const stats: TaskStats = {
    total: tasks.length,
    byStatus: {
      pending: 0,
      in_progress: 0,
      completed: 0,
      cancelled: 0,
    },
    overdue: 0,
    completedThisWeek: 0,
    completedLastWeek: 0,
    byAssignee: [],
    completionRate: 0,
    completionTrend: 'stable',
  }

  // Assignee tracking
  const assigneeMap = new Map<string, { count: number; completed: number }>()

  // Process each task
  tasks.forEach((task) => {
    // Count by status
    stats.byStatus[task.status]++

    // Count overdue tasks (not completed and past due date)
    if (task.due_date && task.status !== 'completed' && task.status !== 'cancelled') {
      if (isOverdue(task.due_date)) {
        stats.overdue++
      }
    }

    // Count completions this week
    if (task.completed_at) {
      const completedDate = new Date(task.completed_at)
      if (completedDate >= oneWeekAgo) {
        stats.completedThisWeek++
      } else if (completedDate >= twoWeeksAgo && completedDate < oneWeekAgo) {
        stats.completedLastWeek++
      }
    }

    // Track by assignee
    const assigneeName = task.assignee || 'Unassigned'
    if (!assigneeMap.has(assigneeName)) {
      assigneeMap.set(assigneeName, { count: 0, completed: 0 })
    }
    const assigneeStats = assigneeMap.get(assigneeName)!
    assigneeStats.count++
    if (task.status === 'completed') {
      assigneeStats.completed++
    }
  })

  // Convert assignee map to sorted array
  stats.byAssignee = Array.from(assigneeMap.entries())
    .map(([name, data]) => ({ name, ...data }))
    .sort((a, b) => b.count - a.count)

  // Calculate completion rate (completed / (total - cancelled))
  const activeTasks = stats.total - stats.byStatus.cancelled
  stats.completionRate = activeTasks > 0 ? Math.round((stats.byStatus.completed / activeTasks) * 100) : 0

  // Determine completion trend
  if (stats.completedThisWeek > stats.completedLastWeek) {
    stats.completionTrend = 'up'
  } else if (stats.completedThisWeek < stats.completedLastWeek) {
    stats.completionTrend = 'down'
  }

  return stats
}

// ============================================================================
// Sub-Components
// ============================================================================

interface StatCardProps {
  icon: React.ReactNode
  label: string
  value: string | number
  color: 'purple' | 'blue' | 'green' | 'orange' | 'red' | 'gray'
  subtext?: string
  onClick?: () => void
  testId?: string
}

const colorClasses = {
  purple: 'bg-purple-100 text-purple-600',
  blue: 'bg-blue-100 text-blue-600',
  green: 'bg-green-100 text-green-600',
  orange: 'bg-orange-100 text-orange-600',
  red: 'bg-red-100 text-red-600',
  gray: 'bg-gray-100 text-gray-600',
}

const StatCard = memo(function StatCard({ icon, label, value, color, subtext, onClick, testId }: StatCardProps) {
  return (
    <div
      data-testid={testId}
      onClick={onClick}
      className={cn(
        'bg-card border border-border rounded-lg p-4 shadow-sm transition-all',
        onClick && 'cursor-pointer hover:shadow-md hover:border-purple-300'
      )}
    >
      <div className="flex items-center gap-3">
        <div className={cn('p-2 rounded-lg', colorClasses[color])}>
          {icon}
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-2xl font-bold text-foreground">{value}</p>
          <p className="text-sm text-muted-foreground truncate">{label}</p>
          {subtext && (
            <p className="text-xs text-muted-foreground mt-0.5">{subtext}</p>
          )}
        </div>
        {onClick && (
          <ChevronRight className="h-5 w-5 text-muted-foreground flex-shrink-0" />
        )}
      </div>
    </div>
  )
})

interface AssigneeRowProps {
  name: string
  count: number
  completed: number
  totalTasks: number
}

const AssigneeRow = memo(function AssigneeRow({ name, count, completed, totalTasks }: AssigneeRowProps) {
  const percentage = totalTasks > 0 ? Math.round((count / totalTasks) * 100) : 0
  const completionRate = count > 0 ? Math.round((completed / count) * 100) : 0

  // Generate initials
  const initials = name
    .split(' ')
    .map((n) => n[0])
    .join('')
    .toUpperCase()
    .slice(0, 2)

  const isUnassigned = name === 'Unassigned'

  return (
    <div className="flex items-center gap-3 py-2">
      <div
        className={cn(
          'w-8 h-8 rounded-full flex items-center justify-center text-xs font-semibold flex-shrink-0',
          isUnassigned ? 'bg-gray-100 text-gray-600' : 'bg-purple-100 text-purple-700'
        )}
      >
        {isUnassigned ? '?' : initials}
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center justify-between">
          <span className="font-medium text-foreground truncate">{name}</span>
          <span className="text-sm text-muted-foreground ml-2">{count} tasks</span>
        </div>
        <div className="flex items-center gap-2 mt-1">
          <div className="flex-1 h-1.5 bg-gray-100 rounded-full overflow-hidden">
            <div
              className="h-full bg-purple-500 rounded-full transition-all"
              style={{ width: `${percentage}%` }}
            />
          </div>
          <span className="text-xs text-muted-foreground whitespace-nowrap">
            {completionRate}% done
          </span>
        </div>
      </div>
    </div>
  )
})

interface TrendIndicatorProps {
  trend: 'up' | 'down' | 'stable'
  thisWeek: number
  lastWeek: number
}

const TrendIndicator = memo(function TrendIndicator({ trend, thisWeek, lastWeek }: TrendIndicatorProps) {
  const diff = thisWeek - lastWeek
  const percentage = lastWeek > 0 ? Math.round((diff / lastWeek) * 100) : thisWeek > 0 ? 100 : 0

  return (
    <div className="flex items-center gap-2">
      {trend === 'up' && (
        <>
          <TrendingUp className="h-4 w-4 text-green-600" />
          <span className="text-sm text-green-600 font-medium">+{percentage}%</span>
        </>
      )}
      {trend === 'down' && (
        <>
          <TrendingUp className="h-4 w-4 text-red-600 rotate-180" />
          <span className="text-sm text-red-600 font-medium">{percentage}%</span>
        </>
      )}
      {trend === 'stable' && (
        <span className="text-sm text-muted-foreground">No change</span>
      )}
      <span className="text-xs text-muted-foreground">vs last week</span>
    </div>
  )
})

// ============================================================================
// Main Component
// ============================================================================

export function TaskOverviewWidget({
  className,
  showDetails = true,
  showTrends = true,
  maxAssignees = 5,
}: TaskOverviewWidgetProps) {
  const navigate = useNavigate()
  const [tasks, setTasks] = useState<Task[]>([])
  const [isLoading, setIsLoading] = useState(true)

  // Sample tasks for demonstration
  const SAMPLE_TASKS: Task[] = useMemo(() => [
    {
      id: '1',
      meeting_id: null,
      title: 'Review project proposal',
      description: 'Go through the Q1 project proposal and provide feedback',
      assignee: 'John Doe',
      due_date: new Date(Date.now() + 2 * 24 * 60 * 60 * 1000).toISOString(),
      priority: 'high',
      status: 'pending',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      completed_at: null,
      created_during_recording: false,
      generation_timestamp: null,
    },
    {
      id: '2',
      meeting_id: null,
      title: 'Prepare presentation slides',
      description: 'Create slides for the quarterly review meeting',
      assignee: 'Jane Smith',
      due_date: new Date(Date.now() + 5 * 24 * 60 * 60 * 1000).toISOString(),
      priority: 'medium',
      status: 'in_progress',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      completed_at: null,
      created_during_recording: false,
      generation_timestamp: null,
    },
    {
      id: '3',
      meeting_id: null,
      title: 'Update documentation',
      description: 'Update the API documentation with new endpoints',
      assignee: null,
      due_date: null,
      priority: 'low',
      status: 'pending',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      completed_at: null,
      created_during_recording: false,
      generation_timestamp: null,
    },
    {
      id: '4',
      meeting_id: null,
      title: 'Fix critical bug',
      description: 'Address the login issue reported by users',
      assignee: 'John Doe',
      due_date: new Date(Date.now() - 1 * 24 * 60 * 60 * 1000).toISOString(),
      priority: 'urgent',
      status: 'in_progress',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      completed_at: null,
      created_during_recording: false,
      generation_timestamp: null,
    },
    {
      id: '5',
      meeting_id: null,
      title: 'Send meeting notes',
      description: 'Email the meeting notes to all attendees',
      assignee: 'Jane Smith',
      due_date: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString(),
      priority: 'medium',
      status: 'completed',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      completed_at: new Date(Date.now() - 1 * 24 * 60 * 60 * 1000).toISOString(),
      created_during_recording: false,
      generation_timestamp: null,
    },
    {
      id: '6',
      meeting_id: null,
      title: 'Schedule follow-up meeting',
      description: 'Set up a follow-up meeting with the client',
      assignee: null,
      due_date: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
      priority: 'low',
      status: 'completed',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      completed_at: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString(),
      created_during_recording: false,
      generation_timestamp: null,
    },
  ], [])

  // Load tasks on mount (deferred to avoid blocking initial render)
  useEffect(() => {
    let isMounted = true

    const loadTasks = async () => {
      try {
        if (window.electronAPI?.db?.tasks?.getAll) {
          const dbTasks = await window.electronAPI.db.tasks.getAll()
          if (isMounted) {
            if (dbTasks && dbTasks.length > 0) {
              setTasks(dbTasks)
            } else {
              setTasks(SAMPLE_TASKS)
            }
          }
        } else {
          if (isMounted) setTasks(SAMPLE_TASKS)
        }
      } catch (error) {
        console.error('Failed to load tasks:', error)
        if (isMounted) setTasks(SAMPLE_TASKS)
      } finally {
        if (isMounted) setIsLoading(false)
      }
    }

    // Defer task loading significantly to avoid blocking initial render
    // Use requestIdleCallback if available, otherwise setTimeout
    if ('requestIdleCallback' in window) {
      const idleCallbackId = requestIdleCallback(() => {
        if (isMounted) loadTasks()
      }, { timeout: 200 })

      return () => {
        isMounted = false
        cancelIdleCallback(idleCallbackId)
      }
    } else {
      const timeoutId = setTimeout(() => {
        if (isMounted) loadTasks()
      }, 100)

      return () => {
        isMounted = false
        clearTimeout(timeoutId)
      }
    }
  }, [SAMPLE_TASKS])

  // Calculate stats
  const stats = useMemo(() => calculateTaskStats(tasks), [tasks])

  // Navigate to tasks page
  const goToTasks = () => {
    navigate('/tasks')
  }

  if (isLoading) {
    return (
      <div className={cn('space-y-4', className)}>
        <div className="h-8 bg-gray-200 rounded animate-pulse" />
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          {[...Array(4)].map((_, i) => (
            <div key={i} className="h-24 bg-gray-200 rounded-lg animate-pulse" />
          ))}
        </div>
      </div>
    )
  }

  return (
    <div className={cn('space-y-6', className)} data-testid="task-overview-widget">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <BarChart3 className="h-5 w-5 text-purple-600" />
          <h3 className="text-lg font-semibold text-foreground">Task Overview</h3>
        </div>
        <button
          onClick={() => goToTasks()}
          className="text-sm text-purple-600 hover:text-purple-700 font-medium flex items-center gap-1"
        >
          View all tasks
          <ChevronRight className="h-4 w-4" />
        </button>
      </div>

      {/* Main Stats Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard
          testId="stat-total"
          icon={<ListTodo className="h-5 w-5" />}
          label="Total Tasks"
          value={stats.total}
          color="purple"
          onClick={() => goToTasks()}
        />
        <StatCard
          testId="stat-pending"
          icon={<Clock className="h-5 w-5" />}
          label="Pending"
          value={stats.byStatus.pending}
          color="blue"
          subtext={`${stats.byStatus.in_progress} in progress`}
          onClick={() => goToTasks()}
        />
        <StatCard
          testId="stat-overdue"
          icon={<AlertTriangle className="h-5 w-5" />}
          label="Overdue"
          value={stats.overdue}
          color={stats.overdue > 0 ? 'red' : 'gray'}
          onClick={() => goToTasks()}
        />
        <StatCard
          testId="stat-completed"
          icon={<CheckCircle className="h-5 w-5" />}
          label="Completed"
          value={stats.byStatus.completed}
          color="green"
          subtext={`${stats.completionRate}% completion rate`}
          onClick={() => goToTasks()}
        />
      </div>

      {/* Secondary Stats - Status Breakdown */}
      {showDetails && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {/* Status Breakdown */}
          <div className="bg-card border border-border rounded-lg p-4 shadow-sm">
            <h4 className="font-medium text-foreground mb-4 flex items-center gap-2">
              <Play className="h-4 w-4" />
              Status Breakdown
            </h4>
            <div className="space-y-3">
              {/* Progress bar showing all statuses */}
              <div className="h-3 bg-gray-100 rounded-full overflow-hidden flex">
                {stats.total > 0 && (
                  <>
                    <div
                      className="h-full bg-green-500 transition-all"
                      style={{ width: `${(stats.byStatus.completed / stats.total) * 100}%` }}
                      title={`Completed: ${stats.byStatus.completed}`}
                    />
                    <div
                      className="h-full bg-purple-500 transition-all"
                      style={{ width: `${(stats.byStatus.in_progress / stats.total) * 100}%` }}
                      title={`In Progress: ${stats.byStatus.in_progress}`}
                    />
                    <div
                      className="h-full bg-blue-500 transition-all"
                      style={{ width: `${(stats.byStatus.pending / stats.total) * 100}%` }}
                      title={`Pending: ${stats.byStatus.pending}`}
                    />
                    <div
                      className="h-full bg-gray-400 transition-all"
                      style={{ width: `${(stats.byStatus.cancelled / stats.total) * 100}%` }}
                      title={`Cancelled: ${stats.byStatus.cancelled}`}
                    />
                  </>
                )}
              </div>

              {/* Legend */}
              <div className="grid grid-cols-2 gap-2 text-sm">
                <div className="flex items-center gap-2">
                  <div className="w-3 h-3 rounded-full bg-green-500" />
                  <span className="text-muted-foreground">Completed</span>
                  <span className="font-medium ml-auto">{stats.byStatus.completed}</span>
                </div>
                <div className="flex items-center gap-2">
                  <div className="w-3 h-3 rounded-full bg-purple-500" />
                  <span className="text-muted-foreground">In Progress</span>
                  <span className="font-medium ml-auto">{stats.byStatus.in_progress}</span>
                </div>
                <div className="flex items-center gap-2">
                  <div className="w-3 h-3 rounded-full bg-blue-500" />
                  <span className="text-muted-foreground">Pending</span>
                  <span className="font-medium ml-auto">{stats.byStatus.pending}</span>
                </div>
                <div className="flex items-center gap-2">
                  <div className="w-3 h-3 rounded-full bg-gray-400" />
                  <span className="text-muted-foreground">Cancelled</span>
                  <span className="font-medium ml-auto">{stats.byStatus.cancelled}</span>
                </div>
              </div>
            </div>
          </div>

          {/* Tasks by Assignee */}
          <div className="bg-card border border-border rounded-lg p-4 shadow-sm">
            <h4 className="font-medium text-foreground mb-4 flex items-center gap-2">
              <Users className="h-4 w-4" />
              Tasks by Assignee
            </h4>
            {stats.byAssignee.length > 0 ? (
              <div className="space-y-1 divide-y divide-border">
                {stats.byAssignee.slice(0, maxAssignees).map((assignee) => (
                  <AssigneeRow
                    key={assignee.name}
                    name={assignee.name}
                    count={assignee.count}
                    completed={assignee.completed}
                    totalTasks={stats.total}
                  />
                ))}
                {stats.byAssignee.length > maxAssignees && (
                  <div className="pt-2 text-center">
                    <button
                      onClick={() => goToTasks()}
                      className="text-sm text-purple-600 hover:text-purple-700"
                    >
                      +{stats.byAssignee.length - maxAssignees} more assignees
                    </button>
                  </div>
                )}
              </div>
            ) : (
              <p className="text-sm text-muted-foreground text-center py-4">
                No tasks with assignees yet
              </p>
            )}
          </div>
        </div>
      )}

      {/* Completion Trends */}
      {showTrends && (
        <div className="bg-card border border-border rounded-lg p-4 shadow-sm">
          <h4 className="font-medium text-foreground mb-4 flex items-center gap-2">
            <CalendarClock className="h-4 w-4" />
            Completion Trends
          </h4>
          <div className="flex items-center justify-between">
            <div className="space-y-1">
              <p className="text-2xl font-bold text-foreground">{stats.completedThisWeek}</p>
              <p className="text-sm text-muted-foreground">tasks completed this week</p>
            </div>
            <TrendIndicator
              trend={stats.completionTrend}
              thisWeek={stats.completedThisWeek}
              lastWeek={stats.completedLastWeek}
            />
          </div>

          {/* Weekly comparison bar */}
          <div className="mt-4 grid grid-cols-2 gap-4">
            <div>
              <p className="text-xs text-muted-foreground mb-1">This Week</p>
              <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
                <div
                  className="h-full bg-green-500 rounded-full transition-all"
                  style={{
                    width: `${Math.min(100, (stats.completedThisWeek / Math.max(stats.completedThisWeek, stats.completedLastWeek, 1)) * 100)}%`,
                  }}
                />
              </div>
              <p className="text-sm font-medium mt-1">{stats.completedThisWeek} completed</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground mb-1">Last Week</p>
              <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
                <div
                  className="h-full bg-purple-500 rounded-full transition-all"
                  style={{
                    width: `${Math.min(100, (stats.completedLastWeek / Math.max(stats.completedThisWeek, stats.completedLastWeek, 1)) * 100)}%`,
                  }}
                />
              </div>
              <p className="text-sm font-medium mt-1">{stats.completedLastWeek} completed</p>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

export default TaskOverviewWidget
