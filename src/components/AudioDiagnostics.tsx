/**
 * Audio Diagnostics Component
 *
 * Displays audio setup status and virtual cable detection results.
 * Provides diagnostic feedback on audio configuration.
 */

import { useState, useEffect, useCallback } from 'react'
import { cn } from '@/lib/utils'
import {
  CheckCircle,
  XCircle,
  AlertTriangle,
  RefreshCw,
  ChevronDown,
  ChevronUp,
  Mic,
  Volume2,
  Cable,
  Info,
  ExternalLink
} from 'lucide-react'
import type {
  AudioDiagnosticResult,
  AudioDevice,
  VirtualCableInfo,
  DiagnosticMessage,
  DiagnosticStatus
} from '@/types/database'

// ============================================================================
// Types
// ============================================================================

interface AudioDiagnosticsProps {
  className?: string
  onDiagnosticsComplete?: (result: AudioDiagnosticResult) => void
  autoRun?: boolean
}

// ============================================================================
// Status Badge Component
// ============================================================================

interface StatusBadgeProps {
  status: DiagnosticStatus
  className?: string
}

function StatusBadge({ status, className }: StatusBadgeProps) {
  const config = {
    ok: {
      icon: CheckCircle,
      color: 'text-green-600 bg-green-50 border-green-200',
      label: 'Ready'
    },
    warning: {
      icon: AlertTriangle,
      color: 'text-yellow-600 bg-yellow-50 border-yellow-200',
      label: 'Warning'
    },
    error: {
      icon: XCircle,
      color: 'text-red-600 bg-red-50 border-red-200',
      label: 'Error'
    },
    not_checked: {
      icon: Info,
      color: 'text-gray-600 bg-gray-50 border-gray-200',
      label: 'Not Checked'
    }
  }

  const { icon: Icon, color, label } = config[status]

  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium border',
        color,
        className
      )}
    >
      <Icon className="h-3.5 w-3.5" />
      {label}
    </span>
  )
}

// ============================================================================
// Message Item Component
// ============================================================================

interface MessageItemProps {
  message: DiagnosticMessage
}

function MessageItem({ message }: MessageItemProps) {
  const config = {
    info: {
      icon: Info,
      color: 'text-blue-600 bg-blue-50 border-blue-200'
    },
    warning: {
      icon: AlertTriangle,
      color: 'text-yellow-600 bg-yellow-50 border-yellow-200'
    },
    error: {
      icon: XCircle,
      color: 'text-red-600 bg-red-50 border-red-200'
    },
    success: {
      icon: CheckCircle,
      color: 'text-green-600 bg-green-50 border-green-200'
    }
  }

  const { icon: Icon, color } = config[message.level]

  return (
    <div className={cn('p-3 rounded-lg border', color)}>
      <div className="flex items-start gap-2">
        <Icon className="h-4 w-4 mt-0.5 flex-shrink-0" />
        <div className="flex-1">
          <p className="text-sm font-medium">{message.message}</p>
          {message.suggestion && (
            <p className="mt-1 text-xs opacity-80">{message.suggestion}</p>
          )}
        </div>
      </div>
    </div>
  )
}

// ============================================================================
// Virtual Cable Card Component
// ============================================================================

interface VirtualCableCardProps {
  cable: VirtualCableInfo
  isRecommended: boolean
  onShowInstructions?: () => void
}

function VirtualCableCard({ cable, isRecommended, onShowInstructions }: VirtualCableCardProps) {
  return (
    <div
      className={cn(
        'p-4 rounded-lg border',
        cable.detected
          ? 'bg-green-50 border-green-200'
          : 'bg-gray-50 border-gray-200'
      )}
    >
      <div className="flex items-start justify-between">
        <div className="flex items-center gap-3">
          <div
            className={cn(
              'p-2 rounded-full',
              cable.detected ? 'bg-green-100' : 'bg-gray-100'
            )}
          >
            <Cable
              className={cn(
                'h-5 w-5',
                cable.detected ? 'text-green-600' : 'text-gray-400'
              )}
            />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h4 className="font-medium text-sm">{cable.name}</h4>
              {isRecommended && (
                <span className="text-xs bg-purple-100 text-purple-700 px-2 py-0.5 rounded-full">
                  Recommended
                </span>
              )}
            </div>
            <p className="text-xs text-muted-foreground mt-0.5">
              {cable.detected ? 'Installed and ready' : 'Not installed'}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {cable.detected ? (
            <CheckCircle className="h-5 w-5 text-green-600" />
          ) : (
            <button
              onClick={onShowInstructions}
              className="text-xs text-purple-600 hover:text-purple-700 flex items-center gap-1"
            >
              Install <ExternalLink className="h-3 w-3" />
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

// ============================================================================
// Device List Component
// ============================================================================

interface DeviceListProps {
  title: string
  icon: React.ReactNode
  devices: AudioDevice[]
  emptyMessage: string
}

function DeviceList({ title, icon, devices, emptyMessage }: DeviceListProps) {
  const [expanded, setExpanded] = useState(false)

  return (
    <div className="border rounded-lg">
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center justify-between p-3 hover:bg-accent/50 transition-colors"
      >
        <div className="flex items-center gap-2">
          {icon}
          <span className="font-medium text-sm">{title}</span>
          <span className="text-xs text-muted-foreground">({devices.length})</span>
        </div>
        {expanded ? (
          <ChevronUp className="h-4 w-4 text-muted-foreground" />
        ) : (
          <ChevronDown className="h-4 w-4 text-muted-foreground" />
        )}
      </button>
      {expanded && (
        <div className="border-t p-3 space-y-2">
          {devices.length === 0 ? (
            <p className="text-sm text-muted-foreground">{emptyMessage}</p>
          ) : (
            devices.map((device) => (
              <div
                key={device.id}
                className="flex items-center justify-between p-2 bg-secondary/50 rounded"
              >
                <div className="flex items-center gap-2">
                  <span className="text-sm">{device.name}</span>
                  {device.isDefault && (
                    <span className="text-xs bg-blue-100 text-blue-700 px-1.5 py-0.5 rounded">
                      Default
                    </span>
                  )}
                  {device.isVirtual && (
                    <span className="text-xs bg-purple-100 text-purple-700 px-1.5 py-0.5 rounded">
                      Virtual
                    </span>
                  )}
                </div>
              </div>
            ))
          )}
        </div>
      )}
    </div>
  )
}

// ============================================================================
// Installation Instructions Modal
// ============================================================================

interface InstallationModalProps {
  isOpen: boolean
  onClose: () => void
  instructions: string
  cableName: string
}

function InstallationModal({ isOpen, onClose, instructions, cableName }: InstallationModalProps) {
  if (!isOpen) return null

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-card rounded-lg shadow-xl max-w-lg w-full mx-4 max-h-[80vh] overflow-hidden">
        <div className="p-4 border-b flex items-center justify-between">
          <h3 className="font-semibold">Install {cableName}</h3>
          <button
            onClick={onClose}
            className="p-1 hover:bg-accent rounded"
          >
            <XCircle className="h-5 w-5 text-muted-foreground" />
          </button>
        </div>
        <div className="p-4 overflow-y-auto max-h-[60vh]">
          <pre className="whitespace-pre-wrap text-sm bg-secondary/50 p-4 rounded-lg font-mono">
            {instructions}
          </pre>
        </div>
        <div className="p-4 border-t flex justify-end">
          <button
            onClick={onClose}
            className="px-4 py-2 bg-primary text-primary-foreground rounded-md text-sm font-medium hover:bg-primary/90"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  )
}

// ============================================================================
// Main AudioDiagnostics Component
// ============================================================================

export function AudioDiagnostics({
  className,
  onDiagnosticsComplete,
  autoRun = true
}: AudioDiagnosticsProps) {
  const [diagnosticResult, setDiagnosticResult] = useState<AudioDiagnosticResult | null>(null)
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [installModalOpen, setInstallModalOpen] = useState(false)
  const [installInstructions, setInstallInstructions] = useState('')
  const [installCableName, setInstallCableName] = useState('')

  const runDiagnostics = useCallback(async () => {
    setIsLoading(true)
    setError(null)

    try {
      const result = await window.electronAPI.audioDevices.runDiagnostics()
      setDiagnosticResult(result)
      onDiagnosticsComplete?.(result)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to run diagnostics')
    } finally {
      setIsLoading(false)
    }
  }, [onDiagnosticsComplete])

  const showInstallInstructions = useCallback(async (cableName: string) => {
    try {
      const instructions = await window.electronAPI.audioDevices.getInstallationInstructions()
      setInstallInstructions(instructions)
      setInstallCableName(cableName)
      setInstallModalOpen(true)
    } catch (err) {
      console.error('Failed to get installation instructions:', err)
    }
  }, [])

  useEffect(() => {
    if (autoRun) {
      runDiagnostics()
    }
  }, [autoRun, runDiagnostics])

  return (
    <div className={cn('bg-card rounded-lg border shadow-sm', className)}>
      {/* Header */}
      <div className="p-4 border-b flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="p-2 bg-purple-100 rounded-lg">
            <Mic className="h-5 w-5 text-purple-600" />
          </div>
          <div>
            <h3 className="font-semibold">Audio Setup Diagnostics</h3>
            <p className="text-xs text-muted-foreground">
              Check your audio configuration for meeting recording
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {diagnosticResult && (
            <StatusBadge status={diagnosticResult.overallStatus} />
          )}
          <button
            onClick={runDiagnostics}
            disabled={isLoading}
            className={cn(
              'p-2 rounded-md hover:bg-accent transition-colors',
              isLoading && 'opacity-50 cursor-not-allowed'
            )}
            title="Refresh diagnostics"
          >
            <RefreshCw
              className={cn('h-4 w-4 text-muted-foreground', isLoading && 'animate-spin')}
            />
          </button>
        </div>
      </div>

      {/* Content */}
      <div className="p-4 space-y-4">
        {error && (
          <div className="p-3 bg-red-50 border border-red-200 rounded-lg">
            <div className="flex items-center gap-2 text-red-600">
              <XCircle className="h-4 w-4" />
              <span className="text-sm font-medium">{error}</span>
            </div>
          </div>
        )}

        {isLoading && !diagnosticResult && (
          <div className="flex items-center justify-center py-8">
            <RefreshCw className="h-6 w-6 animate-spin text-muted-foreground" />
            <span className="ml-2 text-sm text-muted-foreground">Running diagnostics...</span>
          </div>
        )}

        {diagnosticResult && (
          <>
            {/* Messages */}
            {diagnosticResult.messages.length > 0 && (
              <div className="space-y-2">
                {diagnosticResult.messages.map((msg, idx) => (
                  <MessageItem key={`${msg.code}-${idx}`} message={msg} />
                ))}
              </div>
            )}

            {/* Virtual Cables */}
            <div className="space-y-2">
              <h4 className="text-sm font-medium text-muted-foreground">Virtual Audio Cables</h4>
              {diagnosticResult.virtualCables.map((cable) => (
                <VirtualCableCard
                  key={cable.type}
                  cable={cable}
                  isRecommended={cable.type === diagnosticResult.recommendedVirtualCable}
                  onShowInstructions={() => showInstallInstructions(cable.name)}
                />
              ))}
            </div>

            {/* Device Lists */}
            <div className="space-y-2">
              <DeviceList
                title="Input Devices"
                icon={<Mic className="h-4 w-4 text-muted-foreground" />}
                devices={diagnosticResult.inputDevices}
                emptyMessage="No input devices found"
              />
              <DeviceList
                title="Output Devices"
                icon={<Volume2 className="h-4 w-4 text-muted-foreground" />}
                devices={diagnosticResult.outputDevices}
                emptyMessage="No output devices found"
              />
            </div>

            {/* Platform Info */}
            <div className="pt-2 border-t text-xs text-muted-foreground">
              <p>
                Platform: <span className="font-medium">{diagnosticResult.platform}</span>
                {' • '}
                Last checked: <span className="font-medium">
                  {new Date(diagnosticResult.timestamp).toLocaleTimeString()}
                </span>
              </p>
            </div>
          </>
        )}
      </div>

      {/* Installation Modal */}
      <InstallationModal
        isOpen={installModalOpen}
        onClose={() => setInstallModalOpen(false)}
        instructions={installInstructions}
        cableName={installCableName}
      />
    </div>
  )
}

export default AudioDiagnostics
