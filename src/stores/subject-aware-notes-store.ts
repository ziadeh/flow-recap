/**
 * Subject-Aware Notes Store
 *
 * Manages state for subject-aware meeting notes generation during active recordings.
 * Implements a two-pass system: live processing during recording and finalization
 * when recording stops.
 *
 * Features:
 * - Subject detection and tracking
 * - Relevance scoring
 * - Note candidate management
 * - Strictness mode configuration
 */

import { create } from 'zustand'

// ============================================================================
// Types
// ============================================================================

export type StrictnessMode = 'strict' | 'balanced' | 'loose'
export type RelevanceType = 'in_scope_important' | 'in_scope_minor' | 'out_of_scope' | 'unclear'
export type SubjectStatus = 'draft' | 'locked'
export type SessionStatus = 'idle' | 'active' | 'paused' | 'processing' | 'finalizing' | 'completed' | 'error'
export type CandidateNoteType = 'key_point' | 'decision' | 'action_item' | 'task' | 'other_note'

// Meeting subject information
export interface MeetingSubject {
  id: string
  meetingId: string
  title: string | null
  goal: string | null
  scopeKeywords: string[]
  status: SubjectStatus
  strictnessMode: StrictnessMode
  confidenceScore: number
  lockedAt: string | null
  createdAt: string
  updatedAt: string
}

// Subject confidence information
export interface SubjectConfidence {
  score: number
  status: 'unstable' | 'emerging' | 'likely_stable' | 'stable'
  message: string
  detectionCount: number
  lastUpdated: number | null
}

// Subject update with confidence
export interface SubjectUpdate {
  subject: MeetingSubject
  confidence: SubjectConfidence
  timestamp: number
}

// Note candidate (pre-final note)
export interface NoteCandidate {
  id: string
  meetingId: string
  chunkId: string | null
  noteType: CandidateNoteType
  content: string
  speakerId: string | null
  assignee: string | null
  deadline: string | null
  priority: 'high' | 'medium' | 'low' | null
  relevanceType: RelevanceType | null
  relevanceScore: number | null
  isDuplicate: boolean
  isFinal: boolean
  includedInOutput: boolean
  exclusionReason: string | null
  sourceSegmentIds: string[]
  extractedAt: string
  finalizedAt: string | null
}

// Batch processing state
export interface BatchProcessingState {
  isProcessing: boolean
  lastBatchStartTime: number | null
  lastBatchCompleteTime: number | null
  pendingSegmentCount: number
  chunksProcessed: number
}

// Error information
export interface SubjectAwareError {
  code: string
  message: string
  timestamp: number
  recoverable: boolean
}

// Save progress when persisting
export interface SaveProgress {
  total: number
  saved: number
  currentType: 'notes' | 'tasks'
  error?: string
}

// Relevance event for debugging UI (optional display during recording)
export interface RelevanceEvent {
  chunkId: string
  chunkIndex: number
  relevanceType: RelevanceType
  score: number
  reasoning: string | null
  isFinal: boolean
  windowStartMs: number
  windowEndMs: number
  timestamp: number
  meetingId: string | null
}

// Filtering thresholds per strictness mode
export interface FilteringThresholds {
  strictnessMode: StrictnessMode
  includeImportant: boolean
  includeMinor: boolean
  includeUnclear: boolean
  minScoreForMinor: number
  minScoreForUnclear: number
  description: string
}

// Configuration
export interface SubjectAwareConfig {
  minChunkWindowMs: number
  maxChunkWindowMs: number
  batchIntervalMs: number
  minSegmentsPerChunk: number
  maxSegmentsPerChunk: number
  strictnessMode: StrictnessMode
  minScopeKeywords: number
  maxScopeKeywords: number
  maxTokens: number
  temperature: number
  storeDebugData: boolean
}

// ============================================================================
// State Interface
// ============================================================================

interface SubjectAwareNotesState {
  // Status
  status: SessionStatus
  meetingId: string | null

  // Subject detection
  currentSubject: MeetingSubject | null
  subjectHistory: MeetingSubject[]

  // Subject confidence tracking
  subjectConfidence: SubjectConfidence
  subjectUpdateHistory: SubjectUpdate[]

  // Note candidates organized by type
  keyPoints: NoteCandidate[]
  decisions: NoteCandidate[]
  actionItems: NoteCandidate[]
  tasks: NoteCandidate[]
  otherNotes: NoteCandidate[]

  // Batch processing state
  batchState: BatchProcessingState

  // Processed segment IDs
  processedSegmentIds: Set<string>

  // Error state
  error: SubjectAwareError | null

  // Configuration
  config: SubjectAwareConfig

  // Session info
  sessionStartTime: number | null
  lastUpdateTime: number | null

  // Feature flags
  isEnabled: boolean
  llmProvider: string | null

  // Save progress
  saveProgress: SaveProgress | null

  // Relevance events (for debugging UI)
  relevanceEvents: RelevanceEvent[]
  filteringThresholds: FilteringThresholds | null
}

interface SubjectAwareNotesActions {
  // Session management
  startSession: (meetingId: string, config?: Partial<SubjectAwareConfig>) => void
  stopSession: () => void
  pauseSession: () => void
  resumeSession: () => void

  // Subject management
  setSubject: (subject: MeetingSubject) => void
  addSubjectToHistory: (subject: MeetingSubject) => void
  lockSubject: () => void

  // Confidence management
  updateConfidence: (confidence: SubjectConfidence) => void
  getLatestSubjectUpdate: () => SubjectUpdate | null

  // Candidate management
  addCandidate: (candidate: NoteCandidate) => void
  addCandidates: (candidates: NoteCandidate[]) => void
  updateCandidate: (id: string, updates: Partial<NoteCandidate>) => void
  removeCandidate: (id: string) => void
  clearCandidates: () => void
  finalizeCandidate: (id: string) => void

  // State management
  setStatus: (status: SessionStatus) => void
  setError: (error: SubjectAwareError | null) => void
  updateBatchState: (updates: Partial<BatchProcessingState>) => void
  markSegmentsProcessed: (segmentIds: string[]) => void
  updateConfig: (config: Partial<SubjectAwareConfig>) => void
  setEnabled: (enabled: boolean) => void
  setLLMProvider: (provider: string | null) => void
  setSaveProgress: (progress: SaveProgress | null) => void

  // Relevance event management
  addRelevanceEvent: (event: RelevanceEvent) => void
  clearRelevanceEvents: () => void
  setFilteringThresholds: (thresholds: FilteringThresholds | null) => void

  // Getters
  getAllCandidates: () => NoteCandidate[]
  getCandidatesByType: (type: CandidateNoteType) => NoteCandidate[]
  getIncludedCandidates: () => NoteCandidate[]
  isSegmentProcessed: (segmentId: string) => boolean

  // Reset
  reset: () => void
}

// ============================================================================
// Default Configuration
// ============================================================================

const DEFAULT_CONFIG: SubjectAwareConfig = {
  minChunkWindowMs: 20000,
  maxChunkWindowMs: 60000,
  batchIntervalMs: 30000,
  minSegmentsPerChunk: 2,
  maxSegmentsPerChunk: 30,
  strictnessMode: 'strict',
  minScopeKeywords: 5,
  maxScopeKeywords: 15,
  maxTokens: 4096,
  temperature: 0.3,
  storeDebugData: true,
}

// ============================================================================
// Initial State
// ============================================================================

const initialState: SubjectAwareNotesState = {
  status: 'idle',
  meetingId: null,
  currentSubject: null,
  subjectHistory: [],
  subjectConfidence: {
    score: 0,
    status: 'unstable',
    message: 'Subject confidence: 0% - detecting subject...',
    detectionCount: 0,
    lastUpdated: null,
  },
  subjectUpdateHistory: [],
  keyPoints: [],
  decisions: [],
  actionItems: [],
  tasks: [],
  otherNotes: [],
  batchState: {
    isProcessing: false,
    lastBatchStartTime: null,
    lastBatchCompleteTime: null,
    pendingSegmentCount: 0,
    chunksProcessed: 0,
  },
  processedSegmentIds: new Set<string>(),
  error: null,
  config: DEFAULT_CONFIG,
  sessionStartTime: null,
  lastUpdateTime: null,
  isEnabled: true,
  llmProvider: null,
  saveProgress: null,
  relevanceEvents: [],
  filteringThresholds: null,
}

// ============================================================================
// Store Implementation
// ============================================================================

export const useSubjectAwareNotesStore = create<SubjectAwareNotesState & SubjectAwareNotesActions>()(
  (set, get) => ({
    ...initialState,

    // Session management
    startSession: (meetingId: string, config?: Partial<SubjectAwareConfig>) => {
      const currentState = get()

      // If already active for same meeting, just update status
      const isSameMeeting = currentState.meetingId === meetingId
      const isActiveSession = currentState.status === 'active' || currentState.status === 'processing'

      if (isSameMeeting && isActiveSession) {
        set({ status: 'active' })
        return
      }

      // New session
      set({
        status: 'active',
        meetingId,
        currentSubject: null,
        subjectHistory: [],
        keyPoints: [],
        decisions: [],
        actionItems: [],
        tasks: [],
        otherNotes: [],
        processedSegmentIds: new Set<string>(),
        batchState: {
          isProcessing: false,
          lastBatchStartTime: null,
          lastBatchCompleteTime: null,
          pendingSegmentCount: 0,
          chunksProcessed: 0,
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

    // Subject management
    setSubject: (subject: MeetingSubject) => {
      const state = get()
      // Add current subject to history if it exists
      if (state.currentSubject) {
        set({
          currentSubject: subject,
          subjectHistory: [...state.subjectHistory, state.currentSubject],
          lastUpdateTime: Date.now(),
        })
      } else {
        set({
          currentSubject: subject,
          lastUpdateTime: Date.now(),
        })
      }
    },

    addSubjectToHistory: (subject: MeetingSubject) => {
      set((state) => ({
        subjectHistory: [...state.subjectHistory, subject],
      }))
    },

    lockSubject: () => {
      const { currentSubject } = get()
      if (currentSubject) {
        set({
          currentSubject: {
            ...currentSubject,
            status: 'locked',
            lockedAt: new Date().toISOString(),
          },
        })
      }
    },

    // Confidence management
    updateConfidence: (confidence: SubjectConfidence) => {
      const state = get()
      const timestamp = Date.now()

      // Track this update in history
      const update: SubjectUpdate = {
        subject: state.currentSubject!,
        confidence,
        timestamp,
      }

      set({
        subjectConfidence: {
          ...confidence,
          lastUpdated: timestamp,
        },
        subjectUpdateHistory: [...state.subjectUpdateHistory, update],
        lastUpdateTime: timestamp,
      })
    },

    getLatestSubjectUpdate: () => {
      const state = get()
      if (state.subjectUpdateHistory.length === 0) {
        return null
      }
      return state.subjectUpdateHistory[state.subjectUpdateHistory.length - 1]
    },

    // Candidate management
    addCandidate: (candidate: NoteCandidate) => {
      set((state) => {
        // Check for duplicates
        const allCandidates = [
          ...state.keyPoints,
          ...state.decisions,
          ...state.actionItems,
          ...state.tasks,
          ...state.otherNotes,
        ]
        if (allCandidates.some(c => c.id === candidate.id)) {
          return {} // Already exists
        }

        switch (candidate.noteType) {
          case 'key_point':
            return { keyPoints: [...state.keyPoints, candidate], lastUpdateTime: Date.now() }
          case 'decision':
            return { decisions: [...state.decisions, candidate], lastUpdateTime: Date.now() }
          case 'action_item':
            return { actionItems: [...state.actionItems, candidate], lastUpdateTime: Date.now() }
          case 'task':
            return { tasks: [...state.tasks, candidate], lastUpdateTime: Date.now() }
          case 'other_note':
            return { otherNotes: [...state.otherNotes, candidate], lastUpdateTime: Date.now() }
          default:
            return {}
        }
      })
    },

    addCandidates: (candidates: NoteCandidate[]) => {
      set((state) => {
        const newKeyPoints = [...state.keyPoints]
        const newDecisions = [...state.decisions]
        const newActionItems = [...state.actionItems]
        const newTasks = [...state.tasks]
        const newOtherNotes = [...state.otherNotes]

        const existingIds = new Set([
          ...state.keyPoints.map(c => c.id),
          ...state.decisions.map(c => c.id),
          ...state.actionItems.map(c => c.id),
          ...state.tasks.map(c => c.id),
          ...state.otherNotes.map(c => c.id),
        ])

        for (const candidate of candidates) {
          if (existingIds.has(candidate.id)) continue
          existingIds.add(candidate.id)

          switch (candidate.noteType) {
            case 'key_point':
              newKeyPoints.push(candidate)
              break
            case 'decision':
              newDecisions.push(candidate)
              break
            case 'action_item':
              newActionItems.push(candidate)
              break
            case 'task':
              newTasks.push(candidate)
              break
            case 'other_note':
              newOtherNotes.push(candidate)
              break
          }
        }

        return {
          keyPoints: newKeyPoints,
          decisions: newDecisions,
          actionItems: newActionItems,
          tasks: newTasks,
          otherNotes: newOtherNotes,
          lastUpdateTime: Date.now(),
        }
      })
    },

    updateCandidate: (id: string, updates: Partial<NoteCandidate>) => {
      set((state) => ({
        keyPoints: state.keyPoints.map(c => c.id === id ? { ...c, ...updates } : c),
        decisions: state.decisions.map(c => c.id === id ? { ...c, ...updates } : c),
        actionItems: state.actionItems.map(c => c.id === id ? { ...c, ...updates } : c),
        tasks: state.tasks.map(c => c.id === id ? { ...c, ...updates } : c),
        otherNotes: state.otherNotes.map(c => c.id === id ? { ...c, ...updates } : c),
        lastUpdateTime: Date.now(),
      }))
    },

    removeCandidate: (id: string) => {
      set((state) => ({
        keyPoints: state.keyPoints.filter(c => c.id !== id),
        decisions: state.decisions.filter(c => c.id !== id),
        actionItems: state.actionItems.filter(c => c.id !== id),
        tasks: state.tasks.filter(c => c.id !== id),
        otherNotes: state.otherNotes.filter(c => c.id !== id),
        lastUpdateTime: Date.now(),
      }))
    },

    clearCandidates: () => {
      set({
        keyPoints: [],
        decisions: [],
        actionItems: [],
        tasks: [],
        otherNotes: [],
        lastUpdateTime: null,
      })
    },

    finalizeCandidate: (id: string) => {
      get().updateCandidate(id, { isFinal: true, finalizedAt: new Date().toISOString() })
    },

    // State management
    setStatus: (status: SessionStatus) => {
      set({ status })
    },

    setError: (error: SubjectAwareError | null) => {
      set({
        error,
        status: error ? 'error' : get().status,
      })
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

    updateConfig: (config: Partial<SubjectAwareConfig>) => {
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

    // Relevance event management
    addRelevanceEvent: (event: RelevanceEvent) => {
      set((state) => ({
        relevanceEvents: [...state.relevanceEvents, event],
      }))
    },

    clearRelevanceEvents: () => {
      set({ relevanceEvents: [] })
    },

    setFilteringThresholds: (thresholds: FilteringThresholds | null) => {
      set({ filteringThresholds: thresholds })
    },

    // Getters
    getAllCandidates: () => {
      const state = get()
      return [
        ...state.keyPoints,
        ...state.decisions,
        ...state.actionItems,
        ...state.tasks,
        ...state.otherNotes,
      ].sort((a, b) => new Date(a.extractedAt).getTime() - new Date(b.extractedAt).getTime())
    },

    getCandidatesByType: (type: CandidateNoteType) => {
      const state = get()
      switch (type) {
        case 'key_point': return state.keyPoints
        case 'decision': return state.decisions
        case 'action_item': return state.actionItems
        case 'task': return state.tasks
        case 'other_note': return state.otherNotes
        default: return []
      }
    },

    getIncludedCandidates: () => {
      return get().getAllCandidates().filter(c => c.includedInOutput)
    },

    isSegmentProcessed: (segmentId: string) => {
      return get().processedSegmentIds.has(segmentId)
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

export const useSubjectAwareStatus = () =>
  useSubjectAwareNotesStore((state) => state.status)

export const useSubjectAwareMeetingSubject = () =>
  useSubjectAwareNotesStore((state) => state.currentSubject)

export const useSubjectAwareKeyPoints = () =>
  useSubjectAwareNotesStore((state) => state.keyPoints)

export const useSubjectAwareDecisions = () =>
  useSubjectAwareNotesStore((state) => state.decisions)

export const useSubjectAwareActionItems = () =>
  useSubjectAwareNotesStore((state) => state.actionItems)

export const useSubjectAwareTasks = () =>
  useSubjectAwareNotesStore((state) => state.tasks)

export const useSubjectAwareOtherNotes = () =>
  useSubjectAwareNotesStore((state) => state.otherNotes)

export const useSubjectAwareBatchState = () =>
  useSubjectAwareNotesStore((state) => state.batchState)

export const useSubjectAwareError = () =>
  useSubjectAwareNotesStore((state) => state.error)

export const useSubjectAwareConfig = () =>
  useSubjectAwareNotesStore((state) => state.config)

export const useIsSubjectAwareActive = () =>
  useSubjectAwareNotesStore((state) =>
    state.status === 'active' || state.status === 'processing'
  )

export const useSubjectAwareCandidateCount = () =>
  useSubjectAwareNotesStore((state) =>
    state.keyPoints.length +
    state.decisions.length +
    state.actionItems.length +
    state.tasks.length +
    state.otherNotes.length
  )

export const useSubjectAwareLLMProvider = () =>
  useSubjectAwareNotesStore((state) => state.llmProvider)

export const useSubjectAwareSaveProgress = () =>
  useSubjectAwareNotesStore((state) => state.saveProgress)

export const useSubjectAwareStrictnessMode = () =>
  useSubjectAwareNotesStore((state) => state.config.strictnessMode)

export const useSubjectConfidence = () =>
  useSubjectAwareNotesStore((state) => state.subjectConfidence)

export const useSubjectUpdateHistory = () =>
  useSubjectAwareNotesStore((state) => state.subjectUpdateHistory)
