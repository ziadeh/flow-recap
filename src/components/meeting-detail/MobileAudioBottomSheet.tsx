/**
 * MobileAudioBottomSheet Component
 *
 * A mobile-specific audio player that appears as a bottom sheet
 * with swipe gestures for expand/collapse functionality.
 *
 * Features:
 * - Fixed position at bottom of screen
 * - Swipe up to expand, swipe down to collapse
 * - Touch-friendly controls (min 44px tap targets)
 * - Compact collapsed state showing play/pause and progress
 * - Expanded state with full controls
 */

import { useState, useRef, useEffect, useCallback } from 'react'
import {
  Play,
  Pause,
  Volume2,
  VolumeX,
  AlertCircle,
  Loader2,
  ChevronUp,
  ChevronDown,
  Mic
} from 'lucide-react'
import { formatDuration } from '../../lib/formatters'
import type { Recording } from '../../types/database'

interface MobileAudioBottomSheetProps {
  audioFilePath: string | null
  meetingId: string
  lastRecording?: Recording | null
  recordings?: Recording[]
  onRecordingSelect?: (recording: Recording) => void
  onTimeUpdate?: (currentTime: number) => void
  onSeek?: (time: number) => void
  onRecordingSaved?: () => void
}

// Playback speed options
const PLAYBACK_SPEEDS = [1, 1.25, 1.5, 2]

export function MobileAudioBottomSheet({
  audioFilePath,
  meetingId: _meetingId,
  lastRecording,
  recordings,
  onRecordingSelect,
  onTimeUpdate,
  onSeek,
  onRecordingSaved: _onRecordingSaved
}: MobileAudioBottomSheetProps) {
  // meetingId and onRecordingSaved are available for future use (e.g., recording controls)
  void _meetingId
  void _onRecordingSaved
  const audioRef = useRef<HTMLAudioElement>(null)
  const [isExpanded, setIsExpanded] = useState(false)
  const [isPlaying, setIsPlaying] = useState(false)
  const [currentTime, setCurrentTime] = useState(0)
  const [duration, setDuration] = useState(0)
  const [volume, setVolume] = useState(1)
  const [isMuted, setIsMuted] = useState(false)
  const [playbackRate, setPlaybackRate] = useState(1)
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Touch gesture handling
  const touchStartY = useRef<number>(0)
  const touchDeltaY = useRef<number>(0)

  // Cache-busting key
  const [cacheBustKey, setCacheBustKey] = useState(() => Date.now())

  // Update cache bust key when audioFilePath changes
  useEffect(() => {
    if (audioFilePath) {
      setCacheBustKey(Date.now())
    }
  }, [audioFilePath])

  // Encode file path
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

  const audioSrc = audioFilePath
    ? `local-file://${encodeFilePath(audioFilePath)}?t=${cacheBustKey}`
    : ''

  // Set duration from recording metadata
  useEffect(() => {
    if (lastRecording?.duration_seconds) {
      setDuration(lastRecording.duration_seconds)
    }
  }, [lastRecording?.duration_seconds])

  // Handle external seek
  useEffect(() => {
    if (onSeek && audioRef.current) {
      const handleExternalSeek = (time: number) => {
        if (audioRef.current) {
          audioRef.current.currentTime = time
          if (!isPlaying) {
            audioRef.current.play()
            setIsPlaying(true)
          }
        }
      }
      ;(audioRef.current as any).seekTo = handleExternalSeek
    }
  }, [onSeek, isPlaying])

  // Propagate time updates
  useEffect(() => {
    if (onTimeUpdate) {
      onTimeUpdate(currentTime)
    }
  }, [currentTime, onTimeUpdate])

  // Touch gesture handlers
  const handleTouchStart = useCallback((e: React.TouchEvent) => {
    touchStartY.current = e.touches[0].clientY
    touchDeltaY.current = 0
  }, [])

  const handleTouchMove = useCallback((e: React.TouchEvent) => {
    touchDeltaY.current = touchStartY.current - e.touches[0].clientY
  }, [])

  const handleTouchEnd = useCallback(() => {
    // Swipe up (positive delta) expands, swipe down (negative delta) collapses
    if (touchDeltaY.current > 50) {
      setIsExpanded(true)
    } else if (touchDeltaY.current < -50) {
      setIsExpanded(false)
    }
    touchDeltaY.current = 0
  }, [])

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
        setIsPlaying(false)
        setError('Failed to play audio')
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

  // If no audio file, show minimal recording prompt
  if (!audioFilePath) {
    return (
      <div className="bottom-sheet collapsed">
        <div className="bottom-sheet-handle-area" onClick={() => setIsExpanded(!isExpanded)}>
          <div className="bottom-sheet-handle" />
        </div>
        <div className="px-4 pb-4 flex items-center justify-center gap-3">
          <Mic className="w-5 h-5 text-muted-foreground" />
          <span className="text-sm text-muted-foreground">No recording available</span>
        </div>
      </div>
    )
  }

  const progressPercentage = duration > 0 ? (currentTime / duration) * 100 : 0

  return (
    <div
      className={`bottom-sheet ${isExpanded ? '' : 'collapsed'}`}
      onTouchStart={handleTouchStart}
      onTouchMove={handleTouchMove}
      onTouchEnd={handleTouchEnd}
      data-testid="mobile-audio-bottom-sheet"
    >
      {/* Hidden audio element */}
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
          if (lastRecording?.duration_seconds && duration === 0) {
            setDuration(lastRecording.duration_seconds)
          }
        }}
      />

      {/* Handle area for swipe */}
      <div
        className="bottom-sheet-handle-area"
        onClick={() => setIsExpanded(!isExpanded)}
        data-testid="bottom-sheet-handle"
      >
        <div className="bottom-sheet-handle" />
      </div>

      {/* Error display */}
      {error && (
        <div className="flex items-center gap-2 px-4 py-2 bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-400 text-xs">
          <AlertCircle className="w-3.5 h-3.5 flex-shrink-0" />
          <span className="flex-1">{error}</span>
          <button onClick={() => setError(null)} className="font-medium">×</button>
        </div>
      )}

      {/* Collapsed view - minimal controls */}
      <div className={`px-4 ${isExpanded ? 'pb-2' : 'pb-4'}`}>
        <div className="flex items-center gap-3">
          {/* Play/Pause button - touch friendly */}
          <button
            onClick={handlePlayPause}
            disabled={isLoading}
            className="w-11 h-11 rounded-full bg-purple-600 hover:bg-purple-700 text-white flex items-center justify-center transition-colors disabled:opacity-50 flex-shrink-0"
            data-testid="mobile-play-pause"
          >
            {isLoading ? (
              <Loader2 className="w-5 h-5 animate-spin" />
            ) : isPlaying ? (
              <Pause className="w-5 h-5" />
            ) : (
              <Play className="w-5 h-5 ml-0.5" />
            )}
          </button>

          {/* Progress section */}
          <div className="flex-1 min-w-0">
            {/* Progress bar */}
            <input
              type="range"
              min="0"
              max={duration || 0}
              step="0.1"
              value={currentTime}
              onChange={handleSeek}
              className="w-full h-2 bg-muted rounded-full appearance-none cursor-pointer"
              style={{
                background: `linear-gradient(to right, rgb(147 51 234) 0%, rgb(147 51 234) ${progressPercentage}%, hsl(var(--muted)) ${progressPercentage}%, hsl(var(--muted)) 100%)`,
              }}
              data-testid="mobile-progress-bar"
            />
            {/* Time display */}
            <div className="flex justify-between text-xs text-muted-foreground mt-1">
              <span>{formatDuration(currentTime)}</span>
              <span>{formatDuration(duration)}</span>
            </div>
          </div>

          {/* Expand/Collapse toggle */}
          <button
            onClick={() => setIsExpanded(!isExpanded)}
            className="w-11 h-11 flex items-center justify-center text-muted-foreground hover:text-foreground rounded-full hover:bg-muted transition-colors"
            data-testid="expand-toggle"
          >
            {isExpanded ? (
              <ChevronDown className="w-5 h-5" />
            ) : (
              <ChevronUp className="w-5 h-5" />
            )}
          </button>
        </div>
      </div>

      {/* Expanded view - additional controls */}
      {isExpanded && (
        <div className="px-4 pb-4 pt-2 border-t border-border space-y-4">
          {/* Playback speed */}
          <div className="flex items-center justify-between">
            <span className="text-sm text-muted-foreground">Speed</span>
            <div className="flex items-center gap-1">
              {PLAYBACK_SPEEDS.map((rate) => (
                <button
                  key={rate}
                  onClick={() => handlePlaybackRateChange(rate)}
                  className={`px-3 py-1.5 rounded-md text-sm font-medium transition-colors min-w-touch ${
                    playbackRate === rate
                      ? 'bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-300'
                      : 'bg-muted text-muted-foreground hover:bg-muted/80'
                  }`}
                  data-testid={`mobile-speed-${rate}x`}
                >
                  {rate}x
                </button>
              ))}
            </div>
          </div>

          {/* Volume control */}
          <div className="flex items-center justify-between gap-4">
            <span className="text-sm text-muted-foreground">Volume</span>
            <div className="flex items-center gap-2 flex-1 max-w-[200px]">
              <button
                onClick={handleMuteToggle}
                className="w-11 h-11 flex items-center justify-center text-muted-foreground hover:text-foreground rounded-full hover:bg-muted transition-colors"
                data-testid="mobile-mute"
              >
                {isMuted || volume === 0 ? (
                  <VolumeX className="w-5 h-5" />
                ) : (
                  <Volume2 className="w-5 h-5" />
                )}
              </button>
              <input
                type="range"
                min="0"
                max="1"
                step="0.01"
                value={isMuted ? 0 : volume}
                onChange={(e) => {
                  const vol = parseFloat(e.target.value)
                  setVolume(vol)
                  if (audioRef.current) {
                    audioRef.current.volume = vol
                  }
                  if (vol > 0) setIsMuted(false)
                }}
                className="flex-1 h-2 bg-muted rounded-full appearance-none cursor-pointer accent-purple-600"
                data-testid="mobile-volume-slider"
              />
            </div>
          </div>

          {/* Recording selector (if multiple) */}
          {recordings && recordings.length > 1 && (
            <div className="space-y-2">
              <span className="text-sm text-muted-foreground">Recording</span>
              <div className="flex flex-col gap-1">
                {recordings.map((recording, index) => (
                  <button
                    key={recording.id}
                    onClick={() => onRecordingSelect?.(recording)}
                    className={`w-full px-3 py-2 text-left text-sm rounded-md transition-colors min-h-touch ${
                      recording.id === lastRecording?.id
                        ? 'bg-purple-50 dark:bg-purple-900/20 text-purple-700 dark:text-purple-400'
                        : 'hover:bg-muted text-foreground'
                    }`}
                    data-testid={`mobile-recording-${index}`}
                  >
                    Recording {index + 1} - {new Date(recording.start_time).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

export default MobileAudioBottomSheet
