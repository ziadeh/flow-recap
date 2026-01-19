/**
 * VirtualizedTranscriptList Component
 *
 * Provides efficient rendering of long transcript lists using react-window v2's
 * List component with dynamic row heights. This component is designed to handle
 * thousands of transcript segments while maintaining smooth scrolling performance.
 *
 * Features:
 * - Variable height items based on content length
 * - Dynamic height recalculation via ResizeObserver
 * - Support for auto-scrolling to active items
 * - Efficient DOM recycling
 */

import {
  useRef,
  useCallback,
  useEffect,
  forwardRef,
  useImperativeHandle,
  CSSProperties,
  ReactElement,
} from 'react'
import { List, useDynamicRowHeight, useListRef } from 'react-window'
import type { TranscriptGroup } from './transcript-utils'

// ============================================================================
// Types
// ============================================================================

export interface VirtualizedTranscriptListProps<T = TranscriptGroup> {
  /** Array of items to render (transcript groups) */
  items: T[]
  /** Height of the list container */
  height: number
  /** Render function for each item */
  renderItem: (item: T, index: number, isScrolling: boolean) => React.ReactNode
  /** Estimated item height for initial render (default: 120) */
  estimatedItemHeight?: number
  /** Number of items to render outside visible area (default: 3) */
  overscanCount?: number
  /** Key extractor for items */
  getItemKey?: (item: T, index: number) => string
  /** Additional class name for the list container */
  className?: string
  /** Threshold for virtualization (below this count, render all items) */
  virtualizationThreshold?: number
}

export interface VirtualizedTranscriptListRef {
  /** Scroll to a specific item by index */
  scrollToItem: (index: number, align?: 'auto' | 'start' | 'center' | 'end') => void
  /** Reset cached item heights (call after content changes) */
  resetHeights: () => void
}

// ============================================================================
// Row Props Interface (for react-window v2)
// ============================================================================

interface RowData<T> {
  items: T[]
  renderItem: (item: T, index: number, isScrolling: boolean) => React.ReactNode
}

// ============================================================================
// TranscriptRow Component (for react-window v2)
// ============================================================================

function TranscriptRow<T>({
  index,
  style,
  items,
  renderItem,
  ariaAttributes,
}: {
  ariaAttributes: {
    'aria-posinset': number
    'aria-setsize': number
    role: 'listitem'
  }
  index: number
  style: CSSProperties
  items: T[]
  renderItem: (item: T, index: number, isScrolling: boolean) => React.ReactNode
}): ReactElement | null {
  const item = items[index]
  if (!item) return null

  return (
    <div style={style} {...ariaAttributes} data-row-index={index}>
      {renderItem(item, index, false)}
    </div>
  )
}

// ============================================================================
// VirtualizedTranscriptList Component
// ============================================================================

function VirtualizedTranscriptListInner<T = TranscriptGroup>(
  props: VirtualizedTranscriptListProps<T>,
  ref: React.Ref<VirtualizedTranscriptListRef>
) {
  const {
    items,
    height,
    renderItem,
    estimatedItemHeight = 120,
    overscanCount = 3,
    getItemKey,
    className,
    virtualizationThreshold = 20,
  } = props

  const listRef = useListRef()
  const containerRef = useRef<HTMLDivElement>(null)

  // Use dynamic row heights for variable content
  const dynamicRowHeight = useDynamicRowHeight({
    defaultRowHeight: estimatedItemHeight,
    key: items.length, // Reset when items change
  })

  // Observe row elements to measure their actual heights
  useEffect(() => {
    if (containerRef.current && items.length >= virtualizationThreshold) {
      // Wait for next frame to ensure elements are rendered
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
  }, [items.length, dynamicRowHeight, virtualizationThreshold])

  // Expose methods via ref
  useImperativeHandle(ref, () => ({
    scrollToItem: (index: number, align: 'auto' | 'start' | 'center' | 'end' = 'center') => {
      listRef.current?.scrollToRow({
        index,
        align,
        behavior: 'smooth',
      })
    },
    resetHeights: () => {
      // Dynamic height cache is automatically reset when key changes
    },
  }))

  // For small lists, render without virtualization
  if (items.length < virtualizationThreshold) {
    return (
      <div
        ref={containerRef}
        className={className}
        style={{ height, overflow: 'auto' }}
      >
        {items.map((item, index) => (
          <div key={getItemKey ? getItemKey(item, index) : index}>
            {renderItem(item, index, false)}
          </div>
        ))}
      </div>
    )
  }

  // Row props to pass to each row
  const rowProps: RowData<T> = {
    items,
    renderItem,
  }

  return (
    <div ref={containerRef} className={className}>
      <List<RowData<T>>
        listRef={listRef as any}
        rowCount={items.length}
        rowHeight={dynamicRowHeight}
        rowComponent={TranscriptRow as any}
        rowProps={rowProps}
        overscanCount={overscanCount}
        style={{ height }}
      />
    </div>
  )
}

// Forward ref with generics
export const VirtualizedTranscriptList = forwardRef(VirtualizedTranscriptListInner) as <
  T = TranscriptGroup
>(
  props: VirtualizedTranscriptListProps<T> & { ref?: React.Ref<VirtualizedTranscriptListRef> }
) => JSX.Element

// ============================================================================
// Hook for managing virtualized list state
// ============================================================================

export interface UseVirtualizedListOptions {
  /** Total number of items */
  itemCount: number
  /** Estimated average item height */
  estimatedItemHeight?: number
  /** Index to scroll to */
  scrollToIndex?: number
}

export interface UseVirtualizedListResult {
  /** Ref to attach to VirtualizedTranscriptList */
  listRef: React.RefObject<VirtualizedTranscriptListRef>
  /** Scroll to a specific item */
  scrollToItem: (index: number) => void
  /** Reset item heights after data change */
  resetHeights: () => void
}

export function useVirtualizedList(options: UseVirtualizedListOptions): UseVirtualizedListResult {
  const { scrollToIndex } = options
  const listRef = useRef<VirtualizedTranscriptListRef>(null)

  const scrollToItem = useCallback((index: number) => {
    listRef.current?.scrollToItem(index, 'center')
  }, [])

  const resetHeights = useCallback(() => {
    listRef.current?.resetHeights()
  }, [])

  // Handle external scroll requests
  useEffect(() => {
    if (scrollToIndex !== undefined && scrollToIndex >= 0) {
      scrollToItem(scrollToIndex)
    }
  }, [scrollToIndex, scrollToItem])

  return {
    listRef,
    scrollToItem,
    resetHeights,
  }
}

export default VirtualizedTranscriptList
