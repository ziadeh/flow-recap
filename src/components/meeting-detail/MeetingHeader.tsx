import { Calendar, Clock, Users, Edit2, UserCog } from 'lucide-react'
import type { Meeting, Speaker, Transcript } from '../../types/database'
import { formatDateTime, formatDuration } from '../../lib/formatters'

interface MeetingHeaderProps {
  meeting: Meeting
  transcripts: Transcript[]
  speakers: Map<string, Speaker>
  onEdit?: () => void
  onManageSpeakers?: () => void
}

export function MeetingHeader({ meeting, transcripts, speakers, onEdit, onManageSpeakers }: MeetingHeaderProps) {
  // Get unique speakers from transcripts
  const uniqueSpeakerIds = new Set(
    transcripts
      .map(t => t.speaker_id)
      .filter((id): id is string => id !== null)
  )
  const meetingSpeakers = Array.from(uniqueSpeakerIds)
    .map(id => speakers.get(id))
    .filter((s): s is Speaker => s !== undefined)

  // Status badge styling
  const getStatusStyle = (status: Meeting['status']) => {
    switch (status) {
      case 'completed':
        return 'bg-green-100 text-green-700 border-green-200'
      case 'in_progress':
        return 'bg-yellow-100 text-yellow-700 border-yellow-200'
      case 'scheduled':
        return 'bg-blue-100 text-blue-700 border-blue-200'
      case 'cancelled':
        return 'bg-gray-100 text-gray-700 border-gray-200'
      default:
        return 'bg-gray-100 text-gray-700 border-gray-200'
    }
  }

  const getStatusLabel = (status: Meeting['status']) => {
    return status.replace('_', ' ').replace(/\b\w/g, l => l.toUpperCase())
  }

  return (
    <div className="bg-card border border-border rounded-lg p-6 shadow-sm">
      <div className="flex items-start justify-between mb-4">
        <div className="flex-1">
          <h1 className="text-2xl font-bold text-foreground mb-2">{meeting.title}</h1>
          {meeting.description && (
            <p className="text-muted-foreground">{meeting.description}</p>
          )}
        </div>
        <div className="flex items-center gap-3">
          {onEdit && (
            <button
              onClick={onEdit}
              className="px-3 py-1.5 text-sm font-medium text-foreground bg-background border border-border rounded-md hover:bg-muted transition-colors flex items-center gap-2"
              title="Edit meeting details"
            >
              <Edit2 size={16} />
              Edit
            </button>
          )}
          <span
            className={`px-3 py-1 rounded-full text-sm font-medium border ${getStatusStyle(
              meeting.status
            )}`}
          >
            {getStatusLabel(meeting.status)}
          </span>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mt-4">
        {/* Date/Time */}
        <div className="flex items-center text-sm text-muted-foreground">
          <Calendar className="w-4 h-4 mr-2" />
          <span>{formatDateTime(meeting.start_time)}</span>
        </div>

        {/* Duration */}
        {meeting.duration_seconds !== null && (
          <div className="flex items-center text-sm text-muted-foreground">
            <Clock className="w-4 h-4 mr-2" />
            <span>{formatDuration(meeting.duration_seconds)}</span>
          </div>
        )}

        {/* Speakers */}
        {meetingSpeakers.length > 0 && (
          <div className="flex items-center text-sm text-muted-foreground">
            <Users className="w-4 h-4 mr-2" />
            <span className="truncate max-w-xs" title={meetingSpeakers.map(s => s.name).join(', ')}>
              {meetingSpeakers.map(s => s.name).join(', ')}
            </span>
            {onManageSpeakers && (
              <button
                onClick={onManageSpeakers}
                className="ml-2 p-1 hover:bg-muted rounded-md transition-colors"
                title="Manage speakers"
                aria-label="Manage speakers"
              >
                <UserCog className="w-4 h-4 text-muted-foreground hover:text-foreground" />
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
