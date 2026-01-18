/**
 * Windows Audio Compatibility Service
 *
 * Provides Windows-specific audio recording compatibility layer to ensure sox/ffmpeg work correctly.
 * Implements:
 * - Windows device enumeration using DirectShow and WASAPI
 * - GUID to friendly name translation for audio devices
 * - Support for common Windows audio devices (Realtek, Conexant, built-in laptop audio)
 * - Fallback mechanisms when sox fails (node-record-lpcm16, ffmpeg, PowerShell recording)
 * - Windows audio permissions handling (microphone privacy settings in Windows 10/11)
 * - Virtual audio cable support (VB-Audio Virtual Cable, Voicemeeter)
 * - Windows-specific diagnostics (driver detection, exclusive mode conflicts, sample rate support)
 * - Clear error messages with remediation steps
 */

import { exec, execSync, spawn, ChildProcess } from 'child_process'
import { promisify } from 'util'
import * as path from 'path'
import * as fs from 'fs'
import * as os from 'os'
import { app } from 'electron'
import { EventEmitter } from 'events'
import { binaryManager } from './binaryManager'

const execAsync = promisify(exec)

// ============================================================================
// Types
// ============================================================================

export type WindowsAudioDeviceType = 'input' | 'output' | 'virtual' | 'loopback'
export type WindowsAudioAPIType = 'wasapi' | 'directshow' | 'mme' | 'unknown'
export type WindowsRecorderType = 'sox' | 'ffmpeg' | 'powershell' | 'node_native'

export interface WindowsAudioDevice {
  /** Device ID (may be GUID or friendly name depending on API) */
  id: string
  /** Human-readable device name */
  friendlyName: string
  /** Device GUID (Windows-specific identifier) */
  guid: string | null
  /** Device type */
  type: WindowsAudioDeviceType
  /** Detected API that can access this device */
  api: WindowsAudioAPIType
  /** Is this the default device? */
  isDefault: boolean
  /** Is this a virtual device (VB-Audio, Voicemeeter)? */
  isVirtual: boolean
  /** Virtual cable type if applicable */
  virtualCableType: 'vb-audio' | 'voicemeeter' | 'vac' | null
  /** Device manufacturer */
  manufacturer: string | null
  /** Supported sample rates */
  supportedSampleRates: number[]
  /** Whether device is currently in use (exclusive mode) */
  inExclusiveMode: boolean
  /** Device status */
  status: 'active' | 'disabled' | 'not_present' | 'unplugged'
}

export interface WindowsAudioDriverInfo {
  /** Driver name */
  name: string
  /** Driver version */
  version: string | null
  /** Driver date */
  date: string | null
  /** Driver provider (e.g., Realtek, Microsoft, Conexant) */
  provider: string | null
  /** Driver file path */
  filePath: string | null
  /** Is driver digital signed? */
  isSigned: boolean
}

export interface WindowsAudioPermissionStatus {
  /** Is microphone access allowed in Windows privacy settings? */
  microphoneAccessAllowed: boolean
  /** Is microphone access enabled for desktop apps? */
  desktopAppsAllowed: boolean
  /** Is microphone access enabled for this specific app? */
  thisAppAllowed: boolean
  /** Permission status message */
  message: string
  /** Windows version (10/11) */
  windowsVersion: '10' | '11' | 'unknown'
  /** Remediation steps if access is denied */
  remediation: string[]
}

export interface WindowsExclusiveModeStatus {
  /** Is exclusive mode enabled system-wide? */
  enabled: boolean
  /** Devices currently in exclusive mode */
  devicesInExclusiveMode: string[]
  /** Conflict detected that may affect recording */
  hasConflict: boolean
  /** Remediation steps */
  remediation: string[]
}

export interface WindowsSampleRateInfo {
  /** Device ID */
  deviceId: string
  /** Device name */
  deviceName: string
  /** Default sample rate */
  defaultRate: number
  /** All supported sample rates */
  supportedRates: number[]
  /** Recommended rate for this application */
  recommendedRate: number
  /** Can the device handle 16kHz (required for transcription)? */
  supports16kHz: boolean
}

export interface WindowsVirtualCableInfo {
  /** Type of virtual cable */
  type: 'vb-audio' | 'voicemeeter' | 'vac' | 'unknown'
  /** Is the virtual cable installed? */
  installed: boolean
  /** Version if detected */
  version: string | null
  /** Input device name (for recording from it) */
  inputDeviceName: string | null
  /** Output device name (for routing audio to it) */
  outputDeviceName: string | null
  /** Installation path */
  installPath: string | null
  /** Is properly configured? */
  isConfigured: boolean
  /** Configuration issues if any */
  issues: string[]
}

export interface WindowsAudioDiagnostics {
  /** Timestamp of diagnostics */
  timestamp: string
  /** Windows version info */
  windowsVersion: {
    version: string
    build: string
    edition: string
  }
  /** All detected audio devices */
  devices: WindowsAudioDevice[]
  /** Audio driver information */
  drivers: WindowsAudioDriverInfo[]
  /** Permission status */
  permissions: WindowsAudioPermissionStatus
  /** Exclusive mode status */
  exclusiveMode: WindowsExclusiveModeStatus
  /** Sample rate information per device */
  sampleRates: WindowsSampleRateInfo[]
  /** Virtual cable detection results */
  virtualCables: WindowsVirtualCableInfo[]
  /** Available recording methods */
  availableRecorders: {
    recorder: WindowsRecorderType
    available: boolean
    path: string | null
    version: string | null
  }[]
  /** Overall audio system health */
  overallHealth: 'healthy' | 'degraded' | 'failed'
  /** Issues found */
  issues: WindowsAudioIssue[]
  /** All remediation steps */
  allRemediationSteps: string[]
}

export interface WindowsAudioIssue {
  /** Issue category */
  category: 'device' | 'driver' | 'permission' | 'exclusive_mode' | 'sample_rate' | 'virtual_cable' | 'recorder'
  /** Severity level */
  severity: 'critical' | 'warning' | 'info'
  /** Issue code for programmatic handling */
  code: string
  /** Human-readable message */
  message: string
  /** Technical details */
  details?: string
  /** Affected device if applicable */
  deviceId?: string
  /** Remediation steps */
  remediation: string[]
}

export interface WindowsRecordingFallbackResult {
  /** Whether fallback was successful */
  success: boolean
  /** Recorder that worked */
  recorder: WindowsRecorderType | null
  /** Recording process or stream */
  process: ChildProcess | null
  /** Warning message if applicable */
  warning?: string
  /** Error message if all fallbacks failed */
  error?: string
}

// ============================================================================
// Constants
// ============================================================================

const COMMON_SAMPLE_RATES = [8000, 11025, 16000, 22050, 44100, 48000, 96000]
const REQUIRED_SAMPLE_RATE = 16000 // For transcription

// Virtual cable device name patterns
const VB_AUDIO_PATTERNS = [
  'cable input',
  'cable output',
  'vb-audio',
  'vb audio',
  'virtual cable'
]

const VOICEMEETER_PATTERNS = [
  'voicemeeter',
  'voicemeeter input',
  'voicemeeter output',
  'voicemeeter aux',
  'voicemeeter vaio',
  'vb-audio voicemeeter'
]

const VAC_PATTERNS = [
  'virtual audio cable',
  'vac',
  'line 1 (virtual audio cable)'
]

// Common Windows audio device manufacturers
const KNOWN_MANUFACTURERS = [
  'realtek',
  'conexant',
  'intel',
  'nvidia',
  'amd',
  'microsoft',
  'creative',
  'asus',
  'logitech',
  'corsair',
  'steelseries',
  'hyperx',
  'razer',
  'blue',
  'rode',
  'focusrite',
  'steinberg',
  'behringer'
]

// ============================================================================
// Windows Audio Compatibility Service
// ============================================================================

class WindowsAudioCompatibilityService extends EventEmitter {
  private deviceCache: WindowsAudioDevice[] = []
  private lastCacheTime: number = 0
  private readonly cacheDurationMs = 30000 // Cache for 30 seconds

  constructor() {
    super()
    this.setMaxListeners(20)
  }

  /**
   * Check if running on Windows
   */
  isWindows(): boolean {
    return process.platform === 'win32'
  }

  /**
   * Get Windows version information
   */
  async getWindowsVersion(): Promise<{ version: string; build: string; edition: string }> {
    if (!this.isWindows()) {
      return { version: 'N/A', build: 'N/A', edition: 'N/A' }
    }

    try {
      const { stdout } = await execAsync(
        'powershell -Command "[System.Environment]::OSVersion.Version.ToString()"',
        { timeout: 5000 }
      )
      const version = stdout.trim()

      // Get more detailed info
      const { stdout: buildInfo } = await execAsync(
        'powershell -Command "(Get-ItemProperty \'HKLM:\\SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion\').DisplayVersion"',
        { timeout: 5000 }
      )

      const { stdout: editionInfo } = await execAsync(
        'powershell -Command "(Get-ItemProperty \'HKLM:\\SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion\').ProductName"',
        { timeout: 5000 }
      )

      return {
        version,
        build: buildInfo.trim(),
        edition: editionInfo.trim()
      }
    } catch (error) {
      console.error('[WindowsAudio] Error getting Windows version:', error)
      return { version: 'unknown', build: 'unknown', edition: 'unknown' }
    }
  }

  // ==========================================================================
  // Device Enumeration
  // ==========================================================================

  /**
   * Enumerate all audio devices using PowerShell/WMI
   */
  async enumerateDevices(forceRefresh = false): Promise<WindowsAudioDevice[]> {
    if (!this.isWindows()) {
      return []
    }

    // Return cached devices if still valid
    if (!forceRefresh && Date.now() - this.lastCacheTime < this.cacheDurationMs && this.deviceCache.length > 0) {
      return this.deviceCache
    }

    const devices: WindowsAudioDevice[] = []

    try {
      // Method 1: Use PowerShell with Get-PnpDevice for audio devices
      const pnpDevices = await this.enumerateWithPnpDevice()
      devices.push(...pnpDevices)

      // Method 2: Use WMI Win32_SoundDevice for additional info
      const wmiDevices = await this.enumerateWithWMI()

      // Merge WMI info into PnP devices
      for (const wmiDevice of wmiDevices) {
        const existing = devices.find(d =>
          d.friendlyName.toLowerCase() === wmiDevice.friendlyName.toLowerCase()
        )
        if (existing) {
          // Update with WMI info
          existing.manufacturer = existing.manufacturer || wmiDevice.manufacturer
          existing.status = wmiDevice.status
        } else if (wmiDevice.friendlyName) {
          devices.push(wmiDevice)
        }
      }

      // Method 3: Get DirectShow devices via ffmpeg (if available)
      const dsDevices = await this.enumerateWithFFmpeg()
      for (const dsDevice of dsDevices) {
        const existing = devices.find(d =>
          d.friendlyName.toLowerCase() === dsDevice.friendlyName.toLowerCase()
        )
        if (!existing) {
          devices.push(dsDevice)
        }
      }

      // Update cache
      this.deviceCache = devices
      this.lastCacheTime = Date.now()

      return devices
    } catch (error) {
      console.error('[WindowsAudio] Error enumerating devices:', error)
      return []
    }
  }

  /**
   * Enumerate audio devices using Get-PnpDevice
   */
  private async enumerateWithPnpDevice(): Promise<WindowsAudioDevice[]> {
    const devices: WindowsAudioDevice[] = []

    try {
      const { stdout } = await execAsync(
        `powershell -Command "Get-PnpDevice -Class 'AudioEndpoint' | Select-Object InstanceId, FriendlyName, Status | ConvertTo-Json"`,
        { timeout: 15000 }
      )

      const rawDevices = JSON.parse(stdout || '[]')
      const deviceList = Array.isArray(rawDevices) ? rawDevices : [rawDevices]

      for (const device of deviceList) {
        if (!device?.FriendlyName) continue

        const friendlyName = device.FriendlyName
        const instanceId = device.InstanceId || ''
        const status = device.Status?.toLowerCase() || 'unknown'

        // Determine device type based on name
        const isOutput = friendlyName.toLowerCase().includes('speaker') ||
                        friendlyName.toLowerCase().includes('headphone') ||
                        friendlyName.toLowerCase().includes('output')
        const isInput = friendlyName.toLowerCase().includes('microphone') ||
                       friendlyName.toLowerCase().includes('mic') ||
                       friendlyName.toLowerCase().includes('input') ||
                       friendlyName.toLowerCase().includes('line in')

        // Check for virtual devices
        const isVirtual = this.isVirtualDevice(friendlyName)
        const virtualCableType = this.getVirtualCableType(friendlyName)

        devices.push({
          id: instanceId,
          friendlyName,
          guid: this.extractGuidFromInstanceId(instanceId),
          type: isVirtual ? 'virtual' : (isInput ? 'input' : 'output'),
          api: 'wasapi',
          isDefault: false, // Will be updated later
          isVirtual,
          virtualCableType,
          manufacturer: this.detectManufacturer(friendlyName),
          supportedSampleRates: COMMON_SAMPLE_RATES, // Will be refined later
          inExclusiveMode: false,
          status: status === 'ok' ? 'active' : (status === 'error' ? 'disabled' : 'not_present')
        })
      }
    } catch (error) {
      console.error('[WindowsAudio] PnpDevice enumeration failed:', error)
    }

    return devices
  }

  /**
   * Enumerate audio devices using WMI Win32_SoundDevice
   */
  private async enumerateWithWMI(): Promise<WindowsAudioDevice[]> {
    const devices: WindowsAudioDevice[] = []

    try {
      const { stdout } = await execAsync(
        'powershell -Command "Get-WmiObject Win32_SoundDevice | Select-Object Name, DeviceID, Status, Manufacturer | ConvertTo-Json"',
        { timeout: 15000 }
      )

      const rawDevices = JSON.parse(stdout || '[]')
      const deviceList = Array.isArray(rawDevices) ? rawDevices : [rawDevices]

      for (const device of deviceList) {
        if (!device?.Name) continue

        const friendlyName = device.Name
        const isVirtual = this.isVirtualDevice(friendlyName)
        const virtualCableType = this.getVirtualCableType(friendlyName)

        devices.push({
          id: device.DeviceID || `wmi-${devices.length}`,
          friendlyName,
          guid: null,
          type: isVirtual ? 'virtual' : 'output', // WMI doesn't distinguish well
          api: 'mme',
          isDefault: false,
          isVirtual,
          virtualCableType,
          manufacturer: device.Manufacturer || this.detectManufacturer(friendlyName),
          supportedSampleRates: COMMON_SAMPLE_RATES,
          inExclusiveMode: false,
          status: device.Status?.toLowerCase() === 'ok' ? 'active' : 'disabled'
        })
      }
    } catch (error) {
      console.error('[WindowsAudio] WMI enumeration failed:', error)
    }

    return devices
  }

  /**
   * Enumerate audio devices using ffmpeg -list_devices
   */
  private async enumerateWithFFmpeg(): Promise<WindowsAudioDevice[]> {
    const devices: WindowsAudioDevice[] = []

    try {
      const ffmpegPath = await binaryManager.getBinaryPath('ffmpeg')
      if (!ffmpegPath) return devices

      const { stderr } = await execAsync(
        `"${ffmpegPath}" -list_devices true -f dshow -i dummy 2>&1`,
        { timeout: 10000 }
      ).catch(e => ({ stderr: e.stderr || '' }))

      // Parse ffmpeg output for audio devices
      const audioSection = stderr.split('DirectShow audio devices')[1]?.split('DirectShow video devices')[0] || stderr
      const lines = audioSection.split('\n')

      let isAudioSection = false
      for (const line of lines) {
        if (line.includes('DirectShow audio devices')) {
          isAudioSection = true
          continue
        }
        if (line.includes('DirectShow video devices')) {
          break
        }

        // Match device names like '[dshow @ ...] "Device Name"'
        const match = line.match(/\[dshow.*?\]\s*"([^"]+)"/)
        if (match && isAudioSection) {
          const friendlyName = match[1]

          // Skip alternative names
          if (line.includes('Alternative name')) continue

          const isVirtual = this.isVirtualDevice(friendlyName)
          const virtualCableType = this.getVirtualCableType(friendlyName)

          devices.push({
            id: `dshow-${friendlyName}`,
            friendlyName,
            guid: null,
            type: isVirtual ? 'virtual' : 'input',
            api: 'directshow',
            isDefault: false,
            isVirtual,
            virtualCableType,
            manufacturer: this.detectManufacturer(friendlyName),
            supportedSampleRates: COMMON_SAMPLE_RATES,
            inExclusiveMode: false,
            status: 'active'
          })
        }
      }
    } catch (error) {
      console.error('[WindowsAudio] FFmpeg enumeration failed:', error)
    }

    return devices
  }

  /**
   * Get default audio devices
   */
  async getDefaultDevices(): Promise<{ input: WindowsAudioDevice | null; output: WindowsAudioDevice | null }> {
    if (!this.isWindows()) {
      return { input: null, output: null }
    }

    try {
      // Get default playback device
      const { stdout: playbackOutput } = await execAsync(
        `powershell -Command "(Get-AudioDevice -Playback).Name"`,
        { timeout: 5000 }
      ).catch(() => ({ stdout: '' }))

      // Get default recording device
      const { stdout: recordingOutput } = await execAsync(
        `powershell -Command "(Get-AudioDevice -Recording).Name"`,
        { timeout: 5000 }
      ).catch(() => ({ stdout: '' }))

      // Fallback: use registry queries
      let defaultPlayback = playbackOutput.trim()
      let defaultRecording = recordingOutput.trim()

      if (!defaultPlayback) {
        const { stdout: regPlayback } = await execAsync(
          `powershell -Command "Get-ItemProperty 'HKCU:\\Software\\Microsoft\\Multimedia\\Sound Mapper' -Name Playback -ErrorAction SilentlyContinue | Select-Object -ExpandProperty Playback"`,
          { timeout: 5000 }
        ).catch(() => ({ stdout: '' }))
        defaultPlayback = regPlayback.trim()
      }

      if (!defaultRecording) {
        const { stdout: regRecording } = await execAsync(
          `powershell -Command "Get-ItemProperty 'HKCU:\\Software\\Microsoft\\Multimedia\\Sound Mapper' -Name Record -ErrorAction SilentlyContinue | Select-Object -ExpandProperty Record"`,
          { timeout: 5000 }
        ).catch(() => ({ stdout: '' }))
        defaultRecording = regRecording.trim()
      }

      const devices = await this.enumerateDevices()

      const input = devices.find(d =>
        d.friendlyName.toLowerCase().includes(defaultRecording.toLowerCase()) ||
        (d.type === 'input' && d.isDefault)
      ) || null

      const output = devices.find(d =>
        d.friendlyName.toLowerCase().includes(defaultPlayback.toLowerCase()) ||
        (d.type === 'output' && d.isDefault)
      ) || null

      // Mark defaults
      if (input) input.isDefault = true
      if (output) output.isDefault = true

      return { input, output }
    } catch (error) {
      console.error('[WindowsAudio] Error getting default devices:', error)
      return { input: null, output: null }
    }
  }

  // ==========================================================================
  // GUID and Device Name Handling
  // ==========================================================================

  /**
   * Extract GUID from Windows device instance ID
   */
  private extractGuidFromInstanceId(instanceId: string): string | null {
    // Instance ID format: SWD\MMDEVAPI\{...GUID...}
    const match = instanceId.match(/\{([0-9A-Fa-f-]+)\}/)
    return match ? match[1] : null
  }

  /**
   * Convert device GUID to friendly name
   */
  async guidToFriendlyName(guid: string): Promise<string | null> {
    if (!this.isWindows() || !guid) return null

    try {
      const devices = await this.enumerateDevices()
      const device = devices.find(d => d.guid === guid || d.id.includes(guid))
      return device?.friendlyName || null
    } catch {
      return null
    }
  }

  /**
   * Convert friendly name to device GUID
   */
  async friendlyNameToGuid(friendlyName: string): Promise<string | null> {
    if (!this.isWindows() || !friendlyName) return null

    try {
      const devices = await this.enumerateDevices()
      const device = devices.find(d =>
        d.friendlyName.toLowerCase() === friendlyName.toLowerCase()
      )
      return device?.guid || null
    } catch {
      return null
    }
  }

  /**
   * Get device name suitable for sox/ffmpeg
   * Handles the translation between Windows device naming and audio tool expectations
   */
  async getDeviceNameForRecorder(
    device: WindowsAudioDevice | string,
    recorder: WindowsRecorderType
  ): Promise<string> {
    let deviceInfo: WindowsAudioDevice | undefined

    if (typeof device === 'string') {
      const devices = await this.enumerateDevices()
      deviceInfo = devices.find(d =>
        d.friendlyName.toLowerCase() === device.toLowerCase() ||
        d.id === device ||
        d.guid === device
      )
    } else {
      deviceInfo = device
    }

    if (!deviceInfo) {
      return typeof device === 'string' ? device : device.friendlyName
    }

    switch (recorder) {
      case 'ffmpeg':
        // FFmpeg DirectShow uses friendly names directly
        return deviceInfo.friendlyName

      case 'sox':
        // Sox on Windows uses device index or name
        // For WASAPI, we might need to use the device index
        return deviceInfo.friendlyName

      case 'powershell':
        // PowerShell uses friendly names
        return deviceInfo.friendlyName

      case 'node_native':
        // node-record-lpcm16 uses device names
        return deviceInfo.friendlyName

      default:
        return deviceInfo.friendlyName
    }
  }

  // ==========================================================================
  // Virtual Cable Detection
  // ==========================================================================

  /**
   * Check if device name indicates a virtual audio device
   */
  private isVirtualDevice(name: string): boolean {
    const lower = name.toLowerCase()
    return VB_AUDIO_PATTERNS.some(p => lower.includes(p)) ||
           VOICEMEETER_PATTERNS.some(p => lower.includes(p)) ||
           VAC_PATTERNS.some(p => lower.includes(p))
  }

  /**
   * Get virtual cable type from device name
   */
  private getVirtualCableType(name: string): 'vb-audio' | 'voicemeeter' | 'vac' | null {
    const lower = name.toLowerCase()

    if (VOICEMEETER_PATTERNS.some(p => lower.includes(p))) {
      return 'voicemeeter'
    }
    if (VB_AUDIO_PATTERNS.some(p => lower.includes(p))) {
      return 'vb-audio'
    }
    if (VAC_PATTERNS.some(p => lower.includes(p))) {
      return 'vac'
    }

    return null
  }

  /**
   * Detect manufacturer from device name
   */
  private detectManufacturer(name: string): string | null {
    const lower = name.toLowerCase()
    for (const mfr of KNOWN_MANUFACTURERS) {
      if (lower.includes(mfr)) {
        return mfr.charAt(0).toUpperCase() + mfr.slice(1)
      }
    }
    return null
  }

  /**
   * Detect all installed virtual audio cables
   */
  async detectVirtualCables(): Promise<WindowsVirtualCableInfo[]> {
    if (!this.isWindows()) return []

    const cables: WindowsVirtualCableInfo[] = []
    const devices = await this.enumerateDevices()

    // Check for VB-Audio Virtual Cable
    const vbAudioInput = devices.find(d =>
      d.virtualCableType === 'vb-audio' &&
      (d.type === 'input' || d.friendlyName.toLowerCase().includes('output'))
    )
    const vbAudioOutput = devices.find(d =>
      d.virtualCableType === 'vb-audio' &&
      (d.type === 'output' || d.friendlyName.toLowerCase().includes('input'))
    )

    if (vbAudioInput || vbAudioOutput) {
      const vbInfo = await this.getVBCableInfo()
      cables.push({
        type: 'vb-audio',
        installed: true,
        version: vbInfo.version,
        inputDeviceName: vbAudioInput?.friendlyName || 'CABLE Output (VB-Audio Virtual Cable)',
        outputDeviceName: vbAudioOutput?.friendlyName || 'CABLE Input (VB-Audio Virtual Cable)',
        installPath: vbInfo.installPath,
        isConfigured: !!(vbAudioInput && vbAudioOutput),
        issues: []
      })
    }

    // Check for Voicemeeter
    const voicemeeterDevices = devices.filter(d => d.virtualCableType === 'voicemeeter')
    if (voicemeeterDevices.length > 0) {
      const vmInfo = await this.getVoicemeeterInfo()
      cables.push({
        type: 'voicemeeter',
        installed: true,
        version: vmInfo.version,
        inputDeviceName: voicemeeterDevices.find(d => d.type === 'input')?.friendlyName || null,
        outputDeviceName: voicemeeterDevices.find(d => d.type === 'output')?.friendlyName || null,
        installPath: vmInfo.installPath,
        isConfigured: voicemeeterDevices.length >= 2,
        issues: vmInfo.issues
      })
    }

    // Check for Virtual Audio Cable (VAC)
    const vacDevices = devices.filter(d => d.virtualCableType === 'vac')
    if (vacDevices.length > 0) {
      cables.push({
        type: 'vac',
        installed: true,
        version: null,
        inputDeviceName: vacDevices.find(d => d.type === 'input')?.friendlyName || null,
        outputDeviceName: vacDevices.find(d => d.type === 'output')?.friendlyName || null,
        installPath: null,
        isConfigured: vacDevices.length >= 2,
        issues: []
      })
    }

    return cables
  }

  /**
   * Get VB-Cable specific information
   */
  private async getVBCableInfo(): Promise<{ version: string | null; installPath: string | null }> {
    try {
      // Check common install locations
      const possiblePaths = [
        path.join(process.env.ProgramFiles || 'C:\\Program Files', 'VB', 'CABLE'),
        path.join(process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)', 'VB', 'CABLE'),
        path.join(process.env.ProgramFiles || 'C:\\Program Files', 'VB-Audio', 'CABLE'),
        'C:\\VB-Audio'
      ]

      for (const installPath of possiblePaths) {
        if (fs.existsSync(installPath)) {
          return { version: null, installPath }
        }
      }

      // Check registry
      const { stdout } = await execAsync(
        `powershell -Command "Get-ItemProperty 'HKLM:\\SOFTWARE\\VB-Audio\\Cable' -ErrorAction SilentlyContinue | Select-Object -ExpandProperty Version"`,
        { timeout: 5000 }
      ).catch(() => ({ stdout: '' }))

      return { version: stdout.trim() || null, installPath: null }
    } catch {
      return { version: null, installPath: null }
    }
  }

  /**
   * Get Voicemeeter specific information
   */
  private async getVoicemeeterInfo(): Promise<{ version: string | null; installPath: string | null; issues: string[] }> {
    const issues: string[] = []

    try {
      // Check common install locations
      const possiblePaths = [
        path.join(process.env.ProgramFiles || 'C:\\Program Files', 'VB', 'Voicemeeter'),
        path.join(process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)', 'VB', 'Voicemeeter')
      ]

      for (const installPath of possiblePaths) {
        if (fs.existsSync(installPath)) {
          // Check if Voicemeeter is running (required for virtual devices to work)
          const { stdout } = await execAsync(
            'powershell -Command "Get-Process -Name voicemeeter* -ErrorAction SilentlyContinue | Select-Object -First 1"',
            { timeout: 5000 }
          ).catch(() => ({ stdout: '' }))

          if (!stdout.trim()) {
            issues.push('Voicemeeter is not running. Start Voicemeeter for virtual devices to work.')
          }

          return { version: null, installPath, issues }
        }
      }

      return { version: null, installPath: null, issues }
    } catch {
      return { version: null, installPath: null, issues }
    }
  }

  // ==========================================================================
  // Windows Audio Permissions
  // ==========================================================================

  /**
   * Check Windows microphone privacy settings
   */
  async checkMicrophonePermissions(): Promise<WindowsAudioPermissionStatus> {
    if (!this.isWindows()) {
      return {
        microphoneAccessAllowed: true,
        desktopAppsAllowed: true,
        thisAppAllowed: true,
        message: 'Not running on Windows',
        windowsVersion: 'unknown',
        remediation: []
      }
    }

    const result: WindowsAudioPermissionStatus = {
      microphoneAccessAllowed: true,
      desktopAppsAllowed: true,
      thisAppAllowed: true,
      message: 'Microphone access is allowed',
      windowsVersion: 'unknown',
      remediation: []
    }

    try {
      // Determine Windows version
      const { stdout: versionOutput } = await execAsync(
        'powershell -Command "[System.Environment]::OSVersion.Version.Build"',
        { timeout: 5000 }
      )
      const buildNumber = parseInt(versionOutput.trim(), 10)
      result.windowsVersion = buildNumber >= 22000 ? '11' : '10'

      // Check if microphone access is allowed at the system level
      const { stdout: micAccessOutput } = await execAsync(
        `powershell -Command "Get-ItemProperty 'HKCU:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\CapabilityAccessManager\\ConsentStore\\microphone' -Name Value -ErrorAction SilentlyContinue | Select-Object -ExpandProperty Value"`,
        { timeout: 5000 }
      ).catch(() => ({ stdout: '' }))

      if (micAccessOutput.trim().toLowerCase() === 'deny') {
        result.microphoneAccessAllowed = false
        result.message = 'Microphone access is disabled in Windows Privacy Settings'
        result.remediation.push(
          `Open Settings > Privacy${result.windowsVersion === '11' ? ' & security' : ''} > Microphone`,
          'Turn on "Microphone access"'
        )
      }

      // Check if desktop apps can access microphone (Windows 10/11)
      const { stdout: desktopAccessOutput } = await execAsync(
        `powershell -Command "Get-ItemProperty 'HKCU:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\CapabilityAccessManager\\ConsentStore\\microphone' -Name Value -ErrorAction SilentlyContinue | Select-Object -ExpandProperty Value"`,
        { timeout: 5000 }
      ).catch(() => ({ stdout: '' }))

      // Also check the specific desktop apps setting
      const { stdout: nonPackagedOutput } = await execAsync(
        `powershell -Command "Get-ItemProperty 'HKCU:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\CapabilityAccessManager\\ConsentStore\\microphone\\NonPackaged' -Name Value -ErrorAction SilentlyContinue | Select-Object -ExpandProperty Value"`,
        { timeout: 5000 }
      ).catch(() => ({ stdout: '' }))

      if (nonPackagedOutput.trim().toLowerCase() === 'deny') {
        result.desktopAppsAllowed = false
        if (result.message === 'Microphone access is allowed') {
          result.message = 'Desktop apps are blocked from accessing microphone'
        }
        result.remediation.push(
          `Open Settings > Privacy${result.windowsVersion === '11' ? ' & security' : ''} > Microphone`,
          'Turn on "Let desktop apps access your microphone"'
        )
      }

      // Check overall status
      if (!result.microphoneAccessAllowed || !result.desktopAppsAllowed) {
        result.thisAppAllowed = false
      }

      if (result.microphoneAccessAllowed && result.desktopAppsAllowed) {
        result.message = 'Microphone access is properly configured'
      }

    } catch (error) {
      console.error('[WindowsAudio] Error checking permissions:', error)
      result.message = 'Unable to verify microphone permissions'
      result.remediation.push(
        'Manually check Settings > Privacy > Microphone',
        'Ensure "Microphone access" and "Let desktop apps access your microphone" are enabled'
      )
    }

    return result
  }

  // ==========================================================================
  // Exclusive Mode Detection
  // ==========================================================================

  /**
   * Check for exclusive mode conflicts
   */
  async checkExclusiveMode(): Promise<WindowsExclusiveModeStatus> {
    if (!this.isWindows()) {
      return {
        enabled: false,
        devicesInExclusiveMode: [],
        hasConflict: false,
        remediation: []
      }
    }

    const result: WindowsExclusiveModeStatus = {
      enabled: false,
      devicesInExclusiveMode: [],
      hasConflict: false,
      remediation: []
    }

    try {
      // Check processes that might be using exclusive mode
      const exclusiveApps = [
        'discord',
        'zoom',
        'teams',
        'skype',
        'obs64',
        'obs32',
        'audacity',
        'voicemeeter',
        'voicemeeterpro',
        'asio4all'
      ]

      const { stdout } = await execAsync(
        `powershell -Command "Get-Process | Where-Object { $_.Name -match '${exclusiveApps.join('|')}' } | Select-Object Name | ConvertTo-Json"`,
        { timeout: 10000 }
      ).catch(() => ({ stdout: '[]' }))

      const runningApps = JSON.parse(stdout || '[]')
      const appList = Array.isArray(runningApps) ? runningApps : [runningApps]

      for (const app of appList) {
        if (app?.Name) {
          result.devicesInExclusiveMode.push(app.Name)
        }
      }

      if (result.devicesInExclusiveMode.length > 0) {
        result.enabled = true
        result.hasConflict = true
        result.remediation.push(
          `The following apps may be using exclusive mode: ${result.devicesInExclusiveMode.join(', ')}`,
          'Close these applications or disable exclusive mode in their audio settings',
          'In Windows Sound settings, right-click your audio device > Properties > Advanced',
          'Uncheck "Allow applications to take exclusive control of this device"'
        )
      }

    } catch (error) {
      console.error('[WindowsAudio] Error checking exclusive mode:', error)
    }

    return result
  }

  // ==========================================================================
  // Sample Rate Detection
  // ==========================================================================

  /**
   * Get sample rate information for a device
   */
  async getSampleRateInfo(deviceId: string): Promise<WindowsSampleRateInfo | null> {
    if (!this.isWindows()) return null

    const devices = await this.enumerateDevices()
    const device = devices.find(d => d.id === deviceId || d.friendlyName === deviceId)

    if (!device) return null

    // Default sample rates - actual detection requires native Windows API
    const supportedRates = COMMON_SAMPLE_RATES

    // Try to detect current sample rate from registry
    try {
      const { stdout } = await execAsync(
        `powershell -Command "Get-ItemProperty 'HKCU:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\MMDevices\\Audio\\Render\\*\\Properties' -ErrorAction SilentlyContinue | Select-Object '{b3f8fa53-0004-438e-9003-51a46e139bfc},3' -First 1"`,
        { timeout: 5000 }
      ).catch(() => ({ stdout: '' }))

      // Parse sample rate from output (this is a simplified approach)
      // Real implementation would need more complex registry parsing
    } catch {
      // Fall back to defaults
    }

    return {
      deviceId: device.id,
      deviceName: device.friendlyName,
      defaultRate: 48000, // Most common Windows default
      supportedRates,
      recommendedRate: supportedRates.includes(REQUIRED_SAMPLE_RATE) ? REQUIRED_SAMPLE_RATE : 48000,
      supports16kHz: supportedRates.includes(16000)
    }
  }

  // ==========================================================================
  // Audio Driver Detection
  // ==========================================================================

  /**
   * Get audio driver information
   */
  async getDriverInfo(): Promise<WindowsAudioDriverInfo[]> {
    if (!this.isWindows()) return []

    const drivers: WindowsAudioDriverInfo[] = []

    try {
      const { stdout } = await execAsync(
        `powershell -Command "Get-WmiObject Win32_PnPSignedDriver | Where-Object { $_.DeviceClass -eq 'MEDIA' } | Select-Object DeviceName, DriverVersion, DriverDate, DriverProviderName, InfPath, IsSigned | ConvertTo-Json"`,
        { timeout: 15000 }
      )

      const rawDrivers = JSON.parse(stdout || '[]')
      const driverList = Array.isArray(rawDrivers) ? rawDrivers : [rawDrivers]

      for (const driver of driverList) {
        if (!driver?.DeviceName) continue

        drivers.push({
          name: driver.DeviceName,
          version: driver.DriverVersion || null,
          date: driver.DriverDate || null,
          provider: driver.DriverProviderName || null,
          filePath: driver.InfPath || null,
          isSigned: driver.IsSigned === 'True' || driver.IsSigned === true
        })
      }
    } catch (error) {
      console.error('[WindowsAudio] Error getting driver info:', error)
    }

    return drivers
  }

  // ==========================================================================
  // Recording Fallback Mechanism
  // ==========================================================================

  /**
   * Try multiple recording methods as fallbacks
   */
  async tryRecordingWithFallback(
    outputPath: string,
    deviceName: string,
    sampleRate: number = 16000
  ): Promise<WindowsRecordingFallbackResult> {
    if (!this.isWindows()) {
      return {
        success: false,
        recorder: null,
        process: null,
        error: 'Not running on Windows'
      }
    }

    const recorders: WindowsRecorderType[] = ['sox', 'ffmpeg', 'powershell']

    for (const recorder of recorders) {
      console.log(`[WindowsAudio] Attempting recording with ${recorder}...`)

      const result = await this.tryRecorder(recorder, outputPath, deviceName, sampleRate)

      if (result.success) {
        console.log(`[WindowsAudio] Successfully started recording with ${recorder}`)
        return result
      }

      console.warn(`[WindowsAudio] ${recorder} failed: ${result.error}`)
    }

    return {
      success: false,
      recorder: null,
      process: null,
      error: 'All recording methods failed. Please ensure sox or ffmpeg is installed, and microphone access is enabled.'
    }
  }

  /**
   * Try a specific recorder
   */
  private async tryRecorder(
    recorder: WindowsRecorderType,
    outputPath: string,
    deviceName: string,
    sampleRate: number
  ): Promise<WindowsRecordingFallbackResult> {
    try {
      switch (recorder) {
        case 'sox':
          return await this.trySoxRecording(outputPath, deviceName, sampleRate)

        case 'ffmpeg':
          return await this.tryFFmpegRecording(outputPath, deviceName, sampleRate)

        case 'powershell':
          return await this.tryPowerShellRecording(outputPath, deviceName, sampleRate)

        default:
          return { success: false, recorder: null, process: null, error: 'Unknown recorder' }
      }
    } catch (error) {
      return {
        success: false,
        recorder: null,
        process: null,
        error: `${recorder} error: ${error instanceof Error ? error.message : String(error)}`
      }
    }
  }

  /**
   * Try recording with Sox
   */
  private async trySoxRecording(
    outputPath: string,
    deviceName: string,
    sampleRate: number
  ): Promise<WindowsRecordingFallbackResult> {
    const soxPath = await binaryManager.getBinaryPath('sox')

    if (!soxPath) {
      return {
        success: false,
        recorder: null,
        process: null,
        error: 'Sox not found'
      }
    }

    // Sox on Windows uses -t waveaudio for WASAPI/MME devices
    const args = [
      '-t', 'waveaudio',
      deviceName === 'default' ? '-d' : deviceName,
      '-t', 'wav',
      '-r', sampleRate.toString(),
      '-c', '1',
      '-b', '16',
      outputPath
    ]

    const process = spawn(soxPath, args, {
      stdio: ['ignore', 'pipe', 'pipe']
    })

    // Wait briefly to see if process starts successfully
    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => resolve(), 1000)

      process.on('error', (err) => {
        clearTimeout(timeout)
        reject(err)
      })

      process.on('exit', (code) => {
        if (code !== null && code !== 0) {
          clearTimeout(timeout)
          reject(new Error(`Sox exited with code ${code}`))
        }
      })
    })

    return {
      success: true,
      recorder: 'sox',
      process
    }
  }

  /**
   * Try recording with FFmpeg
   */
  private async tryFFmpegRecording(
    outputPath: string,
    deviceName: string,
    sampleRate: number
  ): Promise<WindowsRecordingFallbackResult> {
    const ffmpegPath = await binaryManager.getBinaryPath('ffmpeg')

    if (!ffmpegPath) {
      return {
        success: false,
        recorder: null,
        process: null,
        error: 'FFmpeg not found'
      }
    }

    // FFmpeg uses DirectShow on Windows
    const args = [
      '-f', 'dshow',
      '-i', `audio=${deviceName === 'default' ? 'Microphone' : deviceName}`,
      '-ar', sampleRate.toString(),
      '-ac', '1',
      '-acodec', 'pcm_s16le',
      '-y',
      outputPath
    ]

    const process = spawn(ffmpegPath, args, {
      stdio: ['ignore', 'pipe', 'pipe']
    })

    // Wait briefly to see if process starts successfully
    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => resolve(), 1000)

      process.on('error', (err) => {
        clearTimeout(timeout)
        reject(err)
      })

      let stderrOutput = ''
      process.stderr?.on('data', (data) => {
        stderrOutput += data.toString()
        // FFmpeg outputs info to stderr, check for actual errors
        if (stderrOutput.includes('Error') || stderrOutput.includes('Could not')) {
          clearTimeout(timeout)
          reject(new Error(stderrOutput))
        }
      })
    })

    return {
      success: true,
      recorder: 'ffmpeg',
      process
    }
  }

  /**
   * Try recording with PowerShell (last resort fallback)
   */
  private async tryPowerShellRecording(
    outputPath: string,
    deviceName: string,
    sampleRate: number
  ): Promise<WindowsRecordingFallbackResult> {
    // PowerShell recording using Windows.Media.Capture
    // This is a basic fallback and may not support all sample rates
    const script = `
      Add-Type -AssemblyName System.Speech
      $recognizer = New-Object System.Speech.Recognition.SpeechRecognitionEngine
      $recognizer.SetInputToDefaultAudioDevice()
      # Note: This is a placeholder - actual implementation would need proper audio capture API
    `

    // This is a placeholder - real implementation would need NAudio or similar
    // For now, return failure to indicate PowerShell native recording isn't fully implemented
    return {
      success: false,
      recorder: null,
      process: null,
      error: 'PowerShell native recording not fully implemented - use sox or ffmpeg',
      warning: 'Please install sox or ffmpeg for audio recording'
    }
  }

  // ==========================================================================
  // Full Diagnostics
  // ==========================================================================

  /**
   * Run comprehensive Windows audio diagnostics
   */
  async runDiagnostics(): Promise<WindowsAudioDiagnostics> {
    if (!this.isWindows()) {
      throw new Error('Windows audio diagnostics can only run on Windows')
    }

    console.log('[WindowsAudio] Starting comprehensive diagnostics...')

    const timestamp = new Date().toISOString()
    const issues: WindowsAudioIssue[] = []
    const allRemediationSteps: string[] = []

    // Get Windows version
    const windowsVersion = await this.getWindowsVersion()

    // Enumerate devices
    const devices = await this.enumerateDevices(true)
    if (devices.length === 0) {
      issues.push({
        category: 'device',
        severity: 'critical',
        code: 'NO_AUDIO_DEVICES',
        message: 'No audio devices detected',
        remediation: [
          'Check that audio devices are properly connected',
          'Open Device Manager and check for audio device errors',
          'Update audio drivers'
        ]
      })
    }

    // Check for input devices
    const inputDevices = devices.filter(d => d.type === 'input' || d.type === 'virtual')
    if (inputDevices.length === 0) {
      issues.push({
        category: 'device',
        severity: 'critical',
        code: 'NO_INPUT_DEVICES',
        message: 'No input (microphone) devices detected',
        remediation: [
          'Connect a microphone or headset',
          'Check Windows Sound settings for disabled recording devices',
          'Install a virtual audio cable if recording system audio'
        ]
      })
    }

    // Get driver info
    const drivers = await this.getDriverInfo()
    const unsignedDrivers = drivers.filter(d => !d.isSigned)
    if (unsignedDrivers.length > 0) {
      issues.push({
        category: 'driver',
        severity: 'warning',
        code: 'UNSIGNED_DRIVERS',
        message: `Found ${unsignedDrivers.length} unsigned audio driver(s)`,
        details: unsignedDrivers.map(d => d.name).join(', '),
        remediation: [
          'Consider updating to signed drivers from the manufacturer',
          'Unsigned drivers may cause stability issues'
        ]
      })
    }

    // Check permissions
    const permissions = await this.checkMicrophonePermissions()
    if (!permissions.microphoneAccessAllowed || !permissions.desktopAppsAllowed) {
      issues.push({
        category: 'permission',
        severity: 'critical',
        code: 'MICROPHONE_PERMISSION_DENIED',
        message: permissions.message,
        remediation: permissions.remediation
      })
      allRemediationSteps.push(...permissions.remediation)
    }

    // Check exclusive mode
    const exclusiveMode = await this.checkExclusiveMode()
    if (exclusiveMode.hasConflict) {
      issues.push({
        category: 'exclusive_mode',
        severity: 'warning',
        code: 'EXCLUSIVE_MODE_CONFLICT',
        message: 'Potential audio device exclusive mode conflict detected',
        details: `Apps that may be using exclusive mode: ${exclusiveMode.devicesInExclusiveMode.join(', ')}`,
        remediation: exclusiveMode.remediation
      })
      allRemediationSteps.push(...exclusiveMode.remediation)
    }

    // Check virtual cables
    const virtualCables = await this.detectVirtualCables()
    if (virtualCables.length === 0) {
      issues.push({
        category: 'virtual_cable',
        severity: 'info',
        code: 'NO_VIRTUAL_CABLE',
        message: 'No virtual audio cable detected',
        remediation: [
          'Install VB-Audio Virtual Cable from https://vb-audio.com/Cable/ for system audio capture',
          'Or install Voicemeeter for advanced audio routing'
        ]
      })
    }

    for (const cable of virtualCables) {
      if (cable.issues.length > 0) {
        issues.push({
          category: 'virtual_cable',
          severity: 'warning',
          code: 'VIRTUAL_CABLE_ISSUE',
          message: `Virtual cable ${cable.type} has configuration issues`,
          details: cable.issues.join('; '),
          remediation: cable.issues
        })
      }
    }

    // Get sample rate info
    const sampleRates: WindowsSampleRateInfo[] = []
    for (const device of inputDevices.slice(0, 5)) { // Check first 5 input devices
      const srInfo = await this.getSampleRateInfo(device.id)
      if (srInfo) {
        sampleRates.push(srInfo)
        if (!srInfo.supports16kHz) {
          issues.push({
            category: 'sample_rate',
            severity: 'warning',
            code: 'UNSUPPORTED_SAMPLE_RATE',
            message: `Device "${device.friendlyName}" may not support 16kHz sample rate`,
            deviceId: device.id,
            remediation: [
              'The app will attempt to resample, but quality may be affected',
              'Consider using a different audio device'
            ]
          })
        }
      }
    }

    // Check available recorders
    const availableRecorders: WindowsAudioDiagnostics['availableRecorders'] = []

    const soxPath = await binaryManager.getBinaryPath('sox')
    const soxInfo = await binaryManager.resolveBinary('sox')
    availableRecorders.push({
      recorder: 'sox',
      available: !!soxPath,
      path: soxPath,
      version: soxInfo.version
    })

    const ffmpegPath = await binaryManager.getBinaryPath('ffmpeg')
    const ffmpegInfo = await binaryManager.resolveBinary('ffmpeg')
    availableRecorders.push({
      recorder: 'ffmpeg',
      available: !!ffmpegPath,
      path: ffmpegPath,
      version: ffmpegInfo.version
    })

    availableRecorders.push({
      recorder: 'powershell',
      available: true, // Always available on Windows
      path: 'powershell.exe',
      version: null
    })

    if (!soxPath && !ffmpegPath) {
      issues.push({
        category: 'recorder',
        severity: 'critical',
        code: 'NO_RECORDER_AVAILABLE',
        message: 'Neither sox nor ffmpeg is available for recording',
        remediation: [
          'Install sox from https://sox.sourceforge.net/',
          'Or install ffmpeg from https://ffmpeg.org/download.html',
          'Ensure the installed binary is in your system PATH'
        ]
      })
    }

    // Determine overall health
    const criticalIssues = issues.filter(i => i.severity === 'critical')
    const warningIssues = issues.filter(i => i.severity === 'warning')

    let overallHealth: 'healthy' | 'degraded' | 'failed' = 'healthy'
    if (criticalIssues.length > 0) {
      overallHealth = 'failed'
    } else if (warningIssues.length > 0) {
      overallHealth = 'degraded'
    }

    // Collect all remediation steps
    for (const issue of issues) {
      allRemediationSteps.push(...issue.remediation)
    }

    console.log(`[WindowsAudio] Diagnostics complete. Health: ${overallHealth}, Issues: ${issues.length}`)

    return {
      timestamp,
      windowsVersion,
      devices,
      drivers,
      permissions,
      exclusiveMode,
      sampleRates,
      virtualCables,
      availableRecorders,
      overallHealth,
      issues,
      allRemediationSteps: [...new Set(allRemediationSteps)] // Deduplicate
    }
  }

  /**
   * Get a summary of audio system status for quick display
   */
  async getQuickStatus(): Promise<{
    status: 'ok' | 'warning' | 'error'
    message: string
    canRecord: boolean
  }> {
    if (!this.isWindows()) {
      return { status: 'ok', message: 'Not on Windows', canRecord: true }
    }

    try {
      const devices = await this.enumerateDevices()
      const permissions = await this.checkMicrophonePermissions()
      const soxAvailable = !!(await binaryManager.getBinaryPath('sox'))
      const ffmpegAvailable = !!(await binaryManager.getBinaryPath('ffmpeg'))

      const hasInputDevice = devices.some(d => d.type === 'input' || d.type === 'virtual')
      const hasRecorder = soxAvailable || ffmpegAvailable
      const hasPermission = permissions.microphoneAccessAllowed && permissions.desktopAppsAllowed

      if (!hasInputDevice) {
        return {
          status: 'error',
          message: 'No microphone detected',
          canRecord: false
        }
      }

      if (!hasPermission) {
        return {
          status: 'error',
          message: 'Microphone access denied in Windows settings',
          canRecord: false
        }
      }

      if (!hasRecorder) {
        return {
          status: 'error',
          message: 'No audio recorder (sox/ffmpeg) available',
          canRecord: false
        }
      }

      return {
        status: 'ok',
        message: 'Audio system ready',
        canRecord: true
      }
    } catch (error) {
      return {
        status: 'warning',
        message: 'Unable to verify audio system status',
        canRecord: true // Assume true and let it fail at recording time
      }
    }
  }
}

// ============================================================================
// Export
// ============================================================================

export const windowsAudioCompatibilityService = new WindowsAudioCompatibilityService()
