/**
 * System Audio Capture Service
 *
 * Implements system audio capture via virtual audio cable for cross-platform support.
 * Records from both microphone and virtual cable simultaneously.
 * Handles per-platform differences:
 * - Windows: WASAPI via sox/ffmpeg
 * - macOS: Core Audio via sox with BlackHole, or ScreenCaptureKit (macOS 13+)
 * - Linux: ALSA/PulseAudio via arecord or parec
 *
 * On macOS 13+, prefers ScreenCaptureKit for native app audio capture without virtual cables.
 * Falls back to BlackHole method for older macOS versions.
 */

import { app } from 'electron'
import * as path from 'path'
import * as fs from 'fs'
import { spawn, ChildProcess, exec } from 'child_process'
import { promisify } from 'util'
import * as wav from 'wav'
import { settingsService } from './settingsService'
import { audioDeviceService } from './audioDeviceService'
import { screenCaptureKitService } from './screenCaptureKitService'
import type { ScreenCaptureKitCapabilities, CaptureableApp } from './screenCaptureKitService'
import { binaryManager } from './binaryManager'

const execAsync = promisify(exec)

// ============================================================================
// Types
// ============================================================================

export type DualRecordingStatus = 'idle' | 'recording' | 'paused' | 'stopping'

export type AudioSourceType = 'microphone' | 'system' | 'both'

export interface AudioSource {
  id: string
  name: string
  type: AudioSourceType
  deviceId: string | null
  isVirtual: boolean
}

export interface DualRecordingState {
  status: DualRecordingStatus
  meetingId: string | null
  startTime: number | null
  duration: number
  microphoneFilePath: string | null
  systemAudioFilePath: string | null
  mixedFilePath: string | null
  sourceType: AudioSourceType
}

export interface DualRecordingConfig {
  microphoneDevice?: string
  systemAudioDevice?: string
  sampleRate?: number
  channels?: number
  mixAudio?: boolean
}

export interface StartDualRecordingResult {
  success: boolean
  meetingId: string | null
  startTime: number
  microphoneFilePath: string | null
  systemAudioFilePath: string | null
  mixedFilePath: string | null
  sourceType: AudioSourceType
}

export interface StopDualRecordingResult {
  success: boolean
  meetingId: string | null
  duration: number
  microphoneFilePath: string | null
  systemAudioFilePath: string | null
  mixedFilePath: string | null
}

export interface SystemAudioCaptureCapabilities {
  platform: NodeJS.Platform
  supportsSystemAudio: boolean
  supportsDualRecording: boolean
  availableRecorders: string[]
  virtualCableDetected: boolean
  virtualCableType: string | null
  instructions: string
  // ScreenCaptureKit capabilities (macOS 13+)
  screenCaptureKit?: {
    available: boolean
    supportsAppAudioCapture: boolean
    permissionStatus: 'unknown' | 'denied' | 'granted' | 'not_determined'
    preferredMethod: 'screencapturekit' | 'virtual_cable'
  }
}

// ============================================================================
// State Management
// ============================================================================

let dualRecordingState: DualRecordingState = {
  status: 'idle',
  meetingId: null,
  startTime: null,
  duration: 0,
  microphoneFilePath: null,
  systemAudioFilePath: null,
  mixedFilePath: null,
  sourceType: 'microphone'
}

// Active recording processes
let microphoneProcess: ChildProcess | null = null
let systemAudioProcess: ChildProcess | null = null
let pausedDuration: number = 0

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Get the recordings directory path from settings or use default
 */
function getRecordingsDir(): string {
  // Try to get custom path from settings
  let recordingsDir = settingsService.get<string>('storage.recordingsPath')

  // If not set, use default path
  if (!recordingsDir) {
    const userDataPath = app.getPath('userData')
    recordingsDir = path.join(userDataPath, 'recordings')

    // Save default path to settings for future use
    try {
      settingsService.set('storage.recordingsPath', recordingsDir, 'storage')
    } catch (err) {
      console.warn('Failed to save default recordings path to settings:', err)
    }
  }

  // Ensure directory exists
  if (!fs.existsSync(recordingsDir)) {
    fs.mkdirSync(recordingsDir, { recursive: true })
  }

  return recordingsDir
}

/**
 * Generate a unique filename for the recording
 */
function generateRecordingFilename(meetingId: string | null, suffix: string): string {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-')
  const prefix = meetingId ? `meeting-${meetingId}` : 'recording'
  return `${prefix}-${timestamp}-${suffix}.wav`
}

/**
 * Get audio settings from database
 */
function getAudioSettings(): {
  sampleRate: number
  microphoneDevice: string
  systemAudioDevice: string
  dualSourceEnabled: boolean
} {
  const sampleRate = settingsService.getOrDefault<number>('audio.sampleRate', 16000)
  const microphoneDevice = settingsService.getOrDefault<string>('audio.inputDevice', 'default')
  const systemAudioDevice = settingsService.getOrDefault<string>('audio.virtualCableDevice', 'default')
  const dualSourceEnabled = settingsService.getOrDefault<boolean>('audio.dualSourceEnabled', false)

  return { sampleRate, microphoneDevice, systemAudioDevice, dualSourceEnabled }
}

/**
 * Check if a command exists on the system
 */
async function commandExists(command: string): Promise<boolean> {
  try {
    const checkCmd = process.platform === 'win32' ? `where ${command}` : `which ${command}`
    await execAsync(checkCmd, { timeout: 5000 })
    return true
  } catch {
    return false
  }
}

/**
 * Get available audio recorders for the current platform
 */
async function getAvailableRecorders(): Promise<string[]> {
  const recorders: string[] = []
  const platform = process.platform

  if (platform === 'win32') {
    // Windows: check for ffmpeg, sox
    if (await commandExists('ffmpeg')) recorders.push('ffmpeg')
    if (await commandExists('sox')) recorders.push('sox')
  } else if (platform === 'darwin') {
    // macOS: check for sox, ffmpeg
    if (await commandExists('sox')) recorders.push('sox')
    if (await commandExists('ffmpeg')) recorders.push('ffmpeg')
  } else if (platform === 'linux') {
    // Linux: check for arecord, parec, ffmpeg
    if (await commandExists('arecord')) recorders.push('arecord')
    if (await commandExists('parec')) recorders.push('parec')
    if (await commandExists('ffmpeg')) recorders.push('ffmpeg')
  }

  return recorders
}

// ============================================================================
// Platform-Specific Recording Functions
// ============================================================================

/**
 * Start microphone recording based on platform
 * Uses binaryManager to resolve sox/ffmpeg paths (bundled or system)
 */
async function startMicrophoneRecording(
  outputPath: string,
  sampleRate: number,
  deviceId?: string
): Promise<ChildProcess> {
  const platform = process.platform

  if (platform === 'darwin') {
    // macOS: Use sox with coreaudio
    const args = [
      '-d',                    // Default input device
      '-t', 'wav',            // Output format
      '-r', sampleRate.toString(),
      '-c', '1',              // Mono
      '-b', '16',             // 16-bit
      outputPath
    ]

    if (deviceId && deviceId !== 'default') {
      args.unshift('-d', deviceId)
    }

    // Get sox path from binaryManager (bundled or system)
    const soxPath = await binaryManager.getBinaryPath('sox')
    if (!soxPath) {
      throw new Error('sox is not installed. Please install it with: brew install sox')
    }

    const process = spawn(soxPath, args)

    // Handle spawn errors (e.g., command not found)
    process.on('error', (err: Error) => {
      console.error('sox spawn error:', err.message)
    })

    return process
  } else if (platform === 'linux') {
    // Linux: Use arecord (ALSA) or parec (PulseAudio)
    const args = [
      '-f', 'S16_LE',         // 16-bit signed little-endian
      '-r', sampleRate.toString(),
      '-c', '1',              // Mono
      '-t', 'wav',            // Output format
      outputPath
    ]

    if (deviceId && deviceId !== 'default') {
      args.unshift('-D', deviceId)
    }

    return spawn('arecord', args)
  } else if (platform === 'win32') {
    // Windows: Use ffmpeg with dshow or WASAPI
    const device = deviceId || 'Microphone'
    const args = [
      '-f', 'dshow',
      '-i', `audio=${device}`,
      '-ar', sampleRate.toString(),
      '-ac', '1',
      '-acodec', 'pcm_s16le',
      '-y',                   // Overwrite output
      outputPath
    ]

    // Get ffmpeg path from binaryManager (bundled or system)
    const ffmpegPath = await binaryManager.getBinaryPath('ffmpeg')
    if (!ffmpegPath) {
      throw new Error('ffmpeg is not installed. Please install ffmpeg for Windows.')
    }

    return spawn(ffmpegPath, args)
  }

  throw new Error(`Unsupported platform: ${platform}`)
}

/**
 * Check if a device name indicates it's a virtual audio cable device
 * that can be used for system audio capture.
 */
function isVirtualCableDevice(deviceName: string | null): boolean {
  if (!deviceName) return false
  const lower = deviceName.toLowerCase()
  return lower.includes("blackhole") ||
         lower.includes("soundflower") ||
         lower.includes("loopback") ||
         lower.includes("vb-audio") ||
         lower.includes("vb audio") ||
         lower.includes("virtual cable") ||
         lower.includes("voicemeeter") ||
         lower.includes("virtual sink") ||
         lower.includes("virtual_sink") ||
         lower.includes("null sink") ||
         (lower.includes("pulse") && lower.includes("monitor"))
}

/**
 * Check if a device name indicates it's a standard output device (speakers/headphones)
 * that CANNOT be used for recording system audio.
 */
function isOutputOnlyDevice(deviceName: string | null): boolean {
  if (!deviceName) return false
  const lower = deviceName.toLowerCase()

  // Common macOS output devices
  if (lower.includes("macbook") && lower.includes("speaker")) return true
  if (lower.includes("imac") && lower.includes("speaker")) return true
  if (lower.includes("mac mini") && lower.includes("speaker")) return true
  if (lower.includes("mac pro") && lower.includes("speaker")) return true
  if (lower.includes("built-in output")) return true
  if (lower.includes("internal speakers")) return true

  // Common Windows output devices
  if (lower.includes("realtek") && lower.includes("speaker")) return true
  if (lower.includes("nvidia") && lower.includes("output")) return true

  // HDMI/DisplayPort outputs (can't be used for input)
  if (lower.includes("hdmi") && !lower.includes("input")) return true
  if (lower.includes("displayport")) return true

  // The device type contains "output" but not "multi-output" (which is a valid aggregate)
  if (lower.includes("output") && !lower.includes("multi-output") && !lower.includes("cable output")) return true

  return false
}

/**
 * Validate that a device can be used for system audio capture.
 * Returns an error message if invalid, or null if valid.
 */
function validateSystemAudioDevice(deviceName: string | null): string | null {
  if (!deviceName || deviceName === 'default') {
    return null  // Let it try the default
  }

  if (isOutputOnlyDevice(deviceName)) {
    return `Cannot record from "${deviceName}" - this is an output-only device (speakers/headphones). ` +
      `To capture system audio, use a virtual cable like BlackHole (macOS), VB-Audio (Windows), or PulseAudio virtual sink (Linux).`
  }

  if (!isVirtualCableDevice(deviceName)) {
    // Not a recognized virtual cable - log a warning but don't block
    console.warn(`[System Audio] Device "${deviceName}" is not a recognized virtual cable. ` +
      `For best results, use BlackHole (macOS), VB-Audio Virtual Cable (Windows), or a PulseAudio virtual sink (Linux).`)
  }

  return null  // Allow the attempt
}

/**
 * Start system audio recording via virtual cable based on platform
 * Uses binaryManager to resolve sox/ffmpeg paths (bundled or system)
 */
async function startSystemAudioRecording(
  outputPath: string,
  sampleRate: number,
  virtualCableDevice?: string
): Promise<ChildProcess> {
  const platform = process.platform

  // Validate the device before attempting to record
  const validationError = validateSystemAudioDevice(virtualCableDevice || null)
  if (validationError) {
    console.error(`[System Audio] ${validationError}`)
    // We'll still attempt the recording but it will likely fail
  }

  if (platform === 'darwin') {
    // macOS: Use sox with BlackHole or similar virtual audio device
    const device = virtualCableDevice || 'BlackHole 2ch'
    const args = [
      '-t', 'coreaudio',
      device,
      '-t', 'wav',
      '-r', sampleRate.toString(),
      '-c', '2',              // Stereo for system audio
      '-b', '16',
      outputPath
    ]

    // Get sox path from binaryManager (bundled or system)
    const soxPath = await binaryManager.getBinaryPath('sox')
    if (!soxPath) {
      throw new Error('sox is not installed. Please install it with: brew install sox')
    }

    const process = spawn(soxPath, args)

    // Handle spawn errors (e.g., command not found)
    process.on('error', (err: Error) => {
      console.error('sox spawn error:', err.message)
    })

    return process
  } else if (platform === 'linux') {
    // Linux: Use parec with PulseAudio monitor or virtual sink
    // The monitor source captures all audio going to a sink
    const device = virtualCableDevice || 'virtual_sink.monitor'
    const args = [
      '--device', device,
      '--rate', sampleRate.toString(),
      '--channels', '2',
      '--format', 's16le',
      '--file-format', 'wav',
      outputPath
    ]

    return spawn('parec', args)
  } else if (platform === 'win32') {
    // Windows: Use ffmpeg with WASAPI loopback for system audio
    // VB-Audio Cable creates a virtual device we can record from
    const device = virtualCableDevice || 'CABLE Output (VB-Audio Virtual Cable)'
    const args = [
      '-f', 'dshow',
      '-i', `audio=${device}`,
      '-ar', sampleRate.toString(),
      '-ac', '2',
      '-acodec', 'pcm_s16le',
      '-y',
      outputPath
    ]

    // Get ffmpeg path from binaryManager (bundled or system)
    const ffmpegPath = await binaryManager.getBinaryPath('ffmpeg')
    if (!ffmpegPath) {
      throw new Error('ffmpeg is not installed. Please install ffmpeg for Windows.')
    }

    return spawn(ffmpegPath, args)
  }

  throw new Error(`Unsupported platform: ${platform}`)
}

/**
 * Mix two audio files into one
 * Uses binaryManager to resolve ffmpeg path (bundled or system)
 */
async function mixAudioFiles(
  micFile: string,
  systemFile: string,
  outputFile: string,
  sampleRate: number
): Promise<boolean> {
  try {
    // Get ffmpeg path from binaryManager (bundled or system)
    const ffmpegPath = await binaryManager.getBinaryPath('ffmpeg')
    if (!ffmpegPath) {
      console.error('ffmpeg is not installed. Cannot mix audio files.')
      return false
    }

    // Use ffmpeg to mix the two audio tracks
    const args = [
      '-i', micFile,
      '-i', systemFile,
      '-filter_complex',
      `[0:a][1:a]amix=inputs=2:duration=longest:dropout_transition=2,volume=2[a]`,
      '-map', '[a]',
      '-ar', sampleRate.toString(),
      '-ac', '1',
      '-acodec', 'pcm_s16le',
      '-y',
      outputFile
    ]

    await new Promise<void>((resolve, reject) => {
      const ffmpeg = spawn(ffmpegPath, args)

      ffmpeg.on('close', (code) => {
        if (code === 0) {
          resolve()
        } else {
          reject(new Error(`FFmpeg mixing failed with code ${code}`))
        }
      })

      ffmpeg.on('error', reject)
    })

    return true
  } catch (error) {
    console.error('Error mixing audio files:', error)
    return false
  }
}

// ============================================================================
// System Audio Capture Service
// ============================================================================

export const systemAudioCaptureService = {
  /**
   * Get system audio capture capabilities for current platform
   */
  async getCapabilities(): Promise<SystemAudioCaptureCapabilities> {
    const platform = process.platform
    const availableRecorders = await getAvailableRecorders()
    const virtualCables = await audioDeviceService.detectVirtualCables()
    const installedCable = virtualCables.find(c => c.detected)

    let supportsSystemAudio = false
    let supportsDualRecording = false
    let instructions = ''
    let screenCaptureKitInfo: SystemAudioCaptureCapabilities['screenCaptureKit'] | undefined

    switch (platform) {
      case 'win32':
        supportsSystemAudio = installedCable !== undefined && availableRecorders.includes('ffmpeg')
        supportsDualRecording = supportsSystemAudio && availableRecorders.length > 0
        instructions = supportsSystemAudio
          ? 'System audio capture is available via VB-Audio Virtual Cable.'
          : 'To enable system audio capture:\n1. Install VB-Audio Virtual Cable from https://vb-audio.com/Cable/\n2. Install FFmpeg and add to PATH\n3. Set your meeting app audio output to "CABLE Input"'
        break

      case 'darwin':
        // Check ScreenCaptureKit availability (macOS 13+)
        const sckCapabilities = await screenCaptureKitService.getCapabilities()

        if (sckCapabilities.available) {
          // ScreenCaptureKit is available - prefer native capture
          screenCaptureKitInfo = {
            available: true,
            supportsAppAudioCapture: sckCapabilities.supportsAppAudioCapture,
            permissionStatus: sckCapabilities.permissionStatus,
            preferredMethod: sckCapabilities.permissionStatus === 'denied' ? 'virtual_cable' : 'screencapturekit'
          }

          // With ScreenCaptureKit, we can capture without virtual cables
          if (sckCapabilities.permissionStatus !== 'denied') {
            supportsSystemAudio = true
            supportsDualRecording = true
            instructions = sckCapabilities.supportsAppAudioCapture
              ? 'Native app audio capture is available via ScreenCaptureKit (macOS 13+). No virtual cable required!'
              : 'System audio capture is available via ScreenCaptureKit. App-specific capture requires macOS 13.2+.'
          } else {
            // Permission denied - fall back to virtual cable
            supportsSystemAudio = installedCable !== undefined && availableRecorders.includes('sox')
            supportsDualRecording = supportsSystemAudio && availableRecorders.length > 0
            instructions = 'Screen Recording permission required for ScreenCaptureKit.\n' +
              'Enable in System Settings > Privacy & Security > Screen Recording,\n' +
              'or install BlackHole for virtual cable method.'
          }
        } else {
          // Older macOS - use virtual cable method
          supportsSystemAudio = installedCable !== undefined && availableRecorders.includes('sox')
          supportsDualRecording = supportsSystemAudio && availableRecorders.length > 0
          instructions = supportsSystemAudio
            ? 'System audio capture is available via BlackHole.'
            : `ScreenCaptureKit requires macOS 13.0+ (you have ${sckCapabilities.macOSVersion}).\n` +
              'To enable system audio capture:\n' +
              '1. Install BlackHole from https://existential.audio/blackhole/\n' +
              '2. Install sox: brew install sox\n' +
              '3. Create a Multi-Output Device in Audio MIDI Setup\n' +
              '4. Set the Multi-Output Device as your system output'

          screenCaptureKitInfo = {
            available: false,
            supportsAppAudioCapture: false,
            permissionStatus: 'unknown',
            preferredMethod: 'virtual_cable'
          }
        }
        break

      case 'linux':
        supportsSystemAudio = installedCable !== undefined &&
          (availableRecorders.includes('parec') || availableRecorders.includes('ffmpeg'))
        supportsDualRecording = supportsSystemAudio && availableRecorders.includes('arecord')
        instructions = supportsSystemAudio
          ? 'System audio capture is available via PulseAudio virtual sink.'
          : 'To enable system audio capture:\n1. Create a null sink: pactl load-module module-null-sink sink_name=virtual_sink\n2. Use pavucontrol to route app audio to virtual_sink\n3. Record from virtual_sink.monitor'
        break

      default:
        instructions = 'System audio capture is not supported on this platform.'
    }

    return {
      platform,
      supportsSystemAudio,
      supportsDualRecording,
      availableRecorders,
      virtualCableDetected: installedCable !== undefined,
      virtualCableType: installedCable?.type || null,
      instructions,
      screenCaptureKit: screenCaptureKitInfo
    }
  },

  /**
   * Start dual-source recording (microphone + system audio)
   */
  async startDualRecording(
    meetingId?: string,
    config?: DualRecordingConfig
  ): Promise<StartDualRecordingResult> {
    if (dualRecordingState.status === 'recording' || dualRecordingState.status === 'paused') {
      throw new Error('Recording is already in progress')
    }

    const settings = getAudioSettings()
    const sampleRate = config?.sampleRate || settings.sampleRate
    const micDevice = config?.microphoneDevice || settings.microphoneDevice
    const systemDevice = config?.systemAudioDevice || settings.systemAudioDevice
    const shouldMix = config?.mixAudio !== false

    const recordingsDir = getRecordingsDir()
    const micFilePath = path.join(recordingsDir, generateRecordingFilename(meetingId || null, 'mic'))
    const systemFilePath = path.join(recordingsDir, generateRecordingFilename(meetingId || null, 'system'))
    const mixedFilePath = shouldMix
      ? path.join(recordingsDir, generateRecordingFilename(meetingId || null, 'mixed'))
      : null

    const capabilities = await this.getCapabilities()

    // Determine what sources to record
    let sourceType: AudioSourceType = 'microphone'
    if (capabilities.supportsDualRecording) {
      sourceType = 'both'
    } else if (capabilities.supportsSystemAudio) {
      sourceType = 'system'
    }

    try {
      const startTime = Date.now()

      // Start microphone recording
      if (sourceType === 'microphone' || sourceType === 'both') {
        microphoneProcess = await startMicrophoneRecording(micFilePath, sampleRate, micDevice)

        microphoneProcess.on('error', (err) => {
          console.error('Microphone recording error:', err)
        })

        microphoneProcess.stderr?.on('data', (data) => {
          console.log('Microphone recorder:', data.toString())
        })
      }

      // Start system audio recording
      if (sourceType === 'system' || sourceType === 'both') {
        systemAudioProcess = await startSystemAudioRecording(systemFilePath, sampleRate, systemDevice)

        systemAudioProcess.on('error', (err) => {
          console.error('System audio recording error:', err)
        })

        systemAudioProcess.stderr?.on('data', (data) => {
          console.log('System audio recorder:', data.toString())
        })
      }

      // Update state
      dualRecordingState = {
        status: 'recording',
        meetingId: meetingId || null,
        startTime,
        duration: 0,
        microphoneFilePath: sourceType !== 'system' ? micFilePath : null,
        systemAudioFilePath: sourceType !== 'microphone' ? systemFilePath : null,
        mixedFilePath,
        sourceType
      }
      pausedDuration = 0

      return {
        success: true,
        meetingId: dualRecordingState.meetingId,
        startTime,
        microphoneFilePath: dualRecordingState.microphoneFilePath,
        systemAudioFilePath: dualRecordingState.systemAudioFilePath,
        mixedFilePath: dualRecordingState.mixedFilePath,
        sourceType
      }
    } catch (error) {
      // Cleanup on failure
      this.cleanup()
      throw new Error(`Failed to start dual recording: ${error instanceof Error ? error.message : String(error)}`)
    }
  },

  /**
   * Start system audio only recording
   */
  async startSystemAudioRecording(
    meetingId?: string,
    config?: DualRecordingConfig
  ): Promise<StartDualRecordingResult> {
    if (dualRecordingState.status === 'recording' || dualRecordingState.status === 'paused') {
      throw new Error('Recording is already in progress')
    }

    const capabilities = await this.getCapabilities()
    if (!capabilities.supportsSystemAudio) {
      throw new Error(`System audio capture not available: ${capabilities.instructions}`)
    }

    const settings = getAudioSettings()
    const sampleRate = config?.sampleRate || settings.sampleRate
    const systemDevice = config?.systemAudioDevice || settings.systemAudioDevice

    const recordingsDir = getRecordingsDir()
    const systemFilePath = path.join(recordingsDir, generateRecordingFilename(meetingId || null, 'system'))

    try {
      const startTime = Date.now()

      // Start system audio recording
      systemAudioProcess = await startSystemAudioRecording(systemFilePath, sampleRate, systemDevice)

      systemAudioProcess.on('error', (err) => {
        console.error('System audio recording error:', err)
      })

      // Update state
      dualRecordingState = {
        status: 'recording',
        meetingId: meetingId || null,
        startTime,
        duration: 0,
        microphoneFilePath: null,
        systemAudioFilePath: systemFilePath,
        mixedFilePath: null,
        sourceType: 'system'
      }
      pausedDuration = 0

      return {
        success: true,
        meetingId: dualRecordingState.meetingId,
        startTime,
        microphoneFilePath: null,
        systemAudioFilePath: systemFilePath,
        mixedFilePath: null,
        sourceType: 'system'
      }
    } catch (error) {
      this.cleanup()
      throw new Error(`Failed to start system audio recording: ${error instanceof Error ? error.message : String(error)}`)
    }
  },

  /**
   * Stop dual recording and optionally mix audio
   */
  async stopDualRecording(): Promise<StopDualRecordingResult> {
    if (dualRecordingState.status === 'idle') {
      throw new Error('No recording in progress')
    }

    const { meetingId, microphoneFilePath, systemAudioFilePath, mixedFilePath, startTime, sourceType } = dualRecordingState

    // Calculate final duration
    let finalDuration: number
    if (dualRecordingState.status === 'recording' && startTime) {
      finalDuration = Date.now() - startTime
    } else {
      finalDuration = pausedDuration
    }

    try {
      // Stop microphone process
      if (microphoneProcess) {
        microphoneProcess.kill('SIGTERM')
        await new Promise(resolve => setTimeout(resolve, 500))
        microphoneProcess = null
      }

      // Stop system audio process
      if (systemAudioProcess) {
        systemAudioProcess.kill('SIGTERM')
        await new Promise(resolve => setTimeout(resolve, 500))
        systemAudioProcess = null
      }

      // Mix audio files if both were recorded
      if (sourceType === 'both' && microphoneFilePath && systemAudioFilePath && mixedFilePath) {
        const settings = getAudioSettings()
        await mixAudioFiles(microphoneFilePath, systemAudioFilePath, mixedFilePath, settings.sampleRate)
      }

      // Reset state
      const result: StopDualRecordingResult = {
        success: true,
        meetingId,
        duration: finalDuration,
        microphoneFilePath,
        systemAudioFilePath,
        mixedFilePath: sourceType === 'both' ? mixedFilePath : null
      }

      dualRecordingState = {
        status: 'idle',
        meetingId: null,
        startTime: null,
        duration: 0,
        microphoneFilePath: null,
        systemAudioFilePath: null,
        mixedFilePath: null,
        sourceType: 'microphone'
      }
      pausedDuration = 0

      return result
    } catch (error) {
      this.cleanup()
      throw new Error(`Failed to stop dual recording: ${error instanceof Error ? error.message : String(error)}`)
    }
  },

  /**
   * Pause dual recording
   */
  async pauseDualRecording(): Promise<{ success: boolean; duration: number }> {
    if (dualRecordingState.status !== 'recording') {
      throw new Error('Recording is not in progress')
    }

    const currentDuration = dualRecordingState.startTime
      ? Date.now() - dualRecordingState.startTime
      : 0

    // Send SIGSTOP to pause processes (Unix-like systems)
    if (process.platform !== 'win32') {
      if (microphoneProcess) microphoneProcess.kill('SIGSTOP')
      if (systemAudioProcess) systemAudioProcess.kill('SIGSTOP')
    }

    pausedDuration = currentDuration
    dualRecordingState = {
      ...dualRecordingState,
      status: 'paused',
      duration: currentDuration
    }

    return {
      success: true,
      duration: currentDuration
    }
  },

  /**
   * Resume dual recording
   */
  async resumeDualRecording(): Promise<{ success: boolean; startTime: number }> {
    if (dualRecordingState.status !== 'paused') {
      throw new Error('Recording is not paused')
    }

    // Send SIGCONT to resume processes (Unix-like systems)
    if (process.platform !== 'win32') {
      if (microphoneProcess) microphoneProcess.kill('SIGCONT')
      if (systemAudioProcess) systemAudioProcess.kill('SIGCONT')
    }

    const newStartTime = Date.now() - pausedDuration
    dualRecordingState = {
      ...dualRecordingState,
      status: 'recording',
      startTime: newStartTime
    }

    return {
      success: true,
      startTime: newStartTime
    }
  },

  /**
   * Get current dual recording status
   */
  getStatus(): DualRecordingState {
    const duration = dualRecordingState.status === 'recording' && dualRecordingState.startTime
      ? Date.now() - dualRecordingState.startTime
      : dualRecordingState.duration

    return {
      ...dualRecordingState,
      duration
    }
  },

  /**
   * Get available audio sources for recording
   */
  async getAvailableSources(): Promise<AudioSource[]> {
    const sources: AudioSource[] = []
    const devices = await audioDeviceService.getAudioDevices()
    const virtualCables = await audioDeviceService.detectVirtualCables()

    // Add microphone sources
    for (const device of devices) {
      if (device.type === 'input') {
        sources.push({
          id: device.id,
          name: device.name,
          type: 'microphone',
          deviceId: device.id,
          isVirtual: false
        })
      }
    }

    // Add virtual cable sources for system audio
    for (const cable of virtualCables) {
      if (cable.detected) {
        sources.push({
          id: cable.deviceId || cable.type,
          name: `System Audio (${cable.name})`,
          type: 'system',
          deviceId: cable.deviceId,
          isVirtual: true
        })
      }
    }

    return sources
  },

  /**
   * Cleanup resources
   */
  cleanup(): void {
    if (microphoneProcess) {
      microphoneProcess.kill('SIGKILL')
      microphoneProcess = null
    }
    if (systemAudioProcess) {
      systemAudioProcess.kill('SIGKILL')
      systemAudioProcess = null
    }

    // Delete partial files
    if (dualRecordingState.microphoneFilePath && fs.existsSync(dualRecordingState.microphoneFilePath)) {
      try {
        fs.unlinkSync(dualRecordingState.microphoneFilePath)
      } catch { /* ignore */ }
    }
    if (dualRecordingState.systemAudioFilePath && fs.existsSync(dualRecordingState.systemAudioFilePath)) {
      try {
        fs.unlinkSync(dualRecordingState.systemAudioFilePath)
      } catch { /* ignore */ }
    }

    dualRecordingState = {
      status: 'idle',
      meetingId: null,
      startTime: null,
      duration: 0,
      microphoneFilePath: null,
      systemAudioFilePath: null,
      mixedFilePath: null,
      sourceType: 'microphone'
    }
    pausedDuration = 0
  },

  // ==========================================================================
  // ScreenCaptureKit Methods (macOS 13+)
  // ==========================================================================

  /**
   * Get ScreenCaptureKit capabilities
   */
  async getScreenCaptureKitCapabilities(): Promise<ScreenCaptureKitCapabilities> {
    return screenCaptureKitService.getCapabilities()
  },

  /**
   * Request screen recording permission for ScreenCaptureKit
   */
  async requestScreenRecordingPermission(): Promise<{ success: boolean; message: string }> {
    return screenCaptureKitService.requestPermission()
  },

  /**
   * Get list of running apps that can be captured
   */
  async getCapturableApps(): Promise<CaptureableApp[]> {
    return screenCaptureKitService.getCapturableApps()
  },

  /**
   * Get list of running meeting apps (Zoom, Teams, Meet, etc.)
   */
  async getRunningMeetingApps(): Promise<CaptureableApp[]> {
    return screenCaptureKitService.getRunningMeetingApps()
  },

  /**
   * Check if ScreenCaptureKit should be used for system audio capture
   */
  async shouldUseScreenCaptureKit(): Promise<{
    shouldUse: boolean
    reason: string
    capabilities: ScreenCaptureKitCapabilities
  }> {
    return screenCaptureKitService.shouldUseScreenCaptureKit()
  },

  /**
   * Start app audio capture using ScreenCaptureKit
   * Falls back to virtual cable method if ScreenCaptureKit is unavailable
   */
  async startAppAudioCapture(
    meetingId?: string,
    config?: {
      targetApps?: string[]
      sampleRate?: number
      channels?: number
    }
  ): Promise<{
    success: boolean
    method: 'screencapturekit' | 'blackhole' | 'virtual_cable'
    audioFilePath: string | null
    error?: string
    targetApps?: string[]
  }> {
    const sckCheck = await screenCaptureKitService.shouldUseScreenCaptureKit()

    if (sckCheck.shouldUse) {
      // Use ScreenCaptureKit for native capture
      console.log('[SystemAudioCapture] Using ScreenCaptureKit:', sckCheck.reason)
      return screenCaptureKitService.startCapture(meetingId, {
        targetApps: config?.targetApps,
        sampleRate: config?.sampleRate || 16000,
        channels: config?.channels || 2
      })
    } else {
      // Fall back to virtual cable method
      console.log('[SystemAudioCapture] Falling back to virtual cable:', sckCheck.reason)

      // Get system audio device from settings
      const settings = getAudioSettings()

      const recordingsDir = getRecordingsDir()
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-')
      const audioFilePath = path.join(recordingsDir, `recording-${timestamp}-system.wav`)

      try {
        systemAudioProcess = await startSystemAudioRecording(
          audioFilePath,
          config?.sampleRate || settings.sampleRate,
          settings.systemAudioDevice
        )

        systemAudioProcess.on('error', (err) => {
          console.error('[SystemAudioCapture] Virtual cable capture error:', err)
        })

        return {
          success: true,
          method: 'blackhole',
          audioFilePath,
          error: undefined
        }
      } catch (error) {
        return {
          success: false,
          method: 'blackhole',
          audioFilePath: null,
          error: `Failed to start virtual cable capture: ${error instanceof Error ? error.message : String(error)}`
        }
      }
    }
  },

  /**
   * Stop app audio capture (works for both ScreenCaptureKit and virtual cable)
   */
  async stopAppAudioCapture(): Promise<{
    success: boolean
    audioFilePath: string | null
    duration: number
    error?: string
  }> {
    const sckStatus = screenCaptureKitService.getStatus()

    if (sckStatus.isRecording) {
      // Stop ScreenCaptureKit capture
      return screenCaptureKitService.stopCapture()
    } else if (systemAudioProcess) {
      // Stop virtual cable capture
      const startTime = dualRecordingState.startTime
      const duration = startTime ? Date.now() - startTime : 0

      try {
        systemAudioProcess.kill('SIGTERM')
        await new Promise(resolve => setTimeout(resolve, 500))
        systemAudioProcess = null

        return {
          success: true,
          audioFilePath: dualRecordingState.systemAudioFilePath,
          duration
        }
      } catch (error) {
        return {
          success: false,
          audioFilePath: null,
          duration: 0,
          error: `Failed to stop capture: ${error instanceof Error ? error.message : String(error)}`
        }
      }
    }

    return {
      success: false,
      audioFilePath: null,
      duration: 0,
      error: 'No capture in progress'
    }
  },

  /**
   * Get app audio capture status
   */
  getAppAudioCaptureStatus(): {
    isCapturing: boolean
    method: 'screencapturekit' | 'virtual_cable' | null
    duration: number
    targetApps: string[]
  } {
    const sckStatus = screenCaptureKitService.getStatus()

    if (sckStatus.isRecording) {
      return {
        isCapturing: true,
        method: 'screencapturekit',
        duration: sckStatus.duration,
        targetApps: sckStatus.targetApps
      }
    } else if (dualRecordingState.status === 'recording' && dualRecordingState.sourceType === 'system') {
      return {
        isCapturing: true,
        method: 'virtual_cable',
        duration: dualRecordingState.startTime ? Date.now() - dualRecordingState.startTime : 0,
        targetApps: []
      }
    }

    return {
      isCapturing: false,
      method: null,
      duration: 0,
      targetApps: []
    }
  },

  /**
   * Get list of known meeting app bundle identifiers
   */
  getMeetingAppBundles(): string[] {
    return screenCaptureKitService.getMeetingAppBundles()
  }
}

/**
 * Reset dual recording state (for testing)
 */
export function resetDualRecordingState(): void {
  systemAudioCaptureService.cleanup()
}
