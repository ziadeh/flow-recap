/**
 * LiveKeyPointsList Component
 *
 * Displays key discussion points detected during live recording.
 * Features:
 * - Bulleted list of key points
 * - Group by topic if topics are detected
 * - Speaker attribution for each point
 * - Timestamp display
 * - Visual emphasis for points marked as 'critical' by LLM
 * - Empty state messaging
 */

import { useEffect, useRef, useState } from 'react'
import {
  Lightbulb,
  User,
  Clock,
  Sparkles,
  AlertCircle,
  Star,
  Loader2,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import type { LiveNoteItem } from '@/stores/live-notes-store'

// ============================================================================
// Types
// ============================================================================

export interface LiveKeyPointsListProps {
  /** Key points to display */
  keyPoints: LiveNoteItem[]
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

// Importance levels for visual emphasis
const IMPORTANCE_LEVELS = {
  critical: {
    icon: Star,
    color: 'text-amber-600 dark:text-amber-400',
    bgColor: 'bg-amber-50 dark:bg-amber-950/30',
    borderColor: 'border-amber-300 dark:border-amber-700',
  },
  high: {
    icon: AlertCircle,
    color: 'text-orange-600 dark:text-orange-400',
    bgColor: 'bg-orange-50 dark:bg-orange-950/30',
    borderColor: 'border-orange-200 dark:border-orange-700',
  },
  normal: {
    icon: Lightbulb,
    color: 'text-amber-600 dark:text-amber-400',
    bgColor: 'bg-card',
    borderColor: 'border-border',
  },
}

// ============================================================================
// Helper Components
// ============================================================================

interface KeyPointItemProps {
  item: LiveNoteItem
  isNew: boolean
  showConfidence: boolean
  onClick?: (item: LiveNoteItem) => void
}

function KeyPointItem({ item, isNew, showConfidence, onClick }: KeyPointItemProps) {
  const formatTime = (timestamp: number) => {
    return new Date(timestamp).toLocaleTimeString([], {
      hour: '2-digit',
      minute: '2-digit',
    })
  }

  // Determine importance level (would come from LLM metadata)
  // TODO: Get actual importance from item.metadata?.importance when available
  const importance = (item as any).metadata?.importance as keyof typeof IMPORTANCE_LEVELS || 'normal' as keyof typeof IMPORTANCE_LEVELS
  const config = IMPORTANCE_LEVELS[importance]
  const Icon = config.icon

  return (
    <div
      className={cn(
        'group relative flex items-start gap-3 p-3 rounded-lg border transition-all duration-300',
        'hover:shadow-md hover:border-amber-300 dark:hover:border-amber-700',
        isNew
          ? 'bg-amber-50 dark:bg-amber-950/30 border-amber-300 dark:border-amber-700 animate-slide-in-fade'
          : config.bgColor + ' ' + config.borderColor,
        onClick && 'cursor-pointer',
        'overflow-hidden'
      )}
      onClick={() => onClick?.(item)}
      data-testid="key-point-item"
    >
      {/* New badge */}
      {isNew && (
        <div className="absolute top-2 right-2 z-10">
          <span className="inline-flex items-center gap-1 px-2 py-0.5 text-[10px] font-medium bg-amber-500 text-white rounded-full shadow-sm">
            <Sparkles className="w-2.5 h-2.5" />
            New
          </span>
        </div>
      )}

      {/* Icon bullet */}
      <div className="pt-0.5">
        <Icon className={cn('w-4 h-4', config.color)} />
      </div>

      {/* Content */}
      <div className="flex-1 min-w-0 space-y-2">
        {/* Key point text */}
        <p className={cn(
          'text-sm leading-relaxed',
          importance === 'critical' ? 'font-semibold text-foreground' : 'text-foreground'
        )}>
          {item.content}
        </p>

        {/* Metadata row */}
        <div className="flex flex-wrap items-center gap-2">
          {/* Speaker attribution */}
          {item.speaker && (
            <span className="inline-flex items-center gap-1 px-2 py-0.5 text-[10px] font-medium bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-400 rounded shrink-0">
              <User className="w-2.5 h-2.5" />
              {item.speaker}
            </span>
          )}

          {/* Importance badge */}
          {importance === 'critical' && (
            <span className="inline-flex items-center gap-1 px-2 py-0.5 text-[10px] font-medium bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400 rounded border border-red-200 dark:border-red-800 shrink-0">
              <Star className="w-2.5 h-2.5" />
              CRITICAL
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
  )
}

// ============================================================================
// Main Component
// ============================================================================

export function LiveKeyPointsList({
  keyPoints,
  isProcessing = false,
  showConfidence = true,
  enableAutoScroll = true,
  emptyMessage = 'Key discussion points will appear here.',
  className,
  onItemClick,
}: LiveKeyPointsListProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const prevCountRef = useRef(keyPoints.length)
  const [newItemIds, setNewItemIds] = useState<Set<string>>(new Set())

  // Track new items for animation
  useEffect(() => {
    if (keyPoints.length > prevCountRef.current) {
      const newIds = keyPoints
        .slice(prevCountRef.current)
        .map((item) => item.id)
      setNewItemIds(new Set(newIds))

      // Remove "new" status after 10 seconds
      const timer = setTimeout(() => {
        setNewItemIds(new Set())
      }, 10000)

      return () => clearTimeout(timer)
    }
    prevCountRef.current = keyPoints.length
  }, [keyPoints])

  // Auto-scroll to newest items - throttled to prevent performance issues
  useEffect(() => {
    if (enableAutoScroll && keyPoints.length > 0 && containerRef.current) {
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
  }, [keyPoints.length, enableAutoScroll])

  // Calculate last update time
  const lastUpdateTime = keyPoints.length > 0
    ? Math.max(...keyPoints.map((item) => item.extractedAt))
    : null

  const getLastUpdatedText = () => {
    if (!lastUpdateTime) return 'Never'
    const seconds = Math.floor((Date.now() - lastUpdateTime) / 1000)
    if (seconds < 10) return 'Just now'
    if (seconds < 60) return `${seconds}s ago`
    const minutes = Math.floor(seconds / 60)
    return `${minutes}m ago`
  }

  // Group by topic if available (future enhancement)
  // For now, just display in chronological order
  const groupedKeyPoints = [
    {
      topic: null,
      points: keyPoints,
    },
  ]

  return (
    <div className={cn('flex flex-col h-full', className)} data-testid="live-key-points-list">
      {/* Items list */}
      <div
        ref={containerRef}
        className="flex-1 space-y-2 overflow-y-auto"
        style={{ maxHeight: '600px' }}
      >
        {keyPoints.length === 0 ? (
          <div className="py-8 text-center">
            <Lightbulb className="w-12 h-12 mx-auto text-muted-foreground/50 mb-3" />
            <p className="text-sm text-muted-foreground">{emptyMessage}</p>
            {isProcessing && (
              <div className="flex items-center justify-center gap-2 mt-3">
                <Loader2 className="w-4 h-4 animate-spin text-amber-500" />
                <span className="text-xs text-muted-foreground">Processing...</span>
              </div>
            )}
          </div>
        ) : (
          <>
            {groupedKeyPoints.map((group, groupIndex) => (
              <div key={groupIndex} className="space-y-2">
                {/* Topic header (if grouped) */}
                {group.topic && (
                  <h4 className="text-xs font-medium text-muted-foreground uppercase tracking-wide px-2">
                    {group.topic}
                  </h4>
                )}

                {/* Key points */}
                {group.points.map((item) => (
                  <KeyPointItem
                    key={item.id}
                    item={item}
                    isNew={newItemIds.has(item.id)}
                    showConfidence={showConfidence}
                    onClick={onItemClick}
                  />
                ))}
              </div>
            ))}
            {isProcessing && (
              <div className="flex items-center justify-center gap-2 py-2">
                <Loader2 className="w-4 h-4 animate-spin text-amber-500" />
                <span className="text-xs text-muted-foreground">Analyzing...</span>
              </div>
            )}
          </>
        )}
      </div>

      {/* Footer status */}
      {keyPoints.length > 0 && (
        <div className="mt-2 pt-2 border-t border-border">
          <p className="text-[10px] text-muted-foreground flex items-center justify-between">
            <span>Last updated: {getLastUpdatedText()}</span>
            <span className="font-medium">{keyPoints.length} total</span>
          </p>
        </div>
      )}
    </div>
  )
}

export default LiveKeyPointsList
