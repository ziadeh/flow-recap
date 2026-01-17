/**
 * LiveActionItemsList Component
 *
 * Displays action items as they're detected during live recording.
 * Features:
 * - Real-time updates with new action items appearing as they're detected
 * - Visual states: 'New' (just detected, highlighted), 'Updated' (modified by LLM)
 * - Disabled checkboxes during recording
 * - Assignee badges and priority indicators
 * - Timestamp and confidence display
 * - Auto-scroll to newest items
 * - Empty state messaging
 */

import { useEffect, useRef, useState } from 'react'
import {
  CheckCircle2,
  Circle,
  User,
  Clock,
  Sparkles,
  AlertCircle,
  TrendingUp,
  Loader2,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import type { LiveNoteItem } from '@/stores/live-notes-store'

// ============================================================================
// Types
// ============================================================================

export interface LiveActionItemsListProps {
  /** Action items to display */
  actionItems: LiveNoteItem[]
  /** Whether LLM is currently processing */
  isProcessing?: boolean
  /** Whether to show confidence scores */
  showConfidence?: boolean
  /** Whether to enable auto-scroll to new items */
  enableAutoScroll?: boolean
  /** Empty state message */
  emptyMessage?: string
  /** Additional class names */
  className?: string
  /** Callback when item is clicked */
  onItemClick?: (item: LiveNoteItem) => void
}

// Priority badge colors
const PRIORITY_COLORS = {
  high: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400 border-red-200 dark:border-red-800',
  medium: 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400 border-yellow-200 dark:border-yellow-800',
  low: 'bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-400 border-gray-200 dark:border-gray-700',
}

// ============================================================================
// Helper Components
// ============================================================================

interface ActionItemCardProps {
  item: LiveNoteItem
  isNew: boolean
  showConfidence: boolean
  onClick?: (item: LiveNoteItem) => void
}

function ActionItemCard({ item, isNew, showConfidence, onClick }: ActionItemCardProps) {
  const formatTime = (timestamp: number) => {
    return new Date(timestamp).toLocaleTimeString([], {
      hour: '2-digit',
      minute: '2-digit',
    })
  }

  return (
    <div
      className={cn(
        'group relative p-3 rounded-lg border transition-all duration-300',
        'hover:shadow-md hover:border-blue-300 dark:hover:border-blue-700',
        isNew
          ? 'bg-blue-50 dark:bg-blue-950/30 border-blue-300 dark:border-blue-700 animate-slide-in-fade'
          : 'bg-card border-border',
        onClick && 'cursor-pointer',
        'overflow-hidden'
      )}
      onClick={() => onClick?.(item)}
      data-testid="action-item-card"
    >
      {/* New badge */}
      {isNew && (
        <div className="absolute top-2 right-2">
          <span className="inline-flex items-center gap-1 px-2 py-0.5 text-[10px] font-medium bg-blue-500 text-white rounded-full shadow-sm">
            <Sparkles className="w-2.5 h-2.5" />
            New
          </span>
        </div>
      )}

      <div className="flex items-start gap-3">
        {/* Checkbox (disabled during recording) */}
        <div className="pt-0.5">
          <Circle className="w-5 h-5 text-blue-500 dark:text-blue-400 opacity-50" />
        </div>

        {/* Content */}
        <div className="flex-1 min-w-0 space-y-2">
          {/* Action text */}
          <p className="text-sm text-foreground leading-relaxed">{item.content}</p>

          {/* Metadata row */}
          <div className="flex flex-wrap items-center gap-2">
            {/* Priority badge */}
            {item.priority && (
              <span
                className={cn(
                  'inline-flex items-center gap-1 px-2 py-0.5 text-[10px] font-medium rounded border shrink-0',
                  PRIORITY_COLORS[item.priority]
                )}
              >
                <TrendingUp className="w-2.5 h-2.5" />
                {item.priority.toUpperCase()}
              </span>
            )}

            {/* Assignee badge */}
            {item.assignee && (
              <span className="inline-flex items-center gap-1 px-2 py-0.5 text-[10px] font-medium bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-400 rounded border border-purple-200 dark:border-purple-800 shrink-0">
                <User className="w-2.5 h-2.5" />
                {item.assignee}
              </span>
            )}

            {/* Speaker */}
            {item.speaker && (
              <span className="text-[10px] text-muted-foreground italic shrink-0">
                {item.speaker}
              </span>
            )}

            {/* Preliminary badge */}
            {item.isPreliminary && (
              <span className="inline-flex items-center gap-1 px-1.5 py-0.5 text-[10px] font-medium bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400 rounded shrink-0">
                <Sparkles className="w-2.5 h-2.5" />
                Live
              </span>
            )}

            {/* Confidence score */}
            {showConfidence && item.confidence !== undefined && (
              <span className="inline-flex items-center gap-1 px-1.5 py-0.5 text-[10px] font-medium bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400 rounded shrink-0">
                <AlertCircle className="w-2.5 h-2.5" />
                {(item.confidence * 100).toFixed(0)}%
              </span>
            )}

            {/* Timestamp */}
            <span className="inline-flex items-center gap-1 text-[10px] text-muted-foreground shrink-0">
              <Clock className="w-2.5 h-2.5" />
              {formatTime(item.extractedAt)}
            </span>
          </div>
        </div>
      </div>
    </div>
  )
}

// ============================================================================
// Main Component
// ============================================================================

export function LiveActionItemsList({
  actionItems,
  isProcessing = false,
  showConfidence = true,
  enableAutoScroll = true,
  emptyMessage = 'No action items detected yet. They will appear here as the conversation progresses.',
  className,
  onItemClick,
}: LiveActionItemsListProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const prevCountRef = useRef(actionItems.length)
  const [newItemIds, setNewItemIds] = useState<Set<string>>(new Set())

  // Track new items for animation
  useEffect(() => {
    if (actionItems.length > prevCountRef.current) {
      const newIds = actionItems
        .slice(prevCountRef.current)
        .map((item) => item.id)
      setNewItemIds(new Set(newIds))

      // Remove "new" status after 10 seconds
      const timer = setTimeout(() => {
        setNewItemIds(new Set())
      }, 10000)

      return () => clearTimeout(timer)
    }
    prevCountRef.current = actionItems.length
  }, [actionItems])

  // Auto-scroll to newest items - throttled to prevent performance issues
  useEffect(() => {
    if (enableAutoScroll && actionItems.length > 0 && containerRef.current) {
      // Throttle scrolling to once per second to prevent excessive smooth scrolling
      const timerId = setTimeout(() => {
        if (containerRef.current) {
          containerRef.current.scrollTo({
            top: containerRef.current.scrollHeight,
            behavior: 'smooth',
          })
        }
      }, 1000)

      return () => clearTimeout(timerId)
    }
  }, [actionItems.length, enableAutoScroll])

  // Calculate last update time
  const lastUpdateTime = actionItems.length > 0
    ? Math.max(...actionItems.map((item) => item.extractedAt))
    : null

  const getLastUpdatedText = () => {
    if (!lastUpdateTime) return 'Never'
    const seconds = Math.floor((Date.now() - lastUpdateTime) / 1000)
    if (seconds < 10) return 'Just now'
    if (seconds < 60) return `${seconds}s ago`
    const minutes = Math.floor(seconds / 60)
    return `${minutes}m ago`
  }

  return (
    <div className={cn('flex flex-col h-full', className)} data-testid="live-action-items-list">
      {/* Items list */}
      <div
        ref={containerRef}
        className="flex-1 space-y-2 overflow-y-auto"
        style={{ maxHeight: '600px' }}
      >
        {actionItems.length === 0 ? (
          <div className="py-8 text-center">
            <CheckCircle2 className="w-12 h-12 mx-auto text-muted-foreground/50 mb-3" />
            <p className="text-sm text-muted-foreground">{emptyMessage}</p>
            {isProcessing && (
              <div className="flex items-center justify-center gap-2 mt-3">
                <Loader2 className="w-4 h-4 animate-spin text-blue-500" />
                <span className="text-xs text-muted-foreground">Processing...</span>
              </div>
            )}
          </div>
        ) : (
          <>
            {actionItems.map((item) => (
              <ActionItemCard
                key={item.id}
                item={item}
                isNew={newItemIds.has(item.id)}
                showConfidence={showConfidence}
                onClick={onItemClick}
              />
            ))}
            {isProcessing && (
              <div className="flex items-center justify-center gap-2 py-2">
                <Loader2 className="w-4 h-4 animate-spin text-blue-500" />
                <span className="text-xs text-muted-foreground">Analyzing...</span>
              </div>
            )}
          </>
        )}
      </div>

      {/* Footer status */}
      {actionItems.length > 0 && (
        <div className="mt-2 pt-2 border-t border-border">
          <p className="text-[10px] text-muted-foreground flex items-center justify-between">
            <span>Last updated: {getLastUpdatedText()}</span>
            <span className="font-medium">{actionItems.length} total</span>
          </p>
        </div>
      )}
    </div>
  )
}

export default LiveActionItemsList
