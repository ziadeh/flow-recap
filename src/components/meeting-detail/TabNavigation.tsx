import { FileText, StickyNote, CheckSquare, Mic, Radio, Lightbulb } from 'lucide-react'

export type TabType = 'transcript' | 'notes' | 'tasks' | 'insights' | 'recordings'

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
}

interface Tab {
  id: TabType
  label: string
  icon: typeof FileText
}

const tabs: Tab[] = [
  { id: 'transcript', label: 'Transcript', icon: FileText },
  { id: 'insights', label: 'Insights', icon: Lightbulb },
  { id: 'notes', label: 'Notes', icon: StickyNote },
  { id: 'tasks', label: 'Tasks', icon: CheckSquare },
  { id: 'recordings', label: 'Recordings', icon: Mic },
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
}: TabNavigationProps) {
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

  return (
    <div className="border-b border-border">
      <div className="flex space-x-1">
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
              onClick={() => onTabChange(tab.id)}
              className={`
                flex items-center px-4 py-3 font-medium text-sm transition-colors
                border-b-2 -mb-px relative
                ${
                  isActive
                    ? 'border-purple-600 text-purple-700 bg-purple-50'
                    : 'border-transparent text-muted-foreground hover:text-foreground hover:bg-muted'
                }
              `}
            >
              <Icon className="w-4 h-4 mr-2" />
              {tab.label}

              {/* Live indicator for transcript tab */}
              {showLiveIndicator && (
                <span className="ml-2 flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold bg-green-100 text-green-700 border border-green-200">
                  <Radio className="w-3 h-3 animate-pulse" />
                  Live
                </span>
              )}

              {/* Live indicator for insights tab during recording */}
              {showInsightsLiveIndicator && (
                <span className="ml-2 flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold bg-yellow-100 text-yellow-700 border border-yellow-200">
                  <Radio className="w-3 h-3 animate-pulse" />
                  Live
                </span>
              )}

              {/* New insights notification badge (only when tab not active) */}
              {showNewInsightsBadge && (
                <span className="absolute -top-1 -right-1 flex items-center justify-center w-5 h-5 rounded-full text-xs font-bold bg-red-500 text-white animate-pulse">
                  {newInsightsCount > 9 ? '9+' : newInsightsCount}
                </span>
              )}

              {/* Count badge (only show if not showing live indicator, or if there's a count > 0) */}
              {count !== undefined && count > 0 && !showLiveIndicator && !showInsightsLiveIndicator && (
                <span
                  className={`
                    ml-2 px-2 py-0.5 rounded-full text-xs font-semibold
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
                    ml-1 px-2 py-0.5 rounded-full text-xs font-semibold
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
