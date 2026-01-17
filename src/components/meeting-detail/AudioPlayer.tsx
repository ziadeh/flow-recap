import { useState, useRef, useEffect } from 'react'
import { Play, Pause, Volume2, VolumeX, Clock, HardDrive, AlertCircle, Loader2 } from 'lucide-react'
import { formatDuration, formatDateTime, formatFileSize } from '../../lib/formatters'
import { RecordingControls } from './RecordingControls'
import type { Recording } from '../../types/database'

interface AudioPlayerProps {
  audioFilePath: string | null
  meetingId: string
  lastRecording?: Recording | null
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

export function AudioPlayer({ audioFilePath, meetingId, lastRecording, onTimeUpdate, onSeek, onRecordingSaved }: AudioPlayerProps) {
  const audioRef = useRef<HTMLAudioElement>(null)
  const [isPlaying, setIsPlaying] = useState(false)
  const [currentTime, setCurrentTime] = useState(0)
  const [duration, setDuration] = useState(0)
  const [volume, setVolume] = useState(1)
  const [isMuted, setIsMuted] = useState(false)
  const [playbackRate, setPlaybackRate] = useState(1)
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

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

  // If audio file exists, show player with compact recording controls for additional recordings
  return (
    <div className="space-y-4">
      {/* Recording Metadata */}
      {lastRecording && (
        <div className="bg-card border border-border rounded-lg p-4 shadow-sm">
          <div className="flex flex-wrap gap-4 text-sm">
            <div className="flex items-center gap-2 text-muted-foreground">
              <Clock className="w-4 h-4" />
              <span className="font-medium">Recorded:</span>
              <span>{formatDateTime(lastRecording.start_time)}</span>
            </div>
            {lastRecording.duration_seconds !== null && (
              <div className="flex items-center gap-2 text-muted-foreground">
                <Clock className="w-4 h-4" />
                <span className="font-medium">Duration:</span>
                <span>{formatDuration(lastRecording.duration_seconds)}</span>
              </div>
            )}
            {lastRecording.file_size_bytes !== null && (
              <div className="flex items-center gap-2 text-muted-foreground">
                <HardDrive className="w-4 h-4" />
                <span className="font-medium">Size:</span>
                <span>{formatFileSize(lastRecording.file_size_bytes)}</span>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Audio Player */}
      <div className="bg-card border border-border rounded-lg p-4 shadow-sm">
        <audio
          ref={audioRef}
          src={audioSrc}
          preload="auto"
          onTimeUpdate={handleTimeUpdate}
          onLoadedMetadata={handleLoadedMetadata}
          onLoadedData={handleLoadedMetadata}
          onCanPlay={() => {
            // Ensure duration is set when audio can play
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
            
            // Log specific error codes for debugging
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
            // Set error message for display
            const errorMessage = getPlaybackErrorMessage(null, audioElement)
            setError(errorMessage)
            // Try to use recording duration as fallback on error
            if (lastRecording?.duration_seconds !== null && lastRecording?.duration_seconds !== undefined && duration === 0) {
              setDuration(lastRecording.duration_seconds)
            }
          }}
        />

        {/* Error display */}
        {error && (
          <div className="flex items-center gap-2 p-3 mb-4 bg-red-50 border border-red-200 rounded-md text-red-700 text-sm">
            <AlertCircle className="w-4 h-4 flex-shrink-0" />
            <span className="flex-1">{error}</span>
            <button
              onClick={() => setError(null)}
              className="text-red-500 hover:text-red-700 font-medium"
            >
              Dismiss
            </button>
          </div>
        )}

        <div className="space-y-4">
          {/* Progress bar */}
          <div className="space-y-2">
            <input
              type="range"
              min="0"
              max={duration || 0}
              step="0.1"
              value={currentTime}
              onChange={handleSeek}
              className="w-full h-2 bg-muted rounded-lg appearance-none cursor-pointer accent-purple-600"
              style={{
                background: `linear-gradient(to right, rgb(147 51 234) 0%, rgb(147 51 234) ${progressPercentage}%, rgb(229 229 229) ${progressPercentage}%, rgb(229 229 229) 100%)`,
              }}
            />
            <div className="flex justify-between text-xs text-muted-foreground">
              <span>{formatDuration(currentTime)}</span>
              <span>{formatDuration(duration)}</span>
            </div>
          </div>

          {/* Controls */}
          <div className="flex items-center gap-4">
            {/* Play/Pause button */}
            <button
              onClick={handlePlayPause}
              disabled={isLoading}
              className="w-10 h-10 rounded-full bg-purple-600 hover:bg-purple-700 text-white flex items-center justify-center transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              title={isLoading ? 'Loading audio...' : isPlaying ? 'Pause' : 'Play'}
            >
              {isLoading ? (
                <Loader2 className="w-5 h-5 animate-spin" />
              ) : isPlaying ? (
                <Pause className="w-5 h-5" />
              ) : (
                <Play className="w-5 h-5 ml-0.5" />
              )}
            </button>

            {/* Playback speed */}
            <div className="flex items-center gap-1">
              {[0.5, 1, 1.5, 2].map((rate) => (
                <button
                  key={rate}
                  onClick={() => handlePlaybackRateChange(rate)}
                  className={`
                    px-2 py-1 rounded text-xs font-medium transition-colors
                    ${
                      playbackRate === rate
                        ? 'bg-purple-100 text-purple-700'
                        : 'text-muted-foreground hover:bg-muted'
                    }
                  `}
                >
                  {rate}x
                </button>
              ))}
            </div>

            {/* Volume control */}
            <div className="flex items-center gap-2 ml-auto">
              <button
                onClick={handleMuteToggle}
                className="text-muted-foreground hover:text-foreground transition-colors"
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
                onChange={handleVolumeChange}
                className="w-20 h-2 bg-muted rounded-lg appearance-none cursor-pointer accent-purple-600"
              />
            </div>
          </div>
        </div>
      </div>

      {/* Recording Controls - always available for additional recordings */}
      <div className="bg-card border border-border rounded-lg px-4 py-3 shadow-sm flex items-center justify-between">
        <span className="text-sm text-muted-foreground">
          Add another recording to this meeting
        </span>
        <RecordingControls meetingId={meetingId} onRecordingSaved={onRecordingSaved} compact />
      </div>
    </div>
  )
}
