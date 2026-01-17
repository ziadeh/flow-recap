import React, { useState, useEffect, useRef } from 'react'
import { Modal } from '../Modal'
import { Loader2, AlertCircle, Sparkles, Save, Trash2 } from 'lucide-react'
import type { MeetingNote, NoteType, UpdateMeetingNoteInput } from '../../types/database'

interface NotesEditorProps {
  isOpen: boolean
  onClose: () => void
  note: MeetingNote | null
  onSuccess?: () => void
  onDelete?: (noteId: string) => void
}

interface FormData {
  content: string
  noteType: NoteType
}

interface FormErrors {
  content?: string
  noteType?: string
}

const noteTypeOptions: { value: NoteType; label: string }[] = [
  { value: 'summary', label: 'Summary' },
  { value: 'key_point', label: 'Key Point' },
  { value: 'action_item', label: 'Action Item' },
  { value: 'decision', label: 'Decision' },
  { value: 'custom', label: 'Custom Note' },
]

export function NotesEditor({ isOpen, onClose, note, onSuccess, onDelete }: NotesEditorProps) {
  const contentRef = useRef<HTMLTextAreaElement>(null)

  const [formData, setFormData] = useState<FormData>({
    content: '',
    noteType: 'custom',
  })

  const [errors, setErrors] = useState<FormErrors>({})
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [isDeleting, setIsDeleting] = useState(false)
  const [submitError, setSubmitError] = useState<string | null>(null)
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false)

  // Update form data when note changes
  useEffect(() => {
    if (isOpen && note) {
      setFormData({
        content: note.content,
        noteType: note.note_type,
      })
      setErrors({})
      setSubmitError(null)
      setHasUnsavedChanges(false)
    }
  }, [note, isOpen])

  // Auto-focus content textarea when modal opens
  useEffect(() => {
    if (isOpen && contentRef.current) {
      setTimeout(() => contentRef.current?.focus(), 100)
    }
  }, [isOpen])

  // Track unsaved changes
  useEffect(() => {
    if (note) {
      const hasChanges =
        formData.content !== note.content ||
        formData.noteType !== note.note_type
      setHasUnsavedChanges(hasChanges)
    }
  }, [formData, note])

  const validateForm = (): boolean => {
    const newErrors: FormErrors = {}

    // Validate content
    if (!formData.content.trim()) {
      newErrors.content = 'Content is required'
    } else if (formData.content.length > 10000) {
      newErrors.content = 'Content must be 10,000 characters or less'
    }

    setErrors(newErrors)
    return Object.keys(newErrors).length === 0
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setSubmitError(null)

    if (!validateForm() || !note) {
      return
    }

    setIsSubmitting(true)

    try {
      const input: UpdateMeetingNoteInput = {
        content: formData.content.trim(),
        note_type: formData.noteType,
      }

      await window.electronAPI.db.meetingNotes.update(note.id, input)

      // Call success callback if provided
      if (onSuccess) {
        onSuccess()
      }

      // Close modal
      onClose()
    } catch (error) {
      console.error('Failed to update note:', error)
      setSubmitError(
        error instanceof Error
          ? error.message
          : 'Failed to update note. Please try again.'
      )
    } finally {
      setIsSubmitting(false)
    }
  }

  const handleDelete = async () => {
    if (!note || !onDelete) return

    // Confirm deletion
    const confirmed = window.confirm(
      'Are you sure you want to delete this note? This action cannot be undone.'
    )

    if (!confirmed) return

    setIsDeleting(true)
    setSubmitError(null)

    try {
      await window.electronAPI.db.meetingNotes.delete(note.id)

      // Call delete callback
      onDelete(note.id)

      // Call success callback if provided
      if (onSuccess) {
        onSuccess()
      }

      // Close modal
      onClose()
    } catch (error) {
      console.error('Failed to delete note:', error)
      setSubmitError(
        error instanceof Error
          ? error.message
          : 'Failed to delete note. Please try again.'
      )
    } finally {
      setIsDeleting(false)
    }
  }

  const handleInputChange = (
    e: React.ChangeEvent<HTMLTextAreaElement | HTMLSelectElement>
  ) => {
    const { name, value } = e.target
    setFormData(prev => ({ ...prev, [name]: value }))

    // Clear error for this field when user starts typing
    if (errors[name as keyof FormErrors]) {
      setErrors(prev => ({ ...prev, [name]: undefined }))
    }
  }

  const handleClose = () => {
    if (hasUnsavedChanges) {
      const confirmed = window.confirm(
        'You have unsaved changes. Are you sure you want to close without saving?'
      )
      if (!confirmed) return
    }
    onClose()
  }

  if (!note) return null

  return (
    <Modal isOpen={isOpen} onClose={handleClose} title="Edit Note" size="lg">
      <form onSubmit={handleSubmit} className="space-y-5">
        {/* AI Generated Badge */}
        {note.is_ai_generated && (
          <div className="flex items-center gap-2 p-3 bg-purple-50 border border-purple-200 rounded-md">
            <Sparkles className="w-4 h-4 text-purple-600" />
            <span className="text-sm text-purple-700">
              This note was AI-generated. You can refine and customize it below.
            </span>
          </div>
        )}

        {/* Global error message */}
        {submitError && (
          <div className="flex items-start gap-2 p-3 bg-red-50 border border-red-200 rounded-md">
            <AlertCircle className="text-red-600 mt-0.5 flex-shrink-0" size={18} />
            <p className="text-sm text-red-600">{submitError}</p>
          </div>
        )}

        {/* Note Type field */}
        <div>
          <label htmlFor="noteType" className="block text-sm font-medium text-foreground mb-1.5">
            Note Type
          </label>
          <select
            id="noteType"
            name="noteType"
            value={formData.noteType}
            onChange={handleInputChange}
            className="w-full px-3 py-2 bg-background border border-border rounded-md text-foreground focus:outline-none focus:ring-2 focus:ring-purple-600"
            disabled={isSubmitting || isDeleting}
          >
            {noteTypeOptions.map(option => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </div>

        {/* Content field */}
        <div>
          <label htmlFor="content" className="block text-sm font-medium text-foreground mb-1.5">
            Content <span className="text-red-600">*</span>
          </label>
          <textarea
            ref={contentRef}
            id="content"
            name="content"
            value={formData.content}
            onChange={handleInputChange}
            rows={12}
            className={`w-full px-3 py-2 bg-background border rounded-md text-foreground placeholder-muted-foreground focus:outline-none focus:ring-2 focus:ring-purple-600 resize-none ${
              errors.content ? 'border-red-500' : 'border-border'
            }`}
            placeholder="Enter note content..."
            maxLength={10000}
            disabled={isSubmitting || isDeleting}
            aria-describedby={errors.content ? 'content-error' : undefined}
          />
          {errors.content && (
            <p id="content-error" className="mt-1 text-sm text-red-600">
              {errors.content}
            </p>
          )}
          <p className="mt-1 text-xs text-muted-foreground">
            {formData.content.length}/10,000 characters
          </p>
        </div>

        {/* Form actions */}
        <div className="flex items-center justify-between pt-4 border-t border-border">
          {/* Delete button */}
          <div>
            {onDelete && (
              <button
                type="button"
                onClick={handleDelete}
                disabled={isSubmitting || isDeleting}
                className="px-4 py-2 text-sm font-medium text-red-600 bg-red-50 border border-red-200 rounded-md hover:bg-red-100 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
              >
                {isDeleting && <Loader2 size={16} className="animate-spin" />}
                <Trash2 size={16} />
                {isDeleting ? 'Deleting...' : 'Delete Note'}
              </button>
            )}
          </div>

          {/* Save/Cancel buttons */}
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={handleClose}
              disabled={isSubmitting || isDeleting}
              className="px-4 py-2 text-sm font-medium text-foreground bg-background border border-border rounded-md hover:bg-muted transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isSubmitting || isDeleting || !hasUnsavedChanges}
              className="px-4 py-2 text-sm font-medium text-white bg-purple-600 rounded-md hover:bg-purple-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
            >
              {isSubmitting && <Loader2 size={16} className="animate-spin" />}
              <Save size={16} />
              {isSubmitting ? 'Saving...' : 'Save Changes'}
            </button>
          </div>
        </div>
      </form>
    </Modal>
  )
}

export default NotesEditor
