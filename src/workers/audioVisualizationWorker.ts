/**
 * Audio Visualization Worker
 *
 * Web Worker that offloads heavy audio visualization computations from the main thread.
 * Handles:
 * - FFT (Fast Fourier Transform) calculations for frequency analysis
 * - Waveform generation from raw audio data
 * - Audio chunk preprocessing (RMS calculation, peak detection, normalization)
 * - Float32Array operations that would otherwise block UI rendering
 *
 * This prevents UI lag during recording by running audio processing in parallel.
 */

// ============================================================================
// Type Definitions for Message Passing
// ============================================================================

export type AudioProcessingRequestType =
  | 'processAudioChunk'
  | 'generateWaveform'
  | 'computeFFT'
  | 'preprocessChunk'

// Audio format configuration
export interface AudioFormat {
  sampleRate: number      // e.g., 16000
  channels: number        // e.g., 1 (mono)
  bitDepth: number        // e.g., 16
}

// Request types
export interface ProcessAudioChunkRequest {
  type: 'processAudioChunk'
  requestId: string
  audioData: ArrayBuffer   // Raw PCM audio data (transferable)
  format: AudioFormat
  barCount?: number        // Number of visualization bars (default: 28)
}

export interface GenerateWaveformRequest {
  type: 'generateWaveform'
  requestId: string
  audioData: ArrayBuffer   // Raw PCM audio data (transferable)
  format: AudioFormat
  barCount: number         // Number of waveform bars
}

export interface ComputeFFTRequest {
  type: 'computeFFT'
  requestId: string
  audioData: ArrayBuffer   // Raw PCM audio data (transferable)
  format: AudioFormat
  fftSize?: number         // FFT size (default: 2048)
  frequencyBins?: number   // Number of frequency bins to return (default: 64)
}

export interface PreprocessChunkRequest {
  type: 'preprocessChunk'
  requestId: string
  audioData: ArrayBuffer   // Raw PCM audio data (transferable)
  format: AudioFormat
  normalize?: boolean      // Whether to normalize audio (default: false)
  removeDCOffset?: boolean // Whether to remove DC offset (default: true)
}

export type AudioProcessingRequest =
  | ProcessAudioChunkRequest
  | GenerateWaveformRequest
  | ComputeFFTRequest
  | PreprocessChunkRequest

// Response types
export interface ProcessAudioChunkResponse {
  type: 'processAudioChunk'
  requestId: string
  bars: number[]           // Bar heights (0-1)
  rmsLevel: number         // RMS level (0-1)
  peakLevel: number        // Peak level (0-1)
  rmsDb: number            // RMS in dB
  duration: number         // Processing time in ms
}

export interface GenerateWaveformResponse {
  type: 'generateWaveform'
  requestId: string
  bars: number[]           // Bar heights (0-1)
  peaks: number[]          // Peak levels per bar
  duration: number
}

export interface ComputeFFTResponse {
  type: 'computeFFT'
  requestId: string
  magnitudes: number[]     // Frequency magnitudes (0-1 normalized)
  frequencies: number[]    // Corresponding frequency values in Hz
  dominantFrequency: number // The frequency with highest magnitude
  duration: number
}

export interface PreprocessChunkResponse {
  type: 'preprocessChunk'
  requestId: string
  processedData: ArrayBuffer // Preprocessed audio data (transferable)
  rmsLevel: number
  peakLevel: number
  hasClipping: boolean
  dcOffset: number
  duration: number
}

export interface AudioProcessingErrorResponse {
  type: 'error'
  requestId: string
  error: string
}

export type AudioProcessingResponse =
  | ProcessAudioChunkResponse
  | GenerateWaveformResponse
  | ComputeFFTResponse
  | PreprocessChunkResponse
  | AudioProcessingErrorResponse

// ============================================================================
// Audio Processing Utilities
// ============================================================================

/**
 * Convert 16-bit PCM buffer to Float32Array
 * Normalizes samples to -1.0 to 1.0 range
 */
function pcm16ToFloat32(buffer: ArrayBuffer): Float32Array {
  const int16Array = new Int16Array(buffer)
  const float32Array = new Float32Array(int16Array.length)

  for (let i = 0; i < int16Array.length; i++) {
    // Normalize from [-32768, 32767] to [-1.0, 1.0]
    float32Array[i] = int16Array[i] / 32768.0
  }

  return float32Array
}

/**
 * Convert Float32Array back to 16-bit PCM buffer
 */
function float32ToPCM16(float32Array: Float32Array): ArrayBuffer {
  const buffer = new ArrayBuffer(float32Array.length * 2)
  const int16Array = new Int16Array(buffer)

  for (let i = 0; i < float32Array.length; i++) {
    // Clamp to [-1.0, 1.0] and convert to [-32768, 32767]
    const sample = Math.max(-1.0, Math.min(1.0, float32Array[i]))
    int16Array[i] = Math.round(sample * 32767)
  }

  return buffer
}

/**
 * Calculate RMS (Root Mean Square) level of audio samples
 * @returns RMS value between 0 and 1
 */
function calculateRMS(samples: Float32Array): number {
  if (samples.length === 0) return 0

  let sumSquares = 0
  for (let i = 0; i < samples.length; i++) {
    sumSquares += samples[i] * samples[i]
  }

  return Math.sqrt(sumSquares / samples.length)
}

/**
 * Calculate peak level of audio samples
 * @returns Peak value between 0 and 1
 */
function calculatePeak(samples: Float32Array): number {
  if (samples.length === 0) return 0

  let maxAbs = 0
  for (let i = 0; i < samples.length; i++) {
    const absValue = Math.abs(samples[i])
    if (absValue > maxAbs) {
      maxAbs = absValue
    }
  }

  return maxAbs
}

/**
 * Convert linear amplitude to decibels
 */
function linearToDb(linear: number): number {
  if (linear <= 0) return -100
  return 20 * Math.log10(linear)
}

/**
 * Calculate DC offset in audio samples
 */
function calculateDCOffset(samples: Float32Array): number {
  if (samples.length === 0) return 0

  let sum = 0
  for (let i = 0; i < samples.length; i++) {
    sum += samples[i]
  }

  return sum / samples.length
}

/**
 * Remove DC offset from audio samples
 */
function removeDCOffset(samples: Float32Array): Float32Array {
  const offset = calculateDCOffset(samples)
  const result = new Float32Array(samples.length)

  for (let i = 0; i < samples.length; i++) {
    result[i] = samples[i] - offset
  }

  return result
}

/**
 * Normalize audio samples to use full dynamic range
 */
function normalizeAudio(samples: Float32Array): Float32Array {
  const peak = calculatePeak(samples)

  if (peak <= 0) return samples

  const result = new Float32Array(samples.length)
  const scale = 0.95 / peak // Leave some headroom

  for (let i = 0; i < samples.length; i++) {
    result[i] = samples[i] * scale
  }

  return result
}

/**
 * Check if audio has clipping (samples at or near max amplitude)
 */
function hasClipping(samples: Float32Array, threshold: number = 0.99): boolean {
  for (let i = 0; i < samples.length; i++) {
    if (Math.abs(samples[i]) >= threshold) {
      return true
    }
  }
  return false
}

// ============================================================================
// FFT Implementation
// ============================================================================

/**
 * Simple real-only FFT implementation using Cooley-Tukey algorithm
 * Optimized for audio visualization (only computes magnitude spectrum)
 */
function computeFFT(samples: Float32Array, fftSize: number): Float32Array {
  // Ensure fftSize is a power of 2
  const actualSize = Math.pow(2, Math.ceil(Math.log2(fftSize)))

  // Zero-pad or truncate samples to match FFT size
  const paddedSamples = new Float32Array(actualSize)
  const copyLength = Math.min(samples.length, actualSize)
  paddedSamples.set(samples.subarray(0, copyLength))

  // Apply Hann window to reduce spectral leakage
  const windowed = applyHannWindow(paddedSamples)

  // Perform FFT
  const { real, imag } = fft(windowed)

  // Calculate magnitude spectrum (only first half - positive frequencies)
  const halfSize = actualSize / 2
  const magnitudes = new Float32Array(halfSize)

  for (let i = 0; i < halfSize; i++) {
    magnitudes[i] = Math.sqrt(real[i] * real[i] + imag[i] * imag[i]) / actualSize
  }

  return magnitudes
}

/**
 * Apply Hann window function to reduce spectral leakage
 */
function applyHannWindow(samples: Float32Array): Float32Array {
  const result = new Float32Array(samples.length)
  const N = samples.length

  for (let i = 0; i < N; i++) {
    const window = 0.5 * (1 - Math.cos((2 * Math.PI * i) / (N - 1)))
    result[i] = samples[i] * window
  }

  return result
}

/**
 * Cooley-Tukey FFT implementation
 * Returns real and imaginary components
 */
function fft(samples: Float32Array): { real: Float32Array; imag: Float32Array } {
  const N = samples.length

  if (N <= 1) {
    return {
      real: new Float32Array(samples),
      imag: new Float32Array(N)
    }
  }

  // Bit-reversal permutation
  const real = new Float32Array(N)
  const imag = new Float32Array(N)

  const bits = Math.log2(N)
  for (let i = 0; i < N; i++) {
    const j = reverseBits(i, bits)
    real[j] = samples[i]
  }

  // Cooley-Tukey iterative FFT
  for (let size = 2; size <= N; size *= 2) {
    const halfSize = size / 2
    const angle = -2 * Math.PI / size

    for (let i = 0; i < N; i += size) {
      for (let j = 0; j < halfSize; j++) {
        const cos = Math.cos(angle * j)
        const sin = Math.sin(angle * j)

        const idx1 = i + j
        const idx2 = i + j + halfSize

        const tReal = real[idx2] * cos - imag[idx2] * sin
        const tImag = real[idx2] * sin + imag[idx2] * cos

        real[idx2] = real[idx1] - tReal
        imag[idx2] = imag[idx1] - tImag
        real[idx1] = real[idx1] + tReal
        imag[idx1] = imag[idx1] + tImag
      }
    }
  }

  return { real, imag }
}

/**
 * Reverse bits of a number (for FFT bit-reversal permutation)
 */
function reverseBits(num: number, bits: number): number {
  let result = 0
  for (let i = 0; i < bits; i++) {
    result = (result << 1) | (num & 1)
    num >>= 1
  }
  return result
}

// ============================================================================
// Waveform Generation
// ============================================================================

/**
 * Generate waveform bars from audio samples
 * Groups samples into bars and calculates average amplitude per bar
 */
function generateWaveformBars(
  samples: Float32Array,
  barCount: number
): { bars: number[]; peaks: number[] } {
  if (samples.length === 0 || barCount <= 0) {
    return {
      bars: new Array(barCount).fill(0.15),
      peaks: new Array(barCount).fill(0)
    }
  }

  const samplesPerBar = Math.max(1, Math.floor(samples.length / barCount))
  const bars: number[] = []
  const peaks: number[] = []

  for (let i = 0; i < barCount; i++) {
    const startIdx = i * samplesPerBar
    const endIdx = Math.min(startIdx + samplesPerBar, samples.length)

    if (startIdx >= samples.length) {
      bars.push(0.15) // Minimum height
      peaks.push(0)
      continue
    }

    // Calculate RMS for this segment (better representation than peak)
    let sumSquares = 0
    let maxAbs = 0
    let count = 0

    for (let j = startIdx; j < endIdx; j++) {
      const absValue = Math.abs(samples[j])
      sumSquares += samples[j] * samples[j]
      if (absValue > maxAbs) maxAbs = absValue
      count++
    }

    const rms = count > 0 ? Math.sqrt(sumSquares / count) : 0

    // Scale RMS to bar height (with minimum and maximum)
    // RMS of 0.5 would mean very loud audio
    const barHeight = Math.max(0.15, Math.min(1.0, rms * 3))

    bars.push(barHeight)
    peaks.push(maxAbs)
  }

  return { bars, peaks }
}

/**
 * Process audio chunk for real-time visualization
 * Combines RMS, peak, and waveform generation
 */
function processAudioChunk(
  audioData: ArrayBuffer,
  _format: AudioFormat, // Format available for future enhancements (e.g., non-16bit support)
  barCount: number = 28
): {
  bars: number[]
  rmsLevel: number
  peakLevel: number
  rmsDb: number
} {
  // Convert PCM16 to Float32
  const samples = pcm16ToFloat32(audioData)

  // Calculate overall levels
  const rmsLevel = calculateRMS(samples)
  const peakLevel = calculatePeak(samples)
  const rmsDb = linearToDb(rmsLevel)

  // Generate waveform bars
  const { bars } = generateWaveformBars(samples, barCount)

  return {
    bars,
    rmsLevel,
    peakLevel,
    rmsDb
  }
}

// ============================================================================
// Frequency Analysis
// ============================================================================

/**
 * Compute FFT and extract frequency bins for visualization
 */
function computeFrequencyAnalysis(
  audioData: ArrayBuffer,
  format: AudioFormat,
  fftSize: number = 2048,
  frequencyBins: number = 64
): {
  magnitudes: number[]
  frequencies: number[]
  dominantFrequency: number
} {
  const samples = pcm16ToFloat32(audioData)
  const magnitudeSpectrum = computeFFT(samples, fftSize)

  // Calculate frequency resolution
  const freqResolution = format.sampleRate / fftSize

  // Map magnitude spectrum to requested number of bins
  // Use logarithmic scaling for better perceptual representation
  const magnitudes: number[] = []
  const frequencies: number[] = []

  // Define frequency range (20Hz to Nyquist)
  const minFreq = 20
  const maxFreq = format.sampleRate / 2

  // Create logarithmic frequency bins
  const logMin = Math.log10(minFreq)
  const logMax = Math.log10(maxFreq)
  const logStep = (logMax - logMin) / frequencyBins

  let maxMagnitude = 0
  let dominantFrequency = 0

  for (let i = 0; i < frequencyBins; i++) {
    const freqLow = Math.pow(10, logMin + i * logStep)
    const freqHigh = Math.pow(10, logMin + (i + 1) * logStep)

    const binLow = Math.floor(freqLow / freqResolution)
    const binHigh = Math.min(
      Math.ceil(freqHigh / freqResolution),
      magnitudeSpectrum.length - 1
    )

    // Average magnitude in this frequency range
    let sum = 0
    let count = 0

    for (let j = binLow; j <= binHigh; j++) {
      if (j < magnitudeSpectrum.length) {
        sum += magnitudeSpectrum[j]
        count++
      }
    }

    const avgMagnitude = count > 0 ? sum / count : 0

    // Track dominant frequency
    if (avgMagnitude > maxMagnitude) {
      maxMagnitude = avgMagnitude
      dominantFrequency = (freqLow + freqHigh) / 2
    }

    // Normalize magnitude (scale by 10 for better visibility, clamp to 1)
    magnitudes.push(Math.min(1.0, avgMagnitude * 10))
    frequencies.push((freqLow + freqHigh) / 2)
  }

  return {
    magnitudes,
    frequencies,
    dominantFrequency
  }
}

// ============================================================================
// Audio Preprocessing
// ============================================================================

/**
 * Preprocess audio chunk with optional normalization and DC offset removal
 */
function preprocessAudioChunk(
  audioData: ArrayBuffer,
  _format: AudioFormat, // Format available for future enhancements (e.g., non-16bit support)
  normalize: boolean = false,
  removeDC: boolean = true
): {
  processedData: ArrayBuffer
  rmsLevel: number
  peakLevel: number
  hasClipping: boolean
  dcOffset: number
} {
  let samples = pcm16ToFloat32(audioData)

  // Calculate initial metrics
  const dcOffset = calculateDCOffset(samples)

  // Remove DC offset if requested
  if (removeDC && Math.abs(dcOffset) > 0.001) {
    samples = removeDCOffset(samples)
  }

  // Check for clipping before normalization
  const clipping = hasClipping(samples)

  // Normalize if requested
  if (normalize) {
    samples = normalizeAudio(samples)
  }

  // Calculate output metrics
  const rmsLevel = calculateRMS(samples)
  const peakLevel = calculatePeak(samples)

  // Convert back to PCM16
  const processedData = float32ToPCM16(samples)

  return {
    processedData,
    rmsLevel,
    peakLevel,
    hasClipping: clipping,
    dcOffset
  }
}

// ============================================================================
// Worker Message Handler
// ============================================================================

self.onmessage = function(event: MessageEvent<AudioProcessingRequest>) {
  const request = event.data
  const startTime = performance.now()

  try {
    let response: AudioProcessingResponse

    switch (request.type) {
      case 'processAudioChunk': {
        const result = processAudioChunk(
          request.audioData,
          request.format,
          request.barCount ?? 28
        )
        const duration = performance.now() - startTime

        response = {
          type: 'processAudioChunk',
          requestId: request.requestId,
          bars: result.bars,
          rmsLevel: result.rmsLevel,
          peakLevel: result.peakLevel,
          rmsDb: result.rmsDb,
          duration
        }
        break
      }

      case 'generateWaveform': {
        const samples = pcm16ToFloat32(request.audioData)
        const result = generateWaveformBars(samples, request.barCount)
        const duration = performance.now() - startTime

        response = {
          type: 'generateWaveform',
          requestId: request.requestId,
          bars: result.bars,
          peaks: result.peaks,
          duration
        }
        break
      }

      case 'computeFFT': {
        const result = computeFrequencyAnalysis(
          request.audioData,
          request.format,
          request.fftSize ?? 2048,
          request.frequencyBins ?? 64
        )
        const duration = performance.now() - startTime

        response = {
          type: 'computeFFT',
          requestId: request.requestId,
          magnitudes: result.magnitudes,
          frequencies: result.frequencies,
          dominantFrequency: result.dominantFrequency,
          duration
        }
        break
      }

      case 'preprocessChunk': {
        const result = preprocessAudioChunk(
          request.audioData,
          request.format,
          request.normalize ?? false,
          request.removeDCOffset ?? true
        )
        const duration = performance.now() - startTime

        response = {
          type: 'preprocessChunk',
          requestId: request.requestId,
          processedData: result.processedData,
          rmsLevel: result.rmsLevel,
          peakLevel: result.peakLevel,
          hasClipping: result.hasClipping,
          dcOffset: result.dcOffset,
          duration
        }

        // Use transferable for processed audio data
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        ;(self.postMessage as any)(response, [result.processedData])
        return
      }

      default: {
        const _exhaustiveCheck: never = request
        throw new Error(`Unknown audio processing request type: ${(_exhaustiveCheck as AudioProcessingRequest).type}`)
      }
    }

    self.postMessage(response)
  } catch (error) {
    const errorResponse: AudioProcessingErrorResponse = {
      type: 'error',
      requestId: request.requestId,
      error: error instanceof Error ? error.message : 'Unknown error occurred'
    }
    self.postMessage(errorResponse)
  }
}

// Signal that the worker is ready
self.postMessage({ type: 'ready' })
