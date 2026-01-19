/**
 * useInfiniteTranscript Hook
 *
 * Manages chunked loading of transcript data for infinite scroll pagination.
 * This hook enables displaying large transcripts in manageable chunks of 50-100 lines,
 * loading additional segments as the user scrolls, keeping DOM size manageable
 * and enabling instant initial render.
 *
 * Features:
 * - Configurable chunk size (default: 75 groups, optimal for 50-100 lines)
 * - Bi-directional scrolling (loads more at top and bottom)
 * - Maintains scroll position when loading new chunks
 * - Supports seeking to specific indices (for search/playback sync)
 * - Memory-efficient by only keeping visible chunks in state
 */

import { useState, useCallback, useMemo, useRef, useEffect } from 'react'
import type { TranscriptGroup } from './transcript-utils'

// ============================================================================
// Types
// ============================================================================

export interface UseInfiniteTranscriptOptions {
  /** All transcript groups (full data) */
  groups: TranscriptGroup[]
  /** Number of groups to load per chunk (default: 75) */
  chunkSize?: number
  /** Initial chunk index to load (default: 0) */
  initialChunkIndex?: number
  /** Number of chunks to keep in memory (default: 3) */
  maxChunksInMemory?: number
  /** Index to seek to (e.g., for search match or playback sync) */
  seekToIndex?: number
  /** Callback when visible range changes */
  onVisibleRangeChange?: (startIndex: number, endIndex: number) => void
}

export interface UseInfiniteTranscriptResult {
  /** Currently visible transcript groups */
  visibleGroups: TranscriptGroup[]
  /** Whether there are more groups to load at the top */
  hasMoreTop: boolean
  /** Whether there are more groups to load at the bottom */
  hasMoreBottom: boolean
  /** Whether data is currently loading */
  isLoading: boolean
  /** Load more groups at the top */
  loadMoreTop: () => void
  /** Load more groups at the bottom */
  loadMoreBottom: () => void
  /** Reset to initial state */
  reset: () => void
  /** Seek to a specific index in the full data */
  seekToIndex: (index: number) => void
  /** Get the actual index in full data for a visible group index */
  getActualIndex: (visibleIndex: number) => number
  /** Get the visible index for an actual data index (-1 if not visible) */
  getVisibleIndex: (actualIndex: number) => number
  /** Total number of groups in full data */
  totalGroups: number
  /** Current offset (start index of visible data in full data) */
  currentOffset: number
  /** Stats for debugging/display */
  stats: {
    visibleCount: number
    totalCount: number
    startIndex: number
    endIndex: number
    chunksLoaded: number
  }
}

// ============================================================================
// Hook Implementation
// ============================================================================

export function useInfiniteTranscript(
  options: UseInfiniteTranscriptOptions
): UseInfiniteTranscriptResult {
  const {
    groups,
    chunkSize = 75,
    initialChunkIndex = 0,
    maxChunksInMemory = 3,
    seekToIndex: seekToIndexProp,
    onVisibleRangeChange,
  } = options

  // Track the current window of visible data
  const [startIndex, setStartIndex] = useState(() => initialChunkIndex * chunkSize)
  const [chunksLoaded, setChunksLoaded] = useState(1)
  const [isLoading, setIsLoading] = useState(false)

  // Ref to track if we've initialized based on seekToIndex
  const initializedRef = useRef(false)
  const lastSeekIndexRef = useRef<number | undefined>(undefined)

  // Calculate end index
  const endIndex = useMemo(() => {
    return Math.min(startIndex + chunksLoaded * chunkSize, groups.length)
  }, [startIndex, chunksLoaded, chunkSize, groups.length])

  // Get visible groups slice
  const visibleGroups = useMemo(() => {
    return groups.slice(startIndex, endIndex)
  }, [groups, startIndex, endIndex])

  // Check if there are more groups to load
  const hasMoreTop = startIndex > 0
  const hasMoreBottom = endIndex < groups.length

  // Load more groups at the bottom
  const loadMoreBottom = useCallback(() => {
    if (isLoading || !hasMoreBottom) return

    setIsLoading(true)

    // Simulate async loading (in a real app, this could be an API call)
    // Using setTimeout to avoid blocking the UI thread
    setTimeout(() => {
      setChunksLoaded(prev => {
        const newChunksLoaded = prev + 1

        // If we've exceeded max chunks, trim from the top
        if (newChunksLoaded > maxChunksInMemory) {
          setStartIndex(current => current + chunkSize)
          return maxChunksInMemory
        }

        return newChunksLoaded
      })
      setIsLoading(false)
    }, 0)
  }, [isLoading, hasMoreBottom, maxChunksInMemory, chunkSize])

  // Load more groups at the top
  const loadMoreTop = useCallback(() => {
    if (isLoading || !hasMoreTop) return

    setIsLoading(true)

    setTimeout(() => {
      const newStartIndex = Math.max(0, startIndex - chunkSize)
      const itemsToAdd = startIndex - newStartIndex

      if (itemsToAdd > 0) {
        setStartIndex(newStartIndex)
        setChunksLoaded(prev => {
          const newChunksLoaded = prev + 1

          // If we've exceeded max chunks, we already added to top,
          // so we effectively trim from bottom by not increasing chunks
          if (newChunksLoaded > maxChunksInMemory) {
            return maxChunksInMemory
          }

          return newChunksLoaded
        })
      }

      setIsLoading(false)
    }, 0)
  }, [isLoading, hasMoreTop, startIndex, chunkSize, maxChunksInMemory])

  // Reset to initial state
  const reset = useCallback(() => {
    setStartIndex(initialChunkIndex * chunkSize)
    setChunksLoaded(1)
    setIsLoading(false)
    initializedRef.current = false
    lastSeekIndexRef.current = undefined
  }, [initialChunkIndex, chunkSize])

  // Seek to a specific index in the full data
  const seekToIndex = useCallback((index: number) => {
    if (index < 0 || index >= groups.length) return

    // Calculate which chunk this index is in
    const targetChunkStart = Math.floor(index / chunkSize) * chunkSize

    // Center the view around the target index if possible
    const idealStart = Math.max(0, targetChunkStart - chunkSize)
    const idealEnd = Math.min(groups.length, idealStart + maxChunksInMemory * chunkSize)
    const adjustedStart = Math.max(0, idealEnd - maxChunksInMemory * chunkSize)

    setStartIndex(adjustedStart)
    setChunksLoaded(Math.min(maxChunksInMemory, Math.ceil((idealEnd - adjustedStart) / chunkSize)))
  }, [groups.length, chunkSize, maxChunksInMemory])

  // Handle seekToIndex prop changes (for search/playback)
  useEffect(() => {
    if (seekToIndexProp !== undefined && seekToIndexProp !== lastSeekIndexRef.current) {
      lastSeekIndexRef.current = seekToIndexProp
      seekToIndex(seekToIndexProp)
    }
  }, [seekToIndexProp, seekToIndex])

  // Notify about visible range changes
  useEffect(() => {
    onVisibleRangeChange?.(startIndex, endIndex)
  }, [startIndex, endIndex, onVisibleRangeChange])

  // Get actual index in full data for a visible index
  const getActualIndex = useCallback((visibleIndex: number): number => {
    return startIndex + visibleIndex
  }, [startIndex])

  // Get visible index for an actual data index
  const getVisibleIndex = useCallback((actualIndex: number): number => {
    if (actualIndex < startIndex || actualIndex >= endIndex) {
      return -1
    }
    return actualIndex - startIndex
  }, [startIndex, endIndex])

  // Stats for debugging/display
  const stats = useMemo(() => ({
    visibleCount: visibleGroups.length,
    totalCount: groups.length,
    startIndex,
    endIndex,
    chunksLoaded,
  }), [visibleGroups.length, groups.length, startIndex, endIndex, chunksLoaded])

  return {
    visibleGroups,
    hasMoreTop,
    hasMoreBottom,
    isLoading,
    loadMoreTop,
    loadMoreBottom,
    reset,
    seekToIndex,
    getActualIndex,
    getVisibleIndex,
    totalGroups: groups.length,
    currentOffset: startIndex,
    stats,
  }
}

export default useInfiniteTranscript
