/**
 * IndividualSpeakerBoxViewer Component
 *
 * Displays transcripts with individual speaker boxes that have unique labels
 * and visual distinction for each speaker, even when speakers are unknown.
 */

import { useRef, useEffect, useMemo, useState } from 'react'
import { MessageSquare, Users, LayoutGrid, LayoutList, Settings2 } from 'lucide-react'
import { cn } from '../../lib/utils'
import { SpeakerBox } from './SpeakerBox'
import {
  createIndividualSpeakerBoxes,
  findActiveTranscript,
  getSpeakerStats,
  type IndividualBoxOptions,
  type IndividualSpeakerBox,
} from './transcript-utils'
import type { Transcript, Speaker } from '../../types/database'

// ============================================================================
// Types
// ============================================================================

export interface IndividualSpeakerBoxViewerProps {
  /** Array of transcript entries to display */
  transcripts: Transcript[]
  /** Map of speaker IDs to Speaker objects */
  speakers: Map<string, Speaker>
  /** Current audio playback time in seconds (for highlighting active entry) */
  currentAudioTime?: number
  /** Callback when a timestamp is clicked for audio seeking */
  onSeekAudio?: (timeInSeconds: number) => void
  /** Whether to auto-scroll to the active transcript entry */
  autoScroll?: boolean
  /** Custom empty state message */
  emptyStateMessage?: string
  /** Visual variant for speaker boxes */
  variant?: 'default' | 'compact' | 'card'
  /** Mode for handling unknown speakers */
  unknownSpeakerMode?: IndividualBoxOptions['unknownSpeakerMode']
  /** Whether to show the speaker legend/summary */
  showSpeakerLegend?: boolean
  /** Whether to show view controls */
  showViewControls?: boolean
  /** Additional class names */
  className?: string
}

// ============================================================================
// Speaker Legend Component
// ============================================================================

interface SpeakerLegendProps {
  boxes: IndividualSpeakerBox[]
  className?: string
}

function SpeakerLegend({ boxes, className }: SpeakerLegendProps) {
  const stats = useMemo(() => getSpeakerStats(boxes), [boxes])

  if (stats.length === 0) return null

  return (
    <div
      className={cn(
        'flex flex-wrap items-center gap-3 p-3 rounded-lg bg-muted/30 border border-border/50',
        className
      )}
      role="region"
      aria-label="Speaker summary"
    >
      <div className="flex items-center gap-1.5 text-sm text-muted-foreground">
        <Users className="w-4 h-4" aria-hidden="true" />
        <span>{stats.length} speaker{stats.length !== 1 ? 's' : ''}</span>
      </div>
      <div className="w-px h-4 bg-border" aria-hidden="true" />
      {stats.map((stat) => {
        const colors = getSpeakerColorClasses(stat.colorIndex)
        return (
          <div
            key={stat.speakerId || stat.speakerName}
            className="flex items-center gap-2"
          >
            <div
              className={cn(
                'w-3 h-3 rounded-full',
                colors.avatar.split(' ')[0] // Just the bg color
              )}
              aria-hidden="true"
            />
            <span className="text-xs text-muted-foreground">
              {stat.speakerName}
              <span className="text-muted-foreground/60 ml-1">
                ({stat.totalSegments} segment{stat.totalSegments !== 1 ? 's' : ''})
              </span>
            </span>
          </div>
        )
      })}
    </div>
  )
}

// Helper to get color classes
function getSpeakerColorClasses(colorIndex: number) {
  const colors = [
    { bg: 'bg-purple-100', text: 'text-purple-700', border: 'border-purple-300', avatar: 'bg-purple-200 text-purple-800' },
    { bg: 'bg-blue-100', text: 'text-blue-700', border: 'border-blue-300', avatar: 'bg-blue-200 text-blue-800' },
    { bg: 'bg-green-100', text: 'text-green-700', border: 'border-green-300', avatar: 'bg-green-200 text-green-800' },
    { bg: 'bg-orange-100', text: 'text-orange-700', border: 'border-orange-300', avatar: 'bg-orange-200 text-orange-800' },
    { bg: 'bg-pink-100', text: 'text-pink-700', border: 'border-pink-300', avatar: 'bg-pink-200 text-pink-800' },
    { bg: 'bg-teal-100', text: 'text-teal-700', border: 'border-teal-300', avatar: 'bg-teal-200 text-teal-800' },
    { bg: 'bg-yellow-100', text: 'text-yellow-700', border: 'border-yellow-300', avatar: 'bg-yellow-200 text-yellow-800' },
    { bg: 'bg-indigo-100', text: 'text-indigo-700', border: 'border-indigo-300', avatar: 'bg-indigo-200 text-indigo-800' },
  ]
  return colors[colorIndex % colors.length]
}

// ============================================================================
// View Controls Component
// ============================================================================

type UnknownSpeakerMode = 'group' | 'individual' | 'sequential'

interface ViewControlsProps {
  variant: 'default' | 'compact' | 'card'
  onVariantChange: (variant: 'default' | 'compact' | 'card') => void
  unknownMode: UnknownSpeakerMode
  onUnknownModeChange: (mode: UnknownSpeakerMode) => void
  className?: string
}

function ViewControls({
  variant,
  onVariantChange,
  unknownMode,
  onUnknownModeChange,
  className
}: ViewControlsProps) {
  const [showSettings, setShowSettings] = useState(false)

  return (
    <div className={cn('flex items-center gap-2', className)}>
      {/* Layout toggle */}
      <div className="flex items-center rounded-lg border border-border bg-muted/30 p-0.5">
        <button
          onClick={() => onVariantChange('default')}
          className={cn(
            'p-1.5 rounded-md transition-colors',
            variant === 'default' ? 'bg-background shadow-sm' : 'hover:bg-muted'
          )}
          title="Default view"
          aria-label="Default view"
          aria-pressed={variant === 'default'}
        >
          <LayoutList className="w-4 h-4" />
        </button>
        <button
          onClick={() => onVariantChange('card')}
          className={cn(
            'p-1.5 rounded-md transition-colors',
            variant === 'card' ? 'bg-background shadow-sm' : 'hover:bg-muted'
          )}
          title="Card view"
          aria-label="Card view"
          aria-pressed={variant === 'card'}
        >
          <LayoutGrid className="w-4 h-4" />
        </button>
      </div>

      {/* Settings dropdown */}
      <div className="relative">
        <button
          onClick={() => setShowSettings(!showSettings)}
          className={cn(
            'p-1.5 rounded-md border border-border transition-colors',
            showSettings ? 'bg-muted' : 'hover:bg-muted/50'
          )}
          title="Speaker display settings"
          aria-label="Speaker display settings"
          aria-expanded={showSettings}
        >
          <Settings2 className="w-4 h-4" />
        </button>

        {showSettings && (
          <div
            className="absolute right-0 top-full mt-1 w-56 rounded-lg border border-border bg-card shadow-lg z-10 p-2"
            role="menu"
          >
            <div className="text-xs font-medium text-muted-foreground px-2 py-1">
              Unknown Speaker Mode
            </div>
            <button
              onClick={() => onUnknownModeChange('group')}
              className={cn(
                'w-full text-left px-2 py-1.5 rounded-md text-sm transition-colors',
                unknownMode === 'group' ? 'bg-primary/10 text-primary' : 'hover:bg-muted'
              )}
              role="menuitem"
            >
              Group together
              <span className="block text-xs text-muted-foreground">
                All unknown speakers in one box
              </span>
            </button>
            <button
              onClick={() => onUnknownModeChange('sequential')}
              className={cn(
                'w-full text-left px-2 py-1.5 rounded-md text-sm transition-colors',
                unknownMode === 'sequential' ? 'bg-primary/10 text-primary' : 'hover:bg-muted'
              )}
              role="menuitem"
            >
              Auto-detect by timing
              <span className="block text-xs text-muted-foreground">
                Use time gaps to distinguish speakers
              </span>
            </button>
            <button
              onClick={() => onUnknownModeChange('individual')}
              className={cn(
                'w-full text-left px-2 py-1.5 rounded-md text-sm transition-colors',
                unknownMode === 'individual' ? 'bg-primary/10 text-primary' : 'hover:bg-muted'
              )}
              role="menuitem"
            >
              Individual boxes
              <span className="block text-xs text-muted-foreground">
                Each segment in its own box
              </span>
            </button>
          </div>
        )}
      </div>
    </div>
  )
}

// ============================================================================
// Empty State Component
// ============================================================================

interface EmptyStateProps {
  message?: string
}

function EmptyState({ message }: EmptyStateProps) {
  return (
    <div
      className="flex flex-col items-center justify-center py-16 text-center"
      data-testid="transcript-empty-state"
    >
      <MessageSquare className="w-12 h-12 text-muted-foreground mb-4" aria-hidden="true" />
      <h3 className="text-lg font-semibold text-foreground mb-2">
        No transcript available
      </h3>
      <p className="text-sm text-muted-foreground max-w-md">
        {message || 'The transcript for this meeting will appear here once available.'}
      </p>
    </div>
  )
}

// ============================================================================
// IndividualSpeakerBoxViewer Component
// ============================================================================

export function IndividualSpeakerBoxViewer({
  transcripts,
  speakers,
  currentAudioTime = 0,
  onSeekAudio,
  autoScroll = true,
  emptyStateMessage,
  variant: initialVariant = 'card',
  unknownSpeakerMode: initialUnknownMode = 'sequential',
  showSpeakerLegend = true,
  showViewControls = true,
  className,
}: IndividualSpeakerBoxViewerProps) {
  const activeEntryRef = useRef<HTMLDivElement>(null)
  const [variant, setVariant] = useState<'default' | 'compact' | 'card'>(initialVariant)
  const [unknownSpeakerMode, setUnknownSpeakerMode] = useState<UnknownSpeakerMode>(initialUnknownMode || 'sequential')

  // Create individual speaker boxes
  const speakerBoxes = useMemo(
    () => createIndividualSpeakerBoxes(transcripts, speakers, {
      unknownSpeakerMode,
      speakerChangeGapMs: 2000,
      autoLabelPrefix: 'Speaker'
    }),
    [transcripts, speakers, unknownSpeakerMode]
  )

  // Find the active transcript based on current audio time
  const activeTranscriptId = useMemo(
    () => findActiveTranscript(transcripts, currentAudioTime),
    [transcripts, currentAudioTime]
  )

  // Auto-scroll to active entry when it changes
  useEffect(() => {
    if (autoScroll && activeEntryRef.current && activeTranscriptId) {
      activeEntryRef.current.scrollIntoView({
        behavior: 'smooth',
        block: 'center',
      })
    }
  }, [activeTranscriptId, autoScroll])

  // Empty state
  if (transcripts.length === 0) {
    return <EmptyState message={emptyStateMessage} />
  }

  return (
    <div
      className={cn('py-4', className)}
      data-testid="individual-speaker-box-viewer"
      role="region"
      aria-label="Meeting transcript with individual speaker boxes"
    >
      {/* Header with controls */}
      {(showSpeakerLegend || showViewControls) && (
        <div className="mb-4 space-y-3">
          {showViewControls && (
            <div className="flex items-center justify-between">
              <span className="text-sm text-muted-foreground">
                {speakerBoxes.length} dialogue box{speakerBoxes.length !== 1 ? 'es' : ''}
              </span>
              <ViewControls
                variant={variant}
                onVariantChange={setVariant}
                unknownMode={unknownSpeakerMode}
                onUnknownModeChange={setUnknownSpeakerMode}
              />
            </div>
          )}
          {showSpeakerLegend && <SpeakerLegend boxes={speakerBoxes} />}
        </div>
      )}

      {/* Speaker Boxes */}
      <div className={cn(
        variant === 'card' ? 'space-y-4' : 'space-y-6'
      )}>
        {speakerBoxes.map((box) => (
          <SpeakerBox
            key={box.boxId}
            group={box}
            variant={variant}
            activeTranscriptId={activeTranscriptId}
            onSeekAudio={onSeekAudio}
            activeEntryRef={activeEntryRef}
            showEntryTimestamps={true}
          />
        ))}
      </div>
    </div>
  )
}

// ============================================================================
// Exports
// ============================================================================

export { SpeakerLegend, ViewControls }
