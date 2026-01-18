import { useState, useRef, useEffect, useCallback } from 'react'
import { useParams, useSearchParams, useNavigate, useLocation } from 'react-router-dom'
import { ChevronLeft, Loader2, BarChart3, AlertCircle } from 'lucide-react'
import type { TaskStatus } from '../types/database'
import { useMeetingDetail } from '../hooks/useMeetingDetail'
import { useDebouncedCallback } from '../hooks/useDebouncedCallback'
import { useLiveTranscript } from '../hooks/useLiveTranscript'
import { useRecordingStore } from '../stores/recording-store'
import { useResponsive } from '../hooks/useResponsive'
import { useInsightsData } from '../hooks/useInsightsData'
import { CompactMeetingHeader } from '../components/meeting-detail/CompactMeetingHeader'
import { AudioPlayer } from '../components/meeting-detail/AudioPlayer'
import { TabNavigation, TabType } from '../components/meeting-detail/TabNavigation'
import { TranscriptTab } from '../components/meeting-detail/TranscriptTab'
import { NotesTab } from '../components/meeting-detail/NotesTab'
import { ActionItemsList } from '../components/meeting-detail/ActionItemsList'
import { InsightsTab } from '../components/meeting-detail/InsightsTab'
import { RecordingsTab } from '../components/meeting-detail/RecordingsTab'
import { MainContentArea } from '../components/meeting-detail/MainContentArea'
import { EditMeetingModal } from '../components/EditMeetingModal'
import { SpeakerManagementModal } from '../components/meeting-detail/SpeakerManagementModal'
import { Spinner } from '../components/ui/Spinner'
import { Skeleton, SkeletonText } from '../components/ui/Skeleton'
import { RealtimeInsightsPanel } from '../components/insights/RealtimeInsightsPanel'
import { DeleteMeetingModal } from '../components/DeleteMeetingModal'
import { MeetingDetailSidebar } from '../components/meeting-detail/MeetingDetailSidebar'
import { MobileAudioBottomSheet } from '../components/meeting-detail/MobileAudioBottomSheet'

export default function MeetingDetail() {
  const { id } = useParams<{ id: string }>()
  const [searchParams, setSearchParams] = useSearchParams()
  const navigate = useNavigate()
  const location = useLocation()
  const audioPlayerRef = useRef<HTMLDivElement>(null)

  // Responsive breakpoints
  const { isMobile, isTablet, isDesktop, deviceType } = useResponsive()

  // Get active tab from URL or default to 'overview'
  const activeTabFromUrl = (searchParams.get('tab') as TabType) || 'overview'
  const [activeTab, setActiveTab] = useState<TabType>(activeTabFromUrl)

  // Track the hash for scrolling to specific sections (e.g., #action-items)
  const [, setInsightsSectionHash] = useState<string | null>(
    location.hash ? location.hash.slice(1) : null
  )
  const [currentAudioTime, setCurrentAudioTime] = useState(0)
  const [isEditModalOpen, setIsEditModalOpen] = useState(false)
  const [isSpeakerModalOpen, setIsSpeakerModalOpen] = useState(false)
  const [showInsightsPanel, setShowInsightsPanel] = useState(true) // Real-time insights panel visibility
  const [isDeleteModalOpen, setIsDeleteModalOpen] = useState(false)
  const [activeSpeakerFilter, setActiveSpeakerFilter] = useState<string | null>(null)
  const [selectedRecordingId, setSelectedRecordingId] = useState<string | null>(null)

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

  // Fetch insights data (topics, sentiment) for Overview tab
  const {
    state: insightsState,
  } = useInsightsData({
    meetingId: id || '',
    lazyLoad: true,
    isActive: activeTab === 'overview' || activeTab === 'insights',
    initialNotes: notes,
    initialTasks: tasks,
    onDataChange: debouncedRefetch,
  })

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
    if (isRecordingThisMeeting && activeTab !== 'transcript' && activeTab !== 'insights') {
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

      // Only refetch data if it's for this meeting
      if (meetingId === id && success) {
        console.log(`[MeetingDetail] Diarization complete: ${speakersDetected} speakers detected`)
        // Refetch data to show updated speaker assignments (debounced)
        debouncedRefetch()
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

      // Only refetch data if it's for this meeting and tasks were created
      if (meetingId === id && success && (actionItemsCount > 0 || tasksCreated?.length > 0)) {
        console.log(`[MeetingDetail] Action items extracted: ${actionItemsCount} items, ${tasksCreated?.length || 0} tasks created`)
        // Refetch data to show updated tasks (debounced)
        debouncedRefetch()
      }
    }

    // Listen for the event from electron main process
    // @ts-ignore - electronAPI is available globally
    const removeListener = window.electronAPI?.onActionItemsExtracted?.(handleActionItemsExtracted)

    return () => {
      removeListener?.()
    }
  }, [id, debouncedRefetch])

  // Listen for automatic meeting summary generation completion
  useEffect(() => {
    const handleSummaryGenerated = (event: any) => {
      const { meetingId, success, notesCreated } = event

      // Only refetch data if it's for this meeting and notes were created
      if (meetingId === id && success && notesCreated?.length > 0) {
        console.log(`[MeetingDetail] Meeting summary generated: ${notesCreated?.length || 0} notes created`)
        // Refetch data to show updated summary in Overview tab (debounced)
        debouncedRefetch()
      }
    }

    // Listen for the event from electron main process
    // @ts-ignore - electronAPI is available globally
    const removeListener = window.electronAPI?.onSummaryGenerated?.(handleSummaryGenerated)

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

  // Loading state with skeleton - using design tokens
  if (isLoading) {
    return (
      <div className="min-h-screen bg-background">
        <div className="w-full mx-auto px-token-lg py-token-lg space-y-token-lg">
          {/* Breadcrumb skeleton */}
          <div className="flex items-center justify-between">
            <Skeleton className="h-5 w-32" />
            <Skeleton className="h-9 w-24" />
          </div>

          {/* Meeting header skeleton - using token-lg padding */}
          <div className="bg-card border border-border rounded-md p-token-lg space-y-token-lg animate-pulse">
            <div className="flex items-start justify-between">
              <div className="space-y-token-sm">
                <Skeleton className="h-8 w-64" />
                <Skeleton className="h-4 w-48" />
              </div>
              <Skeleton className="h-8 w-24" />
            </div>
            <div className="flex gap-token-lg">
              <Skeleton className="h-5 w-24" />
              <Skeleton className="h-5 w-24" />
              <Skeleton className="h-5 w-20" />
            </div>
          </div>

          {/* Audio player skeleton - using token-lg padding */}
          <div className="bg-card border border-border rounded-md p-token-lg animate-pulse">
            <div className="flex items-center gap-token-lg">
              <Skeleton className="h-10 w-10 rounded-full" />
              <div className="flex-1 space-y-token-sm">
                <Skeleton className="h-2 w-full rounded-full" />
                <div className="flex justify-between">
                  <Skeleton className="h-4 w-12" />
                  <Skeleton className="h-4 w-12" />
                </div>
              </div>
            </div>
          </div>

          {/* Tab content skeleton - using design tokens */}
          <div className="bg-card border border-border rounded-md shadow-subtle">
            {/* Tab navigation skeleton */}
            <div className="border-b border-border p-token-sm">
              <div className="flex gap-token-sm">
                <Skeleton className="h-9 w-24" />
                <Skeleton className="h-9 w-20" />
                <Skeleton className="h-9 w-20" />
                <Skeleton className="h-9 w-24" />
              </div>
            </div>
            {/* Tab content skeleton - using token-lg padding */}
            <div className="p-token-lg space-y-token-lg">
              <SkeletonText lines={3} />
              <div className="mt-token-lg">
                <SkeletonText lines={4} lastLineWidth="60%" />
              </div>
            </div>
          </div>

          {/* Loading indicator */}
          <div className="flex items-center justify-center py-token-lg">
            <Spinner size="md" variant="primary" label="Loading meeting details..." />
          </div>
        </div>
      </div>
    )
  }

  // Error state - using design tokens
  if (error) {
    return (
      <div className="flex items-center justify-center h-screen">
        <div className="text-center max-w-md">
          <AlertCircle className="w-12 h-12 text-red-600 mx-auto mb-token-lg" />
          <h2 className="text-xl font-semibold text-foreground mb-token-sm">Error Loading Meeting</h2>
          <p className="text-muted-foreground mb-token-lg">{error.message}</p>
          <button
            onClick={() => navigate('/meetings')}
            className="px-token-lg py-token-sm bg-purple-600 text-white rounded-md hover:bg-purple-700 transition-colors"
          >
            Back to Meetings
          </button>
        </div>
      </div>
    )
  }

  // Meeting not found - using design tokens
  if (!meeting) {
    return (
      <div className="flex items-center justify-center h-screen">
        <div className="text-center max-w-md">
          <AlertCircle className="w-12 h-12 text-amber-600 mx-auto mb-token-lg" />
          <h2 className="text-xl font-semibold text-foreground mb-token-sm">Meeting Not Found</h2>
          <p className="text-muted-foreground mb-token-lg">
            The meeting you're looking for doesn't exist or has been deleted.
          </p>
          <button
            onClick={() => navigate('/meetings')}
            className="px-token-lg py-token-sm bg-purple-600 text-white rounded-md hover:bg-purple-700 transition-colors"
          >
            Back to Meetings
          </button>
        </div>
      </div>
    )
  }

  // Responsive padding classes
  const containerPadding = isMobile
    ? 'px-token-sm py-token-sm'
    : isTablet
      ? 'px-token-md py-token-md'
      : 'px-token-lg py-token-lg'

  const contentGap = isMobile
    ? 'space-y-token-sm'
    : isTablet
      ? 'space-y-token-md'
      : 'space-y-token-lg'

  return (
    <div className="min-h-screen bg-background no-horizontal-scroll">
      {/* Responsive container with dynamic padding based on breakpoint */}
      <div className={`w-full mx-auto ${containerPadding} ${contentGap}`}>
        {/* Breadcrumb navigation - hide full text on mobile */}
        <div className="flex items-center">
          <button
            onClick={() => navigate('/meetings')}
            className="flex items-center text-sm text-muted-foreground hover:text-foreground transition-colors min-h-touch"
          >
            <ChevronLeft className="w-4 h-4 mr-1" />
            <span className={isMobile ? 'sr-only' : ''}>Back to Meetings</span>
            {isMobile && <span>Back</span>}
          </button>
        </div>

        {/* Removed large action banners - notifications now use toast/snackbar pattern via electron */}

        {/* Meeting header - responsive to device type */}
        <CompactMeetingHeader
          meeting={meeting}
          transcripts={transcripts}
          speakers={speakers}
          isRecording={isRecordingThisMeeting}
          recordingDuration={recordingDuration}
          onDelete={() => setIsDeleteModalOpen(true)}
          onReidentifySpeakers={() => setIsSpeakerModalOpen(true)}
          onReplaceInsights={() => {
            // Trigger insights regeneration - navigate to insights tab
            handleTabChange('insights')
            // Note: The actual regeneration is handled by UnifiedInsightsButton in InsightsTab
          }}
          onSettings={() => setIsSpeakerModalOpen(true)}
          onTitleChange={async (newTitle: string) => {
            await window.electronAPI.db.meetings.update(meeting.id, { title: newTitle })
            debouncedRefetch()
          }}
          hasTranscripts={transcripts.length > 0}
          hasNotes={notes.length > 0}
          hasExistingInsights={
            notes.some(n => n.is_ai_generated) ||
            tasks.some(t => t.created_during_recording)
          }
          hasDiarization={speakers.size > 0}
          existingInsightsCounts={{
            actionItems: tasks.filter(t => t.created_during_recording).length,
            decisions: notes.filter(n => n.note_type === 'decision').length,
            keyPoints: notes.filter(n => n.note_type === 'key_point').length,
            topics: notes.filter(n => n.note_type === 'summary').length, // topics stored as summaries
            summaries: notes.filter(n => n.note_type === 'summary').length
          }}
          isMobile={isMobile}
          isTablet={isTablet}
          deviceType={deviceType}
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

        {/* Main content area with sidebar - responsive layout */}
        <div
          className={`${isDesktop ? 'flex gap-token-lg' : 'flex flex-col gap-token-md'}`}
          data-testid="meeting-detail-layout"
        >
          {/* Main content - full width on mobile/tablet, 70% on desktop */}
          <div className={`${isDesktop ? 'flex-1' : 'w-full'} min-w-0 ${contentGap}`}>
            {/* Audio player - regular on desktop, hidden on mobile (shown in bottom sheet) */}
            {!isMobile && (
              <div ref={audioPlayerRef}>
                <AudioPlayer
                  audioFilePath={
                    // Use selected recording, or first recording, or legacy audio file path
                    selectedRecordingId
                      ? recordings.find(r => r.id === selectedRecordingId)?.file_path || (recordings.length > 0 ? recordings[0].file_path : meeting.audio_file_path)
                      : recordings.length > 0 ? recordings[0].file_path : meeting.audio_file_path
                  }
                  meetingId={meeting.id}
                  lastRecording={
                    selectedRecordingId
                      ? recordings.find(r => r.id === selectedRecordingId) || (recordings.length > 0 ? recordings[0] : null)
                      : recordings.length > 0 ? recordings[0] : null
                  }
                  recordings={recordings}
                  onRecordingSelect={(recording) => {
                    setSelectedRecordingId(recording.id)
                  }}
                  onTimeUpdate={setCurrentAudioTime}
                  onSeek={handleSeekAudio}
                  onRecordingSaved={debouncedRefetch}
                />
              </div>
            )}

            {/* Content area with optional insights panel - responsive gap */}
            <div className={`flex ${isMobile ? 'gap-token-sm' : 'gap-token-lg'} ${isRecordingThisMeeting && showInsightsPanel ? 'flex-col lg:flex-row' : ''}`}>
              {/* Tabbed content - responsive padding */}
              <div className={`bg-card border border-border rounded-md shadow-subtle ${isRecordingThisMeeting && showInsightsPanel ? 'flex-1 min-w-0' : 'w-full'}`}>
                {/* Sorting indicator - shows when large dataset is being sorted in background */}
                {isSorting && (
                  <div className="flex items-center justify-center gap-token-sm py-token-sm px-token-lg bg-purple-50 dark:bg-purple-900/20 border-b border-purple-200 dark:border-purple-800">
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
                  isMobile={isMobile}
                  isTablet={isTablet}
                />

                {/* Tab content - responsive padding */}
                <div className={isMobile ? 'p-token-sm' : isTablet ? 'p-token-md' : 'p-token-lg'}>
                  {activeTab === 'overview' && (
                    <MainContentArea
                      meetingId={meeting.id}
                      notes={notes}
                      tasks={tasks}
                      transcripts={transcripts}
                      speakers={speakers}
                      speakerNameOverrides={speakerNameOverrides}
                      currentAudioTime={currentAudioTime}
                      onNotesUpdated={debouncedRefetch}
                      onTaskStatusChange={handleTaskStatusChange}
                      onSeekAudio={handleSeekAudio}
                      isMobile={isMobile}
                      isTablet={isTablet}
                      topics={insightsState.topics}
                      overallSentiment={insightsState.decisions.length > 0 || insightsState.topics.length > 0 ? 'neutral' : undefined}
                      meetingDurationMs={meeting.duration_seconds ? meeting.duration_seconds * 1000 : undefined}
                      isRecording={isRecordingThisMeeting}
                    />
                  )}
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
                    <NotesTab
                      notes={notes}
                      meetingId={meeting.id}
                      onNotesUpdated={debouncedRefetch}
                    />
                  )}
                  {activeTab === 'tasks' && (
                    <ActionItemsList
                      tasks={tasks}
                      onTaskStatusChange={handleTaskStatusChange}
                    />
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
          </div>

          {/* Meeting Detail Sidebar - responsive: collapsible on mobile, below content on tablet */}
          <MeetingDetailSidebar
            meeting={meeting}
            recordings={recordings}
            speakers={speakers}
            speakerNameOverrides={speakerNameOverrides}
            transcripts={transcripts}
            isRecording={isRecordingThisMeeting}
            recordingDuration={recordingDuration}
            onSpeakerFilter={setActiveSpeakerFilter}
            activeSpeakerFilter={activeSpeakerFilter}
            onRecordingSaved={debouncedRefetch}
            isMobile={isMobile}
            isTablet={isTablet}
            isDesktop={isDesktop}
          />
        </div>

        {/* Mobile Audio Bottom Sheet - fixed at bottom on mobile devices */}
        {isMobile && (
          <MobileAudioBottomSheet
            audioFilePath={
              selectedRecordingId
                ? recordings.find(r => r.id === selectedRecordingId)?.file_path || (recordings.length > 0 ? recordings[0].file_path : meeting.audio_file_path)
                : recordings.length > 0 ? recordings[0].file_path : meeting.audio_file_path
            }
            meetingId={meeting.id}
            lastRecording={
              selectedRecordingId
                ? recordings.find(r => r.id === selectedRecordingId) || (recordings.length > 0 ? recordings[0] : null)
                : recordings.length > 0 ? recordings[0] : null
            }
            recordings={recordings}
            onRecordingSelect={(recording) => setSelectedRecordingId(recording.id)}
            onTimeUpdate={setCurrentAudioTime}
            onSeek={handleSeekAudio}
            onRecordingSaved={debouncedRefetch}
          />
        )}

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
