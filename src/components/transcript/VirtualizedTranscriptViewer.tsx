/**
 * VirtualizedTranscriptViewer Component
 *
 * A virtualized version of TranscriptViewer that uses react-window
 * to efficiently render only visible transcript segments. This component
 * maintains constant performance regardless of meeting length.
 *
 * Key features:
 * - Uses VariableSizeList for variable-height transcript groups
 * - Supports all existing features: search, confidence, auto-scroll
 * - Recycled DOM elements for optimal memory usage
 * - Falls back to regular rendering for small transcripts (<50 groups)
 */

import { useRef, useEffect, useMemo, useState, useCallback, CSSProperties, ReactElement } from 'react'
import { List, useDynamicRowHeight, useListRef } from 'react-window'
import { MessageSquare, Filter, AlertTriangle, Eye, EyeOff } from 'lucide-react'
import { cn } from '../../lib/utils'
import { TranscriptSegment } from './TranscriptSegment'
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

/** Minimum number of groups before virtualization is enabled */
const VIRTUALIZATION_THRESHOLD = 50

/** Estimated height per transcript entry in pixels */
const ESTIMATED_ENTRY_HEIGHT = 80

/** Base height for speaker header in pixels */
const SPEAKER_HEADER_HEIGHT = 60

/** Extra padding for group spacing */
const GROUP_PADDING = 24

/** Overscan count for smooth scrolling */
const OVERSCAN_COUNT = 5

// ============================================================================
// Types
// ============================================================================

export type ConfidenceFilterMode = 'all' | 'low' | 'medium' | 'high' | 'needs-review'

export interface VirtualizedTranscriptViewerProps {
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
  /** Height of the virtualized list container */
  height?: number
  /** Additional class names */
  className?: string
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
// Row Item Data Interface (for react-window v2)
// ============================================================================

interface RowItemData {
  groups: TranscriptGroup[]
  activeTranscriptId: string | undefined
  onSeekAudio: ((timeInSeconds: number) => void) | undefined
  activeEntryRef: React.RefObject<HTMLDivElement>
  searchQuery: string | undefined
  searchMatchIds: Set<string>
  currentSearchMatchId: string | undefined
  showConfidence: boolean
  confidenceMode: 'badge' | 'bar' | 'inline' | 'icon' | 'highlight'
  confidenceThresholds: ConfidenceThresholds
  adjustedConfidenceIds: Set<string> | undefined
  onAdjustConfidence: ((entryId: string) => void) | undefined
}

// ============================================================================
// Virtualized Row Component (for react-window v2)
// ============================================================================

function VirtualizedRow({
  index,
  style,
  groups,
  activeTranscriptId,
  onSeekAudio,
  activeEntryRef,
  searchQuery,
  searchMatchIds,
  currentSearchMatchId,
  showConfidence,
  confidenceMode,
  confidenceThresholds,
  adjustedConfidenceIds,
  onAdjustConfidence,
  ariaAttributes,
}: {
  ariaAttributes: {
    'aria-posinset': number
    'aria-setsize': number
    role: 'listitem'
  }
  index: number
  style: CSSProperties
} & RowItemData): ReactElement | null {
  const group = groups[index]
  if (!group) return null

  return (
    <div style={style} className="pr-2" {...ariaAttributes} data-row-index={index}>
      <TranscriptSegment
        key={`group-${index}-${group.entries[0]?.id}`}
        group={group}
        activeTranscriptId={activeTranscriptId}
        onSeekAudio={onSeekAudio}
        activeEntryRef={activeEntryRef}
        searchQuery={searchQuery}
        searchMatchIds={searchMatchIds}
        currentSearchMatchId={currentSearchMatchId}
        showConfidence={showConfidence}
        confidenceMode={confidenceMode}
        confidenceThresholds={confidenceThresholds}
        adjustedConfidenceIds={adjustedConfidenceIds}
        onAdjustConfidence={onAdjustConfidence}
      />
    </div>
  )
}

// ============================================================================
// VirtualizedTranscriptViewer Component
// ============================================================================

export function VirtualizedTranscriptViewer({
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
  height = 600,
  className,
}: VirtualizedTranscriptViewerProps) {
  const listRef = useListRef()
  const containerRef = useRef<HTMLDivElement>(null)
  const activeEntryRef = useRef<HTMLDivElement>(null)
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
    () => buildSpeakerColorIndex(transcripts),
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

  // Determine if we should use virtualization
  const useVirtualization = groupedTranscripts.length >= VIRTUALIZATION_THRESHOLD

  // Use dynamic row heights for variable content (react-window v2)
  const dynamicRowHeight = useDynamicRowHeight({
    defaultRowHeight: SPEAKER_HEADER_HEIGHT + ESTIMATED_ENTRY_HEIGHT + GROUP_PADDING,
    key: `${groupedTranscripts.length}-${confidenceFilter}`, // Reset when data changes
  })

  // Observe row elements to measure their actual heights
  useEffect(() => {
    if (containerRef.current && useVirtualization) {
      const timeoutId = setTimeout(() => {
        if (containerRef.current) {
          const elements = containerRef.current.querySelectorAll('[data-row-index]')
          if (elements.length > 0) {
            const cleanup = dynamicRowHeight.observeRowElements(elements)
            return cleanup
          }
        }
      }, 50)

      return () => clearTimeout(timeoutId)
    }
  }, [groupedTranscripts.length, dynamicRowHeight, useVirtualization])

  // Find index of active transcript group
  const activeGroupIndex = useMemo(() => {
    if (!activeTranscriptId) return -1
    return groupedTranscripts.findIndex(group =>
      group.entries.some(entry => entry.id === activeTranscriptId)
    )
  }, [groupedTranscripts, activeTranscriptId])

  // Find index of current search match group
  const searchMatchGroupIndex = useMemo(() => {
    if (!currentSearchMatchId) return -1
    return groupedTranscripts.findIndex(group =>
      group.entries.some(entry => entry.id === currentSearchMatchId)
    )
  }, [groupedTranscripts, currentSearchMatchId])

  // Auto-scroll to active entry when it changes (during playback)
  useEffect(() => {
    if (!useVirtualization) return
    if (!autoScroll) return

    // Prioritize search match over active playback
    if (currentSearchMatchId && searchMatchGroupIndex >= 0) {
      listRef.current?.scrollToRow({ index: searchMatchGroupIndex, align: 'center', behavior: 'smooth' })
      return
    }

    if (activeTranscriptId && activeGroupIndex >= 0) {
      listRef.current?.scrollToRow({ index: activeGroupIndex, align: 'center', behavior: 'smooth' })
    }
  }, [activeTranscriptId, activeGroupIndex, currentSearchMatchId, searchMatchGroupIndex, autoScroll, useVirtualization])

  // Scroll to current search match when it changes (for non-virtualized)
  useEffect(() => {
    if (useVirtualization) return
    if (currentSearchMatchId) {
      const matchElement = document.querySelector(`[data-entry-id="${currentSearchMatchId}"]`)
      if (matchElement) {
        matchElement.scrollIntoView({
          behavior: 'smooth',
          block: 'center',
        })
      }
    }
  }, [currentSearchMatchId, useVirtualization])

  // Item data for the virtualized list
  const itemData = useMemo<RowItemData>(() => ({
    groups: groupedTranscripts,
    activeTranscriptId,
    onSeekAudio,
    activeEntryRef,
    searchQuery,
    searchMatchIds: searchMatchIdsSet,
    currentSearchMatchId,
    showConfidence,
    confidenceMode,
    confidenceThresholds,
    adjustedConfidenceIds,
    onAdjustConfidence,
  }), [
    groupedTranscripts,
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
  ])

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

      {/* Virtualization indicator for debugging */}
      {process.env.NODE_ENV === 'development' && (
        <div className="text-xs text-muted-foreground">
          {useVirtualization
            ? `Virtualized: ${groupedTranscripts.length} groups`
            : `Standard: ${groupedTranscripts.length} groups`}
        </div>
      )}

      <div
        ref={containerRef}
        data-testid="transcript-viewer"
        data-virtualized={useVirtualization}
        role="region"
        aria-label="Meeting transcript"
      >
        {useVirtualization ? (
          <List<RowItemData>
            listRef={listRef as any}
            rowCount={groupedTranscripts.length}
            rowHeight={dynamicRowHeight}
            rowComponent={VirtualizedRow as any}
            rowProps={itemData}
            overscanCount={OVERSCAN_COUNT}
            className="py-4"
            style={{ height, overflowX: 'hidden' }}
          />
        ) : (
          // Fallback to regular rendering for small lists
          <div className="py-4 space-y-6">
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
  progress: number
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

export default VirtualizedTranscriptViewer
