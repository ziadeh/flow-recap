/**
 * TranscriptSegment Component
 * Displays a single transcript segment with speaker information,
 * timestamped entries, and click-to-seek functionality.
 * Supports search highlighting with the HighlightedText component.
 */

import { forwardRef, useState, useCallback } from 'react'
import { Wand2, Loader2 } from 'lucide-react'
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
import { HighlightedText } from './TranscriptSearch'
import {
  ConfidenceIndicator,
  ConfidenceHighlight,
  getConfidenceLevel,
  type ConfidenceThresholds,
  DEFAULT_THRESHOLDS
} from './ConfidenceIndicator'
import type { Transcript } from '../../types/database'

// ============================================================================
// Types
// ============================================================================

export interface TranscriptSegmentProps {
  /** The transcript group containing speaker and entries */
  group: TranscriptGroup
  /** ID of the currently active transcript entry (for highlighting) */
  activeTranscriptId?: string
  /** Callback when a timestamp is clicked for audio seeking */
  onSeekAudio?: (timeInSeconds: number) => void
  /** Ref for the active entry (for auto-scrolling) */
  activeEntryRef?: React.RefObject<HTMLDivElement>
  /** Search query for highlighting matches */
  searchQuery?: string
  /** Set of transcript IDs that match the search query */
  searchMatchIds?: Set<string>
  /** ID of the currently focused search match */
  currentSearchMatchId?: string
  /** Callback when correction is requested for an entry */
  onRequestCorrection?: (entryId: string) => void
  /** Whether AI correction is available */
  correctionAvailable?: boolean
  /** ID of entry currently being corrected */
  correctingEntryId?: string
  /** Whether to show confidence indicators */
  showConfidence?: boolean
  /** Confidence display mode */
  confidenceMode?: 'badge' | 'bar' | 'inline' | 'icon' | 'highlight'
  /** Custom confidence thresholds */
  confidenceThresholds?: ConfidenceThresholds
  /** Set of transcript IDs that have been manually adjusted */
  adjustedConfidenceIds?: Set<string>
  /** Callback when confidence adjustment is requested */
  onAdjustConfidence?: (entryId: string) => void
  /** Additional class names */
  className?: string
}

export interface TranscriptEntryProps {
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
  /** Search query for highlighting matches */
  searchQuery?: string
  /** Whether this entry matches the search query */
  isSearchMatch?: boolean
  /** Whether this is the currently focused search match */
  isCurrentSearchMatch?: boolean
  /** Callback when correction button is clicked */
  onRequestCorrection?: (entryId: string) => void
  /** Whether AI correction is available */
  correctionAvailable?: boolean
  /** Whether correction is currently being generated for this entry */
  isGeneratingCorrection?: boolean
  /** Whether to show confidence indicators */
  showConfidence?: boolean
  /** Confidence display mode */
  confidenceMode?: 'badge' | 'bar' | 'inline' | 'icon' | 'highlight'
  /** Custom confidence thresholds */
  confidenceThresholds?: ConfidenceThresholds
  /** Whether this entry has been manually adjusted */
  isConfidenceAdjusted?: boolean
  /** Callback when confidence adjustment is requested */
  onAdjustConfidence?: (entryId: string) => void
  /** Additional class names */
  className?: string
}

// ============================================================================
// TranscriptEntry Component
// ============================================================================

const TranscriptEntry = forwardRef<HTMLDivElement, TranscriptEntryProps>(
  function TranscriptEntry({
    entry,
    isActive,
    colors,
    showTimestamp = true,
    onTimestampClick,
    searchQuery,
    isSearchMatch,
    isCurrentSearchMatch,
    onRequestCorrection,
    correctionAvailable = false,
    isGeneratingCorrection = false,
    showConfidence = true,
    confidenceMode = 'inline',
    confidenceThresholds = DEFAULT_THRESHOLDS,
    isConfidenceAdjusted = false,
    onAdjustConfidence,
    className
  }, ref) {
    const [isHovered, setIsHovered] = useState(false)
    const lowConfidence = isLowConfidence(entry.confidence)
    const confidenceLevel = entry.confidence !== null
      ? getConfidenceLevel(entry.confidence, confidenceThresholds)
      : null
    const needsReview = confidenceLevel === 'low'

    const handleAdjustConfidence = useCallback(() => {
      if (onAdjustConfidence) {
        onAdjustConfidence(entry.id)
      }
    }, [entry.id, onAdjustConfidence])

    const handleTimestampClick = () => {
      if (onTimestampClick) {
        onTimestampClick(entry.start_time_ms)
      }
    }

    const handleCorrectionClick = (e: React.MouseEvent) => {
      e.stopPropagation()
      if (onRequestCorrection && !isGeneratingCorrection) {
        onRequestCorrection(entry.id)
      }
    }

    // Determine styling based on search match status
    const getContainerClasses = () => {
      if (isCurrentSearchMatch) {
        // Current search match - strong highlight
        return 'bg-orange-100 dark:bg-orange-900/50 border-orange-400 ring-2 ring-orange-400'
      }
      if (isSearchMatch) {
        // Search match but not current - subtle highlight
        return 'bg-yellow-50 dark:bg-yellow-900/30 border-yellow-300'
      }
      if (isActive) {
        // Active playback
        return `${colors.bg} ${colors.border}`
      }
      // Default state
      return 'bg-muted/50 border-transparent'
    }

    // Show correction button when hovering or when this is a low confidence entry
    const showCorrectionButton = correctionAvailable && (isHovered || lowConfidence)

    return (
      <div
        ref={ref}
        className={cn(
          'p-3 rounded-lg transition-colors border-l-4 relative group',
          getContainerClasses(),
          className
        )}
        data-testid="transcript-entry"
        data-active={isActive}
        data-entry-id={entry.id}
        data-search-match={isSearchMatch}
        data-current-search-match={isCurrentSearchMatch}
        onMouseEnter={() => setIsHovered(true)}
        onMouseLeave={() => setIsHovered(false)}
      >
        {/* Timestamp for this specific entry */}
        {showTimestamp && (
          <div className="flex items-center justify-between gap-2 mb-1">
            <button
              onClick={handleTimestampClick}
              className="text-xs text-muted-foreground hover:text-foreground hover:underline transition-colors"
              disabled={!onTimestampClick}
              title="Click to seek to this position"
            >
              [{formatDurationMs(entry.start_time_ms)} - {formatDurationMs(entry.end_time_ms)}]
            </button>

            {/* AI Correction Button */}
            {showCorrectionButton && (
              <button
                onClick={handleCorrectionClick}
                disabled={isGeneratingCorrection}
                className={cn(
                  'flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium transition-all',
                  'bg-primary/10 hover:bg-primary/20 text-primary',
                  'disabled:opacity-50 disabled:cursor-not-allowed',
                  lowConfidence && 'animate-pulse'
                )}
                title={lowConfidence
                  ? `Low confidence (${Math.round((entry.confidence || 0) * 100)}%) - Click to suggest corrections`
                  : 'Suggest AI corrections'
                }
                data-testid="correction-button"
              >
                {isGeneratingCorrection ? (
                  <Loader2 className="w-3 h-3 animate-spin" />
                ) : (
                  <Wand2 className="w-3 h-3" />
                )}
                <span className="hidden sm:inline">
                  {isGeneratingCorrection ? 'Correcting...' : 'Correct'}
                </span>
              </button>
            )}
          </div>
        )}
        <div className="flex items-start justify-between gap-2">
          <div className="text-sm text-foreground flex-1 whitespace-pre-line">
            {/* Apply confidence highlighting based on mode */}
            {confidenceMode === 'highlight' && entry.confidence !== null ? (
              <ConfidenceHighlight
                confidence={entry.confidence}
                thresholds={confidenceThresholds}
                showBackground={true}
                className="px-1 py-0.5"
              >
                {searchQuery ? (
                  <HighlightedText
                    text={formatTranscriptWithSentenceBreaks(entry.content)}
                    query={searchQuery}
                    isCurrentMatch={isCurrentSearchMatch}
                  />
                ) : (
                  formatTranscriptWithSentenceBreaks(entry.content)
                )}
              </ConfidenceHighlight>
            ) : (
              <>
                {searchQuery ? (
                  <HighlightedText
                    text={formatTranscriptWithSentenceBreaks(entry.content)}
                    query={searchQuery}
                    isCurrentMatch={isCurrentSearchMatch}
                  />
                ) : (
                  formatTranscriptWithSentenceBreaks(entry.content)
                )}
              </>
            )}
          </div>

          {/* Confidence indicator */}
          <div className="flex-shrink-0 flex items-center gap-1">
            {showConfidence && entry.confidence !== null && confidenceMode !== 'highlight' && (
              <ConfidenceIndicator
                confidence={entry.confidence}
                mode={confidenceMode}
                thresholds={confidenceThresholds}
                needsReview={needsReview}
                isAdjusted={isConfidenceAdjusted}
                onAdjustRequest={onAdjustConfidence ? handleAdjustConfidence : undefined}
                size="sm"
                data-testid="confidence-indicator"
              />
            )}
          </div>
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
// TranscriptSegment Component
// ============================================================================

export function TranscriptSegment({
  group,
  activeTranscriptId,
  onSeekAudio,
  activeEntryRef,
  searchQuery,
  searchMatchIds,
  currentSearchMatchId,
  onRequestCorrection,
  correctionAvailable = false,
  correctingEntryId,
  showConfidence = true,
  confidenceMode = 'inline',
  confidenceThresholds = DEFAULT_THRESHOLDS,
  adjustedConfidenceIds,
  onAdjustConfidence,
  className,
}: TranscriptSegmentProps) {
  const { speakerName, entries, colorIndex } = group
  const firstEntry = entries[0]
  const colors = getSpeakerColor(speakerName, colorIndex)
  const isAutoDetected = isDiarizationSpeaker(speakerName)

  const handleTimestampClick = () => {
    if (onSeekAudio) {
      onSeekAudio(firstEntry.start_time_ms / 1000)
    }
  }

  return (
    <div
      className={cn('flex gap-4', className)}
      data-testid="transcript-segment"
      data-speaker={speakerName}
    >
      {/* Speaker Tag with Avatar */}
      <div className="flex-shrink-0 w-10">
        <div
          className={cn(
            'w-10 h-10 rounded-full flex items-center justify-center font-semibold text-sm',
            colors.avatar
          )}
          title={speakerName}
          data-testid="speaker-avatar"
        >
          {getSpeakerInitials(speakerName)}
        </div>
      </div>

      {/* Transcript content */}
      <div className="flex-1 min-w-0">
        {/* Speaker name and timestamp header */}
        <div className="flex items-baseline gap-2 mb-2">
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
            data-testid="timestamp-button"
            data-time-ms={firstEntry.start_time_ms}
          >
            {formatDurationMs(firstEntry.start_time_ms)}
          </button>
        </div>

        {/* Transcript entries */}
        <div className="space-y-2">
          {entries.map((entry) => {
            const isActive = entry.id === activeTranscriptId
            const isSearchMatch = searchMatchIds?.has(entry.id) ?? false
            const isCurrentSearchMatch = entry.id === currentSearchMatchId
            const isGeneratingCorrection = correctingEntryId === entry.id
            const isConfidenceAdjusted = adjustedConfidenceIds?.has(entry.id) ?? false
            return (
              <TranscriptEntry
                key={entry.id}
                ref={(isActive || isCurrentSearchMatch) && activeEntryRef ? activeEntryRef : undefined}
                entry={entry}
                isActive={isActive}
                colors={colors}
                showTimestamp={true}
                onTimestampClick={onSeekAudio ? (timeMs) => onSeekAudio(timeMs / 1000) : undefined}
                searchQuery={searchQuery}
                isSearchMatch={isSearchMatch}
                isCurrentSearchMatch={isCurrentSearchMatch}
                onRequestCorrection={onRequestCorrection}
                correctionAvailable={correctionAvailable}
                isGeneratingCorrection={isGeneratingCorrection}
                showConfidence={showConfidence}
                confidenceMode={confidenceMode}
                confidenceThresholds={confidenceThresholds}
                isConfidenceAdjusted={isConfidenceAdjusted}
                onAdjustConfidence={onAdjustConfidence}
              />
            )
          })}
        </div>
      </div>
    </div>
  )
}

// ============================================================================
// Exports
// ============================================================================

export { TranscriptEntry }
