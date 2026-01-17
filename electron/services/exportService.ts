/**
 * Export Service
 *
 * Provides functionality to export meeting notes to PDF and Markdown formats.
 * Includes summary, action items, decisions, and transcript.
 */

import { dialog, BrowserWindow, app } from 'electron'
import { writeFile, mkdir } from 'fs/promises'
import path from 'path'
import { existsSync } from 'fs'
import { meetingService } from './meetingService'
import { transcriptService } from './transcriptService'
import { meetingNoteService } from './meetingNoteService'
import { taskService } from './taskService'
import { speakerService } from './speakerService'
import type { Meeting, Transcript, MeetingNote, Task, Speaker } from '../../src/types/database'

// ============================================================================
// Types
// ============================================================================

/**
 * Export format options
 */
export type ExportFormat = 'pdf' | 'markdown'

/**
 * Configuration for export
 */
export interface ExportConfig {
  /** Include summary section */
  includeSummary?: boolean
  /** Include action items section */
  includeActionItems?: boolean
  /** Include decisions section */
  includeDecisions?: boolean
  /** Include transcript section */
  includeTranscript?: boolean
  /** Include key points section */
  includeKeyPoints?: boolean
  /** Include meeting metadata (date, duration, type) */
  includeMetadata?: boolean
}

/**
 * Result of export operation
 */
export interface ExportResult {
  success: boolean
  filePath?: string
  error?: string
}

/**
 * Meeting data aggregated for export
 */
interface MeetingExportData {
  meeting: Meeting
  transcripts: Transcript[]
  notes: MeetingNote[]
  tasks: Task[]
  speakers: Speaker[]
}

// ============================================================================
// Default Configuration
// ============================================================================

const DEFAULT_CONFIG: ExportConfig = {
  includeSummary: true,
  includeActionItems: true,
  includeDecisions: true,
  includeTranscript: true,
  includeKeyPoints: true,
  includeMetadata: true
}

// ============================================================================
// Helper Functions
// ============================================================================

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
 * Format duration in seconds to readable string
 */
function formatDuration(seconds: number): string {
  const hours = Math.floor(seconds / 3600)
  const minutes = Math.floor((seconds % 3600) / 60)
  const secs = Math.floor(seconds % 60)

  if (hours > 0) {
    return `${hours}h ${minutes}m ${secs}s`
  }
  if (minutes > 0) {
    return `${minutes}m ${secs}s`
  }
  return `${secs}s`
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
function getSpeakerName(speakerId: string | null, speakers: Speaker[]): string {
  if (!speakerId) return 'Unknown Speaker'
  const speaker = speakers.find(s => s.id === speakerId)
  return speaker?.name || speakerId
}

/**
 * Fetch all data needed for export
 */
function fetchMeetingData(meetingId: string): MeetingExportData | null {
  const meeting = meetingService.getById(meetingId)
  if (!meeting) {
    return null
  }

  const transcripts = transcriptService.getByMeetingId(meetingId)
  const notes = meetingNoteService.getByMeetingId(meetingId)
  const tasks = taskService.getByMeetingId(meetingId)
  const speakers = speakerService.getAll()

  return {
    meeting,
    transcripts,
    notes,
    tasks,
    speakers
  }
}

/**
 * Sanitize filename for filesystem
 */
function sanitizeFilename(name: string): string {
  return name
    .replace(/[<>:"/\\|?*]/g, '-')
    .replace(/\s+/g, '_')
    .substring(0, 100)
}

// ============================================================================
// Markdown Generation
// ============================================================================

/**
 * Generate Markdown content for meeting export
 */
function generateMarkdown(data: MeetingExportData, config: ExportConfig): string {
  const { meeting, transcripts, notes, tasks, speakers } = data
  const lines: string[] = []

  // Title
  lines.push(`# ${meeting.title}`)
  lines.push('')

  // Metadata
  if (config.includeMetadata) {
    lines.push('## Meeting Details')
    lines.push('')
    lines.push(`- **Date:** ${formatDate(meeting.start_time)}`)
    if (meeting.duration_seconds) {
      lines.push(`- **Duration:** ${formatDuration(meeting.duration_seconds)}`)
    }
    lines.push(`- **Type:** ${meeting.meeting_type || 'other'}`)
    lines.push(`- **Status:** ${meeting.status}`)
    if (meeting.description) {
      lines.push(`- **Description:** ${meeting.description}`)
    }
    lines.push('')
  }

  // Summary
  const summaryNotes = notes.filter(n => n.note_type === 'summary')
  if (config.includeSummary && summaryNotes.length > 0) {
    lines.push('## Summary')
    lines.push('')
    for (const note of summaryNotes) {
      lines.push(note.content)
      lines.push('')
    }
  }

  // Key Points
  const keyPointNotes = notes.filter(n => n.note_type === 'key_point')
  if (config.includeKeyPoints && keyPointNotes.length > 0) {
    lines.push('## Key Points')
    lines.push('')
    for (const note of keyPointNotes) {
      lines.push(`- ${note.content}`)
    }
    lines.push('')
  }

  // Action Items
  const actionItemNotes = notes.filter(n => n.note_type === 'action_item')
  if (config.includeActionItems && (actionItemNotes.length > 0 || tasks.length > 0)) {
    lines.push('## Action Items')
    lines.push('')

    // From notes
    for (const note of actionItemNotes) {
      lines.push(`- [ ] ${note.content}`)
    }

    // From tasks (that aren't duplicates)
    for (const task of tasks) {
      const checkbox = task.status === 'completed' ? '[x]' : '[ ]'
      let taskLine = `- ${checkbox} ${task.title}`
      if (task.assignee) {
        taskLine += ` (Assigned to: ${task.assignee})`
      }
      if (task.due_date) {
        taskLine += ` - Due: ${formatDate(task.due_date)}`
      }
      if (task.priority !== 'medium') {
        taskLine += ` [${task.priority.toUpperCase()}]`
      }
      lines.push(taskLine)
    }
    lines.push('')
  }

  // Decisions
  const decisionNotes = notes.filter(n => n.note_type === 'decision')
  if (config.includeDecisions && decisionNotes.length > 0) {
    lines.push('## Decisions')
    lines.push('')
    for (const note of decisionNotes) {
      lines.push(`- ${note.content}`)
    }
    lines.push('')
  }

  // Transcript
  if (config.includeTranscript && transcripts.length > 0) {
    lines.push('## Transcript')
    lines.push('')

    // Group consecutive transcripts by speaker
    let currentSpeaker: string | null = null
    let currentContent: string[] = []

    for (const transcript of transcripts) {
      const speakerName = getSpeakerName(transcript.speaker_id, speakers)

      if (transcript.speaker_id !== currentSpeaker) {
        // Output previous speaker's content
        if (currentSpeaker !== null && currentContent.length > 0) {
          const prevSpeakerName = getSpeakerName(currentSpeaker, speakers)
          lines.push(`**${prevSpeakerName}:** ${currentContent.join(' ')}`)
          lines.push('')
        }
        currentSpeaker = transcript.speaker_id
        currentContent = [transcript.content]
      } else {
        currentContent.push(transcript.content)
      }
    }

    // Output last speaker's content
    if (currentSpeaker !== null && currentContent.length > 0) {
      const speakerName = getSpeakerName(currentSpeaker, speakers)
      lines.push(`**${speakerName}:** ${currentContent.join(' ')}`)
      lines.push('')
    }
  }

  // Footer
  lines.push('---')
  lines.push('')
  lines.push(`*Exported from Meeting Notes on ${formatDate(new Date().toISOString())}*`)

  return lines.join('\n')
}

// ============================================================================
// PDF Generation (Text-based approach without external dependencies)
// ============================================================================

/**
 * Generate HTML content for PDF export (to be converted by Electron)
 */
function generatePdfHtml(data: MeetingExportData, config: ExportConfig): string {
  const { meeting, transcripts, notes, tasks, speakers } = data

  const styles = `
    <style>
      @page {
        margin: 1in;
        size: letter;
      }
      body {
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, Cantarell, sans-serif;
        font-size: 11pt;
        line-height: 1.5;
        color: #1a1a1a;
        max-width: 100%;
        margin: 0 auto;
        padding: 20px;
      }
      h1 {
        font-size: 24pt;
        color: #7c3aed;
        margin-bottom: 0.5em;
        border-bottom: 2px solid #7c3aed;
        padding-bottom: 0.3em;
      }
      h2 {
        font-size: 16pt;
        color: #374151;
        margin-top: 1.5em;
        margin-bottom: 0.5em;
        border-bottom: 1px solid #e5e7eb;
        padding-bottom: 0.2em;
      }
      .metadata {
        background-color: #f9fafb;
        padding: 15px;
        border-radius: 8px;
        margin-bottom: 20px;
      }
      .metadata-item {
        margin-bottom: 5px;
      }
      .metadata-label {
        font-weight: 600;
        color: #4b5563;
      }
      .summary-content {
        background-color: #faf5ff;
        padding: 15px;
        border-radius: 8px;
        border-left: 4px solid #7c3aed;
      }
      .key-point, .decision {
        padding: 8px 0;
        border-bottom: 1px solid #f3f4f6;
      }
      .key-point:last-child, .decision:last-child {
        border-bottom: none;
      }
      .action-item {
        padding: 10px;
        margin-bottom: 8px;
        background-color: #f0fdf4;
        border-radius: 6px;
        border-left: 3px solid #22c55e;
      }
      .action-item.completed {
        background-color: #f3f4f6;
        border-left-color: #9ca3af;
        text-decoration: line-through;
        opacity: 0.7;
      }
      .action-item .priority-high, .action-item .priority-urgent {
        color: #dc2626;
        font-weight: 600;
      }
      .action-item .assignee {
        color: #6b7280;
        font-size: 10pt;
      }
      .transcript-section {
        margin-top: 20px;
      }
      .transcript-entry {
        margin-bottom: 15px;
        padding-bottom: 10px;
        border-bottom: 1px solid #f3f4f6;
      }
      .speaker-name {
        font-weight: 600;
        color: #7c3aed;
        margin-bottom: 5px;
      }
      .transcript-content {
        color: #374151;
      }
      .footer {
        margin-top: 40px;
        padding-top: 20px;
        border-top: 1px solid #e5e7eb;
        text-align: center;
        font-size: 9pt;
        color: #9ca3af;
      }
    </style>
  `

  let html = `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="UTF-8">
      <title>${meeting.title}</title>
      ${styles}
    </head>
    <body>
      <h1>${escapeHtml(meeting.title)}</h1>
  `

  // Metadata
  if (config.includeMetadata) {
    html += `
      <div class="metadata">
        <div class="metadata-item"><span class="metadata-label">Date:</span> ${formatDate(meeting.start_time)}</div>
        ${meeting.duration_seconds ? `<div class="metadata-item"><span class="metadata-label">Duration:</span> ${formatDuration(meeting.duration_seconds)}</div>` : ''}
        <div class="metadata-item"><span class="metadata-label">Type:</span> ${meeting.meeting_type || 'other'}</div>
        <div class="metadata-item"><span class="metadata-label">Status:</span> ${meeting.status}</div>
        ${meeting.description ? `<div class="metadata-item"><span class="metadata-label">Description:</span> ${escapeHtml(meeting.description)}</div>` : ''}
      </div>
    `
  }

  // Summary
  const summaryNotes = notes.filter(n => n.note_type === 'summary')
  if (config.includeSummary && summaryNotes.length > 0) {
    html += `<h2>Summary</h2><div class="summary-content">`
    for (const note of summaryNotes) {
      html += `<p>${escapeHtml(note.content).replace(/\n/g, '<br>')}</p>`
    }
    html += `</div>`
  }

  // Key Points
  const keyPointNotes = notes.filter(n => n.note_type === 'key_point')
  if (config.includeKeyPoints && keyPointNotes.length > 0) {
    html += `<h2>Key Points</h2><div>`
    for (const note of keyPointNotes) {
      html += `<div class="key-point">• ${escapeHtml(note.content)}</div>`
    }
    html += `</div>`
  }

  // Action Items
  const actionItemNotes = notes.filter(n => n.note_type === 'action_item')
  if (config.includeActionItems && (actionItemNotes.length > 0 || tasks.length > 0)) {
    html += `<h2>Action Items</h2><div>`

    // From notes
    for (const note of actionItemNotes) {
      html += `<div class="action-item">☐ ${escapeHtml(note.content)}</div>`
    }

    // From tasks
    for (const task of tasks) {
      const completedClass = task.status === 'completed' ? ' completed' : ''
      const checkbox = task.status === 'completed' ? '☑' : '☐'
      let priorityClass = ''
      let priorityText = ''
      if (task.priority === 'high' || task.priority === 'urgent') {
        priorityClass = ` priority-${task.priority}`
        priorityText = ` [${task.priority.toUpperCase()}]`
      }

      html += `<div class="action-item${completedClass}">
        ${checkbox} ${escapeHtml(task.title)}${priorityText ? `<span class="${priorityClass}">${priorityText}</span>` : ''}
        ${task.assignee ? `<div class="assignee">Assigned to: ${escapeHtml(task.assignee)}</div>` : ''}
        ${task.due_date ? `<div class="assignee">Due: ${formatDate(task.due_date)}</div>` : ''}
      </div>`
    }
    html += `</div>`
  }

  // Decisions
  const decisionNotes = notes.filter(n => n.note_type === 'decision')
  if (config.includeDecisions && decisionNotes.length > 0) {
    html += `<h2>Decisions</h2><div>`
    for (const note of decisionNotes) {
      html += `<div class="decision">✓ ${escapeHtml(note.content)}</div>`
    }
    html += `</div>`
  }

  // Transcript
  if (config.includeTranscript && transcripts.length > 0) {
    html += `<h2>Transcript</h2><div class="transcript-section">`

    // Group consecutive transcripts by speaker
    let currentSpeaker: string | null = null
    let currentContent: string[] = []

    for (const transcript of transcripts) {
      if (transcript.speaker_id !== currentSpeaker) {
        // Output previous speaker's content
        if (currentSpeaker !== null && currentContent.length > 0) {
          const prevSpeakerName = getSpeakerName(currentSpeaker, speakers)
          html += `<div class="transcript-entry">
            <div class="speaker-name">${escapeHtml(prevSpeakerName)}</div>
            <div class="transcript-content">${escapeHtml(currentContent.join(' '))}</div>
          </div>`
        }
        currentSpeaker = transcript.speaker_id
        currentContent = [transcript.content]
      } else {
        currentContent.push(transcript.content)
      }
    }

    // Output last speaker's content
    if (currentSpeaker !== null && currentContent.length > 0) {
      const speakerName = getSpeakerName(currentSpeaker, speakers)
      html += `<div class="transcript-entry">
        <div class="speaker-name">${escapeHtml(speakerName)}</div>
        <div class="transcript-content">${escapeHtml(currentContent.join(' '))}</div>
      </div>`
    }

    html += `</div>`
  }

  // Footer
  html += `
      <div class="footer">
        Exported from Meeting Notes on ${formatDate(new Date().toISOString())}
      </div>
    </body>
    </html>
  `

  return html
}

/**
 * Escape HTML special characters
 */
function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;')
}

// ============================================================================
// Export Service Class
// ============================================================================

class ExportService {
  private config: ExportConfig

  constructor(config?: Partial<ExportConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...config }
  }

  /**
   * Export meeting to Markdown format
   */
  async exportToMarkdown(
    meetingId: string,
    outputPath?: string,
    config?: Partial<ExportConfig>
  ): Promise<ExportResult> {
    try {
      const mergedConfig = { ...this.config, ...config }

      // Fetch meeting data
      const data = fetchMeetingData(meetingId)
      if (!data) {
        return { success: false, error: 'Meeting not found' }
      }

      // Generate Markdown content
      const markdownContent = generateMarkdown(data, mergedConfig)

      // Determine output path
      let filePath = outputPath
      if (!filePath) {
        const filename = `${sanitizeFilename(data.meeting.title)}_${Date.now()}.md`
        const defaultDir = app.getPath('documents')

        const result = await dialog.showSaveDialog({
          title: 'Export Meeting Notes',
          defaultPath: path.join(defaultDir, filename),
          filters: [
            { name: 'Markdown', extensions: ['md'] }
          ]
        })

        if (result.canceled || !result.filePath) {
          return { success: false, error: 'Export cancelled' }
        }

        filePath = result.filePath
      }

      // Ensure directory exists
      const dir = path.dirname(filePath)
      if (!existsSync(dir)) {
        await mkdir(dir, { recursive: true })
      }

      // Write file
      await writeFile(filePath, markdownContent, 'utf-8')

      return { success: true, filePath }
    } catch (error) {
      console.error('[ExportService] Markdown export error:', error)
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error during export'
      }
    }
  }

  /**
   * Export meeting to PDF format
   */
  async exportToPdf(
    meetingId: string,
    outputPath?: string,
    config?: Partial<ExportConfig>
  ): Promise<ExportResult> {
    try {
      const mergedConfig = { ...this.config, ...config }

      // Fetch meeting data
      const data = fetchMeetingData(meetingId)
      if (!data) {
        return { success: false, error: 'Meeting not found' }
      }

      // Generate HTML content
      const htmlContent = generatePdfHtml(data, mergedConfig)

      // Determine output path
      let filePath = outputPath
      if (!filePath) {
        const filename = `${sanitizeFilename(data.meeting.title)}_${Date.now()}.pdf`
        const defaultDir = app.getPath('documents')

        const result = await dialog.showSaveDialog({
          title: 'Export Meeting Notes as PDF',
          defaultPath: path.join(defaultDir, filename),
          filters: [
            { name: 'PDF', extensions: ['pdf'] }
          ]
        })

        if (result.canceled || !result.filePath) {
          return { success: false, error: 'Export cancelled' }
        }

        filePath = result.filePath
      }

      // Ensure directory exists
      const dir = path.dirname(filePath)
      if (!existsSync(dir)) {
        await mkdir(dir, { recursive: true })
      }

      // Create a hidden window for PDF generation
      const pdfWindow = new BrowserWindow({
        show: false,
        width: 816,  // 8.5 inches at 96 DPI
        height: 1056, // 11 inches at 96 DPI
        webPreferences: {
          nodeIntegration: false,
          contextIsolation: true
        }
      })

      try {
        // Load HTML content
        await pdfWindow.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(htmlContent)}`)

        // Wait for content to render
        await new Promise(resolve => setTimeout(resolve, 500))

        // Generate PDF
        const pdfData = await pdfWindow.webContents.printToPDF({
          printBackground: true,
          pageSize: 'Letter',
          margins: {
            top: 0.5,
            bottom: 0.5,
            left: 0.5,
            right: 0.5
          }
        })

        // Write PDF file
        await writeFile(filePath, pdfData)

        return { success: true, filePath }
      } finally {
        // Clean up the window
        pdfWindow.destroy()
      }
    } catch (error) {
      console.error('[ExportService] PDF export error:', error)
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error during export'
      }
    }
  }

  /**
   * Export meeting to specified format
   */
  async export(
    meetingId: string,
    format: ExportFormat,
    outputPath?: string,
    config?: Partial<ExportConfig>
  ): Promise<ExportResult> {
    switch (format) {
      case 'pdf':
        return this.exportToPdf(meetingId, outputPath, config)
      case 'markdown':
        return this.exportToMarkdown(meetingId, outputPath, config)
      default:
        return { success: false, error: `Unsupported export format: ${format}` }
    }
  }

  /**
   * Update service configuration
   */
  updateConfig(config: Partial<ExportConfig>): void {
    this.config = { ...this.config, ...config }
  }

  /**
   * Get current configuration
   */
  getConfig(): ExportConfig {
    return { ...this.config }
  }
}

// ============================================================================
// Singleton Export
// ============================================================================

export const exportService = new ExportService()

/**
 * Reset export service configuration to defaults
 */
export function resetExportConfig(): void {
  exportService.updateConfig(DEFAULT_CONFIG)
}

export default exportService
