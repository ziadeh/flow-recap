import { useState, useRef, useEffect, useCallback } from 'react'
import { useParams, useSearchParams, useNavigate, useLocation } from 'react-router-dom'
import { ChevronLeft, Loader2, AlertCircle, Sparkles, RefreshCw, ListTodo, Trash2, BarChart3 } from 'lucide-react'
import type { TaskStatus } from '../types/database'
import { useMeetingDetail } from '../hooks/useMeetingDetail'
import { useDebouncedCallback } from '../hooks/useDebouncedCallback'
import { useLiveTranscript } from '../hooks/useLiveTranscript'
import { useRecordingStore } from '../stores/recording-store'
import { MeetingHeader } from '../components/meeting-detail/MeetingHeader'
import { AudioPlayer } from '../components/meeting-detail/AudioPlayer'
import { TabNavigation, TabType } from '../components/meeting-detail/TabNavigation'
import { TranscriptTab } from '../components/meeting-detail/TranscriptTab'
import { NotesTab } from '../components/meeting-detail/NotesTab'
import { ActionItemsList } from '../components/meeting-detail/ActionItemsList'
import { InsightsTab } from '../components/meeting-detail/InsightsTab'
import { RecordingsTab } from '../components/meeting-detail/RecordingsTab'
import { EditMeetingModal } from '../components/EditMeetingModal'
import { SpeakerManagementModal } from '../components/meeting-detail/SpeakerManagementModal'
import { ExportButton } from '../components/meeting-detail/ExportButton'
import { Spinner } from '../components/ui/Spinner'
import { Skeleton, SkeletonText } from '../components/ui/Skeleton'
import { RealtimeInsightsPanel } from '../components/insights/RealtimeInsightsPanel'
import { DeleteMeetingModal } from '../components/DeleteMeetingModal'

/**
 * Generate Summary Button Component
 * Handles the UI for generating AI-powered meeting summaries
 */
function GenerateSummaryButton({
  meetingId,
  hasTranscripts,
  hasExistingSummary,
  onSummaryGenerated
}: {
  meetingId: string
  hasTranscripts: boolean
  hasExistingSummary: boolean
  onSummaryGenerated: () => void
}) {
  const [isGenerating, setIsGenerating] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [successMessage, setSuccessMessage] = useState<string | null>(null)

  const handleGenerateSummary = async () => {
    setIsGenerating(true)
    setError(null)
    setSuccessMessage(null)

    try {
      // First check if LLM service is available
      const availability = await window.electronAPI.meetingSummary.checkAvailability()

      if (!availability.available) {
        setError(availability.error || 'LLM service is not available. Please ensure LM Studio is running.')
        setIsGenerating(false)
        return
      }

      // If there's an existing summary, delete it first to regenerate
      if (hasExistingSummary) {
        await window.electronAPI.meetingSummary.deleteExistingSummary(meetingId)
      }

      // Generate the summary
      const result = await window.electronAPI.meetingSummary.generateSummary(meetingId)

      if (!result.success) {
        setError(result.error || 'Failed to generate summary')
        setIsGenerating(false)
        return
      }

      // Show success message
      const notesCreated = result.createdNotes?.length || 0
      setSuccessMessage(`Summary generated successfully! Created ${notesCreated} note${notesCreated !== 1 ? 's' : ''}.`)

      // Notify parent to refetch data
      onSummaryGenerated()

      // Auto-hide success message after 5 seconds
      setTimeout(() => {
        setSuccessMessage(null)
      }, 5000)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An unexpected error occurred')
    } finally {
      setIsGenerating(false)
    }
  }

  if (!hasTranscripts) {
    return null
  }

  return (
    <div className="mb-4">
      <div className="flex items-center gap-3">
        <button
          onClick={handleGenerateSummary}
          disabled={isGenerating}
          className={`inline-flex items-center px-4 py-2 rounded-lg font-medium text-sm transition-colors ${
            isGenerating
              ? 'bg-purple-100 text-purple-400 cursor-not-allowed'
              : 'bg-purple-600 text-white hover:bg-purple-700'
          }`}
        >
          {isGenerating ? (
            <>
              <Loader2 className="w-4 h-4 mr-2 animate-spin" />
              Generating Summary...
            </>
          ) : hasExistingSummary ? (
            <>
              <RefreshCw className="w-4 h-4 mr-2" />
              Regenerate Summary
            </>
          ) : (
            <>
              <Sparkles className="w-4 h-4 mr-2" />
              Generate Summary
            </>
          )}
        </button>

        {hasExistingSummary && !isGenerating && (
          <span className="text-xs text-muted-foreground">
            This will replace the existing AI-generated summary
          </span>
        )}
      </div>

      {/* Error message */}
      {error && (
        <div className="mt-3 p-3 bg-red-50 border border-red-200 rounded-lg">
          <div className="flex items-start gap-2">
            <AlertCircle className="w-4 h-4 text-red-600 mt-0.5 flex-shrink-0" />
            <div>
              <p className="text-sm text-red-700">{error}</p>
              <p className="text-xs text-red-600 mt-1">
                Make sure LM Studio is running on localhost:1234 with a model loaded.
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Success message */}
      {successMessage && (
        <div className="mt-3 p-3 bg-green-50 border border-green-200 rounded-lg">
          <div className="flex items-center gap-2">
            <Sparkles className="w-4 h-4 text-green-600 flex-shrink-0" />
            <p className="text-sm text-green-700">{successMessage}</p>
          </div>
        </div>
      )}
    </div>
  )
}

/**
 * Extract Action Items Button Component
 * Handles the UI for extracting action items from meeting transcripts
 */
function ExtractActionItemsButton({
  meetingId,
  hasTranscripts,
  hasExistingActionItems,
  onActionItemsExtracted
}: {
  meetingId: string
  hasTranscripts: boolean
  hasExistingActionItems: boolean
  onActionItemsExtracted: () => void
}) {
  const [isExtracting, setIsExtracting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [successMessage, setSuccessMessage] = useState<string | null>(null)

  const handleExtractActionItems = async () => {
    setIsExtracting(true)
    setError(null)
    setSuccessMessage(null)

    try {
      // First check if LLM service is available
      const availability = await window.electronAPI.actionItems.checkAvailability()

      if (!availability.available) {
        setError(availability.error || 'LLM service is not available. Please ensure LM Studio is running.')
        setIsExtracting(false)
        return
      }

      // If there are existing action items, delete them first to re-extract
      if (hasExistingActionItems) {
        await window.electronAPI.actionItems.deleteExisting(meetingId)
      }

      // Extract action items
      const result = await window.electronAPI.actionItems.extract(meetingId, {
        createTasks: true,
        createNotes: true
      })

      if (!result.success) {
        setError(result.error || 'Failed to extract action items')
        setIsExtracting(false)
        return
      }

      // Show success message
      const itemsExtracted = result.extractedItems?.length || 0
      const tasksCreated = result.createdTasks?.length || 0
      const notesCreated = result.createdNotes?.length || 0

      if (itemsExtracted === 0) {
        setSuccessMessage('No action items found in this meeting transcript.')
      } else {
        setSuccessMessage(
          `Extracted ${itemsExtracted} action item${itemsExtracted !== 1 ? 's' : ''}! ` +
          `Created ${tasksCreated} task${tasksCreated !== 1 ? 's' : ''} and ${notesCreated} note${notesCreated !== 1 ? 's' : ''}.`
        )
      }

      // Notify parent to refetch data
      onActionItemsExtracted()

      // Auto-hide success message after 5 seconds
      setTimeout(() => {
        setSuccessMessage(null)
      }, 5000)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An unexpected error occurred')
    } finally {
      setIsExtracting(false)
    }
  }

  if (!hasTranscripts) {
    return null
  }

  return (
    <div className="mb-4">
      <div className="flex items-center gap-3">
        <button
          onClick={handleExtractActionItems}
          disabled={isExtracting}
          className={`inline-flex items-center px-4 py-2 rounded-lg font-medium text-sm transition-colors ${
            isExtracting
              ? 'bg-green-100 text-green-400 cursor-not-allowed'
              : 'bg-green-600 text-white hover:bg-green-700'
          }`}
        >
          {isExtracting ? (
            <>
              <Loader2 className="w-4 h-4 mr-2 animate-spin" />
              Extracting Action Items...
            </>
          ) : hasExistingActionItems ? (
            <>
              <RefreshCw className="w-4 h-4 mr-2" />
              Re-extract Action Items
            </>
          ) : (
            <>
              <ListTodo className="w-4 h-4 mr-2" />
              Extract Action Items
            </>
          )}
        </button>

        {hasExistingActionItems && !isExtracting && (
          <span className="text-xs text-muted-foreground">
            This will replace existing AI-generated action items
          </span>
        )}
      </div>

      {/* Error message */}
      {error && (
        <div className="mt-3 p-3 bg-red-50 border border-red-200 rounded-lg">
          <div className="flex items-start gap-2">
            <AlertCircle className="w-4 h-4 text-red-600 mt-0.5 flex-shrink-0" />
            <div>
              <p className="text-sm text-red-700">{error}</p>
              <p className="text-xs text-red-600 mt-1">
                Make sure LM Studio is running on localhost:1234 with a model loaded.
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Success message */}
      {successMessage && (
        <div className="mt-3 p-3 bg-green-50 border border-green-200 rounded-lg">
          <div className="flex items-center gap-2">
            <ListTodo className="w-4 h-4 text-green-600 flex-shrink-0" />
            <p className="text-sm text-green-700">{successMessage}</p>
          </div>
        </div>
      )}
    </div>
  )
}

export default function MeetingDetail() {
  const { id } = useParams<{ id: string }>()
  const [searchParams, setSearchParams] = useSearchParams()
  const navigate = useNavigate()
  const location = useLocation()
  const audioPlayerRef = useRef<HTMLDivElement>(null)

  // Get active tab from URL or default to 'transcript'
  const activeTabFromUrl = (searchParams.get('tab') as TabType) || 'transcript'
  const [activeTab, setActiveTab] = useState<TabType>(activeTabFromUrl)

  // Track the hash for scrolling to specific sections (e.g., #action-items)
  const [, setInsightsSectionHash] = useState<string | null>(
    location.hash ? location.hash.slice(1) : null
  )
  const [currentAudioTime, setCurrentAudioTime] = useState(0)
  const [isEditModalOpen, setIsEditModalOpen] = useState(false)
  const [isSpeakerModalOpen, setIsSpeakerModalOpen] = useState(false)
  const [showInsightsPanel, setShowInsightsPanel] = useState(true) // Real-time insights panel visibility
  const [diarizationNotification, setDiarizationNotification] = useState<{
    show: boolean
    speakersDetected: number
  } | null>(null)
  const [actionItemsNotification, setActionItemsNotification] = useState<{
    show: boolean
    actionItemsCount: number
    tasksCreated: number
  } | null>(null)
  const [isDeleteModalOpen, setIsDeleteModalOpen] = useState(false)

  // Fetch meeting data
  const { meeting, transcripts, notes, tasks, recordings, speakers, speakerNameOverrides, isLoading, isSorting, error, refetch } = useMeetingDetail(id)

  // Debounced refetch to consolidate multiple rapid refetch triggers into a single database fetch
  // This prevents redundant data fetches when multiple events fire in quick succession
  // (e.g., diarization complete, transcripts update, tasks update, etc.)
  const REFETCH_DEBOUNCE_MS = 1000
  const debouncedRefetch = useDebouncedCallback(refetch, REFETCH_DEBOUNCE_MS)

  // Recording state - check if we're recording for this meeting
  const recordingStatus = useRecordingStore((state) => state.status)
  const recordingMeetingId = useRecordingStore((state) => state.meetingId)
  const recordingDuration = useRecordingStore((state) => state.duration)
  const isRecordingThisMeeting =
    (recordingStatus === 'recording' || recordingStatus === 'paused') &&
    recordingMeetingId === id

  // Live transcription hook - automatically starts/stops with recording
  const {
    segments: liveSegments,
    isActive: isLiveTranscriptActive,
  } = useLiveTranscript({
    enabled: true,
    language: 'en',
    modelSize: 'base',
  })

  // Calculate live transcript count for tab badge
  const liveSegmentCount = isLiveTranscriptActive ? liveSegments.length : 0
  const totalTranscriptCount = transcripts.length + liveSegmentCount

  // Check if we have an existing AI-generated summary
  const hasExistingSummary = notes.some(note => note.note_type === 'summary' && note.is_ai_generated)

  // Check if we have existing AI-generated action items
  const hasExistingActionItems = notes.some(note => note.note_type === 'action_item' && note.is_ai_generated)

  // Handle tab change and update URL
  const handleTabChange = useCallback((tab: TabType) => {
    setActiveTab(tab)
    setSearchParams({ tab })
    // Clear hash when switching tabs
    if (location.hash) {
      navigate(`/meetings/${id}?tab=${tab}`, { replace: true })
    }
  }, [id, location.hash, navigate, setSearchParams])

  // Sync tab state with URL changes (e.g., browser back/forward)
  useEffect(() => {
    const tabFromUrl = searchParams.get('tab') as TabType
    if (tabFromUrl && tabFromUrl !== activeTab) {
      setActiveTab(tabFromUrl)
    }
  }, [searchParams])

  // Handle hash navigation for deep links (e.g., /meeting/:id/insights#action-items)
  useEffect(() => {
    const hash = location.hash ? location.hash.slice(1) : null
    setInsightsSectionHash(hash)

    // If there's a hash and we're linking to insights sections, switch to insights tab
    if (hash && ['action-items', 'decisions', 'key-points', 'topics'].includes(hash)) {
      if (activeTab !== 'insights') {
        setActiveTab('insights')
        setSearchParams({ tab: 'insights' })
      }

      // Scroll to the section after a brief delay to allow DOM to render
      setTimeout(() => {
        const element = document.getElementById(hash)
        if (element) {
          element.scrollIntoView({ behavior: 'smooth', block: 'start' })
        }
      }, 100)
    }
  }, [location.hash])

  // Handle audio seek from transcript
  const handleSeekAudio = (timeInSeconds: number) => {
    const audioElement = audioPlayerRef.current?.querySelector('audio') as any
    if (audioElement?.seekTo) {
      audioElement.seekTo(timeInSeconds)
    }
  }

  // Handle recording deletion
  const handleDeleteRecording = async (recordingId: string) => {
    await window.electronAPI.db.recordings.delete(recordingId)
    debouncedRefetch()
  }

  // Handle task status change
  const handleTaskStatusChange = async (taskId: string, newStatus: TaskStatus) => {
    try {
      await window.electronAPI.db.tasks.update(taskId, {
        status: newStatus,
        completed_at: newStatus === 'completed' ? new Date().toISOString() : null
      })
      debouncedRefetch()
    } catch (error) {
      console.error('Failed to update task status:', error)
    }
  }

  // Handle meeting deletion
  const handleMeetingDeleted = () => {
    setIsDeleteModalOpen(false)
    navigate('/meetings')
  }

  // Auto-switch to transcript tab when recording starts
  useEffect(() => {
    if (isRecordingThisMeeting && activeTab !== 'transcript') {
      handleTabChange('transcript')
    }
  }, [isRecordingThisMeeting])

  // Refetch data when recording stops to get new transcripts
  // Using debouncedRefetch ensures this is consolidated with other potential events
  useEffect(() => {
    if (recordingStatus === 'idle' && recordingMeetingId === id) {
      // The debouncedRefetch already has a 1000ms delay built in,
      // so we just call it directly
      debouncedRefetch()
    }
  }, [recordingStatus, recordingMeetingId, id, debouncedRefetch])

  // Listen for automatic diarization completion
  useEffect(() => {
    const handleDiarizationComplete = (event: any) => {
      const { meetingId, success, speakersDetected } = event

      // Only show notification if it's for this meeting
      if (meetingId === id && success) {
        console.log(`[MeetingDetail] Diarization complete: ${speakersDetected} speakers detected`)

        // Show notification
        setDiarizationNotification({
          show: true,
          speakersDetected
        })

        // Refetch data to show updated speaker assignments (debounced)
        debouncedRefetch()

        // Auto-hide notification after 10 seconds
        setTimeout(() => {
          setDiarizationNotification(null)
        }, 10000)
      }
    }

    // Listen for the event from electron main process
    // @ts-ignore - electronAPI is available globally
    const removeListener = window.electronAPI?.onDiarizationComplete?.(handleDiarizationComplete)

    return () => {
      removeListener?.()
    }
  }, [id, debouncedRefetch])

  // Listen for automatic action items extraction completion
  useEffect(() => {
    const handleActionItemsExtracted = (event: any) => {
      const { meetingId, success, actionItemsCount, tasksCreated } = event

      // Only show notification if it's for this meeting and tasks were created
      if (meetingId === id && success && (actionItemsCount > 0 || tasksCreated?.length > 0)) {
        console.log(`[MeetingDetail] Action items extracted: ${actionItemsCount} items, ${tasksCreated?.length || 0} tasks created`)

        // Show notification
        setActionItemsNotification({
          show: true,
          actionItemsCount,
          tasksCreated: tasksCreated?.length || 0
        })

        // Refetch data to show updated tasks (debounced)
        debouncedRefetch()

        // Auto-hide notification after 10 seconds
        setTimeout(() => {
          setActionItemsNotification(null)
        }, 10000)
      }
    }

    // Listen for the event from electron main process
    // @ts-ignore - electronAPI is available globally
    const removeListener = window.electronAPI?.onActionItemsExtracted?.(handleActionItemsExtracted)

    return () => {
      removeListener?.()
    }
  }, [id, debouncedRefetch])

  // Listen for live notes being persisted to database (when recording stops)
  useEffect(() => {
    const handleNotesPersisted = (data: { meetingId: string; notesCount: number; tasksCount: number }) => {
      // Only refetch if it's for this meeting and notes/tasks were created
      if (data.meetingId === id && (data.notesCount > 0 || data.tasksCount > 0)) {
        console.log(`[MeetingDetail] Live notes persisted: ${data.notesCount} notes, ${data.tasksCount} tasks`)
        // Refetch data to show the newly persisted notes and tasks (debounced)
        debouncedRefetch()
      }
    }

    // Listen for the event from electron main process
    // @ts-ignore - electronAPI is available globally
    const removeListener = window.electronAPI?.liveNotes?.onNotesPersisted?.(handleNotesPersisted)

    return () => {
      removeListener?.()
    }
  }, [id, debouncedRefetch])

  // Loading state with skeleton
  if (isLoading) {
    return (
      <div className="min-h-screen bg-background">
        <div className="w-full mx-auto px-4 py-6 space-y-6">
          {/* Breadcrumb skeleton */}
          <div className="flex items-center justify-between">
            <Skeleton className="h-5 w-32" />
            <Skeleton className="h-9 w-24" />
          </div>

          {/* Meeting header skeleton */}
          <div className="bg-card border border-border rounded-lg p-6 space-y-4 animate-pulse">
            <div className="flex items-start justify-between">
              <div className="space-y-2">
                <Skeleton className="h-8 w-64" />
                <Skeleton className="h-4 w-48" />
              </div>
              <Skeleton className="h-8 w-24" />
            </div>
            <div className="flex gap-4">
              <Skeleton className="h-5 w-24" />
              <Skeleton className="h-5 w-24" />
              <Skeleton className="h-5 w-20" />
            </div>
          </div>

          {/* Audio player skeleton */}
          <div className="bg-card border border-border rounded-lg p-4 animate-pulse">
            <div className="flex items-center gap-4">
              <Skeleton className="h-10 w-10 rounded-full" />
              <div className="flex-1 space-y-2">
                <Skeleton className="h-2 w-full rounded-full" />
                <div className="flex justify-between">
                  <Skeleton className="h-4 w-12" />
                  <Skeleton className="h-4 w-12" />
                </div>
              </div>
            </div>
          </div>

          {/* Tab content skeleton */}
          <div className="bg-card border border-border rounded-lg shadow-sm">
            {/* Tab navigation skeleton */}
            <div className="border-b border-border p-2">
              <div className="flex gap-2">
                <Skeleton className="h-9 w-24" />
                <Skeleton className="h-9 w-20" />
                <Skeleton className="h-9 w-20" />
                <Skeleton className="h-9 w-24" />
              </div>
            </div>
            {/* Tab content skeleton */}
            <div className="p-6 space-y-4">
              <SkeletonText lines={3} />
              <div className="mt-4">
                <SkeletonText lines={4} lastLineWidth="60%" />
              </div>
            </div>
          </div>

          {/* Loading indicator */}
          <div className="flex items-center justify-center py-4">
            <Spinner size="md" variant="primary" label="Loading meeting details..." />
          </div>
        </div>
      </div>
    )
  }

  // Error state
  if (error) {
    return (
      <div className="flex items-center justify-center h-screen">
        <div className="text-center max-w-md">
          <AlertCircle className="w-12 h-12 text-red-600 mx-auto mb-4" />
          <h2 className="text-xl font-semibold text-foreground mb-2">Error Loading Meeting</h2>
          <p className="text-muted-foreground mb-4">{error.message}</p>
          <button
            onClick={() => navigate('/meetings')}
            className="px-4 py-2 bg-purple-600 text-white rounded-lg hover:bg-purple-700 transition-colors"
          >
            Back to Meetings
          </button>
        </div>
      </div>
    )
  }

  // Meeting not found
  if (!meeting) {
    return (
      <div className="flex items-center justify-center h-screen">
        <div className="text-center max-w-md">
          <AlertCircle className="w-12 h-12 text-amber-600 mx-auto mb-4" />
          <h2 className="text-xl font-semibold text-foreground mb-2">Meeting Not Found</h2>
          <p className="text-muted-foreground mb-4">
            The meeting you're looking for doesn't exist or has been deleted.
          </p>
          <button
            onClick={() => navigate('/meetings')}
            className="px-4 py-2 bg-purple-600 text-white rounded-lg hover:bg-purple-700 transition-colors"
          >
            Back to Meetings
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-background">
      <div className="w-full mx-auto px-4 py-6 space-y-6">
        {/* Breadcrumb navigation and Export */}
        <div className="flex items-center justify-between">
          <button
            onClick={() => navigate('/meetings')}
            className="flex items-center text-sm text-muted-foreground hover:text-foreground transition-colors"
          >
            <ChevronLeft className="w-4 h-4 mr-1" />
            Back to Meetings
          </button>

          <div className="flex items-center gap-2">
            {/* Export Button */}
            <ExportButton
              meetingId={meeting.id}
              hasTranscripts={transcripts.length > 0}
              hasNotes={notes.length > 0}
            />

            {/* Delete Button */}
            <button
              onClick={() => setIsDeleteModalOpen(true)}
              className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-red-600 hover:text-red-700 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-lg transition-colors"
              title="Delete meeting"
            >
              <Trash2 className="w-4 h-4" />
              Delete
            </button>
          </div>
        </div>

        {/* Diarization Complete Notification */}
        {diarizationNotification?.show && (
          <div className="bg-green-50 border border-green-200 rounded-lg p-4 animate-in fade-in slide-in-from-top-2 duration-300">
            <div className="flex items-start gap-3">
              <div className="flex-shrink-0">
                <svg className="w-5 h-5 text-green-600" fill="currentColor" viewBox="0 0 20 20">
                  <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                </svg>
              </div>
              <div className="flex-1">
                <h4 className="text-sm font-medium text-green-900 mb-1">
                  Speaker Diarization Complete!
                </h4>
                <p className="text-sm text-green-700">
                  Successfully identified {diarizationNotification.speakersDetected} speaker(s). Transcripts have been updated with speaker labels.
                </p>
              </div>
              <button
                onClick={() => setDiarizationNotification(null)}
                className="flex-shrink-0 text-green-600 hover:text-green-800 transition-colors"
              >
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
          </div>
        )}

        {/* Action Items Extracted Notification */}
        {actionItemsNotification?.show && (
          <div className="bg-purple-50 border border-purple-200 rounded-lg p-4 animate-in fade-in slide-in-from-top-2 duration-300">
            <div className="flex items-start gap-3">
              <div className="flex-shrink-0">
                <svg className="w-5 h-5 text-purple-600" fill="currentColor" viewBox="0 0 20 20">
                  <path fillRule="evenodd" d="M6 2a1 1 0 00-1 1v1H4a2 2 0 00-2 2v10a2 2 0 002 2h12a2 2 0 002-2V6a2 2 0 00-2-2h-1V3a1 1 0 10-2 0v1H7V3a1 1 0 00-1-1zm0 5a1 1 0 000 2h8a1 1 0 100-2H6z" clipRule="evenodd" />
                </svg>
              </div>
              <div className="flex-1">
                <h4 className="text-sm font-medium text-purple-900 mb-1">
                  Tasks Created from Action Items!
                </h4>
                <p className="text-sm text-purple-700">
                  Automatically extracted {actionItemsNotification.actionItemsCount} action item{actionItemsNotification.actionItemsCount !== 1 ? 's' : ''} and created {actionItemsNotification.tasksCreated} task{actionItemsNotification.tasksCreated !== 1 ? 's' : ''} linked to this meeting.
                </p>
              </div>
              <button
                onClick={() => setActionItemsNotification(null)}
                className="flex-shrink-0 text-purple-600 hover:text-purple-800 transition-colors"
              >
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
          </div>
        )}

        {/* Meeting header */}
        <MeetingHeader
          meeting={meeting}
          transcripts={transcripts}
          speakers={speakers}
          onEdit={() => setIsEditModalOpen(true)}
          onManageSpeakers={() => setIsSpeakerModalOpen(true)}
        />

        {/* Edit Meeting Modal */}
        <EditMeetingModal
          isOpen={isEditModalOpen}
          onClose={() => setIsEditModalOpen(false)}
          meeting={meeting}
          onSuccess={debouncedRefetch}
        />

        {/* Speaker Management Modal */}
        <SpeakerManagementModal
          isOpen={isSpeakerModalOpen}
          onClose={() => setIsSpeakerModalOpen(false)}
          meetingId={meeting.id}
          speakers={speakers}
          speakerNameOverrides={speakerNameOverrides}
          transcripts={transcripts}
          onSuccess={debouncedRefetch}
        />

        {/* Audio player */}
        <div ref={audioPlayerRef}>
          <AudioPlayer
            audioFilePath={recordings.length > 0 ? recordings[0].file_path : meeting.audio_file_path}
            meetingId={meeting.id}
            lastRecording={recordings.length > 0 ? recordings[0] : null}
            onTimeUpdate={setCurrentAudioTime}
            onSeek={handleSeekAudio}
            onRecordingSaved={debouncedRefetch}
          />
        </div>

        {/* Main content area with optional insights panel */}
        <div className={`flex gap-4 ${isRecordingThisMeeting && showInsightsPanel ? 'flex-col lg:flex-row' : ''}`}>
          {/* Tabbed content */}
          <div className={`bg-card border border-border rounded-lg shadow-sm ${isRecordingThisMeeting && showInsightsPanel ? 'flex-1 min-w-0' : 'w-full'}`}>
            {/* Sorting indicator - shows when large dataset is being sorted in background */}
            {isSorting && (
              <div className="flex items-center justify-center gap-2 py-2 px-4 bg-purple-50 dark:bg-purple-900/20 border-b border-purple-200 dark:border-purple-800">
                <Loader2 className="w-4 h-4 animate-spin text-purple-600 dark:text-purple-400" />
                <span className="text-sm text-purple-700 dark:text-purple-300">
                  Sorting large dataset...
                </span>
              </div>
            )}
            <TabNavigation
              activeTab={activeTab}
              onTabChange={handleTabChange}
              transcriptCount={totalTranscriptCount}
              notesCount={notes.length}
              tasksCount={tasks.length}
              insightsCount={
                // Total insights = action items (from tasks created during recording) + decisions + key points + topics (notes)
                tasks.filter(t => t.created_during_recording).length +
                notes.filter(n => n.note_type === 'decision' || n.note_type === 'key_point').length
              }
              recordingsCount={recordings.length}
              isLiveTranscriptActive={isLiveTranscriptActive}
              isLiveInsightsActive={isRecordingThisMeeting}
            />

            <div className="p-6">
              {activeTab === 'transcript' && (
                <TranscriptTab
                  transcripts={transcripts}
                  speakers={speakers}
                  speakerNameOverrides={speakerNameOverrides}
                  currentAudioTime={currentAudioTime}
                  onSeekAudio={handleSeekAudio}
                  meetingId={meeting.id}
                />
              )}
              {activeTab === 'notes' && (
                <>
                  <div className="flex flex-wrap gap-4 mb-4">
                    <GenerateSummaryButton
                      meetingId={meeting.id}
                      hasTranscripts={transcripts.length > 0}
                      hasExistingSummary={hasExistingSummary}
                      onSummaryGenerated={debouncedRefetch}
                    />
                    <ExtractActionItemsButton
                      meetingId={meeting.id}
                      hasTranscripts={transcripts.length > 0}
                      hasExistingActionItems={hasExistingActionItems}
                      onActionItemsExtracted={debouncedRefetch}
                    />
                  </div>
                  <NotesTab
                    notes={notes}
                    onNotesUpdated={debouncedRefetch}
                  />
                </>
              )}
              {activeTab === 'tasks' && (
                <>
                  <ExtractActionItemsButton
                    meetingId={meeting.id}
                    hasTranscripts={transcripts.length > 0}
                    hasExistingActionItems={hasExistingActionItems}
                    onActionItemsExtracted={debouncedRefetch}
                  />
                  <ActionItemsList
                    tasks={tasks}
                    actionItemNotes={notes.filter(n => n.note_type === 'action_item')}
                    onTaskStatusChange={handleTaskStatusChange}
                  />
                </>
              )}
              {activeTab === 'insights' && (
                <InsightsTab
                  meetingId={meeting.id}
                  notes={notes}
                  tasks={tasks}
                  hasTranscripts={transcripts.length > 0}
                  meetingDurationMs={meeting.duration_seconds ? meeting.duration_seconds * 1000 : undefined}
                  recordingDurationMs={isRecordingThisMeeting ? recordingDuration : undefined}
                  onDataExtracted={debouncedRefetch}
                  onTaskStatusChange={handleTaskStatusChange}
                  isActive={activeTab === 'insights'}
                />
              )}
              {activeTab === 'recordings' && (
                <RecordingsTab
                  recordings={recordings}
                  onDelete={handleDeleteRecording}
                />
              )}
            </div>
          </div>

          {/* Real-time Insights Panel (Summary) - visible during recording */}
          {isRecordingThisMeeting && (
            <>
              {showInsightsPanel ? (
                <div className="lg:w-[40%] flex-shrink-0">
                  <RealtimeInsightsPanel
                    meetingId={meeting.id}
                    isRecording={isRecordingThisMeeting}
                    durationMs={recordingDuration}
                    onClose={() => setShowInsightsPanel(false)}
                  />
                </div>
              ) : (
                <button
                  onClick={() => setShowInsightsPanel(true)}
                  className="fixed right-4 bottom-4 lg:relative lg:right-auto lg:bottom-auto flex items-center gap-2 px-3 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg shadow-lg transition-colors z-10"
                  title="Show Live Insights"
                  data-testid="show-insights-panel-button"
                >
                  <BarChart3 className="w-4 h-4" />
                  <span className="text-sm font-medium">Live Insights</span>
                </button>
              )}
            </>
          )}
        </div>

        {/* Delete Meeting Modal */}
        <DeleteMeetingModal
          isOpen={isDeleteModalOpen}
          onClose={() => setIsDeleteModalOpen(false)}
          meetingId={meeting.id}
          onDeleted={handleMeetingDeleted}
        />
      </div>
    </div>
  )
}
