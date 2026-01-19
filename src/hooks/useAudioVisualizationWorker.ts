/**
 * useAudioVisualizationWorker Hook
 *
 * Custom React hook that manages the Audio Visualization Web Worker for offloading
 * heavy audio processing from the main thread. Handles:
 * - Real-time waveform generation
 * - FFT frequency analysis
 * - Audio chunk preprocessing
 * - Automatic fallback to main-thread processing when worker unavailable
 *
 * This prevents UI lag during recording by running audio processing in a separate thread.
 */

import { useState, useEffect, useRef, useCallback } from 'react'
import type {
  AudioProcessingRequest,
  AudioProcessingResponse,
  AudioFormat,
  ProcessAudioChunkResponse,
  GenerateWaveformResponse,
  ComputeFFTResponse,
  PreprocessChunkResponse
} from '../workers/audioVisualizationWorker'

// ============================================================================
// Constants
// ============================================================================

/** Timeout for worker operations in milliseconds */
const WORKER_TIMEOUT = 5000 // 5 seconds (audio processing should be fast)

/** Minimum chunk size to bother with worker processing (in bytes) */
const MIN_CHUNK_SIZE_FOR_WORKER = 512

// ============================================================================
// Fallback Implementations (for when worker is unavailable)
// ============================================================================

/**
 * Simple RMS calculation fallback
 */
function calculateRMSSync(samples: Float32Array): number {
  if (samples.length === 0) return 0

  let sumSquares = 0
  for (let i = 0; i < samples.length; i++) {
    sumSquares += samples[i] * samples[i]
  }

  return Math.sqrt(sumSquares / samples.length)
}

/**
 * Simple peak calculation fallback
 */
function calculatePeakSync(samples: Float32Array): number {
  if (samples.length === 0) return 0

  let maxAbs = 0
  for (let i = 0; i < samples.length; i++) {
    const absValue = Math.abs(samples[i])
    if (absValue > maxAbs) maxAbs = absValue
  }

  return maxAbs
}

/**
 * Convert 16-bit PCM to Float32Array
 */
function pcm16ToFloat32Sync(buffer: ArrayBuffer): Float32Array {
  const int16Array = new Int16Array(buffer)
  const float32Array = new Float32Array(int16Array.length)

  for (let i = 0; i < int16Array.length; i++) {
    float32Array[i] = int16Array[i] / 32768.0
  }

  return float32Array
}

/**
 * Generate simple waveform bars synchronously
 */
function generateWaveformBarsSync(
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
      bars.push(0.15)
      peaks.push(0)
      continue
    }

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
    const barHeight = Math.max(0.15, Math.min(1.0, rms * 3))

    bars.push(barHeight)
    peaks.push(maxAbs)
  }

  return { bars, peaks }
}

/**
 * Process audio chunk synchronously (fallback)
 */
export function processAudioChunkSync(
  audioData: ArrayBuffer,
  barCount: number = 28
): {
  bars: number[]
  rmsLevel: number
  peakLevel: number
  rmsDb: number
} {
  const samples = pcm16ToFloat32Sync(audioData)
  const rmsLevel = calculateRMSSync(samples)
  const peakLevel = calculatePeakSync(samples)
  const rmsDb = rmsLevel > 0 ? 20 * Math.log10(rmsLevel) : -100
  const { bars } = generateWaveformBarsSync(samples, barCount)

  return { bars, rmsLevel, peakLevel, rmsDb }
}

// ============================================================================
// Hook Types
// ============================================================================

interface PendingRequest {
  resolve: (value: unknown) => void
  reject: (error: Error) => void
  timeoutId: ReturnType<typeof setTimeout>
}

export interface UseAudioVisualizationWorkerReturn {
  /** Whether the worker is available and ready */
  isWorkerAvailable: boolean

  /** Whether audio processing is currently in progress */
  isProcessing: boolean

  /**
   * Process audio chunk for visualization
   * Returns bar heights, RMS, peak, and dB levels
   */
  processAudioChunk: (
    audioData: ArrayBuffer,
    format: AudioFormat,
    barCount?: number
  ) => Promise<ProcessAudioChunkResponse>

  /**
   * Generate waveform bars from audio data
   */
  generateWaveform: (
    audioData: ArrayBuffer,
    format: AudioFormat,
    barCount: number
  ) => Promise<GenerateWaveformResponse>

  /**
   * Compute FFT for frequency analysis
   */
  computeFFT: (
    audioData: ArrayBuffer,
    format: AudioFormat,
    fftSize?: number,
    frequencyBins?: number
  ) => Promise<ComputeFFTResponse>

  /**
   * Preprocess audio chunk with optional normalization
   */
  preprocessChunk: (
    audioData: ArrayBuffer,
    format: AudioFormat,
    normalize?: boolean,
    removeDCOffset?: boolean
  ) => Promise<PreprocessChunkResponse>
}

// ============================================================================
// Hook Implementation
// ============================================================================

/**
 * Custom hook for managing the Audio Visualization Web Worker
 *
 * Features:
 * - Automatically initializes worker on mount
 * - Falls back to sync processing when worker unavailable
 * - Uses transferable objects for efficient data passing
 * - Handles worker errors and timeouts gracefully
 * - Tracks processing state for loading indicators
 */
export function useAudioVisualizationWorker(): UseAudioVisualizationWorkerReturn {
  const [isWorkerAvailable, setIsWorkerAvailable] = useState(false)
  const [isProcessing, setIsProcessing] = useState(false)

  const workerRef = useRef<Worker | null>(null)
  const pendingRequests = useRef<Map<string, PendingRequest>>(new Map())
  const requestIdCounter = useRef(0)

  // Initialize worker on mount
  useEffect(() => {
    // Check if Web Workers are supported
    if (typeof Worker === 'undefined') {
      console.warn('Web Workers are not supported. Using main-thread audio processing.')
      setIsWorkerAvailable(false)
      return
    }

    try {
      // Create worker using Vite's worker import syntax
      const worker = new Worker(
        new URL('../workers/audioVisualizationWorker.ts', import.meta.url),
        { type: 'module' }
      )

      worker.onmessage = (event: MessageEvent<AudioProcessingResponse | { type: 'ready' }>) => {
        const response = event.data

        // Handle worker ready message
        if (response.type === 'ready') {
          setIsWorkerAvailable(true)
          console.log('[AudioVisualizationWorker] Worker initialized and ready')
          return
        }

        // Handle processing response
        const pending = pendingRequests.current.get(response.requestId)
        if (pending) {
          clearTimeout(pending.timeoutId)
          pendingRequests.current.delete(response.requestId)

          if (response.type === 'error') {
            pending.reject(new Error(response.error))
          } else {
            pending.resolve(response)
          }

          // Update processing state
          if (pendingRequests.current.size === 0) {
            setIsProcessing(false)
          }
        }
      }

      worker.onerror = (error) => {
        console.error('[AudioVisualizationWorker] Worker error:', error)
        // Reject all pending requests
        pendingRequests.current.forEach((pending) => {
          clearTimeout(pending.timeoutId)
          pending.reject(new Error('Worker error occurred'))
        })
        pendingRequests.current.clear()
        setIsProcessing(false)
        setIsWorkerAvailable(false)
      }

      workerRef.current = worker
    } catch (error) {
      console.error('[AudioVisualizationWorker] Failed to initialize worker:', error)
      setIsWorkerAvailable(false)
    }

    // Cleanup on unmount
    return () => {
      if (workerRef.current) {
        // Reject any pending requests
        pendingRequests.current.forEach((pending) => {
          clearTimeout(pending.timeoutId)
          pending.reject(new Error('Worker terminated'))
        })
        pendingRequests.current.clear()

        workerRef.current.terminate()
        workerRef.current = null
      }
    }
  }, [])

  // Helper to generate unique request IDs
  const generateRequestId = useCallback((): string => {
    return `audio-viz-${++requestIdCounter.current}-${Date.now()}`
  }, [])

  // Helper to send request to worker with transferable objects
  const sendWorkerRequest = useCallback(<T>(
    request: AudioProcessingRequest,
    transferables: Transferable[] = []
  ): Promise<T> => {
    return new Promise((resolve, reject) => {
      if (!workerRef.current) {
        reject(new Error('Worker not available'))
        return
      }

      const timeoutId = setTimeout(() => {
        pendingRequests.current.delete(request.requestId)
        if (pendingRequests.current.size === 0) {
          setIsProcessing(false)
        }
        reject(new Error('Worker request timed out'))
      }, WORKER_TIMEOUT)

      pendingRequests.current.set(request.requestId, {
        resolve: resolve as (value: unknown) => void,
        reject,
        timeoutId
      })

      setIsProcessing(true)
      workerRef.current.postMessage(request, transferables)
    })
  }, [])

  // Process audio chunk for visualization
  const processAudioChunk = useCallback(async (
    audioData: ArrayBuffer,
    format: AudioFormat,
    barCount: number = 28
  ): Promise<ProcessAudioChunkResponse> => {
    // Use sync processing for small chunks or when worker unavailable
    if (!isWorkerAvailable || audioData.byteLength < MIN_CHUNK_SIZE_FOR_WORKER) {
      const startTime = performance.now()
      const result = processAudioChunkSync(audioData, barCount)
      return {
        type: 'processAudioChunk',
        requestId: 'sync',
        ...result,
        duration: performance.now() - startTime
      }
    }

    try {
      // Create a copy of the audio data for transfer
      const audioDataCopy = audioData.slice(0)
      const requestId = generateRequestId()

      return await sendWorkerRequest<ProcessAudioChunkResponse>(
        {
          type: 'processAudioChunk',
          requestId,
          audioData: audioDataCopy,
          format,
          barCount
        },
        [audioDataCopy] // Transfer ownership for efficiency
      )
    } catch (error) {
      console.warn('[AudioVisualizationWorker] Worker processing failed, falling back to sync:', error)
      const startTime = performance.now()
      const result = processAudioChunkSync(audioData, barCount)
      return {
        type: 'processAudioChunk',
        requestId: 'sync-fallback',
        ...result,
        duration: performance.now() - startTime
      }
    }
  }, [isWorkerAvailable, generateRequestId, sendWorkerRequest])

  // Generate waveform bars
  const generateWaveform = useCallback(async (
    audioData: ArrayBuffer,
    format: AudioFormat,
    barCount: number
  ): Promise<GenerateWaveformResponse> => {
    // Use sync processing when worker unavailable
    if (!isWorkerAvailable || audioData.byteLength < MIN_CHUNK_SIZE_FOR_WORKER) {
      const startTime = performance.now()
      const samples = pcm16ToFloat32Sync(audioData)
      const result = generateWaveformBarsSync(samples, barCount)
      return {
        type: 'generateWaveform',
        requestId: 'sync',
        ...result,
        duration: performance.now() - startTime
      }
    }

    try {
      const audioDataCopy = audioData.slice(0)
      const requestId = generateRequestId()

      return await sendWorkerRequest<GenerateWaveformResponse>(
        {
          type: 'generateWaveform',
          requestId,
          audioData: audioDataCopy,
          format,
          barCount
        },
        [audioDataCopy]
      )
    } catch (error) {
      console.warn('[AudioVisualizationWorker] Worker waveform generation failed, falling back to sync:', error)
      const startTime = performance.now()
      const samples = pcm16ToFloat32Sync(audioData)
      const result = generateWaveformBarsSync(samples, barCount)
      return {
        type: 'generateWaveform',
        requestId: 'sync-fallback',
        ...result,
        duration: performance.now() - startTime
      }
    }
  }, [isWorkerAvailable, generateRequestId, sendWorkerRequest])

  // Compute FFT for frequency analysis
  const computeFFT = useCallback(async (
    audioData: ArrayBuffer,
    format: AudioFormat,
    fftSize: number = 2048,
    frequencyBins: number = 64
  ): Promise<ComputeFFTResponse> => {
    // FFT is complex, always prefer worker if available
    if (!isWorkerAvailable) {
      // Return empty result as FFT fallback would be too expensive
      console.warn('[AudioVisualizationWorker] FFT not available without worker')
      return {
        type: 'computeFFT',
        requestId: 'sync-unavailable',
        magnitudes: new Array(frequencyBins).fill(0),
        frequencies: new Array(frequencyBins).fill(0),
        dominantFrequency: 0,
        duration: 0
      }
    }

    try {
      const audioDataCopy = audioData.slice(0)
      const requestId = generateRequestId()

      return await sendWorkerRequest<ComputeFFTResponse>(
        {
          type: 'computeFFT',
          requestId,
          audioData: audioDataCopy,
          format,
          fftSize,
          frequencyBins
        },
        [audioDataCopy]
      )
    } catch (error) {
      console.warn('[AudioVisualizationWorker] FFT computation failed:', error)
      return {
        type: 'computeFFT',
        requestId: 'error',
        magnitudes: new Array(frequencyBins).fill(0),
        frequencies: new Array(frequencyBins).fill(0),
        dominantFrequency: 0,
        duration: 0
      }
    }
  }, [isWorkerAvailable, generateRequestId, sendWorkerRequest])

  // Preprocess audio chunk
  const preprocessChunk = useCallback(async (
    audioData: ArrayBuffer,
    format: AudioFormat,
    normalize: boolean = false,
    removeDCOffset: boolean = true
  ): Promise<PreprocessChunkResponse> => {
    // Preprocessing should use worker when available
    if (!isWorkerAvailable) {
      // Simple fallback - just calculate metrics without processing
      const startTime = performance.now()
      const samples = pcm16ToFloat32Sync(audioData)
      const rmsLevel = calculateRMSSync(samples)
      const peakLevel = calculatePeakSync(samples)

      return {
        type: 'preprocessChunk',
        requestId: 'sync-fallback',
        processedData: audioData.slice(0), // Return a copy
        rmsLevel,
        peakLevel,
        hasClipping: peakLevel >= 0.99,
        dcOffset: 0,
        duration: performance.now() - startTime
      }
    }

    try {
      const audioDataCopy = audioData.slice(0)
      const requestId = generateRequestId()

      return await sendWorkerRequest<PreprocessChunkResponse>(
        {
          type: 'preprocessChunk',
          requestId,
          audioData: audioDataCopy,
          format,
          normalize,
          removeDCOffset
        },
        [audioDataCopy]
      )
    } catch (error) {
      console.warn('[AudioVisualizationWorker] Preprocessing failed:', error)
      const startTime = performance.now()
      const samples = pcm16ToFloat32Sync(audioData)
      const rmsLevel = calculateRMSSync(samples)
      const peakLevel = calculatePeakSync(samples)

      return {
        type: 'preprocessChunk',
        requestId: 'error-fallback',
        processedData: audioData.slice(0),
        rmsLevel,
        peakLevel,
        hasClipping: peakLevel >= 0.99,
        dcOffset: 0,
        duration: performance.now() - startTime
      }
    }
  }, [isWorkerAvailable, generateRequestId, sendWorkerRequest])

  return {
    isWorkerAvailable,
    isProcessing,
    processAudioChunk,
    generateWaveform,
    computeFFT,
    preprocessChunk
  }
}

export default useAudioVisualizationWorker
