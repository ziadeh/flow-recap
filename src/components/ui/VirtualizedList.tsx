/**
 * VirtualizedList Component
 *
 * Provides efficient rendering of long lists by:
 * - Using native CSS-based virtualization approach
 * - Limiting rendered items to a viewport window
 * - Supporting lazy loading patterns
 *
 * Note: This is a simplified implementation. For production use with
 * thousands of items, consider react-virtualized or @tanstack/virtual.
 */

import { useState, useRef, useCallback, CSSProperties, memo } from 'react'

export interface VirtualizedListProps<T> {
  /** The items to render */
  items: T[]
  /** Height of each item in pixels */
  itemHeight: number
  /** Height of the container in pixels (defaults to 400) */
  height?: number
  /** Custom class name for the container */
  className?: string
  /** Render function for each item */
  renderItem: (item: T, index: number, style: CSSProperties) => React.ReactNode
  /** Minimum number of items before virtualization kicks in (defaults to 100) */
  virtualizationThreshold?: number
  /** Key extractor for items */
  getItemKey?: (item: T, index: number) => string | number
  /** Number of items to render outside the visible area */
  overscanCount?: number
}

/**
 * VirtualizedList - Efficiently renders large lists using windowing.
 *
 * Features:
 * - Only renders visible items plus overscan buffer
 * - Smooth scrolling with CSS positioning
 * - Falls back to regular rendering for small lists
 */
function VirtualizedListInner<T>({
  items,
  itemHeight,
  height = 400,
  className,
  renderItem,
  virtualizationThreshold = 100,
  getItemKey,
  overscanCount = 5,
}: VirtualizedListProps<T>) {
  const containerRef = useRef<HTMLDivElement>(null)
  const [scrollTop, setScrollTop] = useState(0)

  // Handle scroll events
  const handleScroll = useCallback((e: React.UIEvent<HTMLDivElement>) => {
    setScrollTop(e.currentTarget.scrollTop)
  }, [])

  // For small lists, render normally without virtualization
  if (items.length < virtualizationThreshold) {
    return (
      <div
        ref={containerRef}
        className={className}
        style={{ height, overflow: 'auto' }}
      >
        {items.map((item, index) => (
          <div key={getItemKey ? getItemKey(item, index) : index}>
            {renderItem(item, index, { height: itemHeight })}
          </div>
        ))}
      </div>
    )
  }

  // Calculate visible range
  const totalHeight = items.length * itemHeight
  const startIndex = Math.max(0, Math.floor(scrollTop / itemHeight) - overscanCount)
  const endIndex = Math.min(
    items.length,
    Math.ceil((scrollTop + height) / itemHeight) + overscanCount
  )

  // Get visible items
  const visibleItems = items.slice(startIndex, endIndex)

  return (
    <div
      ref={containerRef}
      className={className}
      style={{ height, overflow: 'auto' }}
      onScroll={handleScroll}
    >
      {/* Spacer for total height */}
      <div style={{ height: totalHeight, position: 'relative' }}>
        {/* Render visible items with absolute positioning */}
        {visibleItems.map((item, i) => {
          const actualIndex = startIndex + i
          const top = actualIndex * itemHeight
          return (
            <div
              key={getItemKey ? getItemKey(item, actualIndex) : actualIndex}
              style={{
                position: 'absolute',
                top,
                left: 0,
                right: 0,
                height: itemHeight,
              }}
            >
              {renderItem(item, actualIndex, { height: itemHeight })}
            </div>
          )
        })}
      </div>
    </div>
  )
}

// Memoize the component for performance
export const VirtualizedList = memo(VirtualizedListInner) as typeof VirtualizedListInner

export default VirtualizedList
