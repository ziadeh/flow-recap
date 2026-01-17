/**
 * SpeakerDiarizationSettings Component
 *
 * Comprehensive settings panel for configuring automatic speaker diarization
 * behavior and troubleshooting issues.
 *
 * Features:
 * - Enable/Disable automatic diarization
 * - Speaker count hints (Auto-detect, Fixed count, Range)
 * - Name extraction settings with confidence threshold
 * - Clustering sensitivity slider
 * - Audio quality optimization
 * - Diagnostics panel with system status and logs
 * - Presets for common meeting types
 */

import { useState, useEffect, useCallback, useRef } from 'react'
import {
  Users,
  RefreshCw,
  AlertCircle,
  CheckCircle,
  Info,
  ChevronDown,
  ChevronUp,
  Loader2,
  Download,
  Play,
  Settings2,
  Mic,
  AlertTriangle,
  Sparkles,
  FileText,
  Zap,
  Clock,
  UserCheck,
  SplitSquareHorizontal,
  Volume2,
  Package
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { PythonEnvironmentDiagnostics } from './PythonEnvironmentDiagnostics'
import { ModelDownloadModal } from './ModelDownloadModal'

// ============================================================================
// Types
// ============================================================================

export interface SpeakerDiarizationSettingsProps {
  className?: string
  onSettingsChange?: (settings: DiarizationFullSettings) => void
  compact?: boolean
}

export interface DiarizationFullSettings {
  // Core settings
  enabled: boolean
  autoRecovery: boolean

  // Speaker count hints
  speakerCountMode: 'auto' | 'fixed' | 'range'
  fixedSpeakerCount: number
  minSpeakers: number
  maxSpeakers: number

  // Name extraction
  nameExtractionEnabled: boolean
  nameConfidenceThreshold: number

  // Clustering
  clusteringSensitivity: number

  // Audio quality
  audioQualityMode: 'high' | 'balanced' | 'fast'
  audioPreprocessingLevel: 'minimal' | 'moderate' | 'aggressive'

  // Current preset (if any)
  activePreset: string | null
}

interface DiarizationCapabilities {
  available: boolean
  pyannoteInstalled: boolean
  huggingFaceConfigured: boolean
  device: string
  error?: string
}

interface DiagnosticLog {
  timestamp: string
  level: 'info' | 'warning' | 'error'
  message: string
}

interface DiarizationPreset {
  id: string
  name: string
  description: string
  icon: React.ReactNode
  settings: Partial<DiarizationFullSettings>
}

interface PyannoteModelsStatus {
  allAvailable: boolean
  downloading: boolean
  missingModels: string[]
  totalDownloadSize: number
  totalDownloadSizeFormatted: string
  hfTokenConfigured: boolean
  modelsLocation: 'bundled' | 'cache' | 'none'
}

// ============================================================================
// Constants
// ============================================================================

const DEFAULT_SETTINGS: DiarizationFullSettings = {
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
}

const PRESETS: DiarizationPreset[] = [
  {
    id: 'podcast',
    name: 'Podcast',
    description: '2 speakers, high name extraction',
    icon: <Mic className="w-4 h-4" />,
    settings: {
      speakerCountMode: 'fixed',
      fixedSpeakerCount: 2,
      minSpeakers: 2,
      maxSpeakers: 2,
      nameExtractionEnabled: true,
      nameConfidenceThreshold: 0.5,
      clusteringSensitivity: 0.5,
      audioQualityMode: 'high',
      audioPreprocessingLevel: 'minimal'
    }
  },
  {
    id: 'team-meeting',
    name: 'Team Meeting',
    description: '4-8 speakers, moderate name extraction',
    icon: <Users className="w-4 h-4" />,
    settings: {
      speakerCountMode: 'range',
      minSpeakers: 4,
      maxSpeakers: 8,
      nameExtractionEnabled: true,
      nameConfidenceThreshold: 0.6,
      clusteringSensitivity: 0.5,
      audioQualityMode: 'balanced',
      audioPreprocessingLevel: 'moderate'
    }
  },
  {
    id: 'webinar',
    name: 'Webinar',
    description: '1-3 speakers, low name extraction',
    icon: <Volume2 className="w-4 h-4" />,
    settings: {
      speakerCountMode: 'range',
      minSpeakers: 1,
      maxSpeakers: 3,
      nameExtractionEnabled: true,
      nameConfidenceThreshold: 0.7,
      clusteringSensitivity: 0.4,
      audioQualityMode: 'high',
      audioPreprocessingLevel: 'minimal'
    }
  },
  {
    id: 'conference-call',
    name: 'Conference Call',
    description: '5+ speakers, aggressive splitting',
    icon: <SplitSquareHorizontal className="w-4 h-4" />,
    settings: {
      speakerCountMode: 'range',
      minSpeakers: 5,
      maxSpeakers: 15,
      nameExtractionEnabled: true,
      nameConfidenceThreshold: 0.6,
      clusteringSensitivity: 0.6,
      audioQualityMode: 'balanced',
      audioPreprocessingLevel: 'moderate'
    }
  }
]

// ============================================================================
// Helper Components
// ============================================================================

interface SettingRowProps {
  label: string
  description?: string
  children: React.ReactNode
  warning?: string
}

function SettingRow({ label, description, children, warning }: SettingRowProps) {
  return (
    <div className="flex items-start justify-between py-3 gap-4">
      <div className="flex-1">
        <p className="font-medium text-sm text-foreground">{label}</p>
        {description && (
          <p className="text-xs text-muted-foreground mt-0.5">{description}</p>
        )}
        {warning && (
          <p className="text-xs text-amber-600 dark:text-amber-400 mt-1 flex items-center gap-1">
            <AlertTriangle className="w-3 h-3" />
            {warning}
          </p>
        )}
      </div>
      <div className="flex-shrink-0">
        {children}
      </div>
    </div>
  )
}

interface ToggleProps {
  checked: boolean
  onChange: (checked: boolean) => void
  disabled?: boolean
}

function Toggle({ checked, onChange, disabled = false }: ToggleProps) {
  return (
    <button
      type="button"
      onClick={() => !disabled && onChange(!checked)}
      disabled={disabled}
      className={cn(
        'relative inline-flex h-6 w-11 items-center rounded-full transition-colors',
        checked ? 'bg-purple-600' : 'bg-gray-300 dark:bg-gray-600',
        disabled && 'opacity-50 cursor-not-allowed'
      )}
      data-testid="toggle-button"
    >
      <span
        className={cn(
          'inline-block h-4 w-4 transform rounded-full bg-white transition-transform shadow-sm',
          checked ? 'translate-x-6' : 'translate-x-1'
        )}
      />
    </button>
  )
}

interface SliderProps {
  value: number
  min: number
  max: number
  step: number
  onChange: (value: number) => void
  disabled?: boolean
  showValue?: boolean
  formatValue?: (value: number) => string
}

function Slider({
  value,
  min,
  max,
  step,
  onChange,
  disabled = false,
  showValue = true,
  formatValue = (v) => v.toFixed(2)
}: SliderProps) {
  return (
    <div className="flex items-center gap-3">
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(parseFloat(e.target.value))}
        disabled={disabled}
        className={cn(
          'w-32 h-2 bg-muted rounded-lg appearance-none cursor-pointer',
          '[&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-4 [&::-webkit-slider-thumb]:h-4',
          '[&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-purple-600',
          '[&::-webkit-slider-thumb]:cursor-pointer [&::-webkit-slider-thumb]:shadow',
          disabled && 'opacity-50 cursor-not-allowed'
        )}
        data-testid="slider-input"
      />
      {showValue && (
        <span className="text-sm text-muted-foreground w-10 text-right">
          {formatValue(value)}
        </span>
      )}
    </div>
  )
}

// ============================================================================
// Main Component
// ============================================================================

export function SpeakerDiarizationSettings({
  className,
  onSettingsChange,
  compact = false
}: SpeakerDiarizationSettingsProps) {
  const [settings, setSettings] = useState<DiarizationFullSettings>(DEFAULT_SETTINGS)
  const [capabilities, setCapabilities] = useState<DiarizationCapabilities | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [isSaving, setIsSaving] = useState(false)
  const [lastDiarizationTime, setLastDiarizationTime] = useState<string | null>(null)

  // Section expansion state
  const [expandedSections, setExpandedSections] = useState<Set<string>>(
    new Set(['core', 'presets'])
  )

  // Model Management state
  const [showModelModal, setShowModelModal] = useState(false)
  const [modelStatus, setModelStatus] = useState<PyannoteModelsStatus | null>(null)
  const [isLoadingModels, setIsLoadingModels] = useState(false)

  // Diagnostics state
  const [diagnosticsExpanded, setDiagnosticsExpanded] = useState(false)
  const [diagnosticLogs, setDiagnosticLogs] = useState<DiagnosticLog[]>([])
  const [isTestingAudio, setIsTestingAudio] = useState(false)
  const [testResult, setTestResult] = useState<{ success: boolean; message: string } | null>(null)

  const fileInputRef = useRef<HTMLInputElement>(null)

  // Load settings and capabilities on mount
  useEffect(() => {
    let isMounted = true

    const initializeComponent = async () => {
      try {
        // Add timeout to loadSettings to prevent infinite freeze
        const loadSettingsWithTimeout = async () => {
          const timeoutPromise = new Promise<void>((_, reject) =>
            setTimeout(() => reject(new Error('loadSettings timed out after 10 seconds')), 10000)
          )

          try {
            await Promise.race([loadSettings(), timeoutPromise])
          } catch (error) {
            console.error('[SpeakerDiarizationSettings] loadSettings failed:', error)
            // CRITICAL: Set isLoading to false even if loadSettings fails, to prevent infinite freeze
            if (isMounted) {
              setIsLoading(false)
            }
            throw error
          }
        }

        // Load settings first with timeout
        await loadSettingsWithTimeout()

        if (!isMounted) return

        // Load other components in parallel with individual timeouts
        const loadWithTimeout = async (fn: () => Promise<void>, name: string, timeoutMs: number) => {
          const timeoutPromise = new Promise<void>((_, reject) =>
            setTimeout(() => reject(new Error(`${name} timed out after ${timeoutMs}ms`)), timeoutMs)
          )

          try {
            await Promise.race([fn(), timeoutPromise])
          } catch (error) {
            console.error(`[SpeakerDiarizationSettings] ${name} failed:`, error)
            // Continue loading other components even if one fails
          }
        }

        await Promise.allSettled([
          loadWithTimeout(checkCapabilities, 'checkCapabilities', 8000),
          loadWithTimeout(loadDiagnosticLogs, 'loadDiagnosticLogs', 5000),
          loadWithTimeout(loadModelStatus, 'loadModelStatus', 8000)
        ])
      } catch (error) {
        console.error('[SpeakerDiarizationSettings] Initialization failed:', error)
      }
    }

    initializeComponent()

    return () => {
      isMounted = false
    }
  }, [])

  const loadSettings = async () => {
    try {
      const api = window.electronAPI as any
      if (api?.db?.settings?.get) {
        const savedSettings = await api.db.settings.get('diarization.fullSettings')
        if (savedSettings) {
          setSettings({ ...DEFAULT_SETTINGS, ...savedSettings })
        }

        // Load last diarization time
        const lastTime = await api.db.settings.get('diarization.lastRun')
        if (lastTime) {
          setLastDiarizationTime(lastTime as string)
        }
      }
    } catch (error) {
      console.error('[SpeakerDiarizationSettings] Error loading settings:', error)
    } finally {
      setIsLoading(false)
    }
  }

  const checkCapabilities = async () => {
    try {
      const api = window.electronAPI as any
      if (api?.diarizationHealth?.getCapabilities) {
        // Add timeout to prevent hanging
        const capsPromise = api.diarizationHealth.getCapabilities()
        const timeoutPromise = new Promise((_, reject) =>
          setTimeout(() => reject(new Error('Capabilities check timed out')), 8000)
        )

        const caps = await Promise.race([capsPromise, timeoutPromise])
        setCapabilities(caps)
      } else if (api?.streamingDiarization?.isAvailable) {
        // Add timeout for this check too
        const availablePromise = api.streamingDiarization.isAvailable()
        const timeoutPromise = new Promise((_, reject) =>
          setTimeout(() => reject(new Error('Streaming diarization check timed out')), 8000)
        )

        const result = await Promise.race([availablePromise, timeoutPromise])
        setCapabilities({
          available: result.available,
          pyannoteInstalled: result.available,
          huggingFaceConfigured: result.available,
          device: 'auto',
          error: result.error
        })
      } else {
        console.warn('[SpeakerDiarizationSettings] Diarization API not available')
        setCapabilities({
          available: false,
          pyannoteInstalled: false,
          huggingFaceConfigured: false,
          device: 'unknown',
          error: 'Diarization API not available'
        })
      }
    } catch (error) {
      console.error('[SpeakerDiarizationSettings] Error checking capabilities:', error)
      setCapabilities({
        available: false,
        pyannoteInstalled: false,
        huggingFaceConfigured: false,
        device: 'unknown',
        error: error instanceof Error ? error.message : 'Unknown error'
      })
    }
  }

  const loadDiagnosticLogs = async () => {
    try {
      const api = window.electronAPI as any
      if (api?.diarizationHealth?.getLogs) {
        // Add timeout to prevent hanging
        const logsPromise = api.diarizationHealth.getLogs()
        const timeoutPromise = new Promise((_, reject) =>
          setTimeout(() => reject(new Error('Diagnostic logs check timed out')), 5000)
        )

        const logs = await Promise.race([logsPromise, timeoutPromise])
        setDiagnosticLogs(logs || [])
      }
    } catch (error) {
      console.error('[SpeakerDiarizationSettings] Error loading logs:', error)
      setDiagnosticLogs([]) // Set empty logs on error
    }
  }

  const loadModelStatus = async () => {
    setIsLoadingModels(true)
    try {
      const api = window.electronAPI as any
      if (api?.modelManager?.getPyannoteStatus) {
        // Add timeout to prevent hanging
        const statusPromise = api.modelManager.getPyannoteStatus()
        const timeoutPromise = new Promise((_, reject) =>
          setTimeout(() => reject(new Error('Model status check timed out')), 8000)
        )

        const status = await Promise.race([statusPromise, timeoutPromise])
        setModelStatus(status)
      } else {
        console.warn('[SpeakerDiarizationSettings] Model manager API not available')
      }
    } catch (error) {
      console.error('[SpeakerDiarizationSettings] Error loading model status:', error)
      // Set a default error state so UI isn't stuck
      setModelStatus(null)
    } finally {
      setIsLoadingModels(false)
    }
  }

  const saveSettings = useCallback(async (newSettings: DiarizationFullSettings) => {
    setIsSaving(true)
    try {
      const api = window.electronAPI as any
      if (api?.db?.settings?.set) {
        await api.db.settings.set('diarization.fullSettings', newSettings, 'transcription')

        // Also save individual settings for backward compatibility
        await api.db.settings.set('transcription.diarization.enabled', newSettings.enabled, 'transcription')
        await api.db.settings.set('transcription.diarization.threshold', newSettings.clusteringSensitivity, 'transcription')
        await api.db.settings.set('transcription.diarization.maxSpeakers', newSettings.maxSpeakers, 'transcription')
      }
      setSettings(newSettings)
      onSettingsChange?.(newSettings)
    } catch (error) {
      console.error('[SpeakerDiarizationSettings] Error saving settings:', error)
    } finally {
      setIsSaving(false)
    }
  }, [onSettingsChange])

  // Create a ref to always get the latest settings without causing re-renders
  const settingsRef = useRef(settings)
  useEffect(() => {
    settingsRef.current = settings
  }, [settings])

  const updateSetting = useCallback(<K extends keyof DiarizationFullSettings>(
    key: K,
    value: DiarizationFullSettings[K]
  ) => {
    const newSettings = { ...settingsRef.current, [key]: value, activePreset: null }
    saveSettings(newSettings)
  }, [saveSettings])

  const applyPreset = useCallback((preset: DiarizationPreset) => {
    const newSettings = {
      ...settingsRef.current,
      ...preset.settings,
      activePreset: preset.id
    }
    saveSettings(newSettings)
  }, [saveSettings])

  const toggleSection = (sectionId: string) => {
    setExpandedSections(prev => {
      const newSet = new Set(prev)
      if (newSet.has(sectionId)) {
        newSet.delete(sectionId)
      } else {
        newSet.add(sectionId)
      }
      return newSet
    })
  }

  const handleTestAudio = async () => {
    if (!fileInputRef.current?.files?.length) {
      setTestResult({ success: false, message: 'Please select an audio file first' })
      return
    }

    setIsTestingAudio(true)
    setTestResult(null)

    try {
      const file = fileInputRef.current.files[0]
      const api = window.electronAPI as any

      // Read file and convert to array buffer
      const arrayBuffer = await file.arrayBuffer()

      if (api?.diarizationHealth?.testWithAudio) {
        const result = await api.diarizationHealth.testWithAudio(arrayBuffer)
        setTestResult({
          success: result.success,
          message: result.success
            ? `Detected ${result.speakerCount} speaker(s) in ${result.duration}s`
            : result.error || 'Test failed'
        })
      } else {
        // Simulate test for development
        await new Promise(resolve => setTimeout(resolve, 2000))
        setTestResult({
          success: true,
          message: 'Test completed (simulated): 2 speakers detected'
        })
      }
    } catch (error) {
      setTestResult({
        success: false,
        message: error instanceof Error ? error.message : 'Test failed'
      })
    } finally {
      setIsTestingAudio(false)
    }
  }

  const exportDebugReport = async () => {
    try {
      const api = window.electronAPI as any

      // Get Python validation data
      let pythonValidation = null
      try {
        pythonValidation = await api.pythonValidation?.validate(false)
      } catch (error) {
        console.error('Failed to get Python validation:', error)
      }

      const report = {
        timestamp: new Date().toISOString(),
        settings,
        capabilities,
        logs: diagnosticLogs,
        systemInfo: {
          platform: navigator.platform,
          userAgent: navigator.userAgent
        },
        pythonEnvironment: pythonValidation ? {
          environment: pythonValidation.environment,
          packageVersions: pythonValidation.packageVersions,
          modelLocations: pythonValidation.modelLocations,
          environmentVariables: pythonValidation.environmentVariables,
          checks: pythonValidation.checks.map((check: any) => ({
            type: check.type,
            name: check.name,
            status: check.status,
            message: check.message,
            error: check.error,
            duration: check.duration
          })),
          summary: pythonValidation.summary,
          recommendations: pythonValidation.recommendations
        } : null
      }

      const json = JSON.stringify(report, null, 2)

      if (api?.clipboard?.writeText) {
        await api.clipboard.writeText(json)
        alert('Debug report copied to clipboard')
      } else {
        // Fallback to browser clipboard
        await navigator.clipboard.writeText(json)
        alert('Debug report copied to clipboard')
      }
    } catch (error) {
      console.error('Failed to export debug report:', error)
      alert('Failed to export debug report')
    }
  }

  const formatLastDiarizationTime = () => {
    if (!lastDiarizationTime) return 'Never'
    const date = new Date(lastDiarizationTime)
    const now = new Date()
    const diffMs = now.getTime() - date.getTime()
    const diffMins = Math.floor(diffMs / 60000)

    if (diffMins < 1) return 'Just now'
    if (diffMins < 60) return `${diffMins} minute${diffMins !== 1 ? 's' : ''} ago`
    const diffHours = Math.floor(diffMins / 60)
    if (diffHours < 24) return `${diffHours} hour${diffHours !== 1 ? 's' : ''} ago`
    return date.toLocaleDateString()
  }

  if (isLoading) {
    return (
      <div className={cn('flex items-center justify-center p-8', className)}>
        <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
        <span className="ml-2 text-sm text-muted-foreground">Loading settings...</span>
      </div>
    )
  }

  // Compact mode for recording controls display
  if (compact) {
    return (
      <div className={cn('flex items-center gap-2 text-xs', className)} data-testid="diarization-settings-compact">
        <Users className="w-3.5 h-3.5 text-muted-foreground" />
        <span className="text-muted-foreground">
          Auto ID: {settings.enabled ? 'On' : 'Off'}
          {settings.enabled && settings.speakerCountMode !== 'auto' && (
            <>
              , Expected: {settings.speakerCountMode === 'fixed'
                ? `${settings.fixedSpeakerCount}`
                : `${settings.minSpeakers}-${settings.maxSpeakers}`
              } speakers
            </>
          )}
        </span>
      </div>
    )
  }

  return (
    <div className={cn('space-y-6', className)} data-testid="speaker-diarization-settings">
      {/* Header */}
      <div className="flex items-center gap-2">
        <Users className="w-5 h-5 text-primary" />
        <h3 className="font-semibold">Speaker Identification Settings</h3>
      </div>

      {/* Capabilities Status */}
      {capabilities && (
        <div
          className={cn(
            'flex items-start gap-3 p-3 rounded-lg border',
            capabilities.available
              ? 'bg-green-50 border-green-200 dark:bg-green-900/20 dark:border-green-800'
              : 'bg-yellow-50 border-yellow-200 dark:bg-yellow-900/20 dark:border-yellow-800'
          )}
        >
          {capabilities.available ? (
            <CheckCircle className="w-5 h-5 text-green-600 dark:text-green-400 shrink-0 mt-0.5" />
          ) : (
            <AlertCircle className="w-5 h-5 text-yellow-600 dark:text-yellow-400 shrink-0 mt-0.5" />
          )}
          <div className="flex-1 min-w-0">
            <p className={cn(
              'text-sm font-medium',
              capabilities.available
                ? 'text-green-700 dark:text-green-300'
                : 'text-yellow-700 dark:text-yellow-300'
            )}>
              {capabilities.available
                ? 'Speaker identification is available'
                : 'Speaker identification is not available'
              }
            </p>
            {!capabilities.available && capabilities.error && (
              <p className="text-xs text-yellow-600 dark:text-yellow-400 mt-1">
                {capabilities.error}
              </p>
            )}
          </div>
          <button
            onClick={checkCapabilities}
            className="text-muted-foreground hover:text-foreground transition-colors"
            title="Refresh status"
          >
            <RefreshCw className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* Model Management Section */}
      <div className="bg-card border border-border rounded-lg overflow-hidden">
        <button
          onClick={() => toggleSection('models')}
          className="w-full px-4 py-3 flex items-center justify-between hover:bg-accent/50 transition-colors"
        >
          <div className="flex items-center gap-2">
            <Package className="w-4 h-4 text-purple-500" />
            <span className="font-medium text-sm">Model Management</span>
          </div>
          {expandedSections.has('models') ? (
            <ChevronUp className="w-4 h-4 text-muted-foreground" />
          ) : (
            <ChevronDown className="w-4 h-4 text-muted-foreground" />
          )}
        </button>

        {expandedSections.has('models') && (
          <div className="p-4 border-t border-border space-y-4">
            {/* Model Status Display */}
            {isLoadingModels ? (
              <div className="flex items-center justify-center py-4">
                <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
                <span className="ml-2 text-sm text-muted-foreground">Loading model status...</span>
              </div>
            ) : modelStatus ? (
              <div className="space-y-3">
                {/* Status Banner */}
                <div
                  className={cn(
                    'flex items-start gap-3 p-3 rounded-lg border',
                    modelStatus.allAvailable
                      ? 'bg-green-50 border-green-200 dark:bg-green-900/20 dark:border-green-800'
                      : 'bg-yellow-50 border-yellow-200 dark:bg-yellow-900/20 dark:border-yellow-800'
                  )}
                >
                  {modelStatus.allAvailable ? (
                    <CheckCircle className="w-5 h-5 text-green-600 dark:text-green-400 shrink-0 mt-0.5" />
                  ) : (
                    <AlertCircle className="w-5 h-5 text-yellow-600 dark:text-yellow-400 shrink-0 mt-0.5" />
                  )}
                  <div className="flex-1 min-w-0">
                    <p className={cn(
                      'text-sm font-medium',
                      modelStatus.allAvailable
                        ? 'text-green-700 dark:text-green-300'
                        : 'text-yellow-700 dark:text-yellow-300'
                    )}>
                      {modelStatus.allAvailable
                        ? `All Models Installed (${modelStatus.totalDownloadSizeFormatted})`
                        : `Models Required (${modelStatus.totalDownloadSizeFormatted} download)`
                      }
                    </p>
                    {modelStatus.modelsLocation !== 'none' && (
                      <p className="text-xs text-muted-foreground mt-1">
                        Location: {modelStatus.modelsLocation === 'bundled' ? 'Bundled with app' : 'System cache'}
                      </p>
                    )}
                  </div>
                  <button
                    onClick={loadModelStatus}
                    className="text-muted-foreground hover:text-foreground transition-colors"
                    title="Refresh model status"
                  >
                    <RefreshCw className="w-4 h-4" />
                  </button>
                </div>

                {/* Models List */}
                {modelStatus.allAvailable ? (
                  <div className="space-y-2">
                    <h4 className="text-sm font-medium text-foreground">Installed Models:</h4>
                    <div className="space-y-1">
                      <div className="flex items-center gap-2 text-sm text-muted-foreground">
                        <CheckCircle className="w-4 h-4 text-green-500" />
                        <span>pyannote-speaker-diarization-3.1</span>
                      </div>
                      <div className="flex items-center gap-2 text-sm text-muted-foreground">
                        <CheckCircle className="w-4 h-4 text-green-500" />
                        <span>pyannote-segmentation-3.0</span>
                      </div>
                      <div className="flex items-center gap-2 text-sm text-muted-foreground">
                        <CheckCircle className="w-4 h-4 text-green-500" />
                        <span>pyannote-embedding</span>
                      </div>
                    </div>
                  </div>
                ) : modelStatus.missingModels.length > 0 && (
                  <div className="space-y-2">
                    <h4 className="text-sm font-medium text-foreground">Missing Models:</h4>
                    <div className="space-y-1">
                      {modelStatus.missingModels.map((modelId) => (
                        <div key={modelId} className="flex items-center gap-2 text-sm text-muted-foreground">
                          <Download className="w-4 h-4 text-yellow-500" />
                          <span>{modelId}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Action Button */}
                <button
                  onClick={() => setShowModelModal(true)}
                  className={cn(
                    'w-full flex items-center justify-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors',
                    modelStatus.allAvailable
                      ? 'bg-secondary hover:bg-accent text-foreground'
                      : 'bg-purple-600 hover:bg-purple-700 text-white'
                  )}
                >
                  <Download className="w-4 h-4" />
                  {modelStatus.allAvailable ? 'Manage Models' : 'Download Models'}
                </button>
              </div>
            ) : (
              <div className="text-center py-4">
                <p className="text-sm text-muted-foreground">Unable to load model status</p>
                <button
                  onClick={loadModelStatus}
                  className="mt-2 text-sm text-purple-600 dark:text-purple-400 hover:underline"
                >
                  Try again
                </button>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Presets Section */}
      <div className="bg-card border border-border rounded-lg overflow-hidden">
        <button
          onClick={() => toggleSection('presets')}
          className="w-full px-4 py-3 flex items-center justify-between hover:bg-accent/50 transition-colors"
        >
          <div className="flex items-center gap-2">
            <Sparkles className="w-4 h-4 text-purple-500" />
            <span className="font-medium text-sm">Quick Presets</span>
          </div>
          {expandedSections.has('presets') ? (
            <ChevronUp className="w-4 h-4 text-muted-foreground" />
          ) : (
            <ChevronDown className="w-4 h-4 text-muted-foreground" />
          )}
        </button>

        {expandedSections.has('presets') && (
          <div className="p-4 border-t border-border">
            <div className="grid grid-cols-2 gap-3">
              {PRESETS.map((preset) => (
                <button
                  key={preset.id}
                  onClick={() => applyPreset(preset)}
                  disabled={isSaving || !capabilities?.available}
                  className={cn(
                    'flex items-start gap-3 p-3 rounded-lg border text-left transition-all',
                    settings.activePreset === preset.id
                      ? 'border-purple-500 bg-purple-50 dark:bg-purple-900/20'
                      : 'border-border hover:border-purple-300 hover:bg-accent/50',
                    (isSaving || !capabilities?.available) && 'opacity-50 cursor-not-allowed'
                  )}
                  data-testid={`preset-${preset.id}`}
                >
                  <div className={cn(
                    'p-2 rounded-lg',
                    settings.activePreset === preset.id
                      ? 'bg-purple-100 dark:bg-purple-800'
                      : 'bg-muted'
                  )}>
                    {preset.icon}
                  </div>
                  <div>
                    <p className="font-medium text-sm">{preset.name}</p>
                    <p className="text-xs text-muted-foreground">{preset.description}</p>
                  </div>
                  {settings.activePreset === preset.id && (
                    <CheckCircle className="w-4 h-4 text-purple-500 ml-auto" />
                  )}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Core Settings Section */}
      <div className="bg-card border border-border rounded-lg overflow-hidden">
        <button
          onClick={() => toggleSection('core')}
          className="w-full px-4 py-3 flex items-center justify-between hover:bg-accent/50 transition-colors"
        >
          <div className="flex items-center gap-2">
            <Settings2 className="w-4 h-4 text-muted-foreground" />
            <span className="font-medium text-sm">Core Settings</span>
          </div>
          {expandedSections.has('core') ? (
            <ChevronUp className="w-4 h-4 text-muted-foreground" />
          ) : (
            <ChevronDown className="w-4 h-4 text-muted-foreground" />
          )}
        </button>

        {expandedSections.has('core') && (
          <div className="p-4 border-t border-border space-y-1">
            <SettingRow
              label="Enable Automatic Diarization"
              description="Automatically identify different speakers during recording"
              warning={!settings.enabled ? "You will need to manually identify speakers after each meeting." : undefined}
            >
              <Toggle
                checked={settings.enabled}
                onChange={(checked) => updateSetting('enabled', checked)}
                disabled={isSaving || !capabilities?.available}
              />
            </SettingRow>

            <SettingRow
              label="Automatic Recovery"
              description="Retry speaker identification after recording if it fails"
            >
              <Toggle
                checked={settings.autoRecovery}
                onChange={(checked) => updateSetting('autoRecovery', checked)}
                disabled={isSaving || !settings.enabled}
              />
            </SettingRow>
          </div>
        )}
      </div>

      {/* Speaker Count Hints Section */}
      <div className="bg-card border border-border rounded-lg overflow-hidden">
        <button
          onClick={() => toggleSection('speakers')}
          className="w-full px-4 py-3 flex items-center justify-between hover:bg-accent/50 transition-colors"
        >
          <div className="flex items-center gap-2">
            <UserCheck className="w-4 h-4 text-muted-foreground" />
            <span className="font-medium text-sm">Speaker Count Hints</span>
          </div>
          {expandedSections.has('speakers') ? (
            <ChevronUp className="w-4 h-4 text-muted-foreground" />
          ) : (
            <ChevronDown className="w-4 h-4 text-muted-foreground" />
          )}
        </button>

        {expandedSections.has('speakers') && (
          <div className="p-4 border-t border-border space-y-4">
            <SettingRow
              label="Speaker Detection Mode"
              description="How to determine the number of speakers"
            >
              <select
                value={settings.speakerCountMode}
                onChange={(e) => updateSetting('speakerCountMode', e.target.value as 'auto' | 'fixed' | 'range')}
                disabled={isSaving || !settings.enabled}
                className="px-3 py-1.5 bg-background border border-border rounded-md text-sm"
                data-testid="speaker-mode-select"
              >
                <option value="auto">Auto-detect</option>
                <option value="fixed">Fixed count</option>
                <option value="range">Range</option>
              </select>
            </SettingRow>

            {settings.speakerCountMode === 'fixed' && (
              <SettingRow
                label="Number of Speakers"
                description="Exact number of speakers expected"
              >
                <select
                  value={settings.fixedSpeakerCount}
                  onChange={(e) => updateSetting('fixedSpeakerCount', parseInt(e.target.value))}
                  disabled={isSaving || !settings.enabled}
                  className="px-3 py-1.5 bg-background border border-border rounded-md text-sm"
                >
                  {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map(n => (
                    <option key={n} value={n}>{n} speaker{n !== 1 ? 's' : ''}</option>
                  ))}
                </select>
              </SettingRow>
            )}

            {settings.speakerCountMode === 'range' && (
              <>
                <SettingRow
                  label="Minimum Speakers"
                  description="Minimum number of speakers expected"
                >
                  <select
                    value={settings.minSpeakers}
                    onChange={(e) => updateSetting('minSpeakers', parseInt(e.target.value))}
                    disabled={isSaving || !settings.enabled}
                    className="px-3 py-1.5 bg-background border border-border rounded-md text-sm"
                  >
                    {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map(n => (
                      <option key={n} value={n} disabled={n > settings.maxSpeakers}>
                        {n}
                      </option>
                    ))}
                  </select>
                </SettingRow>

                <SettingRow
                  label="Maximum Speakers"
                  description="Maximum number of speakers expected"
                >
                  <select
                    value={settings.maxSpeakers}
                    onChange={(e) => updateSetting('maxSpeakers', parseInt(e.target.value))}
                    disabled={isSaving || !settings.enabled}
                    className="px-3 py-1.5 bg-background border border-border rounded-md text-sm"
                  >
                    {[2, 3, 4, 5, 6, 7, 8, 9, 10, 15, 20].map(n => (
                      <option key={n} value={n} disabled={n < settings.minSpeakers}>
                        {n}
                      </option>
                    ))}
                  </select>
                </SettingRow>
              </>
            )}
          </div>
        )}
      </div>

      {/* Name Extraction Settings Section */}
      <div className="bg-card border border-border rounded-lg overflow-hidden">
        <button
          onClick={() => toggleSection('names')}
          className="w-full px-4 py-3 flex items-center justify-between hover:bg-accent/50 transition-colors"
        >
          <div className="flex items-center gap-2">
            <FileText className="w-4 h-4 text-muted-foreground" />
            <span className="font-medium text-sm">Name Extraction Settings</span>
          </div>
          {expandedSections.has('names') ? (
            <ChevronUp className="w-4 h-4 text-muted-foreground" />
          ) : (
            <ChevronDown className="w-4 h-4 text-muted-foreground" />
          )}
        </button>

        {expandedSections.has('names') && (
          <div className="p-4 border-t border-border space-y-4">
            <SettingRow
              label="Enable Name Extraction"
              description="Automatically extract speaker names from transcript"
            >
              <Toggle
                checked={settings.nameExtractionEnabled}
                onChange={(checked) => updateSetting('nameExtractionEnabled', checked)}
                disabled={isSaving || !settings.enabled}
              />
            </SettingRow>

            <SettingRow
              label="Confidence Threshold"
              description="Minimum confidence to display extracted names (0.3 = more names shown, 0.9 = only high confidence)"
            >
              <Slider
                value={settings.nameConfidenceThreshold}
                min={0.3}
                max={0.9}
                step={0.1}
                onChange={(value) => updateSetting('nameConfidenceThreshold', value)}
                disabled={isSaving || !settings.enabled || !settings.nameExtractionEnabled}
              />
            </SettingRow>
          </div>
        )}
      </div>

      {/* Clustering Sensitivity Section */}
      <div className="bg-card border border-border rounded-lg overflow-hidden">
        <button
          onClick={() => toggleSection('clustering')}
          className="w-full px-4 py-3 flex items-center justify-between hover:bg-accent/50 transition-colors"
        >
          <div className="flex items-center gap-2">
            <SplitSquareHorizontal className="w-4 h-4 text-muted-foreground" />
            <span className="font-medium text-sm">Clustering Sensitivity</span>
          </div>
          {expandedSections.has('clustering') ? (
            <ChevronUp className="w-4 h-4 text-muted-foreground" />
          ) : (
            <ChevronDown className="w-4 h-4 text-muted-foreground" />
          )}
        </button>

        {expandedSections.has('clustering') && (
          <div className="p-4 border-t border-border">
            <SettingRow
              label="Speaker Similarity Threshold"
              description="Lower = more likely to merge similar voices. Higher = more likely to split into separate speakers."
            >
              <Slider
                value={settings.clusteringSensitivity}
                min={0.3}
                max={0.7}
                step={0.05}
                onChange={(value) => updateSetting('clusteringSensitivity', value)}
                disabled={isSaving || !settings.enabled}
              />
            </SettingRow>

            <div className="mt-3 flex items-center justify-between text-xs text-muted-foreground">
              <span>Merge voices</span>
              <span>Split voices</span>
            </div>
          </div>
        )}
      </div>

      {/* Audio Quality Optimization Section */}
      <div className="bg-card border border-border rounded-lg overflow-hidden">
        <button
          onClick={() => toggleSection('quality')}
          className="w-full px-4 py-3 flex items-center justify-between hover:bg-accent/50 transition-colors"
        >
          <div className="flex items-center gap-2">
            <Zap className="w-4 h-4 text-muted-foreground" />
            <span className="font-medium text-sm">Audio Quality Optimization</span>
          </div>
          {expandedSections.has('quality') ? (
            <ChevronUp className="w-4 h-4 text-muted-foreground" />
          ) : (
            <ChevronDown className="w-4 h-4 text-muted-foreground" />
          )}
        </button>

        {expandedSections.has('quality') && (
          <div className="p-4 border-t border-border space-y-4">
            <SettingRow
              label="Processing Quality"
              description="Trade-off between accuracy and speed"
            >
              <select
                value={settings.audioQualityMode}
                onChange={(e) => updateSetting('audioQualityMode', e.target.value as 'high' | 'balanced' | 'fast')}
                disabled={isSaving || !settings.enabled}
                className="px-3 py-1.5 bg-background border border-border rounded-md text-sm"
                data-testid="quality-mode-select"
              >
                <option value="high">High quality (slower)</option>
                <option value="balanced">Balanced</option>
                <option value="fast">Fast (lower accuracy)</option>
              </select>
            </SettingRow>

            <SettingRow
              label="Audio Preprocessing"
              description="Level of audio cleanup before processing"
            >
              <select
                value={settings.audioPreprocessingLevel}
                onChange={(e) => updateSetting('audioPreprocessingLevel', e.target.value as 'minimal' | 'moderate' | 'aggressive')}
                disabled={isSaving || !settings.enabled}
                className="px-3 py-1.5 bg-background border border-border rounded-md text-sm"
                data-testid="preprocessing-select"
              >
                <option value="minimal">Minimal (best for diarization)</option>
                <option value="moderate">Moderate</option>
                <option value="aggressive">Aggressive (best for noisy environments)</option>
              </select>
            </SettingRow>
          </div>
        )}
      </div>

      {/* Diagnostics Panel */}
      <div className="bg-card border border-border rounded-lg overflow-hidden">
        <button
          onClick={() => setDiagnosticsExpanded(!diagnosticsExpanded)}
          className="w-full px-4 py-3 flex items-center justify-between hover:bg-accent/50 transition-colors"
          data-testid="diagnostics-toggle"
        >
          <div className="flex items-center gap-2">
            <Info className="w-4 h-4 text-muted-foreground" />
            <span className="font-medium text-sm">Diagnostics Panel</span>
          </div>
          {diagnosticsExpanded ? (
            <ChevronUp className="w-4 h-4 text-muted-foreground" />
          ) : (
            <ChevronDown className="w-4 h-4 text-muted-foreground" />
          )}
        </button>

        {diagnosticsExpanded && (
          <div className="p-4 border-t border-border space-y-4">
            {/* System Status */}
            <div className="space-y-2">
              <h4 className="text-sm font-medium">System Status</h4>
              <div className="grid grid-cols-2 gap-2">
                <div className="flex items-center gap-2 p-2 bg-muted rounded text-xs">
                  <span className="text-muted-foreground">Pyannote model:</span>
                  {capabilities?.pyannoteInstalled ? (
                    <CheckCircle className="w-3.5 h-3.5 text-green-500" />
                  ) : (
                    <AlertCircle className="w-3.5 h-3.5 text-red-500" />
                  )}
                </div>
                <div className="flex items-center gap-2 p-2 bg-muted rounded text-xs">
                  <span className="text-muted-foreground">HuggingFace auth:</span>
                  {capabilities?.huggingFaceConfigured ? (
                    <CheckCircle className="w-3.5 h-3.5 text-green-500" />
                  ) : (
                    <AlertCircle className="w-3.5 h-3.5 text-yellow-500" />
                  )}
                </div>
                <div className="flex items-center gap-2 p-2 bg-muted rounded text-xs col-span-2">
                  <Clock className="w-3.5 h-3.5 text-muted-foreground" />
                  <span className="text-muted-foreground">Last diarization:</span>
                  <span className="font-medium">{formatLastDiarizationTime()}</span>
                </div>
              </div>
            </div>

            {/* Test Audio */}
            <div className="space-y-2">
              <h4 className="text-sm font-medium">Test Diarization</h4>
              <p className="text-xs text-muted-foreground">
                Upload a sample audio file to test speaker detection
              </p>
              <div className="flex items-center gap-2">
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="audio/*"
                  className="text-xs file:mr-2 file:py-1 file:px-3 file:rounded file:border-0 file:text-xs file:bg-purple-100 file:text-purple-700 hover:file:bg-purple-200"
                  data-testid="audio-file-input"
                />
                <button
                  onClick={handleTestAudio}
                  disabled={isTestingAudio || !capabilities?.available}
                  className={cn(
                    'flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-medium transition-colors',
                    'bg-purple-600 text-white hover:bg-purple-700',
                    (isTestingAudio || !capabilities?.available) && 'opacity-50 cursor-not-allowed'
                  )}
                  data-testid="test-audio-button"
                >
                  {isTestingAudio ? (
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  ) : (
                    <Play className="w-3.5 h-3.5" />
                  )}
                  Test
                </button>
              </div>
              {testResult && (
                <div className={cn(
                  'p-2 rounded text-xs',
                  testResult.success
                    ? 'bg-green-50 text-green-700 dark:bg-green-900/20 dark:text-green-300'
                    : 'bg-red-50 text-red-700 dark:bg-red-900/20 dark:text-red-300'
                )}>
                  {testResult.message}
                </div>
              )}
            </div>

            {/* Logs */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <h4 className="text-sm font-medium">Recent Logs</h4>
                <button
                  onClick={loadDiagnosticLogs}
                  className="text-xs text-muted-foreground hover:text-foreground"
                >
                  <RefreshCw className="w-3.5 h-3.5" />
                </button>
              </div>
              <div className="max-h-32 overflow-y-auto bg-muted rounded p-2 space-y-1">
                {diagnosticLogs.length > 0 ? (
                  diagnosticLogs.slice(-10).map((log, index) => (
                    <div key={index} className="text-xs flex items-start gap-2">
                      <span className={cn(
                        'w-1.5 h-1.5 rounded-full mt-1.5 flex-shrink-0',
                        log.level === 'error' ? 'bg-red-500' :
                        log.level === 'warning' ? 'bg-yellow-500' : 'bg-green-500'
                      )} />
                      <span className="text-muted-foreground">{log.timestamp}</span>
                      <span className="flex-1">{log.message}</span>
                    </div>
                  ))
                ) : (
                  <p className="text-xs text-muted-foreground text-center py-2">No logs available</p>
                )}
              </div>
            </div>

            {/* Export Debug Report */}
            <button
              onClick={exportDebugReport}
              className="w-full flex items-center justify-center gap-2 px-4 py-2 bg-secondary hover:bg-accent rounded text-sm font-medium transition-colors"
              data-testid="export-debug-button"
            >
              <Download className="w-4 h-4" />
              Export Debug Report
            </button>

            {/* Python Environment Diagnostics */}
            <div className="pt-4 border-t border-border">
              <PythonEnvironmentDiagnostics />
            </div>
          </div>
        )}
      </div>

      {/* Model Download Modal */}
      <ModelDownloadModal
        isOpen={showModelModal}
        onClose={() => setShowModelModal(false)}
        onDownloadComplete={() => {
          loadModelStatus()
          checkCapabilities()
        }}
      />
    </div>
  )
}

export default SpeakerDiarizationSettings
