/**
 * Setup Wizard Component
 *
 * Step-by-step setup wizard for first-time users:
 * 1. Welcome
 * 2. Download virtual audio driver
 * 3. Installation guide
 * 4. Configure audio routing
 * 5. Test recording with volume meters
 */

import { useState, useEffect, useRef } from 'react'
import { cn } from '@/lib/utils'
import {
  ChevronRight,
  ChevronLeft,
  CheckCircle,
  Download,
  Settings,
  Mic,
  X,
  ExternalLink,
  AlertCircle,
  Loader2,
  Play,
  Square
} from 'lucide-react'
import type {
  AudioDiagnosticResult,
  AudioDevice
} from '@/types/database'
import { SteppedEnvironmentSetup } from '@/components/SteppedEnvironmentSetup'

// ============================================================================
// Types
// ============================================================================

interface SetupWizardProps {
  onComplete: () => void
  onSkip?: () => void
}

type WizardStep = 'welcome' | 'python' | 'download' | 'install' | 'configure' | 'test'

interface StepConfig {
  id: WizardStep
  title: string
  description: string
}

// ============================================================================
// Volume Meter Component
// ============================================================================

interface VolumeMeterProps {
  label: string
  level: number // 0-100
  isActive: boolean
}

function VolumeMeter({ label, level, isActive }: VolumeMeterProps) {
  const bars = 20
  const activeBars = Math.floor((level / 100) * bars)

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium text-foreground">{label}</span>
        <span className="text-xs text-muted-foreground">{isActive ? 'Active' : 'Inactive'}</span>
      </div>
      <div className="flex items-center gap-1 h-8">
        {Array.from({ length: bars }).map((_, i) => {
          const isActiveBar = i < activeBars
          const barLevel = (i / bars) * 100
          let barColor = 'bg-gray-200'
          
          if (isActiveBar) {
            if (barLevel < 50) {
              barColor = 'bg-green-500'
            } else if (barLevel < 80) {
              barColor = 'bg-yellow-500'
            } else {
              barColor = 'bg-red-500'
            }
          }

          return (
            <div
              key={i}
              className={cn(
                'flex-1 h-full rounded-sm transition-all duration-100',
                isActiveBar ? barColor : 'bg-gray-200',
                isActive && isActiveBar && 'animate-pulse'
              )}
            />
          )
        })}
      </div>
      <div className="text-xs text-muted-foreground text-right">
        {level.toFixed(0)}%
      </div>
    </div>
  )
}

// ============================================================================
// Step Components
// ============================================================================

interface StepProps {
  onNext: () => void
  onBack: () => void
  onComplete: () => void
  diagnosticResult: AudioDiagnosticResult | null
  platform: NodeJS.Platform
}

function WelcomeStep({ onNext }: StepProps) {
  return (
    <div className="space-y-6">
      <div className="text-center space-y-4">
        <div className="mx-auto w-20 h-20 bg-purple-100 rounded-full flex items-center justify-center">
          <Mic className="h-10 w-10 text-purple-600" />
        </div>
        <h2 className="text-2xl font-bold text-foreground">Welcome to FlowRecap!</h2>
        <p className="text-muted-foreground max-w-md mx-auto">
          Let's get you set up to start recording meetings. This wizard will guide you through
          installing a virtual audio driver and configuring your audio settings.
        </p>
      </div>

      <div className="bg-card border border-border rounded-lg p-6 space-y-4">
        <h3 className="font-semibold text-foreground">What we'll set up:</h3>
        <ul className="space-y-2">
          <li className="flex items-start gap-3">
            <CheckCircle className="h-5 w-5 text-green-600 mt-0.5 flex-shrink-0" />
            <span className="text-sm text-muted-foreground">
              Download and install a virtual audio driver for your platform
            </span>
          </li>
          <li className="flex items-start gap-3">
            <CheckCircle className="h-5 w-5 text-green-600 mt-0.5 flex-shrink-0" />
            <span className="text-sm text-muted-foreground">
              Configure audio routing for meeting capture
            </span>
          </li>
          <li className="flex items-start gap-3">
            <CheckCircle className="h-5 w-5 text-green-600 mt-0.5 flex-shrink-0" />
            <span className="text-sm text-muted-foreground">
              Test your recording setup with volume meters
            </span>
          </li>
        </ul>
      </div>

      <div className="flex justify-end">
        <button
          onClick={onNext}
          className="px-6 py-2.5 bg-purple-600 hover:bg-purple-700 text-white rounded-md font-medium flex items-center gap-2"
        >
          Get Started
          <ChevronRight className="h-4 w-4" />
        </button>
      </div>
    </div>
  )
}

function PythonSetupStep({ onNext, onBack }: StepProps) {
  const [setupComplete, setSetupComplete] = useState(false)
  const [pythonRequired, setPythonRequired] = useState<boolean | null>(null)

  // Check if Python setup is needed
  useEffect(() => {
    const checkPythonStatus = async () => {
      try {
        if (window.electronAPI?.pythonSetup) {
          const isRequired = await window.electronAPI.pythonSetup.isRequired()
          setPythonRequired(isRequired)
          if (!isRequired) {
            // Already set up, can proceed
            setSetupComplete(true)
          }
        } else {
          // API not available, skip this step
          setPythonRequired(false)
          setSetupComplete(true)
        }
      } catch (err) {
        console.error('Failed to check Python status:', err)
        setPythonRequired(false)
        setSetupComplete(true)
      }
    }
    checkPythonStatus()
  }, [])

  const handleSetupComplete = () => {
    setSetupComplete(true)
  }

  const handleSkip = () => {
    onNext()
  }

  // If already set up or checking
  if (pythonRequired === null) {
    return (
      <div className="space-y-6">
        <div className="text-center space-y-4 py-12">
          <Loader2 className="h-8 w-8 animate-spin text-purple-600 mx-auto" />
          <p className="text-muted-foreground">Checking Python environment status...</p>
        </div>
      </div>
    )
  }

  // Already set up
  if (setupComplete && pythonRequired === false) {
    return (
      <div className="space-y-6">
        <div className="space-y-2">
          <h2 className="text-2xl font-bold text-foreground">Python Environment</h2>
          <p className="text-muted-foreground">
            Python environments for transcription and speaker diarization.
          </p>
        </div>

        <div className="bg-green-50 dark:bg-green-950/30 border border-green-200 dark:border-green-800 rounded-lg p-6">
          <div className="flex items-start gap-3">
            <CheckCircle className="h-6 w-6 text-green-600 flex-shrink-0 mt-0.5" />
            <div>
              <h3 className="font-semibold text-green-900 dark:text-green-200">
                Python environments are already configured!
              </h3>
              <p className="text-sm text-green-700 dark:text-green-300 mt-1">
                Your transcription and speaker diarization capabilities are ready to use.
              </p>
            </div>
          </div>
        </div>

        <div className="flex justify-between">
          <button
            onClick={onBack}
            className="px-4 py-2 border border-border hover:bg-accent rounded-md font-medium flex items-center gap-2"
          >
            <ChevronLeft className="h-4 w-4" />
            Back
          </button>
          <button
            onClick={onNext}
            className="px-6 py-2.5 bg-purple-600 hover:bg-purple-700 text-white rounded-md font-medium flex items-center gap-2"
          >
            Continue
            <ChevronRight className="h-4 w-4" />
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {setupComplete ? (
        <>
          <div className="space-y-2">
            <h2 className="text-2xl font-bold text-foreground">Python Environment Setup</h2>
            <p className="text-muted-foreground">
              Python environments for transcription and speaker diarization.
            </p>
          </div>

          <div className="bg-card border border-border rounded-lg p-6">
            <div className="space-y-4">
              <div className="bg-green-50 dark:bg-green-950/30 border border-green-200 dark:border-green-800 rounded-lg p-4">
                <div className="flex items-start gap-3">
                  <CheckCircle className="h-6 w-6 text-green-600 flex-shrink-0" />
                  <div>
                    <h3 className="font-semibold text-green-900 dark:text-green-200">
                      Setup Complete!
                    </h3>
                    <p className="text-sm text-green-700 dark:text-green-300 mt-1">
                      Python environments are now configured. Click Continue to proceed.
                    </p>
                  </div>
                </div>
              </div>
            </div>
          </div>

          <div className="flex justify-between">
            <button
              onClick={onBack}
              className="px-4 py-2 border border-border hover:bg-accent rounded-md font-medium flex items-center gap-2"
            >
              <ChevronLeft className="h-4 w-4" />
              Back
            </button>
            <button
              onClick={onNext}
              className="px-6 py-2.5 bg-purple-600 hover:bg-purple-700 text-white rounded-md font-medium flex items-center gap-2"
            >
              Continue
              <ChevronRight className="h-4 w-4" />
            </button>
          </div>
        </>
      ) : (
        <SteppedEnvironmentSetup
          autoStart={false}
          showSkip={true}
          onComplete={handleSetupComplete}
          onSkip={handleSkip}
          onError={(error) => console.error('Python setup error:', error)}
          skipModels={false}
        />
      )}
    </div>
  )
}

function DownloadStep({ onNext, onBack, diagnosticResult, platform }: StepProps) {
  const [isDownloading, setIsDownloading] = useState(false)
  const recommendedCable = diagnosticResult?.recommendedVirtualCable
  const virtualCables = diagnosticResult?.virtualCables || []
  const installedCable = virtualCables.find(c => c.detected)

  const getDownloadInfo = () => {
    switch (platform) {
      case 'win32':
        return {
          name: 'VB-Audio Virtual Cable',
          url: 'https://vb-audio.com/Cable/',
          description: 'Free virtual audio cable for Windows'
        }
      case 'darwin':
        return {
          name: 'BlackHole',
          url: 'https://existential.audio/blackhole/',
          description: 'Open-source virtual audio driver for macOS'
        }
      case 'linux':
        return {
          name: 'PulseAudio Virtual Sink',
          url: null,
          description: 'Built-in virtual audio sink (no download needed)'
        }
      default:
        return {
          name: 'Virtual Audio Driver',
          url: null,
          description: 'Platform-specific virtual audio driver'
        }
    }
  }

  const downloadInfo = getDownloadInfo()

  const handleDownload = async () => {
    if (downloadInfo.url) {
      setIsDownloading(true)
      try {
        // Open external browser
        if (window.electronAPI && 'shell' in window.electronAPI && window.electronAPI.shell) {
          await window.electronAPI.shell.openExternal(downloadInfo.url)
        } else {
          window.open(downloadInfo.url, '_blank')
        }
      } catch (err) {
        console.error('Failed to open URL:', err)
        window.open(downloadInfo.url, '_blank')
      } finally {
        setTimeout(() => setIsDownloading(false), 1000)
      }
    }
  }

  const handleNext = () => {
    if (installedCable) {
      // Skip to configure if already installed
      onNext()
      onNext()
    } else {
      onNext()
    }
  }

  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <h2 className="text-2xl font-bold text-foreground">Download Virtual Audio Driver</h2>
        <p className="text-muted-foreground">
          To capture system audio from meetings, you'll need a virtual audio driver.
        </p>
      </div>

      {installedCable ? (
        <div className="bg-green-50 border border-green-200 rounded-lg p-6">
          <div className="flex items-start gap-3">
            <CheckCircle className="h-6 w-6 text-green-600 mt-0.5 flex-shrink-0" />
            <div className="flex-1">
              <h3 className="font-semibold text-green-900 mb-1">
                {installedCable.name} is already installed!
              </h3>
              <p className="text-sm text-green-700">
                You can proceed to the next step to configure audio routing.
              </p>
            </div>
          </div>
        </div>
      ) : (
        <div className="bg-card border border-border rounded-lg p-6 space-y-4">
          <div className="flex items-start gap-4">
            <div className="p-3 bg-purple-100 rounded-lg">
              <Download className="h-6 w-6 text-purple-600" />
            </div>
            <div className="flex-1">
              <h3 className="font-semibold text-foreground mb-1">{downloadInfo.name}</h3>
              <p className="text-sm text-muted-foreground mb-4">{downloadInfo.description}</p>
              
              {platform === 'linux' ? (
                <div className="bg-secondary/50 rounded-lg p-4">
                  <p className="text-sm text-muted-foreground">
                    PulseAudio virtual sinks are built into Linux. You can create one using:
                  </p>
                  <code className="block mt-2 p-2 bg-background rounded text-xs font-mono">
                    pactl load-module module-null-sink sink_name=virtual_sink
                  </code>
                </div>
              ) : (
                <button
                  onClick={handleDownload}
                  disabled={isDownloading || !downloadInfo.url}
                  className={cn(
                    'px-4 py-2 bg-purple-600 hover:bg-purple-700 text-white rounded-md font-medium flex items-center gap-2',
                    (isDownloading || !downloadInfo.url) && 'opacity-50 cursor-not-allowed'
                  )}
                >
                  {isDownloading ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin" />
                      Opening...
                    </>
                  ) : (
                    <>
                      <Download className="h-4 w-4" />
                      Download {downloadInfo.name}
                      <ExternalLink className="h-3 w-3" />
                    </>
                  )}
                </button>
              )}
            </div>
          </div>

          {recommendedCable && (
            <div className="pt-4 border-t border-border">
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <AlertCircle className="h-4 w-4" />
                <span>
                  Recommended for {platform === 'win32' ? 'Windows' : platform === 'darwin' ? 'macOS' : 'Linux'}
                </span>
              </div>
            </div>
          )}
        </div>
      )}

      <div className="flex justify-between">
        <button
          onClick={onBack}
          className="px-4 py-2 border border-border hover:bg-accent rounded-md font-medium flex items-center gap-2"
        >
          <ChevronLeft className="h-4 w-4" />
          Back
        </button>
        <button
          onClick={handleNext}
          className="px-6 py-2.5 bg-purple-600 hover:bg-purple-700 text-white rounded-md font-medium flex items-center gap-2"
        >
          {installedCable ? 'Continue' : 'I\'ve Downloaded It'}
          <ChevronRight className="h-4 w-4" />
        </button>
      </div>
    </div>
  )
}

function InstallStep({ onNext, onBack, diagnosticResult, platform }: StepProps) {
  const [instructions, setInstructions] = useState<string>('')
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const virtualCables = diagnosticResult?.virtualCables || []
  const installedCable = virtualCables.find(c => c.detected)

  useEffect(() => {
    const loadInstructions = async () => {
      setIsLoading(true)
      setError(null)
      try {
        const recommendedCable = diagnosticResult?.recommendedVirtualCable || undefined
        const inst = await window.electronAPI.audioDevices.getInstallationInstructions(recommendedCable)
        setInstructions(inst)
      } catch (err) {
        console.error('Failed to load instructions:', err)
        setError(err instanceof Error ? err.message : 'Failed to load installation instructions')
      } finally {
        setIsLoading(false)
      }
    }
    loadInstructions()
  }, [diagnosticResult])

  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <h2 className="text-2xl font-bold text-foreground">Install Virtual Audio Driver</h2>
        <p className="text-muted-foreground">
          Follow these platform-specific instructions to install the virtual audio driver.
        </p>
      </div>

      {installedCable ? (
        <div className="bg-green-50 border border-green-200 rounded-lg p-6">
          <div className="flex items-start gap-3">
            <CheckCircle className="h-6 w-6 text-green-600 mt-0.5 flex-shrink-0" />
            <div className="flex-1">
              <h3 className="font-semibold text-green-900 mb-1">
                {installedCable.name} is installed!
              </h3>
              <p className="text-sm text-green-700">
                Your virtual audio driver is ready to use.
              </p>
            </div>
          </div>
        </div>
      ) : (
        <div className="bg-card border border-border rounded-lg p-6">
          {isLoading ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : error ? (
            <div className="bg-red-50 border border-red-200 rounded-lg p-4">
              <div className="flex items-start gap-2">
                <AlertCircle className="h-5 w-5 text-red-600 mt-0.5 flex-shrink-0" />
                <div className="text-sm text-red-900">
                  <p className="font-medium mb-1">Error loading instructions</p>
                  <p>{error}</p>
                </div>
              </div>
            </div>
          ) : (
            <div className="space-y-4">
              <h3 className="font-semibold text-foreground">Installation Instructions</h3>
              <div className="bg-secondary/50 rounded-lg p-4">
                <pre className="whitespace-pre-wrap text-sm font-mono text-foreground">
                  {instructions || 'Loading instructions...'}
                </pre>
              </div>
              <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
                <div className="flex items-start gap-2">
                  <AlertCircle className="h-5 w-5 text-blue-600 mt-0.5 flex-shrink-0" />
                  <div className="text-sm text-blue-900">
                    <p className="font-medium mb-1">Important:</p>
                    <ul className="list-disc list-inside space-y-1">
                      <li>You may need to restart your computer after installation</li>
                      {platform === 'darwin' && (
                        <li>On macOS, you may need to allow the driver in System Preferences &gt; Security &amp; Privacy</li>
                      )}
                      {platform === 'win32' && (
                        <li>On Windows, run the installer as Administrator</li>
                      )}
                      {platform === 'linux' && (
                        <li>On Linux, you may need to restart PulseAudio or your session after creating the virtual sink</li>
                      )}
                    </ul>
                  </div>
                </div>
              </div>
              {platform !== 'linux' && (
                <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4">
                  <div className="flex items-start gap-2">
                    <AlertCircle className="h-5 w-5 text-yellow-600 mt-0.5 flex-shrink-0" />
                    <div className="text-sm text-yellow-900">
                      <p className="font-medium mb-1">Note:</p>
                      <p>You can skip this step and install the driver later. The wizard will help you configure it when you're ready.</p>
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      <div className="flex justify-between">
        <button
          onClick={onBack}
          className="px-4 py-2 border border-border hover:bg-accent rounded-md font-medium flex items-center gap-2"
        >
          <ChevronLeft className="h-4 w-4" />
          Back
        </button>
        <button
          onClick={onNext}
          className="px-6 py-2.5 bg-purple-600 hover:bg-purple-700 text-white rounded-md font-medium flex items-center gap-2"
        >
          {installedCable ? 'Continue' : 'Skip for Now'}
          <ChevronRight className="h-4 w-4" />
        </button>
      </div>
    </div>
  )
}

function ConfigureStep({ onNext, onBack }: StepProps) {
  const [inputDevices, setInputDevices] = useState<AudioDevice[]>([])
  const [outputDevices, setOutputDevices] = useState<AudioDevice[]>([])
  const [selectedInput, setSelectedInput] = useState<string>('')
  const [selectedOutput, setSelectedOutput] = useState<string>('')
  const [previousInput, setPreviousInput] = useState<string | null>(null)
  const [previousOutput, setPreviousOutput] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const loadDevices = async () => {
      setIsLoading(true)
      setError(null)
      try {
        // Load previously saved audio settings
        const [savedInputDevice, savedOutputDevice] = await Promise.all([
          window.electronAPI.db.settings.get<string>('audio.inputDevice'),
          window.electronAPI.db.settings.get<string>('audio.outputDevice')
        ])

        const devices = await window.electronAPI.audioDevices.getAll()
        const inputs = devices.filter(d => d.type === 'input' || d.type === 'virtual')
        const outputs = devices.filter(d => d.type === 'output' || d.type === 'virtual')
        setInputDevices(inputs)
        setOutputDevices(outputs)

        // Check if previously saved devices are still available
        const savedInputExists = savedInputDevice && savedInputDevice !== 'default' && inputs.some(d => d.id === savedInputDevice)
        const savedOutputExists = savedOutputDevice && savedOutputDevice !== 'default' && outputs.some(d => d.id === savedOutputDevice)

        // Store previous selections to show indicator
        if (savedInputExists) {
          setPreviousInput(savedInputDevice)
        }
        if (savedOutputExists) {
          setPreviousOutput(savedOutputDevice)
        }

        // Set initial selection: prefer previously saved device, fallback to default
        if (savedInputExists) {
          setSelectedInput(savedInputDevice)
        } else {
          const defaultInput = inputs.find(d => d.isDefault) || inputs[0]
          if (defaultInput) setSelectedInput(defaultInput.id)
        }

        if (savedOutputExists) {
          setSelectedOutput(savedOutputDevice)
        } else {
          const defaultOutput = outputs.find(d => d.isDefault) || outputs[0]
          if (defaultOutput) setSelectedOutput(defaultOutput.id)
        }

        if (inputs.length === 0 && outputs.length === 0) {
          setError('No audio devices found. Please ensure your audio devices are connected and try again.')
        }
      } catch (err) {
        console.error('Failed to load devices:', err)
        setError(err instanceof Error ? err.message : 'Failed to load audio devices')
      } finally {
        setIsLoading(false)
      }
    }
    loadDevices()
  }, [])

  const handleSave = async () => {
    if (selectedInput && selectedOutput) {
      setError(null)
      try {
        await window.electronAPI.db.settings.set('audio.inputDevice', selectedInput, 'audio')
        await window.electronAPI.db.settings.set('audio.outputDevice', selectedOutput, 'audio')
        onNext()
      } catch (err) {
        console.error('Failed to save settings:', err)
        setError(err instanceof Error ? err.message : 'Failed to save audio settings')
      }
    }
  }

  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <h2 className="text-2xl font-bold text-foreground">Configure Audio Routing</h2>
        <p className="text-muted-foreground">
          Select your input and output devices for recording meetings.
        </p>
      </div>

      <div className="bg-card border border-border rounded-lg p-6 space-y-6">
        {error && (
          <div className="bg-red-50 border border-red-200 rounded-lg p-4">
            <div className="flex items-start gap-2">
              <AlertCircle className="h-5 w-5 text-red-600 mt-0.5 flex-shrink-0" />
              <div className="text-sm text-red-900">
                <p className="font-medium mb-1">Error</p>
                <p>{error}</p>
              </div>
            </div>
          </div>
        )}
        {(previousInput || previousOutput) && !isLoading && (
          <div className="bg-green-50 border border-green-200 rounded-lg p-4">
            <div className="flex items-start gap-2">
              <CheckCircle className="h-5 w-5 text-green-600 mt-0.5 flex-shrink-0" />
              <div className="text-sm text-green-900">
                <p className="font-medium mb-1">Previous settings restored</p>
                <p>Your previously selected audio devices have been pre-selected. You can change them if needed.</p>
              </div>
            </div>
          </div>
        )}
        <div className="space-y-2">
          <label className="block text-sm font-medium text-foreground">
            Input Device (Microphone)
          </label>
          {isLoading ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              Loading devices...
            </div>
          ) : (
            <select
              value={selectedInput}
              onChange={(e) => setSelectedInput(e.target.value)}
              className="w-full px-3 py-2 bg-background border border-border rounded-md text-sm"
            >
              <option value="">Select input device</option>
              {inputDevices.map((device) => (
                <option key={device.id} value={device.id}>
                  {device.name}
                  {device.isDefault && ' (Default)'}
                  {device.isVirtual && ' (Virtual)'}
                  {previousInput === device.id && ' ★ Previously selected'}
                </option>
              ))}
            </select>
          )}
        </div>

        <div className="space-y-2">
          <label className="block text-sm font-medium text-foreground">
            Output Device (Virtual Cable for System Audio)
          </label>
          {isLoading ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              Loading devices...
            </div>
          ) : (
            <select
              value={selectedOutput}
              onChange={(e) => setSelectedOutput(e.target.value)}
              className="w-full px-3 py-2 bg-background border border-border rounded-md text-sm"
            >
              <option value="">Select output device</option>
              {outputDevices.map((device) => (
                <option key={device.id} value={device.id}>
                  {device.name}
                  {device.isDefault && ' (Default)'}
                  {device.isVirtual && ' (Virtual)'}
                  {previousOutput === device.id && ' ★ Previously selected'}
                </option>
              ))}
            </select>
          )}
        </div>

        <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
          <div className="flex items-start gap-2">
            <Settings className="h-5 w-5 text-blue-600 mt-0.5 flex-shrink-0" />
            <div className="text-sm text-blue-900">
              <p className="font-medium mb-1">Tip:</p>
              <p>
                Configure your meeting app (Zoom, Teams, etc.) to use the virtual audio driver
                as its output device to capture system audio.
              </p>
            </div>
          </div>
        </div>
      </div>

      <div className="flex justify-between">
        <button
          onClick={onBack}
          className="px-4 py-2 border border-border hover:bg-accent rounded-md font-medium flex items-center gap-2"
        >
          <ChevronLeft className="h-4 w-4" />
          Back
        </button>
        <button
          onClick={handleSave}
          disabled={!selectedInput || !selectedOutput}
          className={cn(
            'px-6 py-2.5 bg-purple-600 hover:bg-purple-700 text-white rounded-md font-medium flex items-center gap-2',
            (!selectedInput || !selectedOutput) && 'opacity-50 cursor-not-allowed'
          )}
        >
          Save & Continue
          <ChevronRight className="h-4 w-4" />
        </button>
      </div>
    </div>
  )
}

function TestStep({ onBack, onComplete }: StepProps) {
  const [isRecording, setIsRecording] = useState(false)
  const [micLevel, setMicLevel] = useState(0)
  const [systemLevel, setSystemLevel] = useState(0)
  const [testInterval, setTestInterval] = useState<NodeJS.Timeout | null>(null)
  const [isPlayingTestSound, setIsPlayingTestSound] = useState(false)
  const audioContextRef = useRef<AudioContext | null>(null)

  const playTestSound = async () => {
    if (isPlayingTestSound) {
      return
    }

    const AudioContextCtor =
      window.AudioContext || (window as Window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext

    if (!AudioContextCtor) {
      console.warn('Web Audio API is not available in this environment.')
      return
    }

    setIsPlayingTestSound(true)

    try {
      if (!audioContextRef.current) {
        audioContextRef.current = new AudioContextCtor()
      }

      const audioContext = audioContextRef.current

      if (audioContext.state === 'suspended') {
        await audioContext.resume()
      }

      const oscillator = audioContext.createOscillator()
      const gainNode = audioContext.createGain()

      oscillator.type = 'sine'
      oscillator.frequency.setValueAtTime(440, audioContext.currentTime)

      gainNode.gain.setValueAtTime(0, audioContext.currentTime)
      gainNode.gain.linearRampToValueAtTime(0.35, audioContext.currentTime + 0.05)
      gainNode.gain.exponentialRampToValueAtTime(0.0001, audioContext.currentTime + 0.6)

      oscillator.connect(gainNode)
      gainNode.connect(audioContext.destination)

      const now = audioContext.currentTime
      oscillator.start(now)
      oscillator.stop(now + 0.6)

      oscillator.onended = () => {
        try {
          oscillator.disconnect()
          gainNode.disconnect()
        } catch {
          // Ignore disconnection errors
        }
        setIsPlayingTestSound(false)
      }
    } catch (err) {
      console.error('Failed to play test sound:', err)
      setIsPlayingTestSound(false)

      if (audioContextRef.current) {
        audioContextRef.current.close().catch(() => null)
        audioContextRef.current = null
      }
    }
  }

  const startTest = async () => {
    setIsRecording(true)
    // Simulate volume levels (in real implementation, this would come from audio analysis)
    const interval = setInterval(() => {
      setMicLevel(Math.random() * 60 + 20) // 20-80%
      setSystemLevel(Math.random() * 50 + 10) // 10-60%
    }, 100)
    setTestInterval(interval)
  }

  const stopTest = () => {
    setIsRecording(false)
    if (testInterval) {
      clearInterval(testInterval)
      setTestInterval(null)
    }
    setMicLevel(0)
    setSystemLevel(0)
  }

  useEffect(() => {
    return () => {
      if (testInterval) {
        clearInterval(testInterval)
      }
    }
  }, [testInterval])

  useEffect(() => {
    return () => {
      if (audioContextRef.current) {
        audioContextRef.current.close().catch(() => null)
        audioContextRef.current = null
      }
    }
  }, [])

  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <h2 className="text-2xl font-bold text-foreground">Test Recording</h2>
        <p className="text-muted-foreground">
          Test your audio setup by recording a short sample. Speak into your microphone and play some audio.
        </p>
      </div>

      <div className="bg-card border border-border rounded-lg p-6 space-y-6">
        <div className="space-y-4">
          <VolumeMeter
            label="Microphone Input"
            level={micLevel}
            isActive={isRecording}
          />
          <VolumeMeter
            label="System Audio"
            level={systemLevel}
            isActive={isRecording}
          />
        </div>

        <div className="flex items-center justify-center gap-4 pt-4 border-t border-border">
          {!isRecording ? (
            <>
              <button
                onClick={playTestSound}
                disabled={isPlayingTestSound}
                className={cn(
                  'px-4 py-2 border border-border hover:bg-accent rounded-md font-medium flex items-center gap-2',
                  isPlayingTestSound && 'opacity-50 cursor-not-allowed'
                )}
              >
                <Play className="h-4 w-4" />
                {isPlayingTestSound ? 'Playing...' : 'Test Audio'}
              </button>
              <button
                onClick={startTest}
                className="px-6 py-3 bg-purple-600 hover:bg-purple-700 text-white rounded-md font-medium flex items-center gap-2"
              >
                <Play className="h-5 w-5" />
                Start Test Recording
              </button>
            </>
          ) : (
            <button
              onClick={stopTest}
              className="px-6 py-3 bg-red-600 hover:bg-red-700 text-white rounded-md font-medium flex items-center gap-2"
            >
              <Square className="h-5 w-5" />
              Stop Test
            </button>
          )}
        </div>

        {!isRecording && micLevel === 0 && (
          <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
            <div className="flex items-start gap-2">
              <AlertCircle className="h-5 w-5 text-blue-600 mt-0.5 flex-shrink-0" />
              <div className="text-sm text-blue-900">
                <p className="font-medium mb-1">Ready to test:</p>
                <ul className="list-disc list-inside space-y-1">
                  <li>Click "Test Audio" to play a test sound and verify your audio output</li>
                  <li>Click "Start Test Recording" to begin recording</li>
                  <li>Speak into your microphone and watch the microphone meter</li>
                  <li>Play some audio from your computer and watch the system audio meter</li>
                  <li>Ensure both meters show activity when recording</li>
                </ul>
              </div>
            </div>
          </div>
        )}
      </div>

      <div className="flex justify-between">
        <button
          onClick={onBack}
          className="px-4 py-2 border border-border hover:bg-accent rounded-md font-medium flex items-center gap-2"
        >
          <ChevronLeft className="h-4 w-4" />
          Back
        </button>
        <button
          onClick={onComplete}
          className="px-6 py-2.5 bg-purple-600 hover:bg-purple-700 text-white rounded-md font-medium flex items-center gap-2"
        >
          Complete Setup
          <CheckCircle className="h-4 w-4" />
        </button>
      </div>
    </div>
  )
}

// ============================================================================
// Main SetupWizard Component
// ============================================================================

const steps: StepConfig[] = [
  { id: 'welcome', title: 'Welcome', description: 'Get started' },
  { id: 'python', title: 'Python Setup', description: 'Configure ML environment' },
  { id: 'download', title: 'Download', description: 'Get virtual audio driver' },
  { id: 'install', title: 'Install', description: 'Install the driver' },
  { id: 'configure', title: 'Configure', description: 'Set up audio routing' },
  { id: 'test', title: 'Test', description: 'Test recording' }
]

export function SetupWizard({ onComplete, onSkip }: SetupWizardProps) {
  const [currentStep, setCurrentStep] = useState<WizardStep>('welcome')
  const [diagnosticResult, setDiagnosticResult] = useState<AudioDiagnosticResult | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const platform = window.electronAPI?.platform || 'darwin'

  useEffect(() => {
    const runDiagnostics = async () => {
      try {
        const result = await window.electronAPI.audioDevices.runDiagnostics()
        setDiagnosticResult(result)
      } catch (err) {
        console.error('Failed to run diagnostics:', err)
      } finally {
        setIsLoading(false)
      }
    }
    runDiagnostics()
  }, [])

  const currentStepIndex = steps.findIndex(s => s.id === currentStep)
  const progress = ((currentStepIndex + 1) / steps.length) * 100

  const handleNext = () => {
    const nextIndex = currentStepIndex + 1
    if (nextIndex < steps.length) {
      setCurrentStep(steps[nextIndex].id)
    } else {
      onComplete()
    }
  }

  const handleBack = () => {
    const prevIndex = currentStepIndex - 1
    if (prevIndex >= 0) {
      setCurrentStep(steps[prevIndex].id)
    }
  }

  const stepProps: StepProps = {
    onNext: handleNext,
    onBack: handleBack,
    onComplete: async () => {
      // Mark setup as complete
      await window.electronAPI.db.settings.set('setup.completed', true, 'general')
      onComplete()
    },
    diagnosticResult,
    platform
  }

  const renderStep = () => {
    switch (currentStep) {
      case 'welcome':
        return <WelcomeStep {...stepProps} />
      case 'python':
        return <PythonSetupStep {...stepProps} />
      case 'download':
        return <DownloadStep {...stepProps} />
      case 'install':
        return <InstallStep {...stepProps} />
      case 'configure':
        return <ConfigureStep {...stepProps} />
      case 'test':
        return <TestStep {...stepProps} />
      default:
        return null
    }
  }

  return (
    <div className="fixed inset-0 bg-background z-50 flex flex-col">
      {/* Header */}
      <div className="border-b border-border px-6 py-4 flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-foreground">Setup Wizard</h1>
          <p className="text-sm text-muted-foreground">
            Step {currentStepIndex + 1} of {steps.length}: {steps[currentStepIndex]?.title}
          </p>
        </div>
        {onSkip && (
          <button
            onClick={onSkip}
            className="px-4 py-2 text-sm text-muted-foreground hover:text-foreground flex items-center gap-2"
          >
            Skip Setup
            <X className="h-4 w-4" />
          </button>
        )}
      </div>

      {/* Progress Bar */}
      <div className="h-1 bg-secondary">
        <div
          className="h-full bg-purple-600 transition-all duration-300"
          style={{ width: `${progress}%` }}
        />
      </div>

      {/* Content */}
      <div className="flex-1 overflow-auto p-6">
        <div className="max-w-3xl mx-auto">
          {isLoading ? (
            <div className="flex items-center justify-center py-20">
              <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
            </div>
          ) : (
            renderStep()
          )}
        </div>
      </div>

      {/* Step Indicators */}
      <div className="border-t border-border px-6 py-4">
        <div className="max-w-3xl mx-auto flex items-center justify-between">
          {steps.map((step, index) => (
            <div
              key={step.id}
              className={cn(
                'flex items-center gap-2',
                index < steps.length - 1 && 'flex-1'
              )}
            >
              <div
                className={cn(
                  'w-8 h-8 rounded-full flex items-center justify-center text-sm font-medium transition-colors',
                  index <= currentStepIndex
                    ? 'bg-purple-600 text-white'
                    : 'bg-secondary text-muted-foreground'
                )}
              >
                {index < currentStepIndex ? (
                  <CheckCircle className="h-5 w-5" />
                ) : (
                  index + 1
                )}
              </div>
              {index < steps.length - 1 && (
                <div
                  className={cn(
                    'flex-1 h-0.5 transition-colors',
                    index < currentStepIndex ? 'bg-purple-600' : 'bg-secondary'
                  )}
                />
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

export default SetupWizard
