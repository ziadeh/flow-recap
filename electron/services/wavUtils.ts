/**
 * WAV File Utilities
 *
 * Provides utility functions for validating and fixing WAV file headers.
 * This is critical for ensuring proper audio playback, as incorrect WAV headers
 * can cause audio looping or incorrect duration reporting.
 *
 * Common issue: During real-time recording, the WAV header may not be updated
 * with the correct data size, causing the browser's audio player to loop
 * at the wrong position.
 */

import * as fs from 'fs'

// ============================================================================
// Types
// ============================================================================

export interface WavFileInfo {
  /** Whether the file is a valid WAV file */
  valid: boolean
  /** Data size according to the WAV header */
  headerDataSize: number
  /** Actual data size (file size - header size) */
  actualDataSize: number
  /** Sample rate in Hz */
  sampleRate: number
  /** Number of channels */
  channels: number
  /** Bits per sample */
  bitDepth: number
  /** Duration in seconds based on actual data size */
  durationSeconds: number
  /** Whether the header needs fixing */
  needsHeaderFix: boolean
  /** Error message if validation failed */
  error?: string
}

// ============================================================================
// Constants
// ============================================================================

/** Standard WAV header size in bytes */
const WAV_HEADER_SIZE = 44

/** Maximum allowed difference between header and actual size (in bytes of audio data) */
const MAX_HEADER_SIZE_DIFFERENCE_BYTES = 1024 // ~32ms at 16kHz mono 16-bit

// ============================================================================
// WAV Validation and Fixing Functions
// ============================================================================

/**
 * Validate a WAV file to ensure the header matches the actual file content.
 * This helps detect issues where the WAV header was not properly updated,
 * which can cause audio processing to only read partial data or loop incorrectly.
 *
 * @param filePath - Path to the WAV file to validate
 * @returns WAV file information including validation status
 */
export function validateWavFile(filePath: string): WavFileInfo {
  const result: WavFileInfo = {
    valid: false,
    headerDataSize: 0,
    actualDataSize: 0,
    sampleRate: 0,
    channels: 0,
    bitDepth: 0,
    durationSeconds: 0,
    needsHeaderFix: false
  }

  try {
    // Check if file exists
    if (!fs.existsSync(filePath)) {
      result.error = `File not found: ${filePath}`
      return result
    }

    // Read the WAV header (first 44 bytes)
    const fd = fs.openSync(filePath, 'r')
    const headerBuffer = Buffer.alloc(WAV_HEADER_SIZE)
    fs.readSync(fd, headerBuffer, 0, WAV_HEADER_SIZE, 0)

    // Get actual file size
    const stats = fs.fstatSync(fd)
    fs.closeSync(fd)

    // Validate minimum file size
    if (stats.size < WAV_HEADER_SIZE) {
      result.error = 'File too small to be a valid WAV file'
      return result
    }

    // Validate RIFF/WAVE header
    const riff = headerBuffer.toString('ascii', 0, 4)
    const wave = headerBuffer.toString('ascii', 8, 12)

    if (riff !== 'RIFF' || wave !== 'WAVE') {
      result.error = 'Invalid WAV file: Missing RIFF/WAVE header'
      return result
    }

    // Parse WAV header fields
    result.channels = headerBuffer.readUInt16LE(22)
    result.sampleRate = headerBuffer.readUInt32LE(24)
    result.bitDepth = headerBuffer.readUInt16LE(34)

    // Data chunk size from header (offset 40)
    result.headerDataSize = headerBuffer.readUInt32LE(40)

    // Actual data size = file size - header size
    result.actualDataSize = stats.size - WAV_HEADER_SIZE

    // Calculate expected duration from actual data size
    const bytesPerSample = result.bitDepth / 8
    const bytesPerSecond = result.sampleRate * result.channels * bytesPerSample

    if (bytesPerSecond > 0) {
      result.durationSeconds = result.actualDataSize / bytesPerSecond
    }

    // Check if header data size matches actual data size
    const sizeDifference = Math.abs(result.headerDataSize - result.actualDataSize)

    // Mark file as valid even with header mismatch (it can be fixed)
    result.valid = true

    if (sizeDifference > MAX_HEADER_SIZE_DIFFERENCE_BYTES) {
      result.needsHeaderFix = true

      const headerDuration = bytesPerSecond > 0 ? result.headerDataSize / bytesPerSecond : 0
      console.warn(`[WavUtils] WAV header mismatch detected in ${filePath}:`)
      console.warn(`  Header data size: ${result.headerDataSize} bytes (${headerDuration.toFixed(2)}s)`)
      console.warn(`  Actual data size: ${result.actualDataSize} bytes (${result.durationSeconds.toFixed(2)}s)`)
      console.warn(`  Difference: ${sizeDifference} bytes (${(sizeDifference / bytesPerSecond).toFixed(2)}s)`)
    }

    return result
  } catch (error) {
    result.error = `Failed to validate WAV file: ${error instanceof Error ? error.message : String(error)}`
    return result
  }
}

/**
 * Fix a WAV file header if it doesn't match the actual file size.
 * This updates the RIFF chunk size and data chunk size to reflect the actual file content.
 *
 * This is critical for proper audio playback - if the header indicates a smaller size
 * than the actual file, browsers/players will loop at the incorrect position.
 *
 * @param filePath - Path to the WAV file to fix
 * @returns True if the header was fixed successfully
 */
export function fixWavFileHeader(filePath: string): boolean {
  try {
    // First validate the file
    if (!fs.existsSync(filePath)) {
      console.error(`[WavUtils] Cannot fix WAV header: File not found: ${filePath}`)
      return false
    }

    const fd = fs.openSync(filePath, 'r+')
    const headerBuffer = Buffer.alloc(WAV_HEADER_SIZE)
    fs.readSync(fd, headerBuffer, 0, WAV_HEADER_SIZE, 0)

    // Validate RIFF/WAVE header before modifying
    const riff = headerBuffer.toString('ascii', 0, 4)
    const wave = headerBuffer.toString('ascii', 8, 12)

    if (riff !== 'RIFF' || wave !== 'WAVE') {
      fs.closeSync(fd)
      console.error(`[WavUtils] Cannot fix WAV header: Invalid RIFF/WAVE header`)
      return false
    }

    // Get actual file size
    const stats = fs.fstatSync(fd)
    const actualDataSize = stats.size - WAV_HEADER_SIZE

    // Check if fix is needed
    const currentHeaderDataSize = headerBuffer.readUInt32LE(40)
    if (currentHeaderDataSize === actualDataSize) {
      fs.closeSync(fd)
      console.log(`[WavUtils] WAV header already correct, no fix needed`)
      return true
    }

    // Update RIFF chunk size (offset 4) = file size - 8
    const riffChunkSize = stats.size - 8
    headerBuffer.writeUInt32LE(riffChunkSize, 4)

    // Update data chunk size (offset 40) = actual data size
    headerBuffer.writeUInt32LE(actualDataSize, 40)

    // Write updated header back to file
    fs.writeSync(fd, headerBuffer, 0, WAV_HEADER_SIZE, 0)
    fs.fdatasyncSync(fd) // Ensure data is flushed to disk
    fs.closeSync(fd)

    // Log the fix with sample rate info for debugging
    const sampleRate = headerBuffer.readUInt16LE(24) || 16000
    const channels = headerBuffer.readUInt16LE(22) || 1
    const bitDepth = headerBuffer.readUInt16LE(34) || 16
    const bytesPerSecond = sampleRate * channels * (bitDepth / 8)
    const duration = bytesPerSecond > 0 ? actualDataSize / bytesPerSecond : 0

    console.log(`[WavUtils] Fixed WAV header for ${filePath}:`)
    console.log(`  Previous data size: ${currentHeaderDataSize} bytes (${(currentHeaderDataSize / bytesPerSecond).toFixed(2)}s)`)
    console.log(`  New data size: ${actualDataSize} bytes (${duration.toFixed(2)}s)`)

    return true
  } catch (error) {
    console.error(`[WavUtils] Failed to fix WAV header: ${error instanceof Error ? error.message : String(error)}`)
    return false
  }
}

/**
 * Ensure a WAV file has a correct header before playback or processing.
 * This validates the file and fixes the header if needed.
 *
 * @param filePath - Path to the WAV file
 * @returns True if the file is ready for use (valid header or was fixed)
 */
export function ensureValidWavHeader(filePath: string): boolean {
  const info = validateWavFile(filePath)

  if (!info.valid) {
    console.error(`[WavUtils] Invalid WAV file: ${info.error}`)
    return false
  }

  if (info.needsHeaderFix) {
    console.log(`[WavUtils] WAV header needs fixing, attempting repair...`)
    return fixWavFileHeader(filePath)
  }

  return true
}

/**
 * Get the duration of a WAV file based on actual file size (not header).
 * This is useful for getting accurate duration even if the header is incorrect.
 *
 * @param filePath - Path to the WAV file
 * @returns Duration in seconds, or 0 if the file is invalid
 */
export function getWavDuration(filePath: string): number {
  const info = validateWavFile(filePath)
  return info.valid ? info.durationSeconds : 0
}
