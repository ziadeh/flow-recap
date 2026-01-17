/**
 * SpeakerTimeline Component
 *
 * Displays a visual timeline showing when each speaker talks throughout
 * the meeting. Each speaker has their own track with colored bars indicating
 * their speaking segments.
 *
 * Features:
 * - One timeline track per detected speaker_id
 * - Colored segments on each speaker's dedicated track
 * - Consistent visual identity (color, lane position) per speaker
 * - Handles overlapping speech by showing concurrent segments on different tracks
 * - Speaker labels (Speaker 1, Speaker 2, Speaker 3)
 * - Zoom/pan controls for long recordings
 * - Playback cursor that moves across all speaker tracks simultaneously
 * - Click-to-seek functionality on timeline segments
 * - Confidence indicators for low-confidence diarization segments
 * - Explicit error state for diarization failures
 */

import { useMemo, useRef, useState, useCallback, useEffect } from 'react'
import {
  ZoomIn,
  ZoomOut,
  Maximize2,
  ChevronLeft,
  ChevronRight,
  AlertTriangle,
  AlertCircle,
} from 'lucide-react'
import { cn } from '../../lib/utils'
import { formatDurationMs } from '../../lib/formatters'
import {
  buildSpeakerColorIndex,
  isDiarizationSpeaker,
  parseSpeakerIndex,
  isLowConfidence,
  SPEAKER_COLORS,
} from './transcript-utils'
import type { Transcript, Speaker } from '../../types/database'

// ============================================================================
// Types
// ============================================================================

export interface SpeakerTimelineProps {
  /** Array of transcript entries */
  transcripts: Transcript[]
  /** Map of speaker IDs to Speaker objects */
  speakers: Map<string, Speaker>
  /** Map of speaker IDs to meeting-specific display names (overrides speaker.name) */
  speakerNameOverrides?: Map<string, string>
  /** Current audio playback time in milliseconds */
  currentTimeMs?: number
  /** Total duration of the meeting in milliseconds */
  totalDurationMs?: number
  /** Callback when timeline is clicked for seeking */
  onSeek?: (timeMs: number) => void
  /** Whether diarization failed or produced no output */
  diarizationError?: DiarizationError | null
  /** Low confidence threshold (0-1, default 0.7) */
  lowConfidenceThreshold?: number
  /** Additional class names */
  className?: string
}

export interface DiarizationError {
  /** Error type */
  type: 'failure' | 'no_output' | 'partial'
  /** Error message */
  message: string
  /** Detailed description */
  details?: string
}

interface SpeakerTrack {
  speakerId: string | null
  speakerName: string
  colorIndex: number
  segments: Array<{
    startMs: number
    endMs: number
    transcriptId: string
    confidence: number
    isLowConfidence: boolean
  }>
}

interface ZoomPanState {
  /** Zoom level (1.0 = fit all, higher = zoomed in) */
  zoom: number
  /** Pan offset in percentage (0-100) */
  panOffset: number
}

// ============================================================================
// Constants
// ============================================================================

const MIN_ZOOM = 1
const MAX_ZOOM = 10
const ZOOM_STEP = 0.5
const DEFAULT_LOW_CONFIDENCE_THRESHOLD = 0.7

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Group transcripts by speaker into tracks with confidence information
 */
function createSpeakerTracks(
  transcripts: Transcript[],
  speakers: Map<string, Speaker>,
  lowConfidenceThreshold: number,
  speakerNameOverrides?: Map<string, string>
): SpeakerTrack[] {
  const trackMap = new Map<string, SpeakerTrack>()
  const colorIndex = buildSpeakerColorIndex(transcripts)

  // Get unique speakers in order of first appearance
  const speakerOrder: string[] = []

  for (const transcript of transcripts) {
    const key = transcript.speaker_id || 'unknown'

    if (!trackMap.has(key)) {
      speakerOrder.push(key)

      const speaker = transcript.speaker_id ? speakers.get(transcript.speaker_id) : undefined
      let speakerName = 'Unknown'

      // Prioritize meeting-specific name override
      const override = transcript.speaker_id ? speakerNameOverrides?.get(transcript.speaker_id) : undefined
      if (override) {
        speakerName = override
      } else if (speaker?.name) {
        speakerName = speaker.name
      } else if (transcript.speaker_id && isDiarizationSpeaker(transcript.speaker_id)) {
        const index = parseSpeakerIndex(transcript.speaker_id) + 1
        speakerName = `Speaker ${index}`
      } else if (transcript.speaker_id) {
        speakerName = transcript.speaker_id
      }

      trackMap.set(key, {
        speakerId: transcript.speaker_id,
        speakerName,
        colorIndex: colorIndex.get(transcript.speaker_id || '') ?? 0,
        segments: []
      })
    }

    const segmentConfidence = transcript.confidence ?? 1
    trackMap.get(key)!.segments.push({
      startMs: transcript.start_time_ms,
      endMs: transcript.end_time_ms,
      transcriptId: transcript.id,
      confidence: segmentConfidence,
      isLowConfidence: isLowConfidence(segmentConfidence, lowConfidenceThreshold)
    })
  }

  // Return tracks in order of first appearance
  return speakerOrder.map(key => trackMap.get(key)!)
}

/**
 * Get the visible time range based on zoom and pan
 */
function getVisibleRange(
  totalDuration: number,
  zoom: number,
  panOffset: number
): { startMs: number; endMs: number; visibleDuration: number } {
  const visibleDuration = totalDuration / zoom
  const maxPanOffset = totalDuration - visibleDuration
  const actualPanOffset = Math.min(Math.max(0, panOffset / 100 * maxPanOffset), maxPanOffset)

  return {
    startMs: actualPanOffset,
    endMs: actualPanOffset + visibleDuration,
    visibleDuration
  }
}

// ============================================================================
// Sub-Components
// ============================================================================

interface TimeAxisProps {
  startMs: number
  endMs: number
  tickCount?: number
}

function TimeAxis({ startMs, endMs, tickCount = 5 }: TimeAxisProps) {
  const ticks = useMemo(() => {
    const duration = endMs - startMs
    const step = duration / (tickCount - 1)
    return Array.from({ length: tickCount }, (_, i) => startMs + i * step)
  }, [startMs, endMs, tickCount])

  return (
    <div className="flex justify-between text-xs text-muted-foreground px-1 mt-1">
      {ticks.map((time, idx) => (
        <span key={idx}>{formatDurationMs(time)}</span>
      ))}
    </div>
  )
}

interface ZoomControlsProps {
  zoom: number
  onZoomIn: () => void
  onZoomOut: () => void
  onResetZoom: () => void
  canZoomIn: boolean
  canZoomOut: boolean
}

function ZoomControls({
  zoom,
  onZoomIn,
  onZoomOut,
  onResetZoom,
  canZoomIn,
  canZoomOut
}: ZoomControlsProps) {
  return (
    <div className="flex items-center gap-1">
      <button
        onClick={onZoomOut}
        disabled={!canZoomOut}
        className={cn(
          'p-1 rounded hover:bg-muted transition-colors',
          !canZoomOut && 'opacity-50 cursor-not-allowed'
        )}
        title="Zoom out"
        aria-label="Zoom out"
      >
        <ZoomOut className="w-4 h-4" />
      </button>
      <button
        onClick={onResetZoom}
        className="px-2 py-0.5 text-xs font-medium rounded hover:bg-muted transition-colors"
        title="Reset zoom"
        aria-label="Reset zoom to fit all"
      >
        <Maximize2 className="w-3 h-3 inline mr-1" />
        {zoom.toFixed(1)}x
      </button>
      <button
        onClick={onZoomIn}
        disabled={!canZoomIn}
        className={cn(
          'p-1 rounded hover:bg-muted transition-colors',
          !canZoomIn && 'opacity-50 cursor-not-allowed'
        )}
        title="Zoom in"
        aria-label="Zoom in"
      >
        <ZoomIn className="w-4 h-4" />
      </button>
    </div>
  )
}

interface PanControlsProps {
  onPanLeft: () => void
  onPanRight: () => void
  canPanLeft: boolean
  canPanRight: boolean
}

function PanControls({ onPanLeft, onPanRight, canPanLeft, canPanRight }: PanControlsProps) {
  return (
    <div className="flex items-center gap-1">
      <button
        onClick={onPanLeft}
        disabled={!canPanLeft}
        className={cn(
          'p-1 rounded hover:bg-muted transition-colors',
          !canPanLeft && 'opacity-50 cursor-not-allowed'
        )}
        title="Pan left"
        aria-label="Pan left"
      >
        <ChevronLeft className="w-4 h-4" />
      </button>
      <button
        onClick={onPanRight}
        disabled={!canPanRight}
        className={cn(
          'p-1 rounded hover:bg-muted transition-colors',
          !canPanRight && 'opacity-50 cursor-not-allowed'
        )}
        title="Pan right"
        aria-label="Pan right"
      >
        <ChevronRight className="w-4 h-4" />
      </button>
    </div>
  )
}

interface DiarizationErrorDisplayProps {
  error: DiarizationError
}

function DiarizationErrorDisplay({ error }: DiarizationErrorDisplayProps) {
  const isPartial = error.type === 'partial'

  return (
    <div
      className={cn(
        'flex items-start gap-3 p-3 rounded-lg border',
        isPartial
          ? 'bg-amber-50 dark:bg-amber-950/30 border-amber-200 dark:border-amber-800'
          : 'bg-red-50 dark:bg-red-950/30 border-red-200 dark:border-red-800'
      )}
      role="alert"
      aria-live="polite"
      data-testid="diarization-error"
    >
      {isPartial ? (
        <AlertCircle className="w-5 h-5 text-amber-600 dark:text-amber-400 flex-shrink-0 mt-0.5" />
      ) : (
        <AlertTriangle className="w-5 h-5 text-red-600 dark:text-red-400 flex-shrink-0 mt-0.5" />
      )}
      <div className="flex-1 min-w-0">
        <h4 className={cn(
          'font-semibold text-sm',
          isPartial
            ? 'text-amber-800 dark:text-amber-200'
            : 'text-red-800 dark:text-red-200'
        )}>
          {error.type === 'failure' && 'Speaker Diarization Failed'}
          {error.type === 'no_output' && 'No Speaker Data Available'}
          {error.type === 'partial' && 'Partial Speaker Data'}
        </h4>
        <p className={cn(
          'text-sm mt-0.5',
          isPartial
            ? 'text-amber-700 dark:text-amber-300'
            : 'text-red-700 dark:text-red-300'
        )}>
          {error.message}
        </p>
        {error.details && (
          <p className={cn(
            'text-xs mt-1',
            isPartial
              ? 'text-amber-600 dark:text-amber-400'
              : 'text-red-600 dark:text-red-400'
          )}>
            {error.details}
          </p>
        )}
      </div>
    </div>
  )
}

interface ConfidenceIndicatorProps {
  confidence: number
  isLow: boolean
}

function ConfidenceIndicator({ confidence, isLow }: ConfidenceIndicatorProps) {
  if (!isLow) return null

  return (
    <div
      className="absolute -top-1 -right-1 w-3 h-3 rounded-full bg-amber-500 flex items-center justify-center"
      title={`Low confidence: ${(confidence * 100).toFixed(0)}%`}
    >
      <span className="text-[8px] text-white font-bold">!</span>
    </div>
  )
}

// ============================================================================
// SpeakerTimeline Component
// ============================================================================

export function SpeakerTimeline({
  transcripts,
  speakers,
  speakerNameOverrides,
  currentTimeMs = 0,
  totalDurationMs,
  onSeek,
  diarizationError,
  lowConfidenceThreshold = DEFAULT_LOW_CONFIDENCE_THRESHOLD,
  className
}: SpeakerTimelineProps) {
  const timelineRef = useRef<HTMLDivElement>(null)
  const tracksContainerRef = useRef<HTMLDivElement>(null)

  // Zoom and pan state
  const [zoomPan, setZoomPan] = useState<ZoomPanState>({
    zoom: MIN_ZOOM,
    panOffset: 0
  })

  // Calculate total duration from transcripts if not provided
  const duration = useMemo(() => {
    if (totalDurationMs) return totalDurationMs
    if (transcripts.length === 0) return 0
    return Math.max(...transcripts.map(t => t.end_time_ms))
  }, [transcripts, totalDurationMs])

  // Create speaker tracks with confidence info
  const tracks = useMemo(
    () => createSpeakerTracks(transcripts, speakers, lowConfidenceThreshold, speakerNameOverrides),
    [transcripts, speakers, lowConfidenceThreshold, speakerNameOverrides]
  )

  // Get visible time range
  const visibleRange = useMemo(
    () => getVisibleRange(duration, zoomPan.zoom, zoomPan.panOffset),
    [duration, zoomPan.zoom, zoomPan.panOffset]
  )

  // Calculate playhead position within visible range
  const playheadPosition = useMemo(() => {
    if (duration === 0 || visibleRange.visibleDuration === 0) return -1

    // Check if current time is within visible range
    if (currentTimeMs < visibleRange.startMs || currentTimeMs > visibleRange.endMs) {
      return -1 // Playhead is outside visible range
    }

    const positionInVisibleRange = (currentTimeMs - visibleRange.startMs) / visibleRange.visibleDuration
    return positionInVisibleRange * 100
  }, [currentTimeMs, duration, visibleRange])

  // Auto-pan to follow playhead
  useEffect(() => {
    if (zoomPan.zoom > 1 && duration > 0) {
      const visibleDuration = duration / zoomPan.zoom
      const maxPanOffset = duration - visibleDuration

      // If playhead is outside visible range, pan to center on it
      if (currentTimeMs < visibleRange.startMs || currentTimeMs > visibleRange.endMs) {
        const targetPanOffset = Math.max(0, Math.min(
          (currentTimeMs - visibleDuration / 2) / maxPanOffset * 100,
          100
        ))
        setZoomPan(prev => ({ ...prev, panOffset: targetPanOffset }))
      }
    }
  }, [currentTimeMs, zoomPan.zoom, duration, visibleRange])

  // Zoom handlers
  const handleZoomIn = useCallback(() => {
    setZoomPan(prev => ({
      ...prev,
      zoom: Math.min(prev.zoom + ZOOM_STEP, MAX_ZOOM)
    }))
  }, [])

  const handleZoomOut = useCallback(() => {
    setZoomPan(prev => ({
      ...prev,
      zoom: Math.max(prev.zoom - ZOOM_STEP, MIN_ZOOM),
      panOffset: prev.zoom - ZOOM_STEP <= MIN_ZOOM ? 0 : prev.panOffset
    }))
  }, [])

  const handleResetZoom = useCallback(() => {
    setZoomPan({ zoom: MIN_ZOOM, panOffset: 0 })
  }, [])

  // Pan handlers
  const handlePanLeft = useCallback(() => {
    setZoomPan(prev => ({
      ...prev,
      panOffset: Math.max(0, prev.panOffset - 10)
    }))
  }, [])

  const handlePanRight = useCallback(() => {
    setZoomPan(prev => ({
      ...prev,
      panOffset: Math.min(100, prev.panOffset + 10)
    }))
  }, [])

  // Handle timeline click for seeking
  const handleTimelineClick = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    if (!onSeek || !tracksContainerRef.current || duration === 0) return

    const rect = tracksContainerRef.current.getBoundingClientRect()
    const clickX = e.clientX - rect.left
    const percentage = clickX / rect.width

    // Convert click position to time within visible range
    const timeMs = visibleRange.startMs + percentage * visibleRange.visibleDuration

    onSeek(timeMs)
  }, [onSeek, duration, visibleRange])

  // Handle segment click for seeking
  const handleSegmentClick = useCallback((e: React.MouseEvent, startMs: number) => {
    e.stopPropagation()
    if (onSeek) {
      onSeek(startMs)
    }
  }, [onSeek])

  // Wheel zoom support
  const handleWheel = useCallback((e: React.WheelEvent) => {
    if (e.ctrlKey || e.metaKey) {
      e.preventDefault()
      if (e.deltaY < 0) {
        handleZoomIn()
      } else {
        handleZoomOut()
      }
    }
  }, [handleZoomIn, handleZoomOut])

  // Show error state if diarization failed
  if (diarizationError && diarizationError.type !== 'partial') {
    return (
      <div className={cn('space-y-2', className)} data-testid="speaker-timeline">
        <DiarizationErrorDisplay error={diarizationError} />
      </div>
    )
  }

  // Show empty state if no transcripts
  if (transcripts.length === 0 || tracks.length === 0) {
    return null
  }

  const canZoomIn = zoomPan.zoom < MAX_ZOOM
  const canZoomOut = zoomPan.zoom > MIN_ZOOM
  const canPanLeft = zoomPan.panOffset > 0
  const canPanRight = zoomPan.panOffset < 100 && zoomPan.zoom > 1

  // Count low confidence segments
  const lowConfidenceCount = tracks.reduce(
    (count, track) => count + track.segments.filter(s => s.isLowConfidence).length,
    0
  )

  return (
    <div
      className={cn('space-y-2', className)}
      data-testid="speaker-timeline"
      onWheel={handleWheel}
    >
      {/* Partial diarization warning */}
      {diarizationError?.type === 'partial' && (
        <DiarizationErrorDisplay error={diarizationError} />
      )}

      {/* Single speaker notice */}
      {tracks.length === 1 && (
        <div
          className="flex items-start gap-3 p-3 rounded-lg border bg-blue-50 dark:bg-blue-950/30 border-blue-200 dark:border-blue-800"
          role="status"
          aria-live="polite"
          data-testid="single-speaker-notice"
        >
          <AlertCircle className="w-5 h-5 text-blue-600 dark:text-blue-400 flex-shrink-0 mt-0.5" />
          <div className="flex-1 min-w-0">
            <h4 className="font-semibold text-sm text-blue-800 dark:text-blue-200">
              Single Speaker Detected
            </h4>
            <p className="text-sm mt-0.5 text-blue-700 dark:text-blue-300">
              Only one speaker was identified in this recording. This is expected for single-person audio like podcasts, tutorials, or monologues.
            </p>
            <p className="text-xs mt-1 text-blue-600 dark:text-blue-400">
              If you expected multiple speakers, the audio quality or similarity between voices may have affected detection.
            </p>
          </div>
        </div>
      )}

      {/* Controls header */}
      <div className="flex items-center justify-between gap-2">
        {/* Left side: Current time */}
        <div className="flex items-center gap-2">
          <span className="px-2 py-1 text-xs font-medium bg-muted rounded-md">
            {formatDurationMs(currentTimeMs)}
          </span>
          {lowConfidenceCount > 0 && (
            <span
              className="flex items-center gap-1 px-2 py-1 text-xs font-medium bg-amber-100 dark:bg-amber-900/50 text-amber-700 dark:text-amber-300 rounded-md"
              title={`${lowConfidenceCount} segment${lowConfidenceCount > 1 ? 's' : ''} with low confidence`}
            >
              <AlertCircle className="w-3 h-3" />
              {lowConfidenceCount}
            </span>
          )}
        </div>

        {/* Right side: Zoom/Pan controls */}
        <div className="flex items-center gap-2">
          {zoomPan.zoom > 1 && (
            <PanControls
              onPanLeft={handlePanLeft}
              onPanRight={handlePanRight}
              canPanLeft={canPanLeft}
              canPanRight={canPanRight}
            />
          )}
          <ZoomControls
            zoom={zoomPan.zoom}
            onZoomIn={handleZoomIn}
            onZoomOut={handleZoomOut}
            onResetZoom={handleResetZoom}
            canZoomIn={canZoomIn}
            canZoomOut={canZoomOut}
          />
        </div>
      </div>

      {/* Timeline tracks */}
      <div
        ref={timelineRef}
        className="relative select-none"
        role="slider"
        aria-label="Audio timeline"
        aria-valuemin={0}
        aria-valuemax={duration}
        aria-valuenow={currentTimeMs}
        aria-valuetext={formatDurationMs(currentTimeMs)}
        tabIndex={0}
      >
        {/* Speaker tracks */}
        <div
          ref={tracksContainerRef}
          className="space-y-1.5 cursor-pointer"
          onClick={handleTimelineClick}
        >
          {tracks.map((track) => {
            const colors = SPEAKER_COLORS[track.colorIndex % SPEAKER_COLORS.length]

            return (
              <div
                key={track.speakerId || track.speakerName}
                className="flex items-center gap-2"
                data-testid={`speaker-track-${track.speakerName.replace(/\s+/g, '-').toLowerCase()}`}
              >
                {/* Speaker label with color badge */}
                <div className="flex items-center gap-1.5 w-24 flex-shrink-0">
                  <div
                    className={cn(
                      'w-6 h-6 rounded-full flex items-center justify-center text-xs font-semibold',
                      colors.avatar
                    )}
                    aria-hidden="true"
                  >
                    {isDiarizationSpeaker(track.speakerId || '')
                      ? parseSpeakerIndex(track.speakerId || '') + 1
                      : track.speakerName.charAt(0).toUpperCase()}
                  </div>
                  <span
                    className={cn(
                      'text-xs font-medium truncate',
                      colors.text
                    )}
                    title={track.speakerName}
                  >
                    {track.speakerName}
                  </span>
                </div>

                {/* Track bar */}
                <div className="flex-1 h-5 bg-muted/30 rounded relative overflow-hidden border border-border/50">
                  {/* Segments */}
                  {track.segments.map((segment, idx) => {
                    // Calculate position within visible range
                    const segmentStart = Math.max(segment.startMs, visibleRange.startMs)
                    const segmentEnd = Math.min(segment.endMs, visibleRange.endMs)

                    // Skip segments outside visible range
                    if (segmentEnd <= visibleRange.startMs || segmentStart >= visibleRange.endMs) {
                      return null
                    }

                    const left = ((segmentStart - visibleRange.startMs) / visibleRange.visibleDuration) * 100
                    const width = ((segmentEnd - segmentStart) / visibleRange.visibleDuration) * 100

                    const isActive = currentTimeMs >= segment.startMs && currentTimeMs <= segment.endMs

                    return (
                      <div
                        key={`${segment.transcriptId}-${idx}`}
                        className={cn(
                          'absolute h-full rounded-sm transition-all cursor-pointer group',
                          colors.bg,
                          isActive
                            ? 'opacity-100 ring-2 ring-foreground/50'
                            : 'opacity-70 hover:opacity-100',
                          segment.isLowConfidence && 'opacity-50'
                        )}
                        style={{
                          left: `${left}%`,
                          width: `${Math.max(width, 0.5)}%`
                        }}
                        title={`${formatDurationMs(segment.startMs)} - ${formatDurationMs(segment.endMs)}${
                          segment.isLowConfidence ? ` (Confidence: ${(segment.confidence * 100).toFixed(0)}%)` : ''
                        }`}
                        onClick={(e) => handleSegmentClick(e, segment.startMs)}
                        data-testid={`segment-${segment.transcriptId}`}
                      >
                        {/* Low confidence indicator */}
                        {segment.isLowConfidence && (
                          <ConfidenceIndicator
                            confidence={segment.confidence}
                            isLow={segment.isLowConfidence}
                          />
                        )}

                        {/* Hover tooltip indicator */}
                        <div className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
                          <span className="text-[10px] font-medium text-foreground/70 bg-background/80 px-1 rounded">
                            {formatDurationMs(segment.startMs)}
                          </span>
                        </div>
                      </div>
                    )
                  })}
                </div>
              </div>
            )
          })}
        </div>

        {/* Playhead - spans all tracks */}
        {playheadPosition >= 0 && (
          <div
            className="absolute top-0 bottom-0 w-0.5 bg-foreground z-20 pointer-events-none transition-all duration-75"
            style={{
              left: `calc(6rem + 0.5rem + ${playheadPosition}% * (100% - 6rem - 0.5rem) / 100)`
            }}
            data-testid="playhead"
          >
            {/* Playhead top knob */}
            <div className="absolute -top-1.5 left-1/2 -translate-x-1/2 w-3 h-3 rounded-full bg-foreground shadow-md" />
            {/* Playhead bottom knob */}
            <div className="absolute -bottom-1.5 left-1/2 -translate-x-1/2 w-3 h-3 rounded-full bg-foreground shadow-md" />
          </div>
        )}
      </div>

      {/* Time axis */}
      <div className="pl-[6.5rem]">
        <TimeAxis startMs={visibleRange.startMs} endMs={visibleRange.endMs} />
      </div>

      {/* Legend */}
      <div className="flex items-center gap-4 pt-2 text-xs text-muted-foreground border-t border-border/50">
        <span className="font-medium">Legend:</span>
        <div className="flex items-center gap-1">
          <div className="w-4 h-3 rounded-sm bg-purple-500/70" />
          <span>Speaking</span>
        </div>
        <div className="flex items-center gap-1">
          <div className="w-4 h-3 rounded-sm bg-amber-500/50 relative">
            <span className="absolute -top-0.5 -right-0.5 text-[6px]">!</span>
          </div>
          <span>Low Confidence</span>
        </div>
        <div className="flex items-center gap-1">
          <div className="w-1 h-4 bg-foreground rounded-full" />
          <span>Playhead</span>
        </div>
      </div>
    </div>
  )
}

export default SpeakerTimeline
