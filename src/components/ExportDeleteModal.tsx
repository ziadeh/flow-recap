/**
 * Export & Delete Modal
 *
 * A comprehensive modal that allows users to:
 * - Export meeting data in various formats (JSON, PDF, Audio ZIP, Full backup)
 * - Use export templates (Meeting Minutes, Full Transcript, Action Items Only)
 * - Export and then delete meetings ("Archive to Disk")
 * - Import previously exported meetings
 * - View export progress with estimated file size
 */

import { useState, useEffect, useCallback } from 'react'
import { createPortal } from 'react-dom'
import {
  X,
  Download,
  Upload,
  Archive,
  FileJson,
  FileText,
  Music,
  FolderArchive,
  Clock,
  ListTodo,
  FileCheck,
  Loader2,
  CheckCircle2,
  XCircle,
  HardDrive,
  FileText as FileTextIcon,
  ChevronDown,
  ChevronUp,
  Info
} from 'lucide-react'
import { cn } from '@/lib/utils'

// API helper
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const getExportDeleteAPI = () => (window as any).electronAPI.exportDelete

// Types
type ExportArchiveFormat = 'json' | 'pdf' | 'audio' | 'full'
type ExportTemplate = 'meeting_minutes' | 'full_transcript' | 'action_items_only' | 'custom'

interface ExportPreview {
  meetingId: string
  meetingTitle: string
  estimatedSizeBytes: number
  sizeBreakdown: {
    metadata: number
    transcripts: number
    notes: number
    tasks: number
    audioFiles: number
  }
  itemCounts: {
    transcriptSegments: number
    notes: number
    tasks: number
    speakers: number
    audioFiles: number
  }
  audioFilePaths: string[]
  estimatedTimeMs: number
}

interface ExportResult {
  success: boolean
  filePath?: string
  fileSizeBytes?: number
  format: ExportArchiveFormat
  exportedContent: {
    transcriptSegments: number
    notes: number
    tasks: number
    speakers: number
    audioFiles: number
  }
  durationMs: number
  error?: string
}

interface ExportAndDeleteResult {
  exportResult: ExportResult
  deleted: boolean
  deletionResult?: {
    success: boolean
    freedSpaceBytes: number
    error?: string
  }
  success: boolean
}

export interface ExportDeleteModalProps {
  isOpen: boolean
  onClose: () => void
  meetingId: string
  meetingTitle?: string
  /** Called after successful export or export+delete */
  onSuccess?: () => void
  /** Whether to show delete options */
  showDeleteOption?: boolean
  /** Default to export-and-delete mode */
  defaultArchiveMode?: boolean
}

type ModalMode = 'export' | 'archive' | 'import'
type ExportStep = 'options' | 'progress' | 'result'

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B'
  const k = 1024
  const sizes = ['B', 'KB', 'MB', 'GB']
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`
  const seconds = Math.floor(ms / 1000)
  if (seconds < 60) return `${seconds}s`
  const minutes = Math.floor(seconds / 60)
  const remainingSeconds = seconds % 60
  return `${minutes}m ${remainingSeconds}s`
}

export function ExportDeleteModal({
  isOpen,
  onClose,
  meetingId,
  meetingTitle,
  onSuccess,
  showDeleteOption = true,
  defaultArchiveMode = false
}: ExportDeleteModalProps) {
  // State
  const [mode, setMode] = useState<ModalMode>(defaultArchiveMode ? 'archive' : 'export')
  const [step, setStep] = useState<ExportStep>('options')
  const [loading, setLoading] = useState(false)
  const [preview, setPreview] = useState<ExportPreview | null>(null)
  const [error, setError] = useState<string | null>(null)

  // Export options
  const [format, setFormat] = useState<ExportArchiveFormat>('json')
  const [template, setTemplate] = useState<ExportTemplate>('custom')
  const [deleteAfterExport, setDeleteAfterExport] = useState(defaultArchiveMode)
  const [softDelete, setSoftDelete] = useState(false)
  const [showAdvanced, setShowAdvanced] = useState(false)

  // Custom content options
  const [includeTranscript, setIncludeTranscript] = useState(true)
  const [includeNotes, setIncludeNotes] = useState(true)
  const [includeTasks, setIncludeTasks] = useState(true)
  const [includeSpeakers, setIncludeSpeakers] = useState(true)

  // Results
  const [exportResult, setExportResult] = useState<ExportResult | null>(null)
  const [exportAndDeleteResult, setExportAndDeleteResult] = useState<ExportAndDeleteResult | null>(null)
  const [progress, setProgress] = useState(0)

  // Load preview when modal opens
  useEffect(() => {
    if (!isOpen) {
      // Reset state when modal closes
      setStep('options')
      setPreview(null)
      setError(null)
      setExportResult(null)
      setExportAndDeleteResult(null)
      setProgress(0)
      return
    }

    async function loadPreview() {
      setLoading(true)
      setError(null)

      try {
        const api = getExportDeleteAPI()
        const options = {
          format,
          template: template === 'custom' ? undefined : template,
          includeAudio: format === 'audio' || format === 'full'
        }
        const p = await api.getPreview(meetingId, options)
        setPreview(p)
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load export preview')
      } finally {
        setLoading(false)
      }
    }

    loadPreview()
  }, [isOpen, meetingId, format, template])

  // Update preview when format changes
  useEffect(() => {
    if (!isOpen || !meetingId) return

    // Apply template settings
    switch (template) {
      case 'meeting_minutes':
        setIncludeTranscript(false)
        setIncludeNotes(true)
        setIncludeTasks(true)
        setIncludeSpeakers(true)
        break
      case 'full_transcript':
        setIncludeTranscript(true)
        setIncludeNotes(false)
        setIncludeTasks(false)
        setIncludeSpeakers(true)
        break
      case 'action_items_only':
        setIncludeTranscript(false)
        setIncludeNotes(false)
        setIncludeTasks(true)
        setIncludeSpeakers(false)
        break
      case 'custom':
        // Keep current selections
        break
    }
  }, [template, isOpen, meetingId])

  const handleExport = useCallback(async () => {
    setStep('progress')
    setProgress(10)
    setError(null)

    try {
      const api = getExportDeleteAPI()
      const options = {
        format,
        template: template === 'custom' ? undefined : template,
        content: template === 'custom' ? {
          includeTranscript,
          includeSummary: includeNotes,
          includeKeyPoints: includeNotes,
          includeActionItems: includeTasks,
          includeDecisions: includeNotes,
          includeSpeakers
        } : undefined,
        includeAudio: format === 'audio' || format === 'full'
      }

      setProgress(30)

      if (deleteAfterExport) {
        // Export and delete
        const result = await api.exportAndDelete(meetingId, {
          export: options,
          deleteAfterExport: true,
          deletion: {
            taskHandling: 'unlink',
            softDelete
          }
        })

        setProgress(100)
        setExportAndDeleteResult(result)
        setStep('result')

        if (result.success && onSuccess) {
          setTimeout(onSuccess, 1500)
        }
      } else {
        // Export only
        const result = await api.exportMeeting(meetingId, options)

        setProgress(100)
        setExportResult(result)
        setStep('result')

        if (result.success && onSuccess) {
          setTimeout(onSuccess, 1500)
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Export failed')
      setStep('result')
    }
  }, [format, template, deleteAfterExport, softDelete, includeTranscript, includeNotes, includeTasks, includeSpeakers, meetingId, onSuccess])

  const handleClose = () => {
    if (step === 'progress') return // Don't close during export
    onClose()
  }

  if (!isOpen) return null

  const finalResult = exportAndDeleteResult || (exportResult ? { exportResult, deleted: false, success: exportResult.success } : null)

  const modalContent = (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 animate-in fade-in duration-200"
      onClick={(e) => e.target === e.currentTarget && handleClose()}
      role="dialog"
      aria-modal="true"
      aria-labelledby="export-modal-title"
    >
      <div className="w-full max-w-2xl bg-card border border-border rounded-lg shadow-xl animate-in zoom-in-95 duration-200 max-h-[90vh] overflow-y-auto">
        {/* Header */}
        <div className="flex items-center justify-between p-6 border-b border-border sticky top-0 bg-card z-10">
          <div className="flex items-center gap-3">
            <div className={cn(
              "p-2 rounded-lg",
              mode === 'archive' ? "bg-amber-100 dark:bg-amber-900/30" : "bg-primary/10"
            )}>
              {mode === 'archive' ? (
                <Archive className="h-5 w-5 text-amber-600 dark:text-amber-400" />
              ) : mode === 'import' ? (
                <Upload className="h-5 w-5 text-primary" />
              ) : (
                <Download className="h-5 w-5 text-primary" />
              )}
            </div>
            <div>
              <h2 id="export-modal-title" className="text-xl font-semibold text-foreground">
                {mode === 'archive' ? 'Archive Meeting to Disk' :
                 mode === 'import' ? 'Import Meeting' :
                 'Export Meeting'}
              </h2>
              {meetingTitle && (
                <p className="text-sm text-muted-foreground truncate max-w-md">{meetingTitle}</p>
              )}
            </div>
          </div>
          <button
            onClick={handleClose}
            disabled={step === 'progress'}
            className="text-muted-foreground hover:text-foreground transition-colors disabled:opacity-50"
            aria-label="Close modal"
          >
            <X size={20} />
          </button>
        </div>

        {/* Content */}
        <div className="p-6 space-y-6">
          {step === 'options' && (
            <>
              {/* Mode Tabs */}
              {showDeleteOption && (
                <div className="flex gap-2 p-1 bg-muted rounded-lg">
                  <button
                    onClick={() => {
                      setMode('export')
                      setDeleteAfterExport(false)
                    }}
                    className={cn(
                      "flex-1 py-2 px-4 rounded-md text-sm font-medium transition-colors",
                      mode === 'export'
                        ? "bg-background text-foreground shadow-sm"
                        : "text-muted-foreground hover:text-foreground"
                    )}
                  >
                    <Download className="h-4 w-4 inline mr-2" />
                    Export Only
                  </button>
                  <button
                    onClick={() => {
                      setMode('archive')
                      setDeleteAfterExport(true)
                    }}
                    className={cn(
                      "flex-1 py-2 px-4 rounded-md text-sm font-medium transition-colors",
                      mode === 'archive'
                        ? "bg-background text-foreground shadow-sm"
                        : "text-muted-foreground hover:text-foreground"
                    )}
                  >
                    <Archive className="h-4 w-4 inline mr-2" />
                    Archive & Delete
                  </button>
                </div>
              )}

              {/* Format Selection */}
              <div className="space-y-3">
                <label className="text-sm font-medium text-foreground">Export Format</label>
                <div className="grid grid-cols-2 gap-3">
                  <FormatButton
                    icon={FileJson}
                    label="JSON Archive"
                    description="All data (transcripts, notes, tasks)"
                    active={format === 'json'}
                    onClick={() => setFormat('json')}
                  />
                  <FormatButton
                    icon={FileText}
                    label="PDF Report"
                    description="Formatted document"
                    active={format === 'pdf'}
                    onClick={() => setFormat('pdf')}
                  />
                  <FormatButton
                    icon={Music}
                    label="Audio Only"
                    description="ZIP of all recordings"
                    active={format === 'audio'}
                    onClick={() => setFormat('audio')}
                  />
                  <FormatButton
                    icon={FolderArchive}
                    label="Full Backup"
                    description="Audio + JSON data"
                    active={format === 'full'}
                    onClick={() => setFormat('full')}
                  />
                </div>
              </div>

              {/* Template Selection (for JSON and PDF) */}
              {(format === 'json' || format === 'pdf') && (
                <div className="space-y-3">
                  <label className="text-sm font-medium text-foreground">Export Template</label>
                  <div className="grid grid-cols-2 gap-3">
                    <TemplateButton
                      icon={Clock}
                      label="Meeting Minutes"
                      description="Summary + action items"
                      active={template === 'meeting_minutes'}
                      onClick={() => setTemplate('meeting_minutes')}
                    />
                    <TemplateButton
                      icon={FileTextIcon}
                      label="Full Transcript"
                      description="Complete conversation"
                      active={template === 'full_transcript'}
                      onClick={() => setTemplate('full_transcript')}
                    />
                    <TemplateButton
                      icon={ListTodo}
                      label="Action Items"
                      description="Tasks & decisions only"
                      active={template === 'action_items_only'}
                      onClick={() => setTemplate('action_items_only')}
                    />
                    <TemplateButton
                      icon={FileCheck}
                      label="Custom"
                      description="Choose what to include"
                      active={template === 'custom'}
                      onClick={() => setTemplate('custom')}
                    />
                  </div>
                </div>
              )}

              {/* Custom Content Options */}
              {template === 'custom' && (format === 'json' || format === 'pdf') && (
                <div className="space-y-3 p-4 bg-muted/50 rounded-lg">
                  <label className="text-sm font-medium text-foreground">Include in Export</label>
                  <div className="grid grid-cols-2 gap-3">
                    <CheckboxOption
                      label="Transcript"
                      checked={includeTranscript}
                      onChange={setIncludeTranscript}
                      count={preview?.itemCounts.transcriptSegments}
                    />
                    <CheckboxOption
                      label="Notes & Summary"
                      checked={includeNotes}
                      onChange={setIncludeNotes}
                      count={preview?.itemCounts.notes}
                    />
                    <CheckboxOption
                      label="Tasks"
                      checked={includeTasks}
                      onChange={setIncludeTasks}
                      count={preview?.itemCounts.tasks}
                    />
                    <CheckboxOption
                      label="Speaker Info"
                      checked={includeSpeakers}
                      onChange={setIncludeSpeakers}
                      count={preview?.itemCounts.speakers}
                    />
                  </div>
                </div>
              )}

              {/* Preview */}
              {loading ? (
                <div className="flex items-center justify-center py-8">
                  <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                </div>
              ) : preview && (
                <div className="bg-muted/50 rounded-lg p-4 space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-medium text-foreground">Export Preview</span>
                    <span className="text-sm text-muted-foreground">
                      Est. size: <span className="font-medium text-foreground">{formatBytes(preview.estimatedSizeBytes)}</span>
                    </span>
                  </div>

                  <div className="grid grid-cols-3 gap-3 text-center">
                    <PreviewItem label="Transcript" value={preview.itemCounts.transcriptSegments} />
                    <PreviewItem label="Notes" value={preview.itemCounts.notes} />
                    <PreviewItem label="Tasks" value={preview.itemCounts.tasks} />
                  </div>

                  {(format === 'audio' || format === 'full') && preview.itemCounts.audioFiles > 0 && (
                    <div className="flex items-center gap-2 text-sm text-muted-foreground">
                      <Music className="h-4 w-4" />
                      {preview.itemCounts.audioFiles} audio file{preview.itemCounts.audioFiles > 1 ? 's' : ''} ({formatBytes(preview.sizeBreakdown.audioFiles)})
                    </div>
                  )}

                  <div className="text-xs text-muted-foreground">
                    Estimated time: {formatDuration(preview.estimatedTimeMs)}
                  </div>
                </div>
              )}

              {/* Advanced Options */}
              {mode === 'archive' && (
                <>
                  <button
                    onClick={() => setShowAdvanced(!showAdvanced)}
                    className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors"
                  >
                    {showAdvanced ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                    Advanced Options
                  </button>

                  {showAdvanced && (
                    <div className="space-y-3 p-4 bg-muted/50 rounded-lg">
                      <label className="flex items-center gap-3 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={softDelete}
                          onChange={(e) => setSoftDelete(e.target.checked)}
                          className="w-4 h-4 rounded border-border text-primary focus:ring-primary"
                        />
                        <div>
                          <span className="text-sm text-foreground">Soft delete (can restore within 30 days)</span>
                          <p className="text-xs text-muted-foreground">Keep meeting in trash for recovery</p>
                        </div>
                      </label>
                    </div>
                  )}
                </>
              )}

              {/* Warning for Archive mode */}
              {mode === 'archive' && (
                <div className="bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-lg p-4">
                  <div className="flex items-start gap-3">
                    <Info className="h-5 w-5 text-amber-600 dark:text-amber-400 mt-0.5" />
                    <div>
                      <p className="font-medium text-amber-700 dark:text-amber-300">Archive & Delete</p>
                      <p className="text-sm text-amber-600 dark:text-amber-400">
                        The meeting will be exported and then {softDelete ? 'moved to trash' : 'permanently deleted'}.
                        {!softDelete && ' This cannot be undone.'}
                      </p>
                    </div>
                  </div>
                </div>
              )}

              {/* Error */}
              {error && (
                <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg p-4">
                  <div className="flex items-start gap-3">
                    <XCircle className="h-5 w-5 text-red-600 dark:text-red-400 mt-0.5" />
                    <div>
                      <p className="font-medium text-red-700 dark:text-red-300">Error</p>
                      <p className="text-sm text-red-600 dark:text-red-400">{error}</p>
                    </div>
                  </div>
                </div>
              )}

              {/* Actions */}
              <div className="flex gap-3 pt-2">
                <button
                  onClick={handleClose}
                  className="flex-1 py-2 bg-secondary text-secondary-foreground rounded-lg font-medium hover:bg-secondary/80 transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={handleExport}
                  disabled={loading || !preview}
                  className={cn(
                    "flex-1 py-2 rounded-lg font-medium transition-colors disabled:opacity-50 flex items-center justify-center gap-2",
                    mode === 'archive'
                      ? "bg-amber-600 text-white hover:bg-amber-700"
                      : "bg-primary text-primary-foreground hover:bg-primary/90"
                  )}
                >
                  {mode === 'archive' ? (
                    <>
                      <Archive className="h-4 w-4" />
                      Archive & Delete
                    </>
                  ) : (
                    <>
                      <Download className="h-4 w-4" />
                      Export
                    </>
                  )}
                </button>
              </div>
            </>
          )}

          {step === 'progress' && (
            <div className="space-y-6 py-8">
              <div className="flex flex-col items-center gap-4">
                <Loader2 className="h-12 w-12 animate-spin text-primary" />
                <p className="text-lg font-medium text-foreground">
                  {progress < 50 ? 'Preparing export...' :
                   progress < 80 ? 'Exporting data...' :
                   'Finalizing...'}
                </p>
              </div>

              <div className="w-full bg-muted rounded-full h-2">
                <div
                  className="bg-primary h-2 rounded-full transition-all duration-300"
                  style={{ width: `${progress}%` }}
                />
              </div>

              <p className="text-center text-sm text-muted-foreground">
                {progress}% complete
              </p>
            </div>
          )}

          {step === 'result' && finalResult && (
            <div className="space-y-6">
              {finalResult.success ? (
                <>
                  <div className="bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded-lg p-4">
                    <div className="flex items-start gap-3">
                      <CheckCircle2 className="h-5 w-5 text-green-600 dark:text-green-400 mt-0.5" />
                      <div>
                        <p className="font-medium text-green-700 dark:text-green-300">
                          {finalResult.deleted ? 'Archived Successfully' : 'Export Complete'}
                        </p>
                        <p className="text-sm text-green-600 dark:text-green-400">
                          {finalResult.exportResult.filePath && (
                            <>Saved to: {finalResult.exportResult.filePath}</>
                          )}
                        </p>
                      </div>
                    </div>
                  </div>

                  {/* Export Summary */}
                  <div className="bg-muted/50 rounded-lg p-4 space-y-3">
                    <p className="text-sm font-medium text-foreground">Export Summary</p>
                    <div className="grid grid-cols-2 gap-2 text-sm">
                      {finalResult.exportResult.exportedContent.transcriptSegments > 0 && (
                        <div className="text-muted-foreground">
                          Transcripts: <span className="text-foreground">{finalResult.exportResult.exportedContent.transcriptSegments}</span>
                        </div>
                      )}
                      {finalResult.exportResult.exportedContent.notes > 0 && (
                        <div className="text-muted-foreground">
                          Notes: <span className="text-foreground">{finalResult.exportResult.exportedContent.notes}</span>
                        </div>
                      )}
                      {finalResult.exportResult.exportedContent.tasks > 0 && (
                        <div className="text-muted-foreground">
                          Tasks: <span className="text-foreground">{finalResult.exportResult.exportedContent.tasks}</span>
                        </div>
                      )}
                      {finalResult.exportResult.exportedContent.audioFiles > 0 && (
                        <div className="text-muted-foreground">
                          Audio files: <span className="text-foreground">{finalResult.exportResult.exportedContent.audioFiles}</span>
                        </div>
                      )}
                    </div>

                    {finalResult.exportResult.fileSizeBytes && (
                      <div className="text-sm text-muted-foreground">
                        File size: <span className="text-foreground">{formatBytes(finalResult.exportResult.fileSizeBytes)}</span>
                      </div>
                    )}

                    {finalResult.deleted && finalResult.deletionResult?.freedSpaceBytes && (
                      <div className="flex items-center gap-2 text-sm text-green-600 dark:text-green-400">
                        <HardDrive className="h-4 w-4" />
                        Freed {formatBytes(finalResult.deletionResult.freedSpaceBytes)} of storage
                      </div>
                    )}
                  </div>
                </>
              ) : (
                <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg p-4">
                  <div className="flex items-start gap-3">
                    <XCircle className="h-5 w-5 text-red-600 dark:text-red-400 mt-0.5" />
                    <div>
                      <p className="font-medium text-red-700 dark:text-red-300">Export Failed</p>
                      <p className="text-sm text-red-600 dark:text-red-400">
                        {finalResult.exportResult.error || error || 'An unknown error occurred'}
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
          )}
        </div>
      </div>
    </div>
  )

  return createPortal(modalContent, document.body)
}

// Helper Components

function FormatButton({
  icon: Icon,
  label,
  description,
  active,
  onClick
}: {
  icon: React.ComponentType<{ className?: string }>
  label: string
  description: string
  active: boolean
  onClick: () => void
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "p-4 rounded-lg border-2 transition-all text-left",
        active
          ? "border-primary bg-primary/10"
          : "border-border hover:border-primary/50"
      )}
    >
      <Icon className={cn("h-5 w-5 mb-2", active ? "text-primary" : "text-muted-foreground")} />
      <p className={cn("text-sm font-medium", active ? "text-foreground" : "text-muted-foreground")}>
        {label}
      </p>
      <p className="text-xs text-muted-foreground">{description}</p>
    </button>
  )
}

function TemplateButton({
  icon: Icon,
  label,
  description,
  active,
  onClick
}: {
  icon: React.ComponentType<{ className?: string }>
  label: string
  description: string
  active: boolean
  onClick: () => void
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "p-3 rounded-lg border-2 transition-all text-left flex items-start gap-3",
        active
          ? "border-primary bg-primary/10"
          : "border-border hover:border-primary/50"
      )}
    >
      <Icon className={cn("h-4 w-4 mt-0.5", active ? "text-primary" : "text-muted-foreground")} />
      <div>
        <p className={cn("text-sm font-medium", active ? "text-foreground" : "text-muted-foreground")}>
          {label}
        </p>
        <p className="text-xs text-muted-foreground">{description}</p>
      </div>
    </button>
  )
}

function CheckboxOption({
  label,
  checked,
  onChange,
  count
}: {
  label: string
  checked: boolean
  onChange: (checked: boolean) => void
  count?: number
}) {
  return (
    <label className="flex items-center gap-2 cursor-pointer">
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="w-4 h-4 rounded border-border text-primary focus:ring-primary"
      />
      <span className="text-sm text-foreground">{label}</span>
      {count !== undefined && (
        <span className="text-xs text-muted-foreground">({count})</span>
      )}
    </label>
  )
}

function PreviewItem({
  label,
  value
}: {
  label: string
  value: number
}) {
  return (
    <div className="p-2 bg-background rounded">
      <p className="text-lg font-semibold text-foreground">{value}</p>
      <p className="text-xs text-muted-foreground">{label}</p>
    </div>
  )
}

export default ExportDeleteModal
