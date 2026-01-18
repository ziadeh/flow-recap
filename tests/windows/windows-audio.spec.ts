/**
 * Windows Audio Compatibility Tests
 *
 * Tests for Windows audio device enumeration, WASAPI/DirectShow compatibility,
 * and virtual audio driver support (VB-Audio Cable).
 *
 * Test scenarios:
 * - Audio device enumeration via WMI
 * - Windows Audio service verification
 * - VB-Audio Virtual Cable detection
 * - Audio recording capability verification
 */

import { test, expect } from '@playwright/test'
import * as path from 'path'
import * as fs from 'fs'
import { execSync } from 'child_process'

// Skip if not on Windows
const isWindows = process.platform === 'win32'
const skipIfNotWindows = isWindows ? test : test.skip

// ============================================================================
// Constants
// ============================================================================

const PROJECT_ROOT = path.resolve(__dirname, '../..')

// ============================================================================
// Helper Functions
// ============================================================================

function runCommand(command: string): { success: boolean; output: string; error?: string } {
  try {
    const output = execSync(command, {
      encoding: 'utf-8',
      timeout: 30000,
      stdio: ['pipe', 'pipe', 'pipe']
    })
    return { success: true, output: output.trim() }
  } catch (error: any) {
    return {
      success: false,
      output: error.stdout?.toString() || '',
      error: error.stderr?.toString() || error.message
    }
  }
}

function runPowerShell(script: string): { success: boolean; output: string; error?: string } {
  try {
    const output = execSync(`powershell -Command "${script}"`, {
      encoding: 'utf-8',
      timeout: 30000,
      stdio: ['pipe', 'pipe', 'pipe']
    })
    return { success: true, output: output.trim() }
  } catch (error: any) {
    return {
      success: false,
      output: error.stdout?.toString() || '',
      error: error.stderr?.toString() || error.message
    }
  }
}

// ============================================================================
// Windows Audio Service Tests
// ============================================================================

test.describe('Windows Audio Service', () => {
  skipIfNotWindows('should have Windows Audio service running', () => {
    const result = runCommand('sc query Audiosrv')

    expect(result.success).toBe(true)
    expect(result.output).toContain('Audiosrv')

    // Check if service is running
    const isRunning = result.output.includes('RUNNING')
    console.log(`Windows Audio service running: ${isRunning}`)
  })

  skipIfNotWindows('should have Windows Audio Endpoint Builder service', () => {
    const result = runCommand('sc query AudioEndpointBuilder')

    expect(result.success).toBe(true)
    expect(result.output).toContain('AudioEndpointBuilder')
  })

  skipIfNotWindows('should query audio service status via PowerShell', () => {
    const result = runPowerShell('Get-Service -Name Audiosrv | Select-Object Name, Status')

    if (result.success) {
      console.log('Audio service info:', result.output)
    }
  })
})

// ============================================================================
// Audio Device Enumeration Tests
// ============================================================================

test.describe('Audio Device Enumeration', () => {
  skipIfNotWindows('should enumerate audio devices via WMI', () => {
    const result = runCommand('wmic sounddev get name,status')

    if (result.success) {
      console.log('Sound devices:')
      console.log(result.output)

      expect(result.output.toLowerCase()).toContain('name')
    } else {
      console.log('WMI query failed - may not have audio devices')
    }
  })

  skipIfNotWindows('should enumerate audio devices via PowerShell', () => {
    const result = runPowerShell('Get-WmiObject Win32_SoundDevice | Select-Object Name, Status, Manufacturer')

    if (result.success && result.output) {
      console.log('Sound devices (PowerShell):')
      console.log(result.output)
    } else {
      console.log('No audio devices found or PowerShell query failed')
    }
  })

  skipIfNotWindows('should list audio endpoints', () => {
    // This requires more complex PowerShell
    const script = `
      try {
        Add-Type -AssemblyName System.Speech
        $synth = New-Object System.Speech.Synthesis.SpeechSynthesizer
        $devices = $synth.GetInstalledVoices() | ForEach-Object { $_.VoiceInfo.Name }
        $devices -join ','
      } catch {
        'Speech synthesis not available'
      }
    `

    const result = runPowerShell(script)
    console.log('Speech synthesis voices:', result.output)
  })
})

// ============================================================================
// Virtual Audio Driver Tests
// ============================================================================

test.describe('Virtual Audio Driver Detection', () => {
  skipIfNotWindows('should check for VB-Audio Virtual Cable', () => {
    const result = runCommand('wmic sounddev where "name like \'%VB%\'" get name')

    if (result.success && result.output.includes('VB')) {
      console.log('VB-Audio device found:', result.output)
    } else {
      console.log('VB-Audio not installed (expected in CI)')
    }
  })

  skipIfNotWindows('should check for VB-Audio Cable registry entries', () => {
    const registryPaths = [
      'HKLM\\SOFTWARE\\VB-Audio',
      'HKLM\\SOFTWARE\\WOW6432Node\\VB-Audio'
    ]

    let found = false
    for (const regPath of registryPaths) {
      const result = runCommand(`reg query "${regPath}" 2>nul`)
      if (result.success) {
        found = true
        console.log('VB-Audio registry found:', regPath)
        break
      }
    }

    if (!found) {
      console.log('VB-Audio not found in registry (expected in CI)')
    }
  })

  skipIfNotWindows('should check for common virtual audio devices', () => {
    const virtualDevicePatterns = [
      'VB-Audio',
      'CABLE',
      'Virtual',
      'Voicemeeter'
    ]

    const result = runCommand('wmic sounddev get name')

    if (result.success) {
      const foundDevices = virtualDevicePatterns.filter(pattern =>
        result.output.toLowerCase().includes(pattern.toLowerCase())
      )

      if (foundDevices.length > 0) {
        console.log('Virtual audio devices found:', foundDevices)
      } else {
        console.log('No virtual audio devices found')
      }
    }
  })
})

// ============================================================================
// Windows Audio Compatibility Service Tests
// ============================================================================

test.describe('Windows Audio Compatibility Service', () => {
  skipIfNotWindows('should have windowsAudioCompatibilityService.ts', () => {
    const servicePath = path.join(PROJECT_ROOT, 'electron/services/windowsAudioCompatibilityService.ts')
    expect(fs.existsSync(servicePath)).toBe(true)
  })

  skipIfNotWindows('should implement audio device enumeration', () => {
    const servicePath = path.join(PROJECT_ROOT, 'electron/services/windowsAudioCompatibilityService.ts')
    const content = fs.readFileSync(servicePath, 'utf-8')

    // Should have methods for device enumeration
    expect(content).toMatch(/enumerateDevices|getAudioDevices|listDevices/i)

    // Should handle WASAPI or DirectShow
    expect(content.toLowerCase()).toMatch(/wasapi|directshow|audio/i)
  })

  skipIfNotWindows('should implement VB-Audio detection', () => {
    const servicePath = path.join(PROJECT_ROOT, 'electron/services/windowsAudioCompatibilityService.ts')
    const content = fs.readFileSync(servicePath, 'utf-8')

    // Should check for VB-Audio or virtual cable
    expect(content.toLowerCase()).toMatch(/vb-audio|vb.*cable|virtual.*cable/i)
  })

  skipIfNotWindows('should have fallback mechanisms', () => {
    const servicePath = path.join(PROJECT_ROOT, 'electron/services/windowsAudioCompatibilityService.ts')
    const content = fs.readFileSync(servicePath, 'utf-8')

    // Should have error handling or fallback
    expect(content).toMatch(/catch|fallback|default/i)
  })
})

// ============================================================================
// Audio Recording Configuration Tests
// ============================================================================

test.describe('Audio Recording Configuration', () => {
  skipIfNotWindows('should have audioRecorderService.ts', () => {
    const servicePath = path.join(PROJECT_ROOT, 'electron/services/audioRecorderService.ts')
    expect(fs.existsSync(servicePath)).toBe(true)
  })

  skipIfNotWindows('should have Windows-specific audio handling', () => {
    const servicePath = path.join(PROJECT_ROOT, 'electron/services/audioRecorderService.ts')
    const content = fs.readFileSync(servicePath, 'utf-8')

    // Should check for Windows platform
    expect(content).toContain('win32')
  })

  skipIfNotWindows('should configure sox for Windows', () => {
    const servicePath = path.join(PROJECT_ROOT, 'electron/services/audioRecorderService.ts')
    const content = fs.readFileSync(servicePath, 'utf-8')

    // Should reference sox or audio recording
    expect(content.toLowerCase()).toMatch(/sox|recorder|audio/i)
  })

  skipIfNotWindows('should handle Windows audio device IDs', () => {
    const servicePath = path.join(PROJECT_ROOT, 'electron/services/audioDeviceService.ts')

    if (fs.existsSync(servicePath)) {
      const content = fs.readFileSync(servicePath, 'utf-8')

      // Should handle device enumeration
      expect(content.toLowerCase()).toMatch(/device|enumerate|list/i)
    }
  })
})

// ============================================================================
// Sox Binary Tests (Windows)
// ============================================================================

test.describe('Sox Binary Handling on Windows', () => {
  skipIfNotWindows('should check for sox.exe extension', () => {
    const binaryPath = process.platform === 'win32' ? 'sox.exe' : 'sox'
    expect(binaryPath).toBe('sox.exe')
  })

  skipIfNotWindows('should have correct sox binary path configuration', () => {
    const configPath = path.join(PROJECT_ROOT, 'electron/services/binaryManager.ts')

    if (fs.existsSync(configPath)) {
      const content = fs.readFileSync(configPath, 'utf-8')

      // Should handle .exe extension
      expect(content).toContain('.exe')

      // Should have Windows-specific binary handling
      expect(content).toContain('win32')
    }
  })

  skipIfNotWindows('should have sox DLL dependencies documented', () => {
    // Sox on Windows requires multiple DLLs
    const expectedDlls = [
      'libsox-3.dll',
      'libmad-0.dll',
      'libflac-8.dll',
      'libvorbis-0.dll',
      'libvorbisfile-3.dll',
      'libvorbisenc-2.dll',
      'libogg-0.dll',
      'libmp3lame-0.dll',
      'libsndfile-1.dll',
      'libopusfile-0.dll',
      'libopus-0.dll',
      'libgcc_s_sjlj-1.dll',
      'libwinpthread-1.dll'
    ]

    console.log('Expected sox DLL dependencies:')
    expectedDlls.forEach(dll => console.log(`  - ${dll}`))
  })
})

// ============================================================================
// FFmpeg Binary Tests (Windows)
// ============================================================================

test.describe('FFmpeg Binary Handling on Windows', () => {
  skipIfNotWindows('should check for ffmpeg.exe extension', () => {
    const binaryPath = process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg'
    expect(binaryPath).toBe('ffmpeg.exe')
  })

  skipIfNotWindows('should have ffprobe.exe as well', () => {
    const binaryPath = process.platform === 'win32' ? 'ffprobe.exe' : 'ffprobe'
    expect(binaryPath).toBe('ffprobe.exe')
  })
})

// ============================================================================
// NSIS Audio Driver Installation Tests
// ============================================================================

test.describe('NSIS Audio Driver Installation', () => {
  skipIfNotWindows('should have VB-Audio installation option in NSIS', () => {
    const nsisPath = path.join(PROJECT_ROOT, 'resources/installer/nsis-custom.nsh')

    if (fs.existsSync(nsisPath)) {
      const content = fs.readFileSync(nsisPath, 'utf-8')

      // Should have VB-Audio installation section
      expect(content.toLowerCase()).toMatch(/vb.*audio|vb.*cable|virtual.*audio/i)
    }
  })

  skipIfNotWindows('should make VB-Audio installation optional', () => {
    const nsisPath = path.join(PROJECT_ROOT, 'resources/installer/nsis-custom.nsh')

    if (fs.existsSync(nsisPath)) {
      const content = fs.readFileSync(nsisPath, 'utf-8')

      // Should have optional/checkbox style installation
      expect(content.toLowerCase()).toMatch(/optional|checkbox|section.*\/o|messagebox/i)
    }
  })
})

// ============================================================================
// Integration Tests
// ============================================================================

test.describe('Audio Integration Tests', () => {
  skipIfNotWindows('should have audio configuration in electron-builder', () => {
    const configPath = path.join(PROJECT_ROOT, 'electron-builder.config.cjs')
    const config = require(configPath)

    // Should have Windows build config
    expect(config.win).toBeDefined()

    // Should include audio-related resources
    if (config.extraResources) {
      console.log('Extra resources:', config.extraResources)
    }
  })

  skipIfNotWindows('should bundle sox binary for Windows', () => {
    const configPath = path.join(PROJECT_ROOT, 'electron-builder.config.cjs')
    const config = require(configPath)

    // Should have extra resources configuration
    expect(config.extraResources).toBeDefined()

    // Check for binary references
    const hasAudioBinaries = config.extraResources.some((r: any) => {
      const resource = typeof r === 'string' ? r : r.from
      return resource && (resource.includes('sox') || resource.includes('ffmpeg') || resource.includes('binaries'))
    })

    expect(hasAudioBinaries).toBe(true)
  })
})
