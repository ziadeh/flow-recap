/**
 * Python Environment Validation Service
 *
 * Comprehensive validation and diagnostics for Python environment used in
 * bundled application builds. Diagnoses initialization failures and provides
 * actionable remediation steps.
 *
 * Features:
 * - Python binary accessibility checks
 * - Python version validation
 * - Critical package import tests
 * - PyAnnote model loading verification
 * - Native dependency checks (CUDA/MPS)
 * - File permission validation
 * - Subprocess spawning tests
 * - Environment variable propagation tests
 * - Auto-repair functionality
 * - Detailed error reporting with remediation steps
 */

import { execSync, spawn } from 'child_process'
import * as fs from 'fs'
import * as path from 'path'
import * as os from 'os'
import { EventEmitter } from 'events'
import { pythonEnvironment, PythonEnvironmentType } from './pythonEnvironment'
import { loggerService } from './loggerService'
import { pythonValidationCacheService } from './pythonValidationCacheService'
import { windowsPythonDiagnostics, WindowsDiagnosticsResult } from './windowsPythonDiagnostics'

// ============================================================================
// Types
// ============================================================================

export type ValidationCheckType =
  | 'python_binary'
  | 'python_version'
  | 'package_imports'
  | 'pyannote_model'
  | 'native_dependencies'
  | 'file_permissions'
  | 'subprocess_spawn'
  | 'env_propagation'
  | 'dual_environment'
  | 'torch_version'
  | 'windows_diagnostics'

export type ValidationStatus = 'pass' | 'fail' | 'warning' | 'skipped'

/**
 * Overall environment readiness level
 * - ready: All packages + models work
 * - functional: Core packages work, optional features may not work
 * - degraded: Missing optional dependencies, basic operations may work
 * - failed: Critical imports fail, environment unusable
 */
export type EnvironmentReadiness = 'ready' | 'functional' | 'degraded' | 'failed'

/**
 * Check criticality level
 * - critical: Must pass for environment to be usable (imports, python binary)
 * - important: Should pass for full functionality (model loading)
 * - optional: Nice to have but not required (GPU, speechbrain)
 */
export type CheckCriticality = 'critical' | 'important' | 'optional'

export interface ValidationCheck {
  /** Type of validation check */
  type: ValidationCheckType
  /** Friendly name for the check */
  name: string
  /** Check status */
  status: ValidationStatus
  /** Detailed message */
  message: string
  /** Error details if failed */
  error?: string
  /** Remediation steps if failed */
  remediation?: string[]
  /** Time taken to run check (ms) */
  duration: number
  /** Additional diagnostic data */
  details?: Record<string, unknown>
  /** Criticality level - determines if failure affects overall status */
  criticality: CheckCriticality
}

export interface ValidationResult {
  /** Overall success status (true if no critical failures) */
  success: boolean
  /** Overall environment readiness level */
  readiness: EnvironmentReadiness
  /** Human-readable status message for display */
  statusMessage: string
  /** Timestamp of validation */
  timestamp: string
  /** All validation checks */
  checks: ValidationCheck[]
  /** Python environment info */
  environment: {
    type: PythonEnvironmentType
    pythonPath: string | null
    pythonVersion: string | null
    platform: {
      os: string
      arch: string
      isAppleSilicon: boolean
    }
  }
  /** Environment variables (sanitized) */
  environmentVariables: Record<string, string>
  /** Package versions */
  packageVersions: Record<string, string>
  /** Model file locations */
  modelLocations: Record<string, string | null>
  /** Summary of issues */
  summary: {
    total: number
    passed: number
    failed: number
    warnings: number
    skipped: number
    criticalFailed: number
    importantFailed: number
    optionalFailed: number
  }
  /** Recommendations */
  recommendations: string[]
  /** Dual environment paths (if using dual-venv setup) */
  dualEnvironment?: {
    whisperxPath: string | null
    pyannotePath: string | null
    whisperxReady: boolean
    pyannoteReady: boolean
    /** Pyannote environment readiness level */
    pyannoteReadiness?: EnvironmentReadiness
    /** WhisperX environment readiness level */
    whisperxReadiness?: EnvironmentReadiness
    /** Pyannote status message */
    pyannoteStatusMessage?: string
    /** WhisperX status message */
    whisperxStatusMessage?: string
  }
  /** Cache information */
  cacheInfo?: {
    /** Whether this result was loaded from cache */
    fromCache: boolean
    /** When the cached result was originally validated */
    cachedAt?: string
    /** Age of cache in hours */
    cacheAgeHours?: number
    /** Whether lightweight validation was used */
    lightweightValidation?: boolean
  }
  /** Windows-specific diagnostics (only present on Windows) */
  windowsDiagnostics?: WindowsDiagnosticsResult
}

export interface AutoRepairResult {
  /** Whether repair was successful */
  success: boolean
  /** Actions that were attempted */
  actionsAttempted: string[]
  /** Actions that succeeded */
  actionsSucceeded: string[]
  /** Actions that failed */
  actionsFailed: string[]
  /** Detailed logs */
  logs: string[]
  /** Validation result after repair */
  validationAfter?: ValidationResult
}

// ============================================================================
// Python Environment Validator Service
// ============================================================================

class PythonEnvironmentValidatorService extends EventEmitter {
  private cachedValidation: ValidationResult | null = null
  private cacheTimestamp: number = 0
  private readonly CACHE_TTL = 30000 // 30 seconds (in-memory cache for fast consecutive calls)

  /**
   * Run comprehensive validation of Python environment
   *
   * When smart checking is enabled (default), this will:
   * 1. Check database cache first (24-hour TTL, hash-based invalidation)
   * 2. If cache valid, run lightweight verification (just critical imports)
   * 3. If lightweight check passes, return cached result
   * 4. Otherwise, run full validation and update cache
   */
  async validateEnvironment(forceRefresh = false): Promise<ValidationResult> {
    // Return in-memory cached result if valid (for fast consecutive calls)
    if (!forceRefresh && this.cachedValidation && Date.now() - this.cacheTimestamp < this.CACHE_TTL) {
      return this.cachedValidation
    }

    // Check if smart environment checking is enabled
    const smartCheckingEnabled = pythonValidationCacheService.isSmartCheckingEnabled()

    // Get Python environment info for cache key
    const envType = pythonEnvironment.getEnvironmentType()
    const pythonPath = pythonEnvironment.getPythonPath()
    const environmentName = `${envType}:${pythonPath || 'none'}`

    // Check database cache if smart checking is enabled and not forcing refresh
    if (smartCheckingEnabled && !forceRefresh) {
      const venvPaths = this.getVenvPaths()
      const currentHash = pythonValidationCacheService.computeEnvironmentHash(pythonPath, venvPaths)
      const cacheResult = pythonValidationCacheService.getCachedValidation(environmentName, currentHash)

      if (cacheResult.hasValidCache && cacheResult.cachedResult) {
        loggerService.info(`[PythonValidator] Found valid cache (age: ${cacheResult.cacheAgeHours?.toFixed(1)}h)`)

        // Run lightweight validation to verify critical imports still work
        const lightweightResult = await this.runLightweightValidation(pythonPath)

        // FIX: Only use cached result if BOTH:
        // 1. Lightweight validation passes (imports work)
        // 2. Cached result was successful (ready, functional, or degraded - not failed)
        // If cached result is 'failed' but lightweight passes, the environment was likely fixed - run full validation
        const cachedReadiness = cacheResult.cachedResult.readiness
        const cachedWasSuccessful = cachedReadiness === 'ready' || cachedReadiness === 'functional' || cachedReadiness === 'degraded'

        if (lightweightResult.success && cachedWasSuccessful) {
          loggerService.info('[PythonValidator] Lightweight validation passed and cache was successful, using cached result')

          // Return cached result with cache info
          const cachedResult: ValidationResult = {
            ...cacheResult.cachedResult,
            timestamp: new Date().toISOString(), // Update timestamp to current
            cacheInfo: {
              fromCache: true,
              cachedAt: cacheResult.cachedResult.timestamp,
              cacheAgeHours: cacheResult.cacheAgeHours,
              lightweightValidation: true
            }
          }

          // Update in-memory cache
          this.cachedValidation = cachedResult
          this.cacheTimestamp = Date.now()

          this.emit('validation:complete', cachedResult)
          return cachedResult
        } else if (lightweightResult.success && !cachedWasSuccessful) {
          loggerService.info('[PythonValidator] Lightweight validation passed but cache had failed status, running full validation to update status')
          // Environment was likely fixed since last check - run full validation to update cache
        } else {
          loggerService.info('[PythonValidator] Lightweight validation failed, running full validation')
        }
      } else {
        loggerService.info(`[PythonValidator] Cache invalid: ${cacheResult.invalidationReason}`)
      }
    }

    loggerService.info('[PythonValidator] Starting full environment validation')
    this.emit('validation:start')

    const checks: ValidationCheck[] = []
    const packageVersions: Record<string, string> = {}
    const modelLocations: Record<string, string | null> = {}

    // Note: envType and pythonPath already defined above for cache key computation
    // Debug logging to diagnose path issues
    loggerService.info(`[PythonValidator] Environment type: ${envType}`)
    loggerService.info(`[PythonValidator] Python path: ${pythonPath}`)

    const platform = {
      os: process.platform,
      arch: process.arch,
      isAppleSilicon: process.platform === 'darwin' && process.arch === 'arm64',
    }

    let pythonVersion: string | null = null

    // Check 1: Python binary accessibility
    checks.push(await this.checkPythonBinary(pythonPath, envType))

    // Check 2: Python version
    if (pythonPath) {
      const versionCheck = await this.checkPythonVersion(pythonPath)
      checks.push(versionCheck)
      if (versionCheck.details?.version) {
        pythonVersion = versionCheck.details.version as string
      }
    } else {
      checks.push({
        type: 'python_version',
        name: 'Python Version Validation',
        status: 'skipped',
        message: 'Skipped: No Python binary found',
        duration: 0,
        criticality: 'critical',
      })
    }

    // Check 3: Package imports
    if (pythonPath) {
      const packageCheck = await this.checkPackageImports(pythonPath)
      checks.push(packageCheck)
      if (packageCheck.details?.versions) {
        Object.assign(packageVersions, packageCheck.details.versions)
      }
    } else {
      checks.push({
        type: 'package_imports',
        name: 'Critical Package Imports',
        status: 'skipped',
        message: 'Skipped: No Python binary found',
        duration: 0,
        criticality: 'critical',
      })
    }

    // Check 4: PyAnnote model loading
    // For dual-venv, use pyannote-specific Python path instead of generic path
    const pyannotePythonPath = envType === 'dual-venv'
      ? pythonEnvironment.getPythonPathForPurpose('pyannote')
      : pythonPath

    if (pyannotePythonPath) {
      const modelCheck = await this.checkPyAnnoteModel(pyannotePythonPath)
      checks.push(modelCheck)
      if (modelCheck.details?.modelPath) {
        modelLocations['pyannote_embedding'] = modelCheck.details.modelPath as string
      }
    } else {
      checks.push({
        type: 'pyannote_model',
        name: 'PyAnnote Model Loading',
        status: 'skipped',
        message: 'Skipped: No Python binary found',
        duration: 0,
        criticality: 'optional',
      })
    }

    // Check 5: Native dependencies (CUDA/MPS)
    if (pythonPath) {
      checks.push(await this.checkNativeDependencies(pythonPath, platform))
    } else {
      checks.push({
        type: 'native_dependencies',
        name: 'Native Dependencies (CUDA/MPS)',
        status: 'skipped',
        message: 'Skipped: No Python binary found',
        duration: 0,
        criticality: 'optional',
      })
    }

    // Check 6: File permissions
    if (pythonPath) {
      checks.push(await this.checkFilePermissions(pythonPath, envType))
    } else {
      checks.push({
        type: 'file_permissions',
        name: 'File Permissions',
        status: 'skipped',
        message: 'Skipped: No Python binary found',
        duration: 0,
        criticality: 'important',
      })
    }

    // Check 7: Subprocess spawning
    if (pythonPath) {
      checks.push(await this.checkSubprocessSpawning(pythonPath))
    } else {
      checks.push({
        type: 'subprocess_spawn',
        name: 'Subprocess Spawning',
        status: 'skipped',
        message: 'Skipped: No Python binary found',
        duration: 0,
        criticality: 'critical',
      })
    }

    // Check 8: Environment variable propagation
    if (pythonPath) {
      checks.push(await this.checkEnvPropagation(pythonPath))
    } else {
      checks.push({
        type: 'env_propagation',
        name: 'Environment Variable Propagation',
        status: 'skipped',
        message: 'Skipped: No Python binary found',
        duration: 0,
        criticality: 'important',
      })
    }

    // Check 9: Dual environment validation (for torch version conflicts)
    checks.push(await this.checkDualEnvironment())

    // Check 10: Windows-specific diagnostics (only on Windows)
    let windowsDiagnosticsResult: WindowsDiagnosticsResult | undefined
    if (process.platform === 'win32') {
      const windowsCheck = await this.checkWindowsDiagnostics()
      checks.push(windowsCheck)
      windowsDiagnosticsResult = windowsCheck.details?.windowsDiagnostics as WindowsDiagnosticsResult | undefined
    }

    // Calculate summary with criticality breakdown
    const criticalFailed = checks.filter((c) => c.status === 'fail' && c.criticality === 'critical').length
    const importantFailed = checks.filter((c) => c.status === 'fail' && c.criticality === 'important').length
    const optionalFailed = checks.filter((c) => c.status === 'fail' && c.criticality === 'optional').length

    const summary = {
      total: checks.length,
      passed: checks.filter((c) => c.status === 'pass').length,
      failed: checks.filter((c) => c.status === 'fail').length,
      warnings: checks.filter((c) => c.status === 'warning').length,
      skipped: checks.filter((c) => c.status === 'skipped').length,
      criticalFailed,
      importantFailed,
      optionalFailed,
    }

    // Determine readiness level based on criticality of failures
    // - ready: All checks pass (or only optional warnings)
    // - functional: Core packages work, optional features may not work (e.g., model loading not tested)
    // - degraded: Important checks failed but critical ones pass
    // - failed: Critical imports fail
    let readiness: EnvironmentReadiness = 'ready'
    let statusMessage = ''

    if (criticalFailed > 0) {
      readiness = 'failed'
      statusMessage = 'Environment failed: Critical components not working. Transcription/diarization will not work.'
    } else if (importantFailed > 0) {
      readiness = 'degraded'
      statusMessage = `Environment degraded: ${importantFailed} important check(s) failed. Some features may not work correctly.`
    } else if (optionalFailed > 0 || summary.warnings > 0) {
      readiness = 'functional'
      // Generate a user-friendly message about what's optional
      const optionalIssues: string[] = []
      for (const check of checks) {
        if (check.status === 'fail' && check.criticality === 'optional') {
          if (check.type === 'pyannote_model') {
            optionalIssues.push('Model loading not tested - will verify on first use')
          } else if (check.type === 'native_dependencies') {
            optionalIssues.push('GPU acceleration not detected - will use CPU')
          } else {
            optionalIssues.push(check.name)
          }
        }
      }
      statusMessage = optionalIssues.length > 0
        ? `Environment functional (${optionalIssues.join(', ')})`
        : 'Environment functional with some warnings'
    } else {
      readiness = 'ready'
      statusMessage = 'Environment ready: All checks passed'
    }

    // Collect recommendations
    const recommendations: string[] = []
    for (const check of checks) {
      if ((check.status === 'fail' || check.status === 'warning') && check.remediation) {
        recommendations.push(...check.remediation)
      }
    }

    // Remove duplicates
    const uniqueRecommendations = [...new Set(recommendations)]

    // Get dual environment status from pythonEnvironment service
    const envStatus = await pythonEnvironment.checkEnvironment()

    // Determine per-environment readiness for dual environment
    let dualEnvironment = envStatus.dualEnvironment
    if (dualEnvironment) {
      // Calculate pyannote-specific readiness
      const pyannoteModelCheck = checks.find(c => c.type === 'pyannote_model')
      const packageCheck = checks.find(c => c.type === 'package_imports')
      const pyannoteImportOk = (packageCheck?.details?.results as Record<string, boolean> | undefined)?.['pyannote.audio'] === true

      if (pyannoteImportOk) {
        if (pyannoteModelCheck?.status === 'pass') {
          dualEnvironment.pyannoteReadiness = 'ready'
          dualEnvironment.pyannoteStatusMessage = 'Ready: Core packages and models verified'
        } else if (pyannoteModelCheck?.status === 'warning' || pyannoteModelCheck?.status === 'fail') {
          dualEnvironment.pyannoteReadiness = 'functional'
          dualEnvironment.pyannoteStatusMessage = 'Functional: Core packages work, model loading will be verified on first use'
        } else {
          dualEnvironment.pyannoteReadiness = 'functional'
          dualEnvironment.pyannoteStatusMessage = 'Functional: Core packages available'
        }
        dualEnvironment.pyannoteReady = true
      } else if (!dualEnvironment.pyannoteReady) {
        dualEnvironment.pyannoteReadiness = 'failed'
        dualEnvironment.pyannoteStatusMessage = 'Failed: pyannote.audio package not importable'
      }

      // Calculate whisperx-specific readiness
      const packageResults = packageCheck?.details?.results as Record<string, boolean> | undefined
      const whisperxImportOk = packageResults?.['whisperx'] === true ||
                               packageResults?.['faster_whisper'] === true

      if (whisperxImportOk) {
        dualEnvironment.whisperxReadiness = 'ready'
        dualEnvironment.whisperxStatusMessage = 'Ready: Transcription packages available'
        dualEnvironment.whisperxReady = true
      } else if (!dualEnvironment.whisperxReady) {
        dualEnvironment.whisperxReadiness = 'failed'
        dualEnvironment.whisperxStatusMessage = 'Failed: whisperx/faster_whisper not importable'
      }
    }

    const result: ValidationResult = {
      success: criticalFailed === 0, // Success if no critical failures
      readiness,
      statusMessage,
      timestamp: new Date().toISOString(),
      checks,
      environment: {
        type: envType,
        pythonPath,
        pythonVersion,
        platform,
      },
      environmentVariables: this.getSanitizedEnvVars(),
      packageVersions,
      modelLocations,
      summary,
      recommendations: uniqueRecommendations,
      // Include dual environment status if available
      dualEnvironment,
      // Mark as fresh validation (not from cache)
      cacheInfo: {
        fromCache: false,
        lightweightValidation: false
      },
      // Include Windows-specific diagnostics if available
      windowsDiagnostics: windowsDiagnosticsResult,
    }

    // Cache result in-memory
    this.cachedValidation = result
    this.cacheTimestamp = Date.now()

    // Also cache to database for persistence across app restarts
    // Note: environmentName already defined at the start of the function
    const freshVenvPaths = this.getVenvPaths()
    const currentHash = pythonValidationCacheService.computeEnvironmentHash(pythonPath, freshVenvPaths)
    pythonValidationCacheService.cacheValidationResult(environmentName, result, currentHash)

    loggerService.info('[PythonValidator] Validation complete', {
      success: result.success,
      readiness: result.readiness,
      statusMessage: result.statusMessage,
      summary: result.summary,
    })
    this.emit('validation:complete', result)

    return result
  }

  /**
   * Check 1: Python binary accessibility
   */
  private async checkPythonBinary(
    pythonPath: string | null,
    envType: PythonEnvironmentType
  ): Promise<ValidationCheck> {
    const startTime = Date.now()
    const check: ValidationCheck = {
      type: 'python_binary',
      name: 'Python Binary Accessibility',
      status: 'fail',
      message: '',
      duration: 0,
      criticality: 'critical', // Critical - without Python nothing works
      details: {
        envType,
        pythonPath,
      },
    }

    try {
      if (!pythonPath) {
        check.status = 'fail'
        check.message = 'No Python environment found'
        check.error = 'Python executable not detected in any search path'
        check.remediation = [
          'Install Python 3.12 and create a virtual environment',
          'Or run "npm run bundle:python" to create a standalone bundle',
          'Set PYTHON_PATH environment variable to point to Python executable',
        ]
        check.duration = Date.now() - startTime
        return check
      }

      // Check if path exists
      if (!fs.existsSync(pythonPath)) {
        check.status = 'fail'
        check.message = `Python binary not found at: ${pythonPath}`
        check.error = 'File does not exist'
        check.remediation = [
          'Verify Python installation',
          'Check PYTHON_PATH environment variable',
          'Reinstall Python or re-bundle the application',
        ]
        check.duration = Date.now() - startTime
        return check
      }

      // Check if executable
      try {
        fs.accessSync(pythonPath, fs.constants.X_OK)
      } catch {
        check.status = 'fail'
        check.message = `Python binary is not executable: ${pythonPath}`
        check.error = 'Missing execute permissions'
        check.remediation = [
          `Run: chmod +x "${pythonPath}"`,
          'Check file permissions and ownership',
        ]
        check.duration = Date.now() - startTime
        return check
      }

      check.status = 'pass'
      check.message = `Python binary found and accessible (${envType} environment)`
      check.duration = Date.now() - startTime
      return check
    } catch (error) {
      check.status = 'fail'
      check.message = 'Failed to verify Python binary'
      check.error = error instanceof Error ? error.message : String(error)
      check.duration = Date.now() - startTime
      return check
    }
  }

  /**
   * Check if Python path is a bundled executable (transcription_bundle)
   */
  private isBundledPython(pythonPath: string): boolean {
    return pythonPath.includes('transcription_bundle')
  }

  /**
   * Check 2: Python version validation
   */
  private async checkPythonVersion(pythonPath: string): Promise<ValidationCheck> {
    const startTime = Date.now()
    const check: ValidationCheck = {
      type: 'python_version',
      name: 'Python Version Validation',
      status: 'fail',
      message: '',
      duration: 0,
      criticality: 'critical', // Critical - wrong Python version breaks imports
    }

    try {
      let versionOutput: string

      // Bundled Python doesn't support --version, use 'check' script
      if (this.isBundledPython(pythonPath)) {
        versionOutput = execSync(`"${pythonPath}" check 2>&1`, {
          encoding: 'utf8',
          timeout: 30000,  // Bundled Python takes longer on first run
        })
      } else {
        versionOutput = execSync(`"${pythonPath}" --version 2>&1`, {
          encoding: 'utf8',
          timeout: 10000,
        })
      }
      versionOutput = versionOutput.trim()

      const versionMatch = versionOutput.match(/Python\s+(\d+\.\d+\.\d+)/)
      if (!versionMatch) {
        check.status = 'fail'
        check.message = 'Could not parse Python version'
        check.error = `Unexpected version output: ${versionOutput}`
        check.duration = Date.now() - startTime
        return check
      }

      const version = versionMatch[1]
      const [major, minor] = version.split('.').map(Number)

      check.details = { version, major, minor }

      // Check for Python 3.12 (expected version)
      if (major === 3 && minor === 12) {
        check.status = 'pass'
        check.message = `Python ${version} (matches expected 3.12)`
      } else if (major === 3 && minor >= 10) {
        check.status = 'warning'
        check.message = `Python ${version} (expected 3.12, but 3.10+ is compatible)`
      } else {
        check.status = 'fail'
        check.message = `Python ${version} is incompatible`
        check.error = 'Requires Python 3.10 or newer (3.12 recommended)'
        check.remediation = [
          'Install Python 3.12',
          'Update virtual environment to use Python 3.12',
          'Re-bundle application with correct Python version',
        ]
      }

      check.duration = Date.now() - startTime
      return check
    } catch (error) {
      check.status = 'fail'
      check.message = 'Failed to check Python version'
      check.error = error instanceof Error ? error.message : String(error)
      check.remediation = ['Verify Python is properly installed', 'Check PATH environment variable']
      check.duration = Date.now() - startTime
      return check
    }
  }

  /**
   * Check 3: Critical package imports
   */
  private async checkPackageImports(pythonPath: string): Promise<ValidationCheck> {
    const startTime = Date.now()
    const check: ValidationCheck = {
      type: 'package_imports',
      name: 'Critical Package Imports',
      status: 'pass',
      message: '',
      duration: 0,
      criticality: 'critical', // Critical - core packages must be importable
    }

    const packages = ['whisperx', 'faster_whisper', 'pyannote.audio', 'torch']
    const results: Record<string, boolean> = {}
    const versions: Record<string, string> = {}
    const errors: string[] = []

    try {
      // Bundled Python: Use 'check' script which tests all imports
      if (this.isBundledPython(pythonPath)) {
        const checkOutput = execSync(`"${pythonPath}" check 2>&1`, {
          encoding: 'utf8',
          timeout: 30000,
        })

        // Parse check output for package status
        // The check script shows:
        // ✓ PyTorch 2.5.1
        // ✓ WhisperX
        // ✓ faster-whisper
        // ✓ pyannote.audio
        for (const pkg of packages) {
          const pkgName = pkg === 'faster_whisper' ? 'faster-whisper' : pkg === 'pyannote.audio' ? 'pyannote' : pkg
          const isInstalled = checkOutput.includes(`✓`) && (
            checkOutput.includes(pkgName) ||
            (pkgName === 'torch' && checkOutput.includes('PyTorch'))
          )

          results[pkg] = isInstalled

          // Try to extract version from check output
          const versionRegex = pkg === 'torch'
            ? /PyTorch\s+([\d.]+)/
            : new RegExp(`${pkgName}\\s+([\\d.]+)`, 'i')
          const versionMatch = checkOutput.match(versionRegex)
          if (versionMatch) {
            versions[pkg] = versionMatch[1]
          }

          if (!isInstalled) {
            errors.push(`${pkg}: Not found in bundle`)
          }
        }
      } else {
        // Regular Python: Use -c to import each package
        for (const pkg of packages) {
          try {
            const importCode = pkg === 'faster_whisper'
              ? 'from faster_whisper import WhisperModel'
              : pkg === 'pyannote.audio'
              ? 'from pyannote.audio import Pipeline'
              : `import ${pkg}`

            execSync(`"${pythonPath}" -c "${importCode}" 2>&1`, {
              encoding: 'utf8',
              timeout: 15000,
              env: {
                ...process.env,
                PYTHONWARNINGS: 'ignore::UserWarning,ignore::DeprecationWarning,ignore::FutureWarning',
              },
            })
            results[pkg] = true

            // Try to get version
            try {
              const versionCode = pkg === 'pyannote.audio'
                ? 'import pyannote.audio; print(pyannote.audio.__version__)'
                : `import ${pkg}; print(${pkg}.__version__)`

              const version = execSync(`"${pythonPath}" -c "${versionCode}" 2>&1`, {
                encoding: 'utf8',
                timeout: 10000,
                env: {
                  ...process.env,
                  PYTHONWARNINGS: 'ignore',
                },
              }).trim()

              if (version && !version.includes('Traceback')) {
                versions[pkg] = version
              }
            } catch {
              // Version detection is optional
            }
          } catch (error) {
            results[pkg] = false
            errors.push(`${pkg}: ${error instanceof Error ? error.message : String(error)}`)
          }
        }
      }

      check.details = { results, versions }

      const failedPackages = Object.entries(results)
        .filter(([_, success]) => !success)
        .map(([pkg]) => pkg)

      if (failedPackages.length === 0) {
        check.status = 'pass'
        check.message = 'All critical packages are importable'
      } else {
        check.status = 'fail'
        check.message = `Failed to import: ${failedPackages.join(', ')}`
        check.error = errors.join('; ')
        check.remediation = [
          'Run: pip install whisperx faster-whisper pyannote.audio torch',
          'Check Python package installation',
          'Verify virtual environment is activated',
          'Re-bundle application if using bundled Python',
        ]
      }

      check.duration = Date.now() - startTime
      return check
    } catch (error) {
      check.status = 'fail'
      check.message = 'Failed to check package imports'
      check.error = error instanceof Error ? error.message : String(error)
      check.duration = Date.now() - startTime
      return check
    }
  }

  /**
   * Check 4: PyAnnote model loading
   *
   * IMPORTANT: This check is marked as 'optional' because:
   * 1. Model loading is expensive (network + 60s timeout)
   * 2. Models will be downloaded on first actual use
   * 3. Pyannote can work even if pre-validation fails (e.g., command timeout)
   * 4. Users shouldn't see 'failed' status when diarization actually works
   *
   * The environment is considered 'functional' even if this check fails.
   */
  private async checkPyAnnoteModel(pythonPath: string): Promise<ValidationCheck> {
    const startTime = Date.now()
    const check: ValidationCheck = {
      type: 'pyannote_model',
      name: 'PyAnnote Model Loading',
      status: 'fail',
      message: '',
      duration: 0,
      criticality: 'optional', // Optional - heavy model loading deferred to first use
    }

    try {
      const hfToken = pythonEnvironment.getHuggingFaceToken()

      if (!hfToken) {
        check.status = 'warning'
        check.message = 'HuggingFace token not configured (required for PyAnnote models)'
        check.error = 'No HuggingFace token found in Settings'
        check.remediation = [
          'Set your HuggingFace token in Settings (Speaker Identification)',
          'Get token from: https://huggingface.co/settings/tokens',
          'Accept model license at: https://huggingface.co/pyannote/embedding',
        ]
        check.duration = Date.now() - startTime
        return check
      }

      check.details = { hfToken: '***' + hfToken.slice(-4) }

      // Bundled Python: Skip model loading check (check script doesn't test this)
      // Model will be downloaded on first diarization attempt
      if (this.isBundledPython(pythonPath)) {
        check.status = 'warning'
        check.message = 'PyAnnote model loading not tested for bundled Python (will download on first use)'
        check.duration = Date.now() - startTime
        return check
      }

      // Try to load model (with timeout)
      // Use environment variable instead of embedding token to avoid shell quoting issues
      // Suppress all warnings at Python level and ensure SUCCESS is printed
      const testCode = `import sys; import os; import warnings; warnings.filterwarnings('ignore'); import logging; logging.getLogger().setLevel(logging.ERROR); try: from pyannote.audio import Model; model = Model.from_pretrained('pyannote/embedding', use_auth_token=os.environ['HF_TOKEN']); print('SUCCESS'); print('MODEL_PATH:' + str(model)); sys.exit(0); except Exception as e: print('ERROR:' + str(e)); sys.exit(1)`

      const result = execSync(`"${pythonPath}" -c "${testCode}" 2>&1`, {
        encoding: 'utf8',
        timeout: 60000, // 60 seconds for model download
        env: {
          ...process.env,
          HF_TOKEN: hfToken,
          PYTHONWARNINGS: 'ignore',
          TORCH_FORCE_NO_WEIGHTS_ONLY_LOAD: '1',
        },
      })

      // Check for SUCCESS message (warnings may appear but shouldn't affect success detection)
      if (result.includes('SUCCESS')) {
        check.status = 'pass'
        check.message = 'PyAnnote embedding model loaded successfully'

        const modelPathMatch = result.match(/MODEL_PATH:(.+)/)
        if (modelPathMatch) {
          check.details.modelPath = modelPathMatch[1].trim()
        }
      } else if (result.includes('ERROR:')) {
        check.status = 'fail'
        check.message = 'Failed to load PyAnnote model'
        check.error = result.split('ERROR:')[1]?.trim() || 'Unknown error'
        check.remediation = [
          'Check HF_TOKEN is valid and has access',
          'Accept model license at: https://huggingface.co/pyannote/embedding',
          'Check internet connection for model download',
          'Verify sufficient disk space for models (~500MB-1GB)',
        ]
      } else {
        // If no SUCCESS or ERROR found, check if execSync threw (caught in catch block)
        // This handles cases where warnings might have interfered
        check.status = 'fail'
        check.message = 'Failed to load PyAnnote model (unexpected output)'
        check.error = result.length > 500 ? result.substring(0, 500) + '...' : result
        check.remediation = [
          'Check HF_TOKEN is valid and has access',
          'Accept model license at: https://huggingface.co/pyannote/embedding',
          'Check Python and pyannote.audio installation',
        ]
      }

      check.duration = Date.now() - startTime
      return check
    } catch (error) {
      check.status = 'fail'
      check.message = 'Failed to test PyAnnote model loading'
      check.error = error instanceof Error ? error.message : String(error)
      check.remediation = [
        'Check Python and pyannote.audio installation',
        'Verify HuggingFace token is saved in Settings',
        'Check internet connectivity',
      ]
      check.duration = Date.now() - startTime
      return check
    }
  }

  /**
   * Check 5: Native dependencies (CUDA/MPS)
   */
  private async checkNativeDependencies(
    pythonPath: string,
    platform: { os: string; arch: string; isAppleSilicon: boolean }
  ): Promise<ValidationCheck> {
    const startTime = Date.now()
    const check: ValidationCheck = {
      type: 'native_dependencies',
      name: 'Native Dependencies (CUDA/MPS)',
      status: 'pass',
      message: '',
      duration: 0,
      criticality: 'optional', // Optional - CPU fallback always available
    }

    try {
      // Bundled Python: Skip native dependencies check (assume CPU mode)
      if (this.isBundledPython(pythonPath)) {
        check.status = 'warning'
        check.message = 'Native dependencies check skipped for bundled Python (CPU mode assumed)'
        check.details = {
          cudaAvailable: false,
          mpsAvailable: false,
          device: 'CPU',
          platform,
        }
        check.duration = Date.now() - startTime
        return check
      }

      const testCode = `import torch; cuda_available = torch.cuda.is_available(); mps_available = hasattr(torch.backends, 'mps') and torch.backends.mps.is_available(); print(f'CUDA:{cuda_available}'); print(f'MPS:{mps_available}'); print(f'DEVICE:{torch.cuda.get_device_name(0) if cuda_available else "CPU"}')`

      const result = execSync(`"${pythonPath}" -c "${testCode}" 2>&1`, {
        encoding: 'utf8',
        timeout: 15000,
        env: {
          ...process.env,
          PYTHONWARNINGS: 'ignore',
        },
      })

      const cudaMatch = result.match(/CUDA:(True|False)/)
      const mpsMatch = result.match(/MPS:(True|False)/)
      const deviceMatch = result.match(/DEVICE:(.+)/)

      const cudaAvailable = cudaMatch && cudaMatch[1] === 'True'
      const mpsAvailable = mpsMatch && mpsMatch[1] === 'True'
      const device = deviceMatch ? deviceMatch[1].trim() : 'Unknown'

      check.details = {
        cudaAvailable,
        mpsAvailable,
        device,
        platform,
      }

      if (cudaAvailable) {
        check.status = 'pass'
        check.message = `CUDA available: ${device}`
      } else if (mpsAvailable) {
        check.status = 'pass'
        check.message = 'Apple MPS available (Metal Performance Shaders)'
      } else if (platform.isAppleSilicon) {
        check.status = 'warning'
        check.message = 'MPS not available on Apple Silicon (will use CPU)'
        check.remediation = [
          'Install PyTorch with MPS support: pip install torch torchvision torchaudio',
          'Ensure macOS 12.3 or later for MPS support',
        ]
      } else {
        check.status = 'warning'
        check.message = 'GPU acceleration not available (will use CPU)'
        check.remediation = [
          'Install CUDA-enabled PyTorch for GPU acceleration',
          'CPU mode will work but be slower',
        ]
      }

      check.duration = Date.now() - startTime
      return check
    } catch (error) {
      check.status = 'warning'
      check.message = 'Could not check GPU availability (will use CPU)'
      check.error = error instanceof Error ? error.message : String(error)
      check.duration = Date.now() - startTime
      return check
    }
  }

  /**
   * Check 6: File permissions
   */
  private async checkFilePermissions(
    pythonPath: string,
    envType: PythonEnvironmentType
  ): Promise<ValidationCheck> {
    const startTime = Date.now()
    const check: ValidationCheck = {
      type: 'file_permissions',
      name: 'File Permissions',
      status: 'pass',
      message: '',
      duration: 0,
      criticality: 'important', // Important - affects execution but may work in some cases
    }

    try {
      const pathsToCheck: string[] = [pythonPath]

      // Add Python scripts directory
      const scriptsDir = pythonEnvironment.getPythonScriptsDir()
      if (fs.existsSync(scriptsDir)) {
        pathsToCheck.push(scriptsDir)
      }

      // Check model cache directory
      const homeDir = os.homedir()
      const cacheDir = path.join(homeDir, '.cache', 'huggingface')
      if (fs.existsSync(cacheDir)) {
        pathsToCheck.push(cacheDir)
      }

      const permissionIssues: string[] = []

      for (const pathToCheck of pathsToCheck) {
        try {
          const stats = fs.statSync(pathToCheck)

          if (stats.isFile()) {
            // Check if executable
            try {
              fs.accessSync(pathToCheck, fs.constants.X_OK)
            } catch {
              permissionIssues.push(`Not executable: ${pathToCheck}`)
            }
          } else if (stats.isDirectory()) {
            // Check if readable and writable
            try {
              fs.accessSync(pathToCheck, fs.constants.R_OK | fs.constants.W_OK)
            } catch {
              permissionIssues.push(`Not readable/writable: ${pathToCheck}`)
            }
          }
        } catch (error) {
          permissionIssues.push(`Cannot access: ${pathToCheck}`)
        }
      }

      if (permissionIssues.length === 0) {
        check.status = 'pass'
        check.message = 'All file permissions are correct'
      } else {
        check.status = 'fail'
        check.message = `Permission issues found: ${permissionIssues.length} path(s)`
        check.error = permissionIssues.join('; ')
        check.remediation = [
          'Fix file permissions with chmod/chown',
          'Ensure user has read/write/execute permissions',
          'Check if files are on a read-only filesystem',
        ]
      }

      check.details = { pathsChecked: pathsToCheck, issues: permissionIssues }
      check.duration = Date.now() - startTime
      return check
    } catch (error) {
      check.status = 'fail'
      check.message = 'Failed to check file permissions'
      check.error = error instanceof Error ? error.message : String(error)
      check.duration = Date.now() - startTime
      return check
    }
  }

  /**
   * Check 7: Subprocess spawning
   */
  private async checkSubprocessSpawning(pythonPath: string): Promise<ValidationCheck> {
    const startTime = Date.now()
    const check: ValidationCheck = {
      type: 'subprocess_spawn',
      name: 'Subprocess Spawning',
      status: 'fail',
      message: '',
      duration: 0,
      criticality: 'critical', // Critical - must be able to spawn Python processes
    }

    return new Promise((resolve) => {
      try {
        // Bundled Python: Use 'check' script instead of -c
        const args = this.isBundledPython(pythonPath)
          ? ['check']  // Will output Python version and package info
          : ['-c', 'print("SUBPROCESS_OK")']

        const proc = spawn(pythonPath, args, {
          stdio: ['pipe', 'pipe', 'pipe'],
          timeout: this.isBundledPython(pythonPath) ? 30000 : 10000,  // Bundled takes longer
        })

        let stdout = ''
        let stderr = ''

        proc.stdout?.on('data', (data) => {
          stdout += data.toString()
        })

        proc.stderr?.on('data', (data) => {
          stderr += data.toString()
        })

        proc.on('exit', (code) => {
          // For bundled Python, check for Python version in output
          // For regular Python, check for SUBPROCESS_OK
          const isBundled = this.isBundledPython(pythonPath)
          const successCondition = isBundled
            ? (code === 0 && stdout.includes('Python'))  // Check script shows Python version
            : (code === 0 && stdout.includes('SUBPROCESS_OK'))

          if (successCondition) {
            check.status = 'pass'
            check.message = 'Subprocess spawning works correctly'
          } else {
            check.status = 'fail'
            check.message = `Subprocess exited with code ${code}`
            check.error = stderr || 'Unknown error'
            check.remediation = [
              'Check Python executable permissions',
              'Verify subprocess spawn is not blocked by security software',
              'Check system resource limits (ulimit)',
            ]
          }
          check.duration = Date.now() - startTime
          resolve(check)
        })

        proc.on('error', (error) => {
          check.status = 'fail'
          check.message = 'Failed to spawn subprocess'
          check.error = error.message
          check.remediation = [
            'Verify Python executable exists and is accessible',
            'Check file permissions on Python binary',
            'Ensure sufficient system resources',
          ]
          check.duration = Date.now() - startTime
          resolve(check)
        })

        // Timeout
        setTimeout(() => {
          if (!proc.killed) {
            proc.kill()
            check.status = 'fail'
            check.message = 'Subprocess spawn timed out'
            check.error = 'Process did not complete within 10 seconds'
            check.duration = Date.now() - startTime
            resolve(check)
          }
        }, 10000)
      } catch (error) {
        check.status = 'fail'
        check.message = 'Failed to test subprocess spawning'
        check.error = error instanceof Error ? error.message : String(error)
        check.duration = Date.now() - startTime
        resolve(check)
      }
    })
  }

  /**
   * Check 8: Environment variable propagation
   */
  private async checkEnvPropagation(pythonPath: string): Promise<ValidationCheck> {
    const startTime = Date.now()
    const check: ValidationCheck = {
      type: 'env_propagation',
      name: 'Environment Variable Propagation',
      status: 'fail',
      message: '',
      duration: 0,
      criticality: 'important', // Important - needed for HF_TOKEN, but environment may still work
    }

    return new Promise((resolve) => {
      try {
        const testValue = `TEST_${Date.now()}`
        const testKey = 'PYTHON_ENV_TEST'

        const proc = spawn(pythonPath, ['-c', `import os; print(os.environ.get('${testKey}', 'NOTFOUND'))`], {
          stdio: ['pipe', 'pipe', 'pipe'],
          timeout: 10000,
          env: {
            ...process.env,
            [testKey]: testValue,
          },
        })

        let stdout = ''
        let stderr = ''

        proc.stdout?.on('data', (data) => {
          stdout += data.toString()
        })

        proc.stderr?.on('data', (data) => {
          stderr += data.toString()
        })

        proc.on('exit', (code) => {
          if (code === 0 && stdout.trim() === testValue) {
            check.status = 'pass'
            check.message = 'Environment variables propagate correctly to Python subprocess'
          } else {
            check.status = 'fail'
            check.message = 'Environment variables not propagating correctly'
            check.error = `Expected: ${testValue}, Got: ${stdout.trim()}`
            check.remediation = [
              'Check shell environment configuration',
              'Verify subprocess spawn with env parameter works',
              'Check for environment variable sanitization in system',
            ]
          }
          check.duration = Date.now() - startTime
          resolve(check)
        })

        proc.on('error', (error) => {
          check.status = 'fail'
          check.message = 'Failed to test environment variable propagation'
          check.error = error.message
          check.duration = Date.now() - startTime
          resolve(check)
        })

        // Timeout
        setTimeout(() => {
          if (!proc.killed) {
            proc.kill()
            check.status = 'fail'
            check.message = 'Environment propagation test timed out'
            check.duration = Date.now() - startTime
            resolve(check)
          }
        }, 10000)
      } catch (error) {
        check.status = 'fail'
        check.message = 'Failed to test environment variable propagation'
        check.error = error instanceof Error ? error.message : String(error)
        check.duration = Date.now() - startTime
        resolve(check)
      }
    })
  }

  /**
   * Check 9: Dual environment validation
   * Validates that separate venvs exist for WhisperX and Pyannote to avoid torch conflicts
   */
  private async checkDualEnvironment(): Promise<ValidationCheck> {
    const startTime = Date.now()
    const check: ValidationCheck = {
      type: 'dual_environment',
      name: 'Dual Python Environment Setup',
      status: 'pass',
      message: '',
      duration: 0,
      criticality: 'important', // Important - affects torch version compatibility
    }

    try {
      const envType = pythonEnvironment.getEnvironmentType()
      const whisperxPath = pythonEnvironment.getPythonPathForPurpose('whisperx')
      const pyannotePath = pythonEnvironment.getPythonPathForPurpose('pyannote')

      check.details = {
        envType,
        whisperxPath,
        pyannotePath,
        isDualEnv: whisperxPath !== pyannotePath,
      }

      // Check for bundled environment (no dual env needed)
      if (envType === 'bundled') {
        check.status = 'pass'
        check.message = 'Using bundled Python environment (includes all dependencies)'
        check.duration = Date.now() - startTime
        return check
      }

      // Check if using dual venv setup
      if (envType === 'dual-venv') {
        // Verify both environments have correct torch versions
        const execOptions = {
          encoding: 'utf8' as const,
          timeout: 30000,
          env: {
            ...process.env,
            PYTHONWARNINGS: 'ignore::UserWarning,ignore::DeprecationWarning,ignore::FutureWarning',
          },
        }

        let whisperxTorch = 'unknown'
        let pyannoteTorch = 'unknown'

        // Check WhisperX torch version
        if (whisperxPath) {
          try {
            whisperxTorch = execSync(`"${whisperxPath}" -c "import torch; print(torch.__version__)" 2>&1`, execOptions).trim()
          } catch {
            whisperxTorch = 'not installed'
          }
        }

        // Check Pyannote torch version
        if (pyannotePath) {
          try {
            pyannoteTorch = execSync(`"${pyannotePath}" -c "import torch; print(torch.__version__)" 2>&1`, execOptions).trim()
          } catch {
            pyannoteTorch = 'not installed'
          }
        }

        check.details = {
          ...check.details,
          whisperxTorch,
          pyannoteTorch,
        }

        // Validate torch versions - be flexible about compatible versions
        // Accept torch 2.7+ for whisperx (2.7, 2.8 work), 2.4+ for pyannote (2.4, 2.5, even 2.8 may work)
        // The key insight: if torch is installed and pyannote.audio imports work, the version is compatible
        const whisperxHasTorch = whisperxTorch !== 'unknown' && whisperxTorch !== 'not installed'
        const pyannoteHasTorch = pyannoteTorch !== 'unknown' && pyannoteTorch !== 'not installed'

        // Preferred versions for optimal compatibility
        const whisperxIdeal = whisperxTorch.startsWith('2.8') || whisperxTorch.startsWith('2.7')
        const pyannoteIdeal = pyannoteTorch.startsWith('2.5') || pyannoteTorch.startsWith('2.4')

        // Extended compatibility: pyannote.audio 3.3.2+ may work with torch 2.8
        // Check if version is >= 2.4 (works with pyannote)
        const pyannoteMajor = parseInt(pyannoteTorch.split('.')[0] || '0')
        const pyannoteMinor = parseInt(pyannoteTorch.split('.')[1] || '0')
        const pyannoteCompatible = pyannoteHasTorch && pyannoteMajor === 2 && pyannoteMinor >= 4

        if (whisperxIdeal && pyannoteIdeal) {
          check.status = 'pass'
          check.message = `Dual environment setup verified: WhisperX (torch ${whisperxTorch}) + Pyannote (torch ${pyannoteTorch})`
        } else if (whisperxHasTorch && pyannoteCompatible) {
          // Functional but not ideal - don't fail, just note the version difference
          check.status = 'pass'
          check.message = `Dual environment functional: WhisperX (torch ${whisperxTorch}) + Pyannote (torch ${pyannoteTorch}). May work but versions differ from ideal.`
          check.details = { ...check.details, versionNote: 'Non-standard torch versions but likely compatible' }
        } else if (whisperxHasTorch && pyannoteHasTorch) {
          // Both have torch but versions may conflict - warn but don't fail
          check.status = 'warning'
          check.message = `Torch versions may cause compatibility issues: WhisperX (${whisperxTorch}), Pyannote (${pyannoteTorch})`
          check.remediation = [
            'If diarization works, you can ignore this warning.',
            'For optimal compatibility:',
            '  WhisperX environment: pip install torch==2.8.0',
            '  Pyannote environment: pip install torch==2.5.1',
          ]
        } else {
          check.status = 'warning'
          check.message = `Missing torch in one or both environments: WhisperX (${whisperxTorch}), Pyannote (${pyannoteTorch})`
          check.remediation = [
            'Install torch in the affected environment(s):',
            '  WhisperX: pip install torch==2.8.0',
            '  Pyannote: pip install torch==2.5.1',
          ]
        }
      } else if (envType === 'venv') {
        // Single venv - warn about potential torch conflicts
        check.status = 'warning'
        check.message = 'Using single Python environment - potential torch version conflicts may occur'
        check.remediation = [
          'Consider creating separate environments to avoid torch conflicts:',
          '  1. Create venv-whisperx with torch 2.8 for transcription',
          '  2. Create venv-pyannote with torch 2.5.1 for diarization',
          'See requirements-whisperx.txt and requirements-pyannote.txt for details',
        ]
      } else if (envType === 'system') {
        check.status = 'warning'
        check.message = 'Using system Python - recommend creating virtual environments'
        check.remediation = [
          'Create separate virtual environments for optimal performance:',
          '  python3 -m venv python/venv-whisperx',
          '  python3 -m venv python/venv-pyannote',
        ]
      } else {
        check.status = 'fail'
        check.message = 'No Python environment found'
        check.remediation = [
          'Install Python 3.12 and create virtual environments',
          'Or run npm run bundle:python to create a standalone bundle',
        ]
      }

      check.duration = Date.now() - startTime
      return check
    } catch (error) {
      check.status = 'fail'
      check.message = 'Failed to check dual environment setup'
      check.error = error instanceof Error ? error.message : String(error)
      check.duration = Date.now() - startTime
      return check
    }
  }

  /**
   * Check 10: Windows-specific diagnostics
   * Runs comprehensive Windows diagnostics for Python environment issues
   */
  private async checkWindowsDiagnostics(): Promise<ValidationCheck> {
    const startTime = Date.now()
    const check: ValidationCheck = {
      type: 'windows_diagnostics',
      name: 'Windows Python Environment Diagnostics',
      status: 'pass',
      message: '',
      duration: 0,
      criticality: 'important', // Important - Windows-specific issues can break Python
    }

    try {
      // Run Windows-specific diagnostics
      const diagnostics = await windowsPythonDiagnostics.runDiagnostics()

      check.details = {
        windowsDiagnostics: diagnostics,
        windowsVersion: diagnostics.windowsVersion,
        pythonInstallation: diagnostics.pythonInstallation,
        visualCppInstalled: diagnostics.visualCpp.installed,
        longPathsEnabled: diagnostics.pathInfo.longPathsEnabled,
        executionPolicy: diagnostics.executionPolicy.policy,
        cudaAvailable: diagnostics.cuda.nvidiaDriverInstalled,
      }

      // Determine check status based on diagnostics health
      if (diagnostics.overallHealth === 'failed') {
        check.status = 'fail'
        check.message = `Windows environment has critical issues: ${diagnostics.issues.filter(i => i.severity === 'critical').map(i => i.message).join('; ')}`
        check.error = diagnostics.issues.filter(i => i.severity === 'critical').map(i => i.details || i.message).join('; ')
        check.remediation = diagnostics.allRemediationSteps
      } else if (diagnostics.overallHealth === 'degraded') {
        check.status = 'warning'
        check.message = `Windows environment has some issues: ${diagnostics.issues.filter(i => i.severity === 'warning').map(i => i.message).join('; ')}`
        check.remediation = diagnostics.allRemediationSteps
      } else {
        check.status = 'pass'
        check.message = 'Windows environment diagnostics passed'
        if (!diagnostics.pythonInstallation.isValid) {
          check.status = 'fail'
          check.message = 'Python 3.12+ not found on Windows'
          check.remediation = [
            'Download Python 3.12 from https://www.python.org/downloads/',
            'Run the installer and CHECK "Add Python to PATH"',
            'Restart your terminal/command prompt after installation',
          ]
        }
      }

      // Add Visual C++ specific warnings
      if (!diagnostics.visualCpp.installed) {
        if (check.status === 'pass') {
          check.status = 'warning'
          check.message = 'Visual C++ Redistributable not detected'
        }
        check.remediation = check.remediation || []
        check.remediation.push(
          'Download Visual C++ Redistributable from:',
          'https://aka.ms/vs/17/release/vc_redist.x64.exe',
          'This is required for PyTorch and other Python packages'
        )
      }

      // Add path length warnings
      if (diagnostics.pathInfo.hasLongPaths && !diagnostics.pathInfo.longPathsEnabled) {
        if (check.status === 'pass') {
          check.status = 'warning'
          check.message = 'Long path issues detected'
        }
        check.remediation = check.remediation || []
        check.remediation.push(
          'Enable long path support in Windows:',
          'Run PowerShell as Administrator: New-ItemProperty -Path "HKLM:\\SYSTEM\\CurrentControlSet\\Control\\FileSystem" -Name "LongPathsEnabled" -Value 1 -PropertyType DWORD -Force'
        )
      }

      check.duration = Date.now() - startTime
      return check
    } catch (error) {
      check.status = 'warning'
      check.message = 'Failed to run Windows diagnostics'
      check.error = error instanceof Error ? error.message : String(error)
      check.duration = Date.now() - startTime
      return check
    }
  }

  /**
   * Get sanitized environment variables (hide sensitive data)
   */
  private getSanitizedEnvVars(): Record<string, string> {
    const env = process.env
    const sanitized: Record<string, string> = {}

    const relevantKeys = [
      'PYTHON_PATH',
      'HF_TOKEN',
      'HUGGING_FACE_HUB_TOKEN',
      'PYTHONUNBUFFERED',
      'TORCH_FORCE_NO_WEIGHTS_ONLY_LOAD',
      'PYTHONWARNINGS',
      'PATH',
      'HOME',
      'USER',
      'SHELL',
    ]

    for (const key of relevantKeys) {
      if (env[key]) {
        // Sanitize tokens
        if (key.includes('TOKEN')) {
          sanitized[key] = '***' + env[key]!.slice(-4)
        } else {
          sanitized[key] = env[key]!
        }
      }
    }

    return sanitized
  }

  /**
   * Attempt automatic repair of Python environment
   */
  async attemptAutoRepair(): Promise<AutoRepairResult> {
    loggerService.info('[PythonValidator] Starting auto-repair')
    this.emit('repair:start')

    const result: AutoRepairResult = {
      success: false,
      actionsAttempted: [],
      actionsSucceeded: [],
      actionsFailed: [],
      logs: [],
    }

    // Get current validation state
    const validation = await this.validateEnvironment(true)

    // Action 1: Fix file permissions
    if (validation.checks.find((c) => c.type === 'file_permissions' && c.status === 'fail')) {
      result.actionsAttempted.push('Fix file permissions')
      try {
        await this.fixFilePermissions()
        result.actionsSucceeded.push('Fix file permissions')
        result.logs.push('Fixed file permissions on Python scripts and models')
      } catch (error) {
        result.actionsFailed.push('Fix file permissions')
        result.logs.push(`Failed to fix permissions: ${error instanceof Error ? error.message : String(error)}`)
      }
    }

    // Action 2: Re-download models (if HF_TOKEN is configured)
    const modelCheck = validation.checks.find((c) => c.type === 'pyannote_model')
    if (modelCheck && modelCheck.status === 'fail' && pythonEnvironment.isHuggingFaceTokenConfigured()) {
      result.actionsAttempted.push('Re-download PyAnnote models')
      try {
        await this.redownloadModels()
        result.actionsSucceeded.push('Re-download PyAnnote models')
        result.logs.push('Successfully re-downloaded PyAnnote models')
      } catch (error) {
        result.actionsFailed.push('Re-download PyAnnote models')
        result.logs.push(`Failed to download models: ${error instanceof Error ? error.message : String(error)}`)
      }
    }

    // Action 3: Reinstall packages (only for venv, not bundled)
    const envType = pythonEnvironment.getEnvironmentType()
    const packageCheck = validation.checks.find((c) => c.type === 'package_imports')
    if (packageCheck && packageCheck.status === 'fail' && envType === 'venv') {
      result.actionsAttempted.push('Reinstall Python packages')
      try {
        await this.reinstallPackages()
        result.actionsSucceeded.push('Reinstall Python packages')
        result.logs.push('Successfully reinstalled Python packages')
      } catch (error) {
        result.actionsFailed.push('Reinstall Python packages')
        result.logs.push(`Failed to reinstall packages: ${error instanceof Error ? error.message : String(error)}`)
      }
    }

    // Re-validate after repairs
    result.validationAfter = await this.validateEnvironment(true)
    result.success = result.validationAfter.success

    loggerService.info('[PythonValidator] Auto-repair complete', {
      success: result.success,
      actionsAttempted: result.actionsAttempted.length,
      actionsSucceeded: result.actionsSucceeded.length,
      actionsFailed: result.actionsFailed.length,
    })
    this.emit('repair:complete', result)

    return result
  }

  /**
   * Fix file permissions
   */
  private async fixFilePermissions(): Promise<void> {
    const pythonPath = pythonEnvironment.getPythonPath()
    if (!pythonPath) throw new Error('No Python path found')

    const scriptsDir = pythonEnvironment.getPythonScriptsDir()

    // Fix Python executable permissions
    if (fs.existsSync(pythonPath)) {
      execSync(`chmod +x "${pythonPath}"`, { timeout: 5000 })
    }

    // Fix scripts directory permissions
    if (fs.existsSync(scriptsDir)) {
      execSync(`chmod -R u+rwX "${scriptsDir}"`, { timeout: 10000 })
    }

    // Fix cache directory permissions
    const homeDir = os.homedir()
    const cacheDir = path.join(homeDir, '.cache', 'huggingface')
    if (fs.existsSync(cacheDir)) {
      execSync(`chmod -R u+rwX "${cacheDir}"`, { timeout: 10000 })
    }
  }

  /**
   * Re-download PyAnnote models
   */
  private async redownloadModels(): Promise<void> {
    // For dual-venv, use pyannote-specific Python path
    const envType = pythonEnvironment.getEnvironmentType()
    const pythonPath = envType === 'dual-venv'
      ? pythonEnvironment.getPythonPathForPurpose('pyannote')
      : pythonEnvironment.getPythonPath()

    if (!pythonPath) throw new Error('No Python path found')

    const hfToken = pythonEnvironment.getHuggingFaceToken()
    if (!hfToken) throw new Error('HuggingFace token not configured in Settings')

    // Use environment variable instead of embedding token to avoid shell quoting issues
    // Suppress warnings to avoid cluttering output
    const downloadCode = `import warnings; warnings.filterwarnings('ignore'); import logging; logging.getLogger().setLevel(logging.ERROR); from pyannote.audio import Model; import os; model = Model.from_pretrained('pyannote/embedding', use_auth_token=os.environ['HF_TOKEN']); print('OK')`

    execSync(`"${pythonPath}" -c "${downloadCode}" 2>&1`, {
      encoding: 'utf8',
      timeout: 120000, // 2 minutes
      env: {
        ...process.env,
        HF_TOKEN: hfToken,
        PYTHONWARNINGS: 'ignore',
        TORCH_FORCE_NO_WEIGHTS_ONLY_LOAD: '1',
      },
    })
  }

  /**
   * Reinstall Python packages
   */
  private async reinstallPackages(): Promise<void> {
    const pythonPath = pythonEnvironment.getPythonPath()
    if (!pythonPath) throw new Error('No Python path found')

    const scriptsDir = pythonEnvironment.getPythonScriptsDir()
    const requirementsPath = path.join(scriptsDir, 'requirements.txt')

    if (!fs.existsSync(requirementsPath)) {
      throw new Error('requirements.txt not found')
    }

    execSync(`"${pythonPath}" -m pip install --upgrade pip`, {
      encoding: 'utf8',
      timeout: 60000,
    })

    execSync(`"${pythonPath}" -m pip install -r "${requirementsPath}"`, {
      encoding: 'utf8',
      timeout: 300000, // 5 minutes
    })
  }

  /**
   * Clear validation cache (both in-memory and database)
   */
  clearCache(): void {
    this.cachedValidation = null
    this.cacheTimestamp = 0

    // Also clear database cache
    pythonValidationCacheService.invalidateAllCaches()
  }

  /**
   * Get venv paths for hash computation
   */
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

  /**
   * Run lightweight validation (fast startup check)
   *
   * Only checks critical imports (whisperx, pyannote.audio, torch)
   * without model loading or heavy operations
   */
  private async runLightweightValidation(pythonPath: string | null): Promise<{ success: boolean; error?: string }> {
    if (!pythonPath) {
      return { success: false, error: 'No Python path' }
    }

    const startTime = Date.now()

    try {
      // Check if path exists and is executable
      if (!fs.existsSync(pythonPath)) {
        return { success: false, error: 'Python binary not found' }
      }

      try {
        fs.accessSync(pythonPath, fs.constants.X_OK)
      } catch {
        return { success: false, error: 'Python binary not executable' }
      }

      // For bundled Python, just check if it responds
      if (pythonPath.includes('transcription_bundle')) {
        try {
          execSync(`"${pythonPath}" check 2>&1`, {
            encoding: 'utf8',
            timeout: 5000, // 5 second timeout for lightweight check
          })
          loggerService.info(`[PythonValidator] Lightweight check passed (${Date.now() - startTime}ms)`)
          return { success: true }
        } catch (error) {
          return { success: false, error: 'Bundle check failed' }
        }
      }

      // For regular Python, do a quick import check of torch only
      // (it's the slowest to load but most critical)
      const quickCheck = `import sys; import torch; print('OK')`

      try {
        const result = execSync(`"${pythonPath}" -c "${quickCheck}" 2>&1`, {
          encoding: 'utf8',
          timeout: 10000, // 10 second timeout for import check
          env: {
            ...process.env,
            PYTHONWARNINGS: 'ignore::UserWarning,ignore::DeprecationWarning,ignore::FutureWarning',
          },
        })

        if (result.includes('OK')) {
          loggerService.info(`[PythonValidator] Lightweight check passed (${Date.now() - startTime}ms)`)
          return { success: true }
        }
        return { success: false, error: 'Import check did not return OK' }
      } catch (error) {
        return { success: false, error: error instanceof Error ? error.message : 'Import check failed' }
      }
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' }
    }
  }

  /**
   * Get cache statistics for UI display
   */
  getCacheStats(): {
    smartCheckingEnabled: boolean
    hasCache: boolean
    lastValidated: string | null
    cacheAgeHours: number | null
    hashesMatch: boolean
    cachedStatus: EnvironmentReadiness | null
  } {
    const smartCheckingEnabled = pythonValidationCacheService.isSmartCheckingEnabled()
    const envType = pythonEnvironment.getEnvironmentType()
    const pythonPath = pythonEnvironment.getPythonPath()
    const environmentName = `${envType}:${pythonPath || 'none'}`
    const venvPaths = this.getVenvPaths()
    const currentHash = pythonValidationCacheService.computeEnvironmentHash(pythonPath, venvPaths)

    const stats = pythonValidationCacheService.getCacheStats(environmentName, currentHash)

    return {
      smartCheckingEnabled,
      ...stats
    }
  }

  /**
   * Set smart environment checking enabled/disabled
   */
  setSmartCheckingEnabled(enabled: boolean): void {
    pythonValidationCacheService.setSmartCheckingEnabled(enabled)
  }

  /**
   * Start file system watchers for venv directories
   */
  startVenvWatchers(): void {
    const venvPaths = this.getVenvPaths()
    if (venvPaths.length > 0) {
      pythonValidationCacheService.startWatching(venvPaths)
    }
  }

  /**
   * Stop file system watchers
   */
  stopVenvWatchers(): void {
    pythonValidationCacheService.stopWatching()
  }

  /**
   * Run Windows-specific diagnostics independently
   * This can be called to get detailed Windows diagnostics without running
   * full validation
   */
  async runWindowsDiagnostics(): Promise<WindowsDiagnosticsResult | null> {
    if (process.platform !== 'win32') {
      loggerService.info('[PythonValidator] Windows diagnostics skipped - not on Windows')
      return null
    }

    try {
      return await windowsPythonDiagnostics.runDiagnostics()
    } catch (error) {
      loggerService.error('[PythonValidator] Failed to run Windows diagnostics', error)
      return null
    }
  }

  /**
   * Get Windows diagnostics report as text
   * Useful for displaying to users or saving to files
   */
  async getWindowsDiagnosticsReport(): Promise<string | null> {
    const diagnostics = await this.runWindowsDiagnostics()
    if (!diagnostics) {
      return null
    }
    return windowsPythonDiagnostics.generateReport(diagnostics)
  }

  /**
   * Get Windows-specific troubleshooting guide for an issue
   */
  getWindowsTroubleshootingGuide(category: 'python' | 'visual_cpp' | 'path' | 'execution_policy' | 'subprocess' | 'cuda'): string | null {
    if (process.platform !== 'win32') {
      return null
    }

    const fakeIssue = {
      category,
      severity: 'warning' as const,
      message: '',
      remediation: [],
    }

    return windowsPythonDiagnostics.getTroubleshootingGuide(fakeIssue)
  }
}

// Export singleton instance
export const pythonEnvironmentValidator = new PythonEnvironmentValidatorService()

// Export class for testing
export { PythonEnvironmentValidatorService }
