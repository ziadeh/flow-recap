/**
 * SpeakerDebugOverlay Component
 *
 * Real-time debug overlay showing speaker detection state during live recording.
 * Displays:
 * - Current speaker count in state
 * - Last speaker event received timestamp
 * - Active speaker ID
 * - Speaker segment count
 * - Speaker change events count
 * - Store state synchronization status
 *
 * Used for debugging issues where UI is not updating despite events being received.
 */

import { memo, useState, useEffect, useCallback, useRef } from 'react'
import { Bug, ChevronDown, ChevronUp, RefreshCw, AlertTriangle, CheckCircle } from 'lucide-react'
import { cn } from '../../lib/utils'
import {
  useLiveTranscriptStore,
  useStreamingDiarizationState,
  useSpeakerSegments,
  useSpeakerChanges,
} from '../../stores/live-transcript-store'
import {
  useSpeakerNameStore,
  useCurrentSpeakerId,
  useSpeakerCount,
} from '../../stores/speaker-name-store'

// ============================================================================
// Types
// ============================================================================

export interface SpeakerDebugOverlayProps {
  /** Whether the overlay is visible */
  visible?: boolean
  /** Position of the overlay */
  position?: 'top-right' | 'top-left' | 'bottom-right' | 'bottom-left'
  /** Whether the overlay starts expanded */
  defaultExpanded?: boolean
  /** Additional class names */
  className?: string
  /** Callback for force refresh */
  onForceRefresh?: () => void
}

interface DebugStats {
  speakerCountInStore: number
  speakerNameStoreCount: number
  speakerSegmentsCount: number
  speakerChangesCount: number
  activeSpeakerId: string | null
  lastEventTimestamp: number | null
  streamingStatus: string
  coldStartComplete: boolean
  totalAudioProcessed: number
  lastRenderTime: number
  renderCount: number
  storeUpdatesReceived: number
}

// ============================================================================
// Helper Functions
// ============================================================================

function formatTimestamp(timestamp: number | null): string {
  if (!timestamp) return 'Never'
  const diff = Date.now() - timestamp
  if (diff < 1000) return 'Just now'
  if (diff < 60000) return `${Math.floor(diff / 1000)}s ago`
  return `${Math.floor(diff / 60000)}m ago`
}

function formatTime(seconds: number): string {
  const mins = Math.floor(seconds / 60)
  const secs = Math.floor(seconds % 60)
  return `${mins}:${secs.toString().padStart(2, '0')}`
}

// ============================================================================
// Component
// ============================================================================

export const SpeakerDebugOverlay = memo(function SpeakerDebugOverlay({
  visible = true,
  position = 'bottom-right',
  defaultExpanded = false,
  className,
  onForceRefresh,
}: SpeakerDebugOverlayProps) {
  const [expanded, setExpanded] = useState(defaultExpanded)
  const [renderCount, setRenderCount] = useState(0)
  const [storeUpdatesReceived, setStoreUpdatesReceived] = useState(0)
  const lastUpdateTimeRef = useRef<number | null>(null)

  // Subscribe to streaming diarization state
  const streamingState = useStreamingDiarizationState()
  const speakerSegments = useSpeakerSegments()
  const speakerChanges = useSpeakerChanges()

  // Subscribe to speaker name store
  const speakerNameMap = useSpeakerNameStore((state) => state.speakers)
  const currentSpeakerId = useCurrentSpeakerId()
  const speakerCount = useSpeakerCount()

  // Track last update time from live transcript store
  const lastUpdateTime = useLiveTranscriptStore((state) => state.lastUpdateTime)

  // Track render count and store updates
  useEffect(() => {
    setRenderCount((c) => c + 1)
  }, [streamingState, speakerSegments, speakerChanges, speakerNameMap, currentSpeakerId])

  useEffect(() => {
    if (lastUpdateTime && lastUpdateTime !== lastUpdateTimeRef.current) {
      lastUpdateTimeRef.current = lastUpdateTime
      setStoreUpdatesReceived((c) => c + 1)
    }
  }, [lastUpdateTime])

  // Calculate debug stats
  const stats: DebugStats = {
    speakerCountInStore: streamingState.numSpeakersDetected,
    speakerNameStoreCount: speakerCount,
    speakerSegmentsCount: speakerSegments.length,
    speakerChangesCount: speakerChanges.length,
    activeSpeakerId: currentSpeakerId,
    lastEventTimestamp: lastUpdateTime,
    streamingStatus: streamingState.status,
    coldStartComplete: streamingState.coldStartComplete,
    totalAudioProcessed: streamingState.totalAudioProcessed,
    lastRenderTime: Date.now(),
    renderCount,
    storeUpdatesReceived,
  }

  // Get unique speakers from segments
  const uniqueSpeakers = [...new Set(speakerSegments.map((s) => s.speaker))]

  // Force refresh handler
  const handleForceRefresh = useCallback(() => {
    console.log('[SpeakerDebugOverlay] Force refresh triggered')
    setRenderCount((c) => c + 1)
    onForceRefresh?.()
  }, [onForceRefresh])

  if (!visible) return null

  // Position classes
  const positionClasses = {
    'top-right': 'top-4 right-4',
    'top-left': 'top-4 left-4',
    'bottom-right': 'bottom-4 right-4',
    'bottom-left': 'bottom-4 left-4',
  }

  // Status indicators
  const isActive = streamingState.status === 'active' || streamingState.status === 'ready'
  const hasIssues = (
    (isActive && speakerSegments.length === 0 && streamingState.totalAudioProcessed > 5) ||
    (streamingState.status === 'error')
  )

  return (
    <div
      className={cn(
        'fixed z-50 bg-slate-900/95 text-white rounded-lg shadow-xl border border-slate-700',
        'font-mono text-xs',
        positionClasses[position],
        className
      )}
      data-testid="speaker-debug-overlay"
    >
      {/* Header */}
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex items-center gap-2 px-3 py-2 w-full hover:bg-slate-800/50 rounded-t-lg"
      >
        <Bug className="w-4 h-4 text-yellow-400" />
        <span className="font-semibold">Speaker Debug</span>
        {hasIssues && (
          <AlertTriangle className="w-3 h-3 text-yellow-500 animate-pulse" />
        )}
        {isActive && !hasIssues && (
          <CheckCircle className="w-3 h-3 text-green-500" />
        )}
        <span className="flex-1" />
        {expanded ? (
          <ChevronUp className="w-4 h-4" />
        ) : (
          <ChevronDown className="w-4 h-4" />
        )}
      </button>

      {/* Quick Stats (always visible) */}
      <div className="px-3 py-1 border-t border-slate-700/50 flex items-center gap-4 text-[10px]">
        <span className="text-slate-400">
          Speakers: <span className="text-cyan-400 font-bold">{stats.speakerCountInStore}</span>
        </span>
        <span className="text-slate-400">
          Active: <span className={cn(
            'font-bold',
            stats.activeSpeakerId ? 'text-green-400' : 'text-slate-500'
          )}>
            {stats.activeSpeakerId || 'None'}
          </span>
        </span>
        <span className="text-slate-400">
          Last: <span className="text-purple-400">{formatTimestamp(stats.lastEventTimestamp)}</span>
        </span>
      </div>

      {/* Expanded Details */}
      {expanded && (
        <div className="px-3 py-2 border-t border-slate-700/50 space-y-2">
          {/* Status Section */}
          <div className="space-y-1">
            <div className="text-slate-400 text-[10px] uppercase tracking-wider">Status</div>
            <div className="grid grid-cols-2 gap-2 text-[11px]">
              <div>
                <span className="text-slate-500">Streaming: </span>
                <span className={cn(
                  isActive ? 'text-green-400' : 'text-slate-400',
                  streamingState.status === 'error' && 'text-red-400'
                )}>
                  {stats.streamingStatus}
                </span>
              </div>
              <div>
                <span className="text-slate-500">Cold Start: </span>
                <span className={stats.coldStartComplete ? 'text-green-400' : 'text-yellow-400'}>
                  {stats.coldStartComplete ? 'Complete' : 'Pending'}
                </span>
              </div>
            </div>
          </div>

          {/* Counts Section */}
          <div className="space-y-1">
            <div className="text-slate-400 text-[10px] uppercase tracking-wider">Counts</div>
            <div className="grid grid-cols-2 gap-2 text-[11px]">
              <div>
                <span className="text-slate-500">Segments: </span>
                <span className="text-cyan-400">{stats.speakerSegmentsCount}</span>
              </div>
              <div>
                <span className="text-slate-500">Changes: </span>
                <span className="text-cyan-400">{stats.speakerChangesCount}</span>
              </div>
              <div>
                <span className="text-slate-500">Name Store: </span>
                <span className="text-cyan-400">{stats.speakerNameStoreCount}</span>
              </div>
              <div>
                <span className="text-slate-500">Audio: </span>
                <span className="text-cyan-400">{formatTime(stats.totalAudioProcessed)}</span>
              </div>
            </div>
          </div>

          {/* Unique Speakers */}
          {uniqueSpeakers.length > 0 && (
            <div className="space-y-1">
              <div className="text-slate-400 text-[10px] uppercase tracking-wider">Speakers</div>
              <div className="flex flex-wrap gap-1">
                {uniqueSpeakers.map((speaker) => (
                  <span
                    key={speaker}
                    className={cn(
                      'px-1.5 py-0.5 rounded text-[10px]',
                      speaker === stats.activeSpeakerId
                        ? 'bg-green-500/20 text-green-400 ring-1 ring-green-500'
                        : 'bg-slate-700 text-slate-300'
                    )}
                  >
                    {speaker}
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* Render Stats */}
          <div className="space-y-1">
            <div className="text-slate-400 text-[10px] uppercase tracking-wider">React State</div>
            <div className="grid grid-cols-2 gap-2 text-[11px]">
              <div>
                <span className="text-slate-500">Renders: </span>
                <span className="text-orange-400">{stats.renderCount}</span>
              </div>
              <div>
                <span className="text-slate-500">Updates: </span>
                <span className="text-orange-400">{stats.storeUpdatesReceived}</span>
              </div>
            </div>
          </div>

          {/* Diagnostic Warnings */}
          {hasIssues && (
            <div className="space-y-1">
              <div className="text-yellow-400 text-[10px] uppercase tracking-wider">Warnings</div>
              <div className="text-[11px] text-yellow-300 bg-yellow-500/10 p-2 rounded">
                {streamingState.status === 'error' && (
                  <div>Diarization error: {streamingState.error || 'Unknown error'}</div>
                )}
                {isActive && speakerSegments.length === 0 && streamingState.totalAudioProcessed > 5 && (
                  <div>No speaker segments received after {formatTime(streamingState.totalAudioProcessed)} of audio</div>
                )}
              </div>
            </div>
          )}

          {/* Actions */}
          <div className="pt-1 border-t border-slate-700/50">
            <button
              onClick={handleForceRefresh}
              className="flex items-center gap-1 px-2 py-1 text-[10px] bg-slate-700 hover:bg-slate-600 rounded"
            >
              <RefreshCw className="w-3 h-3" />
              Force Refresh
            </button>
          </div>
        </div>
      )}
    </div>
  )
})

export default SpeakerDebugOverlay
