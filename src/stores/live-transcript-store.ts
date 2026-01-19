/**
 * Live Transcript Store
 *
 * Manages state for real-time transcript display during active recordings.
 * Stores interim transcription results that are streamed from the Whisper service.
 */

import { create } from 'zustand'
import { useShallow } from 'zustand/react/shallow'
import type { Transcript } from '../types/database'

// Status of the live transcription service
export type LiveTranscriptStatus =
  | 'idle'           // Not transcribing
  | 'starting'       // Initializing transcription service
  | 'active'         // Actively transcribing
  | 'paused'         // Recording paused, transcription suspended
  | 'processing'     // Processing final batch
  | 'error'          // Error occurred

// A live transcript segment (similar to Transcript but may be interim)
export interface LiveTranscriptSegment {
  id: string
  content: string
  start_time_ms: number
  end_time_ms: number
  confidence: number
  is_final: boolean
  speaker_id?: string | null
  /** Speaker label from diarization (e.g., "Speaker_0") */
  speaker?: string | null
}

// Error information
export interface LiveTranscriptError {
  code: string
  message: string
  timestamp: number
  recoverable: boolean
}

// Progress information for transcription phases
export interface TranscriptionProgress {
  phase: string
  progress: number
  message: string
}

// Diarization capability status
export interface DiarizationStatus {
  /** Whether speaker diarization is available */
  available: boolean
  /** Reason for unavailability (if not available) */
  unavailableReason?: string | null
  /** Detailed capabilities */
  capabilities?: {
    speaker_embeddings: boolean
    speaker_clustering: boolean
    speaker_change_detection: boolean
    transcription_only: boolean
    max_speakers?: number
    similarity_threshold?: number
    embedding_backend?: string
  } | null
  /** User-friendly message about diarization status */
  message?: string
}

// Streaming diarization speaker segment (real-time speaker detection)
export interface StreamingSpeakerSegment {
  /** Unique segment ID */
  id: string
  /** Speaker label (e.g., "Speaker_0") */
  speaker: string
  /** Start time in seconds */
  startTime: number
  /** End time in seconds */
  endTime: number
  /** Confidence score (0.0-1.0) */
  confidence: number
  /** Whether this segment is final or may be updated */
  isFinal: boolean
  /** Whether this was retroactively corrected */
  wasRetroactivelyCorrected?: boolean
}

// Streaming diarization state
export interface StreamingDiarizationState {
  /** Current status of streaming diarization */
  status: 'idle' | 'initializing' | 'ready' | 'active' | 'paused' | 'stopping' | 'error'
  /** Number of speakers detected so far */
  numSpeakersDetected: number
  /** Total audio processed in seconds */
  totalAudioProcessed: number
  /** Whether cold-start phase is complete */
  coldStartComplete: boolean
  /** Error message if in error state */
  error?: string
}

// Speaker change event (emitted when active speaker changes)
export interface SpeakerChangeEvent {
  /** Timestamp of the change in seconds */
  time: number
  /** Previous speaker (null if first speaker) */
  fromSpeaker: string | null
  /** New speaker */
  toSpeaker: string
  /** Confidence in the change detection */
  confidence: number
}

// Retroactive correction event (when speaker labels are corrected based on better evidence)
export interface RetroactiveCorrectionEvent {
  /** Original speaker label */
  originalSpeaker: string
  /** Corrected speaker label */
  correctedSpeaker: string
  /** Affected time range start */
  startTime: number
  /** Affected time range end */
  endTime: number
  /** IDs of segments that were corrected */
  affectedSegmentIds: string[]
  /** Reason for the correction */
  reason: string
}

interface LiveTranscriptState {
  // Current status of live transcription
  status: LiveTranscriptStatus

  // Meeting ID being transcribed
  meetingId: string | null

  // Live transcript segments (interim and final)
  segments: LiveTranscriptSegment[]

  // IDs of segments that have been saved to database (to avoid duplicates)
  savedSegmentIds: Set<string>

  // Current error if any
  error: LiveTranscriptError | null

  // Progress information
  progress: TranscriptionProgress | null

  // Session start time
  sessionStartTime: number | null

  // Last update timestamp
  lastUpdateTime: number | null

  // Whether live transcription is enabled for this session
  isEnabled: boolean

  // Speaker diarization status and capabilities
  // This tracks whether real speaker separation is available
  diarizationStatus: DiarizationStatus

  // Streaming diarization state (real-time speaker detection)
  streamingDiarization: StreamingDiarizationState

  // Streaming speaker segments (from real-time diarization)
  speakerSegments: StreamingSpeakerSegment[]

  // Recent speaker change events
  speakerChanges: SpeakerChangeEvent[]

  // Retroactive corrections applied
  retroactiveCorrections: RetroactiveCorrectionEvent[]
}

interface LiveTranscriptActions {
  // Start a new live transcription session
  startSession: (meetingId: string) => void

  // Stop the live transcription session
  stopSession: () => void

  // Pause transcription (when recording is paused)
  pauseSession: () => void

  // Resume transcription (when recording is resumed)
  resumeSession: () => void

  // Add a new transcript segment
  addSegment: (segment: LiveTranscriptSegment) => void

  // Update an existing segment (e.g., when interim becomes final)
  updateSegment: (id: string, updates: Partial<LiveTranscriptSegment>) => void

  // Add multiple segments at once (batch update)
  addSegments: (segments: LiveTranscriptSegment[]) => void

  // Clear all segments
  clearSegments: () => void

  // Set error state
  setError: (error: LiveTranscriptError | null) => void

  // Set status
  setStatus: (status: LiveTranscriptStatus) => void

  // Set progress
  setProgress: (progress: TranscriptionProgress | null) => void

  // Enable/disable live transcription
  setEnabled: (enabled: boolean) => void

  // Set diarization status (called when Python reports availability)
  setDiarizationStatus: (status: DiarizationStatus) => void

  // === Streaming Diarization Actions ===

  // Set streaming diarization state
  setStreamingDiarizationState: (state: Partial<StreamingDiarizationState>) => void

  // Add a speaker segment from streaming diarization
  addSpeakerSegment: (segment: StreamingSpeakerSegment) => void

  // Update a speaker segment (e.g., after retroactive correction)
  updateSpeakerSegment: (id: string, updates: Partial<StreamingSpeakerSegment>) => void

  // Add a speaker change event
  addSpeakerChange: (event: SpeakerChangeEvent) => void

  // Apply retroactive correction to segments
  applyRetroactiveCorrection: (correction: RetroactiveCorrectionEvent) => void

  // Clear streaming diarization data (for session reset)
  clearStreamingDiarization: () => void

  // Get speaker for a transcript segment based on time overlap
  getSpeakerForTimeRange: (startTimeMs: number, endTimeMs: number) => { speaker: string; confidence: number } | null

  // Reset entire store
  reset: () => void

  // Convert live segments to database format
  getTranscriptsForSave: () => Omit<Transcript, 'created_at'>[]

  // Save transcripts to database
  saveToDatabase: () => Promise<{ success: boolean; count: number; error?: string }>
}

const initialState: LiveTranscriptState = {
  status: 'idle',
  meetingId: null,
  segments: [],
  savedSegmentIds: new Set<string>(),
  error: null,
  progress: null,
  sessionStartTime: null,
  lastUpdateTime: null,
  isEnabled: true,
  diarizationStatus: {
    available: false,  // Unknown until Python reports
    unavailableReason: null,
    capabilities: null,
    message: 'Speaker diarization status not yet determined'
  },
  // Streaming diarization initial state
  streamingDiarization: {
    status: 'idle',
    numSpeakersDetected: 0,
    totalAudioProcessed: 0,
    coldStartComplete: false
  },
  speakerSegments: [],
  speakerChanges: [],
  retroactiveCorrections: []
}

export const useLiveTranscriptStore = create<LiveTranscriptState & LiveTranscriptActions>()(
  (set, get) => ({
    ...initialState,

    startSession: (meetingId: string) => {
      set({
        status: 'starting',
        meetingId,
        segments: [],
        savedSegmentIds: new Set<string>(),
        error: null,
        progress: null,
        sessionStartTime: Date.now(),
        lastUpdateTime: null,
      })
    },

    stopSession: () => {
      set({
        status: 'idle',
        progress: null,
      })
    },

    pauseSession: () => {
      const { status } = get()
      if (status === 'active') {
        set({ status: 'paused' })
      }
    },

    resumeSession: () => {
      const { status } = get()
      if (status === 'paused') {
        set({ status: 'active' })
      }
    },

    addSegment: (segment: LiveTranscriptSegment) => {
      set((state) => ({
        segments: [...state.segments, segment],
        lastUpdateTime: Date.now(),
        status: state.status === 'starting' ? 'active' : state.status,
      }))
    },

    updateSegment: (id: string, updates: Partial<LiveTranscriptSegment>) => {
      set((state) => ({
        segments: state.segments.map((seg) =>
          seg.id === id ? { ...seg, ...updates } : seg
        ),
        lastUpdateTime: Date.now(),
      }))
    },

    addSegments: (segments: LiveTranscriptSegment[]) => {
      set((state) => ({
        segments: [...state.segments, ...segments],
        lastUpdateTime: Date.now(),
        status: state.status === 'starting' ? 'active' : state.status,
      }))
    },

    clearSegments: () => {
      set({ segments: [], lastUpdateTime: null })
    },

    setError: (error: LiveTranscriptError | null) => {
      set({
        error,
        status: error ? 'error' : get().status,
      })
    },

    setStatus: (status: LiveTranscriptStatus) => {
      set({ status })
    },

    setProgress: (progress: TranscriptionProgress | null) => {
      set({ progress })
    },

    setEnabled: (enabled: boolean) => {
      set({ isEnabled: enabled })
    },

    setDiarizationStatus: (status: DiarizationStatus) => {
      set({ diarizationStatus: status })

      // Log diarization status for debugging
      if (status.available) {
        console.log('[LiveTranscriptStore] Diarization available:', status.capabilities)
      } else {
        console.warn('[LiveTranscriptStore] Diarization unavailable:', status.unavailableReason, status.message)
      }
    },

    // === Streaming Diarization Actions ===

    setStreamingDiarizationState: (state: Partial<StreamingDiarizationState>) => {
      set((current) => ({
        streamingDiarization: { ...current.streamingDiarization, ...state }
      }))

      // Log significant state changes
      if (state.status) {
        console.log(`[LiveTranscriptStore] Streaming diarization status: ${state.status}`)
      }
      if (state.coldStartComplete) {
        console.log('[LiveTranscriptStore] Streaming diarization cold-start complete')
      }
    },

    addSpeakerSegment: (segment: StreamingSpeakerSegment) => {
      set((state) => {
        // Update speaker segments
        const newSegments = [...state.speakerSegments, segment]

        // Also try to assign speaker to matching transcript segments
        const updatedTranscriptSegments = state.segments.map((transcriptSeg) => {
          // If segment doesn't have a speaker assigned, check if this diarization segment overlaps
          if (!transcriptSeg.speaker && !transcriptSeg.speaker_id) {
            const transcriptStartSec = transcriptSeg.start_time_ms / 1000
            const transcriptEndSec = transcriptSeg.end_time_ms / 1000

            // Check for overlap
            const overlapStart = Math.max(transcriptStartSec, segment.startTime)
            const overlapEnd = Math.min(transcriptEndSec, segment.endTime)

            if (overlapEnd > overlapStart) {
              // Has overlap, assign speaker
              return {
                ...transcriptSeg,
                speaker: segment.speaker
              }
            }
          }
          return transcriptSeg
        })

        return {
          speakerSegments: newSegments,
          segments: updatedTranscriptSegments,
          lastUpdateTime: Date.now()
        }
      })
    },

    updateSpeakerSegment: (id: string, updates: Partial<StreamingSpeakerSegment>) => {
      set((state) => ({
        speakerSegments: state.speakerSegments.map((seg) =>
          seg.id === id ? { ...seg, ...updates } : seg
        ),
        lastUpdateTime: Date.now()
      }))
    },

    addSpeakerChange: (event: SpeakerChangeEvent) => {
      set((state) => ({
        speakerChanges: [...state.speakerChanges, event],
        lastUpdateTime: Date.now()
      }))

      console.log(`[LiveTranscriptStore] Speaker change: ${event.fromSpeaker || 'none'} -> ${event.toSpeaker} at ${event.time.toFixed(2)}s`)
    },

    applyRetroactiveCorrection: (correction: RetroactiveCorrectionEvent) => {
      set((state) => {
        // Update speaker segments with the correction
        const updatedSpeakerSegments = state.speakerSegments.map((seg) => {
          if (seg.speaker === correction.originalSpeaker &&
              seg.startTime >= correction.startTime &&
              seg.endTime <= correction.endTime) {
            return {
              ...seg,
              speaker: correction.correctedSpeaker,
              wasRetroactivelyCorrected: true
            }
          }
          return seg
        })

        // Also update transcript segments that had the old speaker
        const updatedTranscriptSegments = state.segments.map((seg) => {
          if (seg.speaker === correction.originalSpeaker) {
            const segStartSec = seg.start_time_ms / 1000
            const segEndSec = seg.end_time_ms / 1000

            if (segStartSec >= correction.startTime && segEndSec <= correction.endTime) {
              return {
                ...seg,
                speaker: correction.correctedSpeaker
              }
            }
          }
          return seg
        })

        return {
          speakerSegments: updatedSpeakerSegments,
          segments: updatedTranscriptSegments,
          retroactiveCorrections: [...state.retroactiveCorrections, correction],
          lastUpdateTime: Date.now()
        }
      })

      console.log(`[LiveTranscriptStore] Retroactive correction: ${correction.originalSpeaker} -> ${correction.correctedSpeaker} (${correction.affectedSegmentIds.length} segments)`)
    },

    clearStreamingDiarization: () => {
      set({
        streamingDiarization: {
          status: 'idle',
          numSpeakersDetected: 0,
          totalAudioProcessed: 0,
          coldStartComplete: false
        },
        speakerSegments: [],
        speakerChanges: [],
        retroactiveCorrections: []
      })
    },

    getSpeakerForTimeRange: (startTimeMs: number, endTimeMs: number) => {
      const { speakerSegments } = get()
      const startTimeSec = startTimeMs / 1000
      const endTimeSec = endTimeMs / 1000

      // Find best overlapping speaker segment
      let bestMatch: { speaker: string; confidence: number; overlap: number } | null = null

      for (const segment of speakerSegments) {
        const overlapStart = Math.max(startTimeSec, segment.startTime)
        const overlapEnd = Math.min(endTimeSec, segment.endTime)
        const overlap = Math.max(0, overlapEnd - overlapStart)

        if (overlap > 0 && (!bestMatch || overlap > bestMatch.overlap)) {
          bestMatch = {
            speaker: segment.speaker,
            confidence: segment.confidence,
            overlap
          }
        }
      }

      if (bestMatch) {
        return { speaker: bestMatch.speaker, confidence: bestMatch.confidence }
      }

      // Fallback: find nearest segment
      const midpoint = (startTimeSec + endTimeSec) / 2
      let nearestSegment: StreamingSpeakerSegment | null = null
      let nearestDistance = Infinity

      for (const segment of speakerSegments) {
        const distance = Math.min(
          Math.abs(segment.startTime - midpoint),
          Math.abs(segment.endTime - midpoint)
        )
        if (distance < nearestDistance && distance <= 1.0) {
          nearestDistance = distance
          nearestSegment = segment
        }
      }

      return nearestSegment
        ? { speaker: nearestSegment.speaker, confidence: nearestSegment.confidence * 0.8 }
        : null
    },

    reset: () => {
      set(initialState)
    },

    getTranscriptsForSave: () => {
      const { segments, meetingId } = get()
      if (!meetingId) return []

      return segments
        .filter((seg) => seg.is_final)
        .map((seg) => ({
          id: seg.id,
          meeting_id: meetingId,
          speaker_id: seg.speaker_id || null,
          content: seg.content,
          start_time_ms: seg.start_time_ms,
          end_time_ms: seg.end_time_ms,
          confidence: seg.confidence,
          is_final: seg.is_final,
        }))
    },

    saveToDatabase: async () => {
      const { segments, meetingId, savedSegmentIds, diarizationStatus } = get()

      if (!meetingId) {
        console.warn('[LiveTranscriptStore] Cannot save: no meeting ID')
        return { success: false, count: 0, error: 'No meeting ID' }
      }

      // Filter only final segments that haven't been saved yet
      const unsavedFinalSegments = segments.filter(
        (seg) => seg.is_final && !savedSegmentIds.has(seg.id)
      )

      if (unsavedFinalSegments.length === 0) {
        console.log('[LiveTranscriptStore] No new segments to save')
        return { success: true, count: 0 }
      }

      // Check if diarization is available
      const diarizationAvailable = diarizationStatus.available

      // Convert to database format
      const transcriptsToSave = unsavedFinalSegments.map((seg) => ({
        id: seg.id,
        meeting_id: meetingId,
        speaker_id: seg.speaker_id || null,
        content: seg.content,
        start_time_ms: seg.start_time_ms,
        end_time_ms: seg.end_time_ms,
        confidence: seg.confidence,
        is_final: seg.is_final,
      }))

      try {
        // Use the batch create API for efficiency
        const api = window.electronAPI as any
        if (api?.db?.transcripts?.createBatch) {
          // Pass requireSpeaker: false if diarization is not available
          // This allows saving transcripts without speaker_id when diarization failed
          await api.db.transcripts.createBatch(transcriptsToSave, { requireSpeaker: diarizationAvailable })
        } else {
          // Fallback to individual creates if batch not available
          for (const transcript of transcriptsToSave) {
            await api.db.transcripts.create(transcript, { requireSpeaker: diarizationAvailable })
          }
        }

        // Mark segments as saved
        const newSavedIds = new Set(savedSegmentIds)
        for (const seg of unsavedFinalSegments) {
          newSavedIds.add(seg.id)
        }
        set({ savedSegmentIds: newSavedIds })

        if (!diarizationAvailable) {
          console.log(`[LiveTranscriptStore] Saved ${transcriptsToSave.length} transcript segments WITHOUT speaker identification (diarization unavailable)`)
        } else {
          console.log(`[LiveTranscriptStore] Saved ${transcriptsToSave.length} transcript segments to database`)
        }
        return { success: true, count: transcriptsToSave.length }
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error'
        console.error('[LiveTranscriptStore] Error saving transcripts:', errorMessage)
        return { success: false, count: 0, error: errorMessage }
      }
    },
  })
)

// Selector hooks for performance optimization
export const useLiveTranscriptStatus = () =>
  useLiveTranscriptStore((state) => state.status)

export const useLiveTranscriptSegments = () =>
  useLiveTranscriptStore((state) => state.segments)

export const useLiveTranscriptError = () =>
  useLiveTranscriptStore((state) => state.error)

export const useIsLiveTranscriptActive = () =>
  useLiveTranscriptStore((state) =>
    state.status === 'active' || state.status === 'starting' || state.status === 'paused'
  )

// Diarization status selector
export const useDiarizationStatus = () =>
  useLiveTranscriptStore((state) => state.diarizationStatus)

// Check if speaker diarization is available
export const useIsDiarizationAvailable = () =>
  useLiveTranscriptStore((state) => state.diarizationStatus.available)

// === Streaming Diarization Selectors ===

// Streaming diarization state selector
export const useStreamingDiarizationState = () =>
  useLiveTranscriptStore((state) => state.streamingDiarization)

// Streaming diarization status
export const useStreamingDiarizationStatus = () =>
  useLiveTranscriptStore((state) => state.streamingDiarization.status)

// Speaker segments from streaming diarization
export const useSpeakerSegments = () =>
  useLiveTranscriptStore((state) => state.speakerSegments)

// Speaker change events
export const useSpeakerChanges = () =>
  useLiveTranscriptStore((state) => state.speakerChanges)

// Retroactive corrections applied
export const useRetroactiveCorrections = () =>
  useLiveTranscriptStore((state) => state.retroactiveCorrections)

// Number of speakers detected
export const useNumSpeakersDetected = () =>
  useLiveTranscriptStore((state) => state.streamingDiarization.numSpeakersDetected)

// Cold-start completion status
export const useIsColdStartComplete = () =>
  useLiveTranscriptStore((state) => state.streamingDiarization.coldStartComplete)

// Check if streaming diarization is active
export const useIsStreamingDiarizationActive = () =>
  useLiveTranscriptStore((state) =>
    state.streamingDiarization.status === 'active' ||
    state.streamingDiarization.status === 'ready'
  )

/**
 * Composite hook for all action functions
 * Use this to avoid multiple store subscriptions for different actions
 * Consolidates all setter methods into a single hook
 */
export const useLiveTranscriptActions = () =>
  useLiveTranscriptStore(useShallow((state) => ({
    startSession: state.startSession,
    stopSession: state.stopSession,
    pauseSession: state.pauseSession,
    resumeSession: state.resumeSession,
    addSegment: state.addSegment,
    updateSegment: state.updateSegment,
    addSegments: state.addSegments,
    clearSegments: state.clearSegments,
    setError: state.setError,
    setStatus: state.setStatus,
    setProgress: state.setProgress,
    setEnabled: state.setEnabled,
    setDiarizationStatus: state.setDiarizationStatus,
    setStreamingDiarizationState: state.setStreamingDiarizationState,
    addSpeakerSegment: state.addSpeakerSegment,
    updateSpeakerSegment: state.updateSpeakerSegment,
    addSpeakerChange: state.addSpeakerChange,
    applyRetroactiveCorrection: state.applyRetroactiveCorrection,
    clearStreamingDiarization: state.clearStreamingDiarization,
    getSpeakerForTimeRange: state.getSpeakerForTimeRange,
    reset: state.reset,
    getTranscriptsForSave: state.getTranscriptsForSave,
    saveToDatabase: state.saveToDatabase,
  })))
