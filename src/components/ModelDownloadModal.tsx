/**
 * ModelDownloadModal Component
 *
 * Modal dialog for downloading PyAnnote speaker diarization models.
 * Includes license verification workflow to ensure users have accepted
 * HuggingFace model licenses before attempting downloads.
 *
 * Flow:
 * 1. User enters HuggingFace token
 * 2. System checks license access for all models
 * 3. If licenses not accepted, show clear instructions with links
 * 4. User confirms license acceptance with checkbox
 * 5. Download proceeds with progress tracking
 */

import { useState, useEffect } from 'react'
import { Modal } from './Modal'
import { ProgressBar } from './ui/ProgressBar'
import {
  Download,
  AlertCircle,
  CheckCircle,
  Loader2,
  X,
  ExternalLink,
  Eye,
  EyeOff,
  ShieldCheck,
  ShieldAlert,
  AlertTriangle,
  HelpCircle,
  Terminal,
  FileText,
  FolderSearch,
  Copy,
  Check
} from 'lucide-react'
import { cn } from '@/lib/utils'

// ============================================================================
// Types
// ============================================================================

export interface ModelDownloadModalProps {
  isOpen: boolean
  onClose: () => void
  /** Called when download completes successfully */
  onDownloadComplete?: () => void
  /** Whether to auto-start download when modal opens */
  autoStart?: boolean
  /** Custom title for the modal */
  title?: string
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

interface LicenseCheckResult {
  allAccessible: boolean
  checking: boolean
  modelsRequiringLicense: Array<{
    modelId: string
    modelName: string
    licenseUrl: string
  }>
  accessibleModels: string[]
  error: string | null
  lastCheckTimestamp: number | null
}

interface DownloadProgress {
  modelId: string
  progress: number
  phase: 'initializing' | 'downloading' | 'verifying' | 'complete' | 'error'
  message: string
}

type WorkflowStep = 'token' | 'checking' | 'license-required' | 'ready' | 'downloading' | 'complete' | 'error'

// ============================================================================
// Component
// ============================================================================

export function ModelDownloadModal({
  isOpen,
  onClose,
  onDownloadComplete,
  autoStart: _autoStart = false,
  title = 'Speaker Identification Models'
}: ModelDownloadModalProps) {
  // State
  const [status, setStatus] = useState<PyannoteModelsStatus | null>(null)
  const [licenseCheck, setLicenseCheck] = useState<LicenseCheckResult | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [workflowStep, setWorkflowStep] = useState<WorkflowStep>('token')
  const [progress, setProgress] = useState(0)
  const [currentMessage, setCurrentMessage] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [hfToken, setHfToken] = useState('')
  const [showToken, setShowToken] = useState(false)
  const [tokenSaved, setTokenSaved] = useState(false)
  const [licenseAccepted, setLicenseAccepted] = useState(false)
  const [showHelp, setShowHelp] = useState(false)
  const [showAlternatives, setShowAlternatives] = useState(false)
  const [existingModels, setExistingModels] = useState<{ foundModels: string[], missingModels: string[], cacheLocation: string, canUseExisting: boolean } | null>(null)
  const [copiedCommand, setCopiedCommand] = useState<number | null>(null)

  // Load status and token on open
  useEffect(() => {
    if (isOpen) {
      loadStatus()
      loadHfToken()
      scanExistingModels()
      // Reset state
      setWorkflowStep('token')
      setLicenseCheck(null)
      setError(null)
      setProgress(0)
      setLicenseAccepted(false)
      setShowAlternatives(false)
    }
  }, [isOpen])

  const scanExistingModels = async () => {
    try {
      const api = window.electronAPI as any
      if (api?.modelManager?.scanExisting) {
        const result = await api.modelManager.scanExisting()
        setExistingModels(result)
      }
    } catch (err) {
      console.error('[ModelDownloadModal] Error scanning existing models:', err)
    }
  }

  // Set up event listeners for download progress
  useEffect(() => {
    if (!isOpen) return

    const api = window.electronAPI as any
    if (!api?.modelManager) return

    const unsubProgress = api.modelManager.onDownloadProgress?.((progressData: DownloadProgress) => {
      setProgress(progressData.progress)
      setCurrentMessage(progressData.message)
    })

    const unsubComplete = api.modelManager.onDownloadComplete?.(() => {
      setWorkflowStep('complete')
      setProgress(100)
      setCurrentMessage('Download complete!')
      loadStatus()
      onDownloadComplete?.()
    })

    const unsubError = api.modelManager.onDownloadError?.((data: { error: string }) => {
      setError(data.error)
      setWorkflowStep('error')
    })

    const unsubLicense = api.modelManager.onLicenseRequired?.((_data: { modelId: string; licenseUrl: string }) => {
      // If we receive a license required event during download, update the state
      setWorkflowStep('license-required')
    })

    return () => {
      unsubProgress?.()
      unsubComplete?.()
      unsubError?.()
      unsubLicense?.()
    }
  }, [isOpen, onDownloadComplete])

  // Check for stored license acceptance timestamp
  useEffect(() => {
    if (isOpen) {
      loadLicenseAcceptanceTimestamp()
    }
  }, [isOpen])

  const loadStatus = async () => {
    setIsLoading(true)
    try {
      const api = window.electronAPI as any
      if (api?.modelManager?.getPyannoteStatus) {
        const result = await api.modelManager.getPyannoteStatus()
        setStatus(result)

        // If all models available, go to complete
        if (result.allAvailable) {
          setWorkflowStep('complete')
        }
      }
    } catch (err) {
      console.error('[ModelDownloadModal] Error loading status:', err)
      setError('Failed to check model status')
    } finally {
      setIsLoading(false)
    }
  }

  const loadHfToken = async () => {
    try {
      const api = window.electronAPI as any
      if (api?.db?.settings?.get) {
        const token = await api.db.settings.get('transcription.hfToken')
        if (token) {
          setHfToken(token)
          setTokenSaved(true)
        }
      }
    } catch (err) {
      console.error('[ModelDownloadModal] Error loading HF token:', err)
    }
  }

  const loadLicenseAcceptanceTimestamp = async () => {
    try {
      const api = window.electronAPI as any
      if (api?.db?.settings?.get) {
        const timestamp = await api.db.settings.get('pyannote.licenseAcceptedAt')
        if (timestamp) {
          // If license was accepted within the last 24 hours, pre-check the box
          const hoursSinceAcceptance = (Date.now() - timestamp) / (1000 * 60 * 60)
          if (hoursSinceAcceptance < 24) {
            setLicenseAccepted(true)
          }
        }
      }
    } catch (err) {
      console.error('[ModelDownloadModal] Error loading license timestamp:', err)
    }
  }

  const saveLicenseAcceptanceTimestamp = async () => {
    try {
      const api = window.electronAPI as any
      if (api?.db?.settings?.set) {
        await api.db.settings.set('pyannote.licenseAcceptedAt', Date.now(), 'transcription')
      }
    } catch (err) {
      console.error('[ModelDownloadModal] Error saving license timestamp:', err)
    }
  }

  const saveHfToken = async () => {
    try {
      const api = window.electronAPI as any
      if (api?.db?.settings?.set) {
        await api.db.settings.set('transcription.hfToken', hfToken, 'transcription')
        setTokenSaved(true)
      }
    } catch (err) {
      console.error('[ModelDownloadModal] Error saving HF token:', err)
    }
  }

  const checkLicenseAccess = async () => {
    if (!hfToken) {
      setError('Please enter your HuggingFace token first')
      return
    }

    // Save token if not already saved
    if (!tokenSaved) {
      await saveHfToken()
    }

    setWorkflowStep('checking')
    setError(null)
    setCurrentMessage('Checking model access...')

    try {
      const api = window.electronAPI as any
      if (api?.modelManager?.checkLicenseAccess) {
        const result: LicenseCheckResult = await api.modelManager.checkLicenseAccess(hfToken)
        setLicenseCheck(result)

        if (result.error) {
          setError(result.error)
          setWorkflowStep('error')
        } else if (result.allAccessible) {
          setCurrentMessage('Access verified ✓')
          setWorkflowStep('ready')
        } else {
          setWorkflowStep('license-required')
        }
      }
    } catch (err) {
      console.error('[ModelDownloadModal] Error checking license access:', err)
      setError(err instanceof Error ? err.message : 'Failed to check license access')
      setWorkflowStep('error')
    }
  }

  const startDownload = async () => {
    if (!hfToken) {
      setError('Please enter your HuggingFace token first')
      return
    }

    // Save license acceptance timestamp
    if (licenseAccepted) {
      await saveLicenseAcceptanceTimestamp()
    }

    setWorkflowStep('downloading')
    setError(null)
    setProgress(0)
    setCurrentMessage('Starting download...')

    try {
      const api = window.electronAPI as any
      if (api?.modelManager?.downloadPyannote) {
        const result = await api.modelManager.downloadPyannote(hfToken)
        if (!result.success) {
          setError(result.error || 'Download failed')
          setWorkflowStep('error')
        }
      }
    } catch (err) {
      console.error('[ModelDownloadModal] Error starting download:', err)
      setError(err instanceof Error ? err.message : 'Failed to start download')
      setWorkflowStep('error')
    }
  }

  const cancelDownload = async () => {
    try {
      const api = window.electronAPI as any
      if (api?.modelManager?.cancelDownload) {
        await api.modelManager.cancelDownload()
      }
    } catch (err) {
      console.error('[ModelDownloadModal] Error cancelling download:', err)
    }
    setWorkflowStep('token')
    setProgress(0)
    setCurrentMessage('')
  }

  const openHuggingFace = () => {
    const api = window.electronAPI as any
    api?.shell?.openExternal?.('https://huggingface.co/settings/tokens')
  }

  const openModelLicensePage = (url: string) => {
    const api = window.electronAPI as any
    api?.shell?.openExternal?.(url)
  }

  const proceedWithWarning = () => {
    // Allow user to proceed even if license check failed
    setWorkflowStep('ready')
  }

  const downloadScript = async (platform: 'bash' | 'bat') => {
    if (!hfToken) {
      setError('Please enter your HuggingFace token first')
      return
    }

    try {
      const api = window.electronAPI as any
      if (api?.modelManager?.generateScript) {
        const result = await api.modelManager.generateScript(hfToken, platform)
        if (result.success && result.script) {
          const filename = platform === 'bat' ? 'download_models.bat' : 'download_models.sh'
          const blob = new Blob([result.script], { type: 'text/plain' })
          const url = URL.createObjectURL(blob)
          const a = document.createElement('a')
          a.href = url
          a.download = filename
          a.click()
          URL.revokeObjectURL(url)
        }
      }
    } catch (err) {
      console.error('[ModelDownloadModal] Error downloading script:', err)
      setError('Failed to generate download script')
    }
  }

  const copyCommand = async (command: string, index: number) => {
    try {
      await navigator.clipboard.writeText(command)
      setCopiedCommand(index)
      setTimeout(() => setCopiedCommand(null), 2000)
    } catch (err) {
      console.error('[ModelDownloadModal] Error copying command:', err)
    }
  }

  // Render loading state
  if (isLoading) {
    return (
      <Modal isOpen={isOpen} onClose={onClose} title={title} size="lg">
        <div className="flex items-center justify-center py-12">
          <Loader2 className="w-8 h-8 animate-spin text-purple-500" />
        </div>
      </Modal>
    )
  }

  // Render already downloaded state
  if (status?.allAvailable && workflowStep !== 'downloading') {
    return (
      <Modal isOpen={isOpen} onClose={onClose} title={title} size="lg">
        <div className="space-y-6">
          <div className="flex items-center gap-3 p-4 bg-green-50 dark:bg-green-900/20 rounded-lg border border-green-200 dark:border-green-800">
            <CheckCircle className="w-6 h-6 text-green-600 dark:text-green-400" />
            <div>
              <p className="font-medium text-green-800 dark:text-green-200">
                All speaker identification models are installed
              </p>
              <p className="text-sm text-green-600 dark:text-green-400">
                {status.modelsLocation === 'bundled'
                  ? 'Models are bundled with the application'
                  : 'Models are cached in your system'}
              </p>
            </div>
          </div>

          <div className="flex justify-end">
            <button
              onClick={onClose}
              className="px-4 py-2 bg-purple-600 text-white rounded-lg hover:bg-purple-700 transition-colors"
            >
              Close
            </button>
          </div>
        </div>
      </Modal>
    )
  }

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={title}
      size="lg"
      showCloseButton={workflowStep !== 'downloading' && workflowStep !== 'checking'}
    >
      <div className="space-y-6">
        {/* Description */}
        <div className="space-y-2">
          <p className="text-muted-foreground">
            Speaker identification requires PyAnnote models from HuggingFace.
            {status && !status.allAvailable && (
              <span className="font-medium text-foreground">
                {' '}Download size: {status.totalDownloadSizeFormatted}
              </span>
            )}
          </p>
        </div>

        {/* Step 1: Token Input */}
        {(workflowStep === 'token' || workflowStep === 'error') && (
          <div className="space-y-4">
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <label className="text-sm font-medium text-foreground">
                  HuggingFace Token
                </label>
                <button
                  onClick={openHuggingFace}
                  className="flex items-center gap-1 text-xs text-purple-600 dark:text-purple-400 hover:underline"
                >
                  Get token
                  <ExternalLink className="w-3 h-3" />
                </button>
              </div>
              <div className="relative">
                <input
                  type={showToken ? 'text' : 'password'}
                  value={hfToken}
                  onChange={(e) => {
                    setHfToken(e.target.value)
                    setTokenSaved(false)
                  }}
                  placeholder="hf_xxxxxxxxxxxxxxxxxxxxxxxx"
                  className="w-full px-3 py-2 pr-10 bg-background border border-border rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-transparent"
                />
                <button
                  type="button"
                  onClick={() => setShowToken(!showToken)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                >
                  {showToken ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>

            {/* Help toggle */}
            <button
              onClick={() => setShowHelp(!showHelp)}
              className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
            >
              <HelpCircle className="w-3 h-3" />
              {showHelp ? 'Hide help' : 'Why is this required?'}
            </button>

            {showHelp && (
              <div className="p-3 bg-blue-50 dark:bg-blue-900/20 rounded-lg border border-blue-200 dark:border-blue-800 text-sm space-y-2">
                <p className="text-blue-800 dark:text-blue-200">
                  <strong>About PyAnnote Models</strong>
                </p>
                <ul className="list-disc list-inside text-blue-700 dark:text-blue-300 space-y-1">
                  <li>PyAnnote models are gated on HuggingFace for research licensing</li>
                  <li>You must create a HuggingFace account and accept the license for each model</li>
                  <li>Your token authenticates your account to download the models</li>
                  <li>This is a one-time process - models are cached locally after download</li>
                </ul>
              </div>
            )}

            {/* Missing Models List */}
            {status && status.missingModels.length > 0 && (
              <div className="space-y-2">
                <h4 className="text-sm font-medium text-foreground">Models to download:</h4>
                <div className="space-y-1">
                  {status.missingModels.map((modelId) => {
                    const modelInfo = getModelInfo(modelId)
                    return (
                      <div key={modelId} className="flex items-center gap-2 text-sm text-muted-foreground">
                        <Download className="w-4 h-4" />
                        {modelInfo.name}
                      </div>
                    )
                  })}
                </div>
              </div>
            )}

            {/* Existing Models Detection */}
            {existingModels && existingModels.canUseExisting && (
              <div className="p-3 bg-green-50 dark:bg-green-900/20 rounded-lg border border-green-200 dark:border-green-800">
                <div className="flex items-start gap-2">
                  <FolderSearch className="w-5 h-5 text-green-600 dark:text-green-400 mt-0.5" />
                  <div className="flex-1">
                    <p className="text-sm font-medium text-green-800 dark:text-green-200">
                      Found {existingModels.foundModels.length} existing model(s)
                    </p>
                    <p className="text-xs text-green-600 dark:text-green-400 mt-1">
                      Location: {existingModels.cacheLocation}
                    </p>
                    {existingModels.foundModels.map((modelId) => {
                      const modelInfo = getModelInfo(modelId)
                      return (
                        <div key={modelId} className="flex items-center gap-2 text-xs text-green-600 dark:text-green-400 mt-1">
                          <CheckCircle className="w-3 h-3" />
                          {modelInfo.name}
                        </div>
                      )
                    })}
                  </div>
                </div>
              </div>
            )}

            {/* Troubleshooting & Alternatives */}
            <div className="border-t border-border pt-4">
              <button
                onClick={() => setShowAlternatives(!showAlternatives)}
                className="flex items-center justify-between w-full text-left hover:text-purple-600 dark:hover:text-purple-400 transition-colors"
              >
                <div className="flex items-center gap-2">
                  <Terminal className="w-4 h-4" />
                  <span className="text-sm font-medium">Having trouble downloading? Try alternative methods</span>
                </div>
                <span className="text-xs text-muted-foreground">{showAlternatives ? '▼' : '▶'}</span>
              </button>

              {showAlternatives && (
                <div className="mt-4 space-y-4 p-4 bg-muted/30 rounded-lg">
                  {/* Option 1: Download Script */}
                  <div className="space-y-2">
                    <h4 className="text-sm font-medium text-foreground flex items-center gap-2">
                      <FileText className="w-4 h-4" />
                      Option 1: Download Script
                    </h4>
                    <p className="text-xs text-muted-foreground">
                      Generate a script to run directly from your terminal with your HuggingFace token
                    </p>
                    <div className="flex gap-2">
                      <button
                        onClick={() => downloadScript('bash')}
                        disabled={!hfToken}
                        className={cn(
                          'flex-1 px-3 py-2 text-xs rounded border transition-colors',
                          hfToken
                            ? 'border-purple-300 bg-purple-50 text-purple-700 hover:bg-purple-100 dark:border-purple-700 dark:bg-purple-900/30 dark:text-purple-300 dark:hover:bg-purple-900/50'
                            : 'border-gray-200 bg-gray-100 text-gray-400 cursor-not-allowed dark:border-gray-700 dark:bg-gray-800'
                        )}
                      >
                        <Download className="w-3 h-3 inline mr-1" />
                        download_models.sh (Mac/Linux)
                      </button>
                      <button
                        onClick={() => downloadScript('bat')}
                        disabled={!hfToken}
                        className={cn(
                          'flex-1 px-3 py-2 text-xs rounded border transition-colors',
                          hfToken
                            ? 'border-purple-300 bg-purple-50 text-purple-700 hover:bg-purple-100 dark:border-purple-700 dark:bg-purple-900/30 dark:text-purple-300 dark:hover:bg-purple-900/50'
                            : 'border-gray-200 bg-gray-100 text-gray-400 cursor-not-allowed dark:border-gray-700 dark:bg-gray-800'
                        )}
                      >
                        <Download className="w-3 h-3 inline mr-1" />
                        download_models.bat (Windows)
                      </button>
                    </div>
                  </div>

                  {/* Option 2: Manual Python Commands */}
                  <div className="space-y-2">
                    <h4 className="text-sm font-medium text-foreground flex items-center gap-2">
                      <Terminal className="w-4 h-4" />
                      Option 2: Manual Python Commands
                    </h4>
                    <p className="text-xs text-muted-foreground">
                      Run these commands one by one in your terminal
                    </p>
                    <div className="space-y-2">
                      {[
                        { cmd: 'pyannote/segmentation-3.0', name: 'Segmentation Model' },
                        { cmd: 'pyannote/wespeaker-voxceleb-resnet34-LM', name: 'Speaker Embedding' },
                        { cmd: 'pyannote/speaker-diarization-3.1', name: 'Diarization Pipeline' }
                      ].map((model, idx) => (
                        <div key={idx} className="relative">
                          <code className="block text-xs bg-background border border-border rounded px-3 py-2 pr-20 overflow-x-auto">
                            python -c "from huggingface_hub import snapshot_download; snapshot_download('{model.cmd}', token='{hfToken || 'YOUR_TOKEN'}')"
                          </code>
                          <button
                            onClick={() => copyCommand(`python -c "from huggingface_hub import snapshot_download; snapshot_download('${model.cmd}', token='${hfToken}')"`, idx)}
                            className="absolute right-2 top-2 px-2 py-1 text-xs bg-purple-100 dark:bg-purple-900/30 text-purple-700 dark:text-purple-300 rounded hover:bg-purple-200 dark:hover:bg-purple-900/50 transition-colors"
                          >
                            {copiedCommand === idx ? (
                              <>
                                <Check className="w-3 h-3 inline mr-1" />
                                Copied!
                              </>
                            ) : (
                              <>
                                <Copy className="w-3 h-3 inline mr-1" />
                                Copy
                              </>
                            )}
                          </button>
                          <p className="text-xs text-muted-foreground mt-1">{model.name}</p>
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* Option 3: Cache Directory Info */}
                  {existingModels && (
                    <div className="space-y-2">
                      <h4 className="text-sm font-medium text-foreground flex items-center gap-2">
                        <FolderSearch className="w-4 h-4" />
                        Option 3: Manual File Placement
                      </h4>
                      <p className="text-xs text-muted-foreground">
                        If you've downloaded models elsewhere, place them in:
                      </p>
                      <code className="block text-xs bg-background border border-border rounded px-3 py-2 overflow-x-auto">
                        {existingModels.cacheLocation}/hub/
                      </code>
                      <p className="text-xs text-muted-foreground">
                        Expected directory structure: models--pyannote--[model-name]/snapshots/[hash]/
                      </p>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        )}

        {/* Step 2: Checking License Access */}
        {workflowStep === 'checking' && (
          <div className="flex flex-col items-center justify-center py-8 space-y-4">
            <Loader2 className="w-10 h-10 animate-spin text-purple-500" />
            <div className="text-center">
              <p className="font-medium text-foreground">Checking model access...</p>
              <p className="text-sm text-muted-foreground mt-1">
                Verifying your token and license permissions
              </p>
            </div>
          </div>
        )}

        {/* Step 3: License Required */}
        {workflowStep === 'license-required' && licenseCheck && (
          <div className="space-y-4">
            <div className="flex items-start gap-3 p-4 bg-amber-50 dark:bg-amber-900/20 rounded-lg border border-amber-200 dark:border-amber-800">
              <ShieldAlert className="w-6 h-6 text-amber-600 dark:text-amber-400 mt-0.5" />
              <div className="flex-1">
                <p className="font-medium text-amber-800 dark:text-amber-200">
                  License acceptance required
                </p>
                <p className="text-sm text-amber-700 dark:text-amber-300 mt-1">
                  PyAnnote models require you to accept their license on HuggingFace before downloading.
                </p>
              </div>
            </div>

            <div className="space-y-3">
              <h4 className="text-sm font-medium text-foreground">Please complete these steps:</h4>
              <ol className="list-decimal list-inside space-y-3 text-sm">
                <li className="text-muted-foreground">
                  Visit each model page below and click <strong>"Agree and access repository"</strong>:
                </li>
              </ol>

              <div className="space-y-2 ml-4">
                {licenseCheck.modelsRequiringLicense.map((model) => (
                  <button
                    key={model.modelId}
                    onClick={() => openModelLicensePage(model.licenseUrl)}
                    className="flex items-center gap-2 w-full p-3 bg-background border border-border rounded-lg hover:border-purple-400 hover:bg-purple-50 dark:hover:bg-purple-900/20 transition-colors text-left"
                  >
                    <ShieldAlert className="w-5 h-5 text-amber-500" />
                    <div className="flex-1">
                      <p className="font-medium text-foreground">{model.modelName}</p>
                      <p className="text-xs text-muted-foreground truncate">{model.licenseUrl}</p>
                    </div>
                    <ExternalLink className="w-4 h-4 text-muted-foreground" />
                  </button>
                ))}
              </div>

              <ol className="list-decimal list-inside space-y-3 text-sm" start={2}>
                <li className="text-muted-foreground">
                  After accepting all licenses, return here and confirm below
                </li>
              </ol>
            </div>

            {/* Accessible models (if any) */}
            {licenseCheck.accessibleModels.length > 0 && (
              <div className="p-3 bg-green-50 dark:bg-green-900/20 rounded-lg border border-green-200 dark:border-green-800">
                <p className="text-sm text-green-800 dark:text-green-200 flex items-center gap-2">
                  <CheckCircle className="w-4 h-4" />
                  Already accessible: {licenseCheck.accessibleModels.map(m => getModelInfo(m).name).join(', ')}
                </p>
              </div>
            )}

            {/* License acceptance checkbox */}
            <label className="flex items-start gap-3 p-3 bg-background border border-border rounded-lg cursor-pointer hover:border-purple-400 transition-colors">
              <input
                type="checkbox"
                checked={licenseAccepted}
                onChange={(e) => setLicenseAccepted(e.target.checked)}
                className="mt-0.5 w-4 h-4 rounded border-border text-purple-600 focus:ring-purple-500"
              />
              <span className="text-sm text-foreground">
                I have accepted the license agreements for all models listed above
              </span>
            </label>
          </div>
        )}

        {/* Step 4: Ready to Download */}
        {workflowStep === 'ready' && (
          <div className="space-y-4">
            <div className="flex items-center gap-3 p-4 bg-green-50 dark:bg-green-900/20 rounded-lg border border-green-200 dark:border-green-800">
              <ShieldCheck className="w-6 h-6 text-green-600 dark:text-green-400" />
              <div>
                <p className="font-medium text-green-800 dark:text-green-200">
                  Access verified ✓
                </p>
                <p className="text-sm text-green-600 dark:text-green-400">
                  Your account has access to all required models
                </p>
              </div>
            </div>

            {status && (
              <div className="text-sm text-muted-foreground">
                <p>Ready to download {status.missingModels.length} model(s) ({status.totalDownloadSizeFormatted})</p>
              </div>
            )}
          </div>
        )}

        {/* Step 5: Downloading */}
        {workflowStep === 'downloading' && (
          <div className="space-y-4">
            <div className="flex items-center gap-2">
              <Loader2 className="w-5 h-5 animate-spin text-purple-500" />
              <span className="text-sm font-medium text-foreground">Downloading models...</span>
            </div>
            <ProgressBar
              value={progress}
              variant="primary"
              size="md"
              showLabel
              animated
            />
            {currentMessage && (
              <p className="text-sm text-muted-foreground">{currentMessage}</p>
            )}
          </div>
        )}

        {/* Step 6: Complete */}
        {workflowStep === 'complete' && (
          <div className="flex items-center gap-3 p-4 bg-green-50 dark:bg-green-900/20 rounded-lg border border-green-200 dark:border-green-800">
            <CheckCircle className="w-6 h-6 text-green-600 dark:text-green-400" />
            <div>
              <p className="font-medium text-green-800 dark:text-green-200">
                Download complete!
              </p>
              <p className="text-sm text-green-600 dark:text-green-400">
                All speaker identification models are now installed
              </p>
            </div>
          </div>
        )}

        {/* Error Display */}
        {error && (
          <div className="space-y-3">
            <div className="flex items-start gap-3 p-4 bg-red-50 dark:bg-red-900/20 rounded-lg border border-red-200 dark:border-red-800">
              <AlertCircle className="w-5 h-5 text-red-600 dark:text-red-400 mt-0.5" />
              <div className="flex-1">
                <p className="font-medium text-red-800 dark:text-red-200">Error</p>
                <p className="text-sm text-red-600 dark:text-red-400 mt-1">{error}</p>
                {(error.includes('Access denied') || error.includes('401') || error.includes('403') || error.includes('License')) && (
                  <p className="text-sm text-red-600 dark:text-red-400 mt-2">
                    Please ensure you have accepted the model licenses on HuggingFace, then try again.
                  </p>
                )}
              </div>
            </div>
            {/* Show alternatives on error */}
            <div className="p-3 bg-blue-50 dark:bg-blue-900/20 rounded-lg border border-blue-200 dark:border-blue-800">
              <button
                onClick={() => setShowAlternatives(!showAlternatives)}
                className="flex items-center justify-between w-full text-left"
              >
                <div className="flex items-center gap-2">
                  <Terminal className="w-4 h-4 text-blue-600 dark:text-blue-400" />
                  <span className="text-sm font-medium text-blue-800 dark:text-blue-200">
                    Try alternative download methods
                  </span>
                </div>
                <span className="text-xs text-blue-600 dark:text-blue-400">{showAlternatives ? '▼' : '▶'}</span>
              </button>
            </div>
          </div>
        )}

        {/* Graceful fallback option */}
        {workflowStep === 'error' && error?.includes('check license') && (
          <div className="flex items-start gap-3 p-3 bg-amber-50 dark:bg-amber-900/20 rounded-lg border border-amber-200 dark:border-amber-800">
            <AlertTriangle className="w-5 h-5 text-amber-600 dark:text-amber-400 mt-0.5" />
            <div className="flex-1">
              <p className="text-sm text-amber-700 dark:text-amber-300">
                If you've already accepted the licenses, you can proceed with the download.
                The download may fail if licenses haven't been accepted.
              </p>
              <button
                onClick={proceedWithWarning}
                className="mt-2 text-sm text-amber-700 dark:text-amber-300 underline hover:no-underline"
              >
                Proceed anyway →
              </button>
            </div>
          </div>
        )}

        {/* Action Buttons */}
        <div className="flex justify-end gap-3 pt-2">
          {workflowStep === 'token' && (
            <>
              <button
                onClick={onClose}
                className="px-4 py-2 text-muted-foreground hover:text-foreground transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={checkLicenseAccess}
                disabled={!hfToken}
                className={cn(
                  'px-4 py-2 rounded-lg flex items-center gap-2 transition-colors',
                  hfToken
                    ? 'bg-purple-600 text-white hover:bg-purple-700'
                    : 'bg-gray-200 dark:bg-gray-700 text-gray-400 dark:text-gray-500 cursor-not-allowed'
                )}
              >
                <ShieldCheck className="w-4 h-4" />
                Check Access
              </button>
            </>
          )}

          {workflowStep === 'license-required' && (
            <>
              <button
                onClick={() => setWorkflowStep('token')}
                className="px-4 py-2 text-muted-foreground hover:text-foreground transition-colors"
              >
                Back
              </button>
              <button
                onClick={checkLicenseAccess}
                className="px-4 py-2 bg-purple-100 dark:bg-purple-900/30 text-purple-700 dark:text-purple-300 rounded-lg hover:bg-purple-200 dark:hover:bg-purple-900/50 transition-colors"
              >
                Re-check Access
              </button>
              <button
                onClick={startDownload}
                disabled={!licenseAccepted}
                className={cn(
                  'px-4 py-2 rounded-lg flex items-center gap-2 transition-colors',
                  licenseAccepted
                    ? 'bg-purple-600 text-white hover:bg-purple-700'
                    : 'bg-gray-200 dark:bg-gray-700 text-gray-400 dark:text-gray-500 cursor-not-allowed'
                )}
              >
                <Download className="w-4 h-4" />
                Download Models
              </button>
            </>
          )}

          {workflowStep === 'ready' && (
            <>
              <button
                onClick={() => setWorkflowStep('token')}
                className="px-4 py-2 text-muted-foreground hover:text-foreground transition-colors"
              >
                Back
              </button>
              <button
                onClick={startDownload}
                className="px-4 py-2 bg-purple-600 text-white rounded-lg hover:bg-purple-700 transition-colors flex items-center gap-2"
              >
                <Download className="w-4 h-4" />
                Download Models
              </button>
            </>
          )}

          {workflowStep === 'downloading' && (
            <button
              onClick={cancelDownload}
              className="px-4 py-2 bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-300 rounded-lg hover:bg-red-200 dark:hover:bg-red-900/50 transition-colors flex items-center gap-2"
            >
              <X className="w-4 h-4" />
              Cancel
            </button>
          )}

          {workflowStep === 'complete' && (
            <button
              onClick={onClose}
              className="px-4 py-2 bg-purple-600 text-white rounded-lg hover:bg-purple-700 transition-colors"
            >
              Close
            </button>
          )}

          {workflowStep === 'error' && (
            <>
              <button
                onClick={onClose}
                className="px-4 py-2 text-muted-foreground hover:text-foreground transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={() => {
                  setError(null)
                  setWorkflowStep('token')
                }}
                className="px-4 py-2 bg-purple-600 text-white rounded-lg hover:bg-purple-700 transition-colors"
              >
                Try Again
              </button>
            </>
          )}
        </div>
      </div>
    </Modal>
  )
}

// Helper function to get model display info
function getModelInfo(modelId: string): { name: string; url: string } {
  const modelInfoMap: Record<string, { name: string; url: string }> = {
    'pyannote-segmentation-3.0': {
      name: 'Segmentation Model',
      url: 'https://huggingface.co/pyannote/segmentation-3.0'
    },
    'pyannote-embedding': {
      name: 'Speaker Embedding Model',
      url: 'https://huggingface.co/pyannote/wespeaker-voxceleb-resnet34-LM'
    },
    'pyannote-speaker-diarization-3.1': {
      name: 'Speaker Diarization Pipeline',
      url: 'https://huggingface.co/pyannote/speaker-diarization-3.1'
    }
  }
  return modelInfoMap[modelId] || { name: modelId, url: 'https://huggingface.co/pyannote' }
}

export default ModelDownloadModal
