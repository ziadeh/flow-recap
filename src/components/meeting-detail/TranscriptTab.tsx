/**
 * TranscriptTab Component
 * Wrapper component that integrates the TranscriptViewer into the meeting detail tabs.
 * Supports both static transcript viewing and live transcript display during recording.
 *
 * Features:
 * - Chat-style transcript display with speaker timeline
 * - Individual speaker boxes with unique labels and colors
 * - Auto-detection of speakers based on timing gaps
 * - Multiple visual layouts (chat, card, default, compact)
 * - Speaker legend showing all participants
 * - Full-text search with FTS5 and match highlighting
 */

import { useEffect, useState, useCallback } from 'react'
import { TranscriptViewer, LiveTranscriptViewer, IndividualSpeakerBoxViewer, ChatStyleTranscriptViewer, CollapsibleTranscriptSection } from '../transcript'
import { TranscriptSearch } from '../transcript/TranscriptSearch'
import { useRecordingStore } from '../../stores/recording-store'
import { useLiveTranscriptStore } from '../../stores/live-transcript-store'
import type { Transcript, Speaker } from '../../types/database'

// ============================================================================
// Types
// ============================================================================

/** Available transcript view modes */
export type TranscriptViewMode = 'chat' | 'card' | 'default' | 'collapsible'

export interface TranscriptTabProps {
  /** Array of transcript entries to display */
  transcripts: Transcript[]
  /** Map of speaker IDs to Speaker objects */
  speakers: Map<string, Speaker>
  /** Map of speaker IDs to meeting-specific display names (overrides speaker.name) */
  speakerNameOverrides?: Map<string, string>
  /** Current audio playback time in seconds */
  currentAudioTime?: number
  /** Callback when a timestamp is clicked for audio seeking */
  onSeekAudio?: (timeInSeconds: number) => void
  /** Meeting ID for live transcript matching */
  meetingId?: string
  /** Whether to use enhanced individual speaker box view (default: true) */
  useIndividualBoxes?: boolean
  /** Initial view mode for transcripts (default: 'chat') */
  initialViewMode?: TranscriptViewMode
}

// ============================================================================
// Component
// ============================================================================

export function TranscriptTab({
  transcripts,
  speakers,
  speakerNameOverrides = new Map(),
  currentAudioTime = 0,
  onSeekAudio,
  meetingId,
  useIndividualBoxes = true,
  initialViewMode = 'chat',
}: TranscriptTabProps) {
  // ============================================================================
  // ALL HOOKS MUST BE AT THE TOP - REACT RULES OF HOOKS
  // ============================================================================

  // View mode state - chat style is the default
  // Note: setViewMode can be exposed later for view switching functionality
  const [viewMode, _setViewMode] = useState<TranscriptViewMode>(initialViewMode)
  // Suppress unused variable warning (available for future view switching)
  void _setViewMode

  // State for diarization button - MOVED TO TOP
  const [isDiarizing, setIsDiarizing] = useState(false)
  const [diarizationResult, setDiarizationResult] = useState<string | null>(null)

  // Search state
  const [searchQuery, setSearchQuery] = useState('')
  const [searchMatchIds, setSearchMatchIds] = useState<string[]>([])
  const [currentSearchIndex, setCurrentSearchIndex] = useState(0)

  // Current search match ID derived from state
  const currentSearchMatchId = searchMatchIds.length > 0 && currentSearchIndex >= 0
    ? searchMatchIds[currentSearchIndex]
    : undefined

  // Handler for search results
  const handleSearchResults = useCallback((matchingIds: string[], currentIndex: number) => {
    setSearchMatchIds(matchingIds)
    setCurrentSearchIndex(currentIndex)
  }, [])

  // Handler for query changes
  const handleQueryChange = useCallback((query: string) => {
    setSearchQuery(query)
    if (!query.trim()) {
      setSearchMatchIds([])
      setCurrentSearchIndex(0)
    }
  }, [])

  // Recording state
  const recordingStatus = useRecordingStore((state) => state.status)
  const recordingMeetingId = useRecordingStore((state) => state.meetingId)
  const recordingDuration = useRecordingStore((state) => state.duration)

  // Live transcript state
  const liveStatus = useLiveTranscriptStore((state) => state.status)
  const liveSegments = useLiveTranscriptStore((state) => state.segments)
  const liveError = useLiveTranscriptStore((state) => state.error)
  const liveMeetingId = useLiveTranscriptStore((state) => state.meetingId)

  // Debug logging
  useEffect(() => {
    console.log('[TranscriptTab] State:', {
      meetingId,
      recordingStatus,
      recordingMeetingId,
      liveStatus,
      liveMeetingId,
      liveSegmentsCount: liveSegments.length,
    })
  }, [meetingId, recordingStatus, recordingMeetingId, liveStatus, liveMeetingId, liveSegments.length])

  // Determine if we should show live transcript view
  // Show live view when:
  // 1. Recording is active (regardless of meeting ID match - recording could be for this meeting)
  // 2. Live transcription status is not idle
  const isRecording = recordingStatus === 'recording' || recordingStatus === 'paused'

  // Check if this is recording for this specific meeting
  const isRecordingThisMeeting = isRecording && recordingMeetingId === meetingId

  // Check if live transcription is active
  // Be more permissive - show if status is not idle, even if meeting IDs don't match yet
  const isLiveTranscriptionActive = liveStatus !== 'idle'

  // Show live view if:
  // 1. We're recording this meeting, OR
  // 2. Live transcription is active (status !== idle)
  // This is more permissive to ensure we show the live view even during initialization
  const showLiveView = isRecordingThisMeeting || (isRecording && isLiveTranscriptionActive)

  console.log('[TranscriptTab] Computed:', {
    isRecording,
    isRecordingThisMeeting,
    isLiveTranscriptionActive,
    showLiveView,
  })

  // If live transcription is active, show the live viewer
  if (showLiveView) {
    return (
      <div className="space-y-4">
        {/* Live Transcript View */}
        <LiveTranscriptViewer
          segments={liveSegments}
          speakers={speakers}
          status={liveStatus}
          error={liveError}
          recordingDuration={recordingDuration}
          autoScroll={true}
        />

        {/* Show existing transcripts below if there are any */}
        {transcripts.length > 0 && (
          <div className="border-t border-border pt-4 mt-4">
            <h3 className="text-sm font-medium text-muted-foreground mb-3">
              Previous Transcripts
            </h3>
            <TranscriptViewer
              transcripts={transcripts}
              speakers={speakers}
              currentAudioTime={currentAudioTime}
              onSeekAudio={onSeekAudio}
              autoScroll={false}
            />
          </div>
        )}
      </div>
    )
  }

  // Check if transcripts have speaker assignments
  const hasUnassignedSpeakers = transcripts.some(t => !t.speaker_id)

  // Calculate unique speakers in THIS meeting's transcripts (not all speakers in DB)
  const uniqueSpeakerIdsInMeeting = new Set(
    transcripts
      .map(t => t.speaker_id)
      .filter((id): id is string => id !== null && id !== undefined)
  )
  const uniqueSpeakerCountInMeeting = uniqueSpeakerIdsInMeeting.size

  // Handle diarization button click
  const handleRunDiarization = async () => {
    if (!meetingId) return

    setIsDiarizing(true)
    setDiarizationResult(null)

    try {
      // First check if diarization is already in progress
      const statusResult = await window.electronAPI.recording.getDiarizationStatus()
      if (statusResult.success && statusResult.status !== 'idle') {
        // Diarization is in progress or stuck - try to reset it
        console.log(`[TranscriptTab] Diarization status is '${statusResult.status}', attempting reset...`)
        await window.electronAPI.recording.resetDiarizationState()
        // Small delay to let the state settle
        await new Promise(resolve => setTimeout(resolve, 100))
      }

      const result = await window.electronAPI.recording.runDiarization(meetingId)
      if (result.success) {
        setDiarizationResult(`✅ Success! Detected ${result.speakersDetected} speaker(s). Please refresh to see results.`)
        // Trigger a refresh after a delay
        setTimeout(() => {
          window.location.reload()
        }, 2000)
      } else {
        // If we still get "Diarization already in progress", try to reset and inform user
        if (result.error?.includes('already in progress')) {
          console.log('[TranscriptTab] Got "already in progress" error, attempting state reset...')
          await window.electronAPI.recording.resetDiarizationState()
          setDiarizationResult(`❌ Failed: ${result.error}. State has been reset - please try again.`)
        } else {
          setDiarizationResult(`❌ Failed: ${result.error}`)
        }
      }
    } catch (error) {
      setDiarizationResult(`❌ Error: ${error instanceof Error ? error.message : 'Unknown error'}`)
    } finally {
      setIsDiarizing(false)
    }
  }

  // Handle re-identify speakers (clear existing and re-run)
  const handleReidentifySpeakers = async () => {
    if (!meetingId) return

    // Show confirmation dialog
    const confirmed = window.confirm(
      'This will clear all existing speaker identifications and re-run speaker detection. Continue?'
    )

    if (!confirmed) return

    setIsDiarizing(true)
    setDiarizationResult(null)

    try {
      // First check if diarization is already in progress
      const statusResult = await window.electronAPI.recording.getDiarizationStatus()
      if (statusResult.success && statusResult.status !== 'idle') {
        // Diarization is in progress or stuck - try to reset it
        console.log(`[TranscriptTab] Diarization status is '${statusResult.status}', attempting reset...`)
        await window.electronAPI.recording.resetDiarizationState()
        // Small delay to let the state settle
        await new Promise(resolve => setTimeout(resolve, 100))
      }

      // First, clear existing speakers
      const clearResult = await window.electronAPI.recording.clearSpeakers(meetingId)

      if (!clearResult.success) {
        setDiarizationResult(`❌ Failed to clear speakers: ${clearResult.error}`)
        return
      }

      // Then run diarization
      const result = await window.electronAPI.recording.runDiarization(meetingId)
      if (result.success) {
        setDiarizationResult(`✅ Success! Detected ${result.speakersDetected} speaker(s). Please refresh to see results.`)
        // Trigger a refresh after a delay
        setTimeout(() => {
          window.location.reload()
        }, 2000)
      } else {
        // If we still get "Diarization already in progress", try to reset and inform user
        if (result.error?.includes('already in progress')) {
          console.log('[TranscriptTab] Got "already in progress" error, attempting state reset...')
          await window.electronAPI.recording.resetDiarizationState()
          setDiarizationResult(`❌ Failed: ${result.error}. State has been reset - please try again.`)
        } else {
          setDiarizationResult(`❌ Failed: ${result.error}`)
        }
      }
    } catch (error) {
      setDiarizationResult(`❌ Error: ${error instanceof Error ? error.message : 'Unknown error'}`)
    } finally {
      setIsDiarizing(false)
    }
  }

  // Collapsible view mode - new redesigned component
  if (viewMode === 'collapsible') {
    return (
      <div className="space-y-4">
        {/* Show diarization button if transcripts have unassigned speakers */}
        {hasUnassignedSpeakers && transcripts.length > 0 && meetingId && (
          <div className="bg-amber-50 border border-amber-200 rounded-lg p-4">
            <div className="flex items-start gap-3">
              <div className="flex-shrink-0 mt-0.5">
                <svg className="w-5 h-5 text-amber-600" fill="currentColor" viewBox="0 0 20 20">
                  <path fillRule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clipRule="evenodd"/>
                </svg>
              </div>
              <div className="flex-1">
                <h4 className="text-sm font-medium text-amber-900 mb-1">
                  Speakers Not Identified
                </h4>
                <p className="text-sm text-amber-700 mb-3">
                  This meeting has transcripts but speakers haven't been identified yet. Run speaker diarization to automatically detect and label different speakers.
                </p>
                <button
                  onClick={handleRunDiarization}
                  disabled={isDiarizing}
                  className="inline-flex items-center gap-2 px-4 py-2 bg-amber-600 text-white text-sm font-medium rounded-lg hover:bg-amber-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                >
                  {isDiarizing ? (
                    <>
                      <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"/>
                      </svg>
                      <span>Identifying Speakers...</span>
                    </>
                  ) : (
                    <>
                      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z"/>
                      </svg>
                      <span>Identify Speakers</span>
                    </>
                  )}
                </button>
                {diarizationResult && (
                  <p className="mt-2 text-sm text-amber-800">{diarizationResult}</p>
                )}
              </div>
            </div>
          </div>
        )}

        <CollapsibleTranscriptSection
          transcripts={transcripts}
          speakers={speakers}
          speakerNameOverrides={speakerNameOverrides}
          currentAudioTime={currentAudioTime}
          onSeekAudio={onSeekAudio}
          meetingId={meetingId}
          defaultExpanded={false}
        />
      </div>
    )
  }

  // Default: show chat-style transcript viewer (matches the design reference)
  if (viewMode === 'chat') {
    return (
      <div className="space-y-4">
        {/* Search bar for transcripts */}
        {meetingId && transcripts.length > 0 && (
          <div className="flex items-center justify-end">
            <TranscriptSearch
              meetingId={meetingId}
              onSearchResults={handleSearchResults}
              onQueryChange={handleQueryChange}
              placeholder="Search transcript..."
            />
          </div>
        )}

        {/* Show diarization button if transcripts have unassigned speakers */}
        {hasUnassignedSpeakers && transcripts.length > 0 && meetingId && (
          <div className="bg-amber-50 border border-amber-200 rounded-lg p-4">
            <div className="flex items-start gap-3">
              <div className="flex-shrink-0 mt-0.5">
                <svg className="w-5 h-5 text-amber-600" fill="currentColor" viewBox="0 0 20 20">
                  <path fillRule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clipRule="evenodd"/>
                </svg>
              </div>
              <div className="flex-1">
                <h4 className="text-sm font-medium text-amber-900 mb-1">
                  Speakers Not Identified
                </h4>
                <p className="text-sm text-amber-700 mb-3">
                  This meeting has transcripts but speakers haven't been identified yet. Run speaker diarization to automatically detect and label different speakers.
                </p>
                <button
                  onClick={handleRunDiarization}
                  disabled={isDiarizing}
                  className="inline-flex items-center gap-2 px-4 py-2 bg-amber-600 text-white text-sm font-medium rounded-lg hover:bg-amber-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                >
                  {isDiarizing ? (
                    <>
                      <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"/>
                      </svg>
                      <span>Identifying Speakers...</span>
                    </>
                  ) : (
                    <>
                      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z"/>
                      </svg>
                      <span>Identify Speakers</span>
                    </>
                  )}
                </button>
                {diarizationResult && (
                  <p className="mt-2 text-sm text-amber-800">{diarizationResult}</p>
                )}
              </div>
            </div>
          </div>
        )}

        {/* Show re-identify button if speakers have already been identified */}
        {!hasUnassignedSpeakers && uniqueSpeakerCountInMeeting > 0 && transcripts.length > 0 && meetingId && (
          <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
            <div className="flex items-start gap-3">
              <div className="flex-shrink-0 mt-0.5">
                <svg className="w-5 h-5 text-blue-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                </svg>
              </div>
              <div className="flex-1">
                <h4 className="text-sm font-medium text-blue-900 mb-1">
                  {uniqueSpeakerCountInMeeting === 1 ? 'Single Speaker Detected' : 'Re-identify Speakers'}
                </h4>
                {uniqueSpeakerCountInMeeting === 1 ? (
                  <div className="text-sm text-blue-700 mb-3 space-y-2">
                    <p>
                      Only one speaker was detected in this recording. This is expected for single-person audio like podcasts, tutorials, or presentations.
                    </p>
                    <p className="text-xs text-blue-600">
                      <strong>If you expected multiple speakers:</strong> The diarization system identifies speakers based on voice characteristics.
                      Similar-sounding voices or audio quality issues may cause multiple people to be grouped as one speaker.
                      You can try re-running speaker detection below.
                    </p>
                  </div>
                ) : (
                  <p className="text-sm text-blue-700 mb-3">
                    Speakers have been identified for this meeting. Click below to clear the current speaker identifications and run the detection process again.
                  </p>
                )}
                <button
                  onClick={handleReidentifySpeakers}
                  disabled={isDiarizing}
                  className="inline-flex items-center gap-2 px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                >
                  {isDiarizing ? (
                    <>
                      <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"/>
                      </svg>
                      <span>Re-identifying Speakers...</span>
                    </>
                  ) : (
                    <>
                      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                      </svg>
                      <span>Re-identify Speakers</span>
                    </>
                  )}
                </button>
                {diarizationResult && (
                  <p className="mt-2 text-sm text-blue-800">{diarizationResult}</p>
                )}
              </div>
            </div>
          </div>
        )}
        <ChatStyleTranscriptViewer
          transcripts={transcripts}
          speakers={speakers}
          speakerNameOverrides={speakerNameOverrides}
          currentAudioTime={currentAudioTime}
          onSeekAudio={onSeekAudio}
          autoScroll={true}
          showTimeline={true}
          searchQuery={searchQuery}
          searchMatchIds={searchMatchIds}
          currentSearchMatchId={currentSearchMatchId}
        />
      </div>
    )
  }

  // Card mode: Use IndividualSpeakerBoxViewer for enhanced speaker identification
  if (viewMode === 'card' && useIndividualBoxes) {
    return (
      <IndividualSpeakerBoxViewer
        transcripts={transcripts}
        speakers={speakers}
        currentAudioTime={currentAudioTime}
        onSeekAudio={onSeekAudio}
        autoScroll={true}
        variant="card"
        unknownSpeakerMode="sequential"
        showSpeakerLegend={true}
        showViewControls={true}
      />
    )
  }

  // Default/fallback to original TranscriptViewer
  return (
    <TranscriptViewer
      transcripts={transcripts}
      speakers={speakers}
      currentAudioTime={currentAudioTime}
      onSeekAudio={onSeekAudio}
      autoScroll={true}
    />
  )
}
