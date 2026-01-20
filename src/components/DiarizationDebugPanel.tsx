/**
 * Diarization Debug Panel Component
 *
 * A comprehensive debug panel for diagnosing why only one speaker appears
 * during live recording despite multiple speakers being present.
 *
 * Displays:
 * - Current speakers detected
 * - Last speaker change timestamp
 * - Diarization confidence scores
 * - Audio processing status
 * - Real-time event log
 */

import { useState, useEffect, useCallback, useMemo } from 'react'
import { cn } from '@/lib/utils'
import {
  Bug,
  Activity,
  Users,
  Clock,
  BarChart2,
  RefreshCw,
  Power,
  PowerOff,
  ChevronDown,
  ChevronUp,
  Volume2,
  Zap,
  AlertTriangle
} from 'lucide-react'

// ============================================================================
// Types (mirrored from preload.ts)
// ============================================================================

interface AudioChunkMetrics {
  timestamp: number
  chunkSize: number
  sampleRate: number
  rmsLevel: number
  peakLevel: number
  sentToDiarization: boolean
  processingTimeMs?: number
}

interface SpeakerSegmentDebug {
  timestamp: number
  segmentId: string
  speaker: string
  startTime: number
  endTime: number
  confidence: number
  isFinal: boolean
  wasRetroactivelyCorrected?: boolean
  processingLatencyMs?: number
}

interface SpeakerChangeDebug {
  timestamp: number
  time: number
  fromSpeaker: string | null
  toSpeaker: string
  confidence: number
  eventFired: boolean
  sentToRenderer: boolean
}

interface IPCEventDebug {
  timestamp: number
  eventName: string
  eventData: any
  success: boolean
  error?: string
}

interface PyAnnoteOutputDebug {
  timestamp: number
  outputType: 'embedding' | 'clustering' | 'speaker_change' | 'segment' | 'stats' | 'ready' | 'error'
  success: boolean
  data?: any
  error?: string
  processingTimeMs?: number
}

interface DebugSnapshot {
  timestamp: number
  sessionId: string | null
  meetingId: string | null
  isActive: boolean
  speakersDetected: string[]
  currentSpeaker: string | null
  lastSpeakerChangeTimestamp: number | null
  speakerChangeCount: number
  totalAudioChunksProcessed: number
  totalAudioDurationSec: number
  lastAudioChunkTimestamp: number | null
  averageRmsLevel: number
  averagePeakLevel: number
  diarizationStatus: string
  coldStartComplete: boolean
  totalSegmentsEmitted: number
  lastSegmentTimestamp: number | null
  totalIPCEventsEmitted: number
  lastIPCEventTimestamp: number | null
  ipcErrors: number
  averageConfidence: number
  minConfidence: number
  maxConfidence: number
  recentAudioChunks: AudioChunkMetrics[]
  recentSpeakerSegments: SpeakerSegmentDebug[]
  recentSpeakerChanges: SpeakerChangeDebug[]
  recentIPCEvents: IPCEventDebug[]
  recentPyAnnoteOutputs: PyAnnoteOutputDebug[]
}

// ============================================================================
// Component Props
// ============================================================================

interface DiarizationDebugPanelProps {
  className?: string
}

// ============================================================================
// Utility Functions
// ============================================================================

function formatTimestamp(ts: number | null): string {
  if (!ts) return 'N/A'
  return new Date(ts).toLocaleTimeString()
}

function formatDuration(seconds: number): string {
  if (seconds < 60) return `${seconds.toFixed(1)}s`
  const mins = Math.floor(seconds / 60)
  const secs = (seconds % 60).toFixed(1)
  return `${mins}m ${secs}s`
}

function getStatusColor(status: string): string {
  switch (status) {
    case 'active':
    case 'ready':
      return 'text-green-600 bg-green-100'
    case 'initializing':
    case 'paused':
      return 'text-yellow-600 bg-yellow-100'
    case 'error':
      return 'text-red-600 bg-red-100'
    default:
      return 'text-gray-600 bg-gray-100'
  }
}

function getConfidenceColor(confidence: number): string {
  if (confidence >= 0.8) return 'text-green-600'
  if (confidence >= 0.5) return 'text-yellow-600'
  return 'text-red-600'
}

// ============================================================================
// Sub-components
// ============================================================================

function StatCard({
  icon: Icon,
  label,
  value,
  subValue,
  className
}: {
  icon: React.ElementType
  label: string
  value: string | number
  subValue?: string
  className?: string
}) {
  return (
    <div className={cn('bg-card border border-border rounded-lg p-3', className)}>
      <div className="flex items-center gap-2 text-muted-foreground mb-1">
        <Icon className="h-4 w-4" />
        <span className="text-xs font-medium">{label}</span>
      </div>
      <div className="text-lg font-semibold text-foreground">{value}</div>
      {subValue && (
        <div className="text-xs text-muted-foreground mt-1">{subValue}</div>
      )}
    </div>
  )
}

function ExpandableSection({
  title,
  icon: Icon,
  children,
  defaultExpanded = false,
  badge
}: {
  title: string
  icon: React.ElementType
  children: React.ReactNode
  defaultExpanded?: boolean
  badge?: string | number
}) {
  const [isExpanded, setIsExpanded] = useState(defaultExpanded)

  return (
    <div className="bg-card border border-border rounded-lg overflow-hidden">
      <button
        onClick={() => setIsExpanded(!isExpanded)}
        className="w-full px-4 py-3 flex items-center justify-between hover:bg-accent/50 transition-colors"
      >
        <div className="flex items-center gap-2">
          <Icon className="h-4 w-4 text-muted-foreground" />
          <span className="font-medium text-sm">{title}</span>
          {badge !== undefined && (
            <span className="px-2 py-0.5 bg-purple-100 text-purple-700 text-xs rounded-full">
              {badge}
            </span>
          )}
        </div>
        {isExpanded ? (
          <ChevronUp className="h-4 w-4 text-muted-foreground" />
        ) : (
          <ChevronDown className="h-4 w-4 text-muted-foreground" />
        )}
      </button>
      {isExpanded && (
        <div className="px-4 pb-4 border-t border-border">
          {children}
        </div>
      )}
    </div>
  )
}

function EventLog({
  events,
  renderEvent
}: {
  events: any[]
  renderEvent: (event: any, index: number) => React.ReactNode
}) {
  if (events.length === 0) {
    return (
      <div className="text-center text-muted-foreground text-sm py-4">
        No events yet
      </div>
    )
  }

  return (
    <div className="max-h-48 overflow-y-auto space-y-2 mt-3">
      {events.slice().reverse().slice(0, 20).map((event, index) => renderEvent(event, index))}
    </div>
  )
}

// ============================================================================
// Main Component
// ============================================================================

export function DiarizationDebugPanel({ className }: DiarizationDebugPanelProps) {
  const [isEnabled, setIsEnabled] = useState(false)
  const [snapshot, setSnapshot] = useState<DebugSnapshot | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [autoRefresh, setAutoRefresh] = useState(true)

  // Get electron API
  const electronAPI = useMemo(() => {
    return (window as any).electronAPI?.diarizationDebug
  }, [])

  // Check if debug is enabled on mount
  useEffect(() => {
    if (!electronAPI) {
      setIsLoading(false)
      return
    }

    electronAPI.isEnabled().then((enabled: boolean) => {
      setIsEnabled(enabled)
      setIsLoading(false)
    }).catch(() => {
      setIsLoading(false)
    })
  }, [electronAPI])

  // Subscribe to snapshot updates
  useEffect(() => {
    if (!electronAPI || !isEnabled) return

    const unsubscribe = electronAPI.onSnapshot((newSnapshot: DebugSnapshot) => {
      setSnapshot(newSnapshot)
    })

    return () => {
      unsubscribe()
    }
  }, [electronAPI, isEnabled])

  // Auto-refresh snapshot
  useEffect(() => {
    if (!electronAPI || !isEnabled || !autoRefresh) return

    const fetchSnapshot = () => {
      electronAPI.getSnapshot().then((newSnapshot: DebugSnapshot) => {
        setSnapshot(newSnapshot)
      }).catch(console.error)
    }

    fetchSnapshot()
    const interval = setInterval(fetchSnapshot, 1000)

    return () => clearInterval(interval)
  }, [electronAPI, isEnabled, autoRefresh])

  // Toggle debug mode
  const toggleDebug = useCallback(async () => {
    if (!electronAPI) return

    try {
      if (isEnabled) {
        await electronAPI.disable()
        setIsEnabled(false)
        setSnapshot(null)
      } else {
        await electronAPI.enable()
        setIsEnabled(true)
      }
    } catch (error) {
      console.error('Failed to toggle debug mode:', error)
    }
  }, [electronAPI, isEnabled])

  // Manual refresh
  const refreshSnapshot = useCallback(async () => {
    if (!electronAPI || !isEnabled) return

    try {
      const newSnapshot = await electronAPI.getSnapshot()
      setSnapshot(newSnapshot)
    } catch (error) {
      console.error('Failed to refresh snapshot:', error)
    }
  }, [electronAPI, isEnabled])

  if (!electronAPI) {
    return (
      <div className={cn('p-4 bg-yellow-50 rounded-lg', className)}>
        <div className="flex items-center gap-2 text-yellow-700">
          <AlertTriangle className="h-5 w-5" />
          <span>Debug API not available</span>
        </div>
      </div>
    )
  }

  if (isLoading) {
    return (
      <div className={cn('p-4 text-center text-muted-foreground', className)}>
        Loading debug panel...
      </div>
    )
  }

  return (
    <div className={cn('space-y-4', className)} data-testid="diarization-debug-panel">
      {/* Header with controls */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Bug className="h-5 w-5 text-purple-600" />
          <h3 className="font-semibold text-foreground">Diarization Debug</h3>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setAutoRefresh(!autoRefresh)}
            className={cn(
              'p-2 rounded-lg transition-colors',
              autoRefresh ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'
            )}
            title={autoRefresh ? 'Auto-refresh ON' : 'Auto-refresh OFF'}
          >
            <RefreshCw className={cn('h-4 w-4', autoRefresh && 'animate-spin')} />
          </button>
          <button
            onClick={refreshSnapshot}
            className="p-2 bg-gray-100 rounded-lg hover:bg-gray-200 transition-colors"
            title="Refresh now"
            disabled={!isEnabled}
          >
            <Activity className="h-4 w-4" />
          </button>
          <button
            onClick={toggleDebug}
            className={cn(
              'flex items-center gap-2 px-3 py-2 rounded-lg transition-colors',
              isEnabled
                ? 'bg-red-100 text-red-700 hover:bg-red-200'
                : 'bg-green-100 text-green-700 hover:bg-green-200'
            )}
          >
            {isEnabled ? (
              <>
                <PowerOff className="h-4 w-4" />
                <span className="text-sm">Disable</span>
              </>
            ) : (
              <>
                <Power className="h-4 w-4" />
                <span className="text-sm">Enable</span>
              </>
            )}
          </button>
        </div>
      </div>

      {!isEnabled ? (
        <div className="p-4 bg-gray-50 rounded-lg text-center text-muted-foreground">
          <p>Debug logging is disabled.</p>
          <p className="text-sm mt-1">Enable it to see real-time diarization diagnostics.</p>
        </div>
      ) : !snapshot ? (
        <div className="p-4 bg-gray-50 rounded-lg text-center text-muted-foreground">
          <p>Waiting for data...</p>
          <p className="text-sm mt-1">Start a recording to see debug information.</p>
        </div>
      ) : (
        <>
          {/* Status overview */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <StatCard
              icon={Activity}
              label="Status"
              value={snapshot.diarizationStatus}
              className={getStatusColor(snapshot.diarizationStatus)}
            />
            <StatCard
              icon={Users}
              label="Speakers"
              value={snapshot.speakersDetected.length}
              subValue={snapshot.speakersDetected.join(', ') || 'None'}
            />
            <StatCard
              icon={Clock}
              label="Audio Processed"
              value={formatDuration(snapshot.totalAudioDurationSec)}
              subValue={`${snapshot.totalAudioChunksProcessed} chunks`}
            />
            <StatCard
              icon={BarChart2}
              label="Avg Confidence"
              value={snapshot.averageConfidence.toFixed(2)}
              subValue={`Min: ${snapshot.minConfidence.toFixed(2)} / Max: ${snapshot.maxConfidence.toFixed(2)}`}
              className={getConfidenceColor(snapshot.averageConfidence)}
            />
          </div>

          {/* Current speaker and speaker changes */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="bg-card border border-border rounded-lg p-4">
              <h4 className="font-medium text-sm mb-2 flex items-center gap-2">
                <Users className="h-4 w-4 text-purple-600" />
                Current Speaker
              </h4>
              <div className="text-2xl font-bold text-purple-600">
                {snapshot.currentSpeaker || 'None'}
              </div>
              <div className="text-xs text-muted-foreground mt-1">
                Last change: {formatTimestamp(snapshot.lastSpeakerChangeTimestamp)}
              </div>
              <div className="text-xs text-muted-foreground">
                Total changes: {snapshot.speakerChangeCount}
              </div>
            </div>

            <div className="bg-card border border-border rounded-lg p-4">
              <h4 className="font-medium text-sm mb-2 flex items-center gap-2">
                <Volume2 className="h-4 w-4 text-purple-600" />
                Audio Quality
              </h4>
              <div className="space-y-2">
                <div className="flex justify-between items-center">
                  <span className="text-sm text-muted-foreground">RMS Level</span>
                  <span className={cn(
                    'font-mono text-sm',
                    snapshot.averageRmsLevel > 0.01 ? 'text-green-600' : 'text-red-600'
                  )}>
                    {snapshot.averageRmsLevel.toFixed(4)}
                  </span>
                </div>
                <div className="w-full bg-gray-200 rounded-full h-2">
                  <div
                    className="bg-green-600 h-2 rounded-full"
                    style={{ width: `${Math.min(100, snapshot.averageRmsLevel * 1000)}%` }}
                  />
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-sm text-muted-foreground">Peak Level</span>
                  <span className="font-mono text-sm">
                    {snapshot.averagePeakLevel.toFixed(4)}
                  </span>
                </div>
              </div>
            </div>
          </div>

          {/* Session info */}
          <div className="bg-card border border-border rounded-lg p-4">
            <h4 className="font-medium text-sm mb-2 flex items-center gap-2">
              <Zap className="h-4 w-4 text-purple-600" />
              Session Info
            </h4>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
              <div>
                <div className="text-muted-foreground">Session ID</div>
                <div className="font-mono text-xs truncate">{snapshot.sessionId || 'N/A'}</div>
              </div>
              <div>
                <div className="text-muted-foreground">Meeting ID</div>
                <div className="font-mono text-xs truncate">{snapshot.meetingId || 'N/A'}</div>
              </div>
              <div>
                <div className="text-muted-foreground">Cold Start</div>
                <div className={cn(
                  'font-medium',
                  snapshot.coldStartComplete ? 'text-green-600' : 'text-yellow-600'
                )}>
                  {snapshot.coldStartComplete ? 'Complete' : 'In Progress'}
                </div>
              </div>
              <div>
                <div className="text-muted-foreground">IPC Errors</div>
                <div className={cn(
                  'font-medium',
                  snapshot.ipcErrors > 0 ? 'text-red-600' : 'text-green-600'
                )}>
                  {snapshot.ipcErrors}
                </div>
              </div>
            </div>
          </div>

          {/* Recent events */}
          <ExpandableSection
            title="Recent Speaker Changes"
            icon={Users}
            badge={snapshot.recentSpeakerChanges.length}
          >
            <EventLog
              events={snapshot.recentSpeakerChanges}
              renderEvent={(event: SpeakerChangeDebug, index) => (
                <div key={index} className="bg-gray-50 rounded p-2 text-xs">
                  <div className="flex justify-between">
                    <span className="font-medium">
                      {event.fromSpeaker || 'none'} → {event.toSpeaker}
                    </span>
                    <span className="text-muted-foreground">
                      {formatTimestamp(event.timestamp)}
                    </span>
                  </div>
                  <div className="text-muted-foreground mt-1">
                    Time: {event.time.toFixed(2)}s | Confidence: {event.confidence.toFixed(2)}
                  </div>
                </div>
              )}
            />
          </ExpandableSection>

          <ExpandableSection
            title="Recent Speaker Segments"
            icon={BarChart2}
            badge={snapshot.recentSpeakerSegments.length}
          >
            <EventLog
              events={snapshot.recentSpeakerSegments}
              renderEvent={(event: SpeakerSegmentDebug, index) => (
                <div key={index} className="bg-gray-50 rounded p-2 text-xs">
                  <div className="flex justify-between">
                    <span className="font-medium">{event.speaker}</span>
                    <span className="text-muted-foreground">
                      {formatTimestamp(event.timestamp)}
                    </span>
                  </div>
                  <div className="text-muted-foreground mt-1">
                    {event.startTime.toFixed(2)}s - {event.endTime.toFixed(2)}s |
                    Confidence: {event.confidence.toFixed(2)} |
                    {event.isFinal ? ' Final' : ' Interim'}
                    {event.wasRetroactivelyCorrected && ' (Corrected)'}
                  </div>
                </div>
              )}
            />
          </ExpandableSection>

          <ExpandableSection
            title="Recent IPC Events"
            icon={Zap}
            badge={snapshot.recentIPCEvents.length}
          >
            <EventLog
              events={snapshot.recentIPCEvents}
              renderEvent={(event: IPCEventDebug, index) => (
                <div key={index} className={cn(
                  'rounded p-2 text-xs',
                  event.success ? 'bg-gray-50' : 'bg-red-50'
                )}>
                  <div className="flex justify-between">
                    <span className="font-medium font-mono">{event.eventName}</span>
                    <span className="text-muted-foreground">
                      {formatTimestamp(event.timestamp)}
                    </span>
                  </div>
                  {event.error && (
                    <div className="text-red-600 mt-1">Error: {event.error}</div>
                  )}
                </div>
              )}
            />
          </ExpandableSection>

          <ExpandableSection
            title="PyAnnote Outputs"
            icon={Activity}
            badge={snapshot.recentPyAnnoteOutputs.length}
          >
            <EventLog
              events={snapshot.recentPyAnnoteOutputs}
              renderEvent={(event: PyAnnoteOutputDebug, index) => (
                <div key={index} className={cn(
                  'rounded p-2 text-xs',
                  event.success ? 'bg-gray-50' : 'bg-red-50'
                )}>
                  <div className="flex justify-between">
                    <span className="font-medium">{event.outputType}</span>
                    <span className="text-muted-foreground">
                      {formatTimestamp(event.timestamp)}
                    </span>
                  </div>
                  {event.processingTimeMs !== undefined && (
                    <div className="text-muted-foreground mt-1">
                      Processing time: {event.processingTimeMs}ms
                    </div>
                  )}
                  {event.error && (
                    <div className="text-red-600 mt-1">Error: {event.error}</div>
                  )}
                </div>
              )}
            />
          </ExpandableSection>
        </>
      )}
    </div>
  )
}

export default DiarizationDebugPanel
