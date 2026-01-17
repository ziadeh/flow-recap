/**
 * Export & Delete Service
 *
 * Provides comprehensive export functionality for meetings including:
 * - JSON archive (all data: transcripts, notes, tasks, metadata)
 * - PDF report (formatted notes, transcript, tasks)
 * - Audio files only (ZIP of all recordings)
 * - Full backup (audio + JSON data)
 *
 * Also provides import functionality to restore exported meetings.
 */

import { dialog, BrowserWindow, app } from 'electron'
import { writeFile, mkdir, readFile, copyFile, stat } from 'fs/promises'
import { createWriteStream, createReadStream, existsSync } from 'fs'
import path from 'path'
import { randomUUID } from 'crypto'
import archiver from 'archiver'
import { meetingService } from './meetingService'
import { recordingService } from './recordingService'
import { transcriptService } from './transcriptService'
import { meetingNoteService } from './meetingNoteService'
import { taskService } from './taskService'
import { speakerService } from './speakerService'
import { meetingSpeakerNameService } from './meetingSpeakerNameService'
import { meetingDeletionService } from './meetingDeletionService'
import { exportService } from './exportService'
import type { Meeting, Transcript, MeetingNote, Task, Speaker, Recording, MeetingSpeakerName } from '../../src/types/database'
import type {
  ExportArchiveFormat,
  ExportTemplate,
  ExportContentConfig,
  ExportOptions,
  ExportPreview,
  ExportProgress,
  ExportResult,
  BatchExportResult,
  ImportFileInfo,
  ImportOptions,
  ImportResult,
  ExportAndDeleteOptions,
  ExportAndDeleteResult,
  ArchiveToDiskOptions,
  ArchiveToDiskResult,
  TEMPLATE_CONFIGS
} from '../../src/types/export-delete'

// ============================================================================
// Types
// ============================================================================

/**
 * Complete meeting data structure for JSON export
 */
interface MeetingExportData {
  exportVersion: string
  exportDate: string
  exportFormat: ExportArchiveFormat
  meeting: Meeting
  recordings: Recording[]
  transcripts: Transcript[]
  notes: MeetingNote[]
  tasks: Task[]
  speakers: Speaker[]
  speakerNames: MeetingSpeakerName[]
}

// Progress callback type
type ProgressCallback = (progress: ExportProgress) => void

// ============================================================================
// Template Configurations
// ============================================================================

const TEMPLATE_CONFIGS_INTERNAL: Record<ExportTemplate, ExportContentConfig> = {
  meeting_minutes: {
    includeMetadata: true,
    includeSummary: true,
    includeKeyPoints: true,
    includeActionItems: true,
    includeDecisions: true,
    includeTranscript: false,
    includeSpeakers: true,
    includeTimestamps: false,
    includeCustomNotes: false
  },
  full_transcript: {
    includeMetadata: true,
    includeSummary: false,
    includeKeyPoints: false,
    includeActionItems: false,
    includeDecisions: false,
    includeTranscript: true,
    includeSpeakers: true,
    includeTimestamps: true,
    includeCustomNotes: false
  },
  action_items_only: {
    includeMetadata: true,
    includeSummary: false,
    includeKeyPoints: false,
    includeActionItems: true,
    includeDecisions: true,
    includeTranscript: false,
    includeSpeakers: false,
    includeTimestamps: false,
    includeCustomNotes: false
  },
  custom: {
    includeMetadata: true,
    includeSummary: true,
    includeKeyPoints: true,
    includeActionItems: true,
    includeDecisions: true,
    includeTranscript: true,
    includeSpeakers: true,
    includeTimestamps: true,
    includeCustomNotes: true
  }
}

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Sanitize filename for filesystem
 */
function sanitizeFilename(name: string): string {
  return name
    .replace(/[<>:"/\\|?*]/g, '-')
    .replace(/\s+/g, '_')
    .substring(0, 100)
}

/**
 * Get file size safely
 */
async function getFileSize(filePath: string): Promise<number> {
  try {
    if (existsSync(filePath)) {
      const stats = await stat(filePath)
      return stats.size
    }
  } catch {
    // Ignore errors
  }
  return 0
}

/**
 * Format date for display
 */
function formatDate(isoString: string): string {
  const date = new Date(isoString)
  return date.toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true
  })
}

/**
 * Format duration in milliseconds to timestamp
 */
function formatTimestamp(milliseconds: number): string {
  const totalSeconds = Math.floor(milliseconds / 1000)
  const hours = Math.floor(totalSeconds / 3600)
  const minutes = Math.floor((totalSeconds % 3600) / 60)
  const seconds = totalSeconds % 60

  if (hours > 0) {
    return `${hours}:${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`
  }
  return `${minutes}:${seconds.toString().padStart(2, '0')}`
}

/**
 * Get speaker name by ID
 */
function getSpeakerName(speakerId: string | null, speakers: Speaker[], speakerNames: MeetingSpeakerName[]): string {
  if (!speakerId) return 'Unknown Speaker'

  // First check meeting-specific speaker names
  const meetingName = speakerNames.find(sn => sn.speaker_id === speakerId)
  if (meetingName) return meetingName.display_name

  // Fall back to global speaker name
  const speaker = speakers.find(s => s.id === speakerId)
  return speaker?.name || speakerId
}

/**
 * Get content config from template or custom config
 */
function getContentConfig(options: ExportOptions): ExportContentConfig {
  const template = options.template || 'custom'
  const baseConfig = TEMPLATE_CONFIGS_INTERNAL[template]

  if (options.content) {
    return { ...baseConfig, ...options.content }
  }

  return baseConfig
}

/**
 * Fetch all meeting data
 */
function fetchMeetingData(meetingId: string): MeetingExportData | null {
  const meeting = meetingService.getById(meetingId)
  if (!meeting) return null

  const recordings = recordingService.getByMeetingId(meetingId)
  const transcripts = transcriptService.getByMeetingId(meetingId)
  const notes = meetingNoteService.getByMeetingId(meetingId)
  const tasks = taskService.getByMeetingId(meetingId)
  const speakers = speakerService.getAll()
  const speakerNames = meetingSpeakerNameService.getByMeetingId(meetingId)

  return {
    exportVersion: '1.0.0',
    exportDate: new Date().toISOString(),
    exportFormat: 'json',
    meeting,
    recordings,
    transcripts,
    notes,
    tasks,
    speakers,
    speakerNames
  }
}

// ============================================================================
// Export Service Class
// ============================================================================

class ExportDeleteService {
  private progressCallbacks: Set<ProgressCallback> = new Set()
  private currentProgress: ExportProgress | null = null

  /**
   * Register a progress callback
   */
  onProgress(callback: ProgressCallback): () => void {
    this.progressCallbacks.add(callback)
    return () => {
      this.progressCallbacks.delete(callback)
    }
  }

  /**
   * Emit progress to all registered callbacks
   */
  private emitProgress(progress: ExportProgress): void {
    this.currentProgress = progress
    for (const callback of this.progressCallbacks) {
      callback(progress)
    }
  }

  /**
   * Get export preview showing estimated size and content counts
   */
  async getExportPreview(meetingId: string, options: ExportOptions): Promise<ExportPreview | null> {
    const data = fetchMeetingData(meetingId)
    if (!data) return null

    const contentConfig = getContentConfig(options)

    // Calculate sizes
    let audioFilesSize = 0
    const audioFilePaths: string[] = []

    if (options.includeAudio || options.format === 'audio' || options.format === 'full') {
      for (const recording of data.recordings) {
        if (recording.file_path && existsSync(recording.file_path)) {
          const size = await getFileSize(recording.file_path)
          audioFilesSize += size
          audioFilePaths.push(recording.file_path)
        }
      }

      if (data.meeting.audio_file_path && existsSync(data.meeting.audio_file_path)) {
        const size = await getFileSize(data.meeting.audio_file_path)
        audioFilesSize += size
        audioFilePaths.push(data.meeting.audio_file_path)
      }
    }

    // Estimate JSON data sizes
    const metadataSize = JSON.stringify(data.meeting).length
    const transcriptsSize = contentConfig.includeTranscript ? JSON.stringify(data.transcripts).length : 0
    const notesSize = JSON.stringify(data.notes.filter(n => {
      if (n.note_type === 'summary' && !contentConfig.includeSummary) return false
      if (n.note_type === 'key_point' && !contentConfig.includeKeyPoints) return false
      if (n.note_type === 'action_item' && !contentConfig.includeActionItems) return false
      if (n.note_type === 'decision' && !contentConfig.includeDecisions) return false
      if (n.note_type === 'custom' && !contentConfig.includeCustomNotes) return false
      return true
    })).length
    const tasksSize = contentConfig.includeActionItems ? JSON.stringify(data.tasks).length : 0

    // Estimate total size based on format
    let estimatedSizeBytes = metadataSize + transcriptsSize + notesSize + tasksSize

    if (options.format === 'pdf') {
      // PDF is typically 2-3x the text size due to formatting
      estimatedSizeBytes = estimatedSizeBytes * 2.5
    } else if (options.format === 'audio') {
      estimatedSizeBytes = audioFilesSize
    } else if (options.format === 'full') {
      estimatedSizeBytes = estimatedSizeBytes + audioFilesSize
    }

    // If compressing, estimate ~60% of original size
    if (options.compress && (options.format === 'json' || options.format === 'full')) {
      estimatedSizeBytes = Math.round(estimatedSizeBytes * 0.6)
    }

    // Estimate time (rough: 100ms per MB + 50ms per audio file)
    const estimatedTimeMs = Math.max(
      500,
      Math.round((estimatedSizeBytes / (1024 * 1024)) * 100) + (audioFilePaths.length * 50)
    )

    return {
      meetingId,
      meetingTitle: data.meeting.title,
      estimatedSizeBytes,
      sizeBreakdown: {
        metadata: metadataSize,
        transcripts: transcriptsSize,
        notes: notesSize,
        tasks: tasksSize,
        audioFiles: audioFilesSize
      },
      itemCounts: {
        transcriptSegments: data.transcripts.length,
        notes: data.notes.length,
        tasks: data.tasks.length,
        speakers: data.speakers.length,
        audioFiles: audioFilePaths.length
      },
      audioFilePaths,
      estimatedTimeMs
    }
  }

  /**
   * Export meeting to JSON archive
   */
  async exportToJson(
    meetingId: string,
    outputPath: string,
    options: ExportOptions
  ): Promise<ExportResult> {
    const startTime = Date.now()

    try {
      const data = fetchMeetingData(meetingId)
      if (!data) {
        return { success: false, format: 'json', exportedContent: { transcriptSegments: 0, notes: 0, tasks: 0, speakers: 0, audioFiles: 0 }, durationMs: 0, error: 'Meeting not found' }
      }

      const contentConfig = getContentConfig(options)

      // Filter content based on config
      const exportData: MeetingExportData = {
        ...data,
        exportFormat: 'json',
        transcripts: contentConfig.includeTranscript ? data.transcripts : [],
        notes: data.notes.filter(n => {
          if (n.note_type === 'summary' && !contentConfig.includeSummary) return false
          if (n.note_type === 'key_point' && !contentConfig.includeKeyPoints) return false
          if (n.note_type === 'action_item' && !contentConfig.includeActionItems) return false
          if (n.note_type === 'decision' && !contentConfig.includeDecisions) return false
          if (n.note_type === 'custom' && !contentConfig.includeCustomNotes) return false
          return true
        }),
        tasks: contentConfig.includeActionItems ? data.tasks : [],
        speakers: contentConfig.includeSpeakers ? data.speakers : [],
        speakerNames: contentConfig.includeSpeakers ? data.speakerNames : []
      }

      this.emitProgress({
        step: 'exporting_data',
        percent: 30,
        filesProcessed: 0,
        totalFiles: 1,
        bytesWritten: 0,
        totalBytes: 0
      })

      const jsonContent = JSON.stringify(exportData, null, 2)

      // Ensure directory exists
      const dir = path.dirname(outputPath)
      if (!existsSync(dir)) {
        await mkdir(dir, { recursive: true })
      }

      this.emitProgress({
        step: 'writing',
        percent: 70,
        filesProcessed: 0,
        totalFiles: 1,
        bytesWritten: 0,
        totalBytes: jsonContent.length
      })

      await writeFile(outputPath, jsonContent, 'utf-8')

      const fileSizeBytes = await getFileSize(outputPath)

      this.emitProgress({
        step: 'complete',
        percent: 100,
        filesProcessed: 1,
        totalFiles: 1,
        bytesWritten: fileSizeBytes,
        totalBytes: fileSizeBytes
      })

      return {
        success: true,
        filePath: outputPath,
        fileSizeBytes,
        format: 'json',
        exportedContent: {
          transcriptSegments: exportData.transcripts.length,
          notes: exportData.notes.length,
          tasks: exportData.tasks.length,
          speakers: exportData.speakers.length,
          audioFiles: 0
        },
        durationMs: Date.now() - startTime
      }
    } catch (error) {
      this.emitProgress({
        step: 'error',
        percent: 0,
        filesProcessed: 0,
        totalFiles: 1,
        bytesWritten: 0,
        totalBytes: 0,
        error: error instanceof Error ? error.message : 'Unknown error'
      })

      return {
        success: false,
        format: 'json',
        exportedContent: { transcriptSegments: 0, notes: 0, tasks: 0, speakers: 0, audioFiles: 0 },
        durationMs: Date.now() - startTime,
        error: error instanceof Error ? error.message : 'Unknown error'
      }
    }
  }

  /**
   * Export meeting audio files to ZIP archive
   */
  async exportToAudioZip(
    meetingId: string,
    outputPath: string
  ): Promise<ExportResult> {
    const startTime = Date.now()

    try {
      const data = fetchMeetingData(meetingId)
      if (!data) {
        return { success: false, format: 'audio', exportedContent: { transcriptSegments: 0, notes: 0, tasks: 0, speakers: 0, audioFiles: 0 }, durationMs: 0, error: 'Meeting not found' }
      }

      // Collect audio files
      const audioFiles: { path: string; name: string }[] = []

      for (const recording of data.recordings) {
        if (recording.file_path && existsSync(recording.file_path)) {
          audioFiles.push({
            path: recording.file_path,
            name: path.basename(recording.file_path)
          })
        }
      }

      if (data.meeting.audio_file_path && existsSync(data.meeting.audio_file_path)) {
        audioFiles.push({
          path: data.meeting.audio_file_path,
          name: `main_${path.basename(data.meeting.audio_file_path)}`
        })
      }

      if (audioFiles.length === 0) {
        return {
          success: false,
          format: 'audio',
          exportedContent: { transcriptSegments: 0, notes: 0, tasks: 0, speakers: 0, audioFiles: 0 },
          durationMs: Date.now() - startTime,
          error: 'No audio files found for this meeting'
        }
      }

      this.emitProgress({
        step: 'preparing',
        percent: 10,
        filesProcessed: 0,
        totalFiles: audioFiles.length,
        bytesWritten: 0,
        totalBytes: 0
      })

      // Ensure directory exists
      const dir = path.dirname(outputPath)
      if (!existsSync(dir)) {
        await mkdir(dir, { recursive: true })
      }

      // Create ZIP archive
      const output = createWriteStream(outputPath)
      const archive = archiver('zip', { zlib: { level: 9 } })

      return new Promise((resolve) => {
        let filesProcessed = 0

        output.on('close', async () => {
          const fileSizeBytes = archive.pointer()

          this.emitProgress({
            step: 'complete',
            percent: 100,
            filesProcessed: audioFiles.length,
            totalFiles: audioFiles.length,
            bytesWritten: fileSizeBytes,
            totalBytes: fileSizeBytes
          })

          resolve({
            success: true,
            filePath: outputPath,
            fileSizeBytes,
            format: 'audio',
            exportedContent: {
              transcriptSegments: 0,
              notes: 0,
              tasks: 0,
              speakers: 0,
              audioFiles: audioFiles.length
            },
            durationMs: Date.now() - startTime
          })
        })

        archive.on('error', (err) => {
          this.emitProgress({
            step: 'error',
            percent: 0,
            filesProcessed: 0,
            totalFiles: audioFiles.length,
            bytesWritten: 0,
            totalBytes: 0,
            error: err.message
          })

          resolve({
            success: false,
            format: 'audio',
            exportedContent: { transcriptSegments: 0, notes: 0, tasks: 0, speakers: 0, audioFiles: 0 },
            durationMs: Date.now() - startTime,
            error: err.message
          })
        })

        archive.on('entry', () => {
          filesProcessed++
          this.emitProgress({
            step: 'exporting_audio',
            percent: Math.round(20 + (filesProcessed / audioFiles.length) * 70),
            currentFile: audioFiles[filesProcessed - 1]?.name,
            filesProcessed,
            totalFiles: audioFiles.length,
            bytesWritten: 0,
            totalBytes: 0
          })
        })

        archive.pipe(output)

        // Add metadata file
        const metadata = {
          meetingId: data.meeting.id,
          meetingTitle: data.meeting.title,
          meetingDate: data.meeting.start_time,
          exportDate: new Date().toISOString(),
          audioFiles: audioFiles.map(f => f.name)
        }
        archive.append(JSON.stringify(metadata, null, 2), { name: 'metadata.json' })

        // Add audio files
        for (const file of audioFiles) {
          archive.file(file.path, { name: file.name })
        }

        archive.finalize()
      })
    } catch (error) {
      this.emitProgress({
        step: 'error',
        percent: 0,
        filesProcessed: 0,
        totalFiles: 0,
        bytesWritten: 0,
        totalBytes: 0,
        error: error instanceof Error ? error.message : 'Unknown error'
      })

      return {
        success: false,
        format: 'audio',
        exportedContent: { transcriptSegments: 0, notes: 0, tasks: 0, speakers: 0, audioFiles: 0 },
        durationMs: Date.now() - startTime,
        error: error instanceof Error ? error.message : 'Unknown error'
      }
    }
  }

  /**
   * Export meeting to full backup (JSON + audio files)
   */
  async exportToFullBackup(
    meetingId: string,
    outputPath: string,
    options: ExportOptions
  ): Promise<ExportResult> {
    const startTime = Date.now()

    try {
      const data = fetchMeetingData(meetingId)
      if (!data) {
        return { success: false, format: 'full', exportedContent: { transcriptSegments: 0, notes: 0, tasks: 0, speakers: 0, audioFiles: 0 }, durationMs: 0, error: 'Meeting not found' }
      }

      const contentConfig = getContentConfig(options)

      // Collect audio files
      const audioFiles: { path: string; name: string }[] = []

      for (const recording of data.recordings) {
        if (recording.file_path && existsSync(recording.file_path)) {
          audioFiles.push({
            path: recording.file_path,
            name: `recordings/${path.basename(recording.file_path)}`
          })
        }
      }

      if (data.meeting.audio_file_path && existsSync(data.meeting.audio_file_path)) {
        audioFiles.push({
          path: data.meeting.audio_file_path,
          name: `audio/${path.basename(data.meeting.audio_file_path)}`
        })
      }

      this.emitProgress({
        step: 'preparing',
        percent: 10,
        filesProcessed: 0,
        totalFiles: audioFiles.length + 1,
        bytesWritten: 0,
        totalBytes: 0
      })

      // Filter content based on config
      const exportData: MeetingExportData = {
        ...data,
        exportFormat: 'full',
        transcripts: contentConfig.includeTranscript ? data.transcripts : [],
        notes: data.notes.filter(n => {
          if (n.note_type === 'summary' && !contentConfig.includeSummary) return false
          if (n.note_type === 'key_point' && !contentConfig.includeKeyPoints) return false
          if (n.note_type === 'action_item' && !contentConfig.includeActionItems) return false
          if (n.note_type === 'decision' && !contentConfig.includeDecisions) return false
          if (n.note_type === 'custom' && !contentConfig.includeCustomNotes) return false
          return true
        }),
        tasks: contentConfig.includeActionItems ? data.tasks : [],
        speakers: contentConfig.includeSpeakers ? data.speakers : [],
        speakerNames: contentConfig.includeSpeakers ? data.speakerNames : []
      }

      // Ensure directory exists
      const dir = path.dirname(outputPath)
      if (!existsSync(dir)) {
        await mkdir(dir, { recursive: true })
      }

      // Create ZIP archive
      const output = createWriteStream(outputPath)
      const archive = archiver('zip', { zlib: { level: 6 } })

      return new Promise((resolve) => {
        let filesProcessed = 0

        output.on('close', async () => {
          const fileSizeBytes = archive.pointer()

          this.emitProgress({
            step: 'complete',
            percent: 100,
            filesProcessed: audioFiles.length + 1,
            totalFiles: audioFiles.length + 1,
            bytesWritten: fileSizeBytes,
            totalBytes: fileSizeBytes
          })

          resolve({
            success: true,
            filePath: outputPath,
            fileSizeBytes,
            format: 'full',
            exportedContent: {
              transcriptSegments: exportData.transcripts.length,
              notes: exportData.notes.length,
              tasks: exportData.tasks.length,
              speakers: exportData.speakers.length,
              audioFiles: audioFiles.length
            },
            durationMs: Date.now() - startTime
          })
        })

        archive.on('error', (err) => {
          this.emitProgress({
            step: 'error',
            percent: 0,
            filesProcessed: 0,
            totalFiles: audioFiles.length + 1,
            bytesWritten: 0,
            totalBytes: 0,
            error: err.message
          })

          resolve({
            success: false,
            format: 'full',
            exportedContent: { transcriptSegments: 0, notes: 0, tasks: 0, speakers: 0, audioFiles: 0 },
            durationMs: Date.now() - startTime,
            error: err.message
          })
        })

        archive.on('entry', () => {
          filesProcessed++
          this.emitProgress({
            step: filesProcessed === 1 ? 'exporting_data' : 'exporting_audio',
            percent: Math.round(20 + (filesProcessed / (audioFiles.length + 1)) * 70),
            currentFile: filesProcessed === 1 ? 'meeting_data.json' : audioFiles[filesProcessed - 2]?.name,
            filesProcessed,
            totalFiles: audioFiles.length + 1,
            bytesWritten: 0,
            totalBytes: 0
          })
        })

        archive.pipe(output)

        // Add JSON data file
        archive.append(JSON.stringify(exportData, null, 2), { name: 'meeting_data.json' })

        // Add audio files
        for (const file of audioFiles) {
          archive.file(file.path, { name: file.name })
        }

        archive.finalize()
      })
    } catch (error) {
      this.emitProgress({
        step: 'error',
        percent: 0,
        filesProcessed: 0,
        totalFiles: 0,
        bytesWritten: 0,
        totalBytes: 0,
        error: error instanceof Error ? error.message : 'Unknown error'
      })

      return {
        success: false,
        format: 'full',
        exportedContent: { transcriptSegments: 0, notes: 0, tasks: 0, speakers: 0, audioFiles: 0 },
        durationMs: Date.now() - startTime,
        error: error instanceof Error ? error.message : 'Unknown error'
      }
    }
  }

  /**
   * Export meeting to any supported format
   */
  async exportMeeting(meetingId: string, options: ExportOptions): Promise<ExportResult> {
    const data = fetchMeetingData(meetingId)
    if (!data) {
      return { success: false, format: options.format, exportedContent: { transcriptSegments: 0, notes: 0, tasks: 0, speakers: 0, audioFiles: 0 }, durationMs: 0, error: 'Meeting not found' }
    }

    // Determine output path
    let outputPath = options.outputPath
    if (!outputPath) {
      const timestamp = Date.now()
      const safeTitle = sanitizeFilename(data.meeting.title)
      const defaultDir = app.getPath('documents')

      let extension = '.json'
      let filterName = 'JSON'

      switch (options.format) {
        case 'pdf':
          extension = '.pdf'
          filterName = 'PDF'
          break
        case 'audio':
          extension = '.zip'
          filterName = 'ZIP Archive'
          break
        case 'full':
          extension = '.zip'
          filterName = 'ZIP Archive'
          break
      }

      const result = await dialog.showSaveDialog({
        title: `Export Meeting - ${data.meeting.title}`,
        defaultPath: path.join(defaultDir, `${safeTitle}_${timestamp}${extension}`),
        filters: [{ name: filterName, extensions: [extension.substring(1)] }]
      })

      if (result.canceled || !result.filePath) {
        return { success: false, format: options.format, exportedContent: { transcriptSegments: 0, notes: 0, tasks: 0, speakers: 0, audioFiles: 0 }, durationMs: 0, error: 'Export cancelled' }
      }

      outputPath = result.filePath
    }

    this.emitProgress({
      step: 'preparing',
      percent: 0,
      filesProcessed: 0,
      totalFiles: 0,
      bytesWritten: 0,
      totalBytes: 0
    })

    switch (options.format) {
      case 'json':
        return this.exportToJson(meetingId, outputPath, options)

      case 'pdf':
        // Use existing PDF export service with template config
        const contentConfig = getContentConfig(options)
        const pdfResult = await exportService.exportToPdf(meetingId, outputPath, {
          includeSummary: contentConfig.includeSummary,
          includeActionItems: contentConfig.includeActionItems,
          includeDecisions: contentConfig.includeDecisions,
          includeTranscript: contentConfig.includeTranscript,
          includeKeyPoints: contentConfig.includeKeyPoints,
          includeMetadata: contentConfig.includeMetadata
        })

        const fileSizeBytes = pdfResult.filePath ? await getFileSize(pdfResult.filePath) : 0

        this.emitProgress({
          step: pdfResult.success ? 'complete' : 'error',
          percent: pdfResult.success ? 100 : 0,
          filesProcessed: pdfResult.success ? 1 : 0,
          totalFiles: 1,
          bytesWritten: fileSizeBytes,
          totalBytes: fileSizeBytes,
          error: pdfResult.error
        })

        return {
          success: pdfResult.success,
          filePath: pdfResult.filePath,
          fileSizeBytes,
          format: 'pdf',
          exportedContent: {
            transcriptSegments: contentConfig.includeTranscript ? data.transcripts.length : 0,
            notes: data.notes.length,
            tasks: contentConfig.includeActionItems ? data.tasks.length : 0,
            speakers: 0,
            audioFiles: 0
          },
          durationMs: 0,
          error: pdfResult.error
        }

      case 'audio':
        return this.exportToAudioZip(meetingId, outputPath)

      case 'full':
        return this.exportToFullBackup(meetingId, outputPath, options)

      default:
        return { success: false, format: options.format, exportedContent: { transcriptSegments: 0, notes: 0, tasks: 0, speakers: 0, audioFiles: 0 }, durationMs: 0, error: `Unsupported format: ${options.format}` }
    }
  }

  /**
   * Export multiple meetings to a batch archive
   */
  async exportMeetingsBatch(meetingIds: string[], options: ExportOptions): Promise<BatchExportResult> {
    const results: ExportResult[] = []
    let totalSizeBytes = 0
    const errors: string[] = []

    // If no output path provided, ask for a directory
    let outputDir = options.outputPath
    if (!outputDir) {
      const result = await dialog.showOpenDialog({
        title: 'Select Export Directory',
        properties: ['openDirectory', 'createDirectory']
      })

      if (result.canceled || result.filePaths.length === 0) {
        return {
          success: false,
          totalMeetings: meetingIds.length,
          successfulExports: 0,
          failedExports: meetingIds.length,
          results: [],
          totalSizeBytes: 0,
          errors: ['Export cancelled']
        }
      }

      outputDir = result.filePaths[0]
    }

    for (let i = 0; i < meetingIds.length; i++) {
      const meetingId = meetingIds[i]
      const data = fetchMeetingData(meetingId)

      if (!data) {
        errors.push(`Meeting ${meetingId} not found`)
        results.push({
          success: false,
          format: options.format,
          exportedContent: { transcriptSegments: 0, notes: 0, tasks: 0, speakers: 0, audioFiles: 0 },
          durationMs: 0,
          error: 'Meeting not found'
        })
        continue
      }

      const timestamp = Date.now()
      const safeTitle = sanitizeFilename(data.meeting.title)

      let extension = '.json'
      switch (options.format) {
        case 'pdf': extension = '.pdf'; break
        case 'audio': extension = '.zip'; break
        case 'full': extension = '.zip'; break
      }

      const outputPath = path.join(outputDir, `${safeTitle}_${timestamp}${extension}`)

      const result = await this.exportMeeting(meetingId, {
        ...options,
        outputPath
      })

      results.push(result)

      if (result.success && result.fileSizeBytes) {
        totalSizeBytes += result.fileSizeBytes
      } else if (result.error) {
        errors.push(`${data.meeting.title}: ${result.error}`)
      }
    }

    const successfulExports = results.filter(r => r.success).length
    const failedExports = results.filter(r => !r.success).length

    return {
      success: failedExports === 0,
      totalMeetings: meetingIds.length,
      successfulExports,
      failedExports,
      results,
      outputPath: outputDir,
      totalSizeBytes,
      errors
    }
  }

  /**
   * Export meeting and then delete it
   */
  async exportAndDelete(meetingId: string, options: ExportAndDeleteOptions): Promise<ExportAndDeleteResult> {
    // First export the meeting
    const exportResult = await this.exportMeeting(meetingId, options.export)

    if (!exportResult.success) {
      return {
        exportResult,
        deleted: false,
        success: false
      }
    }

    // If export succeeded and delete is requested
    if (options.deleteAfterExport) {
      const deletionOptions = options.deletion || { taskHandling: 'unlink', softDelete: false }

      const deletionResult = meetingDeletionService.deleteMeeting(meetingId, {
        deleteFiles: true,
        taskHandling: deletionOptions.taskHandling === 'keep' ? 'unlink' : deletionOptions.taskHandling,
        softDelete: deletionOptions.softDelete,
        auditLog: true
      })

      return {
        exportResult,
        deleted: deletionResult.success,
        deletionResult: {
          success: deletionResult.success,
          freedSpaceBytes: deletionResult.freedSpaceBytes,
          error: deletionResult.error
        },
        success: exportResult.success && deletionResult.success
      }
    }

    return {
      exportResult,
      deleted: false,
      success: exportResult.success
    }
  }

  /**
   * One-click archive to disk
   */
  async archiveToDisk(meetingId: string, options: ArchiveToDiskOptions): Promise<ArchiveToDiskResult> {
    const data = fetchMeetingData(meetingId)
    if (!data) {
      return { success: false, meetingDeleted: false, error: 'Meeting not found' }
    }

    // Determine output directory
    let outputDir = options.outputDirectory
    if (!outputDir) {
      outputDir = path.join(app.getPath('documents'), 'Meeting Archives')
    }

    // Create date-based folder structure if requested
    if (options.useDateFolders) {
      const date = new Date(data.meeting.start_time)
      const year = date.getFullYear().toString()
      const month = (date.getMonth() + 1).toString().padStart(2, '0')
      outputDir = path.join(outputDir, year, month)
    }

    // Ensure directory exists
    if (!existsSync(outputDir)) {
      await mkdir(outputDir, { recursive: true })
    }

    // Generate filename
    const timestamp = Date.now()
    const safeTitle = sanitizeFilename(data.meeting.title)
    let extension = options.format === 'pdf' ? '.pdf' : '.zip'
    if (options.format === 'json') extension = '.json'

    const archivePath = path.join(outputDir, `${safeTitle}_${timestamp}${extension}`)

    // Export the meeting
    const exportResult = await this.exportMeeting(meetingId, {
      format: options.format,
      template: options.template,
      outputPath: archivePath,
      includeAudio: options.format === 'full' || options.format === 'audio'
    })

    if (!exportResult.success) {
      return {
        success: false,
        meetingDeleted: false,
        error: exportResult.error
      }
    }

    // Delete if requested
    let meetingDeleted = false
    let freedSpaceBytes = 0

    if (options.deleteAfterArchive) {
      const deletionResult = meetingDeletionService.deleteMeeting(meetingId, {
        deleteFiles: true,
        taskHandling: 'unlink',
        softDelete: false,
        auditLog: true
      })

      meetingDeleted = deletionResult.success
      freedSpaceBytes = deletionResult.freedSpaceBytes
    }

    return {
      success: true,
      archivePath,
      archiveSizeBytes: exportResult.fileSizeBytes,
      meetingDeleted,
      freedSpaceBytes
    }
  }

  /**
   * Validate an import file
   */
  async validateImportFile(filePath: string): Promise<ImportFileInfo> {
    const result: ImportFileInfo = {
      filePath,
      format: 'json',
      isValid: false,
      availableContent: {
        hasMetadata: false,
        hasTranscripts: false,
        hasNotes: false,
        hasTasks: false,
        hasSpeakers: false,
        hasAudio: false
      },
      fileSizeBytes: 0,
      validationErrors: []
    }

    try {
      if (!existsSync(filePath)) {
        result.validationErrors = ['File not found']
        return result
      }

      result.fileSizeBytes = await getFileSize(filePath)

      // Determine format from extension
      const ext = path.extname(filePath).toLowerCase()
      if (ext === '.zip') {
        // Could be audio or full backup
        // For now, we'll try to read it as a full backup
        result.format = 'full'
        // TODO: Implement ZIP validation
        result.validationErrors = ['ZIP import not yet implemented']
        return result
      }

      if (ext !== '.json') {
        result.validationErrors = ['Unsupported file format. Expected .json or .zip']
        return result
      }

      // Read and parse JSON
      const content = await readFile(filePath, 'utf-8')
      const data = JSON.parse(content) as MeetingExportData

      // Validate structure
      if (!data.exportVersion) {
        result.validationErrors?.push('Missing export version')
      }

      if (!data.meeting || !data.meeting.id || !data.meeting.title) {
        result.validationErrors?.push('Missing or invalid meeting data')
        return result
      }

      // Extract meeting info
      result.meetingInfo = {
        id: data.meeting.id,
        title: data.meeting.title,
        date: data.meeting.start_time,
        duration: data.meeting.duration_seconds
      }

      // Check available content
      result.availableContent = {
        hasMetadata: !!data.meeting,
        hasTranscripts: Array.isArray(data.transcripts) && data.transcripts.length > 0,
        hasNotes: Array.isArray(data.notes) && data.notes.length > 0,
        hasTasks: Array.isArray(data.tasks) && data.tasks.length > 0,
        hasSpeakers: Array.isArray(data.speakers) && data.speakers.length > 0,
        hasAudio: false // JSON doesn't include audio
      }

      result.exportDate = data.exportDate
      result.isValid = true

    } catch (error) {
      result.validationErrors = [error instanceof Error ? error.message : 'Unknown error']
    }

    return result
  }

  /**
   * Import a meeting from an export file
   */
  async importMeeting(filePath: string, options: ImportOptions): Promise<ImportResult> {
    const startTime = Date.now()

    try {
      // Validate the file first
      const fileInfo = await this.validateImportFile(filePath)
      if (!fileInfo.isValid) {
        return {
          success: false,
          importedContent: { transcripts: 0, notes: 0, tasks: 0, speakers: 0, audioFiles: 0 },
          hadConflict: false,
          durationMs: Date.now() - startTime,
          error: fileInfo.validationErrors?.join(', ') || 'Invalid file'
        }
      }

      // Read and parse
      const content = await readFile(filePath, 'utf-8')
      const data = JSON.parse(content) as MeetingExportData

      // Check for existing meeting
      const existingMeeting = meetingService.getById(data.meeting.id)
      let hadConflict = !!existingMeeting
      let conflictResolution: 'skipped' | 'replaced' | 'created_new' | undefined
      let meetingId = data.meeting.id

      if (existingMeeting) {
        switch (options.conflictResolution) {
          case 'skip':
            return {
              success: false,
              importedContent: { transcripts: 0, notes: 0, tasks: 0, speakers: 0, audioFiles: 0 },
              hadConflict: true,
              conflictResolution: 'skipped',
              durationMs: Date.now() - startTime,
              error: 'Meeting already exists'
            }

          case 'replace':
            // Delete existing meeting first
            meetingDeletionService.deleteMeeting(data.meeting.id, {
              deleteFiles: true,
              taskHandling: 'delete',
              softDelete: false,
              auditLog: true
            })
            conflictResolution = 'replaced'
            break

          case 'create_new':
            meetingId = randomUUID()
            conflictResolution = 'created_new'
            break
        }
      }

      const importedContent = {
        transcripts: 0,
        notes: 0,
        tasks: 0,
        speakers: 0,
        audioFiles: 0
      }

      // Import meeting
      if (options.importContent.metadata) {
        const meetingData = {
          ...data.meeting,
          id: meetingId,
          title: options.customTitle || data.meeting.title
        }
        meetingService.create(meetingData)
      }

      // Import speakers
      if (options.importContent.speakers && data.speakers) {
        for (const speaker of data.speakers) {
          try {
            // Check if speaker already exists
            const existing = speakerService.getById(speaker.id)
            if (!existing) {
              speakerService.create(speaker)
              importedContent.speakers++
            }
          } catch {
            // Skip if speaker already exists
          }
        }
      }

      // Import transcripts
      if (options.importContent.transcripts && data.transcripts) {
        for (const transcript of data.transcripts) {
          try {
            transcriptService.create({
              ...transcript,
              meeting_id: meetingId
            })
            importedContent.transcripts++
          } catch {
            // Skip duplicates
          }
        }
      }

      // Import notes
      if (options.importContent.notes && data.notes) {
        for (const note of data.notes) {
          try {
            meetingNoteService.create({
              ...note,
              meeting_id: meetingId
            })
            importedContent.notes++
          } catch {
            // Skip duplicates
          }
        }
      }

      // Import tasks
      if (options.importContent.tasks && data.tasks) {
        for (const task of data.tasks) {
          try {
            taskService.create({
              ...task,
              meeting_id: meetingId
            })
            importedContent.tasks++
          } catch {
            // Skip duplicates
          }
        }
      }

      return {
        success: true,
        meetingId,
        importedContent,
        hadConflict,
        conflictResolution,
        durationMs: Date.now() - startTime
      }

    } catch (error) {
      return {
        success: false,
        importedContent: { transcripts: 0, notes: 0, tasks: 0, speakers: 0, audioFiles: 0 },
        hadConflict: false,
        durationMs: Date.now() - startTime,
        error: error instanceof Error ? error.message : 'Unknown error'
      }
    }
  }

  /**
   * Get template configuration
   */
  getTemplateConfig(template: ExportTemplate): ExportContentConfig {
    return TEMPLATE_CONFIGS_INTERNAL[template]
  }

  /**
   * Estimate export size for a meeting
   */
  async estimateExportSize(meetingId: string, options: ExportOptions): Promise<number> {
    const preview = await this.getExportPreview(meetingId, options)
    return preview?.estimatedSizeBytes || 0
  }
}

// ============================================================================
// Singleton Export
// ============================================================================

export const exportDeleteService = new ExportDeleteService()
export default exportDeleteService
