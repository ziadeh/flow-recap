/**
 * Delete Meeting Modal
 *
 * Confirmation dialog for meeting deletion with:
 * - Preview of what will be deleted
 * - Options for soft delete vs permanent delete
 * - Archive option
 * - Export & Delete option (backup before deletion)
 * - Batch deletion support
 */

import { useState, useEffect } from 'react'
import { createPortal } from 'react-dom'
import {
  X,
  AlertTriangle,
  Trash2,
  Archive,
  Clock,
  FileText,
  Mic,
  ListTodo,
  Users,
  HardDrive,
  Loader2,
  CheckCircle2,
  XCircle,
  Download
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { ExportDeleteModal } from './ExportDeleteModal'

// API helper to access the meeting deletion API
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const getMeetingDeletionAPI = () => (window as any).electronAPI.meetingDeletion

// Types matching the backend
interface TaskPreviewByStatus {
  pending: number
  in_progress: number
  completed: number
  cancelled: number
}

interface DeletionPreview {
  meetingId: string
  meetingTitle: string
  recordingsCount: number
  transcriptsCount: number
  notesCount: number
  tasksCount: number
  tasksByStatus: TaskPreviewByStatus
  hasInProgressTasks: boolean
  hasPendingTasks: boolean
  speakersCount: number
  totalFileSizeBytes: number
  filePaths: string[]
  estimatedCleanupTime: number
}

interface DeletionResult {
  success: boolean
  meetingId: string
  deletedRecordings: number
  deletedTranscripts: number
  deletedNotes: number
  deletedTasks: number
  deletedSpeakers: number
  deletedFiles: number
  failedFileDeletions: string[]
  freedSpaceBytes: number
  auditLogId: string
  error?: string
}

type TaskHandlingAction = 'delete' | 'unlink' | 'reassign' | 'cancel'

interface DeletionOptions {
  deleteFiles?: boolean
  deleteTasks?: boolean
  taskHandling?: TaskHandlingAction
  reassignToMeetingId?: string
  autoUnlinkCompleted?: boolean
  softDelete?: boolean
  softDeleteDays?: number
  auditLog?: boolean
  performedBy?: string
}

export interface DeleteMeetingModalProps {
  isOpen: boolean
  onClose: () => void
  meetingId: string | string[] // Single ID or array for batch deletion
  onDeleted?: () => void // Callback after successful deletion
}

type DeletionMode = 'permanent' | 'soft' | 'archive' | 'export'

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B'
  const k = 1024
  const sizes = ['B', 'KB', 'MB', 'GB']
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`
}

export function DeleteMeetingModal({
  isOpen,
  onClose,
  meetingId,
  onDeleted
}: DeleteMeetingModalProps) {
  const [preview, setPreview] = useState<DeletionPreview | null>(null)
  const [batchPreviews, setBatchPreviews] = useState<DeletionPreview[]>([])
  const [loading, setLoading] = useState(true)
  const [deleting, setDeleting] = useState(false)
  const [deletionMode, setDeletionMode] = useState<DeletionMode>('permanent')
  const [deleteTasks, setDeleteTasks] = useState(true)
  const [result, setResult] = useState<DeletionResult | null>(null)
  const [error, setError] = useState<string | null>(null)

  // Export & Delete state
  const [showExportModal, setShowExportModal] = useState(false)

  const isBatch = Array.isArray(meetingId)
  const meetingIds = isBatch ? meetingId : [meetingId]

  // Load preview when modal opens
  useEffect(() => {
    if (!isOpen) {
      // Reset state when modal closes
      setPreview(null)
      setBatchPreviews([])
      setResult(null)
      setError(null)
      setDeleting(false)
      setDeletionMode('permanent')
      setDeleteTasks(true)
      return
    }

    async function loadPreview() {
      setLoading(true)
      setError(null)

      try {
        const api = getMeetingDeletionAPI()
        if (isBatch) {
          const previews: DeletionPreview[] = []
          for (const id of meetingIds) {
            const p = await api.getPreview(id)
            if (p) previews.push(p)
          }
          setBatchPreviews(previews)
        } else {
          const p = await api.getPreview(meetingIds[0])
          setPreview(p)
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load deletion preview')
      } finally {
        setLoading(false)
      }
    }

    loadPreview()
  }, [isOpen, meetingId])

  // Calculate totals for batch deletion
  const totals = isBatch
    ? {
        recordingsCount: batchPreviews.reduce((sum, p) => sum + p.recordingsCount, 0),
        transcriptsCount: batchPreviews.reduce((sum, p) => sum + p.transcriptsCount, 0),
        notesCount: batchPreviews.reduce((sum, p) => sum + p.notesCount, 0),
        tasksCount: batchPreviews.reduce((sum, p) => sum + p.tasksCount, 0),
        speakersCount: batchPreviews.reduce((sum, p) => sum + p.speakersCount, 0),
        totalFileSizeBytes: batchPreviews.reduce((sum, p) => sum + p.totalFileSizeBytes, 0)
      }
    : preview
      ? {
          recordingsCount: preview.recordingsCount,
          transcriptsCount: preview.transcriptsCount,
          notesCount: preview.notesCount,
          tasksCount: preview.tasksCount,
          speakersCount: preview.speakersCount,
          totalFileSizeBytes: preview.totalFileSizeBytes
        }
      : null

  const handleDelete = async () => {
    setDeleting(true)
    setError(null)

    try {
      const options: DeletionOptions = {
        deleteFiles: true,
        deleteTasks,
        softDelete: deletionMode === 'soft',
        softDeleteDays: deletionMode === 'soft' ? 30 : undefined,
        auditLog: true
      }

      const api = getMeetingDeletionAPI()
      if (deletionMode === 'archive') {
        // Archive mode
        if (isBatch) {
          for (const id of meetingIds) {
            const archiveResult = await api.archive(id)
            if (!archiveResult.success) {
              throw new Error(archiveResult.error || `Failed to archive meeting ${id}`)
            }
          }
        } else {
          const archiveResult = await api.archive(meetingIds[0])
          if (!archiveResult.success) {
            throw new Error(archiveResult.error || 'Failed to archive meeting')
          }
        }

        setResult({
          success: true,
          meetingId: meetingIds[0],
          deletedRecordings: 0,
          deletedTranscripts: 0,
          deletedNotes: 0,
          deletedTasks: 0,
          deletedSpeakers: 0,
          deletedFiles: 0,
          failedFileDeletions: [],
          freedSpaceBytes: 0,
          auditLogId: ''
        })
      } else {
        // Delete mode (permanent or soft)
        if (isBatch) {
          const batchResult = await api.deleteBatch(meetingIds, options)
          if (!batchResult.success && batchResult.errors.length > 0) {
            throw new Error(batchResult.errors.join(', '))
          }
          // Use first result for display
          if (batchResult.results.length > 0) {
            setResult({
              ...batchResult.results[0],
              freedSpaceBytes: batchResult.totalFreedSpaceBytes
            })
          }
        } else {
          const deleteResult = await api.deleteMeeting(meetingIds[0], options)
          if (!deleteResult.success) {
            throw new Error(deleteResult.error || 'Failed to delete meeting')
          }
          setResult(deleteResult)
        }
      }

      // Call onDeleted callback immediately after successful deletion
      // The UI should update right away for better UX
      if (onDeleted) {
        onDeleted()
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Deletion failed')
    } finally {
      setDeleting(false)
    }
  }

  const handleClose = () => {
    if (!deleting) {
      onClose()
    }
  }

  if (!isOpen) return null

  const modalContent = (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 animate-in fade-in duration-200"
      onClick={(e) => e.target === e.currentTarget && handleClose()}
      role="dialog"
      aria-modal="true"
      aria-labelledby="delete-modal-title"
    >
      <div className="w-full max-w-lg bg-card border border-border rounded-lg shadow-xl animate-in zoom-in-95 duration-200">
        {/* Header */}
        <div className="flex items-center justify-between p-6 border-b border-border">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-red-100 dark:bg-red-900/30 rounded-lg">
              <AlertTriangle className="h-5 w-5 text-red-600 dark:text-red-400" />
            </div>
            <h2 id="delete-modal-title" className="text-xl font-semibold text-foreground">
              {isBatch ? `Delete ${meetingIds.length} Meetings` : 'Delete Meeting'}
            </h2>
          </div>
          <button
            onClick={handleClose}
            disabled={deleting}
            className="text-muted-foreground hover:text-foreground transition-colors disabled:opacity-50"
            aria-label="Close modal"
          >
            <X size={20} />
          </button>
        </div>

        {/* Content */}
        <div className="p-6 space-y-4">
          {loading ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
            </div>
          ) : error && !result ? (
            <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg p-4">
              <div className="flex items-start gap-3">
                <XCircle className="h-5 w-5 text-red-600 dark:text-red-400 mt-0.5" />
                <div>
                  <p className="font-medium text-red-700 dark:text-red-300">Error</p>
                  <p className="text-sm text-red-600 dark:text-red-400">{error}</p>
                </div>
              </div>
            </div>
          ) : result ? (
            // Success state
            <div className="space-y-4">
              <div className="bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded-lg p-4">
                <div className="flex items-start gap-3">
                  <CheckCircle2 className="h-5 w-5 text-green-600 dark:text-green-400 mt-0.5" />
                  <div>
                    <p className="font-medium text-green-700 dark:text-green-300">
                      {deletionMode === 'archive' ? 'Archived Successfully' :
                       deletionMode === 'soft' ? 'Moved to Trash' : 'Deleted Successfully'}
                    </p>
                    <p className="text-sm text-green-600 dark:text-green-400">
                      {deletionMode === 'soft'
                        ? 'The meeting can be restored within 30 days.'
                        : deletionMode === 'archive'
                        ? 'The meeting has been archived and can be restored later.'
                        : `Freed ${formatBytes(result.freedSpaceBytes)} of storage space.`}
                    </p>
                  </div>
                </div>
              </div>

              {result.failedFileDeletions.length > 0 && (
                <div className="bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-lg p-4">
                  <div className="flex items-start gap-3">
                    <AlertTriangle className="h-5 w-5 text-amber-600 dark:text-amber-400 mt-0.5" />
                    <div>
                      <p className="font-medium text-amber-700 dark:text-amber-300">
                        Some files could not be deleted
                      </p>
                      <p className="text-sm text-amber-600 dark:text-amber-400">
                        {result.failedFileDeletions.length} file(s) could not be removed from disk.
                      </p>
                    </div>
                  </div>
                </div>
              )}

              <button
                onClick={handleClose}
                className="w-full py-2 bg-primary text-primary-foreground rounded-lg font-medium hover:bg-primary/90 transition-colors"
              >
                Close
              </button>
            </div>
          ) : (
            // Preview state
            <>
              {/* Meeting title */}
              {!isBatch && preview && (
                <div className="bg-muted/50 rounded-lg p-3">
                  <p className="text-sm text-muted-foreground">Meeting</p>
                  <p className="font-medium text-foreground">{preview.meetingTitle}</p>
                </div>
              )}

              {/* Warning message */}
              <div className="bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-lg p-4">
                <p className="text-sm text-amber-700 dark:text-amber-300">
                  This action will remove all associated data including recordings, transcripts, notes, and tasks.
                  {deletionMode === 'permanent' && ' This cannot be undone.'}
                </p>
              </div>

              {/* Data summary */}
              {totals && (
                <div className="grid grid-cols-2 gap-3">
                  <DataItem icon={Mic} label="Recordings" value={totals.recordingsCount} />
                  <DataItem icon={FileText} label="Transcript segments" value={totals.transcriptsCount} />
                  <DataItem icon={FileText} label="Notes" value={totals.notesCount} />
                  <DataItem icon={ListTodo} label="Tasks" value={totals.tasksCount} />
                  <DataItem icon={Users} label="Speakers" value={totals.speakersCount} />
                  <DataItem icon={HardDrive} label="Storage" value={formatBytes(totals.totalFileSizeBytes)} />
                </div>
              )}

              {/* Deletion mode selection */}
              <div className="space-y-2">
                <label className="text-sm font-medium text-foreground">Deletion Mode</label>
                <div className="grid grid-cols-2 gap-2">
                  <ModeButton
                    icon={Trash2}
                    label="Permanent"
                    description="Delete forever"
                    active={deletionMode === 'permanent'}
                    onClick={() => setDeletionMode('permanent')}
                    variant="danger"
                  />
                  <ModeButton
                    icon={Clock}
                    label="Soft Delete"
                    description="Restore within 30 days"
                    active={deletionMode === 'soft'}
                    onClick={() => setDeletionMode('soft')}
                    variant="warning"
                  />
                  <ModeButton
                    icon={Archive}
                    label="Archive"
                    description="Keep data, hide meeting"
                    active={deletionMode === 'archive'}
                    onClick={() => setDeletionMode('archive')}
                    variant="default"
                  />
                  {!isBatch && (
                    <ModeButton
                      icon={Download}
                      label="Export & Delete"
                      description="Backup before deletion"
                      active={deletionMode === 'export'}
                      onClick={() => setDeletionMode('export')}
                      variant="primary"
                    />
                  )}
                </div>
              </div>

              {/* Options */}
              {deletionMode !== 'archive' && totals && totals.tasksCount > 0 && (
                <label className="flex items-center gap-3 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={deleteTasks}
                    onChange={(e) => setDeleteTasks(e.target.checked)}
                    className="w-4 h-4 rounded border-border text-primary focus:ring-primary"
                  />
                  <span className="text-sm text-foreground">
                    Also delete {totals.tasksCount} associated task{totals.tasksCount > 1 ? 's' : ''}
                  </span>
                </label>
              )}

              {/* Actions */}
              <div className="flex gap-3 pt-2">
                <button
                  onClick={handleClose}
                  disabled={deleting}
                  className="flex-1 py-2 bg-secondary text-secondary-foreground rounded-lg font-medium hover:bg-secondary/80 transition-colors disabled:opacity-50"
                >
                  Cancel
                </button>
                <button
                  onClick={deletionMode === 'export' ? () => setShowExportModal(true) : handleDelete}
                  disabled={deleting}
                  className={cn(
                    'flex-1 py-2 rounded-lg font-medium transition-colors disabled:opacity-50 flex items-center justify-center gap-2',
                    deletionMode === 'permanent'
                      ? 'bg-red-600 text-white hover:bg-red-700'
                      : deletionMode === 'soft'
                      ? 'bg-amber-600 text-white hover:bg-amber-700'
                      : deletionMode === 'export'
                      ? 'bg-blue-600 text-white hover:bg-blue-700'
                      : 'bg-primary text-primary-foreground hover:bg-primary/90'
                  )}
                >
                  {deleting ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin" />
                      {deletionMode === 'archive' ? 'Archiving...' : 'Deleting...'}
                    </>
                  ) : (
                    <>
                      {deletionMode === 'permanent' && <Trash2 className="h-4 w-4" />}
                      {deletionMode === 'soft' && <Clock className="h-4 w-4" />}
                      {deletionMode === 'archive' && <Archive className="h-4 w-4" />}
                      {deletionMode === 'export' && <Download className="h-4 w-4" />}
                      {deletionMode === 'permanent' && 'Delete Permanently'}
                      {deletionMode === 'soft' && 'Move to Trash'}
                      {deletionMode === 'archive' && 'Archive Meeting'}
                      {deletionMode === 'export' && 'Export & Delete'}
                    </>
                  )}
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  )

  return (
    <>
      {createPortal(modalContent, document.body)}

      {/* Export & Delete Modal */}
      {!isBatch && (
        <ExportDeleteModal
          isOpen={showExportModal}
          onClose={() => {
            setShowExportModal(false)
          }}
          meetingId={meetingIds[0]}
          meetingTitle={preview?.meetingTitle}
          showDeleteOption={true}
          defaultArchiveMode={true}
          onSuccess={() => {
            setShowExportModal(false)
            onClose()
            if (onDeleted) {
              onDeleted()
            }
          }}
        />
      )}
    </>
  )
}

// Helper component for data items
function DataItem({
  icon: Icon,
  label,
  value
}: {
  icon: React.ComponentType<{ className?: string }>
  label: string
  value: number | string
}) {
  return (
    <div className="flex items-center gap-2 p-2 bg-muted/50 rounded-lg">
      <Icon className="h-4 w-4 text-muted-foreground" />
      <div>
        <p className="text-xs text-muted-foreground">{label}</p>
        <p className="text-sm font-medium text-foreground">{value}</p>
      </div>
    </div>
  )
}

// Helper component for mode buttons
function ModeButton({
  icon: Icon,
  label,
  description,
  active,
  onClick,
  variant
}: {
  icon: React.ComponentType<{ className?: string }>
  label: string
  description: string
  active: boolean
  onClick: () => void
  variant: 'danger' | 'warning' | 'default' | 'primary'
}) {
  const baseClasses = 'p-3 rounded-lg border-2 transition-all cursor-pointer text-left'
  const variantClasses = {
    danger: active
      ? 'border-red-500 bg-red-50 dark:bg-red-900/20'
      : 'border-border hover:border-red-300 dark:hover:border-red-700',
    warning: active
      ? 'border-amber-500 bg-amber-50 dark:bg-amber-900/20'
      : 'border-border hover:border-amber-300 dark:hover:border-amber-700',
    default: active
      ? 'border-primary bg-primary/10'
      : 'border-border hover:border-primary/50',
    primary: active
      ? 'border-blue-500 bg-blue-50 dark:bg-blue-900/20'
      : 'border-border hover:border-blue-300 dark:hover:border-blue-700'
  }

  return (
    <button
      onClick={onClick}
      className={cn(baseClasses, variantClasses[variant])}
    >
      <Icon className={cn(
        'h-4 w-4 mb-1',
        active
          ? variant === 'danger'
            ? 'text-red-600 dark:text-red-400'
            : variant === 'warning'
            ? 'text-amber-600 dark:text-amber-400'
            : variant === 'primary'
            ? 'text-blue-600 dark:text-blue-400'
            : 'text-primary'
          : 'text-muted-foreground'
      )} />
      <p className={cn(
        'text-xs font-medium',
        active ? 'text-foreground' : 'text-muted-foreground'
      )}>
        {label}
      </p>
      <p className="text-xs text-muted-foreground leading-tight mt-0.5">
        {description}
      </p>
    </button>
  )
}

export default DeleteMeetingModal
