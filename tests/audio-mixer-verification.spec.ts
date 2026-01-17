/**
 * AudioMixer Verification Test
 * 
 * Temporary test to verify AudioMixer functionality.
 * This test will be deleted after verification.
 */

import { test, expect } from '@playwright/test'
import { Readable } from 'stream'
import * as fs from 'fs'
import * as path from 'path'
import { AudioMixer } from '../electron/services/audioMixer'

test.describe('AudioMixer Verification', () => {
  test('should combine microphone and system audio streams in real-time', async () => {
    // Create a temporary output file
    const outputDir = path.join(__dirname, '../test-output')
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true })
    }
    const outputPath = path.join(outputDir, 'test-mixed-audio.wav')

    // Clean up any existing file
    if (fs.existsSync(outputPath)) {
      fs.unlinkSync(outputPath)
    }

    // Create AudioMixer instance
    const mixer = new AudioMixer({
      sampleRate: 16000,
      channels: 1,
      bitDepth: 16,
      outputPath
    })

    // Create mock audio streams
    const microphoneStream = new Readable({
      read() {
        // Generate test audio data (sine wave pattern)
        const samples = 1600 // 0.1 seconds at 16kHz
        const buffer = Buffer.allocUnsafe(samples * 2) // 16-bit samples
        
        for (let i = 0; i < samples; i++) {
          // Generate a simple sine wave
          const value = Math.sin((i / samples) * Math.PI * 2) * 10000
          buffer.writeInt16LE(Math.round(value), i * 2)
        }
        
        this.push(buffer)
      }
    })

    const systemAudioStream = new Readable({
      read() {
        // Generate different test audio data
        const samples = 1600 // 0.1 seconds at 16kHz
        const buffer = Buffer.allocUnsafe(samples * 2) // 16-bit samples
        
        for (let i = 0; i < samples; i++) {
          // Generate a different sine wave pattern
          const value = Math.sin((i / samples) * Math.PI * 4) * 8000
          buffer.writeInt16LE(Math.round(value), i * 2)
        }
        
        this.push(buffer)
      }
    })

    // Start mixing
    await mixer.start(microphoneStream, systemAudioStream)

    // Let streams run for a short time
    await new Promise(resolve => setTimeout(resolve, 500))

    // Stop the streams
    microphoneStream.push(null) // End stream
    systemAudioStream.push(null) // End stream

    // Stop mixing and get output path
    const resultPath = await mixer.stop()

    // Verify output file exists
    expect(fs.existsSync(resultPath)).toBe(true)
    expect(resultPath).toBe(outputPath)

    // Verify file has content
    const stats = fs.statSync(resultPath)
    expect(stats.size).toBeGreaterThan(0)

    // Verify state
    const state = mixer.getState()
    expect(state.isMixing).toBe(false)
    expect(state.samplesProcessed).toBeGreaterThan(0)

    // Clean up
    if (fs.existsSync(outputPath)) {
      fs.unlinkSync(outputPath)
    }
  })

  test('should handle buffer synchronization correctly', async () => {
    const outputDir = path.join(__dirname, '../test-output')
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true })
    }
    const outputPath = path.join(outputDir, 'test-sync-audio.wav')

    if (fs.existsSync(outputPath)) {
      fs.unlinkSync(outputPath)
    }

    const mixer = new AudioMixer({
      sampleRate: 16000,
      channels: 1,
      bitDepth: 16,
      outputPath
    })

    // Create streams with different buffer sizes to test synchronization
    let micChunkCount = 0
    const microphoneStream = new Readable({
      read() {
        if (micChunkCount++ >= 5) {
          this.push(null)
          return
        }
        // Send larger chunks
        const samples = 3200
        const buffer = Buffer.allocUnsafe(samples * 2)
        for (let i = 0; i < samples; i++) {
          buffer.writeInt16LE(Math.sin(i * 0.1) * 10000, i * 2)
        }
        this.push(buffer)
      }
    })

    let systemChunkCount = 0
    const systemAudioStream = new Readable({
      read() {
        if (systemChunkCount++ >= 10) {
          this.push(null)
          return
        }
        // Send smaller chunks (different rate)
        const samples = 1600
        const buffer = Buffer.allocUnsafe(samples * 2)
        for (let i = 0; i < samples; i++) {
          buffer.writeInt16LE(Math.cos(i * 0.1) * 8000, i * 2)
        }
        this.push(buffer)
      }
    })

    await mixer.start(microphoneStream, systemAudioStream)
    
    // Wait for streams to finish
    await new Promise(resolve => setTimeout(resolve, 1000))

    const resultPath = await mixer.stop()

    expect(fs.existsSync(resultPath)).toBe(true)
    const stats = fs.statSync(resultPath)
    expect(stats.size).toBeGreaterThan(0)

    // Clean up
    if (fs.existsSync(outputPath)) {
      fs.unlinkSync(outputPath)
    }
  })

  test('should emit mixed audio chunks via onMixedChunk callback for live transcription', async () => {
    const outputDir = path.join(__dirname, '../test-output')
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true })
    }
    const outputPath = path.join(outputDir, 'test-callback-audio.wav')

    if (fs.existsSync(outputPath)) {
      fs.unlinkSync(outputPath)
    }

    // Track chunks received through callback
    const receivedChunks: { chunk: Buffer, sampleRate: number, channels: number, bitDepth: number }[] = []

    const mixer = new AudioMixer({
      sampleRate: 16000,
      channels: 1,
      bitDepth: 16,
      outputPath,
      // Provide callback for receiving mixed audio chunks
      onMixedChunk: (chunk, sampleRate, channels, bitDepth) => {
        receivedChunks.push({ chunk, sampleRate, channels, bitDepth })
      }
    })

    // Create mock audio streams
    let micChunkCount = 0
    const microphoneStream = new Readable({
      read() {
        if (micChunkCount++ >= 5) {
          this.push(null)
          return
        }
        const samples = 1600
        const buffer = Buffer.allocUnsafe(samples * 2)
        for (let i = 0; i < samples; i++) {
          buffer.writeInt16LE(Math.sin(i * 0.1) * 10000, i * 2)
        }
        this.push(buffer)
      }
    })

    let systemChunkCount = 0
    const systemAudioStream = new Readable({
      read() {
        if (systemChunkCount++ >= 5) {
          this.push(null)
          return
        }
        const samples = 1600
        const buffer = Buffer.allocUnsafe(samples * 2)
        for (let i = 0; i < samples; i++) {
          buffer.writeInt16LE(Math.cos(i * 0.1) * 8000, i * 2)
        }
        this.push(buffer)
      }
    })

    await mixer.start(microphoneStream, systemAudioStream)

    // Wait for streams to finish
    await new Promise(resolve => setTimeout(resolve, 1000))

    await mixer.stop()

    // Verify that chunks were emitted through the callback
    expect(receivedChunks.length).toBeGreaterThan(0)

    // Verify chunk properties
    for (const received of receivedChunks) {
      expect(received.sampleRate).toBe(16000)
      expect(received.channels).toBe(1)
      expect(received.bitDepth).toBe(16)
      expect(received.chunk.length).toBeGreaterThan(0)
    }

    console.log(`[Test] Received ${receivedChunks.length} chunks via onMixedChunk callback`)
    const totalBytes = receivedChunks.reduce((sum, c) => sum + c.chunk.length, 0)
    console.log(`[Test] Total bytes received: ${totalBytes}`)

    // Clean up
    if (fs.existsSync(outputPath)) {
      fs.unlinkSync(outputPath)
    }
  })
})
