/**
 * Real-Time WAV Writer
 *
 * A WAV file writer optimized for real-time recording that:
 * - Writes audio data incrementally to disk as chunks arrive
 * - Flushes data after each write to make it immediately accessible
 * - Updates the WAV header in real-time so the file remains valid
 * - Allows transcription services to read from the file during recording
 *
 * This solves the issue where standard WAV writers buffer data internally
 * and only write to disk when the file is finalized, preventing real-time
 * transcription from accessing the audio data.
 *
 * Technical approach:
 * - Writes a placeholder WAV header at file creation
 * - Appends audio data directly to disk with fdatasync after each write
 * - Periodically updates the WAV header to reflect current file size
 * - Finalizes the header when recording stops
 */

import * as fs from 'fs'
import * as path from 'path'

// ============================================================================
// Types
// ============================================================================

export interface RealTimeWavWriterConfig {
  /** Output file path */
  filePath: string
  /** Sample rate in Hz */
  sampleRate: number
  /** Number of channels (1=mono, 2=stereo) */
  channels: number
  /** Bits per sample (8, 16, 24, 32) */
  bitDepth: number
  /** How often to update the WAV header (in bytes written). Default: 32KB */
  headerUpdateInterval?: number
}

export interface RealTimeWavWriterState {
  /** Whether the writer is currently open */
  isOpen: boolean
  /** Total bytes written to the file (audio data only, excluding header) */
  bytesWritten: number
  /** Total samples written */
  samplesWritten: number
  /** Last time the header was updated */
  lastHeaderUpdateTime: number
  /** File path being written to */
  filePath: string | null
  /** Any error that occurred */
  error?: string
}

// ============================================================================
// Constants
// ============================================================================

/** WAV header size in bytes */
const WAV_HEADER_SIZE = 44

/** Default interval for header updates (32KB = ~1 second at 16kHz mono 16-bit) */
const DEFAULT_HEADER_UPDATE_INTERVAL = 32768

/** Minimum interval between header updates to avoid excessive disk writes (ms) */
const MIN_HEADER_UPDATE_INTERVAL_MS = 500

// ============================================================================
// RealTimeWavWriter Class
// ============================================================================

/**
 * Real-time WAV file writer that flushes data immediately for live transcription
 */
export class RealTimeWavWriter {
  private config: Required<RealTimeWavWriterConfig>
  private fd: number | null = null
  private state: RealTimeWavWriterState
  private bytesSinceLastHeaderUpdate: number = 0
  private lastHeaderUpdateTime: number = 0
  private writeQueue: Promise<void> = Promise.resolve()
  private isWriting: boolean = false

  constructor(config: RealTimeWavWriterConfig) {
    this.config = {
      filePath: config.filePath,
      sampleRate: config.sampleRate,
      channels: config.channels,
      bitDepth: config.bitDepth,
      headerUpdateInterval: config.headerUpdateInterval ?? DEFAULT_HEADER_UPDATE_INTERVAL,
    }

    this.state = {
      isOpen: false,
      bytesWritten: 0,
      samplesWritten: 0,
      lastHeaderUpdateTime: 0,
      filePath: null,
    }
  }

  /**
   * Open the WAV file for writing
   * Creates the file and writes the initial WAV header
   */
  async open(): Promise<void> {
    if (this.state.isOpen) {
      throw new Error('WAV writer is already open')
    }

    try {
      // Ensure directory exists
      const dir = path.dirname(this.config.filePath)
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true })
      }

      // Open file for writing (create or truncate)
      this.fd = fs.openSync(this.config.filePath, 'w')

      // Write initial WAV header with zero data size
      const header = this.createWavHeader(0)
      fs.writeSync(this.fd, header)
      fs.fdatasyncSync(this.fd)

      this.state = {
        isOpen: true,
        bytesWritten: 0,
        samplesWritten: 0,
        lastHeaderUpdateTime: Date.now(),
        filePath: this.config.filePath,
      }

      this.lastHeaderUpdateTime = Date.now()

      console.log(`[RealTimeWavWriter] Opened file: ${this.config.filePath}`)
      console.log(`[RealTimeWavWriter] Format: ${this.config.sampleRate}Hz, ${this.config.channels}ch, ${this.config.bitDepth}-bit`)
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error)
      this.state.error = errorMessage
      throw new Error(`Failed to open WAV file: ${errorMessage}`)
    }
  }

  /**
   * Write audio data to the file
   * Data is written immediately and flushed to disk
   *
   * @param data - Raw PCM audio data (must match configured format)
   */
  async write(data: Buffer): Promise<void> {
    if (!this.state.isOpen || this.fd === null) {
      throw new Error('WAV writer is not open')
    }

    if (data.length === 0) {
      return
    }

    // Validate data size matches expected sample alignment
    const bytesPerSample = this.config.bitDepth / 8
    const bytesPerFrame = bytesPerSample * this.config.channels
    if (data.length % bytesPerFrame !== 0) {
      console.warn(`[RealTimeWavWriter] Data length ${data.length} is not aligned to frame size ${bytesPerFrame}`)
    }

    // Queue the write operation to ensure sequential writes
    this.writeQueue = this.writeQueue.then(async () => {
      if (!this.state.isOpen || this.fd === null) {
        return
      }

      try {
        this.isWriting = true

        // Write data to file
        fs.writeSync(this.fd, data)

        // Update state
        this.state.bytesWritten += data.length
        this.state.samplesWritten += data.length / bytesPerSample
        this.bytesSinceLastHeaderUpdate += data.length

        // Flush data to disk immediately for real-time access
        // Use fdatasyncSync for better performance than fsyncSync
        // (fdatasync only flushes data, not metadata)
        fs.fdatasyncSync(this.fd)

        // Check if we should update the header
        const now = Date.now()
        const timeSinceLastUpdate = now - this.lastHeaderUpdateTime
        const shouldUpdateHeader =
          this.bytesSinceLastHeaderUpdate >= this.config.headerUpdateInterval &&
          timeSinceLastUpdate >= MIN_HEADER_UPDATE_INTERVAL_MS

        if (shouldUpdateHeader) {
          await this.updateHeader()
          this.bytesSinceLastHeaderUpdate = 0
          this.lastHeaderUpdateTime = now
        }
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error)
        console.error(`[RealTimeWavWriter] Write error: ${errorMessage}`)
        this.state.error = errorMessage

        // Check for disk space errors
        if (errorMessage.includes('ENOSPC') || errorMessage.includes('No space left')) {
          throw new Error('Disk space error: No space left on device')
        }

        // Check for permission errors
        if (errorMessage.includes('EACCES') || errorMessage.includes('EPERM')) {
          throw new Error('Permission error: Cannot write to file')
        }

        throw error
      } finally {
        this.isWriting = false
      }
    })

    // Return the promise so callers can await if needed
    await this.writeQueue
  }

  /**
   * Update the WAV header with the current file size
   * This makes the file valid for reading at any point during recording
   */
  private async updateHeader(): Promise<void> {
    if (this.fd === null) {
      return
    }

    try {
      const header = this.createWavHeader(this.state.bytesWritten)

      // Write header at the beginning of the file
      fs.writeSync(this.fd, header, 0, header.length, 0)
      fs.fdatasyncSync(this.fd)

      this.state.lastHeaderUpdateTime = Date.now()
    } catch (error) {
      console.error('[RealTimeWavWriter] Error updating header:', error)
    }
  }

  /**
   * Close the WAV file
   * Finalizes the header and closes the file descriptor
   */
  async close(): Promise<void> {
    if (!this.state.isOpen || this.fd === null) {
      return
    }

    try {
      // Wait for any pending writes to complete
      await this.writeQueue

      // Update the header with final file size
      await this.updateHeader()

      // Ensure all data is flushed to disk before closing
      // This is critical to prevent the WAV header from being incorrect
      // when the file is read immediately after recording stops
      fs.fsyncSync(this.fd)

      // Close the file
      fs.closeSync(this.fd)
      this.fd = null

      console.log(`[RealTimeWavWriter] Closed file: ${this.state.filePath}`)
      console.log(`[RealTimeWavWriter] Total bytes written: ${this.state.bytesWritten}`)
      console.log(`[RealTimeWavWriter] Total samples: ${this.state.samplesWritten}`)

      this.state.isOpen = false
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error)
      console.error(`[RealTimeWavWriter] Error closing file: ${errorMessage}`)
      this.state.error = errorMessage

      // Force close even on error
      if (this.fd !== null) {
        try {
          fs.closeSync(this.fd)
        } catch {}
        this.fd = null
      }
      this.state.isOpen = false

      throw error
    }
  }

  /**
   * Get the current state of the writer
   */
  getState(): RealTimeWavWriterState {
    return { ...this.state }
  }

  /**
   * Create a WAV header buffer
   *
   * @param dataSize - Size of the audio data in bytes
   * @returns Buffer containing the 44-byte WAV header
   */
  private createWavHeader(dataSize: number): Buffer {
    const header = Buffer.alloc(WAV_HEADER_SIZE)

    const bytesPerSample = this.config.bitDepth / 8
    const byteRate = this.config.sampleRate * this.config.channels * bytesPerSample
    const blockAlign = this.config.channels * bytesPerSample

    // RIFF chunk descriptor
    header.write('RIFF', 0)
    header.writeUInt32LE(36 + dataSize, 4) // ChunkSize = 36 + SubChunk2Size
    header.write('WAVE', 8)

    // fmt sub-chunk
    header.write('fmt ', 12)
    header.writeUInt32LE(16, 16) // SubChunk1Size (16 for PCM)
    header.writeUInt16LE(1, 20) // AudioFormat (1 = PCM)
    header.writeUInt16LE(this.config.channels, 22) // NumChannels
    header.writeUInt32LE(this.config.sampleRate, 24) // SampleRate
    header.writeUInt32LE(byteRate, 28) // ByteRate
    header.writeUInt16LE(blockAlign, 32) // BlockAlign
    header.writeUInt16LE(this.config.bitDepth, 34) // BitsPerSample

    // data sub-chunk
    header.write('data', 36)
    header.writeUInt32LE(dataSize, 40) // SubChunk2Size

    return header
  }

  /**
   * Get the file path being written to
   */
  getFilePath(): string | null {
    return this.state.filePath
  }

  /**
   * Check if the writer is currently open
   */
  isOpen(): boolean {
    return this.state.isOpen
  }

  /**
   * Get the total duration of audio written (in seconds)
   */
  getDuration(): number {
    const bytesPerSample = this.config.bitDepth / 8
    const bytesPerSecond = this.config.sampleRate * this.config.channels * bytesPerSample
    return this.state.bytesWritten / bytesPerSecond
  }
}

/**
 * Create a real-time WAV writer with the given configuration
 * This is a convenience function for creating a new writer instance
 */
export function createRealTimeWavWriter(config: RealTimeWavWriterConfig): RealTimeWavWriter {
  return new RealTimeWavWriter(config)
}
