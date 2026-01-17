/**
 * useConfidenceScoring Hook
 * React hook for managing confidence scoring operations in the UI.
 * Provides state management and API integration for confidence features.
 */

import { useState, useCallback, useEffect, useMemo } from 'react'
import type {
  ConfidenceLevel
} from '../components/transcript/ConfidenceIndicator'

// ============================================================================
// Types
// ============================================================================

export interface ConfidenceMetrics {
  id: string
  meeting_id: string
  overall_score: number
  high_confidence_count: number
  medium_confidence_count: number
  low_confidence_count: number
  total_segments: number
  average_word_confidence: number
  min_confidence: number
  max_confidence: number
  needs_review_count: number
  auto_corrected_count: number
  manual_adjustment_count: number
  created_at: string
  updated_at: string
}

export interface MeetingConfidenceSummary {
  meetingId: string
  overallScore: number
  overallLevel: ConfidenceLevel
  highConfidencePercent: number
  mediumConfidencePercent: number
  lowConfidencePercent: number
  totalSegments: number
  needsReviewCount: number
  qualityDescription: string
  trend: 'improving' | 'stable' | 'degrading' | 'unknown'
}

export interface ConfidenceAdjustment {
  id: string
  transcript_id: string
  meeting_id: string
  original_confidence: number
  adjusted_confidence: number
  reason: string | null
  created_at: string
}

export interface ConfidenceTrend {
  id: string
  meeting_id: string
  timestamp_ms: number
  window_confidence: number
  segment_count: number
  is_alert_triggered: boolean
  alert_type: string | null
  created_at: string
}

export interface ConfidenceAlert {
  type: 'low_confidence' | 'degrading_quality' | 'audio_issue'
  message: string
  severity: 'warning' | 'error'
  timestampMs: number
  windowConfidence: number
  suggestedAction: string
}

export interface UseConfidenceScoringOptions {
  /** Meeting ID to manage confidence for */
  meetingId: string
  /** Whether to auto-fetch on mount */
  autoFetch?: boolean
  /** Refresh interval in milliseconds (0 to disable) */
  refreshInterval?: number
}

export interface UseConfidenceScoringResult {
  // State
  summary: MeetingConfidenceSummary | null
  metrics: ConfidenceMetrics | null
  trends: ConfidenceTrend[]
  adjustments: ConfidenceAdjustment[]
  adjustedIds: Set<string>
  isLoading: boolean
  error: string | null

  // Actions
  refresh: () => Promise<void>
  calculateMetrics: () => Promise<void>
  adjustConfidence: (transcriptId: string, newConfidence: number, reason?: string) => Promise<ConfidenceAdjustment | null>
  getAdjustmentHistory: (transcriptId: string) => Promise<ConfidenceAdjustment[]>
  triggerBatchCorrection: () => Promise<{ triggered: number; skipped: number; errors: string[] }>
  resetAlerts: () => Promise<void>
}

export interface UseManualAdjustmentOptions {
  /** Meeting ID (reserved for future use) */
  meetingId?: string
  /** Callback when adjustment is saved */
  onAdjustmentSaved?: (adjustment: ConfidenceAdjustment) => void
  /** Callback when adjustment fails */
  onAdjustmentError?: (error: string) => void
}

export interface UseManualAdjustmentResult {
  // State
  isAdjusting: boolean
  currentTranscriptId: string | null
  currentConfidence: number | null
  adjustmentHistory: ConfidenceAdjustment[]

  // Actions
  openAdjustment: (transcriptId: string, currentConfidence: number) => void
  closeAdjustment: () => void
  submitAdjustment: (newConfidence: number, reason?: string) => Promise<boolean>
  loadHistory: (transcriptId: string) => Promise<void>
}

// ============================================================================
// useConfidenceScoring Hook
// ============================================================================

export function useConfidenceScoring({
  meetingId,
  autoFetch = true,
  refreshInterval = 0
}: UseConfidenceScoringOptions): UseConfidenceScoringResult {
  const [summary, setSummary] = useState<MeetingConfidenceSummary | null>(null)
  const [metrics, setMetrics] = useState<ConfidenceMetrics | null>(null)
  const [trends, setTrends] = useState<ConfidenceTrend[]>([])
  const [adjustments, setAdjustments] = useState<ConfidenceAdjustment[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Compute adjusted IDs set for quick lookup
  const adjustedIds = useMemo(() => {
    return new Set(adjustments.map(a => a.transcript_id))
  }, [adjustments])

  // Fetch all confidence data
  const refresh = useCallback(async () => {
    if (!meetingId) return

    try {
      setIsLoading(true)
      setError(null)

      const [summaryResult, metricsResult, trendsResult, adjustmentsResult] = await Promise.all([
        window.electronAPI?.confidenceScoring?.getMeetingConfidenceSummary(meetingId),
        window.electronAPI?.confidenceScoring?.getMetrics(meetingId),
        window.electronAPI?.confidenceScoring?.getTrends(meetingId),
        window.electronAPI?.confidenceScoring?.getMeetingAdjustments(meetingId)
      ])

      if (summaryResult) setSummary(summaryResult)
      if (metricsResult) setMetrics(metricsResult)
      if (trendsResult) setTrends(trendsResult)
      if (adjustmentsResult) setAdjustments(adjustmentsResult)
    } catch (err) {
      console.error('Error fetching confidence data:', err)
      setError(err instanceof Error ? err.message : 'Failed to fetch confidence data')
    } finally {
      setIsLoading(false)
    }
  }, [meetingId])

  // Calculate/recalculate metrics
  const calculateMetrics = useCallback(async () => {
    if (!meetingId) return

    try {
      setIsLoading(true)
      setError(null)

      const result = await window.electronAPI?.confidenceScoring?.calculateMeetingMetrics(meetingId)

      if (result) {
        setMetrics(result)
        // Also refresh summary
        const summaryResult = await window.electronAPI?.confidenceScoring?.getMeetingConfidenceSummary(meetingId)
        if (summaryResult) setSummary(summaryResult)
      }
    } catch (err) {
      console.error('Error calculating metrics:', err)
      setError(err instanceof Error ? err.message : 'Failed to calculate metrics')
    } finally {
      setIsLoading(false)
    }
  }, [meetingId])

  // Adjust confidence for a transcript
  const adjustConfidence = useCallback(async (
    transcriptId: string,
    newConfidence: number,
    reason?: string
  ): Promise<ConfidenceAdjustment | null> => {
    try {
      const result = await window.electronAPI?.confidenceScoring?.adjustConfidence(
        transcriptId,
        newConfidence,
        reason
      )

      if (result) {
        // Update local adjustments list
        setAdjustments(prev => [...prev, result])
        return result
      }

      return null
    } catch (err) {
      console.error('Error adjusting confidence:', err)
      setError(err instanceof Error ? err.message : 'Failed to adjust confidence')
      return null
    }
  }, [])

  // Get adjustment history for a transcript
  const getAdjustmentHistory = useCallback(async (transcriptId: string): Promise<ConfidenceAdjustment[]> => {
    try {
      const result = await window.electronAPI?.confidenceScoring?.getAdjustmentHistory(transcriptId)
      return result || []
    } catch (err) {
      console.error('Error fetching adjustment history:', err)
      return []
    }
  }, [])

  // Trigger batch auto-correction
  const triggerBatchCorrection = useCallback(async () => {
    if (!meetingId) {
      return { triggered: 0, skipped: 0, errors: ['No meeting ID'] }
    }

    try {
      const result = await window.electronAPI?.confidenceScoring?.triggerBatchAutoCorrection(meetingId)

      if (result) {
        // Refresh data after correction
        await refresh()
        return result
      }

      return { triggered: 0, skipped: 0, errors: [] }
    } catch (err) {
      console.error('Error triggering batch correction:', err)
      return { triggered: 0, skipped: 0, errors: [err instanceof Error ? err.message : 'Unknown error'] }
    }
  }, [meetingId, refresh])

  // Reset alert state
  const resetAlerts = useCallback(async () => {
    if (!meetingId) return

    try {
      await window.electronAPI?.confidenceScoring?.resetAlertState(meetingId)
    } catch (err) {
      console.error('Error resetting alerts:', err)
    }
  }, [meetingId])

  // Auto-fetch on mount
  useEffect(() => {
    if (autoFetch && meetingId) {
      refresh()
    }
  }, [autoFetch, meetingId, refresh])

  // Refresh interval
  useEffect(() => {
    if (refreshInterval > 0 && meetingId) {
      const interval = setInterval(refresh, refreshInterval)
      return () => clearInterval(interval)
    }
  }, [refreshInterval, meetingId, refresh])

  return {
    summary,
    metrics,
    trends,
    adjustments,
    adjustedIds,
    isLoading,
    error,
    refresh,
    calculateMetrics,
    adjustConfidence,
    getAdjustmentHistory,
    triggerBatchCorrection,
    resetAlerts
  }
}

// ============================================================================
// useManualAdjustment Hook
// ============================================================================

export function useManualAdjustment({
  meetingId: _meetingId,
  onAdjustmentSaved,
  onAdjustmentError
}: UseManualAdjustmentOptions): UseManualAdjustmentResult {
  const [isAdjusting, setIsAdjusting] = useState(false)
  const [currentTranscriptId, setCurrentTranscriptId] = useState<string | null>(null)
  const [currentConfidence, setCurrentConfidence] = useState<number | null>(null)
  const [adjustmentHistory, setAdjustmentHistory] = useState<ConfidenceAdjustment[]>([])

  // Open adjustment dialog
  const openAdjustment = useCallback((transcriptId: string, confidence: number) => {
    setCurrentTranscriptId(transcriptId)
    setCurrentConfidence(confidence)
    setIsAdjusting(true)
  }, [])

  // Close adjustment dialog
  const closeAdjustment = useCallback(() => {
    setIsAdjusting(false)
    setCurrentTranscriptId(null)
    setCurrentConfidence(null)
    setAdjustmentHistory([])
  }, [])

  // Submit adjustment
  const submitAdjustment = useCallback(async (
    newConfidence: number,
    reason?: string
  ): Promise<boolean> => {
    if (!currentTranscriptId) {
      onAdjustmentError?.('No transcript selected')
      return false
    }

    try {
      const result = await window.electronAPI?.confidenceScoring?.adjustConfidence(
        currentTranscriptId,
        newConfidence,
        reason
      )

      if (result) {
        onAdjustmentSaved?.(result)
        closeAdjustment()
        return true
      }

      onAdjustmentError?.('Failed to save adjustment')
      return false
    } catch (err) {
      console.error('Error submitting adjustment:', err)
      onAdjustmentError?.(err instanceof Error ? err.message : 'Unknown error')
      return false
    }
  }, [currentTranscriptId, onAdjustmentSaved, onAdjustmentError, closeAdjustment])

  // Load adjustment history
  const loadHistory = useCallback(async (transcriptId: string) => {
    try {
      const result = await window.electronAPI?.confidenceScoring?.getAdjustmentHistory(transcriptId)
      setAdjustmentHistory(result || [])
    } catch (err) {
      console.error('Error loading adjustment history:', err)
      setAdjustmentHistory([])
    }
  }, [])

  // Auto-load history when opening adjustment
  useEffect(() => {
    if (isAdjusting && currentTranscriptId) {
      loadHistory(currentTranscriptId)
    }
  }, [isAdjusting, currentTranscriptId, loadHistory])

  return {
    isAdjusting,
    currentTranscriptId,
    currentConfidence,
    adjustmentHistory,
    openAdjustment,
    closeAdjustment,
    submitAdjustment,
    loadHistory
  }
}

// ============================================================================
// useLiveConfidenceAlerts Hook
// ============================================================================

export interface UseLiveConfidenceAlertsOptions {
  /** Meeting ID being recorded */
  meetingId: string
  /** Whether recording is active */
  isRecording: boolean
  /** Polling interval in milliseconds */
  pollingInterval?: number
  /** Alert threshold */
  alertThreshold?: number
  /** Callback when alert is triggered */
  onAlert?: (alert: ConfidenceAlert) => void
}

export interface UseLiveConfidenceAlertsResult {
  currentConfidence: number | null
  activeAlert: ConfidenceAlert | null
  alertHistory: ConfidenceAlert[]
  dismissAlert: () => void
  clearHistory: () => void
}

export function useLiveConfidenceAlerts({
  meetingId,
  isRecording,
  pollingInterval = 5000,
  alertThreshold: _alertThreshold = 0.5,
  onAlert
}: UseLiveConfidenceAlertsOptions): UseLiveConfidenceAlertsResult {
  const [currentConfidence, setCurrentConfidence] = useState<number | null>(null)
  const [activeAlert, setActiveAlert] = useState<ConfidenceAlert | null>(null)
  const [alertHistory, setAlertHistory] = useState<ConfidenceAlert[]>([])

  // Poll for confidence updates
  useEffect(() => {
    if (!isRecording || !meetingId) {
      setActiveAlert(null)
      return
    }

    const poll = async () => {
      try {
        const trends = await window.electronAPI?.confidenceScoring?.getTrends(meetingId)

        if (trends && trends.length > 0) {
          const latest = trends[trends.length - 1]
          setCurrentConfidence(latest.window_confidence)

          if (latest.is_alert_triggered && latest.alert_type) {
            const alert: ConfidenceAlert = {
              type: latest.alert_type as ConfidenceAlert['type'],
              message: `Transcription confidence dropped to ${Math.round(latest.window_confidence * 100)}%`,
              severity: latest.window_confidence < 0.3 ? 'error' : 'warning',
              timestampMs: latest.timestamp_ms,
              windowConfidence: latest.window_confidence,
              suggestedAction: latest.alert_type === 'audio_issue' ? 'Check audio' : 'Review transcript'
            }

            setActiveAlert(alert)
            setAlertHistory(prev => [...prev, alert])
            onAlert?.(alert)
          }
        }
      } catch (err) {
        console.error('Error polling confidence:', err)
      }
    }

    poll()
    const interval = setInterval(poll, pollingInterval)

    return () => clearInterval(interval)
  }, [isRecording, meetingId, pollingInterval, onAlert])

  const dismissAlert = useCallback(() => {
    setActiveAlert(null)
  }, [])

  const clearHistory = useCallback(() => {
    setAlertHistory([])
  }, [])

  return {
    currentConfidence,
    activeAlert,
    alertHistory,
    dismissAlert,
    clearHistory
  }
}

// ============================================================================
// Export all hooks
// ============================================================================

export default useConfidenceScoring
