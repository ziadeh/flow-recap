/**
 * Post-Recording Processor Service
 *
 * Automatically processes recordings after they're saved to add:
 * - Speaker diarization
 * - Transcription (if not already done via live transcription)
 * - Combines transcription with speaker labels
 * - Automatic action items extraction (creates tasks linked to the meeting)
 */

import { batchDiarizationService, BatchDiarizationOptions } from './batchDiarizationService'
import { mlPipelineService, TranscriptionConfig } from './mlPipeline'
import { transcriptService } from './transcriptService'
import { getDatabaseService } from './database'
import { actionItemsService, ActionItemsExtractionResult } from './actionItemsService'
import { meetingSummaryService } from './meetingSummaryService'
import { settingsService } from './settingsService'
import type { Meeting, Task, MeetingNote } from '../../src/types/database'

export interface PostRecordingOptions {
  /** Whether to run diarization (default: true) */
  runDiarization?: boolean
  /** Whether to run transcription if no live transcription exists (default: true) */
  runTranscription?: boolean
  /** Whether to auto-extract action items after processing (default: uses setting) */
  autoExtractActionItems?: boolean
  /** Whether to auto-generate meeting summary after processing (default: uses setting) */
  autoGenerateSummary?: boolean
  /** Transcription config */
  transcriptionConfig?: TranscriptionConfig
  /** Diarization config */
  diarizationOptions?: BatchDiarizationOptions
}

export interface PostRecordingResult {
  success: boolean
  meetingId: string
  diarizationCompleted: boolean
  transcriptionCompleted: boolean
  actionItemsExtracted: boolean
  summaryGenerated: boolean
  speakersDetected?: number
  transcriptsCreated?: number
  tasksCreated?: Task[]
  actionItemsCount?: number
  summaryNotesCreated?: MeetingNote[]
  error?: string
}

/**
 * Process a recording after it has been saved
 * This function automatically runs diarization, transcription, and action items extraction as needed
 */
export async function processRecording(
  meetingId: string,
  audioFilePath: string,
  options: PostRecordingOptions = {}
): Promise<PostRecordingResult> {
  // Get settings from settings service (defaults to true)
  const autoExtractFromSettings = settingsService.getOrDefault<boolean>('ai.autoExtractActionItems', true)
  const autoGenerateSummaryFromSettings = settingsService.getOrDefault<boolean>('ai.autoGenerateSummary', true)

  const {
    runDiarization = true,
    runTranscription = true,
    autoExtractActionItems = autoExtractFromSettings,
    autoGenerateSummary = autoGenerateSummaryFromSettings,
    transcriptionConfig = {},
    diarizationOptions = {}
  } = options

  const result: PostRecordingResult = {
    success: false,
    meetingId,
    diarizationCompleted: false,
    transcriptionCompleted: false,
    actionItemsExtracted: false,
    summaryGenerated: false
  }

  try {
    console.log(`[PostRecordingProcessor] Processing recording for meeting ${meetingId}`)
    console.log(`[PostRecordingProcessor] Audio file: ${audioFilePath}`)

    // Check if the meeting has existing transcripts
    const db = getDatabaseService().getDatabase()
    const existingTranscripts = db
      .prepare('SELECT COUNT(*) as count FROM transcripts WHERE meeting_id = ?')
      .get(meetingId) as { count: number }

    const hasTranscripts = existingTranscripts.count > 0

    // Step 1: Run transcription if needed and no live transcription exists
    if (runTranscription && !hasTranscripts) {
      console.log('[PostRecordingProcessor] No existing transcripts, running transcription...')
      try {
        const transcriptionResult = await mlPipelineService.transcribe(
          audioFilePath,
          transcriptionConfig
        )

        if (transcriptionResult.success && transcriptionResult.segments.length > 0) {
          // Save transcription segments to database
          for (const segment of transcriptionResult.segments) {
            await transcriptService.create({
              meeting_id: meetingId,
              content: segment.text,
              start_time_ms: Math.round(segment.start * 1000),
              end_time_ms: Math.round(segment.end * 1000),
              confidence: segment.confidence ?? 1.0,
              is_final: true,
              speaker_id: null // Will be filled by diarization
            }, { requireSpeaker: false }) // Allow null speaker_id for now
          }
          result.transcriptionCompleted = true
          result.transcriptsCreated = transcriptionResult.segments.length
          console.log(`[PostRecordingProcessor] Created ${transcriptionResult.segments.length} transcript segments`)
        }
      } catch (error) {
        console.error('[PostRecordingProcessor] Transcription failed:', error)
        // Continue to diarization even if transcription fails
      }
    } else if (hasTranscripts) {
      console.log(`[PostRecordingProcessor] Found ${existingTranscripts.count} existing transcripts (from live transcription)`)
      result.transcriptionCompleted = true
      result.transcriptsCreated = existingTranscripts.count
    }

    // Step 2: Run diarization to add speaker labels
    if (runDiarization) {
      console.log('[PostRecordingProcessor] Running speaker diarization...')
      try {
        const diarizationResult = await batchDiarizationService.processMeeting(
          meetingId,
          diarizationOptions
        )

        if (diarizationResult.success) {
          result.diarizationCompleted = true
          result.speakersDetected = diarizationResult.speakersDetected
          console.log(`[PostRecordingProcessor] Diarization complete: ${diarizationResult.speakersDetected} speakers, ${diarizationResult.transcriptsUpdated} transcripts updated`)
        } else {
          console.error('[PostRecordingProcessor] Diarization failed:', diarizationResult.error)
          result.error = diarizationResult.error
        }
      } catch (error) {
        console.error('[PostRecordingProcessor] Diarization error:', error)
        result.error = error instanceof Error ? error.message : String(error)
      }
    }

    // Step 3: Automatically extract action items and create tasks (if enabled)
    // This runs after diarization/transcription is complete and creates tasks linked to the meeting
    if (autoExtractActionItems && (result.transcriptionCompleted || result.diarizationCompleted)) {
      console.log('[PostRecordingProcessor] Auto-extracting action items from meeting...')
      try {
        // Check if LLM is available
        const availability = await actionItemsService.checkAvailability()

        if (availability.available) {
          console.log(`[PostRecordingProcessor] LLM available (${availability.modelInfo}), extracting action items...`)

          const extractionResult = await actionItemsService.extractActionItems(meetingId, {
            createTasks: true,
            createNotes: true
          })

          if (extractionResult.success) {
            result.actionItemsExtracted = true
            result.tasksCreated = extractionResult.createdTasks
            result.actionItemsCount = extractionResult.extractedItems?.length || 0

            console.log(`[PostRecordingProcessor] Action items extraction complete:`, {
              actionItemsCount: result.actionItemsCount,
              tasksCreated: extractionResult.createdTasks?.length || 0,
              notesCreated: extractionResult.createdNotes?.length || 0,
              processingTimeMs: extractionResult.metadata.processingTimeMs
            })

            // Log created tasks for debugging
            if (extractionResult.createdTasks && extractionResult.createdTasks.length > 0) {
              console.log('[PostRecordingProcessor] Created tasks:')
              extractionResult.createdTasks.forEach((task, index) => {
                console.log(`  ${index + 1}. [${task.priority}] ${task.title}${task.assignee ? ` (Assigned to: ${task.assignee})` : ''}${task.due_date ? ` (Due: ${task.due_date})` : ''}`)
              })
            }
          } else {
            console.warn('[PostRecordingProcessor] Action items extraction failed:', extractionResult.error)
            // Don't set result.error - action items extraction failure is not critical
          }
        } else {
          console.log('[PostRecordingProcessor] LLM not available for action items extraction:', availability.error)
        }
      } catch (error) {
        console.error('[PostRecordingProcessor] Action items extraction error:', error)
        // Don't set result.error - action items extraction failure is not critical
      }
    } else if (!autoExtractActionItems) {
      console.log('[PostRecordingProcessor] Auto-extract action items is disabled')
    }

    // Step 4: Automatically generate meeting summary (if enabled)
    // This runs after diarization/transcription is complete and creates a summary for the Overview tab
    if (autoGenerateSummary && (result.transcriptionCompleted || result.diarizationCompleted)) {
      console.log('[PostRecordingProcessor] Auto-generating meeting summary...')
      try {
        // Check if LLM is available
        const availability = await meetingSummaryService.checkAvailability()

        if (availability.available) {
          console.log(`[PostRecordingProcessor] LLM available (${availability.modelInfo}), generating meeting summary...`)

          const summaryResult = await meetingSummaryService.generateSummary(meetingId)

          if (summaryResult.success) {
            result.summaryGenerated = true
            result.summaryNotesCreated = summaryResult.createdNotes

            console.log(`[PostRecordingProcessor] Meeting summary generation complete:`, {
              summaryNotesCreated: summaryResult.createdNotes?.length || 0,
              processingTimeMs: summaryResult.metadata.processingTimeMs,
              keyPointsCount: summaryResult.summary?.keyPoints?.length || 0,
              decisionsCount: summaryResult.summary?.decisions?.length || 0
            })
          } else {
            console.warn('[PostRecordingProcessor] Meeting summary generation failed:', summaryResult.error)
            // Don't set result.error - summary generation failure is not critical
          }
        } else {
          console.log('[PostRecordingProcessor] LLM not available for meeting summary generation:', availability.error)
        }
      } catch (error) {
        console.error('[PostRecordingProcessor] Meeting summary generation error:', error)
        // Don't set result.error - summary generation failure is not critical
      }
    } else if (!autoGenerateSummary) {
      console.log('[PostRecordingProcessor] Auto-generate meeting summary is disabled')
    }

    result.success = result.diarizationCompleted || result.transcriptionCompleted

    return result
  } catch (error) {
    console.error('[PostRecordingProcessor] Processing failed:', error)
    result.error = error instanceof Error ? error.message : String(error)
    return result
  }
}

export const postRecordingProcessor = {
  processRecording
}
