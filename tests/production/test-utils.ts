/**
 * Production Build Test Utilities
 *
 * Shared utilities for testing production builds of the FlowRecap Electron app.
 * Provides helpers for:
 * - Launching packaged Electron apps
 * - Verifying app startup and basic functionality
 * - Platform-specific test helpers
 * - Performance measurement utilities
 */

import { spawn, ChildProcess, execSync } from 'child_process'
import * as path from 'path'
import * as fs from 'fs'
import * as os from 'os'

// ============================================================================
// Types
// ============================================================================

export interface AppStartResult {
  success: boolean
  startupTime: number  // milliseconds
  memoryUsage?: number // MB
  error?: string
  pid?: number
}

export interface InstallerInfo {
  path: string
  platform: NodeJS.Platform
  arch: string
  type: 'dmg' | 'exe' | 'AppImage' | 'deb' | 'rpm' | 'snap' | 'zip' | 'portable'
  size: number // bytes
}

export interface BuildArtifact {
  name: string
  path: string
  size: number
  exists: boolean
}

export interface PlatformTestConfig {
  platform: NodeJS.Platform
  installerTypes: string[]
  appExecutableName: string
  appBundlePath?: string
}

// ============================================================================
// Constants
// ============================================================================

export const PROJECT_ROOT = path.resolve(__dirname, '../..')
export const RELEASE_DIR = path.join(PROJECT_ROOT, 'release')

export const PLATFORM_CONFIGS: Record<NodeJS.Platform, PlatformTestConfig> = {
  darwin: {
    platform: 'darwin',
    installerTypes: ['dmg', 'zip'],
    appExecutableName: 'FlowRecap.app',
    appBundlePath: '/Applications/FlowRecap.app/Contents/MacOS/FlowRecap'
  },
  win32: {
    platform: 'win32',
    installerTypes: ['exe', 'zip', 'portable'],
    appExecutableName: 'FlowRecap.exe'
  },
  linux: {
    platform: 'linux',
    installerTypes: ['AppImage', 'deb', 'rpm', 'snap'],
    appExecutableName: 'flowrecap'
  },
  // Placeholder for other platforms
  aix: { platform: 'aix', installerTypes: [], appExecutableName: '' },
  android: { platform: 'android', installerTypes: [], appExecutableName: '' },
  freebsd: { platform: 'freebsd', installerTypes: [], appExecutableName: '' },
  haiku: { platform: 'haiku', installerTypes: [], appExecutableName: '' },
  openbsd: { platform: 'openbsd', installerTypes: [], appExecutableName: '' },
  sunos: { platform: 'sunos', installerTypes: [], appExecutableName: '' },
  cygwin: { platform: 'cygwin', installerTypes: [], appExecutableName: '' },
  netbsd: { platform: 'netbsd', installerTypes: [], appExecutableName: '' }
}

// ============================================================================
// Build Artifact Discovery
// ============================================================================

/**
 * Find all build artifacts in the release directory
 */
export function findBuildArtifacts(): BuildArtifact[] {
  const artifacts: BuildArtifact[] = []

  if (!fs.existsSync(RELEASE_DIR)) {
    return artifacts
  }

  // Walk through release directory looking for artifacts
  const walkDir = (dir: string) => {
    const files = fs.readdirSync(dir)
    for (const file of files) {
      const filePath = path.join(dir, file)
      const stat = fs.statSync(filePath)

      if (stat.isDirectory()) {
        walkDir(filePath)
      } else if (isArtifact(file)) {
        artifacts.push({
          name: file,
          path: filePath,
          size: stat.size,
          exists: true
        })
      }
    }
  }

  walkDir(RELEASE_DIR)
  return artifacts
}

/**
 * Check if a file is a build artifact
 */
function isArtifact(filename: string): boolean {
  const artifactExtensions = [
    '.dmg', '.pkg', '.zip', '.exe', '.msi',
    '.AppImage', '.deb', '.rpm', '.snap', '.tar.gz'
  ]
  return artifactExtensions.some(ext => filename.endsWith(ext))
}

/**
 * Get installer info for a specific artifact
 */
export function getInstallerInfo(artifactPath: string): InstallerInfo | null {
  if (!fs.existsSync(artifactPath)) {
    return null
  }

  const stat = fs.statSync(artifactPath)
  const filename = path.basename(artifactPath)

  let type: InstallerInfo['type'] = 'zip'
  let platform: NodeJS.Platform = 'linux'

  if (filename.endsWith('.dmg')) {
    type = 'dmg'
    platform = 'darwin'
  } else if (filename.endsWith('.exe')) {
    type = filename.includes('portable') ? 'portable' : 'exe'
    platform = 'win32'
  } else if (filename.endsWith('.AppImage')) {
    type = 'AppImage'
    platform = 'linux'
  } else if (filename.endsWith('.deb')) {
    type = 'deb'
    platform = 'linux'
  } else if (filename.endsWith('.rpm')) {
    type = 'rpm'
    platform = 'linux'
  } else if (filename.endsWith('.snap')) {
    type = 'snap'
    platform = 'linux'
  }

  // Detect architecture from filename
  let arch = 'x64'
  if (filename.includes('arm64') || filename.includes('aarch64')) {
    arch = 'arm64'
  } else if (filename.includes('ia32') || filename.includes('x86')) {
    arch = 'ia32'
  }

  return {
    path: artifactPath,
    platform,
    arch,
    type,
    size: stat.size
  }
}

// ============================================================================
// App Launch Utilities
// ============================================================================

/**
 * Launch the development version of the app for testing
 */
export async function launchDevApp(): Promise<{ process: ChildProcess; startupTime: number }> {
  const startTime = Date.now()

  return new Promise((resolve, reject) => {
    const electronPath = path.join(PROJECT_ROOT, 'node_modules/.bin/electron')
    const mainPath = path.join(PROJECT_ROOT, 'dist-electron/main.js')

    // Check if built files exist
    if (!fs.existsSync(mainPath)) {
      reject(new Error('Built files not found. Run "npm run build:vite" first.'))
      return
    }

    const child = spawn(electronPath, [mainPath], {
      cwd: PROJECT_ROOT,
      env: {
        ...process.env,
        ELECTRON_IS_DEV: '0',
        NODE_ENV: 'production'
      },
      stdio: ['pipe', 'pipe', 'pipe']
    })

    // Set a timeout for app to start
    const timeout = setTimeout(() => {
      child.kill()
      reject(new Error('App startup timed out after 30 seconds'))
    }, 30000)

    child.on('error', (err) => {
      clearTimeout(timeout)
      reject(err)
    })

    // Wait a bit for the app to initialize
    setTimeout(() => {
      clearTimeout(timeout)
      resolve({
        process: child,
        startupTime: Date.now() - startTime
      })
    }, 5000)
  })
}

/**
 * Launch a packaged app (macOS .app bundle)
 */
export async function launchPackagedApp(appPath: string): Promise<AppStartResult> {
  const startTime = Date.now()

  return new Promise((resolve) => {
    try {
      if (!fs.existsSync(appPath)) {
        resolve({
          success: false,
          startupTime: 0,
          error: `App not found at: ${appPath}`
        })
        return
      }

      let child: ChildProcess

      if (process.platform === 'darwin') {
        // macOS: Use open command or launch .app directly
        if (appPath.endsWith('.app')) {
          const executablePath = path.join(appPath, 'Contents/MacOS/FlowRecap')
          child = spawn(executablePath, [], {
            detached: true,
            stdio: 'ignore'
          })
        } else {
          child = spawn('open', [appPath], {
            detached: true,
            stdio: 'ignore'
          })
        }
      } else if (process.platform === 'win32') {
        child = spawn(appPath, [], {
          detached: true,
          stdio: 'ignore'
        })
      } else {
        // Linux: AppImage or other executable
        child = spawn(appPath, [], {
          detached: true,
          stdio: 'ignore'
        })
      }

      child.on('error', (err) => {
        resolve({
          success: false,
          startupTime: Date.now() - startTime,
          error: err.message
        })
      })

      // Give app time to start
      setTimeout(() => {
        resolve({
          success: true,
          startupTime: Date.now() - startTime,
          pid: child.pid
        })
      }, 5000)

    } catch (err) {
      resolve({
        success: false,
        startupTime: Date.now() - startTime,
        error: err instanceof Error ? err.message : 'Unknown error'
      })
    }
  })
}

// ============================================================================
// Performance Measurement
// ============================================================================

/**
 * Get memory usage for a process
 */
export function getProcessMemory(pid: number): number | null {
  try {
    if (process.platform === 'darwin' || process.platform === 'linux') {
      const output = execSync(`ps -o rss= -p ${pid}`).toString().trim()
      return parseInt(output) / 1024 // Convert KB to MB
    } else if (process.platform === 'win32') {
      const output = execSync(`wmic process where ProcessId=${pid} get WorkingSetSize`)
        .toString()
        .trim()
        .split('\n')[1]
      return parseInt(output) / (1024 * 1024) // Convert bytes to MB
    }
  } catch {
    return null
  }
  return null
}

/**
 * Measure app startup time
 */
export async function measureStartupTime(launchFn: () => Promise<ChildProcess>): Promise<number> {
  const startTime = Date.now()
  const process = await launchFn()

  return new Promise((resolve) => {
    // Wait for process to stabilize
    setTimeout(() => {
      const elapsed = Date.now() - startTime
      process.kill()
      resolve(elapsed)
    }, 5000)
  })
}

// ============================================================================
// Verification Helpers
// ============================================================================

/**
 * Check if required dependencies are available
 */
export function checkDependencies(): { name: string; available: boolean }[] {
  const dependencies = [
    { name: 'node', cmd: 'node --version' },
    { name: 'npm', cmd: 'npm --version' },
    { name: 'electron', cmd: 'npx electron --version' }
  ]

  return dependencies.map(dep => {
    try {
      execSync(dep.cmd, { stdio: 'pipe' })
      return { name: dep.name, available: true }
    } catch {
      return { name: dep.name, available: false }
    }
  })
}

/**
 * Verify that a built app bundle contains expected files
 */
export function verifyAppBundle(appPath: string): { valid: boolean; missing: string[] } {
  const missing: string[] = []

  if (process.platform === 'darwin') {
    const expectedPaths = [
      'Contents/MacOS/FlowRecap',
      'Contents/Resources/app.asar',
      'Contents/Info.plist'
    ]

    for (const expected of expectedPaths) {
      const fullPath = path.join(appPath, expected)
      if (!fs.existsSync(fullPath)) {
        missing.push(expected)
      }
    }
  }

  return {
    valid: missing.length === 0,
    missing
  }
}

/**
 * Get package version from package.json
 */
export function getPackageVersion(): string {
  const packagePath = path.join(PROJECT_ROOT, 'package.json')
  const packageJson = JSON.parse(fs.readFileSync(packagePath, 'utf-8'))
  return packageJson.version
}

// ============================================================================
// Test Result Types
// ============================================================================

export interface ProductionTestResult {
  name: string
  passed: boolean
  duration: number
  error?: string
  details?: Record<string, unknown>
}

export interface TestSuiteResult {
  name: string
  timestamp: string
  platform: NodeJS.Platform
  arch: string
  results: ProductionTestResult[]
  summary: {
    total: number
    passed: number
    failed: number
    duration: number
  }
}

/**
 * Format test results for CI output
 */
export function formatTestResults(results: TestSuiteResult): string {
  const lines: string[] = []

  lines.push(`# ${results.name}`)
  lines.push(`Platform: ${results.platform} (${results.arch})`)
  lines.push(`Timestamp: ${results.timestamp}`)
  lines.push('')
  lines.push(`## Results: ${results.summary.passed}/${results.summary.total} passed`)
  lines.push('')

  for (const result of results.results) {
    const status = result.passed ? '✅' : '❌'
    lines.push(`${status} ${result.name} (${result.duration}ms)`)
    if (result.error) {
      lines.push(`   Error: ${result.error}`)
    }
  }

  return lines.join('\n')
}
