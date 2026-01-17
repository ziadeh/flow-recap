/**
 * TranscriptCorrectionModal Component
 *
 * Modal for displaying AI-assisted transcript corrections with:
 * - Side-by-side comparison of original and corrected text
 * - Visual diff highlighting for changes
 * - Accept/Reject functionality
 * - Change type badges
 */

import { useState, useMemo, useCallback } from 'react'
import { X, Check, XCircle, Wand2, AlertCircle, Clock, Loader2 } from 'lucide-react'
import { createPortal } from 'react-dom'
import { cn } from '../../lib/utils'

// ============================================================================
// Types
// ============================================================================

export interface TextChange {
  original: string
  corrected: string
  changeType: 'word' | 'punctuation' | 'capitalization' | 'grammar' | 'homophone' | 'terminology'
  startIndex: number
  endIndex: number
  confidence: number
}

export interface TranscriptCorrection {
  id: string
  transcript_id: string
  meeting_id: string
  original_content: string
  corrected_content: string
  changes: string  // JSON array of TextChange[]
  trigger: 'low_confidence' | 'speaker_change' | 'manual' | 'batch'
  status: 'pending' | 'accepted' | 'rejected'
  llm_provider: string | null
  llm_model: string | null
  confidence_score: number
  processing_time_ms: number
  created_at: string
  updated_at: string
  applied_at: string | null
}

export interface TranscriptCorrectionModalProps {
  /** Whether the modal is open */
  isOpen: boolean
  /** Callback when the modal is closed */
  onClose: () => void
  /** The correction to display */
  correction: TranscriptCorrection | null
  /** Callback when correction is accepted */
  onAccept: (correctionId: string) => Promise<void>
  /** Callback when correction is rejected */
  onReject: (correctionId: string) => Promise<void>
  /** Loading state for accept/reject actions */
  isProcessing?: boolean
}

// ============================================================================
// Helper Components
// ============================================================================

const changeTypeLabels: Record<TextChange['changeType'], string> = {
  word: 'Word',
  punctuation: 'Punctuation',
  capitalization: 'Capitalization',
  grammar: 'Grammar',
  homophone: 'Homophone',
  terminology: 'Terminology'
}

const changeTypeColors: Record<TextChange['changeType'], string> = {
  word: 'bg-blue-100 text-blue-700 dark:bg-blue-900/50 dark:text-blue-300',
  punctuation: 'bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300',
  capitalization: 'bg-purple-100 text-purple-700 dark:bg-purple-900/50 dark:text-purple-300',
  grammar: 'bg-green-100 text-green-700 dark:bg-green-900/50 dark:text-green-300',
  homophone: 'bg-orange-100 text-orange-700 dark:bg-orange-900/50 dark:text-orange-300',
  terminology: 'bg-pink-100 text-pink-700 dark:bg-pink-900/50 dark:text-pink-300'
}

function ChangeTypeBadge({ type }: { type: TextChange['changeType'] }) {
  return (
    <span className={cn(
      'inline-flex items-center px-2 py-0.5 rounded text-xs font-medium',
      changeTypeColors[type]
    )}>
      {changeTypeLabels[type]}
    </span>
  )
}

/**
 * Highlights differences between original and corrected text
 */
function DiffHighlight({
  original,
  corrected,
  type
}: {
  original: string
  corrected: string
  type: 'original' | 'corrected'
}) {
  if (type === 'original') {
    return (
      <span className="bg-red-100 text-red-800 dark:bg-red-900/50 dark:text-red-200 px-1 rounded line-through">
        {original}
      </span>
    )
  }
  return (
    <span className="bg-green-100 text-green-800 dark:bg-green-900/50 dark:text-green-200 px-1 rounded">
      {corrected}
    </span>
  )
}

/**
 * Renders text with inline diff highlighting for changes
 */
function TextWithDiff({
  text,
  changes,
  type
}: {
  text: string
  changes: TextChange[]
  type: 'original' | 'corrected'
}) {
  const highlightedText = useMemo(() => {
    if (changes.length === 0) {
      return <span>{text}</span>
    }

    // Sort changes by start index
    const sortedChanges = [...changes].sort((a, b) => a.startIndex - b.startIndex)
    const parts: React.ReactNode[] = []
    let lastIndex = 0

    sortedChanges.forEach((change, idx) => {
      // Add text before the change
      if (change.startIndex > lastIndex) {
        parts.push(
          <span key={`text-${idx}`}>
            {type === 'original'
              ? text.slice(lastIndex, change.startIndex)
              : text.slice(lastIndex, change.startIndex)}
          </span>
        )
      }

      // Add the change highlight
      parts.push(
        <DiffHighlight
          key={`diff-${idx}`}
          original={change.original}
          corrected={change.corrected}
          type={type}
        />
      )

      lastIndex = type === 'original'
        ? change.startIndex + change.original.length
        : change.startIndex + change.corrected.length
    })

    // Add remaining text after last change
    if (lastIndex < text.length) {
      parts.push(<span key="text-end">{text.slice(lastIndex)}</span>)
    }

    return <>{parts}</>
  }, [text, changes, type])

  return <p className="text-sm leading-relaxed">{highlightedText}</p>
}

// ============================================================================
// Main Component
// ============================================================================

export function TranscriptCorrectionModal({
  isOpen,
  onClose,
  correction,
  onAccept,
  onReject,
  isProcessing = false
}: TranscriptCorrectionModalProps) {
  const [isAccepting, setIsAccepting] = useState(false)
  const [isRejecting, setIsRejecting] = useState(false)

  // Parse changes from JSON string
  const changes = useMemo<TextChange[]>(() => {
    if (!correction) return []
    try {
      return JSON.parse(correction.changes)
    } catch {
      return []
    }
  }, [correction])

  const handleAccept = useCallback(async () => {
    if (!correction || isProcessing) return
    setIsAccepting(true)
    try {
      await onAccept(correction.id)
      onClose()
    } finally {
      setIsAccepting(false)
    }
  }, [correction, isProcessing, onAccept, onClose])

  const handleReject = useCallback(async () => {
    if (!correction || isProcessing) return
    setIsRejecting(true)
    try {
      await onReject(correction.id)
      onClose()
    } finally {
      setIsRejecting(false)
    }
  }, [correction, isProcessing, onReject, onClose])

  // Handle escape key
  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    if (e.key === 'Escape' && isOpen) {
      onClose()
    }
  }, [isOpen, onClose])

  // Add event listener for escape key
  useState(() => {
    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  })

  if (!isOpen || !correction) return null

  const confidencePercent = Math.round(correction.confidence_score * 100)

  const modalContent = (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 animate-in fade-in duration-200"
      onClick={(e) => e.target === e.currentTarget && onClose()}
      role="dialog"
      aria-modal="true"
      aria-labelledby="correction-modal-title"
    >
      <div className="w-full max-w-3xl bg-card border border-border rounded-lg shadow-xl animate-in zoom-in-95 duration-200 max-h-[90vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between p-6 border-b border-border">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-full bg-primary/10">
              <Wand2 className="w-5 h-5 text-primary" />
            </div>
            <div>
              <h2
                id="correction-modal-title"
                className="text-xl font-semibold text-foreground"
              >
                AI Correction Suggestion
              </h2>
              <div className="flex items-center gap-3 mt-1 text-sm text-muted-foreground">
                <span className="flex items-center gap-1">
                  <AlertCircle className="w-3.5 h-3.5" />
                  {confidencePercent}% confidence
                </span>
                <span className="flex items-center gap-1">
                  <Clock className="w-3.5 h-3.5" />
                  {correction.processing_time_ms}ms
                </span>
              </div>
            </div>
          </div>
          <button
            onClick={onClose}
            className="text-muted-foreground hover:text-foreground transition-colors"
            aria-label="Close modal"
          >
            <X size={20} />
          </button>
        </div>

        {/* Content */}
        <div className="p-6 overflow-y-auto flex-1">
          {/* Changes Overview */}
          {changes.length > 0 && (
            <div className="mb-6">
              <h3 className="text-sm font-medium text-muted-foreground mb-2">
                Changes ({changes.length})
              </h3>
              <div className="flex flex-wrap gap-2">
                {changes.map((change, idx) => (
                  <div key={idx} className="flex items-center gap-2">
                    <ChangeTypeBadge type={change.changeType} />
                    <span className="text-xs text-muted-foreground">
                      &quot;{change.original}&quot; → &quot;{change.corrected}&quot;
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Side-by-side comparison */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* Original */}
            <div className="rounded-lg border border-border p-4">
              <div className="flex items-center gap-2 mb-3">
                <div className="w-3 h-3 rounded-full bg-red-500" />
                <h4 className="text-sm font-medium">Original</h4>
              </div>
              <div className="bg-muted/30 rounded p-3">
                <TextWithDiff
                  text={correction.original_content}
                  changes={changes}
                  type="original"
                />
              </div>
            </div>

            {/* Corrected */}
            <div className="rounded-lg border border-border p-4">
              <div className="flex items-center gap-2 mb-3">
                <div className="w-3 h-3 rounded-full bg-green-500" />
                <h4 className="text-sm font-medium">Corrected</h4>
              </div>
              <div className="bg-muted/30 rounded p-3">
                <TextWithDiff
                  text={correction.corrected_content}
                  changes={changes}
                  type="corrected"
                />
              </div>
            </div>
          </div>

          {/* Metadata */}
          <div className="mt-6 pt-4 border-t border-border">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
              <div>
                <span className="text-muted-foreground">Trigger:</span>
                <span className="ml-2 capitalize">{correction.trigger.replace('_', ' ')}</span>
              </div>
              <div>
                <span className="text-muted-foreground">Status:</span>
                <span className={cn('ml-2 capitalize', {
                  'text-yellow-600 dark:text-yellow-400': correction.status === 'pending',
                  'text-green-600 dark:text-green-400': correction.status === 'accepted',
                  'text-red-600 dark:text-red-400': correction.status === 'rejected'
                })}>
                  {correction.status}
                </span>
              </div>
              {correction.llm_provider && (
                <div>
                  <span className="text-muted-foreground">Provider:</span>
                  <span className="ml-2">{correction.llm_provider}</span>
                </div>
              )}
              <div>
                <span className="text-muted-foreground">Created:</span>
                <span className="ml-2">
                  {new Date(correction.created_at).toLocaleString()}
                </span>
              </div>
            </div>
          </div>
        </div>

        {/* Footer with actions */}
        {correction.status === 'pending' && (
          <div className="flex items-center justify-end gap-3 p-6 border-t border-border">
            <button
              onClick={handleReject}
              disabled={isProcessing || isAccepting || isRejecting}
              className={cn(
                'flex items-center gap-2 px-4 py-2 rounded-lg font-medium transition-colors',
                'bg-muted hover:bg-muted/80 text-foreground',
                'disabled:opacity-50 disabled:cursor-not-allowed'
              )}
            >
              {isRejecting ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <XCircle className="w-4 h-4" />
              )}
              Reject
            </button>
            <button
              onClick={handleAccept}
              disabled={isProcessing || isAccepting || isRejecting}
              className={cn(
                'flex items-center gap-2 px-4 py-2 rounded-lg font-medium transition-colors',
                'bg-primary hover:bg-primary/90 text-primary-foreground',
                'disabled:opacity-50 disabled:cursor-not-allowed'
              )}
            >
              {isAccepting ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <Check className="w-4 h-4" />
              )}
              Accept Correction
            </button>
          </div>
        )}
      </div>
    </div>
  )

  return createPortal(modalContent, document.body)
}

export default TranscriptCorrectionModal
