/**
 * RecordingControls Component
 *
 * Complete recording control interface with buttons, duration, audio level meters,
 * live transcription display, and live speaker diarization.
 *
 * Speaker diarization runs independently from transcription using voice embeddings
 * (pyannote.audio/speechbrain) for real-time speaker identification WITHOUT LLM processing.
 */

import { useEffect, useState, useRef } from 'react'
import { RecordButton } from './RecordButton'
import { AudioLevelMeter } from './AudioLevelMeter'
import { RecordingStatus } from '@/stores/recording-store'
import { useLiveTranscriptStore } from '@/stores/live-transcript-store'
import { useLiveDiarization } from '@/hooks/useLiveDiarization'
import { cn } from '@/lib/utils'
import { AlertCircle, X, Mic, Radio, Loader2, Users, Sparkles, ChevronDown, ChevronUp, Bug } from 'lucide-react'
import { SPEAKER_COLORS, parseSpeakerIndex, type SpeakerColorConfig } from './transcript/transcript-utils'
import { LiveNotesPanel } from './recording/LiveNotesPanel'
import { SpeakerDebugOverlay } from './recording/SpeakerDebugOverlay'
import type { DiarizationFullSettings } from './SpeakerDiarizationSettings'

interface RecordingControlsProps {
  status: RecordingStatus
  duration: number // Duration in milliseconds
  onStart: () => void | Promise<void>
  onStop: () => void | Promise<void>
  onPause: () => void | Promise<void>
  onResume: () => void | Promise<void>
  audioLevel?: number // Optional audio level (0-100)
  deviceUsed?: string | null // The audio device being used for recording
  deviceWarning?: string | null // Warning message about device issues (e.g., fallback to default)
  className?: string
  /** Meeting ID for live diarization */
  meetingId?: string
  /** Enable live speaker diarization (default: true when meetingId is provided) */
  enableDiarization?: boolean
  /** Enable live notes generation (default: true) */
  enableLiveNotes?: boolean
  /** Enable debug overlay for speaker timeline debugging (default: false) */
  enableDebugOverlay?: boolean
}

/**
 * Format duration in milliseconds to MM:SS format
 */
function formatDuration(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000)
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  return `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`
}

/**
 * Helper to get speaker color based on speaker label
 */
function getSpeakerColor(speaker: string): SpeakerColorConfig {
  const index = parseSpeakerIndex(speaker)
  return SPEAKER_COLORS[Math.max(0, index) % SPEAKER_COLORS.length]
}

/**
 * Format speaker label for display
 */
function formatSpeakerLabel(speaker: string): string {
  const index = parseSpeakerIndex(speaker)
  if (index >= 0) {
    return `Speaker ${index + 1}`
  }
  return speaker
}

export function RecordingControls({
  status,
  duration,
  onStart,
  onStop,
  onPause,
  onResume,
  audioLevel,
  deviceUsed,
  deviceWarning,
  className,
  meetingId,
  enableDiarization = true,
  enableLiveNotes = true,
  enableDebugOverlay = false
}: RecordingControlsProps) {
  const [displayDuration, setDisplayDuration] = useState(duration)
  const [simulatedAudioLevel, setSimulatedAudioLevel] = useState(0)
  const [showWarning, setShowWarning] = useState(true)
  const [showLiveNotes, setShowLiveNotes] = useState(true)
  const [showDebugOverlay, setShowDebugOverlay] = useState(enableDebugOverlay)
  const [diarizationSettings, setDiarizationSettings] = useState<DiarizationFullSettings | null>(null)
  const transcriptScrollRef = useRef<HTMLDivElement>(null)

  // Load diarization settings on mount
  useEffect(() => {
    const loadDiarizationSettings = async () => {
      try {
        const api = window.electronAPI as any
        if (api?.db?.settings?.get) {
          const settings = await api.db.settings.get('diarization.fullSettings')
          if (settings) {
            setDiarizationSettings(settings as DiarizationFullSettings)
          } else {
            // Load default settings
            setDiarizationSettings({
              enabled: true,
              autoRecovery: true,
              speakerCountMode: 'auto',
              fixedSpeakerCount: 2,
              minSpeakers: 2,
              maxSpeakers: 10,
              nameExtractionEnabled: true,
              nameConfidenceThreshold: 0.6,
              clusteringSensitivity: 0.5,
              audioQualityMode: 'balanced',
              audioPreprocessingLevel: 'minimal',
              activePreset: null
            })
          }
        }
      } catch (err) {
        console.error('Failed to load diarization settings:', err)
      }
    }
    loadDiarizationSettings()
  }, [])

  // Live transcription state
  const liveStatus = useLiveTranscriptStore((state) => state.status)
  const liveSegments = useLiveTranscriptStore((state) => state.segments)
  const liveError = useLiveTranscriptStore((state) => state.error)

  // Live diarization state (for real-time speaker identification WITHOUT LLM)
  const {
    isAvailable: isDiarizationAvailable,
    isActive: isDiarizationActive,
    isInitializing: isDiarizationInitializing,
    numSpeakers,
    currentSpeaker,
    speakerSegments,
    startDiarization,
    stopDiarization,
    pauseDiarization,
    resumeDiarization,
  } = useLiveDiarization()

  // Update display duration when status or duration changes
  useEffect(() => {
    setDisplayDuration(duration)
  }, [duration])

  // Show warning again when a new warning comes in
  useEffect(() => {
    if (deviceWarning) {
      setShowWarning(true)
    }
  }, [deviceWarning])

  // Update duration display in real-time when recording
  useEffect(() => {
    if (status === 'recording' && duration > 0) {
      const interval = setInterval(() => {
        setDisplayDuration((prev) => prev + 1000)
      }, 1000)
      return () => clearInterval(interval)
    }
  }, [status, duration])

  // Simulate audio levels when recording (if not provided)
  useEffect(() => {
    if (status === 'recording' && audioLevel === undefined) {
      const interval = setInterval(() => {
        // Simulate audio levels with some randomness
        const baseLevel = 30 + Math.random() * 40 // Between 30-70%
        const variation = (Math.random() - 0.5) * 20 // ±10 variation
        setSimulatedAudioLevel(Math.max(0, Math.min(100, baseLevel + variation)))
      }, 100) // Update every 100ms for smooth animation
      return () => clearInterval(interval)
    } else if (status !== 'recording') {
      setSimulatedAudioLevel(0)
    }
  }, [status, audioLevel])

  // Auto-scroll transcript to bottom when new segments arrive
  useEffect(() => {
    if (transcriptScrollRef.current && liveSegments.length > 0) {
      transcriptScrollRef.current.scrollTop = transcriptScrollRef.current.scrollHeight
    }
  }, [liveSegments.length])

  // Auto-start live diarization when recording starts (independent of transcription)
  useEffect(() => {
    if (enableDiarization && meetingId && isDiarizationAvailable) {
      if (status === 'recording' && !isDiarizationActive && !isDiarizationInitializing) {
        console.log('[RecordingControls] Auto-starting live diarization')
        startDiarization(meetingId)
      } else if (status === 'paused' && isDiarizationActive) {
        pauseDiarization()
      } else if (status === 'idle' && isDiarizationActive) {
        console.log('[RecordingControls] Auto-stopping live diarization')
        stopDiarization()
      }
    }
  }, [status, meetingId, enableDiarization, isDiarizationAvailable, isDiarizationActive, isDiarizationInitializing, startDiarization, pauseDiarization, stopDiarization])

  // Resume diarization when recording resumes
  useEffect(() => {
    if (status === 'recording' && isDiarizationActive) {
      resumeDiarization()
    }
  }, [status, isDiarizationActive, resumeDiarization])

  const currentAudioLevel = audioLevel !== undefined ? audioLevel : simulatedAudioLevel
  const isRecording = status === 'recording' || status === 'paused'
  const showLiveTranscript = isRecording && (liveStatus === 'starting' || liveStatus === 'active' || liveStatus === 'paused' || liveSegments.length > 0)
  const showLiveDiarization = isRecording && enableDiarization && meetingId && (isDiarizationActive || isDiarizationInitializing || numSpeakers > 0)

  return (
    <div
      className={cn(
        'bg-card border border-border rounded-lg p-6 shadow-sm',
        className
      )}
    >
      <div className="flex items-center justify-between gap-6">
        {/* Left side: Controls */}
        <div className="flex items-center gap-4">
          <RecordButton
            status={status}
            onStart={onStart}
            onStop={onStop}
            onPause={onPause}
            onResume={onResume}
          />
        </div>

        {/* Center: Duration */}
        {isRecording && (
          <div className="flex items-center gap-3">
            <div className="flex flex-col">
              <span className="text-xs text-muted-foreground uppercase tracking-wider">
                Duration
              </span>
              <span className="text-2xl font-mono font-semibold text-foreground">
                {formatDuration(displayDuration)}
              </span>
            </div>
          </div>
        )}

        {/* Right side: Audio Level Meter */}
        {isRecording && (
          <div className="flex items-center gap-3">
            <div className="flex flex-col items-end">
              <span className="text-xs text-muted-foreground uppercase tracking-wider mb-1">
                Audio Level
              </span>
              <AudioLevelMeter level={currentAudioLevel} />
            </div>
          </div>
        )}
      </div>

      {/* Status indicator */}
      {isRecording && (
        <div className="mt-4 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div
              className={cn(
                'w-2 h-2 rounded-full',
                status === 'recording' ? 'bg-red-500 animate-pulse' : 'bg-yellow-500'
              )}
            />
            <span className="text-sm text-muted-foreground">
              {status === 'recording' ? 'Recording...' : 'Paused'}
              {deviceUsed && deviceUsed !== 'system default' && (
                <span className="ml-2 text-xs opacity-75">
                  ({deviceUsed})
                </span>
              )}
            </span>
          </div>

          {/* Diarization Configuration Status */}
          {enableDiarization && diarizationSettings && (
            <div
              className="flex items-center gap-2 text-xs text-muted-foreground bg-muted/50 px-2 py-1 rounded"
              data-testid="diarization-config-status"
            >
              <Users className="w-3.5 h-3.5" />
              <span>
                Auto ID: {diarizationSettings.enabled ? 'On' : 'Off'}
                {diarizationSettings.enabled && (
                  <>
                    {diarizationSettings.speakerCountMode === 'auto' && ', Auto-detect'}
                    {diarizationSettings.speakerCountMode === 'fixed' && `, ${diarizationSettings.fixedSpeakerCount} speakers`}
                    {diarizationSettings.speakerCountMode === 'range' && `, ${diarizationSettings.minSpeakers}-${diarizationSettings.maxSpeakers} speakers`}
                    {diarizationSettings.activePreset && (
                      <span className="text-purple-500 ml-1">
                        ({diarizationSettings.activePreset})
                      </span>
                    )}
                  </>
                )}
              </span>
            </div>
          )}
        </div>
      )}

      {/* Live Speaker Detection - NO LLM, pure voice embeddings */}
      {showLiveDiarization && (
        <div className="mt-4 p-3 bg-muted/30 border border-border rounded-lg">
          <div className="flex items-center justify-between">
            {/* Current speaker indicator */}
            <div className="flex items-center gap-3">
              <Users className="h-4 w-4 text-primary" />
              <div className="flex items-center gap-2">
                {isDiarizationInitializing ? (
                  <div className="flex items-center gap-2">
                    <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                    <span className="text-sm text-muted-foreground">Detecting speakers...</span>
                  </div>
                ) : currentSpeaker ? (
                  <>
                    <div
                      className={cn(
                        'w-6 h-6 rounded-full flex items-center justify-center text-xs font-medium',
                        getSpeakerColor(currentSpeaker).avatar
                      )}
                    >
                      {parseSpeakerIndex(currentSpeaker) + 1}
                    </div>
                    <span className={cn('text-sm font-medium', getSpeakerColor(currentSpeaker).text)}>
                      {formatSpeakerLabel(currentSpeaker)}
                    </span>
                    <span className="text-xs text-muted-foreground">speaking</span>
                  </>
                ) : numSpeakers > 0 ? (
                  <span className="text-sm text-muted-foreground italic">Waiting for speech...</span>
                ) : (
                  <span className="text-sm text-muted-foreground italic">Listening for speakers...</span>
                )}
              </div>
            </div>

            {/* Speaker count */}
            {numSpeakers > 0 && (
              <div className="flex items-center gap-2">
                <span className="text-xs text-muted-foreground">{numSpeakers} speaker{numSpeakers !== 1 ? 's' : ''}</span>
                <div className="flex -space-x-1">
                  {speakerSegments
                    .filter((seg, idx, arr) => arr.findIndex(s => s.speaker === seg.speaker) === idx)
                    .slice(0, 5)
                    .map((seg) => {
                      const colors = getSpeakerColor(seg.speaker)
                      const isActive = seg.speaker === currentSpeaker
                      return (
                        <div
                          key={seg.speaker}
                          className={cn(
                            'w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-medium border-2 border-background',
                            colors.avatar,
                            isActive && 'ring-2 ring-primary ring-offset-1'
                          )}
                          title={formatSpeakerLabel(seg.speaker)}
                        >
                          {parseSpeakerIndex(seg.speaker) + 1}
                        </div>
                      )
                    })}
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Device warning banner */}
      {isRecording && deviceWarning && showWarning && (
        <div className="mt-4 bg-yellow-50 border border-yellow-200 rounded-lg p-3">
          <div className="flex items-start gap-2">
            <AlertCircle className="h-4 w-4 text-yellow-600 mt-0.5 flex-shrink-0" />
            <div className="flex-1 text-sm text-yellow-800">
              <p className="font-medium">Audio Device Notice</p>
              <p className="text-xs mt-1">{deviceWarning}</p>
            </div>
            <button
              onClick={() => setShowWarning(false)}
              className="text-yellow-600 hover:text-yellow-800"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>
      )}

      {/* Live Transcription Display */}
      {showLiveTranscript && (
        <div className="mt-4 border-t border-border pt-4">
          {/* Live Transcription Header */}
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              {liveStatus === 'starting' ? (
                <Loader2 className="h-4 w-4 text-blue-500 animate-spin" />
              ) : liveStatus === 'active' ? (
                <Radio className="h-4 w-4 text-green-500 animate-pulse" />
              ) : liveStatus === 'paused' ? (
                <Mic className="h-4 w-4 text-amber-500" />
              ) : (
                <Mic className="h-4 w-4 text-muted-foreground" />
              )}
              <span className="text-sm font-medium text-foreground">
                Live Transcription
              </span>
              {liveStatus === 'starting' && (
                <span className="text-xs text-blue-600 bg-blue-50 px-2 py-0.5 rounded-full">
                  Loading model...
                </span>
              )}
              {liveStatus === 'active' && (
                <span className="text-xs text-green-600 bg-green-50 px-2 py-0.5 rounded-full">
                  Live
                </span>
              )}
              {liveStatus === 'paused' && (
                <span className="text-xs text-amber-600 bg-amber-50 px-2 py-0.5 rounded-full">
                  Paused
                </span>
              )}
            </div>
            {liveSegments.length > 0 && (
              <span className="text-xs text-muted-foreground">
                {liveSegments.length} segment{liveSegments.length !== 1 ? 's' : ''}
              </span>
            )}
          </div>

          {/* Error Display */}
          {liveError && (
            <div className="mb-3 bg-red-50 border border-red-200 rounded-lg p-3">
              <div className="flex items-start gap-2">
                <AlertCircle className="h-4 w-4 text-red-600 mt-0.5 flex-shrink-0" />
                <div className="flex-1 text-sm text-red-800">
                  <p className="font-medium">Transcription Error</p>
                  <p className="text-xs mt-1">{liveError.message}</p>
                </div>
              </div>
            </div>
          )}

          {/* Transcript Content */}
          <div
            ref={transcriptScrollRef}
            className="bg-muted/30 rounded-lg p-3 max-h-48 overflow-y-auto"
          >
            {liveSegments.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-6 text-center">
                {liveStatus === 'starting' ? (
                  <>
                    <Loader2 className="h-8 w-8 text-blue-500 animate-spin mb-2" />
                    <p className="text-sm text-muted-foreground">
                      Loading transcription model...
                    </p>
                  </>
                ) : (
                  <>
                    <div className="relative mb-2">
                      <Mic className="h-8 w-8 text-green-500" />
                      <span className="absolute -top-1 -right-1 flex h-3 w-3">
                        <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75"></span>
                        <span className="relative inline-flex rounded-full h-3 w-3 bg-green-500"></span>
                      </span>
                    </div>
                    <p className="text-sm font-medium text-foreground">
                      Listening...
                    </p>
                    <p className="text-xs text-muted-foreground mt-1">
                      Your transcript will appear here as you speak
                    </p>
                  </>
                )}
              </div>
            ) : (
              <div className="space-y-2">
                {liveSegments.map((segment, index) => (
                  <div
                    key={segment.id}
                    className={cn(
                      'text-sm transition-opacity duration-300',
                      index === liveSegments.length - 1 ? 'text-foreground' : 'text-muted-foreground'
                    )}
                  >
                    <span className="text-xs text-muted-foreground mr-2">
                      {formatDuration(segment.start_time_ms)}
                    </span>
                    {segment.content}
                  </div>
                ))}
                {/* Active listening indicator */}
                {liveStatus === 'active' && (
                  <div className="flex items-center gap-1.5 pt-2 text-green-600">
                    <div className="flex space-x-0.5">
                      <span className="w-1.5 h-1.5 bg-green-500 rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
                      <span className="w-1.5 h-1.5 bg-green-500 rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
                      <span className="w-1.5 h-1.5 bg-green-500 rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
                    </div>
                    <span className="text-xs">Listening...</span>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Live Notes Panel - Shows real-time AI-generated meeting insights */}
      {isRecording && enableLiveNotes && meetingId && (
        <div className="mt-4 border-t border-border pt-4">
          {/* Live Notes Toggle Header */}
          <button
            onClick={() => setShowLiveNotes(!showLiveNotes)}
            className="w-full flex items-center justify-between mb-3 group"
          >
            <div className="flex items-center gap-2">
              <Sparkles className="h-4 w-4 text-purple-500" />
              <span className="text-sm font-medium text-foreground">
                Live AI Notes
              </span>
              <span className="text-xs text-purple-600 bg-purple-50 dark:bg-purple-950/30 px-2 py-0.5 rounded-full">
                Beta
              </span>
            </div>
            {showLiveNotes ? (
              <ChevronUp className="h-4 w-4 text-muted-foreground group-hover:text-foreground transition-colors" />
            ) : (
              <ChevronDown className="h-4 w-4 text-muted-foreground group-hover:text-foreground transition-colors" />
            )}
          </button>

          {/* Live Notes Panel Content */}
          {showLiveNotes && (
            <LiveNotesPanel
              meetingId={meetingId}
              isRecording={isRecording}
              enabled={enableLiveNotes}
            />
          )}
        </div>
      )}

      {/* Debug Toggle Button - Only show during recording with diarization */}
      {isRecording && enableDiarization && meetingId && (
        <button
          onClick={() => setShowDebugOverlay(!showDebugOverlay)}
          className={cn(
            'fixed bottom-4 left-4 z-40 flex items-center gap-1.5 px-2 py-1 rounded-full text-xs font-medium transition-all',
            showDebugOverlay
              ? 'bg-yellow-500 text-yellow-950 shadow-lg'
              : 'bg-slate-700 text-slate-300 hover:bg-slate-600'
          )}
          data-testid="debug-overlay-toggle"
          title="Toggle Speaker Debug Overlay"
        >
          <Bug className="w-3.5 h-3.5" />
          <span className="hidden sm:inline">Debug</span>
        </button>
      )}

      {/* Speaker Debug Overlay */}
      {isRecording && showDebugOverlay && (
        <SpeakerDebugOverlay
          visible={true}
          position="bottom-right"
          defaultExpanded={true}
          onForceRefresh={() => {
            // Force a re-render by toggling debug overlay
            setShowDebugOverlay(false)
            setTimeout(() => setShowDebugOverlay(true), 50)
          }}
        />
      )}
    </div>
  )
}
