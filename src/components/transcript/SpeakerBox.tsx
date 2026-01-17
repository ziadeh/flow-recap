/**
 * SpeakerBox Component
 * Displays a single speaker's dialogue in a visually distinct box
 * with unique identifier, color coding, and accessible design.
 */

import { forwardRef, useMemo } from 'react'
import { User, AlertCircle, Clock } from 'lucide-react'
import { cn } from '../../lib/utils'
import { formatDurationMs, formatTranscriptWithSentenceBreaks } from '../../lib/formatters'
import {
  getSpeakerColor,
  getSpeakerInitials,
  isDiarizationSpeaker,
  isLowConfidence,
  type TranscriptGroup,
  type SpeakerColorConfig
} from './transcript-utils'
import type { Transcript } from '../../types/database'

// ============================================================================
// Types
// ============================================================================

export interface SpeakerBoxProps {
  /** The transcript group containing speaker and entries */
  group: TranscriptGroup
  /** ID of the currently active transcript entry (for highlighting) */
  activeTranscriptId?: string
  /** Callback when a timestamp is clicked for audio seeking */
  onSeekAudio?: (timeInSeconds: number) => void
  /** Ref for the active entry (for auto-scrolling) */
  activeEntryRef?: React.RefObject<HTMLDivElement>
  /** Visual variant: 'default' shows avatar+content, 'compact' shows inline label */
  variant?: 'default' | 'compact' | 'card'
  /** Whether to show individual timestamps for each entry */
  showEntryTimestamps?: boolean
  /** Additional class names */
  className?: string
}

export interface SpeakerEntryProps {
  /** The transcript entry to display */
  entry: Transcript
  /** Whether this entry is currently active (being played) */
  isActive: boolean
  /** Color configuration for styling */
  colors: SpeakerColorConfig
  /** Whether to show timestamps for each entry */
  showTimestamp?: boolean
  /** Callback when timestamp is clicked */
  onTimestampClick?: (timeMs: number) => void
  /** Visual variant */
  variant?: 'default' | 'compact' | 'card'
  /** Additional class names */
  className?: string
}

// ============================================================================
// SpeakerEntry Component
// ============================================================================

const SpeakerEntry = forwardRef<HTMLDivElement, SpeakerEntryProps>(
  function SpeakerEntry({
    entry,
    isActive,
    colors,
    showTimestamp = true,
    onTimestampClick,
    variant = 'default',
    className
  }, ref) {
    const lowConfidence = isLowConfidence(entry.confidence)

    const handleTimestampClick = () => {
      if (onTimestampClick) {
        onTimestampClick(entry.start_time_ms)
      }
    }

    // Card variant - styled like a message bubble
    if (variant === 'card') {
      return (
        <div
          ref={ref}
          className={cn(
            'rounded-xl transition-all duration-200 border-l-4',
            isActive
              ? `${colors.bg} ${colors.border} shadow-md`
              : 'bg-card/50 border-transparent hover:bg-muted/30',
            className
          )}
          data-testid="speaker-entry"
          data-active={isActive}
          data-entry-id={entry.id}
        >
          <div className="p-4">
            {/* Timestamp header */}
            {showTimestamp && (
              <div className="flex items-center gap-2 mb-2">
                <Clock className="w-3 h-3 text-muted-foreground" aria-hidden="true" />
                <button
                  onClick={handleTimestampClick}
                  className={cn(
                    'text-xs font-medium transition-colors',
                    isActive ? colors.text : 'text-muted-foreground hover:text-foreground hover:underline'
                  )}
                  disabled={!onTimestampClick}
                  title="Click to seek to this position"
                  aria-label={`Seek to ${formatDurationMs(entry.start_time_ms)}`}
                >
                  {formatDurationMs(entry.start_time_ms)} - {formatDurationMs(entry.end_time_ms)}
                </button>
              </div>
            )}

            {/* Content */}
            <div className="flex items-start justify-between gap-3">
              <p className="text-sm text-foreground flex-1 whitespace-pre-line leading-relaxed">
                {formatTranscriptWithSentenceBreaks(entry.content)}
              </p>
              {lowConfidence && (
                <div
                  className="flex-shrink-0 text-amber-500"
                  title={`Low confidence: ${Math.round((entry.confidence || 0) * 100)}%`}
                  role="img"
                  aria-label={`Low confidence transcription: ${Math.round((entry.confidence || 0) * 100)}%`}
                >
                  <AlertCircle className="w-4 h-4" />
                </div>
              )}
            </div>

            {/* Interim indicator */}
            {!entry.is_final && (
              <span className="inline-flex items-center gap-1 text-xs text-muted-foreground italic mt-2">
                <span className="w-1.5 h-1.5 rounded-full bg-amber-400 animate-pulse" aria-hidden="true" />
                Processing...
              </span>
            )}
          </div>
        </div>
      )
    }

    // Default and compact variants
    return (
      <div
        ref={ref}
        className={cn(
          'p-3 rounded-lg transition-colors border-l-4',
          isActive
            ? `${colors.bg} ${colors.border}`
            : 'bg-muted/50 border-transparent',
          className
        )}
        data-testid="speaker-entry"
        data-active={isActive}
        data-entry-id={entry.id}
      >
        {/* Timestamp for this specific entry */}
        {showTimestamp && (
          <div className="flex items-center gap-2 mb-1">
            <button
              onClick={handleTimestampClick}
              className="text-xs text-muted-foreground hover:text-foreground hover:underline transition-colors"
              disabled={!onTimestampClick}
              title="Click to seek to this position"
              aria-label={`Seek to ${formatDurationMs(entry.start_time_ms)}`}
            >
              [{formatDurationMs(entry.start_time_ms)} - {formatDurationMs(entry.end_time_ms)}]
            </button>
          </div>
        )}
        <div className="flex items-start justify-between gap-2">
          <p className="text-sm text-foreground flex-1 whitespace-pre-line">
            {formatTranscriptWithSentenceBreaks(entry.content)}
          </p>
          {lowConfidence && (
            <div
              className="flex-shrink-0 text-amber-600"
              title={`Low confidence: ${Math.round((entry.confidence || 0) * 100)}%`}
              role="img"
              aria-label={`Low confidence transcription: ${Math.round((entry.confidence || 0) * 100)}%`}
            >
              <AlertCircle className="w-4 h-4" />
            </div>
          )}
        </div>
        {!entry.is_final && (
          <span className="text-xs text-muted-foreground italic mt-1 block">
            (Interim)
          </span>
        )}
      </div>
    )
  }
)

// ============================================================================
// SpeakerBox Component
// ============================================================================

export const SpeakerBox = forwardRef<HTMLDivElement, SpeakerBoxProps>(
  function SpeakerBox({
    group,
    activeTranscriptId,
    onSeekAudio,
    activeEntryRef,
    variant = 'default',
    showEntryTimestamps = true,
    className,
  }, ref) {
    const { speakerName, entries, colorIndex } = group
    const firstEntry = entries[0]
    const colors = getSpeakerColor(speakerName, colorIndex)
    const isAutoDetected = isDiarizationSpeaker(speakerName)
    const initials = getSpeakerInitials(speakerName)

    // Calculate total duration of this speaker's segment
    const segmentDuration = useMemo(() => {
      if (entries.length === 0) return 0
      const lastEntry = entries[entries.length - 1]
      return lastEntry.end_time_ms - firstEntry.start_time_ms
    }, [entries, firstEntry])

    const handleTimestampClick = () => {
      if (onSeekAudio) {
        onSeekAudio(firstEntry.start_time_ms / 1000)
      }
    }

    // Card variant - message bubble style with prominent speaker identity
    if (variant === 'card') {
      return (
        <div
          ref={ref}
          className={cn(
            'rounded-2xl border transition-all duration-200',
            `border-l-4 ${colors.border}`,
            'bg-card shadow-sm hover:shadow-md',
            className
          )}
          data-testid="speaker-box"
          data-speaker={speakerName}
          role="region"
          aria-label={`Dialogue from ${speakerName}`}
        >
          {/* Speaker Header */}
          <div className={cn(
            'flex items-center gap-3 px-4 py-3 border-b border-border/50 rounded-t-2xl',
            `${colors.bg}`
          )}>
            {/* Avatar */}
            <div
              className={cn(
                'w-10 h-10 rounded-full flex items-center justify-center font-bold text-sm shadow-sm',
                colors.avatar
              )}
              title={speakerName}
              aria-hidden="true"
            >
              {initials}
            </div>

            {/* Speaker Info */}
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <span className={cn('font-semibold', colors.text)}>
                  {speakerName}
                </span>
                {isAutoDetected && (
                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs bg-muted text-muted-foreground">
                    <User className="w-3 h-3" aria-hidden="true" />
                    auto-detected
                  </span>
                )}
              </div>
              <div className="flex items-center gap-2 mt-0.5">
                <button
                  onClick={handleTimestampClick}
                  className="text-xs text-muted-foreground hover:text-foreground hover:underline transition-colors"
                  disabled={!onSeekAudio}
                  title="Click to seek to this position"
                  aria-label={`Start time: ${formatDurationMs(firstEntry.start_time_ms)}`}
                >
                  {formatDurationMs(firstEntry.start_time_ms)}
                </button>
                {entries.length > 1 && (
                  <span className="text-xs text-muted-foreground">
                    • {entries.length} segments • {formatDurationMs(segmentDuration)}
                  </span>
                )}
              </div>
            </div>
          </div>

          {/* Transcript Entries */}
          <div className="p-3 space-y-2">
            {entries.map((entry) => {
              const isActive = entry.id === activeTranscriptId
              return (
                <SpeakerEntry
                  key={entry.id}
                  ref={isActive && activeEntryRef ? activeEntryRef : undefined}
                  entry={entry}
                  isActive={isActive}
                  colors={colors}
                  variant="card"
                  showTimestamp={showEntryTimestamps}
                  onTimestampClick={onSeekAudio ? (timeMs) => onSeekAudio(timeMs / 1000) : undefined}
                />
              )
            })}
          </div>
        </div>
      )
    }

    // Compact variant - inline label style
    if (variant === 'compact') {
      return (
        <div
          ref={ref}
          className={cn('flex flex-col gap-2', className)}
          data-testid="speaker-box"
          data-speaker={speakerName}
          role="region"
          aria-label={`Dialogue from ${speakerName}`}
        >
          {/* Compact header */}
          <div className="flex items-center gap-2">
            <div
              className={cn(
                'w-6 h-6 rounded-full flex items-center justify-center font-semibold text-xs',
                colors.avatar
              )}
              title={speakerName}
              aria-hidden="true"
            >
              {initials}
            </div>
            <span className={cn('font-medium text-sm', colors.text)}>
              {speakerName}
            </span>
            <button
              onClick={handleTimestampClick}
              className="text-xs text-muted-foreground hover:underline"
              disabled={!onSeekAudio}
              aria-label={`Seek to ${formatDurationMs(firstEntry.start_time_ms)}`}
            >
              {formatDurationMs(firstEntry.start_time_ms)}
            </button>
          </div>

          {/* Entries */}
          <div className="pl-8 space-y-1.5">
            {entries.map((entry) => {
              const isActive = entry.id === activeTranscriptId
              return (
                <SpeakerEntry
                  key={entry.id}
                  ref={isActive && activeEntryRef ? activeEntryRef : undefined}
                  entry={entry}
                  isActive={isActive}
                  colors={colors}
                  variant="compact"
                  showTimestamp={showEntryTimestamps}
                  onTimestampClick={onSeekAudio ? (timeMs) => onSeekAudio(timeMs / 1000) : undefined}
                />
              )
            })}
          </div>
        </div>
      )
    }

    // Default variant - original layout with enhanced styling
    return (
      <div
        ref={ref}
        className={cn('flex gap-4', className)}
        data-testid="speaker-box"
        data-speaker={speakerName}
        role="region"
        aria-label={`Dialogue from ${speakerName}`}
      >
        {/* Speaker Tag with Avatar */}
        <div className="flex-shrink-0 w-10">
          <div
            className={cn(
              'w-10 h-10 rounded-full flex items-center justify-center font-semibold text-sm',
              'shadow-sm ring-2 ring-background',
              colors.avatar
            )}
            title={speakerName}
            aria-hidden="true"
          >
            {initials}
          </div>
        </div>

        {/* Transcript content */}
        <div className="flex-1 min-w-0">
          {/* Speaker name and timestamp header */}
          <div className="flex items-baseline gap-2 mb-2 flex-wrap">
            <span className={cn('font-semibold', colors.text)}>
              {speakerName}
            </span>
            {isAutoDetected && (
              <span className="text-xs text-muted-foreground">(auto-detected)</span>
            )}
            <button
              onClick={handleTimestampClick}
              className={cn(
                'text-xs text-muted-foreground hover:underline transition-colors',
                `hover:${colors.text}`
              )}
              disabled={!onSeekAudio}
              title="Click to seek to this position"
              aria-label={`Seek to ${formatDurationMs(firstEntry.start_time_ms)}`}
            >
              {formatDurationMs(firstEntry.start_time_ms)}
            </button>
          </div>

          {/* Transcript entries */}
          <div className="space-y-2">
            {entries.map((entry) => {
              const isActive = entry.id === activeTranscriptId
              return (
                <SpeakerEntry
                  key={entry.id}
                  ref={isActive && activeEntryRef ? activeEntryRef : undefined}
                  entry={entry}
                  isActive={isActive}
                  colors={colors}
                  showTimestamp={showEntryTimestamps}
                  onTimestampClick={onSeekAudio ? (timeMs) => onSeekAudio(timeMs / 1000) : undefined}
                />
              )
            })}
          </div>
        </div>
      </div>
    )
  }
)

// ============================================================================
// Exports
// ============================================================================

export { SpeakerEntry }
