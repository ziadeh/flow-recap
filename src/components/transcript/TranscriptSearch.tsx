/**
 * TranscriptSearch Component
 * Provides full-text search functionality for meeting transcripts using SQLite FTS5.
 * Features include:
 * - Real-time search with debouncing
 * - Result highlighting in transcript
 * - Navigation between search matches
 * - Keyboard shortcuts (Cmd/Ctrl+F, Enter, Shift+Enter)
 */

import { useState, useEffect, useCallback, useRef, useMemo } from 'react'
import { Search, X, ChevronUp, ChevronDown, Loader2 } from 'lucide-react'
import { cn } from '../../lib/utils'

// ============================================================================
// Types
// ============================================================================

export interface TranscriptSearchProps {
  /** Meeting ID to search within */
  meetingId: string
  /** Callback when search matches are found */
  onSearchResults?: (matchingIds: string[], currentIndex: number) => void
  /** Callback when user navigates to a specific result */
  onNavigateToResult?: (transcriptId: string) => void
  /** Current highlighted transcript ID from parent */
  highlightedTranscriptId?: string
  /** Callback when search query changes */
  onQueryChange?: (query: string) => void
  /** Additional class names */
  className?: string
  /** Placeholder text */
  placeholder?: string
  /** Whether the search is initially expanded */
  initialExpanded?: boolean
}

export interface SearchState {
  query: string
  matchingIds: string[]
  currentIndex: number
  isSearching: boolean
  totalCount: number
}

// ============================================================================
// Hook: useTranscriptSearch
// ============================================================================

export function useTranscriptSearch(meetingId: string) {
  const [state, setState] = useState<SearchState>({
    query: '',
    matchingIds: [],
    currentIndex: 0,
    isSearching: false,
    totalCount: 0
  })

  const searchTimeoutRef = useRef<NodeJS.Timeout | null>(null)

  // Perform search with debouncing
  const search = useCallback(async (query: string) => {
    // Clear any pending search
    if (searchTimeoutRef.current) {
      clearTimeout(searchTimeoutRef.current)
    }

    if (!query.trim()) {
      setState(prev => ({
        ...prev,
        query,
        matchingIds: [],
        currentIndex: 0,
        isSearching: false,
        totalCount: 0
      }))
      return
    }

    setState(prev => ({ ...prev, query, isSearching: true }))

    // Debounce the actual search
    searchTimeoutRef.current = setTimeout(async () => {
      try {
        const matchingIds = await window.electronAPI.db.transcripts.getMatchingTranscriptIds(
          meetingId,
          query
        )

        setState(prev => ({
          ...prev,
          matchingIds,
          currentIndex: matchingIds.length > 0 ? 0 : -1,
          isSearching: false,
          totalCount: matchingIds.length
        }))
      } catch (error) {
        console.error('Search failed:', error)
        setState(prev => ({
          ...prev,
          matchingIds: [],
          currentIndex: -1,
          isSearching: false,
          totalCount: 0
        }))
      }
    }, 200)
  }, [meetingId])

  // Navigate to next result
  const goToNext = useCallback(() => {
    setState(prev => {
      if (prev.matchingIds.length === 0) return prev
      const nextIndex = (prev.currentIndex + 1) % prev.matchingIds.length
      return { ...prev, currentIndex: nextIndex }
    })
  }, [])

  // Navigate to previous result
  const goToPrevious = useCallback(() => {
    setState(prev => {
      if (prev.matchingIds.length === 0) return prev
      const prevIndex = prev.currentIndex <= 0
        ? prev.matchingIds.length - 1
        : prev.currentIndex - 1
      return { ...prev, currentIndex: prevIndex }
    })
  }, [])

  // Clear search
  const clearSearch = useCallback(() => {
    if (searchTimeoutRef.current) {
      clearTimeout(searchTimeoutRef.current)
    }
    setState({
      query: '',
      matchingIds: [],
      currentIndex: 0,
      isSearching: false,
      totalCount: 0
    })
  }, [])

  // Get current matching transcript ID
  const currentMatchId = useMemo(() => {
    if (state.currentIndex < 0 || state.currentIndex >= state.matchingIds.length) {
      return null
    }
    return state.matchingIds[state.currentIndex]
  }, [state.matchingIds, state.currentIndex])

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (searchTimeoutRef.current) {
        clearTimeout(searchTimeoutRef.current)
      }
    }
  }, [])

  return {
    ...state,
    currentMatchId,
    search,
    goToNext,
    goToPrevious,
    clearSearch
  }
}

// ============================================================================
// TranscriptSearch Component
// ============================================================================

export function TranscriptSearch({
  meetingId,
  onSearchResults,
  onNavigateToResult,
  onQueryChange,
  className,
  placeholder = 'Search transcript...',
  initialExpanded = false
}: TranscriptSearchProps) {
  const [isExpanded, setIsExpanded] = useState(initialExpanded)
  const inputRef = useRef<HTMLInputElement>(null)

  const {
    query,
    matchingIds,
    currentIndex,
    isSearching,
    totalCount,
    currentMatchId,
    search,
    goToNext,
    goToPrevious,
    clearSearch
  } = useTranscriptSearch(meetingId)

  // Notify parent of search results
  useEffect(() => {
    onSearchResults?.(matchingIds, currentIndex)
  }, [matchingIds, currentIndex, onSearchResults])

  // Notify parent of current match for scrolling
  useEffect(() => {
    if (currentMatchId) {
      onNavigateToResult?.(currentMatchId)
    }
  }, [currentMatchId, onNavigateToResult])

  // Notify parent of query changes
  useEffect(() => {
    onQueryChange?.(query)
  }, [query, onQueryChange])

  // Handle keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Cmd/Ctrl+F to focus search
      if ((e.metaKey || e.ctrlKey) && e.key === 'f') {
        e.preventDefault()
        setIsExpanded(true)
        setTimeout(() => inputRef.current?.focus(), 0)
      }

      // Escape to close search
      if (e.key === 'Escape' && isExpanded) {
        clearSearch()
        setIsExpanded(false)
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [isExpanded, clearSearch])

  // Handle input keyboard navigation
  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault()
      if (e.shiftKey) {
        goToPrevious()
      } else {
        goToNext()
      }
    }
    if (e.key === 'Escape') {
      clearSearch()
      setIsExpanded(false)
    }
  }

  // Toggle search expansion
  const toggleExpanded = () => {
    if (isExpanded) {
      clearSearch()
    }
    setIsExpanded(!isExpanded)
    if (!isExpanded) {
      setTimeout(() => inputRef.current?.focus(), 0)
    }
  }

  // Collapsed state - just show search button
  if (!isExpanded) {
    return (
      <button
        onClick={toggleExpanded}
        className={cn(
          'p-2 rounded-lg hover:bg-muted transition-colors',
          'text-muted-foreground hover:text-foreground',
          className
        )}
        title="Search transcript (Cmd/Ctrl+F)"
        aria-label="Search transcript"
      >
        <Search className="w-5 h-5" />
      </button>
    )
  }

  // Expanded state - show full search UI
  return (
    <div
      className={cn(
        'flex items-center gap-2 px-3 py-2 rounded-lg',
        'bg-muted/50 border border-border',
        'focus-within:ring-2 focus-within:ring-ring focus-within:ring-offset-2',
        className
      )}
      role="search"
      aria-label="Search transcript"
    >
      {/* Search icon / loading */}
      <div className="flex-shrink-0">
        {isSearching ? (
          <Loader2 className="w-4 h-4 text-muted-foreground animate-spin" aria-hidden="true" />
        ) : (
          <Search className="w-4 h-4 text-muted-foreground" aria-hidden="true" />
        )}
      </div>

      {/* Search input */}
      <input
        ref={inputRef}
        type="text"
        value={query}
        onChange={(e) => search(e.target.value)}
        onKeyDown={handleKeyDown}
        placeholder={placeholder}
        className={cn(
          'flex-1 min-w-0 bg-transparent border-none outline-none',
          'text-sm text-foreground placeholder:text-muted-foreground'
        )}
        aria-label="Search query"
        aria-describedby={query ? 'search-results-count' : undefined}
      />

      {/* Results count */}
      {query && (
        <div
          id="search-results-count"
          className="flex-shrink-0 text-xs text-muted-foreground"
          aria-live="polite"
        >
          {isSearching ? (
            'Searching...'
          ) : totalCount > 0 ? (
            <span>
              {currentIndex + 1} of {totalCount}
            </span>
          ) : (
            'No results'
          )}
        </div>
      )}

      {/* Navigation buttons */}
      {totalCount > 0 && (
        <div className="flex items-center gap-0.5 flex-shrink-0">
          <button
            onClick={goToPrevious}
            className={cn(
              'p-1 rounded hover:bg-muted transition-colors',
              'text-muted-foreground hover:text-foreground'
            )}
            title="Previous result (Shift+Enter)"
            aria-label="Previous result"
          >
            <ChevronUp className="w-4 h-4" />
          </button>
          <button
            onClick={goToNext}
            className={cn(
              'p-1 rounded hover:bg-muted transition-colors',
              'text-muted-foreground hover:text-foreground'
            )}
            title="Next result (Enter)"
            aria-label="Next result"
          >
            <ChevronDown className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* Clear button */}
      <button
        onClick={toggleExpanded}
        className={cn(
          'p-1 rounded hover:bg-muted transition-colors',
          'text-muted-foreground hover:text-foreground'
        )}
        title="Close search (Esc)"
        aria-label="Close search"
      >
        <X className="w-4 h-4" />
      </button>
    </div>
  )
}

// ============================================================================
// HighlightedText Component - For rendering text with search highlights
// ============================================================================

export interface HighlightedTextProps {
  /** The full text to display */
  text: string
  /** The search query to highlight */
  query: string
  /** Whether this transcript is a current search match */
  isCurrentMatch?: boolean
  /** Additional class names for the container */
  className?: string
  /** Class names for highlighted portions */
  highlightClassName?: string
}

export function HighlightedText({
  text,
  query,
  isCurrentMatch = false,
  className,
  highlightClassName
}: HighlightedTextProps) {
  // If no query, return plain text
  if (!query.trim()) {
    return <span className={className}>{text}</span>
  }

  // Find all match positions (case-insensitive)
  const lowerText = text.toLowerCase()
  const lowerQuery = query.toLowerCase()
  const parts: Array<{ text: string; isMatch: boolean }> = []

  let lastIndex = 0
  let index = lowerText.indexOf(lowerQuery, lastIndex)

  while (index !== -1) {
    // Add non-matching text before this match
    if (index > lastIndex) {
      parts.push({
        text: text.slice(lastIndex, index),
        isMatch: false
      })
    }

    // Add the matching text
    parts.push({
      text: text.slice(index, index + query.length),
      isMatch: true
    })

    lastIndex = index + query.length
    index = lowerText.indexOf(lowerQuery, lastIndex)
  }

  // Add remaining non-matching text
  if (lastIndex < text.length) {
    parts.push({
      text: text.slice(lastIndex),
      isMatch: false
    })
  }

  // If no matches found, return plain text
  if (parts.length === 0) {
    return <span className={className}>{text}</span>
  }

  return (
    <span className={className}>
      {parts.map((part, i) => {
        if (part.isMatch) {
          return (
            <mark
              key={i}
              className={cn(
                'bg-yellow-200 dark:bg-yellow-800 text-foreground rounded-sm px-0.5',
                isCurrentMatch && 'bg-orange-300 dark:bg-orange-700 ring-2 ring-orange-500',
                highlightClassName
              )}
            >
              {part.text}
            </mark>
          )
        }
        return <span key={i}>{part.text}</span>
      })}
    </span>
  )
}

// ============================================================================
// Exports
// ============================================================================

export default TranscriptSearch
