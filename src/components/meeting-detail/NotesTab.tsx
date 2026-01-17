import { useState } from 'react'
import { Sparkles, FileText, CheckCircle, Lightbulb, MessageSquare, BookOpen, Edit2 } from 'lucide-react'
import type { MeetingNote, NoteType } from '../../types/database'
import { formatDateTime } from '../../lib/formatters'
import { NotesEditor } from './NotesEditor'

interface NotesTabProps {
  notes: MeetingNote[]
  onNotesUpdated?: () => void
}

const noteTypeConfig: Record<
  NoteType,
  {
    label: string
    icon: typeof FileText
    color: string
  }
> = {
  summary: {
    label: 'Summary',
    icon: BookOpen,
    color: 'blue',
  },
  key_point: {
    label: 'Key Points',
    icon: Lightbulb,
    color: 'yellow',
  },
  action_item: {
    label: 'Action Items',
    icon: CheckCircle,
    color: 'green',
  },
  decision: {
    label: 'Decisions',
    icon: CheckCircle,
    color: 'purple',
  },
  custom: {
    label: 'Other Notes',
    icon: MessageSquare,
    color: 'gray',
  },
}

/**
 * Component to display the overall meeting summary in a prominent way
 */
function OverallSummary({
  summaryNotes,
  onEditNote
}: {
  summaryNotes: MeetingNote[]
  onEditNote: (note: MeetingNote) => void
}) {
  // Find the main AI-generated summary (usually the first one)
  const mainSummary = summaryNotes.find(n => n.is_ai_generated) || summaryNotes[0]

  if (!mainSummary) return null

  return (
    <div className="mb-8">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center">
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
        <button
          onClick={() => onEditNote(mainSummary)}
          className="inline-flex items-center px-3 py-1.5 text-sm font-medium text-blue-600 bg-blue-50 border border-blue-200 rounded-md hover:bg-blue-100 transition-colors"
          aria-label="Edit summary"
        >
          <Edit2 className="w-4 h-4 mr-1.5" />
          Edit
        </button>
      </div>

      <div className="bg-gradient-to-br from-blue-50 to-indigo-50 border border-blue-200 rounded-xl p-6 shadow-sm">
        <p className="text-sm text-foreground leading-relaxed whitespace-pre-wrap">
          {mainSummary.content}
        </p>
        <div className="mt-4 pt-3 border-t border-blue-200 flex items-center justify-between">
          <span className="text-xs text-blue-600">
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

export function NotesTab({ notes, onNotesUpdated }: NotesTabProps) {
  const [editingNote, setEditingNote] = useState<MeetingNote | null>(null)
  const [isEditorOpen, setIsEditorOpen] = useState(false)

  // Handler for opening the editor
  const handleEditNote = (note: MeetingNote) => {
    setEditingNote(note)
    setIsEditorOpen(true)
  }

  // Handler for closing the editor
  const handleCloseEditor = () => {
    setIsEditorOpen(false)
    setEditingNote(null)
  }

  // Handler for successful save
  const handleSaveSuccess = () => {
    if (onNotesUpdated) {
      onNotesUpdated()
    }
  }

  // Handler for note deletion
  const handleDeleteNote = () => {
    if (onNotesUpdated) {
      onNotesUpdated()
    }
  }

  // Group notes by type
  const notesByType = notes.reduce((acc, note) => {
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

  if (notes.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-center">
        <FileText className="w-12 h-12 text-muted-foreground mb-4" />
        <h3 className="text-lg font-semibold text-foreground mb-2">No notes available</h3>
        <p className="text-sm text-muted-foreground max-w-md">
          Notes and insights from this meeting will appear here.
          Use the "Generate Summary" button above to create an AI-powered meeting summary.
        </p>
      </div>
    )
  }

  return (
    <div className="py-4">
      {/* Notes Editor Modal */}
      <NotesEditor
        isOpen={isEditorOpen}
        onClose={handleCloseEditor}
        note={editingNote}
        onSuccess={handleSaveSuccess}
        onDelete={handleDeleteNote}
      />

      {/* Display the overall summary prominently at the top */}
      {hasSummary && (
        <OverallSummary
          summaryNotes={summaryNotes}
          onEditNote={handleEditNote}
        />
      )}

      {/* Display other note types */}
      {hasOtherNotes && (
        <div className="space-y-8">
          {noteTypes.map((noteType) => {
            const notesOfType = notesByType[noteType]
            if (!notesOfType || notesOfType.length === 0) return null

            const config = noteTypeConfig[noteType]
            const Icon = config.icon

            return (
              <div key={noteType}>
                <div className="flex items-center mb-4">
                  <Icon className={`w-5 h-5 mr-2 text-${config.color}-600`} />
                  <h3 className="text-lg font-semibold text-foreground">
                    {config.label}
                  </h3>
                  <span className="ml-2 px-2 py-0.5 rounded-full text-xs font-semibold bg-muted text-muted-foreground">
                    {notesOfType.length}
                  </span>
                </div>

                <div className="space-y-3">
                  {notesOfType.map((note) => (
                    <div
                      key={note.id}
                      className="bg-card border border-border rounded-lg p-4 hover:shadow-sm transition-shadow group"
                    >
                      <div className="flex items-start justify-between mb-2">
                        <div className="flex items-center gap-2">
                          {note.is_ai_generated && (
                            <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-purple-100 text-purple-700 border border-purple-200">
                              <Sparkles className="w-3 h-3 mr-1" />
                              AI Generated
                            </span>
                          )}
                        </div>
                        <div className="flex items-center gap-2">
                          <button
                            onClick={() => handleEditNote(note)}
                            className="opacity-0 group-hover:opacity-100 inline-flex items-center px-2 py-1 text-xs font-medium text-muted-foreground bg-muted border border-border rounded hover:bg-background hover:text-foreground transition-all"
                            aria-label="Edit note"
                          >
                            <Edit2 className="w-3 h-3 mr-1" />
                            Edit
                          </button>
                          <span className="text-xs text-muted-foreground">
                            {formatDateTime(note.created_at)}
                          </span>
                        </div>
                      </div>

                      <p className="text-sm text-foreground whitespace-pre-wrap">
                        {note.content}
                      </p>

                      {note.updated_at !== note.created_at && (
                        <p className="text-xs text-muted-foreground mt-2">
                          Updated {formatDateTime(note.updated_at)}
                        </p>
                      )}
                    </div>
                  ))}
                </div>
              </div>
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
              <div
                key={note.id}
                className="bg-card border border-border rounded-lg p-4 hover:shadow-sm transition-shadow group"
              >
                <div className="flex items-start justify-between mb-2">
                  <div className="flex items-center gap-2">
                    {note.is_ai_generated && (
                      <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-purple-100 text-purple-700 border border-purple-200">
                        <Sparkles className="w-3 h-3 mr-1" />
                        AI Generated
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => handleEditNote(note)}
                      className="opacity-0 group-hover:opacity-100 inline-flex items-center px-2 py-1 text-xs font-medium text-muted-foreground bg-muted border border-border rounded hover:bg-background hover:text-foreground transition-all"
                      aria-label="Edit note"
                    >
                      <Edit2 className="w-3 h-3 mr-1" />
                      Edit
                    </button>
                    <span className="text-xs text-muted-foreground">
                      {formatDateTime(note.created_at)}
                    </span>
                  </div>
                </div>

                <p className="text-sm text-foreground whitespace-pre-wrap">
                  {note.content}
                </p>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
