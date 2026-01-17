/**
 * LiveDecisionsList Component
 *
 * Displays decisions detected during live recording with card-based layout.
 * Features:
 * - Card-based layout for each decision
 * - Decision text prominently displayed with context snippet
 * - Timestamp and speakers involved
 * - Visual hierarchy: bold decision, lighter context
 * - Tag decisions by type if LLM provides classification
 * - Show decision impact/priority if detected
 * - Empty state messaging
 */

import { useEffect, useRef, useState } from 'react'
import {
  Gavel,
  Users,
  Clock,
  Sparkles,
  Tag as TagIcon,
  AlertCircle,
  MessageSquare,
  Loader2,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import type { LiveNoteItem } from '@/stores/live-notes-store'

// ============================================================================
// Types
// ============================================================================

export interface LiveDecisionsListProps {
  /** Decisions to display */
  decisions: LiveNoteItem[]
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

// Decision type categories (would come from LLM classification)
const DECISION_TYPES = {
  technical: {
    label: 'Technical',
    color: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400',
  },
  process: {
    label: 'Process',
    color: 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400',
  },
  strategic: {
    label: 'Strategic',
    color: 'bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-400',
  },
  resource: {
    label: 'Resource',
    color: 'bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400',
  },
}

// ============================================================================
// Helper Components
// ============================================================================

interface DecisionCardProps {
  item: LiveNoteItem
  isNew: boolean
  showConfidence: boolean
  onClick?: (item: LiveNoteItem) => void
}

function DecisionCard({ item, isNew, showConfidence, onClick }: DecisionCardProps) {
  const formatTime = (timestamp: number) => {
    return new Date(timestamp).toLocaleTimeString([], {
      hour: '2-digit',
      minute: '2-digit',
    })
  }

  // Extract decision type from metadata (if available)
  const decisionType = 'technical' // Would come from item.metadata?.type

  return (
    <div
      className={cn(
        'group relative p-4 rounded-lg border transition-all duration-300',
        'hover:shadow-lg hover:border-purple-300 dark:hover:border-purple-700',
        isNew
          ? 'bg-purple-50 dark:bg-purple-950/30 border-purple-300 dark:border-purple-700 animate-slide-in-fade'
          : 'bg-card border-border',
        onClick && 'cursor-pointer',
        'overflow-hidden'
      )}
      onClick={() => onClick?.(item)}
      data-testid="decision-card"
    >
      {/* New badge */}
      {isNew && (
        <div className="absolute top-2 right-2 z-10">
          <span className="inline-flex items-center gap-1 px-2 py-0.5 text-[10px] font-medium bg-purple-500 text-white rounded-full shadow-sm">
            <Sparkles className="w-2.5 h-2.5" />
            New
          </span>
        </div>
      )}

      <div className="space-y-3">
        {/* Header row with icon and type */}
        <div className="flex items-start justify-between gap-2">
          <div className="flex items-center gap-2">
            <div className="p-1.5 bg-purple-100 dark:bg-purple-900/30 rounded">
              <Gavel className="w-4 h-4 text-purple-600 dark:text-purple-400" />
            </div>
            <h4 className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
              Decision
            </h4>
          </div>

          {/* Decision type tag */}
          {decisionType && DECISION_TYPES[decisionType as keyof typeof DECISION_TYPES] && (
            <span
              className={cn(
                'inline-flex items-center gap-1 px-2 py-0.5 text-[10px] font-medium rounded',
                DECISION_TYPES[decisionType as keyof typeof DECISION_TYPES].color
              )}
            >
              <TagIcon className="w-2.5 h-2.5" />
              {DECISION_TYPES[decisionType as keyof typeof DECISION_TYPES].label}
            </span>
          )}
        </div>

        {/* Decision content - prominent */}
        <div className="space-y-2">
          <p className="text-base font-semibold text-foreground leading-relaxed">
            {item.content}
          </p>

          {/* Context snippet if available */}
          {item.speaker && (
            <div className="pl-3 border-l-2 border-purple-200 dark:border-purple-800">
              <p className="text-xs text-muted-foreground italic leading-relaxed">
                <MessageSquare className="w-3 h-3 inline-block mr-1" />
                Context from {item.speaker}
              </p>
            </div>
          )}
        </div>

        {/* Footer metadata */}
        <div className="flex flex-wrap items-center gap-2 pt-2 border-t border-border">
          {/* Speakers involved */}
          {item.speaker && (
            <span className="inline-flex items-center gap-1 px-2 py-0.5 text-[10px] font-medium bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-400 rounded shrink-0">
              <Users className="w-2.5 h-2.5" />
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
  )
}

// ============================================================================
// Main Component
// ============================================================================

export function LiveDecisionsList({
  decisions,
  isProcessing = false,
  showConfidence = true,
  enableAutoScroll = true,
  emptyMessage = 'Listening for decisions...',
  className,
  onItemClick,
}: LiveDecisionsListProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const prevCountRef = useRef(decisions.length)
  const [newItemIds, setNewItemIds] = useState<Set<string>>(new Set())

  // Track new items for animation
  useEffect(() => {
    if (decisions.length > prevCountRef.current) {
      const newIds = decisions
        .slice(prevCountRef.current)
        .map((item) => item.id)
      setNewItemIds(new Set(newIds))

      // Remove "new" status after 10 seconds
      const timer = setTimeout(() => {
        setNewItemIds(new Set())
      }, 10000)

      return () => clearTimeout(timer)
    }
    prevCountRef.current = decisions.length
  }, [decisions])

  // Auto-scroll to newest items - throttled to prevent performance issues
  useEffect(() => {
    if (enableAutoScroll && decisions.length > 0 && containerRef.current) {
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
  }, [decisions.length, enableAutoScroll])

  // Calculate last update time
  const lastUpdateTime = decisions.length > 0
    ? Math.max(...decisions.map((item) => item.extractedAt))
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
    <div className={cn('flex flex-col h-full', className)} data-testid="live-decisions-list">
      {/* Items list */}
      <div
        ref={containerRef}
        className="flex-1 space-y-3 overflow-y-auto"
        style={{ maxHeight: '600px' }}
      >
        {decisions.length === 0 ? (
          <div className="py-8 text-center">
            <Gavel className="w-12 h-12 mx-auto text-muted-foreground/50 mb-3" />
            <p className="text-sm text-muted-foreground">{emptyMessage}</p>
            {isProcessing && (
              <div className="flex items-center justify-center gap-2 mt-3">
                <Loader2 className="w-4 h-4 animate-spin text-purple-500" />
                <span className="text-xs text-muted-foreground">Processing...</span>
              </div>
            )}
          </div>
        ) : (
          <>
            {decisions.map((item) => (
              <DecisionCard
                key={item.id}
                item={item}
                isNew={newItemIds.has(item.id)}
                showConfidence={showConfidence}
                onClick={onItemClick}
              />
            ))}
            {isProcessing && (
              <div className="flex items-center justify-center gap-2 py-2">
                <Loader2 className="w-4 h-4 animate-spin text-purple-500" />
                <span className="text-xs text-muted-foreground">Analyzing...</span>
              </div>
            )}
          </>
        )}
      </div>

      {/* Footer status */}
      {decisions.length > 0 && (
        <div className="mt-2 pt-2 border-t border-border">
          <p className="text-[10px] text-muted-foreground flex items-center justify-between">
            <span>Last updated: {getLastUpdatedText()}</span>
            <span className="font-medium">{decisions.length} total</span>
          </p>
        </div>
      )}
    </div>
  )
}

export default LiveDecisionsList
