/**
 * Python Validation Cache Service
 *
 * Provides database-backed caching for Python environment validation results
 * to eliminate redundant heavy checks on every app startup.
 *
 * Features:
 * - Store validation results in SQLite database
 * - Compute environment fingerprint (hash) for cache invalidation
 * - TTL-based cache expiration (default: 24 hours)
 * - File system watcher integration for venv directory changes
 * - Lightweight validation for cached environments
 *
 * Cache Invalidation:
 * - validation_hash changes (venv directory modified)
 * - cache exceeds TTL (default 24 hours)
 * - user forces refresh via Settings
 * - user repairs environment
 */

import * as fs from 'fs'
import * as path from 'path'
import * as crypto from 'crypto'
import type Database from 'better-sqlite3'
import { getDatabaseService } from './database'
import { settingsService } from './settingsService'
import { loggerService } from './loggerService'
import type { ValidationResult, EnvironmentReadiness } from './pythonEnvironmentValidator'

// ============================================================================
// Types
// ============================================================================

export interface EnvironmentStatusCache {
  id: number
  environment_name: string
  status: EnvironmentReadiness
  python_version: string | null
  torch_version: string | null
  packages_json: string
  validation_result_json: string
  last_validated: number
  validation_hash: string
  errors_json: string | null
  warnings_json: string | null
  cache_ttl_hours: number
  created_at: number
  updated_at: number
}

export interface CacheValidationResult {
  /** Whether a valid cache exists */
  hasValidCache: boolean
  /** The cached validation result (if valid) */
  cachedResult: ValidationResult | null
  /** Why the cache was invalid (if applicable) */
  invalidationReason?: string
  /** Age of cache in hours */
  cacheAgeHours?: number
  /** Whether the hash matched */
  hashMatched?: boolean
}

export interface CacheStats {
  /** Whether cache exists for any environment */
  hasCache: boolean
  /** Last validation timestamp */
  lastValidated: string | null
  /** Cache age in hours */
  cacheAgeHours: number | null
  /** Current validation hash */
  currentHash: string | null
  /** Stored validation hash */
  storedHash: string | null
  /** Whether hashes match */
  hashesMatch: boolean
  /** Environment status from cache */
  cachedStatus: EnvironmentReadiness | null
}

// ============================================================================
// Constants
// ============================================================================

const DEFAULT_CACHE_TTL_HOURS = 24
const SMART_ENVIRONMENT_CHECKING_KEY = 'transcription.smartEnvironmentChecking'

// ============================================================================
// Prepared Statements Cache
// ============================================================================

let statements: {
  get: Database.Statement
  upsert: Database.Statement
  delete: Database.Statement
  getAll: Database.Statement
  deleteAll: Database.Statement
} | null = null

function getStatements() {
  if (statements) return statements

  const db = getDatabaseService().getDatabase()

  statements = {
    get: db.prepare(`
      SELECT * FROM environment_status WHERE environment_name = ?
    `),

    upsert: db.prepare(`
      INSERT INTO environment_status (
        environment_name, status, python_version, torch_version,
        packages_json, validation_result_json, last_validated,
        validation_hash, errors_json, warnings_json, cache_ttl_hours,
        created_at, updated_at
      )
      VALUES (
        @environment_name, @status, @python_version, @torch_version,
        @packages_json, @validation_result_json, @last_validated,
        @validation_hash, @errors_json, @warnings_json, @cache_ttl_hours,
        @created_at, @updated_at
      )
      ON CONFLICT(environment_name) DO UPDATE SET
        status = excluded.status,
        python_version = excluded.python_version,
        torch_version = excluded.torch_version,
        packages_json = excluded.packages_json,
        validation_result_json = excluded.validation_result_json,
        last_validated = excluded.last_validated,
        validation_hash = excluded.validation_hash,
        errors_json = excluded.errors_json,
        warnings_json = excluded.warnings_json,
        cache_ttl_hours = excluded.cache_ttl_hours,
        updated_at = excluded.updated_at
    `),

    delete: db.prepare(`
      DELETE FROM environment_status WHERE environment_name = ?
    `),

    getAll: db.prepare(`
      SELECT * FROM environment_status ORDER BY last_validated DESC
    `),

    deleteAll: db.prepare(`
      DELETE FROM environment_status
    `)
  }

  return statements
}

// ============================================================================
// Python Validation Cache Service
// ============================================================================

class PythonValidationCacheService {
  private fileWatchers: Map<string, fs.FSWatcher> = new Map()

  /**
   * Check if smart environment checking is enabled
   */
  isSmartCheckingEnabled(): boolean {
    const enabled = settingsService.get<boolean>(SMART_ENVIRONMENT_CHECKING_KEY)
    // Default to true if not set
    return enabled !== null ? enabled : true
  }

  /**
   * Set smart environment checking enabled/disabled
   */
  setSmartCheckingEnabled(enabled: boolean): void {
    settingsService.set(SMART_ENVIRONMENT_CHECKING_KEY, enabled, 'transcription')
    loggerService.info(`[ValidationCache] Smart environment checking ${enabled ? 'enabled' : 'disabled'}`)
  }

  /**
   * Compute a hash of the environment to detect changes
   * Uses modification times of key directories and files
   */
  computeEnvironmentHash(pythonPath: string | null, venvPaths?: string[]): string {
    const hashData: string[] = []

    // Add Python path
    if (pythonPath) {
      try {
        const stats = fs.statSync(pythonPath)
        hashData.push(`python:${pythonPath}:${stats.mtime.getTime()}`)
      } catch {
        hashData.push(`python:${pythonPath}:missing`)
      }
    }

    // Add venv directory info (site-packages mtime is a good indicator of package changes)
    const allPaths = venvPaths || []
    if (pythonPath && !venvPaths) {
      // Try to find venv from Python path
      const venvDir = this.findVenvDir(pythonPath)
      if (venvDir) allPaths.push(venvDir)
    }

    for (const venvPath of allPaths) {
      const sitePackages = this.findSitePackages(venvPath)
      if (sitePackages) {
        try {
          const stats = fs.statSync(sitePackages)
          hashData.push(`venv:${venvPath}:${stats.mtime.getTime()}`)
        } catch {
          hashData.push(`venv:${venvPath}:missing`)
        }
      }
    }

    // Create hash using SHA256 as per requirements
    const hash = crypto.createHash('sha256').update(hashData.join('|')).digest('hex')
    return hash
  }

  /**
   * Find the venv directory from a Python path
   */
  private findVenvDir(pythonPath: string): string | null {
    // Python path is usually venv/bin/python or venv/Scripts/python.exe
    const binDir = path.dirname(pythonPath)
    const venvDir = path.dirname(binDir)

    // Check if this looks like a venv
    const pyvenvCfg = path.join(venvDir, 'pyvenv.cfg')
    if (fs.existsSync(pyvenvCfg)) {
      return venvDir
    }

    return null
  }

  /**
   * Find site-packages directory in a venv
   */
  private findSitePackages(venvPath: string): string | null {
    // Try common locations
    const candidates = [
      path.join(venvPath, 'lib', 'python3.12', 'site-packages'),
      path.join(venvPath, 'lib', 'python3.11', 'site-packages'),
      path.join(venvPath, 'lib', 'python3.10', 'site-packages'),
      path.join(venvPath, 'Lib', 'site-packages'), // Windows
    ]

    for (const candidate of candidates) {
      if (fs.existsSync(candidate)) {
        return candidate
      }
    }

    // Try to find any python version
    const libDir = path.join(venvPath, 'lib')
    if (fs.existsSync(libDir)) {
      try {
        const entries = fs.readdirSync(libDir)
        for (const entry of entries) {
          if (entry.startsWith('python')) {
            const sp = path.join(libDir, entry, 'site-packages')
            if (fs.existsSync(sp)) return sp
          }
        }
      } catch {
        // Ignore read errors
      }
    }

    return null
  }

  /**
   * Get cached validation result if valid
   */
  getCachedValidation(environmentName: string, currentHash: string): CacheValidationResult {
    try {
      const stmts = getStatements()
      const cached = stmts.get.get(environmentName) as EnvironmentStatusCache | undefined

      if (!cached) {
        return {
          hasValidCache: false,
          cachedResult: null,
          invalidationReason: 'No cache found'
        }
      }

      // Check if cache is expired (last_validated is now Unix timestamp in seconds)
      const lastValidatedMs = cached.last_validated * 1000
      const now = Date.now()
      const ageMs = now - lastValidatedMs
      const ageHours = ageMs / (1000 * 60 * 60)
      const ttlHours = cached.cache_ttl_hours || DEFAULT_CACHE_TTL_HOURS

      if (ageHours > ttlHours) {
        return {
          hasValidCache: false,
          cachedResult: null,
          invalidationReason: `Cache expired (age: ${ageHours.toFixed(1)}h, TTL: ${ttlHours}h)`,
          cacheAgeHours: ageHours,
          hashMatched: cached.validation_hash === currentHash
        }
      }

      // Check if hash matches
      if (cached.validation_hash !== currentHash) {
        return {
          hasValidCache: false,
          cachedResult: null,
          invalidationReason: 'Environment changed (hash mismatch)',
          cacheAgeHours: ageHours,
          hashMatched: false
        }
      }

      // Parse cached validation result
      try {
        const validationResult = JSON.parse(cached.validation_result_json) as ValidationResult
        return {
          hasValidCache: true,
          cachedResult: validationResult,
          cacheAgeHours: ageHours,
          hashMatched: true
        }
      } catch (parseError) {
        return {
          hasValidCache: false,
          cachedResult: null,
          invalidationReason: 'Failed to parse cached result',
          cacheAgeHours: ageHours,
          hashMatched: true
        }
      }
    } catch (error) {
      loggerService.warn('[ValidationCache] Error getting cached validation:', error)
      return {
        hasValidCache: false,
        cachedResult: null,
        invalidationReason: 'Database error'
      }
    }
  }

  /**
   * Store validation result in cache
   */
  cacheValidationResult(
    environmentName: string,
    validationResult: ValidationResult,
    hash: string,
    ttlHours: number = DEFAULT_CACHE_TTL_HOURS
  ): void {
    try {
      const stmts = getStatements()

      // Extract package versions
      const packagesJson = JSON.stringify(validationResult.packageVersions || {})
      const torchVersion = validationResult.packageVersions?.['torch'] || null

      // Extract errors and warnings separately
      const errors = validationResult.checks?.filter(c => c.status === 'fail').map(c => ({
        type: c.type,
        message: c.message,
        error: c.error,
        remediation: c.remediation
      })) || []

      const warnings = validationResult.checks?.filter(c => c.status === 'warning').map(c => ({
        type: c.type,
        message: c.message,
        details: c.details
      })) || []

      const nowUnix = Math.floor(Date.now() / 1000) // Unix timestamp in seconds

      const params = {
        environment_name: environmentName,
        status: validationResult.readiness,
        python_version: validationResult.environment?.pythonVersion || null,
        torch_version: torchVersion,
        packages_json: packagesJson,
        validation_result_json: JSON.stringify(validationResult),
        last_validated: nowUnix,
        validation_hash: hash,
        errors_json: errors.length > 0 ? JSON.stringify(errors) : null,
        warnings_json: warnings.length > 0 ? JSON.stringify(warnings) : null,
        cache_ttl_hours: ttlHours,
        created_at: nowUnix,
        updated_at: nowUnix
      }

      stmts.upsert.run(params)
      loggerService.info(`[ValidationCache] Cached validation result for ${environmentName} (hash: ${hash.slice(0, 8)}...)`)
    } catch (error) {
      loggerService.error('[ValidationCache] Error caching validation result:', error)
    }
  }

  /**
   * Invalidate cache for an environment
   */
  invalidateCache(environmentName: string): void {
    try {
      const stmts = getStatements()
      stmts.delete.run(environmentName)
      loggerService.info(`[ValidationCache] Invalidated cache for ${environmentName}`)
    } catch (error) {
      loggerService.error('[ValidationCache] Error invalidating cache:', error)
    }
  }

  /**
   * Invalidate all cached validation results
   */
  invalidateAllCaches(): void {
    try {
      const stmts = getStatements()
      stmts.deleteAll.run()
      loggerService.info('[ValidationCache] Invalidated all caches')
    } catch (error) {
      loggerService.error('[ValidationCache] Error invalidating all caches:', error)
    }
  }

  /**
   * Get cache statistics
   */
  getCacheStats(environmentName: string, currentHash?: string): CacheStats {
    try {
      const stmts = getStatements()
      const cached = stmts.get.get(environmentName) as EnvironmentStatusCache | undefined

      if (!cached) {
        return {
          hasCache: false,
          lastValidated: null,
          cacheAgeHours: null,
          currentHash: currentHash || null,
          storedHash: null,
          hashesMatch: false,
          cachedStatus: null
        }
      }

      // Convert Unix timestamp to milliseconds
      const lastValidatedMs = cached.last_validated * 1000
      const now = Date.now()
      const ageMs = now - lastValidatedMs
      const ageHours = ageMs / (1000 * 60 * 60)

      return {
        hasCache: true,
        lastValidated: new Date(lastValidatedMs).toISOString(), // Convert to ISO string for display
        cacheAgeHours: ageHours,
        currentHash: currentHash || null,
        storedHash: cached.validation_hash,
        hashesMatch: currentHash ? cached.validation_hash === currentHash : false,
        cachedStatus: cached.status as EnvironmentReadiness
      }
    } catch (error) {
      loggerService.warn('[ValidationCache] Error getting cache stats:', error)
      return {
        hasCache: false,
        lastValidated: null,
        cacheAgeHours: null,
        currentHash: currentHash || null,
        storedHash: null,
        hashesMatch: false,
        cachedStatus: null
      }
    }
  }

  /**
   * Start watching venv directories for changes
   */
  startWatching(venvPaths: string[]): void {
    // Stop any existing watchers first
    this.stopWatching()

    for (const venvPath of venvPaths) {
      const sitePackages = this.findSitePackages(venvPath)
      const watchPath = sitePackages || venvPath

      if (!fs.existsSync(watchPath)) {
        loggerService.warn(`[ValidationCache] Cannot watch non-existent path: ${watchPath}`)
        continue
      }

      try {
        const watcher = fs.watch(watchPath, { persistent: false }, (eventType, filename) => {
          loggerService.info(`[ValidationCache] Detected change in ${watchPath}: ${eventType} ${filename}`)
          // Invalidate cache when venv changes
          this.invalidateAllCaches()
        })

        this.fileWatchers.set(watchPath, watcher)
        loggerService.info(`[ValidationCache] Started watching: ${watchPath}`)
      } catch (error) {
        loggerService.warn(`[ValidationCache] Failed to start watcher for ${watchPath}:`, error)
      }
    }
  }

  /**
   * Stop watching all venv directories
   */
  stopWatching(): void {
    for (const [path, watcher] of this.fileWatchers) {
      try {
        watcher.close()
        loggerService.info(`[ValidationCache] Stopped watching: ${path}`)
      } catch {
        // Ignore errors when closing watchers
      }
    }
    this.fileWatchers.clear()
  }

  /**
   * Get all cached environments
   */
  getAllCachedEnvironments(): EnvironmentStatusCache[] {
    try {
      const stmts = getStatements()
      return stmts.getAll.all() as EnvironmentStatusCache[]
    } catch (error) {
      loggerService.warn('[ValidationCache] Error getting all cached environments:', error)
      return []
    }
  }

  // ============================================================================
  // Required API Methods (as per feature specification)
  // ============================================================================

  /**
   * Get cached status for an environment
   * Returns the cached validation result if valid, null otherwise
   *
   * @param envName - Environment name to look up
   * @param maxAgeHours - Optional max age in hours (defaults to cache_ttl_hours from DB)
   * @returns ValidationResult if cache is valid, null otherwise
   */
  getCachedStatus(envName: string, maxAgeHours?: number): ValidationResult | null {
    try {
      const stmts = getStatements()
      const cached = stmts.get.get(envName) as EnvironmentStatusCache | undefined

      if (!cached) {
        return null
      }

      // Check if cache is expired
      const lastValidatedMs = cached.last_validated * 1000
      const now = Date.now()
      const ageMs = now - lastValidatedMs
      const ageHours = ageMs / (1000 * 60 * 60)
      const ttlHours = maxAgeHours ?? cached.cache_ttl_hours ?? DEFAULT_CACHE_TTL_HOURS

      if (ageHours > ttlHours) {
        loggerService.info(`[ValidationCache] Cache expired for ${envName} (age: ${ageHours.toFixed(1)}h, TTL: ${ttlHours}h)`)
        return null
      }

      // Parse and return cached validation result
      try {
        const validationResult = JSON.parse(cached.validation_result_json) as ValidationResult
        loggerService.info(`[ValidationCache] Cache hit for ${envName} (age: ${ageHours.toFixed(1)}h)`)
        return validationResult
      } catch (parseError) {
        loggerService.error('[ValidationCache] Failed to parse cached result:', parseError)
        return null
      }
    } catch (error) {
      loggerService.warn('[ValidationCache] Error getting cached status:', error)
      return null
    }
  }

  /**
   * Update status for an environment
   * Stores the validation result in the database cache
   *
   * @param envName - Environment name
   * @param validationResult - Validation result to cache
   * @param validationHash - Optional hash (will be computed if not provided)
   * @param maxAgeHours - Optional TTL in hours (defaults to 24)
   */
  updateStatus(
    envName: string,
    validationResult: ValidationResult,
    validationHash?: string,
    maxAgeHours: number = DEFAULT_CACHE_TTL_HOURS
  ): void {
    const hash = validationHash || this.computeEnvironmentHash(
      validationResult.environment?.pythonPath || null,
      validationResult.environment?.venvPaths
    )
    this.cacheValidationResult(envName, validationResult, hash, maxAgeHours)
  }

  /**
   * Check if cache is valid for an environment
   *
   * @param envName - Environment name
   * @param maxAgeHours - Optional max age in hours (defaults to cache_ttl_hours from DB)
   * @param currentHash - Optional current hash to check against (if not provided, only checks TTL)
   * @returns true if cache exists and is valid, false otherwise
   */
  isCacheValid(envName: string, maxAgeHours?: number, currentHash?: string): boolean {
    try {
      const stmts = getStatements()
      const cached = stmts.get.get(envName) as EnvironmentStatusCache | undefined

      if (!cached) {
        return false
      }

      // Check if cache is expired
      const lastValidatedMs = cached.last_validated * 1000
      const now = Date.now()
      const ageMs = now - lastValidatedMs
      const ageHours = ageMs / (1000 * 60 * 60)
      const ttlHours = maxAgeHours ?? cached.cache_ttl_hours ?? DEFAULT_CACHE_TTL_HOURS

      if (ageHours > ttlHours) {
        return false
      }

      // Check hash if provided
      if (currentHash && cached.validation_hash !== currentHash) {
        return false
      }

      return true
    } catch (error) {
      loggerService.warn('[ValidationCache] Error checking cache validity:', error)
      return false
    }
  }
}

// ============================================================================
// Exports
// ============================================================================

// Export singleton instance
export const pythonValidationCacheService = new PythonValidationCacheService()

// Export class for testing
export { PythonValidationCacheService }

// Reset statements cache (useful for testing)
export function resetCacheStatements(): void {
  statements = null
}
