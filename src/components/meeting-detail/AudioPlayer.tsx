import { useState, useRef, useEffect } from 'react'
import { Play, Pause, Volume2, VolumeX, Volume1, AlertCircle, Loader2, Download, ChevronDown, HardDrive } from 'lucide-react'
import { formatDuration, formatFileSize } from '../../lib/formatters'
import { RecordingControls } from './RecordingControls'
import type { Recording } from '../../types/database'

interface AudioPlayerProps {
  audioFilePath: string | null
  meetingId: string
  lastRecording?: Recording | null
  /** All recordings for the meeting - enables recording selector dropdown */
  recordings?: Recording[]
  /** Called when user selects a different recording */
  onRecordingSelect?: (recording: Recording) => void
  onTimeUpdate?: (currentTime: number) => void
  onSeek?: (time: number) => void
  onRecordingSaved?: () => void
}

// Helper to get user-friendly error message
function getPlaybackErrorMessage(error: unknown, audioElement: HTMLAudioElement | null): string {
  // Check audio element error
  if (audioElement?.error) {
    const mediaError = audioElement.error
    switch (mediaError.code) {
      case MediaError.MEDIA_ERR_ABORTED:
        return 'Playback was aborted. Please try playing again.'
      case MediaError.MEDIA_ERR_NETWORK:
        return 'Unable to load audio file. The file may have been moved or deleted. Please check if the file exists.'
      case MediaError.MEDIA_ERR_DECODE:
        return 'Audio file is corrupted or in an unsupported format. Please try recording again or check the file.'
      case MediaError.MEDIA_ERR_SRC_NOT_SUPPORTED:
        return 'Audio file not found or format not supported. Please verify the file exists and is a valid audio file.'
      default:
        return mediaError.message || 'Unknown playback error. Please check the console for details.'
    }
  }

  // Check error message
  if (error instanceof Error) {
    if (error.message.includes('timeout')) {
      return 'Audio loading timed out. The file may be too large or inaccessible. Please try again.'
    }
    if (error.message.includes('NotAllowedError') || error.message.includes('play()')) {
      return 'Playback requires user interaction. Please click the play button again.'
    }
    if (error.message.includes('loading')) {
      return 'Audio file failed to load. The file may be missing or corrupted.'
    }
    return error.message || 'Failed to play audio. Please check the console for details.'
  }

  return 'Failed to play audio. Please check the console for details.'
}

// Playback speed options
const PLAYBACK_SPEEDS = [
  { value: 1, label: '1x' },
  { value: 1.25, label: '1.25x' },
  { value: 1.5, label: '1.5x' },
  { value: 2, label: '2x' },
]

export function AudioPlayer({ audioFilePath, meetingId, lastRecording, recordings, onRecordingSelect, onTimeUpdate, onSeek, onRecordingSaved }: AudioPlayerProps) {
  const audioRef = useRef<HTMLAudioElement>(null)
  const [isPlaying, setIsPlaying] = useState(false)
  const [currentTime, setCurrentTime] = useState(0)
  const [duration, setDuration] = useState(0)
  const [volume, setVolume] = useState(1)
  const [isMuted, setIsMuted] = useState(false)
  const [playbackRate, setPlaybackRate] = useState(1)
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [isSpeedDropdownOpen, setIsSpeedDropdownOpen] = useState(false)
  const [isVolumeExpanded, setIsVolumeExpanded] = useState(false)
  const [isRecordingDropdownOpen, setIsRecordingDropdownOpen] = useState(false)

  // Cache-busting key that only changes when audioFilePath changes
  // This prevents browser from using cached version with incomplete WAV header
  const [cacheBustKey, setCacheBustKey] = useState(() => Date.now())

  // Update cache bust key when audioFilePath changes to force fresh load
  useEffect(() => {
    if (audioFilePath) {
      setCacheBustKey(Date.now())
    }
  }, [audioFilePath])

  // Handle external seek requests
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

      // Store the seek handler on the ref so it can be called externally
      // This is a workaround - in a real app you might use a more sophisticated pattern
      ;(audioRef.current as any).seekTo = handleExternalSeek
    }
  }, [onSeek, isPlaying])

  // Propagate time updates to parent
  useEffect(() => {
    if (onTimeUpdate) {
      onTimeUpdate(currentTime)
    }
  }, [currentTime, onTimeUpdate])

  const handlePlayPause = async () => {
    if (!audioRef.current) {
      console.error('Audio element not available')
      setError('Audio player not initialized')
      return
    }

    // Clear any previous error when attempting to play
    setError(null)

    if (isPlaying) {
      audioRef.current.pause()
      setIsPlaying(false)
    } else {
      try {
        console.log('Attempting to play audio:', audioFilePath)
        setIsLoading(true)
        // Ensure audio is loaded before playing
        if (audioRef.current.readyState < 2) {
          console.log('Audio not ready, waiting for load...')
          // If not loaded, wait for it to load
          await new Promise<void>((resolve, reject) => {
            const timeout = setTimeout(() => {
              reject(new Error('Audio loading timeout'))
            }, 10000) // Increased timeout to 10 seconds

            const onCanPlay = () => {
              clearTimeout(timeout)
              audioRef.current?.removeEventListener('canplay', onCanPlay)
              audioRef.current?.removeEventListener('error', onError)
              console.log('Audio ready to play')
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

            // Trigger load if not already loading
            if (audioRef.current && audioRef.current.readyState === 0) {
              audioRef.current.load()
            }
          })
        }

        await audioRef.current.play()
        setIsPlaying(true)
        setIsLoading(false)
        console.log('Audio playing successfully')
      } catch (err) {
        const audioElement = audioRef.current
        console.error('[AudioPlayer] Error playing audio:', err)
        console.error('[AudioPlayer] Audio element state:', {
          readyState: audioElement?.readyState,
          src: audioElement?.src,
          error: audioElement?.error,
          errorCode: audioElement?.error?.code,
          errorMessage: audioElement?.error?.message,
          networkState: audioElement?.networkState,
          audioFilePath: audioFilePath,
          audioSrc: audioSrc
        })
        
        // Check if it's a NotAllowedError (user interaction required)
        if (err instanceof Error && err.name === 'NotAllowedError') {
          console.warn('[AudioPlayer] Playback blocked - may need user interaction')
        }
        
        // Reset playing state if playback fails
        setIsPlaying(false)
        setIsLoading(false)
        // Set user-friendly error message
        const errorMessage = getPlaybackErrorMessage(err, audioElement)
        setError(errorMessage)
      }
    }
  }

  const handleTimeUpdate = () => {
    if (audioRef.current) {
      setCurrentTime(audioRef.current.currentTime)
    }
  }

  const handleLoadedMetadata = () => {
    if (audioRef.current) {
      const audioDuration = audioRef.current.duration
      // Use audio element duration if valid, otherwise fall back to recording metadata
      if (audioDuration && isFinite(audioDuration) && audioDuration > 0) {
        setDuration(audioDuration)
      } else if (lastRecording?.duration_seconds !== null && lastRecording?.duration_seconds !== undefined) {
        setDuration(lastRecording.duration_seconds)
      }
    }
  }

  // Set duration from recording metadata if available when component mounts or recording changes
  useEffect(() => {
    if (lastRecording?.duration_seconds !== null && lastRecording?.duration_seconds !== undefined) {
      // Only set if we don't have a valid duration from the audio element yet
      if (duration === 0 || !isFinite(duration)) {
        setDuration(lastRecording.duration_seconds)
      }
    }
  }, [lastRecording?.duration_seconds])

  // Ensure audio loads when source changes
  useEffect(() => {
    if (audioRef.current && audioFilePath) {
      // Clear any previous errors
      setError(null)
      setIsPlaying(false)
      setIsLoading(false)
      setCurrentTime(0)
      
      // Force reload if source changed
      // Use a small delay to ensure the src attribute is set first
      const timer = setTimeout(() => {
        if (audioRef.current) {
          console.log('[AudioPlayer] Reloading audio for new source:', audioFilePath)
          audioRef.current.load()
        }
      }, 100)
      
      return () => clearTimeout(timer)
    }
  }, [audioFilePath])

  const handleSeek = (e: React.ChangeEvent<HTMLInputElement>) => {
    const time = parseFloat(e.target.value)
    if (audioRef.current) {
      audioRef.current.currentTime = time
      setCurrentTime(time)
    }
  }

  const handleVolumeChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const vol = parseFloat(e.target.value)
    setVolume(vol)
    if (audioRef.current) {
      audioRef.current.volume = vol
    }
    if (vol > 0) {
      setIsMuted(false)
    }
  }

  const handleMuteToggle = () => {
    if (audioRef.current) {
      audioRef.current.muted = !isMuted
      setIsMuted(!isMuted)
    }
  }

  const handlePlaybackRateChange = (rate: number) => {
    setPlaybackRate(rate)
    if (audioRef.current) {
      audioRef.current.playbackRate = rate
    }
  }

  // If no audio file, show full recording controls
  if (!audioFilePath) {
    return <RecordingControls meetingId={meetingId} onRecordingSaved={onRecordingSaved} />
  }

  const progressPercentage = duration > 0 ? (currentTime / duration) * 100 : 0

  // Encode the file path properly for the protocol handler
  // Split by path separator, encode each segment, then rejoin
  const encodeFilePath = (path: string): string => {
    if (!path) {
      console.warn('[AudioPlayer] Empty file path provided')
      return ''
    }

    // For Windows paths, preserve the drive letter format (C:)
    const isWindowsPath = /^[A-Za-z]:/.test(path)

    // Split path into segments and encode each part
    const segments = path.split('/').map(segment => {
      // Don't encode the Windows drive letter with colon
      if (isWindowsPath && /^[A-Za-z]:$/.test(segment)) {
        return segment
      }
      // Don't encode empty segments (from leading/trailing slashes)
      if (segment === '') {
        return segment
      }
      // Encode the segment
      return encodeURIComponent(segment)
    })

    // Rejoin with forward slashes
    const encodedPath = segments.join('/')

    console.log('[AudioPlayer] Encoding file path:', { original: path, encoded: encodedPath })
    return encodedPath
  }

  // Add cache-busting timestamp to force reload of freshly finalized WAV files
  // This prevents browser from using cached version with incomplete WAV header
  // which causes the looping issue where only the first ~40 seconds play repeatedly
  // Using stable cacheBustKey that only changes when audioFilePath changes
  const audioSrc = audioFilePath
    ? `local-file://${encodeFilePath(audioFilePath)}?t=${cacheBustKey}`
    : ''
  
  // Log audio source for debugging
  useEffect(() => {
    if (audioFilePath) {
      console.log('[AudioPlayer] Audio source URL:', audioSrc)
      console.log('[AudioPlayer] Original file path:', audioFilePath)
    }
  }, [audioFilePath, audioSrc])

  // Handle download - open file location in system file explorer
  const handleDownload = () => {
    if (audioFilePath) {
      window.electronAPI?.shell?.openPath(audioFilePath)
    }
  }

  // Close dropdowns when clicking outside
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      const target = e.target as HTMLElement
      if (!target.closest('[data-speed-dropdown]')) {
        setIsSpeedDropdownOpen(false)
      }
      if (!target.closest('[data-recording-dropdown]')) {
        setIsRecordingDropdownOpen(false)
      }
    }
    document.addEventListener('click', handleClickOutside)
    return () => document.removeEventListener('click', handleClickOutside)
  }, [])

  // Get the format from the file extension
  const getFileFormat = (path: string): string => {
    const ext = path.split('.').pop()?.toUpperCase() || 'AUDIO'
    return ext
  }

  // Get a short label for recording in dropdown
  const getRecordingLabel = (recording: Recording, index: number): string => {
    const date = new Date(recording.start_time)
    return `Recording ${index + 1} - ${date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`
  }

  // If audio file exists, show compact player with 3-row layout
  // Total height: ~120-140px (header 32px + progress 40px + controls 40px + padding)
  return (
    <div className="space-y-3">
      {/* Compact Audio Player Card */}
      <div className="bg-muted/30 border border-border rounded-lg shadow-sm overflow-hidden" data-testid="audio-player">
        {/* Hidden audio element */}
        <audio
          ref={audioRef}
          src={audioSrc}
          preload="auto"
          onTimeUpdate={handleTimeUpdate}
          onLoadedMetadata={handleLoadedMetadata}
          onLoadedData={handleLoadedMetadata}
          onCanPlay={() => {
            if (audioRef.current && duration === 0) {
              const audioDuration = audioRef.current.duration
              if (audioDuration && isFinite(audioDuration) && audioDuration > 0) {
                setDuration(audioDuration)
              } else if (lastRecording?.duration_seconds !== null && lastRecording?.duration_seconds !== undefined) {
                setDuration(lastRecording.duration_seconds)
              }
            }
          }}
          onEnded={() => setIsPlaying(false)}
          onError={(e) => {
            const audioElement = audioRef.current
            const mediaError = audioElement?.error

            console.error('[AudioPlayer] Audio error event:', e)
            console.error('[AudioPlayer] Audio error details:', {
              error: mediaError,
              errorCode: mediaError?.code,
              errorMessage: mediaError?.message,
              src: audioElement?.src,
              readyState: audioElement?.readyState,
              networkState: audioElement?.networkState,
              audioFilePath: audioFilePath,
              audioSrc: audioSrc
            })

            if (mediaError) {
              switch (mediaError.code) {
                case MediaError.MEDIA_ERR_ABORTED:
                  console.error('[AudioPlayer] Media error: Playback was aborted')
                  break
                case MediaError.MEDIA_ERR_NETWORK:
                  console.error('[AudioPlayer] Media error: Network error - file may not be accessible')
                  break
                case MediaError.MEDIA_ERR_DECODE:
                  console.error('[AudioPlayer] Media error: Decode error - file may be corrupted or unsupported format')
                  break
                case MediaError.MEDIA_ERR_SRC_NOT_SUPPORTED:
                  console.error('[AudioPlayer] Media error: Source not supported - check file path and format')
                  break
                default:
                  console.error('[AudioPlayer] Media error: Unknown error code', mediaError.code)
              }
            }

            setIsPlaying(false)
            setIsLoading(false)
            const errorMessage = getPlaybackErrorMessage(null, audioElement)
            setError(errorMessage)
            if (lastRecording?.duration_seconds !== null && lastRecording?.duration_seconds !== undefined && duration === 0) {
              setDuration(lastRecording.duration_seconds)
            }
          }}
        />

        {/* Error display - compact */}
        {error && (
          <div className="flex items-center gap-2 px-3 py-2 bg-red-50 dark:bg-red-900/20 border-b border-red-200 dark:border-red-800 text-red-700 dark:text-red-400 text-xs">
            <AlertCircle className="w-3.5 h-3.5 flex-shrink-0" />
            <span className="flex-1 truncate">{error}</span>
            <button
              onClick={() => setError(null)}
              className="text-red-500 hover:text-red-700 font-medium text-xs"
            >
              ×
            </button>
          </div>
        )}

        {/* Row 1: Header (32px) - Recording selector + file info badge */}
        <div className="flex items-center justify-between px-3 h-8 border-b border-border/50">
          {/* Recording selector dropdown (if multiple recordings) */}
          {recordings && recordings.length > 1 ? (
            <div className="relative" data-recording-dropdown>
              <button
                onClick={() => setIsRecordingDropdownOpen(!isRecordingDropdownOpen)}
                className="flex items-center gap-1.5 text-xs font-medium text-foreground hover:text-purple-600 transition-colors min-h-[28px]"
                data-testid="recording-selector"
              >
                <span className="truncate max-w-[140px]">
                  {lastRecording ? getRecordingLabel(lastRecording, recordings.findIndex(r => r.id === lastRecording.id)) : 'Select Recording'}
                </span>
                <ChevronDown className={`w-3.5 h-3.5 transition-transform ${isRecordingDropdownOpen ? 'rotate-180' : ''}`} />
              </button>

              {isRecordingDropdownOpen && (
                <div className="absolute top-full left-0 mt-1 z-20 bg-card border border-border rounded-md shadow-lg min-w-[180px] py-1">
                  {recordings.map((recording, index) => (
                    <button
                      key={recording.id}
                      onClick={() => {
                        onRecordingSelect?.(recording)
                        setIsRecordingDropdownOpen(false)
                      }}
                      className={`w-full px-3 py-1.5 text-left text-xs hover:bg-muted transition-colors ${
                        recording.id === lastRecording?.id ? 'bg-purple-50 dark:bg-purple-900/20 text-purple-700 dark:text-purple-400' : 'text-foreground'
                      }`}
                    >
                      {getRecordingLabel(recording, index)}
                    </button>
                  ))}
                </div>
              )}
            </div>
          ) : (
            <span className="text-xs font-medium text-foreground">Recording</span>
          )}

          {/* File info badge */}
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            {lastRecording?.file_size_bytes && (
              <span className="flex items-center gap-1">
                <HardDrive className="w-3 h-3" />
                {formatFileSize(lastRecording.file_size_bytes)}
              </span>
            )}
            {audioFilePath && (
              <span className="px-1.5 py-0.5 bg-muted rounded text-[10px] font-medium uppercase">
                {getFileFormat(audioFilePath)}
              </span>
            )}
          </div>
        </div>

        {/* Row 2: Progress bar (40px) - time elapsed, seekable progress, total duration */}
        <div className="flex items-center gap-2 px-3 h-10">
          <span className="text-xs font-mono text-muted-foreground w-10 text-right tabular-nums" data-testid="current-time">
            {formatDuration(currentTime)}
          </span>

          <div className="flex-1 relative">
            <input
              type="range"
              min="0"
              max={duration || 0}
              step="0.1"
              value={currentTime}
              onChange={handleSeek}
              className="w-full h-1.5 bg-muted rounded-full appearance-none cursor-pointer"
              style={{
                background: `linear-gradient(to right, rgb(147 51 234) 0%, rgb(147 51 234) ${progressPercentage}%, hsl(var(--muted)) ${progressPercentage}%, hsl(var(--muted)) 100%)`,
              }}
              data-testid="progress-bar"
            />
          </div>

          <span className="text-xs font-mono text-muted-foreground w-10 tabular-nums" data-testid="total-duration">
            {formatDuration(duration)}
          </span>
        </div>

        {/* Row 3: Controls (40px) - play/pause, speed dropdown, volume, download */}
        <div className="flex items-center gap-2 px-3 h-10 border-t border-border/50">
          {/* Play/Pause button (36px touch target) */}
          <button
            onClick={handlePlayPause}
            disabled={isLoading}
            className="w-9 h-9 rounded-full bg-purple-600 hover:bg-purple-700 text-white flex items-center justify-center transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex-shrink-0"
            title={isLoading ? 'Loading audio...' : isPlaying ? 'Pause' : 'Play'}
            data-testid="play-pause-button"
          >
            {isLoading ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : isPlaying ? (
              <Pause className="w-4 h-4" />
            ) : (
              <Play className="w-4 h-4 ml-0.5" />
            )}
          </button>

          {/* Speed selector dropdown (80px width) */}
          <div className="relative" data-speed-dropdown>
            <button
              onClick={() => setIsSpeedDropdownOpen(!isSpeedDropdownOpen)}
              className="flex items-center justify-between w-[72px] h-8 px-2 text-xs font-medium bg-muted/50 hover:bg-muted rounded transition-colors"
              data-testid="speed-selector"
            >
              <span>{playbackRate}x</span>
              <ChevronDown className={`w-3.5 h-3.5 transition-transform ${isSpeedDropdownOpen ? 'rotate-180' : ''}`} />
            </button>

            {isSpeedDropdownOpen && (
              <div className="absolute bottom-full left-0 mb-1 z-20 bg-card border border-border rounded-md shadow-lg min-w-[72px] py-1">
                {PLAYBACK_SPEEDS.map(({ value, label }) => (
                  <button
                    key={value}
                    onClick={() => {
                      handlePlaybackRateChange(value)
                      setIsSpeedDropdownOpen(false)
                    }}
                    className={`w-full px-2 py-1.5 text-left text-xs hover:bg-muted transition-colors ${
                      playbackRate === value ? 'bg-purple-50 dark:bg-purple-900/20 text-purple-700 dark:text-purple-400' : 'text-foreground'
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Spacer */}
          <div className="flex-1" />

          {/* Collapsible Volume control (60px when expanded) */}
          <div className="flex items-center gap-1">
            <button
              onClick={() => {
                if (isVolumeExpanded) {
                  handleMuteToggle()
                } else {
                  setIsVolumeExpanded(true)
                }
              }}
              onDoubleClick={() => setIsVolumeExpanded(!isVolumeExpanded)}
              className="w-8 h-8 flex items-center justify-center text-muted-foreground hover:text-foreground transition-colors rounded hover:bg-muted/50"
              title={isVolumeExpanded ? (isMuted ? 'Unmute' : 'Mute') : 'Click to expand volume, double-click to toggle'}
              data-testid="volume-button"
            >
              {isMuted || volume === 0 ? (
                <VolumeX className="w-4 h-4" />
              ) : volume < 0.5 ? (
                <Volume1 className="w-4 h-4" />
              ) : (
                <Volume2 className="w-4 h-4" />
              )}
            </button>

            {isVolumeExpanded && (
              <input
                type="range"
                min="0"
                max="1"
                step="0.01"
                value={isMuted ? 0 : volume}
                onChange={handleVolumeChange}
                className="w-[52px] h-1 bg-muted rounded-full appearance-none cursor-pointer accent-purple-600"
                onBlur={() => setIsVolumeExpanded(false)}
                data-testid="volume-slider"
              />
            )}
          </div>

          {/* Download button (icon only) */}
          <button
            onClick={handleDownload}
            className="w-8 h-8 flex items-center justify-center text-muted-foreground hover:text-foreground transition-colors rounded hover:bg-muted/50"
            title="Open file location"
            data-testid="download-button"
          >
            <Download className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Compact Recording Controls - for adding additional recordings */}
      <div className="bg-muted/20 border border-border rounded-lg px-3 py-2 flex items-center justify-between">
        <span className="text-xs text-muted-foreground">Add recording</span>
        <RecordingControls meetingId={meetingId} onRecordingSaved={onRecordingSaved} compact />
      </div>
    </div>
  )
}
