/**
 * Audio Resampler Service
 *
 * Provides real-time audio resampling functionality to convert audio data
 * from one sample rate to another. This is critical for fixing sample rate
 * mismatch issues that cause slow/fast playback when recording from multiple
 * audio sources (e.g., microphone + speaker/system audio).
 *
 * Uses linear interpolation for efficient real-time resampling.
 */

// ============================================================================
// Types
// ============================================================================

export interface ResamplerConfig {
  inputSampleRate: number
  outputSampleRate: number
  channels: number
  bitDepth: number // 16 for Int16, 32 for Float32
}

export interface ResamplerState {
  inputSampleRate: number
  outputSampleRate: number
  ratio: number
  samplesProcessed: number
  samplesOutput: number
}

// ============================================================================
// Audio Resampler Class
// ============================================================================

/**
 * AudioResampler class that converts audio data between sample rates in real-time.
 * Uses linear interpolation for efficient processing with acceptable quality.
 */
export class AudioResampler {
  private config: Required<ResamplerConfig>
  private ratio: number
  private state: ResamplerState
  private lastSample: number = 0
  private fractionalIndex: number = 0

  constructor(config: ResamplerConfig) {
    this.config = {
      inputSampleRate: config.inputSampleRate,
      outputSampleRate: config.outputSampleRate,
      channels: config.channels || 1,
      bitDepth: config.bitDepth || 16
    }

    // Calculate resampling ratio (output samples per input sample)
    this.ratio = this.config.outputSampleRate / this.config.inputSampleRate

    this.state = {
      inputSampleRate: this.config.inputSampleRate,
      outputSampleRate: this.config.outputSampleRate,
      ratio: this.ratio,
      samplesProcessed: 0,
      samplesOutput: 0
    }

    // Log resampling configuration
    if (this.config.inputSampleRate !== this.config.outputSampleRate) {
      console.log(
        `AudioResampler initialized: ${this.config.inputSampleRate}Hz -> ${this.config.outputSampleRate}Hz (ratio: ${this.ratio.toFixed(4)})`
      )
    }
  }

  /**
   * Check if resampling is needed (input and output rates differ)
   */
  needsResampling(): boolean {
    return this.config.inputSampleRate !== this.config.outputSampleRate
  }

  /**
   * Get the resampling ratio
   */
  getRatio(): number {
    return this.ratio
  }

  /**
   * Get current resampler state
   */
  getState(): ResamplerState {
    return { ...this.state }
  }

  /**
   * Resample a buffer of 16-bit PCM audio data.
   * Uses linear interpolation for smooth transitions.
   *
   * @param inputBuffer - Buffer containing 16-bit PCM samples
   * @returns Buffer containing resampled 16-bit PCM samples
   */
  resample16bit(inputBuffer: Buffer): Buffer {
    if (!this.needsResampling()) {
      // No resampling needed - return input as-is
      return inputBuffer
    }

    const bytesPerSample = 2 // 16-bit
    const inputSampleCount = Math.floor(inputBuffer.length / bytesPerSample)

    if (inputSampleCount === 0) {
      return Buffer.allocUnsafe(0)
    }

    // Calculate expected output sample count
    const outputSampleCount = Math.ceil(inputSampleCount * this.ratio)
    const outputBuffer = Buffer.allocUnsafe(outputSampleCount * bytesPerSample)

    let outputIndex = 0

    // Read all input samples
    const inputSamples: number[] = new Array(inputSampleCount)
    for (let i = 0; i < inputSampleCount; i++) {
      inputSamples[i] = inputBuffer.readInt16LE(i * bytesPerSample)
    }

    // Perform linear interpolation resampling
    for (let i = 0; i < outputSampleCount; i++) {
      // Calculate the corresponding position in the input
      const inputPosition = i / this.ratio + this.fractionalIndex

      // Get the two samples to interpolate between
      const index0 = Math.floor(inputPosition)
      const index1 = Math.min(index0 + 1, inputSampleCount - 1)

      // Handle edge cases
      const sample0 = index0 < 0 ? this.lastSample : (index0 < inputSampleCount ? inputSamples[index0] : inputSamples[inputSampleCount - 1])
      const sample1 = index1 < inputSampleCount ? inputSamples[index1] : inputSamples[inputSampleCount - 1]

      // Linear interpolation
      const fraction = inputPosition - index0
      const interpolatedSample = Math.round(sample0 + (sample1 - sample0) * fraction)

      // Clamp to 16-bit range
      const clampedSample = Math.max(-32768, Math.min(32767, interpolatedSample))

      // Write to output buffer
      outputBuffer.writeInt16LE(clampedSample, outputIndex * bytesPerSample)
      outputIndex++
    }

    // Save the last sample for continuity in the next chunk
    if (inputSampleCount > 0) {
      this.lastSample = inputSamples[inputSampleCount - 1]
    }

    // Update fractional index for next chunk continuity
    const lastInputPosition = (outputSampleCount - 1) / this.ratio + this.fractionalIndex
    this.fractionalIndex = (lastInputPosition + 1 / this.ratio) - inputSampleCount
    if (this.fractionalIndex < 0) this.fractionalIndex = 0
    if (this.fractionalIndex >= 1) this.fractionalIndex = this.fractionalIndex % 1

    // Update stats
    this.state.samplesProcessed += inputSampleCount
    this.state.samplesOutput += outputIndex

    return outputBuffer.subarray(0, outputIndex * bytesPerSample)
  }

  /**
   * Resample stereo 16-bit PCM audio data (interleaved L/R samples).
   * Converts stereo to mono while resampling if output is mono.
   *
   * @param inputBuffer - Buffer containing interleaved stereo 16-bit PCM samples
   * @param outputMono - If true, output will be mono (averaged channels)
   * @returns Buffer containing resampled 16-bit PCM samples
   */
  resampleStereo16bit(inputBuffer: Buffer, outputMono: boolean = true): Buffer {
    const bytesPerSample = 2 // 16-bit
    const inputFrameCount = Math.floor(inputBuffer.length / (bytesPerSample * 2)) // stereo = 2 samples per frame

    if (inputFrameCount === 0) {
      return Buffer.allocUnsafe(0)
    }

    // First, convert stereo to mono if needed
    let monoBuffer: Buffer
    if (outputMono) {
      monoBuffer = Buffer.allocUnsafe(inputFrameCount * bytesPerSample)
      for (let i = 0; i < inputFrameCount; i++) {
        const leftSample = inputBuffer.readInt16LE(i * 4)
        const rightSample = inputBuffer.readInt16LE(i * 4 + 2)
        const monoSample = Math.round((leftSample + rightSample) / 2)
        monoBuffer.writeInt16LE(monoSample, i * bytesPerSample)
      }
    } else {
      monoBuffer = inputBuffer
    }

    // Then resample the mono buffer
    return this.resample16bit(monoBuffer)
  }

  /**
   * Reset the resampler state (for starting a new recording)
   */
  reset(): void {
    this.lastSample = 0
    this.fractionalIndex = 0
    this.state.samplesProcessed = 0
    this.state.samplesOutput = 0
  }
}

// ============================================================================
// Utility Functions
// ============================================================================

/**
 * Calculate the expected output size after resampling
 */
export function calculateResampledSize(
  inputSampleCount: number,
  inputSampleRate: number,
  outputSampleRate: number
): number {
  return Math.ceil(inputSampleCount * (outputSampleRate / inputSampleRate))
}

/**
 * Detect if a sample rate is a common standard rate
 */
export function isStandardSampleRate(sampleRate: number): boolean {
  const standardRates = [8000, 11025, 16000, 22050, 32000, 44100, 48000, 88200, 96000, 176400, 192000]
  return standardRates.includes(sampleRate)
}

/**
 * Get the recommended sample rate for mixing different sources
 * Returns the higher of the two rates to preserve quality
 */
export function getRecommendedMixingSampleRate(rate1: number, rate2: number): number {
  // Use the higher rate to avoid quality loss
  // But prefer common rates like 48kHz
  if (rate1 === rate2) return rate1

  const higherRate = Math.max(rate1, rate2)
  const lowerRate = Math.min(rate1, rate2)

  // If one is 48kHz, prefer that (most common for system audio)
  if (higherRate === 48000 || lowerRate === 48000) {
    return 48000
  }

  // If one is 44.1kHz (CD quality), prefer that
  if (higherRate === 44100 || lowerRate === 44100) {
    return 44100
  }

  // Otherwise, use the higher rate
  return higherRate
}

/**
 * Log sample rate mismatch warning
 */
export function logSampleRateMismatch(
  source: string,
  expectedRate: number,
  actualRate: number
): void {
  const ratio = actualRate / expectedRate
  const percentDiff = Math.abs((ratio - 1) * 100).toFixed(2)
  const speedEffect = ratio > 1 ? 'faster' : 'slower'

  console.warn(
    `Sample rate mismatch detected for ${source}:`,
    `\n  Expected: ${expectedRate}Hz`,
    `\n  Actual: ${actualRate}Hz`,
    `\n  Ratio: ${ratio.toFixed(4)}`,
    `\n  Effect: Audio would play ${percentDiff}% ${speedEffect} without correction`
  )
}
