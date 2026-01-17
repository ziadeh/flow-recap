/**
 * DiarizationSettings Component
 *
 * Settings panel for configuring speaker diarization behavior.
 * Allows users to:
 * - Enable/disable automatic speaker identification
 * - Configure fallback behavior
 * - Manually trigger speaker identification
 */

import { useState, useEffect, useCallback } from 'react'
import {
  Users,
  RefreshCw,
  AlertCircle,
  CheckCircle,
  Info,
  ChevronDown,
  ChevronUp,
  Loader2,
  Eye,
  EyeOff,
  Save,
  Download,
  Wrench,
  RotateCcw,
  ExternalLink,
  PlayCircle,
  XCircle,
  CheckCircle2
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { ModelDownloadModal } from './ModelDownloadModal'

// ============================================================================
// Types
// ============================================================================

export interface DiarizationSettingsProps {
  className?: string
  onSettingsChange?: (settings: DiarizationUserSettings) => void
}

export interface DiarizationUserSettings {
  /** Whether automatic speaker identification is enabled */
  enabled: boolean
  /** Whether to auto-queue post-meeting recovery on failure */
  autoRecovery: boolean
  /** Similarity threshold for speaker detection (0.3-0.7) */
  similarityThreshold: number
  /** Maximum number of speakers to detect */
  maxSpeakers: number
}

interface DiarizationCapabilities {
  available: boolean
  pyannoteInstalled: boolean
  huggingFaceConfigured: boolean
  device: string
  error?: string
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

interface ValidationResult {
  success: boolean
  timestamp: string
  checks: ValidationCheck[]
  environment: {
    type: string
    pythonPath: string | null
    pythonVersion: string | null
    platform: {
      os: string
      arch: string
      isAppleSilicon: boolean
    }
  }
  environmentVariables: Record<string, string>
  packageVersions: Record<string, string>
  modelLocations: Record<string, string | null>
  summary: {
    total: number
    passed: number
    failed: number
    warnings: number
    skipped: number
  }
  recommendations: string[]
}

interface ValidationCheck {
  type: string
  name: string
  status: 'pass' | 'fail' | 'warning' | 'skipped'
  message: string
  error?: string
  remediation?: string[]
  duration: number
  details?: Record<string, unknown>
}

// ============================================================================
// Default Settings
// ============================================================================

const DEFAULT_SETTINGS: DiarizationUserSettings = {
  enabled: true,
  autoRecovery: true,
  similarityThreshold: 0.4,
  maxSpeakers: 10
}

// ============================================================================
// Component
// ============================================================================

export function DiarizationSettings({
  className,
  onSettingsChange
}: DiarizationSettingsProps) {
  const [settings, setSettings] = useState<DiarizationUserSettings>(DEFAULT_SETTINGS)
  const [capabilities, setCapabilities] = useState<DiarizationCapabilities | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [isSaving, setIsSaving] = useState(false)
  const [showAdvanced, setShowAdvanced] = useState(false)
  const [diagnosticsExpanded, setDiagnosticsExpanded] = useState(false)
  const [hfToken, setHfToken] = useState<string>('')
  const [isTokenVisible, setIsTokenVisible] = useState(false)
  const [tokenSaving, setTokenSaving] = useState(false)
  const [modelStatus, setModelStatus] = useState<PyannoteModelsStatus | null>(null)
  const [showDownloadModal, setShowDownloadModal] = useState(false)
  const [pythonValidation, setPythonValidation] = useState<ValidationResult | null>(null)
  const [troubleshootingExpanded, setTroubleshootingExpanded] = useState(false)
  const [isTesting, setIsTesting] = useState(false)
  const [testResult, setTestResult] = useState<{ success: boolean; message: string } | null>(null)

  // Load settings and capabilities on mount
  useEffect(() => {
    loadSettings()
    loadHfToken()
    checkCapabilities()
    loadModelStatus()
    loadPythonValidation()
  }, [])

  const loadPythonValidation = async () => {
    try {
      const api = window.electronAPI as any
      if (api?.pythonValidation?.validate) {
        const result = await api.pythonValidation.validate(false)
        setPythonValidation(result)
      }
    } catch (error) {
      console.error('[DiarizationSettings] Error loading Python validation:', error)
    }
  }

  const loadModelStatus = async () => {
    try {
      const api = window.electronAPI as any
      if (api?.modelManager?.getPyannoteStatus) {
        const result = await api.modelManager.getPyannoteStatus()
        setModelStatus(result)
      }
    } catch (error) {
      console.error('[DiarizationSettings] Error loading model status:', error)
    }
  }

  const handleDownloadComplete = () => {
    loadModelStatus()
    checkCapabilities()
  }

  const loadHfToken = async () => {
    try {
      const api = window.electronAPI as any
      if (api?.settings?.get) {
        const token = await api.settings.get('transcription.hfToken')
        if (token) {
          setHfToken(token)
        }
      }
    } catch (error) {
      console.error('[DiarizationSettings] Error loading HF token:', error)
    }
  }

  const saveHfToken = async (token: string) => {
    setTokenSaving(true)
    try {
      const api = window.electronAPI as any
      if (api?.settings?.set) {
        await api.settings.set('transcription.hfToken', token, 'transcription')
      }
      // Refresh capabilities after saving token
      setTimeout(() => {
        checkCapabilities()
      }, 500)
    } catch (error) {
      console.error('[DiarizationSettings] Error saving HF token:', error)
    } finally {
      setTokenSaving(false)
    }
  }

  const loadSettings = async () => {
    try {
      const api = window.electronAPI as any
      if (api?.settings?.get) {
        const savedSettings = await api.settings.get('diarization_settings')
        if (savedSettings) {
          setSettings({ ...DEFAULT_SETTINGS, ...savedSettings })
        }
      }
    } catch (error) {
      console.error('[DiarizationSettings] Error loading settings:', error)
    } finally {
      setIsLoading(false)
    }
  }

  const checkCapabilities = async () => {
    try {
      const api = window.electronAPI as any
      if (api?.diarizationHealth?.getCapabilities) {
        const caps = await api.diarizationHealth.getCapabilities()
        setCapabilities(caps)
      } else if (api?.streamingDiarization?.isAvailable) {
        const result = await api.streamingDiarization.isAvailable()
        setCapabilities({
          available: result.available,
          pyannoteInstalled: result.available,
          huggingFaceConfigured: result.available,
          device: 'auto',
          error: result.error
        })
      } else {
        setCapabilities({
          available: false,
          pyannoteInstalled: false,
          huggingFaceConfigured: false,
          device: 'unknown',
          error: 'Diarization API not available'
        })
      }
    } catch (error) {
      console.error('[DiarizationSettings] Error checking capabilities:', error)
      setCapabilities({
        available: false,
        pyannoteInstalled: false,
        huggingFaceConfigured: false,
        device: 'unknown',
        error: error instanceof Error ? error.message : 'Unknown error'
      })
    }
  }

  const saveSettings = useCallback(async (newSettings: DiarizationUserSettings) => {
    setIsSaving(true)
    try {
      const api = window.electronAPI as any
      if (api?.settings?.set) {
        await api.settings.set('diarization_settings', newSettings, 'audio')
      }
      setSettings(newSettings)
      onSettingsChange?.(newSettings)
    } catch (error) {
      console.error('[DiarizationSettings] Error saving settings:', error)
    } finally {
      setIsSaving(false)
    }
  }, [onSettingsChange])

  const handleToggleEnabled = useCallback(() => {
    const newSettings = { ...settings, enabled: !settings.enabled }
    saveSettings(newSettings)
  }, [settings, saveSettings])

  const handleToggleAutoRecovery = useCallback(() => {
    const newSettings = { ...settings, autoRecovery: !settings.autoRecovery }
    saveSettings(newSettings)
  }, [settings, saveSettings])

  const handleThresholdChange = useCallback((value: number) => {
    const newSettings = { ...settings, similarityThreshold: value }
    saveSettings(newSettings)
  }, [settings, saveSettings])

  const handleMaxSpeakersChange = useCallback((value: number) => {
    const newSettings = { ...settings, maxSpeakers: value }
    saveSettings(newSettings)
  }, [settings, saveSettings])

  const handleTestConfiguration = async () => {
    setIsTesting(true)
    setTestResult(null)
    try {
      await loadPythonValidation()
      await checkCapabilities()
      await loadModelStatus()

      // Check if everything is configured
      const allPassed = pythonValidation?.success && capabilities?.available && modelStatus?.allAvailable

      setTestResult({
        success: allPassed || false,
        message: allPassed
          ? 'All configuration checks passed!'
          : 'Configuration validation failed. Check status indicators for details.'
      })
    } catch (error) {
      setTestResult({
        success: false,
        message: 'Configuration test failed: ' + (error instanceof Error ? error.message : 'Unknown error')
      })
    } finally {
      setIsTesting(false)
    }
  }

  const handleResetSpeakerId = async () => {
    if (!confirm('Reset Speaker ID configuration? This will clear cache and reset HuggingFace token. This action cannot be undone.')) {
      return
    }

    try {
      const api = window.electronAPI as any

      // Clear Python validation cache
      if (api?.pythonValidation?.clearCache) {
        await api.pythonValidation.clearCache()
      }

      // Reset HF token
      if (api?.settings?.set) {
        await api.settings.set('transcription.hfToken', '', 'transcription')
      }
      setHfToken('')

      // Reload everything
      await checkCapabilities()
      await loadModelStatus()
      await loadPythonValidation()

      alert('Speaker ID configuration has been reset successfully.')
    } catch (error) {
      console.error('[DiarizationSettings] Error resetting Speaker ID:', error)
      alert('Failed to reset Speaker ID: ' + (error instanceof Error ? error.message : 'Unknown error'))
    }
  }

  const handleExportDiagnostics = async () => {
    try {
      const api = window.electronAPI as any

      const report = {
        timestamp: new Date().toISOString(),
        capabilities,
        modelStatus,
        pythonValidation,
        settings,
        userAgent: navigator.userAgent,
        platform: navigator.platform
      }

      const json = JSON.stringify(report, null, 2)
      const filename = `speaker-id-diagnostics-${new Date().toISOString().replace(/:/g, '-').split('.')[0]}.json`

      // Use Electron dialog to save file
      if (api?.dialog?.saveFile) {
        const result = await api.dialog.saveFile(filename, json)
        if (result.success) {
          alert(`Diagnostics report saved successfully to:\n${result.path}`)
        } else {
          // Fallback: copy to clipboard
          await navigator.clipboard.writeText(json)
          alert('File save dialog was cancelled. Diagnostics copied to clipboard instead.')
        }
      } else {
        // Fallback: copy to clipboard
        await navigator.clipboard.writeText(json)
        alert('Diagnostics copied to clipboard (file save not available)')
      }
    } catch (error) {
      console.error('[DiarizationSettings] Error exporting diagnostics:', error)
      alert('Failed to export diagnostics: ' + (error instanceof Error ? error.message : 'Unknown error'))
    }
  }

  if (isLoading) {
    return (
      <div className={cn('flex items-center justify-center p-4', className)}>
        <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
        <span className="ml-2 text-sm text-muted-foreground">Loading settings...</span>
      </div>
    )
  }

  return (
    <div className={cn('space-y-6', className)} data-testid="diarization-settings">
      {/* Header */}
      <div className="flex items-center gap-2">
        <Users className="w-5 h-5 text-primary" />
        <h3 className="font-semibold">Speaker Identification</h3>
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
            {capabilities.available && (
              <p className="text-xs text-green-600 dark:text-green-400 mt-1">
                Device: {capabilities.device}
              </p>
            )}
          </div>
          <button
            onClick={checkCapabilities}
            className="text-muted-foreground hover:text-foreground"
            title="Refresh"
          >
            <RefreshCw className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* PyAnnote Models Status */}
      {modelStatus && (
        <div
          className={cn(
            'flex items-start gap-3 p-3 rounded-lg border',
            modelStatus.allAvailable
              ? 'bg-green-50 border-green-200 dark:bg-green-900/20 dark:border-green-800'
              : 'bg-amber-50 border-amber-200 dark:bg-amber-900/20 dark:border-amber-800'
          )}
          data-testid="pyannote-models-status"
        >
          {modelStatus.allAvailable ? (
            <CheckCircle2 className="w-5 h-5 text-green-600 dark:text-green-400 shrink-0 mt-0.5" />
          ) : (
            <XCircle className="w-5 h-5 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
          )}
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <p className={cn(
                'text-sm font-medium',
                modelStatus.allAvailable
                  ? 'text-green-700 dark:text-green-300'
                  : 'text-amber-700 dark:text-amber-300'
              )}>
                PyAnnote Models {modelStatus.allAvailable ? '✓' : '✗'}
              </p>
              {modelStatus.allAvailable && modelStatus.modelsLocation === 'bundled' && (
                <span className="text-xs text-green-600 dark:text-green-400">(Bundled)</span>
              )}
            </div>
            {!modelStatus.allAvailable && (
              <div className="mt-2 text-sm text-amber-700 dark:text-amber-300">
                <p className="font-medium">PyAnnote models not found.</p>
                <p className="text-xs mt-1">
                  Click <strong>Download Models</strong> to install ({modelStatus.totalDownloadSizeFormatted} download)
                  or check Advanced Troubleshooting for details.
                </p>
              </div>
            )}
            {modelStatus.allAvailable && modelStatus.modelsLocation === 'cache' && (
              <p className="text-xs text-green-600 dark:text-green-400 mt-1">
                Models are cached in your system
              </p>
            )}
          </div>
          {!modelStatus.allAvailable && (
            <button
              onClick={() => setShowDownloadModal(true)}
              className="flex items-center gap-1 px-3 py-1.5 rounded text-xs font-medium bg-amber-600 text-white hover:bg-amber-700 dark:bg-amber-500 dark:hover:bg-amber-600 transition-colors"
              data-testid="download-models-button"
            >
              <Download className="w-3.5 h-3.5" />
              Download
            </button>
          )}
          {modelStatus.allAvailable && (
            <button
              onClick={loadModelStatus}
              className="text-muted-foreground hover:text-foreground"
              title="Refresh"
            >
              <RefreshCw className="w-4 h-4" />
            </button>
          )}
        </div>
      )}

      {/* Python Environment Status */}
      {pythonValidation && (
        <div
          className={cn(
            'flex items-start gap-3 p-3 rounded-lg border',
            pythonValidation.success
              ? 'bg-green-50 border-green-200 dark:bg-green-900/20 dark:border-green-800'
              : 'bg-red-50 border-red-200 dark:bg-red-900/20 dark:border-red-800'
          )}
          data-testid="python-environment-status"
        >
          {pythonValidation.success ? (
            <CheckCircle2 className="w-5 h-5 text-green-600 dark:text-green-400 shrink-0 mt-0.5" />
          ) : (
            <XCircle className="w-5 h-5 text-red-600 dark:text-red-400 shrink-0 mt-0.5" />
          )}
          <div className="flex-1 min-w-0">
            <p className={cn(
              'text-sm font-medium',
              pythonValidation.success
                ? 'text-green-700 dark:text-green-300'
                : 'text-red-700 dark:text-red-300'
            )}>
              Python Environment {pythonValidation.success ? '✓' : '✗'}
            </p>
            {!pythonValidation.success && (
              <div className="mt-2 text-sm text-red-700 dark:text-red-300">
                <p className="font-medium">Python environment validation failed.</p>
                <p className="text-xs mt-1">
                  Click <strong>Export Diagnostics</strong> in Advanced Troubleshooting and contact support.
                </p>
              </div>
            )}
            {pythonValidation.success && (
              <p className="text-xs text-green-600 dark:text-green-400 mt-1">
                Python {pythonValidation.environment.pythonVersion || 'version unknown'}
              </p>
            )}
          </div>
          <button
            onClick={loadPythonValidation}
            className="text-muted-foreground hover:text-foreground"
            title="Refresh"
          >
            <RefreshCw className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* Configuration Action Buttons */}
      <div className="flex flex-wrap gap-2">
        {!capabilities?.huggingFaceConfigured && (
          <button
            onClick={() => setDiagnosticsExpanded(true)}
            className="flex items-center gap-1.5 px-3 py-2 rounded text-sm font-medium bg-yellow-600 text-white hover:bg-yellow-700 transition-colors"
            data-testid="set-hf-token-button"
          >
            <Save className="w-4 h-4" />
            Set HF_TOKEN
          </button>
        )}
        <button
          onClick={handleTestConfiguration}
          disabled={isTesting}
          className="flex items-center gap-1.5 px-3 py-2 rounded text-sm font-medium bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          data-testid="test-configuration-button"
        >
          {isTesting ? (
            <Loader2 className="w-4 h-4 animate-spin" />
          ) : (
            <PlayCircle className="w-4 h-4" />
          )}
          Test Configuration
        </button>
      </div>

      {/* Test Result Display */}
      {testResult && (
        <div
          className={cn(
            'flex items-start gap-2 p-3 rounded-lg border text-sm',
            testResult.success
              ? 'bg-green-50 border-green-200 dark:bg-green-900/20 dark:border-green-800 text-green-700 dark:text-green-300'
              : 'bg-red-50 border-red-200 dark:bg-red-900/20 dark:border-red-800 text-red-700 dark:text-red-300'
          )}
        >
          {testResult.success ? (
            <CheckCircle className="w-5 h-5 shrink-0 mt-0.5" />
          ) : (
            <AlertCircle className="w-5 h-5 shrink-0 mt-0.5" />
          )}
          <p>{testResult.message}</p>
        </div>
      )}

      {/* Inline Help: HuggingFace Token */}
      <div className="flex items-start gap-2 p-3 bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg">
        <Info className="w-4 h-4 text-blue-600 dark:text-blue-400 shrink-0 mt-0.5" />
        <div className="text-xs text-blue-900 dark:text-blue-100">
          <p className="font-medium mb-1">Why is HuggingFace token needed?</p>
          <p>
            PyAnnote speaker diarization models are hosted on HuggingFace.
            A free account token is required to download and use these models.{' '}
            <a
              href="https://huggingface.co/settings/tokens"
              target="_blank"
              rel="noopener noreferrer"
              className="text-blue-600 dark:text-blue-400 hover:underline font-medium"
            >
              Get your token here →
            </a>
          </p>
        </div>
      </div>

      {/* Enable/Disable Toggle */}
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <div className="space-y-0.5">
            <label className="text-sm font-medium" htmlFor="enable-diarization">
              Enable Speaker Identification
            </label>
            <p className="text-xs text-muted-foreground">
              Automatically identify different speakers during recording
            </p>
          </div>
          <button
            id="enable-diarization"
            onClick={handleToggleEnabled}
            disabled={isSaving || !capabilities?.available}
            className={cn(
              'relative inline-flex h-6 w-11 items-center rounded-full transition-colors',
              settings.enabled && capabilities?.available
                ? 'bg-primary'
                : 'bg-muted',
              (isSaving || !capabilities?.available) && 'opacity-50 cursor-not-allowed'
            )}
            data-testid="toggle-diarization-enabled"
          >
            <span
              className={cn(
                'inline-block h-4 w-4 transform rounded-full bg-white transition-transform',
                settings.enabled && capabilities?.available
                  ? 'translate-x-6'
                  : 'translate-x-1'
              )}
            />
          </button>
        </div>

        {/* Auto Recovery Toggle */}
        <div className="flex items-center justify-between">
          <div className="space-y-0.5">
            <label className="text-sm font-medium" htmlFor="auto-recovery">
              Automatic Recovery
            </label>
            <p className="text-xs text-muted-foreground">
              Retry speaker identification after recording if it fails during recording
            </p>
          </div>
          <button
            id="auto-recovery"
            onClick={handleToggleAutoRecovery}
            disabled={isSaving || !settings.enabled}
            className={cn(
              'relative inline-flex h-6 w-11 items-center rounded-full transition-colors',
              settings.autoRecovery && settings.enabled
                ? 'bg-primary'
                : 'bg-muted',
              (isSaving || !settings.enabled) && 'opacity-50 cursor-not-allowed'
            )}
            data-testid="toggle-auto-recovery"
          >
            <span
              className={cn(
                'inline-block h-4 w-4 transform rounded-full bg-white transition-transform',
                settings.autoRecovery && settings.enabled
                  ? 'translate-x-6'
                  : 'translate-x-1'
              )}
            />
          </button>
        </div>
      </div>

      {/* Advanced Settings */}
      <div className="border-t border-border pt-4">
        <button
          onClick={() => setShowAdvanced(!showAdvanced)}
          className="flex items-center justify-between w-full text-sm font-medium hover:text-primary transition-colors"
          data-testid="toggle-advanced-settings"
        >
          <span>Advanced Settings</span>
          {showAdvanced ? (
            <ChevronUp className="w-4 h-4" />
          ) : (
            <ChevronDown className="w-4 h-4" />
          )}
        </button>

        {showAdvanced && (
          <div className="mt-4 space-y-4">
            {/* Similarity Threshold */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <label className="text-sm font-medium" htmlFor="similarity-threshold">
                  Speaker Similarity Threshold
                </label>
                <span className="text-xs text-muted-foreground">
                  {settings.similarityThreshold.toFixed(2)}
                </span>
              </div>
              <input
                id="similarity-threshold"
                type="range"
                min="0.3"
                max="0.7"
                step="0.05"
                value={settings.similarityThreshold}
                onChange={(e) => handleThresholdChange(parseFloat(e.target.value))}
                disabled={isSaving || !settings.enabled}
                className="w-full h-2 bg-muted rounded-lg appearance-none cursor-pointer"
                data-testid="similarity-threshold-slider"
              />
              <p className="text-xs text-muted-foreground">
                Lower values detect more speakers (more sensitive). Higher values merge similar voices.
              </p>
            </div>

            {/* Max Speakers */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <label className="text-sm font-medium" htmlFor="max-speakers">
                  Maximum Speakers
                </label>
                <span className="text-xs text-muted-foreground">
                  {settings.maxSpeakers}
                </span>
              </div>
              <input
                id="max-speakers"
                type="range"
                min="2"
                max="20"
                step="1"
                value={settings.maxSpeakers}
                onChange={(e) => handleMaxSpeakersChange(parseInt(e.target.value))}
                disabled={isSaving || !settings.enabled}
                className="w-full h-2 bg-muted rounded-lg appearance-none cursor-pointer"
                data-testid="max-speakers-slider"
              />
              <p className="text-xs text-muted-foreground">
                Maximum number of different speakers to identify in a recording.
              </p>
            </div>
          </div>
        )}
      </div>

      {/* Diagnostics Section */}
      <div className="border-t border-border pt-4">
        <button
          onClick={() => setDiagnosticsExpanded(!diagnosticsExpanded)}
          className="flex items-center justify-between w-full text-sm font-medium hover:text-primary transition-colors"
          data-testid="toggle-diagnostics"
        >
          <span className="flex items-center gap-2">
            <Info className="w-4 h-4" />
            Diagnostics
          </span>
          {diagnosticsExpanded ? (
            <ChevronUp className="w-4 h-4" />
          ) : (
            <ChevronDown className="w-4 h-4" />
          )}
        </button>

        {diagnosticsExpanded && capabilities && (
          <div className="mt-4 space-y-2 text-xs">
            <div className="grid grid-cols-2 gap-2">
              <div className="bg-muted rounded p-2">
                <span className="text-muted-foreground">Status:</span>
                <span className={cn(
                  'ml-2 font-medium',
                  capabilities.available ? 'text-green-600' : 'text-red-600'
                )}>
                  {capabilities.available ? 'Available' : 'Unavailable'}
                </span>
              </div>
              <div className="bg-muted rounded p-2">
                <span className="text-muted-foreground">Pyannote:</span>
                <span className={cn(
                  'ml-2 font-medium',
                  capabilities.pyannoteInstalled ? 'text-green-600' : 'text-red-600'
                )}>
                  {capabilities.pyannoteInstalled ? 'Installed' : 'Not Installed'}
                </span>
              </div>
              <div className="bg-muted rounded p-2">
                <span className="text-muted-foreground">HuggingFace:</span>
                <span className={cn(
                  'ml-2 font-medium',
                  capabilities.huggingFaceConfigured ? 'text-green-600' : 'text-yellow-600'
                )}>
                  {capabilities.huggingFaceConfigured ? 'Configured' : 'Not Configured'}
                </span>
              </div>
              <div className="bg-muted rounded p-2">
                <span className="text-muted-foreground">Device:</span>
                <span className="ml-2 font-medium">
                  {capabilities.device}
                </span>
              </div>
            </div>

            {/* HuggingFace Token Configuration */}
            <div className={cn(
              'rounded p-3 mt-3',
              capabilities.huggingFaceConfigured
                ? 'bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800'
                : 'bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-800'
            )}>
              <p className={cn(
                'font-medium text-sm',
                capabilities.huggingFaceConfigured
                  ? 'text-green-700 dark:text-green-300'
                  : 'text-yellow-700 dark:text-yellow-300'
              )}>
                {capabilities.huggingFaceConfigured
                  ? 'HuggingFace Token Configured'
                  : 'HuggingFace Token Required'
                }
              </p>
              <p className="text-xs text-muted-foreground mt-1 mb-2">
                Required for speaker diarization using PyAnnote models.
                <a
                  href="https://huggingface.co/settings/tokens"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-blue-600 hover:underline ml-1"
                >
                  Get a token
                </a>
              </p>

              {/* Token Input Field */}
              <div className="flex items-center gap-2 mt-2">
                <div className="relative flex-1">
                  <input
                    type={isTokenVisible ? 'text' : 'password'}
                    value={hfToken}
                    onChange={(e) => setHfToken(e.target.value)}
                    placeholder="Enter your HuggingFace token (hf_...)"
                    className={cn(
                      'w-full px-3 py-1.5 pr-10 text-xs rounded border bg-background',
                      'focus:outline-none focus:ring-2 focus:ring-primary/50',
                      capabilities.huggingFaceConfigured
                        ? 'border-green-300 dark:border-green-700'
                        : 'border-yellow-300 dark:border-yellow-700'
                    )}
                  />
                  <button
                    type="button"
                    onClick={() => setIsTokenVisible(!isTokenVisible)}
                    className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                    title={isTokenVisible ? 'Hide token' : 'Show token'}
                  >
                    {isTokenVisible ? (
                      <EyeOff className="w-3.5 h-3.5" />
                    ) : (
                      <Eye className="w-3.5 h-3.5" />
                    )}
                  </button>
                </div>
                <button
                  onClick={() => saveHfToken(hfToken)}
                  disabled={tokenSaving}
                  className={cn(
                    'flex items-center gap-1 px-2 py-1.5 rounded text-xs font-medium',
                    'bg-primary text-primary-foreground hover:bg-primary/90',
                    'disabled:opacity-50 disabled:cursor-not-allowed'
                  )}
                  title="Save token"
                >
                  {tokenSaving ? (
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  ) : (
                    <Save className="w-3.5 h-3.5" />
                  )}
                  Save
                </button>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Advanced Troubleshooting Section */}
      <div className="border-t border-border pt-4">
        <button
          onClick={() => setTroubleshootingExpanded(!troubleshootingExpanded)}
          className="flex items-center justify-between w-full text-sm font-medium hover:text-primary transition-colors"
          data-testid="toggle-troubleshooting"
        >
          <span className="flex items-center gap-2">
            <Wrench className="w-4 h-4" />
            Advanced Troubleshooting
          </span>
          {troubleshootingExpanded ? (
            <ChevronUp className="w-4 h-4" />
          ) : (
            <ChevronDown className="w-4 h-4" />
          )}
        </button>

        {troubleshootingExpanded && pythonValidation && (
          <div className="mt-4 space-y-4">
            {/* Python Binary Path */}
            <div className="space-y-1">
              <label className="text-xs font-medium text-muted-foreground">Python Binary</label>
              <code className="block text-xs bg-muted p-2 rounded font-mono break-all">
                {pythonValidation.environment.pythonPath || 'Not detected'}
              </code>
            </div>

            {/* Package Versions */}
            {Object.keys(pythonValidation.packageVersions).length > 0 && (
              <div className="space-y-1">
                <label className="text-xs font-medium text-muted-foreground">Package Versions</label>
                <div className="text-xs bg-muted p-2 rounded space-y-1 max-h-32 overflow-y-auto">
                  {Object.entries(pythonValidation.packageVersions).map(([pkg, ver]) => (
                    <div key={pkg} className="flex justify-between font-mono gap-4">
                      <span>{pkg}</span>
                      <span className="text-muted-foreground">{ver}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Model File Locations */}
            {Object.keys(pythonValidation.modelLocations).length > 0 && (
              <div className="space-y-1">
                <label className="text-xs font-medium text-muted-foreground">Model Locations</label>
                <div className="text-xs bg-muted p-2 rounded space-y-2 max-h-32 overflow-y-auto">
                  {Object.entries(pythonValidation.modelLocations).map(([model, location]) => (
                    <div key={model} className="space-y-0.5">
                      <div className="font-medium">{model}</div>
                      <code className="text-[10px] text-muted-foreground break-all block">
                        {location || 'Not found'}
                      </code>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Action Buttons */}
            <div className="flex flex-wrap gap-2 pt-2">
              <button
                onClick={handleResetSpeakerId}
                className="flex items-center gap-1.5 px-3 py-2 rounded text-sm font-medium bg-destructive text-destructive-foreground hover:bg-destructive/90 transition-colors"
                data-testid="reset-speaker-id-button"
              >
                <RotateCcw className="w-4 h-4" />
                Reset Speaker ID
              </button>

              <button
                onClick={handleExportDiagnostics}
                className="flex items-center gap-1.5 px-3 py-2 rounded text-sm font-medium bg-secondary hover:bg-accent transition-colors"
                data-testid="export-diagnostics-button"
              >
                <Download className="w-4 h-4" />
                Export Diagnostics Report
              </button>
            </div>

            {/* Documentation Link */}
            <div className="pt-2 border-t border-border">
              <a
                href="https://github.com/your-repo/docs/speaker-id"
                target="_blank"
                rel="noopener noreferrer"
                className="text-sm text-primary hover:underline flex items-center gap-1"
              >
                <ExternalLink className="w-3.5 h-3.5" />
                View Speaker ID Documentation
              </a>
            </div>
          </div>
        )}
      </div>

      {/* Model Download Modal */}
      <ModelDownloadModal
        isOpen={showDownloadModal}
        onClose={() => setShowDownloadModal(false)}
        onDownloadComplete={handleDownloadComplete}
      />
    </div>
  )
}

export default DiarizationSettings
