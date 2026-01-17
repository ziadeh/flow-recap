/**
 * Batch Diarization Service
 *
 * Retroactively processes existing meeting audio files to add speaker
 * labels to transcripts. Uses the existing speakerDiarizationService
 * to perform diarization and aligns results with transcript segments.
 */

import * as fs from 'fs'
import { speakerDiarizationService, DiarizationConfig, DiarizationSegment } from './speakerDiarizationService'
import { speakerService } from './speakerService'
import { getDatabaseService } from './database'
import { llmPostProcessingService } from './llmPostProcessingService'
import { DiarizationOutput, MandatoryDiarizationSegment } from './diarizationOutputSchema'
import { validateWavFile, fixWavFileHeader, WavFileInfo } from './wavUtils'
import type { Meeting, Transcript } from '../../src/types/database'

// Note: WAV file validation functions are now in wavUtils.ts and imported above

// ============================================================================
// Types
// ============================================================================

export interface BatchDiarizationProgress {
  phase: string
  progress: number
  message: string
}

export interface BatchDiarizationResult {
  success: boolean
  speakersDetected: number
  transcriptsUpdated: number
  error?: string
}

export interface BatchDiarizationOptions {
  /**
   * Diarization threshold (0.3-0.9) - lower values = more sensitive speaker separation
   * Default: 0.35 (FIXED from 0.4 to detect more speakers)
   */
  diarizationThreshold?: number
  /** Minimum number of speakers to detect (default: 2 for multi-speaker scenarios) */
  minSpeakers?: number
  /** Maximum number of speakers to detect */
  maxSpeakers?: number
  /** Progress callback */
  onProgress?: (progress: BatchDiarizationProgress) => void
}

// ============================================================================
// Batch Diarization Service
// ============================================================================

export const batchDiarizationService = {
  /**
   * Process a single meeting to add speaker labels to its transcripts
   *
   * @param meetingId - ID of the meeting to process
   * @param options - Diarization options and progress callback
   * @returns Result with speaker count and transcripts updated
   */
  async processMeeting(
    meetingId: string,
    options: BatchDiarizationOptions = {}
  ): Promise<BatchDiarizationResult> {
    // FIXED: Lower threshold = more speakers detected (more sensitive to voice differences)
    // Changed from 0.4 to 0.35 to increase sensitivity and detect more distinct speakers
    // This helps identify speakers with similar-sounding voices that were previously merged
    // minSpeakers defaults to 2 to ensure multi-speaker detection in typical meeting scenarios
    const { diarizationThreshold = 0.35, minSpeakers = 2, maxSpeakers = 10, onProgress } = options

    const emitProgress = (phase: string, progress: number, message: string) => {
      onProgress?.({ phase, progress, message })
    }

    try {
      emitProgress('Loading meeting data', 0, 'Retrieving meeting information...')

      // Get meeting from database
      const db = getDatabaseService().getDatabase()
      const meeting = db
        .prepare('SELECT * FROM meetings WHERE id = ?')
        .get(meetingId) as Meeting | undefined

      if (!meeting) {
        return {
          success: false,
          speakersDetected: 0,
          transcriptsUpdated: 0,
          error: 'Meeting not found'
        }
      }

      // Check if audio file exists
      if (!meeting.audio_file_path) {
        return {
          success: false,
          speakersDetected: 0,
          transcriptsUpdated: 0,
          error: 'Meeting has no audio file'
        }
      }

      if (!fs.existsSync(meeting.audio_file_path)) {
        return {
          success: false,
          speakersDetected: 0,
          transcriptsUpdated: 0,
          error: `Audio file not found: ${meeting.audio_file_path}`
        }
      }

      // Validate and fix WAV file header if needed
      // This fixes a bug where the WAV header may contain outdated data size,
      // causing diarization to only process partial audio (e.g., first 30 seconds)
      emitProgress('Validating audio file', 5, 'Checking audio file integrity...')

      const wavInfo = validateWavFile(meeting.audio_file_path)
      if (!wavInfo.valid) {
        return {
          success: false,
          speakersDetected: 0,
          transcriptsUpdated: 0,
          error: `Invalid audio file: ${wavInfo.error}`
        }
      }

      // If there's a header mismatch, fix it before diarization
      if (wavInfo.needsHeaderFix) {
        console.log(`[BatchDiarization] WAV header issue detected: ${wavInfo.error || 'header/file size mismatch'}`)
        console.log(`[BatchDiarization] Attempting to fix WAV header...`)

        const fixed = fixWavFileHeader(meeting.audio_file_path)
        if (fixed) {
          console.log(`[BatchDiarization] WAV header fixed successfully. Audio duration: ${wavInfo.durationSeconds.toFixed(2)}s`)
          emitProgress('Validating audio file', 8, `Audio file fixed. Duration: ${wavInfo.durationSeconds.toFixed(1)}s`)
        } else {
          console.warn(`[BatchDiarization] Could not fix WAV header. Proceeding anyway...`)
        }
      } else {
        console.log(`[BatchDiarization] Audio file validated: ${wavInfo.durationSeconds.toFixed(2)}s, ${wavInfo.sampleRate}Hz, ${wavInfo.channels}ch`)
      }

      emitProgress('Loading transcripts', 10, 'Retrieving transcript segments...')

      // Get all transcripts for this meeting
      const transcripts = db
        .prepare('SELECT * FROM transcripts WHERE meeting_id = ? ORDER BY start_time_ms ASC')
        .all(meetingId) as Transcript[]

      if (transcripts.length === 0) {
        return {
          success: false,
          speakersDetected: 0,
          transcriptsUpdated: 0,
          error: 'No transcripts found for this meeting'
        }
      }

      emitProgress('Running speaker diarization', 20, 'Analyzing audio for speaker segments...')

      // Run diarization on the audio file
      // Important: minSpeakers ensures the algorithm looks for at least 2 speakers
      // This prevents single-speaker detection when multiple speakers have similar voices
      const diarizationConfig: DiarizationConfig = {
        minSpeakers,
        maxSpeakers,
        similarityThreshold: diarizationThreshold,
        clusteringMethod: 'agglomerative',
        device: 'auto',
        preprocess: true,
        detectOverlaps: true
      }

      const diarizationResult = await speakerDiarizationService.diarize(
        meeting.audio_file_path,
        diarizationConfig,
        (progress) => {
          // Map diarization progress to overall progress (20-70%)
          const overallProgress = 20 + (progress.progress * 0.5)
          emitProgress(progress.phase, overallProgress, progress.message)
        }
      )

      if (!diarizationResult.success) {
        return {
          success: false,
          speakersDetected: 0,
          transcriptsUpdated: 0,
          error: diarizationResult.error || 'Diarization failed'
        }
      }

      // ========================================
      // LLM Post-Processing (Optional Enhancement)
      // ========================================
      emitProgress('Processing with LLM', 68, 'Enhancing speaker consistency with LLM...')
      
      try {
        console.log('[BatchDiarization] Checking LLM availability...')
        const llmAvailability = await llmPostProcessingService.checkAvailability()

        if (llmAvailability.available) {
          console.log(`[BatchDiarization] LLM available (${llmAvailability.modelInfo}), processing...`)
          
          // Convert diarization segments to mandatory schema
          const mandatorySegments: MandatoryDiarizationSegment[] = diarizationResult.segments.map(seg => ({
            speaker_id: seg.speaker,
            start_time: seg.start,
            end_time: seg.end,
            confidence: 0.8 // Default confidence
          }))
          
          // Build DiarizationOutput structure
          const diarizationOutput: DiarizationOutput = {
            success: true,
            segments: mandatorySegments,
            speaker_ids: diarizationResult.speakers,
            num_speakers: diarizationResult.numSpeakers,
            audio_duration: Math.max(...mandatorySegments.map(s => s.end_time), 0),
            processing_time: 0,
            schema_version: '1.0.0'
          }
          
          // Prepare transcript segments for LLM summary generation
          const transcriptSegments = transcripts.map(t => ({
            speaker_id: 'UNKNOWN', // Will be filled later
            text: t.content,
            start_time: t.start_time_ms / 1000,
            end_time: t.end_time_ms / 1000
          }))
          
          // Call LLM post-processing
          const llmResult = await llmPostProcessingService.processOutput(diarizationOutput, {
            resolveOverlaps: true,
            resolveLowConfidence: true,
            generateDisplayOrder: true,
            generateSummary: true,
            transcriptSegments
          })
          
          if (llmResult.success) {
            console.log('[BatchDiarization] LLM post-processing complete:', {
              speakerMappings: llmResult.speakerMappings.length,
              overlapResolutions: llmResult.overlapResolutions.length,
              lowConfidenceResolutions: llmResult.lowConfidenceResolutions.length,
              summaryItems: llmResult.summaryItems?.length || 0,
              llmRequests: llmResult.metadata.llmRequestCount,
              processingTime: llmResult.metadata.processingTimeMs
            })
            
            // Log display order recommendation
            if (llmResult.displayOrder) {
              console.log('[BatchDiarization] Recommended speaker order:', 
                llmResult.displayOrder.order,
                'Reasoning:', llmResult.displayOrder.reasoning)
            }
            
            // Log summary items
            if (llmResult.summaryItems && llmResult.summaryItems.length > 0) {
              console.log(`[BatchDiarization] Generated ${llmResult.summaryItems.length} summary items`)
              llmResult.summaryItems.slice(0, 3).forEach(item => {
                console.log(`  - [${item.type}] ${item.content.substring(0, 80)}...`)
              })
            }
          } else {
            console.warn('[BatchDiarization] LLM post-processing failed:', llmResult.error)
          }
        } else {
          console.log('[BatchDiarization] LLM not available, skipping:', llmAvailability.error)
        }
      } catch (llmError) {
        // Non-blocking: continue with raw diarization
        console.warn('[BatchDiarization] LLM processing error (non-blocking):', 
          llmError instanceof Error ? llmError.message : String(llmError))
      }

      emitProgress('Mapping speakers to transcripts', 70, 'Assigning speakers to transcript segments...')

      // Merge similar speakers to reduce over-segmentation
      const mergedSegments = this.mergeSimilarSpeakers(
        diarizationResult.segments,
        diarizationResult.speakers
      )

      console.log(`[BatchDiarization] Speaker merging: ${diarizationResult.numSpeakers} → ${mergedSegments.speakers.length} speakers`)

      // Align diarization segments with transcripts
      const alignedTranscripts = this.alignSpeakersToTranscripts(
        transcripts,
        mergedSegments.segments
      )

      emitProgress('Creating speaker records', 80, 'Registering detected speakers...')

      // Create or get speaker records for each detected speaker
      const speakerMappings = this.createSpeakerRecords(
        mergedSegments.speakers,
        meetingId
      )

      emitProgress('Updating database', 85, 'Saving speaker assignments...')

      // Update transcripts in database with speaker IDs
      const transcriptsUpdated = this.updateTranscriptsWithSpeakers(
        alignedTranscripts,
        speakerMappings
      )

      emitProgress('Complete', 100, `Identified ${mergedSegments.speakers.length} speakers in ${transcriptsUpdated} segments`)

      return {
        success: true,
        speakersDetected: mergedSegments.speakers.length,
        transcriptsUpdated
      }

    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error)
      console.error('[BatchDiarization] Error processing meeting:', errorMsg)
      return {
        success: false,
        speakersDetected: 0,
        transcriptsUpdated: 0,
        error: errorMsg
      }
    }
  },

  /**
   * Align speaker segments to transcript segments
   * Uses the speakerDiarizationService's findBestSpeaker method
   */
  alignSpeakersToTranscripts(
    transcripts: Transcript[],
    diarizationSegments: DiarizationSegment[]
  ): Array<Transcript & { assignedSpeaker?: string; speakerConfidence?: number }> {
    // Debug: Log diarization segments summary
    const uniqueSpeakersInSegments = [...new Set(diarizationSegments.map(s => s.speaker))]
    console.log(`[BatchDiarization] Aligning ${transcripts.length} transcripts with ${diarizationSegments.length} diarization segments`)
    console.log(`[BatchDiarization] Unique speakers in segments: ${uniqueSpeakersInSegments.join(', ')}`)

    // Debug: Show diarization segment time ranges per speaker
    const speakerTimeRanges: Record<string, { start: number; end: number }[]> = {}
    diarizationSegments.forEach(seg => {
      if (!speakerTimeRanges[seg.speaker]) {
        speakerTimeRanges[seg.speaker] = []
      }
      speakerTimeRanges[seg.speaker].push({ start: seg.start, end: seg.end })
    })

    for (const [speaker, ranges] of Object.entries(speakerTimeRanges)) {
      const totalDuration = ranges.reduce((sum, r) => sum + (r.end - r.start), 0)
      console.log(`[BatchDiarization] ${speaker}: ${ranges.length} segments, ${totalDuration.toFixed(1)}s total`)
    }

    const speakerAssignments: Record<string, number> = {}

    const result = transcripts.map(transcript => {
      // Convert milliseconds to seconds for diarization matching
      const startSeconds = transcript.start_time_ms / 1000
      const endSeconds = transcript.end_time_ms / 1000

      // Find best matching speaker
      const speakerMatch = speakerDiarizationService.findBestSpeaker(
        diarizationSegments,
        startSeconds,
        endSeconds
      )

      // Track assignment counts
      const speaker = speakerMatch?.speaker || 'UNASSIGNED'
      speakerAssignments[speaker] = (speakerAssignments[speaker] || 0) + 1

      return {
        ...transcript,
        assignedSpeaker: speakerMatch?.speaker,
        speakerConfidence: speakerMatch?.confidence
      }
    })

    // Debug: Log assignment summary
    console.log(`[BatchDiarization] Speaker assignment summary:`, speakerAssignments)

    // Debug: Check for potential issues
    const assignedSpeakerCount = Object.keys(speakerAssignments).filter(k => k !== 'UNASSIGNED').length
    if (assignedSpeakerCount < uniqueSpeakersInSegments.length) {
      console.warn(`[BatchDiarization] WARNING: Only ${assignedSpeakerCount} speakers assigned to transcripts, but ${uniqueSpeakersInSegments.length} speakers in diarization segments!`)
      console.warn(`[BatchDiarization] This may indicate a time alignment issue between transcripts and diarization segments.`)

      // Log first few transcripts and their time ranges for debugging
      transcripts.slice(0, 5).forEach((t, i) => {
        console.log(`[BatchDiarization] Transcript ${i}: ${t.start_time_ms/1000}s - ${t.end_time_ms/1000}s`)
      })

      // Log first few diarization segments per speaker
      for (const [speaker, ranges] of Object.entries(speakerTimeRanges)) {
        const firstFew = ranges.slice(0, 3)
        console.log(`[BatchDiarization] ${speaker} first segments: ${firstFew.map(r => `${r.start.toFixed(1)}s-${r.end.toFixed(1)}s`).join(', ')}`)
      }
    }

    return result
  },

  /**
   * Create speaker records for detected speaker labels
   * Returns a map from speaker label to speaker ID
   */
  createSpeakerRecords(
    speakerLabels: string[],
    meetingId: string
  ): Map<string, string> {
    const speakerMap = new Map<string, string>()

    // Re-index speakers sequentially starting from 1 for display
    // This ensures consistent numbering regardless of internal pyannote cluster indices
    let displayIndex = 1

    for (const label of speakerLabels) {
      // Format label for display: normalize all speaker formats to "Speaker N"
      // Handles: "Speaker_0", "SPEAKER_0", "SPEAKER_02", "Speaker 1"
      const underscoreMatch = label.match(/speaker[_](\d+)/i)
      const spaceMatch = label.match(/speaker\s+(\d+)/i)

      let displayName: string
      if (underscoreMatch || spaceMatch) {
        // Re-index sequentially for consistent display (1, 2, 3, ...)
        displayName = `Speaker ${displayIndex}`
        displayIndex++
      } else {
        // Non-standard format, use as-is
        displayName = label
      }

      // Use speakerService to get or create speaker
      const speaker = speakerService.getOrCreate(displayName)
      speakerMap.set(label, speaker.id)

      console.log(`[BatchDiarization] Speaker registered: ${label} -> ${displayName} (ID: ${speaker.id})`)
    }

    return speakerMap
  },

  /**
   * Update transcript records in database with speaker IDs
   */
  updateTranscriptsWithSpeakers(
    alignedTranscripts: Array<Transcript & { assignedSpeaker?: string; speakerConfidence?: number }>,
    speakerMappings: Map<string, string>
  ): number {
    const db = getDatabaseService().getDatabase()
    let updatedCount = 0

    const updateStmt = db.prepare(`
      UPDATE transcripts
      SET speaker_id = ?
      WHERE id = ?
    `)

    // Use transaction for better performance
    const updateAll = db.transaction((transcripts: typeof alignedTranscripts) => {
      for (const transcript of transcripts) {
        if (transcript.assignedSpeaker) {
          const speakerId = speakerMappings.get(transcript.assignedSpeaker)
          if (speakerId) {
            updateStmt.run(speakerId, transcript.id)
            updatedCount++
          }
        }
      }
    })

    updateAll(alignedTranscripts)

    console.log(`[BatchDiarization] Updated ${updatedCount} transcripts with speaker IDs`)

    return updatedCount
  },

  /**
   * Merge speakers that are very similar to reduce over-segmentation
   * This helps fix cases where one speaker is split into multiple speaker IDs
   *
   * IMPORTANT: Only merge speakers who frequently appear very close together
   * (within 1 second) which suggests they are the same person incorrectly split.
   * Do NOT merge speakers who never co-occur - they are likely different people
   * taking turns speaking!
   *
   * FIXED: Increased thresholds to prevent over-merging of distinct speakers
   */
  mergeSimilarSpeakers(
    segments: DiarizationSegment[],
    speakers: string[]
  ): { segments: DiarizationSegment[]; speakers: string[] } {
    if (speakers.length <= 2) {
      // Don't merge if we only have 1-2 speakers
      console.log(`[BatchDiarization] Skipping merge - only ${speakers.length} speakers detected`)
      return { segments, speakers }
    }

    // Build speaker adjacency matrix - count how often speakers appear IMMEDIATELY
    // after each other (within 1.0 seconds), which suggests incorrect splitting
    const adjacency: Record<string, Record<string, number>> = {}
    const speakerSegmentCount: Record<string, number> = {}
    const speakerTotalDuration: Record<string, number> = {}

    speakers.forEach(s1 => {
      adjacency[s1] = {}
      speakerSegmentCount[s1] = 0
      speakerTotalDuration[s1] = 0
      speakers.forEach(s2 => {
        adjacency[s1][s2] = 0
      })
    })

    // Sort segments by start time
    const sortedSegments = [...segments].sort((a, b) => a.start - b.start)

    // Count segment count and total duration per speaker
    sortedSegments.forEach(seg => {
      speakerSegmentCount[seg.speaker] = (speakerSegmentCount[seg.speaker] || 0) + 1
      speakerTotalDuration[seg.speaker] = (speakerTotalDuration[seg.speaker] || 0) + seg.duration
    })

    // Count immediate adjacencies (speaker changes within 1.0 seconds)
    // High adjacency with short gaps suggests same speaker incorrectly split
    // FIXED: Reduced gap threshold from 1.5s to 1.0s to be more conservative
    for (let i = 0; i < sortedSegments.length - 1; i++) {
      const seg1 = sortedSegments[i]
      const seg2 = sortedSegments[i + 1]
      const gap = seg2.start - seg1.end

      // Only consider very close segments (within 1.0 seconds)
      // Longer gaps suggest intentional speaker changes
      if (gap >= 0 && gap <= 1.0 && seg1.speaker !== seg2.speaker) {
        adjacency[seg1.speaker][seg2.speaker]++
        adjacency[seg2.speaker][seg1.speaker]++
      }
    }

    // Build merge mapping
    // Only merge if speakers frequently alternate with very short gaps
    // This indicates they are the same speaker incorrectly split
    const mergeMapping: Record<string, string> = {}

    // Sort speakers by segment count (merge smaller into larger)
    const sortedSpeakers = [...speakers].sort((a, b) => {
      return (speakerSegmentCount[b] || 0) - (speakerSegmentCount[a] || 0)
    })

    // FIXED: Significantly increased thresholds to prevent over-merging
    // Threshold: merge if adjacency count is VERY high relative to segment count
    // AND the speakers EXTREMELY frequently alternate
    for (let i = 0; i < sortedSpeakers.length; i++) {
      const speaker1 = sortedSpeakers[i]
      if (mergeMapping[speaker1]) continue // Already merged

      for (let j = i + 1; j < sortedSpeakers.length; j++) {
        const speaker2 = sortedSpeakers[j]
        if (mergeMapping[speaker2]) continue // Already merged

        const adjacencyCount = adjacency[speaker1][speaker2]
        const speaker2Segments = speakerSegmentCount[speaker2] || 0
        const speaker1Duration = speakerTotalDuration[speaker1] || 0
        const speaker2Duration = speakerTotalDuration[speaker2] || 0

        // Calculate adjacency ratio (what percentage of speaker2's segments are adjacent to speaker1)
        const adjacencyRatio = speaker2Segments > 0 ? adjacencyCount / speaker2Segments : 0

        // FIXED: Merge ONLY if:
        // 1. There are MANY immediate adjacencies (>= 5, increased from 3)
        // 2. The adjacencies represent a VERY significant portion of the smaller speaker's segments (>= 70%, increased from 40%)
        // 3. The smaller speaker has very few segments (< 10) AND very short total duration (< 30s)
        // This is MUCH more conservative to prevent merging distinct speakers
        const shouldMerge = (
          adjacencyCount >= 5 &&
          adjacencyRatio >= 0.7 &&
          speaker2Segments < 10 &&
          speaker2Duration < 30
        )

        if (shouldMerge) {
          // Merge speaker2 into speaker1 (speaker1 has more segments)
          mergeMapping[speaker2] = speaker1
          console.log(`[BatchDiarization] Merging ${speaker2} into ${speaker1} (adjacency: ${adjacencyCount}, ratio: ${adjacencyRatio.toFixed(2)}, segments: ${speaker2Segments}, duration: ${speaker2Duration.toFixed(1)}s)`)
        } else if (adjacencyCount >= 3) {
          // Log cases where we considered merging but decided not to
          console.log(`[BatchDiarization] NOT merging ${speaker2} into ${speaker1} - insufficient evidence (adjacency: ${adjacencyCount}, ratio: ${adjacencyRatio.toFixed(2)}, segments: ${speaker2Segments}, duration: ${speaker2Duration.toFixed(1)}s)`)
        }
      }
    }

    // Apply merge mapping to segments
    const mergedSegmentList = segments.map(seg => ({
      ...seg,
      speaker: mergeMapping[seg.speaker] || seg.speaker
    }))

    // Get final unique speakers
    const finalSpeakers = [...new Set(mergedSegmentList.map(s => s.speaker))]

    console.log(`[BatchDiarization] Merge mapping:`, mergeMapping)
    console.log(`[BatchDiarization] Final speakers (${finalSpeakers.length}):`, finalSpeakers)

    return {
      segments: mergedSegmentList,
      speakers: finalSpeakers
    }
  },

  /**
   * Process multiple meetings in batch
   *
   * @param meetingIds - Array of meeting IDs to process
   * @param options - Diarization options
   * @returns Summary of successes and failures
   */
  async processMeetings(
    meetingIds: string[],
    options: BatchDiarizationOptions = {}
  ): Promise<{
    success: number
    failed: number
    errors: string[]
  }> {
    let successCount = 0
    let failedCount = 0
    const errors: string[] = []

    for (let i = 0; i < meetingIds.length; i++) {
      const meetingId = meetingIds[i]

      options.onProgress?.({
        phase: 'Processing meetings',
        progress: (i / meetingIds.length) * 100,
        message: `Processing meeting ${i + 1} of ${meetingIds.length}...`
      })

      const result = await this.processMeeting(meetingId, {
        ...options,
        onProgress: undefined // Don't forward individual meeting progress
      })

      if (result.success) {
        successCount++
      } else {
        failedCount++
        errors.push(`Meeting ${meetingId}: ${result.error}`)
      }
    }

    return {
      success: successCount,
      failed: failedCount,
      errors
    }
  }
}
