import { cn } from '@/lib/utils'
import { Skeleton } from './Skeleton'

/**
 * MeetingCardMetadataSkeleton Component
 *
 * Placeholder skeleton for lazy-loaded meeting card metadata.
 * Matches the layout and height of the actual metadata display to prevent layout shift.
 *
 * Shows skeleton lines for:
 * - Title and status badge
 * - Description
 * - Date, time, and duration metadata
 */
export function MeetingCardMetadataSkeleton({ className }: { className?: string }) {
  return (
    <div className={cn('flex-1 min-w-0 space-y-2', className)}>
      {/* Title and status badge */}
      <div className="flex items-center gap-2 mb-1 flex-wrap">
        <Skeleton className="h-5 w-48" />
        <Skeleton className="h-5 w-20 rounded-full" />
      </div>

      {/* Description */}
      <Skeleton className="h-4 w-64" />

      {/* Metadata: Date, Time, Duration */}
      <div className="flex items-center gap-3 text-sm flex-wrap pt-1">
        <Skeleton className="h-4 w-24" />
        <Skeleton className="h-4 w-20" />
        <Skeleton className="h-4 w-24" />
      </div>
    </div>
  )
}
