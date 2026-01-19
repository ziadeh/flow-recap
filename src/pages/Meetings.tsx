/**
 * Meetings Page
 *
 * Main page for viewing and managing meeting notes
 */

import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  Plus,
  Search,
  Calendar,
  Clock,
  Play,
  FileText,
  Filter,
  Loader2,
  Mic,
  CheckCircle2,
  Trash2,
  CheckSquare,
  Square,
  RefreshCw
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { useRecordingStatus, useRecordingMetadata } from '@/stores/recording-store'
import { useMeetingListStore } from '@/stores/meeting-list-store'
import { Meeting, MeetingStatus } from '@/types/database'
import { useNewMeeting } from '@/hooks/useNewMeeting'
import { useBackgroundMeetingsFetch, useRefreshMeetings } from '@/hooks/useBackgroundMeetingsFetch'
import { NewMeetingModal } from '@/components/NewMeetingModal'
import { MeetingListSkeleton } from '@/components/ui/Skeleton'
import { MeetingCardMetadataSkeleton } from '@/components/ui/MeetingCardMetadataSkeleton'
import { ProgressBar } from '@/components/ui/ProgressBar'
import { DeleteMeetingModal } from '@/components/DeleteMeetingModal'
import { LazyLoadContainer } from '@/components/ui/LazyLoadContainer'

// Utility Functions
function formatDuration(seconds: number | null): string {
  if (seconds === null || seconds === undefined) return 'N/A'
  const hours = Math.floor(seconds / 3600)
  const minutes = Math.floor((seconds % 3600) / 60)
  if (hours > 0) return `${hours}h ${minutes}min`
  if (minutes === 0) return '< 1min'
  return `${minutes}min`
}

function formatDate(isoString: string): string {
  return new Date(isoString).toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric'
  })
}

function formatTime(isoString: string): string {
  return new Date(isoString).toLocaleTimeString('en-US', {
    hour: '2-digit',
    minute: '2-digit'
  })
}

function getStatusColor(status: MeetingStatus): string {
  const colors = {
    completed: 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400',
    in_progress: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400',
    scheduled: 'bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-400',
    cancelled: 'bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-400'
  }
  return colors[status]
}

function getStatusLabel(status: MeetingStatus): string {
  const labels = {
    completed: 'Completed',
    in_progress: 'In Progress',
    scheduled: 'Scheduled',
    cancelled: 'Cancelled'
  }
  return labels[status]
}

// Date Range Type
type DateRange = 'all' | 'today' | 'last7days' | 'last30days'

function filterMeetingsByDateRange(meetings: Meeting[], range: DateRange): Meeting[] {
  if (range === 'all') return meetings

  const now = new Date()
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate())

  return meetings.filter(meeting => {
    const meetingDate = new Date(meeting.start_time)
    const meetingDay = new Date(meetingDate.getFullYear(), meetingDate.getMonth(), meetingDate.getDate())

    switch (range) {
      case 'today':
        return meetingDay.getTime() === today.getTime()
      case 'last7days':
        const sevenDaysAgo = new Date(today)
        sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7)
        return meetingDay >= sevenDaysAgo
      case 'last30days':
        const thirtyDaysAgo = new Date(today)
        thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30)
        return meetingDay >= thirtyDaysAgo
      default:
        return true
    }
  })
}

export function Meetings() {
  const navigate = useNavigate()
  const [searchQuery, setSearchQuery] = useState('')
  const [dateRange, setDateRange] = useState<DateRange>('all')
  const [statusFilter, setStatusFilter] = useState<MeetingStatus | 'all'>('all')
  const recordingStatus = useRecordingStatus()
  const { meetingId: recordingMeetingId } = useRecordingMetadata()
  const { isModalOpen, openModal, closeModal, handleSuccess } = useNewMeeting()

  // Use meeting list store for caching - use individual selectors to prevent infinite loops
  const meetings = useMeetingListStore(state => state.meetings)
  const isLoading = useMeetingListStore(state => state.isLoading)
  const isRefreshing = useMeetingListStore(state => state.isRefreshing)
  const error = useMeetingListStore(state => state.error)
  const isStale = useMeetingListStore(state => state.isStale)

  // Selection and deletion state
  const [selectionMode, setSelectionMode] = useState(false)
  const [selectedMeetings, setSelectedMeetings] = useState<Set<string>>(new Set())
  const [deleteModalOpen, setDeleteModalOpen] = useState(false)
  const [meetingToDelete, setMeetingToDelete] = useState<string | string[] | null>(null)

  // Manual refresh function
  const refreshMeetings = useRefreshMeetings()

  // Get stable store actions using selectors to prevent infinite loops
  const startLoading = useMeetingListStore(state => state.startLoading)
  const endLoading = useMeetingListStore(state => state.endLoading)
  const setMeetingsAction = useMeetingListStore(state => state.setMeetings)
  const setErrorAction = useMeetingListStore(state => state.setError)
  const removeMeeting = useMeetingListStore(state => state.removeMeeting)
  const removeMeetings = useMeetingListStore(state => state.removeMeetings)

  // Initialize with cached data on mount
  useEffect(() => {
    let isCancelled = false

    async function loadMeetings() {
      try {
        // Try to load from cache first
        if (meetings.length === 0) {
          startLoading()
          const allMeetings = await window.electronAPI.db.meetings.getAll()
          if (!isCancelled) {
            setMeetingsAction(allMeetings, false)
          }
        }
      } catch (err) {
        if (!isCancelled) {
          console.error('Failed to fetch meetings:', err)
          setErrorAction('Failed to load meetings. Please try again.')
        }
      } finally {
        if (!isCancelled) {
          endLoading()
        }
      }
    }
    loadMeetings()

    return () => {
      isCancelled = true
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []) // Empty dependency array - only run once on mount

  // Enable background fetch to keep data fresh
  useBackgroundMeetingsFetch({
    enabled: true,
    debounceMs: 1000
  })

  // Selection handlers
  const toggleSelection = (meetingId: string, e: React.MouseEvent) => {
    e.stopPropagation()
    const newSelection = new Set(selectedMeetings)
    if (newSelection.has(meetingId)) {
      newSelection.delete(meetingId)
    } else {
      newSelection.add(meetingId)
    }
    setSelectedMeetings(newSelection)
  }

  const selectAll = () => {
    const allIds = filteredMeetings.map(m => m.id)
    setSelectedMeetings(new Set(allIds))
  }

  const clearSelection = () => {
    setSelectedMeetings(new Set())
  }

  const exitSelectionMode = () => {
    setSelectionMode(false)
    setSelectedMeetings(new Set())
  }

  // Delete handlers
  const handleDeleteSingle = (meetingId: string, e: React.MouseEvent) => {
    e.stopPropagation()
    setMeetingToDelete(meetingId)
    setDeleteModalOpen(true)
  }

  const handleDeleteSelected = () => {
    if (selectedMeetings.size > 0) {
      setMeetingToDelete(Array.from(selectedMeetings))
      setDeleteModalOpen(true)
    }
  }

  const handleDeleteComplete = () => {
    // Immediately remove the deleted meeting(s) from the store for instant UI update
    if (meetingToDelete) {
      if (Array.isArray(meetingToDelete)) {
        removeMeetings(meetingToDelete)
      } else {
        removeMeeting(meetingToDelete)
      }
    }

    setDeleteModalOpen(false)
    setMeetingToDelete(null)
    exitSelectionMode()
  }

  // Filter and sort meetings
  const filteredMeetings = meetings
    .filter(meeting => {
      // Search filter
      const matchesSearch = meeting.title.toLowerCase().includes(searchQuery.toLowerCase())
      // Status filter
      const matchesStatus = statusFilter === 'all' || meeting.status === statusFilter
      return matchesSearch && matchesStatus
    })
    // Date range filter
    .filter(meeting => {
      if (dateRange === 'all') return true
      return filterMeetingsByDateRange([meeting], dateRange).length > 0
    })
    // Sort by date descending (newest first)
    .sort((a, b) => new Date(b.start_time).getTime() - new Date(a.start_time).getTime())

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Meetings</h1>
          <p className="text-muted-foreground">View and manage your meeting recordings</p>
          {isStale && !isRefreshing && (
            <p className="text-xs text-amber-600 dark:text-amber-400 mt-1">
              Data may be outdated •
              <button
                onClick={() => refreshMeetings()}
                className="ml-1 underline hover:font-medium"
              >
                Refresh now
              </button>
            </p>
          )}
        </div>
        <div className="flex items-center gap-2">
          {selectionMode ? (
            <>
              <span className="text-sm text-muted-foreground">
                {selectedMeetings.size} selected
              </span>
              <button
                onClick={selectAll}
                className="px-3 py-2 text-sm text-muted-foreground hover:text-foreground transition-colors"
              >
                Select All
              </button>
              <button
                onClick={clearSelection}
                className="px-3 py-2 text-sm text-muted-foreground hover:text-foreground transition-colors"
              >
                Clear
              </button>
              <button
                onClick={handleDeleteSelected}
                disabled={selectedMeetings.size === 0}
                className="flex items-center gap-2 px-4 py-2 bg-red-600 hover:bg-red-700 disabled:bg-red-400 text-white rounded-md text-sm font-medium transition-colors"
              >
                <Trash2 className="h-4 w-4" />
                Delete ({selectedMeetings.size})
              </button>
              <button
                onClick={exitSelectionMode}
                className="px-3 py-2 text-sm text-muted-foreground hover:text-foreground transition-colors"
              >
                Cancel
              </button>
            </>
          ) : (
            <>
              <button
                onClick={() => setSelectionMode(true)}
                className="flex items-center gap-2 px-3 py-2 text-sm text-muted-foreground hover:text-foreground transition-colors"
              >
                <CheckSquare className="h-4 w-4" />
                Select
              </button>
              {isRefreshing && (
                <button
                  disabled
                  className="flex items-center gap-2 px-3 py-2 text-sm text-muted-foreground"
                  title="Refreshing meetings..."
                >
                  <RefreshCw className="h-4 w-4 animate-spin" />
                </button>
              )}
              <button
                onClick={openModal}
                className="flex items-center gap-2 px-4 py-2 bg-purple-600 hover:bg-purple-700 text-white rounded-md text-sm font-medium transition-colors"
              >
                <Plus className="h-4 w-4" />
                New Meeting
              </button>
            </>
          )}
        </div>
      </div>

      <NewMeetingModal
        isOpen={isModalOpen}
        onClose={closeModal}
        onSuccess={handleSuccess}
      />

      {/* Recording Status Banner */}
      {recordingStatus === 'recording' && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-3 h-3 bg-red-500 rounded-full animate-pulse" />
            <span className="font-medium text-red-700">Recording in progress...</span>
          </div>
          <button className="px-3 py-1.5 bg-red-600 hover:bg-red-700 text-white rounded-md text-sm font-medium">
            Stop Recording
          </button>
        </div>
      )}

      {/* Error Message */}
      {error && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-4">
          <p className="text-red-700">{error}</p>
        </div>
      )}

      {/* Search and Filters */}
      <div className="space-y-4">
        <div className="relative flex-1 max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <input
            type="text"
            placeholder="Search meetings..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full pl-10 pr-4 py-2 bg-background border border-border rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent"
          />
        </div>

        <div className="flex items-center gap-4 flex-wrap">
          {/* Date Range Filters */}
          <div className="flex items-center gap-2">
            <Filter className="h-4 w-4 text-muted-foreground" />
            <span className="text-sm text-muted-foreground">Date:</span>
            <FilterButton
              active={dateRange === 'all'}
              onClick={() => setDateRange('all')}
            >
              All Time
            </FilterButton>
            <FilterButton
              active={dateRange === 'today'}
              onClick={() => setDateRange('today')}
            >
              Today
            </FilterButton>
            <FilterButton
              active={dateRange === 'last7days'}
              onClick={() => setDateRange('last7days')}
            >
              Last 7 Days
            </FilterButton>
            <FilterButton
              active={dateRange === 'last30days'}
              onClick={() => setDateRange('last30days')}
            >
              Last 30 Days
            </FilterButton>
          </div>

          {/* Status Filters */}
          <div className="flex items-center gap-2">
            <span className="text-sm text-muted-foreground">Status:</span>
            <FilterButton
              active={statusFilter === 'all'}
              onClick={() => setStatusFilter('all')}
            >
              All
            </FilterButton>
            <FilterButton
              active={statusFilter === 'completed'}
              onClick={() => setStatusFilter('completed')}
            >
              Completed
            </FilterButton>
            <FilterButton
              active={statusFilter === 'in_progress'}
              onClick={() => setStatusFilter('in_progress')}
            >
              In Progress
            </FilterButton>
            <FilterButton
              active={statusFilter === 'scheduled'}
              onClick={() => setStatusFilter('scheduled')}
            >
              Scheduled
            </FilterButton>
          </div>
        </div>
      </div>

      {/* Meetings List */}
      <div className="bg-card border border-border rounded-lg shadow-sm overflow-hidden">
        {isLoading ? (
          <MeetingListSkeleton count={5} />
        ) : filteredMeetings.length === 0 ? (
          <div className="p-12 text-center">
            <FileText className="h-12 w-12 mx-auto text-muted-foreground/50 mb-4" />
            <h3 className="text-lg font-medium text-foreground mb-2">No meetings found</h3>
            <p className="text-muted-foreground mb-4">
              {searchQuery || statusFilter !== 'all' || dateRange !== 'all'
                ? 'Try adjusting your filters or search query'
                : 'Start your first recording to see it here'}
            </p>
            <button
              onClick={() => navigate('/')}
              className="inline-flex items-center gap-2 px-4 py-2 bg-purple-600 hover:bg-purple-700 text-white rounded-md text-sm font-medium transition-colors"
            >
              <Plus className="h-4 w-4" />
              Start Recording
            </button>
          </div>
        ) : (
          <div className="divide-y divide-border">
            {filteredMeetings.map((meeting) => (
              <MeetingCard
                key={meeting.id}
                meeting={meeting}
                onClick={() => navigate(`/meeting/${meeting.id}`)}
                isRecording={recordingStatus === 'recording' && recordingMeetingId === meeting.id}
                isProcessing={meeting.status === 'in_progress' && recordingMeetingId !== meeting.id}
                selectionMode={selectionMode}
                isSelected={selectedMeetings.has(meeting.id)}
                onToggleSelect={(e) => toggleSelection(meeting.id, e)}
                onDelete={(e) => handleDeleteSingle(meeting.id, e)}
              />
            ))}
          </div>
        )}
      </div>

      {/* Results Count */}
      {!isLoading && filteredMeetings.length > 0 && (
        <p className="text-sm text-muted-foreground text-center">
          Showing {filteredMeetings.length} {filteredMeetings.length === 1 ? 'meeting' : 'meetings'}
          {(searchQuery || statusFilter !== 'all' || dateRange !== 'all') && ` (filtered from ${meetings.length} total)`}
        </p>
      )}

      {/* Delete Meeting Modal */}
      {meetingToDelete && (
        <DeleteMeetingModal
          isOpen={deleteModalOpen}
          onClose={() => {
            setDeleteModalOpen(false)
            setMeetingToDelete(null)
          }}
          meetingId={meetingToDelete}
          onDeleted={handleDeleteComplete}
        />
      )}
    </div>
  )
}

interface FilterButtonProps {
  children: React.ReactNode
  active: boolean
  onClick: () => void
}

function FilterButton({ children, active, onClick }: FilterButtonProps) {
  return (
    <button
      onClick={onClick}
      className={cn(
        'px-3 py-1.5 rounded-md text-sm font-medium transition-colors',
        active
          ? 'bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-400'
          : 'bg-secondary text-muted-foreground hover:bg-accent'
      )}
    >
      {children}
    </button>
  )
}

interface MeetingCardProps {
  meeting: Meeting
  onClick: () => void
  isRecording?: boolean
  isProcessing?: boolean
  selectionMode?: boolean
  isSelected?: boolean
  onToggleSelect?: (e: React.MouseEvent) => void
  onDelete?: (e: React.MouseEvent) => void
}

function MeetingCard({
  meeting,
  onClick,
  isRecording = false,
  isProcessing = false,
  selectionMode = false,
  isSelected = false,
  onToggleSelect,
  onDelete
}: MeetingCardProps) {
  // Determine the icon to show based on meeting status
  const getStatusIcon = () => {
    if (isRecording) {
      return (
        <div className="relative p-2 bg-red-100 dark:bg-red-900/30 rounded-lg flex-shrink-0">
          <Mic className="h-5 w-5 text-red-600 dark:text-red-400" />
          <span className="absolute -top-0.5 -right-0.5 flex h-2.5 w-2.5">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-500 opacity-75"></span>
            <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-red-500"></span>
          </span>
        </div>
      )
    }
    if (isProcessing) {
      return (
        <div className="p-2 bg-amber-100 dark:bg-amber-900/30 rounded-lg flex-shrink-0">
          <Loader2 className="h-5 w-5 text-amber-600 dark:text-amber-400 animate-spin" />
        </div>
      )
    }
    if (meeting.status === 'completed') {
      return (
        <div className="p-2 bg-green-100 dark:bg-green-900/30 rounded-lg flex-shrink-0">
          <CheckCircle2 className="h-5 w-5 text-green-600 dark:text-green-400" />
        </div>
      )
    }
    return (
      <div className="p-2 bg-purple-100 dark:bg-purple-900/30 rounded-lg flex-shrink-0">
        <FileText className="h-5 w-5 text-purple-600 dark:text-purple-400" />
      </div>
    )
  }

  // Get processing status badge
  const getProcessingStatusBadge = () => {
    if (isRecording) {
      return (
        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400">
          <span className="w-1.5 h-1.5 rounded-full bg-red-500 animate-pulse" />
          Recording
        </span>
      )
    }
    if (isProcessing) {
      return (
        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400">
          <Loader2 className="w-3 h-3 animate-spin" />
          Processing
        </span>
      )
    }
    return (
      <span className={cn(
        'px-2 py-0.5 rounded-full text-xs font-medium whitespace-nowrap',
        getStatusColor(meeting.status)
      )}>
        {getStatusLabel(meeting.status)}
      </span>
    )
  }

  return (
    <div
      className={cn(
        "p-4 transition-colors cursor-pointer",
        isRecording && "bg-red-50/50 dark:bg-red-950/20 hover:bg-red-50 dark:hover:bg-red-950/30",
        isProcessing && "bg-amber-50/50 dark:bg-amber-950/20 hover:bg-amber-50 dark:hover:bg-amber-950/30",
        !isRecording && !isProcessing && "hover:bg-accent/50",
        selectionMode && isSelected && "bg-purple-50/50 dark:bg-purple-950/20"
      )}
      onClick={selectionMode ? onToggleSelect : onClick}
      data-testid="meeting-card"
    >
      <div className="flex items-start justify-between">
        <div className="flex items-start gap-4 flex-1">
          {/* Selection checkbox */}
          {selectionMode && (
            <button
              onClick={onToggleSelect}
              className="p-1 mt-1 flex-shrink-0"
            >
              {isSelected ? (
                <CheckSquare className="h-5 w-5 text-purple-600" />
              ) : (
                <Square className="h-5 w-5 text-muted-foreground" />
              )}
            </button>
          )}
          {!selectionMode && getStatusIcon()}
          {/* Lazy load metadata section */}
          <LazyLoadContainer
            fallback={<MeetingCardMetadataSkeleton />}
            rootMargin="100px"
            className="flex-1 min-w-0"
            testId={`meeting-card-metadata-${meeting.id}`}
          >
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 mb-1 flex-wrap">
                <h3 className="font-medium text-foreground truncate">{meeting.title}</h3>
                {getProcessingStatusBadge()}
              </div>
              {meeting.description && (
                <p className="text-sm text-muted-foreground mb-2 line-clamp-1">{meeting.description}</p>
              )}
              <div className="flex items-center gap-3 text-sm text-muted-foreground flex-wrap">
                <span className="flex items-center gap-1">
                  <Calendar className="h-3.5 w-3.5" />
                  {formatDate(meeting.start_time)}
                </span>
                <span className="flex items-center gap-1">
                  <Clock className="h-3.5 w-3.5" />
                  {formatTime(meeting.start_time)}
                </span>
                <span>
                  Duration: {formatDuration(meeting.duration_seconds)}
                </span>
              </div>

              {/* Processing progress indicator */}
              {isProcessing && (
                <div className="mt-3">
                  <ProgressBar
                    indeterminate
                    variant="warning"
                    size="xs"
                    className="max-w-xs"
                  />
                  <p className="text-xs text-amber-600 dark:text-amber-400 mt-1">
                    Processing transcription...
                  </p>
                </div>
              )}
            </div>
          </LazyLoadContainer>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0 ml-4">
          {!selectionMode && (
            <>
              <button
                className="p-2 hover:bg-accent rounded-md transition-colors"
                onClick={(e) => {
                  e.stopPropagation()
                  // TODO: Implement play audio functionality
                }}
              >
                <Play className="h-4 w-4 text-muted-foreground" />
              </button>
              <button
                className="p-2 hover:bg-red-100 dark:hover:bg-red-900/30 rounded-md transition-colors group"
                onClick={onDelete}
                title="Delete meeting"
              >
                <Trash2 className="h-4 w-4 text-muted-foreground group-hover:text-red-600" />
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  )
}

export default Meetings
