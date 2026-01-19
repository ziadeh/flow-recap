/**
 * RealtimeInsightsPanel Component
 *
 * A dedicated real-time insights panel visible during active recording that aggregates
 * and displays live-generated meeting intelligence. This dashboard consolidates outputs from:
 *
 * 1. Real-time speaker identification - showing active speaker, speaker timeline, and turn-taking patterns
 * 2. Live meeting notes - displaying emerging action items, decisions, and key points as they're extracted
 * 3. Transcript corrections - highlighting segments with low confidence that may need review
 * 4. Meeting metrics - elapsed time, word count, speaker participation balance, topic transitions
 *
 * Features:
 * - Responsive layout that works alongside the main transcript view
 * - Collapsible sections for each insight category
 * - Auto-refresh content as new data streams in
 * - Export live snapshot functionality
 * - Visual indicators for 'processing' state when LLM is analyzing
 * - Non-blocking updates to core recording/transcription pipeline
 */

import { useEffect, useCallback, useMemo, useRef } from 'react'
import { useShallow } from 'zustand/react/shallow'
import {
  Users,
  Sparkles,
  AlertTriangle,
  BarChart3,
  ChevronDown,
  ChevronRight,
  Download,
  Clock,
  MessageSquare,
  CheckCircle2,
  Gavel,
  Lightbulb,
  Tag,
  Loader2,
  X,
  Activity,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import {
  useInsightsMetrics,
  useInsightsExpandedSections,
  useInsightsProcessing,
  useInsightsSpeakerParticipation,
  useInsightsLowConfidenceSegments,
  useInsightsNoteCounts,
  useInsightsPanelActions,
  type InsightsPanelSection,
  type SpeakerParticipation,
  type LowConfidenceSegment,
  type InsightsSnapshot,
} from '@/stores/realtime-insights-store'
import { useLiveTranscriptStore } from '@/stores/live-transcript-store'
import { useLiveNotesStore } from '@/stores/live-notes-store'
import { useLiveDiarization } from '@/hooks/useLiveDiarization'
import { SPEAKER_COLORS, parseSpeakerIndex } from '@/components/transcript/transcript-utils'

// ============================================================================
// Types
// ============================================================================

export interface RealtimeInsightsPanelProps {
  /** Meeting ID for the current recording */
  meetingId: string
  /** Whether recording is currently active */
  isRecording: boolean
  /** Recording duration in milliseconds */
  durationMs: number
  /** Additional class names */
  className?: string
  /** Callback when panel is closed */
  onClose?: () => void
  /** Callback when export is triggered */
  onExport?: (snapshot: InsightsSnapshot) => void
}

interface CollapsibleSectionProps {
  section: InsightsPanelSection
  title: string
  icon: React.ComponentType<{ className?: string }>
  iconColor: string
  bgColor: string
  badge?: React.ReactNode
  children: React.ReactNode
  isExpanded: boolean
  onToggle: () => void
}

// ============================================================================
// Helper Functions
// ============================================================================

function formatDuration(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000)
  const hours = Math.floor(totalSeconds / 3600)
  const minutes = Math.floor((totalSeconds % 3600) / 60)
  const seconds = totalSeconds % 60

  if (hours > 0) {
    return `${hours}:${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`
  }
  return `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`
}

function formatSpeakerLabel(speaker: string): string {
  const index = parseSpeakerIndex(speaker)
  if (index >= 0) {
    return `Speaker ${index + 1}`
  }
  return speaker
}

function getSpeakerColorConfig(speaker: string) {
  const index = parseSpeakerIndex(speaker)
  return SPEAKER_COLORS[Math.max(0, index) % SPEAKER_COLORS.length]
}

// ============================================================================
// Sub-Components
// ============================================================================

function CollapsibleSection({
  title,
  icon: Icon,
  iconColor,
  bgColor,
  badge,
  children,
  isExpanded,
  onToggle,
}: CollapsibleSectionProps) {
  return (
    <div className="border border-border rounded-lg overflow-hidden">
      <button
        onClick={onToggle}
        className={cn(
          'w-full flex items-center justify-between px-3 py-2.5 transition-colors',
          bgColor,
          'hover:opacity-90'
        )}
        data-testid={`insights-section-${title.toLowerCase().replace(/\s+/g, '-')}`}
      >
        <div className="flex items-center gap-2">
          <Icon className={cn('w-4 h-4', iconColor)} />
          <span className="text-sm font-medium text-foreground">{title}</span>
          {badge}
        </div>
        {isExpanded ? (
          <ChevronDown className="w-4 h-4 text-muted-foreground" />
        ) : (
          <ChevronRight className="w-4 h-4 text-muted-foreground" />
        )}
      </button>
      {isExpanded && (
        <div className="p-3 bg-card border-t border-border">
          {children}
        </div>
      )}
    </div>
  )
}

// Speaker Identification Section
function SpeakerIdentificationContent({
  activeSpeaker,
  speakerParticipation,
  speakerTurnCount,
}: {
  activeSpeaker: string | null
  speakerParticipation: SpeakerParticipation[]
  speakerTurnCount: number
}) {
  return (
    <div className="space-y-3">
      {/* Active Speaker */}
      <div className="flex items-center justify-between">
        <span className="text-xs text-muted-foreground">Active Speaker:</span>
        {activeSpeaker ? (
          <div className="flex items-center gap-2">
            <div
              className={cn(
                'w-6 h-6 rounded-full flex items-center justify-center text-xs font-medium',
                getSpeakerColorConfig(activeSpeaker).avatar
              )}
            >
              {parseSpeakerIndex(activeSpeaker) + 1}
            </div>
            <span className={cn('text-sm font-medium', getSpeakerColorConfig(activeSpeaker).text)}>
              {formatSpeakerLabel(activeSpeaker)}
            </span>
            <span className="relative flex h-2 w-2">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75"></span>
              <span className="relative inline-flex rounded-full h-2 w-2 bg-green-500"></span>
            </span>
          </div>
        ) : (
          <span className="text-sm text-muted-foreground italic">None</span>
        )}
      </div>

      {/* Speaker Turn Count */}
      <div className="flex items-center justify-between">
        <span className="text-xs text-muted-foreground">Turn-taking:</span>
        <span className="text-sm font-medium">{speakerTurnCount} turns</span>
      </div>

      {/* Participation Balance */}
      {speakerParticipation.length > 0 && (
        <div className="space-y-2">
          <span className="text-xs text-muted-foreground">Participation Balance:</span>
          <div className="space-y-1.5">
            {speakerParticipation.map((speaker) => (
              <div key={speaker.speakerId} className="flex items-center gap-2">
                <div
                  className={cn(
                    'w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-medium flex-shrink-0',
                    SPEAKER_COLORS[speaker.colorIndex % SPEAKER_COLORS.length].avatar
                  )}
                >
                  {parseSpeakerIndex(speaker.speakerId) + 1}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="h-2 bg-muted rounded-full overflow-hidden">
                    <div
                      className={cn(
                        'h-full rounded-full transition-all duration-500',
                        SPEAKER_COLORS[speaker.colorIndex % SPEAKER_COLORS.length].bg.replace('100', '500')
                      )}
                      style={{ width: `${Math.min(100, speaker.percentageOfTotal)}%` }}
                    />
                  </div>
                </div>
                <span className="text-[10px] text-muted-foreground w-10 text-right">
                  {speaker.percentageOfTotal.toFixed(0)}%
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

// Live Notes Summary Section
function LiveNotesSummaryContent({
  actionItems,
  decisions,
  keyPoints,
  topics,
  isProcessing,
  sessionStatus,
  llmProvider,
  pendingSegments,
  batchesProcessed,
  error,
}: {
  actionItems: number
  decisions: number
  keyPoints: number
  topics: number
  isProcessing: boolean
  sessionStatus?: string
  llmProvider?: string | null
  pendingSegments?: number
  batchesProcessed?: number
  error?: { code: string; message: string } | null
}) {
  return (
    <div className="space-y-2">
      {/* Session status and LLM provider info */}
      {sessionStatus && sessionStatus !== 'idle' && (
        <div className="flex items-center justify-between text-xs text-muted-foreground mb-2">
          <span className="flex items-center gap-1">
            Status: <span className="font-medium">{sessionStatus}</span>
          </span>
          {llmProvider && (
            <span className="flex items-center gap-1">
              Provider: <span className="font-medium">{llmProvider}</span>
            </span>
          )}
        </div>
      )}

      {isProcessing && (
        <div className="flex items-center gap-2 text-xs text-blue-600 dark:text-blue-400 mb-2">
          <Loader2 className="w-3 h-3 animate-spin" />
          <span>Analyzing transcript...</span>
        </div>
      )}

      {/* Error display */}
      {error && (
        <div className="flex items-start gap-2 p-2 bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-800 rounded-lg mb-2">
          <AlertTriangle className="w-3.5 h-3.5 text-red-600 dark:text-red-400 mt-0.5 flex-shrink-0" />
          <div className="flex-1 min-w-0">
            <p className="text-xs text-red-700 dark:text-red-300 font-medium">{error.code}</p>
            <p className="text-[10px] text-red-600 dark:text-red-400 truncate">{error.message}</p>
          </div>
        </div>
      )}

      <div className="grid grid-cols-2 gap-2">
        <div className="flex items-center gap-2 p-2 rounded-lg bg-blue-50 dark:bg-blue-950/30">
          <CheckCircle2 className="w-4 h-4 text-blue-600 dark:text-blue-400" />
          <div className="flex flex-col">
            <span className="text-lg font-semibold text-blue-700 dark:text-blue-300">{actionItems}</span>
            <span className="text-[10px] text-blue-600 dark:text-blue-400">Action Items</span>
          </div>
        </div>

        <div className="flex items-center gap-2 p-2 rounded-lg bg-purple-50 dark:bg-purple-950/30">
          <Gavel className="w-4 h-4 text-purple-600 dark:text-purple-400" />
          <div className="flex flex-col">
            <span className="text-lg font-semibold text-purple-700 dark:text-purple-300">{decisions}</span>
            <span className="text-[10px] text-purple-600 dark:text-purple-400">Decisions</span>
          </div>
        </div>

        <div className="flex items-center gap-2 p-2 rounded-lg bg-amber-50 dark:bg-amber-950/30">
          <Lightbulb className="w-4 h-4 text-amber-600 dark:text-amber-400" />
          <div className="flex flex-col">
            <span className="text-lg font-semibold text-amber-700 dark:text-amber-300">{keyPoints}</span>
            <span className="text-[10px] text-amber-600 dark:text-amber-400">Key Points</span>
          </div>
        </div>

        <div className="flex items-center gap-2 p-2 rounded-lg bg-green-50 dark:bg-green-950/30">
          <Tag className="w-4 h-4 text-green-600 dark:text-green-400" />
          <div className="flex flex-col">
            <span className="text-lg font-semibold text-green-700 dark:text-green-300">{topics}</span>
            <span className="text-[10px] text-green-600 dark:text-green-400">Topics</span>
          </div>
        </div>
      </div>

      {/* Batch processing info */}
      {sessionStatus && sessionStatus !== 'idle' && (
        <div className="flex items-center justify-between text-[10px] text-muted-foreground pt-1">
          <span>{pendingSegments || 0} segments pending</span>
          <span>{batchesProcessed || 0} batches processed</span>
        </div>
      )}

      {actionItems + decisions + keyPoints + topics === 0 && !isProcessing && (
        <p className="text-xs text-muted-foreground text-center py-2">
          Insights will appear as they're extracted from the conversation.
        </p>
      )}
    </div>
  )
}

// Transcript Quality Section
function TranscriptQualityContent({
  averageConfidence,
  lowConfidenceSegments,
  totalSegments,
}: {
  averageConfidence: number
  lowConfidenceSegments: LowConfidenceSegment[]
  totalSegments: number
}) {
  const confidencePercent = (averageConfidence * 100).toFixed(0)
  const qualityLevel =
    averageConfidence >= 0.9 ? 'High' : averageConfidence >= 0.7 ? 'Good' : averageConfidence >= 0.5 ? 'Fair' : 'Low'
  const qualityColor =
    averageConfidence >= 0.9
      ? 'text-green-600 dark:text-green-400'
      : averageConfidence >= 0.7
      ? 'text-blue-600 dark:text-blue-400'
      : averageConfidence >= 0.5
      ? 'text-amber-600 dark:text-amber-400'
      : 'text-red-600 dark:text-red-400'

  return (
    <div className="space-y-3">
      {/* Overall Confidence */}
      <div className="flex items-center justify-between">
        <span className="text-xs text-muted-foreground">Transcription Quality:</span>
        <div className="flex items-center gap-2">
          <span className={cn('text-sm font-medium', qualityColor)}>{qualityLevel}</span>
          <span className="text-xs text-muted-foreground">({confidencePercent}%)</span>
        </div>
      </div>

      {/* Confidence Bar */}
      <div className="h-2 bg-muted rounded-full overflow-hidden">
        <div
          className={cn(
            'h-full rounded-full transition-all duration-500',
            averageConfidence >= 0.9
              ? 'bg-green-500'
              : averageConfidence >= 0.7
              ? 'bg-blue-500'
              : averageConfidence >= 0.5
              ? 'bg-amber-500'
              : 'bg-red-500'
          )}
          style={{ width: `${Math.min(100, averageConfidence * 100)}%` }}
        />
      </div>

      {/* Low Confidence Segments */}
      {lowConfidenceSegments.length > 0 && (
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-xs text-muted-foreground flex items-center gap-1">
              <AlertTriangle className="w-3 h-3 text-amber-500" />
              Segments needing review:
            </span>
            <span className="text-xs font-medium text-amber-600 dark:text-amber-400">
              {lowConfidenceSegments.length}
            </span>
          </div>
          <div className="max-h-24 overflow-y-auto space-y-1">
            {lowConfidenceSegments.slice(0, 5).map((segment) => (
              <div
                key={segment.segmentId}
                className="text-[11px] p-1.5 rounded bg-amber-50 dark:bg-amber-950/30 text-amber-800 dark:text-amber-200 truncate"
              >
                <span className="text-amber-600 dark:text-amber-400 mr-1">
                  [{formatDuration(segment.startTimeMs)}]
                </span>
                {segment.content.slice(0, 50)}...
              </div>
            ))}
            {lowConfidenceSegments.length > 5 && (
              <p className="text-[10px] text-muted-foreground text-center">
                +{lowConfidenceSegments.length - 5} more
              </p>
            )}
          </div>
        </div>
      )}

      {lowConfidenceSegments.length === 0 && totalSegments > 0 && (
        <p className="text-xs text-green-600 dark:text-green-400 flex items-center gap-1">
          <CheckCircle2 className="w-3 h-3" />
          All segments have good confidence
        </p>
      )}
    </div>
  )
}

// Meeting Metrics Section
function MeetingMetricsContent({
  elapsedTime,
  wordCount,
  segmentCount,
  uniqueSpeakers,
}: {
  elapsedTime: number
  wordCount: number
  segmentCount: number
  uniqueSpeakers: number
}) {
  const wordsPerMinute = elapsedTime > 0 ? Math.round((wordCount / (elapsedTime / 60000)) * 10) / 10 : 0

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-3">
        {/* Elapsed Time */}
        <div className="flex items-center gap-2">
          <Clock className="w-4 h-4 text-muted-foreground" />
          <div className="flex flex-col">
            <span className="text-sm font-semibold">{formatDuration(elapsedTime)}</span>
            <span className="text-[10px] text-muted-foreground">Duration</span>
          </div>
        </div>

        {/* Word Count */}
        <div className="flex items-center gap-2">
          <MessageSquare className="w-4 h-4 text-muted-foreground" />
          <div className="flex flex-col">
            <span className="text-sm font-semibold">{wordCount.toLocaleString()}</span>
            <span className="text-[10px] text-muted-foreground">Words</span>
          </div>
        </div>

        {/* Speakers */}
        <div className="flex items-center gap-2">
          <Users className="w-4 h-4 text-muted-foreground" />
          <div className="flex flex-col">
            <span className="text-sm font-semibold">{uniqueSpeakers}</span>
            <span className="text-[10px] text-muted-foreground">Speakers</span>
          </div>
        </div>

        {/* Words per minute */}
        <div className="flex items-center gap-2">
          <Activity className="w-4 h-4 text-muted-foreground" />
          <div className="flex flex-col">
            <span className="text-sm font-semibold">{wordsPerMinute}</span>
            <span className="text-[10px] text-muted-foreground">Words/min</span>
          </div>
        </div>
      </div>

      {/* Segment count */}
      <div className="flex items-center justify-between text-xs text-muted-foreground">
        <span>Transcript segments:</span>
        <span className="font-medium">{segmentCount}</span>
      </div>
    </div>
  )
}

// ============================================================================
// Main Component
// ============================================================================

export function RealtimeInsightsPanel({
  meetingId,
  isRecording,
  durationMs,
  className,
  onClose,
  onExport,
}: RealtimeInsightsPanelProps) {
  // Store actions - use composite hook to avoid 11+ separate subscriptions
  const {
    initializePanel,
    closePanel,
    updateElapsedTime,
    updateActiveSpeaker,
    updateMetrics,
    updateSpeakerParticipation,
    updateNoteCounts,
    setProcessing,
    toggleSection,
    startExport,
    completeExport,
    getExportSnapshot,
  } = useInsightsPanelActions()

  const metrics = useInsightsMetrics()
  const expandedSections = useInsightsExpandedSections()
  const isProcessing = useInsightsProcessing()
  const speakerParticipation = useInsightsSpeakerParticipation()
  const lowConfidenceSegments = useInsightsLowConfidenceSegments()
  const noteCounts = useInsightsNoteCounts()

  // External stores - use single useShallow call for better performance
  const liveSegments = useLiveTranscriptStore(useShallow((state) => state.segments))

  // Get all live notes data in a single subscription
  const { keyPoints, actionItems, decisions, topics, liveNotesStatus, liveNotesError, llmProvider } = useLiveNotesStore(
    useShallow((state) => ({
      keyPoints: state.keyPoints,
      actionItems: state.actionItems,
      decisions: state.decisions,
      topics: state.topics,
      liveNotesStatus: state.status,
      liveNotesError: state.error,
      llmProvider: state.llmProvider,
    }))
  )

  // Live diarization hook
  const { currentSpeaker, numSpeakers, speakerChanges } = useLiveDiarization()

  // Alias for consistency with existing code
  const liveNotesSessionStatus = liveNotesStatus
  const batchState = useLiveNotesStore((state) => state.batchState)

  // Ref to track last metrics update time (prevents unnecessary re-renders)
  const lastMetricsUpdateRef = useRef<number>(0)

  // Memoize expanded section checks to avoid Set recreation issues
  const isSpeakerSectionExpanded = useMemo(() => expandedSections.has('speaker-identification'), [expandedSections])
  const isLiveNotesSectionExpanded = useMemo(() => expandedSections.has('live-notes'), [expandedSections])
  const isQualitySectionExpanded = useMemo(() => expandedSections.has('transcript-quality'), [expandedSections])
  const isMetricsSectionExpanded = useMemo(() => expandedSections.has('meeting-metrics'), [expandedSections])

  // Initialize panel when recording starts
  useEffect(() => {
    if (isRecording && meetingId) {
      initializePanel(meetingId)
    } else if (!isRecording) {
      closePanel()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isRecording, meetingId])

  // NOTE: Live notes session is now managed globally by LiveTranscriptionProvider
  // This component only reads from the live notes store - no session management needed

  // Update elapsed time
  useEffect(() => {
    updateElapsedTime(durationMs)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [durationMs])

  // Update active speaker from live diarization
  useEffect(() => {
    updateActiveSpeaker(currentSpeaker)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentSpeaker])

  // Calculate and update metrics from live transcript
  // Throttle updates to prevent excessive re-renders (max once per 500ms)
  useEffect(() => {
    if (liveSegments.length === 0) return

    const now = Date.now()
    const timeSinceLastUpdate = now - lastMetricsUpdateRef.current

    // Throttle updates to prevent infinite loops and excessive re-renders
    if (timeSinceLastUpdate < 500) {
      return
    }
    lastMetricsUpdateRef.current = now

    // Calculate word count
    const totalWordCount = liveSegments.reduce(
      (sum, seg) => sum + seg.content.split(/\s+/).filter(Boolean).length,
      0
    )

    // Calculate average confidence
    const avgConfidence =
      liveSegments.length > 0
        ? liveSegments.reduce((sum, seg) => sum + seg.confidence, 0) / liveSegments.length
        : 1.0

    // Find low confidence segments
    const lowConfThreshold = 0.7
    const lowConfSegs: LowConfidenceSegment[] = liveSegments
      .filter((seg) => seg.confidence < lowConfThreshold)
      .map((seg) => ({
        segmentId: seg.id,
        content: seg.content,
        confidence: seg.confidence,
        startTimeMs: seg.start_time_ms,
        endTimeMs: seg.end_time_ms,
        speaker: seg.speaker || seg.speaker_id,
      }))

    // Calculate speaker participation
    const speakerStats = new Map<string, { wordCount: number; segmentCount: number; durationMs: number }>()
    let totalDuration = 0

    for (const seg of liveSegments) {
      const speakerId = seg.speaker || seg.speaker_id || 'Unknown'
      const duration = seg.end_time_ms - seg.start_time_ms
      const words = seg.content.split(/\s+/).filter(Boolean).length
      totalDuration += duration

      const existing = speakerStats.get(speakerId) || { wordCount: 0, segmentCount: 0, durationMs: 0 }
      speakerStats.set(speakerId, {
        wordCount: existing.wordCount + words,
        segmentCount: existing.segmentCount + 1,
        durationMs: existing.durationMs + duration,
      })
    }

    const participation: SpeakerParticipation[] = Array.from(speakerStats.entries()).map(
      ([speakerId, stats], index) => ({
        speakerId,
        speakerName: formatSpeakerLabel(speakerId),
        wordCount: stats.wordCount,
        segmentCount: stats.segmentCount,
        totalDurationMs: stats.durationMs,
        percentageOfTotal: totalDuration > 0 ? (stats.durationMs / totalDuration) * 100 : 0,
        colorIndex: parseSpeakerIndex(speakerId) >= 0 ? parseSpeakerIndex(speakerId) : index,
      })
    )

    // Update store
    updateMetrics({
      totalWordCount,
      totalSegmentCount: liveSegments.length,
      averageConfidence: avgConfidence,
      lowConfidenceSegments: lowConfSegs,
      speakerTurnCount: speakerChanges.length,
    })
    updateSpeakerParticipation(participation)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [liveSegments, speakerChanges])

  // Update note counts from live notes store
  useEffect(() => {
    updateNoteCounts({
      actionItems: actionItems.length,
      decisions: decisions.length,
      keyPoints: keyPoints.length,
      topics: topics.length,
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [actionItems.length, decisions.length, keyPoints.length, topics.length])

  // Update processing state
  useEffect(() => {
    setProcessing(liveNotesStatus === 'processing')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [liveNotesStatus])

  // Handle export
  const handleExport = useCallback(() => {
    startExport()
    const snapshot = getExportSnapshot()

    // Download as JSON
    const blob = new Blob([JSON.stringify(snapshot, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `meeting-insights-${meetingId}-${new Date().toISOString().slice(0, 19).replace(/[:.]/g, '-')}.json`
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)

    completeExport()
    onExport?.(snapshot)
  }, [meetingId, onExport, startExport, getExportSnapshot, completeExport])

  // Section toggle handler
  const handleToggleSection = useCallback(
    (section: InsightsPanelSection) => {
      toggleSection(section)
    },
    [toggleSection]
  )

  if (!isRecording) {
    return null
  }

  return (
    <div
      className={cn(
        'bg-card border border-border rounded-lg shadow-sm overflow-hidden',
        className
      )}
      data-testid="realtime-insights-panel"
    >
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 bg-gradient-to-r from-indigo-50 to-purple-50 dark:from-indigo-950/30 dark:to-purple-950/30 border-b border-border">
        <div className="flex items-center gap-2">
          <BarChart3 className="w-5 h-5 text-indigo-600 dark:text-indigo-400" />
          <span className="font-medium text-foreground">Live Insights</span>

          {/* Live indicator */}
          <span className="flex items-center gap-1 px-2 py-0.5 text-xs bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400 rounded-full">
            <span className="w-1.5 h-1.5 bg-green-500 rounded-full animate-pulse" />
            Live
          </span>

          {/* Processing indicator */}
          {isProcessing && (
            <span className="flex items-center gap-1 px-2 py-0.5 text-xs bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400 rounded-full">
              <Loader2 className="w-3 h-3 animate-spin" />
              Processing
            </span>
          )}
        </div>

        <div className="flex items-center gap-2">
          {/* Export button */}
          <button
            onClick={handleExport}
            className="p-1.5 text-muted-foreground hover:text-foreground hover:bg-muted rounded-md transition-colors"
            title="Export insights snapshot"
            data-testid="export-insights-button"
          >
            <Download className="w-4 h-4" />
          </button>

          {/* Close button */}
          {onClose && (
            <button
              onClick={onClose}
              className="p-1.5 text-muted-foreground hover:text-foreground hover:bg-muted rounded-md transition-colors"
              title="Close panel"
            >
              <X className="w-4 h-4" />
            </button>
          )}
        </div>
      </div>

      {/* Content */}
      <div className="p-3 space-y-3 max-h-[calc(100vh-300px)] overflow-y-auto">
        {/* Speaker Identification Section */}
        <CollapsibleSection
          section="speaker-identification"
          title="Speaker Activity"
          icon={Users}
          iconColor="text-purple-600 dark:text-purple-400"
          bgColor="bg-purple-50/50 dark:bg-purple-950/20"
          badge={
            numSpeakers > 0 ? (
              <span className="px-1.5 py-0.5 text-[10px] font-medium bg-purple-100 text-purple-700 dark:bg-purple-900/50 dark:text-purple-300 rounded-full">
                {numSpeakers}
              </span>
            ) : null
          }
          isExpanded={isSpeakerSectionExpanded}
          onToggle={() => handleToggleSection('speaker-identification')}
        >
          <SpeakerIdentificationContent
            activeSpeaker={metrics.activeSpeaker}
            speakerParticipation={speakerParticipation}
            speakerTurnCount={metrics.speakerTurnCount}
          />
        </CollapsibleSection>

        {/* Live Notes Summary Section */}
        <CollapsibleSection
          section="live-notes"
          title="Live Notes"
          icon={Sparkles}
          iconColor="text-amber-600 dark:text-amber-400"
          bgColor="bg-amber-50/50 dark:bg-amber-950/20"
          badge={
            noteCounts.actionItems + noteCounts.decisions + noteCounts.keyPoints + noteCounts.topics > 0 ? (
              <span className="px-1.5 py-0.5 text-[10px] font-medium bg-amber-100 text-amber-700 dark:bg-amber-900/50 dark:text-amber-300 rounded-full">
                {noteCounts.actionItems + noteCounts.decisions + noteCounts.keyPoints + noteCounts.topics}
              </span>
            ) : null
          }
          isExpanded={isLiveNotesSectionExpanded}
          onToggle={() => handleToggleSection('live-notes')}
        >
          <LiveNotesSummaryContent
            actionItems={noteCounts.actionItems}
            decisions={noteCounts.decisions}
            keyPoints={noteCounts.keyPoints}
            topics={noteCounts.topics}
            isProcessing={isProcessing}
            sessionStatus={liveNotesSessionStatus}
            llmProvider={llmProvider}
            pendingSegments={batchState.pendingSegmentCount}
            batchesProcessed={batchState.batchesProcessed}
            error={liveNotesError}
          />
        </CollapsibleSection>

        {/* Transcript Quality Section */}
        <CollapsibleSection
          section="transcript-quality"
          title="Transcript Quality"
          icon={AlertTriangle}
          iconColor="text-orange-600 dark:text-orange-400"
          bgColor="bg-orange-50/50 dark:bg-orange-950/20"
          badge={
            lowConfidenceSegments.length > 0 ? (
              <span className="px-1.5 py-0.5 text-[10px] font-medium bg-orange-100 text-orange-700 dark:bg-orange-900/50 dark:text-orange-300 rounded-full">
                {lowConfidenceSegments.length}
              </span>
            ) : null
          }
          isExpanded={isQualitySectionExpanded}
          onToggle={() => handleToggleSection('transcript-quality')}
        >
          <TranscriptQualityContent
            averageConfidence={metrics.averageConfidence}
            lowConfidenceSegments={lowConfidenceSegments}
            totalSegments={metrics.totalSegmentCount}
          />
        </CollapsibleSection>

        {/* Meeting Metrics Section */}
        <CollapsibleSection
          section="meeting-metrics"
          title="Meeting Metrics"
          icon={BarChart3}
          iconColor="text-blue-600 dark:text-blue-400"
          bgColor="bg-blue-50/50 dark:bg-blue-950/20"
          isExpanded={isMetricsSectionExpanded}
          onToggle={() => handleToggleSection('meeting-metrics')}
        >
          <MeetingMetricsContent
            elapsedTime={durationMs}
            wordCount={metrics.totalWordCount}
            segmentCount={metrics.totalSegmentCount}
            uniqueSpeakers={metrics.uniqueSpeakersCount}
          />
        </CollapsibleSection>
      </div>

      {/* Footer */}
      <div className="px-3 py-2 bg-muted/30 border-t border-border">
        <p className="text-[10px] text-muted-foreground text-center">
          Auto-updates every few seconds. Data is preliminary during recording.
        </p>
      </div>
    </div>
  )
}

export default RealtimeInsightsPanel
