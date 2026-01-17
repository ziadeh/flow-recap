/**
 * Settings Service
 *
 * Handles CRUD operations for application settings with prepared statements
 */

import type Database from 'better-sqlite3'
import { getDatabaseService } from './database'
import type { Setting, SettingCategory, CreateSettingInput } from '../../src/types/database'

// ============================================================================
// Prepared Statements Cache
// ============================================================================

let statements: {
  get: Database.Statement
  set: Database.Statement
  delete: Database.Statement
  getByCategory: Database.Statement
  getAll: Database.Statement
} | null = null

function getStatements() {
  if (statements) return statements

  const db = getDatabaseService().getDatabase()

  statements = {
    get: db.prepare(`
      SELECT * FROM settings WHERE key = ?
    `),

    set: db.prepare(`
      INSERT INTO settings (key, value, category, created_at, updated_at)
      VALUES (@key, @value, @category, datetime('now'), datetime('now'))
      ON CONFLICT(key) DO UPDATE SET
        value = excluded.value,
        category = excluded.category
    `),

    delete: db.prepare(`
      DELETE FROM settings WHERE key = ?
    `),

    getByCategory: db.prepare(`
      SELECT * FROM settings WHERE category = ? ORDER BY key ASC
    `),

    getAll: db.prepare(`
      SELECT * FROM settings ORDER BY category ASC, key ASC
    `)
  }

  return statements
}

// ============================================================================
// Settings Service Functions
// ============================================================================

export const settingsService = {
  /**
   * Get a setting value by key
   */
  get<T = unknown>(key: string): T | null {
    const stmts = getStatements()
    const setting = stmts.get.get(key) as Setting | undefined

    if (!setting) return null

    try {
      return JSON.parse(setting.value) as T
    } catch {
      return setting.value as unknown as T
    }
  },

  /**
   * Get raw setting record
   */
  getRaw(key: string): Setting | null {
    const stmts = getStatements()
    return (stmts.get.get(key) as Setting) || null
  },

  /**
   * Set a setting value
   */
  set(key: string, value: unknown, category: SettingCategory = 'general'): Setting {
    const stmts = getStatements()

    const params = {
      key,
      value: JSON.stringify(value),
      category
    }

    stmts.set.run(params)

    return stmts.get.get(key) as Setting
  },

  /**
   * Set multiple settings at once
   */
  setMany(settings: CreateSettingInput[]): void {
    const db = getDatabaseService().getDatabase()
    const stmts = getStatements()

    const setAll = db.transaction(() => {
      for (const setting of settings) {
        const params = {
          key: setting.key,
          value: JSON.stringify(setting.value),
          category: setting.category
        }
        stmts.set.run(params)
      }
    })

    setAll()
  },

  /**
   * Delete a setting
   */
  delete(key: string): boolean {
    const stmts = getStatements()
    const result = stmts.delete.run(key)
    return result.changes > 0
  },

  /**
   * Get all settings in a category
   */
  getByCategory(category: SettingCategory): Setting[] {
    const stmts = getStatements()
    return stmts.getByCategory.all(category) as Setting[]
  },

  /**
   * Get all settings in a category as a key-value object
   */
  getCategoryAsObject<T = Record<string, unknown>>(category: SettingCategory): T {
    const settings = settingsService.getByCategory(category)
    const result: Record<string, unknown> = {}

    for (const setting of settings) {
      try {
        result[setting.key] = JSON.parse(setting.value)
      } catch {
        result[setting.key] = setting.value
      }
    }

    return result as T
  },

  /**
   * Get all settings
   */
  getAll(): Setting[] {
    const stmts = getStatements()
    return stmts.getAll.all() as Setting[]
  },

  /**
   * Get all settings as a grouped object
   */
  getAllGrouped(): Record<SettingCategory, Record<string, unknown>> {
    const settings = settingsService.getAll()
    const result: Record<string, Record<string, unknown>> = {
      general: {},
      audio: {},
      transcription: {},
      ai: {},
      appearance: {},
      notifications: {},
      storage: {}
    }

    for (const setting of settings) {
      try {
        result[setting.category][setting.key] = JSON.parse(setting.value)
      } catch {
        result[setting.category][setting.key] = setting.value
      }
    }

    return result as Record<SettingCategory, Record<string, unknown>>
  },

  /**
   * Check if a setting exists
   */
  exists(key: string): boolean {
    const stmts = getStatements()
    return stmts.get.get(key) !== undefined
  },

  /**
   * Get a setting with a default value
   */
  getOrDefault<T>(key: string, defaultValue: T): T {
    const value = settingsService.get<T>(key)
    return value !== null ? value : defaultValue
  },

  /**
   * Initialize default settings if they don't exist
   */
  initializeDefaults(defaults: CreateSettingInput[]): void {
    const db = getDatabaseService().getDatabase()
    const stmts = getStatements()

    const initDefaults = db.transaction(() => {
      for (const setting of defaults) {
        // Only set if doesn't exist
        const existing = stmts.get.get(setting.key)
        if (!existing) {
          const params = {
            key: setting.key,
            value: JSON.stringify(setting.value),
            category: setting.category
          }
          stmts.set.run(params)
        }
      }
    })

    initDefaults()
  }
}

// ============================================================================
// Default Settings
// ============================================================================

export const defaultSettings: CreateSettingInput[] = [
  // General settings
  { key: 'app.language', value: 'en', category: 'general' },
  { key: 'app.autoStart', value: false, category: 'general' },

  // Audio settings
  { key: 'audio.inputDevice', value: 'default', category: 'audio' },
  { key: 'audio.outputDevice', value: 'default', category: 'audio' },
  { key: 'audio.sampleRate', value: 16000, category: 'audio' },
  { key: 'audio.autoRecord', value: false, category: 'audio' },

  // Transcription settings
  { key: 'transcription.model', value: 'whisper-small', category: 'transcription' },
  { key: 'transcription.language', value: 'auto', category: 'transcription' },
  { key: 'transcription.realtime', value: true, category: 'transcription' },
  { key: 'transcription.hfToken', value: '', category: 'transcription' },
  // Startup validation level: 'fast' (cached only), 'balanced' (verify critical packages), 'thorough' (full validation)
  { key: 'transcription.startupValidationLevel', value: 'fast', category: 'transcription' },

  // AI settings
  { key: 'ai.provider', value: 'local', category: 'ai' },
  { key: 'ai.model', value: 'default', category: 'ai' },
  { key: 'ai.lmStudioUrl', value: 'http://localhost:1234', category: 'ai' },
  { key: 'ai.autoSummarize', value: true, category: 'ai' },
  { key: 'ai.autoExtractActionItems', value: true, category: 'ai' },
  { key: 'ai.autoStartLiveNotes', value: false, category: 'ai' },

  // Appearance settings
  { key: 'appearance.theme', value: 'system', category: 'appearance' },
  { key: 'appearance.fontSize', value: 14, category: 'appearance' },

  // Notification settings
  { key: 'notifications.enabled', value: true, category: 'notifications' },
  { key: 'notifications.sound', value: true, category: 'notifications' },

  // Storage settings
  { key: 'storage.audioRetentionDays', value: 30, category: 'storage' },
  { key: 'storage.autoCleanup', value: true, category: 'storage' },
  { key: 'storage.recordingsPath', value: null, category: 'storage' } // Will be set to default path on first use
]

// Reset statements cache (useful for testing)
export function resetSettingsStatements(): void {
  statements = null
}
