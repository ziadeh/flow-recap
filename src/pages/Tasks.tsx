/**
 * Tasks Page
 *
 * Kanban board view for managing tasks across all meetings
 * Includes filtering by status, priority, assignee, tags, and source meeting
 * with search functionality and persisted filter preferences.
 */

import { useState, useEffect, useCallback, useMemo } from 'react'
import { KanbanBoard } from '@/components/kanban'
import type { Task, TaskStatus, Meeting } from '@/types/database'
import { TaskModal } from '@/components/TaskModal'
import { TaskFilterPanel, filterTasks, type TaskFilters } from '@/components/TaskFilterPanel'
import { useTaskFilterStore } from '@/stores'

// Sample tasks for demonstration (will be replaced with actual data)
const SAMPLE_TASKS: Task[] = [
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
    due_date: new Date(Date.now() - 1 * 24 * 60 * 60 * 1000).toISOString(), // Overdue
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
    completed_at: new Date().toISOString(),
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
    completed_at: new Date().toISOString(),
    created_during_recording: false,
    generation_timestamp: null,
  },
]

export function Tasks() {
  const [tasks, setTasks] = useState<Task[]>([])
  const [meetings, setMeetings] = useState<Meeting[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [isAddModalOpen, setIsAddModalOpen] = useState(false)
  const [selectedTask, setSelectedTask] = useState<Task | null>(null)

  // Get filter state from the persistent store
  const { filters, setFilters, isFiltersVisible } = useTaskFilterStore()

  // Filter tasks based on current filters
  const filteredTasks = useMemo(() => {
    return filterTasks(tasks, filters)
  }, [tasks, filters])

  // Load tasks and meetings on mount
  useEffect(() => {
    const loadData = async () => {
      try {
        // Try to load tasks from database
        if (window.electronAPI?.db?.tasks?.getAll) {
          const dbTasks = await window.electronAPI.db.tasks.getAll()
          if (dbTasks && dbTasks.length > 0) {
            setTasks(dbTasks)
          } else {
            // Use sample tasks for demonstration
            setTasks(SAMPLE_TASKS)
          }
        } else {
          // Fallback to sample tasks
          setTasks(SAMPLE_TASKS)
        }

        // Try to load meetings from database for the source meeting filter
        if (window.electronAPI?.db?.meetings?.getAll) {
          const dbMeetings = await window.electronAPI.db.meetings.getAll()
          setMeetings(dbMeetings || [])
        }
      } catch (error) {
        console.error('Failed to load data:', error)
        // Use sample tasks on error
        setTasks(SAMPLE_TASKS)
      } finally {
        setIsLoading(false)
      }
    }

    loadData()
  }, [])

  // Handle task status change via drag and drop
  const handleTaskStatusChange = useCallback(async (taskId: string, newStatus: TaskStatus) => {
    // Optimistic update
    setTasks((prevTasks) =>
      prevTasks.map((task) =>
        task.id === taskId
          ? {
              ...task,
              status: newStatus,
              updated_at: new Date().toISOString(),
              completed_at: newStatus === 'completed' ? new Date().toISOString() : null,
            }
          : task
      )
    )

    // Try to persist to database
    try {
      if (window.electronAPI?.db?.tasks?.update) {
        await window.electronAPI.db.tasks.update(taskId, {
          status: newStatus,
          completed_at: newStatus === 'completed' ? new Date().toISOString() : null,
        })
      }
    } catch (error) {
      console.error('Failed to update task status:', error)
      // Could revert optimistic update here if needed
    }
  }, [])

  // Handle task click
  const handleTaskClick = useCallback((task: Task) => {
    setSelectedTask(task)
  }, [])

  // Handle add task
  const handleAddTask = useCallback(() => {
    setIsAddModalOpen(true)
  }, [])

  // Handle filter changes
  const handleFiltersChange = useCallback((newFilters: TaskFilters) => {
    setFilters(newFilters)
  }, [setFilters])

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-muted-foreground">Loading tasks...</div>
      </div>
    )
  }

  return (
    <div className="h-full flex flex-col p-4 gap-4">
      {/* Filter Panel */}
      {isFiltersVisible && (
        <TaskFilterPanel
          filters={filters}
          onFiltersChange={handleFiltersChange}
          tasks={tasks}
          meetings={meetings}
          defaultCollapsed={false}
        />
      )}

      {/* Results info when filters are active */}
      {(filters.search || filters.statuses.length > 0 || filters.priorities.length > 0 ||
        filters.assignees.length > 0 || filters.tags.length > 0 || filters.meetingIds.length > 0) && (
        <div className="text-sm text-muted-foreground">
          Showing {filteredTasks.length} of {tasks.length} tasks
        </div>
      )}

      <KanbanBoard
        tasks={filteredTasks}
        onTaskStatusChange={handleTaskStatusChange}
        onTaskClick={handleTaskClick}
        onAddTask={handleAddTask}
        className="flex-1"
      />

      {/* Task Edit Modal */}
      {selectedTask && (
        <TaskModal
          isOpen={!!selectedTask}
          onClose={() => setSelectedTask(null)}
          task={selectedTask}
          onSuccess={(updatedTask) => {
            setTasks((prevTasks) =>
              prevTasks.map((task) =>
                task.id === updatedTask.id ? updatedTask : task
              )
            )
            setSelectedTask(null)
          }}
          onDelete={(taskId) => {
            setTasks((prevTasks) => prevTasks.filter((task) => task.id !== taskId))
            setSelectedTask(null)
          }}
        />
      )}

      {/* Add Task Modal - now functional */}
      {isAddModalOpen && (
        <TaskModal
          isOpen={isAddModalOpen}
          onClose={() => setIsAddModalOpen(false)}
          task={{
            id: '',
            meeting_id: null,
            title: '',
            description: null,
            assignee: null,
            due_date: null,
            priority: 'medium',
            status: 'pending',
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
            completed_at: null,
            created_during_recording: false,
            generation_timestamp: null,
          }}
          onSuccess={async (newTask) => {
            // For new tasks, we need to create them
            try {
              if (window.electronAPI?.db?.tasks?.create) {
                const createdTask = await window.electronAPI.db.tasks.create({
                  title: newTask.title,
                  description: newTask.description,
                  assignee: newTask.assignee,
                  due_date: newTask.due_date,
                  priority: newTask.priority,
                  status: newTask.status,
                  meeting_id: newTask.meeting_id,
                })
                setTasks((prevTasks) => [...prevTasks, createdTask])
              } else {
                // Fallback for demo
                const createdTask = {
                  ...newTask,
                  id: `task-${Date.now()}`,
                  created_at: new Date().toISOString(),
                  updated_at: new Date().toISOString(),
                }
                setTasks((prevTasks) => [...prevTasks, createdTask])
              }
            } catch (error) {
              console.error('Failed to create task:', error)
            }
            setIsAddModalOpen(false)
          }}
        />
      )}
    </div>
  )
}

export default Tasks
