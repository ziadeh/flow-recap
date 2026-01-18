/**
 * CollapsibleTranscriptSection Component
 *
 * A redesigned transcript section that is collapsed by default with an expand trigger.
 * Features:
 * - Collapsed by default to save vertical space
 * - Inline toolbar (40px height) with search, speaker filter, sort options, and export
 * - Virtual scrolling for long transcripts (>500 segments)
 * - Speaker-labeled segments with timestamps
 * - Click timestamp to seek audio
 * - Highlight current playing segment
 * - Search results highlighted in yellow
 * - Smooth collapse/expand animation
 * - Segment count in header
 */

import { useState, useMemo, useCallback, useRef, useEffect } from 'react'
import {
  ChevronDown,
  ChevronUp,
  Search,
  X,
  Filter,
  ArrowUpDown,
  Download,
  Clock,
  User,
  Check,
  Loader2,
} from 'lucide-react'
import { cn } from '../../lib/utils'
import { formatDurationMs } from '../../lib/formatters'
import { HighlightedText } from './TranscriptSearch'
import {
  getSpeakerColor,
  getSpeakerInitials,
  buildSpeakerColorIndex,
  findActiveTranscript,
  groupTranscriptsBySpeaker,
  formatTranscriptForExport,
  type TranscriptGroup,
} from './transcript-utils'
import type { Transcript, Speaker } from '../../types/database'

// ============================================================================
// Types
// ============================================================================

export type SortOption = 'time' | 'speaker'

export interface CollapsibleTranscriptSectionProps {
  /** Array of transcript entries to display */
  transcripts: Transcript[]
  /** Map of speaker IDs to Speaker objects */
  speakers: Map<string, Speaker>
  /** Map of speaker IDs to meeting-specific display names */
  speakerNameOverrides?: Map<string, string>
  /** Current audio playback time in seconds */
  currentAudioTime?: number
  /** Callback when a timestamp is clicked for audio seeking */
  onSeekAudio?: (timeInSeconds: number) => void
  /** Meeting ID for export functionality */
  meetingId?: string
  /** Whether the section is initially expanded */
  defaultExpanded?: boolean
  /** Additional class names */
  className?: string
}

// ============================================================================
// Constants
// ============================================================================

const VIRTUAL_SCROLL_THRESHOLD = 500
const SEGMENT_HEIGHT = 56 // Approximate height of each segment

// ============================================================================
// VirtualizedTranscriptList Component
// ============================================================================

interface VirtualizedTranscriptListProps {
  groups: TranscriptGroup[]
  activeGroupIndex: number
  searchQuery: string
  searchMatchIdsSet: Set<string>
  onTimestampClick: (timeMs: number) => void
  containerHeight: number
}

function VirtualizedTranscriptList({
  groups,
  activeGroupIndex,
  searchQuery,
  searchMatchIdsSet,
  onTimestampClick,
  containerHeight,
}: VirtualizedTranscriptListProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const [scrollTop, setScrollTop] = useState(0)

  const handleScroll = useCallback((e: React.UIEvent<HTMLDivElement>) => {
    setScrollTop(e.currentTarget.scrollTop)
  }, [])

  // Calculate visible range with overscan
  const overscan = 5
  const startIndex = Math.max(0, Math.floor(scrollTop / SEGMENT_HEIGHT) - overscan)
  const endIndex = Math.min(
    groups.length,
    Math.ceil((scrollTop + containerHeight) / SEGMENT_HEIGHT) + overscan
  )

  const totalHeight = groups.length * SEGMENT_HEIGHT
  const visibleGroups = groups.slice(startIndex, endIndex)

  // Auto-scroll to active segment
  useEffect(() => {
    if (activeGroupIndex >= 0 && containerRef.current) {
      const targetTop = activeGroupIndex * SEGMENT_HEIGHT
      const containerScrollTop = containerRef.current.scrollTop
      const containerBottom = containerScrollTop + containerHeight

      if (targetTop < containerScrollTop || targetTop > containerBottom - SEGMENT_HEIGHT) {
        containerRef.current.scrollTo({
          top: Math.max(0, targetTop - containerHeight / 2),
          behavior: 'smooth',
        })
      }
    }
  }, [activeGroupIndex, containerHeight])

  return (
    <div
      ref={containerRef}
      className="overflow-y-auto"
      style={{ height: containerHeight }}
      onScroll={handleScroll}
    >
      <div style={{ height: totalHeight, position: 'relative' }}>
        {visibleGroups.map((group, i) => {
          const actualIndex = startIndex + i
          const isActive = actualIndex === activeGroupIndex
          const hasSearchMatch = group.entries.some(entry => searchMatchIdsSet.has(entry.id))

          return (
            <div
              key={`${group.speakerId || 'unknown'}-${group.entries[0].id}`}
              style={{
                position: 'absolute',
                top: actualIndex * SEGMENT_HEIGHT,
                left: 0,
                right: 0,
                height: SEGMENT_HEIGHT,
              }}
            >
              <TranscriptSegmentRow
                group={group}
                isActive={isActive}
                hasSearchMatch={hasSearchMatch}
                searchQuery={searchQuery}
                onTimestampClick={onTimestampClick}
              />
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ============================================================================
// TranscriptSegmentRow Component
// ============================================================================

interface TranscriptSegmentRowProps {
  group: TranscriptGroup
  isActive: boolean
  hasSearchMatch: boolean
  searchQuery: string
  onTimestampClick: (timeMs: number) => void
}

function TranscriptSegmentRow({
  group,
  isActive,
  hasSearchMatch,
  searchQuery,
  onTimestampClick,
}: TranscriptSegmentRowProps) {
  const { speakerName, entries, colorIndex } = group
  const firstEntry = entries[0]
  const colors = getSpeakerColor(speakerName, colorIndex)
  const initials = getSpeakerInitials(speakerName)

  // Combine all entries content for this speaker group
  const combinedContent = useMemo(() => {
    return entries.map(e => e.content).join(' ')
  }, [entries])

  const handleTimestampClick = () => {
    onTimestampClick(firstEntry.start_time_ms)
  }

  return (
    <div
      className={cn(
        'flex items-start gap-2 px-2 h-full',
        'transition-colors duration-150',
        isActive && 'bg-primary/10 border-l-2 border-primary',
        hasSearchMatch && !isActive && 'bg-yellow-50 dark:bg-yellow-900/20',
        !isActive && !hasSearchMatch && 'hover:bg-muted/50'
      )}
      style={{ padding: '8px' }}
      data-testid="transcript-segment"
      data-active={isActive}
      data-search-match={hasSearchMatch}
    >
      {/* Speaker badge */}
      <div
        className={cn(
          'flex-shrink-0 px-2 py-0.5 rounded text-xs font-medium',
          colors.bg,
          colors.text
        )}
        title={speakerName}
      >
        {initials}
      </div>

      {/* Timestamp */}
      <button
        onClick={handleTimestampClick}
        className={cn(
          'flex-shrink-0 text-xs text-muted-foreground hover:text-primary',
          'hover:underline transition-colors font-mono'
        )}
        title="Click to seek to this position"
        aria-label={`Seek to ${formatDurationMs(firstEntry.start_time_ms)}`}
        style={{ fontSize: '12px' }}
      >
        {formatDurationMs(firstEntry.start_time_ms)}
      </button>

      {/* Content */}
      <div
        className="flex-1 min-w-0 text-foreground leading-snug truncate"
        style={{ fontSize: '14px' }}
      >
        {searchQuery ? (
          <HighlightedText
            text={combinedContent}
            query={searchQuery}
            isCurrentMatch={hasSearchMatch}
          />
        ) : (
          <span className="line-clamp-2">{combinedContent}</span>
        )}
      </div>
    </div>
  )
}

// ============================================================================
// SpeakerFilterDropdown Component
// ============================================================================

interface SpeakerFilterDropdownProps {
  speakers: Array<{ id: string; name: string; colorIndex: number }>
  selectedSpeakers: Set<string>
  onSelectionChange: (selected: Set<string>) => void
}

function SpeakerFilterDropdown({
  speakers,
  selectedSpeakers,
  onSelectionChange,
}: SpeakerFilterDropdownProps) {
  const [isOpen, setIsOpen] = useState(false)
  const dropdownRef = useRef<HTMLDivElement>(null)

  // Close on outside click
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  const toggleSpeaker = (speakerId: string) => {
    const newSelection = new Set(selectedSpeakers)
    if (newSelection.has(speakerId)) {
      newSelection.delete(speakerId)
    } else {
      newSelection.add(speakerId)
    }
    onSelectionChange(newSelection)
  }

  const selectAll = () => {
    onSelectionChange(new Set(speakers.map(s => s.id)))
  }

  const clearAll = () => {
    onSelectionChange(new Set())
  }

  const hasSelection = selectedSpeakers.size > 0
  const allSelected = selectedSpeakers.size === speakers.length

  return (
    <div ref={dropdownRef} className="relative">
      <button
        onClick={() => setIsOpen(!isOpen)}
        className={cn(
          'flex items-center gap-1 px-2 py-1 rounded text-xs',
          'border border-border hover:bg-muted transition-colors',
          hasSelection && !allSelected && 'bg-primary/10 border-primary'
        )}
        title="Filter by speaker"
      >
        <Filter className="w-3.5 h-3.5" />
        <span>Speaker</span>
        {hasSelection && !allSelected && (
          <span className="bg-primary text-primary-foreground px-1 rounded-full text-xs">
            {selectedSpeakers.size}
          </span>
        )}
        <ChevronDown className={cn('w-3 h-3 transition-transform', isOpen && 'rotate-180')} />
      </button>

      {isOpen && (
        <div
          className={cn(
            'absolute top-full left-0 mt-1 z-50',
            'bg-popover border border-border rounded-md shadow-lg',
            'min-w-[160px] py-1'
          )}
        >
          <div className="flex items-center justify-between px-2 py-1 border-b border-border">
            <button
              onClick={selectAll}
              className="text-xs text-primary hover:underline"
            >
              Select all
            </button>
            <button
              onClick={clearAll}
              className="text-xs text-muted-foreground hover:text-foreground"
            >
              Clear
            </button>
          </div>
          <div className="max-h-[200px] overflow-y-auto py-1">
            {speakers.map((speaker) => {
              const colors = getSpeakerColor(speaker.name, speaker.colorIndex)
              const isSelected = selectedSpeakers.has(speaker.id)

              return (
                <button
                  key={speaker.id}
                  onClick={() => toggleSpeaker(speaker.id)}
                  className={cn(
                    'w-full flex items-center gap-2 px-2 py-1.5 text-left',
                    'hover:bg-muted transition-colors'
                  )}
                >
                  <div
                    className={cn(
                      'w-4 h-4 rounded border flex items-center justify-center',
                      isSelected ? 'bg-primary border-primary' : 'border-border'
                    )}
                  >
                    {isSelected && <Check className="w-3 h-3 text-primary-foreground" />}
                  </div>
                  <span
                    className={cn('px-1.5 py-0.5 rounded text-xs', colors.bg, colors.text)}
                  >
                    {getSpeakerInitials(speaker.name)}
                  </span>
                  <span className="text-sm truncate">{speaker.name}</span>
                </button>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}

// ============================================================================
// SortDropdown Component
// ============================================================================

interface SortDropdownProps {
  value: SortOption
  onChange: (value: SortOption) => void
}

function SortDropdown({ value, onChange }: SortDropdownProps) {
  const [isOpen, setIsOpen] = useState(false)
  const dropdownRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  const options: Array<{ value: SortOption; label: string; icon: React.ReactNode }> = [
    { value: 'time', label: 'By time', icon: <Clock className="w-3.5 h-3.5" /> },
    { value: 'speaker', label: 'By speaker', icon: <User className="w-3.5 h-3.5" /> },
  ]

  const currentOption = options.find(o => o.value === value)

  return (
    <div ref={dropdownRef} className="relative">
      <button
        onClick={() => setIsOpen(!isOpen)}
        className={cn(
          'flex items-center gap-1 px-2 py-1 rounded text-xs',
          'border border-border hover:bg-muted transition-colors'
        )}
        title="Sort options"
      >
        <ArrowUpDown className="w-3.5 h-3.5" />
        <span>{currentOption?.label}</span>
        <ChevronDown className={cn('w-3 h-3 transition-transform', isOpen && 'rotate-180')} />
      </button>

      {isOpen && (
        <div
          className={cn(
            'absolute top-full left-0 mt-1 z-50',
            'bg-popover border border-border rounded-md shadow-lg',
            'min-w-[120px] py-1'
          )}
        >
          {options.map((option) => (
            <button
              key={option.value}
              onClick={() => {
                onChange(option.value)
                setIsOpen(false)
              }}
              className={cn(
                'w-full flex items-center gap-2 px-2 py-1.5 text-left text-sm',
                'hover:bg-muted transition-colors',
                value === option.value && 'bg-muted'
              )}
            >
              {option.icon}
              <span>{option.label}</span>
              {value === option.value && <Check className="w-3.5 h-3.5 ml-auto" />}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

// ============================================================================
// CollapsibleTranscriptSection Component
// ============================================================================

export function CollapsibleTranscriptSection({
  transcripts,
  speakers,
  speakerNameOverrides = new Map(),
  currentAudioTime = 0,
  onSeekAudio,
  meetingId,
  defaultExpanded = false,
  className,
}: CollapsibleTranscriptSectionProps) {
  // State
  const [isExpanded, setIsExpanded] = useState(defaultExpanded)
  const [searchQuery, setSearchQuery] = useState('')
  const [selectedSpeakers, setSelectedSpeakers] = useState<Set<string>>(new Set())
  const [sortOption, setSortOption] = useState<SortOption>('time')
  const [isExporting, setIsExporting] = useState(false)
  const searchInputRef = useRef<HTMLInputElement>(null)
  const contentRef = useRef<HTMLDivElement>(null)

  // Build speaker color index
  const speakerColorIndex = useMemo(
    () => buildSpeakerColorIndex(transcripts),
    [transcripts]
  )

  // Get unique speakers list for filter
  const uniqueSpeakers = useMemo(() => {
    const speakersMap = new Map<string, { id: string; name: string; colorIndex: number }>()

    transcripts.forEach((transcript) => {
      if (transcript.speaker_id && !speakersMap.has(transcript.speaker_id)) {
        const speaker = speakers.get(transcript.speaker_id)
        const override = speakerNameOverrides.get(transcript.speaker_id)
        const name = override || speaker?.name || `Speaker ${speakerColorIndex.get(transcript.speaker_id) ?? 0 + 1}`

        speakersMap.set(transcript.speaker_id, {
          id: transcript.speaker_id,
          name,
          colorIndex: speakerColorIndex.get(transcript.speaker_id) ?? 0,
        })
      }
    })

    return Array.from(speakersMap.values())
  }, [transcripts, speakers, speakerNameOverrides, speakerColorIndex])

  // Initialize speaker filter to include all speakers
  useEffect(() => {
    if (selectedSpeakers.size === 0 && uniqueSpeakers.length > 0) {
      setSelectedSpeakers(new Set(uniqueSpeakers.map(s => s.id)))
    }
  }, [uniqueSpeakers, selectedSpeakers.size])

  // Filter transcripts by selected speakers
  const filteredTranscripts = useMemo(() => {
    if (selectedSpeakers.size === 0) return transcripts
    return transcripts.filter(t => t.speaker_id && selectedSpeakers.has(t.speaker_id))
  }, [transcripts, selectedSpeakers])

  // Sort transcripts
  const sortedTranscripts = useMemo(() => {
    const sorted = [...filteredTranscripts]
    if (sortOption === 'speaker') {
      sorted.sort((a, b) => {
        const speakerA = a.speaker_id || ''
        const speakerB = b.speaker_id || ''
        if (speakerA !== speakerB) {
          return speakerA.localeCompare(speakerB)
        }
        return a.start_time_ms - b.start_time_ms
      })
    } else {
      sorted.sort((a, b) => a.start_time_ms - b.start_time_ms)
    }
    return sorted
  }, [filteredTranscripts, sortOption])

  // Group transcripts by speaker
  const messageGroups = useMemo(
    () => groupTranscriptsBySpeaker(sortedTranscripts, speakers, speakerColorIndex, speakerNameOverrides),
    [sortedTranscripts, speakers, speakerColorIndex, speakerNameOverrides]
  )

  // Find matching transcript IDs for search
  const searchMatchIds = useMemo(() => {
    if (!searchQuery.trim()) return new Set<string>()

    const lowerQuery = searchQuery.toLowerCase()
    const matchingIds = new Set<string>()

    sortedTranscripts.forEach((t) => {
      if (t.content.toLowerCase().includes(lowerQuery)) {
        matchingIds.add(t.id)
      }
    })

    return matchingIds
  }, [sortedTranscripts, searchQuery])

  // Find the active transcript based on current audio time
  const activeTranscriptId = useMemo(
    () => findActiveTranscript(sortedTranscripts, currentAudioTime),
    [sortedTranscripts, currentAudioTime]
  )

  // Find which group contains the active transcript
  const activeGroupIndex = useMemo(() => {
    if (!activeTranscriptId) return -1
    return messageGroups.findIndex(group =>
      group.entries.some(entry => entry.id === activeTranscriptId)
    )
  }, [messageGroups, activeTranscriptId])

  // Handle timestamp click
  const handleTimestampClick = useCallback((timeMs: number) => {
    if (onSeekAudio) {
      onSeekAudio(timeMs / 1000)
    }
  }, [onSeekAudio])

  // Handle export
  const handleExport = useCallback(async () => {
    if (!meetingId || sortedTranscripts.length === 0) return

    setIsExporting(true)
    try {
      const exportContent = formatTranscriptForExport(sortedTranscripts, speakers, {
        format: 'text',
        includeTimestamps: true,
        mergeSegments: true,
      })

      // Create and download file
      const blob = new Blob([exportContent as string], { type: 'text/plain' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `transcript-${meetingId}.txt`
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      URL.revokeObjectURL(url)
    } catch (error) {
      console.error('Export failed:', error)
    } finally {
      setIsExporting(false)
    }
  }, [meetingId, sortedTranscripts, speakers])

  // Handle search clear
  const handleClearSearch = () => {
    setSearchQuery('')
    searchInputRef.current?.focus()
  }

  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (!isExpanded) return

      if ((e.metaKey || e.ctrlKey) && e.key === 'f') {
        e.preventDefault()
        searchInputRef.current?.focus()
      }
      if (e.key === 'Escape' && searchQuery) {
        handleClearSearch()
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [isExpanded, searchQuery])

  // Use virtual scrolling for long transcripts
  const useVirtualScrolling = messageGroups.length > VIRTUAL_SCROLL_THRESHOLD

  // Segment count
  const segmentCount = transcripts.length

  return (
    <div
      className={cn('border border-border rounded-lg overflow-hidden', className)}
      data-testid="collapsible-transcript-section"
    >
      {/* Header - Always visible */}
      <button
        onClick={() => setIsExpanded(!isExpanded)}
        className={cn(
          'w-full flex items-center justify-between px-4 py-3',
          'bg-muted/30 hover:bg-muted/50 transition-colors',
          'text-left'
        )}
        aria-expanded={isExpanded}
        aria-controls="transcript-content"
      >
        <div className="flex items-center gap-2">
          {isExpanded ? (
            <ChevronUp className="w-4 h-4 text-muted-foreground" />
          ) : (
            <ChevronDown className="w-4 h-4 text-muted-foreground" />
          )}
          <span className="font-medium">Transcript</span>
          <span className="text-sm text-muted-foreground">
            ({segmentCount} segment{segmentCount !== 1 ? 's' : ''})
          </span>
        </div>
        {!isExpanded && segmentCount > 0 && (
          <span className="text-xs text-muted-foreground">
            Click to expand
          </span>
        )}
      </button>

      {/* Expandable Content */}
      <div
        id="transcript-content"
        ref={contentRef}
        className={cn(
          'transition-all duration-300 ease-in-out overflow-hidden',
          isExpanded ? 'max-h-[600px] opacity-100' : 'max-h-0 opacity-0'
        )}
      >
        {transcripts.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 text-center">
            <p className="text-sm text-muted-foreground">
              No transcript available yet.
            </p>
          </div>
        ) : (
          <>
            {/* Toolbar - 40px height */}
            <div
              className={cn(
                'flex items-center gap-2 px-3 border-b border-border',
                'bg-background'
              )}
              style={{ height: '40px' }}
            >
              {/* Search input */}
              <div className="flex-1 flex items-center gap-1 max-w-xs">
                <div className="relative flex-1">
                  <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
                  <input
                    ref={searchInputRef}
                    type="text"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    placeholder="Search..."
                    className={cn(
                      'w-full pl-7 pr-7 py-1 text-sm rounded',
                      'bg-muted/50 border border-transparent',
                      'focus:border-primary focus:outline-none',
                      'placeholder:text-muted-foreground'
                    )}
                  />
                  {searchQuery && (
                    <button
                      onClick={handleClearSearch}
                      className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>
                {searchQuery && searchMatchIds.size > 0 && (
                  <span className="text-xs text-muted-foreground whitespace-nowrap">
                    {searchMatchIds.size} match{searchMatchIds.size !== 1 ? 'es' : ''}
                  </span>
                )}
              </div>

              {/* Spacer */}
              <div className="flex-1" />

              {/* Speaker filter */}
              {uniqueSpeakers.length > 1 && (
                <SpeakerFilterDropdown
                  speakers={uniqueSpeakers}
                  selectedSpeakers={selectedSpeakers}
                  onSelectionChange={setSelectedSpeakers}
                />
              )}

              {/* Sort options */}
              <SortDropdown value={sortOption} onChange={setSortOption} />

              {/* Export button */}
              <button
                onClick={handleExport}
                disabled={isExporting || sortedTranscripts.length === 0}
                className={cn(
                  'flex items-center gap-1 px-2 py-1 rounded text-xs',
                  'border border-border hover:bg-muted transition-colors',
                  'disabled:opacity-50 disabled:cursor-not-allowed'
                )}
                title="Export transcript"
              >
                {isExporting ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <Download className="w-3.5 h-3.5" />
                )}
                <span>Export</span>
              </button>
            </div>

            {/* Transcript content */}
            <div className="bg-background">
              {messageGroups.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-8 text-center">
                  <p className="text-sm text-muted-foreground">
                    No transcripts match the current filters.
                  </p>
                </div>
              ) : useVirtualScrolling ? (
                <VirtualizedTranscriptList
                  groups={messageGroups}
                  activeGroupIndex={activeGroupIndex}
                  searchQuery={searchQuery}
                  searchMatchIdsSet={searchMatchIds}
                  onTimestampClick={handleTimestampClick}
                  containerHeight={Math.min(messageGroups.length * SEGMENT_HEIGHT, 500)}
                />
              ) : (
                <div
                  className="overflow-y-auto"
                  style={{ maxHeight: '500px' }}
                >
                  {messageGroups.map((group, index) => {
                    const isActive = index === activeGroupIndex
                    const hasSearchMatch = group.entries.some(entry =>
                      searchMatchIds.has(entry.id)
                    )

                    return (
                      <TranscriptSegmentRow
                        key={`${group.speakerId || 'unknown'}-${group.entries[0].id}`}
                        group={group}
                        isActive={isActive}
                        hasSearchMatch={hasSearchMatch}
                        searchQuery={searchQuery}
                        onTimestampClick={handleTimestampClick}
                      />
                    )
                  })}
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  )
}

export default CollapsibleTranscriptSection
