/**
 * Transcript Utilities
 * Shared utilities for transcript-related components
 */

import type { Transcript, Speaker } from '../../types/database'

// ============================================================================
// Speaker Color Configuration
// ============================================================================

export const SPEAKER_COLORS = [
  { bg: 'bg-purple-100', text: 'text-purple-700', border: 'border-purple-300', avatar: 'bg-purple-200 text-purple-800' },
  { bg: 'bg-blue-100', text: 'text-blue-700', border: 'border-blue-300', avatar: 'bg-blue-200 text-blue-800' },
  { bg: 'bg-green-100', text: 'text-green-700', border: 'border-green-300', avatar: 'bg-green-200 text-green-800' },
  { bg: 'bg-orange-100', text: 'text-orange-700', border: 'border-orange-300', avatar: 'bg-orange-200 text-orange-800' },
  { bg: 'bg-pink-100', text: 'text-pink-700', border: 'border-pink-300', avatar: 'bg-pink-200 text-pink-800' },
  { bg: 'bg-teal-100', text: 'text-teal-700', border: 'border-teal-300', avatar: 'bg-teal-200 text-teal-800' },
  { bg: 'bg-yellow-100', text: 'text-yellow-700', border: 'border-yellow-300', avatar: 'bg-yellow-200 text-yellow-800' },
  { bg: 'bg-indigo-100', text: 'text-indigo-700', border: 'border-indigo-300', avatar: 'bg-indigo-200 text-indigo-800' },
] as const

export type SpeakerColorConfig = typeof SPEAKER_COLORS[number]

// ============================================================================
// Speaker Utilities
// ============================================================================

/**
 * Parse speaker index from label.
 * Handles multiple formats:
 * - "Speaker_2" -> 2 (0-indexed, diarization format)
 * - "SPEAKER_2" -> 2 (0-indexed, uppercase diarization format)
 * - "Speaker 3" -> 2 (1-indexed display format, converted to 0-indexed)
 * - "SPEAKER_02" -> 2 (pyannote raw format)
 */
export function parseSpeakerIndex(name: string): number {
  // Try underscore format first (Speaker_N or SPEAKER_N or SPEAKER_0N)
  const underscoreMatch = name.match(/speaker[_](\d+)/i)
  if (underscoreMatch) {
    return parseInt(underscoreMatch[1], 10)
  }
  // Try space format (Speaker N) - this is 1-indexed in display, convert to 0-indexed
  const spaceMatch = name.match(/speaker\s+(\d+)/i)
  if (spaceMatch) {
    return parseInt(spaceMatch[1], 10) - 1
  }
  return 0
}

/**
 * Check if speaker name is auto-detected from diarization.
 * Handles multiple formats used by different parts of the system:
 * - "Speaker_N" (standard diarization format)
 * - "SPEAKER_N" or "SPEAKER_0N" (pyannote raw format)
 * - "Speaker N" (1-indexed display format)
 */
export function isDiarizationSpeaker(name: string): boolean {
  return /^speaker[_\s]\d+$/i.test(name)
}

/**
 * Get color classes for a speaker
 */
export function getSpeakerColor(speakerName: string | undefined, colorIndex: number): SpeakerColorConfig {
  // If speaker name matches Speaker_N pattern (diarization format), use that index for color
  if (speakerName && isDiarizationSpeaker(speakerName)) {
    const index = parseSpeakerIndex(speakerName)
    return SPEAKER_COLORS[index % SPEAKER_COLORS.length]
  }
  // If speaker name matches "Speaker N" display format, extract and use that index
  if (speakerName) {
    const spaceMatch = speakerName.match(/Speaker\s+(\d+)/)
    if (spaceMatch) {
      const index = parseInt(spaceMatch[1], 10) - 1 // Convert 1-indexed back to 0-indexed for color array
      return SPEAKER_COLORS[Math.max(0, index) % SPEAKER_COLORS.length]
    }
  }
  // Otherwise use the provided color index
  return SPEAKER_COLORS[colorIndex % SPEAKER_COLORS.length]
}

/**
 * Get initials from speaker name
 */
export function getSpeakerInitials(name: string): string {
  // For Speaker_N format (from diarization), return "SN" (1-indexed for display)
  const underscoreMatch = name.match(/Speaker_(\d+)/)
  if (underscoreMatch) {
    const displayIndex = parseInt(underscoreMatch[1], 10) + 1
    return `S${displayIndex}`
  }
  // For formatted "Speaker N" display names, extract the number
  const spaceMatch = name.match(/Speaker\s+(\d+)/)
  if (spaceMatch) {
    return `S${spaceMatch[1]}`
  }
  // Otherwise get first letter of each word
  return name
    .split(' ')
    .map((n) => n[0])
    .join('')
    .toUpperCase()
    .slice(0, 2)
}

// ============================================================================
// Transcript Grouping
// ============================================================================

export interface TranscriptGroup {
  speaker: Speaker | undefined
  speakerId: string | null
  speakerName: string
  entries: Transcript[]
  colorIndex: number
}

/**
 * Build speaker color index mapping based on order of appearance
 */
export function buildSpeakerColorIndex(transcripts: Transcript[]): Map<string, number> {
  const colorMap = new Map<string, number>()
  let colorIndex = 0
  transcripts.forEach((t) => {
    if (t.speaker_id && !colorMap.has(t.speaker_id)) {
      colorMap.set(t.speaker_id, colorIndex++)
    }
  })
  return colorMap
}

/**
 * Group consecutive transcript entries from the same speaker
 * @param speakerNameOverrides Optional map of speaker IDs to meeting-specific display names
 */
export function groupTranscriptsBySpeaker(
  transcripts: Transcript[],
  speakers: Map<string, Speaker>,
  speakerColorIndex: Map<string, number>,
  speakerNameOverrides?: Map<string, string>
): TranscriptGroup[] {
  const groups: TranscriptGroup[] = []

  transcripts.forEach((transcript) => {
    const lastGroup = groups[groups.length - 1]
    if (lastGroup && lastGroup.speakerId === transcript.speaker_id) {
      lastGroup.entries.push(transcript)
    } else {
      const speaker = transcript.speaker_id ? speakers.get(transcript.speaker_id) : undefined

      // Generate speaker name: prioritize meeting-specific override, then database speaker name, then diarization label, then fallback
      let speakerName = 'Unknown Speaker'
      const override = transcript.speaker_id ? speakerNameOverrides?.get(transcript.speaker_id) : undefined
      if (override) {
        // Use meeting-specific name override if set
        speakerName = override
      } else if (speaker?.name) {
        speakerName = speaker.name
      } else if (transcript.speaker_id && isDiarizationSpeaker(transcript.speaker_id)) {
        // Format diarization speaker IDs like "Speaker_0" -> "Speaker 1"
        const index = parseSpeakerIndex(transcript.speaker_id) + 1
        speakerName = `Speaker ${index}`
      } else if (transcript.speaker_id) {
        // Use the speaker_id as the name if it's not a diarization format
        speakerName = transcript.speaker_id
      }

      groups.push({
        speaker,
        speakerId: transcript.speaker_id,
        speakerName,
        entries: [transcript],
        colorIndex: transcript.speaker_id ? (speakerColorIndex.get(transcript.speaker_id) ?? 0) : 0
      })
    }
  })

  return groups
}

/**
 * Find the active transcript based on current audio time
 */
export function findActiveTranscript(transcripts: Transcript[], currentAudioTimeSeconds: number): string | undefined {
  const currentTimeMs = currentAudioTimeSeconds * 1000
  return transcripts.find((t) => currentTimeMs >= t.start_time_ms && currentTimeMs <= t.end_time_ms)?.id
}

/**
 * Check if a transcript entry has low confidence
 */
export function isLowConfidence(confidence: number | null, threshold: number = 0.7): boolean {
  return confidence !== null && confidence < threshold
}

// ============================================================================
// Segment Merging
// ============================================================================

export interface MergeOptions {
  /** Maximum time gap (in ms) between segments to allow merging */
  maxGapMs?: number
  /** Whether to merge segments with different speakers */
  mergeDifferentSpeakers?: boolean
  /** Whether to only merge consecutive segments from the same speaker */
  groupBySpeaker?: boolean
}

/**
 * Merge consecutive transcript segments from the same speaker.
 * This reduces visual clutter by combining short bursts of speech into
 * coherent paragraphs while respecting speaker boundaries.
 */
export function mergeConsecutiveSegments(
  transcripts: Transcript[],
  options: MergeOptions = {}
): Transcript[] {
  const {
    maxGapMs = 2000, // Default 2 second gap
    mergeDifferentSpeakers = false,
    groupBySpeaker = true
  } = options

  if (transcripts.length === 0) return []

  const merged: Transcript[] = []
  let currentGroup: Transcript | null = null

  for (const transcript of transcripts) {
    if (!currentGroup) {
      // Start a new group
      currentGroup = { ...transcript }
      continue
    }

    // Check if this transcript can be merged with current group
    const timeDiff = transcript.start_time_ms - currentGroup.end_time_ms
    const sameSpeaker = currentGroup.speaker_id === transcript.speaker_id

    const canMerge = timeDiff <= maxGapMs &&
      (mergeDifferentSpeakers || !groupBySpeaker || sameSpeaker)

    if (canMerge) {
      // Merge into current group
      currentGroup.content = `${currentGroup.content} ${transcript.content}`
      currentGroup.end_time_ms = transcript.end_time_ms
      // Average the confidence scores
      if (currentGroup.confidence !== null && transcript.confidence !== null) {
        currentGroup.confidence = (currentGroup.confidence + transcript.confidence) / 2
      }
    } else {
      // Push current group and start new one
      merged.push(currentGroup)
      currentGroup = { ...transcript }
    }
  }

  // Don't forget the last group
  if (currentGroup) {
    merged.push(currentGroup)
  }

  return merged
}

/**
 * Format speaker label for display.
 * Converts internal labels like "Speaker_0" to user-friendly format.
 */
export function formatSpeakerLabel(
  speakerId: string | null | undefined,
  speakerName: string | null | undefined,
  customPrefix: string = 'Speaker'
): string {
  // If we have a custom name, use it
  if (speakerName && !isDiarizationSpeaker(speakerName)) {
    return speakerName
  }

  // Parse the speaker index from the ID or name
  const idOrName = speakerId || speakerName || 'Unknown'
  const match = idOrName.match(/Speaker_(\d+)/)

  if (match) {
    const index = parseInt(match[1], 10) + 1 // Convert 0-indexed to 1-indexed
    return `${customPrefix} ${index}`
  }

  return speakerName || 'Unknown Speaker'
}

/**
 * Create a structured transcript output format with speaker labels.
 * Useful for exporting or displaying transcripts with attribution.
 */
export interface FormattedTranscriptEntry {
  speaker: string
  text: string
  startTime: number
  endTime: number
  confidence?: number
}

export function formatTranscriptForExport(
  transcripts: Transcript[],
  speakers: Map<string, Speaker>,
  options: {
    format?: 'text' | 'json' | 'srt'
    speakerPrefix?: string
    includeTimestamps?: boolean
    mergeSegments?: boolean
  } = {}
): string | FormattedTranscriptEntry[] {
  const {
    format = 'text',
    speakerPrefix = 'Speaker',
    includeTimestamps = true,
    mergeSegments = true
  } = options

  // Optionally merge segments first
  const segments = mergeSegments
    ? mergeConsecutiveSegments(transcripts)
    : transcripts

  // Build formatted entries
  const entries: FormattedTranscriptEntry[] = segments.map(t => {
    const speaker = t.speaker_id ? speakers.get(t.speaker_id) : undefined
    return {
      speaker: formatSpeakerLabel(t.speaker_id, speaker?.name, speakerPrefix),
      text: t.content,
      startTime: t.start_time_ms,
      endTime: t.end_time_ms,
      confidence: t.confidence
    }
  })

  if (format === 'json') {
    return entries
  }

  if (format === 'srt') {
    // SubRip subtitle format
    return entries.map((e, i) => {
      const startSrt = formatSrtTimestamp(e.startTime)
      const endSrt = formatSrtTimestamp(e.endTime)
      return `${i + 1}\n${startSrt} --> ${endSrt}\n[${e.speaker}]\n${e.text}\n`
    }).join('\n')
  }

  // Default: plain text format
  return entries.map(e => {
    const timestamp = includeTimestamps
      ? `[${formatTimestamp(e.startTime)}] `
      : ''
    return `${timestamp}[${e.speaker}]: ${e.text}`
  }).join('\n\n')
}

function formatTimestamp(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000)
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  return `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`
}

function formatSrtTimestamp(ms: number): string {
  const hours = Math.floor(ms / 3600000)
  const minutes = Math.floor((ms % 3600000) / 60000)
  const seconds = Math.floor((ms % 60000) / 1000)
  const millis = ms % 1000
  return `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')},${millis.toString().padStart(3, '0')}`
}

// ============================================================================
// Individual Speaker Box Utilities
// ============================================================================

/**
 * Options for grouping transcripts into individual speaker boxes
 */
export interface IndividualBoxOptions {
  /**
   * Mode for handling unknown speakers:
   * - 'group': Group all unknown speakers together (default behavior)
   * - 'individual': Treat each segment as a separate speaker box
   * - 'sequential': Assign sequential speaker IDs to unknown speakers
   */
  unknownSpeakerMode?: 'group' | 'individual' | 'sequential'
  /** Time gap (ms) to consider as speaker change for unknown speakers */
  speakerChangeGapMs?: number
  /** Whether to show segment index for individual mode */
  showSegmentIndex?: boolean
  /** Custom prefix for auto-generated speaker labels */
  autoLabelPrefix?: string
}

/**
 * Extended TranscriptGroup with additional metadata for individual boxes
 */
export interface IndividualSpeakerBox extends TranscriptGroup {
  /** Unique box identifier */
  boxId: string
  /** Whether this is an auto-generated speaker assignment */
  isAutoAssigned: boolean
  /** Segment index (for individual mode) */
  segmentIndex?: number
  /** Total duration of all entries in this box (ms) */
  totalDurationMs: number
  /** Start time of the first entry */
  startTimeMs: number
  /** End time of the last entry */
  endTimeMs: number
}

/**
 * Assign unique identifiers to unknown speakers based on time gaps.
 * This is useful when diarization isn't available but we want to
 * visually distinguish different speech segments.
 */
export function assignSequentialSpeakers(
  transcripts: Transcript[],
  gapThresholdMs: number = 2000
): Transcript[] {
  if (transcripts.length === 0) return []

  const result: Transcript[] = []
  let currentSpeakerIndex = 0
  let lastEndTime = 0

  for (const transcript of transcripts) {
    // If there's already a speaker_id, keep it
    if (transcript.speaker_id) {
      result.push(transcript)
      lastEndTime = transcript.end_time_ms
      continue
    }

    // Check if there's a significant gap since the last segment
    const gap = transcript.start_time_ms - lastEndTime
    if (gap > gapThresholdMs && result.length > 0) {
      // Potentially a new speaker - alternate between speakers
      currentSpeakerIndex = (currentSpeakerIndex + 1) % 2
    }

    result.push({
      ...transcript,
      speaker_id: `auto_speaker_${currentSpeakerIndex}`
    })
    lastEndTime = transcript.end_time_ms
  }

  return result
}

/**
 * Create individual speaker boxes from transcripts.
 * Each transcript segment gets its own visual box with unique styling.
 */
export function createIndividualSpeakerBoxes(
  transcripts: Transcript[],
  speakers: Map<string, Speaker>,
  options: IndividualBoxOptions = {}
): IndividualSpeakerBox[] {
  const {
    unknownSpeakerMode = 'group',
    speakerChangeGapMs = 2000,
    showSegmentIndex = false,
    autoLabelPrefix = 'Speaker'
  } = options

  if (transcripts.length === 0) return []

  // Pre-process transcripts based on mode
  let processedTranscripts = transcripts
  if (unknownSpeakerMode === 'sequential') {
    processedTranscripts = assignSequentialSpeakers(transcripts, speakerChangeGapMs)
  }

  // Build color index
  const speakerColorIndex = buildSpeakerColorIndex(processedTranscripts)

  // Track auto-assigned speaker indices for individual mode
  let autoSpeakerIndex = 0
  const boxes: IndividualSpeakerBox[] = []

  if (unknownSpeakerMode === 'individual') {
    // Each segment gets its own box
    processedTranscripts.forEach((transcript, index) => {
      const speaker = transcript.speaker_id ? speakers.get(transcript.speaker_id) : undefined

      // Generate speaker name
      let speakerName: string
      let isAutoAssigned = false

      if (speaker?.name) {
        speakerName = speaker.name
      } else if (transcript.speaker_id && isDiarizationSpeaker(transcript.speaker_id)) {
        const idx = parseSpeakerIndex(transcript.speaker_id) + 1
        speakerName = `${autoLabelPrefix} ${idx}`
        isAutoAssigned = true
      } else if (transcript.speaker_id) {
        speakerName = transcript.speaker_id
      } else {
        // No speaker - assign based on segment index
        speakerName = showSegmentIndex
          ? `${autoLabelPrefix} (Segment ${index + 1})`
          : `${autoLabelPrefix} ${(index % 8) + 1}`
        isAutoAssigned = true
        autoSpeakerIndex++
      }

      const colorIndex = transcript.speaker_id
        ? (speakerColorIndex.get(transcript.speaker_id) ?? index % SPEAKER_COLORS.length)
        : index % SPEAKER_COLORS.length

      boxes.push({
        boxId: `box-${transcript.id}`,
        speaker,
        speakerId: transcript.speaker_id,
        speakerName,
        entries: [transcript],
        colorIndex,
        isAutoAssigned,
        segmentIndex: index,
        totalDurationMs: transcript.end_time_ms - transcript.start_time_ms,
        startTimeMs: transcript.start_time_ms,
        endTimeMs: transcript.end_time_ms
      })
    })
  } else {
    // Group mode (default or sequential)
    const groups = groupTranscriptsBySpeaker(processedTranscripts, speakers, speakerColorIndex)

    groups.forEach((group, index) => {
      const firstEntry = group.entries[0]
      const lastEntry = group.entries[group.entries.length - 1]

      boxes.push({
        ...group,
        boxId: `box-${index}-${firstEntry.id}`,
        isAutoAssigned: !group.speaker && !group.speakerId,
        totalDurationMs: lastEntry.end_time_ms - firstEntry.start_time_ms,
        startTimeMs: firstEntry.start_time_ms,
        endTimeMs: lastEntry.end_time_ms
      })
    })
  }

  return boxes
}

/**
 * Get unique speaker statistics from transcript boxes
 */
export interface SpeakerStats {
  speakerId: string | null
  speakerName: string
  colorIndex: number
  totalSegments: number
  totalDurationMs: number
  wordCount: number
  averageConfidence: number
}

export function getSpeakerStats(boxes: IndividualSpeakerBox[]): SpeakerStats[] {
  const statsMap = new Map<string, SpeakerStats>()

  for (const box of boxes) {
    const key = box.speakerId || box.speakerName

    if (!statsMap.has(key)) {
      statsMap.set(key, {
        speakerId: box.speakerId,
        speakerName: box.speakerName,
        colorIndex: box.colorIndex,
        totalSegments: 0,
        totalDurationMs: 0,
        wordCount: 0,
        averageConfidence: 0
      })
    }

    const stats = statsMap.get(key)!
    stats.totalSegments += box.entries.length
    stats.totalDurationMs += box.totalDurationMs

    for (const entry of box.entries) {
      stats.wordCount += entry.content.split(/\s+/).length
      if (entry.confidence !== null) {
        stats.averageConfidence =
          (stats.averageConfidence * (stats.totalSegments - 1) + entry.confidence) / stats.totalSegments
      }
    }
  }

  return Array.from(statsMap.values()).sort((a, b) => b.totalDurationMs - a.totalDurationMs)
}

/**
 * Check if a speaker name indicates an unknown/unidentified speaker
 */
export function isUnknownSpeaker(name: string): boolean {
  const lowerName = name.toLowerCase()
  return lowerName.includes('unknown') ||
         lowerName.includes('unidentified') ||
         lowerName === 'speaker' ||
         /^speaker\s*\d*$/i.test(name) ||
         /^auto_speaker_\d+$/i.test(name)
}

// ============================================================================
// Diarization-First Utilities
// ============================================================================

/**
 * Validation result for transcript speaker coverage
 */
export interface SpeakerCoverageValidation {
  /** Whether all transcripts have speaker attribution */
  isComplete: boolean
  /** Total number of transcripts */
  totalTranscripts: number
  /** Transcripts with speaker attribution */
  withSpeaker: number
  /** Transcripts without speaker attribution */
  withoutSpeaker: number
  /** Coverage percentage (0-100) */
  coveragePercent: number
  /** List of unique speakers */
  uniqueSpeakers: string[]
  /** Warning message if coverage is incomplete */
  warning?: string
}

/**
 * Validate that transcripts have proper speaker attribution from diarization
 *
 * This is used to verify that the diarization-first pipeline has been applied
 * and all transcripts have speaker_id assigned from diarization.
 */
export function validateSpeakerCoverage(transcripts: Transcript[]): SpeakerCoverageValidation {
  if (transcripts.length === 0) {
    return {
      isComplete: true,
      totalTranscripts: 0,
      withSpeaker: 0,
      withoutSpeaker: 0,
      coveragePercent: 100,
      uniqueSpeakers: []
    }
  }

  const withSpeaker = transcripts.filter(t => t.speaker_id)
  const withoutSpeaker = transcripts.filter(t => !t.speaker_id)
  const uniqueSpeakers = [...new Set(transcripts.map(t => t.speaker_id).filter(Boolean))] as string[]
  const coveragePercent = (withSpeaker.length / transcripts.length) * 100

  const result: SpeakerCoverageValidation = {
    isComplete: withoutSpeaker.length === 0,
    totalTranscripts: transcripts.length,
    withSpeaker: withSpeaker.length,
    withoutSpeaker: withoutSpeaker.length,
    coveragePercent,
    uniqueSpeakers
  }

  if (!result.isComplete) {
    result.warning = `${withoutSpeaker.length} transcript segment(s) do not have speaker attribution. ` +
      'This may indicate incomplete diarization data.'
  }

  return result
}

/**
 * Check if transcripts are properly aligned with diarization
 *
 * Transcripts from the diarization-first pipeline should have:
 * 1. speaker_id assigned from diarization
 * 2. No "UNKNOWN" or empty speaker IDs
 * 3. Consistent speaker labeling
 */
export function isDiarizationAligned(transcripts: Transcript[]): boolean {
  if (transcripts.length === 0) return true

  return transcripts.every(t => {
    // Must have speaker_id
    if (!t.speaker_id) return false
    // Should not be UNKNOWN (from failed alignment)
    if (t.speaker_id === 'UNKNOWN') return false
    // Should follow diarization format or be a valid UUID
    return isDiarizationSpeaker(t.speaker_id) ||
           t.speaker_id.match(/^[a-f0-9-]{36}$/i) || // UUID format for database speakers
           t.speaker_id.match(/^SPEAKER_\d+$/i) // Raw diarization format
  })
}

/**
 * Group transcripts into conversation blocks by speaker
 *
 * This is the primary display format for diarization-first transcripts.
 * Groups consecutive utterances from the same speaker into conversation blocks.
 */
export interface ConversationBlock {
  /** Unique block identifier */
  blockId: string
  /** Speaker ID (database or diarization format) */
  speakerId: string
  /** Display name for the speaker */
  speakerName: string
  /** All transcripts in this block */
  transcripts: Transcript[]
  /** Combined text content */
  combinedContent: string
  /** Start time in milliseconds */
  startTimeMs: number
  /** End time in milliseconds */
  endTimeMs: number
  /** Average confidence across transcripts */
  averageConfidence: number
  /** Color index for consistent styling */
  colorIndex: number
  /** Whether speaker is from diarization (vs manually assigned) */
  isFromDiarization: boolean
}

/**
 * Create conversation blocks from transcripts
 *
 * Groups consecutive transcripts from the same speaker into blocks,
 * optimized for chat-style display.
 */
export function createConversationBlocks(
  transcripts: Transcript[],
  speakers: Map<string, Speaker>
): ConversationBlock[] {
  if (transcripts.length === 0) return []

  const speakerColorIndex = buildSpeakerColorIndex(transcripts)
  const blocks: ConversationBlock[] = []
  let currentBlock: ConversationBlock | null = null
  let blockCounter = 0

  for (const transcript of transcripts) {
    const speakerId = transcript.speaker_id || 'UNKNOWN'
    const speaker = speakerId !== 'UNKNOWN' ? speakers.get(speakerId) : undefined

    // Determine speaker name
    let speakerName = 'Unknown Speaker'
    let isFromDiarization = false

    if (speaker?.name) {
      speakerName = speaker.name
      // Check if the name matches diarization pattern
      isFromDiarization = /^Speaker\s+\d+$/i.test(speaker.name)
    } else if (isDiarizationSpeaker(speakerId) || speakerId.match(/^SPEAKER_\d+$/i)) {
      // Format diarization speaker ID for display
      const match = speakerId.match(/(?:Speaker_|SPEAKER_)(\d+)/i)
      if (match) {
        speakerName = `Speaker ${parseInt(match[1], 10) + 1}`
      }
      isFromDiarization = true
    }

    // Check if we should continue the current block or start a new one
    if (currentBlock && currentBlock.speakerId === speakerId) {
      // Same speaker - add to current block
      currentBlock.transcripts.push(transcript)
      currentBlock.combinedContent += ' ' + transcript.content
      currentBlock.endTimeMs = transcript.end_time_ms
      // Update average confidence
      const totalConfidence = currentBlock.transcripts.reduce(
        (sum, t) => sum + (t.confidence || 1), 0
      )
      currentBlock.averageConfidence = totalConfidence / currentBlock.transcripts.length
    } else {
      // Different speaker - start new block
      if (currentBlock) {
        blocks.push(currentBlock)
      }

      currentBlock = {
        blockId: `block-${blockCounter++}`,
        speakerId,
        speakerName,
        transcripts: [transcript],
        combinedContent: transcript.content,
        startTimeMs: transcript.start_time_ms,
        endTimeMs: transcript.end_time_ms,
        averageConfidence: transcript.confidence || 1,
        colorIndex: speakerColorIndex.get(speakerId) || 0,
        isFromDiarization
      }
    }
  }

  // Don't forget the last block
  if (currentBlock) {
    blocks.push(currentBlock)
  }

  return blocks
}

/**
 * Get speaker statistics from transcripts
 *
 * Useful for displaying speaker activity summary in the UI.
 */
export interface TranscriptSpeakerStats {
  speakerId: string
  speakerName: string
  totalDurationMs: number
  wordCount: number
  segmentCount: number
  percentage: number
  isFromDiarization: boolean
}

export function getTranscriptSpeakerStats(
  transcripts: Transcript[],
  speakers: Map<string, Speaker>
): TranscriptSpeakerStats[] {
  if (transcripts.length === 0) return []

  const statsMap = new Map<string, {
    speakerName: string
    totalDurationMs: number
    wordCount: number
    segmentCount: number
    isFromDiarization: boolean
  }>()

  let totalDuration = 0

  for (const transcript of transcripts) {
    const speakerId = transcript.speaker_id || 'UNKNOWN'
    const speaker = speakers.get(speakerId)
    const duration = transcript.end_time_ms - transcript.start_time_ms
    totalDuration += duration

    let speakerName = speaker?.name || 'Unknown Speaker'
    let isFromDiarization = false

    if (!speaker && (isDiarizationSpeaker(speakerId) || speakerId.match(/^SPEAKER_\d+$/i))) {
      const match = speakerId.match(/(?:Speaker_|SPEAKER_)(\d+)/i)
      if (match) {
        speakerName = `Speaker ${parseInt(match[1], 10) + 1}`
      }
      isFromDiarization = true
    }

    const existing = statsMap.get(speakerId) || {
      speakerName,
      totalDurationMs: 0,
      wordCount: 0,
      segmentCount: 0,
      isFromDiarization
    }

    existing.totalDurationMs += duration
    existing.wordCount += transcript.content.split(/\s+/).length
    existing.segmentCount++

    statsMap.set(speakerId, existing)
  }

  return Array.from(statsMap.entries())
    .map(([speakerId, stats]) => ({
      speakerId,
      ...stats,
      percentage: totalDuration > 0 ? (stats.totalDurationMs / totalDuration) * 100 : 0
    }))
    .sort((a, b) => b.totalDurationMs - a.totalDurationMs)
}
