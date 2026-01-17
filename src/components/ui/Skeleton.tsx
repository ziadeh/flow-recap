/**
 * Skeleton Component
 *
 * Reusable skeleton loader components for displaying loading placeholders.
 * Provides visual feedback while content is loading.
 */

import { cn } from '@/lib/utils'

interface SkeletonProps {
  /** Additional CSS classes */
  className?: string
  /** Whether to use rounded corners */
  rounded?: boolean | 'sm' | 'md' | 'lg' | 'full'
  /** Animation style */
  animation?: 'pulse' | 'shimmer' | 'none'
  /** Inline styles */
  style?: React.CSSProperties
}

const roundedClasses = {
  true: 'rounded',
  sm: 'rounded-sm',
  md: 'rounded-md',
  lg: 'rounded-lg',
  full: 'rounded-full',
  false: ''
}

/**
 * Base Skeleton - A simple animated placeholder
 */
export function Skeleton({
  className,
  rounded = 'md',
  animation = 'pulse',
  style
}: SkeletonProps) {
  return (
    <div
      className={cn(
        'bg-muted',
        animation === 'pulse' && 'animate-pulse',
        animation === 'shimmer' && 'animate-shimmer bg-gradient-to-r from-muted via-muted/50 to-muted bg-[length:200%_100%]',
        roundedClasses[rounded.toString() as keyof typeof roundedClasses],
        className
      )}
      style={style}
    />
  )
}

/**
 * Text Skeleton - For placeholder text lines
 */
export function SkeletonText({
  lines = 1,
  className,
  lastLineWidth = '60%'
}: {
  lines?: number
  className?: string
  lastLineWidth?: string
}) {
  return (
    <div className={cn('space-y-2', className)}>
      {Array.from({ length: lines }).map((_, i) => (
        <Skeleton
          key={i}
          className="h-4"
          style={{
            width: i === lines - 1 && lines > 1 ? lastLineWidth : '100%'
          }}
        />
      ))}
    </div>
  )
}

/**
 * Avatar Skeleton - Circular placeholder for avatars
 */
export function SkeletonAvatar({
  size = 'md',
  className
}: {
  size?: 'xs' | 'sm' | 'md' | 'lg' | 'xl'
  className?: string
}) {
  const sizeClasses = {
    xs: 'w-6 h-6',
    sm: 'w-8 h-8',
    md: 'w-10 h-10',
    lg: 'w-12 h-12',
    xl: 'w-16 h-16'
  }

  return (
    <Skeleton
      className={cn(sizeClasses[size], className)}
      rounded="full"
    />
  )
}

/**
 * Card Skeleton - Placeholder for card layouts
 */
export function SkeletonCard({
  hasImage = false,
  lines = 3,
  className
}: {
  hasImage?: boolean
  lines?: number
  className?: string
}) {
  return (
    <div className={cn('border border-border rounded-lg p-4 space-y-4', className)}>
      {hasImage && (
        <Skeleton className="w-full h-40" rounded="md" />
      )}
      <div className="space-y-3">
        <Skeleton className="h-5 w-3/4" />
        <SkeletonText lines={lines} lastLineWidth="40%" />
      </div>
    </div>
  )
}

/**
 * Meeting Card Skeleton - For meeting list items
 */
export function MeetingCardSkeleton({ className }: { className?: string }) {
  return (
    <div className={cn('p-4 border-b border-border animate-pulse', className)}>
      <div className="flex items-start gap-4">
        {/* Icon placeholder */}
        <Skeleton className="w-10 h-10 flex-shrink-0" rounded="lg" />

        {/* Content */}
        <div className="flex-1 space-y-2">
          {/* Title and status */}
          <div className="flex items-center gap-2">
            <Skeleton className="h-5 w-48" />
            <Skeleton className="h-5 w-20" rounded="full" />
          </div>

          {/* Description */}
          <Skeleton className="h-4 w-64" />

          {/* Meta info */}
          <div className="flex items-center gap-4">
            <Skeleton className="h-4 w-24" />
            <Skeleton className="h-4 w-16" />
            <Skeleton className="h-4 w-20" />
          </div>
        </div>

        {/* Actions */}
        <div className="flex gap-2">
          <Skeleton className="w-8 h-8" rounded="md" />
          <Skeleton className="w-8 h-8" rounded="md" />
        </div>
      </div>
    </div>
  )
}

/**
 * Meeting List Skeleton - Multiple meeting card skeletons
 */
export function MeetingListSkeleton({
  count = 5,
  className
}: {
  count?: number
  className?: string
}) {
  return (
    <div className={cn('divide-y divide-border', className)}>
      {Array.from({ length: count }).map((_, i) => (
        <MeetingCardSkeleton key={i} />
      ))}
    </div>
  )
}

/**
 * Stats Card Skeleton - For dashboard stat cards
 */
export function StatsCardSkeleton({ className }: { className?: string }) {
  return (
    <div className={cn('bg-card border border-border rounded-lg p-4 shadow-sm animate-pulse', className)}>
      <div className="flex items-center gap-3">
        <Skeleton className="w-10 h-10" rounded="lg" />
        <div className="space-y-1.5">
          <Skeleton className="h-7 w-12" />
          <Skeleton className="h-4 w-24" />
        </div>
      </div>
    </div>
  )
}

/**
 * Transcript Skeleton - For transcript segments
 */
export function TranscriptSkeleton({ className }: { className?: string }) {
  return (
    <div className={cn('space-y-4 animate-pulse', className)}>
      {[1, 2, 3].map((i) => (
        <div key={i} className="flex gap-3">
          <SkeletonAvatar size="sm" />
          <div className="flex-1 space-y-2">
            <div className="flex items-center gap-2">
              <Skeleton className="h-4 w-24" />
              <Skeleton className="h-3 w-16" />
            </div>
            <SkeletonText lines={2} lastLineWidth="80%" />
          </div>
        </div>
      ))}
    </div>
  )
}

/**
 * Table Skeleton - For table data
 */
export function TableSkeleton({
  rows = 5,
  columns = 4,
  className
}: {
  rows?: number
  columns?: number
  className?: string
}) {
  return (
    <div className={cn('animate-pulse', className)}>
      {/* Header */}
      <div className="flex gap-4 pb-3 border-b border-border mb-3">
        {Array.from({ length: columns }).map((_, i) => (
          <Skeleton key={i} className="h-5 flex-1" />
        ))}
      </div>

      {/* Rows */}
      <div className="space-y-3">
        {Array.from({ length: rows }).map((_, rowIdx) => (
          <div key={rowIdx} className="flex gap-4">
            {Array.from({ length: columns }).map((_, colIdx) => (
              <Skeleton
                key={colIdx}
                className="h-4 flex-1"
                style={{ opacity: 1 - (rowIdx * 0.1) }}
              />
            ))}
          </div>
        ))}
      </div>
    </div>
  )
}

/**
 * Page Content Skeleton - Full page loading skeleton
 */
export function PageContentSkeleton({ className }: { className?: string }) {
  return (
    <div className={cn('space-y-6 animate-pulse', className)}>
      {/* Page header */}
      <div className="space-y-2">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-4 w-96" />
      </div>

      {/* Stats grid */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        {[1, 2, 3, 4].map((i) => (
          <StatsCardSkeleton key={i} />
        ))}
      </div>

      {/* Content section */}
      <div className="bg-card border border-border rounded-lg p-6 space-y-4">
        <Skeleton className="h-6 w-48" />
        <SkeletonText lines={4} />
      </div>
    </div>
  )
}

export default Skeleton
