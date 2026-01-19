/**
 * Realtime Insights Store
 *
 * Centralized state management for the real-time insights panel that aggregates
 * and displays live-generated meeting intelligence during active recording.
 *
 * This store consolidates outputs from:
 * 1. Real-time speaker identification - active speaker, speaker timeline, turn-taking
 * 2. Live meeting notes - action items, decisions, key points as they're extracted
 * 3. Transcript metrics - confidence indicators, low confidence segments
 * 4. Meeting metrics - elapsed time, word count, participation balance, topic transitions
 */

import { create } from 'zustand'
import { useShallow } from 'zustand/react/shallow'

// ============================================================================
// Types
// ============================================================================

export type InsightsPanelSection =
  | 'speaker-identification'
  | 'live-notes'
  | 'transcript-quality'
  | 'meeting-metrics'

export interface SpeakerParticipation {
  speakerId: string
  speakerName: string
  wordCount: number
  segmentCount: number
  totalDurationMs: number
  percentageOfTotal: number
  colorIndex: number
}

export interface LowConfidenceSegment {
  segmentId: string
  content: string
  confidence: number
  startTimeMs: number
  endTimeMs: number
  speaker?: string | null
}

export interface TopicTransition {
  id: string
  fromTopic: string | null
  toTopic: string
  timestamp: number
  confidence?: number
}

export interface InsightsMetrics {
  // Time metrics
  elapsedTimeMs: number
  recordingStartTime: number | null

  // Word and segment metrics
  totalWordCount: number
  totalSegmentCount: number

  // Speaker metrics
  uniqueSpeakersCount: number
  activeSpeaker: string | null
  speakerParticipation: SpeakerParticipation[]
  speakerTurnCount: number
  averageTurnDurationMs: number

  // Quality metrics
  averageConfidence: number
  lowConfidenceSegments: LowConfidenceSegment[]
  lowConfidenceThreshold: number

  // Topic metrics
  currentTopic: string | null
  topicTransitions: TopicTransition[]

  // Notes metrics (counts from live notes store)
  actionItemCount: number
  decisionCount: number
  keyPointCount: number
  topicCount: number
}

export interface InsightsPanelState {
  // Core state
  isEnabled: boolean
  isVisible: boolean
  meetingId: string | null

  // Section visibility (collapsible)
  expandedSections: Set<InsightsPanelSection>

  // Processing state
  isProcessing: boolean
  lastUpdateTime: number | null

  // Aggregated metrics
  metrics: InsightsMetrics

  // Export state
  isExporting: boolean
  lastExportTime: number | null
}

interface InsightsPanelActions {
  // Panel lifecycle
  initializePanel: (meetingId: string) => void
  closePanel: () => void
  setVisible: (visible: boolean) => void
  setEnabled: (enabled: boolean) => void

  // Section management
  toggleSection: (section: InsightsPanelSection) => void
  expandSection: (section: InsightsPanelSection) => void
  collapseSection: (section: InsightsPanelSection) => void
  expandAllSections: () => void
  collapseAllSections: () => void

  // Metrics updates
  updateMetrics: (updates: Partial<InsightsMetrics>) => void
  updateElapsedTime: (elapsedMs: number) => void
  updateActiveSpeaker: (speaker: string | null) => void
  updateSpeakerParticipation: (participation: SpeakerParticipation[]) => void
  addLowConfidenceSegment: (segment: LowConfidenceSegment) => void
  updateNoteCounts: (counts: { actionItems: number; decisions: number; keyPoints: number; topics: number }) => void
  addTopicTransition: (transition: TopicTransition) => void

  // Processing state
  setProcessing: (processing: boolean) => void

  // Export functionality
  startExport: () => void
  completeExport: () => void
  getExportSnapshot: () => InsightsSnapshot

  // Reset
  reset: () => void
}

// Snapshot type for export
export interface InsightsSnapshot {
  timestamp: number
  meetingId: string | null
  metrics: InsightsMetrics
  exportedAt: string
}

// ============================================================================
// Initial State
// ============================================================================

const ALL_SECTIONS: InsightsPanelSection[] = [
  'speaker-identification',
  'live-notes',
  'transcript-quality',
  'meeting-metrics',
]

const initialMetrics: InsightsMetrics = {
  elapsedTimeMs: 0,
  recordingStartTime: null,
  totalWordCount: 0,
  totalSegmentCount: 0,
  uniqueSpeakersCount: 0,
  activeSpeaker: null,
  speakerParticipation: [],
  speakerTurnCount: 0,
  averageTurnDurationMs: 0,
  averageConfidence: 1.0,
  lowConfidenceSegments: [],
  lowConfidenceThreshold: 0.7,
  currentTopic: null,
  topicTransitions: [],
  actionItemCount: 0,
  decisionCount: 0,
  keyPointCount: 0,
  topicCount: 0,
}

const initialState: InsightsPanelState = {
  isEnabled: true,
  isVisible: false,
  meetingId: null,
  expandedSections: new Set<InsightsPanelSection>(['speaker-identification', 'meeting-metrics']),
  isProcessing: false,
  lastUpdateTime: null,
  metrics: initialMetrics,
  isExporting: false,
  lastExportTime: null,
}

// ============================================================================
// Store Implementation
// ============================================================================

export const useRealtimeInsightsStore = create<InsightsPanelState & InsightsPanelActions>()(
  (set, get) => ({
    ...initialState,

    // Panel lifecycle
    initializePanel: (meetingId: string) => {
      set({
        meetingId,
        isVisible: true,
        isProcessing: false,
        lastUpdateTime: Date.now(),
        metrics: {
          ...initialMetrics,
          recordingStartTime: Date.now(),
        },
        expandedSections: new Set<InsightsPanelSection>(['speaker-identification', 'meeting-metrics']),
      })
    },

    closePanel: () => {
      set({
        isVisible: false,
        isProcessing: false,
      })
    },

    setVisible: (visible: boolean) => {
      set({ isVisible: visible })
    },

    setEnabled: (enabled: boolean) => {
      set({ isEnabled: enabled })
    },

    // Section management
    toggleSection: (section: InsightsPanelSection) => {
      set((state) => {
        const newSections = new Set(state.expandedSections)
        if (newSections.has(section)) {
          newSections.delete(section)
        } else {
          newSections.add(section)
        }
        return { expandedSections: newSections }
      })
    },

    expandSection: (section: InsightsPanelSection) => {
      set((state) => {
        const newSections = new Set(state.expandedSections)
        newSections.add(section)
        return { expandedSections: newSections }
      })
    },

    collapseSection: (section: InsightsPanelSection) => {
      set((state) => {
        const newSections = new Set(state.expandedSections)
        newSections.delete(section)
        return { expandedSections: newSections }
      })
    },

    expandAllSections: () => {
      set({ expandedSections: new Set(ALL_SECTIONS) })
    },

    collapseAllSections: () => {
      set({ expandedSections: new Set<InsightsPanelSection>() })
    },

    // Metrics updates
    updateMetrics: (updates: Partial<InsightsMetrics>) => {
      set((state) => ({
        metrics: { ...state.metrics, ...updates },
        lastUpdateTime: Date.now(),
      }))
    },

    updateElapsedTime: (elapsedMs: number) => {
      set((state) => ({
        metrics: { ...state.metrics, elapsedTimeMs: elapsedMs },
      }))
    },

    updateActiveSpeaker: (speaker: string | null) => {
      set((state) => ({
        metrics: { ...state.metrics, activeSpeaker: speaker },
        lastUpdateTime: Date.now(),
      }))
    },

    updateSpeakerParticipation: (participation: SpeakerParticipation[]) => {
      set((state) => ({
        metrics: {
          ...state.metrics,
          speakerParticipation: participation,
          uniqueSpeakersCount: participation.length,
        },
        lastUpdateTime: Date.now(),
      }))
    },

    addLowConfidenceSegment: (segment: LowConfidenceSegment) => {
      set((state) => {
        // Avoid duplicates
        const existing = state.metrics.lowConfidenceSegments.find(
          (s) => s.segmentId === segment.segmentId
        )
        if (existing) return state

        return {
          metrics: {
            ...state.metrics,
            lowConfidenceSegments: [...state.metrics.lowConfidenceSegments, segment],
          },
          lastUpdateTime: Date.now(),
        }
      })
    },

    updateNoteCounts: (counts) => {
      set((state) => ({
        metrics: {
          ...state.metrics,
          actionItemCount: counts.actionItems,
          decisionCount: counts.decisions,
          keyPointCount: counts.keyPoints,
          topicCount: counts.topics,
        },
        lastUpdateTime: Date.now(),
      }))
    },

    addTopicTransition: (transition: TopicTransition) => {
      set((state) => ({
        metrics: {
          ...state.metrics,
          currentTopic: transition.toTopic,
          topicTransitions: [...state.metrics.topicTransitions, transition],
        },
        lastUpdateTime: Date.now(),
      }))
    },

    // Processing state
    setProcessing: (processing: boolean) => {
      set({ isProcessing: processing })
    },

    // Export functionality
    startExport: () => {
      set({ isExporting: true })
    },

    completeExport: () => {
      set({
        isExporting: false,
        lastExportTime: Date.now(),
      })
    },

    getExportSnapshot: () => {
      const state = get()
      return {
        timestamp: Date.now(),
        meetingId: state.meetingId,
        metrics: { ...state.metrics },
        exportedAt: new Date().toISOString(),
      }
    },

    // Reset
    reset: () => {
      set({
        ...initialState,
        expandedSections: new Set<InsightsPanelSection>(['speaker-identification', 'meeting-metrics']),
      })
    },
  })
)

// ============================================================================
// Selector Hooks for Performance Optimization
// ============================================================================

export const useInsightsPanelVisible = () =>
  useRealtimeInsightsStore((state) => state.isVisible)

export const useInsightsPanelEnabled = () =>
  useRealtimeInsightsStore((state) => state.isEnabled)

export const useInsightsMetrics = () =>
  useRealtimeInsightsStore(
    useShallow((state) => ({
      elapsedTimeMs: state.metrics.elapsedTimeMs,
      recordingStartTime: state.metrics.recordingStartTime,
      totalWordCount: state.metrics.totalWordCount,
      totalSegmentCount: state.metrics.totalSegmentCount,
      uniqueSpeakersCount: state.metrics.uniqueSpeakersCount,
      activeSpeaker: state.metrics.activeSpeaker,
      speakerTurnCount: state.metrics.speakerTurnCount,
      averageTurnDurationMs: state.metrics.averageTurnDurationMs,
      averageConfidence: state.metrics.averageConfidence,
      lowConfidenceThreshold: state.metrics.lowConfidenceThreshold,
      currentTopic: state.metrics.currentTopic,
      actionItemCount: state.metrics.actionItemCount,
      decisionCount: state.metrics.decisionCount,
      keyPointCount: state.metrics.keyPointCount,
      topicCount: state.metrics.topicCount,
    }))
  )

export const useInsightsExpandedSections = () =>
  useRealtimeInsightsStore((state) => state.expandedSections)

export const useInsightsProcessing = () =>
  useRealtimeInsightsStore((state) => state.isProcessing)

export const useInsightsActiveSpeaker = () =>
  useRealtimeInsightsStore((state) => state.metrics.activeSpeaker)

export const useInsightsSpeakerParticipation = () =>
  useRealtimeInsightsStore(
    useShallow((state) => state.metrics.speakerParticipation)
  )

export const useInsightsLowConfidenceSegments = () =>
  useRealtimeInsightsStore(
    useShallow((state) => state.metrics.lowConfidenceSegments)
  )

export const useInsightsNoteCounts = () =>
  useRealtimeInsightsStore(
    useShallow((state) => ({
      actionItems: state.metrics.actionItemCount,
      decisions: state.metrics.decisionCount,
      keyPoints: state.metrics.keyPointCount,
      topics: state.metrics.topicCount,
    }))
  )

export const useInsightsWordCount = () =>
  useRealtimeInsightsStore((state) => state.metrics.totalWordCount)

export const useInsightsElapsedTime = () =>
  useRealtimeInsightsStore((state) => state.metrics.elapsedTimeMs)

export const useInsightsExporting = () =>
  useRealtimeInsightsStore((state) => state.isExporting)

/**
 * Composite hook for all action functions
 * Use this to avoid multiple store subscriptions for different actions
 * Consolidates all setter methods into a single hook
 */
export const useInsightsPanelActions = () =>
  useRealtimeInsightsStore(useShallow((state) => ({
    initializePanel: state.initializePanel,
    closePanel: state.closePanel,
    setVisible: state.setVisible,
    setEnabled: state.setEnabled,
    toggleSection: state.toggleSection,
    expandSection: state.expandSection,
    collapseSection: state.collapseSection,
    expandAllSections: state.expandAllSections,
    collapseAllSections: state.collapseAllSections,
    updateMetrics: state.updateMetrics,
    updateElapsedTime: state.updateElapsedTime,
    updateActiveSpeaker: state.updateActiveSpeaker,
    updateSpeakerParticipation: state.updateSpeakerParticipation,
    addLowConfidenceSegment: state.addLowConfidenceSegment,
    updateNoteCounts: state.updateNoteCounts,
    addTopicTransition: state.addTopicTransition,
    setProcessing: state.setProcessing,
    startExport: state.startExport,
    completeExport: state.completeExport,
    getExportSnapshot: state.getExportSnapshot,
    reset: state.reset,
  })))
