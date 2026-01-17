/**
 * LiveTopicsTimeline Component
 *
 * Visual timeline showing topics discussed over recording duration.
 * Features:
 * - Each topic displayed as a colored segment with label
 * - Hover to see topic details (keywords, duration, speakers)
 * - Click topic to jump to that section in transcript (future)
 * - Show topic transitions (when discussion shifted)
 * - Empty state messaging
 */

import { useEffect, useRef, useState } from 'react'
import {
  Tag,
  Clock,
  Users,
  ArrowRight,
  Sparkles,
  Loader2,
  Info,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import type { LiveNoteItem } from '@/stores/live-notes-store'

// ============================================================================
// Types
// ============================================================================

export interface LiveTopicsTimelineProps {
  /** Topics to display */
  topics: LiveNoteItem[]
  /** Recording duration in milliseconds */
  durationMs: number
  /** Whether LLM is currently processing */
  isProcessing?: boolean
  /** Whether to enable auto-scroll to new topics */
  enableAutoScroll?: boolean
  /** Empty state message */
  emptyMessage?: string
  /** Additional class names */
  className?: string
  /** Callback when topic is clicked */
  onTopicClick?: (item: LiveNoteItem) => void
}

// Topic colors for visual distinction
const TOPIC_COLORS = [
  { bg: 'bg-blue-500', text: 'text-blue-700', bgLight: 'bg-blue-100 dark:bg-blue-950/30', border: 'border-blue-300' },
  { bg: 'bg-green-500', text: 'text-green-700', bgLight: 'bg-green-100 dark:bg-green-950/30', border: 'border-green-300' },
  { bg: 'bg-purple-500', text: 'text-purple-700', bgLight: 'bg-purple-100 dark:bg-purple-950/30', border: 'border-purple-300' },
  { bg: 'bg-orange-500', text: 'text-orange-700', bgLight: 'bg-orange-100 dark:bg-orange-950/30', border: 'border-orange-300' },
  { bg: 'bg-pink-500', text: 'text-pink-700', bgLight: 'bg-pink-100 dark:bg-pink-950/30', border: 'border-pink-300' },
  { bg: 'bg-indigo-500', text: 'text-indigo-700', bgLight: 'bg-indigo-100 dark:bg-indigo-950/30', border: 'border-indigo-300' },
  { bg: 'bg-teal-500', text: 'text-teal-700', bgLight: 'bg-teal-100 dark:bg-teal-950/30', border: 'border-teal-300' },
  { bg: 'bg-amber-500', text: 'text-amber-700', bgLight: 'bg-amber-100 dark:bg-amber-950/30', border: 'border-amber-300' },
]

// ============================================================================
// Helper Functions
// ============================================================================

function formatDuration(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000)
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  if (minutes > 0) {
    return `${minutes}m ${seconds}s`
  }
  return `${seconds}s`
}

function formatTime(timestamp: number): string {
  return new Date(timestamp).toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
  })
}

// ============================================================================
// Helper Components
// ============================================================================

interface TopicSegmentProps {
  item: LiveNoteItem
  index: number
  isNew: boolean
  onClick?: (item: LiveNoteItem) => void
}

function TopicSegment({ item, index, isNew, onClick }: TopicSegmentProps) {
  const [showTooltip, setShowTooltip] = useState(false)
  const color = TOPIC_COLORS[index % TOPIC_COLORS.length]

  return (
    <div
      className="relative"
      onMouseEnter={() => setShowTooltip(true)}
      onMouseLeave={() => setShowTooltip(false)}
    >
      <div
        className={cn(
          'group relative p-3 rounded-lg border transition-all duration-300 cursor-pointer',
          'hover:shadow-md hover:scale-[1.02]',
          isNew
            ? 'bg-green-50 dark:bg-green-950/30 border-green-300 dark:border-green-700 animate-slide-in-fade'
            : `${color.bgLight} ${color.border}`,
        )}
        onClick={() => onClick?.(item)}
        data-testid="topic-segment"
      >
        {/* New badge */}
        {isNew && (
          <div className="absolute -top-2 -right-2 z-10">
            <span className="inline-flex items-center gap-1 px-2 py-0.5 text-[10px] font-medium bg-green-500 text-white rounded-full shadow-sm">
              <Sparkles className="w-2.5 h-2.5" />
              New
            </span>
          </div>
        )}

        <div className="flex items-start gap-3">
          {/* Color indicator */}
          <div className={cn('w-1 h-full rounded-full', color.bg)} />

          {/* Content */}
          <div className="flex-1 min-w-0 space-y-2">
            {/* Topic name */}
            <div className="flex items-start justify-between gap-2">
              <h4 className={cn('text-sm font-semibold', color.text)}>
                {item.content}
              </h4>
              <Tag className={cn('w-4 h-4 flex-shrink-0', color.text)} />
            </div>

            {/* Metadata */}
            <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
              {/* Speaker */}
              {item.speaker && (
                <span className="inline-flex items-center gap-1">
                  <Users className="w-3 h-3" />
                  {item.speaker}
                </span>
              )}

              {/* Timestamp */}
              <span className="inline-flex items-center gap-1">
                <Clock className="w-3 h-3" />
                {formatTime(item.extractedAt)}
              </span>

              {/* Preliminary badge */}
              {item.isPreliminary && (
                <span className="inline-flex items-center gap-1 px-1.5 py-0.5 text-[10px] font-medium bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400 rounded">
                  <Sparkles className="w-2.5 h-2.5" />
                  Live
                </span>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Tooltip on hover - positioned to the right to avoid clipping */}
      {showTooltip && (
        <div className="absolute z-20 top-0 left-full ml-2 w-64 p-3 bg-popover border border-border rounded-lg shadow-lg">
          <div className="space-y-2">
            <h5 className="font-semibold text-sm text-foreground">{item.content}</h5>
            <p className="text-xs text-muted-foreground">
              Click to jump to this section in the transcript
            </p>
            {item.speaker && (
              <p className="text-xs text-muted-foreground">
                <Users className="w-3 h-3 inline-block mr-1" />
                Discussed by: {item.speaker}
              </p>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

interface TopicTransitionProps {
  fromTopic: string | null
  toTopic: string
}

function TopicTransition({ fromTopic, toTopic }: TopicTransitionProps) {
  return (
    <div className="flex items-center justify-center py-2">
      <div className="flex items-center gap-2 px-3 py-1.5 bg-muted rounded-full text-xs text-muted-foreground">
        {fromTopic && <span className="truncate max-w-[100px]">{fromTopic}</span>}
        <ArrowRight className="w-3.5 h-3.5 flex-shrink-0" />
        <span className="truncate max-w-[100px]">{toTopic}</span>
      </div>
    </div>
  )
}

// ============================================================================
// Main Component
// ============================================================================

export function LiveTopicsTimeline({
  topics,
  durationMs,
  isProcessing = false,
  enableAutoScroll = true,
  emptyMessage = 'Topic analysis in progress...',
  className,
  onTopicClick,
}: LiveTopicsTimelineProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const prevCountRef = useRef(topics.length)
  const [newItemIds, setNewItemIds] = useState<Set<string>>(new Set())

  // Track new items for animation
  useEffect(() => {
    if (topics.length > prevCountRef.current) {
      const newIds = topics
        .slice(prevCountRef.current)
        .map((item) => item.id)
      setNewItemIds(new Set(newIds))

      // Remove "new" status after 10 seconds
      const timer = setTimeout(() => {
        setNewItemIds(new Set())
      }, 10000)

      return () => clearTimeout(timer)
    }
    prevCountRef.current = topics.length
  }, [topics])

  // Auto-scroll to newest topics - throttled to prevent performance issues
  useEffect(() => {
    if (enableAutoScroll && topics.length > 0 && containerRef.current) {
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
  }, [topics.length, enableAutoScroll])

  // Calculate last update time
  const lastUpdateTime = topics.length > 0
    ? Math.max(...topics.map((item) => item.extractedAt))
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
    <div className={cn('flex flex-col h-full', className)} data-testid="live-topics-timeline">
      {/* Timeline visualization */}
      <div
        ref={containerRef}
        className="flex-1 space-y-3 overflow-y-auto overflow-x-visible p-2"
        style={{ maxHeight: '600px' }}
      >
        {topics.length === 0 ? (
          <div className="py-8 text-center">
            <Tag className="w-12 h-12 mx-auto text-muted-foreground/50 mb-3" />
            <p className="text-sm text-muted-foreground">{emptyMessage}</p>
            {isProcessing && (
              <div className="flex items-center justify-center gap-2 mt-3">
                <Loader2 className="w-4 h-4 animate-spin text-green-500" />
                <span className="text-xs text-muted-foreground">Processing...</span>
              </div>
            )}
            <div className="mt-4 p-3 bg-muted/50 rounded-lg max-w-sm mx-auto">
              <p className="text-xs text-muted-foreground flex items-start gap-2">
                <Info className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" />
                Topics are detected as the conversation progresses. They'll appear here showing when discussion topics change.
              </p>
            </div>
          </div>
        ) : (
          <>
            {topics.map((item, index) => (
              <div key={item.id}>
                {/* Show transition marker between topics */}
                {index > 0 && (
                  <TopicTransition
                    fromTopic={topics[index - 1].content}
                    toTopic={item.content}
                  />
                )}

                {/* Topic segment */}
                <TopicSegment
                  item={item}
                  index={index}
                  isNew={newItemIds.has(item.id)}
                  onClick={onTopicClick}
                />
              </div>
            ))}
            {isProcessing && (
              <div className="flex items-center justify-center gap-2 py-2">
                <Loader2 className="w-4 h-4 animate-spin text-green-500" />
                <span className="text-xs text-muted-foreground">Analyzing...</span>
              </div>
            )}
          </>
        )}
      </div>

      {/* Footer status */}
      {topics.length > 0 && (
        <div className="mt-2 pt-2 border-t border-border space-y-1">
          <p className="text-[10px] text-muted-foreground flex items-center justify-between">
            <span>Last updated: {getLastUpdatedText()}</span>
            <span className="font-medium">{topics.length} total</span>
          </p>
          <p className="text-[10px] text-muted-foreground flex items-center gap-1">
            <Clock className="w-3 h-3" />
            Recording duration: {formatDuration(durationMs)}
          </p>
        </div>
      )}
    </div>
  )
}

export default LiveTopicsTimeline
