/**
 * Audio Recorder Service
 *
 * Handles microphone recording using node-record-lpcm16
 * Captures audio at 16kHz mono and saves to WAV format
 *
 * REAL-TIME TRANSCRIPTION: Uses RealTimeWavWriter to flush audio data
 * to disk immediately after each chunk, enabling transcription services
 * to read from the file while recording is still in progress.
 */

import { app } from "electron";
import * as path from "path";
import * as fs from "fs";
import { exec, spawn, ChildProcess } from "child_process";
import { promisify } from "util";
import { EventEmitter } from "events";
import record from "node-record-lpcm16";
import { settingsService } from "./settingsService";
import { meetingService } from "./meetingService";
import { recordingService } from "./recordingService";
import { getDatabaseService } from "./database";
import { AudioMixer } from "./audioMixer";
import { RealTimeWavWriter } from "./realTimeWavWriter";
import { Readable } from "stream";
import { binaryManager } from "./binaryManager";

const execAsync = promisify(exec);

// Custom sox process for direct device control on macOS
let customSoxProcess: ChildProcess | null = null;
// Secondary sox process for system audio (virtual cable) when dual-source recording
let systemAudioSoxProcess: ChildProcess | null = null;
// Audio mixer for combining microphone and system audio streams
let audioMixer: AudioMixer | null = null;

// ============================================================================
// Types
// ============================================================================

export type RecordingStatus = "idle" | "recording" | "paused" | "stopping";

export interface RecordingState {
  status: RecordingStatus;
  meetingId: string | null;
  startTime: number | null;
  duration: number;
  audioFilePath: string | null;
}

export interface AudioLevelData {
  level: number; // 0-100 RMS level
  peak: number; // 0-100 peak level
  timestamp: number;
}

export interface AudioHealthData {
  status: 'healthy' | 'warning' | 'error';
  message: string;
  code?: string;
  lastDataReceivedMs: number;
  totalBytesReceived: number;
  timestamp: number;
}

export interface StartRecordingResult {
  success: boolean;
  meetingId: string | null;
  startTime: number;
  audioFilePath: string;
  deviceUsed?: string;
  warning?: string;
  sampleRateUsed?: number; // Actual sample rate used for recording (may differ from configured)
  sampleRateConfigured?: number; // Sample rate that was configured in settings
}

export interface StopRecordingResult {
  success: boolean;
  meetingId: string | null;
  duration: number;
  audioFilePath: string | null;
  error?: string; // Error message if success is false
}

export interface PauseRecordingResult {
  success: boolean;
  duration: number;
}

export interface ResumeRecordingResult {
  success: boolean;
  startTime: number;
}

// ============================================================================
// Audio Recorder State
// ============================================================================

let recordingState: RecordingState = {
  status: "idle",
  meetingId: null,
  startTime: null,
  duration: 0,
  audioFilePath: null,
};

// Active recording objects
let recordingProcess: ReturnType<typeof record.record> | null = null;
let wavWriter: RealTimeWavWriter | null = null;
let pausedDuration: number = 0;
let activeAudioStream: NodeJS.ReadableStream | null = null;
let audioLevelHandler: ((chunk: Buffer) => void) | null = null;
let streamErrorHandler: ((err: Error) => void) | null = null;
let lastAudioLevelEmit = 0;

// Audio health monitoring
let audioHealthCheckInterval: NodeJS.Timeout | null = null;
let lastAudioDataTime = 0;
let totalAudioBytesReceived = 0;

const AUDIO_LEVEL_EVENT = "audio-level";
const AUDIO_HEALTH_EVENT = "audio-health";
const AUDIO_CHUNK_EVENT = "audio-chunk";
const SYSTEM_AUDIO_CHUNK_EVENT = "system-audio-chunk";
const audioLevelEmitter = new EventEmitter();

// Live transcription audio streaming
// Allows live transcription service to subscribe to audio chunks during recording
const audioChunkEmitter = new EventEmitter();
audioChunkEmitter.setMaxListeners(20); // Allow multiple subscribers

// System audio chunk emitter (for transcribing computer audio like meeting participants)
// This is separate from the main audio chunk emitter to allow independent processing
const systemAudioChunkEmitter = new EventEmitter();
systemAudioChunkEmitter.setMaxListeners(20); // Allow multiple subscribers

// Constants for audio health monitoring
const AUDIO_HEALTH_CHECK_INTERVAL_MS = 5000; // Check every 5 seconds
const NO_AUDIO_DATA_WARNING_THRESHOLD_MS = 10000; // Warn if no data for 10 seconds

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Get the recordings directory path from settings or use default
 */
function getRecordingsDir(): string {
  // Try to get custom path from settings
  let recordingsDir = settingsService.get<string>("storage.recordingsPath");

  // If not set, use default path
  if (!recordingsDir) {
    const userDataPath = app.getPath("userData");
    recordingsDir = path.join(userDataPath, "recordings");

    // Save default path to settings for future use
    try {
      settingsService.set("storage.recordingsPath", recordingsDir, "storage");
    } catch (err) {
      console.warn("Failed to save default recordings path to settings:", err);
    }
  }

  // Ensure directory exists
  if (!fs.existsSync(recordingsDir)) {
    fs.mkdirSync(recordingsDir, { recursive: true });
  }

  return recordingsDir;
}

/**
 * Sanitize a string to be safe for use as a folder name
 * Removes or replaces invalid characters and limits length
 */
function sanitizeFolderName(name: string, maxLength: number = 100): string {
  // Replace invalid characters with hyphens
  let sanitized = name
    .replace(/[<>:"/\\|?*\x00-\x1F]/g, "-") // Replace invalid filesystem characters
    .replace(/\s+/g, "-") // Replace spaces with hyphens
    .replace(/-+/g, "-") // Replace multiple hyphens with single hyphen
    .replace(/^-+|-+$/g, ""); // Remove leading/trailing hyphens

  // Truncate if too long
  if (sanitized.length > maxLength) {
    sanitized = sanitized.substring(0, maxLength);
  }

  // Ensure it's not empty
  if (!sanitized || sanitized.trim().length === 0) {
    sanitized = "untitled";
  }

  return sanitized;
}

/**
 * Get or create a meeting-specific folder for recordings
 * Returns the folder path for the meeting, or null if meetingId is invalid
 * Handles edge cases: invalid meeting IDs, long titles, special characters
 */
function getMeetingFolder(meetingId: string | null): string | null {
  if (!meetingId) {
    return null;
  }

  const recordingsDir = getRecordingsDir();

  try {
    // Try to get meeting info to create a descriptive folder name
    const meeting = meetingService.getById(meetingId);
    let folderName: string;

    if (meeting && meeting.title) {
      // Use meeting ID as primary identifier, with sanitized title as suffix for readability
      // This ensures uniqueness while providing human-readable context
      const sanitizedTitle = sanitizeFolderName(meeting.title, 50);
      folderName = `${meetingId}-${sanitizedTitle}`;
    } else {
      // Fallback to just meeting ID if meeting not found or has no title
      folderName = meetingId;
    }

    // Additional safety: ensure folder name doesn't exceed filesystem limits
    // Most filesystems support 255 characters per path component, but we'll be conservative
    const MAX_FOLDER_NAME_LENGTH = 200;
    if (folderName.length > MAX_FOLDER_NAME_LENGTH) {
      // Truncate while preserving the meeting ID prefix
      const idLength = meetingId.length;
      const availableLength = MAX_FOLDER_NAME_LENGTH - idLength - 1; // -1 for hyphen
      if (availableLength > 0 && meeting && meeting.title) {
        const truncatedTitle = sanitizeFolderName(meeting.title, availableLength);
        folderName = `${meetingId}-${truncatedTitle}`;
      } else {
        folderName = meetingId; // Just use ID if we can't fit title
      }
    }

    const meetingFolder = path.join(recordingsDir, folderName);

    // Ensure folder exists
    if (!fs.existsSync(meetingFolder)) {
      try {
        fs.mkdirSync(meetingFolder, { recursive: true });
      } catch (mkdirError) {
        console.error(`Failed to create meeting folder ${meetingFolder}:`, mkdirError);
        // Try fallback with just meeting ID
        const fallbackFolder = path.join(recordingsDir, meetingId);
        if (!fs.existsSync(fallbackFolder)) {
          try {
            fs.mkdirSync(fallbackFolder, { recursive: true });
          } catch (fallbackError) {
            console.error(`Failed to create fallback folder for ${meetingId}:`, fallbackError);
            return null;
          }
        }
        return fallbackFolder;
      }
    }

    return meetingFolder;
  } catch (error) {
    console.warn(`Failed to get/create meeting folder for ${meetingId}:`, error);
    // Fallback to meeting ID only
    const fallbackFolder = path.join(recordingsDir, meetingId);
    if (!fs.existsSync(fallbackFolder)) {
      try {
        fs.mkdirSync(fallbackFolder, { recursive: true });
      } catch (mkdirError) {
        console.error(`Failed to create fallback folder for ${meetingId}:`, mkdirError);
        return null;
      }
    }
    return fallbackFolder;
  }
}

/**
 * Generate a unique filename for the recording
 */
function generateRecordingFilename(meetingId: string | null): string {
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  return `recording-${timestamp}.wav`;
}

/**
 * Get audio settings from database
 */
function getAudioSettings(): {
  sampleRate: number;
  inputDevice: string;
  outputDevice: string;
  dualSourceEnabled: boolean;
} {
  const sampleRate = settingsService.getOrDefault<number>(
    "audio.sampleRate",
    16000
  );
  const inputDevice = settingsService.getOrDefault<string>(
    "audio.inputDevice",
    "default"
  );
  // Get output device - this is the virtual cable device (e.g., BlackHole) for capturing system audio
  // The user sets this as "Output Device" in the UI, which routes system audio through the virtual cable
  const outputDevice = settingsService.getOrDefault<string>(
    "audio.outputDevice",
    "default"
  );
  // Check if dual source recording is explicitly enabled, or auto-detect based on output device
  // If an output device is set (not "default"), assume user wants dual source recording
  const dualSourceExplicit = settingsService.getOrDefault<boolean>(
    "audio.dualSourceEnabled",
    false
  );
  const dualSourceEnabled = dualSourceExplicit || (outputDevice !== "default" && outputDevice !== "");

  return { sampleRate, inputDevice, outputDevice, dualSourceEnabled };
}

/**
 * Detect the actual sample rate of an audio device
 * Returns the detected sample rate, or null if detection fails
 * 
 * This is critical for fixing playback speed issues with BlackHole and aggregate devices
 * where the device's native sample rate may differ from the configured rate.
 */
async function detectDeviceSampleRate(deviceName: string | null): Promise<number | null> {
  const platform = process.platform;

  if (!deviceName) {
    // For system default, we can't easily detect, so return null
    return null;
  }

  try {
    if (platform === "darwin") {
      // On macOS, try multiple methods to detect sample rate
      const deviceLower = deviceName.toLowerCase();
      const isVirtualDevice = deviceLower.includes("blackhole") || 
                              deviceLower.includes("aggregate") || 
                              deviceLower.includes("multi-output") ||
                              deviceLower.includes("soundflower");
      
      // Method 1: Try using ffprobe to query device (if available)
      try {
        const { stdout } = await execAsync(
          `ffprobe -f avfoundation -list_devices true -i "" 2>&1 | grep -i "${deviceName}" || true`,
          { timeout: 5000 }
        );
        // Note: ffprobe device listing doesn't include sample rate directly
        // We'll need a different approach
      } catch {
        // ffprobe not available or failed
      }

      // Method 2: For virtual/aggregate devices, try to detect the actual sample rate
      // On macOS, aggregate devices and BlackHole typically run at 48kHz, but we should verify
      if (isVirtualDevice) {
        try {
          // Try to query the device's actual sample rate using sox
          // We can use sox to record a very short sample and check the rate
          // But a simpler approach: try to get sample rate from system_profiler or sox
          
          // First, try using sox to query the device properties
          // Note: sox doesn't directly report sample rate, but we can try recording a test sample
          // For now, we'll use a more reliable method: check Audio MIDI Setup or use sox with rate detection
          
          // Try to record a 0.1 second test sample and check its properties
          const testFile = path.join(app.getPath("temp"), `sample_rate_test_${Date.now()}.wav`);
          try {
            // Use sox to record a tiny sample - sox will use the device's native rate
            const { stdout, stderr } = await execAsync(
              `sox -t coreaudio "${deviceName}" -r 48000 -c 1 -b 16 "${testFile}" trim 0 0.1 2>&1 || true`,
              { timeout: 3000 }
            );
            
            // Check if the file was created and get its sample rate using soxi
            if (fs.existsSync(testFile)) {
              try {
                const { stdout: soxiOutput } = await execAsync(
                  `soxi -r "${testFile}" 2>&1 || echo "0"`,
                  { timeout: 2000 }
                );
                const detectedRate = parseInt(soxiOutput.trim(), 10);
                if (detectedRate > 0 && [44100, 48000, 88200, 96000].includes(detectedRate)) {
                  console.log(`Detected sample rate for device "${deviceName}": ${detectedRate}Hz`);
                  // Clean up test file
                  try { fs.unlinkSync(testFile); } catch {}
                  return detectedRate;
                }
              } catch {
                // soxi failed, continue with default
              }
              // Clean up test file
              try { fs.unlinkSync(testFile); } catch {}
            }
          } catch {
            // Test recording failed, use default
          }
          
          // Default to 48kHz for virtual/aggregate devices (most common on macOS)
          console.log(`Using default 48kHz for virtual/aggregate device "${deviceName}" (could not detect actual rate).`);
          return 48000;
        } catch (error) {
          console.warn(`Failed to detect sample rate for virtual device "${deviceName}":`, error);
          // Fall back to 48kHz for virtual devices (most common default)
          return 48000;
        }
      }

      // Method 3: For regular devices, try querying Core Audio properties
      // This would require native code or a more complex approach
      // For now, return null and let the configured rate be used
      return null;
      
    } else if (platform === "linux") {
      // On Linux, try to get sample rate from PulseAudio
      try {
        // Get detailed source information
        const { stdout } = await execAsync(
          `pactl list sources | grep -A 15 "Name:.*${deviceName}" | grep "Sample Specification" || true`,
          { timeout: 5000 }
        );
        if (stdout) {
          // Parse sample rate from output like "Sample Specification: s16le 2ch 48000Hz"
          const match = stdout.match(/(\d+)Hz/);
          if (match && match[1]) {
            const rate = parseInt(match[1], 10);
            console.log(`Detected sample rate for device "${deviceName}": ${rate}Hz`);
            return rate;
          }
        }
      } catch (error) {
        console.warn(`Failed to query PulseAudio for device "${deviceName}":`, error);
      }
      
      // Try ALSA as fallback
      try {
        const { stdout } = await execAsync(
          `arecord -D "${deviceName}" --dump-hw-params 2>&1 | grep "RATE" || true`,
          { timeout: 5000 }
        );
        if (stdout) {
          // Parse rate range like "RATE: 48000"
          const match = stdout.match(/RATE:\s*(\d+)/);
          if (match && match[1]) {
            const rate = parseInt(match[1], 10);
            console.log(`Detected sample rate for device "${deviceName}" via ALSA: ${rate}Hz`);
            return rate;
          }
        }
      } catch {
        // ALSA query failed
      }
      
      return null;
    } else if (platform === "win32") {
      // On Windows, sample rate detection is complex
      // Would need to use Windows Audio Session API (WASAPI) or similar
      // For now, return null and use configured rate
      return null;
    }
  } catch (error) {
    console.warn(`Error detecting sample rate for device "${deviceName}":`, error);
  }

  return null;
}

/**
 * Validate and resolve the input device to use for recording
 * Returns the device name to use, or null if using system default
 */
async function resolveInputDevice(
  configuredDevice: string
): Promise<{ device: string | null; warning?: string }> {
  // If set to "default", use system default (don't specify device)
  if (!configuredDevice || configuredDevice === "default") {
    return { device: null };
  }

  const platform = process.platform;

  try {
    // Validate the device exists on the system
    if (platform === "darwin") {
      // On macOS, check if the device exists using system_profiler
      const { stdout } = await execAsync(
        'system_profiler SPAudioDataType -json',
        { timeout: 10000 }
      );
      const data = JSON.parse(stdout);
      const audioData = data?.SPAudioDataType || [];

      let deviceFound = false;
      for (const section of audioData) {
        const items = section?._items || [];
        for (const item of items) {
          if (item?._name === configuredDevice || item?._name?.toLowerCase() === configuredDevice.toLowerCase()) {
            deviceFound = true;
            break;
          }
        }
        if (deviceFound) break;
      }

      if (!deviceFound) {
        return {
          device: null,
          warning: `Configured audio device "${configuredDevice}" not found. Using system default. The device may have been disconnected.`
        };
      }

      return { device: configuredDevice };
    } else if (platform === "linux") {
      // On Linux, check PulseAudio/ALSA sources
      try {
        const { stdout } = await execAsync(
          'pactl list sources short 2>/dev/null',
          { timeout: 5000 }
        );
        const sources = stdout.split('\n').filter(l => l.trim());
        const deviceFound = sources.some(line => {
          const parts = line.split('\t');
          return parts[0] === configuredDevice || parts[1]?.includes(configuredDevice);
        });

        if (!deviceFound) {
          // Also check ALSA devices
          try {
            const { stdout: alsaOutput } = await execAsync(
              'arecord -l 2>/dev/null',
              { timeout: 5000 }
            );
            if (!alsaOutput.toLowerCase().includes(configuredDevice.toLowerCase())) {
              return {
                device: null,
                warning: `Configured audio device "${configuredDevice}" not found. Using system default.`
              };
            }
          } catch {
            // ALSA check failed, but device might still work
          }
        }

        return { device: configuredDevice };
      } catch {
        // PulseAudio check failed, try using the device anyway
        return { device: configuredDevice };
      }
    } else if (platform === "win32") {
      // On Windows, check using PowerShell
      try {
        const { stdout } = await execAsync(
          'powershell -Command "Get-WmiObject Win32_SoundDevice | Select-Object Name, DeviceID | ConvertTo-Json"',
          { timeout: 10000 }
        );
        const devices = JSON.parse(stdout || '[]');
        const deviceList = Array.isArray(devices) ? devices : [devices];
        const deviceFound = deviceList.some(d =>
          d?.Name === configuredDevice ||
          d?.DeviceID === configuredDevice ||
          d?.Name?.toLowerCase() === configuredDevice.toLowerCase()
        );

        if (!deviceFound) {
          return {
            device: null,
            warning: `Configured audio device "${configuredDevice}" not found. Using system default.`
          };
        }

        return { device: configuredDevice };
      } catch {
        // PowerShell check failed, try using the device anyway
        return { device: configuredDevice };
      }
    }

    // For unknown platforms, try to use the configured device
    return { device: configuredDevice };
  } catch (error) {
    console.warn("Error validating input device:", error);
    // On error, fall back to system default
    return {
      device: null,
      warning: `Could not validate audio device "${configuredDevice}". Using system default.`
    };
  }
}

/**
 * Read sample rate from a WAV file header
 * Returns the sample rate in Hz, or null if the file can't be read or is invalid
 */
function readWavFileSampleRate(filePath: string): number | null {
  try {
    if (!fs.existsSync(filePath)) {
      return null;
    }

    const buffer = fs.readFileSync(filePath, { start: 0, end: 44 });
    if (buffer.length < 44) {
      return null;
    }

    // Check WAV header signature
    const riff = buffer.toString('ascii', 0, 4);
    const wave = buffer.toString('ascii', 8, 12);
    if (riff !== 'RIFF' || wave !== 'WAVE') {
      return null;
    }

    // Sample rate is at offset 24 (little-endian 32-bit integer)
    const sampleRate = buffer.readUInt32LE(24);
    return sampleRate > 0 && sampleRate <= 192000 ? sampleRate : null;
  } catch (error) {
    console.warn(`Failed to read WAV file sample rate from ${filePath}:`, error);
    return null;
  }
}

/**
 * Calculate RMS/peak levels from a PCM16 buffer
 */
function calculateAudioLevels(chunk: Buffer): { level: number; peak: number } {
  if (!chunk || chunk.length < 2) {
    return { level: 0, peak: 0 };
  }

  const sampleCount = Math.floor(chunk.length / 2);
  if (sampleCount === 0) {
    return { level: 0, peak: 0 };
  }

  let sumSquares = 0;
  let peak = 0;

  for (let i = 0; i < sampleCount; i++) {
    const sample = chunk.readInt16LE(i * 2);
    const normalized = sample / 32768;
    sumSquares += normalized * normalized;
    peak = Math.max(peak, Math.abs(normalized));
  }

  const rms = Math.sqrt(sumSquares / sampleCount);

  return {
    level: Math.min(1, rms) * 100,
    peak: Math.min(1, peak) * 100,
  };
}

/**
 * Emit the latest audio level to listeners and renderer
 */
function emitAudioLevel(level: number, peak: number) {
  const payload: AudioLevelData = {
    level: Math.max(0, Math.min(100, Number.isFinite(level) ? level : 0)),
    peak: Math.max(0, Math.min(100, Number.isFinite(peak) ? peak : 0)),
    timestamp: Date.now(),
  };
  audioLevelEmitter.emit(AUDIO_LEVEL_EVENT, payload);
}

/**
 * Emit audio health status to listeners
 */
function emitAudioHealth(status: AudioHealthData['status'], message: string, code?: string) {
  const payload: AudioHealthData = {
    status,
    message,
    code,
    lastDataReceivedMs: lastAudioDataTime > 0 ? Date.now() - lastAudioDataTime : 0,
    totalBytesReceived: totalAudioBytesReceived,
    timestamp: Date.now(),
  };
  audioLevelEmitter.emit(AUDIO_HEALTH_EVENT, payload);
}

/**
 * Emit an audio chunk for live transcription
 * This is called for every chunk of audio data received during recording
 */
function emitAudioChunk(chunk: Buffer, sampleRate: number, channels: number, bitDepth: number) {
  audioChunkEmitter.emit(AUDIO_CHUNK_EVENT, {
    data: chunk,
    sampleRate,
    channels,
    bitDepth,
    timestamp: Date.now(),
  });
}

/**
 * Emit a system audio chunk for live transcription
 * This is called for every chunk of system audio (computer output) received during dual-source recording
 * System audio typically contains remote participants' voices in meetings/calls
 */
function emitSystemAudioChunk(chunk: Buffer, sampleRate: number, channels: number, bitDepth: number) {
  systemAudioChunkEmitter.emit(SYSTEM_AUDIO_CHUNK_EVENT, {
    data: chunk,
    sampleRate,
    channels,
    bitDepth,
    timestamp: Date.now(),
    isSystemAudio: true, // Flag to indicate this is system audio (may need different VAD handling)
  });
}

/**
 * Start audio health monitoring
 * Periodically checks if audio data is being received and emits warnings if not
 */
function startAudioHealthMonitoring(): void {
  // Reset tracking variables
  lastAudioDataTime = Date.now();
  totalAudioBytesReceived = 0;

  // Clear any existing interval
  if (audioHealthCheckInterval) {
    clearInterval(audioHealthCheckInterval);
  }

  audioHealthCheckInterval = setInterval(() => {
    // Only check if we're actively recording
    if (recordingState.status !== 'recording') {
      return;
    }

    const now = Date.now();
    const timeSinceLastData = now - lastAudioDataTime;

    if (totalAudioBytesReceived === 0 && timeSinceLastData > NO_AUDIO_DATA_WARNING_THRESHOLD_MS) {
      // No audio data received at all after threshold
      console.warn(`[Audio Health] No audio data received after ${(timeSinceLastData / 1000).toFixed(1)} seconds`);
      emitAudioHealth(
        'error',
        `No audio data detected after ${Math.round(timeSinceLastData / 1000)} seconds. Check your microphone settings.`,
        'NO_AUDIO_DATA'
      );
    } else if (timeSinceLastData > NO_AUDIO_DATA_WARNING_THRESHOLD_MS) {
      // Had data before but now stopped receiving
      console.warn(`[Audio Health] Audio data stopped flowing. Last data received ${(timeSinceLastData / 1000).toFixed(1)} seconds ago`);
      emitAudioHealth(
        'warning',
        `Audio data stopped flowing. Last data received ${Math.round(timeSinceLastData / 1000)} seconds ago.`,
        'AUDIO_DATA_INTERRUPTED'
      );
    } else if (totalAudioBytesReceived > 0) {
      // Audio is flowing normally
      emitAudioHealth('healthy', 'Audio data flowing normally');
    }
  }, AUDIO_HEALTH_CHECK_INTERVAL_MS);
}

/**
 * Stop audio health monitoring
 */
function stopAudioHealthMonitoring(): void {
  if (audioHealthCheckInterval) {
    clearInterval(audioHealthCheckInterval);
    audioHealthCheckInterval = null;
  }
  lastAudioDataTime = 0;
  totalAudioBytesReceived = 0;
}

/**
 * Update audio data tracking when data is received
 */
function trackAudioDataReceived(bytesReceived: number): void {
  lastAudioDataTime = Date.now();
  totalAudioBytesReceived += bytesReceived;
}

// ============================================================================
// Stream Format Logging
// ============================================================================

/**
 * Stream format information for logging at capture time
 */
interface StreamFormatInfo {
  streamName: string;           // "Input" or "Output"
  sampleRate: number;           // Sample rate in Hz
  channels: number;             // Number of channels (1=mono, 2=stereo)
  pcmFormat: 'int16' | 'float32'; // PCM sample format
  bitDepth: number;             // Bits per sample (16 for int16, 32 for float32)
  bytesPerSample: number;       // Bytes per sample
  bytesPerFrame: number;        // Bytes per frame (bytesPerSample * channels)
  deviceName?: string;          // Optional device name
}

/**
 * Log stream format information at capture time
 * Outputs detailed format info for debugging and monitoring
 */
function logStreamFormat(format: StreamFormatInfo): void {
  const formatStr = format.pcmFormat === 'int16' ? 'PCM Int16 (signed)' : 'PCM Float32';

  console.log(
    `\n📊 ${format.streamName} Stream Format:`,
    `\n  ├─ Sample Rate: ${format.sampleRate} Hz`,
    `\n  ├─ Channels: ${format.channels} (${format.channels === 1 ? 'mono' : 'stereo'})`,
    `\n  ├─ PCM Format: ${formatStr}`,
    `\n  ├─ Bit Depth: ${format.bitDepth}-bit`,
    `\n  ├─ Bytes/Sample: ${format.bytesPerSample}`,
    `\n  └─ Bytes/Frame: ${format.bytesPerFrame}`,
    format.deviceName ? `\n  └─ Device: ${format.deviceName}` : ''
  );
}

/**
 * Buffer size tracking for stream callbacks
 */
interface BufferSizeTracker {
  streamName: string;
  firstChunkLogged: boolean;
  totalChunks: number;
  totalBytes: number;
  minChunkSize: number;
  maxChunkSize: number;
  lastLogTime: number;
}

// Track buffer sizes for input and output streams
const bufferTrackers: Map<string, BufferSizeTracker> = new Map();

/**
 * Create a buffer size tracker for a stream
 */
function createBufferTracker(streamName: string): BufferSizeTracker {
  const tracker: BufferSizeTracker = {
    streamName,
    firstChunkLogged: false,
    totalChunks: 0,
    totalBytes: 0,
    minChunkSize: Infinity,
    maxChunkSize: 0,
    lastLogTime: Date.now()
  };
  bufferTrackers.set(streamName, tracker);
  return tracker;
}

/**
 * Track buffer size for a stream and log initial buffer info
 */
function trackBufferSize(
  streamName: string,
  chunk: Buffer,
  sampleRate: number,
  channels: number,
  bytesPerSample: number
): void {
  let tracker = bufferTrackers.get(streamName);
  if (!tracker) {
    tracker = createBufferTracker(streamName);
  }

  const chunkSize = chunk.length;
  tracker.totalChunks++;
  tracker.totalBytes += chunkSize;
  tracker.minChunkSize = Math.min(tracker.minChunkSize, chunkSize);
  tracker.maxChunkSize = Math.max(tracker.maxChunkSize, chunkSize);

  // Log the first chunk to show initial buffer size (frames per callback)
  if (!tracker.firstChunkLogged) {
    tracker.firstChunkLogged = true;
    const bytesPerFrame = bytesPerSample * channels;
    const framesPerCallback = Math.floor(chunkSize / bytesPerFrame);
    const durationMs = (framesPerCallback / sampleRate) * 1000;

    console.log(
      `\n📦 ${streamName} Buffer Info (first callback):`,
      `\n  ├─ Buffer Size: ${chunkSize} bytes`,
      `\n  ├─ Frames per Callback: ${framesPerCallback}`,
      `\n  └─ Buffer Duration: ${durationMs.toFixed(2)} ms`
    );
  }
}

/**
 * Log final buffer statistics when stream ends
 */
function logBufferStats(streamName: string): void {
  const tracker = bufferTrackers.get(streamName);
  if (tracker && tracker.totalChunks > 0) {
    const avgChunkSize = Math.round(tracker.totalBytes / tracker.totalChunks);
    console.log(
      `\n📈 ${streamName} Buffer Statistics:`,
      `\n  ├─ Total Callbacks: ${tracker.totalChunks}`,
      `\n  ├─ Total Bytes: ${tracker.totalBytes}`,
      `\n  ├─ Avg Buffer Size: ${avgChunkSize} bytes`,
      `\n  ├─ Min Buffer Size: ${tracker.minChunkSize} bytes`,
      `\n  └─ Max Buffer Size: ${tracker.maxChunkSize} bytes`
    );
    bufferTrackers.delete(streamName);
  }
}

/**
 * Clear all buffer trackers
 */
function clearBufferTrackers(): void {
  bufferTrackers.clear();
}

/**
 * Log complete stream format information for a recording session
 */
function logCaptureStreamFormats(options: {
  inputDevice: string | null;
  inputSampleRate: number;
  inputChannels: number;
  outputSampleRate: number;
  outputChannels: number;
  isDualSource: boolean;
  systemAudioDevice?: string;
  systemAudioSampleRate?: number;
  systemAudioChannels?: number;
}): void {
  console.log('\n' + '='.repeat(60));
  console.log('🎙️  AUDIO CAPTURE STREAM FORMAT INFO');
  console.log('='.repeat(60));

  // Log input stream (microphone)
  logStreamFormat({
    streamName: 'Input (Microphone)',
    sampleRate: options.inputSampleRate,
    channels: options.inputChannels,
    pcmFormat: 'int16',
    bitDepth: 16,
    bytesPerSample: 2,
    bytesPerFrame: 2 * options.inputChannels,
    deviceName: options.inputDevice || 'system default'
  });

  // Log system audio stream if dual-source
  if (options.isDualSource && options.systemAudioDevice) {
    logStreamFormat({
      streamName: 'Input (System Audio)',
      sampleRate: options.systemAudioSampleRate || options.inputSampleRate,
      channels: options.systemAudioChannels || 2,
      pcmFormat: 'int16',
      bitDepth: 16,
      bytesPerSample: 2,
      bytesPerFrame: 2 * (options.systemAudioChannels || 2),
      deviceName: options.systemAudioDevice
    });
  }

  // Log output stream (WAV file)
  logStreamFormat({
    streamName: 'Output (WAV File)',
    sampleRate: options.outputSampleRate,
    channels: options.outputChannels,
    pcmFormat: 'int16',
    bitDepth: 16,
    bytesPerSample: 2,
    bytesPerFrame: 2 * options.outputChannels,
  });

  console.log('='.repeat(60) + '\n');
}

/**
 * Detach audio level listener
 */
function detachAudioLevelListener(emitSilence: boolean = true) {
  if (activeAudioStream && audioLevelHandler) {
    activeAudioStream.removeListener("data", audioLevelHandler);
  }
  activeAudioStream = null;
  audioLevelHandler = null;
  lastAudioLevelEmit = 0;

  if (emitSilence) {
    emitAudioLevel(0, 0);
  }
}

/**
 * Detach stream error listener
 */
function detachStreamErrorListener() {
  if (activeAudioStream && streamErrorHandler) {
    activeAudioStream.removeListener("error", streamErrorHandler);
  }
  streamErrorHandler = null;
}

/**
 * Attach audio level listener for real-time metering
 * Also tracks buffer sizes for stream format logging
 * Additionally tracks audio data for health monitoring
 */
function attachAudioLevelListener(
  stream: NodeJS.ReadableStream,
  streamName: string = 'Input (Microphone)',
  sampleRate: number = 16000,
  channels: number = 1
): void {
  detachAudioLevelListener(false);
  activeAudioStream = stream;
  audioLevelHandler = (chunk: Buffer) => {
    if (!Buffer.isBuffer(chunk)) {
      return;
    }

    // Track audio data for health monitoring
    trackAudioDataReceived(chunk.length);

    // Track buffer size for the first few callbacks
    trackBufferSize(streamName, chunk, sampleRate, channels, 2); // 2 bytes per sample for int16

    const now = Date.now();
    if (now - lastAudioLevelEmit < 75) {
      return;
    }
    lastAudioLevelEmit = now;

    const { level, peak } = calculateAudioLevels(chunk);
    emitAudioLevel(level, peak);
  };

  stream.on("data", audioLevelHandler);
  stream.once("end", () => {
    // Log final buffer statistics when stream ends
    logBufferStats(streamName);
    detachAudioLevelListener();
  });
}

/**
 * Check if a command exists on the system
 */
async function commandExists(command: string): Promise<boolean> {
  try {
    const checkCmd =
      process.platform === "win32" ? `where ${command}` : `which ${command}`;
    await execAsync(checkCmd, { timeout: 5000 });
    return true;
  } catch {
    return false;
  }
}

/**
 * Get the best available recorder for the current platform
 * Returns the recorder name and installation instructions if not available
 *
 * Checks for bundled binaries first (via binaryManager), then falls back to system PATH.
 */
async function getAvailableRecorder(): Promise<{
  recorder: "sox" | "rec" | "arecord" | null;
  error?: string;
  instructions?: string;
}> {
  const platform = process.platform;

  if (platform === "darwin") {
    // macOS: Try bundled sox first, then system sox, then rec
    if (await binaryManager.isBinaryAvailable("sox")) {
      return { recorder: "sox" };
    }
    if (await commandExists("rec")) {
      return { recorder: "rec" };
    }
    return {
      recorder: null,
      error: "sox is not installed",
      instructions:
        "To install sox on macOS, run: brew install sox\n\nAlternatively, you can install it via MacPorts: sudo port install sox",
    };
  } else if (platform === "linux") {
    // Linux: Use arecord (ALSA) - sox not commonly used for direct recording on Linux
    if (await commandExists("arecord")) {
      return { recorder: "arecord" };
    }
    return {
      recorder: null,
      error: "arecord is not installed",
      instructions:
        "To install arecord on Linux, run: sudo apt-get install alsa-utils\n\nOr for other distributions:\n- Fedora/RHEL: sudo dnf install alsa-utils\n- Arch: sudo pacman -S alsa-utils",
    };
  } else if (platform === "win32") {
    // Windows: Try bundled sox first, then system sox
    if (await binaryManager.isBinaryAvailable("sox")) {
      return { recorder: "sox" };
    }
    return {
      recorder: null,
      error: "No suitable recorder found for Windows",
      instructions:
        "Windows recording support requires additional setup. Please use a different platform or install SoX for Windows.",
    };
  }

  return {
    recorder: null,
    error: "Unsupported platform",
    instructions: `Platform ${platform} is not supported for audio recording.`,
  };
}

/**
 * Start recording directly using sox with proper macOS device support
 * This bypasses node-record-lpcm16's limitations with device selection on macOS
 *
 * On macOS, the proper way to specify an input device is:
 * sox -t coreaudio "Device Name" -t wav output.wav
 *
 * For Bluetooth devices and other non-default inputs, this is essential
 * because the AUDIODEV environment variable doesn't work reliably.
 *
 * Uses binaryManager to resolve sox path (bundled or system).
 */
async function startDirectSoxRecording(
  deviceName: string | null,
  sampleRate: number,
  channels: number = 1
): Promise<{ process: ChildProcess; stream: NodeJS.ReadableStream }> {
  const platform = process.platform;
  const args: string[] = [];

  if (platform === "darwin") {
    // macOS: Use Core Audio device type for input
    if (deviceName) {
      // Specific device: use -t coreaudio "device name"
      args.push("-t", "coreaudio", deviceName);
    } else {
      // Default device: use --default-device
      args.push("--default-device");
    }

    // Output settings: raw PCM to stdout
    args.push(
      "--no-show-progress",
      "-r", sampleRate.toString(),
      "-c", channels.toString(),
      "-e", "signed-integer",
      "-b", "16",
      "-t", "raw",  // Output raw PCM
      "-"           // Output to stdout
    );
  } else if (platform === "linux") {
    // Linux: Use ALSA device specification
    if (deviceName) {
      // For ALSA, we can use -t alsa with device name
      args.push("-t", "alsa", deviceName);
    } else {
      args.push("--default-device");
    }

    args.push(
      "--no-show-progress",
      "-r", sampleRate.toString(),
      "-c", channels.toString(),
      "-e", "signed-integer",
      "-b", "16",
      "-t", "raw",
      "-"
    );
  } else {
    // Windows or other: use default device
    args.push(
      "--default-device",
      "--no-show-progress",
      "-r", sampleRate.toString(),
      "-c", channels.toString(),
      "-e", "signed-integer",
      "-b", "16",
      "-t", "raw",
      "-"
    );
  }

  // Get sox binary path (bundled or system)
  const soxPath = await binaryManager.getBinaryPath("sox");
  if (!soxPath) {
    throw new Error("sox binary not found. Please install sox or ensure bundled binaries are present.");
  }

  console.log(`Starting sox with path: ${soxPath}`);
  console.log(`Starting sox with args: ${soxPath} ${args.join(" ")}`);

  const soxProcess = spawn(soxPath, args, {
    stdio: ["pipe", "pipe", "pipe"]
  });

  // Log stderr for debugging
  soxProcess.stderr?.on("data", (data: Buffer) => {
    const msg = data.toString().trim();
    if (msg && !msg.includes("WARN")) {
      console.log(`sox stderr: ${msg}`);
    }
  });

  return {
    process: soxProcess,
    stream: soxProcess.stdout!
  };
}

/**
 * Check if a device name indicates it's a Bluetooth device or external device
 * that requires direct sox recording on macOS.
 *
 * This includes:
 * - Bluetooth headphones (Bose, AirPods, Beats, Jabra, Sony)
 * - Mobile devices connected via Continuity/Bluetooth (iPhone, iPad)
 * - Any device with "bluetooth" in its name
 */
function isBluetoothDevice(deviceName: string | null): boolean {
  if (!deviceName) return false;
  const lower = deviceName.toLowerCase();
  return lower.includes("bluetooth") ||
         lower.includes("bose") ||
         lower.includes("airpods") ||
         lower.includes("beats") ||
         lower.includes("jabra") ||
         lower.includes("sony wh-") ||
         lower.includes("sony wf-") ||
         lower.includes("iphone") ||  // iPhone connected via Continuity/Bluetooth
         lower.includes("ipad") ||    // iPad connected via Continuity/Bluetooth
         lower.includes("sennheiser") ||
         lower.includes("plantronics") ||
         lower.includes("jbl") ||
         lower.includes("samsung") ||
         lower.includes("pixel buds") ||
         lower.includes("galaxy buds");
}

/**
 * Check if a device name indicates it's a virtual audio cable device
 * that can be used for system audio capture.
 *
 * Virtual cables act as loopback devices - they can receive audio from
 * applications (as output) and provide it for recording (as input).
 *
 * Known virtual cable devices:
 * - macOS: BlackHole, Soundflower, Loopback
 * - Windows: VB-Audio Virtual Cable, Voicemeeter
 * - Linux: PulseAudio virtual sinks
 */
function isVirtualCableDevice(deviceName: string | null): boolean {
  if (!deviceName) return false;
  const lower = deviceName.toLowerCase();
  return lower.includes("blackhole") ||
         lower.includes("soundflower") ||
         lower.includes("loopback") ||
         lower.includes("vb-audio") ||
         lower.includes("vb audio") ||
         lower.includes("virtual cable") ||
         lower.includes("voicemeeter") ||
         lower.includes("virtual sink") ||
         lower.includes("virtual_sink") ||
         lower.includes("null sink") ||
         lower.includes("pulse") && lower.includes("monitor");
}

/**
 * Check if a device name indicates it's a standard output device (speakers/headphones)
 * that CANNOT be used for recording system audio.
 *
 * These devices are OUTPUT-only and sox cannot record FROM them.
 * Users need to use a virtual cable (like BlackHole) for system audio capture.
 */
function isOutputOnlyDevice(deviceName: string | null): boolean {
  if (!deviceName) return false;
  const lower = deviceName.toLowerCase();

  // Common macOS output devices
  if (lower.includes("macbook") && lower.includes("speaker")) return true;
  if (lower.includes("imac") && lower.includes("speaker")) return true;
  if (lower.includes("mac mini") && lower.includes("speaker")) return true;
  if (lower.includes("mac pro") && lower.includes("speaker")) return true;
  if (lower.includes("built-in output")) return true;
  if (lower.includes("internal speakers")) return true;

  // Common Windows output devices
  if (lower.includes("realtek") && lower.includes("speaker")) return true;
  if (lower.includes("nvidia") && lower.includes("output")) return true;

  // HDMI/DisplayPort outputs (can't be used for input)
  if (lower.includes("hdmi") && !lower.includes("input")) return true;
  if (lower.includes("displayport")) return true;

  // The device type contains "output" but not "multi-output" (which is a valid aggregate)
  if (lower.includes("output") && !lower.includes("multi-output") && !lower.includes("cable output")) return true;

  return false;
}

/**
 * Detect the actual sample rate for Bluetooth and virtual devices
 * Bluetooth devices on macOS typically use 16kHz for SCO (phone calls) mode
 * or their native rate for A2DP mode
 */
async function detectDeviceSampleRateEnhanced(deviceName: string | null): Promise<number | null> {
  if (!deviceName) return null;

  const platform = process.platform;
  const deviceLower = deviceName.toLowerCase();

  // Check if it's a virtual device (BlackHole, aggregate, etc.)
  const isVirtualDevice = deviceLower.includes("blackhole") ||
                          deviceLower.includes("aggregate") ||
                          deviceLower.includes("multi-output") ||
                          deviceLower.includes("soundflower");

  // Check if it's a Bluetooth device
  const isBluetooth = isBluetoothDevice(deviceName);

  if (platform === "darwin") {
    try {
      // Try to get sample rate using system_profiler
      const { stdout } = await execAsync(
        'system_profiler SPAudioDataType -json',
        { timeout: 10000 }
      );
      const data = JSON.parse(stdout);
      const audioData = data?.SPAudioDataType || [];

      for (const section of audioData) {
        const items = section?._items || [];
        for (const item of items) {
          const itemName = item?._name || "";
          // Check if this is the device we're looking for
          if (itemName.toLowerCase().includes(deviceLower) ||
              deviceLower.includes(itemName.toLowerCase())) {
            // Try to extract sample rate from properties
            // The property names vary but look for sample rate info
            const sampleRateStr = item?.coreaudio_device_srate;
            if (sampleRateStr) {
              const rate = parseInt(sampleRateStr, 10);
              if (rate > 0 && rate <= 192000) {
                console.log(`Detected sample rate ${rate}Hz for device "${deviceName}" from system_profiler`);
                return rate;
              }
            }
          }
        }
      }
    } catch (error) {
      console.warn(`Error detecting sample rate via system_profiler:`, error);
    }

    // If we couldn't detect from system_profiler, use heuristics
    if (isVirtualDevice) {
      // Virtual devices typically run at 48kHz on macOS
      console.log(`Using 48kHz for virtual device "${deviceName}" (heuristic)`);
      return 48000;
    }

    if (isBluetooth) {
      // Bluetooth devices vary but often use 48kHz for A2DP or 16kHz for SCO
      // For recording (microphone input), they typically use 16kHz in SCO mode
      // But we should try to detect the actual rate

      // Try a quick sox probe to determine the rate
      try {
        const testFile = path.join(app.getPath("temp"), `bt_test_${Date.now()}.wav`);
        await execAsync(
          `sox -t coreaudio "${deviceName}" -r 48000 -c 1 -b 16 "${testFile}" trim 0 0.2 2>&1 || true`,
          { timeout: 5000 }
        );

        if (fs.existsSync(testFile)) {
          // Read the sample rate from the created file
          const fileSampleRate = readWavFileSampleRate(testFile);
          try { fs.unlinkSync(testFile); } catch {}

          if (fileSampleRate && fileSampleRate > 0) {
            console.log(`Detected sample rate ${fileSampleRate}Hz for Bluetooth device "${deviceName}" via test recording`);
            return fileSampleRate;
          }
        }
      } catch {
        // Test failed, continue with default
      }

      // Default Bluetooth rate - use 48kHz as it's commonly supported
      console.log(`Using 48kHz for Bluetooth device "${deviceName}" (default heuristic)`);
      return 48000;
    }
  }

  // Fall back to the original detection method
  return detectDeviceSampleRate(deviceName);
}

// ============================================================================
// Audio Recorder Service
// ============================================================================

export const audioRecorderService = {
  /**
   * Start recording audio from the microphone
   */
  async startRecording(meetingId?: string): Promise<StartRecordingResult> {
    if (
      recordingState.status === "recording" ||
      recordingState.status === "paused"
    ) {
      throw new Error("Recording is already in progress");
    }

    // Check for available recorder before attempting to record
    const recorderInfo = await getAvailableRecorder();
    if (!recorderInfo.recorder) {
      const errorMessage = recorderInfo.error || "No audio recorder available";
      const instructions =
        recorderInfo.instructions ||
        "Please install a compatible audio recorder for your platform.";
      throw new Error(`${errorMessage}\n\n${instructions}`);
    }

    const { sampleRate: configuredSampleRate, inputDevice, outputDevice, dualSourceEnabled } = getAudioSettings();

    // Get meeting-specific folder or fallback to root recordings directory
    const meetingFolder = getMeetingFolder(meetingId || null);
    const recordingsDir = meetingFolder || getRecordingsDir();
    const filename = generateRecordingFilename(meetingId || null);
    const audioFilePath = path.join(recordingsDir, filename);

    // Resolve and validate the input device from settings
    const { device: resolvedDevice, warning: deviceWarning } = await resolveInputDevice(inputDevice);

    console.log(`Audio recording: configured device="${inputDevice}", resolved device="${resolvedDevice || 'system default'}"`);
    if (deviceWarning) {
      console.warn(`Audio device warning: ${deviceWarning}`);
    }

    // Check if dual-source recording is enabled (microphone + system audio via virtual cable)
    let isDualSource = dualSourceEnabled && outputDevice && outputDevice !== "default";
    let systemAudioWarning: string | undefined;

    // Validate the system audio device if dual-source is requested
    if (isDualSource) {
      // Check if the configured device is an output-only device (speakers) that can't be recorded from
      if (isOutputOnlyDevice(outputDevice)) {
        systemAudioWarning = `Cannot record system audio from "${outputDevice}" - this is an output-only device (speakers/headphones). ` +
          `To capture system audio, install a virtual audio cable like BlackHole (macOS), VB-Audio (Windows), or create a PulseAudio virtual sink (Linux). ` +
          `Falling back to microphone-only recording.`;
        console.warn(`[Audio Recording] ${systemAudioWarning}`);
        isDualSource = false;  // Fall back to microphone-only
      } else if (!isVirtualCableDevice(outputDevice)) {
        // Device is not a known virtual cable - warn but try anyway
        console.warn(`[Audio Recording] System audio device "${outputDevice}" is not a recognized virtual cable. ` +
          `For best results, use BlackHole (macOS), VB-Audio Virtual Cable (Windows), or a PulseAudio virtual sink (Linux).`);
      } else {
        console.log(`Dual-source recording enabled: microphone="${resolvedDevice || 'system default'}", system audio="${outputDevice}"`);
      }
    }

    // Detect the actual sample rate of the device using enhanced detection
    // This is critical for BlackHole, aggregate devices, and Bluetooth devices
    // which may run at different rates than configured
    let actualSampleRate = configuredSampleRate;
    const detectedSampleRate = await detectDeviceSampleRateEnhanced(resolvedDevice);

    if (detectedSampleRate && detectedSampleRate !== configuredSampleRate) {
      console.log(`Sample rate mismatch detected: device="${resolvedDevice}" is running at ${detectedSampleRate}Hz, but configured for ${configuredSampleRate}Hz. Using device sample rate to prevent playback speed issues.`);
      actualSampleRate = detectedSampleRate;
    } else if (detectedSampleRate) {
      console.log(`Device sample rate confirmed: ${detectedSampleRate}Hz matches configured rate`);
      actualSampleRate = detectedSampleRate;
    } else {
      // If we couldn't detect, but it's a BlackHole/aggregate device, use 48kHz as safe default
      const deviceLower = (resolvedDevice || "").toLowerCase();
      if (deviceLower.includes("blackhole") || deviceLower.includes("aggregate") || deviceLower.includes("multi-output")) {
        if (configuredSampleRate !== 48000) {
          console.log(`Using 48kHz sample rate for virtual/aggregate device "${resolvedDevice}" (configured: ${configuredSampleRate}Hz). This prevents playback speed issues.`);
          actualSampleRate = 48000;
        }
      }
    }

    // For dual-source recording with BlackHole, use 48kHz to match the virtual cable's native rate
    if (isDualSource) {
      const outputLower = outputDevice.toLowerCase();
      if (outputLower.includes("blackhole") || outputLower.includes("soundflower") || outputLower.includes("loopback")) {
        if (actualSampleRate !== 48000) {
          console.log(`Using 48kHz sample rate for dual-source recording with virtual cable "${outputDevice}" (was ${actualSampleRate}Hz)`);
          actualSampleRate = 48000;
        }
      }
    }

    // Determine if we should use direct sox recording (for macOS with specific devices)
    // This is needed because node-record-lpcm16 uses AUDIODEV env var which doesn't work
    // reliably on macOS for Bluetooth devices and specific input sources
    const platform = process.platform;
    const useDirectSox = platform === "darwin" && (
                         resolvedDevice !== null &&
                         (isBluetoothDevice(resolvedDevice) ||
                          resolvedDevice.toLowerCase().includes("blackhole") ||
                          resolvedDevice.toLowerCase().includes("aggregate")) ||
                         isDualSource);  // Always use direct sox for dual-source recording on macOS

    try {
      // ============================================================================
      // DUAL-SOURCE RECORDING (Microphone + System Audio)
      // ============================================================================
      // Supported platforms:
      // - macOS: BlackHole, Soundflower, Loopback (via sox -t coreaudio)
      // - Linux: PulseAudio virtual sinks (via sox -t alsa or -t pulseaudio)
      // - Windows: VB-Audio Virtual Cable, Voicemeeter (via sox with dshow/WASAPI)
      if (isDualSource) {
        // Dual-source recording: record from both microphone AND virtual cable (system audio)
        // Uses AudioMixer to combine both streams in real-time
        // NOTE: Live transcription will use ONLY microphone audio (not mixed) for accurate speech recognition
        console.log(`Starting dual-source recording on ${platform}: microphone="${resolvedDevice || 'default'}", system audio="${outputDevice}"`);
        console.log(`[Live Transcription] Will use microphone-only audio for transcription (system audio excluded)`);

        // Detect actual sample rates for both sources
        // This is CRITICAL for preventing playback speed issues
        const microphoneSampleRate = actualSampleRate; // Already detected for microphone
        let systemAudioSampleRate = actualSampleRate;

        // Detect system audio device sample rate separately
        // Virtual cables (BlackHole, etc.) often run at 48kHz regardless of configured rate
        const systemDeviceRate = await detectDeviceSampleRateEnhanced(outputDevice);
        if (systemDeviceRate) {
          systemAudioSampleRate = systemDeviceRate;
          if (systemDeviceRate !== microphoneSampleRate) {
            console.log(`Sample rate mismatch detected between sources:`);
            console.log(`  Microphone: ${microphoneSampleRate}Hz`);
            console.log(`  System audio (${outputDevice}): ${systemAudioSampleRate}Hz`);
          }
        } else {
          // Default to 48kHz for virtual cable devices if detection fails
          const outputLower = outputDevice.toLowerCase();
          if (outputLower.includes("blackhole") || outputLower.includes("soundflower") || outputLower.includes("loopback") || outputLower.includes("vb-audio")) {
            systemAudioSampleRate = 48000;
            console.log(`Using default 48kHz for virtual cable "${outputDevice}" (detection failed)`);
          }
        }

        // Determine the output sample rate for the mixed file
        // Use the higher rate to preserve audio quality and prevent information loss
        const outputSampleRate = Math.max(microphoneSampleRate, systemAudioSampleRate);
        console.log(`Dual-source recording sample rates:`);
        console.log(`  Microphone input: ${microphoneSampleRate}Hz`);
        console.log(`  System audio input: ${systemAudioSampleRate}Hz`);
        console.log(`  Mixed output: ${outputSampleRate}Hz`);

        // Create AudioMixer with per-source sample rate configuration
        // The mixer will resample sources that don't match the output rate
        audioMixer = new AudioMixer({
          sampleRate: outputSampleRate,           // Output sample rate for WAV file
          channels: 1,
          bitDepth: 16,
          outputPath: audioFilePath,
          microphoneSampleRate: microphoneSampleRate,     // Actual mic sample rate
          systemAudioSampleRate: systemAudioSampleRate,   // Actual system audio sample rate
          systemAudioChannels: 2,                         // System audio is typically stereo
          // Use onMixedChunk for live transcription - this contains BOTH microphone and system audio
          // properly mixed at the sample level. This is the correct approach because:
          // 1. Both speakers (local mic + remote via virtual cable) are combined in one audio stream
          // 2. The mixing is done at the sample level, avoiding interleaving/corruption issues
          // 3. Whisper can transcribe both voices from the combined audio
          onMixedChunk: (chunk, sampleRate, channels, bitDepth) => {
            emitAudioChunk(chunk, sampleRate, channels, bitDepth);
          }
        });

        // Update actualSampleRate to reflect the output rate for return value
        actualSampleRate = outputSampleRate;

        // Log comprehensive stream format information at capture time
        logCaptureStreamFormats({
          inputDevice: resolvedDevice,
          inputSampleRate: microphoneSampleRate,
          inputChannels: 1,
          outputSampleRate: outputSampleRate,
          outputChannels: 1,
          isDualSource: true,
          systemAudioDevice: outputDevice,
          systemAudioSampleRate: systemAudioSampleRate,
          systemAudioChannels: 2
        });

        // Clear any previous buffer trackers and prepare for new session
        clearBufferTrackers();

        // Helper function to create stream error handlers for dual-source recording
        const createDualSourceErrorHandler = (sourceName: string) => (err: Error) => {
          const errorMessage = err.message || String(err);
          console.log(`[Audio Recording] ${sourceName} stream error caught:`, errorMessage);

          // Check if this is a sox exit error
          const isSoxExitError = errorMessage.includes("sox has exited with error code") ||
                                errorMessage.includes("rec has exited with error code") ||
                                errorMessage.includes("arecord has exited with error code");

          if (isSoxExitError) {
            console.warn(`[Audio Recording] ${sourceName} recorder failed to start or exited unexpectedly`);
            emitAudioHealth('warning', `${sourceName} audio recording failed. Check audio device settings.`, 'DUAL_SOURCE_STREAM_ERROR');
          } else {
            console.error(`[Audio Recording] ${sourceName} unexpected stream error:`, errorMessage);
          }
        };

        // Start microphone recording at its NATIVE sample rate
        // The AudioMixer will handle resampling to the output rate if needed
        console.log(`Starting microphone recording at ${microphoneSampleRate}Hz`);
        const micRecording = await startDirectSoxRecording(resolvedDevice, microphoneSampleRate, 1);
        customSoxProcess = micRecording.process;
        const microphoneStream = micRecording.stream as Readable;

        // CRITICAL: Attach error handler IMMEDIATELY after getting the stream
        microphoneStream.on("error", createDualSourceErrorHandler("Microphone"));

        // Track microphone data for debugging and health monitoring
        let micBytesReceived = 0;
        let micChunkCount = 0;
        let micSilentChunks = 0;
        let micFirstChunkLogged = false;
        microphoneStream.on('data', (chunk: Buffer) => {
          micBytesReceived += chunk.length;
          micChunkCount++;
          // Track audio data for health monitoring - this ensures we detect when
          // the microphone is working even if system audio isn't
          trackAudioDataReceived(chunk.length);

          // Calculate audio levels for diagnostics
          const sampleCount = Math.floor(chunk.length / 2); // 16-bit mono
          let sumSquares = 0;
          let peak = 0;
          for (let i = 0; i < sampleCount; i++) {
            const sample = chunk.readInt16LE(i * 2);
            const normalized = sample / 32768.0;
            sumSquares += normalized * normalized;
            peak = Math.max(peak, Math.abs(normalized));
          }
          const rms = Math.sqrt(sumSquares / Math.max(sampleCount, 1));
          const dbRms = rms > 0 ? 20 * Math.log10(rms) : -100;

          // Track silent chunks
          if (rms < 0.0001) {
            micSilentChunks++;
          }

          if (!micFirstChunkLogged) {
            micFirstChunkLogged = true;
            const framesPerCallback = sampleCount;
            const durationMs = (framesPerCallback / microphoneSampleRate) * 1000;
            console.log(
              `\n📦 Input (Microphone) Buffer Info (first callback):`,
              `\n  ├─ Buffer Size: ${chunk.length} bytes`,
              `\n  ├─ Frames per Callback: ${framesPerCallback}`,
              `\n  ├─ Buffer Duration: ${durationMs.toFixed(2)} ms`,
              `\n  ├─ Audio Level: RMS=${rms.toFixed(4)}, Peak=${peak.toFixed(4)}, dB=${dbRms.toFixed(1)}`,
              `\n  └─ Device: "${resolvedDevice || 'default'}"`
            );

            // Warn if first chunk is silent
            if (rms < 0.0001) {
              console.warn(`\n⚠️ WARNING: Microphone appears SILENT on first chunk!`);
              console.warn(`   This could mean:`);
              console.warn(`   1. Microphone permissions not granted`);
              console.warn(`   2. Wrong microphone device selected`);
              console.warn(`   3. Microphone is muted or disconnected`);
            }
          }

          // Log periodic diagnostics (every ~5 seconds at typical chunk rates)
          if (micChunkCount % 50 === 0) {
            console.log(`[Microphone] Chunk #${micChunkCount}: RMS=${rms.toFixed(4)}, dB=${dbRms.toFixed(1)}, silent_chunks=${micSilentChunks}/${micChunkCount}`);
            if (micSilentChunks > micChunkCount * 0.9) {
              console.warn(`[Microphone] WARNING: >90% of chunks are silent! Check microphone permissions and device.`);
            }
          }
        });

        // Handle microphone process exit
        customSoxProcess.on("exit", (code, signal) => {
          if (recordingState.status === "stopping" || recordingState.status === "idle") {
            return;
          }
          if (code !== 0 && code !== null) {
            console.error(`Microphone sox exited with code ${code}, signal ${signal}`);
          }
        });

        customSoxProcess.on("error", (err) => {
          if (recordingState.status === "stopping" || recordingState.status === "idle") {
            return;
          }
          console.error("Microphone sox process error:", err);
        });

        // Start system audio recording at its NATIVE sample rate
        // Recording at native rate prevents sox from doing poor-quality resampling
        // The AudioMixer will handle resampling with proper interpolation if needed
        console.log(`Starting system audio recording at ${systemAudioSampleRate}Hz (stereo)`);
        const systemRecording = await startDirectSoxRecording(outputDevice, systemAudioSampleRate, 2);
        systemAudioSoxProcess = systemRecording.process;
        const systemAudioStream = systemRecording.stream as Readable;

        // CRITICAL: Attach error handler IMMEDIATELY after getting the stream
        systemAudioStream.on("error", createDualSourceErrorHandler("System audio"));

        // Handle system audio process exit
        systemAudioSoxProcess.on("exit", (code, signal) => {
          if (recordingState.status === "stopping" || recordingState.status === "idle") {
            return;
          }
          if (code !== 0 && code !== null) {
            console.error(`System audio sox exited with code ${code}, signal ${signal}`);
            // Emit a helpful warning about system audio failure
            const errorMessage = `System audio recording failed (exit code ${code}). ` +
              `The device "${outputDevice}" may not be a valid input device. ` +
              `Note: Speaker devices (like "MacBook Pro Speakers") cannot be used for system audio capture. ` +
              `Use a virtual cable like BlackHole (macOS), VB-Audio (Windows), or PulseAudio virtual sink (Linux).`;
            console.warn(`[Audio Recording] ${errorMessage}`);
            // Emit health warning for UI notification
            emitAudioHealth('warning', errorMessage, 'SYSTEM_AUDIO_DEVICE_FAILED');
          }
        });

        systemAudioSoxProcess.on("error", (err) => {
          if (recordingState.status === "stopping" || recordingState.status === "idle") {
            return;
          }
          console.error("System audio sox process error:", err);
          // Emit health warning for system audio failure
          emitAudioHealth(
            'warning',
            `System audio recording error: ${err.message}. Recording will continue with microphone only.`,
            'SYSTEM_AUDIO_ERROR'
          );
        });

        // Add buffer tracking for system audio stream (before mixer processes it)
        // This tracks the raw input buffer sizes from the system audio device
        // IMPORTANT: Also track audio data for health monitoring - this ensures that
        // if system audio is working but microphone isn't, we don't incorrectly report
        // "no audio data detected"
        let systemAudioFirstChunkLogged = false;
        let systemAudioChunkCount = 0;
        let systemAudioSilentChunks = 0;
        systemAudioStream.on('data', (chunk: Buffer) => {
          // Track system audio data for health monitoring
          // This is critical for dual-source recording - we want to track data
          // from EITHER source, not just the microphone
          trackAudioDataReceived(chunk.length);
          systemAudioChunkCount++;

          // Calculate audio levels for diagnostics
          const sampleCount = Math.floor(chunk.length / 4); // 16-bit stereo
          let sumSquares = 0;
          let peak = 0;
          for (let i = 0; i < sampleCount; i++) {
            const left = chunk.readInt16LE(i * 4);
            const right = chunk.readInt16LE(i * 4 + 2);
            const mono = (left + right) / 2;
            const normalized = mono / 32768.0;
            sumSquares += normalized * normalized;
            peak = Math.max(peak, Math.abs(normalized));
          }
          const rms = Math.sqrt(sumSquares / Math.max(sampleCount, 1));
          const dbRms = rms > 0 ? 20 * Math.log10(rms) : -100;

          // Track silent chunks
          if (rms < 0.0001) {
            systemAudioSilentChunks++;
          }

          if (!systemAudioFirstChunkLogged) {
            systemAudioFirstChunkLogged = true;
            const bytesPerFrame = 2 * 2; // 16-bit stereo = 4 bytes per frame
            const framesPerCallback = Math.floor(chunk.length / bytesPerFrame);
            const durationMs = (framesPerCallback / systemAudioSampleRate) * 1000;
            console.log(
              `\n📦 Input (System Audio) Buffer Info (first callback):`,
              `\n  ├─ Buffer Size: ${chunk.length} bytes`,
              `\n  ├─ Frames per Callback: ${framesPerCallback}`,
              `\n  ├─ Buffer Duration: ${durationMs.toFixed(2)} ms`,
              `\n  ├─ Audio Level: RMS=${rms.toFixed(4)}, Peak=${peak.toFixed(4)}, dB=${dbRms.toFixed(1)}`,
              `\n  └─ Device: "${outputDevice}"`
            );

            // Warn if first chunk is silent - may indicate capture issue
            if (rms < 0.0001) {
              console.warn(`\n⚠️ WARNING: System audio appears SILENT on first chunk!`);
              console.warn(`   This could mean:`);
              console.warn(`   1. BlackHole/virtual cable is not receiving audio`);
              console.warn(`   2. System audio routing is not configured correctly`);
              console.warn(`   3. No audio is playing on the system`);
            }
          }

          // Log periodic diagnostics (every ~5 seconds at typical chunk rates)
          if (systemAudioChunkCount % 50 === 0) {
            console.log(`[System Audio] Chunk #${systemAudioChunkCount}: RMS=${rms.toFixed(4)}, dB=${dbRms.toFixed(1)}, silent_chunks=${systemAudioSilentChunks}/${systemAudioChunkCount}`);
            if (systemAudioSilentChunks > systemAudioChunkCount * 0.9) {
              console.warn(`[System Audio] WARNING: >90% of chunks are silent! Check virtual cable routing.`);
            }
          }
        });

        // Start the audio mixer with both streams
        await audioMixer.start(microphoneStream, systemAudioStream);
        recordingProcess = null; // Not using node-record-lpcm16
        wavWriter = null; // Not using wav.FileWriter directly - AudioMixer handles it

        // Attach audio level listener to microphone stream for UI feedback
        // Also tracks buffer sizes for stream format logging
        attachAudioLevelListener(microphoneStream, 'Input (Microphone)', microphoneSampleRate, 1);

        // Update state
        const startTime = Date.now();
        recordingState = {
          status: "recording",
          meetingId: meetingId || null,
          startTime,
          duration: 0,
          audioFilePath,
        };
        pausedDuration = 0;

        // Start audio health monitoring to detect issues early
        startAudioHealthMonitoring();

        // Combine all warnings for the response
        const combinedWarning = [deviceWarning, systemAudioWarning].filter(Boolean).join("; ");

        return {
          success: true,
          meetingId: recordingState.meetingId,
          startTime,
          audioFilePath,
          deviceUsed: `${resolvedDevice || "system default"} + ${outputDevice} (dual-source)`,
          warning: combinedWarning || undefined,
          sampleRateUsed: actualSampleRate,
          sampleRateConfigured: configuredSampleRate,
        };
      }

      // ============================================================================
      // SINGLE-SOURCE RECORDING (Microphone only)
      // ============================================================================
      // Create WAV file writer with the actual sample rate (not the configured one if they differ)
      // CRITICAL: The sample rate in the WAV header MUST match the actual audio data sample rate
      // If they don't match, playback will be at the wrong speed
      console.log(`Creating WAV file with sample rate: ${actualSampleRate}Hz (configured: ${configuredSampleRate}Hz)`);

      // Log comprehensive stream format information at capture time
      logCaptureStreamFormats({
        inputDevice: resolvedDevice,
        inputSampleRate: actualSampleRate,
        inputChannels: 1,
        outputSampleRate: actualSampleRate,
        outputChannels: 1,
        isDualSource: false
      });

      // Clear any previous buffer trackers and prepare for new session
      clearBufferTrackers();

      // Create real-time WAV file writer for incremental writing
      // This enables transcription to read from the file while recording
      wavWriter = new RealTimeWavWriter({
        filePath: audioFilePath,
        sampleRate: actualSampleRate,
        channels: 1,
        bitDepth: 16,
        // Update header every 32KB (~1 second of audio at 16kHz mono 16-bit)
        headerUpdateInterval: 32768,
      });
      await wavWriter.open();

      let audioStream: NodeJS.ReadableStream;

      // Helper function to create early error handler for audio streams
      // This prevents unhandled 'error' events that crash the app
      const createStreamErrorHandler = () => (err: Error) => {
        const errorMessage = err.message || String(err);
        console.log("[Audio Recording] Stream error caught:", errorMessage);

        // Check if this is a sox exit error
        const isSoxExitError = errorMessage.includes("sox has exited with error code") ||
                              errorMessage.includes("rec has exited with error code") ||
                              errorMessage.includes("arecord has exited with error code");

        if (isSoxExitError) {
          console.warn("[Audio Recording] Recorder failed to start or exited unexpectedly");
          // Emit audio health error to notify UI
          emitAudioHealth('error', 'Audio recorder failed to start. Please check sox is installed correctly.', 'RECORDER_INIT_FAILED');
        } else {
          console.error("[Audio Recording] Unexpected stream error:", errorMessage);
        }
      };

      if (useDirectSox) {
        // Use direct sox recording for better device support on macOS
        console.log(`Using direct sox recording for device "${resolvedDevice}" (macOS specific device mode)`);
        const soxRecording = await startDirectSoxRecording(resolvedDevice, actualSampleRate, 1);
        customSoxProcess = soxRecording.process;
        audioStream = soxRecording.stream;
        recordingProcess = null; // Not using node-record-lpcm16

        // CRITICAL: Attach error handler IMMEDIATELY after getting the stream
        audioStream.on("error", createStreamErrorHandler());

        // Handle process exit
        customSoxProcess.on("exit", (code, signal) => {
          if (recordingState.status === "stopping" || recordingState.status === "idle") {
            return;
          }
          if (code !== 0 && code !== null) {
            console.error(`sox exited with code ${code}, signal ${signal}`);
          }
        });

        customSoxProcess.on("error", (err) => {
          if (recordingState.status === "stopping" || recordingState.status === "idle") {
            return;
          }
          console.error("sox process error:", err);
        });
      } else {
        // Use node-record-lpcm16 for default device or non-special devices
        // Build recording options - include device if specified
        // CRITICAL: Use actualSampleRate (detected device rate) not configuredSampleRate
        // This ensures the recording matches the device's native sample rate
        const recordOptions: {
          sampleRate: number;
          channels: number;
          audioType: "raw" | "wav";
          recorder: "sox" | "rec" | "arecord";
          silence: string;
          threshold: number;
          endOnSilence: boolean;
          device?: string;
        } = {
          sampleRate: actualSampleRate, // Use detected/actual rate, not configured rate
          channels: 1,
          audioType: "raw" as const, // Use raw PCM, not WAV - we'll write WAV header ourselves
          recorder: recorderInfo.recorder as "sox" | "rec" | "arecord",
          silence: "0", // Don't stop on silence
          threshold: 0, // Record all audio
          endOnSilence: false,
        };

        // Add device option if we have a specific device to use
        if (resolvedDevice) {
          recordOptions.device = resolvedDevice;
        }

        // Start recording with node-record-lpcm16 (raw PCM stream for wav.FileWriter)
        recordingProcess = record.record(recordOptions);
        audioStream = recordingProcess.stream();
        customSoxProcess = null; // Not using direct sox

        // CRITICAL: Attach error handler IMMEDIATELY after getting the stream
        audioStream.on("error", createStreamErrorHandler());
      }

      // Track bytes written for debugging
      let totalBytesWritten = 0;
      let dataChunkCount = 0;

      // Write audio data to file with immediate flush for real-time transcription
      // Use 'data' event handler instead of pipe to write to RealTimeWavWriter
      const dataHandler = async (chunk: Buffer) => {
        totalBytesWritten += chunk.length;
        dataChunkCount++;
        if (dataChunkCount === 1) {
          console.log(`[Audio Recording] First audio chunk received: ${chunk.length} bytes`);
        }
        // Log every 10 chunks (roughly every second at typical buffer sizes)
        if (dataChunkCount % 10 === 0) {
          console.log(`[Audio Recording] Total data: ${(totalBytesWritten / 1024).toFixed(1)} KB, chunks: ${dataChunkCount}`);
        }

        // Emit audio chunk for live transcription subscribers
        // This allows the live transcription service to process audio in real-time
        emitAudioChunk(chunk, actualSampleRate, 1, 16);

        // Write to real-time WAV writer (with immediate flush)
        if (wavWriter) {
          try {
            await wavWriter.write(chunk);
          } catch (writeError) {
            const errorMessage = writeError instanceof Error ? writeError.message : String(writeError);
            console.error(`[Audio Recording] Write error: ${errorMessage}`);

            // Check for disk space or permission errors
            if (errorMessage.includes('Disk space error') || errorMessage.includes('Permission error')) {
              // Emit error and stop recording
              emitAudioHealth('error', errorMessage, 'WRITE_ERROR');
              audioRecorderService.stopRecording().catch((stopErr) => {
                console.error("Error stopping recording after write error:", stopErr);
              });
            }
          }
        }
      };
      audioStream.on('data', dataHandler);

      // Attach audio level listener with buffer tracking for stream format logging
      attachAudioLevelListener(audioStream, 'Input (Microphone)', actualSampleRate, 1);

      // Handle stream errors
      // Store reference to error handler so we can remove it when stopping
      streamErrorHandler = (err: Error) => {
        // Ignore errors when we're intentionally stopping
        // sox exits with error code 1 or null when stopped, which is expected behavior
        if (recordingState.status === "stopping" || recordingState.status === "idle") {
          return;
        }

        const errorMessage = err.message || String(err);

        // Check if this is a sox exit error
        // Sox can exit with code 1 (normal stop), null (signal termination), or other codes
        // These are expected during intentional stops or when the app is closing
        const isSoxExitError = errorMessage.includes("sox has exited with error code") ||
                              errorMessage.includes("rec has exited with error code") ||
                              errorMessage.includes("arecord has exited with error code");

        if (isSoxExitError) {
          // Log the error for debugging but handle gracefully
          console.log("[Audio Recording] Recorder exit detected:", errorMessage);

          // If we're actively recording, this is unexpected - clean up
          if (recordingState.status === "recording" || recordingState.status === "paused") {
            console.warn("[Audio Recording] Unexpected recorder exit during active recording, cleaning up...");
            recordingState.status = "stopping";

            // Emit audio health warning to notify UI
            emitAudioHealth('warning', 'Recording was interrupted unexpectedly', 'RECORDER_EXIT');

            // Auto-cleanup on error (will be idempotent)
            audioRecorderService.stopRecording().catch((stopErr) => {
              console.error("Error during auto-cleanup after recorder exit:", stopErr);
            });
          }
          return;
        }

        console.error("Recording stream error:", err);
        // Mark state as stopping to prevent double-cleanup
        if (recordingState.status === "recording" || recordingState.status === "paused") {
          recordingState.status = "stopping";
        }
        // Auto-cleanup on error (will be idempotent)
        audioRecorderService.stopRecording().catch((stopErr) => {
          console.error("Error during auto-cleanup after stream error:", stopErr);
        });
      };
      audioStream.on("error", streamErrorHandler);

      // Update state
      const startTime = Date.now();
      recordingState = {
        status: "recording",
        meetingId: meetingId || null,
        startTime,
        duration: 0,
        audioFilePath,
      };
      pausedDuration = 0;

      // Start audio health monitoring to detect issues early
      startAudioHealthMonitoring();

      // Combine all warnings for the response (including systemAudioWarning if dual-source was disabled)
      const combinedWarning = [deviceWarning, systemAudioWarning].filter(Boolean).join("; ");

      return {
        success: true,
        meetingId: recordingState.meetingId,
        startTime,
        audioFilePath,
        deviceUsed: resolvedDevice || "system default",
        warning: combinedWarning || undefined,
        sampleRateUsed: actualSampleRate,
        sampleRateConfigured: configuredSampleRate,
      };
    } catch (error) {
      // Cleanup on failure
      if (wavWriter) {
        try {
          await wavWriter.close();
        } catch {
          // Ignore close errors during cleanup
        }
        wavWriter = null;
      }
      detachAudioLevelListener();
      detachStreamErrorListener();
      if (recordingProcess) {
        recordingProcess.stop();
        recordingProcess = null;
      }
      // Remove partial file if exists
      if (fs.existsSync(audioFilePath)) {
        fs.unlinkSync(audioFilePath);
      }

      // Check if error is related to missing recorder
      const errorMessage =
        error instanceof Error ? error.message : String(error);

      // Check if error is related to the specific device
      if (resolvedDevice && (errorMessage.includes("device") || errorMessage.includes("ENOENT"))) {
        // Try again with system default
        console.warn(`Failed to use device "${resolvedDevice}", falling back to system default`);
        const fallbackResult = await audioRecorderService.startRecordingWithDevice(meetingId, null);
        return {
          ...fallbackResult,
          warning: `Could not access device "${resolvedDevice}". Using system default instead. Error: ${errorMessage}`
        };
      }

      if (
        errorMessage.includes("spawn") &&
        (errorMessage.includes("ENOENT") ||
          errorMessage.includes("sox") ||
          errorMessage.includes("arecord"))
      ) {
        const recorderInfo = await getAvailableRecorder();
        const instructions =
          recorderInfo.instructions ||
          "Please install a compatible audio recorder for your platform.";
        throw new Error(
          `Audio recorder not found: ${errorMessage}\n\n${instructions}`
        );
      }

      throw new Error(`Failed to start recording: ${errorMessage}`);
    }
  },

  /**
   * Start recording with a specific device (internal helper for fallback)
   */
  async startRecordingWithDevice(meetingId: string | undefined, device: string | null): Promise<StartRecordingResult> {
    const recorderInfo = await getAvailableRecorder();
    if (!recorderInfo.recorder) {
      throw new Error("No audio recorder available");
    }

    const { sampleRate: configuredSampleRate } = getAudioSettings();
    
    // Get meeting-specific folder or fallback to root recordings directory
    const meetingFolder = getMeetingFolder(meetingId || null);
    const recordingsDir = meetingFolder || getRecordingsDir();
    const filename = generateRecordingFilename(meetingId || null);
    const audioFilePath = path.join(recordingsDir, filename);

    // Detect actual device sample rate for fallback recording
    let actualSampleRate = configuredSampleRate;
    const detectedSampleRate = await detectDeviceSampleRate(device);
    
    if (detectedSampleRate && detectedSampleRate !== configuredSampleRate) {
      console.log(`Sample rate mismatch detected (fallback): device="${device}" is running at ${detectedSampleRate}Hz, but configured for ${configuredSampleRate}Hz. Using device sample rate.`);
      actualSampleRate = detectedSampleRate;
    } else if (detectedSampleRate) {
      actualSampleRate = detectedSampleRate;
    } else {
      // If we couldn't detect, but it's a BlackHole/aggregate device, use 48kHz
      const deviceLower = (device || "").toLowerCase();
      if (deviceLower.includes("blackhole") || deviceLower.includes("aggregate") || deviceLower.includes("multi-output")) {
        if (configuredSampleRate !== 48000) {
          console.log(`Using 48kHz sample rate for virtual/aggregate device "${device}" (fallback recording).`);
          actualSampleRate = 48000;
        }
      }
    }

    // Create WAV file writer with actual sample rate
    // CRITICAL: The sample rate in the WAV header MUST match the actual audio data sample rate
    console.log(`Creating WAV file (fallback) with sample rate: ${actualSampleRate}Hz (configured: ${configuredSampleRate}Hz)`);

    // Log comprehensive stream format information at capture time (fallback path)
    logCaptureStreamFormats({
      inputDevice: device,
      inputSampleRate: actualSampleRate,
      inputChannels: 1,
      outputSampleRate: actualSampleRate,
      outputChannels: 1,
      isDualSource: false
    });

    // Clear any previous buffer trackers and prepare for new session
    clearBufferTrackers();

    // Create real-time WAV file writer for incremental writing
    // This enables transcription to read from the file while recording
    wavWriter = new RealTimeWavWriter({
      filePath: audioFilePath,
      sampleRate: actualSampleRate,
      channels: 1,
      bitDepth: 16,
      // Update header every 32KB (~1 second of audio at 16kHz mono 16-bit)
      headerUpdateInterval: 32768,
    });
    await wavWriter.open();

    // Build recording options - use actual sample rate
    // IMPORTANT: Use "raw" audioType to get raw PCM data, then write with RealTimeWavWriter
    // This ensures the WAV header matches the actual audio data sample rate
    const recordOptions: {
      sampleRate: number;
      channels: number;
      audioType: "raw" | "wav";
      recorder: "sox" | "rec" | "arecord";
      silence: string;
      threshold: number;
      endOnSilence: boolean;
      device?: string;
    } = {
      sampleRate: actualSampleRate, // Use detected/actual rate
      channels: 1,
      audioType: "raw" as const, // Use raw PCM, not WAV - we'll write WAV header ourselves
      recorder: recorderInfo.recorder as "sox" | "rec" | "arecord",
      silence: "0",
      threshold: 0,
      endOnSilence: false,
    };

    if (device) {
      recordOptions.device = device;
    }

    recordingProcess = record.record(recordOptions);

    const audioStream = recordingProcess.stream();

    // Write audio data to file with immediate flush for real-time transcription
    audioStream.on('data', async (chunk: Buffer) => {
      if (wavWriter) {
        try {
          await wavWriter.write(chunk);
        } catch (writeError) {
          const errorMessage = writeError instanceof Error ? writeError.message : String(writeError);
          console.error(`[Audio Recording] Write error (fallback): ${errorMessage}`);
          if (errorMessage.includes('Disk space error') || errorMessage.includes('Permission error')) {
            emitAudioHealth('error', errorMessage, 'WRITE_ERROR');
            audioRecorderService.stopRecording().catch((stopErr) => {
              console.error("Error stopping recording after write error:", stopErr);
            });
          }
        }
      }
    });

    // Attach audio level listener with buffer tracking for stream format logging
    attachAudioLevelListener(audioStream, 'Input (Microphone)', actualSampleRate, 1);

    // Store reference to error handler so we can remove it when stopping
    streamErrorHandler = (err: Error) => {
      // Ignore errors when we're intentionally stopping
      // sox exits with error code 1 when stopped, which is expected behavior
      if (recordingState.status === "stopping" || recordingState.status === "idle") {
        return;
      }
      
      const errorMessage = err.message || String(err);
      // Check if this is a sox exit error (expected when stopping)
      if (errorMessage.includes("sox has exited with error code 1")) {
        // If we're stopping, this is expected - ignore it
        if (recordingState.status === "stopping") {
          return;
        }
      }
      
      console.error("Recording stream error:", err);
      // Mark state as stopping to prevent double-cleanup
      if (recordingState.status === "recording" || recordingState.status === "paused") {
        recordingState.status = "stopping";
      }
      // Auto-cleanup on error (will be idempotent)
      audioRecorderService.stopRecording().catch((stopErr) => {
        console.error("Error during auto-cleanup after stream error:", stopErr);
      });
    };
    audioStream.on("error", streamErrorHandler);

    const startTime = Date.now();
    recordingState = {
      status: "recording",
      meetingId: meetingId || null,
      startTime,
      duration: 0,
      audioFilePath,
    };
    pausedDuration = 0;

    // Start audio health monitoring to detect issues early
    startAudioHealthMonitoring();

    return {
      success: true,
      meetingId: recordingState.meetingId,
      startTime,
      audioFilePath,
      deviceUsed: device || "system default",
      sampleRateUsed: actualSampleRate,
      sampleRateConfigured: configuredSampleRate,
    };
  },

  /**
   * Stop recording and save the audio file
   * This function is idempotent - it can be called multiple times safely
   */
  async stopRecording(): Promise<StopRecordingResult> {
    // If already idle and no active processes, return success (idempotent)
    if (recordingState.status === "idle" && !recordingProcess && !wavWriter && !customSoxProcess && !systemAudioSoxProcess && !audioMixer) {
      return {
        success: true,
        meetingId: null,
        duration: 0,
        audioFilePath: null,
      };
    }

    // Capture state before cleanup (in case of crash, state might be inconsistent)
    const wasRecording = recordingState.status === "recording" || recordingState.status === "paused";
    const { meetingId, audioFilePath, startTime } = recordingState;

    // Calculate final duration
    let finalDuration: number;
    if (wasRecording && startTime) {
      finalDuration = Date.now() - startTime;
    } else {
      finalDuration = pausedDuration || recordingState.duration || 0;
    }

    try {
      // Set status to "stopping" first so any error during stop will be ignored
      // Then remove error listener before stopping to prevent false error reports
      // sox exits with error code 1 when stopped, which is expected
      if (recordingState.status === "recording" || recordingState.status === "paused") {
        recordingState.status = "stopping";
      }
      detachStreamErrorListener();
      
      // Stop the recording process (if it exists)
      if (recordingProcess) {
        try {
          recordingProcess.stop();
        } catch (err) {
          // Process might already be stopped/crashed, ignore
          console.warn("Error stopping recording process (may already be stopped):", err);
        }
        recordingProcess = null;
      }

      // Stop the custom sox process (if used for direct recording / microphone in dual mode)
      if (customSoxProcess) {
        try {
          const soxProc = customSoxProcess;
          customSoxProcess = null; // Set to null first to prevent race conditions
          soxProc.kill("SIGTERM");
          // Wait a short time for graceful termination
          await new Promise(resolve => setTimeout(resolve, 100));
          if (!soxProc.killed) {
            soxProc.kill("SIGKILL");
          }
        } catch (err) {
          // Process might already be stopped/crashed, ignore
          console.warn("Error stopping custom sox process (may already be stopped):", err);
        }
      }

      // Stop the system audio sox process (if used for dual-source recording)
      if (systemAudioSoxProcess) {
        try {
          const soxProc = systemAudioSoxProcess;
          systemAudioSoxProcess = null; // Set to null first to prevent race conditions
          soxProc.kill("SIGTERM");
          // Wait a short time for graceful termination
          await new Promise(resolve => setTimeout(resolve, 100));
          if (!soxProc.killed) {
            soxProc.kill("SIGKILL");
          }
        } catch (err) {
          // Process might already be stopped/crashed, ignore
          console.warn("Error stopping system audio sox process (may already be stopped):", err);
        }
      }

      // Stop the audio mixer (if used for dual-source recording)
      if (audioMixer) {
        try {
          await audioMixer.stop();
          console.log("Audio mixer stopped and file saved");
        } catch (err) {
          console.warn("Error stopping audio mixer (may already be stopped):", err);
        }
        audioMixer = null;
      }

      // Close the WAV writer (if it exists - not used in dual-source mode)
      if (wavWriter) {
        try {
          await wavWriter.close();
          console.log("WAV writer closed and file finalized");
        } catch (err) {
          // Writer might already be closed, ignore
          console.warn("Error closing WAV writer (may already be closed):", err);
        }
        wavWriter = null;
      }
      detachAudioLevelListener();
      stopAudioHealthMonitoring();

      // Verify the WAV file has a valid sample rate (for debugging)
      if (audioFilePath && fs.existsSync(audioFilePath)) {
        const fileSampleRate = readWavFileSampleRate(audioFilePath);
        if (fileSampleRate) {
          console.log(`WAV file created with sample rate: ${fileSampleRate}Hz`);
          // Log a warning if the sample rate seems unusual (might indicate an issue)
          if (fileSampleRate < 8000 || fileSampleRate > 192000) {
            console.warn(`WAV file has unusual sample rate: ${fileSampleRate}Hz. This may cause playback issues.`);
          }
        } else {
          console.warn(`Could not read sample rate from WAV file: ${audioFilePath}`);
        }
      }

      // Reset state
      recordingState = {
        status: "idle",
        meetingId: null,
        startTime: null,
        duration: 0,
        audioFilePath: null,
      };
      pausedDuration = 0;

      return {
        success: true,
        meetingId,
        duration: finalDuration,
        audioFilePath,
      };
    } catch (error) {
      // Force cleanup even on error
      recordingProcess = null;
      wavWriter = null;
      if (customSoxProcess) {
        try {
          customSoxProcess.kill("SIGKILL");
        } catch {}
        customSoxProcess = null;
      }
      // Clean up system audio process (dual-source recording)
      if (systemAudioSoxProcess) {
        try {
          systemAudioSoxProcess.kill("SIGKILL");
        } catch {}
        systemAudioSoxProcess = null;
      }
      // Clean up audio mixer (dual-source recording)
      if (audioMixer) {
        try {
          audioMixer.stop();
        } catch {}
        audioMixer = null;
      }
      detachAudioLevelListener();
      detachStreamErrorListener();
      stopAudioHealthMonitoring();
      recordingState = {
        status: "idle",
        meetingId: null,
        startTime: null,
        duration: 0,
        audioFilePath: null,
      };
      pausedDuration = 0;

      // If we have a valid file path and duration, still return success
      // The file might have been saved before the error
      if (audioFilePath && finalDuration > 0) {
        return {
          success: true,
          meetingId,
          duration: finalDuration,
          audioFilePath,
        };
      }

      throw new Error(
        `Failed to stop recording: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
    }
  },

  /**
   * Pause the recording
   */
  async pauseRecording(): Promise<PauseRecordingResult> {
    if (recordingState.status !== "recording") {
      throw new Error("Recording is not in progress");
    }

    // Calculate duration up to pause
    const currentDuration = recordingState.startTime
      ? Date.now() - recordingState.startTime
      : 0;

    // Pause the recording stream
    if (recordingProcess) {
      const stream = recordingProcess.stream();
      stream.pause();
    }

    // Pause the custom sox process (if used - microphone in dual mode)
    if (customSoxProcess) {
      customSoxProcess.kill("SIGSTOP");
    }

    // Pause the system audio sox process (if used - dual-source recording)
    if (systemAudioSoxProcess) {
      systemAudioSoxProcess.kill("SIGSTOP");
    }

    // Update state
    pausedDuration = currentDuration;
    recordingState = {
      ...recordingState,
      status: "paused",
      duration: currentDuration,
    };

    emitAudioLevel(0, 0);

    return {
      success: true,
      duration: currentDuration,
    };
  },

  /**
   * Resume a paused recording
   */
  async resumeRecording(): Promise<ResumeRecordingResult> {
    if (recordingState.status !== "paused") {
      throw new Error("Recording is not paused");
    }

    // Resume the recording stream
    if (recordingProcess) {
      const stream = recordingProcess.stream();
      stream.resume();
    }

    // Resume the custom sox process (if used - microphone in dual mode)
    if (customSoxProcess) {
      customSoxProcess.kill("SIGCONT");
    }

    // Resume the system audio sox process (if used - dual-source recording)
    if (systemAudioSoxProcess) {
      systemAudioSoxProcess.kill("SIGCONT");
    }

    // Update state - adjust start time to account for paused duration
    const newStartTime = Date.now() - pausedDuration;
    recordingState = {
      ...recordingState,
      status: "recording",
      startTime: newStartTime,
    };

    return {
      success: true,
      startTime: newStartTime,
    };
  },

  /**
   * Get the current recording status
   */
  getStatus(): RecordingState {
    // Calculate current duration if recording
    const duration =
      recordingState.status === "recording" && recordingState.startTime
        ? Date.now() - recordingState.startTime
        : recordingState.duration;

    return {
      ...recordingState,
      duration,
    };
  },

  /**
   * Get the recordings directory path
   */
  getRecordingsDirectory(): string {
    return getRecordingsDir();
  },

  /**
   * List all recording files recursively from meeting folders and root directory
   */
  listRecordings(): string[] {
    const recordingsDir = getRecordingsDir();
    const recordings: string[] = [];

    try {
      const entries = fs.readdirSync(recordingsDir, { withFileTypes: true });

      for (const entry of entries) {
        const fullPath = path.join(recordingsDir, entry.name);

        if (entry.isDirectory()) {
          // Recursively search in meeting folders
          try {
            const folderRecordings = fs
              .readdirSync(fullPath)
              .filter((file) => file.endsWith(".wav"))
              .map((file) => path.join(fullPath, file));
            recordings.push(...folderRecordings);
          } catch (err) {
            // Skip folders we can't read
            console.warn(`Failed to read recordings from folder ${fullPath}:`, err);
          }
        } else if (entry.isFile() && entry.name.endsWith(".wav")) {
          // Include recordings in root directory (for backward compatibility)
          recordings.push(fullPath);
        }
      }

      // Sort by modification time, newest first
      return recordings.sort((a, b) => {
        try {
          const statA = fs.statSync(a);
          const statB = fs.statSync(b);
          return statB.mtime.getTime() - statA.mtime.getTime();
        } catch {
          return 0;
        }
      });
    } catch {
      return [];
    }
  },

  /**
   * Delete a recording file
   */
  deleteRecording(filePath: string): boolean {
    try {
      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
        return true;
      }
      return false;
    } catch {
      return false;
    }
  },

  /**
   * Subscribe to real-time audio level updates
   */
  onAudioLevel(listener: (data: AudioLevelData) => void): () => void {
    audioLevelEmitter.on(AUDIO_LEVEL_EVENT, listener);
    return () => {
      audioLevelEmitter.off(AUDIO_LEVEL_EVENT, listener);
    };
  },

  /**
   * Subscribe to audio health status updates
   * Emits warnings when no audio data is being received
   */
  onAudioHealth(listener: (data: AudioHealthData) => void): () => void {
    audioLevelEmitter.on(AUDIO_HEALTH_EVENT, listener);
    return () => {
      audioLevelEmitter.off(AUDIO_HEALTH_EVENT, listener);
    };
  },

  /**
   * Subscribe to raw audio chunks for live transcription
   * This is called for every chunk of audio data received during recording
   * @param listener Function that receives { data: Buffer, sampleRate, channels, bitDepth, timestamp }
   * @returns Unsubscribe function
   */
  onAudioChunk(listener: (data: {
    data: Buffer;
    sampleRate: number;
    channels: number;
    bitDepth: number;
    timestamp: number;
  }) => void): () => void {
    audioChunkEmitter.on(AUDIO_CHUNK_EVENT, listener);
    return () => {
      audioChunkEmitter.off(AUDIO_CHUNK_EVENT, listener);
    };
  },

  /**
   * Subscribe to system audio chunks for live transcription
   * This is called for every chunk of system audio (computer output) during dual-source recording
   * System audio typically contains remote participants' voices in meetings/calls
   * @param listener Function that receives { data: Buffer, sampleRate, channels, bitDepth, timestamp, isSystemAudio }
   * @returns Unsubscribe function
   */
  onSystemAudioChunk(listener: (data: {
    data: Buffer;
    sampleRate: number;
    channels: number;
    bitDepth: number;
    timestamp: number;
    isSystemAudio: boolean;
  }) => void): () => void {
    systemAudioChunkEmitter.on(SYSTEM_AUDIO_CHUNK_EVENT, listener);
    return () => {
      systemAudioChunkEmitter.off(SYSTEM_AUDIO_CHUNK_EVENT, listener);
    };
  },

  /**
   * Migrate existing recordings from root directory to meeting-specific folders
   * This function should be called once to organize existing recordings
   * Returns the number of recordings migrated
   */
  migrateRecordingsToMeetingFolders(): { migrated: number; errors: number; skipped: number } {
    const recordingsDir = getRecordingsDir();
    let migrated = 0;
    let errors = 0;
    let skipped = 0;

    try {
      // Get all recordings in the root directory
      const entries = fs.readdirSync(recordingsDir, { withFileTypes: true });
      const rootRecordings = entries.filter(
        (entry) => entry.isFile() && entry.name.endsWith(".wav")
      );

      // Query database to get all recordings and create a map by file path
      const db = getDatabaseService().getDatabase();
      const allRecordings = db.prepare("SELECT * FROM recordings").all() as Array<{
        id: string;
        meeting_id: string;
        file_path: string;
      }>;
      const recordingsByPath = new Map<string, { id: string; meeting_id: string }>();
      for (const rec of allRecordings) {
        recordingsByPath.set(rec.file_path, { id: rec.id, meeting_id: rec.meeting_id });
      }

      for (const entry of rootRecordings) {
        const recordingPath = path.join(recordingsDir, entry.name);

        try {
          let meetingId: string | null = null;

          // First, try to find in database by exact file path
          const dbRecording = recordingsByPath.get(recordingPath);
          if (dbRecording) {
            meetingId = dbRecording.meeting_id;
          } else {
            // Fallback: try to extract meeting ID from filename (format: meeting-{id}-{timestamp}.wav)
            const filenameMatch = entry.name.match(/^meeting-([a-f0-9-]+)-/i);
            if (filenameMatch && filenameMatch[1]) {
              meetingId = filenameMatch[1];
            }
          }

          // If we still don't have a meeting ID, skip this recording
          if (!meetingId) {
            console.warn(`Could not determine meeting ID for recording: ${entry.name}`);
            skipped++;
            continue;
          }

          // Get or create the meeting folder
          const meetingFolder = getMeetingFolder(meetingId);
          if (!meetingFolder) {
            console.warn(`Could not create meeting folder for meeting ${meetingId}`);
            skipped++;
            continue;
          }

          const destinationPath = path.join(meetingFolder, entry.name);

          // Check if destination already exists (avoid overwriting)
          if (fs.existsSync(destinationPath)) {
            console.warn(`Recording already exists at destination: ${destinationPath}`);
            skipped++;
            continue;
          }

          // Move the file
          fs.renameSync(recordingPath, destinationPath);
          migrated++;

          // Update database record if it exists
          if (dbRecording) {
            try {
              recordingService.update(dbRecording.id, {
                file_path: destinationPath,
              });
            } catch (dbError) {
              console.warn(`Failed to update database for recording ${entry.name}:`, dbError);
              // Continue even if DB update fails
            }
          }
        } catch (error) {
          console.error(`Error migrating recording ${entry.name}:`, error);
          errors++;
        }
      }
    } catch (error) {
      console.error("Error during recording migration:", error);
      errors++;
    }

    return { migrated, errors, skipped };
  },
};

// Export reset function for testing
export function resetAudioRecorderState(): void {
  // Stop any active recording first
  if (recordingState.status !== "idle") {
    detachStreamErrorListener();
    if (recordingProcess) {
      recordingProcess.stop();
      recordingProcess = null;
    }
    if (customSoxProcess) {
      try {
        customSoxProcess.kill("SIGKILL");
      } catch {}
      customSoxProcess = null;
    }
    if (wavWriter) {
      try {
        // Use sync close for reset function (can't await in sync context)
        wavWriter.close().catch(() => {});
      } catch {}
      wavWriter = null;
    }
  }
  detachAudioLevelListener();
  stopAudioHealthMonitoring();

  recordingState = {
    status: "idle",
    meetingId: null,
    startTime: null,
    duration: 0,
    audioFilePath: null,
  };
  pausedDuration = 0;
}
