import { useState } from 'react'
import { Trash2, Download, Clock, HardDrive, Loader2 } from 'lucide-react'
import type { Recording } from '../../types/database'
import { formatDateTime, formatDuration, formatFileSize } from '../../lib/formatters'
import { InlineAudioPlayer } from './InlineAudioPlayer'

interface RecordingsTabProps {
  recordings: Recording[]
  onDelete: (recordingId: string) => Promise<void>
}

export function RecordingsTab({ recordings, onDelete }: RecordingsTabProps) {
  const [deletingId, setDeletingId] = useState<string | null>(null)

  const handleDelete = async (recording: Recording) => {
    if (!window.confirm(`Are you sure you want to delete this recording?\n\nRecorded on: ${formatDateTime(recording.start_time)}\n\nThis action cannot be undone.`)) {
      return
    }

    setDeletingId(recording.id)
    try {
      await onDelete(recording.id)
    } catch (error) {
      console.error('Failed to delete recording:', error)
      alert('Failed to delete recording. Please try again.')
    } finally {
      setDeletingId(null)
    }
  }

  const handleDownload = (recording: Recording) => {
    // Open the file location in the system file explorer
    window.electronAPI.shell?.openPath(recording.file_path)
  }

  if (recordings.length === 0) {
    return (
      <div className="text-center py-12">
        <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-muted mb-4">
          <Clock className="w-8 h-8 text-muted-foreground" />
        </div>
        <h3 className="text-lg font-medium text-foreground mb-2">No recordings yet</h3>
        <p className="text-muted-foreground max-w-sm mx-auto">
          Recordings created during this meeting will appear here.
        </p>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-sm font-medium text-muted-foreground">
          {recordings.length} {recordings.length === 1 ? 'Recording' : 'Recordings'}
        </h3>
      </div>

      <div className="space-y-3">
        {recordings.map((recording) => {
          const isDeleting = deletingId === recording.id

          return (
            <div
              key={recording.id}
              className="bg-background border border-border rounded-lg p-4 hover:border-purple-300 transition-colors"
            >
              <div className="flex items-start justify-between gap-4">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-2">
                    <Clock className="w-4 h-4 text-muted-foreground flex-shrink-0" />
                    <p className="text-sm font-medium text-foreground">
                      {formatDateTime(recording.start_time)}
                    </p>
                  </div>

                  <div className="flex flex-wrap gap-4 text-xs text-muted-foreground">
                    {recording.duration_seconds !== null && (
                      <div className="flex items-center gap-1">
                        <Clock className="w-3 h-3" />
                        <span>Duration: {formatDuration(recording.duration_seconds)}</span>
                      </div>
                    )}
                    {recording.file_size_bytes !== null && (
                      <div className="flex items-center gap-1">
                        <HardDrive className="w-3 h-3" />
                        <span>Size: {formatFileSize(recording.file_size_bytes)}</span>
                      </div>
                    )}
                  </div>

                  <p className="mt-2 text-xs text-muted-foreground font-mono truncate">
                    {recording.file_path}
                  </p>

                  {/* Inline Audio Player */}
                  <InlineAudioPlayer 
                    audioFilePath={recording.file_path} 
                    durationSeconds={recording.duration_seconds}
                  />
                </div>

                <div className="flex items-center gap-2 flex-shrink-0 self-start">
                  <button
                    onClick={() => handleDownload(recording)}
                    className="p-2 text-muted-foreground hover:text-foreground hover:bg-muted rounded-md transition-colors"
                    title="Open file location"
                  >
                    <Download className="w-4 h-4" />
                  </button>
                  <button
                    onClick={() => handleDelete(recording)}
                    disabled={isDeleting}
                    className="p-2 text-muted-foreground hover:text-red-600 hover:bg-red-50 rounded-md transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                    title="Delete recording"
                  >
                    {isDeleting ? (
                      <Loader2 className="w-4 h-4 animate-spin" />
                    ) : (
                      <Trash2 className="w-4 h-4" />
                    )}
                  </button>
                </div>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
