/**
 * Audio Device Settings Component
 *
 * Displays and allows modification of audio input/output devices.
 * Pre-populated with selections made during Audio Wizard setup.
 * Persists changes across sessions.
 */

import { useState, useEffect, useCallback } from 'react'
import { cn } from '@/lib/utils'
import {
  Mic,
  Volume2,
  RefreshCw,
  AlertCircle,
  CheckCircle,
  XCircle,
  Loader2,
  Settings
} from 'lucide-react'
import type { AudioDevice } from '@/types/database'

// ============================================================================
// Types
// ============================================================================

interface AudioDeviceSettingsProps {
  className?: string
  onDeviceChange?: (inputDevice: string, outputDevice: string) => void
}

interface DeviceStatus {
  isLoading: boolean
  error: string | null
  lastRefresh: Date | null
}

// ============================================================================
// Device Status Badge Component
// ============================================================================

interface DeviceStatusBadgeProps {
  device: AudioDevice | null
  isSelected: boolean
  className?: string
}

function DeviceStatusBadge({ device, isSelected, className }: DeviceStatusBadgeProps) {
  if (!device) {
    return (
      <span className={cn(
        'inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium',
        'bg-red-50 text-red-700 border border-red-200',
        className
      )}>
        <XCircle className="h-3 w-3" />
        Unavailable
      </span>
    )
  }

  const badges = []

  if (isSelected) {
    badges.push(
      <span key="selected" className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-green-50 text-green-700 border border-green-200">
        <CheckCircle className="h-3 w-3" />
        Active
      </span>
    )
  }

  if (device.isDefault) {
    badges.push(
      <span key="default" className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-blue-50 text-blue-700 border border-blue-200">
        Default
      </span>
    )
  }

  if (device.isVirtual) {
    badges.push(
      <span key="virtual" className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-purple-50 text-purple-700 border border-purple-200">
        Virtual
      </span>
    )
  }

  if (badges.length === 0) {
    return null
  }

  return <div className={cn('flex flex-wrap gap-1', className)}>{badges}</div>
}

// ============================================================================
// Device Selector Component
// ============================================================================

interface DeviceSelectorProps {
  label: string
  description: string
  icon: React.ReactNode
  devices: AudioDevice[]
  selectedDeviceId: string
  isLoading: boolean
  disabled?: boolean
  onChange: (deviceId: string) => void
  previousDeviceId?: string | null
}

function DeviceSelector({
  label,
  description,
  icon,
  devices,
  selectedDeviceId,
  isLoading,
  disabled,
  onChange,
  previousDeviceId
}: DeviceSelectorProps) {
  const selectedDevice = devices.find(d => d.id === selectedDeviceId) || null
  const previousDeviceAvailable = previousDeviceId && devices.some(d => d.id === previousDeviceId)

  return (
    <div className="space-y-3">
      <div className="flex items-start justify-between">
        <div className="flex items-center gap-2">
          {icon}
          <div>
            <label className="block text-sm font-medium text-foreground">
              {label}
            </label>
            <p className="text-xs text-muted-foreground">{description}</p>
          </div>
        </div>
        <DeviceStatusBadge
          device={selectedDevice}
          isSelected={!!selectedDeviceId && selectedDevice !== null}
        />
      </div>

      {isLoading ? (
        <div className="flex items-center gap-2 px-3 py-2 bg-secondary/50 rounded-md">
          <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
          <span className="text-sm text-muted-foreground">Loading devices...</span>
        </div>
      ) : devices.length === 0 ? (
        <div className="flex items-center gap-2 px-3 py-2 bg-red-50 border border-red-200 rounded-md">
          <AlertCircle className="h-4 w-4 text-red-600" />
          <span className="text-sm text-red-700">No devices available</span>
        </div>
      ) : (
        <select
          value={selectedDeviceId}
          onChange={(e) => onChange(e.target.value)}
          disabled={disabled || isLoading}
          className={cn(
            'w-full px-3 py-2 bg-background border border-border rounded-md text-sm',
            'focus:outline-none focus:ring-2 focus:ring-purple-500 focus:border-transparent',
            'disabled:opacity-50 disabled:cursor-not-allowed',
            !selectedDevice && selectedDeviceId && 'border-red-300 bg-red-50'
          )}
          data-testid={`${label.toLowerCase().replace(/\s+/g, '-')}-select`}
        >
          <option value="">Select a device</option>
          {devices.map((device) => (
            <option key={device.id} value={device.id}>
              {device.name}
              {device.isDefault ? ' (System Default)' : ''}
              {device.isVirtual ? ' (Virtual)' : ''}
              {previousDeviceId === device.id && previousDeviceAvailable ? ' \u2605 Previously selected' : ''}
            </option>
          ))}
        </select>
      )}

      {/* Show warning if selected device is no longer available */}
      {selectedDeviceId && !selectedDevice && devices.length > 0 && (
        <div className="flex items-start gap-2 p-2 bg-yellow-50 border border-yellow-200 rounded-md">
          <AlertCircle className="h-4 w-4 text-yellow-600 mt-0.5 flex-shrink-0" />
          <div className="text-xs text-yellow-700">
            <p className="font-medium">Previously selected device is no longer available</p>
            <p>Please select a different device from the list above.</p>
          </div>
        </div>
      )}
    </div>
  )
}

// ============================================================================
// Main AudioDeviceSettings Component
// ============================================================================

export function AudioDeviceSettings({ className, onDeviceChange }: AudioDeviceSettingsProps) {
  // Device state
  const [inputDevices, setInputDevices] = useState<AudioDevice[]>([])
  const [outputDevices, setOutputDevices] = useState<AudioDevice[]>([])
  const [selectedInput, setSelectedInput] = useState<string>('')
  const [selectedOutput, setSelectedOutput] = useState<string>('')
  const [previousInput, setPreviousInput] = useState<string | null>(null)
  const [previousOutput, setPreviousOutput] = useState<string | null>(null)

  // Status state
  const [status, setStatus] = useState<DeviceStatus>({
    isLoading: true,
    error: null,
    lastRefresh: null
  })
  const [isSaving, setIsSaving] = useState(false)
  const [saveSuccess, setSaveSuccess] = useState(false)
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false)

  // Load devices and saved settings
  const loadDevices = useCallback(async (showLoading = true) => {
    if (showLoading) {
      setStatus(prev => ({ ...prev, isLoading: true, error: null }))
    }

    try {
      // Load saved settings and available devices in parallel
      const [savedInputDevice, savedOutputDevice, devices] = await Promise.all([
        window.electronAPI.db.settings.get<string>('audio.inputDevice'),
        window.electronAPI.db.settings.get<string>('audio.outputDevice'),
        window.electronAPI.audioDevices.getAll()
      ])

      // Filter devices by type
      const inputs = devices.filter(d => d.type === 'input' || d.type === 'virtual')
      const outputs = devices.filter(d => d.type === 'output' || d.type === 'virtual')

      setInputDevices(inputs)
      setOutputDevices(outputs)

      // Check if saved devices are still available
      const savedInputExists = savedInputDevice && inputs.some(d => d.id === savedInputDevice)
      const savedOutputExists = savedOutputDevice && outputs.some(d => d.id === savedOutputDevice)

      // Store previous selections for indicator
      if (savedInputDevice) {
        setPreviousInput(savedInputDevice)
      }
      if (savedOutputDevice) {
        setPreviousOutput(savedOutputDevice)
      }

      // Set initial selection: prefer saved device, fallback to default
      if (savedInputExists) {
        setSelectedInput(savedInputDevice)
      } else {
        const defaultInput = inputs.find(d => d.isDefault) || inputs[0]
        setSelectedInput(defaultInput?.id || '')
      }

      if (savedOutputExists) {
        setSelectedOutput(savedOutputDevice)
      } else {
        const defaultOutput = outputs.find(d => d.isDefault) || outputs[0]
        setSelectedOutput(defaultOutput?.id || '')
      }

      setStatus({
        isLoading: false,
        error: null,
        lastRefresh: new Date()
      })
      setHasUnsavedChanges(false)
    } catch (err) {
      console.error('Failed to load audio devices:', err)
      setStatus({
        isLoading: false,
        error: err instanceof Error ? err.message : 'Failed to load audio devices',
        lastRefresh: new Date()
      })
    }
  }, [])

  // Initial load
  useEffect(() => {
    loadDevices()
  }, [loadDevices])

  // Set up device change listener for hot-plug support
  // Only poll when the component is visible to avoid performance issues
  useEffect(() => {
    // Use a longer polling interval (30 seconds) and only when the document is visible
    // to reduce performance impact while still supporting device hot-plug
    let pollInterval: ReturnType<typeof setInterval> | null = null

    const startPolling = () => {
      // Clear any existing interval
      if (pollInterval) {
        clearInterval(pollInterval)
      }
      // Poll every 30 seconds instead of 5 seconds to reduce performance impact
      pollInterval = setInterval(() => {
        // Only refresh if the document is visible
        if (document.visibilityState === 'visible') {
          loadDevices(false) // Don't show loading state for background refresh
        }
      }, 30000)
    }

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        // Refresh devices when tab becomes visible again
        loadDevices(false)
        startPolling()
      } else {
        // Stop polling when tab is hidden
        if (pollInterval) {
          clearInterval(pollInterval)
          pollInterval = null
        }
      }
    }

    // Start polling initially only if document is visible
    if (document.visibilityState === 'visible') {
      startPolling()
    }

    // Listen for visibility changes
    document.addEventListener('visibilitychange', handleVisibilityChange)

    return () => {
      if (pollInterval) {
        clearInterval(pollInterval)
      }
      document.removeEventListener('visibilitychange', handleVisibilityChange)
    }
  }, [loadDevices])

  // Handle input device change
  const handleInputChange = useCallback((deviceId: string) => {
    setSelectedInput(deviceId)
    setHasUnsavedChanges(true)
    setSaveSuccess(false)
  }, [])

  // Handle output device change
  const handleOutputChange = useCallback((deviceId: string) => {
    setSelectedOutput(deviceId)
    setHasUnsavedChanges(true)
    setSaveSuccess(false)
  }, [])

  // Apply changes
  const handleApplyChanges = useCallback(async () => {
    if (!selectedInput && !selectedOutput) {
      return
    }

    setIsSaving(true)
    setSaveSuccess(false)

    try {
      // Save settings
      if (selectedInput) {
        await window.electronAPI.db.settings.set('audio.inputDevice', selectedInput, 'audio')
      }
      if (selectedOutput) {
        await window.electronAPI.db.settings.set('audio.outputDevice', selectedOutput, 'audio')
      }

      // Update previous selections
      setPreviousInput(selectedInput)
      setPreviousOutput(selectedOutput)

      setHasUnsavedChanges(false)
      setSaveSuccess(true)

      // Notify parent component
      onDeviceChange?.(selectedInput, selectedOutput)

      // Clear success message after 3 seconds
      setTimeout(() => setSaveSuccess(false), 3000)
    } catch (err) {
      console.error('Failed to save audio settings:', err)
      setStatus(prev => ({
        ...prev,
        error: err instanceof Error ? err.message : 'Failed to save settings'
      }))
    } finally {
      setIsSaving(false)
    }
  }, [selectedInput, selectedOutput, onDeviceChange])

  // Refresh devices manually
  const handleRefresh = useCallback(() => {
    loadDevices(true)
  }, [loadDevices])

  // Get selected device objects for status display
  const selectedInputDevice = inputDevices.find(d => d.id === selectedInput)
  const selectedOutputDevice = outputDevices.find(d => d.id === selectedOutput)

  return (
    <div className={cn('space-y-6', className)}>
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Settings className="h-5 w-5 text-purple-600" />
          <h3 className="font-semibold text-foreground">Audio Device Settings</h3>
        </div>
        <button
          onClick={handleRefresh}
          disabled={status.isLoading}
          className={cn(
            'p-2 rounded-md hover:bg-accent transition-colors',
            status.isLoading && 'opacity-50 cursor-not-allowed'
          )}
          title="Refresh device list"
          data-testid="refresh-devices-button"
        >
          <RefreshCw
            className={cn(
              'h-4 w-4 text-muted-foreground',
              status.isLoading && 'animate-spin'
            )}
          />
        </button>
      </div>

      {/* Error message */}
      {status.error && (
        <div className="flex items-start gap-2 p-3 bg-red-50 border border-red-200 rounded-lg">
          <XCircle className="h-5 w-5 text-red-600 mt-0.5 flex-shrink-0" />
          <div className="text-sm text-red-700">
            <p className="font-medium">Error loading devices</p>
            <p>{status.error}</p>
          </div>
        </div>
      )}

      {/* Success message */}
      {saveSuccess && (
        <div className="flex items-center gap-2 p-3 bg-green-50 border border-green-200 rounded-lg" data-testid="save-success-message">
          <CheckCircle className="h-5 w-5 text-green-600" />
          <span className="text-sm text-green-700 font-medium">
            Audio device settings saved successfully
          </span>
        </div>
      )}

      {/* Device Selectors */}
      <div className="space-y-6">
        {/* Input Device */}
        <DeviceSelector
          label="Input Device"
          description="Select the microphone for recording"
          icon={<Mic className="h-5 w-5 text-muted-foreground" />}
          devices={inputDevices}
          selectedDeviceId={selectedInput}
          isLoading={status.isLoading}
          onChange={handleInputChange}
          previousDeviceId={previousInput}
        />

        {/* Output Device */}
        <DeviceSelector
          label="Output Device"
          description="Select the audio output for playback"
          icon={<Volume2 className="h-5 w-5 text-muted-foreground" />}
          devices={outputDevices}
          selectedDeviceId={selectedOutput}
          isLoading={status.isLoading}
          onChange={handleOutputChange}
          previousDeviceId={previousOutput}
        />
      </div>

      {/* Current Selection Summary */}
      {!status.isLoading && (selectedInputDevice || selectedOutputDevice) && (
        <div className="p-4 bg-secondary/30 rounded-lg space-y-2">
          <h4 className="text-sm font-medium text-foreground">Current Selection</h4>
          <div className="grid grid-cols-2 gap-4 text-sm">
            <div>
              <span className="text-muted-foreground">Input: </span>
              <span className="font-medium text-foreground">
                {selectedInputDevice?.name || 'None selected'}
              </span>
            </div>
            <div>
              <span className="text-muted-foreground">Output: </span>
              <span className="font-medium text-foreground">
                {selectedOutputDevice?.name || 'None selected'}
              </span>
            </div>
          </div>
        </div>
      )}

      {/* Apply Button */}
      <div className="flex items-center justify-between pt-2 border-t border-border">
        <p className="text-xs text-muted-foreground">
          {status.lastRefresh && (
            <>Last refreshed: {status.lastRefresh.toLocaleTimeString()}</>
          )}
        </p>
        <button
          onClick={handleApplyChanges}
          disabled={!hasUnsavedChanges || isSaving || status.isLoading}
          className={cn(
            'px-4 py-2 bg-purple-600 hover:bg-purple-700 text-white rounded-md text-sm font-medium',
            'flex items-center gap-2 transition-colors',
            (!hasUnsavedChanges || isSaving || status.isLoading) && 'opacity-50 cursor-not-allowed'
          )}
          data-testid="apply-changes-button"
        >
          {isSaving ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin" />
              Saving...
            </>
          ) : (
            <>
              <CheckCircle className="h-4 w-4" />
              Apply Changes
            </>
          )}
        </button>
      </div>

      {/* Tip */}
      <div className="flex items-start gap-2 p-3 bg-blue-50 border border-blue-200 rounded-lg">
        <AlertCircle className="h-5 w-5 text-blue-600 mt-0.5 flex-shrink-0" />
        <div className="text-sm text-blue-800">
          <p className="font-medium">Tip</p>
          <p>
            Configure your meeting app (Zoom, Teams, etc.) to use a virtual audio driver
            as its output device to capture system audio during recordings.
          </p>
        </div>
      </div>
    </div>
  )
}

export default AudioDeviceSettings
