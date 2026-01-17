/**
 * Cleanup Wizard Component
 *
 * A step-by-step wizard that guides users through freeing up storage space.
 * Steps:
 * 1. Select cleanup criteria (age, size, missing content)
 * 2. Preview what will be deleted
 * 3. Confirm and execute cleanup
 * 4. Show results
 */

import { useState, useEffect } from 'react'
import { createPortal } from 'react-dom'
import {
  X,
  Wand2,
  Clock,
  HardDrive,
  FileText,
  Trash2,
  AlertTriangle,
  Check,
  ChevronRight,
  ChevronLeft,
  Loader2,
  CheckCircle2,
  XCircle,
  Calendar,
  FileAudio
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { formatFileSize, formatDate } from '@/lib/formatters'

// Types from the storage management API
interface MeetingStorageInfo {
  meetingId: string
  meetingTitle: string
  startTime: string
  audioFileSize: number
  recordingsSize: number
  databaseEstimate: number
  totalSize: number
  transcriptCount: number
  notesCount: number
  tasksCount: number
  hasAudio: boolean
  audioFilePath: string | null
  daysSinceCreated: number
}

interface CleanupCriteria {
  olderThanDays?: number
  largerThanBytes?: number
  withoutTranscripts?: boolean
  withoutNotes?: boolean
  meetingIds?: string[]
}

interface CleanupPreview {
  meetingsToDelete: MeetingStorageInfo[]
  totalSpaceToFree: number
  totalMeetings: number
  criteria: CleanupCriteria
}

interface CleanupResult {
  success: boolean
  deletedMeetings: number
  freedSpaceBytes: number
  errors: string[]
}

// Get the storage management API
const getStorageAPI = () => (window as any).electronAPI.storageManagement

type WizardStep = 'criteria' | 'preview' | 'confirm' | 'result'

interface CleanupWizardProps {
  isOpen: boolean
  onClose: () => void
  onComplete?: () => void
}

export function CleanupWizard({ isOpen, onClose, onComplete }: CleanupWizardProps) {
  const [step, setStep] = useState<WizardStep>('criteria')
  const [criteria, setCriteria] = useState<CleanupCriteria>({})
  const [preview, setPreview] = useState<CleanupPreview | null>(null)
  const [result, setResult] = useState<CleanupResult | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [softDelete, setSoftDelete] = useState(true)

  // Criteria options state
  const [useAgeCriteria, setUseAgeCriteria] = useState(false)
  const [ageDays, setAgeDays] = useState(90)
  const [useSizeCriteria, setUseSizeCriteria] = useState(false)
  const [sizeBytes, setSizeBytes] = useState(100 * 1024 * 1024) // 100 MB
  const [useNoTranscripts, setUseNoTranscripts] = useState(false)
  const [useNoNotes, setUseNoNotes] = useState(false)
  const [selectedMeetings, setSelectedMeetings] = useState<string[]>([])

  // Reset state when modal opens
  useEffect(() => {
    if (isOpen) {
      setStep('criteria')
      setCriteria({})
      setPreview(null)
      setResult(null)
      setError(null)
      setUseAgeCriteria(false)
      setUseSizeCriteria(false)
      setUseNoTranscripts(false)
      setUseNoNotes(false)
      setSelectedMeetings([])
      setSoftDelete(true)
    }
  }, [isOpen])

  // Build criteria from selections
  const buildCriteria = (): CleanupCriteria => {
    const newCriteria: CleanupCriteria = {}

    if (useAgeCriteria) {
      newCriteria.olderThanDays = ageDays
    }
    if (useSizeCriteria) {
      newCriteria.largerThanBytes = sizeBytes
    }
    if (useNoTranscripts) {
      newCriteria.withoutTranscripts = true
    }
    if (useNoNotes) {
      newCriteria.withoutNotes = true
    }
    if (selectedMeetings.length > 0) {
      newCriteria.meetingIds = selectedMeetings
    }

    return newCriteria
  }

  // Check if any criteria is selected
  const hasCriteria = useAgeCriteria || useSizeCriteria || useNoTranscripts || useNoNotes || selectedMeetings.length > 0

  // Load preview when moving to preview step
  const loadPreview = async () => {
    setLoading(true)
    setError(null)

    try {
      const api = getStorageAPI()
      const newCriteria = buildCriteria()
      setCriteria(newCriteria)

      const previewData = await api.getCleanupPreview(newCriteria)
      setPreview(previewData)
      setStep('preview')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load preview')
    } finally {
      setLoading(false)
    }
  }

  // Execute cleanup
  const executeCleanup = async () => {
    setLoading(true)
    setError(null)

    try {
      const api = getStorageAPI()
      const cleanupResult = await api.executeCleanup(criteria, {
        softDelete,
        softDeleteDays: softDelete ? 30 : undefined,
        auditLog: true
      })
      setResult(cleanupResult)
      setStep('result')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Cleanup failed')
    } finally {
      setLoading(false)
    }
  }

  const handleNext = () => {
    if (step === 'criteria' && hasCriteria) {
      loadPreview()
    } else if (step === 'preview') {
      setStep('confirm')
    } else if (step === 'confirm') {
      executeCleanup()
    }
  }

  const handleBack = () => {
    if (step === 'preview') {
      setStep('criteria')
    } else if (step === 'confirm') {
      setStep('preview')
    }
  }

  const handleClose = () => {
    if (!loading) {
      if (result?.success && onComplete) {
        onComplete()
      }
      onClose()
    }
  }

  // Note: toggleMeetingSelection was removed as individual meeting selection
  // is not used in the current wizard flow. The selectedMeetings state is kept
  // for future granular selection functionality.

  if (!isOpen) return null

  const modalContent = (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 animate-in fade-in duration-200"
      onClick={(e) => e.target === e.currentTarget && handleClose()}
      role="dialog"
      aria-modal="true"
      aria-labelledby="wizard-title"
    >
      <div className="w-full max-w-2xl bg-card border border-border rounded-lg shadow-xl animate-in zoom-in-95 duration-200 max-h-[90vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between p-6 border-b border-border flex-shrink-0">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-purple-100 dark:bg-purple-900/30 rounded-lg">
              <Wand2 className="h-5 w-5 text-purple-600 dark:text-purple-400" />
            </div>
            <div>
              <h2 id="wizard-title" className="text-xl font-semibold text-foreground">
                Cleanup Wizard
              </h2>
              <p className="text-sm text-muted-foreground">
                Free up storage space by removing old meetings
              </p>
            </div>
          </div>
          <button
            onClick={handleClose}
            disabled={loading}
            className="text-muted-foreground hover:text-foreground transition-colors disabled:opacity-50"
            aria-label="Close wizard"
          >
            <X size={20} />
          </button>
        </div>

        {/* Progress Indicator */}
        <div className="px-6 py-3 border-b border-border flex-shrink-0">
          <div className="flex items-center justify-between">
            <StepIndicator
              step={1}
              label="Select Criteria"
              isActive={step === 'criteria'}
              isComplete={step !== 'criteria'}
            />
            <div className="flex-1 h-0.5 bg-border mx-2" />
            <StepIndicator
              step={2}
              label="Preview"
              isActive={step === 'preview'}
              isComplete={step === 'confirm' || step === 'result'}
            />
            <div className="flex-1 h-0.5 bg-border mx-2" />
            <StepIndicator
              step={3}
              label="Confirm"
              isActive={step === 'confirm'}
              isComplete={step === 'result'}
            />
            <div className="flex-1 h-0.5 bg-border mx-2" />
            <StepIndicator
              step={4}
              label="Done"
              isActive={step === 'result'}
              isComplete={false}
            />
          </div>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-6">
          {error && (
            <div className="mb-4 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg p-4">
              <div className="flex items-start gap-3">
                <XCircle className="h-5 w-5 text-red-600 dark:text-red-400 mt-0.5" />
                <div>
                  <p className="font-medium text-red-700 dark:text-red-300">Error</p>
                  <p className="text-sm text-red-600 dark:text-red-400">{error}</p>
                </div>
              </div>
            </div>
          )}

          {step === 'criteria' && (
            <CriteriaStep
              useAgeCriteria={useAgeCriteria}
              setUseAgeCriteria={setUseAgeCriteria}
              ageDays={ageDays}
              setAgeDays={setAgeDays}
              useSizeCriteria={useSizeCriteria}
              setUseSizeCriteria={setUseSizeCriteria}
              sizeBytes={sizeBytes}
              setSizeBytes={setSizeBytes}
              useNoTranscripts={useNoTranscripts}
              setUseNoTranscripts={setUseNoTranscripts}
              useNoNotes={useNoNotes}
              setUseNoNotes={setUseNoNotes}
            />
          )}

          {step === 'preview' && preview && (
            <PreviewStep preview={preview} />
          )}

          {step === 'confirm' && preview && (
            <ConfirmStep
              preview={preview}
              softDelete={softDelete}
              setSoftDelete={setSoftDelete}
            />
          )}

          {step === 'result' && result && (
            <ResultStep result={result} />
          )}
        </div>

        {/* Footer */}
        <div className="flex justify-between p-6 border-t border-border flex-shrink-0">
          <button
            onClick={handleBack}
            disabled={step === 'criteria' || step === 'result' || loading}
            className={cn(
              'flex items-center gap-2 px-4 py-2 bg-secondary text-secondary-foreground rounded-lg font-medium',
              (step === 'criteria' || step === 'result' || loading) && 'opacity-50 cursor-not-allowed'
            )}
          >
            <ChevronLeft className="h-4 w-4" />
            Back
          </button>

          {step === 'result' ? (
            <button
              onClick={handleClose}
              className="flex items-center gap-2 px-4 py-2 bg-purple-600 hover:bg-purple-700 text-white rounded-lg font-medium"
            >
              Done
            </button>
          ) : (
            <button
              onClick={handleNext}
              disabled={!hasCriteria || loading || (step === 'preview' && preview?.meetingsToDelete.length === 0)}
              className={cn(
                'flex items-center gap-2 px-4 py-2 bg-purple-600 hover:bg-purple-700 text-white rounded-lg font-medium',
                (!hasCriteria || loading || (step === 'preview' && preview?.meetingsToDelete.length === 0)) && 'opacity-50 cursor-not-allowed'
              )}
            >
              {loading ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  {step === 'criteria' ? 'Loading...' : 'Cleaning...'}
                </>
              ) : (
                <>
                  {step === 'confirm' ? 'Clean Up' : 'Next'}
                  <ChevronRight className="h-4 w-4" />
                </>
              )}
            </button>
          )}
        </div>
      </div>
    </div>
  )

  return createPortal(modalContent, document.body)
}

// Step Components

interface StepIndicatorProps {
  step: number
  label: string
  isActive: boolean
  isComplete: boolean
}

function StepIndicator({ step, label, isActive, isComplete }: StepIndicatorProps) {
  return (
    <div className="flex flex-col items-center">
      <div
        className={cn(
          'w-8 h-8 rounded-full flex items-center justify-center text-sm font-medium transition-colors',
          isComplete
            ? 'bg-green-500 text-white'
            : isActive
            ? 'bg-purple-600 text-white'
            : 'bg-secondary text-muted-foreground'
        )}
      >
        {isComplete ? <Check className="h-4 w-4" /> : step}
      </div>
      <span
        className={cn(
          'text-xs mt-1',
          isActive ? 'text-foreground font-medium' : 'text-muted-foreground'
        )}
      >
        {label}
      </span>
    </div>
  )
}

interface CriteriaStepProps {
  useAgeCriteria: boolean
  setUseAgeCriteria: (v: boolean) => void
  ageDays: number
  setAgeDays: (v: number) => void
  useSizeCriteria: boolean
  setUseSizeCriteria: (v: boolean) => void
  sizeBytes: number
  setSizeBytes: (v: number) => void
  useNoTranscripts: boolean
  setUseNoTranscripts: (v: boolean) => void
  useNoNotes: boolean
  setUseNoNotes: (v: boolean) => void
}

function CriteriaStep({
  useAgeCriteria,
  setUseAgeCriteria,
  ageDays,
  setAgeDays,
  useSizeCriteria,
  setUseSizeCriteria,
  sizeBytes,
  setSizeBytes,
  useNoTranscripts,
  setUseNoTranscripts,
  useNoNotes,
  setUseNoNotes
}: CriteriaStepProps) {
  return (
    <div className="space-y-4">
      <p className="text-muted-foreground">
        Select the criteria for meetings you want to clean up. Meetings matching ANY of the selected criteria will be included.
      </p>

      {/* Age Criteria */}
      <CriteriaCard
        icon={Clock}
        title="Delete old meetings"
        description="Remove meetings older than a specified number of days"
        enabled={useAgeCriteria}
        onToggle={() => setUseAgeCriteria(!useAgeCriteria)}
      >
        <div className="flex items-center gap-2 mt-2">
          <span className="text-sm text-muted-foreground">Older than</span>
          <select
            value={ageDays}
            onChange={(e) => setAgeDays(parseInt(e.target.value))}
            className="px-3 py-1.5 bg-background border border-border rounded-md text-sm"
            disabled={!useAgeCriteria}
          >
            <option value="30">30 days</option>
            <option value="60">60 days</option>
            <option value="90">90 days</option>
            <option value="180">180 days</option>
            <option value="365">1 year</option>
          </select>
        </div>
      </CriteriaCard>

      {/* Size Criteria */}
      <CriteriaCard
        icon={HardDrive}
        title="Delete large meetings"
        description="Remove meetings larger than a specified size"
        enabled={useSizeCriteria}
        onToggle={() => setUseSizeCriteria(!useSizeCriteria)}
      >
        <div className="flex items-center gap-2 mt-2">
          <span className="text-sm text-muted-foreground">Larger than</span>
          <select
            value={sizeBytes}
            onChange={(e) => setSizeBytes(parseInt(e.target.value))}
            className="px-3 py-1.5 bg-background border border-border rounded-md text-sm"
            disabled={!useSizeCriteria}
          >
            <option value={10 * 1024 * 1024}>10 MB</option>
            <option value={50 * 1024 * 1024}>50 MB</option>
            <option value={100 * 1024 * 1024}>100 MB</option>
            <option value={250 * 1024 * 1024}>250 MB</option>
            <option value={500 * 1024 * 1024}>500 MB</option>
            <option value={1024 * 1024 * 1024}>1 GB</option>
          </select>
        </div>
      </CriteriaCard>

      {/* No Transcripts Criteria */}
      <CriteriaCard
        icon={FileText}
        title="Delete meetings without transcripts"
        description="Remove meetings that have no transcription data"
        enabled={useNoTranscripts}
        onToggle={() => setUseNoTranscripts(!useNoTranscripts)}
      />

      {/* No Notes Criteria */}
      <CriteriaCard
        icon={FileText}
        title="Delete meetings without notes"
        description="Remove meetings that have no notes or summaries"
        enabled={useNoNotes}
        onToggle={() => setUseNoNotes(!useNoNotes)}
      />
    </div>
  )
}

interface CriteriaCardProps {
  icon: React.ComponentType<{ className?: string }>
  title: string
  description: string
  enabled: boolean
  onToggle: () => void
  children?: React.ReactNode
}

function CriteriaCard({ icon: Icon, title, description, enabled, onToggle, children }: CriteriaCardProps) {
  return (
    <div
      className={cn(
        'p-4 border rounded-lg transition-colors cursor-pointer',
        enabled
          ? 'border-purple-500 bg-purple-50 dark:bg-purple-900/20'
          : 'border-border hover:border-purple-300 dark:hover:border-purple-700'
      )}
      onClick={onToggle}
    >
      <div className="flex items-start gap-3">
        <input
          type="checkbox"
          checked={enabled}
          onChange={onToggle}
          onClick={(e) => e.stopPropagation()}
          className="mt-1 w-4 h-4 rounded border-border text-purple-600 focus:ring-purple-500"
        />
        <div className="flex-1">
          <div className="flex items-center gap-2">
            <Icon className={cn('h-4 w-4', enabled ? 'text-purple-600' : 'text-muted-foreground')} />
            <span className="font-medium text-sm">{title}</span>
          </div>
          <p className="text-xs text-muted-foreground mt-1">{description}</p>
          {children && enabled && <div onClick={(e) => e.stopPropagation()}>{children}</div>}
        </div>
      </div>
    </div>
  )
}

interface PreviewStepProps {
  preview: CleanupPreview
}

function PreviewStep({ preview }: PreviewStepProps) {
  if (preview.meetingsToDelete.length === 0) {
    return (
      <div className="text-center py-8">
        <CheckCircle2 className="h-12 w-12 text-green-500 mx-auto mb-4" />
        <h3 className="text-lg font-medium mb-2">No meetings match your criteria</h3>
        <p className="text-muted-foreground">
          Try adjusting your criteria to find meetings to clean up.
        </p>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      {/* Summary */}
      <div className="bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-lg p-4">
        <div className="flex items-start gap-3">
          <AlertTriangle className="h-5 w-5 text-amber-600 dark:text-amber-400 mt-0.5" />
          <div>
            <p className="font-medium text-amber-700 dark:text-amber-300">
              {preview.totalMeetings} meeting{preview.totalMeetings !== 1 ? 's' : ''} will be deleted
            </p>
            <p className="text-sm text-amber-600 dark:text-amber-400">
              This will free up approximately {formatFileSize(preview.totalSpaceToFree)} of storage.
            </p>
          </div>
        </div>
      </div>

      {/* Meeting List */}
      <div className="space-y-2 max-h-64 overflow-y-auto">
        {preview.meetingsToDelete.map((meeting) => (
          <div
            key={meeting.meetingId}
            className="flex items-center gap-3 p-3 bg-muted/50 rounded-lg"
          >
            <div className="flex-1 min-w-0">
              <p className="font-medium text-sm truncate">{meeting.meetingTitle}</p>
              <div className="flex items-center gap-4 text-xs text-muted-foreground mt-1">
                <span className="flex items-center gap-1">
                  <Calendar className="h-3 w-3" />
                  {formatDate(meeting.startTime)}
                </span>
                <span className="flex items-center gap-1">
                  <HardDrive className="h-3 w-3" />
                  {formatFileSize(meeting.totalSize)}
                </span>
                {meeting.hasAudio && (
                  <span className="flex items-center gap-1">
                    <FileAudio className="h-3 w-3" />
                    Audio
                  </span>
                )}
              </div>
            </div>
            <div className="text-xs text-muted-foreground text-right">
              <p>{meeting.transcriptCount} transcripts</p>
              <p>{meeting.notesCount} notes</p>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

interface ConfirmStepProps {
  preview: CleanupPreview
  softDelete: boolean
  setSoftDelete: (v: boolean) => void
}

function ConfirmStep({ preview, softDelete, setSoftDelete }: ConfirmStepProps) {
  return (
    <div className="space-y-6">
      <div className="text-center">
        <Trash2 className="h-12 w-12 text-red-500 mx-auto mb-4" />
        <h3 className="text-lg font-medium mb-2">Confirm Cleanup</h3>
        <p className="text-muted-foreground">
          You are about to delete {preview.totalMeetings} meeting{preview.totalMeetings !== 1 ? 's' : ''},
          freeing up {formatFileSize(preview.totalSpaceToFree)}.
        </p>
      </div>

      {/* Soft Delete Option */}
      <div className="p-4 bg-muted/50 rounded-lg">
        <label className="flex items-start gap-3 cursor-pointer">
          <input
            type="checkbox"
            checked={softDelete}
            onChange={(e) => setSoftDelete(e.target.checked)}
            className="mt-1 w-4 h-4 rounded border-border text-purple-600 focus:ring-purple-500"
          />
          <div>
            <span className="font-medium text-sm">Use soft delete (recommended)</span>
            <p className="text-xs text-muted-foreground mt-1">
              Meetings will be moved to trash and can be restored within 30 days.
              After 30 days, they will be permanently deleted.
            </p>
          </div>
        </label>
      </div>

      {/* Warning */}
      {!softDelete && (
        <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg p-4">
          <div className="flex items-start gap-3">
            <AlertTriangle className="h-5 w-5 text-red-600 dark:text-red-400 mt-0.5" />
            <div>
              <p className="font-medium text-red-700 dark:text-red-300">
                Warning: Permanent Deletion
              </p>
              <p className="text-sm text-red-600 dark:text-red-400">
                This action cannot be undone. All meeting data, recordings, transcripts, and notes will be permanently deleted.
              </p>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

interface ResultStepProps {
  result: CleanupResult
}

function ResultStep({ result }: ResultStepProps) {
  return (
    <div className="text-center py-4">
      {result.success ? (
        <>
          <CheckCircle2 className="h-16 w-16 text-green-500 mx-auto mb-4" />
          <h3 className="text-xl font-medium mb-2">Cleanup Complete!</h3>
          <p className="text-muted-foreground mb-4">
            Successfully deleted {result.deletedMeetings} meeting{result.deletedMeetings !== 1 ? 's' : ''}
          </p>
          <div className="inline-flex items-center gap-2 px-4 py-2 bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-300 rounded-lg">
            <HardDrive className="h-5 w-5" />
            <span className="font-medium">{formatFileSize(result.freedSpaceBytes)} freed</span>
          </div>
        </>
      ) : (
        <>
          <XCircle className="h-16 w-16 text-red-500 mx-auto mb-4" />
          <h3 className="text-xl font-medium mb-2">Cleanup Had Issues</h3>
          <p className="text-muted-foreground mb-4">
            Deleted {result.deletedMeetings} meeting{result.deletedMeetings !== 1 ? 's' : ''},
            but some errors occurred.
          </p>
          {result.errors.length > 0 && (
            <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg p-4 text-left">
              <p className="font-medium text-red-700 dark:text-red-300 mb-2">Errors:</p>
              <ul className="text-sm text-red-600 dark:text-red-400 list-disc list-inside">
                {result.errors.slice(0, 5).map((error, index) => (
                  <li key={index}>{error}</li>
                ))}
                {result.errors.length > 5 && (
                  <li>...and {result.errors.length - 5} more errors</li>
                )}
              </ul>
            </div>
          )}
        </>
      )}
    </div>
  )
}

export default CleanupWizard
