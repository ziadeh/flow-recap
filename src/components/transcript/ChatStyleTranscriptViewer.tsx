/**
 * ChatStyleTranscriptViewer Component
 *
 * Displays transcripts in a chat/messaging style layout with:
 * - A visual speaker timeline at the top
 * - Chat-style message bubbles for each transcript
 * - Color-coded speaker names
 * - Timestamps on the right side
 * - Full-text search with highlighting
 */

import { useRef, useEffect, useMemo } from 'react'
import { MessageSquare } from 'lucide-react'
import { cn } from '../../lib/utils'
import { formatDurationMs, formatTranscriptWithSentenceBreaks } from '../../lib/formatters'
import { SpeakerTimeline, type DiarizationError } from './SpeakerTimeline'
import { HighlightedText } from './TranscriptSearch'
import {
  getSpeakerColor,
  getSpeakerInitials,
  buildSpeakerColorIndex,
  findActiveTranscript,
  groupTranscriptsBySpeaker,
  type TranscriptGroup,
} from './transcript-utils'
import type { Transcript, Speaker } from '../../types/database'

// ============================================================================
// Types
// ============================================================================

export interface ChatStyleTranscriptViewerProps {
  /** Array of transcript entries to display */
  transcripts: Transcript[]
  /** Map of speaker IDs to Speaker objects */
  speakers: Map<string, Speaker>
  /** Map of speaker IDs to meeting-specific display names (overrides speaker.name) */
  speakerNameOverrides?: Map<string, string>
  /** Current audio playback time in seconds */
  currentAudioTime?: number
  /** Callback when a timestamp is clicked for audio seeking */
  onSeekAudio?: (timeInSeconds: number) => void
  /** Whether to auto-scroll to the active transcript */
  autoScroll?: boolean
  /** Whether to show the speaker timeline */
  showTimeline?: boolean
  /** Custom empty state message */
  emptyStateMessage?: string
  /** Diarization error to display */
  diarizationError?: DiarizationError | null
  /** Low confidence threshold (0-1, default 0.7) */
  lowConfidenceThreshold?: number
  /** Total duration in milliseconds (for timeline) */
  totalDurationMs?: number
  /** Search query for highlighting matches */
  searchQuery?: string
  /** Array of transcript IDs that match the search query */
  searchMatchIds?: string[]
  /** ID of the currently focused search match */
  currentSearchMatchId?: string
  /** Additional class names */
  className?: string
}

interface ChatMessageProps {
  /** The transcript group to display */
  group: TranscriptGroup
  /** Whether any entry in this group is currently active */
  isActive: boolean
  /** Callback when timestamp is clicked */
  onTimestampClick?: (timeMs: number) => void
  /** Ref for active entry (for auto-scroll) */
  activeRef?: React.RefObject<HTMLDivElement>
  /** Search query for highlighting matches */
  searchQuery?: string
  /** Whether any entry in this group matches the search query */
  hasSearchMatch?: boolean
  /** Whether this group contains the current search match */
  isCurrentSearchMatch?: boolean
}

// ============================================================================
// ChatMessage Component
// ============================================================================

function ChatMessage({
  group,
  isActive,
  onTimestampClick,
  activeRef,
  searchQuery,
  hasSearchMatch,
  isCurrentSearchMatch
}: ChatMessageProps) {
  const { speakerName, entries, colorIndex } = group
  const firstEntry = entries[0]
  const colors = getSpeakerColor(speakerName, colorIndex)
  const initials = getSpeakerInitials(speakerName)

  // Combine all entries content for this speaker group
  const combinedContent = useMemo(() => {
    return entries.map(e => e.content).join(' ')
  }, [entries])

  const handleTimestampClick = () => {
    if (onTimestampClick) {
      onTimestampClick(firstEntry.start_time_ms)
    }
  }

  // Determine background styling based on search match status
  const getBackgroundClass = () => {
    if (isCurrentSearchMatch) {
      return 'bg-orange-100 dark:bg-orange-900/50 ring-2 ring-orange-400'
    }
    if (hasSearchMatch) {
      return 'bg-yellow-50 dark:bg-yellow-900/30'
    }
    if (isActive) {
      return 'bg-muted/50'
    }
    return 'hover:bg-muted/30'
  }

  return (
    <div
      ref={isActive || isCurrentSearchMatch ? activeRef : undefined}
      className={cn(
        'flex gap-3 px-4 py-3 rounded-lg transition-colors',
        getBackgroundClass()
      )}
      data-testid="chat-message"
      data-speaker={speakerName}
      data-active={isActive}
      data-search-match={hasSearchMatch}
      data-current-search-match={isCurrentSearchMatch}
      data-entry-id={firstEntry.id}
    >
      {/* Avatar with initials */}
      <div
        className={cn(
          'flex-shrink-0 w-10 h-10 rounded-full flex items-center justify-center font-semibold text-sm',
          colors.avatar
        )}
        aria-hidden="true"
      >
        {initials}
      </div>

      {/* Message content */}
      <div className="flex-1 min-w-0">
        {/* Header: Speaker name and timestamp */}
        <div className="flex items-center justify-between mb-1.5">
          {/* Speaker name */}
          <span className={cn('font-semibold text-sm', colors.text)}>
            {speakerName}
          </span>

          {/* Timestamp */}
          <button
            onClick={handleTimestampClick}
            className="text-xs text-muted-foreground hover:text-foreground hover:underline transition-colors ml-2"
            disabled={!onTimestampClick}
            title="Click to seek to this position"
            aria-label={`Seek to ${formatDurationMs(firstEntry.start_time_ms)}`}
          >
            {formatDurationMs(firstEntry.start_time_ms)}
          </button>
        </div>

        {/* Message text with search highlighting */}
        <div className="text-sm text-foreground leading-relaxed whitespace-pre-line">
          {searchQuery ? (
            <HighlightedText
              text={formatTranscriptWithSentenceBreaks(combinedContent)}
              query={searchQuery}
              isCurrentMatch={isCurrentSearchMatch}
            />
          ) : (
            formatTranscriptWithSentenceBreaks(combinedContent)
          )}
        </div>
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
      data-testid="chat-transcript-empty-state"
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
// ChatStyleTranscriptViewer Component
// ============================================================================

export function ChatStyleTranscriptViewer({
  transcripts,
  speakers,
  speakerNameOverrides,
  currentAudioTime = 0,
  onSeekAudio,
  autoScroll = true,
  showTimeline = true,
  emptyStateMessage,
  diarizationError,
  lowConfidenceThreshold,
  totalDurationMs,
  searchQuery,
  searchMatchIds,
  currentSearchMatchId,
  className
}: ChatStyleTranscriptViewerProps) {
  const activeEntryRef = useRef<HTMLDivElement>(null)
  const currentTimeMs = currentAudioTime * 1000

  // Build speaker color index
  const speakerColorIndex = useMemo(
    () => buildSpeakerColorIndex(transcripts),
    [transcripts]
  )

  // Group transcripts by speaker
  const messageGroups = useMemo(
    () => groupTranscriptsBySpeaker(transcripts, speakers, speakerColorIndex, speakerNameOverrides),
    [transcripts, speakers, speakerColorIndex, speakerNameOverrides]
  )

  // Find the active transcript based on current audio time
  const activeTranscriptId = useMemo(
    () => findActiveTranscript(transcripts, currentAudioTime),
    [transcripts, currentAudioTime]
  )

  // Find which group contains the active transcript
  const activeGroupIndex = useMemo(() => {
    if (!activeTranscriptId) return -1
    return messageGroups.findIndex(group =>
      group.entries.some(entry => entry.id === activeTranscriptId)
    )
  }, [messageGroups, activeTranscriptId])

  // Convert search match IDs to Set for O(1) lookup
  const searchMatchIdsSet = useMemo(
    () => new Set(searchMatchIds || []),
    [searchMatchIds]
  )

  // Find which group contains the current search match
  const currentSearchMatchGroupIndex = useMemo(() => {
    if (!currentSearchMatchId) return -1
    return messageGroups.findIndex(group =>
      group.entries.some(entry => entry.id === currentSearchMatchId)
    )
  }, [messageGroups, currentSearchMatchId])

  // Auto-scroll to active entry when it changes (during playback, not search)
  useEffect(() => {
    if (autoScroll && activeEntryRef.current && activeGroupIndex >= 0 && !currentSearchMatchId) {
      activeEntryRef.current.scrollIntoView({
        behavior: 'smooth',
        block: 'center'
      })
    }
  }, [activeGroupIndex, autoScroll, currentSearchMatchId])

  // Scroll to current search match when it changes
  useEffect(() => {
    if (currentSearchMatchId) {
      const matchElement = document.querySelector(`[data-entry-id="${currentSearchMatchId}"]`)
      if (matchElement) {
        matchElement.scrollIntoView({
          behavior: 'smooth',
          block: 'center'
        })
      }
    }
  }, [currentSearchMatchId])

  // Handle seek from timeline
  const handleTimelineSeek = (timeMs: number) => {
    if (onSeekAudio) {
      onSeekAudio(timeMs / 1000)
    }
  }

  // Handle seek from message timestamp
  const handleTimestampClick = (timeMs: number) => {
    if (onSeekAudio) {
      onSeekAudio(timeMs / 1000)
    }
  }

  // Empty state
  if (transcripts.length === 0) {
    return <EmptyState message={emptyStateMessage} />
  }

  return (
    <div
      className={cn('py-4', className)}
      data-testid="chat-style-transcript-viewer"
      role="region"
      aria-label="Meeting transcript in chat format"
    >
      {/* Speaker Timeline */}
      {showTimeline && (
        <div className="mb-6 pb-4 border-b border-border">
          <SpeakerTimeline
            transcripts={transcripts}
            speakers={speakers}
            speakerNameOverrides={speakerNameOverrides}
            currentTimeMs={currentTimeMs}
            totalDurationMs={totalDurationMs}
            onSeek={handleTimelineSeek}
            diarizationError={diarizationError}
            lowConfidenceThreshold={lowConfidenceThreshold}
          />
        </div>
      )}

      {/* Chat Messages */}
      <div className="space-y-1">
        {messageGroups.map((group, index) => {
          const isActive = index === activeGroupIndex
          // Check if any entry in this group matches the search
          const hasSearchMatch = group.entries.some(entry => searchMatchIdsSet.has(entry.id))
          // Check if this group contains the current search match
          const isCurrentSearchMatch = index === currentSearchMatchGroupIndex

          return (
            <ChatMessage
              key={`${group.speakerId || 'unknown'}-${group.entries[0].id}`}
              group={group}
              isActive={isActive}
              onTimestampClick={handleTimestampClick}
              activeRef={(isActive || isCurrentSearchMatch) ? activeEntryRef : undefined}
              searchQuery={searchQuery}
              hasSearchMatch={hasSearchMatch}
              isCurrentSearchMatch={isCurrentSearchMatch}
            />
          )
        })}
      </div>
    </div>
  )
}

export default ChatStyleTranscriptViewer
