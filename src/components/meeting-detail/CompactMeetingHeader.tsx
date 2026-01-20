import { useState, useRef, useEffect } from 'react'
import {
  Calendar,
  Users,
  Trash2,
  Download,
  Settings,
  Pencil,
  MoreHorizontal,
  UserCog,
  Loader2,
  ChevronDown,
  FileText,
  FileCode,
  RefreshCw,
  BarChart3,
  AlertTriangle,
  X,
  Menu
} from 'lucide-react'
import type { Meeting, Speaker, Transcript } from '../../types/database'
import type { ExportAPI, ExportConfig, ExportResult, ExportFormat } from '../../types/electron-api'
import type { DeviceType } from '../../hooks/useResponsive'

// Access the export API with proper typing
const getExportAPI = (): ExportAPI => {
  return (window.electronAPI as unknown as { export: ExportAPI }).export
}

interface CompactMeetingHeaderProps {
  meeting: Meeting
  transcripts: Transcript[]
  speakers: Map<string, Speaker>
  isRecording?: boolean
  recordingDuration?: number
  onEdit?: () => void
  onDelete?: () => void
  onExport?: () => void
  onReplaceInsights?: () => void
  onReidentifySpeakers?: () => void
  onSettings?: () => void
  onTitleChange?: (newTitle: string) => Promise<void>
  hasTranscripts?: boolean
  hasNotes?: boolean
  hasExistingInsights?: boolean
  hasDiarization?: boolean
  existingInsightsCounts?: {
    actionItems: number
    decisions: number
    keyPoints: number
    topics: number
    summaries: number
  }
  /** Responsive props */
  isMobile?: boolean
  isTablet?: boolean
  deviceType?: DeviceType
}

export function CompactMeetingHeader({
  meeting,
  transcripts,
  isRecording = false,
  recordingDuration = 0,
  onDelete,
  onReplaceInsights,
  onReidentifySpeakers,
  onSettings,
  onTitleChange,
  hasTranscripts = false,
  hasNotes = false,
  hasExistingInsights = false,
  hasDiarization = false,
  existingInsightsCounts,
  isMobile = false,
  isTablet = false,
  deviceType: _deviceType = 'desktop'
}: CompactMeetingHeaderProps) {
  // deviceType is available for future use
  void _deviceType
  const [isEditingTitle, setIsEditingTitle] = useState(false)
  const [titleValue, setTitleValue] = useState(meeting.title)
  const [isScrolled, setIsScrolled] = useState(false)
  const [showOverflowMenu, setShowOverflowMenu] = useState(false)
  const [showExportDropdown, setShowExportDropdown] = useState(false)
  const [isExporting, setIsExporting] = useState(false)
  const [, setExportFormat] = useState<ExportFormat | null>(null)
  const [showReplaceInsightsModal, setShowReplaceInsightsModal] = useState(false)
  const [showReidentifySpeakersModal, setShowReidentifySpeakersModal] = useState(false)
  const titleInputRef = useRef<HTMLInputElement>(null)
  const headerRef = useRef<HTMLDivElement>(null)

  // Get unique speakers from transcripts
  const uniqueSpeakerIds = new Set(
    transcripts
      .map(t => t.speaker_id)
      .filter((id): id is string => id !== null)
  )
  const speakerCount = uniqueSpeakerIds.size

  // Status badge styling
  const getStatusStyle = (status: Meeting['status']) => {
    switch (status) {
      case 'completed':
        return 'bg-green-100 text-green-700 border-green-200 dark:bg-green-900/20 dark:text-green-400 dark:border-green-800'
      case 'in_progress':
        return 'bg-yellow-100 text-yellow-700 border-yellow-200 dark:bg-yellow-900/20 dark:text-yellow-400 dark:border-yellow-800'
      case 'scheduled':
        return 'bg-blue-100 text-blue-700 border-blue-200 dark:bg-blue-900/20 dark:text-blue-400 dark:border-blue-800'
      case 'cancelled':
        return 'bg-gray-100 text-gray-700 border-gray-200 dark:bg-gray-800 dark:text-gray-400 dark:border-gray-700'
      default:
        return 'bg-gray-100 text-gray-700 border-gray-200 dark:bg-gray-800 dark:text-gray-400 dark:border-gray-700'
    }
  }

  const getStatusLabel = (status: Meeting['status']) => {
    if (status === 'in_progress') return 'Recording'
    return status.replace('_', ' ').replace(/\b\w/g, l => l.toUpperCase())
  }

  // Format date/time for compact display
  const formatCompactDateTime = (isoString: string) => {
    const date = new Date(isoString)
    return date.toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
    })
  }

  // Handle title editing
  const handleTitleClick = () => {
    setIsEditingTitle(true)
  }

  const handleTitleBlur = async () => {
    const trimmedTitle = titleValue.trim()
    if (trimmedTitle !== meeting.title && onTitleChange) {
      // Optimistic update: Update local state immediately for instant feedback
      // The parent component handles the database update asynchronously
      // No need to show spinner since the UI updates instantly
      try {
        // Call the callback but don't await - let it run in the background
        // The parent will update the store immediately for optimistic UI
        onTitleChange(trimmedTitle)
      } catch (error) {
        console.error('Failed to save title:', error)
        setTitleValue(meeting.title) // Revert on error
      }
    }
    setIsEditingTitle(false)
  }

  const handleTitleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.currentTarget.blur()
    } else if (e.key === 'Escape') {
      setTitleValue(meeting.title)
      setIsEditingTitle(false)
    }
  }

  // Focus input when editing starts
  useEffect(() => {
    if (isEditingTitle && titleInputRef.current) {
      titleInputRef.current.focus()
      titleInputRef.current.select()
    }
  }, [isEditingTitle])

  // Handle scroll for shadow effect
  useEffect(() => {
    const handleScroll = () => {
      setIsScrolled(window.scrollY > 10)
    }
    window.addEventListener('scroll', handleScroll)
    return () => window.removeEventListener('scroll', handleScroll)
  }, [])

  // Update title when meeting changes
  useEffect(() => {
    setTitleValue(meeting.title)
  }, [meeting.title])

  // Format recording duration
  const formatRecordingDuration = (ms: number) => {
    const totalSeconds = Math.floor(ms / 1000)
    const hours = Math.floor(totalSeconds / 3600)
    const minutes = Math.floor((totalSeconds % 3600) / 60)
    const seconds = totalSeconds % 60

    if (hours > 0) {
      return `${hours}:${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`
    }
    return `${minutes}:${seconds.toString().padStart(2, '0')}`
  }

  // Export handling
  const defaultConfig: ExportConfig = {
    includeSummary: true,
    includeActionItems: true,
    includeDecisions: true,
    includeTranscript: true,
    includeKeyPoints: true,
    includeMetadata: true
  }

  const handleExport = async (format: ExportFormat) => {
    setIsExporting(true)
    setExportFormat(format)
    setShowExportDropdown(false)

    try {
      const exportAPI = getExportAPI()
      let exportResult: ExportResult

      if (format === 'pdf') {
        exportResult = await exportAPI.toPdf(meeting.id, undefined, defaultConfig)
      } else {
        exportResult = await exportAPI.toMarkdown(meeting.id, undefined, defaultConfig)
      }

      if (!exportResult.success) {
        console.error('Export failed:', exportResult.error)
      }
    } catch (error) {
      console.error('Export error:', error)
    } finally {
      setIsExporting(false)
      setExportFormat(null)
    }
  }

  const canExport = hasTranscripts || hasNotes

  // Responsive header padding
  const headerPadding = isMobile
    ? 'px-token-sm py-token-sm'
    : isTablet
      ? 'px-token-md py-token-md'
      : 'px-token-lg py-token-md'

  // Responsive header height
  const headerHeight = isMobile
    ? { minHeight: '48px', maxHeight: '56px' }
    : { minHeight: '60px', maxHeight: '80px' }

  return (
    <div
      ref={headerRef}
      data-testid="compact-meeting-header"
      className={`sticky top-0 z-40 bg-card border-b border-border transition-shadow duration-200 ${
        isScrolled ? 'shadow-medium' : ''
      }`}
      style={headerHeight}
    >
      {/* Responsive header layout: single row on mobile, multi-row info on desktop */}
      <div className={`flex items-center justify-between ${headerPadding} gap-token-sm`} style={{ height: '100%' }}>
        {/* Left side: Title (and metadata on non-mobile) */}
        <div className="flex items-center gap-token-sm min-w-0 flex-1">
          {/* Editable Title - smaller on mobile */}
          <div className="flex items-center gap-token-sm min-w-0 flex-1 group">
            {isEditingTitle ? (
              <input
                ref={titleInputRef}
                type="text"
                value={titleValue}
                onChange={(e) => setTitleValue(e.target.value)}
                onBlur={handleTitleBlur}
                onKeyDown={handleTitleKeyDown}
                data-testid="title-input"
                className={`flex-1 font-semibold text-foreground bg-transparent border-b-2 border-purple-400 focus:outline-none focus:border-purple-600 transition-colors ${
                  isMobile ? 'text-base' : 'text-lg'
                }`}
              />
            ) : (
              <>
                <h1
                  className={`font-semibold text-foreground cursor-pointer hover:text-purple-600 transition-colors truncate flex-1 ${
                    isMobile ? 'text-base' : 'text-lg'
                  }`}
                  onClick={handleTitleClick}
                  title={titleValue}
                  data-testid="meeting-title"
                >
                  {titleValue}
                </h1>
                {/* Hide edit button on mobile - use overflow menu instead */}
                {!isMobile && (
                  <button
                    onClick={handleTitleClick}
                    className="opacity-0 group-hover:opacity-100 p-1 hover:bg-muted rounded transition-all flex-shrink-0"
                    title="Edit title"
                    aria-label="Edit title"
                    data-testid="edit-title-button"
                  >
                    <Pencil className="w-3.5 h-3.5 text-muted-foreground" />
                  </button>
                )}
              </>
            )}
          </div>

          {/* Recording indicator - always visible when recording */}
          {isRecording && (
            <div className="flex items-center gap-token-sm flex-shrink-0">
              <div className="flex items-center gap-1 px-token-sm py-0.5 rounded-full bg-red-100 text-red-700 border border-red-200 dark:bg-red-900/20 dark:text-red-400 dark:border-red-800">
                <div className="w-2 h-2 rounded-full bg-red-600 animate-pulse" />
                <span className={`font-medium ${isMobile ? 'text-[10px]' : 'text-xs'}`}>
                  {isMobile ? 'REC' : 'Recording'}
                </span>
              </div>
              <span className={`font-mono text-muted-foreground ${isMobile ? 'text-[10px]' : 'text-xs'}`} data-testid="recording-duration">
                {formatRecordingDuration(recordingDuration)}
              </span>
            </div>
          )}

          {/* Hide metadata on mobile - move to overflow menu or omit */}
          {!isMobile && (
            <>
              {/* Separator */}
              <span className="hidden md:inline text-gray-300 dark:text-gray-600">|</span>

              {/* Date/Time with icon - hidden on mobile */}
              <div className="hidden md:flex items-center gap-1 text-sm text-muted-foreground flex-shrink-0">
                <Calendar className="w-4 h-4" />
                <span>{formatCompactDateTime(meeting.start_time)}</span>
              </div>

              {/* Separator */}
              <span className="hidden lg:inline text-gray-300 dark:text-gray-600">|</span>

              {/* Status Chip - hidden when recording, hidden on mobile */}
              {!isRecording && (
                <span
                  className={`hidden lg:inline-flex px-token-sm py-0.5 rounded-full text-xs font-medium border flex-shrink-0 ${getStatusStyle(meeting.status)}`}
                  data-testid="status-chip"
                >
                  {getStatusLabel(meeting.status)}
                </span>
              )}

              {/* Separator */}
              <span className="hidden xl:inline text-gray-300 dark:text-gray-600">|</span>

              {/* Speaker Count Badge */}
              {speakerCount > 0 && (
                <div className="hidden xl:flex items-center gap-1 text-sm text-muted-foreground flex-shrink-0" data-testid="speaker-count">
                  <Users className="w-4 h-4" />
                  <span>{speakerCount}</span>
                </div>
              )}
            </>
          )}
        </div>

        {/* Right side: Export button, Overflow menu - responsive spacing */}
        <div className={`flex items-center ${isMobile ? 'gap-token-sm' : 'gap-token-md'} flex-shrink-0`}>
          {/* Export Button - hidden on mobile, shown in hamburger menu */}
          {canExport && !isMobile && (
            <div className="relative">
              <button
                onClick={() => setShowExportDropdown(!showExportDropdown)}
                disabled={isExporting}
                className={`inline-flex items-center gap-2 h-9 px-3 rounded-md text-sm font-medium transition-colors border min-h-touch ${
                  isExporting
                    ? 'border-purple-300 text-purple-400 cursor-not-allowed'
                    : 'border-purple-600 text-purple-600 hover:bg-purple-50 dark:hover:bg-purple-900/20'
                }`}
                data-testid="export-button"
              >
                {isExporting ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    <span className="hidden sm:inline">Exporting...</span>
                  </>
                ) : (
                  <>
                    <Download className="w-4 h-4" />
                    <span className="hidden sm:inline">Export</span>
                    <ChevronDown className="w-3 h-3" />
                  </>
                )}
              </button>

              {/* Export Dropdown - using design tokens */}
              {showExportDropdown && !isExporting && (
                <>
                  <div
                    className="fixed inset-0 z-10"
                    onClick={() => setShowExportDropdown(false)}
                  />
                  <div className="absolute right-0 mt-token-xs w-52 rounded-md bg-card shadow-medium border border-border z-20 overflow-hidden" data-testid="export-dropdown">
                    <div className="py-token-xs">
                      {/* Meeting Export Options */}
                      <div className="px-token-md py-token-xs">
                        <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Meeting</span>
                      </div>
                      <button
                        onClick={() => handleExport('pdf')}
                        className="w-full flex items-center gap-token-md px-token-md py-token-sm hover:bg-muted transition-colors text-left"
                        data-testid="export-pdf-option"
                      >
                        <FileText className="w-4 h-4 text-muted-foreground" />
                        <span className="text-sm text-foreground">Export as PDF</span>
                      </button>
                      <button
                        onClick={() => handleExport('markdown')}
                        className="w-full flex items-center gap-token-md px-token-md py-token-sm hover:bg-muted transition-colors text-left"
                        data-testid="export-markdown-option"
                      >
                        <FileCode className="w-4 h-4 text-muted-foreground" />
                        <span className="text-sm text-foreground">Export as Markdown</span>
                      </button>

                      {/* Insights Export Option - Tertiary action (ghost style) */}
                      {hasExistingInsights && (
                        <>
                          <div className="my-token-xs border-t border-border" />
                          <div className="px-token-md py-token-xs">
                            <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Insights</span>
                          </div>
                          <button
                            onClick={() => {
                              setShowExportDropdown(false)
                              handleExport('pdf') // Export insights as PDF
                            }}
                            className="w-full flex items-center gap-token-md px-token-md py-token-sm hover:bg-muted transition-colors text-left text-muted-foreground hover:text-foreground"
                            data-testid="export-insights-option"
                          >
                            <BarChart3 className="w-4 h-4" />
                            <span className="text-sm">Export Insights</span>
                          </button>
                        </>
                      )}
                    </div>
                  </div>
                </>
              )}
            </div>
          )}

          {/* Overflow Menu - hamburger on mobile, dots on desktop */}
          <div className="relative">
            <button
              onClick={() => setShowOverflowMenu(!showOverflowMenu)}
              className={`text-muted-foreground hover:text-foreground hover:bg-muted rounded-md transition-colors ${
                isMobile ? 'p-2 min-w-touch min-h-touch' : 'p-token-sm'
              }`}
              title="More options"
              aria-label="More options"
              data-testid="overflow-menu-button"
            >
              {isMobile ? (
                <Menu className="w-5 h-5" />
              ) : (
                <MoreHorizontal className="w-4 h-4" />
              )}
            </button>

            {/* Overflow Menu Dropdown - responsive sizing for touch */}
            {showOverflowMenu && (
              <>
                <div
                  className="fixed inset-0 z-10"
                  onClick={() => setShowOverflowMenu(false)}
                />
                <div
                  className={`absolute right-0 mt-token-xs rounded-md bg-card shadow-medium border border-border z-20 overflow-hidden ${
                    isMobile ? 'w-64' : 'w-56'
                  }`}
                  data-testid="overflow-menu"
                >
                  <div className="py-token-xs">
                    {/* Export Section - Only shown on mobile (desktop has separate button) */}
                    {isMobile && canExport && (
                      <>
                        <div className="px-token-md py-token-xs">
                          <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Export</span>
                        </div>
                        <button
                          onClick={() => {
                            setShowOverflowMenu(false)
                            handleExport('pdf')
                          }}
                          disabled={isExporting}
                          className="w-full flex items-center gap-token-md px-token-md py-token-sm hover:bg-muted transition-colors text-left min-h-touch"
                          data-testid="mobile-export-pdf-option"
                        >
                          <FileText className="w-4 h-4 text-muted-foreground" />
                          <span className="text-sm text-foreground">Export as PDF</span>
                        </button>
                        <button
                          onClick={() => {
                            setShowOverflowMenu(false)
                            handleExport('markdown')
                          }}
                          disabled={isExporting}
                          className="w-full flex items-center gap-token-md px-token-md py-token-sm hover:bg-muted transition-colors text-left min-h-touch"
                          data-testid="mobile-export-markdown-option"
                        >
                          <FileCode className="w-4 h-4 text-muted-foreground" />
                          <span className="text-sm text-foreground">Export as Markdown</span>
                        </button>
                        <div className="my-token-xs border-t border-border" />
                      </>
                    )}

                    {/* Edit Title - Only shown on mobile */}
                    {isMobile && (
                      <>
                        <div className="px-token-md py-token-xs">
                          <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Edit</span>
                        </div>
                        <button
                          onClick={() => {
                            setShowOverflowMenu(false)
                            handleTitleClick()
                          }}
                          className="w-full flex items-center gap-token-md px-token-md py-token-sm hover:bg-muted transition-colors text-left min-h-touch"
                          data-testid="mobile-edit-title-option"
                        >
                          <Pencil className="w-4 h-4 text-muted-foreground" />
                          <span className="text-sm text-foreground">Edit Title</span>
                        </button>
                        <div className="my-token-xs border-t border-border" />
                      </>
                    )}

                    {/* Secondary Actions Section */}
                    {(hasTranscripts || hasExistingInsights) && (
                      <>
                        <div className="px-token-md py-token-xs">
                          <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Tools</span>
                        </div>

                        {/* Re-identify Speakers - Secondary action (moved from transcript tools) */}
                        {hasTranscripts && onReidentifySpeakers && (
                          <button
                            onClick={() => {
                              setShowOverflowMenu(false)
                              if (hasDiarization) {
                                setShowReidentifySpeakersModal(true)
                              } else {
                                onReidentifySpeakers()
                              }
                            }}
                            className={`w-full flex items-center gap-token-md px-token-md py-token-sm hover:bg-muted transition-colors text-left ${isMobile ? 'min-h-touch' : ''}`}
                            data-testid="reidentify-speakers-option"
                          >
                            <UserCog className="w-4 h-4 text-muted-foreground" />
                            <span className="text-sm text-foreground">Re-identify Speakers</span>
                          </button>
                        )}

                        {/* Replace Existing Insights - Secondary action (with confirmation modal) */}
                        {hasExistingInsights && hasTranscripts && onReplaceInsights && (
                          <button
                            onClick={() => {
                              setShowOverflowMenu(false)
                              setShowReplaceInsightsModal(true)
                            }}
                            className={`w-full flex items-center gap-token-md px-token-md py-token-sm hover:bg-muted transition-colors text-left ${isMobile ? 'min-h-touch' : ''}`}
                            data-testid="replace-insights-option"
                          >
                            <RefreshCw className="w-4 h-4 text-muted-foreground" />
                            <span className="text-sm text-foreground">Replace Existing Insights</span>
                          </button>
                        )}

                        <div className="my-token-xs border-t border-border" />
                      </>
                    )}

                    {/* Settings Section */}
                    <div className="px-token-md py-token-xs">
                      <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Settings</span>
                    </div>

                    {/* Meeting Settings */}
                    {onSettings && (
                      <button
                        onClick={() => {
                          setShowOverflowMenu(false)
                          onSettings()
                        }}
                        className="w-full flex items-center gap-token-md px-token-md py-token-sm hover:bg-muted transition-colors text-left"
                        data-testid="meeting-settings-option"
                      >
                        <Settings className="w-4 h-4 text-muted-foreground" />
                        <span className="text-sm text-foreground">Meeting Settings</span>
                      </button>
                    )}

                    {/* Tertiary/Destructive Actions Section */}
                    {onDelete && (
                      <>
                        <div className="my-token-xs border-t border-border" />
                        <div className="px-token-md py-token-xs">
                          <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Danger Zone</span>
                        </div>

                        {/* Delete Meeting - Tertiary destructive action */}
                        <button
                          onClick={() => {
                            setShowOverflowMenu(false)
                            onDelete()
                          }}
                          className="w-full flex items-center gap-token-md px-token-md py-token-sm hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors text-left text-red-600 dark:text-red-400"
                          data-testid="delete-meeting-option"
                        >
                          <Trash2 className="w-4 h-4" />
                          <span className="text-sm">Delete Meeting</span>
                        </button>
                      </>
                    )}
                  </div>
                </div>
              </>
            )}
          </div>
        </div>
      </div>

      {/* Replace Existing Insights Confirmation Modal */}
      {showReplaceInsightsModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 animate-in fade-in duration-200">
          <div className="w-full max-w-md bg-card border border-border rounded-lg shadow-xl animate-in zoom-in-95 duration-200">
            {/* Header */}
            <div className="flex items-center justify-between p-6 border-b border-border">
              <div className="flex items-center gap-3">
                <div className="p-2 bg-amber-100 dark:bg-amber-900/30 rounded-lg">
                  <AlertTriangle className="h-5 w-5 text-amber-600 dark:text-amber-400" />
                </div>
                <h3 className="text-lg font-semibold text-foreground">Replace Existing Insights?</h3>
              </div>
              <button
                onClick={() => setShowReplaceInsightsModal(false)}
                className="p-1 rounded-lg hover:bg-muted transition-colors"
              >
                <X className="w-5 h-5 text-muted-foreground" />
              </button>
            </div>

            {/* Content */}
            <div className="p-6 space-y-4">
              <p className="text-muted-foreground">
                This will regenerate all insights. Current data will be replaced. Continue?
              </p>

              {/* Show counts if available */}
              {existingInsightsCounts && existingInsightsCounts.actionItems + existingInsightsCounts.decisions + existingInsightsCounts.keyPoints + existingInsightsCounts.topics + existingInsightsCounts.summaries > 0 && (
                <div className="p-3 rounded-lg bg-muted/50 border border-border">
                  <p className="text-sm font-medium text-foreground mb-2">Items to be replaced:</p>
                  <div className="grid grid-cols-2 gap-2 text-sm text-muted-foreground">
                    {existingInsightsCounts.actionItems > 0 && (
                      <span>• {existingInsightsCounts.actionItems} Action Items</span>
                    )}
                    {existingInsightsCounts.decisions > 0 && (
                      <span>• {existingInsightsCounts.decisions} Decisions</span>
                    )}
                    {existingInsightsCounts.keyPoints > 0 && (
                      <span>• {existingInsightsCounts.keyPoints} Key Points</span>
                    )}
                    {existingInsightsCounts.topics > 0 && (
                      <span>• {existingInsightsCounts.topics} Topics</span>
                    )}
                    {existingInsightsCounts.summaries > 0 && (
                      <span>• {existingInsightsCounts.summaries} Summaries</span>
                    )}
                  </div>
                </div>
              )}
            </div>

            {/* Actions - consistent button sizing: h-10 (40px), px-4 */}
            <div className="flex items-center justify-end gap-3 p-6 border-t border-border">
              <button
                onClick={() => setShowReplaceInsightsModal(false)}
                className="h-10 px-4 text-sm font-medium text-muted-foreground hover:text-foreground hover:bg-muted rounded-md transition-colors"
                data-testid="cancel-replace-insights"
              >
                Cancel
              </button>
              <button
                onClick={() => {
                  setShowReplaceInsightsModal(false)
                  onReplaceInsights?.()
                }}
                className="h-10 px-4 text-sm font-medium text-white bg-purple-600 hover:bg-purple-700 rounded-md transition-colors flex items-center gap-2"
                data-testid="confirm-replace-insights"
              >
                <RefreshCw className="w-4 h-4" />
                Replace Insights
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Re-identify Speakers Confirmation Modal (shown only when diarization already exists) */}
      {showReidentifySpeakersModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 animate-in fade-in duration-200">
          <div className="w-full max-w-md bg-card border border-border rounded-lg shadow-xl animate-in zoom-in-95 duration-200">
            {/* Header */}
            <div className="flex items-center justify-between p-6 border-b border-border">
              <div className="flex items-center gap-3">
                <div className="p-2 bg-amber-100 dark:bg-amber-900/30 rounded-lg">
                  <UserCog className="h-5 w-5 text-amber-600 dark:text-amber-400" />
                </div>
                <h3 className="text-lg font-semibold text-foreground">Re-identify Speakers?</h3>
              </div>
              <button
                onClick={() => setShowReidentifySpeakersModal(false)}
                className="p-1 rounded-lg hover:bg-muted transition-colors"
              >
                <X className="w-5 h-5 text-muted-foreground" />
              </button>
            </div>

            {/* Content */}
            <div className="p-6 space-y-4">
              <p className="text-muted-foreground">
                Speaker diarization data already exists for this meeting. Re-running diarization will replace existing speaker labels.
              </p>

              <div className="p-3 rounded-lg bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800">
                <p className="text-sm text-blue-700 dark:text-blue-300">
                  <strong>Note:</strong> Any custom speaker names you've set will be preserved and applied to the new speaker assignments.
                </p>
              </div>
            </div>

            {/* Actions - consistent button sizing: h-10 (40px), px-4 */}
            <div className="flex items-center justify-end gap-3 p-6 border-t border-border">
              <button
                onClick={() => setShowReidentifySpeakersModal(false)}
                className="h-10 px-4 text-sm font-medium text-muted-foreground hover:text-foreground hover:bg-muted rounded-md transition-colors"
                data-testid="cancel-reidentify-speakers"
              >
                Cancel
              </button>
              <button
                onClick={() => {
                  setShowReidentifySpeakersModal(false)
                  onReidentifySpeakers?.()
                }}
                className="h-10 px-4 text-sm font-medium text-white bg-purple-600 hover:bg-purple-700 rounded-md transition-colors flex items-center gap-2"
                data-testid="confirm-reidentify-speakers"
              >
                <UserCog className="w-4 h-4" />
                Re-identify Speakers
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
