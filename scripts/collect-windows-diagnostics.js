#!/usr/bin/env node

/**
 * Windows Diagnostics Collector
 *
 * Collects comprehensive diagnostic information for Windows systems.
 * Used for troubleshooting CI failures and local development issues.
 *
 * Usage:
 *   node scripts/collect-windows-diagnostics.js [options]
 *
 * Options:
 *   --output <file>   Output file path (default: windows-diagnostics.json)
 *   --verbose         Print diagnostics to console
 *   --include-logs    Include Windows event logs (slower)
 *   --python-only     Only collect Python-related diagnostics
 *
 * Output:
 *   JSON file with system information, Python details, audio devices,
 *   environment variables, and potential issues.
 */

const { execSync, spawnSync } = require('child_process')
const fs = require('fs')
const path = require('path')
const os = require('os')

// ============================================================================
// Configuration
// ============================================================================

const CONFIG = {
  isWindows: process.platform === 'win32',
  outputFile: 'windows-diagnostics.json',
  verbose: false,
  includeLogs: false,
  pythonOnly: false
}

// Parse command line arguments
process.argv.slice(2).forEach((arg, index, args) => {
  if (arg === '--output' && args[index + 1]) {
    CONFIG.outputFile = args[index + 1]
  } else if (arg === '--verbose') {
    CONFIG.verbose = true
  } else if (arg === '--include-logs') {
    CONFIG.includeLogs = true
  } else if (arg === '--python-only') {
    CONFIG.pythonOnly = true
  }
})

// ============================================================================
// Helper Functions
// ============================================================================

function log(message) {
  if (CONFIG.verbose) {
    console.log(message)
  }
}

function runCommand(command, options = {}) {
  try {
    const result = execSync(command, {
      encoding: 'utf-8',
      timeout: options.timeout || 30000,
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true
    })
    return { success: true, output: result.trim() }
  } catch (error) {
    return {
      success: false,
      output: error.stdout?.toString() || '',
      error: error.stderr?.toString() || error.message
    }
  }
}

function runPowerShell(script, options = {}) {
  const escaped = script.replace(/"/g, '\\"')
  return runCommand(`powershell -Command "${escaped}"`, options)
}

function checkRegistryKey(key) {
  const result = runCommand(`reg query "${key}"`)
  return result.success
}

function getRegistryValue(key, valueName) {
  const result = runCommand(`reg query "${key}" /v ${valueName}`)
  if (result.success) {
    const match = result.output.match(new RegExp(`${valueName}\\s+REG_\\w+\\s+(.+)`, 'i'))
    return match ? match[1].trim() : null
  }
  return null
}

// ============================================================================
// Diagnostic Collectors
// ============================================================================

function collectSystemInfo() {
  log('Collecting system information...')

  const info = {
    platform: process.platform,
    arch: process.arch,
    nodeVersion: process.version,
    hostname: os.hostname(),
    username: os.userInfo().username,
    homedir: os.homedir(),
    tmpdir: os.tmpdir(),
    cpus: os.cpus().length,
    memory: {
      total: Math.round(os.totalmem() / (1024 * 1024 * 1024) * 100) / 100 + ' GB',
      free: Math.round(os.freemem() / (1024 * 1024 * 1024) * 100) / 100 + ' GB'
    }
  }

  if (CONFIG.isWindows) {
    // Get Windows version
    const osInfo = runCommand('wmic os get Caption,Version /value')
    if (osInfo.success) {
      const caption = osInfo.output.match(/Caption=(.+)/i)
      const version = osInfo.output.match(/Version=(.+)/i)
      info.windowsCaption = caption ? caption[1].trim() : 'Unknown'
      info.windowsVersion = version ? version[1].trim() : 'Unknown'
    }

    // Check if running in CI
    info.isCI = !!(process.env.CI || process.env.GITHUB_ACTIONS || process.env.TF_BUILD)

    // Check execution policy
    const execPolicy = runPowerShell('Get-ExecutionPolicy')
    info.executionPolicy = execPolicy.success ? execPolicy.output : 'Unknown'

    // Check long path support
    const longPaths = getRegistryValue(
      'HKLM\\SYSTEM\\CurrentControlSet\\Control\\FileSystem',
      'LongPathsEnabled'
    )
    info.longPathsEnabled = longPaths === '0x1' || longPaths === '1'
  }

  return info
}

function collectPythonInfo() {
  log('Collecting Python information...')

  const info = {
    installations: [],
    pyLauncher: { available: false },
    virtualEnvs: []
  }

  // Check py launcher
  if (CONFIG.isWindows) {
    const pyList = runCommand('py --list')
    if (pyList.success) {
      info.pyLauncher.available = true
      info.pyLauncher.versions = pyList.output.split('\n').map(l => l.trim()).filter(Boolean)
    }
  }

  // Check various Python commands
  const pythonCommands = ['python', 'python3', 'py -3', 'py -3.12', 'py -3.11']

  for (const cmd of pythonCommands) {
    const version = runCommand(`${cmd} --version`)
    if (version.success) {
      const location = runCommand(`${cmd} -c "import sys; print(sys.executable)"`)
      info.installations.push({
        command: cmd,
        version: version.output,
        path: location.success ? location.output : 'Unknown'
      })
    }
  }

  // Find Python installations via where
  if (CONFIG.isWindows) {
    const wherePython = runCommand('where python')
    if (wherePython.success) {
      info.pythonPaths = wherePython.output.split('\n').map(l => l.trim()).filter(Boolean)
    }
  }

  // Check pip
  const pipVersion = runCommand('pip --version')
  if (pipVersion.success) {
    info.pip = pipVersion.output
  }

  // Check for common ML packages
  const packages = ['torch', 'numpy', 'whisper', 'pyannote']
  const installed = []

  for (const pkg of packages) {
    const check = runCommand(`python -c "import ${pkg}; print(${pkg}.__version__)"`)
    if (check.success) {
      installed.push({ name: pkg, version: check.output })
    }
  }
  info.installedPackages = installed

  return info
}

function collectAudioInfo() {
  log('Collecting audio information...')

  const info = {
    devices: [],
    services: {},
    virtualDrivers: []
  }

  if (!CONFIG.isWindows) {
    return info
  }

  // Check Windows Audio service
  const audioSrv = runCommand('sc query Audiosrv')
  info.services.audioService = audioSrv.success && audioSrv.output.includes('RUNNING')

  const audioEndpoint = runCommand('sc query AudioEndpointBuilder')
  info.services.audioEndpointBuilder = audioEndpoint.success && audioEndpoint.output.includes('RUNNING')

  // Enumerate sound devices
  const soundDevices = runCommand('wmic sounddev get name,status /format:csv')
  if (soundDevices.success) {
    const lines = soundDevices.output.split('\n').filter(l => l.trim() && !l.includes('Node'))
    info.devices = lines.map(line => {
      const parts = line.split(',')
      return {
        name: parts[1]?.trim() || 'Unknown',
        status: parts[2]?.trim() || 'Unknown'
      }
    }).filter(d => d.name !== 'Unknown')
  }

  // Check for virtual audio drivers
  const virtualPatterns = ['VB-Audio', 'CABLE', 'Virtual', 'Voicemeeter']
  for (const device of info.devices) {
    for (const pattern of virtualPatterns) {
      if (device.name.toLowerCase().includes(pattern.toLowerCase())) {
        info.virtualDrivers.push(device)
        break
      }
    }
  }

  // Check VB-Audio registry
  info.vbAudioInstalled = checkRegistryKey('HKLM\\SOFTWARE\\VB-Audio') ||
    checkRegistryKey('HKLM\\SOFTWARE\\WOW6432Node\\VB-Audio')

  return info
}

function collectEnvironmentInfo() {
  log('Collecting environment information...')

  const info = {
    path: process.env.PATH?.split(path.delimiter) || [],
    pathLength: process.env.PATH?.length || 0,
    variables: {}
  }

  // Collect relevant environment variables
  const relevantVars = [
    'APPDATA',
    'LOCALAPPDATA',
    'USERPROFILE',
    'ProgramFiles',
    'ProgramFiles(x86)',
    'SystemRoot',
    'TEMP',
    'TMP',
    'HF_TOKEN',
    'HF_HOME',
    'HUGGINGFACE_TOKEN',
    'PYTHONPATH',
    'VIRTUAL_ENV',
    'CONDA_PREFIX'
  ]

  for (const varName of relevantVars) {
    const value = process.env[varName]
    info.variables[varName] = value ? (varName.includes('TOKEN') ? '***SET***' : value) : null
  }

  // Check for problematic paths
  info.issues = []

  if (info.pathLength > 4000) {
    info.issues.push(`PATH length (${info.pathLength}) exceeds recommended limit of 4000`)
  }

  const userProfile = process.env.USERPROFILE || ''
  if (/[^\x00-\x7F]/.test(userProfile)) {
    info.issues.push('USERPROFILE contains non-ASCII characters')
  }

  if (userProfile.includes(' ')) {
    info.issues.push('USERPROFILE contains spaces')
  }

  return info
}

function collectDiskInfo() {
  log('Collecting disk information...')

  const info = {
    drives: []
  }

  if (!CONFIG.isWindows) {
    return info
  }

  const diskInfo = runCommand('wmic logicaldisk where drivetype=3 get DeviceID,FreeSpace,Size /format:csv')
  if (diskInfo.success) {
    const lines = diskInfo.output.split('\n').filter(l => l.trim() && !l.includes('Node'))
    info.drives = lines.map(line => {
      const parts = line.split(',')
      const freeSpace = parseInt(parts[2]) || 0
      const size = parseInt(parts[3]) || 0
      return {
        drive: parts[1]?.trim() || 'Unknown',
        freeSpaceGB: Math.round(freeSpace / (1024 * 1024 * 1024) * 100) / 100,
        sizeGB: Math.round(size / (1024 * 1024 * 1024) * 100) / 100
      }
    }).filter(d => d.drive !== 'Unknown')
  }

  return info
}

function collectVisualCppInfo() {
  log('Collecting Visual C++ information...')

  const info = {
    redistributables: []
  }

  if (!CONFIG.isWindows) {
    return info
  }

  // Check for VC++ redistributables
  const vcKeys = [
    'HKLM\\SOFTWARE\\Microsoft\\VisualStudio\\14.0\\VC\\Runtimes\\x64',
    'HKLM\\SOFTWARE\\WOW6432Node\\Microsoft\\VisualStudio\\14.0\\VC\\Runtimes\\x64',
    'HKLM\\SOFTWARE\\Microsoft\\VisualStudio\\14.0\\VC\\Runtimes\\x86',
    'HKLM\\SOFTWARE\\WOW6432Node\\Microsoft\\VisualStudio\\14.0\\VC\\Runtimes\\x86'
  ]

  for (const key of vcKeys) {
    const version = getRegistryValue(key, 'Version')
    if (version) {
      info.redistributables.push({
        key: key,
        version: version
      })
    }
  }

  // Also check via wmic (slower but more comprehensive)
  const vcProducts = runCommand('wmic product where "name like \'%Visual C++%\'" get name,version /format:csv')
  if (vcProducts.success) {
    const lines = vcProducts.output.split('\n').filter(l => l.trim() && !l.includes('Node'))
    for (const line of lines) {
      const parts = line.split(',')
      if (parts[1]) {
        info.redistributables.push({
          name: parts[1].trim(),
          version: parts[2]?.trim() || 'Unknown'
        })
      }
    }
  }

  return info
}

function collectBinaryInfo() {
  log('Collecting binary information...')

  const info = {
    binaries: {}
  }

  const binariesToCheck = [
    { name: 'git', cmd: 'git --version' },
    { name: 'node', cmd: 'node --version' },
    { name: 'npm', cmd: 'npm --version' },
    { name: 'sox', cmd: 'sox --version' },
    { name: 'ffmpeg', cmd: 'ffmpeg -version' }
  ]

  for (const binary of binariesToCheck) {
    const result = runCommand(binary.cmd)
    info.binaries[binary.name] = {
      available: result.success,
      version: result.success ? result.output.split('\n')[0] : null
    }

    if (CONFIG.isWindows && result.success) {
      const where = runCommand(`where ${binary.name}`)
      if (where.success) {
        info.binaries[binary.name].path = where.output.split('\n')[0]
      }
    }
  }

  return info
}

function collectEventLogs() {
  log('Collecting event logs...')

  const info = {
    errors: []
  }

  if (!CONFIG.isWindows || !CONFIG.includeLogs) {
    return info
  }

  // Get recent Application errors
  const ps = runPowerShell(
    "Get-EventLog -LogName Application -EntryType Error -Newest 20 | Select-Object TimeWritten, Source, Message | ConvertTo-Json",
    { timeout: 60000 }
  )

  if (ps.success) {
    try {
      info.errors = JSON.parse(ps.output)
    } catch {
      info.errors = []
    }
  }

  return info
}

function analyzeIssues(diagnostics) {
  log('Analyzing potential issues...')

  const issues = []
  const warnings = []
  const recommendations = []

  // Check Python
  if (diagnostics.python.installations.length === 0) {
    issues.push({
      severity: 'error',
      category: 'python',
      message: 'No Python installation found'
    })
  } else {
    const hasPython312 = diagnostics.python.installations.some(p =>
      p.version.includes('3.12')
    )
    if (!hasPython312) {
      warnings.push({
        severity: 'warning',
        category: 'python',
        message: 'Python 3.12 not found - recommended for best compatibility'
      })
    }
  }

  // Check audio
  if (CONFIG.isWindows && !diagnostics.audio.services.audioService) {
    issues.push({
      severity: 'error',
      category: 'audio',
      message: 'Windows Audio service is not running'
    })
  }

  if (diagnostics.audio.devices.length === 0) {
    warnings.push({
      severity: 'warning',
      category: 'audio',
      message: 'No audio devices detected'
    })
  }

  // Check environment
  if (diagnostics.environment.pathLength > 4000) {
    warnings.push({
      severity: 'warning',
      category: 'environment',
      message: `PATH length (${diagnostics.environment.pathLength}) may cause issues`
    })
  }

  // Check disk space
  for (const drive of diagnostics.disk.drives) {
    if (drive.freeSpaceGB < 5) {
      warnings.push({
        severity: 'warning',
        category: 'disk',
        message: `Low disk space on ${drive.drive}: ${drive.freeSpaceGB} GB free`
      })
    }
  }

  // Check Visual C++
  if (CONFIG.isWindows && diagnostics.visualCpp.redistributables.length === 0) {
    warnings.push({
      severity: 'warning',
      category: 'runtime',
      message: 'Visual C++ Redistributable not detected - may cause issues with native modules'
    })
    recommendations.push('Install Visual C++ Redistributable 2015-2022')
  }

  // Add recommendations
  if (!diagnostics.system.longPathsEnabled) {
    recommendations.push('Enable Windows long path support for better compatibility')
  }

  if (diagnostics.audio.virtualDrivers.length === 0) {
    recommendations.push('Consider installing VB-Audio Virtual Cable for system audio capture')
  }

  return { issues, warnings, recommendations }
}

// ============================================================================
// Main
// ============================================================================

async function main() {
  console.log('=== Windows Diagnostics Collector ===')
  console.log(`Platform: ${process.platform}`)
  console.log(`Time: ${new Date().toISOString()}`)
  console.log('')

  if (!CONFIG.isWindows) {
    console.log('Note: Running on non-Windows platform. Some diagnostics will be skipped.')
    console.log('')
  }

  const diagnostics = {
    timestamp: new Date().toISOString(),
    collector: 'collect-windows-diagnostics.js',
    version: '1.0.0'
  }

  // Collect all diagnostics
  diagnostics.system = collectSystemInfo()

  diagnostics.python = collectPythonInfo()

  if (!CONFIG.pythonOnly) {
    diagnostics.audio = collectAudioInfo()
    diagnostics.environment = collectEnvironmentInfo()
    diagnostics.disk = collectDiskInfo()
    diagnostics.visualCpp = collectVisualCppInfo()
    diagnostics.binaries = collectBinaryInfo()

    if (CONFIG.includeLogs) {
      diagnostics.eventLogs = collectEventLogs()
    }

    // Analyze issues
    diagnostics.analysis = analyzeIssues(diagnostics)
  }

  // Write output
  const outputPath = path.resolve(CONFIG.outputFile)
  fs.writeFileSync(outputPath, JSON.stringify(diagnostics, null, 2))
  console.log(`\nDiagnostics saved to: ${outputPath}`)

  // Print summary if verbose
  if (CONFIG.verbose) {
    console.log('\n=== Summary ===')
    console.log(`Python installations: ${diagnostics.python.installations.length}`)
    if (!CONFIG.pythonOnly) {
      console.log(`Audio devices: ${diagnostics.audio.devices.length}`)
      console.log(`Issues found: ${diagnostics.analysis.issues.length}`)
      console.log(`Warnings: ${diagnostics.analysis.warnings.length}`)
      console.log(`Recommendations: ${diagnostics.analysis.recommendations.length}`)

      if (diagnostics.analysis.issues.length > 0) {
        console.log('\nIssues:')
        diagnostics.analysis.issues.forEach(i => console.log(`  - [${i.severity}] ${i.message}`))
      }

      if (diagnostics.analysis.warnings.length > 0) {
        console.log('\nWarnings:')
        diagnostics.analysis.warnings.forEach(w => console.log(`  - ${w.message}`))
      }
    }
  }

  console.log('\nDone!')
}

main().catch(error => {
  console.error('Error collecting diagnostics:', error)
  process.exit(1)
})
