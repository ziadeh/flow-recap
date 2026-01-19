/**
 * InfiniteScrollTranscriptList Component
 *
 * A high-performance component for displaying transcripts with infinite scroll pagination.
 * Loads transcript groups in chunks of 50-100 lines, keeping DOM size manageable
 * and enabling instant initial render.
 *
 * Features:
 * - Intersection Observer for detecting scroll boundaries
 * - Loading indicators at top and bottom
 * - Smooth scroll position maintenance when loading new chunks
 * - Integration with useInfiniteTranscript hook
 * - Support for auto-scroll to active items
 */

import {
  useRef,
  useEffect,
  useCallback,
  forwardRef,
  useImperativeHandle,
  ReactNode,
} from 'react'
import { cn } from '../../lib/utils'
import { useInfiniteTranscript, type UseInfiniteTranscriptOptions } from './useInfiniteTranscript'
import type { TranscriptGroup } from './transcript-utils'

// ============================================================================
// Types
// ============================================================================

export interface InfiniteScrollTranscriptListProps {
  /** All transcript groups (full data) */
  groups: TranscriptGroup[]
  /** Render function for each group */
  renderGroup: (
    group: TranscriptGroup,
    index: number,
    actualIndex: number
  ) => ReactNode
  /** Number of groups per chunk (default: 75) */
  chunkSize?: number
  /** Maximum chunks to keep in memory (default: 3) */
  maxChunks?: number
  /** Height of the list container */
  height?: number | string
  /** Index to scroll to (for search/playback sync) */
  scrollToIndex?: number
  /** Callback when a group becomes visible */
  onGroupVisible?: (actualIndex: number) => void
  /** Additional class name */
  className?: string
  /** Whether to show loading indicators */
  showLoadingIndicators?: boolean
  /** Custom loading component */
  loadingComponent?: ReactNode
  /** Custom "load more" trigger margin (in pixels) */
  loadTriggerMargin?: number
  /** Test ID for the container */
  testId?: string
}

export interface InfiniteScrollTranscriptListRef {
  /** Scroll to a specific group index in the full data */
  scrollToIndex: (index: number, behavior?: ScrollBehavior) => void
  /** Get the current scroll position */
  getScrollPosition: () => number
  /** Set the scroll position */
  setScrollPosition: (position: number) => void
  /** Reset the list to initial state */
  reset: () => void
  /** Get stats about current state */
  getStats: () => {
    visibleCount: number
    totalCount: number
    startIndex: number
    endIndex: number
  }
}

// ============================================================================
// Loading Indicator Component
// ============================================================================

interface LoadingIndicatorProps {
  position: 'top' | 'bottom'
  isLoading: boolean
  hasMore: boolean
  customComponent?: ReactNode
}

function LoadingIndicator({
  position,
  isLoading,
  hasMore,
  customComponent,
}: LoadingIndicatorProps) {
  if (!hasMore && !isLoading) return null

  if (customComponent) {
    return <>{customComponent}</>
  }

  return (
    <div
      className={cn(
        'flex items-center justify-center py-4 text-sm text-muted-foreground',
        position === 'top' ? 'border-b border-border mb-2' : 'border-t border-border mt-2'
      )}
      data-testid={`infinite-scroll-loading-${position}`}
    >
      {isLoading ? (
        <div className="flex items-center gap-2">
          <div className="w-4 h-4 border-2 border-primary/30 border-t-primary rounded-full animate-spin" />
          <span>Loading more...</span>
        </div>
      ) : hasMore ? (
        <span className="text-xs">Scroll to load more</span>
      ) : null}
    </div>
  )
}

// ============================================================================
// InfiniteScrollTranscriptList Component
// ============================================================================

function InfiniteScrollTranscriptListInner(
  props: InfiniteScrollTranscriptListProps,
  ref: React.Ref<InfiniteScrollTranscriptListRef>
) {
  const {
    groups,
    renderGroup,
    chunkSize = 75,
    maxChunks = 3,
    height = 600,
    scrollToIndex: scrollToIndexProp,
    onGroupVisible,
    className,
    showLoadingIndicators = true,
    loadingComponent,
    loadTriggerMargin = 100,
    testId = 'infinite-scroll-transcript-list',
  } = props

  // Container ref for scroll handling
  const containerRef = useRef<HTMLDivElement>(null)
  const topSentinelRef = useRef<HTMLDivElement>(null)
  const bottomSentinelRef = useRef<HTMLDivElement>(null)

  // Track scroll position for restoration after loading
  const scrollRestorationRef = useRef<{
    scrollTop: number
    scrollHeight: number
    pendingDirection: 'top' | 'bottom' | null
  }>({
    scrollTop: 0,
    scrollHeight: 0,
    pendingDirection: null,
  })

  // Use the infinite transcript hook
  const infiniteOptions: UseInfiniteTranscriptOptions = {
    groups,
    chunkSize,
    maxChunksInMemory: maxChunks,
    seekToIndex: scrollToIndexProp,
  }

  const {
    visibleGroups,
    hasMoreTop,
    hasMoreBottom,
    isLoading,
    loadMoreTop,
    loadMoreBottom,
    reset,
    seekToIndex,
    getActualIndex,
    getVisibleIndex,
    currentOffset,
    stats,
  } = useInfiniteTranscript(infiniteOptions)

  // Scroll to a specific index
  const scrollToIndexHandler = useCallback((index: number, behavior: ScrollBehavior = 'smooth') => {
    // First, ensure the index is visible
    seekToIndex(index)

    // Then scroll to it after a brief delay to allow render
    setTimeout(() => {
      const visibleIndex = getVisibleIndex(index)
      if (visibleIndex >= 0 && containerRef.current) {
        const groupElements = containerRef.current.querySelectorAll('[data-group-index]')
        const targetElement = groupElements[visibleIndex] as HTMLElement

        if (targetElement) {
          targetElement.scrollIntoView({ behavior, block: 'center' })
        }
      }
    }, 50)
  }, [seekToIndex, getVisibleIndex])

  // Expose methods via ref
  useImperativeHandle(ref, () => ({
    scrollToIndex: scrollToIndexHandler,
    getScrollPosition: () => containerRef.current?.scrollTop || 0,
    setScrollPosition: (position: number) => {
      if (containerRef.current) {
        containerRef.current.scrollTop = position
      }
    },
    reset,
    getStats: () => stats,
  }))

  // Set up Intersection Observer for infinite scroll
  useEffect(() => {
    const container = containerRef.current
    const topSentinel = topSentinelRef.current
    const bottomSentinel = bottomSentinelRef.current

    if (!container || !topSentinel || !bottomSentinel) return

    const observerOptions: IntersectionObserverInit = {
      root: container,
      rootMargin: `${loadTriggerMargin}px`,
      threshold: 0,
    }

    const handleIntersection = (entries: IntersectionObserverEntry[]) => {
      entries.forEach((entry) => {
        if (!entry.isIntersecting || isLoading) return

        const target = entry.target as HTMLElement

        if (target === topSentinel && hasMoreTop) {
          // Save scroll position before loading
          scrollRestorationRef.current = {
            scrollTop: container.scrollTop,
            scrollHeight: container.scrollHeight,
            pendingDirection: 'top',
          }
          loadMoreTop()
        } else if (target === bottomSentinel && hasMoreBottom) {
          scrollRestorationRef.current = {
            scrollTop: container.scrollTop,
            scrollHeight: container.scrollHeight,
            pendingDirection: 'bottom',
          }
          loadMoreBottom()
        }
      })
    }

    const observer = new IntersectionObserver(handleIntersection, observerOptions)
    observer.observe(topSentinel)
    observer.observe(bottomSentinel)

    return () => {
      observer.disconnect()
    }
  }, [isLoading, hasMoreTop, hasMoreBottom, loadMoreTop, loadMoreBottom, loadTriggerMargin])

  // Restore scroll position after loading new content at the top
  useEffect(() => {
    const container = containerRef.current
    const restoration = scrollRestorationRef.current

    if (!container || !restoration.pendingDirection || isLoading) return

    if (restoration.pendingDirection === 'top') {
      // Calculate the height difference and adjust scroll
      const heightDiff = container.scrollHeight - restoration.scrollHeight
      if (heightDiff > 0) {
        container.scrollTop = restoration.scrollTop + heightDiff
      }
    }

    // Clear the pending direction
    scrollRestorationRef.current.pendingDirection = null
  }, [visibleGroups, isLoading])

  // Handle scroll to index prop changes
  useEffect(() => {
    if (scrollToIndexProp !== undefined && scrollToIndexProp >= 0) {
      scrollToIndexHandler(scrollToIndexProp, 'smooth')
    }
  }, [scrollToIndexProp, scrollToIndexHandler])

  // Notify about visible groups
  useEffect(() => {
    if (!onGroupVisible || visibleGroups.length === 0) return

    // Report the middle visible group as "current"
    const middleIndex = Math.floor(visibleGroups.length / 2)
    onGroupVisible(getActualIndex(middleIndex))
  }, [visibleGroups, onGroupVisible, getActualIndex])

  const containerStyle = {
    height: typeof height === 'number' ? `${height}px` : height,
    overflowY: 'auto' as const,
  }

  return (
    <div
      ref={containerRef}
      className={cn('relative', className)}
      style={containerStyle}
      data-testid={testId}
      data-total-groups={groups.length}
      data-visible-groups={visibleGroups.length}
      data-offset={currentOffset}
    >
      {/* Top sentinel for intersection observer */}
      <div
        ref={topSentinelRef}
        className="h-1 w-full"
        data-testid="infinite-scroll-top-sentinel"
        aria-hidden="true"
      />

      {/* Top loading indicator */}
      {showLoadingIndicators && (
        <LoadingIndicator
          position="top"
          isLoading={isLoading && hasMoreTop}
          hasMore={hasMoreTop}
          customComponent={loadingComponent}
        />
      )}

      {/* Render visible groups */}
      <div className="space-y-1" data-testid="infinite-scroll-content">
        {visibleGroups.map((group, visibleIndex) => {
          const actualIndex = getActualIndex(visibleIndex)
          return (
            <div
              key={`${group.speakerId || 'unknown'}-${group.entries[0]?.id || visibleIndex}`}
              data-group-index={actualIndex}
              data-visible-index={visibleIndex}
            >
              {renderGroup(group, visibleIndex, actualIndex)}
            </div>
          )
        })}
      </div>

      {/* Bottom loading indicator */}
      {showLoadingIndicators && (
        <LoadingIndicator
          position="bottom"
          isLoading={isLoading && hasMoreBottom}
          hasMore={hasMoreBottom}
          customComponent={loadingComponent}
        />
      )}

      {/* Bottom sentinel for intersection observer */}
      <div
        ref={bottomSentinelRef}
        className="h-1 w-full"
        data-testid="infinite-scroll-bottom-sentinel"
        aria-hidden="true"
      />

      {/* Stats indicator (for development/debugging) */}
      {process.env.NODE_ENV === 'development' && (
        <div
          className="fixed bottom-4 right-4 bg-black/80 text-white text-xs px-2 py-1 rounded font-mono z-50 pointer-events-none"
          style={{ display: 'none' }} // Hidden by default, can be enabled for debugging
        >
          {stats.startIndex}-{stats.endIndex} / {stats.totalCount}
        </div>
      )}
    </div>
  )
}

// Forward ref with proper typing
export const InfiniteScrollTranscriptList = forwardRef(InfiniteScrollTranscriptListInner)

export default InfiniteScrollTranscriptList
