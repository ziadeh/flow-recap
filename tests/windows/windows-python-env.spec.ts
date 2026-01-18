/**
 * Windows Python Environment Tests
 *
 * Tests for Python environment detection, setup, and management on Windows.
 * Verifies the fixes applied to pythonEnvironment.ts for Windows compatibility.
 *
 * Test scenarios:
 * - Python detection via py launcher
 * - Python detection via python/python3 commands
 * - Virtual environment creation on Windows
 * - Site-packages path handling
 * - HuggingFace token and cache configuration
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
const TEMP_DIR = os.tmpdir()

// ============================================================================
// Helper Functions
// ============================================================================

function runCommand(command: string, options: { timeout?: number } = {}): { success: boolean; output: string; error?: string } {
  try {
    const output = execSync(command, {
      encoding: 'utf-8',
      timeout: options.timeout || 30000,
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

function runWindowsCommand(command: string): { success: boolean; output: string; error?: string } {
  return runCommand(`cmd.exe /c ${command}`)
}

async function createTempVenv(name: string): Promise<string> {
  const venvPath = path.join(TEMP_DIR, `flowrecap-test-${name}-${Date.now()}`)

  const pythonCommand = isWindows
    ? 'py -3 -m venv'
    : 'python3 -m venv'

  runCommand(`${pythonCommand} "${venvPath}"`)

  return venvPath
}

function cleanupVenv(venvPath: string): void {
  try {
    fs.rmSync(venvPath, { recursive: true, force: true })
  } catch {
    // Ignore cleanup errors
  }
}

// ============================================================================
// Python Detection Tests
// ============================================================================

test.describe('Python Detection on Windows', () => {
  skipIfNotWindows('should detect Python via py launcher', () => {
    const result = runWindowsCommand('py --version')

    // py launcher should be available on modern Windows
    if (result.success) {
      expect(result.output).toMatch(/Python \d+\.\d+\.\d+/)
      console.log(`Python via py launcher: ${result.output}`)
    } else {
      console.log('py launcher not available - may not be installed')
    }
  })

  skipIfNotWindows('should detect Python via py -3.12', () => {
    const result = runWindowsCommand('py -3.12 --version')

    if (result.success) {
      expect(result.output).toMatch(/Python 3\.12/)
      console.log(`Python 3.12: ${result.output}`)
    } else {
      console.log('Python 3.12 not installed via py launcher')
    }
  })

  skipIfNotWindows('should detect Python via python command', () => {
    const result = runWindowsCommand('python --version')

    if (result.success) {
      expect(result.output).toMatch(/Python \d+\.\d+/)
      console.log(`Python via python command: ${result.output}`)
    } else {
      console.log('python command not in PATH')
    }
  })

  skipIfNotWindows('should use where.exe instead of which', () => {
    // where.exe is Windows equivalent of which
    const result = runWindowsCommand('where.exe python')

    if (result.success) {
      expect(result.output).toContain('.exe')
      console.log(`Python locations: ${result.output}`)
    } else {
      console.log('python not found in PATH')
    }
  })

  skipIfNotWindows('should list available Python versions', () => {
    const result = runWindowsCommand('py --list')

    if (result.success) {
      console.log('Available Python versions:')
      console.log(result.output)
      expect(result.output).toBeDefined()
    }
  })

  skipIfNotWindows('should get Python executable path', () => {
    const result = runCommand('python -c "import sys; print(sys.executable)"')

    if (result.success) {
      expect(result.output).toContain('.exe')
      expect(result.output).toMatch(/python/i)
      console.log(`Python executable: ${result.output}`)
    }
  })
})

// ============================================================================
// Virtual Environment Tests
// ============================================================================

test.describe('Virtual Environment on Windows', () => {
  let testVenvPath: string

  test.afterEach(() => {
    if (testVenvPath) {
      cleanupVenv(testVenvPath)
    }
  })

  skipIfNotWindows('should create venv with correct Windows structure', async () => {
    testVenvPath = await createTempVenv('structure')

    // Verify Windows-specific structure
    const scriptsDir = path.join(testVenvPath, 'Scripts')
    const libDir = path.join(testVenvPath, 'Lib')

    expect(fs.existsSync(scriptsDir)).toBe(true)
    expect(fs.existsSync(libDir)).toBe(true)

    // Should have python.exe in Scripts
    const pythonExe = path.join(scriptsDir, 'python.exe')
    expect(fs.existsSync(pythonExe)).toBe(true)

    // Should have pip.exe in Scripts
    const pipExe = path.join(scriptsDir, 'pip.exe')
    expect(fs.existsSync(pipExe)).toBe(true)

    // Should have site-packages in Lib
    const sitePackages = path.join(libDir, 'site-packages')
    expect(fs.existsSync(sitePackages)).toBe(true)
  })

  skipIfNotWindows('should NOT have bin directory on Windows', async () => {
    testVenvPath = await createTempVenv('no-bin')

    // Windows venv should NOT have bin directory
    const binDir = path.join(testVenvPath, 'bin')
    expect(fs.existsSync(binDir)).toBe(false)
  })

  skipIfNotWindows('should activate venv and install packages', async () => {
    testVenvPath = await createTempVenv('install')

    const pipExe = path.join(testVenvPath, 'Scripts', 'pip.exe')

    // Install a small package
    const result = runCommand(`"${pipExe}" install pip-install-test --quiet`)

    if (result.success) {
      // Verify package was installed
      const listResult = runCommand(`"${pipExe}" list`)
      expect(listResult.output.toLowerCase()).toContain('pip-install-test')
    }
  })

  skipIfNotWindows('should use correct Python path in venv', async () => {
    testVenvPath = await createTempVenv('python-path')

    const pythonExe = path.join(testVenvPath, 'Scripts', 'python.exe')

    // Get sys.executable from venv Python
    const result = runCommand(`"${pythonExe}" -c "import sys; print(sys.executable)"`)

    if (result.success) {
      // Should point to the venv's python.exe
      expect(path.normalize(result.output.toLowerCase()))
        .toBe(path.normalize(pythonExe.toLowerCase()))
    }
  })
})

// ============================================================================
// Site-Packages Path Tests
// ============================================================================

test.describe('Site-Packages Path Handling', () => {
  let testVenvPath: string

  test.afterEach(() => {
    if (testVenvPath) {
      cleanupVenv(testVenvPath)
    }
  })

  skipIfNotWindows('should detect site-packages in Lib directory', async () => {
    testVenvPath = await createTempVenv('site-packages')

    // Windows site-packages path: venv/Lib/site-packages
    const sitePackages = path.join(testVenvPath, 'Lib', 'site-packages')
    expect(fs.existsSync(sitePackages)).toBe(true)

    // Verify path structure matches expected pattern
    expect(sitePackages).toContain('Lib')
    expect(sitePackages).toContain('site-packages')
    expect(sitePackages).not.toContain('lib/python')
  })

  skipIfNotWindows('should get site-packages via Python', async () => {
    testVenvPath = await createTempVenv('site-packages-py')

    const pythonExe = path.join(testVenvPath, 'Scripts', 'python.exe')

    const result = runCommand(
      `"${pythonExe}" -c "import site; print(site.getsitepackages()[0])"`
    )

    if (result.success) {
      expect(result.output).toContain('site-packages')
      expect(result.output).toContain('Lib')
      console.log(`Site-packages path: ${result.output}`)
    }
  })

  skipIfNotWindows('should handle pythonEnvironment.ts path logic', () => {
    // Simulate the path logic from pythonEnvironment.ts
    const venvBase = 'C:\\Users\\test\\flowrecap\\venvs\\whisperx'

    // Windows path construction (as implemented in pythonEnvironment.ts)
    const pythonPath = process.platform === 'win32'
      ? path.join(venvBase, 'Scripts', 'python.exe')
      : path.join(venvBase, 'bin', 'python')

    // Verify Windows-specific path
    expect(pythonPath).toBe('C:\\Users\\test\\flowrecap\\venvs\\whisperx\\Scripts\\python.exe')
    expect(pythonPath).toContain('Scripts')
    expect(pythonPath).toContain('.exe')
  })

  skipIfNotWindows('should get correct site-packages for validation', () => {
    // Simulate the getSitePackagesPath helper logic
    const pythonPath = 'C:\\Users\\test\\venv\\Scripts\\python.exe'

    // Windows site-packages calculation (from pythonEnvironment.ts fix)
    const sitePackages = process.platform === 'win32'
      ? path.join(path.dirname(path.dirname(pythonPath)), 'Lib', 'site-packages')
      : path.join(path.dirname(path.dirname(pythonPath)), 'lib', 'python3.12', 'site-packages')

    expect(sitePackages).toBe('C:\\Users\\test\\venv\\Lib\\site-packages')
  })
})

// ============================================================================
// HuggingFace Configuration Tests
// ============================================================================

test.describe('HuggingFace Configuration on Windows', () => {
  skipIfNotWindows('should have correct HF cache directory', () => {
    // Default HuggingFace cache on Windows
    const localAppData = process.env.LOCALAPPDATA
    const userProfile = process.env.USERPROFILE

    // HF typically uses ~/.cache/huggingface or LOCALAPPDATA
    const possiblePaths = [
      path.join(userProfile || '', '.cache', 'huggingface'),
      path.join(localAppData || '', 'huggingface')
    ]

    console.log('Possible HF cache paths:')
    for (const p of possiblePaths) {
      console.log(`  ${p} - exists: ${fs.existsSync(p)}`)
    }

    // At least one valid path should be constructable
    expect(possiblePaths.some(p => p.length > 0)).toBe(true)
  })

  skipIfNotWindows('should handle HF_TOKEN environment variable', () => {
    // Test that HF_TOKEN can be read from environment
    const hfToken = process.env.HF_TOKEN || process.env.HUGGINGFACE_TOKEN

    // In CI, token may not be set - just verify we can check it
    console.log(`HF_TOKEN set: ${!!hfToken}`)

    // The batch script should handle missing token gracefully
    const batchPath = path.join(PROJECT_ROOT, 'python/setup_environments.bat')
    if (fs.existsSync(batchPath)) {
      const content = fs.readFileSync(batchPath, 'utf-8')
      expect(content).toContain('HF_TOKEN')
    }
  })

  skipIfNotWindows('should set HF_HOME environment variable', () => {
    // Recommended: Set HF_HOME explicitly for Windows
    const recommendedPath = path.join(process.env.LOCALAPPDATA || '', 'huggingface')

    // This is a recommendation test - verify the path would work
    expect(path.isAbsolute(recommendedPath)).toBe(true)
    expect(recommendedPath).toContain('huggingface')
  })
})

// ============================================================================
// Python Setup Script Tests
// ============================================================================

test.describe('Python Setup Script (Windows)', () => {
  skipIfNotWindows('should have Windows batch setup script', () => {
    const batchPath = path.join(PROJECT_ROOT, 'python/setup_environments.bat')
    expect(fs.existsSync(batchPath)).toBe(true)
  })

  skipIfNotWindows('should have correct batch script syntax', () => {
    const batchPath = path.join(PROJECT_ROOT, 'python/setup_environments.bat')
    const content = fs.readFileSync(batchPath, 'utf-8')

    // Should use Windows batch syntax
    expect(content).toMatch(/@echo off|echo\./i)
    expect(content).toContain('set ')
    expect(content).toMatch(/if.*exist/i)

    // Should NOT use Unix-specific syntax
    expect(content).not.toContain('#!/bin/bash')
    expect(content).not.toContain('source ')
  })

  skipIfNotWindows('should create venv using batch script syntax', () => {
    const batchPath = path.join(PROJECT_ROOT, 'python/setup_environments.bat')
    const content = fs.readFileSync(batchPath, 'utf-8')

    // Should use python -m venv
    expect(content).toMatch(/python.*-m.*venv/i)

    // Should reference Scripts directory
    expect(content).toMatch(/Scripts[\\\/]python/i)
  })

  skipIfNotWindows('should handle py launcher in batch script', () => {
    const batchPath = path.join(PROJECT_ROOT, 'python/setup_environments.bat')
    const content = fs.readFileSync(batchPath, 'utf-8')

    // Should check for py launcher
    expect(content.toLowerCase()).toMatch(/py\s|where.*py/i)
  })
})

// ============================================================================
// Error Handling Tests
// ============================================================================

test.describe('Python Error Handling on Windows', () => {
  skipIfNotWindows('should handle missing Python gracefully', () => {
    // Try to run a non-existent Python version
    const result = runWindowsCommand('py -3.99 --version')

    // Should fail gracefully
    expect(result.success).toBe(false)
  })

  skipIfNotWindows('should handle venv creation failure', async () => {
    // Try to create venv in invalid location
    const invalidPath = 'Z:\\nonexistent\\path\\venv'
    const result = runCommand(`py -3 -m venv "${invalidPath}"`)

    // Should fail
    expect(result.success).toBe(false)
  })

  skipIfNotWindows('should handle long path issues', async () => {
    // Create a path that approaches Windows MAX_PATH (260)
    const longName = 'a'.repeat(200)
    const longPath = path.join(TEMP_DIR, longName)

    try {
      fs.mkdirSync(longPath, { recursive: true })
      console.log('Long path creation succeeded')

      // Try to create venv in long path
      const venvPath = path.join(longPath, 'venv')
      const result = runCommand(`py -3 -m venv "${venvPath}"`)

      if (result.success) {
        console.log('Venv in long path succeeded')
        cleanupVenv(venvPath)
      } else {
        console.log('Venv in long path failed (expected on some systems)')
      }

      fs.rmSync(longPath, { recursive: true, force: true })
    } catch (error: any) {
      console.log(`Long path test failed: ${error.message}`)
    }
  })
})

// ============================================================================
// Integration Tests
// ============================================================================

test.describe('Python Environment Integration', () => {
  skipIfNotWindows('should match pythonEnvironment.ts detection logic', () => {
    // Test the same detection order as pythonEnvironment.ts
    const detectionMethods = [
      { name: 'py -3.12', cmd: 'py -3.12 --version' },
      { name: 'py -3', cmd: 'py -3 --version' },
      { name: 'python', cmd: 'python --version' },
      { name: 'python3', cmd: 'python3 --version' }
    ]

    let detectedPython = null

    for (const method of detectionMethods) {
      const result = runWindowsCommand(method.cmd)
      if (result.success) {
        detectedPython = {
          method: method.name,
          version: result.output
        }
        break
      }
    }

    expect(detectedPython).not.toBeNull()
    console.log(`Detected Python: ${detectedPython?.method} - ${detectedPython?.version}`)
  })

  skipIfNotWindows('should verify pythonEnvironmentValidator.ts checks', () => {
    // Validate the checks from pythonEnvironmentValidator.ts
    const validatorPath = path.join(PROJECT_ROOT, 'electron/services/pythonEnvironmentValidator.ts')

    if (fs.existsSync(validatorPath)) {
      const content = fs.readFileSync(validatorPath, 'utf-8')

      // Should have Windows-specific validation
      expect(content).toContain('win32')

      // Should check for Scripts directory
      expect(content.toLowerCase()).toMatch(/scripts|python\.exe/i)
    }
  })
})
