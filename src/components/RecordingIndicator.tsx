/**
 * RecordingIndicator Component
 *
 * Displays recording status in the header with an audio waveform visualizer
 * and elapsed time counter during active recording sessions.
 */

import { useEffect, useState } from 'react'
import { cn } from '@/lib/utils'
import { AudioWaveform } from './AudioWaveform'
import {
  useRecordingStatus,
  useRecordingStartTime,
  useAudioLevel,
} from '@/stores/recording-store'

interface RecordingIndicatorProps {
  className?: string
}

export function RecordingIndicator({ className }: RecordingIndicatorProps) {
  const status = useRecordingStatus()
  const startTime = useRecordingStartTime()
  const audioLevel = useAudioLevel()
  const [elapsedTime, setElapsedTime] = useState(0)

  const isRecording = status === 'recording' || status === 'paused'

  // Update elapsed time every second
  useEffect(() => {
    if (!isRecording || !startTime) {
      setElapsedTime(0)
      return
    }

    // Calculate initial elapsed time
    setElapsedTime(Math.floor((Date.now() - startTime) / 1000))

    const intervalId = setInterval(() => {
      if (status === 'recording') {
        setElapsedTime(Math.floor((Date.now() - startTime) / 1000))
      }
    }, 1000)

    return () => clearInterval(intervalId)
  }, [isRecording, startTime, status])

  // Format elapsed time as MM:SS
  const formatTime = (seconds: number): string => {
    const mins = Math.floor(seconds / 60)
    const secs = seconds % 60
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`
  }

  if (!isRecording) {
    return null
  }

  return (
    <div
      className={cn(
        'flex items-center gap-4 transition-all duration-300',
        className
      )}
    >
      {/* Audio Waveform Visualizer */}
      <AudioWaveform
        level={audioLevel}
        isAnimating={status === 'recording'}
        barCount={28}
        className="min-w-[140px]"
      />

      {/* Elapsed Time Counter */}
      <div className="flex items-center">
        <div className="px-3 py-1.5 bg-gray-100 dark:bg-gray-800 rounded-full text-sm font-medium text-gray-700 dark:text-gray-300 tabular-nums min-w-[60px] text-center">
          {formatTime(elapsedTime)}
        </div>
      </div>

      {/* Recording indicator dot - subtle pulsing */}
      {status === 'recording' && (
        <div className="relative flex items-center justify-center">
          <div className="w-2 h-2 bg-red-500 rounded-full animate-pulse" />
          <div className="absolute w-2 h-2 bg-red-500 rounded-full animate-ping opacity-75" />
        </div>
      )}

      {/* Paused indicator */}
      {status === 'paused' && (
        <div className="px-2 py-0.5 bg-yellow-100 dark:bg-yellow-900/30 text-yellow-700 dark:text-yellow-400 text-xs font-medium rounded">
          Paused
        </div>
      )}
    </div>
  )
}
