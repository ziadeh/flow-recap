#!/usr/bin/env node
/**
 * Build Installers Script
 *
 * Automated script to build installers for all platforms.
 * Can be used for local testing or CI/CD.
 *
 * Usage:
 *   node scripts/build-installers.js [options]
 *
 * Options:
 *   --platform <platform>  Build for specific platform (mac, win, linux, all)
 *   --skip-vite            Skip Vite build (use existing dist/)
 *   --skip-icon-check      Skip icon file validation
 *   --unsigned             Skip code signing
 *   --verbose              Enable verbose output
 *   --help                 Show help
 */

const { execSync, spawn } = require('child_process')
const path = require('path')
const fs = require('fs')

// Configuration
const PROJECT_ROOT = path.resolve(__dirname, '..')
const RELEASE_DIR = path.join(PROJECT_ROOT, 'release')
const ICONS_DIR = path.join(PROJECT_ROOT, 'resources', 'icons')

// Parse command line arguments
const args = process.argv.slice(2)
const options = {
  platform: 'current',
  skipVite: false,
  skipIconCheck: false,
  unsigned: false,
  verbose: false,
  help: false
}

for (let i = 0; i < args.length; i++) {
  const arg = args[i]
  if (arg === '--platform' && args[i + 1]) {
    options.platform = args[++i]
  } else if (arg === '--skip-vite') {
    options.skipVite = true
  } else if (arg === '--skip-icon-check') {
    options.skipIconCheck = true
  } else if (arg === '--unsigned') {
    options.unsigned = true
  } else if (arg === '--verbose') {
    options.verbose = true
  } else if (arg === '--help' || arg === '-h') {
    options.help = true
  }
}

// Show help
if (options.help) {
  console.log(`
Build Installers for Meeting Notes

Usage:
  node scripts/build-installers.js [options]

Options:
  --platform <platform>  Build for specific platform:
                         - mac     macOS only
                         - win     Windows only
                         - linux   Linux only
                         - all     All platforms (cross-compile)
                         - current Current platform (default)
  --skip-vite            Skip Vite build step
  --skip-icon-check      Skip icon file validation
  --unsigned             Build without code signing
  --verbose              Enable verbose output
  --help                 Show this help

Examples:
  node scripts/build-installers.js
  node scripts/build-installers.js --platform mac --unsigned
  node scripts/build-installers.js --platform all --verbose
`)
  process.exit(0)
}

// Logging utilities
function log(message) {
  console.log(`[build] ${message}`)
}

function error(message) {
  console.error(`[build] ERROR: ${message}`)
}

function verbose(message) {
  if (options.verbose) {
    console.log(`[build] [verbose] ${message}`)
  }
}

// Execute command with output
function exec(command, opts = {}) {
  log(`Running: ${command}`)
  try {
    const result = execSync(command, {
      cwd: PROJECT_ROOT,
      stdio: options.verbose ? 'inherit' : 'pipe',
      encoding: 'utf-8',
      env: {
        ...process.env,
        ...opts.env
      }
    })
    return result
  } catch (err) {
    error(`Command failed: ${command}`)
    if (err.stdout) console.log(err.stdout)
    if (err.stderr) console.error(err.stderr)
    throw err
  }
}

// Get platform-specific build command
function getBuildCommand(platform) {
  const base = 'npm run'
  const suffix = options.unsigned ? '' : ''

  switch (platform) {
    case 'mac':
      return `${base} dist:mac`
    case 'win':
      return `${base} dist:win`
    case 'linux':
      return `${base} dist:linux`
    case 'all':
      return `${base} dist:all`
    case 'current':
    default:
      return `${base} dist`
  }
}

// Main build process
async function main() {
  const startTime = Date.now()

  log('Starting build process...')
  log(`Platform: ${options.platform}`)
  log(`Skip Vite: ${options.skipVite}`)
  log(`Skip Icon Check: ${options.skipIconCheck}`)
  log(`Unsigned: ${options.unsigned}`)

  // Step 1: Validate icon files
  if (!options.skipIconCheck) {
    log('Validating icon files...')
    const iconValidation = validateIcons(options.platform)

    // Log warnings
    for (const warning of iconValidation.warnings) {
      log(`WARNING: ${warning}`)
    }

    if (!iconValidation.valid) {
      log(`Missing required icons: ${iconValidation.missing.join(', ')}`)
      log('Attempting to generate fallback icons...')

      if (generateFallbackIcons()) {
        // Re-validate after generating fallback icons
        const revalidation = validateIcons(options.platform)
        if (!revalidation.valid) {
          error(`Still missing required icons after fallback generation: ${revalidation.missing.join(', ')}`)
          error('Please provide the required icon files in resources/icons/')
          error('See resources/icons/README.md for icon generation instructions')
          process.exit(1)
        }
        log('Fallback icons generated successfully')
        log('WARNING: Using placeholder icons - replace with production icons before release')
      } else {
        error(`Missing required icons: ${iconValidation.missing.join(', ')}`)
        error('Please provide the required icon files in resources/icons/')
        error('See resources/icons/README.md for icon generation instructions')
        process.exit(1)
      }
    } else {
      log('Icon validation passed')
    }
  } else {
    log('Skipping icon validation')
  }

  // Step 2: Clean release directory (optional)
  if (fs.existsSync(RELEASE_DIR)) {
    verbose(`Release directory exists: ${RELEASE_DIR}`)
  }

  // Step 3: Build Vite (frontend)
  if (!options.skipVite) {
    log('Building Vite (frontend)...')
    exec('npm run build:vite')
  } else {
    log('Skipping Vite build')
    if (!fs.existsSync(path.join(PROJECT_ROOT, 'dist'))) {
      error('dist/ directory not found. Run without --skip-vite first.')
      process.exit(1)
    }
  }

  // Step 4: Build Electron (main process is built by Vite)
  log('Vite build includes Electron main process')

  // Step 5: Build installers
  log(`Building installers for: ${options.platform}`)

  const buildEnv = {}
  if (options.unsigned) {
    buildEnv.CSC_IDENTITY_AUTO_DISCOVERY = 'false'
  }

  const buildCommand = getBuildCommand(options.platform)
  verbose(`Build command: ${buildCommand}`)

  try {
    // Use electron-builder directly for more control
    let builderArgs = ['electron-builder', '--config', 'electron-builder.config.cjs']

    if (options.platform === 'mac' || options.platform === 'all') {
      if (process.platform === 'darwin' || options.platform === 'all') {
        builderArgs.push('--mac')
      }
    }
    if (options.platform === 'win' || options.platform === 'all') {
      builderArgs.push('--win')
    }
    if (options.platform === 'linux' || options.platform === 'all') {
      builderArgs.push('--linux')
    }
    if (options.platform === 'current') {
      // electron-builder auto-detects current platform
    }

    const command = `npx ${builderArgs.join(' ')}`
    exec(command, { env: buildEnv })
  } catch (err) {
    error('Build failed')
    process.exit(1)
  }

  // Step 6: Report results
  log('Build completed!')
  log(`Time elapsed: ${((Date.now() - startTime) / 1000).toFixed(2)}s`)

  // List artifacts
  if (fs.existsSync(RELEASE_DIR)) {
    log('Artifacts created:')
    const listArtifacts = (dir, indent = '  ') => {
      const items = fs.readdirSync(dir)
      for (const item of items) {
        const itemPath = path.join(dir, item)
        const stats = fs.statSync(itemPath)
        if (stats.isDirectory()) {
          verbose(`${indent}${item}/`)
          listArtifacts(itemPath, indent + '  ')
        } else if (isArtifact(item)) {
          const sizeMB = (stats.size / (1024 * 1024)).toFixed(2)
          log(`${indent}${item} (${sizeMB} MB)`)
        }
      }
    }
    listArtifacts(RELEASE_DIR)
  } else {
    log('No release directory found')
  }
}

function isArtifact(filename) {
  const extensions = ['.dmg', '.zip', '.exe', '.AppImage', '.deb', '.rpm', '.snap']
  return extensions.some(ext => filename.endsWith(ext))
}

// ═══════════════════════════════════════════════════════════════════════════════
// ICON VALIDATION
// ═══════════════════════════════════════════════════════════════════════════════
//
// Validates that required icon files exist before building.
// Missing icons will cause build failures or missing application icons.
//
// Required icons per platform:
//   macOS:   icon.icns
//   Windows: icon.ico
//   Linux:   16x16.png, 32x32.png, 64x64.png, 128x128.png, 256x256.png, 512x512.png
//

const ICON_REQUIREMENTS = {
  mac: {
    required: ['icon.icns'],
    optional: ['icon.png']
  },
  win: {
    required: ['icon.ico'],
    optional: ['icon.png']
  },
  linux: {
    required: ['16x16.png', '32x32.png', '64x64.png', '128x128.png', '256x256.png', '512x512.png'],
    optional: ['icon.png']
  },
  all: {
    required: ['icon.icns', 'icon.ico', '16x16.png', '32x32.png', '64x64.png', '128x128.png', '256x256.png', '512x512.png'],
    optional: ['icon.png']
  }
}

/**
 * Validate icon files exist for the target platform
 * @param {string} platform - Target platform (mac, win, linux, all, current)
 * @returns {{ valid: boolean, missing: string[], warnings: string[] }}
 */
function validateIcons(platform) {
  const result = {
    valid: true,
    missing: [],
    warnings: []
  }

  // Determine which platform requirements to check
  let platformKey = platform
  if (platform === 'current') {
    if (process.platform === 'darwin') platformKey = 'mac'
    else if (process.platform === 'win32') platformKey = 'win'
    else platformKey = 'linux'
  }

  const requirements = ICON_REQUIREMENTS[platformKey] || ICON_REQUIREMENTS.all

  // Check required icons
  for (const iconFile of requirements.required) {
    const iconPath = path.join(ICONS_DIR, iconFile)
    if (!fs.existsSync(iconPath)) {
      result.missing.push(iconFile)
      result.valid = false
    }
  }

  // Check optional icons (warn if missing)
  for (const iconFile of requirements.optional) {
    const iconPath = path.join(ICONS_DIR, iconFile)
    if (!fs.existsSync(iconPath)) {
      result.warnings.push(`Optional icon missing: ${iconFile}`)
    }
  }

  return result
}

/**
 * Generate fallback placeholder icons if missing
 * @returns {boolean} True if fallback icons were generated
 */
function generateFallbackIcons() {
  const generateIconsScript = path.join(PROJECT_ROOT, 'scripts', 'generate-icons.js')

  if (!fs.existsSync(generateIconsScript)) {
    return false
  }

  log('Generating fallback placeholder icons...')
  try {
    exec(`node "${generateIconsScript}"`)
    return true
  } catch (err) {
    error('Failed to generate fallback icons')
    return false
  }
}

// Run
main().catch(err => {
  error(err.message)
  process.exit(1)
})
