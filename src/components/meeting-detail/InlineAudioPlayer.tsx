import { useState, useRef, useEffect } from 'react'
import { Play, Pause, Volume2, VolumeX, Loader2, AlertCircle } from 'lucide-react'
import { formatDuration } from '../../lib/formatters'

interface InlineAudioPlayerProps {
  audioFilePath: string
  durationSeconds?: number | null
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

export function InlineAudioPlayer({ audioFilePath, durationSeconds }: InlineAudioPlayerProps) {
  const audioRef = useRef<HTMLAudioElement>(null)
  const [isPlaying, setIsPlaying] = useState(false)
  const [currentTime, setCurrentTime] = useState(0)
  const [duration, setDuration] = useState(durationSeconds || 0)
  const [volume, setVolume] = useState(1)
  const [isMuted, setIsMuted] = useState(false)
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Set duration from prop if available when component mounts or prop changes
  useEffect(() => {
    if (durationSeconds !== null && durationSeconds !== undefined && durationSeconds > 0) {
      // Only set if we don't have a valid duration from the audio element yet
      if (duration === 0 || !isFinite(duration)) {
        setDuration(durationSeconds)
      }
    }
  }, [durationSeconds])

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
          console.log('[InlineAudioPlayer] Reloading audio for new source:', audioFilePath)
          audioRef.current.load()
        }
      }, 100)
      
      return () => clearTimeout(timer)
    }
  }, [audioFilePath])

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
        console.error('[InlineAudioPlayer] Error playing audio:', err)
        console.error('[InlineAudioPlayer] Audio element state:', {
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
          console.warn('[InlineAudioPlayer] Playback blocked - may need user interaction')
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
      // Use audio element duration if valid, otherwise fall back to prop
      if (audioDuration && isFinite(audioDuration) && audioDuration > 0) {
        setDuration(audioDuration)
      } else if (durationSeconds !== null && durationSeconds !== undefined && durationSeconds > 0) {
        setDuration(durationSeconds)
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

  const progressPercentage = duration > 0 ? (currentTime / duration) * 100 : 0

  // Encode the file path properly for the protocol handler
  // Split by path separator, encode each segment, then rejoin
  const encodeFilePath = (path: string): string => {
    if (!path) {
      console.warn('[InlineAudioPlayer] Empty file path provided')
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

    console.log('[InlineAudioPlayer] Encoding file path:', { original: path, encoded: encodedPath })
    return encodedPath
  }

  const audioSrc = `local-file://${encodeFilePath(audioFilePath)}`

  // Log the audio source for debugging
  useEffect(() => {
    console.log('[InlineAudioPlayer] Audio source URL:', audioSrc)
    console.log('[InlineAudioPlayer] Original file path:', audioFilePath)
  }, [audioFilePath, audioSrc])

  return (
    <div className="bg-muted/50 rounded-lg p-3 mt-3">
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
            } else if (durationSeconds !== null && durationSeconds !== undefined && durationSeconds > 0) {
              setDuration(durationSeconds)
            }
          }
        }}
        onEnded={() => setIsPlaying(false)}
        onError={(e) => {
          const audioElement = audioRef.current
          const mediaError = audioElement?.error
          
          console.error('[InlineAudioPlayer] Audio error event:', e)
          console.error('[InlineAudioPlayer] Audio error details:', {
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
                console.error('[InlineAudioPlayer] Media error: Playback was aborted')
                break
              case MediaError.MEDIA_ERR_NETWORK:
                console.error('[InlineAudioPlayer] Media error: Network error - file may not be accessible')
                break
              case MediaError.MEDIA_ERR_DECODE:
                console.error('[InlineAudioPlayer] Media error: Decode error - file may be corrupted or unsupported format')
                break
              case MediaError.MEDIA_ERR_SRC_NOT_SUPPORTED:
                console.error('[InlineAudioPlayer] Media error: Source not supported - check file path and format')
                break
              default:
                console.error('[InlineAudioPlayer] Media error: Unknown error code', mediaError.code)
            }
          }
          
          setIsPlaying(false)
          setIsLoading(false)
          // Set error message for display
          const errorMessage = getPlaybackErrorMessage(null, audioElement)
          setError(errorMessage)
          // Try to use prop duration as fallback on error
          if (durationSeconds !== null && durationSeconds !== undefined && durationSeconds > 0 && duration === 0) {
            setDuration(durationSeconds)
          }
        }}
      />

      {/* Error display */}
      {error && (
        <div className="flex items-center gap-2 p-2 mb-2 bg-red-50 border border-red-200 rounded-md text-red-700 text-sm">
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

      <div className="space-y-3">
        {/* Progress bar */}
        <div className="space-y-1">
          <input
            type="range"
            min="0"
            max={duration || 0}
            step="0.1"
            value={currentTime}
            onChange={handleSeek}
            className="w-full h-1.5 bg-background rounded-lg appearance-none cursor-pointer accent-purple-600"
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
        <div className="flex items-center gap-3">
          {/* Play/Pause button */}
          <button
            onClick={handlePlayPause}
            disabled={isLoading}
            className="w-8 h-8 rounded-full bg-purple-600 hover:bg-purple-700 text-white flex items-center justify-center transition-colors flex-shrink-0 disabled:opacity-50 disabled:cursor-not-allowed"
            title={isLoading ? 'Loading audio...' : isPlaying ? 'Pause' : 'Play'}
          >
            {isLoading ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : isPlaying ? (
              <Pause className="w-4 h-4" />
            ) : (
              <Play className="w-4 h-4 ml-0.5" />
            )}
          </button>

          {/* Volume control */}
          <div className="flex items-center gap-2 ml-auto">
            <button
              onClick={handleMuteToggle}
              className="text-muted-foreground hover:text-foreground transition-colors"
            >
              {isMuted || volume === 0 ? (
                <VolumeX className="w-4 h-4" />
              ) : (
                <Volume2 className="w-4 h-4" />
              )}
            </button>
            <input
              type="range"
              min="0"
              max="1"
              step="0.01"
              value={isMuted ? 0 : volume}
              onChange={handleVolumeChange}
              className="w-16 h-1.5 bg-background rounded-lg appearance-none cursor-pointer accent-purple-600"
            />
          </div>
        </div>
      </div>
    </div>
  )
}
