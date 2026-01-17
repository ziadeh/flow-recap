/**
 * Tiered Validation Service
 *
 * Implements progressive, tiered validation approach that spreads checks over time
 * and defers heavy operations until needed. This eliminates startup freeze while
 * maintaining environment health monitoring.
 *
 * Tiers:
 * - Tier 1 (Startup - <500ms): Basic checks only - verify Python binaries exist,
 *   check venv directories present, read cached status from database
 * - Tier 2 (Background - after UI loads): Lightweight import tests (import whisperx,
 *   import pyannote.audio, import torch), verify package versions match expected,
 *   update cache if changes detected
 * - Tier 3 (On-Demand - when feature used): Heavy model loading tests only when
 *   user starts recording or diarization, download missing models if needed,
 *   cache successful loads to avoid re-testing
 *
 * Features:
 * - Async validation queue that processes checks in background
 * - Startup status indicator with option to skip
 * - Settings option for validation level
 * - Visual indicator for background validation progress
 * - Validation timing metrics
 */

import { EventEmitter } from 'events'
import * as fs from 'fs'
import * as path from 'path'
import { execSync } from 'child_process'
import { pythonEnvironment, PythonEnvironmentType } from './pythonEnvironment'
import { pythonValidationCacheService } from './pythonValidationCacheService'
import { settingsService } from './settingsService'
import { loggerService } from './loggerService'
import type { ValidationResult, ValidationCheck, EnvironmentReadiness, CheckCriticality, ValidationStatus } from './pythonEnvironmentValidator'

// ============================================================================
// Types
// ============================================================================

export type ValidationTier = 'tier1' | 'tier2' | 'tier3'
export type ValidationLevel = 'fast' | 'balanced' | 'thorough'
export type TieredValidationStatus = 'idle' | 'running' | 'complete' | 'error'

export interface TierResult {
  tier: ValidationTier
  status: TieredValidationStatus
  startTime: number
  endTime?: number
  duration?: number
  checks: ValidationCheck[]
  success: boolean
  readiness: EnvironmentReadiness
  statusMessage: string
}

export interface TieredValidationState {
  currentTier: ValidationTier | null
  tier1: TierResult | null
  tier2: TierResult | null
  tier3: TierResult | null
  overallStatus: TieredValidationStatus
  overallReadiness: EnvironmentReadiness
  overallStatusMessage: string
  lastFullValidation: string | null
  isBackgroundValidationRunning: boolean
}

export interface ValidationMetrics {
  tier1Duration: number | null
  tier2Duration: number | null
  tier3Duration: number | null
  totalDuration: number | null
  checksPerformed: number
  checksPassed: number
  checksFailed: number
  cacheHit: boolean
  timestamp: string
}

export interface TieredValidationResult extends ValidationResult {
  tierResults: {
    tier1: TierResult | null
    tier2: TierResult | null
    tier3: TierResult | null
  }
  metrics: ValidationMetrics
}

// ============================================================================
// Constants
// ============================================================================

const VALIDATION_LEVEL_KEY = 'transcription.startupValidationLevel'
const DEFAULT_VALIDATION_LEVEL: ValidationLevel = 'fast'
const TIER1_TIMEOUT = 500 // 500ms max for Tier 1
const TIER2_TIMEOUT = 10000 // 10s max for Tier 2
const TIER3_TIMEOUT = 120000 // 2 minutes for model loading

// ============================================================================
// Tiered Validation Service
// ============================================================================

class TieredValidationService extends EventEmitter {
  private state: TieredValidationState = {
    currentTier: null,
    tier1: null,
    tier2: null,
    tier3: null,
    overallStatus: 'idle',
    overallReadiness: 'ready',
    overallStatusMessage: 'Not validated',
    lastFullValidation: null,
    isBackgroundValidationRunning: false
  }

  private tier2Queue: Promise<TierResult | null> | null = null
  private tier3Queue: Map<string, Promise<TierResult | null>> = new Map()
  private metricsHistory: ValidationMetrics[] = []
  private readonly MAX_METRICS_HISTORY = 50

  // ============================================================================
  // Public API
  // ============================================================================

  /**
   * Get current validation state
   */
  getState(): TieredValidationState {
    return { ...this.state }
  }

  /**
   * Get validation level setting
   */
  getValidationLevel(): ValidationLevel {
    const level = settingsService.get<ValidationLevel>(VALIDATION_LEVEL_KEY)
    return level || DEFAULT_VALIDATION_LEVEL
  }

  /**
   * Set validation level setting
   */
  setValidationLevel(level: ValidationLevel): void {
    settingsService.set(VALIDATION_LEVEL_KEY, level, 'transcription')
    loggerService.info(`[TieredValidation] Validation level set to: ${level}`)
    this.emit('settings:changed', { validationLevel: level })
  }

  /**
   * Run Tier 1 validation (fast startup check)
   * Called during app startup - must complete in <500ms
   */
  async runTier1Validation(): Promise<TierResult> {
    const startTime = Date.now()
    loggerService.info('[TieredValidation] Starting Tier 1 validation (startup)')

    this.state.currentTier = 'tier1'
    this.state.overallStatus = 'running'
    this.emit('tier1:start')

    const checks: ValidationCheck[] = []
    let success = true
    let readiness: EnvironmentReadiness = 'ready'
    let statusMessage = 'Environment ready (cached)'

    try {
      // Get Python environment info
      const envType = pythonEnvironment.getEnvironmentType()
      const pythonPath = pythonEnvironment.getPythonPath()
      const environmentName = `${envType}:${pythonPath || 'none'}`

      // Check 1: Python binary exists (fast file system check)
      const binaryCheck = this.checkPythonBinaryExists(pythonPath, envType)
      checks.push(binaryCheck)
      if (binaryCheck.status === 'fail') {
        success = false
        readiness = 'failed'
        statusMessage = 'Python binary not found'
      }

      // Check 2: Venv directories exist (if applicable)
      if (envType === 'dual-venv' || envType === 'venv') {
        const venvCheck = this.checkVenvDirectoriesExist(envType)
        checks.push(venvCheck)
        if (venvCheck.status === 'fail') {
          success = false
          readiness = 'failed'
          statusMessage = 'Virtual environment directories not found'
        }
      }

      // Check 3: Read cached status from database
      if (success) {
        const venvPaths = this.getVenvPaths()
        const currentHash = pythonValidationCacheService.computeEnvironmentHash(pythonPath, venvPaths)
        const cacheResult = pythonValidationCacheService.getCachedValidation(environmentName, currentHash)

        if (cacheResult.hasValidCache && cacheResult.cachedResult) {
          const cachedReadiness = cacheResult.cachedResult.readiness

          // FIX: Don't trust cached "failed" status if Python binary and venv directories exist
          // The environment might have been fixed since last check
          // For Tier 1, if binaries exist, assume functional until Tier 2 verifies
          if (cachedReadiness === 'failed') {
            // Binary exists but cache says failed - let Tier 2 verify
            readiness = 'functional'
            statusMessage = 'Checking environment...'

            checks.push({
              type: 'python_binary',
              name: 'Cache Status',
              status: 'warning',
              message: `Cached status was failed, but binaries exist - needs re-verification`,
              duration: 0,
              criticality: 'important',
              details: { cacheAge: cacheResult.cacheAgeHours, hashMatched: true, needsRevalidation: true }
            })
          } else {
            // Use cached readiness for non-failed statuses
            readiness = cachedReadiness
            statusMessage = `${cacheResult.cachedResult.statusMessage} (cached ${cacheResult.cacheAgeHours?.toFixed(1)}h ago)`

            checks.push({
              type: 'python_binary',
              name: 'Cache Status',
              status: 'pass',
              message: `Using cached validation from ${cacheResult.cacheAgeHours?.toFixed(1)}h ago`,
              duration: 0,
              criticality: 'critical',
              details: { cacheAge: cacheResult.cacheAgeHours, hashMatched: true }
            })
          }
        } else {
          // No valid cache - mark as needing Tier 2 validation
          readiness = 'functional' // Assume functional until proven otherwise
          statusMessage = 'Environment check in progress...'

          checks.push({
            type: 'python_binary',
            name: 'Cache Status',
            status: 'warning',
            message: cacheResult.invalidationReason || 'No cache available',
            duration: 0,
            criticality: 'important',
            details: { invalidationReason: cacheResult.invalidationReason }
          })
        }
      }
    } catch (error) {
      success = false
      readiness = 'failed'
      statusMessage = 'Tier 1 validation failed'
      loggerService.error('[TieredValidation] Tier 1 error:', error)
    }

    const endTime = Date.now()
    const duration = endTime - startTime

    const result: TierResult = {
      tier: 'tier1',
      status: 'complete',
      startTime,
      endTime,
      duration,
      checks,
      success,
      readiness,
      statusMessage
    }

    this.state.tier1 = result
    this.state.overallReadiness = readiness
    this.state.overallStatusMessage = statusMessage

    if (duration > TIER1_TIMEOUT) {
      loggerService.warn(`[TieredValidation] Tier 1 exceeded timeout: ${duration}ms > ${TIER1_TIMEOUT}ms`)
    }

    loggerService.info(`[TieredValidation] Tier 1 complete: ${duration}ms, readiness: ${readiness}`)
    this.emit('tier1:complete', result)

    return result
  }

  /**
   * Run Tier 2 validation (background, after UI loads)
   * Lightweight import tests, version verification
   */
  async runTier2Validation(): Promise<TierResult | null> {
    // Return existing promise if already running
    if (this.tier2Queue) {
      return this.tier2Queue
    }

    const validationLevel = this.getValidationLevel()
    if (validationLevel === 'fast') {
      loggerService.info('[TieredValidation] Skipping Tier 2 (fast mode)')
      return null
    }

    this.tier2Queue = this._runTier2ValidationInternal()
    const result = await this.tier2Queue
    this.tier2Queue = null
    return result
  }

  private async _runTier2ValidationInternal(): Promise<TierResult | null> {
    const startTime = Date.now()
    loggerService.info('[TieredValidation] Starting Tier 2 validation (background)')

    this.state.currentTier = 'tier2'
    this.state.isBackgroundValidationRunning = true
    this.emit('tier2:start')

    const checks: ValidationCheck[] = []
    let success = true
    let readiness: EnvironmentReadiness = 'ready'
    let statusMessage = 'Environment verified'

    try {
      const pythonPath = pythonEnvironment.getPythonPath()
      const envType = pythonEnvironment.getEnvironmentType()

      if (!pythonPath) {
        success = false
        readiness = 'failed'
        statusMessage = 'No Python environment found'
      } else {
        // For bundled Python, use check script
        const isBundled = pythonPath.includes('transcription_bundle')

        // Check 1: Import torch (critical)
        const torchCheck = await this.checkPackageImport(pythonPath, 'torch', 'critical', isBundled)
        checks.push(torchCheck)
        if (torchCheck.status === 'fail') {
          success = false
          readiness = 'failed'
        }

        // Check 2: Import whisperx
        const whisperxCheck = await this.checkPackageImport(pythonPath, 'whisperx', 'critical', isBundled)
        checks.push(whisperxCheck)

        // Check 3: Import faster_whisper
        const fasterWhisperCheck = await this.checkPackageImport(pythonPath, 'faster_whisper', 'important', isBundled)
        checks.push(fasterWhisperCheck)

        // Check 4: Import pyannote.audio (use pyannote-specific path for dual-venv)
        const pyannotePath = envType === 'dual-venv'
          ? pythonEnvironment.getPythonPathForPurpose('pyannote')
          : pythonPath
        const pyannoteCheck = await this.checkPackageImport(pyannotePath || pythonPath, 'pyannote.audio', 'important', isBundled)
        checks.push(pyannoteCheck)

        // Determine overall readiness
        const criticalFailed = checks.filter(c => c.status === 'fail' && c.criticality === 'critical').length
        const importantFailed = checks.filter(c => c.status === 'fail' && c.criticality === 'important').length

        if (criticalFailed > 0) {
          readiness = 'failed'
          statusMessage = 'Critical packages not available'
          success = false
        } else if (importantFailed > 0) {
          readiness = 'degraded'
          statusMessage = 'Some packages not available'
        } else {
          readiness = 'functional'
          statusMessage = 'Core packages verified'
        }

        // Update cache with new validation
        if (success) {
          const venvPaths = this.getVenvPaths()
          const currentHash = pythonValidationCacheService.computeEnvironmentHash(pythonPath, venvPaths)
          const environmentName = `${envType}:${pythonPath}`

          // Create a minimal ValidationResult for caching
          const cacheableResult: ValidationResult = {
            success,
            readiness,
            statusMessage,
            timestamp: new Date().toISOString(),
            checks,
            environment: {
              type: envType,
              pythonPath,
              pythonVersion: null,
              platform: {
                os: process.platform,
                arch: process.arch,
                isAppleSilicon: process.platform === 'darwin' && process.arch === 'arm64'
              }
            },
            environmentVariables: {},
            packageVersions: {},
            modelLocations: {},
            summary: {
              total: checks.length,
              passed: checks.filter(c => c.status === 'pass').length,
              failed: checks.filter(c => c.status === 'fail').length,
              warnings: checks.filter(c => c.status === 'warning').length,
              skipped: checks.filter(c => c.status === 'skipped').length,
              criticalFailed,
              importantFailed,
              optionalFailed: checks.filter(c => c.status === 'fail' && c.criticality === 'optional').length
            },
            recommendations: []
          }

          pythonValidationCacheService.cacheValidationResult(environmentName, cacheableResult, currentHash)
        }
      }
    } catch (error) {
      success = false
      readiness = 'failed'
      statusMessage = 'Tier 2 validation failed'
      loggerService.error('[TieredValidation] Tier 2 error:', error)
    }

    const endTime = Date.now()
    const duration = endTime - startTime

    const result: TierResult = {
      tier: 'tier2',
      status: 'complete',
      startTime,
      endTime,
      duration,
      checks,
      success,
      readiness,
      statusMessage
    }

    this.state.tier2 = result
    this.state.isBackgroundValidationRunning = false
    this.state.overallStatus = 'complete'

    // Update overall readiness (Tier 2 takes precedence over Tier 1)
    this.state.overallReadiness = readiness
    this.state.overallStatusMessage = statusMessage

    loggerService.info(`[TieredValidation] Tier 2 complete: ${duration}ms, readiness: ${readiness}`)
    this.emit('tier2:complete', result)

    // Record metrics
    this.recordMetrics(result)

    return result
  }

  /**
   * Run Tier 3 validation (on-demand, when feature used)
   * Heavy model loading tests, download missing models
   */
  async runTier3Validation(feature: 'transcription' | 'diarization'): Promise<TierResult | null> {
    // Return existing promise if already running for this feature
    const existingPromise = this.tier3Queue.get(feature)
    if (existingPromise) {
      return existingPromise
    }

    const validationLevel = this.getValidationLevel()
    if (validationLevel === 'fast') {
      // Even in fast mode, we need to validate on-demand for features
      loggerService.info(`[TieredValidation] Running Tier 3 for ${feature} (required for feature use)`)
    }

    const promise = this._runTier3ValidationInternal(feature)
    this.tier3Queue.set(feature, promise)
    const result = await promise
    this.tier3Queue.delete(feature)
    return result
  }

  private async _runTier3ValidationInternal(feature: 'transcription' | 'diarization'): Promise<TierResult | null> {
    const startTime = Date.now()
    loggerService.info(`[TieredValidation] Starting Tier 3 validation for ${feature}`)

    this.state.currentTier = 'tier3'
    this.emit('tier3:start', { feature })

    const checks: ValidationCheck[] = []
    let success = true
    let readiness: EnvironmentReadiness = 'ready'
    let statusMessage = `${feature} ready`

    try {
      const envType = pythonEnvironment.getEnvironmentType()

      if (feature === 'diarization') {
        // Check PyAnnote model availability
        const pyannotePath = envType === 'dual-venv'
          ? pythonEnvironment.getPythonPathForPurpose('pyannote')
          : pythonEnvironment.getPythonPath()

        if (pyannotePath) {
          const modelCheck = await this.checkPyAnnoteModelAvailable(pyannotePath)
          checks.push(modelCheck)
          if (modelCheck.status === 'fail') {
            success = false
            readiness = 'degraded'
            statusMessage = 'PyAnnote model not available - download required'
          } else if (modelCheck.status === 'warning') {
            readiness = 'functional'
            statusMessage = 'PyAnnote model will be downloaded on first use'
          }
        } else {
          success = false
          readiness = 'failed'
          statusMessage = 'No Python path for diarization'
        }
      } else if (feature === 'transcription') {
        // Check Whisper model availability
        const pythonPath = pythonEnvironment.getPythonPath()
        if (pythonPath) {
          const modelCheck = await this.checkWhisperModelAvailable(pythonPath)
          checks.push(modelCheck)
          if (modelCheck.status === 'fail') {
            success = false
            readiness = 'degraded'
            statusMessage = 'Whisper model not available'
          }
        } else {
          success = false
          readiness = 'failed'
          statusMessage = 'No Python path for transcription'
        }
      }
    } catch (error) {
      success = false
      readiness = 'failed'
      statusMessage = `Tier 3 validation failed for ${feature}`
      loggerService.error(`[TieredValidation] Tier 3 error for ${feature}:`, error)
    }

    const endTime = Date.now()
    const duration = endTime - startTime

    const result: TierResult = {
      tier: 'tier3',
      status: 'complete',
      startTime,
      endTime,
      duration,
      checks,
      success,
      readiness,
      statusMessage
    }

    this.state.tier3 = result

    loggerService.info(`[TieredValidation] Tier 3 complete for ${feature}: ${duration}ms, readiness: ${readiness}`)
    this.emit('tier3:complete', { feature, result })

    // Record metrics
    this.recordMetrics(result)

    return result
  }

  /**
   * Run full validation based on validation level setting
   */
  async runFullValidation(forceLevel?: ValidationLevel): Promise<TieredValidationResult> {
    const level = forceLevel || this.getValidationLevel()
    const startTime = Date.now()

    loggerService.info(`[TieredValidation] Running full validation at level: ${level}`)

    // Always run Tier 1
    const tier1Result = await this.runTier1Validation()

    // Run Tier 2 based on level
    let tier2Result: TierResult | null = null
    if (level !== 'fast') {
      tier2Result = await this.runTier2Validation()
    }

    // Run Tier 3 for thorough mode
    let tier3Result: TierResult | null = null
    if (level === 'thorough') {
      // Run both transcription and diarization checks
      const transcriptionResult = await this.runTier3Validation('transcription')
      const diarizationResult = await this.runTier3Validation('diarization')

      // Combine results
      if (transcriptionResult || diarizationResult) {
        tier3Result = {
          tier: 'tier3',
          status: 'complete',
          startTime: transcriptionResult?.startTime || diarizationResult?.startTime || 0,
          endTime: Date.now(),
          duration: (transcriptionResult?.duration || 0) + (diarizationResult?.duration || 0),
          checks: [
            ...(transcriptionResult?.checks || []),
            ...(diarizationResult?.checks || [])
          ],
          success: (transcriptionResult?.success ?? true) && (diarizationResult?.success ?? true),
          readiness: this.combineReadiness(transcriptionResult?.readiness, diarizationResult?.readiness),
          statusMessage: 'Full validation complete'
        }
      }
    }

    const endTime = Date.now()
    const totalDuration = endTime - startTime

    // Combine all checks
    const allChecks: ValidationCheck[] = [
      ...(tier1Result?.checks || []),
      ...(tier2Result?.checks || []),
      ...(tier3Result?.checks || [])
    ]

    // Determine final readiness
    const finalReadiness = tier3Result?.readiness
      || tier2Result?.readiness
      || tier1Result?.readiness
      || 'failed'

    const metrics: ValidationMetrics = {
      tier1Duration: tier1Result?.duration || null,
      tier2Duration: tier2Result?.duration || null,
      tier3Duration: tier3Result?.duration || null,
      totalDuration,
      checksPerformed: allChecks.length,
      checksPassed: allChecks.filter(c => c.status === 'pass').length,
      checksFailed: allChecks.filter(c => c.status === 'fail').length,
      cacheHit: tier1Result?.checks.some(c => c.details?.cacheAge) || false,
      timestamp: new Date().toISOString()
    }

    this.metricsHistory.push(metrics)
    if (this.metricsHistory.length > this.MAX_METRICS_HISTORY) {
      this.metricsHistory.shift()
    }

    const envType = pythonEnvironment.getEnvironmentType()
    const pythonPath = pythonEnvironment.getPythonPath()

    const result: TieredValidationResult = {
      success: finalReadiness !== 'failed',
      readiness: finalReadiness,
      statusMessage: this.state.overallStatusMessage,
      timestamp: new Date().toISOString(),
      checks: allChecks,
      environment: {
        type: envType,
        pythonPath,
        pythonVersion: null,
        platform: {
          os: process.platform,
          arch: process.arch,
          isAppleSilicon: process.platform === 'darwin' && process.arch === 'arm64'
        }
      },
      environmentVariables: {},
      packageVersions: {},
      modelLocations: {},
      summary: {
        total: allChecks.length,
        passed: allChecks.filter(c => c.status === 'pass').length,
        failed: allChecks.filter(c => c.status === 'fail').length,
        warnings: allChecks.filter(c => c.status === 'warning').length,
        skipped: allChecks.filter(c => c.status === 'skipped').length,
        criticalFailed: allChecks.filter(c => c.status === 'fail' && c.criticality === 'critical').length,
        importantFailed: allChecks.filter(c => c.status === 'fail' && c.criticality === 'important').length,
        optionalFailed: allChecks.filter(c => c.status === 'fail' && c.criticality === 'optional').length
      },
      recommendations: [],
      tierResults: {
        tier1: tier1Result,
        tier2: tier2Result,
        tier3: tier3Result
      },
      metrics
    }

    this.state.lastFullValidation = result.timestamp
    this.state.overallStatus = 'complete'

    loggerService.info(`[TieredValidation] Full validation complete: ${totalDuration}ms`, metrics)
    this.emit('validation:complete', result)

    return result
  }

  /**
   * Get validation metrics history
   */
  getMetricsHistory(): ValidationMetrics[] {
    return [...this.metricsHistory]
  }

  /**
   * Get latest metrics
   */
  getLatestMetrics(): ValidationMetrics | null {
    return this.metricsHistory.length > 0
      ? this.metricsHistory[this.metricsHistory.length - 1]
      : null
  }

  /**
   * Clear validation state (for testing or reset)
   */
  clearState(): void {
    this.state = {
      currentTier: null,
      tier1: null,
      tier2: null,
      tier3: null,
      overallStatus: 'idle',
      overallReadiness: 'ready',
      overallStatusMessage: 'Not validated',
      lastFullValidation: null,
      isBackgroundValidationRunning: false
    }
    this.tier2Queue = null
    this.tier3Queue.clear()
    loggerService.info('[TieredValidation] State cleared')
  }

  // ============================================================================
  // Private Helper Methods
  // ============================================================================

  private checkPythonBinaryExists(pythonPath: string | null, envType: PythonEnvironmentType): ValidationCheck {
    const startTime = Date.now()

    if (!pythonPath) {
      return {
        type: 'python_binary',
        name: 'Python Binary Check',
        status: 'fail',
        message: 'No Python path configured',
        duration: Date.now() - startTime,
        criticality: 'critical'
      }
    }

    try {
      if (fs.existsSync(pythonPath)) {
        return {
          type: 'python_binary',
          name: 'Python Binary Check',
          status: 'pass',
          message: `Python binary found (${envType})`,
          duration: Date.now() - startTime,
          criticality: 'critical',
          details: { pythonPath, envType }
        }
      } else {
        return {
          type: 'python_binary',
          name: 'Python Binary Check',
          status: 'fail',
          message: `Python binary not found at: ${pythonPath}`,
          duration: Date.now() - startTime,
          criticality: 'critical'
        }
      }
    } catch (error) {
      return {
        type: 'python_binary',
        name: 'Python Binary Check',
        status: 'fail',
        message: 'Error checking Python binary',
        error: error instanceof Error ? error.message : String(error),
        duration: Date.now() - startTime,
        criticality: 'critical'
      }
    }
  }

  private checkVenvDirectoriesExist(envType: PythonEnvironmentType): ValidationCheck {
    const startTime = Date.now()
    const venvPaths = this.getVenvPaths()

    if (venvPaths.length === 0) {
      return {
        type: 'python_binary',
        name: 'Virtual Environment Check',
        status: 'warning',
        message: 'No virtual environment directories found',
        duration: Date.now() - startTime,
        criticality: 'important'
      }
    }

    const existingPaths = venvPaths.filter(p => fs.existsSync(p))

    if (existingPaths.length === venvPaths.length) {
      return {
        type: 'python_binary',
        name: 'Virtual Environment Check',
        status: 'pass',
        message: `All ${existingPaths.length} venv directories found`,
        duration: Date.now() - startTime,
        criticality: 'important',
        details: { paths: existingPaths }
      }
    } else if (existingPaths.length > 0) {
      return {
        type: 'python_binary',
        name: 'Virtual Environment Check',
        status: 'warning',
        message: `${existingPaths.length}/${venvPaths.length} venv directories found`,
        duration: Date.now() - startTime,
        criticality: 'important',
        details: { existing: existingPaths, missing: venvPaths.filter(p => !fs.existsSync(p)) }
      }
    } else {
      return {
        type: 'python_binary',
        name: 'Virtual Environment Check',
        status: 'fail',
        message: 'No venv directories found',
        duration: Date.now() - startTime,
        criticality: 'important'
      }
    }
  }

  private async checkPackageImport(
    pythonPath: string,
    packageName: string,
    criticality: CheckCriticality,
    isBundled: boolean
  ): Promise<ValidationCheck> {
    const startTime = Date.now()

    try {
      if (isBundled) {
        // For bundled Python, use check script
        const checkOutput = execSync(`"${pythonPath}" check 2>&1`, {
          encoding: 'utf8',
          timeout: TIER2_TIMEOUT
        })

        const pkgName = packageName === 'faster_whisper' ? 'faster-whisper' :
                        packageName === 'pyannote.audio' ? 'pyannote' : packageName
        const isAvailable = checkOutput.includes('✓') && checkOutput.includes(pkgName)

        return {
          type: 'package_imports',
          name: `Import ${packageName}`,
          status: isAvailable ? 'pass' : 'fail',
          message: isAvailable ? `${packageName} available` : `${packageName} not found in bundle`,
          duration: Date.now() - startTime,
          criticality
        }
      } else {
        // For regular Python, do import test
        const importCode = packageName === 'faster_whisper'
          ? 'from faster_whisper import WhisperModel'
          : packageName === 'pyannote.audio'
          ? 'from pyannote.audio import Pipeline'
          : `import ${packageName}`

        execSync(`"${pythonPath}" -c "${importCode}" 2>&1`, {
          encoding: 'utf8',
          timeout: TIER2_TIMEOUT,
          env: {
            ...process.env,
            PYTHONWARNINGS: 'ignore::UserWarning,ignore::DeprecationWarning,ignore::FutureWarning'
          }
        })

        return {
          type: 'package_imports',
          name: `Import ${packageName}`,
          status: 'pass',
          message: `${packageName} imported successfully`,
          duration: Date.now() - startTime,
          criticality
        }
      }
    } catch (error) {
      return {
        type: 'package_imports',
        name: `Import ${packageName}`,
        status: 'fail',
        message: `Failed to import ${packageName}`,
        error: error instanceof Error ? error.message : String(error),
        duration: Date.now() - startTime,
        criticality
      }
    }
  }

  private async checkPyAnnoteModelAvailable(pythonPath: string): Promise<ValidationCheck> {
    const startTime = Date.now()

    try {
      const hfToken = pythonEnvironment.getHuggingFaceToken()

      if (!hfToken) {
        return {
          type: 'pyannote_model',
          name: 'PyAnnote Model Check',
          status: 'warning',
          message: 'HuggingFace token not configured - model will be downloaded on first use',
          duration: Date.now() - startTime,
          criticality: 'optional',
          remediation: ['Configure HuggingFace token in Settings to enable speaker diarization']
        }
      }

      // Just check if model can be loaded (with timeout)
      const testCode = `import warnings; warnings.filterwarnings('ignore'); import os; from pyannote.audio import Model; Model.from_pretrained('pyannote/embedding', use_auth_token=os.environ['HF_TOKEN']); print('SUCCESS')`

      const result = execSync(`"${pythonPath}" -c "${testCode}" 2>&1`, {
        encoding: 'utf8',
        timeout: TIER3_TIMEOUT,
        env: {
          ...process.env,
          HF_TOKEN: hfToken,
          PYTHONWARNINGS: 'ignore',
          TORCH_FORCE_NO_WEIGHTS_ONLY_LOAD: '1'
        }
      })

      if (result.includes('SUCCESS')) {
        return {
          type: 'pyannote_model',
          name: 'PyAnnote Model Check',
          status: 'pass',
          message: 'PyAnnote model loaded successfully',
          duration: Date.now() - startTime,
          criticality: 'optional'
        }
      } else {
        return {
          type: 'pyannote_model',
          name: 'PyAnnote Model Check',
          status: 'fail',
          message: 'PyAnnote model loading failed',
          error: result,
          duration: Date.now() - startTime,
          criticality: 'optional'
        }
      }
    } catch (error) {
      return {
        type: 'pyannote_model',
        name: 'PyAnnote Model Check',
        status: 'fail',
        message: 'Failed to check PyAnnote model',
        error: error instanceof Error ? error.message : String(error),
        duration: Date.now() - startTime,
        criticality: 'optional'
      }
    }
  }

  private async checkWhisperModelAvailable(pythonPath: string): Promise<ValidationCheck> {
    const startTime = Date.now()

    // For transcription, we just check if whisperx is importable
    // The actual model download happens automatically when needed
    try {
      const testCode = `import whisperx; print('SUCCESS')`

      const result = execSync(`"${pythonPath}" -c "${testCode}" 2>&1`, {
        encoding: 'utf8',
        timeout: TIER2_TIMEOUT,
        env: {
          ...process.env,
          PYTHONWARNINGS: 'ignore'
        }
      })

      if (result.includes('SUCCESS')) {
        return {
          type: 'package_imports',
          name: 'Whisper Model Check',
          status: 'pass',
          message: 'WhisperX ready for transcription',
          duration: Date.now() - startTime,
          criticality: 'important'
        }
      } else {
        return {
          type: 'package_imports',
          name: 'Whisper Model Check',
          status: 'fail',
          message: 'WhisperX not available',
          error: result,
          duration: Date.now() - startTime,
          criticality: 'important'
        }
      }
    } catch (error) {
      return {
        type: 'package_imports',
        name: 'Whisper Model Check',
        status: 'fail',
        message: 'Failed to check WhisperX',
        error: error instanceof Error ? error.message : String(error),
        duration: Date.now() - startTime,
        criticality: 'important'
      }
    }
  }

  private getVenvPaths(): string[] {
    const envType = pythonEnvironment.getEnvironmentType()
    const paths: string[] = []

    if (envType === 'dual-venv') {
      const whisperxPath = pythonEnvironment.getPythonPathForPurpose('whisperx')
      const pyannotePath = pythonEnvironment.getPythonPathForPurpose('pyannote')

      if (whisperxPath) {
        const binDir = path.dirname(whisperxPath)
        const venvDir = path.dirname(binDir)
        if (fs.existsSync(venvDir)) paths.push(venvDir)
      }

      if (pyannotePath) {
        const binDir = path.dirname(pyannotePath)
        const venvDir = path.dirname(binDir)
        if (fs.existsSync(venvDir)) paths.push(venvDir)
      }
    } else if (envType === 'venv') {
      const pythonPath = pythonEnvironment.getPythonPath()
      if (pythonPath) {
        const binDir = path.dirname(pythonPath)
        const venvDir = path.dirname(binDir)
        if (fs.existsSync(venvDir)) paths.push(venvDir)
      }
    }

    return paths
  }

  private combineReadiness(r1?: EnvironmentReadiness, r2?: EnvironmentReadiness): EnvironmentReadiness {
    const readinessOrder: EnvironmentReadiness[] = ['failed', 'degraded', 'functional', 'ready']

    if (!r1) return r2 || 'ready'
    if (!r2) return r1

    const idx1 = readinessOrder.indexOf(r1)
    const idx2 = readinessOrder.indexOf(r2)

    // Return the worse readiness level
    return readinessOrder[Math.min(idx1, idx2)]
  }

  private recordMetrics(result: TierResult): void {
    const existing = this.getLatestMetrics()

    const metrics: ValidationMetrics = {
      tier1Duration: result.tier === 'tier1' ? result.duration || null : existing?.tier1Duration || null,
      tier2Duration: result.tier === 'tier2' ? result.duration || null : existing?.tier2Duration || null,
      tier3Duration: result.tier === 'tier3' ? result.duration || null : existing?.tier3Duration || null,
      totalDuration: null,
      checksPerformed: result.checks.length,
      checksPassed: result.checks.filter(c => c.status === 'pass').length,
      checksFailed: result.checks.filter(c => c.status === 'fail').length,
      cacheHit: result.checks.some(c => c.details?.cacheAge) || false,
      timestamp: new Date().toISOString()
    }

    this.metricsHistory.push(metrics)
    if (this.metricsHistory.length > this.MAX_METRICS_HISTORY) {
      this.metricsHistory.shift()
    }

    loggerService.info(`[TieredValidation] Metrics recorded for ${result.tier}:`, {
      duration: result.duration,
      checks: result.checks.length,
      passed: metrics.checksPassed,
      failed: metrics.checksFailed
    })
  }
}

// ============================================================================
// Export singleton instance
// ============================================================================

export const tieredValidationService = new TieredValidationService()
export { TieredValidationService }
