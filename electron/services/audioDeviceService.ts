/**
 * Audio Device Service
 *
 * Provides detection and enumeration of audio devices across platforms.
 * Specifically detects virtual audio cables:
 * - VB-Audio Virtual Cable (Windows)
 * - BlackHole (macOS)
 * - PulseAudio virtual sink (Linux)
 *
 * Also provides comprehensive diagnostics including:
 * - Virtual cable detection
 * - Microphone access verification
 * - Recording level testing
 * - Troubleshooting suggestions
 * - Auto-fix capabilities
 */

import { exec } from 'child_process'
import { promisify } from 'util'
import * as fs from 'fs'
import * as path from 'path'
import { app } from 'electron'
import { audioRecorderService } from './audioRecorderService'
import { settingsService } from './settingsService'

// Lazy import to avoid circular dependency
let windowsAudioService: typeof import('./windowsAudioCompatibilityService').windowsAudioCompatibilityService | null = null

async function getWindowsAudioService() {
  if (!windowsAudioService && process.platform === 'win32') {
    const module = await import('./windowsAudioCompatibilityService')
    windowsAudioService = module.windowsAudioCompatibilityService
  }
  return windowsAudioService
}

const execAsync = promisify(exec)

// ============================================================================
// Types
// ============================================================================

export type AudioDeviceType = 'input' | 'output' | 'virtual'
export type VirtualCableType = 'vb-audio' | 'blackhole' | 'pulseaudio-virtual' | 'unknown'
export type DiagnosticStatus = 'ok' | 'warning' | 'error' | 'not_checked'

export interface AudioDevice {
  id: string
  name: string
  type: AudioDeviceType
  isDefault: boolean
  isVirtual: boolean
  virtualCableType: VirtualCableType | null
}

export interface VirtualCableInfo {
  detected: boolean
  type: VirtualCableType
  name: string
  deviceId: string | null
  installationStatus: 'installed' | 'not_installed' | 'unknown'
}

export interface MicrophoneTestResult {
  accessible: boolean
  error?: string
  recordingLevel?: number  // 0.0 to 1.0, average RMS level during test
  peakLevel?: number       // 0.0 to 1.0, peak level during test
  isSilent?: boolean       // True if recording levels are too low
  testDuration?: number    // Duration of test recording in ms
}

export interface AutoFixResult {
  success: boolean
  action: string
  message: string
  error?: string
}

export interface AudioDiagnosticResult {
  timestamp: string
  platform: NodeJS.Platform
  overallStatus: DiagnosticStatus

  // Virtual cable detection
  virtualCables: VirtualCableInfo[]
  recommendedVirtualCable: VirtualCableType | null

  // Device status
  inputDevices: AudioDevice[]
  outputDevices: AudioDevice[]
  hasInputDevice: boolean
  hasOutputDevice: boolean

  // Microphone testing
  microphoneTest?: MicrophoneTestResult

  // Diagnostic messages
  messages: DiagnosticMessage[]
}

export interface DiagnosticMessage {
  level: 'info' | 'warning' | 'error' | 'success'
  code: string
  message: string
  suggestion?: string
}

// ============================================================================
// Device Recommendation Types
// ============================================================================

export type RecommendationConfidence = 'high' | 'medium' | 'low'

export interface DeviceRecommendation {
  deviceId: string
  deviceName: string
  deviceType: AudioDeviceType
  confidence: RecommendationConfidence
  confidenceScore: number // 0.0 to 1.0 for precise confidence
  reason: string
  isVirtualCable: boolean
  virtualCableType: VirtualCableType | null
  isPrimary: boolean // Whether this is the primary recommendation for its category
}

export interface AudioSetupRecommendation {
  // Primary recommendations (most common setup: system audio + microphone)
  inputDevice: DeviceRecommendation | null
  outputDevice: DeviceRecommendation | null
  systemAudioDevice: DeviceRecommendation | null // Virtual cable for capturing system audio

  // All detected virtual cables with their status
  detectedVirtualCables: Array<{
    device: AudioDevice
    cableType: VirtualCableType
    isRecommended: boolean
    installationStatus: 'installed' | 'not_installed' | 'unknown'
  }>

  // Configuration confidence
  overallConfidence: RecommendationConfidence
  overallConfidenceScore: number

  // Setup type description
  setupType: 'complete' | 'microphone_only' | 'system_audio_only' | 'minimal' | 'none'
  setupDescription: string

  // Recommendations for improvement
  suggestions: string[]

  // Platform-specific notes
  platformNotes: string | null
}

// ============================================================================
// Platform-specific Detection Functions
// ============================================================================

/**
 * Detect VB-Audio Virtual Cable on Windows
 */
async function detectVBAudioWindows(): Promise<VirtualCableInfo> {
  const info: VirtualCableInfo = {
    detected: false,
    type: 'vb-audio',
    name: 'VB-Audio Virtual Cable',
    deviceId: null,
    installationStatus: 'unknown'
  }

  try {
    // Use PowerShell to query audio devices
    const { stdout } = await execAsync(
      'powershell -Command "Get-WmiObject Win32_SoundDevice | Select-Object Name, DeviceID | ConvertTo-Json"',
      { timeout: 10000 }
    )

    const devices = JSON.parse(stdout || '[]')
    const deviceList = Array.isArray(devices) ? devices : [devices]

    for (const device of deviceList) {
      const name = device?.Name?.toLowerCase() || ''
      if (
        name.includes('vb-audio') ||
        name.includes('cable input') ||
        name.includes('cable output') ||
        name.includes('voicemeeter')
      ) {
        info.detected = true
        info.deviceId = device?.DeviceID || null
        info.installationStatus = 'installed'
        break
      }
    }

    if (!info.detected) {
      info.installationStatus = 'not_installed'
    }
  } catch (error) {
    console.error('Error detecting VB-Audio on Windows:', error)
    info.installationStatus = 'unknown'
  }

  return info
}

/**
 * Detect BlackHole on macOS
 */
async function detectBlackHoleMacOS(): Promise<VirtualCableInfo> {
  const info: VirtualCableInfo = {
    detected: false,
    type: 'blackhole',
    name: 'BlackHole',
    deviceId: null,
    installationStatus: 'unknown'
  }

  try {
    // Use system_profiler to get audio devices
    const { stdout } = await execAsync(
      'system_profiler SPAudioDataType -json',
      { timeout: 10000 }
    )

    const data = JSON.parse(stdout)
    const audioData = data?.SPAudioDataType || []

    for (const section of audioData) {
      const items = section?._items || []
      for (const item of items) {
        const name = item?._name?.toLowerCase() || ''
        if (name.includes('blackhole')) {
          info.detected = true
          info.deviceId = item?._name || null
          info.installationStatus = 'installed'
          break
        }
      }
      if (info.detected) break
    }

    // Also check for kext/plugin presence
    if (!info.detected) {
      try {
        const { stdout: kextCheck } = await execAsync(
          'ls /Library/Audio/Plug-Ins/HAL/ 2>/dev/null | grep -i blackhole',
          { timeout: 5000 }
        )
        if (kextCheck.trim()) {
          info.detected = true
          info.installationStatus = 'installed'
        } else {
          info.installationStatus = 'not_installed'
        }
      } catch {
        info.installationStatus = 'not_installed'
      }
    }
  } catch (error) {
    console.error('Error detecting BlackHole on macOS:', error)
    info.installationStatus = 'unknown'
  }

  return info
}

/**
 * Detect PulseAudio virtual sink on Linux
 */
async function detectPulseAudioVirtualSink(): Promise<VirtualCableInfo> {
  const info: VirtualCableInfo = {
    detected: false,
    type: 'pulseaudio-virtual',
    name: 'PulseAudio Virtual Sink',
    deviceId: null,
    installationStatus: 'unknown'
  }

  try {
    // Check if PulseAudio is running
    const { stdout: paCheck } = await execAsync(
      'pactl info 2>/dev/null | head -1',
      { timeout: 5000 }
    )

    if (!paCheck.trim()) {
      // Try PipeWire as fallback
      const { stdout: pwCheck } = await execAsync(
        'pw-cli info 2>/dev/null | head -1',
        { timeout: 5000 }
      )
      if (!pwCheck.trim()) {
        info.installationStatus = 'not_installed'
        return info
      }
    }

    // List sinks and look for virtual ones
    const { stdout: sinkList } = await execAsync(
      'pactl list short sinks 2>/dev/null',
      { timeout: 5000 }
    )

    const sinks = sinkList.split('\n').filter(line => line.trim())

    for (const sink of sinks) {
      const sinkName = sink.toLowerCase()
      if (
        sinkName.includes('virtual') ||
        sinkName.includes('null') ||
        sinkName.includes('monitor') ||
        sinkName.includes('loopback')
      ) {
        info.detected = true
        const parts = sink.split('\t')
        info.deviceId = parts[1] || parts[0] || null
        info.installationStatus = 'installed'
        break
      }
    }

    // Also check for module-null-sink or module-loopback
    if (!info.detected) {
      const { stdout: moduleList } = await execAsync(
        'pactl list short modules 2>/dev/null | grep -E "(null-sink|loopback)"',
        { timeout: 5000 }
      )
      if (moduleList.trim()) {
        info.detected = true
        info.installationStatus = 'installed'
        info.deviceId = 'module-based'
      } else {
        info.installationStatus = 'not_installed'
      }
    }
  } catch (error) {
    console.error('Error detecting PulseAudio virtual sink on Linux:', error)
    info.installationStatus = 'unknown'
  }

  return info
}

// ============================================================================
// Device Enumeration Functions
// ============================================================================

/**
 * Get audio devices on Windows using PowerShell
 */
async function getWindowsAudioDevices(): Promise<AudioDevice[]> {
  const devices: AudioDevice[] = []

  try {
    const { stdout } = await execAsync(
      'powershell -Command "Get-WmiObject Win32_SoundDevice | Select-Object Name, DeviceID, Status | ConvertTo-Json"',
      { timeout: 10000 }
    )

    const rawDevices = JSON.parse(stdout || '[]')
    const deviceList = Array.isArray(rawDevices) ? rawDevices : [rawDevices]

    for (const device of deviceList) {
      if (!device?.Name) continue

      const name = device.Name.toLowerCase()
      const isVirtual =
        name.includes('vb-audio') ||
        name.includes('cable') ||
        name.includes('voicemeeter') ||
        name.includes('virtual')

      devices.push({
        id: device.DeviceID || `device-${devices.length}`,
        name: device.Name,
        type: isVirtual ? 'virtual' : 'output', // Windows WMI doesn't clearly distinguish
        isDefault: false, // Would need additional queries
        isVirtual,
        virtualCableType: isVirtual ? 'vb-audio' : null
      })
    }
  } catch (error) {
    console.error('Error getting Windows audio devices:', error)
  }

  return devices
}

/**
 * Get audio devices on macOS
 */
async function getMacOSAudioDevices(): Promise<AudioDevice[]> {
  const devices: AudioDevice[] = []

  try {
    const { stdout } = await execAsync(
      'system_profiler SPAudioDataType -json',
      { timeout: 10000 }
    )

    const data = JSON.parse(stdout)
    const audioData = data?.SPAudioDataType || []

    for (const section of audioData) {
      const items = section?._items || []
      for (const item of items) {
        if (!item?._name) continue

        const name = item._name.toLowerCase()
        const isVirtual = name.includes('blackhole') || name.includes('soundflower') || name.includes('loopback')

        // Determine device type from properties
        let deviceType: AudioDeviceType = 'output'
        if (item?.coreaudio_input_source) {
          deviceType = 'input'
        }
        if (isVirtual) {
          deviceType = 'virtual'
        }

        devices.push({
          id: item._name,
          name: item._name,
          type: deviceType,
          isDefault: item?.coreaudio_default_audio_output_device === 'yes' ||
                     item?.coreaudio_default_audio_input_device === 'yes',
          isVirtual,
          virtualCableType: isVirtual ? 'blackhole' : null
        })
      }
    }
  } catch (error) {
    console.error('Error getting macOS audio devices:', error)
  }

  return devices
}

/**
 * Get audio devices on Linux using PulseAudio
 */
async function getLinuxAudioDevices(): Promise<AudioDevice[]> {
  const devices: AudioDevice[] = []

  try {
    // Get sinks (output devices)
    const { stdout: sinkOutput } = await execAsync(
      'pactl list sinks short 2>/dev/null',
      { timeout: 5000 }
    )

    for (const line of sinkOutput.split('\n').filter(l => l.trim())) {
      const parts = line.split('\t')
      const name = parts[1] || parts[0]
      const isVirtual =
        name.includes('virtual') ||
        name.includes('null') ||
        name.includes('loopback')

      devices.push({
        id: parts[0] || `sink-${devices.length}`,
        name: name,
        type: isVirtual ? 'virtual' : 'output',
        isDefault: false, // Would need additional parsing
        isVirtual,
        virtualCableType: isVirtual ? 'pulseaudio-virtual' : null
      })
    }

    // Get sources (input devices)
    const { stdout: sourceOutput } = await execAsync(
      'pactl list sources short 2>/dev/null',
      { timeout: 5000 }
    )

    for (const line of sourceOutput.split('\n').filter(l => l.trim())) {
      const parts = line.split('\t')
      const name = parts[1] || parts[0]

      // Skip monitor sources (they mirror sinks)
      if (name.includes('.monitor')) continue

      const isVirtual =
        name.includes('virtual') ||
        name.includes('null') ||
        name.includes('loopback')

      devices.push({
        id: parts[0] || `source-${devices.length}`,
        name: name,
        type: isVirtual ? 'virtual' : 'input',
        isDefault: false,
        isVirtual,
        virtualCableType: isVirtual ? 'pulseaudio-virtual' : null
      })
    }
  } catch (error) {
    console.error('Error getting Linux audio devices:', error)
  }

  return devices
}

// ============================================================================
// Main Service Functions
// ============================================================================

/**
 * Detect virtual audio cables based on current platform
 */
async function detectVirtualCables(): Promise<VirtualCableInfo[]> {
  const platform = process.platform
  const cables: VirtualCableInfo[] = []

  switch (platform) {
    case 'win32':
      cables.push(await detectVBAudioWindows())
      break
    case 'darwin':
      cables.push(await detectBlackHoleMacOS())
      break
    case 'linux':
      cables.push(await detectPulseAudioVirtualSink())
      break
    default:
      // Unsupported platform
      break
  }

  return cables
}

/**
 * Get all audio devices for current platform
 */
async function getAudioDevices(): Promise<AudioDevice[]> {
  const platform = process.platform

  switch (platform) {
    case 'win32':
      return getWindowsAudioDevices()
    case 'darwin':
      return getMacOSAudioDevices()
    case 'linux':
      return getLinuxAudioDevices()
    default:
      return []
  }
}

/**
 * Get recommended virtual cable type for current platform
 */
function getRecommendedVirtualCable(): VirtualCableType | null {
  const platform = process.platform

  switch (platform) {
    case 'win32':
      return 'vb-audio'
    case 'darwin':
      return 'blackhole'
    case 'linux':
      return 'pulseaudio-virtual'
    default:
      return null
  }
}

/**
 * Test microphone access and recording levels
 * Uses a unique diagnostic meeting ID to create a temporary test recording
 */
async function testMicrophoneAccess(): Promise<MicrophoneTestResult> {
  const result: MicrophoneTestResult = {
    accessible: false
  }

  // Generate a unique diagnostic test ID to avoid conflicts
  const diagnosticTestId = `diagnostic-test-${Date.now()}`

  try {
    // Check if we have any input devices first
    const devices = await getAudioDevices()
    const inputDevices = devices.filter(d => d.type === 'input')

    if (inputDevices.length === 0) {
      result.error = 'No input devices available'
      return result
    }

    // Try to start a test recording
    const testDuration = 1000 // 1 second test
    const startTime = Date.now()

    let audioFilePath: string | null = null

    try {
      await audioRecorderService.startRecording(diagnosticTestId)

      // Wait for test duration
      await new Promise(resolve => setTimeout(resolve, testDuration))

      const stopResult = await audioRecorderService.stopRecording()
      result.testDuration = Date.now() - startTime
      audioFilePath = stopResult.audioFilePath

      if (!stopResult.success || !audioFilePath) {
        result.error = 'Failed to complete test recording'
        return result
      }

      // Wait a moment to ensure file is fully written to disk
      await new Promise(resolve => setTimeout(resolve, 100))

      // Verify file exists before analyzing
      if (!fs.existsSync(audioFilePath)) {
        result.error = 'Test recording file was not created'
        return result
      }

      // Analyze the recorded file for audio levels
      const audioLevels = await analyzeAudioLevels(audioFilePath)
      result.accessible = true
      result.recordingLevel = audioLevels.averageLevel
      result.peakLevel = audioLevels.peakLevel
      result.isSilent = audioLevels.averageLevel < 0.01 // Very low threshold
    } catch (recordingError) {
      result.error = recordingError instanceof Error
        ? recordingError.message
        : 'Failed to access microphone'

      // Ensure we stop any partial recording
      try {
        const status = audioRecorderService.getStatus()
        if (status.status !== 'idle') {
          await audioRecorderService.stopRecording()
        }
      } catch {
        // Ignore cleanup errors
      }
    } finally {
      // Clean up test file and directory
      if (audioFilePath && fs.existsSync(audioFilePath)) {
        try {
          fs.unlinkSync(audioFilePath)

          // Also try to clean up the diagnostic test directory if empty
          const testDir = path.dirname(audioFilePath)
          if (testDir && fs.existsSync(testDir)) {
            const filesInDir = fs.readdirSync(testDir)
            if (filesInDir.length === 0) {
              fs.rmdirSync(testDir)
            }
          }
        } catch (cleanupError) {
          // Ignore cleanup errors - not critical
          console.warn('Failed to clean up diagnostic test files:', cleanupError)
        }
      }
    }
  } catch (error) {
    result.error = error instanceof Error ? error.message : 'Unknown error'
  }

  return result
}

/**
 * Analyze audio file to determine recording levels
 * Returns average and peak RMS levels (0.0 to 1.0)
 */
async function analyzeAudioLevels(filePath: string): Promise<{ averageLevel: number; peakLevel: number }> {
  try {
    // Check if file exists before reading
    if (!fs.existsSync(filePath)) {
      console.error('Error analyzing audio levels: file not found:', filePath)
      return { averageLevel: 0, peakLevel: 0 }
    }

    // Read WAV file and analyze samples
    const buffer = fs.readFileSync(filePath)

    // WAV file structure:
    // Header (44 bytes typically) + PCM data
    // For 16-bit PCM: each sample is 2 bytes
    const headerSize = 44
    if (buffer.length < headerSize) {
      return { averageLevel: 0, peakLevel: 0 }
    }

    const pcmData = buffer.slice(headerSize)

    // Calculate levels iteratively to avoid stack overflow with large arrays
    // (Math.max(...samples) can overflow the call stack with large arrays)
    let sumSquares = 0
    let peakLevel = 0
    let sampleCount = 0

    // Read 16-bit signed integers (little-endian)
    for (let i = 0; i < pcmData.length - 1; i += 2) {
      const sample = pcmData.readInt16LE(i)
      // Normalize to 0.0 to 1.0 (absolute value)
      const normalizedSample = Math.abs(sample) / 32768.0
      sumSquares += normalizedSample * normalizedSample
      if (normalizedSample > peakLevel) {
        peakLevel = normalizedSample
      }
      sampleCount++
    }

    if (sampleCount === 0) {
      return { averageLevel: 0, peakLevel: 0 }
    }

    // Calculate RMS (Root Mean Square) for average level
    const averageLevel = Math.sqrt(sumSquares / sampleCount)

    return { averageLevel, peakLevel }
  } catch (error) {
    console.error('Error analyzing audio levels:', error)
    return { averageLevel: 0, peakLevel: 0 }
  }
}

/**
 * Generate diagnostic messages based on detection results
 */
function generateDiagnosticMessages(
  virtualCables: VirtualCableInfo[],
  inputDevices: AudioDevice[],
  outputDevices: AudioDevice[],
  microphoneTest?: MicrophoneTestResult
): DiagnosticMessage[] {
  const messages: DiagnosticMessage[] = []
  const platform = process.platform

  // Check for virtual cable
  const installedCable = virtualCables.find(c => c.detected)

  if (installedCable) {
    messages.push({
      level: 'success',
      code: 'VIRTUAL_CABLE_DETECTED',
      message: `Virtual audio cable detected: ${installedCable.name}`,
      suggestion: 'You can use this to capture system audio from meetings.'
    })
  } else {
    // Provide platform-specific installation suggestions
    let suggestion = ''
    switch (platform) {
      case 'win32':
        suggestion = 'Install VB-Audio Virtual Cable from https://vb-audio.com/Cable/ to capture system audio.'
        break
      case 'darwin':
        suggestion = 'Install BlackHole from https://existential.audio/blackhole/ to capture system audio.'
        break
      case 'linux':
        suggestion = 'Create a PulseAudio virtual sink using: pactl load-module module-null-sink sink_name=virtual_sink'
        break
    }

    messages.push({
      level: 'warning',
      code: 'NO_VIRTUAL_CABLE',
      message: 'No virtual audio cable detected.',
      suggestion
    })
  }

  // Check for input devices
  if (inputDevices.length === 0) {
    messages.push({
      level: 'error',
      code: 'NO_INPUT_DEVICE',
      message: 'No audio input devices found.',
      suggestion: 'Please connect a microphone or enable an audio input device.'
    })
  } else {
    messages.push({
      level: 'info',
      code: 'INPUT_DEVICES_FOUND',
      message: `Found ${inputDevices.length} audio input device(s).`
    })
  }

  // Check microphone access and levels
  if (microphoneTest) {
    if (!microphoneTest.accessible) {
      messages.push({
        level: 'error',
        code: 'MICROPHONE_ACCESS_DENIED',
        message: 'Cannot access microphone for recording.',
        suggestion: microphoneTest.error || 'Check microphone permissions in system settings and ensure no other application is using the microphone.'
      })
    } else if (microphoneTest.isSilent) {
      messages.push({
        level: 'warning',
        code: 'MICROPHONE_LOW_LEVEL',
        message: 'Microphone is accessible but recording levels are very low.',
        suggestion: 'Check microphone volume settings, ensure microphone is not muted, and speak closer to the microphone. The average recording level was ' + 
          (microphoneTest.recordingLevel! * 100).toFixed(1) + '%.'
      })
    } else {
      const levelPercent = (microphoneTest.recordingLevel! * 100).toFixed(1)
      messages.push({
        level: 'success',
        code: 'MICROPHONE_WORKING',
        message: `Microphone is working correctly. Recording level: ${levelPercent}%`,
        suggestion: 'Your microphone is ready for meeting recordings.'
      })
    }
  }

  // Check for output devices
  if (outputDevices.length === 0) {
    messages.push({
      level: 'warning',
      code: 'NO_OUTPUT_DEVICE',
      message: 'No audio output devices found.',
      suggestion: 'Please connect speakers or enable an audio output device.'
    })
  } else {
    messages.push({
      level: 'info',
      code: 'OUTPUT_DEVICES_FOUND',
      message: `Found ${outputDevices.length} audio output device(s).`
    })
  }

  return messages
}

/**
 * Determine overall diagnostic status
 */
function determineOverallStatus(
  virtualCables: VirtualCableInfo[],
  hasInput: boolean,
  hasOutput: boolean,
  microphoneTest?: MicrophoneTestResult
): DiagnosticStatus {
  const hasVirtualCable = virtualCables.some(c => c.detected)

  // Critical errors
  if (!hasInput) {
    return 'error'
  }
  if (microphoneTest && !microphoneTest.accessible) {
    return 'error'
  }

  // Warnings
  if (microphoneTest && microphoneTest.isSilent) {
    return 'warning'
  }
  if (!hasVirtualCable || !hasOutput) {
    return 'warning'
  }

  return 'ok'
}

// ============================================================================
// Smart Device Recommendation Functions
// ============================================================================

/**
 * Known microphone device name patterns that indicate quality input devices
 */
const PREFERRED_MICROPHONE_PATTERNS = [
  /blue\s*yeti/i,
  /rode/i,
  /shure/i,
  /audio-technica/i,
  /at2020/i,
  /at2035/i,
  /elgato\s*wave/i,
  /hyperx\s*(quadcast|solocast)/i,
  /razer\s*seiren/i,
  /fifine/i,
  /samson/i,
  /focusrite/i,
  /scarlett/i,
  /usb\s*microphone/i,
  /condenser/i,
  /podcast/i,
  /streaming/i
]

/**
 * Known virtual cable/loopback device patterns by platform
 */
const VIRTUAL_CABLE_PATTERNS: Record<NodeJS.Platform, RegExp[]> = {
  darwin: [
    /blackhole/i,
    /soundflower/i,
    /loopback/i,
    /existential/i
  ],
  win32: [
    /vb-?audio/i,
    /cable\s*(input|output)/i,
    /voicemeeter/i,
    /virtual\s*audio/i,
    /vac/i,
    /hi-fi\s*cable/i
  ],
  linux: [
    /virtual/i,
    /null/i,
    /loopback/i,
    /monitor/i,
    /pulse.*sink/i
  ],
  aix: [],
  android: [],
  freebsd: [],
  haiku: [],
  openbsd: [],
  sunos: [],
  cygwin: [],
  netbsd: []
}

/**
 * Known built-in/integrated microphone patterns (lower priority)
 */
const BUILTIN_MIC_PATTERNS = [
  /built-?in/i,
  /internal/i,
  /integrated/i,
  /macbook/i,
  /laptop/i,
  /webcam/i,
  /facetime/i,
  /realtek/i
]

/**
 * Calculate confidence score for a microphone device
 */
function calculateMicrophoneConfidence(device: AudioDevice): { score: number; reason: string } {
  let score = 0.5 // Base score
  let reasons: string[] = []

  // Check for preferred microphone patterns (high quality mics)
  const isPreferredMic = PREFERRED_MICROPHONE_PATTERNS.some(pattern => pattern.test(device.name))
  if (isPreferredMic) {
    score += 0.3
    reasons.push('recognized quality microphone')
  }

  // Check for built-in mic patterns (lower quality, lower score)
  const isBuiltIn = BUILTIN_MIC_PATTERNS.some(pattern => pattern.test(device.name))
  if (isBuiltIn) {
    score -= 0.2
    reasons.push('built-in microphone')
  }

  // Prefer USB devices (usually external mics)
  if (/usb/i.test(device.name)) {
    score += 0.1
    reasons.push('USB connected')
  }

  // System default gets a small boost
  if (device.isDefault) {
    score += 0.1
    reasons.push('system default')
  }

  // Clamp score between 0 and 1
  score = Math.max(0, Math.min(1, score))

  const reason = reasons.length > 0
    ? reasons.join(', ')
    : 'standard input device'

  return { score, reason }
}

/**
 * Calculate confidence score for a virtual cable device
 */
function calculateVirtualCableConfidence(device: AudioDevice, platform: NodeJS.Platform): { score: number; reason: string } {
  let score = 0.7 // Base score for any detected virtual cable
  let reasons: string[] = ['virtual audio cable detected']

  const patterns = VIRTUAL_CABLE_PATTERNS[platform] || []

  // Check for platform-recommended virtual cables
  if (platform === 'darwin' && /blackhole/i.test(device.name)) {
    score = 0.95
    reasons = ['BlackHole is the recommended virtual cable for macOS']
  } else if (platform === 'win32' && /vb-?audio|cable\s*(input|output)/i.test(device.name)) {
    score = 0.95
    reasons = ['VB-Audio Virtual Cable is the recommended solution for Windows']
  } else if (platform === 'win32' && /voicemeeter/i.test(device.name)) {
    score = 0.85
    reasons = ['VoiceMeeter detected (professional audio routing)']
  } else if (platform === 'linux' && /loopback/i.test(device.name)) {
    score = 0.85
    reasons = ['PulseAudio loopback device detected']
  }

  return { score, reason: reasons.join(', ') }
}

/**
 * Calculate confidence score for an output device
 */
function calculateOutputConfidence(device: AudioDevice): { score: number; reason: string } {
  let score = 0.5 // Base score
  let reasons: string[] = []

  // System default is usually the right choice
  if (device.isDefault) {
    score = 0.9
    reasons.push('system default output')
  }

  // Check for known speaker brands
  if (/speakers?|headphones?|airpods?|bose|sony|jbl|logitech/i.test(device.name)) {
    score += 0.1
    reasons.push('recognized audio device')
  }

  // Virtual cables shouldn't be primary output for playback
  if (device.isVirtual) {
    score -= 0.3
    reasons.push('virtual device (not for direct playback)')
  }

  score = Math.max(0, Math.min(1, score))

  return {
    score,
    reason: reasons.length > 0 ? reasons.join(', ') : 'standard output device'
  }
}

/**
 * Convert numeric confidence score to confidence level
 */
function scoreToConfidenceLevel(score: number): RecommendationConfidence {
  if (score >= 0.8) return 'high'
  if (score >= 0.5) return 'medium'
  return 'low'
}

/**
 * Generate smart device recommendations based on detected hardware
 */
async function generateDeviceRecommendations(): Promise<AudioSetupRecommendation> {
  const platform = process.platform
  const [allDevices, virtualCables] = await Promise.all([
    getAudioDevices(),
    detectVirtualCables()
  ])

  // Separate devices by type
  const inputDevices = allDevices.filter(d => d.type === 'input')
  const outputDevices = allDevices.filter(d => d.type === 'output')
  const virtualDevices = allDevices.filter(d => d.isVirtual || d.type === 'virtual')

  // Find best microphone
  let bestMicrophone: DeviceRecommendation | null = null
  let bestMicScore = 0

  for (const device of inputDevices) {
    // Skip virtual devices for microphone selection
    if (device.isVirtual) continue

    const { score, reason } = calculateMicrophoneConfidence(device)
    if (score > bestMicScore) {
      bestMicScore = score
      bestMicrophone = {
        deviceId: device.id,
        deviceName: device.name,
        deviceType: 'input',
        confidence: scoreToConfidenceLevel(score),
        confidenceScore: score,
        reason,
        isVirtualCable: false,
        virtualCableType: null,
        isPrimary: true
      }
    }
  }

  // Find best virtual cable for system audio capture
  let bestVirtualCable: DeviceRecommendation | null = null
  let bestVirtualScore = 0
  const detectedVirtualCables: AudioSetupRecommendation['detectedVirtualCables'] = []

  for (const device of virtualDevices) {
    const { score, reason } = calculateVirtualCableConfidence(device, platform)

    // Determine cable type
    let cableType: VirtualCableType = 'unknown'
    if (platform === 'darwin' && /blackhole/i.test(device.name)) {
      cableType = 'blackhole'
    } else if (platform === 'win32' && /vb-?audio|cable/i.test(device.name)) {
      cableType = 'vb-audio'
    } else if (platform === 'linux') {
      cableType = 'pulseaudio-virtual'
    }

    const isRecommended = score > bestVirtualScore

    detectedVirtualCables.push({
      device,
      cableType,
      isRecommended,
      installationStatus: 'installed'
    })

    if (score > bestVirtualScore) {
      bestVirtualScore = score
      bestVirtualCable = {
        deviceId: device.id,
        deviceName: device.name,
        deviceType: 'virtual',
        confidence: scoreToConfidenceLevel(score),
        confidenceScore: score,
        reason,
        isVirtualCable: true,
        virtualCableType: cableType,
        isPrimary: true
      }
    }
  }

  // Also check virtual cables from the dedicated detection
  for (const cable of virtualCables) {
    if (cable.detected && cable.deviceId) {
      const existingDevice = detectedVirtualCables.find(d => d.device.id === cable.deviceId)
      if (!existingDevice) {
        // Create a device entry for this cable
        const virtualDevice: AudioDevice = {
          id: cable.deviceId,
          name: cable.name,
          type: 'virtual',
          isDefault: false,
          isVirtual: true,
          virtualCableType: cable.type
        }

        detectedVirtualCables.push({
          device: virtualDevice,
          cableType: cable.type,
          isRecommended: bestVirtualCable === null,
          installationStatus: cable.installationStatus
        })

        if (bestVirtualCable === null) {
          bestVirtualCable = {
            deviceId: cable.deviceId,
            deviceName: cable.name,
            deviceType: 'virtual',
            confidence: 'high',
            confidenceScore: 0.9,
            reason: `${cable.name} detected and ready for system audio capture`,
            isVirtualCable: true,
            virtualCableType: cable.type,
            isPrimary: true
          }
          bestVirtualScore = 0.9
        }
      }
    }
  }

  // Find best output device
  let bestOutput: DeviceRecommendation | null = null
  let bestOutputScore = 0

  for (const device of outputDevices) {
    // Skip virtual devices for primary output
    if (device.isVirtual) continue

    const { score, reason } = calculateOutputConfidence(device)
    if (score > bestOutputScore) {
      bestOutputScore = score
      bestOutput = {
        deviceId: device.id,
        deviceName: device.name,
        deviceType: 'output',
        confidence: scoreToConfidenceLevel(score),
        confidenceScore: score,
        reason,
        isVirtualCable: false,
        virtualCableType: null,
        isPrimary: true
      }
    }
  }

  // Calculate overall confidence and setup type
  const scores = [bestMicScore, bestVirtualScore, bestOutputScore].filter(s => s > 0)
  const overallScore = scores.length > 0
    ? scores.reduce((a, b) => a + b, 0) / scores.length
    : 0

  // Determine setup type
  let setupType: AudioSetupRecommendation['setupType']
  let setupDescription: string

  if (bestMicrophone && bestVirtualCable) {
    setupType = 'complete'
    setupDescription = 'Complete setup detected: Microphone for voice capture and virtual cable for system audio.'
  } else if (bestMicrophone && !bestVirtualCable) {
    setupType = 'microphone_only'
    setupDescription = 'Microphone detected but no virtual cable found. You can record your voice but not system audio.'
  } else if (!bestMicrophone && bestVirtualCable) {
    setupType = 'system_audio_only'
    setupDescription = 'Virtual cable detected but no microphone found. You can capture system audio but not your voice.'
  } else if (bestOutput) {
    setupType = 'minimal'
    setupDescription = 'Only output devices detected. Please connect a microphone to record.'
  } else {
    setupType = 'none'
    setupDescription = 'No suitable audio devices detected. Please connect audio devices.'
  }

  // Generate improvement suggestions
  const suggestions: string[] = []

  if (!bestVirtualCable) {
    const recommendedCable = getRecommendedVirtualCable()
    switch (recommendedCable) {
      case 'blackhole':
        suggestions.push('Install BlackHole to capture system audio from meeting apps.')
        break
      case 'vb-audio':
        suggestions.push('Install VB-Audio Virtual Cable to capture system audio from meeting apps.')
        break
      case 'pulseaudio-virtual':
        suggestions.push('Create a PulseAudio virtual sink to capture system audio.')
        break
    }
  }

  if (!bestMicrophone) {
    suggestions.push('Connect a microphone to record your voice during meetings.')
  } else if (bestMicScore < 0.6) {
    suggestions.push('Consider using an external microphone for better audio quality.')
  }

  if (bestVirtualCable && bestVirtualScore < 0.8) {
    suggestions.push('Ensure your virtual audio cable is properly configured in your system audio settings.')
  }

  // Platform-specific notes
  let platformNotes: string | null = null
  switch (platform) {
    case 'darwin':
      if (bestVirtualCable) {
        platformNotes = 'Tip: Create a Multi-Output Device in Audio MIDI Setup to hear audio while recording system sound.'
      }
      break
    case 'win32':
      if (bestVirtualCable) {
        platformNotes = 'Tip: Set your meeting app to output to the virtual cable, then select it as input in FlowRecap.'
      }
      break
    case 'linux':
      platformNotes = 'Tip: Use pavucontrol to route audio between applications and virtual sinks.'
      break
  }

  // Mark the recommended virtual cable
  for (const vc of detectedVirtualCables) {
    vc.isRecommended = bestVirtualCable?.deviceId === vc.device.id
  }

  return {
    inputDevice: bestMicrophone,
    outputDevice: bestOutput,
    systemAudioDevice: bestVirtualCable,
    detectedVirtualCables,
    overallConfidence: scoreToConfidenceLevel(overallScore),
    overallConfidenceScore: overallScore,
    setupType,
    setupDescription,
    suggestions,
    platformNotes
  }
}

// ============================================================================
// Audio Device Service Export
// ============================================================================

export const audioDeviceService = {
  /**
   * Detect virtual audio cables on the current platform
   */
  detectVirtualCables,

  /**
   * Get all audio devices
   */
  getAudioDevices,

  /**
   * Get recommended virtual cable for current platform
   */
  getRecommendedVirtualCable,

  /**
   * Generate smart device recommendations based on detected hardware
   * This analyzes all available devices and recommends the best configuration
   * for recording meetings (microphone + system audio via virtual cable)
   */
  generateDeviceRecommendations,

  /**
   * Run full audio diagnostics
   */
  async runDiagnostics(): Promise<AudioDiagnosticResult> {
    const platform = process.platform
    const timestamp = new Date().toISOString()

    // Run detection in parallel for better performance
    const [virtualCables, allDevices] = await Promise.all([
      detectVirtualCables(),
      getAudioDevices()
    ])

    // Separate devices by type
    const inputDevices = allDevices.filter(d => d.type === 'input' || d.type === 'virtual')
    const outputDevices = allDevices.filter(d => d.type === 'output' || d.type === 'virtual')

    const hasInputDevice = inputDevices.length > 0 || allDevices.some(d => d.isVirtual)
    const hasOutputDevice = outputDevices.length > 0 || allDevices.some(d => d.isVirtual)

    // Test microphone access and levels
    let microphoneTest: MicrophoneTestResult | undefined
    if (hasInputDevice) {
      try {
        microphoneTest = await testMicrophoneAccess()
      } catch (error) {
        console.error('Error testing microphone:', error)
        microphoneTest = {
          accessible: false,
          error: error instanceof Error ? error.message : 'Unknown error'
        }
      }
    }

    // Generate diagnostic information
    const messages = generateDiagnosticMessages(virtualCables, inputDevices, outputDevices, microphoneTest)
    const overallStatus = determineOverallStatus(virtualCables, hasInputDevice, hasOutputDevice, microphoneTest)

    return {
      timestamp,
      platform,
      overallStatus,
      virtualCables,
      recommendedVirtualCable: getRecommendedVirtualCable(),
      inputDevices,
      outputDevices,
      hasInputDevice,
      hasOutputDevice,
      microphoneTest,
      messages
    }
  },

  /**
   * Check if a specific virtual cable type is installed
   */
  async isVirtualCableInstalled(cableType: VirtualCableType): Promise<boolean> {
    const cables = await detectVirtualCables()
    return cables.some(c => c.type === cableType && c.detected)
  },

  /**
   * Get installation instructions for virtual cable
   */
  getInstallationInstructions(cableType?: VirtualCableType): string {
    const type = cableType || getRecommendedVirtualCable()

    switch (type) {
      case 'vb-audio':
        return `To install VB-Audio Virtual Cable on Windows:
1. Visit https://vb-audio.com/Cable/
2. Download VBCABLE_Driver_Pack43.zip (or latest version)
3. Extract the ZIP file
4. Right-click VBCABLE_Setup_x64.exe and select "Run as administrator"
5. Follow the installation wizard
6. Restart your computer
7. Configure your meeting app to use "CABLE Input" as the output device`

      case 'blackhole':
        return `To install BlackHole on macOS:
1. Visit https://existential.audio/blackhole/
2. Download the installer (BlackHole 2ch or 16ch)
3. Open the PKG file and follow the installer
4. In System Preferences > Sound, you'll see "BlackHole" as an audio device
5. Create a Multi-Output Device in Audio MIDI Setup to route audio
6. Configure your meeting app to use BlackHole as the output device`

      case 'pulseaudio-virtual':
        return `To create a PulseAudio virtual sink on Linux:

Option 1 - Temporary (until reboot):
  pactl load-module module-null-sink sink_name=virtual_sink sink_properties=device.description="Virtual_Sink"

Option 2 - Permanent:
  Add to /etc/pulse/default.pa:
  load-module module-null-sink sink_name=virtual_sink sink_properties=device.description="Virtual_Sink"

Then use pavucontrol to route audio from your meeting app to the virtual sink.`

      default:
        return 'Virtual audio cable configuration is not available for your platform.'
    }
  },

  /**
   * Attempt to auto-fix common audio issues
   */
  async attemptAutoFix(issue: string): Promise<AutoFixResult> {
    const platform = process.platform

    switch (issue) {
      case 'NO_INPUT_DEVICE':
        // Try to refresh device list
        try {
          await getAudioDevices()
          return {
            success: true,
            action: 'refreshed_devices',
            message: 'Refreshed audio device list. Please check if your microphone is now detected.'
          }
        } catch (error) {
          return {
            success: false,
            action: 'refresh_devices',
            message: 'Failed to refresh devices',
            error: error instanceof Error ? error.message : 'Unknown error'
          }
        }

      case 'MICROPHONE_ACCESS_DENIED':
        // Platform-specific permission guidance
        let permissionMessage = ''
        switch (platform) {
          case 'darwin':
            permissionMessage = 'Go to System Preferences > Security & Privacy > Privacy > Microphone, and ensure this app has microphone access.'
            break
          case 'win32':
            permissionMessage = 'Go to Settings > Privacy > Microphone, and ensure microphone access is enabled for desktop apps.'
            break
          case 'linux':
            permissionMessage = 'Check PulseAudio permissions and ensure your user has access to audio devices.'
            break
        }
        return {
          success: false,
          action: 'check_permissions',
          message: permissionMessage || 'Please check microphone permissions in system settings.'
        }

      case 'MICROPHONE_LOW_LEVEL':
        // Try to suggest increasing input volume
        return {
          success: false,
          action: 'increase_volume',
          message: 'Please increase your microphone input volume in system audio settings. The microphone is working but levels are too low.'
        }

      case 'NO_VIRTUAL_CABLE':
        // Provide installation link
        const recommended = getRecommendedVirtualCable()
        let installLink = ''
        switch (recommended) {
          case 'vb-audio':
            installLink = 'https://vb-audio.com/Cable/'
            break
          case 'blackhole':
            installLink = 'https://existential.audio/blackhole/'
            break
        }
        return {
          success: false,
          action: 'install_virtual_cable',
          message: installLink 
            ? `Please install a virtual audio cable. Visit ${installLink} for installation instructions.`
            : 'Please install a virtual audio cable for your platform.'
        }

      default:
        return {
          success: false,
          action: 'unknown',
          message: 'Unable to auto-fix this issue. Please check the troubleshooting suggestions.'
        }
    }
  },

  /**
   * Run comprehensive Windows-specific audio diagnostics
   * Returns enhanced diagnostics including driver info, exclusive mode detection, and more
   */
  async runWindowsDiagnostics(): Promise<import('./windowsAudioCompatibilityService').WindowsAudioDiagnostics | null> {
    if (process.platform !== 'win32') {
      return null
    }

    try {
      const windowsService = await getWindowsAudioService()
      if (windowsService) {
        return await windowsService.runDiagnostics()
      }
    } catch (error) {
      console.error('Error running Windows audio diagnostics:', error)
    }
    return null
  },

  /**
   * Get Windows audio quick status (for quick checks)
   */
  async getWindowsQuickStatus(): Promise<{
    status: 'ok' | 'warning' | 'error'
    message: string
    canRecord: boolean
  } | null> {
    if (process.platform !== 'win32') {
      return null
    }

    try {
      const windowsService = await getWindowsAudioService()
      if (windowsService) {
        return await windowsService.getQuickStatus()
      }
    } catch (error) {
      console.error('Error getting Windows audio quick status:', error)
    }
    return null
  },

  /**
   * Start recording with Windows fallback mechanism
   * Tries multiple recording methods (sox, ffmpeg, etc.) if the primary fails
   */
  async startWindowsRecordingWithFallback(
    outputPath: string,
    deviceName: string,
    sampleRate: number = 16000
  ): Promise<import('./windowsAudioCompatibilityService').WindowsRecordingFallbackResult | null> {
    if (process.platform !== 'win32') {
      return null
    }

    try {
      const windowsService = await getWindowsAudioService()
      if (windowsService) {
        return await windowsService.tryRecordingWithFallback(outputPath, deviceName, sampleRate)
      }
    } catch (error) {
      console.error('Error starting Windows recording with fallback:', error)
    }
    return null
  }
}
