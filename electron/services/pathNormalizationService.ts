/**
 * Path Normalization Service
 *
 * Centralized service for handling cross-platform file path normalization,
 * validation, and conversion. This service ensures consistent path handling
 * across Windows, macOS, and Linux.
 *
 * Features:
 * - Automatic path separator conversion (backslash to forward slash)
 * - Windows drive letter handling (C:\ prefix)
 * - UNC path support (\\server\share)
 * - MAX_PATH workaround (\\?\ prefix for paths >260 chars on Windows)
 * - Path validation (illegal characters, reserved names like CON, PRN)
 * - Consistent path joining using path.join() or path.resolve()
 * - Database path storage normalization (store as Unix-style, convert on Windows reads)
 *
 * Usage:
 *   import { pathNormalizationService } from './pathNormalizationService'
 *
 *   // Normalize a path for storage
 *   const normalized = pathNormalizationService.normalizeForStorage(windowsPath)
 *
 *   // Convert stored path to platform-specific format
 *   const platformPath = pathNormalizationService.toPlatformPath(storedPath)
 *
 *   // Validate a path
 *   const validation = pathNormalizationService.validatePath(userPath)
 *
 *   // Join paths safely
 *   const fullPath = pathNormalizationService.joinPaths(baseDir, 'subfolder', 'file.txt')
 */

import * as path from 'path'
import * as fs from 'fs'

// ============================================================================
// Types
// ============================================================================

export interface PathValidationResult {
  /** Whether the path is valid */
  valid: boolean
  /** Original path that was validated */
  originalPath: string
  /** Normalized path (if valid) */
  normalizedPath: string | null
  /** List of validation errors */
  errors: string[]
  /** List of warnings (path is valid but has issues) */
  warnings: string[]
  /** Whether the path contains non-ASCII characters */
  hasNonAscii: boolean
  /** Whether the path contains spaces */
  hasSpaces: boolean
  /** Whether this is a UNC path */
  isUncPath: boolean
  /** Whether this path exceeds MAX_PATH (260 chars) */
  exceedsMaxPath: boolean
  /** Windows drive letter if present (e.g., 'C') */
  driveLetter: string | null
}

export interface PathComponents {
  /** Root of the path (e.g., '/', 'C:\\', '\\\\server\\share') */
  root: string
  /** Directory portion without filename */
  dir: string
  /** Base filename with extension */
  base: string
  /** Filename without extension */
  name: string
  /** File extension including dot */
  ext: string
  /** Whether this is an absolute path */
  isAbsolute: boolean
  /** Whether this is a UNC path */
  isUncPath: boolean
  /** Windows drive letter if present */
  driveLetter: string | null
  /** Path segments (directories) */
  segments: string[]
}

export type PathStyle = 'unix' | 'windows' | 'auto'

export interface PathNormalizationOptions {
  /** Whether to resolve relative paths to absolute */
  resolveRelative?: boolean
  /** Base directory for resolving relative paths */
  basePath?: string
  /** Whether to normalize case (lowercase on Windows) */
  normalizeCase?: boolean
  /** Whether to resolve symlinks */
  resolveSymlinks?: boolean
  /** Whether to add long path prefix on Windows for paths > 260 chars */
  handleLongPaths?: boolean
}

// ============================================================================
// Constants
// ============================================================================

/** Windows MAX_PATH limit */
const WINDOWS_MAX_PATH = 260

/** Windows long path prefix */
const WINDOWS_LONG_PATH_PREFIX = '\\\\?\\'

/** Windows UNC long path prefix */
const WINDOWS_UNC_LONG_PATH_PREFIX = '\\\\?\\UNC\\'

/** Reserved Windows device names (case-insensitive) */
const WINDOWS_RESERVED_NAMES = [
  'CON', 'PRN', 'AUX', 'NUL',
  'COM1', 'COM2', 'COM3', 'COM4', 'COM5', 'COM6', 'COM7', 'COM8', 'COM9',
  'LPT1', 'LPT2', 'LPT3', 'LPT4', 'LPT5', 'LPT6', 'LPT7', 'LPT8', 'LPT9'
]

/** Characters illegal in Windows filenames */
const WINDOWS_ILLEGAL_CHARS = /[<>:"|?*\x00-\x1f]/g

/** Characters illegal in Unix filenames (only null and slash) */
const UNIX_ILLEGAL_CHARS = /[\x00]/g

/** Regex to match Windows drive letter */
const WINDOWS_DRIVE_LETTER_REGEX = /^([a-zA-Z]):[\\\/]/

/** Regex to match UNC path */
const UNC_PATH_REGEX = /^[\\\/]{2}[^\\\/]+[\\\/]+[^\\\/]+/

/** Regex to match already-prefixed long paths */
const LONG_PATH_PREFIX_REGEX = /^\\\\\?\\/

// ============================================================================
// Path Normalization Service
// ============================================================================

class PathNormalizationService {
  private isWindows: boolean

  constructor() {
    this.isWindows = process.platform === 'win32'
  }

  // ==========================================================================
  // Core Normalization Methods
  // ==========================================================================

  /**
   * Normalize a path for database storage (Unix-style forward slashes)
   * This ensures consistent storage regardless of the operating system
   *
   * @param inputPath - The path to normalize
   * @returns Normalized path with forward slashes
   */
  normalizeForStorage(inputPath: string): string {
    if (!inputPath) return ''

    // First, normalize using Node's path module
    let normalized = path.normalize(inputPath)

    // Handle Windows long path prefix - remove it for storage
    if (normalized.startsWith(WINDOWS_LONG_PATH_PREFIX)) {
      normalized = normalized.slice(WINDOWS_LONG_PATH_PREFIX.length)
    }
    if (normalized.startsWith(WINDOWS_UNC_LONG_PATH_PREFIX)) {
      normalized = '\\\\' + normalized.slice(WINDOWS_UNC_LONG_PATH_PREFIX.length)
    }

    // Convert all backslashes to forward slashes
    normalized = normalized.replace(/\\/g, '/')

    // Handle Windows drive letters - keep the colon but use forward slash
    // e.g., C:\Users -> C:/Users
    const driveMatch = normalized.match(/^([a-zA-Z]):\//)
    if (driveMatch) {
      // Drive letter paths are preserved as-is with forward slashes
      // e.g., C:/Users/folder
    }

    // Handle UNC paths - convert \\ to // for storage
    // \\server\share -> //server/share
    if (normalized.startsWith('//')) {
      // Already in Unix-style UNC format
    }

    // Remove trailing slashes (except for root paths)
    if (normalized.length > 1 && normalized.endsWith('/')) {
      normalized = normalized.slice(0, -1)
    }

    // Clean up double slashes (except at the start for UNC)
    if (normalized.startsWith('//')) {
      // UNC path - preserve the leading //
      normalized = '//' + normalized.slice(2).replace(/\/+/g, '/')
    } else {
      normalized = normalized.replace(/\/+/g, '/')
    }

    return normalized
  }

  /**
   * Convert a stored path to the platform-specific format
   *
   * @param storedPath - Path from database (Unix-style)
   * @returns Platform-specific path
   */
  toPlatformPath(storedPath: string): string {
    if (!storedPath) return ''

    if (this.isWindows) {
      // Convert forward slashes to backslashes
      let platformPath = storedPath.replace(/\//g, '\\')

      // Handle UNC paths stored as //server/share
      if (platformPath.startsWith('\\\\')) {
        // Already correct for Windows UNC
      }

      return platformPath
    }

    // Unix systems - path is already correct
    return storedPath
  }

  /**
   * Normalize a path for the current platform
   *
   * @param inputPath - The path to normalize
   * @param options - Normalization options
   * @returns Normalized platform path
   */
  normalizePath(inputPath: string, options: PathNormalizationOptions = {}): string {
    if (!inputPath) return ''

    const {
      resolveRelative = false,
      basePath = process.cwd(),
      normalizeCase = false,
      resolveSymlinks = false,
      handleLongPaths = true
    } = options

    let normalized = inputPath

    // Resolve relative paths if requested
    if (resolveRelative && !path.isAbsolute(normalized)) {
      normalized = path.resolve(basePath, normalized)
    }

    // Normalize using Node's path module
    normalized = path.normalize(normalized)

    // Resolve symlinks if requested
    if (resolveSymlinks) {
      try {
        if (fs.existsSync(normalized)) {
          normalized = fs.realpathSync(normalized)
        }
      } catch {
        // Path doesn't exist or can't be resolved - continue with normalized path
      }
    }

    // Normalize case on Windows if requested
    if (normalizeCase && this.isWindows) {
      // Convert to lowercase for consistency
      // Note: We preserve the original case of the drive letter
      const driveMatch = normalized.match(/^([a-zA-Z]):\\/)
      if (driveMatch) {
        normalized = driveMatch[1].toUpperCase() + normalized.slice(1).toLowerCase()
      }
    }

    // Handle long paths on Windows
    if (handleLongPaths && this.isWindows && normalized.length > WINDOWS_MAX_PATH) {
      normalized = this.addLongPathPrefix(normalized)
    }

    return normalized
  }

  /**
   * Add Windows long path prefix (\\?\) for paths exceeding MAX_PATH
   *
   * @param inputPath - The path to prefix
   * @returns Path with long path prefix if needed
   */
  addLongPathPrefix(inputPath: string): string {
    if (!inputPath || !this.isWindows) return inputPath

    // Already has long path prefix
    if (LONG_PATH_PREFIX_REGEX.test(inputPath)) {
      return inputPath
    }

    // Normalize the path first
    let normalized = path.normalize(inputPath)

    // Check if it's a UNC path
    if (UNC_PATH_REGEX.test(normalized)) {
      // UNC path: \\server\share -> \\?\UNC\server\share
      return WINDOWS_UNC_LONG_PATH_PREFIX + normalized.slice(2)
    }

    // Regular path with drive letter
    if (WINDOWS_DRIVE_LETTER_REGEX.test(normalized)) {
      return WINDOWS_LONG_PATH_PREFIX + normalized
    }

    return inputPath
  }

  /**
   * Remove Windows long path prefix
   *
   * @param inputPath - The path to clean
   * @returns Path without long path prefix
   */
  removeLongPathPrefix(inputPath: string): string {
    if (!inputPath) return ''

    if (inputPath.startsWith(WINDOWS_UNC_LONG_PATH_PREFIX)) {
      return '\\\\' + inputPath.slice(WINDOWS_UNC_LONG_PATH_PREFIX.length)
    }

    if (inputPath.startsWith(WINDOWS_LONG_PATH_PREFIX)) {
      return inputPath.slice(WINDOWS_LONG_PATH_PREFIX.length)
    }

    return inputPath
  }

  // ==========================================================================
  // Path Joining Methods
  // ==========================================================================

  /**
   * Safely join path segments
   *
   * @param segments - Path segments to join
   * @returns Joined path
   */
  joinPaths(...segments: string[]): string {
    // Filter out empty segments
    const validSegments = segments.filter(s => s && s.trim())
    if (validSegments.length === 0) return ''

    return path.join(...validSegments)
  }

  /**
   * Resolve path segments to an absolute path
   *
   * @param segments - Path segments to resolve
   * @returns Absolute path
   */
  resolvePaths(...segments: string[]): string {
    // Filter out empty segments
    const validSegments = segments.filter(s => s && s.trim())
    if (validSegments.length === 0) return process.cwd()

    return path.resolve(...validSegments)
  }

  /**
   * Make a path relative to a base directory
   *
   * @param from - Base directory
   * @param to - Target path
   * @returns Relative path
   */
  makeRelative(from: string, to: string): string {
    return path.relative(from, to)
  }

  // ==========================================================================
  // Path Validation Methods
  // ==========================================================================

  /**
   * Validate a path for the current platform
   *
   * @param inputPath - The path to validate
   * @returns Validation result with errors and warnings
   */
  validatePath(inputPath: string): PathValidationResult {
    const result: PathValidationResult = {
      valid: true,
      originalPath: inputPath,
      normalizedPath: null,
      errors: [],
      warnings: [],
      hasNonAscii: false,
      hasSpaces: false,
      isUncPath: false,
      exceedsMaxPath: false,
      driveLetter: null
    }

    if (!inputPath || inputPath.trim() === '') {
      result.valid = false
      result.errors.push('Path is empty')
      return result
    }

    // Check for non-ASCII characters
    // eslint-disable-next-line no-control-regex
    result.hasNonAscii = /[^\x00-\x7F]/.test(inputPath)
    if (result.hasNonAscii) {
      result.warnings.push('Path contains non-ASCII characters which may cause issues on some systems')
    }

    // Check for spaces
    result.hasSpaces = inputPath.includes(' ')
    if (result.hasSpaces) {
      result.warnings.push('Path contains spaces - ensure proper quoting when using in shell commands')
    }

    // Check for UNC path
    result.isUncPath = UNC_PATH_REGEX.test(inputPath) || inputPath.startsWith('//')

    // Check for Windows drive letter
    const driveMatch = inputPath.match(WINDOWS_DRIVE_LETTER_REGEX)
    if (driveMatch) {
      result.driveLetter = driveMatch[1].toUpperCase()
    }

    // Check path length (MAX_PATH on Windows)
    if (this.isWindows && inputPath.length > WINDOWS_MAX_PATH) {
      result.exceedsMaxPath = true
      result.warnings.push(`Path exceeds Windows MAX_PATH (${WINDOWS_MAX_PATH} chars). Long path prefix will be added.`)
    }

    // Platform-specific validation
    if (this.isWindows) {
      this.validateWindowsPath(inputPath, result)
    } else {
      this.validateUnixPath(inputPath, result)
    }

    // If still valid, normalize the path
    if (result.valid) {
      result.normalizedPath = this.normalizePath(inputPath)
    }

    return result
  }

  /**
   * Validate a filename (not full path)
   *
   * @param filename - The filename to validate
   * @returns Validation result
   */
  validateFilename(filename: string): PathValidationResult {
    const result: PathValidationResult = {
      valid: true,
      originalPath: filename,
      normalizedPath: null,
      errors: [],
      warnings: [],
      hasNonAscii: false,
      hasSpaces: false,
      isUncPath: false,
      exceedsMaxPath: false,
      driveLetter: null
    }

    if (!filename || filename.trim() === '') {
      result.valid = false
      result.errors.push('Filename is empty')
      return result
    }

    // Check for path separators in filename
    if (filename.includes('/') || filename.includes('\\')) {
      result.valid = false
      result.errors.push('Filename cannot contain path separators')
      return result
    }

    // Check for non-ASCII characters
    // eslint-disable-next-line no-control-regex
    result.hasNonAscii = /[^\x00-\x7F]/.test(filename)
    if (result.hasNonAscii) {
      result.warnings.push('Filename contains non-ASCII characters')
    }

    // Check for spaces
    result.hasSpaces = filename.includes(' ')

    // Platform-specific validation
    if (this.isWindows) {
      // Check for illegal characters
      const illegalChars = filename.match(WINDOWS_ILLEGAL_CHARS)
      if (illegalChars) {
        result.valid = false
        result.errors.push(`Filename contains illegal characters: ${[...new Set(illegalChars)].join(', ')}`)
      }

      // Check for reserved names
      const nameWithoutExt = filename.replace(/\.[^.]*$/, '').toUpperCase()
      if (WINDOWS_RESERVED_NAMES.includes(nameWithoutExt)) {
        result.valid = false
        result.errors.push(`"${nameWithoutExt}" is a reserved Windows device name`)
      }

      // Check for trailing dots or spaces
      if (filename.endsWith('.') || filename.endsWith(' ')) {
        result.valid = false
        result.errors.push('Filename cannot end with a dot or space on Windows')
      }
    } else {
      // Unix validation - only null character is truly illegal
      if (filename.includes('\x00')) {
        result.valid = false
        result.errors.push('Filename cannot contain null characters')
      }
    }

    if (result.valid) {
      result.normalizedPath = filename
    }

    return result
  }

  /**
   * Windows-specific path validation
   */
  private validateWindowsPath(inputPath: string, result: PathValidationResult): void {
    // Check for illegal characters in path segments
    const segments = inputPath.split(/[\\\/]/)
    for (const segment of segments) {
      if (!segment) continue // Skip empty segments (from leading/trailing slashes)

      // Skip drive letter
      if (segment.match(/^[a-zA-Z]:$/)) continue

      // Check for illegal characters
      const illegalChars = segment.match(WINDOWS_ILLEGAL_CHARS)
      if (illegalChars) {
        result.valid = false
        result.errors.push(`Path segment "${segment}" contains illegal characters: ${[...new Set(illegalChars)].join(', ')}`)
      }

      // Check for reserved names
      const nameWithoutExt = segment.replace(/\.[^.]*$/, '').toUpperCase()
      if (WINDOWS_RESERVED_NAMES.includes(nameWithoutExt)) {
        result.valid = false
        result.errors.push(`"${nameWithoutExt}" is a reserved Windows device name and cannot be used in paths`)
      }

      // Check for trailing dots or spaces
      if (segment.endsWith('.') || segment.endsWith(' ')) {
        result.warnings.push(`Path segment "${segment}" ends with a dot or space which may cause issues`)
      }
    }
  }

  /**
   * Unix-specific path validation
   */
  private validateUnixPath(inputPath: string, result: PathValidationResult): void {
    // Check for null characters (the only truly illegal character in Unix paths)
    if (inputPath.includes('\x00')) {
      result.valid = false
      result.errors.push('Path cannot contain null characters')
    }

    // Warn about characters that might cause shell issues
    const shellSpecialChars = inputPath.match(/[;&|`$"'<>(){}[\]!#~]/g)
    if (shellSpecialChars) {
      result.warnings.push('Path contains shell special characters - ensure proper quoting')
    }
  }

  // ==========================================================================
  // Path Component Methods
  // ==========================================================================

  /**
   * Parse a path into its components
   *
   * @param inputPath - The path to parse
   * @returns Path components
   */
  parsePath(inputPath: string): PathComponents {
    const parsed = path.parse(inputPath)

    // Detect UNC path
    const isUncPath = UNC_PATH_REGEX.test(inputPath) || inputPath.startsWith('//')

    // Detect drive letter
    const driveMatch = inputPath.match(WINDOWS_DRIVE_LETTER_REGEX)
    const driveLetter = driveMatch ? driveMatch[1].toUpperCase() : null

    // Split into segments
    const segments = inputPath
      .split(/[\\\/]/)
      .filter(s => s && !s.match(/^[a-zA-Z]:$/)) // Filter out empty and drive letter

    return {
      root: parsed.root,
      dir: parsed.dir,
      base: parsed.base,
      name: parsed.name,
      ext: parsed.ext,
      isAbsolute: path.isAbsolute(inputPath),
      isUncPath,
      driveLetter,
      segments
    }
  }

  /**
   * Get the file extension (including dot)
   *
   * @param inputPath - The path to parse
   * @returns File extension or empty string
   */
  getExtension(inputPath: string): string {
    return path.extname(inputPath)
  }

  /**
   * Get the filename without extension
   *
   * @param inputPath - The path to parse
   * @returns Filename without extension
   */
  getBasename(inputPath: string): string {
    return path.basename(inputPath, path.extname(inputPath))
  }

  /**
   * Get the directory portion of a path
   *
   * @param inputPath - The path to parse
   * @returns Directory path
   */
  getDirname(inputPath: string): string {
    return path.dirname(inputPath)
  }

  /**
   * Change the file extension
   *
   * @param inputPath - The original path
   * @param newExt - The new extension (with or without dot)
   * @returns Path with new extension
   */
  changeExtension(inputPath: string, newExt: string): string {
    const parsed = path.parse(inputPath)
    const ext = newExt.startsWith('.') ? newExt : `.${newExt}`
    return path.join(parsed.dir, parsed.name + ext)
  }

  // ==========================================================================
  // Path Existence and Type Methods
  // ==========================================================================

  /**
   * Check if a path exists
   *
   * @param inputPath - The path to check
   * @returns Whether the path exists
   */
  exists(inputPath: string): boolean {
    try {
      const normalizedPath = this.normalizePath(inputPath)
      return fs.existsSync(normalizedPath)
    } catch {
      return false
    }
  }

  /**
   * Check if a path is a directory
   *
   * @param inputPath - The path to check
   * @returns Whether the path is a directory
   */
  isDirectory(inputPath: string): boolean {
    try {
      const normalizedPath = this.normalizePath(inputPath)
      const stats = fs.statSync(normalizedPath)
      return stats.isDirectory()
    } catch {
      return false
    }
  }

  /**
   * Check if a path is a file
   *
   * @param inputPath - The path to check
   * @returns Whether the path is a file
   */
  isFile(inputPath: string): boolean {
    try {
      const normalizedPath = this.normalizePath(inputPath)
      const stats = fs.statSync(normalizedPath)
      return stats.isFile()
    } catch {
      return false
    }
  }

  /**
   * Check if a path is absolute
   *
   * @param inputPath - The path to check
   * @returns Whether the path is absolute
   */
  isAbsolutePath(inputPath: string): boolean {
    return path.isAbsolute(inputPath)
  }

  // ==========================================================================
  // Platform-Specific Methods
  // ==========================================================================

  /**
   * Get the current platform
   *
   * @returns Platform identifier
   */
  getPlatform(): 'win32' | 'darwin' | 'linux' {
    return process.platform as 'win32' | 'darwin' | 'linux'
  }

  /**
   * Check if running on Windows
   */
  isWindowsPlatform(): boolean {
    return this.isWindows
  }

  /**
   * Get the path separator for the current platform
   */
  getPathSeparator(): string {
    return path.sep
  }

  /**
   * Get the path delimiter for the current platform (: on Unix, ; on Windows)
   */
  getPathDelimiter(): string {
    return path.delimiter
  }

  /**
   * Convert a path to the opposite platform style (for testing/debugging)
   *
   * @param inputPath - The path to convert
   * @param targetStyle - Target path style
   * @returns Converted path
   */
  convertPathStyle(inputPath: string, targetStyle: PathStyle): string {
    if (!inputPath) return ''

    if (targetStyle === 'auto') {
      targetStyle = this.isWindows ? 'windows' : 'unix'
    }

    if (targetStyle === 'unix') {
      // Convert to Unix style
      let converted = inputPath.replace(/\\/g, '/')
      // Handle Windows drive letters: C:/ -> /c/
      const driveMatch = converted.match(/^([a-zA-Z]):\//)
      if (driveMatch) {
        converted = '/' + driveMatch[1].toLowerCase() + converted.slice(2)
      }
      return converted
    } else {
      // Convert to Windows style
      let converted = inputPath.replace(/\//g, '\\')
      // Handle Unix-style drive letters: /c/ -> C:\
      const unixDriveMatch = converted.match(/^\\([a-zA-Z])\\/)
      if (unixDriveMatch) {
        converted = unixDriveMatch[1].toUpperCase() + ':\\' + converted.slice(3)
      }
      return converted
    }
  }

  // ==========================================================================
  // Utility Methods
  // ==========================================================================

  /**
   * Ensure a directory exists, creating it if necessary
   *
   * @param dirPath - The directory path
   * @returns Whether the directory now exists
   */
  ensureDirectory(dirPath: string): boolean {
    try {
      const normalizedPath = this.normalizePath(dirPath)
      if (!fs.existsSync(normalizedPath)) {
        fs.mkdirSync(normalizedPath, { recursive: true })
      }
      return true
    } catch (error) {
      console.error(`[pathNormalizationService] Failed to create directory: ${dirPath}`, error)
      return false
    }
  }

  /**
   * Sanitize a string to be safe for use as a filename
   *
   * @param input - The string to sanitize
   * @param replacement - Character to replace invalid chars with
   * @returns Sanitized filename
   */
  sanitizeFilename(input: string, replacement: string = '_'): string {
    if (!input) return ''

    let sanitized = input

    // Remove/replace characters that are illegal on Windows (also safe for Unix)
    sanitized = sanitized.replace(WINDOWS_ILLEGAL_CHARS, replacement)

    // Remove/replace path separators
    sanitized = sanitized.replace(/[\\\/]/g, replacement)

    // Remove leading/trailing dots and spaces (problematic on Windows)
    sanitized = sanitized.replace(/^[\s.]+|[\s.]+$/g, '')

    // Replace reserved names
    const upperSanitized = sanitized.replace(/\.[^.]*$/, '').toUpperCase()
    if (WINDOWS_RESERVED_NAMES.includes(upperSanitized)) {
      sanitized = '_' + sanitized
    }

    // Collapse multiple replacement characters
    if (replacement) {
      const escapedReplacement = replacement.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
      sanitized = sanitized.replace(new RegExp(`${escapedReplacement}+`, 'g'), replacement)
    }

    // Ensure we have something
    if (!sanitized) {
      sanitized = 'unnamed'
    }

    return sanitized
  }

  /**
   * Get a unique filename by appending a number if file exists
   *
   * @param filePath - The desired file path
   * @returns Unique file path
   */
  getUniqueFilename(filePath: string): string {
    if (!this.exists(filePath)) {
      return filePath
    }

    const parsed = path.parse(filePath)
    let counter = 1
    let newPath: string

    do {
      newPath = path.join(parsed.dir, `${parsed.name}_${counter}${parsed.ext}`)
      counter++
    } while (this.exists(newPath) && counter < 1000)

    return newPath
  }

  /**
   * Quote a path for safe use in shell commands
   *
   * @param inputPath - The path to quote
   * @returns Quoted path
   */
  quoteForShell(inputPath: string): string {
    if (!inputPath) return '""'

    if (this.isWindows) {
      // Windows uses double quotes and escapes inner double quotes
      return `"${inputPath.replace(/"/g, '""')}"`
    } else {
      // Unix uses single quotes (most escape-proof) or escapes special chars
      // Single quotes don't allow variable expansion, which is usually what we want
      if (inputPath.includes("'")) {
        // If path contains single quotes, use double quotes and escape $ ` \ "
        return `"${inputPath.replace(/([`$"\\])/g, '\\$1')}"`
      }
      return `'${inputPath}'`
    }
  }
}

// ============================================================================
// Export singleton instance
// ============================================================================

export const pathNormalizationService = new PathNormalizationService()

// Also export the class for testing
export { PathNormalizationService }
