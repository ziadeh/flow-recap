import { useState, useEffect, useCallback, useRef } from 'react'
import type { Meeting, Transcript, MeetingNote, Task, Speaker, Recording, MeetingSpeakerName } from '../types/database'
import {
  sortTranscriptsSync,
  sortNotesSync,
  sortTasksSync,
  SORT_WORKER_THRESHOLD
} from './useSortWorker'
import type { TranscriptItem, NoteItem, TaskItem, SortResponse, SortRequest } from '../workers/sortWorker'

interface UseMeetingDetailReturn {
  meeting: Meeting | null
  transcripts: Transcript[]
  notes: MeetingNote[]
  tasks: Task[]
  recordings: Recording[]
  speakers: Map<string, Speaker>
  speakerNameOverrides: Map<string, string>  // speaker_id -> display_name for this meeting
  isLoading: boolean
  isSorting: boolean  // New: indicates sorting operation in progress
  error: Error | null
  refetch: () => Promise<void>
  // Pagination info for transcripts
  transcriptCount: number
  hasMoreTranscripts: boolean
  loadMoreTranscripts: () => Promise<void>
}

const TRANSCRIPT_PAGE_SIZE = 100

/** Timeout for worker operations in milliseconds */
const WORKER_TIMEOUT = 30000 // 30 seconds

/**
 * Check if Web Workers are supported in the current environment
 */
function isWorkerSupported(): boolean {
  return typeof Worker !== 'undefined'
}

/**
 * Custom hook to fetch all data for a meeting detail page
 * Fetches meeting, transcripts, notes, tasks, and related speakers
 * Optimized to only fetch speakers for the current meeting
 *
 * Performance optimization:
 * - Uses Web Worker for sorting large datasets (>200 items) to prevent UI blocking
 * - Falls back to synchronous sorting for small datasets or when workers unavailable
 */
export function useMeetingDetail(meetingId: string | undefined): UseMeetingDetailReturn {
  const [meeting, setMeeting] = useState<Meeting | null>(null)
  const [transcripts, setTranscripts] = useState<Transcript[]>([])
  const [notes, setNotes] = useState<MeetingNote[]>([])
  const [tasks, setTasks] = useState<Task[]>([])
  const [recordings, setRecordings] = useState<Recording[]>([])
  const [speakers, setSpeakers] = useState<Map<string, Speaker>>(new Map())
  const [speakerNameOverrides, setSpeakerNameOverrides] = useState<Map<string, string>>(new Map())
  const [isLoading, setIsLoading] = useState(true)
  const [isSorting, setIsSorting] = useState(false)
  const [error, setError] = useState<Error | null>(null)
  const [transcriptCount, setTranscriptCount] = useState(0)
  const [hasMoreTranscripts, setHasMoreTranscripts] = useState(false)
  const [transcriptOffset, setTranscriptOffset] = useState(0)

  // Worker reference and pending requests
  const workerRef = useRef<Worker | null>(null)
  const workerReadyRef = useRef(false)
  const pendingRequestsRef = useRef<Map<string, {
    resolve: (value: unknown) => void
    reject: (error: Error) => void
    timeoutId: ReturnType<typeof setTimeout>
  }>>(new Map())
  const requestIdCounterRef = useRef(0)

  // Initialize worker on mount
  useEffect(() => {
    if (!isWorkerSupported()) {
      console.warn('Web Workers not supported, using main-thread sorting')
      return
    }

    try {
      const worker = new Worker(
        new URL('../workers/sortWorker.ts', import.meta.url),
        { type: 'module' }
      )

      worker.onmessage = (event: MessageEvent<SortResponse | { type: 'ready' }>) => {
        const response = event.data

        if (response.type === 'ready') {
          workerReadyRef.current = true
          return
        }

        const pending = pendingRequestsRef.current.get(response.requestId)
        if (pending) {
          clearTimeout(pending.timeoutId)
          pendingRequestsRef.current.delete(response.requestId)

          if (response.type === 'error') {
            pending.reject(new Error(response.error))
          } else {
            pending.resolve(response.data)
          }

          if (pendingRequestsRef.current.size === 0) {
            setIsSorting(false)
          }
        }
      }

      worker.onerror = (error) => {
        console.error('Sort worker error:', error)
        pendingRequestsRef.current.forEach((pending) => {
          clearTimeout(pending.timeoutId)
          pending.reject(new Error('Worker error occurred'))
        })
        pendingRequestsRef.current.clear()
        setIsSorting(false)
        workerReadyRef.current = false
      }

      workerRef.current = worker
    } catch (err) {
      console.error('Failed to initialize sort worker:', err)
    }

    return () => {
      if (workerRef.current) {
        pendingRequestsRef.current.forEach((pending) => {
          clearTimeout(pending.timeoutId)
          pending.reject(new Error('Worker terminated'))
        })
        pendingRequestsRef.current.clear()
        workerRef.current.terminate()
        workerRef.current = null
        workerReadyRef.current = false
      }
    }
  }, [])

  // Helper to sort using worker or fallback
  const sortWithWorkerOrFallback = useCallback(async <T extends TranscriptItem | NoteItem | TaskItem>(
    data: T[],
    type: 'sortTranscripts' | 'sortNotes' | 'sortTasks',
    fallbackSort: (data: T[]) => T[]
  ): Promise<T[]> => {
    // Use synchronous sorting for small datasets or if worker not available
    if (data.length < SORT_WORKER_THRESHOLD || !workerRef.current || !workerReadyRef.current) {
      return fallbackSort(data)
    }

    return new Promise((resolve) => {
      const requestId = `sort-${++requestIdCounterRef.current}-${Date.now()}`

      const timeoutId = setTimeout(() => {
        pendingRequestsRef.current.delete(requestId)
        if (pendingRequestsRef.current.size === 0) {
          setIsSorting(false)
        }
        console.warn('Worker sort timed out, falling back to sync sort')
        resolve(fallbackSort(data))
      }, WORKER_TIMEOUT)

      pendingRequestsRef.current.set(requestId, {
        resolve: (result) => resolve(result as T[]),
        reject: () => resolve(fallbackSort(data)), // Fall back on error
        timeoutId
      })

      setIsSorting(true)

      const request: SortRequest = {
        type,
        requestId,
        data: data as TranscriptItem[] | NoteItem[] | TaskItem[]
      } as SortRequest

      workerRef.current!.postMessage(request)
    })
  }, [])

  const fetchData = useCallback(async () => {
    if (!meetingId) {
      setIsLoading(false)
      return
    }

    try {
      setIsLoading(true)
      setError(null)
      setTranscriptOffset(0)

      // Fetch all data in parallel - use optimized speaker fetch when available
      const speakersApi = window.electronAPI.db.speakers as {
        getAll: () => Promise<Speaker[]>
        getByMeetingId?: (meetingId: string) => Promise<Speaker[]>
      }

      const [
        meetingData,
        transcriptsData,
        notesData,
        tasksData,
        recordingsData,
        meetingSpeakers,
        speakerNameOverridesData,
      ] = await Promise.all([
        window.electronAPI.db.meetings.getById(meetingId),
        // Fetch transcripts - all at once for now, but pagination is available
        window.electronAPI.db.transcripts.getByMeetingId(meetingId),
        window.electronAPI.db.meetingNotes.getByMeetingId(meetingId),
        window.electronAPI.db.tasks.getByMeetingId(meetingId),
        window.electronAPI.db.recordings.getByMeetingId(meetingId),
        // OPTIMIZATION: Only fetch speakers for this meeting, not all speakers
        // Falls back to getAll() if getByMeetingId is not available
        speakersApi.getByMeetingId
          ? speakersApi.getByMeetingId(meetingId)
          : speakersApi.getAll(),
        // Fetch meeting-specific speaker name overrides
        window.electronAPI.db.meetingSpeakerNames.getByMeetingId(meetingId),
      ])

      setMeeting(meetingData)

      // Sort recordings synchronously (typically small dataset)
      setRecordings(recordingsData.sort((a, b) => new Date(b.start_time).getTime() - new Date(a.start_time).getTime()))

      // Use worker-based sorting for potentially large datasets
      // This prevents UI blocking during large meeting data processing
      const [sortedTranscripts, sortedNotes, sortedTasks] = await Promise.all([
        // Sort transcripts - use worker if exceeds threshold (>200 segments)
        sortWithWorkerOrFallback(
          transcriptsData as TranscriptItem[],
          'sortTranscripts',
          sortTranscriptsSync
        ),
        // Sort notes - use worker if exceeds threshold
        sortWithWorkerOrFallback(
          notesData as NoteItem[],
          'sortNotes',
          sortNotesSync
        ),
        // Sort tasks - use worker if exceeds threshold
        sortWithWorkerOrFallback(
          tasksData as TaskItem[],
          'sortTasks',
          sortTasksSync
        )
      ])

      setTranscripts(sortedTranscripts as Transcript[])
      setTranscriptCount(sortedTranscripts.length)
      setHasMoreTranscripts(false) // All loaded at once for now
      setNotes(sortedNotes as MeetingNote[])
      setTasks(sortedTasks as Task[])

      // Build speaker map for O(1) lookup from meeting-specific speakers
      const speakerMap = new Map<string, Speaker>()
      meetingSpeakers.forEach(speaker => {
        speakerMap.set(speaker.id, speaker)
      })
      setSpeakers(speakerMap)

      // Build speaker name overrides map for O(1) lookup
      const overridesMap = new Map<string, string>()
      speakerNameOverridesData.forEach((override: MeetingSpeakerName) => {
        overridesMap.set(override.speaker_id, override.display_name)
      })
      setSpeakerNameOverrides(overridesMap)
    } catch (err) {
      console.error('Failed to fetch meeting data:', err)
      setError(err instanceof Error ? err : new Error('Failed to fetch meeting data'))
    } finally {
      setIsLoading(false)
    }
  }, [meetingId])

  // Load more transcripts (for lazy loading when needed)
  const loadMoreTranscripts = useCallback(async () => {
    if (!meetingId || !hasMoreTranscripts) return

    try {
      const transcriptsApi = window.electronAPI.db.transcripts as {
        getByMeetingIdPaginated?: (meetingId: string, options?: { limit?: number; offset?: number }) => Promise<{
          data: Transcript[]
          total: number
          hasMore: boolean
          offset: number
          limit: number
        }>
      }

      if (!transcriptsApi.getByMeetingIdPaginated) {
        console.warn('Paginated transcript loading not available')
        return
      }

      const newOffset = transcriptOffset + TRANSCRIPT_PAGE_SIZE
      const result = await transcriptsApi.getByMeetingIdPaginated(meetingId, {
        limit: TRANSCRIPT_PAGE_SIZE,
        offset: newOffset
      })

      setTranscripts(prev => [...prev, ...result.data])
      setTranscriptOffset(newOffset)
      setHasMoreTranscripts(result.hasMore)
    } catch (err) {
      console.error('Failed to load more transcripts:', err)
    }
  }, [meetingId, hasMoreTranscripts, transcriptOffset])

  useEffect(() => {
    fetchData()
  }, [fetchData])

  return {
    meeting,
    transcripts,
    notes,
    tasks,
    recordings,
    speakers,
    speakerNameOverrides,
    isLoading,
    isSorting,
    error,
    refetch: fetchData,
    transcriptCount,
    hasMoreTranscripts,
    loadMoreTranscripts,
  }
}
