#!/usr/bin/env node
/**
 * Download Audio Processing Binaries Script
 *
 * Downloads platform-specific sox and ffmpeg binaries for bundling with the application.
 * Run with: npm run download-binaries [--platform=<platform>] [--arch=<arch>] [--sox-only] [--ffmpeg-only]
 *
 * This script is intended for development and build pipeline use.
 * In production, the application uses the binaryManager service to locate binaries.
 */

const fs = require('fs')
const path = require('path')
const https = require('https')
const http = require('http')
const { execSync, spawn } = require('child_process')
const crypto = require('crypto')
const os = require('os')

// Configuration
const RESOURCES_DIR = path.join(__dirname, '..', 'resources', 'binaries')
const CHECKSUMS_FILE = path.join(RESOURCES_DIR, 'checksums.json')

// Binary download URLs
// Note: These URLs may need to be updated periodically as new versions are released
const BINARY_SOURCES = {
  // macOS - evermeet.cx provides static builds
  darwin: {
    arm64: {
      sox: {
        // Sox needs to be compiled from source for ARM64 or use Homebrew
        // We'll use a placeholder and provide instructions
        url: null,
        instructions: 'Install via Homebrew: brew install sox',
        fallback: 'homebrew'
      },
      ffmpeg: {
        url: 'https://evermeet.cx/ffmpeg/getrelease/ffmpeg/zip',
        type: 'zip',
        extractPath: 'ffmpeg'
      },
      ffprobe: {
        url: 'https://evermeet.cx/ffmpeg/getrelease/ffprobe/zip',
        type: 'zip',
        extractPath: 'ffprobe'
      }
    },
    x64: {
      sox: {
        url: null,
        instructions: 'Install via Homebrew: brew install sox',
        fallback: 'homebrew'
      },
      ffmpeg: {
        url: 'https://evermeet.cx/ffmpeg/getrelease/ffmpeg/zip',
        type: 'zip',
        extractPath: 'ffmpeg'
      },
      ffprobe: {
        url: 'https://evermeet.cx/ffmpeg/getrelease/ffprobe/zip',
        type: 'zip',
        extractPath: 'ffprobe'
      }
    }
  },
  // Windows - gyan.dev provides static builds
  win32: {
    x64: {
      sox: {
        url: 'https://sourceforge.net/projects/sox/files/sox/14.4.2/sox-14.4.2-win32.zip/download',
        type: 'zip',
        extractPath: 'sox-14.4.2/sox.exe',
        additionalFiles: ['sox-14.4.2/libflac-8.dll', 'sox-14.4.2/libid3tag-0.dll', 'sox-14.4.2/libmad-0.dll', 'sox-14.4.2/libmp3lame-0.dll', 'sox-14.4.2/libogg-0.dll', 'sox-14.4.2/libpng16-16.dll', 'sox-14.4.2/libsox-3.dll', 'sox-14.4.2/libsoxconvolver.dll', 'sox-14.4.2/libsoxr.dll', 'sox-14.4.2/libvorbis-0.dll', 'sox-14.4.2/libvorbisenc-2.dll', 'sox-14.4.2/libvorbisfile-3.dll', 'sox-14.4.2/libwavpack-1.dll', 'sox-14.4.2/zlib1.dll']
      },
      ffmpeg: {
        // Using essentials build to reduce size
        url: 'https://www.gyan.dev/ffmpeg/builds/ffmpeg-release-essentials.zip',
        type: 'zip',
        extractPattern: /ffmpeg-[\d.]+-essentials_build\/bin\/ffmpeg\.exe$/,
        outputName: 'ffmpeg.exe'
      },
      ffprobe: {
        // Same package as ffmpeg
        url: 'https://www.gyan.dev/ffmpeg/builds/ffmpeg-release-essentials.zip',
        type: 'zip',
        extractPattern: /ffmpeg-[\d.]+-essentials_build\/bin\/ffprobe\.exe$/,
        outputName: 'ffprobe.exe'
      }
    }
  },
  // Linux - johnvansickle.com provides static builds
  linux: {
    x64: {
      sox: {
        url: null,
        instructions: 'Install via package manager: sudo apt install sox',
        fallback: 'package-manager'
      },
      ffmpeg: {
        url: 'https://johnvansickle.com/ffmpeg/releases/ffmpeg-release-amd64-static.tar.xz',
        type: 'tar.xz',
        extractPattern: /ffmpeg-[\d.]+-amd64-static\/ffmpeg$/,
        outputName: 'ffmpeg'
      },
      ffprobe: {
        url: 'https://johnvansickle.com/ffmpeg/releases/ffmpeg-release-amd64-static.tar.xz',
        type: 'tar.xz',
        extractPattern: /ffmpeg-[\d.]+-amd64-static\/ffprobe$/,
        outputName: 'ffprobe'
      }
    }
  }
}

// Utility functions
function log(message) {
  console.log(`[download-binaries] ${message}`)
}

function error(message) {
  console.error(`[download-binaries] ERROR: ${message}`)
}

function ensureDir(dir) {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true })
  }
}

function downloadFile(url, destPath) {
  return new Promise((resolve, reject) => {
    log(`Downloading: ${url}`)

    const protocol = url.startsWith('https') ? https : http
    const file = fs.createWriteStream(destPath)

    const request = protocol.get(url, {
      headers: {
        'User-Agent': 'Meeting-Notes-Binary-Downloader/1.0'
      }
    }, (response) => {
      // Handle redirects
      if (response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
        file.close()
        fs.unlinkSync(destPath)
        log(`Following redirect to: ${response.headers.location}`)
        return downloadFile(response.headers.location, destPath).then(resolve).catch(reject)
      }

      if (response.statusCode !== 200) {
        file.close()
        fs.unlinkSync(destPath)
        reject(new Error(`HTTP ${response.statusCode}: Failed to download ${url}`))
        return
      }

      const totalSize = parseInt(response.headers['content-length'], 10) || 0
      let downloadedSize = 0

      response.on('data', (chunk) => {
        downloadedSize += chunk.length
        if (totalSize > 0) {
          const percent = Math.round((downloadedSize / totalSize) * 100)
          process.stdout.write(`\r[download-binaries] Progress: ${percent}%`)
        }
      })

      response.pipe(file)

      file.on('finish', () => {
        file.close()
        console.log('') // New line after progress
        log(`Downloaded to: ${destPath}`)
        resolve(destPath)
      })
    })

    request.on('error', (err) => {
      file.close()
      if (fs.existsSync(destPath)) {
        fs.unlinkSync(destPath)
      }
      reject(err)
    })
  })
}

function calculateSHA256(filePath) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha256')
    const stream = fs.createReadStream(filePath)

    stream.on('data', (data) => hash.update(data))
    stream.on('end', () => resolve(hash.digest('hex')))
    stream.on('error', (err) => reject(err))
  })
}

function extractZip(zipPath, destDir, extractPath) {
  return new Promise((resolve, reject) => {
    try {
      // Use unzip command (available on most systems)
      const extractCmd = process.platform === 'win32'
        ? `powershell -command "Expand-Archive -Path '${zipPath}' -DestinationPath '${destDir}' -Force"`
        : `unzip -o "${zipPath}" -d "${destDir}"`

      execSync(extractCmd, { stdio: 'pipe' })

      // Move extracted file to correct location if needed
      if (extractPath) {
        const extractedPath = path.join(destDir, extractPath)
        if (fs.existsSync(extractedPath)) {
          const finalPath = path.join(destDir, path.basename(extractPath))
          if (extractedPath !== finalPath) {
            fs.renameSync(extractedPath, finalPath)
          }
          resolve(finalPath)
        } else {
          reject(new Error(`Extracted file not found: ${extractedPath}`))
        }
      } else {
        resolve(destDir)
      }
    } catch (err) {
      reject(err)
    }
  })
}

function extractTarXz(tarPath, destDir, extractPattern, outputName) {
  return new Promise((resolve, reject) => {
    try {
      // Use tar command
      execSync(`tar -xf "${tarPath}" -C "${destDir}"`, { stdio: 'pipe' })

      // Find extracted file matching pattern
      if (extractPattern && outputName) {
        const files = execSync(`find "${destDir}" -type f`, { encoding: 'utf-8' })
        const matchingFile = files.split('\n').find(f => extractPattern.test(f))

        if (matchingFile) {
          const finalPath = path.join(destDir, outputName)
          fs.renameSync(matchingFile.trim(), finalPath)
          resolve(finalPath)
        } else {
          reject(new Error(`No file matching pattern found in archive`))
        }
      } else {
        resolve(destDir)
      }
    } catch (err) {
      reject(err)
    }
  })
}

async function copyFromHomebrew(binary, destDir) {
  try {
    const brewPath = execSync(`which ${binary}`, { encoding: 'utf-8' }).trim()
    if (brewPath && fs.existsSync(brewPath)) {
      const destPath = path.join(destDir, binary)
      fs.copyFileSync(brewPath, destPath)
      fs.chmodSync(destPath, 0o755)
      log(`Copied ${binary} from Homebrew: ${brewPath}`)
      return destPath
    }
  } catch (err) {
    log(`${binary} not found in Homebrew. Install with: brew install ${binary}`)
  }
  return null
}

async function downloadBinary(platform, arch, binary, destDir) {
  const source = BINARY_SOURCES[platform]?.[arch]?.[binary]

  if (!source) {
    log(`No download source configured for ${binary} on ${platform}/${arch}`)
    return null
  }

  // Handle Homebrew fallback (macOS)
  if (source.fallback === 'homebrew' && platform === 'darwin') {
    return await copyFromHomebrew(binary, destDir)
  }

  // Handle package manager fallback (Linux)
  if (source.fallback === 'package-manager') {
    log(`${binary} should be installed via package manager: ${source.instructions}`)
    return null
  }

  if (!source.url) {
    log(`No download URL for ${binary}. ${source.instructions || ''}`)
    return null
  }

  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'binary-download-'))

  try {
    // Download archive
    const ext = source.type === 'zip' ? '.zip' : '.tar.xz'
    const archivePath = path.join(tempDir, `${binary}${ext}`)
    await downloadFile(source.url, archivePath)

    // Extract
    let extractedPath
    if (source.type === 'zip') {
      extractedPath = await extractZip(archivePath, tempDir, source.extractPath)
    } else if (source.type === 'tar.xz') {
      extractedPath = await extractTarXz(archivePath, tempDir, source.extractPattern, source.outputName)
    }

    // Copy to destination
    if (extractedPath && fs.existsSync(extractedPath)) {
      const outputName = source.outputName || path.basename(extractedPath)
      const destPath = path.join(destDir, outputName)
      fs.copyFileSync(extractedPath, destPath)

      // Set executable permissions
      if (platform !== 'win32') {
        fs.chmodSync(destPath, 0o755)
      }

      // Copy additional files (Windows sox DLLs)
      if (source.additionalFiles) {
        for (const additionalFile of source.additionalFiles) {
          const srcPath = path.join(tempDir, additionalFile)
          if (fs.existsSync(srcPath)) {
            const destFile = path.join(destDir, path.basename(additionalFile))
            fs.copyFileSync(srcPath, destFile)
          }
        }
      }

      log(`Installed ${binary} to: ${destPath}`)
      return destPath
    }
  } finally {
    // Cleanup temp directory
    try {
      fs.rmSync(tempDir, { recursive: true, force: true })
    } catch (err) {
      // Ignore cleanup errors
    }
  }

  return null
}

async function updateChecksums(platform, arch, binary, filePath) {
  if (!fs.existsSync(filePath)) return

  const sha256 = await calculateSHA256(filePath)
  log(`SHA256 for ${binary}: ${sha256}`)

  // Update checksums.json
  if (fs.existsSync(CHECKSUMS_FILE)) {
    const checksums = JSON.parse(fs.readFileSync(CHECKSUMS_FILE, 'utf-8'))
    const platformKey = platform === 'darwin' ? 'macos' : platform === 'win32' ? 'windows' : platform

    if (checksums.checksums[platformKey]?.[arch]?.[binary]) {
      checksums.checksums[platformKey][arch][binary].sha256 = sha256
      checksums.generated = new Date().toISOString()
      fs.writeFileSync(CHECKSUMS_FILE, JSON.stringify(checksums, null, 2))
      log(`Updated checksums.json for ${binary}`)
    }
  }
}

async function main() {
  const args = process.argv.slice(2)

  // Parse arguments
  let targetPlatform = process.platform
  let targetArch = process.arch
  let soxOnly = false
  let ffmpegOnly = false

  for (const arg of args) {
    if (arg.startsWith('--platform=')) {
      targetPlatform = arg.split('=')[1]
    } else if (arg.startsWith('--arch=')) {
      targetArch = arg.split('=')[1]
    } else if (arg === '--sox-only') {
      soxOnly = true
    } else if (arg === '--ffmpeg-only') {
      ffmpegOnly = true
    } else if (arg === '--help') {
      console.log(`
Usage: node download-binaries.js [options]

Options:
  --platform=<platform>  Target platform (darwin, win32, linux)
  --arch=<arch>          Target architecture (arm64, x64)
  --sox-only             Download only sox
  --ffmpeg-only          Download only ffmpeg/ffprobe
  --help                 Show this help message

Examples:
  node download-binaries.js                          # Download for current platform
  node download-binaries.js --platform=darwin --arch=arm64
  node download-binaries.js --sox-only
`)
      process.exit(0)
    }
  }

  // Normalize arch
  if (targetArch === 'x86_64') targetArch = 'x64'

  log(`Target: ${targetPlatform}/${targetArch}`)

  // Determine destination directory
  const platformDir = targetPlatform === 'darwin' ? 'macos' : targetPlatform === 'win32' ? 'windows' : targetPlatform
  const destDir = path.join(RESOURCES_DIR, platformDir, targetArch)
  ensureDir(destDir)

  log(`Destination: ${destDir}`)

  // Determine which binaries to download
  const binaries = []
  if (!ffmpegOnly) binaries.push('sox')
  if (!soxOnly) {
    binaries.push('ffmpeg')
    binaries.push('ffprobe')
  }

  // Download binaries
  for (const binary of binaries) {
    try {
      log(`Processing ${binary}...`)
      const installedPath = await downloadBinary(targetPlatform, targetArch, binary, destDir)

      if (installedPath) {
        await updateChecksums(targetPlatform, targetArch, binary, installedPath)
      }
    } catch (err) {
      error(`Failed to download ${binary}: ${err.message}`)
    }
  }

  log('Done!')
}

main().catch(err => {
  error(err.message)
  process.exit(1)
})
