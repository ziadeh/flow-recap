/**
 * CurrentSpeakerBadge Component
 *
 * A prominent badge that displays the currently speaking person's name
 * during live recording. Shows:
 * - Large, prominent speaker name display
 * - "is speaking" indicator
 * - Visual pulse animation while speaking
 * - Confidence indicator for newly identified names
 * - Smooth transitions when speaker changes
 */

import { useState, useEffect, memo } from 'react'
import { Mic, HelpCircle, User } from 'lucide-react'
import { cn } from '../../lib/utils'
import { SPEAKER_COLORS, parseSpeakerIndex, isDiarizationSpeaker } from '../transcript/transcript-utils'
import {
  useSpeakerNameStore,
  useCurrentSpeaker,
} from '../../stores/speaker-name-store'

// ============================================================================
// Types
// ============================================================================

export interface CurrentSpeakerBadgeProps {
  /** Whether recording is currently active */
  isRecording?: boolean
  /** Size variant */
  size?: 'sm' | 'md' | 'lg'
  /** Visual style variant */
  variant?: 'default' | 'prominent' | 'minimal'
  /** Additional class names */
  className?: string
  /** Hide badge when no speaker is detected */
  hideWhenEmpty?: boolean
}

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Get display text for unknown/fallback states
 */
function getFallbackText(isRecording: boolean, isInitializing: boolean): string {
  if (!isRecording) {
    return 'Not recording'
  }
  if (isInitializing) {
    return 'Detecting speakers...'
  }
  return 'Waiting for speaker...'
}

/**
 * Format confidence display
 */
function formatConfidence(confidence: number, isIdentified: boolean): string | null {
  if (!isIdentified) return null
  if (confidence >= 0.8) return null // High confidence, no need to show
  if (confidence >= 0.5) return `possibly` // Medium confidence
  return `?` // Low confidence
}

// ============================================================================
// Main Component
// ============================================================================

export const CurrentSpeakerBadge = memo(function CurrentSpeakerBadge({
  isRecording = false,
  size = 'md',
  variant = 'default',
  className,
  hideWhenEmpty = false,
}: CurrentSpeakerBadgeProps) {
  const [isTransitioning, setIsTransitioning] = useState(false)
  const [previousSpeaker, setPreviousSpeaker] = useState<string | null>(null)

  // Get current speaker from store
  const currentSpeaker = useCurrentSpeaker()
  const currentSpeakerId = useSpeakerNameStore(state => state.currentSpeakerId)

  // Track speaker changes for animation
  useEffect(() => {
    if (previousSpeaker !== currentSpeakerId) {
      setIsTransitioning(true)
      const timer = setTimeout(() => setIsTransitioning(false), 300)
      setPreviousSpeaker(currentSpeakerId)
      return () => clearTimeout(timer)
    }
  }, [currentSpeakerId, previousSpeaker])

  // Determine display values
  const displayName = currentSpeaker?.displayName ??
    (currentSpeakerId && isDiarizationSpeaker(currentSpeakerId)
      ? `Speaker ${parseSpeakerIndex(currentSpeakerId) + 1}`
      : null)

  const isIdentified = currentSpeaker?.isIdentified ?? false
  const confidence = currentSpeaker?.confidence ?? 0
  const confidenceText = formatConfidence(confidence, isIdentified)
  const colorIndex = currentSpeaker?.colorIndex ?? (currentSpeakerId ? parseSpeakerIndex(currentSpeakerId) : 0)
  const colors = SPEAKER_COLORS[colorIndex % SPEAKER_COLORS.length]

  const hasSpeaker = displayName !== null
  const isInitializing = isRecording && !hasSpeaker

  // Hide empty badge if requested
  if (hideWhenEmpty && !hasSpeaker && !isRecording) {
    return null
  }

  // Size configuration
  const sizeConfig = {
    sm: {
      container: 'px-3 py-1.5 rounded-lg',
      icon: 'w-3.5 h-3.5',
      name: 'text-sm',
      status: 'text-xs',
    },
    md: {
      container: 'px-4 py-2.5 rounded-xl',
      icon: 'w-4 h-4',
      name: 'text-base',
      status: 'text-sm',
    },
    lg: {
      container: 'px-6 py-4 rounded-2xl',
      icon: 'w-5 h-5',
      name: 'text-xl',
      status: 'text-base',
    },
  }

  const config = sizeConfig[size]

  // Variant styling
  const getVariantClasses = () => {
    if (!hasSpeaker) {
      return 'bg-muted/50 text-muted-foreground border border-border'
    }

    switch (variant) {
      case 'prominent':
        return cn(
          colors.bg,
          'border-2',
          colors.border,
          'shadow-lg'
        )
      case 'minimal':
        return cn(
          'bg-background/80 backdrop-blur-sm',
          'border',
          colors.border
        )
      case 'default':
      default:
        return cn(
          colors.bg,
          'border',
          colors.border
        )
    }
  }

  return (
    <div
      className={cn(
        'flex items-center gap-3 transition-all duration-300',
        config.container,
        getVariantClasses(),
        isTransitioning && 'scale-105',
        className
      )}
      data-testid="current-speaker-badge"
      data-speaker-id={currentSpeakerId}
      data-is-speaking={hasSpeaker}
    >
      {/* Speaking indicator */}
      <div className="relative">
        <Mic
          className={cn(
            config.icon,
            hasSpeaker ? colors.text : 'text-muted-foreground',
            hasSpeaker && isRecording && 'animate-pulse'
          )}
        />
        {hasSpeaker && isRecording && (
          <span className="absolute -top-0.5 -right-0.5 flex h-2 w-2">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75" />
            <span className="relative inline-flex rounded-full h-2 w-2 bg-green-500" />
          </span>
        )}
      </div>

      {/* Speaker info */}
      <div className="flex flex-col min-w-0">
        {hasSpeaker ? (
          <>
            {/* Name row */}
            <div className="flex items-center gap-2">
              <span
                className={cn(
                  'font-semibold truncate',
                  config.name,
                  colors.text
                )}
              >
                {displayName}
              </span>

              {/* Confidence indicator */}
              {confidenceText && (
                <span className={cn(
                  'text-muted-foreground flex items-center gap-1',
                  config.status
                )}>
                  {confidenceText === '?' && (
                    <HelpCircle className="w-3.5 h-3.5 text-yellow-500" />
                  )}
                  <span className="italic">({confidenceText})</span>
                </span>
              )}
            </div>

            {/* Status text */}
            <span className={cn(
              'text-muted-foreground',
              config.status
            )}>
              is speaking
            </span>
          </>
        ) : (
          <span className={cn(
            'text-muted-foreground italic',
            config.status
          )}>
            {getFallbackText(isRecording, isInitializing)}
          </span>
        )}
      </div>

      {/* Not identified indicator */}
      {hasSpeaker && !isIdentified && (
        <span title="Speaker not yet identified by name">
          <User
            className={cn(
              config.icon,
              'text-muted-foreground opacity-50'
            )}
          />
        </span>
      )}
    </div>
  )
})

// ============================================================================
// Floating Variant
// ============================================================================

export interface FloatingCurrentSpeakerProps extends CurrentSpeakerBadgeProps {
  /** Position of the floating badge */
  position?: 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right' | 'top-center' | 'bottom-center'
}

/**
 * Floating version of the CurrentSpeakerBadge for overlay display
 */
export const FloatingCurrentSpeaker = memo(function FloatingCurrentSpeaker({
  position = 'top-center',
  ...props
}: FloatingCurrentSpeakerProps) {
  const positionClasses = {
    'top-left': 'top-4 left-4',
    'top-right': 'top-4 right-4',
    'bottom-left': 'bottom-4 left-4',
    'bottom-right': 'bottom-4 right-4',
    'top-center': 'top-4 left-1/2 -translate-x-1/2',
    'bottom-center': 'bottom-4 left-1/2 -translate-x-1/2',
  }

  return (
    <div
      className={cn(
        'fixed z-50',
        positionClasses[position]
      )}
    >
      <CurrentSpeakerBadge
        variant="prominent"
        {...props}
        className={cn('shadow-xl', props.className)}
      />
    </div>
  )
})

// ============================================================================
// Inline Compact Version
// ============================================================================

export interface InlineSpeakerIndicatorProps {
  /** Whether recording is active */
  isRecording?: boolean
  /** Additional class names */
  className?: string
}

/**
 * Inline compact speaker indicator for use in headers/toolbars
 */
export const InlineSpeakerIndicator = memo(function InlineSpeakerIndicator({
  isRecording = false,
  className,
}: InlineSpeakerIndicatorProps) {
  const currentSpeaker = useCurrentSpeaker()
  const currentSpeakerId = useSpeakerNameStore(state => state.currentSpeakerId)

  const displayName = currentSpeaker?.displayName ??
    (currentSpeakerId && isDiarizationSpeaker(currentSpeakerId)
      ? `Speaker ${parseSpeakerIndex(currentSpeakerId) + 1}`
      : null)

  const colorIndex = currentSpeaker?.colorIndex ?? (currentSpeakerId ? parseSpeakerIndex(currentSpeakerId) : 0)
  const colors = SPEAKER_COLORS[colorIndex % SPEAKER_COLORS.length]

  if (!displayName) {
    return (
      <span className={cn('text-xs text-muted-foreground', className)}>
        {isRecording ? 'Detecting...' : 'No speaker'}
      </span>
    )
  }

  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 text-xs font-medium',
        colors.text,
        className
      )}
    >
      <Mic className={cn(
        'w-3 h-3',
        isRecording && 'animate-pulse'
      )} />
      <span className="truncate max-w-[100px]">{displayName}</span>
    </span>
  )
})

// ============================================================================
// Exports
// ============================================================================

export default CurrentSpeakerBadge
