/**
 * SpeakerTag Component
 * A reusable component for displaying speaker identification with color coding
 */

import { cn } from '../../lib/utils'
import { getSpeakerInitials, type SpeakerColorConfig } from './transcript-utils'

// ============================================================================
// Types
// ============================================================================

export interface SpeakerTagProps {
  /** Speaker display name */
  name: string
  /** Color configuration for the speaker */
  colors: SpeakerColorConfig
  /** Size variant */
  size?: 'sm' | 'md' | 'lg'
  /** Whether this is an auto-detected speaker from diarization */
  isAutoDetected?: boolean
  /** Optional click handler for seeking to timestamp */
  onTimestampClick?: () => void
  /** Optional timestamp to display */
  timestamp?: string
  /** Additional class names */
  className?: string
}

// ============================================================================
// Size Configuration
// ============================================================================

const SIZE_CONFIG = {
  sm: {
    avatar: 'w-8 h-8 text-xs',
    name: 'text-sm',
    timestamp: 'text-xs',
  },
  md: {
    avatar: 'w-10 h-10 text-sm',
    name: 'text-base',
    timestamp: 'text-xs',
  },
  lg: {
    avatar: 'w-12 h-12 text-base',
    name: 'text-lg',
    timestamp: 'text-sm',
  },
} as const

// ============================================================================
// Component
// ============================================================================

export function SpeakerTag({
  name,
  colors,
  size = 'md',
  isAutoDetected = false,
  onTimestampClick,
  timestamp,
  className,
}: SpeakerTagProps) {
  const sizeConfig = SIZE_CONFIG[size]
  const initials = getSpeakerInitials(name)

  return (
    <div className={cn('flex items-center gap-3', className)}>
      {/* Avatar */}
      <div
        className={cn(
          'flex-shrink-0 rounded-full flex items-center justify-center font-semibold',
          colors.avatar,
          sizeConfig.avatar
        )}
        aria-hidden="true"
      >
        {initials}
      </div>

      {/* Speaker info */}
      <div className="flex items-baseline gap-2 min-w-0">
        <span className={cn('font-semibold truncate', colors.text, sizeConfig.name)}>
          {name}
        </span>

        {isAutoDetected && (
          <span className="text-xs text-muted-foreground whitespace-nowrap">
            (auto-detected)
          </span>
        )}

        {timestamp && (
          <button
            onClick={onTimestampClick}
            className={cn(
              'text-muted-foreground hover:underline transition-colors whitespace-nowrap',
              `hover:${colors.text}`,
              sizeConfig.timestamp
            )}
            disabled={!onTimestampClick}
            title="Click to seek to this position"
          >
            {timestamp}
          </button>
        )}
      </div>
    </div>
  )
}

// ============================================================================
// Avatar-only variant for compact displays
// ============================================================================

export interface SpeakerAvatarProps {
  /** Speaker display name (used for initials) */
  name: string
  /** Color configuration for the speaker */
  colors: SpeakerColorConfig
  /** Size variant */
  size?: 'sm' | 'md' | 'lg'
  /** Additional class names */
  className?: string
}

export function SpeakerAvatar({
  name,
  colors,
  size = 'md',
  className,
}: SpeakerAvatarProps) {
  const sizeConfig = SIZE_CONFIG[size]
  const initials = getSpeakerInitials(name)

  return (
    <div
      className={cn(
        'flex-shrink-0 rounded-full flex items-center justify-center font-semibold',
        colors.avatar,
        sizeConfig.avatar,
        className
      )}
      title={name}
      aria-label={name}
    >
      {initials}
    </div>
  )
}
