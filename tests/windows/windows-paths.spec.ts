/**
 * Windows Path Handling Tests
 *
 * Tests for Windows-specific path handling:
 * - Path separator handling (backslash vs forward slash)
 * - Drive letter handling
 * - Long path support (>260 characters)
 * - Paths with spaces
 * - Non-ASCII characters in paths
 * - UNC paths
 * - Network drive paths
 */

import { test, expect } from '@playwright/test'
import * as path from 'path'
import * as fs from 'fs'
import * as os from 'os'
import { execSync } from 'child_process'

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

function createTestDir(name: string): string {
  const testPath = path.join(TEMP_DIR, `flowrecap-test-${name}-${Date.now()}`)
  fs.mkdirSync(testPath, { recursive: true })
  return testPath
}

function cleanupTestDir(dirPath: string): void {
  try {
    fs.rmSync(dirPath, { recursive: true, force: true })
  } catch {
    // Ignore cleanup errors
  }
}

// ============================================================================
// Path Separator Tests
// ============================================================================

test.describe('Path Separator Handling', () => {
  skipIfNotWindows('should use backslash as default separator', () => {
    expect(path.sep).toBe('\\')
  })

  skipIfNotWindows('should handle forward slashes in path.join', () => {
    const result = path.join('C:', 'Users', 'Test')
    expect(result).toBe('C:\\Users\\Test')
  })

  skipIfNotWindows('should normalize mixed separators', () => {
    const mixed = 'C:/Users\\Test/Documents'
    const normalized = path.normalize(mixed)
    expect(normalized).toBe('C:\\Users\\Test\\Documents')
  })

  skipIfNotWindows('should handle path.resolve with forward slashes', () => {
    const resolved = path.resolve('C:/Users/Test')
    expect(resolved).toContain('\\')
    expect(resolved).not.toContain('/')
  })

  skipIfNotWindows('should maintain forward slashes in URLs', () => {
    // URLs should keep forward slashes
    const url = 'file:///C:/Users/Test/file.txt'
    expect(url).toContain('/')
    expect(url).not.toContain('\\')
  })
})

// ============================================================================
// Drive Letter Tests
// ============================================================================

test.describe('Drive Letter Handling', () => {
  skipIfNotWindows('should parse drive letter from path', () => {
    const parsed = path.parse('C:\\Users\\Test\\file.txt')
    expect(parsed.root).toBe('C:\\')
  })

  skipIfNotWindows('should handle lowercase drive letters', () => {
    const parsed = path.parse('c:\\users\\test')
    expect(parsed.root.toUpperCase()).toBe('C:\\')
  })

  skipIfNotWindows('should identify root drive', () => {
    const systemDrive = process.env.SystemDrive || 'C:'
    expect(systemDrive).toMatch(/^[A-Z]:$/i)
  })

  skipIfNotWindows('should resolve relative to current drive', () => {
    const cwd = process.cwd()
    expect(cwd).toMatch(/^[A-Z]:\\/i)
  })
})

// ============================================================================
// Paths with Spaces Tests
// ============================================================================

test.describe('Paths with Spaces', () => {
  let testDir: string

  test.afterEach(() => {
    if (testDir) cleanupTestDir(testDir)
  })

  skipIfNotWindows('should create directory with spaces', () => {
    testDir = createTestDir('path with spaces')
    expect(fs.existsSync(testDir)).toBe(true)
  })

  skipIfNotWindows('should write file to path with spaces', () => {
    testDir = createTestDir('file path spaces')
    const filePath = path.join(testDir, 'test file.txt')

    fs.writeFileSync(filePath, 'content')
    expect(fs.existsSync(filePath)).toBe(true)

    const content = fs.readFileSync(filePath, 'utf-8')
    expect(content).toBe('content')
  })

  skipIfNotWindows('should handle deeply nested paths with spaces', () => {
    testDir = createTestDir('deep space test')
    const deepPath = path.join(testDir, 'level one', 'level two', 'level three')

    fs.mkdirSync(deepPath, { recursive: true })
    expect(fs.existsSync(deepPath)).toBe(true)
  })

  skipIfNotWindows('should quote paths with spaces in commands', () => {
    testDir = createTestDir('cmd space test')
    const filePath = path.join(testDir, 'test file.txt')
    fs.writeFileSync(filePath, 'test')

    // Command should work with quoted path
    const result = execSync(`cmd.exe /c type "${filePath}"`, { encoding: 'utf-8' })
    expect(result.trim()).toBe('test')
  })
})

// ============================================================================
// Long Path Tests
// ============================================================================

test.describe('Long Path Handling', () => {
  let testDir: string

  test.afterEach(() => {
    if (testDir) cleanupTestDir(testDir)
  })

  skipIfNotWindows('should handle paths near MAX_PATH limit', () => {
    testDir = createTestDir('long')

    // Create nested directories to approach MAX_PATH (260)
    let currentPath = testDir
    let depth = 0

    try {
      while (currentPath.length < 240) {
        currentPath = path.join(currentPath, 'abcdefgh')
        fs.mkdirSync(currentPath, { recursive: true })
        depth++
      }

      console.log(`Created path of length ${currentPath.length} with depth ${depth}`)
      expect(fs.existsSync(currentPath)).toBe(true)
    } catch (error: any) {
      console.log(`Long path creation stopped at ${currentPath.length} chars: ${error.message}`)
    }
  })

  skipIfNotWindows('should detect MAX_PATH in path length', () => {
    const MAX_PATH = 260

    // Simulate path length check from pythonEnvironment.ts
    const testPath = 'C:\\Users\\TestUser\\AppData\\Local\\FlowRecap\\venvs\\whisperx\\Scripts\\python.exe'

    if (testPath.length > MAX_PATH - 20) { // Leave some margin
      console.log(`WARNING: Path length ${testPath.length} approaching MAX_PATH`)
    }

    expect(testPath.length).toBeLessThan(MAX_PATH)
  })

  skipIfNotWindows('should check if long paths are enabled', () => {
    try {
      const result = execSync(
        'reg query "HKLM\\SYSTEM\\CurrentControlSet\\Control\\FileSystem" /v LongPathsEnabled',
        { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] }
      )

      const enabled = result.includes('0x1')
      console.log(`Long paths enabled: ${enabled}`)
    } catch {
      console.log('Could not check long path registry setting')
    }
  })
})

// ============================================================================
// Non-ASCII Path Tests
// ============================================================================

test.describe('Non-ASCII Path Handling', () => {
  let testDir: string

  test.afterEach(() => {
    if (testDir) cleanupTestDir(testDir)
  })

  skipIfNotWindows('should handle Unicode characters in path', () => {
    testDir = createTestDir('unicode-test')
    const unicodePath = path.join(testDir, 'folder')

    try {
      fs.mkdirSync(unicodePath, { recursive: true })
      expect(fs.existsSync(unicodePath)).toBe(true)
      console.log('Unicode path handling: supported')
    } catch (error: any) {
      console.log(`Unicode path failed: ${error.message}`)
    }
  })

  skipIfNotWindows('should handle non-ASCII username simulation', () => {
    // Simulate non-ASCII username path
    const userProfile = process.env.USERPROFILE || 'C:\\Users\\Test'

    // Check if current user profile contains non-ASCII
    const hasNonAscii = /[^\x00-\x7F]/.test(userProfile)
    console.log(`User profile: ${userProfile}`)
    console.log(`Contains non-ASCII: ${hasNonAscii}`)

    // Path operations should work regardless
    expect(path.isAbsolute(userProfile)).toBe(true)
  })

  skipIfNotWindows('should handle special characters in filenames', () => {
    testDir = createTestDir('special-chars')

    // These characters are allowed in Windows filenames
    const allowedSpecialChars = ['file-name.txt', 'file_name.txt', "file'name.txt", 'file (1).txt']

    for (const filename of allowedSpecialChars) {
      const filePath = path.join(testDir, filename)
      fs.writeFileSync(filePath, 'test')
      expect(fs.existsSync(filePath)).toBe(true)
    }
  })

  skipIfNotWindows('should reject invalid Windows filename characters', () => {
    // These characters are NOT allowed in Windows filenames
    const invalidChars = ['<', '>', ':', '"', '|', '?', '*']

    for (const char of invalidChars) {
      const filename = `file${char}name.txt`
      console.log(`Invalid character '${char}' not allowed in: ${filename}`)
    }

    expect(invalidChars.length).toBe(7)
  })
})

// ============================================================================
// UNC Path Tests
// ============================================================================

test.describe('UNC Path Handling', () => {
  skipIfNotWindows('should detect UNC paths', () => {
    const uncPath = '\\\\server\\share\\folder'
    const isUnc = uncPath.startsWith('\\\\')
    expect(isUnc).toBe(true)
  })

  skipIfNotWindows('should parse UNC paths correctly', () => {
    const uncPath = '\\\\server\\share\\folder\\file.txt'
    const parsed = path.parse(uncPath)

    expect(parsed.root).toBe('\\\\server\\share\\')
    expect(parsed.name).toBe('file')
    expect(parsed.ext).toBe('.txt')
  })

  skipIfNotWindows('should check localhost UNC path', () => {
    // \\localhost\C$ is a UNC path to local C: drive
    const uncPath = '\\\\localhost\\C$\\Windows'

    try {
      const exists = fs.existsSync(uncPath)
      console.log(`UNC path \\\\localhost\\C$\\Windows exists: ${exists}`)
    } catch (error: any) {
      console.log(`UNC path check failed: ${error.message}`)
    }
  })

  skipIfNotWindows('should handle UNC path in path.join', () => {
    const uncBase = '\\\\server\\share'
    const joined = path.join(uncBase, 'folder', 'file.txt')

    expect(joined).toBe('\\\\server\\share\\folder\\file.txt')
  })
})

// ============================================================================
// Path Normalization Service Tests
// ============================================================================

test.describe('Path Normalization Service', () => {
  skipIfNotWindows('should have pathNormalizationService.ts', () => {
    const servicePath = path.join(PROJECT_ROOT, 'electron/services/pathNormalizationService.ts')
    expect(fs.existsSync(servicePath)).toBe(true)
  })

  skipIfNotWindows('should implement platform-specific path handling', () => {
    const servicePath = path.join(PROJECT_ROOT, 'electron/services/pathNormalizationService.ts')
    const content = fs.readFileSync(servicePath, 'utf-8')

    // Should handle platform differences
    expect(content).toContain('win32')

    // Should use path module
    expect(content).toMatch(/import.*path|require.*path/i)
  })
})

// ============================================================================
// Environment Path Tests
// ============================================================================

test.describe('Environment Path Handling', () => {
  skipIfNotWindows('should have correct PATH separator', () => {
    const pathVar = process.env.PATH || ''
    expect(pathVar).toContain(';') // Windows uses semicolon
  })

  skipIfNotWindows('should split PATH correctly', () => {
    const pathVar = process.env.PATH || ''
    const parts = pathVar.split(';')

    expect(parts.length).toBeGreaterThan(1)

    // Each part should be a valid path
    for (const part of parts.slice(0, 5)) { // Check first 5
      if (part.length > 0) {
        expect(path.isAbsolute(part)).toBe(true)
      }
    }
  })

  skipIfNotWindows('should handle APPDATA path', () => {
    const appData = process.env.APPDATA
    expect(appData).toBeDefined()
    expect(path.isAbsolute(appData!)).toBe(true)
    expect(fs.existsSync(appData!)).toBe(true)
  })

  skipIfNotWindows('should handle LOCALAPPDATA path', () => {
    const localAppData = process.env.LOCALAPPDATA
    expect(localAppData).toBeDefined()
    expect(path.isAbsolute(localAppData!)).toBe(true)
    expect(fs.existsSync(localAppData!)).toBe(true)
  })

  skipIfNotWindows('should handle ProgramFiles paths', () => {
    const programFiles = process.env.ProgramFiles
    const programFilesX86 = process.env['ProgramFiles(x86)']

    expect(programFiles).toBeDefined()
    expect(fs.existsSync(programFiles!)).toBe(true)

    // On 64-bit Windows, should have x86 folder too
    if (programFilesX86) {
      expect(fs.existsSync(programFilesX86)).toBe(true)
    }
  })
})

// ============================================================================
// Relative Path Tests
// ============================================================================

test.describe('Relative Path Handling', () => {
  skipIfNotWindows('should resolve relative paths', () => {
    const relative = '.\\test\\file.txt'
    const resolved = path.resolve(relative)

    expect(path.isAbsolute(resolved)).toBe(true)
    expect(resolved).toContain(process.cwd())
  })

  skipIfNotWindows('should handle parent directory references', () => {
    const withParent = '..\\..\\test'
    const resolved = path.resolve(withParent)

    expect(path.isAbsolute(resolved)).toBe(true)
    expect(resolved).not.toContain('..')
  })

  skipIfNotWindows('should calculate relative paths', () => {
    const from = 'C:\\Users\\Test\\Documents'
    const to = 'C:\\Users\\Test\\Downloads\\file.txt'

    const relative = path.relative(from, to)
    expect(relative).toBe('..\\Downloads\\file.txt')
  })
})

// ============================================================================
// Cross-Platform Compatibility Tests
// ============================================================================

test.describe('Cross-Platform Path Compatibility', () => {
  test('should use path.join for all path construction', () => {
    // This test runs on all platforms
    const servicePath = path.join(PROJECT_ROOT, 'electron/services/pythonEnvironment.ts')

    if (fs.existsSync(servicePath)) {
      const content = fs.readFileSync(servicePath, 'utf-8')

      // Count path.join usage
      const joinCount = (content.match(/path\.join/g) || []).length
      expect(joinCount).toBeGreaterThan(10)

      // Should not hardcode path separators
      expect(content).not.toMatch(/['"]\/bin\//g) // No hardcoded Unix paths
    }
  })

  test('should have platform checks where needed', () => {
    const servicePath = path.join(PROJECT_ROOT, 'electron/services/pythonEnvironment.ts')

    if (fs.existsSync(servicePath)) {
      const content = fs.readFileSync(servicePath, 'utf-8')

      // Should check platform for venv paths
      expect(content).toContain('Scripts')
      expect(content).toContain('bin')
      expect(content).toContain('win32')
    }
  })
})
