/**
 * Settings Page
 *
 * Application settings and preferences
 */

import { useState, useEffect } from 'react'
import { useSearchParams } from 'react-router-dom'
import {
  Mic,
  Bell,
  Palette,
  Shield,
  HardDrive,
  Brain,
  ChevronRight,
  Check,
  Keyboard,
  RotateCcw,
  Users
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { AudioDiagnostics } from '@/components/AudioDiagnostics'
import { AudioDeviceSettings } from '@/components/AudioDeviceSettings'
import { TranscriptionDiagnostics } from '@/components/TranscriptionDiagnostics'
import { LLMSettings } from '@/components/LLMSettings'
import { LLMHealthStatus } from '@/components/LLMHealthStatus'
import { StorageManagement } from '@/components/StorageManagement'
import { CleanupWizard } from '@/components/CleanupWizard'
import { SpeakerDiarizationSettings } from '@/components/SpeakerDiarizationSettings'
import { PythonEnvironmentSetup } from '@/components/PythonEnvironmentSetup'
import { EnvironmentStatusSection } from '@/components/EnvironmentStatusSection'
import { ValidationStatusIndicator } from '@/components/ValidationStatusIndicator'
import { useThemeStore, type Theme } from '@/stores/theme-store'
import { useKeyboardShortcutsStore } from '@/stores'
import {
  formatShortcut,
  type ShortcutCategory as ShortcutCategoryType,
  type KeyboardShortcut,
  CATEGORY_LABELS,
} from '@/types/keyboard'

type SettingsCategory = 'audio' | 'speaker-id' | 'ai' | 'notifications' | 'appearance' | 'privacy' | 'storage' | 'shortcuts'

const categories = [
  { id: 'audio' as const, label: 'Audio', icon: Mic, description: 'Recording and playback settings' },
  { id: 'speaker-id' as const, label: 'Speaker ID', icon: Users, description: 'Speaker identification settings' },
  { id: 'ai' as const, label: 'AI / LLM', icon: Brain, description: 'LM Studio and model settings' },
  { id: 'shortcuts' as const, label: 'Shortcuts', icon: Keyboard, description: 'Keyboard shortcuts' },
  { id: 'notifications' as const, label: 'Notifications', icon: Bell, description: 'Alerts and reminders' },
  { id: 'appearance' as const, label: 'Appearance', icon: Palette, description: 'Theme and display options' },
  { id: 'privacy' as const, label: 'Privacy', icon: Shield, description: 'Data and security settings' },
  { id: 'storage' as const, label: 'Storage', icon: HardDrive, description: 'File storage and backup' }
]

export function Settings() {
  const [searchParams, setSearchParams] = useSearchParams()
  const [activeCategory, setActiveCategory] = useState<SettingsCategory>('audio')

  // Read initial category from URL search params
  useEffect(() => {
    const category = searchParams.get('category')
    if (category && categories.find(c => c.id === category)) {
      setActiveCategory(category as SettingsCategory)
    }
  }, [searchParams])

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-foreground">Settings</h1>
        <p className="text-muted-foreground">Manage your application preferences</p>
      </div>

      {/* Settings Layout */}
      <div className="flex gap-6">
        {/* Sidebar */}
        <div className="w-64 flex-shrink-0">
          <nav className="space-y-1 sticky top-0 bg-background pb-4">
            {categories.map((category) => {
              const Icon = category.icon
              const isActive = activeCategory === category.id
              return (
                <button
                  key={category.id}
                  onClick={() => {
                    setActiveCategory(category.id)
                    setSearchParams({ category: category.id })
                  }}
                  className={cn(
                    'w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-left transition-colors',
                    isActive
                      ? 'bg-purple-100 text-purple-700'
                      : 'text-muted-foreground hover:bg-accent hover:text-foreground'
                  )}
                >
                  <Icon className="h-5 w-5" />
                  <div className="flex-1">
                    <p className="font-medium text-sm">{category.label}</p>
                    <p className="text-xs opacity-70">{category.description}</p>
                  </div>
                  {isActive && <ChevronRight className="h-4 w-4" />}
                </button>
              )
            })}
          </nav>
        </div>

        {/* Content */}
        <div className="flex-1">
          {activeCategory === 'audio' && <AudioSettings />}
          {activeCategory === 'speaker-id' && <SpeakerIdentificationSettings />}
          {activeCategory === 'ai' && <AISettings />}
          {activeCategory === 'shortcuts' && <KeyboardShortcutsSettings />}
          {activeCategory === 'notifications' && <NotificationSettings />}
          {activeCategory === 'appearance' && <AppearanceSettings />}
          {activeCategory === 'privacy' && <PrivacySettings />}
          {activeCategory === 'storage' && <StorageSettings />}
        </div>
      </div>
    </div>
  )
}

function AudioSettings() {
  const [isRestartingWizard, setIsRestartingWizard] = useState(false)
  // Default to true since diarization should be enabled by default
  const [diarizationEnabled, setDiarizationEnabled] = useState(true)
  // Lower threshold = more speakers detected (more sensitive to voice differences)
  // Default 0.5 provides better separation than pyannote's default of 0.7
  const [diarizationThreshold, setDiarizationThreshold] = useState(0.5)
  const [maxSpeakers, setMaxSpeakers] = useState(10)
  const [transcriptionOnlyMode, setTranscriptionOnlyMode] = useState(false)
  const [transcriptionOnlyAcknowledged, setTranscriptionOnlyAcknowledged] = useState(false)
  const [diarizationFailureCount, setDiarizationFailureCount] = useState(0)

  // Load diarization settings on mount
  useEffect(() => {
    const loadDiarizationSettings = async () => {
      try {
        const enabled = await window.electronAPI.db.settings.get('transcription.diarization.enabled')
        const threshold = await window.electronAPI.db.settings.get('transcription.diarization.threshold')
        const speakers = await window.electronAPI.db.settings.get('transcription.diarization.maxSpeakers')

        // Only update if explicitly set; default is true (enabled)
        if (enabled !== null) setDiarizationEnabled(enabled as boolean)
        if (threshold !== null) setDiarizationThreshold(threshold as number)
        if (speakers !== null) setMaxSpeakers(speakers as number)

        // Load transcription-only mode preference
        const transcriptionOnlyPrefs = await window.electronAPI.diarizationFailure.getTranscriptionOnlyMode()
        setTranscriptionOnlyMode(transcriptionOnlyPrefs.diarizationDisabled)
        setTranscriptionOnlyAcknowledged(transcriptionOnlyPrefs.transcriptionOnlyAcknowledged)

        // Get failure count
        const failureCount = await window.electronAPI.diarizationFailure.getCount()
        setDiarizationFailureCount(failureCount)
      } catch (err) {
        console.error('Failed to load diarization settings:', err)
      }
    }
    loadDiarizationSettings()
  }, [])

  const handleDiarizationEnabledChange = async (enabled: boolean) => {
    setDiarizationEnabled(enabled)
    try {
      await window.electronAPI.db.settings.set('transcription.diarization.enabled', enabled, 'transcription')
    } catch (err) {
      console.error('Failed to save diarization enabled setting:', err)
    }
  }

  const handleDiarizationThresholdChange = async (threshold: number) => {
    setDiarizationThreshold(threshold)
    try {
      await window.electronAPI.db.settings.set('transcription.diarization.threshold', threshold, 'transcription')
    } catch (err) {
      console.error('Failed to save diarization threshold:', err)
    }
  }

  const handleMaxSpeakersChange = async (speakers: number) => {
    setMaxSpeakers(speakers)
    try {
      await window.electronAPI.db.settings.set('transcription.diarization.maxSpeakers', speakers, 'transcription')
    } catch (err) {
      console.error('Failed to save max speakers setting:', err)
    }
  }

  const handleTranscriptionOnlyModeChange = async (enabled: boolean) => {
    setTranscriptionOnlyMode(enabled)
    try {
      const result = await window.electronAPI.diarizationFailure.setTranscriptionOnlyMode(
        enabled,
        enabled ? 'User explicitly enabled transcription-only mode' : 'User disabled transcription-only mode'
      )
      if (result.success) {
        setTranscriptionOnlyAcknowledged(enabled)
        // If enabling transcription-only mode, also disable diarization
        if (enabled) {
          setDiarizationEnabled(false)
          await window.electronAPI.db.settings.set('transcription.diarization.enabled', false, 'transcription')
        }
      } else {
        console.error('Failed to set transcription-only mode:', result.error)
        setTranscriptionOnlyMode(!enabled) // Revert
      }
    } catch (err) {
      console.error('Failed to set transcription-only mode:', err)
      setTranscriptionOnlyMode(!enabled) // Revert
    }
  }

  const handleViewFailures = async () => {
    try {
      const json = await window.electronAPI.diarizationFailure.export()
      console.log('Diarization Failures:', JSON.parse(json))
      // Copy to clipboard
      await navigator.clipboard.writeText(json)
      alert('Diarization failure data copied to clipboard')
    } catch (err) {
      console.error('Failed to export failures:', err)
    }
  }

  const handleRestartWizard = async () => {
    setIsRestartingWizard(true)
    try {
      // Clear setup completion status
      await window.electronAPI.db.settings.set('setup.completed', false, 'general')
      await window.electronAPI.db.settings.delete('setup.skipped')
      // Reload the app to show wizard
      window.location.reload()
    } catch (err) {
      console.error('Failed to restart wizard:', err)
      setIsRestartingWizard(false)
    }
  }

  const handleDeviceChange = (inputDevice: string, outputDevice: string) => {
    console.log('Audio devices changed:', { inputDevice, outputDevice })
    // Additional handling can be added here if needed
  }

  return (
    <div className="space-y-6">
      {/* Audio Device Settings - Primary section for selecting input/output devices */}
      <SettingsCard title="Audio Devices">
        <AudioDeviceSettings onDeviceChange={handleDeviceChange} />
      </SettingsCard>

      {/* Speaker Diarization Settings */}
      <SettingsCard title="Speaker Diarization">
        {/* Transcription-Only Mode Warning */}
        {transcriptionOnlyMode && (
          <div className="mb-4 p-3 bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 rounded-md">
            <p className="text-sm text-amber-800 dark:text-amber-200 font-medium">
              Transcription-Only Mode Active
            </p>
            <p className="text-xs text-amber-700 dark:text-amber-300 mt-1">
              Speaker diarization has been explicitly disabled. Audio will be transcribed without speaker separation.
            </p>
          </div>
        )}

        <SettingRow
          label="Transcription-only mode"
          description="Explicitly disable speaker diarization - transcriptions will not identify different speakers"
        >
          <div className="flex items-center gap-2">
            <Toggle
              defaultChecked={transcriptionOnlyMode}
              onChange={handleTranscriptionOnlyModeChange}
            />
            {transcriptionOnlyAcknowledged && (
              <span className="text-xs text-green-600 dark:text-green-400">Acknowledged</span>
            )}
          </div>
        </SettingRow>

        {!transcriptionOnlyMode && (
          <>
            <SettingRow
              label="Enable speaker detection"
              description="Automatically identify and label different speakers in transcriptions"
            >
              <Toggle
                defaultChecked={diarizationEnabled}
                onChange={handleDiarizationEnabledChange}
              />
            </SettingRow>
            {diarizationEnabled && (
              <>
                <SettingRow
                  label="Speaker separation sensitivity"
                  description="Lower values = more speakers detected. Try 0.4-0.5 if speakers are being merged."
                >
                  <div className="flex items-center gap-2">
                    <input
                      type="range"
                      min="0.3"
                      max="0.8"
                      step="0.05"
                      value={diarizationThreshold}
                      onChange={(e) => handleDiarizationThresholdChange(parseFloat(e.target.value))}
                      className="w-24"
                    />
                    <span className="text-sm w-10 text-right">{diarizationThreshold.toFixed(2)}</span>
                  </div>
                </SettingRow>
                <SettingRow
                  label="Maximum speakers"
                  description="Maximum number of speakers to detect in a meeting"
                >
                  <select
                    value={maxSpeakers}
                    onChange={(e) => handleMaxSpeakersChange(parseInt(e.target.value))}
                    className="px-3 py-1.5 bg-background border border-border rounded-md text-sm"
                  >
                    <option value="2">2 speakers</option>
                    <option value="4">4 speakers</option>
                    <option value="6">6 speakers</option>
                    <option value="8">8 speakers</option>
                    <option value="10">10 speakers</option>
                  </select>
                </SettingRow>
              </>
            )}
          </>
        )}

        {/* Diarization Failure Diagnostics */}
        <div className="pt-4 mt-4 border-t border-border">
          <SettingRow
            label="Diarization failure history"
            description={`${diarizationFailureCount} failure${diarizationFailureCount !== 1 ? 's' : ''} recorded`}
          >
            <button
              onClick={handleViewFailures}
              className="px-3 py-1.5 bg-secondary hover:bg-accent text-foreground rounded-md text-sm font-medium"
            >
              Export Diagnostics
            </button>
          </SettingRow>
        </div>
      </SettingsCard>

      {/* Audio Diagnostics */}
      <div className="bg-card border border-border rounded-lg p-6 shadow-sm">
        <h2 className="text-lg font-semibold mb-4">Audio Configuration Diagnostics</h2>
        <AudioDiagnostics autoRun={false} />
      </div>

      {/* Live Transcription Diagnostics */}
      <div className="bg-card border border-border rounded-lg p-6 shadow-sm">
        <h2 className="text-lg font-semibold mb-4">Live Transcription Diagnostics</h2>
        <TranscriptionDiagnostics autoRun={false} />
      </div>

      <SettingsCard title="Setup Wizard">
        <SettingRow
          label="Restart setup wizard"
          description="Run the initial setup wizard again to configure audio devices"
        >
          <button
            onClick={handleRestartWizard}
            disabled={isRestartingWizard}
            className={cn(
              'px-3 py-1.5 bg-purple-600 hover:bg-purple-700 text-white rounded-md text-sm font-medium',
              isRestartingWizard && 'opacity-50 cursor-not-allowed'
            )}
          >
            {isRestartingWizard ? 'Restarting...' : 'Restart Wizard'}
          </button>
        </SettingRow>
      </SettingsCard>

      <SettingsCard title="Recording Quality">
        <SettingRow
          label="Audio Quality"
          description="Higher quality results in larger file sizes"
        >
          <select className="px-3 py-1.5 bg-background border border-border rounded-md text-sm">
            <option value="low">Low (64 kbps)</option>
            <option value="medium">Medium (128 kbps)</option>
            <option value="high" selected>High (256 kbps)</option>
            <option value="lossless">Lossless (WAV)</option>
          </select>
        </SettingRow>
        <SettingRow
          label="Sample Rate"
          description="Audio sample rate in Hz"
        >
          <select className="px-3 py-1.5 bg-background border border-border rounded-md text-sm">
            <option value="44100">44.1 kHz</option>
            <option value="48000" selected>48 kHz</option>
            <option value="96000">96 kHz</option>
          </select>
        </SettingRow>
      </SettingsCard>

      <SettingsCard title="Recording Behavior">
        <SettingRow
          label="Auto-start recording"
          description="Automatically start recording when joining a meeting"
        >
          <Toggle defaultChecked={false} />
        </SettingRow>
        <SettingRow
          label="Record system audio"
          description="Capture audio from other applications"
        >
          <Toggle defaultChecked={true} />
        </SettingRow>
      </SettingsCard>
    </div>
  )
}

function SpeakerIdentificationSettings() {
  const handleSettingsChange = (settings: any) => {
    console.log('Speaker identification settings changed:', settings)
    // Additional handling can be added here if needed
  }

  return (
    <div className="space-y-6" data-testid="speaker-identification-settings">
      {/* Speaker Diarization Settings - Full configuration panel */}
      <SettingsCard title="Speaker Identification">
        <SpeakerDiarizationSettings onSettingsChange={handleSettingsChange} />
      </SettingsCard>

      {/* Help Section */}
      <SettingsCard title="About Speaker Identification">
        <div className="space-y-3 text-sm text-muted-foreground">
          <p>
            Speaker identification (diarization) automatically detects and labels different speakers
            in your recordings. This feature uses advanced voice embeddings to distinguish between
            speakers without requiring prior training.
          </p>
          <div className="grid grid-cols-2 gap-4 pt-2">
            <div className="p-3 bg-muted rounded-lg">
              <p className="font-medium text-foreground mb-1">Recommended for:</p>
              <ul className="text-xs space-y-1">
                <li>• Meetings with 2-10 speakers</li>
                <li>• Clear audio quality</li>
                <li>• Speakers taking turns</li>
              </ul>
            </div>
            <div className="p-3 bg-muted rounded-lg">
              <p className="font-medium text-foreground mb-1">May struggle with:</p>
              <ul className="text-xs space-y-1">
                <li>• Overlapping speech</li>
                <li>• Very similar voices</li>
                <li>• Poor audio quality</li>
              </ul>
            </div>
          </div>
        </div>
      </SettingsCard>
    </div>
  )
}

function AISettings() {
  const [showPythonSetup, setShowPythonSetup] = useState(false)
  const [pythonEnvStatus, setPythonEnvStatus] = useState<'unknown' | 'ready' | 'missing'>('unknown')

  // Check Python environment status on mount
  useEffect(() => {
    const checkPythonStatus = async () => {
      try {
        if (window.electronAPI?.pythonSetup) {
          const isRequired = await window.electronAPI.pythonSetup.isRequired()
          setPythonEnvStatus(isRequired ? 'missing' : 'ready')
        }
      } catch (err) {
        console.error('Failed to check Python environment status:', err)
        setPythonEnvStatus('unknown')
      }
    }
    checkPythonStatus()
  }, [])

  const handleSettingsChange = (settings: { provider: string; lmStudioUrl: string; model: string }) => {
    console.log('AI settings changed:', settings)
    // Additional handling can be added here if needed
  }

  const handlePythonSetupComplete = () => {
    setShowPythonSetup(false)
    setPythonEnvStatus('ready')
  }

  const handleEnvironmentChange = () => {
    // Refresh the environment status after changes
    setPythonEnvStatus('unknown')
    setTimeout(async () => {
      try {
        if (window.electronAPI?.pythonSetup) {
          const isRequired = await window.electronAPI.pythonSetup.isRequired()
          setPythonEnvStatus(isRequired ? 'missing' : 'ready')
        }
      } catch (err) {
        console.error('Failed to refresh Python environment status:', err)
      }
    }, 1000)
  }

  return (
    <div className="space-y-6">
      {/* Startup Validation Status - Shows tiered validation progress and settings */}
      <ValidationStatusIndicator
        showMetrics={true}
        showLevelSelector={true}
      />

      {/* Comprehensive Environment Status Section */}
      <SettingsCard title="Python Environment Status">
        {showPythonSetup ? (
          <PythonEnvironmentSetup
            autoStart={false}
            showSkip={false}
            onComplete={handlePythonSetupComplete}
            onError={(error) => console.error('Python setup error:', error)}
          />
        ) : (
          <div className="space-y-4">
            <EnvironmentStatusSection
              onEnvironmentChange={handleEnvironmentChange}
            />
            <div className="pt-4 border-t border-border">
              <SettingRow
                label="Run full environment setup"
                description="Run the complete Python environment setup wizard"
              >
                <button
                  onClick={() => setShowPythonSetup(true)}
                  className="px-3 py-1.5 bg-purple-600 hover:bg-purple-700 text-white rounded-md text-sm font-medium"
                >
                  {pythonEnvStatus === 'missing' ? 'Setup' : 'Repair'} Environments
                </button>
              </SettingRow>
            </div>
          </div>
        )}
      </SettingsCard>

      {/* Provider Health Status - Real-time monitoring of LLM providers */}
      <SettingsCard title="Provider Health Status">
        <LLMHealthStatus showHistory={true} maxHistoryItems={10} />
      </SettingsCard>

      {/* LLM Settings - Primary section for AI configuration */}
      <SettingsCard title="LLM Configuration">
        <LLMSettings onSettingsChange={handleSettingsChange} />
      </SettingsCard>

      {/* AI Features */}
      <SettingsCard title="AI Features">
        <SettingRow
          label="Auto-summarize meetings"
          description="Automatically generate summaries when meetings end"
        >
          <Toggle defaultChecked={true} />
        </SettingRow>
        <SettingRow
          label="Extract action items"
          description="Automatically identify and extract action items from transcripts"
        >
          <Toggle defaultChecked={true} />
        </SettingRow>
        <SettingRow
          label="Identify key decisions"
          description="Highlight important decisions made during meetings"
        >
          <Toggle defaultChecked={true} />
        </SettingRow>
        <SettingRow
          label="Speaker sentiment analysis"
          description="Analyze emotional tone of speakers during meetings"
        >
          <Toggle defaultChecked={false} />
        </SettingRow>
      </SettingsCard>

      {/* Processing Settings */}
      <SettingsCard title="Processing Settings">
        <SettingRow
          label="Processing mode"
          description="When to process transcripts with AI"
        >
          <select className="px-3 py-1.5 bg-background border border-border rounded-md text-sm">
            <option value="realtime">Real-time (during meeting)</option>
            <option value="end">After meeting ends</option>
            <option value="manual">Manual only</option>
          </select>
        </SettingRow>
        <SettingRow
          label="Batch processing"
          description="Process multiple meetings at once for better efficiency"
        >
          <Toggle defaultChecked={false} />
        </SettingRow>
      </SettingsCard>
    </div>
  )
}

function KeyboardShortcutsSettings() {
  const {
    shortcuts,
    globalEnabled,
    setGlobalEnabled,
    toggleShortcut,
    resetAllShortcuts,
    initialize,
    isLoading,
  } = useKeyboardShortcutsStore()

  // Initialize shortcuts on mount
  useEffect(() => {
    initialize()
  }, [initialize])

  // Group shortcuts by category
  const shortcutsByCategory = Object.values(shortcuts).reduce((acc, shortcut) => {
    if (!acc[shortcut.category]) {
      acc[shortcut.category] = []
    }
    acc[shortcut.category].push(shortcut)
    return acc
  }, {} as Record<ShortcutCategoryType, typeof shortcuts[keyof typeof shortcuts][]>)

  const handleGlobalToggle = async (enabled: boolean) => {
    await setGlobalEnabled(enabled)
  }

  const handleResetAll = async () => {
    if (window.confirm('Are you sure you want to reset all keyboard shortcuts to their default settings?')) {
      await resetAllShortcuts()
    }
  }

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-48">
        <div className="text-muted-foreground">Loading shortcuts...</div>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* Global Toggle */}
      <SettingsCard title="Keyboard Shortcuts">
        <SettingRow
          label="Enable keyboard shortcuts"
          description="Allow keyboard shortcuts throughout the application"
        >
          <Toggle defaultChecked={globalEnabled} onChange={handleGlobalToggle} />
        </SettingRow>
        <SettingRow
          label="Reset all shortcuts"
          description="Restore all shortcuts to their default settings"
        >
          <button
            onClick={handleResetAll}
            className="flex items-center gap-2 px-3 py-1.5 bg-secondary hover:bg-accent text-foreground rounded-md text-sm font-medium transition-colors"
          >
            <RotateCcw className="h-4 w-4" />
            Reset
          </button>
        </SettingRow>
      </SettingsCard>

      {/* Shortcuts by Category */}
      {(['navigation', 'recording', 'tasks', 'search', 'general'] as ShortcutCategoryType[]).map((category) => {
        const categoryShortcuts = shortcutsByCategory[category]
        if (!categoryShortcuts || categoryShortcuts.length === 0) return null

        return (
          <SettingsCard key={category} title={CATEGORY_LABELS[category]}>
            {categoryShortcuts.map((shortcut) => (
              <ShortcutSettingRow
                key={shortcut.action}
                shortcut={shortcut}
                onToggle={() => toggleShortcut(shortcut.action)}
              />
            ))}
          </SettingsCard>
        )
      })}

      {/* Help */}
      <SettingsCard title="Quick Reference">
        <div className="text-sm text-muted-foreground space-y-2">
          <p>
            Press <kbd className="px-1.5 py-0.5 bg-muted border border-border rounded text-xs">⌘/</kbd> to show all keyboard shortcuts anytime.
          </p>
          <p>
            Shortcuts are disabled when typing in input fields to avoid conflicts.
          </p>
        </div>
      </SettingsCard>
    </div>
  )
}

interface ShortcutSettingRowProps {
  shortcut: KeyboardShortcut
  onToggle: () => void
}

function ShortcutSettingRow({ shortcut, onToggle }: ShortcutSettingRowProps) {
  const formatted = formatShortcut(shortcut)

  return (
    <div className="flex items-center justify-between py-2">
      <div className="flex items-center gap-4">
        <div>
          <p className="font-medium text-sm text-foreground">{shortcut.description}</p>
          <div className="flex items-center gap-2 mt-1">
            <kbd className="px-2 py-1 bg-muted border border-border rounded text-xs font-mono">
              {formatted}
            </kbd>
          </div>
        </div>
      </div>
      <Toggle
        defaultChecked={shortcut.enabled}
        onChange={onToggle}
      />
    </div>
  )
}

function NotificationSettings() {
  return (
    <div className="space-y-6">
      <SettingsCard title="Notification Preferences">
        <SettingRow
          label="Recording notifications"
          description="Show notifications when recording starts/stops"
        >
          <Toggle defaultChecked={true} />
        </SettingRow>
        <SettingRow
          label="Transcription complete"
          description="Notify when transcription is finished"
        >
          <Toggle defaultChecked={true} />
        </SettingRow>
        <SettingRow
          label="Meeting reminders"
          description="Remind before scheduled meetings"
        >
          <Toggle defaultChecked={true} />
        </SettingRow>
        <SettingRow
          label="Sound effects"
          description="Play sounds for notifications"
        >
          <Toggle defaultChecked={false} />
        </SettingRow>
      </SettingsCard>
    </div>
  )
}

function AppearanceSettings() {
  const { theme, setTheme, resolvedTheme } = useThemeStore()

  const handleThemeChange = (newTheme: Theme) => {
    setTheme(newTheme)
  }

  return (
    <div className="space-y-6">
      <SettingsCard title="Theme">
        <div className="grid grid-cols-3 gap-4">
          <ThemeOption
            label="Light"
            active={theme === 'light'}
            onClick={() => handleThemeChange('light')}
            preview="bg-white border-gray-200"
          />
          <ThemeOption
            label="Dark"
            active={theme === 'dark'}
            onClick={() => handleThemeChange('dark')}
            preview="bg-gray-900 border-gray-700"
          />
          <ThemeOption
            label="System"
            active={theme === 'system'}
            onClick={() => handleThemeChange('system')}
            preview="bg-gradient-to-r from-white to-gray-900 border-gray-400"
          />
        </div>
        {theme === 'system' && (
          <p className="mt-3 text-xs text-muted-foreground">
            Currently using {resolvedTheme} mode based on your system preferences
          </p>
        )}
      </SettingsCard>

      <SettingsCard title="Display">
        <SettingRow
          label="Compact mode"
          description="Use smaller spacing and fonts"
        >
          <Toggle defaultChecked={false} />
        </SettingRow>
        <SettingRow
          label="Show timestamps"
          description="Display timestamps in meeting notes"
        >
          <Toggle defaultChecked={true} />
        </SettingRow>
      </SettingsCard>
    </div>
  )
}

function PrivacySettings() {
  return (
    <div className="space-y-6">
      <SettingsCard title="Data Collection">
        <SettingRow
          label="Usage analytics"
          description="Help improve the app by sending anonymous usage data"
        >
          <Toggle defaultChecked={false} />
        </SettingRow>
        <SettingRow
          label="Error reporting"
          description="Automatically report crashes and errors"
        >
          <Toggle defaultChecked={true} />
        </SettingRow>
      </SettingsCard>

      <SettingsCard title="Data Management">
        <SettingRow
          label="Clear all data"
          description="Remove all meetings, recordings, and settings"
        >
          <button className="px-3 py-1.5 bg-red-600 hover:bg-red-700 text-white rounded-md text-sm font-medium">
            Clear Data
          </button>
        </SettingRow>
      </SettingsCard>
    </div>
  )
}

function StorageSettings() {
  const [recordingsPath, setRecordingsPath] = useState<string>('')
  const [isLoadingPath, setIsLoadingPath] = useState(true)
  const [isChangingPath, setIsChangingPath] = useState(false)
  const [showCleanupWizard, setShowCleanupWizard] = useState(false)
  const [storageKey, setStorageKey] = useState(0) // Used to force refresh

  // Load current recordings path
  useEffect(() => {
    const loadPath = async () => {
      setIsLoadingPath(true)
      try {
        const path = await window.electronAPI.db.settings.get('storage.recordingsPath')
        if (path) {
          setRecordingsPath(path as string)
        }
      } catch (err) {
        console.error('Failed to load recordings path:', err)
      } finally {
        setIsLoadingPath(false)
      }
    }
    loadPath()
  }, [])

  const handleChangePath = async () => {
    setIsChangingPath(true)
    try {
      // Open directory selection dialog
      const selectedPath = await window.electronAPI.shell.selectDirectory(recordingsPath || undefined)

      if (selectedPath) {
        // Save new path to settings
        await window.electronAPI.db.settings.set('storage.recordingsPath', selectedPath, 'storage')
        setRecordingsPath(selectedPath)
      }
    } catch (err) {
      console.error('Failed to change recordings path:', err)
      alert('Failed to change recordings folder. Please try again.')
    } finally {
      setIsChangingPath(false)
    }
  }

  const handleCleanupComplete = () => {
    // Force refresh the storage management component
    setStorageKey((prev) => prev + 1)
  }

  const displayPath = recordingsPath || 'Not set (using default)'

  return (
    <div className="space-y-6">
      <SettingsCard title="Storage Location">
        <SettingRow
          label="Recordings folder"
          description="Where audio recordings are saved"
        >
          <div className="flex items-center gap-2">
            <span className="text-sm text-muted-foreground max-w-xs truncate" title={displayPath}>
              {isLoadingPath ? 'Loading...' : displayPath}
            </span>
            <button
              onClick={handleChangePath}
              disabled={isChangingPath || isLoadingPath}
              className={cn(
                'px-3 py-1.5 bg-secondary hover:bg-accent text-foreground rounded-md text-sm font-medium',
                (isChangingPath || isLoadingPath) && 'opacity-50 cursor-not-allowed'
              )}
            >
              {isChangingPath ? 'Changing...' : 'Change'}
            </button>
          </div>
        </SettingRow>
      </SettingsCard>

      {/* Storage Management Interface */}
      <SettingsCard title="Storage Management">
        <StorageManagement
          key={storageKey}
          onOpenCleanupWizard={() => setShowCleanupWizard(true)}
        />
      </SettingsCard>

      <SettingsCard title="Backup">
        <SettingRow
          label="Auto-backup"
          description="Automatically backup meetings to cloud storage"
        >
          <Toggle defaultChecked={false} />
        </SettingRow>
        <SettingRow
          label="Manual backup"
          description="Export all data to a file"
        >
          <button className="px-3 py-1.5 bg-secondary hover:bg-accent text-foreground rounded-md text-sm font-medium">
            Export
          </button>
        </SettingRow>
      </SettingsCard>

      {/* Cleanup Wizard Modal */}
      <CleanupWizard
        isOpen={showCleanupWizard}
        onClose={() => setShowCleanupWizard(false)}
        onComplete={handleCleanupComplete}
      />
    </div>
  )
}

// Reusable Components

interface SettingsCardProps {
  title: string
  children: React.ReactNode
}

function SettingsCard({ title, children }: SettingsCardProps) {
  return (
    <div className="bg-card border border-border rounded-lg shadow-sm overflow-hidden">
      <div className="px-6 py-4 border-b border-border">
        <h3 className="font-semibold text-foreground">{title}</h3>
      </div>
      <div className="p-6 space-y-4">
        {children}
      </div>
    </div>
  )
}

interface SettingRowProps {
  label: string
  description: string
  children: React.ReactNode
}

function SettingRow({ label, description, children }: SettingRowProps) {
  return (
    <div className="flex items-center justify-between py-2">
      <div>
        <p className="font-medium text-sm text-foreground">{label}</p>
        <p className="text-xs text-muted-foreground">{description}</p>
      </div>
      {children}
    </div>
  )
}

interface ToggleProps {
  defaultChecked?: boolean
  onChange?: (checked: boolean) => void
}

function Toggle({ defaultChecked = false, onChange }: ToggleProps) {
  const [checked, setChecked] = useState(defaultChecked)

  const handleToggle = () => {
    const newValue = !checked
    setChecked(newValue)
    onChange?.(newValue)
  }

  return (
    <button
      onClick={handleToggle}
      className={cn(
        'w-11 h-6 rounded-full transition-colors relative',
        checked ? 'bg-purple-600' : 'bg-gray-300'
      )}
    >
      <div
        className={cn(
          'absolute top-1 w-4 h-4 rounded-full bg-white transition-transform shadow-sm',
          checked ? 'translate-x-6' : 'translate-x-1'
        )}
      />
    </button>
  )
}

interface ThemeOptionProps {
  label: string
  active: boolean
  onClick: () => void
  preview: string
}

function ThemeOption({ label, active, onClick, preview }: ThemeOptionProps) {
  return (
    <button
      onClick={onClick}
      className={cn(
        'p-4 rounded-lg border-2 transition-colors',
        active ? 'border-purple-600' : 'border-border hover:border-purple-300'
      )}
    >
      <div className={cn('w-full h-20 rounded-md border mb-2', preview)} />
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium">{label}</span>
        {active && <Check className="h-4 w-4 text-purple-600" />}
      </div>
    </button>
  )
}

export default Settings
