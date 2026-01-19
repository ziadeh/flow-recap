/**
 * Recording Services Bundle
 *
 * This module contains all services related to recording functionality.
 * It's lazy-loaded only when starting a recording, reducing initial bundle size.
 *
 * Services in this bundle (~800KB):
 * - liveTranscriptionService: Real-time audio transcription
 * - audioRecorderService: Audio capture and recording
 * - systemAudioCaptureService: System audio input capture
 * - screenCaptureKitService: macOS screen audio capture
 */

// Re-export all recording-related services
export {
  liveTranscriptionService,
  resetLiveTranscriptionState,
} from './liveTranscriptionService'
export type {
  LiveTranscriptionStatus,
  LiveTranscriptionConfig,
  LiveTranscriptSegment,
  TranscribeChunkResult,
  LiveTranscriptionProgress,
  LiveTranscriptionState,
} from './liveTranscriptionService'

export {
  audioRecorderService,
  resetAudioRecorderState,
} from './audioRecorderService'
export type {
  RecordingStatus,
  RecordingState,
  StartRecordingResult,
  StopRecordingResult,
  PauseRecordingResult,
  ResumeRecordingResult,
  AudioLevelData,
} from './audioRecorderService'

export {
  systemAudioCaptureService,
  resetDualRecordingState,
} from './systemAudioCaptureService'
export type {
  DualRecordingStatus,
  AudioSourceType,
  AudioSource,
  DualRecordingState,
  DualRecordingConfig,
  StartDualRecordingResult,
  StopDualRecordingResult,
  SystemAudioCaptureCapabilities,
} from './systemAudioCaptureService'

export {
  screenCaptureKitService,
  resetScreenCaptureKitState,
} from './screenCaptureKitService'
export type {
  ScreenCaptureKitStatus,
  ScreenCaptureKitCapabilities,
  CaptureableApp,
  ScreenCaptureKitConfig,
  StartCaptureResult,
  StopCaptureResult,
} from './screenCaptureKitService'
