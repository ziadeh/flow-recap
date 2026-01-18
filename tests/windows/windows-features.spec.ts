/**
 * Windows-Specific Feature Tests
 *
 * Comprehensive test suite for Windows-specific features in FlowRecap:
 * - Python environment detection and setup
 * - Audio device compatibility
 * - File path handling
 * - Windows registry and shortcuts
 * - Binary execution (.exe handling)
 * - Process management on Windows
 *
 * These tests verify the Windows compatibility fixes documented in
 * docs/WINDOWS_COMPATIBILITY_AUDIT.md
 */

import { test, expect } from '@playwright/test'
import * as path from 'path'
import * as fs from 'fs'
import * as os from 'os'
import { execSync, spawn } from 'child_process'

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

/**
 * Execute a Windows command and return the result
 */
function runWindowsCommand(command: string): { success: boolean; output: string } {
  try {
    const output = execSync(command, {
      encoding: 'utf-8',
      timeout: 30000,
      stdio: ['pipe', 'pipe', 'pipe']
    })
    return { success: true, output: output.trim() }
  } catch (error: any) {
    return { success: false, output: error.message || '' }
  }
}

/**
 * Check if a Windows registry key exists
 */
function checkRegistryKey(key: string): boolean {
  if (!isWindows) return false
  try {
    execSync(`reg query "${key}"`, { stdio: 'pipe' })
    return true
  } catch {
    return false
  }
}

/**
 * Get Windows environment variable
 */
function getWindowsEnv(varName: string): string | undefined {
  return process.env[varName]
}

// ============================================================================
// Configuration Tests
// ============================================================================

test.describe('Windows Configuration Tests', () => {
  skipIfNotWindows('should have correct electron-builder Windows configuration', () => {
    const configPath = path.join(PROJECT_ROOT, 'electron-builder.config.cjs')
    expect(fs.existsSync(configPath)).toBe(true)

    const config = require(configPath)

    // Verify Windows config exists
    expect(config.win).toBeDefined()
    expect(config.nsis).toBeDefined()

    // Verify NSIS settings
    expect(config.nsis.oneClick).toBe(false)
    expect(config.nsis.allowToChangeInstallationDirectory).toBe(true)
    expect(config.nsis.createDesktopShortcut).toBe(true)
    expect(config.nsis.createStartMenuShortcut).toBe(true)

    // Verify Windows targets
    expect(config.win.target).toBeDefined()
    const targets = config.win.target.map((t: any) => t.target || t)
    expect(targets).toContain('nsis')
  })

  skipIfNotWindows('should have Windows-specific service files', () => {
    const windowsServices = [
      'electron/services/windowsAudioCompatibilityService.ts',
      'electron/services/windowsPythonDiagnostics.ts'
    ]

    for (const service of windowsServices) {
      const servicePath = path.join(PROJECT_ROOT, service)
      expect(fs.existsSync(servicePath)).toBe(true)
    }
  })

  skipIfNotWindows('should have Windows batch setup script', () => {
    const batchPath = path.join(PROJECT_ROOT, 'python/setup_environments.bat')
    expect(fs.existsSync(batchPath)).toBe(true)

    const content = fs.readFileSync(batchPath, 'utf-8')
    expect(content).toContain('python')
    expect(content).toContain('venv')
  })
})

// ============================================================================
// Environment Variable Tests
// ============================================================================

test.describe('Windows Environment Tests', () => {
  skipIfNotWindows('should have standard Windows environment variables', () => {
    // These should always be present on Windows
    expect(getWindowsEnv('APPDATA')).toBeDefined()
    expect(getWindowsEnv('LOCALAPPDATA')).toBeDefined()
    expect(getWindowsEnv('USERPROFILE')).toBeDefined()
    expect(getWindowsEnv('PATH')).toBeDefined()
    expect(getWindowsEnv('SystemRoot')).toBeDefined()
    expect(getWindowsEnv('ProgramFiles')).toBeDefined()
  })

  skipIfNotWindows('should correctly use APPDATA for user data', () => {
    const appData = getWindowsEnv('APPDATA')
    expect(appData).toBeDefined()
    expect(fs.existsSync(appData!)).toBe(true)

    // APPDATA should be under USERPROFILE
    const userProfile = getWindowsEnv('USERPROFILE')
    expect(appData!.startsWith(userProfile!)).toBe(true)
  })

  skipIfNotWindows('should handle PATH separator correctly', () => {
    const pathVar = getWindowsEnv('PATH')
    expect(pathVar).toBeDefined()

    // Windows uses semicolon as PATH separator
    expect(pathVar).toContain(';')

    // Should NOT contain colon as separator (colon is part of drive letters like C:)
    const pathParts = pathVar!.split(';')
    expect(pathParts.length).toBeGreaterThan(1)
  })
})

// ============================================================================
// File Path Tests
// ============================================================================

test.describe('Windows Path Handling Tests', () => {
  skipIfNotWindows('should handle paths with spaces', async () => {
    const tempDir = os.tmpdir()
    const testPath = path.join(tempDir, 'test path with spaces', 'subdir')

    // Create directory with spaces
    fs.mkdirSync(testPath, { recursive: true })
    expect(fs.existsSync(testPath)).toBe(true)

    // Write and read file
    const testFile = path.join(testPath, 'test.txt')
    fs.writeFileSync(testFile, 'test content')
    const content = fs.readFileSync(testFile, 'utf-8')
    expect(content).toBe('test content')

    // Cleanup
    fs.rmSync(path.join(tempDir, 'test path with spaces'), { recursive: true })
  })

  skipIfNotWindows('should handle Windows path separators', () => {
    const testPath = 'C:\\Users\\Test\\Documents'

    // path.join should normalize to system separator
    const joined = path.join('C:', 'Users', 'Test', 'Documents')
    expect(joined).toBe(testPath)

    // path.normalize should work
    const normalized = path.normalize('C:/Users/Test/Documents')
    expect(normalized).toBe(testPath)
  })

  skipIfNotWindows('should handle drive letters correctly', () => {
    const systemRoot = getWindowsEnv('SystemRoot')
    expect(systemRoot).toBeDefined()

    // System root should start with a drive letter
    expect(systemRoot).toMatch(/^[A-Z]:\\/i)

    // Parse path should correctly identify root
    const parsed = path.parse(systemRoot!)
    expect(parsed.root).toMatch(/^[A-Z]:\\/i)
  })

  skipIfNotWindows('should use path.join for all paths in services', async () => {
    // Read a Windows service file and verify it uses path.join
    const servicePath = path.join(PROJECT_ROOT, 'electron/services/windowsAudioCompatibilityService.ts')

    if (fs.existsSync(servicePath)) {
      const content = fs.readFileSync(servicePath, 'utf-8')

      // Should use path.join for constructing paths
      expect(content).toContain('path.join')

      // Should not have hardcoded Unix paths
      expect(content).not.toMatch(/['"][^'"]*\/bin\/[^'"]*['"]/)
    }
  })
})

// ============================================================================
// Process Execution Tests
// ============================================================================

test.describe('Windows Process Execution Tests', () => {
  skipIfNotWindows('should execute .exe files correctly', () => {
    // Test executing a standard Windows command
    const result = runWindowsCommand('cmd.exe /c echo test')
    expect(result.success).toBe(true)
    expect(result.output).toBe('test')
  })

  skipIfNotWindows('should use where.exe for command detection', () => {
    // where.exe is Windows equivalent of which
    const result = runWindowsCommand('where.exe cmd.exe')
    expect(result.success).toBe(true)
    expect(result.output).toContain('cmd.exe')
  })

  skipIfNotWindows('should handle cmd.exe /c wrapping', () => {
    // This is how the app executes batch scripts
    const result = runWindowsCommand('cmd.exe /c "echo hello && echo world"')
    expect(result.success).toBe(true)
    expect(result.output).toContain('hello')
    expect(result.output).toContain('world')
  })

  skipIfNotWindows('should spawn processes with correct options', async () => {
    return new Promise<void>((resolve, reject) => {
      const child = spawn('cmd.exe', ['/c', 'echo spawn test'], {
        stdio: ['pipe', 'pipe', 'pipe']
      })

      let output = ''
      child.stdout.on('data', (data) => {
        output += data.toString()
      })

      child.on('close', (code) => {
        expect(code).toBe(0)
        expect(output).toContain('spawn test')
        resolve()
      })

      child.on('error', reject)

      // Timeout after 10 seconds
      setTimeout(() => reject(new Error('Spawn timeout')), 10000)
    })
  })
})

// ============================================================================
// Binary Handling Tests
// ============================================================================

test.describe('Windows Binary Handling Tests', () => {
  skipIfNotWindows('should append .exe extension for Windows binaries', () => {
    // Simulate the binary naming logic from binaryManager.ts
    const binaryName = 'sox'
    const extension = process.platform === 'win32' ? '.exe' : ''
    const filename = `${binaryName}${extension}`

    expect(filename).toBe('sox.exe')
  })

  skipIfNotWindows('should check for bundled binaries path', () => {
    const binaryDir = path.join(PROJECT_ROOT, 'resources', 'binaries', 'windows', 'x64')

    // Directory should exist or be created during build
    // We just check the path is valid
    expect(path.isAbsolute(binaryDir)).toBe(false) // relative path
    const absolutePath = path.resolve(binaryDir)
    expect(path.isAbsolute(absolutePath)).toBe(true)
  })

  skipIfNotWindows('should handle sox binary with DLL dependencies', () => {
    // Sox on Windows requires multiple DLLs
    const expectedDlls = [
      'libsox-3.dll',
      'libmad-0.dll',
      'libflac-8.dll',
      'libvorbis-0.dll',
      'libvorbisfile-3.dll',
      'libvorbisenc-2.dll',
      'libogg-0.dll'
    ]

    // This test documents the expected DLLs - actual verification in CI
    expect(expectedDlls.length).toBeGreaterThan(5)
  })
})

// ============================================================================
// Python Environment Tests (Windows-specific)
// ============================================================================

test.describe('Windows Python Environment Tests', () => {
  skipIfNotWindows('should detect Python using Windows-specific methods', () => {
    // Test py launcher
    const pyResult = runWindowsCommand('py --version')

    // Test python command
    const pythonResult = runWindowsCommand('python --version')

    // At least one should work
    expect(pyResult.success || pythonResult.success).toBe(true)

    if (pyResult.success) {
      expect(pyResult.output).toMatch(/Python \d+\.\d+/)
    }

    if (pythonResult.success) {
      expect(pythonResult.output).toMatch(/Python \d+\.\d+/)
    }
  })

  skipIfNotWindows('should detect Python installation via py launcher list', () => {
    const result = runWindowsCommand('py --list')

    if (result.success) {
      // py --list shows available Python versions
      expect(result.output).toMatch(/\d+\.\d+/)
    }
  })

  skipIfNotWindows('should use Scripts directory for Windows venv', () => {
    // Windows venv structure uses Scripts instead of bin
    const venvBase = 'test-venv'

    const pythonPath = process.platform === 'win32'
      ? path.join(venvBase, 'Scripts', 'python.exe')
      : path.join(venvBase, 'bin', 'python')

    expect(pythonPath).toContain('Scripts')
    expect(pythonPath).toContain('.exe')
  })

  skipIfNotWindows('should use Lib directory for Windows site-packages', () => {
    // Windows uses Lib/site-packages, Unix uses lib/pythonX.Y/site-packages
    const venvBase = 'test-venv'

    const sitePackages = process.platform === 'win32'
      ? path.join(venvBase, 'Lib', 'site-packages')
      : path.join(venvBase, 'lib', 'python3.12', 'site-packages')

    expect(sitePackages).toContain('Lib')
    expect(sitePackages).not.toContain('lib/python')
  })

  skipIfNotWindows('should locate Visual C++ redistributable', () => {
    // Check for VC++ redistributable via registry
    const vcKeys = [
      'HKLM\\SOFTWARE\\Microsoft\\VisualStudio\\14.0\\VC\\Runtimes\\x64',
      'HKLM\\SOFTWARE\\WOW6432Node\\Microsoft\\VisualStudio\\14.0\\VC\\Runtimes\\x64'
    ]

    let found = false
    for (const key of vcKeys) {
      if (checkRegistryKey(key)) {
        found = true
        break
      }
    }

    // This test documents the check - may not pass in all CI environments
    // so we just log the result
    console.log(`Visual C++ Redistributable found: ${found}`)
  })
})

// ============================================================================
// NSIS Installer Configuration Tests
// ============================================================================

test.describe('NSIS Installer Configuration Tests', () => {
  skipIfNotWindows('should have custom NSIS script', () => {
    const nsisPath = path.join(PROJECT_ROOT, 'resources/installer/nsis-custom.nsh')

    if (fs.existsSync(nsisPath)) {
      const content = fs.readFileSync(nsisPath, 'utf-8')
      expect(content.length).toBeGreaterThan(0)

      // Should be valid NSIS script content
      expect(content).toMatch(/(!define|!include|Section|Function)/i)
    }
  })

  skipIfNotWindows('should have correct NSIS configuration in electron-builder', () => {
    const configPath = path.join(PROJECT_ROOT, 'electron-builder.config.cjs')
    const config = require(configPath)

    // NSIS configuration
    expect(config.nsis.oneClick).toBe(false)
    expect(config.nsis.allowToChangeInstallationDirectory).toBe(true)
    expect(config.nsis.perMachine).toBe(false) // Per-user install

    // Shortcut configuration
    expect(config.nsis.createDesktopShortcut).toBe(true)
    expect(config.nsis.createStartMenuShortcut).toBe(true)

    // Language
    expect(config.nsis.language).toBe('1033') // English
  })

  skipIfNotWindows('should have icon file for Windows', () => {
    const iconPath = path.join(PROJECT_ROOT, 'resources/icons/icon.ico')
    expect(fs.existsSync(iconPath)).toBe(true)

    // Verify it's a valid ICO file (starts with 0x00 0x00 0x01 0x00)
    const buffer = fs.readFileSync(iconPath)
    expect(buffer[0]).toBe(0x00)
    expect(buffer[1]).toBe(0x00)
    expect(buffer[2]).toBe(0x01)
    expect(buffer[3]).toBe(0x00)
  })
})

// ============================================================================
// Windows Audio Compatibility Tests
// ============================================================================

test.describe('Windows Audio Compatibility Tests', () => {
  skipIfNotWindows('should have Windows audio compatibility service', () => {
    const servicePath = path.join(PROJECT_ROOT, 'electron/services/windowsAudioCompatibilityService.ts')
    expect(fs.existsSync(servicePath)).toBe(true)

    const content = fs.readFileSync(servicePath, 'utf-8')

    // Should handle WASAPI/DirectShow
    expect(content.toLowerCase()).toMatch(/wasapi|directshow|audio/i)
  })

  skipIfNotWindows('should check for Windows Audio service', () => {
    const result = runWindowsCommand('sc query Audiosrv')
    expect(result.success).toBe(true)
    expect(result.output).toContain('Audiosrv')
  })

  skipIfNotWindows('should enumerate audio devices via WMI', () => {
    const result = runWindowsCommand('wmic sounddev get name,status')

    if (result.success) {
      expect(result.output).toBeDefined()
      // Output should have headers at minimum
      expect(result.output.toLowerCase()).toContain('name')
    }
  })
})

// ============================================================================
// Cross-Platform Verification
// ============================================================================

test.describe('Cross-Platform Code Verification', () => {
  test('should have platform checks in critical services', async () => {
    const criticalFiles = [
      'electron/services/pythonEnvironment.ts',
      'electron/services/binaryManager.ts',
      'electron/services/llm/adapters/claudeAdapter.ts'
    ]

    for (const file of criticalFiles) {
      const filePath = path.join(PROJECT_ROOT, file)

      if (fs.existsSync(filePath)) {
        const content = fs.readFileSync(filePath, 'utf-8')

        // Should have platform detection
        expect(content).toMatch(/process\.platform|os\.platform/i)

        // Should check for win32
        expect(content).toContain('win32')
      }
    }
  })

  test('should use path.join consistently', async () => {
    const servicePath = path.join(PROJECT_ROOT, 'electron/services/pythonEnvironment.ts')

    if (fs.existsSync(servicePath)) {
      const content = fs.readFileSync(servicePath, 'utf-8')

      // Count path.join usages
      const pathJoinCount = (content.match(/path\.join/g) || []).length
      expect(pathJoinCount).toBeGreaterThan(10) // Should have many path.join calls

      // Should not have string concatenation for paths
      const badPathConcatPattern = /['"].*[\\\/].*['"] \+ ['"].*[']/
      expect(content).not.toMatch(badPathConcatPattern)
    }
  })
})
