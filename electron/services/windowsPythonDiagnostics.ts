/**
 * Windows Python Environment Diagnostics Service
 *
 * This service provides comprehensive Windows-specific diagnostics and troubleshooting
 * for Python environment installation failures.
 *
 * Features:
 * - Python installation detection (py launcher, python3, python)
 * - Visual C++ redistributable verification
 * - Windows path length limitation checks (MAX_PATH 260 chars)
 * - Execution policy and script permission validation
 * - CUDA/GPU support detection for Windows
 * - Detailed error logging with Windows-specific troubleshooting steps
 * - Subprocess spawning validation (cmd.exe vs PowerShell)
 *
 * Windows-Specific Issues Addressed:
 * 1. Virtual environment creation (python -m venv vs py -m venv)
 * 2. Python binary resolution (py launcher vs python3 vs python)
 * 3. Package installation failures (torch, pyannote.audio, whisperx)
 * 4. Visual C++ redistributables requirement
 * 5. File permissions and execution policies
 * 6. Path length limitations (MAX_PATH 260)
 * 7. Subprocess spawning differences (cmd.exe vs bash)
 */

import { execSync, spawn, ChildProcess } from 'child_process'
import * as path from 'path'
import * as fs from 'fs'
import * as os from 'os'
import { EventEmitter } from 'events'
import { loggerService } from './loggerService'

// ============================================================================
// Types
// ============================================================================

export interface WindowsPythonInstallation {
  /** Type of Python installation detected */
  type: 'py_launcher' | 'python3' | 'python' | 'store' | 'none'
  /** Full path to Python executable */
  path: string | null
  /** Python version string */
  version: string | null
  /** Whether this is a valid Python 3.12+ installation */
  isValid: boolean
  /** Architecture (x64, x86) */
  arch: string | null
  /** Installation directory */
  installDir: string | null
}

export interface VisualCppStatus {
  /** Whether Visual C++ redistributables are installed */
  installed: boolean
  /** Detected versions */
  versions: string[]
  /** Required for PyTorch CUDA */
  cudaCompatible: boolean
  /** Error message if not installed */
  error?: string
  /** Remediation steps */
  remediation?: string[]
}

export interface WindowsPathInfo {
  /** Whether any paths exceed MAX_PATH limit */
  hasLongPaths: boolean
  /** Paths that exceed the limit */
  problematicPaths: string[]
  /** Whether long path support is enabled in Windows */
  longPathsEnabled: boolean
  /** Remediation steps */
  remediation?: string[]
}

export interface ExecutionPolicyStatus {
  /** Current PowerShell execution policy */
  policy: string
  /** Whether scripts can be executed */
  canExecuteScripts: boolean
  /** Whether UAC might block execution */
  uacIssue: boolean
  /** Error message */
  error?: string
  /** Remediation steps */
  remediation?: string[]
}

export interface SubprocessSpawnInfo {
  /** Whether cmd.exe spawning works */
  cmdExeWorks: boolean
  /** Whether PowerShell spawning works */
  powershellWorks: boolean
  /** Environment variables properly propagated */
  envPropagation: boolean
  /** Shell encoding (UTF-8 vs CP1252) */
  encoding: string
  /** Errors encountered */
  errors: string[]
}

export interface WindowsCudaStatus {
  /** Whether NVIDIA driver is installed */
  nvidiaDriverInstalled: boolean
  /** NVIDIA driver version */
  driverVersion: string | null
  /** CUDA toolkit version if installed */
  cudaVersion: string | null
  /** Whether cuDNN is available */
  cudnnAvailable: boolean
  /** GPU name */
  gpuName: string | null
  /** GPU memory in GB */
  gpuMemoryGB: number | null
  /** Error message */
  error?: string
}

export interface WindowsDiagnosticsResult {
  /** Timestamp */
  timestamp: string
  /** Windows version info */
  windowsVersion: {
    version: string
    build: string
    edition: string
    arch: string
  }
  /** Python installation info */
  pythonInstallation: WindowsPythonInstallation
  /** Visual C++ status */
  visualCpp: VisualCppStatus
  /** Path length issues */
  pathInfo: WindowsPathInfo
  /** Execution policy */
  executionPolicy: ExecutionPolicyStatus
  /** Subprocess spawning */
  subprocessSpawn: SubprocessSpawnInfo
  /** CUDA/GPU status */
  cuda: WindowsCudaStatus
  /** Overall health status */
  overallHealth: 'healthy' | 'degraded' | 'failed'
  /** Summary of issues */
  issues: WindowsDiagnosticIssue[]
  /** All remediation steps */
  allRemediationSteps: string[]
}

export interface WindowsDiagnosticIssue {
  /** Issue category */
  category: 'python' | 'visual_cpp' | 'path' | 'execution_policy' | 'subprocess' | 'cuda'
  /** Severity */
  severity: 'critical' | 'warning' | 'info'
  /** Issue description */
  message: string
  /** Technical details */
  details?: string
  /** Remediation steps */
  remediation: string[]
}

// ============================================================================
// Constants
// ============================================================================

const WINDOWS_MAX_PATH = 260
const REQUIRED_PYTHON_MAJOR = 3
const REQUIRED_PYTHON_MINOR = 12

// Common Windows Python installation paths
const WINDOWS_PYTHON_PATHS = [
  // Microsoft Store Python
  path.join(os.homedir(), 'AppData', 'Local', 'Microsoft', 'WindowsApps'),
  // Official Python installer (user)
  path.join(os.homedir(), 'AppData', 'Local', 'Programs', 'Python'),
  // Official Python installer (system)
  'C:\\Python312',
  'C:\\Python311',
  'C:\\Python310',
  // Program Files
  path.join(process.env.ProgramFiles || 'C:\\Program Files', 'Python312'),
  path.join(process.env.ProgramFiles || 'C:\\Program Files', 'Python311'),
  path.join(process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)', 'Python312'),
  // pyenv-win
  path.join(os.homedir(), '.pyenv', 'pyenv-win', 'versions'),
  // Conda
  path.join(os.homedir(), 'anaconda3'),
  path.join(os.homedir(), 'miniconda3'),
  // Scoop
  path.join(os.homedir(), 'scoop', 'apps', 'python', 'current'),
]

// ============================================================================
// Windows Python Diagnostics Service
// ============================================================================

class WindowsPythonDiagnosticsService extends EventEmitter {
  /**
   * Check if running on Windows
   */
  isWindows(): boolean {
    return process.platform === 'win32'
  }

  /**
   * Run comprehensive Windows diagnostics
   */
  async runDiagnostics(): Promise<WindowsDiagnosticsResult> {
    if (!this.isWindows()) {
      throw new Error('Windows diagnostics can only run on Windows systems')
    }

    loggerService.info('[WindowsDiagnostics] Starting comprehensive Windows diagnostics')
    this.emit('diagnostics:start')

    const issues: WindowsDiagnosticIssue[] = []
    const allRemediationSteps: string[] = []

    // 1. Get Windows version
    const windowsVersion = this.getWindowsVersion()

    // 2. Check Python installation
    const pythonInstallation = await this.detectPythonInstallation()
    if (!pythonInstallation.isValid) {
      issues.push({
        category: 'python',
        severity: 'critical',
        message: pythonInstallation.type === 'none'
          ? 'Python is not installed or not found in PATH'
          : `Python ${pythonInstallation.version} found but Python 3.12+ is required`,
        details: `Detected: ${pythonInstallation.type}, Path: ${pythonInstallation.path}`,
        remediation: [
          'Download Python 3.12 from https://www.python.org/downloads/',
          'Run the installer and CHECK "Add Python to PATH"',
          'Restart your terminal/command prompt after installation',
          'Alternatively, use the py launcher: py -3.12 --version',
        ],
      })
    }

    // 3. Check Visual C++ redistributables
    const visualCpp = await this.checkVisualCppRedistributables()
    if (!visualCpp.installed) {
      issues.push({
        category: 'visual_cpp',
        severity: 'critical',
        message: 'Visual C++ Redistributable is not installed',
        details: visualCpp.error,
        remediation: visualCpp.remediation || [
          'Download Visual C++ Redistributable from Microsoft:',
          'https://aka.ms/vs/17/release/vc_redist.x64.exe',
          'Run the installer and restart your computer',
        ],
      })
    }

    // 4. Check path length issues
    const pathInfo = await this.checkPathLengths()
    if (pathInfo.hasLongPaths) {
      issues.push({
        category: 'path',
        severity: 'warning',
        message: `${pathInfo.problematicPaths.length} path(s) exceed Windows MAX_PATH limit (260 chars)`,
        details: pathInfo.problematicPaths.slice(0, 3).join('\n'),
        remediation: pathInfo.remediation || [
          'Enable long path support in Windows:',
          '1. Open Group Policy Editor (gpedit.msc)',
          '2. Navigate to: Local Computer Policy > Computer Configuration > Administrative Templates > System > Filesystem',
          '3. Enable "Enable Win32 long paths"',
          'Or set registry: HKLM\\SYSTEM\\CurrentControlSet\\Control\\FileSystem\\LongPathsEnabled = 1',
        ],
      })
    }

    // 5. Check execution policy
    const executionPolicy = await this.checkExecutionPolicy()
    if (!executionPolicy.canExecuteScripts) {
      issues.push({
        category: 'execution_policy',
        severity: 'warning',
        message: `PowerShell execution policy (${executionPolicy.policy}) may prevent script execution`,
        details: executionPolicy.error,
        remediation: executionPolicy.remediation || [
          'Open PowerShell as Administrator and run:',
          'Set-ExecutionPolicy -ExecutionPolicy RemoteSigned -Scope CurrentUser',
        ],
      })
    }

    // 6. Check subprocess spawning
    const subprocessSpawn = await this.checkSubprocessSpawning()
    if (!subprocessSpawn.cmdExeWorks || subprocessSpawn.errors.length > 0) {
      issues.push({
        category: 'subprocess',
        severity: subprocessSpawn.cmdExeWorks ? 'warning' : 'critical',
        message: 'Subprocess spawning issues detected',
        details: subprocessSpawn.errors.join('; '),
        remediation: [
          'Ensure cmd.exe is accessible from PATH',
          'Check for antivirus software blocking process creation',
          'Verify no Windows Defender Application Control policies are blocking scripts',
        ],
      })
    }

    // 7. Check CUDA/GPU
    const cuda = await this.checkCudaSupport()
    if (!cuda.nvidiaDriverInstalled) {
      issues.push({
        category: 'cuda',
        severity: 'info',
        message: 'NVIDIA GPU not detected (will use CPU mode)',
        details: cuda.error,
        remediation: [
          'GPU acceleration is optional but recommended for faster transcription',
          'If you have an NVIDIA GPU, install drivers from: https://www.nvidia.com/drivers',
          'CUDA toolkit is included with PyTorch, no separate installation needed',
        ],
      })
    }

    // Collect all remediation steps
    for (const issue of issues) {
      allRemediationSteps.push(...issue.remediation)
    }

    // Determine overall health
    const criticalCount = issues.filter((i) => i.severity === 'critical').length
    const warningCount = issues.filter((i) => i.severity === 'warning').length
    let overallHealth: 'healthy' | 'degraded' | 'failed' = 'healthy'
    if (criticalCount > 0) {
      overallHealth = 'failed'
    } else if (warningCount > 0) {
      overallHealth = 'degraded'
    }

    const result: WindowsDiagnosticsResult = {
      timestamp: new Date().toISOString(),
      windowsVersion,
      pythonInstallation,
      visualCpp,
      pathInfo,
      executionPolicy,
      subprocessSpawn,
      cuda,
      overallHealth,
      issues,
      allRemediationSteps: [...new Set(allRemediationSteps)],
    }

    loggerService.info('[WindowsDiagnostics] Diagnostics complete', {
      health: overallHealth,
      issueCount: issues.length,
      criticalCount,
      warningCount,
    })
    this.emit('diagnostics:complete', result)

    return result
  }

  /**
   * Get Windows version information
   */
  private getWindowsVersion(): {
    version: string
    build: string
    edition: string
    arch: string
  } {
    try {
      // Use wmic for version info
      const versionOutput = execSync('wmic os get Caption,Version,BuildNumber /format:list', {
        encoding: 'utf8',
        timeout: 10000,
        stdio: ['pipe', 'pipe', 'pipe'],
      })

      const lines = versionOutput.split('\n').filter((l) => l.trim())
      const info: Record<string, string> = {}
      for (const line of lines) {
        const [key, value] = line.split('=')
        if (key && value) {
          info[key.trim()] = value.trim()
        }
      }

      return {
        version: info['Version'] || 'Unknown',
        build: info['BuildNumber'] || 'Unknown',
        edition: info['Caption'] || 'Windows',
        arch: process.arch === 'x64' ? '64-bit' : '32-bit',
      }
    } catch (error) {
      loggerService.warn('[WindowsDiagnostics] Failed to get Windows version', error)
      return {
        version: os.release(),
        build: 'Unknown',
        edition: 'Windows',
        arch: process.arch === 'x64' ? '64-bit' : '32-bit',
      }
    }
  }

  /**
   * Detect Python installation on Windows
   */
  async detectPythonInstallation(): Promise<WindowsPythonInstallation> {
    const result: WindowsPythonInstallation = {
      type: 'none',
      path: null,
      version: null,
      isValid: false,
      arch: null,
      installDir: null,
    }

    // Try py launcher first (recommended on Windows)
    try {
      const pyPath = execSync('where py', {
        encoding: 'utf8',
        timeout: 5000,
        stdio: ['pipe', 'pipe', 'pipe'],
      }).trim().split('\n')[0]

      if (pyPath && fs.existsSync(pyPath)) {
        // Check if py launcher can find Python 3.12
        try {
          const versionOutput = execSync('py -3.12 -c "import sys; print(f\'{sys.version_info.major}.{sys.version_info.minor}.{sys.version_info.micro}\')"', {
            encoding: 'utf8',
            timeout: 10000,
            stdio: ['pipe', 'pipe', 'pipe'],
          }).trim()

          if (versionOutput) {
            const [major, minor] = versionOutput.split('.').map(Number)
            result.type = 'py_launcher'
            result.path = pyPath
            result.version = versionOutput
            result.isValid = major === REQUIRED_PYTHON_MAJOR && minor >= REQUIRED_PYTHON_MINOR
            result.arch = process.arch

            // Get actual Python path
            try {
              const pythonPath = execSync('py -3.12 -c "import sys; print(sys.executable)"', {
                encoding: 'utf8',
                timeout: 5000,
                stdio: ['pipe', 'pipe', 'pipe'],
              }).trim()
              result.installDir = path.dirname(pythonPath)
            } catch {
              // Ignore
            }

            if (result.isValid) {
              loggerService.info('[WindowsDiagnostics] Found Python via py launcher', { ...result })
              return result
            }
          }
        } catch {
          // py launcher exists but Python 3.12 not available
        }
      }
    } catch {
      // py launcher not found
    }

    // Try python directly
    try {
      const pythonPath = execSync('where python', {
        encoding: 'utf8',
        timeout: 5000,
        stdio: ['pipe', 'pipe', 'pipe'],
      }).trim().split('\n')[0]

      if (pythonPath && fs.existsSync(pythonPath)) {
        // Check version
        const versionOutput = execSync(`"${pythonPath}" -c "import sys; print(f'{sys.version_info.major}.{sys.version_info.minor}.{sys.version_info.micro}')"`, {
          encoding: 'utf8',
          timeout: 10000,
          stdio: ['pipe', 'pipe', 'pipe'],
        }).trim()

        if (versionOutput) {
          const [major, minor] = versionOutput.split('.').map(Number)

          // Check if this is Microsoft Store Python
          const isStorePython = pythonPath.toLowerCase().includes('windowsapps')

          result.type = isStorePython ? 'store' : 'python'
          result.path = pythonPath
          result.version = versionOutput
          result.isValid = major === REQUIRED_PYTHON_MAJOR && minor >= REQUIRED_PYTHON_MINOR
          result.arch = process.arch
          result.installDir = path.dirname(pythonPath)

          loggerService.info('[WindowsDiagnostics] Found Python via python command', { ...result })
          return result
        }
      }
    } catch {
      // python not found
    }

    // Search common installation paths
    for (const basePath of WINDOWS_PYTHON_PATHS) {
      try {
        if (!fs.existsSync(basePath)) continue

        // Handle versioned subdirectories
        const dirs = fs.readdirSync(basePath)
        for (const dir of dirs) {
          const pythonExe = path.join(basePath, dir, 'python.exe')
          if (fs.existsSync(pythonExe)) {
            try {
              const versionOutput = execSync(`"${pythonExe}" -c "import sys; print(f'{sys.version_info.major}.{sys.version_info.minor}.{sys.version_info.micro}')"`, {
                encoding: 'utf8',
                timeout: 10000,
                stdio: ['pipe', 'pipe', 'pipe'],
              }).trim()

              const [major, minor] = versionOutput.split('.').map(Number)
              if (major === REQUIRED_PYTHON_MAJOR && minor >= REQUIRED_PYTHON_MINOR) {
                result.type = 'python'
                result.path = pythonExe
                result.version = versionOutput
                result.isValid = true
                result.arch = process.arch
                result.installDir = path.dirname(pythonExe)
                loggerService.info('[WindowsDiagnostics] Found Python in common path', { ...result })
                return result
              }
            } catch {
              // Skip this path
            }
          }
        }

        // Direct python.exe in basePath
        const directExe = path.join(basePath, 'python.exe')
        if (fs.existsSync(directExe)) {
          try {
            const versionOutput = execSync(`"${directExe}" -c "import sys; print(f'{sys.version_info.major}.{sys.version_info.minor}.{sys.version_info.micro}')"`, {
              encoding: 'utf8',
              timeout: 10000,
              stdio: ['pipe', 'pipe', 'pipe'],
            }).trim()

            const [major, minor] = versionOutput.split('.').map(Number)
            if (major === REQUIRED_PYTHON_MAJOR && minor >= REQUIRED_PYTHON_MINOR) {
              result.type = 'python'
              result.path = directExe
              result.version = versionOutput
              result.isValid = true
              result.arch = process.arch
              result.installDir = basePath
              loggerService.info('[WindowsDiagnostics] Found Python in base path', { ...result })
              return result
            }
          } catch {
            // Skip this path
          }
        }
      } catch {
        // Skip inaccessible directories
      }
    }

    loggerService.warn('[WindowsDiagnostics] Python 3.12+ not found')
    return result
  }

  /**
   * Check Visual C++ Redistributables
   */
  async checkVisualCppRedistributables(): Promise<VisualCppStatus> {
    const result: VisualCppStatus = {
      installed: false,
      versions: [],
      cudaCompatible: false,
    }

    try {
      // Check registry for Visual C++ redistributables
      const registryPaths = [
        'HKLM\\SOFTWARE\\Microsoft\\VisualStudio\\14.0\\VC\\Runtimes\\x64',
        'HKLM\\SOFTWARE\\WOW6432Node\\Microsoft\\VisualStudio\\14.0\\VC\\Runtimes\\x64',
      ]

      for (const regPath of registryPaths) {
        try {
          const output = execSync(`reg query "${regPath}" /v Version 2>nul`, {
            encoding: 'utf8',
            timeout: 5000,
            stdio: ['pipe', 'pipe', 'pipe'],
          })

          const versionMatch = output.match(/Version\s+REG_SZ\s+(\S+)/)
          if (versionMatch) {
            result.versions.push(versionMatch[1])
            result.installed = true
          }
        } catch {
          // Registry key not found
        }
      }

      // Alternative check: look for VC runtime DLLs
      if (!result.installed) {
        const system32 = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32')
        const vcDlls = ['vcruntime140.dll', 'vcruntime140_1.dll', 'msvcp140.dll']

        let dllCount = 0
        for (const dll of vcDlls) {
          if (fs.existsSync(path.join(system32, dll))) {
            dllCount++
          }
        }

        if (dllCount >= 2) {
          result.installed = true
          result.versions.push('14.0+ (detected via DLLs)')
        }
      }

      // Check for CUDA-compatible version (VC++ 2019 or later)
      result.cudaCompatible = result.installed && result.versions.some((v) => {
        const match = v.match(/v?(\d+)\.(\d+)/)
        if (match) {
          const major = parseInt(match[1], 10)
          return major >= 14
        }
        return false
      })

      if (!result.installed) {
        result.error = 'Visual C++ Redistributable 2015-2022 is required for Python packages'
        result.remediation = [
          'Download and install Visual C++ Redistributable:',
          'https://aka.ms/vs/17/release/vc_redist.x64.exe (64-bit)',
          'Restart your computer after installation',
        ]
      }

      loggerService.info('[WindowsDiagnostics] Visual C++ check', { ...result })
      return result
    } catch (error) {
      result.error = `Failed to check Visual C++: ${error instanceof Error ? error.message : String(error)}`
      result.remediation = [
        'Unable to verify Visual C++ Redistributable status',
        'Download from: https://aka.ms/vs/17/release/vc_redist.x64.exe',
      ]
      return result
    }
  }

  /**
   * Check for path length issues
   */
  async checkPathLengths(): Promise<WindowsPathInfo> {
    const result: WindowsPathInfo = {
      hasLongPaths: false,
      problematicPaths: [],
      longPathsEnabled: false,
    }

    // Check if long path support is enabled
    try {
      const regOutput = execSync(
        'reg query "HKLM\\SYSTEM\\CurrentControlSet\\Control\\FileSystem" /v LongPathsEnabled 2>nul',
        {
          encoding: 'utf8',
          timeout: 5000,
          stdio: ['pipe', 'pipe', 'pipe'],
        }
      )
      result.longPathsEnabled = regOutput.includes('0x1')
    } catch {
      result.longPathsEnabled = false
    }

    // Check relevant paths
    const pathsToCheck = [
      // App data paths
      path.join(os.homedir(), 'AppData', 'Local', 'FlowRecap'),
      path.join(os.homedir(), 'AppData', 'Roaming', 'FlowRecap'),
      // HuggingFace cache
      path.join(os.homedir(), '.cache', 'huggingface'),
      // Python venv paths
      process.cwd(),
    ]

    for (const p of pathsToCheck) {
      if (p.length > WINDOWS_MAX_PATH) {
        result.hasLongPaths = true
        result.problematicPaths.push(p)
      }
    }

    // Also check if working directory might cause issues
    if (process.cwd().length > WINDOWS_MAX_PATH - 100) {
      // Leave room for subdirectories
      result.hasLongPaths = true
      result.problematicPaths.push(`Working directory may cause long path issues: ${process.cwd()}`)
    }

    if (result.hasLongPaths && !result.longPathsEnabled) {
      result.remediation = [
        'Enable long path support in Windows:',
        '1. Run PowerShell as Administrator',
        '2. Execute: New-ItemProperty -Path "HKLM:\\SYSTEM\\CurrentControlSet\\Control\\FileSystem" -Name "LongPathsEnabled" -Value 1 -PropertyType DWORD -Force',
        '3. Restart your computer',
        '',
        'Or move the application to a shorter path (e.g., C:\\FlowRecap)',
      ]
    }

    loggerService.info('[WindowsDiagnostics] Path length check', { ...result })
    return result
  }

  /**
   * Check PowerShell execution policy
   */
  async checkExecutionPolicy(): Promise<ExecutionPolicyStatus> {
    const result: ExecutionPolicyStatus = {
      policy: 'Unknown',
      canExecuteScripts: false,
      uacIssue: false,
    }

    try {
      const policyOutput = execSync('powershell -Command "Get-ExecutionPolicy"', {
        encoding: 'utf8',
        timeout: 10000,
        stdio: ['pipe', 'pipe', 'pipe'],
      }).trim()

      result.policy = policyOutput

      // Check if scripts can be executed
      result.canExecuteScripts = ['Unrestricted', 'RemoteSigned', 'Bypass', 'AllSigned'].includes(policyOutput)

      if (!result.canExecuteScripts) {
        result.error = `Execution policy "${policyOutput}" may prevent script execution`
        result.remediation = [
          'Open PowerShell as Administrator and run:',
          'Set-ExecutionPolicy -ExecutionPolicy RemoteSigned -Scope CurrentUser',
          '',
          'This allows scripts from trusted sources to run while blocking untrusted scripts.',
        ]
      }

      loggerService.info('[WindowsDiagnostics] Execution policy check', { ...result })
      return result
    } catch (error) {
      result.error = `Failed to check execution policy: ${error instanceof Error ? error.message : String(error)}`
      return result
    }
  }

  /**
   * Check subprocess spawning capabilities
   */
  async checkSubprocessSpawning(): Promise<SubprocessSpawnInfo> {
    const result: SubprocessSpawnInfo = {
      cmdExeWorks: false,
      powershellWorks: false,
      envPropagation: false,
      encoding: 'unknown',
      errors: [],
    }

    // Test cmd.exe spawning
    try {
      await new Promise<void>((resolve, reject) => {
        const proc = spawn('cmd.exe', ['/c', 'echo TEST_CMD_OK'], {
          stdio: ['pipe', 'pipe', 'pipe'],
          timeout: 10000,
        })

        let stdout = ''
        proc.stdout?.on('data', (data) => {
          stdout += data.toString()
        })

        proc.on('exit', (code) => {
          if (code === 0 && stdout.includes('TEST_CMD_OK')) {
            result.cmdExeWorks = true
            resolve()
          } else {
            reject(new Error(`cmd.exe test failed with code ${code}`))
          }
        })

        proc.on('error', reject)

        setTimeout(() => reject(new Error('cmd.exe test timed out')), 10000)
      })
    } catch (error) {
      result.errors.push(`cmd.exe: ${error instanceof Error ? error.message : String(error)}`)
    }

    // Test PowerShell spawning
    try {
      await new Promise<void>((resolve, reject) => {
        const proc = spawn('powershell.exe', ['-Command', 'Write-Output TEST_PS_OK'], {
          stdio: ['pipe', 'pipe', 'pipe'],
          timeout: 10000,
        })

        let stdout = ''
        proc.stdout?.on('data', (data) => {
          stdout += data.toString()
        })

        proc.on('exit', (code) => {
          if (code === 0 && stdout.includes('TEST_PS_OK')) {
            result.powershellWorks = true
            resolve()
          } else {
            reject(new Error(`PowerShell test failed with code ${code}`))
          }
        })

        proc.on('error', reject)

        setTimeout(() => reject(new Error('PowerShell test timed out')), 10000)
      })
    } catch (error) {
      result.errors.push(`PowerShell: ${error instanceof Error ? error.message : String(error)}`)
    }

    // Test environment variable propagation
    try {
      const testKey = 'TEST_ENV_PROPAGATION'
      const testValue = `test_${Date.now()}`

      await new Promise<void>((resolve, reject) => {
        const proc = spawn('cmd.exe', ['/c', `echo %${testKey}%`], {
          stdio: ['pipe', 'pipe', 'pipe'],
          env: {
            ...process.env,
            [testKey]: testValue,
          },
          timeout: 10000,
        })

        let stdout = ''
        proc.stdout?.on('data', (data) => {
          stdout += data.toString()
        })

        proc.on('exit', (code) => {
          if (code === 0 && stdout.includes(testValue)) {
            result.envPropagation = true
            resolve()
          } else {
            reject(new Error('Environment variable not propagated'))
          }
        })

        proc.on('error', reject)

        setTimeout(() => reject(new Error('Env propagation test timed out')), 10000)
      })
    } catch (error) {
      result.errors.push(`Env propagation: ${error instanceof Error ? error.message : String(error)}`)
    }

    // Check console encoding
    try {
      const chcpOutput = execSync('chcp', {
        encoding: 'utf8',
        timeout: 5000,
        stdio: ['pipe', 'pipe', 'pipe'],
      }).trim()

      if (chcpOutput.includes('65001')) {
        result.encoding = 'UTF-8 (65001)'
      } else {
        const cpMatch = chcpOutput.match(/(\d+)/)
        result.encoding = cpMatch ? `Code page ${cpMatch[1]}` : chcpOutput
      }
    } catch {
      result.encoding = 'unknown'
    }

    loggerService.info('[WindowsDiagnostics] Subprocess spawn check', { ...result })
    return result
  }

  /**
   * Check CUDA/GPU support on Windows
   */
  async checkCudaSupport(): Promise<WindowsCudaStatus> {
    const result: WindowsCudaStatus = {
      nvidiaDriverInstalled: false,
      driverVersion: null,
      cudaVersion: null,
      cudnnAvailable: false,
      gpuName: null,
      gpuMemoryGB: null,
    }

    try {
      // Try nvidia-smi
      const nvidiaSmiOutput = execSync('nvidia-smi --query-gpu=name,memory.total,driver_version --format=csv,noheader,nounits', {
        encoding: 'utf8',
        timeout: 10000,
        stdio: ['pipe', 'pipe', 'pipe'],
      }).trim()

      if (nvidiaSmiOutput) {
        result.nvidiaDriverInstalled = true
        const parts = nvidiaSmiOutput.split(',').map((s) => s.trim())
        if (parts.length >= 3) {
          result.gpuName = parts[0]
          result.gpuMemoryGB = Math.round(parseInt(parts[1], 10) / 1024)
          result.driverVersion = parts[2]
        }

        // Check CUDA version
        try {
          const cudaOutput = execSync('nvidia-smi', {
            encoding: 'utf8',
            timeout: 10000,
            stdio: ['pipe', 'pipe', 'pipe'],
          })
          const cudaMatch = cudaOutput.match(/CUDA Version:\s*([\d.]+)/)
          if (cudaMatch) {
            result.cudaVersion = cudaMatch[1]
          }
        } catch {
          // CUDA version not available
        }
      }

      loggerService.info('[WindowsDiagnostics] CUDA check', { ...result })
      return result
    } catch (error) {
      result.error = 'NVIDIA GPU not detected. Transcription will use CPU mode.'
      return result
    }
  }

  /**
   * Get Windows-specific troubleshooting guide
   */
  getTroubleshootingGuide(issue: WindowsDiagnosticIssue): string {
    const guides: Record<string, string> = {
      python: `
=== Python Installation Troubleshooting ===

1. RECOMMENDED: Use the official Python installer
   - Download from: https://www.python.org/downloads/release/python-3120/
   - Select "Windows installer (64-bit)"
   - IMPORTANT: Check "Add python.exe to PATH" during installation
   - Choose "Customize installation" and enable "py launcher"

2. Verify installation:
   - Open Command Prompt (cmd.exe)
   - Run: py --version
   - Should show: Python 3.12.x

3. If Python is installed but not found:
   - Check if Python is in PATH:
     where python
   - Add manually to PATH:
     setx PATH "%PATH%;C:\\Python312;C:\\Python312\\Scripts"

4. Multiple Python versions:
   - Use py launcher to specify version: py -3.12
   - List installed versions: py --list
`,

      visual_cpp: `
=== Visual C++ Redistributable Troubleshooting ===

PyTorch and other Python packages require Visual C++ runtime libraries.

1. Download the latest Visual C++ Redistributable:
   https://aka.ms/vs/17/release/vc_redist.x64.exe

2. Run the installer and follow prompts

3. Restart your computer

4. Verify installation:
   - Check Programs and Features for "Microsoft Visual C++ 2015-2022 Redistributable"

5. If issues persist, install Build Tools:
   - Download: https://visualstudio.microsoft.com/visual-cpp-build-tools/
   - Select "Desktop development with C++" workload
`,

      path: `
=== Windows Path Length Troubleshooting ===

Windows traditionally limits paths to 260 characters (MAX_PATH).

1. Enable long path support (Windows 10 1607+):

   Option A - PowerShell (run as Administrator):
   New-ItemProperty -Path "HKLM:\\SYSTEM\\CurrentControlSet\\Control\\FileSystem" -Name "LongPathsEnabled" -Value 1 -PropertyType DWORD -Force

   Option B - Group Policy:
   - Run gpedit.msc
   - Navigate: Computer Configuration > Administrative Templates > System > Filesystem
   - Enable "Enable Win32 long paths"

2. Restart your computer

3. Alternative: Install the application to a shorter path
   - Move to C:\\Apps or similar short path
`,

      execution_policy: `
=== PowerShell Execution Policy Troubleshooting ===

PowerShell may block script execution by default.

1. Check current policy:
   Get-ExecutionPolicy

2. Set policy to allow signed scripts (recommended):
   Set-ExecutionPolicy -ExecutionPolicy RemoteSigned -Scope CurrentUser

3. Policy options:
   - RemoteSigned: Requires signature for downloaded scripts (recommended)
   - Bypass: No restrictions (use with caution)
   - AllSigned: Requires all scripts to be signed

4. If using Group Policy:
   - Contact your IT administrator to allow script execution
`,

      subprocess: `
=== Subprocess Spawning Troubleshooting ===

The application spawns Python processes to run ML models.

1. Check antivirus software:
   - Temporarily disable real-time protection to test
   - Add FlowRecap to exclusions if it resolves the issue

2. Windows Defender SmartScreen:
   - May block unsigned executables
   - Allow the application when prompted

3. User Account Control (UAC):
   - Run the application as administrator if needed
   - Note: This is usually not required

4. Verify cmd.exe works:
   - Open Start menu, type "cmd", press Enter
   - If cmd.exe doesn't open, system files may be corrupted
   - Run: sfc /scannow (as administrator)
`,

      cuda: `
=== CUDA/GPU Troubleshooting ===

GPU acceleration is optional but significantly speeds up transcription.

1. Check NVIDIA driver:
   - Open Device Manager > Display adapters
   - Should show NVIDIA GPU

2. Install/update NVIDIA driver:
   - https://www.nvidia.com/drivers
   - Use GeForce Experience for automatic updates

3. Verify CUDA:
   - Open command prompt
   - Run: nvidia-smi
   - Should show GPU info and CUDA version

4. Note: CUDA toolkit is bundled with PyTorch
   - No separate CUDA installation needed
   - PyTorch will use CUDA if driver is installed

5. CPU mode:
   - Transcription works without GPU (slower)
   - No action required if GPU isn't available
`,
    }

    return guides[issue.category] || 'No specific troubleshooting guide available for this issue.'
  }

  /**
   * Generate a diagnostic report as text
   */
  generateReport(result: WindowsDiagnosticsResult): string {
    const lines: string[] = []

    lines.push('═══════════════════════════════════════════════════════════════')
    lines.push('       WINDOWS PYTHON ENVIRONMENT DIAGNOSTIC REPORT')
    lines.push('═══════════════════════════════════════════════════════════════')
    lines.push('')
    lines.push(`Timestamp: ${result.timestamp}`)
    lines.push(`Overall Health: ${result.overallHealth.toUpperCase()}`)
    lines.push('')

    // Windows Version
    lines.push('─── Windows Information ───')
    lines.push(`Edition: ${result.windowsVersion.edition}`)
    lines.push(`Version: ${result.windowsVersion.version}`)
    lines.push(`Build: ${result.windowsVersion.build}`)
    lines.push(`Architecture: ${result.windowsVersion.arch}`)
    lines.push('')

    // Python
    lines.push('─── Python Installation ───')
    lines.push(`Status: ${result.pythonInstallation.isValid ? '✅ VALID' : '❌ INVALID'}`)
    lines.push(`Type: ${result.pythonInstallation.type}`)
    lines.push(`Version: ${result.pythonInstallation.version || 'Not found'}`)
    lines.push(`Path: ${result.pythonInstallation.path || 'Not found'}`)
    lines.push('')

    // Visual C++
    lines.push('─── Visual C++ Redistributable ───')
    lines.push(`Status: ${result.visualCpp.installed ? '✅ INSTALLED' : '❌ NOT INSTALLED'}`)
    if (result.visualCpp.versions.length > 0) {
      lines.push(`Versions: ${result.visualCpp.versions.join(', ')}`)
    }
    lines.push(`CUDA Compatible: ${result.visualCpp.cudaCompatible ? 'Yes' : 'No'}`)
    lines.push('')

    // Path Lengths
    lines.push('─── Path Length Check ───')
    lines.push(`Long Paths Enabled: ${result.pathInfo.longPathsEnabled ? '✅ Yes' : '❌ No'}`)
    lines.push(`Long Path Issues: ${result.pathInfo.hasLongPaths ? '⚠️ Yes' : '✅ No'}`)
    if (result.pathInfo.problematicPaths.length > 0) {
      lines.push('Problematic Paths:')
      for (const p of result.pathInfo.problematicPaths) {
        lines.push(`  - ${p}`)
      }
    }
    lines.push('')

    // Execution Policy
    lines.push('─── Execution Policy ───')
    lines.push(`Policy: ${result.executionPolicy.policy}`)
    lines.push(`Can Execute Scripts: ${result.executionPolicy.canExecuteScripts ? '✅ Yes' : '❌ No'}`)
    lines.push('')

    // Subprocess
    lines.push('─── Subprocess Spawning ───')
    lines.push(`cmd.exe: ${result.subprocessSpawn.cmdExeWorks ? '✅ OK' : '❌ Failed'}`)
    lines.push(`PowerShell: ${result.subprocessSpawn.powershellWorks ? '✅ OK' : '❌ Failed'}`)
    lines.push(`Env Propagation: ${result.subprocessSpawn.envPropagation ? '✅ OK' : '❌ Failed'}`)
    lines.push(`Console Encoding: ${result.subprocessSpawn.encoding}`)
    lines.push('')

    // CUDA
    lines.push('─── GPU/CUDA Support ───')
    lines.push(`NVIDIA Driver: ${result.cuda.nvidiaDriverInstalled ? '✅ Installed' : '❌ Not detected'}`)
    if (result.cuda.gpuName) {
      lines.push(`GPU: ${result.cuda.gpuName}`)
      lines.push(`Memory: ${result.cuda.gpuMemoryGB} GB`)
      lines.push(`Driver Version: ${result.cuda.driverVersion}`)
      lines.push(`CUDA Version: ${result.cuda.cudaVersion || 'Unknown'}`)
    } else {
      lines.push('GPU acceleration not available (will use CPU)')
    }
    lines.push('')

    // Issues
    if (result.issues.length > 0) {
      lines.push('═══════════════════════════════════════════════════════════════')
      lines.push('                         ISSUES FOUND')
      lines.push('═══════════════════════════════════════════════════════════════')
      lines.push('')

      for (const issue of result.issues) {
        const icon = issue.severity === 'critical' ? '❌' : issue.severity === 'warning' ? '⚠️' : 'ℹ️'
        lines.push(`${icon} [${issue.severity.toUpperCase()}] ${issue.category}`)
        lines.push(`   ${issue.message}`)
        if (issue.details) {
          lines.push(`   Details: ${issue.details}`)
        }
        lines.push('')
      }
    }

    // Remediation Steps
    if (result.allRemediationSteps.length > 0) {
      lines.push('═══════════════════════════════════════════════════════════════')
      lines.push('                      REMEDIATION STEPS')
      lines.push('═══════════════════════════════════════════════════════════════')
      lines.push('')

      for (let i = 0; i < result.allRemediationSteps.length; i++) {
        lines.push(`${i + 1}. ${result.allRemediationSteps[i]}`)
      }
      lines.push('')
    }

    lines.push('═══════════════════════════════════════════════════════════════')
    lines.push('                      END OF REPORT')
    lines.push('═══════════════════════════════════════════════════════════════')

    return lines.join('\n')
  }
}

// Export singleton instance
export const windowsPythonDiagnostics = new WindowsPythonDiagnosticsService()

// Export class for testing
export { WindowsPythonDiagnosticsService }
