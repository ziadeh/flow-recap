/**
 * RecordButton Component
 *
 * Button component for starting, stopping, and pausing recordings
 */

import { Mic, Square, Pause, Play } from 'lucide-react'
import { cn } from '@/lib/utils'
import { RecordingStatus } from '@/stores/recording-store'

interface RecordButtonProps {
  status: RecordingStatus
  onStart: () => void | Promise<void>
  onStop: () => void | Promise<void>
  onPause: () => void | Promise<void>
  onResume: () => void | Promise<void>
  disabled?: boolean
  className?: string
}

export function RecordButton({
  status,
  onStart,
  onStop,
  onPause,
  onResume,
  disabled = false,
  className
}: RecordButtonProps) {
  const handleClick = async () => {
    if (disabled) return

    switch (status) {
      case 'idle':
        await onStart()
        break
      case 'recording':
        await onPause()
        break
      case 'paused':
        await onResume()
        break
      case 'stopping':
        // Do nothing while stopping
        break
    }
  }

  const getButtonContent = () => {
    switch (status) {
      case 'idle':
        return (
          <>
            <Mic className="h-5 w-5" />
            <span>Start Recording</span>
          </>
        )
      case 'recording':
        return (
          <>
            <Pause className="h-5 w-5" />
            <span>Pause</span>
          </>
        )
      case 'paused':
        return (
          <>
            <Play className="h-5 w-5" />
            <span>Resume</span>
          </>
        )
      case 'stopping':
        return (
          <>
            <Square className="h-5 w-5 animate-pulse" />
            <span>Stopping...</span>
          </>
        )
    }
  }

  const getButtonStyles = () => {
    switch (status) {
      case 'idle':
        return 'bg-purple-600 hover:bg-purple-700 text-white'
      case 'recording':
        return 'bg-orange-600 hover:bg-orange-700 text-white'
      case 'paused':
        return 'bg-blue-600 hover:bg-blue-700 text-white'
      case 'stopping':
        return 'bg-gray-400 text-white cursor-not-allowed'
    }
  }

  return (
    <div className="flex items-center gap-2">
      <button
        onClick={handleClick}
        disabled={disabled || status === 'stopping'}
        className={cn(
          'flex items-center gap-2 px-4 py-2 rounded-md text-sm font-medium transition-colors',
          'focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-purple-500',
          getButtonStyles(),
          disabled && 'opacity-50 cursor-not-allowed',
          className
        )}
      >
        {getButtonContent()}
      </button>
      {(status === 'recording' || status === 'paused') && (
        <button
          onClick={onStop}
          disabled={disabled}
          className={cn(
            'flex items-center gap-2 px-4 py-2 rounded-md text-sm font-medium transition-colors',
            'bg-red-600 hover:bg-red-700 text-white',
            'focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-red-500',
            disabled && 'opacity-50 cursor-not-allowed'
          )}
        >
          <Square className="h-5 w-5" />
          <span>Stop</span>
        </button>
      )}
    </div>
  )
}
