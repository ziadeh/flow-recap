/**
 * DynamicSpeakerLabel Component
 *
 * Displays a speaker's name with:
 * - Smooth transition animations when name changes
 * - Confidence indicators for newly identified names
 * - Hover tooltips showing detection method and confidence
 * - Color-coded styling consistent with speaker identity
 */

import { useState, useEffect, useRef, memo } from 'react'
import { HelpCircle, User, CheckCircle, AlertCircle } from 'lucide-react'
import { cn } from '../../lib/utils'
import { SPEAKER_COLORS, parseSpeakerIndex, isDiarizationSpeaker } from './transcript-utils'
import { useSpeakerNameStore, type IdentifiedSpeaker } from '../../stores/speaker-name-store'

// ============================================================================
// Types
// ============================================================================

export interface DynamicSpeakerLabelProps {
  /** Speaker ID (from diarization, e.g., "Speaker_0") */
  speakerId: string | null
  /** Color index for consistent coloring (optional, derived from speakerId if not provided) */
  colorIndex?: number
  /** Size variant */
  size?: 'sm' | 'md' | 'lg'
  /** Whether to show the avatar/initials */
  showAvatar?: boolean
  /** Whether to show confidence indicator */
  showConfidence?: boolean
  /** Whether to show the detection method tooltip on hover */
  showTooltip?: boolean
  /** Whether this is the currently active/speaking speaker */
  isActive?: boolean
  /** Custom class names */
  className?: string
  /** Callback when name is clicked (for manual editing) */
  onNameClick?: (speakerId: string) => void
}

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Get initials from a name
 */
function getInitials(name: string): string {
  // For "Speaker N" format
  const speakerMatch = name.match(/Speaker\s+(\d+)/)
  if (speakerMatch) {
    return `S${speakerMatch[1]}`
  }

  // For real names, get first letter of first and last name
  const words = name.split(' ').filter(w => w.length > 0)
  if (words.length >= 2) {
    return (words[0][0] + words[words.length - 1][0]).toUpperCase()
  }
  if (words.length === 1) {
    return words[0].slice(0, 2).toUpperCase()
  }
  return '??'
}

/**
 * Get human-readable detection method label
 */
function getDetectionMethodLabel(method: IdentifiedSpeaker['detectionMethod']): string {
  switch (method) {
    case 'self_introduction':
      return 'Detected from self-introduction'
    case 'name_reference':
      return 'Detected from name mention'
    case 'temporal_correlation':
      return 'Detected from context patterns'
    case 'manual':
      return 'Manually assigned'
    case 'unknown':
    default:
      return 'Not yet identified'
  }
}

/**
 * Get confidence level label
 */
function getConfidenceLabel(confidence: number): { label: string; icon: typeof CheckCircle } {
  if (confidence >= 0.8) {
    return { label: 'High confidence', icon: CheckCircle }
  }
  if (confidence >= 0.5) {
    return { label: 'Medium confidence', icon: HelpCircle }
  }
  return { label: 'Low confidence', icon: AlertCircle }
}

// ============================================================================
// Tooltip Component
// ============================================================================

interface SpeakerTooltipProps {
  speaker: IdentifiedSpeaker
  visible: boolean
}

function SpeakerTooltip({ speaker, visible }: SpeakerTooltipProps) {
  if (!visible) return null

  const { label: confidenceLabel, icon: ConfidenceIcon } = getConfidenceLabel(speaker.confidence)

  return (
    <div
      className={cn(
        'absolute z-50 bottom-full left-0 mb-2 px-3 py-2 rounded-lg shadow-lg',
        'bg-popover border border-border text-popover-foreground',
        'text-xs whitespace-nowrap',
        'transition-all duration-200',
        visible ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-1 pointer-events-none'
      )}
    >
      <div className="space-y-1.5">
        {/* Detection method */}
        <div className="flex items-center gap-1.5 text-muted-foreground">
          <User className="w-3 h-3" />
          <span>{getDetectionMethodLabel(speaker.detectionMethod)}</span>
        </div>

        {/* Confidence score */}
        {speaker.isIdentified && (
          <div className="flex items-center gap-1.5">
            <ConfidenceIcon className={cn(
              'w-3 h-3',
              speaker.confidence >= 0.8 ? 'text-green-500' :
              speaker.confidence >= 0.5 ? 'text-yellow-500' : 'text-red-500'
            )} />
            <span>{confidenceLabel} ({Math.round(speaker.confidence * 100)}%)</span>
          </div>
        )}
      </div>

      {/* Arrow */}
      <div className="absolute top-full left-4 w-0 h-0 border-l-4 border-r-4 border-t-4 border-transparent border-t-border" />
    </div>
  )
}

// ============================================================================
// Main Component
// ============================================================================

export const DynamicSpeakerLabel = memo(function DynamicSpeakerLabel({
  speakerId,
  colorIndex: providedColorIndex,
  size = 'md',
  showAvatar = true,
  showConfidence = true,
  showTooltip = true,
  isActive = false,
  className,
  onNameClick,
}: DynamicSpeakerLabelProps) {
  const [isHovered, setIsHovered] = useState(false)
  const [isAnimating, setIsAnimating] = useState(false)
  const previousNameRef = useRef<string>('')

  // Get speaker info from store
  const speaker = useSpeakerNameStore(state =>
    speakerId ? state.speakers.get(speakerId) : undefined
  )

  // Calculate color index
  const colorIndex = providedColorIndex ?? (speakerId ? parseSpeakerIndex(speakerId) : 0)
  const colors = SPEAKER_COLORS[colorIndex % SPEAKER_COLORS.length]

  // Determine display name
  const displayName = speaker?.displayName ??
    (speakerId && isDiarizationSpeaker(speakerId)
      ? `Speaker ${parseSpeakerIndex(speakerId) + 1}`
      : speakerId ?? 'Unknown Speaker')

  const initials = getInitials(displayName)
  const isIdentified = speaker?.isIdentified ?? false
  const confidence = speaker?.confidence ?? 0
  const isPending = speaker?.isPending ?? false

  // Trigger animation when name changes
  useEffect(() => {
    if (previousNameRef.current && previousNameRef.current !== displayName) {
      setIsAnimating(true)
      const timer = setTimeout(() => setIsAnimating(false), 500)
      return () => clearTimeout(timer)
    }
    previousNameRef.current = displayName
  }, [displayName])

  // Size classes
  const sizeClasses = {
    sm: {
      avatar: 'w-6 h-6 text-xs',
      name: 'text-xs',
      container: 'gap-1.5',
    },
    md: {
      avatar: 'w-8 h-8 text-sm',
      name: 'text-sm',
      container: 'gap-2',
    },
    lg: {
      avatar: 'w-10 h-10 text-base',
      name: 'text-base',
      container: 'gap-3',
    },
  }

  const sizeConfig = sizeClasses[size]

  // Render confidence indicator
  const renderConfidenceIndicator = () => {
    if (!showConfidence || !isIdentified) return null

    // High confidence - no indicator needed
    if (confidence >= 0.8) return null

    // Low/medium confidence - show indicator
    return (
      <span
        className={cn(
          'ml-1',
          confidence >= 0.5 ? 'text-yellow-500' : 'text-red-500'
        )}
        title={`${Math.round(confidence * 100)}% confidence`}
      >
        {confidence < 0.5 ? '?' : ''}
      </span>
    )
  }

  // Render pending indicator
  const renderPendingIndicator = () => {
    if (!isPending) return null

    return (
      <span className="ml-1 text-muted-foreground text-xs italic">
        (possibly)
      </span>
    )
  }

  const handleClick = () => {
    if (onNameClick && speakerId) {
      onNameClick(speakerId)
    }
  }

  return (
    <div
      className={cn(
        'flex items-center relative',
        sizeConfig.container,
        className
      )}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
      data-testid="dynamic-speaker-label"
      data-speaker-id={speakerId}
      data-is-identified={isIdentified}
    >
      {/* Avatar */}
      {showAvatar && (
        <div
          className={cn(
            'rounded-full flex items-center justify-center font-semibold flex-shrink-0 transition-all duration-300',
            sizeConfig.avatar,
            colors.avatar,
            isActive && 'ring-2 ring-offset-1 ring-primary animate-pulse'
          )}
          title={displayName}
        >
          {initials}
        </div>
      )}

      {/* Name with animation */}
      <div
        className={cn(
          'flex items-center',
          isAnimating && 'animate-slide-in-fade'
        )}
      >
        <span
          className={cn(
            'font-medium transition-all duration-300',
            sizeConfig.name,
            colors.text,
            isIdentified && 'cursor-default',
            !isIdentified && 'italic opacity-80',
            onNameClick && 'cursor-pointer hover:underline'
          )}
          onClick={handleClick}
        >
          {displayName}
        </span>
        {renderConfidenceIndicator()}
        {renderPendingIndicator()}
      </div>

      {/* Auto-detected badge */}
      {!isIdentified && speakerId && isDiarizationSpeaker(speakerId) && (
        <span className="text-xs text-muted-foreground px-1.5 py-0.5 bg-muted rounded">
          auto-detected
        </span>
      )}

      {/* Tooltip on hover */}
      {showTooltip && speaker && (
        <SpeakerTooltip speaker={speaker} visible={isHovered} />
      )}
    </div>
  )
})

// ============================================================================
// Compact Variant
// ============================================================================

export interface CompactSpeakerLabelProps {
  speakerId: string | null
  colorIndex?: number
  showConfidenceIcon?: boolean
  className?: string
}

/**
 * Compact inline speaker label for use in transcript text
 */
export const CompactSpeakerLabel = memo(function CompactSpeakerLabel({
  speakerId,
  colorIndex: providedColorIndex,
  showConfidenceIcon = true,
  className,
}: CompactSpeakerLabelProps) {
  const speaker = useSpeakerNameStore(state =>
    speakerId ? state.speakers.get(speakerId) : undefined
  )

  const colorIndex = providedColorIndex ?? (speakerId ? parseSpeakerIndex(speakerId) : 0)
  const colors = SPEAKER_COLORS[colorIndex % SPEAKER_COLORS.length]

  const displayName = speaker?.displayName ??
    (speakerId && isDiarizationSpeaker(speakerId)
      ? `Speaker ${parseSpeakerIndex(speakerId) + 1}`
      : speakerId ?? 'Unknown')

  const isIdentified = speaker?.isIdentified ?? false
  const confidence = speaker?.confidence ?? 0

  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 font-medium',
        colors.text,
        className
      )}
      data-testid="compact-speaker-label"
    >
      {displayName}
      {showConfidenceIcon && isIdentified && confidence < 0.5 && (
        <HelpCircle className="w-3 h-3 text-yellow-500" />
      )}
    </span>
  )
})

// ============================================================================
// Exports
// ============================================================================

export default DynamicSpeakerLabel
