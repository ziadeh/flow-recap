/**
 * Audio Mixer Service
 *
 * Combines microphone and system audio streams in real-time.
 * Averages samples from both streams and outputs a mixed WAV file.
 * Handles buffer synchronization when streams arrive at different rates.
 *
 * IMPORTANT: This mixer now handles sample rate mismatches between sources.
 * When microphone and system audio have different sample rates, the mixer
 * will resample the streams to match the output sample rate, preventing
 * playback speed issues (e.g., audio playing too slow or too fast).
 *
 * REAL-TIME TRANSCRIPTION: Uses RealTimeWavWriter to flush audio data
 * to disk immediately after each chunk, enabling transcription services
 * to read from the file while recording is still in progress.
 */

import { Readable } from 'stream'
import * as fs from 'fs'
import * as path from 'path'
import { AudioResampler, logSampleRateMismatch, getRecommendedMixingSampleRate } from './audioResampler'
import { RealTimeWavWriter } from './realTimeWavWriter'

// ============================================================================
// Types
// ============================================================================

export interface AudioMixerConfig {
  sampleRate: number           // Output sample rate for the mixed WAV file
  channels?: number
  bitDepth?: number
  outputPath: string
  // NEW: Per-source sample rate configuration for handling mismatches
  microphoneSampleRate?: number    // Actual sample rate of microphone input
  systemAudioSampleRate?: number   // Actual sample rate of system audio input
  systemAudioChannels?: number     // Number of channels in system audio (usually 2 for stereo)
  // Callback for emitting mixed audio chunks for live transcription
  onMixedChunk?: (chunk: Buffer, sampleRate: number, channels: number, bitDepth: number) => void
  // NEW: Callback for emitting microphone-only audio for live transcription
  // This is useful when you want to transcribe only the user's voice without system audio interference
  onMicrophoneChunk?: (chunk: Buffer, sampleRate: number, channels: number, bitDepth: number) => void
  // NEW: Callback for emitting system audio chunks for live transcription
  // This enables transcription of computer audio (e.g., meeting participants via speaker/virtual cable)
  // System audio is resampled and converted to mono before emitting
  onSystemAudioChunk?: (chunk: Buffer, sampleRate: number, channels: number, bitDepth: number) => void
}

export interface AudioMixerState {
  isMixing: boolean
  samplesProcessed: number
  microphoneSamplesBuffered: number
  systemAudioSamplesBuffered: number
  outputFilePath: string | null
  // Sample rate tracking for debugging
  outputSampleRate: number
  microphoneSampleRate: number
  systemAudioSampleRate: number
  resamplingEnabled: boolean
}

// ============================================================================
// Audio Mixer Class
// ============================================================================

/**
 * AudioMixer class that combines microphone and system audio streams in real-time
 *
 * Key features:
 * - Handles sample rate mismatches between microphone and system audio
 * - Resamples audio streams to match the output sample rate
 * - Converts stereo system audio to mono before mixing
 * - Logs warnings when sample rate corrections are applied
 */
export class AudioMixer {
  private config: Required<AudioMixerConfig> & { onMixedChunk?: (chunk: Buffer, sampleRate: number, channels: number, bitDepth: number) => void; onMicrophoneChunk?: (chunk: Buffer, sampleRate: number, channels: number, bitDepth: number) => void; onSystemAudioChunk?: (chunk: Buffer, sampleRate: number, channels: number, bitDepth: number) => void }
  private wavWriter: RealTimeWavWriter | null = null
  private microphoneBuffer: Buffer[] = []
  private systemAudioBuffer: Buffer[] = []
  private microphoneStream: Readable | null = null
  private systemAudioStream: Readable | null = null
  private state: AudioMixerState
  private isProcessing: boolean = false
  private processingQueue: Promise<void> = Promise.resolve()

  // Resamplers for handling sample rate mismatches
  private microphoneResampler: AudioResampler | null = null
  private systemAudioResampler: AudioResampler | null = null
  private systemAudioIsStereo: boolean = false
  // Callback for emitting mixed audio chunks
  private onMixedChunk?: (chunk: Buffer, sampleRate: number, channels: number, bitDepth: number) => void
  // Callback for emitting microphone-only audio chunks (for live transcription without system audio interference)
  private onMicrophoneChunk?: (chunk: Buffer, sampleRate: number, channels: number, bitDepth: number) => void
  // Callback for emitting system audio chunks (for transcribing computer audio like meeting participants)
  private onSystemAudioChunk?: (chunk: Buffer, sampleRate: number, channels: number, bitDepth: number) => void

  constructor(config: AudioMixerConfig) {
    // Determine the actual sample rates for each source
    const micSampleRate = config.microphoneSampleRate ?? config.sampleRate
    const sysSampleRate = config.systemAudioSampleRate ?? config.sampleRate
    const sysChannels = config.systemAudioChannels ?? 2 // System audio is typically stereo

    this.config = {
      sampleRate: config.sampleRate,
      channels: config.channels ?? 1, // Output is mono
      bitDepth: config.bitDepth ?? 16, // Default to 16-bit
      outputPath: config.outputPath,
      microphoneSampleRate: micSampleRate,
      systemAudioSampleRate: sysSampleRate,
      systemAudioChannels: sysChannels
    }

    // Store the callbacks for emitting audio chunks (for live transcription)
    this.onMixedChunk = config.onMixedChunk
    // Store the callback for microphone-only audio (preferred for transcription to avoid system audio interference)
    this.onMicrophoneChunk = config.onMicrophoneChunk
    // Store the callback for system audio (for transcribing meeting participants via virtual cable)
    this.onSystemAudioChunk = config.onSystemAudioChunk

    this.systemAudioIsStereo = sysChannels === 2

    // Check for sample rate mismatches and create resamplers if needed
    const needsMicResampling = micSampleRate !== config.sampleRate
    const needsSysResampling = sysSampleRate !== config.sampleRate

    if (needsMicResampling) {
      logSampleRateMismatch('microphone', config.sampleRate, micSampleRate)
      this.microphoneResampler = new AudioResampler({
        inputSampleRate: micSampleRate,
        outputSampleRate: config.sampleRate,
        channels: 1, // Microphone is mono
        bitDepth: 16
      })
      console.log(`Microphone resampler created: ${micSampleRate}Hz -> ${config.sampleRate}Hz`)
    }

    if (needsSysResampling) {
      logSampleRateMismatch('system audio', config.sampleRate, sysSampleRate)
      this.systemAudioResampler = new AudioResampler({
        inputSampleRate: sysSampleRate,
        outputSampleRate: config.sampleRate,
        channels: 1, // Will be converted to mono before resampling
        bitDepth: 16
      })
      console.log(`System audio resampler created: ${sysSampleRate}Hz -> ${config.sampleRate}Hz`)
    }

    // Log sample rate configuration
    console.log(
      `AudioMixer initialized:`,
      `\n  Output sample rate: ${config.sampleRate}Hz`,
      `\n  Microphone sample rate: ${micSampleRate}Hz${needsMicResampling ? ' (will be resampled)' : ''}`,
      `\n  System audio sample rate: ${sysSampleRate}Hz${needsSysResampling ? ' (will be resampled)' : ''}`,
      `\n  System audio channels: ${sysChannels}${this.systemAudioIsStereo ? ' (will be converted to mono)' : ''}`
    )

    this.state = {
      isMixing: false,
      samplesProcessed: 0,
      microphoneSamplesBuffered: 0,
      systemAudioSamplesBuffered: 0,
      outputFilePath: null,
      outputSampleRate: config.sampleRate,
      microphoneSampleRate: micSampleRate,
      systemAudioSampleRate: sysSampleRate,
      resamplingEnabled: needsMicResampling || needsSysResampling
    }
  }

  /**
   * Start mixing audio from microphone and system audio streams
   */
  async start(
    microphoneStream: Readable,
    systemAudioStream: Readable
  ): Promise<void> {
    if (this.state.isMixing) {
      throw new Error('Audio mixer is already running')
    }

    // Ensure output directory exists
    const outputDir = path.dirname(this.config.outputPath)
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true })
    }

    // Create real-time WAV file writer for incremental writing
    // This enables transcription to read from the file while recording
    this.wavWriter = new RealTimeWavWriter({
      filePath: this.config.outputPath,
      sampleRate: this.config.sampleRate,
      channels: this.config.channels,
      bitDepth: this.config.bitDepth,
      // Update header every 32KB (~1 second of audio at 16kHz mono 16-bit)
      headerUpdateInterval: 32768,
    })
    await this.wavWriter.open()

    this.microphoneStream = microphoneStream
    this.systemAudioStream = systemAudioStream

    // Set up event handlers for microphone stream
    microphoneStream.on('data', (chunk: Buffer) => {
      this.handleMicrophoneData(chunk)
    })

    microphoneStream.on('error', (error: Error) => {
      console.error('Microphone stream error:', error)
      this.handleStreamError('microphone', error)
    })

    microphoneStream.on('end', () => {
      this.handleStreamEnd('microphone')
    })

    // Set up event handlers for system audio stream
    systemAudioStream.on('data', (chunk: Buffer) => {
      this.handleSystemAudioData(chunk)
    })

    systemAudioStream.on('error', (error: Error) => {
      console.error('System audio stream error:', error)
      this.handleStreamError('system', error)
    })

    systemAudioStream.on('end', () => {
      this.handleStreamEnd('system')
    })

    // Reset resamplers for fresh start
    if (this.microphoneResampler) {
      this.microphoneResampler.reset()
    }
    if (this.systemAudioResampler) {
      this.systemAudioResampler.reset()
    }

    // Update state
    this.state = {
      isMixing: true,
      samplesProcessed: 0,
      microphoneSamplesBuffered: 0,
      systemAudioSamplesBuffered: 0,
      outputFilePath: this.config.outputPath,
      outputSampleRate: this.config.sampleRate,
      microphoneSampleRate: this.config.microphoneSampleRate,
      systemAudioSampleRate: this.config.systemAudioSampleRate,
      resamplingEnabled: this.microphoneResampler !== null || this.systemAudioResampler !== null
    }
  }

  /**
   * Stop mixing and finalize the output file
   */
  async stop(): Promise<string> {
    if (!this.state.isMixing) {
      throw new Error('Audio mixer is not running')
    }

    // Wait for any pending processing to complete
    await this.processingQueue

    // Process any remaining buffered samples
    await this.processBuffers(true)

    // Close the WAV writer (finalizes the header)
    // The RealTimeWavWriter.close() method now includes fsyncSync() to ensure
    // all data is flushed to disk before the file is considered complete.
    // This prevents the audio playback looping bug caused by incorrect WAV headers.
    if (this.wavWriter) {
      await this.wavWriter.close()
      this.wavWriter = null
    }

    const outputPath = this.state.outputFilePath || this.config.outputPath

    // Log resampling statistics for debugging
    if (this.microphoneResampler) {
      const micState = this.microphoneResampler.getState()
      console.log(`Microphone resampling complete: ${micState.samplesProcessed} input samples -> ${micState.samplesOutput} output samples`)
    }
    if (this.systemAudioResampler) {
      const sysState = this.systemAudioResampler.getState()
      console.log(`System audio resampling complete: ${sysState.samplesProcessed} input samples -> ${sysState.samplesOutput} output samples`)
    }

    console.log(`AudioMixer stopped: ${this.state.samplesProcessed} samples written to ${outputPath}`)

    // Reset state
    this.state = {
      isMixing: false,
      samplesProcessed: 0,
      microphoneSamplesBuffered: 0,
      systemAudioSamplesBuffered: 0,
      outputFilePath: null,
      outputSampleRate: this.config.sampleRate,
      microphoneSampleRate: this.config.microphoneSampleRate,
      systemAudioSampleRate: this.config.systemAudioSampleRate,
      resamplingEnabled: false
    }

    this.microphoneBuffer = []
    this.systemAudioBuffer = []
    this.microphoneStream = null
    this.systemAudioStream = null

    return outputPath
  }

  /**
   * Get current mixer state
   */
  getState(): AudioMixerState {
    return { ...this.state }
  }

  /**
   * Handle incoming microphone audio data
   * Applies resampling if microphone sample rate differs from output rate
   */
  private handleMicrophoneData(chunk: Buffer): void {
    let processedChunk = chunk

    // Apply resampling if needed
    if (this.microphoneResampler) {
      processedChunk = this.microphoneResampler.resample16bit(chunk)
    }

    if (processedChunk.length > 0) {
      this.microphoneBuffer.push(processedChunk)
      this.state.microphoneSamplesBuffered += processedChunk.length / (this.config.bitDepth / 8)

      // Emit microphone-only audio for live transcription
      // This is preferred over mixed audio for accurate speech-to-text
      // as it avoids interference from system audio (music, videos, etc.)
      if (this.onMicrophoneChunk) {
        this.onMicrophoneChunk(processedChunk, this.config.sampleRate, this.config.channels, this.config.bitDepth)
      }

      // Trigger processing if we have data from both streams
      this.triggerProcessing()
    }
  }

  /**
   * Handle incoming system audio data
   * Applies stereo-to-mono conversion and resampling if needed
   */
  private handleSystemAudioData(chunk: Buffer): void {
    let processedChunk = chunk

    // Convert system audio to mono if it's stereo (2 channels, 16-bit = 4 bytes per frame)
    if (this.systemAudioIsStereo && this.config.channels === 1 && chunk.length % 4 === 0) {
      processedChunk = this.convertStereoToMono(chunk)
    }

    // Apply resampling if needed (after stereo-to-mono conversion)
    if (this.systemAudioResampler && processedChunk.length > 0) {
      processedChunk = this.systemAudioResampler.resample16bit(processedChunk)
    }

    if (processedChunk.length > 0) {
      this.systemAudioBuffer.push(processedChunk)
      this.state.systemAudioSamplesBuffered += processedChunk.length / (this.config.bitDepth / 8)

      // Emit system audio chunk for live transcription
      // This enables transcription of computer audio (e.g., meeting participants' voices
      // coming through virtual cable, video calls, etc.)
      // The audio has already been converted to mono and resampled to output sample rate
      if (this.onSystemAudioChunk) {
        this.onSystemAudioChunk(processedChunk, this.config.sampleRate, this.config.channels, this.config.bitDepth)
      }

      // Trigger processing if we have data from both streams
      this.triggerProcessing()
    }
  }

  /**
   * Convert stereo audio buffer to mono by averaging left and right channels
   */
  private convertStereoToMono(stereoBuffer: Buffer): Buffer {
    const sampleCount = stereoBuffer.length / 4 // 2 channels * 2 bytes per sample
    const monoBuffer = Buffer.allocUnsafe(sampleCount * 2) // 1 channel * 2 bytes per sample

    for (let i = 0; i < sampleCount; i++) {
      const leftSample = stereoBuffer.readInt16LE(i * 4)
      const rightSample = stereoBuffer.readInt16LE(i * 4 + 2)
      const monoSample = Math.round((leftSample + rightSample) / 2)
      monoBuffer.writeInt16LE(monoSample, i * 2)
    }

    return monoBuffer
  }

  /**
   * Trigger processing of buffered samples
   */
  private triggerProcessing(): void {
    if (this.isProcessing) {
      return
    }

    // Process if we have data from both streams
    if (this.microphoneBuffer.length > 0 && this.systemAudioBuffer.length > 0) {
      this.processingQueue = this.processingQueue.then(() => {
        return this.processBuffers(false)
      })
    }
  }

  /**
   * Process buffered samples and mix them
   */
  private async processBuffers(finalize: boolean): Promise<void> {
    if (this.isProcessing && !finalize) {
      return
    }

    this.isProcessing = true

    try {
      while (true) {
        // Get the minimum buffer size to ensure we can mix corresponding samples
        const micBufferSize = this.microphoneBuffer.reduce((sum, buf) => sum + buf.length, 0)
        const systemBufferSize = this.systemAudioBuffer.reduce((sum, buf) => sum + buf.length, 0)

        if (micBufferSize === 0 || systemBufferSize === 0) {
          if (!finalize) {
            break
          }
          // In finalize mode, process remaining samples even if one stream is empty
          if (micBufferSize === 0 && systemBufferSize === 0) {
            break
          }
        }

        // Determine how many samples we can process
        const bytesPerSample = this.config.bitDepth / 8
        const micSamples = Math.floor(micBufferSize / bytesPerSample)
        const systemSamples = Math.floor(systemBufferSize / bytesPerSample)
        const samplesToProcess = Math.min(micSamples, systemSamples)

        // If we don't have matching samples and not finalizing, wait for more data
        if (samplesToProcess === 0 && !finalize) {
          break
        }

        // Extract samples from buffers
        const micData = this.extractSamples(this.microphoneBuffer, samplesToProcess * bytesPerSample)
        const systemData = this.extractSamples(this.systemAudioBuffer, samplesToProcess * bytesPerSample)

        // Mix the samples
        const mixedData = this.mixSamples(micData, systemData, bytesPerSample)

        // Write mixed data to WAV file (with immediate flush for real-time transcription)
        if (this.wavWriter && mixedData.length > 0) {
          await this.wavWriter.write(mixedData)
          this.state.samplesProcessed += samplesToProcess

          // Emit mixed audio chunk for live transcription subscribers
          // This allows the live transcription service to process audio in real-time
          if (this.onMixedChunk) {
            this.onMixedChunk(mixedData, this.config.sampleRate, this.config.channels, this.config.bitDepth)
          }
        }

        // If finalizing and one stream is empty, process remaining samples from the other stream
        if (finalize) {
          if (micBufferSize === 0 && systemBufferSize > 0) {
            // Only system audio remaining
            const remainingSystem = this.extractAllSamples(this.systemAudioBuffer)
            if (remainingSystem.length > 0 && this.wavWriter) {
              await this.wavWriter.write(remainingSystem)
              // Emit remaining system audio chunk
              if (this.onMixedChunk) {
                this.onMixedChunk(remainingSystem, this.config.sampleRate, this.config.channels, this.config.bitDepth)
              }
            }
            break
          } else if (systemBufferSize === 0 && micBufferSize > 0) {
            // Only microphone remaining
            const remainingMic = this.extractAllSamples(this.microphoneBuffer)
            if (remainingMic.length > 0 && this.wavWriter) {
              await this.wavWriter.write(remainingMic)
              // Emit remaining microphone audio chunk
              if (this.onMixedChunk) {
                this.onMixedChunk(remainingMic, this.config.sampleRate, this.config.channels, this.config.bitDepth)
              }
            }
            break
          }
        }
      }
    } finally {
      this.isProcessing = false
    }
  }

  /**
   * Extract a specific number of bytes from buffer array
   */
  private extractSamples(buffers: Buffer[], bytesToExtract: number): Buffer {
    const result = Buffer.allocUnsafe(bytesToExtract)
    let offset = 0
    let bytesRemaining = bytesToExtract

    while (bytesRemaining > 0 && buffers.length > 0) {
      const currentBuffer = buffers[0]
      const bytesToTake = Math.min(bytesRemaining, currentBuffer.length)

      currentBuffer.copy(result, offset, 0, bytesToTake)

      if (bytesToTake === currentBuffer.length) {
        buffers.shift()
      } else {
        buffers[0] = currentBuffer.subarray(bytesToTake)
      }

      offset += bytesToTake
      bytesRemaining -= bytesToTake
    }

    return result
  }

  /**
   * Extract all remaining samples from buffer array
   */
  private extractAllSamples(buffers: Buffer[]): Buffer {
    if (buffers.length === 0) {
      return Buffer.allocUnsafe(0)
    }

    if (buffers.length === 1) {
      const result = buffers[0]
      buffers.length = 0
      return result
    }

    const totalLength = buffers.reduce((sum, buf) => sum + buf.length, 0)
    const result = Buffer.concat(buffers)
    buffers.length = 0
    return result
  }

  /**
   * Calculate RMS level for a 16-bit audio buffer (for diagnostics)
   */
  private calculateRMS(buffer: Buffer): number {
    if (buffer.length < 2) return 0
    const sampleCount = Math.floor(buffer.length / 2)
    let sumSquares = 0
    for (let i = 0; i < sampleCount; i++) {
      const sample = buffer.readInt16LE(i * 2)
      const normalized = sample / 32768.0
      sumSquares += normalized * normalized
    }
    return Math.sqrt(sumSquares / sampleCount)
  }

  /**
   * Mix two audio buffers using improved mixing strategy
   *
   * IMPORTANT: This version uses proper audio mixing that preserves signal strength:
   * - Instead of averaging (which halves amplitude), we add samples and clip
   * - This prevents the signal loss that was causing VAD to reject audio
   * - The mixed signal is then normalized to prevent clipping
   *
   * When both sources have low signal, averaging would make it even lower.
   * With summing + clipping, we preserve the stronger signal.
   */
  private mixSamples(buffer1: Buffer, buffer2: Buffer, bytesPerSample: number): Buffer {
    const minLength = Math.min(buffer1.length, buffer2.length)
    const result = Buffer.allocUnsafe(minLength)

    if (bytesPerSample === 2) {
      // 16-bit samples
      const sampleCount = Math.floor(minLength / 2)

      // Calculate RMS for both buffers to detect silent sources
      const rms1 = this.calculateRMS(buffer1)
      const rms2 = this.calculateRMS(buffer2)

      // Log audio levels periodically for debugging (every ~1 second at 16kHz)
      if (this.state.samplesProcessed % 16000 < sampleCount) {
        const db1 = rms1 > 0 ? 20 * Math.log10(rms1) : -100
        const db2 = rms2 > 0 ? 20 * Math.log10(rms2) : -100
        console.log(`[AudioMixer] Audio levels - Mic: ${db1.toFixed(1)}dB (RMS: ${rms1.toFixed(4)}), System: ${db2.toFixed(1)}dB (RMS: ${rms2.toFixed(4)})`)

        // Warn if both sources are essentially silent
        if (rms1 < 0.001 && rms2 < 0.001) {
          console.warn(`[AudioMixer] WARNING: Both audio sources appear silent! Check microphone and system audio routing.`)
        } else if (rms1 < 0.001) {
          console.warn(`[AudioMixer] WARNING: Microphone appears silent. RMS: ${rms1.toFixed(6)}`)
        } else if (rms2 < 0.001) {
          console.warn(`[AudioMixer] WARNING: System audio appears silent. RMS: ${rms2.toFixed(6)}`)
        }
      }

      // Determine if one source is essentially silent (RMS < 0.001, ~-60dB)
      const source1Silent = rms1 < 0.001
      const source2Silent = rms2 < 0.001

      for (let i = 0; i < sampleCount; i++) {
        const sample1 = buffer1.readInt16LE(i * 2)
        const sample2 = buffer2.readInt16LE(i * 2)

        let mixed: number
        if (source1Silent && source2Silent) {
          // Both silent - just average (doesn't matter)
          mixed = Math.round((sample1 + sample2) / 2)
        } else if (source1Silent) {
          // Source 1 silent - use source 2 directly (no amplitude loss)
          mixed = sample2
        } else if (source2Silent) {
          // Source 2 silent - use source 1 directly (no amplitude loss)
          mixed = sample1
        } else {
          // Both sources have audio - use proper audio summing
          // Sum and apply ~0.7 gain to prevent clipping while preserving loudness
          // This is better than /2 which loses too much amplitude
          mixed = Math.round((sample1 + sample2) * 0.7)
        }

        // Clamp to prevent overflow
        const clamped = Math.max(-32768, Math.min(32767, mixed))
        result.writeInt16LE(clamped, i * 2)
      }
    } else if (bytesPerSample === 1) {
      // 8-bit samples
      for (let i = 0; i < minLength; i++) {
        const sample1 = buffer1.readUInt8(i)
        const sample2 = buffer2.readUInt8(i)
        // Same improved mixing strategy for 8-bit
        const mixed = Math.round((sample1 + sample2) * 0.7)
        result.writeUInt8(Math.max(0, Math.min(255, mixed)), i)
      }
    } else {
      // For other bit depths, just copy the first buffer
      buffer1.copy(result, 0, 0, minLength)
    }

    return result
  }

  /**
   * Handle stream errors
   */
  private handleStreamError(source: 'microphone' | 'system', error: Error): void {
    console.error(`Error in ${source} stream:`, error)
    // Continue processing with available data
  }

  /**
   * Handle stream end
   */
  private handleStreamEnd(source: 'microphone' | 'system'): void {
    console.log(`${source} stream ended`)
    // Continue processing remaining buffered data
    if (this.state.isMixing) {
      this.processingQueue = this.processingQueue.then(() => {
        return this.processBuffers(true)
      })
    }
  }
}
