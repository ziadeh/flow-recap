import { useState, useRef, useEffect } from 'react'
import {
  Users,
  Clock,
  Calendar,
  Tag,
  ChevronDown,
  ChevronUp,
  Play,
  Pause,
  Mic,
  Square,
  Loader2,
  Volume2,
  VolumeX,
  AlertCircle
} from 'lucide-react'
import { cn } from '../../lib/utils'
import { formatDuration, formatDateTime } from '../../lib/formatters'
import type { Meeting, Recording, Speaker, Transcript } from '../../types/database'
import { useRecordingActions, RecordingStatus } from '../../stores/recording-store'

// ============================================================================
// Types
// ============================================================================

interface MeetingDetailSidebarProps {
  meeting: Meeting
  recordings: Recording[]
  speakers: Map<string, Speaker>
  speakerNameOverrides: Map<string, string> // speaker_id -> display_name
  transcripts: Transcript[]
  isRecording: boolean
  recordingDuration: number
  onSpeakerFilter?: (speakerId: string | null) => void
  activeSpeakerFilter?: string | null
  onRecordingSaved?: () => void
  /** Responsive props */
  isMobile?: boolean
  isTablet?: boolean
  isDesktop?: boolean
  /** Hide the audio player in sidebar when main audio player is already shown */
  hideAudioPlayer?: boolean
}

// ============================================================================
// Helper Functions
// ============================================================================

const getMeetingTypeIcon = (meetingType: Meeting['meeting_type']) => {
  switch (meetingType) {
    case 'one-on-one':
      return '1:1'
    case 'team':
      return 'Team'
    case 'webinar':
      return 'Web'
    case 'other':
    default:
      return 'Meet'
  }
}

const getMeetingTypeLabel = (meetingType: Meeting['meeting_type']) => {
  switch (meetingType) {
    case 'one-on-one':
      return '1-on-1 Meeting'
    case 'team':
      return 'Team Meeting'
    case 'webinar':
      return 'Webinar'
    case 'other':
    default:
      return 'Meeting'
  }
}

// Speaker colors for visual distinction
const speakerColors = [
  { bg: 'bg-blue-100 dark:bg-blue-900/30', text: 'text-blue-700 dark:text-blue-300', border: 'border-blue-200 dark:border-blue-700', dot: 'bg-blue-500' },
  { bg: 'bg-green-100 dark:bg-green-900/30', text: 'text-green-700 dark:text-green-300', border: 'border-green-200 dark:border-green-700', dot: 'bg-green-500' },
  { bg: 'bg-purple-100 dark:bg-purple-900/30', text: 'text-purple-700 dark:text-purple-300', border: 'border-purple-200 dark:border-purple-700', dot: 'bg-purple-500' },
  { bg: 'bg-orange-100 dark:bg-orange-900/30', text: 'text-orange-700 dark:text-orange-300', border: 'border-orange-200 dark:border-orange-700', dot: 'bg-orange-500' },
  { bg: 'bg-pink-100 dark:bg-pink-900/30', text: 'text-pink-700 dark:text-pink-300', border: 'border-pink-200 dark:border-pink-700', dot: 'bg-pink-500' },
  { bg: 'bg-cyan-100 dark:bg-cyan-900/30', text: 'text-cyan-700 dark:text-cyan-300', border: 'border-cyan-200 dark:border-cyan-700', dot: 'bg-cyan-500' },
  { bg: 'bg-amber-100 dark:bg-amber-900/30', text: 'text-amber-700 dark:text-amber-300', border: 'border-amber-200 dark:border-amber-700', dot: 'bg-amber-500' },
  { bg: 'bg-indigo-100 dark:bg-indigo-900/30', text: 'text-indigo-700 dark:text-indigo-300', border: 'border-indigo-200 dark:border-indigo-700', dot: 'bg-indigo-500' },
]

// ============================================================================
// MetadataCard Component
// ============================================================================

interface MetadataCardProps {
  meeting: Meeting
  participantCount: number
}

function MetadataCard({ meeting, participantCount }: MetadataCardProps) {
  return (
    <div className="bg-card border border-border rounded-md p-token-lg shadow-subtle" data-testid="metadata-card">
      <div className="space-y-token-md">
        {/* Meeting Type */}
        <div className="flex items-center gap-token-sm">
          <div className="w-8 h-8 rounded-md bg-purple-100 dark:bg-purple-900/30 flex items-center justify-center">
            <span className="text-xs font-bold text-purple-700 dark:text-purple-300">
              {getMeetingTypeIcon(meeting.meeting_type)}
            </span>
          </div>
          <span className="text-sm font-medium text-foreground">
            {getMeetingTypeLabel(meeting.meeting_type)}
          </span>
        </div>

        {/* Duration - using token spacing */}
        {meeting.duration_seconds && (
          <div className="flex items-center gap-token-sm text-sm text-muted-foreground">
            <Clock className="w-4 h-4" />
            <span>{formatDuration(meeting.duration_seconds)}</span>
          </div>
        )}

        {/* Participant Count */}
        <div className="flex items-center gap-token-sm text-sm text-muted-foreground">
          <Users className="w-4 h-4" />
          <span>{participantCount} participant{participantCount !== 1 ? 's' : ''}</span>
        </div>

        {/* Scheduled Time */}
        <div className="flex items-center gap-token-sm text-sm text-muted-foreground">
          <Calendar className="w-4 h-4" />
          <span>{formatDateTime(meeting.start_time)}</span>
        </div>

        {/* Tags/Labels (placeholder for future use) */}
        <div className="flex items-center gap-token-sm">
          <Tag className="w-4 h-4 text-muted-foreground" />
          <div className="flex flex-wrap gap-1">
            <span className={cn(
              "px-token-sm py-0.5 rounded-full text-xs font-medium border",
              meeting.status === 'completed' ? 'bg-green-100 text-green-700 border-green-200 dark:bg-green-900/20 dark:text-green-400 dark:border-green-800' :
              meeting.status === 'in_progress' ? 'bg-yellow-100 text-yellow-700 border-yellow-200 dark:bg-yellow-900/20 dark:text-yellow-400 dark:border-yellow-800' :
              meeting.status === 'scheduled' ? 'bg-blue-100 text-blue-700 border-blue-200 dark:bg-blue-900/20 dark:text-blue-400 dark:border-blue-800' :
              'bg-gray-100 text-gray-700 border-gray-200 dark:bg-gray-800 dark:text-gray-400 dark:border-gray-700'
            )}>
              {meeting.status.replace('_', ' ')}
            </span>
          </div>
        </div>
      </div>
    </div>
  )
}

// ============================================================================
// RecordingPlayerCard Component
// ============================================================================

interface RecordingPlayerCardProps {
  recordings: Recording[]
  currentRecordingIndex: number
  onRecordingChange: (index: number) => void
}

function RecordingPlayerCard({ recordings, currentRecordingIndex, onRecordingChange }: RecordingPlayerCardProps) {
  const audioRef = useRef<HTMLAudioElement>(null)
  const [isPlaying, setIsPlaying] = useState(false)
  const [currentTime, setCurrentTime] = useState(0)
  const [duration, setDuration] = useState(0)
  const [playbackRate, setPlaybackRate] = useState(1)
  const [volume] = useState(1)
  const [isMuted, setIsMuted] = useState(false)
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const currentRecording = recordings[currentRecordingIndex]

  // Cache-busting key that only changes when the recording changes
  // This prevents browser from using cached version with incomplete WAV header
  // while avoiding repeated reloads on every render
  const [cacheBustKey, setCacheBustKey] = useState(() => Date.now())

  // Update cache bust key when recording changes to force fresh load
  useEffect(() => {
    if (currentRecording?.file_path) {
      setCacheBustKey(Date.now())
    }
  }, [currentRecording?.file_path])

  // Encode the file path properly for the protocol handler
  const encodeFilePath = (path: string): string => {
    if (!path) return ''
    const isWindowsPath = /^[A-Za-z]:/.test(path)
    const segments = path.split('/').map(segment => {
      if (isWindowsPath && /^[A-Za-z]:$/.test(segment)) return segment
      if (segment === '') return segment
      return encodeURIComponent(segment)
    })
    return segments.join('/')
  }

  const audioSrc = currentRecording?.file_path
    ? `local-file://${encodeFilePath(currentRecording.file_path)}?t=${cacheBustKey}`
    : ''

  // Set duration from recording metadata
  useEffect(() => {
    if (currentRecording?.duration_seconds) {
      setDuration(currentRecording.duration_seconds)
    }
  }, [currentRecording?.duration_seconds])

  // Reset state when recording changes
  useEffect(() => {
    setIsPlaying(false)
    setCurrentTime(0)
    setError(null)
    if (audioRef.current) {
      audioRef.current.load()
    }
  }, [currentRecordingIndex])

  const handlePlayPause = async () => {
    if (!audioRef.current) {
      setError('Audio player not initialized')
      return
    }

    setError(null)

    if (isPlaying) {
      audioRef.current.pause()
      setIsPlaying(false)
    } else {
      try {
        setIsLoading(true)
        if (audioRef.current.readyState < 2) {
          await new Promise<void>((resolve, reject) => {
            const timeout = setTimeout(() => reject(new Error('Audio loading timeout')), 10000)
            const onCanPlay = () => {
              clearTimeout(timeout)
              audioRef.current?.removeEventListener('canplay', onCanPlay)
              audioRef.current?.removeEventListener('error', onError)
              resolve()
            }
            const onError = () => {
              clearTimeout(timeout)
              audioRef.current?.removeEventListener('canplay', onCanPlay)
              audioRef.current?.removeEventListener('error', onError)
              reject(new Error('Audio loading error'))
            }
            audioRef.current?.addEventListener('canplay', onCanPlay)
            audioRef.current?.addEventListener('error', onError)
            if (audioRef.current && audioRef.current.readyState === 0) {
              audioRef.current.load()
            }
          })
        }
        await audioRef.current.play()
        setIsPlaying(true)
      } catch (err) {
        console.error('Error playing audio:', err)
        setError('Failed to play audio')
        setIsPlaying(false)
      } finally {
        setIsLoading(false)
      }
    }
  }

  const handleSeek = (e: React.ChangeEvent<HTMLInputElement>) => {
    const time = parseFloat(e.target.value)
    if (audioRef.current) {
      audioRef.current.currentTime = time
      setCurrentTime(time)
    }
  }

  const handlePlaybackRateChange = (rate: number) => {
    setPlaybackRate(rate)
    if (audioRef.current) {
      audioRef.current.playbackRate = rate
    }
  }

  const handleMuteToggle = () => {
    if (audioRef.current) {
      audioRef.current.muted = !isMuted
      setIsMuted(!isMuted)
    }
  }

  if (recordings.length === 0) {
    return (
      <div className="bg-card border border-border rounded-md p-token-lg shadow-subtle" data-testid="recording-player-card">
        <div className="text-center py-token-lg">
          <Mic className="w-8 h-8 mx-auto text-muted-foreground mb-token-sm" />
          <p className="text-sm text-muted-foreground">No recordings yet</p>
        </div>
      </div>
    )
  }

  const progressPercentage = duration > 0 ? (currentTime / duration) * 100 : 0

  return (
    <div className="bg-card border border-border rounded-md p-token-lg shadow-subtle max-h-[120px] overflow-hidden" data-testid="recording-player-card">
      <audio
        ref={audioRef}
        src={audioSrc}
        preload="auto"
        onTimeUpdate={() => audioRef.current && setCurrentTime(audioRef.current.currentTime)}
        onLoadedMetadata={() => {
          if (audioRef.current) {
            const audioDuration = audioRef.current.duration
            if (audioDuration && isFinite(audioDuration) && audioDuration > 0) {
              setDuration(audioDuration)
            }
          }
        }}
        onEnded={() => setIsPlaying(false)}
        onError={() => {
          setIsPlaying(false)
          setIsLoading(false)
          setError('Failed to load audio')
        }}
      />

      {/* Error display */}
      {error && (
        <div className="flex items-center gap-1 mb-token-sm text-red-600 text-xs">
          <AlertCircle className="w-3 h-3" />
          <span>{error}</span>
        </div>
      )}

      {/* Recording selector (if multiple) */}
      {recordings.length > 1 && (
        <select
          value={currentRecordingIndex}
          onChange={(e) => onRecordingChange(parseInt(e.target.value))}
          className="w-full mb-token-sm px-token-sm py-1 text-xs bg-muted border border-border rounded-md text-foreground"
          data-testid="recording-selector"
        >
          {recordings.map((rec, index) => (
            <option key={rec.id} value={index}>
              Recording {index + 1} - {formatDateTime(rec.start_time)}
            </option>
          ))}
        </select>
      )}

      {/* Progress bar */}
      <div className="mb-token-sm">
        <input
          type="range"
          min="0"
          max={duration || 0}
          step="0.1"
          value={currentTime}
          onChange={handleSeek}
          className="w-full h-1 bg-muted rounded-md appearance-none cursor-pointer accent-purple-600"
          style={{
            background: `linear-gradient(to right, rgb(147 51 234) 0%, rgb(147 51 234) ${progressPercentage}%, rgb(229 229 229) ${progressPercentage}%, rgb(229 229 229) 100%)`,
          }}
        />
        <div className="flex justify-between text-[10px] text-muted-foreground mt-0.5">
          <span>{formatDuration(currentTime)}</span>
          <span>{formatDuration(duration)}</span>
        </div>
      </div>

      {/* Controls in single row - using token spacing */}
      <div className="flex items-center gap-token-sm">
        {/* Play/Pause */}
        <button
          onClick={handlePlayPause}
          disabled={isLoading}
          className="w-7 h-7 rounded-full bg-purple-600 hover:bg-purple-700 text-white flex items-center justify-center transition-colors flex-shrink-0 disabled:opacity-50"
          title={isPlaying ? 'Pause' : 'Play'}
          data-testid="play-pause-button"
        >
          {isLoading ? (
            <Loader2 className="w-3.5 h-3.5 animate-spin" />
          ) : isPlaying ? (
            <Pause className="w-3.5 h-3.5" />
          ) : (
            <Play className="w-3.5 h-3.5 ml-0.5" />
          )}
        </button>

        {/* Speed selector */}
        <div className="flex items-center gap-0.5">
          {[0.5, 1, 1.5, 2].map((rate) => (
            <button
              key={rate}
              onClick={() => handlePlaybackRateChange(rate)}
              className={cn(
                "px-1 py-0.5 rounded text-[10px] font-medium transition-colors",
                playbackRate === rate
                  ? 'bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-300'
                  : 'text-muted-foreground hover:bg-muted'
              )}
              data-testid={`speed-${rate}x`}
            >
              {rate}x
            </button>
          ))}
        </div>

        {/* Volume */}
        <button
          onClick={handleMuteToggle}
          className="ml-auto text-muted-foreground hover:text-foreground transition-colors"
          title={isMuted ? 'Unmute' : 'Mute'}
        >
          {isMuted || volume === 0 ? (
            <VolumeX className="w-4 h-4" />
          ) : (
            <Volume2 className="w-4 h-4" />
          )}
        </button>
      </div>
    </div>
  )
}

// ============================================================================
// SpeakersListCard Component
// ============================================================================

interface SpeakersListCardProps {
  speakers: Map<string, Speaker>
  speakerNameOverrides: Map<string, string> // speaker_id -> display_name
  transcripts: Transcript[]
  onSpeakerFilter?: (speakerId: string | null) => void
  activeSpeakerFilter?: string | null
}

function SpeakersListCard({
  speakers,
  speakerNameOverrides,
  transcripts,
  onSpeakerFilter,
  activeSpeakerFilter
}: SpeakersListCardProps) {
  const [isExpanded, setIsExpanded] = useState(true)
  const COLLAPSE_THRESHOLD = 5

  // Calculate speaker participation
  const speakerParticipation = new Map<string, { count: number; percentage: number }>()
  const totalTranscripts = transcripts.filter(t => t.speaker_id).length

  transcripts.forEach(transcript => {
    if (transcript.speaker_id) {
      const current = speakerParticipation.get(transcript.speaker_id) || { count: 0, percentage: 0 }
      speakerParticipation.set(transcript.speaker_id, {
        count: current.count + 1,
        percentage: 0
      })
    }
  })

  // Calculate percentages
  speakerParticipation.forEach((value, key) => {
    speakerParticipation.set(key, {
      ...value,
      percentage: totalTranscripts > 0 ? Math.round((value.count / totalTranscripts) * 100) : 0
    })
  })

  // Get sorted list of speakers by participation
  const sortedSpeakers = Array.from(speakers.entries())
    .map(([id, speaker]) => ({
      id,
      speaker,
      participation: speakerParticipation.get(id) || { count: 0, percentage: 0 }
    }))
    .sort((a, b) => b.participation.percentage - a.participation.percentage)

  const getSpeakerName = (speakerId: string, speaker: Speaker) => {
    const override = speakerNameOverrides.get(speakerId)
    return override || speaker.name
  }

  const needsCollapsing = sortedSpeakers.length > COLLAPSE_THRESHOLD
  const displayedSpeakers = needsCollapsing && !isExpanded
    ? sortedSpeakers.slice(0, COLLAPSE_THRESHOLD)
    : sortedSpeakers

  if (speakers.size === 0) {
    return (
      <div className="bg-card border border-border rounded-md p-token-lg shadow-subtle" data-testid="speakers-list-card">
        <div className="text-center py-token-lg">
          <Users className="w-8 h-8 mx-auto text-muted-foreground mb-token-sm" />
          <p className="text-sm text-muted-foreground">No speakers identified</p>
        </div>
      </div>
    )
  }

  return (
    <div className="bg-card border border-border rounded-md p-token-lg shadow-subtle" data-testid="speakers-list-card">
      <h3 className="text-sm font-medium text-foreground mb-token-md flex items-center gap-token-sm">
        <Users className="w-4 h-4" />
        Speakers ({speakers.size})
      </h3>

      {/* Row spacing within lists = token-sm (8px) */}
      <div className="space-y-token-sm">
        {displayedSpeakers.map(({ id, speaker, participation }, index) => {
          const colorIndex = index % speakerColors.length
          const color = speakerColors[colorIndex]
          const isActive = activeSpeakerFilter === id

          return (
            <button
              key={id}
              onClick={() => onSpeakerFilter?.(isActive ? null : id)}
              className={cn(
                "w-full flex items-center gap-token-sm px-token-sm py-1.5 rounded-md transition-all text-left",
                isActive
                  ? `${color.bg} ${color.border} border`
                  : "hover:bg-muted"
              )}
              data-testid={`speaker-${id}`}
            >
              {/* Color dot */}
              <div className={cn("w-2 h-2 rounded-full flex-shrink-0", color.dot)} />

              {/* Speaker name */}
              <span className={cn(
                "text-sm truncate flex-1",
                isActive ? color.text : "text-foreground"
              )}>
                {getSpeakerName(id, speaker)}
              </span>

              {/* Participation percentage */}
              <span className={cn(
                "text-xs flex-shrink-0",
                isActive ? color.text : "text-muted-foreground"
              )}>
                {participation.percentage}%
              </span>
            </button>
          )
        })}
      </div>

      {/* Expand/Collapse button */}
      {needsCollapsing && (
        <button
          onClick={() => setIsExpanded(!isExpanded)}
          className="w-full mt-token-sm pt-token-sm border-t border-border flex items-center justify-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
          data-testid="expand-speakers-button"
        >
          {isExpanded ? (
            <>
              <ChevronUp className="w-3 h-3" />
              Show less
            </>
          ) : (
            <>
              <ChevronDown className="w-3 h-3" />
              Show {sortedSpeakers.length - COLLAPSE_THRESHOLD} more
            </>
          )}
        </button>
      )}

      {/* Clear filter button */}
      {activeSpeakerFilter && (
        <button
          onClick={() => onSpeakerFilter?.(null)}
          className="w-full mt-token-sm text-xs text-purple-600 hover:text-purple-700 dark:text-purple-400 dark:hover:text-purple-300 transition-colors"
          data-testid="clear-speaker-filter"
        >
          Clear filter
        </button>
      )}
    </div>
  )
}

// ============================================================================
// RecordingControlsCard Component
// ============================================================================

interface RecordingControlsCardProps {
  meetingId: string
  isRecording: boolean
  recordingDuration: number
  onRecordingSaved?: () => void
}

function RecordingControlsCard({
  meetingId,
  isRecording,
  recordingDuration,
  onRecordingSaved
}: RecordingControlsCardProps) {
  const [status, setStatus] = useState<RecordingStatus>('idle')
  const [error, setError] = useState<string | null>(null)
  const {
    setStatus: setGlobalStatus,
    setMeetingId,
    setStartTime,
    setDuration: setGlobalDuration,
    reset: resetGlobalStore
  } = useRecordingActions()

  // Sync local status with recording state
  useEffect(() => {
    if (isRecording) {
      setStatus('recording')
    } else {
      setStatus('idle')
    }
  }, [isRecording])

  // Format recording duration
  const formatRecordingTime = (ms: number) => {
    const totalSeconds = Math.floor(ms / 1000)
    const hours = Math.floor(totalSeconds / 3600)
    const minutes = Math.floor((totalSeconds % 3600) / 60)
    const seconds = totalSeconds % 60

    if (hours > 0) {
      return `${hours}:${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`
    }
    return `${minutes}:${seconds.toString().padStart(2, '0')}`
  }

  const handleStartRecording = async () => {
    setError(null)
    setStatus('recording')

    try {
      const result = await window.electronAPI.recording.start(meetingId)
      if (result.success) {
        setGlobalStatus('recording')
        setMeetingId(meetingId)
        setStartTime(Date.now())
        setGlobalDuration(0)
      } else {
        throw new Error('Failed to start recording')
      }
    } catch (err) {
      console.error('Failed to start recording:', err)
      setError(err instanceof Error ? err.message : 'Failed to start recording')
      setStatus('idle')
      resetGlobalStore()
    }
  }

  const handleStopRecording = async () => {
    setStatus('stopping')
    setGlobalStatus('stopping')
    setError(null)

    try {
      const result = await window.electronAPI.recording.stop()

      if (!result.success) {
        throw new Error((result as { error?: string }).error || 'Recording failed to stop properly')
      }

      if (result.audioFilePath) {
        // Get file size
        let fileSize: number | null = null
        try {
          const stats = await window.electronAPI.shell.getFileStats(result.audioFilePath)
          fileSize = stats.size
        } catch (err) {
          console.error('Failed to get file stats:', err)
        }

        // Create recording entry
        await window.electronAPI.db.recordings.create({
          meeting_id: meetingId,
          file_path: result.audioFilePath,
          duration_seconds: Math.floor(result.duration / 1000),
          file_size_bytes: fileSize,
          start_time: new Date(Date.now() - result.duration).toISOString(),
          end_time: new Date().toISOString()
        })

        // Update meeting with audio file path
        const meeting = await window.electronAPI.db.meetings.getById(meetingId)
        if (meeting && !meeting.audio_file_path) {
          await window.electronAPI.db.meetings.update(meetingId, {
            audio_file_path: result.audioFilePath
          })
        }
      }

      onRecordingSaved?.()
      setStatus('idle')
      resetGlobalStore()
    } catch (err) {
      console.error('Failed to stop recording:', err)
      setError(err instanceof Error ? err.message : 'Failed to stop recording')
      setStatus('idle')
      resetGlobalStore()
    }
  }

  const isStopping = status === 'stopping'

  return (
    <div className="bg-card border border-border rounded-md p-token-lg shadow-subtle" data-testid="recording-controls-card">
      {/* Error display */}
      {error && (
        <div className="flex items-center gap-token-sm mb-token-md p-token-sm bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-md text-red-600 dark:text-red-400 text-xs">
          <AlertCircle className="w-3 h-3 flex-shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {/* Recording in progress */}
      {isRecording && (
        <div className="mb-token-md">
          <div className="flex items-center gap-token-sm mb-token-sm">
            <div className="relative">
              <div className="w-2 h-2 bg-red-500 rounded-full animate-pulse" />
              <div className="absolute inset-0 w-2 h-2 bg-red-500 rounded-full animate-ping opacity-75" />
            </div>
            <span className="text-sm font-medium text-red-600 dark:text-red-400">Recording</span>
          </div>
          <div className="text-2xl font-mono font-bold text-foreground text-center" data-testid="recording-timer">
            {formatRecordingTime(recordingDuration)}
          </div>
        </div>
      )}

      {/* Control buttons - consistent sizing: h-10 (40px), px-3 (12px) */}
      <div className="space-y-token-sm">
        {!isRecording && !isStopping && (
          <button
            onClick={handleStartRecording}
            className="w-full h-10 px-3 bg-purple-600 hover:bg-purple-700 text-white rounded-md text-sm font-medium transition-colors flex items-center justify-center gap-token-sm"
            data-testid="new-recording-button"
          >
            <Mic className="w-4 h-4" />
            New Recording
          </button>
        )}

        {isRecording && !isStopping && (
          <button
            onClick={handleStopRecording}
            className="w-full h-10 px-3 bg-red-600 hover:bg-red-700 text-white rounded-md text-sm font-medium transition-colors flex items-center justify-center gap-token-sm"
            data-testid="stop-recording-button"
          >
            <Square className="w-4 h-4" />
            Stop Recording
          </button>
        )}

        {isStopping && (
          <div className="flex items-center justify-center gap-token-sm py-token-sm text-muted-foreground">
            <Loader2 className="w-4 h-4 animate-spin" />
            <span className="text-sm">Saving...</span>
          </div>
        )}
      </div>
    </div>
  )
}

// ============================================================================
// Main MeetingDetailSidebar Component
// ============================================================================

// ============================================================================
// Expandable Section Component for Mobile
// ============================================================================

interface ExpandableSectionProps {
  title: string
  icon: React.ReactNode
  children: React.ReactNode
  defaultExpanded?: boolean
  badge?: React.ReactNode
}

function ExpandableSection({ title, icon, children, defaultExpanded = false, badge }: ExpandableSectionProps) {
  const [isExpanded, setIsExpanded] = useState(defaultExpanded)

  return (
    <div className="expandable-section">
      <button
        onClick={() => setIsExpanded(!isExpanded)}
        className="expandable-section-header min-h-touch"
        aria-expanded={isExpanded}
      >
        <div className="flex items-center gap-token-sm">
          <span className="text-purple-600 dark:text-purple-400">{icon}</span>
          <span className="text-sm font-medium text-foreground">{title}</span>
          {badge}
        </div>
        {isExpanded ? (
          <ChevronUp className="w-4 h-4 text-muted-foreground" />
        ) : (
          <ChevronDown className="w-4 h-4 text-muted-foreground" />
        )}
      </button>
      {isExpanded && (
        <div className="expandable-section-content">
          {children}
        </div>
      )}
    </div>
  )
}

export function MeetingDetailSidebar({
  meeting,
  recordings,
  speakers,
  speakerNameOverrides,
  transcripts,
  isRecording,
  recordingDuration,
  onSpeakerFilter,
  activeSpeakerFilter,
  onRecordingSaved,
  isMobile = false,
  isTablet = false,
  isDesktop: _isDesktop = true,
  hideAudioPlayer = false
}: MeetingDetailSidebarProps) {
  // isDesktop is available for future use
  void _isDesktop
  const [currentRecordingIndex, setCurrentRecordingIndex] = useState(0)

  // Get participant count from transcripts
  const uniqueSpeakerIds = new Set(
    transcripts
      .map(t => t.speaker_id)
      .filter((id): id is string => id !== null)
  )
  const participantCount = uniqueSpeakerIds.size || 1

  // Responsive sidebar classes
  const sidebarClasses = isMobile
    ? 'w-full' // Full width on mobile
    : isTablet
      ? 'w-full' // Full width on tablet (below main content)
      : 'w-[30%] min-w-[280px] max-w-[360px] sticky top-0 h-fit flex-shrink-0' // Desktop: 30% width, sticky

  // Mobile: Collapsible sections
  if (isMobile) {
    return (
      <aside
        className={sidebarClasses}
        data-testid="meeting-detail-sidebar"
      >
        <div className="space-y-token-sm">
          {/* Metadata - Always expanded on mobile for quick info */}
          <ExpandableSection
            title="Meeting Info"
            icon={<Calendar className="w-4 h-4" />}
            defaultExpanded={true}
          >
            <MobileMetadataContent meeting={meeting} participantCount={participantCount} />
          </ExpandableSection>

          {/* Speakers - Collapsed by default on mobile */}
          {speakers.size > 0 && (
            <ExpandableSection
              title="Speakers"
              icon={<Users className="w-4 h-4" />}
              badge={
                <span className="px-token-sm py-0.5 rounded-full text-xs font-semibold bg-muted text-muted-foreground">
                  {speakers.size}
                </span>
              }
            >
              <SpeakersListCard
                speakers={speakers}
                speakerNameOverrides={speakerNameOverrides}
                transcripts={transcripts}
                onSpeakerFilter={onSpeakerFilter}
                activeSpeakerFilter={activeSpeakerFilter}
              />
            </ExpandableSection>
          )}

          {/* Recording Controls - Expanded if recording, collapsed otherwise */}
          <ExpandableSection
            title={isRecording ? 'Recording in Progress' : 'Recording'}
            icon={isRecording ? <div className="w-2 h-2 rounded-full bg-red-600 animate-pulse" /> : <Mic className="w-4 h-4" />}
            defaultExpanded={isRecording}
          >
            <RecordingControlsCard
              meetingId={meeting.id}
              isRecording={isRecording}
              recordingDuration={recordingDuration}
              onRecordingSaved={onRecordingSaved}
            />
          </ExpandableSection>
        </div>
      </aside>
    )
  }

  // Tablet: Full width, stacked cards
  if (isTablet) {
    return (
      <aside
        className={sidebarClasses}
        data-testid="meeting-detail-sidebar"
      >
        <div className="grid grid-cols-2 gap-token-md">
          {/* Left column: Metadata + Recording */}
          <div className="space-y-token-md">
            <MetadataCard
              meeting={meeting}
              participantCount={participantCount}
            />
            <RecordingControlsCard
              meetingId={meeting.id}
              isRecording={isRecording}
              recordingDuration={recordingDuration}
              onRecordingSaved={onRecordingSaved}
            />
          </div>

          {/* Right column: Players (if not hidden) + Speakers */}
          <div className="space-y-token-md">
            {/* Only show RecordingPlayerCard if main audio player is not already shown */}
            {!hideAudioPlayer && (
              <RecordingPlayerCard
                recordings={recordings}
                currentRecordingIndex={currentRecordingIndex}
                onRecordingChange={setCurrentRecordingIndex}
              />
            )}
            <SpeakersListCard
              speakers={speakers}
              speakerNameOverrides={speakerNameOverrides}
              transcripts={transcripts}
              onSpeakerFilter={onSpeakerFilter}
              activeSpeakerFilter={activeSpeakerFilter}
            />
          </div>
        </div>
      </aside>
    )
  }

  // Desktop: Original layout - 30% width sidebar
  return (
    <aside
      className={sidebarClasses}
      data-testid="meeting-detail-sidebar"
    >
      {/* Using token-md spacing (12px) between cards for compact layout */}
      <div className="space-y-token-md">
        {/* Metadata Card */}
        <MetadataCard
          meeting={meeting}
          participantCount={participantCount}
        />

        {/* Recording Player Card - only show if main audio player is not already shown */}
        {!hideAudioPlayer && (
          <RecordingPlayerCard
            recordings={recordings}
            currentRecordingIndex={currentRecordingIndex}
            onRecordingChange={setCurrentRecordingIndex}
          />
        )}

        {/* Speakers List Card */}
        <SpeakersListCard
          speakers={speakers}
          speakerNameOverrides={speakerNameOverrides}
          transcripts={transcripts}
          onSpeakerFilter={onSpeakerFilter}
          activeSpeakerFilter={activeSpeakerFilter}
        />

        {/* Recording Controls Card */}
        <RecordingControlsCard
          meetingId={meeting.id}
          isRecording={isRecording}
          recordingDuration={recordingDuration}
          onRecordingSaved={onRecordingSaved}
        />
      </div>
    </aside>
  )
}

// ============================================================================
// Mobile-specific Metadata Content (simpler display)
// ============================================================================

interface MobileMetadataContentProps {
  meeting: Meeting
  participantCount: number
}

function MobileMetadataContent({ meeting, participantCount }: MobileMetadataContentProps) {
  return (
    <div className="space-y-token-sm">
      <div className="flex items-center justify-between">
        <span className="text-xs text-muted-foreground">Type</span>
        <span className="text-sm font-medium text-foreground">{getMeetingTypeLabel(meeting.meeting_type)}</span>
      </div>
      {meeting.duration_seconds && (
        <div className="flex items-center justify-between">
          <span className="text-xs text-muted-foreground">Duration</span>
          <span className="text-sm font-medium text-foreground">{formatDuration(meeting.duration_seconds)}</span>
        </div>
      )}
      <div className="flex items-center justify-between">
        <span className="text-xs text-muted-foreground">Participants</span>
        <span className="text-sm font-medium text-foreground">{participantCount}</span>
      </div>
      <div className="flex items-center justify-between">
        <span className="text-xs text-muted-foreground">Date</span>
        <span className="text-sm font-medium text-foreground">{formatDateTime(meeting.start_time)}</span>
      </div>
      <div className="flex items-center justify-between">
        <span className="text-xs text-muted-foreground">Status</span>
        <span className={cn(
          "px-token-sm py-0.5 rounded-full text-xs font-medium border",
          meeting.status === 'completed' ? 'bg-green-100 text-green-700 border-green-200 dark:bg-green-900/20 dark:text-green-400 dark:border-green-800' :
          meeting.status === 'in_progress' ? 'bg-yellow-100 text-yellow-700 border-yellow-200 dark:bg-yellow-900/20 dark:text-yellow-400 dark:border-yellow-800' :
          meeting.status === 'scheduled' ? 'bg-blue-100 text-blue-700 border-blue-200 dark:bg-blue-900/20 dark:text-blue-400 dark:border-blue-800' :
          'bg-gray-100 text-gray-700 border-gray-200 dark:bg-gray-800 dark:text-gray-400 dark:border-gray-700'
        )}>
          {meeting.status.replace('_', ' ')}
        </span>
      </div>
    </div>
  )
}

export default MeetingDetailSidebar
