/**
 * LiveDiarizationPanel Component
 *
 * Displays real-time speaker identification during live recording using
 * voice embedding-based diarization (NOT LLM processing).
 *
 * This component shows:
 * - Current active speaker
 * - Speaker timeline visualization
 * - Number of speakers detected
 * - Diarization status and confidence
 *
 * The diarization runs independently from transcription and uses
 * pyannote.audio or SpeechBrain speaker embeddings for fast, real-time
 * speaker identification without requiring LLM processing.
 */

import { useEffect, useMemo, useState, useRef, memo } from 'react'
import { Users, Mic, Activity, AlertCircle, CheckCircle, HelpCircle } from 'lucide-react'
import { cn } from '../../lib/utils'
import { useLiveDiarization } from '../../hooks/useLiveDiarization'
import { SPEAKER_COLORS, parseSpeakerIndex, type SpeakerColorConfig } from '../transcript/transcript-utils'
import { useSpeakerNameStore, type IdentifiedSpeaker } from '../../stores/speaker-name-store'

// ============================================================================
// Types
// ============================================================================

export interface LiveDiarizationPanelProps {
  /** Meeting ID for the current recording */
  meetingId: string
  /** Whether recording is active */
  isRecording: boolean
  /** Current recording duration in milliseconds */
  recordingDurationMs?: number
  /** Whether to auto-start diarization when recording starts */
  autoStart?: boolean
  /** Speaker similarity threshold (0.0-1.0, default: 0.30)
   * Lower values = more speakers detected (more sensitive to voice differences)
   * Typical same-speaker similarity: 0.8-0.95, different speakers: 0.2-0.5 */
  similarityThreshold?: number
  /** Maximum number of speakers to track */
  maxSpeakers?: number
  /** Callback when speaker changes */
  onSpeakerChange?: (speaker: string | null, previousSpeaker: string | null) => void
  /** Additional class names */
  className?: string
  /** Compact display mode */
  compact?: boolean
}

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Format a speaker label for display
 * Enhanced to check speaker name store for dynamic names
 */
function formatSpeakerLabel(speaker: string, identifiedSpeaker?: IdentifiedSpeaker): string {
  // If we have an identified speaker with a name, use it
  if (identifiedSpeaker?.isIdentified) {
    return identifiedSpeaker.displayName
  }

  // If there's a stored display name (even if not "identified"), use it
  if (identifiedSpeaker?.displayName) {
    return identifiedSpeaker.displayName
  }

  // Parse Speaker_0, Speaker_1, etc. to "Speaker 1", "Speaker 2"
  const index = parseSpeakerIndex(speaker)
  if (index >= 0) {
    return `Speaker ${index + 1}`
  }
  return speaker
}

/**
 * Get confidence indicator info
 */
function getConfidenceInfo(speaker?: IdentifiedSpeaker): {
  showIndicator: boolean
  isLowConfidence: boolean
  confidence: number
  tooltipText: string
} {
  if (!speaker || !speaker.isIdentified) {
    return {
      showIndicator: false,
      isLowConfidence: false,
      confidence: 0,
      tooltipText: '',
    }
  }

  const confidence = speaker.confidence
  const isLowConfidence = confidence < 0.5

  return {
    showIndicator: confidence < 0.8,
    isLowConfidence,
    confidence,
    tooltipText: `${Math.round(confidence * 100)}% confidence`,
  }
}

/**
 * Get speaker color based on speaker label
 */
function getSpeakerColor(speaker: string): SpeakerColorConfig {
  const index = parseSpeakerIndex(speaker)
  return SPEAKER_COLORS[Math.max(0, index) % SPEAKER_COLORS.length]
}

/**
 * Format duration for display
 */
function formatDuration(seconds: number): string {
  const mins = Math.floor(seconds / 60)
  const secs = Math.floor(seconds % 60)
  return `${mins}:${secs.toString().padStart(2, '0')}`
}

// ============================================================================
// Component
// ============================================================================

export const LiveDiarizationPanel = memo(function LiveDiarizationPanel({
  meetingId,
  isRecording,
  // recordingDurationMs is available for future use (e.g., timeline visualization)
  recordingDurationMs: _recordingDurationMs = 0,
  autoStart = true,
  // FIXED: Lowered from 0.5 to 0.30 to prevent merging of distinct speakers
  similarityThreshold = 0.30,
  maxSpeakers = 10,
  onSpeakerChange,
  className,
  compact = false,
}: LiveDiarizationPanelProps) {
  // Suppress unused variable warning - reserved for future timeline features
  void _recordingDurationMs

  const {
    isAvailable,
    isActive,
    isInitializing,
    isColdStartComplete,
    numSpeakers,
    totalAudioProcessed,
    currentSpeaker,
    speakerSegments,
    speakerChanges,
    error,
    status,
    startDiarization,
    stopDiarization,
    // pauseDiarization and resumeDiarization are available for pause/resume feature
    pauseDiarization: _pauseDiarization,
    resumeDiarization: _resumeDiarization,
  } = useLiveDiarization()

  // Suppress unused variable warnings - reserved for future pause/resume features
  void _pauseDiarization
  void _resumeDiarization

  // Get speaker names from the store
  const speakerNameMap = useSpeakerNameStore((state) => state.speakers)
  const setCurrentSpeakerInStore = useSpeakerNameStore((state) => state.setCurrentSpeaker)
  const registerSpeaker = useSpeakerNameStore((state) => state.registerSpeaker)

  // Track name animation states
  const [animatingSpeakers, setAnimatingSpeakers] = useState<Set<string>>(new Set())
  const previousNamesRef = useRef<Map<string, string>>(new Map())

  // Sync current speaker to the store
  useEffect(() => {
    setCurrentSpeakerInStore(currentSpeaker)
  }, [currentSpeaker, setCurrentSpeakerInStore])

  // Register new speakers in the store as they're detected
  useEffect(() => {
    speakerSegments.forEach((segment) => {
      if (!speakerNameMap.has(segment.speaker)) {
        registerSpeaker(segment.speaker, parseSpeakerIndex(segment.speaker))
      }
    })
  }, [speakerSegments, speakerNameMap, registerSpeaker])

  // Detect name changes and trigger animations
  useEffect(() => {
    const newAnimating = new Set<string>()

    speakerNameMap.forEach((speaker, id) => {
      const previousName = previousNamesRef.current.get(id)
      if (previousName && previousName !== speaker.displayName) {
        newAnimating.add(id)
      }
      previousNamesRef.current.set(id, speaker.displayName)
    })

    if (newAnimating.size > 0) {
      setAnimatingSpeakers(newAnimating)
      const timer = setTimeout(() => setAnimatingSpeakers(new Set()), 500)
      return () => clearTimeout(timer)
    }
  }, [speakerNameMap])

  // Helper to get speaker info with name
  const getSpeakerInfo = (speakerId: string) => {
    const storedSpeaker = speakerNameMap.get(speakerId)
    const displayName = formatSpeakerLabel(speakerId, storedSpeaker)
    const confidenceInfo = getConfidenceInfo(storedSpeaker)
    const isAnimating = animatingSpeakers.has(speakerId)
    return { displayName, confidenceInfo, isAnimating, storedSpeaker }
  }

  // Calculate speaker statistics
  const speakerStats = useMemo(() => {
    const stats: Record<string, { duration: number; segments: number; lastActive: number }> = {}

    for (const segment of speakerSegments) {
      const duration = segment.endTime - segment.startTime
      if (!stats[segment.speaker]) {
        stats[segment.speaker] = { duration: 0, segments: 0, lastActive: 0 }
      }
      stats[segment.speaker].duration += duration
      stats[segment.speaker].segments += 1
      stats[segment.speaker].lastActive = Math.max(stats[segment.speaker].lastActive, segment.endTime)
    }

    return stats
  }, [speakerSegments])

  // Auto-start diarization when recording starts
  useEffect(() => {
    if (autoStart && isRecording && !isActive && !isInitializing && isAvailable && meetingId) {
      console.log('[LiveDiarizationPanel] Auto-starting diarization for recording')
      startDiarization(meetingId, {
        similarityThreshold,
        maxSpeakers,
      })
    }
  }, [isRecording, isActive, isInitializing, isAvailable, meetingId, autoStart, startDiarization, similarityThreshold, maxSpeakers])

  // Auto-stop diarization when recording stops
  useEffect(() => {
    if (!isRecording && isActive) {
      console.log('[LiveDiarizationPanel] Auto-stopping diarization (recording stopped)')
      stopDiarization()
    }
  }, [isRecording, isActive, stopDiarization])

  // Notify parent of speaker changes
  useEffect(() => {
    if (onSpeakerChange && speakerChanges.length > 0) {
      const lastChange = speakerChanges[speakerChanges.length - 1]
      onSpeakerChange(lastChange.toSpeaker, lastChange.fromSpeaker)
    }
  }, [speakerChanges, onSpeakerChange])

  // Don't render if diarization is not available
  if (!isAvailable && !isRecording) {
    return null
  }

  // Compact mode - just show current speaker indicator
  if (compact) {
    const compactSpeakerInfo = currentSpeaker ? getSpeakerInfo(currentSpeaker) : null
    const colors = currentSpeaker ? getSpeakerColor(currentSpeaker) : null

    return (
      <div
        className={cn(
          'flex items-center gap-2 px-3 py-1.5 rounded-full transition-all duration-300',
          colors ? colors.bg : 'bg-muted',
          compactSpeakerInfo?.isAnimating && 'scale-105',
          className
        )}
        data-testid="live-diarization-compact"
      >
        <Mic className={cn(
          'w-3.5 h-3.5',
          colors ? colors.text : 'text-muted-foreground'
        )} />
        <span className={cn(
          'text-xs font-medium transition-all duration-300',
          colors ? colors.text : 'text-muted-foreground',
          compactSpeakerInfo?.isAnimating && 'animate-pulse'
        )}>
          {compactSpeakerInfo
            ? compactSpeakerInfo.displayName
            : isInitializing
              ? 'Detecting...'
              : 'No speaker'
          }
        </span>
        {/* Confidence indicator for compact mode */}
        {compactSpeakerInfo?.confidenceInfo.showIndicator && (
          <span title={compactSpeakerInfo.confidenceInfo.tooltipText}>
            <HelpCircle
              className={cn(
                'w-3 h-3',
                compactSpeakerInfo.confidenceInfo.isLowConfidence
                  ? 'text-yellow-500'
                  : 'text-muted-foreground'
              )}
            />
          </span>
        )}
        {numSpeakers > 0 && (
          <span className="text-xs text-muted-foreground">
            ({numSpeakers} detected)
          </span>
        )}
      </div>
    )
  }

  // Full mode - detailed panel
  return (
    <div
      className={cn(
        'bg-card border border-border rounded-lg overflow-hidden',
        className
      )}
      data-testid="live-diarization-panel"
    >
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-2 bg-muted/50 border-b border-border">
        <div className="flex items-center gap-2">
          <Users className="w-4 h-4 text-primary" />
          <span className="text-sm font-medium">Live Speaker Detection</span>
        </div>

        {/* Status indicator */}
        <div className="flex items-center gap-2">
          {status === 'active' ? (
            <>
              <Activity className="w-3.5 h-3.5 text-green-500 animate-pulse" />
              <span className="text-xs text-green-600">Active</span>
            </>
          ) : status === 'initializing' ? (
            <>
              <Activity className="w-3.5 h-3.5 text-yellow-500 animate-pulse" />
              <span className="text-xs text-yellow-600">Starting...</span>
            </>
          ) : status === 'error' ? (
            <>
              <AlertCircle className="w-3.5 h-3.5 text-red-500" />
              <span className="text-xs text-red-600">Error</span>
            </>
          ) : (
            <>
              <span className="w-2 h-2 rounded-full bg-muted-foreground" />
              <span className="text-xs text-muted-foreground">Idle</span>
            </>
          )}
        </div>
      </div>

      {/* Content */}
      <div className="p-4 space-y-4">
        {/* Error display */}
        {error && (
          <div className="flex items-center gap-2 p-2 bg-red-50 text-red-700 rounded text-sm">
            <AlertCircle className="w-4 h-4" />
            <span>{error}</span>
          </div>
        )}

        {/* Not available warning */}
        {!isAvailable && (
          <div className="flex items-center gap-2 p-2 bg-yellow-50 text-yellow-700 rounded text-sm">
            <AlertCircle className="w-4 h-4" />
            <span>Speaker diarization not available. Install pyannote.audio or speechbrain.</span>
          </div>
        )}

        {/* Current speaker highlight */}
        {isActive && (() => {
          const currentInfo = currentSpeaker ? getSpeakerInfo(currentSpeaker) : null
          const currentColors = currentSpeaker ? getSpeakerColor(currentSpeaker) : null

          return (
            <div className="flex items-center gap-4">
              <div className="flex-1">
                <div className="text-xs text-muted-foreground mb-1">Current Speaker</div>
                <div className="flex items-center gap-2">
                  {currentSpeaker && currentInfo && currentColors ? (
                    <>
                      <div
                        className={cn(
                          'w-8 h-8 rounded-full flex items-center justify-center text-sm font-medium transition-all duration-300',
                          currentColors.avatar,
                          currentInfo.isAnimating && 'scale-110'
                        )}
                      >
                        {currentInfo.storedSpeaker?.isIdentified
                          ? currentInfo.displayName.charAt(0).toUpperCase()
                          : parseSpeakerIndex(currentSpeaker) + 1
                        }
                      </div>
                      <span className={cn(
                        'font-medium transition-all duration-300',
                        currentColors.text,
                        currentInfo.isAnimating && 'animate-pulse'
                      )}>
                        {currentInfo.displayName}
                      </span>
                      {/* Confidence indicator */}
                      {currentInfo.confidenceInfo.showIndicator && (
                        <span className={cn(
                          'text-xs px-1.5 py-0.5 rounded',
                          currentInfo.confidenceInfo.isLowConfidence
                            ? 'bg-yellow-100 text-yellow-700'
                            : 'bg-muted text-muted-foreground'
                        )}
                        title={currentInfo.confidenceInfo.tooltipText}
                        >
                          {currentInfo.confidenceInfo.isLowConfidence ? '?' : '~'}
                        </span>
                      )}
                    </>
                  ) : (
                    <span className="text-muted-foreground italic">
                      {isInitializing || !isColdStartComplete
                        ? 'Detecting speakers...'
                        : 'No active speaker'
                      }
                    </span>
                  )}
                </div>
              </div>

              {/* Cold-start indicator */}
              {isActive && !isColdStartComplete && (
                <div className="text-xs text-yellow-600 flex items-center gap-1">
                  <Activity className="w-3 h-3 animate-pulse" />
                  Warming up...
                </div>
              )}

              {/* Ready indicator */}
              {isActive && isColdStartComplete && (
                <div className="text-xs text-green-600 flex items-center gap-1">
                  <CheckCircle className="w-3 h-3" />
                  Ready
                </div>
              )}
            </div>
          )
        })()}

        {/* Speaker list */}
        {numSpeakers > 0 && (
          <div>
            <div className="text-xs text-muted-foreground mb-2">
              Detected Speakers ({numSpeakers})
            </div>
            <div className="flex flex-wrap gap-2">
              {Object.entries(speakerStats)
                .sort((a, b) => b[1].duration - a[1].duration)
                .map(([speaker, stats]) => {
                  const colors = getSpeakerColor(speaker)
                  const speakerInfo = getSpeakerInfo(speaker)
                  const isCurrentSpeaker = speaker === currentSpeaker
                  const percentage = totalAudioProcessed > 0
                    ? ((stats.duration / totalAudioProcessed) * 100).toFixed(0)
                    : '0'

                  return (
                    <div
                      key={speaker}
                      className={cn(
                        'flex items-center gap-2 px-3 py-1.5 rounded-full text-sm transition-all duration-300',
                        colors.bg,
                        isCurrentSpeaker && 'ring-2 ring-offset-1 ring-primary',
                        speakerInfo.isAnimating && 'scale-105'
                      )}
                    >
                      <div
                        className={cn(
                          'w-5 h-5 rounded-full flex items-center justify-center text-xs font-medium transition-all duration-300',
                          colors.avatar
                        )}
                      >
                        {speakerInfo.storedSpeaker?.isIdentified
                          ? speakerInfo.displayName.charAt(0).toUpperCase()
                          : parseSpeakerIndex(speaker) + 1
                        }
                      </div>
                      <span className={cn(
                        'font-medium transition-all duration-300',
                        colors.text,
                        speakerInfo.isAnimating && 'animate-pulse'
                      )}>
                        {speakerInfo.displayName}
                      </span>
                      {/* Confidence indicator */}
                      {speakerInfo.confidenceInfo.showIndicator && (
                        <span title={speakerInfo.confidenceInfo.tooltipText}>
                          <HelpCircle
                            className={cn(
                              'w-3 h-3',
                              speakerInfo.confidenceInfo.isLowConfidence
                                ? 'text-yellow-500'
                                : 'text-muted-foreground'
                            )}
                          />
                        </span>
                      )}
                      <span className="text-xs text-muted-foreground">
                        {percentage}%
                      </span>
                    </div>
                  )
                })}
            </div>
          </div>
        )}

        {/* Stats row */}
        {isActive && (
          <div className="flex items-center gap-6 text-xs text-muted-foreground pt-2 border-t border-border">
            <div>
              <span className="font-medium">{speakerSegments.length}</span> segments
            </div>
            <div>
              <span className="font-medium">{speakerChanges.length}</span> speaker changes
            </div>
            <div>
              <span className="font-medium">{formatDuration(totalAudioProcessed)}</span> processed
            </div>
          </div>
        )}

        {/* Instructions when not active */}
        {!isActive && !isInitializing && isAvailable && (
          <div className="text-sm text-muted-foreground text-center py-2">
            Speaker detection will start automatically when recording begins.
          </div>
        )}
      </div>
    </div>
  )
})

export default LiveDiarizationPanel
