/**
 * TaskModal Component
 *
 * A modal for editing task details including:
 * - Title, description, assignee
 * - Priority, due date, status
 * - Tags (stored as comma-separated string for now)
 * - Link to source meeting
 * - Delete task option
 */

import React, { useState, useEffect, useRef } from 'react'
import { Modal } from './Modal'
import {
  Loader2,
  AlertCircle,
  Trash2,
  Calendar,
  User,
  Tag,
  Link,
  AlertTriangle,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import type {
  Task,
  TaskPriority,
  TaskStatus,
  UpdateTaskInput,
  Meeting,
} from '@/types/database'

export interface TaskModalProps {
  isOpen: boolean
  onClose: () => void
  task: Task
  /** Optional callback when task is successfully updated */
  onSuccess?: (updatedTask: Task) => void
  /** Optional callback when task is deleted */
  onDelete?: (taskId: string) => void
  /** Optional tags for the task (passed from parent) */
  tags?: string[]
  /** Optional callback when tags change */
  onTagsChange?: (taskId: string, tags: string[]) => void
}

// Priority options
const priorityOptions: { value: TaskPriority; label: string; color: string }[] = [
  { value: 'low', label: 'Low', color: 'gray' },
  { value: 'medium', label: 'Medium', color: 'yellow' },
  { value: 'high', label: 'High', color: 'orange' },
  { value: 'urgent', label: 'Urgent', color: 'red' },
]

// Status options
const statusOptions: { value: TaskStatus; label: string }[] = [
  { value: 'pending', label: 'Pending' },
  { value: 'in_progress', label: 'In Progress' },
  { value: 'completed', label: 'Completed' },
  { value: 'cancelled', label: 'Cancelled' },
]

interface FormData {
  title: string
  description: string
  assignee: string
  priority: TaskPriority
  status: TaskStatus
  dueDate: string
  meetingId: string
  tags: string
}

interface FormErrors {
  title?: string
  description?: string
  dueDate?: string
}

// Helper to format ISO date string to date input format
function formatToDateInput(isoString: string | null): string {
  if (!isoString) return ''
  const date = new Date(isoString)
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

// Helper to format date input to ISO string
function formatToISODate(dateString: string): string | null {
  if (!dateString) return null
  const date = new Date(dateString + 'T00:00:00')
  return date.toISOString()
}

export function TaskModal({
  isOpen,
  onClose,
  task,
  onSuccess,
  onDelete,
  tags = [],
  onTagsChange,
}: TaskModalProps) {
  const titleInputRef = useRef<HTMLInputElement>(null)

  const [formData, setFormData] = useState<FormData>({
    title: task.title,
    description: task.description || '',
    assignee: task.assignee || '',
    priority: task.priority,
    status: task.status,
    dueDate: formatToDateInput(task.due_date),
    meetingId: task.meeting_id || '',
    tags: tags.join(', '),
  })

  const [errors, setErrors] = useState<FormErrors>({})
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [isDeleting, setIsDeleting] = useState(false)
  const [submitError, setSubmitError] = useState<string | null>(null)
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)
  const [meetings, setMeetings] = useState<Meeting[]>([])
  const [linkedMeeting, setLinkedMeeting] = useState<Meeting | null>(null)

  // Load meetings for the dropdown
  useEffect(() => {
    const loadMeetings = async () => {
      try {
        if (window.electronAPI?.db?.meetings?.getAll) {
          const allMeetings = await window.electronAPI.db.meetings.getAll()
          setMeetings(allMeetings)
        }
      } catch (error) {
        console.error('Failed to load meetings:', error)
      }
    }

    if (isOpen) {
      loadMeetings()
    }
  }, [isOpen])

  // Load linked meeting details
  useEffect(() => {
    const loadLinkedMeeting = async () => {
      if (task.meeting_id && window.electronAPI?.db?.meetings?.getById) {
        try {
          const meeting = await window.electronAPI.db.meetings.getById(task.meeting_id)
          setLinkedMeeting(meeting)
        } catch (error) {
          console.error('Failed to load linked meeting:', error)
        }
      } else {
        setLinkedMeeting(null)
      }
    }

    if (isOpen) {
      loadLinkedMeeting()
    }
  }, [isOpen, task.meeting_id])

  // Update form data when task changes
  useEffect(() => {
    if (isOpen) {
      setFormData({
        title: task.title,
        description: task.description || '',
        assignee: task.assignee || '',
        priority: task.priority,
        status: task.status,
        dueDate: formatToDateInput(task.due_date),
        meetingId: task.meeting_id || '',
        tags: tags.join(', '),
      })
      setErrors({})
      setSubmitError(null)
      setShowDeleteConfirm(false)
    }
  }, [task, tags, isOpen])

  // Auto-focus title input when modal opens
  useEffect(() => {
    if (isOpen && titleInputRef.current) {
      setTimeout(() => titleInputRef.current?.focus(), 100)
    }
  }, [isOpen])

  const validateForm = (): boolean => {
    const newErrors: FormErrors = {}

    // Validate title
    if (!formData.title.trim()) {
      newErrors.title = 'Title is required'
    } else if (formData.title.length > 200) {
      newErrors.title = 'Title must be 200 characters or less'
    }

    // Validate description
    if (formData.description.length > 2000) {
      newErrors.description = 'Description must be 2000 characters or less'
    }

    // Validate due date
    if (formData.dueDate) {
      const dueDate = new Date(formData.dueDate)
      if (isNaN(dueDate.getTime())) {
        newErrors.dueDate = 'Invalid date format'
      }
    }

    setErrors(newErrors)
    return Object.keys(newErrors).length === 0
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setSubmitError(null)

    if (!validateForm()) {
      return
    }

    setIsSubmitting(true)

    try {
      const input: UpdateTaskInput = {
        title: formData.title.trim(),
        description: formData.description.trim() || null,
        assignee: formData.assignee.trim() || null,
        priority: formData.priority,
        status: formData.status,
        due_date: formatToISODate(formData.dueDate),
        meeting_id: formData.meetingId || null,
        completed_at:
          formData.status === 'completed' && task.status !== 'completed'
            ? new Date().toISOString()
            : formData.status !== 'completed'
            ? null
            : task.completed_at,
      }

      let updatedTask: Task | null = null

      if (window.electronAPI?.db?.tasks?.update) {
        updatedTask = await window.electronAPI.db.tasks.update(task.id, input)
      } else {
        // For demo/testing, create updated task locally
        updatedTask = {
          ...task,
          ...input,
          updated_at: new Date().toISOString(),
        } as Task
      }

      // Handle tags change
      if (onTagsChange) {
        const newTags = formData.tags
          .split(',')
          .map((t) => t.trim())
          .filter((t) => t.length > 0)
        onTagsChange(task.id, newTags)
      }

      // Call success callback if provided
      if (onSuccess && updatedTask) {
        onSuccess(updatedTask)
      }

      // Close modal
      onClose()
    } catch (error) {
      console.error('Failed to update task:', error)
      setSubmitError(
        error instanceof Error
          ? error.message
          : 'Failed to update task. Please try again.'
      )
    } finally {
      setIsSubmitting(false)
    }
  }

  const handleDelete = async () => {
    if (!showDeleteConfirm) {
      setShowDeleteConfirm(true)
      return
    }

    setIsDeleting(true)
    setSubmitError(null)

    try {
      if (window.electronAPI?.db?.tasks?.delete) {
        await window.electronAPI.db.tasks.delete(task.id)
      }

      // Call delete callback if provided
      if (onDelete) {
        onDelete(task.id)
      }

      // Close modal
      onClose()
    } catch (error) {
      console.error('Failed to delete task:', error)
      setSubmitError(
        error instanceof Error
          ? error.message
          : 'Failed to delete task. Please try again.'
      )
    } finally {
      setIsDeleting(false)
      setShowDeleteConfirm(false)
    }
  }

  const handleInputChange = (
    e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>
  ) => {
    const { name, value } = e.target
    setFormData((prev) => ({ ...prev, [name]: value }))

    // Clear error for this field when user starts typing
    if (errors[name as keyof FormErrors]) {
      setErrors((prev) => ({ ...prev, [name]: undefined }))
    }
  }

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Edit Task" size="lg">
      <form onSubmit={handleSubmit} className="space-y-5">
        {/* Global error message */}
        {submitError && (
          <div className="flex items-start gap-2 p-3 bg-red-50 border border-red-200 rounded-md">
            <AlertCircle className="text-red-600 mt-0.5 flex-shrink-0" size={18} />
            <p className="text-sm text-red-600">{submitError}</p>
          </div>
        )}

        {/* Title field */}
        <div>
          <label
            htmlFor="title"
            className="block text-sm font-medium text-foreground mb-1.5"
          >
            Title <span className="text-red-600">*</span>
          </label>
          <input
            ref={titleInputRef}
            type="text"
            id="title"
            name="title"
            value={formData.title}
            onChange={handleInputChange}
            className={cn(
              'w-full px-3 py-2 bg-background border rounded-md text-foreground placeholder-muted-foreground focus:outline-none focus:ring-2 focus:ring-purple-600',
              errors.title ? 'border-red-500' : 'border-border'
            )}
            placeholder="Enter task title"
            maxLength={200}
            disabled={isSubmitting || isDeleting}
            aria-describedby={errors.title ? 'title-error' : undefined}
          />
          {errors.title && (
            <p id="title-error" className="mt-1 text-sm text-red-600">
              {errors.title}
            </p>
          )}
          <p className="mt-1 text-xs text-muted-foreground">
            {formData.title.length}/200 characters
          </p>
        </div>

        {/* Description field */}
        <div>
          <label
            htmlFor="description"
            className="block text-sm font-medium text-foreground mb-1.5"
          >
            Description
          </label>
          <textarea
            id="description"
            name="description"
            value={formData.description}
            onChange={handleInputChange}
            rows={3}
            className={cn(
              'w-full px-3 py-2 bg-background border rounded-md text-foreground placeholder-muted-foreground focus:outline-none focus:ring-2 focus:ring-purple-600 resize-none',
              errors.description ? 'border-red-500' : 'border-border'
            )}
            placeholder="Enter task description (optional)"
            maxLength={2000}
            disabled={isSubmitting || isDeleting}
            aria-describedby={errors.description ? 'description-error' : undefined}
          />
          {errors.description && (
            <p id="description-error" className="mt-1 text-sm text-red-600">
              {errors.description}
            </p>
          )}
          <p className="mt-1 text-xs text-muted-foreground">
            {formData.description.length}/2000 characters
          </p>
        </div>

        {/* Two-column layout for status and priority */}
        <div className="grid grid-cols-2 gap-4">
          {/* Status field */}
          <div>
            <label
              htmlFor="status"
              className="block text-sm font-medium text-foreground mb-1.5"
            >
              Status
            </label>
            <select
              id="status"
              name="status"
              value={formData.status}
              onChange={handleInputChange}
              className="w-full px-3 py-2 bg-background border border-border rounded-md text-foreground focus:outline-none focus:ring-2 focus:ring-purple-600"
              disabled={isSubmitting || isDeleting}
            >
              {statusOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </div>

          {/* Priority field */}
          <div>
            <label
              htmlFor="priority"
              className="block text-sm font-medium text-foreground mb-1.5"
            >
              Priority
            </label>
            <select
              id="priority"
              name="priority"
              value={formData.priority}
              onChange={handleInputChange}
              className="w-full px-3 py-2 bg-background border border-border rounded-md text-foreground focus:outline-none focus:ring-2 focus:ring-purple-600"
              disabled={isSubmitting || isDeleting}
            >
              {priorityOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </div>
        </div>

        {/* Two-column layout for assignee and due date */}
        <div className="grid grid-cols-2 gap-4">
          {/* Assignee field */}
          <div>
            <label
              htmlFor="assignee"
              className="block text-sm font-medium text-foreground mb-1.5"
            >
              <span className="flex items-center gap-1">
                <User className="w-4 h-4" />
                Assignee
              </span>
            </label>
            <input
              type="text"
              id="assignee"
              name="assignee"
              value={formData.assignee}
              onChange={handleInputChange}
              className="w-full px-3 py-2 bg-background border border-border rounded-md text-foreground placeholder-muted-foreground focus:outline-none focus:ring-2 focus:ring-purple-600"
              placeholder="Enter assignee name"
              disabled={isSubmitting || isDeleting}
            />
          </div>

          {/* Due date field */}
          <div>
            <label
              htmlFor="dueDate"
              className="block text-sm font-medium text-foreground mb-1.5"
            >
              <span className="flex items-center gap-1">
                <Calendar className="w-4 h-4" />
                Due Date
              </span>
            </label>
            <input
              type="date"
              id="dueDate"
              name="dueDate"
              value={formData.dueDate}
              onChange={handleInputChange}
              className={cn(
                'w-full px-3 py-2 bg-background border rounded-md text-foreground focus:outline-none focus:ring-2 focus:ring-purple-600',
                errors.dueDate ? 'border-red-500' : 'border-border'
              )}
              disabled={isSubmitting || isDeleting}
              aria-describedby={errors.dueDate ? 'dueDate-error' : undefined}
            />
            {errors.dueDate && (
              <p id="dueDate-error" className="mt-1 text-sm text-red-600">
                {errors.dueDate}
              </p>
            )}
          </div>
        </div>

        {/* Tags field */}
        <div>
          <label
            htmlFor="tags"
            className="block text-sm font-medium text-foreground mb-1.5"
          >
            <span className="flex items-center gap-1">
              <Tag className="w-4 h-4" />
              Tags
            </span>
          </label>
          <input
            type="text"
            id="tags"
            name="tags"
            value={formData.tags}
            onChange={handleInputChange}
            className="w-full px-3 py-2 bg-background border border-border rounded-md text-foreground placeholder-muted-foreground focus:outline-none focus:ring-2 focus:ring-purple-600"
            placeholder="Enter tags separated by commas (e.g., urgent, feature, bug)"
            disabled={isSubmitting || isDeleting}
          />
          <p className="mt-1 text-xs text-muted-foreground">
            Separate multiple tags with commas
          </p>
        </div>

        {/* Source Meeting field */}
        <div>
          <label
            htmlFor="meetingId"
            className="block text-sm font-medium text-foreground mb-1.5"
          >
            <span className="flex items-center gap-1">
              <Link className="w-4 h-4" />
              Source Meeting
            </span>
          </label>
          <select
            id="meetingId"
            name="meetingId"
            value={formData.meetingId}
            onChange={handleInputChange}
            className="w-full px-3 py-2 bg-background border border-border rounded-md text-foreground focus:outline-none focus:ring-2 focus:ring-purple-600"
            disabled={isSubmitting || isDeleting}
          >
            <option value="">No linked meeting</option>
            {meetings.map((meeting) => (
              <option key={meeting.id} value={meeting.id}>
                {meeting.title} - {new Date(meeting.start_time).toLocaleDateString()}
              </option>
            ))}
          </select>
          {linkedMeeting && formData.meetingId === task.meeting_id && (
            <p className="mt-1 text-xs text-muted-foreground">
              Currently linked to: {linkedMeeting.title}
            </p>
          )}
        </div>

        {/* Delete confirmation */}
        {showDeleteConfirm && (
          <div className="flex items-start gap-2 p-3 bg-red-50 border border-red-200 rounded-md">
            <AlertTriangle className="text-red-600 mt-0.5 flex-shrink-0" size={18} />
            <div className="flex-1">
              <p className="text-sm font-medium text-red-700">Delete this task?</p>
              <p className="text-xs text-red-600 mt-1">
                This action cannot be undone. The task will be permanently deleted.
              </p>
            </div>
          </div>
        )}

        {/* Form actions */}
        <div className="flex items-center justify-between pt-4 border-t border-border">
          {/* Delete button */}
          <button
            type="button"
            onClick={handleDelete}
            disabled={isSubmitting || isDeleting}
            className={cn(
              'px-4 py-2 text-sm font-medium rounded-md transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2',
              showDeleteConfirm
                ? 'text-white bg-red-600 hover:bg-red-700'
                : 'text-red-600 bg-red-50 hover:bg-red-100 border border-red-200'
            )}
          >
            {isDeleting && <Loader2 size={16} className="animate-spin" />}
            <Trash2 size={16} />
            {showDeleteConfirm ? 'Confirm Delete' : 'Delete Task'}
          </button>

          <div className="flex items-center gap-3">
            {showDeleteConfirm && (
              <button
                type="button"
                onClick={() => setShowDeleteConfirm(false)}
                disabled={isDeleting}
                className="px-4 py-2 text-sm font-medium text-foreground bg-background border border-border rounded-md hover:bg-muted transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Cancel Delete
              </button>
            )}
            <button
              type="button"
              onClick={onClose}
              disabled={isSubmitting || isDeleting}
              className="px-4 py-2 text-sm font-medium text-foreground bg-background border border-border rounded-md hover:bg-muted transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isSubmitting || isDeleting || showDeleteConfirm}
              className="px-4 py-2 text-sm font-medium text-white bg-purple-600 rounded-md hover:bg-purple-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
            >
              {isSubmitting && <Loader2 size={16} className="animate-spin" />}
              {isSubmitting ? 'Saving...' : 'Save Changes'}
            </button>
          </div>
        </div>
      </form>
    </Modal>
  )
}

export default TaskModal
