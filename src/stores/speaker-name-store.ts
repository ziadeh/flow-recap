/**
 * Speaker Name Store
 *
 * Manages real-time speaker name identification and display state during live recordings.
 * Tracks speaker names, confidence levels, and handles dynamic updates with throttling.
 */

import { create } from 'zustand'

// ============================================================================
// Types
// ============================================================================

export interface IdentifiedSpeaker {
  /** Speaker ID from diarization (e.g., "Speaker_0") */
  speakerId: string
  /** Display name (either detected name or fallback like "Speaker 1") */
  displayName: string
  /** Whether this is a detected real name vs. generic speaker label */
  isIdentified: boolean
  /** Confidence level for the name identification (0.0 - 1.0) */
  confidence: number
  /** How the name was detected */
  detectionMethod: 'self_introduction' | 'name_reference' | 'temporal_correlation' | 'manual' | 'unknown'
  /** Timestamp when the name was identified */
  identifiedAt: number
  /** Whether this is a pending/tentative identification */
  isPending: boolean
  /** Color index for consistent coloring */
  colorIndex: number
}

export interface SpeakerNameUpdate {
  speakerId: string
  displayName: string
  confidence: number
  detectionMethod: IdentifiedSpeaker['detectionMethod']
  isPending?: boolean
}

interface SpeakerNameState {
  /** Map of speaker IDs to their identified info */
  speakers: Map<string, IdentifiedSpeaker>
  /** Currently speaking speaker ID */
  currentSpeakerId: string | null
  /** Meeting ID for the current session */
  meetingId: string | null
  /** Timestamp of last UI update (for throttling) */
  lastUpdateTime: number
  /** Queue of pending updates (for batching) */
  pendingUpdates: SpeakerNameUpdate[]
  /** Whether updates are throttled */
  isThrottled: boolean
}

interface SpeakerNameActions {
  /** Start a new session for a meeting */
  startSession: (meetingId: string) => void
  /** End the current session */
  endSession: () => void
  /** Register a new speaker (when first detected by diarization) */
  registerSpeaker: (speakerId: string, colorIndex?: number) => void
  /** Update speaker with identified name */
  updateSpeakerName: (update: SpeakerNameUpdate) => void
  /** Batch update multiple speakers */
  batchUpdateSpeakers: (updates: SpeakerNameUpdate[]) => void
  /** Set current speaking speaker */
  setCurrentSpeaker: (speakerId: string | null) => void
  /** Get display name for a speaker (with fallback) */
  getDisplayName: (speakerId: string) => string
  /** Get speaker info by ID */
  getSpeaker: (speakerId: string) => IdentifiedSpeaker | undefined
  /** Get all speakers as array */
  getAllSpeakers: () => IdentifiedSpeaker[]
  /** Clear all data */
  reset: () => void
  /** Process pending updates (called by throttle) */
  processPendingUpdates: () => void
  /** Queue an update for throttled processing */
  queueUpdate: (update: SpeakerNameUpdate) => void
}

// ============================================================================
// Constants
// ============================================================================

/** Minimum time between UI updates in milliseconds */
const UPDATE_THROTTLE_MS = 500 // Max 2 updates per second

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Format a speaker ID for display
 * Converts "Speaker_0" to "Speaker 1" (1-indexed for display)
 */
function formatSpeakerLabel(speakerId: string): string {
  const match = speakerId.match(/speaker[_](\d+)/i)
  if (match) {
    return `Speaker ${parseInt(match[1], 10) + 1}`
  }
  return speakerId
}

/**
 * Parse speaker index from ID
 */
function parseSpeakerIndex(speakerId: string): number {
  const match = speakerId.match(/speaker[_](\d+)/i)
  if (match) {
    return parseInt(match[1], 10)
  }
  return 0
}

// ============================================================================
// Store
// ============================================================================

const initialState: SpeakerNameState = {
  speakers: new Map(),
  currentSpeakerId: null,
  meetingId: null,
  lastUpdateTime: 0,
  pendingUpdates: [],
  isThrottled: false,
}

export const useSpeakerNameStore = create<SpeakerNameState & SpeakerNameActions>()(
  (set, get) => ({
    ...initialState,

    startSession: (meetingId: string) => {
      set({
        meetingId,
        speakers: new Map(),
        currentSpeakerId: null,
        lastUpdateTime: 0,
        pendingUpdates: [],
        isThrottled: false,
      })
    },

    endSession: () => {
      set({
        meetingId: null,
        currentSpeakerId: null,
        pendingUpdates: [],
        isThrottled: false,
      })
    },

    registerSpeaker: (speakerId: string, colorIndex?: number) => {
      const { speakers } = get()

      if (speakers.has(speakerId)) {
        return // Already registered
      }

      const newSpeakers = new Map(speakers)
      const speakerIndex = colorIndex ?? parseSpeakerIndex(speakerId)

      newSpeakers.set(speakerId, {
        speakerId,
        displayName: formatSpeakerLabel(speakerId),
        isIdentified: false,
        confidence: 0,
        detectionMethod: 'unknown',
        identifiedAt: Date.now(),
        isPending: false,
        colorIndex: speakerIndex,
      })

      set({ speakers: newSpeakers })
    },

    updateSpeakerName: (update: SpeakerNameUpdate) => {
      const { speakers, lastUpdateTime } = get()
      const now = Date.now()

      // Check if we should throttle
      if (now - lastUpdateTime < UPDATE_THROTTLE_MS) {
        // Queue the update for later
        get().queueUpdate(update)
        return
      }

      const newSpeakers = new Map(speakers)
      const existing = newSpeakers.get(update.speakerId)
      const colorIndex = existing?.colorIndex ?? parseSpeakerIndex(update.speakerId)

      newSpeakers.set(update.speakerId, {
        speakerId: update.speakerId,
        displayName: update.displayName,
        isIdentified: true,
        confidence: update.confidence,
        detectionMethod: update.detectionMethod,
        identifiedAt: now,
        isPending: update.isPending ?? false,
        colorIndex,
      })

      set({
        speakers: newSpeakers,
        lastUpdateTime: now,
      })
    },

    batchUpdateSpeakers: (updates: SpeakerNameUpdate[]) => {
      const { speakers } = get()
      const now = Date.now()
      const newSpeakers = new Map(speakers)

      for (const update of updates) {
        const existing = newSpeakers.get(update.speakerId)
        const colorIndex = existing?.colorIndex ?? parseSpeakerIndex(update.speakerId)

        newSpeakers.set(update.speakerId, {
          speakerId: update.speakerId,
          displayName: update.displayName,
          isIdentified: true,
          confidence: update.confidence,
          detectionMethod: update.detectionMethod,
          identifiedAt: now,
          isPending: update.isPending ?? false,
          colorIndex,
        })
      }

      set({
        speakers: newSpeakers,
        lastUpdateTime: now,
        pendingUpdates: [],
      })
    },

    setCurrentSpeaker: (speakerId: string | null) => {
      const { currentSpeakerId, speakers } = get()

      // Only update if changed
      if (currentSpeakerId === speakerId) {
        return
      }

      // Register speaker if new
      if (speakerId && !speakers.has(speakerId)) {
        get().registerSpeaker(speakerId)
      }

      set({ currentSpeakerId: speakerId })
    },

    getDisplayName: (speakerId: string): string => {
      const speaker = get().speakers.get(speakerId)
      if (speaker) {
        return speaker.displayName
      }
      return formatSpeakerLabel(speakerId)
    },

    getSpeaker: (speakerId: string): IdentifiedSpeaker | undefined => {
      return get().speakers.get(speakerId)
    },

    getAllSpeakers: (): IdentifiedSpeaker[] => {
      return Array.from(get().speakers.values())
    },

    reset: () => {
      set(initialState)
    },

    queueUpdate: (update: SpeakerNameUpdate) => {
      const { pendingUpdates, isThrottled } = get()

      // Add to queue
      const newPendingUpdates = [...pendingUpdates, update]
      set({ pendingUpdates: newPendingUpdates })

      // Start throttle timer if not already running
      if (!isThrottled) {
        set({ isThrottled: true })
        setTimeout(() => {
          get().processPendingUpdates()
          set({ isThrottled: false })
        }, UPDATE_THROTTLE_MS)
      }
    },

    processPendingUpdates: () => {
      const { pendingUpdates } = get()

      if (pendingUpdates.length === 0) {
        return
      }

      // Deduplicate updates, keeping the latest for each speaker
      const latestUpdates = new Map<string, SpeakerNameUpdate>()
      for (const update of pendingUpdates) {
        latestUpdates.set(update.speakerId, update)
      }

      // Apply all updates
      get().batchUpdateSpeakers(Array.from(latestUpdates.values()))
    },
  })
)

// ============================================================================
// Selector Hooks
// ============================================================================

export const useCurrentSpeakerId = () =>
  useSpeakerNameStore((state) => state.currentSpeakerId)

export const useCurrentSpeaker = () =>
  useSpeakerNameStore((state) => {
    const id = state.currentSpeakerId
    return id ? state.speakers.get(id) : undefined
  })

export const useSpeakerCount = () =>
  useSpeakerNameStore((state) => state.speakers.size)

export const useAllSpeakers = () =>
  useSpeakerNameStore((state) => Array.from(state.speakers.values()))

export const useSpeakerById = (speakerId: string | null) =>
  useSpeakerNameStore((state) => speakerId ? state.speakers.get(speakerId) : undefined)

export const useIdentifiedSpeakersCount = () =>
  useSpeakerNameStore((state) =>
    Array.from(state.speakers.values()).filter(s => s.isIdentified).length
  )

/**
 * Hook to get speaker display name with confidence indicator
 * Returns { name, showConfidence, confidence, isIdentified }
 */
export const useSpeakerDisplayInfo = (speakerId: string | null) =>
  useSpeakerNameStore((state) => {
    if (!speakerId) {
      return {
        name: 'Unknown Speaker',
        showConfidence: false,
        confidence: 0,
        isIdentified: false,
        isPending: false,
      }
    }

    const speaker = state.speakers.get(speakerId)
    if (!speaker) {
      // Not yet registered, format the ID
      return {
        name: formatSpeakerLabel(speakerId),
        showConfidence: false,
        confidence: 0,
        isIdentified: false,
        isPending: false,
      }
    }

    return {
      name: speaker.displayName,
      showConfidence: speaker.isIdentified && speaker.confidence < 0.8,
      confidence: speaker.confidence,
      isIdentified: speaker.isIdentified,
      isPending: speaker.isPending,
    }
  })
