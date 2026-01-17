/**
 * SpeakerNameSuggestions Component
 *
 * Displays detected speaker name suggestions with confidence indicators.
 * Allows users to accept, reject, or manually correct detected names.
 */

import { useState, useEffect } from 'react'
import { Check, X, Edit2, Sparkles, ChevronDown, ChevronUp, AlertCircle, Loader2 } from 'lucide-react'
import { getSpeakerColor, getSpeakerInitials } from '../transcript/transcript-utils'

// ============================================================================
// Types
// ============================================================================

interface SpeakerNameSuggestion {
  speakerId: string
  currentName: string
  suggestedName: string
  confidence: number
  confidenceLevel: 'high' | 'medium' | 'low'
  detectionType: 'self_introduction' | 'name_reference' | 'temporal_correlation' | 'manual_correction'
  candidateId: string
  detectionContext: string | null
}

interface SpeakerNameSuggestionsProps {
  meetingId: string
  onSuggestionAccepted?: () => void
  className?: string
}

// ============================================================================
// Helper Functions
// ============================================================================

function getConfidenceColor(level: 'high' | 'medium' | 'low'): string {
  switch (level) {
    case 'high':
      return 'text-green-600 bg-green-100'
    case 'medium':
      return 'text-yellow-600 bg-yellow-100'
    case 'low':
      return 'text-red-600 bg-red-100'
  }
}

function getDetectionTypeLabel(type: SpeakerNameSuggestion['detectionType']): string {
  switch (type) {
    case 'self_introduction':
      return 'Self-introduction'
    case 'name_reference':
      return 'Name reference'
    case 'temporal_correlation':
      return 'Temporal correlation'
    case 'manual_correction':
      return 'Manual correction'
  }
}

function getDetectionTypeDescription(type: SpeakerNameSuggestion['detectionType']): string {
  switch (type) {
    case 'self_introduction':
      return 'Detected from phrases like "Hi, I\'m..." or "My name is..."'
    case 'name_reference':
      return 'Name mentioned by another speaker before this person spoke'
    case 'temporal_correlation':
      return 'Associated based on timing patterns across the meeting'
    case 'manual_correction':
      return 'Previously set manually'
  }
}

// ============================================================================
// SuggestionCard Component
// ============================================================================

interface SuggestionCardProps {
  suggestion: SpeakerNameSuggestion
  colorIndex: number
  onAccept: (candidateId: string) => Promise<void>
  onReject: (candidateId: string) => Promise<void>
  onManualEdit: (speakerId: string, name: string) => Promise<void>
  isProcessing: boolean
}

function SuggestionCard({
  suggestion,
  colorIndex,
  onAccept,
  onReject,
  onManualEdit,
  isProcessing
}: SuggestionCardProps) {
  const [isEditing, setIsEditing] = useState(false)
  const [editName, setEditName] = useState(suggestion.suggestedName)
  const [showDetails, setShowDetails] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const colors = getSpeakerColor(suggestion.currentName, colorIndex)
  const initials = getSpeakerInitials(suggestion.currentName)
  const confidencePercent = Math.round(suggestion.confidence * 100)

  const handleAccept = async () => {
    setError(null)
    try {
      await onAccept(suggestion.candidateId)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to accept suggestion')
    }
  }

  const handleReject = async () => {
    setError(null)
    try {
      await onReject(suggestion.candidateId)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to reject suggestion')
    }
  }

  const handleManualSave = async () => {
    const trimmedName = editName.trim()
    if (!trimmedName) {
      setError('Name cannot be empty')
      return
    }
    setError(null)
    try {
      await onManualEdit(suggestion.speakerId, trimmedName)
      setIsEditing(false)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to set name')
    }
  }

  return (
    <div className="border border-border rounded-lg p-4 bg-card">
      <div className="flex items-start gap-3">
        {/* Avatar */}
        <div
          className={`w-10 h-10 rounded-full flex items-center justify-center font-semibold text-sm flex-shrink-0 ${colors.avatar}`}
          title={suggestion.currentName}
        >
          {initials}
        </div>

        {/* Content */}
        <div className="flex-1 min-w-0">
          {/* Current and suggested name */}
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-sm text-muted-foreground">
              {suggestion.currentName}
            </span>
            <span className="text-muted-foreground">→</span>
            {isEditing ? (
              <div className="flex items-center gap-2">
                <input
                  type="text"
                  value={editName}
                  onChange={(e) => {
                    setEditName(e.target.value)
                    setError(null)
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') handleManualSave()
                    if (e.key === 'Escape') {
                      setIsEditing(false)
                      setEditName(suggestion.suggestedName)
                    }
                  }}
                  className="px-2 py-1 text-sm border border-border rounded-md bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-purple-600"
                  placeholder="Enter name"
                  disabled={isProcessing}
                  autoFocus
                />
                <button
                  onClick={handleManualSave}
                  disabled={isProcessing}
                  className="p-1 text-green-600 hover:bg-green-100 rounded transition-colors disabled:opacity-50"
                  title="Save"
                >
                  {isProcessing ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />}
                </button>
                <button
                  onClick={() => {
                    setIsEditing(false)
                    setEditName(suggestion.suggestedName)
                    setError(null)
                  }}
                  disabled={isProcessing}
                  className="p-1 text-muted-foreground hover:bg-muted rounded transition-colors disabled:opacity-50"
                  title="Cancel"
                >
                  <X size={14} />
                </button>
              </div>
            ) : (
              <span className="font-medium text-foreground">
                {suggestion.suggestedName}
              </span>
            )}
          </div>

          {/* Confidence and detection type */}
          <div className="flex items-center gap-2 mt-1.5 flex-wrap">
            <span className={`text-xs px-1.5 py-0.5 rounded ${getConfidenceColor(suggestion.confidenceLevel)}`}>
              {confidencePercent}% confidence
            </span>
            <span className="text-xs text-muted-foreground">
              {getDetectionTypeLabel(suggestion.detectionType)}
            </span>
          </div>

          {/* Expandable details */}
          {(suggestion.detectionContext || true) && (
            <button
              onClick={() => setShowDetails(!showDetails)}
              className="flex items-center gap-1 mt-2 text-xs text-muted-foreground hover:text-foreground transition-colors"
            >
              {showDetails ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
              {showDetails ? 'Hide details' : 'Show details'}
            </button>
          )}

          {showDetails && (
            <div className="mt-2 p-2 bg-muted/50 rounded-md text-xs text-muted-foreground">
              <p>{getDetectionTypeDescription(suggestion.detectionType)}</p>
              {suggestion.detectionContext && (
                <p className="mt-1 text-foreground/70 italic">
                  {suggestion.detectionContext}
                </p>
              )}
            </div>
          )}

          {/* Error message */}
          {error && (
            <div className="flex items-center gap-1 mt-2 text-xs text-red-600">
              <AlertCircle size={12} />
              {error}
            </div>
          )}
        </div>

        {/* Action buttons */}
        {!isEditing && (
          <div className="flex items-center gap-1">
            <button
              onClick={handleAccept}
              disabled={isProcessing}
              className="p-2 text-green-600 hover:bg-green-100 rounded-md transition-colors disabled:opacity-50"
              title="Accept suggestion"
            >
              {isProcessing ? <Loader2 size={16} className="animate-spin" /> : <Check size={16} />}
            </button>
            <button
              onClick={handleReject}
              disabled={isProcessing}
              className="p-2 text-red-600 hover:bg-red-100 rounded-md transition-colors disabled:opacity-50"
              title="Reject suggestion"
            >
              <X size={16} />
            </button>
            <button
              onClick={() => setIsEditing(true)}
              disabled={isProcessing}
              className="p-2 text-muted-foreground hover:bg-muted rounded-md transition-colors disabled:opacity-50"
              title="Edit manually"
            >
              <Edit2 size={16} />
            </button>
          </div>
        )}
      </div>
    </div>
  )
}

// ============================================================================
// Main Component
// ============================================================================

export function SpeakerNameSuggestions({
  meetingId,
  onSuggestionAccepted,
  className = ''
}: SpeakerNameSuggestionsProps) {
  const [suggestions, setSuggestions] = useState<SpeakerNameSuggestion[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [isProcessing, setIsProcessing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [isExpanded, setIsExpanded] = useState(true)

  // Load suggestions
  const loadSuggestions = async () => {
    try {
      setError(null)
      const result = await window.electronAPI.speakerNameDetection.getSuggestions(meetingId)
      setSuggestions(result)
    } catch (err) {
      console.error('Failed to load speaker name suggestions:', err)
      setError(err instanceof Error ? err.message : 'Failed to load suggestions')
    } finally {
      setIsLoading(false)
    }
  }

  useEffect(() => {
    loadSuggestions()
  }, [meetingId])

  const handleAccept = async (candidateId: string) => {
    setIsProcessing(true)
    try {
      const success = await window.electronAPI.speakerNameDetection.acceptCandidate(candidateId)
      if (success) {
        await loadSuggestions()
        onSuggestionAccepted?.()
      }
    } finally {
      setIsProcessing(false)
    }
  }

  const handleReject = async (candidateId: string) => {
    setIsProcessing(true)
    try {
      await window.electronAPI.speakerNameDetection.rejectCandidate(candidateId)
      await loadSuggestions()
    } finally {
      setIsProcessing(false)
    }
  }

  const handleManualEdit = async (speakerId: string, name: string) => {
    setIsProcessing(true)
    try {
      await window.electronAPI.speakerNameDetection.manuallySetName(meetingId, speakerId, name)
      await loadSuggestions()
      onSuggestionAccepted?.()
    } finally {
      setIsProcessing(false)
    }
  }

  // Don't render if no suggestions and not loading
  if (!isLoading && suggestions.length === 0) {
    return null
  }

  return (
    <div className={`bg-purple-50 border border-purple-200 rounded-lg ${className}`}>
      {/* Header */}
      <button
        onClick={() => setIsExpanded(!isExpanded)}
        className="w-full flex items-center justify-between p-4 hover:bg-purple-100/50 transition-colors rounded-t-lg"
      >
        <div className="flex items-center gap-2">
          <Sparkles className="text-purple-600" size={18} />
          <span className="font-medium text-purple-900">
            Speaker Name Suggestions
          </span>
          {!isLoading && suggestions.length > 0 && (
            <span className="text-xs text-purple-600 bg-purple-200 px-2 py-0.5 rounded-full">
              {suggestions.length}
            </span>
          )}
        </div>
        {isExpanded ? (
          <ChevronUp className="text-purple-600" size={18} />
        ) : (
          <ChevronDown className="text-purple-600" size={18} />
        )}
      </button>

      {/* Content */}
      {isExpanded && (
        <div className="px-4 pb-4 space-y-3">
          {isLoading ? (
            <div className="flex items-center justify-center py-4">
              <Loader2 className="animate-spin text-purple-600" size={20} />
              <span className="ml-2 text-sm text-muted-foreground">
                Detecting speaker names...
              </span>
            </div>
          ) : error ? (
            <div className="flex items-center gap-2 p-3 bg-red-50 rounded-md">
              <AlertCircle className="text-red-600" size={16} />
              <span className="text-sm text-red-600">{error}</span>
            </div>
          ) : (
            <>
              <p className="text-sm text-muted-foreground">
                We detected potential names for speakers based on the transcript.
                Review and accept or reject these suggestions.
              </p>

              <div className="space-y-2">
                {suggestions.map((suggestion, index) => (
                  <SuggestionCard
                    key={suggestion.candidateId}
                    suggestion={suggestion}
                    colorIndex={index}
                    onAccept={handleAccept}
                    onReject={handleReject}
                    onManualEdit={handleManualEdit}
                    isProcessing={isProcessing}
                  />
                ))}
              </div>
            </>
          )}
        </div>
      )}
    </div>
  )
}

export default SpeakerNameSuggestions
