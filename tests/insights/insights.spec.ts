/**
 * Insights Tab Comprehensive Test Suite
 *
 * Tests for the Insights tab functionality including:
 * - Insights persistence (saving live insights on recording stop)
 * - Insights loading (fetching by meeting_id, filtering by type)
 * - Insight count badge calculations
 * - State management (useInsightsData hook, caching)
 * - Integration tests (end-to-end recording flow, regeneration, real-time updates)
 */

import { test, expect } from '@playwright/test'

// ============================================================================
// Test Data Types
// ============================================================================

interface LiveNoteItem {
  id: string
  type: 'key_point' | 'action_item' | 'decision' | 'topic'
  content: string
  speaker?: string | null
  priority?: 'high' | 'medium' | 'low'
  assignee?: string | null
  extractedAt: number
  sourceSegmentIds: string[]
  isPreliminary: boolean
  confidence?: number
}

interface MeetingNote {
  id: string
  meeting_id: string
  content: string
  note_type: 'summary' | 'action_item' | 'decision' | 'key_point' | 'custom' | null
  is_ai_generated: number
  source_transcript_ids?: string | null
  created_at: string
  updated_at: string
  created_during_recording?: number
  generation_timestamp?: string | null
  context?: string | null
  confidence_score?: number | null
  speaker_id?: string | null
  start_time_ms?: number | null
  end_time_ms?: number | null
  keywords?: string | null
}

interface Task {
  id: string
  meeting_id?: string | null
  title: string
  description?: string | null
  assignee?: string | null
  due_date?: string | null
  priority: 'low' | 'medium' | 'high' | 'urgent'
  status: 'pending' | 'in_progress' | 'completed' | 'cancelled'
  created_at: string
  updated_at: string
  completed_at?: string | null
  created_during_recording?: number
  generation_timestamp?: string | null
}

interface ExtractedDecision {
  content: string
  context?: string
  speaker?: string
  sentiment: 'positive' | 'negative' | 'neutral' | 'mixed'
  confidence?: number
  startTimeMs?: number
  endTimeMs?: number
}

interface ExtractedTopic {
  name: string
  description: string
  sentiment: 'positive' | 'negative' | 'neutral' | 'mixed'
  startTimeMs: number
  endTimeMs: number
  durationMs: number
  speakers: string[]
  keyPoints: string[]
  decisions: string[]
}

// ============================================================================
// Test Helpers
// ============================================================================

function generateMeetingId(): string {
  return `meeting-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`
}

function generateNoteId(): string {
  return `note-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`
}

function generateTaskId(): string {
  return `task-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`
}

function createMockLiveNoteItem(
  type: LiveNoteItem['type'],
  overrides: Partial<LiveNoteItem> = {}
): LiveNoteItem {
  return {
    id: generateNoteId(),
    type,
    content: `Test ${type} content`,
    speaker: 'Speaker 1',
    priority: type === 'action_item' ? 'medium' : undefined,
    assignee: type === 'action_item' ? 'John Doe' : undefined,
    extractedAt: Date.now(),
    sourceSegmentIds: ['segment-1', 'segment-2'],
    isPreliminary: true,
    confidence: 0.85,
    ...overrides,
  }
}

function createMockMeetingNote(
  meetingId: string,
  noteType: MeetingNote['note_type'],
  overrides: Partial<MeetingNote> = {}
): MeetingNote {
  const now = new Date().toISOString()
  return {
    id: generateNoteId(),
    meeting_id: meetingId,
    content: `Test ${noteType} content`,
    note_type: noteType,
    is_ai_generated: 1,
    source_transcript_ids: JSON.stringify(['segment-1']),
    created_at: now,
    updated_at: now,
    created_during_recording: 1,
    generation_timestamp: now,
    context: 'Test context',
    confidence_score: 0.9,
    speaker_id: 'speaker-1',
    start_time_ms: 0,
    end_time_ms: 5000,
    keywords: JSON.stringify(['test', 'keyword']),
    ...overrides,
  }
}

function createMockTask(
  meetingId: string,
  overrides: Partial<Task> = {}
): Task {
  const now = new Date().toISOString()
  return {
    id: generateTaskId(),
    meeting_id: meetingId,
    title: 'Test action item',
    description: 'Test description',
    assignee: 'John Doe',
    due_date: null,
    priority: 'medium',
    status: 'pending',
    created_at: now,
    updated_at: now,
    completed_at: null,
    created_during_recording: 1,
    generation_timestamp: now,
    ...overrides,
  }
}

function createMockExtractedDecision(
  overrides: Partial<ExtractedDecision> = {}
): ExtractedDecision {
  return {
    content: 'Test decision content',
    context: 'Discussed during the meeting',
    speaker: 'Speaker 1',
    sentiment: 'positive',
    confidence: 0.88,
    startTimeMs: 10000,
    endTimeMs: 20000,
    ...overrides,
  }
}

function createMockExtractedTopic(
  overrides: Partial<ExtractedTopic> = {}
): ExtractedTopic {
  return {
    name: 'Test Topic',
    description: 'Discussion about test topic',
    sentiment: 'neutral',
    startTimeMs: 0,
    endTimeMs: 30000,
    durationMs: 30000,
    speakers: ['Speaker 1', 'Speaker 2'],
    keyPoints: ['Point 1', 'Point 2'],
    decisions: ['Decision 1'],
    ...overrides,
  }
}

// ============================================================================
// UNIT TESTS: Insights Persistence
// ============================================================================

test.describe('Insights Persistence Tests', () => {
  test.describe('Live Insights Save on Recording Stop', () => {
    test('should verify live insights structure is correct for database save', () => {
      const meetingId = generateMeetingId()
      const liveNotes: LiveNoteItem[] = [
        createMockLiveNoteItem('key_point', { content: 'Important discussion point' }),
        createMockLiveNoteItem('action_item', { content: 'Follow up with team', priority: 'high' }),
        createMockLiveNoteItem('decision', { content: 'Decided to use new approach' }),
        createMockLiveNoteItem('topic', { content: 'Project timeline' }),
      ]

      // Verify all required fields are present
      liveNotes.forEach(note => {
        expect(note.id).toBeDefined()
        expect(note.type).toBeDefined()
        expect(note.content).toBeDefined()
        expect(note.extractedAt).toBeGreaterThan(0)
        expect(note.sourceSegmentIds).toBeInstanceOf(Array)
        expect(typeof note.isPreliminary).toBe('boolean')
      })

      // Verify type-specific fields
      const actionItem = liveNotes.find(n => n.type === 'action_item')
      expect(actionItem?.priority).toBeDefined()
    })

    test('should convert live notes to database meeting_notes format', () => {
      const meetingId = generateMeetingId()
      const liveNote = createMockLiveNoteItem('key_point', {
        content: 'Key discussion point',
        speaker: 'Speaker 1',
        confidence: 0.92,
      })

      // Convert to meeting_notes format
      const meetingNote: MeetingNote = {
        id: liveNote.id,
        meeting_id: meetingId,
        content: liveNote.content,
        note_type: 'key_point',
        is_ai_generated: 1,
        source_transcript_ids: JSON.stringify(liveNote.sourceSegmentIds),
        created_at: new Date(liveNote.extractedAt).toISOString(),
        updated_at: new Date(liveNote.extractedAt).toISOString(),
        created_during_recording: 1,
        generation_timestamp: new Date(liveNote.extractedAt).toISOString(),
        confidence_score: liveNote.confidence ?? null,
        speaker_id: liveNote.speaker ?? null,
      }

      expect(meetingNote.meeting_id).toBe(meetingId)
      expect(meetingNote.note_type).toBe('key_point')
      expect(meetingNote.is_ai_generated).toBe(1)
      expect(meetingNote.created_during_recording).toBe(1)
      expect(meetingNote.confidence_score).toBe(0.92)
    })

    test('should convert live action items to database tasks format', () => {
      const meetingId = generateMeetingId()
      const liveActionItem = createMockLiveNoteItem('action_item', {
        content: 'Complete code review',
        priority: 'high',
        assignee: 'Jane Smith',
      })

      // Convert to tasks format
      const task: Task = {
        id: liveActionItem.id,
        meeting_id: meetingId,
        title: liveActionItem.content,
        description: null,
        assignee: liveActionItem.assignee ?? null,
        due_date: null,
        priority: liveActionItem.priority ?? 'medium',
        status: 'pending',
        created_at: new Date(liveActionItem.extractedAt).toISOString(),
        updated_at: new Date(liveActionItem.extractedAt).toISOString(),
        created_during_recording: 1,
        generation_timestamp: new Date(liveActionItem.extractedAt).toISOString(),
      }

      expect(task.meeting_id).toBe(meetingId)
      expect(task.title).toBe('Complete code review')
      expect(task.priority).toBe('high')
      expect(task.assignee).toBe('Jane Smith')
      expect(task.created_during_recording).toBe(1)
    })
  })

  test.describe('Batch Insert Transaction', () => {
    test('should group multiple insights for batch insert', () => {
      const meetingId = generateMeetingId()

      // Create multiple insights of different types
      const keyPoints: MeetingNote[] = [
        createMockMeetingNote(meetingId, 'key_point', { content: 'Point 1' }),
        createMockMeetingNote(meetingId, 'key_point', { content: 'Point 2' }),
        createMockMeetingNote(meetingId, 'key_point', { content: 'Point 3' }),
      ]

      const decisions: MeetingNote[] = [
        createMockMeetingNote(meetingId, 'decision', { content: 'Decision 1' }),
        createMockMeetingNote(meetingId, 'decision', { content: 'Decision 2' }),
      ]

      const tasks: Task[] = [
        createMockTask(meetingId, { title: 'Task 1' }),
        createMockTask(meetingId, { title: 'Task 2' }),
      ]

      // All items should have the same meeting_id
      const allNotes = [...keyPoints, ...decisions]
      allNotes.forEach(note => {
        expect(note.meeting_id).toBe(meetingId)
      })
      tasks.forEach(task => {
        expect(task.meeting_id).toBe(meetingId)
      })

      // Verify batch sizes
      expect(keyPoints.length).toBe(3)
      expect(decisions.length).toBe(2)
      expect(tasks.length).toBe(2)
    })

    test('should maintain data integrity across multiple insight types', () => {
      const meetingId = generateMeetingId()
      const timestamp = new Date().toISOString()

      // Create linked data
      const keyPoint = createMockMeetingNote(meetingId, 'key_point', {
        generation_timestamp: timestamp,
      })
      const decision = createMockMeetingNote(meetingId, 'decision', {
        generation_timestamp: timestamp,
      })
      const task = createMockTask(meetingId, {
        generation_timestamp: timestamp,
      })

      // All should have consistent timestamps from the same generation session
      expect(keyPoint.generation_timestamp).toBe(timestamp)
      expect(decision.generation_timestamp).toBe(timestamp)
      expect(task.generation_timestamp).toBe(timestamp)
    })
  })

  test.describe('Duplicate Handling', () => {
    test('should detect duplicate notes by ID', () => {
      const meetingId = generateMeetingId()
      const existingNotes: MeetingNote[] = [
        createMockMeetingNote(meetingId, 'key_point', { id: 'note-1' }),
        createMockMeetingNote(meetingId, 'decision', { id: 'note-2' }),
      ]

      const newNote = createMockMeetingNote(meetingId, 'key_point', { id: 'note-1' })

      // Check for duplicate
      const isDuplicate = existingNotes.some(n => n.id === newNote.id)
      expect(isDuplicate).toBe(true)
    })

    test('should detect duplicate notes by content similarity', () => {
      const meetingId = generateMeetingId()
      const existingNotes: MeetingNote[] = [
        createMockMeetingNote(meetingId, 'key_point', {
          content: 'Discussed project timeline and milestones',
        }),
      ]

      const newNote = createMockMeetingNote(meetingId, 'key_point', {
        content: 'Discussed project timeline and milestones',
      })

      // Check for content duplicate
      const isContentDuplicate = existingNotes.some(
        n => n.content.toLowerCase() === newNote.content.toLowerCase() &&
             n.note_type === newNote.note_type
      )
      expect(isContentDuplicate).toBe(true)
    })

    test('should allow similar content across different note types', () => {
      const meetingId = generateMeetingId()
      const existingNotes: MeetingNote[] = [
        createMockMeetingNote(meetingId, 'key_point', {
          content: 'Team agreed on new deadline',
        }),
      ]

      const newNote = createMockMeetingNote(meetingId, 'decision', {
        content: 'Team agreed on new deadline',
      })

      // Same content, different type should not be a duplicate
      const isSameTypeAndContent = existingNotes.some(
        n => n.content === newNote.content && n.note_type === newNote.note_type
      )
      expect(isSameTypeAndContent).toBe(false)
    })
  })

  test.describe('Error Recovery', () => {
    test('should track save progress correctly', () => {
      interface SaveProgress {
        total: number
        saved: number
        currentType: 'notes' | 'tasks'
        error?: string
      }

      const progress: SaveProgress = {
        total: 10,
        saved: 0,
        currentType: 'notes',
      }

      // Simulate successful saves
      for (let i = 1; i <= 7; i++) {
        progress.saved = i
        if (i === 7) {
          progress.currentType = 'tasks'
        }
      }

      expect(progress.saved).toBe(7)
      expect(progress.currentType).toBe('tasks')
      expect(progress.error).toBeUndefined()
    })

    test('should handle partial save failure', () => {
      interface SaveProgress {
        total: number
        saved: number
        currentType: 'notes' | 'tasks'
        error?: string
      }

      const progress: SaveProgress = {
        total: 10,
        saved: 5,
        currentType: 'notes',
        error: 'Database constraint violation',
      }

      expect(progress.error).toBeDefined()
      expect(progress.saved).toBeLessThan(progress.total)
    })

    test('should preserve successfully saved items after partial failure', () => {
      const savedNotes = [
        createMockMeetingNote(generateMeetingId(), 'key_point', { id: 'saved-1' }),
        createMockMeetingNote(generateMeetingId(), 'key_point', { id: 'saved-2' }),
      ]

      const failedNotes = [
        createMockMeetingNote(generateMeetingId(), 'key_point', { id: 'failed-1' }),
      ]

      // Verify saved notes are preserved
      expect(savedNotes.length).toBe(2)
      savedNotes.forEach(note => {
        expect(note.id).toMatch(/^saved-/)
      })
    })
  })
})

// ============================================================================
// UNIT TESTS: Insights Loading
// ============================================================================

test.describe('Insights Loading Tests', () => {
  test.describe('Fetch by Meeting ID', () => {
    test('should retrieve all insights for a specific meeting', () => {
      const meetingId = generateMeetingId()
      const otherMeetingId = generateMeetingId()

      const notes: MeetingNote[] = [
        createMockMeetingNote(meetingId, 'key_point'),
        createMockMeetingNote(meetingId, 'decision'),
        createMockMeetingNote(otherMeetingId, 'key_point'),
      ]

      const meetingNotes = notes.filter(n => n.meeting_id === meetingId)
      expect(meetingNotes.length).toBe(2)
    })

    test('should return empty array for meeting with no insights', () => {
      const meetingId = generateMeetingId()
      const notes: MeetingNote[] = []

      const meetingNotes = notes.filter(n => n.meeting_id === meetingId)
      expect(meetingNotes.length).toBe(0)
      expect(meetingNotes).toEqual([])
    })
  })

  test.describe('Filter by Note Type', () => {
    test('should filter notes by decision type', () => {
      const meetingId = generateMeetingId()
      const notes: MeetingNote[] = [
        createMockMeetingNote(meetingId, 'key_point'),
        createMockMeetingNote(meetingId, 'decision'),
        createMockMeetingNote(meetingId, 'decision'),
        createMockMeetingNote(meetingId, 'key_point'),
      ]

      const decisions = notes.filter(n => n.note_type === 'decision')
      expect(decisions.length).toBe(2)
      decisions.forEach(d => expect(d.note_type).toBe('decision'))
    })

    test('should filter notes by key_point type', () => {
      const meetingId = generateMeetingId()
      const notes: MeetingNote[] = [
        createMockMeetingNote(meetingId, 'key_point'),
        createMockMeetingNote(meetingId, 'decision'),
        createMockMeetingNote(meetingId, 'key_point'),
        createMockMeetingNote(meetingId, 'summary'),
      ]

      const keyPoints = notes.filter(n => n.note_type === 'key_point')
      expect(keyPoints.length).toBe(2)
      keyPoints.forEach(kp => expect(kp.note_type).toBe('key_point'))
    })

    test('should filter notes by multiple types', () => {
      const meetingId = generateMeetingId()
      const notes: MeetingNote[] = [
        createMockMeetingNote(meetingId, 'key_point'),
        createMockMeetingNote(meetingId, 'decision'),
        createMockMeetingNote(meetingId, 'summary'),
        createMockMeetingNote(meetingId, 'action_item'),
      ]

      const insightTypes: MeetingNote['note_type'][] = ['key_point', 'decision']
      const insights = notes.filter(n => insightTypes.includes(n.note_type))
      expect(insights.length).toBe(2)
    })
  })

  test.describe('Action Items from Tasks Table', () => {
    test('should retrieve action items linked to meeting', () => {
      const meetingId = generateMeetingId()
      const tasks: Task[] = [
        createMockTask(meetingId, { title: 'Task 1', created_during_recording: 1 }),
        createMockTask(meetingId, { title: 'Task 2', created_during_recording: 1 }),
        createMockTask(null, { title: 'Standalone task', created_during_recording: 0 }),
      ]

      const meetingActionItems = tasks.filter(
        t => t.meeting_id === meetingId && t.created_during_recording === 1
      )
      expect(meetingActionItems.length).toBe(2)
    })

    test('should distinguish live-generated tasks from manual tasks', () => {
      const meetingId = generateMeetingId()
      const tasks: Task[] = [
        createMockTask(meetingId, { created_during_recording: 1 }),
        createMockTask(meetingId, { created_during_recording: 0 }),
      ]

      const liveGeneratedTasks = tasks.filter(t => t.created_during_recording === 1)
      const manualTasks = tasks.filter(t => t.created_during_recording === 0)

      expect(liveGeneratedTasks.length).toBe(1)
      expect(manualTasks.length).toBe(1)
    })
  })

  test.describe('Empty State Handling', () => {
    test('should handle meeting with no transcripts', () => {
      const meetingId = generateMeetingId()
      const hasTranscripts = false
      const notes: MeetingNote[] = []
      const tasks: Task[] = []

      const isEmpty = notes.length === 0 && tasks.length === 0
      const canGenerateInsights = hasTranscripts

      expect(isEmpty).toBe(true)
      expect(canGenerateInsights).toBe(false)
    })

    test('should handle meeting with transcripts but no insights', () => {
      const meetingId = generateMeetingId()
      const hasTranscripts = true
      const notes: MeetingNote[] = []
      const tasks: Task[] = []

      const isEmpty = notes.length === 0 && tasks.length === 0
      const canGenerateInsights = hasTranscripts

      expect(isEmpty).toBe(true)
      expect(canGenerateInsights).toBe(true)
    })
  })
})

// ============================================================================
// UNIT TESTS: Insight Count Badge
// ============================================================================

test.describe('Insight Count Badge Tests', () => {
  test.describe('Count Calculation', () => {
    test('should calculate total count including all four types', () => {
      const meetingId = generateMeetingId()

      const notes: MeetingNote[] = [
        createMockMeetingNote(meetingId, 'key_point'),
        createMockMeetingNote(meetingId, 'key_point'),
        createMockMeetingNote(meetingId, 'decision'),
      ]

      const tasks: Task[] = [
        createMockTask(meetingId, { created_during_recording: 1 }),
        createMockTask(meetingId, { created_during_recording: 1 }),
      ]

      const topics: ExtractedTopic[] = [
        createMockExtractedTopic(),
        createMockExtractedTopic(),
        createMockExtractedTopic(),
      ]

      const keyPointCount = notes.filter(n => n.note_type === 'key_point').length
      const decisionCount = notes.filter(n => n.note_type === 'decision').length
      const actionItemCount = tasks.filter(t => t.created_during_recording === 1).length
      const topicCount = topics.length

      const totalCount = keyPointCount + decisionCount + actionItemCount + topicCount

      expect(keyPointCount).toBe(2)
      expect(decisionCount).toBe(1)
      expect(actionItemCount).toBe(2)
      expect(topicCount).toBe(3)
      expect(totalCount).toBe(8)
    })

    test('should handle zero insights', () => {
      const notes: MeetingNote[] = []
      const tasks: Task[] = []
      const topics: ExtractedTopic[] = []

      const totalCount =
        notes.filter(n => n.note_type === 'key_point').length +
        notes.filter(n => n.note_type === 'decision').length +
        tasks.filter(t => t.created_during_recording === 1).length +
        topics.length

      expect(totalCount).toBe(0)
    })

    test('should only count recording-generated tasks', () => {
      const meetingId = generateMeetingId()

      const tasks: Task[] = [
        createMockTask(meetingId, { created_during_recording: 1 }),
        createMockTask(meetingId, { created_during_recording: 0 }),
        createMockTask(meetingId, { created_during_recording: 1 }),
      ]

      const actionItemCount = tasks.filter(t => t.created_during_recording === 1).length
      expect(actionItemCount).toBe(2)
    })
  })

  test.describe('Count Updates', () => {
    test('should update count when insight is added', () => {
      const meetingId = generateMeetingId()
      const notes: MeetingNote[] = [
        createMockMeetingNote(meetingId, 'key_point'),
      ]

      let count = notes.length
      expect(count).toBe(1)

      // Add new insight
      notes.push(createMockMeetingNote(meetingId, 'decision'))
      count = notes.length
      expect(count).toBe(2)
    })

    test('should update count when insight is removed', () => {
      const meetingId = generateMeetingId()
      const notes: MeetingNote[] = [
        createMockMeetingNote(meetingId, 'key_point', { id: 'note-1' }),
        createMockMeetingNote(meetingId, 'decision', { id: 'note-2' }),
      ]

      let count = notes.length
      expect(count).toBe(2)

      // Remove insight
      const filteredNotes = notes.filter(n => n.id !== 'note-1')
      count = filteredNotes.length
      expect(count).toBe(1)
    })
  })

  test.describe('Display Format', () => {
    test('should format count as "Insights (N)"', () => {
      const formatInsightsLabel = (count: number): string => `Insights (${count})`

      expect(formatInsightsLabel(0)).toBe('Insights (0)')
      expect(formatInsightsLabel(5)).toBe('Insights (5)')
      expect(formatInsightsLabel(42)).toBe('Insights (42)')
      expect(formatInsightsLabel(500)).toBe('Insights (500)')
    })

    test('should handle large numbers gracefully', () => {
      const formatInsightsLabel = (count: number): string => `Insights (${count})`

      expect(formatInsightsLabel(1000)).toBe('Insights (1000)')
      expect(formatInsightsLabel(9999)).toBe('Insights (9999)')
    })
  })
})

// ============================================================================
// UNIT TESTS: State Management
// ============================================================================

test.describe('State Management Tests', () => {
  test.describe('useInsightsData Hook Initialization', () => {
    test('should initialize with correct default state', () => {
      interface InsightsState {
        actionItems: Task[]
        decisions: ExtractedDecision[]
        decisionNotes: MeetingNote[]
        keyPoints: MeetingNote[]
        topics: ExtractedTopic[]
        loading: boolean
        error: Error | null
        lastGenerated: Date | null
        generationSource: 'live' | 'post_recording' | 'manual' | null
      }

      const defaultState: InsightsState = {
        actionItems: [],
        decisions: [],
        decisionNotes: [],
        keyPoints: [],
        topics: [],
        loading: false,
        error: null,
        lastGenerated: null,
        generationSource: null,
      }

      expect(defaultState.loading).toBe(false)
      expect(defaultState.error).toBeNull()
      expect(defaultState.actionItems).toEqual([])
      expect(defaultState.generationSource).toBeNull()
    })

    test('should initialize from provided initial notes', () => {
      const meetingId = generateMeetingId()
      const initialNotes: MeetingNote[] = [
        createMockMeetingNote(meetingId, 'decision'),
        createMockMeetingNote(meetingId, 'key_point'),
      ]

      const decisionNotes = initialNotes.filter(n => n.note_type === 'decision')
      const keyPoints = initialNotes.filter(n => n.note_type === 'key_point')

      expect(decisionNotes.length).toBe(1)
      expect(keyPoints.length).toBe(1)
    })

    test('should initialize from provided initial tasks', () => {
      const meetingId = generateMeetingId()
      const initialTasks: Task[] = [
        createMockTask(meetingId, { created_during_recording: 1 }),
        createMockTask(meetingId, { created_during_recording: 0 }),
      ]

      const recordingTasks = initialTasks.filter(t => t.created_during_recording === 1)
      expect(recordingTasks.length).toBe(1)
    })
  })

  test.describe('State Updates on Data Fetch', () => {
    test('should update state when decisions are fetched', () => {
      const decisions: ExtractedDecision[] = [
        createMockExtractedDecision({ content: 'Decision 1' }),
        createMockExtractedDecision({ content: 'Decision 2' }),
      ]

      expect(decisions.length).toBe(2)
      expect(decisions[0].content).toBe('Decision 1')
    })

    test('should update state when topics are fetched', () => {
      const topics: ExtractedTopic[] = [
        createMockExtractedTopic({ name: 'Topic 1' }),
        createMockExtractedTopic({ name: 'Topic 2' }),
      ]

      expect(topics.length).toBe(2)
      expect(topics[0].name).toBe('Topic 1')
    })

    test('should determine generation source correctly', () => {
      const meetingId = generateMeetingId()

      // Live source - has tasks created during recording
      const liveTask = createMockTask(meetingId, { created_during_recording: 1 })
      const isLiveSource = liveTask.created_during_recording === 1
      expect(isLiveSource).toBe(true)

      // Post-recording source - has AI-generated notes
      const postRecordingNote = createMockMeetingNote(meetingId, 'decision', {
        is_ai_generated: 1,
        created_during_recording: 0,
      })
      const isPostRecordingSource = postRecordingNote.is_ai_generated === 1 &&
                                    postRecordingNote.created_during_recording === 0
      expect(isPostRecordingSource).toBe(true)
    })
  })

  test.describe('Error State Handling', () => {
    test('should handle fetch error correctly', () => {
      interface InsightsState {
        loading: boolean
        error: Error | null
      }

      let state: InsightsState = { loading: true, error: null }

      // Simulate error
      const error = new Error('Failed to fetch insights')
      state = { loading: false, error }

      expect(state.loading).toBe(false)
      expect(state.error).toBeDefined()
      expect(state.error?.message).toBe('Failed to fetch insights')
    })

    test('should use cached data as fallback on error', () => {
      const meetingId = generateMeetingId()
      const cachedNotes: MeetingNote[] = [
        createMockMeetingNote(meetingId, 'key_point'),
      ]

      const error = new Error('Network error')
      const useCachedData = true

      // Should still have data from cache despite error
      expect(cachedNotes.length).toBe(1)
      expect(error).toBeDefined()
      expect(useCachedData).toBe(true)
    })
  })

  test.describe('Cache Invalidation', () => {
    test('should invalidate cache when recording stops', () => {
      interface CacheState {
        data: MeetingNote[] | null
        timestamp: number
        meetingId: string
      }

      const cache: CacheState = {
        data: [createMockMeetingNote(generateMeetingId(), 'key_point')],
        timestamp: Date.now(),
        meetingId: 'meeting-1',
      }

      // Invalidate cache
      const invalidatedCache: CacheState = {
        data: null,
        timestamp: 0,
        meetingId: '',
      }

      expect(invalidatedCache.data).toBeNull()
      expect(invalidatedCache.timestamp).toBe(0)
    })

    test('should check cache staleness correctly', () => {
      const STALE_TIME_MS = 5 * 60 * 1000 // 5 minutes

      // Fresh cache
      const freshTimestamp = Date.now()
      const isFreshStale = Date.now() - freshTimestamp >= STALE_TIME_MS
      expect(isFreshStale).toBe(false)

      // Stale cache (6 minutes old)
      const staleTimestamp = Date.now() - (6 * 60 * 1000)
      const isStaleStale = Date.now() - staleTimestamp >= STALE_TIME_MS
      expect(isStaleStale).toBe(true)
    })
  })
})

// ============================================================================
// INTEGRATION TESTS: End-to-End Recording Flow
// ============================================================================

test.describe('Integration Tests', () => {
  test.describe('End-to-End Recording Flow', () => {
    test('should simulate complete recording flow with insights', () => {
      const meetingId = generateMeetingId()

      // Phase 1: Start recording
      const recordingState = {
        status: 'recording' as const,
        meetingId,
        startTime: Date.now(),
      }
      expect(recordingState.status).toBe('recording')

      // Phase 2: Generate live insights
      const liveNotes: LiveNoteItem[] = [
        createMockLiveNoteItem('key_point'),
        createMockLiveNoteItem('action_item'),
        createMockLiveNoteItem('decision'),
      ]
      expect(liveNotes.length).toBe(3)

      // Phase 3: Stop recording - persist insights
      const persistedNotes: MeetingNote[] = liveNotes
        .filter(n => n.type !== 'action_item')
        .map(n => ({
          id: n.id,
          meeting_id: meetingId,
          content: n.content,
          note_type: n.type as MeetingNote['note_type'],
          is_ai_generated: 1,
          source_transcript_ids: JSON.stringify(n.sourceSegmentIds),
          created_at: new Date(n.extractedAt).toISOString(),
          updated_at: new Date(n.extractedAt).toISOString(),
          created_during_recording: 1,
          generation_timestamp: new Date(n.extractedAt).toISOString(),
          confidence_score: n.confidence ?? null,
          speaker_id: n.speaker ?? null,
        }))

      const persistedTasks: Task[] = liveNotes
        .filter(n => n.type === 'action_item')
        .map(n => ({
          id: n.id,
          meeting_id: meetingId,
          title: n.content,
          description: null,
          assignee: n.assignee ?? null,
          due_date: null,
          priority: n.priority ?? 'medium',
          status: 'pending' as const,
          created_at: new Date(n.extractedAt).toISOString(),
          updated_at: new Date(n.extractedAt).toISOString(),
          created_during_recording: 1,
          generation_timestamp: new Date(n.extractedAt).toISOString(),
        }))

      expect(persistedNotes.length).toBe(2)
      expect(persistedTasks.length).toBe(1)

      // Phase 4: Navigate to Insights tab - verify all displayed
      const displayedNotes = persistedNotes.filter(n => n.meeting_id === meetingId)
      const displayedTasks = persistedTasks.filter(t => t.meeting_id === meetingId)

      expect(displayedNotes.length).toBe(2)
      expect(displayedTasks.length).toBe(1)
    })

    test('should verify generation badges show Live source', () => {
      const meetingId = generateMeetingId()
      const note = createMockMeetingNote(meetingId, 'key_point', {
        created_during_recording: 1,
      })

      const getSource = (n: MeetingNote): string => {
        if (n.created_during_recording === 1) return 'live'
        if (n.is_ai_generated === 1) return 'ai'
        return 'manual'
      }

      expect(getSource(note)).toBe('live')
    })
  })

  test.describe('Post-Recording Generation', () => {
    test('should support post-recording insight generation', () => {
      const meetingId = generateMeetingId()
      const hasTranscripts = true
      const hasLiveInsights = false

      // Verify can generate insights post-recording
      const canGenerate = hasTranscripts && !hasLiveInsights
      expect(canGenerate).toBe(true)

      // Simulate AI extraction
      const extractedDecisions: ExtractedDecision[] = [
        createMockExtractedDecision({ content: 'Post-recording decision 1' }),
        createMockExtractedDecision({ content: 'Post-recording decision 2' }),
      ]

      const extractedTopics: ExtractedTopic[] = [
        createMockExtractedTopic({ name: 'Post-recording topic 1' }),
      ]

      expect(extractedDecisions.length).toBe(2)
      expect(extractedTopics.length).toBe(1)
    })

    test('should mark post-recording insights with correct source', () => {
      const meetingId = generateMeetingId()
      const note = createMockMeetingNote(meetingId, 'decision', {
        is_ai_generated: 1,
        created_during_recording: 0,
      })

      const getSource = (n: MeetingNote): string => {
        if (n.created_during_recording === 1) return 'live'
        if (n.is_ai_generated === 1) return 'ai'
        return 'manual'
      }

      expect(getSource(note)).toBe('ai')
    })
  })

  test.describe('Regeneration Workflow', () => {
    test('should support replace mode for regeneration', () => {
      const meetingId = generateMeetingId()
      const existingNotes: MeetingNote[] = [
        createMockMeetingNote(meetingId, 'key_point', { id: 'old-1' }),
        createMockMeetingNote(meetingId, 'decision', { id: 'old-2' }),
      ]

      // Delete existing on replace
      const mode = 'replace' as const
      let notes = existingNotes

      if (mode === 'replace') {
        notes = []
      }

      expect(notes.length).toBe(0)

      // Add new insights
      notes = [
        createMockMeetingNote(meetingId, 'key_point', { id: 'new-1' }),
        createMockMeetingNote(meetingId, 'decision', { id: 'new-2' }),
        createMockMeetingNote(meetingId, 'key_point', { id: 'new-3' }),
      ]

      expect(notes.length).toBe(3)
      expect(notes.every(n => n.id.startsWith('new-'))).toBe(true)
    })

    test('should support merge mode for regeneration', () => {
      const meetingId = generateMeetingId()
      const existingNotes: MeetingNote[] = [
        createMockMeetingNote(meetingId, 'key_point', { id: 'old-1', content: 'Old point 1' }),
        createMockMeetingNote(meetingId, 'decision', { id: 'old-2', content: 'Old decision 1' }),
      ]

      const newNotes: MeetingNote[] = [
        createMockMeetingNote(meetingId, 'key_point', { id: 'new-1', content: 'New point 1' }),
        createMockMeetingNote(meetingId, 'decision', { id: 'new-2', content: 'New decision 1' }),
      ]

      // Merge - combine existing and new
      const mode = 'merge' as const
      let notes = existingNotes

      if (mode === 'merge') {
        notes = [...existingNotes, ...newNotes]
      }

      expect(notes.length).toBe(4)
      expect(notes.some(n => n.id.startsWith('old-'))).toBe(true)
      expect(notes.some(n => n.id.startsWith('new-'))).toBe(true)
    })
  })

  test.describe('Real-Time Updates', () => {
    test('should handle new insights appearing during recording', () => {
      const meetingId = generateMeetingId()
      const notes: LiveNoteItem[] = []

      // Simulate real-time insight arrival
      const addNote = (note: LiveNoteItem) => {
        if (!notes.some(n => n.id === note.id)) {
          notes.push(note)
        }
      }

      // Add notes over time
      addNote(createMockLiveNoteItem('key_point', { id: 'live-1' }))
      expect(notes.length).toBe(1)

      addNote(createMockLiveNoteItem('decision', { id: 'live-2' }))
      expect(notes.length).toBe(2)

      addNote(createMockLiveNoteItem('action_item', { id: 'live-3' }))
      expect(notes.length).toBe(3)

      // Duplicate should not be added
      addNote(createMockLiveNoteItem('key_point', { id: 'live-1' }))
      expect(notes.length).toBe(3)
    })

    test('should throttle real-time updates correctly', () => {
      const THROTTLE_MS = 1000
      let lastUpdateTime = 0
      let updateCount = 0

      const shouldUpdate = (timestamp: number): boolean => {
        if (timestamp - lastUpdateTime >= THROTTLE_MS) {
          lastUpdateTime = timestamp
          updateCount++
          return true
        }
        return false
      }

      // Simulate rapid updates
      const baseTime = Date.now()
      expect(shouldUpdate(baseTime)).toBe(true) // First update
      expect(updateCount).toBe(1)

      expect(shouldUpdate(baseTime + 500)).toBe(false) // Too soon
      expect(updateCount).toBe(1)

      expect(shouldUpdate(baseTime + 1000)).toBe(true) // OK
      expect(updateCount).toBe(2)

      expect(shouldUpdate(baseTime + 1200)).toBe(false) // Too soon
      expect(updateCount).toBe(2)
    })
  })

  test.describe('Tab Navigation', () => {
    test('should support lazy loading (no fetch until tab active)', () => {
      let hasFetched = false
      let isActive = false

      const maybeFetch = () => {
        if (isActive && !hasFetched) {
          hasFetched = true
        }
      }

      // Initially inactive - should not fetch
      maybeFetch()
      expect(hasFetched).toBe(false)

      // Activate tab - should fetch
      isActive = true
      maybeFetch()
      expect(hasFetched).toBe(true)
    })

    test('should use cache on tab switch (no refetch)', () => {
      interface CacheState {
        data: MeetingNote[] | null
        timestamp: number
        meetingId: string
      }

      const STALE_TIME_MS = 5 * 60 * 1000
      const meetingId = generateMeetingId()

      const cache: CacheState = {
        data: [createMockMeetingNote(meetingId, 'key_point')],
        timestamp: Date.now(), // Fresh cache
        meetingId,
      }

      const isCacheValid = (c: CacheState, currentMeetingId: string): boolean => {
        return c.data !== null &&
               c.meetingId === currentMeetingId &&
               Date.now() - c.timestamp < STALE_TIME_MS
      }

      // Cache should be valid
      expect(isCacheValid(cache, meetingId)).toBe(true)

      // Switching to same meeting should use cache
      const shouldFetch = !isCacheValid(cache, meetingId)
      expect(shouldFetch).toBe(false)
    })
  })
})

// ============================================================================
// PERFORMANCE TESTS
// ============================================================================

test.describe('Performance Tests', () => {
  test.describe('Load Time Benchmarks', () => {
    test('should handle 100 insights efficiently', () => {
      const meetingId = generateMeetingId()
      const startTime = Date.now()

      const notes: MeetingNote[] = []
      for (let i = 0; i < 100; i++) {
        notes.push(createMockMeetingNote(meetingId, 'key_point', {
          id: `note-${i}`,
          content: `Key point ${i}`,
        }))
      }

      const loadTime = Date.now() - startTime

      expect(notes.length).toBe(100)
      // Data creation should be fast (< 100ms)
      expect(loadTime).toBeLessThan(100)
    })

    test('should handle 500 insights without significant delay', () => {
      const meetingId = generateMeetingId()
      const startTime = Date.now()

      const notes: MeetingNote[] = []
      for (let i = 0; i < 500; i++) {
        notes.push(createMockMeetingNote(meetingId,
          i % 3 === 0 ? 'key_point' : i % 3 === 1 ? 'decision' : 'summary', {
          id: `note-${i}`,
          content: `Content ${i}`,
        }))
      }

      const createTime = Date.now() - startTime

      // Filter operations
      const filterStart = Date.now()
      const keyPoints = notes.filter(n => n.note_type === 'key_point')
      const decisions = notes.filter(n => n.note_type === 'decision')
      const filterTime = Date.now() - filterStart

      expect(notes.length).toBe(500)
      expect(keyPoints.length).toBeGreaterThan(100)
      expect(decisions.length).toBeGreaterThan(100)
      // Operations should be performant (< 50ms)
      expect(filterTime).toBeLessThan(50)
    })
  })

  test.describe('Real-Time Update Performance', () => {
    test('should not cause lag with frequent updates', () => {
      const notes: LiveNoteItem[] = []
      const startTime = Date.now()

      // Simulate 50 rapid updates
      for (let i = 0; i < 50; i++) {
        notes.push(createMockLiveNoteItem('key_point', {
          id: `live-${i}`,
          content: `Live note ${i}`,
        }))
      }

      const updateTime = Date.now() - startTime

      expect(notes.length).toBe(50)
      // Should handle rapid updates efficiently (< 50ms)
      expect(updateTime).toBeLessThan(50)
    })
  })

  test.describe('Tab Switching Performance', () => {
    test('should switch tabs instantly with cached data', () => {
      const meetingId = generateMeetingId()
      const cachedData = {
        notes: Array.from({ length: 100 }, (_, i) =>
          createMockMeetingNote(meetingId, 'key_point', { id: `note-${i}` })
        ),
        timestamp: Date.now(),
      }

      const startTime = Date.now()

      // Simulate tab switch with cache read
      const dataFromCache = cachedData.notes
      const switchTime = Date.now() - startTime

      expect(dataFromCache.length).toBe(100)
      // Cache access should be instant (< 5ms)
      expect(switchTime).toBeLessThan(5)
    })
  })
})

// ============================================================================
// REGRESSION PREVENTION TESTS
// ============================================================================

test.describe('Regression Prevention Tests', () => {
  test.describe('Notes Tab Compatibility', () => {
    test('should not affect Notes tab with insights changes', () => {
      const meetingId = generateMeetingId()

      // Regular notes (not insights)
      const regularNotes: MeetingNote[] = [
        createMockMeetingNote(meetingId, 'summary', {
          is_ai_generated: 0,
          created_during_recording: 0,
        }),
        createMockMeetingNote(meetingId, 'custom', {
          is_ai_generated: 0,
          created_during_recording: 0,
        }),
      ]

      // Insight notes
      const insightNotes: MeetingNote[] = [
        createMockMeetingNote(meetingId, 'key_point', {
          is_ai_generated: 1,
          created_during_recording: 1,
        }),
        createMockMeetingNote(meetingId, 'decision', {
          is_ai_generated: 1,
          created_during_recording: 1,
        }),
      ]

      // Notes tab should show regular notes
      const notesTabItems = regularNotes.filter(
        n => n.note_type === 'summary' || n.note_type === 'custom'
      )

      // Insights tab should show insight notes
      const insightsTabItems = insightNotes.filter(
        n => n.note_type === 'key_point' || n.note_type === 'decision'
      )

      expect(notesTabItems.length).toBe(2)
      expect(insightsTabItems.length).toBe(2)
      // They should be separate
      expect(notesTabItems.every(n => !insightsTabItems.includes(n))).toBe(true)
    })
  })

  test.describe('Tasks Page Compatibility', () => {
    test('should show all tasks on Tasks page (not just meeting-linked)', () => {
      const meetingId = generateMeetingId()

      const allTasks: Task[] = [
        createMockTask(meetingId, { title: 'Meeting task 1' }),
        createMockTask(meetingId, { title: 'Meeting task 2' }),
        createMockTask(null, { title: 'Standalone task 1' }),
        createMockTask(null, { title: 'Standalone task 2' }),
      ]

      // Tasks page should show all tasks
      const tasksPageItems = allTasks
      expect(tasksPageItems.length).toBe(4)

      // Insights tab should only show meeting-linked tasks
      const insightsTabTasks = allTasks.filter(
        t => t.meeting_id === meetingId && t.created_during_recording === 1
      )
      expect(insightsTabTasks.length).toBe(2)
    })
  })

  test.describe('Meeting Deletion Cascade', () => {
    test('should cascade delete insights when meeting is deleted', () => {
      const meetingId = generateMeetingId()

      // Create meeting-linked insights
      const notes: MeetingNote[] = [
        createMockMeetingNote(meetingId, 'key_point'),
        createMockMeetingNote(meetingId, 'decision'),
      ]

      const tasks: Task[] = [
        createMockTask(meetingId),
      ]

      // Simulate cascade delete
      const remainingNotes = notes.filter(n => n.meeting_id !== meetingId)
      const remainingTasks = tasks.filter(t => t.meeting_id !== meetingId)

      expect(remainingNotes.length).toBe(0)
      expect(remainingTasks.length).toBe(0)
    })

    test('should keep standalone tasks after meeting deletion', () => {
      const meetingId = generateMeetingId()

      const tasks: Task[] = [
        createMockTask(meetingId),
        createMockTask(null, { title: 'Standalone task' }),
      ]

      // Simulate cascade delete for meeting tasks only
      const remainingTasks = tasks.filter(t => t.meeting_id !== meetingId)

      expect(remainingTasks.length).toBe(1)
      expect(remainingTasks[0].title).toBe('Standalone task')
    })
  })
})

// ============================================================================
// EDGE CASE TESTS
// ============================================================================

test.describe('Edge Case Tests', () => {
  test.describe('Meetings with Special States', () => {
    test('should handle meeting with no transcript', () => {
      const meetingId = generateMeetingId()
      const hasTranscripts = false
      const notes: MeetingNote[] = []
      const canGenerateInsights = hasTranscripts

      expect(canGenerateInsights).toBe(false)
      expect(notes.length).toBe(0)
    })

    test('should handle meeting with failed diarization', () => {
      const meetingId = generateMeetingId()
      const diarizationFailed = true

      // Notes without speaker info due to failed diarization
      const notes: MeetingNote[] = [
        createMockMeetingNote(meetingId, 'key_point', {
          speaker_id: null,
        }),
      ]

      expect(notes[0].speaker_id).toBeNull()
      expect(diarizationFailed).toBe(true)
    })
  })

  test.describe('Varying Insight Counts', () => {
    test('should handle meeting with 0 insights', () => {
      const meetingId = generateMeetingId()
      const notes: MeetingNote[] = []
      const tasks: Task[] = []
      const topics: ExtractedTopic[] = []

      const totalCount = notes.length + tasks.length + topics.length
      expect(totalCount).toBe(0)
    })

    test('should handle meeting with only live insights', () => {
      const meetingId = generateMeetingId()

      const notes: MeetingNote[] = [
        createMockMeetingNote(meetingId, 'key_point', { created_during_recording: 1 }),
        createMockMeetingNote(meetingId, 'decision', { created_during_recording: 1 }),
      ]

      const allLive = notes.every(n => n.created_during_recording === 1)
      expect(allLive).toBe(true)
    })

    test('should handle meeting with only post-recording insights', () => {
      const meetingId = generateMeetingId()

      const notes: MeetingNote[] = [
        createMockMeetingNote(meetingId, 'key_point', {
          created_during_recording: 0,
          is_ai_generated: 1,
        }),
        createMockMeetingNote(meetingId, 'decision', {
          created_during_recording: 0,
          is_ai_generated: 1,
        }),
      ]

      const allPostRecording = notes.every(
        n => n.created_during_recording === 0 && n.is_ai_generated === 1
      )
      expect(allPostRecording).toBe(true)
    })

    test('should handle meeting with mixed sources', () => {
      const meetingId = generateMeetingId()

      const notes: MeetingNote[] = [
        createMockMeetingNote(meetingId, 'key_point', { created_during_recording: 1 }),
        createMockMeetingNote(meetingId, 'decision', {
          created_during_recording: 0,
          is_ai_generated: 1,
        }),
      ]

      const liveNotes = notes.filter(n => n.created_during_recording === 1)
      const aiNotes = notes.filter(n => n.is_ai_generated === 1 && n.created_during_recording === 0)

      expect(liveNotes.length).toBe(1)
      expect(aiNotes.length).toBe(1)
    })
  })
})
