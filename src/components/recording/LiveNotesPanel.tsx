/**
 * LiveNotesPanel Component
 *
 * Displays real-time meeting notes generated during active recording.
 * Shows key discussion points, preliminary action items, emerging decisions,
 * and important topics as they are extracted from the live transcript.
 *
 * Features:
 * - Live/preliminary badge distinction from finalized notes
 * - Incremental updates as new notes arrive
 * - Organized by note type with visual differentiation
 * - Status indicators for LLM processing
 * - Expandable/collapsible sections
 */

import { useState, useMemo } from 'react'
import {
  Lightbulb,
  CheckCircle2,
  Gavel,
  Tag,
  Loader2,
  AlertCircle,
  ChevronDown,
  ChevronRight,
  Sparkles,
  Clock,
  Trash2,
  X,
  Cpu,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { cleanNoteContent } from '@/lib/formatters'
import { useLiveNotes } from '@/hooks/useLiveNotes'
import type { LiveNoteItem, LiveNoteType } from '@/stores/live-notes-store'

// ============================================================================
// Types
// ============================================================================

export interface LiveNotesPanelProps {
  /** Meeting ID for the current recording */
  meetingId: string
  /** Whether recording is currently active */
  isRecording: boolean
  /** Whether live notes generation is enabled */
  enabled?: boolean
  /** Compact display mode */
  compact?: boolean
  /** Additional class names */
  className?: string
  /** Callback when panel is closed/collapsed */
  onClose?: () => void
}

interface NoteTypeConfig {
  type: LiveNoteType
  label: string
  icon: React.ComponentType<{ className?: string }>
  bgColor: string
  textColor: string
  borderColor: string
}

// ============================================================================
// Constants
// ============================================================================

const NOTE_TYPE_CONFIGS: NoteTypeConfig[] = [
  {
    type: 'key_point',
    label: 'Key Points',
    icon: Lightbulb,
    bgColor: 'bg-amber-50 dark:bg-amber-950/30',
    textColor: 'text-amber-700 dark:text-amber-400',
    borderColor: 'border-amber-200 dark:border-amber-800',
  },
  {
    type: 'action_item',
    label: 'Action Items',
    icon: CheckCircle2,
    bgColor: 'bg-blue-50 dark:bg-blue-950/30',
    textColor: 'text-blue-700 dark:text-blue-400',
    borderColor: 'border-blue-200 dark:border-blue-800',
  },
  {
    type: 'decision',
    label: 'Decisions',
    icon: Gavel,
    bgColor: 'bg-purple-50 dark:bg-purple-950/30',
    textColor: 'text-purple-700 dark:text-purple-400',
    borderColor: 'border-purple-200 dark:border-purple-800',
  },
  {
    type: 'topic',
    label: 'Topics',
    icon: Tag,
    bgColor: 'bg-green-50 dark:bg-green-950/30',
    textColor: 'text-green-700 dark:text-green-400',
    borderColor: 'border-green-200 dark:border-green-800',
  },
]

const PRIORITY_COLORS = {
  high: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400',
  medium: 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400',
  low: 'bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-400',
}

// ============================================================================
// Helper Components
// ============================================================================

interface NoteItemProps {
  note: LiveNoteItem
  config: NoteTypeConfig
  onRemove?: (id: string) => void
}

function NoteItemDisplay({ note, config, onRemove }: NoteItemProps) {
  const Icon = config.icon

  return (
    <div
      className={cn(
        'group relative flex items-start gap-2 p-2 rounded-lg transition-colors',
        'hover:bg-muted/50'
      )}
    >
      <Icon className={cn('w-4 h-4 mt-0.5 flex-shrink-0', config.textColor)} />
      <div className="flex-1 min-w-0">
        <p className="text-sm text-foreground leading-relaxed">{cleanNoteContent(note.content)}</p>
        <div className="flex flex-wrap items-center gap-2 mt-1">
          {/* Preliminary badge */}
          {note.isPreliminary && (
            <span className="inline-flex items-center gap-1 px-1.5 py-0.5 text-[10px] font-medium bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400 rounded">
              <Sparkles className="w-2.5 h-2.5" />
              Live
            </span>
          )}

          {/* Priority badge for action items */}
          {note.type === 'action_item' && note.priority && (
            <span
              className={cn(
                'px-1.5 py-0.5 text-[10px] font-medium rounded',
                PRIORITY_COLORS[note.priority]
              )}
            >
              {note.priority}
            </span>
          )}

          {/* Assignee for action items */}
          {note.type === 'action_item' && note.assignee && (
            <span className="text-[10px] text-muted-foreground">
              @{note.assignee}
            </span>
          )}

          {/* Speaker if available */}
          {note.speaker && (
            <span className="text-[10px] text-muted-foreground italic">
              {note.speaker}
            </span>
          )}

          {/* Timestamp */}
          <span className="text-[10px] text-muted-foreground">
            {new Date(note.extractedAt).toLocaleTimeString([], {
              hour: '2-digit',
              minute: '2-digit',
            })}
          </span>
        </div>
      </div>

      {/* Remove button */}
      {onRemove && (
        <button
          onClick={() => onRemove(note.id)}
          className="opacity-0 group-hover:opacity-100 p-1 text-muted-foreground hover:text-destructive transition-opacity"
          title="Remove note"
        >
          <Trash2 className="w-3.5 h-3.5" />
        </button>
      )}
    </div>
  )
}

interface NoteSectionProps {
  config: NoteTypeConfig
  notes: LiveNoteItem[]
  defaultExpanded?: boolean
  onRemoveNote?: (id: string) => void
}

function NoteSection({
  config,
  notes,
  defaultExpanded = true,
  onRemoveNote,
}: NoteSectionProps) {
  const [isExpanded, setIsExpanded] = useState(defaultExpanded)
  const Icon = config.icon

  if (notes.length === 0) {
    return null
  }

  return (
    <div className={cn('border rounded-lg overflow-hidden', config.borderColor)}>
      {/* Section Header */}
      <button
        onClick={() => setIsExpanded(!isExpanded)}
        className={cn(
          'w-full flex items-center justify-between px-3 py-2',
          config.bgColor
        )}
      >
        <div className="flex items-center gap-2">
          <Icon className={cn('w-4 h-4', config.textColor)} />
          <span className={cn('text-sm font-medium', config.textColor)}>
            {config.label}
          </span>
          <span
            className={cn(
              'px-1.5 py-0.5 text-xs rounded-full',
              config.bgColor,
              config.textColor
            )}
          >
            {notes.length}
          </span>
        </div>
        {isExpanded ? (
          <ChevronDown className={cn('w-4 h-4', config.textColor)} />
        ) : (
          <ChevronRight className={cn('w-4 h-4', config.textColor)} />
        )}
      </button>

      {/* Section Content */}
      {isExpanded && (
        <div className="p-2 space-y-1 bg-card">
          {notes.map((note) => (
            <NoteItemDisplay
              key={note.id}
              note={note}
              config={config}
              onRemove={onRemoveNote}
            />
          ))}
        </div>
      )}
    </div>
  )
}

// ============================================================================
// Main Component
// ============================================================================

export function LiveNotesPanel({
  meetingId: _meetingId, // Unused - session managed by LiveTranscriptionProvider
  isRecording,
  enabled = true,
  compact = false,
  className,
  onClose,
}: LiveNotesPanelProps) {
  // Read state from store - session is managed globally by LiveTranscriptionProvider
  const {
    status,
    isActive,
    keyPoints,
    actionItems,
    decisions,
    topics,
    batchState,
    error,
    notesCount,
    llmProvider,
    saveProgress,
    removeNote,
  } = useLiveNotes()

  // NOTE: Session lifecycle (start/stop/pause/resume) is now managed globally by
  // LiveTranscriptionProvider. This component only displays the live notes state.

  // Group notes by type with memoization
  const notesByType = useMemo(() => {
    return NOTE_TYPE_CONFIGS.map((config) => {
      let notes: LiveNoteItem[]
      switch (config.type) {
        case 'key_point':
          notes = keyPoints
          break
        case 'action_item':
          notes = actionItems
          break
        case 'decision':
          notes = decisions
          break
        case 'topic':
          notes = topics
          break
        default:
          notes = []
      }
      return { config, notes }
    })
  }, [keyPoints, actionItems, decisions, topics])

  // Don't render if not enabled
  if (!enabled) {
    return null
  }

  // Compact mode - just show summary
  if (compact) {
    return (
      <div
        className={cn(
          'flex items-center gap-2 px-3 py-2 rounded-lg',
          'bg-gradient-to-r from-purple-50 to-blue-50 dark:from-purple-950/30 dark:to-blue-950/30',
          'border border-purple-200 dark:border-purple-800',
          className
        )}
        data-testid="live-notes-compact"
      >
        <Sparkles className="w-4 h-4 text-purple-600 dark:text-purple-400" />
        <span className="text-sm font-medium text-purple-700 dark:text-purple-300">
          Live Notes
        </span>
        {status === 'processing' && (
          <Loader2 className="w-3.5 h-3.5 text-purple-500 animate-spin" />
        )}
        <span className="text-xs text-muted-foreground">
          {notesCount} insight{notesCount !== 1 ? 's' : ''}
        </span>
      </div>
    )
  }

  // Full panel view
  return (
    <div
      className={cn(
        'bg-card border border-border rounded-lg overflow-hidden',
        className
      )}
      data-testid="live-notes-panel"
    >
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 bg-gradient-to-r from-purple-50 to-blue-50 dark:from-purple-950/30 dark:to-blue-950/30 border-b border-border">
        <div className="flex items-center gap-2">
          <Sparkles className="w-5 h-5 text-purple-600 dark:text-purple-400" />
          <span className="font-medium text-foreground">Live Meeting Notes</span>

          {/* Status indicator */}
          {status === 'active' && (
            <span className="flex items-center gap-1 px-2 py-0.5 text-xs bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400 rounded-full">
              <span className="w-1.5 h-1.5 bg-green-500 rounded-full animate-pulse" />
              Active
            </span>
          )}
          {status === 'processing' && (
            <span className="flex items-center gap-1 px-2 py-0.5 text-xs bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400 rounded-full">
              <Loader2 className="w-3 h-3 animate-spin" />
              Processing
            </span>
          )}
          {status === 'paused' && (
            <span className="px-2 py-0.5 text-xs bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400 rounded-full">
              Paused
            </span>
          )}
          {status === 'starting' && (
            <span className="flex items-center gap-1 px-2 py-0.5 text-xs bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-400 rounded-full">
              <Loader2 className="w-3 h-3 animate-spin" />
              Starting
            </span>
          )}
          {status === 'saving' && (
            <span className="flex items-center gap-1 px-2 py-0.5 text-xs bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400 rounded-full">
              <Loader2 className="w-3 h-3 animate-spin" />
              Saving...
            </span>
          )}
          {status === 'error' && (
            <span className="flex items-center gap-1 px-2 py-0.5 text-xs bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400 rounded-full">
              <AlertCircle className="w-3 h-3" />
              Error
            </span>
          )}
        </div>

        {/* Close button */}
        {onClose && (
          <button
            onClick={onClose}
            className="p-1 text-muted-foreground hover:text-foreground transition-colors"
            title="Close panel"
          >
            <X className="w-4 h-4" />
          </button>
        )}
      </div>

      {/* Content */}
      <div className="p-4">
        {/* Error display */}
        {error && (
          <div className="mb-4 flex items-start gap-2 p-3 bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-800 rounded-lg">
            <AlertCircle className="w-4 h-4 text-red-600 dark:text-red-400 mt-0.5 flex-shrink-0" />
            <div className="flex-1">
              <p className="text-sm font-medium text-red-700 dark:text-red-300">
                {error.message}
              </p>
              {error.recoverable && (
                <p className="text-xs text-red-600 dark:text-red-400 mt-1">
                  This error may resolve automatically
                </p>
              )}
            </div>
          </div>
        )}

        {/* LLM Unavailable error - shown when error contains LLM_UNAVAILABLE */}
        {error?.code === 'LLM_UNAVAILABLE' && (
          <div className="mb-4 flex items-start gap-2 p-3 bg-yellow-50 dark:bg-yellow-950/30 border border-yellow-200 dark:border-yellow-800 rounded-lg">
            <AlertCircle className="w-4 h-4 text-yellow-600 dark:text-yellow-400 mt-0.5 flex-shrink-0" />
            <div className="flex-1">
              <p className="text-sm font-medium text-yellow-700 dark:text-yellow-300">
                LLM Provider Unavailable
              </p>
              <p className="text-xs text-yellow-600 dark:text-yellow-400 mt-1">
                {error.message}
              </p>
            </div>
          </div>
        )}

        {/* Save progress display */}
        {status === 'saving' && saveProgress && (
          <div className="mb-4 p-3 bg-emerald-50 dark:bg-emerald-950/30 border border-emerald-200 dark:border-emerald-800 rounded-lg">
            <div className="flex items-center gap-2 mb-2">
              <Loader2 className="w-4 h-4 text-emerald-600 dark:text-emerald-400 animate-spin" />
              <span className="text-sm font-medium text-emerald-700 dark:text-emerald-300">
                Saving {saveProgress.currentType === 'notes' ? 'notes' : 'tasks'}...
              </span>
            </div>
            <div className="w-full bg-emerald-200 dark:bg-emerald-800 rounded-full h-2">
              <div
                className="bg-emerald-600 dark:bg-emerald-400 h-2 rounded-full transition-all duration-300"
                style={{ width: `${(saveProgress.saved / saveProgress.total) * 100}%` }}
              />
            </div>
            <p className="text-xs text-emerald-600 dark:text-emerald-400 mt-1">
              {saveProgress.saved} of {saveProgress.total} items saved
            </p>
          </div>
        )}

        {/* Notes sections */}
        {notesCount > 0 ? (
          <div className="space-y-3">
            {notesByType.map(
              ({ config, notes }) =>
                notes.length > 0 && (
                  <NoteSection
                    key={config.type}
                    config={config}
                    notes={notes}
                    onRemoveNote={removeNote}
                  />
                )
            )}
          </div>
        ) : (
          // Empty state
          <div className="py-8 text-center">
            {status === 'idle' || status === 'starting' ? (
              <>
                <Sparkles className="w-12 h-12 mx-auto text-muted-foreground/50 mb-3" />
                <p className="text-sm text-muted-foreground">
                  {isRecording
                    ? 'Waiting for enough transcript content...'
                    : 'Start recording to generate live notes'}
                </p>
              </>
            ) : status === 'active' || status === 'processing' ? (
              <>
                <div className="flex items-center justify-center mb-3">
                  <Loader2 className="w-8 h-8 text-purple-500 animate-spin" />
                </div>
                <p className="text-sm text-muted-foreground">
                  Analyzing transcript for insights...
                </p>
                {batchState.pendingSegmentCount > 0 && (
                  <p className="text-xs text-muted-foreground mt-1">
                    {batchState.pendingSegmentCount} segment
                    {batchState.pendingSegmentCount !== 1 ? 's' : ''} pending
                  </p>
                )}
              </>
            ) : (
              <>
                <Sparkles className="w-12 h-12 mx-auto text-muted-foreground/50 mb-3" />
                <p className="text-sm text-muted-foreground">
                  No insights extracted yet
                </p>
              </>
            )}
          </div>
        )}

        {/* Footer stats */}
        {isActive && (
          <div className="mt-4 pt-3 border-t border-border flex items-center justify-between text-xs text-muted-foreground">
            <div className="flex items-center gap-4">
              <span className="flex items-center gap-1">
                <Clock className="w-3.5 h-3.5" />
                {batchState.batchesProcessed} batch
                {batchState.batchesProcessed !== 1 ? 'es' : ''} processed
              </span>
              {llmProvider && (
                <span className="flex items-center gap-1">
                  <Cpu className="w-3.5 h-3.5" />
                  {llmProvider}
                </span>
              )}
            </div>
            <span>
              {notesCount} insight{notesCount !== 1 ? 's' : ''}
            </span>
          </div>
        )}
      </div>

      {/* Preliminary notes disclaimer */}
      {notesCount > 0 && (
        <div className="px-4 py-2 bg-muted/30 border-t border-border">
          <p className="text-[11px] text-muted-foreground text-center">
            <Sparkles className="w-3 h-3 inline-block mr-1" />
            These are preliminary notes generated in real-time. Final notes will be
            refined when recording ends.
          </p>
        </div>
      )}
    </div>
  )
}

export default LiveNotesPanel
