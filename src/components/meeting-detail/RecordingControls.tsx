import { useState, useEffect } from 'react'
import { Mic, Square, Loader2, AlertCircle } from 'lucide-react'
import { formatDuration } from '../../lib/formatters'
import { AudioWaveform } from '../AudioWaveform'
import { useRecordingStore } from '@/stores/recording-store'

interface RecordingControlsProps {
  meetingId: string
  onRecordingSaved?: () => void
  /** Compact mode shows a smaller inline control, suitable for use alongside an audio player */
  compact?: boolean
}

type RecordingStatus = 'idle' | 'recording' | 'paused' | 'stopping'

export function RecordingControls({ meetingId, onRecordingSaved, compact = false }: RecordingControlsProps) {
  const [status, setStatus] = useState<RecordingStatus>('idle')
  const [duration, setDuration] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const [liveNotesEnabled, setLiveNotesEnabled] = useState(false)

  // Get global recording store actions to sync state
  const { audioLevel, setStatus: setGlobalStatus, setMeetingId, setStartTime, setDuration: setGlobalDuration, reset: resetGlobalStore } = useRecordingStore()

  // Load live notes setting on mount
  useEffect(() => {
    const loadLiveNotesSetting = async () => {
      try {
        const setting = await window.electronAPI.db.settings.get('ai.autoStartLiveNotes')
        if (setting !== null) {
          setLiveNotesEnabled(setting as boolean)
        }
      } catch (err) {
        console.error('Failed to load live notes setting:', err)
      }
    }
    loadLiveNotesSetting()
  }, [])

  // Handler to toggle live notes setting
  const handleLiveNotesToggle = async (enabled: boolean) => {
    setLiveNotesEnabled(enabled)
    try {
      await window.electronAPI.db.settings.set('ai.autoStartLiveNotes', enabled, 'ai')
    } catch (err) {
      console.error('Failed to save live notes setting:', err)
      // Revert on error
      setLiveNotesEnabled(!enabled)
    }
  }

  // Restore recording state from Electron on mount (fixes issue when navigating back)
  useEffect(() => {
    const restoreState = async () => {
      try {
        const electronState = await window.electronAPI.recording.getStatus()
        
        // If Electron is recording and it matches this meeting, restore state
        if ((electronState.status === 'recording' || electronState.status === 'paused') && 
            electronState.meetingId === meetingId) {
          setStatus(electronState.status)
          const durationSeconds = Math.floor(electronState.duration / 1000)
          setDuration(durationSeconds)
          
          // Sync with global store
          setGlobalStatus(electronState.status)
          setMeetingId(electronState.meetingId)
          setStartTime(electronState.startTime)
          setGlobalDuration(electronState.duration)
        } else if (electronState.status === 'idle') {
          // If Electron is idle, ensure local state is also idle
          setStatus('idle')
          setDuration(0)
        }
      } catch (err) {
        console.error('Failed to restore recording state:', err)
      }
    }

    restoreState()
  }, [meetingId, setGlobalStatus, setMeetingId, setStartTime, setGlobalDuration])

  // Poll recording status while recording
  useEffect(() => {
    if (status !== 'recording') return

    const interval = setInterval(async () => {
      try {
        const state = await window.electronAPI.recording.getStatus()
        const durationSeconds = Math.floor(state.duration / 1000)
        setDuration(durationSeconds) // Convert ms to seconds
        setGlobalDuration(state.duration) // Update global store (in ms)
      } catch (err) {
        console.error('Failed to get recording status:', err)
      }
    }, 1000)

    return () => clearInterval(interval)
  }, [status, setGlobalDuration])

  const handleStartRecording = async () => {
    setError(null)
    setStatus('recording')

    try {
      const result = await window.electronAPI.recording.start(meetingId)
      if (result.success) {
        setDuration(0)
        // Sync with global recording store so header shows indicator
        setGlobalStatus('recording')
        setMeetingId(meetingId)
        setStartTime(Date.now())
        setGlobalDuration(0)
      } else {
        throw new Error('Failed to start recording')
      }
    } catch (err) {
      console.error('Failed to start recording:', err)
      const errorMessage = err instanceof Error ? err.message : 'Failed to start recording'
      setError(errorMessage)
      setStatus('idle')
      setDuration(0)
      // Reset global store on error
      resetGlobalStore()
    }
  }

  const handleStopRecording = async () => {
    setStatus('stopping')
    setGlobalStatus('stopping')
    setError(null)

    try {
      const result = await window.electronAPI.recording.stop()

      // Check if the stop operation returned an error from the backend
      if (!result.success) {
        const backendError = (result as { error?: string }).error
        throw new Error(backendError || 'Recording failed to stop properly')
      }

      // Check if we got a valid audio file path
      if (!result.audioFilePath) {
        // Recording stopped but no file was created - this could happen if:
        // 1. Recording was already stopped (idempotent case)
        // 2. Audio file was not created due to permissions or disk space
        console.warn('Recording stopped but no audio file path returned')
        setStatus('idle')
        setDuration(0)
        resetGlobalStore()
        // Don't show error if it was just an idempotent stop (no file expected)
        if (result.duration > 0) {
          setError('Recording stopped but audio file was not saved. Please check disk space and permissions.')
        }
        return
      }

      // Get file size
      let fileSize: number | null = null
      try {
        const stats = await window.electronAPI.shell.getFileStats(result.audioFilePath)
        fileSize = stats.size
      } catch (err) {
        console.error('Failed to get file stats:', err)
        // Continue without file size
      }

      // Create recording entry in database
      try {
        const recordingInput = {
          meeting_id: meetingId,
          file_path: result.audioFilePath,
          duration_seconds: Math.floor(result.duration / 1000),
          file_size_bytes: fileSize,
          start_time: new Date(Date.now() - result.duration).toISOString(),
          end_time: new Date().toISOString()
        }

        await window.electronAPI.db.recordings.create(recordingInput)
      } catch (dbErr) {
        console.error('Failed to save recording to database:', dbErr)
        // The audio file was saved, but we couldn't save to database
        // Show a warning but don't fail completely
        setError(`Recording saved to ${result.audioFilePath} but failed to save to database. The audio file is still available.`)
      }

      // Update meeting with audio file path if it doesn't have one
      try {
        const meeting = await window.electronAPI.db.meetings.getById(meetingId)
        if (meeting && !meeting.audio_file_path) {
          await window.electronAPI.db.meetings.update(meetingId, {
            audio_file_path: result.audioFilePath
          })
        }
      } catch (updateErr) {
        console.error('Failed to update meeting with audio file path:', updateErr)
        // Non-critical error, don't show to user
      }

      // Notify parent component to refresh
      if (onRecordingSaved) {
        onRecordingSaved()
      }

      setStatus('idle')
      setDuration(0)
      // Reset global store so header hides indicator
      resetGlobalStore()
    } catch (err) {
      console.error('Failed to stop recording:', err)
      const errorMessage = err instanceof Error ? err.message : 'An unexpected error occurred while stopping the recording'
      setError(errorMessage)
      setStatus('idle')
      // Reset global store on error
      resetGlobalStore()
    }
  }

  const isRecording = status === 'recording'
  const isStopping = status === 'stopping'

  // Compact mode - inline control for use alongside audio player
  if (compact) {
    return (
      <div className="flex items-center gap-3 flex-wrap">
        {/* Error message */}
        {error && (
          <div className="flex items-center gap-2 text-red-600">
            <AlertCircle size={16} />
            <span className="text-sm">{error}</span>
          </div>
        )}

        {/* Live Notes Toggle - shown when not recording */}
        {!isRecording && !isStopping && (
          <label className="flex items-center gap-2 cursor-pointer text-xs text-muted-foreground hover:text-foreground transition-colors">
            <input
              type="checkbox"
              checked={liveNotesEnabled}
              onChange={(e) => handleLiveNotesToggle(e.target.checked)}
              className="w-3.5 h-3.5 rounded border-gray-300 text-purple-600 focus:ring-purple-500"
            />
            <span>Enable Live Notes</span>
          </label>
        )}

        {/* Recording indicator with waveform and duration */}
        {isRecording && (
          <div className="flex items-center gap-3">
            {/* Audio Waveform */}
            <AudioWaveform
              level={audioLevel}
              isAnimating={isRecording}
              barCount={20}
              className="min-w-[100px]"
            />
            {/* Timer */}
            <div className="px-2.5 py-1 bg-gray-100 dark:bg-gray-800 rounded-full text-sm font-medium text-gray-700 dark:text-gray-300 tabular-nums min-w-[52px] text-center">
              {formatDuration(duration)}
            </div>
            {/* Recording pulse indicator */}
            <div className="relative flex items-center justify-center">
              <div className="w-2 h-2 bg-red-500 rounded-full animate-pulse" />
              <div className="absolute w-2 h-2 bg-red-500 rounded-full animate-ping opacity-75" />
            </div>
          </div>
        )}

        {isStopping && (
          <div className="flex items-center gap-2 text-muted-foreground">
            <Loader2 size={16} className="animate-spin" />
            <span className="text-sm">Saving...</span>
          </div>
        )}

        {/* Control button */}
        {!isRecording && !isStopping && (
          <button
            onClick={handleStartRecording}
            className="px-4 py-2 bg-purple-600 hover:bg-purple-700 text-white rounded-lg text-sm font-medium transition-colors flex items-center gap-2"
          >
            <Mic className="w-4 h-4" />
            New Recording
          </button>
        )}

        {isRecording && (
          <button
            onClick={handleStopRecording}
            className="px-4 py-2 bg-red-600 hover:bg-red-700 text-white rounded-lg text-sm font-medium transition-colors flex items-center gap-2"
          >
            <Square className="w-4 h-4" />
            Stop
          </button>
        )}
      </div>
    )
  }

  // Full mode - standalone control with centered layout
  return (
    <div className="bg-card border border-border rounded-lg p-6 shadow-sm">
      <div className="space-y-4">
        {/* Error message */}
        {error && (
          <div className="flex items-start gap-2 p-3 bg-red-50 border border-red-200 rounded-md">
            <AlertCircle className="text-red-600 mt-0.5 flex-shrink-0" size={18} />
            <div className="flex-1">
              <p className="text-sm text-red-600 whitespace-pre-line">{error}</p>
            </div>
          </div>
        )}

        {/* Recording status */}
        <div className="text-center">
          {!isRecording && !isStopping && (
            <>
              <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-muted mb-4">
                <Mic className="w-8 h-8 text-muted-foreground" />
              </div>
              <h3 className="text-lg font-medium text-foreground mb-2">Ready to Record</h3>
              <p className="text-sm text-muted-foreground mb-6">
                Click the button below to start recording this meeting
              </p>
            </>
          )}

          {isRecording && (
            <>
              <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-red-100 mb-4 animate-pulse">
                <Mic className="w-8 h-8 text-red-600" />
              </div>
              <h3 className="text-lg font-medium text-foreground mb-2">Recording in Progress</h3>
              {/* Audio Waveform */}
              <div className="flex items-center justify-center gap-4 mb-4">
                <AudioWaveform
                  level={audioLevel}
                  isAnimating={isRecording}
                  barCount={28}
                  className="min-w-[140px]"
                />
                <div className="px-3 py-1.5 bg-gray-100 dark:bg-gray-800 rounded-full text-lg font-mono font-bold text-red-600 tabular-nums">
                  {formatDuration(duration)}
                </div>
              </div>
            </>
          )}

          {isStopping && (
            <>
              <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-muted mb-4">
                <Loader2 className="w-8 h-8 text-muted-foreground animate-spin" />
              </div>
              <h3 className="text-lg font-medium text-foreground mb-2">Saving Recording...</h3>
              <p className="text-sm text-muted-foreground mb-6">
                Please wait while we save your recording
              </p>
            </>
          )}
        </div>

        {/* Live Notes Toggle */}
        {!isRecording && !isStopping && (
          <div className="flex items-center justify-center gap-2 mb-4">
            <label className="flex items-center gap-2 cursor-pointer text-sm text-muted-foreground hover:text-foreground transition-colors">
              <input
                type="checkbox"
                checked={liveNotesEnabled}
                onChange={(e) => handleLiveNotesToggle(e.target.checked)}
                className="w-4 h-4 rounded border-gray-300 text-purple-600 focus:ring-purple-500"
              />
              <span>Enable Live Notes</span>
            </label>
            <div className="text-xs text-muted-foreground" title="Real-time AI-powered note generation during recording">
              ℹ️
            </div>
          </div>
        )}

        {/* Controls */}
        <div className="flex justify-center">
          {!isRecording && !isStopping && (
            <button
              onClick={handleStartRecording}
              className="px-6 py-3 bg-purple-600 hover:bg-purple-700 text-white rounded-lg font-medium transition-colors flex items-center gap-2"
            >
              <Mic className="w-5 h-5" />
              Start Recording
            </button>
          )}

          {isRecording && (
            <button
              onClick={handleStopRecording}
              className="px-6 py-3 bg-red-600 hover:bg-red-700 text-white rounded-lg font-medium transition-colors flex items-center gap-2"
            >
              <Square className="w-5 h-5" />
              Stop Recording
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
