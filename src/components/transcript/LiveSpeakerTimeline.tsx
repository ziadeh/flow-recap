/**
 * LiveSpeakerTimeline Component
 *
 * Displays a real-time timeline visualization showing when each speaker talks
 * during live recording. Updates dynamically as new speaker segments arrive.
 *
 * Features:
 * - Real-time speaker activity visualization
 * - Color-coded speaker tracks
 * - Current recording time indicator
 * - Compact and expanded view modes
 * - Dynamic speaker names (shows actual names when identified)
 * - Smooth transitions when names are identified
 */

import { useMemo, useState, useEffect, useRef, memo } from 'react'
import { Users, ChevronUp, ChevronDown, HelpCircle } from 'lucide-react'
import { cn } from '../../lib/utils'
import {
  isDiarizationSpeaker,
  parseSpeakerIndex,
  SPEAKER_COLORS,
} from './transcript-utils'
import { useSpeakerNameStore } from '../../stores/speaker-name-store'
import type { LiveTranscriptSegment } from '../../stores/live-transcript-store'

// ============================================================================
// Types
// ============================================================================

export interface LiveSpeakerTimelineProps {
  /** Array of live transcript segments with speaker information */
  segments: LiveTranscriptSegment[]
  /** Current recording duration in milliseconds */
  recordingDurationMs: number
  /** Whether the timeline is expanded (shows all tracks) */
  expanded?: boolean
  /** Callback when a segment is clicked */
  onSegmentClick?: (segment: LiveTranscriptSegment) => void
  /** Additional class names */
  className?: string
  /** Show debug info even when no speakers detected */
  showDebugWhenEmpty?: boolean
}

interface SpeakerTrack {
  speakerId: string
  speakerLabel: string
  /** Whether this speaker has been identified by name */
  isIdentified: boolean
  /** Confidence level for the name (0-1) */
  confidence: number
  colorIndex: number
  segments: Array<{
    startMs: number
    endMs: number
    segmentId: string
    content: string
  }>
  totalDurationMs: number
}

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Create speaker tracks from live transcript segments
 * Now enhanced to use speaker name store for dynamic names
 */
function createSpeakerTracks(
  segments: LiveTranscriptSegment[],
  speakerNames: Map<string, { displayName: string; isIdentified: boolean; confidence: number }>
): SpeakerTrack[] {
  const trackMap = new Map<string, SpeakerTrack>()
  const speakerOrder: string[] = []

  for (const segment of segments) {
    // Get speaker ID from segment (prefer speaker_id, fallback to speaker)
    const speakerId = segment.speaker_id || segment.speaker || 'unknown'

    if (!trackMap.has(speakerId)) {
      speakerOrder.push(speakerId)

      // Get name from speaker name store if available
      const storedSpeaker = speakerNames.get(speakerId)

      // Generate speaker label
      let speakerLabel = 'Unknown'
      let isIdentified = false
      let confidence = 0

      if (storedSpeaker) {
        // Use stored name
        speakerLabel = storedSpeaker.displayName
        isIdentified = storedSpeaker.isIdentified
        confidence = storedSpeaker.confidence
      } else if (isDiarizationSpeaker(speakerId)) {
        // Fallback to formatted speaker ID
        const index = parseSpeakerIndex(speakerId) + 1
        speakerLabel = `Speaker ${index}`
      } else if (speakerId !== 'unknown') {
        speakerLabel = speakerId
      }

      // Assign color based on speaker order
      const colorIndex = speakerOrder.length - 1

      trackMap.set(speakerId, {
        speakerId,
        speakerLabel,
        isIdentified,
        confidence,
        colorIndex,
        segments: [],
        totalDurationMs: 0,
      })
    }

    const track = trackMap.get(speakerId)!
    const durationMs = segment.end_time_ms - segment.start_time_ms
    track.segments.push({
      startMs: segment.start_time_ms,
      endMs: segment.end_time_ms,
      segmentId: segment.id,
      content: segment.content,
    })
    track.totalDurationMs += durationMs
  }

  // Return tracks in order of first appearance
  return speakerOrder.map(key => trackMap.get(key)!)
}

/**
 * Format duration in mm:ss format
 */
function formatDuration(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000)
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  return `${minutes}:${seconds.toString().padStart(2, '0')}`
}

// ============================================================================
// Speaker Label Component (with animation support)
// ============================================================================

interface SpeakerLabelProps {
  track: SpeakerTrack
  colors: typeof SPEAKER_COLORS[number]
}

const SpeakerLabel = memo(function SpeakerLabel({ track, colors }: SpeakerLabelProps) {
  const [isAnimating, setIsAnimating] = useState(false)
  const previousLabelRef = useRef(track.speakerLabel)

  // Animate when label changes
  useEffect(() => {
    if (previousLabelRef.current !== track.speakerLabel) {
      setIsAnimating(true)
      const timer = setTimeout(() => setIsAnimating(false), 500)
      previousLabelRef.current = track.speakerLabel
      return () => clearTimeout(timer)
    }
  }, [track.speakerLabel])

  return (
    <div className="flex items-center gap-2 w-28 flex-shrink-0">
      <div
        className={cn(
          'w-6 h-6 rounded-full flex items-center justify-center text-xs font-medium transition-all duration-300',
          colors.avatar
        )}
      >
        {track.speakerLabel.charAt(0).toUpperCase()}
        {isDiarizationSpeaker(track.speakerId)
          ? (parseSpeakerIndex(track.speakerId) + 1)
          : ''}
      </div>
      <div className="flex items-center gap-1 min-w-0">
        <span
          className={cn(
            'text-xs font-medium truncate transition-all duration-300',
            colors.text,
            isAnimating && 'animate-pulse'
          )}
          title={track.speakerLabel}
        >
          {track.speakerLabel}
        </span>
        {/* Show confidence indicator for low confidence identifications */}
        {track.isIdentified && track.confidence < 0.5 && (
          <span title={`Low confidence: ${Math.round(track.confidence * 100)}%`}>
            <HelpCircle
              className="w-3 h-3 text-yellow-500 flex-shrink-0"
            />
          </span>
        )}
      </div>
    </div>
  )
})

// ============================================================================
// LiveSpeakerTimeline Component
// ============================================================================

export const LiveSpeakerTimeline = memo(function LiveSpeakerTimeline({
  segments,
  recordingDurationMs,
  expanded: initialExpanded = true,
  onSegmentClick,
  className,
  showDebugWhenEmpty = false,
}: LiveSpeakerTimelineProps) {
  const [expanded, setExpanded] = useState(initialExpanded)

  // Get speaker names from store
  const speakers = useSpeakerNameStore((state) => state.speakers)
  const speakerNames = useMemo(() => {
    const map = new Map<string, { displayName: string; isIdentified: boolean; confidence: number }>()
    speakers.forEach((speaker, id) => {
      map.set(id, {
        displayName: speaker.displayName,
        isIdentified: speaker.isIdentified,
        confidence: speaker.confidence,
      })
    })
    return map
  }, [speakers])

  // Create speaker tracks from segments - memoize with stable reference
  const tracks = useMemo(
    () => createSpeakerTracks(segments, speakerNames),
    [segments, speakerNames]
  )

  // Calculate timeline duration (at least 30 seconds or recording duration)
  const timelineDuration = Math.max(recordingDurationMs, 30000)

  // Get unique speaker count
  const speakerCount = tracks.length

  // Debug: Log render info
  useEffect(() => {
    console.log('[LiveSpeakerTimeline] Render:', {
      segmentsCount: segments.length,
      tracksCount: tracks.length,
      speakerNamesSize: speakerNames.size,
      recordingDurationMs,
    })
  }, [segments.length, tracks.length, speakerNames.size, recordingDurationMs])

  // Show debug placeholder when no speakers detected but debug mode is enabled
  if (speakerCount === 0) {
    if (showDebugWhenEmpty) {
      return (
        <div
          className={cn(
            'bg-muted/30 border border-border rounded-lg overflow-hidden p-4',
            className
          )}
          data-testid="live-speaker-timeline-empty"
        >
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Users className="w-4 h-4" />
            <span>Waiting for speaker data...</span>
            <span className="text-xs">({segments.length} segments received)</span>
          </div>
        </div>
      )
    }
    return null
  }

  return (
    <div
      className={cn(
        'bg-muted/30 border border-border rounded-lg overflow-hidden',
        className
      )}
      data-testid="live-speaker-timeline"
    >
      {/* Header */}
      <div
        className="flex items-center justify-between px-4 py-2 bg-muted/50 cursor-pointer hover:bg-muted/70 transition-colors"
        onClick={() => setExpanded(!expanded)}
      >
        <div className="flex items-center gap-2">
          <Users className="w-4 h-4 text-muted-foreground" />
          <span className="text-sm font-medium">
            Speaker Activity ({speakerCount} speaker{speakerCount !== 1 ? 's' : ''})
          </span>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-xs text-muted-foreground">
            {formatDuration(recordingDurationMs)}
          </span>
          {expanded ? (
            <ChevronUp className="w-4 h-4 text-muted-foreground" />
          ) : (
            <ChevronDown className="w-4 h-4 text-muted-foreground" />
          )}
        </div>
      </div>

      {/* Timeline content */}
      {expanded && (
        <div className="px-4 py-3 space-y-2">
          {/* Speaker tracks */}
          {tracks.map((track) => {
            const colors = SPEAKER_COLORS[track.colorIndex % SPEAKER_COLORS.length]

            return (
              <div key={track.speakerId} className="flex items-center gap-3">
                {/* Speaker label with dynamic name support */}
                <SpeakerLabel track={track} colors={colors} />

                {/* Track bar */}
                <div className="flex-1 h-5 bg-muted/50 rounded relative overflow-hidden">
                  {/* Speaking segments */}
                  {track.segments.map((segment, idx) => {
                    const left = (segment.startMs / timelineDuration) * 100
                    const width = ((segment.endMs - segment.startMs) / timelineDuration) * 100

                    return (
                      <div
                        key={`${segment.segmentId}-${idx}`}
                        className={cn(
                          'absolute h-full rounded-sm transition-all hover:opacity-100 cursor-pointer',
                          colors.bg,
                          'opacity-80'
                        )}
                        style={{
                          left: `${left}%`,
                          width: `${Math.max(width, 0.5)}%`,
                        }}
                        title={`${formatDuration(segment.startMs)} - ${formatDuration(segment.endMs)}: "${segment.content.substring(0, 50)}..."`}
                        onClick={() => {
                          const fullSegment = segments.find(s => s.id === segment.segmentId)
                          if (fullSegment && onSegmentClick) {
                            onSegmentClick(fullSegment)
                          }
                        }}
                      />
                    )
                  })}

                  {/* Current time indicator */}
                  <div
                    className="absolute top-0 bottom-0 w-0.5 bg-foreground/70 z-10"
                    style={{
                      left: `${(recordingDurationMs / timelineDuration) * 100}%`,
                    }}
                  />
                </div>

                {/* Duration */}
                <span className="text-xs text-muted-foreground w-12 text-right">
                  {formatDuration(track.totalDurationMs)}
                </span>
              </div>
            )
          })}

          {/* Time axis */}
          <div className="flex items-center gap-3 pt-2 border-t border-border/50">
            <div className="w-28" /> {/* Spacer for speaker label column */}
            <div className="flex-1 flex justify-between text-xs text-muted-foreground">
              <span>0:00</span>
              <span>{formatDuration(timelineDuration / 4)}</span>
              <span>{formatDuration(timelineDuration / 2)}</span>
              <span>{formatDuration((timelineDuration * 3) / 4)}</span>
              <span>{formatDuration(timelineDuration)}</span>
            </div>
            <div className="w-12" /> {/* Spacer for duration column */}
          </div>

          {/* Speaker summary */}
          {tracks.length > 0 && (
            <div className="flex items-center gap-4 pt-2 text-xs text-muted-foreground">
              <span>Total speaking time:</span>
              {tracks.map((track) => {
                const colors = SPEAKER_COLORS[track.colorIndex % SPEAKER_COLORS.length]
                const percentage = recordingDurationMs > 0
                  ? ((track.totalDurationMs / recordingDurationMs) * 100).toFixed(0)
                  : '0'

                return (
                  <div key={track.speakerId} className="flex items-center gap-1">
                    <div className={cn('w-2 h-2 rounded-full', colors.bg)} />
                    <span>{track.speakerLabel}: {percentage}%</span>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      )}

      {/* Collapsed summary */}
      {!expanded && tracks.length > 0 && (
        <div className="px-4 py-2 flex items-center gap-2">
          {tracks.map((track) => {
            const colors = SPEAKER_COLORS[track.colorIndex % SPEAKER_COLORS.length]

            return (
              <div
                key={track.speakerId}
                className={cn(
                  'px-2 py-0.5 rounded-full text-xs font-medium',
                  colors.bg,
                  colors.text
                )}
              >
                {track.speakerLabel}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
})

// Default export for backward compatibility
export default LiveSpeakerTimeline
