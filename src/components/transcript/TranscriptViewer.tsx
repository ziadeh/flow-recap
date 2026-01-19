/**
 * TranscriptViewer Component
 * Main container component for displaying timestamped transcripts
 * with speaker labels, color coding, click-to-seek functionality,
 * full-text search with highlighting, and confidence indicators.
 *
 * Performance: Uses react-window virtualization for long transcripts
 * to maintain smooth scrolling with thousands of segments.
 */

import { useRef, useEffect, useMemo, useState, useCallback } from 'react'
import { MessageSquare, Filter, AlertTriangle, Eye, EyeOff } from 'lucide-react'
import { cn } from '../../lib/utils'
import { TranscriptSegment } from './TranscriptSegment'
import {
  VirtualizedTranscriptList,
  type VirtualizedTranscriptListRef,
} from './VirtualizedTranscriptList'
import {
  buildSpeakerColorIndex,
  groupTranscriptsBySpeaker,
  findActiveTranscript,
  type TranscriptGroup,
} from './transcript-utils'
import {
  type ConfidenceThresholds,
  DEFAULT_THRESHOLDS,
  getConfidenceLevel
} from './ConfidenceIndicator'
import type { Transcript, Speaker } from '../../types/database'

// ============================================================================
// Constants
// ============================================================================

/** Minimum number of transcript groups before virtualization kicks in */
const VIRTUALIZATION_THRESHOLD = 30

/** Default height for the virtualized list container */
const DEFAULT_LIST_HEIGHT = 600

// ============================================================================
// Types
// ============================================================================

export type ConfidenceFilterMode = 'all' | 'low' | 'medium' | 'high' | 'needs-review'

export interface TranscriptViewerProps {
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
  /** Search query for highlighting matches */
  searchQuery?: string
  /** Array of transcript IDs that match the search query */
  searchMatchIds?: string[]
  /** ID of the currently focused search match */
  currentSearchMatchId?: string
  /** Whether to show confidence indicators */
  showConfidence?: boolean
  /** Confidence display mode */
  confidenceMode?: 'badge' | 'bar' | 'inline' | 'icon' | 'highlight'
  /** Custom confidence thresholds */
  confidenceThresholds?: ConfidenceThresholds
  /** Initial confidence filter mode */
  initialConfidenceFilter?: ConfidenceFilterMode
  /** Set of transcript IDs with adjusted confidence */
  adjustedConfidenceIds?: Set<string>
  /** Callback when confidence adjustment is requested */
  onAdjustConfidence?: (entryId: string) => void
  /** Whether to show the confidence filter controls */
  showConfidenceFilter?: boolean
  /** Callback when filter changes */
  onConfidenceFilterChange?: (filter: ConfidenceFilterMode) => void
  /** Additional class names */
  className?: string
  /** Height of the virtualized list container (default: 600) */
  listHeight?: number
  /** Whether to use virtualization (default: auto based on item count) */
  enableVirtualization?: boolean
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
// Confidence Filter Bar Component
// ============================================================================

interface ConfidenceFilterBarProps {
  filter: ConfidenceFilterMode
  onFilterChange: (filter: ConfidenceFilterMode) => void
  counts: {
    all: number
    low: number
    medium: number
    high: number
    needsReview: number
  }
  className?: string
}

function ConfidenceFilterBar({
  filter,
  onFilterChange,
  counts,
  className
}: ConfidenceFilterBarProps) {
  const filters: { value: ConfidenceFilterMode; label: string; icon?: React.ReactNode; count: number }[] = [
    { value: 'all', label: 'All', count: counts.all },
    { value: 'low', label: 'Low', icon: <AlertTriangle className="w-3 h-3 text-red-500" />, count: counts.low },
    { value: 'medium', label: 'Medium', icon: <AlertTriangle className="w-3 h-3 text-yellow-500" />, count: counts.medium },
    { value: 'high', label: 'High', icon: <AlertTriangle className="w-3 h-3 text-green-500" />, count: counts.high },
    { value: 'needs-review', label: 'Needs Review', icon: <Eye className="w-3 h-3 text-amber-500" />, count: counts.needsReview },
  ]

  return (
    <div className={cn('flex items-center gap-2 p-2 bg-muted/50 rounded-lg', className)} data-testid="confidence-filter-bar">
      <Filter className="w-4 h-4 text-muted-foreground" />
      <span className="text-sm text-muted-foreground">Filter:</span>
      <div className="flex gap-1">
        {filters.map(({ value, label, icon, count }) => (
          <button
            key={value}
            onClick={() => onFilterChange(value)}
            className={cn(
              'flex items-center gap-1 px-2 py-1 rounded text-xs font-medium transition-colors',
              filter === value
                ? 'bg-primary text-primary-foreground'
                : 'bg-background hover:bg-muted text-foreground'
            )}
            data-testid={`filter-${value}`}
          >
            {icon}
            {label}
            <span className={cn(
              'ml-1 px-1.5 py-0.5 rounded-full text-xs',
              filter === value ? 'bg-primary-foreground/20' : 'bg-muted'
            )}>
              {count}
            </span>
          </button>
        ))}
      </div>
    </div>
  )
}

// ============================================================================
// TranscriptViewer Component
// ============================================================================

export function TranscriptViewer({
  transcripts,
  speakers,
  currentAudioTime = 0,
  onSeekAudio,
  autoScroll = true,
  emptyStateMessage,
  searchQuery,
  searchMatchIds,
  currentSearchMatchId,
  showConfidence = true,
  confidenceMode = 'inline',
  confidenceThresholds = DEFAULT_THRESHOLDS,
  initialConfidenceFilter = 'all',
  adjustedConfidenceIds,
  onAdjustConfidence,
  showConfidenceFilter = false,
  onConfidenceFilterChange,
  className,
  listHeight = DEFAULT_LIST_HEIGHT,
  enableVirtualization,
}: TranscriptViewerProps) {
  const activeEntryRef = useRef<HTMLDivElement>(null)
  const virtualListRef = useRef<VirtualizedTranscriptListRef>(null)
  const [confidenceFilter, setConfidenceFilter] = useState<ConfidenceFilterMode>(initialConfidenceFilter)

  // Handle filter change
  const handleFilterChange = useCallback((filter: ConfidenceFilterMode) => {
    setConfidenceFilter(filter)
    onConfidenceFilterChange?.(filter)
  }, [onConfidenceFilterChange])

  // Calculate confidence counts for filter bar
  const confidenceCounts = useMemo(() => {
    const counts = {
      all: transcripts.length,
      low: 0,
      medium: 0,
      high: 0,
      needsReview: 0
    }

    transcripts.forEach(t => {
      if (t.confidence !== null) {
        const level = getConfidenceLevel(t.confidence, confidenceThresholds)
        if (level === 'low') {
          counts.low++
          counts.needsReview++
        } else if (level === 'medium') {
          counts.medium++
        } else {
          counts.high++
        }
      }
    })

    return counts
  }, [transcripts, confidenceThresholds])

  // Filter transcripts based on confidence filter
  const filteredTranscripts = useMemo(() => {
    if (confidenceFilter === 'all') {
      return transcripts
    }

    return transcripts.filter(t => {
      if (t.confidence === null) {
        // Transcripts without confidence are excluded from filtered views
        return false
      }

      const level = getConfidenceLevel(t.confidence, confidenceThresholds)

      switch (confidenceFilter) {
        case 'low':
          return level === 'low'
        case 'medium':
          return level === 'medium'
        case 'high':
          return level === 'high'
        case 'needs-review':
          return level === 'low'
        default:
          return true
      }
    })
  }, [transcripts, confidenceFilter, confidenceThresholds])

  // Build speaker color index mapping (based on order of appearance)
  const speakerColorIndex = useMemo(
    () => buildSpeakerColorIndex(transcripts), // Use all transcripts for consistent colors
    [transcripts]
  )

  // Group consecutive entries from the same speaker
  const groupedTranscripts = useMemo(
    () => groupTranscriptsBySpeaker(filteredTranscripts, speakers, speakerColorIndex),
    [filteredTranscripts, speakers, speakerColorIndex]
  )

  // Find the active transcript based on current audio time
  const activeTranscriptId = useMemo(
    () => findActiveTranscript(transcripts, currentAudioTime),
    [transcripts, currentAudioTime]
  )

  // Convert search match IDs array to Set for O(1) lookup
  const searchMatchIdsSet = useMemo(
    () => new Set(searchMatchIds || []),
    [searchMatchIds]
  )

  // Determine if virtualization should be used
  const shouldVirtualize = useMemo(() => {
    if (enableVirtualization !== undefined) return enableVirtualization
    return groupedTranscripts.length >= VIRTUALIZATION_THRESHOLD
  }, [enableVirtualization, groupedTranscripts.length])

  // Find index of the active group (for virtualized scrolling)
  const activeGroupIndex = useMemo(() => {
    if (!activeTranscriptId) return -1
    return groupedTranscripts.findIndex(group =>
      group.entries.some(entry => entry.id === activeTranscriptId)
    )
  }, [groupedTranscripts, activeTranscriptId])

  // Find index of the current search match group (for virtualized scrolling)
  const searchMatchGroupIndex = useMemo(() => {
    if (!currentSearchMatchId) return -1
    return groupedTranscripts.findIndex(group =>
      group.entries.some(entry => entry.id === currentSearchMatchId)
    )
  }, [groupedTranscripts, currentSearchMatchId])

  // Auto-scroll to active entry when it changes (during playback)
  useEffect(() => {
    if (autoScroll && activeTranscriptId && !currentSearchMatchId) {
      if (shouldVirtualize) {
        // Use virtualized list scrolling
        if (activeGroupIndex >= 0) {
          virtualListRef.current?.scrollToItem(activeGroupIndex, 'center')
        }
      } else if (activeEntryRef.current) {
        // Use DOM scrolling for non-virtualized list
        activeEntryRef.current.scrollIntoView({
          behavior: 'smooth',
          block: 'center',
        })
      }
    }
  }, [activeTranscriptId, activeGroupIndex, autoScroll, currentSearchMatchId, shouldVirtualize])

  // Scroll to current search match when it changes
  useEffect(() => {
    if (currentSearchMatchId) {
      if (shouldVirtualize && searchMatchGroupIndex >= 0) {
        // Use virtualized list scrolling
        virtualListRef.current?.scrollToItem(searchMatchGroupIndex, 'center')
      } else {
        // Use DOM scrolling for non-virtualized list
        const matchElement = document.querySelector(`[data-entry-id="${currentSearchMatchId}"]`)
        if (matchElement) {
          matchElement.scrollIntoView({
            behavior: 'smooth',
            block: 'center',
          })
        }
      }
    }
  }, [currentSearchMatchId, searchMatchGroupIndex, shouldVirtualize])

  // Render a single transcript segment (used by virtualized list)
  const renderTranscriptGroup = useCallback(
    (group: TranscriptGroup, index: number, _isScrolling: boolean) => (
      <TranscriptSegment
        key={`group-${index}-${group.entries[0]?.id}`}
        group={group}
        activeTranscriptId={activeTranscriptId}
        onSeekAudio={onSeekAudio}
        activeEntryRef={!shouldVirtualize ? activeEntryRef : undefined}
        searchQuery={searchQuery}
        searchMatchIds={searchMatchIdsSet}
        currentSearchMatchId={currentSearchMatchId}
        showConfidence={showConfidence}
        confidenceMode={confidenceMode}
        confidenceThresholds={confidenceThresholds}
        adjustedConfidenceIds={adjustedConfidenceIds}
        onAdjustConfidence={onAdjustConfidence}
      />
    ),
    [
      activeTranscriptId,
      onSeekAudio,
      searchQuery,
      searchMatchIdsSet,
      currentSearchMatchId,
      showConfidence,
      confidenceMode,
      confidenceThresholds,
      adjustedConfidenceIds,
      onAdjustConfidence,
      shouldVirtualize,
    ]
  )

  // Empty state
  if (transcripts.length === 0) {
    return <EmptyState message={emptyStateMessage} />
  }

  // Filtered empty state
  if (filteredTranscripts.length === 0 && confidenceFilter !== 'all') {
    return (
      <div className={cn('space-y-4', className)}>
        {showConfidenceFilter && (
          <ConfidenceFilterBar
            filter={confidenceFilter}
            onFilterChange={handleFilterChange}
            counts={confidenceCounts}
          />
        )}
        <div
          className="flex flex-col items-center justify-center py-16 text-center"
          data-testid="transcript-filtered-empty-state"
        >
          <EyeOff className="w-12 h-12 text-muted-foreground mb-4" aria-hidden="true" />
          <h3 className="text-lg font-semibold text-foreground mb-2">
            No matching segments
          </h3>
          <p className="text-sm text-muted-foreground max-w-md">
            No transcript segments match the selected confidence filter.
            {confidenceFilter === 'needs-review' && " That's great - there are no segments that need review!"}
          </p>
          <button
            onClick={() => handleFilterChange('all')}
            className="mt-4 px-4 py-2 text-sm font-medium bg-primary text-primary-foreground rounded-lg hover:bg-primary/90"
          >
            Show all segments
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className={cn('space-y-4', className)}>
      {showConfidenceFilter && (
        <ConfidenceFilterBar
          filter={confidenceFilter}
          onFilterChange={handleFilterChange}
          counts={confidenceCounts}
        />
      )}

      {shouldVirtualize ? (
        /* Virtualized rendering for long transcripts */
        <div
          data-testid="transcript-viewer"
          data-virtualized="true"
          role="region"
          aria-label="Meeting transcript (virtualized)"
        >
          <VirtualizedTranscriptList
            ref={virtualListRef}
            items={groupedTranscripts}
            height={listHeight}
            renderItem={renderTranscriptGroup}
            estimatedItemHeight={120}
            overscanCount={3}
            virtualizationThreshold={VIRTUALIZATION_THRESHOLD}
            getItemKey={(group, index) => `group-${index}-${group.entries[0]?.id}`}
            className="py-4"
          />
        </div>
      ) : (
        /* Standard rendering for short transcripts */
        <div
          className="py-4 space-y-6"
          data-testid="transcript-viewer"
          data-virtualized="false"
          role="region"
          aria-label="Meeting transcript"
        >
          {groupedTranscripts.map((group, groupIndex) => (
            <TranscriptSegment
              key={`group-${groupIndex}-${group.entries[0]?.id}`}
              group={group}
              activeTranscriptId={activeTranscriptId}
              onSeekAudio={onSeekAudio}
              activeEntryRef={activeEntryRef}
              searchQuery={searchQuery}
              searchMatchIds={searchMatchIdsSet}
              currentSearchMatchId={currentSearchMatchId}
              showConfidence={showConfidence}
              confidenceMode={confidenceMode}
              confidenceThresholds={confidenceThresholds}
              adjustedConfidenceIds={adjustedConfidenceIds}
              onAdjustConfidence={onAdjustConfidence}
            />
          ))}
        </div>
      )}
    </div>
  )
}

// ============================================================================
// Hook for transcript playback synchronization
// ============================================================================

export interface UseTranscriptSyncOptions {
  transcripts: Transcript[]
  currentAudioTime: number
}

export interface UseTranscriptSyncResult {
  activeTranscriptId: string | undefined
  activeTranscript: Transcript | undefined
  progress: number // 0-100 percentage through the transcript
}

/**
 * Hook for synchronizing transcript display with audio playback
 */
export function useTranscriptSync({
  transcripts,
  currentAudioTime,
}: UseTranscriptSyncOptions): UseTranscriptSyncResult {
  const activeTranscriptId = useMemo(
    () => findActiveTranscript(transcripts, currentAudioTime),
    [transcripts, currentAudioTime]
  )

  const activeTranscript = useMemo(
    () => transcripts.find((t) => t.id === activeTranscriptId),
    [transcripts, activeTranscriptId]
  )

  const progress = useMemo(() => {
    if (transcripts.length === 0) return 0
    const lastTranscript = transcripts[transcripts.length - 1]
    if (!lastTranscript || lastTranscript.end_time_ms === 0) return 0
    const currentTimeMs = currentAudioTime * 1000
    return Math.min(100, (currentTimeMs / lastTranscript.end_time_ms) * 100)
  }, [transcripts, currentAudioTime])

  return {
    activeTranscriptId,
    activeTranscript,
    progress,
  }
}
