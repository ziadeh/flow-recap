/**
 * Database Service for Meeting Notes
 *
 * This module handles SQLite database initialization, connection management,
 * schema migrations, and provides the core database instance.
 *
 * NATIVE MODULE LOADING STRATEGY
 * ==============================
 * better-sqlite3 is a native Node.js module that contains compiled .node files.
 * In production builds (ASAR), these files are unpacked to app.asar.unpacked/
 * to ensure they can be loaded correctly by Node.js.
 *
 * This module implements conditional require() logic to handle:
 * 1. Development mode: Load from node_modules directly
 * 2. Production mode (ASAR): Load from unpacked directory
 * 3. Test mode: Load from node_modules with fallback
 */

import path from 'path'
import fs from 'fs'
import type { Migration, MigrationRecord } from '../../src/types/database'

// ============================================================================
// NATIVE MODULE LOADING
// ============================================================================

/**
 * Load better-sqlite3 with fallback logic for different environments
 * This handles the complexity of native module loading in ASAR archives
 */
function loadBetterSqlite3(): typeof import('better-sqlite3') {
  // Try standard require first (works in development and most cases)
  try {
    return require('better-sqlite3')
  } catch (error) {
    // If standard require fails, try with explicit path resolution
    // This can happen in production when the module is in app.asar.unpacked
    console.warn('[database] Standard better-sqlite3 require failed, trying fallback:', error)

    try {
      // In production, Electron's app.getAppPath() returns the path to app.asar
      // Native modules are unpacked to app.asar.unpacked/node_modules/
      const electronApp = require('electron').app
      const appPath = electronApp.getAppPath()

      // Check if we're running from ASAR
      if (appPath.includes('.asar')) {
        const unpackedPath = appPath.replace('.asar', '.asar.unpacked')
        const nativeModulePath = path.join(unpackedPath, 'node_modules', 'better-sqlite3')

        if (fs.existsSync(nativeModulePath)) {
          console.log('[database] Loading better-sqlite3 from unpacked path:', nativeModulePath)
          return require(nativeModulePath)
        }
      }

      // Fallback: try to load from the app's node_modules
      const fallbackPath = path.join(appPath, 'node_modules', 'better-sqlite3')
      if (fs.existsSync(fallbackPath)) {
        console.log('[database] Loading better-sqlite3 from fallback path:', fallbackPath)
        return require(fallbackPath)
      }
    } catch (fallbackError) {
      console.error('[database] Fallback loading also failed:', fallbackError)
    }

    // Re-throw the original error if all fallbacks fail
    throw error
  }
}

// Load better-sqlite3 using our conditional loading strategy
const Database = loadBetterSqlite3()

// Import Electron app, but handle case where it's not available (e.g., in tests)
let app: typeof import('electron')['app'] | null = null
try {
  app = require('electron').app
} catch {
  // Electron not available (e.g., in test environment)
  app = null
}

// ============================================================================
// Database Configuration
// ============================================================================

// Keep the same database filename for backward compatibility
// This ensures existing users don't lose their data when upgrading
const DB_NAME = 'meeting-notes.db'
// Legacy database name (for migration purposes)
const LEGACY_DB_NAME = 'meeting-notes.db'
const CURRENT_SCHEMA_VERSION = 11

// ============================================================================
// Schema Migrations
// ============================================================================

const migrations: Migration[] = [
  {
    version: 1,
    name: 'initial_schema',
    up: `
      -- Enable foreign keys
      PRAGMA foreign_keys = ON;

      -- ========================================
      -- Meetings table
      -- ========================================
      CREATE TABLE IF NOT EXISTS meetings (
        id TEXT PRIMARY KEY NOT NULL,
        title TEXT NOT NULL,
        description TEXT,
        start_time TEXT NOT NULL,
        end_time TEXT,
        duration_seconds INTEGER,
        status TEXT NOT NULL DEFAULT 'scheduled' CHECK(status IN ('scheduled', 'in_progress', 'completed', 'cancelled')),
        audio_file_path TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      );

      -- Indexes for meetings
      CREATE INDEX IF NOT EXISTS idx_meetings_status ON meetings(status);
      CREATE INDEX IF NOT EXISTS idx_meetings_start_time ON meetings(start_time);
      CREATE INDEX IF NOT EXISTS idx_meetings_created_at ON meetings(created_at);

      -- ========================================
      -- Speakers table
      -- ========================================
      CREATE TABLE IF NOT EXISTS speakers (
        id TEXT PRIMARY KEY NOT NULL,
        name TEXT NOT NULL,
        email TEXT,
        voice_profile_path TEXT,
        is_user INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      );

      -- Indexes for speakers
      CREATE INDEX IF NOT EXISTS idx_speakers_email ON speakers(email);
      CREATE INDEX IF NOT EXISTS idx_speakers_is_user ON speakers(is_user);

      -- ========================================
      -- Transcripts table
      -- ========================================
      CREATE TABLE IF NOT EXISTS transcripts (
        id TEXT PRIMARY KEY NOT NULL,
        meeting_id TEXT NOT NULL,
        speaker_id TEXT,
        content TEXT NOT NULL,
        start_time_ms INTEGER NOT NULL,
        end_time_ms INTEGER NOT NULL,
        confidence REAL NOT NULL DEFAULT 1.0,
        is_final INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        FOREIGN KEY (meeting_id) REFERENCES meetings(id) ON DELETE CASCADE,
        FOREIGN KEY (speaker_id) REFERENCES speakers(id) ON DELETE SET NULL
      );

      -- Indexes for transcripts
      CREATE INDEX IF NOT EXISTS idx_transcripts_meeting_id ON transcripts(meeting_id);
      CREATE INDEX IF NOT EXISTS idx_transcripts_speaker_id ON transcripts(speaker_id);
      CREATE INDEX IF NOT EXISTS idx_transcripts_start_time ON transcripts(start_time_ms);

      -- ========================================
      -- Meeting Notes table
      -- ========================================
      CREATE TABLE IF NOT EXISTS meeting_notes (
        id TEXT PRIMARY KEY NOT NULL,
        meeting_id TEXT NOT NULL,
        content TEXT NOT NULL,
        note_type TEXT NOT NULL DEFAULT 'custom' CHECK(note_type IN ('summary', 'action_item', 'decision', 'key_point', 'custom')),
        is_ai_generated INTEGER NOT NULL DEFAULT 0,
        source_transcript_ids TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now')),
        FOREIGN KEY (meeting_id) REFERENCES meetings(id) ON DELETE CASCADE
      );

      -- Indexes for meeting_notes
      CREATE INDEX IF NOT EXISTS idx_meeting_notes_meeting_id ON meeting_notes(meeting_id);
      CREATE INDEX IF NOT EXISTS idx_meeting_notes_note_type ON meeting_notes(note_type);
      CREATE INDEX IF NOT EXISTS idx_meeting_notes_is_ai_generated ON meeting_notes(is_ai_generated);

      -- ========================================
      -- Tasks table
      -- ========================================
      CREATE TABLE IF NOT EXISTS tasks (
        id TEXT PRIMARY KEY NOT NULL,
        meeting_id TEXT,
        title TEXT NOT NULL,
        description TEXT,
        assignee TEXT,
        due_date TEXT,
        priority TEXT NOT NULL DEFAULT 'medium' CHECK(priority IN ('low', 'medium', 'high', 'urgent')),
        status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending', 'in_progress', 'completed', 'cancelled')),
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now')),
        completed_at TEXT,
        FOREIGN KEY (meeting_id) REFERENCES meetings(id) ON DELETE SET NULL
      );

      -- Indexes for tasks
      CREATE INDEX IF NOT EXISTS idx_tasks_meeting_id ON tasks(meeting_id);
      CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status);
      CREATE INDEX IF NOT EXISTS idx_tasks_priority ON tasks(priority);
      CREATE INDEX IF NOT EXISTS idx_tasks_due_date ON tasks(due_date);
      CREATE INDEX IF NOT EXISTS idx_tasks_assignee ON tasks(assignee);

      -- ========================================
      -- Settings table
      -- ========================================
      CREATE TABLE IF NOT EXISTS settings (
        key TEXT PRIMARY KEY NOT NULL,
        value TEXT NOT NULL,
        category TEXT NOT NULL DEFAULT 'general' CHECK(category IN ('general', 'audio', 'transcription', 'ai', 'appearance', 'notifications', 'storage')),
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      );

      -- Indexes for settings
      CREATE INDEX IF NOT EXISTS idx_settings_category ON settings(category);

      -- ========================================
      -- Migrations tracking table
      -- ========================================
      CREATE TABLE IF NOT EXISTS _migrations (
        version INTEGER PRIMARY KEY NOT NULL,
        name TEXT NOT NULL,
        applied_at TEXT NOT NULL DEFAULT (datetime('now'))
      );

      -- ========================================
      -- Triggers for updated_at timestamps
      -- ========================================
      CREATE TRIGGER IF NOT EXISTS update_meetings_timestamp
      AFTER UPDATE ON meetings
      BEGIN
        UPDATE meetings SET updated_at = datetime('now') WHERE id = NEW.id;
      END;

      CREATE TRIGGER IF NOT EXISTS update_speakers_timestamp
      AFTER UPDATE ON speakers
      BEGIN
        UPDATE speakers SET updated_at = datetime('now') WHERE id = NEW.id;
      END;

      CREATE TRIGGER IF NOT EXISTS update_meeting_notes_timestamp
      AFTER UPDATE ON meeting_notes
      BEGIN
        UPDATE meeting_notes SET updated_at = datetime('now') WHERE id = NEW.id;
      END;

      CREATE TRIGGER IF NOT EXISTS update_tasks_timestamp
      AFTER UPDATE ON tasks
      BEGIN
        UPDATE tasks SET updated_at = datetime('now') WHERE id = NEW.id;
      END;

      CREATE TRIGGER IF NOT EXISTS update_settings_timestamp
      AFTER UPDATE ON settings
      BEGIN
        UPDATE settings SET updated_at = datetime('now') WHERE key = NEW.key;
      END;
    `,
    down: `
      DROP TRIGGER IF EXISTS update_settings_timestamp;
      DROP TRIGGER IF EXISTS update_tasks_timestamp;
      DROP TRIGGER IF EXISTS update_meeting_notes_timestamp;
      DROP TRIGGER IF EXISTS update_speakers_timestamp;
      DROP TRIGGER IF EXISTS update_meetings_timestamp;
      DROP TABLE IF EXISTS _migrations;
      DROP TABLE IF EXISTS settings;
      DROP TABLE IF EXISTS tasks;
      DROP TABLE IF EXISTS meeting_notes;
      DROP TABLE IF EXISTS transcripts;
      DROP TABLE IF EXISTS speakers;
      DROP TABLE IF EXISTS meetings;
    `
  },
  {
    version: 2,
    name: 'add_meeting_type_and_recordings',
    up: `
      -- Add meeting_type column to meetings table
      ALTER TABLE meetings ADD COLUMN meeting_type TEXT NOT NULL DEFAULT 'other' CHECK(meeting_type IN ('one-on-one', 'team', 'webinar', 'other'));

      -- ========================================
      -- Recordings table
      -- ========================================
      CREATE TABLE IF NOT EXISTS recordings (
        id TEXT PRIMARY KEY NOT NULL,
        meeting_id TEXT NOT NULL,
        file_path TEXT NOT NULL,
        duration_seconds INTEGER,
        file_size_bytes INTEGER,
        start_time TEXT NOT NULL,
        end_time TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        FOREIGN KEY (meeting_id) REFERENCES meetings(id) ON DELETE CASCADE
      );

      -- Indexes for recordings
      CREATE INDEX IF NOT EXISTS idx_recordings_meeting_id ON recordings(meeting_id);
      CREATE INDEX IF NOT EXISTS idx_recordings_start_time ON recordings(start_time);
    `,
    down: `
      DROP TABLE IF EXISTS recordings;
      -- Note: SQLite doesn't support DROP COLUMN directly, so we would need to recreate the table
      -- For rollback, this is usually acceptable as migrations are meant to go forward
    `
  },
  {
    version: 3,
    name: 'add_transcript_fts5_search',
    up: `
      -- ========================================
      -- FTS5 Virtual Table for Full-Text Search
      -- ========================================
      -- Creates a full-text search index for transcript content
      -- Uses content sync with the transcripts table for automatic updates
      CREATE VIRTUAL TABLE IF NOT EXISTS transcripts_fts USING fts5(
        content,
        meeting_id UNINDEXED,
        speaker_id UNINDEXED,
        transcript_id UNINDEXED,
        content='transcripts',
        content_rowid='rowid'
      );

      -- Populate FTS table with existing transcripts
      INSERT INTO transcripts_fts(rowid, content, meeting_id, speaker_id, transcript_id)
      SELECT rowid, content, meeting_id, speaker_id, id FROM transcripts;

      -- ========================================
      -- Triggers to keep FTS in sync with transcripts table
      -- ========================================

      -- Trigger for INSERT
      CREATE TRIGGER IF NOT EXISTS transcripts_ai AFTER INSERT ON transcripts BEGIN
        INSERT INTO transcripts_fts(rowid, content, meeting_id, speaker_id, transcript_id)
        VALUES (NEW.rowid, NEW.content, NEW.meeting_id, NEW.speaker_id, NEW.id);
      END;

      -- Trigger for DELETE
      CREATE TRIGGER IF NOT EXISTS transcripts_ad AFTER DELETE ON transcripts BEGIN
        INSERT INTO transcripts_fts(transcripts_fts, rowid, content, meeting_id, speaker_id, transcript_id)
        VALUES ('delete', OLD.rowid, OLD.content, OLD.meeting_id, OLD.speaker_id, OLD.id);
      END;

      -- Trigger for UPDATE
      CREATE TRIGGER IF NOT EXISTS transcripts_au AFTER UPDATE ON transcripts BEGIN
        INSERT INTO transcripts_fts(transcripts_fts, rowid, content, meeting_id, speaker_id, transcript_id)
        VALUES ('delete', OLD.rowid, OLD.content, OLD.meeting_id, OLD.speaker_id, OLD.id);
        INSERT INTO transcripts_fts(rowid, content, meeting_id, speaker_id, transcript_id)
        VALUES (NEW.rowid, NEW.content, NEW.meeting_id, NEW.speaker_id, NEW.id);
      END;
    `,
    down: `
      DROP TRIGGER IF EXISTS transcripts_au;
      DROP TRIGGER IF EXISTS transcripts_ad;
      DROP TRIGGER IF EXISTS transcripts_ai;
      DROP TABLE IF EXISTS transcripts_fts;
    `
  },
  {
    version: 4,
    name: 'add_performance_indexes',
    up: `
      -- ========================================
      -- Performance Optimization Indexes
      -- ========================================

      -- Composite index for transcript queries (meeting + timeline ordering)
      CREATE INDEX IF NOT EXISTS idx_transcripts_meeting_time ON transcripts(meeting_id, start_time_ms);

      -- Composite index for transcript queries with finality filter
      CREATE INDEX IF NOT EXISTS idx_transcripts_meeting_final ON transcripts(meeting_id, is_final);

      -- Index for confidence filtering (low-confidence transcript filtering)
      CREATE INDEX IF NOT EXISTS idx_transcripts_confidence ON transcripts(confidence);

      -- Index for tasks completed_at (used for date-range filtering)
      CREATE INDEX IF NOT EXISTS idx_tasks_completed_at ON tasks(completed_at);

      -- Composite index for notes filtering by meeting and type
      CREATE INDEX IF NOT EXISTS idx_meeting_notes_meeting_type ON meeting_notes(meeting_id, note_type);

      -- Index for speaker meeting relationship
      -- This helps with getSpeakersByMeetingId queries
      CREATE INDEX IF NOT EXISTS idx_transcripts_speaker_meeting ON transcripts(speaker_id, meeting_id);
    `,
    down: `
      DROP INDEX IF EXISTS idx_transcripts_meeting_time;
      DROP INDEX IF EXISTS idx_transcripts_meeting_final;
      DROP INDEX IF EXISTS idx_transcripts_confidence;
      DROP INDEX IF EXISTS idx_tasks_completed_at;
      DROP INDEX IF EXISTS idx_meeting_notes_meeting_type;
      DROP INDEX IF EXISTS idx_transcripts_speaker_meeting;
    `
  },
  {
    version: 5,
    name: 'add_meeting_speaker_names',
    up: `
      -- ========================================
      -- Meeting Speaker Names table
      -- ========================================
      -- Stores meeting-specific speaker name overrides
      -- Allows users to rename speakers per-meeting without affecting other meetings
      CREATE TABLE IF NOT EXISTS meeting_speaker_names (
        id TEXT PRIMARY KEY NOT NULL,
        meeting_id TEXT NOT NULL,
        speaker_id TEXT NOT NULL,
        display_name TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now')),
        FOREIGN KEY (meeting_id) REFERENCES meetings(id) ON DELETE CASCADE,
        FOREIGN KEY (speaker_id) REFERENCES speakers(id) ON DELETE CASCADE,
        UNIQUE(meeting_id, speaker_id)
      );

      -- Indexes for meeting_speaker_names
      CREATE INDEX IF NOT EXISTS idx_meeting_speaker_names_meeting_id ON meeting_speaker_names(meeting_id);
      CREATE INDEX IF NOT EXISTS idx_meeting_speaker_names_speaker_id ON meeting_speaker_names(speaker_id);

      -- Trigger to update timestamp on update
      CREATE TRIGGER IF NOT EXISTS update_meeting_speaker_names_timestamp
      AFTER UPDATE ON meeting_speaker_names
      BEGIN
        UPDATE meeting_speaker_names SET updated_at = datetime('now') WHERE id = NEW.id;
      END;
    `,
    down: `
      DROP TRIGGER IF EXISTS update_meeting_speaker_names_timestamp;
      DROP INDEX IF EXISTS idx_meeting_speaker_names_speaker_id;
      DROP INDEX IF EXISTS idx_meeting_speaker_names_meeting_id;
      DROP TABLE IF EXISTS meeting_speaker_names;
    `
  },
  {
    version: 6,
    name: 'add_transcript_corrections',
    up: `
      -- ========================================
      -- Transcript Corrections table
      -- ========================================
      -- Stores AI-assisted corrections for transcript segments
      -- Supports accept/reject workflow with change history
      CREATE TABLE IF NOT EXISTS transcript_corrections (
        id TEXT PRIMARY KEY NOT NULL,
        transcript_id TEXT NOT NULL,
        meeting_id TEXT NOT NULL,
        original_content TEXT NOT NULL,
        corrected_content TEXT NOT NULL,
        changes TEXT NOT NULL,  -- JSON array of TextChange objects
        trigger TEXT NOT NULL DEFAULT 'manual' CHECK(trigger IN ('low_confidence', 'speaker_change', 'manual', 'batch')),
        status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending', 'accepted', 'rejected')),
        llm_provider TEXT,
        llm_model TEXT,
        confidence_score REAL NOT NULL DEFAULT 0.5,
        processing_time_ms INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now')),
        applied_at TEXT,
        FOREIGN KEY (transcript_id) REFERENCES transcripts(id) ON DELETE CASCADE,
        FOREIGN KEY (meeting_id) REFERENCES meetings(id) ON DELETE CASCADE
      );

      -- Indexes for transcript_corrections
      CREATE INDEX IF NOT EXISTS idx_transcript_corrections_transcript_id ON transcript_corrections(transcript_id);
      CREATE INDEX IF NOT EXISTS idx_transcript_corrections_meeting_id ON transcript_corrections(meeting_id);
      CREATE INDEX IF NOT EXISTS idx_transcript_corrections_status ON transcript_corrections(status);
      CREATE INDEX IF NOT EXISTS idx_transcript_corrections_trigger ON transcript_corrections(trigger);

      -- Trigger to update timestamp on update
      CREATE TRIGGER IF NOT EXISTS update_transcript_corrections_timestamp
      AFTER UPDATE ON transcript_corrections
      BEGIN
        UPDATE transcript_corrections SET updated_at = datetime('now') WHERE id = NEW.id;
      END;
    `,
    down: `
      DROP TRIGGER IF EXISTS update_transcript_corrections_timestamp;
      DROP INDEX IF EXISTS idx_transcript_corrections_trigger;
      DROP INDEX IF EXISTS idx_transcript_corrections_status;
      DROP INDEX IF EXISTS idx_transcript_corrections_meeting_id;
      DROP INDEX IF EXISTS idx_transcript_corrections_transcript_id;
      DROP TABLE IF EXISTS transcript_corrections;
    `
  },
  {
    version: 7,
    name: 'add_confidence_analytics',
    up: `
      -- ========================================
      -- Confidence Metrics table
      -- ========================================
      -- Stores aggregated confidence metrics for meetings
      -- Enables analytics and performance tracking
      CREATE TABLE IF NOT EXISTS confidence_metrics (
        id TEXT PRIMARY KEY NOT NULL,
        meeting_id TEXT NOT NULL,
        overall_score REAL NOT NULL DEFAULT 1.0,
        high_confidence_count INTEGER NOT NULL DEFAULT 0,
        medium_confidence_count INTEGER NOT NULL DEFAULT 0,
        low_confidence_count INTEGER NOT NULL DEFAULT 0,
        total_segments INTEGER NOT NULL DEFAULT 0,
        average_word_confidence REAL NOT NULL DEFAULT 1.0,
        min_confidence REAL NOT NULL DEFAULT 1.0,
        max_confidence REAL NOT NULL DEFAULT 1.0,
        needs_review_count INTEGER NOT NULL DEFAULT 0,
        auto_corrected_count INTEGER NOT NULL DEFAULT 0,
        manual_adjustment_count INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now')),
        FOREIGN KEY (meeting_id) REFERENCES meetings(id) ON DELETE CASCADE,
        UNIQUE(meeting_id)
      );

      -- Indexes for confidence_metrics
      CREATE INDEX IF NOT EXISTS idx_confidence_metrics_meeting_id ON confidence_metrics(meeting_id);
      CREATE INDEX IF NOT EXISTS idx_confidence_metrics_overall_score ON confidence_metrics(overall_score);
      CREATE INDEX IF NOT EXISTS idx_confidence_metrics_needs_review ON confidence_metrics(needs_review_count);

      -- ========================================
      -- Confidence Trend Data table
      -- ========================================
      -- Stores confidence scores over time to detect degrading audio quality
      CREATE TABLE IF NOT EXISTS confidence_trends (
        id TEXT PRIMARY KEY NOT NULL,
        meeting_id TEXT NOT NULL,
        timestamp_ms INTEGER NOT NULL,
        window_confidence REAL NOT NULL,
        segment_count INTEGER NOT NULL DEFAULT 1,
        is_alert_triggered INTEGER NOT NULL DEFAULT 0,
        alert_type TEXT CHECK(alert_type IN ('low_confidence', 'degrading_quality', 'audio_issue') OR alert_type IS NULL),
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        FOREIGN KEY (meeting_id) REFERENCES meetings(id) ON DELETE CASCADE
      );

      -- Indexes for confidence_trends
      CREATE INDEX IF NOT EXISTS idx_confidence_trends_meeting_id ON confidence_trends(meeting_id);
      CREATE INDEX IF NOT EXISTS idx_confidence_trends_timestamp ON confidence_trends(meeting_id, timestamp_ms);
      CREATE INDEX IF NOT EXISTS idx_confidence_trends_alerts ON confidence_trends(meeting_id, is_alert_triggered);

      -- ========================================
      -- User Confidence Adjustments table
      -- ========================================
      -- Tracks manual confidence adjustments by users
      CREATE TABLE IF NOT EXISTS confidence_adjustments (
        id TEXT PRIMARY KEY NOT NULL,
        transcript_id TEXT NOT NULL,
        meeting_id TEXT NOT NULL,
        original_confidence REAL NOT NULL,
        adjusted_confidence REAL NOT NULL,
        reason TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        FOREIGN KEY (transcript_id) REFERENCES transcripts(id) ON DELETE CASCADE,
        FOREIGN KEY (meeting_id) REFERENCES meetings(id) ON DELETE CASCADE
      );

      -- Indexes for confidence_adjustments
      CREATE INDEX IF NOT EXISTS idx_confidence_adjustments_transcript_id ON confidence_adjustments(transcript_id);
      CREATE INDEX IF NOT EXISTS idx_confidence_adjustments_meeting_id ON confidence_adjustments(meeting_id);

      -- Trigger to update confidence_metrics timestamp on update
      CREATE TRIGGER IF NOT EXISTS update_confidence_metrics_timestamp
      AFTER UPDATE ON confidence_metrics
      BEGIN
        UPDATE confidence_metrics SET updated_at = datetime('now') WHERE id = NEW.id;
      END;
    `,
    down: `
      DROP TRIGGER IF EXISTS update_confidence_metrics_timestamp;
      DROP INDEX IF EXISTS idx_confidence_adjustments_meeting_id;
      DROP INDEX IF EXISTS idx_confidence_adjustments_transcript_id;
      DROP TABLE IF EXISTS confidence_adjustments;
      DROP INDEX IF EXISTS idx_confidence_trends_alerts;
      DROP INDEX IF EXISTS idx_confidence_trends_timestamp;
      DROP INDEX IF EXISTS idx_confidence_trends_meeting_id;
      DROP TABLE IF EXISTS confidence_trends;
      DROP INDEX IF EXISTS idx_confidence_metrics_needs_review;
      DROP INDEX IF EXISTS idx_confidence_metrics_overall_score;
      DROP INDEX IF EXISTS idx_confidence_metrics_meeting_id;
      DROP TABLE IF EXISTS confidence_metrics;
    `
  },
  {
    version: 8,
    name: 'add_speaker_name_detection',
    up: `
      -- ========================================
      -- Speaker Name Candidates table
      -- ========================================
      -- Stores detected name candidates for speakers with confidence scores
      -- Supports multiple detection methods and disambiguation
      CREATE TABLE IF NOT EXISTS speaker_name_candidates (
        id TEXT PRIMARY KEY NOT NULL,
        meeting_id TEXT NOT NULL,
        speaker_id TEXT NOT NULL,
        candidate_name TEXT NOT NULL,
        confidence REAL NOT NULL DEFAULT 0.5,
        detection_type TEXT NOT NULL CHECK(detection_type IN ('self_introduction', 'name_reference', 'temporal_correlation', 'manual_correction')),
        detection_context TEXT,
        source_transcript_id TEXT,
        timestamp_ms INTEGER NOT NULL,
        is_accepted INTEGER NOT NULL DEFAULT 0,
        is_rejected INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now')),
        FOREIGN KEY (meeting_id) REFERENCES meetings(id) ON DELETE CASCADE,
        FOREIGN KEY (speaker_id) REFERENCES speakers(id) ON DELETE CASCADE,
        FOREIGN KEY (source_transcript_id) REFERENCES transcripts(id) ON DELETE SET NULL
      );

      -- Indexes for speaker_name_candidates
      CREATE INDEX IF NOT EXISTS idx_speaker_name_candidates_meeting_id ON speaker_name_candidates(meeting_id);
      CREATE INDEX IF NOT EXISTS idx_speaker_name_candidates_speaker_id ON speaker_name_candidates(speaker_id);
      CREATE INDEX IF NOT EXISTS idx_speaker_name_candidates_confidence ON speaker_name_candidates(confidence);
      CREATE INDEX IF NOT EXISTS idx_speaker_name_candidates_accepted ON speaker_name_candidates(is_accepted);

      -- ========================================
      -- Speaker Name Detection Events table
      -- ========================================
      -- Logs all name detection events for debugging and improvement
      CREATE TABLE IF NOT EXISTS speaker_name_detection_events (
        id TEXT PRIMARY KEY NOT NULL,
        meeting_id TEXT NOT NULL,
        speaker_id TEXT,
        event_type TEXT NOT NULL CHECK(event_type IN ('detection', 'confidence_update', 'acceptance', 'rejection', 'manual_override', 'disambiguation')),
        description TEXT NOT NULL,
        confidence REAL,
        candidate_name TEXT,
        detection_type TEXT,
        context_data TEXT,
        timestamp_ms INTEGER NOT NULL,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        FOREIGN KEY (meeting_id) REFERENCES meetings(id) ON DELETE CASCADE,
        FOREIGN KEY (speaker_id) REFERENCES speakers(id) ON DELETE SET NULL
      );

      -- Indexes for speaker_name_detection_events
      CREATE INDEX IF NOT EXISTS idx_speaker_name_detection_events_meeting_id ON speaker_name_detection_events(meeting_id);
      CREATE INDEX IF NOT EXISTS idx_speaker_name_detection_events_speaker_id ON speaker_name_detection_events(speaker_id);
      CREATE INDEX IF NOT EXISTS idx_speaker_name_detection_events_type ON speaker_name_detection_events(event_type);
      CREATE INDEX IF NOT EXISTS idx_speaker_name_detection_events_timestamp ON speaker_name_detection_events(timestamp_ms);

      -- Trigger to update speaker_name_candidates timestamp on update
      CREATE TRIGGER IF NOT EXISTS update_speaker_name_candidates_timestamp
      AFTER UPDATE ON speaker_name_candidates
      BEGIN
        UPDATE speaker_name_candidates SET updated_at = datetime('now') WHERE id = NEW.id;
      END;
    `,
    down: `
      DROP TRIGGER IF EXISTS update_speaker_name_candidates_timestamp;
      DROP INDEX IF EXISTS idx_speaker_name_detection_events_timestamp;
      DROP INDEX IF EXISTS idx_speaker_name_detection_events_type;
      DROP INDEX IF EXISTS idx_speaker_name_detection_events_speaker_id;
      DROP INDEX IF EXISTS idx_speaker_name_detection_events_meeting_id;
      DROP TABLE IF EXISTS speaker_name_detection_events;
      DROP INDEX IF EXISTS idx_speaker_name_candidates_accepted;
      DROP INDEX IF EXISTS idx_speaker_name_candidates_confidence;
      DROP INDEX IF EXISTS idx_speaker_name_candidates_speaker_id;
      DROP INDEX IF EXISTS idx_speaker_name_candidates_meeting_id;
      DROP TABLE IF EXISTS speaker_name_candidates;
    `
  },
  {
    version: 9,
    name: 'add_live_insights_persistence',
    up: `
      -- ========================================
      -- Add fields to tasks table for live insights
      -- ========================================
      ALTER TABLE tasks ADD COLUMN created_during_recording INTEGER NOT NULL DEFAULT 0;
      ALTER TABLE tasks ADD COLUMN generation_timestamp TEXT;

      -- ========================================
      -- Add fields to meeting_notes table for live insights
      -- ========================================
      ALTER TABLE meeting_notes ADD COLUMN created_during_recording INTEGER NOT NULL DEFAULT 0;
      ALTER TABLE meeting_notes ADD COLUMN generation_timestamp TEXT;
      ALTER TABLE meeting_notes ADD COLUMN context TEXT;
      ALTER TABLE meeting_notes ADD COLUMN confidence_score REAL;
      ALTER TABLE meeting_notes ADD COLUMN speaker_id TEXT REFERENCES speakers(id);
      ALTER TABLE meeting_notes ADD COLUMN start_time_ms INTEGER;
      ALTER TABLE meeting_notes ADD COLUMN end_time_ms INTEGER;
      ALTER TABLE meeting_notes ADD COLUMN keywords TEXT;

      -- ========================================
      -- Add indexes for performance
      -- ========================================
      CREATE INDEX IF NOT EXISTS idx_tasks_created_during_recording ON tasks(created_during_recording);
      CREATE INDEX IF NOT EXISTS idx_meeting_notes_created_during_recording ON meeting_notes(created_during_recording);
      CREATE INDEX IF NOT EXISTS idx_meeting_notes_speaker_id ON meeting_notes(speaker_id);
      CREATE INDEX IF NOT EXISTS idx_meeting_notes_note_type ON meeting_notes(note_type);
    `,
    down: `
      DROP INDEX IF EXISTS idx_meeting_notes_note_type;
      DROP INDEX IF EXISTS idx_meeting_notes_speaker_id;
      DROP INDEX IF EXISTS idx_meeting_notes_created_during_recording;
      DROP INDEX IF EXISTS idx_tasks_created_during_recording;

      -- Note: SQLite doesn't support DROP COLUMN, so down migration would require table recreation
      -- For simplicity, we'll leave the columns in place
    `
  },
  {
    version: 10,
    name: 'add_environment_validation_cache',
    up: `
      -- ========================================
      -- Environment Status Cache table
      -- ========================================
      -- Stores Python environment validation results to avoid expensive
      -- re-validation on every app startup. Cache is invalidated when:
      -- 1. validation_hash changes (venv directory modified)
      -- 2. cache exceeds 24 hours
      -- 3. user forces refresh via Settings
      -- 4. user repairs environment
      CREATE TABLE IF NOT EXISTS environment_status (
        id INTEGER PRIMARY KEY NOT NULL,
        environment_name TEXT NOT NULL UNIQUE,
        status TEXT NOT NULL CHECK(status IN ('ready', 'functional', 'degraded', 'failed')),
        python_version TEXT,
        torch_version TEXT,
        packages_json TEXT NOT NULL,
        validation_result_json TEXT NOT NULL,
        last_validated TEXT NOT NULL,
        validation_hash TEXT NOT NULL,
        cache_ttl_hours INTEGER NOT NULL DEFAULT 24,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      );

      -- Indexes for environment_status
      CREATE INDEX IF NOT EXISTS idx_environment_status_name ON environment_status(environment_name);
      CREATE INDEX IF NOT EXISTS idx_environment_status_hash ON environment_status(validation_hash);
      CREATE INDEX IF NOT EXISTS idx_environment_status_validated ON environment_status(last_validated);

      -- Trigger to update timestamp on update
      CREATE TRIGGER IF NOT EXISTS update_environment_status_timestamp
      AFTER UPDATE ON environment_status
      BEGIN
        UPDATE environment_status SET updated_at = datetime('now') WHERE id = NEW.id;
      END;
    `,
    down: `
      DROP TRIGGER IF EXISTS update_environment_status_timestamp;
      DROP INDEX IF EXISTS idx_environment_status_validated;
      DROP INDEX IF EXISTS idx_environment_status_hash;
      DROP INDEX IF EXISTS idx_environment_status_name;
      DROP TABLE IF EXISTS environment_status;
    `
  },
  {
    version: 11,
    name: 'update_environment_status_schema',
    up: `
      -- ========================================
      -- Update Environment Status table schema
      -- ========================================
      -- Migration to update environment_status table to match exact requirements:
      -- 1. Use INTEGER timestamps (Unix epoch) instead of TEXT
      -- 2. Add separate errors_json and warnings_json columns
      -- 3. Maintain backward compatibility with existing cache entries

      -- Create new table with updated schema
      CREATE TABLE environment_status_new (
        id INTEGER PRIMARY KEY NOT NULL,
        environment_name TEXT NOT NULL UNIQUE,
        status TEXT NOT NULL CHECK(status IN ('ready', 'functional', 'degraded', 'failed')),
        python_version TEXT,
        torch_version TEXT,
        packages_json TEXT NOT NULL,
        validation_result_json TEXT NOT NULL,
        last_validated INTEGER NOT NULL,
        validation_hash TEXT NOT NULL,
        errors_json TEXT,
        warnings_json TEXT,
        cache_ttl_hours INTEGER NOT NULL DEFAULT 24,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );

      -- Copy data from old table to new table, converting timestamps
      INSERT INTO environment_status_new (
        id, environment_name, status, python_version, torch_version,
        packages_json, validation_result_json, last_validated, validation_hash,
        errors_json, warnings_json, cache_ttl_hours, created_at, updated_at
      )
      SELECT
        id,
        environment_name,
        status,
        python_version,
        torch_version,
        packages_json,
        validation_result_json,
        CAST(strftime('%s', last_validated) AS INTEGER),
        validation_hash,
        NULL, -- errors_json (will be populated from validation_result_json by service)
        NULL, -- warnings_json (will be populated from validation_result_json by service)
        cache_ttl_hours,
        CAST(strftime('%s', created_at) AS INTEGER),
        CAST(strftime('%s', updated_at) AS INTEGER)
      FROM environment_status;

      -- Drop old table
      DROP TABLE environment_status;

      -- Rename new table to original name
      ALTER TABLE environment_status_new RENAME TO environment_status;

      -- Recreate indexes
      CREATE UNIQUE INDEX idx_env_name ON environment_status(environment_name);
      CREATE INDEX idx_last_validated ON environment_status(last_validated);
      CREATE INDEX idx_environment_status_hash ON environment_status(validation_hash);

      -- Recreate trigger for automatic updated_at (using Unix timestamp)
      CREATE TRIGGER update_environment_status_timestamp
      AFTER UPDATE ON environment_status
      BEGIN
        UPDATE environment_status SET updated_at = strftime('%s', 'now') WHERE id = NEW.id;
      END;
    `,
    down: `
      -- Revert back to TEXT timestamps
      CREATE TABLE environment_status_old (
        id INTEGER PRIMARY KEY NOT NULL,
        environment_name TEXT NOT NULL UNIQUE,
        status TEXT NOT NULL CHECK(status IN ('ready', 'functional', 'degraded', 'failed')),
        python_version TEXT,
        torch_version TEXT,
        packages_json TEXT NOT NULL,
        validation_result_json TEXT NOT NULL,
        last_validated TEXT NOT NULL,
        validation_hash TEXT NOT NULL,
        cache_ttl_hours INTEGER NOT NULL DEFAULT 24,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      );

      INSERT INTO environment_status_old (
        id, environment_name, status, python_version, torch_version,
        packages_json, validation_result_json, last_validated, validation_hash,
        cache_ttl_hours, created_at, updated_at
      )
      SELECT
        id, environment_name, status, python_version, torch_version,
        packages_json, validation_result_json,
        datetime(last_validated, 'unixepoch'),
        validation_hash,
        cache_ttl_hours,
        datetime(created_at, 'unixepoch'),
        datetime(updated_at, 'unixepoch')
      FROM environment_status;

      DROP TRIGGER IF EXISTS update_environment_status_timestamp;
      DROP INDEX IF EXISTS idx_environment_status_hash;
      DROP INDEX IF EXISTS idx_last_validated;
      DROP INDEX IF EXISTS idx_env_name;
      DROP TABLE environment_status;

      ALTER TABLE environment_status_old RENAME TO environment_status;

      CREATE INDEX idx_environment_status_name ON environment_status(environment_name);
      CREATE INDEX idx_environment_status_hash ON environment_status(validation_hash);
      CREATE INDEX idx_environment_status_validated ON environment_status(last_validated);

      CREATE TRIGGER update_environment_status_timestamp
      AFTER UPDATE ON environment_status
      BEGIN
        UPDATE environment_status SET updated_at = datetime('now') WHERE id = NEW.id;
      END;
    `
  }
]

// ============================================================================
// Database Service Class
// ============================================================================

class DatabaseService {
  private static instance: DatabaseService | null = null
  private db: Database.Database | null = null
  private dbPath: string = ''

  private constructor() {}

  /**
   * Get the singleton database service instance
   */
  static getInstance(): DatabaseService {
    if (!DatabaseService.instance) {
      DatabaseService.instance = new DatabaseService()
    }
    return DatabaseService.instance
  }

  /**
   * Get the database path
   */
  getDbPath(): string {
    return this.dbPath
  }

  /**
   * Initialize the database connection and run migrations
   */
  initialize(customPath?: string): Database.Database {
    if (this.db) {
      return this.db
    }

    // Determine database path
    if (customPath) {
      this.dbPath = customPath
    } else {
      if (!app) {
        throw new Error('Electron app not available. Provide a customPath for database initialization.')
      }
      const userDataPath = app.getPath('userData')
      this.dbPath = path.join(userDataPath, DB_NAME)
    }

    // Ensure directory exists
    const dbDir = path.dirname(this.dbPath)
    if (!fs.existsSync(dbDir)) {
      fs.mkdirSync(dbDir, { recursive: true })
    }

    // Create database connection
    this.db = new Database(this.dbPath)

    // Enable WAL mode for better performance
    this.db.pragma('journal_mode = WAL')

    // Enable foreign keys
    this.db.pragma('foreign_keys = ON')

    // Run migrations
    this.runMigrations()

    return this.db
  }

  /**
   * Get the database instance
   */
  getDatabase(): Database.Database {
    if (!this.db) {
      throw new Error('Database not initialized. Call initialize() first.')
    }
    return this.db
  }

  /**
   * Run pending migrations
   */
  private runMigrations(): void {
    if (!this.db) {
      throw new Error('Database not initialized')
    }

    // Create migrations table if it doesn't exist
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS _migrations (
        version INTEGER PRIMARY KEY NOT NULL,
        name TEXT NOT NULL,
        applied_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
    `)

    // Get applied migrations
    const appliedMigrations = this.db
      .prepare('SELECT version FROM _migrations ORDER BY version')
      .all() as { version: number }[]

    const appliedVersions = new Set(appliedMigrations.map(m => m.version))

    // Run pending migrations in a transaction
    for (const migration of migrations) {
      if (!appliedVersions.has(migration.version)) {
        console.log(`Running migration ${migration.version}: ${migration.name}`)

        const runMigration = this.db.transaction(() => {
          // Execute migration SQL
          this.db!.exec(migration.up)

          // Record migration
          this.db!.prepare(
            'INSERT INTO _migrations (version, name) VALUES (?, ?)'
          ).run(migration.version, migration.name)
        })

        runMigration()
        console.log(`Migration ${migration.version} completed`)
      }
    }
  }

  /**
   * Get current schema version
   */
  getSchemaVersion(): number {
    if (!this.db) {
      return 0
    }

    const result = this.db
      .prepare('SELECT MAX(version) as version FROM _migrations')
      .get() as { version: number | null }

    return result?.version ?? 0
  }

  /**
   * Get migration history
   */
  getMigrationHistory(): MigrationRecord[] {
    if (!this.db) {
      return []
    }

    return this.db
      .prepare('SELECT version, name, applied_at FROM _migrations ORDER BY version')
      .all() as MigrationRecord[]
  }

  /**
   * Backup the database to a specified path
   */
  backup(backupPath: string): boolean {
    if (!this.db) {
      throw new Error('Database not initialized')
    }

    try {
      this.db.backup(backupPath).then(() => {
        console.log(`Database backed up to: ${backupPath}`)
      })
      return true
    } catch (error) {
      console.error('Backup failed:', error)
      return false
    }
  }

  /**
   * Get database statistics
   */
  getStats(): {
    meetingCount: number
    transcriptCount: number
    noteCount: number
    taskCount: number
    speakerCount: number
    databaseSizeBytes: number
  } {
    if (!this.db) {
      throw new Error('Database not initialized')
    }

    const meetingCount = (this.db.prepare('SELECT COUNT(*) as count FROM meetings').get() as { count: number }).count
    const transcriptCount = (this.db.prepare('SELECT COUNT(*) as count FROM transcripts').get() as { count: number }).count
    const noteCount = (this.db.prepare('SELECT COUNT(*) as count FROM meeting_notes').get() as { count: number }).count
    const taskCount = (this.db.prepare('SELECT COUNT(*) as count FROM tasks').get() as { count: number }).count
    const speakerCount = (this.db.prepare('SELECT COUNT(*) as count FROM speakers').get() as { count: number }).count

    // Get database file size
    let databaseSizeBytes = 0
    try {
      const stats = fs.statSync(this.dbPath)
      databaseSizeBytes = stats.size
    } catch {
      // Ignore errors
    }

    return {
      meetingCount,
      transcriptCount,
      noteCount,
      taskCount,
      speakerCount,
      databaseSizeBytes
    }
  }

  /**
   * Close the database connection
   */
  close(): void {
    if (this.db) {
      this.db.close()
      this.db = null
    }
  }

  /**
   * Check if database is initialized
   */
  isInitialized(): boolean {
    return this.db !== null
  }

  /**
   * Execute raw SQL (use with caution)
   */
  exec(sql: string): void {
    if (!this.db) {
      throw new Error('Database not initialized')
    }
    this.db.exec(sql)
  }

  /**
   * Create a transaction
   */
  transaction<T>(fn: () => T): T {
    if (!this.db) {
      throw new Error('Database not initialized')
    }
    return this.db.transaction(fn)()
  }
}

// ============================================================================
// Exports
// ============================================================================

// Export singleton instance getter
export const getDatabaseService = (): DatabaseService => {
  return DatabaseService.getInstance()
}

// Export for testing purposes
export { DatabaseService, CURRENT_SCHEMA_VERSION, migrations }
