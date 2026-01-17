/**
 * MeetingConfidenceMetrics Component
 * Displays aggregate confidence metrics for a meeting with trend analysis.
 */

import { useState, useEffect, useCallback } from 'react'
import {
  TrendingUp,
  TrendingDown,
  Minus,
  AlertTriangle,
  CheckCircle,
  AlertCircle,
  Eye,
  RefreshCw,
  Wand2,
  BarChart3
} from 'lucide-react'
import { cn } from '../../lib/utils'
import {
  ConfidenceBadge,
  ReviewNeededBadge,
  getConfidenceLevel,
  formatConfidencePercent,
  type ConfidenceLevel,
  type ConfidenceThresholds,
  DEFAULT_THRESHOLDS,
  CONFIDENCE_COLORS
} from './ConfidenceIndicator'

// ============================================================================
// Types
// ============================================================================

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

export interface ConfidenceTrendPoint {
  timestampMs: number
  windowConfidence: number
  segmentCount: number
}

export interface MeetingConfidenceMetricsProps {
  /** Meeting ID to fetch metrics for */
  meetingId: string
  /** Pre-fetched summary (optional, will fetch if not provided) */
  summary?: MeetingConfidenceSummary | null
  /** Trend data points for chart (optional) */
  trendData?: ConfidenceTrendPoint[]
  /** Custom confidence thresholds */
  thresholds?: ConfidenceThresholds
  /** Whether to show trend chart */
  showTrendChart?: boolean
  /** Whether to show detailed breakdown */
  showBreakdown?: boolean
  /** Callback when "view low confidence" is clicked */
  onViewLowConfidence?: () => void
  /** Callback when batch correction is requested */
  onBatchCorrection?: () => void
  /** Whether batch correction is in progress */
  isCorrecting?: boolean
  /** Compact mode for smaller displays */
  compact?: boolean
  /** Additional class names */
  className?: string
}

export interface ConfidenceDistributionBarProps {
  /** Percentage of high confidence segments */
  highPercent: number
  /** Percentage of medium confidence segments */
  mediumPercent: number
  /** Percentage of low confidence segments */
  lowPercent: number
  /** Additional class names */
  className?: string
}

export interface TrendIndicatorProps {
  /** Trend direction */
  trend: 'improving' | 'stable' | 'degrading' | 'unknown'
  /** Size variant */
  size?: 'sm' | 'md' | 'lg'
  /** Show label */
  showLabel?: boolean
  /** Additional class names */
  className?: string
}

// ============================================================================
// TrendIndicator Component
// ============================================================================

export function TrendIndicator({
  trend,
  size = 'md',
  showLabel = true,
  className
}: TrendIndicatorProps) {
  const iconSizes = {
    sm: 'w-3 h-3',
    md: 'w-4 h-4',
    lg: 'w-5 h-5'
  }

  const config = {
    improving: {
      icon: TrendingUp,
      color: 'text-green-600 dark:text-green-400',
      label: 'Improving'
    },
    stable: {
      icon: Minus,
      color: 'text-blue-600 dark:text-blue-400',
      label: 'Stable'
    },
    degrading: {
      icon: TrendingDown,
      color: 'text-red-600 dark:text-red-400',
      label: 'Degrading'
    },
    unknown: {
      icon: Minus,
      color: 'text-muted-foreground',
      label: 'Unknown'
    }
  }

  const { icon: Icon, color, label } = config[trend]

  return (
    <div className={cn('inline-flex items-center gap-1', color, className)}>
      <Icon className={iconSizes[size]} />
      {showLabel && <span className="text-sm font-medium">{label}</span>}
    </div>
  )
}

// ============================================================================
// ConfidenceDistributionBar Component
// ============================================================================

export function ConfidenceDistributionBar({
  highPercent,
  mediumPercent,
  lowPercent,
  className
}: ConfidenceDistributionBarProps) {
  return (
    <div className={cn('w-full h-3 rounded-full overflow-hidden flex', className)}>
      {highPercent > 0 && (
        <div
          className="bg-green-500 transition-all duration-300"
          style={{ width: `${highPercent}%` }}
          title={`High confidence: ${highPercent.toFixed(1)}%`}
        />
      )}
      {mediumPercent > 0 && (
        <div
          className="bg-yellow-500 transition-all duration-300"
          style={{ width: `${mediumPercent}%` }}
          title={`Medium confidence: ${mediumPercent.toFixed(1)}%`}
        />
      )}
      {lowPercent > 0 && (
        <div
          className="bg-red-500 transition-all duration-300"
          style={{ width: `${lowPercent}%` }}
          title={`Low confidence: ${lowPercent.toFixed(1)}%`}
        />
      )}
    </div>
  )
}

// ============================================================================
// ConfidenceBreakdown Component
// ============================================================================

interface ConfidenceBreakdownProps {
  highPercent: number
  mediumPercent: number
  lowPercent: number
  totalSegments: number
  className?: string
}

function ConfidenceBreakdown({
  highPercent,
  mediumPercent,
  lowPercent,
  totalSegments,
  className
}: ConfidenceBreakdownProps) {
  const segments = {
    high: Math.round(highPercent * totalSegments / 100),
    medium: Math.round(mediumPercent * totalSegments / 100),
    low: Math.round(lowPercent * totalSegments / 100)
  }

  return (
    <div className={cn('space-y-2', className)}>
      <div className="flex items-center justify-between text-sm">
        <div className="flex items-center gap-2">
          <CheckCircle className="w-4 h-4 text-green-500" />
          <span className="text-muted-foreground">High confidence</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="font-medium">{segments.high} segments</span>
          <span className="text-muted-foreground">({highPercent.toFixed(1)}%)</span>
        </div>
      </div>

      <div className="flex items-center justify-between text-sm">
        <div className="flex items-center gap-2">
          <AlertTriangle className="w-4 h-4 text-yellow-500" />
          <span className="text-muted-foreground">Medium confidence</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="font-medium">{segments.medium} segments</span>
          <span className="text-muted-foreground">({mediumPercent.toFixed(1)}%)</span>
        </div>
      </div>

      <div className="flex items-center justify-between text-sm">
        <div className="flex items-center gap-2">
          <AlertCircle className="w-4 h-4 text-red-500" />
          <span className="text-muted-foreground">Low confidence</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="font-medium">{segments.low} segments</span>
          <span className="text-muted-foreground">({lowPercent.toFixed(1)}%)</span>
        </div>
      </div>
    </div>
  )
}

// ============================================================================
// SimpleTrendChart Component
// ============================================================================

interface SimpleTrendChartProps {
  data: ConfidenceTrendPoint[]
  thresholds: ConfidenceThresholds
  height?: number
  className?: string
}

function SimpleTrendChart({
  data,
  thresholds,
  height = 60,
  className
}: SimpleTrendChartProps) {
  if (data.length < 2) {
    return (
      <div className={cn('flex items-center justify-center text-muted-foreground text-sm', className)} style={{ height }}>
        Insufficient data for trend chart
      </div>
    )
  }

  // Normalize data points for rendering
  const points = data.map((d, i) => ({
    x: (i / (data.length - 1)) * 100,
    y: (1 - d.windowConfidence) * height,
    confidence: d.windowConfidence
  }))

  // Create SVG path
  const pathD = points
    .map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x} ${p.y}`)
    .join(' ')

  // Threshold lines
  const highThresholdY = (1 - thresholds.high) * height
  const mediumThresholdY = (1 - thresholds.medium) * height

  return (
    <div className={cn('relative', className)}>
      <svg
        width="100%"
        height={height}
        viewBox={`0 0 100 ${height}`}
        preserveAspectRatio="none"
        className="overflow-visible"
      >
        {/* Threshold zones */}
        <rect
          x="0"
          y="0"
          width="100"
          height={highThresholdY}
          fill="rgba(34, 197, 94, 0.1)"
        />
        <rect
          x="0"
          y={highThresholdY}
          width="100"
          height={mediumThresholdY - highThresholdY}
          fill="rgba(234, 179, 8, 0.1)"
        />
        <rect
          x="0"
          y={mediumThresholdY}
          width="100"
          height={height - mediumThresholdY}
          fill="rgba(239, 68, 68, 0.1)"
        />

        {/* Threshold lines */}
        <line
          x1="0"
          y1={highThresholdY}
          x2="100"
          y2={highThresholdY}
          stroke="rgba(34, 197, 94, 0.4)"
          strokeDasharray="2 2"
        />
        <line
          x1="0"
          y1={mediumThresholdY}
          x2="100"
          y2={mediumThresholdY}
          stroke="rgba(234, 179, 8, 0.4)"
          strokeDasharray="2 2"
        />

        {/* Trend line */}
        <path
          d={pathD}
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          className="text-primary"
        />

        {/* Data points */}
        {points.map((p, i) => {
          const level = getConfidenceLevel(p.confidence, thresholds)
          const fillColor = level === 'high' ? '#22c55e' : level === 'medium' ? '#eab308' : '#ef4444'
          return (
            <circle
              key={i}
              cx={p.x}
              cy={p.y}
              r="3"
              fill={fillColor}
              stroke="white"
              strokeWidth="1"
            />
          )
        })}
      </svg>
    </div>
  )
}

// ============================================================================
// Main MeetingConfidenceMetrics Component
// ============================================================================

export function MeetingConfidenceMetrics({
  meetingId,
  summary: propSummary,
  trendData: propTrendData,
  thresholds = DEFAULT_THRESHOLDS,
  showTrendChart = true,
  showBreakdown = true,
  onViewLowConfidence,
  onBatchCorrection,
  isCorrecting = false,
  compact = false,
  className
}: MeetingConfidenceMetricsProps) {
  const [summary, setSummary] = useState<MeetingConfidenceSummary | null>(propSummary ?? null)
  const [trendData, setTrendData] = useState<ConfidenceTrendPoint[]>(propTrendData ?? [])
  const [isLoading, setIsLoading] = useState(!propSummary)
  const [error, setError] = useState<string | null>(null)

  // Fetch metrics from API if not provided
  useEffect(() => {
    if (propSummary) {
      setSummary(propSummary)
      return
    }

    const fetchMetrics = async () => {
      try {
        setIsLoading(true)
        setError(null)

        const [summaryResult, trendsResult] = await Promise.all([
          window.electronAPI?.confidenceScoring?.getMeetingConfidenceSummary(meetingId),
          window.electronAPI?.confidenceScoring?.getTrends(meetingId)
        ])

        if (summaryResult) {
          setSummary(summaryResult)
        }

        if (trendsResult && Array.isArray(trendsResult)) {
          setTrendData(trendsResult.map((t: { timestamp_ms: number; window_confidence: number; segment_count: number }) => ({
            timestampMs: t.timestamp_ms,
            windowConfidence: t.window_confidence,
            segmentCount: t.segment_count
          })))
        }
      } catch (err) {
        console.error('Failed to fetch confidence metrics:', err)
        setError('Failed to load confidence metrics')
      } finally {
        setIsLoading(false)
      }
    }

    fetchMetrics()
  }, [meetingId, propSummary])

  // Update from props if they change
  useEffect(() => {
    if (propTrendData) {
      setTrendData(propTrendData)
    }
  }, [propTrendData])

  const handleRefresh = useCallback(async () => {
    try {
      setIsLoading(true)
      setError(null)

      // Recalculate metrics
      const result = await window.electronAPI?.confidenceScoring?.calculateMeetingMetrics(meetingId)

      if (result) {
        // Fetch updated summary
        const newSummary = await window.electronAPI?.confidenceScoring?.getMeetingConfidenceSummary(meetingId)
        if (newSummary) {
          setSummary(newSummary)
        }
      }
    } catch (err) {
      console.error('Failed to refresh metrics:', err)
      setError('Failed to refresh metrics')
    } finally {
      setIsLoading(false)
    }
  }, [meetingId])

  // Loading state
  if (isLoading) {
    return (
      <div className={cn('p-4 rounded-lg border bg-card', className)}>
        <div className="flex items-center gap-2 text-muted-foreground">
          <RefreshCw className="w-4 h-4 animate-spin" />
          <span>Loading confidence metrics...</span>
        </div>
      </div>
    )
  }

  // Error state
  if (error) {
    return (
      <div className={cn('p-4 rounded-lg border bg-card', className)}>
        <div className="flex items-center gap-2 text-destructive">
          <AlertCircle className="w-4 h-4" />
          <span>{error}</span>
        </div>
      </div>
    )
  }

  // No data state
  if (!summary) {
    return (
      <div className={cn('p-4 rounded-lg border bg-card', className)}>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 text-muted-foreground">
            <BarChart3 className="w-4 h-4" />
            <span>No confidence data available</span>
          </div>
          <button
            onClick={handleRefresh}
            className="p-1 text-muted-foreground hover:text-foreground transition-colors"
            title="Calculate metrics"
          >
            <RefreshCw className="w-4 h-4" />
          </button>
        </div>
      </div>
    )
  }

  const { overallScore, overallLevel, highConfidencePercent, mediumConfidencePercent, lowConfidencePercent, totalSegments, needsReviewCount, qualityDescription, trend } = summary
  const colors = CONFIDENCE_COLORS[overallLevel]

  // Compact mode
  if (compact) {
    return (
      <div className={cn('flex items-center gap-3', className)}>
        <ConfidenceBadge confidence={overallScore} level={overallLevel} size="sm" />
        <TrendIndicator trend={trend} size="sm" showLabel={false} />
        {needsReviewCount > 0 && (
          <ReviewNeededBadge
            count={needsReviewCount}
            onClick={onViewLowConfidence}
          />
        )}
      </div>
    )
  }

  return (
    <div className={cn('p-4 rounded-lg border bg-card space-y-4', className)} data-testid="meeting-confidence-metrics">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <BarChart3 className="w-5 h-5 text-muted-foreground" />
          <h3 className="font-semibold">Transcription Quality</h3>
        </div>
        <button
          onClick={handleRefresh}
          disabled={isLoading}
          className="p-1 text-muted-foreground hover:text-foreground transition-colors disabled:opacity-50"
          title="Refresh metrics"
        >
          <RefreshCw className={cn('w-4 h-4', isLoading && 'animate-spin')} />
        </button>
      </div>

      {/* Overall Score */}
      <div className="flex items-center gap-4">
        <div className={cn('text-3xl font-bold', colors.text)}>
          {formatConfidencePercent(overallScore)}
        </div>
        <div className="flex-1">
          <div className="flex items-center gap-2 mb-1">
            <span className="text-sm font-medium">{qualityDescription}</span>
            <TrendIndicator trend={trend} size="sm" />
          </div>
          <ConfidenceDistributionBar
            highPercent={highConfidencePercent}
            mediumPercent={mediumConfidencePercent}
            lowPercent={lowConfidencePercent}
          />
        </div>
      </div>

      {/* Trend Chart */}
      {showTrendChart && trendData.length >= 2 && (
        <div className="pt-2 border-t">
          <div className="text-sm text-muted-foreground mb-2">Confidence Over Time</div>
          <SimpleTrendChart data={trendData} thresholds={thresholds} />
        </div>
      )}

      {/* Breakdown */}
      {showBreakdown && (
        <div className="pt-2 border-t">
          <ConfidenceBreakdown
            highPercent={highConfidencePercent}
            mediumPercent={mediumConfidencePercent}
            lowPercent={lowConfidencePercent}
            totalSegments={totalSegments}
          />
        </div>
      )}

      {/* Actions */}
      <div className="flex items-center gap-2 pt-2 border-t">
        {needsReviewCount > 0 && onViewLowConfidence && (
          <button
            onClick={onViewLowConfidence}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300 hover:bg-amber-200 dark:hover:bg-amber-900/50 transition-colors"
          >
            <Eye className="w-4 h-4" />
            Review {needsReviewCount} segment{needsReviewCount !== 1 ? 's' : ''}
          </button>
        )}

        {needsReviewCount > 0 && onBatchCorrection && (
          <button
            onClick={onBatchCorrection}
            disabled={isCorrecting}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium bg-primary/10 text-primary hover:bg-primary/20 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {isCorrecting ? (
              <RefreshCw className="w-4 h-4 animate-spin" />
            ) : (
              <Wand2 className="w-4 h-4" />
            )}
            {isCorrecting ? 'Correcting...' : 'Auto-correct all'}
          </button>
        )}
      </div>
    </div>
  )
}

// SimpleTrendChart is also exported via its function declaration above
