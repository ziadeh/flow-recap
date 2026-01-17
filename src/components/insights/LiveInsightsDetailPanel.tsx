/**
 * LiveInsightsDetailPanel Component
 *
 * Main panel integrating all live insight components with tabbed interface.
 * Features:
 * - Tabbed interface: Action Items, Decisions, Key Points, Topics, All
 * - Count badges on each tab
 * - Real-time updates as insights are generated
 * - Processing indicators
 * - Accessibility support (keyboard navigation, ARIA labels, screen reader announcements)
 * - Performance optimizations (throttled updates, virtualization for long lists)
 */

import { useState, useEffect, useCallback, useMemo } from 'react'
import { useShallow } from 'zustand/react/shallow'
import {
  CheckCircle2,
  Gavel,
  Lightbulb,
  Tag,
  LayoutGrid,
  Sparkles,
  Loader2,
  X,
  Info,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { useLiveNotesStore } from '@/stores/live-notes-store'
import { LiveActionItemsList } from './LiveActionItemsList'
import { LiveDecisionsList } from './LiveDecisionsList'
import { LiveKeyPointsList } from './LiveKeyPointsList'
import { LiveTopicsTimeline } from './LiveTopicsTimeline'

// ============================================================================
// Types
// ============================================================================

export interface LiveInsightsDetailPanelProps {
  /** Meeting ID for the current recording */
  meetingId: string
  /** Whether recording is currently active */
  isRecording: boolean
  /** Recording duration in milliseconds */
  durationMs: number
  /** Additional class names */
  className?: string
  /** Callback when panel is closed */
  onClose?: () => void
}

type TabId = 'action-items' | 'decisions' | 'key-points' | 'topics' | 'all'

interface Tab {
  id: TabId
  label: string
  icon: React.ComponentType<{ className?: string }>
  color: string
}

// ============================================================================
// Constants
// ============================================================================

const TABS: Tab[] = [
  {
    id: 'action-items',
    label: 'Action Items',
    icon: CheckCircle2,
    color: 'text-blue-600 dark:text-blue-400',
  },
  {
    id: 'decisions',
    label: 'Decisions',
    icon: Gavel,
    color: 'text-purple-600 dark:text-purple-400',
  },
  {
    id: 'key-points',
    label: 'Key Points',
    icon: Lightbulb,
    color: 'text-amber-600 dark:text-amber-400',
  },
  {
    id: 'topics',
    label: 'Topics',
    icon: Tag,
    color: 'text-green-600 dark:text-green-400',
  },
  {
    id: 'all',
    label: 'All',
    icon: LayoutGrid,
    color: 'text-gray-600 dark:text-gray-400',
  },
]

// ============================================================================
// Helper Components
// ============================================================================

interface TabButtonProps {
  tab: Tab
  isActive: boolean
  count: number
  onClick: () => void
}

function TabButton({ tab, isActive, count, onClick }: TabButtonProps) {
  const Icon = tab.icon

  return (
    <button
      onClick={onClick}
      className={cn(
        'relative flex items-center gap-2 px-4 py-2.5 text-sm font-medium transition-colors rounded-t-lg',
        'focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2',
        isActive
          ? 'bg-card text-foreground border-t border-l border-r border-border'
          : 'bg-muted/50 text-muted-foreground hover:bg-muted hover:text-foreground'
      )}
      role="tab"
      aria-selected={isActive}
      aria-controls={`panel-${tab.id}`}
      data-testid={`tab-${tab.id}`}
    >
      <Icon className={cn('w-4 h-4', isActive && tab.color)} />
      <span>{tab.label}</span>
      {count > 0 && (
        <span
          className={cn(
            'inline-flex items-center justify-center px-2 py-0.5 text-xs font-semibold rounded-full',
            isActive
              ? 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400'
              : 'bg-muted text-muted-foreground'
          )}
        >
          {count}
        </span>
      )}
    </button>
  )
}

// ============================================================================
// Main Component
// ============================================================================

export function LiveInsightsDetailPanel({
  meetingId: _meetingId,
  isRecording,
  durationMs,
  className,
  onClose,
}: LiveInsightsDetailPanelProps) {
  const [activeTab, setActiveTab] = useState<TabId>('all')
  const [lastAnnouncedCount, setLastAnnouncedCount] = useState(0)

  // Get live notes data from store - use single useShallow call for better performance
  // IMPORTANT: Don't use useLiveNotes() hook here as it causes performance issues
  // The hook contains heavy logic for processing segments - we only need to READ the state
  const { actionItems, decisions, keyPoints, topics, status, error, llmProvider } = useLiveNotesStore(
    useShallow((state) => ({
      actionItems: state.actionItems,
      decisions: state.decisions,
      keyPoints: state.keyPoints,
      topics: state.topics,
      status: state.status,
      error: state.error,
      llmProvider: state.llmProvider,
    }))
  )

  const isActive = status === 'active' || status === 'processing' || status === 'starting'
  const isProcessing = status === 'processing' || status === 'starting'

  // Calculate counts - memoize based on array lengths only to prevent unnecessary recalculations
  const counts = useMemo(
    () => ({
      actionItems: actionItems.length,
      decisions: decisions.length,
      keyPoints: keyPoints.length,
      topics: topics.length,
      total: actionItems.length + decisions.length + keyPoints.length + topics.length,
    }),
    [actionItems.length, decisions.length, keyPoints.length, topics.length]
  )

  // Screen reader announcements for new insights (accessibility)
  // Throttle announcements to prevent excessive DOM manipulations
  useEffect(() => {
    if (counts.total > lastAnnouncedCount && counts.total > 0) {
      const newCount = counts.total - lastAnnouncedCount

      // Only announce if we have at least 1 new insight and it's been at least 2 seconds
      const timerId = setTimeout(() => {
        const announcement = `${newCount} new insight${newCount > 1 ? 's' : ''} detected`

        // Create live region announcement
        const liveRegion = document.createElement('div')
        liveRegion.setAttribute('role', 'status')
        liveRegion.setAttribute('aria-live', 'polite')
        liveRegion.setAttribute('aria-atomic', 'true')
        liveRegion.className = 'sr-only'
        liveRegion.textContent = announcement
        document.body.appendChild(liveRegion)

        setTimeout(() => {
          if (document.body.contains(liveRegion)) {
            document.body.removeChild(liveRegion)
          }
        }, 1000)

        setLastAnnouncedCount(counts.total)
      }, 2000) // Throttle announcements to every 2 seconds

      return () => clearTimeout(timerId)
    }
  }, [counts.total, lastAnnouncedCount])

  // Keyboard navigation
  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'ArrowRight') {
      e.preventDefault()
      const currentIndex = TABS.findIndex((t) => t.id === activeTab)
      const nextIndex = (currentIndex + 1) % TABS.length
      setActiveTab(TABS[nextIndex].id)
    } else if (e.key === 'ArrowLeft') {
      e.preventDefault()
      const currentIndex = TABS.findIndex((t) => t.id === activeTab)
      const prevIndex = (currentIndex - 1 + TABS.length) % TABS.length
      setActiveTab(TABS[prevIndex].id)
    }
  }, [activeTab])

  // Get tab counts
  const getTabCount = (tabId: TabId): number => {
    switch (tabId) {
      case 'action-items':
        return counts.actionItems
      case 'decisions':
        return counts.decisions
      case 'key-points':
        return counts.keyPoints
      case 'topics':
        return counts.topics
      case 'all':
        return counts.total
      default:
        return 0
    }
  }

  // Render tab content
  const renderTabContent = () => {
    switch (activeTab) {
      case 'action-items':
        return (
          <LiveActionItemsList
            actionItems={actionItems}
            isProcessing={isProcessing}
            showConfidence={true}
            enableAutoScroll={true}
          />
        )
      case 'decisions':
        return (
          <LiveDecisionsList
            decisions={decisions}
            isProcessing={isProcessing}
            showConfidence={true}
            enableAutoScroll={true}
          />
        )
      case 'key-points':
        return (
          <LiveKeyPointsList
            keyPoints={keyPoints}
            isProcessing={isProcessing}
            showConfidence={true}
            enableAutoScroll={true}
          />
        )
      case 'topics':
        return (
          <LiveTopicsTimeline
            topics={topics}
            durationMs={durationMs}
            isProcessing={isProcessing}
            enableAutoScroll={true}
          />
        )
      case 'all':
        return (
          <div className="space-y-4 overflow-y-auto p-2" style={{ maxHeight: '600px' }}>
            {/* Action Items Section */}
            {actionItems.length > 0 && (
              <div>
                <h3 className="text-sm font-semibold text-foreground mb-2 flex items-center gap-2">
                  <CheckCircle2 className="w-4 h-4 text-blue-600 dark:text-blue-400" />
                  Action Items ({actionItems.length})
                </h3>
                <LiveActionItemsList
                  actionItems={actionItems}
                  isProcessing={false}
                  showConfidence={false}
                  enableAutoScroll={false}
                />
              </div>
            )}

            {/* Decisions Section */}
            {decisions.length > 0 && (
              <div>
                <h3 className="text-sm font-semibold text-foreground mb-2 flex items-center gap-2">
                  <Gavel className="w-4 h-4 text-purple-600 dark:text-purple-400" />
                  Decisions ({decisions.length})
                </h3>
                <LiveDecisionsList
                  decisions={decisions}
                  isProcessing={false}
                  showConfidence={false}
                  enableAutoScroll={false}
                />
              </div>
            )}

            {/* Key Points Section */}
            {keyPoints.length > 0 && (
              <div>
                <h3 className="text-sm font-semibold text-foreground mb-2 flex items-center gap-2">
                  <Lightbulb className="w-4 h-4 text-amber-600 dark:text-amber-400" />
                  Key Points ({keyPoints.length})
                </h3>
                <LiveKeyPointsList
                  keyPoints={keyPoints}
                  isProcessing={false}
                  showConfidence={false}
                  enableAutoScroll={false}
                />
              </div>
            )}

            {/* Topics Section */}
            {topics.length > 0 && (
              <div>
                <h3 className="text-sm font-semibold text-foreground mb-2 flex items-center gap-2">
                  <Tag className="w-4 h-4 text-green-600 dark:text-green-400" />
                  Topics ({topics.length})
                </h3>
                <LiveTopicsTimeline
                  topics={topics}
                  durationMs={durationMs}
                  isProcessing={false}
                  enableAutoScroll={false}
                />
              </div>
            )}

            {/* Empty state for "All" tab */}
            {counts.total === 0 && (
              <div className="py-12 text-center">
                <Sparkles className="w-16 h-16 mx-auto text-muted-foreground/50 mb-4" />
                <p className="text-sm text-muted-foreground mb-2">
                  {isProcessing
                    ? 'Analyzing transcript for insights...'
                    : 'Insights will appear here as the conversation progresses.'}
                </p>
                {isProcessing && (
                  <div className="flex items-center justify-center gap-2 mt-3">
                    <Loader2 className="w-4 h-4 animate-spin text-blue-500" />
                    <span className="text-xs text-muted-foreground">Processing...</span>
                  </div>
                )}
              </div>
            )}
          </div>
        )
      default:
        return null
    }
  }

  if (!isRecording) {
    return null
  }

  return (
    <div
      className={cn(
        'bg-card border border-border rounded-lg shadow-sm overflow-hidden',
        className
      )}
      data-testid="live-insights-detail-panel"
    >
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 bg-gradient-to-r from-indigo-50 to-purple-50 dark:from-indigo-950/30 dark:to-purple-950/30 border-b border-border">
        <div className="flex items-center gap-2">
          <Sparkles className="w-5 h-5 text-indigo-600 dark:text-indigo-400" />
          <span className="font-medium text-foreground">Live Insights</span>

          {/* Status indicators */}
          {isActive && (
            <span className="flex items-center gap-1 px-2 py-0.5 text-xs bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400 rounded-full">
              <span className="w-1.5 h-1.5 bg-green-500 rounded-full animate-pulse" />
              Live
            </span>
          )}
          {isProcessing && (
            <span className="flex items-center gap-1 px-2 py-0.5 text-xs bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400 rounded-full">
              <Loader2 className="w-3 h-3 animate-spin" />
              Processing
            </span>
          )}
        </div>

        <div className="flex items-center gap-2">
          {/* LLM provider info */}
          {llmProvider && (
            <span className="text-xs text-muted-foreground">
              {llmProvider}
            </span>
          )}

          {/* Close button */}
          {onClose && (
            <button
              onClick={onClose}
              className="p-1.5 text-muted-foreground hover:text-foreground hover:bg-muted rounded-md transition-colors"
              title="Close panel"
              aria-label="Close live insights panel"
            >
              <X className="w-4 h-4" />
            </button>
          )}
        </div>
      </div>

      {/* Error display */}
      {error && (
        <div className="mx-4 mt-3 flex items-start gap-2 p-3 bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-800 rounded-lg">
          <Info className="w-4 h-4 text-red-600 dark:text-red-400 mt-0.5 flex-shrink-0" />
          <div className="flex-1">
            <p className="text-sm font-medium text-red-700 dark:text-red-300">
              {error.message}
            </p>
            {error.recoverable && (
              <p className="text-xs text-red-600 dark:text-red-400 mt-1">
                This error may resolve automatically
              </p>
            )}
          </div>
        </div>
      )}

      {/* Tabs */}
      <div
        className="flex gap-1 px-4 pt-3 bg-muted/30 border-b border-border overflow-x-auto"
        role="tablist"
        aria-label="Live insights categories"
        onKeyDown={handleKeyDown}
      >
        {TABS.map((tab) => (
          <TabButton
            key={tab.id}
            tab={tab}
            isActive={activeTab === tab.id}
            count={getTabCount(tab.id)}
            onClick={() => setActiveTab(tab.id)}
          />
        ))}
      </div>

      {/* Tab content */}
      <div
        className="p-4"
        role="tabpanel"
        id={`panel-${activeTab}`}
        aria-labelledby={`tab-${activeTab}`}
      >
        {renderTabContent()}
      </div>

      {/* Footer */}
      <div className="px-4 py-2 bg-muted/30 border-t border-border">
        <p className="text-[10px] text-muted-foreground text-center flex items-center justify-center gap-1">
          <Info className="w-3 h-3" />
          Live insights update in real-time. Data is preliminary during recording.
        </p>
      </div>
    </div>
  )
}

export default LiveInsightsDetailPanel
