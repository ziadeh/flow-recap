/**
 * useTranscriptCorrection Hook
 *
 * Provides functionality for AI-assisted transcript correction including:
 * - Generating corrections for individual segments
 * - Batch corrections for entire meetings
 * - Accept/reject workflow
 * - Loading and error states
 */

import { useState, useCallback, useEffect } from 'react'
import { useToastStore } from '../stores/toast-store'

// Access the transcript correction API through window.electronAPI
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const getTranscriptCorrectionAPI = () => (window as any).electronAPI?.transcriptCorrection

// ============================================================================
// Types
// ============================================================================

export type CorrectionStatus = 'pending' | 'accepted' | 'rejected'
export type CorrectionTrigger = 'low_confidence' | 'speaker_change' | 'manual' | 'batch'

export interface TextChange {
  original: string
  corrected: string
  changeType: 'word' | 'punctuation' | 'capitalization' | 'grammar' | 'homophone' | 'terminology'
  startIndex: number
  endIndex: number
  confidence: number
}

export interface TranscriptCorrection {
  id: string
  transcript_id: string
  meeting_id: string
  original_content: string
  corrected_content: string
  changes: string  // JSON array of TextChange[]
  trigger: CorrectionTrigger
  status: CorrectionStatus
  llm_provider: string | null
  llm_model: string | null
  confidence_score: number
  processing_time_ms: number
  created_at: string
  updated_at: string
  applied_at: string | null
}

export interface CorrectionResult {
  success: boolean
  error?: string
  correction?: TranscriptCorrection
  changes?: TextChange[]
  metadata?: {
    processingTimeMs: number
    llmProvider: string
    llmModel?: string
    contextUsed: boolean
  }
}

export interface BatchCorrectionResult {
  success: boolean
  totalSegments: number
  corrected: number
  skipped: number
  failed: number
  corrections: TranscriptCorrection[]
  errors: string[]
}

export interface CorrectionStats {
  total: number
  pending: number
  accepted: number
  rejected: number
  avgConfidence: number
}

export interface UseTranscriptCorrectionReturn {
  // State
  isAvailable: boolean
  isCheckingAvailability: boolean
  isGenerating: boolean
  isProcessing: boolean
  currentCorrection: TranscriptCorrection | null
  corrections: TranscriptCorrection[]
  pendingCorrections: TranscriptCorrection[]
  stats: CorrectionStats | null
  error: string | null

  // Actions
  checkAvailability: () => Promise<boolean>
  generateCorrection: (transcriptId: string, trigger?: CorrectionTrigger) => Promise<CorrectionResult>
  generateBatchCorrections: (meetingId: string, options?: {
    onlyLowConfidence?: boolean
    maxSegments?: number
  }) => Promise<BatchCorrectionResult>
  acceptCorrection: (correctionId: string) => Promise<boolean>
  rejectCorrection: (correctionId: string) => Promise<boolean>
  loadCorrections: (meetingId: string) => Promise<void>
  loadPendingCorrections: (meetingId: string) => Promise<void>
  loadStats: (meetingId: string) => Promise<void>
  shouldSuggestCorrection: (transcriptId: string) => Promise<{ suggest: boolean; reason?: string }>
  setCurrentCorrection: (correction: TranscriptCorrection | null) => void
  clearError: () => void
}

// ============================================================================
// Hook Implementation
// ============================================================================

export function useTranscriptCorrection(): UseTranscriptCorrectionReturn {
  const toastStore = useToastStore()

  // State
  const [isAvailable, setIsAvailable] = useState(false)
  const [isCheckingAvailability, setIsCheckingAvailability] = useState(false)
  const [isGenerating, setIsGenerating] = useState(false)
  const [isProcessing, setIsProcessing] = useState(false)
  const [currentCorrection, setCurrentCorrection] = useState<TranscriptCorrection | null>(null)
  const [corrections, setCorrections] = useState<TranscriptCorrection[]>([])
  const [pendingCorrections, setPendingCorrections] = useState<TranscriptCorrection[]>([])
  const [stats, setStats] = useState<CorrectionStats | null>(null)
  const [error, setError] = useState<string | null>(null)

  // Check availability on mount
  useEffect(() => {
    checkAvailability()
  }, [])

  /**
   * Check if LLM is available for corrections
   */
  const checkAvailability = useCallback(async (): Promise<boolean> => {
    const api = getTranscriptCorrectionAPI()
    if (!api) {
      setIsAvailable(false)
      return false
    }
    setIsCheckingAvailability(true)
    setError(null)
    try {
      const result = await api.checkAvailability()
      setIsAvailable(result.available)
      if (!result.available && result.error) {
        setError(result.error)
      }
      return result.available
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : 'Failed to check availability'
      setError(errorMsg)
      setIsAvailable(false)
      return false
    } finally {
      setIsCheckingAvailability(false)
    }
  }, [])

  /**
   * Generate correction for a single transcript segment
   */
  const generateCorrection = useCallback(async (
    transcriptId: string,
    trigger: CorrectionTrigger = 'manual'
  ): Promise<CorrectionResult> => {
    const api = getTranscriptCorrectionAPI()
    if (!api) {
      return { success: false, error: 'API not available' }
    }
    setIsGenerating(true)
    setError(null)
    try {
      const result = await api.generateCorrection(transcriptId, trigger)

      if (result.success && result.correction) {
        setCurrentCorrection(result.correction)
        // Update corrections list
        setCorrections((prev: TranscriptCorrection[]) => {
          const exists = prev.find((c: TranscriptCorrection) => c.id === result.correction!.id)
          if (exists) {
            return prev.map((c: TranscriptCorrection) => c.id === result.correction!.id ? result.correction! : c)
          }
          return [...prev, result.correction!]
        })
        // Update pending corrections
        setPendingCorrections((prev: TranscriptCorrection[]) => {
          const exists = prev.find((c: TranscriptCorrection) => c.id === result.correction!.id)
          if (exists) {
            return prev.map((c: TranscriptCorrection) => c.id === result.correction!.id ? result.correction! : c)
          }
          return [...prev, result.correction!]
        })
      } else if (result.error) {
        setError(result.error)
        toastStore.error('Correction Error', result.error)
      } else if (result.success && !result.correction) {
        // No changes needed
        toastStore.info('No Changes', 'No corrections needed for this segment')
      }

      return result
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : 'Failed to generate correction'
      setError(errorMsg)
      toastStore.error('Error', errorMsg)
      return { success: false, error: errorMsg }
    } finally {
      setIsGenerating(false)
    }
  }, [toastStore])

  /**
   * Generate batch corrections for a meeting
   */
  const generateBatchCorrections = useCallback(async (
    meetingId: string,
    options?: { onlyLowConfidence?: boolean; maxSegments?: number }
  ): Promise<BatchCorrectionResult> => {
    const api = getTranscriptCorrectionAPI()
    if (!api) {
      return {
        success: false,
        totalSegments: 0,
        corrected: 0,
        skipped: 0,
        failed: 0,
        corrections: [],
        errors: ['API not available']
      }
    }
    setIsGenerating(true)
    setError(null)
    try {
      const result = await api.generateBatchCorrections(meetingId, options)

      if (result.success) {
        // Update corrections list
        setCorrections((prev: TranscriptCorrection[]) => {
          const newIds = new Set(result.corrections.map((c: TranscriptCorrection) => c.id))
          const filtered = prev.filter((c: TranscriptCorrection) => !newIds.has(c.id))
          return [...filtered, ...result.corrections]
        })
        // Update pending corrections
        const pending = result.corrections.filter((c: TranscriptCorrection) => c.status === 'pending')
        setPendingCorrections(pending)

        toastStore.success('Batch Correction', `Generated ${result.corrected} corrections (${result.skipped} skipped, ${result.failed} failed)`)
      } else if (result.errors.length > 0) {
        setError(result.errors.join('; '))
        toastStore.error('Batch Error', result.errors[0])
      }

      return result
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : 'Failed to generate batch corrections'
      setError(errorMsg)
      toastStore.error('Error', errorMsg)
      return {
        success: false,
        totalSegments: 0,
        corrected: 0,
        skipped: 0,
        failed: 0,
        corrections: [],
        errors: [errorMsg]
      }
    } finally {
      setIsGenerating(false)
    }
  }, [toastStore])

  /**
   * Accept a correction and apply it to the transcript
   */
  const acceptCorrection = useCallback(async (correctionId: string): Promise<boolean> => {
    const api = getTranscriptCorrectionAPI()
    if (!api) return false
    setIsProcessing(true)
    setError(null)
    try {
      const result = await api.acceptCorrection(correctionId)

      if (result.success) {
        // Update local state
        setCorrections((prev: TranscriptCorrection[]) => prev.map((c: TranscriptCorrection) =>
          c.id === correctionId ? { ...c, status: 'accepted' as CorrectionStatus } : c
        ))
        setPendingCorrections((prev: TranscriptCorrection[]) => prev.filter((c: TranscriptCorrection) => c.id !== correctionId))
        if (currentCorrection?.id === correctionId) {
          setCurrentCorrection({ ...currentCorrection, status: 'accepted' })
        }
        toastStore.success('Applied', 'Correction applied successfully')
      } else if (result.error) {
        setError(result.error)
        toastStore.error('Error', result.error)
      }

      return result.success
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : 'Failed to accept correction'
      setError(errorMsg)
      toastStore.error('Error', errorMsg)
      return false
    } finally {
      setIsProcessing(false)
    }
  }, [currentCorrection, toastStore])

  /**
   * Reject a correction
   */
  const rejectCorrection = useCallback(async (correctionId: string): Promise<boolean> => {
    const api = getTranscriptCorrectionAPI()
    if (!api) return false
    setIsProcessing(true)
    setError(null)
    try {
      const result = await api.rejectCorrection(correctionId)

      if (result.success) {
        // Update local state
        setCorrections((prev: TranscriptCorrection[]) => prev.map((c: TranscriptCorrection) =>
          c.id === correctionId ? { ...c, status: 'rejected' as CorrectionStatus } : c
        ))
        setPendingCorrections((prev: TranscriptCorrection[]) => prev.filter((c: TranscriptCorrection) => c.id !== correctionId))
        if (currentCorrection?.id === correctionId) {
          setCurrentCorrection({ ...currentCorrection, status: 'rejected' })
        }
        toastStore.info('Rejected', 'Correction rejected')
      } else if (result.error) {
        setError(result.error)
        toastStore.error('Error', result.error)
      }

      return result.success
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : 'Failed to reject correction'
      setError(errorMsg)
      toastStore.error('Error', errorMsg)
      return false
    } finally {
      setIsProcessing(false)
    }
  }, [currentCorrection, toastStore])

  /**
   * Load all corrections for a meeting
   */
  const loadCorrections = useCallback(async (meetingId: string): Promise<void> => {
    const api = getTranscriptCorrectionAPI()
    if (!api) return
    try {
      const result = await api.getByMeetingId(meetingId)
      setCorrections(result)
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : 'Failed to load corrections'
      setError(errorMsg)
    }
  }, [])

  /**
   * Load pending corrections for a meeting
   */
  const loadPendingCorrections = useCallback(async (meetingId: string): Promise<void> => {
    const api = getTranscriptCorrectionAPI()
    if (!api) return
    try {
      const result = await api.getPendingByMeetingId(meetingId)
      setPendingCorrections(result)
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : 'Failed to load pending corrections'
      setError(errorMsg)
    }
  }, [])

  /**
   * Load correction statistics for a meeting
   */
  const loadStats = useCallback(async (meetingId: string): Promise<void> => {
    const api = getTranscriptCorrectionAPI()
    if (!api) return
    try {
      const result = await api.getStats(meetingId)
      setStats(result)
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : 'Failed to load statistics'
      setError(errorMsg)
    }
  }, [])

  /**
   * Check if a transcript should suggest correction
   */
  const shouldSuggestCorrection = useCallback(async (
    transcriptId: string
  ): Promise<{ suggest: boolean; reason?: string }> => {
    const api = getTranscriptCorrectionAPI()
    if (!api) return { suggest: false }
    try {
      return await api.shouldSuggestCorrection(transcriptId)
    } catch {
      return { suggest: false }
    }
  }, [])

  /**
   * Clear error state
   */
  const clearError = useCallback(() => {
    setError(null)
  }, [])

  return {
    // State
    isAvailable,
    isCheckingAvailability,
    isGenerating,
    isProcessing,
    currentCorrection,
    corrections,
    pendingCorrections,
    stats,
    error,

    // Actions
    checkAvailability,
    generateCorrection,
    generateBatchCorrections,
    acceptCorrection,
    rejectCorrection,
    loadCorrections,
    loadPendingCorrections,
    loadStats,
    shouldSuggestCorrection,
    setCurrentCorrection,
    clearError
  }
}

export default useTranscriptCorrection
