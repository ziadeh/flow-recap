/**
 * Page Loading Fallback Components
 *
 * Route-specific loading skeletons for lazy-loaded pages.
 * Each fallback mimics the layout of its corresponding page for a smooth loading experience.
 */

import { Skeleton, StatsCardSkeleton, MeetingListSkeleton } from '@/components/ui/Skeleton'
import { Spinner } from '@/components/ui/Spinner'

/**
 * Dashboard Loading Fallback
 * Shows skeleton for stats cards and recent meetings
 */
export function DashboardFallback() {
  return (
    <div className="flex-1 space-y-6 p-6 animate-in fade-in duration-300">
      {/* Page header */}
      <div className="space-y-2">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-4 w-72" />
      </div>

      {/* Stats grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        {[1, 2, 3, 4].map((i) => (
          <StatsCardSkeleton key={i} />
        ))}
      </div>

      {/* Quick actions */}
      <div className="flex gap-3">
        <Skeleton className="h-10 w-32" rounded="md" />
        <Skeleton className="h-10 w-32" rounded="md" />
      </div>

      {/* Recent meetings section */}
      <div className="space-y-4">
        <Skeleton className="h-6 w-40" />
        <div className="bg-card border border-border rounded-lg overflow-hidden">
          <MeetingListSkeleton count={3} />
        </div>
      </div>
    </div>
  )
}

/**
 * Meetings Page Loading Fallback
 * Shows skeleton for meetings list with search and filters
 */
export function MeetingsFallback() {
  return (
    <div className="flex-1 space-y-6 p-6 animate-in fade-in duration-300">
      {/* Page header */}
      <div className="flex items-center justify-between">
        <div className="space-y-2">
          <Skeleton className="h-8 w-40" />
          <Skeleton className="h-4 w-64" />
        </div>
        <Skeleton className="h-10 w-36" rounded="md" />
      </div>

      {/* Search and filters */}
      <div className="flex items-center gap-4">
        <Skeleton className="h-10 flex-1 max-w-md" rounded="md" />
        <Skeleton className="h-10 w-32" rounded="md" />
        <Skeleton className="h-10 w-32" rounded="md" />
      </div>

      {/* Meetings list */}
      <div className="bg-card border border-border rounded-lg overflow-hidden">
        <MeetingListSkeleton count={6} />
      </div>
    </div>
  )
}

/**
 * Meeting Detail Loading Fallback
 * Shows skeleton for meeting detail page with tabs
 */
export function MeetingDetailFallback() {
  return (
    <div className="flex-1 space-y-6 p-6 animate-in fade-in duration-300">
      {/* Back button and title */}
      <div className="flex items-center gap-4">
        <Skeleton className="h-10 w-10" rounded="md" />
        <div className="space-y-2">
          <Skeleton className="h-7 w-64" />
          <Skeleton className="h-4 w-48" />
        </div>
      </div>

      {/* Meeting info bar */}
      <div className="flex items-center gap-6">
        <Skeleton className="h-5 w-24" rounded="full" />
        <Skeleton className="h-5 w-32" />
        <Skeleton className="h-5 w-28" />
      </div>

      {/* Tabs */}
      <div className="border-b border-border">
        <div className="flex gap-6">
          {['Overview', 'Transcript', 'Notes', 'Insights', 'Recordings'].map((tab) => (
            <Skeleton key={tab} className="h-10 w-24" />
          ))}
        </div>
      </div>

      {/* Tab content */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Main content */}
        <div className="lg:col-span-2 space-y-4">
          <div className="bg-card border border-border rounded-lg p-6 space-y-4">
            <Skeleton className="h-6 w-32" />
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-5/6" />
            <Skeleton className="h-4 w-4/6" />
          </div>
        </div>

        {/* Sidebar */}
        <div className="space-y-4">
          <div className="bg-card border border-border rounded-lg p-4 space-y-3">
            <Skeleton className="h-5 w-24" />
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-3/4" />
          </div>
        </div>
      </div>
    </div>
  )
}

/**
 * Tasks Page Loading Fallback
 * Shows skeleton for Kanban board layout
 */
export function TasksFallback() {
  return (
    <div className="flex-1 space-y-6 p-6 animate-in fade-in duration-300">
      {/* Page header */}
      <div className="flex items-center justify-between">
        <div className="space-y-2">
          <Skeleton className="h-8 w-32" />
          <Skeleton className="h-4 w-56" />
        </div>
        <div className="flex gap-3">
          <Skeleton className="h-10 w-32" rounded="md" />
          <Skeleton className="h-10 w-28" rounded="md" />
        </div>
      </div>

      {/* Filters */}
      <div className="flex items-center gap-4">
        <Skeleton className="h-9 w-40" rounded="md" />
        <Skeleton className="h-9 w-36" rounded="md" />
      </div>

      {/* Kanban columns */}
      <div className="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-4 gap-4">
        {['To Do', 'In Progress', 'Review', 'Done'].map((column) => (
          <div key={column} className="bg-muted/30 rounded-lg p-4 space-y-3">
            <div className="flex items-center justify-between">
              <Skeleton className="h-5 w-20" />
              <Skeleton className="h-5 w-6" rounded="full" />
            </div>
            {/* Task cards */}
            {[1, 2, 3].map((i) => (
              <div key={i} className="bg-card border border-border rounded-lg p-3 space-y-2">
                <Skeleton className="h-4 w-full" />
                <Skeleton className="h-3 w-3/4" />
                <div className="flex items-center gap-2 pt-2">
                  <Skeleton className="h-5 w-5" rounded="full" />
                  <Skeleton className="h-3 w-16" />
                </div>
              </div>
            ))}
          </div>
        ))}
      </div>
    </div>
  )
}

/**
 * Settings Page Loading Fallback
 * Shows skeleton for settings categories and options
 */
export function SettingsFallback() {
  return (
    <div className="flex-1 p-6 animate-in fade-in duration-300">
      <div className="max-w-4xl mx-auto space-y-6">
        {/* Page header */}
        <div className="space-y-2">
          <Skeleton className="h-8 w-32" />
          <Skeleton className="h-4 w-72" />
        </div>

        {/* Settings layout */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
          {/* Sidebar categories */}
          <div className="space-y-2">
            {['Audio', 'Speaker ID', 'AI Settings', 'Shortcuts', 'Appearance', 'Privacy', 'Storage'].map((cat) => (
              <Skeleton key={cat} className="h-10 w-full" rounded="md" />
            ))}
          </div>

          {/* Content area */}
          <div className="md:col-span-3 space-y-6">
            {/* Section 1 */}
            <div className="bg-card border border-border rounded-lg p-6 space-y-4">
              <Skeleton className="h-6 w-36" />
              <Skeleton className="h-4 w-full max-w-md" />
              <div className="space-y-3 pt-2">
                <div className="flex items-center justify-between">
                  <Skeleton className="h-5 w-32" />
                  <Skeleton className="h-6 w-12" rounded="full" />
                </div>
                <div className="flex items-center justify-between">
                  <Skeleton className="h-5 w-40" />
                  <Skeleton className="h-9 w-48" rounded="md" />
                </div>
              </div>
            </div>

            {/* Section 2 */}
            <div className="bg-card border border-border rounded-lg p-6 space-y-4">
              <Skeleton className="h-6 w-44" />
              <Skeleton className="h-4 w-full max-w-sm" />
              <div className="space-y-3 pt-2">
                <div className="flex items-center justify-between">
                  <Skeleton className="h-5 w-36" />
                  <Skeleton className="h-6 w-12" rounded="full" />
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

/**
 * Generic Page Loading Fallback
 * Used as a default fallback for any route
 */
export function GenericPageFallback() {
  return (
    <div className="flex-1 flex items-center justify-center min-h-[400px]">
      <Spinner size="xl" variant="primary" label="Loading..." />
    </div>
  )
}
