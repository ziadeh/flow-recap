/**
 * Audio Preprocessing Configuration Service
 *
 * Manages audio preprocessing settings optimized for different use cases:
 * - DIARIZATION: Minimal processing to preserve speaker embeddings
 * - TRANSCRIPTION: May include noise reduction for better ASR accuracy
 *
 * KEY DESIGN PRINCIPLE:
 * Aggressive audio processing (noise suppression, echo cancellation, loudness
 * normalization, compression) DESTROYS speaker embeddings and REDUCES diarization
 * accuracy. This service ensures the diarization pipeline uses minimal processing.
 *
 * Dual Audio Path Architecture:
 *   Raw Audio Capture
 *        |
 *        v
 *   +-----------+      +------------------+
 *   | Diarization | --> | Minimal Processing |
 *   | Path        |      | (DC removal, peak limiting) |
 *   +-----------+      +------------------+
 *        |
 *        v
 *   +-----------+      +------------------+
 *   | Transcription | --> | Enhanced Processing |
 *   | Path          |      | (noise reduction, normalization) |
 *   +-----------+      +------------------+
 */

import { settingsService } from './settingsService'

// ============================================================================
// Types
// ============================================================================

export type AudioProcessingMode = 'diarization' | 'transcription' | 'both'

/**
 * Audio quality issue types that affect diarization accuracy
 */
export type AudioQualityIssue =
  | 'clipping'           // Audio is clipping/distorted
  | 'low_snr'            // Signal-to-noise ratio is too low
  | 'high_noise'         // High background noise level
  | 'low_volume'         // Audio level is too low
  | 'dc_offset'          // Significant DC offset present
  | 'short_duration'     // Audio is very short
  | 'sample_rate_mismatch' // Non-optimal sample rate

/**
 * Audio quality severity levels
 */
export type QualitySeverity = 'info' | 'warning' | 'error'

/**
 * Audio quality warning
 */
export interface AudioQualityWarning {
  issue: AudioQualityIssue
  severity: QualitySeverity
  message: string
  value?: number
  threshold?: number
  recommendation?: string
}

/**
 * Audio quality report from Python preprocessing
 */
export interface AudioQualityReport {
  overallQuality: 'excellent' | 'good' | 'fair' | 'poor' | 'critical'
  diarizationSuitability: number // 0.0-1.0
  metrics: {
    peakAmplitude: number
    rmsLevelDb: number
    noiseFloorDb: number
    estimatedSnrDb: number
    dynamicRangeDb: number
    clippingPercentage: number
    dcOffset: number
    silencePercentage: number
  }
  audioProperties: {
    sampleRate: number
    channels: number
    durationSeconds: number
    bitDepth: number
  }
  warnings: AudioQualityWarning[]
  summary: {
    hasWarnings: boolean
    hasCriticalIssues: boolean
    warningCount: number
    errorCount: number
  }
}

/**
 * Configuration for diarization-optimized audio preprocessing
 *
 * IMPORTANT: Default settings are optimized for MAXIMUM diarization accuracy.
 * Destructive processing options are DISABLED by default.
 */
export interface DiarizationPreprocessingConfig {
  // Target format
  targetSampleRate: number      // Default: 16000 (pyannote standard)
  targetChannels: number        // Default: 1 (mono)
  targetBitDepth: number        // Default: 16

  // Minimal processing (DEFAULT: enabled for diarization)
  removeDcOffset: boolean       // Remove DC offset (safe)
  applyPeakLimiting: boolean    // Gentle peak limiting
  peakLimitDb: number           // Default: -1.0 dB

  // DESTRUCTIVE PROCESSING (DEFAULT: DISABLED for diarization!)
  // These options DESTROY speaker embeddings and REDUCE diarization accuracy!
  applyNoiseSuppression: boolean   // DO NOT enable for diarization
  applyEchoCancellation: boolean   // DO NOT enable for diarization
  applyLoudnessNormalization: boolean // DO NOT enable for diarization
  applyCompression: boolean        // DO NOT enable for diarization
  applyHighPassFilter: boolean     // May remove low-frequency speaker characteristics

  // Quality validation
  validateQuality: boolean
  warnOnClipping: boolean
  warnOnLowSnr: boolean
  warnOnHighNoise: boolean
}

/**
 * Configuration for transcription audio preprocessing
 *
 * Transcription can benefit from noise reduction, but diarization cannot.
 */
export interface TranscriptionPreprocessingConfig {
  // Target format
  targetSampleRate: number      // Default: 16000 (Whisper standard)
  targetChannels: number        // Default: 1 (mono)
  targetBitDepth: number        // Default: 16

  // Processing options (can be more aggressive for transcription)
  applyNoiseReduction: boolean  // OK for transcription, NOT for diarization
  applyLoudnessNormalization: boolean // OK for transcription, NOT for diarization
  targetLoudnessDb: number      // Default: -20.0 dB

  // High-pass filter to remove rumble (OK for transcription)
  applyHighPassFilter: boolean
  highPassCutoffHz: number      // Default: 80 Hz
}

/**
 * Complete audio preprocessing settings
 */
export interface AudioPreprocessingSettings {
  // Enable dual path preprocessing
  useDualPath: boolean

  // Mode-specific configurations
  diarization: DiarizationPreprocessingConfig
  transcription: TranscriptionPreprocessingConfig

  // Quality thresholds
  qualityThresholds: {
    clippingWarningPercent: number      // Default: 0.1%
    clippingErrorPercent: number        // Default: 1.0%
    lowSnrWarningDb: number             // Default: 10 dB
    lowSnrErrorDb: number               // Default: 5 dB
    highNoiseFloorDb: number            // Default: -35 dB
    minDynamicRangeDb: number           // Default: 20 dB
  }
}

// ============================================================================
// Default Configurations
// ============================================================================

/**
 * Default configuration for DIARIZATION-OPTIMIZED preprocessing
 *
 * CRITICAL: Minimal processing to preserve speaker embeddings!
 */
export const DEFAULT_DIARIZATION_CONFIG: DiarizationPreprocessingConfig = {
  // Target format (pyannote.audio standard)
  targetSampleRate: 16000,
  targetChannels: 1,
  targetBitDepth: 16,

  // Minimal, non-destructive processing
  removeDcOffset: true,           // Safe - doesn't affect speaker characteristics
  applyPeakLimiting: true,        // Gentle limiting to prevent clipping
  peakLimitDb: -1.0,              // Very gentle threshold

  // DESTRUCTIVE PROCESSING: ALL DISABLED FOR DIARIZATION!
  // These options destroy speaker embeddings and reduce accuracy!
  applyNoiseSuppression: false,   // ❌ DESTROYS speaker characteristics
  applyEchoCancellation: false,   // ❌ DESTROYS speaker characteristics
  applyLoudnessNormalization: false, // ❌ DESTROYS speaker dynamics
  applyCompression: false,        // ❌ DESTROYS speaker dynamics
  applyHighPassFilter: false,     // ❌ May remove low-frequency speaker info

  // Quality validation
  validateQuality: true,
  warnOnClipping: true,
  warnOnLowSnr: true,
  warnOnHighNoise: true
}

/**
 * Default configuration for TRANSCRIPTION preprocessing
 *
 * Can include noise reduction as it doesn't need to preserve speaker embeddings.
 */
export const DEFAULT_TRANSCRIPTION_CONFIG: TranscriptionPreprocessingConfig = {
  // Target format (Whisper standard)
  targetSampleRate: 16000,
  targetChannels: 1,
  targetBitDepth: 16,

  // Enhanced processing for better ASR
  applyNoiseReduction: true,      // OK for transcription
  applyLoudnessNormalization: true, // OK for transcription
  targetLoudnessDb: -20.0,

  // High-pass filter for rumble
  applyHighPassFilter: false,     // Usually not needed
  highPassCutoffHz: 80
}

/**
 * Default quality thresholds
 */
export const DEFAULT_QUALITY_THRESHOLDS = {
  clippingWarningPercent: 0.1,
  clippingErrorPercent: 1.0,
  lowSnrWarningDb: 10.0,
  lowSnrErrorDb: 5.0,
  highNoiseFloorDb: -35.0,
  minDynamicRangeDb: 20.0
}

/**
 * Complete default audio preprocessing settings
 */
export const DEFAULT_AUDIO_PREPROCESSING_SETTINGS: AudioPreprocessingSettings = {
  useDualPath: true,  // Enable dual path by default
  diarization: DEFAULT_DIARIZATION_CONFIG,
  transcription: DEFAULT_TRANSCRIPTION_CONFIG,
  qualityThresholds: DEFAULT_QUALITY_THRESHOLDS
}

// ============================================================================
// Settings Keys
// ============================================================================

const SETTINGS_KEYS = {
  USE_DUAL_PATH: 'audio.preprocessing.useDualPath',
  DIARIZATION_CONFIG: 'audio.preprocessing.diarization',
  TRANSCRIPTION_CONFIG: 'audio.preprocessing.transcription',
  QUALITY_THRESHOLDS: 'audio.preprocessing.qualityThresholds',
  // Legacy keys for backwards compatibility
  SAMPLE_RATE: 'audio.sampleRate',
  NOISE_REDUCTION_ENABLED: 'audio.noiseReduction',
} as const

// ============================================================================
// Audio Preprocessing Configuration Service
// ============================================================================

export const audioPreprocessingConfigService = {
  /**
   * Get the complete audio preprocessing settings
   */
  getSettings(): AudioPreprocessingSettings {
    // Try to get saved settings
    const useDualPath = settingsService.get<boolean>(SETTINGS_KEYS.USE_DUAL_PATH)
    const diarizationConfig = settingsService.get<DiarizationPreprocessingConfig>(
      SETTINGS_KEYS.DIARIZATION_CONFIG
    )
    const transcriptionConfig = settingsService.get<TranscriptionPreprocessingConfig>(
      SETTINGS_KEYS.TRANSCRIPTION_CONFIG
    )
    const qualityThresholds = settingsService.get<typeof DEFAULT_QUALITY_THRESHOLDS>(
      SETTINGS_KEYS.QUALITY_THRESHOLDS
    )

    return {
      useDualPath: useDualPath ?? DEFAULT_AUDIO_PREPROCESSING_SETTINGS.useDualPath,
      diarization: diarizationConfig ?? DEFAULT_DIARIZATION_CONFIG,
      transcription: transcriptionConfig ?? DEFAULT_TRANSCRIPTION_CONFIG,
      qualityThresholds: qualityThresholds ?? DEFAULT_QUALITY_THRESHOLDS
    }
  },

  /**
   * Get diarization-optimized preprocessing configuration
   */
  getDiarizationConfig(): DiarizationPreprocessingConfig {
    const saved = settingsService.get<DiarizationPreprocessingConfig>(
      SETTINGS_KEYS.DIARIZATION_CONFIG
    )
    return saved ?? DEFAULT_DIARIZATION_CONFIG
  },

  /**
   * Get transcription preprocessing configuration
   */
  getTranscriptionConfig(): TranscriptionPreprocessingConfig {
    const saved = settingsService.get<TranscriptionPreprocessingConfig>(
      SETTINGS_KEYS.TRANSCRIPTION_CONFIG
    )
    return saved ?? DEFAULT_TRANSCRIPTION_CONFIG
  },

  /**
   * Get quality thresholds for audio validation
   */
  getQualityThresholds() {
    const saved = settingsService.get<typeof DEFAULT_QUALITY_THRESHOLDS>(
      SETTINGS_KEYS.QUALITY_THRESHOLDS
    )
    return saved ?? DEFAULT_QUALITY_THRESHOLDS
  },

  /**
   * Check if dual path preprocessing is enabled
   */
  isDualPathEnabled(): boolean {
    const saved = settingsService.get<boolean>(SETTINGS_KEYS.USE_DUAL_PATH)
    return saved ?? true // Default to enabled
  },

  /**
   * Save audio preprocessing settings
   */
  saveSettings(settings: Partial<AudioPreprocessingSettings>): void {
    if (settings.useDualPath !== undefined) {
      settingsService.set(
        SETTINGS_KEYS.USE_DUAL_PATH,
        settings.useDualPath,
        'audio'
      )
    }
    if (settings.diarization) {
      settingsService.set(
        SETTINGS_KEYS.DIARIZATION_CONFIG,
        settings.diarization,
        'audio'
      )
    }
    if (settings.transcription) {
      settingsService.set(
        SETTINGS_KEYS.TRANSCRIPTION_CONFIG,
        settings.transcription,
        'audio'
      )
    }
    if (settings.qualityThresholds) {
      settingsService.set(
        SETTINGS_KEYS.QUALITY_THRESHOLDS,
        settings.qualityThresholds,
        'audio'
      )
    }
  },

  /**
   * Save diarization config
   */
  saveDiarizationConfig(config: Partial<DiarizationPreprocessingConfig>): void {
    const current = this.getDiarizationConfig()
    const updated = { ...current, ...config }

    // Validate: warn if destructive processing is enabled
    if (updated.applyNoiseSuppression) {
      console.warn(
        '[Audio Preprocessing] WARNING: Noise suppression is enabled for diarization. ' +
        'This may REDUCE diarization accuracy by destroying speaker characteristics.'
      )
    }
    if (updated.applyEchoCancellation) {
      console.warn(
        '[Audio Preprocessing] WARNING: Echo cancellation is enabled for diarization. ' +
        'This may REDUCE diarization accuracy by destroying speaker characteristics.'
      )
    }
    if (updated.applyLoudnessNormalization) {
      console.warn(
        '[Audio Preprocessing] WARNING: Loudness normalization is enabled for diarization. ' +
        'This may REDUCE diarization accuracy by destroying speaker dynamics.'
      )
    }

    settingsService.set(SETTINGS_KEYS.DIARIZATION_CONFIG, updated, 'audio')
  },

  /**
   * Save transcription config
   */
  saveTranscriptionConfig(config: Partial<TranscriptionPreprocessingConfig>): void {
    const current = this.getTranscriptionConfig()
    const updated = { ...current, ...config }
    settingsService.set(SETTINGS_KEYS.TRANSCRIPTION_CONFIG, updated, 'audio')
  },

  /**
   * Reset to default settings
   */
  resetToDefaults(): void {
    settingsService.set(
      SETTINGS_KEYS.USE_DUAL_PATH,
      DEFAULT_AUDIO_PREPROCESSING_SETTINGS.useDualPath,
      'audio'
    )
    settingsService.set(
      SETTINGS_KEYS.DIARIZATION_CONFIG,
      DEFAULT_DIARIZATION_CONFIG,
      'audio'
    )
    settingsService.set(
      SETTINGS_KEYS.TRANSCRIPTION_CONFIG,
      DEFAULT_TRANSCRIPTION_CONFIG,
      'audio'
    )
    settingsService.set(
      SETTINGS_KEYS.QUALITY_THRESHOLDS,
      DEFAULT_QUALITY_THRESHOLDS,
      'audio'
    )
  },

  /**
   * Check if audio quality is suitable for diarization
   */
  isQualitySuitable(report: AudioQualityReport): boolean {
    const acceptableQualities = ['excellent', 'good', 'fair']
    return (
      acceptableQualities.includes(report.overallQuality) &&
      !report.summary.hasCriticalIssues
    )
  },

  /**
   * Get recommendations for improving audio quality
   */
  getQualityRecommendations(report: AudioQualityReport): string[] {
    const recommendations: string[] = []

    for (const warning of report.warnings) {
      if (warning.recommendation) {
        recommendations.push(warning.recommendation)
      }
    }

    // Add general recommendations based on quality level
    if (report.overallQuality === 'poor' || report.overallQuality === 'critical') {
      recommendations.push(
        'Consider using a higher quality microphone or improving the recording environment.'
      )
    }

    return recommendations
  },

  /**
   * Format a quality report for display
   */
  formatQualityReport(report: AudioQualityReport): string {
    const lines: string[] = []

    lines.push(`Audio Quality: ${report.overallQuality.toUpperCase()}`)
    lines.push(`Diarization Suitability: ${Math.round(report.diarizationSuitability * 100)}%`)
    lines.push('')
    lines.push('Metrics:')
    lines.push(`  Peak Amplitude: ${report.metrics.peakAmplitude.toFixed(4)}`)
    lines.push(`  RMS Level: ${report.metrics.rmsLevelDb.toFixed(1)} dB`)
    lines.push(`  Noise Floor: ${report.metrics.noiseFloorDb.toFixed(1)} dB`)
    lines.push(`  Estimated SNR: ${report.metrics.estimatedSnrDb.toFixed(1)} dB`)
    lines.push(`  Clipping: ${report.metrics.clippingPercentage.toFixed(2)}%`)

    if (report.warnings.length > 0) {
      lines.push('')
      lines.push('Warnings:')
      for (const warning of report.warnings) {
        const icon = warning.severity === 'error' ? '❌' :
                     warning.severity === 'warning' ? '⚠️' : 'ℹ️'
        lines.push(`  ${icon} ${warning.message}`)
      }
    }

    return lines.join('\n')
  }
}

// ============================================================================
// Exports
// ============================================================================

export default audioPreprocessingConfigService
