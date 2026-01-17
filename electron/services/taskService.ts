/**
 * Task Service
 *
 * Handles CRUD operations for tasks with prepared statements
 */

import { randomUUID } from 'crypto'
import type Database from 'better-sqlite3'
import { getDatabaseService } from './database'
import type {
  Task,
  TaskStatus,
  TaskPriority,
  CreateTaskInput,
  UpdateTaskInput
} from '../../src/types/database'

// ============================================================================
// Prepared Statements Cache
// ============================================================================

let statements: {
  insert: Database.Statement
  getById: Database.Statement
  getAll: Database.Statement
  getByMeetingId: Database.Statement
  update: Database.Statement
  delete: Database.Statement
  getByStatus: Database.Statement
  getPending: Database.Statement
  getByPriority: Database.Statement
  getByAssignee: Database.Statement
  getOverdue: Database.Statement
} | null = null

function getStatements() {
  if (statements) return statements

  const db = getDatabaseService().getDatabase()

  statements = {
    insert: db.prepare(`
      INSERT INTO tasks (id, meeting_id, title, description, assignee, due_date, priority, status, created_during_recording, generation_timestamp, created_at, updated_at)
      VALUES (@id, @meeting_id, @title, @description, @assignee, @due_date, @priority, @status, @created_during_recording, @generation_timestamp, datetime('now'), datetime('now'))
    `),

    getById: db.prepare(`
      SELECT * FROM tasks WHERE id = ?
    `),

    getAll: db.prepare(`
      SELECT * FROM tasks ORDER BY
        CASE priority
          WHEN 'urgent' THEN 1
          WHEN 'high' THEN 2
          WHEN 'medium' THEN 3
          WHEN 'low' THEN 4
        END,
        due_date ASC NULLS LAST,
        created_at DESC
    `),

    getByMeetingId: db.prepare(`
      SELECT * FROM tasks WHERE meeting_id = ? ORDER BY created_at DESC
    `),

    update: db.prepare(`
      UPDATE tasks
      SET title = COALESCE(@title, title),
          description = COALESCE(@description, description),
          meeting_id = COALESCE(@meeting_id, meeting_id),
          assignee = COALESCE(@assignee, assignee),
          due_date = COALESCE(@due_date, due_date),
          priority = COALESCE(@priority, priority),
          status = COALESCE(@status, status),
          completed_at = COALESCE(@completed_at, completed_at)
      WHERE id = @id
    `),

    delete: db.prepare(`
      DELETE FROM tasks WHERE id = ?
    `),

    getByStatus: db.prepare(`
      SELECT * FROM tasks WHERE status = ? ORDER BY
        CASE priority
          WHEN 'urgent' THEN 1
          WHEN 'high' THEN 2
          WHEN 'medium' THEN 3
          WHEN 'low' THEN 4
        END,
        due_date ASC NULLS LAST
    `),

    getPending: db.prepare(`
      SELECT * FROM tasks WHERE status IN ('pending', 'in_progress') ORDER BY
        CASE priority
          WHEN 'urgent' THEN 1
          WHEN 'high' THEN 2
          WHEN 'medium' THEN 3
          WHEN 'low' THEN 4
        END,
        due_date ASC NULLS LAST
    `),

    getByPriority: db.prepare(`
      SELECT * FROM tasks WHERE priority = ? ORDER BY due_date ASC NULLS LAST, created_at DESC
    `),

    getByAssignee: db.prepare(`
      SELECT * FROM tasks WHERE assignee = ? ORDER BY
        CASE priority
          WHEN 'urgent' THEN 1
          WHEN 'high' THEN 2
          WHEN 'medium' THEN 3
          WHEN 'low' THEN 4
        END,
        due_date ASC NULLS LAST
    `),

    getOverdue: db.prepare(`
      SELECT * FROM tasks
      WHERE due_date < date('now')
        AND status NOT IN ('completed', 'cancelled')
      ORDER BY due_date ASC
    `)
  }

  return statements
}

// ============================================================================
// Task Service Functions
// ============================================================================

export const taskService = {
  /**
   * Create a new task
   */
  create(input: CreateTaskInput): Task {
    const stmts = getStatements()
    const id = input.id || randomUUID()

    const params = {
      id,
      meeting_id: input.meeting_id ?? null,
      title: input.title,
      description: input.description ?? null,
      assignee: input.assignee ?? null,
      due_date: input.due_date ?? null,
      priority: input.priority ?? 'medium',
      status: input.status ?? 'pending',
      created_during_recording: input.created_during_recording ? 1 : 0,
      generation_timestamp: input.generation_timestamp ?? null
    }

    stmts.insert.run(params)

    return stmts.getById.get(id) as Task
  },

  /**
   * Create multiple tasks in a single transaction (batch insert)
   */
  createBatch(inputs: CreateTaskInput[]): Task[] {
    const dbService = getDatabaseService()
    const stmts = getStatements()
    const results: Task[] = []

    const createAll = dbService.getDatabase().transaction(() => {
      for (const input of inputs) {
        const id = input.id || randomUUID()

        const params = {
          id,
          meeting_id: input.meeting_id ?? null,
          title: input.title,
          description: input.description ?? null,
          assignee: input.assignee ?? null,
          due_date: input.due_date ?? null,
          priority: input.priority ?? 'medium',
          status: input.status ?? 'pending',
          created_during_recording: input.created_during_recording ? 1 : 0,
          generation_timestamp: input.generation_timestamp ?? null
        }

        stmts.insert.run(params)
        const task = stmts.getById.get(id) as Task
        results.push(task)
      }
    })

    createAll()
    return results
  },

  /**
   * Get a task by ID
   */
  getById(id: string): Task | null {
    const stmts = getStatements()
    return (stmts.getById.get(id) as Task) || null
  },

  /**
   * Get all tasks
   */
  getAll(): Task[] {
    const stmts = getStatements()
    return stmts.getAll.all() as Task[]
  },

  /**
   * Get all tasks for a meeting
   */
  getByMeetingId(meetingId: string): Task[] {
    const stmts = getStatements()
    return stmts.getByMeetingId.all(meetingId) as Task[]
  },

  /**
   * Update a task
   */
  update(id: string, input: UpdateTaskInput): Task | null {
    const stmts = getStatements()

    // If completing a task, set completed_at
    let completedAt = input.completed_at ?? null
    if (input.status === 'completed' && !completedAt) {
      completedAt = new Date().toISOString()
    }

    const params = {
      id,
      title: input.title ?? null,
      description: input.description,
      meeting_id: input.meeting_id,
      assignee: input.assignee,
      due_date: input.due_date,
      priority: input.priority ?? null,
      status: input.status ?? null,
      completed_at: completedAt
    }

    const result = stmts.update.run(params)

    if (result.changes === 0) {
      return null
    }

    return stmts.getById.get(id) as Task
  },

  /**
   * Delete a task
   */
  delete(id: string): boolean {
    const stmts = getStatements()
    const result = stmts.delete.run(id)
    return result.changes > 0
  },

  /**
   * Get tasks by status
   */
  getByStatus(status: TaskStatus): Task[] {
    const stmts = getStatements()
    return stmts.getByStatus.all(status) as Task[]
  },

  /**
   * Get pending tasks (not completed or cancelled)
   */
  getPending(): Task[] {
    const stmts = getStatements()
    return stmts.getPending.all() as Task[]
  },

  /**
   * Get tasks by priority
   */
  getByPriority(priority: TaskPriority): Task[] {
    const stmts = getStatements()
    return stmts.getByPriority.all(priority) as Task[]
  },

  /**
   * Get tasks by assignee
   */
  getByAssignee(assignee: string): Task[] {
    const stmts = getStatements()
    return stmts.getByAssignee.all(assignee) as Task[]
  },

  /**
   * Get overdue tasks
   */
  getOverdue(): Task[] {
    const stmts = getStatements()
    return stmts.getOverdue.all() as Task[]
  },

  /**
   * Mark a task as completed
   */
  complete(id: string): Task | null {
    return taskService.update(id, {
      status: 'completed',
      completed_at: new Date().toISOString()
    })
  }
}

// Reset statements cache (useful for testing)
export function resetTaskStatements(): void {
  statements = null
}
