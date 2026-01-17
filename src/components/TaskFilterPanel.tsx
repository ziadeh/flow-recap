/**
 * TaskFilterPanel Component
 *
 * A comprehensive filter panel for tasks that includes:
 * - Status filter (pending, in_progress, completed, cancelled)
 * - Priority filter (low, medium, high, urgent)
 * - Assignee filter (dropdown of unique assignees)
 * - Tags filter (multi-select of unique tags)
 * - Source meeting filter (dropdown of meetings)
 * - Search by title and description
 *
 * Filter preferences are persisted via the task filter store.
 */

import { useState, useMemo, useCallback } from 'react'
import {
  Search,
  Filter,
  X,
  ChevronDown,
  ChevronUp,
  User,
  Tag,
  Calendar,
  AlertTriangle,
  CheckCircle,
  Clock,
  XCircle,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import type { Task, TaskStatus, TaskPriority, Meeting } from '@/types/database'

export interface TaskFilters {
  search: string
  statuses: TaskStatus[]
  priorities: TaskPriority[]
  assignees: string[]
  tags: string[]
  meetingIds: string[]
}

export const DEFAULT_FILTERS: TaskFilters = {
  search: '',
  statuses: [],
  priorities: [],
  assignees: [],
  tags: [],
  meetingIds: [],
}

export interface TaskFilterPanelProps {
  /** Current filter state */
  filters: TaskFilters
  /** Callback when filters change */
  onFiltersChange: (filters: TaskFilters) => void
  /** All available tasks (used to extract unique values for filter options) */
  tasks: Task[]
  /** All available meetings (used for source meeting filter) */
  meetings?: Meeting[]
  /** Optional className */
  className?: string
  /** Whether panel is collapsed by default */
  defaultCollapsed?: boolean
}

// Status configuration with visual indicators
const STATUS_OPTIONS: Array<{
  value: TaskStatus
  label: string
  icon: typeof Clock
  colorClass: string
}> = [
  { value: 'pending', label: 'Pending', icon: Clock, colorClass: 'text-blue-600 bg-blue-100' },
  { value: 'in_progress', label: 'In Progress', icon: AlertTriangle, colorClass: 'text-purple-600 bg-purple-100' },
  { value: 'completed', label: 'Completed', icon: CheckCircle, colorClass: 'text-green-600 bg-green-100' },
  { value: 'cancelled', label: 'Cancelled', icon: XCircle, colorClass: 'text-gray-600 bg-gray-100' },
]

// Priority configuration with visual indicators
const PRIORITY_OPTIONS: Array<{
  value: TaskPriority
  label: string
  colorClass: string
}> = [
  { value: 'urgent', label: 'Urgent', colorClass: 'text-red-700 bg-red-100 border-red-200' },
  { value: 'high', label: 'High', colorClass: 'text-orange-700 bg-orange-100 border-orange-200' },
  { value: 'medium', label: 'Medium', colorClass: 'text-yellow-700 bg-yellow-100 border-yellow-200' },
  { value: 'low', label: 'Low', colorClass: 'text-gray-700 bg-gray-100 border-gray-200' },
]

/**
 * Filter badge showing active filter count
 */
function FilterBadge({ count }: { count: number }) {
  if (count === 0) return null
  return (
    <span className="ml-1.5 inline-flex items-center justify-center w-5 h-5 text-xs font-medium text-white bg-purple-600 rounded-full">
      {count}
    </span>
  )
}

/**
 * Multi-select chip component for filter options
 */
function FilterChip({
  label,
  isSelected,
  onClick,
  icon: Icon,
  colorClass,
}: {
  label: string
  isSelected: boolean
  onClick: () => void
  icon?: typeof Clock
  colorClass?: string
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'inline-flex items-center px-3 py-1.5 rounded-full text-sm font-medium border transition-all',
        isSelected
          ? colorClass || 'bg-purple-100 text-purple-700 border-purple-300'
          : 'bg-muted text-muted-foreground border-border hover:border-purple-300 hover:bg-purple-50'
      )}
      data-testid={`filter-chip-${label.toLowerCase().replace(/\s+/g, '-')}`}
    >
      {Icon && <Icon className="w-3.5 h-3.5 mr-1.5" />}
      {label}
      {isSelected && (
        <X className="w-3.5 h-3.5 ml-1.5 hover:text-purple-900" />
      )}
    </button>
  )
}

/**
 * Dropdown filter component for single/multi-select
 */
function FilterDropdown({
  label,
  icon: Icon,
  options,
  selectedValues,
  onChange,
  placeholder = 'Select...',
  testId,
}: {
  label: string
  icon?: typeof User
  options: Array<{ value: string; label: string }>
  selectedValues: string[]
  onChange: (values: string[]) => void
  placeholder?: string
  testId?: string
}) {
  const [isOpen, setIsOpen] = useState(false)

  const toggleOption = (value: string) => {
    if (selectedValues.includes(value)) {
      onChange(selectedValues.filter((v) => v !== value))
    } else {
      onChange([...selectedValues, value])
    }
  }

  const selectedLabels = options
    .filter((opt) => selectedValues.includes(opt.value))
    .map((opt) => opt.label)
    .join(', ')

  return (
    <div className="relative" data-testid={testId}>
      <label className="block text-sm font-medium text-muted-foreground mb-1.5">
        {label}
      </label>
      <button
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        className={cn(
          'w-full flex items-center justify-between px-3 py-2 text-sm border rounded-lg transition-colors',
          isOpen
            ? 'border-purple-500 ring-1 ring-purple-500'
            : 'border-border hover:border-purple-300',
          selectedValues.length > 0 ? 'bg-purple-50' : 'bg-card'
        )}
      >
        <div className="flex items-center gap-2 truncate">
          {Icon && <Icon className="w-4 h-4 text-muted-foreground flex-shrink-0" />}
          <span className={cn(
            'truncate',
            selectedValues.length > 0 ? 'text-foreground' : 'text-muted-foreground'
          )}>
            {selectedValues.length > 0 ? selectedLabels : placeholder}
          </span>
        </div>
        <div className="flex items-center gap-1.5">
          {selectedValues.length > 0 && (
            <span className="inline-flex items-center justify-center w-5 h-5 text-xs font-medium text-purple-700 bg-purple-200 rounded-full">
              {selectedValues.length}
            </span>
          )}
          {isOpen ? (
            <ChevronUp className="w-4 h-4 text-muted-foreground" />
          ) : (
            <ChevronDown className="w-4 h-4 text-muted-foreground" />
          )}
        </div>
      </button>

      {isOpen && (
        <div className="absolute z-20 w-full mt-1 bg-card border border-border rounded-lg shadow-lg max-h-60 overflow-auto">
          {options.length === 0 ? (
            <div className="px-3 py-2 text-sm text-muted-foreground">
              No options available
            </div>
          ) : (
            options.map((option) => (
              <button
                key={option.value}
                type="button"
                onClick={() => toggleOption(option.value)}
                className={cn(
                  'w-full flex items-center gap-2 px-3 py-2 text-sm text-left hover:bg-muted transition-colors',
                  selectedValues.includes(option.value) && 'bg-purple-50 text-purple-700'
                )}
              >
                <div
                  className={cn(
                    'w-4 h-4 border rounded flex items-center justify-center flex-shrink-0',
                    selectedValues.includes(option.value)
                      ? 'bg-purple-600 border-purple-600'
                      : 'border-border'
                  )}
                >
                  {selectedValues.includes(option.value) && (
                    <CheckCircle className="w-3 h-3 text-white" />
                  )}
                </div>
                <span className="truncate">{option.label}</span>
              </button>
            ))
          )}
        </div>
      )}
    </div>
  )
}

/**
 * Main TaskFilterPanel Component
 */
export function TaskFilterPanel({
  filters,
  onFiltersChange,
  tasks,
  meetings = [],
  className,
  defaultCollapsed = false,
}: TaskFilterPanelProps) {
  const [isCollapsed, setIsCollapsed] = useState(defaultCollapsed)

  // Extract unique assignees from tasks
  const uniqueAssignees = useMemo(() => {
    const assignees = new Set<string>()
    tasks.forEach((task) => {
      if (task.assignee) {
        assignees.add(task.assignee)
      }
    })
    return Array.from(assignees).sort().map((a) => ({ value: a, label: a }))
  }, [tasks])

  // Extract unique tags from tasks (assuming tags might be stored as comma-separated string in description or a separate field)
  // For now, we'll simulate tags extraction - in a real implementation, tags would be a proper field
  const uniqueTags = useMemo(() => {
    const tags = new Set<string>()
    // Simulated tag extraction - modify based on actual data structure
    tasks.forEach((task) => {
      // If task has tags property (extend Task type if needed)
      const taskWithTags = task as Task & { tags?: string[] }
      if (taskWithTags.tags) {
        taskWithTags.tags.forEach((tag) => tags.add(tag))
      }
    })
    return Array.from(tags).sort().map((t) => ({ value: t, label: t }))
  }, [tasks])

  // Meeting options for source meeting filter
  const meetingOptions = useMemo(() => {
    return meetings.map((m) => ({
      value: m.id,
      label: m.title,
    }))
  }, [meetings])

  // Count active filters
  const activeFilterCount = useMemo(() => {
    let count = 0
    if (filters.search) count++
    if (filters.statuses.length > 0) count += filters.statuses.length
    if (filters.priorities.length > 0) count += filters.priorities.length
    if (filters.assignees.length > 0) count += filters.assignees.length
    if (filters.tags.length > 0) count += filters.tags.length
    if (filters.meetingIds.length > 0) count += filters.meetingIds.length
    return count
  }, [filters])

  // Handlers
  const handleSearchChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      onFiltersChange({ ...filters, search: e.target.value })
    },
    [filters, onFiltersChange]
  )

  const toggleStatus = useCallback(
    (status: TaskStatus) => {
      const newStatuses = filters.statuses.includes(status)
        ? filters.statuses.filter((s) => s !== status)
        : [...filters.statuses, status]
      onFiltersChange({ ...filters, statuses: newStatuses })
    },
    [filters, onFiltersChange]
  )

  const togglePriority = useCallback(
    (priority: TaskPriority) => {
      const newPriorities = filters.priorities.includes(priority)
        ? filters.priorities.filter((p) => p !== priority)
        : [...filters.priorities, priority]
      onFiltersChange({ ...filters, priorities: newPriorities })
    },
    [filters, onFiltersChange]
  )

  const handleAssigneesChange = useCallback(
    (assignees: string[]) => {
      onFiltersChange({ ...filters, assignees })
    },
    [filters, onFiltersChange]
  )

  const handleTagsChange = useCallback(
    (tags: string[]) => {
      onFiltersChange({ ...filters, tags })
    },
    [filters, onFiltersChange]
  )

  const handleMeetingsChange = useCallback(
    (meetingIds: string[]) => {
      onFiltersChange({ ...filters, meetingIds })
    },
    [filters, onFiltersChange]
  )

  const clearAllFilters = useCallback(() => {
    onFiltersChange(DEFAULT_FILTERS)
  }, [onFiltersChange])

  return (
    <div
      className={cn('bg-card border border-border rounded-lg', className)}
      data-testid="task-filter-panel"
    >
      {/* Header */}
      <div
        className="flex items-center justify-between px-4 py-3 cursor-pointer hover:bg-muted/50 transition-colors"
        onClick={() => setIsCollapsed(!isCollapsed)}
      >
        <div className="flex items-center gap-2">
          <Filter className="w-4 h-4 text-muted-foreground" />
          <span className="font-medium text-foreground">Filters</span>
          <FilterBadge count={activeFilterCount} />
        </div>
        <div className="flex items-center gap-2">
          {activeFilterCount > 0 && (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation()
                clearAllFilters()
              }}
              className="text-xs text-muted-foreground hover:text-foreground transition-colors"
              data-testid="clear-all-filters"
            >
              Clear all
            </button>
          )}
          {isCollapsed ? (
            <ChevronDown className="w-4 h-4 text-muted-foreground" />
          ) : (
            <ChevronUp className="w-4 h-4 text-muted-foreground" />
          )}
        </div>
      </div>

      {/* Filter Content */}
      {!isCollapsed && (
        <div className="px-4 pb-4 space-y-4 border-t border-border pt-4">
          {/* Search */}
          <div>
            <label className="block text-sm font-medium text-muted-foreground mb-1.5">
              Search
            </label>
            <div className="relative">
              <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <input
                type="text"
                value={filters.search}
                onChange={handleSearchChange}
                placeholder="Search by title or description..."
                className="w-full pl-9 pr-3 py-2 text-sm border border-border rounded-lg bg-card focus:border-purple-500 focus:ring-1 focus:ring-purple-500 outline-none transition-colors"
                data-testid="task-search-input"
              />
              {filters.search && (
                <button
                  type="button"
                  onClick={() => onFiltersChange({ ...filters, search: '' })}
                  className="absolute right-3 top-1/2 transform -translate-y-1/2 text-muted-foreground hover:text-foreground"
                >
                  <X className="w-4 h-4" />
                </button>
              )}
            </div>
          </div>

          {/* Status Filter */}
          <div>
            <label className="block text-sm font-medium text-muted-foreground mb-2">
              Status
            </label>
            <div className="flex flex-wrap gap-2">
              {STATUS_OPTIONS.map((status) => (
                <FilterChip
                  key={status.value}
                  label={status.label}
                  isSelected={filters.statuses.includes(status.value)}
                  onClick={() => toggleStatus(status.value)}
                  icon={status.icon}
                  colorClass={filters.statuses.includes(status.value) ? status.colorClass : undefined}
                />
              ))}
            </div>
          </div>

          {/* Priority Filter */}
          <div>
            <label className="block text-sm font-medium text-muted-foreground mb-2">
              Priority
            </label>
            <div className="flex flex-wrap gap-2">
              {PRIORITY_OPTIONS.map((priority) => (
                <FilterChip
                  key={priority.value}
                  label={priority.label}
                  isSelected={filters.priorities.includes(priority.value)}
                  onClick={() => togglePriority(priority.value)}
                  colorClass={
                    filters.priorities.includes(priority.value)
                      ? priority.colorClass
                      : undefined
                  }
                />
              ))}
            </div>
          </div>

          {/* Assignee and Source Meeting Dropdowns */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <FilterDropdown
              label="Assignee"
              icon={User}
              options={uniqueAssignees}
              selectedValues={filters.assignees}
              onChange={handleAssigneesChange}
              placeholder="All assignees"
              testId="assignee-filter"
            />

            {meetingOptions.length > 0 && (
              <FilterDropdown
                label="Source Meeting"
                icon={Calendar}
                options={meetingOptions}
                selectedValues={filters.meetingIds}
                onChange={handleMeetingsChange}
                placeholder="All meetings"
                testId="meeting-filter"
              />
            )}
          </div>

          {/* Tags Dropdown (only show if there are tags) */}
          {uniqueTags.length > 0 && (
            <FilterDropdown
              label="Tags"
              icon={Tag}
              options={uniqueTags}
              selectedValues={filters.tags}
              onChange={handleTagsChange}
              placeholder="All tags"
              testId="tags-filter"
            />
          )}
        </div>
      )}
    </div>
  )
}

/**
 * Filter tasks based on the provided filters
 */
export function filterTasks(tasks: Task[], filters: TaskFilters): Task[] {
  return tasks.filter((task) => {
    // Search filter - check title and description
    if (filters.search) {
      const searchLower = filters.search.toLowerCase()
      const titleMatch = task.title.toLowerCase().includes(searchLower)
      const descriptionMatch = task.description?.toLowerCase().includes(searchLower) || false
      if (!titleMatch && !descriptionMatch) {
        return false
      }
    }

    // Status filter
    if (filters.statuses.length > 0 && !filters.statuses.includes(task.status)) {
      return false
    }

    // Priority filter
    if (filters.priorities.length > 0 && !filters.priorities.includes(task.priority)) {
      return false
    }

    // Assignee filter
    if (filters.assignees.length > 0) {
      if (!task.assignee || !filters.assignees.includes(task.assignee)) {
        return false
      }
    }

    // Meeting filter
    if (filters.meetingIds.length > 0) {
      if (!task.meeting_id || !filters.meetingIds.includes(task.meeting_id)) {
        return false
      }
    }

    // Tags filter (assuming task might have tags property)
    if (filters.tags.length > 0) {
      const taskWithTags = task as Task & { tags?: string[] }
      if (!taskWithTags.tags || !filters.tags.some((tag) => taskWithTags.tags?.includes(tag))) {
        return false
      }
    }

    return true
  })
}

export default TaskFilterPanel
