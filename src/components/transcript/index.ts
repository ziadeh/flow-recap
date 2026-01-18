/**
 * Transcript Components
 *
 * A collection of components for displaying timestamped transcripts
 * with speaker labels, color coding, and click-to-seek functionality.
 */

// Main Components
export { TranscriptViewer, useTranscriptSync } from './TranscriptViewer'
export type { TranscriptViewerProps, UseTranscriptSyncOptions, UseTranscriptSyncResult } from './TranscriptViewer'

export { LiveTranscriptViewer } from './LiveTranscriptViewer'
export type { LiveTranscriptViewerProps } from './LiveTranscriptViewer'

export { TranscriptSegment, TranscriptEntry } from './TranscriptSegment'
export type { TranscriptSegmentProps, TranscriptEntryProps } from './TranscriptSegment'

export { SpeakerTag, SpeakerAvatar } from './SpeakerTag'
export type { SpeakerTagProps, SpeakerAvatarProps } from './SpeakerTag'

// Individual Speaker Box Components
export { SpeakerBox, SpeakerEntry } from './SpeakerBox'
export type { SpeakerBoxProps, SpeakerEntryProps as SpeakerBoxEntryProps } from './SpeakerBox'

export { IndividualSpeakerBoxViewer, SpeakerLegend, ViewControls } from './IndividualSpeakerBoxViewer'
export type { IndividualSpeakerBoxViewerProps } from './IndividualSpeakerBoxViewer'

// Chat-Style Transcript Components
export { ChatStyleTranscriptViewer } from './ChatStyleTranscriptViewer'
export type { ChatStyleTranscriptViewerProps } from './ChatStyleTranscriptViewer'

// Collapsible Transcript Section
export { CollapsibleTranscriptSection } from './CollapsibleTranscriptSection'
export type { CollapsibleTranscriptSectionProps, SortOption } from './CollapsibleTranscriptSection'

// Search Components
export { TranscriptSearch, useTranscriptSearch, HighlightedText } from './TranscriptSearch'
export type { TranscriptSearchProps, HighlightedTextProps, SearchState } from './TranscriptSearch'

export { SpeakerTimeline } from './SpeakerTimeline'
export type { SpeakerTimelineProps, DiarizationError } from './SpeakerTimeline'

export { LiveSpeakerTimeline } from './LiveSpeakerTimeline'
export type { LiveSpeakerTimelineProps } from './LiveSpeakerTimeline'

// Utilities
export {
  SPEAKER_COLORS,
  parseSpeakerIndex,
  getSpeakerColor,
  getSpeakerInitials,
  isDiarizationSpeaker,
  buildSpeakerColorIndex,
  groupTranscriptsBySpeaker,
  findActiveTranscript,
  isLowConfidence,
  // Individual speaker box utilities
  createIndividualSpeakerBoxes,
  assignSequentialSpeakers,
  getSpeakerStats,
  isUnknownSpeaker,
} from './transcript-utils'
export type {
  SpeakerColorConfig,
  TranscriptGroup,
  // Individual speaker box types
  IndividualBoxOptions,
  IndividualSpeakerBox,
  SpeakerStats,
} from './transcript-utils'
