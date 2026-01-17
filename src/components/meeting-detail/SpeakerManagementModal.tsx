/**
 * SpeakerManagementModal Component
 * Allows users to rename speakers (e.g., Speaker_0 → 'John Doe')
 * Changes are applied only to the current meeting - other meetings keep the original speaker names
 */

import React, { useState, useEffect, useRef } from 'react'
import { Modal } from '../Modal'
import { Loader2, AlertCircle, Check, Edit2, X, Users } from 'lucide-react'
import { isDiarizationSpeaker, getSpeakerColor, getSpeakerInitials } from '../transcript/transcript-utils'
import type { Speaker, Transcript } from '../../types/database'

// ============================================================================
// Types
// ============================================================================

interface SpeakerManagementModalProps {
  isOpen: boolean
  onClose: () => void
  meetingId: string
  speakers: Map<string, Speaker>
  speakerNameOverrides: Map<string, string>  // speaker_id -> display_name for this meeting
  transcripts: Transcript[]
  onSuccess?: () => void
}

interface SpeakerWithStats {
  speaker: Speaker
  displayName: string  // The name to show (either override or global)
  hasOverride: boolean  // Whether this speaker has a meeting-specific name
  segmentCount: number
  colorIndex: number
}

// ============================================================================
// SpeakerRow Component
// ============================================================================

interface SpeakerRowProps {
  speakerWithStats: SpeakerWithStats
  onRename: (speakerId: string, newName: string) => Promise<void>
  isRenaming: boolean
}

function SpeakerRow({ speakerWithStats, onRename, isRenaming }: SpeakerRowProps) {
  const { speaker, displayName, hasOverride, segmentCount, colorIndex } = speakerWithStats
  const [isEditing, setIsEditing] = useState(false)
  const [editName, setEditName] = useState(displayName)
  const [error, setError] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  const isAutoDetected = isDiarizationSpeaker(speaker.name)
  const colors = getSpeakerColor(displayName, colorIndex)
  const initials = getSpeakerInitials(displayName)

  // Focus input when editing starts
  useEffect(() => {
    if (isEditing && inputRef.current) {
      inputRef.current.focus()
      inputRef.current.select()
    }
  }, [isEditing])

  // Update local state when displayName changes (e.g., after save)
  useEffect(() => {
    if (!isEditing) {
      setEditName(displayName)
    }
  }, [displayName, isEditing])

  const handleStartEdit = () => {
    setEditName(displayName)
    setError(null)
    setIsEditing(true)
  }

  const handleCancelEdit = () => {
    setEditName(displayName)
    setError(null)
    setIsEditing(false)
  }

  const handleSave = async () => {
    const trimmedName = editName.trim()

    if (!trimmedName) {
      setError('Name cannot be empty')
      return
    }

    if (trimmedName === displayName) {
      setIsEditing(false)
      return
    }

    if (trimmedName.length > 100) {
      setError('Name must be 100 characters or less')
      return
    }

    try {
      await onRename(speaker.id, trimmedName)
      setIsEditing(false)
      setError(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to rename speaker')
    }
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault()
      handleSave()
    } else if (e.key === 'Escape') {
      handleCancelEdit()
    }
  }

  return (
    <div className="flex items-center gap-3 p-3 bg-muted/30 rounded-lg hover:bg-muted/50 transition-colors">
      {/* Avatar */}
      <div
        className={`w-10 h-10 rounded-full flex items-center justify-center font-semibold text-sm flex-shrink-0 ${colors.avatar}`}
        title={displayName}
      >
        {initials}
      </div>

      {/* Name and info */}
      <div className="flex-1 min-w-0">
        {isEditing ? (
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <input
                ref={inputRef}
                type="text"
                value={editName}
                onChange={(e) => {
                  setEditName(e.target.value)
                  setError(null)
                }}
                onKeyDown={handleKeyDown}
                className={`flex-1 px-2 py-1 text-sm bg-background border rounded-md text-foreground focus:outline-none focus:ring-2 focus:ring-purple-600 ${
                  error ? 'border-red-500' : 'border-border'
                }`}
                placeholder="Enter speaker name"
                maxLength={100}
                disabled={isRenaming}
              />
              <button
                onClick={handleSave}
                disabled={isRenaming}
                className="p-1.5 text-green-600 hover:bg-green-100 rounded-md transition-colors disabled:opacity-50"
                title="Save"
              >
                {isRenaming ? (
                  <Loader2 size={16} className="animate-spin" />
                ) : (
                  <Check size={16} />
                )}
              </button>
              <button
                onClick={handleCancelEdit}
                disabled={isRenaming}
                className="p-1.5 text-muted-foreground hover:bg-muted rounded-md transition-colors disabled:opacity-50"
                title="Cancel"
              >
                <X size={16} />
              </button>
            </div>
            {error && (
              <p className="text-xs text-red-600 flex items-center gap-1">
                <AlertCircle size={12} />
                {error}
              </p>
            )}
          </div>
        ) : (
          <div className="flex items-center gap-2">
            <span className={`font-medium truncate ${colors.text}`}>
              {displayName}
            </span>
            {hasOverride && (
              <span className="text-xs text-purple-600 whitespace-nowrap px-1.5 py-0.5 bg-purple-100 rounded">
                renamed
              </span>
            )}
            {!hasOverride && isAutoDetected && (
              <span className="text-xs text-muted-foreground whitespace-nowrap px-1.5 py-0.5 bg-muted rounded">
                auto-detected
              </span>
            )}
          </div>
        )}

        {!isEditing && (
          <p className="text-xs text-muted-foreground mt-0.5">
            {segmentCount} segment{segmentCount !== 1 ? 's' : ''} in this meeting
          </p>
        )}
      </div>

      {/* Edit button */}
      {!isEditing && (
        <button
          onClick={handleStartEdit}
          className="p-2 text-muted-foreground hover:text-foreground hover:bg-muted rounded-md transition-colors"
          title="Rename speaker for this meeting"
        >
          <Edit2 size={16} />
        </button>
      )}
    </div>
  )
}

// ============================================================================
// SpeakerManagementModal Component
// ============================================================================

export function SpeakerManagementModal({
  isOpen,
  onClose,
  meetingId,
  speakers,
  speakerNameOverrides,
  transcripts,
  onSuccess,
}: SpeakerManagementModalProps) {
  const [isRenaming, setIsRenaming] = useState(false)
  const [globalError, setGlobalError] = useState<string | null>(null)

  // Calculate speaker stats from transcripts
  const speakersWithStats: SpeakerWithStats[] = React.useMemo(() => {
    // Get unique speaker IDs from transcripts and count segments
    const speakerSegmentCounts = new Map<string, number>()
    const speakerOrder: string[] = []

    transcripts.forEach((t) => {
      if (t.speaker_id) {
        const count = speakerSegmentCounts.get(t.speaker_id) || 0
        speakerSegmentCounts.set(t.speaker_id, count + 1)
        if (!speakerOrder.includes(t.speaker_id)) {
          speakerOrder.push(t.speaker_id)
        }
      }
    })

    // Build speaker stats list in order of appearance
    return speakerOrder
      .map((speakerId, index) => {
        const speaker = speakers.get(speakerId)
        if (!speaker) return null

        // Check for meeting-specific name override
        const override = speakerNameOverrides.get(speakerId)
        const displayName = override || speaker.name
        const hasOverride = !!override

        return {
          speaker,
          displayName,
          hasOverride,
          segmentCount: speakerSegmentCounts.get(speakerId) || 0,
          colorIndex: index,
        }
      })
      .filter((s): s is SpeakerWithStats => s !== null)
  }, [transcripts, speakers, speakerNameOverrides])

  // Reset state when modal closes
  useEffect(() => {
    if (!isOpen) {
      setGlobalError(null)
    }
  }, [isOpen])

  const handleRename = async (speakerId: string, newName: string) => {
    setIsRenaming(true)
    setGlobalError(null)

    try {
      // Use meeting-specific speaker name API
      const result = await window.electronAPI.db.meetingSpeakerNames.setName(meetingId, speakerId, newName)
      if (!result) {
        throw new Error('Failed to update speaker name')
      }

      // Notify parent to refetch data
      if (onSuccess) {
        onSuccess()
      }
    } catch (err) {
      console.error('Failed to rename speaker:', err)
      throw err
    } finally {
      setIsRenaming(false)
    }
  }

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Manage Speakers" size="md">
      <div className="space-y-4">
        {/* Description */}
        <p className="text-sm text-muted-foreground">
          Rename speakers to identify who said what. Changes apply only to this meeting.
        </p>

        {/* Global error */}
        {globalError && (
          <div className="flex items-start gap-2 p-3 bg-red-50 border border-red-200 rounded-md">
            <AlertCircle className="text-red-600 mt-0.5 flex-shrink-0" size={18} />
            <p className="text-sm text-red-600">{globalError}</p>
          </div>
        )}

        {/* Speaker list */}
        {speakersWithStats.length > 0 ? (
          <div className="space-y-2 max-h-96 overflow-y-auto">
            {speakersWithStats.map((speakerWithStats) => (
              <SpeakerRow
                key={speakerWithStats.speaker.id}
                speakerWithStats={speakerWithStats}
                onRename={handleRename}
                isRenaming={isRenaming}
              />
            ))}
          </div>
        ) : (
          <div className="flex flex-col items-center justify-center py-8 text-center">
            <Users className="w-12 h-12 text-muted-foreground mb-3" />
            <p className="text-sm text-muted-foreground">
              No speakers found in this meeting.
            </p>
          </div>
        )}

        {/* Info note */}
        {speakersWithStats.length > 0 && (
          <div className="p-3 bg-blue-50 border border-blue-200 rounded-md">
            <p className="text-sm text-blue-700">
              <strong>Tip:</strong> Click the edit icon to rename a speaker. The change will only apply to this meeting - other meetings will keep their own speaker names.
            </p>
          </div>
        )}

        {/* Close button */}
        <div className="flex justify-end pt-4 border-t border-border">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 text-sm font-medium text-foreground bg-background border border-border rounded-md hover:bg-muted transition-colors"
          >
            Done
          </button>
        </div>
      </div>
    </Modal>
  )
}
