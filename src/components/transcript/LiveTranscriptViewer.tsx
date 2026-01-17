/**
 * LiveTranscriptViewer Component
 *
 * Displays real-time transcript segments during active recording sessions.
 * Shows transcription status, progress, and handles auto-scrolling for new content.
 */

import { useRef, useEffect, useMemo, memo } from 'react'
import { Loader2, AlertCircle, Mic, MicOff, Radio } from 'lucide-react'
import { cn } from '../../lib/utils'
import { TranscriptSegment } from './TranscriptSegment'
import { LiveSpeakerTimeline } from './LiveSpeakerTimeline'
import {
  buildSpeakerColorIndex,
  groupTranscriptsBySpeaker,
} from './transcript-utils'
import { useSpeakerNameStore } from '../../stores/speaker-name-store'
import { CurrentSpeakerBadge } from '../recording/CurrentSpeakerBadge'
import type { LiveTranscriptSegment, LiveTranscriptStatus, LiveTranscriptError, TranscriptionProgress } from '../../stores/live-transcript-store'
import type { Transcript, Speaker } from '../../types/database'
import { ProgressBar } from '../ui/ProgressBar'

// ============================================================================
// Types
// ============================================================================

export interface LiveTranscriptViewerProps {
  /** Array of live transcript segments */
  segments: LiveTranscriptSegment[]
  /** Map of speaker IDs to Speaker objects */
  speakers: Map<string, Speaker>
  /** Current status of live transcription */
  status: LiveTranscriptStatus
  /** Current error if any */
  error: LiveTranscriptError | null
  /** Current progress information */
  progress?: TranscriptionProgress | null
  /** Whether to auto-scroll to the latest entry */
  autoScroll?: boolean
  /** Recording duration in milliseconds */
  recordingDuration?: number
  /** Additional class names */
  className?: string
}

// ============================================================================
// Status Badge Component
// ============================================================================

interface StatusBadgeProps {
  status: LiveTranscriptStatus
  error: LiveTranscriptError | null
}

function StatusBadge({ status, error }: StatusBadgeProps) {
  const statusConfig: Record<LiveTranscriptStatus, {
    icon: typeof MicOff
    label: string
    className: string
    iconClassName?: string
  }> = {
    idle: {
      icon: MicOff,
      label: 'Not Recording',
      className: 'bg-gray-100 text-gray-600 border-gray-200',
    },
    starting: {
      icon: Loader2,
      label: 'Starting...',
      className: 'bg-blue-100 text-blue-700 border-blue-200',
      iconClassName: 'animate-spin',
    },
    active: {
      icon: Radio,
      label: 'Live',
      className: 'bg-green-100 text-green-700 border-green-200',
      iconClassName: 'animate-pulse',
    },
    paused: {
      icon: Mic,
      label: 'Paused',
      className: 'bg-amber-100 text-amber-700 border-amber-200',
    },
    processing: {
      icon: Loader2,
      label: 'Processing...',
      className: 'bg-purple-100 text-purple-700 border-purple-200',
      iconClassName: 'animate-spin',
    },
    error: {
      icon: AlertCircle,
      label: 'Error',
      className: 'bg-red-100 text-red-700 border-red-200',
    },
  }

  const config = statusConfig[status] || statusConfig.idle
  const Icon = config.icon

  return (
    <div
      className={cn(
        'inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium border',
        config.className
      )}
    >
      <Icon className={cn('w-3.5 h-3.5', config.iconClassName)} />
      <span>{error ? error.message : config.label}</span>
    </div>
  )
}

// ============================================================================
// Empty State Component
// ============================================================================

interface EmptyStateProps {
  status: LiveTranscriptStatus
}

function EmptyState({ status }: EmptyStateProps) {
  if (status === 'active' || status === 'starting') {
    return (
      <div className="flex flex-col items-center justify-center py-12 text-center">
        <div className="relative mb-4">
          <Mic className="w-12 h-12 text-green-500" />
          <span className="absolute -top-1 -right-1 flex h-4 w-4">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75"></span>
            <span className="relative inline-flex rounded-full h-4 w-4 bg-green-500"></span>
          </span>
        </div>
        <h3 className="text-lg font-semibold text-foreground mb-2">
          Listening...
        </h3>
        <p className="text-sm text-muted-foreground max-w-md">
          Your transcript will appear here as you speak. Keep talking and the text will update in real-time.
        </p>
      </div>
    )
  }

  if (status === 'paused') {
    return (
      <div className="flex flex-col items-center justify-center py-12 text-center">
        <MicOff className="w-12 h-12 text-amber-500 mb-4" />
        <h3 className="text-lg font-semibold text-foreground mb-2">
          Recording Paused
        </h3>
        <p className="text-sm text-muted-foreground max-w-md">
          Resume recording to continue live transcription.
        </p>
      </div>
    )
  }

  return (
    <div className="flex flex-col items-center justify-center py-12 text-center">
      <Mic className="w-12 h-12 text-muted-foreground mb-4" />
      <h3 className="text-lg font-semibold text-foreground mb-2">
        Ready for Live Transcription
      </h3>
      <p className="text-sm text-muted-foreground max-w-md">
        Start recording to see your transcript appear here in real-time.
      </p>
    </div>
  )
}

// ============================================================================
// Error Display Component
// ============================================================================

interface ErrorDisplayProps {
  error: LiveTranscriptError
}

function ErrorDisplay({ error }: ErrorDisplayProps) {
  // Check if this is a setup-related error with setup instructions
  const isSetupError = error.code === 'SERVICE_UNAVAILABLE' &&
    (error.message.includes('setup_venv.sh') || error.message.includes('Setup Required'))

  // Check if this is a "no audio data" error
  const isNoAudioDataError = error.code === 'TRANSCRIPTION_FAILED' &&
    (error.message.includes('No audio data detected') || error.message.includes('no audio data'))

  // Parse multi-line error messages for better display
  const errorLines = error.message.split('\n').filter(line => line.trim())
  const mainError = errorLines[0]
  const hasSetupInstructions = errorLines.length > 1

  // Determine error severity and provide helpful guidance
  const getErrorGuidance = () => {
    // If the error already contains setup instructions, don't add redundant guidance
    if (hasSetupInstructions) {
      return null
    }

    switch (error.code) {
      case 'SERVICE_UNAVAILABLE':
        return 'Please ensure Python and Whisper dependencies are installed. Check the setup documentation for installation instructions.'
      case 'API_UNAVAILABLE':
        return 'The live transcription API is not loaded. Try restarting the application.'
      case 'TRANSCRIPTION_FAILED':
        // For no audio data errors, don't show generic guidance - the error message contains specifics
        if (isNoAudioDataError) {
          return null
        }
        return 'The transcription process encountered an error. It will retry automatically.'
      case 'TRANSCRIPTION_ERROR':
        return 'An unexpected error occurred during transcription. The system will retry.'
      default:
        return error.recoverable
          ? 'The transcription service will attempt to recover automatically.'
          : 'Please check your configuration and try again.'
    }
  }

  const isWarning = error.recoverable && !error.code?.includes('UNAVAILABLE')
  const guidance = getErrorGuidance()

  // For no audio data errors, show a special display with troubleshooting steps
  if (isNoAudioDataError) {
    // Extract bullet points (lines starting with •)
    const bulletPoints = errorLines.filter(line => line.trim().startsWith('•'))
    const nonBulletLines = errorLines.filter(line => !line.trim().startsWith('•') && line !== mainError)

    return (
      <div className="bg-amber-50 border-amber-200 border rounded-lg p-4 mb-4">
        <div className="flex items-start gap-3">
          <Mic className="w-5 h-5 text-amber-600 flex-shrink-0 mt-0.5" />
          <div className="flex-1">
            <h4 className="text-sm font-medium text-amber-800">
              No Audio Data Detected
            </h4>
            <p className="text-sm text-amber-700 mt-1">{mainError}</p>

            {/* Possible causes */}
            {bulletPoints.length > 0 && (
              <div className="mt-3">
                <p className="text-xs font-medium text-amber-800 mb-1">
                  Possible causes:
                </p>
                <ul className="text-xs text-amber-700 space-y-0.5">
                  {bulletPoints.map((point, idx) => (
                    <li key={idx}>{point}</li>
                  ))}
                </ul>
              </div>
            )}

            {/* Additional context */}
            {nonBulletLines.length > 0 && (
              <div className="mt-2 text-xs text-amber-600">
                {nonBulletLines.map((line, idx) => (
                  <p key={idx}>{line.trim()}</p>
                ))}
              </div>
            )}

            {/* Quick fix suggestions */}
            <div className="mt-3 pt-3 border-t border-amber-200">
              <p className="text-xs font-medium text-amber-800 mb-2">Quick fixes to try:</p>
              <div className="grid grid-cols-1 gap-2 text-xs">
                <div className="flex items-start gap-2">
                  <span className="text-amber-600 font-medium">1.</span>
                  <span className="text-amber-700">Check that your microphone is not muted</span>
                </div>
                <div className="flex items-start gap-2">
                  <span className="text-amber-600 font-medium">2.</span>
                  <span className="text-amber-700">Go to Settings → Audio to verify the correct input device is selected</span>
                </div>
                <div className="flex items-start gap-2">
                  <span className="text-amber-600 font-medium">3.</span>
                  <span className="text-amber-700">Try selecting "System Default" as the input device</span>
                </div>
                <div className="flex items-start gap-2">
                  <span className="text-amber-600 font-medium">4.</span>
                  <span className="text-amber-700">Run audio diagnostics in Settings → Audio to test your microphone</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    )
  }

  // For setup errors, use a more prominent display with setup instructions
  if (isSetupError) {
    return (
      <div className="bg-blue-50 border-blue-200 border rounded-lg p-4 mb-4">
        <div className="flex items-start gap-3">
          <AlertCircle className="w-5 h-5 text-blue-600 flex-shrink-0 mt-0.5" />
          <div className="flex-1">
            <h4 className="text-sm font-medium text-blue-800">
              Setup Required for Live Transcription
            </h4>
            <p className="text-sm text-blue-700 mt-1">{mainError}</p>

            {/* Setup instructions section */}
            {hasSetupInstructions && (
              <div className="mt-3 bg-blue-100 rounded-md p-3">
                <p className="text-xs font-medium text-blue-800 mb-2">
                  To enable live transcription, run these commands in Terminal:
                </p>
                <div className="font-mono text-xs bg-gray-800 text-green-400 rounded p-2 overflow-x-auto">
                  {errorLines.slice(1).map((line, idx) => {
                    // Detect command lines (those starting with common commands or paths)
                    const isCommand = line.trim().startsWith('cd ') ||
                                       line.trim().startsWith('./') ||
                                       line.trim().startsWith('pip ') ||
                                       line.trim().startsWith('python')
                    if (isCommand) {
                      return (
                        <div key={idx} className="text-green-400">
                          $ {line.trim()}
                        </div>
                      )
                    }
                    // Regular instruction text
                    return (
                      <div key={idx} className="text-gray-400 text-xs mt-1">
                        {line.trim()}
                      </div>
                    )
                  })}
                </div>
                <p className="text-xs text-blue-700 mt-2">
                  After running the setup script, restart the application.
                </p>
              </div>
            )}
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className={`${isWarning ? 'bg-amber-50 border-amber-200' : 'bg-red-50 border-red-200'} border rounded-lg p-4 mb-4`}>
      <div className="flex items-start gap-3">
        <AlertCircle className={`w-5 h-5 ${isWarning ? 'text-amber-600' : 'text-red-600'} flex-shrink-0 mt-0.5`} />
        <div className="flex-1">
          <h4 className={`text-sm font-medium ${isWarning ? 'text-amber-800' : 'text-red-800'}`}>
            {isWarning ? 'Transcription Warning' : 'Transcription Error'}
          </h4>
          <p className={`text-sm ${isWarning ? 'text-amber-700' : 'text-red-700'} mt-1 whitespace-pre-wrap`}>{error.message}</p>
          {error.code && (
            <p className={`text-xs ${isWarning ? 'text-amber-600' : 'text-red-600'} mt-1`}>
              Error code: {error.code}
            </p>
          )}
          {guidance && (
            <p className={`text-xs ${isWarning ? 'text-amber-600' : 'text-red-600'} mt-2`}>
              {guidance}
            </p>
          )}
        </div>
      </div>
    </div>
  )
}

// ============================================================================
// LiveTranscriptViewer Component
// ============================================================================

// ============================================================================
// Progress Display Component
// ============================================================================

interface ProgressDisplayProps {
  progress: TranscriptionProgress
  status: LiveTranscriptStatus
}

function ProgressDisplay({ progress, status }: ProgressDisplayProps) {
  // Map phase to display label and variant
  const getPhaseConfig = (phase: string) => {
    switch (phase.toLowerCase()) {
      case 'initializing':
      case 'starting':
        return { label: 'Initializing', variant: 'default' as const }
      case 'transcribing':
      case 'active':
        return { label: 'Transcribing', variant: 'primary' as const }
      case 'processing':
        return { label: 'Processing', variant: 'warning' as const }
      case 'diarizing':
      case 'speaker_detection':
        return { label: 'Identifying Speakers', variant: 'success' as const }
      case 'complete':
      case 'done':
        return { label: 'Complete', variant: 'success' as const }
      default:
        return { label: phase, variant: 'primary' as const }
    }
  }

  const config = getPhaseConfig(progress.phase)
  const showProgress = status === 'processing' || progress.progress > 0

  if (!showProgress) return null

  return (
    <div className="mb-4 p-3 bg-muted/30 rounded-lg border border-border" data-testid="transcription-progress">
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          {status !== 'idle' && progress.progress < 100 && (
            <div className="w-2 h-2 rounded-full bg-purple-600 animate-pulse" />
          )}
          <span className="text-sm font-medium text-foreground">{config.label}</span>
        </div>
        <span className="text-sm font-semibold text-foreground">{Math.round(progress.progress)}%</span>
      </div>
      <ProgressBar
        value={progress.progress}
        variant={config.variant}
        size="sm"
        animated
      />
      {progress.message && (
        <p className="mt-2 text-xs text-muted-foreground">{progress.message}</p>
      )}
    </div>
  )
}

// ============================================================================
// LiveTranscriptViewer Component
// ============================================================================

export const LiveTranscriptViewer = memo(function LiveTranscriptViewer({
  segments,
  speakers,
  status,
  error,
  progress,
  autoScroll = true,
  recordingDuration = 0,
  className,
}: LiveTranscriptViewerProps) {
  const scrollContainerRef = useRef<HTMLDivElement>(null)
  const lastSegmentRef = useRef<HTMLDivElement>(null)

  // Get dynamic speaker names from store
  const speakerNameMap = useSpeakerNameStore((state) => state.speakers)

  // Build a map of speaker name overrides from the store
  const dynamicSpeakerNameOverrides = useMemo(() => {
    const overrides = new Map<string, string>()
    speakerNameMap.forEach((speaker, id) => {
      if (speaker.isIdentified) {
        overrides.set(id, speaker.displayName)
      }
    })
    return overrides
  }, [speakerNameMap])

  // Convert LiveTranscriptSegments to Transcript format for display
  // Use speaker field (from diarization) as speaker_id if speaker_id is not set
  const transcripts: Transcript[] = useMemo(
    () =>
      segments.map((seg) => ({
        id: seg.id,
        meeting_id: '', // Not needed for display
        speaker_id: seg.speaker_id || seg.speaker || null, // Use speaker from diarization as fallback
        content: seg.content,
        start_time_ms: seg.start_time_ms,
        end_time_ms: seg.end_time_ms,
        confidence: seg.confidence,
        is_final: seg.is_final,
        created_at: new Date().toISOString(),
      })),
    [segments]
  )

  // Build speaker color index mapping (based on order of appearance)
  const speakerColorIndex = useMemo(
    () => buildSpeakerColorIndex(transcripts),
    [transcripts]
  )

  // Group consecutive entries from the same speaker
  // Pass dynamic speaker name overrides for real-time name updates
  const groupedTranscripts = useMemo(
    () => groupTranscriptsBySpeaker(transcripts, speakers, speakerColorIndex, dynamicSpeakerNameOverrides),
    [transcripts, speakers, speakerColorIndex, dynamicSpeakerNameOverrides]
  )

  // Auto-scroll to the latest content when new segments arrive
  useEffect(() => {
    if (autoScroll && lastSegmentRef.current && (status === 'active' || status === 'processing')) {
      lastSegmentRef.current.scrollIntoView({
        behavior: 'smooth',
        block: 'end',
      })
    }
  }, [segments.length, autoScroll, status])

  // Format duration for display
  const formatDuration = (ms: number) => {
    const totalSeconds = Math.floor(ms / 1000)
    const minutes = Math.floor(totalSeconds / 60)
    const seconds = totalSeconds % 60
    return `${minutes}:${seconds.toString().padStart(2, '0')}`
  }

  return (
    <div
      className={cn('relative', className)}
      data-testid="live-transcript-viewer"
    >
      {/* Header with status */}
      <div className="flex items-center justify-between mb-4 pb-3 border-b border-border">
        <div className="flex items-center gap-3">
          <StatusBadge status={status} error={error} />
          {recordingDuration > 0 && (
            <span className="text-sm text-muted-foreground">
              {formatDuration(recordingDuration)}
            </span>
          )}
        </div>
        {segments.length > 0 && (
          <span className="text-xs text-muted-foreground">
            {segments.length} segment{segments.length !== 1 ? 's' : ''}
          </span>
        )}
      </div>

      {/* Current Speaker Badge - prominent display of who is speaking */}
      {(status === 'active' || status === 'starting') && (
        <CurrentSpeakerBadge
          isRecording={status === 'active'}
          size="md"
          variant="default"
          className="mb-4"
        />
      )}

      {/* Live Speaker Timeline - shows real-time speaker activity */}
      {segments.some(seg => seg.speaker_id || seg.speaker) && (
        <LiveSpeakerTimeline
          segments={segments}
          recordingDurationMs={recordingDuration}
          expanded={true}
          className="mb-4"
        />
      )}

      {/* Progress display */}
      {progress && <ProgressDisplay progress={progress} status={status} />}

      {/* Error display */}
      {error && <ErrorDisplay error={error} />}

      {/* Transcript content */}
      <div
        ref={scrollContainerRef}
        className="space-y-4 max-h-[60vh] overflow-y-auto"
      >
        {segments.length === 0 ? (
          <EmptyState status={status} />
        ) : (
          <>
            {groupedTranscripts.map((group, groupIndex) => (
              <div
                key={`live-group-${groupIndex}-${group.entries[0]?.id}`}
                ref={groupIndex === groupedTranscripts.length - 1 ? lastSegmentRef : undefined}
              >
                <TranscriptSegment
                  group={group}
                  // No active transcript highlighting during live mode
                  activeTranscriptId={undefined}
                  // No seek functionality during live mode
                  onSeekAudio={undefined}
                />
              </div>
            ))}

            {/* Processing indicator */}
            {status === 'processing' && (
              <div className="flex items-center justify-center py-4">
                <Loader2 className="w-5 h-5 animate-spin text-purple-600 mr-2" />
                <span className="text-sm text-muted-foreground">
                  Processing final segments...
                </span>
              </div>
            )}

            {/* Active listening indicator */}
            {status === 'active' && segments.length > 0 && (
              <div className="flex items-center gap-2 py-3 px-4 bg-green-50 rounded-lg border border-green-200">
                <div className="flex space-x-1">
                  <span className="w-2 h-2 bg-green-500 rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
                  <span className="w-2 h-2 bg-green-500 rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
                  <span className="w-2 h-2 bg-green-500 rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
                </div>
                <span className="text-sm text-green-700">Listening...</span>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
})
