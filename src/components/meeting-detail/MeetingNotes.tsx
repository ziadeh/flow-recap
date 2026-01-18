import { Sparkles, FileText, BookOpen, CheckCircle, Lightbulb, MessageSquare, Clock } from 'lucide-react'
import type { MeetingNote, NoteType } from '../../types/database'
import { formatDateTime, cleanNoteContent } from '../../lib/formatters'

interface MeetingNotesProps {
  notes: MeetingNote[]
  /** Optional: Show only specific note types */
  filterTypes?: NoteType[]
  /** Optional: Show summary prominently at top (default: true) */
  showSummaryHeader?: boolean
}

const noteTypeConfig: Record<
  NoteType,
  {
    label: string
    pluralLabel: string
    icon: typeof FileText
    color: string
    bgColor: string
    borderColor: string
    description: string
  }
> = {
  summary: {
    label: 'Summary',
    pluralLabel: 'Summaries',
    icon: BookOpen,
    color: 'text-blue-600',
    bgColor: 'bg-blue-50',
    borderColor: 'border-blue-200',
    description: 'Overview of the meeting',
  },
  key_point: {
    label: 'Key Point',
    pluralLabel: 'Key Points',
    icon: Lightbulb,
    color: 'text-yellow-600',
    bgColor: 'bg-yellow-50',
    borderColor: 'border-yellow-200',
    description: 'Important points discussed',
  },
  action_item: {
    label: 'Action Item',
    pluralLabel: 'Action Items',
    icon: CheckCircle,
    color: 'text-green-600',
    bgColor: 'bg-green-50',
    borderColor: 'border-green-200',
    description: 'Tasks to be completed',
  },
  decision: {
    label: 'Decision',
    pluralLabel: 'Decisions',
    icon: CheckCircle,
    color: 'text-purple-600',
    bgColor: 'bg-purple-50',
    borderColor: 'border-purple-200',
    description: 'Decisions made during the meeting',
  },
  custom: {
    label: 'Note',
    pluralLabel: 'Notes',
    icon: MessageSquare,
    color: 'text-gray-600',
    bgColor: 'bg-gray-50',
    borderColor: 'border-gray-200',
    description: 'Additional notes',
  },
}

/**
 * Component to display the overall meeting summary in a prominent way
 */
function SummaryHeader({ summaryNotes }: { summaryNotes: MeetingNote[] }) {
  // Find the main AI-generated summary (usually the first one)
  const mainSummary = summaryNotes.find(n => n.is_ai_generated) || summaryNotes[0]

  if (!mainSummary) return null

  return (
    <div className="mb-8">
      <div className="flex items-center mb-4">
        <BookOpen className="w-5 h-5 mr-2 text-blue-600" />
        <h3 className="text-lg font-semibold text-foreground">
          Meeting Summary
        </h3>
        {mainSummary.is_ai_generated && (
          <span className="ml-3 inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-purple-100 text-purple-700 border border-purple-200">
            <Sparkles className="w-3 h-3 mr-1" />
            AI Generated
          </span>
        )}
      </div>

      <div className="bg-gradient-to-br from-blue-50 to-indigo-50 border border-blue-200 rounded-xl p-6 shadow-sm">
        <p className="text-sm text-foreground leading-relaxed whitespace-pre-wrap">
          {mainSummary.content}
        </p>
        <div className="mt-4 pt-3 border-t border-blue-200 flex items-center justify-between">
          <span className="text-xs text-blue-600 flex items-center">
            <Clock className="w-3 h-3 mr-1" />
            Generated {formatDateTime(mainSummary.created_at)}
          </span>
          {mainSummary.updated_at !== mainSummary.created_at && (
            <span className="text-xs text-muted-foreground">
              Updated {formatDateTime(mainSummary.updated_at)}
            </span>
          )}
        </div>
      </div>
    </div>
  )
}

/**
 * Single note card component
 */
function NoteCard({ note }: { note: MeetingNote }) {
  const config = noteTypeConfig[note.note_type]
  const Icon = config.icon

  return (
    <div
      className={`${config.bgColor} border ${config.borderColor} rounded-lg p-4 hover:shadow-sm transition-shadow`}
    >
      <div className="flex items-start justify-between mb-2">
        <div className="flex items-center gap-2">
          <Icon className={`w-4 h-4 ${config.color}`} />
          <span className={`text-xs font-medium ${config.color}`}>
            {config.label}
          </span>
          {note.is_ai_generated && (
            <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-purple-100 text-purple-700 border border-purple-200">
              <Sparkles className="w-3 h-3 mr-1" />
              AI
            </span>
          )}
        </div>
        <span className="text-xs text-muted-foreground">
          {formatDateTime(note.created_at)}
        </span>
      </div>

      <p className="text-sm text-foreground whitespace-pre-wrap leading-relaxed">
        {cleanNoteContent(note.content)}
      </p>

      {note.updated_at !== note.created_at && (
        <p className="text-xs text-muted-foreground mt-2">
          Updated {formatDateTime(note.updated_at)}
        </p>
      )}
    </div>
  )
}

/**
 * Section for a specific note type
 */
function NoteSection({ noteType, notes }: { noteType: NoteType; notes: MeetingNote[] }) {
  const config = noteTypeConfig[noteType]
  const Icon = config.icon

  if (notes.length === 0) return null

  return (
    <div className="mb-8">
      <div className="flex items-center mb-4">
        <Icon className={`w-5 h-5 mr-2 ${config.color}`} />
        <h3 className="text-lg font-semibold text-foreground">
          {config.pluralLabel}
        </h3>
        <span className="ml-2 px-2 py-0.5 rounded-full text-xs font-semibold bg-muted text-muted-foreground">
          {notes.length}
        </span>
      </div>

      <div className="space-y-3">
        {notes.map((note) => (
          <NoteCard key={note.id} note={note} />
        ))}
      </div>
    </div>
  )
}

/**
 * MeetingNotes Component
 * Displays AI-generated notes in an organized, readable format
 * with the summary prominently at the top and other note types grouped below
 */
export function MeetingNotes({
  notes,
  filterTypes,
  showSummaryHeader = true
}: MeetingNotesProps) {
  // Filter notes if filterTypes is provided
  const filteredNotes = filterTypes
    ? notes.filter(note => filterTypes.includes(note.note_type))
    : notes

  // Group notes by type
  const notesByType = filteredNotes.reduce((acc, note) => {
    if (!acc[note.note_type]) {
      acc[note.note_type] = []
    }
    acc[note.note_type].push(note)
    return acc
  }, {} as Record<NoteType, MeetingNote[]>)

  // Order for displaying note types (excluding summary which is shown separately)
  const noteTypes: NoteType[] = ['key_point', 'action_item', 'decision', 'custom']

  // Check if we have any summary notes
  const summaryNotes = notesByType['summary'] || []
  const hasSummary = summaryNotes.length > 0

  // Check if we have any other notes
  const hasOtherNotes = noteTypes.some(type => notesByType[type]?.length > 0)

  if (filteredNotes.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-center">
        <FileText className="w-12 h-12 text-muted-foreground mb-4" />
        <h3 className="text-lg font-semibold text-foreground mb-2">No notes available</h3>
        <p className="text-sm text-muted-foreground max-w-md">
          Notes and insights from this meeting will appear here.
          Use the AI extraction tools to generate summaries, key points, and more.
        </p>
      </div>
    )
  }

  return (
    <div className="py-4">
      {/* Display the overall summary prominently at the top */}
      {showSummaryHeader && hasSummary && <SummaryHeader summaryNotes={summaryNotes} />}

      {/* Display other note types */}
      {hasOtherNotes && (
        <div className="space-y-8">
          {noteTypes.map((noteType) => {
            const notesOfType = notesByType[noteType]
            if (!notesOfType || notesOfType.length === 0) return null

            return (
              <NoteSection
                key={noteType}
                noteType={noteType}
                notes={notesOfType}
              />
            )
          })}
        </div>
      )}

      {/* Show additional summaries if there are multiple (uncommon) */}
      {summaryNotes.length > 1 && (
        <div className="mt-8">
          <div className="flex items-center mb-4">
            <FileText className="w-5 h-5 mr-2 text-blue-600" />
            <h3 className="text-lg font-semibold text-foreground">
              Additional Summaries
            </h3>
            <span className="ml-2 px-2 py-0.5 rounded-full text-xs font-semibold bg-muted text-muted-foreground">
              {summaryNotes.length - 1}
            </span>
          </div>

          <div className="space-y-3">
            {summaryNotes.slice(1).map((note) => (
              <NoteCard key={note.id} note={note} />
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

export default MeetingNotes
