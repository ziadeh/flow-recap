/**
 * Unified Insights Button Component
 *
 * A single unified button that replaces multiple fragmented 'Generate' buttons.
 * Features:
 * - Generates all insights in one operation (Summary, Key Points, Decisions, Action Items, Topics, Sentiment)
 * - Shows confirmation dialog before replacing existing insights
 * - Displays unified progress indicator with section completion tracking
 * - Handles partial failures gracefully
 * - Preserves Overall Sentiment field
 */

import { useState, useEffect, useCallback } from 'react'
import {
  Sparkles,
  Loader2,
  RefreshCw,
  AlertCircle,
  CheckCircle,
  AlertTriangle,
  X,
  FileText,
  Lightbulb,
  Gavel,
  CheckSquare,
  Hash,
  Activity
} from 'lucide-react'

// ============================================================================
// Types (duplicated from preload to avoid import issues)
// ============================================================================

type InsightSection =
  | 'summary'
  | 'keyPoints'
  | 'decisions'
  | 'actionItems'
  | 'topics'
  | 'sentiment'

interface SectionProgress {
  section: InsightSection
  status: 'pending' | 'in_progress' | 'completed' | 'failed'
  error?: string
}

interface ExistingInsightsCounts {
  actionItems: number
  decisions: number
  keyPoints: number
  topics: number
  summaries: number
  sentiment: number
  total: number
}

interface SectionResult {
  section: InsightSection
  success: boolean
  error?: string
  processingTimeMs: number
}

interface UnifiedInsightsResult {
  success: boolean
  partialSuccess: boolean
  error?: string
  sectionResults: SectionResult[]
  metadata: {
    totalProcessingTimeMs: number
    sectionsCompleted: number
    sectionsFailed: number
    noteGenerationMode: 'strict' | 'balanced' | 'loose'
  }
}

// ============================================================================
// Type-safe API accessor
// ============================================================================

interface UnifiedInsightsAPI {
  checkAvailability: () => Promise<{ available: boolean; error?: string; modelInfo?: string }>
  getExistingCounts: (meetingId: string) => Promise<{
    success: boolean
    counts: ExistingInsightsCounts | null
    error?: string
  }>
  deleteExisting: (meetingId: string, options?: { preserveSentiment?: boolean }) => Promise<{
    success: boolean
    deleted: number
    preservedSentiment?: boolean
    error?: string
  }>
  generateAll: (meetingId: string, config?: unknown) => Promise<UnifiedInsightsResult>
}

const getUnifiedInsightsAPI = (): UnifiedInsightsAPI => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (window.electronAPI as any).unifiedInsights as UnifiedInsightsAPI
}

// ============================================================================
// Types
// ============================================================================

interface UnifiedInsightsButtonProps {
  meetingId: string
  hasTranscripts: boolean
  hasExistingInsights: boolean
  generationTimestamp?: string
  onGenerationComplete: () => void
  isRecording?: boolean
}

interface ProgressState {
  isGenerating: boolean
  totalSections: number
  completedSections: number
  currentSection: InsightSection | null
  sections: SectionProgress[]
  overallStatus: 'pending' | 'in_progress' | 'completed' | 'partial_success' | 'failed'
}

// ============================================================================
// Helper Functions
// ============================================================================

const getSectionLabel = (section: InsightSection): string => {
  const labels: Record<InsightSection, string> = {
    summary: 'Overall Summary',
    keyPoints: 'Key Points',
    decisions: 'Decisions',
    actionItems: 'Action Items',
    topics: 'Topics',
    sentiment: 'Sentiment Analysis'
  }
  return labels[section]
}

const getSectionIcon = (section: InsightSection) => {
  const icons: Record<InsightSection, React.ComponentType<{ className?: string }>> = {
    summary: FileText,
    keyPoints: Lightbulb,
    decisions: Gavel,
    actionItems: CheckSquare,
    topics: Hash,
    sentiment: Activity
  }
  return icons[section]
}

const getSectionColor = (section: InsightSection): string => {
  const colors: Record<InsightSection, string> = {
    summary: 'text-blue-600',
    keyPoints: 'text-yellow-600',
    decisions: 'text-purple-600',
    actionItems: 'text-green-600',
    topics: 'text-indigo-600',
    sentiment: 'text-pink-600'
  }
  return colors[section]
}

// ============================================================================
// Confirmation Dialog Component
// ============================================================================

interface ConfirmationDialogProps {
  isOpen: boolean
  onClose: () => void
  onConfirm: () => void
  counts: ExistingInsightsCounts
  isLoading: boolean
}

function ConfirmationDialog({
  isOpen,
  onClose,
  onConfirm,
  counts,
  isLoading
}: ConfirmationDialogProps) {
  if (!isOpen) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/50 backdrop-blur-sm"
        onClick={onClose}
      />

      {/* Dialog */}
      <div className="relative bg-card border border-border rounded-xl shadow-2xl max-w-md w-full mx-4 overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-border bg-muted/30">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-amber-100 dark:bg-amber-900/30">
              <AlertTriangle className="w-5 h-5 text-amber-600" />
            </div>
            <h3 className="text-lg font-semibold">Replace Existing Insights?</h3>
          </div>
          <button
            onClick={onClose}
            className="p-1 rounded-lg hover:bg-muted transition-colors"
          >
            <X className="w-5 h-5 text-muted-foreground" />
          </button>
        </div>

        {/* Content */}
        <div className="px-6 py-4 space-y-4">
          <p className="text-muted-foreground">
            This will replace all existing AI-generated insights with newly generated content.
          </p>

          {/* Counts breakdown */}
          {counts.total > 0 && (
            <div className="p-4 rounded-lg bg-muted/50 border border-border space-y-2">
              <p className="text-sm font-medium text-foreground">
                Existing insights to be replaced:
              </p>
              <div className="grid grid-cols-2 gap-2 text-sm">
                {counts.actionItems > 0 && (
                  <div className="flex items-center gap-2 text-muted-foreground">
                    <CheckSquare className="w-4 h-4 text-green-600" />
                    <span>{counts.actionItems} Action Items</span>
                  </div>
                )}
                {counts.decisions > 0 && (
                  <div className="flex items-center gap-2 text-muted-foreground">
                    <Gavel className="w-4 h-4 text-purple-600" />
                    <span>{counts.decisions} Decisions</span>
                  </div>
                )}
                {counts.keyPoints > 0 && (
                  <div className="flex items-center gap-2 text-muted-foreground">
                    <Lightbulb className="w-4 h-4 text-yellow-600" />
                    <span>{counts.keyPoints} Key Points</span>
                  </div>
                )}
                {counts.topics > 0 && (
                  <div className="flex items-center gap-2 text-muted-foreground">
                    <Hash className="w-4 h-4 text-indigo-600" />
                    <span>{counts.topics} Topics</span>
                  </div>
                )}
                {counts.summaries > 0 && (
                  <div className="flex items-center gap-2 text-muted-foreground">
                    <FileText className="w-4 h-4 text-blue-600" />
                    <span>{counts.summaries} Summaries</span>
                  </div>
                )}
              </div>
            </div>
          )}

          <div className="flex items-start gap-2 p-3 rounded-lg bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800">
            <AlertCircle className="w-4 h-4 text-blue-600 flex-shrink-0 mt-0.5" />
            <p className="text-sm text-blue-800 dark:text-blue-200">
              All 6 insight sections will be regenerated: Summary, Key Points, Decisions, Action Items, Topics, and Sentiment Analysis.
            </p>
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-border bg-muted/30">
          <button
            onClick={onClose}
            disabled={isLoading}
            className="px-4 py-2 text-sm font-medium text-muted-foreground hover:text-foreground hover:bg-muted rounded-lg transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={onConfirm}
            disabled={isLoading}
            className="inline-flex items-center px-4 py-2 text-sm font-medium text-white bg-purple-600 hover:bg-purple-700 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {isLoading ? (
              <>
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                Preparing...
              </>
            ) : (
              <>
                <RefreshCw className="w-4 h-4 mr-2" />
                Replace All Insights
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  )
}

// ============================================================================
// Progress Indicator Component
// ============================================================================

interface ProgressIndicatorProps {
  progress: ProgressState
  onClose?: () => void
}

function ProgressIndicator({ progress, onClose }: ProgressIndicatorProps) {
  const { isGenerating, totalSections, completedSections, sections, overallStatus } = progress

  if (!isGenerating && overallStatus === 'pending') return null

  const progressPercent = totalSections > 0 ? (completedSections / totalSections) * 100 : 0

  return (
    <div className="p-4 bg-card border border-border rounded-lg shadow-lg space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          {overallStatus === 'in_progress' && (
            <Loader2 className="w-5 h-5 text-purple-600 animate-spin" />
          )}
          {overallStatus === 'completed' && (
            <CheckCircle className="w-5 h-5 text-green-600" />
          )}
          {overallStatus === 'partial_success' && (
            <AlertTriangle className="w-5 h-5 text-amber-600" />
          )}
          {overallStatus === 'failed' && (
            <AlertCircle className="w-5 h-5 text-red-600" />
          )}
          <div>
            <h4 className="font-medium text-foreground">
              {overallStatus === 'in_progress' && 'Generating Insights...'}
              {overallStatus === 'completed' && 'Insights Generated Successfully'}
              {overallStatus === 'partial_success' && 'Insights Partially Generated'}
              {overallStatus === 'failed' && 'Generation Failed'}
            </h4>
            <p className="text-sm text-muted-foreground">
              {completedSections}/{totalSections} sections complete
            </p>
          </div>
        </div>
        {(overallStatus === 'completed' || overallStatus === 'partial_success' || overallStatus === 'failed') && onClose && (
          <button
            onClick={onClose}
            className="p-1 rounded-lg hover:bg-muted transition-colors"
          >
            <X className="w-4 h-4 text-muted-foreground" />
          </button>
        )}
      </div>

      {/* Progress Bar */}
      <div className="h-2 bg-muted rounded-full overflow-hidden">
        <div
          className={`h-full transition-all duration-300 rounded-full ${
            overallStatus === 'completed'
              ? 'bg-green-500'
              : overallStatus === 'partial_success'
              ? 'bg-amber-500'
              : overallStatus === 'failed'
              ? 'bg-red-500'
              : 'bg-purple-600'
          }`}
          style={{ width: `${progressPercent}%` }}
        />
      </div>

      {/* Section Details */}
      <div className="grid grid-cols-2 gap-2">
        {sections.map((sectionProgress) => {
          const Icon = getSectionIcon(sectionProgress.section)
          const label = getSectionLabel(sectionProgress.section)
          const color = getSectionColor(sectionProgress.section)

          return (
            <div
              key={sectionProgress.section}
              className={`flex items-center gap-2 p-2 rounded-lg transition-colors ${
                sectionProgress.status === 'in_progress'
                  ? 'bg-purple-50 dark:bg-purple-900/20 border border-purple-200 dark:border-purple-800'
                  : sectionProgress.status === 'completed'
                  ? 'bg-green-50 dark:bg-green-900/20'
                  : sectionProgress.status === 'failed'
                  ? 'bg-red-50 dark:bg-red-900/20'
                  : 'bg-muted/30'
              }`}
            >
              {sectionProgress.status === 'in_progress' ? (
                <Loader2 className={`w-4 h-4 ${color} animate-spin`} />
              ) : sectionProgress.status === 'completed' ? (
                <CheckCircle className="w-4 h-4 text-green-600" />
              ) : sectionProgress.status === 'failed' ? (
                <AlertCircle className="w-4 h-4 text-red-600" />
              ) : (
                <Icon className={`w-4 h-4 ${color} opacity-50`} />
              )}
              <span className={`text-sm ${
                sectionProgress.status === 'pending' ? 'text-muted-foreground' : 'text-foreground'
              }`}>
                {label}
              </span>
            </div>
          )
        })}
      </div>

      {/* Error Messages */}
      {sections.some(s => s.status === 'failed' && s.error) && (
        <div className="p-3 rounded-lg bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800">
          <p className="text-sm text-red-800 dark:text-red-200 font-medium mb-1">
            Some sections failed to generate:
          </p>
          {sections
            .filter(s => s.status === 'failed' && s.error)
            .map(s => (
              <p key={s.section} className="text-xs text-red-700 dark:text-red-300">
                {getSectionLabel(s.section)}: {s.error}
              </p>
            ))}
        </div>
      )}
    </div>
  )
}

// ============================================================================
// Main Component
// ============================================================================

export function UnifiedInsightsButton({
  meetingId,
  hasTranscripts,
  hasExistingInsights,
  generationTimestamp,
  onGenerationComplete,
  isRecording = false
}: UnifiedInsightsButtonProps) {
  const [showConfirmDialog, setShowConfirmDialog] = useState(false)
  const [existingCounts, setExistingCounts] = useState<ExistingInsightsCounts | null>(null)
  const [isLoadingCounts, setIsLoadingCounts] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const [progress, setProgress] = useState<ProgressState>({
    isGenerating: false,
    totalSections: 6,
    completedSections: 0,
    currentSection: null,
    sections: [],
    overallStatus: 'pending'
  })

  // Get API reference
  const api = getUnifiedInsightsAPI()

  // Load existing insights counts when dialog opens
  const loadExistingCounts = useCallback(async () => {
    setIsLoadingCounts(true)
    try {
      const result = await api.getExistingCounts(meetingId)
      if (result.success && result.counts) {
        setExistingCounts(result.counts)
      }
    } catch (err) {
      console.error('Failed to load existing counts:', err)
    } finally {
      setIsLoadingCounts(false)
    }
  }, [meetingId, api])

  // Check LLM availability
  const [isLLMAvailable, setIsLLMAvailable] = useState<boolean | null>(null)
  const [llmError, setLlmError] = useState<string | null>(null)

  useEffect(() => {
    const checkAvailability = async () => {
      try {
        const result = await api.checkAvailability()
        setIsLLMAvailable(result.available)
        if (!result.available) {
          setLlmError(result.error || 'LLM service unavailable')
        }
      } catch (err) {
        setIsLLMAvailable(false)
        setLlmError('Failed to check LLM availability')
      }
    }

    if (hasTranscripts) {
      checkAvailability()
    }
  }, [hasTranscripts, api])

  // Handle button click
  const handleButtonClick = async () => {
    if (!hasTranscripts || !isLLMAvailable) return

    if (hasExistingInsights) {
      // Show confirmation dialog
      await loadExistingCounts()
      setShowConfirmDialog(true)
    } else {
      // Generate directly without confirmation
      handleGenerate()
    }
  }

  // Handle generate
  const handleGenerate = async () => {
    setShowConfirmDialog(false)
    setError(null)

    // Initialize progress state
    const initialSections: SectionProgress[] = [
      { section: 'summary', status: 'pending' },
      { section: 'keyPoints', status: 'pending' },
      { section: 'decisions', status: 'pending' },
      { section: 'actionItems', status: 'pending' },
      { section: 'topics', status: 'pending' },
      { section: 'sentiment', status: 'pending' }
    ]

    setProgress({
      isGenerating: true,
      totalSections: 6,
      completedSections: 0,
      currentSection: 'summary',
      sections: initialSections,
      overallStatus: 'in_progress'
    })

    try {
      // Delete existing insights first (preserve sentiment to avoid clearing it)
      if (hasExistingInsights) {
        await api.deleteExisting(meetingId, { preserveSentiment: true })
      }

      // Generate all insights
      const result: UnifiedInsightsResult = await api.generateAll(meetingId)

      // Update progress with final result
      const finalSections: SectionProgress[] = result.sectionResults.map(sr => ({
        section: sr.section,
        status: sr.success ? 'completed' : 'failed',
        error: sr.error
      }))

      // Fill in any missing sections
      const allSections: InsightSection[] = ['summary', 'keyPoints', 'decisions', 'actionItems', 'topics', 'sentiment']
      const completeSections = allSections.map(section => {
        const existing = finalSections.find(s => s.section === section)
        return existing || { section, status: 'completed' as const }
      })

      setProgress({
        isGenerating: false,
        totalSections: 6,
        completedSections: result.metadata.sectionsCompleted,
        currentSection: null,
        sections: completeSections,
        overallStatus: result.success
          ? 'completed'
          : result.partialSuccess
          ? 'partial_success'
          : 'failed'
      })

      if (result.success || result.partialSuccess) {
        onGenerationComplete()
      } else if (result.error) {
        setError(result.error)
      }
    } catch (err) {
      console.error('Failed to generate insights:', err)
      setError(err instanceof Error ? err.message : 'Failed to generate insights')
      setProgress(prev => ({
        ...prev,
        isGenerating: false,
        overallStatus: 'failed'
      }))
    }
  }

  // Reset progress
  const handleResetProgress = () => {
    setProgress({
      isGenerating: false,
      totalSections: 6,
      completedSections: 0,
      currentSection: null,
      sections: [],
      overallStatus: 'pending'
    })
    setError(null)
  }

  // Don't show if no transcripts or during recording
  if (!hasTranscripts || isRecording) {
    return null
  }

  // Show progress indicator if generating or after generation
  if (progress.isGenerating || progress.overallStatus !== 'pending') {
    return (
      <div className="mb-6">
        <ProgressIndicator progress={progress} onClose={handleResetProgress} />
      </div>
    )
  }

  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-4 mb-6 p-4 bg-muted/30 rounded-lg">
        <div className="flex items-center gap-4">
          {generationTimestamp && (
            <span className="text-sm text-muted-foreground">
              Insights generated at {new Date(generationTimestamp).toLocaleString()}
            </span>
          )}
        </div>

        <div className="flex items-center gap-2">
          {/* Error message */}
          {(error || llmError) && (
            <div className="flex items-center gap-2 px-3 py-1.5 bg-red-50 dark:bg-red-900/20 rounded-lg border border-red-200 dark:border-red-800">
              <AlertCircle className="w-4 h-4 text-red-600" />
              <span className="text-sm text-red-700 dark:text-red-300">
                {error || llmError}
              </span>
            </div>
          )}

          {/* Main button */}
          <button
            onClick={handleButtonClick}
            disabled={!isLLMAvailable || progress.isGenerating}
            className={`inline-flex items-center px-4 py-2 rounded-lg font-medium text-sm transition-colors ${
              !isLLMAvailable || progress.isGenerating
                ? 'bg-purple-100 text-purple-400 cursor-not-allowed'
                : 'bg-purple-600 text-white hover:bg-purple-700'
            }`}
            title={!isLLMAvailable ? llmError || 'LLM unavailable' : undefined}
          >
            {hasExistingInsights ? (
              <>
                <RefreshCw className="w-4 h-4 mr-2" />
                Replace Existing Insights
              </>
            ) : (
              <>
                <Sparkles className="w-4 h-4 mr-2" />
                Generate All Insights
              </>
            )}
          </button>
        </div>
      </div>

      {/* Confirmation Dialog */}
      <ConfirmationDialog
        isOpen={showConfirmDialog}
        onClose={() => setShowConfirmDialog(false)}
        onConfirm={handleGenerate}
        counts={existingCounts || {
          actionItems: 0,
          decisions: 0,
          keyPoints: 0,
          topics: 0,
          summaries: 0,
          sentiment: 0,
          total: 0
        }}
        isLoading={isLoadingCounts}
      />
    </>
  )
}

export default UnifiedInsightsButton
