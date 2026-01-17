/**
 * Binary Manager Service
 *
 * Manages platform-specific audio processing binaries (sox, ffmpeg) bundled with the application.
 * Provides fallback detection: tries bundled binary first, then system PATH.
 * Handles binary permissions (chmod +x) on macOS/Linux.
 * Implements binary verification via SHA256 checksums.
 */

import { app } from 'electron'
import * as path from 'path'
import * as fs from 'fs'
import * as crypto from 'crypto'
import { exec, spawn, ChildProcess, execSync } from 'child_process'
import { promisify } from 'util'

const execAsync = promisify(exec)

// ============================================================================
// Types
// ============================================================================

export type BinaryName = 'sox' | 'ffmpeg' | 'ffprobe' | 'soxi'

export interface BinaryInfo {
  name: BinaryName
  path: string
  version: string | null
  source: 'bundled' | 'system' | 'none'
  verified: boolean
  error?: string
}

export interface BinaryChecksum {
  platform: NodeJS.Platform
  arch: string
  binary: BinaryName
  sha256: string
  filename: string
}

export interface BinaryManagerConfig {
  verifyChecksums: boolean
  preferBundled: boolean
  autoSetPermissions: boolean
}

// ============================================================================
// Constants
// ============================================================================

const DEFAULT_CONFIG: BinaryManagerConfig = {
  verifyChecksums: true,
  preferBundled: true,
  autoSetPermissions: true
}

/**
 * Expected checksums for bundled binaries.
 * These should be updated when new binary versions are bundled.
 *
 * To generate checksums:
 *   macOS/Linux: shasum -a 256 <filename>
 *   Windows: certutil -hashfile <filename> SHA256
 */
const BINARY_CHECKSUMS: BinaryChecksum[] = [
  // macOS ARM64 (Apple Silicon)
  {
    platform: 'darwin',
    arch: 'arm64',
    binary: 'sox',
    sha256: 'PLACEHOLDER_SOX_MACOS_ARM64',
    filename: 'sox'
  },
  {
    platform: 'darwin',
    arch: 'arm64',
    binary: 'ffmpeg',
    sha256: 'PLACEHOLDER_FFMPEG_MACOS_ARM64',
    filename: 'ffmpeg'
  },
  {
    platform: 'darwin',
    arch: 'arm64',
    binary: 'ffprobe',
    sha256: 'PLACEHOLDER_FFPROBE_MACOS_ARM64',
    filename: 'ffprobe'
  },
  // macOS x64 (Intel)
  {
    platform: 'darwin',
    arch: 'x64',
    binary: 'sox',
    sha256: 'PLACEHOLDER_SOX_MACOS_X64',
    filename: 'sox'
  },
  {
    platform: 'darwin',
    arch: 'x64',
    binary: 'ffmpeg',
    sha256: 'PLACEHOLDER_FFMPEG_MACOS_X64',
    filename: 'ffmpeg'
  },
  {
    platform: 'darwin',
    arch: 'x64',
    binary: 'ffprobe',
    sha256: 'PLACEHOLDER_FFPROBE_MACOS_X64',
    filename: 'ffprobe'
  },
  // Windows x64
  {
    platform: 'win32',
    arch: 'x64',
    binary: 'sox',
    sha256: 'PLACEHOLDER_SOX_WIN_X64',
    filename: 'sox.exe'
  },
  {
    platform: 'win32',
    arch: 'x64',
    binary: 'ffmpeg',
    sha256: 'PLACEHOLDER_FFMPEG_WIN_X64',
    filename: 'ffmpeg.exe'
  },
  {
    platform: 'win32',
    arch: 'x64',
    binary: 'ffprobe',
    sha256: 'PLACEHOLDER_FFPROBE_WIN_X64',
    filename: 'ffprobe.exe'
  },
  // Linux x64
  {
    platform: 'linux',
    arch: 'x64',
    binary: 'sox',
    sha256: 'PLACEHOLDER_SOX_LINUX_X64',
    filename: 'sox'
  },
  {
    platform: 'linux',
    arch: 'x64',
    binary: 'ffmpeg',
    sha256: 'PLACEHOLDER_FFMPEG_LINUX_X64',
    filename: 'ffmpeg'
  },
  {
    platform: 'linux',
    arch: 'x64',
    binary: 'ffprobe',
    sha256: 'PLACEHOLDER_FFPROBE_LINUX_X64',
    filename: 'ffprobe'
  }
]

// ============================================================================
// State
// ============================================================================

let config: BinaryManagerConfig = { ...DEFAULT_CONFIG }
let binaryCache: Map<BinaryName, BinaryInfo> = new Map()
let initialized = false

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Get the resources directory path based on whether we're in development or production
 */
function getResourcesPath(): string {
  if (app.isPackaged) {
    // In production, resources are in the app's resources directory
    return path.join(process.resourcesPath, 'resources')
  } else {
    // In development, resources are in the project root
    return path.join(app.getAppPath(), 'resources')
  }
}

/**
 * Get the path to the binaries directory for the current platform
 */
function getBinariesPath(): string {
  const platform = process.platform
  const arch = process.arch

  // Normalize arch names
  let archDir: string
  if (arch === 'arm64') {
    archDir = 'arm64'
  } else if (arch === 'x64' || arch === 'x86_64') {
    archDir = 'x64'
  } else if (arch === 'ia32' || arch === 'x86') {
    archDir = 'ia32'
  } else {
    archDir = arch
  }

  // Platform-specific directory naming
  let platformDir: string
  switch (platform) {
    case 'darwin':
      platformDir = 'macos'
      break
    case 'win32':
      platformDir = 'windows'
      break
    case 'linux':
      platformDir = 'linux'
      break
    default:
      platformDir = platform
  }

  return path.join(getResourcesPath(), 'binaries', platformDir, archDir)
}

/**
 * Get the filename for a binary on the current platform
 */
function getBinaryFilename(binary: BinaryName): string {
  const extension = process.platform === 'win32' ? '.exe' : ''
  return `${binary}${extension}`
}

/**
 * Calculate SHA256 checksum of a file
 */
async function calculateChecksum(filePath: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha256')
    const stream = fs.createReadStream(filePath)

    stream.on('data', (data) => hash.update(data))
    stream.on('end', () => resolve(hash.digest('hex')))
    stream.on('error', (err) => reject(err))
  })
}

/**
 * Verify a binary's checksum against expected value
 */
async function verifyBinaryChecksum(binaryPath: string, binary: BinaryName): Promise<boolean> {
  try {
    const platform = process.platform
    const arch = process.arch

    // Find expected checksum
    const expectedChecksum = BINARY_CHECKSUMS.find(
      c => c.platform === platform && c.arch === arch && c.binary === binary
    )

    if (!expectedChecksum) {
      console.warn(`[BinaryManager] No checksum defined for ${binary} on ${platform}/${arch}`)
      // If no checksum is defined, consider it valid (for development)
      return true
    }

    // Skip verification for placeholder checksums (during development)
    if (expectedChecksum.sha256.startsWith('PLACEHOLDER_')) {
      console.log(`[BinaryManager] Skipping checksum verification for ${binary} (placeholder checksum)`)
      return true
    }

    const actualChecksum = await calculateChecksum(binaryPath)
    const isValid = actualChecksum.toLowerCase() === expectedChecksum.sha256.toLowerCase()

    if (!isValid) {
      console.error(`[BinaryManager] Checksum mismatch for ${binary}:`)
      console.error(`  Expected: ${expectedChecksum.sha256}`)
      console.error(`  Actual:   ${actualChecksum}`)
    }

    return isValid
  } catch (error) {
    console.error(`[BinaryManager] Error verifying checksum for ${binary}:`, error)
    return false
  }
}

/**
 * Set executable permissions on a binary (macOS/Linux only)
 */
async function setExecutablePermissions(binaryPath: string): Promise<boolean> {
  if (process.platform === 'win32') {
    return true // Windows doesn't need chmod
  }

  try {
    // Check if already executable
    try {
      fs.accessSync(binaryPath, fs.constants.X_OK)
      return true // Already executable
    } catch {
      // Not executable, need to set permissions
    }

    // Set executable permissions (chmod +x)
    fs.chmodSync(binaryPath, 0o755)
    console.log(`[BinaryManager] Set executable permissions on ${binaryPath}`)
    return true
  } catch (error) {
    console.error(`[BinaryManager] Failed to set executable permissions on ${binaryPath}:`, error)
    return false
  }
}

/**
 * Check if a binary exists and is executable
 */
function isBinaryAccessible(binaryPath: string): boolean {
  try {
    fs.accessSync(binaryPath, fs.constants.F_OK)
    if (process.platform !== 'win32') {
      fs.accessSync(binaryPath, fs.constants.X_OK)
    }
    return true
  } catch {
    return false
  }
}

/**
 * Get version string from a binary
 */
async function getBinaryVersion(binaryPath: string, binary: BinaryName): Promise<string | null> {
  try {
    let versionCmd: string

    switch (binary) {
      case 'sox':
      case 'soxi':
        versionCmd = `"${binaryPath}" --version`
        break
      case 'ffmpeg':
      case 'ffprobe':
        versionCmd = `"${binaryPath}" -version`
        break
      default:
        versionCmd = `"${binaryPath}" --version`
    }

    const { stdout } = await execAsync(versionCmd, { timeout: 5000 })

    // Extract version number from output
    const versionMatch = stdout.match(/(\d+\.\d+(?:\.\d+)?(?:[.-]\w+)?)/)?.[1]
    return versionMatch || stdout.trim().split('\n')[0]
  } catch {
    return null
  }
}

/**
 * Check if a binary exists on the system PATH
 */
async function findSystemBinary(binary: BinaryName): Promise<string | null> {
  try {
    const checkCmd = process.platform === 'win32' ? `where ${binary}` : `which ${binary}`
    const { stdout } = await execAsync(checkCmd, { timeout: 5000 })
    const binaryPath = stdout.trim().split('\n')[0]

    if (binaryPath && fs.existsSync(binaryPath)) {
      return binaryPath
    }
    return null
  } catch {
    return null
  }
}

// ============================================================================
// Binary Manager Service
// ============================================================================

export const binaryManager = {
  /**
   * Initialize the binary manager
   * Discovers and validates all bundled binaries
   */
  async initialize(userConfig?: Partial<BinaryManagerConfig>): Promise<void> {
    if (initialized) {
      return
    }

    // Merge user config with defaults
    config = { ...DEFAULT_CONFIG, ...userConfig }

    console.log('[BinaryManager] Initializing...')
    console.log(`[BinaryManager] Platform: ${process.platform}, Arch: ${process.arch}`)
    console.log(`[BinaryManager] Binaries path: ${getBinariesPath()}`)

    // Discover and validate binaries
    const binaries: BinaryName[] = ['sox', 'ffmpeg', 'ffprobe']

    for (const binary of binaries) {
      await this.resolveBinary(binary)
    }

    initialized = true
    console.log('[BinaryManager] Initialization complete')
  },

  /**
   * Get configuration
   */
  getConfig(): BinaryManagerConfig {
    return { ...config }
  },

  /**
   * Update configuration
   */
  setConfig(userConfig: Partial<BinaryManagerConfig>): void {
    config = { ...config, ...userConfig }
  },

  /**
   * Resolve the path to a binary, checking bundled first, then system PATH
   */
  async resolveBinary(binary: BinaryName): Promise<BinaryInfo> {
    // Check cache first
    const cached = binaryCache.get(binary)
    if (cached) {
      return cached
    }

    let info: BinaryInfo = {
      name: binary,
      path: '',
      version: null,
      source: 'none',
      verified: false
    }

    // Try bundled binary first (if configured)
    if (config.preferBundled) {
      const bundledInfo = await this.checkBundledBinary(binary)
      if (bundledInfo.source === 'bundled') {
        info = bundledInfo
      }
    }

    // Fall back to system PATH if bundled not found or not preferred
    if (info.source === 'none') {
      const systemPath = await findSystemBinary(binary)
      if (systemPath) {
        info = {
          name: binary,
          path: systemPath,
          version: await getBinaryVersion(systemPath, binary),
          source: 'system',
          verified: true // System binaries are trusted
        }
        console.log(`[BinaryManager] Using system ${binary}: ${systemPath}`)
      }
    }

    // If still not found and we didn't check bundled, try bundled
    if (info.source === 'none' && !config.preferBundled) {
      const bundledInfo = await this.checkBundledBinary(binary)
      if (bundledInfo.source === 'bundled') {
        info = bundledInfo
      }
    }

    // Cache the result
    binaryCache.set(binary, info)

    if (info.source === 'none') {
      console.warn(`[BinaryManager] ${binary} not found (bundled or system)`)
    }

    return info
  },

  /**
   * Check for bundled binary and validate it
   */
  async checkBundledBinary(binary: BinaryName): Promise<BinaryInfo> {
    const filename = getBinaryFilename(binary)
    const bundledPath = path.join(getBinariesPath(), filename)

    const info: BinaryInfo = {
      name: binary,
      path: bundledPath,
      version: null,
      source: 'none',
      verified: false
    }

    // Check if file exists
    if (!fs.existsSync(bundledPath)) {
      info.error = `Bundled binary not found: ${bundledPath}`
      return info
    }

    // Set executable permissions if needed
    if (config.autoSetPermissions) {
      const permissionsSet = await setExecutablePermissions(bundledPath)
      if (!permissionsSet) {
        info.error = `Failed to set executable permissions on ${bundledPath}`
        return info
      }
    }

    // Verify accessibility
    if (!isBinaryAccessible(bundledPath)) {
      info.error = `Binary not accessible: ${bundledPath}`
      return info
    }

    // Verify checksum if configured
    if (config.verifyChecksums) {
      const verified = await verifyBinaryChecksum(bundledPath, binary)
      if (!verified) {
        info.error = `Checksum verification failed for ${binary}`
        info.verified = false
        // Still allow use but mark as unverified
        console.warn(`[BinaryManager] WARNING: Using unverified binary ${binary}`)
      } else {
        info.verified = true
      }
    } else {
      info.verified = true // Skip verification
    }

    // Get version
    info.version = await getBinaryVersion(bundledPath, binary)
    info.source = 'bundled'

    console.log(`[BinaryManager] Found bundled ${binary}: ${bundledPath} (v${info.version || 'unknown'})`)
    return info
  },

  /**
   * Get the path to a binary (returns system binary if bundled not available)
   * This is the main method to use when spawning processes
   */
  async getBinaryPath(binary: BinaryName): Promise<string | null> {
    const info = await this.resolveBinary(binary)
    return info.source !== 'none' ? info.path : null
  },

  /**
   * Get info about all binaries
   */
  async getAllBinaryInfo(): Promise<Map<BinaryName, BinaryInfo>> {
    const binaries: BinaryName[] = ['sox', 'ffmpeg', 'ffprobe']

    for (const binary of binaries) {
      if (!binaryCache.has(binary)) {
        await this.resolveBinary(binary)
      }
    }

    return new Map(binaryCache)
  },

  /**
   * Check if a specific binary is available (bundled or system)
   */
  async isBinaryAvailable(binary: BinaryName): Promise<boolean> {
    const info = await this.resolveBinary(binary)
    return info.source !== 'none'
  },

  /**
   * Spawn a binary process with the resolved path
   * Automatically uses bundled binary if available
   */
  async spawnBinary(
    binary: BinaryName,
    args: string[],
    options?: { timeout?: number; cwd?: string }
  ): Promise<ChildProcess> {
    const binaryPath = await this.getBinaryPath(binary)

    if (!binaryPath) {
      throw new Error(`Binary ${binary} not found. Please install ${binary} or ensure bundled binaries are present.`)
    }

    const spawnOptions: any = {}
    if (options?.cwd) {
      spawnOptions.cwd = options.cwd
    }

    return spawn(binaryPath, args, spawnOptions)
  },

  /**
   * Execute a binary and return the output
   */
  async execBinary(
    binary: BinaryName,
    args: string[],
    options?: { timeout?: number; cwd?: string }
  ): Promise<{ stdout: string; stderr: string }> {
    const binaryPath = await this.getBinaryPath(binary)

    if (!binaryPath) {
      throw new Error(`Binary ${binary} not found. Please install ${binary} or ensure bundled binaries are present.`)
    }

    const command = `"${binaryPath}" ${args.join(' ')}`
    return execAsync(command, {
      timeout: options?.timeout || 30000,
      cwd: options?.cwd
    })
  },

  /**
   * Clear the binary cache (useful for re-scanning)
   */
  clearCache(): void {
    binaryCache.clear()
    initialized = false
  },

  /**
   * Get diagnostic information about binary availability
   */
  async getDiagnostics(): Promise<{
    platform: NodeJS.Platform
    arch: string
    binariesPath: string
    binariesPathExists: boolean
    binaries: BinaryInfo[]
    recommendations: string[]
  }> {
    const binariesPath = getBinariesPath()
    const binaries = await this.getAllBinaryInfo()
    const recommendations: string[] = []

    // Check for missing binaries
    for (const [name, info] of binaries) {
      if (info.source === 'none') {
        if (process.platform === 'darwin') {
          recommendations.push(`Install ${name} via Homebrew: brew install ${name}`)
        } else if (process.platform === 'win32') {
          if (name === 'sox') {
            recommendations.push(`Download Sox from https://sox.sourceforge.net/`)
          } else if (name === 'ffmpeg' || name === 'ffprobe') {
            recommendations.push(`Download FFmpeg from https://ffmpeg.org/download.html`)
          }
        } else if (process.platform === 'linux') {
          recommendations.push(`Install ${name} via package manager: sudo apt install ${name}`)
        }
      }
    }

    // Check if binaries directory exists
    const binariesPathExists = fs.existsSync(binariesPath)
    if (!binariesPathExists) {
      recommendations.push(`Binaries directory not found: ${binariesPath}`)
    }

    return {
      platform: process.platform,
      arch: process.arch,
      binariesPath,
      binariesPathExists,
      binaries: Array.from(binaries.values()),
      recommendations
    }
  },

  /**
   * Get the binaries directory path (exposed for external use)
   */
  getBinariesPath(): string {
    return getBinariesPath()
  },

  /**
   * Get the resources directory path (exposed for external use)
   */
  getResourcesPath(): string {
    return getResourcesPath()
  }
}

// Export types for external use
export type { BinaryManagerConfig, BinaryInfo, BinaryName }
