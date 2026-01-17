#!/usr/bin/env node
/**
 * Python Bundle Build Script
 *
 * This script bundles the Python transcription pipeline into a standalone
 * executable using PyInstaller. The bundle includes:
 * - Python interpreter and standard library
 * - All required ML dependencies (WhisperX, pyannote, PyTorch, etc.)
 * - Python transcription scripts
 * - Optional: Pre-trained ML models
 *
 * The bundled Python eliminates the need for users to manually set up Python.
 * ML models are downloaded on first use and cached in the user's home directory.
 *
 * Usage:
 *   node scripts/bundle-python.js [options]
 *
 * Options:
 *   --platform <platform>   Target platform (darwin, win32, linux) - defaults to current
 *   --arch <arch>          Target architecture (x64, arm64) - defaults to current
 *   --include-models       Include pre-trained models in bundle (increases size significantly)
 *   --clean                Clean previous build artifacts before building
 *   --verify               Verify the bundle after building
 *   --skip-deps            Skip dependency installation check
 *   --help                 Show help message
 *
 * Environment Variables:
 *   PYTHON_PATH            Path to Python executable to use
 *   PYINSTALLER_PATH       Path to PyInstaller executable
 *   HF_TOKEN               HuggingFace token for model downloads
 *
 * Supported Platforms:
 *   - macOS Intel (darwin x64)
 *   - macOS Apple Silicon (darwin arm64)
 *   - Windows x64 (win32 x64)
 *   - Linux x64 (linux x64)
 *
 * Example:
 *   # Build for current platform
 *   npm run bundle:python
 *
 *   # Build with model download verification
 *   npm run bundle:python -- --verify
 *
 *   # Clean build
 *   npm run bundle:python -- --clean --verify
 */

const { spawn, execSync, spawnSync } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');

// ============================================================================
// Configuration
// ============================================================================

const PROJECT_ROOT = path.resolve(__dirname, '..');
const PYTHON_DIR = path.join(PROJECT_ROOT, 'python');
const RESOURCES_DIR = path.join(PROJECT_ROOT, 'resources');
const BUNDLE_OUTPUT_DIR = path.join(PYTHON_DIR, 'dist', 'transcription_bundle');
const SPEC_FILE = path.join(PYTHON_DIR, 'transcription_bundle.spec');

// Default settings
const config = {
  platform: process.platform,
  arch: process.arch,
  includeModels: false,
  clean: false,
  verify: false,
  verbose: false,
  skipDeps: false,
};

// Platform support matrix
const SUPPORTED_PLATFORMS = {
  darwin: ['x64', 'arm64'],
  win32: ['x64'],
  linux: ['x64'],
};

// ============================================================================
// Argument Parsing
// ============================================================================

function parseArgs() {
  const args = process.argv.slice(2);

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];

    switch (arg) {
      case '--platform':
        config.platform = args[++i];
        break;
      case '--arch':
        config.arch = args[++i];
        break;
      case '--include-models':
        config.includeModels = true;
        break;
      case '--clean':
        config.clean = true;
        break;
      case '--verify':
        config.verify = true;
        break;
      case '--verbose':
      case '-v':
        config.verbose = true;
        break;
      case '--skip-deps':
        config.skipDeps = true;
        break;
      case '--help':
      case '-h':
        printHelp();
        process.exit(0);
      default:
        if (arg.startsWith('-')) {
          console.error(`Unknown option: ${arg}`);
          process.exit(1);
        }
    }
  }
}

function printHelp() {
  console.log(`
Python Bundle Build Script

Bundles the Python transcription pipeline into a standalone executable.
This eliminates the need for users to manually set up Python and ML dependencies.

Usage:
  node scripts/bundle-python.js [options]

Options:
  --platform <platform>   Target platform (darwin, win32, linux)
                          Defaults to current platform: ${process.platform}
  --arch <arch>          Target architecture (x64, arm64)
                          Defaults to current architecture: ${process.arch}
  --include-models       Include pre-trained ML models in the bundle
                          Warning: This significantly increases bundle size (~5GB)
  --clean                Clean previous build artifacts before building
  --verify               Verify the bundle works after building
  --skip-deps            Skip Python dependency check
  --verbose, -v          Show detailed output
  --help, -h             Show this help message

Supported Platforms:
  - macOS Intel (darwin x64)
  - macOS Apple Silicon (darwin arm64)
  - Windows x64 (win32 x64)
  - Linux x64 (linux x64)

Bundle Contents:
  - Python interpreter and standard library
  - WhisperX (speech recognition)
  - faster-whisper (fallback transcription)
  - pyannote.audio (speaker diarization)
  - PyTorch and torchaudio
  - All required dependencies

Note: ML models are NOT included by default. They are downloaded on first
use and cached in the user's home directory (~/.cache/huggingface).

Examples:
  # Build for current platform
  node scripts/bundle-python.js

  # Build with models included (large bundle ~5GB)
  node scripts/bundle-python.js --include-models

  # Clean build with verification
  node scripts/bundle-python.js --clean --verify

  # Verbose build
  node scripts/bundle-python.js --verbose
`);
}

// ============================================================================
// Utility Functions
// ============================================================================

function log(message, level = 'info') {
  const prefix = {
    info: '\x1b[36m[INFO]\x1b[0m',
    success: '\x1b[32m[SUCCESS]\x1b[0m',
    warning: '\x1b[33m[WARNING]\x1b[0m',
    error: '\x1b[31m[ERROR]\x1b[0m',
    debug: '\x1b[90m[DEBUG]\x1b[0m',
  };

  if (level === 'debug' && !config.verbose) return;

  console.log(`${prefix[level] || prefix.info} ${message}`);
}

function runCommand(command, args, options = {}) {
  const { cwd = PROJECT_ROOT, silent = false, env = {} } = options;

  log(`Running: ${command} ${args.join(' ')}`, 'debug');

  const result = spawnSync(command, args, {
    cwd,
    stdio: silent ? 'pipe' : 'inherit',
    env: { ...process.env, ...env },
    shell: false,
  });

  if (result.status !== 0) {
    const errorMsg = result.stderr ? result.stderr.toString() : `Command failed with status ${result.status}`;
    throw new Error(errorMsg);
  }

  return result.stdout ? result.stdout.toString() : '';
}

function findPython() {
  // Check environment variable first
  if (process.env.PYTHON_PATH && fs.existsSync(process.env.PYTHON_PATH)) {
    return process.env.PYTHON_PATH;
  }

  // Check virtual environments
  const venvDirs = ['venv-3.12', 'venv'];
  for (const venvName of venvDirs) {
    const venvPath = path.join(PYTHON_DIR, venvName);
    const pythonPath = process.platform === 'win32'
      ? path.join(venvPath, 'Scripts', 'python.exe')
      : path.join(venvPath, 'bin', 'python');

    if (fs.existsSync(pythonPath)) {
      return pythonPath;
    }
  }

  // Try system Python
  try {
    const pythonPath = execSync('which python3 2>/dev/null || which python 2>/dev/null', {
      encoding: 'utf8',
    }).trim();
    if (pythonPath) return pythonPath;
  } catch {
    // Ignore
  }

  // Default fallback
  return process.platform === 'win32' ? 'python' : 'python3';
}

function findPyInstaller(pythonPath) {
  // Check environment variable
  if (process.env.PYINSTALLER_PATH && fs.existsSync(process.env.PYINSTALLER_PATH)) {
    return process.env.PYINSTALLER_PATH;
  }

  // Check if pyinstaller is in the same venv as Python
  const pythonDir = path.dirname(pythonPath);
  const pyinstallerPath = process.platform === 'win32'
    ? path.join(pythonDir, 'pyinstaller.exe')
    : path.join(pythonDir, 'pyinstaller');

  if (fs.existsSync(pyinstallerPath)) {
    return pyinstallerPath;
  }

  // Try running as Python module
  return null; // Will use `python -m PyInstaller`
}

function ensurePyInstaller(pythonPath) {
  log('Checking PyInstaller installation...');

  try {
    runCommand(pythonPath, ['-m', 'PyInstaller', '--version'], { silent: true });
    log('PyInstaller is installed', 'success');
    return true;
  } catch {
    log('PyInstaller not found, installing...', 'warning');
    runCommand(pythonPath, ['-m', 'pip', 'install', 'pyinstaller']);
    log('PyInstaller installed', 'success');
    return true;
  }
}

function cleanBuildArtifacts() {
  log('Cleaning previous build artifacts...');

  const dirsToClean = [
    path.join(PYTHON_DIR, 'dist'),
    path.join(PYTHON_DIR, 'build'),
    path.join(PYTHON_DIR, '__pycache__'),
  ];

  const filesToClean = [
    path.join(PYTHON_DIR, '_bundle_entry.py'),
  ];

  for (const dir of dirsToClean) {
    if (fs.existsSync(dir)) {
      fs.rmSync(dir, { recursive: true, force: true });
      log(`Removed: ${dir}`, 'debug');
    }
  }

  for (const file of filesToClean) {
    if (fs.existsSync(file)) {
      fs.unlinkSync(file);
      log(`Removed: ${file}`, 'debug');
    }
  }

  log('Build artifacts cleaned', 'success');
}

function checkPlatformSupport() {
  const platform = config.platform;
  const arch = config.arch;

  if (!SUPPORTED_PLATFORMS[platform]) {
    throw new Error(`Platform '${platform}' is not supported. Supported platforms: ${Object.keys(SUPPORTED_PLATFORMS).join(', ')}`);
  }

  if (!SUPPORTED_PLATFORMS[platform].includes(arch)) {
    throw new Error(`Architecture '${arch}' is not supported for platform '${platform}'. Supported architectures: ${SUPPORTED_PLATFORMS[platform].join(', ')}`);
  }

  // Check for cross-compilation (which requires special setup)
  if (platform !== process.platform) {
    log(`Cross-compilation detected: building for ${platform} on ${process.platform}`, 'warning');
    log('Cross-compilation requires a Python environment for the target platform', 'warning');
  }

  if (arch !== process.arch) {
    log(`Cross-architecture build detected: building for ${arch} on ${process.arch}`, 'warning');
    if (platform === 'darwin' && process.platform === 'darwin') {
      log('On macOS, you may need to use a Rosetta-translated Python for x64 builds on ARM64', 'warning');
    }
  }

  return true;
}

function checkPythonDependencies(pythonPath) {
  if (config.skipDeps) {
    log('Skipping dependency check (--skip-deps)', 'warning');
    return;
  }

  log('Checking Python dependencies...');

  const requiredModules = [
    'torch',
    'torchaudio',
    'whisperx',
    'faster_whisper',
    'pyannote.audio',
    'omegaconf',
    'huggingface_hub',
  ];

  const missingModules = [];

  for (const module of requiredModules) {
    try {
      runCommand(pythonPath, ['-c', `import ${module.split('.')[0]}`], { silent: true });
      log(`  ✓ ${module}`, 'debug');
    } catch {
      missingModules.push(module);
      log(`  ✗ ${module}`, 'debug');
    }
  }

  if (missingModules.length > 0) {
    log(`Missing Python dependencies: ${missingModules.join(', ')}`, 'warning');
    log('Consider running: pip install -r python/requirements.txt', 'warning');
  } else {
    log('All required Python dependencies are installed', 'success');
  }
}

// ============================================================================
// Build Functions
// ============================================================================

function buildPythonBundle(pythonPath) {
  log(`Building Python bundle for ${config.platform}-${config.arch}...`);

  // Ensure spec file exists
  if (!fs.existsSync(SPEC_FILE)) {
    throw new Error(`Spec file not found: ${SPEC_FILE}`);
  }

  // Build PyInstaller arguments
  const args = [
    '-m', 'PyInstaller',
    '--noconfirm',
    '--clean',
    SPEC_FILE,
  ];

  // Add work and dist paths
  args.push('--workpath', path.join(PYTHON_DIR, 'build'));
  args.push('--distpath', path.join(PYTHON_DIR, 'dist'));

  // Run PyInstaller
  log('Running PyInstaller (this may take several minutes)...');
  runCommand(pythonPath, args, { cwd: PYTHON_DIR });

  // Verify output
  if (!fs.existsSync(BUNDLE_OUTPUT_DIR)) {
    throw new Error('Bundle output directory not created');
  }

  const bundleExe = process.platform === 'win32'
    ? path.join(BUNDLE_OUTPUT_DIR, 'transcription_bundle.exe')
    : path.join(BUNDLE_OUTPUT_DIR, 'transcription_bundle');

  if (!fs.existsSync(bundleExe)) {
    throw new Error('Bundle executable not created');
  }

  // Get bundle size
  const bundleSize = getBundleSize(BUNDLE_OUTPUT_DIR);
  log(`Bundle created: ${BUNDLE_OUTPUT_DIR}`, 'success');
  log(`Bundle size: ${formatSize(bundleSize)}`);

  return BUNDLE_OUTPUT_DIR;
}

function getBundleSize(dirPath) {
  let totalSize = 0;

  function walkDir(dir) {
    const files = fs.readdirSync(dir);
    for (const file of files) {
      const filePath = path.join(dir, file);
      const stat = fs.statSync(filePath);
      if (stat.isDirectory()) {
        walkDir(filePath);
      } else {
        totalSize += stat.size;
      }
    }
  }

  walkDir(dirPath);
  return totalSize;
}

function formatSize(bytes) {
  const units = ['B', 'KB', 'MB', 'GB'];
  let size = bytes;
  let unitIndex = 0;

  while (size >= 1024 && unitIndex < units.length - 1) {
    size /= 1024;
    unitIndex++;
  }

  return `${size.toFixed(2)} ${units[unitIndex]}`;
}

function copyBundleToResources(bundlePath) {
  log('Copying bundle to resources directory...');

  const targetDir = path.join(RESOURCES_DIR, 'python-bundle');

  // Create target directory
  if (fs.existsSync(targetDir)) {
    fs.rmSync(targetDir, { recursive: true, force: true });
  }
  fs.mkdirSync(targetDir, { recursive: true });

  // Copy bundle
  copyDirRecursive(bundlePath, targetDir);

  log(`Bundle copied to: ${targetDir}`, 'success');
  return targetDir;
}

function copyDirRecursive(src, dest) {
  const entries = fs.readdirSync(src, { withFileTypes: true });

  for (const entry of entries) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);

    if (entry.isSymbolicLink()) {
      // Handle symbolic links
      try {
        const linkTarget = fs.readlinkSync(srcPath);

        // Check if symlink target exists (handle relative paths)
        const targetPath = path.isAbsolute(linkTarget)
          ? linkTarget
          : path.join(path.dirname(srcPath), linkTarget);

        if (fs.existsSync(targetPath)) {
          // Valid symlink - preserve it
          fs.symlinkSync(linkTarget, destPath);
        } else {
          // Broken symlink - skip it with a warning
          log(`Skipping broken symlink: ${srcPath} -> ${linkTarget}`, 'warning');
        }
      } catch (error) {
        log(`Failed to copy symlink ${srcPath}: ${error.message}`, 'warning');
      }
    } else if (entry.isDirectory()) {
      fs.mkdirSync(destPath, { recursive: true });
      copyDirRecursive(srcPath, destPath);
    } else {
      fs.copyFileSync(srcPath, destPath);
    }
  }
}

function verifyBundle(bundlePath) {
  log('Verifying bundle...');

  const bundleExe = process.platform === 'win32'
    ? path.join(bundlePath, 'transcription_bundle.exe')
    : path.join(bundlePath, 'transcription_bundle');

  // Test help command
  try {
    const output = runCommand(bundleExe, [], { silent: true });
    if (output.includes('Transcription Pipeline') || output.includes('Usage:')) {
      log('Bundle verification: Help command works', 'success');
    }
  } catch (error) {
    log('Bundle verification: Help command failed', 'error');
    throw error;
  }

  // Test check command
  try {
    const output = runCommand(bundleExe, ['check'], { silent: true });
    log('Bundle verification: Check command works', 'success');
  } catch (error) {
    log('Bundle verification: Check command failed (may be expected)', 'warning');
  }

  log('Bundle verification complete', 'success');
}

// ============================================================================
// Main
// ============================================================================

async function main() {
  console.log('\n========================================');
  console.log('  Meeting Notes - Python Bundle Builder');
  console.log('========================================\n');

  parseArgs();

  log(`Platform: ${config.platform}`);
  log(`Architecture: ${config.arch}`);
  log(`Include models: ${config.includeModels}`);

  try {
    // Check platform support
    checkPlatformSupport();

    // Find Python
    const pythonPath = findPython();
    log(`Using Python: ${pythonPath}`);

    // Check Python version
    try {
      const version = spawnSync(pythonPath, ['--version'], {
        encoding: 'utf8',
        stdio: 'pipe'
      });
      if (version.status === 0) {
        const versionStr = (version.stdout || version.stderr || '').trim();
        log(`Python version: ${versionStr}`);
      } else {
        throw new Error('Failed to get Python version');
      }
    } catch (error) {
      throw new Error(`Python not found or not working: ${error.message}`);
    }

    // Clean if requested
    if (config.clean) {
      cleanBuildArtifacts();
    }

    // Check Python dependencies
    checkPythonDependencies(pythonPath);

    // Ensure PyInstaller is installed
    ensurePyInstaller(pythonPath);

    // Build the bundle
    const bundlePath = buildPythonBundle(pythonPath);

    // Copy to resources
    const resourcePath = copyBundleToResources(bundlePath);

    // Verify if requested
    if (config.verify) {
      verifyBundle(bundlePath);
    }

    console.log('\n========================================');
    log('Build completed successfully!', 'success');
    console.log('========================================\n');

    log(`Bundle location: ${bundlePath}`);
    log(`Resources location: ${resourcePath}`);
    log('\nNext steps:');
    log('1. Run `npm run dist` to build the Electron app');
    log('2. The Python bundle will be included in the app');

  } catch (error) {
    console.error('\n========================================');
    log(`Build failed: ${error.message}`, 'error');
    console.error('========================================\n');

    if (config.verbose) {
      console.error(error.stack);
    }

    process.exit(1);
  }
}

main();
