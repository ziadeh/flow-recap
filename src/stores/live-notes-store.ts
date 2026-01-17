/**
 * Live Notes Store
 *
 * Manages state for real-time meeting notes generation during active recordings.
 * As transcription segments are finalized, they are sent to the LLM to extract
 * key discussion points, preliminary action items, emerging decisions, and important topics.
 *
 * Notes are displayed in a dedicated panel during recording and are consolidated
 * when recording stops.
 */

import { create } from 'zustand'

// ============================================================================
// Types
// ============================================================================

// Status of the live notes generation service
export type LiveNotesStatus =
  | 'idle'           // Not generating notes
  | 'starting'       // Initializing the service
  | 'active'         // Actively generating notes
  | 'paused'         // Recording paused, notes generation suspended
  | 'processing'     // Processing a batch of segments
  | 'saving'         // Persisting notes to database when recording stops
  | 'error'          // Error occurred

// Progress information when saving notes to database
export interface SaveProgress {
  /** Total number of items to save */
  total: number
  /** Number of items saved so far */
  saved: number
  /** Current item type being saved */
  currentType: 'notes' | 'tasks'
  /** Error message if save failed */
  error?: string
}

// Types of notes that can be generated
export type LiveNoteType = 'key_point' | 'action_item' | 'decision' | 'topic'

// A single live-generated note item
export interface LiveNoteItem {
  id: string
  type: LiveNoteType
  content: string
  /** Speaker associated with this note (if identifiable) */
  speaker?: string | null
  /** Priority for action items */
  priority?: 'high' | 'medium' | 'low'
  /** Assignee for action items */
  assignee?: string | null
  /** Timestamp when this note was extracted */
  extractedAt: number
  /** Source transcript segment IDs that contributed to this note */
  sourceSegmentIds: string[]
  /** Whether this is a preliminary (live) note vs finalized */
  isPreliminary: boolean
  /** Confidence score from LLM (0.0-1.0) */
  confidence?: number
}

// Batch processing state
export interface BatchProcessingState {
  /** Whether a batch is currently being processed */
  isProcessing: boolean
  /** Timestamp of last batch processing start */
  lastBatchStartTime: number | null
  /** Timestamp of last successful batch completion */
  lastBatchCompleteTime: number | null
  /** Number of segments waiting to be processed */
  pendingSegmentCount: number
  /** Number of batches successfully processed */
  batchesProcessed: number
}

// Error information
export interface LiveNotesError {
  code: string
  message: string
  timestamp: number
  recoverable: boolean
}

// Configuration for live notes generation
export interface LiveNotesConfig {
  /** Interval in ms between batch processing (default: 45000 = 45 seconds) */
  batchIntervalMs: number
  /** Minimum segments required before processing (default: 3) */
  minSegmentsPerBatch: number
  /** Maximum segments per batch (default: 20) */
  maxSegmentsPerBatch: number
  /** Whether to extract key points */
  extractKeyPoints: boolean
  /** Whether to extract action items */
  extractActionItems: boolean
  /** Whether to extract decisions */
  extractDecisions: boolean
  /** Whether to extract topics */
  extractTopics: boolean
}

// Live notes state
interface LiveNotesState {
  // Current status of live notes generation
  status: LiveNotesStatus

  // Meeting ID being processed
  meetingId: string | null

  // Generated notes organized by type
  keyPoints: LiveNoteItem[]
  actionItems: LiveNoteItem[]
  decisions: LiveNoteItem[]
  topics: LiveNoteItem[]

  // Batch processing state
  batchState: BatchProcessingState

  // IDs of transcript segments that have been processed
  processedSegmentIds: Set<string>

  // Current error if any
  error: LiveNotesError | null

  // Configuration
  config: LiveNotesConfig

  // Session start time
  sessionStartTime: number | null

  // Last update timestamp
  lastUpdateTime: number | null

  // Whether live notes generation is enabled
  isEnabled: boolean

  // LLM provider info
  llmProvider: string | null

  // Save progress when persisting to database
  saveProgress: SaveProgress | null
}

interface LiveNotesActions {
  // Start a new live notes session
  startSession: (meetingId: string, config?: Partial<LiveNotesConfig>) => void

  // Stop the live notes session
  stopSession: () => void

  // Pause notes generation
  pauseSession: () => void

  // Resume notes generation
  resumeSession: () => void

  // Add a new note
  addNote: (note: LiveNoteItem) => void

  // Add multiple notes at once (batch update)
  addNotes: (notes: LiveNoteItem[]) => void

  // Update an existing note
  updateNote: (id: string, updates: Partial<LiveNoteItem>) => void

  // Mark a note as finalized (no longer preliminary)
  finalizeNote: (id: string) => void

  // Remove a note
  removeNote: (id: string) => void

  // Clear all notes
  clearNotes: () => void

  // Set error state
  setError: (error: LiveNotesError | null) => void

  // Set status
  setStatus: (status: LiveNotesStatus) => void

  // Update batch processing state
  updateBatchState: (updates: Partial<BatchProcessingState>) => void

  // Mark segments as processed
  markSegmentsProcessed: (segmentIds: string[]) => void

  // Update configuration
  updateConfig: (config: Partial<LiveNotesConfig>) => void

  // Enable/disable live notes
  setEnabled: (enabled: boolean) => void

  // Set LLM provider info
  setLLMProvider: (provider: string | null) => void

  // Set save progress
  setSaveProgress: (progress: SaveProgress | null) => void

  // Get all notes combined
  getAllNotes: () => LiveNoteItem[]

  // Get notes by type
  getNotesByType: (type: LiveNoteType) => LiveNoteItem[]

  // Check if a segment has been processed
  isSegmentProcessed: (segmentId: string) => boolean

  // Get count of unprocessed segments
  getUnprocessedSegmentCount: (segmentIds: string[]) => number

  // Reset entire store
  reset: () => void
}

// ============================================================================
// Default Configuration
// ============================================================================

const DEFAULT_CONFIG: LiveNotesConfig = {
  batchIntervalMs: 45000, // 45 seconds between batches
  minSegmentsPerBatch: 3,
  maxSegmentsPerBatch: 20,
  extractKeyPoints: true,
  extractActionItems: true,
  extractDecisions: true,
  extractTopics: true,
}

// ============================================================================
// Initial State
// ============================================================================

const initialState: LiveNotesState = {
  status: 'idle',
  meetingId: null,
  keyPoints: [],
  actionItems: [],
  decisions: [],
  topics: [],
  batchState: {
    isProcessing: false,
    lastBatchStartTime: null,
    lastBatchCompleteTime: null,
    pendingSegmentCount: 0,
    batchesProcessed: 0,
  },
  processedSegmentIds: new Set<string>(),
  error: null,
  config: DEFAULT_CONFIG,
  sessionStartTime: null,
  lastUpdateTime: null,
  isEnabled: true,
  llmProvider: null,
  saveProgress: null,
}

// ============================================================================
// Store Implementation
// ============================================================================

export const useLiveNotesStore = create<LiveNotesState & LiveNotesActions>()(
  (set, get) => ({
    ...initialState,

    startSession: (meetingId: string, config?: Partial<LiveNotesConfig>) => {
      const currentState = get()

      // If we're already in an active session for the same meeting, don't clear notes
      // This prevents data loss when navigating between pages during recording
      const isSameMeeting = currentState.meetingId === meetingId
      const isActiveSession = currentState.status === 'active' || currentState.status === 'processing' || currentState.status === 'starting'

      if (isSameMeeting && isActiveSession) {
        // Just update the status to ensure we're in the right state
        set({
          status: 'active',
          // Keep existing notes, processed segments, batch state, etc.
        })
        return
      }

      // New session or different meeting - reset everything
      set({
        status: 'starting',
        meetingId,
        keyPoints: [],
        actionItems: [],
        decisions: [],
        topics: [],
        processedSegmentIds: new Set<string>(),
        batchState: {
          isProcessing: false,
          lastBatchStartTime: null,
          lastBatchCompleteTime: null,
          pendingSegmentCount: 0,
          batchesProcessed: 0,
        },
        error: null,
        config: config ? { ...DEFAULT_CONFIG, ...config } : DEFAULT_CONFIG,
        sessionStartTime: Date.now(),
        lastUpdateTime: null,
      })
    },

    stopSession: () => {
      set({
        status: 'idle',
        batchState: {
          ...get().batchState,
          isProcessing: false,
        },
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

    addNote: (note: LiveNoteItem) => {
      set((state) => {
        const noteWithTimestamp = {
          ...note,
          extractedAt: note.extractedAt || Date.now(),
        }

        switch (note.type) {
          case 'key_point':
            // Check for duplicate before adding
            if (state.keyPoints.some(n => n.id === note.id)) {
              return {} // Note already exists, no update
            }
            return {
              keyPoints: [...state.keyPoints, noteWithTimestamp],
              lastUpdateTime: Date.now(),
              status: state.status === 'starting' ? 'active' : state.status,
            }
          case 'action_item':
            if (state.actionItems.some(n => n.id === note.id)) {
              return {}
            }
            return {
              actionItems: [...state.actionItems, noteWithTimestamp],
              lastUpdateTime: Date.now(),
              status: state.status === 'starting' ? 'active' : state.status,
            }
          case 'decision':
            if (state.decisions.some(n => n.id === note.id)) {
              return {}
            }
            return {
              decisions: [...state.decisions, noteWithTimestamp],
              lastUpdateTime: Date.now(),
              status: state.status === 'starting' ? 'active' : state.status,
            }
          case 'topic':
            if (state.topics.some(n => n.id === note.id)) {
              return {}
            }
            return {
              topics: [...state.topics, noteWithTimestamp],
              lastUpdateTime: Date.now(),
              status: state.status === 'starting' ? 'active' : state.status,
            }
          default:
            return {}
        }
      })
    },

    addNotes: (notes: LiveNoteItem[]) => {
      set((state) => {
        const newKeyPoints = [...state.keyPoints]
        const newActionItems = [...state.actionItems]
        const newDecisions = [...state.decisions]
        const newTopics = [...state.topics]

        // Create sets of existing note IDs for deduplication
        const existingKeyPointIds = new Set(state.keyPoints.map(n => n.id))
        const existingActionItemIds = new Set(state.actionItems.map(n => n.id))
        const existingDecisionIds = new Set(state.decisions.map(n => n.id))
        const existingTopicIds = new Set(state.topics.map(n => n.id))

        for (const note of notes) {
          const noteWithTimestamp = {
            ...note,
            extractedAt: note.extractedAt || Date.now(),
          }

          switch (note.type) {
            case 'key_point':
              // Only add if not already present
              if (!existingKeyPointIds.has(note.id)) {
                newKeyPoints.push(noteWithTimestamp)
                existingKeyPointIds.add(note.id)
              }
              break
            case 'action_item':
              if (!existingActionItemIds.has(note.id)) {
                newActionItems.push(noteWithTimestamp)
                existingActionItemIds.add(note.id)
              }
              break
            case 'decision':
              if (!existingDecisionIds.has(note.id)) {
                newDecisions.push(noteWithTimestamp)
                existingDecisionIds.add(note.id)
              }
              break
            case 'topic':
              if (!existingTopicIds.has(note.id)) {
                newTopics.push(noteWithTimestamp)
                existingTopicIds.add(note.id)
              }
              break
          }
        }

        return {
          keyPoints: newKeyPoints,
          actionItems: newActionItems,
          decisions: newDecisions,
          topics: newTopics,
          lastUpdateTime: Date.now(),
          status: state.status === 'starting' ? 'active' : state.status,
        }
      })
    },

    updateNote: (id: string, updates: Partial<LiveNoteItem>) => {
      set((state) => ({
        keyPoints: state.keyPoints.map((n) =>
          n.id === id ? { ...n, ...updates } : n
        ),
        actionItems: state.actionItems.map((n) =>
          n.id === id ? { ...n, ...updates } : n
        ),
        decisions: state.decisions.map((n) =>
          n.id === id ? { ...n, ...updates } : n
        ),
        topics: state.topics.map((n) =>
          n.id === id ? { ...n, ...updates } : n
        ),
        lastUpdateTime: Date.now(),
      }))
    },

    finalizeNote: (id: string) => {
      get().updateNote(id, { isPreliminary: false })
    },

    removeNote: (id: string) => {
      set((state) => ({
        keyPoints: state.keyPoints.filter((n) => n.id !== id),
        actionItems: state.actionItems.filter((n) => n.id !== id),
        decisions: state.decisions.filter((n) => n.id !== id),
        topics: state.topics.filter((n) => n.id !== id),
        lastUpdateTime: Date.now(),
      }))
    },

    clearNotes: () => {
      set({
        keyPoints: [],
        actionItems: [],
        decisions: [],
        topics: [],
        lastUpdateTime: null,
      })
    },

    setError: (error: LiveNotesError | null) => {
      set({
        error,
        status: error ? 'error' : get().status,
      })
    },

    setStatus: (status: LiveNotesStatus) => {
      set({ status })
    },

    updateBatchState: (updates: Partial<BatchProcessingState>) => {
      set((state) => ({
        batchState: { ...state.batchState, ...updates },
      }))
    },

    markSegmentsProcessed: (segmentIds: string[]) => {
      set((state) => {
        const newProcessedIds = new Set(state.processedSegmentIds)
        for (const id of segmentIds) {
          newProcessedIds.add(id)
        }
        return { processedSegmentIds: newProcessedIds }
      })
    },

    updateConfig: (config: Partial<LiveNotesConfig>) => {
      set((state) => ({
        config: { ...state.config, ...config },
      }))
    },

    setEnabled: (enabled: boolean) => {
      set({ isEnabled: enabled })
    },

    setLLMProvider: (provider: string | null) => {
      set({ llmProvider: provider })
    },

    setSaveProgress: (progress: SaveProgress | null) => {
      set({ saveProgress: progress })
    },

    getAllNotes: () => {
      const state = get()
      return [
        ...state.keyPoints,
        ...state.actionItems,
        ...state.decisions,
        ...state.topics,
      ].sort((a, b) => a.extractedAt - b.extractedAt)
    },

    getNotesByType: (type: LiveNoteType) => {
      const state = get()
      switch (type) {
        case 'key_point':
          return state.keyPoints
        case 'action_item':
          return state.actionItems
        case 'decision':
          return state.decisions
        case 'topic':
          return state.topics
        default:
          return []
      }
    },

    isSegmentProcessed: (segmentId: string) => {
      return get().processedSegmentIds.has(segmentId)
    },

    getUnprocessedSegmentCount: (segmentIds: string[]) => {
      const { processedSegmentIds } = get()
      return segmentIds.filter((id) => !processedSegmentIds.has(id)).length
    },

    reset: () => {
      set({
        ...initialState,
        processedSegmentIds: new Set<string>(),
      })
    },
  })
)

// ============================================================================
// Selector Hooks
// ============================================================================

export const useLiveNotesStatus = () =>
  useLiveNotesStore((state) => state.status)

export const useLiveNotesKeyPoints = () =>
  useLiveNotesStore((state) => state.keyPoints)

export const useLiveNotesActionItems = () =>
  useLiveNotesStore((state) => state.actionItems)

export const useLiveNotesDecisions = () =>
  useLiveNotesStore((state) => state.decisions)

export const useLiveNotesTopics = () =>
  useLiveNotesStore((state) => state.topics)

export const useLiveNotesBatchState = () =>
  useLiveNotesStore((state) => state.batchState)

export const useLiveNotesError = () =>
  useLiveNotesStore((state) => state.error)

export const useLiveNotesConfig = () =>
  useLiveNotesStore((state) => state.config)

export const useIsLiveNotesActive = () =>
  useLiveNotesStore((state) =>
    state.status === 'active' || state.status === 'starting' || state.status === 'processing'
  )

export const useLiveNotesCount = () =>
  useLiveNotesStore((state) =>
    state.keyPoints.length +
    state.actionItems.length +
    state.decisions.length +
    state.topics.length
  )

export const useLiveNotesLLMProvider = () =>
  useLiveNotesStore((state) => state.llmProvider)

export const useLiveNotesSaveProgress = () =>
  useLiveNotesStore((state) => state.saveProgress)
