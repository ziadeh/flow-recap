import { useRef, useEffect } from 'react'
import { FileText, StickyNote, CheckSquare, Mic, Radio, LayoutDashboard, BarChart3 } from 'lucide-react'

// Note: 'insights' tab type kept for backwards compatibility but tab is removed from UI
export type TabType = 'overview' | 'transcript' | 'notes' | 'tasks' | 'insights' | 'recordings' | 'analytics'

interface TabNavigationProps {
  activeTab: TabType
  onTabChange: (tab: TabType) => void
  transcriptCount?: number
  notesCount?: number
  tasksCount?: number
  insightsCount?: number
  recordingsCount?: number
  /** Whether live transcription is currently active */
  isLiveTranscriptActive?: boolean
  /** Whether live insights are being generated during recording */
  isLiveInsightsActive?: boolean
  /** Number of new insights since last view (for notification badge) */
  newInsightsCount?: number
  /** Responsive props */
  isMobile?: boolean
  isTablet?: boolean
}

interface Tab {
  id: TabType
  label: string
  icon: typeof FileText
}

// Insights tab removed - all content consolidated into Overview tab
const tabs: Tab[] = [
  { id: 'overview', label: 'Overview', icon: LayoutDashboard },
  { id: 'transcript', label: 'Transcript', icon: FileText },
  { id: 'notes', label: 'Notes', icon: StickyNote },
  { id: 'tasks', label: 'Tasks', icon: CheckSquare },
  { id: 'recordings', label: 'Recordings', icon: Mic },
  { id: 'analytics', label: 'Analytics', icon: BarChart3 },
]

export function TabNavigation({
  activeTab,
  onTabChange,
  transcriptCount,
  notesCount,
  tasksCount,
  insightsCount,
  recordingsCount,
  isLiveTranscriptActive = false,
  isLiveInsightsActive = false,
  newInsightsCount = 0,
  isMobile = false,
  isTablet = false,
}: TabNavigationProps) {
  const scrollContainerRef = useRef<HTMLDivElement>(null)
  const activeTabRef = useRef<HTMLButtonElement>(null)

  const getCounts = (tabId: TabType): number | undefined => {
    switch (tabId) {
      case 'transcript':
        return transcriptCount
      case 'notes':
        return notesCount
      case 'tasks':
        return tasksCount
      case 'insights':
        return insightsCount
      case 'recordings':
        return recordingsCount
      default:
        return undefined
    }
  }

  // Scroll active tab into view on mobile
  useEffect(() => {
    if (isMobile && activeTabRef.current && scrollContainerRef.current) {
      const container = scrollContainerRef.current
      const activeElement = activeTabRef.current
      const containerRect = container.getBoundingClientRect()
      const activeRect = activeElement.getBoundingClientRect()

      // Check if the active tab is outside the visible area
      if (activeRect.left < containerRect.left || activeRect.right > containerRect.right) {
        activeElement.scrollIntoView({
          behavior: 'smooth',
          block: 'nearest',
          inline: 'center'
        })
      }
    }
  }, [activeTab, isMobile])

  // Responsive padding based on device
  const tabPadding = isMobile
    ? 'px-token-md py-token-sm'  // Smaller padding on mobile
    : isTablet
      ? 'px-token-md py-token-md'
      : 'px-token-lg py-token-md'

  return (
    <div className="border-b border-border">
      {/* Tab container - scrollable on mobile */}
      <div
        ref={scrollContainerRef}
        className={`flex ${isMobile ? 'scrollable-tabs px-token-sm' : 'space-x-token-xs'}`}
      >
        {tabs.map((tab) => {
          const Icon = tab.icon
          const count = getCounts(tab.id)
          const isActive = activeTab === tab.id
          const showLiveIndicator = tab.id === 'transcript' && isLiveTranscriptActive
          const showInsightsLiveIndicator = tab.id === 'insights' && isLiveInsightsActive
          const showNewInsightsBadge = tab.id === 'insights' && newInsightsCount > 0 && !isActive

          return (
            <button
              key={tab.id}
              ref={isActive ? activeTabRef : null}
              onClick={() => onTabChange(tab.id)}
              className={`
                flex items-center ${tabPadding} font-medium text-sm transition-colors
                border-b-2 -mb-px relative whitespace-nowrap
                ${isMobile ? 'min-h-touch' : ''}
                ${
                  isActive
                    ? 'border-purple-600 text-purple-700 bg-purple-50'
                    : 'border-transparent text-muted-foreground hover:text-foreground hover:bg-muted'
                }
              `}
              data-testid={`tab-${tab.id}`}
            >
              <Icon className="w-4 h-4 mr-token-sm flex-shrink-0" />
              {/* On mobile, show shorter labels for some tabs */}
              <span className={isMobile ? 'text-xs' : ''}>
                {isMobile && tab.id === 'recordings' ? 'Rec' :
                 isMobile && tab.id === 'transcript' ? 'Trans' :
                 tab.label}
              </span>

              {/* Live indicator for transcript tab */}
              {showLiveIndicator && (
                <span className={`ml-token-sm flex items-center gap-1 px-token-sm py-0.5 rounded-full font-semibold bg-green-100 text-green-700 border border-green-200 ${isMobile ? 'text-[10px]' : 'text-xs'}`}>
                  <Radio className={`animate-pulse ${isMobile ? 'w-2 h-2' : 'w-3 h-3'}`} />
                  {!isMobile && 'Live'}
                </span>
              )}

              {/* Live indicator for insights tab during recording */}
              {showInsightsLiveIndicator && (
                <span className={`ml-token-sm flex items-center gap-1 px-token-sm py-0.5 rounded-full font-semibold bg-yellow-100 text-yellow-700 border border-yellow-200 ${isMobile ? 'text-[10px]' : 'text-xs'}`}>
                  <Radio className={`animate-pulse ${isMobile ? 'w-2 h-2' : 'w-3 h-3'}`} />
                  {!isMobile && 'Live'}
                </span>
              )}

              {/* New insights notification badge (only when tab not active) */}
              {showNewInsightsBadge && (
                <span className={`absolute -top-1 -right-1 flex items-center justify-center rounded-full font-bold bg-red-500 text-white animate-pulse ${isMobile ? 'w-4 h-4 text-[10px]' : 'w-5 h-5 text-xs'}`}>
                  {newInsightsCount > 9 ? '9+' : newInsightsCount}
                </span>
              )}

              {/* Count badge (only show if not showing live indicator, or if there's a count > 0) */}
              {count !== undefined && count > 0 && !showLiveIndicator && !showInsightsLiveIndicator && (
                <span
                  className={`
                    ml-token-sm px-token-sm py-0.5 rounded-full font-semibold
                    ${isMobile ? 'text-[10px]' : 'text-xs'}
                    ${
                      isActive
                        ? 'bg-purple-100 text-purple-700'
                        : 'bg-muted text-muted-foreground'
                    }
                  `}
                >
                  {count}
                </span>
              )}

              {/* Show count alongside live indicator if there are existing transcripts */}
              {(showLiveIndicator || showInsightsLiveIndicator) && count !== undefined && count > 0 && (
                <span
                  className={`
                    ml-token-xs px-token-sm py-0.5 rounded-full font-semibold
                    ${isMobile ? 'text-[10px]' : 'text-xs'}
                    ${
                      isActive
                        ? 'bg-purple-100 text-purple-700'
                        : 'bg-muted text-muted-foreground'
                    }
                  `}
                >
                  {count}
                </span>
              )}
            </button>
          )
        })}
      </div>
    </div>
  )
}
